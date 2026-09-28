// test/api-remote-access-failclosed.test.mjs
// Remote access fails closed:
//   - `node ui/server.mjs` with an allowlist but no identity check exits 1
//     before binding, naming the missing settings;
//   - a certs endpoint that is down from the start answers 503, never 500.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { TEAM, AUD, CERTS_URL, makeAccessKey, signAccessJwt } from './helpers/access-jwt.mjs';

useTempHome(after);

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'server.mjs');

// PORT=0 means "default" to the server (4317, maybe the user's own UI): pick a free one.
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => r(p)); }); });

async function boot(env, { until } = {}) {
  const port = String(await freePort());
  const home = mkdtempSync(join(tmpdir(), 'worca-failclosed-'));
  // Only the settings under test: before() below sets a full config on process.env.
  const base = Object.fromEntries(Object.entries(process.env)
    .filter(([k]) => !/^WORCA_(ALLOWED_HOSTS|CF_ACCESS_|INSECURE_NO_IDENTITY_CHECK)/.test(k)));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
      env: { ...base, WORCA_MOCK: '1', WORCA_HOME: home, HOME: home, PORT: port, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (c) => { out += c; if (until && until.test(out)) child.kill('SIGTERM'); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      rmSync(home, { recursive: true, force: true });
      resolve({ code, out });
    });
  });
}

test('boot: allowlist without an identity check exits 1 before listening', async () => {
  const { code, out } = await boot({ WORCA_ALLOWED_HOSTS: 'worca-01.example.com', WORCA_HOST: '127.0.0.1' });
  assert.equal(code, 1);
  assert.match(out, /remote access: WORCA_ALLOWED_HOSTS is set but no identity check is configured/);
  assert.match(out, /not starting/);
  assert.doesNotMatch(out, /listening on/);
});

test('boot: half a Cloudflare Access config exits 1', async () => {
  const { code, out } = await boot({ WORCA_ALLOWED_HOSTS: 'worca-01.example.com', WORCA_CF_ACCESS_TEAM_DOMAIN: TEAM });
  assert.equal(code, 1);
  assert.match(out, /WORCA_CF_ACCESS_AUD is not/);
});

test('boot: a complete config starts, binds and says remote access is on', async () => {
  const { out } = await boot({
    WORCA_ALLOWED_HOSTS: 'worca-01.example.com', WORCA_CF_ACCESS_TEAM_DOMAIN: TEAM, WORCA_CF_ACCESS_AUD: AUD,
  }, { until: /remote access on for/ });
  assert.match(out, /listening on/);
  assert.match(out, new RegExp(`remote access on for worca-01\\.example\\.com; identity: cloudflare-access \\(${TEAM.replace(/\./g, '\\.')}\\)`));
});

// ── imported, certs endpoint down from the start ──────────────────────────────
const PUBLIC = 'worca-01.example.com';
const realFetch = globalThis.fetch;
let srv, port;

before(async () => {
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_ALLOWED_HOSTS = PUBLIC;
  process.env.WORCA_CF_ACCESS_TEAM_DOMAIN = TEAM;
  process.env.WORCA_CF_ACCESS_AUD = AUD;
  globalThis.fetch = (url, opts) => (String(url) === CERTS_URL
    ? Promise.resolve(new Response('bad gateway', { status: 502 }))
    : realFetch(url, opts));
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  globalThis.fetch = realFetch;
  for (const k of ['WORCA_MOCK', 'WORCA_ALLOWED_HOSTS', 'WORCA_CF_ACCESS_TEAM_DOMAIN', 'WORCA_CF_ACCESS_AUD']) delete process.env[k];
});

function status(headers) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port, path: '/api/projects', headers: { host: PUBLIC, ...headers } }, (resp) => { resp.resume(); res(resp.statusCode); });
    r.on('error', rej);
    r.end();
  });
}

test('certs endpoint down from the start: a token request answers 503, not 500 or 200', async () => {
  const token = signAccessJwt(makeAccessKey());
  assert.equal(await status({ 'cf-access-jwt-assertion': token }), 503);
  assert.equal(await status({}), 401, 'no token is refused outright, without needing the keys');
});
