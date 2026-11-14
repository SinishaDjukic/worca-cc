// test/settings-sound.test.mjs
// providers.sound (Design sound, ElevenLabs): the default, saving and clearing the key,
// validation (the 512-character cap; a refused patch writes nothing), siblings surviving each
// other, saved at the same moment too, never a model-bridge provider, the boot guard naming a
// left-over key (D19), and the credential-broker refusal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { soundConfig, updateSound, updateProvider, updateSpeech, updateImages, readSettings, settingsFile } from '../src/core/settings.mjs';
import { patchSound } from '../src/core/bridge/provider-ops.mjs';
import { resetBrokerClient } from '../src/core/broker-client.mjs';
import { findLocalCredentials } from '../src/core/broker-guard.mjs';

async function withSandbox(fn) {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-sound-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try { return await fn(home); } finally {
    for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    await rm(home, { recursive: true, force: true });
  }
}

test('sound: the default, a saved key trimmed, a ${VAR} kept as typed; a clear removes the block and an empty providers', async () => {
  await withSandbox(async () => {
    assert.deepEqual(soundConfig(), { apiKey: '' });
    assert.deepEqual(await updateSound({ apiKey: ' sk_abc_0123456789 ' }), { apiKey: 'sk_abc_0123456789' });
    assert.equal(JSON.parse(await readFile(settingsFile(), 'utf8')).providers.sound.apiKey, 'sk_abc_0123456789');
    const prev = process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
    delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
    try {
      assert.deepEqual(soundConfig(), { apiKey: '' }, 'under node:test without the home opt-in, only the default');
    } finally { process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = prev; }
    assert.deepEqual(await updateSound({ apiKey: '${ELEVENLABS_API_KEY}' }), { apiKey: '${ELEVENLABS_API_KEY}' });
    assert.equal(readSettings().providers.sound.apiKey, '${ELEVENLABS_API_KEY}');
    assert.deepEqual(await updateSound({ apiKey: '' }), { apiKey: '' });
    assert.equal(readSettings().providers, undefined);
  });
});

test('sound: validation names the field and leaves the file untouched; siblings survive; never a model-bridge provider', async () => {
  await withSandbox(async () => {
    await assert.rejects(updateSound('x'), /^Error: sound patch must be an object$/);
    await assert.rejects(patchSound('x'), /^Error: sound patch must be an object$/);
    await assert.rejects(updateSound({ voice: 'v' }), /^Error: unknown sound field "voice"$/);
    await assert.rejects(updateSound({ apiKey: 42 }), /^Error: apiKey must be a non-empty string$/);
    await assert.rejects(updateSound({ apiKey: '   ' }), /^Error: apiKey must be a non-empty string$/);
    await assert.rejects(updateSound({ apiKey: 'x'.repeat(513) }), /^Error: apiKey must be at most 512 characters$/);
    await assert.rejects(updateSound({ apiKey: 'sk_abc_0123456789', voice: 'v' }), /^Error: unknown sound field "voice"$/, 'a mixed patch is refused whole');
    assert.deepEqual(readSettings(), {});
    assert.equal((await updateSound({ apiKey: ` ${'x'.repeat(512)} ` })).apiKey.length, 512, 'the cap counts the trimmed key');
    await updateSpeech({ stt: { language: 'bg' } });
    await updateSound({ apiKey: 'sk_abc_0123456789' });
    await assert.rejects(updateSound({ apiKey: 42 }), /^Error: apiKey must be a non-empty string$/);
    assert.equal(readSettings().providers.sound.apiKey, 'sk_abc_0123456789', 'a refused patch leaves the stored key');
    assert.equal(readSettings().providers.speech.stt.language, 'bg');
    await updateSound({ apiKey: null });
    assert.equal(readSettings().providers.sound, undefined);
    assert.equal(readSettings().providers.speech.stt.language, 'bg', 'clearing sound keeps providers.speech');
    await assert.rejects(updateProvider('sound', {}), /unknown provider "sound"/);
  });
});

test('sound: saved at the same moment as images and speech (two tabs, or the chat), every block is kept', async () => {
  await withSandbox(async () => {
    await Promise.all([
      updateSound({ apiKey: 'sk_abc_0123456789' }),
      updateSpeech({ stt: { language: 'bg' } }),
      updateImages({ service: 'openai', apiKey: 'sk-a-12345678', price: 0.04 }),
    ]);
    let p = readSettings().providers;
    assert.deepEqual([p.sound?.apiKey, p.speech?.stt?.language, p.images?.price], ['sk_abc_0123456789', 'bg', 0.04]);
    await Promise.all([
      updateImages({ price: 0.05 }),
      updateSpeech({ stt: { language: 'en' } }),
      updateSound({ apiKey: 'sk_def_0123456789' }),
    ]);
    p = readSettings().providers;
    assert.deepEqual([p.sound?.apiKey, p.speech?.stt?.language, p.images?.price], ['sk_def_0123456789', 'en', 0.05]);
  });
});

test('sound: the boot guard names a left-over key; with the credential broker on, a key is refused and a clear or a masked echo saves', async () => {
  await withSandbox(async () => {
    await updateSound({ apiKey: 'sk_abc_0123456789' });
    assert.deepEqual(findLocalCredentials({ providers: readSettings().providers }), ['providers.sound.apiKey']);
    const prev = process.env.WORCA_BROKER_URL;
    process.env.WORCA_BROKER_URL = 'http://127.0.0.1:9'; resetBrokerClient();
    try {
      await assert.rejects(patchSound({ apiKey: 'sk_other_0123456789' }), /worca can't store a sound key/);
      assert.equal(readSettings().providers.sound.apiKey, 'sk_abc_0123456789');
      assert.deepEqual(await patchSound({ apiKey: '' }), { apiKey: '' });
      assert.deepEqual(await patchSound({ apiKey: '••••••6789' }), { apiKey: '' }, 'a masked echo is keep, not a key');
    } finally { if (prev === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = prev; resetBrokerClient(); }
  });
});
