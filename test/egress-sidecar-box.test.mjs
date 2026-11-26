// test/egress-sidecar-box.test.mjs — Worca's box next to the egress sidecar (#1619): it never writes a proxy login,
// a login an older version saved in the box moves to the sidecar once and is deleted, `worca proxy` acts on the
// sidecar, the box starts no corporate chain of its own, a box without a sidecar keeps its login with one warning,
// and the credential broker's model calls get out through a sidecar that logs in. No Docker.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { startFakeUpstream } from './helpers/fake-upstream-proxy.mjs';
import { startFakeUpstream as startFakeModel, GOOD_KEY } from './helpers/fake-model-upstream.mjs';
import { startSidecar, echoOrigin, connectVia, until, SECRET } from './helpers/egress-sidecar.mjs';
import { saveProxyLogin, readProxyLogin, proxyLoginFile, ProxyLoginError } from '../src/core/proxy-credentials.mjs';
import { moveBoxLoginToSidecar, inBoxLoginNotice, IN_BOX_LOGIN_TEXT } from '../src/core/egress-sidecar-boot.mjs';
import { sidecarClient, sealEgressSecret, sidecarApiConfig, _resetSealedEgressSecret } from '../src/core/egress-sidecar-client.mjs';
import { startEgressPolicy } from '../src/core/egress-policy.mjs';
import { cmdProxy } from '../src/cli/proxy.mjs';
import { useEnvProxy } from '../src/core/env-proxy.mjs';
import { readBrokerConfig } from '../src/broker/config.mjs';
import { builtinSlots, mergeSlots } from '../src/broker/slots.mjs';
import { startBroker } from '../src/broker/main.mjs';

useTempHome(after);

const LOGIN = { domain: 'Domain', user: 'User', password: 'Password' };
const HASH = 'a4f49c406510bdcab6824ee7c30fd852';
const boxHome = () => mkdtempSync(join(tmpdir(), 'worca-box-'));
const boxEnv = (s) => ({ WORCA_EGRESS_API_URL: `http://127.0.0.1:${s.apiPort}`, WORCA_EGRESS_SECRET: SECRET, WORCA_CONTAINER: '1' });
const io = () => { const lines = []; return { lines, out: (l) => lines.push(l), err: (l) => lines.push(`ERR ${l}`), fail: (l) => lines.push(`FAIL ${l}`) }; };

async function rig(sidecarEnv) {
  const origin = await echoOrigin();
  const fake = await startFakeUpstream({ originPort: origin.port });
  const s = await startSidecar(sidecarEnv === undefined ? { HTTPS_PROXY: fake.url() } : sidecarEnv);
  return { origin, fake, s, close: async () => { await s.close(); await fake.close(); await origin.close(); } };
}

test('the box never writes proxy-login.json next to a sidecar', () => {
  const home = boxHome();
  try {
    assert.throws(() => saveProxyLogin(LOGIN, { home, env: { WORCA_EGRESS_API_URL: 'http://egress:3129' } }),
      (e) => e instanceof ProxyLoginError && e.field === 'sidecar' && /egress sidecar/.test(e.message));
    assert.equal(existsSync(proxyLoginFile(home)), false);
    // The native install: unchanged.
    assert.equal(saveProxyLogin(LOGIN, { home, env: {} }).label, 'Domain\\User');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('one-time move: a login an older version saved in the box goes to the sidecar, bound to its proxy, and is deleted', async () => {
  const r = await rig();
  const home = boxHome();
  try {
    saveProxyLogin(LOGIN, { home, env: {} });
    const logs = [];
    const env = boxEnv(r.s);
    const res = await moveBoxLoginToSidecar({ env, home, client: sidecarClient(env), log: (lv, t) => logs.push(`${lv} ${t}`), delayMs: 10 });
    assert.equal(res.moved, true, JSON.stringify(res));
    assert.equal(existsSync(proxyLoginFile(home)), false, 'gone from the box');
    const st = await r.s.api('GET', '/v1/status');
    assert.equal(st.body.login.label, 'Domain\\User');
    assert.equal(st.body.loginBoundTo, `127.0.0.1:${r.fake.port}`);
    assert.ok(logs.some((l) => /moved the login for Domain\\User/.test(l)));
    await until(async () => /echo:ping/.test(await connectVia(r.s.proxyPort, 'origin.acme.invalid:443')));
    // Once: nothing left to move.
    assert.equal((await moveBoxLoginToSidecar({ env, home, client: sidecarClient(env) })).reason, 'no login in the box');
  } finally { await r.close(); rmSync(home, { recursive: true, force: true }); }
});

test('the move: the sidecar keeps its own login; a box proxy setting goes along when the sidecar has none; an unsafe file goes', async () => {
  const r = await rig();
  const home = boxHome();
  try {
    assert.equal((await r.s.api('POST', '/v1/login', { ...LOGIN, user: 'Other' })).status, 200);
    saveProxyLogin(LOGIN, { home, env: {} });
    const env = boxEnv(r.s);
    const kept = await moveBoxLoginToSidecar({ env, home, client: sidecarClient(env), delayMs: 10 });
    assert.equal(kept.reason, 'sidecar has a login');
    assert.equal(existsSync(proxyLoginFile(home)), false);
    assert.equal((await r.s.api('GET', '/v1/status')).body.login.user, 'Other');
  } finally { await r.close(); }
  // A sidecar with no corporate proxy of its own: the box's networkProxy.upstream comes along, then the login.
  const r2 = await rig({});
  try {
    saveProxyLogin(LOGIN, { home, env: {} });
    const env = boxEnv(r2.s);
    const moved = await moveBoxLoginToSidecar({ env, home, client: sidecarClient(env), delayMs: 10,
      networkProxy: () => ({ enabled: true, upstream: `http://127.0.0.1:${r2.fake.port}`, fixedPort: 3128 }) });
    assert.equal(moved.moved, true, JSON.stringify(moved));
    const st = (await r2.s.api('GET', '/v1/status')).body;
    assert.equal(st.upstream, `127.0.0.1:${r2.fake.port}`);
    assert.equal(st.settings.fixedPort, undefined);
    // A box file others can read cannot be moved safely: it is deleted, with a line saying to log in again.
    saveProxyLogin(LOGIN, { home, env: {} });
    chmodSync(proxyLoginFile(home), 0o644);
    const logs = [];
    const bad = await moveBoxLoginToSidecar({ env, home, client: sidecarClient(env), log: (lv, t) => logs.push(t) });
    if (process.platform !== 'win32') {
      assert.equal(bad.deleted, true);
      assert.match(logs.join('\n'), /cannot be used .* deleted\. Log in again: worca container proxy login/);
    }
  } finally { await r2.close(); rmSync(home, { recursive: true, force: true }); }
});

test('the move waits for a sidecar that is still starting, and keeps the file when it never answers', async () => {
  const home = boxHome();
  try {
    saveProxyLogin(LOGIN, { home, env: {} });
    const env = { WORCA_EGRESS_API_URL: 'http://127.0.0.1:1', WORCA_EGRESS_SECRET: SECRET };
    const logs = [];
    const r = await moveBoxLoginToSidecar({ env, home, client: sidecarClient(env), attempts: 2, delayMs: 10, log: (lv, t) => logs.push(t) });
    assert.equal(r.moved, false);
    assert.ok(existsSync(proxyLoginFile(home)), 'kept for the next start');
    assert.match(logs.join('\n'), /stays in the box until the next start/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('no sidecar (raw docker compose up): the in-box login keeps working, with one warning; native says nothing', () => {
  const home = boxHome();
  try {
    assert.equal(inBoxLoginNotice({ env: { WORCA_CONTAINER: '1' }, home }), null, 'nothing saved, nothing to say');
    assert.equal(inBoxLoginNotice({ env: { WORCA_CONTAINER: '1', HTTPS_PROXY: 'http://ACME%5Cjdoe:pw@proxy.acme.example:8080' }, home }), IN_BOX_LOGIN_TEXT);
    saveProxyLogin(LOGIN, { home, env: {} });
    assert.equal(inBoxLoginNotice({ env: { WORCA_CONTAINER: '1' }, home }), IN_BOX_LOGIN_TEXT);
    assert.equal(inBoxLoginNotice({ env: { WORCA_CONTAINER: '1', WORCA_EGRESS_API_URL: 'http://egress:3129' }, home }), null);
    assert.equal(inBoxLoginNotice({ env: {}, home }), null, 'the native install');
    assert.ok(readProxyLogin({ home }).ntHash, 'the in-box login is untouched');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('next to a sidecar the box starts no corporate chain, even with networkProxy on; native still does', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'none', originPort: o.port });
  try {
    const settings = () => ({ networkProxy: { enabled: true, upstream: fake.url() } });
    const quiet = { login: () => null, watchLogin: () => () => {} };
    const boxed = { HTTPS_PROXY: 'http://egress:3128', WORCA_EGRESS_API_URL: 'http://egress:3129' };
    const off = await startEgressPolicy({ env: boxed, settings, ...quiet });
    assert.equal(off.status, 'off');
    assert.equal(boxed.HTTPS_PROXY, 'http://egress:3128', 'the children keep the sidecar');
    // A login in the box's HTTPS_PROXY (an old compose file) would auto-start; next to a sidecar it never does.
    const auto = { HTTPS_PROXY: 'http://jdoe:pw@egress:3128', WORCA_EGRESS_API_URL: 'http://egress:3129' };
    assert.equal((await startEgressPolicy({ env: auto, settings: () => ({}), ...quiet })).status, 'off');
    const nativeEnv = { HTTPS_PROXY: fake.url() };
    const on = await startEgressPolicy({ env: nativeEnv, settings, ...quiet });
    try { assert.equal(on.status, 'on'); } finally { await on.close(); }
  } finally { await fake.close(); await o.close(); }
});

test('the shared secret leaves the environment once read', () => {
  const env = { WORCA_EGRESS_API_URL: 'http://egress:3129', WORCA_EGRESS_SECRET: SECRET };
  try {
    sealEgressSecret({ env });
    assert.equal(env.WORCA_EGRESS_SECRET, undefined);
    const fileEnv = { WORCA_EGRESS_SECRET_FILE: '/nonexistent/secret', WORCA_EGRESS_SECRET: 'x' };
    sealEgressSecret({ env: fileEnv });
    assert.deepEqual(fileEnv, {});
    assert.match(sidecarApiConfig({ WORCA_EGRESS_API_URL: 'http://egress:3129', WORCA_EGRESS_SECRET: 'short' }).error, /too short/);
    assert.match(sidecarApiConfig({ WORCA_EGRESS_API_URL: 'https://egress:3129/x', WORCA_EGRESS_SECRET: SECRET }).error, /http:\/\//);
  } finally { _resetSealedEgressSecret(); }
});

test('worca proxy in the box acts on the sidecar: login (stdin), status, test, logout; hash prints the record', async () => {
  const r = await rig();
  const home = boxHome();
  try {
    const env = boxEnv(r.s);
    const at = { env, home };
    const o = io();
    assert.equal(await cmdProxy(['login'], { ...o, ...at, input: Readable.from(['Domain\\User\nPassword\n']) }), 0, o.lines.join('\n'));
    assert.match(o.lines.join('\n'), /Saved the login for Domain\\User in the egress sidecar/);
    assert.equal(existsSync(proxyLoginFile(home)), false, 'nothing in the box');
    const s = io();
    assert.equal(await cmdProxy(['status'], { ...s, ...at }), 0, s.lines.join('\n'));
    assert.match(s.lines.join('\n'), /Held by: the egress sidecar/);
    assert.match(s.lines.join('\n'), /State: ready: via 127\.0\.0\.1:\d+ \(NTLMv2\) as Domain\\User/);
    const t = io();
    assert.equal(await cmdProxy(['test', '--json'], { ...t, ...at }), 0, t.lines.join('\n'));
    assert.equal(JSON.parse(t.lines[0]).ok, true);
    const out = io();
    assert.equal(await cmdProxy(['logout'], { ...out, ...at }), 0);
    assert.match(out.lines.join('\n'), /Deleted the login in the egress sidecar/);
    for (const x of [o, s, t, out]) assert.ok(!x.lines.join('\n').includes(HASH));
    const h = io();
    assert.equal(await cmdProxy(['hash'], { ...h, env: {}, home, input: Readable.from(['Domain\\User\nPassword\n']) }), 0);
    assert.deepEqual(JSON.parse(h.lines[0]), { v: 1, domain: 'Domain', user: 'User', ntHash: HASH });
    assert.equal(existsSync(proxyLoginFile(home)), false, 'hash saves nothing');
    const bad = io();
    assert.equal(await cmdProxy(['status'], { ...bad, env: { ...env, WORCA_EGRESS_SECRET: 'w'.repeat(48) }, home }), 1);
    assert.match(bad.lines.join('\n'), /refused the shared secret/);
  } finally { await r.close(); rmSync(home, { recursive: true, force: true }); }
});

test('the broker\'s call to a model provider gets out through a sidecar that logs in to an NTLM proxy', { timeout: 30_000 }, async () => {
  const model = await startFakeModel();
  const modelPort = Number(new URL(model.url).port);
  const fake = await startFakeUpstream({ originPort: modelPort });
  const s = await startSidecar({ HTTPS_PROXY: fake.url() });
  let envProxy = null; let broker = null;
  try {
    assert.equal((await s.api('POST', '/v1/login', LOGIN)).status, 200);
    // The broker's env from compose.broker.yml with WORCA_BROKER_PROXY=http://egress:3128.
    const sidecarUrl = `http://127.0.0.1:${s.proxyPort}`;
    envProxy = useEnvProxy({ env: { HTTPS_PROXY: sidecarUrl, HTTP_PROXY: sidecarUrl, NO_PROXY: '127.0.0.1,localhost' }, api: {} });
    assert.equal(envProxy.status, 'on');
    const BSECRET = 'b'.repeat(48);
    const { config, errors } = readBrokerConfig({ WORCA_BROKER_MODE: 'single', WORCA_BROKER_SECRET: BSECRET, WORCA_BROKER_HOST: '127.0.0.1',
      WORCA_BROKER_PORT: '0', WORCA_BROKER_UI_PORT: '1', WORCA_BROKER_KEY_ANTHROPIC: GOOD_KEY });
    assert.deepEqual(errors, []);
    // A private host only the corporate proxy reaches (the fake tunnels it to the model upstream).
    const slots = mergeSlots(builtinSlots(), [{ id: 'anthropic', upstream: 'http://models.acme.internal' }]);
    broker = await startBroker({ config: { ...config, port: 0 }, slots, log: () => {} });
    const base = `http://127.0.0.1:${broker.ports.private}`;
    const mint = await fetch(`${base}/internal/tokens`, { method: 'POST', headers: { authorization: `Bearer ${BSECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ billTo: 'local', slots: ['anthropic'], spawnId: 'sp-1', kind: 'phase', issuer: 'srv-test' }) });
    const { token } = await mint.json();
    const res = await fetch(`${base}/p/anthropic/v1/models`, { headers: { authorization: `Bearer ${token}` } });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    assert.ok(fake.stats.type3 >= 1, 'the sidecar logged in to the corporate proxy');
    assert.ok(fake.stats.heads.some((h) => /models\.acme\.internal/.test(h.line)), 'the call went through the corporate proxy');
  } finally {
    envProxy?.restore();
    await broker?.close();
    await s.close(); await fake.close(); await model.close();
  }
});
