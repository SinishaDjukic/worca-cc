import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

test('v61 adds run_presets to a v60 DB, names unique per owner ignoring case', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE run_presets; PRAGMA user_version = 60');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 61);
  assert.deepEqual(db.prepare('PRAGMA table_info(run_presets)').all().map((c) => c.name),
    ['id', 'name', 'scope_kind', 'scope_ref', 'setup', 'created_by', 'created_at', 'updated_at']);
  const ins = db.prepare("INSERT INTO run_presets (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, 'x', 'x')");
  ins.run('rp_1', 'Quick fix', null);
  assert.throws(() => ins.run('rp_2', 'quick FIX', null), /UNIQUE/);
  ins.run('rp_3', 'Quick fix', 'ana');
});
