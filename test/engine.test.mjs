/**
 * Contrôle du moteur d'agrégation sur des lignes réelles d'activity_logs.
 * Les définitions sont extraites du fichier de migration : c'est bien la
 * configuration de production qui est testée.
 *
 *   node test/engine.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { aggregate, actionMatches, fieldValue, fieldValues } from '../api/_lib/engine.js';

const ROOT = path.resolve(import.meta.dirname, '..');

// ── Chargement des définitions depuis la migration ──────────
function loadDefinitions() {
  const sql = fs.readdirSync(path.join(ROOT, 'db'))
    .filter(f => f.endsWith('.sql')).sort()
    .map(f => fs.readFileSync(path.join(ROOT, 'db', f), 'utf8'))
    .join('\n');
  const defs = {};
  const re = /'([a-z_]+)',\s*(?:'[a-z-]+'|null),\s*\n\s*'[^']*'[^$]*\$m\$([\s\S]*?)\$m\$::jsonb,\s*\n\s*\$c\$([\s\S]*?)\$c\$::jsonb/g;
  let m;
  while ((m = re.exec(sql))) {
    defs[m[1]] = { key: m[1], label: m[1], match: JSON.parse(m[2]), config: JSON.parse(m[3]) };
  }
  return defs;
}

// ── Échantillon réel (activity_logs, 27/08/2026) ────────────
const ROWS = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/logs.json'), 'utf8'));

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${ok ? '' : ` — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`}`);
}

const defs = loadDefinitions();
check('6 définitions extraites', Object.keys(defs).length, 6);

const filter = def => ROWS.filter(r => actionMatches(r.action, def.match));
const kpi = (res, label) => res.kpis.find(k => k.label === label)?.value;

// ── Box des prix ────────────────────────────────────────────
{
  const def = defs.box_prix;
  const rows = filter(def);
  check('box_prix — lignes retenues', rows.length, 9);

  const res = aggregate(def, rows);
  check('box_prix — consultations', kpi(res, 'Consultations'), 7);
  check('box_prix — exports', kpi(res, 'Exports PDF'), 2);
  check('box_prix — taux (2/7)', kpi(res, 'Taux de transformation'), 29);
  check('box_prix — sales actifs', kpi(res, 'Sales actifs'), 3);
  check('box_prix — comptes clients', kpi(res, 'Comptes clients'), 7);

  const byUser = res.breakdowns.find(b => b.key === 'by_user');
  check('box_prix — 3 utilisateurs', byUser.rows.length, 3);
  const rb = byUser.rows.find(r => r.key === 'rbonnet@capitole-energie.com');
  check('box_prix — rbonnet volume', rb.count, 4);
  check('box_prix — rbonnet consultations', rb.cells.categories.value.consult, 3);
  check('box_prix — rbonnet exports', rb.cells.categories.value.export, 1);
  check('box_prix — rbonnet taux (1/3)', rb.cells.rate_export_consult.value, 33);
  check('box_prix — rbonnet comptes distincts', rb.cells['distinct_details.compte'].value, 3);
  check('box_prix — part rbonnet (4/9)', rb.cells.share.value, 44.4);

  const byCompte = res.breakdowns.find(b => b.key === 'by_compte');
  check('box_prix — comptes agrégés', byCompte.rows.length, 7);
  check('box_prix — top compte (ex aequo, ordre alpha)', byCompte.rows[0].key, '3A');

  check('box_prix — colonnes de détail', res.detail.columns.length, 7);
  check('box_prix — lignes de détail', res.detail.rows.length, 9);
  const firstRow = res.detail.rows[0];
  check('box_prix — type de la 1re ligne', firstRow.values[1].display, 'Export PDF');
  check('box_prix — compte de la 1re ligne', firstRow.values[3].display, 'LABORATOIRE INSPHY');
  check('box_prix — énergie en majuscules', firstRow.values[4].display, 'ELEC');
  check('box_prix — recherche indexée', firstRow.q.includes('laboratoire insphy'), true);
}

// ── Contrats GDB ────────────────────────────────────────────
{
  const def = defs.contrats_gdb;
  const rows = filter(def);
  check('contrats_gdb — lignes retenues', rows.length, 6);

  const res = aggregate(def, rows);
  check('contrats_gdb — total', kpi(res, 'Documents générés'), 6);
  check('contrats_gdb — contrats', kpi(res, 'Contrats GDB'), 5);
  check('contrats_gdb — retours de gain', kpi(res, 'Retours de gain'), 1);
  check('contrats_gdb — utilisateurs', kpi(res, 'Utilisateurs actifs'), 4);
  const byUser = res.breakdowns.find(b => b.key === 'by_user');
  check('contrats_gdb — 1er utilisateur (3 docs)', byUser.rows[0].count, 3);
  check('contrats_gdb — libellé de catégorie', res.detail.rows[0].values[1].display, 'Contrat GDB');
}

// ── Accès aux applications : extraction par regex ────────────
{
  const def = defs.acces_applications;
  const rows = filter(def);
  check('acces — lignes retenues', rows.length, 4);

  const res = aggregate(def, rows);
  check('acces — total', kpi(res, 'Accès'), 4);
  check('acces — applications distinctes', kpi(res, 'Applications utilisées'), 3);
  const byApp = res.breakdowns.find(b => b.key === 'by_app');
  check('acces — top application', byApp.rows[0].key, 'fournisseur');
  check('acces — volume top application', byApp.rows[0].count, 2);
}

// ── Fournisseurs transmis : tableau JSON éclaté ─────────────
{
  const def = defs.fournisseurs_transmis;
  const rows = filter(def);
  check('fournisseurs — lignes retenues', rows.length, 2);

  const res = aggregate(def, rows);
  check('fournisseurs — transmissions', kpi(res, 'Transmissions'), 2);
  check('fournisseurs — fournisseurs distincts', kpi(res, 'Fournisseurs distincts'), 8);
  check('fournisseurs — moyenne par transmission (3+6)/2', kpi(res, 'Moy. fournisseurs / transmission'), 4.5);
  const byF = res.breakdowns.find(b => b.key === 'by_fournisseur');
  check('fournisseurs — éclatement du tableau', byF.rows.length, 8);
  check('fournisseurs — fournisseur commun', byF.rows[0].key, 'ENDESA');
  check('fournisseurs — volume du commun', byF.rows[0].count, 2);
  check('fournisseurs — liste en détail',
    res.detail.rows[0].values[3].list.length, 3);
  check('fournisseurs — recherche sur la référence',
    res.detail.rows[0].q.includes('opp-00025021'), true);
}

// ── Contrats MINT : le préfixe ne doit pas attraper les GDB ──
{
  const def = defs.contrats_mint;
  const rows = filter(def);
  check('contrats_mint — lignes retenues (GDB exclus)', rows.length, 2);
  const res = aggregate(def, rows);
  check('contrats_mint — total', kpi(res, 'Contrats générés'), 2);
  check('contrats_mint — moyenne / utilisateur', kpi(res, 'Moyenne / utilisateur'), 1);
  const bySeg = res.breakdowns.find(b => b.key === 'by_segment');
  check('contrats_mint — segments', bySeg.rows.map(r => r.key).sort(), ['C4', 'MULTI']);
}

// ── Import Odoo : taux rapporté au total, sommes, fichiers ──
{
  const def = defs.odoo_import;
  const rows = filter(def);
  check('odoo — lignes retenues', rows.length, 4);

  const res = aggregate(def, rows);
  check('odoo — transformations', kpi(res, 'Transformations'), 4);
  check('odoo — réussies', kpi(res, 'Réussies'), 3);
  check('odoo — en erreur', kpi(res, 'En erreur'), 1);
  check('odoo — taux d\'erreur (1/4)', kpi(res, "Taux d'erreur"), 25);
  check('odoo — lignes générées (1243+412+297)', kpi(res, 'Lignes générées'), 1952);
  check('odoo — moyenne lignes / fichier (1952/4)', kpi(res, 'Moy. lignes / fichier'), 488);
  check('odoo — utilisateurs', kpi(res, 'Utilisateurs actifs'), 2);

  const byUser = res.breakdowns.find(b => b.key === 'by_user');
  const dl = byUser.rows.find(r => r.key === 'dlauger@capitole-energie.com');
  check('odoo — dlauger volume', dl.count, 3);
  check('odoo — dlauger taux d\'erreur (1/3)', dl.cells.rate_erreur___total.value, 33);
  check('odoo — dlauger lignes générées (1243+297)', dl.cells['sum_details.rows_out'].value, 1540);

  const byError = res.breakdowns.find(b => b.key === 'by_error');
  check('odoo — une seule erreur listée', byError.rows.length, 1);
  check('odoo — libellé de l\'erreur', byError.rows[0].key, 'Colonne « ref_client » absente du fichier source');

  // Colonne fichier
  const fichier = res.detail.rows[0].values[3];
  check('odoo — nom du fichier', fichier.display, 'import_odoo_clients_2026-08-28.csv');
  check('odoo — chemin de stockage exposé', fichier.path, '2026/08/2026-08-28T09-00-00-000Z_import_odoo_clients.csv');
  check('odoo — taille', fichier.size, 48211);
  const purge = res.detail.rows.find(r => r.values[3].purged);
  check('odoo — fichier purgé sans chemin', purge.values[3].path, null);
  const erreur = res.detail.rows.find(r => r.category === 'erreur');
  check('odoo — ligne en erreur : nom du source, pas de fichier à télécharger',
    [erreur.values[3].display, erreur.values[3].path, !!erreur.values[3].purged],
    ['clients_juin.xlsx', null, false]);
}

// ── Série temporelle du graphique ───────────────────────────
{
  const def = defs.box_prix;
  const rows = filter(def);

  const jour = aggregate(def, rows, false, { days: 7 });
  check('série — pas journalier sur 7 jours', jour.timeseries.pas, 'day');
  check('série — trous comblés à zéro',
    jour.timeseries.points.every(p => typeof p.total === 'number'), true);
  check('série — total conservé',
    jour.timeseries.points.reduce((s, p) => s + p.total, 0), rows.length);
  check('série — points ordonnés',
    jour.timeseries.points.map(p => p.cle).join() ===
    jour.timeseries.points.map(p => p.cle).sort().join(), true);
  check('série — catégories ventilées par point',
    jour.timeseries.points.some(p => p.categories.export > 0), true);

  const semaine = aggregate(def, rows, false, { days: 90 });
  check('série — pas hebdomadaire sur 3 mois', semaine.timeseries.pas, 'week');
  const mois = aggregate(def, rows, false, { days: 0 });
  check('série — pas mensuel sur tout l\'historique', mois.timeseries.pas, 'month');
  check('série — maximum cohérent',
    mois.timeseries.max, Math.max(...mois.timeseries.points.map(p => p.total)));
}

// ── Accès aux champs ────────────────────────────────────────
{
  const row = { email: 'a@b.c', action: 'Accès à l\'application "box-prix"', details: { segment: ' c4 ', liste: ['x', 'y'] } };
  check('champ simple', fieldValue(row, { field: 'email' }), 'a@b.c');
  check('champ imbriqué + majuscules', fieldValue(row, { field: 'details.segment', transform: 'upper' }), 'C4');
  check('extraction regex', fieldValue(row, { field: 'action', extract: '"([^"]+)"' }), 'box-prix');
  check('tableau joint', fieldValue(row, { field: 'details.liste' }), 'x, y');
  check('tableau éclaté', fieldValues(row, { field: 'details.liste', multi: true }), ['x', 'y']);
  check('valeur de repli', fieldValue(row, { field: 'details.absent', fallback: 'N/A' }), 'N/A');
  check('préfixe', actionMatches('Contrat généré — x.docx', { mode: 'prefix', values: ['Contrat généré'] }), true);
  check('préfixe non confondu avec GDB',
    actionMatches('Contrat GDB généré — x.docx', { mode: 'prefix', values: ['Contrat généré'] }), false);
}

console.log(failures ? `\n${failures} contrôle(s) en échec` : '\nTous les contrôles passent');
process.exit(failures ? 1 : 0);
