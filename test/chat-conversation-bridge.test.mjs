import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createConversationBridge, stripBotMention, refusalText, turnRefusalText, followUpError, isSyntheticUserRow, SAY, cardRefusal, turnRefusal } from '../src/core/chat/conversation-bridge.mjs';
import { TokenBucket } from '../src/core/chat/rate-limiter.mjs';
import { parseChatMembers } from '../src/core/chat/allowlist.mjs';
import { createReceipts, commandOutcome, MARK, REACT_RETRY_MS, ACTION_DONE } from '../src/core/chat/receipts.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import * as askStore from '../src/core/ask/store.mjs';

useTempHome(after);   // the stub-deps bridge cases below bind conversations in a throwaway store

test('stripBotMention removes only this bot\'s token and keeps everything else as typed (M2)', () => {
  assert.equal(stripBotMention('<@BOT1> what is running?', 'BOT1'), 'what is running?');
  assert.equal(stripBotMention('<@!BOT1> hi', 'BOT1'), 'hi');
  assert.equal(stripBotMention('mail ada@example.com about it', 'BOT1'), 'mail ada@example.com about it');
  assert.equal(stripBotMention('<@BOT1> line one\nline two\n\n- item', 'BOT1'), 'line one\nline two\n\n- item');
  assert.equal(stripBotMention('ask <@U2> and <@BOT1> together', 'BOT1'), 'ask <@U2> and together');
  assert.equal(stripBotMention('hi', 'BOT1'), 'hi', 'no space injected between characters');
  assert.equal(stripBotMention('<@BOT1> x', null), '<@BOT1> x', 'no bot id: nothing removed');
  assert.equal(stripBotMention('<@BOT1> x', 'a.b'), '<@BOT1> x', 'a bot id outside the id charset is never put in a regex');
});

test('refusalText maps browser confirmations to Open in worca, busy to busy, rest to the error', () => {
  for (const code of ['sync-diverged', 'sync-fetch-failed', 'reason_required', 'team_total', 'engine-refused', 'preset-broken']) {
    assert.equal(refusalText({ status: 409, body: { code, error: 'x' } }), SAY.confirmInWorca(null), code);
  }
  assert.equal(refusalText({ status: 403, body: { error: 'y', needsPolicyAck: true } }), SAY.confirmInWorca(null));
  // With a configured worcaUrl the confirmation names this conversation's link; without one, how to get there.
  const linked = refusalText({ status: 409, body: { code: 'sync-diverged' } }, { thread: 'https://w.example/#chat/ask_0123abcd' });
  assert.match(linked, /nothing was started\. Confirm it in worca: https:\/\/w\.example\/#chat\/ask_0123abcd$/);
  assert.match(SAY.confirmInWorca(null), /Open worca in a browser and pick this conversation under Chat/);
  assert.doesNotMatch(SAY.confirmInWorca(null), /https?:/);
  assert.equal(refusalText({ status: 409, body: { error: 'turn in flight' } }), SAY.busy);
  assert.match(refusalText({ status: 422, body: { error: 'tag rule' } }), /^That did not work: tag rule/);
});

test('turn-start refusals: the send route gates name Open in worca; budget and busy keep their texts (review M2)', () => {
  const broker = turnRefusalText({ ok: false, status: 409, code: 'engine-broker', error: 'This chat runs on Codex: the credential broker is on' });
  assert.match(broker, /^This chat runs on Codex: the credential broker is on Open in worca/);
  assert.match(turnRefusalText({ ok: false, status: 409, code: 'credential-missing', error: "You haven't added your Anthropic key yet" }), /Open in worca/);
  assert.equal(turnRefusalText({ ok: false, status: 403, error: 'total cost limit reached' }), SAY.budget);
  assert.equal(turnRefusalText({ ok: false, status: 409, error: 'turn in flight' }), SAY.busy);
  assert.match(turnRefusalText({ ok: false, status: 503, error: 'no model available' }), /^That did not work: no model available/);
  assert.match(refusalText({ status: 409, body: { code: 'credential-missing', error: 'k' } }), /Open in worca/, 'the Request changes path maps the same');
});

test('followUpError reads a failed event turn from a 200 card answer only (review m9)', () => {
  assert.equal(followUpError({ status: 200, body: { block: {}, turn: { error: 'total cost limit reached', status: 403 } } }), 'total cost limit reached');
  assert.equal(followUpError({ status: 200, body: { block: {}, turn: { assistantMessageId: 'askm_00000001' } } }), null);
  assert.equal(followUpError({ status: 200, body: { block: {}, turn: { deferred: true } } }), null);
  assert.equal(followUpError({ status: 200, body: { block: {}, turn: null } }), null);
  assert.equal(followUpError({ status: 202, body: {} }), null);
});

test('parseChatMembers: id=identity pairs; bad ids and identities actorOf would refuse are skipped', () => {
  const m = parseChatMembers('123=ada@example.com,\n 456 = local , bad id=x, 789=, =y, 42=a<b>, 43=a' + String.fromCharCode(0x2028) + 'b, 44=a' + String.fromCharCode(0x85) + 'b');
  assert.deepEqual([...m], [['123', 'ada@example.com'], ['456', 'local']]);
});

test('synthetic rows are recognised by the synthetic notice flag only', () => {
  assert.equal(isSyntheticUserRow({ blocks: [{ kind: 'notice', synthetic: true, text: 'Answered: A' }] }), true);
  assert.equal(isSyntheticUserRow({ blocks: [{ kind: 'where', label: 'Run' }] }), false);
  assert.equal(isSyntheticUserRow({ blocks: [] }), false);
});

test('TokenBucket exposes tryConsume (M1): 6 per minute, the 7th is refused, refills with the clock', () => {
  let t = 0;
  const b = new TokenBucket(6, { now: () => t });
  for (let i = 0; i < 6; i++) assert.equal(b.tryConsume(), true);
  assert.equal(b.tryConsume(), false);
  t += 10_000;
  assert.equal(b.tryConsume(), true, 'one token back after 10 s at 6/min');
  assert.equal(typeof b.take, 'undefined', 'there is no take(): the bridge must call tryConsume');
});

const T = (messageId) => ({ plugin: 'p', channelId: 'main', chatId: 'C1', messageId });
const op = (a) => `${a.messageId}${a.on ? '+' : '-'}${a.emoji}`;

test('receipts: one message settles in order even when its ⏳ call is slow; another message is not held or crossed', async () => {
  const calls = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const rx = createReceipts({ react: async (a) => { if (a.messageId === 'A' && a.on && a.emoji === MARK.work) await gate; calls.push(op(a)); } });
  rx.ack(T('A')); rx.ack(T('B'));
  rx.settle(T('A'), 'ok'); rx.settle(T('B'), 'stop');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, [`B+${MARK.work}`, `B-${MARK.work}`, `B+${MARK.stop}`]);
  release();
  await rx.idle();
  assert.deepEqual(calls.filter((c) => c.startsWith('A')), [`A+${MARK.work}`, `A-${MARK.work}`, `A+${MARK.ok}`]);
});

test('receipts: settle(null) only removes ⏳; fail maps to ❌; no target, a bad target or no react = no call', async () => {
  const calls = [];
  const rx = createReceipts({ react: async (a) => { calls.push(op(a)); } });
  await rx.ack(T('A')); await rx.settle(T('A'), null);
  await rx.settle(T('B'), 'fail');
  await rx.ack(null); await rx.ack({ ...T('C'), messageId: '' }); await rx.settle(T('D'), 'work');
  assert.deepEqual(calls, [`A+${MARK.work}`, `A-${MARK.work}`, `B-${MARK.work}`, `B+${MARK.fail}`, `D-${MARK.work}`]);
  await createReceipts({}).ack(T('E'));   // no react: a resolved no-op
});

test('receipts: transient failures retry a bounded number of times, permanent ones never; nothing rejects; logs once per channel and text', async () => {
  const sleeps = []; const calls = []; const logs = [];
  const rx = createReceipts({
    react: async (a) => {
      calls.push(a.messageId);
      if (a.messageId === 'T') throw Object.assign(new Error('channel worker is failed'), { kind: 'plugin' });
      if (a.messageId === 'P' || a.messageId === 'Q') throw Object.assign(new Error('missing access'), { kind: 'plugin', permanent: true });
      if (a.messageId === 'R' && calls.filter((x) => x === 'R').length === 1) throw Object.assign(new Error('slow down'), { kind: 'rate-limit', retryAfterMs: 1500 });
    },
    log: (level, m) => logs.push(`${level}:${m}`),
    sleep: async (ms) => { sleeps.push(ms); },
  });
  await rx.ack(T('T'));
  assert.equal(calls.filter((x) => x === 'T').length, REACT_RETRY_MS.length + 1);
  assert.deepEqual(sleeps, [...REACT_RETRY_MS]);
  await rx.ack(T('P')); await rx.settle(T('P'), 'fail'); await rx.ack(T('Q'));
  assert.equal(calls.filter((x) => x === 'P').length, 3, 'one try per call, no retry of a refusal');
  assert.equal(logs.filter((m) => /missing access/.test(m)).length, 1, 'the same refusal in the same channel is logged once');
  sleeps.length = 0;
  await rx.ack(T('R'));
  assert.deepEqual(sleeps, [1500], 'a platform retry_after wins over the ladder');
  assert.ok(logs.every((m) => m.startsWith('warn:')));
});

test('commandOutcome: error → ❌, warning → a refusal (no mark), success/info/no reply → ✅', () => {
  assert.equal(commandOutcome({ severity: 'error' }), 'fail');
  assert.equal(commandOutcome({ severity: 'warning' }), null);
  assert.equal(commandOutcome({ severity: 'success' }), 'ok');
  assert.equal(commandOutcome({ severity: 'info' }), 'ok');
  assert.equal(commandOutcome(null), 'ok');
  assert.equal(commandOutcome({ severity: 'warning', [ACTION_DONE]: true }), 'ok', 'a completed /pause or /stop');
  assert.equal(commandOutcome({ severity: 'error', [ACTION_DONE]: true }), 'fail');
  assert.equal(JSON.stringify({ severity: 'warning', [ACTION_DONE]: true }), '{"severity":"warning"}', 'never serialized');
});

test('refusal kinds: busy, gates, cost limit, turn cap and browser confirmations are refusals; the rest are failures', () => {
  assert.deepEqual(turnRefusal({ ok: false, status: 409, error: 'a turn is already in flight' }), { text: SAY.busy, failed: false });
  assert.equal(turnRefusal({ ok: false, status: 403, error: 'total cost limit reached' }).failed, false);
  assert.equal(turnRefusal({ ok: false, status: 409, code: 'credential-missing', error: 'x' }).failed, false);
  assert.equal(turnRefusal({ ok: false, status: 429, error: 'too many chat turns' }).failed, false);
  assert.deepEqual(turnRefusal({ ok: false, status: 503, error: 'no model available' }), { text: SAY.failed('no model available'), failed: true });
  assert.equal(cardRefusal({ status: 409, body: { error: 'a turn in flight' } }).failed, false);
  assert.equal(cardRefusal({ status: 409, body: { code: 'sync-diverged' } }).failed, false);
  assert.equal(cardRefusal({ status: 400, body: { error: 'card is not proposed' } }).failed, true);
  assert.equal(refusalText({ status: 400, body: { error: 'x' } }), SAY.failed('x'), 'the text helpers keep their strings');
  assert.equal(turnRefusalText({ ok: false, status: 403, error: 'cost limit' }), SAY.budget);
});


// ── a throw after the ack (plan decision 9), over stub deps and a temp store ──
// The real-deps e2e cannot make startTurn, applyCard, scopeLabel or listMessages throw, so each post-ack catch is
// pinned here: such a throw ends ❌ with "That did not work", or keeps ⏳ while the reply can still arrive.
let stubSeq = 0;
function stubBridge(ask = {}, { watch = () => {} } = {}) {
  const posts = [];
  const threads = [];
  const rxCalls = [];
  const logs = [];
  const deleted = [];
  const receipts = createReceipts({ react: async (r) => { rxCalls.push(r); }, sleep: async () => {} });
  const bridge = createConversationBridge({
    host: {
      sendMessage: async ({ chatId, message, options }) => {
        posts.push({ chatId, message, options: options || null });
        const n = ++stubSeq;
        if (options?.thread) { threads.push(`ST${n}`); return { ok: true, detail: { threadId: `ST${n}`, messageIds: [`SH${n}`] } }; }
        if (options?.edit) return { ok: true, detail: { messageIds: [options.edit.messageId] } };
        return { ok: true, detail: { messageIds: [`SM${n}`] } };
      },
      replyInteraction: async () => {},
    },
    receipts,
    readConfig: () => ({ freeformChat: 'on', allowedChatIds: 'C1', chatMembers: 'U1=ada@example.com' }),
    linksFor: () => ({ thread: null, run: null }),
    now: () => Date.now(),
    log: (level, m) => logs.push(`${level}: ${m}`),
    watch,
    ask: {
      createThread: ({ createdBy }) => askStore.createThread({ createdBy }),   // a binding references a real Ask thread
      deleteThread: (id) => { deleted.push(id); },
      listMessages: () => [],
      initialScope: async () => null,
      scopeLabel: async () => 'No project',
      scopeOptions: async () => ({ options: [], hidden: 0 }),
      startTurn: async () => ({ ok: true, assistantMessageId: 'A1' }),
      applyCard: async () => ({ status: 200, body: {} }),
      takeDeferredReply: () => null,
      ...ask,
    },
  });
  /** One inbound message (a mention on C1, else a reply in a bound thread); resolves its id once every reaction landed. */
  const say = async (text, chatId = 'C1') => {
    const messageId = `sm${++stubSeq}`;
    const meta = { platform: 'discord', messageId, guildId: 'G1', mentionsBot: chatId === 'C1', botId: 'BOT1' };
    await bridge.handleMessage({ plugin: 'stub-chat', channelId: 'main', platform: 'discord', msg: { chatId, userId: 'U1', text, meta } })
      .catch((err) => { logs.push(`escaped: ${err?.message || err}`); });
    await receipts.idle();
    return messageId;
  };
  const opsOn = (id) => rxCalls.filter((r) => r.messageId === id).map((r) => `${r.on ? '+' : '-'}${r.emoji}`);
  const failPosts = (chatId) => posts.filter((p) => p.chatId === chatId && /^That did not work: /.test(p.message.body?.[0]?.value || ''));
  return { posts, threads, logs, deleted, say, opsOn, failPosts };
}
const FAILED = [`+${MARK.work}`, `-${MARK.work}`, `+${MARK.fail}`];
const boom = (what) => { throw new Error(`${what} exploded`); };
const textQuestion = [{ id: 'Q1', role: 'assistant', status: 'done', createdAt: new Date().toISOString(),
  blocks: [{ kind: 'card', id: 'card_q1', state: 'proposed', card: { type: 'question', answer: 'text', question: 'Which one?' } }] }];

test('post-ack throws in a bound thread: startTurn, applyCard and listMessages each end ❌ with one failure post there', async () => {
  for (const [name, ask] of [
    ['startTurn', { startTurn: async () => boom('startTurn') }],
    ['applyCard', { listMessages: () => textQuestion, applyCard: async () => boom('applyCard') }],
    ['listMessages', { listMessages: () => boom('listMessages') }],
  ]) {
    const s = stubBridge();
    await s.say('<@BOT1>');                               // a bare mention binds ST<n> with the default deps
    const th = s.threads[0];
    const s2 = stubBridge(ask);                          // the same store binding, read by a bridge whose deps throw
    const id = await s2.say('please answer', th);
    assert.deepEqual(s2.opsOn(id), FAILED, name);
    assert.equal(s2.failPosts(th).length, 1, name);
    assert.match(s2.failPosts(th)[0].message.body[0].value, new RegExp(`${name} exploded`), name);
    assert.ok(!s2.logs.some((m) => m.startsWith('escaped')), `${name}: nothing escapes to the server`);
  }
});

test('post-ack throws on a mention: a turn that cannot start fails in its new thread; scopeLabel and watch fail in the channel', async () => {
  const t = stubBridge({ startTurn: async () => boom('startTurn') });
  const id = await t.say('<@BOT1> hello there');
  assert.deepEqual(t.opsOn(id), FAILED);
  assert.equal(t.failPosts(t.threads[0]).length, 1, 'the conversation exists: the failure is posted in it');
  assert.equal(t.failPosts('C1').length, 0);

  const l = stubBridge({ scopeLabel: async () => boom('scopeLabel') });
  const lid = await l.say('<@BOT1> hello there');
  assert.deepEqual(l.opsOn(lid), FAILED);
  assert.equal(l.failPosts('C1').length, 1);
  assert.equal(l.deleted.length, 1, 'no orphan Ask thread');

  const w = stubBridge({}, { watch: () => boom('watch') });
  const wid = await w.say('<@BOT1>');
  assert.deepEqual(w.opsOn(wid), FAILED);
  assert.equal(w.failPosts('C1').length, 1);
  assert.ok(!w.logs.some((m) => m.startsWith('escaped')));
});

test('a failed header refresh after the thread is up only logs: a bare mention still ends ✅', async () => {
  let calls = 0;
  const s = stubBridge({ scopeLabel: async () => { calls += 1; if (calls > 1) boom('scopeLabel'); return 'No project'; } });
  const id = await s.say('<@BOT1>');
  assert.equal(calls, 2, 'the thread header, then its refresh');
  assert.deepEqual(s.opsOn(id), [`+${MARK.work}`, `-${MARK.work}`, `+${MARK.ok}`]);
  assert.equal(s.failPosts('C1').length + s.failPosts(s.threads[0]).length, 0);
  assert.ok(s.logs.some((m) => /header update failed: scopeLabel exploded/.test(m)));
});

test('a throw while checking a started reply keeps ⏳: the reply is still on its way and the next delivery pass settles it', async () => {
  const s = stubBridge();
  await s.say('<@BOT1>');
  let calls = 0;
  const s2 = stubBridge({ listMessages: () => { calls += 1; if (calls > 1) boom('listMessages'); return []; } });
  const id = await s2.say('a question', s.threads[0]);
  assert.equal(calls, 2, 'the open-question check, then the reply check');
  assert.deepEqual(s2.opsOn(id), [`+${MARK.work}`]);
  assert.equal(s2.failPosts(s.threads[0]).length, 0);
  assert.ok(s2.logs.some((m) => /listMessages exploded/.test(m)));
  assert.ok(!s2.logs.some((m) => m.startsWith('escaped')));
});
