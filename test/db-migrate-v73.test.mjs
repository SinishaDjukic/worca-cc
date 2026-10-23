// test/db-migrate-v73.test.mjs — v73: automation_rules.scope / workspace_id and automation_events.prs (workspace Git
// event automations). A v72 rule and its events survive and read as a project's.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

test('v73 adds the rule scope and a fix\'s member PRs to a v72 DB, keeping its rules and events', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  // Back to v72's shape, with one rule and one event in it.
  db.exec(`ALTER TABLE automation_rules DROP COLUMN scope; ALTER TABLE automation_rules DROP COLUMN workspace_id;
    ALTER TABLE automation_events DROP COLUMN prs; ALTER TABLE automation_events DROP COLUMN started_at; PRAGMA user_version = 72`);
  const at = '2026-10-22T10:00:00.000Z';
  db.prepare(`INSERT INTO automation_rules (id, project_key, project_dir, repo, event, action, filter, limits, origin, enabled, enabled_at, created_at, updated_at)
    VALUES ('aut_1', 'proj-1', '/repo', 'o/r', 'issue.opened', 'fix', '{}', '{}', 'auto-handle', 1, ?, ?, ?)`).run(at, at, at);
  db.prepare(`INSERT INTO automation_events (id, rule_id, project_key, repo, subject, kind, number, via, status, pr_url, created_at, updated_at)
    VALUES ('aev_1', 'aut_1', 'proj-1', 'o/r', 'issue:o/r#1', 'issue', 1, 'poll', 'done', 'https://github.com/o/r/pull/2', ?, ?)`).run(at, at);
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 73);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  assert.ok(cols('automation_rules').includes('scope') && cols('automation_rules').includes('workspace_id'));
  assert.ok(cols('automation_events').includes('prs') && cols('automation_events').includes('started_at'));
  assert.deepEqual({ ...db.prepare('SELECT id, scope, workspace_id, repo, action FROM automation_rules').get() },
    { id: 'aut_1', scope: 'project', workspace_id: null, repo: 'o/r', action: 'fix' });
  assert.deepEqual({ ...db.prepare('SELECT id, pr_url, prs, started_at FROM automation_events').get() },
    { id: 'aev_1', pr_url: 'https://github.com/o/r/pull/2', prs: null, started_at: null });
});
