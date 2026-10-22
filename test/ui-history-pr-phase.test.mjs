// test/ui-history-pr-phase.test.mjs
// Phase-2 PR enrichment over the WS: a `history-pr` batch updates the matching
// Runs row's state (the run model: "Ready to ship" with no PR -> "In review" /
// "Merged"), tagged by a request token so stale/racing batches are
// dropped. Rows repaint through a coalesced microtask that REPLACES changed nodes, so
// every assertion re-queries its row. Boots the REAL app.js under jsdom; WS frames are
// delivered via wsBox.ws.dispatch('message', { data }) (harness per test/ui-question.test.mjs).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function boot({ fetchHandler } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {} close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };
  const calls = [];
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const showRuns = () => { window.location.hash = 'runs'; window.dispatchEvent(new window.Event('hashchange')); };
  // The Refresh button is gone (D14): a pipelines-changed frame on #runs force-reloads History (app.js:1076).
  const refresh = () => wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'pipelines-changed' }) });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const prTokens = () => calls.filter((c) => c.url.endsWith('/api/history/pr') && c.opts.body).map((c) => JSON.parse(c.opts.body).token);
  const historyGets = () => calls.filter((c) => c.url.endsWith('/api/history') && !c.opts.method).length;
  const dispatchPr = (msg) => wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'history-pr', done: true, items: [], ...msg }) });
  return { window, calls, wsBox, showRuns, refresh, tick, prTokens, historyGets, dispatchPr };
}

const skeleton = (pipelines, ghAvailable = true) =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live: [], ghAvailable }) });

// A finished run with no review counts: its word depends on `pr` alone ("Finished" while
// the lookup runs, "In review" / "Merged" once gh answers).
const ROW = (over = {}) => ({
  id: 'p1', title: 'Feat', status: 'done', startedAt: '2026-06-02T00:00:00Z',
  branch: 'worca-cc/feat-1', sourceBranch: 'main', survived: true, added: 3, removed: 1,
  projectName: 'Proj', projectKey: 'proj-0000abcd', projectDir: '/x/proj', ...over,
});
// Its review flagged nothing: once gh answers "no PR" (null) the word is "Ready to ship",
// while the lookup is still pending it stays "Finished". Tells pending from resolved apart.
const READY = { checks: 0 };

const rowSel = (id, key) => `#runs-list .runs-row[data-kind="hist"][data-pipeline-id="${id}"][data-project-key="${key}"]`;
// Re-queried on every call: never hold a row across a repaint.
function wordOf(ctx, id = 'p1', key = 'proj-0000abcd') {
  const row = ctx.window.document.querySelector(rowSel(id, key));
  assert.ok(row, `row ${key}/${id} is listed`);
  // The run model's state for the row (runs-list.mjs): a pending lookup and "no PR" both read Ready to ship.
  return { 'in-review': 'In review', merged: 'Merged', ready: 'Ready to ship' }[row.dataset.state] || row.dataset.state;
}
const busy = (ctx) => ctx.window.document.getElementById('runs-list').getAttribute('aria-busy');

test('history-pr OPEN and MERGED batches turn the row word into In review / Merged without a refetch', async () => {
  const ctx = await boot({ fetchHandler: (url) => (url.endsWith('/api/history') ? skeleton([ROW()]) : null) });
  ctx.showRuns();
  await ctx.tick();
  // The load token stays current after its final batch, so the MERGED batch below still applies.
  const token = ctx.prTokens().at(-1);
  await checkRows([
    { name: 'history-pr OPEN batch turns the row word into "In review", without a refetch', run: async () => {
      assert.equal(wordOf(ctx), 'Ready to ship', 'pending: the headline while the PR lookup runs');

      const gets = ctx.historyGets();
      assert.ok(token != null, 'client POSTed a load token');
      ctx.dispatchPr({ token, done: true, items: [{ projectKey: 'proj-0000abcd', id: 'p1', pr: { state: 'OPEN', url: 'https://gh/x/pull/8', number: 8 } }] });
      await ctx.tick();

      assert.equal(wordOf(ctx), 'In review', 'the row reads the PR state');
      // The patch repaints from the in-memory rows (scheduleRunsPaint), never by reloading
      // History, and never navigates to the detail screen.
      assert.equal(ctx.historyGets(), gets, 'no /api/history refetch');
      assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'runs', 'the patch never navigates');
      assert.equal(busy(ctx), 'false', 'the final batch clears the busy state');
    } },
    { name: 'history-pr MERGED batch makes the row read "Merged"', run: async () => {
      ctx.dispatchPr({ token, items: [{ projectKey: 'proj-0000abcd', id: 'p1', pr: { state: 'MERGED', url: 'https://gh/x/pull/9', number: 9 } }] });
      await ctx.tick();
      assert.equal(wordOf(ctx), 'Merged');
    } },
  ]);
});

test('history-pr batches repaint the row’s PR chip in place, even when the word stays "In review"', async () => {
  const ctx = await boot({ fetchHandler: (url) => (url.endsWith('/api/history') ? skeleton([ROW()]) : null) });
  ctx.showRuns();
  await ctx.tick();
  const token = ctx.prTokens().at(-1);
  // Re-queried on every call: a repaint replaces the row.
  const chip = () => {
    const c = ctx.window.document.querySelector(`${rowSel('p1', 'proj-0000abcd')} .runs-pr`);
    return c ? [c.className, c.querySelector('.runs-pr-word').textContent] : null;
  };
  const send = async (pr) => {
    ctx.dispatchPr({ token, items: [{ projectKey: 'proj-0000abcd', id: 'p1', pr }] });
    await ctx.tick();
  };
  const OPEN = { state: 'OPEN', url: 'https://gh/x/pull/8', number: 8 };
  assert.equal(chip(), null, 'the lookup has not answered: nothing drawn');
  await send({ ...OPEN, isDraft: true, mergeable: 'UNKNOWN' });
  assert.deepEqual(chip(), ['runs-pr is-draft', 'Draft']);
  assert.equal(wordOf(ctx), 'In review');
  // Same row word from here on: only the chip's word tells the repaint something changed.
  await send({ ...OPEN, isDraft: false, mergeable: 'UNKNOWN' });
  assert.deepEqual(chip(), ['runs-pr is-ready', 'Ready']);
  await send({ ...OPEN, isDraft: false, mergeable: 'CONFLICTING' });
  assert.deepEqual(chip(), ['runs-pr is-conflicts', 'Conflicts']);
  assert.equal(wordOf(ctx), 'needs-you', 'a conflicting PR raises the run to Needs you (D31)');
  await send({ ...OPEN, state: 'CLOSED', isDraft: false, mergeable: 'UNKNOWN' });
  assert.deepEqual(chip(), ['runs-pr is-closed', 'Closed']);
  assert.equal(wordOf(ctx), 'Ready to ship');
  await send({ ...OPEN, state: 'MERGED', isDraft: false, mergeable: 'UNKNOWN' });
  assert.deepEqual(chip(), ['runs-pr is-merged', 'Merged']);
  await send(null);
  assert.equal(chip(), null, 'no PR: the chip goes');
});

test('a workspace run’s history-pr batch draws its most urgent member PR and their count', async () => {
  const member = (memberKey) => ({ memberKey, name: memberKey, projectDir: `/x/${memberKey}`, branch: 'worca-cc/feat-1',
    sourceBranch: 'main', survived: true, affected: true });
  const ws = ROW({ target: 'workspace', members: [member('api'), member('web'), member('doc')] });
  const ctx = await boot({ fetchHandler: (url) => (url.endsWith('/api/history') ? skeleton([ws]) : null) });
  ctx.showRuns();
  await ctx.tick();
  const token = ctx.prTokens().at(-1);
  const chip = () => {
    const c = ctx.window.document.querySelector(`${rowSel('p1', 'proj-0000abcd')} .runs-pr`);
    return c ? [c.className, c.querySelector('.runs-pr-word').textContent] : null;
  };
  const pr = (n, more = {}) => ({ state: 'OPEN', url: `https://gh/x/pull/${n}`, number: n, isDraft: false, mergeable: 'UNKNOWN', ...more });
  const send = async (members) => {
    ctx.dispatchPr({ token, items: [{ projectKey: 'proj-0000abcd', id: 'p1', pr: pr(1), members }] });
    await ctx.tick();
  };
  await send([{ memberKey: 'api', pr: pr(1) }, { memberKey: 'web', pr: pr(2, { state: 'MERGED' }) }, { memberKey: 'doc', pr: null }]);
  assert.deepEqual(chip(), ['runs-pr is-ready', 'Ready · 2 PRs']);
  await send([{ memberKey: 'api', pr: pr(1) }, { memberKey: 'web', pr: pr(2, { state: 'MERGED' }) }, { memberKey: 'doc', pr: pr(3) }]);
  assert.deepEqual(chip(), ['runs-pr is-ready', 'Ready · 3 PRs'], 'the count alone repaints the row');
  // The rollup (`pr`) stays the same open PR: only the members' states repaint the row.
  await send([{ memberKey: 'api', pr: pr(1) }, { memberKey: 'web', pr: pr(2, { mergeable: 'CONFLICTING' }) }, { memberKey: 'doc', pr: pr(3, { isDraft: true }) }]);
  assert.deepEqual(chip(), ['runs-pr is-conflicts', 'Conflicts · 3 PRs']);
  assert.equal(wordOf(ctx), 'needs-you', 'a conflicting member PR raises the run to Needs you (D11)');
  await send([{ memberKey: 'api', pr: pr(1) }, { memberKey: 'web', pr: null }, { memberKey: 'doc', pr: null }]);
  assert.deepEqual(chip(), ['runs-pr is-ready', 'Ready'], 'one member PR: no count');
});

test('id collision across projects: only the (id, projectKey)-matched row is patched', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.endsWith('/api/history')
      ? skeleton([ROW({ id: 'dup', projectKey: 'k1' }), ROW({ id: 'dup', projectKey: 'k2' })]) : null),
  });
  ctx.showRuns();
  await ctx.tick();
  const token = ctx.prTokens().at(-1);
  ctx.dispatchPr({ token, items: [{ projectKey: 'k1', id: 'dup', pr: { state: 'OPEN', url: 'https://gh/x/pull/1', number: 1 } }] });
  await ctx.tick();

  assert.equal(wordOf(ctx, 'dup', 'k1'), 'In review', 'k1 row patched');
  assert.equal(wordOf(ctx, 'dup', 'k2'), 'Ready to ship', 'k2 row untouched (resolved to no PR by the final batch)');
});

test('stale/never-issued token batch is dropped (no DOM change)', async () => {
  const ctx = await boot({ fetchHandler: (url) => (url.endsWith('/api/history') ? skeleton([ROW(READY)]) : null) });
  ctx.showRuns();
  await ctx.tick();
  const token = ctx.prTokens().at(-1);
  ctx.dispatchPr({ token: token + 999, items: [{ projectKey: 'proj-0000abcd', id: 'p1', pr: { state: 'OPEN', url: 'https://gh/x/pull/8', number: 8 } }] });
  await ctx.tick();
  // A stale item would read "In review"; a stale FINAL batch would finalize to "Ready to ship".
  assert.equal(wordOf(ctx), 'Ready to ship', 'still pending — the stale batch did not resolve it');
  assert.equal(busy(ctx), 'true', 'nor clear the busy state');
  // settle the real load so no watchdog lingers
  ctx.dispatchPr({ token, items: [] });
  await ctx.tick();
  assert.equal(wordOf(ctx), 'Ready to ship', 'the current token resolves it');
});

test('race: a forced reload supersedes the prior load; the old token batch is dropped', async () => {
  const ctx = await boot({ fetchHandler: (url) => (url.endsWith('/api/history') ? skeleton([ROW()]) : null) });
  ctx.showRuns();
  await ctx.tick();
  ctx.refresh();                         // pipelines-changed -> force reload -> bumps the token
  await ctx.tick();
  const tokens = ctx.prTokens();
  const [tA, tB] = [tokens[0], tokens.at(-1)];
  assert.notEqual(tA, tB, 'the forced reload issued a new token');

  // Deliver the OLD token LAST -> must be ignored.
  ctx.dispatchPr({ token: tA, items: [{ projectKey: 'proj-0000abcd', id: 'p1', pr: { state: 'OPEN', url: 'https://gh/x/pull/8', number: 8 } }] });
  await ctx.tick();
  assert.equal(wordOf(ctx), 'Ready to ship', 'stale (tA) batch dropped after tB superseded it');

  // The current token still patches.
  ctx.dispatchPr({ token: tB, items: [{ projectKey: 'proj-0000abcd', id: 'p1', pr: { state: 'OPEN', url: 'https://gh/x/pull/8', number: 8 } }] });
  await ctx.tick();
  assert.equal(wordOf(ctx), 'In review', 'current (tB) batch patches');
});

test('pending rows resolve progressively per entry, on the final done batch when never sent, and via the watchdog when enrichment fails', async () => {
  await checkRows([
    { name: 'each row stays pending until its own entry resolves, then updates progressively', run: async () => {
      const ctx = await boot({
        fetchHandler: (url) => (url.endsWith('/api/history')
          ? skeleton([ROW({ id: 'a', projectKey: 'k', ...READY }), ROW({ id: 'b', projectKey: 'k', ...READY })]) : null),
      });
      ctx.showRuns();
      await ctx.tick();
      // Eligible (gh + survived + branch + source) but UNRESOLVED -> pending, NOT "Ready to ship".
      assert.equal(wordOf(ctx, 'a', 'k'), 'Ready to ship', 'A pending');
      assert.equal(wordOf(ctx, 'b', 'k'), 'Ready to ship', 'B pending');

      const token = ctx.prTokens().at(-1);
      // Non-final batch resolves only A (no PR) -> A reads "Ready to ship", B stays pending.
      ctx.dispatchPr({ token, done: false, items: [{ projectKey: 'k', id: 'a', pr: null }] });
      await ctx.tick();
      assert.equal(wordOf(ctx, 'a', 'k'), 'Ready to ship', 'A resolved after its result');
      assert.equal(wordOf(ctx, 'b', 'k'), 'Ready to ship', 'B still pending until its result');
      assert.equal(busy(ctx), 'true', 'a non-final batch keeps the list busy');

      // Final batch resolves B (OPEN) -> B reads "In review".
      ctx.dispatchPr({ token, done: true, items: [{ projectKey: 'k', id: 'b', pr: { state: 'OPEN', url: 'https://gh/x/pull/4', number: 4 } }] });
      await ctx.tick();
      assert.equal(wordOf(ctx, 'b', 'k'), 'In review');
      assert.equal(wordOf(ctx, 'a', 'k'), 'Ready to ship', 'A keeps its result');
    } },
    { name: 'an eligible entry the server never sent a batch for is resolved on the final (done) batch', run: async () => {
      const ctx = await boot({
        fetchHandler: (url) => (url.endsWith('/api/history') ? skeleton([ROW({ id: 'a', projectKey: 'k', ...READY })]) : null),
      });
      ctx.showRuns();
      await ctx.tick();
      assert.equal(wordOf(ctx, 'a', 'k'), 'Ready to ship', 'pending');
      const token = ctx.prTokens().at(-1);
      ctx.dispatchPr({ token, done: true, items: [] });   // final batch, no item for 'a'
      await ctx.tick();
      assert.equal(wordOf(ctx, 'a', 'k'), 'Ready to ship', 'resolved as "no PR" by finalize');
    } },
    { name: 'enrichment failure (no done batch) resolves pending rows via the watchdog catch', run: async () => {
      const ctx = await boot({
        fetchHandler: (url) => {
          if (url.endsWith('/api/history/pr')) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
          if (url.endsWith('/api/history')) return skeleton([ROW({ id: 'a', projectKey: 'k', ...READY })]);
          return null;
        },
      });
      ctx.showRuns();
      await ctx.tick();                                   // POST /api/history/pr rejects -> catch finalizes
      assert.equal(wordOf(ctx, 'a', 'k'), 'Ready to ship', 'failed enrichment still settles the word');
      assert.equal(busy(ctx), 'false', 'and clears the busy state');
    } },
  ]);
});

// Maps 1:1 to the reported bug, now inverted by carryHistoryPr (D12): a reload's rows
// carry no `pr`, so a merged row used to drop to "Finished" and back on every reload.
// It keeps its last known PR until Phase 2 answers again.
test('a reload keeps a merged row "Merged" (no "Finished" flash) until the next batch re-resolves it', async () => {
  const ctx = await boot({ fetchHandler: (url) => (url.endsWith('/api/history') ? skeleton([ROW()]) : null) });
  ctx.showRuns();
  await ctx.tick();
  // First load resolves the entry as MERGED (done defaults true via dispatchPr).
  const t1 = ctx.prTokens().at(-1);
  ctx.dispatchPr({ token: t1, items: [{ projectKey: 'proj-0000abcd', id: 'p1', pr: { state: 'MERGED', url: 'https://gh/x/pull/9', number: 9 } }] });
  await ctx.tick();
  assert.equal(wordOf(ctx), 'Merged', 'resolved to Merged after first load');

  // Forced reload: the skeleton has no pr -> the row keeps the last known one.
  const gets = ctx.historyGets();
  ctx.refresh();
  await ctx.tick();
  assert.equal(ctx.historyGets(), gets + 1, 'History was fetched again');
  assert.equal(busy(ctx), 'true', 'the reload is in flight (Phase 2 not answered yet)');
  assert.equal(wordOf(ctx), 'Merged', 'no "Finished" flash while the PR lookup runs');

  // Enrichment re-resolves -> still Merged.
  const t2 = ctx.prTokens().at(-1);
  assert.notEqual(t1, t2, 'the reload issued a new token');
  ctx.dispatchPr({ token: t2, items: [{ projectKey: 'proj-0000abcd', id: 'p1', pr: { state: 'MERGED', url: 'https://gh/x/pull/9', number: 9 } }] });
  await ctx.tick();
  assert.equal(wordOf(ctx), 'Merged', 're-resolved to Merged after the reload');
  assert.equal(busy(ctx), 'false');
});

test('a failing-checks PR batch counts the run on the Runs badge at once (no leaving #runs)', async () => {
  const ctx = await boot({ fetchHandler: (url) => (url.endsWith('/api/history') ? skeleton([ROW()]) : null) });
  ctx.showRuns();
  await ctx.tick();
  const doc = ctx.window.document;
  const token = ctx.prTokens().at(-1);
  assert.equal(doc.getElementById('nav-needs-count').hidden, true, 'nothing needs you before the verdict');
  ctx.dispatchPr({ token, items: [{ projectKey: 'proj-0000abcd', id: 'p1',
    pr: { state: 'OPEN', url: 'https://gh/x/pull/8', number: 8, checks: { state: 'failing', total: 12, failed: 3, pending: 0 } } }] });
  await ctx.tick();
  const nc = doc.getElementById('nav-needs-count');
  assert.equal(nc.hidden, false, 'the badge shows');
  assert.equal(nc.querySelector('.nav-count-n').textContent, '1');
  assert.match(doc.querySelector('.nav button[data-nav="runs"]').getAttribute('aria-label'), /1 needs you/);
});
