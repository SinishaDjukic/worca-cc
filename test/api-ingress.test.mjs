// test/api-ingress.test.mjs — the Teams ingress route (design §4.7): the ONE
// loopback-guard exemption. Uses raw http.request so the Host header can
// impersonate a tunnel hostname (fetch forbids setting Host). WORCA_MOCK=1:
// the webhook forward hits the mock channel host behavior hook.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { writePluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { writePluginConfig } from '../src/core/plugin-config.mjs';
import { setMockChannelBehavior } from '../src/core/chat/channel-host.mjs';

process.env.WORCA_MOCK = '1';
useTempHome(after);

const NAME = 'teams-fixture';
const TOKEN = 'cap-token-123456';
const SCHEMA = [
  { key: 'appId', type: 'text', label: 'App', secret: false, required: true },
  { key: 'ingressToken', type: 'text', label: 'Ingress', secret: true, required: true },
];

let channelHost, srv, port;

before(async () => {
  const cur = pluginCurrentDir(NAME);
  mkdirSync(join(cur, 'channel'), { recursive: true });
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({
    name: NAME,
    engines: { 'worca-cc-api': '>=2 <3' },
    chatChannels: [{
      id: 'main', platform: 'teams', module: './channel/worker.mjs',
      ingress: 'webhook', configSchema: SCHEMA,
    }],
  }));
  writeFileSync(join(cur, 'channel', 'worker.mjs'), 'export function createChannelWorker() { return { start() {}, stop() {}, send() {}, handleWebhook() { return { statusCode: 200 }; } }; }');
  writePluginsLock({
    [NAME]: { repoUrl: 'https://example.test/t.git', subdir: '', pinnedSha: 'b'.repeat(40), version: null, enabled: true, installedAt: '2026-08-12T00:00:00.000Z' },
  });
  writePluginConfig(NAME, SCHEMA, { appId: 'app-1', ingressToken: TOKEN });

  const server = await import('../ui/server.mjs');
  ({ channelHost } = server._testing);
  channelHost.start();
  srv = server.app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  port = srv.address().port;
});

after(async () => {
  setMockChannelBehavior(null);
  srv?.close();
  await channelHost?.stop();
  delete process.env.WORCA_MOCK;
});

/** Raw request with an arbitrary Host header (tunnel impersonation). */
function raw(path, { method = 'POST', host = 'tunnel.example.com', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { Host: host, ...headers } }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const PATH = (token = TOKEN, plugin = NAME) => `/api/ingress/teams/${plugin}/main/${token}`;

test('valid token: non-loopback Host accepted, raw body forwarded, worker response passes through', async () => {
  const seen = [];
  setMockChannelBehavior({
    '*': {
      webhook: (req) => {
        seen.push(req);
        return { statusCode: 200, headers: { 'x-echo': 'yes' }, bodyB64: Buffer.from('{"pong":true}').toString('base64') };
      },
    },
  });
  const res = await raw(PATH(), {
    headers: { 'content-type': 'application/json', authorization: 'Bearer jwt-here' },
    body: '{"type":"message","text":"/status"}',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body, '{"pong":true}');
  assert.equal(seen.length, 1);
  assert.equal(Buffer.from(seen[0].bodyB64, 'base64').toString(), '{"type":"message","text":"/status"}', 'raw body verbatim');
  assert.equal(seen[0].headers.authorization, 'Bearer jwt-here', 'headers forwarded for worker-side JWT validation');
  setMockChannelBehavior(null);
});

test('uniform 404: wrong token, unknown plugin/channel; traversal falls to the 403 guard', async () => {
  for (const p of [PATH('wrong-token'), PATH(TOKEN, 'ghost-plugin'), `/api/ingress/teams/${NAME}/other/${TOKEN}`]) {
    const res = await raw(p, { body: '{}' });
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(res.body, /token|ingress|plugin "/i, 'no detail leaks');
  }
  // `..` segments normalize OUT of /api/ingress, so the loopback guard owns them
  const trav = await raw(`/api/ingress/teams/../../etc/${TOKEN}`, { body: '{}' });
  assert.equal(trav.status, 403);
});

test('worker 401 (invalid JWT) passes through; worker fault -> 503', async () => {
  setMockChannelBehavior({ '*': { webhook: () => ({ statusCode: 401 }) } });
  assert.equal((await raw(PATH(), { body: '{}' })).status, 401);
  setMockChannelBehavior({ '*': { webhook: () => { throw new Error('worker gone'); } } });
  assert.equal((await raw(PATH(), { body: '{}' })).status, 503);
  setMockChannelBehavior(null);
});

test('oversize body -> 413; loopback guard still owns every other /api route', async () => {
  const big = 'x'.repeat(300 * 1024);
  assert.equal((await raw(PATH(), { headers: { 'content-type': 'application/json' }, body: big })).status, 413);
  const other = await raw('/api/chat/status', { method: 'GET' });
  assert.equal(other.status, 403, 'non-loopback Host rejected everywhere outside /api/ingress');
  const local = await raw('/api/chat/status', { method: 'GET', host: `127.0.0.1:${port}` });
  assert.equal(local.status, 200);
});
