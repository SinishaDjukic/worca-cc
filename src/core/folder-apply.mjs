// src/core/folder-apply.mjs — Folder runs (Projects, any way, P1 Task 9): the run's Changes, the apply plan,
// Apply to folder and Discard. The core functions take a TARGET ({ realDir, copyDir, files, memberKey }), never
// "the run" (S23, S27, P5 S4): P5 adds the workspace members through folderMemberTarget's second arm.
// This is the ONLY code that writes the real folder, and only on Apply. Never runs git.
// Paths in every payload are `/`-separated; path.join per segment happens only at the fs boundary.
import { createHash, randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { lstat, stat, readlink, symlink, unlink, rmdir, mkdir, chmod, rename, rm, readdir, writeFile, realpath } from 'node:fs/promises';
import { join, dirname, basename, resolve, relative, sep } from 'node:path';
import { folderFiles } from './project-kind.mjs';
import { folderMemberFiles } from './folder-members.mjs';
import {
  readFolderManifest, scanChanges, buildChangesPatch, writeChangesFiles, writeChangesJson, readChangesFile, rewriteLinkTarget,
  safeRelPath, folderCopyRoot, openRegular, hashHandle, copyHandle, readlinkInside,
} from './folder-copy.mjs';
import { appendAuditById, recordArtifact } from './artifacts.mjs';
import { byActor } from './identity.mjs';
import { getDb, tx } from './db.mjs';
import { worcaHome } from './projects.mjs';
import { readRunManifest, updateRunManifest, copyRunManifestTo, rmGuarded } from './run-manifest.mjs';

const isWin = process.platform === 'win32';
const sha1Text = (t) => createHash('sha1').update(String(t)).digest('hex');
const msgOf = (err) => err?.message || String(err);

/** The routes' refusal form (P5 S-P5-c): `status` is the HTTP status, `code` the machine code. */
export class FolderApplyError extends Error {
  constructor(status, code, message, state) {
    super(message);
    this.name = 'FolderApplyError';
    this.status = status;
    this.code = code;
    if (state) this.state = state;
  }
}

const notFolder = () => new FolderApplyError(409, 'NOT_FOLDER_RUN', 'This run does not work on a copy.');
const noChanges = () => new FolderApplyError(404, 'NO_CHANGES', "The run's changes are gone.");
const settled = (state) => new FolderApplyError(409, 'CHANGES_SETTLED',
  state === 'applied' ? 'These changes were already applied to the folder.' : 'These changes were discarded.', state);

/**
 * S27: the member a request names. Single project: memberKey null/absent or the run's own key → the one member.
 * P5 adds the workspace arm (same signature).
 */
export function folderMemberTarget(state, memberKey, pipelineDir) {
  if (state?.target === 'workspace') return workspaceMemberTarget(state, memberKey, pipelineDir);
  const mode = state?.workMode ?? state?.branch?.workMode ?? 'git';
  if (!state || mode !== 'folder') throw notFolder();
  if (memberKey != null && memberKey !== '' && memberKey !== state.projectKey) {
    throw new FolderApplyError(400, 'BAD_MEMBER', "memberKey does not name this run's project");
  }
  const br = state.branch && typeof state.branch === 'object' ? state.branch : {};
  return {
    realDir: br.realDir || state.projectDir || null,
    copyDir: br.copyDir || null,
    files: folderFiles(pipelineDir),
    memberKey: state.projectKey ?? null,
    pipelineId: state.id ?? null,                                // with memberKey: where the copy must be (folderCopyRoot)
  };
}

/** P5 (S27): a workspace member. Its recorded mode (workspace_meta.projects[i].workMode) decides; a Git member is no copy. */
function workspaceMemberTarget(state, memberKey, pipelineDir) {
  const key = typeof memberKey === 'string' ? memberKey.trim() : '';
  if (!key) throw new FolderApplyError(400, 'BAD_MEMBER', 'memberKey is required for a workspace run');
  const project = (Array.isArray(state.projects) ? state.projects : []).find((p) => p && p.projectKey === key);
  if (!project) throw new FolderApplyError(400, 'BAD_MEMBER', `unknown workspace member: ${key.slice(0, 80)}`);
  if (project.workMode !== 'folder') throw notFolder();
  const rec = state.branches && typeof state.branches[key] === 'object' && state.branches[key] ? state.branches[key] : {};
  return {
    realDir: rec.realDir || project.projectDir || null,
    copyDir: rec.copyDir || null,
    files: folderMemberFiles(pipelineDir, key),
    memberKey: key,
    memberName: project.projectName || key,
    pipelineId: state.id ?? null,
  };
}

/** The run's listed changes (live reads allowed). Null when no changes.json exists. */
export async function readFolderChanges(target) {
  const c = await readChangesFile(target.files.changes);
  if (!c) return null;
  return {
    state: c.state || 'pending',
    files: Array.isArray(c.files) ? c.files : [],
    counts: c.counts || { added: 0, modified: 0, deleted: 0 },
    ...(c.appliedAt ? { appliedAt: c.appliedAt } : {}),
    ...(Array.isArray(c.skipped) ? { skipped: c.skipped } : {}),
  };
}

/** A targeted UPDATE of the row's `branch.changes` (P5 adds workspace_meta). Merges `patch` into the record, so the
 *  counts survive Apply and Discard. */
export function writeChangesRecord(pipelineId, patch, { memberKey } = {}) {
  tx(() => writeChangesRecordInTx(pipelineId, patch, { memberKey }));
}

/** writeChangesRecord's UPDATE for a caller already inside tx() (archivePipeline): tx() does not nest. */
export function writeChangesRecordInTx(pipelineId, patch, { memberKey } = {}) {
  const obj = (v) => { try { const o = v ? JSON.parse(v) : null; return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; } };
  const merged = (rec) => ({ ...rec, changes: { ...(rec.changes || {}), ...patch } });
  const row = getDb().prepare('SELECT target, branch, workspace_meta FROM pipelines WHERE id = ?').get(pipelineId);
  if (!row) return;
  const br = obj(row.branch);
  if (row.target === 'workspace') {
    // P5: the member's record in workspace_meta.branches, and the scalar mirror when the member is the primary
    const wm = obj(row.workspace_meta);
    const rec = memberKey && wm?.branches && typeof wm.branches[memberKey] === 'object' ? wm.branches[memberKey] : null;
    if (!rec) return;
    const next = { ...wm, branches: { ...wm.branches, [memberKey]: merged(rec) } };
    const primary = Array.isArray(wm.projects) ? wm.projects[0]?.projectKey : null;
    if (br && primary === memberKey) {
      getDb().prepare('UPDATE pipelines SET workspace_meta = ?, branch = ? WHERE id = ?').run(JSON.stringify(next), JSON.stringify(merged(br)), pipelineId);
    } else {
      getDb().prepare('UPDATE pipelines SET workspace_meta = ? WHERE id = ?').run(JSON.stringify(next), pipelineId);
    }
    return;
  }
  if (!br) return;
  getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify(merged(br)), pipelineId);
}

// v4: a path that is not there is null; any OTHER read error (EACCES, an offline placeholder, a Windows lock) throws,
// and each path's checks run in that path's own `try` — a per-file outcome, never a 500 for the whole Apply.
const ABSENT = new Set(['ENOENT', 'ENOTDIR']);
async function lstatMaybe(p, opts) {
  try { return await lstat(p, opts); } catch (err) { if (ABSENT.has(err?.code)) return null; throw err; }
}
async function isDirectory(p) { try { return (await stat(p)).isDirectory(); } catch { return false; } }
const real = (t, p) => join(t.realDir, ...p.split('/'));
const inCopy = (t, p) => join(t.copyDir, ...p.split('/'));
async function realpathOr(p) { try { return await realpath(p); } catch { return resolve(p); } }
/** The real folder's realpath (null when it cannot be read): the root every open of a real file is checked inside (M3). */
async function realRootOf(t) { try { return await realpath(t.realDir); } catch { return null; } }
/** Both spellings of the copy root: on macOS a copy under /var/… is /private/var/… by realpath (as Task 3 rewrites). */
async function copyRoots(t) { return [resolve(t.copyDir), await realpathOr(t.copyDir)]; }

/** A path from changes.json / the scan: relative, no `..`, no NUL, no empty segment, and it stays inside realDir. */
function validPath(t, p) {
  if (!safeRelPath(p)) return false;                             // c5b: a POSIX name may hold a backslash
  const abs = resolve(real(t, p));
  const root = resolve(t.realDir);
  return abs.startsWith(root.endsWith(sep) ? root : root + sep);
}

const realChanged = () => Object.assign(new Error('the file changed in the folder while it was read'), { code: 'FOLDER_CHANGED' });
/** Type + hash of a REAL entry: { kind: 'file'|'link'|'other', sha1, mode?, target? } or null when absent. Throws on a
 *  read error (the caller's per-path try turns it into changed-in-folder). A file is hashed through one handle opened as
 *  the file the lstat saw, inside `root` (the real folder's realpath) on Linux (n6 / M3): never through a link or a FIFO
 *  swapped in since, nor under a folder swapped for a link. */
async function entryFacts(abs, root) {
  const st = await lstatMaybe(abs);
  if (!st) return null;
  if (st.isSymbolicLink()) { const target = await readlink(abs); return { kind: 'link', sha1: sha1Text(target), target }; }
  if (st.isFile()) {
    const fh = await openRegular(abs, st, { root });
    if (!fh) throw realChanged();
    try { return { kind: 'file', sha1: (await hashHandle(fh)).hex, mode: st.mode & 0o777 }; } finally { await fh.close(); }
  }
  return { kind: 'other' };
}
const realFacts = async (t, p) => entryFacts(real(t, p), await realRootOf(t));
const manifestKind = (m) => (m?.link != null ? 'link' : 'file');

/**
 * True when an existing real ancestor between realDir and the file is not a plain directory — unless that ancestor is
 * itself one of the apply's own deletes (`deletes`): the run turned a file or a link into a folder, so step 5 decides.
 */
async function ancestorBlocked(t, p, deleteByInode = new Map()) {
  const segs = p.split('/');
  let d = t.realDir;
  for (let i = 0; i < segs.length - 1; i++) {
    d = join(d, segs[i]);
    const st = await lstatMaybe(d, { bigint: true });
    if (!st) return false;                      // nothing deeper exists either
    // a file or a link where a folder was — unless it IS a non-skipped delete's entry (dev + ino, c5b: `Data` deleted,
    // `data/f.txt` added on a volume that folds names; by name the add was skipped and the folder held neither)
    if (!st.isDirectory()) return !deleteByInode.has(`${st.dev}:${st.ino}`);
  }
  return false;
}
/** A real folder whose every file (any depth, links not followed) is one of the apply's own deletes, with no empty folder. */
// c5b: decided by dev + ino, never by the add's spelling: `Docs/` turned into a file `docs` on a volume that folds names.
async function onlyDeletesUnder(abs, deleteByInode, deleteDirs) {
  const st = await lstat(abs, { bigint: true });
  if (!deleteDirs.has(`${st.dev}:${st.ino}`)) return false;   // step 4 prunes a folder only from a delete under it
  for (const e of await readdir(abs, { withFileTypes: true })) {
    const a = join(abs, e.name);
    if (e.isDirectory()) { if (!(await onlyDeletesUnder(a, deleteByInode, deleteDirs))) return false; continue; }
    const s = await lstat(a, { bigint: true });
    if (!deleteByInode.has(`${s.dev}:${s.ino}`)) return false;
  }
  return true;
}

/** v4 (A-m6): the target's folder still resolves to realDir or inside it — a folder swapped for a link to elsewhere
 *  while Apply ran is never written through. */
async function stillInsideReal(t, p) {
  try {
    const d = await realpath(dirname(real(t, p)));
    const r = await realpath(t.realDir);
    return d === r || d.startsWith(r.endsWith(sep) ? r : r + sep);
  } catch { return false; }
}

/** The copy-side twin of stillInsideReal: the copy root still passes folderCopyRoot and `p`'s folder resolves inside it —
 *  a copy (or a folder in it) the agent swapped for a link is never read into the real folder or under skipped/. The copy
 *  root (every copy-side open is checked inside it, M3), else null. */
async function insideCopy(t, p) {
  const root = await folderCopyRoot(t.copyDir, { pipelineId: t.pipelineId, key: t.memberKey });
  if (!root) return null;
  try {
    const d = realpathSync(dirname(inCopy(t, p)));
    return d === root || d.startsWith(root.endsWith(sep) ? root : root + sep) ? root : null;
  } catch { return null; }
}
const outsideCopy = (p) => Object.assign(new Error(`refusing to read outside the run's copy: ${p}`), { code: 'COPY_OUTSIDE' });
const copyChanged = (p) => Object.assign(new Error(`the run's copy changed while it was read: ${p}`), { code: 'COPY_CHANGED' });

/** The COPY's entry as the real folder should hold it: { kind, sha1, mode?, target? } (a link's target rewritten
 *  from both copy roots). Throws on a read error, and when `p` no longer resolves inside the run's copy. A file is hashed
 *  through one handle opened as the file the lstat saw (M2): never through a link swapped in since. */
async function copyFacts(t, p) {
  const abs = inCopy(t, p);
  const root = await insideCopy(t, p);
  if (!root) throw outsideCopy(p);
  const st = await lstatMaybe(abs);
  if (!st) return null;
  if (st.isSymbolicLink()) {
    const target = rewriteLinkTarget(await readlinkInside(abs, root), await copyRoots(t), t.realDir);
    return { kind: 'link', sha1: sha1Text(target), target };
  }
  if (st.isFile()) {
    const fh = await openRegular(abs, st, { root });
    if (!fh) throw copyChanged(p);
    try { return { kind: 'file', sha1: (await hashHandle(fh)).hex, mode: st.mode & 0o777 }; } finally { await fh.close(); }
  }
  return { kind: 'other' };
}

/** `have` (the real entry) already holds `want` (the copy's version): the same sha1, type and POSIX mode. */
function inPlace(want, have) {
  if (!want || !have || want.kind !== have.kind) return false;
  if (want.kind === 'link') return have.target === want.target;
  if (want.kind !== 'file' || want.sha1 !== have.sha1) return false;
  return isWin || want.mode === have.mode;
}
/** Call-time "already in place" (a retry after a half-finished Apply). A copy-side read that fails reads as not in place. */
async function alreadyInPlace(t, p) {
  let want;
  try { want = await copyFacts(t, p); } catch { return false; }
  return inPlace(want, await realFacts(t, p));
}

/** The real entry still equals the manifest (the folder as it was when the run started): type, sha1, POSIX mode. */
async function matchesManifest(t, manifest, p) {
  const m = manifest.files?.[p];
  const have = await realFacts(t, p);
  if (!m || !have) return false;
  return have.kind === manifestKind(m) && have.sha1 === m.sha1 && (have.kind !== 'file' || m.mode == null || have.mode === m.mode);
}

/** U10: which planned paths changed in the folder since the run started. Decided at call time; sorted by path. */
async function skippedFor(t, manifest, lists) {
  const out = [];
  const skip = (path) => out.push({ path, reason: 'changed-in-folder' });
  for (const p of [...lists.add, ...lists.update, ...lists.delete]) {
    if (!validPath(t, p)) throw new FolderApplyError(400, 'BAD_PATH', `refusing a path outside the folder: ${p}`);
  }
  const skippedDeletes = new Set();
  for (const p of lists.delete) {
    try {
      if (await ancestorBlocked(t, p)) { skip(p); skippedDeletes.add(p); continue; }
      if (!(await lstatMaybe(real(t, p)))) continue;              // already gone: nothing to do
      if (!(await matchesManifest(t, manifest, p))) { skip(p); skippedDeletes.add(p); }
    } catch { skip(p); skippedDeletes.add(p); }                    // a real-side read that fails: changed-in-folder
  }
  const deletes = new Set(lists.delete.filter((d) => !skippedDeletes.has(d)));   // what step 4 removes
  // One lstat per delete, looked up by dev + ino: a case-only rename of a 3,000-file folder compared every add with
  // every delete (9 M lstats, 48 s for the plan and again for Apply).
  const deleteByInode = new Map();
  const deleteDirs = new Set(); const seenDirs = new Set();      // c5b: every real folder between realDir and a delete
  for (const d of deletes) {
    let ds = null; try { ds = await lstatMaybe(real(t, d), { bigint: true }); } catch { ds = null; }
    if (ds && !ds.isDirectory()) deleteByInode.set(`${ds.dev}:${ds.ino}`, d);
    const segs = d.split('/');
    for (let i = 1; i < segs.length; i++) {
      const rel = segs.slice(0, i).join('/');
      if (seenDirs.has(rel)) continue;
      seenDirs.add(rel);
      let as = null; try { as = await lstatMaybe(real(t, rel), { bigint: true }); } catch { as = null; }
      if (as && as.isDirectory()) deleteDirs.add(`${as.dev}:${as.ino}`);
    }
  }
  for (const p of lists.update) {
    try {
      if (await ancestorBlocked(t, p)) { skip(p); continue; }
      if (await matchesManifest(t, manifest, p)) continue;
      if (await alreadyInPlace(t, p)) continue;
      skip(p);
    } catch { skip(p); }
  }
  for (const p of lists.add) {
    try {
      if (await ancestorBlocked(t, p, deleteByInode)) { skip(p); continue; }
      const st = await lstatMaybe(real(t, p), { bigint: true });
      if (!st) continue;
      // The run turned a folder into a file (or a link): its files are all step 4's deletes, so step 5 decides.
      if (st.isDirectory() && (await onlyDeletesUnder(real(t, p), deleteByInode, deleteDirs))) continue;
      // The add's real entry IS a non-skipped delete's file (the same dev + ino, bigint: a plain ino can lose precision
      // on win32): a rename on a volume that folds names — APFS folds case AND Unicode normalization, NTFS case. Decided
      // by dev + ino alone, never by comparing names or by platform (a case-sensitive darwin volume can hold a separate
      // file of that name). Looked up in a dev:ino map, never every add against every delete (v5).
      const sameAs = deleteByInode.get(`${st.dev}:${st.ino}`);
      if (sameAs !== undefined && sameAs !== p) continue;
      if (await alreadyInPlace(t, p)) continue;
      skip(p);
    } catch { skip(p); }
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Guards shared by plan / apply: NO_CHANGES, CHANGES_SETTLED, FOLDER_MISSING, COPY_MISSING (a copy that is not the
 *  run's own folder — a link swapped in at `repos/<key>` or above — counts as gone). */
async function guarded(t) {
  const changes = await readChangesFile(t.files.changes);
  if (!changes) throw noChanges();
  if (changes.state === 'applied' || changes.state === 'discarded') throw settled(changes.state);
  if (!t.realDir || !(await isDirectory(t.realDir))) throw new FolderApplyError(409, 'FOLDER_MISSING', `The folder is missing: ${t.realDir}`);
  const copyRoot = t.copyDir ? await folderCopyRoot(t.copyDir, { pipelineId: t.pipelineId, key: t.memberKey }) : null;
  const manifest = copyRoot ? await readFolderManifest(t.files.manifest) : null;
  if (!manifest) throw new FolderApplyError(409, 'COPY_MISSING', "The run's copy is gone.");
  return { changes, manifest, copyRoot };
}

const listsOf = (files) => ({
  add: files.filter((f) => f.change === 'added').map((f) => f.path),
  update: files.filter((f) => f.change === 'modified').map((f) => f.path),
  delete: files.filter((f) => f.change === 'deleted').map((f) => f.path),
});

/** The apply dialog's plan: a fresh in-memory re-scan of the copy (nothing written). skipped ⊆ add ∪ update ∪ delete. */
export async function planFolderApply(target) {
  const { changes, manifest, copyRoot } = await guarded(target);
  const scan = await scanChanges(target.copyDir, manifest, { realRoot: target.realDir, exclude: changes.exclude ?? [], copyRoot });
  const lists = listsOf(scan.files);
  return { target: target.realDir, ...lists, skipped: await skippedFor(target, manifest, lists) };
}

async function withReadOnlyRetry(fn, abs) {
  try { return await fn(); } catch (err) {
    if (!isWin || !['EPERM', 'EACCES'].includes(err?.code)) throw err;
    await chmod(abs, 0o666);
    return fn();
  }
}

/** The copy holds a real folder at exactly `rel` (exact name: a case-insensitive lstat would answer for `docs` when asked `Docs`). */
async function copyHasDirNamed(t, rel) {
  const segs = rel.split('/');
  try {
    const ents = await readdir(inCopy(t, segs.slice(0, -1).join('/')), { withFileTypes: true });
    return ents.some((e) => e.name === segs[segs.length - 1] && e.isDirectory());
  } catch { return false; }
}
/** Remove each emptied parent upward with a non-recursive rmdir, stopping at realDir (never rmdir(realDir)), only while
 *  the copy has no directory at that path and the directory is empty. A directory still holding a user file stays. */
async function pruneUp(t, p) {
  const segs = p.split('/').slice(0, -1);
  while (segs.length) {
    const rel = segs.join('/');
    const dir = real(t, rel);
    if (await copyHasDirNamed(t, rel)) return;                   // the copy still has this folder, by its exact name
    let entries;
    try { entries = await readdir(dir); } catch { return; }
    if (entries.length) return;
    try { await rmdir(dir); } catch { return; }
    segs.pop();
  }
}

/** Step 5: write one add / update from the copy. Pushes a skipped entry on refusal; `unreadable` collects the paths
 *  whose COPY could not be read (step 6 does not try to save those). */
async function writeOne(t, manifest, p, kind, skipped, unreadable) {
  const dst = real(t, p);
  const src = inCopy(t, p);
  const failed = (err, copySide = false) => { skipped.push({ path: p, reason: 'failed', message: msgOf(err) }); if (copySide) unreadable.add(p); };
  const changed = () => skipped.push({ path: p, reason: 'changed-in-folder' });
  let cst; let want;
  try { cst = await lstat(src); want = await copyFacts(t, p); } catch (err) { failed(err, true); return; }
  // Already in place (the copy's sha1, type and POSIX mode) — decided here, per file, right before its write and after
  // step 4's deletes ran: a case-only rename's add lstats as the deleted file at call time.
  let have;
  try { have = await realFacts(t, p); } catch { changed(); return; }
  if (inPlace(want, have)) return;
  // A-m6: right before the write, the real target still is what the plan saw (an update: the manifest's sha1; an add:
  // absent) and its folder still resolves inside realDir (v4).
  const stillOk = async () => {
    try {
      const same = kind === 'update' ? await matchesManifest(t, manifest, p) : !(await lstatMaybe(dst));
      return same && (await stillInsideReal(t, p)) && !!(await insideCopy(t, p));
    } catch { return false; }
  };
  try {
    if (await ancestorBlocked(t, p)) { changed(); return; }        // v5: step 4 has run; a file or a link still in the way
    await mkdir(dirname(dst), { recursive: true });
    if (cst.isSymbolicLink()) {
      if (!(await stillOk())) { changed(); return; }
      if (await lstatMaybe(dst)) await withReadOnlyRetry(() => unlink(dst), dst);
      let isDirTarget = false;
      if (isWin) { try { isDirTarget = (await stat(resolve(dirname(dst), want.target))).isDirectory(); } catch { /* a file link */ } }
      await symlink(want.target, dst, isWin ? (isDirTarget ? 'junction' : 'file') : undefined);
      return;
    }
    // c6: `.<name>.worca-<8hex>.tmp` adds 19 bytes; a name past ~236 bytes made it ENAMETOOLONG (never applied)
    const stem = Buffer.byteLength(basename(dst)) > 200 ? '' : `${basename(dst)}.`;
    const tmp = join(dirname(dst), `.${stem}worca-${randomBytes(4).toString('hex')}.tmp`);
    let fh;
    try {
      // M2: the bytes come through ONE handle opened as the file the lstat saw, hashed on the way into the exclusive temp
      // file; only the version `want` hashed is renamed in. A swap can change which bytes of the copy are read, never
      // pull in another file (a link swapped in by a process the agent left behind is never followed; M3: on Linux nor a
      // file reached through a folder swapped for a link — the handle must sit inside the copy root).
      const croot = await insideCopy(t, p);
      fh = croot ? await openRegular(src, cst, { root: croot }) : null;
      if (!fh) { changed(); return; }
      const { hex } = await copyHandle(fh, tmp, { mode: isWin ? null : cst.mode & 0o777 });
      if (hex !== want?.sha1) { changed(); return; }
      if (!(await stillOk())) { changed(); return; }              // the window shrinks to one rename
      await withReadOnlyRetry(() => rename(tmp, dst), dst);
    } finally {
      await fh?.close();
      await rm(tmp, { force: true });
    }
  } catch (err) {
    failed(err);
  }
}

/** Every folder from `root` down to `dir` made a real folder: under hosted isolation the pipeline dir is writable by the
 *  agent's uid, so a link planted there is removed (never followed) and replaced by a real folder. Then `dir` must
 *  resolve inside `root`. Throws on failure. */
async function realFoldersUnder(root, dir) {
  const rel = relative(root, dir);
  let d = root;
  for (const seg of rel ? rel.split(sep) : []) {
    d = join(d, seg);
    const st = await lstatMaybe(d);
    if (st?.isDirectory()) continue;
    if (st?.isSymbolicLink()) { try { await unlink(d); } catch (err) { if (!isWin) throw err; await rmdir(d); } }   // a junction: rmdir
    await mkdir(d);                                              // a file in the way throws: the save fails, the record stays pending
  }
  const r = await realpath(root);
  const got = await realpath(dir);
  if (got !== r && !got.startsWith(r.endsWith(sep) ? r : r + sep)) throw new Error(`refusing to save outside the run's folder: ${dir}`);
}

/** Step 6: save the copy's version of a skipped add / update under files.skipped (a link as a link). Throws on failure. */
async function saveSkipped(t, pipelineId, p) {
  const src = inCopy(t, p);
  const dst = join(t.files.skipped, ...p.split('/'));
  // c5b: a COPY-side read that fails (an agent's chmod 000) is that file's outcome (returned), never a throw — a throw
  // here answered a 500 on every retry, after step 4's deletes had run. Only a write under skipped/ throws.
  // M2: a file's bytes come through ONE handle opened here as the file the lstat saw, never by name again.
  let st; let target = null; let fh = null;
  try {
    const root = await insideCopy(t, p);
    if (!root) return outsideCopy(p);
    st = await lstatMaybe(src);
    if (!st) return null;
    if (st.isSymbolicLink()) target = await readlinkInside(src, root);
    else if (!(fh = await openRegular(src, st, { root }))) return copyChanged(p);
  } catch (err) { return err; }
  try {
    await realFoldersUnder(t.files.dir, dirname(dst));
    await rm(dst, { recursive: true, force: true });             // its folders are real: a link at dst itself only goes
    if (st.isSymbolicLink()) {
      if (isWin) { await rm(`${dst}.link`, { force: true }); await writeFile(`${dst}.link`, target, { encoding: 'utf8', flag: 'wx' }); }
      else await symlink(target, dst);
    } else {
      await copyHandle(fh, dst, { mode: isWin ? null : st.mode & 0o777 });
    }
  } finally { await fh?.close(); }
  recordArtifact(pipelineId, 'folder-skipped', `skipped/${p}`);
  return null;
}

/** Apply to folder (U10): writes the run's files back, skipping every file that changed in the folder since the run started. */
export async function applyFolderChanges(target, { pipelineId, by = null } = {}) {
  const t = target;
  // 1) guards
  const { changes, manifest, copyRoot } = await guarded(t);
  // 2) re-scan the copy (its terminal opens there while the changes are pending): the lists never come from the run-end file
  const scan = await scanChanges(t.copyDir, manifest, { realRoot: t.realDir, exclude: changes.exclude ?? [], copyRoot });
  const { patch, truncated } = await buildChangesPatch({ realRoot: t.realDir, copyDir: t.copyDir, manifest, files: scan.files, copyRoot });
  const base = { ...changes, files: scan.files, counts: scan.counts, patchTruncated: truncated };
  await writeChangesFiles(t.files, base, patch);
  writeChangesRecord(pipelineId, { state: 'pending', counts: scan.counts }, { memberKey: t.memberKey });
  const lists = listsOf(scan.files);
  // 3) skipped, over the fresh lists
  const skipped = await skippedFor(t, manifest, lists);
  const isSkipped = (p) => skipped.some((s) => s.path === p);
  const unreadable = new Set();

  // 4) deletes first, each right after a fresh re-check of the real file against the manifest
  for (const p of lists.delete) {
    if (isSkipped(p)) continue;
    const abs = real(t, p);
    try {
      if (await lstatMaybe(abs)) {
        if (!(await matchesManifest(t, manifest, p))) { skipped.push({ path: p, reason: 'changed-in-folder' }); continue; }
        try { await withReadOnlyRetry(() => unlink(abs), abs); } catch (err) { skipped.push({ path: p, reason: 'failed', message: msgOf(err) }); continue; }
      }
    } catch { skipped.push({ path: p, reason: 'changed-in-folder' }); continue; }
    await pruneUp(t, p);                                         // a delete whose real file was already gone prunes the same way
  }
  // 5) then updates and adds
  for (const [p, kind] of [...lists.update.map((x) => [x, 'update']), ...lists.add.map((x) => [x, 'add'])].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (isSkipped(p)) continue;
    await writeOne(t, manifest, p, kind, skipped, unreadable);
  }
  skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // 6) save each skipped add / update: Apply never loses the run's bytes. A failure throws: the record stays pending.
  const addOrUpdate = new Set([...lists.add, ...lists.update]);
  for (const s of skipped) {
    if (!addOrUpdate.has(s.path) || unreadable.has(s.path)) continue;
    const err = await saveSkipped(t, pipelineId, s.path);
    if (err) { s.reason = 'failed'; s.message = msgOf(err); }       // c5b: the copy could not be read: not saved
  }

  // 7) the record
  const all = new Set([...lists.add, ...lists.update, ...lists.delete]);
  const applied = all.size - new Set(skipped.map((s) => s.path)).size;
  const appliedAt = new Date().toISOString();
  await writeChangesFiles(t.files, { ...base, state: 'applied', appliedAt, applied, skipped }, patch);
  writeChangesRecord(pipelineId, { state: 'applied', appliedAt, applied, skipped }, { memberKey: t.memberKey });
  // 8) audit
  appendAuditById(pipelineId, `Applied ${applied} file(s) to \`${t.realDir}\`${byActor(by)}.${skipped.length ? ` Skipped ${skipped.length}.` : ''}`, { actor: by });
  return { applied, skipped };
}

/** Discard: the copy goes (the route releases it); the folder is never touched. */
export async function discardFolderChanges(target, { pipelineId, by = null } = {}) {
  const changes = await readChangesFile(target.files.changes);
  if (!changes) throw noChanges();
  if (changes.state === 'applied' || changes.state === 'discarded') throw settled(changes.state);
  const discardedAt = new Date().toISOString();
  // changes.json alone: re-reading changes.patch would follow a link the agent planted there after the last refresh
  await writeChangesJson(target.files, { ...changes, state: 'discarded', discardedAt });
  writeChangesRecord(pipelineId, { state: 'discarded', discardedAt }, { memberKey: target.memberKey });
  appendAuditById(pipelineId, `Discarded the run's changes${byActor(by)}; \`${target.realDir}\` was not touched.`, { actor: by });
  return { ok: true };
}

/** Release a settled run's copy: clear run.json's retain (only while the run root still has a manifest — both calls
 *  below create a missing root, and on a gone root the copy would replace the pipeline dir's members ledger), then
 *  remove the root. */
export async function releaseFolderCopy(pipelineId, pipelineDir) {
  const runRoot = join(worcaHome(), 'runs', pipelineId);
  if (await readRunManifest(runRoot)) {
    await updateRunManifest(runRoot, { retain: null });
    await copyRunManifestTo(runRoot, pipelineDir);
  }
  const r = await rmGuarded(runRoot, { worcaHome: worcaHome(), pipelineId });
  return { removed: r.removed, warnings: r.ok ? [] : [r.reason] };
}
