// src/core/git-free/archive.mjs — safe .tar.gz extraction for the git-free transports (P6 Task 1).
// GitHub archives (and `git archive`) hold one top folder `<owner>-<repo>-<sha7>/`; it is stripped, with an optional
// prefix below it. A path that would leave `dest` is never written; hardlinks and devices are never created;
// symlinks are written verbatim only when asked for, and never one whose target leaves `dest` (an absolute target,
// or `..` past the root: skipped as `escaping-link`, as tar 7.5 refuses them); callers remove links that escape a
// narrower folder (a plugin's) with findEscapingSymlinks. Links are made once tar has written every file (tar 7.5
// refuses a link whose target is, or passes through, a link: `CLAUDE.md -> AGENTS.md`, `GEMINI.md -> CLAUDE.md`), so
// nothing is ever written through one; a link below a link, or at a folder's path, fails the extraction.
// An archive that ends before tar's end-of-archive marker is refused (TAR_BAD_ARCHIVE), never taken for a whole tree.
import { lstatSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { join, posix } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { x } from 'tar';

export const ARCHIVE_LIMITS = Object.freeze({ downloadBytes: 512 * 2 ** 20, extractBytes: 1024 * 2 ** 20, entries: 200_000, fileBytes: 512 * 2 ** 20 });

export class ArchiveError extends Error {
  constructor(limit) {
    super(`archive too large (${limit})`);
    this.name = 'ArchiveError';
    this.code = 'TOO_LARGE';
    this.limit = limit;
  }
}

/** A relative `/`-path that stays inside its folder on every OS. */
export function isSafeRelPath(p) {
  if (typeof p !== 'string' || p === '') return false;
  if (p.includes('\\') || p.includes('\0')) return false;
  if (/^[A-Za-z]:/.test(p)) return false;
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

const META = new Set(['GlobalExtendedHeader', 'ExtendedHeader', 'OldExtendedHeader', 'NextFileHasLongPath', 'NextFileHasLongLinkpath']);
const FILES = new Set(['File', 'OldFile', 'ContiguousFile']);

/** A link at `from` (a `/`-path below dest) whose target resolves outside dest: absolute, a drive, or `..` past the root. */
function linkEscapes(from, target) {
  const t = String(target ?? '').replaceAll('\\', '/');
  if (t === '' || t.includes('\0') || t.startsWith('/') || /^[A-Za-z]:/.test(t)) return true;
  const r = posix.normalize(posix.join(posix.dirname(from), t));
  return r === '..' || r.startsWith('../');
}

const throughLink = () => Object.assign(new Error('TAR_SYMLINK_ERROR: Cannot extract through symbolic link'), { code: 'TAR_SYMLINK_ERROR' });

/** Make one deferred link at `out` below dest: never below a link, never in place of a folder (tar's own rules). */
function makeLink(dest, out, linkpath) {
  const parts = out.split('/');
  for (let i = 1; i < parts.length; i += 1) {
    let st;
    try { st = lstatSync(join(dest, ...parts.slice(0, i))); } catch (e) { if (e?.code === 'ENOENT') break; throw e; }
    if (st.isSymbolicLink()) throw throughLink();
  }
  if (parts.length > 1) mkdirSync(join(dest, ...parts.slice(0, -1)), { recursive: true });
  const at = join(dest, ...parts);
  let st = null;
  try { st = lstatSync(at); } catch (e) { if (e?.code !== 'ENOENT') throw e; }
  if (st?.isDirectory()) throw throughLink();
  if (st) unlinkSync(at);
  symlinkSync(linkpath, at);
}

function toReadable(source) {
  if (Buffer.isBuffer(source)) return Readable.from([source]);
  if (source && typeof source.getReader === 'function') return Readable.fromWeb(source);
  return source;
}

export async function extractTarGz(source, dest, { include = () => true, stripPrefix = '', links = true, limits = ARCHIVE_LIMITS, platform = process.platform } = {}) {
  const input = toReadable(source);
  let seen = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length;
      if (seen > limits.downloadBytes) cb(new ArchiveError('downloadBytes'));
      else cb(null, chunk);
    },
  });
  // A source never read must not be left to fail later with no listener (a reset, the download deadline).
  try { mkdirSync(dest, { recursive: true }); } catch (e) { input.destroy?.(); throw e; }
  let top = null;
  let entries = 0;
  let files = 0;
  let bytes = 0;
  const skipped = [];
  const pending = new Map();   // out → linkpath, in archive order: the links made after tar wrote every file
  const filter = (path, entry) => {
    if (META.has(entry.type)) return false;
    const first = path.split('/')[0];
    if (top === null) top = isSafeRelPath(first) ? first : '/';
    if (first !== top) { skipped.push({ path, why: 'unsafe' }); return false; }
    const rel = path.slice(first.length + 1).replace(/\/$/, '');
    if (rel === '') return false;
    // A drive prefix matters only on the path tar writes (`out`, below): `a:b/SKILL.md` stripped of `a:b` is `SKILL.md`.
    if (!isSafeRelPath(rel.replace(/^[A-Za-z]:/, '_'))) { skipped.push({ path, why: 'unsafe' }); return false; }
    if (stripPrefix && !(rel === stripPrefix || rel.startsWith(`${stripPrefix}/`))) return false;
    if (!include(rel)) return false;
    // the path tar writes is judged too: `sk/C:x.md` is safe, its stripped `C:x.md` is not (strict tar fails on it)
    const out = stripPrefix ? rel.slice(stripPrefix.length + 1) : rel;
    if (out !== '' && !isSafeRelPath(out)) { skipped.push({ path, why: 'unsafe' }); return false; }
    if (entry.type === 'SymbolicLink') {
      if (!links) { skipped.push({ path, why: 'type' }); return false; }
      if (platform === 'win32') { skipped.push({ path, why: 'windows-link' }); return false; }
      if (linkEscapes(out, entry.linkpath)) { skipped.push({ path, why: 'escaping-link' }); return false; }
    } else if (!FILES.has(entry.type) && entry.type !== 'Directory') {
      skipped.push({ path, why: 'type' });
      return false;
    }
    entries += 1;
    if (entries > limits.entries) { unpack.abort(new ArchiveError('entries')); return false; }
    // archive order decides, as tar decides it: a later entry at a link's path replaces the link, a later link the entry
    pending.delete(out);
    if (entry.type === 'SymbolicLink') {
      if (out !== '') pending.set(out, entry.linkpath);
      return false;
    }
    if (FILES.has(entry.type)) {
      // `remain` is what tar writes: a global pax `size` overrides `size` alone
      const size = Math.max(entry.size || 0, entry.remain || 0);
      if (size > limits.fileBytes) { unpack.abort(new ArchiveError('fileBytes')); return false; }
      bytes += size;
      if (bytes > limits.extractBytes) { unpack.abort(new ArchiveError('extractBytes')); return false; }
      files += 1;
    }
    return true;
  };
  const unpack = x({ cwd: dest, strip: 1 + (stripPrefix ? stripPrefix.split('/').length : 0), preserveOwner: false, strict: true, filter });
  // A tar cut at an entry boundary inside a whole gzip member parses cleanly (node-tar does not require the marker): only
  // the two zero blocks that end every archive tell a whole one from a partial tree.
  let marker = false;
  unpack.on('eof', () => { marker = true; });
  await pipeline(input, counter, unpack);
  if (!marker) throw Object.assign(new Error('archive truncated (no end-of-archive marker)'), { code: 'TAR_BAD_ARCHIVE' });
  for (const [out, linkpath] of pending) makeLink(dest, out, linkpath);
  return { files, bytes, skipped };
}
