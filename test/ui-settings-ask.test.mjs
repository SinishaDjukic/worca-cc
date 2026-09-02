// test/ui-settings-ask.test.mjs
// Settings "Ask Worca" card: the GET paint, the exact save POST body (the two
// ask keys ALONE — never with root/budget), client-side validation, the server
// error surfacing, the No-cap checkbox (stored null = no cap) and Use defaults
// (the '' clear-to-default wire value). Boots the REAL app.js against the REAL
// index.html under jsdom (boot copied from test/ui-settings-budget.test.mjs:33-71,
// with its `onPost` hook replaced by a `postResponse` override).
// Everything is a fetch stub — nothing touches disk, so this suite deliberately
// does NOT sandbox HOME/WORCA_HOME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

import { confirmDialog, cancelDialog, dialogText } from './helpers/confirm-modal.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const DAY = 86400000;

// $41.23 of a $50 weekly cap — the /api/budget snapshot the readout renders.
const okBudget = () => ({
  pipelineLimitUsd: null, totalLimitUsd: 50, resetPeriod: 'weekly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 41.23, allTimeSpendUsd: 41.23,
  remainingUsd: 8.77, blocked: false,
});

// GET /api/settings: the ask keys at their defaults, no budget limits.
const GET_BODY = () => ({
  root: '/w', projectsRoot: '/p', projectsRootDefault: '/p', default: {}, chat: {},
  pipelineCostLimitUsd: null, totalCostLimitUsd: null, costLimitResetPeriod: 'monthly',
  askMaxTurns: 40, askMaxBudgetUsd: 2,
});

// The server's storage semantics: '' clears to the default, null stays null
// ("no cap"), anything else is stored as posted.
const resolveAsk = (body) => {
  const out = {};
  if ('askMaxTurns' in body) out.askMaxTurns = body.askMaxTurns === '' ? 40 : body.askMaxTurns;
  if ('askMaxBudgetUsd' in body) out.askMaxBudgetUsd = body.askMaxBudgetUsd === '' ? 2 : body.askMaxBudgetUsd;
  return out;
};

// GET /api/ask/history: the counts the "Delete all chat history" flow quotes.
// `history` is MUTABLE — the DELETE arm zeroes it the way the server would, so
// the refetch after a delete paints the empty state.
async function boot({ postResponse, history = { threads: 3, worktrees: 2, attachments: 5, inFlight: 0 }, deleteResponse } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const posts = [];
  const historyGets = [];
  const deletes = [];
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (u.includes('/api/ask/history')) {
      historyGets.push({ ...history });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...history }) });
    }
    if (u.endsWith('/api/ask/threads') && method === 'DELETE') {
      deletes.push(u);
      if (deleteResponse) return Promise.resolve(deleteResponse);
      const removed = { threads: history.threads, worktrees: history.worktrees };
      history.threads = 0; history.worktrees = 0; history.attachments = 0; history.inFlight = 0;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, removed, failed: [] }) });
    }
    if (u.includes('/api/settings')) {
      if ((opts.method || 'GET').toUpperCase() === 'POST') {
        const body = JSON.parse(opts.body);
        posts.push(body);
        return Promise.resolve(postResponse
          || { ok: true, status: 200, json: async () => ({ ...GET_BODY(), ...resolveAsk(body) }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => GET_BODY() });
    }
    if (u.includes('/api/budget'))
      return Promise.resolve({ ok: true, status: 200, json: async () => okBudget() });
    if (u.includes('/api/projects'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const $ = (sel) => window.document.querySelector(sel);
  const openSettings = async () => {
    window.location.hash = 'settings';
    window.dispatchEvent(new window.Event('hashchange'));
    await tick();
  };
  return { window, posts, historyGets, deletes, tick, $, openSettings };
}

test('ui-settings-ask: GET paints the card (defaults, no-cap unchecked)', async () => {
  const { $, openSettings } = await boot();
  await openSettings();
  assert.equal($('#askMaxTurns').value, '40');
  assert.equal($('#askMaxBudgetUsd').value, '2');
  assert.equal($('#askNoCap').checked, false);
  assert.equal($('#askMaxBudgetUsd').disabled, false);
});

test('ui-settings-ask: Save posts exactly the two ask keys', async () => {
  const { $, posts, tick, openSettings } = await boot();
  await openSettings();
  $('#askMaxTurns').value = '55';
  $('#askMaxBudgetUsd').value = '3.5';
  $('#askLimitsSave').click();
  await tick();
  assert.equal(posts.length, 1, 'exactly one POST');
  assert.deepEqual(posts[0], { askMaxTurns: 55, askMaxBudgetUsd: 3.5 });
  assert.match($('#askLimitsMsg').textContent, /Saved/);
});

test('ui-settings-ask: client validation short-circuits the POST', async () => {
  const { $, posts, tick, openSettings } = await boot();
  await openSettings();
  $('#askMaxTurns').value = '0';
  $('#askLimitsSave').click();
  await tick();
  assert.equal(posts.length, 0, 'out-of-range turns never reaches the server');
  assert.ok($('#askLimitsMsg').classList.contains('err'));
  $('#askMaxTurns').value = '40';
  $('#askMaxBudgetUsd').value = '0.05';
  $('#askLimitsSave').click();
  await tick();
  assert.equal(posts.length, 0, 'sub-floor budget rejected too');
});

test('ui-settings-ask: a server 400 lands verbatim', async () => {
  const { $, tick, openSettings } = await boot({
    postResponse: { ok: false, status: 400, json: async () => ({ error: 'askMaxTurns must be an integer between 1 and 500' }) },
  });
  await openSettings();
  $('#askMaxTurns').value = '77';
  $('#askLimitsSave').click();
  await tick();
  assert.equal($('#askLimitsMsg').textContent, 'askMaxTurns must be an integer between 1 and 500');
});

test('ui-settings-ask: the No-cap checkbox disables the field and posts null', async () => {
  const { $, posts, tick, openSettings } = await boot();
  await openSettings();
  $('#askNoCap').checked = true;
  $('#askNoCap').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal($('#askMaxBudgetUsd').disabled, true);
  $('#askLimitsSave').click();
  await tick();
  assert.deepEqual(posts[0], { askMaxTurns: 40, askMaxBudgetUsd: null });
});

test('ui-settings-ask: Use defaults posts empty strings (the clear-to-default wire value)', async () => {
  const { $, posts, tick, openSettings } = await boot();
  await openSettings();
  $('#askLimitsReset').click();
  await tick();
  assert.deepEqual(posts[0], { askMaxTurns: '', askMaxBudgetUsd: '' });
  assert.equal($('#askMaxTurns').value, '40', 'painted back from the response defaults');
});

// ---- Chat history block ("Delete all chat history") ------------------------

test('ui-settings-ask: the settings paint loads the chat-history counts; 0 chats disables the button', async () => {
  const a = await boot();
  await a.openSettings();
  await a.tick();
  assert.ok(a.historyGets.length >= 1, 'counts fetched when the view paints');
  assert.equal(a.$('#askHistoryCounts').textContent, '3 chats · 2 worktrees');
  assert.equal(a.$('#askHistoryDelete').disabled, false);
  assert.equal(a.$('#askHistoryDelete').textContent, 'Delete all chat history');
  const b = await boot({ history: { threads: 1, worktrees: 1, attachments: 0, inFlight: 0 } });
  await b.openSettings();
  await b.tick();
  assert.equal(b.$('#askHistoryCounts').textContent, '1 chat · 1 worktree');
  const c = await boot({ history: { threads: 0, worktrees: 0, attachments: 0, inFlight: 0 } });
  await c.openSettings();
  await c.tick();
  assert.equal(c.$('#askHistoryCounts').textContent, 'No saved chats.');
  assert.equal(c.$('#askHistoryDelete').disabled, true);
});

test('ui-settings-ask: the button refetches the counts, opens a danger confirm, and Cancel deletes nothing', async () => {
  const { window, $, historyGets, deletes, tick, openSettings } = await boot({
    history: { threads: 3, worktrees: 2, attachments: 5, inFlight: 1 },
  });
  await openSettings();
  await tick();
  const painted = historyGets.length;
  assert.ok(painted >= 1);
  $('#askHistoryDelete').click();
  await tick();
  assert.equal(historyGets.length, painted + 1, 'fresh counts BEFORE the dialog opens');
  const dlg = dialogText(window);
  assert.equal(dlg.title, 'Delete all chat history?');
  assert.equal(dlg.confirmLabel, 'Delete everything');
  assert.ok(window.document.getElementById('confirm-ok').classList.contains('danger'));
  assert.equal(dlg.message, [
    'This permanently deletes all Ask Worca chat history:',
    '• 3 chat threads and their transcripts',
    '• 2 git worktrees checked out for those chats (removed from their source repos)',
    '• 5 attachments',
    '• 1 chat currently in progress will be stopped',
    'Runs started from these chats are not affected. This cannot be undone.',
  ].join('\n'));
  await cancelDialog(window);
  assert.equal(deletes.length, 0, 'nothing on cancel');
  assert.equal($('#askHistoryCounts').textContent, '3 chats · 2 worktrees');
  assert.equal($('#askHistoryMsg').textContent, '');
});

test('ui-settings-ask: the confirm message pluralizes and drops zero lines', async () => {
  const { window, $, tick, openSettings } = await boot({
    history: { threads: 1, worktrees: 1, attachments: 1, inFlight: 0 },
  });
  await openSettings();
  await tick();
  $('#askHistoryDelete').click();
  await tick();
  assert.equal(dialogText(window).message, [
    'This permanently deletes all Ask Worca chat history:',
    '• 1 chat thread and its transcript',
    '• 1 git worktree checked out for that chat (removed from its source repo)',
    '• 1 attachment',
    'Runs started from these chats are not affected. This cannot be undone.',
  ].join('\n'));
  await cancelDialog(window);
});

test('ui-settings-ask: Confirm sends ONE DELETE /api/ask/threads, reports the outcome and refreshes the counts', async () => {
  const { window, $, historyGets, deletes, tick, openSettings } = await boot();
  await openSettings();
  await tick();
  const painted = historyGets.length;
  $('#askHistoryDelete').click();
  await tick();
  assert.equal(deletes.length, 0, 'no DELETE before the confirm');
  await confirmDialog(window);
  await tick();
  assert.equal(deletes.length, 1, 'exactly one bulk DELETE');
  assert.equal($('#askHistoryMsg').textContent, 'Deleted 3 chats and 2 worktrees.');
  assert.ok(!$('#askHistoryMsg').classList.contains('err'));
  assert.equal(historyGets.length, painted + 2, 'pre-dialog + post-delete refresh');
  assert.equal($('#askHistoryCounts').textContent, 'No saved chats.');
  assert.equal($('#askHistoryDelete').disabled, true);
});

test('ui-settings-ask: a failed bulk DELETE lands its error in the hint', async () => {
  const { window, $, tick, openSettings } = await boot({
    deleteResponse: { ok: false, status: 500, json: async () => ({ error: 'database is locked' }) },
  });
  await openSettings();
  await tick();
  $('#askHistoryDelete').click();
  await tick();
  await confirmDialog(window);
  await tick();
  assert.equal($('#askHistoryMsg').textContent, 'database is locked');
  assert.ok($('#askHistoryMsg').classList.contains('err'));
});
