// test/ask-panel-history-search.test.mjs
// History popover search (titles + message text, server-side ?q=).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel, key } from './helpers/ask-panel-harness.mjs';
import { ASK_HISTORY_SEARCH_MS } from '../ui/public/ask-panel.mjs';

const row = (id, title) => ({ id, title, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false, tracking: false });
const ALL = [row('ask_00000001', 'Fix the login bug'), row('ask_00000002', 'Explain run 4e1f'), row('ask_00000003', 'Login copy')];

/** Fake server: ?q filters titles (case-insensitive); `hold` parks responses for a query. */
function server() {
  const held = new Map();
  const fetchHandler = (url) => {
    if (!url.startsWith('/api/ask/threads?')) return { ok: true, status: 200, json: async () => ({}) };
    const q = new URL(url, 'http://x').searchParams.get('q') || '';
    const threads = q ? ALL.filter((t) => t.title.toLowerCase().includes(q.toLowerCase())) : ALL;
    const body = q ? { threads, total: 120, matches: threads.length } : { threads, total: 120 };
    const res = { ok: true, status: 200, json: async () => body };
    if (held.has(q)) return new Promise((r) => held.get(q).push(() => r(res)));
    return res;
  };
  return { fetchHandler, held };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const debounce = () => wait(ASK_HISTORY_SEARCH_MS + 40);

async function openHistory(ctx) {
  ctx.panel.open();
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ctx.tick(); await ctx.tick();
  return ctx.doc.querySelector('.ask-pop-threads');
}
function type(ctx, input, value) {
  input.value = value;
  input.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
}
const titles = (pop) => [...pop.querySelectorAll('.ask-thread-title')].map((n) => n.textContent);
const listUrls = (ctx) => ctx.fetchCalls.map((c) => c.url).filter((u) => u.startsWith('/api/ask/threads?'));

test('history search: input focused on open, debounced server query, meter "N of M", no-match empty state', async () => {
  const ctx = makePanel({ fetchHandler: server().fetchHandler });
  const pop = await openHistory(ctx);
  const input = pop.querySelector('input.ask-threads-search');
  assert.ok(input, 'search field rendered');
  assert.equal(ctx.doc.activeElement, input, 'the search field holds focus on open');
  assert.equal(pop.querySelector('.ask-pop-caption-meter').textContent, '120 chats');
  assert.deepEqual(listUrls(ctx), ['/api/ask/threads?limit=50']);

  type(ctx, input, 'lo'); type(ctx, input, 'login');
  assert.equal(listUrls(ctx).length, 1, 'nothing fetched while typing');
  await debounce(); await ctx.tick();
  assert.deepEqual(listUrls(ctx).slice(1), ['/api/ask/threads?limit=50&q=login'], 'one fetch per burst');
  assert.deepEqual(titles(pop), ['Fix the login bug', 'Login copy']);
  assert.equal(pop.querySelector('.ask-pop-caption-meter').textContent, '2 of 120');
  assert.equal(ctx.doc.activeElement, input, 'results never steal focus from the field');

  type(ctx, input, 'zzz');
  await debounce(); await ctx.tick();
  assert.equal(pop.querySelector('.ask-pop-empty').textContent, 'No chats match.');
  assert.equal(pop.querySelector('.ask-pop-caption-meter').textContent, '0 of 120');
  assert.equal(pop.querySelectorAll('.ask-pop-empty').length, 1, 'empty state replaced, not stacked');
});

test('history search: a slower older query cannot overwrite a newer one', async () => {
  const srv = server();
  srv.held.set('lo', []);
  const ctx = makePanel({ fetchHandler: srv.fetchHandler });
  const pop = await openHistory(ctx);
  const input = pop.querySelector('input.ask-threads-search');
  type(ctx, input, 'lo'); await debounce();             // parked
  type(ctx, input, 'explain'); await debounce(); await ctx.tick();
  assert.deepEqual(titles(pop), ['Explain run 4e1f']);
  srv.held.get('lo').forEach((release) => release());
  await ctx.tick(); await ctx.tick();
  assert.deepEqual(titles(pop), ['Explain run 4e1f'], 'the stale response lost');
});

test('history search: keyboard — ArrowDown/ArrowUp leave the field, Home/End stay in it, Escape clears then closes', async () => {
  const ctx = makePanel({ fetchHandler: server().fetchHandler });
  const pop = await openHistory(ctx);
  const input = pop.querySelector('input.ask-threads-search');
  const items = () => [...pop.querySelectorAll('[role="menuitem"]')];
  key(ctx.window, input, 'Home');
  assert.equal(ctx.doc.activeElement, input, 'Home is caret movement in the field');
  key(ctx.window, input, 'ArrowDown');
  assert.equal(ctx.doc.activeElement, items()[0]);
  input.focus();
  key(ctx.window, input, 'ArrowUp');
  assert.equal(ctx.doc.activeElement, items()[items().length - 1]);

  input.focus();
  type(ctx, input, 'login'); await debounce(); await ctx.tick();
  key(ctx.window, input, 'Escape');
  assert.ok(ctx.doc.querySelector('.ask-pop-threads'), 'first Escape only clears');
  assert.equal(input.value, '');
  assert.equal(ctx.doc.activeElement, input);
  await ctx.tick(); await ctx.tick();
  assert.equal(titles(pop).length, 3, 'the full list is back');
  assert.equal(pop.querySelector('.ask-pop-caption-meter').textContent, '120 chats');
  key(ctx.window, input, 'Escape');
  assert.equal(ctx.doc.querySelector('.ask-pop-threads'), null, 'second Escape closes');
  assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('[data-ask-threads-btn]'));
});

test('history search: a live refresh keeps the query and the field focus; reopen starts empty', async () => {
  const ctx = makePanel({ fetchHandler: server().fetchHandler });
  const pop = await openHistory(ctx);
  const input = pop.querySelector('input.ask-threads-search');
  type(ctx, input, 'login'); await debounce(); await ctx.tick();
  ctx.panel.pushServerFrame({ type: 'ask-run-status', threadId: 'ask_00000001', runId: 'u', pipelineId: 'aaaa1111', cardId: null, status: 'running', phase: 'plan' });
  await wait(320); await ctx.tick();
  assert.equal(listUrls(ctx).at(-1), '/api/ask/threads?limit=50&q=login', 'refresh reuses the query');
  assert.deepEqual(titles(pop), ['Fix the login bug', 'Login copy']);
  assert.equal(ctx.doc.activeElement, input, 'refresh does not steal focus');
  assert.equal(input.value, 'login');

  ctx.doc.querySelector('[data-ask-threads-btn]').click();   // close
  ctx.doc.querySelector('[data-ask-threads-btn]').click();   // reopen
  await ctx.tick(); await ctx.tick();
  const again = ctx.doc.querySelector('.ask-pop-threads');
  assert.equal(again.querySelector('input.ask-threads-search').value, '');
  assert.equal(listUrls(ctx).at(-1), '/api/ask/threads?limit=50');
  assert.equal(titles(again).length, 3);
});

test('history search: closing with a pending debounce fetches nothing', async () => {
  const ctx = makePanel({ fetchHandler: server().fetchHandler });
  const pop = await openHistory(ctx);
  type(ctx, pop.querySelector('input.ask-threads-search'), 'login');
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await debounce();
  assert.deepEqual(listUrls(ctx), ['/api/ask/threads?limit=50']);
});
