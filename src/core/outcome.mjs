// src/core/outcome.mjs  (new)
// One mechanism for "did the run deliver what its workflow declared?". Pure: the engine
// feeds it facts; it never reads the filesystem or the DB.

/** Unmet-expectation kinds, most-specific first — the head is the headline cause. */
export const UNMET_ORDER = [
  'no-code-change', 'missing-output', 'partial-fanout', 'review-blocking', 'missing-verdict', 'end-not-reached',
];

/**
 * The unmet expectations ONE finished step raises. Conservative by construction:
 * only facts the clarify answers said count (unconditional always-outputs the graph
 * depended on, a declared verdict). no-code-change / partial-fanout / review-blocking /
 * end-not-reached are run-level and built in the harness finalize, not here.
 * @param {{nodeId:string, step:string,
 *          requiredMissing?:Array<{port:string, empty:boolean}>,
 *          verdictMissing?:boolean}} f
 * @returns {Array<{nodeId:string, step:string, kind:string, detail?:string}>}
 */
export function stepExpectations(f) {
  const out = [];
  const base = { nodeId: f.nodeId, step: f.step };
  for (const r of f.requiredMissing || []) {
    out.push({ ...base, kind: 'missing-output', detail: `${r.port}:${r.empty ? 'empty' : 'absent'}` });
  }
  if (f.verdictMissing) out.push({ ...base, kind: 'missing-verdict' });
  return out;
}

/** Collapse the collected list into one run outcome. Empty list ⇒ successful. */
export function computeOutcome(unmet) {
  const items = (Array.isArray(unmet) ? unmet : []).filter(Boolean);
  if (items.length === 0) return { successful: true, reason: null };
  const rank = (k) => { const i = UNMET_ORDER.indexOf(k); return i < 0 ? UNMET_ORDER.length : i; };
  const primary = [...items].sort((a, b) => rank(a.kind) - rank(b.kind))[0];
  return { successful: false, reason: reasonLine(primary, items) };
}

/** A single-line human reason naming the step and the cause, ≤ 300 chars incl. the suffix. */
export function reasonLine(primary, items = [primary]) {
  const step = primary.step || primary.nodeId || 'A step';
  let head;
  switch (primary.kind) {
    case 'no-code-change': head = `${step} produced no changes to the worktree.`; break;
    case 'missing-output': {
      const empty = String(primary.detail || '').endsWith(':empty');
      const port = String(primary.detail || '').split(':')[0] || 'output';
      head = `${step}'s required output (${port}) was ${empty ? 'empty' : 'never written'}.`;
      break;
    }
    case 'partial-fanout': head = `${step} completed only ${primary.detail}.`; break;
    case 'review-blocking': head = `${step} still reported ${primary.detail} after its review loop ended.`; break;
    case 'missing-verdict': head = `${step} never produced its verdict.`; break;
    case 'end-not-reached':
    default:
      head = `${step} finished without reaching its end — its output dead-ended and nothing downstream ran.`;
  }
  head = head.replace(/\s+/g, ' ').trim();
  const more = items.length - 1;
  const suffix = more > 0 ? ` (+${more} more unmet expectation${more === 1 ? '' : 's'})` : '';
  const budget = 300 - suffix.length;
  if (head.length > budget) head = `${head.slice(0, Math.max(0, budget - 1)).trimEnd()}…`;
  return head + suffix;
}

/** Shared reader: a run is successful unless its persisted outcome says otherwise. */
export function outcomeSuccessful(parsedOutcome) {
  return !(parsedOutcome && parsedOutcome.successful === false);
}
