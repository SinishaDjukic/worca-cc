// test/ui-history-pr.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const selectProject = () => {
    const sel = window.document.querySelector('#projectSelect');
    sel.value = PROJECT; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const showHistory = () => { window.location.hash = 'history'; window.dispatchEvent(new window.Event('hashchange')); };
  return { window, selectProject, showHistory };
}
const runs = (pipelines, ghAvailable) => Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live: [], ghAvailable }) });

const SURVIVED = {
  id: 'p1', title: 'Feat', status: 'stopped', startedAt: '2026-06-02T00:00:00Z',
  branch: 'worca-cc/feat-1', sourceBranch: 'main', survived: true, added: 12, removed: 5,
  projectName: 'Proj', projectKey: 'proj-0000abcd', projectDir: '/x/proj',
};

// Minimal detail payload for the one test that follows the card through to the
// detail screen. Shape per readPipelineByKey: 8 keys, `results`/`overview` null.
const DETAIL = {
  state: {
    id: SURVIVED.id, title: SURVIVED.title, status: 'stopped', startedAt: SURVIVED.startedAt,
    stepper: null, steps: [], subAgents: [],
    branch: { source: 'main', feature: SURVIVED.branch },
  },
  results: null, overview: null, clarify: { questions: [], answers: [] },
  reviews: [], stepQuestions: [], artifacts: [], auditMarkdown: '',
};

test('survived entry: source → destination branch line + green/red diff chip', async () => {
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.includes('/api/history') ? runs([SURVIVED], true) : null),
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  const row = card.querySelector('.h-meta .hist-branch');
  assert.equal(row.hidden, false);
  assert.equal(row.querySelector('.hist-branch-src').textContent, 'main');
  assert.equal(row.querySelector('.hist-branch-src').hidden, false);
  // The arrow is an SVG element: no `hidden` IDL property, so assert on the
  // ATTRIBUTE — a `.hidden = false` expando would pass while Chrome still hides it.
  assert.equal(row.querySelector('.hist-branch-arrow').hasAttribute('hidden'), false);
  assert.equal(row.querySelector('.hist-branch-dst').textContent, 'worca-cc/feat-1');
  assert.equal(row.querySelector('.hist-branch-copy').hidden, false);
  assert.equal(card.querySelector('.hist-diff .diff-add').textContent, '+12');
  assert.equal(card.querySelector('.hist-diff .diff-del').textContent, '−5');
});

test('legacy entry without sourceBranch: destination only, no arrow', async () => {
  const LEGACY = { ...SURVIVED, id: 'pl', sourceBranch: null };
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.includes('/api/history') ? runs([LEGACY], true) : null),
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const row = window.document.querySelector('#history .hist-card .h-meta .hist-branch');
  assert.equal(row.hidden, false);
  assert.equal(row.querySelector('.hist-branch-src').hidden, true);
  assert.equal(row.querySelector('.hist-branch-arrow').hasAttribute('hidden'), true);
  assert.equal(row.querySelector('.hist-branch-dst').textContent, 'worca-cc/feat-1');
});

test('entry without a feature branch hides the whole branch row', async () => {
  const NOBRANCH = { ...SURVIVED, id: 'pn', branch: null, sourceBranch: null, survived: false };
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.includes('/api/history') ? runs([NOBRANCH], true) : null),
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const row = window.document.querySelector('#history .hist-card .h-meta .hist-branch');
  assert.equal(row.hidden, true);
});

test('copy button copies the destination branch and does not navigate', async () => {
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.includes('/api/history') ? runs([SURVIVED], true) : null),
  });
  let copied = null;
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: (t) => { copied = t; return Promise.resolve(); } },
    configurable: true,
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  const btn = card.querySelector('.hist-branch-copy');
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(copied, 'worca-cc/feat-1');
  assert.equal(window.location.hash.replace(/^#/, ''), 'history',
    'copy click must not navigate to the detail screen');
});

test('Create-PR shows when gh available; click navigates to the detail page and arms the ship-it modal', async () => {
  const prPosts = [];
  const { window, showHistory } = await boot({
    fetchHandler: (url, opts) => {
      // MOST-SPECIFIC FIRST. Two prefix traps here, both real:
      //  - the keyed detail URL `/api/history/proj-0000abcd/p1` STARTS WITH
      //    `/api/history/pr` (the key begins "pro"), so the enrichment arm must
      //    match with endsWith;
      //  - `/api/projects`.includes('/api/pr') is true, so the create arm must too.
      if (url.endsWith('/api/history/pr')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      if (url.endsWith(`/api/history/${SURVIVED.projectKey}/${SURVIVED.id}`)) {
        return Promise.resolve({ ok: true, status: 200, json: async () => DETAIL });
      }
      if (url.endsWith('/api/history')) return runs([{ ...SURVIVED, pr: null }], true);
      if (url.endsWith('/api/pr') && opts.method === 'POST') {
        prPosts.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, url: 'https://gh/x/pull/3', mergeable: 'MERGEABLE' }) });
      }
      return null;
    },
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  const btn = card.querySelector('.hist-pr');
  assert.equal(btn.hidden, false, 'button visible when gh available');
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

  assert.equal(window.location.hash.replace(/^#/, ''), `history/${SURVIVED.projectKey}/${SURVIVED.id}`,
    'the list button navigates to the detail page');
  assert.equal(window.document.querySelector('#shipit-modal').classList.contains('hidden'), false,
    'the pending ship-it intent auto-opens the modal on arrival');
  assert.equal(prPosts.length, 0, 'the list card itself never fires POST /api/pr');
});

test('a workspace run never offers Create PR on the list card', async () => {
  // POST /api/pr has no workspace arm and its key regex rejects a `workspaces/…`
  // composite with a 404, so histPrEligible excludes them even though this row
  // satisfies every other clause.
  const WKS = {
    ...SURVIVED, id: 'w1', projectKey: 'workspaces/team-a', target: 'workspace',
    workspaceName: 'Team A', pr: null,
  };
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.endsWith('/api/history') ? runs([WKS], true) : null),
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  assert.equal(card.querySelector('.hist-pr').hidden, true, 'no Create-PR button for a workspace run');
  assert.equal(card.querySelector('.hist-pr-link'), null, 'and no PR link either');
});

test('button hidden when gh unavailable, and for non-survived branches', async () => {
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.includes('/api/history')
      ? runs([SURVIVED, { ...SURVIVED, id: 'p2', survived: false }], false) : null),
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const cards = window.document.querySelectorAll('#history .hist-card');
  assert.equal(cards[0].querySelector('.hist-pr').hidden, true, 'gh unavailable hides button');
  assert.equal(cards[1].querySelector('.hist-diff').textContent, '', 'non-survived shows no diff');
});

test('open PR: no Create-PR button, shows a "View PR" link to the existing PR', async () => {
  const OPEN = { ...SURVIVED, id: 'po', pr: { state: 'OPEN', url: 'https://gh/x/pull/8', number: 8 } };
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.includes('/api/history') ? runs([OPEN], true) : null),
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  assert.equal(card.querySelector('.hist-pr'), null, 'Create-PR button is gone');
  const link = card.querySelector('.hist-pr-link');
  assert.equal(link.getAttribute('href'), 'https://gh/x/pull/8');
  assert.equal(link.textContent, 'View PR');
});

test('merged PR: shows a "Merged" link, no button', async () => {
  const MERGED = { ...SURVIVED, id: 'pm', pr: { state: 'MERGED', url: 'https://gh/x/pull/9', number: 9 } };
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.includes('/api/history') ? runs([MERGED], true) : null),
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  assert.equal(card.querySelector('.hist-pr'), null);
  const link = card.querySelector('.hist-pr-link');
  assert.equal(link.textContent, 'Merged');
  assert.equal(link.getAttribute('href'), 'https://gh/x/pull/9');
});

test('closed (unmerged) PR is treated as none: Create-PR button still shows', async () => {
  // Defense in depth: even if a stray CLOSED pr object reaches the client, the UI
  // must not hide the button. (In practice the server now sends pr:null here.)
  const CLOSED = { ...SURVIVED, id: 'pc', pr: { state: 'CLOSED', url: 'https://gh/x/pull/1', number: 1 } };
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.includes('/api/history') ? runs([CLOSED], true) : null),
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  assert.equal(card.querySelector('.hist-pr').hidden, false, 'button visible for a closed/unmerged PR');
  assert.equal(card.querySelector('.hist-pr-link'), null);
});

test('merged PR with branch gone (survived=false) still shows the Merged link', async () => {
  // The cited case: PR merged, the lookup is by remote head name, not local branch.
  const MERGED_GONE = {
    ...SURVIVED, id: 'pmg', survived: false,
    pr: { state: 'MERGED', url: 'https://gh/x/pull/2', number: 2 },
  };
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.includes('/api/history') ? runs([MERGED_GONE], true) : null),
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  assert.equal(card.querySelector('.hist-pr'), null);
  assert.equal(card.querySelector('.hist-pr-link').textContent, 'Merged');
});

// The two merge-pill re-check tests moved to test/ui-history-shipit.test.mjs:
// the pill is detail-only now (`.hd .hist-merge`), and the PR is opened from the
// detail screen's ship-it modal rather than from the list card.
