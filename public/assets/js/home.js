(function () {
  'use strict';
  const { esc } = U;
  const $ = (id) => document.getElementById(id);
  document.title = `Home · ${U.appName}`;
  $('brandName').textContent = U.appName;

  const fmtMin = (m) => {
    if (m >= 60 && m % 60 === 0) return `${m / 60} hr`;
    if (m > 60) return `${Math.floor(m / 60)} hr ${m % 60} min`;
    return `${m} min`;
  };

  async function load() {
    let data;
    try {
      data = await API.get('/api/exam?action=home');
    } catch (e) {
      $('tests').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    const first = (data.user.name || '').split(' ')[0];
    $('greeting').textContent = `Welcome, ${first}!`;
    $('userName').textContent = data.user.name;
    if (data.user.role === 'admin') $('adminLink').hidden = false;
    if (!data.tests.length) {
      $('tests').innerHTML = '<div class="empty">No tests are open right now. Your proctor will let you know when it’s time to start.</div>';
      return;
    }
    $('tests').innerHTML = data.tests.map(card).join('');
  }

  function card(t) {
    const a = t.attempt;
    let cls = '';
    let status = 'Not started';
    let button = `<button type="button" class="btn-yellow" data-start="${esc(t.id)}" data-code="${t.needsCode ? 1 : 0}">Start</button>`;
    if (a && a.status === 'completed') {
      cls = 'done';
      status = '<b>Completed</b> — answers submitted';
      button = '';
    } else if (a && a.status === 'paused') {
      cls = 'paused';
      status = '<b>Paused</b> — ask your proctor to let you back in';
      button = `<button type="button" class="btn-plain" data-resume="${a.id}">Check Again</button>`;
    } else if (a) {
      status = '<b>In progress</b>';
      button = `<button type="button" class="btn-yellow" data-resume="${a.id}">Resume</button>`;
    }
    const total = t.sections.reduce((n, s) => n + s.minutes, 0);
    return (
      `<article class="test-card ${cls}"><div class="stripe"></div><div class="tc-body">` +
      `<h3 class="tc-title">${esc(t.title)}${t.open ? '' : '<span class="badge-closed">Closed (proctor preview)</span>'}</h3>` +
      (t.subtitle ? `<p class="tc-sub">${esc(t.subtitle)}</p>` : '') +
      `<ul class="tc-sections">${t.sections
        .map(
          (s) =>
            `<li><span>${esc(s.title)}: ${s.count} ${s.type === 'mcq' ? 'multiple-choice' : 'free-response'}</span><span>${fmtMin(s.minutes)}${s.breakAfterMinutes ? ` + ${s.breakAfterMinutes} min break` : ''}</span></li>`
        )
        .join('')}<li><span><b>Total testing time</b></span><span>${fmtMin(total)}</span></li></ul>` +
      `</div><div class="tc-foot"><span class="tc-status">${status}</span>${button}</div></article>`
    );
  }

  $('tests').addEventListener('click', async (e) => {
    const start = e.target.closest('[data-start]');
    const resume = e.target.closest('[data-resume]');
    if (resume) {
      location.href = `/exam?attempt=${resume.dataset.resume}`;
      return;
    }
    if (!start) return;
    const testId = start.dataset.start;
    let code = '';
    if (start.dataset.code === '1') {
      const ok = await U.modal({
        title: 'Enter Start Code',
        body: '<p>Your proctor will read the start code out loud or write it on the board.</p><input type="text" class="code-input" maxlength="12" autocomplete="off" spellcheck="false" aria-label="Start code"><div class="modal-error"></div>',
        actions: [
          { id: 'cancel', label: 'Cancel', kind: 'plain' },
          {
            id: 'go',
            label: 'Start Test',
            kind: 'yellow',
            primary: true,
            handler: async (box) => {
              code = box.querySelector('input').value.trim();
              try {
                const d = await API.post('/api/exam', { action: 'start', testId, code });
                location.href = `/exam?attempt=${d.attemptId}`;
                return true;
              } catch (err) {
                box.querySelector('.modal-error').textContent = err.message;
                return false;
              }
            },
          },
        ],
      });
      return ok;
    }
    start.disabled = true;
    try {
      const d = await API.post('/api/exam', { action: 'start', testId });
      location.href = `/exam?attempt=${d.attemptId}`;
    } catch (err) {
      start.disabled = false;
      U.toast(err.message);
    }
  });

  $('signOut').addEventListener('click', async () => {
    await API.post('/api/auth', { action: 'logout' }).catch(() => {});
    location.href = '/';
  });

  load();
})();
