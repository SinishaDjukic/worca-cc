// src/core/design/export.mjs
// Design P6 (C-8, L25, L6.3, L6.5, L6.10): exports of a finished round. Only `status === 'done'` with a written
// `dist/index.html` exports, so `work/` (the standalone page) and `dist/` (the zip) always hold the same round. The
// standalone page is P1's `assembleDesign` in `standalone` mode: no bridge, local refs inlined, what was left out comes
// back as problems. The zip holds `dist/` under one top folder, streamed through `fflate`; entry names are built from
// dirent names with `/`, never from `path.relative` or `sep`, so Windows sees no backslash. Copying into a project
// (C-8) writes `dist/` into a folder inside the project's real path, never into `.git`, never through a link, and
// refuses every collision before it writes anything. The deck PDF (L6.1) prints the standalone page through
// `staticDoc` with worca's own `deck-stage.js` as the one nonced script, and keeps it only when the page count equals
// the live slides, the deck kit's own rule.
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync, constants as fsc, copyFileSync, createReadStream, fstatSync, ftruncateSync, linkSync, lstatSync, mkdirSync,
  mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, unlinkSync,
  write as fdWrite, writeFileSync,
} from 'node:fs';
import { lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { chromeNoSandbox, pdfArgs } from '../../../assets/deck-preview/chrome.mjs';
import { isWithin, realOrNull } from '../fs-scope.mjs';
import { assembleDesign, readConfined } from './assemble.mjs';
import { RENDER_TIMEOUTS, runChrome, staticDoc } from './render.mjs';
import { designWorkDir, distDir } from './paths.mjs';
import { validatePlan } from './plan.mjs';
import { exportStem } from '../../shared/design-names.mjs';

/** A refusal the route answers as `{error, code, ...data}` with `status`. */
export class ExportRefusal extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {object} [data]
   */
  constructor(status, code, message, data = {}) {
    super(message);
    this.name = 'ExportRefusal';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export const EXPORT_FORMATS = Object.freeze(['html', 'zip', 'pdf', 'project']);

const notDone = () => new ExportRefusal(409, 'not-done', 'Export is ready when a round has finished.');

function isRegularFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Throws `ExportRefusal(409, 'not-done')` unless the design's round has finished and `dist/index.html` is there.
 * @param {{ id: string, status: string }} design
 */
export function requireExportable(design) {
  if (design?.status !== 'done' || !isRegularFile(join(distDir(design.id), 'index.html'))) throw notDone();
}

/**
 * The design's validated `plan.json`; a missing or invalid plan gives the same `not-done` refusal.
 * @param {{ id: string, kind: string }} design
 */
export function readExportPlan(design) {
  const r = validatePlan(readConfined(designWorkDir(design.id), 'plan.json'), { kind: design.kind });
  if (!r.ok) throw notDone();
  return r.plan;
}

/**
 * The standalone page: `<stem>.html`, the page with its local refs inlined, and what was left out.
 * @param {{ id: string, kind: string, title: string, status: string }} design
 * @returns {{ name: string, html: string, problems: Array<{ ref: string, why: string }> }}
 */
export function exportHtml(design) {
  requireExportable(design);
  const plan = readExportPlan(design);
  const { html, problems } = assembleDesign({ workDir: designWorkDir(design.id), plan, mode: 'standalone' });
  return { name: `${exportStem(design.title)}.html`, html, problems };
}

/**
 * Every regular file under `dist`, as sorted `/`-joined paths. Dot names and links are skipped.
 * @param {string} dist
 * @returns {string[]}
 */
export function listDistFiles(dist) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), rel);
      else if (e.isFile()) out.push(rel);
    }
  };
  walk(dist, '');
  return out.sort();
}

/**
 * A copy of `dist`'s files (`listDistFiles`) in a temp folder of its own, made synchronously. A round's dist write
 * (`writeDist`) and a restore's rebuild swap `dist/` synchronously too, so neither lands in the middle: a zip or a copy
 * into a project that reads the copy over many awaits reads one round. Cloned where the file system can.
 * @param {string} dist
 * @returns {{ dir: string, cleanup: () => void }} `cleanup()` removes the copy
 */
export function snapshotDist(dist) {
  const dir = mkdtempSync(join(tmpdir(), 'worca-design-export-'));
  const cleanup = () => rmSync(dir, RM_RETRY);
  try {
    for (const rel of listDistFiles(dist)) {
      const parts = rel.split('/');
      mkdirSync(join(dir, ...parts.slice(0, -1)), { recursive: true });
      copyFileSync(join(dist, ...parts), join(dir, ...parts), fsc.COPYFILE_FICLONE);
    }
  } catch (e) {
    cleanup();
    throw e;
  }
  return { dir, cleanup };
}

// Already compressed: stored as they are.
const STORED = /\.(png|jpe?g|gif|webp|avif|woff2?|mp3|m4a|ogg|mp4|webm|zip|gz|br)$/i;
const READ_CHUNK = 64 * 1024;

function abortError() {
  const e = new Error('the export was stopped');
  e.name = 'AbortError';
  return e;
}

/**
 * Streams `dist` as a zip whose entries sit under `root/`. Each chunk goes to `write`, which is awaited before the
 * next read, so a slow reader holds the zip back. An aborted `signal` stops it with an `AbortError`.
 * @param {{ dist: string, root: string, write: (chunk: Uint8Array) => unknown, signal?: AbortSignal|null }} opts
 * @returns {Promise<{ files: number }>}
 */
export async function zipDist({ dist, root, write, signal = null }) {
  const queue = [];
  let failure = null;
  const zip = new Zip((err, chunk) => {
    if (err) failure = failure ?? err;
    else queue.push(chunk);
  });
  const check = () => {
    if (failure) throw failure;
    if (signal?.aborted) throw abortError();
  };
  const drain = async () => {
    while (queue.length) {
      check();
      await write(queue.shift());
    }
  };
  const files = listDistFiles(dist);
  for (const rel of files) {
    const name = `${root}/${rel}`;
    const file = STORED.test(rel) ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
    zip.add(file);
    const stream = createReadStream(join(dist, ...rel.split('/')), {
      flags: fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0),
      highWaterMark: READ_CHUNK,
    });
    try {
      const chunks = stream[Symbol.asyncIterator]();
      for (;;) {
        check();
        const { value, done } = await chunks.next();
        if (done) break;
        file.push(value, false);
        await drain();
      }
    } finally {
      stream.destroy();
    }
    file.push(new Uint8Array(0), true);
    await drain();
  }
  zip.end();
  await drain();
  if (failure) throw failure;
  return { files: files.length };
}

const PROBLEMS_SHOWN = 20;
const PROBLEM_REF_MAX = 120;
const PROBLEMS_HEADER_MAX = 6000;

/**
 * What an export left out, for the `X-Worca-Export-Problems` header: `{total, shown}` with at most 20 entries, each
 * `ref` cut to 120 chars, URI-encoded and at most 6000 chars long. `total` stays the true count.
 * @param {Array<{ ref: string, why: string }>} problems
 * @returns {string}
 */
export function encodeProblems(problems) {
  const list = Array.isArray(problems) ? problems : [];
  // A cut through a surrogate pair is safe: JSON.stringify escapes a lone surrogate, so encodeURIComponent never sees it.
  const shown = list.slice(0, PROBLEMS_SHOWN).map((p) => ({
    ref: String(p?.ref ?? '').slice(0, PROBLEM_REF_MAX),
    why: String(p?.why ?? ''),
  }));
  const encode = () => encodeURIComponent(JSON.stringify({ total: list.length, shown }));
  let value = encode();
  while (value.length > PROBLEMS_HEADER_MAX && shown.length) {
    shown.pop();
    value = encode();
  }
  return value;
}

const SUBDIR_MAX = 200;
const WINDOWS_PATH_MAX = 259;
const COLLISIONS_SHOWN = 20;
/** `.git` and the forms Windows reads as `.git`: trailing dots and spaces, and the 8.3 short name `git~1`. */
const GIT_NAME = /^\.git[. ]*$/i;
const GIT_SHORT_NAME = /^git~\d+$/i;
const RESERVED_STEM = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const BAD_CHARS = /[<>:"|?*]/;
const FOLDER_TEXT = {
  'bad-folder': 'Folder must be a path inside the project.',
  'git-folder': 'worca does not write into .git.',
};

const isGitName = (name) => GIT_NAME.test(name) || GIT_SHORT_NAME.test(name);
const hasControlChar = (name) => [...name].some((c) => c.charCodeAt(0) < 32);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The project folder an export is copied into, as `/`-joined segments relative to the project root (`''` is the root).
 * Windows name rules apply on every OS (L6.12): a project is often opened on another machine. `.github` and other dot
 * folders are allowed; only `.git` and its Windows forms are refused (L6.11). Pure.
 * @param {unknown} subdir
 * @returns {{ ok: true, rel: string } | { ok: false, code: 'bad-folder' | 'git-folder', error: string }}
 */
export function checkExportSubdir(subdir) {
  const no = (code) => ({ ok: false, code, error: FOLDER_TEXT[code] });
  if (typeof subdir !== 'string' || subdir.length > SUBDIR_MAX) return no('bad-folder');
  const text = subdir.trim();
  if (!text || text.includes('\0')) return no('bad-folder');
  const path = text.replace(/\\/g, '/');
  if (path.startsWith('/') || /^[a-z]:/i.test(path)) return no('bad-folder');
  const segments = path.split('/').filter((s) => s && s !== '.');
  if (segments.includes('..')) return no('bad-folder');
  for (const s of segments) {
    if (isGitName(s)) return no('git-folder');
    if (RESERVED_STEM.test(s) || /[. ]$/.test(s) || BAD_CHARS.test(s) || hasControlChar(s)) return no('bad-folder');
  }
  return { ok: true, rel: segments.join('/') };
}

/** `lstat`, or null when nothing is there. */
async function lstatOrNull(path) {
  try {
    return await lstat(path);
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

const linkRefusal = (shown) => new ExportRefusal(422, 'link', `${shown} is a link, so nothing was copied.`);
const fileRefusal = (shown) => new ExportRefusal(422, 'not-a-folder', `${shown} is a file, not a folder.`);
/** Something other than a regular file at a file's path: a folder, a FIFO (whose open would block), a socket. */
const notAFileRefusal = (shown, st) => new ExportRefusal(422, 'not-a-file', st.isDirectory() ? `${shown} is a folder, not a file.` : `${shown} is not a file.`);

/** `lstatSync`, or null when nothing is there. */
function lstatOrNullSync(path) {
  try {
    return lstatSync(path);
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

/** A change another writer made while the copy ran: `why` ends the `partial` text. */
const midway = (why) => Object.assign(new Error(why), { why });

/** A new file only: never an existing entry, never through a link at the path itself. */
const NEW_FILE = fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL | (fsc.O_NOFOLLOW ?? 0);

/**
 * What a 409 `exists` hands out for its whole collision list in the real folder it was found in (`target`, with the
 * links on its way followed); `overwrite` must bring it back.
 */
const collisionsKey = (target, collisions) => createHash('sha256').update(JSON.stringify([target, collisions])).digest('hex');

/**
 * Whether the open `fd` is the very file at `path` now (device and inode, by `lstat`, so never through a link) and
 * has no other name: a hard link made to it elsewhere would get its bytes too.
 */
function isOpenAt(fd, path) {
  let now;
  try {
    now = lstatSync(path, { bigint: true });
  } catch (e) {
    if (e?.code === 'ENOENT') return false;
    throw e;
  }
  const open = fstatSync(fd, { bigint: true });
  return open.nlink === 1n && now.dev === open.dev && now.ino === open.ino;
}

const writeAt = promisify(fdWrite);

/**
 * Copies `src` into the open `fd`, which stays open. The fd is never handed to a stream: a stream closes it on an error,
 * and the caller's own close would then close whatever file took its number meanwhile.
 */
async function writeInto(src, fd) {
  for await (const chunk of createReadStream(src)) {
    for (let off = 0; off < chunk.length;) off += (await writeAt(fd, chunk, off, chunk.length - off)).bytesWritten;
  }
}

/** The codes `link` gives where the file system has no hard links (FAT, exFAT, some SMB shares; Windows reads FAT's
 *  "invalid function" as EISDIR). */
const NO_HARD_LINKS = new Set(['EPERM', 'ENOTSUP', 'ENOSYS', 'EISDIR']);

/**
 * After a copy into the new file open as `fd` at `dest` failed: empties that file (worca's own inode only), checks that
 * `dest`'s folder is still the one the copy started in (`inPlace`, in the rename's tick: the copy awaited, and a link
 * planted on the way meanwhile would lead the rename out of the project), makes a fresh folder of worca's own beside
 * `dest` and checks the way and that folder again, then renames whatever is at `dest` now into that folder (a rename
 * moves what is there, never through a link). The folder exists only where it was made, so a link planted on the way
 * after the checks, which no check in the same tick can stop since another process plants it, leads the rename to a
 * folder that is not there and nothing moves; a link planted before the folder is made leaves it where the link led,
 * and the check after it removes it, while it is still empty. The moved name is removed only when it holds the open
 * file: device and inode of the name and of the open file, both read after the rename, since FAT and exFAT number a
 * file anew when it is written, emptied or renamed. Node can neither unlink by fd nor rename without replacing, so a
 * name is never removed on a check of the name alone: another program's file that took `dest` meanwhile is kept in
 * worca's folder, which the returned error gives; otherwise the folder is removed. When the folder moved, nothing is
 * renamed. Closes `fd`.
 * @param {number} fd
 * @param {string} dest
 * @param {Error & { why?: string, code?: string }} e the copy's own failure
 * @param {(name: string) => string} shown a name in `dest`'s folder, as the project shows it
 * @param {() => boolean} inPlace whether `dest`'s folder is still the one the copy started in; throws a refusal when
 *   the way now leads out of the project
 * @returns {Error} what to report: `e`, the way's refusal, or one that says where the other program's file is now
 */
function clearOwn(fd, dest, e, shown, inPlace) {
  const closed = (r) => { try { closeSync(fd); } catch { /* the copy's failure is the one worth reporting */ } return r; };
  try { ftruncateSync(fd, 0); } catch { /* the name is still cleared below */ }
  let here = false;
  try { here = inPlace(); } catch (m) { return closed(m); }
  if (!here) return closed(e);
  const box = join(dirname(dest), `.worca-${randomBytes(4).toString('hex')}`);
  const unbox = () => { try { rmdirSync(box); } catch { /* not empty, or not there: left as it is */ } };
  try { mkdirSync(box); } catch { return closed(e); }
  try { here = inPlace() && lstatSync(box).isDirectory(); } catch (m) { unbox(); return closed(m?.why ? m : e); }
  if (!here) { unbox(); return closed(e); }
  const aside = join(box, basename(dest));
  let moved = true;
  try { renameSync(dest, aside); } catch { moved = false; } // nothing at the name, its folder swapped, or it cannot move
  let mine = false;
  if (moved) {
    try {
      const st = lstatSync(aside, { bigint: true });
      const now = fstatSync(fd, { bigint: true });
      mine = st.dev === now.dev && st.ino === now.ino;
    } catch { /* unknown: kept, and named below */ }
  }
  closed();
  if (!moved) { unbox(); return e; }
  if (mine) {
    try { unlinkSync(aside); } catch { /* an empty file in a folder of worca's own at most */ }
    unbox();
    return e;
  }
  return midway(`${e?.why ?? e?.code ?? 'an error'}. Another program wrote ${shown(basename(dest))} meanwhile; its file is now ${shown(`${basename(box)}/${basename(dest)}`)}`);
}

/**
 * Where the file system has no hard links: copies the part file into a new file opened at `dest` (`NEW_FILE`, so never
 * over a file or through a link at `dest`), in the caller's tick. A copy that fails is cleared by `clearOwn`, never by
 * `dest`'s name. After a copy that worked, `dest` must still be the open file; when another program took the name
 * meanwhile, the copy stops there and nothing is removed.
 * @param {string} part
 * @param {string} dest
 * @param {{ open: (path: string, flags: number, mode: number) => number, write: (src: string, fd: number) => Promise<unknown>,
 *   shown: (name: string) => string, inPlace: () => boolean }} seams
 */
async function copyNew(part, dest, { open, write, shown, inPlace }) {
  const fd = open(dest, NEW_FILE, 0o666);
  try {
    await write(part, fd);
  } catch (e) {
    throw clearOwn(fd, dest, e, shown, inPlace);
  }
  let here = false;
  try { here = isOpenAt(fd, dest); } finally { closeSync(fd); }
  if (!here) throw midway(`${shown(basename(dest))} changed meanwhile`);
}

/**
 * Puts the finished part file at `dest`, which must be a new name: a hard link never replaces anything (EEXIST), and the
 * part's own name goes after it. Where the file system has no hard links, `copyNew` copies it into a new file, which
 * also never replaces a file or follows a link at `dest`: no check-then-rename, which a file made in between would lose.
 * The link, or the new file's open, runs in the caller's tick.
 * @param {string} part
 * @param {string} dest
 * @param {{ link: (from: string, to: string) => void, open: (path: string, flags: number, mode: number) => number,
 *   write: (src: string, fd: number) => Promise<unknown>, shown: (name: string) => string, inPlace: () => boolean }} seams
 */
async function placeNew(part, dest, { link, open, write, shown, inPlace }) {
  try {
    link(part, dest);
  } catch (e) {
    if (!NO_HARD_LINKS.has(e?.code)) throw e;
    await copyNew(part, dest, { open, write, shown, inPlace });
  }
  try { unlinkSync(part); } catch { /* the file is in place; what stays is a second name of worca's own */ }
}

/**
 * The folder a file of the copy goes into, made now, one segment at a time with a plain `mkdir`, and checked on the
 * way down from the project's real path by the checks' own rules: on the target's way a link must still lead to a
 * folder inside the project and outside `.git`, and every segment to the real folder the checks found (`way`), so the
 * copy writes only into the folder its collisions were looked for in; under the target no link at all. Synchronous, so
 * the caller starts its copy with no await after it.
 * @param {string} real the project's real path
 * @param {string[]} segments the target's own segments
 * @param {string[]} way the real folder each of `segments` led to at the checks
 * @param {string[]} parts the file's folder segments under the target
 * @returns {string}
 */
function folderNow(real, segments, way, parts) {
  let at = real;
  const step = (name, shown, expected) => {
    const path = join(at, name);
    let st = lstatOrNullSync(path);
    if (!st) {
      if (expected !== undefined && path !== expected) throw midway(`${shown} moved`);
      try { mkdirSync(path); } catch (e) { if (e?.code !== 'EEXIST') throw e; }
      st = lstatSync(path);
    }
    if (st.isSymbolicLink()) {
      if (expected === undefined) throw midway(`${shown} is a link`);
      let resolved = null;
      try { resolved = realpathSync.native(path); } catch { resolved = null; }
      if (resolved === null || !isWithin(resolved, real)) throw midway(`${shown} leads outside the project`);
      if (relative(real, resolved).split(/[\\/]/).some(isGitName)) throw midway(`${shown} leads into .git`);
      if (!lstatSync(resolved).isDirectory()) throw midway(`${shown} is not a folder`);
      at = resolved;
    } else if (st.isDirectory()) {
      at = path;
    } else {
      throw midway(`${shown} is not a folder`);
    }
    if (expected !== undefined && at !== expected) throw midway(`${shown} moved`);
  };
  segments.forEach((s, i) => step(s, segments.slice(0, i + 1).join('/'), way[i]));
  parts.forEach((p, i) => step(p, [...segments, ...parts.slice(0, i + 1)].join('/')));
  return at;
}

/**
 * Copies every file of `dist` into `subdir` of the project, keeping the layout. Nothing is committed. Every check runs
 * before the first write: the folder must lie inside the project's real path and outside `.git`, even through a link;
 * no link may sit on a file's way or at its path, and nothing but a regular file at its path. Collisions are refused
 * with their key (`collisionsKey`, over the real folder they were found in and the list); `overwrite` replaces them
 * only when `expect` is that key for the folder and list found now, so a list that changed since the person saw it, or
 * the same names in another folder, is a new 409 and nothing is written. Only real paths are compared: macOS
 * `tmpdir()` is itself a link.
 * Another writer can still change the project while the copy runs. So for each file, back to back on this thread with
 * no await between them: its folders are made one at a time and checked (`folderNow`, which also refuses a target that
 * now leads to another folder than the checks found), a new part file with a random name of worca's own is opened in
 * the file's folder (`O_EXCL`, `O_NOFOLLOW`), and the folders are checked again with the open file still the one at
 * its path and its only name (device, inode and link count). A link planted in the gap before the open is caught right
 * after it: at worst an empty part file stays where the link led, never the bytes, which are written only into the
 * checked file. After the bytes the same check runs again, and in the same tick the part file is put in place: renamed
 * over a listed collision, so a link or a hard link at the path is replaced, never written through; hard-linked (or,
 * with no hard links, copied into a new file opened exclusively, `copyNew`) to any other file's name, which must be new,
 * so a file planted there meanwhile is never replaced (`placeNew`). Any failure removes the part file by its own name,
 * and such a new file only by a name of worca's own that still holds it (`clearOwn`), so no half-written file is left
 * at a file's name and another program's file is never removed.
 * @param {{ dist: string, projectDir: string, subdir: string, overwrite?: boolean, expect?: unknown, platform?: string,
 *   open?: (path: string, flags: number, mode: number) => number, write?: (src: string, fd: number) => Promise<unknown>,
 *   link?: (from: string, to: string) => void }} opts
 *   `open` (synchronous), `write` and `link` (synchronous) are seams for tests
 * @returns {Promise<{ target: string, files: number }>} `target` is the folder relative to the project, `.` for its root
 * @throws {ExportRefusal}
 */
export async function copyDistToProject({
  dist, projectDir, subdir, overwrite = false, expect = null, platform = process.platform, open = openSync, write = writeInto,
  link = linkSync,
}) {
  const checked = checkExportSubdir(subdir);
  if (!checked.ok) throw new ExportRefusal(422, checked.code, checked.error);
  const real = await realOrNull(projectDir);
  if (real === null) throw new ExportRefusal(422, 'project-missing', 'This project\'s folder is missing.');
  const segments = checked.rel ? checked.rel.split('/') : [];

  // The folder's own way down from the project root: a link must stay inside the project and outside `.git`. `way`
  // keeps the real folder each segment leads to, or the path the copy will make for one that is missing.
  const way = [];
  let at = real;
  let missing = false;
  for (let i = 0; i < segments.length; i += 1) {
    const path = join(at, segments[i]);
    const st = missing ? null : await lstatOrNull(path);
    if (!st) {
      missing = true;
      at = path;
      way.push(at);
      continue;
    }
    const shown = segments.slice(0, i + 1).join('/');
    if (st.isSymbolicLink()) {
      const resolved = await realOrNull(path);
      if (resolved === null || !isWithin(resolved, real)) throw new ExportRefusal(422, 'outside-project', 'That folder is outside the project.');
      if (relative(real, resolved).split(/[\\/]/).some(isGitName)) throw new ExportRefusal(422, 'git-folder', FOLDER_TEXT['git-folder']);
      if (!(await lstat(resolved)).isDirectory()) throw fileRefusal(shown);
      at = resolved;
    } else if (st.isDirectory()) {
      at = path;
    } else {
      throw fileRefusal(shown);
    }
    way.push(at);
  }

  const target = at; // the real folder, so the collisions below are looked for where the copy will write
  const files = listDistFiles(dist);
  const collisions = [];
  const judged = new Set(); // the folders under the target already checked
  for (const file of files) {
    const parts = file.split('/');
    const dest = join(target, ...parts);
    if (platform === 'win32' && dest.length > WINDOWS_PATH_MAX) {
      throw new ExportRefusal(422, 'path-too-long', `${file} would be longer than Windows allows.`);
    }
    for (let i = 1; i < parts.length; i += 1) {
      const folder = parts.slice(0, i).join('/');
      if (judged.has(folder)) continue;
      judged.add(folder);
      const st = await lstatOrNull(join(target, ...parts.slice(0, i)));
      const shown = [...segments, ...parts.slice(0, i)].join('/');
      if (st?.isSymbolicLink()) throw linkRefusal(shown);
      if (st && !st.isDirectory()) throw fileRefusal(shown);
    }
    const st = await lstatOrNull(dest);
    if (st?.isSymbolicLink()) throw linkRefusal([...segments, ...parts].join('/'));
    if (st && !st.isFile()) throw notAFileRefusal([...segments, ...parts].join('/'), st);
    if (st) collisions.push(file);
  }
  const key = collisionsKey(target, collisions);
  if (collisions.length && (!overwrite || expect !== key)) {
    const n = collisions.length;
    throw new ExportRefusal(409, 'exists', n === 1 ? '1 file already exists.' : `${n} files already exist.`, {
      collisions: collisions.slice(0, COLLISIONS_SHOWN),
      total: n,
      collisionsKey: key,
    });
  }
  const replace = new Set(collisions);

  let copied = 0;
  for (const file of files) {
    const parts = file.split('/');
    const folders = parts.slice(0, -1);
    const shown = [...segments, ...folders].join('/') || 'the folder';
    let fd = null;
    let part = null;   // the part file this copy made, removed on a failure
    const close = () => {
      if (fd === null) return;
      const was = fd;
      fd = null;
      closeSync(was);
    };
    try {
      // The checks, the open and the checks again, back to back with no await: no queue wait between them.
      const folder = folderNow(real, segments, way, folders);
      const dest = join(folder, parts.at(-1));
      const at = join(folder, `.worca-${randomBytes(4).toString('hex')}.part`);
      fd = open(at, NEW_FILE, 0o666);
      part = at;
      const inPlace = () => folderNow(real, segments, way, folders) === folder;
      const still = () => inPlace() && isOpenAt(fd, at);
      if (!still()) throw midway(`${shown} moved`);
      await write(join(dist, ...parts), fd);
      // Checked again, then put in place in the same tick.
      if (!still()) throw midway(`${shown} moved`);
      close();
      if (replace.has(file)) renameSync(part, dest);
      else await placeNew(part, dest, { link, open, write, inPlace, shown: (name) => [...segments, ...folders, name].join('/') });
      part = null;
    } catch (e) {
      try { close(); } catch { /* the failure below is the one worth reporting */ }
      try { if (part !== null) rmSync(part, { force: true }); } catch { /* as above */ }
      throw new ExportRefusal(500, 'partial', `Copied ${copied} of ${plural(files.length, 'file', 'files')}, then: ${e?.why ?? e?.code ?? 'an error'}.`, {
        copied,
        total: files.length,
      });
    }
    copied += 1;
  }
  return { target: checked.rel || '.', files: files.length };
}

/** The kinds a PDF is for. */
const DECK_KINDS = new Set(['presentation', 'pitch']);
/** worca's own deck kit: a classic IIFE with no fetches, the only script the PDF runs. */
const DECK_KIT = fileURLToPath(new URL('../../../assets/deck-kit/deck-stage.js', import.meta.url));
const FIRST_START_TAG = /<[a-z][^>]*>/i;
const RM_RETRY = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 };

/**
 * The pages of a PDF, by the deck kit's rule (`scripts/deck-pdf.py`): every `/Type /Page` object, not `/Pages`.
 * @param {Buffer} buffer
 * @returns {number}
 */
export function countPdfPages(buffer) {
  return buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
}

/**
 * The slides a deck prints: plan sections whose `index.html` reads and whose first start tag has no `data-deck-skip`
 * (the kit's print sheet hides those).
 * @param {{ workDir: string, plan: { sections?: Array<{ id: string }> } }} opts
 * @returns {number}
 */
export function liveSlides({ workDir, plan }) {
  let n = 0;
  for (const section of plan?.sections ?? []) {
    const text = readConfined(workDir, `sections/${section?.id}/index.html`);
    const tag = text === null ? null : FIRST_START_TAG.exec(text)?.[0];
    if (tag && !/data-deck-skip/i.test(tag)) n += 1;
  }
  return n;
}

/**
 * Prints a deck to a PDF in a temp folder of its own. The kind and Chrome are checked before anything is made; the
 * route checks the finished round (`requireExportable`). The doc is `staticDoc` of the standalone page, so no model JS
 * runs, with the kit under a random nonce. Any failure removes the folder before it throws; on success the caller
 * sends `file` and then calls `cleanup()`.
 * @param {{ design: { id: string, kind: string, title: string }, plan: object, chrome: string | null,
 *   signal?: AbortSignal | null, run?: typeof runChrome }} opts
 * @returns {Promise<{ file: string, name: string, pages: number, slides: number,
 *   problems: Array<{ ref: string, why: string }>, cleanup: () => void }>}
 * @throws {ExportRefusal} `decks-only`, `no-chrome`, `no-pdf` or `page-count`, all 422
 */
export async function printDeckPdf({ design, plan, chrome, signal = null, run = runChrome }) {
  if (!DECK_KINDS.has(design?.kind)) throw new ExportRefusal(422, 'decks-only', 'PDF is for decks.');
  if (!chrome) throw new ExportRefusal(422, 'no-chrome', 'PDF needs Chrome or Edge on this machine. Install one, or set WORCA_CHROME.');
  const workDir = designWorkDir(design.id);
  const kitScript = readFileSync(DECK_KIT, 'utf8');
  const nonce = randomBytes(16).toString('base64url');
  const { html, problems } = assembleDesign({ workDir, plan, mode: 'standalone' });
  const doc = staticDoc(html, { nonce, kitScript });
  const slides = liveSlides({ workDir, plan });

  const dir = mkdtempSync(join(tmpdir(), 'worca-design-pdf-'));
  const cleanup = () => rmSync(dir, RM_RETRY);
  try {
    const htmlPath = join(dir, 'doc.html');
    const pdfPath = join(dir, 'deck.pdf');
    writeFileSync(htmlPath, doc);
    const r = await run(chrome, pdfArgs({ htmlPath, pdfPath, noSandbox: chromeNoSandbox() }), {
      outFile: pdfPath,
      timeoutMs: RENDER_TIMEOUTS.pdfMs,
      signal,
    });
    if (!r.ok) throw new ExportRefusal(422, 'no-pdf', `Chrome produced no PDF: ${r.reason}.`);
    const pages = countPdfPages(readFileSync(pdfPath));
    if (pages !== slides) {
      throw new ExportRefusal(422, 'page-count', `The PDF came out with ${plural(pages, 'page', 'pages')} for ${plural(slides, 'slide', 'slides')}, so it was not saved.`);
    }
    return { file: pdfPath, name: `${exportStem(design.title)}.pdf`, pages, slides, problems, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}
