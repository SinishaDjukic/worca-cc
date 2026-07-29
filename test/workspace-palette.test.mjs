// test/workspace-palette.test.mjs
// M4 §6.6: scope:'workspace-only' agents are kept OUT of the single-project Composer
// palette. The filter point is GET /api/agents (the palette source). The two
// workspace agents must never appear there; the original 7 must all remain.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';

let homeDir, srv, base, prevHome;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-palettehome-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  // /api/agents here is FS-source-backed (loadAgentRegistry reads files, not the
  // DB), so this reset is DEFENSIVE-ONLY (A15(4)) — kept for consistency so this
  // file never inherits/leaks a singleton handle in the shared `node --test` run.
  _resetForTests();
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true });
});

test('GET /api/agents excludes scope:"workspace-only" agents from the palette', async () => {
  const r = await fetch(`${base}/api/agents`);
  assert.equal(r.status, 200);
  const { agents } = await r.json();
  const keys = agents.map((a) => a.key);
  assert.ok(!keys.includes('workspaceScanner'), 'scanner is non-composable (excluded)');
  assert.ok(!keys.includes('workspaceReviewer'), 'workspace reviewer excluded from single-project palette');
  // The original 9 project agents must all still be offered.
  for (const k of ['clarify', 'planner', 'refiner', 'decomposer', 'implementer', 'reviewer', 'manualTestsChecklist', 'manualWebUiTesting', 'planReviewer']) {
    assert.ok(keys.includes(k), `palette must still offer ${k}`);
  }
  assert.equal(agents.length, 9, 'exactly the 9 project agents are composable');
});

test('GET /api/agents returns palette order (ascending .order)', async () => {
  const r = await fetch(`${base}/api/agents`);
  const { agents } = await r.json();
  const orders = agents.map((a) => a.order);
  assert.deepEqual(orders, [...orders].sort((x, y) => x - y));
});
