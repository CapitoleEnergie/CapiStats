import { requireSession } from './_lib/session.js';
import { resolveAccess, emailsForScope } from './_lib/access.js';
import { computeStats } from './_lib/engine.js';

const PERIODS = [0, 7, 30, 90, 180, 365];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const session = requireSession(req, res);
  if (!session) return;

  try {
    const { definition: key, days = 7, email = null } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Définition manquante.' });
    if (!PERIODS.includes(Number(days))) return res.status(400).json({ error: 'Période invalide.' });

    const { profile, definitions } = await resolveAccess(session);
    if (!profile) return res.status(403).json({ error: 'Profil introuvable.' });

    const definition = definitions.find(d => d.key === key);
    if (!definition) return res.status(403).json({ error: 'Cette statistique ne fait pas partie de ton périmètre.' });

    // Périmètre : la restriction serveur prime toujours sur le filtre demandé
    const allowed = await emailsForScope(profile, definition.scope);
    let filters = { days: Number(days) };
    if (allowed) {
      if (email && !allowed.includes(email)) {
        return res.status(403).json({ error: 'Utilisateur hors de ton périmètre.' });
      }
      filters = email ? { ...filters, email } : { ...filters, emails: allowed };
    } else if (email) {
      filters = { ...filters, email };
    }

    const result = await computeStats(definition, filters);
    result.scope = definition.scope;
    return res.status(200).json({ success: true, result });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erreur serveur.' });
  }
}
