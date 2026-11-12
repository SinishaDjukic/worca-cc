// T-env: envelope ids, topic rules, size and hop limits, stamped fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newId, validateDraft, validateTopic, validateSegmentId, TOPIC_RE,
  BODY_TEXT_MAX, BODY_DATA_MAX, MAX_HOPS, BusError,
} from '../lib/envelope.mjs';

const draft = (over = {}) => ({ topic: 'run.r1.siblings', kind: 'note', body: { text: 'hi' }, ...over });

test('ids are unique and time-ordered over 10 000 calls', () => {
  const ids = [];
  for (let i = 0; i < 10_000; i++) ids.push(newId());
  assert.equal(new Set(ids).size, ids.length);
  for (let i = 1; i < ids.length; i++) assert.ok(ids[i - 1] < ids[i], `${ids[i - 1]} < ${ids[i]}`);
  assert.match(ids[0], /^m_[0-9A-HJKMNP-TV-Z]{26}$/);
  // a later clock gives a later id, an earlier clock never goes backwards
  assert.ok(newId(Date.now() + 1000) > ids.at(-1));
  assert.ok(newId(0) > ids.at(-1));
});

test('limits match the cross-chat numbers', () => {
  assert.equal(BODY_TEXT_MAX, 4000);
  assert.equal(BODY_DATA_MAX, 8192);
  assert.equal(MAX_HOPS, 6);
  assert.ok(TOPIC_RE instanceof RegExp);
});

test('bad topics are refused with BUS_BAD_TOPIC, never rewritten', () => {
  const bad = ['Run..x', 'Run.x', 'run..x', 'a.b.c.d.e.f.g.h.i', 'a'.repeat(201), 'run.../x.step', '', 'run.r1.*'];
  for (const t of bad) {
    const r = validateTopic(t);
    assert.equal(r.ok, false, t);
    assert.equal(r.code, 'BUS_BAD_TOPIC', t);
    const d = validateDraft(draft({ topic: t }));
    assert.equal(d.ok, false);
    assert.equal(d.code, 'BUS_BAD_TOPIC');
  }
  assert.equal(validateTopic(['run', 'x'].join('.')).ok, true);
  assert.equal(validateTopic('a.b.c.d.e.f.g.h').ok, true);
  assert.equal(validateTopic('run.r1.*', { pattern: true }).ok, true);
  assert.equal(validateTopic('run.*.x', { pattern: true }).ok, false);
  assert.equal(validateSegmentId('../x'), false);
  assert.equal(validateSegmentId('A7'), true);
  assert.equal(validateSegmentId('x'.repeat(65)), false);
});

test('size, hop and kind limits', () => {
  assert.equal(validateDraft(draft({ body: { text: 'x'.repeat(4000) } })).ok, true);
  const big = validateDraft(draft({ body: { text: 'x'.repeat(4001) } }));
  assert.deepEqual([big.ok, big.code], [false, 'BUS_TOO_LARGE']);
  const data = validateDraft(draft({ body: { text: 'a', data: { s: 'y'.repeat(8200) } } }));
  assert.deepEqual([data.ok, data.code], [false, 'BUS_TOO_LARGE']);
  const hop = validateDraft(draft({ hop: 7 }));
  assert.deepEqual([hop.ok, hop.code], [false, 'BUS_HOP_LIMIT']);
  assert.equal(validateDraft(draft({ hop: 6 })).ok, true);
  const kind = validateDraft(draft({ kind: 'shout' }));
  assert.deepEqual([kind.ok, kind.code], [false, 'BUS_BAD_ENVELOPE']);
  assert.equal(validateDraft(null).code, 'BUS_BAD_ENVELOPE');
  assert.equal(validateDraft(draft({ body: { text: 5 } })).code, 'BUS_BAD_ENVELOPE');
});

test('from, origin and seq in a draft are dropped (they are stamped)', () => {
  const r = validateDraft(draft({ from: { kind: 'person', id: 'boss' }, origin: 'h_deadbeef', seq: 99 }));
  assert.equal(r.ok, true);
  assert.equal('from' in r.env, false);
  assert.equal('origin' in r.env, false);
  assert.equal('seq' in r.env, false);
  assert.equal(r.env.v, 1);
  assert.equal(r.env.hop, 1);
  assert.deepEqual(r.env.scope, { kind: 'none', key: null, owner: null });
  assert.match(r.env.id, /^m_/);
});

test('BusError carries a code', () => {
  const e = new BusError('BUS_CLOSED', 'closed');
  assert.ok(e instanceof Error);
  assert.equal(e.code, 'BUS_CLOSED');
});
