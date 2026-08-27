import { admin } from './_lib/supabase.js';
import { requireSession } from './_lib/session.js';
import { resolveAccess } from './_lib/access.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' });

  const session = requireSession(req, res);
  if (!session) return;

  try {
    const { profile, isAdmin, definitions } = await resolveAccess(session);
    if (!profile) return res.status(403).json({ error: 'Profil introuvable.' });

    // Liste des utilisateurs pour le filtre — seulement si un périmètre global existe
    let users = [];
    if (definitions.some(d => d.scope === 'all')) {
      const { data } = await admin().from('profiles').select('email').order('email');
      users = (data || []).map(u => u.email).filter(Boolean);
    } else if (definitions.some(d => d.scope === 'cellule') && profile.cellule) {
      const { data } = await admin().from('profiles').select('email').eq('cellule', profile.cellule).order('email');
      users = (data || []).map(u => u.email).filter(Boolean);
    } else {
      users = [profile.email];
    }

    const payload = {
      success: true,
      hub_url: (process.env.HUB_URL || '').replace(/\/+$/, ''),
      user: {
        email: profile.email,
        role: profile.role,
        cellule: profile.cellule,
        stats_role: profile.stats_role,
        is_admin: isAdmin,
      },
      definitions: definitions.map(d => ({
        key: d.key, label: d.label, description: d.description,
        icon: d.icon, app_slug: d.app_slug, scope: d.scope,
      })),
      users,
    };

    // Panneau d'administration : matrice rôles × définitions
    if (isAdmin) {
      const [roles, allDefs, access] = await Promise.all([
        admin().from('stats_roles').select('key, label, sort_order, active').order('sort_order'),
        admin().from('stats_definitions').select('key, label, icon, app_slug, active, sort_order').order('sort_order'),
        admin().from('stats_role_access').select('role_key, definition_key, scope'),
      ]);
      payload.admin = {
        roles: roles.data || [],
        definitions: allDefs.data || [],
        access: access.data || [],
      };
    }

    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erreur serveur.' });
  }
}
