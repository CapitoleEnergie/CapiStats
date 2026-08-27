import { admin } from './_lib/supabase.js';
import { requireSession } from './_lib/session.js';
import { resolveAccess } from './_lib/access.js';

const SCOPES = ['all', 'cellule', 'self'];

/**
 * Administration de la matrice « rôle stats × définition ».
 * POST { role_key, definition_key, enabled, scope }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const session = requireSession(req, res);
  if (!session) return;

  try {
    const { isAdmin, profile } = await resolveAccess(session);
    if (!isAdmin) return res.status(403).json({ error: 'Accès administrateur requis.' });

    const { role_key, definition_key, enabled, scope = 'all' } = req.body || {};
    if (!role_key || !definition_key) {
      return res.status(400).json({ error: 'role_key et definition_key requis.' });
    }
    if (!SCOPES.includes(scope)) return res.status(400).json({ error: 'Périmètre invalide.' });

    if (enabled) {
      const { error } = await admin()
        .from('stats_role_access')
        .upsert({ role_key, definition_key, scope }, { onConflict: 'role_key,definition_key' });
      if (error) throw error;
    } else {
      const { error } = await admin()
        .from('stats_role_access')
        .delete()
        .eq('role_key', role_key)
        .eq('definition_key', definition_key);
      if (error) throw error;
    }

    await admin().from('activity_logs').insert({
      email: profile.email,
      action: 'stats_access_updated',
      details: { role_key, definition_key, enabled: !!enabled, scope },
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erreur serveur.' });
  }
}
