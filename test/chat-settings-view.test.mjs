// test/chat-settings-view.test.mjs — pure renderers for the Settings
// "Chat notifications" card (design §4.8): render + collect round-trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderChatSettings, collectChatSettings, renderScriptToolsToggle, collectScriptToolsToggle, renderSuggestionsToggle, collectSuggestionsToggle, renderSummariesToggle, collectSummariesToggle, renderAskWebFields } from '../ui/public/chat-settings-view.mjs';
import { applyFlags } from '../ui/public/flags.mjs';
import { readFileSync } from 'node:fs';
import { checkRows } from './helpers/rows.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

const CHANNELS = [
  { plugin: 'telegram-chat', channelId: 'main', displayName: 'Telegram', platform: 'telegram', state: 'connected', detail: null },
  { plugin: 'teams-chat', channelId: 'main', displayName: 'Teams', platform: 'teams', state: 'unconfigured', detail: 'missing config: appId' },
];

test('chat settings render and round-trip, including the Chat script toggle', async () => {
  await checkRows([
    { name: 'chat settings: render from prefs + channels, collect round-trips edits, empty list hint', run: async () => {
      await checkRows([
        { name: 'renders event checkboxes from prefs and channel rows with state badges', run: () => {
          const el = renderChatSettings({
            prefs: { notify: { done: true, error: true, question: false, paused: true }, channels: { 'teams-chat/main': { enabled: false } } },
            channels: CHANNELS,
          }, { doc });

          const evs = [...el.querySelectorAll('input.chat-ev')];
          assert.deepEqual(evs.map((e) => e.dataset.ev), ['question', 'done', 'error', 'paused', 'away', 'prWatch']);
          assert.equal(evs.find((e) => e.dataset.ev === 'question').checked, false);
          assert.equal(evs.find((e) => e.dataset.ev === 'done').checked, true);

          const rows = [...el.querySelectorAll('.chat-channel-row')];
          assert.equal(rows.length, 2);
          assert.match(rows[0].textContent, /Telegram \(telegram\)/);
          assert.equal(rows[0].querySelector('input.chat-ch').checked, true, 'absent pref -> enabled');
          assert.equal(rows[1].querySelector('input.chat-ch').checked, false, 'explicit opt-out honored');
          assert.match(el.querySelector('.chat-state[data-channel-key="telegram-chat/main"]').className, /green/);
          const teamsBadge = el.querySelector('.chat-state[data-channel-key="teams-chat/main"]');
          assert.match(teamsBadge.className, /waiting/);
          assert.equal(teamsBadge.title, 'missing config: appId');

          const test0 = rows[0].querySelector('.chat-test');
          assert.equal(test0.dataset.plugin, 'telegram-chat');
          assert.equal(test0.dataset.channelId, 'main');
        } },
        { name: 'collect round-trips edits; empty channel list renders a hint', run: () => {
          const el = renderChatSettings({ prefs: { notify: {}, channels: {} }, channels: CHANNELS }, { doc });
          el.querySelector('input.chat-ev[data-ev="done"]').checked = false;
          el.querySelector('input.chat-ch[data-channel-key="telegram-chat/main"]').checked = false;
          assert.deepEqual(collectChatSettings(el), {
            notify: { question: true, done: false, error: true, paused: true, away: true, prWatch: true },
            channels: { 'telegram-chat/main': { enabled: false }, 'teams-chat/main': { enabled: true } },
          });

          const empty = renderChatSettings({ prefs: { notify: {}, channels: {} }, channels: [] }, { doc });
          assert.equal(empty.querySelector('.chat-none').textContent, 'No chat channels installed. Install a chat plugin (e.g. telegram-chat) on the Marketplace page.');
        } },
      ]);
    } },
    { name: 'the Chat script toggle: default on, explicit off honored, round-trips, no prose', run: () => {
      const on = renderScriptToolsToggle({ prefs: {} }, { doc });
      assert.equal(on.querySelector('input#askScriptTools').checked, true, 'an absent pref is ON (W20)');
      assert.equal(on.textContent.trim(), 'Create and run scripts');
      assert.ok(on.matches('label.switch-row') && on.querySelector('input.sw-input#askScriptTools'), 'a switch row holding the input');
      assert.equal(on.querySelectorAll('p, small, .hint').length, 0, 'labels only — no explanatory prose in the UI');
      assert.deepEqual(collectScriptToolsToggle(on), { scriptTools: true });
      const off = renderScriptToolsToggle({ prefs: { scriptTools: false } }, { doc });
      assert.equal(off.querySelector('input#askScriptTools').checked, false);
      assert.deepEqual(collectScriptToolsToggle(off), { scriptTools: false });
      off.querySelector('input#askScriptTools').checked = true;
      assert.deepEqual(collectScriptToolsToggle(off), { scriptTools: true });
      assert.deepEqual(collectScriptToolsToggle(doc.createElement('div')), { scriptTools: true }, 'a host with no control means ON');
    } },
    { name: 'the Chat suggestions toggle: default on, explicit off honored, round-trips', run: () => {
      const on = renderSuggestionsToggle({ prefs: {} }, { doc });
      assert.equal(on.querySelector('input#askSuggestions').checked, true, 'an absent pref is ON');
      assert.equal(on.textContent.trim(), 'Suggest a next prompt after each reply');
      assert.ok(on.matches('label.switch-row') && on.querySelector('input.sw-input#askSuggestions'), 'a switch row holding the input');
      assert.deepEqual(collectSuggestionsToggle(on), { suggestions: true });
      const off = renderSuggestionsToggle({ prefs: { suggestions: false } }, { doc });
      assert.equal(off.querySelector('input#askSuggestions').checked, false);
      assert.deepEqual(collectSuggestionsToggle(off), { suggestions: false });
      off.querySelector('input#askSuggestions').checked = true;
      assert.deepEqual(collectSuggestionsToggle(off), { suggestions: true });
      assert.deepEqual(collectSuggestionsToggle(doc.createElement('div')), { suggestions: true }, 'a host with no control means ON');
    } },
    { name: 'commands off: the hint names the Installed tab and the plugin\'s Settings', run: () => {
      const el = renderChatSettings({ prefs: { notify: {}, channels: {} },
        channels: [{ ...CHANNELS[0], capabilities: { inbound: true, outbound: true }, commands: { allowed: 0, lastRefused: null } }] }, { doc });
      assert.equal(el.querySelector('.chat-commands-off').textContent,
        'Commands are off: no chat is in Allowed chat IDs, so replies like /approve are ignored. Add the chat ID on the Marketplace page: Installed › telegram-chat › Settings.');
    } },
  ]);
});

test('chat settings are divided rows: event rows and web fields sit in .drows, the domain list is a wide row', () => {
  const el = renderChatSettings({ prefs: { notify: {}, channels: {} }, channels: CHANNELS }, { doc });
  const evRows = [...el.querySelectorAll('.chat-event-row')];
  assert.equal(evRows.length, 6);
  for (const r of evRows) {
    assert.ok(r.classList.contains('drow') && r.closest('.drows'), 'event row is a .drow inside .drows');
    assert.ok(r.querySelector('.drow-control input.chat-ev'), 'its switch sits in .drow-control');
  }
  for (const r of el.querySelectorAll('.chat-channel-row')) assert.ok(r.classList.contains('drow') && r.closest('.drows'));
  const web = renderAskWebFields({ askWeb: null }, { doc });
  const fields = [...web.querySelectorAll('.field')];
  assert.ok(fields.length >= 4);
  for (const f of fields) {
    assert.ok(f.classList.contains('drow') && f.closest('.drows'), 'web field is a .drow inside .drows');
    assert.ok(f.querySelector('.drow-control :is(input, textarea)'), 'its control sits in .drow-control');
  }
  assert.ok(web.querySelector('#askWebDomains').closest('.drow').classList.contains('drow-wide'), 'the domain list is a wide row');
});

// #555: the delegated Test button in the booted app goes through withButton — busy "Sending…",
// done "Delivered"; a delivery failure is a card alert naming the chats, and the button skips done.
async function bootApp(testResults) {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const { cardAlertOf } = await import('./helpers/feedback.mjs');
  const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
  const dom = new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const sent = [];
  const json = (body, ok = true, status = 200) => Promise.resolve({ ok, status, json: async () => body });
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (u.includes('/api/chat/test') && method === 'POST') { sent.push(JSON.parse(opts.body)); return json({ results: testResults }); }
    if (u.includes('/api/chat/status')) return json({ channels: CHANNELS.slice(0, 1) });
    if (u.includes('/api/settings')) return json({ chat: { notify: {}, channels: {} }, app: {}, theme: {} });
    if (u.includes('/api/projects')) return json({ projects: [] });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  window.location.hash = 'settings/runs';
  window.dispatchEvent(new window.Event('hashchange'));
  for (let i = 0; i < 8; i++) await tick();
  return { window, sent, tick, cardAlertOf, close: () => window.close() };
}

test('#555 chat Test: busy → Delivered on the button; a delivery failure is a card alert naming the chats', async () => {
  const ok = await bootApp([{ ok: true, chatId: '-1001' }]);
  const b = ok.window.document.querySelector('#chat-settings-card .chat-test');
  assert.ok(b, 'the channel row rendered its Test button');
  b.click();
  assert.equal(b.textContent, 'Sending…');
  for (let i = 0; i < 4; i++) await ok.tick();
  assert.deepEqual(ok.sent, [{ plugin: 'telegram-chat', channelId: 'main' }]);
  assert.equal(b.textContent, 'Delivered');
  assert.equal(ok.cardAlertOf(ok.window.document.getElementById('chat-settings-card')), null);
  assert.equal(ok.window.document.getElementById('chatSettingsMsg'), null, 'no hint line under the card');
  ok.close();

  const bad = await bootApp([{ ok: true, chatId: '-1001' }, { ok: false, chatId: '-1002', error: { kind: 'not_found', message: 'chat not found' } }]);
  const t = bad.window.document.querySelector('#chat-settings-card .chat-test');
  t.click();
  for (let i = 0; i < 4; i++) await bad.tick();
  assert.deepEqual(bad.cardAlertOf(bad.window.document.getElementById('chat-settings-card')), { title: 'Delivery failed for -1002', detail: 'chat not found' });
  assert.equal(t.textContent, 'Test', 'a failure skips "Delivered"');
  assert.equal(t.disabled, false);
  bad.close();
});

test('Summarise commands: on by default, a Beta chip, collects its value (#911)', () => {
  const doc = new JSDOM('<!doctype html><html><body></body></html>').window.document;
  applyFlags({ commandSummaries: true }, doc);
  const host = doc.createElement('div');
  host.append(renderSummariesToggle({ prefs: {} }, { doc }));
  const cb = host.querySelector('input.ask-summaries');
  assert.equal(cb.checked, true);
  assert.equal(host.querySelector('.switch-label').textContent.startsWith('Summarise commands'), true);
  assert.equal(host.querySelector('.flag-chip.flag-chip-beta').textContent, 'Beta');
  cb.checked = false;
  assert.deepEqual(collectSummariesToggle(host), { summariseCommands: false });
  host.replaceChildren(renderSummariesToggle({ prefs: { summariseCommands: false } }, { doc }));
  assert.equal(host.querySelector('input.ask-summaries').checked, false);
});

// ── Settings › Chat › Chat checkouts ─────────────────────────────────────────────
const NOW = Date.parse('2026-11-24T12:00:00Z');
const ago = (days) => new Date(NOW - days * 24 * 60 * 60_000).toISOString();
const co = (over = {}) => ({
  worktreeId: 'wt_00000001', threadId: 'ask_00000001', title: 'Fix the login', createdBy: null, projectKey: 'proj', ref: 'main',
  createdAt: ago(20), lastTouchedAt: ago(12), inUse: false, loss: 'none', dirty: false, ownCommits: false, recent: false,
  missingDir: false, safe: true, lost: { dirtyFiles: [], commits: [], truncated: false, fingerprint: 'f' }, canDiscard: true, own: true, ...over,
});

test('chipFor: one table from separate verdict fields, most urgent first', async () => {
  const { chipFor } = await import('../ui/public/chat-settings-view.mjs');
  const label = (over) => chipFor(co(over)).label;
  assert.equal(label({ inUse: 'terminal', safe: false, dirty: true }), 'In use');
  assert.equal(label({ inUse: 'unknown', safe: false }), 'In use');
  assert.equal(label({ loss: 'unknown', safe: false }), 'Check failed');
  assert.equal(label({ loss: 'work', dirty: true, ownCommits: true, safe: false }), 'Uncommitted changes');
  assert.equal(label({ loss: 'work', ownCommits: true, safe: false }), 'Commits not on any branch');
  assert.match(chipFor(co({ loss: 'work', ownCommits: true, safe: false })).tip, /branch that was since deleted/);
  assert.equal(label({ recent: true, safe: false }), 'Used recently');
  assert.equal(label({}), 'Safe to remove');
  assert.equal(chipFor(co({})).tone, 'green');
});

test('renderCheckoutsList: rows, chips, the owner only on a shared payload, disabled Remove with a reason, empty state', async () => {
  const { renderCheckoutsList, checkoutsSummary } = await import('../ui/public/chat-settings-view.mjs');
  const payload = { capacity: 15, used: 3, items: [
    co(),
    co({ worktreeId: 'wt_00000002', threadId: 'ask_00000002', title: 'Busy chat', inUse: 'replying', safe: false }),
    co({ worktreeId: 'wt_00000003', threadId: 'ask_00000003', title: null, loss: 'work', dirty: true, safe: false, canDiscard: false, createdBy: 'bob@example.com' }),
  ] };
  const el = renderCheckoutsList(payload, { doc, now: NOW });
  const rows = [...el.querySelectorAll('.checkout-row')];
  assert.equal(rows.length, 3);
  assert.equal(rows[0].querySelector('.checkout-title').textContent, 'Fix the login');
  assert.match(rows[0].querySelector('.checkout-meta').textContent, /proj · main · last used 12 days ago/);
  assert.match(rows[0].querySelector('.checkout-chip').className, /green/);
  assert.equal(rows[0].querySelector('.checkout-remove').disabled, false);
  assert.equal(rows[0].querySelector('.checkout-remove').dataset.wt, 'wt_00000001');
  assert.equal(rows[1].querySelector('.checkout-remove').disabled, true);
  assert.match(rows[1].querySelector('.checkout-remove').title, /In use by a live turn, command, run or terminal/);
  assert.equal(rows[2].querySelector('.checkout-title').textContent, 'Untitled chat');
  assert.equal(rows[2].querySelector('.checkout-remove').disabled, true);
  assert.match(rows[2].querySelector('.checkout-remove').title, /someone else's chat and isn't safe to remove/);
  assert.match(rows[2].querySelector('.checkout-meta').textContent, /^bob@example\.com · /, 'two owners: shared payload shows who');
  assert.match(rows[0].querySelector('.checkout-meta').textContent, /^No owner · /);
  // one owner (a local install): no owner column
  const local = renderCheckoutsList({ items: [co(), co({ worktreeId: 'wt_00000009' })] }, { doc, now: NOW });
  assert.doesNotMatch(local.querySelector('.checkout-meta').textContent, /No owner|@/);
  // the owner may still discard their own non-safe row
  const mine = renderCheckoutsList({ items: [co({ loss: 'work', dirty: true, safe: false, canDiscard: true })] }, { doc, now: NOW });
  assert.equal(mine.querySelector('.checkout-remove').disabled, false);
  assert.equal(renderCheckoutsList({ items: [] }, { doc }).textContent, 'No chat checkouts.');
  assert.equal(checkoutsSummary({ capacity: 15, used: 12, items: [co(), co(), co({ safe: false })] }), '12 of 15 slots used · 2 safe to remove');
});

test('checkoutConfirmMessage: lists the first 10 files plus "and N more", the commits, and the unknown case', async () => {
  const { checkoutConfirmMessage } = await import('../ui/public/chat-settings-view.mjs');
  const files = Array.from({ length: 13 }, (_, i) => `src/f${i}.js`);
  const msg = checkoutConfirmMessage(co({ loss: 'work', dirty: true, ownCommits: true, safe: false,
    lost: { dirtyFiles: files, commits: [{ sha: 'abcdef0123456789', subject: 'my work' }], truncated: false, fingerprint: 'x' } }));
  assert.match(msg, /Uncommitted changes \(13\):/);
  assert.match(msg, /• src\/f9\.js/);
  assert.doesNotMatch(msg, /src\/f10\.js/);
  assert.match(msg, /and 3 more/);
  assert.match(msg, /• abcdef0 my work/);
  assert.match(msg, /This cannot be undone\. The chat stays and can open a fresh checkout later\.$/);
  assert.match(checkoutConfirmMessage(co({ loss: 'unknown', safe: false })), /the check could not run|check could not run/);
});

test('createCheckoutsRefresher: pokes coalesce into one trailing load; nothing while hidden; a load in flight is not restarted', async () => {
  const { createCheckoutsRefresher } = await import('../ui/public/chat-settings-view.mjs');
  const timers = [];
  const setTimer = (fn) => { timers.push(fn); return timers.length; };
  const clearTimer = (id) => { timers[id - 1] = null; };
  let calls = 0;
  let release;
  let visible = true;
  const load = () => { calls += 1; return calls === 1 ? new Promise((r) => { release = r; }) : Promise.resolve(); };
  const r = createCheckoutsRefresher({ load, visible: () => visible, setTimer, clearTimer });
  r.poke(); r.poke(); r.poke();
  assert.equal(timers.filter(Boolean).length, 1, 'three pokes, one timer');
  const fire = timers.find(Boolean);
  timers[timers.indexOf(fire)] = null;                  // a fired timer is spent
  const first = fire();                                 // the load starts
  assert.equal(calls, 1);
  r.poke();                                             // during the load: remembered, not restarted
  assert.equal(calls, 1);
  release(); await first;
  assert.equal(timers.filter(Boolean).length, 1, 'one more run is queued after the load');
  const next = timers.find(Boolean);
  timers[timers.indexOf(next)] = null;
  await next();
  assert.equal(calls, 2);
  visible = false;
  const n = timers.length;
  r.poke();
  assert.equal(timers.length, n, 'hidden: no timer');
});

test('settings.html carries the Chat checkouts row ids the app wires', () => {
  const src = readFileSync(new URL('../ui/public/settings/settings.html', import.meta.url), 'utf8');
  for (const id of ['askCheckoutsSummary', 'askCheckoutsList', 'askCheckoutsMsg', 'askCheckoutsFree']) assert.match(src, new RegExp(`id="${id}"`), id);
});
