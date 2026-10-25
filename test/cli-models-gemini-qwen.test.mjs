// test/cli-models-gemini-qwen.test.mjs
// `worca models import gemini|qwen` (docs/models.md › Gemini and Qwen models): the openai provider at Google's or
// Alibaba's endpoint, with a key of its own (default ${GEMINI_API_KEY} / ${DASHSCOPE_API_KEY}) stored on each entry.
// With OpenRouter on the provider card, its key never reaches either host. Sandboxes HOME (settings.json) + WORCA_HOME.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { cmdModels } from '../src/cli/models.mjs';
import { listGlobalModels, updateProvider } from '../src/core/settings.mjs';

let homeDir, worcaHomeDir;
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK, GEMINI_API_KEY: process.env.GEMINI_API_KEY, DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY };
const realFetch = globalThis.fetch;
const calls = [];
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-gqcli-home-'));
  worcaHomeDir = await mkdtemp(join(tmpdir(), 'worca-cc-gqcli-whome-'));
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_HOME = worcaHomeDir;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.GEMINI_API_KEY = 'AIza-gemini-secret';
  process.env.DASHSCOPE_API_KEY = 'sk-dashscope-secret';
  _resetForTests();
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const h = init.headers || {};
    calls.push({ url: u, auth: h.authorization || h['x-goog-api-key'] || null });
    if (u.startsWith('https://generativelanguage.googleapis.com/v1beta/models?')) {
      return json({ models: [{ name: 'models/gemini-3-flash', displayName: 'Gemini 3 Flash', inputTokenLimit: 1048576, outputTokenLimit: 65536, thinking: true, supportedGenerationMethods: ['generateContent'] }] });
    }
    if (u === 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models') return json({ data: [{ id: 'qwen3-max' }] });
    return new Response('not found', { status: 404 });
  };
});
after(async () => {
  globalThis.fetch = realFetch;
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(homeDir, { recursive: true, force: true });
  await rm(worcaHomeDir, { recursive: true, force: true });
});

const io = () => {
  const lines = [];
  return { lines, out: (s) => lines.push(s), c: (_n, s) => s, fail: (m) => { throw new Error(m); } };
};

test('import gemini / qwen: their own keys on the entries; the OpenRouter key stays home', async () => {
  await updateProvider('openai', { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-provider-secret' });

  const a = io();
  assert.equal(await cmdModels(['import', 'gemini'], a), 0);
  assert.match(a.lines.join('\n'), /Google Gemini at https:\/\/generativelanguage\.googleapis\.com\/v1beta\/openai/);
  assert.match(a.lines.join('\n'), /gemini-3-flash\s+1049k/);

  assert.equal(await cmdModels(['import', 'gemini', '--pick', 'gemini-3-flash', '--yes'], io()), 0);
  assert.equal(await cmdModels(['import', 'qwen', '--all', '--yes'], io()), 0);
  const by = Object.fromEntries(listGlobalModels().map((m) => [m.id, m]));
  assert.equal(by['google-gemini-3-flash'].upstream.apiKey, '${GEMINI_API_KEY}');
  assert.equal(by['google-gemini-3-flash'].upstream.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(by['dashscope-qwen3-max'].upstream.apiKey, '${DASHSCOPE_API_KEY}');

  assert.ok(calls.length > 0);
  for (const c of calls) {
    assert.notEqual(c.auth, 'Bearer sk-or-provider-secret', `the OpenRouter key went to ${c.url}`);
    if (c.url.includes('googleapis.com')) assert.equal(c.auth, 'AIza-gemini-secret');
    if (c.url.includes('aliyuncs.com')) assert.equal(c.auth, 'Bearer sk-dashscope-secret');
  }
});
