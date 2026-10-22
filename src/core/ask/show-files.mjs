// src/core/ask/show-files.mjs — show_files (docs/show-files.md): resolve each source the model names, refuse anything
// outside this chat's folders or that looks like a credential, read it, sniff the kind from the bytes it read, cap it,
// redact text, and snapshot it into the thread's attachment store. The browser only ever asks for (thread, attachment
// id): no path reaches HTTP.
//
// The gates are ask-files.mjs's: shape, then realpath containment, then magic bytes (the extension only refines a
// TEXT body into markdown / csv / html). The trust table is this file's own, SHOW_FILE_KINDS, and differs on purpose
// from both neighbours: unlike the run-form table it keeps HTML as source text, and unlike the chat-upload table it
// shows SVG (drawn through <img> only) and media.
import { realpath, stat, readFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { refusePathShape, isInside, sniffMime, decodePlainText } from '../ask-files.mjs';
import { isProtectedBasename } from './tools.mjs';
import { GUARDRAIL_PRESETS } from '../guardrails.mjs';

const MiB = 1024 * 1024;
const HEAD_BYTES = 4096;
const TEXT_MIMES = Object.freeze(['text/plain', 'application/json', 'text/x-diff']);
/** Mimes sniffMime derives from a text probe: decided on the WHOLE body, never on a head cut mid-character. */
const TEXT_SNIFFED = new Set([...TEXT_MIMES, 'image/svg+xml']);

/**
 * sniffed mime (+ extension, for text) → kind → caps → how it is stored. First match wins, so the extension-keyed
 * text kinds come before json/diff: a markdown file opening with `---` front matter is markdown, not a diff.
 * `kind` is also the client renderer key (ui/public/chat/files-card.mjs). Adding a type = one entry here + one
 * registerFileRenderer there.
 */
export const SHOW_FILE_KINDS = Object.freeze([
  { kind: 'image', mimes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'], store: 'image', maxBytes: 25 * MiB },
  { kind: 'svg', mimes: ['image/svg+xml'], store: 'image', maxBytes: MiB },
  { kind: 'pdf', mimes: ['application/pdf'], store: 'binary', maxBytes: 50 * MiB },
  { kind: 'video', mimes: ['video/mp4', 'video/webm'], store: 'binary', maxBytes: 100 * MiB },
  { kind: 'audio', mimes: ['audio/mpeg', 'audio/wav', 'audio/ogg'], store: 'binary', maxBytes: 50 * MiB },
  { kind: 'markdown', mimes: TEXT_MIMES, exts: ['.md', '.markdown'], store: 'text', label: 'text/markdown', maxBytes: MiB },
  { kind: 'csv', mimes: TEXT_MIMES, exts: ['.csv', '.tsv'], store: 'text', label: 'text/csv', maxBytes: MiB },
  { kind: 'html', mimes: TEXT_MIMES, exts: ['.html', '.htm'], store: 'text', label: 'text/html', maxBytes: MiB },
  { kind: 'json', mimes: ['application/json'], store: 'text', label: 'application/json', maxBytes: MiB },
  { kind: 'diff', mimes: ['text/x-diff'], store: 'text', label: 'text/x-diff', maxBytes: MiB },
  { kind: 'text', mimes: TEXT_MIMES, store: 'text', label: 'text/plain', maxBytes: MiB },
].map((k) => Object.freeze(k)));
const MAX_KIND_BYTES = Math.max(...SHOW_FILE_KINDS.map((k) => k.maxBytes));

const extOf = (name) => { const b = String(name || ''); const d = b.lastIndexOf('.'); return d <= 0 ? '' : b.slice(d).toLowerCase(); };
const mib = (n) => `${Math.round(n / MiB)} MiB`;

/** The table entry for a sniffed mime and the file's name, or null (not a type a card shows). */
export function showFileKindFor(mime, name) {
  if (!mime) return null;
  const ext = extOf(name);
  return SHOW_FILE_KINDS.find((k) => k.mimes.includes(mime) && (!k.exts || k.exts.includes(ext))) || null;
}

/**
 * Sniff the bytes that were read, look the kind up and apply its cap. Magic bytes are judged on the head; text (and
 * SVG, which is text) on the WHOLE body, so it is capped before it is decoded. sniffMime refuses markup whose root is
 * not <svg> (an HTML page): here such a body is still TEXT, shown as source. → { mime, entry } | { error }.
 */
export function kindOf(buf, name, limits) {
  let mime = sniffMime(buf.subarray(0, HEAD_BYTES));
  if (!mime || TEXT_SNIFFED.has(mime)) {
    if (buf.length > limits.textBytes) {
      return { error: mime ? `${mime === 'image/svg+xml' ? 'SVG' : 'text'} files over ${mib(limits.textBytes)} are not shown` : `this file type cannot be shown (or it is text over ${mib(limits.textBytes)})` };
    }
    mime = sniffMime(buf) ?? (decodePlainText(buf) != null ? 'text/plain' : null);
  }
  const entry = showFileKindFor(mime, name);
  if (!entry) return { error: 'this file type cannot be shown' };
  if (buf.length > entry.maxBytes) return { error: `${entry.kind} files over ${mib(entry.maxBytes)} are not shown` };
  return { mime, entry };
}

// ── credentials ───────────────────────────────────────────────────────────────
/** Basename / path patterns (isProtectedBasename semantics: slash-less = basename at any depth). The secure guardrail
 *  preset is the floor (its `~/` and `//` entries are skipped by the matcher; CREDENTIAL_DIRS covers those homes). */
const CREDENTIAL_NAMES = Object.freeze([
  ...GUARDRAIL_PRESETS.secure.protectedPaths,
  'id_rsa*', 'id_ed25519*', 'id_ecdsa*', 'id_dsa*', '.git-credentials', '.pgpass', '.pypirc',
  'secrets.json', 'credentials', 'credentials.json', '*.kdbx', 'worca-cc.db*', 'worca.db*',
]);
/** A folder that holds credentials (or worca's own state) anywhere BELOW the root the file was found in. */
const CREDENTIAL_DIRS = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.azure', '.git', '.worca-cc']);
const CREDENTIAL_DIR_PAIRS = Object.freeze([['.config', 'gh'], ['.config', 'gcloud']]);

/** Why this root-relative POSIX path looks like a credential, or null. Case-insensitive (darwin and win32 fold). */
export function credentialReason(relPosix) {
  const rel = String(relPosix || '').toLowerCase();
  if (isProtectedBasename(rel, CREDENTIAL_NAMES)) return 'looks like a credential file';
  const segs = rel.split('/').filter(Boolean);
  for (let i = 0; i < segs.length - 1; i++) {
    if (CREDENTIAL_DIRS.has(segs[i])) return `is inside ${segs[i]}/`;
    const pair = CREDENTIAL_DIR_PAIRS.find(([a, b]) => segs[i] === a && segs[i + 1] === b);
    if (pair) return `is inside ${pair[0]}/${pair[1]}/`;
  }
  return null;
}

// ── path shape ────────────────────────────────────────────────────────────────
const OUT_RE = /^\$(?:WORCA_ASK_OUT|\{WORCA_ASK_OUT\})(?=[\\/]|$)[\\/]*/;
const hasControl = (s) => { for (let i = 0; i < s.length; i++) { const k = s.charCodeAt(i); if (k < 32 || k === 127) return true; } return false; };

/**
 * One `files[].path` → { rel, outOnly? } | { abs } | { error }. `$WORCA_ASK_OUT/<rel>` (what the prompt tells Ask to
 * write) names the out folder only. A relative path is ask-files' shape (no `..`, no device names, no drive). An
 * absolute path is allowed — it must still land inside an allowed root after realpath — but never UNC / `//host`,
 * never with a `..` segment, and only in the platform's own absolute form. One pair of wrapping quotes (the shell
 * spelling the prompt teaches: "$WORCA_ASK_OUT/a.png") is dropped first.
 */
export function parseShownPath(input, platform = process.platform) {
  if (typeof input !== 'string' || !input) return { error: 'path is empty' };
  const raw = input.replace(/^(['"])(.+)\1$/, '$2');
  if (raw.length > 1024) return { error: 'path is longer than 1024 characters' };
  if (hasControl(raw)) return { error: 'path holds a control character' };
  const out = OUT_RE.exec(raw);
  if (out) {
    const rel = raw.slice(out[0].length);
    const bad = refusePathShape(rel);
    return bad ? { error: bad } : { rel, outOnly: true };
  }
  if (/^[\\/]{2}/.test(raw)) return { error: 'network (UNC) paths are never shown' };
  const absolute = platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(raw) : raw.startsWith('/');
  if (!absolute) {
    const bad = refusePathShape(raw);
    return bad ? { error: bad } : { rel: raw };
  }
  if (raw.split(/[\\/]+/).includes('..')) return { error: 'path holds a ".." segment' };
  return { abs: raw };
}

// ── image size (optional width/height on a card item: the tile reserves its aspect before the bytes load) ──────────
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
/** { width, height } for png / gif / jpeg / webp, else null. Never throws. */
export function imageSize(buf, mime) {
  try {
    if (mime === 'image/png' && buf.length >= 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/gif' && buf.length >= 10) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (mime === 'image/webp' && buf.length >= 30) {
      const chunk = buf.toString('latin1', 12, 16);
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
        return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
      }
      return null;
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) return null;
        const m = buf[i + 1];
        if (m === 0xff) { i += 1; continue; }                                  // fill byte
        if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) { i += 2; continue; }       // markers with no length
        if (JPEG_SOF.has(m)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* a truncated header: no size */ }
  return null;
}

// ── the tool body ─────────────────────────────────────────────────────────────
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const toPosix = (p) => p.split(sep).join('/');

/** A card item from a stored attachment row. Name, mime and bytes come from the row; only kind and size from the sniff
 *  (and the mime, for an older upload row that stored none). */
function itemOf(att, entry, buf, mime) {
  const size = entry.kind === 'image' ? imageSize(buf, mime) : null;
  return { attId: att.id, name: att.name, kind: entry.kind, mime: att.mime || entry.label || mime, bytes: att.bytes, ...(size || {}),
    ...(att.hasSource ? { source: true } : {}) };   // Show in folder: the path stays on the server (attachmentSourcePath)
}

/** The realpath of a folder, or null when it is not there. */
async function realDir(d) {
  try { return d ? await realpath(d) : null; } catch { return null; }
}

async function realRoots(dirs) {
  const out = [];
  for (const d of dirs) {
    if (!d) continue;
    try { const r = await realpath(d); if (!out.includes(r)) out.push(r); } catch { /* a root that is not there yet */ }
  }
  return out;
}

/** The deepest root of `roots` that holds `real`, or undefined. The credential check runs on the path below it, so a
 *  project registered at the home folder never turns this chat's own out folder into ".worca-cc/…". */
const deepestRoot = (roots, real, fold) => roots.filter((r) => isInside(r, real, { fold })).sort((a, b) => b.length - a.length)[0];

/** The first candidate whose realpath lands inside one of `roots` → { real, root } | null. */
async function locate(parsed, roots, fold) {
  const tries = parsed.abs ? [parsed.abs] : roots.map((r) => join(r, ...parsed.rel.split(/[\\/]+/).filter(Boolean)));
  for (const cand of tries) {
    let real;
    try { real = await realpath(cand); } catch { continue; }
    const root = deepestRoot(roots, real, fold);
    if (root) return { real, root };
  }
  return null;
}

/**
 * @param {{ files?:Array<{path:string, runId?:string, projectKey?:string}>, runArtifacts?:Array<{runId:string, relPath:string}>,
 *           attachmentIds?:string[], caption?:string, rowFor:(runId:string)=>Promise<object> }} req
 *   rowFor is tools.mjs's resolveRow (pinned scope first, then everywhere; throws "show_files: run not found").
 * @param {object} deps  see show-files-deps.mjs
 * @returns {Promise<{ok:true, caption:string, items:object[], refused:object[]} | {ok:false, errors:string[], refused:object[]}>}
 */
export async function showFiles(req, deps) {
  const L = deps.limits;
  const fold = deps.platform === 'win32' || deps.platform === 'darwin';
  const items = [];
  const refused = [];
  const seen = new Set();
  let cardBytes = 0;
  let threadBytes = deps.listAttachments().reduce((n, a) => n + (Number(a.bytes) || 0), 0);
  const refuse = (source, reason) => { refused.push({ source: clip(source, 200), reason }); };
  const outDir = deps.outDir();
  const threadRoots = await realRoots([outDir, deps.worktreesDir(), await deps.pinnedProjectDir()]);
  const overBudget = (n) => (cardBytes + n > L.cardBytes ? `the card would pass ${mib(L.cardBytes)}`
    : threadBytes + n > L.threadBytes ? `this chat's files would pass ${mib(L.threadBytes)}` : null);

  async function admit(source, real, root, origin = null) {
    if (seen.has(real)) return;
    seen.add(real);
    const name = basename(real);
    const cred = credentialReason(toPosix(relative(root, real)));
    if (cred) return refuse(source, `${name} ${cred}; credential files are never shown`);
    let buf;
    try {
      const st = await stat(real);
      if (!st.isFile()) return refuse(source, 'not a regular file');
      if (st.size === 0) return refuse(source, 'the file is empty');
      if (st.size > MAX_KIND_BYTES) return refuse(source, 'too large to show');
      const pre = overBudget(st.size);                        // before reading: a huge file is never loaded
      if (pre) return refuse(source, pre);
      buf = await readFile(real);                             // what is checked below is what gets stored
    } catch {
      return refuse(source, 'the file could not be read');
    }
    if (!buf.length) return refuse(source, 'the file is empty');
    const k = kindOf(buf, name, L);
    if (k.error) return refuse(source, k.error);
    const over = overBudget(buf.length);                      // again on the bytes read: the file may have grown
    if (over) return refuse(source, over);
    // Found under a run's or project's folder: remember which, and the path below it, for Show in folder's fallback.
    const sourceOrigin = origin ? { ...origin, rel: toPosix(relative(root, real)) } : null;
    let att;
    if (k.entry.store === 'text') {
      const text = decodePlainText(buf);
      if (text == null) return refuse(source, 'this file type cannot be shown');
      att = deps.addAttachment({ name, kind: 'text', mime: k.entry.label, text: deps.redact(text), sourcePath: real, sourceOrigin });
    } else {
      att = deps.addAttachment({ name, kind: k.entry.store, mime: k.mime, data: buf, sourcePath: real, sourceOrigin });
    }
    cardBytes += att.bytes;
    threadBytes += att.bytes;
    items.push(itemOf(att, k.entry, buf, k.mime));
  }

  for (const f of req.files || []) {
    const source = typeof f?.path === 'string' ? f.path : '';
    const parsed = parseShownPath(f?.path, deps.platform);
    if (parsed.error) { refuse(source, parsed.error); continue; }
    let scope = [];                                                          // [{ dir, origin }]
    try {
      if (f.runId) {
        const row = await req.rowFor(String(f.runId));
        // A member's checkout maps onto its project; the run's store folder has no project copy.
        scope = (await deps.runDirsOf(row)).map((d) => ({ dir: d.dir, origin: d.projectKey ? { runId: row.id, projectKey: d.projectKey } : null }));
      } else if (f.projectKey) {
        const dir = await deps.projectDir(String(f.projectKey));
        if (!dir) throw new Error('project not found');
        scope = [{ dir, origin: { runId: null, projectKey: String(f.projectKey) } }];
      }
    } catch (e) { refuse(source, String(e?.message || e).replace(/^show_files: /, '')); continue; }
    const scoped = [];                                                        // [{ root, origin }], realpath'd
    for (const s of scope) { const root = await realDir(s.dir); if (root && !scoped.some((x) => x.root === root)) scoped.push({ root, origin: s.origin }); }
    const roots = parsed.outOnly ? await realRoots([outDir]) : [...scoped.map((s) => s.root), ...threadRoots];
    const hit = await locate(parsed, roots, fold);
    if (!hit) { refuse(source, "not found inside this chat's output folder, its worktrees, the run or the project"); continue; }
    await admit(source, hit.real, hit.root, scoped.find((s) => s.root === hit.root)?.origin ?? null);
  }

  for (const a of req.runArtifacts || []) {
    const source = `${a?.runId}:${a?.relPath}`;
    let row;
    try { row = await req.rowFor(String(a?.runId || '')); } catch (e) { refuse(source, String(e?.message || e).replace(/^show_files: /, '')); continue; }
    let hit = null;                                                          // { file, base } | null
    try { hit = await deps.artifactFileOf(row, String(a?.relPath || '')); } catch { hit = null; }   // an index/disk error refuses this one file
    if (!hit) { refuse(source, 'artifact not found'); continue; }
    let real;
    try { real = await realpath(hit.file); } catch { refuse(source, 'artifact not found'); continue; }
    const [root] = await realRoots([hit.base]);
    if (!root || !isInside(root, real, { fold })) { refuse(source, 'the artifact resolves outside its run folder'); continue; }
    await admit(source, real, root);
  }

  for (const id of req.attachmentIds || []) {
    const att = typeof id === 'string' ? deps.getAttachment(id) : null;
    const file = att ? deps.attachmentPath(att.id) : null;
    if (!file) { refuse(String(id), 'attachment not found in this chat'); continue; }
    if (seen.has(att.id)) continue;
    seen.add(att.id);
    // Already in this thread's store: no copy, no budget. Sized from the row first, then re-sniffed from the body.
    if (att.bytes > MAX_KIND_BYTES || (att.kind === 'text' && att.bytes > L.textBytes)) { refuse(att.name, 'too large to show'); continue; }
    let buf;
    try { buf = await readFile(file); } catch { refuse(att.name, 'attachment not found in this chat'); continue; }
    const k = kindOf(buf, att.name, L);
    if (k.error) { refuse(att.name, k.error); continue; }
    items.push(itemOf(att, k.entry, buf, k.mime));
  }

  if (!items.length) return { ok: false, errors: refused.map((r) => `${r.source}: ${r.reason}`), refused };
  return { ok: true, caption: clip(req.caption, 300), items, refused };
}

// ── Show in folder ────────────────────────────────────────────────────────────
/** The reveal route's SOURCE_GONE texts: `run` when the copy came from a run's checkout, `moved` otherwise. */
export const REVEAL_GONE = Object.freeze({
  moved: 'The original file is gone: it was moved or deleted after it was shown.',
  run: "The run's folder was cleaned up after the run, so the original file is gone. Download still has the copy.",
});

const isFileAt = async (p) => { try { return (await stat(p)).isFile(); } catch { return false; } };

/** `rel` inside the registered project's folder when it is a file there, else null. Realpath + containment: never
 *  through `..` or a symlink out of the project. */
async function projectCopyOf({ projectKey, rel }, projectDir, fold) {
  if (typeof rel !== 'string' || !rel) return null;
  let dir = null;
  try { dir = await projectDir(projectKey); } catch { dir = null; }
  const root = await realDir(dir);
  if (!root) return null;
  const real = await realDir(join(root, ...rel.split('/')));
  return real && isInside(root, real, { fold }) && await isFileAt(real) ? real : null;
}

/**
 * Where Show in folder opens (docs/show-files.md). The original while it is a file; else, for a copy found under a
 * run's or project's folder, the same relative path inside the registered project (a run's worktree is removed or
 * cleaned once the run ends). → { file } | { error } (the route's SOURCE_GONE text). An older row has no origin: the
 * original or today's text.
 * @param {{ path:string, origin:{ runId:string|null, projectKey:string, rel:string }|null }} src
 * @param {{ projectDir:(key:string)=>Promise<string|null>, platform?:string }} deps
 */
export async function revealTargetOf(src, { projectDir, platform = process.platform }) {
  if (await isFileAt(src.path)) return { file: src.path };
  const o = src.origin;
  if (!o) return { error: REVEAL_GONE.moved };
  const copy = await projectCopyOf(o, projectDir, platform === 'win32' || platform === 'darwin');
  if (copy) return { file: copy };
  return { error: o.runId ? REVEAL_GONE.run : REVEAL_GONE.moved };
}
