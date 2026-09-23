// The pure human-hours estimator (money-saved design §4). Table-driven over evidence
// fixtures; every rule and every constant has one row here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HUMAN_ESTIMATE_DEFAULTS, resolveConstants, proseWords, jsonItems,
  estimateStepHours, sumStepHours, savedUsd, roundHours,
} from '../src/shared/human-estimate.mjs';

const agent = (over = {}) => ({ runnerType: 'producer', sideEffect: undefined, humanEffort: undefined, ...over });
const ev = (over = {}) => ({ nodeKind: 'agent', agent: agent(), cycle: 1, code: null, outputs: [], reads: null, ...over });

test('defaults are the spec constants and are frozen', () => {
  assert.deepEqual(HUMAN_ESTIMATE_DEFAULTS, {
    codeBase: 0.5, codeFileH: 0.1, codeExp: 0.85, codeDiv: 25,
    writeBase: 0.25, writeWph: 500, writeCapWords: 6000,
    reviseFactor: 0.35, reviseDecay: 0.5,
    jsonBase: 0.25, jsonItemH: 0.05,
    readLph: 300, readWph: 3000, rereadFactor: 0.3,
  });
  assert.ok(Object.isFrozen(HUMAN_ESTIMATE_DEFAULTS));
});

test('resolveConstants: finite non-negative overrides apply, everything else falls back', () => {
  const k = resolveConstants({ codeDiv: 40, writeWph: 'x', readLph: -1, bogus: 3, codeExp: NaN });
  assert.equal(k.codeDiv, 40);
  assert.equal(k.writeWph, 500);
  assert.equal(k.readLph, 300);
  assert.equal(k.codeExp, 0.85);
  assert.equal('bogus' in k, false);
  assert.deepEqual(resolveConstants(null), HUMAN_ESTIMATE_DEFAULTS);
});

test('proseWords counts words outside fenced code blocks only', () => {
  assert.equal(proseWords('one two\n```js\nconst a = 1;\n```\nthree'), 3);
  assert.equal(proseWords('```\nonly code\n```'), 0);
  assert.equal(proseWords(''), 0);
  assert.equal(proseWords(null), 0);
});

test('jsonItems: array length, first array member, else key count', () => {
  assert.equal(jsonItems([1, 2, 3]), 3);
  assert.equal(jsonItems({ findings: [{}, {}], summary: 'x' }), 2);
  assert.equal(jsonItems({ a: 1, b: 2 }), 2);
  assert.equal(jsonItems(null), 0);
  assert.equal(jsonItems('str'), 0);
});

test('code: 0.5 + 0.1·files + lines^0.85/25; zero lines credit nothing', () => {
  const r = estimateStepHours(ev({ code: { files: 26, insertions: 3332, deletions: 37 } }));
  const lines = 3369;
  const expect = 0.5 + 0.1 * 26 + Math.pow(lines, 0.85) / 25;
  assert.equal(r.signals.code, roundHours(expect));
  assert.equal(r.hours, roundHours(expect));
  assert.equal(r.method, 'heuristic');
  const zero = estimateStepHours(ev({ code: { files: 3, insertions: 0, deletions: 0 } }));
  assert.equal(zero.signals.code, 0);
  assert.equal(zero.hours, 0);
});

test('write: largest md output only, capped at 6000 words', () => {
  const r = estimateStepHours(ev({ outputs: [
    { type: 'md', words: 28000, revision: false },
    { type: 'md', words: 900, revision: false },
  ] }));
  assert.equal(r.signals.write, roundHours(0.25 + 6000 / 500));   // 12.25, not 12.25 + 2.05
  assert.equal(r.signals.revise, 0);
});

test('revise: write · 0.35 · 0.5^(cycle−1)', () => {
  const c1 = estimateStepHours(ev({ cycle: 1, outputs: [{ type: 'md', words: 40000, revision: true }] }));
  const c3 = estimateStepHours(ev({ cycle: 3, outputs: [{ type: 'md', words: 40000, revision: true }] }));
  assert.equal(c1.signals.revise, roundHours(12.25 * 0.35));
  assert.equal(c3.signals.revise, roundHours(12.25 * 0.35 * 0.25));
  assert.equal(c1.signals.write, 0);
});

test('json: 0.25 + 0.05·items per json output, summed', () => {
  const r = estimateStepHours(ev({ outputs: [{ type: 'json', items: 14 }, { type: 'json', items: 0 }] }));
  assert.equal(r.signals.json, roundHours(0.25 + 0.7 + 0.25));
});

test('read: verifiers only; cycle > 1 is ×0.3', () => {
  const reads = { diffLines: 3369, words: 5200 };
  const producer = estimateStepHours(ev({ reads }));
  assert.equal(producer.signals.read, 0);
  const v1 = estimateStepHours(ev({ agent: agent({ runnerType: 'verifier' }), reads }));
  assert.equal(v1.signals.read, roundHours(3369 / 300 + 5200 / 3000));
  const v2 = estimateStepHours(ev({ agent: agent({ runnerType: 'verifier' }), cycle: 2, reads }));
  assert.equal(v2.signals.read, roundHours((3369 / 300 + 5200 / 3000) * 0.3));
});

test('non-agent nodes credit nothing even with a code delta', () => {
  for (const nodeKind of ['script', 'task', 'combine', 'and', 'or', 'end']) {
    const r = estimateStepHours(ev({ nodeKind, agent: null, code: { files: 9, insertions: 500, deletions: 0 } }));
    assert.equal(r.hours, 0, nodeKind);
    assert.equal(r.method, 'none', nodeKind);
  }
});

test('humanEffort.hours is a fixed credit; humanEffort.factor scales the heuristic', () => {
  const fixed = estimateStepHours(ev({ agent: agent({ humanEffort: { hours: 0.25 } }), code: { files: 9, insertions: 500, deletions: 0 } }));
  assert.equal(fixed.hours, 0.25);
  assert.equal(fixed.method, 'override');
  const half = estimateStepHours(ev({ agent: agent({ humanEffort: { factor: 0.5 } }), outputs: [{ type: 'json', items: 0 }] }));
  assert.equal(half.hours, roundHours(0.25 * 0.5));
  assert.equal(half.method, 'heuristic');
  const none = estimateStepHours(ev({ agent: agent({ humanEffort: { factor: 0 } }), outputs: [{ type: 'json', items: 5 }] }));
  assert.equal(none.hours, 0);
});

test('sumStepHours ignores non-finite values; savedUsd is 2 dp and may go negative', () => {
  assert.equal(sumStepHours([{ humanHours: 1.005 }, { humanHours: 2 }, { humanHours: null }, {}]), 3.01);
  assert.equal(sumStepHours(null), 0);
  assert.equal(savedUsd(21.4, 35, 51.15), 697.85);
  assert.equal(savedUsd(0, 35, 6.12), -6.12);
  assert.equal(savedUsd(NaN, 35, 1), -1);
});
