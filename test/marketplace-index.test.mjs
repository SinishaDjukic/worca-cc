// test/marketplace-index.test.mjs — mountMarketplace: the three tabs and a provider for every page action (marketplace P3).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { ROWS, pageHarness } from './helpers/marketplace-fixtures.mjs';
import { mountMarketplace } from '../ui/public/marketplace/index.mjs';

const trackDom = useDomRelease(afterEach);

test('the Installed tab chip counts only plugins with an update', async () => {
  const { doc, page } = pageHarness({ trackDom, mount: mountMarketplace,
    routes: { 'GET /api/plugins': () => ({ ok: true, status: 200, data: { plugins: [...ROWS, { name: 'x', version: '1.0.0', latest: null, contributions: {} }], orphans: [] } }) } });
  await page.load();
  assert.deepEqual([doc.querySelector('.mk-tab[data-tab="installed"] .mk-count').textContent, doc.querySelector('.mk-tab[data-tab="installed"] .mk-upd-chip').textContent],
    ['2', '1 update']);
});

test('P6 providers: openManage and checkHealth open the plugin sheet, openUpdateReview the review sheet', async () => {
  const PREVIEW = { pinnedSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40), pinnedVersion: '0.2.0', candidateVersion: '0.3.0',
    previewedAt: '2026-10-20T10:00:00.000Z', access: [], commits: [{ sha: 'c'.repeat(40), subject: 'Fix' }],
    diffstat: ' 1 file changed, 1 insertion(+)', manifestDelta: {} };
  const { page, doc, calls } = pageHarness({ trackDom, mount: mountMarketplace, routes: {
    'GET /api/plugins/github-source': { plugin: {}, inventory: { taskSources: [{ id: 'github', displayName: 'GitHub Issues' }] },
      repo: null, subdir: '', sha: null, installedAt: null, updatedAt: null, webUrl: null },
    'GET /api/plugins/github-source/config': { sources: [], channels: [] },
    'POST /api/plugins/github-source/doctor': { ok: true, checks: [{ id: 'installed', ok: true, detail: 'lockfile entry present' }] },
    'POST /api/plugins/github-source/update': { preview: PREVIEW } } });
  await page.load();
  const name = page.state.plugins[0].name;
  await page.act('openManage', name);
  assert.deepEqual([doc.getElementById('mk-sheet').dataset.mode, doc.getElementById('mk-sheet-title').textContent], ['manage', name]);
  assert.ok(!calls.includes(`POST /api/plugins/${name}/doctor`), 'opening the sheet runs no checks (LC-P6-2)');
  await page.act('checkHealth', name);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelector('#mk-sheet [data-sec="health"] .mk-chip').textContent.trim(), '1 of 1 checks passed');
  await page.act('openUpdateReview', [name]);
  assert.deepEqual([doc.getElementById('mk-sheet').dataset.mode, doc.getElementById('mk-sheet-title').textContent,
    doc.querySelector('#mk-sheet .mk-upd-meta').textContent], ['update', `Update ${name}`, '1 of 1 ready']);
});

test('P7 providers: openAddMarketplace opens the Add dialog and answers undefined; marketplaceAddChanged reaches it', async () => {
  const { page, doc, calls } = pageHarness({ trackDom, mount: mountMarketplace,
    routes: { 'POST /api/marketplaces': () => ({ ok: true, status: 202, data: { jobId: 'mkt_0a1b2c3d', job: { id: 'mkt_0a1b2c3d', url: 'acme/m', state: 'running', phase: 'resolving', resolvedUrl: 'https://github.com/acme/m', sha: null } } }) } });
  await page.load();
  assert.equal(page.act('openAddMarketplace', { url: 'acme/m', opener: null }), undefined);
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual([doc.getElementById('mk-dialog').dataset.kind, calls.filter((c) => c === 'POST /api/marketplaces').length], ['add-marketplace', 1]);
  page.act('marketplaceAddChanged', { id: 'mkt_0a1b2c3d', url: 'acme/m', state: 'running', phase: 'reading', resolvedUrl: 'https://github.com/acme/m', sha: 'c'.repeat(40) });
  assert.equal(doc.querySelector('#mk-dialog li[aria-current="step"]').textContent, 'Reading plugins…');
  doc.querySelector('#mk-dialog .mk-dlg-close').click();
});
