// test/ui-search-unlock.test.mjs — the hand-off after a locked top bar search result is picked (search-unlock.mjs):
// where each lock is cleared, when the user is taken on, and when the pick is forgotten (R-po-15, 16, 19, 20, 21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSearchUnlock } from '../ui/public/search-unlock.mjs';

function rig(state = { level: 'simple', flags: {} }) {
  const log = [];
  const rank = (l) => ['simple', 'advanced', 'expert'].indexOf(l);
  const u = createSearchUnlock({
    levelOk: (min) => rank(state.level) >= rank(min),
    flagOk: (key) => state.flags[key] === true,
    openMode: () => log.push('mode:open'),
    closeMode: () => { log.push('mode:close'); u.modeClosed(); },   // the real dialog reports its own close
    go: (h) => log.push(`go:${h}`),
    labsHash: (k) => `settings/experimental/${k}`,
  });
  return { u, log, state };
}
const row = (locks, href = '#settings/runs/night-settings-card') => ({ href, locks });

test('R-po-16/20: a mode-locked pick opens the mode dialog; reaching the mode closes it and goes on', () => {
  const { u, log, state } = rig();
  u.arm(row([{ type: 'mode', min: 'advanced' }]));
  assert.deepEqual(log, ['mode:open']);
  state.level = 'advanced'; u.changed();
  assert.deepEqual(log, ['mode:open', 'mode:close', 'go:#settings/runs/night-settings-card']);
});

test('R-po-15/19: a Labs-locked pick opens the flag row in Labs; turning it on goes on', () => {
  const { u, log, state } = rig();
  u.arm(row([{ type: 'flag', key: 'runLabels', title: 'Run labels' }], '#settings/tags/labels-settings-card'));
  assert.deepEqual(log, ['go:settings/experimental/runLabels']);
  u.routed('settings', 'experimental/runLabels');
  state.flags.runLabels = true; u.changed();
  assert.equal(log.at(-1), 'go:#settings/tags/labels-settings-card');
});

test('unlocking something else does not take the user on (edge case)', () => {
  const { u, log, state } = rig();
  u.arm(row([{ type: 'mode', min: 'expert' }]));
  state.level = 'advanced'; u.changed();
  assert.deepEqual(log, ['mode:open']);
  assert.equal(u.isArmed(), true);
});

test('R-po-21: closing the mode dialog or leaving Labs without unlocking forgets the pick (A-10)', () => {
  const a = rig(); a.u.arm(row([{ type: 'mode', min: 'advanced' }])); a.u.modeClosed();
  a.state.level = 'advanced'; a.u.changed();
  assert.deepEqual(a.log, ['mode:open'], 'unlocking later does nothing');
  const b = rig(); b.u.arm(row([{ type: 'flag', key: 'runTags', title: 'Cost tags' }]));
  b.u.routed('settings', 'experimental/runTags'); b.u.routed('runs', '');
  b.state.flags.runTags = true; b.u.changed();
  assert.deepEqual(b.log, ['go:settings/experimental/runTags']);
});

test('two locks (Presets) unlock in sequence: mode first, then the flag, then the page', () => {
  const { u, log, state } = rig();
  u.arm(row([{ type: 'mode', min: 'advanced' }, { type: 'flag', key: 'runPresets', title: 'Run presets' }], '#settings/presets'));
  state.level = 'advanced'; u.changed();
  assert.deepEqual(log, ['mode:open', 'mode:close', 'go:settings/experimental/runPresets']);
  u.routed('settings', 'experimental/runPresets');
  state.flags.runPresets = true; u.changed();
  assert.equal(log.at(-1), 'go:#settings/presets');
});

test('two Labs features (the Labels card needs Cost tags and Run labels): each row in turn, then the page', () => {
  const { u, log, state } = rig();
  u.arm(row([{ type: 'flag', key: 'runTags', title: 'Cost tags' }, { type: 'flag', key: 'runLabels', title: 'Run labels' }],
    '#settings/tags/labels-settings-card'));
  u.routed('settings', 'experimental/runTags');
  state.flags.runTags = true; u.changed();
  assert.deepEqual(log, ['go:settings/experimental/runTags', 'go:settings/experimental/runLabels']);
  u.routed('settings', 'experimental/runLabels');
  assert.equal(u.isArmed(), true, 'the second row is still Labs: the pick is kept');
  state.flags.runLabels = true; u.changed();
  assert.equal(log.at(-1), 'go:#settings/tags/labels-settings-card');
  assert.equal(u.isArmed(), false);
});
