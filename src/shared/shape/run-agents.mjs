// src/shared/shape/run-agents.mjs — Shaper small runs C2 (D12): the one word source for a marked slice run, read by
// its card row (the short word) and its Agents section (one row per Care role). Pure and browser-safe; it reads the
// snapshot shape of snapshotFromState (ui/public/ask-run-card.mjs): `stepper.careRun`, `stepper.graph.nodes`,
// `active[].nodeId`, `decor.status` and `status`.
import { roleLabelOf } from './perspectives.mjs';
import { SHAPE_CODE_ROLES, COVERAGE_ROLE } from '../review/requirements-coverage.mjs';
import { runStopWord, reviewerStopWord, waitsForRunWord } from './run-stops.mjs';
import { isFinishedState } from '../run-model.mjs';

/** The word each agent node of a slice graph shows while it works. */
const WORD_OF = Object.freeze({
  n_clarify: 'planning', n_plan: 'planning', n_refine: 'planning',
  n_roles: 'reviewing plan',
  n_tests: 'writing tests',
  n_impl: 'building',
  n_review: 'reviewing', n_check: 'reviewing', n_webui: 'reviewing',
});
/** The slice graph's flow order (its node list puts `n_roles` and `n_tests` last, after End). */
const FLOW = Object.freeze(['n_clarify', 'n_plan', 'n_roles', 'n_refine', 'n_tests', 'n_impl', 'n_review', 'n_check', 'n_webui']);
const HELD = new Set(['paused', 'error', 'failed', 'stopped', 'interrupted']);
const STOPPED_NODE = new Set(['paused', 'stopped', 'error']);
const PLANNER_NODES = Object.freeze(['n_clarify', 'n_plan', 'n_refine']);
const CODE_NODES = Object.freeze(['n_review', 'n_check', 'n_webui']);
const CODE_ROLES = Object.freeze([...SHAPE_CODE_ROLES, COVERAGE_ROLE]);

const careRunOf = (snap) => (snap && snap.stepper && typeof snap.stepper === 'object' && snap.stepper.careRun) || null;
const activeIds = (snap) => new Set((Array.isArray(snap?.active) ? snap.active : []).map((a) => a && a.nodeId).filter(Boolean));
const statusOf = (snap, id) => (snap?.decor?.status && snap.decor.status[id]) || null;
const isHeld = (snap) => HELD.has(String(snap?.status || '')) || !!snap?.pendingQuestion;

/**
 * The run's one short word: planning, reviewing plan, writing tests, building, reviewing or done. Between agent nodes
 * (no active one) it keeps the word of the last finished agent node in flow order, planning before any. Null without a
 * Care plan, and for a held run (paused, asking, failed, stopped: dev's status text says those). Small runs C3 (D15): a
 * run on a stop question, one whose answer waits its turn, or one building on a stopped run says so first (`slice` is
 * the feature view's slice: run-stops.mjs runStopWord).
 * @returns {'planning'|'reviewing plan'|'writing tests'|'building'|'reviewing'|'done'|string|null}
 */
export function runShortWord(snap, slice = null) {
  const stopWord = runStopWord({ snap, slice });
  if (stopWord) return stopWord;
  if (!careRunOf(snap)) return null;
  if (String(snap.status || '') === 'done') return 'done';
  if (isHeld(snap)) return null;
  const active = activeIds(snap);
  for (const a of Array.isArray(snap.active) ? snap.active : []) if (a && WORD_OF[a.nodeId]) return WORD_OF[a.nodeId];
  let word = 'planning';
  for (const id of FLOW) if (!active.has(id) && statusOf(snap, id) === 'done') word = WORD_OF[id];
  return word;
}

/** Small runs C2: a member run that finished (done, or its model's ready, in-review or merged state). */
const isFinishedMember = (mb) => mb.state === 'done' || isFinishedState(mb.model && mb.model.state);
/** Item 9: a run that has not started and waits on its chain predecessor (no stop): the predecessor index dev's
 *  "starts after run N" reads (the member's ticket), as the short word. A held ticket keeps dev's word. */
const chainWaitWord = (mb) => {
  const t = mb.model && mb.model.state === 'waiting' && mb.run && mb.run.ticket;
  return t && !t.held && t.after && Number.isInteger(t.after.index) ? waitsForRunWord(t.after.index) : null;
};
/**
 * Small runs C2 (D13): a marked feature's member word, read by the Chat card's run rows and (D2) the Runs list's member
 * rows. A finished run reads `done` when it has a Care plan, or no snapshot is loaded; otherwise runShortWord, then the
 * chain wait word. Null (a run without `careRun`, held): the caller keeps dev's own words.
 * @param {{state?: string, model?: {state?: string}, run?: object}} mb
 */
export function cardShortWord(mb, snap, slice = null) {
  return isFinishedMember(mb) && (!snap || (snap.stepper && snap.stepper.careRun)) ? 'done'
    : runShortWord(snap, slice) || chainWaitWord(mb);
}

/** The short word of a run group's member, from the snapshot and the slice it carries (app.js runsGroupItem): the Runs
 *  list's member rows and the feature page read it, so a run says the same on every surface. */
export const memberShortWord = (mb) => cardShortWord(mb, mb.snap || null, mb.slice || null);

/**
 * The Agents rows of a marked run, in order: Planner; one plan reviewer per Care plan reviewer; the Test writer (or,
 * without one, "Tests · the Implementer", which follows the Implementer); the Implementer; the four code reviewers.
 * A row of an active node is `live` with the run's short word; a paused run's last active rows are `paused` (another
 * held run's, asking, failed or stopped, keep `wait` until C3 words them); a finished
 * row is `check`/`done`; a row not started is `wait`/`waits`. [] without a Care plan.
 * @returns {Array<{key: string, name: string, word: string, mark: 'live'|'paused'|'check'|'wait'}>}
 */
export function runAgentRows(snap) {
  const careRun = careRunOf(snap);
  if (!careRun) return [];
  const has = new Set((snap.stepper.graph && Array.isArray(snap.stepper.graph.nodes) ? snap.stepper.graph.nodes : []).map((n) => n && n.id));
  const reviewers = Array.isArray(careRun.planReviewers) ? careRun.planReviewers : [];
  const spec = [
    { key: 'planner', name: 'Planner', nodes: PLANNER_NODES },
    ...reviewers.map((k) => ({ key: `plan-review-${k}`, name: `Plan review · ${roleLabelOf(k)}`, nodes: ['n_roles'] })),
    careRun.testWriter
      ? { key: 'test-writer', name: 'Test writer', nodes: ['n_tests'] }
      : { key: 'tests-implementer', name: 'Tests · the Implementer', nodes: ['n_impl'] },
    { key: 'implementer', name: 'Implementer', nodes: ['n_impl'] },
    ...CODE_ROLES.map((r) => ({ key: `code-review-${r.key}`, name: `Code review · ${r.label}`, nodes: CODE_NODES })),
  ];
  const active = activeIds(snap);
  const held = isHeld(snap) && String(snap.status || '') !== 'done';
  const word = runShortWord(snap);
  // Small runs C3 (D12): the role a stop question names reads `objects` (paused mark, no count): the panel's findings say
  // the rest. Rows of the stop's node, matched by the name the stop's head gives; none named, every row of that node.
  const stop = snap.pendingQuestion && snap.pendingQuestion.stop;
  const objects = reviewerStopWord(stop);
  const tagOf = (name) => name.split(' · ').pop();
  const ofNode = objects ? spec.filter((r) => r.key !== 'tests-implementer' && r.nodes.includes(stop.node)) : [];
  const named = ofNode.filter((r) => String(stop.head || '').includes(tagOf(r.name)));
  const objecting = new Set((named.length ? named : ofNode).map((r) => r.key));
  return spec.map(({ key, name, nodes }) => {
    if (objecting.has(key)) return { key, name, word: objects, mark: 'paused' };
    const own = nodes.filter((id) => has.has(id));
    const live = own.some((id) => active.has(id));
    if (held && own.some((id) => active.has(id) || STOPPED_NODE.has(statusOf(snap, id)))) {
      return String(snap.status || '') === 'paused' ? { key, name, word: 'paused', mark: 'paused' } : { key, name, word: 'waits', mark: 'wait' };
    }
    if (live && word) return { key, name, word, mark: 'live' };
    if (own.some((id) => statusOf(snap, id) === 'done')) return { key, name, word: 'done', mark: 'check' };
    return { key, name, word: 'waits', mark: 'wait' };
  });
}

/**
 * Shaper small runs D2 (D13): a done Agents row's detail, from stored records only (`stored` is the `/slice` answer's
 * `{ planVersion, planReviewed, tests }`, core/shape/features.mjs storedAgentFacts). The Planner: `plan vN`, plus
 * ` · after the plan review` from v2 once a plan review finished. The Implementer only (never the "Tests · the
 * Implementer" row, so the count shows once): `T of T tests pass` when every stored test passed. Null otherwise: a row
 * not done, any other row, or no stored data.
 * @returns {string|null}
 */
export function agentDetail(row, stored) {
  if (!row || row.word !== 'done' || !stored || typeof stored !== 'object') return null;
  if (row.key === 'planner') {
    const n = stored.planVersion;
    if (!Number.isSafeInteger(n) || n < 1) return null;
    return `plan v${n}${n >= 2 && stored.planReviewed === true ? ' · after the plan review' : ''}`;
  }
  if (row.key === 'implementer') {
    const t = stored.tests;
    return t && Number.isSafeInteger(t.total) && t.total >= 1 && t.passed === t.total ? `${t.total} of ${t.total} tests pass` : null;
  }
  return null;
}
