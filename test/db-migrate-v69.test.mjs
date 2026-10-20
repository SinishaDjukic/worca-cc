// test/db-migrate-v69.test.mjs — v69: projects.vcs + its one-shot, stat-only backfill (U12).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, SCHEMA_VERSION, getDb, _resetForTests } from '../src/core/db.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useTempHome(after);
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), `worca-v69-${p}-`)); dirs.push(d); return d; };
const kinds = (db) => Object.fromEntries(db.prepare('SELECT key, vcs FROM projects ORDER BY key').all().map((r) => [r.key, r.vcs]));

test('a fresh DB has projects.vcs', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  assert.ok(SCHEMA_VERSION >= 69);
  assert.ok(db.prepare('PRAGMA table_info(projects)').all().some((c) => c.name === 'vcs'));
});

test('the ladder from 68 backfills once: folder without .git → none, .git or a missing path → git; never re-inferred', () => {
  const plain = tmp('plain'); const repo = tmp('repo'); mkdirSync(join(repo, '.git'));
  const db = new DatabaseSync(':memory:'); migrate(db);
  db.exec('ALTER TABLE projects DROP COLUMN vcs');            // no index names it, so DROP is allowed
  const ins = db.prepare("INSERT INTO projects (key, name, path, created_at) VALUES (?, ?, ?, '2026-10-17T00:00:00.000Z')");
  ins.run('plain-00000001', 'plain', plain); ins.run('repo-00000002', 'repo', repo); ins.run('gone-00000003', 'gone', join(plain, 'nope'));
  db.exec('PRAGMA user_version = 68'); migrate(db);
  assert.deepEqual(kinds(db), { 'gone-00000003': 'git', 'plain-00000001': 'none', 'repo-00000002': 'git' });
  mkdirSync(join(plain, '.git'));                              // a later .git never flips the stored kind
  db.exec('PRAGMA user_version = 68'); migrate(db);
  assert.equal(kinds(db)['plain-00000001'], 'none');
});

test('a minimal hand-seeded DB without a projects table migrates past v69', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE pipelines (id TEXT PRIMARY KEY); CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);');
  db.exec('PRAGMA user_version = 17');
  assert.doesNotThrow(() => migrate(db));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
});

test('the fs→db import stores vcs by the same rule', () => {
  const plain = tmp('fs-plain'); const repo = tmp('fs-repo'); mkdirSync(join(repo, '.git'));
  _resetForTests();
  mkdirSync(worcaHome(), { recursive: true });
  writeFileSync(join(worcaHome(), 'projects.json'), JSON.stringify([{ name: 'plain', path: plain }, { name: 'repo', path: repo }]));
  const rows = getDb().prepare('SELECT name, vcs FROM projects ORDER BY name').all().map((r) => [r.name, r.vcs]);
  assert.deepEqual(rows, [['plain', 'none'], ['repo', 'git']]);
});
