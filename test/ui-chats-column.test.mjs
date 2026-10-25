// test/ui-chats-column.test.mjs — the Chats column (issue #948 slice 2, flag chatsColumn), mounted by the real panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel } from './helpers/ask-panel-harness.mjs';
import { applyFlags } from '../ui/public/flags.mjs';

const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const DAY = 86400e3;
const T = (id, o = {}) => ({ id, title: `Chat ${id}`, createdAt: iso(30 * DAY), updatedAt: iso(3600e3), totals: { costUsd: 0.4 },
  scope: null, inFlight: false, waiting: false, tracking: false, trackingRuns: 0, commands: 0, archived: false, ...o });
const LIST = [T('ask_0000000a', { pinnedAt: iso(20 * DAY), updatedAt: iso(20 * DAY) }), T('ask_00000001', { inFlight: true }), T('ask_00000002'),
  ...Array.from({ length: 14 }, (_, i) => T(`ask_1000000${i.toString(16)}`, { updatedAt: iso((i + 1) * DAY) }))];
// The message row shape of test/ask-panel-page.test.mjs:13.
const msg = (threadId) => ({ id: 'askm_u0000001', threadId, seq: 1, role: 'user', text: 'hi', blocks: [], status: null, reason: null,
  model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: iso(0) });
const ticks = async (ctx, n = 4) => { for (let i = 0; i < n; i += 1) await ctx.tick(); ctx.flush(); };

// `list` may be a caller's array: splicing it changes the next answer. `cursor` makes the list answer say "more".
function api(rec, { list = LIST, failList = false, cursor = null, totals = null } = {}) {
  return (url, opts = {}) => {
    const m = (opts.method || 'GET').toUpperCase();
    rec.calls.push(`${m} ${url}`);
    if (m === 'PATCH') {
      rec.patches.push([url, JSON.parse(opts.body)]);
      const busy = /ask_00000001/.test(url) && JSON.parse(opts.body).archived === true;
      return { ok: !busy, status: busy ? 409 : 200, json: async () => (busy ? { error: 'busy', code: 'CHAT_BUSY' } : { thread: {} }) };
    }
    if (url.startsWith('/api/ask/threads?')) {
      if (failList || rec.failList) return { ok: false, status: 503, json: async () => ({}) };
      const paged = url.includes('cursor=');
      const page = paged ? (rec.nextPage || []) : [...list];
      return { ok: true, status: 200, json: async () => ({ threads: page, cursor: paged ? null : cursor,
        total: list.length, counts: { all: list.length, needs: 0, archived: 3 } }) };
    }
    const hit = /^\/api\/ask\/threads\/(ask_[0-9a-f]{8})$/.exec(url);
    if (hit) {
      const row = list.find((t) => t.id === hit[1]) || T(hit[1]);
      return { ok: true, status: 200, json: async () => ({ thread: { ...row, ...(totals ? { totals } : {}), model: null, effort: null, sessionId: null, context: null },
        messages: [msg(hit[1])], attachments: [], runLinks: [], inFlight: null }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}
async function bootOn(opts = {}) {
  const rec = { calls: [], patches: [] };
  const ctx = makePanel({ innerWidth: 1600, now: () => NOW, platform: 'MacIntel', fetchHandler: api(rec, opts), deps: opts.deps });
  applyFlags({ chatsColumn: true }, ctx.doc);
  ctx.panel.chatsColumnChanged();
  ctx.panel.open({ threadId: null });
  await ticks(ctx);
  return { ctx, rec, doc: ctx.doc, col: ctx.doc.querySelector('[data-chat-history]') };
}
const rowLink = (col, id) => col.querySelector(`a.runs-row[data-row-key="chat:${id}"]`);
const key = (doc, target, init) => target.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const toastTitles = (doc) => [...doc.querySelectorAll('.toast .tt')].map((n) => n.textContent);
const listGets = (rec) => rec.calls.filter((c) => c.startsWith('GET /api/ask/threads?'));

test('flag on: head is Chats + View; Pinned · Today · Recent · Older; Recent holds 10; no search, labelled New chat or trash', async () => {
  const { col } = await bootOn();
  assert.deepEqual([...col.querySelector('.runs-head').children].map((n) => n.textContent.trim()), ['Chats', 'View']);
  assert.deepEqual([...col.querySelectorAll('.runs-sec-head .runs-sec-title')].map((n) => n.textContent), ['Pinned', 'Today', 'Recent', 'Older']);
  assert.equal(col.querySelectorAll('[data-section="recent"] .runs-item').length, 10);
  assert.equal(col.querySelector('[data-section="older"] .runs-sec-head').getAttribute('aria-expanded'), 'false');
  assert.equal(col.querySelectorAll('.chat-history-search-input, .chat-history-new, .ask-thread-trash').length, 0);
});

test('loading, then offline with Try again; Try again re-fetches and paints the rows', async () => {
  const rec = { calls: [], patches: [], failList: true };
  const ctx = makePanel({ innerWidth: 1600, now: () => NOW, fetchHandler: api(rec) });
  applyFlags({ chatsColumn: true }, ctx.doc);
  ctx.panel.chatsColumnChanged();
  const col = ctx.doc.querySelector('[data-chat-history]');
  assert.equal(col.querySelector('.runs-loading')?.textContent, 'Loading chats…', 'before any answer');
  assert.equal(col.querySelector('.runs-note:not(.runs-loading)'), null, 'never "No chats yet." while loading');
  ctx.panel.open({ threadId: null });
  await ticks(ctx);
  assert.equal(col.querySelector('.runs-offline').firstChild.textContent, "The chats show here once Worca's server is reachable again.");
  rec.failList = false;
  const before = listGets(rec).length;
  col.querySelector('.runs-offline [data-runs-retry]').click();
  await ticks(ctx);
  assert.ok(listGets(rec).length > before);
  assert.equal(col.querySelectorAll('a.runs-row').length, LIST.length - 4, 'Older stays folded');
  assert.equal(col.querySelector('.runs-offline'), null);
});

test('a failed Show older keeps the rows and shows one err toast', async () => {
  const { ctx, rec, doc, col } = await bootOn({ cursor: 'c1' });
  col.querySelector('[data-section="older"] .runs-sec-head').click();
  ctx.flush();
  const shown = col.querySelectorAll('a.runs-row').length;
  rec.failList = true;
  col.querySelector('.runs-older').click();
  await ticks(ctx);
  assert.equal(col.querySelectorAll('a.runs-row').length, shown);
  assert.deepEqual(toastTitles(doc), ['Could not load the chats']);
});

test('a busy chat: ⋯ › Archive is disabled with the reason; E toasts it; bulk Archive counts only idle chats', async () => {
  const { doc, col, rec, ctx } = await bootOn();
  col.querySelector('.runs-item[data-row-key="chat:ask_00000001"] .runs-more').click();
  const arch = [...doc.querySelectorAll('.wfv-menu [role="menuitem"]')].find((b) => b.querySelector('.wfv-menu-l').textContent === 'Archive');
  assert.equal(arch.disabled, true);
  assert.equal(arch.getAttribute('aria-disabled'), 'true');
  assert.equal(arch.title, "Can't archive while this chat is replying. Wait for the reply or stop it.");
  key(doc, doc.body, { key: 'Escape' });
  const busyRow = rowLink(col, 'ask_00000001');
  busyRow.focus();
  key(doc, busyRow, { key: 'e' });
  await ticks(ctx);
  assert.equal(rec.patches.length, 0, 'E on a busy row PATCHes nothing');
  assert.ok(toastTitles(doc).includes("Can't archive while this chat is replying. Wait for the reply or stop it."));
  for (const id of ['ask_00000001', 'ask_00000002']) col.querySelector(`.runs-item[data-row-key="chat:${id}"] .runs-check`).click();
  assert.equal(col.querySelector('#chats-bulk [data-bulk="archive"] .runs-bulk-c').textContent, '1');
  assert.equal(col.querySelector('#chats-bulk [data-bulk="archive"]').title, 'Skipped 1 busy chat: Chat ask_00000001.');
});

test('E on an idle row archives with Undo; Undo restores; the focus lands on the row that took its place', async () => {
  const list = LIST.filter((t) => t.id !== 'ask_00000001');
  const { doc, col, rec, ctx } = await bootOn({ list });
  const rows = () => [...col.querySelectorAll('a.runs-row')];
  const second = rows()[1];
  const gone = second.dataset.rowKey.slice('chat:'.length);
  const third = rows()[2].dataset.rowKey;
  second.focus();
  list.splice(list.findIndex((t) => t.id === gone), 1);   // the next list answer leaves the archived chat out
  key(doc, second, { key: 'e' });
  await ticks(ctx, 6);
  assert.deepEqual(rec.patches, [[`/api/ask/threads/${gone}`, { archived: true }]]);
  assert.ok(toastTitles(doc).includes('Archived 1 chat'));
  assert.equal(doc.activeElement.dataset.rowKey, third, 'the row that took its place holds the focus');
  doc.querySelector('.toast .toast-act').click();
  await ticks(ctx);
  assert.deepEqual(rec.patches.at(-1), [`/api/ask/threads/${gone}`, { archived: false }]);
});

test('the + after the list toggle carries data-ask-new-btn and starts a new chat; the labelled one is gone', async () => {
  const { ctx, doc } = await bootOn();
  const head = doc.querySelector('.chat-head');
  const plus = head.querySelector('[data-ask-new-btn]');
  assert.equal(head.querySelectorAll('[data-ask-new-btn]').length, 1);
  assert.equal(plus.previousElementSibling, head.querySelector('[data-ask-threads-btn]'));
  assert.match(plus.getAttribute('aria-label'), /^New chat /);
  assert.equal(head.querySelector('.chat-new-btn span'), null, 'no labelled New chat');
  ctx.panel.open({ threadId: 'ask_00000002' });
  await ticks(ctx);
  assert.equal(ctx.panel.root.dataset.view, 'thread', 'a real chat is open before the click');
  let hooked = 0;
  doc.querySelector('[data-chat-page]').addEventListener('click', (e) => { if (e.target.closest('[data-ask-new-btn]')) hooked += 1; }, true);
  plus.click();
  await ticks(ctx);
  assert.equal(hooked, 1, 'the capture hook (intent.mjs, home-flip.mjs) sees the click');
  assert.equal(ctx.panel.root.dataset.view, 'home');
  assert.equal(ctx.panel.threadId(), null);
});

test('Chat page keys: ⌥⌘N starts a new chat through the +, ⌘\\ hides the list, ⌥↓ opens the next chat, ? opens the Chat sheet', async () => {
  const { ctx, doc, col } = await bootOn();
  ctx.panel.open({ threadId: 'ask_00000002' });
  await ticks(ctx);
  let hooked = 0;
  doc.querySelector('[data-chat-page]').addEventListener('click', (e) => { if (e.target.closest('[data-ask-new-btn]')) hooked += 1; }, true);
  key(doc, doc.body, { key: '˜', code: 'KeyN', metaKey: true, altKey: true });
  await ticks(ctx);
  assert.equal(hooked, 1);
  assert.equal(ctx.panel.threadId(), null);
  ctx.panel.open({ threadId: 'ask_00000002' });
  await ticks(ctx);
  const keysShown = [...col.querySelectorAll('a.runs-row')].map((a) => a.dataset.rowKey);
  const next = keysShown[keysShown.indexOf('chat:ask_00000002') + 1].slice('chat:'.length);
  key(doc, doc.body, { key: 'ArrowDown', code: 'ArrowDown', altKey: true });
  await ticks(ctx);
  assert.equal(ctx.panel.threadId(), next);
  const page = doc.querySelector('[data-chat-page]');
  const was = page.dataset.history;
  key(doc, doc.body, { key: '\\', code: 'Backslash', metaKey: true });
  assert.notEqual(page.dataset.history, was);
  key(doc, doc.body, { key: '?', code: 'Slash', shiftKey: true });
  assert.equal(doc.querySelectorAll('.keys-modal').length, 1);
  assert.ok([...doc.querySelectorAll('.keys-modal h3.keys-h')].some((n) => n.textContent === 'Chat page'));
  key(doc, doc.body, { key: 'Escape' });
  const composer = doc.querySelector('.chat-page textarea');
  key(doc, composer, { key: '?', code: 'Slash', shiftKey: true });
  assert.equal(doc.querySelectorAll('.keys-modal').length, 0, '? typed in the composer opens nothing');
});

test('flag off after on: the old column, the labelled New chat and the trash come back; the handle goes', async () => {
  const { ctx, doc } = await bootOn();
  applyFlags({ chatsColumn: false }, doc);
  ctx.panel.chatsColumnChanged();
  await ticks(ctx);
  const aside = doc.querySelector('[data-chat-history]');
  assert.equal(aside.querySelectorAll('.chat-history-search-input').length, 1);
  assert.equal(aside.querySelectorAll('.chat-history-new').length, 1);
  assert.equal(doc.querySelectorAll('.chat-head .chat-new-btn').length, 1);
  assert.equal(doc.querySelectorAll('.chat-new-plus, .chat-head-meter, .runs-resize, #chats-list').length, 0);
  assert.ok(aside.querySelectorAll('.ask-thread-trash').length > 0, 'the old rows draw their trash again');
});

test('J moves to the next row and Enter opens it; exactly one Tab stop, inner controls out of the Tab order', async () => {
  const { ctx, doc, col } = await bootOn();
  const rows = [...col.querySelectorAll('a.runs-row')];
  assert.equal([...col.querySelectorAll('a.runs-row, button.runs-sec-head')].filter((n) => n.tabIndex === 0).length, 1);
  for (const b of col.querySelectorAll('.runs-more, .runs-check')) assert.equal(b.tabIndex, -1);
  rows[0].focus();
  key(doc, rows[0], { key: 'j' });
  assert.equal(doc.activeElement, rows[1]);
  key(doc, rows[1], { key: 'Enter' });
  await ticks(ctx);
  assert.equal(ctx.panel.threadId(), rows[1].dataset.rowKey.slice('chat:'.length));
});

test('R renames through chatDeps.prompt, P pins, . opens the row menu with its key hints', async () => {
  const prompts = [];
  const { ctx, doc, col, rec } = await bootOn({ deps: { chatDeps: { prompt: async (o) => { prompts.push(o); return { title: 'Renamed' }; } } } });
  const row = rowLink(col, 'ask_00000002');
  row.focus();
  key(doc, row, { key: 'r' });
  await ticks(ctx);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].fields[0].label, 'Title');
  assert.deepEqual(rec.patches.at(-1), ['/api/ask/threads/ask_00000002', { title: 'Renamed' }]);
  const again = rowLink(col, 'ask_00000002');
  again.focus();
  key(doc, again, { key: 'p' });
  await ticks(ctx);
  assert.deepEqual(rec.patches.at(-1), ['/api/ask/threads/ask_00000002', { pinned: true }]);
  const third = rowLink(col, 'ask_00000002');
  third.focus();
  key(doc, third, { key: '.' });
  assert.equal(doc.querySelectorAll('.wfv-menu').length, 1);
  assert.deepEqual([...doc.querySelectorAll('.wfv-menu .wfv-menu-hint')].map((n) => n.textContent), ['Space', 'R', 'P', 'E', '⌫']);
});

test('View › Archived re-fetches with show=archived, loads, then shows the chip; × resets; the view is kept per browser', async () => {
  const { ctx, doc, col, rec } = await bootOn();
  col.querySelector('#chats-view-btn').click();
  const pick = [...doc.querySelectorAll('.wfv-menu [role="menuitemradio"]')].find((b) => b.querySelector('.wfv-menu-l').textContent === 'Archived');
  pick.click();
  assert.equal(col.querySelector('.runs-loading')?.textContent, 'Loading chats…');
  await ticks(ctx);
  assert.ok(listGets(rec).at(-1).includes('show=archived'));
  const chip = col.querySelector('#chats-view-chip');
  assert.equal(chip.hidden, false);
  assert.equal(chip.querySelector('.runs-view-chip-t').textContent, `Archived · ${LIST.length} chats`);
  assert.equal(JSON.parse(ctx.storage.getItem('worca-cc.chats.view')).show, 'archived');
  chip.querySelector('.runs-view-reset').click();
  await ticks(ctx);
  assert.equal(chip.hidden, true);
  assert.ok(listGets(rec).at(-1).includes('show=all'));
});

test('Older unfolds on its head; Show older pages by cursor and appends without duplicates; folded, no Show older', async () => {
  const { ctx, col, rec } = await bootOn({ cursor: 'c1' });
  assert.equal(col.querySelector('.runs-older'), null, 'folded Older draws no Show older');
  col.querySelector('[data-section="older"] .runs-sec-head').click();
  const older = col.querySelector('[data-section="older"]');
  assert.equal(older.querySelector('.runs-sec-head').getAttribute('aria-expanded'), 'true');
  assert.equal(older.querySelectorAll('.runs-item').length, 4);
  const more = col.querySelectorAll('.runs-older');
  assert.equal(more.length, 1);
  assert.equal(more[0].textContent, 'Show older');
  rec.nextPage = [T('ask_2000000a', { updatedAt: iso(40 * DAY) }), LIST.at(-1)];
  more[0].click();
  await ticks(ctx);
  assert.ok(listGets(rec).at(-1).includes('cursor=c1'));
  const keys = [...col.querySelectorAll('a.runs-row')].map((a) => a.dataset.rowKey);
  assert.equal(new Set(keys).size, keys.length, 'no duplicates');
  assert.ok(keys.includes('chat:ask_2000000a'));
});

test('an ask-command frame with a new status refetches the list once; the same status again does not', async () => {
  const { ctx, rec } = await bootOn();
  const wait = async () => { await new Promise((r) => setTimeout(r, 300)); await ticks(ctx); };
  const before = listGets(rec).length;
  const frame = { type: 'ask-command', threadId: 'ask_00000002', command: { blockId: 'sess:1', status: 'running' } };
  ctx.panel.pushServerFrame(frame);
  await wait();
  assert.equal(listGets(rec).length, before + 1);
  ctx.panel.pushServerFrame(frame);
  await wait();
  assert.equal(listGets(rec).length, before + 1);
});

test('ask-history-cleared: a full clear empties the column at once; a scoped clear drops the named rows and refetches', async () => {
  const list = [...LIST];
  const { ctx, rec, col } = await bootOn({ list });
  const wait = async () => { await new Promise((r) => setTimeout(r, 300)); await ticks(ctx); };
  assert.ok(rowLink(col, 'ask_00000002'));
  // Scoped: only the named chat goes, before the refetch answers.
  list.splice(list.findIndex((t) => t.id === 'ask_00000002'), 1);
  const before = listGets(rec).length;
  ctx.panel.pushServerFrame({ type: 'ask-history-cleared', threadIds: ['ask_00000002'] });
  ctx.flush();
  assert.equal(rowLink(col, 'ask_00000002'), null);
  assert.ok(rowLink(col, 'ask_10000000'));
  await wait();
  assert.ok(listGets(rec).length > before);
  // Full: every row goes with no reload.
  list.length = 0;
  ctx.panel.pushServerFrame({ type: 'ask-history-cleared' });
  ctx.flush();
  assert.equal(col.querySelectorAll('a.runs-row').length, 0);
  assert.match(col.textContent, /No chats yet\./);
});

test('the head meter is a block, start-aligned, so its ellipsis applies (a flex .btn clips both ends)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const rule = /\.btn\.chat-head-meter\{([^}]*)\}/.exec(css);
  assert.ok(rule, '.btn.chat-head-meter rule');
  assert.match(rule[1], /display:block;/);
  assert.match(rule[1], /text-align:left;/);
  assert.match(rule[1], /text-overflow:ellipsis;/);
});

test('the head meter reads "34% · $1.84 · 3 agents", opens the context popover, and the composer meter hides by the flag rule', async () => {
  const { readFileSync } = await import('node:fs');
  const { ctx, doc } = await bootOn({ totals: { ctx: 34000, ctxWindow: 100000, costUsd: 1.84, agents: 3, turns: 1 } });
  ctx.panel.open({ threadId: 'ask_00000002' });
  await ticks(ctx);
  const meter = doc.querySelector('.chat-head button.chat-head-meter');
  assert.equal(meter.textContent, '34% · $1.84 · 3 agents');
  assert.equal(meter.getAttribute('aria-label'), 'Context window, 34% full');
  meter.click();
  assert.equal(doc.querySelectorAll('.ask-pop-ctx').length, 1);
  assert.equal(meter.getAttribute('aria-expanded'), 'true');
  assert.equal(doc.querySelector('[data-chat-page]').dataset.chats, 'on');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.chat-page[data-chats="on"] [data-ask-meter]{display:none;}'));
});

test('the resize handle sits in the column and ArrowRight keeps the width under worca-cc.chats.listWidth', async () => {
  const { ctx, doc, col } = await bootOn();
  const handle = col.querySelector('.runs-resize');
  assert.equal(handle.getAttribute('aria-label'), 'Resize the chats list');
  key(doc, handle, { key: 'ArrowRight' });
  assert.ok(ctx.storage.getItem('worca-cc.chats.listWidth'));
});
