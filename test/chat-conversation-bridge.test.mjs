import test from 'node:test';
import assert from 'node:assert/strict';
import { stripBotMention, refusalText, turnRefusalText, followUpError, isSyntheticUserRow, SAY } from '../src/core/chat/conversation-bridge.mjs';
import { TokenBucket } from '../src/core/chat/rate-limiter.mjs';
import { parseChatMembers } from '../src/core/chat/allowlist.mjs';

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
    assert.equal(refusalText({ status: 409, body: { code, error: 'x' } }), SAY.confirmInWorca, code);
  }
  assert.equal(refusalText({ status: 403, body: { error: 'y', needsPolicyAck: true } }), SAY.confirmInWorca);
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
