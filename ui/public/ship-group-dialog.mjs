// ui/public/ship-group-dialog.mjs — one ship flow, slice 2: the Create PR dialog's Pull requests zone for a Shaper
// feature or a Run-after chain, or a user group (slice 3). One or N stacked, the suggestion under it; the title and the
// confirm follow the pick (createPrLabel). Pure DOM over the shared #shipit-modal; app.js opens, posts and closes it.
import { createPrLabel } from './ship-words.mjs';

export const PER_RUN_NOTE = 'Each PR takes its own run summary';
export const ONE_FEATURE_NOTE = 'The PR takes every run\'s summary';
export const ONE_OFF_REASON = 'A run already has a PR';
// Slice 3: a user group's One waits on the server's combine check (GET /api/run-groups/:id/combine).
export const CHECKING_COMBINE = 'Checking whether the runs combine…';
export const ONE_RUN_GROUP = 'A group of one run ships as its own PR';
export const ONE_GROUP_NOTE = 'A new branch combines the runs\' branches';
export const ONE_LOOSE_REASON = 'A run does not start from the previous run\'s branch';

/** A member's own PR: open, and not an in-flight feature's slice draft (stacked marks those ready, One closes them). */
const ownsPr = (kind, pr) => !!(pr && pr.url && pr.state !== 'CLOSED' && !(kind === 'feature' && pr.draft));

/**
 * view: { kind: 'feature'|'chain'|'user', suggested?: 'one'|'stacked'|null, members: [{ position, pr: { url, state?, draft? } | null,
 *   stacks? }] }: a chain member with `stacks: false` did not start from the previous run's branch, so One would ship
 *   only the last run's work.
 * check: a user group's combine check ({ oneOff, line }) or null while it has not answered (slice 3).
 * → { n: members that still need a PR, oneOff: '' or why One is disabled, mode: the default pick }
 */
export function groupShipChoice({ kind, members, suggested = null, check = null }) {
  const owned = members.filter((m) => ownsPr(kind, m.pr));
  const loose = kind === 'chain' && members.some((m, i) => i > 0 && m.stacks === false);
  const oneOff = owned.length ? ONE_OFF_REASON
    : loose ? ONE_LOOSE_REASON
    : kind !== 'user' ? ''
    : members.length < 2 ? ONE_RUN_GROUP
    : !check ? CHECKING_COMBINE : check.oneOff || '';
  const mode = oneOff || kind !== 'feature' || suggested === 'stacked' ? 'stacked' : 'one';
  return { n: members.length - owned.length, oneOff, mode };
}

/** The single-run and workspace openers call this first: no Pull requests zone, the description and Generate back. */
export function resetGroupShip(modal) {
  const q = (sel) => modal.querySelector(sel);
  modal.__groupShip = null;                            // Slice 3: a late combine check for the last open is dropped
  q('.shipit-prs').hidden = true;
  q('.shipit-desc').hidden = false;
  q('.shipit-generate').hidden = false;
  const note = q('.shipit-slice-note');
  note.textContent = '';
  note.hidden = true;
  // Slice 3: a user group's open put its title in the Title placeholder (app.js); give the input its own back.
  const t = q('.shipit-title-input');
  if (t && t.dataset.ph !== undefined) { t.placeholder = t.dataset.ph; delete t.dataset.ph; }
}

/** Paint the zone and wire the radios; `setLabel(label)` sets the dialog's title and confirm (app.js setShipItLabel).
 *  → { mode, count, first, markCreated(k), checking(), setCheck(c) }: markCreated records that the server made the next
 *  k runs' PRs (a part-way ship, D21), so the dialog matches what a retry will do; setCheck takes a user group's combine
 *  check (slice 3), and checking() says whether one is still wanted. */
export function paintGroupShip(modal, view, { setLabel }) {
  const q = (sel) => modal.querySelector(sel);
  const user = view.kind === 'user';
  let check = null;
  let members = view.members.map((m) => ({ ...m }));
  let choice = groupShipChoice({ ...view, members, check });
  const one = q('.shipit-prs input[value="one"]');
  const stacked = q('.shipit-prs input[value="stacked"]');
  const why = q('.shipit-prs-one-why');
  const hint = q('.shipit-prs-hint');
  const paintChoice = () => {
    // One run left of several: One is disabled, and "1 stacked" would be a second name for the same single PR.
    // Slice 3: a user group of one run has nothing "more"; it reads "1 separate".
    const more = choice.n === 1 && !(user && view.members.length === 1);
    q('.shipit-prs-stacked-label').textContent = more ? '1 more' : `${choice.n} ${user ? 'separate' : 'stacked'}`;
    one.disabled = !!choice.oneOff;
    why.textContent = choice.oneOff;
    why.hidden = !choice.oneOff;
    // A feature's suggestion, or (slice 3) a user group's clean check line while One is on.
    const line = view.hint || (user && check && !choice.oneOff ? check.line || '' : '');
    hint.textContent = line;
    hint.hidden = !line;
  };
  paintChoice();
  (choice.mode === 'one' ? one : stacked).checked = true;
  q('.shipit-prs').hidden = false;
  q('.shipit-generate').hidden = true;                 // Generate drafts one run's description: never in a group
  const desc = q('.shipit-desc');
  const note = q('.shipit-slice-note');
  const mode = () => (one.checked ? 'one' : user ? 'separate' : 'stacked');
  const paint = () => {
    setLabel(createPrLabel(mode() === 'one' ? 1 : choice.n));
    // A chain's or a user group's One is a single createRunPr the user words; a feature's builds its own body.
    const own = (view.kind === 'chain' || user) && mode() === 'one';
    desc.hidden = !own;
    note.textContent = mode() !== 'one' ? PER_RUN_NOTE : user ? ONE_GROUP_NOTE : own ? '' : ONE_FEATURE_NOTE;
    note.hidden = !note.textContent;
    if (view.onMode) view.onMode(mode());
  };
  one.onchange = paint;          // properties, not listeners: each open replaces the last
  stacked.onchange = paint;
  paint();
  const recompute = () => {
    choice = groupShipChoice({ ...view, members, check });
    paintChoice();
    if (choice.oneOff) stacked.checked = true;
    paint();
  };
  const markCreated = (k) => {
    let left = k;
    members = members.map((m) => (left > 0 && !ownsPr(view.kind, m.pr)
      ? (left--, { ...m, pr: { url: `created:${m.position}`, state: 'OPEN' } }) : m));
    recompute();
  };
  const ctl = { mode, count: () => (mode() === 'one' ? 1 : choice.n), first: () => (one.checked ? one : stacked), markCreated,
    checking: () => choice.oneOff === CHECKING_COMBINE,
    /** Slice 3: the server's combine check ({ oneOff, line }) for a user group; ignored once this open is over. */
    setCheck: (c) => { if (modal.__groupShip !== ctl) return; check = c || { oneOff: '', line: '' }; recompute(); } };
  modal.__groupShip = ctl;
  return ctl;
}
