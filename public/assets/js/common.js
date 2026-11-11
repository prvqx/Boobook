/* Shared helpers: API calls, HTML helpers, icons, modals, toasts, battery. */
(function () {
  'use strict';

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------------ API
  async function request(method, path, body, opts = {}) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive: !!opts.keepalive,
      });
    } catch (e) {
      const err = new Error("Can't reach the server. Check your internet connection.");
      err.network = true;
      throw err;
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.status === 401 && !opts.allow401) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/?next=${next}`;
      throw new Error('Please sign in.');
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status}).`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }
  const API = {
    get: (p, o) => request('GET', p, null, o),
    post: (p, b, o) => request('POST', p, b || {}, o),
  };

  // ------------------------------------------------------------------ Icons
  const sv = (w, h, inner, extra = '') =>
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" aria-hidden="true" focusable="false" ${extra}>${inner}</svg>`;
  const icon = {
    chevDown: sv(14, 9, '<path d="M1.5 1.5 7 7l5.5-5.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
    chevUp: sv(14, 9, '<path d="M1.5 7.5 7 2l5.5 5.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
    chevLeft: sv(8, 13, '<path d="M6.5 1.5 1.5 6.5l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
    bookmark: sv(16, 21, '<path d="M1.75 1.75h12.5v17.5L8 14.2l-6.25 5.05z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'),
    bookmarkOn: sv(16, 21, '<path d="M1.75 1.75h12.5v17.5L8 14.2l-6.25 5.05z" fill="var(--red)" stroke="var(--red)" stroke-width="1.6" stroke-linejoin="round"/>'),
    flagSmall: sv(11, 15, '<path d="M.5.5h10v14L5.5 10.6.5 14.5z" fill="var(--red)"/>'),
    pin: sv(16, 19, '<path d="M8 1.6a6 6 0 0 0-6 6c0 4.4 6 10 6 10s6-5.6 6-10a6 6 0 0 0-6-6Z" stroke="currentColor" stroke-width="1.7"/><circle cx="8" cy="7.6" r="2.1" stroke="currentColor" stroke-width="1.6"/>'),
    dashedBox: sv(18, 18, '<rect x=".75" y=".75" width="16.5" height="16.5" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2.6 2"/>'),
    close: sv(16, 16, '<path d="M2 2l12 12M14 2 2 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
    highlighter: sv(18, 19,
      '<path d="M11.9 2.2 15.8 6 8.7 13.1H5.1V9.5z" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/>' +
      '<path d="M9.3 4.8l3.9 3.8M5.1 13.1 2.6 15.6" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/>' +
      '<path d="M1.5 17.6h7.2" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/>'),
    note: sv(17, 19,
      '<path d="M1.6 1.6h13.8v11.1l-4.7 4.7H1.6z" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/>' +
      '<path d="M10.7 17.4v-4.7h4.7M4.6 5.6h7.8M4.6 8.6h7.8" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/>'),
    moreVert: sv(6, 20, '<circle cx="3" cy="4" r="1.75" fill="currentColor"/><circle cx="3" cy="10" r="1.75" fill="currentColor"/><circle cx="3" cy="16" r="1.75" fill="currentColor"/>'),
    reference: sv(24, 20, '<text x="1" y="16" font-family="Noto Serif, serif" font-style="italic" font-weight="700" font-size="17" fill="currentColor">x</text><text x="12" y="9" font-family="Roboto, sans-serif" font-weight="700" font-size="10" fill="currentColor">2</text>'),
    stopwatch: sv(22, 25,
      '<circle cx="11" cy="14" r="8.6" stroke="currentColor" stroke-width="1.9"/>' +
      '<path d="M8 2h6M11 2v3.4M11 14V9.6M17.7 6.6l1.5-1.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'),
    battery: sv(23, 12,
      '<rect x=".75" y=".75" width="19" height="10.5" rx="2" stroke="currentColor" stroke-width="1.3"/>' +
      '<path d="M21.2 4v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M11.4 2.6 7.6 6.4h3.2l-1.6 3.1 4.1-4h-3.3z" fill="currentColor"/>'),
    batteryPlain: sv(23, 12,
      '<rect x=".75" y=".75" width="19" height="10.5" rx="2" stroke="currentColor" stroke-width="1.3"/>' +
      '<path d="M21.2 4v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<rect class="bfill" x="2.6" y="2.6" width="15.3" height="6.8" rx=".8" fill="currentColor"/>'),
    abc: sv(28, 28,
      '<text x="14" y="18.6" text-anchor="middle" font-family="Roboto, Arial, sans-serif" font-weight="700" font-size="11.6" letter-spacing="-.2" fill="currentColor">ABC</text>' +
      '<path d="M6.5 22.5 21.5 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
    handle: sv(14, 12, '<path d="M5.6 1.2 0.8 6l4.8 4.8zM8.4 1.2 13.2 6l-4.8 4.8z" fill="currentColor"/>'),
    jump: sv(17, 14, '<path d="M2 1.6 7.4 7 2 12.4M8.6 1.6 14 7l-5.4 5.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
    help: sv(22, 22, '<circle cx="11" cy="11" r="9.6" stroke="currentColor" stroke-width="1.6"/><path d="M8.3 8.5a2.8 2.8 0 1 1 3.6 2.7c-.6.2-.9.7-.9 1.3v1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="11" cy="16.3" r="1.1" fill="currentColor"/>'),
    home: sv(22, 21, '<path d="M2.4 10.2 11 2.6l8.6 7.6M4.8 8.4v10.4h12.4V8.4" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 18.8v-5.4h4v5.4" stroke="currentColor" stroke-width="1.7"/><path d="M15.4 3.6v2.6" stroke="currentColor" stroke-width="1.7"/>'),
    eye: sv(22, 16, '<path d="M1.5 8S5 1.8 11 1.8 20.5 8 20.5 8 17 14.2 11 14.2 1.5 8 1.5 8Z" stroke="currentColor" stroke-width="1.5"/><circle cx="11" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/>'),
    eyeOff: sv(22, 18, '<path d="M1.5 9S5 2.8 11 2.8 20.5 9 20.5 9 17 15.2 11 15.2 1.5 9 1.5 9Z" stroke="currentColor" stroke-width="1.5"/><circle cx="11" cy="9" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M3 16.5 19 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
    warning: sv(24, 22, '<path d="M12 2.2 22.4 20.3H1.6z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 8.6v5.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17.1" r="1.15" fill="currentColor"/>'),
    breakIcon: sv(24, 24,
      '<circle cx="12.6" cy="3.6" r="2.1" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M9.4 22.2l2.3-6.4 2.9 2.6.9 3.8M8.1 11.3l2.8-4.1 3.9.4 2.3 3.4 3 .7M10.9 7.2 9.7 15.8M6.2 13.1l3.3-1.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M3.5 22.2V9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
    trash: sv(14, 16, '<path d="M1.2 3.6h11.6M5 3.4V1.8h4v1.6M2.7 3.8l.9 10.6h6.8l.9-10.6M5.6 6.6v5.2M8.4 6.6v5.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'),
    notePlus: sv(16, 16, '<path d="M1.6 1.6h12.8v8.6l-4.2 4.2H1.6z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M10.2 14.4v-4.2h4.2" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 4.4v5M5.5 6.9h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'),
    underlineStyles: sv(20, 20,
      '<text x="10" y="10.5" text-anchor="middle" font-family="Roboto, Arial, sans-serif" font-weight="700" font-size="11" fill="currentColor">U</text>' +
      '<path d="M4 13h12" stroke="currentColor" stroke-width="1.2"/><path d="M4 15.6h12" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.4"/><path d="M4 18.2h12" stroke="currentColor" stroke-width="1.2" stroke-dasharray=".8 1"/>'),
    chevSmall: sv(10, 6, '<path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'),
    undo: sv(20, 20, '<path d="M6.2 4.2 2.6 7.8l3.6 3.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 7.8h8.6a5.2 5.2 0 0 1 0 10.4H8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
    redo: sv(20, 20, '<path d="M13.8 4.2l3.6 3.6-3.6 3.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 7.8H8.4a5.2 5.2 0 0 0 0 10.4H12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
    cut: sv(22, 22, '<circle cx="6" cy="16.5" r="3.3" stroke="currentColor" stroke-width="1.7"/><circle cx="16" cy="16.5" r="3.3" stroke="currentColor" stroke-width="1.7"/><path d="M8.3 14.1 17 2.5M13.7 14.1 5 2.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
    copy: sv(20, 22, '<rect x="5.6" y="4.8" width="12.6" height="15.6" rx="1.4" stroke="currentColor" stroke-width="1.6"/><path d="M3.4 16.8V3.1c0-.8.6-1.4 1.4-1.4h9.4" stroke="currentColor" stroke-width="1.6"/><path d="M8.6 9.4h6.6M8.6 12.4h6.6M8.6 15.4h6.6" stroke="currentColor" stroke-width="1.4"/>'),
    paste: sv(20, 22, '<rect x="2.2" y="3.4" width="15.6" height="17" rx="1.4" stroke="currentColor" stroke-width="1.6"/><rect x="6.4" y="1.4" width="7.2" height="3.8" rx="1" fill="#fff" stroke="currentColor" stroke-width="1.5"/><rect x="7.4" y="8.2" width="9" height="10.4" rx=".8" stroke="currentColor" stroke-width="1.4"/><path d="M9.4 11.4h5M9.4 14.2h5" stroke="currentColor" stroke-width="1.3"/>'),
    indent: sv(22, 20, '<path d="M2 3.4h3.2M8 3.4h12M8 8.4h12M2 13.4h18M2 18.4h18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M1.6 7.2l3 1.9-3 1.9" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'),
    check: sv(16, 16, '<path d="M2.5 8.5l3.6 3.6 7.4-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  };

  // Original illustration for the finish screen: a laptop showing a smiling face.
  icon.laptopSmile =
    '<svg width="300" height="230" viewBox="0 0 300 230" aria-hidden="true" focusable="false">' +
    '<circle cx="150" cy="112" r="108" fill="#f1f4f8"/>' +
    '<rect x="62" y="38" width="176" height="128" rx="10" fill="#dfe4ea" stroke="#3b4048" stroke-width="3.5"/>' +
    '<rect x="78" y="52" width="144" height="100" rx="3" fill="#fff" stroke="#3b4048" stroke-width="2.5"/>' +
    '<path d="M32 172h236l-10 18a8 8 0 0 1-7 4H49a8 8 0 0 1-7-4z" fill="#dfe4ea" stroke="#3b4048" stroke-width="3.5" stroke-linejoin="round"/>' +
    '<path d="M28 172h244" stroke="#3b4048" stroke-width="3.5" stroke-linecap="round"/>' +
    '<circle cx="150" cy="102" r="36" fill="#c6e6f7" stroke="#2f343b" stroke-width="3.2"/>' +
    '<path d="M131 95q6-7 12 0M157 95q6-7 12 0" stroke="#2f343b" stroke-width="3.2" fill="none" stroke-linecap="round"/>' +
    '<path d="M131 108q19 22 38 0z" fill="#fff" stroke="#2f343b" stroke-width="3.2" stroke-linejoin="round"/>' +
    '</svg>';

  // ------------------------------------------------------------------ Modal
  function modal({ title = '', body = '', actions = [{ id: 'ok', label: 'OK', kind: 'yellow' }], dismissible = true, onOpen, className = '' } = {}) {
    return new Promise((resolve) => {
      const kindClass = { yellow: 'btn-yellow', blue: 'btn-blue', outline: 'btn-outline', plain: 'btn-plain' };
      const bd = el(
        `<div class="modal-backdrop"><div class="modal ${className}" role="dialog" aria-modal="true">` +
          (title ? `<h2>${esc(title)}</h2>` : '') +
          `<div class="modal-body">${body}</div>` +
          `<div class="modal-actions">${actions
            .map((a) => `<button type="button" class="${kindClass[a.kind] || 'btn-plain'}" data-id="${esc(a.id)}">${esc(a.label)}</button>`)
            .join('')}</div></div></div>`
      );
      const box = bd.querySelector('.modal');
      const done = (id) => {
        document.removeEventListener('keydown', onKey, true);
        bd.remove();
        resolve(id);
      };
      const onKey = (e) => {
        if (e.key === 'Escape' && dismissible) {
          e.stopPropagation();
          done(null);
        }
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
          const primary = actions.find((a) => a.primary) || actions[actions.length - 1];
          if (primary) bd.querySelector(`[data-id="${primary.id}"]`).click();
        }
      };
      bd.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-id]');
        if (b) {
          const a = actions.find((x) => x.id === b.dataset.id);
          if (a && a.handler) {
            b.disabled = true;
            let ok;
            try {
              ok = await a.handler(box);
            } finally {
              b.disabled = false;
            }
            if (ok === false) return;
          }
          done(b.dataset.id);
          return;
        }
        if (e.target === bd && dismissible) done(null);
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(bd);
      const first = box.querySelector('input, textarea') || box.querySelector('.modal-actions button:last-child');
      if (first) setTimeout(() => first.focus(), 30);
      if (onOpen) onOpen(box, done);
    });
  }

  function toast(text, ms = 3500) {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = el('<div class="toast-wrap" aria-live="polite"></div>');
      document.body.appendChild(wrap);
    }
    const t = el(`<div class="toast">${esc(text)}</div>`);
    wrap.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // ------------------------------------------------------------------ Battery indicator
  function battery(container, plainIcon = false) {
    if (!container || !navigator.getBattery) return;
    navigator
      .getBattery()
      .then((b) => {
        const draw = () => {
          const pct = Math.round(b.level * 100);
          container.innerHTML = `<span class="pct">${pct}%</span>${b.charging || !plainIcon ? icon.battery : icon.batteryPlain}`;
          container.hidden = false;
        };
        draw();
        b.addEventListener('levelchange', draw);
        b.addEventListener('chargingchange', draw);
      })
      .catch(() => {});
  }

  function fmtClock(totalSeconds) {
    const s = Math.max(0, Math.ceil(totalSeconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function fmtAgo(ms) {
    const s = Math.round(ms / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} hr ago`;
    return `${Math.round(h / 24)} days ago`;
  }

  function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  }

  /** Allow-list HTML sanitizer for free-response answers shown on the dashboard. */
  function sanitize(html) {
    const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'SUP', 'SUB', 'BR', 'P', 'DIV', 'SPAN']);
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
    const walk = (node, out) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) out.appendChild(document.createTextNode(child.nodeValue));
        else if (child.nodeType === 1) {
          if (allowed.has(child.tagName)) {
            const n = document.createElement(child.tagName === 'STRONG' ? 'b' : child.tagName === 'EM' ? 'i' : child.tagName.toLowerCase());
            walk(child, n);
            out.appendChild(n);
          } else if (!['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'TEMPLATE'].includes(child.tagName)) {
            walk(child, out);
          }
        }
      }
      return out;
    };
    const wrap = document.createElement('div');
    walk(doc.body, wrap);
    return wrap.innerHTML;
  }

  const appName = (window.APP_CONFIG && window.APP_CONFIG.appName) || 'Mock Exam';

  window.API = API;
  window.U = { esc, el, sleep, icon, modal, toast, battery, fmtClock, fmtAgo, fmtDuration, fmtTime, sanitize, appName };
})();
