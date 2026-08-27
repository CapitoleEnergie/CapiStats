import { admin } from './supabase.js';

/**
 * Résout le périmètre d'un utilisateur :
 *  - admin (profiles.role = 'admin') : toutes les définitions actives, scope 'all'
 *  - sinon : définitions ouvertes à son stats_role, avec le scope déclaré
 *
 * scope :
 *  - 'all'     : tous les utilisateurs
 *  - 'cellule' : uniquement les emails de sa cellule
 *  - 'self'    : uniquement ses propres lignes
 */
export async function resolveAccess(session) {
  const sb = admin();

  // Profil frais en base : une révocation prend effet immédiatement,
  // sans attendre l'expiration du cookie.
  const { data: profile } = await sb
    .from('profiles')
    .select('email, role, cellule, stats_role')
    .eq('email', session.email)
    .maybeSingle();

  if (!profile) {
    return { profile: null, isAdmin: false, definitions: [], allowedEmails: null };
  }

  const isAdmin = profile.role === 'admin';

  const { data: definitions, error: defErr } = await sb
    .from('stats_definitions')
    .select('key, app_slug, label, description, icon, sort_order, match, config')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (defErr) throw defErr;

  let scoped = [];
  if (isAdmin) {
    scoped = (definitions || []).map(d => ({ ...d, scope: 'all' }));
  } else if (profile.stats_role) {
    const { data: access, error: accErr } = await sb
      .from('stats_role_access')
      .select('definition_key, scope')
      .eq('role_key', profile.stats_role);
    if (accErr) throw accErr;
    const byKey = new Map((access || []).map(a => [a.definition_key, a.scope]));
    scoped = (definitions || [])
      .filter(d => byKey.has(d.key))
      .map(d => ({ ...d, scope: byKey.get(d.key) || 'all' }));
  }

  return { profile, isAdmin, definitions: scoped };
}

/** Liste des emails visibles pour un scope donné (null = aucune restriction). */
export async function emailsForScope(profile, scope) {
  if (scope === 'self') return [profile.email];
  if (scope === 'cellule') {
    if (!profile.cellule) return [profile.email];
    const { data } = await admin()
      .from('profiles')
      .select('email')
      .eq('cellule', profile.cellule);
    const list = (data || []).map(p => p.email).filter(Boolean);
    return list.length ? list : [profile.email];
  }
  return null;
}
