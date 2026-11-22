// test/api-speech.test.mjs
// Voice-mode routes (docs/speech.md) against a stubbed upstream speech server:
// masked state, PATCH semantics, per-service test, the STT raw-WAV → multipart
// proxy, the TTS audio passthrough, error mapping, and the vendor VAD assets.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { encodeWav } from '../src/shared/speech.mjs';

let srv, base, homeDir, worcaHomeDir;
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const realFetch = globalThis.fetch;
const jsonRes = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let upstream = async (u) => jsonRes(404, { message: `no stub for ${u}` });
const stub = async (url, init = {}) => (String(url).startsWith(base) ? realFetch(url, init) : upstream(String(url), init));
const jfetch = async (path, opts) => { const r = await realFetch(`${base}${path}`, opts); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = (path, body) => jfetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const patch = (path, body) => jfetch(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apispeech-home-'));
  worcaHomeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apispeech-whome-'));
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_HOME = worcaHomeDir;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  _resetForTests();
  const { app } = await import('../ui/server.mjs');
  srv = appServer(app);
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

test('GET /api/speech and /api/providers carry masked speech state', async () => {
  const s = await jfetch('/api/speech');
  assert.equal(s.status, 200);
  assert.equal(s.body.stt.baseUrl, 'http://127.0.0.1:8080/v1');
  assert.equal(s.body.stt.engine, 'browser');
  assert.equal(s.body.tts.engine, 'browser');
  assert.equal(s.body.tts.configured, true);                // the built-in engine needs no server
  assert.equal((await jfetch('/api/providers')).body.speech.stt.model, 'whisper-1');
});

test('PATCH /api/providers/speech: validation 400, masked echo keeps, never leaks the key', async () => {
  assert.equal((await patch('/api/providers/speech', { stt: { baseUrl: 'nope' } })).status, 400);
  const ok = await patch('/api/providers/speech', { stt: { apiKey: 'sk-whisper-12345678' }, tts: { baseUrl: 'http://127.0.0.1:8880/v1' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.speech.stt.keyMasked, '••••••5678');
  assert.equal(JSON.stringify(ok.body).includes('sk-whisper'), false);
  const keep = await patch('/api/providers/speech', { stt: { apiKey: '••••••5678', language: 'bg' } });
  assert.equal(keep.body.speech.stt.keySet, true);
  assert.equal(keep.body.speech.stt.language, 'bg');
  assert.equal((await patch('/api/providers/nope', {})).status, 400);   // the generic route still answers the rest
});

test('POST /api/providers/speech/test answers per service with the typed values', async () => {
  upstream = async (u) => (u.endsWith('/audio/transcriptions') ? jsonRes(200, { text: '' }) : new Response(new Uint8Array(4), { headers: { 'content-type': 'audio/wav' } }));
  assert.deepEqual((await post('/api/providers/speech/test', { kind: 'stt' })).body, { ok: true, detail: 'transcription endpoint answered' });
  assert.deepEqual((await post('/api/providers/speech/test', { kind: 'tts' })).body, { ok: true, detail: '4 bytes of audio' });
  upstream = async () => { throw new Error('ECONNREFUSED'); };
  const bad = await post('/api/providers/speech/test', { kind: 'stt', baseUrl: 'http://127.0.0.1:1/v1' });
  assert.equal(bad.body.ok, false);
  assert.match(bad.body.message, /127\.0\.0\.1:1\/v1.*ECONNREFUSED/);
});

test('POST /api/speech/transcribe forwards the WAV as multipart and returns the text', async () => {
  let got = null;
  upstream = async (u, init) => { got = { u, file: init.body.get('file') }; return jsonRes(200, { text: ' hello world ' }); };
  const wav = encodeWav(new Float32Array(1600));
  const r = await jfetch('/api/speech/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { text: 'hello world' });
  assert.equal(got.u, 'http://127.0.0.1:8080/v1/audio/transcriptions');
  assert.equal(got.file.size, wav.length);
  assert.equal((await jfetch('/api/speech/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
  upstream = async () => jsonRes(500, { error: 'boom' });
  const e = await jfetch('/api/speech/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  assert.equal(e.status, 502);
  assert.match(e.body.error, /answered 500/);
});

test('POST /api/speech/synthesize streams the upstream audio back', async () => {
  upstream = async () => new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'content-type': 'audio/wav' } });
  const r = await realFetch(`${base}/api/speech/synthesize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hello.' }) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'audio/wav');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [82, 73, 70, 70]);
  assert.equal((await post('/api/speech/synthesize', { text: '' })).status, 400);
});

test('vendor VAD assets are served from node_modules, nothing else under their prefixes', async () => {
  for (const p of ['/vendor/vad/bundle.min.js', '/vendor/vad/vad.worklet.bundle.min.js', '/vendor/vad/silero_vad_v5.onnx', '/vendor/ort/ort-wasm-simd-threaded.wasm', '/vendor/ort/ort-wasm-simd-threaded.mjs']) {
    const r = await realFetch(`${base}${p}`);
    assert.equal(r.status, 200, p);
    await r.arrayBuffer();
  }
  assert.equal((await realFetch(`${base}/vendor/ort/ort-wasm-simd-threaded.jsep.wasm`)).status, 404);
  assert.equal((await realFetch(`${base}/vendor/ort/ort.wasm.min.js`)).status, 404);   // the vad bundle carries its own ORT JS
  assert.equal((await realFetch(`${base}/vendor/vad/package.json`)).status, 404);
  const wasm = await realFetch(`${base}/vendor/ort/ort-wasm-simd-threaded.wasm`);
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  await wasm.arrayBuffer();   // drain it, or the open keep-alive socket holds srv.close() for 30 s
});

test('built-in engine files: pinned model served no-store, counted on the card, removed by DELETE /api/speech/cache', async () => {
  const hf = [];
  upstream = async (u) => { hf.push(u); return new Response('{"model_type":"whisper"}', { status: 200, headers: { 'content-length': '24' } }); };
  const first = await realFetch(`${base}/vendor/speech/hf/onnx-community/whisper-base/resolve/main/config.json`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');     // one copy on disk: worca's, not the browser's
  assert.equal(await first.text(), '{"model_type":"whisper"}');
  assert.match(hf[0], /^https:\/\/huggingface\.co\/onnx-community\/whisper-base\/resolve\/[0-9a-f]{40}\/config\.json$/);
  const again = await realFetch(`${base}/vendor/speech/hf/onnx-community/whisper-base/resolve/main/config.json`);
  assert.equal(await again.text(), '{"model_type":"whisper"}');
  assert.equal(hf.length, 1);
  assert.equal((await realFetch(`${base}/vendor/speech/hf/someone/else/resolve/main/config.json`)).status, 404);
  assert.equal((await jfetch('/api/providers')).body.speech.cacheBytes, 24);
  const del = await jfetch('/api/speech/cache', { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal(del.body.removed, 24);
  assert.equal(del.body.providers.speech.cacheBytes, 0);
});
