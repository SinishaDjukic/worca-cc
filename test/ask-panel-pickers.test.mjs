// test/ask-panel-pickers.test.mjs — model picker, run-info, thread actions
// (spec §10.6, D8, D13/D14). Catalog and threads come from the injected fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';

import { makePanel, openChat, deleteFromList } from './helpers/ask-panel-harness.mjs';

const TID = 'ask_00000001';

const CATALOG = {
  models: [
    { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
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

test('ask-panel-pickers: the effort pane lists the model\'s efforts and persists a pick; a model with fewer efforts coerces it; a model with none greys the row', async () => {
  await checkRows([
    { name: 'ask-panel-pickers: effort pane lists the current model efforts; picking persists', run: async () => {
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
    } },
    { name: 'ask-panel-pickers: picking a model with fewer efforts coerces the effort', run: async () => {
      const ctx = makePanel({ fetchHandler: handler() });
      ctx.storage.setItem('worca-cc.ask.model', JSON.stringify({ model: 'claude-opus-5-5', effort: 'max' }));
      const ctx2 = makePanel({ fetchHandler: handler(), storage: ctx.storage });
      ctx2.panel.open();
      await ctx2.tick(); await ctx2.tick();
      ctx2.doc.querySelector('[data-ask-model-btn]').click();
      await ctx2.tick();
      const haiku = [...ctx2.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent.includes('Haiku 4.5'));
      haiku.click();
      assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: 'claude-haiku-4-5', effort: 'high' }, 'max is not available on haiku — coerced to high');
      assert.equal(ctx2.doc.querySelector('.ask-model-btn-label').textContent, 'Haiku 4.5', 'button shows the label once the catalog is known');
    } },
    { name: 'ask-panel-pickers: a model that takes no effort greys the Effort row out and drops the effort from the button', run: async () => {
      const noEff = { ...CATALOG, models: [{ id: 'copilot-claude-haiku-4.5', label: 'Claude Haiku 4.5 (Copilot)', efforts: ['medium', 'high'], custom: 'global', noEffort: true }, ...CATALOG.models] };
      const base = handler();
      const ctx = makePanel({ fetchHandler: (url, opts) => (url === '/api/ask/models' ? { ok: true, status: 200, json: async () => noEff } : base(url, opts)) });
      ctx.panel.open();
      await ctx.tick(); await ctx.tick();
      ctx.doc.querySelector('[data-ask-model-btn]').click();
      await ctx.tick(); await ctx.tick();
      const pick = [...ctx.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent.includes('Claude Haiku 4.5 (Copilot)'));
      pick.click();
      await ctx.tick();
      const btnEffort = ctx.doc.querySelector('.ask-model-btn-effort');
      assert.equal(btnEffort.hidden, true);
      ctx.doc.querySelector('[data-ask-model-btn]').click();
      await ctx.tick(); await ctx.tick();
      const row = ctx.doc.querySelector('[data-ask-effort-row]');
      assert.equal(row.disabled, true);
      assert.match(row.textContent, /not supported/);
      row.click();
      assert.equal(ctx.doc.querySelector('.ask-effort-item'), null, 'no effort pane');
    } },
  ]);
});

test('ask-panel-pickers: catalog fallback rules — an unknown or vanished stored/thread model falls to the backend default unpersisted; no default → cold-start pick; a thread loaded before the catalog keeps its model', async () => {
  await checkRows([
    { name: 'ask-panel-pickers: an unknown stored model resets to the initial default on catalog load', run: async () => {
      const ctx = makePanel({ fetchHandler: handler() });
      ctx.storage.setItem('worca-cc.ask.model', JSON.stringify({ model: 'claude-gone-1', effort: 'high' }));
      const ctx2 = makePanel({ fetchHandler: handler(), storage: ctx.storage });
      ctx2.panel.open();
      await ctx2.tick(); await ctx2.tick();
      assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: 'claude-opus-5-5', effort: 'high' });
    } },
    { name: 'ask-panel-pickers: an unknown stored model resets to the BACKEND default, not a hardcoded id', run: async () => {
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
    } },
    { name: 'ask-panel-pickers: with no stored pick the backend default wins, and is NOT persisted (D11)', run: async () => {
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
    } },
    { name: 'ask-panel-pickers: a payload without `default` still falls back to the cold-start pick', run: async () => {
      // Guards the three ui-* suites, whose /api/ask/models stubs ship {models,efforts} only.
      const ctx = makePanel({ fetchHandler: handler() }); // CATALOG has no `default`
      ctx.panel.open();
      await ctx.tick(); await ctx.tick();
      assert.equal(ctx.doc.querySelector('.ask-model-btn-label').textContent, 'Opus 5.5');
      assert.equal(ctx.doc.querySelector('.ask-model-btn-effort').textContent, 'high');
    } },
    { name: 'ask-panel-pickers: a thread model the catalog no longer has falls back and is not persisted', run: async () => {
      const seed = makePanel({ fetchHandler: handler() });
      seed.storage.setItem('worca-cc.ask.model', JSON.stringify({ model: 'claude-haiku-4-5', effort: 'medium' }));
      const gone = threadRow(TID_A, 'Alpha', 'removed-user-model', 'high');
      const h = threadsHandler({ threads: [gone, B_HAIKU_HIGH] });
      const ctx = makePanel({ fetchHandler: h.fetchHandler, storage: seed.storage });
      ctx.storage.setItem('worca-cc.ask.thread', TID_B);
      ctx.panel.open();
      await settle(ctx);
      await pickThread(ctx, 'Alpha');
      assert.deepEqual(pickerShows(ctx), ['Haiku 4.5', 'medium'], 'the browser-level pick, not the dead id');
      assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: 'claude-haiku-4-5', effort: 'medium' }, 'storage untouched');
      assert.deepEqual(h.patches, [], 'the thread is not patched — its next send stores what is used');

      // Nothing stored: the chain continues to the backend default, still unwritten.
      const h2 = threadsHandler({ threads: [gone] });
      const bare = makePanel({ fetchHandler: h2.fetchHandler });
      bare.storage.setItem('worca-cc.ask.thread', TID_A);
      bare.panel.open();
      await settle(bare);
      assert.deepEqual(pickerShows(bare), ['Opus 5.5', 'high']);
      assert.equal(bare.storage.getItem('worca-cc.ask.model'), null);
      assert.deepEqual(h2.patches, []);
    } },
    { name: 'ask-panel-pickers: a thread loaded BEFORE the catalog keeps its model once the catalog lands', run: async () => {
      let release;
      const models = new Promise((r) => { release = r; });
      // A stored pick the catalog-arrival repair would write if it thought the pick was the browser's.
      const seed = makePanel({ fetchHandler: handler() });
      seed.storage.setItem('worca-cc.ask.model', JSON.stringify({ model: 'claude-haiku-4-5', effort: 'medium' }));
      const h = threadsHandler({ threads: [threadRow(TID_A, 'Alpha', 'claude-haiku-4-5', 'max')], models });
      const ctx = makePanel({ fetchHandler: h.fetchHandler, storage: seed.storage });
      ctx.storage.setItem('worca-cc.ask.thread', TID_A);
      ctx.panel.open();
      await settle(ctx);
      assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Alpha', 'the thread landed first');
      assert.deepEqual(pickerShows(ctx), ['claude-haiku-4-5', 'max'], 'the raw id shows until the catalog lands');
      release({ ...CATALOG_WIDE, default: { model: 'my-corp-model', effort: 'high' } });
      await settle(ctx);
      assert.deepEqual(pickerShows(ctx), ['Haiku 4.5', 'high'], 'the thread\'s model outranks the backend default; max coerced for haiku');
      assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: 'claude-haiku-4-5', effort: 'medium' },
        'the catalog repair never writes a thread-sourced pick');
    } },
  ]);
});

// A catalog with plugin entries + a backend default (the widened /api/ask/models).
const CATALOG_WIDE = {
  models: [
    { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false, hasEnv: false },
    { id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false, hasEnv: false },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], custom: false, hasEnv: false },
    { id: 'my-corp-model', label: 'Corp', efforts: ['high'], custom: 'global', hasEnv: true },
    { id: 'acme-fast', label: 'Acme Fast', efforts: ['medium', 'high'], custom: 'plugin', plugin: 'acme', hasEnv: true },
    { id: 'acme-slow', label: 'Acme Slow', efforts: ['medium'], custom: 'plugin', plugin: 'acme', hasEnv: true, costUnreliable: true },
    { id: 'bolt-x', label: 'Bolt X', efforts: ['high'], custom: 'plugin', plugin: 'bolt', hasEnv: true, secretsMissing: ['BOLT_KEY'] },
  ],
  efforts: ['medium', 'high', 'xhigh', 'max'],
  default: { model: 'claude-opus-5-5', effort: 'high' },
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

test('ask-panel-pickers: picks — an effort-only change never pins the model; an open thread PATCHes {model,effort}; no thread PATCHes nothing', async () => {
  await checkRows([
    { name: 'ask-panel-pickers: an effort-only change does not pin the model (D11)', run: async () => {
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
        fetchHandler: wideHandler({ ...CATALOG_WIDE, default: { model: 'claude-opus-5-5', effort: 'high' } }),
        storage: ctx.storage,
      });
      later.panel.open();
      await later.tick(); await later.tick();
      assert.equal(later.doc.querySelector('.ask-model-btn-label').textContent, 'Opus 5.5');
      assert.equal(later.doc.querySelector('.ask-model-btn-effort').textContent, 'medium');
      assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: null, effort: 'medium' },
        'adopting the backend default still writes nothing');
    } },
    { name: 'ask-panel-pickers: an effort picked BEFORE the catalog lands does not pin the cold-start model', run: async () => {
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
    } },
    { name: 'ask-panel-pickers: picking in an open thread PATCHes {model, effort}; the switch back keeps it', run: async () => {
      const h = threadsHandler({ threads: [A_OPUS_MAX, B_HAIKU_HIGH] });
      const ctx = makePanel({ fetchHandler: h.fetchHandler });
      ctx.storage.setItem('worca-cc.ask.thread', TID_A);
      const pop = await openPicker(ctx);
      await settle(ctx);
      assert.ok(pop);
      [...ctx.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent.includes('Haiku 4.5')).click();
      await ctx.tick();
      assert.deepEqual(h.patches, [{ id: TID_A, body: { model: 'claude-haiku-4-5', effort: 'high' } }], 'max coerced to high, both sent');
      assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: 'claude-haiku-4-5', effort: 'high' }, 'still the browser-level pick too');

      ctx.doc.querySelector('[data-ask-model-btn]').click();
      await ctx.tick();
      ctx.doc.querySelector('[data-ask-effort-row]').click();
      [...ctx.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent === 'medium').click();
      await ctx.tick();
      assert.deepEqual(h.patches[1], { id: TID_A, body: { model: 'claude-haiku-4-5', effort: 'medium' } }, 'an effort pick sends the current model too');

      await pickThread(ctx, 'Beta');
      assert.deepEqual(pickerShows(ctx), ['Haiku 4.5', 'high']);
      await pickThread(ctx, 'Alpha');
      assert.deepEqual(pickerShows(ctx), ['Haiku 4.5', 'medium'], 'the pick made in Alpha survives the round trip unsent');
    } },
    { name: 'ask-panel-pickers: an effort picked on a thread\'s model leaves the stored model slot alone', run: async () => {
      const seed = makePanel({ fetchHandler: handler() });
      seed.storage.setItem('worca-cc.ask.model', JSON.stringify({ model: 'claude-sonnet-4-6', effort: 'medium' }));
      const h = threadsHandler({ threads: [A_OPUS_MAX], models: CATALOG });
      const ctx = makePanel({ fetchHandler: h.fetchHandler, storage: seed.storage });
      ctx.storage.setItem('worca-cc.ask.thread', TID_A);
      await openPicker(ctx);
      await settle(ctx);
      ctx.doc.querySelector('[data-ask-effort-row]').click();
      [...ctx.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent === 'xhigh').click();
      assert.deepEqual(pickerShows(ctx), ['Opus 4.8', 'xhigh']);
      assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: 'claude-sonnet-4-6', effort: 'xhigh' },
        'the effort is the user\'s; the model is Alpha\'s, not the browser\'s (D11)');
      await ctx.tick();
      assert.deepEqual(h.patches, [{ id: TID_A, body: { model: 'claude-opus-4-8', effort: 'xhigh' } }]);
    } },
    { name: 'ask-panel-pickers: a pick on a new chat (no thread yet) PATCHes nothing', run: async () => {
      const h = threadsHandler({ threads: [] });
      const ctx = makePanel({ fetchHandler: h.fetchHandler });
      await openPicker(ctx);
      [...ctx.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent.includes('Haiku 4.5')).click();
      await ctx.tick();
      assert.ok(!ctx.fetchCalls.some((c) => c.opts.method === 'PATCH'), 'the first send stores it');
    } },
  ]);
});

test('ask-panel-pickers: the send body carries the picked model, and after a thread switch the thread\'s model', async () => {
  await checkRows([
    { name: 'ask-panel-pickers: the send body carries the picked model', run: async () => {
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
    } },
    { name: 'ask-panel-pickers: the send body after a switch carries the thread\'s model', run: async () => {
      const h = threadsHandler({ threads: [A_OPUS_MAX, B_HAIKU_HIGH] });
      const ctx = makePanel({ fetchHandler: h.fetchHandler });
      ctx.storage.setItem('worca-cc.ask.thread', TID_A);
      ctx.panel.open();
      await settle(ctx);
      await pickThread(ctx, 'Beta');
      ctx.doc.querySelector('textarea.ask-input').value = 'hello beta';
      ctx.doc.querySelector('[data-ask-send]').click();
      await settle(ctx);
      assert.equal(h.sends.length, 1);
      assert.equal(h.sends[0].id, TID_B);
      assert.equal(h.sends[0].body.model, 'claude-haiku-4-5');
      assert.equal(h.sends[0].body.effort, 'high');
    } },
  ]);
});

test('ask-panel-pickers: the context popover\'s Agents section lists agents with model, per-agent ctx and a count + cost header; empty state', async () => {
  await checkRows([
    { name: 'ask-panel-pickers: the context popover lists agents with model and meter; empty state', run: async () => {
      const agent = { kind: 'agent', id: 'toolu_1', label: 'count runs', type: 'general-purpose', model: 'claude-haiku-4-5', tokens: 5321, usage: { input: 10, output: 69, cacheRead: 4564, cacheCreation: 678 }, costUsd: 0.62, estimated: true, status: 'done', durationMs: 2861, log: [] };
      const messages = [{ id: 'askm_00000001', threadId: TID, seq: 1, role: 'assistant', text: 'ok', blocks: [agent], status: 'done', reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' }];
      const ctx = makePanel({ fetchHandler: handler({ messages }) });
      ctx.storage.setItem('worca-cc.ask.thread', TID);
      ctx.panel.open();
      await ctx.tick(); await ctx.tick(); await ctx.tick();
      ctx.doc.querySelector('[data-ask-ctx-btn]').click();
      await ctx.tick();
      const pop = ctx.doc.querySelector('.ask-pop-ctx .ask-ctx-agents');
      assert.ok(pop);
      assert.equal(pop.querySelector('.ask-pop-caption').textContent, 'Agents');
      assert.match(pop.textContent, /count runs/);
      assert.match(pop.textContent, /claude-haiku-4-5/);
      assert.match(pop.textContent, /5\.3k tok/);
      assert.match(pop.textContent, /≈\$0\.62/);
      // empty
      const ctx2 = makePanel({ fetchHandler: handler() });
      ctx2.panel.open();
      await ctx2.tick(); await ctx2.tick();
      ctx2.doc.querySelector('[data-ask-ctx-btn]').click();
      await ctx2.tick();
      assert.match(ctx2.doc.querySelector('.ask-pop-ctx .ask-ctx-agents').textContent, /No agents spawned yet\./);
    } },
    { name: 'ask-panel-pickers: the Agents section shows per-agent ctx and a count + cost header (no token sum)', run: async () => {
      const agent = { kind: 'agent', id: 'toolu_1', label: 'count runs', type: 'general-purpose', model: 'claude-haiku-4-5', tokens: 25321, ctx: 11645, usage: null, costUsd: 0.62, estimated: true, status: 'done', durationMs: 2861, log: [] };
      const messages = [{ id: 'askm_00000001', threadId: TID, seq: 1, role: 'assistant', text: 'ok', blocks: [agent], status: 'done', reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' }];
      const ctx = makePanel({ fetchHandler: handler({ messages }) });
      ctx.storage.setItem('worca-cc.ask.thread', TID);
      ctx.panel.open();
      await ctx.tick(); await ctx.tick(); await ctx.tick();
      ctx.doc.querySelector('[data-ask-ctx-btn]').click();
      await ctx.tick();
      const pop = ctx.doc.querySelector('.ask-pop-ctx .ask-ctx-agents');
      assert.match(pop.textContent, /11\.6k ctx/, 'the row shows the agent context fill');
      assert.equal(pop.querySelector('.ask-pop-caption-meter').textContent, '1 · ≈$0.62', 'header: count and cost — summing ctx across agents means nothing');
    } },
  ]);
});

test('ask-panel-pickers: delete asks first — confirm DELETEs and clears the current thread, decline sends nothing', async () => {
  await checkRows([
    { name: 'ask-panel-pickers: delete asks with the exact copy, DELETEs, clears the current thread', run: async () => {
      const confirms = [];
      const ctx = makePanel({ fetchHandler: handler(), confirm: async (opts) => { confirms.push(opts); return true; } });
      ctx.storage.setItem('worca-cc.ask.thread', TID);
      ctx.panel.open();
      await ctx.tick(); await ctx.tick(); await ctx.tick();
      await deleteFromList(ctx, TID);
      assert.equal(confirms.length, 1);
      assert.deepEqual(confirms[0], { title: 'Delete this chat?', message: '“Stored” and its transcript are removed. This cannot be undone.', confirmLabel: 'Delete', danger: true });
      assert.ok(ctx.fetchCalls.some((c) => c.url === `/api/ask/threads/${TID}` && c.opts.method === 'DELETE'));
      assert.equal(ctx.storage.getItem('worca-cc.ask.thread'), null);
      assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'New chat', 'back to an empty thread');
      assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('textarea.ask-input'), 'focus returns to the textarea');
    } },
    { name: 'ask-panel-pickers: declining the confirm sends no DELETE', run: async () => {
      const ctx = makePanel({ fetchHandler: handler(), confirm: async () => false });
      ctx.panel.open();
      await ctx.tick(); await ctx.tick();
      await deleteFromList(ctx, TID);
      assert.ok(!ctx.fetchCalls.some((c) => c.opts.method === 'DELETE'));
    } },
  ]);
});

test('ask-panel-pickers: New chat clears the thread; the next send creates a fresh row', async () => {
  const ctx = makePanel({ fetchHandler: handler() });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Stored');
  ctx.doc.querySelector('.chat-head [data-ask-new-btn]').click();
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'New chat');
  assert.equal(ctx.storage.getItem('worca-cc.ask.thread'), null);
  ctx.doc.querySelector('textarea.ask-input').value = 'fresh start';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.ok(ctx.fetchCalls.some((c) => c.url === '/api/ask/threads' && c.opts.method === 'POST'), 'thread created on send');
});

// Settings → "Delete all chat history" broadcasts ask-history-cleared (seq-less,
// threadId-less). The panel must not keep a dead st.threadId in memory: any open
// popover closes and the active chat resets exactly like the "+" button.
test('ask-panel-pickers: ask-history-cleared closes the popover and resets the active thread', async () => {
  const ctx = makePanel({ fetchHandler: handler() });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'Stored');
  ctx.doc.querySelector('[data-ask-model-btn]').click();
  await ctx.tick();
  assert.ok(ctx.doc.querySelector('.ask-pop-model'), 'a popover is open');
  const fetchesBefore = ctx.fetchCalls.length;
  ctx.panel.pushServerFrame({ type: 'ask-history-cleared' });
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-pop'), null, 'popover closed');
  assert.equal(ctx.doc.querySelectorAll('[data-chat-history] .runs-item').length, 0, 'the Chats column emptied');
  assert.equal(ctx.storage.getItem('worca-cc.ask.thread'), null, 'stored thread forgotten');
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'New chat');
  assert.equal(ctx.fetchCalls.length, fetchesBefore, 'no fetch — the rows are gone server-side');
  // With no active thread the frame is inert.
  ctx.panel.pushServerFrame({ type: 'ask-history-cleared' });
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'New chat');
  assert.equal(ctx.fetchCalls.length, fetchesBefore);
});

test('ask-panel-pickers (#422): hidden built-ins leave the list (default falls to the first visible) unless they are the stored pick', async () => {
  await checkRows([
    { name: 'ask-panel-pickers (#422): hidden built-ins leave the list; the default falls to the first visible model', run: async () => {
      const hiddenCatalog = {
        models: [
          { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high'], custom: false, hidden: true },
          { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], custom: false, hidden: true },
          { id: 'my-corp-model', label: 'Corp', efforts: ['high'], custom: 'global' },
        ],
        efforts: ['medium', 'high', 'xhigh', 'max'],
        default: { model: 'my-corp-model', effort: 'high' },
      };
      const base = handler();
      const ctx = makePanel({ fetchHandler: (url, opts) => (url === '/api/ask/models' ? { ok: true, status: 200, json: async () => hiddenCatalog } : base(url, opts)) });
      ctx.panel.open();
      await ctx.tick(); await ctx.tick();
      assert.match(ctx.doc.querySelector('[data-ask-model-btn]').textContent, /Corp/, 'initial pick is a model the user owns');
      ctx.doc.querySelector('[data-ask-model-btn]').click();
      await ctx.tick();
      const names = [...ctx.doc.querySelectorAll('.ask-pop-model .ask-model-name')].map((n) => n.textContent);
      assert.deepEqual(names, ['Corp']);
    } },
    { name: 'ask-panel-pickers (#422): a STORED pick on a hidden built-in stays visible and selected (it still resolves)', run: async () => {
      const hiddenCatalog = {
        models: [
          { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high'], custom: false, hidden: true },
          { id: 'my-corp-model', label: 'Corp', efforts: ['high'], custom: 'global' },
        ],
        efforts: ['medium', 'high', 'xhigh', 'max'],
        default: { model: 'my-corp-model', effort: 'high' },
      };
      const base = handler();
      // The stored pick is read when the panel is BUILT — seed storage first.
      const storage = new Map();
      const storageApi = { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
      storageApi.setItem('worca-cc.ask.model', JSON.stringify({ model: 'claude-opus-5-5', effort: 'high' }));
      const ctx = makePanel({ storage: storageApi, fetchHandler: (url, opts) => (url === '/api/ask/models' ? { ok: true, status: 200, json: async () => hiddenCatalog } : base(url, opts)) });
      ctx.panel.open();
      await ctx.tick(); await ctx.tick();
      assert.match(ctx.doc.querySelector('[data-ask-model-btn]').textContent, /Opus 5.5/);
      ctx.doc.querySelector('[data-ask-model-btn]').click();
      await ctx.tick();
      const names = [...ctx.doc.querySelectorAll('.ask-pop-model .ask-model-name')].map((n) => n.textContent);
      assert.deepEqual(names, ['Opus 5.5', 'Corp']);
    } },
  ]);
});

// ---- the picker follows the conversation -------------------------------------
// Each thread row carries the model/effort of its last send (or of a pick made
// while it was open). A SWITCH shows that pick; a row without one, and a new
// chat, get the browser-level pick (worca-cc.ask.model + the catalog default).
// Nothing a switch shows is ever written to worca-cc.ask.model.
const TID_A = 'ask_0000000a';
const TID_B = 'ask_0000000b';
const TID_C = 'ask_0000000c';

function threadRow(id, title, model, effort) {
  return { id, title, createdAt: 't', updatedAt: 't', model, effort, sessionId: null, context: null, totals: {} };
}

/**
 * Serves threads A/B/C from a mutable table (a PATCH updates it the way the
 * server's row does) and records every PATCH / send body. `models` may be a
 * promise, to hold the catalog back.
 */
function threadsHandler({ threads, models = CATALOG_WIDE } = {}) {
  const rows = new Map(threads.map((t) => [t.id, { ...t }]));
  const patches = [];
  const sends = [];
  const fetchHandler = (url, opts) => {
    if (url === '/api/ask/models') return Promise.resolve(models).then((c) => ({ ok: true, status: 200, json: async () => c }));
    const m = url.match(/^\/api\/ask\/threads\/([^/?]+)(\/messages)?$/);
    if (m && m[2] && opts.method === 'POST') {
      sends.push({ id: m[1], body: JSON.parse(opts.body) });
      return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: 'askm_00000001' }) };
    }
    if (m && opts.method === 'PATCH') {
      const body = JSON.parse(opts.body);
      patches.push({ id: m[1], body });
      Object.assign(rows.get(m[1]), body);
      return { ok: true, status: 200, json: async () => ({ thread: rows.get(m[1]) }) };
    }
    if (m && rows.has(m[1]) && !opts.method) {
      return { ok: true, status: 200, json: async () => ({ thread: { ...rows.get(m[1]) }, messages: [], attachments: [], runLinks: [], inFlight: null }) };
    }
    if (url.startsWith('/api/ask/threads') && !opts.method) {
      const list = [...rows.values()].map((t) => ({ ...t, runLinks: 0, inFlight: false }));
      return { ok: true, status: 200, json: async () => ({ threads: list, total: list.length }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { fetchHandler, patches, sends, rows };
}

async function settle(ctx) { for (let i = 0; i < 4; i++) await ctx.tick(); }

/** Switch to the chat titled `title` (Alpha, Beta, Gamma), as app.js routes to it. */
async function pickThread(ctx, title) {
  await openChat(ctx, { Alpha: TID_A, Beta: TID_B, Gamma: TID_C }[title]);
  await settle(ctx);
}

function pickerShows(ctx) {
  return [ctx.doc.querySelector('.ask-model-btn-label').textContent, ctx.doc.querySelector('.ask-model-btn-effort').textContent];
}

const A_OPUS_MAX = threadRow(TID_A, 'Alpha', 'claude-opus-4-8', 'max');
const B_HAIKU_HIGH = threadRow(TID_B, 'Beta', 'claude-haiku-4-5', 'high');
const C_NO_MODEL = threadRow(TID_C, 'Gamma', null, null);

test('ask-panel-pickers: thread switch shows each thread\'s stored model; a model-less thread gets the browser pick, then the backend default; New chat returns to the browser pick', async () => {
  await checkRows([
    { name: 'ask-panel-pickers: switching threads shows each thread\'s last model and effort', run: async () => {
      const h = threadsHandler({ threads: [A_OPUS_MAX, B_HAIKU_HIGH] });
      const ctx = makePanel({ fetchHandler: h.fetchHandler });
      ctx.storage.setItem('worca-cc.ask.thread', TID_A);
      ctx.panel.open();
      await settle(ctx);
      assert.deepEqual(pickerShows(ctx), ['Opus 4.8', 'max'], 'the restored thread brings its own pick');
      await pickThread(ctx, 'Beta');
      assert.deepEqual(pickerShows(ctx), ['Haiku 4.5', 'high'], 'the picker follows the switch');
      await pickThread(ctx, 'Alpha');
      assert.deepEqual(pickerShows(ctx), ['Opus 4.8', 'max'], 'switching back restores the first thread\'s pick');
      assert.equal(ctx.storage.getItem('worca-cc.ask.model'), null, 'a switch never writes the browser-level pick');
      assert.deepEqual(h.patches, [], 'a switch PATCHes nothing');
    } },
    { name: 'ask-panel-pickers: a thread with no stored model gets the browser-level pick, not the previous thread\'s', run: async () => {
      const seed = makePanel({ fetchHandler: handler() });   // never opened: builds a storage
      seed.storage.setItem('worca-cc.ask.model', JSON.stringify({ model: 'claude-haiku-4-5', effort: 'medium' }));
      const h = threadsHandler({ threads: [A_OPUS_MAX, C_NO_MODEL] });
      const ctx = makePanel({ fetchHandler: h.fetchHandler, storage: seed.storage });
      ctx.storage.setItem('worca-cc.ask.thread', TID_A);
      ctx.panel.open();
      await settle(ctx);
      assert.deepEqual(pickerShows(ctx), ['Opus 4.8', 'max']);
      await pickThread(ctx, 'Gamma');
      assert.deepEqual(pickerShows(ctx), ['Haiku 4.5', 'medium'], 'the browser-level pick, not Alpha\'s');
      assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: 'claude-haiku-4-5', effort: 'medium' }, 'untouched');
    } },
    { name: 'ask-panel-pickers: with nothing stored, a model-less thread falls to the backend default', run: async () => {
      const h = threadsHandler({ threads: [A_OPUS_MAX, C_NO_MODEL] });
      const ctx = makePanel({ fetchHandler: h.fetchHandler });
      ctx.storage.setItem('worca-cc.ask.thread', TID_A);
      ctx.panel.open();
      await settle(ctx);
      await pickThread(ctx, 'Gamma');
      assert.deepEqual(pickerShows(ctx), ['Opus 5.5', 'high'], 'CATALOG_WIDE.default');
      assert.equal(ctx.storage.getItem('worca-cc.ask.model'), null, 'the default is still not persisted (D11)');
    } },
    { name: 'ask-panel-pickers: New chat goes back to the browser-level pick', run: async () => {
      const seed = makePanel({ fetchHandler: handler() });
      seed.storage.setItem('worca-cc.ask.model', JSON.stringify({ model: 'claude-haiku-4-5', effort: 'medium' }));
      const h = threadsHandler({ threads: [A_OPUS_MAX] });
      const ctx = makePanel({ fetchHandler: h.fetchHandler, storage: seed.storage });
      ctx.storage.setItem('worca-cc.ask.thread', TID_A);
      ctx.panel.open();
      await settle(ctx);
      assert.deepEqual(pickerShows(ctx), ['Opus 4.8', 'max']);
      ctx.doc.querySelector('.chat-head [data-ask-new-btn]').click();
      assert.deepEqual(pickerShows(ctx), ['Haiku 4.5', 'medium']);
      assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: 'claude-haiku-4-5', effort: 'medium' });
    } },
  ]);
});

test('ask-panel-pickers: a same-thread resync does not revert a fresh pick', async () => {
  // The row still says opus/max: the PATCH is best-effort, and a resync can
  // outrun it. Reloading the SAME thread must not re-apply the row's pick.
  const h = threadsHandler({ threads: [A_OPUS_MAX] });
  const fetchHandler = (url, opts) => (opts.method === 'PATCH' ? { ok: false, status: 500, json: async () => ({}) } : h.fetchHandler(url, opts));
  const ctx = makePanel({ fetchHandler });
  ctx.storage.setItem('worca-cc.ask.thread', TID_A);
  await openPicker(ctx);
  await settle(ctx);
  assert.deepEqual(pickerShows(ctx), ['Opus 4.8', 'max']);
  [...ctx.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent.includes('Haiku 4.5')).click();
  assert.deepEqual(pickerShows(ctx), ['Haiku 4.5', 'high']);
  const gets = () => ctx.fetchCalls.filter((c) => c.url === `/api/ask/threads/${TID_A}` && !c.opts.method).length;
  const before = gets();
  ctx.panel.onHello([]);                  // a reconnect: resync → loadThread(same id)
  await settle(ctx);
  assert.equal(gets(), before + 1, 'the thread really was reloaded');
  assert.deepEqual(pickerShows(ctx), ['Haiku 4.5', 'high'], 'the fresh pick stands');
});
