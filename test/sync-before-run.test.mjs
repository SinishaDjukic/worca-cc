// test/sync-before-run.test.mjs — src/core/sync-before-run.mjs: Sync before run's per-member options and the start's
// precheck, moved unchanged out of ui/server.mjs. test/sync-api.test.mjs covers both in depth (runSyncOpts directly,
// syncPrecheck through the start routes' sync-diverged / sync-fetch-failed answers); this pins the new home, the server's
// re-export, and the precheck's no-git early outs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after, 'worca-cc-syncbefore-');
const mod = await import('../src/core/sync-before-run.mjs');

test('the server re-exports the module\'s functions, so its callers and tests are unchanged', async () => {
  const server = await import('../ui/server.mjs');
  assert.equal(server.runSyncOpts, mod.runSyncOpts);
  assert.equal(server.syncPrecheck, mod.syncPrecheck);
});

test('runSyncOpts: no members, nothing enabled; a start that may not sync enables none', () => {
  assert.deepEqual(mod.runSyncOpts([], { allowed: true, before: true, policy: null, scheduled: false, onDiverged: null }),
    { members: {}, enabled: false });
  const o = mod.runSyncOpts([{ projectKey: 'p-0123abcd' }], { allowed: false, before: true, policy: null, scheduled: false, onDiverged: null });
  assert.equal(o.enabled, false);
  assert.equal(o.members['p-0123abcd'].enabled, false);
});

test('syncPrecheck: a member with sync off, no config or an unsafe base asks nothing (no git call)', async () => {
  const members = [
    { projectKey: 'a-0123abcd', projectDir: '/nowhere/a', source: 'main' },
    { projectKey: 'b-0123abcd', projectDir: '/nowhere/b', source: '--upload-pack=x' },
    { projectKey: 'c-0123abcd', projectDir: '/nowhere/c', source: 'main' },
  ];
  const sync = { members: {
    'a-0123abcd': { enabled: false, remote: 'origin', onDiverged: 'fail' },
    'b-0123abcd': { enabled: true, remote: 'origin', onDiverged: 'fail' },
  } };
  assert.equal(await mod.syncPrecheck(members, sync), null);
});
