// ui/public/chat/home-run-tile.mjs — one run tile on the Chat home (worca Chat P6): title, "project · workflow", the
// Running list's status pill (ask-run-card.mjs runPill), the Workflows-style graph (U9: the shared renderer — frosted
// cards, port badges, lane wires, loop pills — in a 176px dotted well through run-hosts.mjs mountRunGraph), the
// "N/M agents · dur · $cost" line and an amber Answer while the run waits. A stateless view over a snapshot (app.js
// askRunSnapshot + project/workflow, or a History row's stand-in); update() repaints in place.
import { mountRunGraph } from '../graph/run-hosts.mjs';
import { isGraphManifest, fmtDur, fmtUsd } from '../graph/run-decor.mjs';
import { runPill } from '../ask-run-card.mjs';
import { RESULT_STATUS } from './run-card.mjs';

/** run-hosts mode for the tile well. 'focus' renders exactly like 'static' (look-only: no listeners, cards
 *  pointer-events:none) but fits the host's OWN box and follows the running step; 'static' is hard-wired to the
 *  Running list's 300px height (run-hosts.mjs STATIC_HOST_H), which a 176px well clips. */
export const TILE_GRAPH_MODE = 'focus';
/** app.js paintAutoDeciding's live line, verbatim. */
export const DECIDING_TEXT = 'Auto is deciding the workflow…';
/** The well's line while the stepper still says Auto is deciding — the run page's words (app.js paintAutoDeciding,
 *  P3 run-card.mjs): a run that waits on its proposal, is parked, or can never decide again never reads "deciding". */
export function decidingText(s) {
  const st = String((s && s.status) || '').toLowerCase();
  if (RESULT_STATUS.has(st)) return 'Auto did not decide a workflow';
  if (st === 'paused' || st === 'pausing' || st === 'interrupted') return 'Paused before deciding';
  if (s && s.pendingQuestion && s.pendingQuestion.kind === 'workflow') return 'Waiting for your decision';
  return DECIDING_TEXT;
}

const BAGS = new WeakMap();
/** The decor bag a tile paints: expert detail off (per-node totals, footer bands, loop counts — they resize the cards
 *  and crowd a 176px well). Memoised per decor generation: run-hosts skips a repaint for the same bag object. */
export function tileBag(decor) {
  if (!decor || typeof decor !== 'object') return null;
  let bag = BAGS.get(decor);
  if (!bag) { bag = { ...decor, detail: false, expanded: null }; BAGS.set(decor, bag); }
  return bag;
}
export function tileSub(snap) {
  return [snap && snap.project, snap && snap.workflow].filter(Boolean).join(' · ');
}
export function tileStats(snap) {
  const parts = [];
  const p = snap && snap.progress;
  if (p && Number(p.total) > 0) parts.push(`${p.done}/${p.total} agents`);
  if (snap && Number(snap.elapsedMs) > 0) parts.push(fmtDur(snap.elapsedMs));
  if (snap && snap.costUsd != null && Number.isFinite(Number(snap.costUsd))) parts.push(fmtUsd(snap.costUsd));   // null: the engine reports no cost
  return parts.join(' · ');
}
const drawable = (s) => !!(s && s.decor && isGraphManifest(s.stepper) && s.stepper.graph.nodes.some(Boolean));
const deciding = (s) => !!(s && s.stepper && s.stepper.auto && s.stepper.auto.status === 'deciding');
const needsWash = (s) => !!(s && (s.pendingQuestion || String(s.status || '').toLowerCase() === 'paused'));

export function createRunTile({ doc, snap, onOpen = null, onAnswer = null }) {
  const h = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const put = (node, text) => { if (node.textContent !== text) node.textContent = text; };
  const el = h('article', 'chat-run-tile');
  const head = h('div', 'chat-run-tile-head');
  const tt = h('div', 'chat-run-tile-tt');
  // The title IS the tile's open control: a button whose ::after (style.css) stretches over the tile.
  const open = h('button', 'chat-run-tile-open');
  open.type = 'button';
  const sub = h('span', 'chat-run-tile-sub');
  tt.append(open, sub);
  const pill = h('span', 'chat-run-tile-pill st-peach');
  const pillText = h('span', 'chat-run-tile-pt');
  pill.append(h('span', 'chat-run-tile-dot'), pillText);
  head.append(tt, pill);
  const well = h('div', 'run-flow-wrap chat-run-tile-well');   // run-hosts looks the wrap up by .run-flow-wrap
  well.setAttribute('role', 'img');
  well.setAttribute('aria-label', 'Workflow graph');
  const host = h('div', 'run-flow');
  // Look-only: run-hosts leaves the stage and every card at tabindex 0 in 'focus' mode — eight tab stops per tile, and
  // a focused card scrolls the overflow:hidden well off the running step. The title is the tile's one control.
  host.setAttribute('inert', '');
  const note = h('span', 'chat-run-tile-note');
  note.hidden = true;
  well.append(host, note);
  const foot = h('div', 'chat-run-tile-foot');
  const stats = h('span', 'chat-run-tile-stats');
  const answer = h('button', 'chat-run-tile-answer', 'Answer');
  answer.type = 'button';
  answer.hidden = true;
  foot.append(stats, answer);
  el.append(head, well, foot);

  let cur = null;
  let graph = null;
  // Busy (a route is looking up the following chat): aria-disabled, never `disabled` — Chrome drops the focus of a
  // control disabled across a task to <body>, and P4's run panel then remembers no opener to give the focus back to.
  const busy = () => el.getAttribute('aria-busy') === 'true';
  open.addEventListener('click', () => { if (cur && !busy() && typeof onOpen === 'function') onOpen(cur); });
  answer.addEventListener('click', () => { if (cur && !busy() && typeof onAnswer === 'function') onAnswer(cur); });

  function paintGraph(s) {
    const wait = deciding(s);
    note.hidden = !wait;
    if (wait) put(note, decidingText(s));
    // role="img" makes the well's children presentational: the deciding line is read through the well's own name.
    const name = wait ? decidingText(s) : 'Workflow graph';
    if (well.getAttribute('aria-label') !== name) well.setAttribute('aria-label', name);
    const draw = !wait && drawable(s);
    el.classList.toggle('is-nograph', !draw && !wait);
    if (!draw) { if (graph) { graph.destroy(); graph = null; } return; }
    if (!graph) graph = mountRunGraph(host, { mode: TILE_GRAPH_MODE, doc });
    graph.update(String(s.runId || s.pipelineId || s.key || ''), s.stepper, tileBag(s.decor));
  }
  function update(s) {
    if (!s) return;
    cur = s;
    el.dataset.tileKey = String(s.key || '');
    const p = runPill(s);
    el.classList.toggle('is-need', needsWash(s));
    const title = String(s.title || 'Run');
    put(open, title);
    open.title = title;
    put(sub, tileSub(s));
    pill.className = `chat-run-tile-pill st-${p.family}`;
    put(pillText, p.text);
    put(stats, tileStats(s));
    answer.hidden = !s.pendingQuestion;
    paintGraph(s);
  }
  function setBusy(on) {
    el.setAttribute('aria-busy', on ? 'true' : 'false');
    for (const b of [open, answer]) {
      if (on) b.setAttribute('aria-disabled', 'true');
      else b.removeAttribute('aria-disabled');
    }
  }
  update(snap);
  return {
    el,
    update,
    setBusy,
    /** Re-frame the graph once the tile is in the page (it was built detached, at 0×0). */
    fit() { if (graph) graph.fit(); },
    destroy() { if (graph) { graph.destroy(); graph = null; } },
    get snapshot() { return cur; },
  };
}
