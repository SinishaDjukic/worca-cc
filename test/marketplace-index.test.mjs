// test/marketplace-index.test.mjs — mountMarketplace: the three tabs and a provider for every page action (marketplace P3).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { ROWS, pageHarness } from './helpers/marketplace-fixtures.mjs';
import { mountMarketplace } from '../ui/public/marketplace/index.mjs';

const trackDom = useDomRelease(afterEach);

test('every page action reaches today\'s flow until P5–P7 replace it', async () => {
  const { page, seen, navs, calls, msgs } = pageHarness({ trackDom, mount: mountMarketplace,
    routes: { 'POST /api/marketplaces': () => ({ ok: true, status: 200, data: { ok: true, marketplace: { name: 'Acme', plugins: [{}, {}] } } }) } });
  await page.load();
  page.act('openManage', 'github-source', { section: 'settings', seeds: { baseUrl: 'https://jira.acme' } });
  await page.act('updateOne', 'github-source', { opener: null });
  await page.act('openUpdateReview');
  const removed = []; await page.act('openRemove', 'github-source', { onRemoved: () => removed.push('github-source') });
  page.act('openAddMarketplace', {});
  const r = await page.act('openAddMarketplace', { url: 'acme/m', opener: null });
  assert.doesNotThrow(() => page.act('marketplaceAddChanged', { id: 'j1', state: 'running' }), 'the action exists before P7');
  assert.deepEqual(seen, [['settings', 'github-source', { baseUrl: 'https://jira.acme' }], ['update', 'github-source'], ['update', 'github-source'], ['wait'],
    ['remove', 'github-source', { mcpSets: 'General', skillSets: '' }], ['add-row']]);
  assert.deepEqual(removed, ['github-source'], 'SM33: onRemoved after a removal');
  assert.deepEqual([page.state.tab, navs.at(-1), r.ok, msgs.at(-1)], ['marketplaces', '#marketplace/marketplaces', true, ['Added Acme (2 plugins).', 'ok']]);
  assert.equal(calls.filter((c) => c === 'GET /api/plugins').length, 2, 'a successful add reloads the page');
});
test('a refused add neither reloads nor says Added; a linked folder says Linked', async () => {
  let answer = { ok: false, status: 400, data: { error: 'not a marketplace repo' } };
  const { page, calls, msgs } = pageHarness({ trackDom, mount: mountMarketplace, routes: { 'POST /api/marketplaces': () => answer } });
  await page.load(); const g = calls.filter((c) => c === 'GET /api/plugins').length;
  const r = await page.act('openAddMarketplace', { url: 'acme/m' });
  assert.deepEqual([r.ok, calls.filter((c) => c === 'GET /api/plugins').length - g, msgs.filter(([, k]) => k === 'ok')], [false, 0, []]);
  answer = { ok: true, status: 200, data: { ok: true, linked: true, plugin: { name: 'p', dir: '/x', workflows: { imported: ['a'] } } } };
  await page.act('openAddMarketplace', { url: '/x' });
  assert.deepEqual(msgs.at(-1), ['Linked plugin "p" from /x — 1 pipeline template added to your saved pipelines.', 'ok']);
});
test('the Installed tab chip counts only plugins with an update', async () => {
  const { doc, page } = pageHarness({ trackDom, mount: mountMarketplace,
    routes: { 'GET /api/plugins': () => ({ ok: true, status: 200, data: { plugins: [...ROWS, { name: 'x', version: '1.0.0', latest: null, contributions: {} }], orphans: [] } }) } });
  await page.load();
  assert.deepEqual([doc.querySelector('.mk-tab[data-tab="installed"] .mk-count').textContent, doc.querySelector('.mk-tab[data-tab="installed"] .mk-upd-chip').textContent],
    ['2', '1 update']);
});
