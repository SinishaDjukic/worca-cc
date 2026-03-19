import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

export function dbExists(beadsDb) {
  return existsSync(beadsDb);
}

export function listIssues(beadsDb) {
  let db;
  try {
    db = new Database(beadsDb, { readonly: true, fileMustExist: true });
    const rows = db.prepare(
      `SELECT id, title, description AS body, status, priority, created_at, external_ref
       FROM issues
       WHERE status NOT IN ('closed','tombstone')
       ORDER BY priority ASC, id ASC`
    ).all();

    const depStmt = db.prepare(
      `SELECT depends_on_id FROM dependencies WHERE issue_id = ?`
    );
    const statusMap = new Map(rows.map(r => [r.id, r.status]));

    return rows.map(row => {
      const depends_on = depStmt.all(row.id).map(d => d.depends_on_id);
      const blocked_by = depends_on.filter(depId => statusMap.has(depId));
      return { ...row, depends_on, blocked_by };
    });
  } catch {
    return [];
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

export function listIssuesByLabel(beadsDb, label) {
  let db;
  try {
    db = new Database(beadsDb, { readonly: true, fileMustExist: true });
    const rows = db.prepare(
      `SELECT i.id, i.title, i.description AS body, i.status, i.priority, i.created_at
       FROM issues i
       JOIN labels l ON l.issue_id = i.id
       WHERE l.label = ?
       ORDER BY i.priority ASC, i.id ASC`
    ).all(label);

    const depStmt = db.prepare(
      `SELECT depends_on_id FROM dependencies WHERE issue_id = ?`
    );
    const statusMap = new Map(rows.map(r => [r.id, r.status]));

    return rows.map(row => {
      const depends_on = depStmt.all(row.id).map(d => d.depends_on_id);
      const blocked_by = depends_on.filter(depId => {
        const s = statusMap.get(depId);
        return s && s !== 'closed';
      });
      return { ...row, depends_on, blocked_by };
    });
  } catch {
    return [];
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

export function listUnlinkedIssues(beadsDb) {
  let db;
  try {
    db = new Database(beadsDb, { readonly: true, fileMustExist: true });
    const rows = db.prepare(
      `SELECT i.id, i.title, i.description AS body, i.status, i.priority, i.created_at
       FROM issues i
       WHERE NOT EXISTS (
         SELECT 1 FROM labels l WHERE l.issue_id = i.id AND l.label LIKE 'run:%'
       )
       AND i.status NOT IN ('closed','tombstone')
       ORDER BY i.priority ASC, i.id ASC`
    ).all();

    const depStmt = db.prepare(
      `SELECT depends_on_id FROM dependencies WHERE issue_id = ?`
    );
    const statusMap = new Map(rows.map(r => [r.id, r.status]));

    return rows.map(row => {
      const depends_on = depStmt.all(row.id).map(d => d.depends_on_id);
      const blocked_by = depends_on.filter(depId => statusMap.has(depId));
      return { ...row, depends_on, blocked_by };
    });
  } catch {
    return [];
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

export function countIssuesByRunLabel(beadsDb) {
  let db;
  try {
    db = new Database(beadsDb, { readonly: true, fileMustExist: true });
    const rows = db.prepare(
      `SELECT l.label, COUNT(*) AS count FROM labels l
       WHERE l.label LIKE 'run:%' GROUP BY l.label`
    ).all();
    const counts = {};
    for (const row of rows) {
      const runId = row.label.replace('run:', '');
      counts[runId] = row.count;
    }
    return counts;
  } catch {
    return {};
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

export function listDistinctRunLabels(beadsDb) {
  let db;
  try {
    db = new Database(beadsDb, { readonly: true, fileMustExist: true });
    const rows = db.prepare(
      `SELECT DISTINCT label FROM labels WHERE label LIKE 'run:%'`
    ).all();
    return rows.map(r => r.label);
  } catch {
    return [];
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

export function getIssue(beadsDb, id) {
  let db;
  try {
    db = new Database(beadsDb, { readonly: true, fileMustExist: true });
    const row = db.prepare(
      `SELECT id, title, description AS body, status, priority, created_at, external_ref
       FROM issues WHERE id = ?`
    ).get(id);
    if (!row) return null;

    const depends_on = db.prepare(
      `SELECT depends_on_id FROM dependencies WHERE issue_id = ?`
    ).all(id).map(d => d.depends_on_id);

    const blocked_by = [];
    for (const depId of depends_on) {
      const dep = db.prepare(
        `SELECT status FROM issues WHERE id = ?`
      ).get(depId);
      if (dep && dep.status !== 'closed' && dep.status !== 'tombstone') {
        blocked_by.push(depId);
      }
    }
    return { ...row, depends_on, blocked_by };
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}
