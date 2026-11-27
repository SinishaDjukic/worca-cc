// test/ask-panel-engine.test.mjs — the model picker by engine: the shown engine's models, a row per other engine (D12, #943).
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
const engineRows = (ctx) => [...ctx.doc.querySelectorAll('.ask-pop-model [data-ask-engine-group]')].map((n) => n.textContent.replace(/›$/, ''));
const openEngine = async (ctx, engine) => { ctx.doc.querySelector(`.ask-pop-model [data-ask-engine-group="${engine}"]`).click(); await ctx.tick(); };

test('a new chat lists its engine\'s models; every other engine is one row that opens its own list', async () => {
  const ctx = makePanel({ fetchHandler: handler() });
  ctx.panel.open(); await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-model-btn]').click(); await ctx.tick();
  assert.deepEqual(groups(ctx), ['Claude Code']);
  assert.deepEqual(names(ctx), ['Opus 5.5']);
  assert.deepEqual(engineRows(ctx), ['OpenAI Codex (beta)']);
  await openEngine(ctx, 'codex');
  assert.equal(ctx.doc.querySelector('.ask-pop-model [data-ask-pane-back]').textContent, '‹ OpenAI Codex (beta)');
  assert.deepEqual(names(ctx), ['GPT-5.5']);
  ctx.doc.querySelector('.ask-pop-model [data-ask-pane-back]').click(); await ctx.tick();
  assert.deepEqual(names(ctx), ['Opus 5.5'], 'back returns to the main list');
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
// The open selector's row for `label`, opening the pane that lists it: a second model of a family sits under
// "More models", another engine's models under that engine's row.
const reveal = (ctx, label) => {
  const find = () => [...ctx.doc.querySelectorAll('.ask-pop-model .ask-model-item')].find((i) => i.querySelector('.ask-model-name').textContent === label);
  const toMain = () => { const back = ctx.doc.querySelector('.ask-pop-model [data-ask-pane-back]'); if (back) back.click(); };
  if (find()) return find();
  toMain();
  if (find()) return find();
  const panes = [...ctx.doc.querySelectorAll('.ask-pop-model [data-ask-more-models], .ask-pop-model [data-ask-engine-group]')]
    .map((b) => (b.hasAttribute('data-ask-more-models') ? '[data-ask-more-models]' : `[data-ask-engine-group="${b.dataset.askEngineGroup}"]`));
  for (const sel of panes) {
    toMain();
    ctx.doc.querySelector(`.ask-pop-model ${sel}`).click();
    if (find()) return find();
    const more = ctx.doc.querySelector('.ask-pop-model [data-ask-more-models]');   // an engine's own "More models"
    if (more) { more.click(); if (find()) return find(); }
  }
  return undefined;
};
const pickItem = (ctx, label) => reveal(ctx, label).click();
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

test('each engine\'s list holds the newest of each family; its More models the rest', async () => {
  const ctx = makePanel({ fetchHandler: handler({ catalog: CATALOG_MORE }) });
  ctx.panel.open(); await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-model-btn]').click(); await ctx.tick();
  assert.deepEqual(groups(ctx), ['Claude Code']);
  assert.deepEqual(names(ctx), ['Opus 5.5']);
  assert.deepEqual(engineRows(ctx), ['OpenAI Codex (beta)', 'GitHub Copilot CLI (beta)']);
  ctx.doc.querySelector('[data-ask-more-models]').click(); await ctx.tick();
  assert.deepEqual(names(ctx), ['Opus 5'], 'only the shown engine\'s more models');
  ctx.doc.querySelector('.ask-pop-model [data-ask-pane-back]').click(); await ctx.tick();
  await openEngine(ctx, 'copilot');
  assert.deepEqual(names(ctx), ['Claude Sonnet 5.5', 'GPT-6.1 Sol', 'Gemini 4 Argon'], 'the newest of each family');
  ctx.doc.querySelector('.ask-pop-model [data-ask-more-models]').click(); await ctx.tick();
  assert.deepEqual(names(ctx), ['Claude Sonnet 5', 'GPT-5.4 Mini']);
  assert.equal(ctx.doc.querySelector('.ask-pop-model [data-ask-pane-back]').textContent, '‹ GitHub Copilot CLI (beta)');
  ctx.doc.querySelector('.ask-pop-model [data-ask-pane-back]').click(); await ctx.tick();
  assert.deepEqual(names(ctx), ['Claude Sonnet 5.5', 'GPT-6.1 Sol', 'Gemini 4 Argon'], 'back to Copilot\'s list, not the main one');
});

// ---- #943: a chat moves to another engine in place ----
const CODEX_CHAT = { thread: { model: 'gpt-5.5', effort: 'low', engine: 'codex' }, messages: [
  { id: 'askm_u0000001', seq: 1, role: 'user', text: 'hi', blocks: [] },
  { id: 'askm_00000001', seq: 2, role: 'assistant', text: 'yo', blocks: [], status: 'done', model: 'gpt-5.5', effort: 'low', engine: 'codex' }] };
const PLAN = { from: 'codex', to: 'claude', model: 'claude-opus-5-5', effort: 'high',
  changes: [{ key: 'tools', text: 'Claude reads with its own Read, Grep and Glob tools and may start sub-agents.' }],
  mcpLost: [], attachments: [], transcript: { totalTurns: 1, droppedTurns: 0 } };
function switchHandler({ posts, refuse = null, inFlight = null } = {}) {
  const base = handler(CODEX_CHAT);
  return (url, opts) => {
    if (url === `/api/ask/threads/${TID}/engine` && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      posts.push(body);
      if (body.dryRun) return { ok: true, status: 200, json: async () => PLAN };
      if (refuse) return { ok: false, status: 409, json: async () => refuse };
      return { ok: true, status: 200, json: async () => ({ ok: true,
        thread: { id: TID, model: 'claude-opus-5-5', effort: 'high', engine: 'claude', sessionId: null, totals: { costUsd: 0, turns: 1 } },
        message: { id: 'askm_s0000001', threadId: TID, seq: 3, role: 'system', text: 'Switched from Codex to Claude', blocks: [
          { kind: 'divider', text: 'Switched from Codex to Claude', engineSwitch: { from: 'codex', to: 'claude' } }] },
        engineSwitch: { engine: 'claude', model: 'claude-opus-5-5', effort: 'high' } }) };
    }
    if (inFlight && url === `/api/ask/threads/${TID}` && (!opts.method || opts.method === 'GET')) {
      return { ok: true, status: 200, json: async () => ({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', sessionId: null, context: null, totals: {}, ...CODEX_CHAT.thread },
        messages: CODEX_CHAT.messages, attachments: [], runLinks: [], inFlight }) };
    }
    return base(url, opts);
  };
}
async function openCodexChat(over) {
  const ctx = makePanel(over);
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open(); await ctx.tick(); await ctx.tick(); await ctx.tick();
  return ctx;
}
const row = reveal;
const settle = async (ctx) => { for (let i = 0; i < 8; i++) await ctx.tick(); ctx.flush(); };

test('inside a Codex chat the picker lists every engine and marks the chat\'s own', async () => {
  const ctx = await openCodexChat({ fetchHandler: handler(CODEX_CHAT) });
  assert.equal(modelBtn(ctx).dataset.engine, 'codex');
  modelBtn(ctx).click(); await ctx.tick();
  assert.deepEqual(groups(ctx), ['OpenAI Codex (beta) · this chat']);
  assert.deepEqual(names(ctx), ['GPT-5.5']);
  assert.deepEqual(engineRows(ctx), ['Claude Code']);
  await openEngine(ctx, 'claude');
  assert.deepEqual(names(ctx), ['Opus 5.5']);
});

// The catalog's `notReady`: Codex's CLI is not installed on this machine (src/core/ask/models.mjs).
const NO_CODEX = 'OpenAI Codex is not installed: codex was not found. Install it, or set WORCA_CODEX_BIN to its path.';
const CATALOG_NO_CODEX = { ...CATALOG, notReady: { codex: NO_CODEX } };

test('Codex not installed: a new chat\'s picker has no Codex row, and a stored Codex pick gives way to the default', async () => {
  const { storage } = makePanel({ fetchHandler: handler() });
  storage.setItem('worca-cc.ask.model', JSON.stringify({ model: 'gpt-5.5', effort: 'low' }));
  const ctx = makePanel({ storage, fetchHandler: handler({ catalog: CATALOG_NO_CODEX }) });
  ctx.panel.open(); await ctx.tick(); await ctx.tick();
  assert.match(modelBtn(ctx).textContent, /Opus 5\.5/);
  assert.equal(modelBtn(ctx).dataset.engine, 'claude');
  modelBtn(ctx).click(); await ctx.tick();
  assert.deepEqual(groups(ctx), [], 'one engine offered: no engine headings');
  assert.deepEqual(names(ctx), ['Opus 5.5']);
  assert.deepEqual(engineRows(ctx), []);
});

test('Codex not installed: a chat already on Codex keeps its model, tagged with the reason, and can still move to Claude', async () => {
  const ctx = await openCodexChat({ fetchHandler: handler({ ...CODEX_CHAT, catalog: CATALOG_NO_CODEX }) });
  const btn = modelBtn(ctx);
  assert.equal(btn.dataset.engine, 'codex');
  assert.match(btn.textContent, /GPT-5\.5 ⚠/);
  assert.ok(btn.getAttribute('aria-label').endsWith(` · ${NO_CODEX}`), 'the button names the reason');
  btn.click(); await ctx.tick();
  assert.deepEqual(groups(ctx), ['OpenAI Codex (beta) · this chat']);
  assert.deepEqual(names(ctx), ['GPT-5.5']);
  const tag = ctx.doc.querySelector('.ask-pop-model .ask-model-item .ask-model-tag.is-warn');
  assert.deepEqual([tag.textContent, tag.title], ['not installed', NO_CODEX]);
  assert.deepEqual(engineRows(ctx), ['Claude Code']);
});

const harnessRows = (ctx) => [...ctx.doc.querySelectorAll('.ask-pop-model [data-ask-harness]:not([data-ask-harness-missing])')].map((n) => n.textContent.replace(/›$/, ''));
const missingRows = (ctx) => [...ctx.doc.querySelectorAll('.ask-pop-model [data-ask-harness-missing]')].map((n) => n.textContent);
// Claude Code missing is any engine missing: left out of a new chat, listed among the harnesses to set up, kept for a
// chat already on it. Its setup row opens Connect Claude Code (with that host), else its setup docs.
const NO_CLAUDE = 'Claude Code is not installed: claude was not found. Install it, or set WORCA_CLAUDE_BIN to its path.';
const CLAUDE_DOCS = 'https://github.com/worca-org/worca/blob/dev/docs/models.md#claude-code';
const CATALOG_NO_CLAUDE = { ...CATALOG, askEngine: 'codex', default: CATALOG.defaults.codex, notReady: { claude: NO_CLAUDE }, setupDocs: { claude: CLAUDE_DOCS } };
const CLAUDE_CHAT = { thread: { model: 'claude-opus-5-5', effort: 'high', engine: 'claude' }, messages: [
  { id: 'askm_u0000001', seq: 1, role: 'user', text: 'hi', blocks: [] },
  { id: 'askm_00000001', seq: 2, role: 'assistant', text: 'yo', blocks: [], status: 'done', model: 'claude-opus-5-5', effort: 'high', engine: 'claude' }] };
const ALL_ENGINES = ['claude', 'codex', 'copilot', 'gemini', 'goose', 'opencode', 'qwen'];

test('Claude Code not installed: a new chat starts on an installed engine; Claude sits under More harnesses and opens Connect Claude Code', async () => {
  const { storage } = makePanel({ fetchHandler: handler() });
  storage.setItem('worca-cc.ask.model', JSON.stringify({ model: 'claude-opus-5-5', effort: 'high' }));
  let setups = 0;
  const ctx = makePanel({ storage, fetchHandler: handler({ catalog: CATALOG_NO_CLAUDE }), deps: { openClaudeSetup: () => { setups += 1; } } });
  const opened = [];
  ctx.window.open = (...a) => { opened.push(a); return null; };
  ctx.panel.open(); await ctx.tick(); await ctx.tick();
  const btn = modelBtn(ctx);
  assert.equal(btn.dataset.engine, 'codex', 'a stored Claude pick gives way to the installed engine');
  assert.match(btn.textContent, /GPT-5\.5/);
  assert.doesNotMatch(btn.textContent, /⚠/);
  btn.click(); await ctx.tick();
  assert.deepEqual(names(ctx), ['GPT-5.5']);
  assert.deepEqual(engineRows(ctx), [], 'no Claude row among the engines');
  ctx.doc.querySelector('.ask-pop-model [data-ask-more-harnesses]').click(); await ctx.tick();
  assert.deepEqual(missingRows(ctx), ['Claude Codenot installed↗']);
  const claude = ctx.doc.querySelector('.ask-pop-model [data-ask-harness="claude"]');
  assert.equal(claude.title, `${NO_CLAUDE} Opens Connect Claude Code.`);
  claude.click(); await ctx.tick();
  assert.equal(setups, 1);
  assert.deepEqual(opened, [], 'the dialog, not the docs');
  assert.equal(ctx.doc.querySelector('.ask-pop-model'), null, 'the menu closes');
  const bare = makePanel({ fetchHandler: handler({ catalog: CATALOG_NO_CLAUDE }) });
  const bareOpened = [];
  bare.window.open = (...a) => { bareOpened.push(a); return null; };
  bare.panel.open(); await bare.tick(); await bare.tick();
  modelBtn(bare).click(); await bare.tick();
  bare.doc.querySelector('.ask-pop-model [data-ask-more-harnesses]').click(); await bare.tick();
  assert.deepEqual(missingRows(bare), ['Claude Codenot installed↗'], 'the same mark as every other setup row');
  assert.equal(bare.doc.querySelector('.ask-pop-model [data-ask-harness="claude"]').title, `${NO_CLAUDE} Opens its setup docs.`);
  bare.doc.querySelector('.ask-pop-model [data-ask-harness="claude"]').click(); await bare.tick();
  assert.deepEqual(bareOpened, [[CLAUDE_DOCS, '_blank', 'noopener']], 'no Connect Claude Code host: its setup docs');
});

test('no harness installed: the button says "Set up a harness", and its menu is the harnesses to set up', async () => {
  const notReady = Object.fromEntries(ALL_ENGINES.map((e) => [e, `${e} is not installed.`]));
  const setupDocs = Object.fromEntries(ALL_ENGINES.map((e) => [e, `https://docs.example.test/${e}`]));
  let setups = 0;
  const ctx = makePanel({ fetchHandler: handler({ catalog: { ...CATALOG, notReady, setupDocs } }), deps: { openClaudeSetup: () => { setups += 1; }, openAddModel: () => {} } });
  ctx.panel.open(); await ctx.tick(); await ctx.tick();
  const btn = modelBtn(ctx);
  assert.equal(ctx.doc.querySelector('.ask-model-btn-label').textContent, 'Set up a harness');
  assert.equal(ctx.doc.querySelector('.ask-model-btn-effort').hidden, true, 'no effort');
  assert.equal(btn.querySelector('.mdl-mark'), null, 'no harness mark');
  assert.equal(btn.dataset.engine, undefined);
  assert.equal(btn.dataset.setup, '');
  assert.equal(btn.getAttribute('aria-label'), 'Set up a harness: no harness on this machine can run a chat yet');
  btn.click(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-pop-model [data-ask-pane-back]'), null, 'the main pane itself');
  assert.deepEqual([...ctx.doc.querySelectorAll('.ask-pop-model [data-ask-harness-missing]')].map((n) => n.dataset.askHarness), ALL_ENGINES);
  assert.deepEqual(names(ctx), [], 'no model to pick');
  assert.equal(ctx.doc.querySelector('.ask-pop-model [data-ask-effort-row]'), null, 'no effort to pick');
  assert.equal(ctx.doc.querySelector('.ask-pop-model [data-ask-more-harnesses]'), null);
  ctx.doc.querySelector('.ask-pop-model [data-ask-harness="claude"]').click(); await ctx.tick();
  assert.equal(setups, 1);
  // A machine where an installed engine only lacks a model: Add model on it leads, the missing ones below.
  const goose = { ...notReady }; delete goose.goose;
  const one = makePanel({ fetchHandler: handler({ catalog: { ...CATALOG, notReady: goose, setupDocs } }), deps: { openAddModel: () => {} } });
  one.panel.open(); await one.tick(); await one.tick();
  assert.equal(one.doc.querySelector('.ask-model-btn-label').textContent, 'Set up a harness');
  modelBtn(one).click(); await one.tick();
  assert.deepEqual(harnessRows(one), ['Goose (beta)']);
  assert.equal(missingRows(one).length, 6);
});

test('Claude Code not installed: a chat already on Claude keeps its model, flagged, its section led by "Set up Claude Code"', async () => {
  let setups = 0;
  const ctx = await openCodexChat({ fetchHandler: handler({ ...CLAUDE_CHAT, catalog: CATALOG_NO_CLAUDE }), deps: { openClaudeSetup: () => { setups += 1; } } });
  const btn = modelBtn(ctx);
  assert.equal(btn.dataset.engine, 'claude');
  assert.match(btn.textContent, /Opus 5\.5 ⚠/);
  assert.ok(btn.getAttribute('aria-label').endsWith(` · ${NO_CLAUDE}`), 'the button names the reason');
  btn.click(); await ctx.tick();
  const lead = ctx.doc.querySelector('.ask-pop-model [data-ask-setup-lead]');
  assert.equal(lead.textContent, 'Set up Claude Codenot installed↗');
  assert.equal(lead.title, `${NO_CLAUDE} Opens Connect Claude Code.`);
  assert.ok(lead.nextElementSibling.classList.contains('ask-pop-divider'), 'a divider, then the model');
  assert.deepEqual(names(ctx), ['Opus 5.5']);
  assert.equal(ctx.doc.querySelector('.ask-pop-model .ask-model-item .ask-model-tag.is-warn').textContent, 'not installed');
  assert.deepEqual(engineRows(ctx), ['OpenAI Codex (beta)'], 'and it can move to an installed engine');
  lead.click(); await ctx.tick();
  assert.equal(setups, 1);
});

test('picking a Claude model in a Codex chat previews, asks, then switches in place', async () => {
  const posts = [];
  const confirms = [];
  const ctx = await openCodexChat({ fetchHandler: switchHandler({ posts }), confirm: async (o) => { confirms.push(o); return true; } });
  modelBtn(ctx).click(); await ctx.tick();
  row(ctx, 'Opus 5.5').click();
  await settle(ctx);
  assert.deepEqual(posts, [
    { engine: 'claude', model: 'claude-opus-5-5', effort: 'high', dryRun: true },
    { engine: 'claude', model: 'claude-opus-5-5', effort: 'high', dropTurns: 0 }]);
  assert.equal(confirms[0].title, 'Switch this chat to Claude Code?');
  assert.match(confirms[0].message, /• Claude reads with its own Read/);
  assert.match(modelBtn(ctx).textContent, /Opus 5\.5/);
  assert.equal(modelBtn(ctx).dataset.engine, 'claude');
  assert.equal(ctx.doc.querySelector('.ask-divider-engine .ask-divider-t').textContent, 'Switched from Codex to Claude');
  assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.enginePicks')).claude, { model: 'claude-opus-5-5', effort: 'high' });
  assert.equal(ctx.fetchCalls.some((c) => c.opts.method === 'PATCH'), false, 'a switch is never a PATCH');
});

test('declining the switch sends no commit and keeps the engine', async () => {
  const posts = [];
  const ctx = await openCodexChat({ fetchHandler: switchHandler({ posts }), confirm: async () => false });
  modelBtn(ctx).click(); await ctx.tick();
  row(ctx, 'Opus 5.5').click();
  await settle(ctx);
  assert.deepEqual(posts.map((p) => !!p.dryRun), [true]);
  assert.match(modelBtn(ctx).textContent, /GPT-5\.5/);
  assert.equal(modelBtn(ctx).dataset.engine, 'codex');
});

test('a refused switch keeps the chat on its engine and says why', async () => {
  const posts = [];
  const ctx = await openCodexChat({ fetchHandler: switchHandler({ posts, refuse: { error: 'Claude Code is not signed in — run claude, then /login', code: 'claude-signed-out' } }) });
  ctx.doc.getElementById('toasts')?.replaceChildren();
  modelBtn(ctx).click(); await ctx.tick();
  row(ctx, 'Opus 5.5').click();
  await settle(ctx);
  assert.equal(posts.length, 2);
  assert.equal(modelBtn(ctx).dataset.engine, 'codex');
  const toasts = [...ctx.doc.querySelectorAll('#toasts .toast.err')];
  assert.equal(toasts.length, 1);
  assert.match(toasts[0].textContent, /Could not switch this chat to Claude/);
  assert.match(toasts[0].textContent, /not signed in/);
});

test('while a reply runs, other engines\' models are disabled and nothing is sent', async () => {
  const posts = [];
  const ctx = await openCodexChat({ fetchHandler: switchHandler({ posts, inFlight: { messageId: 'askm_00000001' } }) });
  modelBtn(ctx).click(); await ctx.tick();
  assert.equal(row(ctx, 'Opus 5.5').disabled, true);
  assert.equal(row(ctx, 'GPT-5.5').disabled, false, 'the chat\'s own engine stays pickable');
  ctx.doc.getElementById('toasts')?.replaceChildren();
  row(ctx, 'Opus 5.5').dispatchEvent(new ctx.window.Event('click'));   // a plain Event reaches a disabled button's listener; HTMLElement.click() does not
  await settle(ctx);
  assert.deepEqual(posts, []);
  assert.match(ctx.doc.querySelector('#toasts .toast.err').textContent, /A reply is running/, 'a row enabled from before the reply says why nothing happens');
});

test('a model or effort picked on an engine is remembered for that engine', async () => {
  const ctx = await openCodexChat({ fetchHandler: handler(CODEX_CHAT) });
  modelBtn(ctx).click(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-effort-row]').click();
  [...ctx.doc.querySelectorAll('.ask-pop-model [role="menuitem"]')].find((b) => b.textContent === 'high').click();
  assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.enginePicks')).codex, { model: 'gpt-5.5', effort: 'high' });
});

test('a model picked in a Codex chat is remembered for Codex', async () => {
  const ctx = makePanel({ fetchHandler: freshHandler({ thread: { model: 'gpt-5.5', effort: 'low', engine: 'codex' }, messages: CODEX_CHAT.messages }) });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open(); await ctx.tick(); await ctx.tick(); await ctx.tick();
  await openSelector(ctx);
  pickItem(ctx, 'GPT-5.4');
  assert.deepEqual(JSON.parse(ctx.storage.getItem('worca-cc.ask.enginePicks')).codex, { model: 'gpt-5.4', effort: 'low' });
});

test('another engine\'s section leads with the model last used there, tagged', async () => {
  const cat = { ...CATALOG, models: [CATALOG.models[0], { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high'], custom: false }, CATALOG.models[1]] };
  const ctx = makePanel({ fetchHandler: handler({ ...CODEX_CHAT, catalog: cat }) });
  ctx.storage.setItem('worca-cc.ask.enginePicks', JSON.stringify({ claude: { model: 'claude-opus-5', effort: 'high' } }));
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open(); await ctx.tick(); await ctx.tick(); await ctx.tick();
  modelBtn(ctx).click(); await ctx.tick();
  assert.equal(row(ctx, 'GPT-5.5').querySelector('.ask-model-tag'), null, 'the chat\'s own section is untagged');
  await openEngine(ctx, 'claude');
  assert.deepEqual(names(ctx), ['Opus 5']);
  assert.equal(row(ctx, 'Opus 5').querySelector('.ask-model-tag').textContent, 'last used');
  ctx.doc.querySelector('.ask-pop-model [data-ask-more-models]').click(); await ctx.tick();
  assert.deepEqual(names(ctx), ['Opus 5.5'], 'the model the lead displaced is under Claude\'s More models, never lost');
});

test('the model button leads with the harness mark; the mark stands for the engine word, with one engine or several (L1)', async () => {
  const ctx = await openCodexChat({ fetchHandler: handler(CODEX_CHAT) });
  const btn = ctx.doc.querySelector('[data-ask-model-btn]');
  assert.match(btn.querySelector('.mdl-mark.sm img').getAttribute('src'), /\/vendor\/brand-icons\/codex-color\.svg$/);
  assert.equal(btn.firstElementChild.className, 'mdl-mark sm');
  assert.equal(btn.querySelector('.ask-model-btn-engine').hidden, true, 'the mark stands for the engine word');
  assert.match(btn.getAttribute('aria-label'), /^OpenAI Codex · .+/);
  assert.deepEqual([btn.dataset.tip, btn.hasAttribute('title')], [btn.getAttribute('aria-label'), false]);
  const one = await openCodexChat({ fetchHandler: handler({ ...CODEX_CHAT, catalog: { ...CATALOG, models: [CATALOG.models[1]] } }) });
  const oneBtn = one.doc.querySelector('[data-ask-model-btn]');
  assert.ok(oneBtn.querySelector('.mdl-mark.sm img'), 'one engine offered: the mark still shows (L1)');
  assert.deepEqual([oneBtn.querySelector('.ask-model-btn-engine').hidden, oneBtn.querySelector('.ask-model-btn-engine').textContent], [true, '']);
});

test('an engine with no brand mark: the button names it in text, and its accessible name and tip name it too', async () => {
  const cat = { ...CATALOG, models: [...CATALOG.models, { id: 'acme-1', label: 'Acme 1', efforts: ['high'], custom: false, engine: 'acme' }] };
  const ctx = makePanel({ fetchHandler: handler({ catalog: cat }) });
  await openPanel(ctx); await openSelector(ctx); pickItem(ctx, 'Acme 1');
  const btn = modelBtn(ctx);
  assert.equal(btn.querySelector('.mdl-mark'), null, 'no mark, and never a broken image box');
  const eng = btn.querySelector('.ask-model-btn-engine');
  assert.deepEqual([eng.hidden, eng.textContent], [false, 'acme']);
  assert.deepEqual([btn.getAttribute('aria-label'), btn.dataset.tip, btn.hasAttribute('title')], ['acme · Acme 1 · high', 'acme · Acme 1 · high', false]);
});

test('a mark file that fails to load leaves the button: the engine word comes back by today\'s rule', async () => {
  const ctx = await openCodexChat({ fetchHandler: handler(CODEX_CHAT) });
  const btn = modelBtn(ctx);
  const name = btn.getAttribute('aria-label');
  btn.querySelector('.mdl-mark img').dispatchEvent(new ctx.window.Event('error'));
  assert.equal(btn.querySelector('.mdl-mark'), null, 'no broken image box');
  const eng = btn.querySelector('.ask-model-btn-engine');
  assert.deepEqual([eng.hidden, eng.textContent], [false, 'OpenAI Codex']);
  assert.equal(btn.getAttribute('aria-label'), name, 'the accessible name still names the engine');
});

test('the menu: an engine\'s heading, its row and its More harnesses row lead with its harness mark; a mark that fails to load leaves the name', async () => {
  const ctx = makePanel({ fetchHandler: handler(), deps: { openAddModel: () => {} } });
  await openPanel(ctx); await openSelector(ctx);
  const srcOf = (n) => (n.querySelector(':scope > .mdl-mark img')?.getAttribute('src') || '').replace(/^.*\//, '') || null;
  const pop = ctx.doc.querySelector('.ask-pop-model');
  assert.equal(srcOf(pop.querySelector('.ask-pop-group')), 'claudecode-color.svg');
  const codexRow = pop.querySelector('[data-ask-engine-group="codex"]');
  assert.equal(srcOf(codexRow), 'codex-color.svg');
  assert.equal(codexRow.textContent.replace(/›$/, ''), 'OpenAI Codex (beta)', 'the mark adds no text');
  assert.equal(srcOf(row(ctx, 'Opus 5.5')), null, 'a model row carries no mark');
  pop.querySelector('[data-ask-more-harnesses]').click(); await ctx.tick();
  assert.deepEqual([...pop.querySelectorAll('[data-ask-harness]')].map(srcOf), ['geminicli-color.svg', 'goose.svg', 'opencode.svg', 'qwen-color.svg']);
  pop.querySelector('[data-ask-harness="goose"] .mdl-mark img').dispatchEvent(new ctx.window.Event('error'));
  assert.equal(srcOf(pop.querySelector('[data-ask-harness="goose"]')), null, 'no broken image box');
  assert.equal(pop.querySelector('[data-ask-harness="goose"]').textContent.replace(/›$/, ''), 'Goose (beta)');
});

test('picking another engine\'s model swaps the harness mark: never the old engine\'s brand, never two marks', async () => {
  const ctx = makePanel({ fetchHandler: freshHandler() });
  await openPanel(ctx);
  const src = () => [...modelBtn(ctx).querySelectorAll('.mdl-mark')].map((m) => m.querySelector('img').getAttribute('src'));
  assert.equal(src().length, 1);
  assert.match(src()[0], /\/claudecode-color\.svg$/);
  const kept = modelBtn(ctx).querySelector('.mdl-mark');
  await openSelector(ctx); pickEffort(ctx, 'max');
  assert.equal(modelBtn(ctx).querySelector('.mdl-mark'), kept, 'a repaint on the same engine keeps the mark node (no new image load)');
  await openSelector(ctx); pickItem(ctx, 'GPT-5.5');
  assert.equal(src().length, 1, 'exactly one mark');
  assert.match(src()[0], /\/codex-color\.svg$/, 'the Codex mark, not the Claude Code one kept from before');
  await openSelector(ctx); pickItem(ctx, 'Opus 5.5');
  assert.equal(src().length, 1);
  assert.match(src()[0], /\/claudecode-color\.svg$/);
});

test('the model button\'s accessible name: no effort for a model that takes none; a bridged model names its connection', async () => {
  const cat = { ...CATALOG, models: [...CATALOG.models,
    { id: 'claude-haiku-x', label: 'Haiku X', efforts: [], noEffort: true, custom: false },
    { id: 'copilot-gpt-5', label: 'GPT-5 (Copilot)', efforts: ['high'], custom: 'global', bridged: 'copilot', upstreamModel: 'gpt-5', upstreamApi: 'openai-chat' },
    { id: 'flaggy-1', label: 'Flaggy', efforts: ['high'], custom: 'global', costUnreliable: true }] };
  const ctx = makePanel({ fetchHandler: handler({ catalog: cat }) });
  await openPanel(ctx);
  await openSelector(ctx); pickItem(ctx, 'Haiku X');
  const btn = modelBtn(ctx);
  assert.deepEqual([btn.getAttribute('aria-label'), btn.dataset.tip], ['Claude Code · Haiku X', 'Claude Code · Haiku X']);
  await openSelector(ctx); pickItem(ctx, 'GPT-5 (Copilot)');
  assert.match(btn.getAttribute('aria-label'), / · GPT-5 \(Copilot\) · high · GitHub Copilot$/);
  assert.equal(btn.dataset.tip, btn.getAttribute('aria-label'));
  await openSelector(ctx); pickItem(ctx, 'Flaggy');
  assert.equal(btn.getAttribute('aria-label'), 'Claude Code · Flaggy ⚠ · high', 'the name keeps the label\'s ⚠ marker, as the button\'s text did');
});

test('a resync that finds the chat on another engine (switched in a tab that was offline) moves the picker too', async () => {
  let moved = false;
  const base = handler(CODEX_CHAT);
  const ctx = await openCodexChat({ fetchHandler: (url, opts) => {
    if (moved && url === `/api/ask/threads/${TID}` && (!opts.method || opts.method === 'GET')) {
      return { ok: true, status: 200, json: async () => ({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', sessionId: null, context: null, totals: {}, model: 'claude-opus-5-5', effort: 'high', engine: 'claude' },
        messages: [...CODEX_CHAT.messages, { id: 'askm_s0000001', seq: 3, role: 'system', text: 'Switched from Codex to Claude', blocks: [
          { kind: 'divider', text: 'Switched from Codex to Claude', engineSwitch: { from: 'codex', to: 'claude' } }] }],
        attachments: [], runLinks: [], inFlight: null }) };
    }
    return base(url, opts);
  } });
  assert.equal(modelBtn(ctx).dataset.engine, 'codex');
  moved = true;
  ctx.panel.onHello([]);   // a reconnect: resync → loadThread of the same chat
  await settle(ctx);
  assert.equal(modelBtn(ctx).dataset.engine, 'claude');
  assert.match(modelBtn(ctx).textContent, /Opus 5\.5/, 'the next message is not sent with the Codex model the server would refuse');
});

test('a chat begun in this tab follows a switch made elsewhere while it was offline', async () => {
  const sent = [];
  let moved = false;
  const fresh = freshHandler({ catalog: CATALOG, sent });
  const ctx = makePanel({ fetchHandler: (url, opts) => {
    if (moved && url === `/api/ask/threads/${TID}` && (!opts.method || opts.method === 'GET')) {
      return { ok: true, status: 200, json: async () => ({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', sessionId: null, context: null, totals: {}, model: 'claude-opus-5-5', effort: 'high', engine: 'claude' },
        messages: [{ id: 'askm_u0000001', seq: 1, role: 'user', text: 'hi', blocks: [] },
          { id: 'askm_00000001', seq: 2, role: 'assistant', text: 'yo', blocks: [], status: 'done', model: 'gpt-5.5', effort: 'low', engine: 'codex' },
          { id: 'askm_s0000001', seq: 3, role: 'system', text: 'Switched from Codex to Claude', blocks: [{ kind: 'divider', text: 'Switched from Codex to Claude', engineSwitch: { from: 'codex', to: 'claude' } }] }],
        attachments: [], runLinks: [], inFlight: null }) };
    }
    return fresh(url, opts);
  } });
  ctx.panel.open(); await ctx.tick(); await ctx.tick();
  await openSelector(ctx);
  pickItem(ctx, 'GPT-5.5');   // a new chat, on Codex: its thread payload has no engine yet
  ctx.doc.querySelector('textarea.ask-input').value = 'hi';
  ctx.doc.querySelector('[data-ask-send]').click();
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-start', threadId: TID, messageId: 'askm_00000001', userMessageId: 'askm_u0000001', seq: 1, startedAt: '2026-10-26T00:00:00Z', model: 'gpt-5.5', effort: 'low' });
  ctx.panel.pushServerFrame({ type: 'ask-done', threadId: TID, messageId: 'askm_00000001', seq: 2, text: 'yo', status: 'done' });
  await settle(ctx);
  assert.equal(modelBtn(ctx).dataset.engine, 'codex');
  moved = true;
  ctx.panel.onHello([]);
  await settle(ctx);
  assert.equal(modelBtn(ctx).dataset.engine, 'claude');
  ctx.doc.querySelector('textarea.ask-input').value = 'next';
  ctx.doc.querySelector('[data-ask-send]').click();
  await settle(ctx);
  assert.equal(sent.at(-1).model, 'claude-opus-5-5', 'the next send uses the new engine\'s model');
});

test('a switch starts the context meter over: the old engine\'s fill and window are gone', async () => {
  const sw = switchHandler({ posts: [] });
  const ctx = await openCodexChat({ confirm: async () => true, fetchHandler: (url, opts) => {
    const r = sw(url, opts);
    if (url !== `/api/ask/threads/${TID}` || (opts.method && opts.method !== 'GET')) return r;
    return { ...r, json: async () => { const b = await r.json(); b.thread.totals = { costUsd: 0, turns: 1, ctx: 180_000, ctxWindow: 200_000 }; return b; } };
  } });
  const meter = () => ctx.doc.querySelector('.ask-ctx-ring');
  assert.equal(meter().getAttribute('aria-label'), 'Context window, 90% full');
  modelBtn(ctx).click(); await ctx.tick();
  row(ctx, 'Opus 5.5').click();
  await settle(ctx);
  assert.equal(modelBtn(ctx).dataset.engine, 'claude');
  assert.equal(meter().getAttribute('aria-label'), 'Context window');
});

test('a reply that starts while the confirm is open: no commit, and the toast says why', async () => {
  const posts = [];
  let ctxRef = null;
  const ctx = await openCodexChat({ fetchHandler: switchHandler({ posts }), confirm: async () => {
    ctxRef.panel.pushServerFrame({ type: 'ask-start', threadId: TID, messageId: 'askm_00000009', userMessageId: 'askm_u0000009', seq: 1, startedAt: '2026-10-26T00:00:00Z', model: 'gpt-5.5', effort: 'low' });
    return true;
  } });
  ctxRef = ctx;
  ctx.doc.getElementById('toasts')?.replaceChildren();
  modelBtn(ctx).click(); await ctx.tick();
  row(ctx, 'Opus 5.5').click();
  await settle(ctx);
  assert.deepEqual(posts.map((p) => !!p.dryRun), [true], 'only the preview');
  assert.equal(modelBtn(ctx).dataset.engine, 'codex');
  assert.match(ctx.doc.querySelector('#toasts .toast.err').textContent, /A reply is running\. Switch engines when it finishes\./);
});

test('a refused switch offers the next step: a new preview when more turns now drop, else the engine\'s setup page', async () => {
  const posts = [];
  const ctx = await openCodexChat({ fetchHandler: switchHandler({ posts, refuse: { error: 'Claude will not see the 2 oldest turns of this chat: confirm that first', code: 'confirm-dropped-turns', droppedTurns: 2 } }) });
  ctx.doc.getElementById('toasts')?.replaceChildren();
  modelBtn(ctx).click(); await ctx.tick();
  row(ctx, 'Opus 5.5').click();
  await settle(ctx);
  const again = ctx.doc.querySelector('#toasts .toast.err .toast-act');
  assert.equal(again.textContent, 'Review again');
  again.click();
  await settle(ctx);
  assert.deepEqual(posts.map((p) => !!p.dryRun), [true, false, true, false], 'a new preview, then a new commit');
  const opened = [];
  const setup = await openCodexChat({ fetchHandler: switchHandler({ posts: [], refuse: { error: 'Claude Code is not signed in', code: 'claude-signed-out', docsUrl: 'https://docs.example.test/claude', setupLabel: 'Set up Claude' } }) });
  setup.window.open = (...a) => { opened.push(a); return null; };
  setup.doc.getElementById('toasts')?.replaceChildren();
  modelBtn(setup).click(); await setup.tick();
  row(setup, 'Opus 5.5').click();
  await settle(setup);
  const act = setup.doc.querySelector('#toasts .toast.err .toast-act');
  assert.equal(act.textContent, 'Set up Claude');
  act.click();
  assert.deepEqual(opened, [['https://docs.example.test/claude', '_blank', 'noopener']]);
});


test('More harnesses: one row lists the chat engines with no models; each opens Add model on that harness', async () => {
  const added = [];
  const ctx = makePanel({ fetchHandler: handler(), deps: { openAddModel: (engine) => added.push(engine) } });
  ctx.panel.open(); await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-model-btn]').click(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-pop-model [data-ask-engine-group="opencode"]'), null, 'an engine with no models has no section of its own');
  const more = ctx.doc.querySelector('.ask-pop-model [data-ask-more-harnesses]');
  assert.equal(more.textContent.replace(/›$/, ''), 'More harnesses');
  more.click(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-pop-model [data-ask-pane-back]').textContent, '‹ More harnesses');
  assert.deepEqual(harnessRows(ctx), ['Gemini CLI (beta)', 'Goose (beta)', 'OpenCode (beta)', 'Qwen Code (beta)']);
  assert.deepEqual(names(ctx), [], 'the pane lists harnesses, never a model');
  ctx.doc.querySelector('.ask-pop-model [data-ask-harness="opencode"]').click(); await ctx.tick();
  assert.deepEqual(added, ['opencode'], 'the row opens Add model on the harness');
  assert.equal(ctx.doc.querySelector('.ask-pop-model'), null, 'the menu closes on the way to Models');
});

test('More harnesses: an engine not installed here sits at the foot, tagged, and opens its setup docs', async () => {
  const notReady = { gemini: 'Gemini CLI is not installed.', qwen: 'Qwen Code is not installed.' };
  const setupDocs = { gemini: 'https://docs.example.test/gemini', qwen: 'https://docs.example.test/qwen' };
  const added = [];
  const ctx = makePanel({ fetchHandler: handler({ catalog: { ...CATALOG, notReady, setupDocs } }), deps: { openAddModel: (e) => added.push(e) } });
  const opened = [];
  ctx.window.open = (...a) => { opened.push(a); return null; };
  ctx.panel.open(); await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-model-btn]').click(); await ctx.tick();
  ctx.doc.querySelector('.ask-pop-model [data-ask-more-harnesses]').click(); await ctx.tick();
  assert.deepEqual(harnessRows(ctx), ['Goose (beta)', 'OpenCode (beta)'], 'the installed ones first, as before');
  assert.deepEqual(missingRows(ctx), ['Gemini CLI (beta)not installed↗', 'Qwen Code (beta)not installed↗']);
  const gemini = ctx.doc.querySelector('.ask-pop-model [data-ask-harness="gemini"]');
  assert.ok(gemini.classList.contains('is-missing'));
  assert.equal(gemini.querySelector('.ask-pop-row-value').textContent, 'not installed', 'a quiet value, not a chip');
  assert.equal(gemini.querySelector('.ask-model-tag'), null);
  assert.equal(gemini.title, 'Gemini CLI is not installed. Opens its setup docs.');
  assert.ok(gemini.previousElementSibling.classList.contains('ask-pop-divider'), 'a divider sets them apart');
  gemini.click(); await ctx.tick();
  assert.deepEqual(opened, [['https://docs.example.test/gemini', '_blank', 'noopener']]);
  assert.deepEqual(added, [], 'not Add model: a model added there would never be offered');
  assert.equal(ctx.doc.querySelector('.ask-pop-model'), null, 'the menu closes');
});

test('More harnesses: with no other engine installed the row stays and lists them all, with or without Add model', async () => {
  const notReady = Object.fromEntries(['codex', 'copilot', 'gemini', 'goose', 'opencode', 'qwen'].map((e) => [e, `${e} is not installed.`]));
  const setupDocs = Object.fromEntries(Object.keys(notReady).map((e) => [e, `https://docs.example.test/${e}`]));
  const none = makePanel({ fetchHandler: handler({ catalog: { ...CATALOG, notReady, setupDocs } }), deps: { openAddModel: () => {} } });
  none.panel.open(); await none.tick(); await none.tick();
  none.doc.querySelector('[data-ask-model-btn]').click(); await none.tick();
  assert.deepEqual(engineRows(none), [], 'no other engine is offered');
  none.doc.querySelector('.ask-pop-model [data-ask-more-harnesses]').click(); await none.tick();
  assert.deepEqual(harnessRows(none), []);
  assert.deepEqual([...none.doc.querySelectorAll('.ask-pop-model [data-ask-harness-missing]')].map((n) => n.dataset.askHarness),
    ['codex', 'copilot', 'gemini', 'goose', 'opencode', 'qwen']);
  assert.equal(none.doc.querySelector('.ask-pop-model [data-ask-harness-missing]').previousElementSibling.classList.contains('ask-pop-divider'), true,
    'only the back row\'s divider above: none between lists when nothing is installed');
  const bare = makePanel({ fetchHandler: handler({ catalog: { ...CATALOG, notReady, setupDocs } }) });
  bare.panel.open(); await bare.tick(); await bare.tick();
  bare.doc.querySelector('[data-ask-model-btn]').click(); await bare.tick();
  assert.ok(bare.doc.querySelector('.ask-pop-model [data-ask-more-harnesses]'), 'docs need no Add model host');
});

test('More harnesses: back returns to the models; the row is left out when Add model is not wired', async () => {
  const ctx = makePanel({ fetchHandler: handler(), deps: { openAddModel: () => {} } });
  ctx.panel.open(); await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('[data-ask-model-btn]').click(); await ctx.tick();
  ctx.doc.querySelector('.ask-pop-model [data-ask-more-harnesses]').click(); await ctx.tick();
  ctx.doc.querySelector('.ask-pop-model [data-ask-pane-back]').click(); await ctx.tick();
  assert.deepEqual(names(ctx), ['Opus 5.5']);
  const bare = makePanel({ fetchHandler: handler() });
  bare.panel.open(); await bare.tick(); await bare.tick();
  bare.doc.querySelector('[data-ask-model-btn]').click(); await bare.tick();
  assert.equal(bare.doc.querySelector('.ask-pop-model [data-ask-more-harnesses]'), null);
});
