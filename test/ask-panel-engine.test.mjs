// test/ask-panel-engine.test.mjs — new-chat picker grouped by engine; in a chat only its engine (D12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel } from './helpers/ask-panel-harness.mjs';

const TID = 'ask_00000001';
const CATALOG = {
  models: [
    { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
    { id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['minimal', 'low', 'medium', 'high'], custom: false, engine: 'codex' },
  ],
  efforts: ['medium', 'high', 'xhigh', 'max'],
  default: { model: 'claude-opus-5-5', effort: 'high' },
  defaults: { claude: { model: 'claude-opus-5-5', effort: 'high' }, codex: { model: 'gpt-5.5', effort: 'medium' } },
  askEngine: 'claude',
};
function handler({ thread = null, messages = [], catalog = CATALOG } = {}) {
  return (url, opts) => {
    if (url === '/api/ask/models') return { ok: true, status: 200, json: async () => catalog };
    if (url.startsWith(`/api/ask/threads/${TID}`) && (!opts.method || opts.method === 'GET')) {
      return { ok: true, status: 200, json: async () => ({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, ...(thread || {}) }, messages, attachments: [], runLinks: [], inFlight: null }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}
const names = (ctx) => [...ctx.doc.querySelectorAll('.ask-pop-model .ask-model-name')].map((n) => n.textContent);
const groups = (ctx) => [...ctx.doc.querySelectorAll('.ask-pop-model .ask-pop-group')].map((n) => n.textContent);

test('a new chat lists both engines under their names', async () => {
  const ctx = makePanel({ fetchHandler: handler() });
  ctx.panel.open(); await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-model-btn]').click(); await ctx.tick();
  assert.deepEqual(groups(ctx), ['Claude', 'Codex (beta)']);
  assert.deepEqual(names(ctx), ['Opus 5.5', 'GPT-5.5']);
});

test('inside a Codex chat the picker lists only Codex models', async () => {
  const ctx = makePanel({ fetchHandler: handler({ thread: { model: 'gpt-5.5', effort: 'low' }, messages: [
    { id: 'askm_u0000001', seq: 1, role: 'user', text: 'hi', blocks: [] },
    { id: 'askm_00000001', seq: 2, role: 'assistant', text: 'yo', blocks: [], status: 'done', model: 'gpt-5.5', effort: 'low' }] }) });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open(); await ctx.tick(); await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-model-btn]').click(); await ctx.tick();
  assert.deepEqual(groups(ctx), []);
  assert.deepEqual(names(ctx), ['GPT-5.5']);
});

test('askEngine codex: a new chat starts on the Codex default; a stored Claude pick does not override it', async () => {
  const ctx = makePanel({ fetchHandler: handler({ catalog: { ...CATALOG, askEngine: 'codex', default: CATALOG.defaults.codex } }) });
  ctx.storage.setItem('worca-cc.ask.model', JSON.stringify({ model: 'claude-opus-5-5', effort: 'high' }));
  ctx.panel.open(); await ctx.tick(); await ctx.tick();
  assert.match(ctx.doc.querySelector('[data-ask-model-btn]').textContent, /GPT-5\.5/);
});

test('askEngine codex: a stored Claude pick lends the new chat neither its effort nor gets overwritten by an effort pick', async () => {
  // The browser-level pick is read when the panel is built, so the record exists first.
  const { storage } = makePanel({ fetchHandler: handler() });
  storage.setItem('worca-cc.ask.model', JSON.stringify({ model: 'claude-opus-5-5', effort: 'max' }));
  const ctx = makePanel({ storage, fetchHandler: handler({ catalog: { ...CATALOG, askEngine: 'codex', default: CATALOG.defaults.codex } }) });
  ctx.panel.open(); await ctx.tick(); await ctx.tick();
  assert.match(ctx.doc.querySelector('[data-ask-model-btn]').textContent, /GPT-5\.5/);
  assert.equal(ctx.doc.querySelector('.ask-model-btn-effort').textContent, 'medium', 'the Codex Ask slot\'s effort, not the Claude pick\'s');
  ctx.doc.querySelector('[data-ask-model-btn]').click(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-effort-row]').click();
  [...ctx.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent === 'high').click();
  assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.model')), { model: 'claude-opus-5-5', effort: 'max' }, 'the Claude pick is kept whole');
});
