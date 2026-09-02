// test/ask-panel-pickers.test.mjs — model picker, run-info, thread actions
// (spec §10.6, D8, D13/D14). Catalog and threads come from the injected fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';

const TID = 'ask_00000001';

const CATALOG = {
  models: [
    { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
    { id: 'claude-fable-5-1', label: 'Fable 5.1 (1M)', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
    { id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', efforts: ['medium', 'high', 'max'], custom: false },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], custom: false },
    { id: 'my-corp-model', label: 'Corp', efforts: ['high'], custom: 'global' },
  ],
  efforts: ['medium', 'high', 'xhigh', 'max'],
};

function snapBody(messages = []) {
  return { thread: { id: TID, title: 'Stored', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} }, messages, attachments: [], runLinks: [], inFlight: null };
}

function handler({ messages = [] } = {}) {
  return (url, opts) => {
    if (url === '/api/ask/models') return { ok: true, status: 200, json: async () => CATALOG };
    if (url.startsWith(`/api/ask/threads/${TID}`) && (!opts.method || opts.method === 'GET')) return { ok: true, status: 200, json: async () => snapBody(messages) };
    if (url.startsWith(`/api/ask/threads/${TID}`) && opts.method === 'DELETE') return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (url.startsWith('/api/ask/threads') && !opts.method) return { ok: true, status: 200, json: async () => ({ threads: [{ id: TID, title: 'Stored', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false }] }) };
    if (url === '/api/ask/threads' && opts.method === 'POST') return { ok: true, status: 201, json: async () => ({ thread: { id: TID, title: null, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} } }) };
    if (url.endsWith('/messages') && opts.method === 'POST') return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: 'askm_00000001' }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

test('ask-panel-pickers: zero fetches before open; first open loads catalog once + the stored thread', async () => {
  const ctx = makePanel({ fetchHandler: handler() });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  assert.equal(ctx.fetchCalls.length, 0, 'no network before the sheet opens');
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(ctx.fetchCalls.filter((c) => c.url === '/api/ask/models').length, 1);
  assert.equal(ctx.fetchCalls.filter((c) => c.url === `/api/ask/threads/${TID}`).length, 1, 'stored thread restored');
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Stored');
  ctx.panel.close();
  ctx.panel.open();
  await ctx.tick();
  assert.equal(ctx.fetchCalls.filter((c) => c.url === '/api/ask/models').length, 1, 'catalog cached');
});

test('ask-panel-pickers: primary list = one per family + globals; More models holds the rest', async () => {
  const ctx = makePanel({ fetchHandler: handler() });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-model-btn]').click();
  await ctx.tick();
  const pop = ctx.doc.querySelector('.ask-pop-model');
  assert.ok(pop);
  const names = [...pop.querySelectorAll('.ask-model-name')].map((n) => n.textContent);
  assert.deepEqual(names, ['Opus 5', 'Fable 5.1 (1M)', 'Sonnet 4.6', 'Haiku 4.5', 'Corp']);
  assert.match(pop.textContent, /More models/);
  assert.match(pop.textContent, /Effort/);
  // the selected model carries the check mark
  const checked = pop.querySelector('.ask-model-check');
  assert.ok(checked && checked.closest('[role="menuitem"]').textContent.includes('Opus 5'));
  // More pane
  ctx.doc.querySelector('[data-ask-more-models]').click();
  const moreNames = [...ctx.doc.querySelectorAll('.ask-pop-model .ask-model-name')].map((n) => n.textContent);
  assert.deepEqual(moreNames, ['Opus 4.8']);
  ctx.doc.querySelector('[data-ask-pane-back]').click();
  assert.match(ctx.doc.querySelector('.ask-pop-model').textContent, /Fable 5\.1/);
});

test('ask-panel-pickers: effort pane lists the current model efforts; picking persists', async () => {
  const ctx = makePanel({ fetchHandler: handler() });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-model-btn]').click();
  await ctx.tick();
  ctx.doc.querySelector('[data-ask-effort-row]').click();
  const efforts = [...ctx.doc.querySelectorAll('.ask-pop-model .ask-model-name')].map((n) => n.textContent);
  assert.deepEqual(efforts, ['medium', 'high', 'xhigh', 'max']);
  const max = [...ctx.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent.includes('max'));
  max.click();
  assert.equal(ctx.doc.querySelector('.ask-model-btn-effort').textContent, 'max');
  // The user changed the EFFORT only, so the model slot stays unclaimed (model:null)
  // and the backend default keeps winning it on the next load (D11).
  assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: null, effort: 'max' });
});

test('ask-panel-pickers: picking a model with fewer efforts coerces the effort', async () => {
  const ctx = makePanel({ fetchHandler: handler() });
  ctx.storage.setItem('worca-cc.ask.model', JSON.stringify({ model: 'claude-opus-5', effort: 'max' }));
  const ctx2 = makePanel({ fetchHandler: handler(), storage: ctx.storage });
  ctx2.panel.open();
  await ctx2.tick(); await ctx2.tick();
  ctx2.doc.querySelector('[data-ask-model-btn]').click();
  await ctx2.tick();
  const haiku = [...ctx2.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent.includes('Haiku 4.5'));
  haiku.click();
  assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: 'claude-haiku-4-5', effort: 'high' }, 'max is not available on haiku — coerced to high');
  assert.equal(ctx2.doc.querySelector('.ask-model-btn-label').textContent, 'Haiku 4.5', 'button shows the label once the catalog is known');
});

test('ask-panel-pickers: an unknown stored model resets to the initial default on catalog load', async () => {
  const ctx = makePanel({ fetchHandler: handler() });
  ctx.storage.setItem('worca-cc.ask.model', JSON.stringify({ model: 'claude-gone-1', effort: 'high' }));
  const ctx2 = makePanel({ fetchHandler: handler(), storage: ctx.storage });
  ctx2.panel.open();
  await ctx2.tick(); await ctx2.tick();
  assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: 'claude-opus-5', effort: 'high' });
});

// A catalog with plugin entries + a backend default (the widened /api/ask/models).
const CATALOG_WIDE = {
  models: [
    { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false, hasEnv: false },
    { id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false, hasEnv: false },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], custom: false, hasEnv: false },
    { id: 'my-corp-model', label: 'Corp', efforts: ['high'], custom: 'global', hasEnv: true },
    { id: 'acme-fast', label: 'Acme Fast', efforts: ['medium', 'high'], custom: 'plugin', plugin: 'acme', hasEnv: true },
    { id: 'acme-slow', label: 'Acme Slow', efforts: ['medium'], custom: 'plugin', plugin: 'acme', hasEnv: true, costUnreliable: true },
    { id: 'bolt-x', label: 'Bolt X', efforts: ['high'], custom: 'plugin', plugin: 'bolt', hasEnv: true, secretsMissing: ['BOLT_KEY'] },
  ],
  efforts: ['medium', 'high', 'xhigh', 'max'],
  default: { model: 'claude-opus-5', effort: 'high' },
};

function wideHandler(catalog = CATALOG_WIDE) {
  const base = handler();
  return (url, opts) => (url === '/api/ask/models'
    ? { ok: true, status: 200, json: async () => catalog }
    : base(url, opts));
}

async function openPicker(ctx) {
  ctx.panel.open();
  await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-model-btn]').click();
  await ctx.tick();
  return ctx.doc.querySelector('.ask-pop-model');
}

test('ask-panel-pickers: an unknown stored model resets to the BACKEND default, not a hardcoded id', async () => {
  const seed = makePanel({ fetchHandler: handler() });   // never opened: builds a storage, fetches nothing
  seed.storage.setItem('worca-cc.ask.model', JSON.stringify({ model: 'claude-gone-1', effort: 'high' }));
  const ctx = makePanel({
    fetchHandler: wideHandler({ ...CATALOG_WIDE, default: { model: 'my-corp-model', effort: 'high' } }),
    storage: seed.storage,
  });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick();
  // A stored pick that no longer exists IS repaired on disk — otherwise the dead id sticks forever.
  assert.deepEqual(JSON.parse(seed.storage.getItem('worca-cc.ask.model')), { model: 'my-corp-model', effort: 'high' });
  assert.equal(ctx.doc.querySelector('.ask-model-btn-label').textContent, 'Corp');
});

test('ask-panel-pickers: with no stored pick the backend default wins, and is NOT persisted (D11)', async () => {
  const ctx = makePanel({
    fetchHandler: wideHandler({ ...CATALOG_WIDE, default: { model: 'claude-haiku-4-5', effort: 'medium' } }),
  });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-model-btn-label').textContent, 'Haiku 4.5');
  assert.equal(ctx.doc.querySelector('.ask-model-btn-effort').textContent, 'medium');
  // D11: a default the user never chose must not be written, or a later change to
  // ASK_LIMITS.defaultModel would lose to it forever.
  assert.equal(ctx.storage.getItem('worca-cc.ask.model'), null, 'the backend default is not persisted');
});

test('ask-panel-pickers: a payload without `default` still falls back to the cold-start pick', async () => {
  // Guards the three ui-* suites, whose /api/ask/models stubs ship {models,efforts} only.
  const ctx = makePanel({ fetchHandler: handler() }); // CATALOG has no `default`
  ctx.panel.open();
  await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-model-btn-label').textContent, 'Opus 5');
  assert.equal(ctx.doc.querySelector('.ask-model-btn-effort').textContent, 'high');
});

test('ask-panel-pickers: an effort-only change does not pin the model (D11)', async () => {
  // Changing the effort is routine. If it persisted the whole pick, the backend
  // default would be authoritative exactly once per browser — the failure D11 exists
  // to prevent — so the stored record has to say "this effort, no model".
  const ctx = makePanel({
    fetchHandler: wideHandler({ ...CATALOG_WIDE, default: { model: 'claude-haiku-4-5', effort: 'high' } }),
  });
  await openPicker(ctx);
  ctx.doc.querySelector('[data-ask-effort-row]').click();
  [...ctx.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent === 'medium').click();
  assert.equal(ctx.doc.querySelector('.ask-model-btn-effort').textContent, 'medium');
  assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: null, effort: 'medium' });

  // Same browser, same storage, an operator who has since moved ASK_LIMITS.defaultModel:
  // the new default reaches it, and the effort the user DID choose survives.
  const later = makePanel({
    fetchHandler: wideHandler({ ...CATALOG_WIDE, default: { model: 'claude-opus-5', effort: 'high' } }),
    storage: ctx.storage,
  });
  later.panel.open();
  await later.tick(); await later.tick();
  assert.equal(later.doc.querySelector('.ask-model-btn-label').textContent, 'Opus 5');
  assert.equal(later.doc.querySelector('.ask-model-btn-effort').textContent, 'medium');
  assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: null, effort: 'medium' },
    'adopting the backend default still writes nothing');
});

test('ask-panel-pickers: an effort picked BEFORE the catalog lands does not pin the cold-start model', async () => {
  // A slow /api/ask/models renders the popover with no model rows but a live Effort
  // row; picking there must not persist FALLBACK_PICK — a model the user never saw.
  const ctx = makePanel({
    fetchHandler: wideHandler({ ...CATALOG_WIDE, default: { model: 'my-corp-model', effort: 'high' } }),
  });
  ctx.panel.open();
  ctx.doc.querySelector('[data-ask-model-btn]').click();   // no tick: st.catalog is still null
  assert.deepEqual([...ctx.doc.querySelectorAll('.ask-pop-model .ask-model-item')], [], 'no model rows yet');
  ctx.doc.querySelector('[data-ask-effort-row]').click();
  [...ctx.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent === 'xhigh').click();
  assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: null, effort: 'xhigh' });

  await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-model-btn-label').textContent, 'Corp',
    'the backend default still wins the model slot once the catalog lands');
});

test('ask-panel-pickers: the send body carries the picked model', async () => {
  const bodies = [];
  const h = handler();
  const ctx = makePanel({
    fetchHandler: (url, opts) => {
      if (url.endsWith('/messages') && opts.method === 'POST') { bodies.push(JSON.parse(opts.body)); }
      return h(url, opts);
    },
  });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-model-btn]').click();
  await ctx.tick();
  [...ctx.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent.includes('Haiku 4.5')).click();
  ctx.doc.querySelector('textarea.ask-input').value = 'hello there';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(bodies[0].model, 'claude-haiku-4-5');
  assert.equal(bodies[0].effort, 'high');
});

test('ask-panel-pickers: run-info popover lists agents with model and meter; empty state', async () => {
  const agent = { kind: 'agent', id: 'toolu_1', label: 'count runs', type: 'general-purpose', model: 'claude-haiku-4-5', tokens: 5321, usage: { input: 10, output: 69, cacheRead: 4564, cacheCreation: 678 }, costUsd: 0.62, estimated: true, status: 'done', durationMs: 2861, log: [] };
  const messages = [{ id: 'askm_00000001', threadId: TID, seq: 1, role: 'assistant', text: 'ok', blocks: [agent], status: 'done', reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' }];
  const ctx = makePanel({ fetchHandler: handler({ messages }) });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-agents-btn]').click();
  await ctx.tick();
  const pop = ctx.doc.querySelector('.ask-pop-runinfo');
  assert.ok(pop);
  assert.match(pop.textContent, /Agents this chat/);
  assert.match(pop.textContent, /count runs/);
  assert.match(pop.textContent, /claude-haiku-4-5/);
  assert.match(pop.textContent, /5\.3k tok/);
  assert.match(pop.textContent, /≈\$0\.62/);
  // empty
  const ctx2 = makePanel({ fetchHandler: handler() });
  ctx2.panel.open();
  await ctx2.tick(); await ctx2.tick();
  ctx2.doc.querySelector('[data-ask-agents-btn]').click();
  await ctx2.tick();
  assert.match(ctx2.doc.querySelector('.ask-pop-runinfo').textContent, /No agents spawned yet\./);
});

test('ask-panel-pickers: delete asks with the exact copy, DELETEs, clears the current thread', async () => {
  const confirms = [];
  const ctx = makePanel({ fetchHandler: handler(), confirm: async (opts) => { confirms.push(opts); return true; } });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ctx.tick();
  ctx.doc.querySelector('.ask-thread-trash').click();
  await ctx.tick(); await ctx.tick();
  assert.equal(confirms.length, 1);
  assert.deepEqual(confirms[0], { title: 'Delete this chat?', message: '“Stored” and its transcript are removed. This cannot be undone.', confirmLabel: 'Delete', danger: true });
  assert.ok(ctx.fetchCalls.some((c) => c.url === `/api/ask/threads/${TID}` && c.opts.method === 'DELETE'));
  assert.equal(ctx.storage.getItem('worca-cc.ask.thread'), null);
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Ask Worca', 'back to an empty thread');
  assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('textarea.ask-input'), 'focus returns to the textarea');
});

test('ask-panel-pickers: declining the confirm sends no DELETE', async () => {
  const ctx = makePanel({ fetchHandler: handler(), confirm: async () => false });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ctx.tick();
  ctx.doc.querySelector('.ask-thread-trash').click();
  await ctx.tick(); await ctx.tick();
  assert.ok(!ctx.fetchCalls.some((c) => c.opts.method === 'DELETE'));
});

test('ask-panel-pickers: a thread still being titled reads "New chat" in Recent chats, the trash label and the delete confirm', async () => {
  const confirms = [];
  const base = handler();
  const untitled = { id: TID, title: null, updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false };
  const fetchHandler = (url, opts) => (url.startsWith('/api/ask/threads') && !url.startsWith(`/api/ask/threads/${TID}`) && !opts.method
    ? { ok: true, status: 200, json: async () => ({ threads: [untitled] }) }
    : base(url, opts));
  const ctx = makePanel({ fetchHandler, confirm: async (opts) => { confirms.push(opts); return false; } });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-thread-title').textContent, 'New chat');
  assert.equal(ctx.doc.querySelector('.ask-thread-trash').getAttribute('aria-label'), 'Delete "New chat"');
  ctx.doc.querySelector('.ask-thread-trash').click();
  await ctx.tick(); await ctx.tick();
  assert.equal(confirms.length, 1);
  assert.match(confirms[0].message, /^“New chat” and its transcript are removed/);
});

test('ask-panel-pickers: New chat clears the thread; the next send creates a fresh row', async () => {
  const ctx = makePanel({ fetchHandler: handler() });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Stored');
  ctx.doc.querySelector('[data-ask-new-btn]').click();
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Ask Worca');
  assert.equal(ctx.storage.getItem('worca-cc.ask.thread'), null);
  ctx.doc.querySelector('textarea.ask-input').value = 'fresh start';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.ok(ctx.fetchCalls.some((c) => c.url === '/api/ask/threads' && c.opts.method === 'POST'), 'thread created on send');
});

test('ask-panel-pickers: run-info popover shows per-agent ctx and a cost-only header (no token sum)', async () => {
  const agent = { kind: 'agent', id: 'toolu_1', label: 'count runs', type: 'general-purpose', model: 'claude-haiku-4-5', tokens: 25321, ctx: 11645, usage: null, costUsd: 0.62, estimated: true, status: 'done', durationMs: 2861, log: [] };
  const messages = [{ id: 'askm_00000001', threadId: TID, seq: 1, role: 'assistant', text: 'ok', blocks: [agent], status: 'done', reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' }];
  const ctx = makePanel({ fetchHandler: handler({ messages }) });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-agents-btn]').click();
  await ctx.tick();
  const pop = ctx.doc.querySelector('.ask-pop-runinfo');
  assert.match(pop.textContent, /11\.6k ctx/, 'the row shows the agent context fill');
  assert.equal(pop.querySelector('.ask-pop-caption-meter').textContent, '≈$0.62', 'header: cost only — summing ctx across agents means nothing');
});

test('ask-panel-pickers: plugin models group by plugin — one per plugin up front, the rest in More', async () => {
  const ctx = makePanel({ fetchHandler: wideHandler() });
  const pop = await openPicker(ctx);
  const names = [...pop.querySelectorAll('.ask-model-name')].map((n) => n.textContent);
  // one per claude family + every global + one per plugin
  assert.deepEqual(names, ['Opus 5', 'Haiku 4.5', 'Corp', 'Acme Fast', 'Bolt X']);
  // renderPane() calls panel.replaceChildren() (:769), so the More pane holds ONLY the rest.
  ctx.doc.querySelector('[data-ask-more-models]').click();
  const more = [...ctx.doc.querySelectorAll('.ask-pop-model .ask-model-name')].map((n) => n.textContent);
  assert.deepEqual(more, ['Opus 4.8', 'Acme Slow'], 'the plugin\'s second model does not flood the primary list');
});

test('ask-panel-pickers: the selected model is always in the primary pane', async () => {
  const seed = makePanel({ fetchHandler: handler() });
  seed.storage.setItem('worca-cc.ask.model', JSON.stringify({ model: 'acme-slow', effort: 'medium' }));
  const ctx = makePanel({ fetchHandler: wideHandler(), storage: seed.storage });
  const pop = await openPicker(ctx);
  const names = [...pop.querySelectorAll('.ask-model-name')].map((n) => n.textContent);
  assert.ok(names.includes('Acme Slow'), 'the picked model is reachable without opening More');
  const checked = pop.querySelector('.ask-model-check');
  assert.ok(checked && checked.closest('[role="menuitem"]').textContent.includes('Acme Slow'));
});

test('ask-panel-pickers: a row shows the name and the warnings — never where the model came from', async () => {
  const ctx = makePanel({ fetchHandler: wideHandler() });
  const pop = await openPicker(ctx);
  const row = (label) => [...pop.querySelectorAll('.ask-model-item')].find((b) => b.textContent.includes(label));

  // A plugin model reads exactly like a built-in: name first, nothing about its origin.
  const acme = row('Acme Fast');
  assert.equal(acme.firstChild.className, 'ask-model-name', 'the name leads the row');
  assert.equal(acme.childNodes.length, 1, 'and it is the whole row');
  assert.equal(row('Corp').childNodes.length, 1, 'a global model is just as plain');
  // Opus 5 is the picked model, so its row is name + ✓ — and still nothing else.
  assert.deepEqual([...row('Opus 5').childNodes].map((n) => n.className), ['ask-model-name', 'ask-model-check']);

  // The two STATUS badges are warnings, not provenance — they stay.
  const bolt = [...row('Bolt X').querySelectorAll('.ask-model-tag')].map((t) => t.textContent);
  assert.deepEqual(bolt, ['secret not set']);
  assert.match(row('Bolt X').querySelector('.ask-model-tag.is-err').title, /BOLT_KEY/);

  ctx.doc.querySelector('[data-ask-more-models]').click();
  const slow = [...ctx.doc.querySelectorAll('.ask-pop-model .ask-model-item')].find((b) => b.textContent.includes('Acme Slow'));
  assert.deepEqual([...slow.querySelectorAll('.ask-model-tag')].map((t) => t.textContent), ['⚠cost']);
});

test('ask-panel-pickers: a long plugin name does not cost the model its name', async () => {
  // The row a long plugin name used to wreck: nothing about the plugin reaches the
  // row now, so the name is the only variable-width text in it. The JS emits the
  // FULL label; trimming is the stylesheet's job (.ask-model-item .ask-model-name,
  // pinned by ui-ask-style).
  const LONG = 'discretestack-models';
  const ctx = makePanel({
    fetchHandler: wideHandler({
      models: [
        { id: 'ds-fast', label: 'DS Fast', efforts: ['medium'], custom: 'plugin', plugin: LONG, hasEnv: true, secretsMissing: ['ds-other'] },
      ],
      efforts: ['medium', 'high', 'xhigh', 'max'],
      default: { model: 'ds-fast', effort: 'medium' },
    }),
  });
  const pop = await openPicker(ctx);
  const row = pop.querySelector('.ask-model-item');
  assert.equal(row.querySelector('.ask-model-name').textContent, 'DS Fast', 'the name is emitted in full');
  assert.ok(!row.textContent.includes(LONG), 'the plugin name is nowhere in the row');
  assert.deepEqual([...row.querySelectorAll('.ask-model-tag')].map((t) => t.textContent), ['secret not set']);
  assert.ok(row.querySelector('.ask-model-check'), 'the check mark is still the last child of the row');
  assert.equal(row.lastChild.className, 'ask-model-check');
});

test('ask-panel-pickers: the trigger button flags a picked model that is cost-flagged or secret-less', async () => {
  const bodies = [];
  const w = wideHandler();
  const ctx = makePanel({
    fetchHandler: (url, opts) => {
      if (url.endsWith('/messages') && opts.method === 'POST') bodies.push(JSON.parse(opts.body));
      return w(url, opts);
    },
  });
  await openPicker(ctx);
  [...ctx.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent.includes('Bolt X')).click();
  assert.equal(ctx.doc.querySelector('.ask-model-btn-label').textContent, 'Bolt X ⚠');
  // …and the pick still reaches the wire unchanged (D9: warn, do not block).
  ctx.doc.querySelector('textarea.ask-input').value = 'hi there';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(bodies[0].model, 'bolt-x');
  assert.equal(bodies[0].effort, 'high');
});
