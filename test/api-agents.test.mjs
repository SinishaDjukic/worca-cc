// test/api-agents.test.mjs — the v2 /api/agents ROUTE surface (test/api-agents-
// domain.test.mjs covers listAgents() directly; nothing covered the HTTP shape).
// The payload is what the palette and the Agents-view port editor render from:
// v2 registry entries carrying META ports only — the universal `await` gate is
// SYNTHESIZED per graph node and must never appear here, because the client
// mirrors that synthesis itself — plus the capability fields, the `placeable`
// flag the palette filters on, and `mockWriterRoles` (ui/public cannot import
// src/core: no build step, so the mockRole select is fed from this response).
// Harness = the Variant A boot used by api-workflows/api-plugins.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MOCK_WRITER_ROLES } from '../src/core/claude-runner.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let homeDir, srv, base, prevHome;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-agentsapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const { app } = await import('../ui/server.mjs'); // imported => no port bind
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
});

const get = (p) => fetch(`${base}${p}`);
const byKey = (agents, key) => agents.find((a) => a.key === key);

test('GET /api/agents returns the palette registry in .order ascending', async () => {
  const r = await get('/api/agents');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.agents), 'agents is an array (palette render order)');
  const keys = j.agents.map((a) => a.key);
  for (const k of ['clarify', 'planner', 'refiner', 'decomposer', 'implementer',
                   'reviewer', 'manualTestsChecklist', 'manualWebUiTesting', 'planReviewer']) {
    assert.ok(keys.includes(k), `registry includes ${k}`);
  }
  const orders = j.agents.map((a) => a.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), 'ordered by .order');
  // Each pill carries what the palette needs to render.
  const planner = byKey(j.agents, 'planner');
  assert.ok(planner.displayName, 'has a displayName');
  assert.ok(planner.color, 'has a color token');
});

test('GET /api/agents entries are meta v2 with ports and a portSummary', async () => {
  const { agents } = await (await get('/api/agents')).json();
  for (const a of agents) {
    assert.equal(a.metaVersion, 2, `${a.key} is a v2 entry`);
    assert.ok(Array.isArray(a.inputs), `${a.key} carries inputs`);
    assert.ok(Array.isArray(a.outputs) && a.outputs.length >= 1, `${a.key} carries >= 1 output`);
    assert.equal(typeof a.portSummary, 'string');
    assert.equal(typeof a.runnerType, 'string');
  }
  const reviewer = byKey(agents, 'reviewer');
  assert.deepEqual(reviewer.inputs.map((i) => i.id), ['plan', 'done']);
  assert.deepEqual(reviewer.outputs.map((o) => [o.id, o.type, o.when]),
    [['review', 'md', 'blocking'], ['pass', 'void', 'clean']]);
});

test('GET /api/agents ships META ports only — never the synthesized await gate', async () => {
  const { agents } = await (await get('/api/agents?all=1')).json();
  for (const a of agents) {
    assert.ok(!a.inputs.some((i) => i.id === 'await'),
      `${a.key} must not carry the synthesized await port (the client mirrors the synthesis)`);
    assert.ok(!a.inputs.some((i) => i.synthetic), `${a.key} exposes no synthetic port`);
  }
});

test('GET /api/agents carries the capability fields the port editor edits', async () => {
  const { agents } = await (await get('/api/agents?all=1')).json();
  const reviewer = byKey(agents, 'reviewer');
  assert.deepEqual(reviewer.verdict, { filename: 'impl-review-cycle{cycle}.json' });
  assert.equal(reviewer.mockRole, 'reviewer');
  assert.equal(reviewer.wantsRequest, true);
  assert.equal(reviewer.workspaceStrategy, 'review');

  assert.equal(byKey(agents, 'implementer').sideEffect, 'code');
  assert.equal(byKey(agents, 'workspaceReviewer').workspaceVariantOf, 'reviewer');
  // Port-level capability fields survive serialization too.
  assert.equal(reviewer.inputs.find((i) => i.id === 'done').as, 'worktree');
  assert.equal(reviewer.outputs.find((o) => o.id === 'review').artifactKind, 'review');
});

test('GET /api/agents flags placeable:false so the palette can filter it out', async () => {
  const all = await (await get('/api/agents?all=1')).json();
  const scanner = byKey(all.agents, 'workspaceScanner');
  assert.ok(scanner, '?all=1 exposes workspace-only agents to the Agents view');
  assert.equal(scanner.placeable, false, 'never a graph node — the palette filters on this');
  // Every other entry is placeable (absent flag = placeable).
  for (const a of all.agents) {
    if (a.key !== 'workspaceScanner') assert.notEqual(a.placeable, false, `${a.key} is placeable`);
  }
  // The default (palette) response drops workspace-only agents entirely.
  const palette = await (await get('/api/agents')).json();
  assert.ok(!palette.agents.some((a) => a.scope === 'workspace-only'));
});

test('GET /api/agents ships mockWriterRoles for the port editor select', async () => {
  const j = await (await get('/api/agents')).json();
  assert.deepEqual(j.mockWriterRoles, [...MOCK_WRITER_ROLES]);
  // Pin the members the builtin sidecars actually name, so a writer-switch edit
  // that drops one is caught here and not only in the mock runner.
  for (const role of ['clarify', 'planner-plan', 'refiner', 'decomposer', 'implementer',
                      'reviewer', 'plan-review', 'workspace-scan', 'workspace-reviewer',
                      'manual-tests-checklist', 'manual-web-ui-testing']) {
    assert.ok(j.mockWriterRoles.includes(role), `mockWriterRoles includes ${role}`);
  }
  // Same list regardless of the palette filter.
  const all = await (await get('/api/agents?all=1')).json();
  assert.deepEqual(all.mockWriterRoles, j.mockWriterRoles);
});

test('GET /api/agents/:key returns { meta, markdown }; unknown -> 404', async () => {
  const r = await get('/api/agents/reviewer');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.meta.key, 'reviewer');
  assert.equal(j.meta.metaVersion, 2);
  assert.ok(Array.isArray(j.meta.outputs));
  assert.ok(typeof j.markdown === 'string' && j.markdown.length, 'the agent body travels with the meta');

  assert.equal((await get('/api/agents/nopeNotAnAgent')).status, 404);
  assert.equal((await get(`/api/agents/${encodeURIComponent('../../etc/passwd')}`)).status, 404);
});
