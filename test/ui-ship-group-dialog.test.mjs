// test/ui-ship-group-dialog.test.mjs — one ship flow, slice 2: the Create PR dialog's Pull requests zone for a Shaper
// feature or a Run-after chain (ui/public/ship-group-dialog.mjs), painted over the real #shipit-modal in index.html.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { paintGroupShip, groupShipChoice, resetGroupShip, PER_RUN_NOTE, CHECKING_COMBINE, ONE_GROUP_NOTE, ONE_RUN_GROUP, ONE_LOOSE_REASON } from '../ui/public/ship-group-dialog.mjs';
import * as DIALOG from '../ui/public/ship-group-dialog.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

const trackDom = useDomRelease(afterEach);
const html = readIndexHtml();
const modalOf = () => trackDom(new JSDOM(html)).window.document.getElementById('shipit-modal');
const setLabel = (modal) => (l) => { modal.querySelector('.shipit-title').textContent = l; modal.querySelector('.shipit-ok').textContent = l; };
const pick = (modal, v) => { const r = modal.querySelector(`.shipit-prs input[value="${v}"]`); r.checked = true; r.dispatchEvent(new modal.ownerDocument.defaultView.Event('change')); };
const zones = (modal) => [...modal.querySelectorAll('.shipit-zone')].filter((z) => !z.hidden).map((z) => z.querySelector('.shipit-zone-label').textContent);
const FEATURE = { kind: 'feature', suggested: 'one', hint: 'This feature adds 840 lines: one PR is easier to review.',
  members: [1, 2, 3].map((position) => ({ position, pr: null })) };

test('a 3-run feature: One under the suggestion reads Create PR; 3 stacked reads Create 3 PRs', () => {
  const modal = modalOf();
  paintGroupShip(modal, FEATURE, { setLabel: setLabel(modal) });
  assert.deepEqual(zones(modal), ['Into', 'Pull requests', 'After it opens']);
  assert.equal(modal.querySelector('.shipit-prs input[value="one"]').checked, true);
  assert.equal(modal.querySelector('.shipit-prs-hint').textContent, FEATURE.hint);
  assert.equal(modal.querySelector('.shipit-prs-stacked-label').textContent, '3 stacked');
  assert.equal(modal.querySelector('.shipit-title').textContent, 'Create PR');
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Create PR');
  pick(modal, 'stacked');
  assert.equal(modal.querySelector('.shipit-title').textContent, 'Create 3 PRs');
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Create 3 PRs');
  assert.equal(modal.querySelector('.shipit-slice-note').textContent, PER_RUN_NOTE);
});

test('a member with a PR: One disabled with its reason, N counts the rest; a feature\'s slice draft does not count', () => {
  const chain = { kind: 'chain', members: [{ position: 1, pr: { url: 'u1', state: 'OPEN' } }, { position: 2, pr: null }, { position: 3, pr: null }] };
  assert.deepEqual(groupShipChoice(chain), { n: 2, oneOff: 'A run already has a PR', mode: 'stacked' });
  const modal = modalOf();
  paintGroupShip(modal, chain, { setLabel: setLabel(modal) });
  const one = modal.querySelector('.shipit-prs input[value="one"]');
  assert.equal(one.disabled, true);
  const why = modal.querySelector('.shipit-prs-one-why');
  assert.equal(why.hidden, false);
  assert.equal(one.getAttribute('aria-describedby'), why.id);
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Create 2 PRs');
  const drafts = { ...FEATURE, members: FEATURE.members.map((m) => ({ ...m, pr: { url: `d${m.position}`, state: 'OPEN', draft: true } })) };
  assert.deepEqual(groupShipChoice(drafts), { n: 3, oneOff: '', mode: 'one' });
});

test('a chain run that did not start from the previous run\'s branch disables One with its reason', () => {
  const loose = { kind: 'chain', members: [{ position: 1, pr: null }, { position: 2, pr: null, stacks: false }] };
  assert.deepEqual(groupShipChoice(loose), { n: 2, oneOff: ONE_LOOSE_REASON, mode: 'stacked' });
  assert.equal(groupShipChoice({ kind: 'chain', members: [{ position: 1, pr: null }, { position: 2, pr: null, stacks: true }] }).oneOff, '');
});

test('a chain\'s One shows Title and description with Draft and without Generate; a closed PR does not count', () => {
  const modal = modalOf();
  const chain = { kind: 'chain', members: [{ position: 1, pr: { url: 'u', state: 'CLOSED' } }, { position: 2, pr: null }] };
  const ctl = paintGroupShip(modal, chain, { setLabel: setLabel(modal) });
  assert.equal(ctl.mode(), 'stacked', 'a chain defaults to stacked');
  pick(modal, 'one');
  assert.deepEqual(zones(modal), ['Into', 'Pull requests', 'Title and description', 'After it opens']);
  assert.equal(modal.querySelector('.shipit-generate').hidden, true);
  assert.equal(modal.querySelector('.shipit-draft').hidden, false);
  assert.equal(ctl.mode(), 'one');
  assert.equal(ctl.count(), 1);
});

test('the radiogroup is described by the suggestion; one run left reads "1 more"', () => {
  const modal = modalOf();
  paintGroupShip(modal, FEATURE, { setLabel: setLabel(modal) });
  const group = modal.querySelector('.shipit-prs-opts');
  assert.equal(group.getAttribute('aria-describedby'), modal.querySelector('.shipit-prs-hint').id);
  const chain = { kind: 'chain', members: [{ position: 1, pr: { url: 'u1', state: 'OPEN' } }, { position: 2, pr: null }] };
  paintGroupShip(modal, chain, { setLabel: setLabel(modal) });
  assert.equal(modal.querySelector('.shipit-prs-stacked-label').textContent, '1 more');
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Create PR');
});

test('markCreated after a partly failed stacked ship: N drops, One turns disabled, the labels follow', () => {
  const modal = modalOf();
  const ctl = paintGroupShip(modal, FEATURE, { setLabel: setLabel(modal) });
  pick(modal, 'stacked');
  ctl.markCreated(1);                                      // the server created run 1's PR, then run 2 failed
  assert.equal(modal.querySelector('.shipit-prs input[value="one"]').disabled, true);
  assert.equal(modal.querySelector('.shipit-prs-one-why').hidden, false);
  assert.equal(modal.querySelector('.shipit-prs-stacked-label').textContent, '2 stacked');
  assert.deepEqual([ctl.mode(), ctl.count(), modal.querySelector('.shipit-ok').textContent], ['stacked', 2, 'Create 2 PRs']);
});

test('resetGroupShip: after a group paint the single-run zones, note and Generate are back', () => {
  const modal = modalOf();
  paintGroupShip(modal, FEATURE, { setLabel: setLabel(modal) });
  resetGroupShip(modal);
  assert.deepEqual(zones(modal), ['Into', 'Title and description', 'After it opens']);
  assert.equal(modal.querySelector('.shipit-slice-note').hidden, true);
  assert.equal(modal.querySelector('.shipit-generate').hidden, false);
});

test('the per-run note sits where the hidden Title and description zone would be, above After it opens', () => {
  const modal = modalOf();
  const note = modal.querySelector('.shipit-slice-note');
  const desc = modal.querySelector('.shipit-desc');
  const after = modal.querySelector('.shipit-after');
  const DOC_POS = modal.ownerDocument.defaultView.Node.DOCUMENT_POSITION_FOLLOWING;
  assert.ok(desc.compareDocumentPosition(note) & DOC_POS, 'after Title and description');
  assert.ok(note.compareDocumentPosition(after) & DOC_POS, 'before After it opens');
});

const GROUP = { kind: 'user', title: 'Login polish', members: [1, 2, 3].map((position) => ({ position, pr: null })) };

test('a user group opens on 3 separate with One off while the check runs; a conflict keeps One off with the file named', () => {
  const modal = modalOf();
  const ctl = paintGroupShip(modal, GROUP, { setLabel: setLabel(modal) });
  const one = modal.querySelector('.shipit-prs input[value="one"]');
  const why = modal.querySelector('.shipit-prs-one-why');
  assert.equal(modal.querySelector('.shipit-prs-stacked-label').textContent, '3 separate');
  assert.equal(modal.querySelector('.shipit-prs input[value="stacked"]').checked, true);
  assert.deepEqual([one.disabled, why.textContent], [true, CHECKING_COMBINE]);
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Create 3 PRs');
  assert.deepEqual([ctl.mode(), ctl.checking()], ['separate', true]);
  ctl.setCheck({ oneOff: 'The runs conflict in f.txt', line: '' });
  assert.deepEqual([one.disabled, why.hidden, why.textContent], [true, false, 'The runs conflict in f.txt']);
  assert.equal(modal.querySelector('.shipit-prs-hint').hidden, true);
  assert.equal(modal.querySelector('.shipit-title').textContent, 'Create 3 PRs');
  assert.equal(ctl.checking(), false);
});

test('a clean check enables One with its line; One reads Create PR and shows Title and description', () => {
  const modal = modalOf();
  const ctl = paintGroupShip(modal, GROUP, { setLabel: setLabel(modal) });
  ctl.setCheck({ oneOff: '', line: 'The 3 runs combine without conflicts' });
  const one = modal.querySelector('.shipit-prs input[value="one"]');
  assert.equal(one.disabled, false);
  assert.equal(modal.querySelector('.shipit-prs-hint').textContent, 'The 3 runs combine without conflicts');
  pick(modal, 'one');
  assert.equal(ctl.mode(), 'one');
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Create PR');
  assert.deepEqual(zones(modal), ['Into', 'Pull requests', 'Title and description', 'After it opens']);
  assert.equal(modal.querySelector('.shipit-slice-note').textContent, ONE_GROUP_NOTE);
  pick(modal, 'stacked');
  assert.equal(ctl.mode(), 'separate');
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Create 3 PRs');
  assert.deepEqual(zones(modal), ['Into', 'Pull requests', 'After it opens']);
});

test('a user group with one member holding a PR: Create 2 PRs, One off with its reason, no check needed, a late check changes nothing', () => {
  const modal = modalOf();
  const view = { kind: 'user', members: [{ position: 1, pr: null }, { position: 2, pr: { url: 'u2', state: 'OPEN' } }, { position: 3, pr: null }] };
  assert.deepEqual(groupShipChoice(view), { n: 2, oneOff: 'A run already has a PR', mode: 'stacked' });
  const ctl = paintGroupShip(modal, view, { setLabel: setLabel(modal) });
  assert.equal(ctl.checking(), false, 'the answer is known: no /combine fetch');
  ctl.setCheck({ oneOff: '', line: 'The 3 runs combine without conflicts' });
  assert.equal(modal.querySelector('.shipit-prs input[value="one"]').disabled, true);
  assert.equal(modal.querySelector('.shipit-prs-one-why').textContent, 'A run already has a PR');
  assert.equal(modal.querySelector('.shipit-title').textContent, 'Create 2 PRs');
  assert.equal(modal.querySelector('.shipit-prs-stacked-label').textContent, '2 separate');
});

test('a group of one run: 1 separate, Create PR, One off as its own PR, no check', () => {
  const modal = modalOf();
  const ctl = paintGroupShip(modal, { kind: 'user', members: [{ position: 1, pr: null }] }, { setLabel: setLabel(modal) });
  assert.equal(modal.querySelector('.shipit-prs-stacked-label').textContent, '1 separate');
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Create PR');
  assert.equal(modal.querySelector('.shipit-prs-one-why').textContent, ONE_RUN_GROUP);
  assert.equal(ctl.checking(), false);
});

test('a check that lands after the dialog was reset for another open is ignored', () => {
  const modal = modalOf();
  const ctl = paintGroupShip(modal, GROUP, { setLabel: setLabel(modal) });
  resetGroupShip(modal);
  ctl.setCheck({ oneOff: '', line: 'The 3 runs combine without conflicts' });
  assert.equal(modal.querySelector('.shipit-prs-hint').hidden, true);
  assert.equal(modal.querySelector('.shipit-prs input[value="one"]').disabled, true);
});

// ---- A feature planned in small runs (R-po-1): One is on until a run has its own PR. `oneOk` = the flag. ----------------
const PER_RUN_REASON = 'small runs ship a PR per run';   // with the flag off, word for word as before
const url = (n) => `https://github.com/me/repo/pull/${n}`;
const runs = (n, prs = {}) => Array.from({ length: n }, (_, i) => ({ position: i + 1, pr: prs[i + 1] || null }));
const marked = (prs = {}, over = {}) => ({ kind: 'feature', suggested: 'one', hint: '', members: runs(5, prs), all: runs(5, prs), smallRuns: true, oneOk: true, ...over });
const parts = (modal) => ({ one: modal.querySelector('.shipit-prs input[value="one"]'), stacked: modal.querySelector('.shipit-prs input[value="stacked"]'),
  why: modal.querySelector('.shipit-prs-one-why'), ok: modal.querySelector('.shipit-ok') });

test('small runs, 5 finished runs and no PR: the dialog shows One enabled and Stacked; picking One reads Create PR', () => {
  assert.deepEqual(groupShipChoice(marked()), { n: 5, oneOff: '', mode: 'stacked' }, 'stacked stays the pick, whatever the suggestion');
  const modal = modalOf();
  const ctl = paintGroupShip(modal, marked(), { setLabel: setLabel(modal) });
  const { one, stacked, why, ok } = parts(modal);
  assert.deepEqual([one.disabled, stacked.disabled, stacked.checked], [false, false, true]);
  assert.equal(why.hidden, true);
  assert.equal(modal.querySelector('.shipit-prs-stacked-label').textContent, '5 stacked');
  assert.equal(ok.textContent, 'Create 5 PRs');
  assert.equal(modal.querySelector('.shipit-prs-hint').hidden, true, 'no size hint');
  pick(modal, 'one');
  assert.deepEqual([ctl.mode(), ctl.count(), ok.textContent], ['one', 1, 'Create PR']);
});

test('small runs, run 2\'s PR #40 open: One is disabled with its reason, and Stacked can still be picked', () => {
  const view = marked({ 2: { url: url(40), number: 40, state: 'OPEN' } });
  const reason = 'Run 2 already has pull request #40 open';
  assert.deepEqual(groupShipChoice(view), { n: 4, oneOff: reason, mode: 'stacked' });
  const modal = modalOf();
  const ctl = paintGroupShip(modal, view, { setLabel: setLabel(modal) });
  const { one, stacked, why, ok } = parts(modal);
  assert.deepEqual([one.disabled, stacked.disabled, stacked.checked], [true, false, true]);
  assert.deepEqual([why.hidden, why.textContent], [false, reason]);
  assert.equal(one.getAttribute('aria-describedby'), why.id);
  pick(modal, 'stacked');
  assert.deepEqual([ctl.mode(), ctl.count(), ok.textContent], ['stacked', 4, 'Create 4 PRs']);
});

test('small runs: the reason reads the number from the url, names a merged PR as merged, and a closed PR or a slice draft leaves One on', () => {
  const why = (pr) => groupShipChoice(marked({ 2: pr })).oneOff;
  assert.equal(why({ url: url(40), state: 'OPEN' }), 'Run 2 already has pull request #40 open');
  assert.equal(why({ url: url(40), number: 40, state: 'MERGED' }), "Run 2's pull request #40 is already merged");
  assert.equal(why({ url: url(40), number: 40, state: 'CLOSED' }), '');
  assert.equal(why({ url: url(40), number: 40, state: 'OPEN', draft: true }), '');
  // The first run that owns one is named.
  assert.equal(groupShipChoice(marked({ 4: { url: url(44), number: 44, state: 'OPEN' }, 3: { url: url(43), number: 43, state: 'OPEN' } })).oneOff,
    'Run 3 already has pull request #43 open');
});

test('small runs: `all` wins over `members`, so a carried run\'s PR still turns One off; without `all` the members are read', () => {
  const owned = { url: url(40), number: 40, state: 'OPEN' };
  const listed = runs(5).filter((m) => m.position !== 2);              // run 2 is carried: it is not a listed member
  assert.deepEqual(groupShipChoice(marked({}, { members: listed, all: runs(5, { 2: owned }) })),
    { n: 4, oneOff: 'Run 2 already has pull request #40 open', mode: 'stacked' });
  const noAll = marked({ 2: owned });
  delete noAll.all;
  assert.equal(groupShipChoice(noAll).oneOff, 'Run 2 already has pull request #40 open');
});

test('small runs with the flag off (no oneOk): One is off with the reason as before, PR or not; unmarked unchanged', () => {
  for (const prs of [{}, { 2: { url: url(40), number: 40, state: 'OPEN' } }]) {
    const view = marked(prs);
    delete view.oneOk;
    assert.deepEqual(groupShipChoice(view), { n: prs[2] ? 4 : 5, oneOff: PER_RUN_REASON, mode: 'stacked' });
  }
  const modal = modalOf();
  paintGroupShip(modal, { kind: 'feature', suggested: 'one', members: runs(3), smallRuns: true }, { setLabel: setLabel(modal) });
  assert.deepEqual([parts(modal).one.disabled, parts(modal).why.textContent], [true, PER_RUN_REASON]);
  assert.equal(groupShipChoice({ kind: 'feature', members: runs(2), suggested: 'one' }).mode, 'one', 'unmarked unchanged');
  assert.equal('SMALL_RUNS_REASON' in DIALOG, false, 'the old reason export is gone');
});

test('small runs, a part-way stacked ship: once run 1\'s PR is made, One turns off and names run 1', () => {
  const modal = modalOf();
  const ctl = paintGroupShip(modal, marked(), { setLabel: setLabel(modal) });
  assert.equal(parts(modal).one.disabled, false);
  ctl.markCreated(1);                                      // the server created run 1's PR, then run 2 failed
  const { one, why, ok } = parts(modal);
  assert.deepEqual([one.disabled, why.hidden, why.textContent], [true, false, 'Run 1 already has a pull request open']);
  assert.deepEqual([ctl.mode(), ctl.count(), ok.textContent], ['stacked', 4, 'Create 4 PRs']);
});
