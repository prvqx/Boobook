/* The test-taking app: directions, questions, review page, breaks, finish screen.
   The server owns the clock; this page saves answers every few seconds and reports
   when the student leaves the tab or window (it never blocks them). */
(function () {
  'use strict';
  const { esc, icon, sleep, modal, toast, fmtClock } = U;
  const LETTERS = 'ABCDEFGH';
  const app = document.getElementById('app');
  const attemptId = Number(new URLSearchParams(location.search).get('attempt'));

  const S = {
    test: null,
    attempt: null,
    user: null,
    answers: {},
    dirty: new Set(),
    dirtySection: null,
    qIndex: 0,
    screen: 'question', // question | review
    timerHidden: false,
    fiveMinShown: false,
    split: 50,
    elim: true,
    clockOffset: 0,
    ubreak: false,
    loading: false,
    syncing: false,
    syncAgain: false,
    failures: 0,
    away: false,
    awayAt: 0,
    shownMessage: 0,
    docIdx: {},
    editor: null,
    passKey: null,
    passScroll: 0,
    el: {},
    expiring: false,
    lastCopyLog: 0,
    unloading: false,
    settings: {},
    results: null,
    showResults: false,
  };

  const now = () => Date.now() + S.clockOffset;
  const sec = () => S.test.sections[S.attempt.sectionIndex];
  const ans = (qid) => (S.answers[qid] = S.answers[qid] || {});
  const stripTags = (h) => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();

  function isAnswered(q, a) {
    if (!a) return false;
    if (q.type === 'mcq') return !!a.c;
    if (q.type === 'input') return String(a.v || '').trim().length > 0;
    if (q.choose) return Number.isInteger(a.o) && stripTags(a.ts && a.ts[a.o]).length > 0;
    return stripTags(a.t).length > 0;
  }

  // ================================================================ boot
  async function boot() {
    if (!attemptId) {
      location.replace('/home');
      return;
    }
    let data;
    const t0 = Date.now();
    try {
      data = await API.get(`/api/exam?action=load&attempt=${attemptId}`);
    } catch (e) {
      app.innerHTML = `<div class="page paused-page"><div class="paused-card"><h1>We couldn't open this exam</h1><p>${esc(e.message)}</p><a class="btn-yellow" href="/home">Return to Home</a></div></div>`;
      return;
    }
    S.clockOffset = data.now - (t0 + Date.now()) / 2;
    S.user = data.user;
    S.test = data.test;
    S.answers = data.answers || {};
    S.attempt = data.attempt;
    S.results = data.results || null;
    S.settings = Object.assign(
      { warningMinutes: 5, ruleColors: true, crossOut: true, showResults: 'none', allowBack: true },
      S.test.settings || {}
    );
    S.elim = S.settings.crossOut !== false;
    S.showResults = new URLSearchParams(location.search).get('view') === 'results' && !!S.results;
    applyRules();
    document.title = `${S.test.title} · ${U.appName}`;
    const v = data.view || {};
    if (v.section === S.attempt.sectionIndex && Number.isInteger(v.q)) S.qIndex = Math.max(0, Math.min(v.q, sec().questions.length - 1));
    if (v.section === S.attempt.sectionIndex && v.screen === 'review') S.screen = 'review';
    S.ubreak = !!v.ubreak && S.attempt.phase === 'section';
    loadPrefs();
    Annot.load(attemptId);
    render();
    if (S.attempt.message) showMessage(S.attempt.message);
    setInterval(tick, 250);
    setInterval(() => sync(), 4000);
    installFocusTracking();
    installGuards();
  }

  // The colored dashed rules: Bluebook's fixed 28-dash color cycle (looks random, repeats).
  function applyRules() {
    const cycle = 'YBDDDDDDLDDLDYBDLDLYLDDDDDDL';
    const colored = S.settings.ruleColors !== false;
    const make = (start, dash, gap, dark) => {
      const col = colored ? { D: dark, L: '#b7b7b7', Y: '#fedb00', B: '#0093db' } : { D: '#b1b1b1', L: '#b1b1b1', Y: '#b1b1b1', B: '#b1b1b1' };
      const seq = cycle.slice(start) + cycle.slice(0, start);
      const pitch = dash + gap;
      const w = +(seq.length * pitch).toFixed(2);
      const rects = [...seq].map((c, i) => `<rect x='${(i * pitch).toFixed(2)}' y='0' width='${dash}' height='2' fill='${col[c]}'/>`).join('');
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='2' viewBox='0 0 ${w} 2' preserveAspectRatio='none'>${rects}</svg>`;
      return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    };
    const root = document.documentElement.style;
    root.setProperty('--rule-main', make(27, 18, 1, '#404040'));
    root.setProperty('--rule-q', make(26, 13.7, 1, '#333333'));
  }

  function prefsKey() {
    return `mx-prefs-${attemptId}`;
  }
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(prefsKey()) || '{}');
      if (p.split >= 25 && p.split <= 75) S.split = p.split;
      if (typeof p.elim === 'boolean') S.elim = p.elim;
      if (p.docIdx) S.docIdx = p.docIdx;
    } catch {
      /* ignore */
    }
  }
  function savePrefs() {
    try {
      localStorage.setItem(prefsKey(), JSON.stringify({ split: S.split, elim: S.elim, docIdx: S.docIdx }));
    } catch {
      /* ignore */
    }
  }

  // ================================================================ server sync
  let syncTimer = null;
  function queueSync(delay = 400) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => sync(), delay);
  }

  function viewState() {
    const a = S.attempt;
    let screen = 'question';
    if (a.status === 'paused') screen = 'paused';
    else if (a.status === 'completed' || a.phase === 'done') screen = 'done';
    else if (a.phase === 'directions') screen = 'directions';
    else if (a.phase === 'break') screen = 'break';
    else if (S.ubreak) screen = 'ubreak';
    else screen = S.screen;
    return { screen, section: a.sectionIndex, q: S.qIndex, ubreak: S.ubreak };
  }

  async function sync() {
    if (!S.attempt) return;
    if (S.syncing) {
      S.syncAgain = true;
      return;
    }
    S.syncing = true;
    if (S.editor) S.editor.flush();
    const sent = [...S.dirty];
    const answers = {};
    for (const id of sent) answers[id] = S.answers[id];
    const answersSection = S.dirtySection;
    S.dirty.clear();
    const t0 = Date.now();
    try {
      const res = await API.post('/api/exam', { action: 'sync', attemptId, view: viewState(), answers, answersSection });
      S.clockOffset = res.now - (t0 + Date.now()) / 2;
      if (S.failures >= 2) setOffline(false);
      S.failures = 0;
      if (!S.dirty.size) S.dirtySection = null;
      applyAttempt(res.attempt);
    } catch (e) {
      for (const id of sent) S.dirty.add(id);
      if (answersSection != null && S.dirtySection == null) S.dirtySection = answersSection;
      S.failures++;
      if (S.failures >= 2) setOffline(true);
    } finally {
      S.syncing = false;
      if (S.syncAgain) {
        S.syncAgain = false;
        queueSync(200);
      }
    }
  }

  function flushOnLeave() {
    if (!S.attempt || !S.dirty.size) return;
    if (S.editor) S.editor.flush();
    const answers = {};
    for (const id of S.dirty) answers[id] = S.answers[id];
    API.post('/api/exam', { action: 'sync', attemptId, view: viewState(), answers, answersSection: S.dirtySection }, { keepalive: true }).catch(() => {});
  }
  window.addEventListener('pagehide', () => {
    if (!S.unloading && S.attempt && S.attempt.status === 'active' && S.attempt.phase === 'section' && !S.ubreak) logEvent('page_left');
    S.unloading = true;
    flushOnLeave();
  });
  window.addEventListener('beforeunload', () => {
    if (S.attempt && S.attempt.status === 'active' && S.attempt.phase === 'section' && !S.ubreak) logEvent('page_left');
    S.unloading = true;
  });

  const phaseKey = (a) => (a ? `${a.status}|${a.phase}|${a.sectionIndex}` : '');

  function applyAttempt(next) {
    const prev = S.attempt;
    S.attempt = next;
    if (next.message && next.message.id !== S.shownMessage) showMessage(next.message);
    if (phaseKey(prev) !== phaseKey(next)) {
      const sectionChanged = !prev || prev.sectionIndex !== next.sectionIndex || prev.phase !== next.phase;
      if (sectionChanged && next.phase === 'section' && prev && prev.phase !== 'section') {
        S.qIndex = 0;
        S.screen = 'question';
      }
      if (next.phase !== 'section') S.ubreak = false;
      if (sectionChanged) {
        S.timerHidden = false;
        S.fiveMinShown = false;
      }
      render();
      if (next.status === 'completed' && S.settings.showResults !== 'none' && !S.results) fetchResults();
    }
  }

  async function fetchResults() {
    try {
      const d = await API.get(`/api/exam?action=load&attempt=${attemptId}`);
      if (d.results) {
        S.results = d.results;
        if (S.attempt.status === 'completed' && !S.showResults) render();
      }
    } catch {
      /* results are optional */
    }
  }

  function markDirty(qid) {
    S.dirty.add(qid);
    S.dirtySection = S.attempt.sectionIndex;
    queueSync(350);
  }

  function setOffline(on) {
    let bar = document.querySelector('.offline-bar');
    if (on && !bar) {
      bar = U.el('<div class="offline-bar" role="status">You’re offline. Keep working — your answers will be saved when the connection comes back.</div>');
      document.body.appendChild(bar);
    }
    if (!on && bar) bar.remove();
  }

  // ================================================================ clock
  function tick() {
    const a = S.attempt;
    if (!a) return;
    if (a.status === 'active' && a.phase === 'section') {
      const left = (a.sectionEndsAt - now()) / 1000;
      updateTimer(left);
      if (left <= 0 && !S.expiring) {
        S.expiring = true;
        sync().finally(() => setTimeout(() => (S.expiring = false), 1500));
      }
    } else if (a.status === 'active' && a.phase === 'break') {
      updateBreak((a.breakEndsAt - now()) / 1000);
    }
  }

  function updateTimer(left) {
    const t = app.querySelector('.tu-timer');
    const ub = app.querySelector('.ub-time');
    const txt = fmtClock(left);
    if (ub) ub.textContent = txt;
    if (!t) return;
    const warn = (Number(S.settings.warningMinutes) || 0) * 60;
    const under = warn > 0 && left <= warn;
    if (under && !S.fiveMinShown) {
      S.fiveMinShown = true;
      // Pop the alert only when the moment is crossed while testing (not on a reload afterwards).
      if (left > warn - 15) showTimeWarning();
    }
    const head = app.querySelector('.tu-head');
    if (head && head.classList.contains('under-warn') !== under) {
      head.classList.toggle('under-warn', under);
      if (under) S.timerHidden = false;
      syncTimerVisibility();
    }
    t.classList.toggle('red', left <= (warn || 300));
    if (t.textContent !== txt) t.textContent = txt;
  }

  function showTimeWarning() {
    closeTimeWarning();
    const m = Math.round((Number(S.settings.warningMinutes) || 5) * 10) / 10;
    const unit = m === 1 ? 'Minute' : 'Minutes';
    const pop = U.el(
      '<div class="time-warn" role="alertdialog" aria-live="assertive" aria-label="Time warning">' +
        `<div class="tw-ic">${icon.stopwatch}</div>` +
        `<div class="tw-text"><b>${m} ${unit} Remaining</b><span>You have ${m} ${unit.toLowerCase()} left in this section. The timer can no longer be hidden.</span></div>` +
        `<button type="button" class="tw-close" data-act="close-warn" aria-label="Close">${icon.close}</button>` +
        '</div>'
    );
    app.appendChild(pop);
  }
  function closeTimeWarning() {
    app.querySelectorAll('.time-warn').forEach((n) => n.remove());
  }

  function syncTimerVisibility() {
    const head = app.querySelector('.tu-head');
    if (!head) return;
    head.classList.toggle('timer-hidden', S.timerHidden);
    const b = head.querySelector('[data-act="timer"]');
    b.textContent = S.timerHidden ? 'Show' : 'Hide';
    b.setAttribute('aria-label', S.timerHidden ? 'Show timer' : 'Hide timer');
  }

  function updateBreak(left) {
    const t = app.querySelector('.brk-time');
    if (!t) return;
    t.textContent = fmtClock(left);
    const b = app.querySelector('[data-act="end-break"]');
    if (b) b.hidden = !(left <= 0 || (S.test.settings && S.test.settings.earlyBreakEnd));
  }

  // ================================================================ render dispatch
  function render() {
    closePopovers();
    Annot.unmountAll();
    if (S.editor) {
      S.editor.destroy();
      S.editor = null;
    }
    const a = S.attempt;
    if (a.status === 'paused') return renderPaused();
    if (a.status === 'completed' || a.phase === 'done') return S.showResults && S.results ? renderResults() : renderFinish();
    if (a.phase === 'directions') return renderDirectionsPage();
    if (a.phase === 'break') return renderBreak();
    if (S.ubreak) return renderUnscheduledBreak();
    return renderTest();
  }

  // ================================================================ test shell
  function renderTest() {
    const s = sec();
    app.innerHTML =
      '<div class="tu">' +
      `<header class="tu-head${S.timerHidden ? ' timer-hidden' : ''}">` +
      `<div class="tu-hl"><div class="tu-title">${esc(s.title)}</div>` +
      `<button type="button" class="tu-dir" data-act="dir" aria-expanded="false">Directions ${icon.chevDown}</button></div>` +
      '<div class="tu-hc"><div class="tu-timer" role="timer" aria-live="off">' + fmtClock((S.attempt.sectionEndsAt - now()) / 1000) + '</div>' +
      `<div class="tu-stopwatch" aria-hidden="true">${icon.stopwatch}</div>` +
      `<button type="button" class="tu-pill" data-act="timer">${S.timerHidden ? 'Show' : 'Hide'}</button></div>` +
      '<div class="tu-hr"><div class="tu-battery" hidden></div><div class="tu-tools">' +
      `<button type="button" class="tu-tool" data-act="hl"><span class="ic">${icon.highlighter}${icon.note}</span><span class="lbl">Highlights &amp; Notes</span></button>` +
      (s.reference ? `<button type="button" class="tu-tool" data-act="ref" data-tool="ref" aria-expanded="false"><span class="ic">${icon.reference}</span><span class="lbl">Reference</span></button>` : '') +
      `<button type="button" class="tu-tool" data-act="more" data-tool="more" aria-expanded="false"><span class="ic">${icon.moreVert}</span><span class="lbl">More</span></button>` +
      '</div></div></header>' +
      '<main class="tu-main"><div class="tu-body"></div></main>' +
      '<footer class="tu-foot"><div class="tu-fl"></div>' +
      `<div class="tu-fc"><button type="button" class="tu-qnav" data-act="qnav" aria-expanded="false"><span class="qn-label"></span>${icon.chevUp}</button></div>` +
      '<div class="tu-fr"><button type="button" class="btn-blue" data-act="back">Back</button><button type="button" class="btn-blue" data-act="next">Next</button></div>' +
      '</footer></div>';
    S.el = {
      main: app.querySelector('.tu-main'),
      body: app.querySelector('.tu-body'),
    };
    U.battery(app.querySelector('.tu-battery'));
    renderBody();
    tick();
  }

  function updateFooter() {
    const s = sec();
    const fc = app.querySelector('.tu-fc');
    const back = app.querySelector('[data-act="back"]');
    const next = app.querySelector('[data-act="next"]');
    if (!fc) return;
    const label = app.querySelector('.qn-label');
    if (S.screen === 'review') {
      fc.style.visibility = 'hidden';
      back.hidden = false;
      next.hidden = !(S.test.settings && S.test.settings.allowEarlySubmit);
      next.textContent = 'Submit';
    } else {
      fc.style.visibility = '';
      label.textContent = `Question ${S.qIndex + 1} of ${s.questions.length}`;
      back.hidden = S.qIndex === 0 || S.settings.allowBack === false;
      next.hidden = false;
      next.textContent = 'Next';
    }
  }

  async function goTo(index, screen = 'question') {
    if (S.loading) return;
    closePopovers();
    Annot.hideToolbar();
    if (S.editor) S.editor.flush();
    S.loading = true;
    S.el.main.classList.add('is-loading');
    app.querySelectorAll('.tu-fr button, .tu-qnav').forEach((b) => (b.disabled = true));
    const [lo, hi] = (S.test.settings && S.test.settings.loadDelayMs) || [250, 650];
    await sleep(lo + Math.random() * Math.max(0, hi - lo));
    S.qIndex = index;
    S.screen = screen;
    if (S.attempt.phase === 'section' && !S.ubreak && app.querySelector('.tu')) renderBody();
    S.el.main && S.el.main.classList.remove('is-loading');
    app.querySelectorAll('.tu-fr button, .tu-qnav').forEach((b) => (b.disabled = false));
    S.loading = false;
    queueSync(250);
  }

  // ================================================================ body: question / review
  function passageIdFor(s, q) {
    if (q.type === 'frq' && q.choose) {
      const a = S.answers[q.id] || {};
      const o = Number.isInteger(a.o) ? q.choose[a.o] : null;
      return (o && o.passage) || q.passage || null;
    }
    return q.passage || null;
  }

  function renderBody() {
    Annot.unmountAll();
    if (S.editor) {
      S.editor.destroy();
      S.editor = null;
    }
    const s = sec();
    const body = S.el.body;
    if (S.screen === 'review') {
      body.innerHTML = reviewHTML(s);
      updateFooter();
      return;
    }
    const q = s.questions[S.qIndex];
    const pid = passageIdFor(s, q);
    const pFull = pid ? s.passages[pid] : null;
    const p = pFull && q.layout !== 'centered' ? pFull : null;
    body.innerHTML = p ? splitHTML(s, q, p) : centeredHTML(s, q, pFull);
    const cp = body.querySelector('.center-passage');
    if (cp) Annot.mount(cp, `p:${s.index}:${pFull.id}`, { after: (c) => applyRefs(c, q) });

    if (p) {
      const pc = body.querySelector('.passage');
      const di = p.documents ? docIndex(s, p) : null;
      Annot.mount(pc, `p:${s.index}:${p.id}${di != null ? `:d${di}` : ''}`, { after: (c) => applyRefs(c, q) });
      const sc = body.querySelector('.pane-left .pane-scroll');
      const key = `${s.index}:${p.id}:${di}`;
      if (key === S.passKey) sc.scrollTop = S.passScroll;
      else S.passScroll = 0;
      S.passKey = key;
      sc.addEventListener('scroll', () => (S.passScroll = sc.scrollTop), { passive: true });
      wireDivider();
    } else {
      S.passKey = null;
    }
    const stem = body.querySelector('.q-stem');
    if (stem) Annot.mount(stem, `stem:${q.id}`);
    if (q.type === 'frq') mountEditor(s, q);
    updateFooter();
  }

  function docIndex(s, p) {
    const k = `${s.index}:${p.id}`;
    const i = S.docIdx[k] || 0;
    return Math.min(i, p.documents.length - 1);
  }

  function splitHTML(s, q, p) {
    const di = p.documents ? docIndex(s, p) : null;
    const tabs = p.documents
      ? `<div class="doc-tabs" role="tablist">${p.documents
          .map((d, i) => `<button type="button" class="doc-tab" role="tab" data-act="doc" data-i="${i}" aria-selected="${i === di}">${esc(String(i + 1))}</button>`)
          .join('')}</div>`
      : '';
    return (
      `<div class="split" style="--left:${S.split}%">` +
      `<section class="pane pane-left" aria-label="Passage"><div class="pane-scroll"><div class="pane-inner">${tabs}<div class="passage">${passageHTML(p, di)}</div></div></div></section>` +
      `<div class="divider"><button type="button" class="handle" aria-label="Drag to resize the panels">${icon.handle}</button></div>` +
      `<section class="pane pane-right" aria-label="Question"><div class="pane-scroll"><div class="pane-inner${q.type === 'frq' ? ' frq' : ''}">${questionHTML(s, q)}</div></div></section>` +
      '</div>'
    );
  }

  function centeredHTML(s, q, p) {
    const above = p ? `<div class="passage center-passage">${passageHTML(p, p.documents ? docIndex(s, p) : null)}</div>` : '';
    return `<div class="center-scroll"><div class="center-col${q.type === 'frq' ? ' frq' : ''}">${above}${questionHTML(s, q)}</div></div>`;
  }

  function passageHTML(p, di) {
    let h = '';
    if (p.heading) h += `<h2 class="p-heading">${p.heading}</h2>`;
    if (p.intro) h += `<div class="p-intro">${p.intro}</div>`;
    if (p.documents) {
      const d = p.documents[di];
      h += `<div class="doc-head">${esc(d.label)}</div>`;
      if (d.title) h += `<p><i>${d.title}</i></p>`;
      h += figures(d.images || (d.image ? [{ src: d.image }] : null));
      if (d.html) h += `<div class="p-html">${d.html}</div>`;
      if (d.source) h += `<div class="p-source">${d.source}</div>`;
    }
    const legacy = p.image ? [{ src: p.image, alt: p.imageAlt, caption: p.caption }] : null;
    const pImgs = p.images || legacy;
    const imgsFirst = p.imagesFirst || !!legacy;
    if (imgsFirst) h += figures(pImgs);
    if (p.title) h += `<h3 class="p-title">${p.title}</h3>`;
    if (p.lines) {
      let n = 0;
      h += '<div class="poem">';
      for (const line of p.lines) {
        if (!String(line).trim()) {
          h += '<div class="pl-gap"></div>';
          continue;
        }
        n++;
        const label = p.numbering !== false && n % 5 === 0 ? (n === 5 ? 'Line 5' : String(n)) : '';
        h += `<div class="pl" data-line="${n}"${label ? ` data-ln="${label}"` : ''}><span class="pl-t">${line}</span></div>`;
      }
      h += '</div>';
    }
    if (p.html) h += `<div class="p-html">${p.html}</div>`;
    if (!imgsFirst) h += figures(pImgs);
    if (p.source) h += `<div class="p-source">${p.source}</div>`;
    return h;
  }

  function figures(list) {
    if (!list || !list.length) return '';
    return list
      .map((im) => {
        const w = im.width ? (/^\d+$/.test(String(im.width)) ? `${im.width}px` : String(im.width)) : '';
        return (
          '<figure class="p-fig">' +
          `<button type="button" class="zoomable" data-act="zoom" data-src="${esc(im.src)}" aria-label="Enlarge image">` +
          `<img src="${esc(im.src)}" alt="${esc(im.alt || '')}"${w ? ` style="width:${esc(w)}"` : ''}></button>` +
          (im.caption ? `<figcaption>${im.caption}</figcaption>` : '') +
          '</figure>'
        );
      })
      .join('');
  }

  function openLightbox(src) {
    const box = U.el(
      `<div class="lightbox" role="dialog" aria-label="Enlarged image"><img src="${esc(src)}" alt=""><button type="button" class="lb-close" aria-label="Close">${icon.close}</button><div class="lb-hint">Click the image to zoom · Esc to close</div></div>`
    );
    const img = box.querySelector('img');
    box.addEventListener('click', (e) => {
      if (e.target === img) img.classList.toggle('full');
      else box.remove();
    });
    document.body.appendChild(box);
  }

  function applyRefs(container, q) {
    if (q.refLines) {
      const [a, b] = q.refLines;
      container.querySelectorAll('.pl[data-line]').forEach((elx) => {
        const n = Number(elx.dataset.line);
        elx.classList.toggle('ref-on', n >= a && n <= b);
      });
    }
    if (q.ref) {
      container.querySelectorAll('[data-ref]').forEach((elx) => elx.classList.toggle('ref-on', elx.dataset.ref === q.ref));
    }
  }

  function stemHTML(q, promptHtml) {
    let html = promptHtml != null ? promptHtml : q.prompt || '';
    if ((q.refLines || q.ref) && html.includes('»')) {
      const i = html.indexOf('»');
      html =
        html.slice(0, i) +
        `<button type="button" class="jump" data-act="jump" aria-label="Go to the part of the passage this question refers to">${icon.jump}</button>` +
        html.slice(i + 1);
    }
    return html;
  }

  function questionHTML(s, q) {
    const a = S.answers[q.id] || {};
    let h =
      '<div class="q-bar">' +
      `<div class="q-num">${q.number}</div>` +
      `<button type="button" class="q-review" data-act="flag" aria-pressed="${!!a.r}">${a.r ? icon.bookmarkOn : icon.bookmark}<span>Mark for Review</span></button>` +
      (q.type === 'mcq'
        ? `<button type="button" class="q-elim" data-act="elim" aria-pressed="${S.elim}" aria-label="Cross out answer choices" title="Cross out answer choices">${icon.abc}</button>`
        : '') +
      '</div>';
    const imgs = figures(q.images);
    const stem = `<div class="q-stem">${q.imagesFirst ? imgs : ''}${stemHTML(q)}${q.imagesFirst ? '' : imgs}</div>`;
    if (q.type === 'mcq') {
      h += `<div class="qcol${S.elim ? ' elim-on' : ''}">${stem}<div class="choices" role="radiogroup" aria-label="Answer choices">${choicesHTML(q)}</div></div>`;
      return h;
    }
    if (q.type === 'input') {
      const v = a.v || '';
      h +=
        `<div class="qcol">${stem}<div class="spr">` +
        (q.inputLabel ? `<label class="spr-label" for="spr-${esc(q.id)}">${q.inputLabel}</label>` : '') +
        `<input id="spr-${esc(q.id)}" class="spr-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="${q.maxLength || 12}" value="${esc(v)}" aria-label="Your answer">` +
        `<div class="spr-preview">Answer Preview: <b class="spr-val">${esc(v)}</b></div></div></div>`;
      return h;
    }
    h += stem;
    let showEditor = true;
    if (q.choose) {
      const o = Number.isInteger(a.o) ? a.o : null;
      h +=
        '<div class="frq-options" role="radiogroup" aria-label="Choose one question">' +
        q.choose
          .map(
            (opt, i) =>
              `<button type="button" class="frq-opt" role="radio" data-act="frq-opt" data-o="${i}" aria-checked="${o === i}"><span class="radio"></span><span><b>${esc(opt.label)}</b>${opt.prompt}</span></button>`
          )
          .join('') +
        '</div>';
      showEditor = o != null;
    }
    if (s.responseMode === 'paper') {
      h += '<div class="frq-paper">Write your response to this question in your free-response booklet. You can still read the question and passage here, and mark it for review.</div>';
    } else if (showEditor) {
      h += '<div class="frq-saved">Your response will be saved automatically.</div><div class="rte"></div>';
    }
    return h;
  }

  function choicesHTML(q) {
    const a = S.answers[q.id] || {};
    const out = a.x || [];
    return q.choices
      .map((c, i) => {
        const L = LETTERS[i];
        const sel = a.c === L;
        const x = out.includes(L);
        return (
          `<div class="choice${sel ? ' sel' : ''}${x ? ' out' : ''}">` +
          `<button type="button" class="choice-btn" data-act="choose" data-l="${L}" role="radio" aria-checked="${sel}"><span class="choice-letter">${L}</span><span class="choice-text">${choiceContent(c)}</span></button>` +
          (x
            ? `<button type="button" class="choice-undo" data-act="uncross" data-l="${L}" aria-label="Undo cross out of ${L}">Undo</button>`
            : `<button type="button" class="choice-x" data-act="cross" data-l="${L}" aria-label="Cross out answer choice ${L}"><span class="cx-circle">${L}</span></button>`) +
          '</div>'
        );
      })
      .join('');
  }

  function choiceContent(c) {
    if (typeof c === 'string') return c;
    const imgs = (c.images || []).map((im) => `<img class="choice-img" src="${esc(im.src)}" alt="${esc(im.alt || '')}">`).join('');
    return `${c.text || ''}${imgs}`;
  }

  function refreshChoices() {
    const s = sec();
    const q = s.questions[S.qIndex];
    const box = S.el.body.querySelector('.choices');
    if (box) box.innerHTML = choicesHTML(q);
  }

  function mountEditor(s, q) {
    const root = S.el.body.querySelector('.rte');
    if (!root) return;
    const a = ans(q.id);
    const opt = q.choose ? a.o : null;
    const html = q.choose ? (a.ts && a.ts[opt]) || '' : a.t || '';
    S.editor = RTE.mount(root, {
      html,
      onChange: (val) => {
        const cur = ans(q.id);
        if (q.choose) {
          cur.ts = cur.ts || {};
          cur.ts[opt] = val;
        } else cur.t = val;
        markDirty(q.id);
      },
      onBlockedPaste: () => {
        toast('You can only paste text that you copied from your own response.');
        logEvent('paste_blocked');
      },
    });
  }

  function reviewHTML(s) {
    const early = S.test.settings && S.test.settings.allowEarlySubmit;
    return (
      '<div class="review-scroll"><div class="review">' +
      '<h1>Check Your Work</h1>' +
      '<p>Look over your answers, go back to questions you marked for review, and answer any questions you skipped.<br>Remember: there’s no penalty for guessing.</p>' +
      (early
        ? '<p>When you’re done, click <b>Submit</b> to move on. If the timer reaches zero first, you’ll move on automatically.</p>'
        : '<p>When the timer reaches zero, you’ll automatically move on. <b>Please stay seated and remain quiet.</b></p>') +
      '<div class="review-card"><div class="rc-head">' +
      `<h2>${esc(s.navTitle)}</h2>` +
      `<div class="rc-legend"><span>${icon.dashedBox}Unanswered</span><span class="lg-flag">${icon.bookmarkOn}For Review</span></div>` +
      `</div><div class="rgrid">${gridCells(s, false)}</div></div>` +
      '</div></div>'
    );
  }

  function gridCells(s, showCurrent) {
    return s.questions
      .map((q, i) => {
        const a = S.answers[q.id];
        const done = isAnswered(q, a);
        const cur = showCurrent && i === S.qIndex && S.screen === 'question';
        const locked = S.settings.allowBack === false && i < S.qIndex;
        return (
          `<button type="button"${locked ? ' disabled' : ''} class="qcell${done ? ' answered' : ''}${cur ? ' current' : ''}" data-act="goto" data-i="${i}" aria-label="Question ${q.number}${done ? ', answered' : ', unanswered'}${a && a.r ? ', marked for review' : ''}">` +
          (cur ? `<span class="cell-pin">${icon.pin}</span>` : '') +
          `<span>${q.number}</span>` +
          (a && a.r ? `<span class="cell-flag">${icon.flagSmall}</span>` : '') +
          '</button>'
        );
      })
      .join('');
  }

  // ================================================================ divider
  function wireDivider() {
    const handle = S.el.body.querySelector('.handle');
    const split = S.el.body.querySelector('.split');
    if (!handle || !split) return;
    const setPct = (pct) => {
      S.split = Math.max(25, Math.min(75, pct));
      split.style.setProperty('--left', `${S.split}%`);
    };
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      split.classList.add('dragging');
      Annot.hideToolbar();
      const r = split.getBoundingClientRect();
      const move = (ev) => setPct(((ev.clientX - r.left) / r.width) * 100);
      const up = () => {
        split.classList.remove('dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        Annot.redrawAll();
        savePrefs();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    handle.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        setPct(S.split + (e.key === 'ArrowLeft' ? -5 : 5));
        Annot.redrawAll();
        savePrefs();
      }
    });
  }

  // ================================================================ popovers
  function closePopovers() {
    app.querySelectorAll('.click-catcher, .dir-pop, .qnav-pop, .more-menu, .tip-pop').forEach((n) => n.remove());
    app.querySelectorAll('[aria-expanded="true"]').forEach((n) => n.setAttribute('aria-expanded', 'false'));
  }

  function openPopover(html, trigger) {
    closePopovers();
    const catcher = U.el('<div class="click-catcher"></div>');
    catcher.addEventListener('mousedown', (e) => e.preventDefault());
    catcher.addEventListener('click', () => closePopovers());
    const pop = U.el(html);
    app.appendChild(catcher);
    app.appendChild(pop);
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    return pop;
  }

  function openDirections(trigger) {
    const s = sec();
    openPopover(
      `<div class="dir-pop" role="dialog" aria-label="Directions"><div class="dir-body">${s.directions}</div>` +
        '<div class="dir-foot"><button type="button" class="btn-yellow" data-act="close-pop">Close</button></div></div>',
      trigger
    );
  }

  function openNavigator(trigger) {
    const s = sec();
    openPopover(
      '<div class="qnav-pop" role="dialog" aria-label="Question navigation">' +
        `<div class="qnav-head"><h2>${esc(s.navTitle)}</h2><button type="button" class="qnav-close" data-act="close-pop" aria-label="Close">${icon.close}</button></div>` +
        `<div class="legend"><span class="lg-pin">${icon.pin}Current</span><span class="lg-box">${icon.dashedBox}Unanswered</span><span class="lg-flag">${icon.bookmarkOn}For Review</span></div>` +
        `<div class="qgrid">${gridCells(s, true)}</div>` +
        '<div class="qnav-go"><button type="button" class="btn-outline" data-act="go-review">Go to Review Page</button></div>' +
        '</div>',
      trigger
    );
  }

  function openMore(trigger) {
    openPopover(
      '<div class="more-menu" role="menu">' +
        `<button type="button" role="menuitem" data-act="ubreak">${icon.breakIcon}<span>Unscheduled Break</span></button>` +
        `<button type="button" role="menuitem" data-act="exit">${icon.warning}<span>Exit the Exam</span></button>` +
        '</div>',
      trigger
    );
  }

  function openReference(trigger) {
    const s = sec();
    const existing = document.querySelector('.ref-pop');
    if (existing) {
      existing.remove();
      trigger.setAttribute('aria-expanded', 'false');
      return;
    }
    const pop = U.el(
      '<div class="ref-pop" role="dialog" aria-label="Reference">' +
        `<div class="ref-head"><span>Reference</span><button type="button" data-act="ref-close" aria-label="Close reference">${icon.close}</button></div>` +
        `<div class="ref-body">${s.reference
          .map((r, i) => `<div class="ref-sec${i === 0 ? ' open' : ''}"><button type="button" data-act="ref-toggle">${esc(r.title)}${icon.chevDown}</button><div class="ref-content">${r.html}</div></div>`)
          .join('')}</div></div>`
    );
    document.body.appendChild(pop);
    trigger.setAttribute('aria-expanded', 'true');
    const head = pop.querySelector('.ref-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = pop.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      head.setPointerCapture(e.pointerId);
      const move = (ev) => {
        pop.style.left = `${Math.max(0, Math.min(window.innerWidth - 120, ev.clientX - dx))}px`;
        pop.style.top = `${Math.max(0, Math.min(window.innerHeight - 60, ev.clientY - dy))}px`;
        pop.style.right = 'auto';
      };
      const up = () => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
    });
    pop.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'ref-close') {
        pop.remove();
        trigger.setAttribute('aria-expanded', 'false');
      } else if (b.dataset.act === 'ref-toggle') b.parentElement.classList.toggle('open');
    });
  }

  function showTip(trigger, text) {
    closePopovers();
    const r = trigger.getBoundingClientRect();
    const pop = openPopover(`<div class="tip-pop" role="status">${esc(text)}</div>`, null);
    pop.style.top = `${r.bottom + 10}px`;
    pop.style.left = `${Math.max(10, Math.min(r.left + r.width / 2 - 145, window.innerWidth - 300))}px`;
    setTimeout(() => {
      if (pop.isConnected) closePopovers();
    }, 4500);
  }

  // ================================================================ click handling
  app.addEventListener('mousedown', (e) => {
    if (e.target.closest('[data-act="hl"]')) e.preventDefault(); // keep the text selection
  });

  app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    const s = S.attempt && S.attempt.phase === 'section' ? sec() : null;
    const q = s && S.screen === 'question' ? s.questions[S.qIndex] : null;
    switch (act) {
      case 'dir':
        if (b.getAttribute('aria-expanded') === 'true') closePopovers();
        else openDirections(b);
        break;
      case 'close-pop':
        closePopovers();
        break;
      case 'timer':
        if (app.querySelector('.tu-head.under-warn')) break;
        S.timerHidden = !S.timerHidden;
        syncTimerVisibility();
        break;
      case 'hl':
        if (!Annot.highlightSelection()) showTip(b, 'Select text in a passage or question to highlight it, underline it, or add a note.');
        break;
      case 'ref':
        openReference(b);
        break;
      case 'more':
        if (b.getAttribute('aria-expanded') === 'true') closePopovers();
        else openMore(b);
        break;
      case 'qnav':
        if (b.getAttribute('aria-expanded') === 'true') closePopovers();
        else openNavigator(b);
        break;
      case 'goto':
        goTo(Number(b.dataset.i), 'question');
        break;
      case 'go-review':
        goTo(S.qIndex, 'review');
        break;
      case 'next':
        if (S.screen === 'review') return submitEarly();
        if (S.qIndex < s.questions.length - 1) goTo(S.qIndex + 1);
        else goTo(S.qIndex, 'review');
        break;
      case 'back':
        if (S.screen === 'review') goTo(S.qIndex, 'question');
        else if (S.qIndex > 0) goTo(S.qIndex - 1);
        break;
      case 'flag': {
        const a = ans(q.id);
        a.r = !a.r;
        b.setAttribute('aria-pressed', String(a.r));
        b.innerHTML = `${a.r ? icon.bookmarkOn : icon.bookmark}<span>Mark for Review</span>`;
        markDirty(q.id);
        break;
      }
      case 'elim':
        S.elim = !S.elim;
        b.setAttribute('aria-pressed', String(S.elim));
        S.el.body.querySelector('.qcol').classList.toggle('elim-on', S.elim);
        savePrefs();
        break;
      case 'choose': {
        const a = ans(q.id);
        const L = b.dataset.l;
        a.c = L;
        a.x = (a.x || []).filter((x) => x !== L);
        refreshChoices();
        markDirty(q.id);
        break;
      }
      case 'cross': {
        const a = ans(q.id);
        const L = b.dataset.l;
        a.x = [...new Set([...(a.x || []), L])];
        if (a.c === L) a.c = null;
        refreshChoices();
        markDirty(q.id);
        break;
      }
      case 'uncross': {
        const a = ans(q.id);
        a.x = (a.x || []).filter((x) => x !== b.dataset.l);
        refreshChoices();
        markDirty(q.id);
        break;
      }
      case 'jump':
        jumpToRef();
        break;
      case 'zoom':
        openLightbox(b.dataset.src);
        break;
      case 'close-warn':
        closeTimeWarning();
        break;
      case 'results':
        S.showResults = true;
        render();
        break;
      case 'finish':
        S.showResults = false;
        render();
        break;
      case 'doc': {
        const p = s.passages[passageIdFor(s, q)];
        S.docIdx[`${s.index}:${p.id}`] = Number(b.dataset.i);
        savePrefs();
        renderBody();
        break;
      }
      case 'frq-opt': {
        const a = ans(q.id);
        const o = Number(b.dataset.o);
        if (a.o === o) break;
        if (S.editor) S.editor.flush();
        a.o = o;
        markDirty(q.id);
        renderBody();
        break;
      }
      case 'ubreak':
        closePopovers();
        startUnscheduledBreak();
        break;
      case 'exit':
        closePopovers();
        exitExam();
        break;
      case 'begin':
        beginSection(b);
        break;
      case 'end-break':
        endBreak(b);
        break;
      case 'resume-ubreak':
        endUnscheduledBreak();
        break;
      case 'home':
        location.href = '/home';
        break;
      case 'help':
        modal({ title: 'Need help?', body: '<p>Raise your hand or ask your proctor for help.</p>', actions: [{ id: 'ok', label: 'OK', kind: 'yellow' }] });
        break;
      default:
        break;
    }
  });

  app.addEventListener('input', (e) => {
    const inp = e.target.closest && e.target.closest('.spr-input');
    if (!inp || !S.attempt || S.attempt.phase !== 'section') return;
    const q = sec().questions[S.qIndex];
    if (!q || q.type !== 'input') return;
    ans(q.id).v = inp.value;
    const pv = S.el.body.querySelector('.spr-val');
    if (pv) pv.textContent = inp.value;
    markDirty(q.id);
  });

  function jumpToRef() {
    const sc = S.el.body.querySelector('.pane-left .pane-scroll');
    const target = S.el.body.querySelector('.passage .ref-on');
    if (!sc || !target) return;
    const top = target.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 28;
    sc.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  // ================================================================ actions
  async function beginSection(btn) {
    btn.disabled = true;
    try {
      const res = await API.post('/api/exam', { action: 'begin', attemptId });
      S.qIndex = 0;
      S.screen = 'question';
      S.timerHidden = false;
      S.fiveMinShown = false;
      applyAttempt(res.attempt);
    } catch (e) {
      btn.disabled = false;
      toast(e.message);
    }
  }

  async function endBreak(btn) {
    btn.disabled = true;
    try {
      const res = await API.post('/api/exam', { action: 'endBreak', attemptId });
      applyAttempt(res.attempt);
    } catch (e) {
      btn.disabled = false;
      toast(e.message);
    }
  }

  async function submitEarly() {
    const id = await modal({
      title: 'Submit this section?',
      body: '<p>You won’t be able to come back to these questions after you move on.</p>',
      actions: [
        { id: 'cancel', label: 'Cancel', kind: 'plain' },
        { id: 'ok', label: 'Submit Section', kind: 'yellow' },
      ],
    });
    if (id !== 'ok') return;
    await sync();
    try {
      const res = await API.post('/api/exam', { action: 'submitSection', attemptId });
      applyAttempt(res.attempt);
    } catch (e) {
      toast(e.message);
    }
  }

  async function startUnscheduledBreak() {
    const id = await modal({
      title: 'Take an Unscheduled Break?',
      body: '<p>The clock <b>keeps running</b> during an unscheduled break, so you’ll lose testing time. Your proctor will be notified.</p>',
      actions: [
        { id: 'cancel', label: 'Cancel', kind: 'plain' },
        { id: 'ok', label: 'Take a Break', kind: 'yellow' },
      ],
    });
    if (id !== 'ok') return;
    if (S.editor) S.editor.flush();
    S.ubreak = true;
    logEvent('ubreak_start');
    render();
    sync();
  }

  function endUnscheduledBreak() {
    S.ubreak = false;
    logEvent('ubreak_end');
    render();
    sync();
  }

  async function exitExam() {
    const id = await modal({
      title: 'Exit the Exam?',
      body: '<p>If you exit, your answers so far are saved and your exam is paused. You won’t be able to continue until your proctor lets you back in.</p>',
      actions: [
        { id: 'cancel', label: 'Cancel', kind: 'plain' },
        { id: 'ok', label: 'Exit the Exam', kind: 'yellow' },
      ],
    });
    if (id !== 'ok') return;
    await sync();
    try {
      const res = await API.post('/api/exam', { action: 'exit', attemptId });
      applyAttempt(res.attempt);
    } catch (e) {
      toast(e.message);
    }
  }

  function logEvent(type, extra = {}) {
    if (!S.attempt) return;
    API.post(
      '/api/exam',
      { action: 'event', attemptId, type, section: S.attempt.sectionIndex, question: S.qIndex + 1, screen: viewState().screen, ...extra },
      { keepalive: true }
    ).catch(() => {});
  }

  async function showMessage(m) {
    S.shownMessage = m.id;
    await modal({
      title: 'Message from Your Proctor',
      body: `<p style="white-space:pre-wrap">${esc(m.text)}</p>`,
      actions: [{ id: 'ok', label: 'OK', kind: 'yellow' }],
      dismissible: false,
    });
    API.post('/api/exam', { action: 'ackMessage', attemptId, messageId: m.id }).catch(() => {});
  }

  // ================================================================ other screens
  function renderDirectionsPage() {
    const s = sec();
    const first = S.attempt.sectionIndex === 0;
    const btn = first ? 'Begin Testing' : 'Resume Testing';
    app.innerHTML =
      '<div class="page"><div class="dirpage"><div class="dirpage-main">' +
      `<h1>${esc(s.title)} Directions</h1>` +
      `<div class="paused"><b>Testing time is paused:</b> Take a moment to read the directions for ${first ? 'this' : 'the next'} part of the exam, then click <b>${btn}</b>.</div>` +
      `<div class="dir-text">${s.directions}</div>` +
      '</div>' +
      `<div class="dirpage-foot"><button type="button" class="btn-yellow" data-act="begin">${btn}</button></div>` +
      '</div></div>';
  }

  function renderBreak() {
    const early = S.test.settings && S.test.settings.earlyBreakEnd;
    app.innerHTML =
      '<div class="page brk">' +
      '<div class="brk-batt" hidden></div>' +
      '<div class="brk-wrap">' +
      '<div class="brk-left"><div class="brk-box"><div class="brk-lbl">Remaining Break Time:</div><div class="brk-time">--:--</div></div>' +
      `<button type="button" class="btn-yellow" data-act="end-break"${early ? '' : ' hidden'}>Resume Testing Now</button></div>` +
      '<div class="brk-right">' +
      '<h1>Take a Break: Do Not Close Your Device</h1>' +
      '<p>After the break, a <b>Resume Testing Now</b> button will appear and you’ll start the next section.</p>' +
      '<p class="rules">Follow these rules during the break:</p>' +
      '<ol><li>Don’t disturb anyone who is still testing.</li><li>Don’t close this window or shut your laptop.</li>' +
      '<li>Don’t use phones, smartwatches, textbooks, notes, or the internet.</li><li>Don’t eat or drink in the testing room.</li>' +
      '<li>Don’t talk in the testing room, and don’t discuss the exam with anyone.</li></ol>' +
      '</div></div></div>';
    U.battery(app.querySelector('.brk-batt'));
    tick();
  }

  function renderUnscheduledBreak() {
    app.innerHTML =
      '<div class="page brk">' +
      '<div class="brk-batt" hidden></div>' +
      '<div class="brk-wrap">' +
      '<div class="brk-left"><div class="brk-box"><div class="brk-lbl">Remaining Section Time:</div><div class="brk-time ub-time">--:--</div></div>' +
      '<button type="button" class="btn-yellow" data-act="resume-ubreak">Resume Testing</button></div>' +
      '<div class="brk-right">' +
      '<h1>Unscheduled Break</h1>' +
      '<p><b>Your testing time is still running.</b> When you’re ready, click <b>Resume Testing</b> to go back to your exam.</p>' +
      '<p class="rules">Follow these rules during the break:</p>' +
      '<ol><li>Don’t disturb anyone who is still testing.</li><li>Don’t close this window or shut your laptop.</li>' +
      '<li>Don’t use phones, smartwatches, textbooks, notes, or the internet.</li><li>Don’t discuss the exam with anyone.</li></ol>' +
      '</div></div></div>';
    U.battery(app.querySelector('.brk-batt'));
    tick();
  }

  function renderFinish() {
    const colors = ['#d4567a', '#f7c600', '#79cfd3', '#9a90de', '#9fc4ee'];
    let conf = '';
    for (let i = 0; i < 64; i++) {
      const c = colors[i % colors.length];
      const w = Math.random() < 0.35 ? 7 : 4;
      const h = w === 7 ? 7 : 11;
      const round = w === 7 ? 'border-radius:50%;' : '';
      const r = Math.round(Math.random() * 360);
      conf += `<i style="left:${(Math.random() * 100).toFixed(2)}%;top:${(Math.random() * 100).toFixed(2)}%;width:${w}px;height:${h}px;background:${c};${round}--r:${r}deg;transform:rotate(${r}deg);animation:fall ${(0.8 + Math.random() * 1.2).toFixed(2)}s ease-out both"></i>`;
    }
    app.innerHTML =
      '<div class="page fin">' +
      `<div class="confetti" aria-hidden="true">${conf}</div>` +
      `<div class="fin-top"><div class="fin-top-in"><button type="button" data-act="help">${icon.help}<span>Help</span></button><button type="button" data-act="home"><span>Return to Home</span>${icon.home}</button></div></div>` +
      '<div class="fin-main">' +
      '<h1>Congratulations!</h1>' +
      '<p>Your test is complete, and your answers have been submitted.</p>' +
      `<div class="fin-card">${icon.laptopSmile}<p>Your proctor will let you know when it’s time to leave.<br>Please stay quiet; others may still be testing.</p></div>` +
      '<button type="button" class="btn-yellow" data-act="home">Return to Homepage</button>' +
      (S.results ? '<div><button type="button" class="btn-outline fin-results" data-act="results">View Your Results</button></div>' : '') +
      '</div></div>';
  }

  function renderResults() {
    const r = S.results;
    const sc = r.score;
    const top = `<div class="fin-top"><div class="fin-top-in"><button type="button" data-act="finish">${icon.chevLeft}<span>Back</span></button><button type="button" data-act="home"><span>Return to Home</span>${icon.home}</button></div></div>`;
    let h = '<div class="page res">' + top + '<div class="res-main"><h1>Your Results</h1>';
    h += sc.keyed
      ? `<p class="res-total">You got <b>${sc.correct} of ${sc.keyed}</b> scored questions right (${Math.round((sc.correct / sc.keyed) * 100)}%).</p>`
      : '<p class="res-total">Your answers were submitted. This test doesn’t have automatic scoring.</p>';
    r.sections.forEach((s, si) => {
      const title = esc(S.test.sections[si] ? S.test.sections[si].title : s.title);
      h += `<section class="res-sec"><div class="res-sec-head"><h2>${title}</h2><span>${s.keyed ? `${s.correct}/${s.keyed} correct · ` : ''}${s.answered}/${s.total} answered</span></div>`;
      if (r.mode === 'full' && s.questions && s.questions.length) {
        h += '<ol class="res-list">';
        for (const it of s.questions) {
          const cls = it.correct === true ? 'ok' : it.correct === false ? 'bad' : 'na';
          const badge = it.correct === true ? 'Correct' : it.correct === false ? (it.given ? 'Incorrect' : 'Blank') : 'Not scored';
          const letterText = (L) => {
            if (!L || !it.choices) return '';
            const t = it.choices['ABCDEFGH'.indexOf(L)];
            return t ? ` — ${esc(t.length > 90 ? t.slice(0, 88) + '…' : t)}` : '';
          };
          let ansLine = '';
          if (it.type === 'mcq' || it.type === 'input') {
            ansLine = `Your answer: <b>${it.given ? esc(it.given) : '—'}</b>${it.type === 'mcq' ? letterText(it.given) : ''}`;
            if (it.answer) ansLine += `<br>Correct answer: <b>${esc(it.answer)}</b>${it.type === 'mcq' ? letterText(it.answer) : ''}`;
          } else ansLine = it.given ? 'Response submitted for scoring by your proctor.' : 'No response.';
          h +=
            `<li class="${cls}"><span class="rn">${it.number}</span><div class="rb">` +
            (it.prompt ? `<div class="rp">${esc(it.prompt)}</div>` : '') +
            `<div class="ra">${ansLine}</div>` +
            (it.explanation ? `<div class="rx">${it.explanation}</div>` : '') +
            `</div><span class="rbadge">${badge}</span></li>`;
        }
        h += '</ol>';
      }
      h += '</section>';
    });
    h += '<div class="res-actions"><button type="button" class="btn-yellow" data-act="home">Return to Homepage</button></div></div></div>';
    app.innerHTML = h;
  }

  let pausedPoll = null;
  function renderPaused() {
    app.innerHTML =
      '<div class="page paused-page"><div class="paused-card">' +
      '<h1>Your exam is paused</h1>' +
      '<p>You exited the exam. Your answers are saved. Ask your proctor to let you back in — this page will continue automatically once they do.</p>' +
      '<button type="button" class="btn-yellow" data-act="home">Return to Home</button>' +
      '</div></div>';
    clearInterval(pausedPoll);
    pausedPoll = setInterval(() => {
      if (S.attempt.status !== 'paused') clearInterval(pausedPoll);
      else sync();
    }, 4000);
  }

  // ================================================================ focus tracking & guards
  function installFocusTracking() {
    const check = () => {
      if (!S.attempt || S.unloading) return;
      const testing = S.attempt.status === 'active' && S.attempt.phase === 'section' && !S.ubreak;
      const awayNow = document.hidden || !document.hasFocus();
      if (awayNow && !S.away && testing) {
        S.away = true;
        S.awayAt = Date.now();
        logEvent('focus_lost', { reason: document.hidden ? 'switched tabs or minimized' : 'clicked outside the exam window' });
      } else if (!awayNow && S.away) {
        S.away = false;
        logEvent('focus_back', { awayMs: Date.now() - S.awayAt });
      }
    };
    window.addEventListener('blur', () => setTimeout(check, 30));
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    setInterval(check, 1000);
  }

  function installGuards() {
    const blocked = (e) => {
      const t = e.target && e.target.closest ? e.target : e.target && e.target.parentElement;
      if (t && t.closest && t.closest('.rte-area, textarea, input')) return;
      e.preventDefault();
      if (Date.now() - S.lastCopyLog > 30000 && S.attempt && S.attempt.phase === 'section') {
        S.lastCopyLog = Date.now();
        logEvent('copy_blocked');
      }
    };
    document.addEventListener('copy', blocked);
    document.addEventListener('cut', blocked);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closePopovers();
        document.querySelectorAll('.lightbox').forEach((n) => n.remove());
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 't' || e.key === 'T' || e.code === 'KeyT')) {
        if (app.querySelector('.time-warn')) {
          e.preventDefault();
          closeTimeWarning();
        }
      }
    });
  }

  boot();
})();
