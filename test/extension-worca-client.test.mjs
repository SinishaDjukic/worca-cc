import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseUrl, createWorcaClient, DEFAULT_BASE_URL } from '../extension/src/worca-client.mjs';

test('base URL: http on loopback only, normalised to origin', () => {
  assert.equal(normalizeBaseUrl('http://127.0.0.1:4317/'), 'http://127.0.0.1:4317');
  assert.equal(normalizeBaseUrl('http://localhost:5000/x'), 'http://localhost:5000');
  for (const bad of ['https://127.0.0.1:4317', 'http://worca.example.com', 'ftp://127.0.0.1', 'nonsense']) assert.equal(normalizeBaseUrl(bad), null);
  assert.equal(DEFAULT_BASE_URL, 'http://127.0.0.1:4317');
});
test('errors map to states: offline, unpaired, remote, http', async () => {
  const cfg = async () => ({ baseUrl: 'http://127.0.0.1:1', token: 'wex_t' });
  const off = createWorcaClient({ fetch: async () => { throw new TypeError('fetch failed'); }, getConfig: cfg });
  await assert.rejects(off.call('/api/extension/hello'), (e) => e.kind === 'offline');
  const mk = (status, body) => createWorcaClient({ fetch: async () => new Response(JSON.stringify(body), { status }), getConfig: cfg });
  await assert.rejects(mk(401, { code: 'extension-unpaired', error: 'x' }).call('/api/ask/threads'), (e) => e.kind === 'unpaired');
  await assert.rejects(mk(403, { code: 'extension-remote-mode', error: 'x' }).call('/api/extension/hello'), (e) => e.kind === 'remote');
  await assert.rejects(mk(429, { error: 'busy' }).call('/api/pinpoint'), (e) => e.kind === 'http' && e.status === 429);
});
test('sends the bearer token and never credentials', async () => {
  let seen = null;
  const c = createWorcaClient({ fetch: async (u, o) => { seen = { u, o }; return new Response('{}'); }, getConfig: async () => ({ baseUrl: 'http://127.0.0.1:4317', token: 'wex_abc' }) });
  await c.call('/api/projects');
  assert.equal(seen.u, 'http://127.0.0.1:4317/api/projects');
  assert.equal(seen.o.headers.Authorization, 'Bearer wex_abc');
  assert.equal(seen.o.credentials, 'omit');
});
