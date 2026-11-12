// T-consumer: consumer ids and own addresses from the PostToolUse payload (§3.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumerFromPayload } from '../lib/consumer-id.mjs';

test('no agent_id → the main consumer and the session inbox', () => {
  const r = consumerFromPayload({ session_id: 's1', tool_name: 'Bash' }, 'p');
  assert.equal(r.ok, true);
  assert.equal(r.consumer, 'p:s1:main');
  assert.equal(r.agentKey, 'main');
  assert.equal(r.ownTopic, 'agent.s1.inbox');
});

test('agent_id keeps its case in the consumer id; only the topic segment is lowercased', () => {
  const up = consumerFromPayload({ session_id: 's1', agent_id: 'A7' }, 'p');
  assert.equal(up.consumer, 'p:s1:A7');
  assert.equal(up.topicKey, 'a7');
  assert.equal(up.ownTopic, 'agent.s1.sub.a7');
  const low = consumerFromPayload({ session_id: 's1', agent_id: 'a7' }, 'p');
  assert.equal(low.consumer, 'p:s1:a7');
  assert.notEqual(low.consumer, up.consumer);
  const sess = consumerFromPayload({ session_id: 'S1', agent_id: 'b' }, 'run.r1.step.impl');
  assert.equal(sess.consumer, 'run.r1.step.impl:S1:b');
  assert.equal(sess.sessionKey, 's1');
  assert.equal(sess.ownTopic, 'agent.s1.sub.b');
});

test('two payloads that differ only in agent_id give different consumers', () => {
  const a = consumerFromPayload({ session_id: 's', agent_id: 'a' }, 'p');
  const b = consumerFromPayload({ session_id: 's', agent_id: 'b' }, 'p');
  assert.notEqual(a.consumer, b.consumer);
  assert.notEqual(a.ownTopic, b.ownTopic);
});

test('invalid identities are refused with BUS_BAD_CONSUMER', () => {
  const bad = [
    {},
    { session_id: '' },
    { session_id: 's', agent_id: '../x' },
    { session_id: 's', agent_id: 'x'.repeat(65) },
    { session_id: 's', agent_id: 'MAIN' },
    { session_id: 's', agent_id: 'main' },
    { session_id: 's', agent_id: 7 },
    { session_id: 7 },
    { session_id: 'a/b' },
    null,
  ];
  for (const p of bad) {
    const r = consumerFromPayload(p, 'p');
    assert.equal(r.ok, false, JSON.stringify(p));
    assert.equal(r.code, 'BUS_BAD_CONSUMER');
  }
  assert.equal(consumerFromPayload({ session_id: 's' }, '').ok, false);
  assert.equal(consumerFromPayload({ session_id: 's' }, 'a:b').ok, false);
});
