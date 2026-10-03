// test/engine-catalog.test.mjs — the engine-aware catalog (cascading-settings-design.md §3.1a):
// engine on every row, Codex built-ins, globally unambiguous id shadowing, Claude-only hiding, and
// custom Codex models that refuse routing env. Sandboxes HOME (settings.json) and WORCA_HOME.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listModels, CODEX_BUILTIN_MODELS, PREDEFINED_MODELS, engineOfModel, catalogHasModel } from '../src/core/config.mjs';
import { addGlobalModel, updateGlobalModel, listGlobalModels, setHideBuiltinModels } from '../src/core/settings.mjs';
import { CODEX_EFFORTS } from '../src/core/model-env.mjs';
import { _resetForTests } from '../src/core/db.mjs';

const dirs = [];
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
let home;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-eng-cat-home-'));
  const whome = await mkdtemp(join(tmpdir(), 'worca-eng-cat-whome-'));
  dirs.push(home, whome);
  _resetForTests();
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = whome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  _resetForTests();
  for (const [k, v] of [['HOME', prevEnv.HOME], ['USERPROFILE', prevEnv.USERPROFILE], ['WORCA_HOME', prevEnv.WORCA_HOME], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prevEnv.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

test('every catalog row names its engine; the Codex built-ins follow the Claude ones', async () => {
  const cat = await listModels('');
  assert.ok(cat.every((m) => m.engine === 'claude' || m.engine === 'codex'), 'engine on every row');
  assert.deepEqual(cat.filter((m) => m.engine === 'claude').map((m) => m.id), PREDEFINED_MODELS.map((m) => m.id));
  const codex = cat.filter((m) => m.engine === 'codex');
  assert.deepEqual(codex.map((m) => m.id), CODEX_BUILTIN_MODELS.map((m) => m.id));
  assert.deepEqual(codex.find((m) => m.id === 'gpt-5.6-sol'), {
    id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', efforts: CODEX_EFFORTS, engine: 'codex', builtin: true, custom: false, hasEnv: false, routed: false,
  });
});

test('a Codex custom entry replaces the same-id Codex built-in', async () => {
  await addGlobalModel({ id: 'gpt-5.5', label: 'GPT-5.5 tuned', engine: 'codex', efforts: ['medium', 'high'] });
  const rows = (await listModels('')).filter((m) => m.id === 'gpt-5.5');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].custom, 'global');
  assert.equal(rows[0].engine, 'codex');
  assert.equal(rows[0].label, 'GPT-5.5 tuned');
  assert.deepEqual(rows[0].efforts, ['medium', 'high']);
});

test('a legacy Claude entry shadows a same-id Codex built-in globally (Review Focus 1 and 6)', async () => {
  // This shape predates engine-aware validation and is still a supported settings.json input.
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  await writeFile(join(home, '.worca-cc', 'settings.json'), JSON.stringify({
    models: [{ id: 'gpt-5.5', label: 'GPT-5.5 via OpenRouter', env: { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api' } }],
  }));
  const rows = (await listModels('')).filter((m) => m.id.toLowerCase() === 'gpt-5.5');
  assert.equal(rows.length, 1, 'one id cannot denote two engines in the effective catalog');
  assert.equal(rows[0].engine, 'claude');
  assert.equal(rows[0].custom, 'global');
  assert.equal(engineOfModel('gpt-5.5'), 'claude');
  assert.equal(catalogHasModel('gpt-5.5', { engine: 'claude' }), true);
  assert.equal(catalogHasModel('gpt-5.5', { engine: 'codex' }), false,
    'engine-filtered membership uses the same effective row as engineOfModel');
});

test('engineOfModel agrees with every effective catalog row', async () => {
  const rows = await listModels('');
  for (const row of rows) assert.equal(engineOfModel(row.id), row.engine, row.id);
});

test('"Hide built-in models" hides Claude built-ins only', async () => {
  await setHideBuiltinModels(true);
  const cat = await listModels('');
  assert.ok(cat.filter((m) => m.engine === 'claude' && m.custom === false).every((m) => m.hidden === true));
  assert.ok(cat.filter((m) => m.engine === 'codex').every((m) => m.hidden === undefined));
});

test('a Codex custom model takes Codex efforts and refuses env, upstream and a Claude id', async () => {
  const m = await addGlobalModel({ id: 'cx-tune', engine: 'codex', efforts: ['low', 'high'] });
  assert.deepEqual(m, { id: 'cx-tune', label: 'cx-tune', efforts: ['low', 'high'], engine: 'codex' });
  assert.equal(engineOfModel('cx-tune'), 'codex', 'a custom entry names its engine');
  assert.equal((await listModels('')).find((r) => r.id === 'cx-tune').engine, 'codex');
  await assert.rejects(() => addGlobalModel({ id: 'cx-2', engine: 'codex', efforts: ['max'] }), /unknown effort "max" — must be one of minimal \| low \| medium \| high/);
  await assert.rejects(() => addGlobalModel({ id: 'cx-3', engine: 'codex', env: { ANTHROPIC_BASE_URL: 'https://x' } }), /a codex model takes no env/);
  await assert.rejects(() => addGlobalModel({ id: 'cx-4', engine: 'codex', upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-x' } }), /a codex model takes no upstream/);
  await assert.rejects(() => addGlobalModel({ id: 'claude-opus-5-5', engine: 'codex' }), /is a Claude model id/);
  await assert.rejects(() => addGlobalModel({ id: 'gpt-5.5', label: 'Claude-side' }), /"gpt-5.5" is a Codex built-in/);
  await assert.rejects(() => addGlobalModel({ id: 'cx-5', engine: 'gemini' }), /engine must be one of claude \| codex/);
  await assert.rejects(() => updateGlobalModel('cx-tune', { engine: 'claude' }), /engine cannot change/);
  await assert.rejects(() => updateGlobalModel('cx-tune', { env: { X: '1' } }), /a codex model takes no env/);
  assert.deepEqual((await updateGlobalModel('cx-tune', { efforts: ['minimal'] })).efforts, ['minimal']);
});

test('a hand-edited Codex entry with env or upstream reads without them, loudly', async () => {
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  await writeFile(join(home, '.worca-cc', 'settings.json'), JSON.stringify({
    models: [{ id: 'cx-hand', engine: 'codex', efforts: ['minimal', 'max'], env: { ANTHROPIC_BASE_URL: 'https://x' }, upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-x' } }],
  }));
  const warned = [];
  const orig = console.warn;
  console.warn = (m) => warned.push(String(m));
  try {
    assert.deepEqual(listGlobalModels(), [{ id: 'cx-hand', label: 'cx-hand', efforts: ['minimal'], engine: 'codex' }]);
  } finally { console.warn = orig; }
  assert.ok(warned.some((w) => /cx-hand.*ANTHROPIC_BASE_URL.*a codex model takes no routing env/.test(w)), warned.join('\n'));
  assert.ok(warned.some((w) => /cx-hand.*dropping upstream/.test(w)));
});

test('a Claude entry is stored and read exactly as before', async () => {
  const m = await addGlobalModel({ id: 'glm-4.7', efforts: ['medium'] });
  assert.deepEqual(m, { id: 'glm-4.7', label: 'glm-4.7', efforts: ['medium'] });
});
