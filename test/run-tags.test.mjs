import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { parseTag, normaliseTags, hasTag, describeTagChange, parseTagGroupBy, MAX_TAGS } from '../src/shared/run-tags.mjs';

test('normaliseTags trims, lower-cases, sorts and keeps one value per key', () => checkRows([
  { name: 'trim + lower + sort', run: () => assert.deepEqual(normaliseTags(['Client: Acme ', 'spike']), { tags: ['client:acme', 'spike'], errors: [] }) },
  { name: 'last value wins', run: () => assert.deepEqual(normaliseTags(['client:acme', 'CLIENT:Globex']).tags, ['client:globex']) },
  { name: 'spaces in a key become -', run: () => assert.deepEqual(normaliseTags(['Cost Centre: 4100']).tags, ['cost-centre:4100']) },
  { name: 'commas and non-ASCII values', run: () => assert.deepEqual(normaliseTags(['client:Müller & Söhne,  GmbH']).tags, ['client:müller & söhne, gmbh']) },
  { name: 'sorted by key', run: () => assert.deepEqual(normaliseTags(['team:web', 'client:acme']).tags, ['client:acme', 'team:web']) },
]));

test('normaliseTags reports every bad entry', () => checkRows([
  { name: 'undefined = no tags', run: () => assert.deepEqual(normaliseTags(undefined), { tags: [], errors: [] }) },
  { name: 'not a list', run: () => assert.equal(normaliseTags('client:acme').errors[0], 'tags must be a list of strings') },
  { name: 'not a string', run: () => assert.match(parseTag(5).error, /must be a string/) },
  { name: 'empty value', run: () => assert.match(parseTag('client:').error, /needs a value/) },
  { name: 'empty name', run: () => assert.match(parseTag('  ').error, /needs a name/) },
  { name: 'bad key', run: () => assert.match(parseTag('bad key!').error, /tag name/) },
  { name: 'long value', run: () => assert.match(parseTag(`k:${'x'.repeat(65)}`).error, /at most 64/) },
  { name: 'control chars', run: () => assert.match(parseTag('k:a\u0007b').error, /control characters/) },
  { name: 'two errors', run: () => assert.equal(normaliseTags(['client:', 'bad key!']).errors.length, 2) },
  { name: 'too many', run: () => {
    const many = Array.from({ length: MAX_TAGS + 1 }, (_, i) => `k${i}`);
    assert.match(normaliseTags(many).errors.at(-1), /at most 20/);
  } },
  { name: 'exactly 20 is fine', run: () => assert.deepEqual(normaliseTags(Array.from({ length: MAX_TAGS }, (_, i) => `k${i}`)).errors, []) },
]));

test('hasTag matches a key alone or an exact key:value', () => checkRows([
  { name: 'key alone', run: () => assert.equal(hasTag(['client:acme'], 'client'), true) },
  { name: 'exact, any case', run: () => assert.equal(hasTag(['client:acme'], 'Client:ACME'), true) },
  { name: 'other value', run: () => assert.equal(hasTag(['client:acme'], 'client:globex'), false) },
  { name: 'empty list', run: () => assert.equal(hasTag([], 'spike'), false) },
  { name: 'plain tag', run: () => assert.equal(hasTag(['spike'], 'spike'), true) },
]));

test('describeTagChange lists additions then removals', () => {
  assert.equal(describeTagChange(['client:acme'], ['client:globex']), '+client:globex −client:acme');
  assert.equal(describeTagChange(['a'], ['a']), 'no change');
});

test('parseTagGroupBy: a key after tag:, else null', () => {
  assert.equal(parseTagGroupBy('tag:client'), 'client');
  for (const bad of ['tag:', 'tag:Bad Key', 'tag', 'workflow', '', null, undefined, 42]) assert.equal(parseTagGroupBy(bad), null);
});
