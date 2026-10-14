// ui/public/chat/run-card.mjs — worca Chat P3: the live run card (CONTRACT §5).
//
// createChatRunCard is a STATELESS view over one run snapshot: app.js askRunSnapshot(r) (live, from the run model) or
// snapshotFromState(state, {extras}) over GET /api/ask/runs/:id (REST). The graph is the Workflows rendering (U9) in a
// run-hosts `card` well; the run's own question renders with the run page's renderers (R11); a finished run shows its
// result (R12). Every run action goes through `controls`, which app.js binds to its existing flows (pauseRun,
// resumeRunFromCard / resumePipeline, openStopModal, postAnswer, Ship-it) — this module never fetches.
// Pure DOM over an injected `doc`.
import { runPill, progressRoute, projectLabel, snapshotFromState, PROGRESS_CARD_TYPE } from '../ask-run-card.mjs';
import { registerChatCard } from './extensions.mjs';
import { mountRunGraph } from '../graph/run-hosts.mjs';
import { fmtDur, fmtUsd, isGraphManifest, manifestNodes } from '../graph/run-decor.mjs';
import { askRendererFor, askKindOf } from '../ask/registry.mjs';
import { shapeFirstOn } from './shape-gate.mjs';

const LIVE_STATUS = new Set(['starting', 'running', 'pausing']);
/** A question that goes away under these was answered (here or elsewhere). Not `pausing`: ui/server.mjs pauseRun resolves
 *  the open question (reason 'paused') right AFTER the run's `pausing` frame — that question was not answered. */
const ANSWERING_STATUS = new Set(['starting', 'running']);
/** Statuses whose card keeps its run controls: live, parked (paused), or resumable after a restart (interrupted). */
const CONTROL_STATUS = new Set(['starting', 'running', 'pausing', 'paused', 'interrupted']);
/** Over for good: the result region replaces the controls (interrupted is resumable, so it is not here). */
export const RESULT_STATUS = new Set(['done', 'stopped', 'error', 'failed', 'aborted', 'complete', 'completed']);
const DONE_STATUS = new Set(['done', 'complete', 'completed']);
const NODE_COLORS = new Set(['violet', 'blue', 'green', 'red', 'peach', 'amber']);
const KEYED = new Set(['agent', 'script']);
/** The run page's answer buttons (app.js #run-detail delegate), minus the workflow arm, which binds its own. */
const Q_BUTTONS = '.qpanel .btn-go, .qpanel .gate-continue, .qpanel .gate-another, .qpanel .recovery-retry, .qpanel .recovery-pause, .qpanel .recovery-abort';
const DECISIONS = { 'gate-continue': 'continue', 'gate-another': 'another', 'recovery-retry': 'retry', 'recovery-pause': 'pause', 'recovery-abort': 'abort' };
const SVG_NS = 'http://www.w3.org/2000/svg';
/** 24-unit stroked glyphs (module literals only — never run data). */
const ICONS = {
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  ship: '<path d="M12 3c3.2 2.2 5 5.6 5 9.6L14.8 16H9.2L7 12.6C7 8.6 8.8 5.2 12 3z"/><circle cx="12" cy="10" r="1.7"/><path d="M9.2 16L7 20M14.8 16L17 20M12 16v4"/>',
  review: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v7M18 15.5V10a3 3 0 0 0-3-3h-4"/><path d="M13 5l-2 2 2 2"/>',
  merged: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5V21M6 9a9 9 0 0 0 9 9h.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  stop: '<path d="M7 7l10 10M17 7L7 17"/>',
};

function icon(doc, name) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of [['viewBox', '0 0 24 24'], ['width', '16'], ['height', '16'], ['fill', 'none'], ['stroke', 'currentColor'],
    ['stroke-width', '1.8'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']]) svg.setAttribute(k, v);
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

/** The persisted identity a card starts from — ask-panel's progressIdent, same rules: a track_run `progress` card
 *  names its run; a started run proposal names only its runId until the run store or the run links reveal the
 *  pipeline id. The controller mutates it as those arrive. */
export function progressIdent(block) {
  const card = (block && block.card) || {};
  if (card.type === PROGRESS_CARD_TYPE) {
    return { cardId: block.id, pipelineId: card.pipelineId || null, runId: card.runId || null, projectKey: card.projectKey || null,
      workspaceId: card.workspaceId || null, title: card.title || '', label: card.label || '' };
  }
  return { cardId: block.id, pipelineId: null, runId: block.runId || null, projectKey: card.projectKey || null, workspaceId: card.workspaceId || null,
    title: card.title || card.brief || 'run', label: card.workspaceName || card.projectName || '' };
}

/** What every control and ctx call receives: the run as the snapshot knows it, the identity filling the gaps (a live
 *  snapshot has no projectKey; a REST one no runId). */
export function runRefOf(ident, snap) {
  const s = snap || {};
  const i = ident || {};
  return {
    runId: s.runId || i.runId || null,
    pipelineId: s.pipelineId || i.pipelineId || null,
    projectKey: s.projectKey || i.projectKey || null,
    workspaceId: s.workspaceId || i.workspaceId || null,
    projectDir: s.projectDir || '',
    title: s.title || i.title || '',
    branch: s.branch || '',
    status: s.status || '',
  };
}

/** The Auto chip — the run page's badge words (app.js paintAutoBadge): `Auto` while deciding, `Auto → <name>` after. */
export function autoChip(snap) {
  const auto = snap && snap.auto;
  if (!auto) return null;
  const name = (snap.stepper && snap.stepper.template && snap.stepper.template.name) || '';
  const decided = auto.status === 'decided' && !!name;
  return { text: decided ? `Auto → ${name}` : 'Auto', deciding: auto.status === 'deciding' };
}

const nodeLabelOf = (stepper, id) => {
  const n = manifestNodes(stepper).find((x) => x.id === id);
  return (n && (n.label || n.id)) || id;
};

/** The result headline for a run that is over (mockup §5e), from real facts only; null while the run is not over. */
export function resultWord(snap) {
  if (!snap || !RESULT_STATUS.has(String(snap.status || ''))) return null;
  if (snap.status === 'stopped') return { key: 'stopped', tone: 'red', glyph: 'stop', title: 'Stopped', sub: 'Stopped before it finished' };
  if (!DONE_STATUS.has(snap.status)) {
    const status = (snap.decor && snap.decor.status) || {};
    const failed = Object.keys(status).find((id) => status[id] === 'error');
    const step = failed ? nodeLabelOf(snap.stepper, failed) : '';
    return { key: 'failed', tone: 'red', glyph: 'stop', title: 'Failed', sub: step ? `Step: ${step} · see Logs for the error` : 'See Logs for the error' };
  }
  const pr = snap.pr && snap.pr.url ? String(snap.pr.state || '').toUpperCase() : '';
  if (pr === 'MERGED') return { key: 'merged', tone: 'violet', glyph: 'merged', title: 'Merged', sub: 'The pull request was merged' };
  if (pr === 'OPEN') return { key: 'review', tone: 'blue', glyph: 'review', title: 'In review', sub: 'The pull request is open' };
  if (pr === 'CLOSED') return { key: 'closed', tone: 'red', glyph: 'stop', title: 'PR closed', sub: 'Closed without merging' };
  const r = snap.results;
  if (r && !r.filesChanged) return { key: 'done', tone: 'green', glyph: 'check', title: 'Done', sub: 'No files changed' };
  // The run page's glance titles (run-glance.mjs `done`): "Ready to ship" only when the review flagged nothing,
  // "Ready to review" when it flagged something, "Finished" when the facts are not readable (no results.json, an
  // archived run). The sub-line keeps the Overview's verdict words.
  if (!r) return { key: 'ship', tone: 'green', glyph: 'check', title: 'Finished', sub: '' };
  const checks = Number(r.checks) || 0;
  return { key: 'ship', tone: 'green', glyph: 'ship', title: checks ? 'Ready to review' : 'Ready to ship',
    sub: checks ? `${checks} thing${checks === 1 ? '' : 's'} to check` : 'Clean — no blocking issues flagged' };
}

/** The receipt line a question collapses into once it is resolved (mockup §5c/§5d), from what this card sent. */
export function answerReceipt(sent, painted) {
  const step = (painted && (painted.step || painted.heading)) || '';
  const tail = (t) => (step ? `${t} · ${step}` : t);
  if (sent && sent.kind === 'gate') return sent.payload && sent.payload.decision === 'another' ? 'One more fix round · Cycle gate' : 'Continued · Cycle gate';
  if (sent && sent.payload && Array.isArray(sent.payload.answers)) {
    const n = sent.payload.answers.length;
    const k = sent.payload.answers.filter((a) => a && typeof a.choice === 'string' && a.choice.trim()).length;
    return tail(!k ? 'Sent without answers' : k === n ? `${n} answer${n === 1 ? '' : 's'} sent` : `${k} of ${n} answered`);
  }
  return tail(sent ? 'Answer sent' : 'Answered');
}

/** `prompt-…-cycle1.json`: keep both ends of a long file name. */
export function midTrunc(s, max = 28) {
  const t = String(s || '');
  if (t.length <= max) return t;
  const keep = max - 1;
  return `${t.slice(0, Math.ceil(keep / 2))}…${t.slice(t.length - Math.floor(keep / 2))}`;
}

const isWebUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

/**
 * @param {{doc: Document, win?: Window|null, snapshot?: object|null, ctx?: object, controls?: object, ident?: object, refresh?: (() => void)|null}} opts
 * @returns {{el: HTMLElement, parts: {graph: HTMLElement}, update(snap: object|null): void, relayout(width?: number): void, setReason(text: string): void, destroy(): void, snapshot: object|null}}
 */
export function createChatRunCard({ doc, win = null, snapshot = null, ctx = {}, controls = {}, ident = {}, refresh = null }) {
  void win;
  const h = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (cls, text) => { const b = h('button', cls, text); b.type = 'button'; return b; };
  const call = (fn, ...args) => (typeof fn === 'function' ? fn(...args) : undefined);
  const id = ident || {};

  const el = h('div', 'ask-card ask-rc chat-rc');
  el.dataset.cardId = id.cardId || '';
  // ---- head: kicker · status pill · Open run ›
  const head = h('div', 'ask-rc-head');
  const pill = h('span', 'ask-rc-pill st-peach');
  const pillText = h('span', 'ask-rc-pill-text', 'Starting');
  pill.append(h('span', 'ask-rc-dot'), pillText);
  const open = h('a', 'ask-rc-open', 'Open run');
  const chev = h('span', 'chat-rc-chev', ' ›');
  chev.setAttribute('aria-hidden', 'true');
  open.appendChild(chev);
  open.setAttribute('href', progressRoute(id, null));
  head.append(h('span', 'ask-rc-kicker', 'Pipeline run'), pill, h('span', 'ask-rc-spacer'), open);
  const title = h('div', 'ask-rc-title', id.title || 'Run');
  const sub = h('div', 'ask-rc-sub');
  const where = h('span', 'chat-rc-where');
  const autoEl = h('span', 'chat-rc-auto');
  autoEl.hidden = true;
  sub.append(where, autoEl);
  // ---- Shape it first: the approved plan this run was shaped into (snapshot.shaping)
  const shapedEl = h('div', 'chat-rc-shaped');
  shapedEl.hidden = true;
  // ---- stats
  const stats = h('div', 'ask-rc-stats');
  const stat = (label, cls) => { const box = h('div', 'ask-rc-stat'); const v = h('span', `ask-rc-stat-v ${cls}`); box.append(h('span', 'ask-rc-stat-k', label), v); stats.appendChild(box); return v; };
  const timeEl = stat('Elapsed', 'ask-rc-time mono');
  const costEl = stat('Cost', 'ask-rc-cost mono');
  const progEl = stat('Progress', 'ask-rc-prog mono');
  const agentsBox = h('div', 'ask-rc-active');
  agentsBox.hidden = true;
  agentsBox.setAttribute('role', 'group');
  agentsBox.setAttribute('aria-label', 'Active agents');
  // ---- the graph well (U9): a run-hosts `card` host inside a .run-flow-wrap, so the run monitor's status CSS applies
  const well = h('div', 'run-flow-wrap chat-rc-well');
  well.hidden = true;
  well.setAttribute('role', 'group');
  const graphHost = h('div', 'run-flow chat-rc-graph');
  const deciding = h('div', 'chat-rc-deciding', 'Auto is deciding the workflow');
  deciding.hidden = true;
  const expand = button('chat-rc-expand');
  expand.setAttribute('aria-label', 'Expand');
  expand.title = 'Expand';
  expand.appendChild(icon(doc, 'expand'));
  well.append(graphHost, deciding, expand);
  // ---- the run's pending question (R11): the run page's renderers, mounted by controls.paintQuestion
  const qSec = h('section', 'chat-rc-q');
  qSec.hidden = true;
  qSec.setAttribute('aria-label', 'Question');
  const qHead = h('div', 'chat-rc-q-head');
  const qBody = h('div', 'chat-rc-qbody');
  qBody.appendChild(h('div', 'qpanel hidden'));
  const qErr = h('div', 'chat-rc-q-err', 'Answer not sent');
  qErr.hidden = true;
  qErr.setAttribute('role', 'status');
  const receipt = h('details', 'chat-rc-receipt');
  receipt.hidden = true;
  const receiptSum = h('summary', null, '');
  const receiptList = h('ul', 'chat-rc-receipt-list');
  receipt.append(receiptSum, receiptList);
  // A receipt with no answer list has nothing to disclose: a press never toggles it, and it is no tab stop (showReceipt).
  receiptSum.addEventListener('click', (e) => { if (receiptList.hidden) e.preventDefault(); });
  qSec.append(qHead, qBody, qErr, receipt);
  // ---- the result (mockup §5e) and the failure reason
  const resultSec = h('section', 'chat-rc-result');
  resultSec.hidden = true;
  resultSec.setAttribute('aria-label', 'Result');
  const reason = h('div', 'ask-rc-reason');
  reason.hidden = true;
  // ---- run controls (live, parked or resumable runs)
  const foot = h('div', 'chat-rc-foot');
  foot.hidden = true;
  const pauseBtn = button('chat-rc-btn chat-rc-pause', 'Pause');
  const stopBtn = button('chat-rc-btn chat-rc-stop', 'Stop');
  stopBtn.title = 'Stop this pipeline';
  const footErr = h('span', 'chat-rc-err');
  footErr.hidden = true;
  footErr.setAttribute('role', 'status');
  foot.append(pauseBtn, stopBtn, footErr);
  el.append(head, title, sub, shapedEl, stats, agentsBox, well, qSec, resultSec, reason, foot);

  let last = null, graph = null, agentsSig = null, resultSig = '', painted = null, sent = null, inFlight = false, dead = false, pauseAsked = '';
  let shownFor = null;   // the question whose receipt shows the "Answered" fallback (its answer may still be in flight)
  const ref = () => runRefOf(id, last);
  /** The ref an artifact chip hands ctx.openArtifact: plus `nodeLabel(nodeId)` (the step label, from the snapshot's
   *  manifest) — P5's popup names the step with it when this tab holds no model of the run. */
  const artifactRef = () => {
    const stepper = last && last.stepper;
    return isGraphManifest(stepper) ? { ...ref(), nodeLabel: (nodeId) => nodeLabelOf(stepper, nodeId) } : ref();
  };

  open.addEventListener('click', (e) => { e.preventDefault(); call(ctx.openRunPanel, ref(), {}); });
  expand.addEventListener('click', () => call(ctx.openRunPanel, ref(), { tab: 'workflow' }));
  pauseBtn.addEventListener('click', (e) => {
    // One press per action: the same button flips in place (Resume → Pause once the resumed lineage runs, Pause →
    // Resume once the pause settles), so a double-click's second press (detail 2) would undo the first.
    if (pauseBtn.disabled || inFlight || (e && e.detail > 1)) return;
    footErr.hidden = true;
    inFlight = true;
    const resume = pauseBtn.dataset.action === 'resume';
    const asked = (last && last.runId) || '-';
    Promise.resolve(resume ? call(controls.resume, ref(), pauseBtn) : call(controls.pause, ref(), pauseBtn))
      .then((why) => {
        if (dead || resume) return;
        if (why) { footErr.textContent = `Could not pause: ${why}`; footErr.hidden = false; }
        else pauseAsked = asked;               // the run reads `running` until its pausing frame lands — keep Pause off
      })
      .catch(() => {})
      .finally(() => { inFlight = false; if (!dead) paintFoot(last); });
  });
  stopBtn.addEventListener('click', () => { footErr.hidden = true; call(controls.stop, ref(), () => call(refresh)); });
  qBody.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest(Q_BUTTONS);
    if (!b || !qBody.contains(b) || b.disabled || b.closest('.qpanel-workflow')) return;
    const pq = last && last.pendingQuestion;
    if (!pq || !painted) return;
    const cls = Object.keys(DECISIONS).find((c) => b.classList.contains(c));
    let payload = null;
    if (cls) payload = { decision: DECISIONS[cls] };
    else {
      const renderer = askRendererFor(askKindOf(pq)) || askRendererFor('clarify');
      payload = renderer ? renderer.collect(b.closest('.qpanel')) : null;
    }
    if (payload == null) return;             // the renderer refused and marked its own fields
    qErr.hidden = true;
    const attempt = { id: painted.id, kind: painted.kind, payload };
    Promise.resolve(call(controls.answer, ref(), painted.id, payload))
      .then((ok) => {
        if (dead) return;
        if (!ok) { qErr.hidden = false; return; }
        call(ctx.announce, 'Answer sent');
        // ui/server.mjs answerRun broadcasts question-resolved BEFORE /api/answer's 200, so the question may already
        // have collapsed into the "Answered" fallback: name what this card sent.
        if (shownFor && shownFor.id === attempt.id) { showReceipt(attempt, shownFor); shownFor = null; } else sent = attempt;
      })
      .catch(() => { if (!dead) qErr.hidden = false; });
  });

  // S9: ask-panel's renderTranscript (P1) re-appends this cached card after a replaceChildren() on every new row,
  // ask-start/-done and resync; moving the card drops the focus of the control the user is in (a half-typed answer, a
  // button they tabbed to) to <body>. Remember that control while it has the focus; once the card sits in its new row,
  // focus it again (a text field keeps its caret) — only when the focus fell to nothing. A press or a Tab elsewhere
  // ends the watch.
  let kept = null;                                   // { node, host } while a control in this card has the focus
  let keptMo = null;
  function keptStop() {
    kept = null;
    if (keptMo) { keptMo.disconnect(); keptMo = null; }
    doc.removeEventListener('pointerdown', keptPress, true);
  }
  function keptPress(e) { if (kept && !(e.target && kept.node.contains(e.target))) keptStop(); }
  function keptRestore() {
    const k = kept;
    if (!k || doc.activeElement === k.node || el.parentNode === k.host) return;   // still in it, or the card did not move
    const a = doc.activeElement;
    if (!k.node.isConnected || (a && a !== doc.body)) { keptStop(); return; }   // gone, or the focus went somewhere
    k.node.focus({ preventScroll: true });           // its focusin records the new row
    if (doc.activeElement !== k.node) keptStop();    // it cannot take the focus now (disabled while an answer is in flight)
  }
  el.addEventListener('focusin', (e) => {
    kept = { node: e.target, host: el.parentNode };
    const MO = doc.defaultView && doc.defaultView.MutationObserver;
    if (!keptMo && MO) {
      keptMo = new MO(keptRestore);
      keptMo.observe(doc, { childList: true, subtree: true });
      doc.addEventListener('pointerdown', keptPress, true);
    }
  });
  el.addEventListener('focusout', (e) => { if (e.relatedTarget && !el.contains(e.relatedTarget)) keptStop(); });

  function paintAgents(s) {
    const pq = s && s.pendingQuestion;
    const gate = s && s.decor && s.decor.gate ? s.decor.gate.nodeId : null;
    const waitingOn = (pq && pq.nodeId) || gate || null;
    const list = s && Array.isArray(s.active) ? s.active.slice() : [];
    if (waitingOn && !list.some((a) => a.nodeId === waitingOn)) list.unshift({ nodeId: waitingOn, label: nodeLabelOf(s.stepper, waitingOn), color: 'amber', modelLabel: '', cycle: 1 });
    const sig = list.map((a) => [a.nodeId, a.label, a.color, a.modelLabel || '', a.cycle || 1, a.nodeId === waitingOn ? 'w' : ''].join(':')).join(',');
    if (sig === agentsSig) return;
    agentsSig = sig;
    agentsBox.replaceChildren();
    agentsBox.hidden = !list.length;
    for (const a of list) {
      const waiting = a.nodeId === waitingOn;
      const chip = h('span', `ask-rc-agent chat-rc-agent${waiting ? ' is-waiting' : ''}`);
      chip.append(h('span', 'ask-rc-agent-dot'), h('span', 'chat-rc-agent-name', a.label || a.nodeId));
      // docs/ui-levels.md: the model is the run page's "model · effort pill" (Advanced); a cycle count is a loop badge (Expert).
      if (a.modelLabel) { const m = h('span', 'chat-rc-agent-model', a.modelLabel); m.dataset.minLevel = 'advanced'; m.title = a.modelLabel; chip.append(m); }
      if ((Number(a.cycle) || 1) > 1) { const c = h('span', 'chat-rc-agent-cycle', `cycle ${a.cycle}`); c.dataset.minLevel = 'expert'; chip.append(c); }
      chip.style.setProperty('--c', waiting ? 'var(--amber)' : NODE_COLORS.has(a.color) ? `var(--${a.color})` : 'var(--ink-3)');
      if (waiting) chip.title = 'Waiting for your answer';
      agentsBox.appendChild(chip);
    }
  }

  function focusQuestion() {
    if (qSec.hidden) return;
    const target = qSec.querySelector('button:not([disabled]), input, textarea, select');
    if (target && typeof target.focus === 'function') target.focus();
    if (typeof qSec.scrollIntoView === 'function') qSec.scrollIntoView({ block: 'nearest' });
  }

  function paintGraph(s, chip) {
    const isDeciding = !!(chip && chip.deciding);
    const stepper = s && s.stepper;
    const drawable = !isDeciding && isGraphManifest(stepper) && !!s.decor;
    if (!drawable && graph) { graph.destroy(); graph = null; }
    well.hidden = !drawable && !isDeciding;
    well.classList.toggle('is-deciding', isDeciding);
    deciding.hidden = !isDeciding;
    expand.hidden = !drawable;
    if (!drawable) {
      if (isDeciding) {
        // The run page's A24 words (app.js paintAutoDeciding): a run that waits on its proposal, is parked, or can never
        // decide again never reads "deciding".
        const st = String(s.status || '');
        const words = RESULT_STATUS.has(st) ? 'Auto did not decide a workflow'
          : st === 'paused' || st === 'interrupted' ? 'Paused before deciding'
            : s.pendingQuestion && s.pendingQuestion.kind === 'workflow' ? 'Waiting for your decision'
              : 'Auto is deciding the workflow';
        deciding.textContent = words;
        well.setAttribute('aria-label', words);
      }
      return;
    }
    if (!graph) graph = mountRunGraph(graphHost, { mode: 'card', doc, onGateClick: () => focusQuestion() });
    graph.update(s.pipelineId || s.runId || id.pipelineId || id.runId || 'run', stepper, s.decor);
    well.setAttribute('aria-label', `Workflow graph: ${manifestNodes(stepper).filter((n) => KEYED.has(n.kind)).map((n) => n.label || n.id).join(' → ')}`);
  }

  function showReceipt(mine, was) {
    receiptSum.textContent = answerReceipt(mine, was);
    receiptList.replaceChildren();
    const answers = mine && mine.payload && Array.isArray(mine.payload.answers) ? mine.payload.answers : [];
    for (const a of answers) {
      const choice = a && typeof a.choice === 'string' && a.choice.trim() ? a.choice.trim() : '—';
      receiptList.appendChild(h('li', null, `${(a && (a.question || a.id)) || ''} → ${choice}`));
    }
    receiptList.hidden = !answers.length;
    receiptSum.tabIndex = answers.length ? 0 : -1;
    receipt.hidden = false;
  }

  function paintQuestion(s) {
    const status = s ? String(s.status || '') : '';
    const pq = s && s.source === 'live' && !RESULT_STATUS.has(status) ? s.pendingQuestion : null;
    // Un-hide BEFORE the run page's renderer builds (paintRdQuestions' rule): a workflow body measures its graph host
    // the moment it attaches. The null path below hides both again.
    if (pq) { qBody.hidden = false; qSec.hidden = false; }
    const q = pq ? call(controls.paintQuestion, ref(), qBody) : null;
    if (q) {
      if (!painted || painted.id !== (q.id || null)) { qErr.hidden = true; sent = null; shownFor = null; }
      painted = { id: q.id || null, kind: q.kind || askKindOf(pq), heading: q.heading || '', step: q.step || '' };
      qHead.textContent = painted.heading;
      qHead.hidden = !painted.heading;
      qBody.hidden = false;
      receipt.hidden = true;
      qSec.hidden = false;
      return;
    }
    call(controls.releaseQuestion, qBody);
    qBody.hidden = true;
    qHead.hidden = true;
    qErr.hidden = true;
    if (painted) {
      const was = painted;
      const mine = sent && sent.id === was.id ? sent : null;
      painted = null;
      sent = null;
      // A question that went away because the run is pausing or paused, was interrupted, stopped or failed was not
      // answered: the "Answered" fallback shows only while the run is still going (answered elsewhere: the run page,
      // the panel) — ANSWERING_STATUS, never `pausing` (a pause resolves the question after its `pausing` frame).
      if (mine || ANSWERING_STATUS.has(status)) { showReceipt(mine, was); shownFor = mine ? null : was; }
      else receipt.hidden = true;
    }
    qSec.hidden = receipt.hidden;
  }

  function churnEl(r) {
    const n = Number(r.filesChanged) || 0;
    const box = h('span', 'chat-rc-res-churn');
    box.append(h('span', 'chat-rc-add', `+${Number(r.additions) || 0}`), doc.createTextNode(' '),
      h('span', 'chat-rc-del', `−${Number(r.deletions) || 0}`), doc.createTextNode(` · ${n} file${n === 1 ? '' : 's'} changed`));
    return box;
  }

  function paintResult(s) {
    const word = resultWord(s);
    if (!word) {
      if (!resultSec.hidden || resultSig) { resultSec.hidden = true; resultSec.replaceChildren(); resultSig = ''; }
      return;
    }
    const r = s.results || null;
    const arts = Array.isArray(s.artifacts) ? s.artifacts : [];
    const prUrl = s.pr && isWebUrl(s.pr.url) ? s.pr.url : '';
    const canCreate = word.key === 'ship' && !s.archived && !(s.pr && s.pr.url) && call(controls.prHost) !== false;
    const sig = JSON.stringify([word, r, arts.map((a) => a.relPath), !!s.moreArtifacts, prUrl, canCreate]);
    if (sig === resultSig) return;
    resultSig = sig;
    resultSec.replaceChildren();
    const rhead = h('div', 'chat-rc-res-head');
    const glyph = h('span', `chat-rc-res-glyph tone-${word.tone}`);
    glyph.appendChild(icon(doc, word.glyph));
    const text = h('div', 'chat-rc-res-text');
    text.appendChild(h('div', 'chat-rc-res-title', word.title));
    if (word.sub) text.appendChild(h('div', 'chat-rc-res-sub', word.sub));
    rhead.append(glyph, text);
    if (r && r.filesChanged) rhead.appendChild(churnEl(r));
    resultSec.appendChild(rhead);
    const top = r && Array.isArray(r.topFiles) ? r.topFiles : [];
    if (top.length) {
      const ul = h('ul', 'chat-rc-files');
      ul.setAttribute('aria-label', 'Top changed files');
      for (const f of top) {
        const b = button('chat-rc-file');
        const shown = f.projectKey ? `${f.projectKey}/${f.path}` : f.path;   // the Overview's workspace rule
        b.title = shown;
        b.appendChild(h('span', 'chat-rc-file-path', shown));
        if (!f.binary) b.append(h('span', 'chat-rc-add', `+${f.additions}`), h('span', 'chat-rc-del', `−${f.deletions}`));
        b.addEventListener('click', () => call(ctx.openRunPanel, ref(), { tab: 'diff' }));
        const li = h('li');
        li.appendChild(b);
        ul.appendChild(li);
      }
      resultSec.appendChild(ul);
    }
    if (arts.length) {
      const box = h('div', 'chat-rc-arts');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', 'Artifacts');
      box.dataset.minLevel = 'advanced';                // the run page's Artifacts tab level (docs/ui-levels.md)
      for (const a of arts) {
        const name = String(a.relPath || '').split(/[\\/]/).pop();
        const b = button('chat-rc-art', midTrunc(name));
        b.title = a.relPath;
        // P5's popup reads the step from ctx.nodeLabel(nodeId) when it holds no stepper for the run.
        b.addEventListener('click', () => call(ctx.openArtifact, artifactRef(), a));
        box.appendChild(b);
      }
      if (s.moreArtifacts) {
        const more = button('chat-rc-art is-more', 'All artifacts');
        more.addEventListener('click', () => call(ctx.openRunPanel, ref(), { tab: 'artifacts' }));
        box.appendChild(more);
      }
      resultSec.appendChild(box);
    }
    if (prUrl || canCreate) {
      const rfoot = h('div', 'chat-rc-res-foot');
      rfoot.dataset.minLevel = 'advanced';              // Create PR / View PR: the run page's level (docs/ui-levels.md)
      if (prUrl) {
        const a = h('a', 'chat-rc-view-pr', 'View pull request');
        a.setAttribute('href', prUrl);
        a.target = '_blank';
        a.rel = 'noopener';
        rfoot.appendChild(a);
      } else {
        const b = button('chat-rc-create-pr', 'Create pull request');
        const why = h('span', 'chat-rc-res-err');
        why.hidden = true;
        why.setAttribute('role', 'status');
        b.addEventListener('click', () => {
          if (b.disabled) return;
          b.disabled = true;
          why.hidden = true;
          // P2 openShipItFor: settles when the Ship it dialog closes ({opened, url?}), or at once with
          // {opened:false, error} when it cannot open — the reason stays in this card. Either way re-read the PR.
          Promise.resolve(call(controls.openShipIt, ref()))
            .then((res) => { if (!dead && res && res.opened === false && res.error) { why.textContent = String(res.error); why.hidden = false; } })
            .catch(() => {})
            .finally(() => { b.disabled = false; call(refresh); });
        });
        rfoot.append(why, b);
      }
      resultSec.appendChild(rfoot);
    }
    resultSec.hidden = false;
  }

  function paintFoot(s) {
    const status = s ? String(s.status || '') : '';
    const show = !!s && !RESULT_STATUS.has(status) && (CONTROL_STATUS.has(status) || !!s.pendingQuestion);
    foot.hidden = !show;
    if (!show) { footErr.hidden = true; return; }
    const resume = status === 'paused' || status === 'interrupted';
    // An accepted pause holds Pause off until the run leaves `running` (app.js paintRdPause / paintHdLive).
    if (pauseAsked && (status !== 'running' || (s.runId && pauseAsked !== '-' && s.runId !== pauseAsked))) pauseAsked = '';
    if (!inFlight) {
      pauseBtn.dataset.action = resume ? 'resume' : 'pause';
      pauseBtn.textContent = resume ? 'Resume' : status === 'pausing' || pauseAsked ? 'Pausing…' : 'Pause';
      pauseBtn.title = resume ? 'Resume — restart this paused pipeline where it left off' : 'Pause — gracefully stop the session so it can be resumed';
    }
    pauseBtn.disabled = inFlight || !!pauseAsked || (!resume && status !== 'running');
    // R7: an interrupted run is never stoppable. A run this tab holds no live model of (REST: a CLI run, another
    // worca's) is stoppable only while paused — /api/stop {pipelineId} stops this server's live run or a paused row.
    stopBtn.hidden = status === 'interrupted' || (s.source !== 'live' && status !== 'paused');
  }

  function update(snap) {
    if (dead) return;
    if (snap) last = snap;                           // D24: a null keeps the last paint
    const s = last;
    const p = runPill(s);
    const status = s ? String(s.status || '') : '';
    el.classList.toggle('is-live', !!s && !s.terminal && (LIVE_STATUS.has(status) || !!s.pendingQuestion));
    el.classList.toggle('is-terminal', RESULT_STATUS.has(status));
    el.classList.toggle('is-question', !!(s && s.pendingQuestion));
    el.dataset.runStatus = status;
    pill.className = `ask-rc-pill st-${p.family}`;
    pillText.textContent = p.text;
    if (s && s.title) title.textContent = s.title;
    const pid = (s && s.pipelineId) || id.pipelineId;
    where.textContent = [projectLabel(id, s), pid ? `#${pid}` : ''].filter(Boolean).join(' · ');
    const chip = autoChip(s);
    autoEl.hidden = !chip;
    autoEl.textContent = chip ? chip.text : '';
    timeEl.textContent = fmtDur(s ? s.elapsedMs : 0);
    costEl.textContent = s && s.costUsd == null ? 'cost unknown' : fmtUsd(s ? s.costUsd : 0);
    const prog = s && s.progress;
    progEl.textContent = prog && prog.total ? `${prog.done}/${prog.total} agents` : '—';
    open.setAttribute('href', progressRoute(id, s));
    const sh = s && s.shaping;
    if (sh && sh.approved && shapeFirstOn()) {
      const name = String(sh.approved.file || '').split(/[\\/]/).pop();
      shapedEl.replaceChildren(h('span', 'chat-rc-shaped-stages', 'Clarify ✓ · Plan ✓ · Refine ✓ while shaping'),
        h('span', 'chat-rc-shaped-plan', `Plan: ${name}`));
      if (sh.savedTo) {
        const open = button('chat-rc-shaped-open');
        open.textContent = 'Open';
        open.addEventListener('click', () => call(ctx.openArtifact, artifactRef(), { relPath: sh.approved.file, kind: 'plan' }));
        shapedEl.append(h('span', 'chat-rc-shaped-saved', `Saved to ${sh.savedTo}`), open);
      }
      shapedEl.hidden = false;
    } else shapedEl.hidden = true;
    paintAgents(s);
    paintGraph(s, chip);
    paintQuestion(s);
    paintResult(s);
    paintFoot(s);
  }

  function relayout() { if (graph) graph.repaint(); }

  function destroy() {
    dead = true;
    keptStop();
    if (graph) { graph.destroy(); graph = null; }
    call(controls.releaseQuestion, qBody);
  }

  update(snapshot);
  return {
    el,
    parts: { graph: well },                          // the chat's relayoutCards() measures parts.graph
    update,
    relayout,
    setReason(text) { reason.textContent = text || ''; reason.hidden = !text; },
    destroy,
    get snapshot() { return last; },
  };
}

// ---- the controller: what ask-panel's built-in progress cards owned (spec D1 store seam, D9 REST hydration, D11
// cadence), now for the chat run card. One per registration; every card it builds shares one store subscription
// and one tick. ----
export const PROGRESS_TICK_MS = 1000;
export const PROGRESS_REHYDRATE_MS = 30_000;
const PIPELINE_ID_RE = /^[0-9a-f]{8}$/;
/** The statuses whose results.json the run writes at its end (done always; stopped/error when something changed). */
const LATE_STATUS = new Set([...DONE_STATUS, 'stopped', 'error']);

/**
 * @param {{controls?: object, runStore?: object|null, now?: () => number, tickMs?: number, rehydrateMs?: number}} [opts]
 *   tickMs 0 = no interval (tests drive tick() by hand).
 */
export function createRunCardController({ controls = {}, runStore = null, now = () => Date.now(), tickMs = PROGRESS_TICK_MS, rehydrateMs = PROGRESS_REHYDRATE_MS } = {}) {
  const entries = new Map();     // block id -> { ident, ctx, card, rest, hydrating, nextHydrateAt, tried:Set }
  let timer = null, unsub = null, queued = false, dead = false;

  const storeOf = (entry) => runStore || (entry.ctx && entry.ctx.runStore) || null;
  const shown = (el) => !!el && el.isConnected && !(el.closest && el.closest('.hidden, [hidden]'));

  /** Fold the thread's run links into the identity (ask-panel refreshProgressIdent): the first `state` reveals the
   *  pipeline id; a resume moves the runId. Uses P1's card ctx runLinkFor (refreshProgressIdent's own lookup);
   *  a ctx without it (a test) leaves the run store alone to resolve the identity. */
  function refreshIdent(entry) {
    const fn = entry.ctx && entry.ctx.runLinkFor;
    if (typeof fn !== 'function') return;
    const link = fn({ cardId: entry.ident.cardId, pipelineId: entry.ident.pipelineId, runId: entry.ident.runId });
    if (!link) return;
    if (link.pipelineId) entry.ident.pipelineId = link.pipelineId;
    if (link.runId && !PIPELINE_ID_RE.test(link.runId)) entry.ident.runId = link.runId;   // a pipeline-id-keyed link has no live UUID
  }

  /** The snapshot a card paints: the live lineage from the store (the pipeline id is the stable key; byPipeline picks
   *  the live lineage when a superseded twin shares it), with the REST facts of a finished run merged in; else REST. */
  function resolve(entry) {
    refreshIdent(entry);
    const ident = entry.ident;
    const store = storeOf(entry);
    let snap = null;
    if (store) {
      if (ident.pipelineId && typeof store.byPipeline === 'function') snap = store.byPipeline(ident.pipelineId);
      if (!snap && ident.runId && typeof store.get === 'function') snap = store.get(ident.runId);
    }
    if (snap) {
      if (snap.pipelineId && !ident.pipelineId) ident.pipelineId = snap.pipelineId;
      if (snap.runId) ident.runId = snap.runId;
      const rest = entry.rest;
      if (rest && rest.pipelineId && rest.pipelineId === snap.pipelineId) {
        // Finished: the persisted state is the truth. After a reload this tab's model of the run is the hello stub
        // (status only, no steps: every node "skipped", 0/N agents, 0s), so the REST snapshot paints the card — when
        // it read THIS ending. A read taken before a resume (`interrupted` is terminal too) must never paint over the
        // new lineage's end: it would show Interrupted + Resume until the `done` re-read, and for good after a socket gap.
        if (snap.terminal && rest.terminal && rest.status === snap.status) return { ...rest, runId: snap.runId, branch: snap.branch || rest.branch };
        return { ...snap, results: rest.results, artifacts: rest.artifacts, moreArtifacts: rest.moreArtifacts, pr: rest.pr, branch: snap.branch || rest.branch };
      }
      return snap;
    }
    return entry.rest;
  }

  async function hydrate(entry) {
    const pid = entry.ident.pipelineId;
    const fetchFn = entry.ctx && entry.ctx.fetch;
    if (dead || entry.hydrating || !pid || typeof fetchFn !== 'function') return;
    entry.hydrating = true;
    try {
      const res = await fetchFn(`/api/ask/runs/${encodeURIComponent(pid)}`);
      if (res && res.ok) {
        const body = await res.json();
        // The envelope, not any 200: a stub that answers every URL must never paint a run.
        if (body && body.state && typeof body.state.status === 'string' && body.state.id === pid) {
          entry.rest = snapshotFromState(body.state, { now: now(), extras: body.extras || null });
          entry.tried.add(`${pid}:${entry.rest.status}`);
          if (body.live && body.live.runId) entry.ident.runId = body.live.runId;
        }
      }
    } catch { /* offline: the card keeps its last paint */ }
    entry.hydrating = false;
    entry.nextHydrateAt = now() + rehydrateMs;
    if (dead || entries.get(entry.ident.cardId) !== entry) return;
    entry.card.update(resolve(entry));
    if (entry.again) { entry.again = false; hydrate(entry); }   // a `done` frame landed while this read was in flight
  }

  function repaint(entry) {
    const snap = resolve(entry);
    entry.card.update(snap);
    // A finished run's result facts (results.json, artifacts, PR) are REST-only: read them once per terminal status.
    if (snap && snap.terminal && entry.ident.pipelineId) {
      const key = `${entry.ident.pipelineId}:${snap.status}`;
      if (!entry.tried.has(key)) { entry.tried.add(key); hydrate(entry); }
    }
  }

  /** The 1 s cadence: live cards get fresh elapsed + cost from the store; a run this tab gets no frames for is
   *  re-read every rehydrateMs. Cards that are not on screen (a hidden view) are skipped. */
  function tick() {
    if (dead) return;
    const t = now();
    for (const entry of entries.values()) {
      if (!shown(entry.card.el)) continue;
      const snap = resolve(entry);
      if (snap && snap.source === 'live' && !snap.terminal) { entry.card.update(snap); continue; }
      if (!entry.ident.pipelineId || t < entry.nextHydrateAt) continue;
      if (!(snap && snap.terminal)) { hydrate(entry); continue; }             // a run going on elsewhere
      // Finished, but its facts did not make it (a read that raced results.json, a `done` frame lost to a socket gap):
      // ONE more read — never a poll.
      const late = `${entry.ident.pipelineId}:late`;
      if (LATE_STATUS.has(String(snap.status || '')) && !snap.results && !entry.tried.has(late)) { entry.tried.add(late); hydrate(entry); }
    }
  }

  function wire(store) {
    if (!unsub && store && typeof store.subscribe === 'function') {
      unsub = store.subscribe((runId, type) => {
        if (dead || type === 'log' || !entries.size) return;
        // run-harness persists status 'done' (a `state` frame) BEFORE _buildResults writes results.json and indexes the
        // last artifacts, and emits `done` after: re-arm the one-shot REST read on the `done` frame.
        if (type === 'done') for (const e of entries.values()) if (e.ident.runId === runId) { e.tried.clear(); if (e.hydrating) e.again = true; }
        if (queued) return;
        queued = true;
        Promise.resolve().then(() => {
          queued = false;
          if (dead) return;
          for (const e of entries.values()) if (e.card.el.isConnected) repaint(e);
        });
      });
    }
    if (!timer && tickMs > 0) {
      timer = setInterval(tick, tickMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
    }
  }
  function idle() {
    if (timer) { clearInterval(timer); timer = null; }
    if (unsub) { unsub(); unsub = null; }
  }

  function build(block, ctx = {}) {
    const ident = progressIdent(block);
    const entry = { ident, ctx, card: null, rest: null, hydrating: false, nextHydrateAt: 0, tried: new Set() };
    // A card's own action (Stop of a saved paused run, Create PR) re-reads EVERY card of that run: a started proposal and
    // a track_run card can show the same run, and a run this tab holds no model of sends them no frame.
    entry.card = createChatRunCard({ doc: ctx.doc, win: ctx.win, snapshot: null, ctx, controls, ident,
      refresh: () => {
        for (const e of entries.values()) {
          if (e !== entry && !(entry.ident.pipelineId && e.ident.pipelineId === entry.ident.pipelineId)) continue;
          e.tried.clear(); e.nextHydrateAt = 0;
          if (e.hydrating) e.again = true;           // a read already out may predate this action: read once more after it
          hydrate(e);
        }
      } });
    if (block.state === 'failed' && block.error) entry.card.setReason(`Run failed: ${block.error}`);
    entries.set(block.id, entry);
    wire(storeOf(entry));
    repaint(entry);
    const snap = resolve(entry);
    if (!(snap && snap.source === 'live') && ident.pipelineId) hydrate(entry);
    return {
      el: entry.card.el,
      handle: { parts: entry.card.parts, relayout: (w) => entry.card.relayout(w) },
      dispose: () => {
        if (entries.get(block.id) === entry) entries.delete(block.id);
        entry.card.destroy();
        if (!entries.size) idle();
      },
    };
  }

  return {
    build,
    tick,
    get size() { return entries.size; },
    destroy() { dead = true; idle(); for (const e of entries.values()) e.card.destroy(); entries.clear(); },
  };
}

/** Register the chat run card as the chat's `progress` card (CONTRACT §2/§5). app.js calls this BEFORE createAskPanel. */
export function registerChatRunCard({ controls = {}, runStore = null, now, tickMs, rehydrateMs } = {}) {
  const ctl = createRunCardController({ controls, runStore, now, tickMs, rehydrateMs });
  registerChatCard(PROGRESS_CARD_TYPE, ctl.build);
  return ctl;
}
