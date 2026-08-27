import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, prepare } from '../src/core/db.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';

// Boot preamble lifted VERBATIM from test/api-workflows.test.mjs:1-36 (only the
// mkdtemp prefix differs).
useTempHome(after);

let homeDir, srv, base, prevHome;
const CLI = resolve(fileURLToPath(import.meta.url), '..', '..', 'src', 'cli', 'worca-cc.mjs');

before(async () => {
  // Redirect the global ~/.worca-cc (workflow store) into a sandbox.
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-rungate-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1'; // keep /api/run offline
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

const api = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

// A run needs its OWN project dir + `mock: true` — the recipe of
// test/api-workflows.test.mjs:173-210. NEVER pass `homeDir`: the store and the
// pipeline dirs would nest inside the project, and this file's `after` removes
// homeDir while the orchestrator may still be writing into it.
const projects = [];
const runDir = async () => {
  const d = await mkdtemp(join(tmpdir(), 'worca-cc-run-'));
  projects.push(d);
  return d;
};
after(() => Promise.all(projects.map((d) => rm(d, { recursive: true, force: true }))));

test('POST /api/run refuses a graph row with one clean 400', async () => {
  await writeGraphWorkflow({ id: 'wf_graph', name: 'G', nodes: [], wires: [] });
  const r = await api('POST', '/api/run',
    { projectDir: await runDir(), prompt: 'hi', workflowId: 'wf_graph', mock: true });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'template is a graph — runs on the graph engine (not available yet)');
});

test('POST /api/run: unknown id 400, archived id 400 with the archive message', async () => {
  const unknown = await api('POST', '/api/run',
    { projectDir: await runDir(), prompt: 'hi', workflowId: 'wf_nope', mock: true });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, 'unknown workflowId "wf_nope"');
  await writeGraphWorkflow({ id: 'wf_arch2', name: 'A', nodes: [], wires: [] });
  getDb();
  prepare('UPDATE workflows SET archived_at = ? WHERE id = ?').run('2026-08-27T00:00:00Z', 'wf_arch2');
  const arch = await api('POST', '/api/run',
    { projectDir: await runDir(), prompt: 'hi', workflowId: 'wf_arch2', mock: true });
  assert.equal(arch.status, 400);
  assert.match(arch.body.error, /was archived by the v2 upgrade/);
});

test('a v1 row still runs (the gate is not a wall)', async () => {
  const r = await api('POST', '/api/run',
    { projectDir: await runDir(), prompt: 'hi', workflowId: 'wf_default', mock: true });
  assert.equal(r.status, 200);
  assert.ok(r.body.runId);
});

// The CLI arm. Without this the whole `if (flags.workflow) { … }` block can be
// deleted and every other suite stays green (measured). The child inherits
// process.env, so useTempHome's WORCA_HOME reaches it and it sees the same rows.
test('the CLI --workflow gate: a graph row and an archived row each exit 2', async () => {
  await writeGraphWorkflow({ id: 'wf_cligraph', name: 'CG', nodes: [], wires: [] });
  await writeGraphWorkflow({ id: 'wf_cliarch', name: 'CA', nodes: [], wires: [] });
  getDb();
  prepare('UPDATE workflows SET archived_at = ? WHERE id = ?').run('2026-08-27T00:00:00Z', 'wf_cliarch');
  // NOTE: there is NO `run` SUBCOMMAND — `SUBCOMMANDS` (`worca-cc.mjs:1459`) is
  // add/list/remove/resume/doctor/plugin/marketplace/config, and a bare
  // invocation IS the run path (a stray 'run' token would be parsed as the
  // prompt). Recipe copied from test/cli-branch-flags.test.mjs:52-56.
  const project = await runDir();
  const run = (id) => spawnSync(process.execPath,
    [CLI, '--project', project, '--prompt', 'x', '--mock', '--yes', '--workflow', id],
    { env: { ...process.env, WORCA_HOME: homeDir, WORCA_MOCK: '1' }, encoding: 'utf8' });
  const graph = run('wf_cligraph');
  assert.equal(graph.status, 2, `expected exit 2, got ${graph.status}: ${graph.stderr}`);
  assert.match(graph.stderr, /worca: template is a graph — runs on the graph engine \(not available yet\)/);
  const archived = run('wf_cliarch');
  assert.equal(archived.status, 2);
  assert.match(archived.stderr, /worca: workflow "wf_cliarch" was archived by the v2 upgrade/);
});
