// The sweeps runner picks the sweeps a change needs (tools/stillhet-sweeps.mjs, docs/rail/gate.md › The checks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepsFor, main } from '../tools/stillhet-sweeps.mjs';

const ALL = ['ds-check', 'worca-sweep', 'run-page-sweep', 'pulse-sweep'];

test('a file every page draws with needs all four sweeps', () => {
  for (const p of ['ui/public/design-system/components/side-menu.mjs', 'ui/public/stillhet/css/rail.css', 'ui/public/stillhet/app.css',
    'ui/public/stillhet/components.js', 'ui/public/stillhet/adapter.js', 'ui/public/stillhet/demo/demo-actions.js', 'plans/rail/prototype/gates/pool.mjs'])
    assert.deepEqual(sweepsFor([p]), ALL, p);
});

test('a page needs its own sweep and ds-check', () => {
  assert.deepEqual(sweepsFor(['ui/public/stillhet/runs/run-page.js']), ['ds-check', 'run-page-sweep']);
  assert.deepEqual(sweepsFor(['ui/public/stillhet/pulse/pulse.js']), ['ds-check', 'pulse-sweep']);
  assert.deepEqual(sweepsFor(['ui/public/stillhet/settings/settings-model.js']), ['ds-check', 'pulse-sweep']);
  assert.deepEqual(sweepsFor(['ui/public/stillhet/shell/shell.js']), ['ds-check', 'worca-sweep']);
  assert.deepEqual(sweepsFor(['ui/public/stillhet/chat/chat.js']), ['ds-check', 'worca-sweep']);
  assert.deepEqual(sweepsFor(['plans/rail/prototype/stillhet-switch.js']), ['ds-check']);
});

test('what feeds two pages needs both', () => {
  assert.deepEqual(sweepsFor(['ui/public/stillhet/runs/run-page-model.js']), ['ds-check', 'run-page-sweep', 'pulse-sweep']);
  assert.deepEqual(sweepsFor(['ui/public/stillhet/shell/world.js']), ['ds-check', 'worca-sweep', 'pulse-sweep']);
  assert.deepEqual(sweepsFor(['ui/public/stillhet/pulse/pulse.js', 'ui/public/stillhet/shell/shell.js']), ['ds-check', 'worca-sweep', 'pulse-sweep']);
});

test('a gate script needs that gate only; the other gates and other files need none', () => {
  assert.deepEqual(sweepsFor(['plans/rail/prototype/gates/pulse-sweep.mjs']), ['pulse-sweep']);
  assert.deepEqual(sweepsFor(['plans/rail/prototype/gates/click-check.mjs']), []);
  assert.deepEqual(sweepsFor(['docs/rail/gate.md', 'server/index.js', 'ui/public/app.js']), []);
});

test('--base without a ref stops before anything runs', async () => {
  assert.equal(await main(['--base']), 2);
  assert.equal(await main(['--base', '--all']), 2);
});
