// src/core/design/paths.mjs
// The Design library layout (SPEC C-1, with M1: no builds/ folder) under <WORCA_HOME>/.worca-cc/design.
// Every helper validates its ids first, so a bad id never reaches the disk. Only ensureDesignFolders, inFolder,
// inWorkFolder, realSectionDir, setAside, removeWorkEntry, placeWorkFile, removeSectionDir, copyTreeOut and
// closeToWorca write: work/ is the owner's agents' to write (P8), so what they make, remove or read there never goes
// through a link an agent planted, nor through a folder an agent renames or swaps for a link after it was checked.
// `fs.rm`, `fs/promises` `rm` and `cp` (and `rmSync` on Node 22) must never touch work/: they are JS walks that resolve
// every level by path again. Names read from work/ or a version are an agent's: on POSIX a backslash is a plain name
// character there, and an entry worca cannot read or remove is skipped or set aside, never a failure of every round.

import { randomBytes } from 'node:crypto';
import {
  closeSync, constants as fsc, fchmodSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readSync,
  renameSync, rmdirSync, rmSync, statSync, writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { worcaHome } from '../projects.mjs';
import { DesignError, DESIGN_ID_RE, sectionIdProblem } from './ids.mjs';

const POSIX = process.platform !== 'win32';
/** POSIX removes once: what fails there is an entry worca may not remove (an agent's 0555 folder), which a retry only
 *  waits on with the event loop blocked. Windows retries a removal that a program's open handle holds up. */
const RM = Object.freeze(POSIX ? { recursive: true, force: true } : { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
/** A separator inside one name: `/`, and on Windows `\` too. On POSIX a backslash is a plain name character (an
 *  agent's `img\a.png`), so a name read from work/ or a version that holds one is walked like any other. */
const SEP_RE = POSIX ? /\// : /[\\/]/;
/** What a copy out of work/ skips, as it skips links (copyTreeOut): an entry worca may not read (an agent's 0700 folder
 *  or 0600 file) or whose copy's path is too long (`dist.tmp-<8 hex>` and `<n>.tmp` are longer than `work`). */
const SKIPPED = new Set(['EACCES', 'EPERM', 'ENAMETOOLONG']);
/** One buffer for every copy (writeCopy): the copies are synchronous, so it is never shared by two at once. */
const COPY_BUF = Buffer.allocUnsafe(1 << 18);
/** How many times a name an agent fills or changes again meanwhile (a process that outlived its build) is looked at,
 *  cleared and tried once more (realFolder, placeWorkFile's rename): past this the step fails instead of chasing it
 *  forever. */
const TRIES = 5;
/** Linux, the only place agent isolation runs, reaches each level of work/ through the one above it held open
 *  (`/proc/self/fd/<fd>/<name>`, as attachments.mjs and claimExtrasDir do). */
const VIA_FD = process.platform === 'linux';
const OPEN_DIR = fsc.O_RDONLY | fsc.O_DIRECTORY | (fsc.O_NOFOLLOW ?? 0);
const OPEN_FILE = fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0) | (fsc.O_NONBLOCK ?? 0);
/** worca's own user; null on Windows, which has no owners to check. */
const worcaUid = () => process.getuid?.() ?? null;
/** What a level that is not there, not a folder or a link reads as: nothing to walk. */
const notThere = (err) => ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(err?.code);

export function designRoot() {
  return join(worcaHome(), 'design');
}

/** `<home>/design/<designId>`; throws BAD_REQUEST for anything that is not a design id. */
export function designDir(id) {
  if (typeof id !== 'string' || !DESIGN_ID_RE.test(id)) {
    throw new DesignError('BAD_REQUEST', `design id ${JSON.stringify(String(id))} is not valid`);
  }
  return join(designRoot(), id);
}

/** `work/`: the source, and the only place agents write. */
export function designWorkDir(id) { return join(designDir(id), 'work'); }
/** `dist/`: the engine's assembled output. */
export function distDir(id) { return join(designDir(id), 'dist'); }
/** `versions/`: restore-only copies of work/ (M2). */
export function versionsDir(id) { return join(designDir(id), 'versions'); }
/** `thumb.png`: the Library's picture (P6), outside dist/ and work/, so it is never exported or agent-writable. */
export function thumbFile(id) { return join(designDir(id), 'thumb.png'); }

/** `versions/<n>/`; n is a whole number from 1. */
export function versionDir(id, n) {
  const dir = versionsDir(id);
  if (!Number.isInteger(n) || n < 1) {
    throw new DesignError('BAD_REQUEST', `version ${JSON.stringify(String(n))} must be a whole number from 1`);
  }
  return join(dir, String(n));
}

/** `work/sections/<sectionId>/`; creates nothing. */
export function sectionDir(id, sectionId) {
  const work = designWorkDir(id);
  const problem = sectionIdProblem(sectionId);
  if (problem) throw new DesignError('BAD_REQUEST', problem);
  return join(work, 'sections', sectionId);
}

/** `work/.asks/`: one `<agentId>.json` question file per waiting agent. */
export function asksDir(id) { return join(designWorkDir(id), '.asks'); }
/** `work/.kit/`: the engine-staged kit; creates nothing. */
export function kitDir(id) { return join(designWorkDir(id), '.kit'); }
/** The capture kit a lead starts the picked project's product with, to shoot its real screens (`startApp`, `open`):
 *  the one the promo video workflow uses, run where worca is installed, so its playwright-core is found. */
export const CAPTURE_KIT = fileURLToPath(new URL('../../../assets/promo-kit/capture/lib.mjs', import.meta.url));

/** The Look kit, by absolute path: the command a lead runs before it judges a build, to see every section as it
 *  stands and which pictures their frames cut. Run where worca is installed, like the capture kit it drives. */
export const LOOK_KIT = fileURLToPath(new URL('../../../assets/design-kit/look.mjs', import.meta.url));

/** `work/assets/att/`: the person's attachments. */
export function attDir(id) { return join(designWorkDir(id), 'assets', 'att'); }
/** `work/.crew.json`: the engine's `[{id, status, summary}]`. */
export function crewFile(id) { return join(designWorkDir(id), '.crew.json'); }

/**
 * Renames `<dir>/<name>` aside in `dir`, which needs only `dir`'s write bit: to `.<name>-<8 hex>` (`.aside-<8 hex>`
 * for a name too long to extend), a dot name no copy, snapshot or assembly takes. One already gone passes.
 * @param {string} dir a folder held or checked already (inFolder)
 * @param {string} name
 */
export function setAside(dir, name) {
  checkPart(name);
  try {
    renameSync(join(dir, name), join(dir, `.${Buffer.byteLength(name) > 200 ? 'aside' : name}-${randomBytes(4).toString('hex')}`));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Whether `p` is a real folder of worca's own now: anything else there (a link, a file, a FIFO) is removed without
 * being followed, and with `uid` a folder another user owns (an agent's: it could close it to worca at any time) is
 * set aside in its parent (setAside), never used; then a missing folder is made, one level, when `create`. A removal
 * or set-aside that fails, or a make that finds the name filled, looks again (an agent's process that outlived its
 * build can change what stands at the name between the look and the act), up to TRIES looks, and only while the
 * folder above is still the one the first act was in (device and inode): off Linux `p` is a path, and a level above
 * swapped for a link meanwhile would have the next look find another design's folder.
 * Its parent must be checked already (inFolder).
 * @param {string} p
 * @param {{ create: boolean, uid?: number|null }} opts `uid` null keeps any folder (work/ itself, Windows)
 * @returns {boolean} false only when it is not there and `create` is false
 * @throws {Error} the last removal's or set-aside's failure, or `EEXIST`, when each of TRIES looks fails so or the
 *   folder above has changed
 */
function realFolder(p, { create, uid = null }) {
  let above = null;
  /** Whether `p`'s folder is still the one `above` read: what makes one more look safe. */
  const same = () => {
    try {
      const now = statSync(dirname(p));
      return now.dev === above.dev && now.ino === above.ino;
    } catch {
      return false;
    }
  };
  for (let tries = 1; ; tries += 1) {
    let st = null;
    try {
      st = lstatSync(p);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (st?.isDirectory() && (uid == null || st.uid === uid)) return true;
    if (!st && !create) return false;
    above ??= statSync(dirname(p));
    try {
      if (st?.isDirectory()) setAside(dirname(p), basename(p));
      else if (st) rmSync(p, { force: true });
    } catch (err) {
      if (tries >= TRIES || !same()) throw err;
      continue;
    }
    if (!create) return false;
    try {
      mkdirSync(p);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST' || tries >= TRIES || !same()) throw err;
    }
  }
}

/**
 * Make the library folders of one design and return its folder. Idempotent; keeps what is there.
 * `design/` keeps the default mode on purpose (L1.19: a shared install grants it through a group and setgid), but a
 * new design's own folder is worca's alone (0700) until `registry.claim` gives it to its owner's agent, and `dist/`
 * and `versions/` stay worca's (P8): restore and assembly copy through them, and no agent reads them. In work/ a
 * `sections`, `assets`, `assets/att` or `.asks` that is not a real folder of worca's own (a link an agent planted, a
 * folder it made) is replaced, each level reached through the one above it (inWorkFolder).
 * @param {string} id
 * @param {{ uid?: number|null }} [opts] worca's uid (inFolder)
 * @returns {string} designDir(id)
 */
export function ensureDesignFolders(id, { uid = worcaUid() } = {}) {
  const dir = designDir(id);
  mkdirSync(designRoot(), { recursive: true });
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  mkdirSync(designWorkDir(id), { recursive: true });
  for (const parts of [['sections'], ['assets', 'att'], ['.asks']]) inWorkFolder(id, parts, { create: true, uid });
  for (const p of [distDir(id), versionsDir(id)]) mkdirSync(p, { recursive: true, mode: 0o700 });
  return dir;
}

/** One name below a folder: never empty, `.`, `..` or holding a separator (`/`; `\` too on Windows, SEP_RE). */
function checkPart(part) {
  if (typeof part !== 'string' || !part || part === '.' || part === '..' || SEP_RE.test(part)) {
    throw new DesignError('BAD_REQUEST', `${JSON.stringify(String(part))} is not a folder name`);
  }
}

/**
 * Runs `fn(base)` with `<root>/<parts...>` reached through no link an agent planted (P8): `root` (work/, or a folder
 * like it) and then each level are made real folders first (realFolder: whatever else stands there goes, never
 * followed, a level below `root` that another user owns is renamed aside, and a missing one is made, one level, when
 * `create`). On Linux each level is then held open (`O_DIRECTORY|O_NOFOLLOW`) and the next is reached through it, and
 * `base` is the last one's `/proc/self/fd/<fd>`: an agent renaming a level or swapping it for a link afterwards cannot
 * redirect anything done through `base`. Elsewhere, where no agent runs as another user,
 * `base` is the path. The folders are closed when `fn` returns, so `fn` must finish its work before it returns.
 * @template T
 * @param {string} root
 * @param {string[]} parts single folder names; a section id must be checked first (sectionDir)
 * @param {{ create?: boolean, uid?: number|null }} [opts] `uid`: the owner a level below `root` must have (worca's)
 * @param {(base: string) => T} [fn]
 * @returns {T|null} what `fn` returns; null when a level is not there and `create` is false
 */
export function inFolder(root, parts, { create = false, uid = worcaUid() } = {}, fn = () => true) {
  for (const part of parts) checkPart(part);
  const fds = [];
  const hold = (p) => {
    if (!VIA_FD) return p;
    fds.push(openSync(p, OPEN_DIR));
    return `/proc/self/fd/${fds.at(-1)}`;
  };
  try {
    if (!realFolder(root, { create })) return null;
    let base = hold(root);
    for (const part of parts) {
      const p = join(base, part);
      if (!realFolder(p, { create, uid })) return null;
      base = hold(p);
    }
    return fn(base);
  } finally {
    for (const fd of fds) closeSync(fd);
  }
}

/** inFolder for `work/<parts...>` of design `id` (P8). */
export function inWorkFolder(id, parts, opts = {}, fn = () => true) {
  return inFolder(designWorkDir(id), parts, opts, fn);
}

/**
 * Runs `fn(base)` with `<root>/<parts...>` held as it is, changing nothing (P8): `root` (work/, which no agent can
 * rename) may be followed, every level below it must be a real folder, never followed: on Linux opened
 * `O_DIRECTORY|O_NOFOLLOW` through the one above it held open, `base` the last one's `/proc/self/fd/<fd>`; elsewhere
 * checked by lstat, `base` the path. The folders are closed when `fn` returns.
 * @template T
 * @param {string} root
 * @param {string[]} parts single folder names
 * @param {(base: string) => T} fn
 * @returns {T|null} what `fn` returns; null when `root` or a level is not there, not a folder, or a link
 */
export function readFolder(root, parts, fn) {
  for (const part of parts) checkPart(part);
  const fds = [];
  const hold = (p, flags) => {
    if (VIA_FD) {
      fds.push(openSync(p, flags));
      return `/proc/self/fd/${fds.at(-1)}`;
    }
    const st = flags === OPEN_DIR ? lstatSync(p) : statSync(p);
    if (!st.isDirectory()) throw Object.assign(new Error(`${p} is not a folder`), { code: 'ENOTDIR' });
    return p;
  };
  try {
    let base;
    try {
      base = hold(root, fsc.O_RDONLY | fsc.O_DIRECTORY);
      for (const part of parts) base = hold(join(base, part), OPEN_DIR);
    } catch (err) {
      if (notThere(err)) return null;
      throw err;
    }
    return fn(base);
  } finally {
    for (const fd of fds) closeSync(fd);
  }
}

/**
 * Writes the first `size` bytes the open file `fd` holds into `dest`, a new file (O_EXCL, never through a link), of
 * mode `mode` exactly whatever the source's: a copy never keeps an agent's mode (a 0040 file worca reads through its
 * group would become a copy of worca's own that worca cannot read, and a setuid bit would stay). `size` is the source's
 * when the copy began: a file an agent keeps appending to never holds the server's event loop past it.
 */
function writeCopy(fd, size, dest, mode) {
  const out = openSync(dest, fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL | (fsc.O_NOFOLLOW ?? 0), mode);
  try {
    fchmodSync(out, mode);
    for (let pos = 0, n; pos < size && (n = readSync(fd, COPY_BUF, 0, Math.min(COPY_BUF.length, size - pos), pos)) > 0; pos += n) {
      for (let off = 0; off < n;) off += writeSync(out, COPY_BUF, off, n - off);
    }
  } finally {
    closeSync(out);
  }
}

/** Copies the regular file `src` (in a held folder) to the new file `dest`, mode 0600 (writeCopy: the copy is in
 *  `dist/` or `versions/`, worca's alone): opened without following a link or waiting on a FIFO, copied only when it is
 *  a regular file, from its open descriptor. */
function copyFileOut(src, dest) {
  let fd;
  try {
    fd = openSync(src, OPEN_FILE);
  } catch (err) {
    if (notThere(err)) return;
    throw err;
  }
  try {
    const st = fstatSync(fd);
    if (st.isFile()) writeCopy(fd, st.size, dest, 0o600);
  } finally {
    closeSync(fd);
  }
}

/** Copies the held folder `base` (`rel` from the copy's root) into the new folder `to`: plain files and folders only,
 *  no dot names. An entry that fails with a SKIPPED code is left out, named in `skipped`; a folder worca cannot list is
 *  listed before its copy is made, so it leaves nothing behind. `entries`: `base` listed already (copyTreeOut). */
function copyHeldTree(base, to, rel, skipped, { recursive = false, entries = readdirSync(base, { withFileTypes: true }) } = {}) {
  mkdirSync(to, { recursive });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const at = rel ? `${rel}/${e.name}` : e.name;
    try {
      if (e.isDirectory()) readFolder(base, [e.name], (sub) => copyHeldTree(sub, join(to, e.name), at, skipped));
      else if (e.isFile()) copyFileOut(join(base, e.name), join(to, e.name));
    } catch (err) {
      if (!SKIPPED.has(err?.code)) throw err;
      skipped.push(`${at} (${err.code})`);
    }
  }
}

/**
 * Copies `<root>/<parts...>`, a folder an agent can write (work/ or one below it), into `to`, a folder of worca's own
 * made here (its parents too): its plain files and folders, never a dot name (the engine's: `.kit`, `.asks`,
 * `.ctx`, `.crew.json`) and never a link, FIFO or socket. Every level is walked by descriptor (readFolder) and every
 * file opened without following a link (O_NOFOLLOW): a folder or file swapped for a link meanwhile is skipped, never
 * followed, so nothing outside work/ is ever copied out of it (P8). An entry worca may not read, or whose copy's path
 * would be too long, is skipped too and logged (SKIPPED): an agent's entry never fails every later dist or snapshot.
 * So is `<root>/<parts...>` itself, or a level on the way, when worca may not hold or list it (an agent's 0700
 * `sections/<id>/assets`); `root` (work/ for a snapshot, `parts` empty) never is: a broken work/ fails the copy rather
 * than make it empty.
 * @returns {boolean} false when `<root>/<parts...>` is not there, not a real folder, or skipped (nothing made)
 */
export function copyTreeOut(root, parts, to) {
  const skipped = [];
  const start = parts.join('/');
  let listed = false;
  let copied;
  try {
    copied = readFolder(root, parts, (base) => {
      const entries = readdirSync(base, { withFileTypes: true });
      listed = true;
      copyHeldTree(base, to, start, skipped, { recursive: true, entries });
      return true;
    }) ?? false;
  } catch (err) {
    if (listed || !parts.length || !SKIPPED.has(err?.code)) throw err;
    skipped.push(`${start} (${err.code})`);
    copied = false;
  }
  if (skipped.length) {
    const more = skipped.length > 5 ? ` and ${skipped.length - 5} more` : '';
    console.warn(`[worca-design] not copied (unreadable, or too long a path): ${skipped.slice(0, 5).join(', ')}${more}`);
  }
  return copied;
}

/**
 * Removes `<base>/<name>` and what it holds, `base` from inWorkFolder. A link or a file there goes itself, never its
 * target. On Linux through the held `base`, so the removal resolves the name in that open folder. On other POSIX
 * systems a folder is first moved into a new worca-only folder in the design folder (`.trash-<random>`, 0700),
 * checked there to be the folder looked at (device and inode), and removed there, so nothing resolves a path through
 * work/; one that is not (a level swapped for a link between the look and the move) is moved back and nothing is
 * removed. On Windows by path, with retries. A POSIX removal is tried once (RM). With `aside`, what cannot be removed
 * is set aside in `base` instead (setAside: an agent's 0555 folder never stops a restore), and logged; a folder that
 * was moved out of work/ but not emptied leaves its `.trash-*` behind.
 * @param {string} id
 * @param {string} base
 * @param {string} name
 * @param {{ aside?: boolean }} [opts]
 * @throws {Error} `ELOOP` for a swap seen; the failing removal without `aside` (a Windows program holding the folder,
 *   worca's own 0555 folder), the failing rename with it
 */
export function removeWorkEntry(id, base, name, { aside = false } = {}) {
  checkPart(name);
  try {
    dropWorkEntry(id, base, name);
  } catch (err) {
    if (!aside || err.code === 'ELOOP') throw err;
    setAside(base, name);
    console.warn(`[worca-design] ${name} could not be removed (${err.code ?? err.message}): moved aside`);
  }
}

/**
 * Puts a copy of `src`, a regular file of worca's own (a version's), at `<base>/<name>`, `base` from inWorkFolder (P8):
 * written as a new dot temp in `base` (writeCopy: never through a link, mode 0660 for the owner's agent's group, never
 * the source's), then renamed over the name. A file or a link an agent makes at the name meanwhile is replaced, never
 * written through, and never stops the copy. A rename that fails looks at the name again, whatever stands there by
 * then (an agent's process that outlived its build can change it between the rename and the look): a folder is removed
 * or set aside (removeWorkEntry), and the rename is tried again, up to TRIES renames; anything else there is left to the
 * rename, which replaces it on POSIX (on Windows a read-only or held file fails each try the same way). So does the
 * temp: work/ is the agent's group's to write and not sticky, so one an agent removed or replaced meanwhile (no longer a
 * regular file) is written again from the source, under a new name, before the next try.
 * The source is opened without following a link or waiting on a FIFO.
 * @throws {Error} a failed read, write or removal, or the last of TRIES failed renames (the temp is removed first);
 *   `EINVAL` for a source that is not a file
 */
export function placeWorkFile(id, base, name, src) {
  checkPart(name);
  const to = join(base, name);
  let tmp = null;
  let fd = null;
  try {
    fd = openSync(src, OPEN_FILE);
    const st = fstatSync(fd);
    if (!st.isFile()) throw Object.assign(new Error(`${name} is not a regular file`), { code: 'EINVAL' });
    for (let tries = 1; ; tries += 1) {
      if (!tmp) {
        tmp = join(base, `.${randomBytes(6).toString('hex')}.tmp`);
        writeCopy(fd, st.size, tmp, 0o660);
      }
      try {
        renameSync(tmp, to);
        break;
      } catch (err) {
        if (tries >= TRIES) throw err;
        if (lstatSync(to, { throwIfNoEntry: false })?.isDirectory()) removeWorkEntry(id, base, name, { aside: true });
        if (!lstatSync(tmp, { throwIfNoEntry: false })?.isFile()) tmp = null;
      }
    }
  } catch (err) {
    if (tmp) rmSync(tmp, { force: true });
    throw err;
  } finally {
    if (fd != null) closeSync(fd);
  }
}

/** removeWorkEntry's removal itself (no `aside`). */
function dropWorkEntry(id, base, name) {
  const p = join(base, name);
  if (VIA_FD || !POSIX) {
    rmSync(p, RM);
    return;
  }
  let seen;
  try {
    seen = lstatSync(p);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  if (!seen.isDirectory()) {
    rmSync(p, { force: true });
    return;
  }
  const trash = mkdtempSync(join(designDir(id), '.trash-'));
  const moved = join(trash, name);
  try {
    renameSync(p, moved);
  } catch (err) {
    rmdirSync(trash);
    if (err.code === 'ENOENT') return;
    throw err;
  }
  const now = lstatSync(moved);
  if (now.dev !== seen.dev || now.ino !== seen.ino) {
    renameSync(moved, p);
    rmdirSync(trash);
    throw Object.assign(new Error(`${name} was replaced while it was removed: nothing removed`), { code: 'ELOOP' });
  }
  rmSync(trash, RM);
}

/**
 * `work/sections/<sectionId>/` for a server-side write (P8), its levels made real folders (inWorkFolder: a link an
 * agent planted is removed, never followed), and with `asks` its `.asks` too. `create` makes what is missing.
 * @param {string} id
 * @param {string} sectionId
 * @param {{ create?: boolean, asks?: boolean }} [opts]
 * @returns {string|null} the folder's path; null when it is not there and `create` is false
 * @throws {Error} a removal or mkdir that fails, or the paths' `DesignError` for a bad id
 */
export function realSectionDir(id, sectionId, { create = false, asks = false } = {}) {
  const dir = sectionDir(id, sectionId);
  return inWorkFolder(id, ['sections', sectionId, ...(asks ? ['.asks'] : [])], { create }, () => dir);
}

/** Removes `work/sections/<sectionId>/` and what it holds, never through a link nor through a `sections` swapped
 *  meanwhile (inWorkFolder, removeWorkEntry). Throws when it cannot be removed (a Windows program holding it). */
export function removeSectionDir(id, sectionId) {
  sectionDir(id, sectionId);
  inWorkFolder(id, ['sections'], {}, (sections) => removeWorkEntry(id, sections, sectionId));
}

/** Closes `dir`, a folder of worca's own, to worca: mode 0700 through a descriptor opened without following a link
 *  (`registry.claim` on `dist/` and `versions/`, P8). A folder that is not there passes; a link or another user's
 *  folder throws. No-op on Windows (no mode bits). */
export function closeToWorca(dir, { uid = process.getuid?.() ?? null } = {}) {
  if (process.platform === 'win32') return;
  let fd;
  try {
    fd = openSync(dir, fsc.O_RDONLY | fsc.O_DIRECTORY | fsc.O_NOFOLLOW);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  try {
    const st = fstatSync(fd);
    if (uid != null && st.uid !== uid) throw Object.assign(new Error(`${dir} belongs to uid ${st.uid}, not worca`), { code: 'EPERM' });
    if ((st.mode & 0o7777) !== 0o700) fchmodSync(fd, 0o700);
  } finally {
    closeSync(fd);
  }
}

/** Where the lead may write: all of work/ (the guard still denies `.kit`). */
export function leadWriteDirs(id) {
  return [designWorkDir(id)];
}

/** Where one section's builder may write: its own section folder and the question folder. */
export function builderWriteDirs(id, sectionId) {
  return [sectionDir(id, sectionId), asksDir(id)];
}
