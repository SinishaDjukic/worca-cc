// src/shared/workflow-tests/criteria-verdicts.mjs — Part 4 (plans/workflow-tests-part4-plan.md D91, D98): which tries are checked, and
// (Task 9) a criterion's result on one try and the status a try has with its criteria. Pure and browser-safe.

import { NOT_CHECKED } from './criteria-text.mjs';

/** Errors asked again on the next pass (Worca's spending limit was reached, the test's cost limit was reached (Task 21 fix round 2), the
 *  call failed, a person's Stop cut the check short or never reached it (board 59 B: 'stopped', 'pending')); the others are final for that
 *  try. The cell says "Not checked …" and waits, never a verdict. One list (final review M6): criteria-store.mjs re-exports it. */
export const RETRY_ERRORS = Object.freeze(['limit', 'cap', 'failed', 'stopped', 'pending']);

/** D91, P4-Q5: a try whose run finished (its stored verdict says so) and that Worca did not set aside. */
export const finishedTry = (t) => !!(t && t.verdict && t.verdict.facts && t.verdict.facts.status === 'done' && !t.verdict.worcaProblem);

/** D100: the two tries a pair compares: the first finished try (passed or failed, finishedTry) of each side of one example. The runner asks it and the side by side shows it. */
export function pairTriesOf(tries, exampleId) {
  const first = (side) => tries.filter((t) => t.exampleId === exampleId && t.side === side && (t.status === 'passed' || t.status === 'failed') && finishedTry(t))
    .sort((x, y) => x.tryNo - y.tryNo)[0] || null;
  return { A: first('a'), B: first('b') };
}

/**
 * D98: one criterion on one try. `j` = the try's newest judgement of it (criteria-store's shape) or null; `trust` = trustOf's.
 * Only a counted verdict (met or not met, its proof found) decides, and only when its trust decides (D95).
 */
export function criterionResult(c, j, trust, { finished = true, answer } = {}) {
  const base = { id: c.id, label: c.text, trust };
  if (!finished) return { ...base, met: null, value: NOT_CHECKED['not-finished'], decides: false };
  if (!j) return { ...base, met: null, value: NOT_CHECKED.pending, decides: false, pending: true };
  if (j.error || j.met === null) {
    return { ...base, met: null, value: NOT_CHECKED[j.error] || NOT_CHECKED.failed, decides: false, judgementId: j.id,
      ...(RETRY_ERRORS.includes(j.error) ? { pending: true } : {}) };
  }
  return { ...base, met: j.met, value: j.met ? 'Met' : 'Not met', reason: j.reason, proof: j.proof, proofFound: j.proofFound,
    judgementId: j.id, decides: !!(trust && trust.decides), shadowDecides: true, ...(answer !== undefined ? { answer } : {}) };
}

/** D98: a passed try fails when a deciding criterion is not met. `all`: unreliable criteria decide too (the second reading). */
export function combinedStatus(status, criteria, { all = false } = {}) {
  if (status !== 'passed') return status;
  return (criteria || []).some((c) => c.met === false && (all ? c.shadowDecides : c.decides)) ? 'failed' : 'passed';
}

const FINISHED = new Set(['passed', 'failed']);

/** D98: tries with `verdict.criteria`, `status` (with criteria), `checksStatus` (Part 2's) and `shadowStatus`. `resultsOf(t)` → results | null.
 *  I6 (even checking): per example, a criterion that some finished try (finishedTry: its run finished; an errored try is not one, N2)
 *  of the given tries has no counted verdict for (met null) decides
 *  on none of them (`uneven`), so one version is never failed for a criterion the other version's tries were never checked on. */
export function withCriteria(tries, resultsOf) {
  const found = tries.map((t) => { const c = t.verdict ? resultsOf(t) : null; return c && c.length ? c : null; });
  const counted = new Map();   // exampleId → Map(criterion id → counted on every finished try so far)
  tries.forEach((t, i) => {
    if (!found[i] || !FINISHED.has(t.status) || !finishedTry(t)) return;   // N2: a try whose run did not finish has no say
    if (!counted.has(t.exampleId)) counted.set(t.exampleId, new Map());
    const m = counted.get(t.exampleId);
    for (const c of found[i]) m.set(c.id, (m.has(c.id) ? m.get(c.id) : true) && c.met !== null);
  });
  return tries.map((t, i) => {
    if (!found[i]) return t;
    const m = counted.get(t.exampleId);
    const criteria = found[i].map((c) => (m && m.get(c.id) === false && c.met !== null ? { ...c, decides: false, shadowDecides: false, uneven: true } : c));
    return { ...t, checksStatus: t.status, status: combinedStatus(t.status, criteria), shadowStatus: combinedStatus(t.status, criteria, { all: true }),
      verdict: { ...t.verdict, criteria } };
  });
}

/** I6, P4-M5: per example, the criteria that were not checked on every finished try (so they decide nothing there), by label. */
export function notCheckedEverywhere(tries, examples) {
  const out = [];
  for (const ex of examples) {
    const labels = new Set();
    const seen = new Map();   // criterion id → [label, counted on some finished try]
    for (const t of tries) {
      if (t.exampleId !== ex.id) continue;
      const finished = (t.status === 'passed' || t.status === 'failed') && finishedTry(t);
      for (const c of (t.verdict && t.verdict.criteria) || []) {
        if (c.uneven) labels.add(c.label);
        if (finished) seen.set(c.id, [c.label, (seen.has(c.id) && seen.get(c.id)[1]) || c.met !== null]);
      }
    }
    // Review (a): a criterion that no finished try has a counted verdict for (the limit or the test's cap left it unchecked on every try).
    for (const [label, counted] of seen.values()) if (!counted) labels.add(label);
    if (labels.size) out.push({ id: ex.id, name: ex.name, criteria: [...labels] });
  }
  return out;
}

/** D98, P4-M5: the examples that are "same" now but would differ if unreliable criteria decided. */
export function unreliableOnly(real, shadow) {
  const byId = new Map(shadow.examples.map((r) => [r.id, r]));
  return real.examples.filter((r) => { const s = byId.get(r.id); return r.result === 'same' && s && s.result && s.result !== 'same'; })
    .map((r) => ({ id: r.id, name: r.name }));
}
