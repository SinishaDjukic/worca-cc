// test/db-migrate-v71.test.mjs — v71 (G13): a fresh install starts runs on Normal guardrails;
// an install upgraded from before v71 keeps Permissive as its default (a store_meta row).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const KEY = 'guardrails:default';
const row = (db) => db.prepare('SELECT kind, data FROM store_meta WHERE key = ?').get(KEY);

test('a fresh DB carries no default row: new installs fall through to Normal', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  assert.ok(SCHEMA_VERSION >= 71);
  assert.equal(row(db), undefined);
});

test('a v70 DB upgrades with Permissive recorded as its default (today\'s behaviour kept)', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  db.exec('PRAGMA user_version = 70');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual({ ...row(db) }, { kind: 'setting', data: '"permissive"' });
});

test('an install that already chose a default keeps it through the upgrade', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  db.prepare('INSERT INTO store_meta (key, kind, data) VALUES (?, ?, ?)').run(KEY, 'setting', '"secure"');
  db.exec('PRAGMA user_version = 70');
  migrate(db);
  assert.equal(row(db).data, '"secure"');
});
