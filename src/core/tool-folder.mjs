// src/core/tool-folder.mjs — what the tool panel's Files and Changes tabs read (issue 1064): one folder of a project, a
// run member or a chat, listed one level at a time, one file as text, and the folder's uncommitted changes. Read-only:
// nothing here writes, stages, or follows a link out of the folder. The routes (ui/server.mjs /api/tools/*) pick the
// folder from ids; a path from the browser only ever selects inside it.
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { resolveInside } from './workspace-map/files.mjs';
import { diffNameStatus, diffNumstat, diffPatch, untrackedFiles, untrackedPatch } from './git-info.mjs';
import { assembleResults } from './results.mjs';

export const TOOL_FOLDER_LIMITS = Object.freeze({ maxEntries: 2000, maxFileBytes: 512 * 1024, sniffBytes: 8192, maxUntracked: 50, maxPath: 4096 });

const FOLD = process.platform === 'win32' || process.platform === 'darwin';
// The .git folder is never listed or read: its config can hold a remote URL with a token in it.
const isHidden = (name) => (FOLD ? String(name).toLowerCase() : String(name)) === '.git';
const GIT_FNS = Object.freeze({ diffNameStatus, diffNumstat, diffPatch, untrackedFiles, untrackedPatch });

export class ToolFolderError extends Error {
  constructor(code, message) { super(message); this.name = 'ToolFolderError'; this.code = code; }
}
const badPath = (msg = 'That is not a path in this folder.') => new ToolFolderError('BAD_PATH', msg);

/** '' (the folder itself) or a clean `a/b` path. Throws BAD_PATH for a climb, an absolute path, a drive, NUL or .git. */
export function cleanRel(rel) {
  if (rel == null || rel === '') return '';
  if (typeof rel !== 'string' || rel.length > TOOL_FOLDER_LIMITS.maxPath || rel.includes('\0')) throw badPath();
  if (/^[\\/]/.test(rel) || /^[A-Za-z]:/.test(rel)) throw badPath();
  const parts = rel.split(/[\\/]/).filter((s) => s && s !== '.');
  if (parts.some((s) => s === '..' || /^[A-Za-z]:/.test(s))) throw badPath();
  if (parts.some(isHidden)) throw badPath('The .git folder is not shown here.');
  return parts.join('/');
}

const insideReal = (realRoot, real) => real === realRoot || real.startsWith(realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`);
// A link can lead to the .git folder under another name (a committed `g -> .git`): judge the REAL path's own segments too.
const realHidden = (realRoot, real) => real.slice(realRoot.length).split(sep).some(isHidden);

/** The real path of `rel` under `root`: NO_FOLDER (the folder is gone), NOT_FOUND, BAD_PATH (a link out of it). */
async function locate(root, rel) {
  let realRoot;
  try { realRoot = await realpath(root); } catch { throw new ToolFolderError('NO_FOLDER', 'This folder does not exist any more.'); }
  const abs = rel ? resolveInside(root, rel) : root;
  if (!abs) throw badPath();
  let real;
  try { real = await realpath(abs); } catch { throw new ToolFolderError('NOT_FOUND', 'That file or folder is not there any more.'); }
  if (!insideReal(realRoot, real)) throw badPath('That link leads outside this folder.');
  if (realHidden(realRoot, real)) throw badPath('The .git folder is not shown here.');
  return { realRoot, real };
}

/** What `rel` is under `root`, under locate()'s rules (inside the folder after every link, never .git):
 *  { path, type: 'dir'|'file'|'other', size, real, realRel } — realRel is the real path from the real root (a link's
 *  target), for rules that judge where a link lands. */
export async function statInFolder(root, relIn) {
  const rel = cleanRel(relIn);
  const { realRoot, real } = await locate(root, rel);
  const st = await stat(real);
  return { path: rel, type: st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other', size: st.size, real,
    realRel: real.slice(realRoot.length).split(sep).filter(Boolean).join('/') };
}

const byName = (a, z) => a.localeCompare(z, undefined, { sensitivity: 'base', numeric: true });

/** One level of the folder: { path, entries: [{ name, type: 'dir'|'file'|'link'|'other', size?, target? }], truncated }.
 *  Folders first, then by name. A link's `target` is 'dir' | 'file' when it resolves inside the folder, else null. */
export async function listFolder(root, relIn = '') {
  const rel = cleanRel(relIn);
  const { realRoot, real } = await locate(root, rel);
  if (!(await stat(real)).isDirectory()) throw new ToolFolderError('NOT_A_FOLDER', 'That is a file, not a folder.');
  const all = (await readdir(real, { withFileTypes: true })).filter((d) => !isHidden(d.name))
    .sort((a, z) => (a.isDirectory() === z.isDirectory() ? byName(a.name, z.name) : a.isDirectory() ? -1 : 1));
  const truncated = all.length > TOOL_FOLDER_LIMITS.maxEntries;
  const entries = [];
  for (const d of all.slice(0, TOOL_FOLDER_LIMITS.maxEntries)) {
    const full = join(real, d.name);
    if (d.isDirectory()) entries.push({ name: d.name, type: 'dir' });
    else if (d.isFile()) {
      let size = null;
      try { size = (await lstat(full)).size; } catch { size = null; }
      entries.push({ name: d.name, type: 'file', size });
    } else if (d.isSymbolicLink()) {
      let target = null;
      try {
        const r = await realpath(full);
        if (insideReal(realRoot, r) && !realHidden(realRoot, r)) { const s = await stat(r); target = s.isDirectory() ? 'dir' : s.isFile() ? 'file' : null; }
      } catch { target = null; }
      entries.push({ name: d.name, type: 'link', target });
    } else entries.push({ name: d.name, type: 'other' });
  }
  return { path: rel, entries, truncated };
}

/** One file as text: { path, size, shown, truncated, binary, text }. At most maxFileBytes are read (a bounded read,
 *  never the whole file); a NUL in the first 8 KiB means binary (no text). O_NONBLOCK: a FIFO never hangs the read. */
export async function readFolderFile(root, relIn) {
  const rel = cleanRel(relIn);
  if (!rel) throw new ToolFolderError('NOT_A_FILE', 'Pick a file.');
  const { real } = await locate(root, rel);
  let fh;
  try { fh = await open(real, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0)); }
  catch { throw new ToolFolderError('NOT_FOUND', 'That file cannot be read.'); }
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new ToolFolderError('NOT_A_FILE', 'That is not a file.');
    const want = Math.min(st.size, TOOL_FOLDER_LIMITS.maxFileBytes);
    const buf = Buffer.alloc(want);
    let got = 0;
    while (got < want) {
      const { bytesRead } = await fh.read(buf, got, want - got, got);
      if (!bytesRead) break;
      got += bytesRead;
    }
    const bytes = buf.subarray(0, got);
    const binary = bytes.subarray(0, TOOL_FOLDER_LIMITS.sniffBytes).includes(0);
    // stream:true while more of the file is left: a character the cap cut in half is dropped, not drawn as U+FFFD.
    const text = binary ? '' : new TextDecoder('utf-8').decode(bytes, { stream: st.size > got });
    return { path: rel, size: st.size, shown: got, truncated: st.size > got, binary, text };
  } finally {
    await fh.close().catch(() => {});
  }
}

/** One file of the folder as an open, read-only handle (the raw route streams it; the caller closes it). The same
 *  path rules as readFolderFile: inside the folder after every link, never .git, a regular file. O_NONBLOCK: a FIFO
 *  never hangs the open. Throws ToolFolderError NOT_A_FILE | NOT_FOUND | BAD_PATH | NO_FOLDER. */
export async function openFolderFile(root, relIn) {
  const rel = cleanRel(relIn);
  if (!rel) throw new ToolFolderError('NOT_A_FILE', 'Pick a file.');
  const { real } = await locate(root, rel);
  let fh;
  try { fh = await open(real, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0)); }
  catch { throw new ToolFolderError('NOT_FOUND', 'That file cannot be read.'); }
  try {
    if (!(await fh.stat()).isFile()) throw new ToolFolderError('NOT_A_FILE', 'That is not a file.');
    return fh;
  } catch (e) { await fh.close().catch(() => {}); throw e; }
}

/**
 * The folder's uncommitted work: `git diff HEAD` plus files git does not track and does not ignore, in the live diff's
 * shape { results, patch, untrackedCapped } (run-harness.mjs liveDiff). Read-only (no `add -N`); never throws (git-info
 * answers empty on failure, so a repository with no commit yet shows its untracked files only).
 */
export async function workingTreeChanges(dir, { maxUntracked = TOOL_FOLDER_LIMITS.maxUntracked, git = GIT_FNS } = {}) {
  const [ns, num, patch, untracked] = await Promise.all([
    git.diffNameStatus(dir, 'HEAD'), git.diffNumstat(dir, 'HEAD'), git.diffPatch(dir, 'HEAD'), git.untrackedFiles(dir),
  ]);
  const listed = new Set(ns.map((r) => r.path));
  const fresh = untracked.filter((p) => !listed.has(p) && !p.split('/').some(isHidden));
  const extra = [];
  for (const p of fresh.slice(0, maxUntracked)) {
    const u = await git.untrackedPatch(dir, p);
    ns.push({ status: 'A', path: p });
    num.set(p, { added: u.added, removed: 0, binary: u.binary });
    if (u.patch) extra.push(u.patch);
  }
  return {
    results: assembleResults({ nameStatus: ns, numstat: num, reviews: [] }),
    patch: [patch, ...extra].filter(Boolean).join(''),
    untrackedCapped: fresh.length > maxUntracked,
  };
}
