// test/ask-panel-history.test.mjs — worca Chat P1: the History aside, which hosts the Chats column (#948, #952): the
// toggle (aria-pressed, data-history, a stored choice, open by default from 1600px), the overlay below 1100px (scrim,
// Escape, a pick closes it), setHistoryOpen for P4, a pick that loads and routes once, delete through confirm, the
// keyboard focus around deletes and refreshes, and refreshes that wait while Chat is hidden. The column's own rows,
// views and keys: test/ui-chats-column.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel, key, deleteFromList } from './helpers/ask-panel-harness.mjs';

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
const listFetches = (rec) => rec.calls.filter((c) => c.startsWith('GET /api/ask/threads?')).length;
/** Chat `id`'s row link in the Chats column; a row in the folded Older section unfolds it first. */
function rowOf(ctx, id) {
  const sel = `[data-chat-history] a.runs-row[data-row-key="chat:${id}"]`;
  if (!ctx.doc.querySelector(sel)) ctx.doc.querySelector('[data-chat-history] [data-section="older"] .runs-sec-head')?.click();
  return ctx.doc.querySelector(sel);
}
const moreOf = (ctx, id) => rowOf(ctx, id).closest('.runs-item').querySelector('.runs-more');
const inColumn = (ctx) => ctx.doc.querySelector('[data-chat-history]').contains(ctx.doc.activeElement);

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
  rowOf(ctx, 'ask_00000002').click();
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
  const pick = () => rowOf(ctx, 'ask_00000003');
  const loads = () => rec.calls.filter((c) => c === 'GET /api/ask/threads/ask_00000003').length;
  pick().click();
  await ticks(ctx);
  ctx.flush();
  assert.equal(loads(), 1);
  assert.deepEqual(routes, [['ask_00000003', { replace: false }]]);
  assert.equal(pick().getAttribute('aria-current'), 'true');
  ctx.panel.open({ threadId: 'ask_00000003' });                       // the address echo
  pick().click();
  await ticks(ctx);
  assert.equal(loads(), 1, 'no reload');
});

test('⋯ › Delete… asks first; a confirmed delete refetches the column; deleting the open chat goes home and swaps the address', async () => {
  const rec = {};
  const routes = [];
  const confirms = [];
  const ctx = makePanel({ fetchHandler: api(rec), confirm: async (o) => { confirms.push(o); return true; }, deps: { onRoute: (id, o) => routes.push([id, o]) } });
  ctx.panel.open({ threadId: 'ask_00000001' });
  await ticks(ctx);
  const before = listFetches(rec);
  await deleteFromList(ctx, 'ask_00000001');
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

test('a Chats fetch that failed shows the offline note and is tried again on the next show', async () => {
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
  assert.ok(ctx.doc.querySelector('[data-chat-history] .runs-offline'));
  down = false;
  ctx.panel.close();
  ctx.panel.open();
  await ticks(ctx);
  assert.equal(listFetches(rec), 2, 'tried again');
  assert.equal(ctx.doc.querySelectorAll('[data-chat-history] a.runs-row').length, 3);
});

test('below 1100px the column starts closed even when "open" is the stored choice', async () => {
  const storage = { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } };
  storage.setItem('worca-cc.chat.history', 'open');
  const ctx = makePanel({ fetchHandler: api({}), innerWidth: 900, storage });
  assert.equal(ctx.panel.root.dataset.history, 'closed', 'an overlay never opens by itself');
  assert.equal(ctx.doc.querySelector('[data-chat-scrim]').hidden, true);
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
const laRow = (id, title, at = Date.now() - 60e3) => ({ id, title, createdAt: 't', updatedAt: new Date(at).toISOString(), model: null, effort: null, sessionId: null, context: null, totals: {} });
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
  rowOf(ctx, LA_X).click();
  await deleteFromList(ctx, LA_X);
  await ticks(ctx, 6);
  release();
  await ticks(ctx, 6);
  ctx.flush();
  assert.equal(ctx.panel.threadId(), null);
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'New chat');
  assert.deepEqual(routes.at(-1), [null, { replace: true }]);
});

test('a delete from the column keeps keyboard focus in it, Cancel or not; below 1100px the overlay stays and nothing is focused under its scrim', async () => {
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
      moreOf(ctx, LA_X).focus();
      await deleteFromList(ctx, LA_X);
      await ticks(ctx, 6);
      const label = `${width}px, confirm ${answer}`;
      assert.equal(ctx.panel.root.dataset.history, 'open', `${label}: the column stays`);
      assert.ok(inColumn(ctx), `${label}: focus stays in the column`);
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
  await deleteFromList(ctx, LA_A);
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
  const pick = rowOf(ctx, 'ask_00000001');
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
  rowOf(wide, 'ask_00000001').focus();
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
  assert.deepEqual([...ctx.doc.querySelectorAll('[data-chat-history] a.runs-row')].map((a) => a.dataset.rowKey), [`chat:${L}`]);
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
  await deleteFromList(ctx, LA_A);
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
  rowOf(ctx, LA_X).focus();
  ctx.panel.pushServerFrame({ type: 'ask-history-cleared' });
  assert.equal(ctx.panel.root.dataset.view, 'home');
  assert.equal(ctx.panel.root.dataset.history, 'open', 'the overlay stays');
  assert.ok(inColumn(ctx), 'the emptied column keeps the focus');
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
  moreOf(ctx, LA_X).focus();
  await deleteFromList(ctx, LA_X);
  await ticks(ctx, 8);
  assert.equal(ctx.doc.querySelectorAll('[data-chat-history] a.runs-row').length, 0, 'the column emptied');
  assert.equal(ctx.panel.root.dataset.history, 'open');
  assert.ok(inColumn(ctx));
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
  const t0 = Date.now();
  let order = [laRow(LA_A, 'A', t0 - 60e3), laRow(LA_X, 'X', t0 - 120e3), laRow(LA_C, 'C', t0 - 180e3)];
  const ctx = makePanel({
    innerWidth: 1700,
    fetchHandler: (url) => {
      if (url.startsWith('/api/ask/threads?')) return { ok: true, status: 200, json: async () => ({ threads: order, total: 3 }) };
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  ctx.panel.open();
  await ticks(ctx);
  const pickOf = (id) => rowOf(ctx, id);
  pickOf(LA_C).focus();
  order = [laRow(LA_C, 'C', t0), laRow(LA_A, 'A', t0 - 60e3), laRow(LA_X, 'X', t0 - 120e3)];
  ctx.panel.pushServerFrame({ type: 'ask-title', threadId: LA_C, title: 'C' });   // a refresh frame (C moved to the top)
  await new Promise((r) => setTimeout(r, 320));                        // past THREADS_REFRESH_MS
  await ticks(ctx);
  assert.equal(ctx.doc.querySelector('[data-chat-history] a.runs-row').dataset.rowKey, `chat:${LA_C}`, 'precondition: C leads now');
  assert.equal(ctx.doc.activeElement, pickOf(LA_C));
});

test('below 1100px the head\'s New chat + closes the overlay, as a pick does (never a stored choice): the new chat has its room and the composer the focus', async () => {
  const routes = [];
  const ctx = makePanel({ fetchHandler: api({}), innerWidth: 900, deps: { onRoute: (id, o) => routes.push([id, o]) } });
  ctx.panel.open({ threadId: 'ask_00000002' });
  await ticks(ctx);
  const page = ctx.panel.root;
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  assert.equal(page.dataset.history, 'open');
  ctx.doc.querySelector('.chat-head [data-ask-new-btn]').click();
  assert.equal(page.dataset.history, 'closed', 'the overlay gives the new chat its room');
  assert.equal(ctx.doc.querySelector('[data-chat-scrim]').hidden, true);
  assert.equal(ctx.storage.getItem('worca-cc.chat.history'), null, 'never a stored choice');
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'New chat');
  assert.deepEqual(routes.at(-1), [null, { replace: false }]);
  assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('textarea.ask-input'), 'focus goes to the composer');
});
