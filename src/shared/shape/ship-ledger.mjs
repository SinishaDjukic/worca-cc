// src/shared/shape/ship-ledger.mjs — Shaper small runs, Feature D1 (Ship): what a marked feature's Ship reads, computed
// once (featureView's `ship.smallRuns`): the requirement rows (owned by a run, or confirmed by a person in a role), the
// block reason while a confirmed one waits, the Not met / Dropped lines and the Care outcome line. Pure; the server computes it and every surface
// reads the result.
import { CONFIRM_ROLES, careChoiceText } from './feature-record.mjs';
import { MARK_WORDS, requirementStatus } from './req-status.mjs';

export { MARK_WORDS };

/** Fail closed: why a marked feature cannot ship while agreed requirements have no run and no person; null for none. */
export const unownedReason = (ids) => {
  const xs = list(ids);
  return xs.length ? `${xs[0]}${xs.length > 1 ? ` and ${xs.length - 1} more are` : ' is'} owned by no run and confirmed by no person` : null;
};

/** The reason a marked feature's One refusal, Ship dialog and PR auto-finisher give with the Shaper small runs flag off,
 *  word for word as before (stored in older run and feature outcomes too; pr-auto.mjs maps it for display). */
export const LEGACY_PER_RUN_REASON = 'small runs ship a PR per run';

/** Why One is off for a marked feature while a run owns a pull request (chain.mjs oneShipCheck and the Ship dialog say
 *  the same). `pr = { url, number?, state? }`: the number is `pr.number`, else read from a `/pull/N` or
 *  `/merge_requests/N` url, else none. */
export function openPrReason({ index, pr } = {}) {
  const fromUrl = String(pr?.url || '').match(/\/(?:pull|merge_requests)\/(\d+)(?:[/?#]|$)/);
  const n = Number.isInteger(pr?.number) && pr.number > 0 ? pr.number : fromUrl ? Number(fromUrl[1]) : null;
  if (pr?.state === 'MERGED' && n) return `Run ${index}'s pull request #${n} is already merged`;
  if (pr?.state === 'MERGED') return `Run ${index}'s pull request is already merged`;
  return n ? `Run ${index} already has pull request #${n} open` : `Run ${index} already has a pull request open`;
}

const list = (v) => (Array.isArray(v) ? v : []);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const roleLabel = (role) => CONFIRM_ROLES.find((r) => r.key === role)?.label || role;

/** Feature D1 (owner direction): the marks a person gives a requirement they confirm, as the classic ledger stores them
 *  (acceptance.mjs ACCEPTANCE_MARKS). Not met and Dropped carry a one-line reason. */
export const CONFIRM_MARKS = Object.freeze(['met', 'not-met', 'dropped']);
export const CONFIRM_REASON_MAX = 300;
/** The block reason once every confirmed requirement is marked but one not met or dropped has no reason (an unmarked
 *  one reads the waiting-for-role line). */
export const REASON_FIRST = 'Give a reason for each one not met or dropped';

/** A body's mark ('not_met' is read as 'not-met'), or null when it is none of the three. */
export function confirmMarkOf(raw) {
  const m = raw === 'not_met' ? 'not-met' : raw;
  return CONFIRM_MARKS.includes(m) ? m : null;
}
/** A reason as stored: one line, whitespace collapsed. */
export const reasonLine = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/**
 * `agreed` = outline.agreed ({id, text}); `kinds` = requirementKindsOf's entries; `acceptance` = the stored ledger
 * (outline.acceptance); `verify` = verifyView's answer or null.
 * A confirmed row's `state`: 'waiting' (unmarked), 'needs-reason' (Not met or Dropped with no reason) or 'confirmed'
 * (marked, with a reason where one is needed); `mark` and `reason` are the stored ones. Only Met counts as met.
 * Small runs D3 (D2): with `runs` (an array, [{index, state, stop}] from the view's slices) and `reruns`
 * (req-status.mjs rerunsOf), every owned and confirmed entry gains `shown`, its status (requirementStatus), computed
 * here once. Without `runs` the output is D1's, key for key.
 * Fail closed, only with `runs`: an owned entry of no run has status `unowned`; `unowned` (its ids, only when there are
 * any) blocks Ship, its reason first.
 * → {confirmed, owned, waiting, blocked, reason, met: {met, total}, unmet: [{id, text, mark, reason}], unowned?: [id]}
 */
export function shipLedger({ agreed = [], kinds = [], acceptance = [], verify = null, runs = null, reruns = [] } = {}) {
  const texts = new Map(list(agreed).map((a) => [a.id, a.text || '']));
  const marks = new Map(list(acceptance).filter((e) => e && confirmMarkOf(e.mark)).map((e) => [String(e.id), e]));
  const gaps = verify && verify.state === 'accepted' ? new Set(list(verify.gaps).map((g) => g.id)) : new Set();
  const judged = Array.isArray(runs);
  const confirmed = []; const owned = [];
  for (const k of list(kinds)) {
    const text = texts.get(k.id) || '';
    if (k.kind === 'confirmed') {
      const m = marks.get(k.id);
      const mark = m ? confirmMarkOf(m.mark) : null;
      const why = mark && mark !== 'met' ? reasonLine(m.reason) : '';
      const state = !mark ? 'waiting' : mark !== 'met' && !why ? 'needs-reason' : 'confirmed';
      confirmed.push({ id: k.id, text, role: k.role, roleLabel: roleLabel(k.role), state, mark, reason: why || null,
        at: m && typeof m.at === 'string' ? m.at : null });
    } else {
      const run = Number.isInteger(k.run) ? k.run : null;
      owned.push({ id: k.id, text, run, status: judged && run === null ? 'unowned' : gaps.has(k.id) ? 'gap-accepted' : 'holds' });
    }
  }
  const open = confirmed.filter((c) => c.state === 'waiting');
  const waiting = open.map((c) => c.id);
  const needs = confirmed.filter((c) => c.state === 'needs-reason');
  const labels = [...new Set(open.map((c) => c.roleLabel))];
  const unowned = owned.filter((o) => o.status === 'unowned').map((o) => o.id);
  const reason = unowned.length ? unownedReason(unowned) : open.length
    ? labels.length > 1 ? `Waiting for ${andList(labels)} to confirm ${plural(open.length, 'requirement')}`
      : `Waiting for ${labels[0]} to confirm ${waiting[0]}${waiting.length > 1 ? ` and ${waiting.length - 1} more` : ''}`
    : needs.length ? REASON_FIRST : null;
  const met = owned.filter((o) => o.status === 'holds').length + confirmed.filter((c) => c.state === 'confirmed' && c.mark === 'met').length;
  const unmet = confirmed.filter((c) => c.state === 'confirmed' && c.mark !== 'met').map((c) => ({ id: c.id, text: c.text, mark: c.mark, reason: c.reason }));
  if (judged) for (const e of [...owned, ...confirmed]) e.shown = requirementStatus(e, { runs, reruns });
  return { confirmed, owned, waiting, blocked: open.length + needs.length + unowned.length > 0, reason, met: { met, total: owned.length + confirmed.length }, unmet,
    ...(unowned.length ? { unowned } : {}) };
}

/** One line per Not met or Dropped requirement, for the done Ship card and each PR description:
 *  `Not met: R-comp-4 · the reason`. */
export function unmetLines(ledger) {
  return list(ledger && ledger.unmet).map((u) => `${MARK_WORDS[u.mark]}: ${u.id} · ${u.reason}`);
}

/** The Care row and PR line: the choice, and the outcome once the feature has recorded figures. `met` is the live
 *  ledger's count; only the gaps and the changes after ship come from the figures. → {choice, outcome, line} */
export function careOutcome(care, figures, met) {
  const choice = careChoiceText(care);
  const m = met || { met: 0, total: 0 };
  const outcome = figures ? `${m.met} of ${m.total} built requirements met · ${plural(Number(figures.gapsAtEnd) || 0, 'gap')} found at the end`
    + ` · ${Number(figures.changesAfterShip) || 0} changes after ship so far` : null;
  return { choice, outcome, line: `Care: ${choice}${outcome ? ` · ${outcome}` : ''}` };
}
