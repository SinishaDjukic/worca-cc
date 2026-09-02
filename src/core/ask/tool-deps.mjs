// src/core/ask/tool-deps.mjs
// The REAL reader bundle for tools.mjs. tools.mjs itself must not import db.mjs
// (its source is scanned for writes); everything that opens the DB or the store
// is wired here and injected. Used by mcp-stdio.mjs (the child) and by tests.
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  listAllPipelines, lookupPipelineRow, findPipelineRowById, totalsFor, readStoreMeta, runDirForRow,
} from '../artifacts.mjs';
import { DIFF_PATCH_FILE } from '../results.mjs';
import { GUARDRAIL_PRESETS } from '../guardrails.mjs';
import { buildCatalog } from './catalog.mjs';
import { validateProposal } from './proposal.mjs';
import { readAttachmentText, getThread } from './store.mjs';
import { redactAskText } from './redact.mjs';
import { ASK_LIMITS } from './limits.mjs';

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

/**
 * @param {{threadId:string}} opts  attachments are readable only for this thread (spec §6.4 read_attachment)
 */
export function defaultToolDeps({ threadId }) {
  return {
    buildCatalog,
    listAllPipelines,
    lookupPipelineRow,
    findPipelineRowById,
    totalsFor,
    readStoreMeta,
    readDiffPatch,
    hasDiffPatch,
    readAttachment: (id) => {
      const a = threadId ? readAttachmentText(threadId, id) : null;
      return a ? { name: a.name, text: a.text } : null;
    },
    validateProposal,
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
