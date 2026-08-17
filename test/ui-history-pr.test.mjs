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

// The +X/−Y chip beside Create PR was removed (a raw line delta there answered
// nothing); the branch line shows the pair: greyed source → emphasised feature.
test('survived entry: branch pair under meta, and no line-delta chip', async () => {
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.includes('/api/history') ? runs([SURVIVED], true) : null),
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  const branch = card.querySelector('.h-meta .hist-branch');
  assert.equal(branch.querySelector('.from').textContent, 'main', 'source branch first');
  assert.equal(branch.querySelector('.arr').textContent, '→');
  assert.equal(branch.querySelector('.to').textContent, 'worca-cc/feat-1', 'feature branch emphasised');
  assert.equal(card.querySelector('.hist-diff'), null, 'no +X/−Y chip in the head');
});

test('Create-PR button shows when gh available; click opens PR + merge pill', async () => {
  let prBody = null;
  const { window, showHistory } = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/history')) return runs([{ ...SURVIVED, pr: null }], true);
      // NOTE: match the exact path — `/api/projects`.includes('/api/pr') is true,
      // so a loose substring check would swallow the project-list fetch.
      if (url.endsWith('/api/pr')) {
        prBody = JSON.parse(opts.body);
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
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(prBody.id, 'p1');
  const link = card.querySelector('.hist-pr-link');
  assert.equal(link.getAttribute('href'), 'https://gh/x/pull/3');
  const pill = card.querySelector('.hist-merge');
  assert.equal(pill.hidden, false);
  assert.ok(pill.classList.contains('ok'));
  assert.match(pill.textContent, /can merge/);
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
  assert.equal(cards[1].querySelector('.hist-diff'), null, 'no diff chip on any row');
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
  assert.equal(link.textContent, 'View PR ↗');
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
  assert.equal(link.textContent, '✓ Merged');
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
  assert.equal(card.querySelector('.hist-pr-link').textContent, '✓ Merged');
});

test('open PR still checking: a delayed re-check updates the stuck pill', async () => {
  let recheckBody = null;
  const { window, showHistory } = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/history')) return runs([{ ...SURVIVED, pr: null }], true);
      if (url.endsWith('/api/pr/mergeable')) {
        recheckBody = JSON.parse(opts.body);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, mergeable: 'MERGEABLE' }) });
      }
      if (url.endsWith('/api/pr')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, url: 'https://gh/x/pull/3', mergeable: 'UNKNOWN' }) });
      }
      return null;
    },
  });
  window.__prMergeRecheckMs = 0;               // fire the re-check on the next tick (no fake timers)
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  card.querySelector('.hist-pr').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));   // PR opened -> pill paints "checking…"
  const pill = card.querySelector('.hist-merge');
  assert.ok(pill.classList.contains('unknown'), 'pill starts as checking…');
  assert.match(pill.textContent, /checking/);
  // let the re-check timer fire and its fetch + json resolve + apply (timer + 2 awaits)
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  assert.equal(recheckBody.id, 'p1', 're-check posted the same pipeline id');
  assert.ok(pill.classList.contains('ok'), 'pill updated to can-merge after re-check');
  assert.match(pill.textContent, /can merge/);
});

test('open PR still checking: re-check still unknown -> pill is hidden, not stuck', async () => {
  const { window, showHistory } = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) return runs([{ ...SURVIVED, pr: null }], true);
      if (url.endsWith('/api/pr/mergeable')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, mergeable: 'UNKNOWN' }) });
      }
      if (url.endsWith('/api/pr')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, url: 'https://gh/x/pull/4', mergeable: 'UNKNOWN' }) });
      }
      return null;
    },
  });
  window.__prMergeRecheckMs = 0;
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  card.querySelector('.hist-pr').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const pill = card.querySelector('.hist-merge');
  assert.equal(pill.hidden, false, 'pill shows checking… first');
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  assert.equal(pill.hidden, true, 'still-unknown pill is hidden, not left stuck');
});
