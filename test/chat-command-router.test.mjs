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
import { createCommandRouter } from '../src/core/chat/command-router.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);

const CONFIG = { allowedChatIds: '42, 77' };

function fixture(overrideActions = {}) {
  const calls = [];
  const state = {
    live: [
      { runId: 'run-aaaa1111', pipelineId: 'pipe-aaaa1111', title: 'Fix login', status: 'running', kind: 'run', projectDir: '/x/worca' },
    ],
    // History rows carry the camelCase shape rowToHistoryEntry emits
    // (src/core/artifacts.mjs), not the raw snake_case DB columns.
    rows: [
      { id: 'pipe-bbbb2222', title: 'Old run', status: 'done', totalCostUsd: 2.5, totalActiveMs: 60000 },
      { id: 'pipe-cccc3333', title: 'Paused run', status: 'paused', totalCostUsd: 1, pauseReason: 'cost_pipeline' },
    ],
    pending: {},
    states: { 'run-aaaa1111': {
      totalCostUsd: 0.42,
      // The two BOOKEND rows must not be counted: `x:` cannot be the filter,
      // because every v2 executionId starts with it.
      steps: [
        { key: 'x:preflight:1', status: 'done' },
        { key: 'x:n_plan:1', status: 'done' },
        { key: 'x:n_impl:1', status: 'running' },
        { key: 'x:done:1', status: 'done' },
      ],
      active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:1' }],
      stepper: { version: 2, graph: { nodes: [
        { id: 'n_plan', label: 'Plan' }, { id: 'n_impl', label: 'Implementation' },
      ], wires: [] } },
    } },
  };
  const actions = {
    listRuns: () => state.live,
    runState: (id) => state.states[id] ?? null,
    pendingQuestion: (id) => state.pending[id] ?? null,
    answer: async (runId, id, payload) => calls.push(['answer', runId, id, payload]),
    stop: async (runId) => calls.push(['stop', runId]),
    pause: async (runId) => calls.push(['pause', runId]),
    stopPaused: async (pipelineId) => { calls.push(['stopPaused', pipelineId]); return { ok: true, pipelineId, status: 'stopped' }; },
    resume: async (pipelineId) => { calls.push(['resume', pipelineId]); return { ok: true }; },
    history: async () => state.rows,
    listProjects: async () => [{ name: 'worca', path: '/x/worca' }, { name: 'other', path: '/x/other' }],
    ...overrideActions,
  };
  const chatContext = createChatContext(join(worcaHome(), `chat-context-${Math.random().toString(36).slice(2)}.json`));
  const router = createCommandRouter({ actions, chatContext, logger: () => {} });
  const send = (text, chatId = '42') => router.handleIncoming({
    plugin: 'p', channelId: 'main', platform: 'testchat',
    channelConfig: CONFIG, msg: { chatId, userId: 'u1', text, meta: {} },
  });
  return { send, calls, state, chatContext };
}

const makeRouter = (overrideActions = {}) => fixture(overrideActions);
const handle = (f, text, chatId = '42') => f.send(text, chatId);
const liveOne = () => [{ runId: 'r-ab12', title: 'Live', status: 'running' }];

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
  assert.match(text(await send('/help')), /Worca chat commands/);
  assert.match(text(await send('/whoami')), /chat: `42`/);
  assert.match(text(await send('/projects')), /worca[\s\S]*other/);
  const runsMsg = text(await send('/runs'));
  assert.match(runsMsg, /🟢 `\*1111` running — Fix login/);
  const last = text(await send('/last'));
  assert.match(last, /`\*2222`/);
  assert.match(last, /\$2\.50/);
});

test('/cost and /last read the real camelCase history-entry fields', async () => {
  const f = makeRouter({ history: async () => [{ id: 'p-1234', title: 'T', status: 'done', totalCostUsd: 2.5, totalActiveMs: 61000, pauseReason: null }] });
  const cost = await handle(f, '/cost *1234');
  assert.match(cost.body[0].value, /\$2\.50/);
  const last = await handle(f, '/last');
  assert.match(last.body[0].value, /\$2\.50/);
  assert.match(last.body[0].value, /1m01s/);
});

test('a Cursor run reads "cost unknown" on /cost, /last and /status, never $0.00', async () => {
  const f = makeRouter({ history: async () => [{ id: 'p-5678', title: 'C', status: 'done', runEngine: 'cursor', totalCostUsd: 0, totalActiveMs: 1000 }] });
  assert.match((await handle(f, '/cost *5678')).body[0].value, /cost: cost unknown$/);
  assert.match((await handle(f, '/last')).body[0].value, /\*\*Cost:\*\* cost unknown/);
  assert.match((await handle(f, '/status *5678')).body[0].value, /\*\*Cost:\*\* cost unknown/);
  const helper = makeRouter({ history: async () => [{ id: 'p-5678', title: 'C', status: 'done', runEngine: 'cursor', totalCostUsd: 0.2 }] });
  assert.match((await handle(helper, '/cost *5678')).body[0].value, /cost unknown \(worca's own calls: \$0\.20\)/);
  const { send, state } = fixture();
  state.states['run-aaaa1111'].runEngine = 'cursor';
  state.states['run-aaaa1111'].totalCostUsd = 0;
  assert.match(text(await send('/status')), /\*\*Cost:\*\* cost unknown/);
  assert.match(text(await send('/cost')), /cost so far: cost unknown/);
});

test('/status: no-arg single-active default, wildcard suffix, history fallback, pending hint', async () => {
  const { send, state } = fixture();
  const noArg = text(await send('/status'));
  assert.match(noArg, /Fix login/);
  // The v1 `**Phase:**` scalar is gone: the line counts EXECUTIONS (bookends
  // excluded by name — every v2 executionId starts `x:`) and names the ACTIVE
  // node from the manifest.
  assert.match(noArg, /\*\*Executions:\*\* 1\/2 done · \*\*Active:\*\* Implementation/);
  assert.match(noArg, /\$0\.42/);

  const hist = text(await send('/status *2222'));
  assert.match(hist, /✅ `\*2222` done — Old run/);

  const paused = text(await send('/status *3333'));
  assert.match(paused, /Pause reason:.*pipeline cost limit reached/);

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

test('/stop *ref reaches a PAUSED run (History row or a run this server holds) by explicit ref only; interrupted points at /resume', async () => {
  const { send, calls, state } = fixture();
  state.rows.push({ id: 'pipe-dddd4444', title: 'Crashed run', status: 'interrupted' });
  const stopped = text(await send('/stop *3333'));
  assert.match(stopped, /Stopped `\*3333`/);
  assert.deepEqual(calls.at(-1), ['stopPaused', 'pipe-cccc3333']);
  const crashed = text(await send('/stop *4444'));
  assert.match(crashed, /interrupted — it stays resumable: `\/resume \*4444`/);
  assert.ok(!calls.some((c) => c[0] === 'stopPaused' && c[1] === 'pipe-dddd4444'), 'an interrupted run is never stopped');
  assert.match(text(await send('/stop *2222')), /No live run matches/, 'a done row is still refused');
  // A paused run this server holds: `/runs` prints its RUN ref — that ref stops it too.
  state.live.push({ runId: 'run-eeee5555', pipelineId: 'pipe-ffff6666', title: 'Parked here', status: 'paused', kind: 'run', projectDir: '/x/worca' });
  assert.match(text(await send('/stop *5555')), /Stopped `\*6666`/);
  assert.deepEqual(calls.at(-1), ['stopPaused', 'pipe-ffff6666']);
  const before = calls.length;
  await send('/stop');
  assert.deepEqual(calls.slice(before), [['stop', 'run-aaaa1111']], 'a bare /stop never reaches past the live runs');
  // `/stop *` is a bare /stop, and a ref two live runs match gets the choice: neither
  // ever falls through to stopping a paused run for good.
  state.live.length = 0;
  const quiet = calls.length;
  assert.match(text(await send('/stop *')), /No live runs/);
  state.live.push(
    { runId: 'run-gggg3333', pipelineId: 'pipe-gggg3333', title: 'Live A', status: 'running', kind: 'run', projectDir: '/x/worca' },
    { runId: 'run-hhhh3333', pipelineId: 'pipe-hhhh3333', title: 'Live B', status: 'running', kind: 'run', projectDir: '/x/worca' },
  );
  assert.match(text(await send('/stop *3333')), /Ambiguous/);
  assert.deepEqual(calls.slice(quiet), [], 'nothing was stopped');
  // `/use <project>` scopes the paused History rows too: another project's run is out of reach.
  state.rows.push({ id: 'pipe-kkkk9999', title: 'Other project', status: 'paused', projectDir: '/x/other' });
  await send('/use worca');
  assert.match(text(await send('/stop *9999')), /No live run/);
  assert.deepEqual(calls.slice(quiet), [], 'out of scope: nothing was stopped');
  // …while the project's own paused rows stay in reach: its single-project runs, and a workspace run it is a member of.
  state.rows.push(
    { id: 'pipe-mmmm8888', title: 'Same project', status: 'paused', projectDir: '/x/worca' },
    { id: 'pipe-wwww7777', title: 'Workspace run', status: 'paused', projectDir: '/x/other', projectNames: ['other', 'worca'] },
  );
  assert.match(text(await send('/stop *8888')), /Stopped `\*8888`/);
  assert.match(text(await send('/stop *7777')), /Stopped `\*7777`/);
  assert.deepEqual(calls.slice(quiet), [['stopPaused', 'pipe-mmmm8888'], ['stopPaused', 'pipe-wwww7777']]);
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
  assert.deepEqual(calls.at(-1), ['answer', 'run-aaaa1111', 'rec-1', { decision: 'pause' }]);
});

test('/status on a paused history row labels the reason: error -> **Error:**, recoverable/usage_limit -> **Cause:**', async () => {
  await checkRows([
    { name: '/status on an error-paused history row prints the error detail', run: async () => {
      const { send, state } = fixture();
      state.rows.push({ id: 'pipe-dddd4444', title: 'Blew up', status: 'paused', totalCostUsd: 0.5,
        pauseReason: 'error', pauseDetail: 'claude exited with code 1: disk full' });
      const out = text(await send('/status *4444'));
      assert.match(out, /Pause reason:.*a step failed/);
      assert.match(out, /\*\*Error:\*\* claude exited with code 1: disk full/);
    } },
    { name: '/status on a recoverable- or limit-paused row labels the reason and calls the detail a cause', run: async () => {
      const { send, state } = fixture();
      state.rows.push({ id: 'pipe-eeee5555', title: 'Logged out', status: 'paused', totalCostUsd: 0.1,
        pauseReason: 'recoverable', pauseDetail: 'auth: API Error: 401' });
      state.rows.push({ id: 'pipe-ffff6666', title: 'Capped', status: 'paused', totalCostUsd: 0.1,
        pauseReason: 'usage_limit', pauseDetail: "You've hit your session limit · resets 6pm" });
      const rec = text(await send('/status *5555'));
      assert.match(rec, /Pause reason:.*recoverable error/);
      assert.match(rec, /\*\*Cause:\*\* auth: API Error: 401/);
      assert.doesNotMatch(rec, /\*\*Error:\*\*/);
      const lim = text(await send('/status *6666'));
      assert.match(lim, /Pause reason:.*session\/usage limit reached/);
      assert.match(lim, /\*\*Cause:\*\* You've hit your session limit/);
    } },
  ]);
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
  assert.match(text(await send('/answer')), /Need 2 answers/);
  assert.match(text(await send('/answer *1111 1')), /Need 2 answers/);
  assert.match(text(await send('/answer 1 9')), /Q2 has options 1–2; got 9/);
  await send('/answer *1111 2 1');
  assert.deepEqual(calls.at(-1), ['answer', 'run-aaaa1111', 'clarify-1', {
    answers: [{ id: 'q1', choice: 'postgres' }, { id: 'q2', choice: 'yes' }],
  }]);
  state.pending['run-aaaa1111'] = { id: 'gate-1', kind: 'gate' };
  assert.match(text(await send('/answer 1')), /use `\/approve` or `\/retry`/);
});

test('/answer free text: zero-option question, ordinal | text mix, literal | in a single answer', async () => {
  await checkRows([
    { name: '/answer answers a zero-option free-text question', run: async () => {
      const pq = { id: 'q1', kind: 'clarify', questions: [{ id: 'k', question: 'Name?', options: [] }] };
      const answered = [];
      const f = makeRouter({ pendingQuestion: () => pq, answer: (r, id, p) => answered.push(p), listRuns: liveOne });
      const out = await handle(f, '/answer call it worca');
      assert.deepEqual(answered, [{ answers: [{ id: 'k', choice: 'call it worca' }] }]);
      assert.match(out.body[0].value, /Answered 1 question/);
    } },
    { name: '/answer mixes ordinals and free text with the pipe separator', run: async () => {
      const pq = { id: 'q1', kind: 'clarify', questions: [
        { id: 'a', question: 'Pick', options: ['x', 'y'] },
        { id: 'b', question: 'Describe', options: [] },
      ] };
      const answered = [];
      const f = makeRouter({ pendingQuestion: () => pq, answer: (r, id, p) => answered.push(p), listRuns: liveOne });
      await handle(f, '/answer 2 | free text here');
      assert.deepEqual(answered[0].answers, [{ id: 'a', choice: 'y' }, { id: 'b', choice: 'free text here' }]);
    } },
    { name: 'a single free-text answer containing a literal | is taken verbatim', run: async () => {
      const pq = { id: 'q1', kind: 'clarify', questions: [{ id: 'k', question: 'Pattern?', options: [] }] };
      const answered = [];
      const f = makeRouter({ pendingQuestion: () => pq, answer: (r, id, p) => answered.push(p), listRuns: liveOne });
      await handle(f, '/answer use a|b as the pattern');
      assert.deepEqual(answered, [{ answers: [{ id: 'k', choice: 'use a|b as the pattern' }] }]);
    } },
  ]);
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

test('/stop and /pause refuse runs that are already finished', async () => {
  const f = makeRouter({ listRuns: () => [{ runId: 'r-2951', title: 'Done run', status: 'done' }] });
  const out = await handle(f, '/stop *2951');
  assert.match(out.body[0].value, /No live run matches/);
  const out2 = await handle(f, '/stop');
  assert.match(out2.body[0].value, /No live runs/);
});

test('a run parked on a gate is still resolvable by /approve and /answer after the filter', async () => {
  // wantLive now filters on LIVE = {running, starting, pausing}; a gated run's
  // entry.status stays 'running' (ui/server.mjs:436-441) — prove it stays reachable.
  const pq = { id: 'q1', kind: 'gate' };
  const answered = [];
  const f = makeRouter({
    listRuns: () => [{ runId: 'r-77aa', title: 'Gated', status: 'running' }],
    pendingQuestion: () => pq,
    answer: (runId, id, payload) => answered.push(payload),
  });
  const out = await handle(f, '/approve *77aa');
  assert.match(out.body[0].value, /approved — continuing/);
  assert.deepEqual(answered, [{ decision: 'continue' }]);
});

test('prototype members are not commands', async () => {
  const f = makeRouter();
  // The live bugs (parser lowercases, so only all-lowercase prototype members
  // resolve): /constructor → handler = Object, returns the env object → the
  // reply send fails isValidMessage → user gets NOTHING; /__proto__ → "Command
  // failed: handler is not a function". The camelCase ones below already answer
  // "Unknown command" and are regression guards only.
  for (const cmd of ['/constructor', '/__proto__', '/hasownproperty', '/tostring']) {
    const out = await handle(f, cmd);
    assert.match(out.body[0].value, /Unknown command/, cmd);
  }
});

test('bare /resume with two paused pipelines lists them instead of "No live runs"', async () => {
  const rows = [
    { id: 'p-aaaa', title: 'One', status: 'paused' },
    { id: 'p-bbbb', title: 'Two', status: 'interrupted' },
  ];
  const f = makeRouter({ history: async () => rows });
  const out = await handle(f, '/resume');
  assert.match(out.body[0].value, /Ambiguous/);
  assert.match(out.body[0].value, /\*aaaa/);
  assert.match(out.body[0].value, /\*bbbb/);
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

test('/use scopes /runs by project on a Windows-style projectDir (backslash separators)', async () => {
  const { send, state } = fixture({
    listProjects: async () => [{ name: 'worca', path: 'C:\\x\\worca' }, { name: 'other', path: 'C:\\x\\other' }],
  });
  state.live[0].projectDir = 'C:\\x\\worca';
  await send('/use worca');
  assert.match(text(await send('/runs')), /Fix login/, 'the live run in C:\\x\\worca is in scope');
  await send('/use other');
  assert.match(text(await send('/runs')), /No live runs/, 'scoped away from it');
});

// Scheduled runs: /runs lists upcoming tickets after the live ones, scoped by /use; an
// actions object without listScheduled (older wiring) keeps today's reply.
test('/runs lists scheduled runs after the live ones, scoped by /use', async () => {
  const f = makeRouter({
    listRuns: () => [],
    listScheduled: () => [
      { id: 'a', title: 'Upgrade deps', runAt: '2026-09-19T00:00:00Z', when: 'Sat Sep 19, 02:00', status: 'scheduled', projectDir: '/x/worca' },
      { id: 'b', title: 'Defragment', runAt: '2026-09-18T00:00:00Z', when: 'Fri Sep 18, 02:00', status: 'missed', projectDir: '/x/other' },
    ],
  });
  let out = text(await handle(f, '/runs'));
  assert.match(out, /No live runs\./);
  assert.match(out, /\*\*Scheduled:\*\*/);
  assert.match(out, /Upgrade deps · Sat Sep 19, 02:00/);
  assert.match(out, /\*\*missed\*\* · Defragment/);
  await handle(f, '/use worca');
  out = text(await handle(f, '/runs'));
  assert.match(out, /Upgrade deps/);
  assert.doesNotMatch(out, /Defragment/);
  const bare = makeRouter({ listRuns: () => [] });
  assert.match(text(await handle(bare, '/runs')), /No live runs\. `\/last`/);
});

// ── attribution (step 3): who sent the command rides every run action, as text ──

test('chat actions carry the sender as attribution text: "<name> via <Platform>"', async () => {
  const got = [];
  const f = fixture({
    pause: async (runId, by) => got.push(['pause', runId, by]),
    stop: async (runId, by) => got.push(['stop', runId, by]),
    resume: async (pipelineId, by) => { got.push(['resume', pipelineId, by]); return { ok: true }; },
    answer: async (runId, id, payload, by) => got.push(['answer', runId, id, by]),
  });
  const router = createCommandRouter({ actions: {
    ...Object.fromEntries(Object.entries({
      listRuns: () => f.state.live, runState: () => null, history: async () => f.state.rows,
      pendingQuestion: (id) => f.state.pending[id] ?? null, listProjects: async () => [],
    })),
    pause: async (runId, by) => got.push(['pause', runId, by]),
    stop: async (runId, by) => got.push(['stop', runId, by]),
    resume: async (pipelineId, by) => { got.push(['resume', pipelineId, by]); return { ok: true }; },
    answer: async (runId, id, payload, by) => got.push(['answer', runId, id, by]),
  }, chatContext: f.chatContext, logger: () => {} });
  const send = (text, meta, platform = 'telegram', userId = '9001') => router.handleIncoming({
    plugin: 'p', channelId: 'main', platform, channelConfig: CONFIG, msg: { chatId: '42', userId, text, meta },
  });
  await send('/pause *1111', { username: 'ada' });
  await send('/stop *1111', {}, 'slack', 'U024BE7LH');
  await send('/resume *3333', { name: 'Grace Hopper' }, 'teams');
  f.state.pending['run-aaaa1111'] = { id: 'g1', kind: 'gate' };
  await send('/approve', { username: 'ada' }, 'discord');
  assert.deepEqual(got, [
    ['pause', 'run-aaaa1111', 'ada via Telegram'],
    ['stop', 'run-aaaa1111', 'U024BE7LH via Slack'],
    ['resume', 'pipe-cccc3333', 'Grace Hopper via Teams'],
    ['answer', 'run-aaaa1111', 'g1', 'ada via Discord'],
  ]);
  // A display name that could break a line is refused, not trusted: the id stands in.
  got.length = 0;
  await send('/pause *1111', { username: 'ev\nil' }, 'telegram', '77');
  assert.equal(got[0][2], '77 via Telegram');
});

test('a refused command from a NOTIFIED chat gets one throttled hint naming its id; others stay silent', async () => {
  const refused = [];
  let t = 1_000_000;
  const router = createCommandRouter({
    actions: { listRuns: () => [] },
    chatContext: createChatContext(join(worcaHome(), 'cc-refuse.json')),
    logger: () => {},
    onRefused: (ev) => refused.push(ev),
    now: () => t,
  });
  const cfg = { allowedChatIds: '', notifyChatIds: '-100123, 55' };
  const send = (body, chatId) => router.handleIncoming({
    plugin: 'telegram-chat', channelId: 'main', platform: 'telegram', channelConfig: cfg,
    msg: { chatId, userId: 'u', text: body },
  });

  const first = await send('/approve *ab12', '-100123');
  assert.equal(first.severity, 'warning');
  assert.match(text(first), /not allowed to send commands/);
  assert.match(text(first), /`-100123`/);
  assert.match(text(first), /\*\*Allowed chat IDs\*\* in worca → Marketplace → telegram-chat → Settings\./, 'the hint names the Marketplace page');
  assert.match(text(first), /telegram-chat/);

  assert.equal(await send('/approve', '-100123'), null, 'throttled inside the window');
  t += 10 * 60 * 1000;
  assert.ok(await send('/status', '-100123'), 'hints again once the window passes');
  assert.equal(await send('/approve', '999'), null, 'a chat worca does not notify learns nothing');
  assert.equal(await send('good morning', '-100123'), null, 'chatter is not a command: no hint, no refusal event');

  assert.deepEqual(refused.map((r) => [r.plugin, r.channelId, r.chatId, r.command]), [
    ['telegram-chat', 'main', '-100123', 'approve'],
    ['telegram-chat', 'main', '-100123', 'approve'],
    ['telegram-chat', 'main', '-100123', 'status'],
    ['telegram-chat', 'main', '999', 'approve'],
  ]);
});

test('/cancel: gate lists the real options, recovery gives up, nothing pending points at /stop', async () => {
  const { send, calls, state } = fixture();
  assert.match(text(await send('/cancel')), /not waiting on a decision.*`\/stop \*1111`/s);

  state.pending['run-aaaa1111'] = { id: 'gate-9', kind: 'gate' };
  const before = calls.length;
  const out = text(await send('/cancel'));
  assert.match(out, /Gates have no cancel/);
  assert.match(out, /`\/approve \*1111` continues without another cycle/);
  assert.match(out, /`\/retry \*1111` runs another cycle/);
  assert.match(out, /`\/stop \*1111` stops the run/);
  assert.equal(calls.length, before, 'no action taken on a gate');

  state.pending['run-aaaa1111'] = { id: 'rec-1', kind: 'recovery' };
  await send('/cancel');
  assert.deepEqual(calls.at(-1), ['answer', 'run-aaaa1111', 'rec-1', { decision: 'pause' }]);
});

test('Auto workflow proposal: /status names it; /approve accepts, /answer revises, /retry explains, /cancel cancels', async () => {
  const { send, calls, state } = fixture();
  state.pending['run-aaaa1111'] = { id: 'auto-1', kind: 'workflow', workflow: { name: 'Fix flow', nodes: { a: {}, b: {} } } };

  await checkRows([
    { name: '/status names an open workflow proposal with its three replies', run: async () => {
      const out = text(await send('/status'));
      assert.match(out, /proposed workflow/);
      assert.match(out, /`\/approve \*1111`/);
      assert.match(out, /`\/cancel \*1111`/);
    } },
    { name: 'Auto workflow proposal: /approve accepts, /answer revises, /retry explains, /cancel cancels', run: async () => {
      assert.match(text(await send('/approve')), /accepted/);
      assert.deepEqual(calls.at(-1), ['answer', 'run-aaaa1111', 'auto-1', { decision: 'accept' }]);

      await send('/answer *1111 use a cheaper reviewer');
      assert.deepEqual(calls.at(-1), ['answer', 'run-aaaa1111', 'auto-1', { decision: 'revise', text: 'use a cheaper reviewer' }]);
      assert.match(text(await send('/answer')), /\/answer \*1111 <what to change>/, 'empty revise -> usage');

      const n = calls.length;
      assert.match(text(await send('/retry')), /\/answer \*1111 <what to change>/);
      assert.equal(calls.length, n, '/retry never answers a proposal');

      await send('/cancel');
      assert.deepEqual(calls.at(-1), ['answer', 'run-aaaa1111', 'auto-1', { decision: 'cancel' }]);
    } },
  ]);
});

test('/resume [*ref] [engine]: an engine continues the run on it; the refusal says where the consent is', async () => {
  const got = [];
  let answer = { ok: true };
  const { send } = fixture({ resume: async (pipelineId, by, opts) => { got.push([pipelineId, opts]); return answer; } });
  assert.match(text(await send('/resume *3333 claude')), /Resuming `\*3333` on Claude/);
  assert.deepEqual(got.at(-1), ['pipe-cccc3333', { engine: 'claude' }]);
  assert.match(text(await send('/resume Codex')), /Resuming `\*3333` on Codex/, 'bare, with the engine first');
  assert.deepEqual(got.at(-1), ['pipe-cccc3333', { engine: 'codex' }]);
  await send('/resume *3333');
  assert.deepEqual(got.at(-1), ['pipe-cccc3333', undefined], 'no engine named: the saved one');
  const n = got.length;
  assert.match(text(await send('/resume *3333 gemini')), /Unknown engine `gemini` — use claude, codex or cursor/);
  assert.equal(got.length, n, 'nothing resumed');

  answer = { ok: false, code: 'engine-refused', overridable: true, error: 'engine codex: guardrail set "normal" has permission rules this engine cannot enforce — run it with the Permissive set, or pass --allow-unguarded-engine to run it without them' };
  const refused = text(await send('/resume *3333 codex'));
  assert.match(refused, /Could not resume `\*3333` on Codex: engine codex: guardrail set "normal"/);
  assert.match(refused, /or resume it in the Worca UI with Allow unguarded to run it without them/, 'the consent is the UI\'s, never a chat word');
  assert.doesNotMatch(refused, /--allow-unguarded-engine/, 'no CLI flag in chat');
});
