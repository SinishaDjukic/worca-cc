// test/ui-chats-column.test.mjs — the Chats column (issue #948 slice 2), mounted by the real panel.
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
    // #948 s3: the topic groups. GET lists rec.groups; every other group call is recorded and answers a group.
    if (url === '/api/ask/groups' && m === 'GET') return { ok: true, status: 200, json: async () => ({ groups: rec.groups || [] }) };
    if (url.startsWith('/api/ask/groups')) {
      const b = opts.body ? JSON.parse(opts.body) : undefined;
      rec.groupCalls.push(b === undefined ? [m, url] : [m, url, b]);
      // Add to group: a test's onGroupCall moves the chats in its list (the next GET reads them); the answer carries Undo.
      const out = rec.onGroupCall ? rec.onGroupCall(m, url, b) : undefined;
      if (out) return { ok: true, status: 200, json: async () => out };
      return { ok: true, status: 200, json: async () => ({ group: { id: 'askg_00000009', name: b && b.name } }) };
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
  const rec = { calls: [], patches: [], groupCalls: [], groups: opts.groups || [], onGroupCall: opts.onGroupCall || null };
  const ctx = makePanel({ innerWidth: 1600, now: () => NOW, platform: 'MacIntel', fetchHandler: api(rec, opts), deps: opts.deps,
    ...(opts.confirm ? { confirm: opts.confirm } : {}) });
  applyFlags({ ...(opts.flags || {}) }, ctx.doc);
  ctx.panel.open({ threadId: null });
  await ticks(ctx);
  return { ctx, rec, doc: ctx.doc, col: ctx.doc.querySelector('[data-chat-history]') };
}
const rowLink = (col, id) => col.querySelector(`a.runs-row[data-row-key="chat:${id}"]`);
const key = (doc, target, init) => target.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const toastTitles = (doc) => [...doc.querySelectorAll('.toast .tt')].map((n) => n.textContent);
const listGets = (rec) => rec.calls.filter((c) => c.startsWith('GET /api/ask/threads?'));

test('head is Chats + View; Pinned · Today · Recent · Older; Recent holds 10; no search, labelled New chat or trash', async () => {
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

test('hidden, the column fetches nothing: the first show loads it once; a frame while hidden waits for the next show', async () => {
  const rec = { calls: [], patches: [] };
  const ctx = makePanel({ innerWidth: 1600, now: () => NOW, fetchHandler: api(rec) });
  await ticks(ctx);
  assert.equal(listGets(rec).length, 0, 'a boot on another page asks for no chats');
  ctx.panel.open({ threadId: null });
  await ticks(ctx);
  assert.equal(listGets(rec).length, 1, 'the first show loads the list');
  ctx.panel.close();
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: 'ask_00000002', command: { blockId: 'sess:1', status: 'running' } });
  await new Promise((r) => setTimeout(r, 300));
  await ticks(ctx);
  assert.equal(listGets(rec).length, 1, 'hidden: the frame only marks the list stale');
  ctx.panel.open({ threadId: null });
  await ticks(ctx);
  assert.equal(listGets(rec).length, 2, 'the next show fetches it once');
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
  // Ask worca beside the page: the side column's own New chat (style.css shows it only there) is the head's other one.
  assert.equal(head.querySelectorAll('[data-ask-new-btn]:not([data-ask-side-new])').length, 1);
  assert.equal(head.querySelectorAll('[data-ask-new-btn]').length, 2);
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
  assert.deepEqual([...doc.querySelectorAll('.wfv-menu .wfv-menu-hint')].map((n) => n.textContent), ['Space', 'R', 'P', 'G', 'E', '⌫']);
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

// ── #948 s3: topic groups ──
const GID = 'askg_00000001';
// T defaults scope: null, and a chat with no project adds no project to the group line, so both members name one.
const GROUPED = [T('ask_00000003', { groupId: GID, title: 'Fix the login', scope: { projectKey: 'worka-1' } }),
  T('ask_00000004', { groupId: GID, title: 'SSO', scope: { projectKey: 'other' } }), ...LIST];

test('⌥↓ / ⌥↑ step over a topic group row to the next chat, never open the group as a chat', async () => {
  const { ctx, doc, col, rec } = await bootOn({ list: GROUPED, groups: [{ id: GID, name: 'Release prep', nameSource: 'user', createdAt: iso(5 * DAY), count: 2 }] });
  const keys = [...col.querySelectorAll('a.runs-row')].map((a) => a.dataset.rowKey);
  const g = keys.findIndex((k, i) => k.startsWith('cgroup:') && i > 0 && keys[i - 1].startsWith('chat:'));
  assert.ok(g > 0, 'precondition: a chat row right before a group row');
  const before = keys[g - 1].slice('chat:'.length);
  const after = keys.slice(g + 1).find((k) => k.startsWith('chat:')).slice('chat:'.length);
  ctx.panel.open({ threadId: before });
  await ticks(ctx);
  key(doc, doc.body, { key: 'ArrowDown', code: 'ArrowDown', altKey: true });
  await ticks(ctx);
  assert.equal(ctx.panel.threadId(), after);
  key(doc, doc.body, { key: 'ArrowUp', code: 'ArrowUp', altKey: true });
  await ticks(ctx);
  assert.equal(ctx.panel.threadId(), before);
  assert.ok(!rec.calls.some((c) => /\/api\/ask\/threads\/[^/?]*askg_/.test(c)), 'a group id is never fetched as a chat');
});

test('a group row: count, ⌄ expands to indented members, "2 projects"; ↵ folds it again', async () => {
  const { col, doc } = await bootOn({ list: GROUPED, groups: [{ id: GID, name: 'Release prep', nameSource: 'user', createdAt: iso(5 * DAY), count: 2 }] });
  const g = col.querySelector(`.runs-item[data-row-key="cgroup:${GID}"]`);
  assert.equal(g.querySelector('.runs-count').textContent, '2');
  assert.match(g.querySelector('.runs-row-sub').textContent, /^2 projects · /);
  const exp = g.querySelector('.runs-expand');
  assert.equal(exp.getAttribute('aria-label'), 'Show the 2 chats in Release prep');
  exp.click();
  const open = col.querySelector(`.runs-item[data-row-key="cgroup:${GID}"]`);
  assert.equal(open.querySelectorAll('.runs-members > .runs-item').length, 2);
  const row = open.querySelector('a.runs-row');
  row.focus();
  key(doc, row, { key: 'Enter' });
  assert.equal(col.querySelector(`.runs-item[data-row-key="cgroup:${GID}"] .runs-members`), null);
});

test('⋯ › Add to group… lists the groups in the picker; a pick moves the chat', async () => {
  const { col, doc, rec, ctx } = await bootOn({ list: GROUPED, groups: [{ id: GID, name: 'Release prep', count: 2 }] });
  col.querySelector('.runs-item[data-row-key="chat:ask_00000002"] .runs-more').click();
  [...doc.querySelectorAll('.wfv-menu [role="menuitem"]')].find((b) => b.querySelector('.wfv-menu-l').textContent === 'Add to group…').click();
  const pick = doc.querySelector(`.group-picker .gp-row[data-group-id="${GID}"]`);
  assert.equal(pick.querySelector('.gp-title').textContent, 'Release prep');
  pick.click();
  await ticks(ctx);
  assert.deepEqual(rec.groupCalls[0], ['POST', `/api/ask/groups/${GID}/threads`, { threadIds: ['ask_00000002'] }]);
});

test('Select 2 › Group 2 › New group opens the dialog; smartRunNaming off: plain field, ⌘↵ creates', async () => {
  const { col, doc, rec, ctx } = await bootOn({ flags: { smartRunNaming: false } });
  for (const id of ['ask_00000002', 'ask_10000000']) col.querySelector(`.runs-item[data-row-key="chat:${id}"] .runs-check`).click();
  const groupBtn = col.querySelector('#chats-bulk [data-bulk="group"]');
  assert.equal(groupBtn.querySelector('.runs-bulk-c').textContent, '2');
  groupBtn.click();
  doc.querySelector('.group-picker .gp-new').click();
  const input = doc.getElementById('chat-group-name');
  assert.equal(doc.querySelector('.chat-group-modal .sn-chip, .chat-group-modal .sn-actions'), null);
  assert.ok(!rec.groupCalls.some((c) => c[1].endsWith('suggest-name')));
  input.value = 'Login work';
  input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  key(doc, input, { key: 'Enter', metaKey: true });
  await ticks(ctx);
  assert.deepEqual(rec.groupCalls.at(-1), ['POST', '/api/ask/groups', { name: 'Login work', nameSource: 'user', threadIds: ['ask_00000002', 'ask_10000000'] }]);
});

test('View › Group by › Topic: one section per group, then Ungrouped', async () => {
  const { col, doc, ctx } = await bootOn({ list: GROUPED, groups: [{ id: GID, name: 'Release prep', count: 2 }] });
  col.querySelector('#chats-view-btn').click();
  [...doc.querySelectorAll('.wfv-menu [role^="menuitem"]')].find((b) => b.textContent.includes('Topic')).click();
  await ticks(ctx);
  assert.deepEqual([...col.querySelectorAll('.runs-sec-head .runs-sec-title')].map((n) => n.textContent), ['Release prep', 'Ungrouped']);
});

test('a group with a busy chat: ⋯ › Archive group is disabled with the reason', async () => {
  const list = [T('ask_00000003', { groupId: GID, title: 'Ship notes', inFlight: true }), T('ask_00000004', { groupId: GID }), ...LIST];
  const { col, doc } = await bootOn({ list, groups: [{ id: GID, name: 'Release prep', count: 2 }] });
  col.querySelector(`.runs-item[data-row-key="cgroup:${GID}"] .runs-more`).click();
  const arch = [...doc.querySelectorAll('.wfv-menu [role="menuitem"]')].find((b) => b.querySelector('.wfv-menu-l').textContent === 'Archive group');
  assert.equal(arch.disabled, true);
  assert.equal(arch.title, "Can't archive while “Ship notes” is busy. Wait for it to finish or stop it.");
});

test('Delete group… confirms the server total (archived included), not the loaded members', async () => {
  let asked = null;
  const { col, doc } = await bootOn({ list: GROUPED, groups: [{ id: GID, name: 'Release prep', count: 2, total: 3 }],
    confirm: async (o) => { asked = o; return false; } });
  col.querySelector(`.runs-item[data-row-key="cgroup:${GID}"] .runs-more`).click();
  [...doc.querySelectorAll('.wfv-menu [role="menuitem"]')].find((b) => b.querySelector('.wfv-menu-l').textContent === 'Delete group…').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(asked.message, '“Release prep” and its 3 chats (1 archived) are removed. This cannot be undone.');
});

test('a group opened because a chat needed you stays open after the chat stops needing you', async () => {
  const list = [T('ask_00000003', { groupId: GID, waiting: true }), T('ask_00000004', { groupId: GID }), ...LIST];
  const { col, ctx } = await bootOn({ list, groups: [{ id: GID, name: 'Release prep', count: 2 }] });
  assert.ok(col.querySelector(`.runs-item[data-row-key="cgroup:${GID}"] .runs-members`));
  list[0] = T('ask_00000003', { groupId: GID });          // the caller's array: the next list answer reads it
  ctx.panel.pushServerFrame({ type: 'ask-groups-changed', action: 'moved' });
  await new Promise((r) => setTimeout(r, 300));
  await ticks(ctx);
  assert.ok(col.querySelector(`.runs-item[data-row-key="cgroup:${GID}"] .runs-members`));
});

const mclick = (doc, node, init = {}) => node.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
const checkedKeys = (col) => [...col.querySelectorAll('.runs-item.is-checked')].map((n) => n.dataset.rowKey);
const opened = (rec, from) => rec.calls.slice(from).some((c) => /^GET \/api\/ask\/threads\/ask_/.test(c));

test('A11 in Chats: ⌘-click selects without opening; Shift-click adds the range; Ctrl-click toggles; Cancel drops the anchor', async () => {
  const { col, doc, rec, ctx } = await bootOn();
  const from = rec.calls.length;
  assert.equal(mclick(doc, rowLink(col, 'ask_10000000'), { metaKey: true }), false, 'the browser never follows the link');
  await ticks(ctx);
  assert.deepEqual(checkedKeys(col), ['chat:ask_10000000']);
  assert.ok(col.querySelector('#chats-list').classList.contains('is-selecting'));
  assert.equal(col.querySelector('#chats-bulk').hidden, false);
  mclick(doc, rowLink(col, 'ask_10000002'), { shiftKey: true });
  await ticks(ctx);
  assert.deepEqual(checkedKeys(col), ['chat:ask_10000000', 'chat:ask_10000001', 'chat:ask_10000002']);
  mclick(doc, rowLink(col, 'ask_10000001'), { ctrlKey: true });
  await ticks(ctx);
  assert.deepEqual(checkedKeys(col), ['chat:ask_10000000', 'chat:ask_10000002']);
  assert.equal(mclick(doc, rowLink(col, 'ask_10000005'), { metaKey: true, button: 1 }), true, 'a middle click is left to the browser');
  assert.equal(opened(rec, from), false, 'no chat opened');
  col.querySelector('#chats-bulk [data-bulk="cancel"]').click();
  await ticks(ctx);
  assert.deepEqual(checkedKeys(col), []);
  mclick(doc, rowLink(col, 'ask_10000003'), { shiftKey: true });
  await ticks(ctx);
  assert.deepEqual(checkedKeys(col), ['chat:ask_10000003'], 'Cancel dropped the anchor: a Shift-click toggles one chat');
});

test('A11 in Chats: a touch long-press starts selecting and its click opens nothing', async () => {
  const { col, doc, rec, ctx } = await bootOn();
  rowLink(col, 'ask_00000002').dispatchEvent(new doc.defaultView.PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
  await new Promise((r) => setTimeout(r, 550));
  await ticks(ctx);
  assert.deepEqual(checkedKeys(col), ['chat:ask_00000002']);
  const from = rec.calls.length;
  assert.equal(mclick(doc, rowLink(col, 'ask_00000002')), false, 'the click after the press is swallowed');
  await ticks(ctx);
  assert.deepEqual(checkedKeys(col), ['chat:ask_00000002'], 'and does not toggle it back');
  assert.equal(opened(rec, from), false);
});

test('A11 in Chats: ⌘-click on a topic group row selects it; the bar counts its chats', async () => {
  const { col, doc, ctx } = await bootOn({ list: GROUPED, groups: [{ id: GID, name: 'Release prep', count: 2 }] });
  const g = col.querySelector(`a.runs-row[data-row-key="cgroup:${GID}"]`);
  assert.equal(mclick(doc, g, { metaKey: true }), false);
  await ticks(ctx);
  assert.deepEqual(checkedKeys(col), [`cgroup:${GID}`]);
  assert.equal(col.querySelector('#chats-bulk [data-bulk="group"] .runs-bulk-c').textContent, '2');
});

test('View: Sort by and Group by are segmented rows; a segment pick repaints and keeps the menu open', async () => {
  const { col, doc, ctx } = await bootOn({ list: GROUPED, groups: [{ id: GID, name: 'Release prep', count: 2 }] });
  col.querySelector('#chats-view-btn').click();
  assert.ok(doc.querySelector('.wfv-menu').classList.contains('wfv-view-menu'));
  [...doc.querySelectorAll('.wfv-menu .wfv-seg [role="menuitemradio"]')].find((b) => b.textContent === 'Topic').click();
  await ticks(ctx);
  assert.ok(doc.querySelector('.wfv-menu'), 'the segment pick kept the menu open');
  assert.deepEqual([...col.querySelectorAll('.runs-sec-head .runs-sec-title')].map((n) => n.textContent), ['Release prep', 'Ungrouped']);
  assert.equal([...doc.querySelectorAll('.wfv-menu .wfv-menu-item')].find((b) => b.querySelector('.wfv-menu-l').textContent === 'Select')
    .querySelector('.wfv-menu-hint').textContent, '⌘ click');
});

// ── Add to group (the shared picker, group-add.mjs): focus on the moved chat, Undo, G with a selection ──
const pickerKey = (doc, k) => key(doc, doc.querySelector('.group-picker input.gp-search'), { key: k });
const pickerType = (doc, v) => { const q = doc.querySelector('.group-picker input.gp-search'); q.value = v; q.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true })); };

test('Add to group: a pick from ⋯ lands the focus on the moved chat, inside its opened group, never on the next row', async () => {
  const list = [...GROUPED];
  const groups = [{ id: GID, name: 'Release prep', nameSource: 'user', createdAt: iso(5 * DAY), count: 2 }];
  const { col, doc, ctx } = await bootOn({ list, groups, onGroupCall: (m, url, b) => {
    if (m !== 'POST' || !url.endsWith('/threads')) return undefined;
    for (const id of b.threadIds) { const i = list.findIndex((t) => t.id === id); list[i] = { ...list[i], groupId: GID }; }
    groups[0].count = 3;
    return { group: { id: GID, name: 'Release prep' }, undo: 'undo_x' };
  } });
  assert.equal(col.querySelector(`.runs-item[data-row-key="cgroup:${GID}"] .runs-members`), null, 'the group starts folded');
  const keys = [...col.querySelectorAll('a.runs-row')].map((a) => a.dataset.rowKey);
  const next = keys[keys.indexOf('chat:ask_00000002') + 1];
  col.querySelector('.runs-item[data-row-key="chat:ask_00000002"] .runs-more').click();
  [...doc.querySelectorAll('.wfv-menu [role="menuitem"]')].find((b) => b.querySelector('.wfv-menu-l').textContent === 'Add to group…').click();
  pickerKey(doc, 'ArrowDown');   // New group…
  pickerKey(doc, 'ArrowDown');   // Release prep
  pickerKey(doc, 'Enter');
  await ticks(ctx, 8);
  const moved = col.querySelector(`.runs-item[data-row-key="cgroup:${GID}"] .runs-members a.runs-row[data-row-key="chat:ask_00000002"]`);
  assert.ok(moved, 'the target group is open with the moved chat');
  assert.equal(doc.activeElement, moved);
  assert.ok(moved.classList.contains('is-landed'));
  assert.notEqual(doc.activeElement, rowLink(col, next.slice('chat:'.length)), 'the row that slid up keeps no focus');
  assert.ok(toastTitles(doc).includes('Added to Release prep'));
});

test('Add to group: ⌘-click two chats, G, Create; Undo on the toast calls the undo route and restores the selection', async () => {
  const { col, doc, rec, ctx } = await bootOn({ onGroupCall: (m, url, b) => {
    if (url === '/api/ask/groups/undo') return { ok: true };
    if (m === 'POST' && url === '/api/ask/groups') return { group: { id: 'askg_00000009', name: b.name }, undo: 'undo_x' };
    return undefined;
  } });
  doc.documentElement.dataset.level = 'advanced';
  for (const id of ['ask_00000002', 'ask_10000000']) { mclick(doc, rowLink(col, id), { metaKey: true }); await ticks(ctx); }
  assert.equal(col.querySelectorAll('.runs-item.is-checked').length, 2);
  rowLink(col, 'ask_00000002').focus();
  key(doc, rowLink(col, 'ask_00000002'), { key: 'g' });
  assert.ok(doc.querySelector('.group-picker'), 'G with a selection opens the picker');
  pickerType(doc, 'Login work');
  pickerKey(doc, 'Enter');
  await ticks(ctx, 8);
  assert.deepEqual(rec.groupCalls.at(-1), ['POST', '/api/ask/groups', { name: 'Login work', nameSource: 'user', threadIds: ['ask_00000002', 'ask_10000000'] }]);
  assert.equal(col.querySelectorAll('.runs-item.is-checked').length, 0);
  assert.ok(toastTitles(doc).includes('Added to Login work'));
  doc.querySelector('.toast .toast-act').click();
  await ticks(ctx, 8);
  assert.deepEqual(rec.groupCalls.at(-1), ['POST', '/api/ask/groups/undo', { token: 'undo_x' }]);
  assert.equal(col.querySelectorAll('.runs-item.is-checked').length, 2, 'the selection is back');
});

test('G with a selection opens the picker for the selection, anchored at the bar\'s Group button', async () => {
  const { col, doc, rec, ctx } = await bootOn();
  doc.documentElement.dataset.level = 'advanced';
  for (const id of ['ask_00000002', 'ask_10000000']) col.querySelector(`.runs-item[data-row-key="chat:${id}"] .runs-check`).click();
  rowLink(col, 'ask_00000002').focus();
  key(doc, rowLink(col, 'ask_00000002'), { key: 'g' });
  assert.ok(doc.querySelector('.group-picker'));
  assert.equal(doc.querySelector('.wfv-menu'), null);
  pickerType(doc, 'Pair');
  pickerKey(doc, 'Enter');
  await ticks(ctx, 8);
  assert.deepEqual(rec.groupCalls.at(-1)[2].threadIds, ['ask_00000002', 'ask_10000000']);
});
