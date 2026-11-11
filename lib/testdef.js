// Test file (JSON) validation, normalization, the student-safe copy, and scoring.
// The JSON format is documented in tests/FORMAT.md.

export const LETTERS = 'ABCDEFGH';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (v == null ? '' : String(v));
const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));

function slugify(s) {
  return str(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'test';
}

function htmlBlock(v) {
  // Accept a string or an array of paragraphs. Plain strings become <p> paragraphs.
  if (v == null) return '';
  const parts = Array.isArray(v) ? v : [v];
  return parts
    .map((p) => {
      const s = str(p).trim();
      if (!s) return '';
      return /^\s*</.test(s) ? s : `<p>${s}</p>`;
    })
    .join('\n');
}

function normPassage(raw, id, where, errors) {
  if (typeof raw === 'string') raw = { html: raw };
  if (!isObj(raw)) {
    errors.push(`${where}: passage "${id}" must be an object or an HTML string.`);
    return null;
  }
  const p = {
    id,
    heading: str(raw.heading).trim() || null,
    intro: raw.intro != null ? htmlBlock(raw.intro) : null,
    title: str(raw.title).trim() || null,
    lines: null,
    html: null,
    documents: null,
    image: str(raw.image).trim() || null,
    imageAlt: str(raw.imageAlt || raw.alt).trim() || '',
    caption: raw.caption != null ? str(raw.caption) : null,
    source: raw.source != null ? str(raw.source) : null,
    numbering: raw.lineNumbers === false ? false : true,
  };
  if (Array.isArray(raw.lines)) p.lines = raw.lines.map((l) => str(l));
  if (raw.html != null || raw.text != null) p.html = htmlBlock(raw.html != null ? raw.html : raw.text);
  if (Array.isArray(raw.documents)) {
    p.documents = raw.documents.map((d, i) => {
      if (typeof d === 'string') d = { html: d };
      return {
        label: str(d.label).trim() || `Document ${i + 1}`,
        title: str(d.title).trim() || null,
        html: htmlBlock(d.html != null ? d.html : d.text),
        image: str(d.image).trim() || null,
        source: d.source != null ? str(d.source) : null,
      };
    });
  }
  if (!p.lines && !p.html && !p.documents && !p.image) {
    errors.push(`${where}: passage "${id}" needs "lines", "html", "documents", or "image".`);
  }
  return p;
}

/**
 * Validate + normalize an uploaded test. Returns { def, errors }.
 * The normalized definition is what gets stored and served.
 */
export function normalizeTest(raw) {
  const errors = [];
  if (!isObj(raw)) return { def: null, errors: ['The file must contain one JSON object (it should start with "{").'] };

  const title = str(raw.title).trim();
  if (!title) errors.push('Add a "title" for the test.');
  const id = str(raw.id).trim() || slugify(title);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)) {
    errors.push('"id" can only use letters, numbers, dashes and underscores (max 80 characters).');
  }

  const rs = isObj(raw.settings) ? raw.settings : {};
  const delay = Array.isArray(rs.loadDelayMs) ? rs.loadDelayMs.map(Number) : [250, 650];
  const settings = {
    allowEarlySubmit: !!rs.allowEarlySubmit,
    earlyBreakEnd: !!rs.earlyBreakEnd,
    loadDelayMs: [Math.max(0, delay[0] || 0), Math.max(delay[0] || 0, delay[1] || 0)],
  };

  const sectionsIn = Array.isArray(raw.sections) ? raw.sections : [];
  if (!sectionsIn.length) errors.push('Add at least one section in "sections".');

  const seenIds = new Set();
  const sections = sectionsIn.map((s, si) => {
    const where = `Section ${si + 1}`;
    if (!isObj(s)) {
      errors.push(`${where} must be an object.`);
      return null;
    }
    const qsIn = Array.isArray(s.questions) ? s.questions : [];
    if (!qsIn.length) errors.push(`${where}: add at least one question.`);
    let type = str(s.type).toLowerCase();
    if (type !== 'mcq' && type !== 'frq') {
      type = qsIn.length && qsIn.every((q) => isObj(q) && Array.isArray(q.choices)) ? 'mcq' : 'frq';
    }
    const minutes = num(s.minutes ?? s.durationMinutes, NaN);
    if (!(minutes > 0)) errors.push(`${where}: "minutes" must be a number greater than 0.`);
    const breakAfter = num(s.breakAfterMinutes ?? s.breakMinutes, 0);
    if (!(breakAfter >= 0)) errors.push(`${where}: "breakAfterMinutes" must be 0 or more.`);

    const secTitle = str(s.title).trim() || `Section ${ROMAN[si] || si + 1}`;
    const name = str(s.name).trim() || (type === 'mcq' ? 'Multiple Choice' : 'Free Response');

    const passages = {};
    if (isObj(s.passages)) {
      for (const [pid, pr] of Object.entries(s.passages)) {
        const p = normPassage(pr, pid, where, errors);
        if (p) passages[pid] = p;
      }
    }

    const resolvePassage = (val, qwhere, autoId) => {
      if (val == null || val === '') return null;
      if (typeof val === 'string') {
        if (passages[val]) return val;
        // Treat a long string with HTML as an inline passage.
        if (/[<\s]/.test(val) && val.length > 40) {
          passages[autoId] = normPassage({ html: val }, autoId, qwhere, errors);
          return autoId;
        }
        errors.push(`${qwhere}: passage "${val}" isn't defined in this section's "passages".`);
        return null;
      }
      if (isObj(val)) {
        const p = normPassage(val, autoId, qwhere, errors);
        if (p) passages[autoId] = p;
        return p ? autoId : null;
      }
      errors.push(`${qwhere}: "passage" should be a passage id or an object.`);
      return null;
    };

    const questions = qsIn.map((qr, qi) => {
      const qwhere = `${where}, question ${qi + 1}`;
      if (!isObj(qr)) {
        errors.push(`${qwhere} must be an object.`);
        return null;
      }
      let qid = str(qr.id).trim() || `s${si + 1}q${qi + 1}`;
      if (seenIds.has(qid)) {
        errors.push(`${qwhere}: id "${qid}" is used twice.`);
        qid = `${qid}_${si}_${qi}`;
      }
      seenIds.add(qid);
      const prompt = htmlBlockInline(qr.prompt ?? qr.question ?? qr.text);
      const passage = resolvePassage(qr.passage ?? qr.stimulus, qwhere, `_${qid}`);
      let refLines = null;
      if (Array.isArray(qr.lines) && qr.lines.length) {
        const a = Number(qr.lines[0]);
        const b = Number(qr.lines[qr.lines.length - 1]);
        if (a > 0 && b >= a) refLines = [a, b];
        else errors.push(`${qwhere}: "lines" should look like [1, 6].`);
      }
      const ref = qr.ref != null ? str(qr.ref) : null;
      const q = {
        id: qid,
        number: qi + 1,
        type,
        passage,
        refLines,
        ref,
        prompt,
      };
      if (type === 'mcq') {
        const choices = Array.isArray(qr.choices) ? qr.choices.map((c) => str(c)) : [];
        if (choices.length < 2 || choices.length > LETTERS.length) {
          errors.push(`${qwhere}: give between 2 and ${LETTERS.length} "choices".`);
        }
        q.choices = choices;
        let ans = qr.answer;
        if (ans != null && ans !== '') {
          if (typeof ans === 'number') {
            errors.push(`${qwhere}: write "answer" as a letter, like "B".`);
            ans = null;
          } else {
            ans = str(ans).trim().toUpperCase();
            if (LETTERS.indexOf(ans) < 0 || LETTERS.indexOf(ans) >= choices.length) {
              errors.push(`${qwhere}: "answer" must be one of ${LETTERS.slice(0, choices.length).split('').join(', ')}.`);
              ans = null;
            }
          }
        } else ans = null;
        q.answer = ans;
        q.explanation = qr.explanation != null ? str(qr.explanation) : null;
        if (!prompt) errors.push(`${qwhere}: add a "prompt".`);
      } else {
        q.points = qr.points != null ? Number(qr.points) : null;
        q.rubric = qr.rubric != null ? htmlBlock(qr.rubric) : null;
        if (Array.isArray(qr.choose) && qr.choose.length) {
          q.choose = qr.choose.map((o, oi) => {
            if (typeof o === 'string') o = { prompt: o };
            return {
              label: str(o.label).trim() || `Option ${oi + 1}`,
              prompt: htmlBlockInline(o.prompt ?? o.text),
              passage: resolvePassage(o.passage ?? o.stimulus, `${qwhere}, option ${oi + 1}`, `_${qid}_o${oi + 1}`),
            };
          });
        } else if (!prompt) {
          errors.push(`${qwhere}: add a "prompt".`);
        }
      }
      return q;
    });

    let reference = null;
    if (Array.isArray(s.reference)) {
      reference = s.reference.map((r, i) =>
        typeof r === 'string'
          ? { title: `Reference ${i + 1}`, html: htmlBlock(r) }
          : { title: str(r.title).trim() || `Reference ${i + 1}`, html: htmlBlock(r.html ?? r.text) }
      );
    } else if (s.reference) {
      reference = [{ title: 'Reference', html: htmlBlock(s.reference) }];
    }

    return {
      index: si,
      title: secTitle,
      name,
      navTitle: str(s.navTitle).trim() || `${secTitle}: ${name} Questions`,
      type,
      minutes: minutes > 0 ? minutes : 1,
      breakAfterMinutes: si < sectionsIn.length - 1 && breakAfter > 0 ? breakAfter : 0,
      responseMode: str(s.responseMode).toLowerCase() === 'paper' ? 'paper' : 'typed',
      directions: htmlBlock(s.directions) || defaultDirections(type, qsIn.length, minutes),
      reference,
      passages,
      questions: questions.filter(Boolean),
    };
  });

  const def = {
    id,
    title,
    subtitle: str(raw.subtitle).trim() || null,
    description: raw.description != null ? str(raw.description) : null,
    settings,
    sections: sections.filter(Boolean),
  };
  return { def, errors };
}

function htmlBlockInline(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return htmlBlock(v);
  return str(v).trim();
}

function minutesText(m) {
  if (m % 60 === 0) {
    const h = m / 60;
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  if (m > 60) return `${Math.floor(m / 60)} hour${m >= 120 ? 's' : ''} and ${m % 60} minutes`;
  return `${m} minute${m === 1 ? '' : 's'}`;
}

function defaultDirections(type, n, minutes) {
  const head = `<p>This section has ${n} ${type === 'mcq' ? 'multiple-choice' : 'free-response'} question${n === 1 ? '' : 's'} and lasts ${minutesText(minutes)}.</p>`;
  return (
    head +
    '<p>You can go back and forth between questions in this section until time expires. The clock will turn red when 5 minutes remain.</p>'
  );
}

const HIDDEN_KEYS = new Set(['answer', 'explanation', 'rubric', 'notes', 'points']);

/** Copy of the test that is safe to send to test takers (no answer keys). */
export function publicTest(def) {
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (isObj(v)) {
      const o = {};
      for (const [k, val] of Object.entries(v)) if (!HIDDEN_KEYS.has(k)) o[k] = strip(val);
      return o;
    }
    return v;
  };
  return strip(def);
}

export function questionIds(def, sectionIndex) {
  const sec = def.sections[sectionIndex];
  return sec ? sec.questions.map((q) => q.id) : [];
}

const stripTags = (h) =>
  str(h)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim();

export function isAnswered(q, a) {
  if (!a) return false;
  if (q.type === 'mcq') return !!a.c;
  if (q.choose) {
    const o = Number.isInteger(a.o) ? a.o : null;
    if (o == null) return false;
    return stripTags(a.ts && a.ts[o]).length > 0;
  }
  return stripTags(a.t).length > 0;
}

/** Score multiple-choice sections that have answer keys. */
export function scoreAttempt(def, answers) {
  const out = { correct: 0, keyed: 0, answered: 0, total: 0, sections: [] };
  for (const sec of def.sections) {
    const s = { title: sec.title, type: sec.type, correct: 0, keyed: 0, answered: 0, total: sec.questions.length };
    for (const q of sec.questions) {
      const a = answers && answers[q.id];
      if (isAnswered(q, a)) s.answered++;
      if (q.type === 'mcq' && q.answer) {
        s.keyed++;
        if (a && a.c === q.answer) s.correct++;
      }
    }
    out.sections.push(s);
    out.correct += s.correct;
    out.keyed += s.keyed;
    out.answered += s.answered;
    out.total += s.total;
  }
  return out;
}

/** Clean one answer object coming from a browser. Returns null if unusable. */
export function cleanAnswer(q, a) {
  if (!isObj(a)) return null;
  const out = {};
  if (q.type === 'mcq') {
    const letters = LETTERS.slice(0, q.choices.length);
    out.c = typeof a.c === 'string' && letters.includes(a.c) && a.c.length === 1 ? a.c : null;
    out.x = Array.isArray(a.x) ? [...new Set(a.x.filter((l) => typeof l === 'string' && l.length === 1 && letters.includes(l)))] : [];
  } else {
    if (typeof a.t === 'string') out.t = a.t.slice(0, 200_000);
    if (q.choose) {
      out.o = Number.isInteger(a.o) && a.o >= 0 && a.o < q.choose.length ? a.o : null;
      out.ts = {};
      if (isObj(a.ts)) {
        for (const [k, v] of Object.entries(a.ts)) {
          const i = Number(k);
          if (Number.isInteger(i) && i >= 0 && i < q.choose.length && typeof v === 'string') out.ts[i] = v.slice(0, 200_000);
        }
      }
    }
  }
  out.r = !!a.r;
  return out;
}
