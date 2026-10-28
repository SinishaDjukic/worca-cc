// test/ui-chat-scope-switch.test.mjs — Projects, any way P4b: the switch card (canvas SwitchAsk; CONTRACT §4 scope-switch).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { SCOPE_SWITCH_TYPE, buildScopeSwitchCard, registerScopeSwitchCard } from '../ui/public/chat/scope-switch-card.mjs';
import { chatCardBuilder, _resetChatExtensions } from '../ui/public/chat/extensions.mjs';
import { makePanel } from './helpers/ask-panel-harness.mjs';
import { checkRows } from './helpers/rows.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); _resetChatExtensions(); });
const tick = () => new Promise((r) => setTimeout(r, 0));
const TID = 'ask_00000001';
const CANDS = [
  { projectKey: 'havn-and-00000001', name: 'Havn Android', path: '/Users/me/Develop/havn-android', displayPath: '~/Develop/havn-android', vcs: 'git' },
  { projectKey: 'havn-ios-00000002', name: 'Havn IOS', path: 'C:\\Users\\me\\Develop\\Havn', vcs: 'none' },
];
const BLOCK = { kind: 'card', id: 'card_00000009', state: 'proposed', card: { type: 'scope-switch', candidates: CANDS, reason: 'Both Havn apps have a booking screen.' } };
function ctxOf({ post = async () => ({}) } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  doms.push(dom);
  const posts = []; const said = []; let focused = 0;
  const ctx = { doc: dom.window.document, win: dom.window, threadId: () => TID,
    postCard: async (block, body) => { posts.push(body); return post(block, body); },
    announce: (t) => said.push(t), focusComposer: () => { focused += 1; } };
  return { ctx, posts, said, focused: () => focused };
}

test('proposed: heading outside, the question and its reason, the candidates then Continue without project — kind chips, displayPath else path (S22)', () => {
  const { ctx } = ctxOf();
  const { el } = buildScopeSwitchCard(BLOCK, ctx);
  assert.ok(el.matches('section.chat-rc-q.chat-q'));
  assert.equal(el.querySelector('.chat-rc-q-head').textContent, 'Your turn: pick a project');
  assert.equal(el.querySelector('.qtext-t').textContent, 'Which project is this for?');
  assert.equal(el.querySelector('.qwhy').textContent, 'Both Havn apps have a booking screen.');
  const opts = [...el.querySelectorAll('.qopt')];
  assert.deepEqual(opts.map((o) => [o.dataset.key, o.querySelector('.chat-q-opt-label').textContent, o.querySelector('.kind-chip').className, o.querySelector('.kind-chip').textContent, o.querySelector('.chat-q-opt-sub')?.textContent ?? null]), [
    ['A', 'Havn Android', 'kind-chip kind-git', 'Git', '~/Develop/havn-android'],
    ['B', 'Havn IOS', 'kind-chip kind-folder', 'Folder', 'C:\\Users\\me\\Develop\\Havn'],
    ['C', 'Continue without project', 'kind-chip kind-none', 'No project', null],
  ]);
  const go = el.querySelector('[data-qpanel-submit]');
  assert.deepEqual([el.querySelector('.qanswered').textContent, go.textContent, go.disabled], ['0 of 1 answered', 'Switch', true]);
  opts[0].click();
  assert.deepEqual([el.querySelector('.qanswered').textContent, go.textContent], ['1 of 1 answered', 'Switch to Havn Android']);
  opts[2].click();
  assert.equal(go.textContent, 'Continue');
  const three = buildScopeSwitchCard({ ...BLOCK, card: { ...BLOCK.card, candidates: [...CANDS, { projectKey: 'c-00000003', name: 'C', path: '/c' }, { projectKey: 'd-00000004', name: 'D', path: '/d' }], reason: '' } }, ctx).el;
  assert.equal(three.querySelectorAll('.qopt').length, 4, 'at most 3 candidates (U14) plus Continue without project');
  assert.equal(three.querySelector('.qwhy'), null, 'no reason, no line');
  const mixed = buildScopeSwitchCard({ ...BLOCK, card: { ...BLOCK.card, candidates: [{ name: 'No key', path: '/n' }, 'k-00000005', ...CANDS, { projectKey: 'c-00000003', name: 'C', path: '/c' }] } }, ctx).el;
  assert.deepEqual([...mixed.querySelectorAll('.qopt')].map((o) => [o.dataset.value, o.querySelector('.chat-q-opt-label').textContent, o.querySelector('.chat-q-opt-sub')?.textContent ?? null]), [
    ['k-00000005', 'k-00000005', null], ['havn-and-00000001', 'Havn Android', '~/Develop/havn-android'], ['havn-ios-00000002', 'Havn IOS', 'C:\\Users\\me\\Develop\\Havn'], ['none', 'Continue without project', null],
  ], 'a row without a key is dropped, a bare key is its own name, then at most 3 kept (U14)');
});

test('the answer posts { choice } on the card route; the composer gets the focus back; a refusal stays in the card', async () => {
  await checkRows([
    { name: 'a project', run: async () => {
      const { ctx, posts, said, focused } = ctxOf();
      const { el } = buildScopeSwitchCard(BLOCK, ctx);
      el.querySelectorAll('.qopt')[1].click(); el.querySelector('[data-qpanel-submit]').click(); await tick();
      assert.deepEqual([posts, said, focused()], [[{ choice: 'havn-ios-00000002' }], ['Switched to Havn IOS'], 1]);
    } },
    { name: 'none', run: async () => {
      const { ctx, posts, said } = ctxOf();
      const { el } = buildScopeSwitchCard(BLOCK, ctx);
      el.querySelectorAll('.qopt')[2].click(); el.querySelector('[data-qpanel-submit]').click(); await tick();
      assert.deepEqual([posts, said], [[{ choice: 'none' }], ['Answer sent']]);
    } },
    { name: 'a refusal (409)', run: async () => {
      const { ctx, said, focused } = ctxOf({ post: async () => { throw Object.assign(new Error('this chat already has a project'), { status: 409, body: { error: 'this chat already has a project' } }); } });
      const { el } = buildScopeSwitchCard(BLOCK, ctx);
      el.querySelector('.qopt').click(); el.querySelector('[data-qpanel-submit]').click(); await tick();
      assert.deepEqual([el.querySelector('.chat-rc-q-err').textContent, said, focused()], ['this chat already has a project', [], 0]);
    } },
  ]);
});

test('answered (canvas SwitchAsk, B9): the card stays — the pick marked, no footer; a closed card, or one answered without a choice, reads Not answered', () => {
  const { ctx } = ctxOf();
  const answered = (choice) => buildScopeSwitchCard({ ...BLOCK, state: 'answered', card: { ...BLOCK.card, ...(choice ? { choice } : {}) } }, ctx).el;
  const pick = answered('havn-and-00000001');
  assert.ok(pick.matches('section.chat-rc-q.chat-q.is-answered'));
  assert.deepEqual([...pick.querySelectorAll('.qopt')].map((o) => o.getAttribute('aria-pressed')), ['true', 'false', 'false']);
  assert.equal(pick.querySelector('.qpanel-foot'), null);
  assert.deepEqual([...answered('none').querySelectorAll('.qopt')].map((o) => o.getAttribute('aria-pressed')), ['false', 'false', 'true'], 'Continue without project is the pick');
  assert.equal(answered(null).querySelector('.chat-rc-receipt').textContent, 'Not answered');
  const closed = buildScopeSwitchCard({ ...BLOCK, state: 'closed' }, ctx).el;
  assert.equal(closed.querySelector('.chat-rc-receipt').textContent, 'Not answered', 'S17: P4a closes an open card when the scope is set another way');
  assert.equal(closed.querySelector('.qpanel'), null);
});

test('registered as scope-switch: inside the panel a proposed block renders the card, its answer reaches the card route and the composer takes the focus', async () => {
  registerScopeSwitchCard();
  assert.equal(SCOPE_SWITCH_TYPE, 'scope-switch');
  assert.equal(typeof chatCardBuilder('scope-switch'), 'function');
  const snap = { thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
    messages: [{ id: 'askm_00000002', threadId: TID, seq: 1, role: 'assistant', text: '', status: 'done', blocks: [BLOCK], createdAt: 't' }],
    attachments: [], runLinks: [], worktrees: [], inFlight: null };
  const store = new Map([['worca-cc.ask.thread', TID]]);
  const ctx = makePanel({
    storage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    fetchHandler: (url, opts) => {
      if (url === `/api/ask/threads/${TID}` && (opts.method || 'GET') === 'GET') return { ok: true, status: 200, json: async () => snap };
      if (url === `/api/ask/threads/${TID}/cards/card_00000009`) return { ok: true, status: 200, json: async () => ({ block: { ...BLOCK, state: 'answered', card: { ...BLOCK.card, choice: 'havn-and-00000001' } } }) };
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  ctx.panel.open();
  for (let i = 0; i < 4; i++) await ctx.tick();
  const card = ctx.doc.querySelector('.ask-msg-assistant section.chat-q');
  assert.ok(card, 'the registered builder rendered the card');
  card.querySelector('.qopt').click();
  card.querySelector('[data-qpanel-submit]').focus();   // open() already focused the composer: move the focus away so the assertion below binds focusComposer
  card.querySelector('[data-qpanel-submit]').click();
  for (let i = 0; i < 3; i++) await ctx.tick();
  const post = ctx.fetchCalls.find((c) => c.url === `/api/ask/threads/${TID}/cards/card_00000009`);
  assert.deepEqual([post.opts.method, JSON.parse(post.opts.body)], ['POST', { choice: 'havn-and-00000001' }]);
  assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('textarea.ask-input'));
  ctx.panel.destroy();
});
