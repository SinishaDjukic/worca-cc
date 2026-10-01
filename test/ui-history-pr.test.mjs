// test/ui-history-pr.test.mjs — a finished run's branch and PR, now that the list card is gone.
// The Runs row says where the PR stands in its word (the glance headline, D12); the branch
// row lives in the saved run's Details header (D14). The card's Create PR / View PR buttons
// are gone; the pane's .hd-pr / .hd-pr-link are covered in test/ui-history-shipit.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
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
const runs = (pipelines, ghAvailable) => Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live: [], ghAvailable }) });
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
const armsFor = (rows, ghAvailable = true) => (url) => {
  if (url.endsWith('/api/history/pr')) return ok({ ok: true });
  for (const p of rows) if (url.endsWith(`/api/history/${p.projectKey}/${p.id}`)) return ok(detailOf(p));
  if (url.endsWith('/api/history')) return runs(rows, ghAvailable);
  return null;
};

// ---------------------------------------------------------------------------
// The branch row (the saved run's Details header; the list row has none, D14)
// ---------------------------------------------------------------------------

test('survived entry: source → destination branch line', async () => {
  const ctx = await boot({ fetchHandler: armsFor([SURVIVED]) });
  ctx.showDetails(SURVIVED);
  await ctx.settle();
  const doc = ctx.window.document;
  const base = doc.querySelector('#hist-detail .hd-base');
  assert.equal(base.hidden, false);
  assert.equal(base.textContent, 'main →', 'the source branch, then the arrow');
  assert.equal(doc.querySelector('#hist-detail .hd-branch-name').textContent, 'worca-cc/feat-1');
  assert.equal(doc.querySelector('#hist-detail .hd-branch-copy').hidden, false);
});

test('legacy entry without sourceBranch: destination only, no arrow', async () => {
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
});

test('entry without a feature branch hides the whole branch row', async () => {
  const NOBRANCH = { ...SURVIVED, id: 'pn', branch: null, sourceBranch: null, survived: false };
  const ctx = await boot({ fetchHandler: armsFor([NOBRANCH]) });
  ctx.showDetails(NOBRANCH);
  await ctx.settle();
  const doc = ctx.window.document;
  // The template ships the branch row hidden: prove the header painted this run first.
  assert.equal(doc.querySelector('#hist-detail .hd-title').textContent, 'Feat', 'the saved run\'s header painted');
  assert.equal(doc.querySelector('#hist-detail .hd-branch-copy').hidden, true);
  assert.equal(doc.querySelector('#hist-detail .hd-base').hidden, true);
});

test('copy button copies the destination branch and does not navigate', async () => {
  const ctx = await boot({ fetchHandler: armsFor([SURVIVED]) });
  const { window } = ctx;
  let copied = null;
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: (t) => { copied = t; return Promise.resolve(); } },
    configurable: true,
  });
  ctx.showDetails(SURVIVED);
  await ctx.settle();
  const before = window.location.hash;
  const btn = window.document.querySelector('#hist-detail .hd-branch-copy');
  btn.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  await ctx.settle();
  assert.equal(copied, 'worca-cc/feat-1');
  assert.equal(window.location.hash, before, 'copy click must not navigate away from the saved run');
});

// ---------------------------------------------------------------------------
// The PR in the row's word (the glance headline: done + pr state)
// ---------------------------------------------------------------------------

const DONE = { ...SURVIVED, status: 'done' };
async function rowFor(p) {
  const ctx = await boot({ fetchHandler: armsFor([p]) });
  ctx.showRuns();
  await new Promise((r) => setTimeout(r, 0));
  const row = ctx.window.document.querySelector(`#runs-list .runs-row[data-kind="hist"][data-pipeline-id="${p.id}"]`);
  assert.ok(row, 'the finished run is listed');
  return row;
}
const word = (row) => row.querySelector('.runs-row-sub').textContent.split(' · ')[0];

test('open PR: the row reads "In review" and links to the saved run', async () => {
  const OPEN = { ...DONE, id: 'po', pr: { state: 'OPEN', url: 'https://gh/x/pull/8', number: 8 } };
  const row = await rowFor(OPEN);
  assert.equal(word(row), 'In review');
  assert.equal(row.getAttribute('href'), `#history/${OPEN.projectKey}/po`, 'the row opens the run, not GitHub');
});

test('merged PR: the row reads "Merged"', async () => {
  const MERGED = { ...DONE, id: 'pm', pr: { state: 'MERGED', url: 'https://gh/x/pull/9', number: 9 } };
  assert.equal(word(await rowFor(MERGED)), 'Merged');
});

test('closed (unmerged) PR: the row reads "PR closed", never "Merged" or "In review"', async () => {
  // Defense in depth: even if a stray CLOSED pr object reaches the client, the row must
  // not claim the work landed. (In practice the server now sends pr:null here.)
  const CLOSED = { ...DONE, id: 'pc', pr: { state: 'CLOSED', url: 'https://gh/x/pull/1', number: 1 } };
  assert.equal(word(await rowFor(CLOSED)), 'PR closed');
});

test('merged PR with branch gone (survived=false) still reads "Merged"', async () => {
  // The cited case: PR merged, the lookup is by remote head name, not local branch.
  const MERGED_GONE = {
    ...DONE, id: 'pmg', survived: false,
    pr: { state: 'MERGED', url: 'https://gh/x/pull/2', number: 2 },
  };
  assert.equal(word(await rowFor(MERGED_GONE)), 'Merged');
});

// The two merge-pill re-check tests moved to test/ui-history-shipit.test.mjs:
// the pill is detail-only now (`.hd .hist-merge`), and the PR is opened from the
// detail screen's ship-it modal rather than from the list card.

const SAME_MEMBER = { projectKey: DONE.projectKey, source: 'main', branch: 'worca-cc/feat-ps' };
// pr: null = "gh answered: no PR yet". DONE has no `pr` key, and paintHdPr returns early on
// pr === undefined (app.js:18309), which would make every "no Create PR" assertion below vacuous.
const SAME_MERGED = { ...DONE, id: 'ps', pr: null, branch: 'worca-cc/feat-ps', survived: false, sameAsSource: true,
  mergeBack: { merged: true, members: [{ ...SAME_MEMBER, merged: true, kind: null, reason: null, sha: 'a'.repeat(40) }] } };
const SAME_NOT = { ...SAME_MERGED, id: 'pn2', survived: true,
  mergeBack: { merged: false, members: [{ ...SAME_MEMBER, merged: false, kind: 'dirty', reason: 'main is checked out in /x/proj with 2 uncommitted change(s)', sha: null }] } };
const sameArms = (rows, pushes) => (url, opts) => {
  if (url.endsWith('/api/push')) { pushes.push(JSON.parse(opts.body)); return ok({ ok: true, remote: 'origin', branch: 'main' }); }
  return armsFor(rows)(url);
};

test('same-branch, merged back: Push replaces Create PR and posts /api/push; the header arrow points into the source', async () => {
  const pushes = [];
  const ctx = await boot({ fetchHandler: sameArms([SAME_MERGED], pushes) });
  ctx.showDetails(SAME_MERGED);
  await ctx.settle();
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .hd-pr').hidden, true);
  const push = doc.querySelector('#hist-detail .hd-push');
  assert.equal(push.hidden, false);
  assert.equal(push.textContent, 'Push main');
  assert.equal(doc.querySelector('#hist-detail .hd-base').textContent, 'main ←');
  push.click();
  await ctx.settle();
  assert.deepEqual(pushes[0], { projectKey: DONE.projectKey, projectDir: DONE.projectDir, id: 'ps' });
  assert.equal(push.textContent, 'Pushed to origin');
});

test('same-branch, not merged back: no Push, no Create PR, a banner with the reason and the manual commands', async () => {
  const ctx = await boot({ fetchHandler: sameArms([SAME_NOT], []) });
  ctx.showDetails(SAME_NOT);
  await ctx.settle();
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .hd-push').hidden, true);
  assert.equal(doc.querySelector('#hist-detail .hd-pr').hidden, true, 'no PR for a run on its source branch, even though its branch survived');
  // histPrEligible's `!p.sameAsSource` term, through glancePrInput (:24899): the branch survived, gh is
  // available and pr is null, so WITHOUT the term the headline would invite a PR ("…before you open a
  // pull request"). Red first: drop the term and see this fail.
  const glance = doc.querySelector('#hist-detail .hd-glance').textContent;
  assert.match(glance, /Review the changes in Diff/);
  assert.doesNotMatch(glance, /pull request|Ready to ship/);
  const banner = doc.querySelector('#hist-detail .merge-back-banner');
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /uncommitted change/);
  assert.match(banner.querySelector('code').textContent, /git switch 'main'\ngit merge 'worca-cc\/feat-ps'\ngit branch -d 'worca-cc\/feat-ps'/);
});
