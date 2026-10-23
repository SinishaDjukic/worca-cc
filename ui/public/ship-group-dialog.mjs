// ui/public/ship-group-dialog.mjs — one ship flow, slice 2: the Create PR dialog's Pull requests zone for a Shaper
// feature or a Run-after chain. One or N stacked, the suggestion under it; the title and the confirm follow the pick
// (createPrLabel). Pure DOM over the shared #shipit-modal; app.js opens, posts and closes it.
import { createPrLabel } from './ship-words.mjs';

export const PER_RUN_NOTE = 'Each PR takes its own run summary';
export const ONE_FEATURE_NOTE = 'The PR takes every run\'s summary';
export const ONE_OFF_REASON = 'A run already has a PR';
export const ONE_LOOSE_REASON = 'A run does not start from the previous run\'s branch';

/** A member's own PR: open, and not an in-flight feature's slice draft (stacked marks those ready, One closes them). */
const ownsPr = (kind, pr) => !!(pr && pr.url && pr.state !== 'CLOSED' && !(kind === 'feature' && pr.draft));

/**
 * view: { kind: 'feature'|'chain', suggested?: 'one'|'stacked'|null, members: [{ position, pr: { url, state?, draft? } | null,
 *   stacks? }] }: a chain member with `stacks: false` did not start from the previous run's branch, so One would ship
 *   only the last run's work.
 * → { n: members that still need a PR, oneOff: '' or why One is disabled, mode: the default pick }
 */
export function groupShipChoice({ kind, members, suggested = null }) {
  const owned = members.filter((m) => ownsPr(kind, m.pr));
  const loose = kind === 'chain' && members.some((m, i) => i > 0 && m.stacks === false);
  const oneOff = owned.length ? ONE_OFF_REASON : loose ? ONE_LOOSE_REASON : '';
  const mode = oneOff || kind !== 'feature' || suggested === 'stacked' ? 'stacked' : 'one';
  return { n: members.length - owned.length, oneOff, mode };
}

/** The single-run and workspace openers call this first: no Pull requests zone, the description and Generate back. */
export function resetGroupShip(modal) {
  const q = (sel) => modal.querySelector(sel);
  q('.shipit-prs').hidden = true;
  q('.shipit-desc').hidden = false;
  q('.shipit-generate').hidden = false;
  const note = q('.shipit-slice-note');
  note.textContent = '';
  note.hidden = true;
}

/** Paint the zone and wire the radios; `setLabel(label)` sets the dialog's title and confirm (app.js setShipItLabel).
 *  → { mode, count, first, markCreated(k) }: markCreated records that the server made the next k runs' PRs (a stacked
 *  ship that failed part-way, D21), so the dialog matches what a retry will do. */
export function paintGroupShip(modal, view, { setLabel }) {
  const q = (sel) => modal.querySelector(sel);
  let members = view.members.map((m) => ({ ...m }));
  let choice = groupShipChoice({ ...view, members });
  const one = q('.shipit-prs input[value="one"]');
  const stacked = q('.shipit-prs input[value="stacked"]');
  const why = q('.shipit-prs-one-why');
  const paintChoice = () => {
    // One run left: One is disabled, and "1 stacked" would be a second name for the same single PR.
    q('.shipit-prs-stacked-label').textContent = choice.n === 1 ? '1 more' : `${choice.n} stacked`;
    one.disabled = !!choice.oneOff;
    why.textContent = choice.oneOff;
    why.hidden = !choice.oneOff;
  };
  paintChoice();
  const hint = q('.shipit-prs-hint');
  hint.textContent = view.hint || '';
  hint.hidden = !view.hint;
  (choice.mode === 'one' ? one : stacked).checked = true;
  q('.shipit-prs').hidden = false;
  q('.shipit-generate').hidden = true;                 // Generate drafts one run's description: never in a group
  const desc = q('.shipit-desc');
  const note = q('.shipit-slice-note');
  const mode = () => (one.checked ? 'one' : 'stacked');
  const paint = () => {
    setLabel(createPrLabel(mode() === 'one' ? 1 : choice.n));
    // Only a chain's One is a single createRunPr the user words; every other mode builds its own bodies.
    const own = view.kind === 'chain' && mode() === 'one';
    desc.hidden = !own;
    note.textContent = mode() === 'stacked' ? PER_RUN_NOTE : own ? '' : ONE_FEATURE_NOTE;
    note.hidden = !note.textContent;
    if (view.onMode) view.onMode(mode());
  };
  one.onchange = paint;          // properties, not listeners: each open replaces the last
  stacked.onchange = paint;
  paint();
  const markCreated = (k) => {
    let left = k;
    members = members.map((m) => (left > 0 && !ownsPr(view.kind, m.pr)
      ? (left--, { ...m, pr: { url: `created:${m.position}`, state: 'OPEN' } }) : m));
    choice = groupShipChoice({ ...view, members });
    paintChoice();
    if (choice.oneOff) stacked.checked = true;
    paint();
  };
  return { mode, count: () => (mode() === 'one' ? 1 : choice.n), first: () => (one.checked ? one : stacked), markCreated };
}
