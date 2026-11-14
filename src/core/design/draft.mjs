// src/core/design/draft.mjs
// The draft store (P2 Task 4): the text of every file a stage draws, kept per path while agents stream `Write` and
// `Edit` input, and turned into `design-delta` splices (SPEC C-5: Write = splice at end; Edit = one splice deleting
// `old_string` at its index, then appends). Appends batch per path for `flushMs` or `flushBytes`, a frame never
// carries more than `maxFrameBytes`, and a timer or size flush never ends one on half a character (`done`, `flush`,
// `snapshot` and a non-contiguous splice send all they hold). The disk is the truth: `landed` replaces a draft
// with what a tool result or a process exit read back, and every tool still writing that path stops. Also the path
// helpers that decide which files are drafted (L2.32) and where a tool's `file_path` sits inside work/, and the layer
// count over landed section HTML (L2.13).
import { posix, win32 } from 'node:path';
import { lexicalPath } from '../file-read-guard.mjs';
import { isSectionId } from './ids.mjs';
import { boundedParser } from './html-scan.mjs';

/** The files a stage draws (L2.32): a section's three parts, and the two global stylesheets. `shell.html` and
 *  `global.js` are not drafted: C-6 has no message for them. */
const SECTION_PARTS = new Map([['index.html', 'html'], ['style.css', 'css'], ['script.js', 'js']]);
const GLOBAL_PARTS = new Map([['tokens.css', 'css'], ['global.css', 'css']]);
const TOOLS = new Set(['Write', 'Edit']);

/**
 * Which drawn file a work-relative path is, or null for one no stage draws.
 * @param {unknown} rel forward slashes, relative to work/
 * @returns {{ sectionId: string|null, part: 'html'|'css'|'js' }|null}
 */
export function classifyDraftPath(rel) {
  if (typeof rel !== 'string') return null;
  const global = GLOBAL_PARTS.get(rel);
  if (global) return { sectionId: null, part: global };
  const bits = rel.split('/');
  if (bits.length !== 3 || bits[0] !== 'sections' || !isSectionId(bits[1])) return null;
  const part = SECTION_PARTS.get(bits[2]);
  return part ? { sectionId: bits[1], part } : null;
}

/**
 * A tool's `file_path` as a path relative to work/, forward slashes, or null when it is not inside work/. Only a
 * relative path is resolved (against `cwd`); everything is then compared in `lexicalPath`'s form, which refuses any
 * `..` step, reads Git Bash's `/c/…` as `c:/…` and lower-cases on Windows (so the rel is lower-case there, and every
 * drafted name is). `realWorkDir` covers macOS's `/var` vs `/private/var` alias.
 * @param {unknown} filePath
 * @param {{ workDir?: string, realWorkDir?: string, cwd?: string, platform?: string }} [opts]
 * @returns {string|null}
 */
export function toWorkRel(filePath, { workDir, realWorkDir, cwd, platform = process.platform } = {}) {
  if (typeof filePath !== 'string' || !filePath) return null;
  const p = platform === 'win32' ? win32 : posix;
  let abs = filePath;
  if (!p.isAbsolute(filePath)) {
    const base = lexicalPath(cwd, { platform });
    if (!base) return null;
    abs = p.resolve(base, filePath);
  }
  const lex = lexicalPath(abs, { platform });
  if (!lex) return null;
  for (const root of [workDir, realWorkDir]) {
    const r = lexicalPath(root, { platform });
    if (!r) continue;
    const prefix = r.endsWith('/') ? r : `${r}/`;
    if (lex.length > prefix.length && lex.startsWith(prefix)) return lex.slice(prefix.length);
  }
  return null;
}

/**
 * The number of start tags in `html`, as a parser reads it: comments, closing tags and markup inside script or
 * style text do not count.
 * @param {unknown} html
 * @returns {number}
 */
export function countLayers(html) {
  if (typeof html !== 'string' || !html) return 0;
  let n = 0;
  boundedParser(html, { onopentagname() { n += 1; } }).read();
  return n;
}

const isHigh = (c) => c >= 0xd800 && c <= 0xdbff;

/** `text` in pieces of at most `max` UTF-8 bytes, never splitting a surrogate pair (at least one character each). */
function pieces(text, max) {
  if (Buffer.byteLength(text) <= max) return [text];
  const out = [];
  let start = 0;
  let bytes = 0;
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    const pair = isHigh(c) && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00;
    const b = pair ? 4 : c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
    if (bytes + b > max && i > start) { out.push(text.slice(start, i)); start = i; bytes = 0; }
    bytes += b;
    i += pair ? 2 : 1;
  }
  out.push(text.slice(start));
  return out;
}

/**
 * The draft store of one build. `rev` is per path and counts frames plus `landed` calls from `revBase`, so a client
 * sees `rev + 1` or a gap. A path's first use reads the disk once and seeds the draft with no frame; with `landFirst`
 * that first use also hands the disk text (`''` when missing) to `onLand` at `revBase + 1`, before any splice.
 * @param {{ onSplice: (f: { agentId: string, path: string, rev: number, splice: { at: number, del: number, text: string } }) => void,
 *   readDisk: (path: string) => string|null, flushMs?: number, flushBytes?: number, maxFrameBytes?: number,
 *   revBase?: number, landFirst?: boolean, onLand?: (f: { path: string, rev: number, text: string }) => void,
 *   setTimer?: Function, clearTimer?: Function }} opts
 */
export function createDraftStore({
  onSplice, readDisk, flushMs = 120, flushBytes = 4096, maxFrameBytes = 16384, revBase = 0,
  landFirst = false, onLand = () => {}, setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  /** path -> { path, text (every frame sent), rev, pending: null|{agentId, at, text, bytes}, timer } */
  const docs = new Map();
  /** Every toolUseId the store took, streamed or whole: `applyWhole` never applies one twice. */
  const seen = new Set();
  /** toolUseId -> a tool still writing: { agentId, name, path, pos, old, held, oldDone, newDone, located } */
  const open = new Map();
  /** A listener or the disk reader throwing must never leave a draft half applied. */
  const safe = (fn, arg) => { try { return fn(arg); } catch { return undefined; } };

  function docOf(path) {
    let d = docs.get(path);
    if (d) return d;
    const disk = safe(readDisk, path);
    d = { path, text: typeof disk === 'string' ? disk : '', rev: revBase, pending: null, timer: null };
    docs.set(path, d);
    if (landFirst) { d.rev += 1; safe(onLand, { path, rev: d.rev, text: d.text }); }
    return d;
  }

  function emit(d, agentId, at, del, text) {
    d.text = d.text.slice(0, at) + text + d.text.slice(at + del);
    d.rev += 1;
    safe(onSplice, { agentId, path: d.path, rev: d.rev, splice: { at, del, text } });
  }

  function stopTimer(d) {
    if (d.timer == null) return;
    const t = d.timer;
    d.timer = null;
    safe(clearTimer, t);
  }

  function arm(d) {
    d.timer = setTimer(() => { d.timer = null; flushDoc(d, true); }, flushMs);
  }

  /** Sends the pending append. `hold` (a timer or size flush, the tool still streaming) keeps a trailing high
   *  surrogate back for the next chunk, so no frame ends on half a character. */
  function flushDoc(d, hold) {
    stopTimer(d);
    const p = d.pending;
    if (!p) return;
    let text = p.text;
    d.pending = null;
    if (hold && isHigh(text.charCodeAt(text.length - 1))) {
      text = text.slice(0, -1);
      d.pending = { agentId: p.agentId, at: p.at + text.length, text: p.text.slice(-1), bytes: 3 };
    }
    let at = p.at;
    for (const piece of text ? pieces(text, maxFrameBytes) : []) { emit(d, p.agentId, at, 0, piece); at += piece.length; }
  }

  /** Only contiguous appends of one agent merge; anything else sends the pending batch first. */
  function append(d, agentId, at, text) {
    if (!text) return;
    const p = d.pending;
    if (p && p.agentId === agentId && p.at + p.text.length === at) {
      p.text += text;
      p.bytes += Buffer.byteLength(text);
    } else {
      flushDoc(d, false);
      d.pending = { agentId, at, text, bytes: Buffer.byteLength(text) };
    }
    if (d.pending.bytes >= flushBytes) flushDoc(d, true);
    if (d.pending && d.timer == null) arm(d);
  }

  /** An `Edit` once its whole `old_string` is known: the first match is deleted in one splice and the held
   *  `new_string` follows as appends. Not found (or an empty `old_string` on a non-empty draft): nothing is drawn and
   *  the disk corrects the draft at `landed`. `replace_all` is not read. */
  function locate(t, d) {
    flushDoc(d, false);
    const idx = t.old ? d.text.indexOf(t.old) : (d.text ? -1 : 0);
    if (idx < 0) { t.held = ''; return; }
    t.located = true;
    t.pos = idx;
    if (t.old) emit(d, t.agentId, idx, t.old.length, '');
    const held = t.held;
    t.held = '';
    append(d, t.agentId, t.pos, held);
    t.pos += held.length;
  }

  function startTool({ toolUseId, agentId, name, path } = {}) {
    if (typeof toolUseId !== 'string' || !toolUseId || seen.has(toolUseId)) return;
    if (!TOOLS.has(name) || !classifyDraftPath(path)) return;
    seen.add(toolUseId);
    const d = docOf(path);
    if (name === 'Write') {
      flushDoc(d, false);
      if (d.text) emit(d, agentId, 0, d.text.length, '');
    }
    open.set(toolUseId, { agentId, name, path, pos: 0, old: '', held: '', oldDone: false, newDone: false, located: false });
  }

  function field({ toolUseId, field: name, chunk, done } = {}) {
    const t = open.get(toolUseId);
    if (!t) return;
    const d = docOf(t.path);
    const text = typeof chunk === 'string' ? chunk : '';
    if (t.name === 'Write') {
      if (name !== 'content') return;
      append(d, t.agentId, t.pos, text);
      t.pos += text.length;
      if (done) { flushDoc(d, false); open.delete(toolUseId); }
      return;
    }
    if (name === 'old_string') {
      if (t.oldDone) return;
      t.old += text;
      if (done) { t.oldDone = true; locate(t, d); }
    } else if (name === 'new_string') {
      if (t.newDone) return;
      if (t.located) { append(d, t.agentId, t.pos, text); t.pos += text.length; } else t.held += text;
      if (done) t.newDone = true;
    } else return;
    if (t.oldDone && t.newDone) { flushDoc(d, false); open.delete(toolUseId); }
  }

  /** Level 2: a whole tool call with no stream before it draws once; a streamed or repeated id draws nothing. */
  function applyWhole({ toolUseId, agentId, name, path, input } = {}) {
    if (typeof toolUseId !== 'string' || seen.has(toolUseId)) return;
    const i = input && typeof input === 'object' ? input : {};
    let fields;
    if (name === 'Write' && typeof i.content === 'string') fields = [['content', i.content]];
    else if (name === 'Edit' && typeof i.old_string === 'string' && typeof i.new_string === 'string') {
      fields = [['old_string', i.old_string], ['new_string', i.new_string]];
    } else return;
    startTool({ toolUseId, agentId, name, path });
    for (const [f, chunk] of fields) field({ toolUseId, field: f, chunk, done: true });
  }

  /** The disk's text for `path`: pending text is dropped, every tool writing the path stops, `rev` rises. Null for a
   *  path no stage draws. */
  function landed(path, text) {
    if (!classifyDraftPath(path)) return null;
    let d = docs.get(path);
    if (!d) { d = { path, text: '', rev: revBase, pending: null, timer: null }; docs.set(path, d); }
    stopTimer(d);
    d.pending = null;
    for (const [id, t] of open) if (t.path === path) open.delete(id);
    d.text = typeof text === 'string' ? text : '';
    d.rev += 1;
    return d.rev;
  }

  function flush(path) {
    if (path === undefined) { for (const d of docs.values()) flushDoc(d, false); return; }
    const d = docs.get(path);
    if (d) flushDoc(d, false);
  }

  /** Every draft as a late joiner needs it. Pending text is sent first, or it would arrive twice: in the snapshot
   *  and again in the next delta. */
  function snapshot() {
    flush();
    return [...docs.values()].map(({ path, rev, text }) => ({ path, rev, text }));
  }

  return { startTool, field, applyWhole, hasTool: (toolUseId) => seen.has(toolUseId), landed, flush, snapshot };
}
