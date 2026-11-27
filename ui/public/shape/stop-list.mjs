// ui/public/shape/stop-list.mjs — Shaper small runs slice 6 (R-po-4): the open stop list on a marked feature's Chat
// card. One line per `featureView.asks` entry (every open stop and failed run, in run order): the run's own status dot,
// its text (`stopLineText`), then today's step card for an open stop or a Resume for a failed run. The feature page
// calls featureCardModel too and shows no stop list, so the list lives here, not in feature-card.mjs.
// Slice 13 (R-ux-5): an open line's question host carries the card question's class (`chat-rc-q chat-rc-stop-q`), so the
// card question's own rules draw its step card. It stays a div with no head or body of its own: the card's direct-child
// section.chat-rc-q is still its one question slot.
// Slice 12 (R-ux-5): the same list also sits first in the feature page's Runs panel (group-page.mjs). An open stop's
// line is a Row button, closed when first painted: a closed line mounts no step card, opening one mounts exactly one
// (and closes any other open line), closing it unmounts it. A paused run is not a stop, so it gets no line.
import { runStatus, stopLineText } from '../../../src/shared/shape/run-status.mjs';
import { RUN_STATES } from '../../../src/shared/run-model.mjs';
import { markDot, paintStatusDot, renderStatusDot } from '../status-dot.mjs';
import { icon } from '../icons.mjs';

const isObj = (x) => !!x && typeof x === 'object';

/**
 * The list model: one line per `view.asks` entry but a paused run's; `[]` when the view has no `asks` (flag off, unmarked, not active).
 * @returns {Array<{key, index, text, word, mark, failed, ref: {runId, pipelineId}|null, id, kind, holdsUp}>}
 */
export function stopLinesOf(view, { snapOf = () => null } = {}) {
  if (!Array.isArray(view && view.asks)) return [];
  const all = Array.isArray(view.slices) ? view.slices : [];
  const slices = new Map(all.map((s) => [s.index, s]));
  // Slice 12 (D7): a paused run is not a stop. The server drops its ask on pause; a lagging payload is dropped here.
  const paused = (e) => (e.pipelineId && snapOf(e.pipelineId)?.status === 'paused') || slices.get(e.index)?.state === 'paused';
  return view.asks.filter((e) => isObj(e) && !paused(e)).map((e) => {
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

/** Keyed state per host: {lines: key → {li, row, line, dot, text, chev, body, failed, qHost, dispose, btn, err, inflight,
 * refocus}, openKey, prefix}. Only the open line (openKey) owns a question host. */
const KEPT = new WeakMap();
let hostSeq = 0;

function dropBody(entry, deps, { empty = true } = {}) {
  if (entry.qHost) {
    deps.releaseQuestion(entry.qHost);
    if (typeof entry.dispose === 'function') entry.dispose();
  }
  if (empty) entry.body.replaceChildren();   // a line that goes away keeps its body: the whole row leaves
  Object.assign(entry, { qHost: null, dispose: null, btn: null, err: null, inflight: false, refocus: false });
}

/** Close an open-stop line: its step card is released and unmounted, its body hidden and unlabelled. */
function closeLine(entry, deps) {
  dropBody(entry, deps);
  entry.line.setAttribute('aria-expanded', 'false');
  entry.line.removeAttribute('aria-controls');
  for (const a of ['role', 'aria-labelledby']) entry.body.removeAttribute(a);
  entry.body.hidden = true;
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

/** Open an open-stop line: its body becomes the button's region and mounts that run's one step card. */
function openLine(doc, entry, line, deps) {
  entry.line.setAttribute('aria-expanded', 'true');
  entry.line.setAttribute('aria-controls', entry.body.id);
  entry.body.setAttribute('role', 'region');
  entry.body.setAttribute('aria-labelledby', entry.line.id);
  entry.body.hidden = false;
  buildOpen(doc, entry, line, deps);
  if (line.ref) deps.paintQuestion(line.ref, entry.qHost);
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

/** The line's row: a Row button for an open stop (dot, text, chevron), today's plain div for a failed run. */
function buildRow(doc, state, entry, failed) {
  const row = doc.createElement(failed ? 'div' : 'button');
  row.className = failed ? 'chat-rc-stop-line' : 'chat-rc-stop-line row-btn';
  row.append(entry.dot, entry.text);
  if (!failed) {
    row.type = 'button';
    row.id = `${state.prefix}-${entry.key}`;
    row.setAttribute('aria-expanded', 'false');
    row.append(icon(doc, 'chevron', 16, 'chat-rc-stop-chev'));
    row.addEventListener('click', () => state.press(entry.key));
  }
  if (entry.line) entry.line.replaceWith(row); else entry.li.prepend(row);
  entry.line = row;
  entry.body.hidden = !failed;
}

/** The control that owns a line's focus: its Row button, or a failed line's Resume. */
const focusTarget = (entry) => (entry.failed ? entry.btn : entry.line);

/**
 * Paint `lines` into `host` (an `ol.chat-rc-stops`), keyed by `line.key` (D17). Every open-stop line paints closed; a
 * press opens it (one open line per host) and mounts its step card, which a repaint keeps with its typed text. When the
 * open line goes away (answered, or its run failed) its host is released and disposed once, and a focus inside it moves
 * to the line now at that position (else the last line), or to `deps.focusOut()` when no line is left.
 * @param {{paintQuestion: Function, releaseQuestion: Function, bindQuestion: Function, resume: Function, focusOut?: Function}} deps
 */
export function paintStopList(doc, host, lines, deps) {
  let state = KEPT.get(host);
  if (!state) {
    hostSeq += 1;
    state = { lines: new Map(), openKey: null, prefix: `stopline-${hostSeq}`, deps, current: new Map() };
    state.press = (key) => {
      const entry = state.lines.get(key);
      if (!entry || entry.failed) return;
      const was = state.openKey;
      if (was) { const open = state.lines.get(was); if (open) closeLine(open, state.deps); state.openKey = null; }
      if (was === key) return;
      state.openKey = key;
      openLine(doc, entry, state.current.get(key), state.deps);
    };
    KEPT.set(host, state);
  }
  state.deps = deps;
  state.current = new Map(lines.map((l) => [l.key, l]));
  const kept = state.lines;
  // D6: where the open line was and whether the focus is inside it, before the repaint moves anything.
  const openEntry = state.openKey ? kept.get(state.openKey) : null;
  const focusIn = !!openEntry && openEntry.li.contains(doc.activeElement);
  const openAt = openEntry ? [...host.children].indexOf(openEntry.li) : -1;
  let lost = false;
  for (const [key, entry] of kept) {
    if (state.current.has(key)) continue;
    dropBody(entry, deps, { empty: false });
    entry.li.remove();
    kept.delete(key);
    if (key === state.openKey) { state.openKey = null; lost = true; }
  }
  lines.forEach((line, i) => {
    let entry = kept.get(line.key);
    if (!entry) {
      const li = doc.createElement('li');
      li.className = 'chat-rc-stop';
      li.dataset.key = line.key;
      const dot = renderStatusDot(doc, dotOf(line));
      const text = doc.createElement('span');
      text.className = 'chat-rc-stop-text';
      const body = doc.createElement('div');
      body.className = 'chat-rc-stop-body';
      body.id = `${state.prefix}-${line.key}-body`;
      li.append(body);
      entry = { key: line.key, li, line: null, dot, text, body, failed: null, index: line.index, qHost: null, dispose: null, btn: null, err: null, inflight: false, refocus: false };
      kept.set(line.key, entry);
    }
    entry.index = line.index;
    entry.li.dataset.run = String(line.index);
    paintStatusDot(entry.dot, dotOf(line));
    if (entry.text.textContent !== line.text) { entry.text.textContent = line.text; entry.text.title = line.text; }
    if (entry.failed !== line.failed) {
      if (entry.failed !== null) {
        if (line.key === state.openKey) { closeLine(entry, deps); state.openKey = null; lost = true; } else dropBody(entry, deps);
      }
      entry.failed = line.failed;
      buildRow(doc, state, entry, line.failed);
      if (line.failed) buildFailed(doc, entry, line, deps);
    }
    // chatPaintQuestion rebuilds only when the question (or the run asking it) changes, so a repaint keeps typed text.
    if (!line.failed && line.ref && line.key === state.openKey) deps.paintQuestion(line.ref, entry.qHost);
    if (entry.btn && entry.refocus && entry.btn.isConnected && !entry.btn.disabled) { entry.btn.focus(); entry.refocus = false; }
    // Run order, moving a node only when it is out of place (a move would drop the focus inside it).
    if (host.children[i] !== entry.li) host.insertBefore(entry.li, host.children[i] || null);
  });
  host.hidden = !lines.length;
  if (lost && focusIn) {
    const at = lines[Math.min(openAt, lines.length - 1)];
    const target = at && focusTarget(kept.get(at.key));
    if (target) target.focus();
    else if (!lines.length && typeof deps.focusOut === 'function') deps.focusOut();
  }
}
