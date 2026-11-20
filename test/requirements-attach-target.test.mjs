// test/requirements-attach-target.test.mjs — the shared target helper (target.mjs) and start.mjs's liveRunId export,
// both reused by attach.mjs without it importing routes.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home; let prev; let projKey; let projDir; let checkTarget; let liveRunId;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-req-target-'));
  prev = {};
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_MOCK', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = join(home, 'worca-home');
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  (await import('../src/core/db.mjs'))._resetForTests();
  projDir = await mkdtemp(join(home, 'shop-'));
  const { addProject } = await import('../src/core/projects.mjs');
  projKey = (await addProject({ name: 'shop', path: projDir })).find((p) => p.name === 'shop').key;
  ({ checkTarget } = await import('../src/core/requirements/target.mjs'));
  ({ liveRunId } = await import('../src/core/requirements/start.mjs'));
});
after(async () => {
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  (await import('../src/core/db.mjs'))._resetForTests();
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('checkTarget resolves a registered project to its path', async () => {
  const t = await checkTarget('project', projKey);
  assert.equal(t.path, projDir);
  assert.equal(t.name, 'shop');
  assert.equal(t.ok, true);
});

test('checkTarget rejects a bad scope type, a blank key and unknown targets with BAD_REQUEST', async () => {
  for (const args of [['team', 'x'], ['project', '  '], ['project', 'no-such-key'], ['workspace', 'no-such-ws']]) {
    await assert.rejects(() => checkTarget(...args), (e) => e.code === 'BAD_REQUEST', args.join('/'));
  }
});

test('liveRunId is exported and is null when the feature has no start', async () => {
  assert.equal(typeof liveRunId, 'function');
  assert.equal(await liveRunId(999999, async () => ({ status: 'running' })), null);
});
