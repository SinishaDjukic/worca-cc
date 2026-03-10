import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dbExists, listIssues, getIssue } from './beads-reader.js';

let tmpDir, dbPath;

function setupDb(rows = [], deps = []) {
  tmpDir = mkdtempSync(join(tmpdir(), 'beads-test-'));
  dbPath = join(tmpDir, 'beads.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE issues (id INTEGER PRIMARY KEY, title TEXT, body TEXT,
      status TEXT, priority TEXT, created_at TEXT);
    CREATE TABLE issue_dependencies (issue_id INTEGER, depends_on_id INTEGER);
  `);
  const insertIssue = db.prepare(
    'INSERT INTO issues VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertDep = db.prepare(
    'INSERT INTO issue_dependencies VALUES (?, ?)'
  );
  for (const r of rows) insertIssue.run(r.id, r.title, r.body, r.status, r.priority, r.created_at || '');
  for (const d of deps) insertDep.run(d.issue_id, d.depends_on_id);
  db.close();
}

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

describe('dbExists', () => {
  it('returns false for non-existent path', () => {
    expect(dbExists('/tmp/nonexistent-beads-db-12345/beads.db')).toBe(false);
  });

  it('returns true when the db file exists', () => {
    setupDb();
    expect(dbExists(dbPath)).toBe(true);
  });
});

describe('listIssues', () => {
  it('returns [] for non-existent path', () => {
    expect(listIssues('/tmp/nonexistent-beads-db-12345/beads.db')).toEqual([]);
  });

  it('excludes done and cancelled issues', () => {
    setupDb([
      { id: 1, title: 'Open', body: '', status: 'ready', priority: 'high' },
      { id: 2, title: 'Done', body: '', status: 'done', priority: 'high' },
      { id: 3, title: 'Cancelled', body: '', status: 'cancelled', priority: 'low' },
    ]);
    const issues = listIssues(dbPath);
    expect(issues.length).toBe(1);
    expect(issues[0].title).toBe('Open');
  });

  it('returns correct depends_on array', () => {
    setupDb(
      [
        { id: 1, title: 'A', body: '', status: 'ready', priority: 'high' },
        { id: 2, title: 'B', body: '', status: 'ready', priority: 'high' },
      ],
      [{ issue_id: 2, depends_on_id: 1 }]
    );
    const issues = listIssues(dbPath);
    const issueB = issues.find(i => i.id === 2);
    expect(issueB.depends_on).toEqual([1]);
  });

  it('issue with done dependency has blocked_by = []', () => {
    setupDb(
      [
        { id: 1, title: 'Done dep', body: '', status: 'done', priority: 'high' },
        { id: 2, title: 'B', body: '', status: 'ready', priority: 'high' },
      ],
      [{ issue_id: 2, depends_on_id: 1 }]
    );
    const issues = listIssues(dbPath);
    const issueB = issues.find(i => i.id === 2);
    expect(issueB.blocked_by).toEqual([]);
  });

  it('issue with open dependency has blocked_by = [depId]', () => {
    setupDb(
      [
        { id: 1, title: 'Open dep', body: '', status: 'ready', priority: 'high' },
        { id: 2, title: 'B', body: '', status: 'ready', priority: 'high' },
      ],
      [{ issue_id: 2, depends_on_id: 1 }]
    );
    const issues = listIssues(dbPath);
    const issueB = issues.find(i => i.id === 2);
    expect(issueB.blocked_by).toEqual([1]);
  });

  it('issue with no dependencies has depends_on = [] and blocked_by = []', () => {
    setupDb([
      { id: 1, title: 'Standalone', body: '', status: 'ready', priority: 'high' },
    ]);
    const issues = listIssues(dbPath);
    expect(issues[0].depends_on).toEqual([]);
    expect(issues[0].blocked_by).toEqual([]);
  });

  it('returns [] on corrupt DB without throwing', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'beads-test-'));
    dbPath = join(tmpDir, 'beads.db');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE wrong_table (x TEXT)');
    db.close();
    expect(listIssues(dbPath)).toEqual([]);
  });
});

describe('getIssue', () => {
  it('returns null for non-existent ID', () => {
    setupDb([
      { id: 1, title: 'A', body: '', status: 'ready', priority: 'high' },
    ]);
    expect(getIssue(dbPath, 999)).toBeNull();
  });

  it('returns correct issue with depends_on and blocked_by', () => {
    setupDb(
      [
        { id: 1, title: 'Dep', body: 'dep body', status: 'ready', priority: 'high' },
        { id: 2, title: 'Main', body: 'main body', status: 'ready', priority: 'medium' },
      ],
      [{ issue_id: 2, depends_on_id: 1 }]
    );
    const issue = getIssue(dbPath, 2);
    expect(issue.title).toBe('Main');
    expect(issue.depends_on).toEqual([1]);
    expect(issue.blocked_by).toEqual([1]);
  });

  it('with a done dependency: blocked_by is empty', () => {
    setupDb(
      [
        { id: 1, title: 'Done', body: '', status: 'done', priority: 'high' },
        { id: 2, title: 'Main', body: '', status: 'ready', priority: 'high' },
      ],
      [{ issue_id: 2, depends_on_id: 1 }]
    );
    const issue = getIssue(dbPath, 2);
    expect(issue.depends_on).toEqual([1]);
    expect(issue.blocked_by).toEqual([]);
  });

  it('returns null on corrupt DB without throwing', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'beads-test-'));
    dbPath = join(tmpDir, 'beads.db');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE wrong_table (x TEXT)');
    db.close();
    expect(getIssue(dbPath, 1)).toBeNull();
  });
});
