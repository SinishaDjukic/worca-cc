// test/scan-auth-gate-routed.test.mjs
// The sign-in gate (refuseSignedOutClaude) is for first-party Claude. A workspace scan whose scan
// agent runs on an endpoint-routed model needs no CLI sign-in — its investigators stay on that
// endpoint (phases.mjs sameEndpointSubagentDirective) — so a signed-out install that reaches its
// models only through a gateway (auto/runnable.mjs) can still Create workspace and Re-scan.
// A first-party scan model is still refused (test/scan-auth-gate.test.mjs).
//
// Real mode with WORCA_CLAUDE_BIN pointing at a fake `claude` that answers `auth status` as
// signed out and fails everything else. HOME is sandboxed: the catalog (settings.json) lives
// under it. POSIX-only (a shell script as the bin).
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
const ENV_KEYS = ['WORCA_MOCK', 'ORCH_MOCK', 'WORCA_CLAUDE_BIN', 'ORCH_CLAUDE_BIN', 'WORCA_BROKER_URL', 'HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', ...CLAUDE_AUTH_ENV_KEYS, ...CLAUDE_AUTH_ENV_FLAGS];
let srv, base, runs, scratch;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const ROUTED = { scanModel: 'gw-model', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' };
const LIVE = new Set(['running', 'starting', 'created', 'pending']);

async function repo(name) {
  const dir = join(scratch, name);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  spawnSync('mkdir', ['-p', dir]);
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}

// The started scan fails fast on the fake CLI; let it settle before teardown removes its home.
async function settled(runId) {
  for (let i = 0; i < 200; i++) {
    const e = runs.get(runId);
    if (!e || !LIVE.has(String(e.status || '').toLowerCase())) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

before(async () => {
  if (skip) return;
  scratch = await mkdtemp(join(tmpdir(), 'worca-cc-scanauth-routed-'));
  const bin = join(scratch, 'claude');
  await writeFile(bin, [
    '#!/bin/sh',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo \'{"loggedIn": false}\'; exit 1; fi',
    'echo \'[claude-code:unrecognized_model] {"model":"gw-model","query_source":"sdk"}\' >&2',
    'exit 1',
  ].join('\n') + '\n');
  await chmod(bin, 0o755);
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  const home = join(scratch, 'home');
  spawnSync('mkdir', ['-p', home]);
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_CLAUDE_BIN = bin;
  clearClaudeAuthCache();
  const { addGlobalModel } = await import('../src/core/settings.mjs');
  // The one model this "install" runs without a Claude sign-in: routed to an endpoint.
  await addGlobalModel({ id: 'gw-model', label: 'Gateway model', efforts: ['medium'], env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' } });
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

test('POST /api/workspaces/scan: signed out, but the scan agent is endpoint-routed → the scan starts', { skip }, async () => {
  const a = await repo('a');
  const b = await repo('b');
  const r = await post('/api/workspaces/scan', { projectPaths: [a, b], name: 'Routed WS', models: ROUTED });
  const body = await r.json();
  assert.notEqual(body.code, 'claude-signed-out', JSON.stringify(body));
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.ok(body.runId, 'a run started');
  await settled(body.runId);
});

test('POST /api/workspaces/scan: signed out and a first-party scan model → still refused', { skip }, async () => {
  const a = await repo('c');
  const b = await repo('d');
  const before = runs.size;
  const r = await post('/api/workspaces/scan', { projectPaths: [a, b], name: 'First-party WS', models: { ...ROUTED, scanModel: 'claude-sonnet-5' } });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'claude-signed-out');
  assert.equal(runs.size, before, 'no run registered');
});

test('POST /api/workspaces/:id/scan (re-scan): signed out, routed scan agent → the scan starts', { skip }, async () => {
  const a = await repo('e');
  const b = await repo('f');
  const { workspace: created } = await (await post('/api/workspaces', { name: 'Routed Rescan WS', projectPaths: [a, b] })).json();
  assert.ok(created.id, JSON.stringify(created));
  const r = await post(`/api/workspaces/${encodeURIComponent(created.id)}/scan`, { models: ROUTED });
  const body = await r.json();
  assert.notEqual(body.code, 'claude-signed-out', JSON.stringify(body));
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.ok(body.runId, 'a run started');
  await settled(body.runId);
});
