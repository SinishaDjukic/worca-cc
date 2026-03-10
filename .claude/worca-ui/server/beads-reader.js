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

export function listIssuesByExternalRef(beadsDb, externalRef) {
  let db;
  try {
    db = new Database(beadsDb, { readonly: true, fileMustExist: true });
    const rows = db.prepare(
      `SELECT id, title, description AS body, status, priority, created_at, external_ref
       FROM issues WHERE external_ref = ?
       ORDER BY priority ASC, id ASC`
    ).all(externalRef);

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
