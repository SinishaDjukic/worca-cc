// test/ask-panel-extensions.test.mjs — worca Chat CONTRACT §2 inside the Ask panel: a registered card builder wins
// over the built-in one (cache + rebuild rule, the progress family, a throwing builder falls back once), the ONE card
// ctx (chatDeps read at call time, postCard), and composer add-ons (lead row, update per render, beforeSend).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';
import { registerChatCard, registerComposerAddon, _resetChatExtensions } from '../ui/public/chat/extensions.mjs';
import { installIntentAddon } from '../ui/public/chat/intent.mjs';
import { _resetAnswerer } from '../ui/public/answerer.mjs';
import { INTENT_LEADS } from '../src/shared/intent-leads.mjs';

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

// The composer's role picker (ui/public/chat/role-picker.mjs) in the real panel, registered after the intent chip as
// app.js does, on a new chat's home (where a Shaper pin lives). It uses the app's own profile loader and saver, so
// every /api/answerer request, from the panel's fetch or the page's, is recorded.
const SHAPER_TEXT = 'Uploads fail on large files';

const GUIDE_READ = Object.freeze({ model: { id: 'claude-haiku-5-5', label: 'Haiku 5.5' }, on: true, offerSeen: false, rowsOpen: false });
// The Guide switch and line (ui/public/chat/guide-line.mjs) are registered after the picker; their requests are recorded.
async function composer(t, { lead = null, flag = true, picker = true, guide = picker, pin = 'shape' } = {}) {
  _resetChatExtensions();
  _resetAnswerer();
  const rec = {};
  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requests.push(`${init?.method || 'GET'} ${url}`);
    return { ok: true, status: 200, json: async () => ({ lead }) };
  };
  t.after(() => { globalThis.fetch = realFetch; _resetAnswerer(); });
  const intent = installIntentAddon();
  if (picker) {
    const { installRolePicker } = await import('../ui/public/chat/role-picker.mjs');
    installRolePicker({ intent, flagOn: () => flag, onFlagChange: () => () => {} });
  }
  if (guide) {
    const { installGuideLine, loadGuide, saveGuidePrefs } = await import('../ui/public/chat/guide-line.mjs');
    const record = async (url, init) => {
      requests.push(`${init?.method || 'GET'} ${url}`);
      return { ok: true, status: 200, json: async () => ({ ...GUIDE_READ }) };
    };
    installGuideLine({ intent, flagOn: () => flag, onFlagChange: () => () => {}, load: () => loadGuide(record), save: (patch) => saveGuidePrefs(patch, record) });
  }
  const panelApi = api(rec);
  const ctx = makePanel({
    fetchHandler: (url, opts) => {
      requests.push(`${(opts.method || 'GET').toUpperCase()} ${url}`);
      if (url === '/api/ask/threads' && opts.method === 'POST') return { ok: true, status: 201, json: async () => ({ thread: THREAD }) };
      return panelApi(url, opts);
    },
  });
  const settle = async () => { for (let i = 0; i < 4; i += 1) await ctx.tick(); ctx.flush(); };
  ctx.panel.open();
  await settle();
  if (pin) intent.set(pin, { focus: false });
  await settle();
  const lead0 = ctx.doc.querySelector('[data-chat-composer-lead]');
  const send = async (text) => {
    const input = ctx.doc.querySelector('.ask-input');
    input.value = text;
    input.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
    assert.equal(ctx.doc.querySelector('.ask-send').disabled, false, 'Send is enabled with text');
    const leadHtml = lead0.innerHTML;
    ctx.doc.querySelector('.ask-send').click();
    await settle();
    return leadHtml;
  };
  return { ...ctx, rec, requests, intent, lead: lead0, send, settle };
}

for (const [row, saved, want] of [
  ['a role picked', 'compliance', `${INTENT_LEADS.shape}\n\nAsking as: compliance.\n\n${SHAPER_TEXT}`],
  ['no role', null, `${INTENT_LEADS.shape}\n\n${SHAPER_TEXT}`],
]) {
  test(`R-qa-13: a Shaper send with ${row} goes out exactly once, writes no profile and shows only the person's words`, async (t) => {
    const c = await composer(t, { lead: saved });
    const picker = c.lead.querySelector('.ask-asker-pick');
    assert.ok(picker, 'the picker is in the lead row');
    assert.equal(picker.previousElementSibling, c.lead.querySelector('.chat-intent'));
    assert.equal(picker.querySelector('.ask-asker-l').textContent, saved ? 'Compliance' : 'Your role');
    await c.send(SHAPER_TEXT);
    assert.equal(c.rec.messageBodies?.length, 1, 'exactly one message');
    assert.equal(c.rec.messageBodies[0].text, want);
    assert.deepEqual(c.requests.filter((r) => r.includes('/api/answerer')), ['GET /api/answerer'], 'the send writes no profile');
    assert.equal(c.doc.querySelector('.ask-user-bubble').textContent, SHAPER_TEXT);
    assert.ok(c.doc.querySelector('.ask-user-intent'), 'the Shaper chip on the bubble');
    assert.doesNotMatch(c.panel.root.textContent, /Asking as:/);
  });
}

test('R-arch-1 example: an ordinary chat with the flag on and no Shaper pin shows no picker, no switch, no line and asks for nothing', async (t) => {
  const c = await composer(t, { lead: 'qa', pin: null });
  assert.equal(c.lead.childElementCount, 0);
  await c.send('why did the last run fail?');
  assert.equal(c.doc.querySelector('.ask-asker-pick'), null);
  assert.equal(c.doc.querySelector('.ask-guide, .ask-guide-sw, .chat-composer-lead [role="switch"]'), null);
  assert.deepEqual(c.requests.filter((r) => /answerer|guide/i.test(r)), []);
  assert.equal(c.rec.messageBodies.at(-1).text, 'why did the last run fail?');
});

test('R-arch-1: with the flag off, even with the Shaper pin, the lead row, the requests and the sent text are as without the picker', async (t) => {
  const walk = async (picker) => {
    const c = await composer(t, { lead: 'qa', flag: false, picker });
    const leadHtml = await c.send(SHAPER_TEXT);
    return { leadHtml, requests: c.requests, text: c.rec.messageBodies.at(-1).text, pickers: c.doc.querySelectorAll('.ask-asker-pick').length,
      guide: c.doc.querySelectorAll('.ask-guide, .ask-guide-sw').length };
  };
  const without = await walk(false);
  const withPicker = await walk(true);
  assert.deepEqual(withPicker, without);
  assert.equal(withPicker.pickers, 0);
  assert.equal(withPicker.text, `${INTENT_LEADS.shape}\n\n${SHAPER_TEXT}`);
});

const barHtml = (c) => c.doc.querySelector('.ask-composer-row[data-bar="compact"]').outerHTML;
/** The side column takes the one chat page, as app.js moves it. */
async function dock(c) {
  const host = c.doc.createElement('div');
  c.doc.body.appendChild(host);
  host.appendChild(c.panel.root);
  c.panel.setHost('dock');
  await c.settle();
}
const guideReads = (c) => c.requests.filter((r) => r === 'GET /api/shape/guide').length;

test('R-ux-1: flag on with the Shaper pin, main and docked: pin, picker, switch and one line, the bar unchanged, one Guide read', async (t) => {
  const barWithout = barHtml(await composer(t, { guide: false }));
  const c = await composer(t, {});
  const check = (where) => {
    assert.equal(c.intent.current(), 'shape', where);
    const kids = [...c.lead.children];
    assert.equal(kids.length, 3, `${where}: pin, picker, switch`);
    assert.ok(kids[0].matches('.chat-intent') && kids[1].matches('.ask-asker-pick') && kids[2].matches('.ask-guide-sw'), `${where}: in that order`);
    const lines = c.doc.querySelectorAll('.ask-guide');
    assert.equal(lines.length, 1, `${where}: one line`);
    assert.ok(lines[0].previousElementSibling.matches('.ask-composer-msg'), `${where}: after the field and its message`);
    assert.ok(lines[0].nextElementSibling.matches('.ask-composer-row[data-bar="compact"]'), `${where}: right before the bar`);
    assert.equal(guideReads(c), 1, `${where}: one read`);
  };
  check('main');
  assert.equal(barHtml(c), barWithout, 'the bar is as without the slice');
  await dock(c);
  check('docked');
  await c.send(SHAPER_TEXT);
  assert.equal(c.rec.messageBodies.length, 1, 'Guide never holds a send');
  assert.equal(c.rec.messageBodies[0].text, `${INTENT_LEADS.shape}\n\n${SHAPER_TEXT}`);
  assert.deepEqual(c.requests.filter((r) => r.includes('/guide/')), ['PUT /api/shape/guide/prefs'], 'only the offer-seen save');
});

test('R-arch-1: with the flag off the docked composer with the Shaper pin has no switch, no line and no Guide request', async (t) => {
  const c = await composer(t, { flag: false });
  await dock(c);
  await c.send(SHAPER_TEXT);
  assert.equal(c.doc.querySelector('.ask-guide, .ask-guide-sw'), null);
  assert.deepEqual(c.requests.filter((r) => /guide/i.test(r)), []);
});
