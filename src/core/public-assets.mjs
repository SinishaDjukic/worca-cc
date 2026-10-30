// The shared reader behind the browser shell's split sources (#919). Before the split it returns the monolith
// file; after it, the parts listed in the public dir's parts.json, concatenated in order — the same bytes either way.
// No build step: the server reads per request, cached on each part's mtime and size.
// It names no repo path on purpose: read-style-css.mjs, read-index-html.mjs and read-server-source.mjs each name their one file,
// so tools/test-related.mjs links a test only to the file it reads.
import fs from 'node:fs';
import path from 'node:path';
import { isWithin } from './fs-scope.mjs';

const MANIFEST = 'parts.json';
const KIND_EXT = { css: '.css', html: '.html' };
const DIR_RE = /^[a-z][a-z0-9-]*$/;

function validEntry(rel, ext) {
  if (typeof rel !== 'string' || rel === '' || rel.startsWith('/') || /[\\:\0]/.test(rel)) return false;
  return rel.split('/').every((s) => s !== '' && s !== '.' && s !== '..') && path.posix.extname(rel) === ext;
}
const realOf = (abs) => fs.realpathSync.native(abs);

const manifests = new Map();   // publicDir → { key, value }
/** The parts manifest, or null on a tree that is not split. Every entry is validated and must exist. */
export function readPartsManifest(publicDir) {
  const root = path.resolve(publicDir);
  const file = path.join(root, MANIFEST);
  let st;
  try { st = fs.statSync(file); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = manifests.get(root);
  if (hit && hit.key === key) return hit.value;
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const kind of ['css', 'html']) {
    if (!Array.isArray(m[kind])) throw new Error(`parts.json: ${kind} must be a list`);
    for (const rel of m[kind]) {
      if (!validEntry(rel, KIND_EXT[kind]) || !isWithin(path.resolve(root, rel), root)) throw new Error(`parts.json: bad ${kind} entry ${JSON.stringify(rel)}`);
    }
  }
  const dirs = m.dirs ?? [];
  if (!Array.isArray(dirs)) throw new Error('parts.json: dirs must be a list');
  for (const d of dirs) if (!DIR_RE.test(d)) throw new Error(`parts.json: bad dir ${JSON.stringify(d)}`);
  const realRoot = realOf(root);
  const real = new Set([realOf(file)]);
  for (const [kind, list] of [['css', m.css], ['html', m.html], ['dir', dirs]]) {
    for (const rel of list) {
      let r;
      try { r = realOf(path.join(root, rel)); } catch { throw new Error(`missing part: ui/public/${rel}`); }
      if (!isWithin(r, realRoot)) throw new Error(`parts.json: ${kind} entry ${JSON.stringify(rel)} resolves outside ui/public`);
      real.add(r);
    }
  }
  const value = Object.freeze({ version: m.version, css: m.css, html: m.html, dirs, real });
  manifests.set(root, { key, value });
  return value;
}

const texts = new Map();       // `${publicDir}\0${kind}` → { key, text, mtimeMs }
/** { text, mtimeMs } of one shell source: `monolith` on a tree that is not split, else the manifest's `kind` parts. */
export function assemble(kind, monolith, publicDir) {
  const m = readPartsManifest(publicDir);
  const files = m ? m[kind].map((rel) => path.join(publicDir, rel)) : [path.join(publicDir, monolith)];
  // The manifest is cached on its own stat; a part swapped for a symlink out of the public dir since must not be read.
  if (m) for (const f of files) if (!m.real.has(realOf(f))) throw new Error(`parts.json: part ${JSON.stringify(path.relative(publicDir, f))} resolves outside its manifest`);
  const stats = files.map((f) => fs.statSync(f));
  const key = stats.map((s) => `${s.mtimeMs}:${s.size}`).join('|');
  const ck = `${path.resolve(publicDir)}\0${kind}`;
  const hit = texts.get(ck);
  if (hit && hit.key === key) return hit;
  const entry = { key, text: files.map((f) => fs.readFileSync(f, 'utf8')).join(''), mtimeMs: Math.max(...stats.map((s) => s.mtimeMs)) };
  texts.set(ck, entry);
  return entry;
}

const UP_PATH = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
/**
 * The public-dir-relative path express.static (send) would open for `reqPath`, or null where static itself
 * answers without a file: a bad escape (400), a NUL (400) or a path that climbs above the root (403). `//` and
 * dot segments are resolved; a trailing slash is kept, because static treats `/style.css/` as a directory and
 * misses. Shared by serveStyleCss and isPublicPart, so both see a request the same way static did.
 */
export function publicRelPath(reqPath) {
  let decoded;
  try { decoded = decodeURIComponent(reqPath); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const rel = path.posix.normalize('./' + decoded);
  if (UP_PATH.test(rel)) return null;
  return rel.replace(/^\/+/, '').replace(/^\.\/?$/, '');
}

/**
 * True when express.static would answer `reqPath` from a part file, the manifest or a folder the split created:
 * the static mount must pass those to the SPA fallback, as before the split. Resolves the path with
 * publicRelPath (then the .html variant when there is no extension) and compares real paths, so `//`, encoded
 * spellings, case variants on a case-insensitive file system and symlinks cannot slip past.
 */
export function isPublicPart(reqPath, publicDir) {
  const m = readPartsManifest(publicDir);
  if (!m) return false;
  const resolved = publicRelPath(reqPath);
  if (resolved === null) return false;
  const rel = resolved.replace(/\/+$/, '');
  if (!rel) return false;
  const abs = path.join(path.resolve(publicDir), rel);
  const candidates = path.posix.extname(rel) ? [abs] : [abs, abs + '.html'];
  for (const c of candidates) {
    let real;
    try { real = realOf(c); } catch { continue; }
    return m.real.has(real);                        // the first existing candidate is what static would serve
  }
  return false;
}
