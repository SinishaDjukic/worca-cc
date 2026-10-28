// ui/public/artifacts/viewer.mjs — the artifact popup (Chat P5): a modal over the page with the file's preview
// (preview.mjs), its name and `<Step> · cycle N · size`, ←/→ through a list, Download, Full screen and Close. A file
// with no preview — or one too large to preview — opens the full-window info view with its facts and Download. One
// viewer per document: opening another replaces it. Esc, the backdrop and Close dismiss it and focus goes back to
// what opened it. While it is open, Esc and ←/→ are its own: a WINDOW capture listener runs before the run pages'
// document capture handlers (which send a detail screen back to its list on Escape) and stops the event there.
import {
  relOf, baseName, displayPath, formatBytes, previewKindFor, RAW_PREVIEW_KINDS, TEXT_PREVIEW_MAX_BYTES,
} from './common.mjs';
import { renderPreview, PINNABLE_PREVIEW_KINDS } from './preview.mjs';

const GLYPH = {
  prev: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 19h14"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  exit: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  file: '<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4"/>',
};
const FOCUSABLE = 'button, a[href], select, input, textarea, iframe, embed, audio[controls], video[controls], [tabindex]:not([tabindex="-1"])';
/** What close() may hand the focus to when the opener is gone. */
const PAGE_STOPS = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
/** Text that holds a NUL in its first 8 KB is bytes, not text (git's own test): it gets the info view, not a page of junk. */
const NUL = String.fromCharCode(0);
/** Dialogs that can stack over the popup (the confirm, the Stop warning, a native <dialog>): they own the keys and the focus. */
const STACKED = '#confirm-modal:not(.hidden), #stop-modal:not(.hidden), dialog[open]';
const OPEN = new WeakMap();                     // document -> the viewer open in it

/** Close the popup open in `doc`, if any: an entry point that opens the chat beside the page (app.js openChat), where
 *  the route to Chat used to close it. */
export function closeOpenViewer(doc, opts) {
  const open = OPEN.get(doc);
  if (open) open.close(opts);
}

/** Where a popup is: the view (the first hash segment) and the run it belongs to — a run page's run (`#running/<id>…`,
 *  `#history/<key>/<id>…`, its Details suffix dropped), the run the Chat panel shows (`#chat/<thread>/run/<id>…`). */
export function routeKeyOf(win) {
  const parts = String((win && win.location && win.location.hash) || '').replace(/^#/, '').split('/');
  const view = parts[0] || '';
  if (view === 'running') return `running|${parts[1] || ''}`;
  if (view === 'history') return `history|${parts.slice(1).join('/').replace(/\/details(?:\/[a-z]+)?$/, '')}`;
  if (view !== 'chat') return view;
  const at = parts.indexOf('run', 2);          // after the thread id: a thread is never mistaken for the segment
  return `chat|${at > 0 ? (parts[at + 1] || '') : ''}`;
}
let seq = 0;

async function safeJson(res) {
  try { return await res.json(); } catch { return {}; }
}

/** The words a failed load shows — worca's (the Strings table), never the server's or the runtime's own message:
 *  a 500 body carries `err.message`, which can hold an absolute path. */
export function errorText(err) {
  if (!err) return '';
  if (err.status === 404) return 'File not found';
  if (err.status === 413) return 'Too large to preview';
  if (err.status === 415) return 'No preview for this file type';
  return err.status ? `Could not load (HTTP ${err.status})` : 'Could not load';
}

/** HEAD a URL → {ok, status, size}: `size` is its Content-Length when the answer is a success that carries one, else
 *  null; status 0 = the request itself failed. */
async function headOf(fetchFn, url) {
  try {
    const r = await fetchFn(url, { method: 'HEAD' });
    const v = r && r.ok && r.headers && typeof r.headers.get === 'function' ? r.headers.get('content-length') : null;
    const n = v == null || v === '' ? NaN : Number(v);
    return { ok: Boolean(r && r.ok), status: (r && r.status) || 0, size: Number.isFinite(n) && n >= 0 ? n : null };
  } catch {
    return { ok: false, status: 0, size: null };
  }
}

/** HEAD a URL before framing or saving it (no body on the happy path: a 25 MB pdf is not pulled twice).
 *  → null when the bytes are servable, else {status} (0 = the request itself failed). */
export async function probeUrl(fetchFn, url) {
  const r = await headOf(fetchFn, url);
  return r.ok ? null : { status: r.status };
}

/** UTF-16 text with a byte-order mark, read as bytes from the download form → its text; null when the bytes carry no
 *  UTF-16 mark (they are not text) or cannot be read. */
async function utf16Text(fetchFn, url) {
  try {
    const r = await fetchFn(url);
    if (!r || !r.ok || typeof r.arrayBuffer !== 'function') return null;
    const b = new Uint8Array(await r.arrayBuffer());
    const enc = b[0] === 0xff && b[1] === 0xfe ? 'utf-16le' : b[0] === 0xfe && b[1] === 0xff ? 'utf-16be' : '';
    return enc ? new TextDecoder(enc).decode(b.subarray(2)) : null;
  } catch {
    return null;
  }
}

/** Save one file: probe the download URL (a 404 must never be saved AS the file), then click a detached same-origin
 *  <a download>; the server's Content-Disposition names it. → {ok:true} | {ok:false, error}. */
export async function downloadArtifact({ doc, fetch: fetchFn, url, name = '' }) {
  const err = await probeUrl(fetchFn, url);
  if (err) return { ok: false, error: errorText(err) };
  const a = doc.createElement('a');
  a.href = url;
  a.setAttribute('download', name);
  a.rel = 'noopener';
  a.hidden = true;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  return { ok: true };
}

/**
 * Open the popup for one artifact.
 * @param {object} o
 * @param {Document} o.doc
 * @param {Window} [o.win]
 * @param {(url:string, opts?:object) => Promise<Response>} o.fetch
 * @param {{kind?:string, relPath?:string, path?:string, bytes?:number, nodeId?:string|null, cycle?:number|null, previewKind?:string}} o.artifact
 * @param {{text(rel:string):string, raw(rel:string):string, download(rel:string):string}} o.urls
 * @param {Array<object>} [o.list]   the files ←/→ step through (o.artifact among them)
 * @param {{step?:string, cycle?:number}} [o.meta]   the first file's step and cycle (CONTRACT §7)
 * @param {(a:object) => {step?:string|null, cycle?:number|null}} [o.metaFor]   per file; wins over `meta`
 * @param {{loadMarkdown?:Function, hljsLoader?:object}} [o.deps]
 * @param {(o:{artifact:object, stage:HTMLElement, body:HTMLElement, root:HTMLElement}) => (() => void)|void} [o.decorate]
 *   after a text preview renders (Pinpoint #669 adds its selection actions and tray); the returned function undoes it
 *   when the file changes or the popup closes
 * @returns {{close(opts?:{restore?:boolean}):void, ready:Promise<void>, el:HTMLElement}}
 */
export function openArtifactViewer({ doc, win = doc.defaultView, fetch: fetchFn, artifact, urls, list = null, meta = null, metaFor = null, deps = {}, decorate = null }) {
  const prior = OPEN.get(doc);
  const active = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
  // A viewer opened over another inherits ITS opener: focus must go back to the page, not into a removed dialog.
  const opener = prior ? prior.opener : active;
  const openerKey = prior ? prior.openerKey : ((active && active.dataset && active.dataset.focusKey) || '');
  // A live list repaints its rows without focus keys (a log pane, a run card): close() looks for the opener's twin in
  // the nearest ancestor still on the page, by tag, class and text.
  const ancestors = prior ? prior.ancestors : [];
  if (!prior) for (let n = active && active.parentElement; n && n !== doc.body; n = n.parentElement) ancestors.push(n);
  const twinOf = (n) => `${n.tagName}|${n.className}|${(n.textContent || '').trim()}`;
  const openerTwin = prior ? prior.openerTwin : (active ? twinOf(active) : '');
  const stopsIn = (home) => [...home.querySelectorAll(PAGE_STOPS)].filter((n) => !n.disabled && !n.closest('[hidden]'));
  // A log names one file once per cycle: which of the identical lines it was, counted in the few panes around it (the
  // page-level ancestors are skipped: walking every stop of the page on each open costs more than it can find).
  const twinRank = prior ? prior.twinRank : new Map();
  if (!prior && active) for (const n of ancestors.slice(0, 4)) twinRank.set(n, stopsIn(n).filter((x) => twinOf(x) === openerTwin).indexOf(active));
  if (prior) prior.close({ restore: false });

  const h = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const svg = (body) => {
    const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = body;                                     // repo-shipped glyphs only
    return s;
  };
  const iconBtn = (cls, label, glyph) => {
    const b = h('button', `btn btn-quiet btn-icon apv-ib ${cls}`);
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.appendChild(svg(glyph));
    return b;
  };

  const titleId = `apv-title-${++seq}`;
  // `viewer-modal` (never `.hidden` while open): every "a dialog is up, it owns Escape" check in the app — the mobile
  // nav, the top-bar search, the Chat run panel — yields to the popup. Body-level, so it sits above the Chat panel.
  const root = h('div', 'viewer-modal apv');
  root.dataset.artifactViewer = '';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', titleId);
  const card = h('div', 'apv-card');
  card.tabIndex = -1;
  const head = h('header', 'apv-head');
  const titles = h('div', 'apv-titles');
  const title = h('h2', 'apv-title');
  title.id = titleId;
  const sub = h('p', 'apv-meta');
  titles.append(title, sub);
  const actions = h('div', 'apv-actions');
  const prevBtn = iconBtn('apv-prev', 'Previous file', GLYPH.prev);
  const pos = h('span', 'apv-pos mono');
  const nextBtn = iconBtn('apv-next', 'Next file', GLYPH.next);
  const dlBtn = h('button', 'btn apv-dl');
  dlBtn.type = 'button';
  dlBtn.setAttribute('aria-label', 'Download');
  dlBtn.append(svg(GLYPH.download), h('span', null, 'Download'));
  const fullBtn = iconBtn('apv-full', 'Full screen', GLYPH.full);
  fullBtn.setAttribute('aria-pressed', 'false');
  const closeBtn = iconBtn('apv-close', 'Close', GLYPH.close);
  actions.append(prevBtn, pos, nextBtn, dlBtn, fullBtn, closeBtn);
  head.append(titles, actions);
  const note = h('p', 'apv-note');
  note.setAttribute('role', 'alert');
  note.hidden = true;
  const body = h('div', 'apv-body');
  body.tabIndex = 0;                      // a Tab stop: ↑/↓, PgUp/PgDn and Space scroll a long preview
  body.setAttribute('role', 'region');
  body.setAttribute('aria-labelledby', titleId);
  // Keys pressed inside a framed preview (a sandboxed deck, a pdf) never reach this document, so the Tab trap cannot see
  // them: Tab past the frame's last stop lands here and goes round to the first control instead of leaving the page.
  const wrap = h('span', 'apv-wrap');
  wrap.tabIndex = 0;
  card.append(head, note, body, wrap);
  root.appendChild(card);
  doc.body.appendChild(root);

  let items = Array.isArray(list) && list.length ? list : [artifact];
  let index = items.indexOf(artifact);
  if (index < 0) index = items.findIndex((x) => relOf(x) === relOf(artifact));
  if (index < 0) { items = [artifact]; index = 0; }
  const opened = items[index];                // the list's own entry for `artifact` (an equal copy is found by path)
  let token = 0;
  let closed = false;
  let undecorate = null;
  const undo = () => { const u = undecorate; undecorate = null; if (typeof u === 'function') { try { u(); } catch { /* a decoration never blocks the viewer */ } } };
  const sizes = new Map();                    // rel -> bytes a HEAD found for a row that did not carry them
  const sizeOf = (a) => (a.bytes != null ? a.bytes : sizes.get(relOf(a)));
  const route = routeKeyOf(win);              // where it was opened (onHash)

  const metaOf = (a) => {
    const m = typeof metaFor === 'function' ? metaFor(a) : (a === opened ? meta : null);
    return m && typeof m === 'object' ? m : {};
  };
  const cycleOf = (a, m) => {
    const c = m.cycle != null ? m.cycle : a.cycle;
    return Number.isInteger(c) && c > 0 ? c : null;
  };

  /** The `<Step> · cycle N · size` line. */
  function metaLine(a) {
    const m = metaOf(a);
    const cycle = cycleOf(a, m);
    const size = sizeOf(a);
    sub.textContent = [m.step || '', cycle ? `cycle ${cycle}` : '', size != null ? formatBytes(size) : ''].filter(Boolean).join(' · ');
    sub.hidden = !sub.textContent;
  }

  function header(a) {
    const rel = relOf(a);
    title.textContent = baseName(rel) || a.kind || 'artifact';
    title.title = displayPath(rel);
    metaLine(a);
    const many = items.length > 1;
    prevBtn.hidden = !many;
    nextBtn.hidden = !many;
    pos.hidden = !many;
    const arrow = doc.activeElement === prevBtn || doc.activeElement === nextBtn ? doc.activeElement : null;
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= items.length - 1;
    // A browser drops a control's focus to <body> the moment it is disabled (an end of the list): the other arrow keeps it.
    if (arrow && arrow.disabled) (arrow === nextBtn ? prevBtn : nextBtn).focus();
    pos.textContent = many ? `${index + 1} / ${items.length}` : '';
    note.hidden = true;
    note.textContent = '';
  }

  function fail(stage, message) {
    const p = h('p', 'apv-error', message);
    p.setAttribute('role', 'alert');
    stage.replaceChildren(p);
  }

  function info(stage, a, reason) {
    root.classList.add('is-info');
    stage.classList.add('kind-info');
    const rel = relOf(a);
    const m = metaOf(a);
    const box = h('div', 'apv-info');
    const ic = h('span', 'apv-info-ic');
    ic.appendChild(svg(GLYPH.file));
    const facts = h('dl', 'apv-facts');
    const fact = (k, v) => { if (v == null || v === '') return; facts.append(h('dt', null, k), h('dd', 'mono', String(v))); };
    fact('Kind', a.kind || '');
    fact('Size', sizeOf(a) != null ? formatBytes(sizeOf(a)) : '');
    fact('Step', m.step || '');
    fact('Cycle', cycleOf(a, m) || '');
    fact('Path', displayPath(rel));
    const dl = h('button', 'btn btn-primary apv-info-dl');
    dl.type = 'button';
    dl.setAttribute('aria-label', 'Download');      // ≤760 px hides its text (.apv-info-dl span): the name must stay
    dl.append(svg(GLYPH.download), h('span', null, 'Download'));
    dl.addEventListener('click', (e) => { if (!(e.detail > 1)) download(); });
    box.append(ic, h('p', 'apv-info-name', baseName(rel)), h('p', 'apv-info-note', reason), facts, dl);
    stage.replaceChildren(box);
  }

  /** Show items[i]. A fresh stage per call: a load still in flight for the previous file writes into a detached
   *  element, and `token` drops its result. */
  async function show(i) {
    index = i;
    const a = items[index];
    const my = ++token;
    undo();
    header(a);
    root.classList.remove('is-info');
    const stage = h('div', 'apv-stage artifact-view');
    stage.appendChild(h('p', 'apv-loading', 'Loading…'));
    body.replaceChildren(stage);
    const live = () => my === token && !closed;
    const rel = relOf(a);
    const shown = displayPath(rel);             // what an alt text, a frame title or a player's label may say
    const kind = a.previewKind
      ? (a.previewKind === 'none' || PINNABLE_PREVIEW_KINDS.has(a.previewKind) ? a.previewKind : 'none')
      : previewKindFor(a.kind, rel);
    try {
      if (kind === 'none') { info(stage, a, 'No preview for this file type'); return; }
      if (RAW_PREVIEW_KINDS.has(kind)) {
        const url = urls.raw(rel);
        const probe = await headOf(fetchFn, url);
        if (!live()) return;
        // The HEAD that clears the bytes also sizes a live row (an image, a deck, a clip) for the header.
        if (probe.size != null && sizeOf(a) == null) { sizes.set(rel, probe.size); metaLine(a); }
        const err = probe.ok ? null : { status: probe.status };
        if (err && (err.status === 413 || err.status === 415)) { info(stage, a, errorText(err)); return; }
        if (err) { fail(stage, errorText(err)); return; }
        await renderPreview({ kind: a.kind || null, relPath: shown, url, previewKind: a.previewKind || null }, stage, deps);
        // A player the browser cannot feed (an HEVC .mp4, a damaged file) says so instead of sitting there dead.
        const media = stage.querySelector('audio, video');
        if (media) {
          const dead = () => { if (live()) info(stage, a, 'No preview for this file type'); };
          media.addEventListener('error', dead, { once: true });
          if (media.error) dead();
        }
        return;
      }
      // A live row carries no size: the download form (any type, no ceiling) answers a HEAD with it, before the text
      // route pulls the whole file.
      if (sizeOf(a) == null) {
        const n = (await headOf(fetchFn, urls.download(rel))).size;
        if (!live()) return;
        if (n != null) { sizes.set(rel, n); metaLine(a); }
      }
      if (Number(sizeOf(a)) > TEXT_PREVIEW_MAX_BYTES) { info(stage, a, 'Too large to preview'); return; }
      const res = await fetchFn(urls.text(rel));
      const data = await safeJson(res);
      if (!live()) return;
      if (res.status === 413 || res.status === 415) { info(stage, a, errorText({ status: res.status })); return; }
      if (!res.ok) { fail(stage, errorText({ status: res.status })); return; }
      const text = typeof data.text === 'string' ? data.text : '';
      // No kind table names every byte format (.bmp, .xls, .pkl, a bare `core`): decoded bytes are not a preview —
      // unless they are UTF-16 text (Windows PowerShell's `>` writes it), which the text route can only read as UTF-8:
      // its byte-order mark decodes to two U+FFFD there, and the bytes themselves say which UTF-16 it is.
      if (text.slice(0, 8192).includes(NUL)) {
        const wide = text.charCodeAt(0) === 0xfffd && text.charCodeAt(1) === 0xfffd ? await utf16Text(fetchFn, urls.download(rel)) : null;
        if (!live()) return;
        if (wide == null) { info(stage, a, 'No preview for this file type'); return; }
        await renderPreview({ kind: a.kind || null, relPath: shown, text: wide, previewKind: a.previewKind || null }, stage, deps);
        return;
      }
      await renderPreview({ kind: a.kind || null, relPath: shown, text, previewKind: a.previewKind || null }, stage, deps);
      if (live() && typeof decorate === 'function') {
        try { undecorate = decorate({ artifact: a, stage, body, root }) || null; } catch { undecorate = null; }
      }
    } catch {
      if (live()) fail(stage, 'Could not load');
    }
  }

  async function download() {
    const a = items[index];
    const rel = relOf(a);
    const my = token;                       // ←/→ while the probe runs: a failure must not land under the next file
    const r = await downloadArtifact({ doc, fetch: fetchFn, url: urls.download(rel), name: baseName(rel) });
    if (closed || r.ok || my !== token) return;
    note.textContent = `Download failed: ${r.error}`;
    note.hidden = false;
  }

  function setFull(on) {
    const fsEl = doc.fullscreenElement;
    root.classList.toggle('is-full', on);
    try {
      if (on && typeof card.requestFullscreen === 'function' && !fsEl) {
        const p = card.requestFullscreen();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } else if (!on && fsEl === card && typeof doc.exitFullscreen === 'function') {
        const p = doc.exitFullscreen();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch { /* the CSS fill stands either way */ }
    const label = on ? 'Exit full screen' : 'Full screen';
    fullBtn.title = label;
    fullBtn.setAttribute('aria-label', label);
    fullBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    fullBtn.replaceChildren(svg(on ? GLYPH.exit : GLYPH.full));
  }

  /** The Tab stops inside the card, in order (the wrap-around stop is not one of them) — into open shadow roots too: the
   *  c4 viewer keeps its stage, View select, Zoom and Download JPEG in one. */
  const tabStopsIn = (r) => [...r.querySelectorAll('*')].flatMap((n) => [...(n.matches(FOCUSABLE) ? [n] : []), ...(n.shadowRoot ? tabStopsIn(n.shadowRoot) : [])]);
  const stops = () => tabStopsIn(card).filter((n) => n !== wrap && !n.disabled && !n.closest('[hidden]'));
  /** The focused element itself, inside any shadow root, and whether it sits in the card. */
  const deepActive = () => { let a = doc.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };
  const inCard = (n) => { for (let x = n; x; x = x.getRootNode().host) if (card.contains(x)) return true; return false; };

  function trap(e) {
    const f = stops();
    if (!f.length) { e.preventDefault(); card.focus(); return; }
    const first = f[0];
    const last = f[f.length - 1];
    const at = deepActive();
    if (!inCard(at) || at === card) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
    if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  }

  const onKey = (e) => {
    if (closed) return;
    // A dialog stacked over the popup (the confirm, the Stop warning, a native <dialog>) owns every key.
    if (doc.querySelector(STACKED)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && items.length > 1 && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      // Only from the dialog itself or its header: inside the preview the arrows belong to it (a wide code line
      // scrolls, a player seeks, a field moves its caret).
      const t = e.target;
      if (!(t === card || t === root || (t && head.contains(t)))) return;
      e.preventDefault();
      e.stopPropagation();
      const to = index + (e.key === 'ArrowRight' ? 1 : -1);
      if (to >= 0 && to < items.length) show(to);
      return;
    }
    if (e.key === 'Tab') trap(e);
  };
  // A rewrite of the address inside the place the popup was opened from (a chat getting its id on first send, a tab
  // hop, a Back to the run's glance, the panel's live → saved hand-off under the same run segment) keeps the file open;
  // leaving that view or its run (a Back to another run's page, the Chat panel switching runs) closes it.
  const onHash = () => { if (routeKeyOf(win) !== route) close({ restore: false }); };
  const onFs = () => {
    // Esc in browser full screen leaves it without a keydown reaching the page: follow the browser.
    if (!doc.fullscreenElement && root.classList.contains('is-full') && typeof card.requestFullscreen === 'function') setFull(false);
  };
  // Focus that wanders out of the popup comes back — unless a dialog stacked over it took it. Where the page put it (a
  // route change focuses its new screen's title) is kept for close().
  let pageWanted = null;
  const onFocusIn = (e) => {
    if (closed || !e.target || root.contains(e.target) || doc.querySelector(STACKED)) return;
    pageWanted = e.target;
    card.focus({ preventScroll: true });
  };

  function close({ restore = true } = {}) {
    if (closed) return;
    closed = true;
    token += 1;
    undo();
    win.removeEventListener('keydown', onKey, true);
    win.removeEventListener('hashchange', onHash);
    doc.removeEventListener('fullscreenchange', onFs);
    doc.removeEventListener('focusin', onFocusIn);
    if (doc.fullscreenElement === card && typeof doc.exitFullscreen === 'function') {
      try { const p = doc.exitFullscreen(); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch { /* already out */ }
    }
    body.replaceChildren();               // an <iframe>/<embed>/<audio>/<video> unloads with its node, not with display:none
    root.remove();
    if (OPEN.get(doc) === handle) OPEN.delete(doc);
    if (!restore) return;
    // A focus that does not take is no focus: an element in a screen a Back hid (the Details tab under `[hidden]`, a
    // back link the layout hides) leaves the browser's focus on <body>. Each candidate below is tried until one takes.
    const took = (n, o) => {
      if (!n || !n.isConnected || typeof n.focus !== 'function') return false;
      n.focus(o);
      return doc.activeElement === n;
    };
    if (took(opener)) return;
    // The opener was repainted away (a live list): the element now holding its focus key.
    const keyedIn = (r) => [...r.querySelectorAll('[data-focus-key]')].find((n) => n.dataset.focusKey === openerKey && !n.closest('[hidden]')) || null;
    const near = ancestors.find((n) => n.isConnected);
    if (openerKey && (took(near && keyedIn(near)) || took(keyedIn(doc)))) return;
    // Where the page put the focus while the popup held it (a Back to the run's glance focuses its title).
    if (took(pageWanted, { preventScroll: true })) return;
    // Repainted away with no focus key (a log line, a run card's chip): its twin in the nearest ancestor still on the
    // page, else that ancestor's first stop; an ancestor left with no stop at all (a log pane its filter emptied) hands
    // on to the next one up. Never <body>: Tab would start over at the top of the page.
    for (const home of ancestors) {
      if (!home.isConnected) continue;
      const found = stopsIn(home);
      const twins = openerTwin ? found.filter((n) => twinOf(n) === openerTwin) : [];
      if (twins.length && took(twins[Math.min(Math.max(twinRank.get(home) ?? 0, 0), twins.length - 1)])) return;
      for (const n of found) if (took(n, { preventScroll: true })) return;
    }
  }

  prevBtn.addEventListener('click', () => { if (index > 0) show(index - 1); });
  nextBtn.addEventListener('click', () => { if (index < items.length - 1) show(index + 1); });
  dlBtn.addEventListener('click', (e) => { if (!(e.detail > 1)) download(); });
  fullBtn.addEventListener('click', () => setFull(!root.classList.contains('is-full')));
  closeBtn.addEventListener('click', () => close());
  wrap.addEventListener('focus', () => { (stops()[0] || card).focus(); });
  // The backdrop: the overlay itself, never the card; the second press of a double click (the first opened us) is not a dismissal.
  // The press must land on the overlay too (modal-guard.mjs's rule): a text selection dragged out of the preview ends
  // with a click on the overlay, and that is not one.
  let pressedRoot = false;
  root.addEventListener('mousedown', (e) => { pressedRoot = e.target === root; });
  root.addEventListener('click', (e) => {
    const pressed = pressedRoot;
    pressedRoot = false;
    if (e.target === root && pressed && !(e.detail > 1)) close();
  });
  win.addEventListener('keydown', onKey, true);
  win.addEventListener('hashchange', onHash);
  doc.addEventListener('fullscreenchange', onFs);
  doc.addEventListener('focusin', onFocusIn);

  const handle = { close: (o) => close(o), ready: null, el: root, opener, openerKey, ancestors, openerTwin, twinRank };
  OPEN.set(doc, handle);
  card.focus({ preventScroll: true });
  handle.ready = show(index);
  return handle;
}
