// test/models-menu-upgrade.test.mjs — a settings file written before the Models menu (Catalogue, Jobs,
// Providers) reads the same through the new page's endpoints: the hidden built-ins, the user model and
// every pick that uses it, the OpenAI-compatible row's key now lent to the OpenRouter row, the run engine.
// Opening the page writes nothing: the file's bytes after the three reads equal those written. The bridge
// keeps the model's address, key and routing; only its queue and that queue's cap moved (P2, by design).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { settingsFile } from '../src/core/settings.mjs';
import { upstreamSettings } from '../src/core/bridge/registry.mjs';

const OLD = { hideBuiltinModels: true, hideBuiltinModelsChosen: true, runEngine: 'codex',
  providers: { openai: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-old-7777', maxConcurrent: 6 } },
  models: [{ id: 'openrouter-x-ai-grok-4-7', label: 'Grok 4.7 (OpenRouter)', upstream: { provider: 'openai', api: 'openai-chat', model: 'x-ai/grok-4.7', openrouter: { provider: { sort: 'price' } } } }],
  modelRoles: { claude: { everyday: { model: 'openrouter-x-ai-grok-4-7' } } }, stepModels: { codex: { implementer: { model: 'gpt-6.1-sol', effort: 'high' } } }, titleModel: 'claude-haiku-4-5' };

let srv, base, homeDir, worcaHomeDir, written;
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};
const get = async (path) => {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-mmupgrade-home-'));
  worcaHomeDir = await mkdtemp(join(tmpdir(), 'worca-cc-mmupgrade-whome-'));
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir;
  process.env.WORCA_HOME = worcaHomeDir;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1'; // the readers return defaults under node:test without it
  _resetForTests();
  // The old file is on disk BEFORE the server module loads, as on an upgrade.
  mkdirSync(dirname(settingsFile()), { recursive: true });
  written = JSON.stringify(OLD, null, 2);
  writeFileSync(settingsFile(), written);
  const { app } = await import('../ui/server.mjs'); // imported => does not bind a port
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await Promise.all([homeDir, worcaHomeDir].map((d) => rm(d, { recursive: true, force: true })));
});

test('an old settings file reads the same through the new page\'s endpoints, and reading writes nothing', async () => {
  const [models, providers, settings] = await Promise.all([get('/api/models'), get('/api/providers'), get('/api/settings')]);
  assert.deepEqual([models.status, providers.status, settings.status], [200, 200, 200]);

  // Catalogue: the old "hide the built-in models" switch is the Claude engine's, the others stay shown.
  assert.deepEqual(models.body.hiddenBuiltins, { claude: true, codex: false, copilot: false });
  const grok = models.body.models[0];
  assert.deepEqual([models.body.models.length, grok.id, grok.needsSignIn, grok.testable],
    [1, 'openrouter-x-ai-grok-4-7', false, true], 'the user model, signed in through the lent key, testable');
  // Used by: every old pick of a model, a catalogue entry or not.
  const uses = (id) => models.body.uses[id].map((u) => [u.kind, u.engine, u.key]);
  assert.deepEqual(uses('openrouter-x-ai-grok-4-7'), [['role', 'claude', 'everyday']]);
  assert.deepEqual(uses('gpt-6.1-sol'), [['step', 'codex', 'implementer']]);
  assert.deepEqual(uses('claude-haiku-4-5'), [['helper', 'claude', 'title']]);

  // Providers: no OpenRouter block yet, so the OpenAI-compatible row lends its key (L5) under the default cap.
  const or = providers.body.openrouter;
  assert.deepEqual([or.keySet, or.legacyKey, or.keyMasked, or.maxConcurrent], [true, true, '••••••7777', 8]);
  assert.equal(providers.body.openai.maxConcurrent, 6, 'the OpenAI-compatible row keeps its own cap');

  assert.equal(settings.body.runEngine, 'codex');
  assert.equal(readFileSync(settingsFile(), 'utf8'), written, 'opening the tabs wrote nothing');
});

test('an old settings file: the bridge keeps address, key and routing; only the queue and its cap moved (P2, by design)', () => {
  const u = upstreamSettings(OLD.models[0].upstream);
  assert.deepEqual([u.baseUrl, u.apiKey, u.openrouter, u.queue, u.maxConcurrent],
    ['https://openrouter.ai/api/v1', 'sk-or-old-7777', { provider: { sort: 'price' } }, 'openrouter', 8]);
});
