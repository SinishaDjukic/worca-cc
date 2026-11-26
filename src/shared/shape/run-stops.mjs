// src/shared/shape/run-stops.mjs — Shaper small runs C3: the one model of a marked run's stops. A run stops for the
// person only when a check fails, a role's objection cannot be resolved, or an agreed requirement would have to change;
// every other stop is settled by the agents. Each stop is one question: who wants what and why, two options, Worca's
// pick. Pure and browser-safe: the orchestrator, the held-answer module, the step card, its receipt and the run rows
// all read their words here. Every option's payload is one dev's validators already accept (gateAnswer,
// validatePlanAnswer), so a stop needs no new ask kind and no new validator.
import { roleSummaries } from './role-review.mjs';
import { concernFeedbackSection } from '../review/plan-concern.mjs';
import { BLOCKING, normalizeSeverity } from '../graph/verdict.mjs';
import { requirementChangedFeedback, oneLineText } from './req-change.mjs';
import { noteTitle, noteClause } from './outline-note.mjs';

export const STOP_REASONS = Object.freeze(['check', 'objection', 'requirement']);
// Small runs C5: the Verifier's bound stop is a `check` stop of the same shape.
export { verifyStop } from './verifier.mjs';

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;
const joinNames = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
/** A gate issue that holds the run, by the engine's own rule (verdict.mjs): critical, major, an alias of either
 *  ('High', 'P1') or an unknown or missing severity (it stops rather than settling silently). */
const blocks = (iss) => BLOCKING.has(normalizeSeverity(iss?.severity));
const opt = (value, label, sub, short, payload) => ({ value, label, sub, go: label, short, payload });

/** The names of the roles still objecting in the last round of `roleReviews` for `nodeId`, else ['Code review']. */
function objectingRoles(roleReviews, nodeId) {
  const roles = roleReviews && Array.isArray(roleReviews.rounds) && roleReviews.rounds.length
    ? roleSummaries(roleReviews, nodeId ? { node: nodeId } : {}).filter((r) => r.open > 0).map((r) => r.label || r.key) : [];
  return roles.length ? roles : ['Code review'];
}

/** A finding's title in the plain register: a leading finding or requirement id (`correctness-1-1:`, `[R-ux-4]`) dropped. */
const plainTitle = (t) => String(t || '').replace(/^\s*\[?[A-Za-z][\w]*(?:-\w+)*-\d+\]?\s*[:·—–-]?\s+/, '').trim();

/** Who objects to what: the first open blocking finding, from the role reviews (its role's label), else the first
 *  blocking gate issue (its `role`, else `fallback`; an issue's `section` is a location, never a role). */
function firstObjection(roleReviews, nodeId, open, fallback) {
  const rows = roleReviews && Array.isArray(roleReviews.rounds) && roleReviews.rounds.length
    ? roleSummaries(roleReviews, nodeId ? { node: nodeId } : {}) : [];
  for (const r of rows) {
    const f = r.open > 0 && r.findings.find((x) => x.status === 'open' && blocks(x));
    if (f && plainTitle(f.title)) return { role: r.label || r.key, title: plainTitle(f.title) };
  }
  const iss = open[0];
  return { role: (iss && typeof iss.role === 'string' && iss.role.trim()) || fallback, title: plainTitle(iss && iss.title) || 'a finding is still open' };
}

/**
 * The review loop ran out. Null when every open issue is minor or a suggestion: the agents settle it (`continue`).
 * Else an objection: Worca picks one more cycle. The question names the role and its finding in one line.
 */
export function gateStop({ run, issues = [], roleReviews = null, fixCycles = 0, nodeId = null } = {}) {
  const open = (Array.isArray(issues) ? issues : []).filter(blocks);
  if (!open.length) return null;
  const roles = objectingRoles(roleReviews, nodeId);
  const who = joinNames(roles);
  const one = roles.length === 1;
  const n = open.length;
  const first = firstObjection(roleReviews, nodeId, open, roles[0]);
  return {
    reason: 'objection', run, node: nodeId || null, pick: 'another',
    head: `Run ${run} · ${who} ${one ? 'objects' : 'object'}`,
    text: `${first.role}: ${first.title}${n > 1 ? ` and ${n - 1} more` : ''}. Still open after ${plural(Number(fixCycles) || 0, 'fix cycle')}.`,
    findingsLine: `${plural(n, 'finding')} open`,
    options: [
      opt('another', 'Run another cycle', `One more fix cycle for ${who}`, 'another cycle', { decision: 'another' }),
      opt('continue', 'Accept as is', `Carries on; the ${n === 1 ? 'finding stays' : 'findings stay'} in the panel`, 'accepted as is', { decision: 'continue' }),
    ],
  };
}

/** Keep it / Change it. Small runs C4 (D10): with a proposed change, Change it re-plans from the new text (the change
 *  path applies it first; the stop card shows every new text in full); without one it stops the run (C3). */
const keepChange = (change = null) => [
  opt('keep', 'Keep it', 'The run goes on with the requirement as agreed', 'keep', { decision: 'approve' }),
  change
    ? opt('change', 'Change it', `Re-plans from the new ${change.length === 1 ? 'text' : `texts (${change.length})`} below`, 'change',
      { decision: 'revise', feedback: requirementChangedFeedback(change), source: 'requirement' })
    : opt('change', 'Change it', 'The run stops here so the requirement can change', 'change', { decision: 'stop' }),
];

/** D10: the concern's proposals that can be applied (each names the text it changes), as `{id, from, to}`; null for none. */
function changeOf(concern) {
  const list = (concern && Array.isArray(concern.proposals) ? concern.proposals : [])
    .filter((p) => p && typeof p.id === 'string' && typeof p.from === 'string' && oneLineText(p.text))
    .map((p) => ({ id: p.id, from: p.from, to: oneLineText(p.text) }));
  return list.length ? list : null;
}

function requirementStop({ run, concern = null, outlineChange = null, node = null }) {
  const ids = concern && Array.isArray(concern.requirements) ? concern.requirements : [];
  const head = ids.length ? `Run ${run} · ${ids.join(', ')} would have to change` : `Run ${run} · the outline would have to change`;
  // An outline change asks with its reason only; the card draws the rest of the note under the question.
  const title = noteTitle(outlineChange);
  const text = concern
    ? `A reviewer wants ${ids.length ? ids.join(', ') : 'an agreed requirement'} changed: ${concern.title}.`
    : `The Planner says this run cannot be built as outlined${title ? `: ${noteClause(title)}` : '.'}`;
  const change = changeOf(concern);
  return { reason: 'requirement', run, node, pick: 'keep', head, text, findingsLine: concern ? concern.title : 'The outline no longer fits',
    ...(change ? { change, landsAs: concern.proposals.find((p) => p.landsAs)?.landsAs || 'none' } : {}), options: keepChange(change) };
}

/** What the Planner is asked to fix after a failing (or missing) shape check. */
export function checkFeedback(check) {
  if (!check || !Array.isArray(check.items)) return 'The plan check could not run. Check the plan against its shape and fix what is missing.';
  const failing = check.items.filter((i) => i && !i.pass);
  const rows = failing.map((i) => `- ${i.label || i.id || 'check'}${i.detail ? `: ${i.detail}` : ''}`);
  return `The plan check did not pass (${check.passed ?? 0} of ${check.total ?? check.items.length}). Fix these:\n${rows.join('\n') || '- (no detail)'}`;
}

/**
 * The plan approval of a marked run. A requirement concern from the role reviews, or an outline change, is a
 * `requirement` stop (it wins); a failing or missing check is a `check` stop; null when nothing holds it.
 */
export function planStop({ run, check = null, concern = null, outlineChange = null, node = null } = {}) {
  if (concern || outlineChange) return requirementStop({ run, concern, outlineChange, node });
  if (check && check.ok === true) return null;
  return {
    reason: 'check', run, node, pick: 'revise',
    head: `Run ${run} · the plan check did not pass`,
    text: check ? `The plan passes ${check.passed ?? 0} of ${check.total ?? 0} checks.` : 'The plan check could not run.',
    findingsLine: check ? `${check.passed ?? 0} of ${check.total ?? 0} checks pass` : 'The plan check could not run',
    options: [
      opt('revise', 'Re-plan', 'The Planner fixes what the check found', 're-plan', { decision: 'revise', feedback: checkFeedback(check), source: 'check' }),
      opt('approve', 'Approve as is', 'The run builds this plan as it is', 'approved as is', { decision: 'approve' }),
    ],
  };
}

/**
 * The Implementer's plan concern. A requirement concern is a `requirement` stop; any other is settled once (null: the
 * Planner re-plans with it); a second one from the same node after an earlier was decided is an objection.
 */
export function concernStop({ run, concern, nodeId = null, decidedBefore = false } = {}) {
  if (!concern) return null;
  if (concern.kind === 'requirement') return requirementStop({ run, concern, node: nodeId });
  if (!decidedBefore) return null;
  return {
    reason: 'objection', run, node: nodeId || null, pick: 'approve',
    head: `Run ${run} · the Implementer objects to the plan`,
    text: `The Implementer still objects after a re-plan: ${concern.title}.`,
    findingsLine: concern.title,
    options: [
      opt('revise', 'Re-plan', 'The Planner changes the plan for this concern', 're-plan',
        { decision: 'revise', feedback: concernFeedbackSection(concern) }),
      opt('approve', 'Build the plan', 'The Implementer builds the plan as written', 'build the plan', { decision: 'approve' }),
    ],
  };
}

const same = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a); const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
};

const optionsOf = (stop) => (stop && Array.isArray(stop.options) ? stop.options : []);

/** The option a payload answered, matched on its decision: each stop's options have distinct decisions, and dev's
 *  validators reshape the rest (validatePlanAnswer trims a Re-plan's feedback). Null when none matches. */
export function stopOptionOf(stop, payload) {
  const d = payload && typeof payload === 'object' ? payload.decision : undefined;
  return (d ? optionsOf(stop).find((o) => o.payload.decision === d) : null) || null;
}

/** Membership only: the payload is exactly one of the stop's options (what the card sends). */
export const stopAnswerOk = (stop, payload) => optionsOf(stop).some((o) => same(o.payload, payload));

/** The one answered line: `Run 8: another cycle · decided by you`. */
export function stopDoneText(stop, payload) {
  const o = stopOptionOf(stop, payload);
  return `Run ${stop && stop.run}: ${o ? o.short : 'answered'} · decided by you`;
}
export const STOP_DONE_RE = /^Run \d+: .+ · decided by you$/;

/** The Planner's feedback when the agents settle a first plain plan concern (a re-plan). */
export const SETTLED_CONCERN_FEEDBACK = 'Re-plan so this concern no longer applies.';

const SETTLED = Object.freeze({
  gate: (n) => `Review loop ran out with ${n} minor issue(s): accepted · settled by the agents.`,
  notes: () => 'Chat notes went to the Planner with the plan: approved · settled by the agents.',
  concern: () => "The Implementer's plan concern went back to the Planner: re-planned · settled by the agents.",
});
/** The audit line of a stop the agents settled. */
export const settledLine = (kind, n = 0) => (SETTLED[kind] ? SETTLED[kind](n) : '');

/** A second answer while one is held. */
export const heldRefusal = (after) => `this stop is already answered: it goes on after run ${after}`;
/** An answer to a stop this run has already taken. */
export const answeredRefusal = () => 'this stop is already answered';

/** The stopped reviewer's word in the Agents rows. */
export const reviewerStopWord = (stop) => (stop && stop.reason === 'objection' ? 'objects' : null);

/** A run that builds on (or starts after) run `n`: its short row word. */
export const waitsForRunWord = (n) => `waits for run ${n}`;

/**
 * A marked run's row word: its answer is held (`after run 9`), it waits for the person (`waiting for you`), or it builds
 * on a stopped run (`waits for run 8`). Null otherwise. `slice` is featureView's slice; `snap` the run's snapshot.
 */
export function runStopWord({ snap = null, slice = null } = {}) {
  const st = slice && slice.stop;
  if (st && st.held && Number.isInteger(st.after)) return `after run ${st.after}`;
  if ((st && !st.held) || (snap && snap.pendingQuestion && snap.pendingQuestion.stop && !st)) return 'waiting for you';
  if (slice && Number.isInteger(slice.waitsFor)) return waitsForRunWord(slice.waitsFor);
  // Slice 2 (D10): with the flag on, the runs the gate holds it on, unreduced (slice 3 phrases them).
  if (slice && Array.isArray(slice.waitsFor) && slice.waitsFor.length) return waitsForRunWord(slice.waitsFor.join(', '));
  // Small runs C4 (D18): a change run that is due takes the next turn.
  if (slice && slice.kind === 'change' && slice.state === 'planned' && !slice.cannotStart) return 'next · small change run';
  return null;
}
