// test/settings-images.test.mjs
// providers.images (Design pictures): the presets of SPEC §9, the defaults,
// validation, the price rule (D9), sanitising a hand-edited block, the origin
// rule (a save to another origin drops the stored key), the credential-broker
// refusal (D14), and — the invariant — images never becomes a model-bridge upstream.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imagesConfig, updateImages, IMAGE_SERVICES, IMAGE_SHAPES, updateProvider, updateSpeech, allProviders, settingsFile, readSettings } from '../src/core/settings.mjs';
import { IMAGE_SIZE, IMAGE_ASPECT, IMAGES_MAX_PROMPT, pictureSeconds } from '../src/shared/image-services.mjs';
import { originOf } from '../src/shared/image-services.mjs';
import { UPSTREAM_PROVIDERS } from '../src/core/model-env.mjs';   // settings.mjs does not export it
import { patchImages } from '../src/core/bridge/provider-ops.mjs';
import { resetBrokerClient } from '../src/core/broker-client.mjs';
import { findLocalCredentials } from '../src/core/broker-guard.mjs';

async function withSandbox(fn) {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-images-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try { return await fn(home); } finally {
    for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    await rm(home, { recursive: true, force: true });
  }
}

const DEFAULTS = { service: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-2.6-flare', apiKey: '', price: null };
test('images: the presets of SPEC §9, the defaults, never an upstream', async () => {
  await withSandbox(async () => {
    assert.deepEqual(Object.keys(IMAGE_SERVICES), ['openai', 'xai', 'openrouter', 'other']);
    assert.deepEqual(IMAGE_SERVICES.openai, { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', path: '/images/generations', model: 'gpt-image-2.6-flare', price: 0.04, sizeMode: 'size', extra: { quality: 'medium' }, responseFormat: null });
    assert.deepEqual(IMAGE_SERVICES.xai, { id: 'xai', label: 'xAI', baseUrl: 'https://api.x.ai/v1', path: '/images/generations', model: 'grok-imagine-image-2.0', price: 0.04, sizeMode: 'aspect', extra: {}, responseFormat: 'b64_json' });
    assert.deepEqual(IMAGE_SERVICES.openrouter, { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', path: '/images', model: '', price: 0.05, sizeMode: 'size', extra: {}, responseFormat: null });
    assert.deepEqual(IMAGE_SERVICES.other, { id: 'other', label: 'Other (OpenAI-compatible)', baseUrl: '', path: '/images/generations', model: '', price: null, sizeMode: 'size', extra: {}, responseFormat: null });
    assert.deepEqual([0, 499, 1500, 11_200].map(pictureSeconds), [1, 1, 2, 11]);
    assert.equal(IMAGES_MAX_PROMPT, 4000);
    assert.deepEqual(IMAGE_SHAPES, ['wide', 'tall', 'square']);
    assert.deepEqual([IMAGE_SIZE, IMAGE_ASPECT], [{ wide: '1536x1024', tall: '1024x1536', square: '1024x1024' }, { wide: '3:2', tall: '2:3', square: '1:1' }]);
    assert.deepEqual(['', 'nope', 'https://api.openai.com/v1/', 'http://127.0.0.1:7860/v1'].map(originOf), ['', '', 'https://api.openai.com', 'http://127.0.0.1:7860']);
    assert.deepEqual(imagesConfig(), DEFAULTS);
    assert.equal(UPSTREAM_PROVIDERS.includes('images'), false);
    assert.deepEqual(Object.keys(allProviders()), ['copilot', 'openai', 'anthropic']);
    await assert.rejects(updateProvider('images', {}), /unknown provider/);
  });
});
test('images: Save is refused without a price; 0 is a price; a clear removes a field; all cleared removes the block', async () => {
  await withSandbox(async () => {
    await assert.rejects(updateImages({ service: 'xai', apiKey: 'xai-key-12345678' }), /^Error: Enter a price; 0 for a free server$/);
    assert.deepEqual(readSettings(), {});
    assert.deepEqual(await updateImages({ service: 'XAI ', apiKey: '${XAI_KEY}', price: '0.04' }),
      { service: 'xai', baseUrl: 'https://api.x.ai/v1', model: 'grok-imagine-image-2.0', apiKey: '${XAI_KEY}', price: 0.04 });
    for (const price of ['', null, -1, 'abc', Infinity]) await assert.rejects(updateImages({ price }), /Enter a price; 0 for a free server/, String(price));
    await assert.rejects(updateImages({ price: ' ' }), /Enter a price/, 'a blank price is no price, never Number(" ") === 0');
    assert.equal((await updateImages({ service: 'other', baseUrl: 'http://127.0.0.1:7860/v1/', model: 'sd-xl', price: 0 })).price, 0);
    assert.equal(readSettings().providers.images.baseUrl, 'http://127.0.0.1:7860/v1');
    await updateImages({ service: '', baseUrl: '', model: '', apiKey: '', price: '' });
    assert.deepEqual(imagesConfig(), DEFAULTS);
    assert.equal(readSettings().providers, undefined);
  });
});
test('images: validation names the field and leaves the file untouched', async () => {
  await withSandbox(async () => {
    await assert.rejects(updateImages('x'), /images patch must be an object/);
    await assert.rejects(updateImages({ size: '1024x1024', price: 1 }), /unknown images field "size"/);
    await assert.rejects(updateImages({ service: 'google', price: 1 }), /unknown image service "google" \(openai, xai, openrouter or other\)/);
    await assert.rejects(updateImages({ service: 'constructor', price: 1 }), /unknown image service "constructor"/);
    await assert.rejects(updateImages({ baseUrl: 'ftp://x', price: 1 }), /baseUrl must be an http/);
    await assert.rejects(updateImages({ model: 'a b', price: 1 }), /model must be an id/);
    await assert.rejects(updateImages({ apiKey: 42, price: 1 }), /apiKey must be a non-empty string/);
    await assert.rejects(patchImages('x'), /images patch must be an object/);
    assert.deepEqual(readSettings(), {});
  });
});
test('images: a hand-edited block is sanitised field by field; siblings survive each other', async () => {
  await withSandbox(async (home) => {
    await mkdir(join(home, '.worca-cc'), { recursive: true });
    await writeFile(settingsFile(), JSON.stringify({ providers: { images: { service: 'google', baseUrl: 'nope', model: 'my-model', price: -2, apiKey: 7 } } }));
    assert.deepEqual(imagesConfig(), { ...DEFAULTS, model: 'my-model' });
    await updateProvider('openai', { baseUrl: 'https://gw.example/v1' });
    await updateSpeech({ stt: { language: 'bg' } });
    assert.equal(readSettings().providers.images.model, 'my-model');
    await updateImages({ service: 'openai', baseUrl: '', price: 0.04 });
    assert.equal(readSettings().providers.speech.stt.language, 'bg');
  });
});
test('with the credential broker on, an images key is refused as a Speech key is; the rest saves', async () => {
  await withSandbox(async () => {
    const prev = process.env.WORCA_BROKER_URL;
    process.env.WORCA_BROKER_URL = 'http://127.0.0.1:9'; resetBrokerClient();
    try {
      for (const apiKey of ['sk-img-12345678', '${IMG_KEY}']) await assert.rejects(patchImages({ apiKey, price: 0.04 }), /can't store an image service key/);
      assert.equal((await patchImages({ service: 'openai', price: 0.04, apiKey: '••••••5678' })).price, 0.04, 'a masked echo is keep, not a key');
    } finally { if (prev === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = prev; resetBrokerClient(); }
  });
});
test('D14 fact: the boot guard names a left-over images key; a Speech key two levels down it does not', () => {
  assert.deepEqual(findLocalCredentials({ providers: { images: { apiKey: 'sk-img' }, speech: { stt: { apiKey: 'sk-stt' } } } }), ['providers.images.apiKey']);
});
test('images: a save that moves the address to another origin drops the stored key', async () => {
  await withSandbox(async () => {
    await updateImages({ service: 'openai', apiKey: 'sk-a-12345678', price: 0.04 });
    await updateImages({ baseUrl: 'https://api.openai.com/v1/' });
    assert.equal(imagesConfig().apiKey, 'sk-a-12345678', 'same origin (a trailing /) keeps the key');
    await updateImages({ baseUrl: 'https://gw.example/v1' });
    assert.equal(imagesConfig().apiKey, '', 'another origin drops it');
    await updateImages({ apiKey: 'sk-a-12345678' });
    assert.equal(imagesConfig().apiKey, 'sk-a-12345678');
    await updateImages({ service: 'xai', baseUrl: '' });
    assert.equal(imagesConfig().apiKey, '', "a switch of service to the preset's other origin drops it");
    await updateImages({ service: 'openai', baseUrl: '', apiKey: 'sk-b-12345678' });
    assert.equal(imagesConfig().apiKey, 'sk-b-12345678', 'a key in the same patch is kept');
    assert.deepEqual(await updateImages({ service: 'other' }), { service: 'other', baseUrl: '', model: '', apiKey: '', price: 0.04 });
    await assert.doesNotReject(updateImages({ baseUrl: 'http://127.0.0.1:7860/v1', model: 'sd' }));
  });
});
test('images: the test-runner guard answers the defaults without the home opt-in', async () => {
  await withSandbox(async () => {
    await updateImages({ service: 'xai', apiKey: 'xai-key-12345678', price: 0.04 });
    const prev = process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
    delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
    try {
      assert.deepEqual(imagesConfig(), DEFAULTS);
    } finally { if (prev === undefined) delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK; else process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = prev; }
  });
});
