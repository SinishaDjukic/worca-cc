// test/ui-running-list.test.mjs — what the Running LIST contains, and the inert
// "waiting on your answers" banner above it. Card anatomy is not this suite's
// business (see test/ui-running-card.test.mjs); membership and chrome are.
//
// boot() is a deliberate local copy of test/ui-running-order.test.mjs:14-50 and
// go() of test/ui-history-routing.test.mjs:93-96; live() is copied from
// test/ui-pipeline-tabs.test.mjs:38-41. The suites do not import each other.
// ruleBody() is the CSS-as-text idiom from test/ui-run-flow-css.test.mjs:17-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath  = fileURLToPath(new URL('../ui/public/app.js',   import.meta.url));
const cssPath  = fileURLToPath(new URL('../ui/public/style.css', import.meta.url));
const PROJECT = '/tmp/proj';

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};   // jsdom has no layout
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    if (u.includes('/api/resume')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, runId: 'r-new', pipelineId: 'p1' }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);  // cache-bust: fresh module each test
  await new Promise((r) => setTimeout(r, 0));                    // let loadProjects/loadConfig settle
  const np = window.__np;
  // WS is created at import time (connectWS()) → lastWs is set now.
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  const selectProject = () => {
    const s = window.document.querySelector('#projectSelect');
    s.value = PROJECT;
    s.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { window, np, recv, selectProject, tick };
}

function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

const live = (runId, extra = {}) => ({
  runId, title: runId, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});

const QUESTION = { id: 'q1', kind: 'clarify', questions: [{ question: 'which db?', options: ['pg'] }] };

const cardIds = (window) =>
  [...window.document.querySelectorAll('#run-list .run-card')].map((c) => c.dataset.runId);
const bannerOf = (window) => window.document.querySelector('.run-ask-banner');

test('workspace scans and agent generations no longer render as run cards', async () => {
  const { window, recv, tick } = await boot();
  go(window, 'running');
  recv({ type: 'hello', runs: [
    live('scan-1', { kind: 'scan' }),
    live('gen-1', { kind: 'agentgen' }),
    live('pipe-1'),
    live('ws-1', { kind: 'workspace-run' }),
  ] });
  await tick();
  assert.deepEqual(cardIds(window).sort(), ['pipe-1', 'ws-1'],
    'only kind run | workspace-run render — Running is pipelines only');
});

test('a lone scan leaves the running list on its empty state', async () => {
  const { window, recv, tick } = await boot();
  go(window, 'running');
  recv({ type: 'hello', runs: [live('scan-1', { kind: 'scan' })] });
  await tick();
  assert.equal(cardIds(window).length, 0);
  assert.ok(window.document.querySelector('#run-list .run-empty'), 'the empty state renders');
});

test('the ask banner stays hidden while nothing is waiting', async () => {
  const { window, recv, tick } = await boot();
  go(window, 'running');
  recv({ type: 'hello', runs: [live('pipe-1')] });
  await tick();
  const banner = bannerOf(window);
  assert.ok(banner, 'the Running view carries an ask banner');
  assert.equal(banner.hidden, true);
});

test('one waiting pipeline renders the singular banner directly above the list', async () => {
  const { window, recv, tick } = await boot();
  go(window, 'running');
  recv({ type: 'hello', runs: [live('pipe-1', { pendingQuestion: QUESTION }), live('pipe-2')] });
  await tick();
  const banner = bannerOf(window);
  assert.equal(banner.hidden, false);
  assert.equal(banner.querySelector('.rab-text').textContent, '1 pipeline is waiting on your answers');
  assert.equal(banner.querySelector('.rab-mark').textContent, '?');
  assert.equal(banner.nextElementSibling.id, 'run-list', 'the banner sits directly above #run-list');
});

test('two waiting pipelines render the plural banner, and it clears when they are answered', async () => {
  const { window, recv, tick } = await boot();
  go(window, 'running');
  recv({ type: 'hello', runs: [
    live('pipe-1', { pendingQuestion: QUESTION }),
    live('pipe-2', { pendingQuestion: { ...QUESTION, id: 'q2' } }),
  ] });
  await tick();
  assert.equal(bannerOf(window).querySelector('.rab-text').textContent,
    '2 pipelines are waiting on your answers');

  recv({ type: 'question-resolved', runId: 'pipe-1', id: 'q1' });
  await tick();
  assert.equal(bannerOf(window).querySelector('.rab-text').textContent,
    '1 pipeline is waiting on your answers');

  recv({ type: 'question-resolved', runId: 'pipe-2', id: 'q2' });
  await tick();
  assert.equal(bannerOf(window).hidden, true, 'the banner hides once nothing is waiting');
});

test('the ask banner is deliberately inert', async () => {
  const { window, recv, tick } = await boot();
  go(window, 'running');
  recv({ type: 'hello', runs: [live('pipe-1', { pendingQuestion: QUESTION })] });
  await tick();
  const banner = bannerOf(window);
  assert.equal(banner.getAttribute('role'), null, 'no role=button');
  assert.equal(banner.getAttribute('tabindex'), null, 'not focusable');
  const before = window.location.hash;
  banner.dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick();
  assert.equal(window.location.hash, before, 'clicking the banner navigates nowhere');
});

test('.run-ask-banner is an amber flex row whose [hidden] beats the author display rule', () => {
  const css = readFileSync(cssPath, 'utf8');
  // Anchored, as in test/ui-running-routing.test.mjs:28-32 — an unanchored
  // first match reads `.a > .b{` as a hit for `.b`.
  const ruleBody = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
    return m ? m[1] : null;
  };
  assert.match(ruleBody(':root'), /--amber-wash:\s*#FEF7EC/i,
    'C3: this task owns the --amber-wash declaration');
  const body = ruleBody('.run-ask-banner');
  assert.ok(body, '.run-ask-banner rule missing');
  assert.match(body, /display:\s*flex/);
  assert.match(body, /background:\s*var\(--amber-wash\)/);
  assert.match(body, /border:\s*1px solid var\(--amber\)/);
  const hid = ruleBody('.run-ask-banner[hidden]');
  assert.ok(hid, '.run-ask-banner[hidden] rule missing');
  assert.match(hid, /display:\s*none/, 'author display:flex would otherwise beat the UA [hidden] rule');
  assert.match(ruleBody('.run-ask-banner .rab-mark'), /width:\s*26px/);
});
