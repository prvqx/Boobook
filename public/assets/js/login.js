(function () {
  'use strict';
  const cfg = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const form = $('loginForm');
  const user = $('username');
  const pass = $('password');
  const submit = $('submitBtn');
  const error = $('loginError');

  document.title = `Sign In · ${U.appName}`;
  $('brandName').textContent = U.appName;
  if (cfg.signInHeading) $('signInHeading').textContent = cfg.signInHeading;
  $('pwEye').innerHTML = U.icon.eyeOff;

  const params = new URLSearchParams(location.search);
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;

  // Already signed in? Skip ahead.
  API.get('/api/auth', { allow401: true })
    .then((d) => {
      if (d && d.user) go(d.user);
    })
    .catch(() => {});

  function go(u) {
    if (u.role === 'admin' && (!safeNext || !safeNext.startsWith('/exam'))) location.href = safeNext && safeNext.startsWith('/admin') ? safeNext : '/admin';
    else location.href = safeNext || '/home';
  }

  function refresh() {
    submit.disabled = !(user.value.trim() && pass.value);
    error.textContent = '';
  }
  user.addEventListener('input', refresh);
  pass.addEventListener('input', refresh);

  $('pwEye').addEventListener('click', () => {
    const show = pass.type === 'password';
    pass.type = show ? 'text' : 'password';
    $('pwEye').innerHTML = show ? U.icon.eye : U.icon.eyeOff;
    $('pwEye').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    submit.classList.add('busy');
    submit.disabled = true;
    try {
      const d = await API.post('/api/auth', { action: 'login', username: user.value.trim(), password: pass.value }, { allow401: true });
      go(d.user);
    } catch (err) {
      error.textContent = err.message || 'Sign in failed.';
      submit.classList.remove('busy');
      refresh();
      error.textContent = err.message || 'Sign in failed.';
      pass.select();
    }
  });

  const help = () =>
    U.modal({
      title: 'Need help?',
      body: `<p>${U.esc(cfg.helpText || 'Ask your proctor for help signing in.')}</p>`,
      actions: [{ id: 'ok', label: 'OK', kind: 'yellow' }],
    });
  $('forgotLink').addEventListener('click', help);
  $('helpLink').addEventListener('click', help);
  $('helpLink2').addEventListener('click', help);

  $('backBtn').addEventListener('click', () => {
    $('cardSignIn').hidden = true;
    $('cardWelcome').hidden = false;
  });
  $('toSignIn').addEventListener('click', () => {
    $('cardWelcome').hidden = true;
    $('cardSignIn').hidden = false;
    user.focus();
  });

  setTimeout(() => user.focus(), 50);
})();
