import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { normaliseLabel, normaliseLabels, labelHue, labelStates, pickerRows, matchesLabels, applyLabelChange,
  splitShown, LABEL_HUES, MAX_LABELS } from '../src/shared/run-labels.mjs';

test('labelHue: stable per word, case and spaces folded, always a palette hue', () => checkRows([
  { name: 'needs demo', run: () => assert.equal(labelHue('needs demo'), 'violet') },
  { name: 'case + spaces', run: () => assert.equal(labelHue('Needs  Demo'), labelHue('needs demo')) },
  { name: 'hotfix', run: () => assert.equal(labelHue('hotfix'), 'slate') },
  { name: 'spike', run: () => assert.equal(labelHue('spike'), 'lime') },
  { name: 'repeat calls', run: () => assert.equal(labelHue('foobar'), labelHue('foobar')) },
  { name: 'in palette', run: () => assert.ok(['a', 'b', 'c', 'release', 'acme', ''].every((w) => LABEL_HUES.includes(labelHue(w)))) },
]));

test('normaliseLabels: folds, dedupes in order, refuses empty, long, control and over 50', () => {
  assert.deepEqual(normaliseLabels(['Hotfix', ' needs   demo ', 'hotfix']), { labels: ['hotfix', 'needs demo'], errors: [] });
  assert.equal(normaliseLabel('  ').error, 'a label needs a word');
  assert.match(normaliseLabel('x'.repeat(33)).error, /at most 32/);
  assert.match(normaliseLabel('a\u0007b').error, /control/);
  assert.deepEqual(normaliseLabels(Array.from({ length: MAX_LABELS + 1 }, (_, i) => `l${i}`)).errors, ['at most 50 labels per run']);
  assert.deepEqual(normaliseLabels('hotfix').errors, ['labels must be a list of strings']);
});

test('labelStates: all, some, absent', () => {
  const s = labelStates([['hotfix', 'spike'], ['hotfix'], ['spike']]);
  assert.deepEqual([...s], [['hotfix', 'some'], ['spike', 'some']]);
  assert.equal(labelStates([['hotfix'], ['hotfix']]).get('hotfix'), 'all');
});

test('pickerRows: on-target first, prefix before contains, create only for a new valid word', () => {
  const used = [{ label: 'spike', count: 5 }, { label: 'hotfix', count: 3 }, { label: 'needs demo', count: 1 }];
  const states = new Map([['needs demo', 'some']]);
  assert.deepEqual(pickerRows({ used, states }).rows.map((r) => [r.label, r.state]),
    [['needs demo', 'some'], ['spike', 'none'], ['hotfix', 'none']]);
  assert.deepEqual(pickerRows({ query: 'hot', used }), { rows: [{ label: 'hotfix', count: 3, state: 'none' }], create: 'hot' });
  assert.equal(pickerRows({ query: 'Hotfix', used }).create, null);
  assert.equal(pickerRows({ query: 'release', used, allowCreate: false }).create, null);
  assert.deepEqual(pickerRows({ query: 's', used: [{ label: 'needs demo', count: 9 }, { label: 'spike', count: 1 }] }).rows.map((r) => r.label),
    ['spike', 'needs demo'], 'a prefix match ranks before a contains match');
});

test('matchesLabels is any-of; applyLabelChange keeps order; splitShown caps at 2', () => {
  assert.equal(matchesLabels(['spike'], ['hotfix', 'spike']), true);
  assert.equal(matchesLabels(['spike'], ['hotfix']), false);
  assert.equal(matchesLabels([], []), true);
  assert.deepEqual(applyLabelChange(['a', 'b'], { add: ['c', 'a'], remove: ['b'] }), ['a', 'c']);
  assert.deepEqual(splitShown(['a', 'b', 'c', 'd']), { shown: ['a', 'b'], more: 2 });
});
