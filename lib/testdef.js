// Test file (JSON) validation, normalization, the student-safe copy, and scoring.
// The JSON format is documented in tests/FORMAT.md.

export const LETTERS = 'ABCDEFGH';
export const IMAGE_ROUTE = '/api/exam?action=image&name=';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (v == null ? '' : String(v));
const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));

// Names of uploaded images referenced by the test being normalized (for "not uploaded yet" warnings).
let imageRefs = null;

function slugify(s) {
  return str(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'test';
}

/** "chart.png" (an image uploaded in the dashboard), "/images/x.png", or a full https:// URL. */
export function resolveImage(src) {
  const s = str(src).trim();
  if (!s) return null;
  if (/^(https?:|data:image\/|\/)/i.test(s)) return s;
  const name = s.replace(/^img:/i, '');
  if (imageRefs) imageRefs.add(name);
  return IMAGE_ROUTE + encodeURIComponent(name);
}

/** Inside HTML, <img src="img:chart.png"> points at an uploaded image. */
function fixHtmlImages(html) {
  return html.replace(/(src\s*=\s*)(["'])img:([^"']+)\2/gi, (m, a, q, n) => {
    if (imageRefs) imageRefs.add(n);
    return `${a}${q}${IMAGE_ROUTE}${encodeURIComponent(n)}${q}`;
  });
}

/** Accepts "image": "x.png" | {src, alt, caption, width}, and/or "images": [ ...same ]. */
function normImages(raw, where, errors) {
  const list = [];
  const add = (v) => {
    if (v == null || v === '') return;
    if (typeof v === 'string') v = { src: v };
    if (!isObj(v) || !v.src) {
      errors.push(`${where}: each image needs a "src" (a file name or URL).`);
      return;
    }
    list.push({
      src: resolveImage(v.src),
      alt: str(v.alt).trim(),
      caption: v.caption != null ? str(v.caption) : null,
      width: v.width != null ? str(v.width) : null,
    });
  };
  if (raw.image != null) {
    add(typeof raw.image === 'string' ? { src: raw.image, alt: raw.imageAlt || raw.alt, caption: raw.caption, width: raw.imageWidth } : raw.image);
  }
  if (Array.isArray(raw.images)) raw.images.forEach(add);
  return list.length ? list : null;
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

function htmlBlockInline(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return htmlBlock(v);
  return str(v).trim();
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
    images: normImages(raw, `${where}, passage "${id}"`, errors),
    imagesFirst: raw.imagePosition === 'above' || raw.imagePosition === 'top',
    source: raw.source != null ? str(raw.source) : null,
    numbering: raw.lineNumbers === false ? false : true,
  };
  if (Array.isArray(raw.lines)) p.lines = raw.lines.map((l) => str(l));
  if (raw.html != null || raw.text != null) p.html = htmlBlock(raw.html != null ? raw.html : raw.text);
  if (Array.isArray(raw.documents)) {
    p.documents = raw.documents.map((d, i) => {
      if (typeof d === 'string') d = /\.(png|jpe?g|gif|webp|svg)$/i.test(d) ? { image: d } : { html: d };
      return {
        label: str(d.label).trim() || `Document ${i + 1}`,
        title: str(d.title).trim() || null,
        html: d.html != null || d.text != null ? htmlBlock(d.html != null ? d.html : d.text) : '',
        images: normImages(d, `${where}, passage "${id}", document ${i + 1}`, errors),
        source: d.source != null ? str(d.source) : null,
      };
    });
  }
  if (!p.lines && !p.html && !p.documents && !p.images) {
    errors.push(`${where}: passage "${id}" needs "lines", "html", "documents", or "image".`);
  }
  return p;
}

const TYPE_ALIASES = { mcq: 'mcq', multiple: 'mcq', 'multiple-choice': 'mcq', input: 'input', short: 'input', 'short-answer': 'input', gridin: 'input', 'grid-in': 'input', spr: 'input', frq: 'frq', essay: 'frq', 'free-response': 'frq' };

function normChoice(c, where, errors) {
  if (isObj(c)) {
    const images = normImages(c, where, errors);
    const text = c.text != null ? str(c.text) : c.html != null ? str(c.html) : '';
    if (!text && !images) errors.push(`${where}: a choice needs "text" or "image".`);
    return images ? { text, images } : text;
  }
  return str(c);
}

/**
 * Validate + normalize an uploaded test. Returns { def, errors, imageNames }.
 * The normalized definition is what gets stored and served.
 */
export function normalizeTest(raw) {
  const errors = [];
  imageRefs = new Set();
  try {
    if (!isObj(raw)) return { def: null, errors: ['The file must contain one JSON object (it should start with "{").'], imageNames: [] };

    const title = str(raw.title).trim();
    if (!title) errors.push('Add a "title" for the test.');
    const id = str(raw.id).trim() || slugify(title);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)) {
      errors.push('"id" can only use letters, numbers, dashes and underscores (max 80 characters).');
    }

    const rs = isObj(raw.settings) ? raw.settings : {};
    const delay = Array.isArray(rs.loadDelayMs) ? rs.loadDelayMs.map(Number) : [250, 650];
    const showResults = ['score', 'full'].includes(str(rs.showResults).toLowerCase()) ? str(rs.showResults).toLowerCase() : 'none';
    const settings = {
      allowEarlySubmit: !!rs.allowEarlySubmit,
      earlyBreakEnd: !!rs.earlyBreakEnd,
      loadDelayMs: [Math.max(0, delay[0] || 0), Math.max(delay[0] || 0, delay[1] || 0)],
      warningMinutes: rs.warningMinutes === false ? 0 : Math.max(0, num(rs.warningMinutes, 5)),
      ruleColors: rs.ruleColors !== false,
      crossOut: rs.crossOut !== false,
      showResults,
      allowBack: rs.allowBack !== false,
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
      const qType = (q) => {
        if (!isObj(q)) return null;
        if (q.type && TYPE_ALIASES[str(q.type).toLowerCase()]) return TYPE_ALIASES[str(q.type).toLowerCase()];
        return Array.isArray(q.choices) ? 'mcq' : null;
      };
      let type = TYPE_ALIASES[str(s.type).toLowerCase()];
      if (type !== 'mcq' && type !== 'frq') {
        type = qsIn.length && qsIn.every((q) => ['mcq', 'input'].includes(qType(q))) ? 'mcq' : 'frq';
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
        let qt = qType(qr) || (type === 'mcq' ? null : 'frq');
        if (!qt) {
          errors.push(`${qwhere}: add "choices", or set "type": "input" for a typed answer.`);
          qt = 'mcq';
        }
        const prompt = htmlBlockInline(qr.prompt ?? qr.question ?? qr.text);
        const passage = resolvePassage(qr.passage ?? qr.stimulus, qwhere, `_${qid}`);
        let refLines = null;
        if (Array.isArray(qr.lines) && qr.lines.length) {
          const a = Number(qr.lines[0]);
          const b = Number(qr.lines[qr.lines.length - 1]);
          if (a > 0 && b >= a) refLines = [a, b];
          else errors.push(`${qwhere}: "lines" should look like [1, 6].`);
        }
        const q = {
          id: qid,
          number: qi + 1,
          type: qt,
          passage,
          refLines,
          ref: qr.ref != null ? str(qr.ref) : null,
          prompt,
          images: normImages(qr, qwhere, errors),
          imagesFirst: qr.imagePosition === 'above' || qr.imagePosition === 'top',
          layout: ['centered', 'split'].includes(qr.layout) ? qr.layout : null,
          explanation: qr.explanation != null ? str(qr.explanation) : null,
        };
        if (!prompt && !q.images && !(qt === 'frq' && Array.isArray(qr.choose))) errors.push(`${qwhere}: add a "prompt" (or an "image").`);
        if (qt === 'mcq') {
          const choices = Array.isArray(qr.choices) ? qr.choices.map((c, ci) => normChoice(c, `${qwhere}, choice ${ci + 1}`, errors)) : [];
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
        } else if (qt === 'input') {
          const acc = qr.answer ?? qr.answers;
          q.answer = acc == null || acc === '' ? null : (Array.isArray(acc) ? acc : [acc]).map((x) => str(x).trim()).filter(Boolean);
          if (q.answer && !q.answer.length) q.answer = null;
          q.maxLength = Math.min(60, Math.max(1, num(qr.maxLength, 12)));
          q.inputLabel = qr.inputLabel != null ? str(qr.inputLabel) : null;
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
          }
        }
        return q;
      });

      let reference = null;
      if (Array.isArray(s.reference)) {
        reference = s.reference.map((r, i) =>
          typeof r === 'string'
            ? { title: `Reference ${i + 1}`, html: htmlBlock(r) }
            : { title: str(r.title).trim() || `Reference ${i + 1}`, html: htmlBlock(r.html ?? r.text), images: normImages(r, `${where}, reference ${i + 1}`, errors) }
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

    let def = {
      id,
      title,
      subtitle: str(raw.subtitle).trim() || null,
      description: raw.description != null ? str(raw.description) : null,
      settings,
      sections: sections.filter(Boolean),
    };
    def = deepMapStrings(def, (s) => (/img:/i.test(s) ? fixHtmlImages(s) : s));
    return { def, errors, imageNames: [...imageRefs] };
  } finally {
    imageRefs = null;
  }
}

function deepMapStrings(v, fn) {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map((x) => deepMapStrings(x, fn));
  if (isObj(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = deepMapStrings(x, fn);
    return o;
  }
  return v;
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

const HIDDEN_KEYS = new Set(['answer', 'answers', 'explanation', 'rubric', 'notes', 'points']);

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

export const stripTags = (h) =>
  str(h)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function isAnswered(q, a) {
  if (!a) return false;
  if (q.type === 'mcq') return !!a.c;
  if (q.type === 'input') return str(a.v).trim().length > 0;
  if (q.choose) {
    const o = Number.isInteger(a.o) ? a.o : null;
    if (o == null) return false;
    return stripTags(a.ts && a.ts[o]).length > 0;
  }
  return stripTags(a.t).length > 0;
}

function parseNum(s) {
  const t = str(s).replace(/\s+/g, '').replace(/,/g, '');
  if (/^[-+]?\d+\/\d+$/.test(t)) {
    const [n, d] = t.split('/').map(Number);
    return d ? n / d : NaN;
  }
  if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return Number(t);
  return NaN;
}

/** Short-answer matching: exact text (ignoring case/extra spaces) or the same number (½ = 0.5 = .5). */
export function matchInput(given, accepted) {
  const g = str(given).trim();
  if (!g || !accepted || !accepted.length) return false;
  const gl = g.toLowerCase().replace(/\s+/g, ' ');
  const gn = parseNum(g);
  for (const acc of accepted) {
    if (gl === str(acc).trim().toLowerCase().replace(/\s+/g, ' ')) return true;
    const an = parseNum(acc);
    if (!Number.isNaN(gn) && !Number.isNaN(an)) {
      if (Math.abs(gn - an) < 1e-9) return true;
      // Accept a long decimal that's rounded or cut off, e.g. .6666 or .6667 for 2/3.
      const decimals = (g.split('.')[1] || '').replace(/\D/g, '').length;
      if (g.includes('.') && decimals >= 3 && Math.abs(gn - an) < Math.pow(10, -decimals)) return true;
    }
  }
  return false;
}

export function isCorrect(q, a) {
  if (!q.answer || !a) return false;
  if (q.type === 'mcq') return a.c === q.answer;
  if (q.type === 'input') return matchInput(a.v, q.answer);
  return false;
}

const keyed = (q) => (q.type === 'mcq' || q.type === 'input') && !!q.answer;

/** Score the auto-gradable questions (multiple choice and short answer) that have answer keys. */
export function scoreAttempt(def, answers) {
  const out = { correct: 0, keyed: 0, answered: 0, total: 0, sections: [] };
  for (const sec of def.sections) {
    const s = { title: sec.title, type: sec.type, correct: 0, keyed: 0, answered: 0, total: sec.questions.length };
    for (const q of sec.questions) {
      const a = answers && answers[q.id];
      if (isAnswered(q, a)) s.answered++;
      if (keyed(q)) {
        s.keyed++;
        if (isCorrect(q, a)) s.correct++;
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

/** What a test taker sees after finishing when the test's "showResults" setting allows it. */
export function buildResults(def, answers, mode) {
  const score = scoreAttempt(def, answers || {});
  const res = { mode, score, sections: [] };
  def.sections.forEach((sec, si) => {
    const s = { ...score.sections[si], questions: [] };
    if (mode === 'full') {
      for (const q of sec.questions) {
        const a = (answers && answers[q.id]) || {};
        const item = { number: q.number, type: q.type, prompt: stripTags(q.prompt).slice(0, 240), explanation: q.explanation || null };
        if (q.type === 'mcq') {
          item.given = a.c || null;
          item.answer = q.answer;
          item.correct = keyed(q) ? isCorrect(q, a) : null;
          item.choices = q.choices.map((c) => (typeof c === 'string' ? stripTags(c) : stripTags(c.text) || '(image)'));
        } else if (q.type === 'input') {
          item.given = str(a.v).trim() || null;
          item.answer = q.answer ? q.answer.join(' or ') : null;
          item.correct = keyed(q) ? isCorrect(q, a) : null;
        } else {
          item.given = isAnswered(q, a) ? 'Response submitted' : null;
          item.correct = null;
        }
        s.questions.push(item);
      }
    }
    res.sections.push(s);
  });
  return res;
}

/** Clean one answer object coming from a browser. Returns null if unusable. */
export function cleanAnswer(q, a) {
  if (!isObj(a)) return null;
  const out = {};
  if (q.type === 'mcq') {
    const letters = LETTERS.slice(0, q.choices.length);
    out.c = typeof a.c === 'string' && letters.includes(a.c) && a.c.length === 1 ? a.c : null;
    out.x = Array.isArray(a.x) ? [...new Set(a.x.filter((l) => typeof l === 'string' && l.length === 1 && letters.includes(l)))] : [];
  } else if (q.type === 'input') {
    out.v = typeof a.v === 'string' ? a.v.slice(0, q.maxLength || 60) : '';
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
