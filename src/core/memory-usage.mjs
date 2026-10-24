// Memory usage counts, collect-only (plans/team-memory-usage-tracking.md; the counts later feed phase 2b, ranking by
// use): how often a mounted note was relevant (`hit`: Claude Code loaded it for a matching file), looked up (`read`: a
// Read of the note file, or Ask's read_memory) or changed (`edit`, recorded and never scored). Counts only, never note
// text or prompts (U10).
//
//   <worcaHome>/memory-usage/projects/<projectKey>.json   {schema:1, notes:{"<layer>:<name>":{days:{"YYYY-MM-DD":{hit,read,edit}}, last:{hit,read,edit}, triggers:[…≤5]}}}
//   <worcaHome>/memory-usage/global.json                   same shape, global notes
//
// A run collects in memory and in its per-execution hook files (<pipelineDir>/memory-loads/<execution>.jsonl), and
// writes here once per sync-back (U4, U6). Nothing here is shared: the trigger paths are local only.
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { worcaHome } from './projects.mjs';
import { writeJsonAtomic } from './json-atomic.mjs';
import { withLock } from './metrics/lock.mjs';
import { parseMemoryFile } from './memory-store.mjs';

export const USAGE_SCHEMA = 1;
export const USAGE_SIGNALS = Object.freeze(['hit', 'read', 'edit']);
const KEEP_DAYS = 90;
const KEEP_TRIGGERS = 5;
const LOCK_OPTS = { timeoutMs: 10_000 };
export const MEMORY_LOADS_DIR = 'memory-loads';

export function memoryUsageRoot() { return join(worcaHome(), 'memory-usage'); }

/** The usage file of `file` ('global' or a project key). */
function usageFile(file) {
  return file === 'global' ? join(memoryUsageRoot(), 'global.json') : join(memoryUsageRoot(), 'projects', `${file}.json`);
}

/** The hook file one execution's loads are appended to (a name safe on every file system). */
export function memoryLoadLogPath(pipelineDir, executionId) {
  return join(pipelineDir, MEMORY_LOADS_DIR, `${String(executionId).replace(/[^A-Za-z0-9._-]/g, '_')}.jsonl`);
}

/** The `InstructionsLoaded` entry of the run's --settings payload (U3): only `path_glob_match` loads start the hook, so a
 *  rule loaded at session start costs no process. Same command shape as hostGuardHookEntry (forward slashes). */
export function memoryUsageHookEntry(logFile) {
  const q = (s) => JSON.stringify(String(s).replaceAll('\\', '/'));
  const script = fileURLToPath(new URL('./memory-usage-hook.mjs', import.meta.url));
  return { matcher: 'path_glob_match', hooks: [{ type: 'command', command: `${q(process.execPath)} ${q(script)} ${q(logFile)}` }] };
}

/** True when a rules copy holds at least one note with `paths:` — the only notes a `path_glob_match` load can name. */
export async function rulesHaveScopedNote(rulesDir) {
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory()) { if (await walk(join(dir, e.name))) return true; continue; }
      if (!e.isFile() || !/\.md$/i.test(e.name)) continue;
      const text = await readFile(join(dir, e.name), 'utf8').catch(() => '');
      if (parseMemoryFile(text).meta.paths.length) return true;
    }
    return false;
  };
  return !!rulesDir && walk(rulesDir);
}

/**
 * A path relative to a memory copy (`global/x.md`, `project/x.md`, `projects/<key>/x.md`, `team/x.md`,
 * `team/<key>/x.md`) → `{ file, note }` with `file` 'global' or the project key and `note` '<layer>:<name>'; null for
 * anything that is not a note of a mounted scope.
 */
export function noteOfMemoryRel(rel, dirs) {
  if (typeof rel !== 'string' || !/\.md$/i.test(rel)) return null;
  const parts = rel.split('/');
  const name = parts.pop().replace(/\.md$/i, '');
  if (!name) return null;
  const dir = parts.join('/');
  const projects = (dirs || []).filter((d) => d.scope?.kind === 'project');
  if (dir === 'team' || dir.startsWith('team/')) {
    const d = dir === 'team' ? projects.find((x) => x.rel === 'project') : projects.find((x) => `team/${x.scope.projectKey}` === dir);
    return d ? { file: d.scope.projectKey, note: `team:${name}` } : null;
  }
  const d = (dirs || []).find((x) => x.rel === dir);
  if (!d) return null;
  if (d.rel === 'global') return { file: 'global', note: `global:${name}` };
  return d.scope?.kind === 'project' ? { file: d.scope.projectKey, note: `project:${name}` } : null;
}

/** Ask's read_memory result → `{ file, note }`, or null. */
export function noteOfReadMemory(result) {
  const name = typeof result?.name === 'string' ? result.name : '';
  if (!name) return null;
  if (result.scope === 'global') return { file: 'global', note: `global:${name}` };
  if (result.scope === 'project' && typeof result.projectKey === 'string' && result.projectKey) {
    return { file: result.projectKey, note: `${result.layer === 'team' ? 'team' : 'project'}:${name}` };
  }
  return null;
}

/** One execution's tally: each signal at most once per note (U2). `add` returns false for a repeat. */
export function createUsageTally() {
  const seen = new Map();   // `${file}\0${note}\0${signal}` → event
  return {
    add(ref, signal, trigger = null) {
      if (!ref || !USAGE_SIGNALS.includes(signal)) return false;
      const k = `${ref.file}\0${ref.note}\0${signal}`;
      if (seen.has(k)) return false;
      seen.set(k, { file: ref.file, note: ref.note, signal, ...(typeof trigger === 'string' && trigger ? { trigger } : {}) });
      return true;
    },
    get size() { return seen.size; },
    events() { return [...seen.values()]; },
  };
}

/** Read (and remove) hook files: one execution's, or every one left in the dir (`executionId` null: the run-end and
 *  resume drains). Malformed lines are skipped. Each line → a `hit` in `tally`. */
export async function drainMemoryLoads(pipelineDir, executionId, dirs, tally) {
  if (!pipelineDir) return;
  const dir = join(pipelineDir, MEMORY_LOADS_DIR);
  const files = executionId == null
    ? (await readdir(dir).catch(() => [])).filter((n) => n.endsWith('.jsonl')).map((n) => join(dir, n))
    : [memoryLoadLogPath(pipelineDir, executionId)];
  for (const f of files) {
    const text = await readFile(f, 'utf8').catch(() => null);
    if (text == null) continue;
    await rm(f, { force: true });
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e?.r !== 'path_glob_match') continue;
      tally.add(noteOfMemoryRel(e.f, dirs), 'hit', typeof e.t === 'string' ? e.t : null);
    }
  }
}

const dayOf = (now) => new Date(now).toISOString().slice(0, 10);
const emptyCounts = () => ({ hit: 0, read: 0, edit: 0 });

/**
 * Merge `events` (`[{file, note, signal, trigger?}]`, already one per note and signal) into the usage files: one
 * read-modify-write per file touched, under that file's lock; day buckets past 90 days are dropped. Best-effort by
 * contract: the caller logs a failure and drops the tally (U6).
 */
export async function recordMemoryUsage(events, { now = Date.now() } = {}) {
  const byFile = new Map();
  for (const e of events || []) {
    if (!e || !USAGE_SIGNALS.includes(e.signal) || typeof e.note !== 'string' || typeof e.file !== 'string') continue;
    if (!byFile.has(e.file)) byFile.set(e.file, []);
    byFile.get(e.file).push(e);
  }
  const day = dayOf(now);
  const cutoff = dayOf(now - KEEP_DAYS * 86_400_000);
  const at = new Date(now).toISOString();
  for (const [file, list] of byFile) {
    const path = usageFile(file);
    await withLock(`${path}.lock`, async () => {
      let doc = null;
      try { doc = JSON.parse(await readFile(path, 'utf8')); } catch { doc = null; }
      if (!doc || doc.schema !== USAGE_SCHEMA || typeof doc.notes !== 'object' || !doc.notes) doc = { schema: USAGE_SCHEMA, notes: {} };
      for (const e of list) {
        const n = doc.notes[e.note] || (doc.notes[e.note] = { days: {}, last: {}, triggers: [] });
        const b = n.days[day] || (n.days[day] = emptyCounts());
        b[e.signal] = (Number(b[e.signal]) || 0) + 1;
        n.last[e.signal] = at;
        if (e.trigger) n.triggers = [e.trigger, ...(n.triggers || []).filter((t) => t !== e.trigger)].slice(0, KEEP_TRIGGERS);
      }
      for (const n of Object.values(doc.notes)) for (const d of Object.keys(n.days || {})) if (d < cutoff) delete n.days[d];
      writeJsonAtomic(path, doc);
    }, LOCK_OPTS);
  }
}
