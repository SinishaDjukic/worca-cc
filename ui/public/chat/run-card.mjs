// ui/public/chat/run-card.mjs — worca Chat P3: the live run card (CONTRACT §5).
//
// createChatRunCard is a STATELESS view over one run snapshot: app.js askRunSnapshot(r) (live, from the run model) or
// snapshotFromState(state, {extras}) over GET /api/ask/runs/:id (REST). The graph is the Workflows rendering (U9) in a
// run-hosts `card` well; the run's own question renders with the run page's renderers (R11); a finished run shows its
// result (R12). Every run action goes through `controls`, which app.js binds to its existing flows (pauseRun,
// resumeRunFromCard / resumePipeline, openStopModal, postAnswer, Ship-it) — this module never fetches.
// Pure DOM over an injected `doc`.
import { progressRoute, projectLabel, snapshotFromState, PROGRESS_CARD_TYPE } from '../ask-run-card.mjs';
import { registerChatCard } from './extensions.mjs';
import { planApprovedLine } from '../log-line.mjs';
import { mountRunGraph } from '../graph/run-hosts.mjs';
import { fmtDur, fmtUsd, isGraphManifest, manifestNodes } from '../graph/run-decor.mjs';
import { askKindOf } from '../ask/registry.mjs';
import { CREATE_PR_LABEL } from '../ship-words.mjs';
import { icon as uiIcon } from '../icons.mjs';
import { shapeFirstOn } from './shape-gate.mjs';
import { checklistScore } from '../../../src/shared/shape/review-checklist.mjs';
import { NO_PROJECT_KEY, NO_PROJECT_NAME } from '../../../src/shared/no-project.mjs';
import { changesCounts, folderDoneWords } from '../folder-changes.mjs';
import { isGitRun, isNoProjectRun, kindChip, workModeOf } from '../run-kind.mjs';
import { gitOn } from '../git-gate.mjs';
import { formatBytes } from '../artifacts/common.mjs';
import { fixOutcomeText } from './pr-watch-words.mjs';
import { runModel } from '../../../src/shared/run-model.mjs';
import { paintRunStatus, kindLabel, syncActions, pauseResumeOwn, renderMemberRows } from '../run-status-card.mjs';
import { delegateQuestion } from '../question-delegate.mjs';
import { paintStatusDot } from '../status-dot.mjs';
import { levelAtLeast } from '../ui-level.mjs';
import { featureCardModel, paintFeatureLog } from '../shape/feature-card.mjs';
import { namedAnswer, forgetAnswer } from '../shape/step-receipt.mjs';
import { renderChecklistGroups } from '../shape/checklist-view.mjs';
import { paintFeatureActions } from '../shape/feature-actions.mjs';
import { renderAskChanges } from './ask-changes.mjs';
import { roundsModel, liveRound } from './rounds.mjs';
import { flagOn } from '../flags.mjs';
import { labelChip } from '../label-picker.mjs';

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
const STOP_TITLE = 'Stop this run';
const SVG_NS = 'http://www.w3.org/2000/svg';
/** 24-unit stroked glyphs (module literals only — never run data). */
const ICONS = {
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  ship: '<path d="M12 3c3.2 2.2 5 5.6 5 9.6L14.8 16H9.2L7 12.6C7 8.6 8.8 5.2 12 3z"/><circle cx="12" cy="10" r="1.7"/><path d="M9.2 16L7 20M14.8 16L17 20M12 16v4"/>',
  review: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v7M18 15.5V10a3 3 0 0 0-3-3h-4"/><path d="M13 5l-2 2 2 2"/>',
  merged: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5V21M6 9a9 9 0 0 0 9 9h.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  stop: '<path d="M7 7l10 10M17 7L7 17"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 19h14"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
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
      workspaceId: card.workspaceId || null, title: card.title || '', label: card.label || '',
      // A PR fix run's card (ui/server.mjs askPrFixRun): what started it and, later, its outcome.
      ...(card.fix && typeof card.fix === 'object' ? { fix: card.fix } : {}) };
  }
  const none = card.target === 'none';   // P3: a No project proposal — the reserved key and its name until the first frame
  return { cardId: block.id, pipelineId: null, runId: block.runId || null, projectKey: none ? NO_PROJECT_KEY : (card.projectKey || null), workspaceId: card.workspaceId || null,
    title: card.title || card.brief || 'run', label: none ? NO_PROJECT_NAME : (card.workspaceName || card.projectName || '') };
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
  if (snap.workMode === 'folder') { const c = changesCounts(snap.changes); const w = folderDoneWords(snap.changes && snap.changes.state, c ? c.total : null); return { key: 'folder', tone: 'green', glyph: 'check', title: w.lead, sub: w.sub }; }
  const pr = snap.pr && snap.pr.url ? String(snap.pr.state || '').toUpperCase() : '';
  if (pr === 'MERGED') return { key: 'merged', tone: 'slate', glyph: 'merged', title: 'Merged', sub: 'The pull request was merged' };
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
    sub: checks ? `${checks} thing${checks === 1 ? '' : 's'} to check` : 'Clean: no blocking issues flagged' };
}

/** The receipt line a question collapses into once it is resolved (mockup §5c/§5d): the named decision this tab sent
 *  (`sent.named`, or step-receipt.mjs's note for `painted`'s run and id, shaper-cards D5), else what this card sent,
 *  else "Answered" (answered elsewhere, D6). */
export function answerReceipt(sent, painted) {
  const note = painted && painted.id ? namedAnswer(painted.runId, painted.id) : null;
  const named = (sent && sent.named) || (note && note.text);
  if (named) return named;
  const step = (painted && (painted.step || painted.heading)) || '';
  const tail = (t) => (step ? `${t} · ${step}` : t);
  if (sent && painted && painted.planAsk && sent.payload && sent.payload.decision === 'approve') return planApprovedLine(painted.roleReviews);
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
 * @returns {{el: HTMLElement, parts: {graph: HTMLElement}, update(snap: object|null): void, relayout(width?: number): void, setReason(text: string): void, reasonText: string, setFix(fix: object|null): void, destroy(): void, snapshot: object|null}}
 */
export function createChatRunCard({ doc, win = null, snapshot = null, ctx = {}, controls = {}, ident = {}, refresh = null }) {
  void win;
  const h = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (cls, text) => { const b = h('button', cls, text); b.type = 'button'; return b; };
  const link = (cls, href, text) => { const a = h('a', cls, text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
  const call = (fn, ...args) => (typeof fn === 'function' ? fn(...args) : undefined);
  const id = ident || {};

  const el = h('div', 'ask-card ask-rc chat-rc');
  el.dataset.cardId = id.cardId || '';
  // ---- head: dot · title · kind chip · Open › (runs redesign slice 4, D10); the status block sits under it
  const head = h('div', 'ask-rc-head');
  const headDot = h('span', 'status-dot');
  const title = h('div', 'ask-rc-title', id.title || 'Run');
  const kind = h('span', 'kind-chip', id.fix ? 'PR fix run' : 'Run');
  const open = h('a', 'ask-rc-open', 'Open');
  const chev = h('span', 'chat-rc-chev', ' ›');
  chev.setAttribute('aria-hidden', 'true');
  open.appendChild(chev);
  open.setAttribute('href', progressRoute(id, null));
  head.append(headDot, title, kind, h('span', 'ask-rc-spacer'), open);
  // NOT `status`: update() already has `const status` (the status string), which would shadow this element.
  const statusEl = h('div', 'chat-rc-status');
  // Run labels (slice 1): read-only chips under the status line.
  const labelsEl = h('div', 'chat-rc-labels');
  labelsEl.setAttribute('aria-label', 'Labels');
  let labelsSig = '';
  const membersEl = h('div', 'chat-rc-members');
  membersEl.hidden = true;
  const sub = h('div', 'ask-rc-sub');
  const where = h('span', 'chat-rc-where');
  const autoEl = h('span', 'chat-rc-auto');
  autoEl.hidden = true;
  sub.append(where, autoEl);
  // ---- a PR fix run (PR watch): what started it · the PR · the watcher's outcome
  const fixEl = h('div', 'chat-rc-fix');
  fixEl.hidden = true;
  // ---- Shape it first: the approved plan this run was shaped into (snapshot.shaping)
  const shapedEl = h('div', 'chat-rc-shaped');
  shapedEl.hidden = true;
  // ---- stats
  const stats = h('div', 'ask-rc-stats');
  const stat = (label, cls) => { const box = h('div', 'ask-rc-stat'); const v = h('span', `ask-rc-stat-v ${cls}`); box.append(h('span', 'ask-rc-stat-k', label), v); stats.appendChild(box); return v; };
  const timeEl = stat('Elapsed', 'ask-rc-time mono');
  const costEl = stat('Cost', 'ask-rc-cost mono');
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
  const qErr = h('div', 'chat-rc-q-err', 'Answer not sent. It is still in the form; check the connection and send it again.');
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
  // ---- the run's actions (the model's, D4): its own Pause / Stop keep their handlers, the rest are made here
  const foot = h('div', 'chat-rc-foot');
  foot.hidden = true;
  const footActions = h('div', 'chat-rc-actions');
  const pauseBtn = button('btn btn-sm chat-rc-pause', 'Pause');
  const stopBtn = button('btn btn-sm btn-danger chat-rc-stop', 'Stop');
  stopBtn.title = STOP_TITLE;
  const footErr = h('span', 'chat-rc-err');
  footErr.hidden = true;
  footErr.setAttribute('role', 'status');
  footActions.append(pauseBtn, stopBtn);
  // Shaper s3: the feature's extras beside the model's actions (feature-actions.mjs: Re-plan the rest, ⋯), D10.
  const fActions = h('div', 'chat-rc-factions');
  fActions.hidden = true;
  foot.append(footActions, fActions, footErr);
  // ---- Shaper s2: the feature card's step log (feature-card.mjs fills it; a plain run's rounds too, s5)
  const logEl = h('ol', 'chat-rc-log');
  logEl.hidden = true;
  logEl.setAttribute('aria-label', 'Steps');
  // ---- Shaper s5: the ideas saved for the next checkpoint (D11) and a watch that gave up on the run's PR (D23)
  const notesEl = h('div', 'chat-rc-notes');
  notesEl.hidden = true;
  const watchEl = h('div', 'chat-rc-watch');
  watchEl.hidden = true;
  watchEl.setAttribute('role', 'status');
  // ---- Shaper s5: Ask for changes on a finished run or feature (D5). Built once and kept across repaints (typed text
  // survives the 1 s repaint); paintResult re-appends it after the result region's rebuild.
  const changesSlot = h('div', 'chat-rc-changes');
  changesSlot.hidden = true;
  // Card order: the model's head / status / members, then Shaper's slots; the log sits before the open step.
  el.append(head, statusEl, labelsEl, sub, fixEl, shapedEl, membersEl, stats, agentsBox, well, logEl, notesEl, watchEl, qSec, resultSec, reason, foot);

  let last = null, graph = null, agentsSig = null, resultSig = '', painted = null, sent = null, inFlight = false, dead = false, pauseAsked = '';
  let shownFor = null;   // the question whose receipt shows the "Answered" fallback (its answer may still be in flight)
  let curRow = null;          // the group row while this card shows a group (D11)
  let createPrBtn = null;     // the result's "Create pull request" button while paintResult shows it (D4: it is `ship`)
  let viewPrLink = null;      // the result's View PR link while paintResult shows it (it is `open-pr` while the PR is open)
  let lastM = null;           // the model update() painted last, for the Pause click's repaint
  let fm = null;              // the feature card model of the last paint (null: a plain run, or Shape it first off)
  let roundRef = null;        // D25: set by update(): the live round's run ref, or null
  let changesView = null;     // Shaper's Ask for changes field ({ el, focus }) while it shows
  let planSent = null;   // slice 4: the plan card's last approve attempt, named by its `plan-answer` event (D12)
  const ref = () => runRefOf(id, last);
  /** D11: the run whose ask is the open step — the asking member's snapshot, else this card's run. */
  const stepSnap = (s) => (fm && fm.step && fm.step.snap) || s;
  const stepRef = () => (fm && fm.step && fm.step.pipelineId && fm.step.pipelineId !== ref().pipelineId
    ? { ...ref(), runId: fm.step.runId, pipelineId: fm.step.pipelineId, status: '' } : ref());
  const ownIsCurrent = () => !curRow || (!!last && ((last.runId && last.runId === curRow.runId) || (last.pipelineId && last.pipelineId === curRow.pipelineId)));
  /** The run the footer acts on: the card's own run, unless this card shows a group and is not the current member's
   *  own card. Then it is the current member, with its ticketId (Start now, Cancel) and status (Stop of a paused
   *  run); app.js runAction completes the rest from the History row (D5). */
  const target = () => {
    if (roundRef && !curRow) return roundRef;          // D25: while a later round is live, the footer acts on that round
    if (ownIsCurrent()) return ref();
    const all = [...(curRow.planning ? [curRow.planning] : []), ...(curRow.members || [])];
    const cur = all.find((mb) => mb.model === curRow.model.current) || null;
    return cur ? { runId: cur.runId || null, pipelineId: cur.pipelineId || null, ticketId: cur.ticketId || null,
      title: cur.title || '', status: (cur.run && cur.run.status) || '' } : ref();
  };
  /** The ref an artifact chip hands ctx.openArtifact: plus `nodeLabel(nodeId)` (the step label, from the snapshot's
   *  manifest) — P5's popup names the step with it when this tab holds no model of the run. */
  const artifactRef = () => {
    const stepper = last && last.stepper;
    return isGraphManifest(stepper) ? { ...ref(), nodeLabel: (nodeId) => nodeLabelOf(stepper, nodeId) } : ref();
  };

  function openPlan(c) {
    const file = last && last.shaping && last.shaping.approved && last.shaping.approved.file;
    if (file) return call(ctx.openArtifact, artifactRef(), { relPath: file, kind: 'plan' });
    // `shaping` lives only in a live snapshot: otherwise app.js finds the run's plan (its Artifacts tab is advanced-only).
    const planRef = { ...ref(), pipelineId: c.planPipelineId };
    if (typeof ctx.openPlan === 'function') return ctx.openPlan(planRef);
    return call(ctx.openRunPanel, planRef, { tab: 'artifacts' });
  }
  // Built once per card: paintFeatureActions keeps the handlers of its last rebuild. `act` reads `fm` when called.
  // No pause/stop: the model's footer owns Pause and Stop (D10).
  const featureDeps = {
    act: (action, body) => (fm && fm.controls && typeof controls.featureAct === 'function'
      ? controls.featureAct(fm.controls.featureId, action, body || {}) : Promise.resolve({ ok: false })),
    confirm: (o) => (typeof controls.confirm === 'function' ? controls.confirm(o) : Promise.resolve(true)),
    openPlan,
  };

  /** D7: a Watch PR fix-run card (#773) and an open shaping plan name themselves; everything else is kindLabel. */
  const kindOf = (row, s) => (id.fix ? 'PR fix run'
    : !row && shapeFirstOn() && s && s.shaping && !s.shaping.approved ? 'Shaping' : kindLabel(row));

  /** D6: runModel's input. The snapshot's own status and question win over the raw run's: they are what paintFoot /
   *  paintQuestion draw from, so the model and the own-button map never disagree. The PR too: resolve() merges the REST
   *  read's pr into the snapshot only, and a live run (makeRun) has none, so a finished run with an open PR would
   *  otherwise read Ready. runModel reads `round` ({n|round, request, by}) or `branch.roundOf` as "this run is round N",
   *  so a round's own card already words itself; a round-1 card whose later round is live is modelled on that round's
   *  run, with its `round`. */
  function modelInput(s, status, lr) {
    const base = s.run
      ? { ...s.run, status: s.status ? status : (s.run.status || ''), pendingQuestion: s.pendingQuestion ?? s.run.pendingQuestion ?? null,
        pr: s.pr || s.run.pr || null, watch: s.watch || s.run.watch || null }      // D24: round / branch ride on s.run
      : { status, pendingQuestion: s.pendingQuestion || null, pr: s.pr || null, watch: s.watch || null };
    // Projects, any way: a Folder run's changes and a run without a project word the finished line; with git missing on
    // this machine a git run shows no git chrome (never Ready to ship).
    const mode = isNoProjectRun(s) ? 'none' : workModeOf(s);
    if (mode !== 'git') Object.assign(base, { workMode: mode, ...(s.changes ? { changes: s.changes } : {}) });
    if (!gitOn(doc)) base.gitChrome = false;
    if (!lr) return base;
    const rs = lr.m;
    const run = rs ? { ...(rs.run || {}), status: String(rs.status || ''), pendingQuestion: rs.pendingQuestion ?? null }
      : { status: lr.r.status === 'starting' ? 'starting' : 'running' };
    return { ...run, pr: base.pr, watch: base.watch, round: { n: lr.r.round, request: lr.r.request || '', by: lr.r.by || null } };
  }

  // A group card's Open follows its #feature/… or #group/… href; a single run's card keeps opening the run panel.
  open.addEventListener('click', (e) => { if (curRow) return; e.preventDefault(); call(ctx.openRunPanel, ref(), {}); });
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
        if (why) { footErr.textContent = `Could not pause: ${String(why).replace(/\.+$/, '')}. Try again.`; footErr.hidden = false; }
        else pauseAsked = asked;               // the run reads `running` until its pausing frame lands — keep Pause off
      })
      .catch(() => {})
      .finally(() => { inFlight = false; if (!dead) { paintFoot(last); paintActions(lastM, last); } });
  });
  stopBtn.addEventListener('click', () => {
    footErr.hidden = true;
    // A card painted before its group was known still shows its own Stop: a run in a group stops with its group (D6).
    const row = typeof controls.groupOf === 'function' ? controls.groupOf(ref(), last) || null : null;
    if (row) call(controls.act, ref(), 'stop', stopBtn, lastM, row);
    else call(controls.stop, ref(), () => call(refresh));
  });
  qBody.addEventListener('plan-answer', (e) => {
    if (!painted) return;
    planSent = e.detail && e.detail.decision === 'approve' ? { id: painted.id, kind: painted.kind, payload: e.detail } : null;
  });
  delegateQuestion(qBody, {
    // D11: a pointer-only step (fm.step.snap null: the tab has no live snapshot of that member) still answers: its
    // id/kind come from the server's feature.ask, the same pq paintQuestion painted.
    question: () => (!painted ? null
      : fm && fm.step && !fm.step.snap ? { id: fm.step.id, kind: fm.step.kind }
      : (stepSnap(last) && stepSnap(last).pendingQuestion) || null),
    send: (payload) => {
      qErr.hidden = true;
      const attempt = { id: painted.id, kind: painted.kind, payload };
      // stepRef(): the run whose ask is the open step (a feature's asking member), else the card's own run.
      Promise.resolve(call(controls.answer, stepRef(), painted.id, payload))
        .then((ok) => {
          if (dead) return;
          if (!ok) { qErr.hidden = false; return; }
          call(ctx.announce, 'Answer sent');
          // ui/server.mjs answerRun broadcasts question-resolved BEFORE /api/answer's 200, so the question may already
          // have collapsed into the "Answered" fallback: name what this card sent.
          if (shownFor && shownFor.id === attempt.id) { showReceipt(attempt, shownFor); shownFor = null; } else sent = attempt;
        })
        .catch(() => { if (!dead) qErr.hidden = false; });
    },
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
    // D11: the Shaper open step wins over ownIsCurrent(): a feature card shows its asking member's step.
    if (!(fm && fm.step) && !ownIsCurrent()) {
      // A group card that is not the current member's own card draws no question (its Answer opens the member's
      // page). Release the panel without a receipt: nobody answered it.
      call(controls.releaseQuestion, qBody);
      painted = null; sent = null; planSent = null; shownFor = null;
      qBody.hidden = true; qHead.hidden = true; qErr.hidden = true; receipt.hidden = true; qSec.hidden = true;
      return;
    }
    const src = stepSnap(s);
    const status = src ? String(src.status || '') : '';
    // A feature card's open step may be a member this tab follows by pointer only (fm.step.snap null): chatPaintQuestion
    // resolves it, and answers null when there is nothing to paint.
    const pointer = !!(fm && fm.step && !fm.step.snap);
    const pq = pointer ? { id: fm.step.id, kind: fm.step.kind }
      : src && src.source === 'live' && !RESULT_STATUS.has(status) ? src.pendingQuestion : null;
    // Un-hide BEFORE the run page's renderer builds (paintRdQuestions' rule): a workflow body measures its graph host
    // the moment it attaches. The null path below hides both again.
    if (pq) { qBody.hidden = false; qSec.hidden = false; }
    const q = pq ? call(controls.paintQuestion, stepRef(), qBody) : null;
    if (q) {
      if (!painted || painted.id !== (q.id || null)) { qErr.hidden = true; sent = null; shownFor = null; planSent = null; }
      const planAsk = askKindOf(pq) === 'plan' && !!pq.plan && !pq.plan.outline;
      painted = { id: q.id || null, runId: stepRef().runId, kind: q.kind || askKindOf(pq), heading: q.heading || '', step: q.step || '',
        stepCard: !!q.stepCard, planAsk, roleReviews: planAsk ? pq.plan.roleReviews || null : null };
      qHead.textContent = painted.heading;
      qHead.hidden = !painted.heading || painted.stepCard;   // a step card's own head says it once (shaper-cards D16)
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
      // A step card posts through its own submit, never `sent`: the named note is what this tab sent (shaper-cards D5).
      // Read once, then forgotten: a later ask with the same id (a resume, another cycle) must not reuse it.
      const named = namedAnswer(was.runId, was.id);
      forgetAnswer(was.runId, was.id);
      const own = sent && sent.id === was.id ? sent : planSent && planSent.id === was.id ? planSent : null;
      const mine = named ? { ...(own || { id: was.id, kind: was.kind, payload: { answers: named.answers } }), named: named.text } : own;
      painted = null;
      sent = null;
      planSent = null;
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
      createPrBtn = null;
      viewPrLink = null;
      return;
    }
    const r = s.results || null;
    const arts = Array.isArray(s.artifacts) ? s.artifacts : [];
    const prUrl = s.pr && isWebUrl(s.pr.url) ? s.pr.url : '';
    const canCreate = word.key === 'ship' && isGitRun(s) && !s.archived && !(s.pr && s.pr.url) && call(controls.prHost) !== false;
    // P5: a workspace run applies each Folder member on its own (the run page's Changes); the card's Apply has no memberKey.
    const ws = s.kind === 'workspace-run' || !!s.workspaceId;
    const total = (changesCounts(s.changes) || {}).total || 0; const canApply = word.key === 'folder' && !ws && !s.archived && !!s.changes && s.changes.state === 'pending' && total > 0 && typeof controls.openApply === 'function';
    const np = isNoProjectRun(s);
    const sig = JSON.stringify([word, r, arts.map((a) => [a.relPath, a.bytes]), !!s.moreArtifacts, s.artifactsTotal, np, prUrl, canCreate, canApply, shapeFirstOn()]);
    if (sig === resultSig) return;
    resultSig = sig;
    createPrBtn = null;
    viewPrLink = null;
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
    // Spec D7 / s3: the shaped run's checklist score; pressing it unfolds the run page's Perspective checklists in place.
    const tally = r && r.checklist && r.checklist.total && shapeFirstOn() ? r.checklist : null;
    if (tally) {
      const row = h('div', `chat-rc-checklist${tally.unmet || tally.missing ? ' is-open' : ''}`);
      const b = button('chat-rc-checklist-btn');
      b.textContent = checklistScore(tally);
      b.setAttribute('aria-expanded', 'false');
      const groups = h('div', 'chat-rc-checklist-groups');
      groups.hidden = true;
      b.addEventListener('click', async () => {
        if (!groups.hidden) { groups.hidden = true; b.setAttribute('aria-expanded', 'false'); return; }
        if (!groups.firstChild) {
          const reviews = await Promise.resolve(call(ctx.checklists, ref())).catch(() => null);
          const cl = reviews ? renderChecklistGroups(doc, reviews) : null;
          if (!cl) { call(ctx.openRunPanel, ref(), { tab: 'overview' }); return; }
          groups.appendChild(cl);
        }
        groups.hidden = false;
        b.setAttribute('aria-expanded', 'true');
      });
      row.append(b, groups);
      resultSec.appendChild(row);
    }
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
        b.addEventListener('click', () => call(ctx.openRunPanel, ref(), { tab: word.key === 'folder' ? 'changes' : 'diff' }));
        const li = h('li');
        li.appendChild(b);
        ul.appendChild(li);
      }
      resultSec.appendChild(ul);
    }
    if (arts.length && np) {
      const box = h('section', 'chat-rc-arts-list');
      box.setAttribute('aria-label', 'Artifacts');
      box.appendChild(h('div', 'cap', `Artifacts · ${Number.isInteger(s.artifactsTotal) ? s.artifactsTotal : arts.length}`));
      const rows = h('div', 'chat-rc-art-rows');
      for (const a of arts) {
        const rel = String(a.relPath || '').replace(/^work\//, '');
        const cut = rel.lastIndexOf('/');
        const base = rel.slice(cut + 1);
        const row = h('div', 'chat-rc-art-row');
        const name = button('chat-rc-art-name');
        if (cut >= 0) name.appendChild(h('span', 'faint', rel.slice(0, cut + 1)));
        name.appendChild(doc.createTextNode(base));
        name.title = rel;
        name.addEventListener('click', () => call(ctx.openArtifact, artifactRef(), a));
        const dl = button('chat-rc-art-dl');
        dl.setAttribute('aria-label', `Download ${base}`);
        dl.appendChild(icon(doc, 'download'));
        dl.addEventListener('click', () => call(ctx.downloadArtifact, artifactRef(), a));
        row.append(icon(doc, 'file'), name, h('span', 'chat-rc-art-size', formatBytes(a.bytes)), dl);
        rows.appendChild(row);
      }
      box.appendChild(rows);
      if (s.moreArtifacts) {
        const more = button('chat-rc-art is-more', 'All artifacts');
        more.addEventListener('click', () => call(ctx.openRunPanel, ref(), { tab: 'artifacts' }));
        box.appendChild(more);
      }
      resultSec.appendChild(box);
    } else if (arts.length) {
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
        // PR controls (design system): View PR is a secondary small button, led by the PR's state glyph.
        const a = h('a', 'btn btn-sm chat-rc-view-pr');
        a.append(uiIcon(doc, word.key === 'merged' ? 'merge' : 'pull-request', 14), 'View PR');
        viewPrLink = a;
        a.setAttribute('href', prUrl);
        a.target = '_blank';
        a.rel = 'noopener';
        rfoot.appendChild(a);
      } else {
        const b = button('btn btn-sm btn-primary chat-rc-create-pr');
        b.append(uiIcon(doc, 'pr-create', 14), CREATE_PR_LABEL);
        createPrBtn = b;
        const why = h('span', 'chat-rc-res-err');
        why.hidden = true;
        why.setAttribute('role', 'status');
        b.addEventListener('click', () => {
          if (b.disabled) return;
          b.disabled = true;
          why.hidden = true;
          // P2 openShipItFor: settles when the Create PR dialog closes ({opened, url?}), or at once with
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
    if (canApply) { const f = h('div', 'chat-rc-res-foot'); const b = button('chat-rc-apply', 'Apply to folder'); let busy = false; b.addEventListener('click', () => { if (busy) return; busy = true; Promise.resolve(call(controls.openApply, ref(), b)).catch(() => {}).finally(() => { busy = false; call(refresh); }); }); f.appendChild(b); resultSec.appendChild(f); }
    resultSec.appendChild(changesSlot);
    resultSec.hidden = false;
  }

  /** Shaper s5 (D5): the Ask for changes field — a finished single-project run, or a feature that is ready to ship or
   *  shipped and not halted. The server mints the card from the ref (a feature's id, else the run's pipeline id). */
  function paintChanges(s, m, roundLive) {
    const feature = fm && fm.phase === 'feature' ? fm : null;
    // A feature reads the GROUP model's state; until groupOf knows the row, `m` is the planning run's model (done →
    // ready), so the field waits for curRow.
    const finished = feature ? !!curRow && ['ready', 'in-review', 'merged'].includes(m.state)
      : RESULT_STATUS.has(String((s && s.status) || ''));
    const show = !!s && !roundLive && finished && s.kind !== 'workspace-run' && shapeFirstOn() && typeof ctx.postChanges === 'function'
      && (feature ? !(feature.controls && feature.controls.halted) : !!s.pipelineId);
    changesSlot.hidden = !show;
    if (!show) { changesSlot.replaceChildren(); changesView = null; return; }
    if (changesView) return;                                   // keep the person's draft across repaints
    const to = feature ? { featureId: feature.controls.featureId } : { pipelineId: s.pipelineId };
    changesView = renderAskChanges(doc, { onSend: (text) => ctx.postChanges(to, text) });
    changesSlot.replaceChildren(changesView.el);
  }

  /** D8: the footer's Ask for changes (and the watch line's) focuses Shaper's field. */
  function askForChanges() {
    if (!changesView || changesSlot.hidden) return;
    if (typeof changesSlot.scrollIntoView === 'function') changesSlot.scrollIntoView({ block: 'nearest' });
    changesView.focus();                                       // renderAskChanges' own focus(): the .ask-changes-input field
  }

  /** D9: the Watch-stopped words once — the model's status line owns them; Shaper's line only fills a gap (a feature
   *  card, whose line is the group model's). `w` is already worded: roundsModel / featureCardModel give `{ text, prUrl }`. */
  function paintWatch(m, w) {
    const said = /Watch stopped/.test(m.line || '');
    watchEl.hidden = !w || !w.text || said;
    if (watchEl.hidden) { watchEl.replaceChildren(); delete watchEl.dataset.sig; return; }
    const withPr = isWebUrl(w.prUrl) && !m.actions.includes('open-pr');
    const withAsk = !m.actions.includes('ask-changes') && !!changesView;
    const sig = JSON.stringify([w.text, w.prUrl || null, withPr, withAsk]);
    if (watchEl.dataset.sig === sig) return;                 // the 1 s tick must not steal a link's focus
    watchEl.dataset.sig = sig;
    const extras = [];
    if (withPr) extras.push(link('chat-rc-watch-pr', w.prUrl, 'View PR'));
    if (withAsk) {
      const ask = button('btn btn-sm btn-quiet chat-rc-watch-ask', 'Ask for changes');
      ask.addEventListener('click', askForChanges);
      extras.push(ask);
    }
    watchEl.replaceChildren(h('span', 'chat-rc-watch-text', w.text), ...extras);
  }

  /** Labels and disabled rules of the own Pause / Stop; paintActions decides what shows (the model, D4). */
  function paintFoot(s) {
    const status = s ? String(s.status || '') : '';
    // R7: an interrupted run is never stoppable. A run this tab holds no live model of (REST: a CLI run, another
    // worca's) is stoppable only while paused — /api/stop {pipelineId} stops this server's live run or a paused row.
    const stopWhy = status === 'interrupted' ? 'An interrupted run cannot be stopped'
      : s && s.source !== 'live' && status !== 'paused' ? 'Open the run to stop it' : '';
    stopBtn.disabled = !!stopWhy;
    stopBtn.title = stopWhy || STOP_TITLE;
    const show = !!s && !RESULT_STATUS.has(status) && (CONTROL_STATUS.has(status) || !!s.pendingQuestion);
    if (!show) {
      footErr.hidden = true;
      // A card that went paused → stopped (resumable) must not keep its Resume: the model's `resume` gets a made button.
      delete pauseBtn.dataset.action;
      pauseBtn.disabled = false;
      return;
    }
    const resume = status === 'paused' || status === 'interrupted';
    // An accepted pause holds Pause off until the run leaves `running` (app.js paintRdPause / paintHdLive).
    if (pauseAsked && (status !== 'running' || (s.runId && pauseAsked !== '-' && s.runId !== pauseAsked))) pauseAsked = '';
    if (!inFlight) {
      pauseBtn.dataset.action = resume ? 'resume' : 'pause';
      pauseBtn.textContent = resume ? 'Resume' : status === 'pausing' || pauseAsked ? 'Pausing…' : 'Pause';
      pauseBtn.title = resume ? 'Resume: restart this paused pipeline where it left off' : 'Pause: gracefully stop the session so it can be resumed';
    }
    pauseBtn.disabled = inFlight || !!pauseAsked || (!resume && status !== 'running');
  }

  /** The footer's model actions (D4, D11); Shaper's feature extras beside them (D10); Ask for changes wired (D8). */
  function paintActions(m, s) {
    const st = s ? String(s.status || '') : '';
    // A Pause / Resume button stands for `pause` only while running, for `resume` only while parked; a stopped,
    // resumable run gets a made "Resume" (never the Pause-labelled button). A group card owns none of its own buttons:
    // their handlers act on the card's run, the footer acts on the current member. D25: with a live round the model's
    // own made Pause/Stop act through controls.act(target()) on the round's run; pauseBtn/stopBtn would act on ref().
    // pauseResumeOwn reads the label paintFoot just set (dataset.action), so the button is never owned against it.
    const own = curRow || roundRef ? {} : { ...pauseResumeOwn(pauseBtn, st), stop: stopBtn };
    pauseBtn.hidden = true;    // syncActions shows the owned ones again; an unowned own button stays hidden
    stopBtn.hidden = true;
    // contains(), not isConnected: a card that is not in the document yet still has it. Never on a group card (its
    // ship is the group's, D6), and only at Advanced and above: the button's row (.chat-rc-res-foot) is
    // data-min-level="advanced", so below that the footer makes its own Create PR.
    if (!curRow && createPrBtn && resultSec.contains(createPrBtn) && levelAtLeast('advanced', doc)) own.ship = createPrBtn;
    else if (createPrBtn) delete createPrBtn.dataset.modelAction;
    // The same for View PR while the model offers it (an open PR): one View PR on the card, not a second in the footer.
    if (!curRow && viewPrLink && resultSec.contains(viewPrLink) && levelAtLeast('advanced', doc) && ((m && m.actions) || []).includes('open-pr')) own['open-pr'] = viewPrLink;
    else if (viewPrLink) delete viewPrLink.dataset.modelAction;
    const changesWhy = changesView && !changesSlot.hidden ? ''
      : !shapeFirstOn() ? 'Turn on Shaper to ask for changes' : 'Ask for changes from the chat that started this run';
    // A group row goes along, so app.js hands the action to groupAction (D6, D11).
    syncActions(footActions, m, {
      own,
      disable: { ...(st === 'pausing' ? { resume: 'Pausing…' } : {}), ...(changesWhy ? { 'ask-changes': changesWhy } : {}) },
      onAction: (aid, b) => (aid === 'ask-changes' ? askForChanges() : call(controls.act, target(), aid, b, m, curRow)),
    });
    const fc = fm && fm.phase === 'feature' ? fm.controls : null;
    if (fc) paintFeatureActions(doc, fActions, fc, featureDeps, { omit: m.actions });
    // Clear the sig too: else the next feature paint's sig matches and returns early, leaving an empty host.
    else { fActions.replaceChildren(); fActions.hidden = true; delete fActions.dataset.sig; }
    // A footer with nothing visible stays hidden (a Ready run whose Create PR is the result's own button).
    foot.hidden = ![...footActions.children, ...fActions.children].some((b) => !b.hidden) && footErr.hidden;
  }

  function update(snap) {
    if (dead) return;
    if (snap) last = snap;                           // D24: a null keeps the last paint
    const s = last;
    const status = s ? String(s.status || '') : '';
    el.classList.toggle('is-live', !!s && !s.terminal && (LIVE_STATUS.has(status) || !!s.pendingQuestion));
    el.classList.toggle('is-terminal', RESULT_STATUS.has(status));
    el.classList.toggle('is-question', !!(s && s.pendingQuestion));
    el.dataset.runStatus = status;
    const pid = (s && s.pipelineId) || id.pipelineId || '';
    // Shaper's slots (feature model, rounds) only with Shape it first on (Ordinary stays ordinary).
    const on = shapeFirstOn();
    fm = s && s.shaper && on ? featureCardModel({ own: s, card: s.shaper.card, snapOf: (p) => (s.shaper.snaps && s.shaper.snaps[p]) || null }) : null;
    const roundSnap = (p) => (s && s.roundSnaps && s.roundSnaps[p]) || null;
    // s5 (D16): a plain run's rounds (the controller fills s.roundSnaps) fill the log; the live one feeds the model (D6).
    const rm = on ? roundsModel(s) : { log: [], watch: null };
    const lr = !fm && on && s ? liveRound(s, roundSnap) : null;
    roundRef = lr ? { runId: (lr.m && lr.m.runId) || null, pipelineId: lr.r.pipelineId || null, ticketId: null,
      title: (s && s.title) || '', status: String((lr.m && lr.m.status) || lr.r.status || '') } : null;
    curRow = typeof controls.groupOf === 'function' ? controls.groupOf(ref(), s) || null : null;
    const memo = typeof controls.memoFor === 'function' ? controls.memoFor((lr && lr.r.pipelineId) || pid || (s && s.runId) || '') : null;
    const opts = { memo, ...(typeof controls.modelOpts === 'function' ? controls.modelOpts() : {}) };   // tests pin now / timeZone
    // No snapshot yet (update(null) at build, before the REST read lands): an empty status reads `stopped` in the model,
    // with an Archive that works. Show Starting and no actions until the run is known.
    const m = curRow ? curRow.model : runModel(s ? modelInput(s, status, lr) : { status: 'starting' }, opts);
    lastM = s || curRow ? m : { ...m, actions: [] };
    paintStatusDot(headDot, m);
    paintRunStatus(statusEl, m);
    const labels = flagOn('runLabels', doc) && s && Array.isArray(s.labels) ? s.labels : [];   // the card's own document (jsdom tests)
    const sig = labels.join('\n');
    if (sig !== labelsSig) { labelsSig = sig; labelsEl.replaceChildren(...labels.map((l) => labelChip(doc, l))); }
    title.textContent = curRow ? curRow.title : (s && s.title) || id.title || 'Run';
    kind.textContent = kindOf(curRow, s);
    open.setAttribute('href', curRow ? (curRow.groupKind === 'feature' ? `#feature/${encodeURIComponent(curRow.groupId)}` : `#group/${encodeURIComponent(curRow.groupId)}`) : progressRoute(id, s));
    if (curRow) { membersEl.replaceChildren(renderMemberRows(doc, curRow)); membersEl.hidden = false; } else { membersEl.replaceChildren(); membersEl.hidden = true; }
    // Run 4 (D20): no id in visible text — the run id is the sub line's tooltip.
    if (isNoProjectRun(s)) where.replaceChildren(kindChip(doc, 'none'));
    else where.textContent = projectLabel(id, s);
    where.title = pid ? `Run ${pid}` : '';
    const chip = autoChip(s);
    autoEl.hidden = !chip;
    autoEl.textContent = chip ? chip.text : '';
    timeEl.textContent = fmtDur(s ? s.elapsedMs : 0);
    costEl.textContent = s && s.costUsd == null ? 'cost unknown' : fmtUsd(s ? s.costUsd : 0);
    const sh = s && s.shaping;
    if (!fm && sh && sh.approved && on) {           // D15: a feature card's step log says it
      const name = String(sh.approved.file || '').split(/[\\/]/).pop();
      shapedEl.replaceChildren(h('span', 'chat-rc-shaped-stages', 'Clarify ✓ · Plan ✓ · Refine ✓ while planning'),
        h('span', 'chat-rc-shaped-plan', `Plan: ${name}`));
      if (sh.savedTo) {
        const open = button('chat-rc-shaped-open');
        open.textContent = 'Open';
        open.addEventListener('click', () => call(ctx.openArtifact, artifactRef(), { relPath: sh.approved.file, kind: 'plan' }));
        shapedEl.append(h('span', 'chat-rc-shaped-saved', `Saved to ${sh.savedTo}`), open);
      }
      shapedEl.hidden = false;
    } else shapedEl.hidden = true;
    paintFeatureLog(doc, logEl, fm ? fm.log : rm.log);
    notesEl.textContent = (fm && fm.notesLine) || '';
    notesEl.hidden = !(fm && fm.notesLine);
    paintAgents(s);
    paintGraph(s, chip);
    paintQuestion(s);       // draws only when ownIsCurrent(), or the feature's open step
    paintResult(s);         // sets createPrBtn
    paintChanges(s, m, !!lr);
    paintWatch(m, (fm && fm.watch) || rm.watch);
    paintFoot(s);           // labels and disabled rules only
    paintActions(lastM, s); // last: the model decides what shows
  }

  function relayout() { if (graph) graph.repaint(); }

  function paintFix() {
    const f = id.fix && typeof id.fix === 'object' ? id.fix : null;
    if (!f) { fixEl.hidden = true; fixEl.replaceChildren(); return; }
    const parts = [h('span', 'chat-rc-fix-why', f.triggerLabel || 'Pull request feedback')];
    if (isWebUrl(f.prUrl)) {
      const a = h('a', 'chat-rc-fix-pr', `PR #${String(f.prUrl).replace(/\/+$/, '').split('/').pop()}`);
      a.href = f.prUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
      parts.push(h('span', 'chat-rc-fix-sep', '·'), a);
    }
    const out = fixOutcomeText(f.outcome);
    if (out) parts.push(h('span', 'chat-rc-fix-sep', '·'), h('span', `chat-rc-fix-out is-${out.tone}`, out.text));
    fixEl.replaceChildren(...parts);
    fixEl.hidden = false;
  }

  function destroy() {
    dead = true;
    keptStop();
    if (graph) { graph.destroy(); graph = null; }
    call(controls.releaseQuestion, qBody);
  }

  paintFix();
  update(snapshot);
  return {
    el,
    parts: { graph: well },                          // the chat's relayoutCards() measures parts.graph
    update,
    relayout,
    setReason(text) { reason.textContent = text || ''; reason.hidden = !text; },
    /** §5a.2: hydrate() reads the Loading / deleted / unreachable line back. */
    get reasonText() { return reason.textContent; },
    /** A PR fix-run card's `fix` changed (its outcome landed): repaint the line in place. */
    setFix(fix) { id.fix = fix && typeof fix === 'object' ? fix : null; paintFix(); },
    destroy,
    get snapshot() { return last; },
  };
}

// §5a.2: the card's first load, before anything has painted it.
const CARD_LOADING = 'Loading run…';
const CARD_DELETED = 'This run was deleted. The chat keeps what was said about it.';
const CARD_UNREACHABLE = "Could not load this run: Worca's server could not be reached. The card fills in when it is back.";

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
  function resolveRun(entry) {
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
        return { ...snap, results: rest.results, artifacts: rest.artifacts, moreArtifacts: rest.moreArtifacts, artifactsTotal: rest.artifactsTotal, pr: rest.pr, branch: snap.branch || rest.branch,
          rounds: rest.rounds, watch: rest.watch, labels: rest.labels ?? snap.labels,   // Shaper s5: the run's rounds and a stopped watch are REST facts
          ...(rest.workMode ? { workMode: rest.workMode, changes: rest.changes } : {}) };
      }
      return snap;
    }
    return entry.rest;
  }

  /** Shaper s2 (D12): a shaped run's card is the feature card. ctx.shaperCard(pid, onChange) answers app.js's cached
   *  GET /api/shape/pipelines/:pid/card (null while it loads, and for a plain run: 404); members' live snapshots come
   *  from the run store. state.shaping is memory-only (rowToState never reads it), so a REST or terminal snapshot
   *  asks too: a finished planning run, after a reload or a restart, is still its feature's card. */
  function withShaper(entry, snap) {
    const fn = entry.ctx && entry.ctx.shaperCard;
    const pid = (snap && snap.pipelineId) || entry.ident.pipelineId;
    if (!snap || !pid || typeof fn !== 'function' || !shapeFirstOn()) return snap;
    if (!snap.shaping && snap.source === 'live' && !snap.terminal) return snap;   // live and running: shaping would be on it
    const card = fn(pid, entry.onShaper);
    if (!card) return snap;
    const store = storeOf(entry);
    const snaps = {};
    // s3 (D16): while re-planning, the Re-plan the rest run's snapshot too (its Split ask is the card's open step).
    const rpPid = card.feature && card.feature.status === 'replanning' && card.feature.replan ? card.feature.replan.pipelineId : null;
    // s5 (D16): each slice's rounds too — a live round is what the feature card is doing now.
    const slices = (card.feature && card.feature.slices) || [];
    const roundPids = slices.flatMap((s) => (s.rounds || []).map((r) => r && r.pipelineId));
    for (const p of [...slices.map((s) => s.pipelineId), ...roundPids, rpPid]) {
      if (!p || p === pid) continue;
      const m = store && typeof store.byPipeline === 'function' ? store.byPipeline(p) : null;
      if (m) snaps[p] = m;
    }
    return { ...snap, shaper: { card, snaps } };
  }
  /** Shaper s5 (D16): a plain run's rounds paint from their own live snapshots (the card never reads a run store). */
  function withRounds(entry, snap) {
    const list = snap && Array.isArray(snap.rounds) ? snap.rounds : [];
    if (!list.length) return snap;
    const store = storeOf(entry);
    const roundSnaps = {};
    for (const r of list) {
      const m = r && r.pipelineId && store && typeof store.byPipeline === 'function' ? store.byPipeline(r.pipelineId) : null;
      if (m) roundSnaps[r.pipelineId] = m;
    }
    return { ...snap, roundSnaps };
  }
  const resolve = (entry) => withShaper(entry, withRounds(entry, resolveRun(entry)));


  async function hydrate(entry) {
    const pid = entry.ident.pipelineId;
    const fetchFn = entry.ctx && entry.ctx.fetch;
    if (dead || entry.hydrating || !pid || typeof fetchFn !== 'function') return;
    entry.hydrating = true;
    const painted = () => !!(entry.rest || entry.card.snapshot);
    if (!painted()) entry.card.setReason(CARD_LOADING);
    let miss = '';                                       // '' | CARD_DELETED | CARD_UNREACHABLE
    try {
      const res = await fetchFn(`/api/ask/runs/${encodeURIComponent(pid)}`);
      if (res && res.status === 404) miss = CARD_DELETED;
      else if (res && res.ok) {
        const body = await res.json();
        // The envelope, not any 200: a stub that answers every URL must never paint a run.
        if (body && body.state && typeof body.state.status === 'string' && body.state.id === pid) {
          entry.rest = snapshotFromState(body.state, { now: now(), extras: body.extras || null });
          entry.tried.add(`${pid}:${entry.rest.status}`);
          if (body.live && body.live.runId) entry.ident.runId = body.live.runId;
        }
      }
    } catch { miss = CARD_UNREACHABLE; }                 // after a paint it keeps the paint (D24)
    entry.hydrating = false;
    entry.nextHydrateAt = now() + rehydrateMs;
    if (dead || entries.get(entry.ident.cardId) !== entry) return;
    entry.card.update(resolve(entry));
    // §5a.2: decided after the update (the store may have painted it), and only this function's own three lines are
    // touched, so "Run failed: …" (set by the feed) is never wiped.
    const mine = [CARD_LOADING, CARD_DELETED, CARD_UNREACHABLE].includes(entry.card.reasonText);
    if (painted()) { if (mine) entry.card.setReason(''); }
    else if (miss) entry.card.setReason(miss);
    else if (mine) entry.card.setReason('');
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
        // P3: a run without a project indexes its work/ files at teardown, AFTER `done`: each `artifact` frame of such a
        // finished run re-arms the read too (single-flight: a frame landing mid-read reads once more when it settles).
        if (type === 'artifact') for (const e of entries.values()) {
          if (e.ident.runId !== runId) continue;
          const s = resolve(e);
          if (s && s.terminal && isNoProjectRun(s)) { e.tried.clear(); if (e.hydrating) e.again = true; }
        }
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
    entry.onShaper = () => { if (!dead && entries.get(block.id) === entry) repaint(entry); };
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
      handle: { parts: entry.card.parts, relayout: (w) => entry.card.relayout(w),
        // The panel hands a same-state payload change here (buildCard): a PR fix-run card's outcome and its fix run's
        // pipeline id land on the block once the watcher is done with the run (ui/server.mjs askSettlePrFixCards).
        blockChanged: (next) => {
          const fresh = progressIdent(next);
          if (fresh.pipelineId && !entry.ident.pipelineId) entry.ident.pipelineId = fresh.pipelineId;
          entry.card.setFix(fresh.fix || null);
          repaint(entry);
        } },
      dispose: () => {
        if (entries.get(block.id) === entry) entries.delete(block.id);
        entry.card.destroy();
        if (!entries.size) idle();
      },
    };
  }

  /** Shaper s5: a round of pipeline `pid` changed (app.js `round-changed`, `pr-watch-changed`): re-read its cards. A
   *  finished card reads REST once per terminal status, so without this a new round would never show on it. */
  function refreshPipeline(pid) {
    if (!pid || dead) return;
    for (const e of entries.values()) {
      if (e.ident.pipelineId !== pid) continue;
      for (const k of [...e.tried]) if (k.startsWith(`${pid}:`)) e.tried.delete(k);
      e.nextHydrateAt = 0;
      if (e.hydrating) e.again = true;
      hydrate(e);
    }
  }

  return {
    build,
    tick,
    refreshPipeline,
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
