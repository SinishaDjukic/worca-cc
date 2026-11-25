// test/ui-settings-chat-runs.test.mjs — Settings › Runs › "Chat runs: source branch": the card paints the stored mode
// (Ask me on the card when nothing is stored), every word comes from src/shared/chat-source-branch.mjs, Save posts
// exactly { chat: { sourceBranch } }, and a refused save shows the field error. Boot preamble from
// test/ui-settings-sync.test.mjs (house convention).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { fieldErrorText, edit } from './helpers/feedback.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { CHAT_SOURCE_BRANCH_SETTING, CHAT_SOURCE_BRANCH_ROW, CHAT_SOURCE_BRANCH_INFO, CHAT_SOURCE_BRANCH_LABELS } from '../src/shared/chat-source-branch.mjs';

const trackDom = useDomRelease(afterEach);
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const REFUSED = '“Chat runs: source branch” must be one of current, ask, require.';
// What GET /api/settings answers: chatPrefs() normalises sourceBranch, so nothing stored reads 'ask'.
const SETTINGS = { sync: { beforeRun: true, remote: 'origin', refreshMinutes: 10, onDiverged: 'ask' }, app: {}, theme: {},
  chat: { notify: {}, channels: {}, scriptTools: true, suggestions: true, summariseCommands: true, sourceBranch: 'ask' } };

async function boot({ postStatus = 200 } = {}) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const posts = [];
  const box = { settings: { ...SETTINGS } };
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (u.includes('/api/settings')) {
      if (method === 'POST') {
        const body = JSON.parse(opts.body);
        posts.push(body);
        if (postStatus !== 200) return Promise.resolve({ ok: false, status: postStatus, json: async () => ({ error: REFUSED, field: 'chat.sourceBranch' }) });
        if (body.chat) box.settings = { ...box.settings, chat: { ...box.settings.chat, ...body.chat } };
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...box.settings }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...box.settings }) });
    }
    if (u.includes('/api/budget'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelineLimitUsd: null, totalLimitUsd: null, resetPeriod: 'monthly', windowStartMs: 0, windowEndMs: 0, msUntilReset: 0, windowSpendUsd: 0, allTimeSpendUsd: 0, remainingUsd: null, blocked: false }) });
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  window.location.hash = 'settings';
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick(); await tick();
  return { window, doc: window.document, posts, tick };
}

test('the card sits on the Runs tab at every level, says everything in the shared words and paints ask when nothing is stored', async () => {
  const { doc } = await boot();
  const card = doc.getElementById('chat-runs-settings-card');
  assert.ok(card.closest('.settings-pane[data-tab="runs"]'), 'on the Runs tab');
  assert.equal(card.dataset.minLevel, 'simple');
  assert.equal(card.querySelector('h2').textContent, CHAT_SOURCE_BRANCH_SETTING);
  assert.equal(card.querySelector('label[for="chatRunsSourceBranch"]').textContent, CHAT_SOURCE_BRANCH_ROW);
  assert.equal(card.querySelector('.info-tip .tip-content').textContent, CHAT_SOURCE_BRANCH_INFO);
  const sel = doc.getElementById('chatRunsSourceBranch');
  assert.deepEqual([...sel.options].map((o) => [o.value, o.textContent]), Object.entries(CHAT_SOURCE_BRANCH_LABELS));
  assert.equal(sel.value, 'ask');
});

test('Save posts exactly { chat: { sourceBranch } }; a refused save shows the field error', async () => {
  const ok = await boot();
  edit(ok.window, ok.doc.getElementById('chatRunsSourceBranch'), 'current');
  ok.doc.getElementById('chatRunsSave').click();
  await ok.tick(); await ok.tick();
  assert.deepEqual(ok.posts.at(-1), { chat: { sourceBranch: 'current' } });
  assert.equal(ok.doc.getElementById('chatRunsSourceBranch').value, 'current');

  const bad = await boot({ postStatus: 400 });
  edit(bad.window, bad.doc.getElementById('chatRunsSourceBranch'), 'require');
  bad.doc.getElementById('chatRunsSave').click();
  await bad.tick(); await bad.tick();
  assert.equal(fieldErrorText(bad.doc.getElementById('chatRunsSourceBranch')), REFUSED);
});
