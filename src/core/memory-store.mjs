// The durable agent memory store: ~/.worca-cc/memory/{global,projects/<key>}/<name>.md
// (agent-memory-design.md §2–§3). This module is the ONE reader/writer of that
// layout; the run mount (memory-sync.mjs), the Ask tools and the HTTP API all go
// through it. fs posture mirrors run-context.mjs: ENOENT is a normal, silent
// outcome; a REAL read error is reported through `onError` and skipped; nothing
// here throws on a missing source. Every store write is preceded by a snapshot.
import { readFile, writeFile, readdir, mkdir, rm, rename, cp, realpath } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { worcaHome } from './projects.mjs';
import { isValidSkillName } from './skills.mjs';
import { parseFrontmatter, stripFrontmatter } from './frontmatter.mjs';

export const MEMORY_DIR = 'memory';
export const HOOK_MAX_CHARS = 160;
export const SNAPSHOT_KEEP = 20;
export const GLOBAL_SCOPE = Object.freeze({ kind: 'global' });

/** Every refusal this module raises: ENAME (unusable name), ECASE (case twin), ETOOBIG (over
 *  the hard cap), EFULL (the scope holds caps.maxFilesPerScope files and this is a new one),
 *  ENOSCOPE (no such snapshot), EESCAPE (the scope dir resolves outside the store root).
 *  Callers branch on `code`; syncBack turns them into per-file rejections instead of aborting. */
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
/** The ONE human wording of that rule. The /api/memory routes answer `invalid memory name — ${MEMORY_NAME_HELP}`
 *  and ui/public/memory-view.mjs declares the same literal for the editor's client-side refusal, so the
 *  message a user sees never depends on which side refused (test/api-memory.test.mjs compares them). */
export const MEMORY_NAME_HELP = 'letters, digits, ".", "_" and "-" only, no extension, no leading or trailing dot';

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
/** The scope dir, created and PROVEN to live under the store root. A scope dir that is a
 *  symlink or junction out of the root would carry writeAtomic's temp file + rename (and
 *  removeMemory's rm, restoreSnapshot's rm/cp) elsewhere — spec §2/§13, the realpath
 *  re-check P1's amendment A5 deferred. `mkdir` first: a fresh store has no root yet.
 *  `relative` on the REAL paths handles the macOS /tmp → /private/tmp alias and (on Windows,
 *  where path.relative is case-insensitive) a drive-letter case difference.
 *  Two accepted edges: a linked `projects/` PARENT has the empty scope dir created at its target
 *  before the refusal (nothing is ever written there), and because this runs before writeMemory's
 *  cap checks a refused ETOOBIG/EFULL write can leave an empty scope dir behind (listMemory: []). */
async function writableScopeDir(root, scope) {
  const dir = scopeDir(root, scope);
  await mkdir(dir, { recursive: true });
  const [realRoot, realDir] = await Promise.all([realpath(root), realpath(dir)]);
  const rel = relative(realRoot, realDir);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new MemoryError('EESCAPE', `memory: ${dir} resolves to ${realDir}, outside the memory store — refusing to write`);
  }
  return dir;
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
  const dir = await writableScopeDir(root, scope);   // BEFORE the pre-restore snapshot: never read or copy through a link
  await snapshotScope(root, scope, { source, now });
  for (const e of await listMemory(root, scope, { onError: throwUnlessJunk })) await rm(join(dir, `${e.name}.md`), { force: true });
  for (const f of snap.files) await cp(join(snap.dir, f), join(dir, f));
  await bumpScopeState(root, scope, { lastWriteAt: now || new Date().toISOString() });
}

// ── writing ──────────────────────────────────────────────────────────────────
/** Case-folded uniqueness: 'Testing' next to 'testing' is one file on macOS/Windows and two on
 *  Linux — refuse both ways. Returns how many valid-named `.md` files the dir holds (the class
 *  listMemory serves and syncBack counts), so writeMemory needs no second readdir for EFULL.
 *  The `isFile()` + `isValidMemoryName` filters align the twin check with listMemoryDir's served
 *  class: a DIRECTORY named `Testing.md`, or a junk-named `my Notes.md`, no longer collides and
 *  no longer counts toward the cap. */
async function assertNoCaseTwin(dir, name) {
  const lower = name.toLowerCase();
  let count = 0;
  for (const e of await readdirMaybe(dir)) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const stem = e.name.slice(0, -3);
    if (!isValidMemoryName(stem)) continue;
    count++;
    if (stem !== name && stem.toLowerCase() === lower) throw new MemoryError('ECASE', `memory: "${name}" collides with existing "${stem}" (names differ only by case)`);
  }
  return count;
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
  const dir = await writableScopeDir(root, scope);
  const existing = await assertNoCaseTwin(dir, name);
  const when = now || new Date().toISOString();
  const repaired = repairMemoryFile(String(text ?? ''), { name, source: source || 'user', now: when, hookMaxChars: caps?.hookMaxChars });
  const bytes = bytesOf(repaired.text);
  const hard = caps?.hardBytesPerFile;
  if (hard && bytes > hard) throw new MemoryError('ETOOBIG', `memory: "${name}" is ${bytes} bytes, over the ${hard}-byte cap`);
  const target = join(dir, `${name}.md`);
  const before = await readTextMaybe(target, onError);
  // A NEW file past the per-scope cap is refused before the snapshot (spec §2 caps; P2 amendment
  // B12). syncBack pre-checks the same count and its reason text is identical minus the prefix.
  if (before === null && caps?.maxFilesPerScope && existing >= caps.maxFilesPerScope) {
    throw new MemoryError('EFULL', `memory: scope is full (${caps.maxFilesPerScope} files)`);
  }
  if (typeof snapshot === 'function') await snapshot();
  else if (snapshot !== false) await snapshotScope(root, scope, { source, now: when });
  await writeAtomic(target, repaired.text);
  const st = await readScopeState(root, scope);
  await bumpScopeState(root, scope, { writesSinceDefrag: st.writesSinceDefrag + 1, lastWriteAt: when });
  return { created: before === null, bytes, meta: repaired.meta, changed: before !== repaired.text };
}
export async function removeMemory(root, scope, name, { source, now, snapshot = true } = {}) {
  assertName(name);
  // Exact-cased existence: on macOS/Windows `readTextMaybe` would happily open testing.md through
  // "Testing" and the rm below would delete a file the caller never named. readdir is the truth.
  const names = (await readdirMaybe(scopeDir(root, scope))).filter((e) => e.isFile()).map((e) => e.name);
  if (!names.includes(`${name}.md`)) return false;
  const target = join(scopeDir(root, scope), `${name}.md`);
  await writableScopeDir(root, scope);                 // a no-op remove above never created a dir; a real one is proven in-root
  const when = now || new Date().toISOString();
  if (typeof snapshot === 'function') await snapshot();
  else if (snapshot !== false) await snapshotScope(root, scope, { source, now: when });
  await rm(target, { force: true });
  const st = await readScopeState(root, scope);
  await bumpScopeState(root, scope, { writesSinceDefrag: st.writesSinceDefrag + 1, lastWriteAt: when });
  return true;
}

// ── the agent-facing pointer block (§4.2, native-rules revision) ─────
// The bodies reach the agent through Claude Code's own `.claude/rules` loader (the
// mount lives inside every spawn's cwd — memory-sync.mjs MEMORY_RULES_REL); this block
// only says WHERE memory lives and WHAT belongs there. One `Label — /abs/dir:` line per
// mounted scope: claude-runner.mjs memoryDirsFromPrompt reads exactly those lines, so the
// intro must stay ONE line and nothing may follow the dir lines inside the block.
export const MEMORY_BLOCK_HEADING = '## Worca memory';
export const MEMORY_BLOCK_INTRO =
  'Durable rules, preferences and traps kept across runs and chats. Claude Code loads them into your context ' +
  'from the memory directories below (a file with `paths` loads when you read a matching file), so never search ' +
  'for them (the built-in Explore and Plan sub-agents do not load them — read the files there if you are one). ' +
  'Write or edit a file there only for something worth keeping for future runs — a hard-won rule, a ' +
  'user preference, a trap — never progress notes or a summary of this run. One topic per file (`<topic>.md`); ' +
  'keep the frontmatter: `name` (the filename stem), `description` (one line: when the file is worth reading), ' +
  'optional `paths` (comma-separated globs); worca stamps `source` and `updated`. To remove a file, empty it.';

/**
 * @param {Array<{label:string, dir:string}>} sections  one per mounted scope, in mount order
 * @returns {string} the block with one trailing newline; byte-stable for identical input
 */
export function renderMemoryBlock(sections) {
  const lines = [MEMORY_BLOCK_HEADING, MEMORY_BLOCK_INTRO];
  for (const s of sections || []) lines.push(`${flattenLine(s.label)} — ${s.dir}:`);
  return `${lines.join('\n')}\n`;
}

// ── health (§8) ──────────────────────────────────────────────────────────────
export const MEMORY_LEVELS = Object.freeze(['fresh', 'ok', 'due', 'overdue']);
const DEFAULT_DEFRAG = Object.freeze({ writes: 10, files: 30, bytesPct: 60, alwaysOnBytes: 16384 });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const names = (list) => `${list.slice(0, 3).map((e) => `${e.name}.md`).join(', ')}${list.length > 3 ? ', …' : ''}`;

/**
 * Pure. `entries` are listMemory rows, `state` the scope's .state counters, `caps` memoryCaps()
 * (a caps object without `defrag` falls back to the defaults 10 / 30 / 60 % / 16 384).
 * fresh = no files. overdue = writes at 2× the threshold, any file over the hard cap, or the
 * always-on bytes at 2× their threshold. due = writes ≥ threshold, files ≥ threshold, bytes ≥
 * bytesPct % of maxFilesPerScope × soft cap, any oversized (soft) or fence-less file, or the
 * always-on bytes ≥ `defrag.alwaysOnBytes`.
 * Native rules: every file WITHOUT `paths` is loaded into every agent's context at launch —
 * `alwaysOnBytes` is that cost (the figure the old 4 KB index cap used to bound). A path-scoped
 * file costs nothing until a matching file is read, so it is excluded from it.
 */
export function memoryHealth(entries, state, caps) {
  const list = Array.isArray(entries) ? entries : [];
  const st = { ...EMPTY_STATE, ...(state && typeof state === 'object' ? state : {}) };
  const T = { ...DEFAULT_DEFRAG, ...(caps?.defrag && typeof caps.defrag === 'object' ? caps.defrag : {}) };
  const soft = caps?.softBytesPerFile ?? 8192;
  const hard = caps?.hardBytesPerFile ?? 32768;
  const maxFiles = caps?.maxFilesPerScope ?? 50;
  const size = (e) => Number(e.bytes) || 0;
  const files = list.length;
  const bytes = list.reduce((n, e) => n + size(e), 0);
  const oversized = list.filter((e) => size(e) > soft);
  const overHard = list.filter((e) => size(e) > hard);
  const invalid = list.filter((e) => e.hasFrontmatter === false);
  const alwaysOn = list.filter((e) => !(Array.isArray(e.paths) && e.paths.length));
  const alwaysOnBytes = alwaysOn.reduce((n, e) => n + size(e), 0);
  const budget = maxFiles * soft;
  // Spec §8's threshold is `bytes ≥ bytesPct % of budget`: compare integers, never a rounded
  // percentage (Math.round would turn 59.5 % into a 60 % "due"). `pct` is for the message only.
  const overBudget = budget > 0 && bytes * 100 >= T.bytesPct * budget;
  const pct = budget > 0 ? Math.floor((bytes * 100) / budget) : 0;
  const writes = Number(st.writesSinceDefrag) || 0;
  const reasons = [];
  if (files > 0) {
    if (writes >= T.writes) reasons.push(`${plural(writes, 'memory write')} since the last defragment (due at ${T.writes})`);
    if (files >= T.files) reasons.push(`${plural(files, 'file')} in this scope (due at ${T.files})`);
    if (overBudget) reasons.push(`${pct}% of the scope's byte budget in use (due at ${T.bytesPct}%)`);
    if (oversized.length) reasons.push(`${plural(oversized.length, 'file')} over the ${soft}-byte soft cap: ${names(oversized)}`);
    if (overHard.length) reasons.push(`${plural(overHard.length, 'file')} over the ${hard}-byte hard cap — runs cannot update them: ${names(overHard)}`);
    if (invalid.length) reasons.push(`${plural(invalid.length, 'file')} without frontmatter — added by hand? worca still serves them; a defragment rewrites them: ${names(invalid)}`);
    if (alwaysOnBytes >= T.alwaysOnBytes) reasons.push(`${alwaysOnBytes} bytes of memory load into the context of every agent that mounts this scope (${plural(alwaysOn.length, 'file')} without paths; due at ${T.alwaysOnBytes})`);
  }
  const level = files === 0 ? 'fresh'
    : (writes >= 2 * T.writes || overHard.length || alwaysOnBytes >= 2 * T.alwaysOnBytes) ? 'overdue'
    : reasons.length ? 'due' : 'ok';
  return {
    files, bytes, oversized: oversized.length, overHard: overHard.length, invalidFrontmatter: invalid.length,
    alwaysOnBytes, alwaysOnFiles: alwaysOn.length,
    writesSinceDefrag: writes, lastWriteAt: st.lastWriteAt, lastDefragAt: st.lastDefragAt, lastDefragRunId: st.lastDefragRunId,
    level, reasons,
  };
}

/** Everything a scope view or route needs in one read: the listing, the counters and the health. */
export async function memoryScopeReport(root, scope, caps, { onError } = {}) {
  const entries = await listMemory(root, scope, { onError });
  const state = await readScopeState(root, scope);
  return { scope: scopeKey(scope), entries, state, health: memoryHealth(entries, state, caps) };
}
