import { createClient } from '@supabase/supabase-js';

let client = null;

/** Client Supabase avec la service role key — usage serveur uniquement. */
export function admin() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.');
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
