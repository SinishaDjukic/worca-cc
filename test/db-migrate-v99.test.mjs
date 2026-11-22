// test/db-migrate-v99.test.mjs — chats with a design are plain chats: a design chat made before (ask_threads.mode
// 'design') becomes a plain chat on the v99 rung, once, and its design still points at it (designs.thread_id).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const modes = (db) => Object.fromEntries(db.prepare('SELECT id, mode FROM ask_threads ORDER BY id').all().map((r) => [r.id, r.mode]));

test('a v98 DB: design chats become plain chats, other modes stay, the design keeps its chat', () => {
  const db = new DatabaseSync(':memory:'); migrate(db); assert.ok(SCHEMA_VERSION >= 99);
  const t = (id, mode) => db.prepare("INSERT INTO ask_threads (id, title, mode, created_at, updated_at) VALUES (?, 'x', ?, 'x', 'x')").run(id, mode);
  t('ask_0000000a', 'design'); t('ask_0000000b', 'composer'); t('ask_0000000c', null);
  db.prepare("INSERT INTO designs (id, title, kind, thread_id, created_at, updated_at) VALUES ('d_000000000001', 'T', 'web', 'ask_0000000a', 'x', 'x')").run();
  db.exec('PRAGMA user_version = 98');
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.deepEqual(modes(db), { ask_0000000a: null, ask_0000000b: 'composer', ask_0000000c: null });
  assert.equal(db.prepare("SELECT thread_id FROM designs WHERE id = 'd_000000000001'").get().thread_id, 'ask_0000000a');
});

test('stamped current: the rung does not run again (nothing rewrites a row on open)', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  db.prepare("INSERT INTO ask_threads (id, title, mode, created_at, updated_at) VALUES ('ask_0000000d', 'x', 'design', 'x', 'x')").run();
  migrate(db);
  assert.equal(modes(db).ask_0000000d, 'design');
});
