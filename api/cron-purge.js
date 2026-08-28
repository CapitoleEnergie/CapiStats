import { admin } from './_lib/supabase.js';

const BUCKET = 'odoo-imports';
const RETENTION_JOURS = 90;
const LOT = 100;

/**
 * Purge des fichiers Import Odoo au-delà de la durée de conservation.
 * Déclenché par le cron Vercel (voir vercel.json), une fois par jour.
 *
 * Les lignes de statistiques sont conservées : seul le fichier est supprimé,
 * et la ligne est marquée file_purged pour que l'interface l'indique.
 */
export default async function handler(req, res) {
  // Vercel envoie « Authorization: Bearer $CRON_SECRET » quand la variable existe
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  try {
    const sb = admin();
    const limite = new Date(Date.now() - RETENTION_JOURS * 86400_000).toISOString();

    const { data: rows, error } = await sb
      .from('activity_logs')
      .select('id, details')
      .like('action', 'Import Odoo%')
      .lt('created_at', limite)
      .limit(LOT);
    if (error) throw error;

    const aPurger = (rows || []).filter(r => r.details?.path && r.details?.file_purged !== true);
    if (!aPurger.length) {
      return res.status(200).json({ success: true, supprimes: 0, restants: 0 });
    }

    const chemins = aPurger.map(r => r.details.path);
    const { error: removeError } = await sb.storage.from(BUCKET).remove(chemins);
    // Un fichier déjà absent ne doit pas bloquer le marquage
    if (removeError) console.error('purge storage:', removeError.message);

    for (const row of aPurger) {
      await sb
        .from('activity_logs')
        .update({ details: { ...row.details, file_purged: true } })
        .eq('id', row.id);
    }

    return res.status(200).json({
      success: true,
      supprimes: aPurger.length,
      restants: (rows || []).length === LOT ? 'lot suivant au prochain passage' : 0
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erreur serveur.' });
  }
}
