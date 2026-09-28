// The per-run memory MOUNT (agent-memory-design.md §4.1, amendment A1) and the
// hash-baselined SYNC-BACK (§5). Pure over injected paths: `root` is the store
// (memory-store.mjs' layout), `mount` is the WRITABLE copy `<pipeline.dir>/memory` (memoryWorkPath); the read-only rules copy is memoryRulesPath(cwd). No DB, no
// orchestrator state, no settings reads — the harness passes caps and paths.
import { mkdir, rm, cp, readFile, writeFile, stat, rename, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GLOBAL_SCOPE, projectScope, scopeDir, listMemory, listMemoryDir, hashText,
  repairMemoryFile, parseMemoryFile, writeMemory, removeMemory, snapshotScope, MemoryError,
} from './memory-store.mjs';
import { MEMORY_DEFRAG_WORKFLOW_ID } from './graph/builtin-workflows.mjs';

/**
 * Two copies of the store per run (memory-write-split design, 2026-09-17):
 *  - the READ-ONLY rules copy INSIDE a run's cwd — Claude Code discovers `<cwd>/.claude/rules/**`
 *    recursively, honours `paths:` frontmatter and hands the files to Task sub-agents (probed on
 *    claude 2.1.270). `.claude` is one of Claude Code's PROTECTED paths: a Write/Edit there is refused
 *    under `-p` whatever the allow rules or hooks say (probed 2.1.273), so nothing is ever written here
 *    by an agent; worca refreshes it from the store after every sync that changed the store.
 *  - the WRITABLE copy = the sync-back mount, `<pipeline.dir>/memory/`, outside every checkout and
 *    cwd (no git hygiene, no tracked guard, survives a pause for the resume sync), passed to every
 *    spawn as `--add-dir` so acceptEdits auto-approves edits there by the documented rule.
 * `worca/` namespaces the rules copy away from a project's own committed rules. Forward slashes on
 * purpose: MEMORY_RULES_REL is also the git pathspec of the §8.8 exclusion set.
 */
export const MEMORY_RULES_REL = '.claude/rules/worca';
/** `<cwd>/.claude/rules/worca` with the platform separator — the read-only copy. */
export function memoryRulesPath(cwd) { return join(cwd, ...MEMORY_RULES_REL.split('/')); }
/** The writable copy's name under the pipeline dir. */
export const MEMORY_WORK_REL = 'memory';
/** `<pipelineDir>/memory` — the writable copy = the sync-back mount. */
export function memoryWorkPath(pipelineDir) { return join(pipelineDir, MEMORY_WORK_REL); }
/**
 * The §8.8 injected-path record of the mount. `kind: 'memory'` is EXCLUDED from every commit,
 * intent-to-add staging and result diff (run-harness `_excludePathspecs`), REMOVED at teardown
 * (`removeInjectedPaths`) and NEVER rescued (`rescueModifiedMounts` handles the skill/claudeMd
 * kinds only — sync-back is this mount's rescue). `source: null`: there is no one source file.
 */
export const MEMORY_INJECTED_ENTRY = Object.freeze({ path: MEMORY_RULES_REL, kind: 'memory', source: null });

export const baselineKey = (rel, name) => `${rel}/${name}.md`;
const byKey = (a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0);

/**
 * Which store scopes a run mounts, and under which mount-relative dir.
 * Single run: global/ + project/ (D6). Workspace run: global/ + projects/<key>/ per
 * member, sorted by projectKey (the orchestrator's member order). `memoryScope`
 * (P2's defrag option) narrows to exactly one dir; 'project' needs a single-project run.
 */
export function mountDirs({ members = [], isWorkspace = false, memoryScope = null } = {}) {
  const out = [{ scope: GLOBAL_SCOPE, rel: 'global', label: 'Global' }];
  if (isWorkspace) {
    for (const m of [...members].sort(byKey)) {
      out.push({ scope: projectScope(m.projectKey), rel: `projects/${m.projectKey}`, label: `Project ${m.projectName || m.projectKey}` });
    }
  } else if (members[0]) {
    const m = members[0];
    out.push({ scope: projectScope(m.projectKey), rel: 'project', label: `Project ${m.projectName || m.projectKey}` });
  }
  if (memoryScope === 'global') return out.filter((d) => d.rel === 'global');
  if (memoryScope === 'project') {
    if (isWorkspace) throw new Error('memoryScope "project" needs a single-project run');
    return out.filter((d) => d.rel === 'project');
  }
  return out;
}

export const MEMORY_SCOPES = Object.freeze(['global', 'project']);

/**
 * The run-option gate (agent-memory-design.md §7.3), shared by POST /api/run, the CLI, Ask's
 * proposal validator and the harness constructor: null when the combination is legal, else the
 * reason — an HTTP 400 / CLI usage error / proposal error, verbatim. `memoryScope` is only ever
 * legal with the Memory defragment workflow, that workflow always needs it, and a defragment
 * run is a single-project run (the mount is one scope dir: mountDirs).
 */
export function validateMemoryScope({ workflowId, memoryScope, isWorkspace = false } = {}) {
  const has = memoryScope !== undefined && memoryScope !== null && memoryScope !== '';
  const defrag = workflowId === MEMORY_DEFRAG_WORKFLOW_ID;
  if (has && !MEMORY_SCOPES.includes(memoryScope)) return 'memoryScope must be "global" or "project"';
  if (has && !defrag) return `memoryScope is only valid with the Memory defragment workflow (${MEMORY_DEFRAG_WORKFLOW_ID})`;
  if (defrag && !has) return 'the Memory defragment workflow needs memoryScope ("global" or "project")';
  if (has && isWorkspace) return 'a memory defragment run targets one project, not a workspace';
  return null;
}

/**
 * (Re)create the mount from the store — the rm is scoped to the `worca/` subtree, so a project's
 * own `.claude/rules/*.md` beside it is never touched: every dir exists even when empty (the
 * pointer block tells the agent it is writable), stale content from a previous segment
 * is removed first (the caller syncs back BEFORE remounting on resume), files are
 * COPIED (never linked). Returns the baseline `{ '<rel>/<name>.md': sha1 }`.
 * `gitIgnore: true` writes `<mount>/.gitignore` = `*` FIRST (before any file is copied, so a
 * mount that fails half way never leaves files without their ignore — an ignore without files
 * is harmless, bare files inside a checkout are not): the mount then sits inside a checkout
 * invisibly — an agent's own `git add -A`, a staging pre-commit hook and the reviewer's
 * `git status` all skip it. Not a memory file: `listMemoryDir` lists `*.md` only, so sync-back
 * neither syncs it nor reads it as a deletion. The §8.8 `:(exclude)` pathspec stays as defence
 * in depth (a hand-deleted sentinel, an older git).
 */
export async function mountMemory({ root, mount, dirs, onError, gitIgnore = false }) {
  // (Windows: an indexer/AV may hold a handle for a moment.)
  await rm(mount, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  await mkdir(mount, { recursive: true });
  if (gitIgnore) await writeFile(join(mount, '.gitignore'), '*\n', 'utf8');
  const baseline = {};
  let files = 0;
  for (const d of dirs) {
    const dest = join(mount, d.rel);
    await mkdir(dest, { recursive: true });
    for (const e of await listMemory(root, d.scope, { onError })) {
      await cp(join(scopeDir(root, d.scope), `${e.name}.md`), join(dest, `${e.name}.md`));
      baseline[baselineKey(d.rel, e.name)] = e.hash;
      files++;
    }
  }
  return { mount, dirs, baseline, files };
}

/**
 * The NON-destructive twin of mountMemory, for a mount a process may be READING while we refresh
 * it (the Ask chat's --add-dir base, memory-deps.mjs refreshAskMemoryMount): every store file is
 * written atomically by name (temp + rename), files no longer in the store are unlinked, dirs are
 * created and never removed. No `.gitignore` sentinel — an Ask mount is not inside a checkout.
 * No baseline — nothing syncs back from an Ask mount.
 * Failure is PER FILE: a target that cannot be written keeps its previous copy (a stale rule still
 * loads; a file that never landed is simply absent this turn), its temp is unlinked and its name is
 * reported. Returns `{ files, failed }` where `files` is what the mount SHOULD hold (the store
 * entries of the scope set) and `failed` the names that could not be refreshed this call.
 */
export async function refreshMount({ root, mount, dirs, onError }) {
  let files = 0;
  const failed = [];
  for (const d of dirs) {
    const dest = join(mount, d.rel);
    await mkdir(dest, { recursive: true });
    const entries = await listMemory(root, d.scope, { onError });
    // `keep` is built from what we actually WROTE or deliberately kept — an entry that vanished
    // between the listing and the read is not in it, so its stale mount copy is swept THIS call.
    const keep = new Set();
    for (const e of entries) {
      const text = await readFile(join(scopeDir(root, d.scope), `${e.name}.md`), 'utf8').catch(() => null);
      if (text === null) continue;                                    // vanished between the listing and the read
      files++;
      const target = join(dest, `${e.name}.md`);
      keep.add(`${e.name}.md`);                                       // written below, or kept as the previous copy on failure
      const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
      try {
        await writeFile(tmp, text, 'utf8');
        await rename(tmp, target);
      } catch (err) {
        await unlink(tmp).catch(() => {});
        failed.push(e.name);
        onError?.(target, err);
      }
    }
    // Stale files go. A name of THIS shape (`x.md.tmp-<pid>-<ms>`) is another writer's in-flight rename,
    // never a memory file (those end in `.md`) — a memory file named `a.tmp-b` lands as `a.tmp-b.md` and is swept.
    for (const f of await readdir(dest).catch(() => [])) {
      if (keep.has(f) || /\.md\.tmp-\d+-\d+$/.test(f)) continue;
      await unlink(join(dest, f)).catch(() => {});
    }
  }
  return { files, failed };
}

// ── one writer per store root per process ────────────────────────────────────
// A run's parallel executions (scheduler maxParallel, composite slices) and several
// live runs hosted by one server process all sync into the same store. A promise
// chain per root is enough for a single-user tool (no lock file); it keeps two
// syncs from diffing against the same baseline and writing the same file twice.
const storeQueues = new Map();   // root -> settled tail
export function withStoreLock(root, fn) {
  const tail = storeQueues.get(root) || Promise.resolve();
  const run = tail.then(fn);
  const settled = run.catch(() => {});
  storeQueues.set(root, settled);
  settled.then(() => { if (storeQueues.get(root) === settled) storeQueues.delete(root); });
  return run;
}

const REJECTED_INVALID = 'rejected:invalid';
/** Keep `isHash`: `storeHashOf` is defined in terms of it and is its only remaining caller. */
const isHash = (v) => typeof v === 'string' && !v.startsWith('rejected:');
/** The store hash a baseline value still vouches for: a plain hash, or the third segment of a
 *  `rejected:<mountHash>:<storeHash>` marker (the store held the file when its overwrite was
 *  refused, and that copy is what a later deletion may mirror — spec §5 step 5). null for
 *  `rejected:invalid` and for P1's two-part `rejected:<mountHash>` (the store never vouched). */
const storeHashOf = (v) => (isHash(v) ? v : ((typeof v === 'string' && v.split(':')[2]) || null));

/** Totals over a list of Change entries — one shape for results.json, the History detail and Ask's
 *  get_run. `failed` = writes the agent attempted that never reached the mount (a refused tool call);
 *  a record written before the write split has no `failed` array and counts as 0. */
export function memoryTotals(changes) {
  const totals = { added: 0, modified: 0, deleted: 0, rejected: 0, failed: 0 };
  for (const c of Array.isArray(changes) ? changes : []) for (const k of Object.keys(totals)) totals[k] += Array.isArray(c[k]) ? c[k].length : 0;
  return totals;
}

/**
 * Sync the mount back into the store (§5 steps 1–6), serialised per store root. Per mount dir:
 *  - new/changed file: name-repair warning, scope-full / hard-cap / case-twin checks, ONE
 *    snapshot per scope per sync (taken lazily before the first accepted write), store write
 *    via writeMemory; the repaired text is written back into the mount so both sides carry
 *    one hash. Added vs modified is decided by the STORE, never by the baseline.
 *  - store changed since baseline AND mount changed: the run wins (the store's version is
 *    in the snapshot) — warned by name.
 *  - deleted in the mount: removed from the store only when the store still matches the
 *    baseline; otherwise kept + warned. A key whose last write was rejected is dropped with
 *    a warning (the store never took that text).
 *  - a file the store refuses (invalid name, cap, twin, scope full, or a store-side fs
 *    error) stays in the mount, is baselined as `rejected:<mountHash>[:<storeHash>]` (the store
 *    hash rides along when the store held the file, so a later mount deletion of that file
 *    still mirrors; reported ONCE per text, re-tried whenever the text — or the cap — changes)
 *    and never reaches the store.
 *  - a mount file the run EMPTIED is a DELETION request (amendment B19): the memory tool set
 *    has no unlink, and no legitimate memory file is empty (every writer renders a fence), so
 *    the key is handed to the deletion pass above. A NEW empty file is simply ignored; this
 *    arm runs BEFORE the scope-full pre-check, so a full scope never turns it into a rejection.
 *  - a mount file that cannot be READ is skipped this sync with its baseline untouched.
 * Never throws for one file's sake; a listing error is reported through `onError`.
 */
export function syncBack(o) { return withStoreLock(o.root, () => syncBackUnlocked(o)); }

async function syncBackUnlocked({ root, mount, dirs, baseline, source, now, caps, onWarn, onError }) {
  const next = { ...baseline };
  const added = [], modified = [], deleted = [], rejected = [];
  const warn = (t) => { if (typeof onWarn === 'function') onWarn(t); };
  for (const d of dirs) {
    const dir = join(mount, d.rel);
    // A scope dir that is GONE is never an agent deleting every file in it (agents
    // delete files, not the mount): a remount that failed after its rm, or a ledger
    // older than the mount. Skip it with its baseline untouched — never mirror deletions.
    const present = await stat(dir).then((s) => s.isDirectory(), () => false);
    if (!present) { warn(`memory: mount dir ${d.rel} is missing — skipped this sync (nothing deleted)`); continue; }
    const junk = [];
    const current = await listMemoryDir(dir, { onError: (p, err) => { if (err?.code === 'ENAME') junk.push(p); else onError?.(p, err); } });
    const seen = new Set();
    for (const p of junk) {
      const name = p.split(/[\\/]/).pop().replace(/\.md$/i, '');
      const key = baselineKey(d.rel, name);
      seen.add(key);                                                        // never reaches the deletion pass
      if (baseline[key] !== REJECTED_INVALID) rejected.push({ scope: d.rel, name, reason: 'invalid name (letters, digits, ".", "_", "-" only; no leading or trailing dot; not a Windows device name)' });
      next[key] = REJECTED_INVALID;
    }
    const store = new Map((await listMemory(root, d.scope, { onError })).map((e) => [e.name, e.hash]));
    let snapped = false;
    const snapshotOnce = async () => { if (!snapped) { snapped = true; await snapshotScope(root, d.scope, { source, now }); } };
    for (const e of current) {
      const key = baselineKey(d.rel, e.name);
      seen.add(key);
      if (next[key] === e.hash) continue;                                     // unchanged since the last sync
      const inStore = store.has(e.name);
      // The marker keeps the STORE hash (when there is one) so the same text is not re-reported
      // on the next sync (the marker must be stable) and a later mount deletion can still tell
      // whether the store copy is the one this run mounted.
      const storeHash = storeHashOf(baseline[key]);
      const marker = `rejected:${e.hash}${storeHash ? `:${storeHash}` : ''}`;
      const reject = (reason) => { if (baseline[key] !== marker) rejected.push({ scope: d.rel, name: e.name, reason }); next[key] = marker; };
      let text;
      try { text = await readFile(join(dir, `${e.name}.md`), 'utf8'); }
      catch (err) {
        if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') continue;     // vanished between the listing and the read
        warn(`memory: cannot read ${key}: ${err?.code || err?.message || err} — skipped this sync`); continue;
      }
      // B19: a mount file the agent EMPTIED is a deletion request — the memory tool set has
      // no unlink (Write/Edit only), and no legitimate memory file is empty (every writer
      // renders a fence). Hand the key to the deletion pass: it mirrors the removal only
      // when the store copy is unchanged since the mount (spec §5 step 5), else keeps + warns.
      // A NEW empty file is simply ignored (the deletion pass sees no baseline for it).
      if (!text.trim()) { seen.delete(key); continue; }
      // The scope-full pre-check comes AFTER the read and the B19 arm: a file the run EMPTIED is a
      // deletion request, never a new file, so a full scope must not turn it into a rejection.
      if (!inStore && store.size >= (caps?.maxFilesPerScope ?? Infinity)) { reject(`scope is full (${caps.maxFilesPerScope} files)`); continue; }
      const declared = parseMemoryFile(text).meta.name;
      if (declared && declared !== e.name) warn(`memory: ${key} declares name "${declared}" — repaired to the filename stem "${e.name}"`);
      if (inStore && storeHash && store.get(e.name) !== storeHash) {
        warn(`memory: ${key} changed in the store since this run mounted it — the run's version wins (the store's version is kept in .history)`);
      }
      try {
        await writeMemory(root, d.scope, e.name, text, { source, now, caps, snapshot: snapshotOnce });
        const repaired = repairMemoryFile(text, { name: e.name, source, now, hookMaxChars: caps?.hookMaxChars });
        if (repaired.changed) await writeFile(join(dir, `${e.name}.md`), repaired.text, 'utf8');
        const h = hashText(repaired.text);
        next[key] = h;
        store.set(e.name, h);
        (inStore ? modified : added).push({ scope: d.rel, name: e.name });
      } catch (err) {
        reject(err instanceof MemoryError ? err.message.replace(/^memory: /, '') : `could not write to the store (${err?.code || err?.name || 'error'})`);
      }
    }
    for (const key of Object.keys(baseline)) {
      if (!key.startsWith(`${d.rel}/`) || seen.has(key)) continue;
      const name = key.slice(d.rel.length + 1).replace(/\.md$/, '');
      if (!store.has(name)) { delete next[key]; continue; }                   // already gone from the store (or never accepted)
      const storeHash = storeHashOf(baseline[key]);
      if (storeHash === null) {                                               // the store never vouched for this key (P1 marker / invalid name)
        warn(`memory: ${key} was deleted by the run after a rejected write — the store's version is kept`);
        delete next[key]; continue;
      }
      if (store.get(name) !== storeHash) {
        warn(`memory: ${key} was deleted by the run but changed in the store since this run mounted it — kept`);
        delete next[key]; continue;
      }
      await removeMemory(root, d.scope, name, { source, now, snapshot: snapshotOnce });
      delete next[key];
      deleted.push({ scope: d.rel, name });
    }
  }
  return { baseline: next, added, modified, deleted, rejected, total: added.length + modified.length + deleted.length };
}
