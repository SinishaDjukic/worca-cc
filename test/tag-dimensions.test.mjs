// test/tag-dimensions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseDimensions, missingRequired, splitByDimensions, mergeDimensions, dimensionLabel, tagGroupOptions, MAX_DIMENSIONS } from '../src/shared/tag-dimensions.mjs';
import { prefillTags, tagProblems, tagsProblemText, keyFromLabel } from '../src/shared/tag-dimensions.mjs';

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
    { value: 'tag:cc', text: 'Group by Cost centre' }, { value: 'tag:spike', text: 'Group by cost tag: spike' },
  ]);
  assert.deepEqual(tagGroupOptions([], ['client']), [{ value: 'tag:client', text: 'Group by cost tag: client' }]);
});

const CC = { key: 'cc', label: 'Cost centre', values: ['4410', '4420'], required: true };
const CLIENT = { key: 'client', label: 'Client', values: [], required: false };

test('normaliseDimension: default is optional, squashed, and must be one of the values when there are values', () => {
  assert.deepEqual(normaliseDimensions([{ key: 'cc', label: 'Cost centre', values: ['4410'], default: ' 4410 ' }]).dims,
    [{ key: 'cc', label: 'Cost centre', values: ['4410'], required: false, default: '4410' }]);
  assert.deepEqual(normaliseDimensions([{ key: 'client', label: 'Client', default: 'ACME' }]).dims[0].default, 'acme');
  assert.equal('default' in normaliseDimensions([{ key: 'client', label: 'Client', default: '' }]).dims[0], false);
  assert.equal('default' in normaliseDimensions([{ key: 'client', label: 'Client' }]).dims[0], false);
  assert.match(normaliseDimensions([{ key: 'cc', label: 'Cost centre', values: ['4410'], default: '9999' }]).errors[0], /cc: the default must be one of its values/);
  assert.match(normaliseDimensions([{ key: 'cc', label: 'Cost centre', default: 7 }]).errors[0], /cc: the default must be text/);
});

test('prefillTags: project default → Default → last used (mandatory only); filled keys are never overwritten', () => {
  const dims = [{ ...CC, default: '4420' }, { ...CLIENT, default: 'acme' }];
  assert.deepEqual(prefillTags(dims, [], { projectDefaults: ['cc:4410'], lastUsed: [] }), ['cc:4410', 'client:acme']);
  assert.deepEqual(prefillTags(dims, [], {}), ['cc:4420', 'client:acme']);
  assert.deepEqual(prefillTags([CC], [], { lastUsed: ['cc:4420'] }), ['cc:4420']);
  assert.deepEqual(prefillTags([CLIENT], [], { lastUsed: ['client:globex'] }), [], 'last used never fills an optional tag');
  assert.deepEqual(prefillTags([CC], ['cc:4420', 'spike'], { projectDefaults: ['cc:4410'] }), ['cc:4420', 'spike']);
  assert.deepEqual(prefillTags([CC], ['cc'], { projectDefaults: ['cc:4410'] }), ['cc:4410'], 'a plain key has no value yet');
});

test('prefillTags: a candidate outside the values is passed over for the next source', () => {
  assert.deepEqual(prefillTags([CC], [], { projectDefaults: ['cc:9999'], lastUsed: ['cc:4420'] }), ['cc:4420']);
  assert.deepEqual(prefillTags([CC], [], { projectDefaults: ['cc:9999'] }), []);
});

test('tagProblems / tagsProblemText: missing before off-list, labels joined', () => {
  const two = [CC, { ...CLIENT, required: true }];
  assert.equal(tagsProblemText(two, []), 'Add Cost centre and Client to start');
  assert.equal(tagsProblemText([CC], ['cc:9999']), 'Cost centre "9999" is not one of its values (4410, 4420)');
  assert.equal(tagsProblemText([CC], ['cc:4410']), null);
  assert.equal(tagsProblemText([CLIENT], ['client:anything']), null, 'no values = free text');
  assert.deepEqual(tagProblems([CC], ['cc']).missing.map((d) => d.key), ['cc']);
});

test('keyFromLabel: lower-case, dashes, valid key characters only, at most 32', () => {
  assert.equal(keyFromLabel('Cost centre'), 'cost-centre');
  assert.equal(keyFromLabel('  Team / Squad!! '), 'team-squad');
  assert.equal(keyFromLabel('x'.repeat(40)).length, 32);
  assert.equal(keyFromLabel('!!!'), '');
});
