// test/ui-history-detail-tabs-deep-link.test.mjs
// The History detail test of test/ui-history-detail-tabs.test.mjs whose first row needs the app LOADED on a saved
// run's address (a deep link, before the run's History row exists). The app loads its address once, so this test
// lives in its own file, booted on that address (test/helpers/shared-app-boot.mjs, C5). Shared boot and fixtures:
// helpers/history-detail-boot.mjs.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECT, settle, ROW, DETAIL, DETAIL_URL, retainedRow, okBudget, detailHash, historyArms, openDetail, deliverRows, secOf,
} from './helpers/history-detail-boot.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';
import { checkRows } from './helpers/rows.mjs';

// The load-time box: no History row yet, the saved run's detail.
const loadBox = { rows: [], detail: DETAIL, budget: okBudget() };
const loadArms = historyArms(loadBox);
const app = useSharedApp({ before, beforeEach, after }, {
  url: `http://localhost:4317/#${detailHash}`,
  resetHash: detailHash,
  fetchHandler: (u, opts) => loadArms(String(u), opts) || Promise.resolve(String(u).includes('/api/projects')
    ? { ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) }
    : { ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) }),
});

// history-detail-boot's bootDetail over the shared app. `deepLink` is the app as it loaded on the run's address,
// with the load-time box; any other boot resets the app OFF the run's address (the reset hash is the deep link), so
// openDetail re-enters the detail and fetches its own box instead of reading the previous row's screen.
let deepLinked = false;
const bootDetail = async ({ rows = [ROW], detail = DETAIL, budget = okBudget(), arms = null, deepLink = false } = {}) => {
  if (deepLink) {
    assert.equal(deepLinked, false, 'the app loads its address once');
    deepLinked = true;
    Object.assign(loadBox, { rows, detail, budget });
    return { window: app.window, calls: app.calls, wsBox: app.wsBox, box: loadBox };
  }
  const box = { rows, detail, budget };
  const base = historyArms(box);
  await app.fresh({ hash: '', fetchHandler: (url, opts) => (arms && arms(url, opts, box)) || base(url, opts) });
  return { window: app.window, calls: app.calls, wsBox: app.wsBox, box };
};

test('the WORKTREE card reads retained while running and flips released -> retained in place', async () => {
  await checkRows([
    { name: 'the WORKTREE card flips released -> retained without leaving the tab', run: async () => {
      // The carried-over phase-4 assertion. A tab body is built exactly ONCE, so the
      // one body that reads mutable record fields only tracks the authoritative row
      // because refreshHdFromRow calls refreshHdOverviewTab() — without it this card
      // would read `released` for the life of the screen.
      const ctx = await bootDetail({ rows: [], detail: DETAIL, deepLink: true });
      await settle(ctx.window, 5);
      const doc = ctx.window.document;

      const sec = secOf(doc, 'overview');
      assert.equal(sec.hidden, false, 'results-null -> Overview is the default tab');
      assert.match(sec.querySelector('.hd-ov-wt .hd-ov-wt-state').textContent, /^released$/,
        'the deep-link stub carries no retainedWork');

      await deliverRows(ctx, [retainedRow()]);
      assert.equal(secOf(doc, 'overview'), sec, 'the SAME section node is repainted in place');
      assert.equal(sec.hidden, false, 'and the user never left the tab');
      assert.equal(sec.querySelector('.hd-ov-wt .hd-ov-wt-state').textContent, 'retained');
      assert.equal(sec.querySelectorAll('.hd-ov-wt').length, 1, 'the repaint replaces, never stacks');
    } },
    { name: 'the WORKTREE card reads retained while the run is still running', run: async () => {
      // Running pipelines DO appear in History (listAllPipelines filters only
      // `archived_at IS NULL`), and their worktree is very much still on disk — the
      // card printed the live path under the word "released".
      const ctx = await bootDetail({
        rows: [{ ...ROW, status: 'running' }],
        detail: { ...DETAIL, state: { ...DETAIL.state, status: 'running' } },
      });
      await openDetail(ctx, 'details/overview');
      assert.ok(ctx.calls.some((c) => c.url.endsWith('/api/history')), 'History re-read this row\'s box');
      assert.ok(ctx.calls.some((c) => c.url.endsWith(DETAIL_URL)), 'the detail was fetched for this row');
      const sec = secOf(ctx.window.document, 'overview');
      const row = sec.querySelector('.hd-ov-wt');
      assert.equal(row.querySelector('.hd-ov-wt-state').textContent, 'retained');
      assert.match(row.textContent, /\/tmp\/wt/, 'and it names the worktree it just called retained');
    } },
  ]);
});
