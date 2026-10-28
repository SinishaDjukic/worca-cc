// test/workflow-export-marketplace-api.test.mjs
// HTTP surface of #717: destination 'marketplace' on POST /api/workflows/:id/export (body checks and
// the error-code → status mapping) and GET /api/marketplaces/publish-targets. Boots the in-process
// app like test/workflow-share-api.test.mjs, so _testing.setDeps reaches the module the route uses.
// The success path (draft reaching createPr, the PR, the push) is covered by marketplace-publish-flow.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeMarketplaces } from '../src/core/marketplaces.mjs';
import { _testing } from '../src/core/marketplace-publish.mjs';

useTempHome(after);
let srv, base;
before(async () => {
  process.env.WORCA_MOCK = '1';
  delete process.env.WORCA_CLONE_ALLOW;                    // D17 is read per request: keep the ambient one out
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  writeMarketplaces({ seededBuiltin: true, marketplaces: {
    acme: { id: 'acme', url: 'https://github.com/acme/market', name: 'Acme', ref: 'dev', description: '', addedAt: '2026-10-15T00:00:00Z', lastSync: null, plugins: [], warnings: [] },
    loc: { id: 'loc', url: '/srv/market', name: 'Local', description: '', addedAt: '2026-10-15T00:00:00Z', lastSync: null, plugins: [], warnings: [] },
  } });
});
after(() => new Promise((r) => srv.close(r)));
afterEach(() => _testing.reset());
const post = (body) => fetch(`${base}/api/workflows/wf_default/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('GET /api/marketplaces/publish-targets: GitHub/Azure entries only; the rest with a reason', async () => {
  const r = await fetch(`${base}/api/marketplaces/publish-targets`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.targets.map((t) => [t.id, t.repo, t.ref]), [['acme', 'acme/market', 'dev']]);
  assert.deepEqual(j.skipped.map((s) => s.id), ['loc']);
});

test('destination marketplace: body validation and error-code → status mapping', async () => {
  assert.equal((await post({ destination: 'marketplace' })).status, 400);                                  // marketplaceId
  assert.equal((await post({ destination: 'marketplace', marketplaceId: 'acme', draft: 'yes' })).status, 400);
  assert.equal((await post({ destination: 'marketplace', marketplaceId: 'acme', keepVersion: true })).status, 400);  // D3, as the CLI
  assert.equal((await post({ destination: 'marketplace', marketplaceId: 'nope' })).status, 404);
  assert.equal((await post({ destination: 'marketplace', marketplaceId: 'loc' })).status, 400);              // UNSUPPORTED
  _testing.setDeps({ providerAvailable: async () => ({ ok: true }), gitEnv: async () => ({ env: {}, error: null }),
    git: async () => ({ ok: false, code: 128, stdout: '', stderr: 'fatal: repository not found' }) });
  const r = await post({ destination: 'marketplace', marketplaceId: 'acme' });
  assert.equal(r.status, 502);                                                                               // GIT_FAILED
  const j = await r.json();
  assert.equal(j.code, 'GIT_FAILED');
  assert.match(j.error, /could not clone acme\/market \(dev\)/);
});

test('destination marketplace: a valid request (draft + name) reaches the core, which talks to the REBUILT clone URL', async () => {
  // Stop right after the call is shaped: the stubbed clone fails, but the request got past the route's validation.
  const seen = [];
  _testing.setDeps({ providerAvailable: async () => ({ ok: true }),
    gitEnv: async (role, url) => { seen.push([role, url]); return { env: {}, error: null }; },
    git: async () => ({ ok: false, code: 128, stdout: '', stderr: 'x' }) });
  await post({ destination: 'marketplace', marketplaceId: 'acme', draft: true, pluginName: 'my-plugin' });
  assert.deepEqual(seen[0], ['read', 'https://github.com/acme/market.git']);
});

test('local-folder plugin export still behaves exactly as before (regression)', async () => {
  const r = await post({ destination: 'plugin' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /pluginDir is required/);
});
