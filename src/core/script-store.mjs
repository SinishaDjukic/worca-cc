// src/core/script-store.mjs
// CRUD for USER scripts: <worcaHome()>/scripts/<key>.meta.json + the program
// file the sidecar names (+ an optional <key>.tests.json), layered under the
// read-only built-in scripts/ dir and the plugin layers by script-registry.mjs.
// The sibling of agent-store.mjs: same err.code vocabulary, so ui/server.mjs
// reuses agentErrorStatus. Validation + persistence live here (thin-core
// pattern); HTTP mapping is the route's.
//
// Two rules are this file's own:
//   - `meta.file` is STORE-OWNED. A client-sent `file` is ignored and recomputed
//     from key + runtime, so a sidecar can never name a file the store did not
//     write, and a runtime change renames the program.
//   - Writes are atomic per file and ORDERED source -> cases -> meta (delete
//     runs meta -> cases -> source), so a crash mid-save never leaves a loadable
//     meta pointing at a program that is not there.

import { mkdir, open, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { loadScriptRegistry, userScriptsDir } from './script-registry.mjs';
import { loadAgentRegistry } from './agent-registry.mjs';
import { AGENT_KEY_RE } from './agent-store.mjs';
import { listWorkflows } from './workflows.mjs';
import { normalizeScriptMeta, validateScriptMetaV2 } from '../shared/graph/script-meta.mjs';
import { normalizeCases } from '../shared/graph/script-cases.mjs';
import { AWAIT_PORT } from '../shared/graph/constants.mjs';   // the synthesized gate port is wirable

export { userScriptsDir };   // single source: the registry's layer resolver

/** Keys are ONE namespace with agents (base D16), so the regex is the agents'. */
export const SCRIPT_KEY_RE = AGENT_KEY_RE;
/** `#scripts/new` is the create route (C1), and `bench` / `runtimes` are the
 *  literal segments under `/api/scripts/` — a script keyed `runtimes` saves but
 *  its own GET answers with the runtime probe, so it can never be opened.
 *  Matched case-INSENSITIVELY: express routing ignores case by default, so
 *  `Runtimes` reaches the probe route exactly as `runtimes` does. */
export const RESERVED_SCRIPT_KEYS = Object.freeze(['new', 'bench', 'runtimes']);
/** Windows resolves these stems as devices even with an extension (`con.mjs` IS
 *  the console), so a script keyed like one writes to the device on a Windows
 *  host and can never be read back. */
const WIN_DEVICE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export const MAX_SOURCE_BYTES = 262144;

const RENAME_RETRIES = 3;
const RENAME_DELAY_MS = 50;

function err(message, code) { return Object.assign(new Error(message), { code }); }
const sourceTooBig = (key) => `the program of "${key}" is over ${MAX_SOURCE_BYTES} bytes and was read short `
  + '— shrink it on disk before saving it from worca';
const sourceNotRead = (key) => `the program of "${key}" could not be read `
  + '— fix it on disk before saving it from worca';
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const byteLength = (s) => Buffer.byteLength(String(s ?? ''), 'utf8');
const delay = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * An explicit `null` in a sent meta means "remove this key". The update path
 * merges the sent meta OVER the stored one, so without this a form could edit
 * `verdict`, `exitCodes`, `command` or the two port shapes but never clear
 * them — and a shell script switched to node would keep a `command` the
 * validator refuses. The sidecar validator itself reads null as a bad value, so
 * the keys are dropped BEFORE it runs. Mutates and returns `raw`. The bench
 * uses it on a draft meta, which comes off the very same form.
 */
export function stripNullKeys(raw) {
  for (const k of Object.keys(raw)) if (raw[k] === null) delete raw[k];
  return raw;
}

// Line endings are the STORE's business, not the editor's: a <textarea> hands
// back LF whatever it was given (the HTML value API normalises CRLF away), so
// the page can never send a CR. cmd.exe wants CRLF in a .cmd (a lone LF breaks
// multi-line constructs on older Windows), and a CR inside a .sh is a syntax
// error to /bin/sh — each file gets its own platform's ending on every write.
const toCrlf = (s) => String(s).replace(/\r\n|\r|\n/g, '\r\n');
const toLf = (s) => String(s).replace(/\r\n|\r/g, '\n');
/** A program's text as it must sit ON DISK: CRLF for a shell script's win32
 *  variant, LF for its default one, untouched for every other runtime. The
 *  bench writes its draft files through this too. */
export function programText(runtime, text, { win32 = false } = {}) {
  if (runtime !== 'shell') return String(text);
  return win32 ? toCrlf(text) : toLf(text);
}

/** The writable user layer. null only when the home cannot be resolved. */
function requireUserDir() {
  const dir = userScriptsDir();
  if (!dir) throw err('cannot resolve the user scripts directory (WORCA_HOME unset?)', 'BAD_REQUEST');
  return dir;
}

/** The merged registry as the engine sees it (agent keys already dropped, D16). */
// A registry is a PLAIN object, so `reg[key]` reaches Object.prototype: `constructor`,
// `toString`, `valueOf` and `hasOwnProperty` all pass SCRIPT_KEY_RE (it is the agent
// key shape, D16) and answer with a Function every guard below then reads as an
// existing script — a 200 where the contract says 404, and a write on the PUT paths.
const pick = (reg, key) => (Object.hasOwn(reg, key) ? reg[key] : null);
function registryNow() {
  return loadScriptRegistry({ agentKeys: Object.keys(loadAgentRegistry()) });
}

/** Every script key ON DISK, including one an agent key would shadow — the
 *  DUPLICATE guard must see it, or "create" would silently write a dead file. */
function everyScriptKey() {
  return loadScriptRegistry({ agentKeys: null });
}

/** The program filename the store owns for a runtime. */
export function sourceFileFor(key, runtime, { win32 = false } = {}) {
  if (runtime === 'node') return `${key}.mjs`;
  if (runtime === 'python') return `${key}.py`;                 // P2 ships the runtime; the name is fixed now
  if (runtime === 'shell') return win32 ? `${key}.cmd` : `${key}.sh`;
  return null;
}

const casesFileFor = (key) => `${key}.tests.json`;

/** The `file` field's two platform entries, whatever shape it has. */
function platformNames(file) {
  if (typeof file === 'string') return { def: file, win32: null };
  if (isObject(file)) return { def: file.default ?? null, win32: file.win32 ?? null };
  return { def: null, win32: null };
}

/**
 * Write one file atomically: a sibling temp + rename. On Windows `rename` is
 * MoveFileEx(REPLACE_EXISTING), which an antivirus scanner or a just-closed
 * handle can answer with EPERM/EBUSY for a few milliseconds — retry before
 * surfacing it (§10).
 */
let tmpSeq = 0;
async function writeAtomic(path, text) {
  // The counter, not the pid alone: two writes of ONE file inside this process
  // would otherwise share the temp path, and the slower rename lands on a name
  // the faster one already moved (ENOENT).
  tmpSeq += 1;
  const tmp = `${path}.tmp-${process.pid}-${tmpSeq}`;
  await writeFile(tmp, text, 'utf8');
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(tmp, path);
      return;
    } catch (e) {
      if ((e?.code === 'EPERM' || e?.code === 'EBUSY') && attempt < RENAME_RETRIES) {
        await delay(RENAME_DELAY_MS);
        continue;
      }
      await rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
  }
}

// `recursive` so a DIRECTORY sitting where a program (or the cases file) belongs
// cannot throw here: deleteScript removes the meta first, so a throw on the
// program left the script gone from worca, the junk on disk, and the retry a 404.
const removeFile = (path) => rm(path, { force: true, recursive: true, maxRetries: RENAME_RETRIES });

/**
 * One script's files are written (or removed) one save at a time. Two saves of
 * the SAME key in flight at once — a double-clicked Save, a save landing on a
 * delete — otherwise interleave their source/cases/meta writes and leave one
 * writer's program under the other's meta, while both responses report their own
 * bytes. Keyed by `<dir>/<key>`, so different scripts still save in parallel.
 */
const writing = new Map();
function underKeyLock(lockKey, fn) {
  const done = (writing.get(lockKey) || Promise.resolve()).then(fn, fn);
  const settled = done.then(() => {}, () => {});
  writing.set(lockKey, settled);
  settled.then(() => { if (writing.get(lockKey) === settled) writing.delete(lockKey); });
  return done;
}

/** 'ui' | 'cli' | 'ask:<threadId>' (W19). Absent -> 'ui'. */
function byStamp(by) {
  const v = typeof by === 'string' && by.trim() ? by.trim() : 'ui';
  if (v === 'ui' || v === 'cli' || /^ask:[A-Za-z0-9_-]{1,64}$/.test(v)) return v;
  throw err('by must be "ui", "cli" or "ask:<threadId>"', 'BAD_REQUEST');
}

/** Read + normalize one `<key>.tests.json`. A missing or unreadable file is no
 *  cases; an invalid ROW is dropped by the normalizer (the store's write path is
 *  the hard gate, this one only reads). */
async function readCasesAt(dir, key, meta, shipped) {
  if (!dir) return [];
  let raw;
  try { raw = JSON.parse(await readFile(join(dir, casesFileFor(key)), 'utf8')); } catch { return []; }
  // lenient: a case must survive an edit to its script's ports and params (see normalizeCases).
  return normalizeCases(raw, meta, { shipped, lenient: true }).cases;
}

/** The script's own cases + the W18 user overlay (empty on the user layer). */
async function bothCaseLists(meta) {
  const shipped = meta.origin !== 'user';
  const own = await readCasesAt(meta.scriptsDir, meta.key, meta, shipped);
  const overlay = shipped ? await readCasesAt(userScriptsDir(), meta.key, meta, false) : [];
  return { own, overlay };
}

/** Merged registry list, each meta stamped with how many cases it has. */
export async function listScripts() {
  const out = [];
  for (const meta of Object.values(registryNow())) {
    const { own, overlay } = await bothCaseLists(meta);
    out.push({ ...meta, caseCount: own.length + overlay.length });
  }
  return out;
}

/**
 * One program file, read at most MAX_SOURCE_BYTES + 1 bytes deep. `readFile`
 * pulled a hand-placed 600 MB program into the process whole — and past ~512 MiB
 * it throws "Invalid string length", which the catch then read as "no program",
 * after which a meta-only save of a shell script DROPPED the user's file. The cut
 * is in BYTES: `String.slice` counts UTF-16 units, so a multi-byte program came
 * back whole and over the cap. TextDecoder in stream mode keeps a partial
 * trailing sequence to itself instead of turning it into U+FFFD, and `ignoreBOM`
 * leaves a byte-order mark in the text the page saves back.
 * A read that FAILED is not "no program": ENOENT is (the file is gone), but a
 * permission accident, EMFILE under load or a directory in the program's place
 * would otherwise hand the page an empty Source tab, and the next save drops
 * `file` and deletes the user's program — `unreadable` blocks that save.
 * @returns {Promise<{text: string, truncated: boolean, unreadable: boolean}>}
 */
async function readProgram(file) {
  let fh = null;
  try {
    fh = await open(file, 'r');
    const buf = Buffer.allocUnsafe(MAX_SOURCE_BYTES + 1);
    let filled = 0;
    while (filled < buf.length) {
      const { bytesRead } = await fh.read(buf, filled, buf.length - filled, filled);
      if (!bytesRead) break;
      filled += bytesRead;
    }
    const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
    const truncated = filled > MAX_SOURCE_BYTES;
    // Stream mode ONLY when the bytes were cut: it holds a partial trailing
    // sequence back instead of emitting U+FFFD. On a whole file that same hold
    // would DELETE the last character of a program that is not valid UTF-8 (a
    // latin-1 `.sh`), silently, with `truncated` false — and the page saves back
    // the text it was handed.
    const text = decoder.decode(buf.subarray(0, Math.min(filled, MAX_SOURCE_BYTES)), { stream: truncated });
    return { text, truncated, unreadable: false };
  } catch (e) {
    return { text: '', truncated: false, unreadable: e?.code !== 'ENOENT' };
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

/** Full read: meta + both program files + both case lists, or null. */
export async function readScript(key) {
  if (!SCRIPT_KEY_RE.test(String(key || ''))) return null;
  const meta = pick(registryNow(), key);
  if (!meta) return null;
  const { def, win32 } = platformNames(meta.file);
  const dir = meta.scriptsDir;
  // Read by NAME, not by the host-resolved scriptPath: `source` must be the
  // DEFAULT entry and `sourceWin32` the win32 one on every host, or the Source
  // tab would show the .cmd to a Windows user and call it the .sh.
  let source = '';
  let sourceTruncated = false;
  let sourceUnreadable = false;
  if (def) {
    const read = await readProgram(join(dir, def));
    source = read.text;
    sourceTruncated = read.truncated;
    sourceUnreadable = read.unreadable;
  }
  let sourceWin32 = '';
  if (win32 && win32 !== def) {
    const read = await readProgram(join(dir, win32));
    sourceWin32 = read.text;
    // The .cmd rides the same cap, and the same flags: the page saves back the pair
    // it was handed, so a short win32 variant must block the save just as loudly.
    if (read.truncated) sourceTruncated = true;
    if (read.unreadable) sourceUnreadable = true;
  }
  const { own, overlay } = await bothCaseLists(meta);
  return {
    meta,
    source,
    sourceWin32,
    sourcePath: meta.scriptPath || null,
    sourceTruncated,
    sourceUnreadable,
    cases: own,
    userCases: overlay,
    casesWritable: true,
  };
}

/** The key shapes no script may take, whatever layer it would land in: the
 *  reserved route segments in ANY case, and the Windows device stems. Exported
 *  because the bench's draft guard must refuse exactly what a Save refuses (C29)
 *  — a second copy of the list is how the two drifted apart in the first place. */
export function assertKeyAllowed(key) {
  if (RESERVED_SCRIPT_KEYS.includes(key.toLowerCase())) {
    throw err(`"${key}" is a reserved script key — pick another name`, 'BAD_REQUEST');
  }
  if (WIN_DEVICE_RE.test(key)) {
    throw err(`"${key}" is a reserved device name on Windows — pick another key`, 'BAD_REQUEST');
  }
}

/** BUILTIN / DUPLICATE / PLUGIN for a key that must be FREE (create, duplicate). */
function assertKeyFree(key) {
  const all = everyScriptKey();
  // macOS and Windows filesystems are case-INSENSITIVE (§10): `lint` and `Lint`
  // are two registry keys but ONE `<key>.meta.json` and ONE program file, so a
  // key differing only in case would overwrite the other script without a word.
  const twin = Object.keys(all).find((k) => k !== key && k.toLowerCase() === key.toLowerCase());
  if (twin) {
    throw err(`a script "${twin}" already exists — script keys differ only in case, and one file holds both `
      + 'on macOS and Windows', 'DUPLICATE');
  }
  const existing = pick(all, key);
  if (existing) {
    if (existing.origin === 'builtin') throw err(`"${key}" is a built-in script — duplicate it under a new name instead`, 'BUILTIN');
    const origin = String(existing.origin || '');
    if (origin.startsWith('plugin:')) {
      throw err(`script "${key}" is shipped by plugin "${origin.slice('plugin:'.length)}" — pick another key`, 'DUPLICATE');
    }
    throw err(`a user script "${key}" already exists`, 'DUPLICATE');
  }
  if (pick(loadAgentRegistry(), key)) {
    throw err(`"${key}" is an agent key — scripts and agents share one namespace, so pick another key`, 'DUPLICATE');
  }
}

/** NOT_FOUND / BUILTIN / PLUGIN for a key that must be WRITABLE (update, delete). */
function requireUserScript(key, verb) {
  if (!SCRIPT_KEY_RE.test(String(key || ''))) throw err(`script not found: ${key}`, 'NOT_FOUND');
  const existing = pick(registryNow(), key);
  if (existing && existing.origin === 'builtin') {
    throw err(verb === 'delete'
      ? `"${key}" is a built-in script and cannot be deleted — duplicate it under a new name instead`
      : `"${key}" is a built-in script — duplicate it instead of editing`, 'BUILTIN');
  }
  const origin = String(existing?.origin || '');
  if (origin.startsWith('plugin:')) {
    throw err(`script "${key}" is managed by plugin "${origin.slice('plugin:'.length)}" — disable or uninstall the plugin instead`, 'PLUGIN');
  }
  if (!existing) throw err(`script not found: ${key}`, 'NOT_FOUND');
  return existing;
}

/**
 * The store-owned `file` + the source rules (spec §3.1). Returns the names to
 * write; `raw.file` is REPLACED here on every path.
 * @returns {{def: string|null, win32: string|null, source: string, sourceWin32: string}}
 */
function applyFileRules(raw, key, source, sourceWin32) {
  const src = typeof source === 'string' ? source : '';
  const win = typeof sourceWin32 === 'string' ? sourceWin32 : '';
  if (byteLength(src) > MAX_SOURCE_BYTES) throw err(`source is over ${MAX_SOURCE_BYTES} bytes`, 'BAD_REQUEST');
  if (byteLength(win) > MAX_SOURCE_BYTES) throw err(`sourceWin32 is over ${MAX_SOURCE_BYTES} bytes`, 'BAD_REQUEST');
  const runtime = raw.runtime;
  if (win && runtime !== 'shell') throw err('sourceWin32 is only legal on the shell runtime', 'BAD_REQUEST');
  if (runtime === 'node' || runtime === 'python') {
    if (!src.trim()) throw err(`runtime "${runtime}" needs a program — the source cannot be empty`, 'BAD_REQUEST');
    raw.file = sourceFileFor(key, runtime);
    return { def: raw.file, win32: null, source: src, sourceWin32: '' };
  }
  if (runtime === 'shell') {
    if (win.trim() && !src.trim()) throw err('sourceWin32 needs a shell file — add the default source too', 'BAD_REQUEST');
    if (!src.trim()) { raw.file = null; return { def: null, win32: null, source: '', sourceWin32: '' }; }
    const def = sourceFileFor(key, 'shell');
    const w = win.trim() ? sourceFileFor(key, 'shell', { win32: true }) : null;
    raw.file = w ? { default: def, win32: w } : def;
    return { def, win32: w, source: programText('shell', src), sourceWin32: w ? programText('shell', win, { win32: true }) : '' };
  }
  raw.file = null;                                   // unknown runtime: the validator names it
  return { def: null, win32: null, source: src, sourceWin32: '' };
}

/** Validate a prepared raw sidecar exactly as the plugin validator does. */
function gate(raw) {
  const issues = validateScriptMetaV2(raw).errors;
  if (issues.length) throw err(issues.join('; '), 'BAD_REQUEST');
  const { meta } = normalizeScriptMeta(raw, { warn: () => {} });
  if (!meta) throw err('invalid script metadata', 'BAD_REQUEST');
  return meta;
}

/**
 * Saved-template wires that the NEW port set of `key` no longer satisfies —
 * `["<workflow name> (<nodeId>.<portId>)", …]`. NOT refused (no saved template
 * can reference a port before it exists); the RUN refuses, this is the editor's
 * heads-up. Agent parity (agent-store.mjs#stalePortRefs), with `kind:'script'`
 * and the `ports: "config"` scripts skipped: their ports live on the NODE, so a
 * sidecar edit cannot stale them.
 */
function staleScriptRefs(workflows, key, meta) {
  if (meta.ports === 'config') return [];
  const outs = new Set((meta.outputs || []).map((p) => p.id));
  const ins = new Set([...(meta.inputs || []).map((p) => p.id), AWAIT_PORT.id]);
  const hits = [];
  for (const wf of workflows) {
    const mine = new Set((wf.nodes || []).filter((n) => n && n.kind === 'script' && n.key === key).map((n) => n.id));
    if (!mine.size) continue;
    const label = wf.name || wf.id;
    for (const w of wf.wires || []) {
      if (mine.has(w?.from?.node) && !outs.has(w.from.port)) hits.push(`${label} (${w.from.node}.${w.from.port})`);
      if (mine.has(w?.to?.node) && !ins.has(w.to.port)) hits.push(`${label} (${w.to.node}.${w.to.port})`);
    }
  }
  return hits;
}

/** Write one script's files in the crash-safe order: source -> cases -> meta. */
async function persist(dir, key, meta, files, { cases = null, drop = [] } = {}) {
  await mkdir(dir, { recursive: true });
  return underKeyLock(join(dir, key), async () => {
    if (files.def) await writeAtomic(join(dir, files.def), files.source);
    if (files.win32) await writeAtomic(join(dir, files.win32), files.sourceWin32);
    if (cases && cases.length) await writeAtomic(join(dir, casesFileFor(key)), JSON.stringify({ version: 1, cases }, null, 2) + '\n');
    await writeAtomic(join(dir, `${key}.meta.json`), JSON.stringify(meta, null, 2) + '\n');
    // Only AFTER the meta names the new program: a file the sidecar no longer uses
    // (a runtime change, a dropped win32 variant) is dead weight, never a gap.
    for (const name of drop) if (name) await removeFile(join(dir, name));
  });
}

/** Create a user script. `meta.key` is required and must be free in EVERY layer. */
export async function createScript({ meta: rawMeta, source, sourceWin32, by } = {}) {
  const raw = stripNullKeys(isObject(rawMeta) ? { ...rawMeta } : {});
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!SCRIPT_KEY_RE.test(key)) throw err('script key must be alphanumeric (letters, digits, - or _)', 'BAD_REQUEST');
  assertKeyAllowed(key);
  const stamp = byStamp(by);
  assertKeyFree(key);
  raw.key = key;
  if (!Number.isFinite(Number(raw.order))) raw.order = 99;      // sort after the built-ins
  raw.createdBy = stamp;
  raw.updatedBy = stamp;
  const files = applyFileRules(raw, key, source, sourceWin32);
  const meta = gate(raw);
  await persist(requireUserDir(), key, meta, files);
  return { meta: { ...meta, origin: 'user' }, source: files.source, sourceWin32: files.sourceWin32 };
}

/** Update a user script (meta and/or either source). Built-ins -> BUILTIN (409). */
export async function updateScript(key, { meta: rawMeta, source, sourceWin32, by } = {}) {
  const existing = requireUserScript(key, 'update');
  const stamp = byStamp(by);
  const current = await readScript(key);
  // A program the READ had to cut at the cap (only a hand-edited file can be over
  // it) must never be written back: the page saves the source it was handed, so
  // even renaming the script would drop everything past MAX_SOURCE_BYTES.
  if (current.sourceTruncated) throw err(sourceTooBig(key), 'BAD_REQUEST');
  if (current.sourceUnreadable) throw err(sourceNotRead(key), 'BAD_REQUEST');
  // The COMPUTED fields the registry stamps are not part of a sidecar;
  // normalizeScriptMeta's fixed key set drops them, but spreading them into the
  // raw would let a client's `scriptPath` reach the validator.
  const base = { ...existing };
  for (const f of ['origin', 'scriptPath', 'scriptsDir', 'commandResolved', 'frontmatter']) delete base[f];
  // Sent keys win; a sent `null` REMOVES the stored key (see stripNullKeys).
  const raw = stripNullKeys({ ...base, ...(isObject(rawMeta) ? rawMeta : {}) });
  raw.key = key;                                                // key immutable on update
  raw.createdBy = existing.createdBy || stamp;
  raw.updatedBy = stamp;
  if (!Number.isFinite(Number(raw.order))) raw.order = existing.order;
  // `undefined` keeps what is on disk; '' is a deliberate "no file" (an inline
  // shell command, or dropping the Windows variant).
  const nextSource = typeof source === 'string' ? source : current.source;
  const nextWin = typeof sourceWin32 === 'string' ? sourceWin32 : current.sourceWin32;
  const files = applyFileRules(raw, key, nextSource, nextWin);
  const meta = gate(raw);
  const was = platformNames(existing.file);
  const drop = [was.def, was.win32].filter((n) => n && n !== files.def && n !== files.win32);
  await persist(requireUserDir(), key, meta, files, { drop });
  const stale = staleScriptRefs(await listWorkflows({ includeArchived: true }), key, meta);
  const warnings = stale.length ? [`saved pipelines reference a removed port: ${stale.join(', ')}`] : [];
  return { meta: { ...meta, origin: 'user' }, source: files.source, sourceWin32: files.sourceWin32, warnings };
}

/** Delete a user script; REFERENCED (409) while a saved workflow places the key. */
export async function deleteScript(key) {
  const existing = requireUserScript(key, 'delete');
  const refs = (await listWorkflows({ includeArchived: true }))
    .filter((wf) => (wf.nodes || []).some((n) => n && n.kind === 'script' && n.key === key))
    .map((wf) => wf.name || wf.id);
  if (refs.length) {
    throw err(`script "${key}" is used by saved workflow(s): ${refs.join(', ')} `
      + '— delete or edit those first (archived rows count)', 'REFERENCED');
  }
  const dir = requireUserDir();
  const { def, win32 } = platformNames(existing.file);
  await underKeyLock(join(dir, key), async () => {
    // meta FIRST: after this line the registry no longer lists the script, so a
    // crash leaves orphan files, never a sidecar naming a program that is gone.
    await removeFile(join(dir, `${key}.meta.json`));
    await removeFile(join(dir, casesFileFor(key)));
    for (const name of [def, win32]) if (name) await removeFile(join(dir, name));
  });
  return { ok: true };
}

/** Copy ANY layer's script into the user layer under `newKey`, cases included. */
export async function duplicateScript(key, newKey, by) {
  const target = typeof newKey === 'string' ? newKey.trim() : '';
  if (!SCRIPT_KEY_RE.test(target)) throw err('script key must be alphanumeric (letters, digits, - or _)', 'BAD_REQUEST');
  assertKeyAllowed(target);
  const stamp = byStamp(by);
  const src = await readScript(key);
  if (!src) throw err(`script not found: ${key}`, 'NOT_FOUND');
  if (src.sourceTruncated) throw err(sourceTooBig(key), 'BAD_REQUEST');
  if (src.sourceUnreadable) throw err(sourceNotRead(key), 'BAD_REQUEST');
  assertKeyFree(target);
  const raw = { ...src.meta };
  for (const f of ['origin', 'scriptPath', 'scriptsDir', 'commandResolved', 'portSummary']) delete raw[f];
  raw.key = target;
  raw.createdBy = stamp;
  raw.updatedBy = stamp;
  const files = applyFileRules(raw, target, src.source, src.sourceWin32);
  const meta = gate(raw);
  // The script's own cases plus the user's overlay for it; an overlay id that
  // collides with a shipped one loses (the shipped case is the original).
  const taken = new Set(src.cases.map((c) => c.id));
  const cases = [...src.cases, ...src.userCases.filter((c) => !taken.has(c.id))];
  await persist(requireUserDir(), target, meta, files, { cases });
  return { meta: { ...meta, origin: 'user' }, source: files.source, sourceWin32: files.sourceWin32 };
}

/**
 * Write a script's cases. ALWAYS the user layer: for a user script that is its
 * own file, for a built-in or plugin key it is the W18 overlay — a
 * `<key>.tests.json` with no meta beside it, which the registry's *.meta.json
 * scan ignores by construction.
 * @param {string} key @param {Array|object} rawCases the array, or a { version, cases } document
 */
export async function writeCases(key, rawCases) {
  if (!SCRIPT_KEY_RE.test(String(key || ''))) throw err(`script not found: ${key}`, 'NOT_FOUND');
  const meta = pick(registryNow(), key);
  if (!meta) throw err(`script not found: ${key}`, 'NOT_FOUND');
  const doc = Array.isArray(rawCases) ? { version: 1, cases: rawCases } : rawCases;
  if (!isObject(doc) || !Array.isArray(doc.cases)) throw err('cases must be an array', 'BAD_REQUEST');
  const { cases, errors } = normalizeCases({ version: 1, cases: doc.cases }, meta, { shipped: false });
  if (errors.length) throw err(errors.join('; '), 'BAD_REQUEST');
  const dir = requireUserDir();
  await mkdir(dir, { recursive: true });
  const path = join(dir, casesFileFor(key));
  await underKeyLock(join(dir, key), async () => {
    if (!cases.length) await removeFile(path);
    else await writeAtomic(path, JSON.stringify({ version: 1, cases }, null, 2) + '\n');
  });
  return { cases };
}
