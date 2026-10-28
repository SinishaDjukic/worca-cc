// test/ask-panel-extensions.test.mjs — worca Chat CONTRACT §2 inside the Ask panel: a registered card builder wins
// over the built-in one (cache + rebuild rule, the progress family, a throwing builder falls back once), the ONE card
// ctx (chatDeps read at call time, postCard), and composer add-ons (lead row, update per render, beforeSend).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';
import { registerChatCard, registerComposerAddon, _resetChatExtensions } from '../ui/public/chat/extensions.mjs';

const TID = 'ask_00000001';
const MID = 'askm_00000001';
const THREAD = { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} };
const AWAY_CARD = {
  type: 'away', level: 'user', projectKey: null, projectName: null, set: { enabled: true }, unset: [],
  changes: [{ field: 'enabled', label: 'Which runs', before: 'Only runs I marked', after: 'All runs' }],
  summary: 'Which runs: All runs',
  before: ['From 22:00 to 07:00, worca answers questions on runs you marked. Other runs wait for you.'],
  after: ['From 22:00 to 07:00, worca answers questions on all runs.'],
  note: '',
};

beforeEach(() => _resetChatExtensions());

function api(rec) {
  return (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    (rec.calls ||= []).push(`${method} ${url}`);
    if (/\/cards\/card_/.test(url) && method === 'POST') {
      if (rec.cardThrows) throw new TypeError('Failed to fetch');           // the browser's offline error
      rec.cardBodies = [...(rec.cardBodies || []), JSON.parse(opts.body)];
      return rec.cardResponse || { ok: true, status: 200, json: async () => ({ ok: true, echo: JSON.parse(opts.body) }) };
    }
    if (url === `/api/ask/threads/${TID}/changes` && method === 'POST') {
      rec.changesBodies = [...(rec.changesBodies || []), JSON.parse(opts.body)];
      return rec.changesResponse || { ok: true, status: 201, json: async () => ({ message: { id: 'askm_a0000001' } }) };
    }
    if (url === `/api/ask/threads/${TID}/messages` && method === 'POST') {
      rec.messageBodies = [...(rec.messageBodies || []), JSON.parse(opts.body)];
      return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000009', attachments: [], contexts: [] }) };
    }
    if (url.startsWith(`/api/ask/threads/${TID}`) && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ thread: THREAD, messages: [], attachments: [], runLinks: rec.runLinks || [], inFlight: null }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

async function openThread(rec = {}, deps = {}) {
  const ctx = makePanel({ fetchHandler: api(rec), deps });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  ctx.flush();
  return ctx;
}
function push(ctx, bare, seqStart) {
  for (const f of stampFrames(bare, { threadId: TID, messageId: MID, seqStart })) ctx.panel.pushServerFrame(f);
  ctx.flush();
}
const START = { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' };
const card = (id, state, c, extra = {}) => ({ kind: 'card', id, state, card: c, ...extra });

test('a registered type wins over the built-in builder; the element is reused while the state holds and rebuilt (old one disposed) when it changes', async () => {
  const built = [];
  const disposed = [];
  registerChatCard('away', (block, c) => {
    const el = c.doc.createElement('div');
    el.className = 'x-away';
    el.dataset.state = block.state;
    built.push(block.state);
    return { el, dispose: () => disposed.push(block.state) };
  });
  const ctx = await openThread();
  push(ctx, [START, { type: 'ask-card', block: card('card_00000002', 'proposed', AWAY_CARD) }], 1);
  const first = ctx.doc.querySelector('.x-away');
  assert.ok(first, 'the registered builder rendered the card');
  assert.equal(ctx.doc.querySelector('.ask-awcard'), null, 'the built-in Away card did not');
  // A notice joins the row: its tail is rebuilt and the card element is reused (same state).
  push(ctx, [{ type: 'ask-block', block: { kind: 'notice', id: 'n_1', text: 'a note' } }], 3);
  assert.equal(ctx.doc.querySelector('.x-away'), first);
  push(ctx, [{ type: 'ask-card', block: card('card_00000002', 'applied', AWAY_CARD) }], 4);
  const second = ctx.doc.querySelector('.x-away');
  assert.notEqual(second, first);
  assert.equal(second.dataset.state, 'applied');
  assert.deepEqual(built, ['proposed', 'applied']);
  assert.deepEqual(disposed, ['proposed']);
});

test('`progress` takes every progress block (a track_run card and a started run proposal); another registered type never counts as one', async () => {
  const seen = [];
  registerChatCard('progress', (block, c) => { seen.push(block.id); const el = c.doc.createElement('div'); el.className = 'x-progress'; return { el }; });
  registerChatCard('receipt', (block, c) => { const el = c.doc.createElement('div'); el.className = 'x-receipt'; return { el }; });
  const ctx = await openThread();
  push(ctx, [
    START,
    { type: 'ask-card', block: card('card_00000001', 'proposed', { type: 'progress', pipelineId: 'aaaa1111', title: 'A' }) },
    { type: 'ask-card', block: card('card_00000002', 'started', { title: 'B', brief: 'b' }, { runId: '0f0f0f0f-0000-4000-8000-000000000001' }) },
    { type: 'ask-card', block: card('card_00000003', 'started', { type: 'receipt', label: 'Theme' }) },
  ], 1);
  assert.deepEqual(seen, ['card_00000001', 'card_00000002']);
  assert.equal(ctx.doc.querySelectorAll('.x-progress').length, 2);
  assert.equal(ctx.doc.querySelectorAll('.x-receipt').length, 1);
  assert.equal(ctx.doc.querySelector('.ask-rc'), null, 'the built-in progress card is not built');
});

test('the card ctx: ONE object for every card, the CONTRACT members, chatDeps read at call time', async () => {
  const seen = [];
  registerChatCard('receipt', (block, c) => { seen.push(c); return { el: c.doc.createElement('div') }; });
  const calls = [];
  const chatDeps = {
    openRunPanel: (ref, opts) => calls.push(['first', ref, opts]),
    openArtifact: (ref, artifact) => calls.push(['artifact', ref, artifact]),
  };
  const ctx = await openThread({}, { chatDeps });
  push(ctx, [START,
    { type: 'ask-card', block: card('card_00000001', 'applied', { type: 'receipt' }) },
    { type: 'ask-card', block: card('card_00000002', 'applied', { type: 'receipt' }) }], 1);
  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1], 'the same ctx object');
  const c = seen[0];
  for (const k of ['doc', 'win', 'fetch', 'threadId', 'postCard', 'confirm', 'runStore', 'openRunPanel', 'openArtifact', 'openShipIt', 'runLinkFor', 'appendToComposer', 'announce']) {
    assert.ok(k in c, `ctx.${k}`);
  }
  assert.equal(c.threadId(), TID);
  c.openRunPanel({ runId: 'r1' }, { tab: 'logs' });
  chatDeps.openRunPanel = (ref, opts) => calls.push(['swapped', ref, opts]);    // P4 replaces it after the panel exists
  c.openRunPanel({ runId: 'r1' }, {});
  c.openArtifact({ runId: 'r1' }, { relPath: 'plan.md' });
  assert.equal(c.openShipIt({ pipelineId: 'aaaa1111' }), undefined, 'no openShipIt yet: a quiet no-op');
  assert.deepEqual(calls.map((x) => x[0]), ['first', 'swapped', 'artifact']);
  assert.deepEqual(calls[0].slice(1), [{ runId: 'r1' }, { tab: 'logs' }]);
  c.appendToComposer('hello');
  assert.equal(ctx.doc.querySelector('.ask-input').value, 'hello');
  c.announce('done');
  assert.equal(ctx.doc.querySelector('.sr-only[aria-live="polite"]').textContent, 'done');
});

test('ctx.runLinkFor finds the open chat\'s run link by pipeline id, card id or run id (refreshProgressIdent\'s lookup)', async () => {
  let c = null;
  registerChatCard('receipt', (block, cc) => { c = cc; return { el: cc.doc.createElement('div') }; });
  const rec = { runLinks: [{ runId: '0f0f0f0f-0000-4000-8000-000000000001', pipelineId: 'aaaa1111', cardId: 'card_00000002', status: 'running', phase: 'plan' }] };
  const ctx = await openThread(rec);
  push(ctx, [START, { type: 'ask-card', block: card('card_00000009', 'applied', { type: 'receipt' }) }], 1);
  const want = { runId: '0f0f0f0f-0000-4000-8000-000000000001', pipelineId: 'aaaa1111' };
  assert.deepEqual(c.runLinkFor({ pipelineId: 'aaaa1111' }), want);
  assert.deepEqual(c.runLinkFor({ cardId: 'card_00000002' }), want);
  assert.deepEqual(c.runLinkFor({ runId: '0f0f0f0f-0000-4000-8000-000000000001' }), want);
  assert.equal(c.runLinkFor({ cardId: 'card_ffffffff' }), null);
  assert.equal(c.runLinkFor({}), null);
});

test('ctx.postCard POSTs the card route and resolves its body; a refusal throws with status and body', async () => {
  let c = null;
  registerChatCard('receipt', (block, cc) => { c = cc; return { el: cc.doc.createElement('div') }; });
  const rec = {};
  const ctx = await openThread(rec);
  const block = card('card_00000005', 'applied', { type: 'receipt' });
  push(ctx, [START, { type: 'ask-card', block }], 1);
  const out = await c.postCard(block, { state: 'reverted' });
  assert.deepEqual(rec.cardBodies, [{ state: 'reverted' }]);
  assert.ok(rec.calls.includes(`POST /api/ask/threads/${TID}/cards/card_00000005`));
  assert.deepEqual(out, { ok: true, echo: { state: 'reverted' } });
  rec.cardResponse = { ok: false, status: 409, json: async () => ({ error: 'Changed since — not reverted', code: 'CHANGED_SINCE' }) };
  await assert.rejects(c.postCard(block, { state: 'reverted' }),
    (e) => e.status === 409 && e.body.code === 'CHANGED_SINCE' && /Changed since/.test(e.message));
  rec.cardThrows = true;
  await assert.rejects(c.postCard(block, { state: 'reverted' }),
    (e) => e.status === 0 && e.body === null && e.message === 'network error', 'offline: the same error shape, the built-in cards\' word');
});

test('s5: ctx.postChanges POSTs the thread\'s changes route with the ref and the text; a refusal throws with status and body', async () => {
  let c = null;
  registerChatCard('receipt', (block, cc) => { c = cc; return { el: cc.doc.createElement('div') }; });
  const rec = {};
  const ctx = await openThread(rec);
  push(ctx, [START, { type: 'ask-card', block: card('card_00000006', 'applied', { type: 'receipt' }) }], 1);
  await c.postChanges({ pipelineId: 'aaaa1111' }, 'make it blue');
  assert.deepEqual(rec.changesBodies, [{ pipelineId: 'aaaa1111', text: 'make it blue' }]);
  rec.changesResponse = { ok: false, status: 409, json: async () => ({ error: 'the run is still going' }) };
  await assert.rejects(c.postChanges({ featureId: 'feat_1' }, 'x'), (e) => e.status === 409 && e.body.error === 'the run is still going');
});

test('a registered card follows a same-state change of its block: rebuilt (the old one disposed), or handed to handle.blockChanged when the handle has one', async () => {
  const built = [];
  const disposed = [];
  registerChatCard('receipt', (block, c) => {
    const el = c.doc.createElement('div');
    el.className = 'x-receipt';
    el.textContent = String(block.card.result.length);
    built.push(el.textContent);
    return { el, dispose: () => disposed.push(el.textContent) };
  });
  const seen = [];
  registerChatCard('pr', (block, c) => {
    const el = c.doc.createElement('div');
    el.className = 'x-pr';
    return { el, handle: { blockChanged: (b) => { seen.push(b.card.members.length); el.textContent = String(b.card.members.length); } } };
  });
  const ctx = await openThread();
  push(ctx, [START,
    { type: 'ask-card', block: card('card_00000001', 'applied', { type: 'receipt', result: ['a'] }) },
    { type: 'ask-card', block: card('card_00000002', 'applied', { type: 'pr', members: ['m1'] }) }], 1);
  const pr = ctx.doc.querySelector('.x-pr');
  push(ctx, [{ type: 'ask-card', block: card('card_00000001', 'applied', { type: 'receipt', result: ['a', 'b'] }) }], 4);
  assert.equal(ctx.doc.querySelector('.x-receipt').textContent, '2', 'the new payload reached the card');
  assert.deepEqual(built, ['1', '2']);
  assert.deepEqual(disposed, ['1']);
  push(ctx, [{ type: 'ask-card', block: card('card_00000002', 'applied', { type: 'pr', members: ['m1', 'm2'] }) }], 5);
  assert.equal(ctx.doc.querySelector('.x-pr'), pr, 'blockChanged absorbed it: the same element');
  assert.deepEqual(seen, [2]);
  assert.equal(pr.textContent, '2');
  push(ctx, [{ type: 'ask-block', block: { kind: 'notice', id: 'n_1', text: 'a note' } }], 6);
  assert.deepEqual(built, ['1', '2'], 'an unrelated change rebuilds nothing');
  assert.deepEqual(seen, [2]);
});

test('a registered type with no built-in card whose builder throws shows a plain stub, never the run-proposal form', async () => {
  registerChatCard('run-stop', () => { throw new Error('boom'); });
  const ctx = await openThread();
  push(ctx, [START, { type: 'ask-card', block: card('card_00000003', 'proposed', { type: 'run-stop', summary: 'Stop "Fix the login bug"' }) }], 1);
  assert.equal(ctx.doc.querySelector('[data-ask-card-start]'), null, 'no Start button');
  assert.equal(ctx.doc.querySelector('.ask-card-stub').textContent, 'Stop "Fix the login bug"');
});

test('a builder that throws falls back to the built-in card, and is not retried while the state holds', async () => {
  let n = 0;
  registerChatCard('away', () => { n += 1; throw new Error('boom'); });
  const ctx = await openThread();
  push(ctx, [START, { type: 'ask-card', block: card('card_00000002', 'proposed', AWAY_CARD) }], 1);
  const el = ctx.doc.querySelector('.ask-card.ask-awcard');
  assert.ok(el, 'the built-in Away card');
  push(ctx, [{ type: 'ask-block', block: { kind: 'notice', id: 'n_1', text: 'a note' } }], 3);
  assert.equal(n, 1);
  assert.equal(ctx.doc.querySelector('.ask-card.ask-awcard'), el);
});

test('composer add-ons: mounted once into the lead row with the CONTRACT ctx, update(thread) on renders, beforeSend true takes the send', async () => {
  const log = [];
  let actx = null;
  let lead = null;
  let take = true;
  let mounts = 0;
  registerComposerAddon({
    id: 'probe',
    mount(leadEl, c) {
      mounts += 1;
      lead = leadEl;
      actx = c;
      const chip = c.doc.createElement('button');
      chip.className = 'x-chip';
      leadEl.appendChild(chip);
      return {
        update: (thread) => log.push(['update', thread ? thread.id : null]),
        beforeSend: async (text) => { log.push(['send', text]); return take; },
        destroy: () => log.push(['destroy']),
      };
    },
  });
  const rec = {};
  const ctx = await openThread(rec);
  assert.equal(mounts, 1);
  assert.ok(lead && lead.matches('.ask-composer-box > [data-chat-composer-lead].chat-composer-lead'));
  assert.ok(lead.querySelector('.x-chip'));
  for (const k of ['doc', 'fetch', 'threadId', 'thread', 'runStore', 'setPlaceholder', 'focus', 'announce']) assert.ok(k in actx, `ctx.${k}`);
  assert.equal(actx.threadId(), TID);
  assert.equal(actx.thread().id, TID);
  assert.deepEqual(actx.thread().runLinks, []);
  assert.equal(actx.thread().live, false);
  assert.ok(log.some(([k, id]) => k === 'update' && id === TID), 'update(thread) ran on a render');
  const input = ctx.doc.querySelector('.ask-input');
  actx.setPlaceholder('Tell the run what to change');
  assert.equal(input.placeholder, 'Tell the run what to change');
  actx.setPlaceholder(null);
  assert.equal(input.placeholder, 'Ask about any run, agent, or project…');
  input.value = 'go left';
  ctx.doc.querySelector('.ask-send').click();
  await ctx.tick(); await ctx.tick();
  assert.deepEqual(log.filter(([k]) => k === 'send'), [['send', 'go left']]);
  assert.equal(input.value, '', 'a taken send clears the input');
  assert.ok(!rec.calls.some((x) => x.endsWith('/messages')), 'and no Ask turn starts');
  take = 'keep';                                                          // handled, but the input stays (a refusal)
  input.value = 'go right';
  ctx.doc.querySelector('.ask-send').click();
  await ctx.tick(); await ctx.tick();
  assert.equal(input.value, 'go right', "'keep': the text stays for another try");
  assert.ok(!rec.calls.some((x) => x.endsWith('/messages')), "'keep' starts no Ask turn either");
  take = 'yes';                                                           // anything but true / 'keep' is not handled
  input.value = 'hello';
  ctx.doc.querySelector('.ask-send').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.ok(rec.calls.includes(`POST /api/ask/threads/${TID}/messages`), 'false: the Ask send goes ahead');
  ctx.panel.destroy();
  assert.deepEqual(log.at(-1), ['destroy']);
});

test('transformSend (lead amendment): when no add-on takes the send, the add-ons reword it in registration order; a throw, a non-string or an empty result keeps the text; the reworded text is sent and shown', async () => {
  registerComposerAddon({ id: 'intent', mount: () => ({ transformSend: (t) => `Start a run: ${t}` }) });
  registerComposerAddon({ id: 'broken', mount: () => ({ transformSend: () => { throw new Error('boom'); } }) });
  registerComposerAddon({ id: 'number', mount: () => ({ transformSend: () => 42 }) });
  registerComposerAddon({ id: 'empty', mount: () => ({ transformSend: () => '   ' }) });
  registerComposerAddon({ id: 'suffix', mount: () => ({ beforeSend: () => false, transformSend: (t) => `${t} (worca-cc)` }) });
  const rec = {};
  const ctx = await openThread(rec);
  const input = ctx.doc.querySelector('.ask-input');
  input.value = 'fix the flaky upload test';
  ctx.doc.querySelector('.ask-send').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  ctx.flush();
  assert.equal(rec.messageBodies.at(-1).text, 'Start a run: fix the flaky upload test (worca-cc)');
  assert.equal(ctx.doc.querySelector('.ask-user-bubble').textContent, 'Start a run: fix the flaky upload test (worca-cc)', 'the bubble shows what was sent');
  assert.equal(input.value, '');
});

test('transformSend runs only for a send that goes ahead: never while a reply streams', async () => {
  let n = 0;
  registerComposerAddon({ id: 'intent', mount: () => ({ transformSend: (t) => { n += 1; return `Start a run: ${t}`; } }) });
  const rec = {};
  const ctx = await openThread(rec);
  push(ctx, [START, { type: 'ask-delta', text: 'thinking' }], 1);
  const input = ctx.doc.querySelector('.ask-input');
  input.value = 'fix the flaky upload test';
  ctx.doc.querySelector('.ask-send').click();
  await ctx.tick(); await ctx.tick();
  assert.equal(n, 0, 'queued under a streaming reply: nothing reworded yet (the reword runs when the queue sends it)');
  assert.ok(!(rec.calls || []).some((x) => x.endsWith('/messages')), 'and nothing sent');
  assert.equal(input.value, '', 'the draft moved into the queue');
  assert.deepEqual([...ctx.doc.querySelectorAll('[data-ask-queue-item] .ask-queue-text')].map((b) => b.textContent), ['fix the flaky upload test']);
});

test('New chat hands the add-ons the empty chat at once (update(null)), before any render', async () => {
  const seen = [];
  registerComposerAddon({ id: 'probe', mount: () => ({ update: (thread) => seen.push(thread ? thread.id : null) }) });
  const ctx = await openThread();
  assert.equal(seen.at(-1), TID);
  ctx.doc.querySelector('.chat-head [data-ask-new-btn]').click();
  assert.equal(seen.at(-1), null, 'the add-ons see the new (empty) chat');
});
