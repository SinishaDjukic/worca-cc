// test/api-run-telemetry.test.mjs — GET /api/runs/:id/telemetry (flag runTelemetry): 404 while off, the
// per-step summary of a run that recorded, 404 for a run that recorded nothing or no run at all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);
let sandboxHome, srv, base, projectDir;
const prevEnv = {};
const get = async (path) => {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-tel-api-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK', 'WORCA_FLAGS']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = '-runTelemetry';
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  projectDir = gitDir('telemetry');
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

async function mockRun() {
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const orch = createOrchestrator({ projectDir, prompt: 'demo task', auto: true, claude: { mock: true } });
  const res = await orch.run();
  assert.equal(res.status, 'done');
  return orch.getState();
}

test('a run recorded with the flag on: 404 while the flag is off, the per-step summary once on', async () => {
  process.env.WORCA_FLAGS = 'runTelemetry';
  const st = await mockRun();
  process.env.WORCA_FLAGS = '-runTelemetry';
  assert.equal((await get(`/api/runs/${st.id}/telemetry`)).status, 404, 'a disabled feature looks absent');
  process.env.WORCA_FLAGS = 'runTelemetry';
  const r = await get(`/api/runs/${st.id}/telemetry`);
  assert.equal(r.status, 200);
  assert.equal(r.body.version, 1);
  const agentStep = st.steps.find((s) => s.agentKey);
  assert.ok(r.body.steps[agentStep.key], 'keyed by step key');
  assert.ok(r.body.harness.persists > 0);
});

test('a run recorded with the flag off, and an unknown run: 404', async () => {
  process.env.WORCA_FLAGS = '-runTelemetry';
  const st = await mockRun();
  process.env.WORCA_FLAGS = 'runTelemetry';
  assert.deepEqual(await get(`/api/runs/${st.id}/telemetry`), { status: 404, body: { error: 'no telemetry' } });
  assert.equal((await get('/api/runs/nope/telemetry')).status, 404);
});
