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

// ---- an explicit model pick survives the selector's own catalog refresh ----
const CATALOG_X = {
  ...CATALOG,
  models: [...CATALOG.models, { id: 'gpt-5.4', label: 'GPT-5.4', efforts: ['low', 'medium', 'high'], custom: false, engine: 'codex' }],
};
const CODEX_DEFAULT = { askEngine: 'codex', default: CATALOG.defaults.codex };
// Every GET /api/ask/models answers a NEW object (a real fetch does): identity must never be what keeps a pick alive.
function freshHandler({ catalog = CATALOG_X, gate = null, sent = null, ...rest } = {}) {
  const base = handler({ catalog, ...rest });   // rest: thread, messages (the chat's history)
  return (url, opts) => {
    if (url === '/api/ask/models') return gate ? gate().then(() => ({ ok: true, status: 200, json: async () => structuredClone(catalog) })) : { ok: true, status: 200, json: async () => structuredClone(catalog) };
    if (url === '/api/ask/threads' && opts.method === 'POST') return { ok: true, status: 201, json: async () => ({ thread: { id: TID, title: null, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} } }) };
    if (url === `/api/ask/threads/${TID}/messages` && opts.method === 'POST') { sent.push(JSON.parse(opts.body)); return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: 'askm_00000001' }) }; }
    return base(url, opts);
  };
}
const modelBtn = (ctx) => ctx.doc.querySelector('[data-ask-model-btn]');
const effortBtn = (ctx) => ctx.doc.querySelector('.ask-model-btn-effort').textContent;
const checked = (ctx) => [...ctx.doc.querySelectorAll('.ask-pop-model .ask-model-item')].filter((i) => i.querySelector('.ask-model-check')).map((i) => i.querySelector('.ask-model-name').textContent);
const pickItem = (ctx, label) => {
  const find = () => [...ctx.doc.querySelectorAll('.ask-pop-model .ask-model-item')].find((i) => i.querySelector('.ask-model-name').textContent === label);
  if (!find()) ctx.doc.querySelector('[data-ask-more-models]').click();   // a second model of a family sits under "More models"
  find().click();
};
const pickEffort = (ctx, label) => {
  ctx.doc.querySelector('[data-ask-effort-row]').click();
  [...ctx.doc.querySelectorAll('.ask-pop-model .ask-effort-item')].find((b) => b.textContent.startsWith(label)).click();
};
async function openPanel(ctx) { ctx.panel.open(); await ctx.tick(); await ctx.tick(); }
async function openSelector(ctx) { modelBtn(ctx).click(); await ctx.tick(); await ctx.tick(); }

for (const [name, askCfg, from, to, toLabel, effort] of [
  ['Claude default, explicit Codex pick', {}, 'Opus 5.5', 'GPT-5.5', 'GPT-5.5', 'low'],
  ['Codex default, explicit Claude pick', CODEX_DEFAULT, 'GPT-5.5', 'Opus 5.5', 'Opus 5.5', 'max'],
]) {
  test(`explicit model pick survives reopening the selector to change effort: ${name}`, async () => {
    const ctx = makePanel({ fetchHandler: freshHandler({ catalog: { ...CATALOG_X, ...askCfg } }) });
    await openPanel(ctx);
    assert.match(modelBtn(ctx).textContent, new RegExp(from.replace('.', '\\.')));
    await openSelector(ctx);
    pickItem(ctx, to);
    assert.match(modelBtn(ctx).textContent, new RegExp(toLabel.replace('.', '\\.')));
    await openSelector(ctx);                                  // refetches the catalog and applies it
    assert.match(modelBtn(ctx).textContent, new RegExp(toLabel.replace('.', '\\.')), 'the label did not reset');
    assert.deepEqual(checked(ctx), [toLabel], 'the ✓ stays on the explicit pick');
    pickEffort(ctx, effort);
    assert.match(modelBtn(ctx).textContent, new RegExp(toLabel.replace('.', '\\.')), 'changing effort changed only effort');
    assert.equal(effortBtn(ctx), effort);
    await openSelector(ctx);                                  // …and once more (screenshot sequence)
    assert.deepEqual(checked(ctx), [toLabel]);
    assert.equal(effortBtn(ctx), effort);
  });
}

test('a catalog response pending while an explicit pick is made does not undo it', async () => {
  let release;
  let gated = false;
  const ctx = makePanel({ fetchHandler: freshHandler({ gate: () => (gated ? new Promise((r) => { release = r; }) : Promise.resolve()) }) });
  await openPanel(ctx);
  gated = true;
  await openSelector(ctx);                                    // the refetch is now in flight; the old catalog paints the menu
  pickItem(ctx, 'GPT-5.5');
  release();
  await ctx.tick(); await ctx.tick();
  assert.match(modelBtn(ctx).textContent, /GPT-5\.5/);
});

test('a refresh that lands while the effort pane is open keeps its options and ✓ on the active model', async () => {
  let release;
  let gated = false;
  const ctx = makePanel({ fetchHandler: freshHandler({ gate: () => (gated ? new Promise((r) => { release = r; }) : Promise.resolve()) }) });
  await openPanel(ctx);
  await openSelector(ctx);
  pickItem(ctx, 'GPT-5.5');
  gated = true;
  modelBtn(ctx).click(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-effort-row]').click();     // effort pane, refresh still pending
  release();
  await ctx.tick(); await ctx.tick();
  const items = [...ctx.doc.querySelectorAll('.ask-pop-model .ask-effort-item')];
  assert.deepEqual(items.map((i) => i.querySelector('.ask-model-name').textContent), ['minimal', 'low', 'medium', 'high'], 'Codex efforts');
  assert.deepEqual(items.filter((i) => i.querySelector('.ask-model-check')).map((i) => i.querySelector('.ask-model-name').textContent), ['high']);   // the Claude effort 'high' carried over; Codex lists it
  assert.match(modelBtn(ctx).textContent, /GPT-5\.5/);
});

test('the next message submits the explicit model and effort', async () => {
  const sent = [];
  const ctx = makePanel({ fetchHandler: freshHandler({ sent }) });
  await openPanel(ctx);
  await openSelector(ctx);
  pickItem(ctx, 'GPT-5.5');
  await openSelector(ctx);
  pickEffort(ctx, 'low');
  ctx.doc.querySelector('textarea.ask-input').value = 'hello';
  ctx.doc.querySelector('[data-ask-send]').click();
  for (let i = 0; i < 4; i++) await ctx.tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].model, 'gpt-5.5');
  assert.equal(sent[0].effort, 'low');
});

test('an explicit pick does not leak into a new chat: the configured default engine applies again', async () => {
  const ctx = makePanel({ fetchHandler: freshHandler() });
  await openPanel(ctx);
  await openSelector(ctx);
  pickItem(ctx, 'GPT-5.5');
  ctx.doc.querySelector('[data-ask-new-btn]').click();        // restoreBrowserPick(): the stored Codex pick is another engine's
  await ctx.tick(); await ctx.tick();
  assert.match(modelBtn(ctx).textContent, /Opus 5\.5/);
  await openSelector(ctx);
  assert.deepEqual(checked(ctx), ['Opus 5.5']);
});

test('inside a Codex chat (Claude default) a model picked from the chat\'s own list survives the refresh', async () => {
  const ctx = makePanel({ fetchHandler: freshHandler({ thread: { model: 'gpt-5.5', effort: 'low' }, messages: [
    { id: 'askm_u0000001', seq: 1, role: 'user', text: 'hi', blocks: [] },
    { id: 'askm_00000001', seq: 2, role: 'assistant', text: 'yo', blocks: [], status: 'done', model: 'gpt-5.5', effort: 'low' }] }) });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open(); await ctx.tick(); await ctx.tick(); await ctx.tick();
  await openSelector(ctx);
  pickItem(ctx, 'GPT-5.4');
  await openSelector(ctx);
  assert.match(modelBtn(ctx).textContent, /GPT-5\.4/);
  assert.deepEqual(checked(ctx), ['GPT-5.4']);
});

test('an explicit pick the refreshed catalog no longer has falls back to the default', async () => {
  let catalog = CATALOG_X;
  const ctx = makePanel({ fetchHandler: (url, opts) => freshHandler({ catalog })(url, opts) });
  await openPanel(ctx);
  await openSelector(ctx);
  pickItem(ctx, 'GPT-5.4');
  catalog = CATALOG;                                          // GPT-5.4 removed
  await openSelector(ctx);
  assert.match(modelBtn(ctx).textContent, /Opus 5\.5/);
});

test('a refresh that drops the active model while the effort pane is open repaints it for the fallback model', async () => {
  let catalog = CATALOG_X;
  let release;
  let gated = false;
  const ctx = makePanel({ fetchHandler: (url, opts) => freshHandler({ catalog, gate: () => (gated ? new Promise((r) => { release = r; }) : Promise.resolve()) })(url, opts) });
  await openPanel(ctx);
  await openSelector(ctx);
  pickItem(ctx, 'GPT-5.5');
  gated = true;
  catalog = { ...CATALOG, models: CATALOG.models.filter((m) => m.id !== 'gpt-5.5') };   // GPT-5.5 removed; the refetch below returns this
  modelBtn(ctx).click(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-effort-row]').click();
  release();
  await ctx.tick(); await ctx.tick();
  assert.match(modelBtn(ctx).textContent, /Opus 5\.5/);
  const names = [...ctx.doc.querySelectorAll('.ask-pop-model .ask-effort-item .ask-model-name')].map((n) => n.textContent);
  assert.deepEqual(names, ['medium', 'high', 'xhigh', 'max'], 'Opus efforts, not the dropped model\'s');
});

for (const [name, thread, label] of [
  ['a chat without a pick of its own shows the configured default', {}, /Opus 5\.5/],
  ['a chat with its own pick shows that pick', { model: 'gpt-5.4', effort: 'high' }, /GPT-5\.4/],
]) {
  test(`an explicit pick does not follow the user into another chat: ${name}`, async () => {
    const ctx = makePanel({ fetchHandler: freshHandler({ thread }) });
    await openPanel(ctx);
    await openSelector(ctx);
    pickItem(ctx, 'GPT-5.5');
    assert.match(modelBtn(ctx).textContent, /GPT-5\.5/);
    ctx.panel.open({ threadId: TID });                          // switch to another chat
    for (let i = 0; i < 4; i++) await ctx.tick();
    assert.match(modelBtn(ctx).textContent, label);
    await openSelector(ctx);                                    // the refresh must not bring GPT-5.5 back
    assert.match(modelBtn(ctx).textContent, label);
  });
}

// ---- "More models": each engine's extra models under its name; Copilot families up front ----
const CATALOG_MORE = {
  ...CATALOG,
  models: [
    { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
    { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
    { id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['minimal', 'low', 'medium', 'high'], custom: false, engine: 'codex' },
    ...[['claude-sonnet-5.5', 'Claude Sonnet 5.5'], ['claude-sonnet-5', 'Claude Sonnet 5'], ['gpt-6.1-sol', 'GPT-6.1 Sol'], ['gpt-5.4-mini', 'GPT-5.4 Mini'], ['gemini-4-argon', 'Gemini 4 Argon']]
      .map(([id, label]) => ({ id: `copilot/${id}`, label, efforts: ['low', 'medium', 'high'], custom: false, engine: 'copilot', builtin: true })),
  ],
  defaults: { ...CATALOG.defaults, copilot: { model: 'copilot/claude-sonnet-5.5', effort: 'medium' } },
};

test('the main list holds the newest of each Copilot family; More models names each engine it lists', async () => {
  const ctx = makePanel({ fetchHandler: handler({ catalog: CATALOG_MORE }) });
  ctx.panel.open(); await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-model-btn]').click(); await ctx.tick();
  assert.deepEqual(groups(ctx), ['Claude', 'Codex (beta)', 'Copilot (beta)']);
  assert.deepEqual(names(ctx), ['Opus 5.5', 'GPT-5.5', 'Claude Sonnet 5.5', 'GPT-6.1 Sol', 'Gemini 4 Argon']);
  ctx.doc.querySelector('[data-ask-more-models]').click(); await ctx.tick();
  assert.deepEqual(groups(ctx), ['Claude', 'Copilot (beta)'], 'Codex has no more models: no heading for it');
  assert.deepEqual(names(ctx), ['Opus 5', 'Claude Sonnet 5', 'GPT-5.4 Mini']);
});
