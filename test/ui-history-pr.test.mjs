// test/ui-history-pr.test.mjs — a finished run's branch and PR, now that the list card is gone.
// The Runs row says where the PR stands in its word (the glance headline, D12); the branch
// row lives in the saved run's Details header (D14). The card's Create PR / View PR buttons
// are gone; the pane's .hd-pr / .hd-pr-link are covered in test/ui-history-shipit.test.mjs.
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
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = (url, opts) => {
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
  const selectProject = () => {
    const sel = window.document.querySelector('#projectSelect');
    sel.value = PROJECT; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const showRuns = () => { window.location.hash = 'runs'; window.dispatchEvent(new window.Event('hashchange')); };
  // The saved run's Details (its header carries the branch row).
  const showDetails = (p) => { window.location.hash = `history/${p.projectKey}/${p.id}/details`; window.dispatchEvent(new window.Event('hashchange')); };
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { window, selectProject, showRuns, showDetails, settle };
}
const runs = (pipelines, ghAvailable, prHosts = null) => Promise.resolve({ ok: true, status: 200,
  json: async () => ({ pipelines, live: [], ghAvailable, ...(prHosts ? { prHosts } : {}) }) });
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

const SURVIVED = {
  id: 'p1', title: 'Feat', status: 'stopped', startedAt: '2026-06-02T00:00:00Z',
  branch: 'worca-cc/feat-1', sourceBranch: 'main', survived: true, added: 12, removed: 5,
  projectName: 'Proj', projectKey: 'proj-0000abcd', projectDir: '/x/proj',
};

// Minimal detail payload for a row, per readPipelineByKey: 8 keys, `results`/`overview`
// null. Its state's branch mirrors the row's (no `source` for a legacy entry).
const detailOf = (p) => ({
  state: {
    id: p.id, title: p.title, status: p.status, startedAt: p.startedAt,
    stepper: null, steps: [], subAgents: [],
    branch: p.branch ? { feature: p.branch, ...(p.sourceBranch ? { source: p.sourceBranch } : {}) } : null,
  },
  results: null, overview: null, clarify: { questions: [], answers: [] },
  reviews: [], stepQuestions: [], artifacts: [], auditMarkdown: '',
});
// MOST-SPECIFIC FIRST: the keyed detail URL `/api/history/proj-0000abcd/p1` STARTS WITH
// `/api/history/pr` (the key begins "pro"), so every arm matches with endsWith.
const armsFor = (rows, ghAvailable = true, prHosts = null) => (url) => {
  if (url.endsWith('/api/history/pr')) return ok({ ok: true });
  for (const p of rows) if (url.endsWith(`/api/history/${p.projectKey}/${p.id}`)) return ok(detailOf(p));
  if (url.endsWith('/api/history')) return runs(rows, ghAvailable, prHosts);
  return null;
};

// ---------------------------------------------------------------------------
// The branch row (the saved run's Details header; the list row has none, D14)
// ---------------------------------------------------------------------------

test('branch row: source -> destination when known, destination only for legacy entries, hidden without a feature branch', async () => {
  await checkRows([
    { name: 'survived entry: source → destination branch line', run: async () => {
      const ctx = await boot({ fetchHandler: armsFor([SURVIVED]) });
      ctx.showDetails(SURVIVED);
      await ctx.settle();
      const doc = ctx.window.document;
      const base = doc.querySelector('#hist-detail .hd-base');
      assert.equal(base.hidden, false);
      assert.equal(base.textContent, 'main →', 'the source branch, then the arrow');
      assert.equal(doc.querySelector('#hist-detail .hd-branch-name').textContent, 'worca-cc/feat-1');
      assert.equal(doc.querySelector('#hist-detail .hd-branch-copy').hidden, false);
    } },
    { name: 'legacy entry without sourceBranch: destination only, no arrow', run: async () => {
      const LEGACY = { ...SURVIVED, id: 'pl', sourceBranch: null };
      const ctx = await boot({ fetchHandler: armsFor([LEGACY]) });
      ctx.showDetails(LEGACY);
      await ctx.settle();
      const doc = ctx.window.document;
      const base = doc.querySelector('#hist-detail .hd-base');
      assert.equal(base.hidden, true);
      assert.equal(base.textContent, '', 'no source, so no arrow either');
      assert.equal(doc.querySelector('#hist-detail .hd-branch-name').textContent, 'worca-cc/feat-1');
      assert.equal(doc.querySelector('#hist-detail .hd-branch-copy').hidden, false);
    } },
    { name: 'entry without a feature branch hides the whole branch row', run: async () => {
      const NOBRANCH = { ...SURVIVED, id: 'pn', branch: null, sourceBranch: null, survived: false };
      const ctx = await boot({ fetchHandler: armsFor([NOBRANCH]) });
      ctx.showDetails(NOBRANCH);
      await ctx.settle();
      const doc = ctx.window.document;
      // The template ships the branch row hidden: prove the header painted this run first.
      assert.equal(doc.querySelector('#hist-detail .hd-title').textContent, 'Feat', 'the saved run\'s header painted');
      assert.equal(doc.querySelector('#hist-detail .hd-branch-copy').hidden, true);
      assert.equal(doc.querySelector('#hist-detail .hd-base').hidden, true);
    } },
  ]);
});

// ---------------------------------------------------------------------------
// The PR in the row's word (the glance headline: done + pr state)
// ---------------------------------------------------------------------------

const DONE = { ...SURVIVED, status: 'done' };
const word = (row) => row.querySelector('.runs-row-sub').textContent.split(' · ')[0];

test('PR state words: OPEN reads \'In review\' (links to the saved run), MERGED \'Merged\' (even with the branch gone), CLOSED \'PR closed\' never Merged/In review', async () => {
  const OPEN = { ...DONE, id: 'po', pr: { state: 'OPEN', url: 'https://gh/x/pull/8', number: 8 } };
  const MERGED = { ...DONE, id: 'pm', pr: { state: 'MERGED', url: 'https://gh/x/pull/9', number: 9 } };
  // Defense in depth: even if a stray CLOSED pr object reaches the client, the row must
  // not claim the work landed. (In practice the server now sends pr:null here.)
  const CLOSED = { ...DONE, id: 'pc', pr: { state: 'CLOSED', url: 'https://gh/x/pull/1', number: 1 } };
  // The cited case: PR merged, the lookup is by remote head name, not local branch.
  const MERGED_GONE = {
    ...DONE, id: 'pmg', survived: false,
    pr: { state: 'MERGED', url: 'https://gh/x/pull/2', number: 2 },
  };
  const ctx = await boot({ fetchHandler: armsFor([OPEN, MERGED, CLOSED, MERGED_GONE]) });
  ctx.showRuns();
  await new Promise((r) => setTimeout(r, 0));
  const rowFor = (p) => {
    const row = ctx.window.document.querySelector(`#runs-list .runs-row[data-kind="hist"][data-pipeline-id="${p.id}"]`);
    assert.ok(row, 'the finished run is listed');
    return row;
  };
  await checkRows([
    { name: 'open PR: the row reads "In review" and links to the saved run', run: () => {
      const row = rowFor(OPEN);
      assert.equal(word(row), 'In review');
      assert.equal(row.getAttribute('href'), `#history/${OPEN.projectKey}/po`, 'the row opens the run, not GitHub');
    } },
    // A workspace run never offers Create PR from the list — the Runs list shows only a
    // word, and PR eligibility (members vs primary-only) is asserted for the saved-run
    // detail screen in ui-history-shipit.test.mjs.
    { name: 'merged PR: the row reads "Merged"', run: () => {
      assert.equal(word(rowFor(MERGED)), 'Merged');
    } },
    { name: 'closed (unmerged) PR: the row reads "PR closed", never "Merged" or "In review"', run: () => {
      assert.equal(word(rowFor(CLOSED)), 'PR closed');
    } },
    { name: 'merged PR with branch gone (survived=false) still reads "Merged"', run: () => {
      assert.equal(word(rowFor(MERGED_GONE)), 'Merged');
    } },
  ]);
});

// No PR yet and a clean review: "Ready to ship" when some PR host can open one (gh, or an
// Azure DevOps token, D8), "Finished" when none can.
test('a run with no PR reads "Ready to ship" when gh or an Azure DevOps token is available, "Finished" when neither is', async () => {
  const READY = { ...DONE, id: 'pr0', pr: null, checks: 0, files: 3 };
  const wordWith = async (ghAvailable, prHosts) => {
    const ctx = await boot({ fetchHandler: armsFor([READY], ghAvailable, prHosts) });
    ctx.showRuns();
    await ctx.settle();
    const row = ctx.window.document.querySelector(`#runs-list .runs-row[data-kind="hist"][data-pipeline-id="${READY.id}"]`);
    assert.ok(row, 'the finished run is listed');
    return word(row);
  };
  await checkRows([
    { name: 'gh available', run: async () => assert.equal(await wordWith(true, null), 'Ready to ship') },
    { name: 'only an Azure DevOps token', run: async () => assert.equal(await wordWith(false, { github: false, azure: true }), 'Ready to ship') },
    { name: 'no PR host at all', run: async () => assert.equal(await wordWith(false, { github: false, azure: false }), 'Finished') },
  ]);
});

// The two merge-pill re-check tests moved to test/ui-history-shipit.test.mjs:
// the pill is detail-only now (`.hd .hist-merge`), and the PR is opened from the
// detail screen's ship-it modal rather than from the list card.
