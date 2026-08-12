// test/chat-command-router.test.mjs — inbound command router against a fake
// actions capability object (chat-connectivity-design.md §4.6): allowlist
// deny-by-default, wildcard run resolution + disambiguation, approval payload
// mapping onto orch.answer shapes, ordinal validation, muting, project scoping.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { createChatContext } from '../src/core/chat/chat-context.mjs';
import { createCommandRouter, parseDuration, statusEmoji } from '../src/core/chat/command-router.mjs';

useTempHome(after);

const CONFIG = { allowedChatIds: '42, 77' };

function fixture() {
  const calls = [];
  const state = {
    live: [
      { runId: 'run-aaaa1111', pipelineId: 'pipe-aaaa1111', title: 'Fix login', status: 'running', kind: 'run', projectDir: '/x/worca' },
    ],
    rows: [
      { id: 'pipe-bbbb2222', title: 'Old run', status: 'done', total_cost_usd: 2.5, total_active_ms: 60000 },
      { id: 'pipe-cccc3333', title: 'Paused run', status: 'paused', total_cost_usd: 1, pause_reason: 'cost_pipeline' },
    ],
    pending: {},
    states: { 'run-aaaa1111': { phase: 'implement', totalCostUsd: 0.42, steps: [{ status: 'done' }, { status: 'running' }] } },
  };
  const actions = {
    listRuns: () => state.live,
    runState: (id) => state.states[id] ?? null,
    pendingQuestion: (id) => state.pending[id] ?? null,
    answer: async (runId, id, payload) => calls.push(['answer', runId, id, payload]),
    stop: async (runId) => calls.push(['stop', runId]),
    pause: async (runId) => calls.push(['pause', runId]),
    resume: async (pipelineId) => { calls.push(['resume', pipelineId]); return { ok: true }; },
    history: async () => state.rows,
    listProjects: async () => [{ name: 'worca', path: '/x/worca' }, { name: 'other', path: '/x/other' }],
  };
  const chatContext = createChatContext(join(worcaHome(), `chat-context-${Math.random().toString(36).slice(2)}.json`));
  const router = createCommandRouter({ actions, chatContext, logger: () => {} });
  const send = (text, chatId = '42') => router.handleIncoming({
    plugin: 'p', channelId: 'main', platform: 'testchat',
    channelConfig: CONFIG, msg: { chatId, userId: 'u1', text, meta: {} },
  });
  return { send, calls, state, chatContext };
}

const text = (msg) => msg.body.map((s) => s.value).join('\n');

test('allowlist: deny-by-default silent; unknown commands get a hint; non-commands ignored', async () => {
  const { send } = fixture();
  assert.equal(await send('/status', '999'), null, 'not allow-listed -> silent drop');
  const emptyRouter = createCommandRouter({
    actions: { listRuns: () => [] }, chatContext: createChatContext(join(worcaHome(), 'cc-e.json')), logger: () => {},
  });
  assert.equal(await emptyRouter.handleIncoming({
    plugin: 'p', channelId: 'main', platform: 't', channelConfig: {}, msg: { chatId: '1', userId: 'u', text: '/status' },
  }), null, 'EMPTY allowedChatIds denies everyone (fail closed)');
  const unknown = await send('/frobnicate');
  assert.match(text(unknown), /Unknown command/);
  assert.equal(await send('just chatting'), null);
});

test('/help /whoami /projects reply; /runs lists live; /last reads history', async () => {
  const { send } = fixture();
  assert.match(text(await send('/help')), /worca-cc chat commands/);
  assert.match(text(await send('/whoami')), /chat: `42`/);
  assert.match(text(await send('/projects')), /worca[\s\S]*other/);
  const runsMsg = text(await send('/runs'));
  assert.match(runsMsg, /🟢 `\*1111` running — Fix login/);
  const last = text(await send('/last'));
  assert.match(last, /`\*2222`/);
  assert.match(last, /\$2\.50/);
});

test('/status: no-arg single-active default, wildcard suffix, history fallback, pending hint', async () => {
  const { send, state } = fixture();
  const noArg = text(await send('/status'));
  assert.match(noArg, /Fix login/);
  assert.match(noArg, /\*\*Steps:\*\* 1\/2 done · \*\*Phase:\*\* implement/);
  assert.match(noArg, /\$0\.42/);

  const hist = text(await send('/status *2222'));
  assert.match(hist, /✅ `\*2222` done — Old run/);

  const paused = text(await send('/status *3333'));
  assert.match(paused, /Pause reason:.*cost_pipeline/);

  assert.match(text(await send('/status *zzzz')), /No run matches/);

  state.pending['run-aaaa1111'] = { id: 'gate-1', kind: 'gate' };
  assert.match(text(await send('/status *1111')), /waiting on you/);
});

test('disambiguation when a suffix matches several runs', async () => {
  const { send, state } = fixture();
  state.live.push({ runId: 'run-xyz1111', pipelineId: 'pipe-x', title: 'Second', status: 'running', kind: 'run', projectDir: '/x/other' });
  const msg = text(await send('/status *1111'));
  assert.match(msg, /Ambiguous/);
  assert.match(msg, /Fix login[\s\S]*Second/);
});

test('control: /pause /stop live-only; /resume resolves paused history rows', async () => {
  const { send, calls } = fixture();
  await send('/pause *1111');
  await send('/stop');
  assert.deepEqual(calls.filter((c) => c[0] !== 'answer'), [['pause', 'run-aaaa1111'], ['stop', 'run-aaaa1111']]);
  assert.match(text(await send('/pause *2222')), /No live run matches/, 'history rows are not pausable');

  const resumed = text(await send('/resume *3333'));
  assert.match(resumed, /Resuming `\*3333`/);
  assert.deepEqual(calls.at(-1), ['resume', 'pipe-cccc3333']);
  const single = text(await send('/resume'));
  assert.match(single, /Resuming `\*3333`/, 'single paused row is the no-arg default');
});

test('approvals: gate continue/another, recovery retry/abort, guardrails between kinds', async () => {
  const { send, calls, state } = fixture();
  assert.match(text(await send('/approve')), /not waiting on a decision/);

  state.pending['run-aaaa1111'] = { id: 'gate-9', kind: 'gate' };
  await send('/approve');
  assert.deepEqual(calls.at(-1), ['answer', 'run-aaaa1111', 'gate-9', { decision: 'continue' }]);
  await send('/retry *1111');
  assert.deepEqual(calls.at(-1), ['answer', 'run-aaaa1111', 'gate-9', { decision: 'another' }]);
  assert.match(text(await send('/abort')), /Gates have no abort/);

  state.pending['run-aaaa1111'] = { id: 'rec-1', kind: 'recovery' };
  await send('/approve');
  assert.deepEqual(calls.at(-1), ['answer', 'run-aaaa1111', 'rec-1', { decision: 'retry' }]);
  await send('/abort');
  assert.deepEqual(calls.at(-1), ['answer', 'run-aaaa1111', 'rec-1', { decision: 'abort' }]);
});

test('/answer: ordinal validation and clarify payload mapping', async () => {
  const { send, calls, state } = fixture();
  state.pending['run-aaaa1111'] = {
    id: 'clarify-1', kind: 'clarify',
    questions: [
      { id: 'q1', question: 'Backend?', options: ['sqlite', 'postgres'] },
      { id: 'q2', question: 'Telemetry?', options: ['yes', 'no'] },
    ],
  };
  assert.match(text(await send('/answer')), /Need exactly 2 option numbers/);
  assert.match(text(await send('/answer *1111 1')), /Need exactly 2/);
  assert.match(text(await send('/answer 1 9')), /Q2 has options 1–2; got 9/);
  await send('/answer *1111 2 1');
  assert.deepEqual(calls.at(-1), ['answer', 'run-aaaa1111', 'clarify-1', {
    answers: [{ id: 'q1', choice: 'postgres' }, { id: 'q2', choice: 'yes' }],
  }]);
  state.pending['run-aaaa1111'] = { id: 'gate-1', kind: 'gate' };
  assert.match(text(await send('/answer 1')), /use `\/approve` or `\/retry`/);
});

test('/mute /unmute persist per chat; /use scopes /runs', async () => {
  const { send, chatContext } = fixture();
  assert.match(text(await send('/mute 30m')), /muted for 30m/);
  assert.equal(chatContext.isMuted('testchat:42'), true);
  assert.equal(chatContext.isMuted('testchat:77'), false, 'mute is per-chat');
  assert.match(text(await send('/unmute')), /back on/);
  assert.equal(chatContext.isMuted('testchat:42'), false);
  assert.match(text(await send('/mute forever')), /Usage/);

  assert.match(text(await send('/use nope')), /Unknown project/);
  await send('/use other');
  assert.match(text(await send('/runs')), /No live runs/, 'scoped away from the only live run');
  await send('/use -');
  assert.match(text(await send('/runs')), /Fix login/);
});

test('parseDuration + statusEmoji helpers', () => {
  assert.equal(parseDuration('30m'), 1800000);
  assert.equal(parseDuration('2h'), 7200000);
  assert.equal(parseDuration('1d'), 86400000);
  assert.equal(parseDuration('soon'), null);
  assert.equal(statusEmoji('running'), '🟢');
  assert.equal(statusEmoji('error'), '🔴');
  assert.equal(statusEmoji('weird'), '⚪');
});

test('handler exceptions become error replies, never throws', async () => {
  const chatContext = createChatContext(join(worcaHome(), 'cc-x.json'));
  const router = createCommandRouter({
    actions: {
      listRuns: () => { throw new Error('db exploded'); },
    },
    chatContext,
    logger: () => {},
  });
  const msg = await router.handleIncoming({
    plugin: 'p', channelId: 'main', platform: 't',
    channelConfig: { allowedChatIds: '1' }, msg: { chatId: '1', userId: 'u', text: '/runs' },
  });
  assert.equal(msg.severity, 'error');
  assert.match(text(msg), /Command failed: db exploded/);
});
