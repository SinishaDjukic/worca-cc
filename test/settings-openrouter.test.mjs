// test/settings-openrouter.test.mjs
// `providers.openrouter` (Models menu P2): OpenRouter's own row — key, concurrency cap and routing defaults —
// stored outside UPSTREAM_PROVIDERS. Defaults, the minimal stored shape, PATCH semantics, every refusal (and
// that a refused patch writes nothing), the node:test guard, and that the three upstream providers stay three.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  settingsFile, readSettings, openRouterConfig, updateOpenRouter, updateProvider, allProviders,
} from '../src/core/settings.mjs';

async function withSandbox(fn) {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-openrouter-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try { return await fn(home); } finally {
    for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    await rm(home, { recursive: true, force: true });
  }
}
const readRawText = () => readFile(settingsFile(), 'utf8');
const writeRaw = async (obj) => {
  await mkdir(dirname(settingsFile()), { recursive: true });
  await writeFile(settingsFile(), JSON.stringify(obj, null, 2) + '\n', 'utf8');
};
const DEFAULTS = Object.freeze({ apiKey: '', maxConcurrent: 8, order: [], sort: '', allowFallbacks: true });

test('openRouterConfig: the defaults, and a bad stored value reads as its default', () => withSandbox(async () => {
  assert.deepEqual(openRouterConfig(), DEFAULTS);
  await writeRaw({ providers: { openrouter: { apiKey: 5, maxConcurrent: 0, order: [1, 'x'], sort: 'cheapest', allowFallbacks: 'no' } } });
  assert.deepEqual(openRouterConfig(), DEFAULTS);
  await writeRaw({ providers: { openrouter: 'nope' } });
  assert.deepEqual(openRouterConfig(), DEFAULTS);
  await writeRaw({ providers: [] });
  assert.deepEqual(openRouterConfig(), DEFAULTS);
}));

test('updateOpenRouter: stores the minimal shape, numeric strings, and a one-key patch keeps the others', () => withSandbox(async () => {
  const want = { apiKey: '${OPENROUTER_KEY}', maxConcurrent: 3, order: ['anthropic', 'google'], sort: 'price', allowFallbacks: false };
  const got = await updateOpenRouter({ apiKey: '${OPENROUTER_KEY}', maxConcurrent: 3, order: ' anthropic, google ,', sort: 'price', allowFallbacks: false });
  assert.deepEqual(got, want);
  assert.deepEqual(readSettings().providers.openrouter, want);
  assert.deepEqual(openRouterConfig(), want);

  assert.equal((await updateOpenRouter({ maxConcurrent: '5' })).maxConcurrent, 5);
  assert.equal(readSettings().providers.openrouter.maxConcurrent, 5);

  const after = await updateOpenRouter({ sort: 'latency' });
  assert.deepEqual(after, { ...want, maxConcurrent: 5, sort: 'latency' });
  assert.deepEqual(readSettings().providers.openrouter, { ...want, maxConcurrent: 5, sort: 'latency' });

  // A value equal to its default is not stored; an array order is trimmed and blanks dropped.
  await updateOpenRouter({ maxConcurrent: 8, allowFallbacks: true, order: [' openai ', '', '  '] });
  assert.deepEqual(readSettings().providers.openrouter, { apiKey: '${OPENROUTER_KEY}', order: ['openai'], sort: 'latency' });
}));

test('updateOpenRouter: an all-default patch deletes the block, and an empty providers too; providers.openai survives', () => withSandbox(async () => {
  const reset = { apiKey: '', maxConcurrent: null, order: [], sort: '', allowFallbacks: true };
  await updateOpenRouter({ apiKey: 'sk-or-1', maxConcurrent: 4, order: ['a'], sort: 'throughput', allowFallbacks: false });
  assert.deepEqual(await updateOpenRouter(reset), DEFAULTS);
  assert.equal('providers' in readSettings(), false);

  await updateProvider('openai', { apiKey: 'sk-openai' });
  const openai = readSettings().providers.openai;
  await updateOpenRouter({ apiKey: 'sk-or-2', sort: 'price' });
  assert.deepEqual(readSettings().providers.openai, openai);
  await updateOpenRouter({ allowFallbacks: false });
  assert.deepEqual(readSettings().providers.openai, openai);
  await updateOpenRouter({ ...reset, apiKey: null });
  assert.deepEqual(readSettings().providers, { openai });
}));

test('updateOpenRouter: every refusal names the field, and a refused patch writes nothing', () => withSandbox(async () => {
  await updateOpenRouter({ maxConcurrent: 2 });
  const before = await readRawText();
  const refused = async (patch, re) => {
    await assert.rejects(updateOpenRouter(patch), re);
    assert.equal(await readRawText(), before, JSON.stringify(patch));
  };
  for (const n of [0, 65, 1.5]) await refused({ maxConcurrent: n }, /maxConcurrent must be an integer from 1 to 64/);
  await refused({ sort: 'cheapest' }, /sort must be one of price \| throughput \| latency, or empty/);
  await refused({ allowFallbacks: 'no' }, /allowFallbacks must be true or false/);
  await refused({ order: [1] }, /order must be a list of provider names/);
  await refused({ order: 7 }, /order must be a list of provider names/);
  await refused({ apiKey: '   ' }, /apiKey must be a non-empty string/);
  await refused({ apiKey: 42 }, /apiKey must be a non-empty string/);
  await refused({ baseUrl: 'https://openrouter.ai/api/v1' }, /unknown provider field "baseUrl" for openrouter/);
  await refused(null, /openrouter patch must be an object/);
  await refused([], /openrouter patch must be an object/);
  await refused({ maxConcurrent: 3, sort: 'cheapest' }, /sort must be one of/);
  await refused({ sort: 'price', maxConcurrent: 0 }, /from 1 to 64/);
  assert.equal(openRouterConfig().maxConcurrent, 2);
}));

test('without the test opt-in flag: the reader gives defaults and the writer refuses', () => withSandbox(async () => {
  await updateOpenRouter({ apiKey: 'sk-or-x', sort: 'latency' });
  delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
  try {
    assert.deepEqual(openRouterConfig(), DEFAULTS);
    await assert.rejects(updateOpenRouter({ sort: 'price' }), /node:test runner/);
  } finally {
    process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  }
  assert.equal(readSettings().providers.openrouter.sort, 'latency');
}));

test('openrouter is not an upstream provider', () => withSandbox(async () => {
  await assert.rejects(updateProvider('openrouter', { apiKey: 'x' }), /unknown provider "openrouter"/);
  await updateOpenRouter({ apiKey: 'sk-or-y' });
  assert.deepEqual(Object.keys(allProviders()), ['copilot', 'openai', 'anthropic']);
}));
