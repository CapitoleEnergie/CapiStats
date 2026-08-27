import crypto from 'crypto';

const COOKIE_NAME = 'capitole_stats_session';
const TTL_SECONDS = 8 * 60 * 60; // 8 h

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 24) {
    throw new Error('SESSION_SECRET manquant ou trop court (32 caractères minimum).');
  }
  return s;
}

const b64u = {
  encode: obj => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url'),
  decode: str => JSON.parse(Buffer.from(str, 'base64url').toString('utf8')),
};

function hmac(data) {
  return crypto.createHmac('sha256', secret()).update(data).digest('base64url');
}

/** Signe une session { email, role, cellule, stats_role }. */
export function signSession(payload) {
  const body = b64u.encode({ ...payload, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS });
  return `${body}.${hmac(body)}`;
}

/** Renvoie la session si le cookie est valide et non expiré, sinon null. */
export function readSession(req) {
  const raw = (req.headers.cookie || '')
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(`${COOKIE_NAME}=`));
  if (!raw) return null;

  const value = decodeURIComponent(raw.slice(COOKIE_NAME.length + 1));
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;

  const expected = hmac(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try { payload = b64u.decode(body); } catch { return null; }
  if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function setSessionCookie(res, payload) {
  const token = encodeURIComponent(signSession(payload));
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_SECONDS}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

/** Garde-fou : renvoie la session ou répond 401 et renvoie null. */
export function requireSession(req, res) {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: 'Session expirée. Retourne sur le hub pour te reconnecter.' });
    return null;
  }
  return session;
}
