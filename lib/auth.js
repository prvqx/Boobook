import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { q, one } from './db.js';
import { HttpError, getCookie, setCookie } from './http.js';

export const COOKIE = 'mx_session';
const SESSION_DAYS = 7;
let dummyHash = null;

export async function verifyLogin(username, password) {
  const name = String(username || '').trim();
  if (!name || !password) return null;
  const user = await one(
    'select id, username, display_name, password_hash, role from users where lower(username) = lower($1)',
    [name]
  );
  if (!user) {
    // Spend similar time as a real check so usernames can't be probed by timing.
    dummyHash = dummyHash || bcrypt.hashSync('not-a-real-password', 10);
    await bcrypt.compare(String(password), dummyHash);
    return null;
  }
  let ok = false;
  try {
    ok = await bcrypt.compare(String(password), user.password_hash);
  } catch {
    ok = false;
  }
  return ok ? user : null;
}

export async function createSession(request, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await q('insert into sessions (token, user_id, expires_at) values ($1, $2, $3)', [token, userId, expires]);
  // Opportunistic cleanup of old sessions.
  await q('delete from sessions where expires_at < now()');
  return setCookie(request, COOKIE, token, SESSION_DAYS * 86400);
}

export async function destroySession(request) {
  const token = getCookie(request, COOKIE);
  if (token) await q('delete from sessions where token = $1', [token]);
  return setCookie(request, COOKIE, '', 0);
}

export async function currentUser(request) {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  return one(
    `select u.id, u.username, u.display_name, u.role
       from sessions s join users u on u.id = s.user_id
      where s.token = $1 and s.expires_at > now()`,
    [token]
  );
}

export async function requireUser(request) {
  const user = await currentUser(request);
  if (!user) throw new HttpError(401, 'Please sign in.');
  return user;
}

export async function requireAdmin(request) {
  const user = await requireUser(request);
  if (user.role !== 'admin') throw new HttpError(403, 'Proctor access only.');
  return user;
}

export function hashPassword(password) {
  return bcrypt.hash(String(password), 10);
}

export function publicUser(u) {
  return u ? { id: u.id, username: u.username, name: u.display_name, role: u.role } : null;
}
