// test/scan-auth-gate.test.mjs
// ui/server.mjs: both scan endpoints and agent generation refuse up front (409,
// code 'claude-signed-out') when `claude auth status` says signed out — nothing
// is started. Before, the scan ran its first phase and died ~30 s later with
// "claude exited with code 1: Not logged in".
//
// Real mode (no WORCA_MOCK) with WORCA_CLAUDE_BIN pointing at a fake `claude`
// shell script that answers `auth status` as signed out and fails everything
// else the way a signed-out CLI does, so no real Claude is ever started.
// The run overview (a cached answer needs no Claude) maps that failure to the
// same 409 instead of probing up front. POSIX-only (a shell script as the bin).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { CLAUDE_AUTH_ENV_KEYS, CLAUDE_AUTH_ENV_FLAGS, clearClaudeAuthCache } from '../src/core/preflight.mjs';

const skip = process.platform === 'win32' ? 'the fake claude is a shell script' : false;

useTempHome(after);

const saved = {};
const ENV_KEYS = ['WORCA_MOCK', 'ORCH_MOCK', 'WORCA_CLAUDE_BIN', 'ORCH_CLAUDE_BIN', ...CLAUDE_AUTH_ENV_KEYS, ...CLAUDE_AUTH_ENV_FLAGS];
// db-seed and ui/server.mjs load claude-runner, whose default bin is read at import:
// both are imported only AFTER WORCA_CLAUDE_BIN points at the fake.
let srv, base, runs, scratch, seedPipeline;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });

async function repo(name) {
  const dir = join(scratch, name);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  spawnSync('mkdir', ['-p', dir]);
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}

before(async () => {
  if (skip) return;
  scratch = await mkdtemp(join(tmpdir(), 'worca-cc-scanauth-'));
  const bin = join(scratch, 'claude');
  await writeFile(bin, [
    '#!/bin/sh',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo \'{"loggedIn": false}\'; exit 1; fi',
    'echo "Not logged in · Please run /login" >&2',
    'exit 1',
  ].join('\n') + '\n');
  await chmod(bin, 0o755);
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.WORCA_CLAUDE_BIN = bin;
  clearClaudeAuthCache();
  ({ seedPipeline } = await import('./helpers/db-seed.mjs'));
  const mod = await import('../ui/server.mjs');
  runs = mod.runs;
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (skip) return;
  if (srv) await new Promise((r) => srv.close(r));
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  clearClaudeAuthCache();
  await rm(scratch, { recursive: true, force: true });
});

const scans = () => [...runs.values()].filter((r) => r.kind === 'scan').length;

test('POST /api/workspaces/scan: signed-out Claude → 409 claude-signed-out, no scan started', { skip }, async () => {
  const a = await repo('a');
  const b = await repo('b');
  const r = await post('/api/workspaces/scan', { projectPaths: [a, b], name: 'Gate WS' });
  assert.equal(r.status, 409);
  const body = await r.json();
  assert.equal(body.code, 'claude-signed-out');
  assert.match(body.error, /isn't signed in/);
  assert.match(body.error, /\/login/);
  assert.equal(body.scanId, undefined);
  assert.equal(scans(), 0, 'no scan entry registered');
});

test('POST /api/workspaces/:id/scan (re-scan): same refusal', { skip }, async () => {
  const a = await repo('c');
  const b = await repo('d');
  const { workspace: created } = await (await post('/api/workspaces', { name: 'Gate Rescan WS', projectPaths: [a, b] })).json();
  assert.ok(created.id, JSON.stringify(created));
  const r = await post(`/api/workspaces/${encodeURIComponent(created.id)}/scan`, {});
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'claude-signed-out');
  assert.equal(scans(), 0);
});

test('POST /api/agents/generate: same refusal, no generation started', { skip }, async () => {
  const r = await post('/api/agents/generate', { name: 'Gate Agent', purpose: 'p' });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'claude-signed-out');
  assert.equal([...runs.values()].filter((e) => e.kind === 'agentgen').length, 0);
});

test('POST /api/runs/:id/overview: a signed-out CLI failure → 409 claude-signed-out, not a raw 500', { skip }, async () => {
  const proj = await repo('e');
  const { id, key } = await seedPipeline(proj, { title: 'overview', status: 'done' });
  const r = await fetch(`${base}/api/runs/${id}/overview?key=${encodeURIComponent(key)}`, { method: 'POST' });
  const body = await r.json();
  assert.equal(r.status, 409, JSON.stringify(body));
  assert.equal(body.code, 'claude-signed-out');
  assert.match(body.error, /isn't signed in/);
});

test('GET /api/onboarding: signed-out Claude is not ticked; ?recheck=1 answers the same', { skip }, async () => {
  for (const q of ['', '?recheck=1']) {
    const s = await (await fetch(`${base}/api/onboarding${q}`)).json();
    assert.equal(s.claude.auth, 'signed-out');
    assert.equal(s.steps.claude, false);
  }
});
