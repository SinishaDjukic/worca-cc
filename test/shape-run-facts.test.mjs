// test/shape-run-facts.test.mjs — Shaper small runs D2 (D7, D9, D15): src/shared/shape/run-facts.mjs, the pure words of a
// run's "Starts from" and "Owns" facts and the plan version a plan path names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planVersionOf, startsFromOf, ownsOf } from '../src/shared/shape/run-facts.mjs';

const BASE = 'dev';
const RUNS = [{ index: 1, feature: 'worca/feat-1' }, { index: 2, feature: 'worca/feat-2' }, { index: 3, feature: 'worca/feat-3' }];

test('planVersionOf: -vN.md gives N, anything else 1', () => {
  assert.equal(planVersionOf('plans/x-v2.md'), 2);
  assert.equal(planVersionOf('x-v12.md'), 12);
  assert.equal(planVersionOf('plans/x.md'), 1);
  assert.equal(planVersionOf(''), 1);
  assert.equal(planVersionOf(null), 1);
});

test('startsFromOf: run 1 (an empty source too) and a run from the base start from the feature branch', () => {
  const feature = { kind: 'feature', branch: BASE, text: 'the feature branch: nothing is finished yet' };
  assert.deepEqual(startsFromOf({ index: 1, source: BASE, base: BASE, runs: [] }), feature);
  assert.deepEqual(startsFromOf({ index: 1, source: '', base: BASE, runs: [] }), feature);
  assert.deepEqual(startsFromOf({ index: 1, source: null, base: null, runs: [] }), { ...feature, branch: null });
  assert.deepEqual(startsFromOf({ index: 4, source: BASE, base: BASE, runs: RUNS }), feature);
});

test('startsFromOf: a source equal to an earlier run\'s branch names that run', () => {
  assert.deepEqual(startsFromOf({ index: 4, source: 'worca/feat-3', base: BASE, runs: RUNS }),
    { kind: 'run', run: 3, branch: 'worca/feat-3', text: 'the latest finished run (run 3)' });
  assert.deepEqual(startsFromOf({ index: 3, source: 'worca/feat-1', base: BASE, runs: RUNS.slice(0, 2) }),
    { kind: 'run', run: 1, branch: 'worca/feat-1', text: 'the latest finished run (run 1)' });
});

test('startsFromOf: any other source is a named branch; an empty source on a later run is null', () => {
  assert.deepEqual(startsFromOf({ index: 4, source: 'hotfix/x', base: BASE, runs: RUNS }),
    { kind: 'branch', branch: 'hotfix/x', text: 'the branch hotfix/x' });
  assert.equal(startsFromOf({ index: 4, source: '', base: BASE, runs: RUNS }), null);
  assert.equal(startsFromOf({ index: 2, source: null, base: BASE, runs: RUNS }), null);
});

test('ownsOf: one row per id, the text on one line, pass from the check by id, null without one', () => {
  const texts = { 'R-po-1': 'Export\n   the report ', 'R-qa-2': 'It is tested' };
  assert.deepEqual(ownsOf({ ids: ['R-po-1', 'R-qa-2'], texts, check: null }),
    [{ id: 'R-po-1', text: 'Export the report', pass: null }, { id: 'R-qa-2', text: 'It is tested', pass: null }]);
  const check = { items: [{ id: 'R-po-1', pass: true }, { id: 'R-qa-2', pass: false }] };
  assert.deepEqual(ownsOf({ ids: ['R-po-1', 'R-qa-2', 'R-x-3'], texts, check }).map((r) => [r.id, r.pass]),
    [['R-po-1', true], ['R-qa-2', false], ['R-x-3', null]]);
  assert.equal(ownsOf({ ids: ['R-x-3'], texts }).at(0).text, '');
  assert.deepEqual(ownsOf({ ids: undefined }), []);
  assert.equal(ownsOf({ ids: ['R-po-1'], texts: { 'R-po-1': 'a\n  b' } })[0].text, 'a b');
});

test('ownsOf adds word and mark from shown and leaves them out without it', () => {
  const shown = new Map([['R-po-1', { owner: 'run 2', role: null, word: 'being built', text: 'run 2 · being built', mark: 'live' }]]);
  assert.deepEqual(ownsOf({ ids: ['R-po-1', 'R-qa-2'], texts: { 'R-po-1': 'Export', 'R-qa-2': 'Tested' }, shown }), [
    { id: 'R-po-1', text: 'Export', pass: null, word: 'being built', mark: 'live' },
    { id: 'R-qa-2', text: 'Tested', pass: null },
  ]);
  assert.deepEqual(Object.keys(ownsOf({ ids: ['R-po-1'], texts: {} })[0]), ['id', 'text', 'pass'], 'no shown: D2\'s row');
});

test('run-facts.mjs is pure: no import from src/core or ui/', () => {
  const src = readFileSync(new URL('../src/shared/shape/run-facts.mjs', import.meta.url), 'utf8');
  for (const m of src.matchAll(/^\s*import\b[^'"]*['"]([^'"]+)['"]/gm)) assert.doesNotMatch(m[1], /(^|\/)(core|ui)\//, m[1]);
});
