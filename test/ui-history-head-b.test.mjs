// test/ui-history-head-b.test.mjs
// The history row's design-B head (+ C's status icon): a tinted icon circle on
// the left carries the state family, the status word (with the pause reason
// inline) leads the meta line, the branch renders as source → feature, and the
// aside holds at most one primary action — secondary actions live behind the
// ⋯ overflow menu.
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
  const showHistory = () => { window.location.hash = 'history'; window.dispatchEvent(new window.Event('hashchange')); };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { window, showHistory, tick };
}
const list = (pipelines, ghAvailable = true) =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live: [], ghAvailable }) });

const base = (over = {}) => ({
  id: 'p1', title: 'Feat', status: 'done', startedAt: '2026-06-02T00:00:00Z',
  branch: 'worca-cc/feat-1', sourceBranch: 'dev', survived: true, pr: null,
  projectName: 'Proj', projectKey: 'proj-0000abcd', projectDir: '/x/proj', ...over,
});

test('status icon: family class + svg on the left, stripe class on the card', async () => {
  const { window, showHistory, tick } = await boot({
    fetchHandler: (url) => (url.includes('/api/history')
      ? list([base(), base({ id: 'p2', status: 'paused', pauseReason: 'cost_pipeline' }), base({ id: 'p3', status: 'error' })])
      : null),
  });
  showHistory(); await tick();
  const cards = [...window.document.querySelectorAll('#history .hist-card')];
  const fam = (c) => [c.classList.contains('hc-ok'), c.classList.contains('hc-warn'), c.classList.contains('hc-bad')];
  assert.deepEqual(fam(cards[0]), [true, false, false]);
  assert.deepEqual(fam(cards[1]), [false, true, false]);
  assert.deepEqual(fam(cards[2]), [false, false, true]);
  const ico = cards[0].querySelector('.hist-ico');
  assert.ok(ico.classList.contains('hi-ok'));
  assert.ok(ico.querySelector('svg'), 'icon is an svg, not text');
  assert.equal(ico.title, 'Done', 'tooltip carries the word the pill used to');
  assert.equal(cards[0].querySelector('.badge'), null, 'the text badge pill is gone');
  assert.equal(cards[0].querySelector('.hist-stat').textContent, 'Done');
  assert.equal(cards[2].querySelector('.hist-stat').textContent, 'Error');
});

test('branch pair renders source → feature; no source -> feature alone', async () => {
  const { window, showHistory, tick } = await boot({
    fetchHandler: (url) => (url.includes('/api/history')
      ? list([base(), base({ id: 'p2', sourceBranch: null })]) : null),
  });
  showHistory(); await tick();
  const cards = [...window.document.querySelectorAll('#history .hist-card')];
  assert.equal(cards[0].querySelector('.hist-branch').textContent, 'dev→worca-cc/feat-1');
  const solo = cards[1].querySelector('.hist-branch');
  assert.equal(solo.querySelector('.from'), null, 'no source span without a known source');
  assert.equal(solo.textContent, 'worca-cc/feat-1');
});

test('paused row: Resume is the one visible action; Create PR moves into the ⋯ menu', async () => {
  let prPosted = null;
  const { window, showHistory, tick } = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/history')) return list([base({ status: 'paused', pauseReason: 'user' })]);
      if (url.includes('/api/pr')) {
        prPosted = JSON.parse(opts.body);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ url: 'https://gh/x/pull/7', mergeable: 'MERGEABLE' }) });
      }
      return null;
    },
  });
  showHistory(); await tick();
  const card = window.document.querySelector('#history .hist-card');
  assert.equal(card.querySelector('.hist-resume').hidden, false, 'Resume visible');
  assert.equal(card.querySelector('.hist-pr').hidden, true, 'Create PR button hidden on a paused row');
  const more = card.querySelector('.hist-more');
  assert.equal(more.hidden, false, 'the ⋯ affordance is revealed');
  more.dispatchEvent(new window.Event('click', { bubbles: true }));
  const menu = card.querySelector('.hist-menu');
  assert.equal(menu.hidden, false, 'menu opens');
  const labels = [...menu.querySelectorAll('.hist-menu-item')].map((i) => i.textContent);
  assert.ok(labels.includes('Create PR'), 'Create PR lives in the menu');
  assert.ok(labels.includes('Copy branch name'), 'branch copy is offered');
  const item = [...menu.querySelectorAll('.hist-menu-item')].find((i) => i.textContent === 'Create PR');
  item.dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick(); await tick();
  assert.equal(prPosted.id, 'p1', 'menu item runs the same PR flow');
  const link = card.querySelector('.hist-pr-link');
  assert.ok(link, 'result control lands in the aside');
  assert.equal(link.getAttribute('href'), 'https://gh/x/pull/7');
  assert.equal(menu.hidden, true, 'menu closed after picking');
});

test('menu: Archive appears for finished rows and delegates to the detail button', async () => {
  let deleted = null;
  const { window, showHistory, tick } = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/history')) return list([base()]);
      if ((opts && opts.method) === 'DELETE') {
        deleted = String(url);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }
      return null;
    },
  });
  window.confirm = () => true;
  showHistory(); await tick();
  const card = window.document.querySelector('#history .hist-card');
  card.querySelector('.hist-more').dispatchEvent(new window.Event('click', { bubbles: true }));
  const item = [...card.querySelectorAll('.hist-menu-item')].find((i) => i.textContent === 'Archive');
  assert.ok(item, 'Archive is in the menu for a deletable entry');
  item.dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick(); await tick();
  assert.ok(deleted && deleted.includes('/api/runs/p1'), 'DELETE issued through the shared flow');
});

test('a document click closes an open ⋯ menu', async () => {
  const { window, showHistory, tick } = await boot({
    fetchHandler: (url) => (url.includes('/api/history') ? list([base()]) : null),
  });
  showHistory(); await tick();
  const card = window.document.querySelector('#history .hist-card');
  const more = card.querySelector('.hist-more');
  more.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(card.querySelector('.hist-menu').hidden, false);
  window.document.body.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(card.querySelector('.hist-menu').hidden, true, 'outside click closes');
  assert.equal(more.getAttribute('aria-expanded'), 'false');
});
