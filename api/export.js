import { requireSession } from './_lib/session.js';
import { resolveAccess, emailsForScope } from './_lib/access.js';
import { computeStats } from './_lib/engine.js';

/**
 * Renvoie, pour chaque définition demandée, un jeu de lignes prêt à écrire
 * dans une feuille Excel. Le classeur est assemblé côté navigateur.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const session = requireSession(req, res);
  if (!session) return;

  try {
    const { days = 7, email = null, definitions: keys = null } = req.body || {};
    const { profile, definitions } = await resolveAccess(session);
    if (!profile) return res.status(403).json({ error: 'Profil introuvable.' });

    const targets = keys?.length ? definitions.filter(d => keys.includes(d.key)) : definitions;
    if (!targets.length) return res.status(400).json({ error: 'Aucune statistique à exporter.' });

    const sheets = [];
    for (const definition of targets) {
      const allowed = await emailsForScope(profile, definition.scope);
      let filters = { days: Number(days) };
      if (allowed) {
        if (email && !allowed.includes(email)) continue;
        filters = email ? { ...filters, email } : { ...filters, emails: allowed };
      } else if (email) {
        filters = { ...filters, email };
      }

      const result = await computeStats(definition, filters);
      sheets.push({
        name: definition.label.slice(0, 31),
        headers: result.detail.columns.map(c => c.label),
        rows: result.detail.rows.map(r => r.values.map(v => v.display)),
        total: result.total,
      });
    }

    return res.status(200).json({ success: true, sheets, days, email });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erreur serveur.' });
  }
}
