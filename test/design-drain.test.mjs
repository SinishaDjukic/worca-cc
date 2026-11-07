// test/design-drain.test.mjs
// A server drain (P2 Task 19) pauses live Design builds with reason `drain`, waits for their agents, and refuses new
// starts with 503. Its own file, because a drain is one-way per process (test/server-drain.test.mjs:4-5). The server
// boots as in test/design-server.test.mjs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { createDesign, getBuild } from '../src/core/design/store.mjs';

// `tools/test.mjs` deletes WORCA_FLAGS, so the flag is set here, before the import.
const ENV = { WORCA_MOCK: '1', WORCA_FLAGS: 'design', WORCA_MOCK_DESIGN_MS: '2' };
const SAVED_KEYS = [...Object.keys(ENV), 'WORCA_HOME', 'WORCA_DESIGN_MAX_BUILDERS'];
const saved = {};
let mod, srv, homeDir;

before(async () => {
  for (const k of SAVED_KEYS) saved[k] = process.env[k];
  homeDir = await mkdtemp(join(tmpdir(), 'worca-design-drain-'));
  Object.assign(process.env, ENV, { WORCA_HOME: homeDir });
  delete process.env.WORCA_DESIGN_MAX_BUILDERS;
  _resetForTests();
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
});
after(async () => {
  if (mod?.designBuilds) { mod.designBuilds.pauseAll(); await mod.designBuilds.settled(); }
  if (srv) {
    srv.closeAllConnections?.();
    await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500).unref())]);
  }
  _resetForTests();
  for (const k of SAVED_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await rm(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function waitFor(pred, timeoutMs = 4000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => { const v = pred(); if (v) return res(v);
      if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out'));
      setTimeout(tick, 15); };
    tick();
  });
}

test('a drain pauses live builds, waits for their agents, and refuses new starts', async () => {
  const d = createDesign({ kind: 'web', title: 'T', engine: 'claude' }, { by: 'local' });
  const { buildId } = await mod.designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=2 MOCK_HANG_SECTION=hero', by: 'local' });
  await waitFor(() => mod.designBuilds.get(buildId)?.status === 'building' && mod.designBuilds.liveAgentCount() > 0);
  // The first pause throws: the drain logs it, and the next 200 ms poll pauses the build. Without pauseNow's own
  // try/catch the drain would reject here.
  mod.designBuilds.pauseAll = function () { delete this.pauseAll; throw new Error('pause boom'); };
  await mod.drainServer({ timeoutMs: 5000 });
  assert.equal(Object.hasOwn(mod.designBuilds, 'pauseAll'), false, 'the throwing pause ran');
  assert.equal(mod.designBuilds.liveAgentCount(), 0);
  await mod.designBuilds.settled();
  assert.deepEqual([getBuild(buildId).status, getBuild(buildId).reason], ['paused', 'drain']);
  await assert.rejects(mod.designBuilds.start({ designId: d.id, brief: 'x', by: 'local' }), (e) => e.status === 503);
});
