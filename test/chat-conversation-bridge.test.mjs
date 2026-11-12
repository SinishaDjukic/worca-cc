import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createConversationBridge, stripBotMention, refusalText, turnRefusalText, followUpError, isSyntheticUserRow, SAY, cardRefusal, turnRefusal, historyCountOf } from '../src/core/chat/conversation-bridge.mjs';
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
  // A Teams member is their Entra object id (a 36-char GUID); ids stay capped at 64.
  const t = parseChatMembers(`8a3e1f2b-1234-4cde-9abc-0123456789ab=ada@example.com, ${'x'.repeat(64)}=bob, ${'y'.repeat(65)}=eve`);
  assert.deepEqual([...t.keys()], ['8a3e1f2b-1234-4cde-9abc-0123456789ab', 'x'.repeat(64)]);
  assert.doesNotMatch(SAY.notMember, /Discord/, 'the not-member notice names no platform');
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
function stubBridge(ask = {}, { watch = () => {}, host = {}, config = {}, deps = {} } = {}) {
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
      ...host,
    },
    receipts,
    readConfig: () => ({ freeformChat: 'on', allowedChatIds: 'C1', chatMembers: 'U1=ada@example.com', ...config }),
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
    ...deps,
  });
  /** One inbound message (a mention on C1, else a reply in a bound thread); resolves its id once every reaction landed. */
  const say = async (text, chatId = 'C1', extra = {}) => {
    const messageId = `sm${++stubSeq}`;
    const { meta: moreMeta = {}, ...fields } = extra;   // chat context: replyTo / attachments / history, meta.isGroup / link
    const meta = { platform: 'discord', messageId, guildId: 'G1', mentionsBot: chatId === 'C1', botId: 'BOT1', ...moreMeta };
    await bridge.handleMessage({ plugin: 'stub-chat', channelId: 'main', platform: 'discord', msg: { chatId, userId: 'U1', text, meta, ...fields } })
      .catch((err) => { logs.push(`escaped: ${err?.message || err}`); });
    await receipts.idle();
    return messageId;
  };
  const opsOn = (id) => rxCalls.filter((r) => r.messageId === id).map((r) => `${r.on ? '+' : '-'}${r.emoji}`);
  const failPosts = (chatId) => posts.filter((p) => p.chatId === chatId && /^That did not work: /.test(p.message.body?.[0]?.value || ''));
  return { bridge, posts, threads, logs, deleted, say, opsOn, failPosts };
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

// ── chat context (discord-chat 0.4.0) ──────────────────────────────────────────────────────────────────────────────
const FILE = { name: 'notes.md', contentType: 'text/markdown', size: 9, url: 'https://cdn.discordapp.com/a/notes.md' };
const REPLY = { author: 'Alice', text: 'the plan', at: '2026-11-03T09:58:00.000Z', link: 'https://discord.com/channels/G1/C1/r1', attachments: [FILE] };
const OLDER = { author: 'Bob', text: 'earlier', at: '2026-11-03T09:50:00.000Z', link: 'https://discord.com/channels/G1/C1/h1' };
const turnSpy = () => { const calls = []; return { calls, startTurn: async (a) => { calls.push(a); return { ok: true, assistantMessageId: 'A1' }; } }; };

test('historyCountOf: off, empty, junk and non-positive values are 0; a count is capped at 50', () => {
  assert.deepEqual(['off', '', null, undefined, '0', '-3', 'x', '2.5', '5', '20', '50', '80', 7].map(historyCountOf),
    [0, 0, 0, 0, 0, 0, 0, 0, 5, 20, 50, 50, 7]);
});

test('chat context: a reply that mentions the bot starts a turn with the quoted message and the files, even with no words', async () => {
  const t = turnSpy();
  const s = stubBridge({ startTurn: t.startTurn });
  await s.say('<@BOT1>', 'C1', { replyTo: REPLY, attachments: [FILE], meta: { isGroup: true, link: 'https://discord.com/channels/G1/C1/m9' } });
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].text, '', 'the row keeps only the person\'s words: none');
  assert.deepEqual(t.calls[0].inbound, { plugin: 'stub-chat', channelId: 'main', platform: 'discord', link: 'https://discord.com/channels/G1/C1/m9',
    attachments: [FILE], replyTo: REPLY, history: [], notes: [] });
});

test('chat context: off by default — no history is read; a message with no context keeps the old turn call; a bare mention runs no turn', async () => {
  const t = turnSpy();
  const s = stubBridge({ startTurn: t.startTurn }, { host: { history: async () => { throw new Error('must not be read'); } } });
  await s.say('<@BOT1> hello', 'C1', { meta: { isGroup: true } });
  await s.say('<@BOT1>', 'C1', { meta: { isGroup: true } });
  assert.equal(t.calls.length, 1);
  assert.deepEqual(Object.keys(t.calls[0]).sort(), ['actor', 'onUserRow', 'text', 'threadId']);
  assert.ok(!s.logs.some((l) => /history/.test(l)));
});

test('chat context: historyOnStart reads the channel before the mention once, only in a group channel; a failed read still starts the turn', async () => {
  const t = turnSpy();
  const reads = [];
  const s = stubBridge({ startTurn: t.startTurn }, { config: { historyOnStart: '20' }, host: { history: async (a) => { reads.push(a); return [OLDER]; } } });
  const id = await s.say('<@BOT1> catch me up', 'C1', { meta: { isGroup: true } });
  assert.deepEqual(reads, [{ plugin: 'stub-chat', channelId: 'main', chatId: 'C1', before: id, limit: 20 }]);
  assert.deepEqual(t.calls.at(-1).inbound.history, [OLDER]);
  await s.say('and more', s.threads[0]);
  assert.equal(reads.length, 1, 'a later message in the thread reads no history');
  assert.equal(t.calls.at(-1).inbound, undefined);
  await s.say('<@BOT1> a direct message', 'C1', { meta: { isGroup: false } });
  assert.equal(reads.length, 1, 'never a DM');

  const f = turnSpy();
  const bad = stubBridge({ startTurn: f.startTurn }, { config: { historyOnStart: '5' }, host: { history: async () => { throw Object.assign(new Error('missing access'), { permanent: true }); } } });
  await bad.say('<@BOT1> catch me up', 'C1', { meta: { isGroup: true } });
  assert.equal(f.calls.length, 1, 'the turn still runs');
  assert.deepEqual(f.calls[0].inbound.history, []);
  assert.deepEqual(f.calls[0].inbound.notes, ['The recent channel history could not be read, so it is not included.']);
  assert.ok(bad.logs.some((l) => /chat history not read: missing access/.test(l)));
});

test('chat context: history a plugin pushes on the frame is used at start (clipped to the setting), ignored when the setting is off', async () => {
  const pushed = Array.from({ length: 8 }, (_, i) => ({ ...OLDER, text: `m${i}`, link: `https://discord.com/channels/G1/C1/p${i}` }));
  const on = turnSpy();
  const s = stubBridge({ startTurn: on.startTurn }, { config: { historyOnStart: '5' }, host: { history: async () => { throw new Error('not asked'); } } });
  await s.say('<@BOT1> hi', 'C1', { meta: { isGroup: true }, history: pushed });
  assert.deepEqual(on.calls[0].inbound.history.map((q) => q.text), ['m3', 'm4', 'm5', 'm6', 'm7']);
  const off = turnSpy();
  const s2 = stubBridge({ startTurn: off.startTurn });
  await s2.say('<@BOT1> hi', 'C1', { meta: { isGroup: true }, history: pushed });
  assert.equal(off.calls[0].inbound, undefined);
});

test('chat context: files or a reply in a bound thread are a turn, never a typed card answer; plain words still answer', async () => {
  const s = stubBridge();
  await s.say('<@BOT1>');
  const t = turnSpy();
  const applied = [];
  const s2 = stubBridge({ listMessages: () => textQuestion, applyCard: async (a) => { applied.push(a); return { status: 200, body: {} }; }, startTurn: t.startTurn });
  await s2.say('', s.threads[0], { attachments: [FILE] });
  assert.equal(applied.length, 0);
  assert.equal(t.calls.length, 1);
  assert.deepEqual(t.calls[0].inbound.attachments, [FILE]);
  assert.equal(t.calls[0].inbound.replyTo, null);
  await s2.say('option B', s.threads[0]);
  assert.equal(applied.length, 1, 'words with no context answer the open question as before');
  await s2.say('', s.threads[0]);
  assert.equal(t.calls.length, 1, 'an empty message with no context is still ignored');
});

// ── live status messages (discord-chat 0.5.0) ──────────────────────────────────────────────────────────────────────
// A channel with liveStatus posts "⏳ Working on it…" when a turn starts, edits it with the elapsed time and the
// activity (one edit per tick, only when the text changed, never during a 429 wait) and edits it into the reply's
// first part. Clock and ticker are fakes: tick() runs the bridge's interval callback by hand.
const WORKING_TEXT = '⏳ Working on it… this message will update.';
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
function liveBridge(ask = {}, { host = {}, live = true, gate = null, hold = null } = {}) {
  let t = Date.parse('2026-11-04T12:00:00Z');
  const intervals = new Map();
  let nextTimer = 0;
  const msgs = [];
  const typingCalls = [];
  const posts = [];
  const threads = [];
  const s = stubBridge({ listMessages: () => msgs.slice(), ...ask }, {
    host: {
      // `gate(options)` returns an error to throw for that send (a 429, a deleted message, a worker that is down).
      sendMessage: async ({ chatId, message, options }) => {
        const err = gate ? gate(options || null) : null;
        if (err) throw err;
        const wait = hold ? hold(options || null, message) : null;   // a promise: this send lands only when it settles
        if (wait) await wait;
        posts.push({ chatId, message, options: options || null });
        const n = ++stubSeq;   // ids unique across every bridge of this file (one store)
        if (options?.thread) { threads.push(`LT${n}`); return { ok: true, detail: { threadId: `LT${n}`, messageIds: [`LH${n}`] } }; }
        if (options?.edit) return { ok: true, detail: { messageIds: [options.edit.messageId] } };
        return { ok: true, detail: { messageIds: [`LM${n}`] } };
      },
      typing: async (a) => { typingCalls.push(`${a.chatId}:${a.on ? 'on' : 'off'}`); },
      ...host,
    },
    deps: {
      liveStatus: () => live,
      now: () => t,
      setInterval: (fn) => { const id = ++nextTimer; intervals.set(id, fn); return id; },
      clearInterval: (id) => { intervals.delete(id); },
    },
  });
  const tick = async (ms = 0) => { t += ms; for (const fn of [...intervals.values()]) fn(); await flush(); };
  const reply = (over = {}) => ({ id: 'A1', role: 'assistant', status: 'done', text: 'the answer', blocks: [], createdAt: new Date(Date.now() + 60_000).toISOString(), ...over });
  const conv = (chatId = threads[0]) => C.findConversation({ plugin: 'stub-chat', channelId: 'main', chatId });
  const statusPost = (chatId = threads[0]) => posts.find((p) => p.chatId === chatId && !p.options && p.message.body[0].value === WORKING_TEXT);
  const statusId = (chatId = threads[0]) => C.listStatuses(conv(chatId).id)[0]?.platformMessageId;
  const editsOf = (id) => posts.filter((p) => p.options?.edit?.messageId === id);
  return { ...s, posts, threads, msgs, typingCalls, intervals, tick, reply, conv, statusPost, statusId, editsOf };
}
const C = await import('../src/core/chat/conversations.mjs');

test('live status: posted at turn start with typing; progress edits are throttled to the tick and carry no arguments', async () => {
  const L = liveBridge();
  await L.say('<@BOT1> hello there');
  const th = L.threads[0];
  const sp = L.statusPost(th);
  assert.ok(sp, 'the status message is posted in the thread');
  const sid = L.posts.indexOf(sp);
  const c = L.conv(th);
  const [row] = C.listStatuses(c.id);
  assert.equal(row.askMessageId, 'A1', 'bound to the turn\'s reply row');
  const id = row.platformMessageId;
  await flush();
  assert.deepEqual(L.typingCalls, [`${th}:on`]);
  assert.equal(L.intervals.size, 1);
  L.bridge.progress(c, { type: 'ask-block', messageId: 'A1', block: { kind: 'tool', name: 'Read', status: 'running', input: { file_path: '/home/ada/.ssh/id_rsa' } } });
  L.bridge.progress(c, { type: 'ask-block', messageId: 'OTHER', block: { kind: 'tool', name: 'Bash', status: 'running', input: {} } });
  await L.tick(6000);
  assert.deepEqual(L.editsOf(id).map((p) => p.message.body[0].value), ['⏳ Working on it… · 5 s\nReading files…']);
  await L.tick(1000);                                  // same 5 s step, same activity: no edit
  assert.equal(L.editsOf(id).length, 1);
  L.bridge.progress(c, { type: 'ask-delta', messageId: 'A1', text: 'The ans' });
  await L.tick(4000);
  assert.deepEqual(L.editsOf(id).map((p) => p.message.body[0].value).at(-1), '⏳ Working on it… · 10 s\nWriting the answer…');
  assert.ok(!JSON.stringify(L.posts).includes('id_rsa'), 'no tool argument reaches the platform');
  assert.ok(sid >= 0);
});

test('live status: the reply is edited into the status message; extra parts follow as new posts; nothing twice', async () => {
  const L = liveBridge();
  await L.say('<@BOT1> hello there');
  const th = L.threads[0];
  const c = L.conv(th);
  const id = C.listStatuses(c.id)[0].platformMessageId;
  L.msgs.push(L.reply({ blocks: [{ kind: 'card', id: 'card_q2', state: 'proposed', card: { type: 'question', answer: 'text', question: 'Which one?' } }] }));
  const before = L.posts.length;
  await L.bridge.reconcile(c);
  const after = L.posts.slice(before);
  assert.equal(after[0].options?.edit?.messageId, id, 'the first part goes into the status message');
  assert.equal(after[0].message.body[0].value, 'the answer');
  assert.equal(after.length, 2, 'the card follows as one new message');
  assert.equal(after[1].options, null);
  assert.deepEqual(C.listStatuses(c.id), []);
  assert.equal(C.deliveredParts(c.id, 'A1').find((d) => d.part === 'text:0').platformMessageId, id);
  await flush();
  assert.deepEqual(L.typingCalls, [`${th}:on`, `${th}:off`]);
  assert.equal(L.intervals.size, 0, 'the ticker stopped');
  const n = L.posts.length;
  await L.bridge.reconcile(c);
  await L.tick(30_000);
  assert.equal(L.posts.length, n, 'a second pass and later ticks send nothing');
});

test('live status: a 429 on a progress edit waits retry_after; a deleted status message falls back to a new post, once', async () => {
  let fail = null;
  let id = null;
  let refused = 0;
  const M = liveBridge({}, { gate: (o) => { if (o?.edit && fail && o.edit.messageId === id) { refused += 1; const e = fail.err; if (fail.once) fail = null; return e; } return null; } });
  await M.say('<@BOT1> hello there');
  const c = M.conv();
  id = M.statusId();
  M.bridge.progress(c, { type: 'ask-block', messageId: 'A1', block: { kind: 'tool', name: 'Bash', status: 'running' } });
  fail = { once: true, err: Object.assign(new Error('Discord rate limit'), { kind: 'rate-limit', retryAfterMs: 20_000 }) };
  await M.tick(6000);
  assert.equal(M.editsOf(id).length, 0, 'the 429 edit did not land');
  await M.tick(5000); await M.tick(5000); await M.tick(5000);
  assert.equal(M.editsOf(id).length, 0, 'no edit while retry_after runs');
  await M.tick(6000);
  assert.equal(M.editsOf(id).length, 1, 'progress resumes after retry_after');
  // The status message was deleted on the platform: the reply is posted as a new message, exactly once.
  fail = { once: false, err: Object.assign(new Error('channel or message not found (x)'), { kind: 'plugin', permanent: true }) };
  M.bridge.progress(c, { type: 'ask-delta', messageId: 'A1', text: 'x' });
  refused = 0;
  await M.tick(6000); await M.tick(6000); await M.tick(6000);
  assert.equal(refused, 1, 'after a refusal no more progress edits are tried');
  M.msgs.push(M.reply());
  const before = M.posts.length;
  await M.bridge.reconcile(c);
  await M.bridge.reconcile(c);
  const answers = M.posts.slice(before).filter((p) => p.message.body[0].value === 'the answer');
  assert.equal(answers.length, 1);
  assert.equal(answers[0].options, null, 'a new message');
  assert.deepEqual(C.listStatuses(c.id), []);
});

test('live status: a transient failure of the final edit posts nothing; the next pass edits it in', async () => {
  let down = false;
  const M = liveBridge({}, { gate: (o) => (down && o?.edit ? Object.assign(new Error('channel worker is failed'), { kind: 'plugin' }) : null) });
  await M.say('<@BOT1> hello there');
  const c = M.conv();
  const id = M.statusId();
  M.msgs.push(M.reply());
  down = true;
  const before = M.posts.length;
  await M.bridge.reconcile(c).catch(() => {});
  assert.equal(M.posts.length, before, 'nothing posted while the worker is down');
  down = false;
  await M.bridge.reconcile(c);
  const out = M.posts.slice(before);
  assert.equal(out.length, 1);
  assert.equal(out[0].options?.edit?.messageId, id);
  assert.equal(out[0].message.body[0].value, 'the answer');
});

test('live status: refusals, failures and stops become the status message; never a second post, never left working', async () => {
  for (const [name, startTurn, want] of [
    ['busy', async () => ({ ok: false, status: 409, error: 'a turn is already in flight' }), SAY.busy],
    ['budget', async () => ({ ok: false, status: 403, error: 'total cost limit reached' }), SAY.budget],
    ['throw', async () => boom('startTurn'), 'That did not work: startTurn exploded'],
  ]) {
    const L = liveBridge({ startTurn });
    await L.say('<@BOT1> hello there');
    const th = L.threads[0];
    const c = L.conv(th);
    const sp = L.statusPost(th);
    assert.ok(sp, name);
    const inThread = L.posts.filter((p) => p.chatId === th && !p.options?.thread && p.options?.edit?.messageId !== c.headerMessageId);
    const last = inThread.at(-1);
    assert.ok(last.options?.edit, `${name}: the explanation is an edit of the status message`);
    assert.match(last.message.body[0].value, new RegExp(want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), name);
    assert.equal(inThread.filter((p) => !p.options).length, 1, `${name}: only the status message was posted`);
    assert.deepEqual(C.listStatuses(c.id), [], name);
    assert.equal(L.intervals.size, 0, name);
  }
  // A turn that ends in error or is stopped: its reply row's line goes into the status message.
  for (const [status, text, want] of [['error', '', /The reply failed: boom/], ['stopped', '', /Stopped before any reply/]]) {
    const L = liveBridge();
    await L.say('<@BOT1> hello there');
    const c = L.conv(L.threads[0]);
    const id = C.listStatuses(c.id)[0].platformMessageId;
    L.msgs.push(L.reply({ status, text, reason: 'boom' }));
    await L.bridge.reconcile(c);
    assert.match(L.editsOf(id).at(-1).message.body[0].value, want, status);
    assert.deepEqual(C.listStatuses(c.id), [], status);
  }
});

test('live status: a reply that finishes before its status knows the row still lands in the status message', async () => {
  let L;
  L = liveBridge({ startTurn: async () => {
    L.msgs.push(L.reply());
    await L.bridge.reconcile(L.conv());   // the thread's own queue, mid-start
    return { ok: true, assistantMessageId: 'A1' };
  } });
  await L.say('<@BOT1> hello there');
  await flush();
  const c = L.conv(L.threads[0]);
  const answers = L.posts.filter((p) => p.message.body[0].value === 'the answer');
  assert.equal(answers.length, 1);
  assert.ok(answers[0].options?.edit, 'edited into the status message, not posted before it');
  assert.deepEqual(C.listStatuses(c.id), []);
});

test('live status: a typed answer to an open question shows the status when it starts a turn; a saved answer ends it', async () => {
  const base = liveBridge();
  await base.say('<@BOT1>');                           // a bare mention: no turn, no status
  const th = base.threads[0];
  assert.equal(base.statusPost(th), undefined);
  const T = liveBridge({ listMessages: () => [...textQuestion, ...T.msgs], applyCard: async () => ({ status: 200, body: { turn: { assistantMessageId: 'A2' } } }) });
  await T.say('the second one', th);
  const c = T.conv(th);
  const row = C.listStatuses(c.id)[0];
  assert.equal(row.askMessageId, 'A2');
  T.msgs.push(T.reply({ id: 'A2' }));
  await T.bridge.reconcile(c);
  assert.equal(T.editsOf(row.platformMessageId).at(-1).message.body[0].value, 'the answer');
  const S = liveBridge({ listMessages: () => textQuestion, applyCard: async () => ({ status: 200, body: { turn: null } }) });
  await S.say('the first one', th);
  assert.ok(S.statusPost(th), 'posted while the answer was applied');
  assert.equal(S.posts.filter((p) => p.options?.edit).at(-1).message.body[0].value, SAY.answerSaved);
  assert.deepEqual(C.listStatuses(c.id), []);
});

test('live status: a progress edit still in flight lands before the final edit, never over the answer', async () => {
  let release = null;
  const M = liveBridge({}, { hold: (o, m) => (o?.edit && /· \d+ s/.test(m.body[0].value) && !release ? new Promise((r) => { release = r; }) : null) });
  await M.say('<@BOT1> hello there');
  const c = M.conv();
  const id = M.statusId();
  M.bridge.progress(c, { type: 'ask-block', messageId: 'A1', block: { kind: 'tool', name: 'Read', status: 'running' } });
  await M.tick(6000);
  assert.ok(release, 'the progress edit is in flight');
  M.msgs.push(M.reply());
  const done = M.bridge.reconcile(c);
  await flush();
  release();
  await done;
  const edits = M.editsOf(id).map((p) => p.message.body[0].value);
  assert.deepEqual(edits, ['⏳ Working on it… · 5 s\nReading files…', 'the answer'], 'the answer is the last edit');
});

test('live status: a typed answer whose follow-up is queued waits by card id, then becomes the reply or the error', async () => {
  const base = liveBridge();
  await base.say('<@BOT1>');                           // a bare mention: the bound thread, no turn
  const th = base.threads[0];
  for (const [d, want] of [[{ assistantMessageId: 'A3' }, 'the answer'], [{ error: 'no model available' }, SAY.answeredNoReply('no model available')]]) {
    let ready = null;
    const T = liveBridge({ listMessages: () => [...textQuestion, ...T.msgs], applyCard: async () => ({ status: 200, body: { turn: { deferred: true } } }),
      takeDeferredReply: () => ready });
    await T.say('the second one', th);
    const c = T.conv(th);
    const row = C.listStatuses(c.id)[0];
    assert.ok(row, 'the status message waits');
    T.msgs.push(T.reply({ id: 'A3' }));
    ready = d;
    await T.bridge.reconcile(c);
    assert.equal(T.editsOf(row.platformMessageId).at(-1).message.body[0].value, want);
    assert.deepEqual(C.listStatuses(c.id), []);
    T.msgs.length = 0;
  }
});

test('live status: New conversation ends a running turn\'s status message (never left working)', async () => {
  const L = liveBridge({ threadScope: () => null });
  await L.say('<@BOT1> hello there');
  const th = L.threads[0];
  const c = L.conv(th);
  const id = L.statusId(th);
  await flush();
  let ref = null;
  const walk = (v) => { if (v && typeof v === 'object') { if (v.kind === 'button' && v.label === 'New conversation') ref = v.ref; for (const x of Object.values(v)) walk(x); } };
  for (const p of L.posts) walk(p.message);
  assert.ok(ref, 'the header offers New conversation');
  await L.bridge.handleInteraction({ plugin: 'stub-chat', channelId: 'main', evt: { id: `i${++stubSeq}`, ref, chatId: th, userId: 'U1', kind: 'button' } });
  await flush();
  assert.equal(L.editsOf(id).at(-1).message.body[0].value, SAY.statusMoved);
  assert.deepEqual(C.listStatuses(c.id), []);
  assert.equal(L.intervals.size, 0, 'the ticker stopped');
  assert.equal(L.typingCalls.at(-1), `${th}:off`);
});

test('live status: off for a channel without it, and a plugin without typing still works', async () => {
  const L = liveBridge({}, { live: false });
  await L.say('<@BOT1> hello there');
  assert.equal(L.statusPost(L.threads[0]), undefined);
  assert.deepEqual(L.typingCalls, []);
  const N = liveBridge({}, { host: { typing: undefined } });
  await N.say('<@BOT1> hello there');
  assert.ok(N.statusPost(N.threads[0]));
});

test('live status restart sweep: a status left working becomes Interrupted, or the finished reply; a live one is never touched', async () => {
  // Before the restart: a turn started and its status was bound (the row is in the store).
  const A = liveBridge();
  await A.say('<@BOT1> hello there');
  const c = A.conv(A.threads[0]);
  const id = C.listStatuses(c.id)[0].platformMessageId;
  // A worker reconnect while the turn runs: the same bridge's reconcile keeps the live status as it is.
  await A.bridge.reconcile(c);
  assert.equal(A.editsOf(id).length, 0);
  assert.equal(C.listStatuses(c.id).length, 1);
  // A restart: a new bridge; the sweep marked the turn's row cut off with no text.
  const B = liveBridge();
  B.msgs.push(B.reply({ status: 'error', text: '', blocks: [{ kind: 'notice', text: 'interrupted by restart' }] }));
  await B.bridge.reconcile(c);
  assert.deepEqual(B.editsOf(id).map((p) => p.message.body[0].value), ['⏹️ Interrupted — send your message again.']);
  assert.equal(B.posts.filter((p) => !p.options).length, 0, 'no second "the reply failed" post');
  assert.deepEqual(C.listStatuses(c.id), []);
  await B.bridge.reconcile(c);
  assert.equal(B.posts.length, 1, 'once');

  // A reply that finished before the restart is still edited into its status message.
  const D = liveBridge();
  await D.say('<@BOT1> hello again');
  const c2 = D.conv(D.threads[0]);
  const id2 = C.listStatuses(c2.id)[0].platformMessageId;
  const E = liveBridge();
  E.msgs.push(E.reply());
  await E.bridge.reconcile(c2);
  assert.equal(E.editsOf(id2).at(-1).message.body[0].value, 'the answer');
  assert.equal(E.posts.filter((p) => !p.options).length, 0);

  // A transient failure keeps the row; the next pass (the worker's reconnect) finishes it.
  const F = liveBridge({ startTurn: async () => ({ ok: true, assistantMessageId: 'A9' }) });
  await F.say('<@BOT1> third');
  const c3 = F.conv();
  let down = true;
  const G = liveBridge({}, { gate: () => (down ? Object.assign(new Error('channel worker is failed'), { kind: 'plugin' }) : null) });
  await G.bridge.reconcile(c3).catch(() => {});
  assert.equal(C.listStatuses(c3.id).length, 1, 'kept for the next pass');
  down = false;
  await G.bridge.reconcile(c3);
  assert.deepEqual(C.listStatuses(c3.id), []);
});

test('live status: a refusal whose status message is gone is posted anew; an empty reply still ends the status', async () => {
  let id = null;
  const R = liveBridge({ startTurn: async () => { id = R.statusId(); return { ok: false, status: 409, error: 'a turn is already in flight' }; } },
    { gate: (o) => (o?.edit && o.edit.messageId === id ? Object.assign(new Error('channel or message not found (x)'), { kind: 'plugin', permanent: true }) : null) });
  await R.say('<@BOT1> hello there');
  const busy = R.posts.filter((p) => p.chatId === R.threads[0] && p.message.body[0].value === SAY.busy);
  assert.equal(busy.length, 1);
  assert.equal(busy[0].options, null, 'posted as a new message');

  const E = liveBridge();
  await E.say('<@BOT1> hello there');
  const c = E.conv();
  const sid = E.statusId();
  E.msgs.push(E.reply({ text: '' }));
  await E.bridge.reconcile(c);
  assert.equal(E.editsOf(sid).at(-1).message.body[0].value, '✅ Done.');
  assert.deepEqual(C.listStatuses(c.id), []);
});

test('live status: a failing status check never blocks delivery (head of line)', async () => {
  const A = liveBridge();
  await A.say('<@BOT1> hello there');
  const c = A.conv();
  let calls = 0;
  const B = liveBridge({ listMessages: () => { calls += 1; if (calls === 1) boom('listMessages'); return [B.reply({ id: 'A1', text: 'still delivered' })]; } });
  await B.bridge.reconcile(c);
  assert.ok(B.posts.some((p) => p.message.body[0].value === 'still delivered'));
  assert.ok(B.logs.some((m) => /status messages not checked: listMessages exploded/.test(m)));
});

test('SAY.notOwner: a mention where the platform renders <@id> (Discord, Slack), the plain sentence elsewhere', () => {
  assert.equal(SAY.notOwner('U1'), 'Only <@U1> can act on this conversation.', 'Discord is the default');
  assert.equal(SAY.notOwner('123', 'discord'), 'Only <@123> can act on this conversation.');
  assert.equal(SAY.notOwner('U1', 'slack'), 'Only <@U1> can act on this conversation.');
  for (const platform of ['telegram', 'teams']) {
    assert.equal(SAY.notOwner('u-1', platform), 'Only the person who started this conversation can act on it.', platform);
  }
});
