// test/proxy-host-sidecar.test.mjs — the corporate proxy's server seam (createProxyHost) next to the egress sidecar
// (#1619): every call forwards to the sidecar, a typed password passes through in memory only and nothing is written
// in the box, the UNTESTED gate still holds, an operator-managed login is status only, and the setup assistant's apply
// (its proxy-swap and proxy-login steps) lands in the sidecar. Real sidecar against the fake NTLM proxy; no Docker.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { startFakeUpstream } from './helpers/fake-upstream-proxy.mjs';
import { startSidecar, echoOrigin, connectVia, until, SECRET } from './helpers/egress-sidecar.mjs';
import { createProxyHost } from '../src/core/proxy-host.mjs';
import { createSidecarProxyHost, sidecarPatch, sidecarView, SIDECAR_LOCAL_URL, MANAGED_NOTE } from '../src/core/proxy-host-sidecar.mjs';
import { sidecarClient } from '../src/core/egress-sidecar-client.mjs';
import { proxyLoginFile } from '../src/core/proxy-credentials.mjs';
import { planSetupApply, commitSetupPlan, runSetupSteps } from '../src/core/setup/apply.mjs';

useTempHome(after);

const HASH = 'a4f49c406510bdcab6824ee7c30fd852';
const LOGIN = { domain: 'Domain', user: 'User', password: 'Password' };
const noSecret = (v) => { const t = JSON.stringify(v); assert.ok(!t.includes(HASH) && !t.includes('Password'), `a secret leaked: ${t}`); };

async function rig(sidecarEnv) {
  const origin = await echoOrigin();
  const fake = await startFakeUpstream({ originPort: origin.port });
  const other = await startFakeUpstream({ originPort: origin.port });
  const s = await startSidecar(sidecarEnv ? sidecarEnv(fake) : { HTTPS_PROXY: fake.url() });
  const env = { WORCA_EGRESS_API_URL: `http://127.0.0.1:${s.apiPort}`, WORCA_EGRESS_SECRET: SECRET };
  // The box's proxyHost: the native io would read this box's settings and login; next to a sidecar none of it is used.
  const host = createProxyHost({ egress: () => null, io: { env: () => env, sidecar: createSidecarProxyHost({ client: sidecarClient(env) }) } });
  return { origin, fake, other, s, env, host, close: async () => { await s.close(); await fake.close(); await other.close(); await origin.close(); } };
}

test('pure parts: the patch the sidecar takes, and the status view the card reads', () => {
  assert.deepEqual(sidecarPatch({ enabled: true, upstream: 'p:1', fixedPort: 3128 }), { enabled: true, upstream: 'p:1' });
  assert.equal(sidecarPatch(null), null);
  const v = sidecarView({ upstream: 'proxy.acme.example:8080', settings: {}, managed: true, state: 'ready' });
  assert.equal(v.settings.upstream, 'http://proxy.acme.example:8080', 'the sidecar\'s HTTPS_PROXY fills the form');
  assert.equal(v.settings.enabled, true);
  assert.equal(v.localUrl, SIDECAR_LOCAL_URL);
  assert.equal(v.managedNote, MANAGED_NOTE);
  assert.equal(sidecarView({ settings: { enabled: false }, upstream: 'p:1' }).settings.enabled, false);
});

test('status, login, test, logout through the sidecar; nothing in the box, no secret in any answer', async () => {
  const r = await rig();
  try {
    assert.equal(r.host.sidecar().sidecar, true);
    const st = await r.host.status();
    assert.equal(st.sidecar, true);
    assert.equal(st.state, 'no-login');
    assert.equal(st.settings.upstream, `http://127.0.0.1:${r.fake.port}`);
    const typed = { ...LOGIN };
    const li = await r.host.login(typed);
    assert.equal(li.status, 200, JSON.stringify(li.body));
    assert.equal(li.body.state, 'ready');
    assert.equal(li.body.login.label, 'Domain\\User');
    noSecret(li.body);
    assert.equal(existsSync(proxyLoginFile()), false, 'the box keeps no login');
    assert.equal(existsSync(join(r.s.dataDir, 'proxy-login.json')), true, 'the sidecar does');
    await until(async () => /echo:ping/.test(await connectVia(r.s.proxyPort, 'origin.acme.invalid:443')));
    const t = await r.host.test(undefined, { record: true });
    assert.equal(t.status, 200);
    assert.equal(t.body.ok, true);
    noSecret(t.body);
    const chat = await r.host.chatStatus();
    assert.equal(chat.login.account, 'Domain\\User');
    assert.equal(chat.sidecar, true);
    noSecret(chat);
    const d = await r.host.sidecar().detect();
    assert.deepEqual([d.found, d.source, d.host, d.port], [true, 'sidecar', '127.0.0.1', r.fake.port]);
    const out = await r.host.logout();
    assert.equal(out.body.login, null);
    assert.equal(r.host.fixedPortNow(), 0);
  } finally { await r.close(); }
});

test('the UNTESTED gate: a new proxy needs a passing Test first; the save then drops the login bound to the old one', async () => {
  const r = await rig();
  try {
    assert.equal((await r.host.login(LOGIN)).status, 200);
    const patch = { enabled: true, upstream: `http://127.0.0.1:${r.other.port}` };
    const refused = await r.host.saveSettings(patch);
    assert.equal(refused.refused.body.code, 'UNTESTED');
    // The Test of the new proxy never takes the saved login there; a typed one may go.
    const t = await r.host.test(patch, { record: true, login: LOGIN });
    assert.equal(t.body.ok, true, JSON.stringify(t.body));
    const saved = await r.host.saveSettings(patch);
    assert.equal(saved.applied, true, JSON.stringify(saved));
    assert.equal(saved.loginDropped, true);
    const st = await r.host.status();
    assert.equal(st.upstream, `127.0.0.1:${r.other.port}`);
    assert.equal(st.login, null);
    // A timeout change needs no Test (same proxy, same login mode).
    const t2 = await r.host.saveSettings({ timeouts: { authMs: 20_000 } });
    assert.equal(t2.applied, true);
    // Bad input is the settings rule's sentence.
    await assert.rejects(r.host.saveSettings({ auth: 'kerberos' }), /networkProxy\.auth must be one of/);
  } finally { await r.close(); }
});

test('managed by the operator: status only, every write refused, and the reason named', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-op-'));
  const file = join(dir, 'login.json');
  writeFileSync(file, JSON.stringify({ v: 1, domain: 'Domain', user: 'User', ntHash: HASH }), { mode: 0o600 });
  const r = await rig((fake) => ({ HTTPS_PROXY: fake.url(), WORCA_EGRESS_LOGIN_FILE: file }));
  try {
    const st = await r.host.status();
    assert.equal(st.managed, true);
    assert.equal(st.managedNote, MANAGED_NOTE);
    assert.equal(st.login.label, 'Domain\\User');
    const li = await r.host.login(LOGIN);
    assert.equal(li.status, 409);
    assert.equal(li.body.code, 'MANAGED');
    assert.equal((await r.host.logout()).body.code, 'MANAGED');
    const save = await r.host.saveSettings({ auth: 'ntlm' });
    assert.equal(save.refused.body.code, 'MANAGED');
    assert.equal((await r.host.test(undefined, { record: true })).body.ok, true);
  } finally { await r.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a sidecar that cannot be reached: the status says so, nothing throws', async () => {
  const env = { WORCA_EGRESS_API_URL: 'http://127.0.0.1:1', WORCA_EGRESS_SECRET: SECRET };
  const host = createProxyHost({ egress: () => null, io: { env: () => env, sidecar: createSidecarProxyHost({ client: sidecarClient(env) }) } });
  const st = await host.status();
  assert.equal(st.state, 'error');
  assert.match(st.line, /cannot be reached/);
  assert.equal((await host.login(LOGIN)).status, 502);
  const d = await host.sidecar().detect();
  assert.equal(d.found, false);
});

test('the native install is untouched: no sidecar, the native host answers synchronously', () => {
  const host = createProxyHost({ egress: () => null, io: { env: () => ({}), settings: () => ({}), readLogin: () => null, enabled: () => false } });
  assert.equal(host.sidecar(), null);
  const st = host.status();
  assert.equal(typeof st.then, 'undefined');
  assert.equal(st.state, 'off');
});

test('setup apply next to the sidecar: the proxy-swap and proxy-login steps land in the sidecar', async () => {
  const r = await rig((fake) => ({}));   // a sidecar with no corporate proxy of its own yet
  try {
    const host = r.host;
    const deps = {
      checkProxy: (patch, login) => host.checkSave(patch, { login }), fixedPortNow: () => host.fixedPortNow(),
      applyProxy: (np, bf) => host.applyWritten(np, bf), reloadLogin: () => {},
      saveLogin: async (l) => { const x = await host.login(l); if (x.status !== 200) throw new Error(x.body.error); return x.body.login; },
      checkModelRoles: async (p) => p, checkAskModels: async (p) => p, brokerRefusal: () => null,
    };
    const np = { enabled: true, upstream: `http://127.0.0.1:${r.fake.port}`, fixedPort: 3128 };
    // The gate first: a sidecar with no proxy counts as a new one, so a Test must pass (with the typed login).
    await assert.rejects(planSetupApply({ network: { networkProxy: np, login: LOGIN } }, deps), (e) => e.code === 'UNTESTED');
    assert.equal((await host.test(np, { record: true, login: LOGIN })).body.ok, true);
    const plan = await planSetupApply({ network: { networkProxy: np, login: LOGIN } }, deps);
    await commitSetupPlan(plan, deps);
    const out = await runSetupSteps(plan, { deps });
    const by = Object.fromEntries(out.results.map((x) => [x.id, x]));
    assert.equal(by['proxy-swap'].state, 'ok', JSON.stringify(out.results));
    assert.equal(by['proxy-login'].state, 'ok', JSON.stringify(out.results));
    assert.match(by['proxy-login'].line, /Logged in as Domain\\User/);
    const st = await host.status();
    assert.equal(st.upstream, `127.0.0.1:${r.fake.port}`);
    assert.equal(st.login.label, 'Domain\\User');
    assert.equal(st.settings.fixedPort, undefined, 'no fixedPort in the sidecar');
    assert.equal(existsSync(proxyLoginFile()), false, 'no login in the box');
    noSecret(out.results);
  } finally { await r.close(); }
});
