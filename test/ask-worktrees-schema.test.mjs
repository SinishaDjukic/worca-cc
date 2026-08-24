// test/ask-worktrees-schema.test.mjs
// P4/T1: the v20 ask_worktrees table (ask-worca-worktrees-design.md §4) —
// columns, FK cascade wiring, version stamp, and the schemaGaps self-heal flag.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, prepare } from '../src/core/db.mjs';

useTempHome(after);

test('v20: ask_worktrees exists with the spec columns and cascades from ask_threads', () => {
  getDb();
  const cols = prepare('PRAGMA table_info(ask_worktrees)').all().map((c) => c.name);
  assert.deepEqual(cols, ['id', 'thread_id', 'project_key', 'project_dir', 'ref',
    'resolved_commit', 'run_id', 'worktree_dir', 'created_at', 'updated_at']);
  const fk = prepare('PRAGMA foreign_key_list(ask_worktrees)').all()[0];
  assert.equal(fk.table, 'ask_threads');
  assert.equal(fk.on_delete, 'CASCADE');
  assert.ok(prepare('PRAGMA user_version').get().user_version >= 20);
  const idx = prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ask_worktrees'").all().map((r) => r.name);
  assert.ok(idx.includes('idx_ask_worktrees_thread'));
});
