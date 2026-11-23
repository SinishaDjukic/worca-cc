// test/api-preview.test.mjs — the Browser tab's server surface (issue 1064), local mode: minting a preview token,
// the /preview/ proxy behind the HTTP gates (Host, never Origin), its refusals (ports outside the set, Worca's own port,
// unknown tokens, another Host), a WebSocket upgrade through it (dev-server HMR), and the dev server offer: "Use this"
// saves a project Action that starts in a run's checkout and opens through the proxy.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

const ENV_KEYS = ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME'];
const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const created = [];
const closers = [];
const JSONH = { 'Content-Type': 'application/json' };
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
let homeDir, srv, port, base, repo, key, runId, upstream, upstreamPort;

const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const put = (p, body) => fetch(`${base}${p}`, { method: 'PUT', headers: JSONH, body: JSON.stringify(body) });
const getJson = async (p) => (await fetch(`${base}${p}`)).json();
/** fetch() drops a caller-set Host and Origin: this sends them as given and answers the body as text. */
function raw(method, path, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
/** A loopback page Worca did not start, in a range of its own: minting probes the port (another Worca is refused), so
 *  these tests never depend on what this machine runs on 4400–4499. */
async function withQuietPort(fn) {
  const quiet = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/plain' }); s.end('quiet'); });
  await new Promise((r) => quiet.listen(0, '127.0.0.1', r));
  const p = quiet.address().port;
  assert.equal((await post('/api/settings', { actions: { portLow: p, portHigh: p, previewPorts: 'range' } })).status, 200);
  try { return await fn(p); } finally {
    await post('/api/settings', { actions: { portLow: 4400, portHigh: 4499, previewPorts: null } });
    quiet.closeAllConnections();
    await new Promise((r) => quiet.close(r));
  }
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
/** A dev server: an HTML page with root-relative assets, a page that refuses framing, and an echo WebSocket. */
const DEV_SERVER = `import http from 'node:http';
import { createHash } from 'node:crypto';
const srv = http.createServer((q, s) => {
  if (q.url === '/framed') { s.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' }); return s.end('<p>no</p>'); }
  s.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'sid=1' });
  s.end('<html><head></head><body><script type="module" src="/@vite/client"></script>cookie=' + (q.headers.cookie || '') + '</body></html>');
});
srv.on('upgrade', (q, sock) => {
  const accept = createHash('sha1').update(q.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: ' + accept + '\\r\\n\\r\\n');
  sock.on('data', () => sock.write(Buffer.from([0x81, 0x02, 0x6f, 0x6b])));   // one text frame: "ok"
  sock.on('end', () => sock.destroy());
});
srv.listen(Number(process.env.PORT), '127.0.0.1');
`;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apipreview-home-'));
  Object.assign(process.env, { WORCA_HOME: homeDir, HOME: homeDir, USERPROFILE: homeDir });
  _resetForTests();
  repo = await realpath(templateRepo('apipreview', { branch: 'main', user: true, prefix: 'worca-cc-apipreview-',
    files: { 'README.md': '# hi\n', 'dev.mjs': DEV_SERVER, 'package.json': JSON.stringify({ scripts: { dev: 'node dev.mjs' } }) } }));
  created.push(repo);
  const { seedPipeline } = await import('./helpers/db-seed.mjs');
  const { addProject, worcaHome } = await import('../src/core/projects.mjs');
  await addProject({ name: basename(repo), path: repo });
  git(repo, ['branch', 'worca-cc/p']);
  const s = await seedPipeline(repo, { status: 'done', branch: { source: 'main', feature: 'worca-cc/p', runRootMode: 'detached', worktreeRemoved: true, branchKept: true } });
  getDb().prepare(`UPDATE pipelines SET branch = json_set(branch, '$.worktreeDir', ?) WHERE id = ?`).run(join(worcaHome(), 'runs', s.id, 'repos', s.key), s.id);
  ({ id: runId, key } = s);

  // A dev server Worca did not start, on a port outside the default range: only a widened range lets it in.
  upstream = http.createServer((q, s2) => { s2.writeHead(200, { 'content-type': 'text/plain' }); s2.end('hand-started'); });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  upstreamPort = upstream.address().port;
  closers.push(() => new Promise((r) => { upstream.closeAllConnections(); upstream.close(() => r()); }));

  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  for (const k of ['WORCA_AGENT_USER', 'WORCA_AGENT_HOME']) delete process.env[k];
  if (base) {
    for (const s of await getJson('/api/actions/running').catch(() => [])) await post(`/api/actions/instances/${encodeURIComponent(s.instanceId)}/stop`, {}).catch(() => {});
  }
  for (const c of closers.reverse()) await c();
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const k of ENV_KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await Promise.all([homeDir, ...created].filter(Boolean).map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 })));
});

test('POST /api/preview/sessions: every loopback port by default; Worca\'s own port, a non-number and a foreign page are refused', async () => {
  const out = await post('/api/preview/sessions', { port: upstreamPort });
  assert.equal(out.status, 201, 'default All local ports: a hand-started dev server outside 4400–4499');
  await out.json();
  const self = await (await post('/api/preview/sessions', { port })).json();
  assert.equal(self.code, 'SELF', 'Worca\'s own port, even under All local ports');
  assert.equal(self.error, 'Worca does not preview itself.');
  assert.equal((await post('/api/preview/sessions', { port: '4400' })).status, 400);
  const foreign = await raw('POST', '/api/preview/sessions', { origin: 'http://127.0.0.1:4401', 'content-type': 'application/json' }, '{"port":4400}');
  assert.equal(foreign.status, 403, 'another page on this machine cannot mint');
  const opaque = await raw('POST', '/api/preview/sessions', { origin: 'null', 'content-type': 'application/json' }, '{"port":4400}');
  assert.equal(opaque.status, 403, 'nor can a preview page itself (Origin: null)');
});

test('Preview ports = Actions range only: a port outside the range and running Actions is refused, with where to change it', async () => {
  assert.equal((await post('/api/settings', { actions: { previewPorts: 'range' } })).status, 200);
  try {
    const out = await post('/api/preview/sessions', { port: upstreamPort });
    assert.equal(out.status, 403);
    const body = await out.json();
    assert.equal(body.code, 'PORT_NOT_ALLOWED');
    assert.equal(body.error, `Port ${upstreamPort} is outside the ports Worca previews: 4400–4499 and running Actions. Choose "All local ports" under Preview ports in Settings › Runs › Actions, or widen the range.`);
    assert.equal((await (await post('/api/preview/sessions', { port })).json()).code, 'SELF');
    assert.equal(await withQuietPort(async (p) => (await post('/api/preview/sessions', { port: p, host: 'example.com' })).status), 201,
      'inside the range; a host is never read: loopback only');
  } finally {
    assert.equal((await post('/api/settings', { actions: { previewPorts: null } })).status, 200);
  }
});

test('GET /api/settings: actionsGate names the effective preview mode; a local Worca is not locked', async () => {
  const s = await getJson('/api/settings');
  assert.equal(s.actions.previewPorts, 'all');
  assert.deepEqual(s.actionsGate, { remote: false, enabled: true, previewPorts: 'all', previewPortsLocked: false });
  const r = await post('/api/settings', { actions: { previewPorts: 'all' } });
  await r.arrayBuffer();
  assert.equal(r.status, 200, 'a local Worca saves "All local ports" (only hosted refuses it)');
});

test('the proxy: a minted token opens the port; any other token, Host or address shape is refused', async () => {
  assert.equal((await post('/api/settings', { actions: { portLow: upstreamPort, portHigh: upstreamPort } })).status, 200);
  try {
    const { token, base: prefix } = await (await post('/api/preview/sessions', { port: upstreamPort })).json();
    assert.equal(prefix, `/preview/${upstreamPort}/${token}/`);
    const ok = await raw('GET', prefix, { origin: 'null', cookie: 'worca=1' });
    assert.equal(ok.status, 200);
    assert.equal(ok.text, 'hand-started');
    assert.match(String(ok.headers['content-security-policy']), /^sandbox allow-scripts/);
    const unknown = await raw('GET', `/preview/${upstreamPort}/${'z'.repeat(24)}/`);
    assert.equal(unknown.status, 403);
    assert.match(unknown.text, /"TOKEN_UNKNOWN"/);
    assert.match(String(unknown.headers['content-security-policy']), /^sandbox /, 'the proxy\'s own note pages are sandboxed too');
    assert.equal((await raw('GET', prefix, { host: 'evil.example' })).status, 403, 'DNS rebinding: Host is still checked');
    assert.equal((await raw('GET', `/preview/example.com/${token}/`)).status, 404, 'no host in the address');
    assert.equal((await raw('GET', `/preview/${upstreamPort}`)).status, 404);
  } finally {
    assert.equal((await post('/api/settings', { actions: { portLow: 4400, portHigh: 4499 } })).status, 200);
  }
  await withQuietPort(async (p) => {
    const { token } = await (await post('/api/preview/sessions', { port: p })).json();
    assert.equal((await post('/api/preview/sessions', { port: upstreamPort })).status, 403, 'narrowed again: refused');
    const gone = await raw('GET', `/preview/${upstreamPort}/${token}/`);
    assert.equal(gone.status, 403, 'a token for another port');
  });
});

test('agent isolation: a possible agent on this box mints nothing, reaches no preview, and saves no dev server', async () => withQuietPort(async (p) => {
  const { base: prefix } = await (await post('/api/preview/sessions', { port: p })).json();   // a live token, minted first
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = homeDir;
  try {
    assert.equal((await post('/api/preview/sessions', { port: p })).status, 403);
    const page = await raw('GET', prefix);
    assert.equal(page.status, 403);
    assert.match(page.text, /AGENT_CALLER_BLOCKED/, 'the agent gate, not the token, refuses it');
    const ws = new WebSocket(`ws://127.0.0.1:${port}${prefix}`, { headers: { host: `127.0.0.1:${port}`, origin: 'null' } });
    await assert.rejects(new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); }), /403/,
      'refused before the proxy (which would answer 502: the quiet page takes no upgrade)');
    assert.equal((await post(`/api/projects/${key}/dev-server`, {})).status, 403);
  } finally { delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME; }
  assert.deepEqual((await getJson(`/api/projects/${key}/actions`)).config.actions, [], 'nothing saved');
}));

test('the dev server offer: Use this saves a project Action that starts, opens through the proxy, and upgrades HMR', async () => {
  assert.equal((await put(`/api/projects/${key}/actions`, { actions: [{ id: 'lint', kind: 'task', cmd: 'npm run lint' }] })).status, 200);
  const offer = await getJson(`/api/projects/${key}/dev-server`);
  assert.ok(offer.suggestion, 'a task Action is no dev server: still offered');
  assert.deepEqual([offer.suggestion.command, offer.suggestion.cmd], ['npm run dev', 'npm run dev']);
  assert.equal((await post(`/api/projects/${key}/dev-server`, { cmd: 'rm -rf /' })).status, 400, 'a body never carries a command');
  const saved = await post(`/api/projects/${key}/dev-server`, {});
  assert.equal(saved.status, 201);
  const { action } = await saved.json();
  assert.deepEqual([action.id, action.kind, action.openUrl, action.env], ['dev', 'service', 'http://localhost:{PORT}', [{ name: 'PORT', type: 'port', value: 'auto' }]]);
  assert.deepEqual((await getJson(`/api/projects/${key}/actions`)).config.actions.map((a) => a.id), ['lint', 'dev'],
    'one config: the project Actions, the ones it had kept');
  assert.deepEqual(await getJson(`/api/projects/${key}/dev-server`), { suggestion: null, reason: 'HAS_SERVICE' });
  assert.equal((await post(`/api/projects/${key}/dev-server`, {})).status, 409);

  // Its own corner of the Actions range: another test file starts services from 4400 in a parallel process, and a
  // port both probe free at the same moment would answer this test from that file's server.
  assert.equal((await post('/api/settings', { actions: { portLow: 4470, portHigh: 4489 } })).status, 200);
  assert.equal((await post(`/api/runs/${runId}/checkout?projectKey=${key}`, {})).status, 200);
  const started = await waitFor(async () => {
    const r = await post(`/api/runs/${runId}/actions/dev/start?projectKey=${key}`, {});
    return r.status === 200 || r.status === 202 ? r.json() : null;
  });
  const live = await waitFor(async () => (await getJson('/api/actions/running')).find((s) => s.instanceId === started.instanceId && s.status === 'ready'), 60000);
  const p = live.ports.PORT;
  assert.equal(live.url, `http://localhost:${p}`);
  const { base: prefix } = await (await post('/api/preview/sessions', { port: p })).json();
  const page = await raw('GET', prefix, { origin: 'null', cookie: 'worca=secret', 'sec-fetch-dest': 'iframe' });
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(`src="${prefix}@vite/client"`), 'root-relative assets moved under the prefix');
  assert.ok(page.text.includes('cookie=<'), 'Worca\'s cookie never reaches the dev server');
  assert.equal(page.headers['set-cookie'], undefined);
  assert.match((await raw('GET', `${prefix}framed`, { 'sec-fetch-dest': 'iframe' })).text, /This site cannot be shown here/);

  const ws = new WebSocket(`ws://127.0.0.1:${port}${prefix}?token=hmr`, { headers: { host: `127.0.0.1:${port}`, origin: 'null' } });
  const got = await new Promise((resolve, reject) => {
    ws.once('open', () => ws.send('hi'));
    ws.once('message', (d) => resolve(String(d)));
    ws.once('error', reject);
  });
  assert.equal(got, 'ok');
  ws.terminate();
  const rebound = new WebSocket(`ws://127.0.0.1:${port}${prefix}`, { headers: { host: 'evil.example', origin: 'null' } });
  await assert.rejects(new Promise((resolve, reject) => { rebound.once('open', resolve); rebound.once('error', reject); }), /403/, 'Host is checked on upgrades');
  const bad = new WebSocket(`ws://127.0.0.1:${port}/preview/${p}/${'q'.repeat(24)}/`, { headers: { host: `127.0.0.1:${port}`, origin: 'null' } });
  await assert.rejects(new Promise((resolve, reject) => { bad.once('open', resolve); bad.once('error', reject); }), /403/);
  const other = new WebSocket(`ws://127.0.0.1:${port}/elsewhere`, { headers: { host: `127.0.0.1:${port}` } });
  await assert.rejects(new Promise((resolve, reject) => { other.once('open', resolve); other.once('error', reject); }), /400/);

  // A running instance's port stays allowed when the range no longer holds it.
  assert.equal((await post('/api/settings', { actions: { portLow: upstreamPort, portHigh: upstreamPort, previewPorts: 'range' } })).status, 200);
  try {
    assert.equal((await post('/api/preview/sessions', { port: p })).status, 201);
  } finally { await post('/api/settings', { actions: { portLow: 4400, portHigh: 4499, previewPorts: null } }); }
});

test('the dev server offer: nothing to offer without a dev or start script', async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const bare = await realpath(templateRepo('apipreview2', { branch: 'main', user: true, prefix: 'worca-cc-apipreview2-', files: { 'README.md': '# no scripts\n' } }));
  created.push(bare);
  await addProject({ name: basename(bare), path: bare });
  const k = projectKey(bare);
  assert.deepEqual(await getJson(`/api/projects/${k}/dev-server`), { suggestion: null });
  const r = await post(`/api/projects/${k}/dev-server`, {});
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, 'NO_DEV_SCRIPT');
  assert.deepEqual((await getJson(`/api/projects/${k}/actions`)).config.actions, [], 'nothing saved');
});

test('Use this on a script that needs its dependencies: it sets the setup command, and a checkout made before runs it first', async () => {
  // The dev server is a package binary (node_modules/.bin, not in git): a run's checkout has none until setup installs it.
  const files = { 'tools/serve/package.json': JSON.stringify({ name: 'serve-dev', version: '1.0.0', bin: { 'serve-dev': 'cli.mjs' } }),
    'tools/serve/cli.mjs': '#!/usr/bin/env node\nimport http from "node:http";\n'
      + 'http.createServer((q, s) => { s.writeHead(200, { "content-type": "text/plain" }); s.end("dev-ok"); }).listen(Number(process.env.PORT), "127.0.0.1");\n',
    '.npmrc': 'audit=false\nfund=false\noffline=true\n', '.gitignore': 'node_modules/\n',
    'package.json': JSON.stringify({ scripts: { dev: 'serve-dev' }, devDependencies: { 'serve-dev': 'file:./tools/serve' } }) };
  const { addProject, worcaHome } = await import('../src/core/projects.mjs');
  const { seedPipeline } = await import('./helpers/db-seed.mjs');
  const dir = await realpath(templateRepo('apipreview3', { branch: 'main', user: true, prefix: 'worca-cc-apipreview3-', files }));
  created.push(dir);
  await addProject({ name: basename(dir), path: dir });
  git(dir, ['branch', 'worca-cc/p']);
  const s = await seedPipeline(dir, { status: 'done', branch: { source: 'main', feature: 'worca-cc/p', runRootMode: 'detached', worktreeRemoved: true, branchKept: true } });
  getDb().prepare(`UPDATE pipelines SET branch = json_set(branch, '$.worktreeDir', ?) WHERE id = ?`).run(join(worcaHome(), 'runs', s.id, 'repos', s.key), s.id);
  // Checked out while the project had no setup command: its setup state is "none".
  assert.equal((await post(`/api/runs/${s.id}/checkout?projectKey=${s.key}`, {})).status, 200);
  await waitFor(async () => (await getJson(`/api/runs/${s.id}/actions?projectKey=${s.key}`)).members[0].checkout?.setup?.status === 'none');
  assert.equal((await getJson(`/api/projects/${s.key}/dev-server`)).suggestion.setup, 'npm install');
  const saved = await (await post(`/api/projects/${s.key}/dev-server`, {})).json();
  assert.equal(saved.config.setup, 'npm install', 'the project had none: Use this sets it');
  assert.equal((await post('/api/settings', { actions: { portLow: 4490, portHigh: 4499 } })).status, 200);   // see above
  try {
    const r = await post(`/api/runs/${s.id}/actions/dev/start?projectKey=${s.key}`, {});
    const body = await r.json();
    assert.deepEqual([r.status, body.queued], [202, true], 'queued behind the setup command added since the checkout');
    const live = await waitFor(async () => (await getJson('/api/actions/running')).find((x) => x.instanceId === body.instanceId && x.status === 'ready'), 90000);
    const { base: prefix } = await (await post('/api/preview/sessions', { port: live.ports.PORT })).json();
    assert.equal((await raw('GET', prefix)).text, 'dev-ok');
    await post(`/api/actions/instances/${encodeURIComponent(body.instanceId)}/stop`, {});
  } finally { await post('/api/settings', { actions: { portLow: 4400, portHigh: 4499 } }); }
});

test('an upgrade to another path whose client resets mid-answer does not end Worca', async () => {
  const crashes = [];
  const onErr = (e) => crashes.push(e.code || e.message);
  process.on('uncaughtException', onErr);
  try {
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => {
        const c = net.connect(port, '127.0.0.1', () => {
          c.write(`GET /other HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
          c.resetAndDestroy();
          resolve();
        });
        c.on('error', () => resolve());
      });
    }
    await new Promise((r) => setTimeout(r, 300));
  } finally { process.off('uncaughtException', onErr); }
  assert.deepEqual(crashes, [], 'an uncaught socket error ends the Worca process');
  assert.equal((await fetch(`${base}/api/health`)).status, 200, 'still serving');
});

test('a port where another Worca answers is not previewed: its sandboxed pages would get its API', async () => {
  const fake = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ name: '@worca/app' })); });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const p = fake.address().port;
  try {
    assert.equal((await post('/api/settings', { actions: { portLow: p, portHigh: p } })).status, 200);
    const r = await post('/api/preview/sessions', { port: p });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, 'WORCA_INSTANCE');
  } finally {
    await post('/api/settings', { actions: { portLow: 4400, portHigh: 4499 } });
    fake.closeAllConnections();
    await new Promise((r) => fake.close(r));
  }
});

test('a token minted for a dev server is refused once another Worca answers on its port (and one on ::1 only is seen too)', async () => {
  const quiet = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/plain' }); s.end('quiet'); });
  await new Promise((r) => quiet.listen(0, '127.0.0.1', r));
  const p = quiet.address().port;
  const seen = [];
  const fake = http.createServer((q, s) => { seen.push(`${q.method} ${q.url}`); s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ name: '@worca/app' })); });
  try {
    assert.equal((await post('/api/settings', { actions: { portLow: p, portHigh: p } })).status, 200);
    const { base: prefix } = await (await post('/api/preview/sessions', { port: p })).json();
    assert.equal((await raw('GET', prefix, { origin: 'null' })).text, 'quiet', 'a dev server: served');
    quiet.closeAllConnections();
    await new Promise((r) => quiet.close(r));
    await new Promise((r) => fake.listen(p, '127.0.0.1', r));   // the dev server went; a Worca took its port
    assert.equal((await post('/api/preview/sessions', { port: p })).status, 409, 'a fresh mint is refused');
    (await import('../ui/server.mjs')).previewProxy.forget(p);   // as if the host cache (PREVIEW_LIMITS.hostCacheMs) ran out
    seen.length = 0;
    const old = await raw('POST', `${prefix}api/settings`, { origin: 'null', 'content-type': 'application/json' }, '{}');
    assert.equal(old.status, 409);
    assert.match(old.text, /"WORCA_INSTANCE"/);
    assert.deepEqual(seen.filter((x) => !x.startsWith('GET /api/health')), [], 'only the probe reached the Worca');
  } finally {
    await post('/api/settings', { actions: { portLow: 4400, portHigh: 4499 } });
    fake.closeAllConnections();
    if (fake.listening) await new Promise((r) => fake.close(r));
  }

  const v6 = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ name: '@worca/app' })); });
  const bound = await new Promise((r) => { v6.once('error', () => r(false)); v6.listen(0, '::1', () => r(true)); });
  if (!bound) return;   // no IPv6 loopback on this host
  const p6 = v6.address().port;
  try {
    assert.equal((await post('/api/settings', { actions: { portLow: p6, portHigh: p6 } })).status, 200);
    assert.equal((await post('/api/preview/sessions', { port: p6 })).status, 409, 'probed on the host the proxy dials');
  } finally {
    await post('/api/settings', { actions: { portLow: 4400, portHigh: 4499 } });
    v6.closeAllConnections();
    await new Promise((r) => v6.close(r));
  }
});
