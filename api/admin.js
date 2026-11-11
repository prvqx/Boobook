// /api/admin — the proctor dashboard: live monitoring, proctor actions, tests, accounts.
import { handler, json, readBody, queryParams, HttpError } from '../lib/http.js';
import { requireAdmin, hashPassword } from '../lib/auth.js';
import { q, one, ms } from '../lib/db.js';
import { normalizeTest, scoreAttempt, isCorrect } from '../lib/testdef.js';
import { listImages, putImage, deleteImage, imageExists, missingImages, IMAGE_TYPES, validImageName } from '../lib/images.js';
import {
  getTestDef, forgetTest, listAttempts, loadAttempt, mutate, summarize, advance, logEvent,
} from '../lib/attempts.js';

export default handler(async (request) => {
  const admin = await requireAdmin(request);
  const params = queryParams(request);
  const body = request.method === 'POST' ? await readBody(request) : {};
  const action = body.action || params.get('action');

  switch (action) {
    // ---- live monitoring
    case 'live':
      return live(Number(params.get('since')) || 0);
    case 'attempt':
      return attemptDetail(params.get('id'));
    // ---- proctor actions on one test taker
    case 'message':
      return sendMessage(admin, body);
    case 'addTime':
      return addTime(admin, body);
    case 'endSection':
      return endSection(admin, body);
    case 'endExam':
      return endExam(admin, body);
    case 'allowResume':
      return allowResume(admin, body);
    case 'reset':
      return resetAttempt(admin, body);
    // ---- tests
    case 'tests':
      return listTests();
    case 'testJson':
      return testJson(params.get('id'));
    case 'saveTest':
      return saveTest(body);
    case 'setTestOpen':
      return setTestOpen(body);
    case 'setStartCode':
      return setStartCode(body);
    case 'deleteTest':
      return deleteTest(body);
    // ---- images
    case 'images':
      return imagesList();
    case 'uploadImage':
      return uploadImage(body);
    case 'deleteImage':
      return removeImage(body);
    // ---- accounts
    case 'users':
      return listUsers();
    case 'addUser':
      return addUser(body);
    case 'deleteUser':
      return deleteUser(admin, body);
    case 'setPassword':
      return setPassword(body);
    default:
      throw new HttpError(400, 'Unknown action.');
  }
});

// ---------------------------------------------------------------- live
async function live(since) {
  const now = Date.now();
  const rows = await listAttempts();
  const attempts = [];
  for (const at of rows) {
    const def = await getTestDef(at.test_id, at.test_updated_at);
    const prev = { phase: at.phase, status: at.status, section_index: at.section_index };
    const events = advance(at, def, now);
    if (events.length) {
      // Persist expired timers (e.g. someone closed their laptop and time ran out).
      const ok = await q(
        `update attempts set status=$2, phase=$3, section_index=$4, break_ends_at=$5, completed_at=$6, version=version+1
          where id=$1 and status=$7 and phase=$8 and section_index=$9 returning id`,
        [at.id, at.status, at.phase, at.section_index, at.break_ends_at ? new Date(at.break_ends_at).toISOString() : null,
          at.completed_at ? new Date(at.completed_at).toISOString() : null, prev.status, prev.phase, prev.section_index]
      );
      if (ok.length) for (const e of events) await logEvent(at.id, at.user_id, e.type, e.section_index, null, null);
    }
    attempts.push(summarize(at, def, now));
  }
  const evRows = since > 0
    ? await q(
        `select e.*, u.display_name, u.username from events e left join users u on u.id = e.user_id
          where e.id > $1 order by e.id asc limit 200`,
        [since]
      )
    : await q(
        `select * from (select e.*, u.display_name, u.username from events e left join users u on u.id = e.user_id
          order by e.id desc limit 80) x order by id asc`
      );
  return json({ now, attempts, events: evRows.map(publicEvent) });
}

function publicEvent(e) {
  return {
    id: e.id,
    attemptId: e.attempt_id,
    userId: e.user_id,
    name: e.display_name || e.username || 'Unknown',
    type: e.type,
    section: e.section_index,
    question: e.question,
    detail: e.detail || null,
    at: ms(e.created_at),
  };
}

async function attemptDetail(id) {
  const at = await loadAttempt(id);
  if (!at) throw new HttpError(404, 'Attempt not found.');
  const def = await getTestDef(at.test_id, at.test_updated_at);
  const now = Date.now();
  advance(at, def, now);
  const events = await q(
    `select e.*, u.display_name, u.username from events e left join users u on u.id = e.user_id
      where e.attempt_id = $1 order by e.id asc`,
    [at.id]
  );
  return json({
    now,
    summary: summarize(at, def, now),
    answers: at.answers || {},
    view: at.view || {},
    test: def,
    score: scoreAttempt(def, at.answers || {}),
    correct: Object.fromEntries(
      def.sections.flatMap((s) => s.questions).filter((q) => q.answer).map((q) => [q.id, isCorrect(q, (at.answers || {})[q.id])])
    ),
    events: events.map(publicEvent),
  });
}

// ---------------------------------------------------------------- proctor actions
async function sendMessage(admin, body) {
  const text = String(body.text || '').trim().slice(0, 1000);
  if (!text) throw new HttpError(400, 'Type a message first.');
  const rows = await q(
    `update attempts set message = $2, message_id = message_id + 1 where id = $1 returning id, user_id, section_index`,
    [Number(body.attemptId), text]
  );
  if (!rows.length) throw new HttpError(404, 'Attempt not found.');
  await logEvent(rows[0].id, rows[0].user_id, 'proctor_message', rows[0].section_index, null, { text });
  return json({ ok: true });
}

async function addTime(admin, body) {
  const minutes = Number(body.minutes);
  if (!Number.isFinite(minutes) || minutes === 0 || Math.abs(minutes) > 600) throw new HttpError(400, 'Enter a number of minutes.');
  const { at } = await mutate(body.attemptId, {
    change(at, def, now) {
      if (at.phase === 'section' && at.section_ends_at) {
        at.section_ends_at = new Date(Math.max(now, ms(at.section_ends_at) + minutes * 60_000));
      } else if (at.phase === 'break' && at.break_ends_at) {
        at.break_ends_at = new Date(Math.max(now, ms(at.break_ends_at) + minutes * 60_000));
      } else {
        throw new HttpError(409, 'Time can only be changed during a section or a break.');
      }
      return [{ type: 'proctor_time', section_index: at.section_index, detail: { minutes } }];
    },
  });
  return json({ ok: true, status: at.status });
}

async function endSection(admin, body) {
  await mutate(body.attemptId, {
    change(at, def, now) {
      if (at.status !== 'active') throw new HttpError(409, 'This exam is not active.');
      if (at.phase === 'section') at.section_ends_at = new Date(now);
      else if (at.phase === 'break') at.break_ends_at = new Date(now);
      else if (at.phase === 'directions') {
        at.phase = 'section';
        at.section_ends_at = new Date(now);
      }
      return [{ type: 'proctor_end_section', section_index: at.section_index }];
    },
  });
  return json({ ok: true });
}

async function endExam(admin, body) {
  await mutate(body.attemptId, {
    change(at, def, now) {
      if (at.status === 'completed') return [];
      at.status = 'completed';
      at.phase = 'done';
      at.completed_at = new Date(now);
      at.paused_at = null;
      return [{ type: 'proctor_end_exam', section_index: at.section_index }];
    },
  });
  return json({ ok: true });
}

async function allowResume(admin, body) {
  await mutate(body.attemptId, {
    change(at, def, now) {
      if (at.status !== 'paused') throw new HttpError(409, "This exam isn't paused.");
      const pausedFor = at.paused_at ? now - ms(at.paused_at) : 0;
      if (at.phase === 'section' && at.section_ends_at) at.section_ends_at = new Date(ms(at.section_ends_at) + pausedFor);
      if (at.phase === 'break' && at.break_ends_at) at.break_ends_at = new Date(ms(at.break_ends_at) + pausedFor);
      at.status = 'active';
      at.paused_at = null;
      return [{ type: 'proctor_resume', section_index: at.section_index }];
    },
  });
  return json({ ok: true });
}

async function resetAttempt(admin, body) {
  const rows = await q('delete from attempts where id = $1 returning id', [Number(body.attemptId)]);
  if (!rows.length) throw new HttpError(404, 'Attempt not found.');
  return json({ ok: true });
}

// ---------------------------------------------------------------- tests
async function listTests() {
  const rows = await q(
    `select t.id, t.title, t.definition, t.is_open, t.start_code, t.created_at, t.updated_at,
            (select count(*)::int from attempts a where a.test_id = t.id) as attempts,
            (select count(*)::int from attempts a where a.test_id = t.id and a.status = 'completed') as completed
       from tests t order by t.created_at asc`
  );
  return json({
    tests: rows.map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.definition.subtitle || null,
      open: r.is_open,
      startCode: r.start_code || '',
      attempts: r.attempts,
      completed: r.completed,
      updatedAt: ms(r.updated_at),
      sections: r.definition.sections.map((s) => ({
        title: s.title, type: s.type, minutes: s.minutes, count: s.questions.length,
        breakAfterMinutes: s.breakAfterMinutes, keyed: s.questions.filter((x) => x.answer).length,
      })),
    })),
  });
}

async function testJson(id) {
  const row = await one('select definition from tests where id = $1', [String(id || '')]);
  if (!row) throw new HttpError(404, 'Test not found.');
  return json({ definition: row.definition });
}

async function saveTest(body) {
  let raw = body.definition;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (e) {
      throw new HttpError(400, `That isn't valid JSON: ${e.message}`);
    }
  }
  const { def, errors, imageNames } = normalizeTest(raw);
  if (errors.length) return json({ ok: false, errors }, 422);
  const missing = await missingImages(imageNames || []);
  const warnings = missing.map((n) => `Image "${n}" hasn't been uploaded yet (Images tab). It will show as broken until you upload it.`);
  const existing = await one('select id from tests where id = $1', [def.id]);
  if (existing && !body.overwrite) {
    return json({ ok: false, exists: true, errors: [`A test with id "${def.id}" already exists. Replace it?`] }, 409);
  }
  await q(
    `insert into tests (id, title, definition) values ($1, $2, $3::jsonb)
     on conflict (id) do update set title = excluded.title, definition = excluded.definition, updated_at = now()`,
    [def.id, def.title, JSON.stringify(def)]
  );
  forgetTest(def.id);
  return json({ ok: true, id: def.id, replaced: !!existing, warnings });
}

async function setTestOpen(body) {
  const rows = await q('update tests set is_open = $2 where id = $1 returning id', [String(body.id), !!body.open]);
  if (!rows.length) throw new HttpError(404, 'Test not found.');
  return json({ ok: true });
}

async function setStartCode(body) {
  const code = String(body.code || '').trim().toUpperCase().slice(0, 12);
  if (code && !/^[A-Z0-9]+$/.test(code)) throw new HttpError(400, 'Start codes can only use letters and numbers.');
  const rows = await q('update tests set start_code = $2 where id = $1 returning id', [String(body.id), code || null]);
  if (!rows.length) throw new HttpError(404, 'Test not found.');
  return json({ ok: true, code });
}

async function deleteTest(body) {
  const rows = await q('delete from tests where id = $1 returning id', [String(body.id)]);
  if (!rows.length) throw new HttpError(404, 'Test not found.');
  forgetTest(String(body.id));
  return json({ ok: true });
}

// ---------------------------------------------------------------- images
async function imagesList() {
  const rows = await listImages();
  return json({
    images: rows.map((r) => ({ name: r.name, mime: r.mime, size: r.size, width: r.width, height: r.height, createdAt: ms(r.created_at) })),
  });
}

async function uploadImage(body) {
  const name = String(body.name || '').trim();
  if (!validImageName(name)) throw new HttpError(400, 'Image names can use letters, numbers, dots, dashes and underscores (no spaces).');
  const m = /^data:([a-z+/.-]+);base64,(.+)$/i.exec(String(body.data || ''));
  if (!m) throw new HttpError(400, "That file couldn't be read as an image.");
  const mime = m[1].toLowerCase();
  if (!IMAGE_TYPES.has(mime)) throw new HttpError(400, 'Use a PNG, JPG, GIF, WebP or SVG image.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3_000_000) throw new HttpError(413, 'That image is over 3 MB. Try a smaller or compressed version.');
  if (!body.overwrite && (await imageExists(name))) {
    return json({ ok: false, exists: true, error: `An image named "${name}" already exists. Replace it?` }, 409);
  }
  await putImage(name, mime, buf, Number(body.width) || null, Number(body.height) || null);
  return json({ ok: true, name });
}

async function removeImage(body) {
  if (!(await deleteImage(String(body.name || '')))) throw new HttpError(404, 'Image not found.');
  return json({ ok: true });
}

// ---------------------------------------------------------------- accounts
async function listUsers() {
  const rows = await q(
    `select u.id, u.username, u.display_name, u.role, u.created_at,
            (select max(s.created_at) from sessions s where s.user_id = u.id) as last_sign_in
       from users u order by u.role desc, lower(u.display_name)`
  );
  return json({
    users: rows.map((u) => ({
      id: u.id, username: u.username, name: u.display_name, role: u.role,
      createdAt: ms(u.created_at), lastSignIn: ms(u.last_sign_in),
    })),
  });
}

async function addUser(body) {
  const username = String(body.username || '').trim();
  const name = String(body.name || '').trim() || username;
  const password = String(body.password || '');
  const role = body.role === 'admin' ? 'admin' : 'student';
  if (!/^[A-Za-z0-9._@-]{2,60}$/.test(username)) {
    throw new HttpError(400, 'Usernames need 2–60 characters: letters, numbers, dots, dashes, underscores or @.');
  }
  if (password.length < 4) throw new HttpError(400, 'Use a password with at least 4 characters.');
  const exists = await one('select id from users where lower(username) = lower($1)', [username]);
  if (exists) throw new HttpError(409, `The username "${username}" is already taken.`);
  await q('insert into users (username, display_name, password_hash, role) values ($1, $2, $3, $4)', [
    username, name, await hashPassword(password), role,
  ]);
  return json({ ok: true });
}

async function deleteUser(admin, body) {
  const id = Number(body.id);
  if (id === admin.id) throw new HttpError(400, "You can't delete the account you're signed in with.");
  const rows = await q('delete from users where id = $1 returning id', [id]);
  if (!rows.length) throw new HttpError(404, 'Account not found.');
  return json({ ok: true });
}

async function setPassword(body) {
  const password = String(body.password || '');
  if (password.length < 4) throw new HttpError(400, 'Use a password with at least 4 characters.');
  const rows = await q('update users set password_hash = $2 where id = $1 returning id', [Number(body.id), await hashPassword(password)]);
  if (!rows.length) throw new HttpError(404, 'Account not found.');
  await q('delete from sessions where user_id = $1', [Number(body.id)]);
  return json({ ok: true });
}
