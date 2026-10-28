// test/cost-tag-suggest.test.mjs — cost tag autocomplete order and the New run auto-fill (slice s2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestKeys, suggestValues, autoFillTags } from '../src/shared/cost-tag-suggest.mjs';

const DIMS = [
  { key: 'team', label: 'Team', values: [], required: false },
  { key: 'client', label: 'Client', values: [], required: true },
  { key: 'cc', label: 'Cost centre', values: ['4410', '4420'], required: false },
];
const VOCAB = { keys: [{ key: 'spike', count: 2, plain: true, valued: false }, { key: 'epic', count: 9, valued: true }, { key: 'team', count: 50, valued: true }],
  values: { epic: [{ value: 'old', count: 8, lastAt: '2026-10-01T00:00:00Z' }, { value: 'new', count: 1, lastAt: '2026-10-19T00:00:00Z' }] } };

test('key suggestions: required policy keys, then other policy keys, then project keys by use count', () => {
  assert.deepEqual(suggestKeys({ dims: DIMS, vocab: VOCAB }).map((k) => [k.key, k.source]),
    [['client', 'required'], ['team', 'policy'], ['cc', 'policy'], ['epic', 'project'], ['spike', 'project']]);
});

test('value suggestions: the policy list when set, else the values used with the key newest first', () => {
  assert.deepEqual(suggestValues({ key: 'cc', dims: DIMS, vocab: VOCAB }), ['4410', '4420']);
  assert.deepEqual(suggestValues({ key: 'epic', dims: DIMS, vocab: VOCAB }), ['new', 'old']);
  assert.deepEqual(suggestValues({ key: 'nope', dims: DIMS, vocab: VOCAB }), []);
});

test('auto-fill (#923): the project defaults, never the last run\'s free-form tags; a mandatory key takes its last value, an optional one does not', () => {
  assert.deepEqual(autoFillTags({ dims: DIMS, lastUsed: ['cc:4420', 'client:acme', 'project:redesign', 'team:web', 'type:polish'], projectDefaults: ['team:ops'] }),
    { tags: ['client:acme', 'team:ops'], from: 'defaults' });
  assert.deepEqual(autoFillTags({ dims: DIMS, lastUsed: ['client:acme', 'project:redesign'] }), { tags: ['client:acme'], from: null });
  assert.deepEqual(autoFillTags({ dims: DIMS, projectDefaults: ['cc:9999', 'spike'] }), { tags: ['spike'], from: 'defaults' }, 'an off-list default drops');
  assert.deepEqual(autoFillTags({ dims: DIMS }), { tags: [], from: null });
});
