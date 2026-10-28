// src/shared/run-progress.mjs
// Run progress (spec 2026-10-14 "Run progress: one bar for every run"). ONE pure function
// turns a run's state into the bar the run page, the Runs list and the Chat run card paint.
// The state is the SAME shape live (app.js run model) and frozen (artifacts rowToState):
//   { stepper, steps, active, status, endReached, pendingQuestion, tokens, progressFacts }.
// It moves on real sub-steps only (finished agents, finished tasks, review passes), never on
// time (P2), and never backwards (P3): the stage is the highest one the LEDGER has reached, and
// the caller's memo keeps the maximum fill across frames. Supersedes node-graph v2 D15 (P12).
import { BOOKEND_EXECUTION_IDS, KEYED_KINDS } from './graph/constants.mjs';
import { PROGRESS_STAGES } from './graph/agent-meta.mjs';

export { PROGRESS_STAGES };
export const STAGE_LABEL = Object.freeze({ plan: 'Plan', build: 'Build', review: 'Review', ready: 'Ready' });
/** Each review pass adds this share of the Review quarter (P2)… */
export const REVIEW_STEP = 0.25;
/** …capped below the quarter's end until the review passes. */
export const REVIEW_CAP = 0.8;
/** A begun stage shows this share of its quarter before anything in it finishes (spec §2.3). */
export const START_SHARE = 0.1;

const ORDER = Object.freeze([...PROGRESS_STAGES, 'ready']);
const BOOKENDS = new Set(BOOKEND_EXECUTION_IDS);
const TERMINAL_ROW = new Set(['done', 'error', 'stopped', 'paused']);
const PARKED = new Set(['paused', 'pausing', 'interrupted']);

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
/** A timestamp as epoch ms: numbers pass through (token `firedAt`), strings are parsed (row `startedAt`). NaN if neither. */
const msOf = (v) => (typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const labelOf = (n) => String(n.label || n.key || n.id);
const sameWord = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** "1st", "2nd", "3rd", "11th". */
export function ordinal(n) {
  const v = Math.abs(Math.trunc(n)) % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[v % 10] || 'th'}`;
}

/** A 0..1 fill as a CSS width ("37.50%"). The width is never shown as text (Success 5). */
export function progressWidth(f) {
  return `${(clamp01(f) * 100).toFixed(2)}%`;
}

/** The P4 tone. This mirrors app.js runStatusMeta's family order EXACTLY; a test pins the two together. */
export function progressTone(st) {
  const s = String((st && st.status) || '');
  if (PARKED.has(s)) return 'amber';
  if (st && st.pendingQuestion != null) return 'amber';
  if (s === 'done') return 'green';
  if (s === 'stopped' || s === 'error') return 'red';
  return 'blue';
}

/** What a waiting question asks for: the tail of "needs you · …" (P5, D33). */
export function askWhat(pq) {
  if (!pq) return '';
  if (pq.kind === 'workflow') return 'review the workflow';
  if (pq.kind === 'gate') return 'a decision';
  if (pq.kind === 'form') return 'input needed';
  if (pq.kind === 'recovery') return 'a step failed';
  // Shaper's plan ask (PLAN_ASK_KIND, src/core/shape/run.mjs — shared/ cannot import core). The slice outline is the
  // same kind with `plan.outline` set (orchestrator's outline ask; app.js askHeading tells them apart the same way).
  if (pq.kind === 'plan') {
    const p = pq.plan || {};
    return p.outline || p.port === 'outline' ? 'approve the slices' : 'approve the plan';
  }
  const n = Array.isArray(pq.questions) ? pq.questions.length : 0;
  return n ? `answer ${plural(n, 'question')}` : 'answer a question';
}

function graphNodes(st) {
  const m = st && st.stepper;
  return m && m.version === 2 && m.graph && Array.isArray(m.graph.nodes) ? m.graph.nodes.filter(Boolean) : [];
}
function graphWires(st) {
  const m = st && st.stepper;
  return m && m.graph && Array.isArray(m.graph.wires) ? m.graph.wires.filter(Boolean) : [];
}
/** Execution rows, bookends dropped (run-decor ledgerRows' rule, restated: shared code cannot import ui/). */
function ledger(st) {
  return (Array.isArray(st && st.steps) ? st.steps : [])
    .filter((r) => r && r.executionId && r.nodeId != null && !BOOKENDS.has(r.executionId));
}
/** Node ids in flight. An `active` entry whose own row is already terminal is dropped (run-decor's rule). */
function activeIds(st, rows) {
  const own = new Map(rows.map((r) => [r.executionId, r]));
  const ids = new Set();
  for (const a of Array.isArray(st && st.active) ? st.active : []) {
    if (!a || a.nodeId == null) continue;
    const row = own.get(a.executionId);
    if (row && TERMINAL_ROW.has(row.status)) continue;
    ids.add(a.nodeId);
  }
  return ids;
}

/** Finished tasks out of the decomposition's tasks across `buildIds`. The engine's
 *  progressFacts carry the whole size; without them (a resumed or frozen state) every
 *  phase seen so far counts at its own size. Re-run slices count once per task. */
function taskCounts(rows, buildIds, facts) {
  const slices = rows.filter((r) => r.kind === 'task' && buildIds.has(r.nodeId));
  const done = new Set(slices.filter((r) => r.status === 'done')
    .map((r) => `${r.nodeId}|${r.phaseOrdinal ?? ''}|${r.taskId ?? r.executionId}`)).size;
  const known = Object.entries((facts && facts.tasks) || {})
    .filter(([id]) => buildIds.has(id)).reduce((n, [, v]) => n + (Number(v) || 0), 0);
  const perPhase = new Map();
  for (const r of slices) perPhase.set(`${r.nodeId}|${r.phaseOrdinal ?? ''}`, Number(r.taskTotal) || 0);
  const seen = [...perPhase.values()].reduce((a, b) => a + b, 0);
  const total = Math.max(known, seen, done);
  return { done: Math.min(done, total), total };
}

/**
 * The run's progress.
 * @param {object} st    the run state (see the header)
 * @param {{fraction?:number, stage?:number}|null} memo  the caller's monotonic memory, MUTATED (P3)
 * @returns {{ mode:'stages'|'nodes', stage:'plan'|'build'|'review'|'ready'|null, label:string,
 *   fraction:number, text:string, step:string, what:string, fill:number[], tone:'blue'|'amber'|'green'|'red',
 *   stages:Array<{id:string,label:string,state:'done'|'current'|'waiting'|'skipped',agents:Array<{label:string,state:'done'|'current'|'waiting'}>}>,
 *   passes:number, tasks:{done:number,total:number}|null }}
 */
export function runProgress(st, memo = null) {
  const state = st || {};
  const nodes = graphNodes(state);
  const rows = ledger(state);
  const status = String(state.status || '');
  const tone = progressTone(state);
  const ready = status === 'done' && state.endReached === true;
  const active = activeIds(state, rows);
  const facts = state.progressFacts && typeof state.progressFacts === 'object' ? state.progressFacts : {};
  const byNode = new Map();
  for (const r of rows) {
    if (!byNode.has(r.nodeId)) byNode.set(r.nodeId, []);
    byNode.get(r.nodeId).push(r);
  }
  const started = (n) => byNode.has(n.id) || active.has(n.id);
  // Ever finished: a top-level row done, or (a composite parent has no row of its own) every slice done.
  const everDone = (n) => {
    const list = byNode.get(n.id) || [];
    if (list.some((r) => r.kind !== 'task' && r.status === 'done')) return true;
    const slices = list.filter((r) => r.kind === 'task');
    return slices.length > 0 && !active.has(n.id) && slices.every((r) => r.status === 'done');
  };
  const pq = state.pendingQuestion != null ? state.pendingQuestion : null;
  // `resumePending`: the browser's own flag while a Resume request is in flight (the server has not answered yet).
  const parkedWord = status === 'pausing' ? 'pausing' : !PARKED.has(status) ? '' : state.resumePending ? 'resuming' : 'paused';
  const remember = (fraction, stageIdx) => {
    if (!memo) return { fraction, stageIdx };
    memo.fraction = Math.max(Number(memo.fraction) || 0, fraction);
    memo.stage = Math.max(Number(memo.stage) || 0, stageIdx);
    return { fraction: memo.fraction, stageIdx: memo.stage };
  };

  // The P5 tail for a waiting, parked or ended run; '' while it works.
  const waitWhat = () => {
    if (pq && !['done', 'stopped', 'error'].includes(status)) return `needs you · ${askWhat(pq)}`;
    if (parkedWord) return parkedWord;
    if (status === 'stopped') return 'stopped';
    if (status === 'error') return 'failed';
    return '';
  };

  // ── Auto before its decision: the manifest is an EMPTY graph tagged `deciding`
  //    (orchestrator _autoBootstrapTopology). Choosing the workflow IS planning (P1/P5),
  //    so it reads "Plan · …" with the stage marks, never the markless P6 bar. ──
  if (!nodes.length && state.stepper && state.stepper.auto && state.stepper.auto.status === 'deciding') {
    const { fraction } = remember(0, 0);
    const what = waitWhat() || 'choosing the workflow';
    return { mode: 'stages', stage: 'plan', label: STAGE_LABEL.plan, fraction,
      text: `${STAGE_LABEL.plan} · ${what}`, step: '', what, fill: [0, 0, 0, 0], tone,
      stages: [...PROGRESS_STAGES, 'ready'].map((s) => ({ id: s, label: STAGE_LABEL[s], state: s === 'plan' ? 'current' : 'waiting', agents: [] })),
      passes: 0, tasks: null };
  }

  const staged = nodes.filter((n) => n.kind === 'agent' && PROGRESS_STAGES.includes(n.progressStage));

  // ── P6: no stage fits — finished nodes out of all nodes, the text is the current node ──
  if (!staged.length) {
    const keyed = nodes.filter((n) => KEYED_KINDS.includes(n.kind));
    const raw = ready ? 1 : keyed.length ? keyed.filter(everDone).length / keyed.length : 0;
    const { fraction } = remember(raw, 0);
    const now = keyed.filter((n) => active.has(n.id)).map(labelOf);
    let text;
    if (pq && !['done', 'stopped', 'error'].includes(status)) text = `Needs you · ${askWhat(pq)}`;
    else if (parkedWord) text = parkedWord[0].toUpperCase() + parkedWord.slice(1);
    else if (status === 'stopped') text = 'Stopped';
    else if (status === 'error') text = 'Failed';
    else if (status === 'done') text = 'Finished';
    else if (now.length > 1) text = `${now.length} steps`;
    else if (now.length === 1) text = now[0];
    else text = rows.length ? '' : 'Starting';
    return { mode: 'nodes', stage: null, label: '', fraction, text, step: now.length === 1 ? now[0] : '', what: text,
      fill: [fraction], tone, stages: [], passes: 0, tasks: null };
  }

  // ── stages (P1/P2) ──
  const inStage = Object.fromEntries(PROGRESS_STAGES.map((s) => [s, staged.filter((n) => n.progressStage === s)]));
  const ids = Object.fromEntries(PROGRESS_STAGES.map((s) => [s, new Set(inStage[s].map((n) => n.id))]));
  const stagedIds = new Set(staged.map((n) => n.id));
  const present = PROGRESS_STAGES.filter((s) => inStage[s].length);
  const begun = (s) => inStage[s].some(started);

  // Review passes: the highest cycle any review agent has STARTED (an in-flight one counts).
  const reviewRows = inStage.review.flatMap((n) => (byNode.get(n.id) || []).filter((r) => r.kind !== 'task'));
  // The scheduler lists the next pass in `active` ("x:<node>:<ordinal>") a beat before its ledger row is written.
  const activeOrdinals = (Array.isArray(state.active) ? state.active : [])
    .filter((a) => a && ids.review.has(a.nodeId) && active.has(a.nodeId))
    .map((a) => Number(String(a.executionId || '').split(':')[2]) || 1);
  const passes = Math.max(reviewRows.reduce((m, r) => Math.max(m, Number(r.ordinal ?? r.cycle) || 1), 0),
    inStage.review.some((n) => active.has(n.id)) ? 1 : 0, ...activeOrdinals);
  const reviewFacts = (facts && facts.reviews) || {};
  // The issues the work was just sent back with: only the newest pass's facts count. A review
  // agent that has not re-run since keeps an older fact; adding it would count issues already fixed.
  const reviewFactList = inStage.review.map((x) => reviewFacts[x.id]).filter(Boolean);
  const newestPass = reviewFactList.reduce((m, f) => Math.max(m, Number(f.pass) || 0), 0);
  const blockingNow = reviewFactList.filter((f) => (Number(f.pass) || 0) === newestPass)
    .reduce((n, f) => n + (Number(f.blocking) || 0), 0);
  // A review agent's latest pass was blocking: the engine's fact first, else its latched
  // `when:'blocking'` output token fired during that pass (frozen/resumed states). Tokens are
  // latched and never cleared, so only a token fired AT OR AFTER the pass's start counts.
  // The scheduler stamps `firedAt` as epoch ms (Date.now()); rows stamp `startedAt` as ISO.
  const lastBlocked = (n, last) => {
    const f = reviewFacts[n.id];
    if (f && Number(f.pass) === Number(last.ordinal ?? last.cycle ?? 1)) return Number(f.blocking) > 0;
    const since = msOf(last.startedAt);
    if (!Number.isFinite(since)) return false;
    const outs = n.ports && Array.isArray(n.ports.outputs) ? n.ports.outputs : [];
    return outs.some((p) => {
      if (p.when !== 'blocking') return false;
      const t = state.tokens && state.tokens[`${n.id}.${p.id}`];
      return !!t && msOf(t.firedAt) >= since;
    });
  };
  const reviewPassed = () => ![...active].some((id) => stagedIds.has(id)) && inStage.review.every((n) => {
    const list = (byNode.get(n.id) || []).filter((r) => r.kind !== 'task');
    const last = list[list.length - 1];
    return !!last && last.status === 'done' && !lastBlocked(n, last);
  });

  // Build: tasks when a decomposition feeds a build agent (an `expands` input wired from a build agent), else agents.
  const expandsFromBuild = inStage.build.some((n) => (n.ports && Array.isArray(n.ports.inputs) ? n.ports.inputs : [])
    .some((p) => p.expands && graphWires(state).some((w) => w.to && w.to.node === n.id && w.to.port === p.id
      && w.from && ids.build.has(w.from.node))));
  const tasks = taskCounts(rows, ids.build, facts);

  const within = {
    plan: () => inStage.plan.filter(everDone).length / inStage.plan.length,
    build: () => (expandsFromBuild ? (tasks.total ? tasks.done / tasks.total : 0)
      : inStage.build.filter(everDone).length / inStage.build.length),
    review: () => (reviewPassed() ? 1 : Math.min(passes * REVIEW_STEP, REVIEW_CAP)),
  };
  // Per-stage completion, 0..1. A stage is whole once a LATER present stage has begun (it
  // may have skipped an agent). An absent stage is whole once every stage before it is (P1:
  // wf_pr_fix starts at Build; wf_architecture_c4 is whole up to Ready after its Plan).
  const c = {};
  PROGRESS_STAGES.forEach((s, i) => {
    if (ready || PROGRESS_STAGES.slice(i + 1).some((x) => inStage[x].length && begun(x))) { c[s] = 1; return; }
    if (!inStage[s].length) { c[s] = PROGRESS_STAGES.slice(0, i).every((x) => c[x] === 1) ? 1 : 0; return; }
    c[s] = begun(s) ? Math.max(START_SHARE, clamp01(within[s]())) : 0;
  });
  const reached = PROGRESS_STAGES.reduce((acc, s, i) => (begun(s) ? i : acc), -1);
  const rawIdx = ready ? 3 : reached >= 0 ? reached : PROGRESS_STAGES.indexOf(present[0]);
  const rawFraction = ready ? 1 : (c.plan + c.build + c.review) / 4;
  const { fraction, stageIdx } = remember(rawFraction, rawIdx);
  const stage = ORDER[stageIdx];
  const label = STAGE_LABEL[stage];

  // ── P5: "<Stage> · <what is happening>" ──
  const now = staged.filter((n) => active.has(n.id)).map(labelOf);
  // Spec §4a: role reviews are part of Plan — "Plan · role reviews[, round N]" while the role node runs.
  const roleFact = facts && facts.roleReview && typeof facts.roleReview === 'object' ? facts.roleReview : null;
  const roleWhat = () => {
    if (!roleFact || !active.has(roleFact.nodeId)) return '';
    const round = Number(roleFact.round) || 1;
    return round > 1 ? `role reviews, round ${round}` : 'role reviews';
  };
  const workingWhat = () => {
    if (stage === 'ready') return '';
    if (status === 'done') return 'finished';
    if (stage === 'review' && passes) {
      // Work sent back: a non-review agent runs while the bar sits in Review (P3) — the NEXT pass.
      const fixing = [...active].some((id) => stagedIds.has(id) && !ids.review.has(id));
      return fixing
        ? `${ordinal(passes + 1)} pass, fixing ${blockingNow ? plural(blockingNow, 'issue') : 'issues'}`
        : `${ordinal(passes)} pass`;
    }
    if (stage === 'build' && expandsFromBuild && tasks.total) return `task ${Math.min(tasks.done + 1, tasks.total)} of ${tasks.total}`;
    const rw = roleWhat();
    if (rw) return rw;
    if (now.length > 1) return `${now.length} steps`;
    if (now.length === 1) return now[0];
    return !rows.length && !active.size ? 'starting' : '';
  };
  const rw = roleWhat();
  const oneStep = now.length === 1 && !rw && !(stage === 'review' && passes)
    && !(stage === 'build' && expandsFromBuild && tasks.total) ? now[0] : '';
  const step = oneStep && !sameWord(oneStep, label) ? oneStep : '';
  const raw = waitWhat() || workingWhat();
  const what = sameWord(raw, label) ? '' : raw;
  const text = what ? `${label} · ${what}` : label;
  // The four sections' own fills (Plan, Build, Review, Ready), from the monotonic fraction. Exact because an earlier
  // stage is forced to 1 once a later present stage begins, so stages fill in order. A skipped stage (wf_pr_fix has
  // no Plan agent) draws full, as its quarter counts today.
  const fill = [0, 1, 2, 3].map((i) => clamp01(fraction * 4 - i));

  const stages = [
    ...PROGRESS_STAGES.map((s, i) => ({
      id: s, label: STAGE_LABEL[s],
      state: !inStage[s].length ? 'skipped' : i < stageIdx ? 'done' : i === stageIdx ? 'current' : 'waiting',
      agents: inStage[s].map((n) => ({ label: labelOf(n), state: active.has(n.id) ? 'current' : everDone(n) ? 'done' : 'waiting' })),
    })),
    { id: 'ready', label: STAGE_LABEL.ready, state: stage === 'ready' ? 'done' : 'waiting', agents: [] },
  ];
  return { mode: 'stages', stage, label, fraction, text, step, what, fill, tone, stages, passes,
    tasks: expandsFromBuild ? tasks : null };
}

/**
 * The group's continuous bar (spec §2.3): (finished members + the current member's own fill) ÷ members.
 * `members` in order, each `{ state: 'done'|'current'|'waiting'|'failed', progress?: {fraction} }`;
 * `planning` (a Shaper feature's planning run) counts as one more member. `memo` keeps the maximum (P3).
 */
export function groupProgress(members, { planning = null, memo = null } = {}) {
  const list = [...(planning ? [planning] : []), ...(Array.isArray(members) ? members : [])].filter(Boolean);
  const finished = list.filter((m) => m.state === 'done').length;
  const cur = list.find((m) => m.state === 'current');
  const fill = cur && cur.progress ? clamp01(cur.progress.fraction) : 0;
  let fraction = list.length ? clamp01((finished + fill) / list.length) : 0;
  if (memo) fraction = memo.fraction = Math.max(Number(memo.fraction) || 0, fraction);
  return { total: list.length, finished, fraction };
}

/**
 * P8: a chain's overall bar, one equal part per run. `members` are in chain order, each
 * `{ state: 'done'|'current'|'waiting'|'failed', progress: runProgress(...) | null }`.
 * Returns `{ total, index (1-based: the current run, else the next waiting one), fraction,
 * tone, text: "Run 2 of 3 · Build", parts: [{state, fraction, tone}] }`.
 */
export function chainProgress(members, { noun = 'Run' } = {}) {
  const list = Array.isArray(members) ? members.filter(Boolean) : [];
  const total = list.length;
  const at = list.findIndex((m) => m.state === 'current');
  const next = at >= 0 ? at : list.findIndex((m) => m.state === 'waiting');
  const parts = list.map((m) => ({
    state: m.state,
    fraction: m.state === 'done' || m.state === 'failed' ? 1 : m.state === 'current' && m.progress ? clamp01(m.progress.fraction) : 0,
    tone: m.state === 'done' ? 'green' : m.state === 'failed' ? 'red' : m.state === 'current' && m.progress ? m.progress.tone : 'blue',
  }));
  const fraction = total ? parts.reduce((a, p) => a + (p.state === 'failed' ? 0 : p.fraction), 0) / total : 0;
  const cur = at >= 0 ? list[at] : null;
  const index = next >= 0 ? next + 1 : total;
  // D17: a current member that waits for a person turns the text and tone amber.
  const needs = !!(cur && cur.needs);
  const stageWord = needs ? ' · Needs you' : cur && cur.progress && cur.progress.label ? ` · ${cur.progress.label}` : '';
  return { total, index, fraction, parts,
    tone: needs ? 'amber' : cur && cur.progress ? cur.progress.tone : 'blue',
    text: total ? `${noun} ${index} of ${total}${stageWord}` : '' };
}
