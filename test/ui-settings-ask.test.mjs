// test/ui-settings-ask.test.mjs
// Settings "Ask Worca" card: the GET paint, the exact save POST body (the two
// ask keys ALONE — never with root/budget), client-side validation, the server
// error surfacing, the No-cap checkbox (stored null = no cap) and Use defaults
// (the '' clear-to-default wire value). Boots the REAL app.js against the REAL
// index.html under jsdom (boot copied from test/ui-settings-budget.test.mjs:33-71,
// with its `onPost` hook replaced by a `postResponse` override).
// Everything is a fetch stub — nothing touches disk, so this suite deliberately
// does NOT sandbox HOME/WORCA_HOME.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

import { confirmDialog, cancelDialog, dialogText } from './helpers/confirm-modal.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { fieldErrorText, cardAlertOf, edit, lastToast } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

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

// GET /api/settings: the ask keys at their defaults (400 turns, no cost cap), no budget limits.
const GET_BODY = () => ({
  root: '/w', projectsRoot: '/p', projectsRootDefault: '/p', default: {}, chat: {},
  pipelineCostLimitUsd: null, totalCostLimitUsd: null, costLimitResetPeriod: 'monthly',
  askMaxTurns: 400, askMaxBudgetUsd: null,
  askWeb: { enabled: false, allowedDomains: [], search: null },
});

// The server's storage semantics: '' clears to the default (400 turns / no cap),
// null stays null ("no cap"), anything else is stored as posted.
const resolveAsk = (body) => {
  const out = {};
  if ('askMaxTurns' in body) out.askMaxTurns = body.askMaxTurns === '' ? 400 : body.askMaxTurns;
  if ('askMaxBudgetUsd' in body) out.askMaxBudgetUsd = body.askMaxBudgetUsd === '' ? null : body.askMaxBudgetUsd;
  return out;
};

// GET /api/ask/history: the counts the "Delete all chat history" flow quotes.
// `history` is MUTABLE — the DELETE arm zeroes it the way the server would, so
// the refetch after a delete paints the empty state.
// `get` overrides keys of the GET /api/settings body (and of the save response built from it).
async function boot({ postResponse, history = { threads: 3, worktrees: 2, attachments: 5, inFlight: 0 }, deleteResponse, get = {} } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
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
          || { ok: true, status: 200, json: async () => ({ ...GET_BODY(), ...get, ...resolveAsk(body) }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...GET_BODY(), ...get }) });
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

test('ui-settings-ask: GET paints the card (defaults: 400 turns, No cap ticked)', async () => {
  const { $, openSettings } = await boot();
  await openSettings();
  assert.equal($('#askMaxTurns').value, '400');
  assert.equal($('#askMaxBudgetUsd').value, '');
  assert.equal($('#askNoCap').checked, true, 'no cost cap by default');
  assert.equal($('#askMaxBudgetUsd').disabled, true);
});

const settle = async (tick, n = 4) => { for (let i = 0; i < n; i++) await tick(); };

const untickNoCap = ($) => {
  $('#askNoCap').checked = false;
  $('#askNoCap').dispatchEvent(new window.Event('change', { bubbles: true }));
};

test('ui-settings-ask: Save posts exactly the two ask keys', async () => {
  const { window, $, posts, tick, openSettings } = await boot();
  await openSettings();
  untickNoCap($);
  assert.equal($('#askMaxBudgetUsd').disabled, false, 'unticking No cap opens the amount field');
  edit(window, $('#askMaxTurns'), '55');
  edit(window, $('#askMaxBudgetUsd'), '3.5');
  $('#askLimitsSave').click();
  await settle(tick);
  assert.equal(posts.length, 1, 'exactly one POST');
  assert.deepEqual(posts[0], { askMaxTurns: 55, askMaxBudgetUsd: 3.5, chat: { scriptTools: true, suggestions: true, summariseCommands: true } });
  assert.equal($('#askLimitsSave').textContent, 'Saved');
  assert.ok($('#askLimitsSave').classList.contains('is-done'));
  assert.equal($('#askNoCap').checked, false, 'an amount turns the guard on');
  assert.equal($('#askMaxBudgetUsd').value, '3.5');
});

test('clearing ask limits: No cap ticked posts null and disables the field, unticked with an empty amount posts the clear value and paints No cap back, Use defaults posts empty strings', async () => {
  // One boot per row (cuts the count, not the time).
  await checkRows([
    { name: 'ui-settings-ask: No cap unticked with the amount left empty posts the clear value and paints No cap back', run: async () => {
      const { $, posts, tick, openSettings } = await boot();
      await openSettings();
      untickNoCap($);
      $('#askLimitsSave').click();
      await tick();
      assert.deepEqual(posts[0], { askMaxTurns: 400, askMaxBudgetUsd: '', chat: { scriptTools: true, suggestions: true, summariseCommands: true } });
      assert.equal($('#askNoCap').checked, true, 'an empty amount is the default: no cap');
      assert.equal($('#askMaxBudgetUsd').disabled, true);
    } },
    { name: 'ui-settings-ask: the No-cap checkbox disables the field and posts null', run: async () => {
      const { $, posts, tick, openSettings } = await boot();
      await openSettings();
      untickNoCap($);
      assert.equal($('#askMaxBudgetUsd').disabled, false);
      $('#askNoCap').checked = true;
      $('#askNoCap').dispatchEvent(new window.Event('change', { bubbles: true }));
      assert.equal($('#askMaxBudgetUsd').disabled, true);
      assert.equal($('#askLimitsSave').disabled, true, 'back to the stored values: nothing to save');
      edit(window, $('#askMaxTurns'), '55');
      $('#askLimitsSave').click();
      await tick();
      assert.deepEqual(posts[0], { askMaxTurns: 55, askMaxBudgetUsd: null, chat: { scriptTools: true, suggestions: true, summariseCommands: true } });
    } },
    { name: 'ui-settings-ask: Use defaults posts empty strings (the clear-to-default wire value)', run: async () => {
      const { $, posts, tick, openSettings } = await boot();
      await openSettings();
      $('#askMaxTurns').value = '55';
      untickNoCap($);
      $('#askMaxBudgetUsd').value = '3';
      $('#askLimitsReset').click();
      await tick();
      assert.deepEqual(posts[0], { askMaxTurns: '', askMaxBudgetUsd: '' });
      assert.equal($('#askMaxTurns').value, '400', 'painted back from the response defaults');
      assert.equal($('#askNoCap').checked, true, 'the default is no cap');
      assert.equal($('#askMaxBudgetUsd').disabled, true);
      assert.equal($('#askMaxBudgetUsd').value, '');
    } },
  ]);
});

test('ui-settings-ask: client validation short-circuits the POST', async () => {
  const { window, $, posts, tick, openSettings } = await boot();
  await openSettings();
  edit(window, $('#askMaxTurns'), '0');
  $('#askLimitsSave').click();
  await tick();
  assert.equal(posts.length, 0, 'out-of-range turns never reaches the server');
  assert.equal(fieldErrorText($('#askMaxTurns')), 'Enter a whole number from 1 to 500, or leave it blank.');
  assert.equal($('#askMaxTurns').getAttribute('aria-invalid'), 'true');
  assert.equal(window.document.activeElement, $('#askMaxTurns'));
  edit(window, $('#askMaxTurns'), '400');
  assert.equal(fieldErrorText($('#askMaxTurns')), '', 'editing the field clears its error');
  untickNoCap($);
  edit(window, $('#askMaxBudgetUsd'), '0.05');
  $('#askLimitsSave').click();
  await tick();
  assert.equal(posts.length, 0, 'sub-floor budget rejected too');
  assert.equal(fieldErrorText($('#askMaxBudgetUsd')), 'Enter an amount from 0.1 to 100, or tick No cap.');
});

test('a server 400 naming a field (turn limit or a web field) lands verbatim on that input: aria-invalid, focus, no card alert, Save stays enabled for the retry', async () => {
  // One boot per row (cuts the count, not the time).
  await checkRows([
    { name: 'ui-settings-ask: a server 400 lands verbatim on the field it names', run: async () => {
      const { window, $, tick, openSettings } = await boot({
        postResponse: { ok: false, status: 400, json: async () => ({ error: '“Turn limit” must be an integer between 1 and 500.', field: 'askMaxTurns' }) },
      });
      await openSettings();
      edit(window, $('#askMaxTurns'), '77');
      $('#askLimitsSave').click();
      await settle(tick);
      assert.equal(fieldErrorText($('#askMaxTurns')), '“Turn limit” must be an integer between 1 and 500.');
      assert.equal(cardAlertOf($('#ask-settings-card')), null, 'a field error is not also a card alert');
    } },
    { name: '#555 Ask limits: a server error naming a field lands on that input', run: async () => {
      const { window, $, tick } = await boot({ postResponse: { ok: false, status: 400,
        json: async () => ({ error: '“Turn limit” must be an integer between 1 and 500.', field: 'askMaxTurns' }) } });
      edit(window, $('#askMaxTurns'), '7');
      $('#askLimitsSave').click();
      await settle(tick);
      assert.equal($('#askMaxTurns').getAttribute('aria-invalid'), 'true');
      assert.equal(fieldErrorText($('#askMaxTurns')), '“Turn limit” must be an integer between 1 and 500.');
      assert.equal(window.document.activeElement, $('#askMaxTurns'));
      assert.equal($('#askLimitsSave').disabled, false, 'still dirty → Save stays enabled for the retry');
    } },
    { name: '#555 Ask limits: a server error on a web field lands on that field', run: async () => {
      const { window, $, tick, openSettings } = await boot({ postResponse: { ok: false, status: 400,
        json: async () => ({ error: '“Allowed domains”: "foo bar" is not a host name.', field: 'askWeb.allowedDomains' }) } });
      await openSettings();
      edit(window, $('#askWebDomains'), 'foo bar');
      $('#askLimitsSave').click();
      await settle(tick);
      assert.equal($('#askWebDomains').getAttribute('aria-label'), 'Allowed domains');
      assert.equal(fieldErrorText($('#askWebDomains')), '“Allowed domains”: "foo bar" is not a host name.');
    } },
  ]);
});

// ---- Chat history block ("Delete all chat history") ------------------------

test('clearing chat history: the button refetches counts and opens a danger confirm; Cancel deletes nothing, Confirm sends ONE DELETE /api/ask/threads and refreshes the counts', async () => {
  // One boot per row (cuts the count, not the time).
  await checkRows([
    { name: 'ui-settings-ask: the button refetches the counts, opens a danger confirm, and Cancel deletes nothing', run: async () => {
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
        'This permanently deletes all chat history:',
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
    } },
    { name: 'ui-settings-ask: Confirm sends ONE DELETE /api/ask/threads, reports the outcome and refreshes the counts', run: async () => {
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
      assert.deepEqual(lastToast(window.document), { tone: 'ok', title: 'Deleted 3 chats and 2 worktrees.', detail: '', action: '' });
      assert.equal($('#askHistoryMsg').textContent, '');
      assert.equal(historyGets.length, painted + 2, 'pre-dialog + post-delete refresh');
      assert.equal($('#askHistoryCounts').textContent, 'No saved chats.');
      assert.equal($('#askHistoryDelete').disabled, true);
    } },
  ]);
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
  assert.deepEqual(lastToast(window.document), { tone: 'err', title: 'database is locked', detail: '', action: '' });
  assert.equal($('#askHistoryMsg').textContent, '');
});

test('ui-settings-ask: the script toggle paints from chat prefs and rides the card\'s Save', async () => {
  const { window, $, posts, tick, openSettings } = await boot();
  await openSettings();
  const cb = $('#askScriptTools');
  assert.ok(cb, 'the toggle is mounted in the Chat card');
  assert.equal(cb.checked, true, 'an absent pref is ON');
  assert.equal($('#ask-script-tools-host').textContent.trim(), 'Create and run scripts');
  edit(window, cb, false);
  $('#askLimitsSave').click();
  await tick();
  assert.deepEqual(posts[0].chat, { scriptTools: false, suggestions: true, summariseCommands: true });
});

test('ui-settings-ask: the suggestions toggle paints from chat prefs and rides the card\'s Save', async () => {
  const { window, $, posts, tick, openSettings } = await boot();
  await openSettings();
  const cb = $('#askSuggestions');
  assert.ok(cb, 'the toggle is mounted in the Chat card');
  assert.equal(cb.checked, true, 'an absent pref is ON');
  assert.equal($('#ask-suggestions-host').textContent.trim(), 'Suggest a next prompt after each reply');
  edit(window, cb, false);
  $('#askLimitsSave').click();
  await tick();
  assert.deepEqual(posts[0].chat, { scriptTools: true, suggestions: false, summariseCommands: true });
});

test('the web section posts askWeb only when touched (trimmed, blank lines dropped)', async () => {
  // One boot per row (cuts the count, not the time).
  await checkRows([
    { name: 'ui-settings-ask: web fields paint, and a touched card posts askWeb (trimmed, blank lines dropped)', run: async () => {
      const { window, $, posts, tick, openSettings } = await boot({ get: { askWeb: { enabled: true, allowedDomains: ['docs.example.com', '*.mdn.io'], search: { url: 'https://s.example/?q={query}', key: '${BRAVE_API_KEY}', keyVar: 'BRAVE_API_KEY', keyHeader: 'X-Subscription-Token', keyPrefix: '' } } } });
      await openSettings();
      assert.equal($('#askWebEnabled').checked, true);
      assert.equal($('#askWebDomains').value, 'docs.example.com\n*.mdn.io');
      assert.equal($('#askWebSearchKey').value, '${BRAVE_API_KEY}');
      $('#askWebDomains').value = 'docs.example.com\n\n  new.example.org ';
      $('#askWebDomains').dispatchEvent(new window.Event('input', { bubbles: true }));
      $('#askWebSearchUrl').value = '';
      $('#askWebSearchUrl').dispatchEvent(new window.Event('input', { bubbles: true }));
      $('#askLimitsSave').click(); await tick();
      assert.deepEqual(posts[0].askWeb, { enabled: true, anyHost: false, allowedDomains: ['docs.example.com', 'new.example.org'], search: null });
    } },
    { name: 'ui-settings-ask: an untouched web section is not posted', run: async () => {
      const { window, $, posts, tick, openSettings } = await boot();
      await openSettings();
      edit(window, $('#askMaxTurns'), '55');
      $('#askLimitsSave').click(); await tick();
      assert.ok(!('askWeb' in posts[0]));
    } },
  ]);
});

test('web off posts an explicit off; "Any site, without asking" paints and posts anyHost', async () => {
  // One boot per row (cuts the count, not the time).
  await checkRows([
    { name: 'ui-settings-ask: toggling web off posts an explicit off', run: async () => {
      const { window, $, posts, tick, openSettings } = await boot();
      await openSettings();
      $('#askWebEnabled').checked = true; $('#askWebEnabled').dispatchEvent(new window.Event('change', { bubbles: true }));
      $('#askWebEnabled').checked = false; $('#askWebEnabled').dispatchEvent(new window.Event('change', { bubbles: true }));
      edit(window, $('#askMaxTurns'), '55');            // the web toggle is back where it was: make the card dirty
      $('#askLimitsSave').click(); await tick();
      assert.deepEqual(posts[0].askWeb, { enabled: false, anyHost: false, allowedDomains: [], search: null });
    } },
    { name: 'ui-settings-ask: "Any site, without asking" paints and posts anyHost', run: async () => {
      const { window, $, posts, tick, openSettings } = await boot({ get: { askWeb: { enabled: true, anyHost: true, allowedDomains: [], search: null } } });
      await openSettings();
      assert.equal($('#askWebAnyHost').checked, true);
      $('#askWebAnyHost').checked = false; $('#askWebAnyHost').dispatchEvent(new window.Event('change', { bubbles: true }));
      $('#askLimitsSave').click(); await tick();
      assert.equal(posts[0].askWeb.anyHost, false);
    } },
  ]);
});
