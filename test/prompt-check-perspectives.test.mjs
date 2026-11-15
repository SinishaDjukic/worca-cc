// test/prompt-check-perspectives.test.mjs — proposePerspectives (src/shared/prompt-check/perspectives.mjs): the run
// card's proposal from the assessment's kind and the brief's content. Pure, deterministic, no model call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposePerspectives, KIND_START, SIGNALS, SIGNAL_TEXT_MAX } from '../src/shared/prompt-check/perspectives.mjs';
import { PROMPT_KINDS } from '../src/shared/prompt-check/assessment.mjs';
import { DEFAULT_PERSPECTIVES, perspectiveByKey } from '../src/shared/shape/perspectives.mjs';

const ids = (r) => r.map((e) => e.id);
const A = (kind, perspectives = []) => ({ kind, perspectives });
const EVERY = 'Reset the password, store the personal data, run the migration, fix the CI, change the button, rewrite it.';

test('each of the 7 kinds starts with its 3 keys, product first, each with a non-empty reason', () => {
  assert.deepEqual(Object.keys(KIND_START).sort(), [...PROMPT_KINDS].sort());
  for (const kind of PROMPT_KINDS) {
    const r = proposePerspectives(A(kind), 'Do the thing.');
    assert.deepEqual(ids(r), KIND_START[kind], kind);
    assert.equal(KIND_START[kind][0], 'product', kind);
    for (const e of r) assert.ok(typeof e.reason === 'string' && e.reason.trim(), `${kind}/${e.id}`);
  }
  assert.deepEqual(KIND_START.bug, ['product', 'qa', 'architect']);
  assert.deepEqual(KIND_START.idea, ['product', 'ux', 'devil']);
  assert.deepEqual(KIND_START.plan, ['product', 'architect', 'qa']);
});

test('a null or unknown kind starts with DEFAULT_PERSPECTIVES', () => {
  assert.deepEqual(ids(proposePerspectives(A(null), 'x')), DEFAULT_PERSPECTIVES);
  assert.deepEqual(ids(proposePerspectives(A('weird'), 'x')), DEFAULT_PERSPECTIVES);
  assert.deepEqual(ids(proposePerspectives(null, 'x')), DEFAULT_PERSPECTIVES);
});

test('the security signal ("password") adds security with its reason', () => {
  const r = proposePerspectives(A('bug'), 'The login fails when the password has a quote.');
  assert.deepEqual(ids(r), ['product', 'qa', 'architect', 'security']);
  assert.equal(r[3].reason, SIGNALS.find((s) => s.key === 'security').reason);
});

test('the compliance signal adds compliance only with {compliance:true}', () => {
  const text = 'Export the personal data of each user.';
  assert.deepEqual(ids(proposePerspectives(A('implementation'), text, { compliance: true })), ['product', 'architect', 'qa', 'compliance']);
  assert.equal(ids(proposePerspectives(A('implementation'), text)).includes('compliance'), false);
});

for (const [key, text] of [['release', 'Ship it behind a feature flag.'], ['devops', 'Add a docker image.'],
  ['ux', 'The modal hides the text.'], ['devil', 'Rewrite the scheduler.']]) {
  test(`the ${key} signal adds ${key}`, () => {
    const r = proposePerspectives(A('requirement'), text);
    assert.ok(ids(r).includes(key), ids(r).join());
    assert.equal(r.find((e) => e.id === key).reason, SIGNALS.find((s) => s.key === key).reason);
  });
}

test('product is first for every kind and every signal input', () => {
  for (const kind of [...PROMPT_KINDS, null]) {
    for (const text of ['', EVERY, ...SIGNALS.map((s) => s.key)]) {
      assert.equal(proposePerspectives(A(kind), text, { compliance: true })[0].id, 'product', `${kind}/${text}`);
    }
  }
});

test('text that fires every signal returns exactly 5 entries, in priority order', () => {
  assert.deepEqual(ids(proposePerspectives(A('requirement'), EVERY, { compliance: true })), ['product', 'architect', 'qa', 'security', 'compliance']);
  assert.deepEqual(ids(proposePerspectives(A('requirement'), EVERY)), ['product', 'architect', 'qa', 'security', 'release']);
  assert.deepEqual(ids(proposePerspectives(A('idea'), EVERY)), ['product', 'ux', 'devil', 'security', 'release']);
});

test('empty and non-string text return 3 entries and never throw', () => {
  for (const text of ['', undefined, null, 42, {}, ['password']]) {
    assert.equal(proposePerspectives(A('bug'), text).length, 3, String(text));
  }
  assert.equal(proposePerspectives(undefined, undefined).length, 3);
  assert.equal(proposePerspectives({ kind: 'bug', perspectives: 'junk' }, '').length, 3);
});

test('fit is never returned, assessment perspectives come after the signals with a clipped or help reason', () => {
  const r = proposePerspectives(A('bug', [{ id: 'fit', reason: 'r' }, { id: 'devops', reason: '' }, { id: 'release', reason: 'x'.repeat(400) }]),
    'Check the password.');
  assert.deepEqual(ids(r), ['product', 'qa', 'architect', 'security', 'devops']);
  assert.equal(r[4].reason, perspectiveByKey('devops').help);
  const long = proposePerspectives(A('bug', [{ id: 'release', reason: 'x'.repeat(400) }]), '');
  assert.equal(long[3].id, 'release');
  assert.ok(long[3].reason.length <= 160);
  const noCompliance = proposePerspectives(A('bug', [{ id: 'compliance', reason: 'r' }]), '');
  assert.equal(ids(noCompliance).includes('compliance'), false);
});

test('a 200 000-character input returns the same list as its first 8 000 characters', () => {
  assert.equal(SIGNAL_TEXT_MAX, 8000);
  const huge = 'plain words '.repeat(Math.ceil(SIGNAL_TEXT_MAX / 12)).slice(0, SIGNAL_TEXT_MAX) + ' password docker '.repeat(12000);
  assert.ok(huge.length >= 200000);
  const t0 = Date.now();
  const r = proposePerspectives(A('bug'), huge, { compliance: true });
  assert.ok(Date.now() - t0 < 1000);
  assert.deepEqual(r, proposePerspectives(A('bug'), huge.slice(0, SIGNAL_TEXT_MAX), { compliance: true }));
  assert.deepEqual(ids(r), KIND_START.bug);
});
