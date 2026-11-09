// test/ui-settings-ask-engine.test.mjs — the Ask card's engine choice and one model picker per engine (D17).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { renderAskEngineSection, readAskEngineSection, askPatchToSettingsBody } from '../ui/public/engine-settings-view.mjs';
import { setEngineLocks } from '../ui/public/engine-locks.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

const trackDom = useDomRelease(afterEach);
const CATALOG = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', engine: 'claude', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-5.5', label: 'GPT-5.5', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'] },
];

test('renderAskEngineSection: the engine row and one model row per engine, each listing its engine only', () => {
  const dom = trackDom(new JSDOM('<div id="h"></div>'));
  const host = dom.window.document.getElementById('h');
  renderAskEngineSection(host, { catalog: CATALOG, askEngine: 'codex', askModels: { codex: { model: 'gpt-5.5', effort: 'low' } },
    defaults: { claude: { model: 'claude-opus-5-5', effort: 'high' }, codex: { model: 'gpt-5.5', effort: 'medium' } } });
  assert.deepEqual([...host.querySelectorAll('.inherit-field')].map((f) => f.dataset.setting), ['askEngine', 'models.claude.ask', 'models.codex.ask']);
  assert.equal(host.querySelector('[data-setting="askEngine"] select').value, 'codex');
  const opts = (id) => [...host.querySelectorAll(`[data-setting="${id}"] .inherit-model option`)].map((o) => o.value).filter(Boolean);
  assert.deepEqual(opts('models.claude.ask'), ['claude-opus-5-5']);
  assert.deepEqual(opts('models.codex.ask'), ['gpt-5.5']);
  // Value first, and the Model names the model only: the Effort beside it says its own inherited value.
  assert.equal(host.querySelector('[data-setting="models.claude.ask"] .inherit-model option').textContent, 'Opus 5.5 (default)');
  assert.equal(host.querySelector('[data-setting="models.claude.ask"] .inherit-effort option').textContent, 'high (default)');
});

test('renderAskEngineSection: with no Codex model offered, Codex is marked unavailable and gets no empty model row', () => {
  const dom = trackDom(new JSDOM('<div id="h"></div>'));
  const host = dom.window.document.getElementById('h');
  renderAskEngineSection(host, { catalog: CATALOG.filter((m) => m.engine === 'claude'), askEngine: 'codex', defaults: { claude: { model: 'claude-opus-5-5', effort: 'high' } } });
  assert.deepEqual([...host.querySelectorAll('.inherit-field')].map((f) => f.dataset.setting), ['askEngine', 'models.claude.ask']);
  assert.equal(host.querySelector('[data-setting="askEngine"] select option[value="codex"]').textContent, 'Codex (unavailable)');
  assert.match(host.querySelector('[data-setting="askEngine"]').textContent, /New chats start on Claude\./);
});

function askHint(locked, catalog = CATALOG.filter((m) => m.engine === 'claude')) {
  setEngineLocks(locked.map((name) => ({ name, broker: true, reason: 'broker' })));
  const dom = trackDom(new JSDOM('<div id="h"></div>'));
  const host = dom.window.document.getElementById('h');
  try { renderAskEngineSection(host, { catalog, defaults: {} }); } finally { setEngineLocks([]); }
  return host.querySelector('[data-setting="askEngine"] .hint').textContent;
}

test('renderAskEngineSection: broker-locked engines share one sentence; "start on Claude" is said once', () => {
  const text = askHint(['codex', 'copilot', 'gemini', 'goose', 'opencode', 'qwen']);
  assert.match(text, /Chat on Codex, Copilot, Gemini CLI, Goose, OpenCode and Qwen Code is off while the credential broker is on\./);
  assert.equal((text.match(/Chat on /g) || []).length, 1);
  assert.equal((text.match(/start on Claude/g) || []).length, 1);
  assert.ok(text.endsWith('New chats start on Claude.'));
});

test('renderAskEngineSection: a mix of reasons gives one sentence per reason; one engine reads naturally', () => {
  const mixed = askHint(['codex', 'copilot']);
  assert.match(mixed, /Chat on Codex and Copilot is off while the credential broker is on\./);
  assert.match(mixed, /Chat on Gemini CLI, Goose, OpenCode and Qwen Code needs a model of their own/);
  assert.equal((mixed.match(/start on Claude/g) || []).length, 1);
  const all = CATALOG.filter((m) => m.engine === 'claude').concat(['copilot', 'gemini', 'goose', 'opencode', 'qwen'].map((engine) => ({ id: `${engine}-m`, label: engine, engine })));
  const one = askHint(['codex'], all);
  assert.match(one, /Chat on Codex is off while the credential broker is on\. New chats start on Claude\.$/);
});

test('renderAskEngineSection: engines unavailable on this version share one sentence', () => {
  const rest = ['gemini', 'goose', 'opencode', 'qwen'].map((engine) => ({ id: `${engine}-m`, label: engine, engine }));
  const catalog = CATALOG.filter((m) => m.engine === 'claude').concat(rest);
  const two = askHint([], catalog);
  assert.match(two, /Chat on Codex and Copilot is unavailable on these engine versions\. New chats start on Claude\.$/);
  const one = askHint([], catalog.concat([{ id: 'copilot-m', label: 'copilot', engine: 'copilot' }]));
  assert.match(one, /Chat on Codex is unavailable on this codex version\. New chats start on Claude\.$/);
});

test('askPatchToSettingsBody maps the field ids onto the settings keys', () => {
  assert.deepEqual(askPatchToSettingsBody({ askEngine: 'codex', 'models.codex.ask': { model: 'gpt-5.5' }, 'models.claude.ask': null }),
    { askEngine: 'codex', askModels: { codex: { model: 'gpt-5.5' }, claude: null } });
  assert.deepEqual(readAskEngineSection(trackDom(new JSDOM('<div></div>')).window.document.body), {});
});

test('index.html carries the card; app.js paints and saves it', () => {
  const html = readIndexHtml();
  assert.match(html, /id="ask-engine-root"/);
  assert.match(html, /id="askEngineSave"/);
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  assert.match(app, /renderAskEngineSection\(/);
  assert.match(app, /askPatchToSettingsBody\(readAskEngineSection\(/);
});
