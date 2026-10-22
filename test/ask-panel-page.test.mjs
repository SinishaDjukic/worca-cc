// test/ask-panel-page.test.mjs — worca Chat P1: the Ask panel as the Chat page (the harness, no app boot). open/close
// mean "the page shows / hides", routing (open({threadId}), onRoute), home ↔ thread with the ONE composer moving
// between the hero slot and the dock, Escape ownership, the unread report, and where popovers live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel, key } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';

const TID = 'ask_00000001';
const TID2 = 'ask_00000002';
const MID = 'askm_00000001';
const threadRow = (id, title) => ({ id, title, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} });
const USER_ROW = { id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: 'hi', blocks: [], status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' };

function api(rec) {
  return (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    (rec.calls ||= []).push(`${method} ${url}`);
    if (url === '/api/ask/threads' && method === 'POST') return { ok: true, status: 201, json: async () => ({ thread: threadRow(TID2, null) }) };
    if (url === `/api/ask/threads/${TID2}/messages` && method === 'POST') return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000009', attachments: [], contexts: [] }) };
    if (url === `/api/ask/threads/${TID}` && method === 'GET') return { ok: true, status: 200, json: async () => ({ thread: threadRow(TID, 'First'), messages: [USER_ROW], attachments: [], runLinks: [], inFlight: null }) };
    if (url === '/api/ask/threads/ask_0000dead') return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}
const ticks = async (ctx, n = 3) => { for (let i = 0; i < n; i += 1) await ctx.tick(); };
const gets = (rec, id) => rec.calls.filter((c) => c === `GET /api/ask/threads/${id}`).length;

test('open() shows the page and focuses the composer; close() hides it, moves no focus, closes popovers and keeps the draft; appending opens nothing', async () => {
  const { panel, doc } = makePanel();
  const input = doc.querySelector('textarea.ask-input');
  assert.equal(panel.appendToComposer('note'), true);
  assert.equal(panel.isOpen(), false, 'appending routes nowhere: app.js openChat() routes to #chat first');
  panel.open();
  assert.equal(panel.isOpen(), true);
  assert.equal(doc.activeElement, input);
  panel.close();
  assert.equal(panel.isOpen(), false);
  assert.equal(doc.activeElement, input, 'close() moves no focus (there is no pill to return to)');
  panel.open();
  doc.querySelector('[data-ask-model-btn]').click();
  assert.ok(doc.querySelector('.ask-pop-model'));
  panel.close();
  assert.equal(doc.querySelector('.ask-pop'), null, 'leaving Chat closes popovers');
  assert.equal(input.value, 'note', 'the draft stays for the way back');
  assert.equal('toggle' in panel, false, 'toggle() is gone');
});

test('routing: open({threadId}) loads that chat once (the address echo is a no-op) and shows it as a thread, composer in the dock; open({threadId:null}) is home with the draft kept', async () => {
  const rec = {};
  const ctx = makePanel({ fetchHandler: api(rec) });
  ctx.storage.setItem('worca-cc.ask.thread', TID2);                  // a routed open never restores the stored pointer
  ctx.panel.open({ threadId: TID });
  await ticks(ctx);
  ctx.flush();
  assert.equal(gets(rec, TID), 1);
  assert.equal(gets(rec, TID2), 0, 'the route names the chat: the stored pointer is ignored');
  const page = ctx.panel.root;
  assert.equal(page.dataset.view, 'thread');
  assert.ok(page.querySelector('[data-chat-dock] > .ask-composer'));
  assert.equal(page.querySelector('[data-chat-hero-slot] .ask-composer'), null);
  assert.equal(page.querySelector('.ask-title').textContent, 'First');
  assert.equal(ctx.panel.threadId(), TID);
  ctx.panel.open({ threadId: TID });                                  // what onRoute's hashchange echo does
  await ticks(ctx);
  assert.equal(gets(rec, TID), 1, 'no second load');
  const input = ctx.doc.querySelector('textarea.ask-input');
  input.value = 'half a thought';
  ctx.panel.open({ threadId: null });
  ctx.flush();
  assert.equal(page.dataset.view, 'home');
  assert.ok(page.querySelector('[data-chat-hero-slot] > .ask-composer'));
  assert.equal(page.querySelector('.ask-title').textContent, 'New chat');
  assert.equal(input.value, 'half a thought', 'a new chat keeps the draft');
  assert.equal(ctx.panel.threadId(), null);
});

test('a bare open() (no route) restores the stored chat', async () => {
  const rec = {};
  const ctx = makePanel({ fetchHandler: api(rec) });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ticks(ctx);
  assert.equal(gets(rec, TID), 1);
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'First');
});

test('the first send creates the chat — onRoute(id, { replace: true }) — and the composer moves from the hero slot to the dock with focus kept; New chat routes home (pushed) and moves it back', async () => {
  const rec = {};
  const routes = [];
  const ctx = makePanel({ fetchHandler: api(rec), deps: { onRoute: (id, o) => routes.push([id, o]) } });
  ctx.panel.open({ threadId: null });
  await ticks(ctx);
  const page = ctx.panel.root;
  const input = ctx.doc.querySelector('textarea.ask-input');
  assert.equal(page.dataset.view, 'home');
  assert.equal(ctx.doc.activeElement, input);
  input.value = 'what changed?';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ticks(ctx, 5);
  ctx.flush();
  assert.deepEqual(routes, [[TID2, { replace: true }]]);
  assert.equal(page.dataset.view, 'thread');
  assert.ok(page.querySelector('[data-chat-dock] > .ask-composer'));
  assert.equal(ctx.doc.activeElement, input, 'focus survived the move');
  ctx.panel.open({ threadId: TID2 });                                 // an echo of that address: no reload
  await ticks(ctx);
  assert.equal(gets(rec, TID2), 0);
  ctx.doc.querySelector('.chat-head [data-ask-new-btn]').click();
  assert.deepEqual(routes.at(-1), [null, { replace: false }]);
  ctx.flush();
  assert.equal(page.dataset.view, 'home');
  assert.ok(page.querySelector('[data-chat-hero-slot] > .ask-composer'));
  assert.equal(ctx.doc.activeElement, input);
});

test('a routed chat that is gone (404) lands on home and replaces the address', async () => {
  const rec = {};
  const routes = [];
  const ctx = makePanel({ fetchHandler: api(rec), deps: { onRoute: (id, o) => routes.push([id, o]) } });
  ctx.panel.open({ threadId: 'ask_0000dead' });
  await ticks(ctx);
  assert.deepEqual(routes, [[null, { replace: true }]]);
  assert.equal(ctx.panel.root.dataset.view, 'home');
  assert.equal(ctx.panel.threadId(), null);
});

const snapOf = (id, title) => ({ thread: threadRow(id, title), messages: [{ ...USER_ROW, threadId: id }], attachments: [], runLinks: [], inFlight: null });

test('a chat that fails to load (a 500, offline) gives its place back: the shown chat stays current, the address follows it, a later pick tries again', async () => {
  const A = 'ask_0000000a';
  const X = 'ask_0000000b';
  let down = true;
  const calls = [];
  const routes = [];
  const ctx = makePanel({
    fetchHandler: (url, opts) => {
      calls.push(`${(opts.method || 'GET').toUpperCase()} ${url}`);
      if (url === `/api/ask/threads/${A}`) return { ok: true, status: 200, json: async () => snapOf(A, 'Chat A') };
      if (url === `/api/ask/threads/${X}`) {
        return down ? { ok: false, status: 500, json: async () => ({ error: 'boom' }) } : { ok: true, status: 200, json: async () => snapOf(X, 'Chat X') };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
    deps: { onRoute: (id, o) => routes.push([id, o]) },
  });
  ctx.panel.open({ threadId: A });
  await ticks(ctx);
  ctx.flush();
  ctx.panel.open({ threadId: X });
  await ticks(ctx);
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Chat A', 'chat A stays on screen');
  assert.equal(ctx.panel.threadId(), A, 'and is the chat shown');
  assert.deepEqual(routes.at(-1), [A, { replace: true }], 'the address goes back to it');
  assert.equal(ctx.storage.getItem('worca-cc.ask.thread'), A);
  down = false;
  ctx.panel.open({ threadId: X });
  await ticks(ctx);
  ctx.flush();
  assert.equal(calls.filter((c) => c === `GET /api/ask/threads/${X}`).length, 2, 'the pick tried again');
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Chat X');
});

test('a chat that is still loading is a thread already: home never shows before it', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const ctx = makePanel({
    fetchHandler: (url) => (url === `/api/ask/threads/${TID}`
      ? held.then(() => ({ ok: true, status: 200, json: async () => snapOf(TID, 'First') }))
      : { ok: true, status: 200, json: async () => ({}) }),
  });
  ctx.panel.open({ threadId: null });
  await ticks(ctx);
  assert.equal(ctx.panel.root.dataset.view, 'home');
  ctx.panel.open({ threadId: TID });                                   // Back to a chat, or a pasted address
  assert.equal(ctx.panel.root.dataset.view, 'thread', 'no home flash while the GET is out');
  assert.ok(ctx.panel.root.querySelector('[data-chat-dock] > .ask-composer'));
  release();
  await ticks(ctx);
  ctx.flush();
  assert.equal(ctx.panel.root.dataset.view, 'thread');
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'First');
});

test('a reconnect while another chat loads never drops the switch', async () => {
  const A = 'ask_0000000a';
  const X = 'ask_0000000b';
  let releaseX;
  const xHeld = new Promise((r) => { releaseX = r; });
  const ctx = makePanel({
    fetchHandler: (url) => {
      if (url === `/api/ask/threads/${A}`) return { ok: true, status: 200, json: async () => snapOf(A, 'Chat A') };
      if (url === `/api/ask/threads/${X}`) return xHeld.then(() => ({ ok: true, status: 200, json: async () => snapOf(X, 'Chat X') }));
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  ctx.panel.open({ threadId: A });
  await ticks(ctx);
  ctx.flush();
  ctx.panel.open({ threadId: X });                                     // its GET is held
  ctx.panel.onHello([]);                                               // the socket reconnected meanwhile
  await ticks(ctx);
  releaseX();
  await ticks(ctx);
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Chat X');
  assert.equal(ctx.panel.threadId(), X);
});

test('text appended while the page is hidden is sized when the page shows (a hidden textarea measures 0px)', async () => {
  const { panel, doc } = makePanel();
  const input = doc.querySelector('textarea.ask-input');
  Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => (panel.isOpen() ? 57 : 0) });
  panel.appendToComposer('[diff comment dc_1 — a.js:3 (new)] "why?"');
  assert.equal(input.style.height, '0px', 'measured while hidden');
  panel.open();
  assert.equal(input.style.height, '57px', 'measured again once shown');
});

test('a pinned transcript stays at the bottom when its column grows with no frame (a card that lays out late); a scrolled-up one stays put', async () => {
  const ctx = makePanel({ fetchHandler: api({}), resizeObserver: true });
  ctx.panel.open({ threadId: TID });
  await ticks(ctx);
  ctx.flush();
  const col = ctx.doc.querySelector('.ask-transcript-col');
  const ro = ctx.resizeObservers.find((o) => o.targets.includes(col)) || ctx.resizeObservers[0];   // the composer's scope button observes its row too
  assert.ok(ro.targets.includes(col), 'the panel observes the transcript column');
  const t = ctx.doc.querySelector('.ask-transcript');
  let sh = 1000;
  Object.defineProperty(t, 'scrollHeight', { configurable: true, get: () => sh });
  Object.defineProperty(t, 'clientHeight', { configurable: true, value: 400 });
  t.scrollTop = 600;                                                   // at the bottom: pinned
  t.dispatchEvent(new ctx.window.Event('scroll'));
  sh = 1300;                                                           // a card grew after the flush
  ro.cb([{ target: col }], ro);
  assert.equal(t.scrollTop, 1300, 'followed to the new bottom');
  t.scrollTop = 200;                                                   // the user scrolled up
  t.dispatchEvent(new ctx.window.Event('scroll'));
  sh = 1600;
  ro.cb([{ target: col }], ro);
  assert.equal(t.scrollTop, 200, 'not pinned: left where the user put it');
});

test('the scroll event of our own pin write never unpins, even when the column grew again before it arrived', async () => {
  const ctx = makePanel({ fetchHandler: api({}) });
  ctx.panel.open({ threadId: TID });
  await ticks(ctx);
  ctx.flush();
  const t = ctx.doc.querySelector('.ask-transcript');
  let sh = 1000;
  Object.defineProperty(t, 'scrollHeight', { configurable: true, get: () => sh });
  Object.defineProperty(t, 'clientHeight', { configurable: true, value: 400 });
  ctx.panel.close();
  ctx.panel.open();
  ctx.flush();                                                         // showing again re-pins: the pin writes the bottom
  assert.equal(t.scrollTop, 1000);
  sh = 1500;                                                           // a card grew before that write's scroll event
  t.dispatchEvent(new ctx.window.Event('scroll'));
  assert.equal(t.scrollTop, 1500, 'still pinned: followed to the new bottom');
  assert.equal(ctx.doc.querySelector('.ask-jump').hidden, true);
  t.scrollTop = 300;                                                   // the user scrolls up
  t.dispatchEvent(new ctx.window.Event('scroll'));
  assert.equal(ctx.doc.querySelector('.ask-jump').hidden, false, 'a real scroll up still unpins');
});

test('Escape closes an open popover (focus back on its trigger), never under a dialog; with nothing open it is not the page\'s', async () => {
  const { panel, window, doc } = makePanel();
  panel.open();
  const input = doc.querySelector('textarea.ask-input');
  const e0 = key(window, input, 'Escape');
  assert.equal(e0.defaultPrevented, false, 'nothing open: nothing to close');
  assert.equal(panel.isOpen(), true);
  const trigger = doc.querySelector('[data-ask-model-btn]');
  trigger.click();
  const modal = doc.createElement('div');
  modal.className = 'viewer-modal';
  doc.body.appendChild(modal);
  key(window, input, 'Escape');
  assert.ok(doc.querySelector('.ask-pop-model'), 'a dialog over the page owns Escape');
  modal.classList.add('hidden');
  panel.root.setAttribute('inert', '');               // the phone drawer is open: app.js makes .main, the page's ancestor, inert
  const drawerBtn = doc.createElement('button');
  doc.body.appendChild(drawerBtn);
  const ei = key(window, drawerBtn, 'Escape');
  assert.equal(ei.defaultPrevented, false, 'an inert page (under the phone drawer) leaves Escape to the drawer');
  assert.ok(doc.querySelector('.ask-pop-model'), 'the popover under the drawer stays');
  panel.root.removeAttribute('inert');
  const inPanel = doc.createElement('button');
  panel.root.querySelector('[data-chat-panel]').appendChild(inPanel);
  const e1 = key(window, inPanel, 'Escape');
  assert.equal(e1.defaultPrevented, false, 'a key inside the run panel is the panel\'s (P4)');
  assert.ok(doc.querySelector('.ask-pop-model'));
  const e2 = key(window, input, 'Escape');
  assert.equal(e2.defaultPrevented, true);
  assert.equal(doc.querySelector('.ask-pop-model'), null);
  assert.equal(doc.activeElement, trigger);
});

test('unread: a reply that ends while the page is hidden reports onUnread(true), showing the page reports onUnread(false); a reply on screen reports nothing', async () => {
  const frames = () => stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-delta', text: 'partial' },
    { type: 'ask-done' },
  ], { threadId: TID, messageId: MID });
  const hidden = [];
  const a = makePanel({ fetchHandler: api({}), deps: { onUnread: (on) => hidden.push(on) } });
  a.panel.open({ threadId: TID });
  await ticks(a);
  a.flush();
  a.panel.close();
  for (const f of frames()) a.panel.pushServerFrame(f);
  a.flush();
  assert.deepEqual(hidden, [true]);
  a.panel.open();
  assert.deepEqual(hidden, [true, false]);
  const shown = [];
  const b = makePanel({ fetchHandler: api({}), deps: { onUnread: (on) => shown.push(on) } });
  b.panel.open({ threadId: TID });
  await ticks(b);
  b.flush();
  for (const f of frames()) b.panel.pushServerFrame(f);
  b.flush();
  assert.deepEqual(shown, [], 'read as it landed');
});

test('unread across chats: a reply in another chat this tab asked in lights the dot too; the most recent one is the dot\'s chat; a chat never asked in is ignored; showing the page clears it', async () => {
  const ids = ['ask_0000000a', 'ask_0000000b'];
  let next = 0;
  const calls = [];
  const ctx = makePanel({
    fetchHandler: (url, opts) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (url === '/api/ask/threads' && method === 'POST') return { ok: true, status: 201, json: async () => ({ thread: threadRow(ids[next++], null) }) };
      if (/\/messages$/.test(url) && method === 'POST') return { ok: true, status: 202, json: async () => ({ userMessageId: `askm_u000000${next}`, attachments: [], contexts: [] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    },
    deps: { onUnread: (on) => calls.push(on) },
  });
  ctx.panel.open({ threadId: null });
  await ticks(ctx);
  const send = async (text) => {
    ctx.doc.querySelector('textarea.ask-input').value = text;
    ctx.doc.querySelector('[data-ask-send]').click();
    await ticks(ctx, 5);
    ctx.flush();
  };
  await send('first');                                                // chat a
  ctx.doc.querySelector('.chat-head [data-ask-new-btn]').click();
  await send('second');                                               // chat b
  ctx.doc.querySelector('.chat-head [data-ask-new-btn]').click();                // home: neither chat is open
  ctx.panel.close();
  const done = (threadId) => ({ type: 'ask-done', threadId, messageId: `askm_${threadId.slice(4)}`, seq: 3 });
  ctx.panel.pushServerFrame(done('ask_0000000a'));
  assert.equal(ctx.panel.unreadThreadId(), 'ask_0000000a');
  ctx.panel.pushServerFrame(done('ask_0000000b'));
  assert.equal(ctx.panel.unreadThreadId(), 'ask_0000000b', 'the most recent reply is the dot\'s chat');
  ctx.panel.pushServerFrame(done('ask_0000ffff'));                    // another tab's chat, or the Workflows chat
  assert.equal(ctx.panel.unreadThreadId(), 'ask_0000000b');
  assert.deepEqual(calls, [true]);
  ctx.panel.open();
  assert.equal(ctx.panel.unreadThreadId(), null);
  assert.deepEqual(calls, [true, false]);
});

test('composer popovers ride the composer and stay open across the home → thread move; other popovers sit in the conversation column', async () => {
  const rec = {};
  const ctx = makePanel({ fetchHandler: api(rec) });
  ctx.panel.open({ threadId: null });
  await ticks(ctx);
  ctx.doc.querySelector('[data-ask-model-btn]').click();
  const pop = ctx.doc.querySelector('.ask-pop-model');
  assert.equal(pop.parentElement, ctx.doc.querySelector('.ask-composer'));
  ctx.panel.open({ threadId: TID });                                  // a chat with a message: the composer moves to the dock
  await ticks(ctx);
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-pop-model'), pop, 'the same popover, still open');
  assert.ok(ctx.doc.querySelector('[data-chat-dock] > .ask-composer > .ask-pop-model'));
});

test('a chat whose GET never answers (offline) or answers unreadable JSON gives its place back too', async () => {
  const A = 'ask_0000000a';
  const X = 'ask_0000000b';
  for (const kind of ['offline', 'bad-json']) {
    const routes = [];
    const ctx = makePanel({
      fetchHandler: (url) => {
        if (url === `/api/ask/threads/${A}`) return { ok: true, status: 200, json: async () => snapOf(A, 'Chat A') };
        if (url === `/api/ask/threads/${X}`) {
          return kind === 'offline' ? Promise.reject(new TypeError('Failed to fetch'))
            : { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      },
      deps: { onRoute: (id, o) => routes.push([id, o]) },
    });
    ctx.panel.open({ threadId: A });
    await ticks(ctx);
    ctx.flush();
    ctx.panel.open({ threadId: X });
    await ticks(ctx);
    ctx.flush();
    assert.equal(ctx.panel.threadId(), A, `${kind}: the shown chat stays current`);
    assert.deepEqual(routes.at(-1), [A, { replace: true }], `${kind}: the address goes back to it`);
    assert.equal(ctx.storage.getItem('worca-cc.ask.thread'), A, `${kind}: so does the stored pointer`);
    assert.equal(ctx.panel.root.dataset.view, 'thread', `${kind}: chat A is still a thread`);
  }
});

test('the conversation column is observed too (the rail, the history column and the run panel resize it with no window resize)', async () => {
  const ctx = makePanel({ fetchHandler: api({}), resizeObserver: true });
  ctx.panel.open({ threadId: TID });
  await ticks(ctx);
  ctx.flush();
  const convo = ctx.doc.querySelector('.chat-convo');
  const ro = ctx.resizeObservers.find((o) => o.targets.includes(convo)) || ctx.resizeObservers[0];
  assert.ok(ro.targets.includes(convo), 'the panel observes the conversation column');
  const t = ctx.doc.querySelector('.ask-transcript');
  let sh = 1000;
  Object.defineProperty(t, 'scrollHeight', { configurable: true, get: () => sh });
  Object.defineProperty(t, 'clientHeight', { configurable: true, value: 400 });
  t.scrollTop = 600;
  t.dispatchEvent(new ctx.window.Event('scroll'));
  sh = 1250;                                                           // the column narrowed: the text re-wrapped taller
  ro.cb([{ target: convo }], ro);
  assert.equal(t.scrollTop, 1250, 'a pinned transcript follows');
});

test('Jump to latest records its own write: the scroll event that follows keeps the pin even when the column grew meanwhile', async () => {
  const ctx = makePanel({ fetchHandler: api({}) });
  ctx.panel.open({ threadId: TID });
  await ticks(ctx);
  ctx.flush();
  const t = ctx.doc.querySelector('.ask-transcript');
  let sh = 1000;
  Object.defineProperty(t, 'scrollHeight', { configurable: true, get: () => sh });
  Object.defineProperty(t, 'clientHeight', { configurable: true, value: 400 });
  t.scrollTop = 100;                                                   // the user scrolled up: unpinned, the pill shows
  t.dispatchEvent(new ctx.window.Event('scroll'));
  const jump = ctx.doc.querySelector('.ask-jump');
  assert.equal(jump.hidden, false);
  jump.click();
  assert.equal(t.scrollTop, 1000);
  sh = 1800;                                                           // a card grew before the jump's scroll event arrived
  t.dispatchEvent(new ctx.window.Event('scroll'));
  assert.equal(t.scrollTop, 1800, 'still pinned: followed to the new bottom');
  assert.equal(jump.hidden, true);
});

test('a reply in another chat this tab asked in lights nothing while Chat is on screen', async () => {
  const ids = ['ask_0000000a', 'ask_0000000b'];
  let next = 0;
  const calls = [];
  const ctx = makePanel({
    fetchHandler: (url, opts) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (url === '/api/ask/threads' && method === 'POST') return { ok: true, status: 201, json: async () => ({ thread: threadRow(ids[next++], null) }) };
      if (/\/messages$/.test(url) && method === 'POST') return { ok: true, status: 202, json: async () => ({ userMessageId: `askm_u000000${next}`, attachments: [], contexts: [] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    },
    deps: { onUnread: (on) => calls.push(on) },
  });
  ctx.panel.open({ threadId: null });
  await ticks(ctx);
  ctx.doc.querySelector('textarea.ask-input').value = 'first';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ticks(ctx, 5);
  ctx.flush();
  ctx.doc.querySelector('.chat-head [data-ask-new-btn]').click();                // home: chat a is not the open chat
  ctx.panel.pushServerFrame({ type: 'ask-done', threadId: 'ask_0000000a', messageId: 'askm_0000000a', seq: 3 });
  assert.deepEqual(calls, [], 'Chat is on screen: nothing unread');
  assert.equal(ctx.panel.unreadThreadId(), null);
});

test('an error that ends a reply in another chat this tab asked in lights the dot too', async () => {
  const calls = [];
  const ctx = makePanel({
    fetchHandler: (url, opts) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (url === '/api/ask/threads' && method === 'POST') return { ok: true, status: 201, json: async () => ({ thread: threadRow('ask_0000000a', null) }) };
      if (/\/messages$/.test(url) && method === 'POST') return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', attachments: [], contexts: [] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    },
    deps: { onUnread: (on) => calls.push(on) },
  });
  ctx.panel.open({ threadId: null });
  await ticks(ctx);
  ctx.doc.querySelector('textarea.ask-input').value = 'first';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ticks(ctx, 5);
  ctx.flush();
  ctx.doc.querySelector('.chat-head [data-ask-new-btn]').click();
  ctx.panel.close();
  ctx.panel.pushServerFrame({ type: 'ask-error', threadId: 'ask_0000000a', messageId: 'askm_0000000a', seq: 3, error: 'boom' });
  assert.deepEqual(calls, [true]);
  assert.equal(ctx.panel.unreadThreadId(), 'ask_0000000a');
});

test('"Delete all chat history" while a chat shows goes home and swaps the address', async () => {
  const routes = [];
  const ctx = makePanel({ fetchHandler: api({}), deps: { onRoute: (id, o) => routes.push([id, o]) } });
  ctx.panel.open({ threadId: TID });
  await ticks(ctx);
  ctx.flush();
  ctx.panel.pushServerFrame({ type: 'ask-history-cleared' });
  assert.deepEqual(routes.at(-1), [null, { replace: true }]);
  assert.equal(ctx.panel.threadId(), null);
  ctx.flush();
  assert.equal(ctx.panel.root.dataset.view, 'home');
});

test('threadId() names the chat being loaded (app.js reopens it from another page), not the one it replaces', async () => {
  const A = 'ask_0000000a';
  const X = 'ask_0000000b';
  let releaseX;
  const xHeld = new Promise((r) => { releaseX = r; });
  const ctx = makePanel({
    fetchHandler: (url) => {
      if (url === `/api/ask/threads/${A}`) return { ok: true, status: 200, json: async () => snapOf(A, 'Chat A') };
      if (url === `/api/ask/threads/${X}`) return xHeld.then(() => ({ ok: true, status: 200, json: async () => snapOf(X, 'Chat X') }));
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  ctx.panel.open({ threadId: A });
  await ticks(ctx);
  ctx.flush();
  ctx.panel.open({ threadId: X });
  assert.equal(ctx.panel.threadId(), X, 'the address already names X');
  releaseX();
  await ticks(ctx);
});

test('a press in a dialog, the diff comment card, the terminal or the top bar search keeps an open popover; a press elsewhere closes it', async () => {
  const { panel, window, doc } = makePanel();
  panel.open();
  const press = (el) => el.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  for (const [tag, attrs] of [['div', { id: 'confirm-modal' }], ['div', { class: 'hd-cmt-card' }], ['div', { class: 'term-pane' }], ['div', { class: 'tsearch' }]]) {
    const host = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) host.setAttribute(k, v);
    const inner = doc.createElement('button');
    host.appendChild(inner);
    doc.body.appendChild(host);
    doc.querySelector('[data-ask-model-btn]').click();
    assert.ok(doc.querySelector('.ask-pop-model'), 'opened');
    press(inner);
    assert.ok(doc.querySelector('.ask-pop-model'), `a press inside ${JSON.stringify(attrs)} keeps the popover`);
    doc.querySelector('[data-ask-model-btn]').click();               // toggles it closed for the next round
    host.remove();
  }
  doc.querySelector('[data-ask-model-btn]').click();
  const elsewhere = doc.createElement('div');
  doc.body.appendChild(elsewhere);
  press(elsewhere);
  assert.equal(doc.querySelector('.ask-pop-model'), null, 'a press elsewhere closes it');
});

test('Escape from the terminal pane, or under a running tour, is never the page\'s', async () => {
  const { panel, window, doc } = makePanel();
  panel.open();
  doc.querySelector('[data-ask-model-btn]').click();
  const term = doc.createElement('div');
  term.className = 'term-pane';
  const ta = doc.createElement('textarea');
  term.appendChild(ta);
  doc.body.appendChild(term);
  const e1 = key(window, ta, 'Escape');
  assert.equal(e1.defaultPrevented, false, 'vim / less in the terminal keep Escape');
  assert.ok(doc.querySelector('.ask-pop-model'));
  const tour = doc.createElement('div');
  tour.className = 'guide-layer';
  doc.body.appendChild(tour);
  const e2 = key(window, doc.querySelector('textarea.ask-input'), 'Escape');
  assert.equal(e2.defaultPrevented, false, 'a running tour owns Escape');
  assert.ok(doc.querySelector('.ask-pop-model'));
});

// ---- a chat that is still loading (a History pick, Back to a chat) ----
const LA_A = 'ask_0000000a';
const LA_X = 'ask_0000000b';
const laRow = (id, title) => ({ id, title, createdAt: 't', updatedAt: new Date(1_000_000).toISOString(), model: null, effort: null, sessionId: null, context: null, totals: {} });
const laUser = (tid) => ({ id: 'askm_u0000001', threadId: tid, seq: 1, role: 'user', text: 'hi', blocks: [], status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' });
const laSnap = (id, title, extra = {}) => ({ thread: laRow(id, title), messages: [laUser(id)], attachments: [], runLinks: [], inFlight: null, ...extra });

test('a send while another chat loads waits for it: nothing is posted, the draft stays, the load lands', async () => {
  for (const from of [null, LA_A]) {
    let release;
    const held = new Promise((r) => { release = r; });
    const calls = [];
    const routes = [];
    const ctx = makePanel({
      fetchHandler: (url, opts) => {
        const m = (opts.method || 'GET').toUpperCase();
        calls.push(`${m} ${url}`);
        if (url === `/api/ask/threads/${LA_A}`) return { ok: true, status: 200, json: async () => laSnap(LA_A, 'Chat A') };
        if (url === `/api/ask/threads/${LA_X}`) return held.then(() => ({ ok: true, status: 200, json: async () => laSnap(LA_X, 'Chat X') }));
        if (m === 'POST') return { ok: true, status: 201, json: async () => ({ thread: laRow('ask_0000000c', null) }) };
        return { ok: true, status: 200, json: async () => ({}) };
      },
      deps: { onRoute: (id, o) => routes.push([id, o]) },
    });
    ctx.panel.open({ threadId: from });
    await ticks(ctx);
    ctx.flush();
    ctx.panel.open({ threadId: LA_X });                                // a History pick / Back: the GET is out
    const input = ctx.doc.querySelector('textarea.ask-input');
    input.value = 'for chat X';
    ctx.doc.querySelector('[data-ask-send]').click();
    await ticks(ctx, 5);
    assert.equal(calls.filter((c) => c.startsWith('POST /api/ask/threads')).length, 0, `from ${from}: nothing is posted while X loads`);
    assert.equal(input.value, 'for chat X', 'the draft stays');
    release();
    await ticks(ctx, 5);
    ctx.flush();
    assert.equal(ctx.panel.threadId(), LA_X);
    assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Chat X');
    assert.deepEqual(routes, [], 'no address swap away from X');
  }
});

test('a switch the user makes while a first send creates its chat wins: nothing is sent, the draft stays', async () => {
  let releaseCreate;
  const createHeld = new Promise((r) => { releaseCreate = r; });
  const calls = [];
  const routes = [];
  const ctx = makePanel({
    fetchHandler: (url, opts) => {
      const m = (opts.method || 'GET').toUpperCase();
      calls.push(`${m} ${url}`);
      if (url === '/api/ask/threads' && m === 'POST') return createHeld.then(() => ({ ok: true, status: 201, json: async () => ({ thread: laRow('ask_0000000c', null) }) }));
      if (url === `/api/ask/threads/${LA_A}`) return { ok: true, status: 200, json: async () => laSnap(LA_A, 'Chat A') };
      return { ok: true, status: 200, json: async () => ({}) };
    },
    deps: { onRoute: (id, o) => routes.push([id, o]) },
  });
  ctx.panel.open({ threadId: null });
  await ticks(ctx);
  const input = ctx.doc.querySelector('textarea.ask-input');
  input.value = 'question';
  ctx.doc.querySelector('[data-ask-send]').click();                   // POST /api/ask/threads is out
  await ticks(ctx);
  ctx.panel.open({ threadId: LA_A });                                  // Back to chat A meanwhile
  await ticks(ctx, 3);
  releaseCreate();
  await ticks(ctx, 6);
  ctx.flush();
  assert.equal(ctx.panel.threadId(), LA_A, 'chat A shows');
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Chat A');
  assert.equal(calls.filter((c) => /\/messages$/.test(c)).length, 0, 'the message is not sent');
  assert.equal(input.value, 'question');
  assert.deepEqual(routes, [], 'A\'s address is never swapped');
});

test('a reconnect skipped during a switch that then fails is made up once the shown chat is given back', async () => {
  const MID_A = 'askm_0000000a';
  let turnOver = false;
  let releaseX;
  const xHeld = new Promise((r) => { releaseX = r; });
  const ctx = makePanel({
    fetchHandler: (url) => {
      if (url === `/api/ask/threads/${LA_A}`) {
        const done = { id: MID_A, threadId: LA_A, seq: 2, role: 'assistant', text: 'answer', blocks: [], status: 'done', reason: null, model: 'm', effort: 'high', usage: null, costUsd: null, durationMs: 5, createdAt: 't' };
        return { ok: true, status: 200, json: async () => (turnOver ? laSnap(LA_A, 'Chat A', { messages: [laUser(LA_A), done] }) : laSnap(LA_A, 'Chat A', { inFlight: { messageId: MID_A, startedAt: new Date(999_000).toISOString() } })) };
      }
      if (url === `/api/ask/threads/${LA_X}`) return xHeld.then(() => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }));
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  ctx.panel.open({ threadId: LA_A });
  await ticks(ctx);
  ctx.flush();
  for (const f of stampFrames([{ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' }, { type: 'ask-delta', text: 'part' }], { threadId: LA_A, messageId: MID_A })) ctx.panel.pushServerFrame(f);
  ctx.flush();
  const stop = ctx.doc.querySelector('[data-ask-stop]');
  assert.equal(stop.hidden, false, 'streaming');
  ctx.panel.open({ threadId: LA_X });
  turnOver = true;                                                     // the turn ended while the socket was down
  ctx.panel.onHello([]);
  await ticks(ctx);
  releaseX();
  await ticks(ctx, 8);
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Chat A');
  assert.equal(stop.hidden, true, 'the given-back chat was re-synced: no Stop for a turn that ended');
});

test('an Escape another handler already took (P4 closes its run panel first) never closes a popover too', async () => {
  const { panel, window, doc } = makePanel();
  panel.open();
  doc.querySelector('[data-ask-model-btn]').click();
  window.addEventListener('keydown', (e) => e.preventDefault(), { capture: true, once: true });
  key(window, doc.querySelector('textarea.ask-input'), 'Escape');
  assert.ok(doc.querySelector('.ask-pop-model'), 'one Escape closes one thing');
  key(window, doc.querySelector('textarea.ask-input'), 'Escape');
  assert.equal(doc.querySelector('.ask-pop-model'), null);
});

test('contextChanged() (P4: the run panel changed its run with no hashchange) previews the Sets again', async () => {
  const rec = {};
  const ctx = makePanel({ fetchHandler: api(rec) });
  ctx.panel.open();
  await ticks(ctx);
  const previews = () => rec.calls.filter((c) => c === 'POST /api/ask/mcp-preview').length;
  const before = previews();
  ctx.panel.contextChanged();
  await ticks(ctx);
  assert.equal(previews(), before + 1);
});

test('a composer add-on waits too while a chat loads: a direction never acts on the chat being left', async () => {
  const { registerComposerAddon, _resetChatExtensions } = await import('../ui/public/chat/extensions.mjs');
  _resetChatExtensions();
  const seen = [];
  registerComposerAddon({ id: 'probe', mount: (lead, c) => ({ beforeSend: (text) => { seen.push([text, c.threadId()]); return true; } }) });
  try {
    let release;
    const held = new Promise((r) => { release = r; });
    const ctx = makePanel({
      fetchHandler: (url) => {
        if (url === `/api/ask/threads/${LA_A}`) return { ok: true, status: 200, json: async () => laSnap(LA_A, 'Chat A') };
        if (url === `/api/ask/threads/${LA_X}`) return held.then(() => ({ ok: true, status: 200, json: async () => laSnap(LA_X, 'Chat X') }));
        return { ok: true, status: 200, json: async () => ({}) };
      },
    });
    ctx.panel.open({ threadId: LA_A });
    await ticks(ctx);
    ctx.flush();
    ctx.panel.open({ threadId: LA_X });                                // a History pick / Back: the GET is out
    const input = ctx.doc.querySelector('textarea.ask-input');
    input.value = 'go left';
    ctx.doc.querySelector('[data-ask-send]').click();
    await ticks(ctx, 5);
    assert.deepEqual(seen, [], 'no add-on ran while X loads');
    assert.equal(input.value, 'go left', 'the draft stays');
    release();
    await ticks(ctx, 5);
    ctx.flush();
    ctx.doc.querySelector('[data-ask-send]').click();
    await ticks(ctx, 3);
    assert.deepEqual(seen, [['go left', LA_X]], 'once X shows, the add-on acts on X');
  } finally { _resetChatExtensions(); }
});

test('a reconnect resync still out when a failed switch gives its chat back runs again once it settles', async () => {
  const MID_A = 'askm_0000000a';
  let turnOver = false;
  let aGets = 0;
  let releaseA;
  const aHeld = new Promise((r) => { releaseA = r; });
  let releaseX;
  const xHeld = new Promise((r) => { releaseX = r; });
  const snapA = () => {
    const done = { id: MID_A, threadId: LA_A, seq: 2, role: 'assistant', text: 'answer', blocks: [], status: 'done', reason: null, model: 'm', effort: 'high', usage: null, costUsd: null, durationMs: 5, createdAt: 't' };
    return turnOver ? laSnap(LA_A, 'Chat A', { messages: [laUser(LA_A), done] }) : laSnap(LA_A, 'Chat A', { inFlight: { messageId: MID_A, startedAt: new Date(999_000).toISOString() } });
  };
  const ctx = makePanel({
    fetchHandler: (url) => {
      if (url === `/api/ask/threads/${LA_A}`) {
        aGets += 1;
        if (aGets === 2) return aHeld.then(() => ({ ok: true, status: 200, json: async () => snapA() }));   // the reconnect's resync
        return { ok: true, status: 200, json: async () => snapA() };
      }
      if (url === `/api/ask/threads/${LA_X}`) return xHeld.then(() => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }));
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  ctx.panel.open({ threadId: LA_A });
  await ticks(ctx);
  ctx.flush();
  for (const f of stampFrames([{ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' }, { type: 'ask-delta', text: 'part' }], { threadId: LA_A, messageId: MID_A })) ctx.panel.pushServerFrame(f);
  ctx.flush();
  const stop = ctx.doc.querySelector('[data-ask-stop]');
  assert.equal(stop.hidden, false, 'streaming');
  turnOver = true;                                                     // the turn ends while the socket is down
  ctx.panel.onHello([]);                                               // the reconnect's resync: its GET is out
  await ticks(ctx);
  ctx.panel.open({ threadId: LA_X });                                  // a pick meanwhile; X answers 500
  releaseX();
  await ticks(ctx, 6);
  releaseA();                                                          // the resync lands, stale: the switch bumped loadGen
  await ticks(ctx, 8);
  ctx.flush();
  assert.equal(aGets, 3, 'the given-back chat was loaded once more');
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Chat A');
  assert.equal(stop.hidden, true, 'no Stop for a turn that ended');
});

test('the chat a first send created after the user moved is deleted: History never lists a chat the user never started', async () => {
  let releaseCreate;
  const createHeld = new Promise((r) => { releaseCreate = r; });
  const calls = [];
  const ctx = makePanel({
    fetchHandler: (url, opts) => {
      const m = (opts.method || 'GET').toUpperCase();
      calls.push(`${m} ${url}`);
      if (url === '/api/ask/threads' && m === 'POST') return createHeld.then(() => ({ ok: true, status: 201, json: async () => ({ thread: laRow('ask_0000000c', null) }) }));
      if (url === `/api/ask/threads/${LA_A}` && m === 'GET') return { ok: true, status: 200, json: async () => laSnap(LA_A, 'Chat A') };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  ctx.panel.open({ threadId: null });
  await ticks(ctx);
  ctx.doc.querySelector('textarea.ask-input').value = 'question';
  ctx.doc.querySelector('[data-ask-send]').click();                   // POST /api/ask/threads is out
  await ticks(ctx);
  ctx.panel.open({ threadId: LA_A });                                  // Back to chat A meanwhile
  await ticks(ctx, 3);
  releaseCreate();
  await ticks(ctx, 6);
  assert.deepEqual(calls.filter((c) => c.startsWith('DELETE ')), ['DELETE /api/ask/threads/ask_0000000c']);
  assert.equal(ctx.panel.threadId(), LA_A);
});

test('"Delete all chat history" puts out a Chat row dot lit by a chat it removed and forgets the chats this tab asked in', async () => {
  const ids = ['ask_0000000a', 'ask_0000000b'];
  let next = 0;
  const calls = [];
  const ctx = makePanel({
    fetchHandler: (url, opts) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (url === '/api/ask/threads' && method === 'POST') return { ok: true, status: 201, json: async () => ({ thread: threadRow(ids[next++], null) }) };
      if (/\/messages$/.test(url) && method === 'POST') return { ok: true, status: 202, json: async () => ({ userMessageId: `askm_u000000${next}`, attachments: [], contexts: [] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    },
    deps: { onUnread: (on) => calls.push(on) },
  });
  ctx.panel.open({ threadId: null });
  await ticks(ctx);
  const send = async (text) => {
    ctx.doc.querySelector('textarea.ask-input').value = text;
    ctx.doc.querySelector('[data-ask-send]').click();
    await ticks(ctx, 5);
    ctx.flush();
  };
  await send('first');                                                // chat a
  ctx.doc.querySelector('.chat-head [data-ask-new-btn]').click();
  await send('second');                                               // chat b
  ctx.doc.querySelector('.chat-head [data-ask-new-btn]').click();                // home: neither chat is open
  ctx.panel.close();
  const done = (threadId) => ({ type: 'ask-done', threadId, messageId: `askm_${threadId.slice(4)}`, seq: 3 });
  ctx.panel.pushServerFrame(done('ask_0000000a'));
  assert.equal(ctx.panel.unreadThreadId(), 'ask_0000000a');
  ctx.panel.pushServerFrame({ type: 'ask-history-cleared', threadIds: ['ask_0000000b'] });   // a shared clear of chat b only
  assert.equal(ctx.panel.unreadThreadId(), 'ask_0000000a', 'the dot\'s chat was not removed: still lit');
  ctx.panel.pushServerFrame(done('ask_0000000b'));
  assert.equal(ctx.panel.unreadThreadId(), 'ask_0000000a', 'b is forgotten: its late reply never takes the dot');
  ctx.panel.pushServerFrame({ type: 'ask-history-cleared' });
  assert.equal(ctx.panel.unreadThreadId(), null, 'every chat removed: the dot goes out');
  assert.deepEqual(calls, [true, false]);
  ctx.panel.pushServerFrame(done('ask_0000000a'));
  assert.deepEqual(calls, [true, false], 'a removed chat\'s late reply lights nothing');
});

test('unread: a PR fix-run card (an unread ask-message) lights the dot while Chat is hidden or another chat is open, never for the chat on screen', async () => {
  const calls = [];
  const a = makePanel({ fetchHandler: api({}), deps: { onUnread: (on) => calls.push(on) } });
  a.panel.open({ threadId: TID });
  await ticks(a); a.flush();
  const msg = (threadId) => ({ type: 'ask-message', threadId, unread: true,
    message: { id: 'askm_0000f00f', threadId, seq: 9, role: 'system', text: 'PR watch started a fix run', blocks: [], status: null, createdAt: 't' } });
  a.panel.pushServerFrame(msg(TID));
  assert.deepEqual(calls, [], 'the chat on screen: read as it landed');
  a.panel.pushServerFrame(msg('ask_0000beef'));
  assert.deepEqual(calls, [true], 'another chat: the dot');
  assert.equal(a.panel.unreadThreadId(), 'ask_0000beef');
  a.panel.close(); a.panel.open();
  assert.deepEqual(calls, [true, false]);
  a.panel.close();
  a.panel.pushServerFrame(msg(TID));
  assert.deepEqual(calls, [true, false, true], 'Chat hidden: the dot, even for the last open chat');
  a.panel.pushServerFrame({ ...msg(TID), unread: undefined });
  assert.deepEqual(calls, [true, false, true], 'a plain ask-message lights nothing new');
});
