/* Free-response text editor with the same tools as the real thing:
   bold, italic, underline, superscript, subscript, undo, redo, cut, copy, paste,
   special characters, and indent. Spell check is off. Only text copied from your
   own response can be pasted. */
window.RTE = (function () {
  'use strict';
  const { icon } = U;
  let clip = ''; // internal clipboard: text copied/cut from a response
  const CHARS = (
    'á é í ó ú ñ ü ç à è ì ò ù â ê î ô û ä ë ï ö ß Á É Í Ó Ú Ñ Ü Ç ¿ ¡ « » ' +
    '“ ” ‘ ’ — – … • ° ± × ÷ ≈ ≠ ≤ ≥ √ ∞ π θ Δ Σ µ Ω α β γ λ ² ³ ½ ¼ ¾ → ← ↔ ⇌ ¢ € £ ¥ § ¶ © ®'
  ).split(' ');
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  let activeRefresh = null;
  document.addEventListener('selectionchange', () => {
    if (activeRefresh) activeRefresh();
  });

  const BUTTONS = [
    ['bold', 'Bold', '<span class="t b">B</span>'],
    ['italic', 'Italic', '<span class="t i">I</span>'],
    ['underline', 'Underline', '<span class="t u">U</span>'],
    ['superscript', 'Superscript', '<span class="t sup">X<sup>2</sup></span>'],
    ['subscript', 'Subscript', '<span class="t sub">X<sub>2</sub></span>'],
    ['undo', 'Undo', icon.undo],
    ['redo', 'Redo', icon.redo],
    ['cut', 'Cut', icon.cut],
    ['copy', 'Copy', icon.copy],
    ['paste', 'Paste', icon.paste],
    ['chars', 'Special characters', '<span class="t" style="font-family:var(--serif);font-size:20px">Ω</span>'],
    ['indent', 'Indent', icon.indent],
  ];

  function debounce(fn, ms) {
    let t;
    const d = (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
    d.flush = (...a) => {
      clearTimeout(t);
      fn(...a);
    };
    return d;
  }

  function mount(root, { html = '', onChange, onBlockedPaste } = {}) {
    root.innerHTML =
      `<div class="rte-bar" role="toolbar" aria-label="Formatting">${BUTTONS.map(
        ([cmd, label, inner]) => `<button type="button" class="rte-btn" data-cmd="${cmd}" title="${label}" aria-label="${label}">${inner}</button>`
      ).join('')}</div>` +
      '<div class="rte-area" contenteditable="true" spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off" role="textbox" aria-multiline="true" aria-label="Your response"></div>';
    const bar = root.querySelector('.rte-bar');
    const area = root.querySelector('.rte-area');
    area.innerHTML = U.sanitize(html);
    let popup = null;

    const emit = debounce(() => onChange && onChange(U.sanitize(area.innerHTML)), 350);
    let typed = false;
    let undone = false;

    const refresh = () => {
      for (const b of bar.querySelectorAll('[data-cmd]')) {
        const c = b.dataset.cmd;
        if (['bold', 'italic', 'underline', 'superscript', 'subscript'].includes(c)) {
          let on = false;
          try {
            on = document.activeElement === area && document.queryCommandState(c);
          } catch {
            on = false;
          }
          b.classList.toggle('on', on);
        }
      }
      bar.querySelector('[data-cmd="undo"]').disabled = !typed;
      bar.querySelector('[data-cmd="redo"]').disabled = !undone;
    };

    area.addEventListener('input', () => {
      typed = true;
      emit();
      refresh();
    });
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        document.execCommand('insertText', false, '\t');
      }
    });
    const remember = () => {
      const t = window.getSelection().toString();
      if (t) clip = t;
    };
    area.addEventListener('copy', remember);
    area.addEventListener('cut', remember);
    area.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      if (text && clip && norm(text) === norm(clip)) document.execCommand('insertText', false, text);
      else if (text && onBlockedPaste) onBlockedPaste();
    });
    area.addEventListener('drop', (e) => e.preventDefault());
    activeRefresh = () => {
      if (root.isConnected) refresh();
    };

    bar.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
    });
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmd]');
      if (!b || b.disabled) return;
      const cmd = b.dataset.cmd;
      area.focus();
      if (cmd === 'chars') return openChars(b);
      if (cmd === 'paste') {
        if (clip) document.execCommand('insertText', false, clip);
        return;
      }
      if (cmd === 'cut' || cmd === 'copy') {
        remember();
        try {
          document.execCommand(cmd);
        } catch {
          /* ignore */
        }
        if (cmd === 'cut') {
          const sel = window.getSelection();
          if (sel && !sel.isCollapsed && area.contains(sel.anchorNode)) document.execCommand('delete');
        }
        emit();
        return;
      }
      if (cmd === 'indent') {
        document.execCommand('insertText', false, '\t');
        return;
      }
      if (cmd === 'undo') undone = true;
      if (cmd === 'redo') undone = false;
      document.execCommand(cmd);
      emit();
      refresh();
    });

    function openChars(btn) {
      if (popup) {
        popup.remove();
        popup = null;
        return;
      }
      popup = document.createElement('div');
      popup.className = 'chars-pop';
      popup.innerHTML = CHARS.map((c) => `<button type="button" data-ch="${c}" aria-label="Insert ${c}">${c}</button>`).join('');
      popup.addEventListener('mousedown', (e) => e.preventDefault());
      popup.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ch]');
        if (!b) return;
        area.focus();
        document.execCommand('insertText', false, b.dataset.ch);
      });
      document.body.appendChild(popup);
      const r = btn.getBoundingClientRect();
      const w = popup.offsetWidth;
      popup.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
      popup.style.top = `${r.bottom + 6}px`;
      const close = (ev) => {
        if (popup && !popup.contains(ev.target) && ev.target !== btn && !btn.contains(ev.target)) {
          popup.remove();
          popup = null;
          document.removeEventListener('mousedown', close, true);
        }
      };
      document.addEventListener('mousedown', close, true);
    }

    refresh();
    return {
      area,
      flush: () => emit.flush(),
      destroy: () => {
        emit.flush();
        if (popup) popup.remove();
        activeRefresh = null;
      },
    };
  }

  return { mount };
})();
