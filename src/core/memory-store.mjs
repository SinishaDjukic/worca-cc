// The durable agent memory store: ~/.worca-cc/memory/{global,projects/<key>}/<name>.md
// (agent-memory-design.md §2–§3). This module is the ONE reader/writer of that
// layout; the run mount (memory-sync.mjs), the Ask tools and the HTTP API all go
// through it. fs posture mirrors run-context.mjs: ENOENT is a normal, silent
// outcome; a REAL read error is reported through `onError` and skipped; nothing
// here throws on a missing source. Every store write is preceded by a snapshot.
import { readFile, writeFile, readdir, mkdir, rm, rename, cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { worcaHome } from './projects.mjs';
import { isValidSkillName } from './skills.mjs';
import { parseFrontmatter, stripFrontmatter } from './frontmatter.mjs';

export const MEMORY_DIR = 'memory';
export const HOOK_MAX_CHARS = 160;
export const SNAPSHOT_KEEP = 20;
export const GLOBAL_SCOPE = Object.freeze({ kind: 'global' });

/** Every refusal this module raises: ENAME (unusable name), ECASE (case twin),
 *  ETOOBIG (over the hard cap), ENOSCOPE (no such snapshot). Callers branch on
 *  `code`; syncBack turns them into per-file rejections instead of aborting. */
export class MemoryError extends Error {
  constructor(code, message) { super(message); this.name = 'MemoryError'; this.code = code; }
}

export function projectScope(projectKey) { return { kind: 'project', projectKey: String(projectKey) }; }

/** `<worcaHome>/memory` — read fresh per call (WORCA_HOME / settings root may change). */
export function memoryRoot() { return join(worcaHome(), MEMORY_DIR); }

/** 'global' | 'projects/<projectKey>'. Throws on a malformed scope (a programming error, never user input). */
export function scopeKey(scope) {
  if (scope?.kind === 'global') return 'global';
  if (scope?.kind === 'project') {
    if (!isValidSkillName(scope.projectKey)) throw new Error(`memory scope: invalid projectKey ${JSON.stringify(scope?.projectKey)}`);
    return `projects/${scope.projectKey}`;
  }
  throw new Error(`memory scope: unknown kind ${JSON.stringify(scope?.kind)} (expected global|project)`);
}

export function scopeDir(root, scope) {
  return scope?.kind === 'global' ? join(root, 'global') : join(root, 'projects', scopeKey(scope).slice('projects/'.length));
}

const WIN_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;   // Win32 device names — reserved with ANY extension
/** A memory NAME is a filename stem used as a path segment: skills.mjs' class, minus a
 *  trailing `.md`; never dot-leading (a hidden file is invisible to every lister), never
 *  dot-trailing (Win32 strips it) and never a Windows device name. */
export function isValidMemoryName(name) {
  return isValidSkillName(name) && !name.startsWith('.') && !name.endsWith('.') && !/\.md$/i.test(name) && !WIN_RESERVED_RE.test(name.split('.')[0]);   // the STEM before the first dot: Win32 reserves `nul.rules.md` too
}

// Built from char codes so the SOURCE carries no escape sequence (see the plan's
// escape-safety rule): C0 + DEL, C1 (incl. U+0085 NEL), U+2028 and U+2029.
const C = String.fromCharCode;
const LINE_BREAKERS = new RegExp(`[${C(0)}-${C(31)}${C(127)}-${C(159)}${C(0x2028)}${C(0x2029)}]`, 'g');
const CONTEXT_TAG_RE = /\[\/?worca context\]/gi;

/** One line, always. Same neutralisation as ask/prompt.mjs' private flatten (kept local: this module must not pull the Ask catalog). */
export function flattenLine(s) {
  return String(s ?? '').replace(LINE_BREAKERS, ' ').replace(CONTEXT_TAG_RE, '(worca context)');
}

const clipHook = (s, n = HOOK_MAX_CHARS) => { const t = flattenLine(s).trim(); return t.length > n ? t.slice(0, n) : t; };
const splitPaths = (s) => String(s ?? '').split(',').map((p) => p.trim()).filter(Boolean);
const KNOWN_KEYS = ['name', 'description', 'paths', 'source', 'updated'];
const EXTRA_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;   // frontmatter.mjs' KEY_LINE_RE class: anything else cannot be re-parsed

/** @returns {{meta:{name:string,description:string,paths:string[],source:string,updated:string,extra:Record<string,string>}, body:string, hasFrontmatter:boolean}} */
export function parseMemoryFile(text) {
  const s = typeof text === 'string' ? text : '';
  const fm = parseFrontmatter(s);
  const empty = { name: '', description: '', paths: [], source: '', updated: '', extra: {} };
  if (!fm) return { meta: empty, body: s, hasFrontmatter: false };
  const extra = {};
  for (const k of Object.keys(fm.fields).sort()) if (!KNOWN_KEYS.includes(k)) extra[k] = fm.fields[k];
  return {
    meta: {
      name: fm.fields.name || '', description: fm.fields.description || '', paths: splitPaths(fm.fields.paths),
      source: fm.fields.source || '', updated: fm.fields.updated || '', extra,
    },
    body: stripFrontmatter(s),
    hasFrontmatter: true,
  };
}

/** Known keys in a fixed order, then `extra` sorted; empty values are omitted; the body always ends with one newline. */
export function renderMemoryFile(meta, body) {
  if (!isValidMemoryName(meta?.name)) throw new MemoryError('ENAME', `memory: cannot render a file without a valid name (${JSON.stringify(meta?.name)})`);
  const lines = ['---'];
  if (meta.name) lines.push(`name: ${flattenLine(meta.name)}`);
  if (meta.description) lines.push(`description: ${flattenLine(meta.description)}`);
  if (meta.paths?.length) lines.push(`paths: ${meta.paths.map(flattenLine).join(', ')}`);
  if (meta.source) lines.push(`source: ${flattenLine(meta.source)}`);
  if (meta.updated) lines.push(`updated: ${flattenLine(meta.updated)}`);
  // An extra key the reader could not parse back would silently vanish on the next
  // round-trip (or worse, swallow the line after it) — drop it at the render.
  for (const k of Object.keys(meta.extra || {}).sort()) if (EXTRA_KEY_RE.test(k) && !KNOWN_KEYS.includes(k)) lines.push(`${k}: ${flattenLine(meta.extra[k])}`);
  lines.push('---');
  const b = String(body ?? '');
  return `${lines.join('\n')}\n${b.endsWith('\n') ? b : `${b}\n`}`;
}

/** First non-empty body line that is not a fence/rule (`---`), minus a markdown heading marker. */
const deriveHook = (body, n = HOOK_MAX_CHARS) =>
  clipHook((String(body ?? '').split(/\r?\n/).find((l) => l.trim() && !/^-{3,}\s*$/.test(l)) || '').replace(/^#+\s*/, ''), n);

/**
 * Normalise a file the way every WRITER does (§2 "sync-back repairs frontmatter"):
 * the name is forced to the filename stem, a missing hook is derived from the body,
 * a long hook is clipped, paths and extra keys are kept, and `source`/`updated` are
 * ALWAYS overwritten with the writer's values — provenance is worca's, never the
 * agent's (a file arriving with `source: user` from a run is a lie). `changed` says
 * whether the rendered text differs from the input; callers only ever repair files
 * whose hash moved, so an untouched file is never rewritten. `hookMaxChars` is the
 * caller's cap: writeMemory and syncBack MUST pass the same one or the two repairs
 * of one file would render different bytes and the baseline hash would never settle.
 */
export function repairMemoryFile(text, { name, source, now, hookMaxChars = HOOK_MAX_CHARS }) {
  const input = String(text ?? '');
  const { meta, body } = parseMemoryFile(input);
  const next = {
    name, description: clipHook(meta.description, hookMaxChars) || deriveHook(body, hookMaxChars), paths: meta.paths,
    source, updated: now, extra: meta.extra,
  };
  const out = renderMemoryFile(next, body);
  return { text: out, meta: next, changed: out !== input };
}

// ── helpers ──────────────────────────────────────────────────────────────────
export const hashText = (text) => createHash('sha1').update(String(text ?? ''), 'utf8').digest('hex');
const isAbsent = (err) => err && (err.code === 'ENOENT' || err.code === 'ENOTDIR');
const bytesOf = (s) => Buffer.byteLength(String(s ?? ''), 'utf8');
/** `yyyymmdd-hhmmss` from an ISO timestamp — no colons (Windows), sorts chronologically. */
const stamp = (iso) => String(iso).replace(/[-:T]/g, '').slice(0, 15).replace(/^(\d{8})(\d{6}).*$/, '$1-$2');
const sourceSlug = (source) => String(source || 'unknown').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
async function readdirMaybe(dir, onError) {
  try { return await readdir(dir, { withFileTypes: true }); }
  catch (err) { if (!isAbsent(err)) onError?.(dir, err); return []; }
}
async function readTextMaybe(p, onError) {
  try { return await readFile(p, 'utf8'); }
  catch (err) { if (!isAbsent(err)) onError?.(p, err); return null; }
}
let tmpSeq = 0;   // two writers in one process (parallel executions, several live runs) must never share a temp name
/** Atomic text write: temp file beside the target + rename (POSIX and Windows). */
async function writeAtomic(p, text) {
  await mkdir(resolve(p, '..'), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}-${++tmpSeq}`;
  try { await writeFile(tmp, text, 'utf8'); await rename(tmp, p); }
  catch (err) { await rm(tmp, { force: true }).catch(() => {}); throw err; }
}
function assertName(name) {
  if (!isValidMemoryName(name)) throw new MemoryError('ENAME', `memory: invalid name ${JSON.stringify(name)} — letters, digits, ".", "_" and "-" only, no extension`);
}

// ── listing / reading ────────────────────────────────────────────────────────
/** @param {string} dir any directory holding <name>.md files (a store scope dir OR a run-mount dir) */
export async function listMemoryDir(dir, { onError } = {}) {
  const out = [];
  for (const e of await readdirMaybe(dir, onError)) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const name = e.name.slice(0, -3);
    const path = join(dir, e.name);
    if (!isValidMemoryName(name)) { onError?.(path, new MemoryError('ENAME', `memory: skipped ${e.name} (invalid name)`)); continue; }
    const text = await readTextMaybe(path, onError);
    if (text === null) continue;
    const { meta, body, hasFrontmatter } = parseMemoryFile(text);
    out.push({
      // §2: a broken/missing fence is still SERVED — the hook falls back to the first non-empty body line.
      name, description: meta.description || deriveHook(body), paths: meta.paths, source: meta.source, updated: meta.updated,
      bytes: bytesOf(text), hasFrontmatter, hash: hashText(text),
    });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
export function listMemory(root, scope, opts) { return listMemoryDir(scopeDir(root, scope), opts); }

export async function readMemory(root, scope, name) {
  assertName(name);
  const text = await readTextMaybe(join(scopeDir(root, scope), `${name}.md`));
  if (text === null) return null;
  const { meta, body } = parseMemoryFile(text);
  return { text, meta, body };
}

// ── .state counters ──────────────────────────────────────────────────────────
const stateFile = (root, scope) => join(root, '.state', `${scopeKey(scope)}.json`);
const EMPTY_STATE = Object.freeze({ writesSinceDefrag: 0, lastWriteAt: null, lastDefragAt: null, lastDefragRunId: null });
export async function readScopeState(root, scope) {
  const text = await readTextMaybe(stateFile(root, scope));
  if (text === null) return { ...EMPTY_STATE };
  try { const j = JSON.parse(text); return { ...EMPTY_STATE, ...(j && typeof j === 'object' ? j : {}) }; }
  catch { return { ...EMPTY_STATE }; }
}
export async function bumpScopeState(root, scope, patch) {
  const next = { ...(await readScopeState(root, scope)), ...patch };
  await writeAtomic(stateFile(root, scope), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

// ── snapshots (.history/<scopeKey>/<yyyymmdd-hhmmss>-<source>[-NN]/) ──────────
const historyDir = (root, scope) => join(root, '.history', scopeKey(scope));
export async function listSnapshots(root, scope) {
  const dir = historyDir(root, scope);
  const ids = (await readdirMaybe(dir)).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const out = [];
  for (const id of ids) {
    const files = (await readdirMaybe(join(dir, id))).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name).sort();
    out.push({ id, dir: join(dir, id), files });
  }
  return out;
}
/** A snapshot (and a restore) is complete over the files the scope SERVES, or it fails. A
 *  junk-named file (a hand-dropped `my notes.md`) is not one of them: it is skipped like
 *  every lister skips it, because failing here would make the whole scope unwritable — one
 *  such file would reject every agent's write to it, blaming a file the agent never wrote. */
const throwUnlessJunk = (p, err) => { if (err?.code !== 'ENAME') throw err; };
/** Copy the scope's current *.md files into a new snapshot dir; prune to `keep`. No-op when the scope has no files. */
export async function snapshotScope(root, scope, { source, now, keep = SNAPSHOT_KEEP } = {}) {
  const entries = await listMemory(root, scope, { onError: throwUnlessJunk });
  if (!entries.length) return null;
  const base = `${stamp(now || new Date().toISOString())}-${sourceSlug(source)}`;
  // Same-second, same-source snapshots get -02, -03, … AFTER the highest existing
  // suffix; zero-padded so the ring's lexicographic sort stays chronological
  // (an unpadded -10 would sort before -2 and be pruned as the "oldest").
  const existing = (await listSnapshots(root, scope)).map((s) => s.id)
    .filter((x) => x === base || (x.startsWith(`${base}-`) && /^\d+$/.test(x.slice(base.length + 1))));
  const max = existing.reduce((m, x) => Math.max(m, x === base ? 1 : Number(x.slice(base.length + 1))), 0);
  const id = max === 0 ? base : `${base}-${String(max + 1).padStart(2, '0')}`;
  const dest = join(historyDir(root, scope), id);
  await mkdir(dest, { recursive: true });
  for (const e of entries) await cp(join(scopeDir(root, scope), `${e.name}.md`), join(dest, `${e.name}.md`));
  const all = await listSnapshots(root, scope);
  for (const s of all.slice(0, Math.max(0, all.length - keep))) await rm(s.dir, { recursive: true, force: true });
  return id;
}
/** Snapshot first (undo of the undo), then make the scope's files exactly the snapshot's. */
export async function restoreSnapshot(root, scope, id, { source, now } = {}) {
  if (!isValidSkillName(id)) throw new MemoryError('ENAME', `memory: invalid snapshot id ${JSON.stringify(id)}`);
  const snap = (await listSnapshots(root, scope)).find((s) => s.id === id);
  if (!snap) throw new MemoryError('ENOSCOPE', `memory: no snapshot ${id}`);
  await snapshotScope(root, scope, { source, now });
  const dir = scopeDir(root, scope);
  for (const e of await listMemory(root, scope, { onError: throwUnlessJunk })) await rm(join(dir, `${e.name}.md`), { force: true });
  await mkdir(dir, { recursive: true });
  for (const f of snap.files) await cp(join(snap.dir, f), join(dir, f));
  await bumpScopeState(root, scope, { lastWriteAt: now || new Date().toISOString() });
}

// ── writing ──────────────────────────────────────────────────────────────────
/** Case-folded uniqueness: 'Testing' next to 'testing' is one file on macOS/Windows and two on Linux — refuse both ways. */
async function assertNoCaseTwin(dir, name) {
  const lower = name.toLowerCase();
  for (const e of await readdirMaybe(dir)) {
    if (!e.name.endsWith('.md')) continue;
    const stem = e.name.slice(0, -3);
    if (stem !== name && stem.toLowerCase() === lower) throw new MemoryError('ECASE', `memory: "${name}" collides with existing "${stem}" (names differ only by case)`);
  }
}
/**
 * Write one memory file: validate, repair frontmatter (name forced, hook derived/clipped,
 * source/updated stamped), enforce the HARD cap, snapshot the scope, write atomically,
 * bump the counters. Rejects with a MemoryError BEFORE touching the disk.
 * `snapshot`: `true` (snapshot this scope now), `false` (the caller took one) or an async
 * function called at the snapshot point — syncBack passes a once-per-scope closure so a
 * sync of N files takes ONE snapshot of the pre-sync scope, not N.
 */
export async function writeMemory(root, scope, name, text, { source, now, caps, onError, snapshot = true } = {}) {
  assertName(name);
  const dir = scopeDir(root, scope);
  await assertNoCaseTwin(dir, name);
  const when = now || new Date().toISOString();
  const repaired = repairMemoryFile(String(text ?? ''), { name, source: source || 'user', now: when, hookMaxChars: caps?.hookMaxChars });
  const bytes = bytesOf(repaired.text);
  const hard = caps?.hardBytesPerFile;
  if (hard && bytes > hard) throw new MemoryError('ETOOBIG', `memory: "${name}" is ${bytes} bytes, over the ${hard}-byte cap`);
  const target = join(dir, `${name}.md`);
  const before = await readTextMaybe(target, onError);
  if (typeof snapshot === 'function') await snapshot();
  else if (snapshot !== false) await snapshotScope(root, scope, { source, now: when });
  await writeAtomic(target, repaired.text);
  const st = await readScopeState(root, scope);
  await bumpScopeState(root, scope, { writesSinceDefrag: st.writesSinceDefrag + 1, lastWriteAt: when });
  return { created: before === null, bytes, meta: repaired.meta, changed: before !== repaired.text };
}
export async function removeMemory(root, scope, name, { source, now, snapshot = true } = {}) {
  assertName(name);
  const target = join(scopeDir(root, scope), `${name}.md`);
  if ((await readTextMaybe(target)) === null) return false;
  const when = now || new Date().toISOString();
  if (typeof snapshot === 'function') await snapshot();
  else if (snapshot !== false) await snapshotScope(root, scope, { source, now: when });
  await rm(target, { force: true });
  const st = await readScopeState(root, scope);
  await bumpScopeState(root, scope, { writesSinceDefrag: st.writesSinceDefrag + 1, lastWriteAt: when });
  return true;
}

// ── the agent-facing index (§4.2) ────────────────────────────────────────────
export const MEMORY_INDEX_HEADING = '## Worca memory';
export const MEMORY_INDEX_INTRO =
  'Durable rules and preferences kept across runs and chats. Read a file (by the path below) when its hook ' +
  'matches what you are doing; do not read all of them. Write or edit a file there only for something worth ' +
  'keeping for future runs — a hard-won rule, a user preference, a trap — never progress notes or a summary of ' +
  'this run. Keep the frontmatter (name, description, paths); worca stamps source and updated.';
const CLIPPED_HOOK_CHARS = 60;   // second-stage clip when the cap binds
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function renderIndexOnce(sections, omit, hookChars) {
  const lines = [MEMORY_INDEX_HEADING, MEMORY_INDEX_INTRO];
  for (const s of sections) {
    lines.push(`${flattenLine(s.label)} — ${s.dir}:`);
    const kept = [...(s.entries || [])].sort(byName).filter((e) => !omit.has(`${s.dir}/${e.name}`));
    // A scope whose files were all dropped must not read like an EMPTY scope: the
    // agent would conclude there is nothing to read there and never look.
    const hidden = (s.entries || []).length - kept.length;
    if (!kept.length) lines.push(hidden ? `- (${hidden} file(s) in this scope, not listed — the index is over its byte cap)` : '- (nothing yet)');
    else if (hidden) lines.push(`- (${hidden} more file(s) not listed)`);
    for (const e of kept) {
      const hook = clipHook(e.description, hookChars) || '(no description)';
      const paths = e.paths?.length ? ` [paths: ${clipHook(e.paths.map(flattenLine).join(', '), hookChars)}]` : '';   // clipped like a hook: one long paths line must not push a whole scope out of the index
      lines.push(`- \`${e.name}.md\` — ${hook}${paths}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * @param {Array<{label:string, dir:string, entries:Array}>} sections
 * @returns {{text:string, dropped:string[], warnings:string[]}}
 * `maxBytes` is a floor as well as a cap: the heading + intro (~430 bytes) are never
 * dropped; a smaller cap is honoured as far as the file lines allow.
 */
export function renderMemoryIndex(sections, { maxBytes = 4096, hookMaxChars = HOOK_MAX_CHARS } = {}) {
  const omit = new Set();
  let text = renderIndexOnce(sections, omit, hookMaxChars);
  if (bytesOf(text) <= maxBytes) return { text, dropped: [], warnings: [] };
  text = renderIndexOnce(sections, omit, Math.min(hookMaxChars, CLIPPED_HOOK_CHARS));
  // Drop oldest-updated first (an empty `updated` is oldest of all); ties by name.
  const all = sections.flatMap((s) => (s.entries || []).map((e) => ({ key: `${s.dir}/${e.name}`, name: e.name, updated: e.updated || '' })))
    .sort((a, b) => (a.updated < b.updated ? -1 : a.updated > b.updated ? 1 : byName(a, b)));
  const dropped = [];
  for (const e of all) {
    if (bytesOf(text) <= maxBytes) break;
    omit.add(e.key); dropped.push(e.name);
    text = renderIndexOnce(sections, omit, Math.min(hookMaxChars, CLIPPED_HOOK_CHARS));
  }
  const warnings = dropped.length ? [`memory index: dropped ${dropped.length} file(s) to fit ${maxBytes} bytes: ${dropped.join(', ')}`] : [];
  return { text, dropped, warnings };
}
