// test/api-actions-remote.test.mjs — the Actions gate in remote mode (issue #529, D4).
// A separate file because REMOTE_MODE is fixed when ui/server.mjs is imported. Remote access
// is on (WORCA_ALLOWED_HOSTS + Cloudflare Access with a local JWKS, as api-remote-access.test.mjs).
// fetch() drops a caller-set Host header, so requests that must look remote go through
// http.request with the public Host; an in-container request is a loopback peer + Host 127.0.0.1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { TEAM, AUD, CERTS_URL, makeAccessKey, signAccessJwt, certsFetch } from './helpers/access-jwt.mjs';

const PUBLIC = 'worca-01.example.com';
const accessKey = makeAccessKey();
const fakeCerts = certsFetch({ keys: [accessKey] });
const realFetch = globalThis.fetch;
const ENV_KEYS = ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_MOCK', 'WORCA_ALLOWED_HOSTS', 'WORCA_CF_ACCESS_TEAM_DOMAIN',
  'WORCA_CF_ACCESS_AUD', 'WORCA_ACTIONS_REMOTE', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME'];
const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const NODE = `"${process.execPath}"`;
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
let homeDir, repo, srv, port, key, id, SRV, RUN;

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
/** A remote request whose answer may be a page (the preview proxy): the body as text. `jwt: false`: no Access token. */
function remoteRaw(method, path, { headers = {}, jwt = true } = {}) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: {
      host: PUBLIC, ...(jwt ? { 'cf-access-jwt-assertion': signAccessJwt(accessKey) } : {}), ...headers } }, (resp) => {
      let text = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => { text += c; });
      resp.on('end', () => res({ status: resp.statusCode, text }));
    });
    r.on('error', rej);
    r.end();
  });
}
/** A remote WebSocket upgrade: resolves 'open' or rejects with the HTTP status the server answered. */
function remoteWs(path, { jwt = true } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { host: PUBLIC, origin: 'null',
    ...(jwt ? { 'cf-access-jwt-assertion': signAccessJwt(accessKey) } : {}) } });
  return new Promise((res, rej) => { ws.once('open', () => { ws.terminate(); res('open'); }); ws.once('error', rej); });
}
/** A loopback page Worca did not start, in a range of its own: minting probes the port (another Worca is refused), so
 *  the preview tests never depend on what this machine runs on 4400–4499. */
async function withQuietPort(fn) {
  const { setActionsSettings } = await import('../src/core/settings.mjs');
  const quiet = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/plain' }); s.end('quiet'); });
  await new Promise((r) => quiet.listen(0, '127.0.0.1', r));
  const p = quiet.address().port;
  await setActionsSettings({ portLow: p, portHigh: p });
  try { return await fn(p); } finally {
    await setActionsSettings({ portLow: 4400, portHigh: 4499 });
    quiet.closeAllConnections();
    await new Promise((r) => quiet.close(r));
  }
}
/** An in-container request: loopback peer and Host 127.0.0.1 (no identity needed). */
async function local(method, path, body) {
  const r = await realFetch(`http://127.0.0.1:${port}${path}`, { method,
    headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
async function waitFor(pred, timeoutMs = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apiact-remote-'));
  process.env.WORCA_HOME = homeDir;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_ALLOWED_HOSTS = PUBLIC;
  process.env.WORCA_CF_ACCESS_TEAM_DOMAIN = TEAM;
  process.env.WORCA_CF_ACCESS_AUD = AUD;
  delete process.env.WORCA_ACTIONS_REMOTE;
  _resetForTests();
  globalThis.fetch = (url, opts) => (String(url) === CERTS_URL ? fakeCerts(url) : realFetch(url, opts));

  SRV = join(homeDir, 'srv.mjs');
  await writeFile(SRV, `import http from 'node:http';
http.createServer((q, s) => s.end('ok')).listen(Number(process.env.PORT), '127.0.0.1');
`);
  RUN = { id: 'run', label: 'Run', kind: 'service', cmd: `${NODE} "${SRV}"`,
    env: [{ name: 'PORT', type: 'port', value: 'auto' }], openUrl: 'http://localhost:{PORT}', ready: { kind: 'port' } };

  repo = await mkdtemp(join(tmpdir(), 'worca-cc-apiact-remote-repo-'));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 't@t']);
  git(repo, ['config', 'user.name', 't']);
  await writeFile(join(repo, 'README.md'), '# hi\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'init']);
  git(repo, ['branch', 'worca-cc/r']);
  const { seedPipeline } = await import('./helpers/db-seed.mjs');
  const { addProject, worcaHome } = await import('../src/core/projects.mjs');
  await addProject({ name: basename(repo), path: repo });
  const s = await seedPipeline(repo, { status: 'done',
    branch: { source: 'main', feature: 'worca-cc/r', runRootMode: 'detached', worktreeRemoved: true, branchKept: true } });
  ({ id, key } = s);
  getDb().prepare(`UPDATE pipelines SET branch = json_set(branch, '$.worktreeDir', ?) WHERE id = ?`)
    .run(join(worcaHome(), 'runs', id, 'repos', key), id);

  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  const cfg = await remote('PUT', `/api/projects/${key}/actions`, { setup: `${NODE} -e "console.log('installing')"`, actions: [RUN] });
  assert.equal(cfg.status, 200);
});

after(async () => {
  delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME;
  if (port) {
    const running = await local('GET', '/api/actions/running').catch(() => ({ body: [] }));
    for (const s of running.body || []) await local('POST', `/api/actions/instances/${encodeURIComponent(s.instanceId)}/stop`, {}).catch(() => {});
  }
  if (srv) await new Promise((r) => srv.close(r));
  globalThis.fetch = realFetch;
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await Promise.all([homeDir, repo].filter(Boolean).map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 })));
});

const startPath = () => `/api/runs/${id}/actions/run/start?projectKey=${key}`;

test('remote mode: start is refused with 403 ACTIONS_DISABLED', async () => {
  const r = await remote('POST', startPath(), {});
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'ACTIONS_DISABLED');
  assert.equal((await remote('GET', `/api/runs/${id}/actions?projectKey=${key}`)).body.enabled, false);
});

test('remote mode: open-in-editor is refused on a hosted deployment (403 ACTIONS_DISABLED)', async () => {
  const r = await remote('POST', `/api/runs/${id}/open-in-editor?projectKey=${key}`, { file: 'README.md', line: 1 });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'ACTIONS_DISABLED');
});

test('remote mode: the config can still be edited while actions are off (D4)', async () => {
  const r = await remote('PUT', `/api/projects/${key}/actions`, { setup: `${NODE} -e "console.log('installing')"`, actions: [RUN] });
  assert.equal(r.status, 200);
  assert.equal(r.body.actions[0].id, 'run');
  assert.equal((await remote('POST', startPath(), {})).body.code, 'ACTIONS_DISABLED');
});

test('remote mode: check out still works and the setup command is skipped', async () => {
  const r = await remote('POST', `/api/runs/${id}/checkout?projectKey=${key}`, {});
  assert.equal(r.status, 200);
  await waitFor(async () => (await remote('GET', `/api/runs/${id}/actions?projectKey=${key}`)).body.members[0].checkout?.setup?.status === 'skipped');
});

test('remote mode: an in-container request has no exemption (D4)', async () => {
  const r = await local('POST', startPath(), {});
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'ACTIONS_DISABLED');
});

test('WORCA_ACTIONS_REMOTE=1 enables actions for an identified request', async () => {
  process.env.WORCA_ACTIONS_REMOTE = '1';
  try {
    const r = await remote('POST', startPath(), {});
    assert.equal(r.status, 200);
    assert.ok(r.body.ports.PORT >= 4400 && r.body.ports.PORT <= 4499);
    assert.equal((await remote('POST', `/api/runs/${id}/actions/run/stop?projectKey=${key}`, {})).status, 200);
  } finally { delete process.env.WORCA_ACTIONS_REMOTE; }
});

test('remote mode: the Browser tab\'s preview is refused while actions are off, minting, pages and upgrades alike', async () => {
  const mint = await remote('POST', '/api/preview/sessions', { port: 4400 });
  assert.equal(mint.status, 403);
  assert.equal(mint.body.code, 'ACTIONS_DISABLED');
  await withQuietPort(async (p) => {
    process.env.WORCA_ACTIONS_REMOTE = '1';   // a token minted while actions were on: the gate, not the token, refuses
    const { base } = (await remote('POST', '/api/preview/sessions', { port: p })).body;
    delete process.env.WORCA_ACTIONS_REMOTE;
    const page = await remoteRaw('GET', base, { headers: { origin: 'null' } });
    assert.equal(page.status, 403);
    assert.match(page.text, /"ACTIONS_DISABLED"/);
    await assert.rejects(remoteWs(base), /403/);
  });
});

test('WORCA_ACTIONS_REMOTE=1: a signed-in person reaches the server\'s loopback through the proxy; no sign-in, no preview', async () => {
  process.env.WORCA_ACTIONS_REMOTE = '1';
  try {
    const mint = await withQuietPort(async (p) => {
      const m = await remote('POST', '/api/preview/sessions', { port: p });
      assert.equal(m.status, 201);
      const page = await remoteRaw('GET', m.body.base, { headers: { origin: 'null' } });
      assert.deepEqual([page.status, page.text], [200, 'quiet'], 'the proxy answered with the page');
      return m;
    });
    const page = await remoteRaw('GET', mint.body.base, { headers: { origin: 'null' } });
    assert.equal(page.status, 403, 'the range narrowed again: the same token is refused');
    assert.doesNotMatch(page.text, /"(ACTIONS_DISABLED|TOKEN_UNKNOWN)"/);
    assert.equal((await remoteRaw('GET', mint.body.base, { jwt: false })).status, 401, 'the identity check runs for /preview/ too');
    await assert.rejects(remoteWs(mint.body.base, { jwt: false }), /401/);
  } finally { delete process.env.WORCA_ACTIONS_REMOTE; }
});

test('hosted: Preview ports is enforced to the Actions range — a stored "all" is ignored and a POST of "all" is refused', async () => {
  const { setActionsSettings } = await import('../src/core/settings.mjs');
  process.env.WORCA_ACTIONS_REMOTE = '1';
  const outside = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/plain' }); s.end('outside'); });
  await new Promise((r) => outside.listen(0, '127.0.0.1', r));
  const p = outside.address().port;
  try {
    await setActionsSettings({ previewPorts: 'all' });            // planted directly, as an old file or another tool could
    const mint = await remote('POST', '/api/preview/sessions', { port: p });
    assert.equal(mint.status, 403, 'any loopback port on a hosted server is an SSRF into its own services');
    assert.equal(mint.body.code, 'PORT_NOT_ALLOWED');
    assert.equal(mint.body.error, `Port ${p} is outside the ports Worca previews on this hosted deployment: 4400–4499 and running Actions.`);
    const save = await remote('POST', '/api/settings', { actions: { previewPorts: 'all' } });
    assert.equal(save.status, 400);
    assert.equal(save.body.field, 'actions.previewPorts');
    assert.equal(save.body.error, 'Preview ports stays "Actions range only" on a hosted Worca.');
    const got = await remote('GET', '/api/settings');
    assert.equal(got.body.actionsGate.previewPorts, 'range');
    assert.equal(got.body.actionsGate.previewPortsLocked, true);
    assert.equal((await remote('POST', '/api/settings', { actions: { previewPorts: 'range' } })).status, 200, '"range" is always fine');
  } finally {
    await setActionsSettings({ previewPorts: null });
    delete process.env.WORCA_ACTIONS_REMOTE;
    outside.closeAllConnections();
    await new Promise((r) => outside.close(r));
  }
});

test('WORCA_ACTIONS_REMOTE=1 + agent isolation: in-container callers are refused, Stop included; people are not', async () => {
  process.env.WORCA_ACTIONS_REMOTE = '1';
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(homeDir, 'agent');
  try {
    const inStart = await local('POST', startPath(), {});
    assert.equal(inStart.status, 403);
    assert.equal(inStart.body.code, 'AGENT_CALLER_BLOCKED');
    const inPut = await local('PUT', `/api/projects/${key}/actions`, { setup: 'true', actions: [] });
    assert.equal(inPut.status, 403);
    assert.equal(inPut.body.code, 'AGENT_CALLER_BLOCKED');
    const inSettings = await local('POST', '/api/settings', { actions: { editor: '/tmp/x.sh' } });
    assert.equal(inSettings.status, 403);
    assert.equal(inSettings.body.code, 'AGENT_CALLER_BLOCKED');
    assert.equal((await remote('GET', '/api/settings')).body.actions.editor, '');
    // the config was not replaced by the refused PUT
    assert.equal((await remote('GET', `/api/projects/${key}/actions`)).body.config.actions[0].id, 'run');

    const person = await remote('POST', startPath(), {});
    assert.equal(person.status, 200);
    // G1: a possible agent gets no API at all, so it cannot stop a person's service either.
    const inStop = await local('POST', `/api/runs/${id}/actions/run/stop?projectKey=${key}`, {});
    assert.deepEqual([inStop.status, inStop.body.code], [403, 'AGENT_CALLER_BLOCKED']);
    assert.equal((await remote('POST', `/api/runs/${id}/actions/run/stop?projectKey=${key}`, {})).status, 200);
  } finally {
    delete process.env.WORCA_ACTIONS_REMOTE; delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME;
  }
});
