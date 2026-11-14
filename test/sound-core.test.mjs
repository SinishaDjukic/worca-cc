// test/sound-core.test.mjs
// src/core/sound.mjs against an injected fetch (no network, no live service): the voice list,
// the SPEC §7 reasons and their statuses (never the key), the speech and music requests, what is
// not sound, a caller's abort, the deadline, the voice samples, mock mode, the Providers row's
// state and Test, and when sound is ready.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateSound } from '../src/core/settings.mjs';
import { SOUND_LIMITS, voiceUsd, musicUsd } from '../src/shared/sound-services.mjs';
import { fakeMp3 } from './helpers/promo-fixtures.mjs';
import {
  SoundError, soundState, soundReady, listVoices, voiceSample, speak, compose, testSound, audioInfo, silentWav,
} from '../src/core/sound.mjs';

delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; delete process.env.WORCA_PROMO_ELEVENLABS_BASE;

/** ElevenLabs' older 32-hex key shape: only the key argument of redactKey masks it. */
const KEY = '5f1c9e2ab7d04c3e8a6b1d9f0e2acdef';

async function withSandbox(fn) {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-soundcore-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try { return await fn(home); } finally {
    for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    await rm(home, { recursive: true, force: true });
  }
}

/** Run `fn` with `vars` set (undefined deletes), then put the environment back. */
async function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}

/** A fetch that records each call and answers `route(url, init)` (what route throws, it rethrows). */
function stub(route) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: { ...(init.headers || {}) }, body: init.body ? JSON.parse(init.body) : undefined, redirect: init.redirect });
    return route(String(url), init);
  };
  f.calls = calls;
  return f;
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const bytes = (status, buf) => new Response(buf, { status, headers: { 'content-type': 'audio/mpeg' } });
/** About `sec` seconds of MP3 (fakeMp3 takes frames of 1152 samples at 44.1 kHz). */
const mp3 = (sec) => fakeMp3(Math.round((sec * 44100) / 1152));
/** `n` account voices; voice 1 has no sample, voice 5 is the narration voice. */
const voices = (n) => ({
  voices: Array.from({ length: n }, (_, i) => ({
    voice_id: `voice${i}xxxxxxx`,
    name: `V${i}`,
    labels: { gender: i % 2 ? 'male' : 'female', accent: 'british', use_case: i === 5 ? 'narration' : 'social media', description: 'calm' },
    preview_url: i === 1 ? null : `https://cdn.example/${i}.mp3`,
  })),
  has_more: false,
});
/** A fetch that answers nothing until its signal aborts (then rejects with the signal's reason); 3 s ref'd bound. */
function hangStub() {
  return stub((url, init) => new Promise((resolve, reject) => {
    const signal = init.signal;
    if (signal?.aborted) { reject(signal.reason); return; }
    const bound = setTimeout(() => reject(new Error('hung')), 3000);
    signal?.addEventListener('abort', () => { clearTimeout(bound); reject(signal.reason ?? new DOMException('aborted', 'AbortError')); }, { once: true });
  }));
}
const noSleep = async () => {};
const neverTheKey = (e) => !String(e?.message).includes(KEY) && !String(e?.stack).includes(KEY) && !JSON.stringify(e).includes(KEY);

test('1 listVoices: one keyed call to the ElevenLabs origin, redirects refused; six voices, narration first, { id, name, about }', async () => {
  const s = stub(() => json(200, voices(9)));
  const out = await listVoices({ key: KEY, fetch: s });
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, 'https://api.elevenlabs.io/v2/voices?page_size=100');
  assert.equal(s.calls[0].method, 'GET');
  assert.equal(s.calls[0].headers['xi-api-key'], KEY);
  assert.equal(s.calls[0].redirect, 'error');
  assert.equal(out.length, 6);
  assert.ok(!out.some((v) => v.id === 'voice1xxxxxxx'), 'a voice without a sample is not offered');
  assert.equal(out[0].id, 'voice5xxxxxxx');
  assert.deepEqual(Object.keys(out[0]), ['id', 'name', 'about']);
  assert.equal(out[0].name, 'V5');
  assert.equal(out[0].about, 'male · british · calm');

  await withEnv({ WORCA_PROMO_ELEVENLABS_BASE: 'http://127.0.0.1:9' }, async () => {
    const o = stub(() => json(200, voices(9)));
    await listVoices({ key: KEY, fetch: o });
    assert.equal(o.calls[0].url, 'https://api.elevenlabs.io/v2/voices?page_size=100', 'the promo origin override is never read');
  });
  await withEnv({ WORCA_MOCK: '1' }, async () => {
    const m = stub(() => json(200, voices(9)));
    const got = await listVoices({ key: KEY, fetch: m });
    assert.equal(m.calls.length, 1, 'a passed fetch turns mock off');
    assert.equal(got[0].id, 'voice5xxxxxxx');
  });
});

test('1b listVoices: follows next_page_token while has_more, at most 3 pages; an http: sample is not offered', async () => {
  let page = 0;
  const s = stub(() => {
    page += 1;
    return json(200, { voices: [{ voice_id: `p${page}voice`, name: `P${page}`, labels: { gender: 'female' }, preview_url: page === 2 ? 'http://cdn.example/plain.mp3' : `https://cdn.example/p${page}.mp3` }], has_more: true, next_page_token: `tok${page + 1}` });
  });
  const out = await listVoices({ key: KEY, fetch: s });
  assert.deepEqual(s.calls.map((c) => c.url), [
    'https://api.elevenlabs.io/v2/voices?page_size=100',
    'https://api.elevenlabs.io/v2/voices?page_size=100&next_page_token=tok2',
    'https://api.elevenlabs.io/v2/voices?page_size=100&next_page_token=tok3',
  ]);
  assert.deepEqual(out.map((v) => v.id), ['p1voice', 'p3voice']);
  assert.equal(out[0].about, 'female');
  const none = stub(() => assert.fail('an http: sample is never fetched'));
  assert.equal(await voiceSample('p2voice', { fetch: none }), null);
});

test('2 failures: a SoundError with SPEC §7 words and the right status, never the key', async () => {
  const cases = [
    ['speak', () => json(401, { detail: { code: 'invalid_api_key', message: 'bad ' + KEY } }), 'ElevenLabs rejected the key', 401, 1],
    ['speak', () => json(402, { detail: { code: 'insufficient_credits', message: 'no' } }), 'the ElevenLabs account is out of credits', 402, 1],
    ['speak', () => json(403, { detail: { code: 'feature_not_available', message: 'no' } }), 'this ElevenLabs plan or key cannot do that', 403, 1],
    ['speak', () => json(422, { detail: [{ msg: 'text too long' }] }), 'ElevenLabs refused the request: text too long', 422, 1],
    ['speak', () => json(400, { detail: { code: 'invalid_parameters', message: 'bad ' + KEY } }), /^ElevenLabs refused the request: bad/, 400, 1],
    ['speak', () => json(404, {}), 'ElevenLabs refused the request: HTTP 404', 404, 1],
    ['compose', () => json(400, { detail: { status: 'bad_prompt', data: { prompt_suggestion: 'y' } } }), 'ElevenLabs refused this music description', 400, 1],
    ['listVoices', () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); }, 'ElevenLabs could not be reached', 502, 3],
    ['listVoices', () => json(429, { detail: { code: 'system_busy', message: 'busy ' + KEY } }), 'ElevenLabs is busy; try again', 429, 3],
    ['compose', () => json(503, {}), 'ElevenLabs is busy; try again', 503, 3],
  ];
  const run = { speak: (o) => speak({ text: 'Hi.', voiceId: 'voice0xxxxxxx', ...o }), compose: (o) => compose({ prompt: 'Calm.', seconds: 10, ...o }), listVoices: (o) => listVoices(o) };
  for (const [fn, answer, message, status, calls] of cases) {
    const s = stub(answer);
    await assert.rejects(run[fn]({ key: KEY, fetch: s, sleep: noSleep }), (e) => {
      assert.ok(e instanceof SoundError, `${fn} ${status}: a SoundError (${e?.name}: ${e?.message})`);
      if (message instanceof RegExp) assert.match(e.message, message); else assert.equal(e.message, message);
      assert.equal(e.status, status, `${fn} ${status}: status`);
      assert.ok(neverTheKey(e), `${fn} ${status}: never the key (${e.message})`);
      return true;
    });
    assert.equal(s.calls.length, calls, `${fn} ${status}: calls`);
  }
  await withSandbox(async () => {
    const s = stub(() => assert.fail('no call without a key'));
    await assert.rejects(listVoices({ fetch: s }), (e) => e instanceof SoundError && e.message === 'ElevenLabs is not set up' && e.status === 409);
    assert.equal(s.calls.length, 0);
  });

  // A typed key with spaces (a card's field): sent trimmed, and an echo of it is still redacted.
  const padded = stub(() => json(400, { detail: { code: 'invalid_parameters', message: 'bad ' + KEY } }));
  await assert.rejects(speak({ text: 'Hi.', voiceId: 'voice0xxxxxxx', key: ` ${KEY} `, fetch: padded, sleep: noSleep }), (e) => {
    assert.ok(e instanceof SoundError && e.status === 400, `${e?.name}: ${e?.message}`);
    assert.ok(neverTheKey(e), `a padded key is redacted (${e.message})`);
    return true;
  });
  assert.equal(padded.calls[0].headers['xi-api-key'], KEY);
});

test('3 speak: the with-timestamps request, the neighbours as context, the clip, its words and its price', async () => {
  const text = 'Hi there.';
  const chars = [...text];
  const alignment = { characters: chars, character_start_times_seconds: chars.map((_, i) => i / 10), character_end_times_seconds: chars.map((_, i) => (i + 1) / 10) };
  const s = stub(() => json(200, { audio_base64: mp3(2).toString('base64'), alignment, normalized_alignment: alignment }));
  const out = await speak({ text, voiceId: 'voice0xxxxxxx', previousText: 'Before.', nextText: 'After.', key: KEY, fetch: s });
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, 'https://api.elevenlabs.io/v1/text-to-speech/voice0xxxxxxx/with-timestamps?output_format=mp3_44100_128');
  assert.equal(s.calls[0].method, 'POST');
  assert.equal(s.calls[0].headers['xi-api-key'], KEY);
  assert.equal(s.calls[0].redirect, 'error');
  assert.deepEqual(s.calls[0].body, { text: 'Hi there.', model_id: 'eleven_multilingual_v2', previous_text: 'Before.', next_text: 'After.' });
  assert.ok(Buffer.isBuffer(out.bytes));
  assert.equal(out.ext, 'mp3');
  assert.ok(Math.abs(out.seconds - 2) < 0.1, `seconds ${out.seconds}`);
  assert.deepEqual(out.words.map((w) => w.w), ['Hi', 'there.']);
  assert.deepEqual(Object.keys(out.words[0]), ['w', 't0', 't1']);
  assert.deepEqual([out.words[1].t0, out.words[1].t1], [0.3, 0.9]);
  assert.deepEqual([out.chars, out.costUsd, out.model], [9, 0.00072, 'elevenlabs/eleven_multilingual_v2']);

  const bare = stub(() => json(200, { audio_base64: mp3(1).toString('base64'), normalized_alignment: alignment }));
  const b = await speak({ text, voiceId: 'voice0xxxxxxx', previousText: '', nextText: 7, key: KEY, fetch: bare });
  assert.deepEqual(bare.calls[0].body, { text: 'Hi there.', model_id: 'eleven_multilingual_v2' }, 'no empty or non-string neighbours');
  assert.deepEqual(b.words.map((w) => w.w), ['Hi', 'there.'], 'normalized_alignment when alignment is missing');
});

test('4 not sound: an HTML page with status 200, more than 40 MiB, a content-length over the bound (body never read)', async () => {
  const NOT = 'ElevenLabs answered with something that is not sound';
  const html = () => bytes(200, Buffer.from('<html>ok</html>'));
  for (const [name, call] of [
    ['speak', (f) => speak({ text: 'Hi.', voiceId: 'voice0xxxxxxx', key: KEY, fetch: f })],
    ['compose', (f) => compose({ prompt: 'Calm.', seconds: 10, key: KEY, fetch: f })],
  ]) {
    const s = stub(html);
    await assert.rejects(call(s), (e) => e instanceof SoundError && e.message === NOT && e.status === 502, name);
    assert.equal(s.calls.length, 1, `${name}: one call`);
  }
  const big = stub(() => bytes(200, Buffer.alloc(SOUND_LIMITS.audioBytes + 1)));
  await assert.rejects(compose({ prompt: 'Calm.', seconds: 10, key: KEY, fetch: big }), (e) => e instanceof SoundError && e.message === NOT && e.status === 502);
  assert.equal(big.calls.length, 1);

  let read = false;
  const declared = stub(() => ({ ok: true, status: 200, headers: new Headers({ 'content-length': String(SOUND_LIMITS.audioBytes + 1) }), body: null, arrayBuffer: async () => { read = true; return mp3(1).buffer; } }));
  await assert.rejects(compose({ prompt: 'Calm.', seconds: 10, key: KEY, fetch: declared }), (e) => e instanceof SoundError && e.message === NOT && e.status === 502);
  assert.equal(read, false, 'the body is never read');

  // Real MP3 frames past the bound: only the size check refuses them (audioInfo would read them).
  const frames = Buffer.alloc(SOUND_LIMITS.audioBytes + 418, fakeMp3(1).subarray(20));
  assert.ok(audioInfo(frames), 'readable MP3, refused only for its size');
  const longMusic = stub(() => bytes(200, frames));
  await assert.rejects(compose({ prompt: 'Calm.', seconds: 10, key: KEY, fetch: longMusic }), (e) => e instanceof SoundError && e.message === NOT && e.status === 502);
  const s = stub(() => json(200, { audio_base64: frames.toString('base64'), alignment: null }));
  await assert.rejects(speak({ text: 'Hi.', voiceId: 'voice0xxxxxxx', key: KEY, fetch: s }), (e) => e instanceof SoundError && e.message === NOT && e.status === 502);

  const notAudio = stub(() => json(200, { audio_base64: 'aGVsbG8=', alignment: null }));
  await assert.rejects(speak({ text: 'Hi.', voiceId: 'voice0xxxxxxx', key: KEY, fetch: notAudio }), (e) => e instanceof SoundError && e.message === NOT && e.status === 502, 'base64 that is not audio');
  assert.equal(notAudio.calls.length, 1);
});

test('5 compose: the music request, clamped to 300 s, instrumental; seconds read from the bytes, priced by them', async () => {
  const s = stub(() => bytes(200, mp3(4)));
  const out = await compose({ prompt: 'Calm.', seconds: 900, key: KEY, fetch: s });
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, 'https://api.elevenlabs.io/v1/music');
  assert.equal(s.calls[0].method, 'POST');
  assert.equal(s.calls[0].headers['xi-api-key'], KEY);
  assert.equal(s.calls[0].redirect, 'error');
  assert.deepEqual(s.calls[0].body, { prompt: 'Calm.', music_length_ms: 300000, model_id: 'music_v2_5', force_instrumental: true });
  assert.equal(out.ext, 'mp3');
  assert.ok(Math.abs(out.seconds - 4) < 0.1, `seconds ${out.seconds}`);
  assert.equal(out.costUsd, musicUsd(out.seconds));
  assert.equal(out.model, 'elevenlabs/music_v2_5');
  const short = stub(() => bytes(200, mp3(3)));
  await compose({ prompt: 'Calm.', seconds: 1.2, key: KEY, fetch: short });
  assert.equal(short.calls[0].body.music_length_ms, 3000, 'at least 3 s');
});

test('6 audioInfo: a 48 kHz MP3 (192 kbps, 576-byte frames), a WAV with a chunk before its data, and what it refuses', () => {
  const frame = () => { const f = Buffer.alloc(576); f[0] = 0xff; f[1] = 0xfb; f[2] = 0xb4; f[3] = 0x64; return f; };
  const n = 125;
  const info = audioInfo(Buffer.concat(Array.from({ length: n }, frame)));
  assert.equal(info.ext, 'mp3');
  assert.ok(Math.abs(info.seconds - n * 0.024) < 1e-9, `seconds ${info.seconds}`);

  const wav = silentWav(1.5);
  const list = Buffer.from([0x4c, 0x49, 0x53, 0x54, 4, 0, 0, 0, 0, 0, 0, 0]);
  const withList = Buffer.concat([wav.subarray(0, 36), list, wav.subarray(36)]);
  assert.deepEqual(audioInfo(withList), { ext: 'wav', seconds: 1.5 });
  assert.equal(audioInfo(silentWav(0)), null, 'no length is not sound');
  assert.equal(audioInfo(Buffer.alloc(0)), null);
  assert.equal(audioInfo('RIFF'), null);
});

test('7 a caller abort: an AbortError, never retried; a signal aborted before the call makes no call', async () => {
  const hang = hangStub();
  const ctl = new AbortController();
  const p = speak({ text: 'Hi.', voiceId: 'voice0xxxxxxx', key: KEY, fetch: hang, signal: ctl.signal });
  await new Promise((r) => setImmediate(r));
  assert.equal(hang.calls.length, 1);
  ctl.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError' && !(e instanceof SoundError));
  assert.equal(hang.calls.length, 1);

  const early = hangStub();
  const done = new AbortController();
  done.abort();
  await assert.rejects(speak({ text: 'Hi.', voiceId: 'voice0xxxxxxx', key: KEY, fetch: early, signal: done.signal }), { name: 'AbortError' });
  await assert.rejects(listVoices({ key: KEY, fetch: early, signal: done.signal }), { name: 'AbortError' });
  await assert.rejects(compose({ prompt: 'Calm.', seconds: 10, key: KEY, fetch: early, signal: done.signal }), { name: 'AbortError' });
  assert.equal(early.calls.length, 0);

  const busy = stub(() => json(503, {}));
  const stop = new AbortController();
  const waits = [];
  const sleep = async (ms) => { waits.push(ms); stop.abort(); };
  await assert.rejects(listVoices({ key: KEY, fetch: busy, signal: stop.signal, sleep }), { name: 'AbortError' });
  assert.equal(busy.calls.length, 1, 'an abort during the retry wait makes no further call');

  const reading = new AbortController();
  const slowBody = stub((url, init) => ({
    ok: true, status: 200, headers: new Headers(),
    json: () => new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }); }),
  }));
  const r = speak({ text: 'Hi.', voiceId: 'voice0xxxxxxx', key: KEY, fetch: slowBody, signal: reading.signal });
  await new Promise((res) => setImmediate(res));
  reading.abort();
  await assert.rejects(r, (e) => e.name === 'AbortError' && !(e instanceof SoundError), 'an abort while the body is read');
  assert.equal(slowBody.calls.length, 1);
});

test('7b the default retry wait ends when the caller aborts (no 2 s wait, no further call)', async () => {
  const busy = stub(() => json(503, {}));
  const ctl = new AbortController();
  let settled = false;
  const p = listVoices({ key: KEY, fetch: busy, signal: ctl.signal }).then(() => { settled = 'resolved'; }, (e) => { settled = e.name; });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(busy.calls.length, 1);
  assert.equal(settled, false, 'waiting before the retry');
  ctl.abort();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(settled, 'AbortError', 'the wait ended with the abort');
  await p;
  assert.equal(busy.calls.length, 1);
});

test('8 a timeout: did not answer in time, 504, after one call (never retried)', async () => {
  const keep = setTimeout(() => {}, 1000);
  try {
    const hang = hangStub();
    await assert.rejects(speak({ text: 'Hi.', voiceId: 'voice0xxxxxxx', key: KEY, timeoutMs: 20, fetch: hang }), (e) => e instanceof SoundError && e.message === 'ElevenLabs did not answer in time' && e.status === 504);
    assert.equal(hang.calls.length, 1);
    const slowBody = stub((url, init) => ({
      ok: true, status: 200, headers: new Headers(),
      json: () => new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }); }),
    }));
    await assert.rejects(speak({ text: 'Hi.', voiceId: 'voice0xxxxxxx', key: KEY, timeoutMs: 20, fetch: slowBody }), (e) => e instanceof SoundError && e.message === 'ElevenLabs did not answer in time' && e.status === 504, 'the deadline covers the body');
    assert.equal(slowBody.calls.length, 1);

    // A caller's signal (a round always passes one) must not replace the deadline.
    const withSignal = hangStub();
    let settled = null;
    const p = speak({ text: 'Hi.', voiceId: 'voice0xxxxxxx', key: KEY, timeoutMs: 20, fetch: withSignal, signal: new AbortController().signal })
      .then(() => { settled = 'resolved'; }, (e) => { settled = e; });
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(settled instanceof SoundError && settled.message === 'ElevenLabs did not answer in time' && settled.status === 504, `the deadline ends the call when a signal is passed too (${settled?.message ?? settled})`);
    assert.equal(withSignal.calls.length, 1);
    await p;
  } finally { clearTimeout(keep); }
});

test('9 voiceSample: a listed voice\'s sample fetched without the key; an id never listed makes no call', async () => {
  await listVoices({ key: KEY, fetch: stub(() => json(200, voices(9))) });
  const sample = Buffer.from('ID3-sample-bytes');
  const s = stub(() => bytes(200, sample));
  const got = await voiceSample('voice0xxxxxxx', { fetch: s });
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, 'https://cdn.example/0.mp3');
  assert.equal(s.calls[0].headers['xi-api-key'], undefined);
  assert.ok(!JSON.stringify(s.calls[0]).includes(KEY));
  assert.equal(got.type, 'audio/mpeg');
  assert.ok(got.bytes.equals(sample));

  const none = stub(() => bytes(200, sample));
  assert.equal(await voiceSample('voice-never-listed', { fetch: none }), null);
  assert.equal(none.calls.length, 0);
  const failed = stub(() => bytes(404, Buffer.from('gone')));
  assert.equal(await voiceSample('voice0xxxxxxx', { fetch: failed }), null, 'a failed download is null');
});

test('9b a failed listVoices keeps the samples of the last list that worked', async () => {
  await listVoices({ key: KEY, fetch: stub(() => json(200, voices(9))) });
  await assert.rejects(listVoices({ key: KEY, fetch: stub(() => json(401, {})) }), (e) => e instanceof SoundError && e.status === 401);
  await assert.rejects(listVoices({ key: KEY, fetch: stub(() => bytes(200, Buffer.from('<html>'))) }), (e) => e instanceof SoundError && e.status === 502);
  const s = stub(() => bytes(200, Buffer.from('sample')));
  assert.notEqual(await voiceSample('voice2xxxxxxx', { fetch: s }), null);
  assert.equal(s.calls[0].url, 'https://cdn.example/2.mp3');
});

test('9c a later list adds to the samples: a voice listed since the server started keeps its sample (SPEC §5)', async () => {
  await listVoices({ key: KEY, fetch: stub(() => json(200, voices(9))) });
  const other = { voices: [{ voice_id: 'other0xxxxxxx', name: 'O', labels: { gender: 'female' }, preview_url: 'https://cdn.example/other.mp3' }], has_more: false };
  const listed = await listVoices({ key: 'another-key-0123456789', fetch: stub(() => json(200, other)) });
  assert.deepEqual(listed.map((v) => v.id), ['other0xxxxxxx']);
  assert.deepEqual(await listVoices({ key: KEY, fetch: stub(() => json(200, { voices: 'none' })) }), [], 'an answer with no voice list');
  for (const [id, url] of [['voice2xxxxxxx', 'https://cdn.example/2.mp3'], ['other0xxxxxxx', 'https://cdn.example/other.mp3']]) {
    const s = stub(() => bytes(200, Buffer.from('sample')));
    assert.notEqual(await voiceSample(id, { fetch: s }), null, id);
    assert.equal(s.calls[0].url, url, id);
  }
});

test('10 mock: six named voices, a silent WAV clip at 2.5 words a second, music of the asked length, real prices', async () => {
  const v = await listVoices({ mock: true });
  assert.deepEqual(v.map((x) => x.name), ['Ana', 'Ben', 'Cleo', 'Dan', 'Eva', 'Finn']);
  assert.deepEqual(v.map((x) => x.id), ['mock-voice-1', 'mock-voice-2', 'mock-voice-3', 'mock-voice-4', 'mock-voice-5', 'mock-voice-6']);
  assert.deepEqual([v[0].about, v[1].about, v[2].about], ['female · british · calm', 'male · american · warm', 'female · british · calm']);

  const said = await speak({ text: 'one two three four five', voiceId: v[0].id, mock: true });
  assert.equal(said.ext, 'wav');
  assert.ok(Math.abs(said.seconds - audioInfo(said.bytes).seconds) < 0.01);
  assert.ok(said.seconds > 2 && said.seconds < 2.5, `seconds ${said.seconds}`);
  assert.deepEqual(said.words.map((w) => w.w), ['one', 'two', 'three', 'four', 'five']);
  assert.deepEqual(Object.keys(said.words[0]), ['w', 't0', 't1']);
  assert.equal(said.costUsd, voiceUsd(23));
  assert.equal(said.chars, 23);

  const music = await compose({ prompt: 'Calm.', seconds: 42, mock: true });
  assert.equal(music.ext, 'wav');
  assert.ok(Math.abs(music.seconds - 42) < 0.01);
  assert.equal(music.costUsd, musicUsd(music.seconds));

  const sample = await voiceSample(v[0].id, { mock: true });
  assert.equal(sample.type, 'audio/wav');
  assert.equal(await voiceSample('voice0xxxxxxx', { mock: true }), null);
  assert.equal(audioInfo(Buffer.from('nope')), null);

  await withEnv({ WORCA_MOCK: '1' }, async () => {
    assert.equal((await listVoices()).length, 6, 'WORCA_MOCK with no fetch: mock, any key');
  });
});

test('11 soundState and testSound: the key fields, never the key; Test uses what is typed over what is stored', async () => {
  await withSandbox(async () => {
    assert.deepEqual(soundState(), { service: 'elevenlabs', configured: false, keySet: false, keySource: null, keyRef: null, keyMasked: null, keyMissing: false, available: true });

    await updateSound({ apiKey: KEY });
    const state = soundState();
    assert.equal(state.configured, true);
    assert.equal(state.keySet, true);
    assert.equal(state.keySource, 'stored');
    assert.equal(state.keyRef, null);
    assert.ok(state.keyMasked.endsWith('cdef'));
    assert.ok(!JSON.stringify(state).includes(KEY));

    const ok = () => stub(() => json(200, voices(3)));
    for (const typed of [{}, { apiKey: '' }, { apiKey: KEY }, { apiKey: state.keyMasked }]) {
      const s = ok();
      assert.deepEqual(await testSound(typed, s), { ok: true, voices: 2 }, JSON.stringify(typed));
      assert.equal(s.calls[0].headers['xi-api-key'], KEY);
    }
    const typedStub = ok();
    assert.deepEqual(await testSound({ apiKey: 'typed-0123456789' }, typedStub), { ok: true, voices: 2 });
    assert.equal(typedStub.calls[0].headers['xi-api-key'], 'typed-0123456789');

    const varStub = ok();
    assert.deepEqual(await testSound({ apiKey: '${HOME}' }, varStub), { ok: false, message: 'Save the row before testing a key kept in a variable' });
    assert.equal(varStub.calls.length, 0);
    assert.deepEqual(await testSound({}, stub(() => json(401, { detail: { code: 'invalid_api_key', message: 'bad ' + KEY } }))), { ok: false, message: 'ElevenLabs rejected the key' });

    await withEnv({ SOUND_TEST_KEY: 'env-key-0123456789abcdef' }, async () => {
      await updateSound({ apiKey: '${SOUND_TEST_KEY}' });
      const s = ok();
      assert.deepEqual(await testSound({ apiKey: '${SOUND_TEST_KEY}' }, s), { ok: true, voices: 2 });
      assert.equal(s.calls[0].headers['xi-api-key'], 'env-key-0123456789abcdef');
      const st = soundState();
      assert.deepEqual([st.keySource, st.keyRef, st.keyMasked, st.keyMissing, st.configured], ['env', '${SOUND_TEST_KEY}', null, false, true]);
    });
    await withEnv({ SOUND_TEST_KEY: undefined }, async () => {
      const st = soundState();
      assert.equal(st.keyMissing, true);
      assert.equal(st.configured, false);
      assert.deepEqual(await testSound({}, ok()), { ok: false, message: 'ElevenLabs is not set up' });
    });
  });
});

test('12 soundReady: a key that resolves, or mock; never under the broker', async () => {
  await withSandbox(async () => {
    await withEnv({ WORCA_MOCK: undefined, ORCH_MOCK: undefined, WORCA_BROKER_URL: undefined, SOUND_UNSET_VAR: undefined }, async () => {
      assert.equal(soundReady(), false);
      await updateSound({ apiKey: KEY });
      assert.equal(soundReady(), true);
      await updateSound({ apiKey: '${SOUND_UNSET_VAR}' });
      assert.equal(soundReady(), false);
      await updateSound({ apiKey: '' });
      process.env.WORCA_MOCK = '1';
      assert.equal(soundReady(), true, 'mock with no key');
      process.env.WORCA_BROKER_URL = 'http://127.0.0.1:9';
      assert.equal(soundReady(), false, 'never under the broker');
      assert.equal(soundState().available, false);
    });
  });
  assert.equal(process.env.WORCA_MOCK, undefined);
  assert.equal(process.env.WORCA_BROKER_URL, undefined);
});
