// test/exec-env-sweep.test.mjs
// Orphan sandboxes (src/core/exec-env/sweep.mjs) and `worca e2b sweep` (src/cli/e2b.mjs), on the loopback fake.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeE2b } from '../src/core/exec-env/e2b-fake.mjs';
import { sweepOrphanSandboxes, countRunningSandboxes } from '../src/core/exec-env/sweep.mjs';
import { cmdE2b } from '../src/cli/e2b.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'e2b mode is POSIX-only' : false };
const dirs = []; after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const conn = { opts: {}, template: 'worca-agent' };

async function world() {
  const root = mkdtempSync(join(tmpdir(), 'worca-e2b-sweep-')); dirs.push(root);
  const sdk = createFakeE2b({ root });
  const make = (instance, runId) => sdk.Sandbox.create('worca-agent', { metadata: { worca: '1', worcaInstance: instance, worcaRunId: runId } });
  const done = await make('me', 'done-run');
  const paused = await make('me', 'paused-run');
  const other = await make('them', 'their-run');
  return { sdk, done, paused, other };
}
const keepRun = (id) => id === 'paused-run';

test('a sweep kills only this instance\'s sandboxes of runs that cannot resume', POSIX, async () => {
  const { sdk, done, paused, other } = await world();
  const r = await sweepOrphanSandboxes({ sdk, conn, instance: 'me', keepRun });
  assert.deepEqual(r.killed, [{ sandboxId: done.sandboxId, runId: 'done-run' }]);
  assert.deepEqual(r.kept, [{ sandboxId: paused.sandboxId, runId: 'paused-run' }]);
  assert.deepEqual([...sdk.live.keys()].sort(), [paused.sandboxId, other.sandboxId].sort());
});

test('dryRun kills none; all kills every sandbox of this instance', POSIX, async () => {
  const { sdk, other } = await world();
  const dry = await sweepOrphanSandboxes({ sdk, conn, instance: 'me', keepRun, dryRun: true });
  assert.equal(dry.killed.length, 1);
  assert.equal(sdk.live.size, 3);
  const all = await sweepOrphanSandboxes({ sdk, conn, instance: 'me', keepRun, all: true });
  assert.equal(all.killed.length, 2);
  assert.deepEqual([...sdk.live.keys()], [other.sandboxId]);
});

test('countRunningSandboxes counts every running sandbox', POSIX, async () => {
  const { sdk } = await world();
  assert.equal(await countRunningSandboxes(sdk, conn), 3);
});

test('worca e2b: sweep --dry-run prints what it would kill; an unknown verb or option fails', async () => {
  const lines = []; const fails = [];
  const out = (s) => lines.push(s); const fail = (s) => fails.push(s);
  let asked = null;
  const sweep = async (o) => { asked = o; return { killed: [{ sandboxId: 'sb1', runId: 'r1' }], kept: [{ sandboxId: 'sb2', runId: 'r2' }] }; };
  assert.equal(await cmdE2b(['sweep', '--dry-run'], { out, fail, sweep }), 0);
  assert.deepEqual(asked, { dryRun: true, all: false });
  assert.deepEqual(lines, ['would kill sb1 (run r1)', 'would kill 1, kept 1']);
  assert.equal(await cmdE2b(['nope'], { out, fail, sweep }), 1);
  assert.match(fails[0], /unknown e2b command: nope/);
  assert.equal(await cmdE2b(['sweep', '--force'], { out, fail, sweep }), 2);
  assert.match(fails[1], /unknown option --force/);
  lines.length = 0;
  assert.equal(await cmdE2b(['sweep'], { out, fail, sweep: async () => ({ skipped: true, killed: [], kept: [] }) }), 0);
  assert.match(lines[0], /not configured/);
  lines.length = 0;
  assert.equal(await cmdE2b([], { out, fail, sweep }), 0);
  assert.match(lines[0], /worca e2b sweep/);
});
