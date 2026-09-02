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
import { readAttachmentText, getAttachment, attachmentPath } from './store.mjs';
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
    // The SECURE preset is the floor, not the run's own set: guardrailsId defaults
    // to 'permissive' (empty protectedPaths), so resolving per row would show the
    // model every credential file on most runs. This only ever omits more.
    protectedPaths: [...GUARDRAIL_PRESETS.secure.protectedPaths],
    redact: redactAskText,
    limits: ASK_LIMITS,
  };
}
