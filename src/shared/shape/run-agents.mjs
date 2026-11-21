// src/shared/shape/run-agents.mjs — Shaper small runs C2 (D12): the one word source for a marked slice run, read by
// its card row (the short word) and its Agents section (one row per Care role). Pure and browser-safe; it reads the
// snapshot shape of snapshotFromState (ui/public/ask-run-card.mjs): `stepper.careRun`, `stepper.graph.nodes`,
// `active[].nodeId`, `decor.status` and `status`.
import { roleLabelOf } from './perspectives.mjs';
import { SHAPE_CODE_ROLES, COVERAGE_ROLE } from '../review/requirements-coverage.mjs';

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
 * Care plan, and for a held run (paused, asking, failed, stopped: dev's status text says those).
 * @returns {'planning'|'reviewing plan'|'writing tests'|'building'|'reviewing'|'done'|null}
 */
export function runShortWord(snap) {
  if (!careRunOf(snap)) return null;
  if (String(snap.status || '') === 'done') return 'done';
  if (isHeld(snap)) return null;
  const active = activeIds(snap);
  for (const a of Array.isArray(snap.active) ? snap.active : []) if (a && WORD_OF[a.nodeId]) return WORD_OF[a.nodeId];
  let word = 'planning';
  for (const id of FLOW) if (!active.has(id) && statusOf(snap, id) === 'done') word = WORD_OF[id];
  return word;
}

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
  return spec.map(({ key, name, nodes }) => {
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
