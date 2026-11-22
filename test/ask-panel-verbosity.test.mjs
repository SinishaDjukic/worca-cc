// test/ask-panel-verbosity.test.mjs — the composer's reply style (#1230): the `Style · …` picker and /verbosity.
// The command is never posted as a message; a pick PATCHes the chat once it exists, else rides the first send.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { cssRules } from './helpers/css-rules.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const TID = 'ask_00000001';
const THREAD = { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} };

function handler(state) {
  return (url, opts) => {
    const method = ((opts || {}).method || 'GET').toUpperCase();
    if (url === '/api/ask/threads' && method === 'POST') { state.creates += 1; return { ok: true, status: 201, json: async () => ({ thread: { ...THREAD, title: null } }) }; }
    if (url === `/api/ask/threads/${TID}` && method === 'PATCH') { state.patches.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ thread: { id: TID } }) }; }
    if (url === `/api/ask/threads/${TID}` && method === 'GET' && state.snap) return { ok: true, status: 200, json: async () => state.snap };
    if (url === `/api/ask/threads/${TID}/messages` && method === 'POST') { state.bodies.push(JSON.parse(opts.body)); return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: 'askm_00000001' }) }; }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}
const snapOf = (thread = {}) => ({ thread: { ...THREAD, ...thread }, messages: [], attachments: [], runLinks: [], worktrees: [], inFlight: null });
async function setup({ snap = null } = {}) {
  const state = { patches: [], bodies: [], creates: 0, snap };
  const ctx = makePanel({ fetchHandler: handler(state) });
  if (snap) ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await settle(ctx);
  return { state, ctx };
}
const settle = async (ctx) => { for (let i = 0; i < 6; i++) await ctx.tick(); };
const btn = (ctx) => ctx.doc.querySelector('[data-ask-verbosity-btn]');
const label = (ctx) => btn(ctx).querySelector('.ask-scope-label').textContent;
const input = (ctx) => ctx.doc.querySelector('textarea.ask-input');
const toasts = (ctx) => [...ctx.doc.querySelectorAll('.toast')];
const send = async (ctx, text) => { input(ctx).value = text; ctx.doc.querySelector('[data-ask-send]').click(); await settle(ctx); };
const messagePosts = (ctx) => ctx.fetchCalls.filter((c) => c.url.endsWith('/messages'));

test('/verbosity terse PATCHes the thread, sends no message, clears the input and toasts', async () => {
  const { state, ctx } = await setup({ snap: snapOf() });
  await send(ctx, '/verbosity terse');
  assert.deepEqual(state.patches, [{ verbosity: 'terse' }]);
  assert.equal(messagePosts(ctx).length, 0, 'the command is never posted as a message');
  assert.equal(input(ctx).value, '');
  assert.equal(label(ctx), 'Style · Terse');
  const t = toasts(ctx).at(-1);
  assert.ok(t.classList.contains('ok'));
  assert.match(t.textContent, /Reply style: Terse/);
  assert.match(t.textContent, /Applies from this chat's next reply\./);
  await send(ctx, '/verbosity default');
  assert.deepEqual(state.patches.at(-1), { verbosity: null }, 'default clears the override');
  assert.equal(label(ctx), 'Style · Default');
  assert.match(toasts(ctx).at(-1).textContent, /Reply style: Default/);
  await send(ctx, '/verbosity');
  assert.equal(state.patches.length, 2, 'show changes nothing');
  assert.match(toasts(ctx).at(-1).textContent, /Reply style: Default \(follows settings\)/);
  assert.equal(input(ctx).value, '');
  assert.equal(messagePosts(ctx).length, 0);
  ctx.panel.destroy();
});

test('/verbosity loud keeps the input, posts nothing, shows an error toast', async () => {
  const { state, ctx } = await setup({ snap: snapOf() });
  await send(ctx, '/verbosity loud');
  assert.equal(state.patches.length, 0);
  assert.equal(messagePosts(ctx).length, 0);
  assert.equal(input(ctx).value, '/verbosity loud', 'the input is kept to fix');
  const t = toasts(ctx).at(-1);
  assert.ok(t.classList.contains('err'));
  assert.match(t.textContent, /Unknown style "loud"\. Use \/verbosity detailed \| normal \| concise \| terse \| caveman \| default\./);
  ctx.panel.destroy();
});

test('the picker PATCHes and its label follows', async () => {
  const { state, ctx } = await setup({ snap: snapOf() });
  assert.equal(label(ctx), 'Style · Default');
  btn(ctx).click();
  const items = () => [...ctx.doc.querySelectorAll('.ask-pop-verbosity [role="menuitemradio"]')];
  assert.deepEqual(items().map((i) => i.textContent), ['Default (follows settings)', 'Detailed', 'Normal', 'Concise', 'Terse', 'Caveman']);
  assert.equal(items()[0].getAttribute('aria-checked'), 'true');
  items()[5].click();
  await settle(ctx);
  assert.equal(ctx.doc.querySelector('.ask-pop-verbosity'), null, 'a pick closes the popover');
  assert.deepEqual(state.patches, [{ verbosity: 'caveman' }]);
  assert.equal(label(ctx), 'Style · Caveman');
  btn(ctx).click();
  assert.equal(items()[5].getAttribute('aria-checked'), 'true', 'the current one is marked');
  items()[1].click();
  await settle(ctx);
  assert.deepEqual(state.patches, [{ verbosity: 'caveman' }, { verbosity: 'detailed' }], 'PATCHes land in pick order');
  assert.equal(label(ctx), 'Style · Detailed');
  ctx.panel.destroy();
});

test('a new chat\'s pick rides the first send payload', async () => {
  const { state, ctx } = await setup();
  btn(ctx).click();
  [...ctx.doc.querySelectorAll('.ask-pop-verbosity [role="menuitemradio"]')][4].click();   // Terse
  await settle(ctx);
  assert.equal(state.patches.length, 0, 'no thread yet: nothing to PATCH');
  await send(ctx, 'hello');
  assert.equal(state.creates, 1);
  assert.equal(state.bodies[0].verbosity, 'terse', 'the first message carries the pick');
  await send(ctx, 'again');
  assert.equal('verbosity' in state.bodies[1], false, 'later messages do not');
  assert.equal(state.patches.length, 0);
  ctx.panel.destroy();
});

test('a new chat without a pick sends no verbosity; New chat resets the label', async () => {
  const { state, ctx } = await setup({ snap: snapOf({ verbosity: 'terse' }) });
  assert.equal(label(ctx), 'Style · Terse');
  ctx.doc.querySelector('.chat-head [data-ask-new-btn]').click();
  await settle(ctx);
  assert.equal(label(ctx), 'Style · Default');
  state.snap = null;
  await send(ctx, 'hello');
  assert.equal('verbosity' in state.bodies[0], false);
  ctx.panel.destroy();
});

test('a pick while another chat is loading changes no chat (the one being left keeps its style)', async () => {
  const TID2 = 'ask_00000002';
  let release;
  const held = new Promise((r) => { release = r; });
  const state = { patches: [], bodies: [], creates: 0, snap: snapOf() };
  const base = handler(state);
  const patched = [];
  const ctx = makePanel({ fetchHandler: (url, opts) => {
    const method = ((opts || {}).method || 'GET').toUpperCase();
    if (method === 'PATCH') patched.push(url);
    if (url === `/api/ask/threads/${TID2}` && method === 'GET') return held.then(() => ({ ok: true, status: 200, json: async () => snapOf({ id: TID2, verbosity: 'detailed' }) }));
    return base(url, opts);
  } });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await settle(ctx);
  assert.equal(label(ctx), 'Style · Default');
  ctx.panel.open({ threadId: TID2 });               // the GET for chat 2 is held: chat 1 is still the loaded one
  await settle(ctx);
  btn(ctx).click();
  [...ctx.doc.querySelectorAll('.ask-pop-verbosity [role="menuitemradio"]')][4].click();   // Terse
  await settle(ctx);
  assert.deepEqual(patched, [], 'no PATCH reaches the chat being left');
  release();
  await settle(ctx);
  assert.equal(label(ctx), 'Style · Detailed', 'the loaded chat shows its own stored style');
  assert.deepEqual(patched, []);
  ctx.panel.destroy();
});

test('/verbosity while a reply streams applies at once and is not queued as a message', async () => {
  const { state, ctx } = await setup({ snap: { ...snapOf(), inFlight: { assistantMessageId: 'askm_00000009', startedAt: 't' } } });
  await send(ctx, '/verbosity concise');
  assert.deepEqual(state.patches, [{ verbosity: 'concise' }]);
  assert.equal(messagePosts(ctx).length, 0, 'never posted, never queued');
  assert.equal(input(ctx).value, '');
  assert.equal(label(ctx), 'Style · Concise');
  ctx.panel.destroy();
});

test('loading a thread with verbosity caveman shows Style · Caveman', async () => {
  const { ctx } = await setup({ snap: snapOf({ verbosity: 'caveman' }) });
  assert.equal(label(ctx), 'Style · Caveman');
  assert.equal(btn(ctx).dataset.minLevel, undefined, 'shown at every interface level');
  ctx.panel.destroy();
});

const STYLE_RULES = cssRules(readStyleCss());
const topRules = (sel) => STYLE_RULES.filter((r) => r.sel === sel && r.media === '');
const decl = (r, prop) => {
  const m = r && r.body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};

test('the Style popover opens above the composer box, on the Style pill\'s side, capped and scrolling like the scope and Sets pickers', () => {
  const rules = topRules('.ask-pop-verbosity');
  assert.equal(rules.length, 1, 'exactly one top-level .ask-pop-verbosity rule');
  const [rule] = rules;
  assert.equal(decl(rule, 'bottom'), 'calc(var(--ask-box-top) + 6px)', 'it opens upward above the box, not below it');
  assert.equal(decl(rule, 'left'), 'var(--ask-col-inset)', 'it sits on the Style pill\'s side (the left group)');
  assert.equal(decl(rule, 'right'), null, 'it sits on the Style pill\'s side (the left group)');
  assert.equal(decl(rule, 'max-height'), 'min(420px,70%)', 'all six rows stay reachable');
  assert.equal(decl(rule, 'overflow-y'), 'auto', 'all six rows stay reachable');
  assert.match(decl(rule, 'width') || '', /^\d+px$/, 'a fixed width: the panel never collapses to its content');
  for (const sibling of ['.ask-pop-mcp', '.ask-pop-scope']) {
    const sib = topRules(sibling);
    assert.equal(sib.length, 1, `exactly one top-level ${sibling} rule`);
    for (const prop of ['bottom', 'left', 'max-height', 'overflow-y']) {
      assert.equal(decl(rule, prop), decl(sib[0], prop), `${prop} follows ${sibling}`);
    }
  }
});
