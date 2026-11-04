// test/settings-network-proxy.test.mjs — Settings › Network proxy (settings.json networkProxy,
// networkProxy.enabled and its migration from the old Labs flag): the setter that PUT /api/proxy/settings uses.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NETWORK_PROXY_AUTH, networkProxySettings, setNetworkProxy, assertNetworkProxyInput, readSettings, previewNetworkProxy, mergeNetworkProxy,
  migrateLegacyProxyFlag, migrateCorporateProxyFlag, networkProxyEnabled, settingsFile, watchSettingsFile, readSettingsStrict } from '../src/core/settings.mjs';
import { AUTH_MODES, fixedPortOf } from '../src/core/upstream-proxy.mjs';

let home; const prev = {};
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-netproxy-'));
  for (const k of ['HOME', 'USERPROFILE']) { prev[k] = process.env[k]; process.env[k] = home; }
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true });
});

test('networkProxy: host:port is stored as an http URL; keys merge; null removes a key or the whole block', async () => {
  assert.deepEqual(networkProxySettings(), {});
  assert.deepEqual(await setNetworkProxy({ upstream: 'proxy.acme.example:8080' }), { upstream: 'http://proxy.acme.example:8080' });
  assert.deepEqual(await setNetworkProxy({ auth: 'ntlm', timeouts: { connectMs: 5000 } }),
    { upstream: 'http://proxy.acme.example:8080', auth: 'ntlm', timeouts: { connectMs: 5000 } });
  assert.deepEqual(await setNetworkProxy({ timeouts: { connectMs: null }, auth: null }), { upstream: 'http://proxy.acme.example:8080' });
  assert.deepEqual(await setNetworkProxy(null), {});
  assert.equal('networkProxy' in readSettings(), false);
});

test('networkProxy: bad input is refused, a password never goes into settings', () => {
  assert.throws(() => assertNetworkProxyInput({ upstream: 'http://u:p@h:1' }), /password never goes into settings/);
  assert.throws(() => assertNetworkProxyInput({ upstream: 'https://h:1' }), /http:\/\//);
  assert.throws(() => assertNetworkProxyInput({ auth: 'kerberos' }), /networkProxy\.auth must be one of/);
  assert.throws(() => assertNetworkProxyInput({ timeouts: { connectMs: 100 } }), /500 to 3600000/);
  assert.throws(() => assertNetworkProxyInput({ timeouts: { other: 1000 } }), /unknown networkProxy timeout/);
  assert.throws(() => assertNetworkProxyInput({ host: 'x' }), /unknown networkProxy setting: host/);
  assert.throws(() => assertNetworkProxyInput({ noProxy: 5 }), /comma-separated/);
  assert.doesNotThrow(() => assertNetworkProxyInput({ noProxy: ['a.example', '.b.example'] }));
  assert.doesNotThrow(() => assertNetworkProxyInput(null));
});

test('NETWORK_PROXY_AUTH is the same list as upstream-proxy.mjs AUTH_MODES (settings.mjs stays a leaf)', () => {
  assert.deepEqual([...NETWORK_PROXY_AUTH], [...AUTH_MODES]);
});

test('networkProxy.fixedPort: 1024-65535 integers only; null removes it', async () => {
  assert.doesNotThrow(() => assertNetworkProxyInput({ fixedPort: 3128 }));
  for (const bad of [80, 1023, 65536, 3128.5, '3128', -1]) {
    assert.throws(() => assertNetworkProxyInput({ fixedPort: bad }), /networkProxy\.fixedPort must be a port from 1024 to 65535/);
  }
  assert.equal((await setNetworkProxy({ fixedPort: 3128 })).fixedPort, 3128);
  assert.equal('fixedPort' in await setNetworkProxy({ fixedPort: null }), false);
});

test('fixedPort: settings validation and upstream-proxy fixedPortOf agree on every value (D17)', () => {
  for (const v of [1023, 1024, 3128, 65535, 65536, 80, 3128.5, '3128', -1, 0]) {
    let accepted = true;
    try { assertNetworkProxyInput({ fixedPort: v }); } catch { accepted = false; }
    assert.equal(fixedPortOf({ fixedPort: v }) !== 0, accepted, String(v));
  }
});

test('previewNetworkProxy: same validation and merge as setNetworkProxy, never writes', async () => {
  await setNetworkProxy(null);   // earlier tests in this file leave noProxy / fixedPort behind
  await setNetworkProxy({ upstream: 'proxy.acme.test:8080', auth: 'ntlm', timeouts: { connectMs: 5000 } });
  const before = networkProxySettings();
  const after = previewNetworkProxy({ upstream: 'proxy2.acme.test:3128', timeouts: { connectMs: null, idleMs: 60000 }, auth: null });
  assert.deepEqual(after, { upstream: 'http://proxy2.acme.test:3128', timeouts: { idleMs: 60000 } });
  assert.deepEqual(networkProxySettings(), before, 'nothing written');
  assert.throws(() => previewNetworkProxy({ upstream: 'http://u:secret@p.acme.test:1' }), /must not carry a user name or password/);
  assert.throws(() => previewNetworkProxy({ auth: 'negotiate' }), /networkProxy.auth must be one of auto, none, basic, ntlm, digest/);
  assert.throws(() => previewNetworkProxy({ fixedPort: 80 }), /fixedPort must be a port from 1024 to 65535/);
  assert.deepEqual(previewNetworkProxy(null), {});
  assert.deepEqual(mergeNetworkProxy({ auth: 'ntlm' }, { auth: '' }), {});
});

test('AC-2.1: flags.corporateProxy true becomes networkProxy.enabled true and the flag key goes', async () => {
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify({ flags: { corporateProxy: true, smartRunNaming: true }, networkProxy: { upstream: 'http://proxy.acme.example:8080' } }));
  assert.equal(await migrateCorporateProxyFlag(), true);
  const s = JSON.parse(readFileSync(settingsFile(), 'utf8'));
  assert.deepEqual(s.flags, { smartRunNaming: true });
  assert.deepEqual(s.networkProxy, { upstream: 'http://proxy.acme.example:8080', enabled: true });
  assert.equal(networkProxyEnabled(s), true);
  assert.equal(await migrateCorporateProxyFlag(), false, 'a second start changes nothing');
  await setNetworkProxy(null);
});

test('AC-2.1: no flag, or the flag false, loads with the proxy off; a false flag key is dropped', () => {
  assert.deepEqual(migrateLegacyProxyFlag({ networkProxy: { upstream: 'http://p:1' } }), { changed: false, settings: { networkProxy: { upstream: 'http://p:1' } } });
  const r = migrateLegacyProxyFlag({ flags: { corporateProxy: false } });
  assert.equal(r.changed, true);
  assert.deepEqual(r.settings, {});
  assert.equal(networkProxyEnabled({ networkProxy: { upstream: 'http://p:1' } }), false);
  assert.equal(networkProxyEnabled({}), false);
});

test('an explicit networkProxy.enabled false wins over a leftover flag; an unwritable home still reads the flag', () => {
  assert.deepEqual(migrateLegacyProxyFlag({ flags: { corporateProxy: true }, networkProxy: { enabled: false } }).settings, { networkProxy: { enabled: false } });
  assert.equal(networkProxyEnabled({ flags: { corporateProxy: true } }), true);
});

test('networkProxy.enabled: a boolean only; false is stored, null drops it', async () => {
  await setNetworkProxy(null);
  assert.throws(() => assertNetworkProxyInput({ enabled: 'yes' }), /networkProxy\.enabled must be true or false/);
  assert.deepEqual(await setNetworkProxy({ enabled: true, upstream: 'p.acme.example:3128' }), { enabled: true, upstream: 'http://p.acme.example:3128' });
  assert.deepEqual(await setNetworkProxy({ enabled: false }), { enabled: false, upstream: 'http://p.acme.example:3128' });
  assert.deepEqual(await setNetworkProxy({ enabled: null }), { upstream: 'http://p.acme.example:3128' });
  await setNetworkProxy(null);
});

test('watchSettingsFile: a write is reported within one poll; nothing fires without a change', async () => {
  let n = 0;
  const stop = watchSettingsFile(() => { n += 1; }, { intervalMs: 50 });
  try {
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(n, 0);
    await setNetworkProxy({ upstream: 'p.acme.example:1' });
    const t0 = Date.now();
    while (n === 0 && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 20));
    assert.equal(n, 1);
  } finally { stop(); await setNetworkProxy(null); }
});

test('readSettingsStrict: null for a missing file or a file that is not a JSON object', () => {
  rmSync(settingsFile(), { force: true });
  assert.equal(readSettingsStrict(), null);
  writeFileSync(settingsFile(), '{not json');
  assert.equal(readSettingsStrict(), null);
  writeFileSync(settingsFile(), '[]');
  assert.equal(readSettingsStrict(), null);
  writeFileSync(settingsFile(), '{"networkProxy":{"enabled":true}}');
  assert.deepEqual(readSettingsStrict(), { networkProxy: { enabled: true } });
  rmSync(settingsFile(), { force: true });
});
