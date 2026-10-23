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
import { ICONS } from '../ui/public/icons.mjs';

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
// The row's state as the run model says it (data-state, the dot) and its PR chip's one word, if any.
const stateOf = (row) => row.dataset.state;
const chipOf = (row) => row.querySelector('.runs-pr-word')?.textContent || '';

test('PR states: OPEN is In review (links to the saved run), MERGED is Merged (even with the branch gone), CLOSED never Merged/In review', async () => {
  const OPEN = { ...DONE, id: 'po', pr: { state: 'OPEN', url: 'https://gh/x/pull/8', number: 8 } };
  const MERGED = { ...DONE, id: 'pm', pr: { state: 'MERGED', url: 'https://gh/x/pull/9', number: 9 } };
  // A closed PR (the history-pr enrichment sends one when the branch has no open or merged
  // PR, for the row's PR glyph): the row must not claim the work landed.
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
    { name: 'open PR: the row is In review and links to the saved run', run: () => {
      const row = rowFor(OPEN);
      assert.equal(stateOf(row), 'in-review');
      assert.equal(chipOf(row), 'Ready', 'the chip says the PR\'s own state');
      assert.equal(row.getAttribute('href'), `#history/${OPEN.projectKey}/po`, 'the row opens the run, not GitHub');
    } },
    // A workspace run never offers Create PR from the list — the Runs list shows only a
    // word, and PR eligibility (members vs primary-only) is asserted for the saved-run
    // detail screen in ui-history-shipit.test.mjs.
    { name: 'merged PR: the row is Merged', run: () => {
      assert.equal(stateOf(rowFor(MERGED)), 'merged');
      assert.equal(chipOf(rowFor(MERGED)), 'Merged');
    } },
    { name: 'closed (unmerged) PR: the chip reads "Closed", the row is never Merged or In review', run: () => {
      assert.equal(stateOf(rowFor(CLOSED)), 'ready');
      assert.equal(chipOf(rowFor(CLOSED)), 'Closed');
    } },
    { name: 'merged PR with branch gone (survived=false) is still Merged', run: () => {
      assert.equal(stateOf(rowFor(MERGED_GONE)), 'merged');
    } },
  ]);
});

// No PR yet: the list reads the run model (runs redesign §2.1), "Ready to ship" whatever PR host is configured.
// (The glance headline still says "Finished" when no host can open a PR: test/ui-run-glance.test.mjs.)
test('a run with no PR reads "Ready to ship" in the list, with or without a PR host', async () => {
  const READY = { ...DONE, id: 'pr0', pr: null, checks: 0, files: 3 };
  const wordWith = async (ghAvailable, prHosts) => {
    const ctx = await boot({ fetchHandler: armsFor([READY], ghAvailable, prHosts) });
    ctx.showRuns();
    await ctx.settle();
    const row = ctx.window.document.querySelector(`#runs-list .runs-row[data-kind="hist"][data-pipeline-id="${READY.id}"]`);
    assert.ok(row, 'the finished run is listed');
    return row.querySelector('.runs-row-sub').textContent.split(' · ')[0];
  };
  await checkRows([
    { name: 'gh available', run: async () => assert.equal(await wordWith(true, null), 'Ready to ship') },
    { name: 'only an Azure DevOps token', run: async () => assert.equal(await wordWith(false, { github: false, azure: true }), 'Ready to ship') },
    { name: 'no PR host at all', run: async () => assert.equal(await wordWith(false, { github: false, azure: false }), 'Ready to ship') },
  ]);
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
  // A publish status painted before the merge back deleted the branch: the page must not trust it.
  if (url.includes('/publish?')) return ok({ ok: true, members: [{ memberKey: null, name: null, branch: 'worca-cc/feat-ps', remote: null, state: 'unpublished', published: null }] });
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
  // The hidden branch was fast-forwarded into main and deleted: never offer its name, Publish or a copy.
  assert.equal(doc.querySelector('#hist-detail .hd-base').textContent, 'Merged into main');
  assert.equal(doc.querySelector('#hist-detail .hd-branch-copy').hidden, true);
  assert.equal(doc.querySelector('#hist-detail .hd-publish').hidden, true);
  assert.equal(doc.querySelector('#hist-detail .hd-glance .rd-page-branch-name').textContent, 'main');
  const cta = doc.querySelector('#hist-detail .hd-glance .rd-head-acts .rd-pr-slot [data-rd-cta]');
  assert.ok(cta, 'the card head offers Push');
  // PR controls (design system): Push is a primary .btn led by arrow-up, and the head says the header's words.
  assert.equal(cta.textContent, 'Push main');
  assert.ok(cta.classList.contains('btn-primary'), cta.className);
  for (const b of [push, cta]) assert.equal(b.querySelector(':scope > .ic svg').innerHTML, ICONS['arrow-up'], b.className);
  // Slice 3: the head's Push shares the header's flow (pushSourceFlow) and shows its outcome.
  assert.equal(doc.querySelector('#hist-detail .hd-glance .run-status').dataset.line, 'Ready to ship · in main here, not on the remote');
  cta.click();
  await ctx.settle();
  assert.deepEqual(pushes[0], { projectKey: DONE.projectKey, projectDir: DONE.projectDir, id: 'ps' });
  assert.equal(cta.textContent.trim(), 'Pushed to origin');
  assert.equal(cta.disabled, true);
});

test('same-branch, merged back: a failed Push says so in visible text (a toast), not only in the button title', async () => {
  const fail = (url, opts) => (url.endsWith('/api/push')
    ? Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'the remote rejected the push' }) })
    : sameArms([SAME_MERGED], [])(url, opts));
  const ctx = await boot({ fetchHandler: fail });
  ctx.showDetails(SAME_MERGED);
  await ctx.settle();
  const doc = ctx.window.document;
  const cta = doc.querySelector('#hist-detail .hd-glance .rd-head-acts .rd-pr-slot [data-rd-cta]');
  cta.click();
  await ctx.settle();
  assert.equal(cta.textContent.trim(), 'Push main');
  assert.equal(cta.disabled, false);
  const toast = [...doc.querySelectorAll('.toast.err')].find((t) => /Push failed/.test(t.textContent));
  assert.ok(toast, 'a visible Push failed toast');
  assert.match(toast.textContent, /the remote rejected the push/);
});

test('same-branch, not merged back: no Push; Create PR lands the work from its own branch; How to merge shows the reason and the manual commands', async () => {
  const ctx = await boot({ fetchHandler: sameArms([SAME_NOT], []) });
  ctx.showDetails(SAME_NOT);
  await ctx.settle();
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .hd-push').hidden, true);
  // The merge back was refused, so the work is on its own branch: a PR is how it lands (M6).
  assert.equal(doc.querySelector('#hist-detail .hd-pr').hidden, false, 'Create PR for a run that did not merge back');
  assert.equal(doc.querySelector('#hist-detail .hd-base').textContent, 'main →', 'the work did not flow into main');
  // Slice 3 (D12): no merge-back banner; the head's How to merge opens the commands in the viewer.
  assert.equal(doc.querySelector('#hist-detail .merge-back-banner'), null);
  const glance = doc.querySelector('#hist-detail .hd-glance');
  assert.equal(glance.querySelector('.run-status').dataset.line, 'Needs you · not merged back into main');
  assert.doesNotMatch(glance.querySelector('.rd-sheet').textContent, /worktree/i);
  glance.querySelector('.rd-head-acts [data-head="how-to-merge"]').click();
  assert.equal(doc.getElementById('viewer-title').textContent, 'How to merge');
  const text = doc.getElementById('viewer').textContent;
  assert.match(text, /uncommitted change/);
  assert.match(text, new RegExp(`^${DONE.projectName}: `, 'm'), 'the project by its name, not its store key');
  // Chained (a failed switch stops the rest), in the project dir, fast-forward only.
  assert.ok(text.split('\n').includes(
    "cd '/x/proj' && git switch 'main' && git merge --ff-only --no-overwrite-ignore 'worca-cc/feat-ps' && git branch -d 'worca-cc/feat-ps'"), text);
  assert.match(text, /Commit or stash your changes/);
});

test('How to merge: each refusal gets its own recipe (in-use runs in that worktree, diverged needs a real merge, missing re-creates the source, commit-failed has none)', async () => {
  const recipe = async (mb) => {
    const row = { ...SAME_NOT, id: `pk${mb.kind}`, mergeBack: { merged: false, members: [{ ...SAME_MEMBER, merged: false, sha: null, reason: 'r', paths: [], ...mb }] } };
    const ctx = await boot({ fetchHandler: sameArms([row], []) });
    ctx.showDetails(row);
    await ctx.settle();
    const doc = ctx.window.document;
    doc.querySelector('#hist-detail .hd-glance .rd-head-acts [data-head="how-to-merge"]').click();
    const text = doc.getElementById('viewer').textContent;
    const lines = text.split('\n');
    return { code: lines.find((l) => /^cd |^git /.test(l)) ?? null, text };
  };
  await checkRows([
    { name: 'in-use with the worktree', run: async () => assert.equal((await recipe({ kind: 'in-use', paths: ['/x/other wt'] })).code,
      "cd '/x/other wt' && git merge --ff-only --no-overwrite-ignore 'worca-cc/feat-ps' && git branch -d 'worca-cc/feat-ps'") },
    { name: 'in-use without one (rebase/bisect)', run: async () => assert.match((await recipe({ kind: 'in-use' })).text, /Finish or abort/) },
    { name: 'diverged', run: async () => assert.equal((await recipe({ kind: 'diverged' })).code,
      "cd '/x/proj' && git switch 'main' && git merge 'worca-cc/feat-ps' && git branch -d 'worca-cc/feat-ps'") },
    { name: 'missing', run: async () => assert.equal((await recipe({ kind: 'missing' })).code,
      "cd '/x/proj' && git branch 'main' 'worca-cc/feat-ps' && git branch -d 'worca-cc/feat-ps'") },
    { name: 'commit-failed', run: async () => {
      const r = await recipe({ kind: 'commit-failed' });
      assert.equal(r.code, null);
      assert.match(r.text, /Recover them first with Apply to branch\./);
    } },
  ]);
});
