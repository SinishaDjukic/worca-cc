// pinpoint.mjs — Pinpoint (#669): select text in a chat answer, a run artifact or the Diff tab and act on exactly that
// span from a floating toolbar (Copy · Explain · Alternatives · Disagree · Note / Comment · Quote / Send to chat).
//
// One controller per page (createPinpoint); each surface registers its root with a provider that says what the
// actions do there (app.js wires the chat, the artifact viewer and the diff). The toolbar shows 120ms after the mouse
// comes up (400ms after keyboard selection settles), centred over the line the selection ended on, kept 8px inside the
// surface's container, flipped below when it has no room above. Single-letter shortcuts while it is up; Esc closes.
// Explain and Alternatives ask POST /api/pinpoint (NDJSON). Highlights use the CSS Custom Highlight API, so no surface's
// DOM is ever rewritten (a streaming answer or a syntax highlighter repaints freely underneath). CSS prefix pp-.
import {
  PINPOINT_ACTIONS, DISAGREE_REASONS, normText, shortText, clipQuote, contextAround, lineRect, placeBar, placePop,
  normalizeAlternatives, disagreeText, useAltText,
} from './pinpoint-model.mjs';

/**
 * @typedef {object} PinpointSel
 * @property {Range} range
 * @property {string} text        the quote (lines kept)
 * @property {boolean} code       inside code (a diff, a code block)
 * @property {Element} unit       the element the selection lives in (one answer, one document, one diff body)
 * @property {object} p           the provider
 * @property {number} at          the quote's character offset in `unit`
 * @property {string} context     the text around it, for Explain / Alternatives
 * @property {object|null} ext    what the provider's extract() added (a diff line, side, path)
 *
 * @typedef {object} PinpointProvider
 * @property {'chat'|'artifact'|'diff'|'web'} kind
 * @property {(el:Element) => Element|null} [unit]   the selection's unit for a node inside the root; null = not here
 * @property {(range:Range, unit:Element) => object|null} [extract]   {text, ...} — what the selection really quotes
 * @property {(sel:PinpointSel) => string} [source]   e.g. "plan.md", "src/x.ts L12"
 * @property {() => Element} [container]   whose box the toolbar stays inside (default: the root)
 * @property {() => {left:number, top:number, right:number, bottom:number}|null} [bounds]   a tighter box than the
 *   container's (the chat: above the docked composer)
 * @property {() => Element} [layer]   where the toolbar and popovers mount (default: <body>)
 * @property {() => boolean} [pending]   artifact: Disagree / Note / Use this collect in the tray instead
 * @property {(sel:PinpointSel, item:{kind:string, text:string}) => void} [addPending]
 * @property {(sel:PinpointSel, text:string) => Promise<string|null>} [comment]   diff: an error to show, or null
 * @property {(q:object, text?:string) => void} draft   put the quote (and text) in the chat composer, not sent
 * @property {(q:object, text:string) => void} [send]   send it now (chat); default draft
 */

const SVG = {
  copy: 'M11 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  check: 'M20 6L9 17l-5-5',
  explain: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3 M12 17h.01',
  alts: 'M16 3h5v5 M4 20L21 3 M21 16v5h-5 M15 15l6 6 M4 4l5 5',
  disagree: 'M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3z M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17',
  quote: 'M9 14L4 9l5-5 M20 20v-7a4 4 0 0 0-4-4H4',
  note: 'M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z',
  comment: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  send: 'M22 2L11 13 M22 2l-7 20-4-9-9-4 20-7z',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  x: 'M18 6L6 18 M6 6l12 12',
};
const NARROW = 470;
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const icon = (k, size = 15) => `<svg class="pp-i" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"${k === 'more' ? ' style="stroke-width:3"' : ''}><path d="${SVG[k]}"/></svg>`;
/** Inline code and bold in an answer; everything else escaped. */
const inlineMd = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
const paras = (t) => String(t).split(/\n{2,}/).filter((p) => p.trim()).map((p) => `<p>${inlineMd(p.trim())}</p>`).join('');

/**
 * Read POST /api/pinpoint's NDJSON. Resolves when the server says done; throws on an error line or a refusal.
 * @param {(url:string, opts:object) => Promise<Response>} fetchFn
 */
export async function streamPinpoint(fetchFn, body, { onDelta = () => {}, onAlternatives = () => {}, signal } = {}) {
  const res = await fetchFn('/api/pinpoint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) {
    let m = `request failed (${res.status})`;
    try { const b = await res.json(); if (b && b.error) m = b.error; } catch { /* keep the fallback */ }
    throw new Error(m);
  }
  const handle = (line) => {
    if (!line.trim()) return false;
    let o = null;
    try { o = JSON.parse(line); } catch { return false; }
    if (o.type === 'delta' && typeof o.text === 'string') onDelta(o.text);
    else if (o.type === 'alternatives') onAlternatives(o.alternatives);
    else if (o.type === 'error') throw new Error(o.error || 'the answer failed');
    return o.type === 'done';
  };
  const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  if (!reader) {
    for (const line of (await res.text()).split('\n')) if (handle(line)) return;
    return;
  }
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) > -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (handle(line)) return;
    }
    if (done) { handle(buf); return; }
  }
}

/**
 * @param {{doc?:Document, win?:Window, fetch?:Function, trustedOnly?:boolean|((e:Event) => boolean), shadow?:{host:Element, root:ShadowRoot}|null, auto?:boolean}} [o]
 *   shadow — the browser extension mounts the toolbar/popovers in a shadow root (closed in production). Document-level
 *   events are retargeted to its host and doc.activeElement IS the host, so the real target/focus is read from `root`.
 *   trustedOnly — on a web page, a page script must not be able to press the toolbar's buttons, its shortcuts or a
 *   popover's keys. `true` = e.isTrusted; a function decides per event (the jsdom tests, which cannot make trusted events).
 *   auto — false: a selection opens nothing until openAtSelection() (the browser extension's "Pinpoint on request").
 *   Default true: worca's own pages are unchanged.
 * @returns {{addSurface(root:Element, p:PinpointProvider):() => void, close():void, holding():boolean, destroy():void,
 *   setAuto(on:boolean):void, openAtSelection():boolean}}
 */
export function createPinpoint({ doc = document, win = doc.defaultView, fetch: fetchFn = (u, o) => win.fetch(u, o), trustedOnly = false, shadow = null, auto = true } = {}) {
  let autoOpen = auto !== false;
  const surfaces = new Map();       // root → provider
  const X = { sel: null, bar: null, items: [], over: [], more: null, pop: null, t: 0, kt: 0, lastRect: null };
  const HL = win.CSS && win.CSS.highlights && typeof win.Highlight === 'function' ? win.CSS.highlights : null;

  const nodeEl = (n) => (n ? (n.nodeType === 1 ? n : n.parentElement) : null);
  const typing = (el) => !!(el && el.closest && el.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]'));
  const el = (html) => { const t = doc.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const $$ = (s, r) => [...r.querySelectorAll(s)];
  const reduced = () => !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ours = (e) => !!(shadow && e && typeof e.composedPath === 'function' && e.composedPath().includes(shadow.host));
  /** The element an event really concerns. For an event from inside `shadow`, a document listener sees only the host
   *  (closed root): a pointer event resolves by position, a key event by the root's focus. A pointer over nothing in
   *  the root resolves to null (= outside), never to the focused element. */
  function realTarget(e) {
    if (!e) return null;
    if (!ours(e)) return e.target;
    if (/^(pointer|mouse|click)/.test(e.type)) {
      const hit = typeof e.clientX === 'number' && typeof shadow.root.elementFromPoint === 'function' ? shadow.root.elementFromPoint(e.clientX, e.clientY) : null;
      return hit && hit !== shadow.host ? hit : null;
    }
    return shadow.root.activeElement || null;
  }
  const within = (box, e) => { const t = realTarget(e); return !!(box && t && t.nodeType && box.contains(t)); };
  const activeEl = () => (shadow && doc.activeElement === shadow.host ? shadow.root.activeElement : doc.activeElement);
  const honoured = (e) => !trustedOnly || (typeof trustedOnly === 'function' ? !!trustedOnly(e) : !!(e && e.isTrusted));

  function surfaceOf(node) {
    const e = nodeEl(node);
    for (let n = e; n; n = n.parentElement) {
      const p = surfaces.get(n);
      if (!p) continue;
      const unit = p.unit ? p.unit(e) : n;
      return unit ? { root: n, p, unit } : null;
    }
    return null;
  }

  function offsetOf(root, node, off) {
    const r = doc.createRange();
    r.selectNodeContents(root);
    try { r.setEnd(node, off); } catch { return 0; }
    return r.toString().length;
  }

  /** @returns {PinpointSel|null} */
  function readSelection() {
    const s = win.getSelection ? win.getSelection() : null;
    if (!s || !s.rangeCount || s.isCollapsed) return null;
    const a = surfaceOf(s.anchorNode);
    const f = surfaceOf(s.focusNode);
    if (!a || !f || a.unit !== f.unit) return null;
    const range = s.getRangeAt(0).cloneRange();
    const ext = a.p.extract ? a.p.extract(range, a.unit) : null;
    if (a.p.extract && !ext) return null;
    const raw = ext ? ext.text : range.toString();
    const text = clipQuote(raw);
    if (normText(text).length < 2) return null;
    const inCode = (n) => !!nodeEl(n)?.closest('pre, code');
    const backward = s.anchorNode === s.focusNode
      ? s.anchorOffset > s.focusOffset
      : !!(s.anchorNode.compareDocumentPosition(s.focusNode) & 2);   // DOCUMENT_POSITION_PRECEDING
    const at = offsetOf(a.unit, range.startContainer, range.startOffset);
    const full = a.unit.textContent || '';
    return {
      range, text, backward, unit: a.unit, root: a.root, p: a.p, kind: a.p.kind, at, ext,
      code: ext && ext.code != null ? !!ext.code : (inCode(range.startContainer) && inCode(range.endContainer)),
      context: contextAround(full, at, at + range.toString().length),
    };
  }

  const sourceOf = (sel) => (sel.p.source ? sel.p.source(sel) || '' : '');
  const quoteOf = (sel) => ({ text: sel.text, ...(sourceOf(sel) ? { src: sourceOf(sel) } : {}), ...(sel.code ? { code: true } : {}) });
  const pendingMode = (sel) => !!(sel.p.pending && sel.p.pending());
  const sendVia = (sel, text) => (sel.p.send || sel.p.draft)(quoteOf(sel), text);

  function view(sel) {
    const c = (sel.p.container ? sel.p.container() : null) || sel.root;
    const r = (sel.p.bounds ? sel.p.bounds() : null) || c.getBoundingClientRect();
    return { left: Math.max(0, r.left), right: Math.min(win.innerWidth, r.right), top: Math.max(0, r.top), bottom: Math.min(win.innerHeight, r.bottom) };
  }
  const layerOf = (sel) => (sel.p.layer ? sel.p.layer() : null) || doc.body;

  function anchorRect(sel) {
    let rects = [];
    try { rects = [...sel.range.getClientRects()]; } catch { rects = []; }
    const r = lineRect(rects, sel.backward);
    if (r) X.lastRect = r;
    return r || X.lastRect;
  }

  function setActive(range) {
    if (!HL) return;
    if (range) HL.set('pinpoint-active', new win.Highlight(range)); else HL.delete('pinpoint-active');
  }

  // ---------------------------------------------------------------- toolbar
  function showBar(sel) {
    closeBar();
    X.sel = sel;
    X.lastRect = null;
    const set = PINPOINT_ACTIONS[sel.kind] || PINPOINT_ACTIONS.chat;
    const narrow = view(sel).right - view(sel).left < NARROW;
    const btns = set.filter((s) => s[0] !== '|');
    X.items = narrow ? btns.slice(0, 4) : set;
    X.over = narrow ? btns.slice(4) : [];
    const btn = ([k, label, kbd, lab]) => `<button type="button" class="pp-b${lab ? ' pp-lab' : ''}" data-k="${k}" aria-label="${esc(label)}" aria-keyshortcuts="${kbd}" title="${esc(label)} (${kbd})">${icon(k)}${lab ? `<span>${esc(label)}</span>` : ''}</button>`;
    const bar = el(`<div class="pp-bar" role="toolbar" aria-label="Selection actions">${X.items.map((s) => (s[0] === '|' ? '<i class="pp-sep" aria-hidden="true"></i>' : btn(s))).join('')}${X.over.length ? `<i class="pp-sep" aria-hidden="true"></i><button type="button" class="pp-b" data-k="more" aria-label="More" aria-haspopup="menu" aria-expanded="false" title="More">${icon('more')}</button>` : ''}<i class="pp-arr" aria-hidden="true"></i></div>`);
    bar.addEventListener('pointerdown', (e) => e.preventDefault());   // keep the selection
    bar.addEventListener('click', (e) => { if (!honoured(e)) return; const b = e.target.closest('[data-k]'); if (b) act(b.dataset.k, b); });
    layerOf(sel).appendChild(bar);
    X.bar = bar;
    positionBar();
  }

  function closeBar() {
    X.more = null;
    X.bar?.remove();
    X.bar = null;
    if (!X.pop) X.sel = null;
  }

  function positionBar() {
    const bar = X.bar;
    const sel = X.sel;
    if (!bar || !sel) return;
    const r = anchorRect(sel);
    const V = view(sel);
    if (!r || r.bottom < V.top + 2 || r.top > V.bottom - 2) { closeBar(); return; }
    const p = placeBar(r, { w: bar.offsetWidth, h: bar.offsetHeight }, V);
    bar.classList.toggle('pp-below', p.below);
    bar.style.left = `${p.left}px`;
    bar.style.top = `${p.top}px`;
    bar.querySelector('.pp-arr').style.left = `${p.arrow}px`;
    if (X.more) positionMore();
  }

  function toggleMore(b) {
    if (X.more) { X.more.remove(); X.more = null; b.setAttribute('aria-expanded', 'false'); return; }
    const m = el(`<div class="pp-more" role="menu">${X.over.map(([k, label, kbd]) => `<button type="button" class="pp-mi" role="menuitem" data-k="${k}">${icon(k, 14)}<span>${esc(label)}</span><kbd>${kbd}</kbd></button>`).join('')}</div>`);
    X.bar.appendChild(m);                   // its clicks reach the bar's own handler
    X.more = m;
    b.setAttribute('aria-expanded', 'true');
    positionMore();
    m.querySelector('button')?.focus({ preventScroll: true });
  }
  function positionMore() {
    const below = X.bar.classList.contains('pp-below');
    X.more.style.top = below ? 'calc(100% + 6px)' : '';
    X.more.style.bottom = below ? '' : 'calc(100% + 6px)';
  }

  function act(k, b) {
    const sel = X.sel;
    if (!sel) return;
    switch (k) {
      case 'copy': {
        try { win.navigator.clipboard?.writeText(sel.text).catch(() => {}); } catch { /* clipboard blocked */ }
        const target = b || X.bar?.querySelector('[data-k="copy"]');
        if (!target) return;
        const lab = target.classList.contains('pp-lab');
        target.classList.add('pp-ok', 'pp-lab');
        target.innerHTML = `${icon('check')}<span>Copied</span>`;
        positionBar();
        clearTimeout(target._t);
        target._t = setTimeout(() => {
          if (!target.isConnected) return;
          target.classList.remove('pp-ok');
          if (!lab) target.classList.remove('pp-lab');
          target.innerHTML = icon('copy') + (lab ? '<span>Copy</span>' : '');
          positionBar();
        }, 1200);
        return;
      }
      case 'explain': return openExplain(sel);
      case 'alts': return openAlts(sel);
      case 'disagree': case 'note': case 'comment': return openCompose(sel, k);
      case 'quote': case 'send': {
        win.getSelection()?.removeAllRanges();
        closeAll();
        sel.p.draft(quoteOf(sel), '');
        return;
      }
      case 'more': return toggleMore(b || X.bar.querySelector('[data-k="more"]'));
      default:
    }
  }

  // ---------------------------------------------------------------- popovers
  function openPop(sel, pop) {
    closeBar();
    closePop(false);
    X.sel = sel;
    setActive(sel.range);
    win.getSelection()?.removeAllRanges();
    pop.insertAdjacentHTML('afterbegin', '<i class="pp-parr" aria-hidden="true"></i>');
    pop.addEventListener('pointerdown', (e) => e.stopPropagation());
    layerOf(sel).appendChild(pop);
    X.pop = { el: pop, sel, stop: null, onKey: null };
    positionPop();
    return X.pop;
  }

  function positionPop() {
    const p = X.pop;
    if (!p) return;
    const r = anchorRect(p.sel);
    const V = view(p.sel);
    if (!r) { closePop(false); return; }
    const o = placePop(r, { w: p.el.offsetWidth, h: p.el.offsetHeight }, { ...V, top: Math.max(V.top, 0), bottom: Math.min(V.bottom, win.innerHeight) });
    // Taller than the room on its side: it shrinks, and its list or answer scrolls (.pp-pop is a flex column).
    const room = o.above ? r.top - 10 - V.top - 8 : V.bottom - (r.bottom + 10) - 8;
    p.el.style.maxHeight = `${Math.max(160, Math.floor(room))}px`;
    if (o.above) o.top = Math.max(V.top + 8, r.top - 10 - p.el.offsetHeight);
    p.el.classList.toggle('pp-above', o.above);
    p.el.style.left = `${o.left}px`;
    p.el.style.top = `${o.top}px`;
    p.el.querySelector('.pp-parr').style.left = `${o.arrow}px`;
  }

  /** restore = put the selection back and show the toolbar again (the first Esc); a second Esc clears it. */
  function closePop(restore) {
    const p = X.pop;
    if (!p) return;
    X.pop = null;
    try { p.stop?.(); } catch { /* already done */ }
    p.el.remove();
    setActive(null);
    const r = p.sel.range;
    if (restore && r.startContainer.isConnected && r.endContainer.isConnected) {
      const s = win.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      const again = readSelection();
      if (again) { showBar(again); X.bar.querySelector('.pp-b')?.focus({ preventScroll: true }); return; }
    }
    X.sel = null;
  }

  function closeAll() { closePop(false); closeBar(); }

  const head = (k, title, sel) => `<div class="pp-ph">${icon(k)}<b>${esc(title)}</b><span class="pp-pq${sel && sel.code ? ' mono' : ''}">${sel ? `“${esc(shortText(sel.text, 40))}”` : ''}</span><button type="button" class="pp-x" data-x aria-label="Close">${icon('x', 14)}</button></div>`;
  const request = (sel, action) => ({ action, quote: sel.text, context: sel.context, surface: sel.kind, source: sourceOf(sel) });

  // Explain: a short streamed answer, then "Go deeper in chat".
  function openExplain(sel) {
    const pop = el(`<div class="pp-pop" role="dialog" aria-label="Explain">${head('explain', 'Explain', sel)}<div class="pp-eb" aria-live="polite"></div><div class="pp-pf"></div></div>`);
    const p = openPop(sel, pop);
    const body = pop.querySelector('.pp-eb');
    const foot = pop.querySelector('.pp-pf');
    pop.querySelector('[data-x]').onclick = () => closePop(false);
    const ac = new AbortController();
    let text = '';
    const done = (err) => {
      p.stop = null;
      if (err) body.innerHTML = `<p class="pp-err">${esc(err)}</p>`;
      else if (!text.trim()) body.innerHTML = '<p class="pp-err">No answer.</p>';
      foot.innerHTML = `<button type="button" class="pp-deeper" data-deeper>Go deeper in chat →</button><span class="pp-pf-r"><span class="pp-kbd">Esc</span>close</span>`;
      foot.querySelector('[data-deeper]').onclick = () => {
        closePop(false);
        sendVia(sel, text.trim() ? 'Explain this in more depth — what it means here and what it touches.' : 'What does this mean here?');
      };
      positionPop();
    };
    foot.innerHTML = '<span class="pp-shimmer">Thinking…</span><button type="button" class="pp-stop" data-stop>Stop</button>';
    foot.querySelector('[data-stop]').onclick = () => { ac.abort(); done(null); };
    p.stop = () => ac.abort();
    streamPinpoint(fetchFn, request(sel, 'explain'), {
      signal: ac.signal,
      onDelta: (t) => {
        if (X.pop !== p) return;
        text += t;
        body.innerHTML = paras(text);
        const w = foot.querySelector('.pp-shimmer');
        if (w) w.textContent = 'Writing…';
        positionPop();
      },
    }).then(() => { if (X.pop === p && p.stop) done(null); }, (e) => { if (X.pop === p && p.stop && !ac.signal.aborted) done(e.message || 'The answer failed.'); });
    setTimeout(() => pop.querySelector('[data-x]')?.focus({ preventScroll: true }), 30);
  }

  // Alternatives: 2–3 option cards; 1–3 picks, Enter uses.
  function openAlts(sel) {
    const pending = pendingMode(sel);
    const pop = el(`<div class="pp-pop pp-wide" role="dialog" aria-label="Alternatives">${head('alts', 'Alternatives', sel)}<div class="pp-alts"><p class="pp-loading"><span class="pp-shimmer">Thinking of alternatives…</span></p></div><div class="pp-pf pp-keys"></div></div>`);
    const p = openPop(sel, pop);
    const host = pop.querySelector('.pp-alts');
    const foot = pop.querySelector('.pp-keys');
    pop.querySelector('[data-x]').onclick = () => closePop(false);
    const ac = new AbortController();
    p.stop = () => ac.abort();
    let list = [];
    let on = 0;
    const focus = (i) => {
      on = i;
      $$('.pp-alt', host).forEach((c, k) => { c.classList.toggle('is-on', k === i); c.querySelector('[data-use]').classList.toggle('btn-primary', k === i); });
      host.querySelector(`[data-use="${i}"]`)?.focus({ preventScroll: true });
    };
    const use = async (i) => {
      const a = list[i];
      if (!a) return;
      const text = useAltText(a);
      if (sel.kind === 'diff' && sel.p.comment) {
        const btn = host.querySelector(`[data-use="${i}"]`);
        if (btn) btn.disabled = true;
        const err = await sel.p.comment(sel, text);
        if (err) { if (btn) btn.disabled = false; foot.textContent = err; return; }
        closePop(false);
        return;
      }
      closePop(false);
      if (pending && sel.p.addPending) sel.p.addPending(sel, { kind: 'alt', text });
      else sendVia(sel, text);
    };
    const paint = () => {
      host.innerHTML = list.map((a, i) => `<div class="pp-alt${i === 0 ? ' is-on' : ''}" data-i="${i}">
        <div class="pp-alt-h"><span class="pp-alt-n">${i + 1}</span><span class="pp-alt-t">${esc(a.title)}</span></div>
        ${a.detail ? `<div class="pp-alt-d">${inlineMd(a.detail)}</div>` : ''}
        ${a.tradeoffs.length ? `<div class="pp-tags">${a.tradeoffs.map((t) => `<span class="pp-tag" data-t="${t.tone}">${esc(t.text)}</span>`).join('')}</div>` : ''}
        <div class="pp-alt-a"><button type="button" class="btn btn-sm${i === 0 ? ' btn-primary' : ''}" data-use="${i}">Use this</button><button type="button" class="btn btn-sm btn-quiet" data-disc="${i}">Discuss</button></div>
      </div>`).join('');
      foot.innerHTML = `<span class="pp-kbd">1–${list.length}</span>pick<span class="pp-kbd">↵</span>${pending ? 'add as a change' : sel.kind === 'diff' ? 'comment' : 'use'}`;
      positionPop();
      focus(0);
    };
    host.addEventListener('click', (e) => {
      const u = e.target.closest('[data-use]');
      const d = e.target.closest('[data-disc]');
      const c = e.target.closest('.pp-alt');
      if (u) { use(+u.dataset.use); return; }
      if (d) {
        const a = list[+d.dataset.disc];
        closePop(false);
        sel.p.draft(quoteOf(sel), `Tell me more about this alternative: “${a.title}”${a.detail ? ` — ${a.detail}` : ''}. What would it change?`);
        return;
      }
      if (c) focus(+c.dataset.i);
    });
    p.onKey = (e) => {
      if (!list.length) return;
      if (/^[1-9]$/.test(e.key) && +e.key <= list.length) { e.preventDefault(); focus(+e.key - 1); } else if (e.key === 'Enter' && !realTarget(e)?.closest?.('[data-disc],[data-x]')) { e.preventDefault(); use(on); }
    };
    streamPinpoint(fetchFn, request(sel, 'alternatives'), { signal: ac.signal, onAlternatives: (a) => { list = normalizeAlternatives(a); } })
      .then(() => {
        if (X.pop !== p) return;
        p.stop = null;
        if (!list.length) { host.innerHTML = '<p class="pp-err">No alternatives came back.</p>'; positionPop(); return; }
        paint();
      }, (e) => {
        if (X.pop !== p || ac.signal.aborted) return;
        p.stop = null;
        host.innerHTML = `<p class="pp-err">${esc(e.message || 'The alternatives failed.')}</p>`;
        positionPop();
      });
    setTimeout(() => pop.querySelector('[data-x]')?.focus({ preventScroll: true }), 30);
  }

  // Disagree / Note / Comment: an inline box under the span.
  function openCompose(sel, kind) {
    const pending = kind === 'comment' || (kind !== 'comment' && pendingMode(sel));
    const line = sel.ext && sel.ext.line;
    const title = kind === 'disagree' ? 'What should it be instead?' : kind === 'note' ? 'Add a note' : `Comment on line ${line || '?'}`;
    const ph = kind === 'disagree' ? 'Say what it should be (optional with a reason picked)' : kind === 'note' ? (pending ? 'A note for the run' : 'Your note') : 'Your comment';
    const label = kind === 'comment' ? 'Comment' : !pending ? 'Send' : kind === 'note' ? 'Add note' : 'Add change';
    const mod = /Mac|iPhone|iPad/i.test(win.navigator.platform || win.navigator.userAgent || '') ? '⌘' : 'Ctrl';
    const pop = el(`<div class="pp-pop pp-cmp" role="dialog" aria-label="${esc(title)}">
      ${head(kind, title, kind === 'disagree' ? null : sel)}
      ${kind === 'disagree' ? `<div class="pp-chips" role="group" aria-label="Reason">${DISAGREE_REASONS.map((r) => `<button type="button" class="pp-chip" aria-pressed="false" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''}
      <textarea class="pp-ta" rows="2" placeholder="${esc(ph)}" aria-label="${esc(title)}"></textarea>
      <p class="pp-err" role="alert" hidden></p>
      <div class="pp-cf"><span class="pp-hint">${mod}↵ to ${pending ? 'add' : 'send'} · Esc to cancel</span><button type="button" class="btn btn-sm btn-primary pp-send" data-send disabled>${icon(pending ? 'check' : 'send', 13)}<span>${label}</span></button></div>
    </div>`);
    const p = openPop(sel, pop);
    const ta = pop.querySelector('textarea');
    const send = pop.querySelector('[data-send]');
    const errEl = pop.querySelector('.pp-err');
    let reason = null;
    let busy = false;
    const sync = () => { send.disabled = busy || !(ta.value.trim() || reason); };
    pop.querySelector('[data-x]').onclick = () => closePop(true);
    $$('[data-r]', pop).forEach((b) => {
      b.onclick = () => {
        reason = reason === b.dataset.r ? null : b.dataset.r;
        $$('[data-r]', pop).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.r === reason)));
        sync();
        ta.focus({ preventScroll: true });
      };
    });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(160, ta.scrollHeight + 2)}px`; sync(); positionPop(); });
    const go = async () => {
      if (send.disabled) return;
      const text = ta.value.trim();
      if (kind === 'comment') {
        busy = true; sync();
        const err = await sel.p.comment(sel, text);
        busy = false; sync();
        if (err) { errEl.textContent = err; errEl.hidden = false; positionPop(); return; }
        closePop(false);
        return;
      }
      closePop(false);
      if (pending && sel.p.addPending) {
        sel.p.addPending(sel, { kind, text: kind === 'disagree' ? [reason, text].filter(Boolean).join(' — ') : text });
        return;
      }
      sendVia(sel, kind === 'disagree' ? disagreeText(reason, text) : `Note: ${text}`);
    };
    send.onclick = go;
    p.onKey = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } };
    setTimeout(() => ta.focus({ preventScroll: true }), 30);
  }

  // ---------------------------------------------------------------- wiring
  function evaluate() {
    if (X.pop) return;
    const sel = readSelection();
    if (!sel) { closeBar(); return; }
    if (X.bar && X.sel && X.sel.text === sel.text && X.sel.at === sel.at && X.sel.unit === sel.unit) { X.sel = sel; positionBar(); return; }
    showBar(sel);
  }

  const onPointerUp = (e) => {
    if (within(X.bar, e) || within(X.pop?.el, e)) return;
    if (!autoOpen) return;
    clearTimeout(X.t);
    X.t = setTimeout(evaluate, 120);
  };
  const onKeyUp = (e) => {
    if (!autoOpen || X.pop || typing(realTarget(e))) return;
    if (e.shiftKey || /^(Arrow|Home|End|Shift|PageUp|PageDown)/.test(e.key)) { clearTimeout(X.kt); X.kt = setTimeout(evaluate, 400); }
  };
  const onSelChange = () => {
    if (X.pop || !X.bar || !X.sel) return;
    const s = win.getSelection();
    if (!s || !s.rangeCount || s.isCollapsed || normText(s.toString()).length < 2) closeBar();
  };
  const onPointerDown = (e) => {
    if (X.pop && !within(X.pop.el, e)) closePop(false);
    if (X.bar && !within(X.bar, e)) closeBar();
  };
  const onKeyDown = (e) => {
    if (X.pop) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closePop(true); return; }
      const t = realTarget(e);
      if (!(t && t.nodeType) || !X.pop.el.contains(t)) return;
      if (e.key === 'Tab') {
        const f = $$('button:not(:disabled),textarea', X.pop.el);
        const i = f.indexOf(activeEl());
        e.stopImmediatePropagation();
        if (i === -1 || (e.shiftKey ? i === 0 : i === f.length - 1)) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0]?.focus(); }
        return;
      }
      if (honoured(e) && (!typing(t) || (e.key === 'Enter' && (e.metaKey || e.ctrlKey)))) X.pop.onKey?.(e);
      e.stopPropagation();
      return;
    }
    if (!X.bar) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); win.getSelection()?.removeAllRanges(); closeBar(); return; }
    if (typing(realTarget(e)) || e.metaKey || e.ctrlKey || e.altKey) return;
    const btns = $$('.pp-b, .pp-mi', X.bar);
    const i = btns.indexOf(activeEl());
    if (e.key === 'Tab' && i < 0 && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); btns[0]?.focus(); return; }
    if (i > -1 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      btns[(i + step + btns.length) % btns.length].focus();
      return;
    }
    if (i > -1 && (e.key === 'Enter' || e.key === ' ')) return;   // the focused button's own click
    if (!honoured(e)) return;
    if (e.key.length !== 1) return;
    const hit = [...X.items, ...X.over].find((s) => s[2] === e.key.toUpperCase());
    if (hit) { e.preventDefault(); e.stopImmediatePropagation(); act(hit[0], null); }
  };
  const onScroll = () => { if (X.pop) positionPop(); else if (X.bar) positionBar(); };

  doc.addEventListener('pointerup', onPointerUp);
  doc.addEventListener('keyup', onKeyUp);
  doc.addEventListener('selectionchange', onSelChange);
  doc.addEventListener('pointerdown', onPointerDown, true);
  // On the window, capturing: ahead of the artifact viewer's own Escape / Tab handling (registered later, on open).
  win.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
  win.addEventListener('resize', onScroll);

  return {
    /** Register a surface; returns its removal. */
    addSurface(root, provider) {
      surfaces.set(root, provider);
      return () => {
        if (surfaces.get(root) === provider) surfaces.delete(root);
        if (X.sel && X.sel.root === root) closeAll();
      };
    },
    close: closeAll,
    holding: () => !!(X.bar || X.pop),
    reduced,
    /** The extension's option "Show Pinpoint when I select text". */
    setAuto(on) { autoOpen = !!on; if (!autoOpen) { clearTimeout(X.t); clearTimeout(X.kt); } },
    /** Open the bar on the current selection now (the extension's keyboard command). → false when nothing usable is selected. */
    openAtSelection() {
      if (X.pop) return true;
      const sel = readSelection();
      if (!sel) return false;
      showBar(sel);
      return true;
    },
    destroy() {
      closeAll();
      surfaces.clear();
      doc.removeEventListener('pointerup', onPointerUp);
      doc.removeEventListener('keyup', onKeyUp);
      doc.removeEventListener('selectionchange', onSelChange);
      doc.removeEventListener('pointerdown', onPointerDown, true);
      win.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('scroll', onScroll, { capture: true });
      win.removeEventListener('resize', onScroll);
    },
  };
}

/**
 * Paint persistent highlights (the tray's pending changes, the diff's quoted comments) under one CSS highlight name.
 * `ranges` may be empty; a browser without the API paints nothing.
 */
export function paintHighlight(win, name, ranges) {
  const hl = win.CSS && win.CSS.highlights;
  if (!hl || typeof win.Highlight !== 'function') return;
  if (!ranges || !ranges.length) { hl.delete(name); return; }
  hl.set(name, new win.Highlight(...ranges));
}
