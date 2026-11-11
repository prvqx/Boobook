// /api/exam — everything a test taker's browser does: list tests, start, load, save
// answers, move between sections, breaks, and report "left the tab" events.
import { handler, json, readBody, queryParams, HttpError } from '../lib/http.js';
import { requireUser, publicUser } from '../lib/auth.js';
import { q, one, ms } from '../lib/db.js';
import { publicTest, cleanAnswer } from '../lib/testdef.js';
import {
  getTestDef, loadAttempt, mutate, publicAttempt, logEvent, writableSection,
} from '../lib/attempts.js';

const CLIENT_EVENTS = new Set([
  'focus_lost', 'focus_back', 'ubreak_start', 'ubreak_end', 'paste_blocked', 'copy_blocked', 'page_left',
]);

export default handler(async (request) => {
  const user = await requireUser(request);
  const params = queryParams(request);
  const body = request.method === 'POST' ? await readBody(request) : {};
  const action = body.action || params.get('action');

  switch (action) {
    case 'home':
      return home(user);
    case 'start':
      return start(user, body);
    case 'load':
      return load(user, params.get('attempt'));
    case 'sync':
      return sync(user, body);
    case 'begin':
      return begin(user, body);
    case 'endBreak':
      return endBreak(user, body);
    case 'submitSection':
      return submitSection(user, body);
    case 'exit':
      return exitExam(user, body);
    case 'event':
      return clientEvent(user, body);
    case 'ackMessage':
      return ackMessage(user, body);
    default:
      throw new HttpError(400, 'Unknown action.');
  }
});

function sectionSummary(def) {
  return def.sections.map((s) => ({
    title: s.title,
    name: s.name,
    type: s.type,
    minutes: s.minutes,
    count: s.questions.length,
    breakAfterMinutes: s.breakAfterMinutes,
  }));
}

async function home(user) {
  const isAdmin = user.role === 'admin';
  const rows = await q(
    `select t.id, t.title, t.definition, t.is_open, (t.start_code is not null and t.start_code <> '') as needs_code,
            a.id as attempt_id, a.status, a.phase, a.section_index
       from tests t
       left join attempts a on a.test_id = t.id and a.user_id = $1
      where t.is_open or a.id is not null or $2
      order by t.created_at asc`,
    [user.id, isAdmin]
  );
  return json({
    user: publicUser(user),
    tests: rows.map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.definition.subtitle || null,
      description: r.definition.description || null,
      sections: sectionSummary(r.definition),
      open: r.is_open,
      needsCode: r.needs_code && !isAdmin,
      attempt: r.attempt_id ? { id: r.attempt_id, status: r.status, phase: r.phase, sectionIndex: r.section_index } : null,
    })),
  });
}

async function start(user, body) {
  const test = await one('select id, is_open, start_code from tests where id = $1', [String(body.testId || '')]);
  const isAdmin = user.role === 'admin';
  if (!test || (!test.is_open && !isAdmin)) throw new HttpError(404, "That test isn't available right now.");
  const existing = await one('select id, status from attempts where user_id = $1 and test_id = $2', [user.id, test.id]);
  if (existing) {
    if (existing.status === 'completed') throw new HttpError(409, "You've already completed this test.");
    return json({ attemptId: existing.id });
  }
  if (test.start_code && !isAdmin) {
    const given = String(body.code || '').trim().toUpperCase();
    if (given !== String(test.start_code).trim().toUpperCase()) {
      throw new HttpError(403, "That start code isn't right. Check with your proctor.");
    }
  }
  const row = await one(
    `insert into attempts (user_id, test_id) values ($1, $2)
     on conflict (user_id, test_id) do update set last_seen_at = now()
     returning id`,
    [user.id, test.id]
  );
  await logEvent(row.id, user.id, 'exam_started', 0);
  return json({ attemptId: row.id });
}

async function load(user, attemptId) {
  const { at, def, now } = await mutate(attemptId, { user });
  await q('update attempts set last_seen_at = now() where id = $1', [at.id]);
  if (at.status !== 'completed') {
    const view = at.view || {};
    const qn = Number.isInteger(view.q) ? view.q + 1 : null;
    if (at.away) {
      // They reopened the exam while marked as away: close out that away period.
      const awayMs = at.away_since ? Math.max(0, now - ms(at.away_since)) : null;
      await q('update attempts set away = false, away_since = null where id = $1', [at.id]);
      await logEvent(at.id, user.id, 'focus_back', at.section_index, qn, awayMs != null ? { awayMs } : null);
      at.away = false;
    }
    await logEvent(at.id, user.id, 'opened', at.section_index, qn);
  }
  return json({
    now,
    user: publicUser(user),
    test: publicTest(def),
    attempt: publicAttempt(at),
    answers: at.answers || {},
    view: at.view || {},
  });
}

function cleanView(v) {
  if (!v || typeof v !== 'object') return {};
  return {
    screen: typeof v.screen === 'string' ? v.screen.slice(0, 20) : null,
    section: Number.isInteger(v.section) ? v.section : null,
    q: Number.isInteger(v.q) ? v.q : null,
    ubreak: !!v.ubreak,
  };
}

async function sync(user, body) {
  const { at, def, now } = await mutate(body.attemptId, { user });
  const view = cleanView(body.view);
  const patch = {};
  const incoming = body.answers && typeof body.answers === 'object' ? body.answers : {};
  const answersSection = Number.isInteger(body.answersSection) ? body.answersSection : view.section;
  const target = writableSection(at, def, answersSection, now);
  if (target != null && Object.keys(incoming).length) {
    const byId = new Map(def.sections[target].questions.map((qq) => [qq.id, qq]));
    for (const [qid, a] of Object.entries(incoming)) {
      const qq = byId.get(qid);
      if (!qq) continue;
      const clean = cleanAnswer(qq, a);
      if (clean) patch[qid] = clean;
    }
  }
  if (Object.keys(patch).length) {
    await q(
      `update attempts set answers = answers || $2::jsonb, view = $3::jsonb, last_seen_at = now() where id = $1`,
      [at.id, JSON.stringify(patch), JSON.stringify(view)]
    );
  } else {
    await q(`update attempts set view = $2::jsonb, last_seen_at = now() where id = $1`, [at.id, JSON.stringify(view)]);
  }
  return json({ now, attempt: publicAttempt(at), saved: Object.keys(patch) });
}

async function begin(user, body) {
  const { at, now } = await mutate(body.attemptId, {
    user,
    change(at, def, now) {
      if (at.status !== 'active') throw new HttpError(409, 'This exam is not active.');
      if (at.phase !== 'directions') return [];
      const sec = def.sections[at.section_index];
      at.phase = 'section';
      at.section_ends_at = new Date(now + sec.minutes * 60_000);
      return [{ type: 'section_start', section_index: at.section_index }];
    },
  });
  return json({ now, attempt: publicAttempt(at) });
}

async function endBreak(user, body) {
  const { at, now } = await mutate(body.attemptId, {
    user,
    change(at, def, now) {
      if (at.status !== 'active' || at.phase !== 'break') return [];
      if (!def.settings.earlyBreakEnd && now < ms(at.break_ends_at) - 1500) {
        throw new HttpError(409, "The break isn't over yet.");
      }
      at.phase = 'directions';
      at.section_index += 1;
      at.break_ends_at = null;
      return [{ type: 'break_end', section_index: at.section_index - 1 }];
    },
  });
  return json({ now, attempt: publicAttempt(at) });
}

async function submitSection(user, body) {
  const { at, now } = await mutate(body.attemptId, {
    user,
    change(at, def, now) {
      if (!def.settings.allowEarlySubmit) throw new HttpError(403, 'This test does not allow moving on early.');
      if (at.status !== 'active' || at.phase !== 'section') return [];
      at.section_ends_at = new Date(now);
      return [{ type: 'submitted_early', section_index: at.section_index }];
    },
  });
  return json({ now, attempt: publicAttempt(at) });
}

async function exitExam(user, body) {
  const { at, now } = await mutate(body.attemptId, {
    user,
    change(at, def, now) {
      if (at.status !== 'active') return [];
      at.status = 'paused';
      at.paused_at = new Date(now);
      const view = at.view || {};
      return [{ type: 'exited', section_index: at.section_index, question: Number.isInteger(view.q) ? view.q + 1 : null }];
    },
  });
  return json({ now, attempt: publicAttempt(at) });
}

async function clientEvent(user, body) {
  const type = String(body.type || '');
  if (!CLIENT_EVENTS.has(type)) throw new HttpError(400, 'Unknown event.');
  const at = await loadAttempt(body.attemptId);
  if (!at || at.user_id !== user.id) throw new HttpError(404, 'Exam not found.');
  const question = Number.isInteger(body.question) ? body.question : null;
  const section = Number.isInteger(body.section) ? body.section : at.section_index;
  const detail = {};
  if (body.screen) detail.screen = String(body.screen).slice(0, 20);
  if (body.reason) detail.reason = String(body.reason).slice(0, 40);
  if (type === 'focus_lost') {
    await q(
      `update attempts set away = true, away_since = now(), away_count = away_count + 1, last_seen_at = now() where id = $1`,
      [at.id]
    );
  } else if (type === 'focus_back') {
    const since = at.away_since ? ms(at.away_since) : null;
    if (since) detail.awayMs = Math.max(0, Date.now() - since);
    else if (Number.isFinite(body.awayMs)) detail.awayMs = Math.max(0, Math.round(body.awayMs));
    await q(`update attempts set away = false, away_since = null, last_seen_at = now() where id = $1`, [at.id]);
  }
  await logEvent(at.id, user.id, type, section, question, Object.keys(detail).length ? detail : null);
  return json({ ok: true });
}

async function ackMessage(user, body) {
  const at = await loadAttempt(body.attemptId);
  if (!at || at.user_id !== user.id) throw new HttpError(404, 'Exam not found.');
  await q('update attempts set message_ack = greatest(message_ack, $2) where id = $1', [at.id, Number(body.messageId) || 0]);
  return json({ ok: true });
}
