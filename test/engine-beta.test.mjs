// test/engine-beta.test.mjs — an engine still in beta (src/shared/engine-switch.mjs BETA_ENGINES) is marked
// wherever an engine is picked: "(beta)" where only text fits, a Beta badge beside its name elsewhere.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { BETA_ENGINES, isBetaEngine, engineChoiceLabel, ENGINE_NAMES } from '../src/shared/engine-switch.mjs';
import { renderEngineSection, renderAskEngineSection } from '../ui/public/engine-settings-view.mjs';

const trackDom = useDomRelease(afterEach);
const CATALOG = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', engine: 'claude', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-5.5', label: 'GPT-5.5', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'] },
];

test('every engine but Claude is in beta', () => {
  assert.deepEqual(BETA_ENGINES, ['codex', 'copilot', 'cursor']);
  for (const e of BETA_ENGINES) assert.ok(ENGINE_NAMES.includes(e), `${e} is a known engine`);
  assert.equal(engineChoiceLabel('cursor'), 'Cursor (beta)');
  assert.equal(isBetaEngine('codex'), true);
  assert.equal(isBetaEngine('claude'), false);
  assert.equal(isBetaEngine(null), false);
  assert.equal(engineChoiceLabel('codex'), 'Codex (beta)');
  assert.equal(engineChoiceLabel('claude'), 'Claude');
});

test('Settings marks Codex as beta: the engine options and the Codex card heading', () => {
  const dom = trackDom(new JSDOM('<div id="h"></div><div id="a"></div>'));
  const doc = dom.window.document;
  renderEngineSection(doc.getElementById('h'), { level: 'user', catalog: CATALOG, roles: [], fields: {} });
  const optionText = (root, id) => root.querySelector(`[data-setting="${id}"] select option[value="codex"]`).textContent;
  assert.equal(optionText(doc.getElementById('h'), 'run.engine'), 'Codex (beta)');
  const badge = (engine) => doc.querySelector(`.engine-card[data-engine="${engine}"] h3 .beta-badge`);
  assert.equal(badge('codex')?.textContent, 'Beta');
  assert.equal(badge('claude'), null);
  renderAskEngineSection(doc.getElementById('a'), { catalog: CATALOG });
  assert.equal(optionText(doc.getElementById('a'), 'askEngine'), 'Codex (beta)');
});
