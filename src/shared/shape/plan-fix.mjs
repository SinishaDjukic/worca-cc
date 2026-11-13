// src/shared/shape/plan-fix.mjs — a Shaper plan's Fix all words and its coverage as a card draws it (moved from
// ui/public/shape/plan-text.mjs, which re-exports them): dev's plan card and Stillhet's live PlanCard send and draw the same.
// Pure: no I/O.

/** One failing shape check as a revise. */
export function fixFeedback(item) {
  return `The shape check fails "${item.label}"${item.detail ? `: ${item.detail}` : ''}. Fix the plan so this check passes.`;
}

/** The engine's coverage (`R-ops-1 · not covered by any step`, detail = the criterion text) as the card draws it: an
 *  uncovered row reads `R-ops-1 · <the criterion>` with the reason as its detail; a covered row keeps the engine's label. */
export function displayCoverage(cov) {
  const items = (cov && Array.isArray(cov.items) ? cov.items : []).map((it) => {
    if (it.pass || !it.detail) return it;
    return { ...it, label: `${it.id} · ${it.detail}`, detail: 'not covered by any step' };
  });
  return { ...cov, items };
}

/** One revise for every failing check (D32 "Fix all"); a single failure reads as today's fixFeedback. The uncovered
 *  agreed `requirements` (coverage rows) follow on their own line, worded as requirements, not as shape checks. */
export function fixAllFeedback(items, requirements = []) {
  const bad = (Array.isArray(items) ? items : []).filter((it) => !it.pass);
  const req = (Array.isArray(requirements) ? requirements : []).filter((it) => !it.pass);
  const checkPart = () => {
    if (bad.length === 1) return fixFeedback(bad[0]);
    return `The shape check fails ${bad.length} checks:\n${bad.map((it) => `- "${it.label}"${it.detail ? `: ${it.detail}` : ''}`).join('\n')}\n`
      + 'Fix the plan so these checks pass.';
  };
  if (!req.length) return checkPart();
  // the engine label ("R-ops-1 · not covered by any step") would repeat the sentence: name it by id and criterion
  const name = (it) => (it.detail ? `${it.id}: ${it.detail}` : it.id || it.label);
  const reqPart = req.length === 1
    ? `The agreed requirement ${name(req[0])} is not covered by any step. Fix the plan so a step delivers it and names it on a \`Covers:\` line.`
    : `${req.length} agreed requirements are not covered by any step:\n${req.map((it) => `- ${name(it)}`).join('\n')}\n`
      + 'Fix the plan so a step delivers each and names it on a `Covers:` line.';
  return [bad.length ? checkPart() : '', reqPart].filter(Boolean).join('\n');
}
