// test/ask-panel-history.test.mjs — worca Chat P1: the History column (it replaced the threads popover). Groups by
// last activity (Today / Yesterday / Earlier), the row dots and their words, the open chat marked, "No saved chats.",
// the toggle (aria-pressed, data-history, a stored choice, open by default from 1600px), the overlay below 1100px
// (scrim, Escape, a pick closes it), setHistoryOpen for P4, a pick that loads and routes once, delete through confirm,
// and refreshes that wait while Chat is hidden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makePanel, key } from './helpers/ask-panel-harness.mjs';

const NOW = Date.parse('2026-10-11T12:00:00');   // local noon: the groups follow the browser's own day
const iso = (ms) => new Date(ms).toISOString();
const row = (id, title, at, extra = {}) => ({ id, title, createdAt: at, updatedAt: at, model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false, tracking: false, waiting: false, ...extra });
const LIST = {
  threads: [
    row('ask_00000001', 'Fix the login bug', iso(NOW - 3600e3), { inFlight: true }),
    row('ask_00000002', 'Offline sync banner', iso(NOW - 26 * 3600e3), { tracking: true, waiting: true }),
    row('ask_00000003', 'Build the header', iso(NOW - 5 * 86400e3), { tracking: true }),
  ],
  total: 3,
};
function api(rec, list = LIST) {
  return (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    (rec.calls ||= []).push(`${method} ${url}`);
    if (url.startsWith('/api/ask/threads?')) return { ok: true, status: 200, json: async () => list };
    if (/^\/api\/ask\/threads\/ask_[0-9a-f]{8}$/.test(url) && method === 'DELETE') return { ok: true, status: 200, json: async () => ({ ok: true }) };
    const m = url.match(/^\/api\/ask\/threads\/(ask_[0-9a-f]{8})$/);
    if (m) return { ok: true, status: 200, json: async () => ({ thread: { ...list.threads.find((t) => t.id === m[1]) }, messages: [], attachments: [], runLinks: [], inFlight: null }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}
const ticks = async (ctx, n = 3) => { for (let i = 0; i < n; i += 1) await ctx.tick(); };
const listFetches = (rec) => rec.calls.filter((c) => c.startsWith('GET /api/ask/threads?limit=50')).length;

test('the column lists every chat grouped Today / Yesterday / Earlier with the meter, the dots and their words; the open chat is marked; rows are plain buttons', async () => {
  const rec = {};
  const ctx = makePanel({ fetchHandler: api(rec), now: () => NOW });
  ctx.panel.open({ threadId: 'ask_00000001' });
  await ticks(ctx);
  ctx.flush();
  const col = ctx.doc.querySelector('aside.chat-history[data-chat-history]');
  assert.equal(col.getAttribute('aria-label'), 'Chats');
  assert.equal(col.querySelector('.chat-history-title').textContent, 'Chats');
  assert.equal(col.querySelector('.chat-history-meter').textContent, '3 chats');
  const groups = [...col.querySelectorAll('.chat-history-group')];
  assert.deepEqual(groups.map((g) => [g.dataset.group, g.querySelector('.chat-history-group-label').textContent, g.querySelectorAll('.ask-thread-row').length]),
    [['today', 'Today', 1], ['yesterday', 'Yesterday', 1], ['earlier', 'Earlier', 1]]);
  const picks = [...col.querySelectorAll('.ask-thread-pick')];
  assert.deepEqual(picks.map((p) => p.querySelector('.ask-thread-title').textContent), ['Fix the login bug', 'Offline sync banner', 'Build the header']);
  assert.ok(picks[0].querySelector('.ask-dot-live'), 'thinking: green');
  assert.ok(picks[1].querySelector('.ask-dot-wait'), 'a followed run waits on you: amber');
  assert.equal(picks[1].querySelector('.ask-dot-track'), null, 'amber wins over violet');
  assert.ok(picks[2].querySelector('.ask-dot-track'), 'a followed run is running: violet');
  assert.deepEqual(picks.map((p) => (p.querySelector('.sr-only') || { textContent: '' }).textContent), ['Replying', 'Needs you', 'Following a run']);
  assert.equal(picks[0].getAttribute('aria-current'), 'true');
  assert.ok(picks[0].closest('.ask-thread-row').classList.contains('is-current'));
  assert.equal(picks[1].getAttribute('aria-current'), null);
  assert.equal(col.querySelector('[role="menuitem"]'), null, 'a list of buttons, not a menu');
  assert.equal(listFetches(rec), 1, 'loaded once, on the first show');
});

test('no chats: "No saved chats." and an empty meter', async () => {
  const ctx = makePanel({ fetchHandler: api({}, { threads: [], total: 0 }) });
  ctx.panel.open();
  await ticks(ctx);
  assert.equal(ctx.doc.querySelector('.chat-history-empty').textContent, 'No saved chats.');
  assert.equal(ctx.doc.querySelector('.chat-history-meter').textContent, '');
});

test('the toggle opens and closes the column (aria-pressed, data-history), remembers the choice and refreshes the rows on open; from 1600px it starts open unless told otherwise', async () => {
  const rec = {};
  const ctx = makePanel({ fetchHandler: api(rec), innerWidth: 1280 });
  ctx.panel.open();
  await ticks(ctx);
  const page = ctx.panel.root;
  const btn = ctx.doc.querySelector('[data-ask-threads-btn]');
  assert.equal(page.dataset.history, 'closed', '1280px and nothing stored: closed');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  assert.equal(btn.getAttribute('aria-controls'), 'chat-history');
  assert.ok(btn.classList.contains('chat-history-toggle'), 'the menu toggle\'s look (style.css)');
  assert.equal(btn.querySelectorAll('svg > path').length, 5, 'the page-of-text glyph: page, fold, three lines');
  assert.equal(btn.querySelector('svg > rect'), null, 'no panel glyph');
  btn.click();
  assert.equal(page.dataset.history, 'open');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.equal(ctx.storage.getItem('worca-cc.chat.history'), 'open');
  await ticks(ctx);
  assert.equal(listFetches(rec), 2, 'opening refreshed the rows');
  assert.equal(ctx.doc.querySelector('[data-chat-scrim]').hidden, true, 'a push column has no scrim');
  btn.click();
  assert.equal(page.dataset.history, 'closed');
  assert.equal(ctx.storage.getItem('worca-cc.chat.history'), 'closed');
  const wide = makePanel({ fetchHandler: api({}), innerWidth: 1600 });
  assert.equal(wide.panel.root.dataset.history, 'open', 'from 1600px it starts open');
  const told = makePanel({ fetchHandler: api({}), innerWidth: 1600, storage: ctx.storage });
  assert.equal(told.panel.root.dataset.history, 'closed', 'a stored choice wins');
});

test('below 1100px the column is an overlay: a scrim shows, a pick closes it (never a stored choice), Escape and the scrim close it', async () => {
  const rec = {};
  const routes = [];
  const ctx = makePanel({ fetchHandler: api(rec), innerWidth: 900, deps: { onRoute: (id, o) => routes.push([id, o]) } });
  ctx.panel.open();
  await ticks(ctx);
  const page = ctx.panel.root;
  const btn = ctx.doc.querySelector('[data-ask-threads-btn]');
  const scrim = ctx.doc.querySelector('[data-chat-scrim]');
  btn.click();
  assert.equal(page.dataset.history, 'open');
  assert.equal(scrim.hidden, false);
  assert.equal(ctx.storage.getItem('worca-cc.chat.history'), null, 'an overlay is never a stored choice');
  assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('[data-chat-history]'), 'focus moves into the overlay (it sits before the chat in the DOM)');
  await ticks(ctx);
  ctx.doc.querySelectorAll('[data-chat-history] .ask-thread-pick')[1].click();
  assert.equal(page.dataset.history, 'closed', 'a pick gives the chat its room');
  assert.equal(scrim.hidden, true);
  assert.deepEqual(routes, [['ask_00000002', { replace: false }]]);
  assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('textarea.ask-input'), 'the picked row is hidden now: focus goes to the chat');
  btn.click();
  const e = key(ctx.window, ctx.doc.querySelector('textarea.ask-input'), 'Escape');
  assert.equal(e.defaultPrevented, true);
  assert.equal(page.dataset.history, 'closed', 'Escape closed the overlay');
  assert.equal(ctx.doc.activeElement, btn, 'focus back on the toggle');
  btn.click();
  scrim.click();
  assert.equal(page.dataset.history, 'closed', 'the scrim closes it');
  assert.equal(ctx.doc.activeElement, btn, 'focus back on the toggle, as with Escape');
});

test('setHistoryOpen (P4) sets data-history at once; persist:false leaves the stored choice alone', async () => {
  const ctx = makePanel({ fetchHandler: api({}), innerWidth: 1700 });
  const page = ctx.panel.root;
  assert.equal(page.dataset.history, 'open');
  ctx.panel.setHistoryOpen(false, { persist: false });
  assert.equal(page.dataset.history, 'closed');
  assert.equal(ctx.doc.querySelector('[data-ask-threads-btn]').getAttribute('aria-pressed'), 'false');
  assert.equal(ctx.storage.getItem('worca-cc.chat.history'), null);
  ctx.panel.setHistoryOpen(true);
  assert.equal(page.dataset.history, 'open');
  assert.equal(ctx.storage.getItem('worca-cc.chat.history'), 'open');
});

test('a row opens its chat once and routes there; picking the open chat again reloads nothing', async () => {
  const rec = {};
  const routes = [];
  const ctx = makePanel({ fetchHandler: api(rec), deps: { onRoute: (id, o) => routes.push([id, o]) } });
  ctx.panel.open();
  await ticks(ctx);
  const pick = (i) => ctx.doc.querySelectorAll('[data-chat-history] .ask-thread-pick')[i];
  const loads = () => rec.calls.filter((c) => c === 'GET /api/ask/threads/ask_00000003').length;
  pick(2).click();
  await ticks(ctx);
  ctx.flush();
  assert.equal(loads(), 1);
  assert.deepEqual(routes, [['ask_00000003', { replace: false }]]);
  assert.equal(pick(2).getAttribute('aria-current'), 'true');
  ctx.panel.open({ threadId: 'ask_00000003' });                       // the address echo
  pick(2).click();
  await ticks(ctx);
  assert.equal(loads(), 1, 'no reload');
});

test('the trash asks first; a confirmed delete refetches the column; deleting the open chat goes home and swaps the address', async () => {
  const rec = {};
  const routes = [];
  const confirms = [];
  const ctx = makePanel({ fetchHandler: api(rec), confirm: async (o) => { confirms.push(o); return true; }, deps: { onRoute: (id, o) => routes.push([id, o]) } });
  ctx.panel.open({ threadId: 'ask_00000001' });
  await ticks(ctx);
  const before = listFetches(rec);
  ctx.doc.querySelector('[data-chat-history] .ask-thread-row[data-thread-id="ask_00000001"] .ask-thread-trash').click();
  await ticks(ctx, 5);
  assert.equal(confirms[0].title, 'Delete this chat?');
  assert.equal(confirms[0].confirmLabel, 'Delete');
  assert.equal(confirms[0].danger, true);
  assert.ok(rec.calls.includes('DELETE /api/ask/threads/ask_00000001'));
  assert.equal(listFetches(rec), before + 1, 'the column refetched');
  assert.deepEqual(routes.at(-1), [null, { replace: true }]);
  assert.equal(ctx.panel.root.dataset.view, 'home');
});

test('a refresh frame while Chat is hidden only marks the list stale; the next show refetches it once', async () => {
  const rec = {};
  const ctx = makePanel({ fetchHandler: api(rec) });
  ctx.panel.open();
  await ticks(ctx);
  ctx.panel.close();
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: 'ask_00000002', message: { id: 'askm_00000009', role: 'system', text: 'Run "x" is waiting for your answer (clarify)' } });
  await new Promise((r) => setTimeout(r, 320));
  assert.equal(listFetches(rec), 1, 'nothing while hidden');
  ctx.panel.open();
  await ticks(ctx);
  assert.equal(listFetches(rec), 2, 'refetched on show');
});

test('a refresh still pending when Chat is left (inside its debounce) runs on the next show', async () => {
  const rec = {};
  const ctx = makePanel({ fetchHandler: api(rec) });
  ctx.panel.open();
  await ticks(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-title', threadId: 'ask_00000002', title: 'Renamed' });
  ctx.panel.close();                                                  // inside the 250 ms debounce
  await new Promise((r) => setTimeout(r, 320));
  assert.equal(listFetches(rec), 1, 'nothing while hidden');
  ctx.panel.open();
  await ticks(ctx);
  assert.equal(listFetches(rec), 2, 'the refresh that was due ran on show');
});

test('a History fetch that failed shows "No saved chats." and is tried again on the next show', async () => {
  const rec = { calls: [] };
  const live = api(rec);
  let down = true;
  const ctx = makePanel({
    fetchHandler: (url, opts) => {
      if (down && url.startsWith('/api/ask/threads?')) { rec.calls.push(`GET ${url}`); return { ok: false, status: 500, json: async () => ({}) }; }
      return live(url, opts);
    },
  });
  ctx.panel.open();
  await ticks(ctx);
  assert.equal(ctx.doc.querySelector('.chat-history-empty').textContent, 'No saved chats.');
  down = false;
  ctx.panel.close();
  ctx.panel.open();
  await ticks(ctx);
  assert.equal(listFetches(rec), 2, 'tried again');
  assert.equal(ctx.doc.querySelectorAll('[data-chat-history] .ask-thread-row').length, 3);
});

test('below 1100px the column starts closed even when "open" is the stored choice', async () => {
  const storage = { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } };
  storage.setItem('worca-cc.chat.history', 'open');
  const ctx = makePanel({ fetchHandler: api({}), innerWidth: 900, storage });
  assert.equal(ctx.panel.root.dataset.history, 'closed', 'an overlay never opens by itself');
  assert.equal(ctx.doc.querySelector('[data-chat-scrim]').hidden, true);
});

test('the groups start at local midnight: a chat at 00:00 today is Today, at 00:00 yesterday Yesterday', async () => {
  const today0 = Date.parse('2026-10-11T00:00:00');
  const yday0 = Date.parse('2026-10-10T00:00:00');
  const list = { threads: [row('ask_00000001', 'At midnight', iso(today0)), row('ask_00000002', 'Yesterday midnight', iso(yday0)), row('ask_00000003', 'Just before', iso(yday0 - 1))], total: 3 };
  const ctx = makePanel({ fetchHandler: api({}, list), now: () => NOW });
  ctx.panel.open();
  await ticks(ctx);
  const groups = [...ctx.doc.querySelectorAll('.chat-history-group')].map((g) => [g.dataset.group, [...g.querySelectorAll('.ask-thread-title')].map((x) => x.textContent)]);
  assert.deepEqual(groups, [['today', ['At midnight']], ['yesterday', ['Yesterday midnight']], ['earlier', ['Just before']]]);
});

test('leaving Chat closes the overlay (never a stored choice); a push column stays as it was', async () => {
  const ctx = makePanel({ fetchHandler: api({}), innerWidth: 900 });
  ctx.panel.open();
  await ticks(ctx);
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  assert.equal(ctx.panel.root.dataset.history, 'open');
  ctx.panel.close();
  assert.equal(ctx.panel.root.dataset.history, 'closed', 'the overlay closed with the page');
  assert.equal(ctx.doc.querySelector('[data-chat-scrim]').hidden, true);
  assert.equal(ctx.storage.getItem('worca-cc.chat.history'), null);
  const wide = makePanel({ fetchHandler: api({}), innerWidth: 1280 });
  wide.panel.open();
  await ticks(wide);
  wide.doc.querySelector('[data-ask-threads-btn]').click();
  wide.panel.close();
  assert.equal(wide.panel.root.dataset.history, 'open', 'a push column is the user\'s choice');
});

// ---- deleting from the column; the overlay and the keyboard ----
const LA_A = 'ask_0000000a';
const LA_X = 'ask_0000000b';
const laRow = (id, title) => ({ id, title, createdAt: 't', updatedAt: new Date(1_000_000).toISOString(), model: null, effort: null, sessionId: null, context: null, totals: {} });
const laUser = (tid) => ({ id: 'askm_u0000001', threadId: tid, seq: 1, role: 'user', text: 'hi', blocks: [], status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' });
const laSnap = (id, title, extra = {}) => ({ thread: laRow(id, title), messages: [laUser(id)], attachments: [], runLinks: [], inFlight: null, ...extra });

test('deleting the chat that is still loading goes home; its late snapshot never shows', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  let deleted = false;
  const routes = [];
  const ctx = makePanel({
    innerWidth: 1700,
    fetchHandler: (url, opts) => {
      const m = (opts.method || 'GET').toUpperCase();
      if (url.startsWith('/api/ask/threads?')) return { ok: true, status: 200, json: async () => ({ threads: deleted ? [laRow(LA_A, 'Chat A')] : [laRow(LA_A, 'Chat A'), laRow(LA_X, 'Chat X')], total: deleted ? 1 : 2 }) };
      if (url === `/api/ask/threads/${LA_A}`) return { ok: true, status: 200, json: async () => laSnap(LA_A, 'Chat A') };
      if (url === `/api/ask/threads/${LA_X}` && m === 'GET') return held.then(() => ({ ok: true, status: 200, json: async () => laSnap(LA_X, 'Chat X') }));
      if (url === `/api/ask/threads/${LA_X}` && m === 'DELETE') { deleted = true; return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
      return { ok: true, status: 200, json: async () => ({}) };
    },
    deps: { onRoute: (id, o) => routes.push([id, o]) },
  });
  ctx.panel.open({ threadId: LA_A });
  await ticks(ctx);
  ctx.flush();
  const rowX = () => ctx.doc.querySelector(`.ask-thread-row[data-thread-id="${LA_X}"]`);
  rowX().querySelector('.ask-thread-pick').click();
  rowX().querySelector('.ask-thread-trash').click();
  await ticks(ctx, 6);
  release();
  await ticks(ctx, 6);
  ctx.flush();
  assert.equal(ctx.panel.threadId(), null);
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'New chat');
  assert.deepEqual(routes.at(-1), [null, { replace: true }]);
});

test('the trash keeps keyboard focus in the column: Cancel returns it to the trash, a delete keeps it in the column; below 1100px the overlay stays and nothing is focused under its scrim', async () => {
  for (const width of [900, 1700]) {
    for (const answer of [false, true]) {
      let docRef = null;
      const ctx = makePanel({
        innerWidth: width,
        confirm: async () => {                                         // the real confirmModal (.viewer-modal) focuses its button, then hides
          const modal = docRef.createElement('div');
          modal.className = 'viewer-modal';
          const okBtn = docRef.createElement('button');
          modal.appendChild(okBtn);
          docRef.body.appendChild(modal);
          okBtn.focus();
          modal.remove();
          return answer;
        },
        fetchHandler: (url) => {
          if (url.startsWith('/api/ask/threads?')) return { ok: true, status: 200, json: async () => ({ threads: [laRow(LA_A, 'A'), laRow(LA_X, 'X')], total: 2 }) };
          if (url === `/api/ask/threads/${LA_A}`) return { ok: true, status: 200, json: async () => laSnap(LA_A, 'A') };
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        },
      });
      docRef = ctx.doc;
      ctx.panel.open({ threadId: LA_A });
      await ticks(ctx);
      ctx.flush();
      if (width < 1100) ctx.doc.querySelector('[data-ask-threads-btn]').click();
      await ticks(ctx);
      const trash = ctx.doc.querySelector(`.ask-thread-row[data-thread-id="${LA_X}"] .ask-thread-trash`);
      trash.focus();
      trash.click();
      await ticks(ctx, 6);
      const label = `${width}px, confirm ${answer}`;
      assert.equal(ctx.panel.root.dataset.history, 'open', `${label}: the column stays`);
      if (!answer) assert.equal(ctx.doc.activeElement, trash, `${label}: back on the trash`);
      else assert.ok(ctx.doc.querySelector('[data-chat-history]').contains(ctx.doc.activeElement), `${label}: focus stays in the column`);
    }
  }
  // Deleting the OPEN chat from the overlay: home, the overlay closes like a pick, the composer has the focus.
  const ctx = makePanel({
    innerWidth: 900,
    fetchHandler: (url) => {
      if (url.startsWith('/api/ask/threads?')) return { ok: true, status: 200, json: async () => ({ threads: [laRow(LA_A, 'A'), laRow(LA_X, 'X')], total: 2 }) };
      if (url === `/api/ask/threads/${LA_A}`) return { ok: true, status: 200, json: async () => laSnap(LA_A, 'A') };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  ctx.panel.open({ threadId: LA_A });
  await ticks(ctx);
  ctx.flush();
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ticks(ctx);
  ctx.doc.querySelector(`.ask-thread-row[data-thread-id="${LA_A}"] .ask-thread-trash`).click();
  await ticks(ctx, 6);
  ctx.flush();
  assert.equal(ctx.panel.root.dataset.view, 'home');
  assert.equal(ctx.panel.root.dataset.history, 'closed', 'the overlay gives the new chat its room');
  assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('textarea.ask-input'));
});

test('below 1100px focus leaving the overlay (Tab past the last row) closes it; a dialog it opens keeps it; a push column never closes on blur', async () => {
  const ctx = makePanel({ fetchHandler: api({}), innerWidth: 900 });
  ctx.panel.open();
  await ticks(ctx);
  const page = ctx.panel.root;
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  assert.equal(page.dataset.history, 'open');
  const pick = ctx.doc.querySelector('[data-chat-history] .ask-thread-pick');
  pick.focus();
  const modal = ctx.doc.createElement('div');
  modal.className = 'viewer-modal';
  const okBtn = ctx.doc.createElement('button');
  modal.appendChild(okBtn);
  ctx.doc.body.appendChild(modal);
  okBtn.focus();
  assert.equal(page.dataset.history, 'open', 'a confirm opened from the column keeps it');
  pick.focus();
  ctx.doc.querySelector('textarea.ask-input').focus();
  assert.equal(page.dataset.history, 'closed', 'focus left for a control under the overlay: it closed');
  assert.equal(ctx.doc.querySelector('[data-chat-scrim]').hidden, true);
  assert.equal(ctx.storage.getItem('worca-cc.chat.history'), null, 'never a stored choice');
  const wide = makePanel({ fetchHandler: api({}), innerWidth: 1280 });
  wide.panel.open();
  await ticks(wide);
  wide.doc.querySelector('[data-ask-threads-btn]').click();
  wide.doc.querySelector('[data-chat-history] .ask-thread-pick').focus();
  wide.doc.querySelector('textarea.ask-input').focus();
  assert.equal(wide.panel.root.dataset.history, 'open', 'a push column is not an overlay');
});

test('narrowing the window below 1100px closes a push column (as an overlay it would cover the chat); an overlay opened there stays; the stored choice is kept', async () => {
  const ctx = makePanel({ fetchHandler: api({}), innerWidth: 1280 });
  ctx.panel.open();
  await ticks(ctx);
  const page = ctx.panel.root;
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  assert.equal(page.dataset.history, 'open');
  const resize = (w) => {
    Object.defineProperty(ctx.window, 'innerWidth', { value: w, configurable: true });
    ctx.window.dispatchEvent(new ctx.window.Event('resize'));
  };
  resize(1024);
  assert.equal(page.dataset.history, 'closed');
  assert.equal(ctx.doc.querySelector('[data-chat-scrim]').hidden, true);
  assert.equal(ctx.storage.getItem('worca-cc.chat.history'), 'open', 'the user\'s choice is kept for a wide window');
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  assert.equal(page.dataset.history, 'open');
  resize(900);
  assert.equal(page.dataset.history, 'open', 'an overlay the user opened stays');
  const wide = makePanel({ fetchHandler: api({}), innerWidth: 1700 });
  wide.panel.open();
  await ticks(wide);
  assert.equal(wide.panel.root.dataset.history, 'open', 'opened by default at 1700px');
  Object.defineProperty(wide.window, 'innerWidth', { value: 1000, configurable: true });
  wide.window.dispatchEvent(new wide.window.Event('resize'));
  assert.equal(wide.panel.root.dataset.history, 'closed', 'a column that opened by itself closes too');
});

test('a shared "Delete all" naming the open chat refetches the column (other chats stay listed)', async () => {
  const L = 'ask_0000000f';
  let cleared = false;
  const ctx = makePanel({
    innerWidth: 1700,
    fetchHandler: (url) => {
      if (url.startsWith('/api/ask/threads?')) return { ok: true, status: 200, json: async () => ({ threads: cleared ? [laRow(L, 'Legacy')] : [laRow(LA_A, 'Mine'), laRow(L, 'Legacy')], total: cleared ? 1 : 2 }) };
      if (url === `/api/ask/threads/${LA_A}`) return { ok: true, status: 200, json: async () => laSnap(LA_A, 'Mine') };
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  ctx.panel.open({ threadId: LA_A });
  await ticks(ctx);
  ctx.flush();
  cleared = true;
  ctx.panel.pushServerFrame({ type: 'ask-history-cleared', threadIds: [LA_A] });
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'New chat', 'the open chat was one of them: home');
  await new Promise((r) => setTimeout(r, 400));                        // past THREADS_REFRESH_MS
  await ticks(ctx);
  assert.equal(ctx.doc.querySelectorAll('[data-chat-history] .ask-thread-row').length, 1);
  assert.equal(ctx.doc.querySelector('.chat-history-meter').textContent, '1 chat');
});

test('a chat deleted while its reply was still running never lights the Chat row when that reply ends', async () => {
  const calls = [];
  let deleted = false;
  const ctx = makePanel({
    innerWidth: 1700,
    fetchHandler: (url, opts) => {
      const m = (opts.method || 'GET').toUpperCase();
      if (url.startsWith('/api/ask/threads?')) return { ok: true, status: 200, json: async () => ({ threads: deleted ? [] : [laRow(LA_A, 'A')], total: deleted ? 0 : 1 }) };
      if (url === '/api/ask/threads' && m === 'POST') return { ok: true, status: 201, json: async () => ({ thread: laRow(LA_A, null) }) };
      if (url === `/api/ask/threads/${LA_A}/messages` && m === 'POST') return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', attachments: [], contexts: [] }) };
      if (url === `/api/ask/threads/${LA_A}` && m === 'DELETE') { deleted = true; return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
      return { ok: true, status: 200, json: async () => ({}) };
    },
    deps: { onUnread: (on) => calls.push(on) },
  });
  ctx.panel.open({ threadId: null });
  await ticks(ctx);
  ctx.doc.querySelector('textarea.ask-input').value = 'hello';
  ctx.doc.querySelector('[data-ask-send]').click();                   // this tab asked in chat A
  await ticks(ctx, 5);
  ctx.flush();
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: LA_A, message: { id: 'askm_00000009', role: 'system', text: 'x' } });
  await new Promise((r) => setTimeout(r, 320));                        // the column lists A
  await ticks(ctx);
  ctx.doc.querySelector(`.ask-thread-row[data-thread-id="${LA_A}"] .ask-thread-trash`).click();
  await ticks(ctx, 6);
  assert.equal(ctx.panel.threadId(), null, 'deleted: home');
  ctx.panel.close();
  ctx.panel.pushServerFrame({ type: 'ask-error', threadId: LA_A, messageId: 'askm_0000000a', seq: 3, error: 'stopped' });
  assert.deepEqual(calls, [], 'no dot for a chat that is gone');
});

test('below 1100px a "Delete all" from another tab keeps the focus in the open overlay, never on the composer under its scrim', async () => {
  const ctx = makePanel({
    innerWidth: 900,
    fetchHandler: (url) => {
      if (url.startsWith('/api/ask/threads?')) return { ok: true, status: 200, json: async () => ({ threads: [laRow(LA_A, 'A'), laRow(LA_X, 'X')], total: 2 }) };
      if (url === `/api/ask/threads/${LA_A}`) return { ok: true, status: 200, json: async () => laSnap(LA_A, 'A') };
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  ctx.panel.open({ threadId: LA_A });
  await ticks(ctx);
  ctx.flush();
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ticks(ctx);
  ctx.doc.querySelector(`.ask-thread-row[data-thread-id="${LA_X}"] .ask-thread-pick`).focus();
  ctx.panel.pushServerFrame({ type: 'ask-history-cleared' });
  assert.equal(ctx.panel.root.dataset.view, 'home');
  assert.equal(ctx.panel.root.dataset.history, 'open', 'the overlay stays');
  assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('[data-chat-history]'), 'the emptied column keeps the focus');
});

test('below 1100px deleting the last listed chat keeps the focus in the emptied column, never <body>', async () => {
  let deleted = false;
  const ctx = makePanel({
    innerWidth: 900,
    fetchHandler: (url, opts) => {
      const m = (opts.method || 'GET').toUpperCase();
      if (url.startsWith('/api/ask/threads?')) return { ok: true, status: 200, json: async () => (deleted ? { threads: [], total: 0 } : { threads: [laRow(LA_X, 'X')], total: 1 }) };
      if (url === `/api/ask/threads/${LA_X}` && m === 'DELETE') { deleted = true; return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  ctx.panel.open({ threadId: null });
  await ticks(ctx);
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ticks(ctx);
  const trash = ctx.doc.querySelector(`.ask-thread-row[data-thread-id="${LA_X}"] .ask-thread-trash`);
  trash.focus();
  trash.click();
  await ticks(ctx, 8);
  assert.equal(ctx.doc.querySelector('.chat-history-empty').textContent, 'No saved chats.');
  assert.equal(ctx.panel.root.dataset.history, 'open');
  assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('[data-chat-history]'));
});

test('an overlay the window widened into a push column closes when the window narrows again (it would cover the focused composer)', async () => {
  const ctx = makePanel({ fetchHandler: api({}), innerWidth: 900 });
  ctx.panel.open();
  await ticks(ctx);
  const page = ctx.panel.root;
  const resize = (w) => {
    Object.defineProperty(ctx.window, 'innerWidth', { value: w, configurable: true });
    ctx.window.dispatchEvent(new ctx.window.Event('resize'));
  };
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  assert.equal(page.dataset.history, 'open');
  resize(1280);
  assert.equal(ctx.doc.querySelector('[data-chat-scrim]').hidden, true, 'a push column now');
  const input = ctx.doc.querySelector('textarea.ask-input');
  input.focus();
  resize(900);
  assert.equal(page.dataset.history, 'closed');
  assert.equal(ctx.doc.activeElement, input);
});

test('a refresh that reorders the rows keeps keyboard focus on the same chat', async () => {
  const LA_C = 'ask_0000000d';
  let order = [laRow(LA_A, 'A'), laRow(LA_X, 'X'), laRow(LA_C, 'C')];
  const ctx = makePanel({
    innerWidth: 1700,
    fetchHandler: (url) => {
      if (url.startsWith('/api/ask/threads?')) return { ok: true, status: 200, json: async () => ({ threads: order, total: 3 }) };
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  ctx.panel.open();
  await ticks(ctx);
  const pickOf = (id) => ctx.doc.querySelector(`.ask-thread-row[data-thread-id="${id}"] .ask-thread-pick`);
  pickOf(LA_C).focus();
  order = [laRow(LA_C, 'C'), laRow(LA_A, 'A'), laRow(LA_X, 'X')];
  ctx.panel.pushServerFrame({ type: 'ask-title', threadId: LA_C, title: 'C' });   // a refresh frame (C moved to the top)
  await new Promise((r) => setTimeout(r, 320));                        // past THREADS_REFRESH_MS
  await ticks(ctx);
  assert.equal(ctx.doc.querySelector('.ask-thread-row').dataset.threadId, LA_C, 'precondition: C leads now');
  assert.equal(ctx.doc.activeElement, pickOf(LA_C));
});

// ── the column's search (the Workflows Library's expanding search) ─────────────────────────────────────────────────
// ?q= reaches the server (title OR message text, owner filter kept — test/ask-store.test.mjs); the fake answers the
// matches with total = the hits and all = every chat, and a text hit carries its excerpt as match.snippet.
const SEARCH_HITS = {
  threads: [
    row('ask_00000001', 'Fix the login bug', iso(NOW - 3600e3)),
    row('ask_00000002', 'Offline sync banner', iso(NOW - 26 * 3600e3), { match: { snippet: '…the <b>login</b> token expired…' } }),
  ],
  total: 2,
  all: 3,
};
function searchApi(rec) {
  const base = api({});
  return (url, opts) => {
    if (!url.startsWith('/api/ask/threads?')) return base(url, opts);
    rec.lists.push(url);
    const q = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('q');
    const body = q == null ? LIST : q === 'login' ? SEARCH_HITS : { threads: [], total: 0, all: 3 };
    return { ok: true, status: 200, json: async () => body };
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DEBOUNCED = 260;                                                   // past the ~200 ms typing debounce
function typeInto(ctx, input, text) {
  input.value = text;
  input.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
}
function searchHead(ctx) {
  const head = ctx.doc.querySelector('[data-chat-history] .chat-history-head');
  return {
    head,
    meter: head.querySelector('.chat-history-meter'),
    box: head.querySelector('.chat-history-sbox'),
    btn: head.querySelector('button.chat-history-search-btn'),
    input: head.querySelector('input.chat-history-search-input'),
  };
}
const titles = (ctx) => [...ctx.doc.querySelectorAll('[data-chat-history] .ask-thread-title')].map((t) => t.textContent);

test('the search button sits right of the meter; a click unfolds the field (is-searching, aria-expanded, focus, no longer inert); the glyph on an empty field folds it, with text it only refocuses', async () => {
  const ctx = makePanel({ fetchHandler: api({}), innerWidth: 1700 });
  ctx.panel.open();
  await ticks(ctx);
  const { head, meter, box, btn, input } = searchHead(ctx);
  assert.deepEqual([...head.children].map((c) => c.className), ['chat-history-title', 'chat-history-meter', 'chat-history-sbox']);
  assert.equal(meter.nextElementSibling, box, 'the search box follows the meter');
  assert.equal(box.firstElementChild, btn, 'the box leads with its button');
  assert.equal(btn.getAttribute('aria-label'), 'Search chats');
  assert.equal(btn.getAttribute('aria-controls'), input.id);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.ok(btn.querySelector('svg'), 'the search glyph');
  assert.equal(input.type, 'search');
  assert.equal(input.placeholder, 'Search chats…');
  assert.equal(input.getAttribute('aria-label'), 'Search chats');
  assert.equal(input.hasAttribute('inert'), true, 'the folded field takes no focus and no Tab stop');
  assert.equal(head.classList.contains('is-searching'), false);

  btn.click();
  assert.equal(head.classList.contains('is-searching'), true);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(input.hasAttribute('inert'), false);
  assert.equal(ctx.doc.activeElement, input);
  assert.equal(meter.parentElement, box, 'open, the meter rides at the end of the field (the box slides over its resting place)');

  btn.click();
  assert.equal(head.classList.contains('is-searching'), false, 'the glyph on an empty field folds it');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(input.hasAttribute('inert'), true);
  assert.equal(ctx.doc.activeElement, btn, 'the focus goes to the button, never <body>');
  assert.equal(meter.nextElementSibling, box, 'folded, the meter is back beside the button');

  btn.click();
  typeInto(ctx, input, 'login');
  btn.focus();
  btn.click();
  assert.equal(head.classList.contains('is-searching'), true, 'a field with text stays open');
  assert.equal(ctx.doc.activeElement, input);
  assert.equal(input.value, 'login');
});

test('typing searches the server (debounced, trimmed ?q=): the matches render grouped, "n of N chats", a text hit shows its excerpt as plain text; a refresh keeps the query; no hit says "No chats match."', async () => {
  const rec = { lists: [] };
  const ctx = makePanel({ fetchHandler: searchApi(rec), now: () => NOW, innerWidth: 1700 });
  ctx.panel.open();
  await ticks(ctx);
  const { meter, btn, input } = searchHead(ctx);
  assert.deepEqual(rec.lists, ['/api/ask/threads?limit=50']);
  btn.click();
  typeInto(ctx, input, 'l');
  typeInto(ctx, input, 'lo');
  typeInto(ctx, input, ' login ');
  await ticks(ctx);
  assert.equal(rec.lists.length, 1, 'nothing before the debounce');
  await wait(DEBOUNCED);
  await ticks(ctx);
  assert.deepEqual(rec.lists.slice(1), ['/api/ask/threads?limit=50&q=login'], 'one request, the trimmed text');
  assert.deepEqual(titles(ctx), ['Fix the login bug', 'Offline sync banner']);
  assert.deepEqual([...ctx.doc.querySelectorAll('[data-chat-history] .chat-history-group')].map((g) => g.dataset.group), ['today', 'yesterday']);
  assert.equal(meter.textContent, '2 of 3 chats');
  const rowOf = (id) => ctx.doc.querySelector(`[data-chat-history] .ask-thread-row[data-thread-id="${id}"]`);
  const excerpt = rowOf('ask_00000002').querySelector('.ask-thread-match');
  assert.equal(excerpt.textContent, '…the <b>login</b> token expired…', 'the excerpt under the title, as text');
  assert.equal(excerpt.querySelector('b'), null, 'never parsed as HTML');
  assert.equal(excerpt.previousElementSibling.className, 'ask-thread-title');
  assert.equal(rowOf('ask_00000001').querySelector('.ask-thread-match'), null, 'a title hit shows no excerpt');
  assert.equal(ctx.doc.activeElement, input, 'typing kept the field (the head is never rebuilt)');
  assert.equal(searchHead(ctx).input, input);

  ctx.panel.pushServerFrame({ type: 'ask-title', threadId: 'ask_00000002', title: 'Renamed' });
  await wait(320);                                                         // past THREADS_REFRESH_MS
  await ticks(ctx);
  assert.equal(rec.lists.at(-1), '/api/ask/threads?limit=50&q=login', 'the debounced refresh keeps the query');
  assert.equal(meter.textContent, '2 of 3 chats');

  typeInto(ctx, input, 'zzz');
  await wait(DEBOUNCED);
  await ticks(ctx);
  assert.equal(rec.lists.at(-1), '/api/ask/threads?limit=50&q=zzz');
  assert.equal(ctx.doc.querySelector('[data-chat-history] .chat-history-empty').textContent, 'No chats match.');
  assert.equal(meter.textContent, '0 of 3 chats');
  assert.equal(ctx.doc.querySelectorAll('[data-chat-history] .ask-thread-row').length, 0);
  ctx.panel.destroy();
});

test('Escape clears the text first (the full list returns at once), then folds the field and focuses the button; folding with a search shown restores the list', async () => {
  const rec = { lists: [] };
  const ctx = makePanel({ fetchHandler: searchApi(rec), now: () => NOW, innerWidth: 1700 });
  ctx.panel.open();
  await ticks(ctx);
  const { head, meter, btn, input } = searchHead(ctx);
  btn.click();
  typeInto(ctx, input, 'login');
  await wait(DEBOUNCED);
  await ticks(ctx);
  assert.deepEqual(titles(ctx), ['Fix the login bug', 'Offline sync banner']);

  const first = key(ctx.window, input, 'Escape');
  assert.equal(first.defaultPrevented, true);
  assert.equal(input.value, '', 'the first Escape clears the text');
  assert.equal(head.classList.contains('is-searching'), true, 'and keeps the field open');
  assert.equal(ctx.doc.activeElement, input);
  await ticks(ctx);
  assert.equal(rec.lists.at(-1), '/api/ask/threads?limit=50', 'the full list at once, no debounce');
  assert.deepEqual(titles(ctx), ['Fix the login bug', 'Offline sync banner', 'Build the header']);
  assert.equal(meter.textContent, '3 chats');

  const second = key(ctx.window, input, 'Escape');
  assert.equal(second.defaultPrevented, true);
  assert.equal(head.classList.contains('is-searching'), false, 'the second Escape folds it');
  assert.equal(input.hasAttribute('inert'), true);
  assert.equal(ctx.doc.activeElement, btn);
  const fetched = rec.lists.length;
  await wait(DEBOUNCED);
  await ticks(ctx);
  assert.equal(rec.lists.length, fetched, 'nothing left to fetch');

  // Text cleared by hand, then folded inside the debounce: the full list comes back at once, once.
  btn.click();
  typeInto(ctx, input, 'login');
  await wait(DEBOUNCED);
  await ticks(ctx);
  assert.equal(meter.textContent, '2 of 3 chats');
  typeInto(ctx, input, '');
  btn.click();
  assert.equal(head.classList.contains('is-searching'), false);
  await ticks(ctx);
  assert.equal(rec.lists.at(-1), '/api/ask/threads?limit=50');
  assert.equal(meter.textContent, '3 chats');
  assert.equal(ctx.doc.querySelectorAll('[data-chat-history] .ask-thread-row').length, 3, 'folding restored the list');
  const after = rec.lists.length;
  await wait(DEBOUNCED);
  await ticks(ctx);
  assert.equal(rec.lists.length, after, 'the pending debounce went with the fold');
  ctx.panel.destroy();
});

test('below 1100px Escape in the search field clears and folds it before it closes the overlay', async () => {
  const rec = { lists: [] };
  const ctx = makePanel({ fetchHandler: searchApi(rec), now: () => NOW, innerWidth: 900 });
  ctx.panel.open();
  await ticks(ctx);
  const page = ctx.panel.root;
  const toggle = ctx.doc.querySelector('[data-ask-threads-btn]');
  toggle.click();
  await ticks(ctx);
  const { head, btn, input } = searchHead(ctx);
  btn.click();
  typeInto(ctx, input, 'login');
  key(ctx.window, input, 'Escape');
  assert.equal(input.value, '');
  assert.equal(page.dataset.history, 'open', 'the field took the first Escape');
  key(ctx.window, input, 'Escape');
  assert.equal(head.classList.contains('is-searching'), false);
  assert.equal(page.dataset.history, 'open', 'and the second');
  assert.equal(ctx.doc.activeElement, btn);
  key(ctx.window, btn, 'Escape');
  assert.equal(page.dataset.history, 'closed', 'the third closes the overlay');
  assert.equal(ctx.doc.activeElement, toggle);
  ctx.panel.destroy();
});

test('a failed search fetch asks again: the same text typed again retries, and a fold whose fetch failed restores the list on the next fold', async () => {
  const rec = { lists: [] };
  const fail = { q: true, full: false };
  const inner = searchApi(rec);
  const handler = (url, opts) => {
    if (url.startsWith('/api/ask/threads?') && (url.includes('&q=') ? fail.q : fail.full)) {
      rec.lists.push(url);
      return { ok: false, status: 500, json: async () => ({}) };
    }
    return inner(url, opts);
  };
  const ctx = makePanel({ fetchHandler: handler, now: () => NOW, innerWidth: 1700 });
  ctx.panel.open();
  await ticks(ctx);
  const { meter, btn, input } = searchHead(ctx);
  btn.click();
  typeInto(ctx, input, 'login');
  await wait(DEBOUNCED);
  await ticks(ctx);
  assert.equal(rec.lists.at(-1), '/api/ask/threads?limit=50&q=login');
  assert.equal(meter.textContent, '3 chats', 'the failed search left the full list');
  fail.q = false;
  typeInto(ctx, input, 'login');
  await wait(DEBOUNCED);
  await ticks(ctx);
  assert.equal(rec.lists.filter((u) => u.endsWith('&q=login')).length, 2, 'the same text asked again');
  assert.equal(meter.textContent, '2 of 3 chats');

  fail.full = true;
  key(ctx.window, input, 'Escape');
  await ticks(ctx);
  assert.equal(rec.lists.at(-1), '/api/ask/threads?limit=50');
  assert.equal(meter.textContent, '2 of 3 chats', 'the failed clear left the matches');
  fail.full = false;
  key(ctx.window, input, 'Escape');
  await ticks(ctx);
  assert.equal(ctx.doc.activeElement, btn);
  assert.equal(meter.textContent, '3 chats', 'the fold asked for the full list again');
  assert.equal(ctx.doc.querySelectorAll('[data-chat-history] .ask-thread-row').length, 3);
  ctx.panel.destroy();
});

test('New chat leads the column: a labelled button between the head and the date groups, [data-ask-new-btn] like the head\'s; a click starts a new chat and routes home', async () => {
  const routes = [];
  const ctx = makePanel({ fetchHandler: api({}), now: () => NOW, innerWidth: 1700, deps: { onRoute: (id, o) => routes.push([id, o]) } });
  ctx.panel.open({ threadId: 'ask_00000001' });
  await ticks(ctx);
  ctx.flush();
  const col = ctx.doc.querySelector('aside.chat-history[data-chat-history]');
  const nb = col.querySelector('button[data-ask-new-btn]');
  assert.ok(nb, 'the column has its own New chat');
  assert.equal(nb.type, 'button');
  assert.equal(nb.textContent, 'New chat', 'a visible label');
  assert.equal(nb.getAttribute('aria-label'), null, 'the label is its name');
  assert.equal(nb.querySelector('svg').getAttribute('aria-hidden'), 'true', 'the plus glyph is decoration');
  assert.ok(nb.classList.contains('chat-new-btn'), 'the head button\'s look (style.css)');
  const where = (c) => (c.classList.contains('chat-history-head') ? 'head' : c === nb ? 'new' : c.classList.contains('chat-history-body') ? 'body' : c.className);
  assert.deepEqual([...col.children].map(where), ['head', 'new', 'body'], 'outside the body the list repaints');
  assert.ok(nb.compareDocumentPosition(col.querySelector('.chat-history-group-label')) & ctx.window.Node.DOCUMENT_POSITION_FOLLOWING, 'above Today / Yesterday / Earlier');
  assert.equal(ctx.doc.querySelectorAll('[data-ask-new-btn]').length, 2, 'the head\'s and the column\'s');
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Fix the login bug');
  nb.click();
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'New chat');
  assert.deepEqual(routes.at(-1), [null, { replace: false }], 'home, pushed (as the head\'s)');
  assert.equal(col.querySelector('[aria-current="true"]'), null, 'no row is the open chat');
  assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('textarea.ask-input'), 'the composer of the new chat');
  assert.equal(ctx.panel.root.dataset.history, 'open', 'a push column stays open');
});

test('the column\'s New chat survives every repaint: a refresh, a search with matches, one with none', async () => {
  const rec = { lists: [] };
  const ctx = makePanel({ fetchHandler: searchApi(rec), now: () => NOW, innerWidth: 1700 });
  ctx.panel.open();
  await ticks(ctx);
  const col = ctx.doc.querySelector('[data-chat-history]');
  const nb = col.querySelector('[data-ask-new-btn]');
  const body = col.querySelector('.chat-history-body');
  const kept = (label) => {
    assert.equal(col.querySelector('[data-ask-new-btn]'), nb, `${label}: the same button`);
    assert.equal(nb.nextElementSibling, body, `${label}: still right above the rows`);
  };
  ctx.panel.pushServerFrame({ type: 'ask-title', threadId: 'ask_00000002', title: 'Renamed' });
  await wait(320);                                                         // past THREADS_REFRESH_MS
  await ticks(ctx);
  assert.equal(rec.lists.length, 2, 'the refresh repainted the rows');
  kept('a refresh');
  const { btn, input } = searchHead(ctx);
  btn.click();
  typeInto(ctx, input, 'login');
  await wait(DEBOUNCED);
  await ticks(ctx);
  assert.deepEqual(titles(ctx), ['Fix the login bug', 'Offline sync banner']);
  kept('a search');
  typeInto(ctx, input, 'zzz');
  await wait(DEBOUNCED);
  await ticks(ctx);
  assert.equal(col.querySelector('.chat-history-empty').textContent, 'No chats match.');
  kept('a search with no match');
  ctx.panel.destroy();
});

test('below 1100px New chat in the overlay closes it, as a pick does (never a stored choice): the new chat has its room and the composer the focus', async () => {
  const routes = [];
  const ctx = makePanel({ fetchHandler: api({}), innerWidth: 900, deps: { onRoute: (id, o) => routes.push([id, o]) } });
  ctx.panel.open({ threadId: 'ask_00000002' });
  await ticks(ctx);
  const page = ctx.panel.root;
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  assert.equal(page.dataset.history, 'open');
  const nb = ctx.doc.querySelector('[data-chat-history] [data-ask-new-btn]');
  nb.focus();
  assert.equal(page.dataset.history, 'open', 'Tab onto it stays inside the overlay');
  nb.click();
  assert.equal(page.dataset.history, 'closed', 'the overlay gives the new chat its room');
  assert.equal(ctx.doc.querySelector('[data-chat-scrim]').hidden, true);
  assert.equal(ctx.storage.getItem('worca-cc.chat.history'), null, 'never a stored choice');
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'New chat');
  assert.deepEqual(routes.at(-1), [null, { replace: false }]);
  assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('textarea.ask-input'), 'the button is hidden now: focus goes to the composer');
});

test('the search field\'s placeholder uses the Workflows Library\'s rendered colour (--ink-2), not the lighter --ink-3', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const rule = css.match(/\.chat-history-search-input::placeholder\{([^}]*)\}/);
  assert.ok(rule, 'the placeholder rule');
  assert.equal(rule[1], 'color:var(--ink-2);');
});

test('Today / Yesterday / Earlier read as sections: a divider and space before each following group, theme tokens only', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const sep = css.match(/\.chat-history-group \+ \.chat-history-group\{([^}]*)\}/);
  assert.ok(sep, 'the between-groups rule');
  assert.match(sep[1], /border-top:1px solid var\(--line-2\)/);
  assert.match(sep[1], /margin-top:(\d+)px/);
  assert.ok(Number(sep[1].match(/margin-top:(\d+)px/)[1]) > 6, 'more room than the old 6px');
  const label = css.match(/\.chat-history-group-label\{([^}]*)\}/);
  assert.ok(label, 'the label rule');
  assert.doesNotMatch(label[1], /#[0-9a-f]{3,8}\b|rgb/i, 'theme tokens, no colour literals');
});
