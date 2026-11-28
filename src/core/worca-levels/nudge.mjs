// src/core/worca-levels/nudge.mjs
// The "almost there" nudge: when a person at Runner or above is close to the next level, one toast says what is
// left of one item. Pure: the evaluation and the person's record in, `{ id, text }` or null out. The service
// latches `record.nudged[id]` when the client acks, so each item is offered once (R-po-16, I-11).
import { WORCA_THRESHOLDS } from '../../shared/worca-levels.mjs';

const MIN_LEVEL = 2;
const FALLBACK_UNIT = Object.freeze(['step', 'steps']);
/** The unit of each part of an item that counts several things at once, in part order. */
const PART_UNITS = Object.freeze({
  hookedRuns: [['real run', 'real runs'], ['day', 'days']],
  teamSetUp: [['step', 'steps'], ['step', 'steps']],
});

const unitFor = (unit, n) => (n === 1 ? unit[0] : unit[1]);
const phrase = (remaining, unit) => `${remaining} more ${unitFor(unit, remaining)}`;

/** The counters of an undone item: `parts` when it has them, else its single count/of; null when it counts nothing. */
function countersOf(view) {
  if (Array.isArray(view.parts) && view.parts.length) {
    const units = PART_UNITS[view.id] ?? [];
    return view.parts.map((p, i) => ({ count: p.count, of: p.of, unit: units[i] ?? FALLBACK_UNIT }));
  }
  if (Number.isFinite(view.count) && Number.isFinite(view.of)) return [{ count: view.count, of: view.of, unit: view.unit ?? FALLBACK_UNIT }];
  return null;
}

const fractionOf = (counters) => Math.min(...counters.map(({ count, of }) => (of > 0 ? count / of : 1)));

/** Undone, non-unknown counted leaves of the next level, in ladder order; a pick item contributes its choices. */
function candidates(items) {
  return items
    .flatMap((v) => (v.kind === 'pick' ? v.choices : [v]))
    .filter((v) => !v.done && v.status !== 'unknown');
}

/** "2 more real runs to Hooked": what is left of each short part of `view`, then the level. */
export function nudgeText(view, nextName) {
  const left = countersOf(view).filter(({ count, of }) => count < of).map(({ count, of, unit }) => phrase(of - count, unit));
  return `${left.join(' on ')} to ${nextName}`;
}

export function pickNudge(evaluation, record) {
  if (!evaluation || evaluation.top || !evaluation.nextLevel || !Array.isArray(evaluation.next)) return null;
  if (evaluation.level < MIN_LEVEL) return null;
  const nudged = record?.nudged ?? {};
  for (const view of candidates(evaluation.next)) {
    if (nudged[view.id]) continue;
    const counters = countersOf(view);
    if (!counters || fractionOf(counters) < WORCA_THRESHOLDS.nudgeAt) continue;
    return { id: view.id, text: nudgeText(view, evaluation.nextLevel.name) };
  }
  return null;
}
