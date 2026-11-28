// test/chat-settings-view.test.mjs — pure renderers for the Settings
// "Chat notifications" card (design §4.8): render + collect round-trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderChatSettings, collectChatSettings, renderScriptToolsToggle, collectScriptToolsToggle, renderSuggestionsToggle, collectSuggestionsToggle, renderSummariesToggle, collectSummariesToggle, renderAskWebFields } from '../ui/public/chat-settings-view.mjs';
import { applyFlags } from '../ui/public/flags.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
// A namespace read, so a missing new export (mountRoleSetting) fails only its own tests.
import * as chatSettings from '../ui/public/chat-settings-view.mjs';
import { createRolePicker } from '../ui/public/chat/role-picker.mjs';
import { _resetAnswerer, saveAnswerer } from '../ui/public/answerer.mjs';
import { CARDS } from '../ui/public/settings-index.mjs';
import { icon } from '../ui/public/icons.mjs';
import { closeMenus } from '../ui/public/workflows/menu.mjs';

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

// ── Shaper ask screens, slice 2: Settings › Chat "Your role" (flag shaperSmallRuns) ──
// One line: the card heading says "Your role", the explanation sits in the card's info tip, and the row holds only
// the role button, which opens the composer's menu on the composer's controller.
const WHY = 'Who is asking in the Shaper. Worca words its questions for you.';
const ROLE_LABELS = ['Product', 'Engineering', 'Design', 'QA', 'Security', 'DevOps', 'Compliance', 'No role'];
const settleRole = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
/** What a person reads in `node`: its text without the closed info tips. */
const shownText = (node) => { const c = node.cloneNode(true); c.querySelectorAll('.tip-content').forEach((n) => n.remove()); return c.textContent; };
const timesSaid = (node, words) => shownText(node).split(words).length - 1;
const menuRows = (d) => [...d.querySelectorAll('.wfv-menu [role^="menuitem"]')];
const menuRow = (d, label) => menuRows(d).find((r) => r.querySelector('.wfv-menu-l').textContent === label);
const noIntent = { current: () => null, onChange: () => () => {} };
const glyphOf = (d, name) => icon(d, name).querySelector('svg').innerHTML;
const mountRole = (...a) => {
  assert.equal(typeof chatSettings.mountRoleSetting, 'function', 'chat-settings-view.mjs exports mountRoleSetting');
  return chatSettings.mountRoleSetting(...a);
};
/** `run` with a fresh page and a stand-in for GET/PUT /api/answerer behind the app's own loader and saver. */
async function withProfile(lead, run) {
  const realFetch = globalThis.fetch;
  const profile = { lead, requests: [] };
  globalThis.fetch = async (url, init) => {
    const method = init?.method || 'GET';
    profile.requests.push(method === 'PUT' ? `PUT ${url} ${init.body}` : `${method} ${url}`);
    if (method === 'PUT') profile.lead = JSON.parse(init.body).lead;
    return { ok: true, status: 200, json: async () => ({ lead: profile.lead }) };
  };
  _resetAnswerer();
  const dom = new JSDOM('<!doctype html><body><div class="drows" id="chatRoleHost"></div></body>');
  const d = dom.window.document;
  try {
    await run({ d, win: dom.window, host: d.getElementById('chatRoleHost'), profile });
  } finally {
    closeMenus();
    globalThis.fetch = realFetch;
    _resetAnswerer();
  }
}
const flagHooks = (state) => ({
  flagOn: (k) => k === 'shaperSmallRuns' && state.on,
  onFlagChange: (k, fn) => { assert.equal(k, 'shaperSmallRuns'); state.subs.add(fn); return () => { state.subs.delete(fn); }; },
});
const flip = (state, on) => { state.on = on; for (const fn of [...state.subs]) fn(on); };

test('Your role row: only the role button, no second label and no help line; the menu is the composer\'s; a pick saves at once', async () => {
  await withProfile(null, async ({ d, win, host, profile }) => {
    const state = { on: true, subs: new Set() };
    const picker = createRolePicker({ intent: noIntent, ...flagHooks(state) });
    mountRole(host, picker, { doc: d, ...flagHooks(state) });
    await settleRole();
    assert.deepEqual(profile.requests, ['GET /api/answerer']);
    assert.equal(host.querySelectorAll('.drow').length, 1, 'one row');
    assert.equal(host.querySelectorAll('button').length, 1, 'no Save');
    assert.equal(host.querySelector('.drow-label, .drow-help, small, .hint, p'), null, 'no label and no grey help line');
    const btn = () => host.querySelector('button');
    assert.ok(btn().matches('.drow .drow-control > button.btn.btn-sm.btn-quiet.shape-lead-pick.ask-asker-pick'), 'the composer\'s button');
    assert.equal(btn().type, 'button');
    assert.equal(btn().getAttribute('aria-haspopup'), 'menu');
    assert.equal(btn().getAttribute('aria-label'), 'Your role: not picked');
    assert.equal(timesSaid(host, 'Your role'), 0, 'the card heading names it, once');
    assert.notEqual(btn().textContent.trim(), '', 'the button reads something with no role');
    assert.equal(btn().querySelector('svg').innerHTML, glyphOf(d, 'person'));
    assert.equal(btn().querySelectorAll('svg')[1]?.innerHTML, glyphOf(d, 'chevron-down'));

    btn().focus();
    btn().click();
    assert.deepEqual(menuRows(d).map((r) => r.querySelector('.wfv-menu-l').textContent), ROLE_LABELS, '7 roles, then No role');
    assert.equal(d.querySelectorAll('.wfv-menu .menu-sep').length, 1);
    assert.ok(menuRows(d).every((r) => r.querySelector('.wfv-menu-ic svg')), 'an icon on every row');
    menuRow(d, 'Compliance').click();
    await settleRole();
    assert.equal(profile.requests.at(-1), 'PUT /api/answerer {"lead":"compliance"}');
    assert.equal(btn().textContent, 'Compliance');
    assert.equal(btn().getAttribute('aria-label'), 'Your role: Compliance');
    assert.equal(btn().querySelector('svg').innerHTML, glyphOf(d, 'scale'));
    assert.equal(d.activeElement, btn(), 'focus is back on the button');

    btn().click();
    menuRow(d, 'No role').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await settleRole();
    assert.equal(profile.requests.at(-1), 'PUT /api/answerer {"lead":null}');
    assert.equal(btn().getAttribute('aria-label'), 'Your role: not picked');
    assert.equal(timesSaid(host, 'Your role'), 0);
    assert.equal(host.querySelectorAll('button').length, 1);

    btn().click();
    d.querySelector('.wfv-menu').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(d.querySelector('.wfv-menu'), null);
    assert.equal(d.activeElement, btn(), 'Escape returns focus too');
  });
});

test('Your role row: refresh() reads the profile again and repaints, following a role saved elsewhere', async () => {
  await withProfile('compliance', async ({ d, host }) => {
    const state = { on: true, subs: new Set() };
    const picker = createRolePicker({ intent: noIntent, ...flagHooks(state) });
    const setting = mountRole(host, picker, { doc: d, ...flagHooks(state) });
    await settleRole();
    assert.equal(host.querySelector('button').textContent, 'Compliance');
    await saveAnswerer('qa');                 // the Shaper card's write
    setting.refresh();
    await settleRole();
    assert.equal(host.querySelector('button').textContent, 'QA');
    assert.equal(host.querySelectorAll('button').length, 1);
  });
});

test('R-arch-11 Your role row: flag off, an empty host and no read; on, it paints; off again, empty; destroy() lets go', () => {
  const d = new JSDOM('<!doctype html><body><div id="chatRoleHost"></div></body>').window.document;
  const host = d.getElementById('chatRoleHost');
  const calls = { refresh: 0 };
  const listeners = new Set();
  const picker = {
    role: () => 'qa', choose: () => {}, openMenu: () => ({ close() {} }),
    refresh: () => { calls.refresh += 1; },
    onChange: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
  const state = { on: false, subs: new Set() };
  const setting = mountRole(host, picker, { doc: d, ...flagHooks(state) });
  assert.equal(host.childNodes.length, 0, 'flag off: nothing in the host');
  setting.refresh();
  assert.equal(calls.refresh, 0, 'flag off: the profile is never asked for');
  assert.equal(listeners.size, 0);
  flip(state, true);
  assert.equal(host.querySelectorAll('button').length, 1);
  assert.equal(host.querySelector('button').textContent, 'QA');
  assert.ok(calls.refresh >= 1, 'painted, then read');
  assert.equal(listeners.size, 1);
  const read = calls.refresh;
  setting.refresh();
  assert.equal(calls.refresh, read + 1);
  flip(state, false);
  assert.equal(host.childNodes.length, 0, 'off again: empty');
  assert.equal(listeners.size, 0, 'and no longer listening to the picker');
  setting.refresh();
  assert.equal(calls.refresh, read + 1);
  flip(state, true);
  assert.equal(host.querySelectorAll('button').length, 1, 'on again: one row');
  setting.destroy();
  assert.equal(state.subs.size, 0);
  assert.equal(listeners.size, 0);
});

test('Settings › Chat markup: the "Your role" card sits between Links in answers and Limits & access, flag-gated, with its info tip and no Save', () => {
  const page = new JSDOM(readIndexHtml()).window.document;
  const card = page.getElementById('chat-role-card');
  assert.ok(card, '#chat-role-card');
  assert.equal(card.closest('.settings-pane').dataset.tab, 'ask', 'the Chat tab');
  assert.ok(card.matches('section.card.settings-card'));
  assert.equal(card.dataset.flag, 'shaperSmallRuns');
  assert.ok('flagChip' in card.dataset);
  assert.equal(card.dataset.minLevel, 'simple');
  assert.equal(card.previousElementSibling?.id, 'chat-links-card');
  assert.equal(card.nextElementSibling?.id, 'ask-settings-card');
  assert.equal(card.querySelector('h2').textContent.trim(), 'Your role');
  const tip = card.querySelector('.card-head button.info-tip');
  assert.ok(tip?.getAttribute('aria-label'), 'the explanation goes into an info tip, as on Limits & access');
  assert.equal(tip.querySelector('.tip-content.hidden')?.textContent.trim(), WHY);
  const host = card.querySelector('#chatRoleHost');
  assert.ok(host?.matches('div.drows'));
  assert.equal(host.children.length, 0, 'painted by mountRoleSetting, under the flag only');
  assert.equal(card.querySelector('.drow-label, .drow-help, .hint, small'), null, 'no second label, no grey help line');
  assert.equal(card.querySelector('.btn-primary'), null, 'saves on pick');
  assert.equal(timesSaid(card, 'Your role'), 1);
  const entry = CARDS.find((c) => c.id === 'chat-role-card');
  assert.ok(entry, 'the settings search catalogues the card');
  assert.deepEqual([entry.tab, entry.title, entry.flag, entry.min], ['ask', 'Your role', 'shaperSmallRuns', 'simple']);
});
