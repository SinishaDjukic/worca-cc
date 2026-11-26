// ui/public/shape/stop-list.mjs — Shaper small runs slice 6 (R-po-4): the open stop list on a marked feature's Chat
// card. One line per `featureView.asks` entry (every open stop and failed run, in run order): the run's own status dot,
// its text (`stopLineText`), then today's step card for an open stop or a Resume for a failed run. The feature page
// calls featureCardModel too and shows no stop list, so the list lives here, not in feature-card.mjs.
// Slice 13 (R-ux-5): an open line's question host carries the card question's class (`chat-rc-q chat-rc-stop-q`), so the
// card question's own rules draw its step card. It stays a div with no head or body of its own: the card's direct-child
// section.chat-rc-q is still its one question slot.
import { runStatus, stopLineText } from '../../../src/shared/shape/run-status.mjs';
import { RUN_STATES } from '../../../src/shared/run-model.mjs';
import { markDot, paintStatusDot, renderStatusDot } from '../status-dot.mjs';

const isObj = (x) => !!x && typeof x === 'object';

/**
 * The list model: one line per `view.asks` entry; `[]` when the view has no `asks` (flag off, unmarked, not active).
 * @returns {Array<{key, index, text, word, mark, failed, ref: {runId, pipelineId}|null, id, kind, holdsUp}>}
 */
export function stopLinesOf(view, { snapOf = () => null } = {}) {
  if (!Array.isArray(view && view.asks)) return [];
  const all = Array.isArray(view.slices) ? view.slices : [];
  const slices = new Map(all.map((s) => [s.index, s]));
  return view.asks.filter(isObj).map((e) => {
    const snap = e.pipelineId ? snapOf(e.pipelineId) : null;
    const st = runStatus({ slice: slices.get(e.index), slices, snap });
    // The entry decides which of the two marks a line shows; a slice payload that lags behind it keeps the entry's.
    const mark = e.failed ? 'failed' : 'ask';
    const word = st.mark === mark ? st.word : (e.failed ? 'failed' : 'waiting for you');
    return { key: `run-${e.index}`, index: e.index, text: stopLineText(e), word, mark, failed: !!e.failed,
      ref: e.failed ? null : { runId: (snap && snap.runId) || e.runId, pipelineId: e.pipelineId },
      id: e.id, kind: e.kind, holdsUp: Array.isArray(e.holdsUp) ? e.holdsUp : [] };
  });
}

/** D8: the run's own mark over the needs-you / failed state, the s4 path; no dot class of its own. */
const dotOf = (line) => {
  const key = line.failed ? 'failed' : 'needs-you';
  return markDot({ state: key, ...RUN_STATES[key] }, line.mark, line.word);
};

/** Keyed state per host: key → {li, dot, text, body, failed, qHost, dispose, btn, err, inflight, refocus}. */
const KEPT = new WeakMap();

function dropBody(entry, deps, { empty = true } = {}) {
  if (entry.qHost) {
    deps.releaseQuestion(entry.qHost);
    if (typeof entry.dispose === 'function') entry.dispose();
  }
  if (empty) entry.body.replaceChildren();   // a line that goes away keeps its body: the whole row leaves
  Object.assign(entry, { qHost: null, dispose: null, btn: null, err: null, inflight: false, refocus: false });
}

function buildOpen(doc, entry, line, deps) {
  const qHost = doc.createElement('div');
  qHost.className = 'chat-rc-q chat-rc-stop-q';
  const panel = doc.createElement('div');
  panel.className = 'qpanel hidden';
  qHost.appendChild(panel);
  entry.body.appendChild(qHost);
  entry.qHost = qHost;
  entry.dispose = deps.bindQuestion(qHost, line);
}

function buildFailed(doc, entry, line, deps) {
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-sm chat-rc-stop-resume';
  btn.textContent = 'Resume';
  const err = doc.createElement('span');
  err.className = 'chat-rc-stop-err';
  err.setAttribute('role', 'status');
  err.hidden = true;
  btn.addEventListener('click', () => {
    if (entry.inflight || btn.disabled) return;
    const hadFocus = doc.activeElement === btn;
    entry.inflight = true;
    btn.disabled = true;
    err.hidden = true;
    err.textContent = '';
    Promise.resolve(deps.resume(entry.index)).then((r) => r, (e) => ({ ok: false, error: (e && e.message) || String(e) })).then((r) => {
      entry.inflight = false;
      btn.disabled = false;
      if (r && r.ok === false) { err.textContent = r.error || 'Resume failed'; err.hidden = false; }
      // Rule focus-after-disable: Chromium blurred the button when it was disabled; give the focus back.
      if (hadFocus) { entry.refocus = true; if (btn.isConnected) { btn.focus(); entry.refocus = false; } }
    });
  });
  entry.body.append(btn, err);
  Object.assign(entry, { btn, err });
  btn.setAttribute('aria-label', `Resume run ${line.index}`);
}

/**
 * Paint `lines` into `host` (an `ol.chat-rc-stops`), keyed by `line.key` (D17): a kept line keeps its node and step card,
 * a line that goes away releases its question host and disposes its delegate.
 * @param {{paintQuestion: Function, releaseQuestion: Function, bindQuestion: Function, resume: Function}} deps
 */
export function paintStopList(doc, host, lines, deps) {
  let kept = KEPT.get(host);
  if (!kept) { kept = new Map(); KEPT.set(host, kept); }
  const want = new Set(lines.map((l) => l.key));
  for (const [key, entry] of kept) {
    if (want.has(key)) continue;
    dropBody(entry, deps, { empty: false });
    entry.li.remove();
    kept.delete(key);
  }
  lines.forEach((line, i) => {
    let entry = kept.get(line.key);
    if (!entry) {
      const li = doc.createElement('li');
      li.className = 'chat-rc-stop';
      li.dataset.key = line.key;
      const row = doc.createElement('div');
      row.className = 'chat-rc-stop-line';
      const dot = renderStatusDot(doc, dotOf(line));
      const text = doc.createElement('span');
      text.className = 'chat-rc-stop-text';
      row.append(dot, text);
      const body = doc.createElement('div');
      body.className = 'chat-rc-stop-body';
      li.append(row, body);
      entry = { li, dot, text, body, failed: null, index: line.index, qHost: null, dispose: null, btn: null, err: null, inflight: false, refocus: false };
      kept.set(line.key, entry);
    }
    entry.index = line.index;
    entry.li.dataset.run = String(line.index);
    paintStatusDot(entry.dot, dotOf(line));
    if (entry.text.textContent !== line.text) { entry.text.textContent = line.text; entry.text.title = line.text; }
    if (entry.failed !== line.failed) {
      if (entry.failed !== null) dropBody(entry, deps);
      entry.failed = line.failed;
      if (line.failed) buildFailed(doc, entry, line, deps); else buildOpen(doc, entry, line, deps);
    }
    // chatPaintQuestion rebuilds only when the question (or the run asking it) changes, so a repaint keeps typed text.
    if (!line.failed && line.ref) deps.paintQuestion(line.ref, entry.qHost);
    if (entry.btn && entry.refocus && entry.btn.isConnected && !entry.btn.disabled) { entry.btn.focus(); entry.refocus = false; }
    // Run order, moving a node only when it is out of place (a move would drop the focus inside it).
    if (host.children[i] !== entry.li) host.insertBefore(entry.li, host.children[i] || null);
  });
  host.hidden = !lines.length;
}
