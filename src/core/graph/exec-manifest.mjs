// src/core/graph/exec-manifest.mjs
//
// What one agent spawn ran with, and what it touched outside its checkout — written to the run
// directory so "why did this run differ" becomes a diff of two lines (E10), and a hidden data
// channel between nodes (a file copied from another session's scratch tree, 6c9cf587) is on record
// (E9). Best effort throughout: nothing here can fail an execution.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { isWithin } from '../fs-scope.mjs';

/** One line per spawn attempt, in the pipeline directory. */
export const EXEC_MANIFEST_FILE = 'executions.ndjson';
const MAX_OUTSIDE = 200;
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

/** The paths a tool call names, by tool: file tools' path fields, and absolute paths in a Bash command. */
function pathsOfCall(call) {
  const input = call?.input && typeof call.input === 'object' ? call.input : {};
  const out = [];
  for (const k of ['file_path', 'notebook_path', 'path']) if (typeof input[k] === 'string' && input[k]) out.push(input[k]);
  if (typeof input.command === 'string') for (const m of input.command.matchAll(ABS_IN_COMMAND)) out.push(m[1]);
  return out;
}

/**
 * Collects, from a spawn's `tool` events, the absolute paths an agent read or wrote outside the
 * places it owns (its cwd, the run root, the pipeline dir, its memory mount, workspace members).
 * Relative paths resolve against the cwd and are therefore inside it.
 */
export function createScopeWatch(ctx) {
  const cwd = ctx?.runRoot || ctx?.projectDir || process.cwd();
  const roots = [ctx?.projectDir, ctx?.runRoot, ctx?.pipelineDir, ctx?.runCtx?.pipelineDir, ctx?.memoryMount,
    ...(Array.isArray(ctx?.repos) ? ctx.repos.map((r) => r?.dir || r?.path) : [])]
    .filter((r) => typeof r === 'string' && r).map((r) => resolve(r));
  const seen = new Map();
  return {
    observe(e) {
      if (e?.type !== 'tool' || !Array.isArray(e.calls)) return;
      for (const c of e.calls) {
        for (const raw of pathsOfCall(c)) {
          if (seen.size >= MAX_OUTSIDE) return;
          if (!isAbsolute(raw)) continue;
          const p = resolve(cwd, raw);
          if (SYSTEM_PREFIXES.some((s) => p.startsWith(s))) continue;
          if (roots.some((r) => isWithin(p, r))) continue;
          if (!seen.has(p)) seen.set(p, { path: p, tool: String(c.name || '?') });
        }
      }
    },
    paths: () => [...seen.values()],
  };
}

/** The warning line for paths outside the checkout, or null. */
export function outsideWarning(ctx, paths) {
  if (!paths.length) return null;
  const shown = paths.slice(0, 5).map((p) => p.path).join(', ');
  return `${ctx?.nodeId || ctx?.node?.id || '?'} read or wrote ${paths.length} path${paths.length === 1 ? '' : 's'} outside its checkout: ` +
    `${shown}${paths.length > 5 ? ', …' : ''} (see ${EXEC_MANIFEST_FILE})`;
}

/**
 * Append one manifest line for a spawn attempt: prompt hashes, CLI version, model and effort,
 * the settings in force, the memory files loaded, and the outside paths.
 */
export async function writeExecManifest(ctx, { opts = {}, prompt, systemPrompt, sessionId = null, initModel = null,
  startedAt, outcome = 'ok', error = null, outside = [] } = {}) {
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
    outside,
    outcome, ...(error ? { error: String(error?.code || error?.message || error).slice(0, 300) } : {}),
  };
  try {
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, EXEC_MANIFEST_FILE), JSON.stringify(line) + '\n', 'utf8');
  } catch { /* best effort */ }
}

