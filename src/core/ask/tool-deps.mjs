// src/core/ask/tool-deps.mjs
// The REAL reader bundle for tools.mjs. tools.mjs itself must not import db.mjs
// (its source is scanned for writes); everything that opens the DB or the store
// is wired here and injected. Used by mcp-stdio.mjs (the child) and by tests.
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  listAllPipelines, lookupPipelineRow, findPipelineRowById, totalsFor, readStoreMeta, runDirForRow, readMemoryLedger,
  listRunArtifacts, readRunProgress, resolveIndexedArtifactForRow,
} from '../artifacts.mjs';
import { DIFF_PATCH_FILE } from '../results.mjs';
import { GUARDRAIL_PRESETS } from '../guardrails.mjs';
import { buildCatalog } from './catalog.mjs';
import { validateProposal } from './proposal.mjs';
import { readAttachmentText, getAttachment, attachmentPath, getThread, listAttachments } from './store.mjs';
import { redactAskText } from './redact.mjs';
import { ASK_LIMITS } from './limits.mjs';
import { askProgress } from '../ask-projection.mjs';
import { getDb } from '../db.mjs';

/** Who started runs (pipelines.started_by), one row per person, most active first. Scope: a
 *  projectKey or a workspaceKey, else everything. Archived and pre-attribution (NULL) runs are
 *  left out. Read-only. */
export function listPeople({ projectKey = null, workspaceKey = null } = {}) {
  const where = ['started_by IS NOT NULL', "started_by != ''", 'archived_at IS NULL'];
  const args = [];
  if (workspaceKey) { where.push('workspace_key = ?'); args.push(workspaceKey); }
  else if (projectKey) { where.push('project_key = ?'); args.push(projectKey); }
  try {
    return getDb().prepare(`
      SELECT MIN(started_by) AS name, COUNT(*) AS runs, MAX(started_at) AS lastRunAt,
             COALESCE(SUM(total_cost_usd), 0) AS totalCostUsd
      FROM pipelines WHERE ${where.join(' AND ')}
      GROUP BY lower(started_by)
      ORDER BY runs DESC, lastRunAt DESC
      LIMIT 200
    `).all(...args);
  } catch { return []; }
}

/** The human actions on one run (pipeline_events.actor, identity.mjs): { at, by, what }, oldest
 *  first, at most 50. `what` is the audit line without its markdown emphasis. Read-only. */
export function readRunActions(row) {
  try {
    return getDb().prepare('SELECT ts, text, actor FROM pipeline_events WHERE pipeline_id = ? AND actor IS NOT NULL ORDER BY id LIMIT 50')
      .all(row.id)
      .map((r) => ({ at: r.ts, by: r.actor, what: String(r.text).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 300) }));
  } catch { return []; }
}

/** The patch file of a run row, or null when there is none (results.mjs#DIFF_PATCH_FILE only — never a caller path). */
export async function readDiffPatch(row) {
  try {
    const dir = await runDirForRow(row);
    return await readFile(join(dir, DIFF_PATCH_FILE), 'utf8');
  } catch {
    return null;
  }
}

export async function hasDiffPatch(row) {
  try {
    const dir = await runDirForRow(row);
    await access(join(dir, DIFF_PATCH_FILE));
    return true;
  } catch {
    return false;
  }
}

/** The run's memory changes from its ledger (artifacts.mjs#readMemoryLedger) as { changes, totals },
 *  or null when the run has none — get_run then carries no `memory` key at all. The mount path is
 *  dropped: it is a directory of THIS machine, never something the model should see. Read-only. */
export async function readRunMemory(row) {
  try {
    const ledger = await readMemoryLedger(await runDirForRow(row));
    if (!ledger || !ledger.changes.length) return null;
    return { changes: ledger.changes, totals: ledger.totals };
  } catch { return null; }
}

/**
 * @param {{threadId:string}} opts  attachments are readable only for this thread (spec §6.4 read_attachment)
 */
export function defaultToolDeps({ threadId, viewer = null }) {
  return {
    // The person signed in to this chat on a shared sign-in (WORCA_ASK_READER), else null: list_runs "me".
    viewer: typeof viewer === 'string' && viewer ? viewer : null,
    listPeople,
    readRunActions,
    buildCatalog,
    listAllPipelines,
    lookupPipelineRow,
    findPipelineRowById,
    totalsFor,
    readStoreMeta,
    readDiffPatch,
    hasDiffPatch,
    readRunMemory,
    listRunArtifacts: (row, filter) => listRunArtifacts(row.id, filter),
    readRunArtifact: (row, rel) => resolveIndexedArtifactForRow(row, rel), // {rel, text}|null
    readRunProgress: (row) => readRunProgress(row.id),
    // Ask forms (spec D9, ruling X17): a persisted form round as text for the model.
    // Injected, never imported — tools.mjs stays import-free by house rule.
    askProgress,
    readAttachment: (id) => {
      const row = threadId ? getAttachment(threadId, id) : null;
      if (!row) return null;
      if (row.kind === 'text') {
        const a = readAttachmentText(threadId, id);
        return a ? { name: a.name, kind: 'text', text: a.text } : null;
      }
      // Binary kinds (#398): metadata plus the on-disk path — the model views the
      // body with its own Read tool; sliceBytes over raw bytes would be garbage.
      // attachmentPath is null when the body is gone (DB-only restore, an external
      // sweep of ask/<t>/att): the same not-found the text branch reports, never a
      // path whose Read then fails with a raw ENOENT the model may retry.
      const path = attachmentPath(threadId, id);
      return path ? { name: row.name, kind: row.kind, mime: row.mime, bytes: row.bytes, path } : null;
    },
    validateProposal,
    // The run card's attachment pills (propose_run attachmentIds): the ledger of
    // the owning thread only — never another thread's files. An unreadable DB means
    // "no attachments", never an error: tools.call does not catch handler throws, so
    // a locked store would otherwise make the model unable to propose at all.
    listAttachments: () => {
      if (!threadId) return [];
      try { return listAttachments(threadId); } catch { return []; }
    },
    // #397: the user-pinned scope of the owning thread — {projectKey}|{workspaceId}|
    // null — read fresh from the thread row per call, so a selector change lands on
    // the very next tool call. A missing thread or an unreadable DB means "nothing
    // pinned", never an error.
    pinnedScope: () => {
      if (!threadId) return null;
      let c = null;
      try { c = getThread(threadId)?.context ?? null; } catch { return null; }
      if (!c || c.pinned !== true) return null;
      if (typeof c.projectKey === 'string' && c.projectKey) return { projectKey: c.projectKey };
      if (typeof c.workspaceId === 'string' && c.workspaceId) return { workspaceId: c.workspaceId };
      return null;
    },
    // The SECURE preset is the floor, not the run's own set: guardrailsId defaults
    // to 'permissive' (empty protectedPaths), so resolving per row would show the
    // model every credential file on most runs. This only ever omits more.
    protectedPaths: [...GUARDRAIL_PRESETS.secure.protectedPaths],
    redact: redactAskText,
    limits: ASK_LIMITS,
  };
}
