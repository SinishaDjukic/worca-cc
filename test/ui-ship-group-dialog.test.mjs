// test/ui-ship-group-dialog.test.mjs — one ship flow, slice 2: the Create PR dialog's Pull requests zone for a Shaper
// feature or a Run-after chain (ui/public/ship-group-dialog.mjs), painted over the real #shipit-modal in index.html.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { paintGroupShip, groupShipChoice, resetGroupShip, PER_RUN_NOTE, CHECKING_COMBINE, ONE_GROUP_NOTE, ONE_RUN_GROUP, ONE_LOOSE_REASON } from '../ui/public/ship-group-dialog.mjs';

const trackDom = useDomRelease(afterEach);
const html = readFileSync(new URL('../ui/public/index.html', import.meta.url), 'utf8');
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
