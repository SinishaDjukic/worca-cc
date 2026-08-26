// test/ask-panel-pickers.test.mjs — model picker, run-info, thread actions
// (spec §10.6, D8, D13/D14). Catalog and threads come from the injected fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';

const TID = 'ask_00000001';

const CATALOG = {
  models: [
    { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
    { id: 'claude-fable-5', label: 'Fable 5 (1M)', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
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
  assert.deepEqual(names, ['Opus 5', 'Fable 5 (1M)', 'Sonnet 4.6', 'Haiku 4.5', 'Corp']);
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
  assert.match(ctx.doc.querySelector('.ask-pop-model').textContent, /Fable 5/);
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
  assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: 'claude-opus-5', effort: 'max' });
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
