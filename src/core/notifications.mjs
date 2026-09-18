// src/core/notifications.mjs
// The generic, append-only notification log (schema v31). Today only scope
// 'schedule' is written — every scheduled-run event (missed, failed, skipped, late,
// self-paused, completed) lands here — but the table carries a `scope` column so an
// app-wide centre can reuse it without a second system.
//
// Read state is GLOBAL (Worca is single-user per machine). `info` rows arrive
// already read: only `problem` rows count towards the unread badge. A problem
// RESOLVES itself when the user acts on it (Run now, reschedule, resume), so stale
// alarms never pile up.
//
// Sync (node:sqlite) like every other store module. Listeners registered with
// onNotification() fire in THIS process only; a row written by another process
// (a `--wait` CLI) is picked up by the server tick through latestNotificationId().

import { getDb } from './db.mjs';

export const NOTIFICATION_SEVERITIES = ['problem', 'info'];
export const NOTIFICATION_RETENTION_DAYS = 90;

const listeners = new Set();

/** Subscribe to rows added in this process. Returns a disposer. */
export function onNotification(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function rowToNotification(r) {
  if (!r) return null;
  return {
    id: r.id,
    scope: r.scope,
    kind: r.kind,
    severity: r.severity,
    scheduleId: r.schedule_id || null,
    ticketId: r.ticket_id || null,
    pipelineId: r.pipeline_id || null,
    projectDir: r.project_dir || null,
    title: r.title || null,
    message: r.message,
    createdAt: r.created_at,
    readAt: r.read_at || null,
    resolvedAt: r.resolved_at || null,
    unread: !r.read_at && r.severity === 'problem',
  };
}

/**
 * Append one notification. `info` rows are stamped read at creation.
 * @returns {object} the stored notification
 */
export function addNotification({
  scope = 'schedule', kind, severity = 'problem', scheduleId = null, ticketId = null,
  pipelineId = null, projectDir = null, title = null, message, now = new Date(),
}) {
  if (!kind || !message) throw new Error('addNotification: kind and message are required');
  const sev = NOTIFICATION_SEVERITIES.includes(severity) ? severity : 'problem';
  const ts = now.toISOString();
  const info = getDb().prepare(`
    INSERT INTO notifications (scope, kind, severity, schedule_id, ticket_id, pipeline_id, project_dir, title, message, created_at, read_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(scope, kind, sev, scheduleId, ticketId, pipelineId, projectDir, title, String(message), ts, sev === 'info' ? ts : null);
  const row = rowToNotification(getDb().prepare('SELECT * FROM notifications WHERE id = ?').get(Number(info.lastInsertRowid)));
  for (const fn of listeners) {
    try { fn(row); } catch { /* a listener must never break the writer */ }
  }
  return row;
}

/**
 * List notifications, newest first.
 * @param {{scope?:string, unread?:boolean, problems?:boolean, scheduleId?:string, limit?:number}} [o]
 */
export function listNotifications({ scope = 'schedule', unread = false, problems = false, scheduleId = null, limit = 200 } = {}) {
  const where = ['scope = ?'];
  const args = [scope];
  if (unread) where.push("read_at IS NULL AND severity = 'problem'");
  if (problems) where.push("severity = 'problem'");
  if (scheduleId) { where.push('schedule_id = ?'); args.push(scheduleId); }
  const lim = Math.max(1, Math.min(1000, Number(limit) || 200));
  return getDb().prepare(`SELECT * FROM notifications WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${lim}`)
    .all(...args).map(rowToNotification);
}

/** Unread PROBLEM rows in a scope — the sidebar badge. */
export function unreadCount(scope = 'schedule') {
  return getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE scope = ? AND read_at IS NULL AND severity = 'problem'").get(scope).n;
}

/** Highest id in the table (0 when empty) — a cheap cross-process change probe. */
export function latestNotificationId() {
  return getDb().prepare('SELECT COALESCE(MAX(id), 0) AS n FROM notifications').get().n;
}

/** Mark one row read (or unread with `read:false`). @returns {boolean} whether a row changed */
export function markRead(id, { read = true, now = new Date() } = {}) {
  const info = getDb().prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(read ? now.toISOString() : null, Number(id));
  return info.changes > 0;
}

/** Mark every unread row of a scope read. @returns {number} rows changed */
export function markAllRead(scope = 'schedule', { now = new Date() } = {}) {
  return getDb().prepare('UPDATE notifications SET read_at = ? WHERE scope = ? AND read_at IS NULL').run(now.toISOString(), scope).changes;
}

/**
 * Resolve (and mark read) the open problems of a ticket and/or schedule — called when
 * the user acts on them. `kinds` narrows it; omitted = every problem kind.
 * @returns {number} rows changed
 */
export function resolveNotifications({ ticketId = null, scheduleId = null, kinds = null, now = new Date() } = {}) {
  if (!ticketId && !scheduleId) return 0;
  const where = ["severity = 'problem'", 'resolved_at IS NULL'];
  const args = [];
  if (ticketId) { where.push('ticket_id = ?'); args.push(ticketId); }
  if (scheduleId) { where.push('schedule_id = ?'); args.push(scheduleId); }
  if (Array.isArray(kinds) && kinds.length) { where.push(`kind IN (${kinds.map(() => '?').join(', ')})`); args.push(...kinds); }
  const ts = now.toISOString();
  return getDb().prepare(`UPDATE notifications SET resolved_at = ?, read_at = COALESCE(read_at, ?) WHERE ${where.join(' AND ')}`)
    .run(ts, ts, ...args).changes;
}

/** Drop rows older than the retention window. @returns {number} rows removed */
export function purgeNotifications({ days = NOTIFICATION_RETENTION_DAYS, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString();
  return getDb().prepare('DELETE FROM notifications WHERE created_at < ?').run(cutoff).changes;
}
