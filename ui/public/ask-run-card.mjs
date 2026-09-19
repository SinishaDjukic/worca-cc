// ui/public/ask-run-card.mjs — the Ask Worca run progress card: a STATELESS view over one run snapshot.
// Two producers feed the same shape: app.js askRunSnapshot(r) (live, from the run model) and
// snapshotFromState(state) here (REST rowToState). Pure DOM (`doc` injected), no fetch, no timers;
// the panel owns the store, the hydration and the tick. Mirrors app.js statusPill/activeCopy so the
// card and the Running list never disagree on a family (one wording deviation: the question state
// reads "Waiting for your answer", the request's own name for it).
import { decorFromState, applyDecor, manifestTemplate, manifestPortsFn, manifestAgents, isGraphManifest, fmtDur, fmtUsd } from './graph/run-decor.mjs';
import { mountStaticGraph } from './graph/view.mjs';
import { FLOW_SCALE } from './graph/model.mjs';

export const PROGRESS_CARD_TYPE = 'progress';
/** app.js isTerminalStatus's set, verbatim (app.js:4304-4306). */
export const TERMINAL_RUN_STATUS = new Set(['done', 'error', 'stopped', 'aborted', 'failed', 'complete', 'completed', 'interrupted']);
/** app.js isLive's status arm (app.js:14663-14666): a run that is scheduling work. A REST row carries no pendingQuestion. */
const LIVE_STATUS = new Set(['starting', 'running', 'pausing']);
/** The six manifest colours the view's h-* / --c vocabulary knows (style.css .gv-world .h-*; app.js PILL_FAMILIES). */
const NODE_COLORS = new Set(['violet', 'blue', 'green', 'red', 'peach', 'amber']);
const PAUSE_WHY = { cost_pipeline: 'cost limit', cost_total: 'total budget', cost_pipeline_policy: 'team cap', cost_total_policy: 'team total', error: 'error', recoverable: 'recoverable', usage_limit: 'usage limit' };

/** A frozen snapshot from GET /api/ask/runs/:id `state` (artifacts.mjs rowToState). null for a non-object. */
export function snapshotFromState(state, { now = Date.now() } = {}) {
  if (!state || typeof state !== 'object') return null;
  const status = String(state.status || '').toLowerCase();
  const graph = isGraphManifest(state.stepper);
  // live derives from the status exactly as app.js isLive does for the Running list: a row that is still running
  // marches its ants and paints unfinished executions active; a paused/finished row is resolved (run-decor.mjs:162).
  const live = LIVE_STATUS.has(status);
  const decor = graph ? decorFromState(state, { live, now }) : null;
  const ws = state.target === 'workspace';
  return {
    source: 'rest',
    runId: null,
    pipelineId: state.id || null,
    kind: ws ? 'workspace-run' : 'run',
    title: state.title || '',
    projectKey: ws ? null : (state.projectKey || null),
    workspaceId: ws ? (state.workspaceId || null) : null,
    projectDir: state.projectDir || '',
    projectNames: ws && Array.isArray(state.projects) ? state.projects.map((p) => p && p.projectName).filter(Boolean) : null,
    status,
    pauseReason: state.pauseReason || null,
    pendingQuestion: null,
    live,
    terminal: TERMINAL_RUN_STATUS.has(status),
    startedAt: state.startedAt || null,
    elapsedMs: Number(state.totalActiveMs) || 0,
    costUsd: Number(state.totalCostUsd) || 0,
    progress: decor ? decor.progress : null,
    active: decor ? decor.activeNodes : [],          // a v1 row names no agent even when state.active is set
    stepper: graph ? state.stepper : null,
    decor,
  };
}

/** {family, text} — app.js statusPill + activeCopy, in the SAME branch order (parked-ness before the question, the question before done/stopped/error). */
export function runPill(snap) {
  if (!snap) return { family: 'peach', text: 'Starting' };
  const s = snap.status;
  if (s === 'pausing') return { family: 'amber', text: 'Pausing…' };
  if (s === 'paused') { const why = PAUSE_WHY[snap.pauseReason]; return { family: 'amber', text: why ? `Paused · ${why}` : 'Paused' }; }
  if (s === 'interrupted') return { family: 'amber', text: 'Interrupted' };
  if (snap.pendingQuestion) return { family: 'amber', text: snap.pendingQuestion.kind === 'workflow' ? 'Waiting · your decision' : 'Waiting for your answer' };
  if (s === 'starting') return { family: 'peach', text: 'Starting' };
  if (s === 'done') return { family: 'green', text: 'Done' };
  if (s === 'stopped') return { family: 'red', text: 'Stopped' };
  if (s === 'error') return { family: 'red', text: 'Error' };
  if (TERMINAL_RUN_STATUS.has(s)) return { family: 'red', text: s.charAt(0).toUpperCase() + s.slice(1) };
  const list = Array.isArray(snap.active) ? snap.active : [];
  if (list.length >= 2) return { family: 'peach', text: `${list.length} agents running` };
  if (list.length === 1) return { family: NODE_COLORS.has(list[0].color) ? list[0].color : 'peach', text: list[0].label };
  return { family: 'peach', text: 'Running' };
}

/** Where "Open run" goes (D12). */
export function progressRoute(ident, snap) {
  if (snap && snap.source === 'live' && snap.runId) return `#running/${snap.runId}`;
  const pipelineId = ident.pipelineId || (snap && snap.pipelineId) || null;
  const workspaceId = ident.workspaceId || (snap && snap.workspaceId) || null;
  const projectKey = ident.projectKey || (snap && snap.projectKey) || null;
  const key = workspaceId ? `workspaces/${workspaceId}` : projectKey;
  const history = pipelineId && key ? `#history/${key}/${pipelineId}` : null;
  if (snap && snap.source === 'rest') return history || `#running/${ident.runId || ''}`;
  if (ident.runId) return `#running/${ident.runId}`;
  return history || '#running/';
}

const nodeSig = (stepper) => (stepper && stepper.graph && Array.isArray(stepper.graph.nodes) ? stepper.graph.nodes.filter(Boolean).map((n) => n.id).join('|') : '');
const projectLabel = (ident, snap) => {
  if (ident.label) return ident.label;
  if (snap && Array.isArray(snap.projectNames) && snap.projectNames.length) return snap.projectNames.join(' · ');
  if (snap && snap.projectDir) return String(snap.projectDir).split(/[\\/]/).filter(Boolean).pop() || '';
  return ident.workspaceId ? `workspace ${ident.workspaceId}` : (ident.projectKey || '');
};

/**
 * @param {{doc: Document, ident: object, onOpen?: (href: string) => void}} opts
 * @returns {{el, parts:{graph}, update(snap, now), relayout(w), setReason(text), destroy(), snapshot}}
 */
export function createRunProgressCard({ doc, ident, onOpen = null }) {
  const h = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const el = h('div', 'ask-card ask-rc');
  el.dataset.cardId = ident.cardId || '';
  const head = h('div', 'ask-rc-head');
  const pill = h('span', 'ask-rc-pill st-peach');
  const pillText = h('span', 'ask-rc-pill-text', 'Starting');
  pill.append(h('span', 'ask-rc-dot'), pillText);
  const open = h('a', 'ask-rc-open', 'Open run');   // class-free pin (.ask-card a[href]); never .ask-card-link — its colour rule would leak
  open.setAttribute('href', progressRoute(ident, null));
  open.addEventListener('click', (e) => { e.preventDefault(); if (typeof onOpen === 'function') onOpen(open.getAttribute('href') || ''); });
  head.append(h('span', 'ask-rc-kicker', 'Pipeline run'), pill, h('span', 'ask-rc-spacer'), open);
  const title = h('div', 'ask-rc-title', ident.title || 'Run');
  const sub = h('div', 'ask-rc-sub');
  const stats = h('div', 'ask-rc-stats');
  const stat = (label, cls) => { const box = h('div', 'ask-rc-stat'); const v = h('span', `ask-rc-stat-v ${cls}`); box.append(h('span', 'ask-rc-stat-k', label), v); stats.appendChild(box); return v; };
  const timeEl = stat('Elapsed', 'ask-rc-time mono');
  const costEl = stat('Cost', 'ask-rc-cost mono');
  const progEl = stat('Progress', 'ask-rc-prog mono');
  const activeBox = h('div', 'ask-rc-active'); activeBox.hidden = true;
  const banner = h('div', 'ask-rc-banner'); banner.hidden = true;
  const graphHost = h('div', 'ask-rc-graph'); graphHost.hidden = true; graphHost.setAttribute('role', 'img');
  graphHost.addEventListener('click', () => open.click());
  const reason = h('div', 'ask-rc-reason'); reason.hidden = true;
  el.append(head, title, sub, stats, activeBox, banner, graphHost, reason);

  let graph = null, graphSig = '', lastDecor = null, activeSig = null, lastSnap = null;
  // G1 (D7/D19): footer bands change a card's height, which the flow layout never billed, and the per-node
  // total pips hang outside the card box — strip both (and the End result band) before applyDecor.
  const bagOf = (decor) => ({ ...decor, footers: {}, totals: {}, endResult: null, expanded: null });
  // G2 (D18): every re-render rewrites the wire classes and badge text (view.mjs:511, 517) — put the ornaments back.
  const redecorate = () => { if (graph && lastDecor) applyDecor(graph, bagOf(lastDecor)); };

  function paintGraph(snap) {
    const stepper = snap && snap.stepper;
    const sig = stepper && isGraphManifest(stepper) ? nodeSig(stepper) : '';
    if (!sig) { if (graph) { graph.destroy(); graph = null; graphSig = ''; lastDecor = null; } graphHost.hidden = true; return; }
    if (!graph || sig !== graphSig) {
      if (graph) graph.destroy();
      graphHost.replaceChildren();
      graphHost.hidden = false;
      lastDecor = null;
      // onLayout fires inside the mount's own paint() — once synchronously here (graph is still null → no-op)
      // and again on every host width change its ResizeObserver sees (the path relayoutCards() never covers).
      graph = mountStaticGraph(graphHost, manifestTemplate(stepper), {
        doc, portsFn: manifestPortsFn(stepper), agents: manifestAgents(stepper), scale: FLOW_SCALE, layout: 'flow',
        onLayout: redecorate,
      });
      graphSig = sig;
      graphHost.setAttribute('aria-label', `Workflow graph: ${graph.flowLayout().order.map((id) => { const n = stepper.graph.nodes.find((x) => x && x.id === id); return (n && n.label) || id; }).join(' → ')}`);
    }
    if (snap.decor && snap.decor !== lastDecor) { lastDecor = snap.decor; redecorate(); }
  }
  function paintActive(list) {
    const sig = list.map((a) => `${a.nodeId}:${a.label}:${a.color}`).join(',');
    if (sig === activeSig) return;
    activeSig = sig;
    activeBox.replaceChildren();
    activeBox.hidden = !list.length;
    for (const a of list) {
      const chip = h('span', 'ask-rc-agent');
      chip.append(h('span', 'ask-rc-agent-dot'), doc.createTextNode(a.label || a.nodeId));   // a REAL dot (D25): the dock's reduced-motion blanket cannot reach a ::before
      chip.style.setProperty('--c', NODE_COLORS.has(a.color) ? `var(--${a.color})` : 'var(--ink-3)');
      activeBox.appendChild(chip);
    }
  }
  function paintBanner(snap) {
    const q = snap && snap.pendingQuestion;
    banner.hidden = !q;
    if (!q) return;
    const n = Array.isArray(q.questions) && q.questions.length ? q.questions.length : (Array.isArray(q.issues) && q.issues.length ? q.issues.length : 1);
    banner.textContent = q.kind === 'workflow' ? 'Waiting for your decision on the proposed workflow' : `Waiting for your answer — ${n} question${n === 1 ? '' : 's'}`;
  }
  function update(snap, now = Date.now()) {
    lastSnap = snap || null;
    const p = runPill(snap);
    const live = !!snap && !snap.terminal && (LIVE_STATUS.has(snap.status) || !!snap.pendingQuestion);
    el.classList.toggle('is-live', live);
    el.classList.toggle('is-terminal', !!snap && !!snap.terminal);
    el.classList.toggle('is-question', !!snap && !!snap.pendingQuestion);
    pill.className = `ask-rc-pill st-${p.family}`;
    pillText.textContent = p.text;
    if (snap && snap.title) title.textContent = snap.title;
    const pid = (snap && snap.pipelineId) || ident.pipelineId;
    sub.textContent = [projectLabel(ident, snap), pid ? `#${pid}` : ''].filter(Boolean).join(' · ');
    timeEl.textContent = fmtDur(snap ? snap.elapsedMs : 0);
    costEl.textContent = fmtUsd(snap ? snap.costUsd : 0);
    const prog = snap && snap.progress;
    progEl.textContent = prog && prog.total ? `${prog.done}/${prog.total} agents` : '—';
    paintActive(snap && Array.isArray(snap.active) ? snap.active : []);
    paintBanner(snap);
    open.setAttribute('href', progressRoute(ident, snap));
    paintGraph(snap);
    void now;   // the panel's tick passes its clock; nothing here extrapolates (the store recomputes elapsed)
  }
  function relayout(w = 0) {
    if (!graph) return;
    const lay = graph.relayout(w || graphHost.clientWidth || 0);
    graphHost.style.height = `${lay.height}px`;
    redecorate();                         // G2: render() rebuilt the wires without their ants/badges
  }
  return {
    el,
    parts: { graph: graphHost },          // relayoutCards() measures parts.graph
    update,
    relayout,
    setReason(text) { reason.textContent = text || ''; reason.hidden = !text; },
    destroy() { if (graph) { graph.destroy(); graph = null; graphSig = ''; lastDecor = null; } },
    get snapshot() { return lastSnap; },
  };
}
