// src/core/ask-files.mjs
// Preview files for an ask form (spec §7). Agents reference files by a
// RUN-RELATIVE path; the host resolves, sniffs, caps and SNAPSHOTS them at ask
// time, then serves them by (runId, askId, index). Nothing downstream ever takes
// a path from the agent or from HTTP.
//
// Three refusals, in order, and each is a gate-2 error the agent is resumed with:
//   1. SHAPE     — refusePathShape, pure, platform-independent (a run authored on
//                  Linux is read back on Windows, so every Windows rule applies
//                  everywhere). Only the case-FOLD of the containment comparison
//                  is platform-conditional, and `platform` is injectable.
//   2. CONTAINMENT — realpath(candidate) must sit inside realpath(one root); a
//                  symlink out of the tree therefore refuses itself.
//   3. KIND      — magic bytes decide. The extension and the agent's claim are
//                  IGNORED (§7). Text has no magic, so a UTF-8-clean body is
//                  probed by content: xml/svg, JSON, a diff header, any other
//                  leading '<' is markup and REFUSED, else text/plain.
//
// The allowlist below IS the §7 trust table. It is deliberately NOT
// src/core/ask/attachment-kind.mjs: that is the chat-attachment policy (no SVG,
// no media, no diff) and the two must be able to diverge.
//
// CROSS-PLATFORM CONTRACT
//   · Every path SHAPE rule is enforced on every platform: a run authored on
//     Linux is read back on Windows, and the snapshot dir must be portable.
//     `test/ask-files.test.mjs` therefore covers CON / COM1 / `C:x` / UNC /
//     `<>:"|?*` / trailing dot / trailing space from a macOS or Linux host.
//   · Only the case-FOLD of the containment comparison is platform-conditional,
//     through the injectable `platform` option (win32 + darwin fold, linux does
//     not). Both arms are exercised on one host.
//   · Paths are built with path.join / path.resolve only — never a string '/'.
//     `stored` is `<index><ext>`, which is a legal basename on every platform.
//   · Snapshot dirs are removed with the pipeline dir; nothing here unlinks.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import process from 'node:process';

import { ASK_LIMITS } from '../shared/forms/catalog.mjs';

/** §7's trust table: sniffed mime -> { ext, trust }. `trust` is what the P3
 *  renderer switches on; the ext is the on-disk suffix of the snapshot. */
export const ASK_FILE_MIMES = Object.freeze({
  'image/png':       { ext: '.png',  trust: 'inline' },
  'image/jpeg':      { ext: '.jpg',  trust: 'inline' },
  'image/gif':       { ext: '.gif',  trust: 'inline' },
  'image/webp':      { ext: '.webp', trust: 'inline' },
  'image/avif':      { ext: '.avif', trust: 'inline' },
  'image/svg+xml':   { ext: '.svg',  trust: 'inert'  },
  'text/plain':      { ext: '.txt',  trust: 'text'   },
  'application/json':{ ext: '.json', trust: 'text'   },
  'text/x-diff':     { ext: '.diff', trust: 'text'   },
  'application/pdf': { ext: '.pdf',  trust: 'viewer' },
  'video/mp4':       { ext: '.mp4',  trust: 'media'  },
  'video/webm':      { ext: '.webm', trust: 'media'  },
  'audio/mpeg':      { ext: '.mp3',  trust: 'media'  },
  'audio/wav':       { ext: '.wav',  trust: 'media'  },
  'audio/ogg':       { ext: '.ogg',  trust: 'media'  },
});

/** The basename a snapshot may have — the ONLY string the file route ever joins
 *  onto a directory. `<index><ext>`, nothing else, ever. */
const STORED_RE = /^\d{1,2}\.[a-z0-9]{1,5}$/;

/** ISO 32000-1 note 13: `%PDF-` may sit behind up to 1024 bytes of preamble. */
const PDF_HEADER_WINDOW = 1024;
/** Magic-byte window; also the head we decode for the text probes' cheap path. */
const SNIFF_HEAD = 4096;
/** A body with no binary magic bigger than this is refused by SIZE (`too-big`,
 *  naming this cap) rather than read whole into memory to be proved text. */
const TEXT_SNIFF_MAX = 1024 * 1024;
/** sniffFile's answer for such a body: the caller turns it into a size refusal
 *  that names the cap, so the agent learns to pick a smaller file — not "not a
 *  file type worca can display", which sent it back with the same file. */
const TEXT_TOO_BIG = Symbol('text-too-big');

/** MS-DOS device names: reserved in EVERY directory on Windows, with or without
 *  an extension, case-insensitively. */
const WIN_DEVICE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** Characters Windows forbids in a path component (`:` included — it is also how
 *  a drive-relative path smuggles itself in). */
const WIN_RESERVED_CHARS_RE = /[<>:"|?*]/;
/** ISO-BMFF major brands that are MP4-family video. Everything else sharing the
 *  `ftyp` container (HEIC, QuickTime, M4A, 3GP) is refused as unrecognized. */
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'mp71', 'avc1', 'dash', 'M4V ']);

/**
 * Why this run-relative path is refused, or null when its SHAPE is acceptable.
 * Pure, and platform-independent on purpose (E10): the snapshot must be
 * reproducible on every host that later reads the run.
 * @param {unknown} rel
 * @returns {string|null}
 */
export function refusePathShape(rel) {
  if (typeof rel !== 'string' || !rel.trim()) return 'a file value must be a non-empty path';
  // Windows forbids every C0 control and DEL in a name, and a newline in `rel` would
  // split the one-line audit entry the refusal lands on — so the reason is JSON-quoted.
  for (let i = 0; i < rel.length; i++) {
    const k = rel.charCodeAt(i);
    if (k < 32 || k === 127) return `${JSON.stringify(rel)} contains a control character`;
  }
  if (rel.length > 1024) return 'a file path may not exceed 1024 characters';
  if (rel.startsWith('/') || rel.startsWith('\\')) return `"${rel}" is absolute; file values are run-relative`;
  if (/^[A-Za-z]:/.test(rel)) return `"${rel}" names a drive; file values are run-relative`;
  const parts = rel.split(/[\\/]+/);
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') return `"${rel}" escapes the run with ".."`;
    if (WIN_DEVICE_RE.test(part)) return `"${rel}" uses the reserved Windows device name "${part}"`;
    if (WIN_RESERVED_CHARS_RE.test(part)) return `"${rel}" uses a character Windows forbids in a path`;
    if (part.endsWith('.') || part.endsWith(' ')) return `"${rel}" has a segment ending in a dot or a space`;
  }
  return null;
}

/** Does the sniffed mime satisfy the field's `accept` patterns? An empty/absent
 *  accept means "anything on the allowlist". `text/plain` stands in for any
 *  `text/*` pattern, because markdown and csv are not separately sniffable (E9). */
export function mimeMatchesAccept(mime, accept) {
  const list = Array.isArray(accept) ? accept.filter((a) => typeof a === 'string' && a.trim()) : [];
  if (!list.length) return true;
  const [type] = String(mime).split('/');
  return list.some((raw) => {
    const pattern = raw.trim().toLowerCase();
    if (pattern === '*/*' || pattern === '*') return true;
    if (pattern.endsWith('/*')) return type === pattern.slice(0, -2);
    if (pattern === mime) return true;
    return mime === 'text/plain' && pattern.startsWith('text/');
  });
}

/**
 * The real mime of a body, from its leading bytes, or null when it is not a type
 * worca will display. The extension and whatever the agent claimed are ignored.
 * @param {Buffer} buf
 * @returns {string|null}
 */
export function sniffMime(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return null;
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  // SOI (FF D8) plus the first marker: a bare FF D8 FF stub is not a JPEG.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff && buf[3] >= 0xc0) return 'image/jpeg';
  if (buf.length >= 6) {
    const head6 = buf.toString('latin1', 0, 6);
    if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
  }
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  // ISO-BMFF: `....ftyp<brand>`. avif/mp4 share the container; the brand decides.
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    // Only the MP4 family is video/mp4. HEIC/HEIF (heic, mif1 …), QuickTime (qt  ) and
    // M4A share the container and are not types worca displays: refused, not mislabelled.
    return MP4_BRANDS.has(brand) ? 'video/mp4' : null;
  }
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm'; // EBML
  if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'OggS') return 'audio/ogg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') return 'audio/wav';
  // MPEG audio: an ID3v2 tag, or a Layer III frame sync — the 11 sync bits, layer bits `01`,
  // a legal bitrate index (not 1111) and sampling-rate index (not 11). The bare 11-bit sync
  // alone matched a UTF-16LE BOM (FF FE) and any FF-FF run; Layer I/II are not types worca
  // plays, so they fall through and are refused as unrecognized.
  if (buf.length >= 3 && (buf.toString('latin1', 0, 3) === 'ID3'
    || (buf[0] === 0xff && (buf[1] & 0xe6) === 0xe2 && (buf[2] & 0xf0) !== 0xf0 && (buf[2] & 0x0c) !== 0x0c))) return 'audio/mpeg';
  if (buf.length >= 5) {
    const at = buf.toString('latin1', 0, Math.min(buf.length, PDF_HEADER_WINDOW + 5)).indexOf('%PDF-');
    if (at !== -1 && at <= PDF_HEADER_WINDOW) return 'application/pdf';
  }
  return sniffText(buf);
}

/** The body after the prelude an XML file may carry: an `<?xml … ?>` prolog, comments, one
 *  DOCTYPE (with or without an internal subset). A DOCTYPE names the document type outright,
 *  so only `svg` may pass it. Null when the prelude is unterminated or names another type. */
function afterXmlPrelude(head) {
  let s = head;
  if (s.startsWith('<?xml')) {
    const end = s.indexOf('?>');
    if (end === -1) return null;
    s = s.slice(end + 2);
  }
  for (;;) {
    s = s.trimStart();
    if (s.startsWith('<!--')) {
      const end = s.indexOf('-->', 4);
      if (end === -1) return null;
      s = s.slice(end + 3);
      continue;
    }
    const doctype = /^<!doctype\s+([^\s>\[]+)[^>\[]*(?:\[[\s\S]*?\]\s*)?>/i.exec(s);
    if (doctype) {
      if (doctype[1].toLowerCase() !== 'svg') return null;
      s = s.slice(doctype[0].length);
      continue;
    }
    return s;
  }
}

/** A body that opens with '<': its ROOT element decides. Only a root `svg` (prefixed or not)
 *  is an inert image; any other root element is markup and refused, whatever prolog it wears
 *  (an XHTML document that merely CONTAINS an svg is markup). A prelude followed by PROSE —
 *  a markdown file that opens with an HTML comment — is text, exactly like a body that never
 *  started with '<'; a prelude followed by nothing, or by a non-element such as `<?php`, is
 *  unrecognized. */
function sniffMarkup(head) {
  const rest = afterXmlPrelude(head);
  if (!rest) return null;
  const root = /^<(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)/.exec(rest);
  if (root) return root[1].toLowerCase() === 'svg' ? 'image/svg+xml' : null;
  return rest.startsWith('<') ? null : 'text/plain';
}

/** E9: text has no magic number, so it is probed by CONTENT. A body that is not
 *  clean UTF-8, or whose first non-space byte is '<' without being xml/svg, is
 *  refused — that is §7's "html, xhtml, anything scriptable or unrecognized". */
function sniffText(buf) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return null;
  }
  // A C0 control other than tab / LF / CR is not text (and no regex here: a `\\u` escape
  // in source is a trap for the tools that copy this file).
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    if (k < 32 && k !== 9 && k !== 10 && k !== 13) return null;
  }
  const head = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trimStart();   // strip a BOM
  if (!head) return null;                             // an empty or blank body is nothing worca can display
  // Markup is decided by its ROOT element, read through the prelude an SVG file may open
  // with (a prolog, comments, an svg DOCTYPE) — see sniffMarkup.
  if (head.startsWith('<')) return sniffMarkup(head);
  if (head.startsWith('{') || head.startsWith('[')) {
    try { JSON.parse(text); return 'application/json'; } catch { /* not json after all */ }
  }
  if (/^diff --git /m.test(head) || (/^--- /m.test(head) && /^\+\+\+ /m.test(head))) return 'text/x-diff';
  return 'text/plain';
}

/** Sniff a file on disk: the magic window first, and only a small body is read
 *  whole for the text probes; a larger body with no binary magic is TEXT_TOO_BIG. */
async function sniffFile(abs, size) {
  const fh = await open(abs, 'r');
  try {
    const head = Buffer.alloc(Math.min(SNIFF_HEAD, Math.max(size, 1)));
    const { bytesRead } = await fh.read(head, 0, head.length, 0);
    const binary = sniffBinaryOnly(head.subarray(0, bytesRead));
    if (binary) return binary;
  } finally {
    await fh.close();
  }
  if (size > TEXT_SNIFF_MAX) return TEXT_TOO_BIG;
  return sniffText(await readFile(abs));
}

/** sniffMime minus the text fallback — used when the head alone is in hand. */
function sniffBinaryOnly(head) {
  const mime = sniffMime(head);
  return mime && ASK_FILE_MIMES[mime].trust !== 'text' && mime !== 'image/svg+xml' ? mime : null;
}

/** Is `candidate` (already realpath'd) inside `root` (already realpath'd)? Exported so the
 *  case-fold arm is testable directly: macOS realpath() preserves whatever case it was
 *  handed, so no on-disk fixture can prove the fold on one host. */
export function isInside(root, candidate, { fold = false } = {}) {
  const a = fold ? root.toLowerCase() : root;
  const b = fold ? candidate.toLowerCase() : candidate;
  const prefix = a.endsWith(sep) ? a : a + sep;
  return b === a || b.startsWith(prefix);
}

/** sha256 of a file, streamed (a 25 MB body must never be buffered to be hashed). */
function hashFile(abs) {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    const s = createReadStream(abs);
    s.on('error', rej);
    s.on('data', (c) => h.update(c));
    s.on('end', () => res(h.digest('hex')));
  });
}

/**
 * Snapshot every file an ask references (spec §7). Resolves each ref against the
 * roots IN ORDER (the node working tree, then the pipeline dir), refuses
 * anything that fails the shape / containment / kind / cap rules, and copies the
 * survivors to `<destDir>/<index><ext>` beside a `manifest.json` that is the ONE
 * source both file routes read.
 *
 * ANY error means the whole ask is refused by gate 2, so the caller must check
 * `errors` before using `files`.
 *
 * @param {{refs: Array<{path:string, rel:string, accept?:string[]}>, roots: string[],
 *          destDir: string, platform?: string}} args
 * @returns {Promise<{files: Array<{index:number, rel:string, name:string, mime:string,
 *          bytes:number, sha256:string, stored:string}>, errors: Array<{path:string, code:string, message:string}>}>}
 */
export async function snapshotAskFiles({ refs, roots, destDir, platform = process.platform }) {
  const files = [];
  const errors = [];
  const list = Array.isArray(refs) ? refs : [];
  if (list.length > ASK_LIMITS.filesPerAsk) {
    errors.push({ path: 'data', code: 'too-many',
      message: `an ask may reference at most ${ASK_LIMITS.filesPerAsk} files (got ${list.length})` });
    return { files, errors };
  }
  const realRoots = [];
  for (const r of roots || []) {
    if (!r) continue;
    try { realRoots.push(await realpath(r)); } catch { /* a root that does not exist contains nothing */ }
  }
  // macOS and Windows are case-insensitive by default; Linux is not. Injected so
  // both arms are testable from one host.
  const fold = platform === 'win32' || platform === 'darwin';
  let total = 0;
  for (let index = 0; index < list.length; index++) {
    const ref = list[index] || {};
    const at = typeof ref.path === 'string' && ref.path ? ref.path : 'data';
    const rel = typeof ref.rel === 'string' ? ref.rel : '';
    const fail = (code, message) => errors.push({ path: at, code, message });

    const shape = refusePathShape(rel);
    if (shape) { fail('file-path', shape); continue; }
    // Either separator is accepted by the shape rule, so the segments are joined
    // NATIVELY here: a `mockups\a.png` an agent wrote on Windows resolves on every host.
    const segments = rel.split(/[\\/]+/).filter(Boolean);

    let abs = null;
    for (const root of realRoots) {
      let candidate;
      try { candidate = await realpath(resolve(root, ...segments)); } catch { continue; }
      if (!isInside(root, candidate, { fold })) continue;     // a symlink out of the tree refuses itself
      abs = candidate;
      break;
    }
    if (!abs) { fail('file-path', `"${rel}" is not inside the node working tree or the pipeline dir`); continue; }

    const st = await lstat(abs).catch(() => null);
    if (!st || !st.isFile()) { fail('file-path', `"${rel}" is not a regular file`); continue; }
    if (st.size > ASK_LIMITS.fileBytes) {
      fail('too-big', `"${rel}" is ${st.size} bytes; the limit is ${ASK_LIMITS.fileBytes}`);
      continue;
    }
    if (total + st.size > ASK_LIMITS.askBytes) {
      fail('too-big', `one ask may carry at most ${ASK_LIMITS.askBytes} bytes of files`);
      continue;
    }

    const mime = await sniffFile(abs, st.size);
    if (mime === TEXT_TOO_BIG) {
      fail('too-big', `"${rel}" is ${st.size} bytes with no recognized file signature; a text preview may not exceed ${TEXT_SNIFF_MAX} bytes`);
      continue;
    }
    if (!mime || !ASK_FILE_MIMES[mime]) {
      fail('type', `"${rel}" is not a file type worca can display`);
      continue;
    }
    if (!mimeMatchesAccept(mime, ref.accept)) {
      fail('type', `"${rel}" is ${mime}; this field accepts ${(ref.accept || []).join(', ')}`);
      continue;
    }

    const stored = `${index}${ASK_FILE_MIMES[mime].ext}`;
    await mkdir(destDir, { recursive: true });
    const target = join(destDir, stored);
    await copyFile(abs, target);
    files.push({
      index, rel, name: segments[segments.length - 1] || rel, mime,
      bytes: st.size, sha256: await hashFile(target), stored,
    });
    total += st.size;
  }
  if (files.length && !errors.length) {
    await writeFile(join(destDir, 'manifest.json'), `${JSON.stringify({ version: 1, files }, null, 2)}\n`, 'utf8');
  }
  return { files, errors };
}

/**
 * The file routes' reader: ONE manifest entry by its index. The returned
 * `stored` is re-validated against STORED_RE, so even a hand-edited manifest can
 * never name a path — it is the only string the route joins onto `dir`.
 * @param {string} dir  `<pipelineDir>/ask-files/<askId>`
 * @param {number} index
 * @returns {Promise<{index:number, stored:string, mime:string, name:string, bytes:number, sha256:string}|null>}
 */
export async function readAskFileEntry(dir, index) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
  const hit = (Array.isArray(manifest?.files) ? manifest.files : []).find((f) => f && f.index === index);
  if (!hit || typeof hit.stored !== 'string' || !STORED_RE.test(hit.stored)) return null;
  if (!hit.mime || !ASK_FILE_MIMES[hit.mime]) return null;
  return {
    index, stored: hit.stored, mime: hit.mime,
    name: typeof hit.name === 'string' ? hit.name : hit.stored,
    bytes: Number(hit.bytes) || 0, sha256: typeof hit.sha256 === 'string' ? hit.sha256 : '',
  };
}
