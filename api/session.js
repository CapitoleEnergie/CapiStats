import { admin } from './_lib/supabase.js';
import { setSessionCookie, readSession, clearSessionCookie } from './_lib/session.js';

const SLUG = 'stats';

export default async function handler(req, res) {
  // ── Session courante ───────────────────────────────────────
  if (req.method === 'GET') {
    const session = readSession(req);
    if (!session) return res.status(401).json({ error: 'Aucune session.' });
    return res.status(200).json({ success: true, session: { email: session.email, role: session.role } });
  }

  // ── Déconnexion ────────────────────────────────────────────
  if (req.method === 'DELETE') {
    clearSessionCookie(res);
    return res.status(200).json({ success: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Token d\'accès manquant.' });

    const hubUrl = (process.env.HUB_URL || '').replace(/\/+$/, '');
    if (!hubUrl) return res.status(500).json({ error: 'HUB_URL non configurée.' });

    // 1. Consommer le token à usage unique auprès du hub (source de vérité)
    const verify = await fetch(`${hubUrl}/api/verify-app-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, slug: SLUG }),
    });
    const verified = await verify.json().catch(() => ({}));

    if (!verify.ok || !verified?.email) {
      return res.status(401).json({ error: verified?.error || 'Token invalide ou expiré.' });
    }

    // 2. Profil complet (rôle admin + rôle stats) côté base
    const { data: profile, error } = await admin()
      .from('profiles')
      .select('email, role, cellule, stats_role')
      .eq('email', verified.email)
      .maybeSingle();
    if (error) throw error;
    if (!profile) return res.status(403).json({ error: 'Profil introuvable.' });

    if (profile.role !== 'admin' && !profile.stats_role) {
      return res.status(403).json({
        error: 'Aucun rôle statistiques ne t\'est attribué. Demande à un administrateur de te positionner un rôle (Direction, Resp Commercial, Resp ADV, Resp Partenaire ou Resp Pricing).',
      });
    }

    setSessionCookie(res, {
      email: profile.email,
      role: profile.role,
      cellule: profile.cellule,
      stats_role: profile.stats_role,
    });

    await admin().from('activity_logs').insert({
      email: profile.email,
      action: 'Statistiques consultées',
      details: { stats_role: profile.stats_role || 'admin' },
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erreur serveur.' });
  }
}
