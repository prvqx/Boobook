// /api/auth — sign in, sign out, and "who am I?"
import { handler, json, readBody, HttpError } from '../lib/http.js';
import { verifyLogin, createSession, destroySession, currentUser, publicUser } from '../lib/auth.js';
import { logEvent } from '../lib/attempts.js';

export default handler(async (request) => {
  if (request.method === 'GET') {
    const user = await currentUser(request);
    return json({ user: publicUser(user) });
  }
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  const body = await readBody(request);

  if (body.action === 'login') {
    const user = await verifyLogin(body.username, body.password);
    if (!user) throw new HttpError(401, 'The username or password is incorrect.');
    const cookie = await createSession(request, user.id);
    await logEvent(null, user.id, 'sign_in');
    return json({ user: publicUser(user) }, 200, { 'set-cookie': cookie });
  }

  if (body.action === 'logout') {
    const cookie = await destroySession(request);
    return json({ ok: true }, 200, { 'set-cookie': cookie });
  }

  throw new HttpError(400, 'Unknown action.');
});
