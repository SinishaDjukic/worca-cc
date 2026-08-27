// src/core/run-manifest.mjs
// The per-run manifest (`<runRoot>/run.json`) plus the small set of fs-only
// helpers every run-root consumer needs: the §8.13 removal guard, the §8.11 stray
// scan, the §8.20 modified-mount rescue, and the §5.2 durability copy.
//
// LEAF MODULE by design: node builtins only. worktree.mjs (sweepRunRoots),
// orchestrator.mjs (_teardownRunRoot), and pipeline-delete.mjs all import it, so
// it must never reach back into the DB layer or the orchestrator.
//
// Phase 1 writes the MINIMAL manifest (pipelineId, runRootMode, isWorkspace,
// members[]) so the boot sweep and pipeline-delete have member real dirs from the
// very first detached run. Phase 3 EXTENDS the same file with injectedPaths,
// skillResolutions, renames, bytes, warnings, capabilities, and the teardown
// `retain` record — every read here is deliberately shape-tolerant so a manifest
// from either phase parses.

import { mkdir, readFile, writeFile, rm, rename, readdir, stat, cp, lstat } from 'node:fs/promises';
import { join, resolve, sep, basename, dirname } from 'node:path';

export const RUN_MANIFEST_FILE = 'run.json';

/** Stable machine-readable reasons why a terminal run root must be retained. */
export const RETAIN_REASONS = Object.freeze({ COMMIT_FAILED: 'commit_failed' });

/** Entries worca-cc itself owns at a run root. Anything else there is a STRAY (§8.11). */
export const RUN_ROOT_KNOWN_SET = new Set(['CLAUDE.md', 'mcp.json', RUN_MANIFEST_FILE, '.claude', 'repos']);

// The V3 CLAUDE.md fallback's delimiter-fenced section (§4.1). The begin marker
// carries the pipelineId so two concurrent runs over the same real dir can never
// strip each other's block.
export const claudeMdFenceBegin = (pipelineId) => `<!-- worca-cc:context:begin ${pipelineId} -->`;
export const CLAUDE_MD_FENCE_END = '<!-- worca-cc:context:end -->';

/** Absolute path of a run root's manifest. */
export function runManifestPath(runRoot) {
  return join(runRoot, RUN_MANIFEST_FILE);
}

/**
 * Write (or overwrite) `<runRoot>/run.json`. Creates the run root when missing.
 * Best-effort atomic: temp file + rename, so a concurrent reader never sees a
 * half-written manifest. Never throws — a manifest is an optimization for the
 * sweeps, never a correctness dependency (they fall back to the DB columns).
 * @param {string} runRoot
 * @param {object} data
 * @returns {Promise<boolean>} true when the manifest landed
 */
export async function writeRunManifest(runRoot, data) {
  if (!runRoot) return false;
  try {
    await mkdir(runRoot, { recursive: true });
    const file = runManifestPath(runRoot);
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(data ?? {}, null, 2) + '\n', 'utf8');
    await rename(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read `<runRoot>/run.json`. Missing / unreadable / unparseable / non-object => null.
 * Shape-tolerant on purpose: Phase 1 writes a subset of the Phase 3 schema, and a
 * hand-written fixture is a legitimate input.
 * @param {string} runRoot
 * @returns {Promise<object|null>}
 */
export async function readRunManifest(runRoot) {
  if (!runRoot) return null;
  try {
    const data = JSON.parse(await readFile(runManifestPath(runRoot), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Merge `patch` into an existing manifest (or create one). Used by Phase 3's
 * assembly and by teardown when it appends warnings. Never throws.
 */
export async function updateRunManifest(runRoot, patch) {
  const cur = (await readRunManifest(runRoot)) || {};
  return writeRunManifest(runRoot, { ...cur, ...(patch || {}) });
}

/**
 * §8.13 run-root removal safety. `rm -rf <runRoot>` is guarded by TWO assertions
 * everywhere it appears (_teardownRunRoot, sweepRunRoots, pipeline-delete): the
 * resolved path must live under `<worcaHome>/runs/`, and its basename must equal
 * the pipelineId. A guard failure REFUSES the removal and reports why — it never
 * throws into a teardown path.
 * @param {string} runRoot
 * @param {{worcaHome:string, pipelineId:string}} opts
 * @returns {Promise<{ok:boolean, removed:boolean, reason?:string}>}
 */
export async function rmGuarded(runRoot, { worcaHome, pipelineId } = {}) {
  if (!runRoot || !worcaHome || !pipelineId) {
    return { ok: false, removed: false, reason: 'runRoot, worcaHome and pipelineId are all required' };
  }
  const target = resolve(runRoot);
  const runsBase = resolve(join(worcaHome, 'runs'));
  if (!target.startsWith(runsBase + sep)) {
    return { ok: false, removed: false, reason: `refusing to remove ${target}: outside ${runsBase}${sep}` };
  }
  if (basename(target) !== pipelineId) {
    return { ok: false, removed: false, reason: `refusing to remove ${target}: basename !== pipelineId ${pipelineId}` };
  }
  try {
    // maxRetries: the run root holds git worktree checkouts; on Windows a dir
    // cannot be removed while git's index/packed-refs handle (or a virus scanner)
    // is still open, so a single rm EBUSY/EPERMs under load. Node backs off across
    // attempts (~cumulative seconds); POSIX takes the first try.
    await rm(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    return { ok: true, removed: true };
  } catch (err) {
    return { ok: false, removed: false, reason: err?.message || String(err) };
  }
}

/** All file paths under `p`, relative to it. A plain file yields ['']. [] when absent. */
async function filesUnder(p) {
  let st;
  try { st = await lstat(p); } catch { return []; }
  if (!st.isDirectory()) return [''];
  const out = [];
  const walk = async (rel) => {
    let entries;
    try { entries = await readdir(join(p, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const child = rel ? join(rel, e.name) : e.name;
      if (e.isDirectory()) await walk(child);
      else out.push(child);
    }
  };
  await walk('');
  return out;
}

async function readMaybe(p) {
  try { return await readFile(p); } catch { return null; }
}

/**
 * True when the tree at `mounted` differs byte-wise from the tree at `source`
 * (a file added inside the mount counts as a change). A missing mount is NOT a
 * change (nothing to rescue); a missing source IS (we cannot prove it unchanged).
 */
async function treeDiffers(mounted, source) {
  const mountedFiles = await filesUnder(mounted);
  if (!mountedFiles.length) return false;                 // mount gone: nothing to rescue
  const sourceFiles = await filesUnder(source);
  if (!sourceFiles.length) return true;                   // source gone: cannot prove unchanged
  if (mountedFiles.length !== sourceFiles.length) return true;
  const known = new Set(sourceFiles);
  for (const rel of mountedFiles) {
    if (!known.has(rel)) return true;                     // added file
    const a = await readMaybe(rel ? join(mounted, rel) : mounted);
    const b = await readMaybe(rel ? join(source, rel) : source);
    if (!a || !b || !a.equals(b)) return true;
  }
  return false;
}

/** Extract the worca-cc-managed fenced block from `text`, or null when absent. */
export function extractClaudeMdFence(text, pipelineId) {
  const begin = claudeMdFenceBegin(pipelineId);
  const s = String(text ?? '');
  const i = s.indexOf(begin);
  if (i === -1) return null;
  const j = s.indexOf(CLAUDE_MD_FENCE_END, i + begin.length);
  if (j === -1) return null;
  return s.slice(i + begin.length, j).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
}

/**
 * Strip the worca-cc-managed fenced block (begin..end inclusive) from `text`.
 * Returns the text unchanged when no complete fence is present.
 */
export function stripClaudeMdFence(text, pipelineId) {
  const begin = claudeMdFenceBegin(pipelineId);
  const s = String(text ?? '');
  const i = s.indexOf(begin);
  if (i === -1) return s;
  const j = s.indexOf(CLAUDE_MD_FENCE_END, i + begin.length);
  if (j === -1) return s;
  const before = s.slice(0, i).replace(/\n{2,}$/, '\n');
  const after = s.slice(j + CLAUDE_MD_FENCE_END.length).replace(/^\r?\n+/, '');
  return after ? `${before}${before && !before.endsWith('\n') ? '\n' : ''}${after}` : before;
}

/**
 * §8.20 modified-mount rescue. Every injected entry of kind `skill` / `claudeMd` /
 * `claudeMdSection` is byte-compared against its recorded `source`; a changed or
 * added file means the agent edited a DISPOSABLE copy, so the whole entry is copied
 * to `<pipelineDir>/stray/<scope>/<path>` and named in a warning. `kind:'link'` (and
 * `mount:'symlink'`) entries are exempt: they are write-through by design.
 *
 * Read-only apart from the rescue copy, so it is safe to run FIRST in teardown and
 * again from the sweep. Never throws.
 *
 * @param {{baseDir:string, entries:Array<object>, pipelineDir:string|null, scope:string, pipelineId?:string}} args
 *   baseDir     the checkout (or run root) the entries were materialized into
 *   entries     injectedPaths[<scope>] — [{ path, source, kind, mount? }]
 *   pipelineDir the durable artifact dir; null skips the copy (warning still emitted)
 *   scope       projectKey, or 'runRoot'
 * @returns {Promise<string[]>} warnings (one per rescued entry)
 */
export async function rescueModifiedMounts({ baseDir, entries, pipelineDir, scope, pipelineId } = {}) {
  const warnings = [];
  if (!baseDir || !Array.isArray(entries) || !entries.length) return warnings;
  for (const e of entries) {
    const kind = e?.kind;
    if (!e?.path || kind === 'link' || e?.mount === 'symlink') continue;
    if (kind !== 'skill' && kind !== 'claudeMd' && kind !== 'claudeMdSection') continue;
    const mounted = join(baseDir, e.path);
    try {
      if (kind === 'claudeMdSection') {
        const live = extractClaudeMdFence(await readFile(mounted, 'utf8').catch(() => ''), pipelineId);
        if (live === null) continue;                                  // fence gone: nothing to compare
        const recorded = e.source ? await readFile(e.source, 'utf8').catch(() => null) : null;
        if (recorded !== null && live.trim() === String(recorded).trim()) continue;
        const dest = pipelineDir ? join(pipelineDir, 'stray', scope || 'runRoot', e.path) : null;
        if (dest) {
          await mkdir(dirname(dest), { recursive: true });
          await writeFile(dest, live + '\n', 'utf8');
        }
        warnings.push(
          `agent modified the worca-cc CLAUDE.md section in \`${e.path}\`; the block is disposable — ` +
          `rescued to \`${dest || '(no pipeline dir)'}\`; apply it to \`${e.source || 'the real dir'}\` manually if intended.`,
        );
        continue;
      }
      if (!(await treeDiffers(mounted, e.source || ''))) continue;
      const dest = pipelineDir ? join(pipelineDir, 'stray', scope || 'runRoot', e.path) : null;
      if (dest) {
        await mkdir(dirname(dest), { recursive: true });
        await cp(mounted, dest, { recursive: true, force: true, dereference: true });
      }
      const label = kind === 'skill' ? `mounted skill \`${basename(e.path)}\`` : `mounted \`${e.path}\``;
      warnings.push(
        `agent modified ${label}; the mount is disposable — rescued to \`${dest || '(no pipeline dir)'}\`; ` +
        `apply it to \`${e.source || 'the real dir'}\` manually if intended.`,
      );
    } catch { /* rescue is best-effort per entry */ }
  }
  return warnings;
}

/**
 * §8.11 stray scan. Anything at the run root outside RUN_ROOT_KNOWN_SET is copied
 * to `<pipelineDir>/stray/` with a loud warning, so the guarded removal below can
 * never silently lose an agent's misplaced write. Never throws.
 * @returns {Promise<string[]>} warnings
 */
export async function scanStrayEntries({ runRoot, pipelineDir } = {}) {
  const warnings = [];
  if (!runRoot) return warnings;
  let entries;
  try { entries = await readdir(runRoot, { withFileTypes: true }); } catch { return warnings; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (RUN_ROOT_KNOWN_SET.has(e.name)) continue;
    const src = join(runRoot, e.name);
    const dest = pipelineDir ? join(pipelineDir, 'stray', e.name) : null;
    try {
      if (dest) {
        await mkdir(dirname(dest), { recursive: true });
        await cp(src, dest, { recursive: true, force: true, dereference: true });
      }
    } catch { /* best-effort */ }
    warnings.push(
      `unexpected entry \`${e.name}\` at the run root (agents must write inside repos/); ` +
      `rescued to \`${dest || '(no pipeline dir)'}\`.`,
    );
  }
  return warnings;
}

/**
 * §5.2 durable ledger: copy `<runRoot>/run.json` to `<pipelineDir>/run.json`
 * BEFORE the run root is removed. Never throws.
 * @returns {Promise<boolean>} true when the copy landed
 */
export async function copyRunManifestTo(runRoot, pipelineDir) {
  if (!runRoot || !pipelineDir) return false;
  try {
    await stat(runManifestPath(runRoot));
    await mkdir(pipelineDir, { recursive: true });
    await cp(runManifestPath(runRoot), join(pipelineDir, RUN_MANIFEST_FILE), { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove every injected path from one checkout (teardown per-member step 4), so
 * nothing worca-cc created can be committed dangling or outlive the run. Prunes an
 * emptied `.claude` tree too. `claudeMdSection` entries are skipped — their file is
 * the user's tracked CLAUDE.md (the fence strip of step 2 is what cleans those).
 * Never throws.
 */
export async function removeInjectedPaths(baseDir, entries) {
  if (!baseDir || !Array.isArray(entries)) return;
  const parents = new Set();
  for (const e of entries) {
    if (!e?.path || e.kind === 'claudeMdSection') continue;
    try { await rm(join(baseDir, e.path), { recursive: true, force: true }); } catch { /* best-effort */ }
    let rel = dirname(e.path);
    while (rel && rel !== '.' && rel !== sep) { parents.add(rel); rel = dirname(rel); }
  }
  // Deepest-first so an emptied `.claude/skills` is pruned before `.claude`.
  for (const rel of [...parents].sort((a, b) => b.length - a.length)) {
    try {
      const abs = join(baseDir, rel);
      const left = await readdir(abs);
      if (!left.length) await rm(abs, { recursive: true, force: true });
    } catch { /* best-effort */ }
  }
}
