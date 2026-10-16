import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import {
  insertRunTags, editRunTags, readRunTags, readTagsFor, readTagEvents, tagVocabulary, lastUsedTags,
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

test('lastUsedTags: this person\'s newest tagged pipeline in the project; others, other projects and untagged runs ignored', () => {
  const row = (id, key, by, at) => getDb().prepare(`
    INSERT INTO pipelines (id, project_key, target, title, status, phase, cycle, started_at, updated_at, started_by)
    VALUES (?, ?, 'project', 't', 'done', 'done', 1, ?, ?, ?)`).run(id, key, at, at, by);
  row('lu000001', 'web-1', 'ana@x.io', '2026-10-01T10:00:00Z'); insertRunTags('lu000001', ['cc:4410']);
  row('lu000002', 'web-1', 'ana@x.io', '2026-10-02T10:00:00Z'); insertRunTags('lu000002', ['cc:4420', 'spike']);
  row('lu000003', 'web-1', 'ana@x.io', '2026-10-03T10:00:00Z');                                   // newer, untagged
  row('lu000004', 'web-1', 'bo@x.io', '2026-10-04T10:00:00Z'); insertRunTags('lu000004', ['cc:9999']);
  row('lu000005', 'api-2', 'ana@x.io', '2026-10-05T10:00:00Z'); insertRunTags('lu000005', ['cc:1111']);
  assert.deepEqual(lastUsedTags('web-1', 'ana@x.io'), ['cc:4420', 'spike']);
  assert.deepEqual(lastUsedTags('web-1', 'cy@x.io'), []);
  assert.deepEqual(lastUsedTags('web-1', null), []);
});
