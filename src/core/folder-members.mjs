// Workspace Folder members (P5): each Folder member of a workspace run keeps its folder-run files under
// <pipelineDir>/members/<memberKey>/ (P1a's FOLDER_FILES shape); its copy lives at <worcaHome>/runs/<pipelineId>/repos/<memberKey>. Never runs git.
import { join } from 'node:path';
import { rm, lstat } from 'node:fs/promises';
import { folderFiles } from './project-kind.mjs';
import { folderCopyRoot } from './folder-copy.mjs';
import { PROJECT_KEY_RE } from './store.mjs';
import { readRunManifest, updateRunManifest, copyRunManifestTo, rmGuarded, liveRetainMembers } from './run-manifest.mjs';

export const FOLDER_MEMBERS_DIR = 'members';
const PIPELINE_ID_RE = /^[0-9a-f]{8}$/;

/**
 * The folder-run files of one workspace member: `{ dir, manifest, changes, patch, skipped }` under
 * `<pipelineDir>/members/<memberKey>/`. Throws on a key that is not a project key, so no `/` or `..` reaches the path.
 * @param {string} pipelineDir
 * @param {string} memberKey
 */
export function folderMemberFiles(pipelineDir, memberKey) {
  if (typeof memberKey !== 'string' || !PROJECT_KEY_RE.test(memberKey)) throw new Error(`not a member key: ${memberKey}`);
  return folderFiles(join(pipelineDir, FOLDER_MEMBERS_DIR, memberKey));
}

/**
 * After one member's Apply or Discard: remove its copy, drop it from run.json's retain, and when no retained member is
 * left (a commit-failed Git member's worktree keeps it) and no other pending copy (`pendingMembers`: the fresh row's
 * `folderApplyRetainFor(row).members` — run.json may lack the retain teardown never wrote) copy run.json into the
 * pipeline dir and remove the run root. The copy path is built from trusted parts only (worca home + 8-hex run id +
 * project key), never from a record, and is removed only while it is the run's own folder (folderCopyRoot): the OS
 * follows every folder above it, and the agent may swap `repos/` or `runs/<id>` for a link. `rmGuarded` on the
 * run root unlinks such a link without following it. `removed`: the copy is gone.
 */
export async function releaseFolderMember({ worcaHome, pipelineId, pipelineDir, memberKey, pendingMembers = null } = {}) {
  const none = { removed: false, runRootRemoved: false };
  if (!worcaHome || !PIPELINE_ID_RE.test(String(pipelineId ?? '')) || !PROJECT_KEY_RE.test(String(memberKey ?? ''))) return none;
  const runRoot = join(worcaHome, 'runs', pipelineId);
  const copy = join(runRoot, 'repos', memberKey);
  let removed = true;
  if (await folderCopyRoot(copy, { pipelineId, key: memberKey, home: worcaHome })) {
    try { await rm(copy, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch (e) {
      removed = false;
      console.warn(`[worca] folder run ${pipelineId}: could not remove the copy of ${memberKey}: ${e?.message || e}`);
    }
  } else if (await lstat(copy).then(() => true, () => false)) {
    removed = false;
    console.warn(`[worca] folder run ${pipelineId}: left ${copy} in place: it is not the run's own copy folder (a link?)`);
  }
  const man = await readRunManifest(runRoot);
  // No manifest: the root is already gone (both calls below would create it) — the copy is all there was to remove.
  if (!man) return { removed, runRootRemoved: false };
  const left = (Array.isArray(man.retain?.members) ? man.retain.members : []).filter((m) => m?.projectKey !== memberKey);
  const retain = left.length ? { ...man.retain, members: left } : null;
  await updateRunManifest(runRoot, { retain });
  const pending = (Array.isArray(pendingMembers) ? pendingMembers : []).filter((m) => m?.projectKey !== memberKey);
  if (liveRetainMembers(retain).length || pending.length) return { removed, runRootRemoved: false };
  await copyRunManifestTo(runRoot, pipelineDir);
  const r = await rmGuarded(runRoot, { worcaHome, pipelineId });
  return { removed, runRootRemoved: !!r.removed };
}

/** One { state, counts } for a run from its Folder members' records: pending while any is, else applied when any was. */
export function rollupChanges(list) {
  const items = (Array.isArray(list) ? list : []).filter((c) => c && typeof c === 'object');
  if (!items.length) return null;
  const counts = { added: 0, modified: 0, deleted: 0 };
  for (const c of items) for (const k of Object.keys(counts)) counts[k] += Number(c.counts?.[k]) || 0;
  const state = items.some((c) => c.state === 'pending') ? 'pending' : items.some((c) => c.state === 'applied') ? 'applied' : 'discarded';
  return { state, counts };
}
