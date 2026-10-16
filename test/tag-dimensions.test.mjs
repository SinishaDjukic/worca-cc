// test/tag-dimensions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseDimensions, missingRequired, splitByDimensions, mergeDimensions, dimensionLabel, tagGroupOptions, MAX_DIMENSIONS } from '../src/shared/tag-dimensions.mjs';

test('normaliseDimensions: keeps good entries, one error per bad entry, first key wins', () => {
  const { dims, errors } = normaliseDimensions([
    { key: 'CC', label: ' Cost centre ', values: ['4410', ' 4420 ', '4410', '', '  ', 7], required: true },
    { key: 'bad key!', label: 'X' },
    { key: 'cc', label: 'Duplicate' },
    { key: 'client', label: 'Client' },
  ]);
  assert.deepEqual(dims, [
    { key: 'cc', label: 'Cost centre', values: ['4410', '4420'], required: true },
    { key: 'client', label: 'Client', values: [], required: false },
  ]);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /tag name/);
  assert.match(errors[1], /cc.*listed twice/);
  assert.deepEqual(normaliseDimensions(undefined), { dims: [], errors: [] });
  assert.deepEqual(normaliseDimensions('nope').errors, ['tag dimensions must be a list']);
});

test('normaliseDimensions: at most MAX_DIMENSIONS', () => {
  const many = Array.from({ length: MAX_DIMENSIONS + 1 }, (_, i) => ({ key: `k${i}`, label: `K${i}` }));
  const { dims, errors } = normaliseDimensions(many);
  assert.equal(dims.length, MAX_DIMENSIONS);
  assert.deepEqual(errors, [`at most ${MAX_DIMENSIONS} tag dimensions`]);
});

test('missingRequired: only required keys with no tag, plain or valued', () => {
  const dims = normaliseDimensions([{ key: 'cc', label: 'Cost centre', required: true }, { key: 'client', label: 'Client' }]).dims;
  assert.deepEqual(missingRequired(dims, ['client:acme']).map((d) => d.key), ['cc']);
  assert.deepEqual(missingRequired(dims, ['cc:4410']), []);
  assert.deepEqual(missingRequired(dims, ['cc']), []);
  assert.deepEqual(missingRequired([], []), []);
});

test('splitByDimensions: dimension keys go to slots, the rest stay free-form', () => {
  const dims = [{ key: 'cc', label: 'Cost centre', values: [], required: false }];
  assert.deepEqual(splitByDimensions(['cc:4410', 'client:acme', 'spike'], dims), { slots: { cc: '4410' }, rest: ['client:acme', 'spike'] });
});

test('mergeDimensions + labels + group options', () => {
  const a = [{ key: 'cc', label: 'Cost centre', values: ['4410'], required: true }];
  const b = [{ key: 'cc', label: 'CC (local)', values: [], required: false }, { key: 'client', label: 'Client', values: [], required: false }];
  assert.deepEqual(mergeDimensions([a, b]).map((d) => d.label), ['Cost centre', 'Client']);
  assert.equal(dimensionLabel(a, 'cc'), 'Cost centre');
  assert.equal(dimensionLabel(a, 'spike'), null);
  assert.deepEqual(tagGroupOptions(a, ['spike', 'cc']), [
    { value: 'tag:cc', text: 'Group by Cost centre' }, { value: 'tag:spike', text: 'Group by tag: spike' },
  ]);
  assert.deepEqual(tagGroupOptions([], ['client']), [{ value: 'tag:client', text: 'Group by tag: client' }]);
});
