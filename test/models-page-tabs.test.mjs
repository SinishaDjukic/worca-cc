// test/models-page-tabs.test.mjs — the Models page's tab address grammar and tab strip (models-menu P1 Task 1,
// contract C1): the tab list, the provider rows, parseModelsParam / modelsHash, and the strip renderModelsTabs builds
// and paintModelsTabs repaints.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ICONS } from '../ui/public/icons.mjs';
import {
  MODELS_PAGE_TABS, PROVIDER_ROWS, parseModelsParam, modelsHash, renderModelsTabs, paintModelsTabs,
} from '../ui/public/models/page-tabs.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
const docOf = () => { const d = new JSDOM(''); doms.push(d); return d.window.document; };

test('the tab list and the provider rows are frozen, in order', () => {
  assert.deepEqual(MODELS_PAGE_TABS, ['catalogue', 'jobs', 'providers']);
  assert.ok(Object.isFrozen(MODELS_PAGE_TABS));
  assert.deepEqual(PROVIDER_ROWS, ['copilot', 'openrouter', 'openai', 'anthropic', 'speech', 'images', 'sound']);
  assert.ok(Object.isFrozen(PROVIDER_ROWS));
});

test('parseModelsParam: the tab is the first path part; the old card addresses open Jobs; anything else is Catalogue', () => {
  assert.deepEqual(parseModelsParam(), { tab: 'catalogue', rest: '' });
  const rows = [
    ['', 'catalogue', ''],
    ['model/my-gpt', 'catalogue', 'model/my-gpt'],
    ['jobs', 'jobs', ''],
    ['jobs/steps', 'jobs', 'steps'],
    ['providers', 'providers', ''],
    ['providers/openai', 'providers', 'openai'],
    ['engine', 'jobs', 'engine'],
    ['engine-settings-card', 'jobs', 'engine-settings-card'],
    ['model-roles-card', 'jobs', 'model-roles-card'],
    ['title-model', 'jobs', 'title-model'],
    ['nonsense', 'catalogue', 'nonsense'],
  ];
  for (const [param, tab, rest] of rows) assert.deepEqual(parseModelsParam(param), { tab, rest }, JSON.stringify(param));
});

test('modelsHash: Catalogue is the bare models address; the other tabs add their name, then rest', () => {
  assert.equal(modelsHash('catalogue'), 'models');
  assert.equal(modelsHash('catalogue', 'model/x'), 'models/model/x');
  assert.equal(modelsHash('jobs'), 'models/jobs');
  assert.equal(modelsHash('jobs', 'steps'), 'models/jobs/steps');
  assert.equal(modelsHash('providers', 'images'), 'models/providers/images');
});

test('renderModelsTabs builds the strip; paintModelsTabs moves the lit tab and writes the count', () => {
  const doc = docOf();
  const nav = renderModelsTabs(doc, { active: 'jobs', count: 59 });
  assert.equal(nav.tagName, 'NAV');
  assert.equal(nav.id, 'models-tabs');
  assert.ok(nav.classList.contains('tabs') && nav.classList.contains('mdl-tabs'));
  assert.equal(nav.getAttribute('aria-label'), 'Models');
  assert.equal(nav.hasAttribute('role'), false);
  const links = [...nav.querySelectorAll('a.tab.mdl-tab')];
  assert.deepEqual(links.map((a) => [a.dataset.tab, a.getAttribute('href')]),
    [['catalogue', '#models'], ['jobs', '#models/jobs'], ['providers', '#models/providers']]);
  assert.deepEqual(links.map((a) => a.querySelector('.mdl-tab-name')?.textContent), ['Catalogue', 'Jobs', 'Providers']);
  assert.deepEqual(links.map((a) => a.querySelector('.ic svg')?.innerHTML), [ICONS.layers, ICONS.briefcase, ICONS.cloud]);
  // SH-2: a 16px line icon before each name (the mock's too; the walk measured 14).
  for (const a of links) assert.deepEqual([a.querySelector('.ic').style.width, a.querySelector('.ic svg').getAttribute('width')], ['16px', '16'], a.dataset.tab);
  assert.deepEqual([...nav.querySelectorAll('[aria-current="page"]')], [links[1]]);
  assert.equal(links[1].getAttribute('aria-current'), 'page');
  assert.deepEqual([...nav.querySelectorAll('.on')], [links[1]]);
  const counts = [...nav.querySelectorAll('.mdl-tab-count')];
  assert.equal(counts.length, 1);
  assert.equal(counts[0].parentElement, links[0]);
  assert.ok(counts[0].matches('span.badge'));
  assert.equal(counts[0].textContent, '59');
  assert.equal(counts[0].hidden, false);

  paintModelsTabs(nav, { active: 'catalogue', count: null });
  assert.deepEqual([...nav.querySelectorAll('.on')], [links[0]]);
  assert.deepEqual([...nav.querySelectorAll('[aria-current]')], [links[0]]);
  assert.equal(links[0].getAttribute('aria-current'), 'page');
  assert.equal(counts[0].hidden, true);

  paintModelsTabs(nav, { active: 'providers', count: 0 });
  assert.deepEqual([...nav.querySelectorAll('.on')], [links[2]]);
  assert.deepEqual([...nav.querySelectorAll('[aria-current]')], [links[2]]);
  assert.equal(counts[0].hidden, false);
  assert.equal(counts[0].textContent, '0');
});

test('a strip with no count hides the pill; the two new icons are their own glyphs (cloud is not remote)', () => {
  const nav = renderModelsTabs(docOf());
  assert.deepEqual([...nav.querySelectorAll('.on')].map((a) => a.dataset.tab), ['catalogue']);
  assert.equal(nav.querySelector('.mdl-tab-count').hidden, true);
  for (const name of ['briefcase', 'cloud']) assert.ok(Object.hasOwn(ICONS, name), name);
  assert.notEqual(ICONS.cloud, ICONS.remote);
  const keys = Object.keys(ICONS);
  assert.deepEqual(keys.slice(-2), ['briefcase', 'cloud'], 'appended at the end of ICONS');
  for (const name of ['briefcase', 'cloud']) assert.equal(keys.find((k) => ICONS[k] === ICONS[name]), name, `${name} copies no earlier glyph`);
});
