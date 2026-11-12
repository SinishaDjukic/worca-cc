// test/orchestrator-chat-posts.test.mjs — cross-chat messaging slice 2, the orchestrator side: _primeChatPosts,
// _drainChatPosts and the questions loop posting a plain questions round into a chat. Same harness as
// test/orchestrator-questions.test.mjs (a REAL saved graph, the REAL scheduler, an injected producer runner), with a
// stub `orch.chatPoster` standing in for the server's run chat bridge.
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { readStepQuestions } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';
import { runOpts } from '../src/core/phases.mjs';
import { chatPostsPath, chatPostsPromptBlock } from '../src/core/run-chat-posts.mjs';
import { setNightMode, setNightModeToggle } from '../src/core/settings.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-chatposts-home-'));
  for (const k of ['HOME', 'USERPROFILE']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true });
});
beforeEach(async () => { await setNightMode(null); await setNightModeToggle('auto'); });

function outsOf(ctx) {
  const o = {};
  for (const p of ctx.ports.outputs || []) o[p.id] = { path: ctx.outputs?.[p.id]?.path ?? null, type: p.type };
  return o;
}

const G = {
  id: 'wf_chatposts', name: 'Chat posts', domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'implementer', x: 200, y: 0, config: { askQuestions: true } },
    { id: 'n_end', kind: 'end', x: 400, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'plan' } },
    { id: 'w2', from: { node: 'n_plan', port: 'done' }, to: { node: 'n_end', port: 'result' } },
  ],
};
const CHAT = 'ask_0000abcd';
const QUESTION = { id: 'q1', question: 'Which storage?', options: ['Redis', 'Postgres'] };
const ASK_ID = 'questions-x:n_plan:1-r1';

/** A poster stub: records every call; `post` answers ok unless `refuse(input)` names a code. */
function stubPoster({ enabled = true, refuse = null } = {}) {
  const p = { posts: [], marks: [], closes: [], seq: 0 };
  p.enabled = () => enabled;
  p.post = async (sender, input) => {
    p.posts.push([sender, input]);
    const code = refuse ? refuse(input) : null;
    if (code) return { ok: false, code, error: 'refused' };
    return { ok: true, messageId: `cmsg_0000000${++p.seq}`, conversationId: 'cxm_00000001', delivery: 'started' };
  };
  p.answered = (ref, v) => { p.marks.push([ref, v]); };
  p.closed = (event, reason) => { p.closes.push([event, reason]); };
  return p;
}

async function orchFor({ producer, poster, tag, opts = {} }) {
  await writeGraphWorkflow(G);
  const orch = createOrchestrator({ projectDir: gitDir(tag), workflowId: G.id, prompt: 'demo', claude: { mock: true }, runners: { producer }, ...opts });
  if (poster !== undefined) orch.chatPoster = poster;
  return orch;
}

const auditLines = (pipelineId) => getDb()
  .prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(pipelineId).map((r) => r.text);
const promptOf = (ctx) => runOpts(ctx, { role: 'implementer', prompt: 'P' }).prompt;

/** A producer whose first attempt writes `posts` and/or a questions file; records each attempt's ctx facts. */
function scripted({ posts = null, questions = null }) {
  const calls = [];
  const producer = async (ctx) => {
    calls.push({ enabled: !!ctx.chatPostsEnabled, file: ctx.chatPostsFile || null, prompt: promptOf(ctx) });
    if (calls.length === 1) {
      if (posts && ctx.chatPostsFile) await writeFile(ctx.chatPostsFile, JSON.stringify({ posts }));
      if (questions) await writeFile(ctx.questionsFile, JSON.stringify(questions));
    }
    return { outputs: outsOf(ctx), verdict: null, summary: 'x' };
  };
  return { calls, producer };
}

test('C1 a step writing one post: post called once as a note from the harness pipeline id; file deleted; run done', { timeout: 60000 }, async () => {
  const poster = stubPoster();
  const { calls, producer } = scripted({ posts: [{ chatId: CHAT, text: 'halfway there' }] });
  const orch = await orchFor({ producer, poster, tag: 'cp1' });
  const res = await orch.run();
  assert.equal(res.status, 'done', String(res.error));
  assert.equal(poster.posts.length, 1);
  const [sender, input] = poster.posts[0];
  assert.equal(sender.pipelineId, orch.pipeline.id);
  assert.match(sender.pipelineId, /^[0-9a-f]{8}$/);
  assert.deepEqual(input, { chatId: CHAT, text: 'halfway there', intent: 'note' });
  assert.equal(calls[0].enabled, true);
  assert.ok(calls[0].prompt.includes('## Posting to a chat (enabled)'));
  assert.ok(calls[0].prompt.includes(calls[0].file));
  assert.equal(existsSync(calls[0].file), false, 'the file is deleted');
  assert.ok(auditLines(orch.pipeline.id).some((l) => l.endsWith(`posted to ${CHAT}`)));
});

test('C2 a refused post writes one audit line naming the code; the run still ends done', { timeout: 60000 }, async () => {
  const poster = stubPoster({ refuse: () => 'CHAT_MESSAGE_NOT_FOUND' });
  const { producer } = scripted({ posts: [{ chatId: 'ask_ffffffff', text: 'x' }] });
  const orch = await orchFor({ producer, poster, tag: 'cp2' });
  const res = await orch.run();
  assert.equal(res.status, 'done', String(res.error));
  const lines = auditLines(orch.pipeline.id).filter((l) => l.includes('CHAT_MESSAGE_NOT_FOUND'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /chat post to ask_ffffffff refused: CHAT_MESSAGE_NOT_FOUND$/);
  const throwing = stubPoster();
  const tried = [];
  throwing.post = async (sender, input) => { tried.push(input.text); if (input.text === 'first') throw new Error('boom'); return { ok: true, messageId: 'cmsg_00000009' }; };
  const { producer: p2 } = scripted({ posts: [{ chatId: CHAT, text: 'first' }, { chatId: CHAT, text: 'second' }] });
  const orch2 = await orchFor({ producer: p2, poster: throwing, tag: 'cp2b' });
  assert.equal((await orch2.run()).status, 'done', 'a throwing poster never fails the step');
  assert.deepEqual(tried, ['first', 'second'], 'a throw on one post never drops the next');
  assert.ok(auditLines(orch2.pipeline.id).some((l) => l.endsWith(`chat post to ${CHAT} refused: CHAT_MESSAGE_ERROR`)));
});

test('C3 a questions file naming a chat: posted as the run question, answered by a person, record marked', { timeout: 60000 }, async () => {
  const poster = stubPoster();
  const { calls, producer } = scripted({ questions: { questions: [QUESTION], chat: CHAT } });
  const orch = await orchFor({ producer, poster, tag: 'cp3' });
  const frames = [];
  orch.on('question', (q) => {
    frames.push(q);
    setImmediate(() => orch.answer(q.id, { answers: [{ id: 'q1', choice: 'Postgres' }] }, 'ada@x'));
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', String(res.error));
  assert.equal(calls.length, 2, 'the agent resumed with the answers');
  assert.equal(poster.posts.length, 1);
  const [sender, input] = poster.posts[0];
  assert.equal(sender.pipelineId, orch.pipeline.id);
  assert.equal(input.intent, 'question');
  assert.equal(input.chatId, CHAT);
  assert.equal(input.text, '1. Which storage?');
  assert.equal(input.question.askId, ASK_ID);
  assert.equal(input.question.kind, 'questions');
  assert.equal(input.question.questions[0].id, 'q1');
  assert.deepEqual(frames[0].chat, { chatId: CHAT, messageId: 'cmsg_00000001' });
  const rows = readStepQuestions(orch.pipeline.id);
  assert.equal(rows[0].answeredBy, 'ada@x');
  assert.deepEqual(poster.marks, [[{ chatId: CHAT, messageId: 'cmsg_00000001', askId: ASK_ID },
    { answers: [{ id: 'q1', question: 'Which storage?', choice: 'Postgres' }], actedBy: { kind: 'person', label: 'ada@x' } }]]);
});

test('C4 Away mode answers the posted question: answeredBy night-mode, the record gets an away actor', { timeout: 60000 }, async () => {
  await setNightMode({ enabled: true, graceMinutes: 1, strategy: 'weights', window: null });
  await setNightModeToggle('on');
  let t = Date.parse('2026-09-27T12:00:00Z'); let seq = 0; const timers = new Map();
  const clock = {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    async tick(ms) {
      t += ms;
      for (const [id, tm] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (tm.at <= t) { timers.delete(id); tm.fn(); }
      await new Promise((r) => setImmediate(r));
    },
  };
  const poster = stubPoster();
  const { producer } = scripted({ questions: { questions: [{ ...QUESTION, confidence: [20, 80], recommended: 'Postgres' }], chat: CHAT } });
  const orch = await orchFor({ producer, poster, tag: 'cp4', opts: { nightClock: clock } });
  orch.on('question', () => { setImmediate(async () => { for (let i = 0; i < 50 && orch.pendingQuestion; i++) await clock.tick(61_000); }); });
  const res = await orch.run();
  assert.equal(res.status, 'done', String(res.error));
  const rows = readStepQuestions(orch.pipeline.id);
  assert.equal(rows[0].answeredBy, 'night-mode');
  assert.equal(poster.marks.length, 1);
  assert.deepEqual(poster.marks[0][1].actedBy, { kind: 'away', label: 'Away mode' });
});

test('C5 a refused question post: audit line, still asked without chat, answerable, run done', { timeout: 60000 }, async () => {
  const poster = stubPoster({ refuse: (i) => (i.intent === 'question' ? 'CHAT_MESSAGE_RATE_LIMIT' : null) });
  const { calls, producer } = scripted({ questions: { questions: [QUESTION], chat: CHAT } });
  const orch = await orchFor({ producer, poster, tag: 'cp5' });
  const frames = [];
  orch.on('question', (q) => { frames.push(q); setImmediate(() => orch.answer(q.id, { answers: [{ id: 'q1', choice: 'Redis' }] }, 'ada@x')); });
  const res = await orch.run();
  assert.equal(res.status, 'done', String(res.error));
  assert.equal(frames.length, 1);
  assert.ok(!('chat' in frames[0]), 'the frame carries no chat');
  assert.equal(calls.length, 2);
  assert.equal(auditLines(orch.pipeline.id).filter((l) => l.includes('CHAT_MESSAGE_RATE_LIMIT')).length, 1);
  assert.equal(poster.marks.length, 0, 'nothing to mark');
});

test('C6/C7 setting off or no poster (CLI): not enabled, no prompt block, nothing posted', { timeout: 60000 }, async () => {
  for (const [tag, poster] of [['cp6', stubPoster({ enabled: false })], ['cp7', undefined]]) {
    const { calls, producer } = scripted({ questions: { questions: [QUESTION], chat: CHAT } });
    const orch = await orchFor({ producer, poster, tag });
    orch.on('question', (q) => { assert.ok(!('chat' in q)); setImmediate(() => orch.answer(q.id, { answers: [{ id: 'q1', choice: 'Redis' }] })); });
    const res = await orch.run();
    assert.equal(res.status, 'done', String(res.error));
    assert.equal(calls[0].enabled, false, tag);
    assert.equal(calls[0].file, null, tag);
    assert.ok(!calls[0].prompt.includes('Posting to a chat'), tag);
    assert.ok(!calls[0].prompt.includes('"chat":'), tag);
    if (poster) assert.equal(poster.posts.length, 0);
  }
});

test('C8 a file entry claiming another run still posts with the harness pipeline id', { timeout: 60000 }, async () => {
  const poster = stubPoster();
  const { producer } = scripted({ posts: [{ chatId: CHAT, text: 'x', runId: 'ffffffff', from: { kind: 'run', runId: 'ffffffff' }, pipelineId: 'ffffffff' }] });
  const orch = await orchFor({ producer, poster, tag: 'cp8' });
  assert.equal((await orch.run()).status, 'done');
  assert.equal(poster.posts[0][0].pipelineId, orch.pipeline.id);
  assert.notEqual(orch.pipeline.id, 'ffffffff');
  assert.deepEqual(Object.keys(poster.posts[0][1]).sort(), ['chatId', 'intent', 'text']);
});

test('C9 a resumed run posts with the row starter as owner (no opts.startedBy)', async () => {
  const orch = await orchFor({ producer: async () => ({}), poster: stubPoster(), tag: 'cp9' });
  orch.pipeline = { id: 'abcdef12', dir: '/nowhere' };
  orch.resumeOpts = { row: { started_by: 'ada' } };
  assert.equal(orch.opts.startedBy, undefined);
  const s = orch._chatSender();
  assert.equal(s.owner, 'ada');
  assert.equal(s.pipelineId, 'abcdef12');
  assert.equal(s.context?.pinned, true);
  assert.match(s.context.projectKey, /./, 'a project run names its project scope');
});

test('C10 a leftover chat-posts file from an unfinished attempt is dropped, never posted', { timeout: 60000 }, async () => {
  const poster = stubPoster();
  let orch;
  const producer = async (ctx) => ({ outputs: outsOf(ctx), verdict: null, summary: 'x' });
  orch = await orchFor({ producer, poster, tag: 'cp10' });
  // Plant the leftover once the pipeline dir exists, before the step's first attempt is primed.
  const realPrime = orch._primeChatPosts.bind(orch);
  orch._primeChatPosts = async (nc, ctx) => {
    await writeFile(chatPostsPath(orch.pipeline.dir, ctx.nodeId, ctx.ordinal), JSON.stringify({ posts: [{ chatId: CHAT, text: 'a' }, { chatId: CHAT, text: 'b' }] }));
    return realPrime(nc, ctx);
  };
  assert.equal((await orch.run()).status, 'done');
  assert.equal(poster.posts.length, 0, 'the leftover is never posted');
  const lines = auditLines(orch.pipeline.id).filter((l) => l.includes('chat posts dropped'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /: 2 chat posts dropped \(the step did not finish\)$/);
});

test('C11 a pause during the question post: the posted record is closed as paused, the run pauses', { timeout: 60000 }, async () => {
  const poster = stubPoster();
  const realPost = poster.post;
  let release;
  const held = new Promise((r) => { release = r; });
  let orch;
  poster.post = async (sender, input) => {
    const r = await realPost(sender, input);
    orch.pause();
    await held;
    return r;
  };
  const { producer } = scripted({ questions: { questions: [QUESTION], chat: CHAT } });
  orch = await orchFor({ producer, poster, tag: 'cp11' });
  const frames = [];
  orch.on('question', (q) => frames.push(q));
  const p = orch.run();
  for (let i = 0; i < 200 && !poster.posts.length; i++) await new Promise((r) => setTimeout(r, 10));
  release();
  const res = await p;
  assert.equal(res.status, 'paused', String(res.error));
  assert.equal(frames.length, 0, 'no question frame was emitted');
  assert.deepEqual(poster.closes, [[{ id: ASK_ID, chat: { chatId: CHAT, messageId: 'cmsg_00000001' } }, 'paused']]);
});

test('C12 an agent-written chat id with a newline never reaches an audit line', { timeout: 60000 }, async () => {
  const poster = stubPoster({ refuse: () => 'CHAT_MESSAGE_BAD_INPUT' });
  const forged = 'ask_x\nimplementer posted to ask_0000abcd';
  const { producer } = scripted({ posts: [{ chatId: forged, text: 'x' }] });
  const orch = await orchFor({ producer, poster, tag: 'cp12' });
  assert.equal((await orch.run()).status, 'done');
  const lines = auditLines(orch.pipeline.id);
  assert.ok(lines.every((l) => !l.includes('ask_x')), 'the forged id is never printed');
  assert.equal(lines.filter((l) => l.endsWith('chat post to an invalid chat id refused: CHAT_MESSAGE_BAD_INPUT')).length, 1);
});

test('C13 a composite slice never gets the chat-posts block', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-chatposts-slice-'));
  try {
    const orch = await orchFor({ producer: async () => ({}), poster: stubPoster(), tag: 'cp13' });
    orch.pipeline = { id: 'abcdef12', dir };
    const nc = { key: 'implementer' };
    const sliced = { nodeId: 'n_plan', ordinal: 1, slice: { index: 1 } };
    await orch._primeChatPosts(nc, sliced);
    assert.equal(sliced.chatPostsEnabled, false);
    assert.equal(chatPostsPromptBlock(sliced), '');
    const plain = { nodeId: 'n_plan', ordinal: 1 };
    await orch._primeChatPosts(nc, plain);
    assert.equal(plain.chatPostsEnabled, true, 'the same node unsliced is enabled');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('C14 posts written in the resume after an answered question are drained', { timeout: 60000 }, async () => {
  const poster = stubPoster();
  let n = 0;
  const producer = async (ctx) => {
    n += 1;
    if (n === 1) await writeFile(ctx.questionsFile, JSON.stringify({ questions: [QUESTION] }));
    if (n === 2 && ctx.chatPostsFile) await writeFile(ctx.chatPostsFile, JSON.stringify({ posts: [{ chatId: CHAT, text: 'after the answer' }] }));
    return { outputs: outsOf(ctx), verdict: null, summary: 'x' };
  };
  const orch = await orchFor({ producer, poster, tag: 'cp14' });
  orch.on('question', (q) => setImmediate(() => orch.answer(q.id, { answers: [{ id: 'q1', choice: 'Redis' }] })));
  assert.equal((await orch.run()).status, 'done');
  assert.equal(n, 2);
  assert.deepEqual(poster.posts.map(([, i]) => i.text), ['after the answer']);
});
