// Exam attempt state machine. All timing is decided by the server clock, so refreshing
// the page or closing the laptop never resets a timer.
//
// status: active | paused (left via "Exit the Exam", waiting for the proctor) | completed
// phase:  directions (time paused) -> section (timer running) -> break -> directions -> ... -> done
import { q, one, iso, ms } from './db.js';
import { HttpError } from './http.js';
import { isAnswered, scoreAttempt } from './testdef.js';

const defCache = new Map();

export async function getTestDef(testId, updatedAt) {
  const hit = defCache.get(testId);
  if (hit && updatedAt != null && hit.updatedAt === ms(updatedAt)) return hit.def;
  const row = await one('select definition, updated_at from tests where id = $1', [testId]);
  if (!row) throw new HttpError(404, 'That test no longer exists.');
  defCache.set(testId, { updatedAt: ms(row.updated_at), def: row.definition });
  return row.definition;
}

export function forgetTest(testId) {
  defCache.delete(testId);
}

const ATTEMPT_SELECT = `
  select a.*, t.updated_at as test_updated_at, t.title as test_title,
         u.username, u.display_name
    from attempts a
    join tests t on t.id = a.test_id
    join users u on u.id = a.user_id`;

export async function loadAttempt(attemptId) {
  const id = Number(attemptId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Missing exam id.');
  return one(`${ATTEMPT_SELECT} where a.id = $1`, [id]);
}

export async function listAttempts() {
  return q(`${ATTEMPT_SELECT} order by (a.status = 'completed'), a.last_seen_at desc limit 500`);
}

export async function logEvent(attemptId, userId, type, sectionIndex = null, question = null, detail = null) {
  const rows = await q(
    `insert into events (attempt_id, user_id, type, section_index, question, detail)
     values ($1, $2, $3, $4, $5, $6::jsonb) returning id`,
    [attemptId, userId, type, sectionIndex, question, detail == null ? null : JSON.stringify(detail)]
  );
  return rows[0] && rows[0].id;
}

/** Move an attempt past any timers that have run out. Mutates `at`, returns new events. */
export function advance(at, def, now = Date.now()) {
  const events = [];
  for (let guard = 0; guard < 25 && at.status === 'active'; guard++) {
    if (at.phase === 'section' && at.section_ends_at != null && now >= ms(at.section_ends_at)) {
      const i = at.section_index;
      const sec = def.sections[i];
      const endAt = ms(at.section_ends_at);
      events.push({ type: 'section_end', section_index: i });
      if (i >= def.sections.length - 1) {
        at.phase = 'done';
        at.status = 'completed';
        at.completed_at = new Date(endAt);
        events.push({ type: 'completed', section_index: i });
        break;
      }
      if (sec && sec.breakAfterMinutes > 0) {
        at.phase = 'break';
        at.break_ends_at = new Date(endAt + sec.breakAfterMinutes * 60_000);
        events.push({ type: 'break_start', section_index: i });
      } else {
        at.phase = 'directions';
        at.section_index = i + 1;
      }
      continue;
    }
    break;
  }
  return events;
}

const STATE_KEYS = ['status', 'phase', 'section_index', 'section_ends_at', 'break_ends_at', 'paused_at', 'completed_at'];
const stateSig = (at) => JSON.stringify(STATE_KEYS.map((k) => (at[k] instanceof Date ? at[k].getTime() : at[k] ?? null)));

async function saveState(at, prevVersion, events) {
  const rows = await q(
    `update attempts
        set status = $2, phase = $3, section_index = $4, section_ends_at = $5, break_ends_at = $6,
            paused_at = $7, completed_at = $8, version = version + 1
      where id = $1 and version = $9
      returning version`,
    [at.id, at.status, at.phase, at.section_index, iso(at.section_ends_at), iso(at.break_ends_at), iso(at.paused_at), iso(at.completed_at), prevVersion]
  );
  if (!rows.length) return false;
  at.version = rows[0].version;
  for (const e of events) {
    await logEvent(at.id, at.user_id, e.type, e.section_index ?? at.section_index, e.question ?? null, e.detail ?? null);
  }
  return true;
}

/**
 * Load an attempt, apply expired timers, optionally run `change(at, def, now)` (which may
 * modify state and return extra events), and save with optimistic locking.
 */
export async function mutate(attemptId, { user = null, change = null } = {}) {
  for (let tries = 0; tries < 4; tries++) {
    const at = await loadAttempt(attemptId);
    if (!at) throw new HttpError(404, 'Exam not found.');
    if (user && user.role !== 'admin' && at.user_id !== user.id) throw new HttpError(404, 'Exam not found.');
    const def = await getTestDef(at.test_id, at.test_updated_at);
    const now = Date.now();
    const before = stateSig(at);
    const prevVersion = at.version;
    const events = advance(at, def, now);
    if (change) {
      const extra = (await change(at, def, now)) || [];
      events.push(...extra);
      events.push(...advance(at, def, now));
    }
    if (stateSig(at) === before && !events.length) return { at, def, now };
    if (await saveState(at, prevVersion, events)) return { at, def, now };
  }
  throw new HttpError(409, 'The exam was busy. Please try again.');
}

export function publicAttempt(at) {
  return {
    id: at.id,
    testId: at.test_id,
    status: at.status,
    phase: at.phase,
    sectionIndex: at.section_index,
    sectionEndsAt: at.phase === 'section' ? ms(at.section_ends_at) : null,
    breakEndsAt: at.phase === 'break' ? ms(at.break_ends_at) : null,
    pausedAt: ms(at.paused_at),
    message: at.message && at.message_id > at.message_ack ? { id: at.message_id, text: at.message } : null,
  };
}

/** Which section's answers may still be saved right now (with a short grace period after time runs out). */
export function writableSection(at, def, sectionFromClient, now) {
  if (at.status !== 'active' && at.status !== 'completed') return null;
  if (at.phase === 'section' && at.status === 'active') return at.section_index;
  const endedIdx = at.phase === 'directions' ? at.section_index - 1 : at.section_index;
  const endedAt = ms(at.section_ends_at);
  if (endedIdx >= 0 && endedIdx === sectionFromClient && endedAt && now - endedAt <= 8_000) return endedIdx;
  return null;
}

/** Compact status line for the proctor dashboard. */
export function summarize(at, def, now = Date.now()) {
  const sec = def.sections[at.section_index] || null;
  const view = at.view || {};
  let answered = 0;
  let flagged = 0;
  const total = sec ? sec.questions.length : 0;
  if (sec) {
    for (const qq of sec.questions) {
      const a = at.answers && at.answers[qq.id];
      if (isAnswered(qq, a)) answered++;
      if (a && a.r) flagged++;
    }
  }
  const ref = at.status === 'paused' && at.paused_at ? ms(at.paused_at) : now;
  const secondsLeft =
    at.phase === 'section' && at.section_ends_at ? Math.max(0, Math.round((ms(at.section_ends_at) - ref) / 1000)) : null;
  const breakSecondsLeft =
    at.phase === 'break' && at.break_ends_at ? Math.max(0, Math.round((ms(at.break_ends_at) - ref) / 1000)) : null;
  const score = scoreAttempt(def, at.answers || {});
  return {
    id: at.id,
    user: { id: at.user_id, username: at.username, name: at.display_name },
    test: { id: at.test_id, title: at.test_title || def.title },
    status: at.status,
    phase: at.phase,
    sectionIndex: at.section_index,
    sectionCount: def.sections.length,
    sectionTitle: sec ? sec.title : '',
    sectionType: sec ? sec.type : null,
    screen: view.screen || null,
    question: Number.isInteger(view.q) ? view.q + 1 : null,
    viewSection: Number.isInteger(view.section) ? view.section : null,
    ubreak: !!view.ubreak,
    away: !!at.away,
    awaySince: ms(at.away_since),
    awayCount: at.away_count || 0,
    answered,
    total,
    flagged,
    secondsLeft,
    breakSecondsLeft,
    lastSeen: ms(at.last_seen_at),
    online: now - ms(at.last_seen_at) < 20_000,
    startedAt: ms(at.started_at),
    completedAt: ms(at.completed_at),
    score: { correct: score.correct, keyed: score.keyed, answered: score.answered, total: score.total },
    messagePending: at.message_id > at.message_ack,
  };
}
