import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dbExists, listIssues, listIssuesByLabel, listUnlinkedIssues, listDistinctRunLabels, getIssue } from './beads-reader.js';

let tmpDir, dbPath;

function setupDb(rows = [], deps = [], labels = []) {
  tmpDir = mkdtempSync(join(tmpdir(), 'beads-test-'));
  dbPath = join(tmpDir, 'beads.db');
  const db = new Database(dbPath);
  db.prepare(`CREATE TABLE issues (id TEXT PRIMARY KEY, title TEXT, description TEXT,
      status TEXT, priority INTEGER, created_at TEXT, external_ref TEXT)`).run();
  db.prepare(`CREATE TABLE dependencies (issue_id TEXT, depends_on_id TEXT)`).run();
  db.prepare(`CREATE TABLE labels (issue_id TEXT NOT NULL, label TEXT NOT NULL, PRIMARY KEY (issue_id, label))`).run();
  const insertIssue = db.prepare(
    'INSERT INTO issues (id, title, description, status, priority, created_at, external_ref) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertDep = db.prepare(
    'INSERT INTO dependencies VALUES (?, ?)'
  );
  const insertLabel = db.prepare(
    'INSERT INTO labels VALUES (?, ?)'
  );
  for (const r of rows) insertIssue.run(r.id, r.title, r.body || '', r.status, r.priority, r.created_at || '', r.external_ref || null);
  for (const d of deps) insertDep.run(d.issue_id, d.depends_on_id);
  for (const l of labels) insertLabel.run(l.issue_id, l.label);
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

  it('excludes closed and tombstone issues', () => {
    setupDb([
      { id: '1', title: 'Open', body: '', status: 'open', priority: 2 },
      { id: '2', title: 'Closed', body: '', status: 'closed', priority: 2 },
      { id: '3', title: 'Tombstone', body: '', status: 'tombstone', priority: 3 },
    ]);
    const issues = listIssues(dbPath);
    expect(issues.length).toBe(1);
    expect(issues[0].title).toBe('Open');
  });

  it('returns correct depends_on array', () => {
    setupDb(
      [
        { id: '1', title: 'A', body: '', status: 'open', priority: 2 },
        { id: '2', title: 'B', body: '', status: 'open', priority: 2 },
      ],
      [{ issue_id: '2', depends_on_id: '1' }]
    );
    const issues = listIssues(dbPath);
    const issueB = issues.find(i => i.id === '2');
    expect(issueB.depends_on).toEqual(['1']);
  });

  it('issue with closed dependency has blocked_by = []', () => {
    setupDb(
      [
        { id: '1', title: 'Closed dep', body: '', status: 'closed', priority: 2 },
        { id: '2', title: 'B', body: '', status: 'open', priority: 2 },
      ],
      [{ issue_id: '2', depends_on_id: '1' }]
    );
    const issues = listIssues(dbPath);
    const issueB = issues.find(i => i.id === '2');
    expect(issueB.blocked_by).toEqual([]);
  });

  it('issue with open dependency has blocked_by = [depId]', () => {
    setupDb(
      [
        { id: '1', title: 'Open dep', body: '', status: 'open', priority: 2 },
        { id: '2', title: 'B', body: '', status: 'open', priority: 2 },
      ],
      [{ issue_id: '2', depends_on_id: '1' }]
    );
    const issues = listIssues(dbPath);
    const issueB = issues.find(i => i.id === '2');
    expect(issueB.blocked_by).toEqual(['1']);
  });

  it('issue with no dependencies has depends_on = [] and blocked_by = []', () => {
    setupDb([
      { id: '1', title: 'Standalone', body: '', status: 'open', priority: 2 },
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
      { id: '1', title: 'A', body: '', status: 'open', priority: 2 },
    ]);
    expect(getIssue(dbPath, '999')).toBeNull();
  });

  it('returns correct issue with depends_on and blocked_by', () => {
    setupDb(
      [
        { id: '1', title: 'Dep', body: 'dep body', status: 'open', priority: 2 },
        { id: '2', title: 'Main', body: 'main body', status: 'open', priority: 2 },
      ],
      [{ issue_id: '2', depends_on_id: '1' }]
    );
    const issue = getIssue(dbPath, '2');
    expect(issue.title).toBe('Main');
    expect(issue.depends_on).toEqual(['1']);
    expect(issue.blocked_by).toEqual(['1']);
  });

  it('with a closed dependency: blocked_by is empty', () => {
    setupDb(
      [
        { id: '1', title: 'Closed', body: '', status: 'closed', priority: 2 },
        { id: '2', title: 'Main', body: '', status: 'open', priority: 2 },
      ],
      [{ issue_id: '2', depends_on_id: '1' }]
    );
    const issue = getIssue(dbPath, '2');
    expect(issue.depends_on).toEqual(['1']);
    expect(issue.blocked_by).toEqual([]);
  });

  it('returns null on corrupt DB without throwing', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'beads-test-'));
    dbPath = join(tmpDir, 'beads.db');
    const db = new Database(dbPath);
    db.prepare('CREATE TABLE wrong_table (x TEXT)').run();
    db.close();
    expect(getIssue(dbPath, '1')).toBeNull();
  });
});

describe('listIssuesByLabel', () => {
  it('returns issues matching the given label', () => {
    setupDb(
      [
        { id: '1', title: 'A', body: '', status: 'open', priority: 2 },
        { id: '2', title: 'B', body: '', status: 'open', priority: 2 },
        { id: '3', title: 'C', body: '', status: 'open', priority: 2 },
      ],
      [],
      [
        { issue_id: '1', label: 'run:run-1' },
        { issue_id: '2', label: 'run:run-1' },
        { issue_id: '3', label: 'run:run-2' },
      ]
    );
    const issues = listIssuesByLabel(dbPath, 'run:run-1');
    expect(issues.length).toBe(2);
    expect(issues.map(i => i.title).sort()).toEqual(['A', 'B']);
  });

  it('returns [] when no issues match', () => {
    setupDb(
      [{ id: '1', title: 'A', body: '', status: 'open', priority: 2 }],
      [],
      [{ issue_id: '1', label: 'run:run-1' }]
    );
    expect(listIssuesByLabel(dbPath, 'run:run-999')).toEqual([]);
  });
});

describe('listUnlinkedIssues', () => {
  it('returns only issues without run label', () => {
    setupDb(
      [
        { id: '1', title: 'Linked', body: '', status: 'open', priority: 2 },
        { id: '2', title: 'Unlinked', body: '', status: 'open', priority: 2 },
        { id: '3', title: 'Other label', body: '', status: 'open', priority: 2 },
      ],
      [],
      [
        { issue_id: '1', label: 'run:run-1' },
        { issue_id: '3', label: 'component:auth' },
      ]
    );
    const issues = listUnlinkedIssues(dbPath);
    expect(issues.length).toBe(2);
    expect(issues.map(i => i.title).sort()).toEqual(['Other label', 'Unlinked']);
  });

  it('excludes closed issues', () => {
    setupDb([
      { id: '1', title: 'Closed unlinked', body: '', status: 'closed', priority: 2 },
      { id: '2', title: 'Open unlinked', body: '', status: 'open', priority: 2 },
    ]);
    const issues = listUnlinkedIssues(dbPath);
    expect(issues.length).toBe(1);
    expect(issues[0].title).toBe('Open unlinked');
  });
});

describe('listDistinctRunLabels', () => {
  it('returns distinct run: labels', () => {
    setupDb(
      [
        { id: '1', title: 'A', body: '', status: 'open', priority: 2 },
        { id: '2', title: 'B', body: '', status: 'open', priority: 2 },
        { id: '3', title: 'C', body: '', status: 'open', priority: 2 },
      ],
      [],
      [
        { issue_id: '1', label: 'run:run-1' },
        { issue_id: '2', label: 'run:run-1' },
        { issue_id: '3', label: 'run:run-2' },
      ]
    );
    const refs = listDistinctRunLabels(dbPath);
    expect(refs.sort()).toEqual(['run:run-1', 'run:run-2']);
  });

  it('returns [] when no run labels exist', () => {
    setupDb([
      { id: '1', title: 'A', body: '', status: 'open', priority: 2 },
    ]);
    expect(listDistinctRunLabels(dbPath)).toEqual([]);
  });

  it('ignores non-run labels', () => {
    setupDb(
      [{ id: '1', title: 'A', body: '', status: 'open', priority: 2 }],
      [],
      [{ issue_id: '1', label: 'component:auth' }]
    );
    expect(listDistinctRunLabels(dbPath)).toEqual([]);
  });
});
