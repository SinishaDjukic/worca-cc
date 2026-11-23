// test/requirements-item-length.test.mjs — a spec item is never cut mid-sentence: a long goal, step, rule, criterion or
// assumption is kept whole up to LIMITS.item, a longer one the model wrote ends at a word with "…", a longer one the
// product owner typed is refused, and the model is told the limit.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createFeature, updateFeature } from '../src/core/requirements/store.mjs';
import { setSection, addCriterion, editCriterion } from '../src/core/requirements/edits.mjs';
import { emptySpec, normalizeSection, LIMITS, RequirementsError } from '../src/core/requirements/spec.mjs';
import { applyRound, ROUND_SYSTEM_PROMPT } from '../src/core/requirements/round.mjs';
import { renderSpecMarkdown } from '../src/core/requirements/markdown.mjs';

useTempHome(after);

// Real prose of a given length: words, spaces and full stops, like a long main-flow step.
const prose = (n) => {
  let s = '';
  for (let i = 0; s.length < n; i += 1) s += `Worca checks variable ${i} that Akamai marks as sensitive before it saves the rule. `;
  return s.slice(0, n).trim();
};
const make = () => {
  const f = createFeature({ scopeType: 'project', scopeKey: 'k', title: 't', description: 'd' });
  return updateFeature(f.seq, { status: 'your_turn', criteriaSeq: 1, spec: { ...emptySpec(), criteria: [{ id: 'R-po-1', text: 'c1' }] } });
};

test('a spec item holds 10000 characters', () => {
  assert.equal(LIMITS.item, 10000);
});

test('normalizeSection keeps a 1500-character step, goal and measure whole', () => {
  const long = prose(1500);
  assert.deepEqual(normalizeSection('flow', ['Short step', long]), ['Short step', long]);
  assert.deepEqual(normalizeSection('goal', { text: long, measure: long }), { text: long, measure: long });
});

test('normalizeSection ends a too-long item at a whole word with "…", never mid-word', () => {
  const long = prose(LIMITS.item + 600);
  const [cut] = normalizeSection('rules', [long]);
  assert.ok(cut.length <= LIMITS.item, `at most ${LIMITS.item}, got ${cut.length}`);
  assert.ok(cut.endsWith('…'), cut.slice(-20));
  const kept = cut.slice(0, -1);
  assert.ok(long.startsWith(kept), 'what is kept is the start of the text');
  assert.match(long.slice(kept.length), /^\s/, 'the cut falls between words');
  assert.ok(kept.length > LIMITS.item / 2, 'most of the text is kept');
});

test('a round keeps a long criterion and assumption whole', () => {
  const long = prose(1500);
  const { spec } = applyRound(emptySpec(), { spec: {}, criteria: [{ id: null, text: long }], assumptions: [{ id: null, text: long }], questions: [] });
  assert.equal(spec.criteria[0].text, long);
  assert.equal(spec.assumptions[0].text, long);
});

test('the downloaded spec has the long step whole', () => {
  const long = prose(1500);
  const md = renderSpecMarkdown({ id: 'FEAT-1', title: 't', scopeType: 'project', scopeKey: 'k', status: 'your_turn', description: 'd',
    spec: { ...emptySpec(), flow: ['First', long] } });
  assert.ok(md.includes(`2. ${long}\n`), 'step 2 is in the Markdown whole');
});

test('the round prompt tells the model how long an item may be', () => {
  assert.match(ROUND_SYSTEM_PROMPT, new RegExp(`at most ${LIMITS.item} characters`));
});

test('the product owner\'s own long text is kept up to the limit and refused past it, never cut', () => {
  const f = make();
  const ok = prose(1800);
  assert.deepEqual(setSection(f.seq, 'rules', `Rule one\n${ok}`).spec.rules, ['Rule one', ok]);
  assert.equal(addCriterion(f.seq, ok).spec.criteria.at(-1).text, ok);
  const tooLong = prose(LIMITS.item + 60);
  const refused = (e) => e instanceof RequirementsError && e.code === 'BAD_REQUEST' && new RegExp(`at most ${LIMITS.item} characters`).test(e.message);
  assert.throws(() => setSection(f.seq, 'rules', `Rule one\n${tooLong}`), refused);
  assert.throws(() => setSection(f.seq, 'goal', { text: tooLong, measure: '' }), refused);
  assert.throws(() => addCriterion(f.seq, tooLong), refused);
  assert.throws(() => editCriterion(f.seq, 'R-po-1', tooLong), refused);
});
