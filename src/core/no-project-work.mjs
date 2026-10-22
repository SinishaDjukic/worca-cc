// src/core/no-project-work.mjs — P3: a no-project run's work/ folder moves into its pipeline dir, and the files
// worth indexing as `work` artifacts are listed. LEAF: node builtins only; never git, never the DB.

import { rename as fsRename, cp as fsCp, readdir, lstat, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export const WORK_ARTIFACT_KIND = 'work';
export const WORK_INDEX_MAX = 2000;
/** Directory names never indexed (they stay on disk): deps, VCS, virtualenvs and worca's own mounts. */
export const WORK_SKIP_DIRS = Object.freeze(new Set(['.git', '.claude', '.cursor', '.agents', 'node_modules', '__pycache__', '.venv', 'venv']));

/** A rename that cannot move the folder in place (other volume, held handle, Windows AV, dest present) → copy. */
const COPY_FALLBACK = new Set(['EXDEV', 'EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY', 'EEXIST']);

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** cp filter: dirs and regular files only — fs.cp throws on a FIFO, socket or device, and recreating a link (never indexed
 *  or served) fails on Windows without the symlink privilege (EPERM) and when a re-copy meets a dangling one (ENOENT). */
async function copyable(src) {
  try { const st = await lstat(src); return st.isDirectory() || st.isFile(); } catch { return false; }
}

/** A directory itself — never a symlink or junction to one. */
async function realDir(p) {
  try { const st = await lstat(p); return st.isDirectory() && !st.isSymbolicLink(); } catch { return false; }
}

/** P3-D13: a run's work/ and its run root are real folders — never a link or junction an agent swapped in. */
export async function ownWorkDir(workDir) {
  return !!workDir && (await realDir(workDir)) && (await realDir(dirname(workDir)));
}

async function exists(p) {
  try { await lstat(p); return true; } catch { return false; }
}

/** Depth-first, sorted at each level; symlinks (junctions) and WORK_SKIP_DIRS never entered or listed. */
async function walk(root, max) {
  const files = [];
  let bytes = 0;
  let unindexed = 0;
  const visit = async (dir, relParts) => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => byCodeUnit(a.name, b.name));
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (WORK_SKIP_DIRS.has(e.name)) continue;
        await visit(abs, [...relParts, e.name]);
        continue;
      }
      if (!e.isFile()) continue;
      if (files.length >= max) { unindexed += 1; continue; }
      let st;
      try { st = await lstat(abs); } catch { continue; }
      if (st.isSymbolicLink() || !st.isFile()) continue;
      files.push(['work', ...relParts, e.name].join('/'));   // POSIX on every OS
      bytes += st.size;
    }
  };
  await visit(root, []);
  return { files, bytes, unindexed };
}

/**
 * Move `workDir` to `<pipelineDir>/work` (rename; a copy when the rename cannot, or when the dest already exists —
 * a sweep re-harvest) and list what to index. Never throws. A failed copy leaves the source in place.
 * @returns {Promise<{ok:boolean, moved:boolean, files:string[], bytes:number, unindexed:number, error?:string}>}
 */
export async function harvestWork({ workDir, pipelineDir } = {}, { rename = fsRename, cp = fsCp, max = WORK_INDEX_MAX } = {}) {
  try {
    if (!workDir || !(await exists(workDir))) {
      // A harvest that moved work/ and died before it indexed (the boot sweep's retry): list what already landed.
      const landed = pipelineDir ? join(pipelineDir, 'work') : '';
      if (landed && (await realDir(landed))) return { ok: true, moved: false, ...(await walk(landed, max)) };
      return { ok: true, moved: false, files: [], bytes: 0, unindexed: 0 };
    }
    // The run root is agent-writable: a work/ (or runs/<id>) swapped for a link would move and index whatever it points at.
    if (!(await ownWorkDir(workDir))) return { ok: false, moved: false, error: 'work/ is not the run\'s own folder' };
    const dest = join(pipelineDir, 'work');
    let moved = false;
    const copy = async () => {
      try { await cp(workDir, dest, { recursive: true, force: true, filter: copyable }); return null; }
      catch (err) { return err; }
    };
    if (await exists(dest)) {
      const err = await copy();
      if (err) return { ok: false, moved: false, error: err.message };
    } else {
      try {
        await mkdir(pipelineDir, { recursive: true });
        await rename(workDir, dest);
        moved = true;
      } catch (err) {
        if (!COPY_FALLBACK.has(err?.code)) return { ok: false, moved: false, error: err?.message || String(err) };
        const cerr = await copy();
        if (cerr) return { ok: false, moved: false, error: cerr.message };
      }
    }
    const { files, bytes, unindexed } = await walk(dest, max);
    return { ok: true, moved, files, bytes, unindexed };
  } catch (err) {
    return { ok: false, moved: false, error: err?.message || String(err) };
  }
}
