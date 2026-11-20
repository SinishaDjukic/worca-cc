// test/api-terminal-remote.test.mjs — the terminal's hosted gate (issue #573). A separate file because
// REMOTE_MODE is fixed when ui/server.mjs is imported. Same remote setup as api-actions-remote.test.mjs:
// WORCA_ALLOWED_HOSTS + Cloudflare Access with a local JWKS. fetch() drops a caller-set Host, so remote
// requests go through http.request; an in-container request is a loopback peer with Host 127.0.0.1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { _resetForTests } from '../src/core/db.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { TEAM, AUD, CERTS_URL, makeAccessKey, signAccessJwt, certsFetch } from './helpers/access-jwt.mjs';

const PUBLIC = 'worca-01.example.com';
const accessKey = makeAccessKey();
const fakeCerts = certsFetch({ keys: [accessKey] });
const realFetch = globalThis.fetch;
const ENV_KEYS = ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_MOCK', 'WORCA_ALLOWED_HOSTS', 'WORCA_CF_ACCESS_TEAM_DOMAIN',
  'WORCA_CF_ACCESS_AUD', 'WORCA_TERMINAL_REMOTE', 'WORCA_TERMINAL_PTY', 'SHELL', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME'];
const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
let homeDir, repo, wt, srv, port, key;

/** A request through the public Host with a valid Access token (a signed-in person). */
function remote(method, path, body) {
  const data = body === undefined ? null : JSON.stringify(body);
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: {
      host: PUBLIC, origin: `https://${PUBLIC}`, 'cf-access-jwt-assertion': signAccessJwt(accessKey),
      ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (resp) => {
      let text = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => { text += c; });
      resp.on('end', () => res({ status: resp.statusCode, body: text ? JSON.parse(text) : null }));
    });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}
/** An in-container request: loopback peer and Host 127.0.0.1 (no identity). */
async function local(method, path, body) {
  const r = await realFetch(`http://127.0.0.1:${port}${path}`, { method,
    headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
const openPath = () => `/api/runs/run-live/terminal?projectKey=${key}`;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apiterm-remote-'));
  Object.assign(process.env, { WORCA_HOME: homeDir, HOME: homeDir, USERPROFILE: homeDir, WORCA_MOCK: '1', WORCA_ALLOWED_HOSTS: PUBLIC,
    WORCA_CF_ACCESS_TEAM_DOMAIN: TEAM, WORCA_CF_ACCESS_AUD: AUD, WORCA_TERMINAL_PTY: '0', SHELL: '/bin/sh' });
  delete process.env.WORCA_TERMINAL_REMOTE;
  _resetForTests();
  globalThis.fetch = (url, opts) => (String(url) === CERTS_URL ? fakeCerts(url) : realFetch(url, opts));
  repo = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-apiterm-remote-repo-')));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 't@t']);
  git(repo, ['config', 'user.name', 't']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const { addProject } = await import('../src/core/projects.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  await addProject({ name: basename(repo), path: repo });
  key = projectKey(repo);
  wt = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-apiterm-remote-wt-')));
  seedPipelineRow({ id: 'run-live', projectKey: key, status: 'paused', branch: { feature: 'worca/f', worktreeDir: wt } });
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});

after(async () => {
  delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME;
  if (port) {
    const open = await local('GET', '/api/terminal').catch(() => ({ body: { sessions: [] } }));
    for (const s of open.body?.sessions || []) await local('DELETE', `/api/terminal/sessions/${s.id}`).catch(() => {});
  }
  if (srv) await new Promise((r) => srv.close(r));
  globalThis.fetch = realFetch;
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await Promise.all([homeDir, repo, wt].filter(Boolean).map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 })));
});

test('hosted without WORCA_TERMINAL_REMOTE: open refused, nothing listed', async () => {
  const g = await remote('GET', '/api/terminal');
  assert.equal(g.body.enabled, false);
  assert.deepEqual(g.body.sessions, []);
  const r = await remote('POST', openPath(), {});
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'TERMINAL_DISABLED');
  assert.equal((await remote('GET', '/api/terminal/audit?runId=run-live')).body.code, 'TERMINAL_DISABLED');
  const p = await remote('POST', `/api/projects/${key}/terminal`, {});
  assert.equal(p.status, 403, 'nor in the project\'s own folder');
  assert.equal(p.body.code, 'TERMINAL_DISABLED');
});

test('WORCA_TERMINAL_REMOTE=1 lets a signed-in person open one', async () => {
  process.env.WORCA_TERMINAL_REMOTE = '1';
  try {
    const r = await remote('POST', openPath(), {});
    assert.equal(r.status, 201);
    assert.equal((await remote('DELETE', `/api/terminal/sessions/${r.body.session.id}`)).status, 200);
  } finally { delete process.env.WORCA_TERMINAL_REMOTE; }
});

test('a possible agent (in-container caller under isolation) cannot open, stop or close; a person can', async () => {
  process.env.WORCA_TERMINAL_REMOTE = '1';
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(homeDir, 'agent');
  try {
    const r = await local('POST', openPath(), {});
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'AGENT_CALLER_BLOCKED');
    const person = await remote('POST', openPath(), {});
    assert.equal(person.status, 201);
    const id = person.body.session.id;
    for (const [method, path] of [['POST', `/api/terminal/sessions/${id}/stop`], ['DELETE', `/api/terminal/sessions/${id}`]]) {
      const r = await local(method, path, method === 'POST' ? {} : undefined);
      assert.equal(r.status, 403, `${method} ${path}: an agent cannot stop or close a person's terminal`);
      assert.equal(r.body.code, 'AGENT_CALLER_BLOCKED');
    }
    assert.equal((await remote('POST', `/api/terminal/sessions/${id}/stop`, {})).status, 200, 'the person can stop it');
    assert.equal((await remote('DELETE', `/api/terminal/sessions/${id}`)).status, 200, 'and close it');
  } finally {
    delete process.env.WORCA_TERMINAL_REMOTE; delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME;
  }
});

test('Stop and Close skip the hosted gate: a person can end a terminal after WORCA_TERMINAL_REMOTE is turned off (D4)', async () => {
  process.env.WORCA_TERMINAL_REMOTE = '1';
  let id;
  try {
    const r = await remote('POST', openPath(), {});
    assert.equal(r.status, 201);
    id = r.body.session.id;
  } finally { delete process.env.WORCA_TERMINAL_REMOTE; }
  assert.equal((await remote('POST', `/api/terminal/sessions/${id}/stop`, {})).status, 200);
  assert.equal((await remote('DELETE', `/api/terminal/sessions/${id}`)).status, 200);
});

test('Ask agent mode (#574) follows the hosted gate: no bridge, the status says off, the bridge route refuses', async () => {
  const { _testing } = await import('../ui/server.mjs');
  assert.equal(_testing.askCommandsEnabled(), false);
  assert.equal(_testing.askCommandBridge({ threadId: 'ask_00000000' }), null);
  assert.equal((await remote('GET', '/api/ask/commands/status')).body.enabled, false);
  assert.equal((await local('GET', '/api/ask/commands/status')).body.enabled, false);
  process.env.WORCA_TERMINAL_REMOTE = '1';
  try {
    assert.equal(_testing.askCommandsEnabled(), true);
    assert.equal((await remote('GET', '/api/ask/commands/status')).body.enabled, true);
    const b = _testing.askCommandBridge({ threadId: 'ask_00000000' });
    assert.ok(b && b.token);
    b.dispose();
  } finally { delete process.env.WORCA_TERMINAL_REMOTE; }
});
