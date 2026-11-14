// test/api-sound.test.mjs
// Design sound's routes (src/core/sound.mjs) in mock mode: the state with no key, the PATCH and
// its own refusals, the order before PATCH /api/providers/:name and POST /api/providers/:name/test,
// the voice sample's bytes and headers, and the broker's refusal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { resetBrokerClient } from '../src/core/broker-client.mjs';
import { soundState } from '../src/core/sound.mjs';

/** ElevenLabs' older 32-hex key shape (A3's KEY): only the key argument of redactKey masks it. */
const KEY = '5f1c9e2ab7d04c3e8a6b1d9f0e2acdef';

let srv, base, homeDir, worcaHomeDir;
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
  WORCA_MOCK: process.env.WORCA_MOCK, ORCH_MOCK: process.env.ORCH_MOCK, WORCA_BROKER_URL: process.env.WORCA_BROKER_URL,
};
const realFetch = globalThis.fetch;
/** Every URL the server tried to fetch outside itself: mock mode makes no call to ElevenLabs. */
const outside = [];
const stub = async (url, init = {}) => {
  if (String(url).startsWith(base)) return realFetch(url, init);
  outside.push(String(url));
  return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
};
const jfetch = async (path, opts) => { const r = await realFetch(`${base}${path}`, opts); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = (path, body) => jfetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const patch = (path, body) => jfetch(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  // Mock mode (D18): listVoices answers six built-in voices and voiceSample a silent WAV, no fetch.
  process.env.WORCA_MOCK = '1';
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apisound-home-'));
  worcaHomeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apisound-whome-'));
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_HOME = worcaHomeDir;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  delete process.env.WORCA_BROKER_URL;
  resetBrokerClient();
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
  resetBrokerClient();
  await Promise.all([homeDir, worcaHomeDir].map((d) => rm(d, { recursive: true, force: true })));
});

test('GET /api/sound answers soundState(): nothing set up yet', async () => {
  const s = await jfetch('/api/sound');
  assert.equal(s.status, 200);
  assert.deepEqual(s.body, soundState());
  assert.equal(s.body.keySet, false);
});

test('PATCH /api/providers/sound stores the key and answers the providers state with sound, never the key', async () => {
  const ok = await patch('/api/providers/sound', { apiKey: KEY });
  assert.equal(ok.status, 200, 'registered before PATCH /api/providers/:name, which would answer 400 unknown provider "sound"');
  assert.deepEqual([ok.body.sound.keySet, ok.body.sound.configured, ok.body.sound.keyMasked], [true, true, '••••••cdef']);
  assert.equal(JSON.stringify(ok.body).includes(KEY), false);
  assert.equal(JSON.stringify((await jfetch('/api/sound')).body).includes(KEY), false);
});

test('PATCH /api/providers/sound refuses an unknown field with a 400 in its own words', async () => {
  const no = await patch('/api/providers/sound', { voice: 'x' });
  assert.deepEqual([no.status, no.body], [400, { error: 'unknown sound field "voice"' }]);
});

test('POST /api/providers/sound/test lists the six mock voices (never the :name/test route), no fetch', async () => {
  const r = await post('/api/providers/sound/test', {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, voices: 6 }, '/api/providers/:name/test would answer { ok: false, message: "unknown provider sound" }');
  assert.deepEqual(outside.filter((u) => u.includes('elevenlabs')), []);
});

test('GET /api/sound/voices/:id/sample sends a listed voice\'s bytes with their type; anything else is a 404', async () => {
  const r = await realFetch(`${base}/api/sound/voices/mock-voice-1/sample`);
  assert.equal(r.status, 200);
  assert.deepEqual(
    [r.headers.get('content-type'), r.headers.get('x-content-type-options'), r.headers.get('cache-control')],
    ['audio/wav', 'nosniff', 'private, max-age=3600'],
  );
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.equal(bytes.toString('latin1', 0, 4), 'RIFF');
  for (const id of ['..%2Fx', 'nope']) {
    const miss = await jfetch(`/api/sound/voices/${id}/sample`);
    assert.deepEqual([miss.status, miss.body], [404, { error: 'No such voice sample' }], id);
  }
});

test('with the credential broker on, a sound key is refused (400) and the state says the service is not available', async () => {
  process.env.WORCA_BROKER_URL = 'http://127.0.0.1:9'; resetBrokerClient();
  try {
    const no = await patch('/api/providers/sound', { apiKey: KEY });
    assert.equal(no.status, 400);
    assert.match(no.body.error, /worca can't store a sound key/);
    const s = await jfetch('/api/sound');
    assert.deepEqual([s.status, s.body.available], [200, false]);
  } finally {
    if (prevEnv.WORCA_BROKER_URL === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = prevEnv.WORCA_BROKER_URL;
    resetBrokerClient();
  }
});
