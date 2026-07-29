// test/api-workflows-warnings.test.mjs — POST /api/workflows surfaces soft
// validateWorkflow warnings (currently dropped at ui/server.mjs:1418-1424).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let srv, base, homeDir, prevHome;
const JSONH = { 'Content-Type': 'application/json' };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wfwarn-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true });
});

const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });

test('a soft-invalid topology saves 201 WITH a non-empty warnings array', async () => {
  // planner -> manualWebUiTesting yields exactly ONE soft warning: governance —
  // planner.connectsTo = ["refiner","implementer","planReviewer","decomposer"]
  // does not admit manualWebUiTesting. (Its consumes — checklist + code — are
  // both PRE-SEEDED per workflow-validator.mjs:109, so the reachability pass
  // stays quiet; do not expect a "checklist" warning here.)
  const r = await post('/api/workflows', {
    name: 'Warny',
    steps: [[{ id: 's0_0', key: 'planner' }], [{ id: 's1_0', key: 'manualWebUiTesting' }]],
    feedbacks: [],
  });
  assert.equal(r.status, 201);
  const data = await r.json();
  assert.ok(data.workflow && data.workflow.id, 'workflow persisted');
  assert.ok(Array.isArray(data.warnings) && data.warnings.length >= 1, 'warnings surfaced');
  assert.ok(data.warnings.some((w) => /not allowed to connect/.test(w)), 'carries the governance text');
});

test('a clean topology saves 201 with warnings: []', async () => {
  const r = await post('/api/workflows', {
    name: 'Cleany',
    steps: [[{ id: 's0_0', key: 'planner' }], [{ id: 's1_0', key: 'implementer' }]],
    feedbacks: [],
  });
  assert.equal(r.status, 201);
  const data = await r.json();
  assert.deepEqual(data.warnings, []);
});
