import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import {
  insertRunTags, editRunTags, readRunTags, readTagsFor, readTagEvents, tagVocabulary,
} from '../src/core/run-tags-store.mjs';

useTempHome(after, 'worca-run-tags-store-');

test('insertRunTags stores one row per tag; invalid input is dropped, never thrown', () => {
  seedPipelineRow({ id: 'aaaaaaaa' });
  assert.deepEqual(insertRunTags('aaaaaaaa', ['spike', 'Client: Acme', 'client:']), ['client:acme', 'spike']);
  assert.deepEqual(readRunTags('aaaaaaaa'), ['client:acme', 'spike']);
  assert.equal(getDb().prepare("SELECT count(*) n FROM run_tags WHERE pipeline_id = 'aaaaaaaa'").get().n, 2);
  assert.deepEqual(insertRunTags('aaaaaaaa', 'nope'), []);
});

test('editRunTags replaces the set and records actor, before and after; a no-op records nothing', () => {
  seedPipelineRow({ id: 'bbbbbbbb' });
  insertRunTags('bbbbbbbb', ['client:acme', 'spike']);
  const r = editRunTags('bbbbbbbb', ['Client:Globex'], { actor: 'ada@x.io', now: new Date('2026-10-15T10:00:00Z') });
  assert.deepEqual(r, { tags: ['client:globex'], before: ['client:acme', 'spike'], changed: true });
  assert.deepEqual(readRunTags('bbbbbbbb'), ['client:globex']);
  assert.deepEqual(readTagEvents('bbbbbbbb'), [{ ts: '2026-10-15T10:00:00.000Z', actor: 'ada@x.io',
    before: ['client:acme', 'spike'], after: ['client:globex'] }]);
  assert.equal(editRunTags('bbbbbbbb', ['client:globex']).changed, false);
  assert.equal(readTagEvents('bbbbbbbb').length, 1);
  assert.throws(() => editRunTags('bbbbbbbb', ['client:']), (e) => e.code === 'BAD_TAGS');
  assert.deepEqual(readRunTags('bbbbbbbb'), ['client:globex']);
});

test('readTagsFor maps many runs at once; tagVocabulary skips archived runs and orders by use', () => {
  seedPipelineRow({ id: 'c0000001' });
  seedPipelineRow({ id: 'c0000002' });
  seedPipelineRow({ id: 'c0000003' });
  insertRunTags('c0000001', ['client:zeta', 'team:web']);
  insertRunTags('c0000002', ['client:zeta']);
  insertRunTags('c0000003', ['client:hidden']);
  getDb().prepare("UPDATE pipelines SET archived_at = '2026-10-01' WHERE id = 'c0000003'").run();
  const m = readTagsFor(['c0000001', 'c0000002', 'c0000003', 'ffffffff']);
  assert.deepEqual(m.get('c0000001'), ['client:zeta', 'team:web']);
  assert.deepEqual(m.get('c0000002'), ['client:zeta']);
  assert.deepEqual(m.get('c0000003'), ['client:hidden']);
  assert.equal(m.has('ffffffff'), false);
  const v = tagVocabulary();
  assert.equal(v.keys[0].key, 'client');
  assert.equal(v.keys[0].valued, true);
  assert.equal(v.values.client[0].value, 'zeta');
  assert.equal(v.values.client[0].count, 2);
  assert.equal(v.values.client.some((x) => x.value === 'hidden'), false);
  assert.ok(v.keys.find((k) => k.key === 'spike')?.plain);
});
