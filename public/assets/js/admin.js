/* Proctor dashboard: live monitoring, alerts, actions, tests, and accounts. */
(function () {
  'use strict';
  const { esc, icon, modal, toast, fmtClock, fmtAgo, fmtDuration, fmtTime, sanitize } = U;
  const $ = (id) => document.getElementById(id);
  const LETTERS = 'ABCDEFGH';
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const ALERT_TYPES = new Set(['focus_lost', 'exited', 'ubreak_start', 'paste_blocked', 'copy_blocked', 'page_left']);

  document.title = `Proctor Dashboard · ${U.appName}`;
  $('brandName').textContent = U.appName;

  const A = {
    tab: 'live',
    attempts: [],
    fetchedAt: 0,
    serverNow: 0,
    events: [],
    lastEventId: 0,
    seenAlertId: Number(localStorage.getItem('mx-seen-alert') || 0),
    detailId: null,
    detail: null,
    detailSection: null,
    detailQ: null,
    tests: [],
    users: [],
    pollTimer: null,
    firstPoll: true,
    failures: 0,
  };

  const nowServer = () => A.serverNow + (Date.now() - A.fetchedAt);
  const roman = (i) => `Section ${ROMAN[i] || i + 1}`;

  // ================================================================ tabs
  document.querySelector('.ad-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    setTab(b.dataset.tab);
  });
  function setTab(tab) {
    A.tab = tab;
    document.querySelectorAll('.ad-tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = p.id !== `panel-${tab}`));
    if (tab === 'tests') loadTests();
    if (tab === 'accounts') loadUsers();
    if (tab === 'images') loadImages();
    if (tab === 'live') renderLive();
  }

  $('signOut').addEventListener('click', async () => {
    await API.post('/api/auth', { action: 'logout' }).catch(() => {});
    location.href = '/';
  });

  // ================================================================ sound
  let audioCtx = null;
  function beep() {
    if (!$('soundOn').checked) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      [0, 0.18].forEach((dt, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = i ? 660 : 880;
        g.gain.setValueAtTime(0.0001, t + dt);
        g.gain.exponentialRampToValueAtTime(0.25, t + dt + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.16);
        o.connect(g).connect(audioCtx.destination);
        o.start(t + dt);
        o.stop(t + dt + 0.18);
      });
    } catch {
      /* audio not available */
    }
  }
  document.addEventListener('click', () => {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  });

  // ================================================================ polling
  async function poll() {
    clearTimeout(A.pollTimer);
    try {
      const d = await API.get(`/api/admin?action=live&since=${A.lastEventId}`);
      A.serverNow = d.now;
      A.fetchedAt = Date.now();
      A.attempts = d.attempts;
      A.failures = 0;
      $('liveDot').classList.remove('stale');
      $('liveDot').textContent = '● Live';
      if (d.events.length) {
        A.events.push(...d.events);
        if (A.events.length > 400) A.events.splice(0, A.events.length - 400);
        A.lastEventId = d.events[d.events.length - 1].id;
        if (!A.firstPoll) {
          const alerts = d.events.filter((e) => ALERT_TYPES.has(e.type));
          if (alerts.length) {
            beep();
            alerts.slice(-3).forEach((e) => toast(stripHtml(describe(e).text), 6000));
          }
        } else if (!A.seenAlertId) {
          A.seenAlertId = A.lastEventId;
        }
      }
      A.firstPoll = false;
      renderLive();
      if (A.detailId) await loadDetail(true);
    } catch (e) {
      A.failures++;
      if (A.failures > 1) {
        $('liveDot').classList.add('stale');
        $('liveDot').textContent = '● Reconnecting…';
      }
    } finally {
      A.pollTimer = setTimeout(poll, document.hidden ? 5000 : 2000);
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });
  setInterval(() => {
    if (A.tab === 'live') tickTimes();
  }, 1000);

  const stripHtml = (h) => {
    const d = document.createElement('div');
    d.innerHTML = h;
    return d.textContent;
  };

  // ================================================================ live table
  function whereHTML(t) {
    const sec = t.sectionTitle || roman(t.sectionIndex);
    let h;
    if (t.status === 'completed') h = '<span class="pill green">Finished</span>';
    else if (t.status === 'paused') h = '<span class="pill amber">Exited</span> <span class="muted">waiting for you to let them back in</span>';
    else if (t.phase === 'directions') h = `Reading directions <span class="muted">· ${esc(sec)} (clock paused)</span>`;
    else if (t.phase === 'break') h = `<span class="pill blue">On break</span>${t.breakSecondsLeft === 0 ? ' <span class="muted">can resume now</span>' : ''}`;
    else if (t.ubreak) h = `<span class="pill amber">Unscheduled break</span> <span class="muted">${esc(sec)}</span>`;
    else if (t.screen === 'review') h = `${esc(sec)} · <b>Check Your Work</b>`;
    else h = `${esc(sec)} · <b>Question ${t.question || 1}</b> <span class="muted">of ${t.total}</span>`;
    if (t.away && t.status === 'active') {
      const secs = t.awaySince ? Math.max(0, Math.round((nowServer() - t.awaySince) / 1000)) : null;
      h += ` <span class="pill red" data-away-since="${t.awaySince || ''}">LEFT EXAM${secs != null ? ` · ${fmtDuration(secs * 1000)}` : ''}</span>`;
    }
    if (!t.online && t.status === 'active') h += ' <span class="pill gray">Offline</span>';
    if (t.messagePending) h += ' <span class="pill gray">Message unread</span>';
    return h;
  }

  function timeLeftText(t) {
    const el = (Date.now() - A.fetchedAt) / 1000;
    if (t.status === 'completed') return '—';
    if (t.status === 'paused') return t.secondsLeft != null ? `${fmtClock(t.secondsLeft)} <span class="muted">(paused)</span>` : 'Paused';
    if (t.phase === 'section' && t.secondsLeft != null) {
      const s = Math.max(0, t.secondsLeft - el);
      return `<b${s <= 300 ? ' style="color:#c4001a"' : ''}>${fmtClock(s)}</b>`;
    }
    if (t.phase === 'break' && t.breakSecondsLeft != null) return `Break ${fmtClock(Math.max(0, t.breakSecondsLeft - el))}`;
    if (t.phase === 'directions') return '<span class="muted">Paused</span>';
    return '—';
  }

  function renderLive() {
    const filter = $('testFilter').value;
    const hideDone = $('hideDone').checked;
    // test filter options
    const tests = [...new Map(A.attempts.map((t) => [t.test.id, t.test.title])).entries()];
    const sel = $('testFilter');
    const want = ['<option value="">All tests</option>', ...tests.map(([id, title]) => `<option value="${esc(id)}">${esc(title)}</option>`)].join('');
    if (sel.dataset.sig !== want) {
      sel.innerHTML = want;
      sel.value = filter;
      sel.dataset.sig = want;
    }
    let rows = A.attempts.filter((t) => (!filter || t.test.id === filter) && (!hideDone || t.status !== 'completed'));
    const order = { active: 0, paused: 1, completed: 2 };
    rows.sort((a, b) => (order[a.status] - order[b.status]) || (b.away - a.away) || a.user.name.localeCompare(b.user.name));

    const count = (fn) => A.attempts.filter(fn).length;
    const unseen = A.events.filter((e) => ALERT_TYPES.has(e.type) && e.id > A.seenAlertId).length;
    $('chips').innerHTML =
      `<span class="chip"><b>${count((t) => t.status === 'active' && t.phase === 'section')}</b>testing</span>` +
      `<span class="chip"><b>${count((t) => t.status === 'active' && t.phase === 'break')}</b>on break</span>` +
      `<span class="chip"><b>${count((t) => t.status === 'active' && t.phase === 'directions')}</b>reading directions</span>` +
      `<span class="chip"><b>${count((t) => t.status === 'paused')}</b>exited</span>` +
      `<span class="chip"><b>${count((t) => t.status === 'completed')}</b>finished</span>` +
      `<span class="chip${count((t) => t.away && t.status === 'active') ? ' alert' : ''}"><b>${count((t) => t.away && t.status === 'active')}</b>away right now</span>`;
    const badge = $('alertBadge');
    badge.hidden = !unseen;
    badge.textContent = unseen;

    if (A.tab !== 'live') return;
    $('takers').innerHTML = rows.length
      ? rows
          .map((t) => {
            const pct = t.total ? Math.round((t.answered / t.total) * 100) : 0;
            const dotCls = t.away && t.status === 'active' ? 'away' : t.online ? 'on' : '';
            return (
              `<tr data-id="${t.id}" class="${t.away && t.status === 'active' ? 'is-away' : ''}">` +
              `<td><div class="who"><span class="dot ${dotCls}"></span><div><b>${esc(t.user.name)}</b><small>${esc(t.user.username)}</small></div></div></td>` +
              `<td>${esc(t.test.title)}</td>` +
              `<td class="where">${whereHTML(t)}</td>` +
              `<td class="tl" data-id="${t.id}">${timeLeftText(t)}</td>` +
              `<td>${t.answered}/${t.total}${t.flagged ? ` <span class="muted">· ${t.flagged} flagged</span>` : ''}<div class="bar"><i style="width:${pct}%"></i></div></td>` +
              `<td><span class="left-count ${t.awayCount ? 'some' : 'zero'}">${t.awayCount ? `${t.awayCount}×` : '0'}</span></td>` +
              `<td>${t.score.keyed ? `${t.score.correct}/${t.score.keyed}` : '<span class="muted">—</span>'}</td>` +
              `<td class="muted">${t.online && t.status === 'active' ? 'now' : fmtAgo(nowServer() - t.lastSeen)}</td>` +
              '</tr>'
            );
          })
          .join('')
      : `<tr class="empty-row"><td colspan="8">No one has started a test yet. Open a test in the <b>Tests</b> tab, then have people sign in.</td></tr>`;

    // activity feed (newest first)
    const feed = A.events.slice(-150).reverse();
    $('feed').innerHTML = feed.length
      ? feed
          .map((e) => {
            const d = describe(e);
            const seen = e.id <= A.seenAlertId ? ' seen' : '';
            return `<li class="${d.cls}${seen}" data-attempt="${e.attemptId || ''}">${d.text}<span class="t">${fmtTime(e.at)}</span></li>`;
          })
          .join('')
      : '<li class="info muted">Nothing yet.</li>';
  }

  function tickTimes() {
    for (const td of document.querySelectorAll('#takers td.tl')) {
      const t = A.attempts.find((x) => x.id === Number(td.dataset.id));
      if (t) td.innerHTML = timeLeftText(t);
    }
    for (const p of document.querySelectorAll('#takers [data-away-since]')) {
      const since = Number(p.dataset.awaySince);
      if (since) p.textContent = `LEFT EXAM · ${fmtDuration(Math.max(0, nowServer() - since))}`;
    }
  }

  function describe(e) {
    const n = `<b>${esc(e.name)}</b>`;
    const where = e.section != null ? `${roman(e.section)}${e.question ? `, Question ${e.question}` : ''}` : '';
    const at = where ? ` <span class="muted">(${where})</span>` : '';
    const d = e.detail || {};
    switch (e.type) {
      case 'focus_lost':
        return { cls: 'alert', text: `${n} left the exam window${at}${d.reason ? ` — ${esc(d.reason)}` : ''}` };
      case 'focus_back':
        return { cls: 'info', text: `${n} came back to the exam${d.awayMs != null ? ` after <b>${fmtDuration(d.awayMs)}</b>` : ''}${at}` };
      case 'ubreak_start':
        return { cls: 'warn', text: `${n} started an unscheduled break${at}` };
      case 'ubreak_end':
        return { cls: 'info', text: `${n} ended their unscheduled break${at}` };
      case 'exited':
        return { cls: 'alert', text: `${n} exited the exam${at}. Open their row to let them back in.` };
      case 'page_left':
        return { cls: 'warn', text: `${n} closed or reloaded the exam page${at}` };
      case 'paste_blocked':
        return { cls: 'warn', text: `${n} tried to paste outside text into a response${at}` };
      case 'copy_blocked':
        return { cls: 'warn', text: `${n} tried to copy test content${at}` };
      case 'sign_in':
        return { cls: 'info', text: `${n} signed in` };
      case 'exam_started':
        return { cls: 'good', text: `${n} started a test` };
      case 'opened':
        return { cls: 'info', text: `${n} opened the exam${at}` };
      case 'section_start':
        return { cls: 'info', text: `${n} started ${roman(e.section)}` };
      case 'section_end':
        return { cls: 'info', text: `${n}’s time ran out for ${roman(e.section)}` };
      case 'submitted_early':
        return { cls: 'info', text: `${n} submitted ${roman(e.section)} early` };
      case 'break_start':
        return { cls: 'info', text: `${n} is on the scheduled break` };
      case 'break_end':
        return { cls: 'info', text: `${n} ended their break` };
      case 'completed':
        return { cls: 'good', text: `${n} finished the test` };
      case 'proctor_message':
        return { cls: 'info', text: `You sent ${n} a message: “${esc((d.text || '').slice(0, 80))}”` };
      case 'proctor_time':
        return { cls: 'info', text: `You ${d.minutes > 0 ? 'added' : 'removed'} ${Math.abs(d.minutes)} min for ${n}` };
      case 'proctor_end_section':
        return { cls: 'info', text: `You ended the current section for ${n}` };
      case 'proctor_end_exam':
        return { cls: 'info', text: `You ended the exam for ${n}` };
      case 'proctor_resume':
        return { cls: 'good', text: `You let ${n} back into the exam` };
      default:
        return { cls: 'info', text: `${n}: ${esc(e.type)}` };
    }
  }

  $('takers').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) openDetail(Number(tr.dataset.id));
  });
  $('feed').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-attempt]');
    if (li && li.dataset.attempt) openDetail(Number(li.dataset.attempt));
  });
  $('testFilter').addEventListener('change', renderLive);
  $('hideDone').addEventListener('change', renderLive);
  $('clearAlerts').addEventListener('click', () => {
    A.seenAlertId = A.lastEventId;
    localStorage.setItem('mx-seen-alert', String(A.seenAlertId));
    renderLive();
  });

  // ================================================================ detail drawer
  async function openDetail(id) {
    A.detailId = id;
    A.detail = null;
    A.detailSection = null;
    A.detailQ = null;
    $('drawerWrap').hidden = false;
    $('drawer').innerHTML = '<div class="dr-section muted">Loading…</div>';
    await loadDetail();
  }
  function closeDetail() {
    A.detailId = null;
    A.detail = null;
    $('drawerWrap').hidden = true;
  }
  $('drawerShade').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && A.detailId && !document.querySelector('.modal-backdrop')) closeDetail();
  });

  async function loadDetail(quiet) {
    const id = A.detailId;
    if (!id) return;
    try {
      const d = await API.get(`/api/admin?action=attempt&id=${id}`);
      if (A.detailId !== id) return;
      A.detail = d;
      A.detail.fetchedAt = Date.now();
      renderDetail();
    } catch (e) {
      if (e.status === 404) {
        closeDetail();
        if (!quiet) toast('That attempt no longer exists.');
      } else if (!quiet) toast(e.message);
    }
  }

  function renderDetail() {
    const d = A.detail;
    if (!d) return;
    const t = d.summary;
    const dr = $('drawer');
    const scroll = dr.scrollTop;
    const def = d.test;
    if (A.detailSection == null) A.detailSection = Math.min(t.sectionIndex, def.sections.length - 1);
    const si = A.detailSection;
    const sec = def.sections[si];
    const curQ = t.viewSection === si && t.status === 'active' && t.phase === 'section' && t.screen === 'question' ? (t.question || 1) - 1 : -1;

    let h =
      `<div class="dr-head"><div><h2>${esc(t.user.name)} <span class="muted" style="font-weight:400;font-size:15px">@${esc(t.user.username)}</span></h2>` +
      `<p>${esc(t.test.title)} · started ${fmtTime(t.startedAt)}${t.completedAt ? ` · finished ${fmtTime(t.completedAt)}` : ''}</p></div>` +
      `<button type="button" class="dr-close" data-act="close" aria-label="Close">${icon.close}</button></div>`;

    h +=
      '<div class="dr-section"><div class="dr-stats">' +
      `<div class="stat"><span>Right now</span><span class="now">${whereHTML(t)}</span></div>` +
      `<div class="stat"><span>Time left</span><b>${timeLeftText(t)}</b></div>` +
      `<div class="stat${t.awayCount ? ' red' : ''}"><span>Times left the exam</span><b>${t.awayCount}</b></div>` +
      `<div class="stat"><span>Multiple-choice score</span><b>${d.score.keyed ? `${d.score.correct}/${d.score.keyed}` : '—'}</b></div>` +
      '</div></div>';

    h +=
      '<div class="dr-section"><h3>Proctor actions</h3><div class="dr-actions">' +
      '<button type="button" class="ad-btn" data-act="message">Send a message</button>' +
      (t.status === 'active' && (t.phase === 'section' || t.phase === 'break') ? '<button type="button" class="ad-btn" data-act="time">Change time…</button>' : '') +
      (t.status === 'active' ? '<button type="button" class="ad-btn" data-act="endSection">End current section</button>' : '') +
      (t.status === 'paused' ? '<button type="button" class="ad-btn primary" data-act="resume">Let them back in</button>' : '') +
      (t.status !== 'completed' ? '<button type="button" class="ad-btn" data-act="endExam">End exam now</button>' : '') +
      '<button type="button" class="ad-btn danger" data-act="reset">Reset attempt</button>' +
      '</div></div>';

    // answers
    h += `<div class="dr-section"><h3>Answers</h3><div class="sec-tabs" role="tablist">${def.sections
      .map((s, i) => `<button type="button" role="tab" data-sec="${i}" aria-selected="${i === si}">${esc(s.title)}${i === t.sectionIndex && t.status === 'active' ? ' •' : ''}</button>`)
      .join('')}</div>`;
    if (sec.type === 'mcq') {
      h += `<div class="ans-grid">${sec.questions
        .map((q, qi) => {
          const a = d.answers[q.id] || {};
          const val = q.type === 'input' ? (a.v || '').trim() : a.c;
          let cls = '';
          if (val) cls = q.answer ? (d.correct[q.id] ? 'right' : 'wrong') : 'answered';
          if (qi === curQ) cls += ' cur';
          const shown = q.type === 'input' ? (val ? esc(val.length > 5 ? val.slice(0, 4) + '…' : val) : '–') : val || '–';
          return `<button type="button" class="ans ${cls}" data-q="${qi}" title="Question ${q.number}${q.type === 'input' ? ' (short answer)' : ''}"><span class="n">${q.number}</span><span class="l">${shown}</span>${a.r ? `<span class="fl">${icon.flagSmall}</span>` : ''}</button>`;
        })
        .join('')}</div>` +
        '<div class="ans-legend"><span><i class="lr"></i>Correct</span><span><i class="lw"></i>Incorrect</span><span><i></i>Answered (no key)</span><span><i class="lu"></i>Blank</span><span><i class="lc"></i>Looking at it now</span></div>';
      const qi = A.detailQ != null ? A.detailQ : curQ >= 0 ? curQ : null;
      if (qi != null && sec.questions[qi]) h += questionDetail(sec, sec.questions[qi], d.answers[sec.questions[qi].id] || {});
    } else {
      h += sec.questions
        .map((q, qi) => {
          const a = d.answers[q.id] || {};
          let body = '';
          let label = '';
          if (q.choose) {
            const o = Number.isInteger(a.o) ? a.o : null;
            label = o != null ? ` — chose ${esc(q.choose[o].label)}` : ' — hasn’t chosen yet';
            body = o != null ? (a.ts && a.ts[o]) || '' : '';
          } else body = a.t || '';
          const clean = sanitize(body);
          const words = stripHtml(clean).trim().split(/\s+/).filter(Boolean).length;
          return (
            `<div class="frq-resp"><h4>Question ${q.number}${label}${qi === curQ ? ' <span class="pill blue">looking at it now</span>' : ''}${a.r ? ' <span class="pill amber">for review</span>' : ''}</h4>` +
            `<div class="prompt">${stripHtml(q.prompt || '').slice(0, 220)}</div>` +
            `<div class="body">${clean || '<span class="muted">No response yet.</span>'}</div>` +
            `<div class="meta">${words} word${words === 1 ? '' : 's'}${q.points ? ` · worth ${q.points} points` : ''}</div>` +
            (q.rubric ? `<details><summary class="muted small">Rubric</summary><div class="small">${q.rubric}</div></details>` : '') +
            '</div>'
          );
        })
        .join('');
      if (sec.responseMode === 'paper') h += '<p class="muted small">This section is answered on paper, so there are no typed responses.</p>';
    }
    h += '</div>';

    // events
    const evs = d.events.slice().reverse();
    h += `<div class="dr-section"><h3>Activity</h3><ul class="ev-list">${evs
      .map((e) => `<li class="${ALERT_TYPES.has(e.type) ? 'alert' : ''}"><span class="tm">${fmtTime(e.at)}</span><span>${describe(e).text}</span></li>`)
      .join('') || '<li class="muted">Nothing yet.</li>'}</ul></div>`;

    dr.innerHTML = h;
    dr.scrollTop = scroll;
  }

  function questionDetail(sec, q, a) {
    if (q.type === 'input') {
      const v = (a.v || '').trim();
      const ok = q.answer ? A.detail.correct[q.id] : null;
      return (
        `<div class="q-detail"><div class="qd-prompt"><b style="font-family:var(--ui)">Question ${q.number}.</b> ${q.prompt}</div>` +
        `<p style="margin:0">Their answer: <b>${v ? esc(v) : '—'}</b>${ok === true ? ' <span class="pill green">correct</span>' : ok === false && v ? ' <span class="pill red">incorrect</span>' : ''}</p>` +
        (q.answer ? `<p class="muted" style="margin:6px 0 0">Accepted: ${q.answer.map(esc).join(', ')}</p>` : '') +
        `${q.explanation ? `<p class="small muted" style="margin:10px 0 0">${q.explanation}</p>` : ''}</div>`
      );
    }
    return (
      `<div class="q-detail"><div class="qd-prompt"><b style="font-family:var(--ui)">Question ${q.number}.</b> ${q.prompt}</div><ol>` +
      q.choices
        .map((c, i) => {
          const L = LETTERS[i];
          const cls = [q.answer === L ? 'key' : '', a.c === L ? 'pick' : '', (a.x || []).includes(L) ? 'x' : ''].join(' ');
          const tags = [a.c === L ? 'their answer' : '', q.answer === L ? 'correct' : '', (a.x || []).includes(L) ? 'crossed out' : ''].filter(Boolean).join(' · ');
          const content = typeof c === 'string' ? c : `${c.text || ''}${(c.images || []).map((im) => `<img src="${esc(im.src)}" alt="" style="max-height:70px;display:block">`).join('')}`;
          return `<li class="${cls}"><span class="ltr">${L}</span><span>${content}</span><span class="tags">${tags}</span></li>`;
        })
        .join('') +
      `</ol>${q.explanation ? `<p class="small muted" style="margin:10px 0 0">${q.explanation}</p>` : ''}</div>`
    );
  }

  $('drawer').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const t = A.detail && A.detail.summary;
    if (b.dataset.act === 'close') return closeDetail();
    if (b.dataset.sec != null) {
      A.detailSection = Number(b.dataset.sec);
      A.detailQ = null;
      return renderDetail();
    }
    if (b.dataset.q != null) {
      A.detailQ = A.detailQ === Number(b.dataset.q) ? null : Number(b.dataset.q);
      return renderDetail();
    }
    if (!t) return;
    const id = t.id;
    const run = async (body, ok) => {
      try {
        await API.post('/api/admin', { ...body, attemptId: id });
        if (ok) toast(ok);
        await loadDetail(true);
        poll();
      } catch (err) {
        toast(err.message);
      }
    };
    switch (b.dataset.act) {
      case 'message': {
        let text = '';
        const r = await modal({
          title: `Message ${t.user.name}`,
          body: '<p>This pops up on their screen right away.</p><textarea style="width:100%;min-height:110px;border:1px solid #b9b9b9;border-radius:6px;padding:10px;font-size:15px" placeholder="e.g. Please stay on the exam window."></textarea><div class="modal-error"></div>',
          actions: [
            { id: 'cancel', label: 'Cancel', kind: 'plain' },
            { id: 'send', label: 'Send', kind: 'yellow', handler: (box) => { text = box.querySelector('textarea').value.trim(); if (!text) { box.querySelector('.modal-error').textContent = 'Type a message first.'; return false; } return true; } },
          ],
        });
        if (r === 'send') run({ action: 'message', text }, 'Message sent.');
        break;
      }
      case 'time': {
        let minutes = 0;
        const r = await modal({
          title: 'Change time',
          body: '<p>Add minutes to the current section or break. Use a negative number to take time away.</p><input type="text" inputmode="numeric" value="5" aria-label="Minutes"><div class="modal-error"></div>',
          actions: [
            { id: 'cancel', label: 'Cancel', kind: 'plain' },
            { id: 'ok', label: 'Apply', kind: 'yellow', primary: true, handler: (box) => { minutes = Number(box.querySelector('input').value); if (!Number.isFinite(minutes) || minutes === 0) { box.querySelector('.modal-error').textContent = 'Enter a number of minutes, like 5 or -5.'; return false; } return true; } },
          ],
        });
        if (r === 'ok') run({ action: 'addTime', minutes }, `${minutes > 0 ? 'Added' : 'Removed'} ${Math.abs(minutes)} min.`);
        break;
      }
      case 'endSection': {
        const r = await modal({
          title: 'End the current section?',
          body: `<p>${esc(t.user.name)} will move on as if time ran out${t.phase === 'break' ? ' (their break will end)' : ''}. Their answers so far are kept.</p>`,
          actions: [{ id: 'cancel', label: 'Cancel', kind: 'plain' }, { id: 'ok', label: 'End section', kind: 'yellow' }],
        });
        if (r === 'ok') run({ action: 'endSection' }, 'Section ended.');
        break;
      }
      case 'endExam': {
        const r = await modal({
          title: 'End the whole exam?',
          body: `<p>${esc(t.user.name)}’s exam will be submitted right now and they’ll see the finish screen.</p>`,
          actions: [{ id: 'cancel', label: 'Cancel', kind: 'plain' }, { id: 'ok', label: 'End exam', kind: 'yellow' }],
        });
        if (r === 'ok') run({ action: 'endExam' }, 'Exam ended.');
        break;
      }
      case 'resume':
        run({ action: 'allowResume' }, `${t.user.name} can continue now.`);
        break;
      case 'reset': {
        const r = await modal({
          title: 'Reset this attempt?',
          body: `<p>This <b>permanently deletes</b> ${esc(t.user.name)}’s answers and activity for this test so they can start over.</p>`,
          actions: [{ id: 'cancel', label: 'Cancel', kind: 'plain' }, { id: 'ok', label: 'Delete and reset', kind: 'yellow' }],
        });
        if (r === 'ok') {
          await run({ action: 'reset' }, 'Attempt reset.');
          closeDetail();
        }
        break;
      }
      default:
        break;
    }
  });

  // ================================================================ tests tab
  let pendingJson = null;
  $('fileInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    $('fileName').textContent = f.name;
    pendingJson = await f.text();
    $('uploadBtn').disabled = false;
    $('uploadErrors').hidden = true;
  });
  $('pasteToggle').addEventListener('click', () => {
    const box = $('pasteBox');
    box.hidden = !box.hidden;
    if (!box.hidden) box.focus();
  });
  $('pasteBox').addEventListener('input', () => {
    pendingJson = $('pasteBox').value.trim() || null;
    $('uploadBtn').disabled = !pendingJson;
  });
  $('uploadBtn').addEventListener('click', () => upload(false));

  async function upload(overwrite) {
    if (!pendingJson) return;
    const errs = $('uploadErrors');
    errs.hidden = true;
    errs.classList.remove('ok');
    $('uploadBtn').disabled = true;
    try {
      const d = await API.post('/api/admin', { action: 'saveTest', definition: pendingJson, overwrite });
      errs.innerHTML = `<li>✓ “${esc(d.id)}” ${d.replaced ? 'was replaced' : 'was added'}. ${d.replaced ? '' : 'Turn on “Open to test takers” when you’re ready.'}</li>` +
        (d.warnings || []).map((w) => `<li class="warn">⚠ ${esc(w)}</li>`).join('');
      errs.classList.add('ok');
      errs.hidden = false;
      pendingJson = null;
      $('fileInput').value = '';
      $('fileName').textContent = 'No file chosen';
      $('pasteBox').value = '';
      loadTests();
    } catch (e) {
      if (e.status === 409 && e.data && e.data.exists) {
        const r = await modal({
          title: 'Replace the existing test?',
          body: `<p>${esc(e.data.errors[0])}</p><p>People who already started it keep their answers, but if you changed or removed questions their results may not line up.</p>`,
          actions: [{ id: 'cancel', label: 'Cancel', kind: 'plain' }, { id: 'ok', label: 'Replace it', kind: 'yellow' }],
        });
        if (r === 'ok') return upload(true);
      } else {
        const list = (e.data && e.data.errors) || [e.message];
        errs.innerHTML = `<li><b>Couldn’t upload — fix these and try again:</b></li>${list.map((x) => `<li>${esc(x)}</li>`).join('')}`;
        errs.hidden = false;
      }
    } finally {
      $('uploadBtn').disabled = !pendingJson;
    }
  }

  $('dlTemplate').addEventListener('click', async () => {
    const res = await fetch('/assets/test-template.json');
    download('test-template.json', await res.text());
  });

  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  const fmtMin = (m) => (m >= 60 && m % 60 === 0 ? `${m / 60} hr` : m > 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`);

  async function loadTests() {
    try {
      const d = await API.get('/api/admin?action=tests');
      A.tests = d.tests;
    } catch (e) {
      $('testList').innerHTML = `<div class="card">${esc(e.message)}</div>`;
      return;
    }
    $('testList').innerHTML = A.tests.length
      ? A.tests
          .map(
            (t) =>
              `<div class="tl-card" data-id="${esc(t.id)}"><div>` +
              `<h3>${esc(t.title)}</h3><div class="id">id: ${esc(t.id)}</div>` +
              (t.subtitle ? `<div class="muted" style="margin-top:4px">${esc(t.subtitle)}</div>` : '') +
              `<ul>${t.sections
                .map(
                  (s) =>
                    `<li><b>${esc(s.title)}</b> · ${s.count} ${s.type === 'mcq' ? 'multiple-choice' : 'free-response'} · ${fmtMin(s.minutes)}${s.breakAfterMinutes ? ` · then ${s.breakAfterMinutes}-min break` : ''}${s.type === 'mcq' ? ` · <span class="muted">${s.keyed}/${s.count} with answer keys</span>` : ''}</li>`
                )
                .join('')}</ul>` +
              `<div class="muted small" style="margin-top:8px">${t.attempts} started · ${t.completed} finished</div>` +
              '</div><div class="tl-side">' +
              `<label class="switch"><input type="checkbox" data-act="open" ${t.open ? 'checked' : ''}> Open to test takers</label>` +
              `<div class="code-row"><span class="muted small">Start code</span><input type="text" maxlength="12" value="${esc(t.startCode)}" placeholder="none" data-code aria-label="Start code"><button type="button" class="ad-btn" data-act="saveCode">Save</button><button type="button" class="ad-btn" data-act="genCode">New</button></div>` +
              '<div class="tl-actions"><a class="ad-btn" href="/home">Preview</a><button type="button" class="ad-btn" data-act="json">Download JSON</button><button type="button" class="ad-btn danger" data-act="delete">Delete</button></div>' +
              '</div></div>'
          )
          .join('')
      : '<div class="card muted">No tests yet. Upload one above — try <b>tests/sample-exam.json</b> from the project folder.</div>';
  }

  $('testList').addEventListener('change', async (e) => {
    const cb = e.target.closest('[data-act="open"]');
    if (!cb) return;
    const id = cb.closest('.tl-card').dataset.id;
    try {
      await API.post('/api/admin', { action: 'setTestOpen', id, open: cb.checked });
      toast(cb.checked ? 'Test is open — test takers can see it now.' : 'Test is closed.');
    } catch (err) {
      cb.checked = !cb.checked;
      toast(err.message);
    }
  });

  $('testList').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const card = b.closest('.tl-card');
    const id = card.dataset.id;
    const input = card.querySelector('[data-code]');
    if (b.dataset.act === 'genCode') {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      input.value = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    }
    if (b.dataset.act === 'saveCode' || b.dataset.act === 'genCode') {
      try {
        const d = await API.post('/api/admin', { action: 'setStartCode', id, code: input.value });
        toast(d.code ? `Start code set to ${d.code}.` : 'Start code removed — anyone can start this test.');
      } catch (err) {
        toast(err.message);
      }
    }
    if (b.dataset.act === 'json') {
      const d = await API.get(`/api/admin?action=testJson&id=${encodeURIComponent(id)}`);
      download(`${id}.json`, JSON.stringify(d.definition, null, 2));
    }
    if (b.dataset.act === 'delete') {
      const r = await modal({
        title: 'Delete this test?',
        body: '<p>This also deletes everyone’s answers for it. This can’t be undone.</p>',
        actions: [{ id: 'cancel', label: 'Cancel', kind: 'plain' }, { id: 'ok', label: 'Delete test', kind: 'yellow' }],
      });
      if (r !== 'ok') return;
      try {
        await API.post('/api/admin', { action: 'deleteTest', id });
        loadTests();
      } catch (err) {
        toast(err.message);
      }
    }
  });

  // ================================================================ images tab
  const imgUrl = (n) => `/api/exam?action=image&name=${encodeURIComponent(n)}`;
  const kb = (b) => (b > 1024 * 1024 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  async function loadImages() {
    try {
      const d = await API.get('/api/admin?action=images');
      A.images = d.images;
    } catch (e) {
      $('imgGrid').innerHTML = `<div class="card">${esc(e.message)}</div>`;
      return;
    }
    $('imgGrid').innerHTML = A.images.length
      ? A.images
          .map(
            (im) =>
              `<div class="img-card" data-name="${esc(im.name)}"><div class="thumb"><img src="${imgUrl(im.name)}&v=${im.createdAt}" alt="" loading="lazy"></div>` +
              `<div class="meta"><b>${esc(im.name)}</b>${im.width ? `${im.width}×${im.height} · ` : ''}${kb(im.size)}</div>` +
              '<div class="acts"><button type="button" class="ad-btn" data-act="copy">Copy name</button><button type="button" class="ad-btn" data-act="snippet">Copy JSON</button><button type="button" class="ad-btn danger" data-act="del">Delete</button></div></div>'
          )
          .join('')
      : '<div class="card muted">No images yet.</div>';
  }

  const cleanName = (n) =>
    n.toLowerCase().replace(/\.[a-z0-9]+$/, (ext) => ext).replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+/, '').slice(0, 80) || `image-${Date.now()}`;

  function readAsDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  async function prepareImage(file) {
    const original = await readAsDataURL(file);
    if (file.type === 'image/svg+xml' || file.type === 'image/gif') return { data: original, name: cleanName(file.name) };
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error(`${file.name} isn't a readable image.`));
      i.src = original;
    });
    const MAX = 2000;
    let { width, height } = img;
    if (width <= MAX && file.size < 1_200_000) return { data: original, width, height, name: cleanName(file.name) };
    const scale = Math.min(1, MAX / width);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    if (file.type !== 'image/png') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    let data = file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.88);
    let name = cleanName(file.name);
    if (data.length > 3_900_000) {
      data = c.toDataURL('image/jpeg', 0.82);
      name = name.replace(/\.png$/, '.jpg');
    }
    return { data, width, height, name };
  }

  $('imgInput').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    let done = 0;
    for (const f of files) {
      $('imgStatus').textContent = `Uploading ${f.name}…`;
      try {
        const prep = await prepareImage(f);
        const body = { action: 'uploadImage', name: prep.name, data: prep.data, width: prep.width, height: prep.height };
        try {
          await API.post('/api/admin', body);
        } catch (err) {
          if (err.status !== 409) throw err;
          const r = await modal({
            title: 'Replace this image?',
            body: `<p>${esc(err.message)}</p><p>Tests that use this name will show the new picture.</p>`,
            actions: [{ id: 'cancel', label: 'Keep the old one', kind: 'plain' }, { id: 'ok', label: 'Replace it', kind: 'yellow' }],
          });
          if (r !== 'ok') continue;
          await API.post('/api/admin', { ...body, overwrite: true });
        }
        done++;
      } catch (err) {
        toast(`${f.name}: ${err.message}`, 6000);
      }
    }
    $('imgStatus').textContent = done ? `Uploaded ${done} image${done === 1 ? '' : 's'}.` : '';
    loadImages();
  });

  $('imgGrid').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const name = b.closest('.img-card').dataset.name;
    const copy = async (text, msg) => {
      try {
        await navigator.clipboard.writeText(text);
        toast(msg);
      } catch {
        toast(text, 8000);
      }
    };
    if (b.dataset.act === 'copy') copy(name, `Copied “${name}”.`);
    if (b.dataset.act === 'snippet') copy(`"image": "${name}"`, 'Copied — paste it into a passage, document, question or choice.');
    if (b.dataset.act === 'del') {
      const r = await modal({
        title: `Delete ${name}?`,
        body: '<p>Any test that uses this image will show a broken picture until you upload one with the same name.</p>',
        actions: [{ id: 'cancel', label: 'Cancel', kind: 'plain' }, { id: 'ok', label: 'Delete image', kind: 'yellow' }],
      });
      if (r !== 'ok') return;
      try {
        await API.post('/api/admin', { action: 'deleteImage', name });
        loadImages();
      } catch (err) {
        toast(err.message);
      }
    }
  });

  // ================================================================ accounts tab
  function genPassword() {
    const words = ['maple', 'river', 'comet', 'tiger', 'piano', 'cedar', 'lemon', 'orbit', 'pixel', 'quartz', 'sunny', 'violet', 'harbor', 'falcon'];
    const w = () => words[Math.floor(Math.random() * words.length)];
    return `${w()}-${w()}-${Math.floor(10 + Math.random() * 90)}`;
  }
  $('genPw').addEventListener('click', () => {
    $('acctForm').password.value = genPassword();
  });

  async function loadUsers() {
    try {
      const d = await API.get('/api/admin?action=users');
      A.users = d.users;
    } catch (e) {
      $('acctRows').innerHTML = `<tr><td colspan="5">${esc(e.message)}</td></tr>`;
      return;
    }
    $('acctRows').innerHTML = A.users
      .map(
        (u) =>
          `<tr data-id="${u.id}"><td><b>${esc(u.name)}</b></td><td>${esc(u.username)}</td>` +
          `<td>${u.role === 'admin' ? '<span class="pill blue">Proctor</span>' : '<span class="pill gray">Test taker</span>'}</td>` +
          `<td class="muted">${u.lastSignIn ? fmtAgo(Date.now() - u.lastSignIn) : 'never'}</td>` +
          '<td><button type="button" class="ad-btn" data-act="pw">Reset password</button><button type="button" class="ad-btn danger" data-act="del">Delete</button></td></tr>'
      )
      .join('');
  }

  $('acctForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await API.post('/api/admin', { action: 'addUser', name: f.name.value, username: f.username.value, password: f.password.value, role: f.role.value });
      toast(`Added ${f.name.value}. Username: ${f.username.value}  Password: ${f.password.value}`, 8000);
      f.reset();
      loadUsers();
    } catch (err) {
      toast(err.message);
    }
  });

  $('acctRows').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = Number(b.closest('tr').dataset.id);
    const u = A.users.find((x) => x.id === id);
    if (b.dataset.act === 'pw') {
      let pw = genPassword();
      const r = await modal({
        title: `New password for ${u.name}`,
        body: `<p>They’ll be signed out everywhere and need to use the new password.</p><input type="text" value="${esc(pw)}" aria-label="New password" style="font-family:var(--mono)"><div class="modal-error"></div>`,
        actions: [
          { id: 'cancel', label: 'Cancel', kind: 'plain' },
          { id: 'ok', label: 'Save password', kind: 'yellow', primary: true, handler: (box) => { pw = box.querySelector('input').value; if (pw.length < 4) { box.querySelector('.modal-error').textContent = 'Use at least 4 characters.'; return false; } return true; } },
        ],
      });
      if (r !== 'ok') return;
      try {
        await API.post('/api/admin', { action: 'setPassword', id, password: pw });
        toast(`Password updated for ${u.username}: ${pw}`, 8000);
      } catch (err) {
        toast(err.message);
      }
    }
    if (b.dataset.act === 'del') {
      const r = await modal({
        title: `Delete ${u.name}?`,
        body: '<p>This also deletes their test attempts and answers.</p>',
        actions: [{ id: 'cancel', label: 'Cancel', kind: 'plain' }, { id: 'ok', label: 'Delete account', kind: 'yellow' }],
      });
      if (r !== 'ok') return;
      try {
        await API.post('/api/admin', { action: 'deleteUser', id });
        loadUsers();
      } catch (err) {
        toast(err.message);
      }
    }
  });

  // ================================================================ start
  (async () => {
    try {
      const me = await API.get('/api/auth');
      if (!me.user || me.user.role !== 'admin') {
        location.href = me.user ? '/home' : '/?next=/admin';
        return;
      }
    } catch {
      return;
    }
    poll();
  })();
})();
