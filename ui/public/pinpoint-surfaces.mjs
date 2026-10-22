// pinpoint-surfaces.mjs — Pinpoint (#669) on the run artifact viewer and the Diff tab: the providers pinpoint.mjs calls,
// the artifact's pending-changes tray (Disagree / Note / Use this, numbered, highlighted, with margin markers) and the
// diff's quoted-comment highlights and fix-run tray. app.js hands in what only it knows (the run, the routes, the chat).
import { iconSvg } from './icons.mjs';
import { paintHighlight } from './pinpoint.mjs';
import {
  PENDING_KINDS, readTray, addTrayItem, removeTrayItem, trayDirection, findQuote, shortText, normText,
  diffCommentBody, quoteOfCommentBody, openFixComments, fixRunRequest,
} from './pinpoint-model.mjs';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The text nodes under `root`, in order. */
function textNodes(doc, root) {
  const out = [];
  const w = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  while (w.nextNode()) out.push(w.currentNode);
  return out;
}

/** A Range over characters [start, end) of `root`'s text, or null. */
export function rangeAt(doc, root, start, end) {
  let pos = 0;
  let started = false;
  const r = doc.createRange();
  for (const n of textNodes(doc, root)) {
    const len = n.data.length;
    if (!started && start <= pos + len) { r.setStart(n, start - pos); started = true; }
    if (started && end <= pos + len) { r.setEnd(n, end - pos); return r; }
    pos += len;
  }
  return null;
}

/** A Range over `quote` in `root` (nearest character offset `at`), or null when the text no longer has it. */
export function quoteRange(doc, root, quote, at = 0) {
  const { index, length } = findQuote(root.textContent || '', quote, at);
  return index < 0 ? null : rangeAt(doc, root, index, index + length);
}

// =================================================================== the artifact viewer

/**
 * Pinpoint on one markdown artifact in the viewer. Returns the undo the viewer calls when the file changes or closes.
 * @param {object} o
 * @param {ReturnType<import('./pinpoint.mjs').createPinpoint>} o.pinpoint
 * @param {Document} o.doc
 * @param {Window} o.win
 * @param {HTMLElement} o.stage   the viewer's stage (holds .artifact-markdown)
 * @param {HTMLElement} o.body    the viewer's scroller
 * @param {HTMLElement} o.root    the viewer's overlay (popovers mount here, inside its focus trap)
 * @param {string} o.file         the artifact's file name
 * @param {string} o.key          the tray's storage key (trayKey)
 * @param {Storage|null} o.storage
 * @param {() => boolean} o.live  the run still takes directions (else the tray only goes to chat)
 * @param {boolean} o.plan        a plan: "Send back to planner"
 * @param {(text:string) => Promise<string|null>} o.sendBack   post a direction; an error to show, or null
 * @param {(q:object|null, text:string) => void} o.draft       the chat composer, not sent
 */
export function decorateArtifact({ pinpoint, doc, win, stage, body, root, file, key, storage, live, plan, sendBack, draft }) {
  const md = stage.querySelector('.artifact-markdown');
  if (!md) return null;
  stage.classList.add('pp-doc');
  const marks = doc.createElement('div');
  marks.className = 'pp-marks';
  stage.appendChild(marks);
  const trayEl = doc.createElement('div');
  trayEl.className = 'pp-tray';
  body.appendChild(trayEl);

  const load = () => { try { return readTray(storage ? storage.getItem(key) : null); } catch { return readTray(null); } };
  const save = (t) => {
    try { if (storage) { if (t.items.length) storage.setItem(key, JSON.stringify(t)); else storage.removeItem(key); } } catch { /* private mode */ }
  };
  let tray = load();
  let folded = false;
  let note = '';
  let sending = false;
  let ranges = new Map();   // n → Range

  function paintMarks() {
    ranges = new Map();
    for (const p of tray.items) {
      const r = quoteRange(doc, md, p.quote, p.at ?? 0);
      if (r) ranges.set(p.n, r);
    }
    paintHighlight(win, 'pinpoint-pending', [...ranges.values()]);
    layoutMarkers();
  }

  function layoutMarkers() {
    const base = stage.getBoundingClientRect().top;
    let last = -99;
    const rows = [...ranges.entries()].map(([n, r]) => [n, r.getClientRects()[0]]).filter(([, rc]) => rc).sort((a, b) => a[1].top - b[1].top);
    marks.innerHTML = rows.map(([n, rc]) => {
      let top = rc.top - base + (rc.height - 20) / 2;
      if (top < last + 23) top = last + 23;   // markers stack in the margin
      last = top;
      return `<button type="button" class="pp-mk" data-n="${n}" style="top:${Math.round(top)}px" aria-label="Pending change ${n}">${n}</button>`;
    }).join('');
  }

  function hot(n) {
    for (const x of trayEl.querySelectorAll('.pp-row')) x.classList.toggle('is-hot', +x.dataset.n === n);
    for (const x of marks.querySelectorAll('.pp-mk')) x.classList.toggle('is-hot', +x.dataset.n === n);
    const r = n != null ? ranges.get(n) : null;
    paintHighlight(win, 'pinpoint-hot', r ? [r] : []);
  }

  function flashRow(n) {
    if (folded) { folded = false; paintTray(); }
    const row = trayEl.querySelector(`.pp-row[data-n="${n}"]`);
    if (!row) return;
    row.classList.remove('pp-flash');
    void row.offsetWidth;
    row.classList.add('pp-flash');
    row.scrollIntoView?.({ block: 'nearest' });
  }

  function paintTray() {
    const items = tray.items;
    const canSend = live();
    const where = `on ${file}`;
    if (!items.length && !canSend) { trayEl.hidden = true; trayEl.innerHTML = ''; return; }
    trayEl.hidden = false;
    const rows = items.map((p) => {
      const gone = !ranges.has(p.n);
      return `<div class="pp-row" data-n="${p.n}"><span class="pp-n">${p.n}</span><span class="pp-kind" data-k="${p.kind}">${esc(PENDING_KINDS[p.kind])}</span>
        <span class="pp-rq${gone ? ' pp-gone' : ''}" title="${esc(normText(p.quote))}">${gone ? 'no longer in the file' : `“${esc(shortText(p.quote, 60))}”`}</span>
        <span class="pp-rt" title="${esc(p.text)}">${esc(p.text)}</span>
        <button type="button" class="btn btn-sm btn-quiet btn-icon pp-x" data-rm="${p.n}" aria-label="Remove change ${p.n}">${iconSvg('x', 14)}</button></div>`;
    }).join('');
    const sendLabel = plan ? 'Send back to planner' : 'Send to run';
    const foot = items.length
      ? `<button type="button" class="btn btn-sm btn-quiet" data-a="clear">Clear</button><span class="pp-sp"></span>${canSend
        ? `<button type="button" class="btn btn-sm" data-a="chat">Send to chat</button><button type="button" class="btn btn-sm btn-primary" data-a="send"${sending ? ' disabled' : ''}>${esc(sendLabel)}</button>`
        : '<button type="button" class="btn btn-sm btn-primary" data-a="chat">Send to chat</button>'}`
      : `<span class="pp-hintl">Select text to disagree, add a note or pick an alternative. Your changes collect here${plan ? ' and go back to the planner together' : ''}.</span>`;
    trayEl.classList.toggle('is-folded', folded && !!items.length);
    trayEl.innerHTML = `<div class="pp-tray-h"><b>${items.length ? plural(items.length, 'pending change') : 'No pending changes'}</b><span>${esc(where)}</span>${items.length
      ? `<button type="button" class="btn btn-sm btn-quiet btn-icon pp-x pp-fold" data-fold aria-label="${folded ? 'Show changes' : 'Hide changes'}" aria-expanded="${!folded}">${iconSvg('chevron-down', 14)}</button>` : ''}</div>
      ${items.length ? `<div class="pp-rows">${rows}</div>` : ''}
      ${note ? `<p class="pp-tray-note" role="status">${esc(note)}</p>` : ''}
      <div class="pp-tray-f">${foot}</div>`;
  }

  function repaint() { paintMarks(); paintTray(); }

  async function action(a) {
    if (a === 'clear') { tray = { items: [], seq: tray.seq }; save(tray); note = ''; repaint(); return; }
    const text = trayDirection(tray.items, file);
    if (a === 'chat') { draft(null, text); return; }
    if (a === 'send') {
      sending = true; note = ''; paintTray();
      const err = await sendBack(text);
      sending = false;
      if (err) { note = err; paintTray(); return; }
      const n = tray.items.length;
      tray = { items: [], seq: tray.seq };
      save(tray);
      note = `${plural(n, 'change')} sent to the run. The next step reads ${n === 1 ? 'it' : 'them'}.`;
      repaint();
    }
  }

  trayEl.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { tray = removeTrayItem(tray, +rm.dataset.rm); save(tray); repaint(); return; }
    if (e.target.closest('[data-fold]')) { folded = !folded; paintTray(); return; }
    const b = e.target.closest('[data-a]');
    if (b) { action(b.dataset.a); return; }
    const row = e.target.closest('.pp-row');
    const r = row && ranges.get(+row.dataset.n);
    if (r) (r.startContainer.parentElement)?.scrollIntoView?.({ block: 'center' });
  });
  trayEl.addEventListener('mouseover', (e) => { const row = e.target.closest('.pp-row'); hot(row ? +row.dataset.n : null); });
  trayEl.addEventListener('mouseleave', () => hot(null));
  marks.addEventListener('click', (e) => { const m = e.target.closest('.pp-mk'); if (m) flashRow(+m.dataset.n); });
  marks.addEventListener('mouseover', (e) => { const m = e.target.closest('.pp-mk'); hot(m ? +m.dataset.n : null); });
  marks.addEventListener('mouseleave', () => hot(null));

  const off = pinpoint.addSurface(md, {
    kind: 'artifact',
    source: () => file,
    container: () => body,
    layer: () => root,
    pending: () => live(),
    addPending(sel, { kind, text }) {
      tray = addTrayItem(tray, { kind, quote: sel.text, at: sel.at, text });
      save(tray);
      note = '';
      folded = false;
      repaint();
      flashRow(tray.seq);
    },
    draft,
    send: draft,
  });
  const ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => layoutMarkers()) : null;
  ro?.observe(stage);
  repaint();

  return () => {
    off();
    ro?.disconnect();
    paintHighlight(win, 'pinpoint-pending', []);
    paintHighlight(win, 'pinpoint-hot', []);
    marks.remove();
    trayEl.remove();
    stage.classList.remove('pp-doc');
  };
}

// =================================================================== the Diff tab

/**
 * What a diff selection quotes: the source text of each row it touches (never the line numbers or the +/− signs),
 * anchored on its first numbered row. null when it touches no diff row.
 */
export function diffExtract(range, unit) {
  const rows = [...unit.querySelectorAll('.hd-dl-row')].filter((r) => { try { return range.intersectsNode(r); } catch { return false; } });
  if (!rows.length) return null;
  const lines = [];
  let anchor = null;
  for (const row of rows) {
    const src = row.querySelector('.hd-dl-src');
    if (!src) continue;
    const r = unit.ownerDocument.createRange();
    r.selectNodeContents(src);
    // Clip the line to the selection: START_TO_START (0) and END_TO_END (2) compare the selection's ends to the line's.
    if (range.compareBoundaryPoints(0, r) > 0) r.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(2, r) < 0) r.setEnd(range.endContainer, range.endOffset);
    const t = r.toString();
    if (t && !anchor && (row.dataset.new || row.dataset.old)) anchor = row;
    lines.push(t);
  }
  if (!anchor) return null;
  const del = anchor.classList.contains('hd-dl-del');
  const side = !del && anchor.dataset.new ? 'new' : 'old';
  const line = Number(side === 'new' ? anchor.dataset.new : anchor.dataset.old);
  return {
    text: lines.join('\n'),
    code: true,
    line: Number.isSafeInteger(line) ? line : null,
    side,
    path: anchor.dataset.path || '',
    project: anchor.dataset.project || '',
  };
}

/**
 * Pinpoint on one Diff tab. `ctx` is the diff's comment layer (create / canCreate / guarded). Returns
 * { paint(comments), off() }: paint highlights the code each Pinpoint comment quotes and repaints the fix-run tray.
 * @param {object} o
 * @param {ReturnType<import('./pinpoint.mjs').createPinpoint>} o.pinpoint
 * @param {Document} o.doc
 * @param {Window} o.win
 * @param {HTMLElement} o.pane    the diff pane (one file's body at a time)
 * @param {HTMLElement} o.trayHost where the tray goes (under the diff)
 * @param {object} o.ctx
 * @param {string} o.runId
 * @param {boolean} o.finished
 * @param {(q:object|null, text:string) => void} o.draft
 * @param {(text:string) => void} o.send   to the chat, sent
 */
export function decorateDiff({ pinpoint, doc, win, pane, trayHost, ctx, runId, finished, draft, send }) {
  let comments = [];
  const trayEl = doc.createElement('div');
  trayEl.className = 'pp-tray pp-tray-diff';
  trayEl.hidden = true;
  trayHost.appendChild(trayEl);

  const off = pinpoint.addSurface(pane, {
    kind: 'diff',
    unit: (el) => (el.closest('.hd-cmt-block, .hd-cmt-detached, .hd-cmt-card, .hd-dl-n') ? null : el.closest('.hd-diff-body')),
    extract: diffExtract,
    source: (sel) => `${(sel.ext && sel.ext.path ? sel.ext.path.split('/').pop() : 'diff')}${sel.ext && sel.ext.line ? ` L${sel.ext.line}` : ''}`,
    container: () => pane,
    async comment(sel, text) {
      const x = sel.ext || {};
      if (!ctx.canCreate()) return 'Comments are off here: the run kept no patch to anchor them to.';
      if (ctx.guarded(x.project || null, x.path)) return 'This file is protected: comments on it are refused.';
      if (!x.line) return 'Pick text on a numbered line to comment on it.';
      return ctx.create({ project: x.project || null, path: x.path, side: x.side, line: x.line }, diffCommentBody(sel.text, text));
    },
    draft,
    send: draft,
  });

  function paintQuotes() {
    const body = pane.querySelector('.hd-diff-body');
    const ranges = [];
    if (body) {
      for (const c of comments) {
        if (c.parentId) continue;
        const q = quoteOfCommentBody(c.body).split('\n')[0];
        if (!q) continue;
        const attr = c.side === 'old' ? 'data-old' : 'data-new';
        const row = [...body.querySelectorAll(`.hd-dl-row[${attr}]`)].find((r) => r.getAttribute(attr) === String(c.line) && (r.dataset.path || '') === (c.path || ''));
        const src = row && row.querySelector('.hd-dl-src');
        const r = src ? quoteRange(doc, src, q, 0) : null;
        if (r) ranges.push(r);
      }
    }
    paintHighlight(win, 'pinpoint-comment', ranges);
  }

  function paintTray() {
    const open = openFixComments(comments);
    if (!open.length) { trayEl.hidden = true; trayEl.innerHTML = ''; return; }
    trayEl.hidden = false;
    const list = open.slice(0, 8).map((c, i) => `<div class="pp-row"><span class="pp-n">${i + 1}</span><span class="pp-kind" data-k="comment">Comment</span>
      <span class="pp-rq mono" title="${esc(c.path)}:${c.line}">${esc(c.path.split('/').pop())} L${c.line}</span>
      <span class="pp-rt" title="${esc(c.body)}">${esc(shortText(c.body.replace(/^> .*\n?/gm, ''), 120) || shortText(quoteOfCommentBody(c.body), 80))}</span></div>`).join('');
    const more = open.length > 8 ? `<p class="pp-hintl">and ${open.length - 8} more</p>` : '';
    trayEl.innerHTML = `<div class="pp-tray-h"><b>${plural(open.length, 'open comment')}</b><span>on this diff</span></div>
      <div class="pp-rows">${list}</div>${more}
      <div class="pp-tray-f"><span class="pp-hintl">${finished ? 'Open, unresolved comments not yet sent to a run.' : 'The run is still going; a fix run can follow once it is done.'}</span>
      <button type="button" class="btn btn-sm" data-a="chat">Send to chat</button>${finished ? '<button type="button" class="btn btn-sm btn-primary" data-a="fix">Propose fix run</button>' : ''}</div>`;
  }

  trayEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const open = openFixComments(comments);
    if (!open.length) return;
    if (b.dataset.a === 'fix') { send(fixRunRequest(open, runId)); return; }
    draft(null, open.map((c) => `[diff comment ${c.id} — ${c.path}:${c.line} (${c.side})${runId ? `, run ${runId}` : ''}] ${shortText(c.body, 160)}`).join('\n'));
  });

  // The syntax highlighter and a window repaint replace a row's text nodes: the highlights follow them.
  let raf = 0;
  const mo = typeof win.MutationObserver === 'function' ? new win.MutationObserver(() => {
    if (raf) return;
    raf = (win.requestAnimationFrame || ((f) => setTimeout(f, 16)))(() => { raf = 0; paintQuotes(); });
  }) : null;
  mo?.observe(pane, { childList: true, subtree: true });

  return {
    paint(list) { comments = Array.isArray(list) ? list : []; paintQuotes(); paintTray(); },
    off() { off(); mo?.disconnect(); paintHighlight(win, 'pinpoint-comment', []); trayEl.remove(); },
  };
}
