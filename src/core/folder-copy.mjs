// src/core/folder-copy.mjs — Folder runs (Projects, any way, P1 Task 3): copy a folder with a sha1 manifest,
// measure it (the size guard), scan the copy's changes and build a git-style patch in JS (npm `diff`).
// Never runs git. Paths in every file this module writes are `/`-separated on every OS.
import { createHash, randomBytes } from 'node:crypto';
import { constants as fsc, realpathSync } from 'node:fs';
import { readdir, lstat, stat, mkdir, readlink, symlink, writeFile, rename, rm, open } from 'node:fs/promises';
import { join, resolve, relative, dirname, basename, isAbsolute, sep } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { worcaHome } from './projects.mjs';
import { samePath } from './project-kind.mjs';

export const FOLDER_COPY_LIMITS = Object.freeze({ files: 50_000, bytes: 1_000_000_000 });
export const FOLDER_SIZE_SCAN_CEILING = 250_000;                 // entries walked before the guard stops counting
const PATCH_BYTE_CAP = 8_000_000;
// jsdiff's Myers search is O(N·D) and synchronous: a 714 kB file rewritten throughout blocked the server's event loop
// for 43 s. Past this many edits it gives up (`undefined`) and the section is one whole-file hunk instead.
export const PATCH_MAX_EDIT_LENGTH = 4000;
// Below that cap a file of repeating lines still costs O(N·D): 800 kB of period-2 lines with 3,998 edits took 3 s. jsdiff's
// own `timeout` bounds each file; the same whole-file hunk stands in when it fires.
export const PATCH_DIFF_TIMEOUT_MS = 1000;
/** One hunk replacing every old line with every new line — a valid unified diff, built in O(N). */
export function wholeFileHunk(oldText, newText) {
  const split = (t) => {
    const ls = t === '' ? [] : t.split('\n');
    const nl = ls.length === 0 || ls[ls.length - 1] === '';
    if (ls.length && nl) ls.pop();
    return { ls, nl };
  };
  const o = split(oldText); const n = split(newText);
  const out = [`@@ -${o.ls.length ? 1 : 0},${o.ls.length} +${n.ls.length ? 1 : 0},${n.ls.length} @@`];
  for (const [side, sign] of [[o, '-'], [n, '+']]) {
    for (const l of side.ls) out.push(sign + l);
    if (side.ls.length && !side.nl) out.push('\\ No newline at end of file');
  }
  return out;
}
const BINARY_SNIFF = 8000;
const BINARY_SIZE = 1_000_000;
const COPY_PARALLEL = 16;
const COPY_CHUNK = 1 << 16;

const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/** WORCA_FOLDER_MAX_FILES / WORCA_FOLDER_MAX_BYTES (positive ints) override the defaults. */
export function folderCopyLimits(env = process.env) {
  return { files: posInt(env?.WORCA_FOLDER_MAX_FILES) ?? FOLDER_COPY_LIMITS.files,
    bytes: posInt(env?.WORCA_FOLDER_MAX_BYTES) ?? FOLDER_COPY_LIMITS.bytes };
}

/** Decimal size label: '5 B', '2.3 MB', '340 MB', '1 GB'. */
export function sizeLabel(bytes) {
  const units = ['B', 'kB', 'MB', 'GB'];
  let v = Math.max(0, Number(bytes) || 0); let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  const n = v < 10 ? String(Number(v.toFixed(1))) : String(Math.round(v));
  return `${n} ${units[i]}`;
}

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
const within = (p, root) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

// M3: Node has no openat, and O_NOFOLLOW guards only a path's last part: a FOLDER above swapped for a link (by a process an
// agent left behind) between a containment check and an open resolves the lstat and the open alike through it. Linux — the
// only platform agent isolation ships on — tells an open descriptor's real path, so there every open under a copy or a real
// folder is checked inside its trusted root, and the walk lists each folder through its own handle. darwin / win32 (agents
// run as the server's own user) keep the dev + ino check alone.
const PROC_FD = '/proc/self/fd';
const fdPaths = process.platform === 'linux'
  ? { resolve: (fd) => readlink(`${PROC_FD}/${fd}`), dir: (fd) => `${PROC_FD}/${fd}` }
  : { resolve: null, dir: null };
/** The open descriptor's real path is `root` or inside it. No resolver (darwin / win32): true. No root, or a resolver that
 *  cannot answer: false (fail closed). */
async function fdInside(fd, root) {
  if (!fdPaths.resolve) return true;
  if (!root) return false;
  try { const p = await fdPaths.resolve(fd); return typeof p === 'string' && within(p, root); } catch { return false; }
}
/** Tests: swap the descriptor pair (`resolve(fd)` → its real path; `dir(fd)` → a path that lists the open folder, null to
 *  list by path) to drive the Linux checks on any OS. Returns the previous pair, to pass back. */
export const _testing = {
  setFdPaths(next) { const prev = { ...fdPaths }; Object.assign(fdPaths, next); return prev; },
};

const folds = (platform) => platform === 'darwin' || platform === 'win32';
const toPosix = (p) => String(p).split(sep).join('/');
const isInside = (child, parent, platform) => {
  const rel = relative(parent, child);
  if (!rel) return samePath(child, parent, platform);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    if (!folds(platform)) return false;
    const c = child.toLowerCase(); const p = parent.toLowerCase();
    return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
  }
  return true;
};

const WORCA_HOME_REFUSAL = Object.freeze({ error: "This folder is worca's own data folder.", code: 'FOLDER_IS_WORCA_HOME' });

function worcaHomeRefusal(root, home, platform) {
  const r = real(root); const h = real(home);
  if (samePath(r, h, platform)) return { ...WORCA_HOME_REFUSAL };
  for (const sub of ['runs', 'store']) if (isInside(r, join(h, sub), platform)) return { ...WORCA_HOME_REFUSAL };
  return null;
}

/** `rel` of the (realpath'd) worca home inside the (realpath'd) root, `/`-joined; null when not inside. */
function homeRelOf(root, home) {
  if (!home) return null;
  const rel = relative(real(root), real(home));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return toPosix(rel);
}

function makeCtx({ root, home, platform = process.platform, exclude = [] }) {
  const fold = folds(platform);
  const norm = (s) => (fold ? s.toLowerCase() : s);
  const homeRel = homeRelOf(root, home);
  return { fold, norm, homeRel: homeRel != null ? norm(homeRel) : null, exclude: exclude.map((e) => norm(toPosix(e).replace(/\/+$/, ''))).filter(Boolean) };
}

/** The one exclusion rule shared by size, copy and scan. */
function excluded(rel, ctx) {
  const r = ctx.norm(rel);
  const segs = r.split('/');
  if (segs.some((s) => s === '.git')) return true;
  if (segs[0] === '.worca-cc') return true;
  if (ctx.homeRel && (r === ctx.homeRel || r.startsWith(ctx.homeRel + '/'))) return true;
  for (const e of ctx.exclude) if (r === e || r.startsWith(e + '/')) return true;
  return false;
}

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const deny = (e) => e && (e.code === 'EACCES' || e.code === 'EPERM');

// c7: removed since its lstat (M3: ELOOP / EMLINK, or ENOTDIR on Linux, when a no-follow open meets a folder swapped for a link)
const GONE = new Set(['ENOENT', 'ENOTDIR', 'ELOOP', 'EMLINK']);
const outsideRoot = (p) => Object.assign(new Error(`refusing to scan a folder outside its root: ${p}`), { code: 'COPY_OUTSIDE' });

/** Walk `root` (links never followed), calling `onEntry({ rel, abs, at, type, st, target })` for dirs, files and links
 *  (`target`: a link's, read when `onEntry` is given). A link at `root` itself is followed (a user's folder may be one)
 *  unless `rootLink` is false (a run's copy: refused). `rootReal` is the root's trusted realpath. On Linux (M3) each folder
 *  is opened once, no-follow, checked inside `rootReal`, then listed, lstat'ed and readlink'ed through that handle
 *  (`at` = `/proc/self/fd/<fd>/<name>`): a folder swapped for a link after its check is never listed through the link.
 *  `at` is valid only inside `onEntry` (the handle closes after its folder); elsewhere it is `abs`. */
async function walk(root, ctx, { ceiling = Infinity, onEntry, rootLink = true, rootReal = null } = {}) {
  if (!rootLink && (await lstat(root)).isSymbolicLink()) throw Object.assign(new Error(`refusing to scan a link: ${root}`), { code: 'COPY_IS_LINK' });
  const trusted = rootReal ?? real(root);
  let files = 0; let bytes = 0; let seen = 0; let partial = false; const unreadable = [];
  async function visit(absDir, relDir, openAt) {
    let dh = null;
    try {
      let via = absDir; let ents;
      try {
        if (fdPaths.dir) {
          dh = await open(openAt, fsc.O_RDONLY | fsc.O_DIRECTORY | (relDir || !rootLink ? fsc.O_NOFOLLOW : 0));
          if (!(await fdInside(dh.fd, trusted))) {
            if (!relDir) throw outsideRoot(root);
            unreadable.push(relDir); return;
          }
          via = fdPaths.dir(dh.fd);
        }
        ents = await readdir(via, { withFileTypes: true });
      } catch (e) {
        if (e?.code === 'COPY_OUTSIDE') throw e;
        if (deny(e) && relDir) { unreadable.push(relDir); return; }
        if (relDir && e && GONE.has(e.code)) return;
        throw e;
      }
      ents.sort((a, b) => byCodeUnit(a.name, b.name));
      for (const d of ents) {
        if (partial) return;
        const rel = relDir ? `${relDir}/${d.name}` : d.name;
        if (excluded(rel, ctx)) continue;
        const abs = join(absDir, d.name); const at = join(via, d.name);
        let st;
        try { st = await lstat(at); } catch (e) {
          if (deny(e)) { unreadable.push(rel); continue; }
          if (e && e.code === 'ENOENT') continue;
          throw e;
        }
        if (st.isDirectory()) {
          if (++seen > ceiling) { partial = true; return; }
          if (onEntry) await onEntry({ rel, abs, at, type: 'dir', st });
          await visit(abs, rel, at);
        } else if (st.isFile()) {
          if (++seen > ceiling) { partial = true; return; }
          files++; bytes += st.size;
          if (onEntry) await onEntry({ rel, abs, at, type: 'file', st });
        } else if (st.isSymbolicLink()) {
          let target = null;
          if (onEntry) {
            try { target = await readlink(at); } catch (e) {
              if (e && e.code === 'ENOENT') continue;                   // c7: removed since the lstat
              throw e;
            }
          }
          if (++seen > ceiling) { partial = true; return; }
          files++;
          if (onEntry) await onEntry({ rel, abs, at, type: 'link', st, target });
        } // FIFO, socket and device entries are skipped
      }
    } finally { await dh?.close(); }
  }
  await visit(root, '', root);
  return { files, bytes, partial, unreadable };
}

function unreadableWarning(list) {
  if (!list.length) return null;
  const shown = list.slice(0, 5).join(', ');
  return `left ${list.length} unreadable item(s) out of the copy: ${shown}${list.length > 5 ? '…' : ''}`;
}

function tooBig({ name, files, bytes, limits, partial }) {
  const over = bytes > limits.bytes ? 'bytes' : files > limits.files || partial ? 'files' : null;
  if (!over) return null;
  const error = over === 'bytes'
    ? `${name} is ${sizeLabel(bytes)}. The limit is ${sizeLabel(limits.bytes)}.`
    : partial
      ? `${name} has more than ${FOLDER_SIZE_SCAN_CEILING.toLocaleString('en-US')} files. The limit is ${limits.files.toLocaleString('en-US')}.`
      : `${name} has ${files.toLocaleString('en-US')} files. The limit is ${limits.files.toLocaleString('en-US')}.`;
  return { error, code: 'FOLDER_TOO_BIG', files, bytes, limit: { files: limits.files, bytes: limits.bytes }, limitBytes: limits.bytes, over,
    ...(partial ? { partial: true } : {}) };
}

const isDirSync = async (p) => { try { return (await stat(p)).isDirectory(); } catch { return false; } };

/** null | FolderTooBig | FolderIsWorcaHome (S69, first). */
export async function checkFolderSize(root, { limits = folderCopyLimits(), name, home = worcaHome(), platform = process.platform } = {}) {
  const refusal = worcaHomeRefusal(root, home, platform);
  if (refusal) return refusal;
  if (!(await isDirSync(root))) return null;
  const ctx = makeCtx({ root, home, platform });
  const w = await walk(root, ctx, { ceiling: FOLDER_SIZE_SCAN_CEILING });
  return tooBig({ name: name ?? basename(resolve(root)), files: w.files, bytes: w.bytes, limits, partial: w.partial });
}

const sha1Text = (t) => createHash('sha1').update(String(t)).digest('hex');

/** `path` opened for reading as the very file its lstat `st` saw — one handle, never the name twice: never through a
 *  link at its own name (O_NOFOLLOW; win32 has none, the dev + ino check stands in), never blocking on a FIFO, and the
 *  same dev + ino (a folder above swapped for a link after the lstat would open another file). On Linux (M3) the
 *  descriptor's real path must also be `root` (the caller's trusted realpath) or inside it: a folder above swapped for a
 *  link BEFORE the lstat resolves the lstat and the open to the same outside file, which dev + ino cannot tell. Null when
 *  the entry is no longer that regular file: a process the agent left behind can swap a file for a link between lstat
 *  and read. */
export async function openRegular(path, st, { root = null } = {}) {
  if (!st?.isFile()) return null;
  let fh;
  try { fh = await open(path, fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0) | (fsc.O_NONBLOCK ?? 0)); } catch (err) {
    if (err && (err.code === 'ELOOP' || err.code === 'EMLINK')) return null;          // now a link (EMLINK: FreeBSD)
    throw err;
  }
  try {
    const now = await fh.stat({ bigint: typeof st.ino === 'bigint' });
    if (now.isFile() && now.dev === st.dev && now.ino === st.ino && (await fdInside(fh.fd, root))) return fh;
  } catch (err) { await fh.close(); throw err; }
  await fh.close();
  return null;
}

/** A link's target, read inside `root`: on Linux through its folder's own handle, checked inside `root` (M3), so a folder
 *  above swapped for a link never hands over an outside link's target. Throws when it is not inside. */
export async function readlinkInside(abs, root) {
  if (!fdPaths.dir) return readlink(abs);
  const dh = await open(dirname(abs), fsc.O_RDONLY | fsc.O_DIRECTORY);
  try {
    if (!(await fdInside(dh.fd, root))) throw outsideRoot(abs);
    return await readlink(join(fdPaths.dir(dh.fd), basename(abs)));
  } finally { await dh.close(); }
}

/** Read an open handle from offset 0 (positional reads: its own offset is never used), hashing it, and write each chunk
 *  to `out` (a handle) when given: { hex, size }. */
async function pumpHandle(fh, out = null) {
  const h = createHash('sha1'); const buf = Buffer.allocUnsafe(COPY_CHUNK); let size = 0;
  for (;;) {
    const { bytesRead } = await fh.read(buf, 0, buf.length, size);
    if (!bytesRead) break;
    h.update(buf.subarray(0, bytesRead));
    if (out) for (let off = 0; off < bytesRead;) off += (await out.write(buf, off, bytesRead - off)).bytesWritten;
    size += bytesRead;
  }
  return { hex: h.digest('hex'), size };
}
/** sha1 + size of an open handle's bytes. */
export async function hashHandle(fh) { return pumpHandle(fh); }
/** Copy an open handle's bytes into a NEW file `dst` (`wx`: a link or a file planted there throws EEXIST, never written
 *  through), hashing them on the way; `mode` and `times` ([atime, mtime] in seconds) are set through the new file's own
 *  handle, never by name. { hex, size } */
export async function copyHandle(fh, dst, { mode = null, times = null } = {}) {
  const out = await open(dst, 'wx');
  try {
    const r = await pumpHandle(fh, out);
    if (mode != null) await out.chmod(mode);
    if (times) await out.utimes(times[0], times[1]);
    return r;
  } finally { await out.close(); }
}

/** Rewrite an absolute link target inside one of `fromRoots` to the same place under `toRoot`. */
export function rewriteLinkTarget(target, fromRoots, toRoot) {
  if (typeof target !== 'string' || !isAbsolute(target)) return target;
  for (const from of fromRoots || []) {
    if (!from) continue;
    if (target === from) return toRoot;
    const pre = from.endsWith(sep) ? from : from + sep;
    if (target.startsWith(pre)) return join(toRoot, target.slice(pre.length));
  }
  return target;
}

function abortError() { const e = new Error('The folder copy was aborted'); e.name = 'AbortError'; e.code = 'ABORT_ERR'; return e; }

/** Copy `root` to `dest` (a fresh dir) and describe what the copy starts with. */
export async function copyFolder(root, dest, { limits = folderCopyLimits(), home = worcaHome(), platform = process.platform, signal, onWarn = () => {} } = {}) {
  const refusal = worcaHomeRefusal(root, home, platform);
  if (refusal) throw Object.assign(new Error(refusal.error), refusal);
  const warn = (w) => { try { onWarn?.(w); } catch { /* a warning never fails the copy */ } };
  const ctx = makeCtx({ root, home, platform });
  const entries = [];
  const rootAbs = resolve(root); const rootReal = real(root);
  const w = await walk(root, ctx, { rootReal, onEntry: (e) => { entries.push(e); } });
  const too = tooBig({ name: basename(resolve(root)), files: w.files, bytes: w.bytes, limits, partial: false });
  if (too) throw Object.assign(new Error(too.error), too);
  const unreadList = [...w.unreadable];
  await mkdir(dest, { recursive: true });
  const files = {}; let nFiles = 0; let nBytes = 0; let longPath = false; let refusedLinks = 0;
  const destOf = (rel) => join(dest, ...rel.split('/'));
  const work = entries.filter((e) => e.type !== 'dir');
  const caseCollision = (e) => {
    const fold = (r) => r.normalize('NFC').toLowerCase();
    const b = e.rel;
    const a = entries.find((x) => x !== e && fold(x.rel) === fold(b))?.rel ?? b;
    return Object.assign(new Error(`${a} and ${b} differ only in case; the run folder's disk cannot hold both`), { code: 'CASE_COLLISION' });
  };
  for (const e of entries) {
    if (e.type !== 'dir') continue;
    if (signal?.aborted) throw abortError();
    // dir modes are not restored: the copy stays writable. Never `recursive` (c6): the walk is pre-order, so the parent
    // exists, and an EEXIST means the run disk folds names — `Docs/` and `docs/` of a case-sensitive source would merge.
    try { await mkdir(destOf(e.rel)); } catch (err) {
      if (err && err.code === 'EEXIST') throw caseCollision(e);
      throw err;
    }
  }
  const one = async (e) => {
    if (signal?.aborted) throw abortError();
    const dst = destOf(e.rel);
    if (dst.length > 259) longPath = true;
    if (e.type === 'file') {
      let fh; let info;
      try {
        // M2: the bytes come through ONE handle opened as the file the walk's lstat saw, hashed on the way: a file swapped
        // for a link since the walk (under hosted isolation another agent's process can) is left out, never copied through
        // it. M3: on Linux the handle must also sit inside the folder's realpath (a folder above swapped for a link).
        fh = await openRegular(e.abs, e.st, { root: rootReal });
        if (!fh) { unreadList.push(e.rel); return; }
        info = await copyHandle(fh, dst, { mode: platform !== 'win32' ? e.st.mode & 0o777 : null, times: [e.st.atimeMs / 1000, e.st.mtimeMs / 1000] });
      } catch (err) {
        if (err && err.code === 'EEXIST') throw caseCollision(e);
        // c6: a file the user cannot read (a root-owned 600 key, a 000 file) is left out like an unreadable folder
        if (deny(err)) { unreadList.push(e.rel); return; }
        // c7: removed from the folder since the walk (an editor's swap file, an Office lock file): not in the folder, not a change
        if (err && err.code === 'ENOENT') return;
        throw err;
      } finally { await fh?.close(); }
      const { hex, size } = info;
      files[e.rel] = { sha1: hex, size, mtimeMs: e.st.mtimeMs, ...(platform !== 'win32' ? { mode: e.st.mode & 0o777 } : {}) };
      nFiles++; nBytes += size;
      return;
    }
    // a symbolic link, its target read by the walk (through the folder's own handle on Linux)
    const { target } = e;
    const copyTarget = rewriteLinkTarget(target, [rootAbs, rootReal], dest);
    let written = copyTarget;
    try {
      if (platform === 'win32') {
        const abs = resolve(dirname(dst), copyTarget);
        let isDirTarget = false; try { isDirTarget = (await stat(abs)).isDirectory(); } catch { /* dangling */ }
        written = isDirTarget ? abs : copyTarget;
        await symlink(written, dst, isDirTarget ? 'junction' : 'file');
      } else {
        await symlink(copyTarget, dst);
      }
    } catch (err) {
      if (platform === 'win32' && deny(err)) { refusedLinks++; return; }
      if (err && err.code === 'EEXIST') throw caseCollision(e);
      throw err;
    }
    files[e.rel] = { link: target, copyLink: written, sha1: sha1Text(target), size: 0, mtimeMs: e.st.mtimeMs };
    nFiles++;
  };
  for (let i = 0; i < work.length; i += COPY_PARALLEL) {
    if (signal?.aborted) throw abortError();
    await Promise.all(work.slice(i, i + COPY_PARALLEL).map(one));
  }
  const unread = unreadableWarning(unreadList.sort(byCodeUnit));
  if (unread) warn(unread);
  if (refusedLinks) warn(`left ${refusedLinks} symbolic link(s) out of the copy: Windows refused to create them`);
  if (longPath) warn('some paths in the copy are longer than 260 characters');
  const sorted = Object.fromEntries(Object.keys(files).sort(byCodeUnit).map((k) => [k, files[k]]));
  const manifest = { version: 1, root: rootAbs, copy: dest, createdAt: new Date().toISOString(), files: sorted };
  return { manifest, files: nFiles, bytes: nBytes };
}

// A random temp name created exclusively: a link planted at a fixed `<file>.tmp` in the pipeline dir (writable by the
// agent's uid under hosted isolation) is never written through; the rename replaces a link at `path` itself.
async function writeAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, text, { flag: 'wx' });
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** A path from the manifest or the scan: relative, `/`-separated, no `.`, `..` or empty segment, no NUL (on win32 no
 *  backslash either: there it separates; a POSIX name may hold one). */
export function safeRelPath(p, platform = process.platform) {
  if (typeof p !== 'string' || !p || p.includes('\0') || p.startsWith('/') || isAbsolute(p)) return false;
  return !p.split('/').some((s) => s === '' || s === '.' || s === '..' || (platform === 'win32' && s.includes('\\')));
}

/** A file of the pipeline dir as text: a regular file only, never through a link at its own name (O_NOFOLLOW; the lstat
 *  stands in on win32) and never blocking on a FIFO — the agent's uid can plant either there under hosted isolation. */
export async function readRegularText(path) {
  const notFile = () => Object.assign(new Error(`not a regular file: ${path}`), { code: 'EINVAL' });
  if (!(await lstat(path)).isFile()) throw notFile();
  const fh = await open(path, fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0) | (fsc.O_NONBLOCK ?? 0));
  try {
    if (!(await fh.stat()).isFile()) throw notFile();
    return await fh.readFile('utf8');
  } finally { await fh.close(); }
}

export async function writeFolderManifest(path, manifest) { await writeAtomic(path, JSON.stringify(manifest) + '\n'); }
// The manifest is agent input (the pipeline dir is agent-writable under hosted isolation): one key naming a path that
// leaves the folder refuses the WHOLE manifest — never dropped — so no scan, patch or Apply reads it. Its `root` is never
// read: callers pass the run record's real folder.
export async function readFolderManifest(path, { platform = process.platform } = {}) {
  let m;
  try { m = JSON.parse(await readRegularText(path)); } catch { return null; }
  if (!m || typeof m !== 'object' || !m.files || typeof m.files !== 'object') return null;
  for (const [k, v] of Object.entries(m.files)) if (!safeRelPath(k, platform) || !v || typeof v !== 'object') return null;
  return m;
}

/** Case-folded (darwin / win32) prefix test: does the manifest hold `relPrefix` or anything under it? */
export function manifestHas(manifest, relPrefix, platform = process.platform) {
  if (!manifest || !manifest.files) return false;
  const norm = (s) => (folds(platform) ? s.toLowerCase() : s);
  const p = norm(toPosix(relPrefix).replace(/\/+$/, ''));
  return Object.keys(manifest.files).some((k) => { const n = norm(k); return n === p || n.startsWith(p + '/'); });
}

/** `root`: the trusted realpath of the side `path` is on (openRegular, M3). */
async function sniffBinary(path, root) {
  let fh;
  try {
    // c6: only a regular file is opened (links not followed), and never blocking: open() on a FIFO the user put at a
    // deleted path blocked forever (the run's scans, apply-plan and Apply inside the run lock hung). M2: the file the lstat saw.
    const st = await lstat(path);
    if (!st.isFile()) return false;
    if (st.size > BINARY_SIZE) return true;
    fh = await openRegular(path, st, { root });
    if (!fh) return false;
    const buf = Buffer.alloc(Math.min(BINARY_SNIFF, st.size));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } catch { return false; } finally { await fh?.close(); }
}

/** `abs`'s folder resolves to `rootReal` or inside it: a side is never read through a link in a parent folder (a forged
 *  manifest key under a link the user keeps, a copy folder the agent swapped for a link after the scan). A folder whose
 *  realpath fails is NOT inside (M3: fails closed — a folder missing for an instant is the gap of a non-atomic swap). */
function parentInside(abs, rootReal) {
  let d;
  try { d = realpathSync(dirname(abs)); } catch { return false; }
  return within(d, rootReal);
}

/** A run member's copy root, checked from server-trusted parts: a real folder (never a link) whose realpath is exactly
 *  `<realpath(worca home)>/runs/<pipelineId>/repos/<key>` (case folded on darwin / win32). Every containment check
 *  compares against the copy's realpath, so a copy the agent swapped for a link (it may rename entries in the
 *  group-writable `repos/` under hosted isolation) would make the link's target the root. The realpath, else null. */
export async function folderCopyRoot(copyDir, { pipelineId, key, home = safeHome(), platform = process.platform } = {}) {
  if (!copyDir || !pipelineId || !key || !home) return null;
  try {
    if (!(await lstat(copyDir)).isDirectory()) return null;
    const got = realpathSync(copyDir);
    return samePath(got, join(realpathSync(home), 'runs', String(pipelineId), 'repos', String(key)), platform) ? got : null;
  } catch { return null; }
}

/** The copy's changes against its manifest: [{ path, change, size, binary?, link? }] sorted by posix path. `realRoot` is
 *  the real folder from the run's record, never the manifest's `root`. A link at `copyDir` itself is refused. `copyRoot`
 *  is folderCopyRoot's answer (else the copy's realpath): every folder and file the scan opens must sit inside it (M3). */
export async function scanChanges(copyDir, manifest, { realRoot = copyDir, exclude = [], platform = process.platform, copyRoot = null } = {}) {
  const mf = manifest?.files || {};
  const rootReal = real(realRoot); const copyReal = copyRoot ?? real(copyDir);
  const ctx = makeCtx({ root: realRoot, home: safeHome(), platform, exclude });
  const seen = new Set(); const out = [];
  const w = await walk(copyDir, ctx, { rootLink: false, rootReal: copyReal, onEntry: async (e) => {
    if (e.type === 'dir') return;
    seen.add(e.rel);
    const m = Object.hasOwn(mf, e.rel) ? mf[e.rel] : null;
    if (e.type === 'link') {
      const now = e.target;
      if (m && m.copyLink != null ? now === m.copyLink : (m && m.link != null && m.link === rewriteLinkTarget(now, [resolve(copyDir), real(copyDir)], realRoot))) return;
      out.push({ path: e.rel, change: m ? 'modified' : 'added', size: 0, link: true });
      return;
    }
    const mode = e.st.mode & 0o777;
    const posix = platform !== 'win32';
    if (m && m.link == null) {
      const modeSame = !posix || m.mode == null || m.mode === mode;
      if (m.size === e.st.size && Math.trunc(m.mtimeMs) === Math.trunc(e.st.mtimeMs) && modeSame) return;
      // n6: hashed through one handle opened as the walk's file (never blocking on a FIFO swapped in since)
      let hex = null; let fh = null;
      try {
        fh = await openRegular(e.at, e.st, { root: copyReal });
        if (fh) ({ hex } = await hashHandle(fh));
      } catch { /* unreadable in the copy: listed as modified; Apply reports it failed */ } finally { await fh?.close(); }
      if (hex === m.sha1 && modeSame) return;
    }
    const entry = { path: e.rel, change: m ? 'modified' : 'added', size: e.st.size };
    if (await sniffBinary(e.at, copyReal)) entry.binary = true;
    out.push(entry);
  } });
  for (const [p, m] of Object.entries(mf)) {
    if (seen.has(p) || excluded(p, ctx)) continue;
    // c5b: under (or at) an entry the walk could not read (an agent's chmod 000 on a FOLDER) the copy's version is
    // unknown, never "deleted": listed as modified, so Apply reports it failed and the real file stays.
    // c6: on a volume that folds names the unreadable entry can be spelled otherwise (`Docs` holds `docs/a.md`): a
    // manifest path whose lstat in the copy is refused (EACCES / EPERM) is unknown too. Only a refusal counts — an
    // lstat that answers keeps `deleted` (the exact-path rule: a case-only rename is deleted + added).
    let refused = w.unreadable.some((u) => p === u || p.startsWith(`${u}/`));
    if (!refused) { try { await lstat(join(copyDir, ...p.split('/'))); } catch (e) { refused = deny(e); } }
    if (refused) { out.push({ path: p, change: 'modified', size: m.size ?? 0, ...(m.link != null ? { link: true } : {}) }); continue; }
    const entry = { path: p, change: 'deleted', size: m.size ?? 0 };
    const abs = join(realRoot, ...p.split('/'));
    if (m.link != null) entry.link = true;
    else if (parentInside(abs, rootReal) && (await sniffBinary(abs, rootReal))) entry.binary = true;
    out.push(entry);
  }
  out.sort((a, b) => byCodeUnit(a.path, b.path));
  const counts = { added: 0, modified: 0, deleted: 0 };
  for (const f of out) counts[f.change]++;
  return { files: out, counts };
}

function safeHome() { try { return worcaHome(); } catch { return null; } }

const gitMode = (mode, link) => (link ? '120000' : mode != null && (mode & 0o111) ? '100755' : '100644');

/** One side of a changed file. A file is sniffed and read through ONE handle opened as the file its lstat saw, inside the
 *  side's root on Linux (openRegular, M2 / M3): one swapped since (for a link, by a process the agent left behind, or
 *  under a folder swapped for one) is looked at again from the lstat — as the link it now is — never read through. */
async function sideOf(abs, { link, rootReal }) {
  const gone = { exists: false, link: !!link };
  for (let tries = 0; tries < 3; tries++) {
    if (!parentInside(abs, rootReal)) return gone;
    let fh;
    try {
      const st = await lstat(abs);
      if (st.isSymbolicLink()) return { exists: true, link: true, mode: null, text: await readlinkInside(abs, rootReal), binary: false };
      if (!st.isFile()) return { exists: false };
      fh = await openRegular(abs, st, { root: rootReal });
      if (!fh) continue;                                          // no longer the file the lstat saw: look again
      if (st.size > BINARY_SIZE) return { exists: true, link: false, mode: st.mode & 0o777, binary: true, text: null };
      const buf = await fh.readFile();
      const binary = buf.subarray(0, BINARY_SNIFF).includes(0);
      return { exists: true, link: false, mode: st.mode & 0o777, binary, text: binary ? null : buf.toString('utf8') };
    } catch { return gone; } finally { await fh?.close(); }
  }
  return gone;
}

/** One git-style section per changed file, in `files` order; numstat from the hunks. `copyRoot` is folderCopyRoot's
 *  answer: the copy side is contained by it, never by a realpath taken after the check. */
export async function buildChangesPatch({ realRoot, copyDir, manifest, files, copyRoot = null }) {
  const mf = manifest?.files || {};
  const realReal = real(realRoot); const copyReal = copyRoot ?? real(copyDir);
  const numstat = new Map(); const parts = []; let bytes = 0; let truncated = false;
  for (const f of files || []) {
    if (bytes >= PATCH_BYTE_CAP) { truncated = true; break; }
    const p = f.path; const segs = p.split('/');
    const m = mf[p] || null;
    const oldSide = f.change === 'added' ? { exists: false } : await sideOf(join(realRoot, ...segs), { link: m?.link != null, rootReal: realReal });
    const newSide = f.change === 'deleted' ? { exists: false } : await sideOf(join(copyDir, ...segs), { link: !!f.link, rootReal: copyReal });
    if (newSide.exists && newSide.link) newSide.text = rewriteLinkTarget(newSide.text, [resolve(copyDir), real(copyDir)], realRoot);
    const oldMode = gitMode(oldSide.exists ? oldSide.mode : m?.mode, oldSide.exists ? oldSide.link : m?.link != null);
    const newMode = gitMode(newSide.mode, newSide.link);
    const lines = [`diff --git a/${p} b/${p}`];
    if (f.change === 'added') lines.push(`new file mode ${newMode}`);
    else if (f.change === 'deleted') lines.push(`deleted file mode ${oldMode}`);
    else if (oldMode !== newMode) lines.push(`old mode ${oldMode}`, `new mode ${newMode}`);
    const binary = !!f.binary || !!oldSide.binary || !!newSide.binary;
    let added = 0; let removed = 0;
    if (binary) {
      lines.push(`Binary files ${f.change === 'added' ? '/dev/null' : `a/${p}`} and ${f.change === 'deleted' ? '/dev/null' : `b/${p}`} differ`);
    } else {
      const oldText = oldSide.exists ? oldSide.text ?? '' : '';
      const newText = newSide.exists ? newSide.text ?? '' : '';
      const full = createTwoFilesPatch(`a/${p}`, `b/${p}`, oldText, newText, undefined, undefined, { context: 3, maxEditLength: PATCH_MAX_EDIT_LENGTH, timeout: PATCH_DIFF_TIMEOUT_MS });
      let hunk = null;
      if (full === undefined) hunk = wholeFileHunk(oldText, newText);
      else {
        const all = full.split('\n');
        const at = all.findIndex((l) => l.startsWith('@@'));
        if (at >= 0) { hunk = all.slice(at); if (hunk.length && hunk[hunk.length - 1] === '') hunk.pop(); }
      }
      if (hunk) {
        lines.push(f.change === 'added' ? '--- /dev/null' : `--- a/${p}`, f.change === 'deleted' ? '+++ /dev/null' : `+++ b/${p}`);
        for (const l of hunk) {
          if (l.startsWith('+')) added++; else if (l.startsWith('-')) removed++;
          lines.push(l);
        }
      }
    }
    numstat.set(p, { added, removed, binary });
    const section = lines.join('\n') + '\n';
    parts.push(section); bytes += Buffer.byteLength(section);
  }
  return { patch: parts.join(''), numstat, truncated };
}

/** changes.json alone, temp + rename (Discard: the patch is never read back). `files` is folderFiles(dir). */
export async function writeChangesJson(files, changes) {
  await writeAtomic(files.changes, JSON.stringify(changes, null, 2) + '\n');
}

/** changes.json + changes.patch, each temp + rename. `files` is folderFiles(dir). */
export async function writeChangesFiles(files, changes, patch) {
  await writeChangesJson(files, changes);
  await writeAtomic(files.patch, patch ?? '');
}

export async function readChangesFile(path) {
  try { const c = JSON.parse(await readRegularText(path)); return c && typeof c === 'object' ? c : null; } catch { return null; }
}
