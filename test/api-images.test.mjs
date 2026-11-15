// test/api-images.test.mjs
// Design pictures' routes (src/core/images.mjs) against a stubbed upstream image service: the
// state with no key, the PATCH and its own refusals, the order before PATCH /api/providers/:name,
// the global guards only for a signed-in person, and the Test picture.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';

let srv, base, homeDir, worcaHomeDir;
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
  WORCA_IDENTITY_HEADER: process.env.WORCA_IDENTITY_HEADER, WORCA_IDENTITY_TRUSTED_PROXIES: process.env.WORCA_IDENTITY_TRUSTED_PROXIES,
  WORCA_MOCK: process.env.WORCA_MOCK, ORCH_MOCK: process.env.ORCH_MOCK,
};
const realFetch = globalThis.fetch;
const jsonRes = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let upstream = async (u) => jsonRes(404, { message: `no stub for ${u}` });
const stub = async (url, init = {}) => (String(url).startsWith(base) ? realFetch(url, init) : upstream(String(url), init));
const jfetch = async (path, opts) => { const r = await realFetch(`${base}${path}`, opts); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = (path, body) => jfetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const patch = (path, body) => jfetch(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** A PNG header: signature, IHDR length 13, `IHDR`, w at 16, h at 20 (33 bytes), then `pad` zeros. */
function png(w, h, pad = 0) {
  const b = Buffer.alloc(33 + pad);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

before(async () => {
  // tools/test.mjs passes the mock flags through; with either set generatePicture never calls upstream.
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apiimages-home-'));
  worcaHomeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apiimages-whome-'));
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_HOME = worcaHomeDir;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  _resetForTests();
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  globalThis.fetch = stub;
});
after(async () => {
  globalThis.fetch = realFetch;
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await Promise.all([homeDir, worcaHomeDir].map((d) => rm(d, { recursive: true, force: true })));
});

test('GET /api/images and /api/providers carry the images state, never a key', async () => {
  const s = await jfetch('/api/images');
  assert.deepEqual([s.status, s.body.service, s.body.model, s.body.price, s.body.configured], [200, 'openai', 'gpt-image-2.6-flare', null, false]);
  assert.equal((await jfetch('/api/providers')).body.images.baseUrl, 'https://api.openai.com/v1');
});
test('PATCH /api/providers/images: the price rule is a 400 in its own words; masked echo keeps; never leaks', async () => {
  const no = await patch('/api/providers/images', { service: 'openai', apiKey: 'sk-img-12345678' });
  assert.deepEqual([no.status, no.body.error], [400, 'Enter a price; 0 for a free server']);
  const ok = await patch('/api/providers/images', { service: 'openai', apiKey: 'sk-img-12345678', price: 0.04 });
  assert.equal(ok.status, 200, 'registered before PATCH /api/providers/:name, which would answer 400 unknown provider');
  assert.deepEqual([ok.body.images.keyMasked, ok.body.images.configured, JSON.stringify(ok.body).includes('sk-img')], ['••••••5678', true, false]);
  const keep = await patch('/api/providers/images', { apiKey: '••••••5678', model: 'gpt-image-2.6-sunburst' });
  assert.deepEqual([keep.body.images.keySet, keep.body.images.model], [true, 'gpt-image-2.6-sunburst']);
  assert.equal((await patch('/api/providers/nope', {})).status, 400);
});
test('a signed-in person reads GET /api/images exactly as GET /api/speech: the global guards only, never a key', async () => {
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';   // as test/api-chat-home-pins.test.mjs ≈68
  try {
    const as = { headers: { 'x-test-user': 'ada@example.com' } };
    assert.equal((await jfetch('/api/speech', as)).status, 200);
    const s = await jfetch('/api/images', as);
    assert.deepEqual([s.status, s.body.configured, s.body.model, s.body.keyMasked], [200, true, 'gpt-image-2.6-sunburst', '••••••5678']);
    assert.equal(JSON.stringify(s.body).includes('sk-img'), false);
  } finally { delete process.env.WORCA_IDENTITY_HEADER; delete process.env.WORCA_IDENTITY_TRUSTED_PROXIES; }
});
test('POST /api/images/test makes the picture on screen; a refusal is ok:false with its reason', async () => {
  let asked = null;
  upstream = async (u, init) => { asked = { u, body: JSON.parse(init.body) }; return jsonRes(200, { data: [{ b64_json: png(1024, 1024).toString('base64') }] }); };
  const r = await post('/api/images/test', { service: 'xai', baseUrl: 'https://api.x.ai/v1', model: 'grok-imagine-image-2.0' });
  assert.deepEqual([r.status, r.body.ok, r.body.w, r.body.h], [200, true, 1024, 1024]);
  assert.match(r.body.dataUrl, /^data:image\/png;base64,/);
  assert.deepEqual([asked.u, asked.body.aspect_ratio], ['https://api.x.ai/v1/images/generations', '1:1']);
  upstream = async () => jsonRes(401, {});
  assert.deepEqual((await post('/api/images/test', {})).body, { ok: false, message: 'the image service rejected the key' });
});
