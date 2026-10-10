// test/ui-history-workspace-pr.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { cardAlertOf } from './helpers/feedback.mjs';

// Workspace runs: one PR per AFFECTED member repo. The saved-run detail header's
// per-repo list and the workspace Ship-it dialog (per-repo rows, sequential POSTs,
// per-repo failure + retry, cross-linking). The old History list card and its
// Create-PR hop were retired when the Runs list replaced the History view.
//
// The harness below (boot … remotesCalls, openModal) is a verbatim copy of
// test/ui-history-shipit.test.mjs:1-228 — the suites do not import each other.
//
// boot()/settle()/go() are a deliberate local copy of
// test/ui-history-detail.test.mjs:25-96 — the suites do not import each other.
// prTokens()/dispatchPr() mirror test/ui-history-pr-phase.test.mjs:45-46.
//
// Each test gets a fresh DOM + a fresh module import (cache-busted) so module
// top-level state (pendingShipIt, shipItClose, histDetailState) can't leak.

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECT = '/tmp/proj';

async function boot({ fetchHandler, url = 'http://localhost:4317/' } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url });
  const { window } = dom;

  // jsdom doesn't implement scrollIntoView; the viewer modal calls it on open.
  window.Element.prototype.scrollIntoView = function () {};

  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() {
      this.readyState = 1;
      this._listeners = {};
      wsBox.ws = this;
    }
    send() {}
    close() {}
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    }
    dispatch(type, evt) {
      (this._listeners[type] || []).forEach((fn) => fn(evt));
    }
  };

  const calls = [];
  window.fetch = (u, opts) => {
    calls.push({ url: String(u), opts: opts || {} });
    if (fetchHandler) {
      const r = fetchHandler(String(u), opts || {});
      if (r) return r;
    }
    if (String(u).includes('/api/projects')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }),
    });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch {
      /* read-only global already present — leave it */
    }
  }
  globalThis.window = window;
  globalThis.document = window.document;

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0)); // let loadProjects/loadConfig settle

  return { window, calls, wsBox };
}

async function settle(window, n = 3) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

const KEY = 'proj-alpha-abcd1234';
const WKS_KEY = 'workspaces/team-a';
const ROW = {
  id: 'fcec04e8', projectKey: KEY, projectName: 'Alpha', projectDir: '/tmp/proj',
  title: 'Implement Log-UX Review Fixes', status: 'done',
  startedAt: '2026-08-17T20:54:42Z', branch: 'worca-cc/log-ux-fcec04e8',
  sourceBranch: 'feat/log-ux', survived: true, added: 12, removed: 3,
  totalCostUsd: 153.21, totalActiveMs: 6000000, mtime: 1,
  pauseReason: null, retainedWork: null, pr: null,     // resolved: no PR yet
};
// Fresh object per boot: a successful ship MUTATES the row it is handed
// (`record.pr = pr`, and the record IS the object in state.historyAll), so a
// shared const would hand the next test a run that already has an open PR.
const row = (over = {}) => ({ ...ROW, ...over });
const DETAIL = {
  state: {
    id: ROW.id, title: ROW.title, status: 'done', startedAt: ROW.startedAt,
    stepper: null, steps: [], subAgents: [], totalCostUsd: 153.21, totalActiveMs: 6000000,
    branch: { source: 'feat/log-ux', feature: ROW.branch, worktreeDir: '/tmp/wt' },
    prompt: 'Fix the log UX.',
  },
  results: null, overview: null, clarify: { questions: [], answers: [] },
  reviews: [], stepQuestions: [], artifacts: [], auditMarkdown: '# saved',
};
const RESULTS = {
  summary: {
    filesNew: 1, filesChanged: 13, filesDeleted: 0,
    linesAdded: 412, linesRemoved: 188, blockingIssues: 0, nitpicks: 0,
  },
  newFiles: [], changedFiles: [], keyThingsToCheck: [], nitpicks: [],
};

const DAY = 86400000;
const okBudget = () => ({
  pipelineLimitUsd: 5, totalLimitUsd: 50, resetPeriod: 'monthly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 12.5, allTimeSpendUsd: 12.5,
  remainingUsd: 37.5, blocked: false,
});

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const fail = (status, body) => Promise.resolve({ ok: false, status, json: async () => body });

const DETAIL_URL = `/api/history/${KEY}/${ROW.id}`;
const WKS_DETAIL_URL = `/api/workspaces/team-a/runs/${ROW.id}`;
const detailHash = `history/${KEY}/${ROW.id}`;
const wksDetailHash = `history/${WKS_KEY}/${ROW.id}`;

// ARM ORDER IS LOAD-BEARING (ui-history-routing.test.mjs:119-127): the detail URL
// is a PREFIX of the /log and /diff URLs, and `/api/history` is a prefix of the
// POST /api/history/pr enrichment call. Most-specific first, and every history arm
// matches with endsWith, never includes — except the remotes arm, whose URL carries
// a query string (it can never collide with the `/api/pr` endsWith matchers).
function historyArms(box) {
  return (url) => {
    if (/\/api\/pr\/remotes\?/.test(url)) return box.remotes ? ok(box.remotes) : fail(500, { error: 'git remote failed' });
    if (url.endsWith('/api/history/pr')) return ok({ ok: true });
    if (url.endsWith('/diff')) return fail(404, { error: 'no diff' });
    if (url.endsWith('/log')) return fail(404, { error: 'no log' });
    if (url.endsWith('/api/history')) return ok({ pipelines: box.rows, ghAvailable: box.gh });
    if (url.endsWith(DETAIL_URL) || url.endsWith(WKS_DETAIL_URL)) return ok(box.detail);
    if (url.endsWith('/api/budget')) return ok(box.budget);
    return null;
  };
}

async function bootShip({ rows = [row()], detail = DETAIL, gh = true, arms = null, deepLink = false, remotes = REMOTES } = {}) {
  const box = { rows, detail, gh, remotes, budget: okBudget() };
  const base = historyArms(box);
  const ctx = await boot({
    fetchHandler: (url, opts) => (arms && arms(url, opts, box)) || base(url, opts),
    url: deepLink ? `http://localhost:4317/#${detailHash}` : 'http://localhost:4317/',
  });
  ctx.box = box;
  ctx.prTokens = () => ctx.calls
    .filter((c) => c.url.endsWith('/api/history/pr') && c.opts.body)
    .map((c) => JSON.parse(c.opts.body).token);
  ctx.dispatchPr = (msg) => ctx.wsBox.ws.dispatch('message', {
    data: JSON.stringify({ type: 'history-pr', done: true, items: [], ...msg }),
  });
  return ctx;
}

async function openDetail(ctx, hash = detailHash) {
  go(ctx.window, hash);
  await settle(ctx.window);
}

const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

const modalOf = (w) => w.document.querySelector('#shipit-modal');
const isOpen = (w) => !modalOf(w).classList.contains('hidden');
const hdPr = (w) => w.document.querySelector('#hist-detail .hd-pr');
const hdPrLink = (w) => w.document.querySelector('#hist-detail .hd-pr-link');
const hdMerge = (w) => w.document.querySelector('#hist-detail .hd .hist-merge');
// `/api/pr/mergeable` does NOT endsWith('/api/pr'), so this counts creates only.
const prPosts = (ctx) => ctx.calls.filter((c) => c.url.endsWith('/api/pr') && c.opts.method === 'POST');

// Standard happy-path PR arm.
const prArm = (body) => (url, opts) => (
  url.endsWith('/api/pr') && opts.method === 'POST' ? ok(body) : null);
const PR_OK = { ok: true, url: 'https://x/pull/7', mergeable: 'MERGEABLE', existed: false };

// Shapes mirror GET /api/pr/remotes.
const remote = (name, owner, url) => ({ name, fetchUrl: url, pushUrl: url, host: 'github.com', owner, repo: 'repo', slug: `${owner}/repo` });
// A run outside a chain: `chain` is just its source; `branches` are each remote's
// remote-tracking branches (the server drops HEAD and the run's own branch only).
const REMOTES = { ok: true, remotes: [remote('origin', 'me', 'https://github.com/me/repo.git')],
  defaults: { pushRemote: 'origin', baseRemote: 'origin' }, remembered: null,
  chain: ['feat/log-ux'], defaultBase: 'feat/log-ux', branches: { origin: ['feat/log-ux', 'main'] } };
const FORK_REMOTES = { ok: true,
  remotes: [remote('origin', 'me', 'https://github.com/me/repo.git'), remote('upstream', 'up', 'git@github.com:up/repo.git')],
  defaults: { pushRemote: 'origin', baseRemote: 'upstream' }, remembered: null,
  chain: ['feat/log-ux'], defaultBase: 'feat/log-ux',
  branches: { origin: ['feat/log-ux', 'main'], upstream: ['feat/log-ux', 'main'] } };
// dev -> nb1 -> this run (started from nb1's feature branch `feat/log-ux`): the ROOT is the default.
const CHAIN_REMOTES = { ...FORK_REMOTES, chain: ['dev', 'nb1', 'feat/log-ux'], defaultBase: 'dev',
  branches: { origin: ['feat/log-ux', 'main', 'mine'], upstream: ['dev', 'main', 'nb1', 'release'] } };
const baseSelOf = (modal) => modal.querySelector('.shipit-base-branch');
// The pick's structure: [optgroup label | null for a bare option, [values]].
const groupsOf = (sel) => [...sel.children].map((c) => (c.tagName === 'OPTGROUP'
  ? [c.label, [...c.children].map((o) => o.value)] : [null, [c.value]]));
const remotesCalls = (ctx) => ctx.calls.filter((c) => /\/api\/pr\/remotes\?/.test(c.url));   // like prPosts above
const optionValues = (sel) => [...sel.options].map((o) => o.value);

// Open the detail screen and press its Create-PR button.
async function openModal(ctx) {
  await openDetail(ctx);
  const btn = hdPr(ctx.window);
  assert.equal(btn.hidden, false, 'an eligible, resolved run offers Create PR');
  click(ctx.window, btn);
  await settle(ctx.window);          // let the remotes fetch land before a test confirms
  return modalOf(ctx.window);
}

// ---- workspace fixtures -----------------------------------------------------
const member = (memberKey, name, over = {}) => ({
  memberKey, name, projectDir: `/tmp/${name}`, branch: `worca-cc/feat-${name}`, sourceBranch: 'main',
  survived: true, affected: true, added: 5, removed: 1, diffFrozen: true, pr: null, ...over,
});
const API = 'api-00000001', WEB = 'web-00000002', DOC = 'doc-00000003';
const wsRow = (members, over = {}) => row({ projectKey: WKS_KEY, target: 'workspace', workspaceName: 'Team A', members, pr: null, ...over });
const WS_DETAIL = { ...DETAIL, state: { ...DETAIL.state, target: 'workspace' },
  results: { summary: { filesNew: 1, filesChanged: 3, linesAdded: 12, linesRemoved: 2 },
    perProject: { [API]: { summary: { filesNew: 1, filesChanged: 1, linesAdded: 7, linesRemoved: 1 } },
                  [WEB]: { summary: { filesNew: 0, filesChanged: 2, linesAdded: 5, linesRemoved: 1 } } } } };
const cardOf = (w) => w.document.querySelector('#history .hist-card');
const hdRepos = (w) => w.document.querySelector('#hist-detail .hd-pr-repos');
const crossPosts = (ctx) => ctx.calls.filter((c) => c.url.endsWith('/api/pr/crosslink'));

test('detail header lists every member repo with its status', async () => {
  const OPS = 'ops-00000004', CLI = 'cli-00000005';
  const ctx = await bootShip({ detail: WS_DETAIL, rows: [wsRow([
    member(API, 'api', { pr: { state: 'MERGED', url: 'https://x/api/pull/1' } }), member(WEB, 'web'),
    member(DOC, 'doc', { affected: false }),
    member(OPS, 'ops', { survived: false }),                       // changed, but the branch is gone
    member(CLI, 'cli', { branch: null })])] });                   // changed, no branch info recorded
  await openDetail(ctx, wksDetailHash);
  const list = hdRepos(ctx.window);
  assert.equal(list.hidden, false);
  const lis = [...list.querySelectorAll('.hd-pr-repo')];
  // Name and status asserted separately (v2 review M2) ...
  assert.deepEqual(lis.map((li) => li.querySelector('b').textContent), ['api', 'web', 'doc', 'ops', 'cli']);
  assert.deepEqual(lis.map((li) => (li.querySelector('.hd-pr-repo-link, .hd-pr-repo-note') || {}).textContent),
    ['Merged', 'No PR yet', 'No changes — skipped', 'Branch no longer exists', 'No branch recorded']);
  // ... and the rendered line reads with a space between them (the ' ' text node).
  assert.equal(lis[0].textContent.replace(/\s+/g, ' ').trim(), 'api Merged');
  assert.equal(list.querySelector('.hd-pr-repo-link').href, 'https://x/api/pull/1');
  assert.equal(hdPr(ctx.window).hidden, false, 'web can still be shipped');
  assert.equal(hdPrLink(ctx.window).hidden, true, 'never the single-PR link');
});

test('dialog lists affected repos (ticked), says which were skipped, loads remotes per member', async () => {
  const ctx = await bootShip({ detail: WS_DETAIL, rows: [wsRow([member(API, 'api'), member(WEB, 'web'), member(DOC, 'doc', { affected: false })])] });
  await openDetail(ctx, wksDetailHash);
  click(ctx.window, hdPr(ctx.window)); await settle(ctx.window, 6);
  const modal = modalOf(ctx.window);
  assert.equal(isOpen(ctx.window), true);
  assert.equal(modal.querySelector('.shipit-summary').hidden, true);
  const rows = [...modal.querySelectorAll('#shipit-repos .shipit-repo')];
  assert.deepEqual(rows.map((r) => r.dataset.memberKey), [API, WEB]);
  assert.ok(rows.every((r) => r.querySelector('.shipit-repo-pick').checked), 'default: all affected');
  assert.match(modal.querySelector('.shipit-skipped').textContent, /No changes in doc — skipped/);
  assert.equal(rows[0].querySelector('.shipit-repo-stat').textContent, '2 files · +7 −1');
  const keys = remotesCalls(ctx).map((c) => new URL(c.url, 'http://x').searchParams.get('memberKey')).sort();
  assert.deepEqual(keys, [API, WEB]);
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Open 2 pull requests');
  rows[1].querySelector('.shipit-repo-pick').checked = false;
  rows[1].querySelector('.shipit-repo-pick').dispatchEvent(new ctx.window.Event('change'));
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Open 1 pull request');
});

test('partial failure: per-repo error, success kept, retry re-POSTs ONLY the failed repo, cross-links', async () => {
  let webFails = true;
  const arms = (url, opts) => {
    if (url.endsWith('/api/pr/crosslink')) return ok({ ok: true, edited: [API, WEB], failed: [] });
    if (!(url.endsWith('/api/pr') && opts.method === 'POST')) return null;
    const b = JSON.parse(opts.body);
    if (b.memberKey === WEB && webFails) return fail(500, { error: 'git push failed: denied' });
    return ok({ ok: true, url: `https://x/${b.memberKey}/pull/1`, mergeable: 'MERGEABLE', existed: false, memberKey: b.memberKey });
  };
  const ctx = await bootShip({ detail: WS_DETAIL, arms, rows: [wsRow([member(API, 'api'), member(WEB, 'web')])] });
  await openDetail(ctx, wksDetailHash);
  click(ctx.window, hdPr(ctx.window)); await settle(ctx.window, 6);
  const modal = modalOf(ctx.window);
  click(ctx.window, modal.querySelector('.shipit-ok')); await settle(ctx.window, 10);

  const bodies = prPosts(ctx).map((c) => JSON.parse(c.opts.body));
  assert.deepEqual(bodies.map((b) => [b.memberKey, b.projectKey, b.id]), [[API, WKS_KEY, ROW.id], [WEB, WKS_KEY, ROW.id]]);
  assert.equal(bodies[0].pushRemote, 'origin');
  assert.equal(isOpen(ctx.window), true, 'stays open on partial failure');
  const [apiRow, webRow] = modal.querySelectorAll('#shipit-repos .shipit-repo');
  assert.match(apiRow.querySelector('.shipit-repo-status').textContent, /View PR/);
  assert.equal(apiRow.querySelector('.shipit-repo-pick').disabled, true, 'an opened repo is done');
  assert.match(webRow.querySelector('.shipit-repo-status').textContent, /Could not open PR: git push failed: denied/);
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Retry 1 failed');
  assert.match(cardAlertOf(modal.querySelector('.shipit-card')).detail, /1 of 2 pull requests could not be opened/);
  assert.equal(crossPosts(ctx).length, 1, 'cross-linked after the round that opened api');
  assert.equal(hdRepos(ctx.window).querySelector('.hd-pr-repo-link').href, 'https://x/api-00000001/pull/1', 'header in step');

  webFails = false;
  click(ctx.window, modal.querySelector('.shipit-ok')); await settle(ctx.window, 10);
  const retry = prPosts(ctx).slice(2).map((c) => JSON.parse(c.opts.body).memberKey);
  assert.deepEqual(retry, [WEB], 'only the failed repo is retried');
  assert.equal(isOpen(ctx.window), false, 'closes once every picked repo succeeded');
  assert.equal(crossPosts(ctx).length, 2);
  assert.equal(hdPr(ctx.window).hidden, true, 'nothing left to ship');
});

test('histPrEligible: workspace eligibility is computed across members', async () => {
  const ctx = await bootShip();
  await openDetail(ctx);
  const { histPrEligible } = ctx.window.__np;
  const ws = (members) => ({ target: 'workspace', members });
  assert.equal(histPrEligible(ws([member(API, 'api', { affected: false }), member(WEB, 'web')])), true);
  assert.equal(histPrEligible(ws([member(WEB, 'web', { survived: false })])), false, 'branch gone');
  assert.equal(histPrEligible(ws([member(WEB, 'web', { pr: { state: 'OPEN', url: 'u' } })])), false, 'already has a PR');
  assert.equal(histPrEligible(ws([member(WEB, 'web', { affected: false })])), false, 'no changes');
  assert.equal(histPrEligible({ target: 'workspace' }), false, 'no member facts (legacy/lite row)');
});

// ---- Watch PR (#619) ----------------------------------------------------------
test('workspace Ship it: Watch PR resets on open and one snapshot applies to every member request', async () => {
  const arms = (url, opts) => {
    if (url.endsWith('/api/pr/crosslink')) return ok({ ok: true, edited: [], failed: [] });
    if (!(url.endsWith('/api/pr') && opts.method === 'POST')) return null;
    const b = JSON.parse(opts.body);
    // Unticking while the batch runs must not split it.
    modalOf(globalThis.window).querySelector('.shipit-watch-input').checked = false;
    return ok({ ok: true, url: `https://github.com/o/${b.memberKey}/pull/1`, mergeable: 'MERGEABLE', existed: false, memberKey: b.memberKey, watching: !!b.watch });
  };
  const ctx = await bootShip({ detail: WS_DETAIL, arms, rows: [wsRow([member(API, 'api'), member(WEB, 'web')])] });
  await openDetail(ctx, wksDetailHash);
  click(ctx.window, hdPr(ctx.window)); await settle(ctx.window, 6);
  let modal = modalOf(ctx.window);
  assert.equal(modal.querySelector('.shipit-watch-input').checked, false);
  modal.querySelector('.shipit-watch-input').checked = true;
  click(ctx.window, modal.querySelector('.shipit-cancel')); await settle(ctx.window);
  click(ctx.window, hdPr(ctx.window)); await settle(ctx.window, 6);
  modal = modalOf(ctx.window);
  assert.equal(modal.querySelector('.shipit-watch-input').checked, false, 'reset on the next open');
  modal.querySelector('.shipit-watch-input').checked = true;
  click(ctx.window, modal.querySelector('.shipit-ok')); await settle(ctx.window, 10);
  assert.deepEqual(prPosts(ctx).map((c) => [JSON.parse(c.opts.body).memberKey, JSON.parse(c.opts.body).watch]), [[API, true], [WEB, true]]);
});

test('workspace detail: each open member PR gets its own watch control and state', async () => {
  const states = { [API]: { watching: true, status: 'fixing', reason: null, activePipelineId: 'f1' },
    [WEB]: { watching: false, status: null, reason: null, activePipelineId: null } };
  const arms = (url, opts) => {
    if (/\/api\/pr\/watch\?/.test(url)) return ok(states[new URL(url, 'http://x').searchParams.get('memberKey')]);
    if (url.endsWith('/api/pr/watch') && opts.method === 'POST') return fail(500, { error: 'nope' });
    return null;
  };
  const ctx = await bootShip({ detail: WS_DETAIL, arms, rows: [wsRow([
    member(API, 'api', { pr: { state: 'OPEN', url: 'https://github.com/o/api/pull/1' } }),
    member(WEB, 'web', { pr: { state: 'OPEN', url: 'https://github.com/o/web/pull/2' } }),
    member(DOC, 'doc', { pr: { state: 'MERGED', url: 'https://github.com/o/doc/pull/3' } })])] });
  await openDetail(ctx, wksDetailHash); await settle(ctx.window, 6);
  const lis = [...hdRepos(ctx.window).querySelectorAll('.hd-pr-repo')];
  const stateOf = (li) => li.querySelector('.hd-pr-watch-state')?.textContent ?? null;
  assert.deepEqual(lis.map(stateOf), ['Fixing', '', null], 'merged members get no control');
  // Same level gate as the run-level control in the header.
  for (const el of lis[0].querySelectorAll('.hd-pr-watch, .hd-pr-watch-state')) assert.equal(el.dataset.minLevel, 'advanced');
  assert.equal(ctx.window.document.querySelector('#hist-detail .hd-header .hd-row1 .hd-pr-watch').hidden, true, 'no run-level control on a workspace');
  click(ctx.window, lis[1].querySelector('.hd-pr-watch')); await settle(ctx.window);
  assert.match(cardAlertOf(lis[1]).detail, /nope/);
  assert.equal(cardAlertOf(lis[0]), null, 'the alert belongs to the member row');
});

test('workspace detail: pr-watch-changed for the run\'s store key refetches only the named member', async () => {
  const arms = (url) => (/\/api\/pr\/watch\?/.test(url) ? ok({ watching: true, status: 'watching', reason: null, activePipelineId: null }) : null);
  const ctx = await bootShip({ detail: WS_DETAIL, arms, rows: [wsRow([
    member(API, 'api', { pr: { state: 'OPEN', url: 'https://github.com/o/api/pull/1' } }),
    member(WEB, 'web', { pr: { state: 'OPEN', url: 'https://github.com/o/web/pull/2' } })])] });
  await openDetail(ctx, wksDetailHash); await settle(ctx.window, 6);
  const gets = (mk) => ctx.calls.filter((c) => /\/api\/pr\/watch\?/.test(c.url) && new URL(c.url, 'http://x').searchParams.get('memberKey') === mk).length;
  const before = [gets(API), gets(WEB)];
  const send = (msg) => ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'pr-watch-changed', pipelineId: ROW.id, ...msg }) });
  send({ projectKey: KEY, memberKey: API });                  // a member's own project key is not the run's store key
  await settle(ctx.window);
  assert.deepEqual([gets(API), gets(WEB)], before);
  send({ projectKey: WKS_KEY, memberKey: API });
  await settle(ctx.window);
  assert.deepEqual([gets(API), gets(WEB)], [before[0] + 1, before[1]]);
});
