import { admin } from './supabase.js';

const PAGE = 1000;
const HARD_CAP = 50000; // garde-fou mémoire

// ── Accès aux champs ────────────────────────────────────────
function rawField(row, field) {
  if (field === '__category') return row.__category_label ?? row.__category;
  if (field.startsWith('details.')) return row.details?.[field.slice('details.'.length)];
  return row[field];
}

function normalize(value, spec) {
  if (value === null || value === undefined) return null;
  let s = typeof value === 'string' ? value
        : typeof value === 'number' || typeof value === 'boolean' ? String(value)
        : JSON.stringify(value);
  s = s.trim();
  if (spec.extract) {
    let m = null;
    try { m = new RegExp(spec.extract).exec(s); } catch { m = null; }
    s = m ? (m[1] ?? m[0]) : '';
  }
  if (spec.transform === 'upper') s = s.toUpperCase();
  if (spec.transform === 'lower') s = s.toLowerCase();
  if (spec.transform === 'trim') s = s.trim();
  return s === '' ? null : s;
}

/** Valeur unique (ou chaîne jointe si tableau et multi non demandé). */
export function fieldValue(row, spec) {
  const raw = rawField(row, spec.field);
  if (Array.isArray(raw)) {
    const joined = raw.map(v => normalize(v, spec)).filter(Boolean).join(', ');
    return joined || spec.fallback || null;
  }
  return normalize(raw, spec) ?? spec.fallback ?? null;
}

/** Toutes les valeurs (tableau éclaté si multi). */
export function fieldValues(row, spec) {
  const raw = rawField(row, spec.field);
  const list = Array.isArray(raw) && spec.multi ? raw : [raw];
  const out = list.map(v => normalize(v, spec)).filter(Boolean);
  if (!out.length && spec.fallback) return [spec.fallback];
  return out;
}

function numberValue(row, spec) {
  const raw = rawField(row, spec.field);
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// ── Filtre d'action ─────────────────────────────────────────
export function actionMatches(action, match) {
  if (!action || !match) return false;
  const values = match.values || [];
  if (match.mode === 'prefix') return values.some(v => action.startsWith(v));
  return values.includes(action); // 'in' | 'equals'
}

// ── Lecture des logs (pagination complète, pas de limite arbitraire) ──
export async function fetchLogs(definition, { days = 7, email = null, emails = null } = {}) {
  const sb = admin();
  const since = days > 0 ? new Date(Date.now() - days * 86400_000).toISOString() : null;
  const match = definition.match || { mode: 'in', values: [] };
  const variants = match.mode === 'prefix'
    ? (match.values || []).map(v => ({ like: `${v}%` }))
    : [{ in: match.values || [] }];

  const byId = new Map();
  let truncated = false;

  for (const variant of variants) {
    let from = 0;
    for (;;) {
      let q = sb.from('activity_logs')
        .select('id, email, action, details, created_at')
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1);

      if (variant.like) q = q.like('action', variant.like);
      else q = q.in('action', variant.in);
      if (since) q = q.gte('created_at', since);
      if (email) q = q.eq('email', email);
      else if (emails) q = q.in('email', emails);

      const { data, error } = await q;
      if (error) throw error;
      (data || []).forEach(r => byId.set(r.id, r));

      if (!data || data.length < PAGE) break;
      from += PAGE;
      if (byId.size >= HARD_CAP) { truncated = true; break; }
    }
    if (truncated) break;
  }

  const rows = [...byId.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { rows, truncated };
}

// ── Catégories ──────────────────────────────────────────────
function categoriesOf(definition) {
  const cats = definition.config?.categories;
  return Array.isArray(cats) && cats.length ? cats : null;
}

function tagCategories(rows, cats) {
  if (!cats) return;
  for (const row of rows) {
    const hit = cats.find(c => actionMatches(row.action, c.match));
    row.__category = hit ? hit.key : 'autre';
    row.__category_label = hit ? hit.label : 'Autre';
    row.__category_color = hit ? (hit.color || 'blue') : 'grey';
  }
}

// ── Colonnes de breakdown ───────────────────────────────────
const LABELS = {
  email: 'Utilisateurs', action: 'Actions',
  'details.compte': 'Comptes', 'details.segment': 'Segments',
  'details.energie': 'Énergies', 'details.ref_dossier': 'Dossiers',
  'details.fournisseurs': 'Fournisseurs',
};
const labelFor = field => LABELS[field] || field.split('.').pop();

function parseColumns(specs) {
  return (specs || ['count', 'share', 'last']).map(spec => {
    const [kind, ...args] = String(spec).split(':');
    switch (kind) {
      case 'count':      return { id: 'count', kind, label: 'Volume', type: 'badge' };
      case 'share':      return { id: 'share', kind, label: 'Part', type: 'bar' };
      case 'last':       return { id: 'last', kind, label: 'Dernière activité', type: 'datetime' };
      case 'categories': return { id: 'categories', kind, label: 'Répartition', type: 'categories' };
      case 'rate':       return { id: `rate_${args[0]}_${args[1]}`, kind, num: args[0], den: args[1], label: 'Taux', type: 'rate' };
      case 'distinct':   return { id: `distinct_${args[0]}`, kind, field: args[0], label: args[1] || labelFor(args[0]), type: 'number' };
      case 'sum':        return { id: `sum_${args[0]}`, kind, field: args[0], label: args[1] || labelFor(args[0]), type: 'number' };
      case 'chips':      return { id: `chips_${args[0]}`, kind, field: args[0], label: args[1] || labelFor(args[0]), type: 'chips' };
      default:           return { id: kind, kind: 'count', label: 'Volume', type: 'badge' };
    }
  });
}

function buildBreakdown(spec, rows, cats) {
  const columns = parseColumns(spec.columns);
  const groups = new Map();

  for (const row of rows) {
    for (const key of fieldValues(row, spec)) {
      let g = groups.get(key);
      if (!g) {
        g = { key, count: 0, last: null, categories: {}, distinct: {}, sums: {}, chips: {} };
        groups.set(key, g);
      }
      g.count++;
      if (!g.last || row.created_at > g.last) g.last = row.created_at;
      if (cats) g.categories[row.__category] = (g.categories[row.__category] || 0) + 1;
      for (const col of columns) {
        if (col.kind === 'distinct') {
          (g.distinct[col.id] ||= new Set()).add(fieldValue(row, { field: col.field }) || '—');
        } else if (col.kind === 'sum') {
          g.sums[col.id] = (g.sums[col.id] || 0) + numberValue(row, { field: col.field });
        } else if (col.kind === 'chips') {
          const bucket = (g.chips[col.id] ||= {});
          for (const v of fieldValues(row, { field: col.field, fallback: 'N/A' })) {
            bucket[v] = (bucket[v] || 0) + 1;
          }
        }
      }
    }
  }

  const total = rows.length || 1;
  let list = [...groups.values()].sort((a, b) => b.count - a.count || (a.key > b.key ? 1 : -1));
  const truncatedAt = spec.limit && list.length > spec.limit ? list.length : null;
  if (spec.limit) list = list.slice(0, spec.limit);
  const max = Math.max(1, ...list.map(g => g.count));

  const outRows = list.map(g => {
    const cells = {};
    for (const col of columns) {
      switch (col.kind) {
        case 'count': cells[col.id] = { value: g.count }; break;
        case 'share': cells[col.id] = { value: Math.round((g.count / total) * 1000) / 10, width: Math.round((g.count / max) * 1000) / 10 }; break;
        case 'last':  cells[col.id] = { value: g.last }; break;
        case 'categories': cells[col.id] = { value: g.categories }; break;
        case 'rate': {
          const num = g.categories[col.num] || 0;
          const den = g.categories[col.den] || 0;
          cells[col.id] = { value: den ? Math.round((num / den) * 100) : null };
          break;
        }
        case 'distinct': cells[col.id] = { value: (g.distinct[col.id]?.size) || 0 }; break;
        case 'sum':      cells[col.id] = { value: Math.round((g.sums[col.id] || 0) * 10) / 10 }; break;
        case 'chips': {
          const bucket = g.chips[col.id] || {};
          cells[col.id] = { value: Object.entries(bucket).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, count: n })) };
          break;
        }
      }
    }
    return { key: g.key, count: g.count, cells };
  });

  return {
    key: spec.key,
    label: spec.label,
    header: spec.header || 'Valeur',
    columns,
    rows: outRows,
    total_groups: groups.size,
    truncated_at: truncatedAt,
  };
}

// ── KPI ─────────────────────────────────────────────────────
function buildKpis(specs, rows, cats) {
  const total = rows.length;
  const catCounts = {};
  if (cats) for (const r of rows) catCounts[r.__category] = (catCounts[r.__category] || 0) + 1;

  return (specs || [{ label: 'Total', type: 'count' }]).map(spec => {
    const out = { label: spec.label, color: spec.color || null, suffix: '' };
    switch (spec.type) {
      case 'count':
        out.value = total; break;
      case 'count_category':
        out.value = catCounts[spec.category] || 0; break;
      case 'distinct': {
        const set = new Set();
        for (const r of rows) { const v = fieldValue(r, spec); if (v) set.add(v); }
        out.value = set.size; break;
      }
      case 'distinct_multi': {
        const set = new Set();
        for (const r of rows) for (const v of fieldValues(r, { ...spec, multi: true })) set.add(v);
        out.value = set.size; break;
      }
      case 'rate': {
        const num = catCounts[spec.num] || 0;
        const den = catCounts[spec.den] || 0;
        out.value = den ? Math.round((num / den) * 100) : 0;
        out.suffix = '%'; break;
      }
      case 'avg_per': {
        const set = new Set();
        for (const r of rows) { const v = fieldValue(r, spec); if (v) set.add(v); }
        const d = spec.decimals ?? 1;
        out.value = set.size ? +(total / set.size).toFixed(d) : 0; break;
      }
      case 'sum': {
        let s = 0; for (const r of rows) s += numberValue(r, spec);
        out.value = Math.round(s * 10) / 10; break;
      }
      case 'avg': {
        let s = 0; for (const r of rows) s += numberValue(r, spec);
        const d = spec.decimals ?? 1;
        out.value = total ? +(s / total).toFixed(d) : 0; break;
      }
      default:
        out.value = total;
    }
    return out;
  });
}

// ── Détail ──────────────────────────────────────────────────
function buildDetail(detailSpec, rows) {
  const columns = (detailSpec?.columns || [
    { label: 'Date', field: 'created_at', type: 'datetime' },
    { label: 'Utilisateur', field: 'email' },
    { label: 'Action', field: 'action' },
  ]);

  const outRows = rows.map(row => {
    const values = columns.map(col => {
      if (col.type === 'category') {
        return { display: row.__category_label || '—', color: row.__category_color || 'grey' };
      }
      if (col.type === 'list') {
        const list = fieldValues(row, { ...col, multi: true });
        return { display: list.join(', '), list };
      }
      const v = fieldValue(row, col);
      return { display: v ?? '' };
    });
    const haystack = (detailSpec?.search || ['email', 'action'])
      .map(f => fieldValue(row, { field: f }) || '')
      .join(' ')
      .toLowerCase();
    return {
      id: row.id,
      created_at: row.created_at,
      category: row.__category || null,
      values,
      q: haystack,
    };
  });

  return { columns, rows: outRows };
}

// ── Agrégation pure (testable hors base) ────────────────────
export function aggregate(definition, rows, truncated = false) {
  const cats = categoriesOf(definition);
  tagCategories(rows, cats);

  const config = definition.config || {};
  return {
    key: definition.key,
    label: definition.label,
    description: definition.description,
    icon: definition.icon,
    app_slug: definition.app_slug,
    total: rows.length,
    truncated,
    categories: cats ? cats.map(c => ({ key: c.key, label: c.label, color: c.color || 'blue' })) : [],
    kpis: buildKpis(config.kpis, rows, cats),
    breakdowns: (config.breakdowns || []).map(b => buildBreakdown(b, rows, cats)),
    detail: buildDetail(config.detail, rows),
    generated_at: new Date().toISOString(),
  };
}

// ── Point d'entrée ──────────────────────────────────────────
export async function computeStats(definition, filters) {
  const { rows, truncated } = await fetchLogs(definition, filters);
  return aggregate(definition, rows, truncated);
}
