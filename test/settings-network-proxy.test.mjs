// test/settings-network-proxy.test.mjs — Settings › Network proxy (settings.json networkProxy,
// corporateProxy flag): the setter that PUT /api/proxy/settings uses.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NETWORK_PROXY_AUTH, networkProxySettings, setNetworkProxy, assertNetworkProxyInput, readSettings } from '../src/core/settings.mjs';
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
