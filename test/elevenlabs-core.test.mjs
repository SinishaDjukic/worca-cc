// test/elevenlabs-core.test.mjs
// The ElevenLabs plumbing in src/core/elevenlabs.mjs: the promo scripts re-export the very same
// functions, an account voice becomes a candidate, a caller's AbortSignal reaches the fetch, and
// an HTTP failure's `detail` is redacted BEFORE it is cut. Offline: every fetch is a stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as core from '../src/core/elevenlabs.mjs';
import * as promo from '../scripts/promo-common.mjs';
import { rankVoices } from '../scripts/promo-voices.mjs';

// ElevenLabs' older 32-hex key shape: redactKey's `sk_` shape rule never masks it, so only the
// key argument can.
const K = '5f1c9e2ab7d04c3e8a6b1d9f0e2acdef';

const SHARED = [
  'ELEVEN_BASE', 'OUTPUT_FORMAT', 'TTS_MODEL', 'WORDS_PER_SEC', 'ElevenError', 'retryable', 'accountRefusal', 'redactKey',
  'elevenFetch', 'withRetry', 'fetchPublic', 'mp3Duration', 'round3', 'wordKey', 'wordsFromAlignment', 'estimateWords',
];

const answer = (status, json) => async () => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });

test('the promo scripts re-export the core module\'s own functions and constants', () => {
  assert.deepEqual(Object.keys(core).sort(), [...SHARED, 'voiceCandidate', 'rankVoices'].sort());
  for (const k of SHARED) {
    assert.notEqual(core[k], undefined, `core.${k} is exported`);
    assert.equal(promo[k], core[k], `promo-common's ${k} is core's`);
  }
  assert.equal(typeof core.rankVoices, 'function');
  assert.equal(rankVoices, core.rankVoices);
});

test('voiceCandidate: an account voice becomes a candidate', () => {
  assert.deepEqual(core.voiceCandidate({
    voice_id: 'v1', name: ' Ana ', labels: { gender: 'Female', accent: 'British', use_case: 'Narration', description: 'calm' },
    preview_url: 'https://x/p.mp3',
  }), {
    id: 'v1', name: 'Ana', gender: 'female', accent: 'british', description: 'calm', useCase: 'narration',
    previewUrl: 'https://x/p.mp3', source: 'account',
  });
});

test('elevenFetch: a caller\'s abort reaches the fetch and rejects as a network ElevenError', async () => {
  const seen = [];
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    seen.push(init);
    if (!init.signal) { reject(new Error('no signal')); return; }
    // A ref'd bound, so a fetch that never sees the caller's abort fails instead of draining the loop.
    const hung = setTimeout(() => reject(new Error('hung')), 3000);
    init.signal.addEventListener('abort', () => {
      clearTimeout(hung);
      reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
    }, { once: true });
  });
  const ctl = new AbortController();
  const pending = core.elevenFetch('/v1/text-to-speech/v1', { key: K, signal: ctl.signal, fetchImpl, base: 'https://el.test' });
  ctl.abort();
  await assert.rejects(pending, (e) => {
    assert.ok(e instanceof core.ElevenError);
    assert.equal(e.status, 0);
    assert.match(e.message, /network error \(AbortError\)$/);
    assert.ok(!e.message.includes(K));
    return true;
  });
  assert.equal(seen.length, 1);
  assert.ok(seen[0].signal instanceof AbortSignal, 'the fetch saw a signal');
  assert.equal(seen[0].signal.aborted, true);

  // With a caller's signal that never aborts, elevenFetch's own timer still ends the call.
  await assert.rejects(
    core.elevenFetch('/v2/voices', { key: K, signal: new AbortController().signal, timeoutMs: 30, fetchImpl, base: 'https://el.test' }),
    (e) => e instanceof core.ElevenError && e.status === 0 && /network error \(AbortError\)$/.test(e.message),
  );

  // timeoutMs: 0 turns off elevenFetch's own timer: the caller's signal alone, or no signal at all.
  const ok = [];
  const okImpl = async (url, init) => { ok.push(init); return new Response('{}', { status: 200 }); };
  const own = new AbortController();
  await core.elevenFetch('/v2/voices', { key: K, signal: own.signal, timeoutMs: 0, fetchImpl: okImpl, base: 'https://el.test' });
  assert.equal(ok[0].signal, own.signal);
  await core.elevenFetch('/v2/voices', { key: K, timeoutMs: 0, fetchImpl: okImpl, base: 'https://el.test' });
  assert.equal('signal' in ok[1], false);
});

test('elevenFetch: a 422 list detail is the code invalid_request and a redacted detail', async () => {
  await assert.rejects(
    core.elevenFetch('/v1/text-to-speech/v1', { key: K, method: 'POST', body: { text: 'x' }, fetchImpl: answer(422, { detail: [{ msg: `text too long ${K}` }] }), base: 'https://el.test' }),
    (e) => {
      assert.ok(e instanceof core.ElevenError);
      assert.equal(e.status, 422);
      assert.equal(e.code, 'invalid_request');
      assert.equal(e.detail, 'text too long [redacted]');
      assert.match(e.message, /HTTP 422 \(invalid_request\): text too long \[redacted\]$/);
      return true;
    },
  );
});

test('elevenFetch: the detail is redacted before it is cut to 200 characters', async () => {
  await assert.rejects(
    core.elevenFetch('/v1/music', { key: K, method: 'POST', body: { prompt: 'x' }, fetchImpl: answer(400, { detail: { code: 'x', message: 'y'.repeat(190) + K } }), base: 'https://el.test' }),
    (e) => {
      assert.equal(e.status, 400);
      assert.equal(e.code, 'x');
      assert.equal(e.detail, 'y'.repeat(190) + '[redacted]');
      assert.ok(!e.detail.includes(K.slice(0, 8)));
      assert.ok(!e.message.includes(K.slice(0, 8)));
      return true;
    },
  );
  // A long detail with no key in it is still cut to 200 characters, in `detail` and in the message.
  await assert.rejects(
    core.elevenFetch('/v1/music', { key: K, method: 'POST', body: { prompt: 'x' }, fetchImpl: answer(400, { detail: 'z'.repeat(300) }), base: 'https://el.test' }),
    (e) => {
      assert.equal(e.code, null);
      assert.equal(e.detail, 'z'.repeat(200));
      assert.match(e.message, /HTTP 400: z{200}$/);
      return true;
    },
  );
});
