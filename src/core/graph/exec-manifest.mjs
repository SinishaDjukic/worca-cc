// src/core/graph/exec-manifest.mjs
//
// What one agent spawn ran with, and what it touched outside its checkout — written to the run
// directory so "why did this run differ" becomes a diff of two lines (E10), and a hidden data
// channel between nodes (a file copied from another session's scratch tree, 6c9cf587) is on record
// (E9). Best effort throughout: nothing here can fail an execution.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { isWithin } from '../fs-scope.mjs';

/** One line per spawn attempt, in the pipeline directory. */
export const EXEC_MANIFEST_FILE = 'executions.ndjson';
const MAX_OUTSIDE = 200;
const MAX_SEEN = 1000;          // paths watched per spawn (expected ones included), before the split
const MAX_RECORD_PATHS = 50;    // notable paths a scope record carries onto run state (the manifest has them all)
const MAX_MEMORY_FILES = 500;

const sha = (text) => (text == null ? null : createHash('sha256').update(String(text)).digest('hex'));
const fileSha = (p) => { try { return sha(readFileSync(p)); } catch { return null; } };

/** Every file under `dir` (relative path → sha256), bounded. The memory rules copy a node loaded. */
function treeHashes(dir) {
  const out = {};
  if (typeof dir !== 'string' || !dir) return out;
  const walk = (d) => {
    let names = [];
    try { names = readdirSync(d); } catch { return; }
    for (const n of names.sort()) {
      if (Object.keys(out).length >= MAX_MEMORY_FILES) return;
      const p = join(d, n);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out[relative(dir, p).split('\\').join('/')] = fileSha(p);
    }
  };
  walk(dir);
  return out;
}

/** The memory a node loaded: `{mode, set, files:[{path, sha256}]}`. The frozen set the run hands the
 *  node (`ctx.memoryManifest`, memory-sync frozenManifest: role notes included) wins; without one, the
 *  rules copy under the cwd is listed. `set` = sha256 over the sorted lines `${path} ${sha256}\n`, the
 *  same hash the step record and the run's memory ledger use, so one run never shows two set hashes. */
function memoryRecord(ctx) {
  const mode = typeof ctx?.memoryMode === 'string' ? ctx.memoryMode : (ctx?.memoryRules ? 'frozen' : 'off');
  const m = ctx?.memoryManifest;
  if (m && Array.isArray(m.files)) {
    return { mode, set: m.set ?? null, files: m.files.map(({ path, sha256 }) => ({ path, sha256 })) };
  }
  const tree = treeHashes(ctx?.memoryRules);
  const files = Object.keys(tree).sort().map((path) => ({ path, sha256: tree[path] }));
  return { mode, set: sha(files.map((f) => `${f.path} ${f.sha256}\n`).join('')), files };
}

// System locations a shell command names all the time (interpreters, devices): not a data channel.
const SYSTEM_PREFIXES = ['/dev/', '/usr/', '/bin/', '/sbin/', '/opt/homebrew/', '/System/', '/proc/', '/Library/Developer/'];
// An absolute POSIX path in a shell command, after a space, a quote, `=` or `(`.
const ABS_IN_COMMAND = /(?:^|[\s'"=(:])(\/(?:[\w.@+~-]+\/)*[\w.@+~-]+)/g;

// Whether `/<segment>` exists, cached per segment: a word in a command whose first segment is no
// directory on this machine (`/files`, `/api/runs/x`: a route, a URL path, a grep pattern) is no file.
const topExists = new Map();
function topSegmentExists(p) {
  const top = p.split('/')[1] || '';
  if (!top) return false;
  if (!topExists.has(top)) topExists.set(top, existsSync('/' + top));
  return topExists.get(top);
}

/** A Bash command that only lists folders (`ls -la <dir>`): one `ls`, no other command, redirect or expansion.
 *  A listing shows names only; anything else on a folder (grep -r, find, cp -r) reads what is inside it. */
const PLAIN_LS = /^[ \t]*ls(?:[ \t]+[^\s;&|`$()<>\\]+)*[ \t]*$/;   // [ \t], not \s: a line break starts a new command

/** Whether a word a shell command names is a fragment, not a plausible file: a match cut short by a shell
 *  token (`/tmp/o.` from `> /tmp/o.$$`), or no longer than its first segment plus one character (`/tmp/o`). */
function isFragment(p) {
  if (p.endsWith('/.') || p.endsWith('/..')) return false;   // `cp -a <dir>/. .`: a directory, not a fragment
  if (p.endsWith('.')) return true;
  const top = p.split('/')[1] || '';
  return p.length <= top.length + 3;
}

/** The paths a tool call names, by tool: file tools' path fields, and absolute paths in a Bash command
 *  (only those whose first segment exists on disk; `fragment` marks a word that is no plausible file). */
function pathsOfCall(call) {
  const input = call?.input && typeof call.input === 'object' ? call.input : {};
  const out = [];
  const name = String(call?.name || '');
  for (const k of ['file_path', 'notebook_path', 'path']) if (typeof input[k] === 'string' && input[k]) out.push({ raw: input[k], fragment: false, listing: name === 'LS' });
  if (typeof input.command === 'string') {
    const listing = PLAIN_LS.test(input.command);
    for (const m of input.command.matchAll(ABS_IN_COMMAND)) if (topSegmentExists(m[1])) out.push({ raw: m[1], fragment: isFragment(m[1]), listing });
  }
  return out;
}

/** The files an execution owns wherever worca put them (a plan port lives in the project store):
 *  its bound inputs, allocated outputs, verdict, questions file and slicing outline. Exact paths only. */
function ownedFiles(ctx) {
  const tokens = [...Object.values(ctx?.bindings || {}), ...Object.values(ctx?.outputs || {}), ctx?.verdict]
    .flatMap((t) => (Array.isArray(t) ? t : [t]));
  return new Set([...tokens.map((t) => t?.path), ctx?.questionsFile, ctx?.shapeSlicing?.file]
    .filter((p) => typeof p === 'string' && p).map((p) => resolve(p)));
}

const uniq = (list) => [...new Set(list.filter((p) => typeof p === 'string' && p).map((p) => resolve(p)))];
const realOr = (p) => { try { return realpathSync(p); } catch { return p; } };
/** `p`'s segments below `root`, or null when `p` is not inside it. */
const segsUnder = (p, root) => (isWithin(p, root) && p !== root ? relative(root, p).split(sep) : null);

/** This run's ids, as they show up in scratch file names: the pipeline id, the run root's folder name and
 *  the pipeline id's trailing hex id (`…-8c0801a5`). Short words are no id. */
function runIds(ctx) {
  const pipelineDir = ctx?.runCtx?.pipelineDir || ctx?.pipelineDir;
  const names = [ctx?.pipelineId, pipelineDir && basename(pipelineDir), ctx?.runRoot && basename(ctx.runRoot)]
    .filter((n) => typeof n === 'string' && n);
  const hex = names.map((n) => /-([0-9a-f]{8})$/.exec(n)?.[1]).filter(Boolean);
  return [...new Set([...names, ...hex])].filter((id) => id.length >= 6);
}

/** The places a classification needs, resolved once per watch. */
function scopePlaces(ctx) {
  const pipelineDir = ctx?.runCtx?.pipelineDir || ctx?.pipelineDir;
  const tmps = uniq(['/tmp', '/private/tmp', tmpdir(), realOr(tmpdir())]);
  const claudeDirs = uniq([join(homedir(), '.claude'), process.env.CLAUDE_CONFIG_DIR]).map((d) => join(d, 'projects'));
  const runRoot = typeof ctx?.runRoot === 'string' && ctx.runRoot ? resolve(ctx.runRoot) : null;
  const runsDirs = uniq([runRoot && basename(dirname(runRoot)) === 'runs' ? dirname(runRoot) : null, join(homedir(), '.worca-cc', 'runs')]);
  // <store>/<project>/pipelines/<this run>: the project's store dir holds this run's plan ports.
  const pipe = typeof pipelineDir === 'string' && pipelineDir ? resolve(pipelineDir) : null;
  const storeDir = pipe && basename(dirname(pipe)) === 'pipelines' ? dirname(dirname(pipe)) : null;
  return { tmps, claudeDirs, runRoot, runsDirs, pipe, storeDir, ids: runIds(ctx) };
}

/**
 * What one outside path is: `{ why }` for an expected one (this run's own scratch, its own Claude session,
 * a folder holding its own files, a word that is no file), `{ cross: true }` for another run's or another
 * session's files (the data channel E9 exists for, 6c9cf587), `{}` for any other notable path.
 * The cross checks run first, so no exemption can hide another run's or session's files.
 */
function classify(p, { fragment, listing, sessionId, places, ancestors }) {
  const { tmps, claudeDirs, runRoot, runsDirs, pipe, storeDir, ids } = places;
  // <tmp>/claude-<uid>/<cwd slug>/<session>/…: Claude Code's scratch, one folder per session.
  for (const t of tmps) {
    const segs = segsUnder(p, t);
    if (segs && /^claude-\d+$/.test(segs[0]) && segs.length >= 3) return sessionId && segs[2] === sessionId ? { why: 'own-scratch' } : { cross: true };
  }
  // ~/.claude/projects/<cwd slug>/<session>[.jsonl]/…: the session's transcript and its tool-results spill files.
  // <slug>/memory is Claude Code's per-project memory, no session: plain notable.
  for (const d of claudeDirs) {
    const segs = segsUnder(p, d);
    if (segs && segs.length >= 2 && segs[1] === 'memory') return {};
    if (segs && segs.length >= 2) return sessionId && (segs[1] === sessionId || segs[1] === `${sessionId}.jsonl`) ? { why: 'own-session' } : { cross: true };
  }
  for (const d of runsDirs) {
    const segs = segsUnder(p, d);
    if (segs && !(runRoot && join(d, segs[0]) === runRoot)) return { cross: true };
  }
  const pipes = storeDir ? join(storeDir, 'pipelines') : null;
  if (pipes) {
    const segs = segsUnder(p, pipes);
    if (segs && !(pipe && join(pipes, segs[0]) === pipe)) return { cross: true };
  }
  // A folder above an owned file: expected for a plain listing (names only). Any other tool on it (Grep, Glob,
  // grep -r, find, cp -r) reads what is inside, so only folders inside the project's store dir that hold no
  // runs or pipelines (its `plans`, `reviews`) stay expected then.
  if (ancestors.has(p)) {
    const holdsRuns = runsDirs.some((d) => isWithin(d, p)) || (pipes && isWithin(pipes, p));
    if (listing || (storeDir && p !== storeDir && isWithin(p, storeDir) && !holdsRuns)) return { why: 'ancestor' };
    if (holdsRuns) return { cross: true };   // a recursive read over every run under it
  }
  if (fragment) return { why: 'fragment' };
  for (const t of tmps) {
    const segs = segsUnder(p, t);
    if (segs && ids.some((id) => segs.join('/').includes(id))) return { why: 'run-tmp' };
  }
  return {};
}

/** Every folder above the given paths (a listing of one shows nothing but names of its own files). */
function ancestorsOf(paths) {
  const out = new Set();
  for (const p of paths) for (let d = dirname(p); !out.has(d); d = dirname(d)) { out.add(d); if (dirname(d) === d) break; }
  return out;
}

/**
 * Collects, from a spawn's `tool` events, the absolute paths an agent read or wrote outside the
 * places it owns (its cwd, the run root, the pipeline dir, its memory mount, workspace members, and its
 * own port files — see ownedFiles). Relative paths resolve against the cwd and are therefore inside it.
 * `result({ sessionId })` splits them at the end of the spawn, once the session id is known:
 * `notable` (`{path, tool, cross?}`) and `expected` (`{path, tool, why}`; see classify).
 */
export function createScopeWatch(ctx) {
  const cwd = ctx?.runRoot || ctx?.projectDir || process.cwd();
  const roots = [ctx?.projectDir, ctx?.runRoot, ctx?.pipelineDir, ctx?.runCtx?.pipelineDir, ctx?.memoryMount,
    ...(Array.isArray(ctx?.repos) ? ctx.repos.map((r) => r?.dir || r?.path) : [])]
    .filter((r) => typeof r === 'string' && r).map((r) => resolve(r));
  const owned = ownedFiles(ctx);
  const seen = new Map();
  return {
    observe(e) {
      if (e?.type !== 'tool' || !Array.isArray(e.calls)) return;
      for (const c of e.calls) {
        for (const { raw, fragment, listing } of pathsOfCall(c)) {
          if (seen.size >= MAX_SEEN) return;
          if (!isAbsolute(raw)) continue;
          const p = resolve(cwd, raw);
          if (SYSTEM_PREFIXES.some((s) => p.startsWith(s))) continue;
          if (owned.has(p) || roots.some((r) => isWithin(p, r))) continue;
          const had = seen.get(p);
          if (had) had.listing = had.listing && listing;   // one non-listing use makes it a read
          else seen.set(p, { path: p, tool: String(c.name || '?'), fragment, listing });
        }
      }
    },
    result({ sessionId = null } = {}) {
      const places = scopePlaces(ctx);
      const ancestors = ancestorsOf([...owned, ...roots]);
      const notable = [];
      const expected = [];
      for (const { path, tool, fragment, listing } of seen.values()) {
        const c = classify(path, { fragment, listing, sessionId: sessionId ? String(sessionId) : null, places, ancestors });
        if (c.why) expected.push({ path, tool, why: c.why });
        else notable.push({ path, tool, ...(c.cross ? { cross: true } : {}) });
      }
      return { notable: notable.slice(0, MAX_OUTSIDE), expected: expected.slice(0, MAX_OUTSIDE) };
    },
  };
}

/** The structured scope notice for run state (`state.scopeNotices`), or null when nothing notable was touched:
 *  `{nodeId, executionId, count, expectedCount, cross, notable}` (notable bounded; the manifest has every path). */
export function scopeRecord(ctx, { notable = [], expected = [] } = {}) {
  if (!notable.length) return null;
  return {
    nodeId: ctx?.nodeId || ctx?.node?.id || '?', executionId: ctx?.executionId ?? null,
    count: notable.length, expectedCount: expected.length, cross: notable.some((p) => p.cross === true),
    notable: notable.slice(0, MAX_RECORD_PATHS).map(({ path, tool, cross }) => ({ path, tool, ...(cross ? { cross: true } : {}) })),
  };
}

/** The run log line for notable paths outside the checkout (a count and the manifest pointer), or null. */
export function outsideWarning(ctx, paths) {
  if (!paths.length) return null;
  return `${ctx?.nodeId || ctx?.node?.id || '?'} read or wrote ${paths.length} path${paths.length === 1 ? '' : 's'} outside its checkout ` +
    `(see ${EXEC_MANIFEST_FILE})`;
}

/**
 * Append one manifest line for a spawn attempt: prompt hashes, CLI version, model and effort,
 * the settings in force, the memory files loaded, the model add-on, and the outside paths: `outside` the notable
 * ones, `outsideExpected` the expected ones (each with its `why`), so nothing is lost.
 */
export async function writeExecManifest(ctx, { opts = {}, prompt, systemPrompt, sessionId = null, initModel = null,
  startedAt, outcome = 'ok', error = null, outside = [], outsideExpected = [], addon = null } = {}) {
  const dir = ctx?.runCtx?.pipelineDir || ctx?.pipelineDir;
  if (!dir) return;
  const cwd = opts.cwd || ctx?.runRoot || ctx?.projectDir || null;
  const settingsFile = (base, name) => (base ? fileSha(join(base, '.claude', name)) : null);
  const line = {
    v: 1, ts: new Date().toISOString(), startedAt: startedAt ?? null,
    executionId: ctx?.executionId ?? null, nodeId: ctx?.nodeId ?? ctx?.node?.id ?? null, key: ctx?.node?.key ?? null,
    ordinal: ctx?.ordinal ?? null, resumeSessionId: ctx?.resumeSessionId ?? null, sessionId,
    engine: opts.engine || ctx?.node?.engine || 'claude', cliVersion: ctx?.cliVersion ?? null,
    model: { requested: opts.model ?? null, init: initModel }, effort: opts.effort ?? null,
    prompts: { system: sha(systemPrompt), prompt: sha(prompt) },
    settings: {
      user: fileSha(join(homedir(), '.claude', 'settings.json')),
      project: settingsFile(cwd, 'settings.json'), local: settingsFile(cwd, 'settings.local.json'),
      // What worca itself passed: tools, permission rules, extra settings (hashed: secrets stay out).
      worca: sha(JSON.stringify({ tools: opts.tools ?? opts.allowedTools ?? null, permissionRules: opts.permissionRules ?? null,
        extraSettings: opts.extraSettings ?? null, disallowedTools: opts.disallowedTools ?? null, settingSources: opts.settingSources ?? null })),
    },
    memory: memoryRecord(ctx),
    // The prompt add-on the spawn carried (model-addons.mjs), without its text: the sha256 names it. A v1 pin (stored
    // before the harness layer) has no engine or harness: both are recorded as null.
    addon: addon ? { engine: addon.engine ?? null, harness: addon.harness ?? null, family: addon.family, mode: addon.mode,
      files: addon.files, sha256: addon.sha256, ...(addon.inherited ? { inherited: true } : {}) } : null,
    outside, outsideExpected,
    outcome, ...(error ? { error: String(error?.code || error?.message || error).slice(0, 300) } : {}),
  };
  try {
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, EXEC_MANIFEST_FILE), JSON.stringify(line) + '\n', 'utf8');
  } catch { /* best effort */ }
}

