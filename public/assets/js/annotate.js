/* Highlights, underlines and notes on passages and question text.
   Annotations are stored as character offsets per container, so they survive
   moving between questions and reloading the page (saved in this browser). */
window.Annot = (function () {
  'use strict';
  const { icon, esc } = U;
  let store = {};
  let storageKey = null;
  const mounted = new Set();
  let tb = null;
  let ulMenu = null;
  let target = null; // { container, start, end } or { container, ann }
  const uid = () => Math.random().toString(36).slice(2, 10);

  function load(attemptId) {
    storageKey = `mx-annot-${attemptId}`;
    try {
      store = JSON.parse(localStorage.getItem(storageKey) || '{}') || {};
    } catch {
      store = {};
    }
  }
  function save() {
    try {
      if (storageKey) localStorage.setItem(storageKey, JSON.stringify(store));
    } catch {
      /* storage may be unavailable; annotations still work for this visit */
    }
  }

  // ------------------------------------------------------------ mounting & painting
  function mount(container, key, opts = {}) {
    container.classList.add('annot');
    container.dataset.akey = key;
    container._pristine = container.innerHTML;
    container._after = opts.after || null;
    container._scroller = opts.scroller || container.closest('.pane-scroll, .center-scroll');
    mounted.add(container);
    paint(container);
    if (window.ResizeObserver) {
      container._ro = new ResizeObserver(() => drawOverlays(container));
      container._ro.observe(container);
    }
  }

  function unmountAll() {
    for (const c of mounted) {
      if (c._ro) c._ro.disconnect();
      if (c._layer) c._layer.remove();
    }
    mounted.clear();
    hideToolbar();
  }

  function findContainer(key) {
    for (const c of mounted) if (c.dataset.akey === key && c.isConnected) return c;
    return null;
  }

  function markClass(a) {
    let cls = 'hl';
    if (a.color) cls += ` c-${a.color}`;
    if (a.underline) cls += ` u-${a.underline}`;
    return cls;
  }

  function paint(container) {
    const key = container.dataset.akey;
    container.innerHTML = container._pristine;
    const list = (store[key] || []).slice().sort((x, y) => x.start - y.start);
    if (list.length) wrap(container, list);
    if (container._after) container._after(container);
    drawOverlays(container);
  }

  function textNodes(container) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const out = [];
    let pos = 0;
    let n;
    while ((n = walker.nextNode())) {
      out.push([n, pos]);
      pos += n.nodeValue.length;
    }
    return out;
  }

  function wrap(container, list) {
    for (const [node, start] of textNodes(container)) {
      const text = node.nodeValue;
      const end = start + text.length;
      const parts = list.filter((a) => a.start < end && a.end > start);
      if (!parts.length || !text.trim()) continue;
      const frag = document.createDocumentFragment();
      let cursor = start;
      for (const a of parts) {
        const s = Math.max(a.start, start);
        const e = Math.min(a.end, end);
        if (s > cursor) frag.append(text.slice(cursor - start, s - start));
        const m = document.createElement('mark');
        m.className = markClass(a);
        m.dataset.ann = a.id;
        m.textContent = text.slice(s - start, e - start);
        frag.append(m);
        cursor = e;
      }
      if (cursor < end) frag.append(text.slice(cursor - start));
      node.replaceWith(frag);
    }
  }

  function offsetsOf(container, range) {
    const pre = document.createRange();
    pre.selectNodeContents(container);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    pre.setEnd(range.endContainer, range.endOffset);
    const end = pre.toString().length;
    return [start, end];
  }

  // ------------------------------------------------------------ store operations
  function applyRange(key, s, e, props) {
    const list = (store[key] = store[key] || []);
    const inside = list.find((a) => a.start <= s && a.end >= e);
    if (inside) {
      Object.assign(inside, props);
      return inside;
    }
    const created = { id: uid(), start: s, end: e, color: null, underline: null, note: '', noteOpen: false };
    const next = [];
    for (const a of list) {
      if (a.end <= s || a.start >= e) {
        next.push(a);
        continue;
      }
      if (a.note && !created.note) created.note = a.note;
      if (!created.color && a.color) created.color = a.color;
      if (!created.underline && a.underline) created.underline = a.underline;
      if (a.start < s) next.push({ ...a, id: uid(), end: s, note: '', noteOpen: false });
      if (a.end > e) next.push({ ...a, id: uid(), start: e, note: '', noteOpen: false });
    }
    Object.assign(created, props);
    next.push(created);
    store[key] = next.sort((x, y) => x.start - y.start);
    return created;
  }

  function cleanup(key) {
    if (!store[key]) return;
    store[key] = store[key].filter((a) => a.color || a.underline || a.note || a.noteOpen);
    if (!store[key].length) delete store[key];
  }

  function find(key, id) {
    return (store[key] || []).find((a) => a.id === id) || null;
  }

  // ------------------------------------------------------------ notes overlay
  function drawOverlays(container) {
    const sc = container._scroller;
    if (!sc || !container.isConnected) return;
    if (!container._layer || !container._layer.isConnected) {
      container._layer = document.createElement('div');
      container._layer.className = 'annot-layer';
      sc.appendChild(container._layer);
    }
    const layer = container._layer;
    layer.innerHTML = '';
    const key = container.dataset.akey;
    const list = store[key] || [];
    const sr = sc.getBoundingClientRect();
    for (const a of list) {
      if (!a.note && !a.noteOpen) continue;
      const marks = container.querySelectorAll(`mark[data-ann="${a.id}"]`);
      if (!marks.length) continue;
      const rects = marks[marks.length - 1].getClientRects();
      const r = rects[rects.length - 1];
      if (!r) continue;
      const x = r.right - sr.left + sc.scrollLeft;
      const y = r.top - sr.top + sc.scrollTop;
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = `note-pin${a.noteOpen ? ' open' : ''}`;
      pin.setAttribute('aria-label', a.noteOpen ? 'Hide note' : 'Show note');
      pin.innerHTML = icon.note + icon.chevSmall;
      pin.style.left = `${Math.min(x + 3, sc.clientWidth - 30)}px`;
      pin.style.top = `${y + (r.height - 20) / 2}px`;
      pin.addEventListener('click', () => {
        a.noteOpen = !a.noteOpen;
        cleanup(key);
        save();
        drawOverlays(container);
      });
      layer.appendChild(pin);
      if (a.noteOpen) {
        const first = marks[0].getClientRects()[0] || r;
        const width = Math.min(290, sc.clientWidth - 24);
        const left = Math.max(10, Math.min(first.left - sr.left + sc.scrollLeft - 6, sc.clientWidth - width - 14));
        const card = document.createElement('div');
        card.className = 'note-card';
        card.style.width = `${width}px`;
        card.style.left = `${left}px`;
        card.style.top = `${r.bottom - sr.top + sc.scrollTop + 8}px`;
        const quote = [...marks].map((m) => m.textContent).join('');
        card.innerHTML =
          `<div class="nc-head"><div class="nc-quote">“${esc(quote.length > 90 ? quote.slice(0, 88) + '…' : quote)}”</div>` +
          `<button type="button" class="nc-hide" aria-label="Hide note">${icon.chevUp}</button></div>` +
          `<textarea placeholder="Type a note. Notes aren't scored." aria-label="Note"></textarea>` +
          `<div class="nc-foot"><span>Saved automatically</span><button type="button" class="nc-del">${icon.trash}<span>Delete note</span></button></div>`;
        const ta = card.querySelector('textarea');
        ta.value = a.note || '';
        ta.addEventListener('input', () => {
          a.note = ta.value;
          save();
        });
        card.querySelector('.nc-hide').addEventListener('click', () => {
          a.noteOpen = false;
          cleanup(key);
          save();
          paint(container);
        });
        card.querySelector('.nc-del').addEventListener('click', () => {
          a.note = '';
          a.noteOpen = false;
          cleanup(key);
          save();
          paint(container);
        });
        layer.appendChild(card);
        if (a._focus) {
          delete a._focus;
          setTimeout(() => ta.focus(), 20);
        }
      }
    }
  }

  function redrawAll() {
    for (const c of mounted) drawOverlays(c);
  }

  // ------------------------------------------------------------ toolbar
  function buildToolbar() {
    tb = document.createElement('div');
    tb.className = 'hl-tb';
    tb.setAttribute('role', 'toolbar');
    tb.setAttribute('aria-label', 'Highlight and note tools');
    tb.innerHTML =
      '<button type="button" class="sw sw-yellow" data-c="yellow" aria-label="Yellow highlight"></button>' +
      '<button type="button" class="sw sw-blue" data-c="blue" aria-label="Blue highlight"></button>' +
      '<button type="button" class="sw sw-pink" data-c="pink" aria-label="Pink highlight"></button>' +
      `<button type="button" class="tb-ul" aria-label="Underline style" aria-haspopup="menu">${icon.underlineStyles}${icon.chevSmall}</button>` +
      `<button type="button" class="tb-round tb-del" aria-label="Remove highlight">${icon.trash}</button>` +
      '<span class="tb-sep" aria-hidden="true"></span>' +
      `<button type="button" class="tb-round tb-note" aria-label="Add a note">${icon.notePlus}</button>`;
    tb.addEventListener('mousedown', (e) => e.preventDefault());
    tb.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.c) act('color', b.dataset.c);
      else if (b.classList.contains('tb-ul')) openUnderlineMenu(b);
      else if (b.classList.contains('tb-del')) act('delete');
      else if (b.classList.contains('tb-note')) act('note');
    });
    document.body.appendChild(tb);
  }

  function showToolbar(t, rect) {
    if (!tb) buildToolbar();
    target = t;
    closeUnderlineMenu();
    tb.hidden = false;
    document.querySelectorAll('mark.hl.active').forEach((m) => m.classList.remove('active'));
    const ann = t.ann;
    tb.querySelectorAll('.sw').forEach((s) => s.classList.toggle('on', !!ann && ann.color === s.dataset.c));
    if (ann) t.container.querySelectorAll(`mark[data-ann="${ann.id}"]`).forEach((m) => m.classList.add('active'));
    const w = tb.offsetWidth || 260;
    const h = tb.offsetHeight || 42;
    let top = rect.top - h - 10;
    if (top < 92) top = rect.bottom + 10;
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    tb.style.top = `${Math.round(top)}px`;
    tb.style.left = `${Math.round(left)}px`;
  }

  function hideToolbar() {
    if (tb) tb.hidden = true;
    closeUnderlineMenu();
    target = null;
    document.querySelectorAll('mark.hl.active').forEach((m) => m.classList.remove('active'));
  }

  function openUnderlineMenu(btn) {
    closeUnderlineMenu();
    ulMenu = document.createElement('div');
    ulMenu.className = 'ul-menu';
    ulMenu.setAttribute('role', 'menu');
    const opts = [
      ['solid', 'Solid underline', 'solid'],
      ['dashed', 'Dashed underline', 'dashed'],
      ['dotted', 'Dotted underline', 'dotted'],
      ['', 'No underline', 'none'],
    ];
    ulMenu.innerHTML = opts
      .map(([v, label, st]) => `<button type="button" role="menuitem" data-u="${v}"><span class="ul-sample" style="border-bottom-style:${st === 'none' ? 'hidden' : st}"></span>${label}</button>`)
      .join('');
    ulMenu.addEventListener('mousedown', (e) => e.preventDefault());
    ulMenu.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      act('underline', b.dataset.u || null);
      closeUnderlineMenu();
    });
    document.body.appendChild(ulMenu);
    const r = btn.getBoundingClientRect();
    ulMenu.style.left = `${Math.max(8, r.left - 20)}px`;
    ulMenu.style.top = `${r.bottom + 8}px`;
  }
  function closeUnderlineMenu() {
    if (ulMenu) ulMenu.remove();
    ulMenu = null;
  }

  function act(kind, value) {
    const t = target;
    if (!t || !t.container.isConnected) return hideToolbar();
    const key = t.container.dataset.akey;
    let ann = t.ann ? find(key, t.ann.id) : null;
    if (kind === 'delete') {
      if (ann) store[key] = (store[key] || []).filter((a) => a.id !== ann.id);
      else if (store[key]) store[key] = store[key].filter((a) => a.end <= t.start || a.start >= t.end);
      cleanup(key);
      save();
      window.getSelection().removeAllRanges();
      hideToolbar();
      paint(t.container);
      return;
    }
    if (kind === 'color') {
      if (ann) ann.color = ann.color === value ? null : value;
      else ann = applyRange(key, t.start, t.end, { color: value });
    } else if (kind === 'underline') {
      if (ann) ann.underline = value;
      else if (value) ann = applyRange(key, t.start, t.end, { underline: value });
      else return hideToolbar();
    } else if (kind === 'note') {
      if (!ann) ann = applyRange(key, t.start, t.end, { color: 'yellow' });
      ann.noteOpen = true;
      ann._focus = true;
    }
    cleanup(key);
    save();
    window.getSelection().removeAllRanges();
    paint(t.container);
    const still = find(key, ann.id);
    const m = still && t.container.querySelector(`mark[data-ann="${ann.id}"]`);
    if (m && kind !== 'note') showToolbar({ container: t.container, ann: still }, m.getBoundingClientRect());
    else hideToolbar();
  }

  /** Used by the "Highlights & Notes" header button. Returns true if something was highlighted. */
  function highlightSelection() {
    const info = currentSelection();
    if (!info) return false;
    target = { container: info.container, start: info.start, end: info.end };
    act('color', 'yellow');
    return true;
  }

  function currentSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const elx = node.nodeType === 1 ? node : node.parentElement;
    const container = elx && elx.closest('.annot');
    if (!container || !mounted.has(container)) return null;
    if (!range.toString().trim()) return null;
    const [start, end] = offsetsOf(container, range);
    if (end <= start) return null;
    return { container, start, end, rect: range.getBoundingClientRect() };
  }

  // ------------------------------------------------------------ global listeners
  function onPointerUp(e) {
    if (e.target.closest && e.target.closest('.hl-tb, .ul-menu, .note-card, .note-pin')) return;
    setTimeout(() => {
      const info = currentSelection();
      if (info) {
        showToolbar({ container: info.container, start: info.start, end: info.end }, info.rect);
        return;
      }
      const m = e.target.closest && e.target.closest('mark.hl');
      const sel = window.getSelection();
      if (m && (!sel || sel.isCollapsed)) {
        const c = m.closest('.annot');
        const a = c && find(c.dataset.akey, m.dataset.ann);
        if (a) {
          showToolbar({ container: c, ann: a }, m.getBoundingClientRect());
          return;
        }
      }
      hideToolbar();
    }, 0);
  }
  document.addEventListener('mouseup', onPointerUp);
  document.addEventListener('touchend', onPointerUp);
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape') hideToolbar();
    else if (e.shiftKey) onPointerUp(e);
  });
  document.addEventListener('scroll', () => hideToolbar(), true);
  window.addEventListener('resize', () => {
    hideToolbar();
    redrawAll();
  });

  return { load, mount, unmountAll, redrawAll, highlightSelection, hideToolbar, findContainer };
})();
