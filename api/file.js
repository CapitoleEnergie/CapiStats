import { admin } from './_lib/supabase.js';
import { requireSession } from './_lib/session.js';
import { resolveAccess } from './_lib/access.js';

const BUCKET = 'odoo-imports';
const LIEN_VALIDE_SECONDES = 60;

/**
 * Lien de téléchargement signé pour un fichier généré par Import Odoo.
 * POST { path } -> { url, filename }
 *
 * Règle d'accès : l'auteur du fichier et les administrateurs, uniquement.
 * Voir une statistique ne donne pas le droit d'ouvrir les fichiers des autres.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const session = requireSession(req, res);
  if (!session) return;

  try {
    const { path } = req.body || {};
    if (!path || typeof path !== 'string') {
      return res.status(400).json({ error: 'Chemin de fichier manquant.' });
    }

    const { profile, isAdmin, definitions } = await resolveAccess(session);
    if (!profile) return res.status(403).json({ error: 'Profil introuvable.' });

    // Le bloc Import Odoo doit faire partie du périmètre de l'utilisateur
    if (!isAdmin && !definitions.some(d => d.key === 'odoo_import')) {
      return res.status(403).json({ error: 'Les imports Odoo ne font pas partie de ton périmètre.' });
    }

    const sb = admin();

    // Le fichier doit correspondre à une ligne de journal connue
    const { data: entry, error } = await sb
      .from('activity_logs')
      .select('email, details, created_at')
      .like('action', 'Import Odoo%')
      .eq('details->>path', path)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    if (!entry) return res.status(404).json({ error: 'Fichier introuvable.' });
    if (entry.details?.file_purged) {
      return res.status(410).json({ error: 'Fichier purgé (conservation de 90 jours dépassée).' });
    }

    // Auteur ou administrateur
    if (!isAdmin && entry.email !== profile.email) {
      return res.status(403).json({
        error: 'Ce fichier appartient à un autre utilisateur. Seuls son auteur et les administrateurs peuvent le télécharger.'
      });
    }

    const { data: signed, error: signError } = await sb
      .storage
      .from(BUCKET)
      .createSignedUrl(path, LIEN_VALIDE_SECONDES, {
        download: entry.details?.filename || true
      });
    if (signError || !signed?.signedUrl) {
      return res.status(404).json({ error: 'Fichier absent du stockage.' });
    }

    await sb.from('activity_logs').insert({
      email: profile.email,
      action: 'Fichier Odoo téléchargé',
      details: { path, filename: entry.details?.filename || null, auteur: entry.email }
    });

    return res.status(200).json({
      success: true,
      url: signed.signedUrl,
      filename: entry.details?.filename || 'import-odoo'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erreur serveur.' });
  }
}
