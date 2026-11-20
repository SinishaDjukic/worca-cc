// test/settings-speech.test.mjs
// providers.speech (docs/speech.md): defaults, validation, nested patch/clear,
// sanitising a hand-edited file, and — the invariant — speech never becomes a
// model-bridge upstream.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { speechConfig, updateSpeech, updateProvider, allProviders, settingsFile, readSettings } from '../src/core/settings.mjs';
import { UPSTREAM_PROVIDERS } from '../src/core/model-env.mjs';

async function withSandbox(fn) {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-speech-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try { return await fn(home); } finally {
    for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    await rm(home, { recursive: true, force: true });
  }
}

const DEFAULTS = {
  stt: { engine: 'browser', baseUrl: 'http://127.0.0.1:8080/v1', model: 'whisper-1', language: 'auto', pause: 0.7 },
  tts: { engine: 'browser', baseUrl: '', model: 'tts-1', voice: 'af_heart', speed: 1 },
};

test('speech: defaults; never an upstream provider', async () => {
  await withSandbox(async () => {
    assert.deepEqual(speechConfig(), DEFAULTS);
    assert.equal(UPSTREAM_PROVIDERS.includes('speech'), false);
    assert.deepEqual(Object.keys(allProviders()), ['copilot', 'openai', 'anthropic']);
    await assert.rejects(updateProvider('speech', {}), /unknown provider/);
  });
});

// The engine switch rides the same patch: the built-in browser engine, a server, and off (tts).
test('speech: nested patch incl. engine/pause, normalisation, ${VAR} key, clear back to default', async () => {
  await withSandbox(async () => {
    const c = await updateSpeech({
      stt: { baseUrl: 'http://127.0.0.1:9000/v1/', language: 'BG', apiKey: '${WHISPER_KEY}', engine: 'Server', pause: '2.5' },
      tts: { baseUrl: 'http://127.0.0.1:8880/v1', voice: 'af_heart', speed: '1.25', engine: 'off' },
    });
    assert.equal(c.stt.baseUrl, 'http://127.0.0.1:9000/v1');
    assert.equal(c.stt.language, 'bg');
    assert.equal(c.stt.apiKey, '${WHISPER_KEY}');
    assert.equal(c.tts.speed, 1.25);
    assert.equal(c.stt.engine, 'server');
    assert.equal(c.stt.pause, 2.5);
    assert.equal(c.tts.engine, 'off');
    const raw = JSON.parse(await readFile(settingsFile(), 'utf8'));
    assert.deepEqual(raw.providers.speech.tts, { baseUrl: 'http://127.0.0.1:8880/v1', voice: 'af_heart', speed: 1.25, engine: 'off' });
    await updateSpeech({
      stt: { baseUrl: '', language: null, apiKey: '', engine: '', pause: '' },
      tts: { baseUrl: '', voice: '', speed: null, engine: null },
    });
    assert.deepEqual(speechConfig(), DEFAULTS);
    assert.equal(readSettings().providers, undefined);
  });
});

test('speech: validation rejects bad input and leaves the file untouched', async () => {
  await withSandbox(async () => {
    await assert.rejects(updateSpeech({ asr: {} }), /unknown speech service/);
    await assert.rejects(updateSpeech({ stt: { voice: 'x' } }), /unknown speech field/);
    await assert.rejects(updateSpeech({ stt: { baseUrl: 'ftp://x' } }), /baseUrl must be an http/);
    await assert.rejects(updateSpeech({ stt: { language: 'bulgarian' } }), /language must be/);
    await assert.rejects(updateSpeech({ tts: { speed: 9 } }), /speed must be/);
    await assert.rejects(updateSpeech({ tts: { model: 'a b' } }), /model must be/);
    await assert.rejects(updateSpeech({ stt: { engine: 'off' } }), /engine must be "browser" or "server"/);
    await assert.rejects(updateSpeech({ tts: { engine: 'cloud' } }), /engine must be/);
    await assert.rejects(updateSpeech({ stt: { pause: 0.1 } }), /pause must be a number of seconds from 0.3 to 5/);
    await assert.rejects(updateSpeech({ stt: { pause: 'long' } }), /pause must be/);
    await assert.rejects(updateSpeech({ tts: { pause: 2 } }), /unknown speech field/);
    assert.deepEqual(readSettings(), {});
  });
});

test('speech: a hand-edited file is sanitised field by field; siblings survive provider patches', async () => {
  await withSandbox(async (home) => {
    await mkdir(join(home, '.worca-cc'), { recursive: true });
    await writeFile(settingsFile(), JSON.stringify({ providers: { speech: { stt: { baseUrl: 'nope', model: 'large-v3' }, tts: 'x' } } }));
    assert.deepEqual(speechConfig(), { stt: { ...DEFAULTS.stt, model: 'large-v3' }, tts: DEFAULTS.tts });
    await updateProvider('openai', { baseUrl: 'https://gw.example/v1' });
    assert.equal(readSettings().providers.speech.stt.model, 'large-v3');
  });
});
