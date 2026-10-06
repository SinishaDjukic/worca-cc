// src/core/settings.mjs
// Global Worca CC settings, persisted at a FIXED bootstrap location that never
// moves: <home>/.worca-cc/settings.json. Keys:
//   root                   — base folder under which Worca CC keeps its .worca-cc
//                            data dir (history store, projects.json, workflows);
//                            projects.mjs#worcaHome() reads it to resolve where
//                            everything lives.
//   runRootMode            — §10 master switch, 'detached' | 'legacy'.
//   projectsRoot           — §5.1 the top-level folder the user's projects live
//                            under; the root layer of generated run context.
//   contextMaxBytesPerFile — §5.4 per-source-file inlining cap.
//   contextMaxBytesTotal   — §5.4 total memory budget.
//   skillMount             — §5.6 'copy' (default) | 'symlink' (opt-in).
//   debugSpawnEnabled      — the stored spawn-diagnostics preference (a UI checkbox).
//                            claude-runner.mjs reads it fresh on every spawn through
//                            effectiveDebugSpawn(), so it applies to the UI server AND
//                            to CLI runs with no restart. A NON-EMPTY WORCA_DEBUG_SPAWN
//                            in the process environment overrides it (power-user
//                            override); this module never writes process.env.
//   pipelineCostLimitUsd   — per-pipeline lifetime USD spend cap; unset = no limit.
//   totalCostLimitUsd      — windowed all-pipelines USD spend cap; unset = no limit.
//   costLimitResetPeriod   — total-budget window, 'weekly' | 'monthly' (default).
//   pythonPath             — §7 of the scripts-workbench spec: the python
//                            interpreter the script-card probe tries after
//                            WORCA_PYTHON and before the platform defaults.
//   models                 — the global model catalog (configurable-models-design.md
//                            §4.1): [{id, label?, efforts?, env?}]. Entries shadow
//                            PREDEFINED_MODELS by id; env is per-model routing env
//                            merged into the claude spawn (reserved keys rejected).
// All of them are OPTIONAL and read through the same read-modify-write object, so
// a new key needs no migration and never disturbs the others (unknown keys — e.g.
// written by a newer version — survive a write by the same property).
//
// node:sqlite migration note: `root` deliberately stays here in settings.json and
// is NOT moved into the DB — it is the bootstrap that LOCATES the DB file
// (worcaHome()/worca-cc.db), so it cannot live inside the DB (chicken/egg). The
// v1 schema has no settings table by design; every key above is either a
// bootstrap value or a plain scalar toggle, so a table would buy nothing.
//
// IMPORTANT: this module imports NOTHING from the core graph (Node builtins
// plus the zero-import model-env.mjs and night/config.mjs leaves and the
// web-allowlist.mjs leaf, which imports only node:net and node:url). projects.mjs imports it, so
// importing projects.mjs back would make worcaHome() -> getWorcaRoot() ->
// projects.mjs an infinite cycle.
//
// Reads are synchronous + never-throwing (worcaHome's callers are sync). There
// is deliberately no in-module cache: worcaHome() is read fresh per operation,
// so a saved root takes effect for new runs/listing without a server restart.

import { mkdir, writeFile, rename } from 'node:fs/promises';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  EFFORTS, CODEX_EFFORTS, effortsForEngine, MODEL_ENGINES, RUN_ENGINES, SUBAGENT_MODELS, isReservedModelEnvKey, assertModelCost, envFlag,
  assertModelUpstream, upstreamEnvConflict, modelEnvRef, codexUpstreamProblem,
  UPSTREAM_PROVIDERS, COPILOT_ACCOUNT_TYPES, DEFAULT_PROVIDER_CONCURRENCY, MAX_PROVIDER_CONCURRENCY,
  COPILOT_TERMS_VERSION, isUpstreamBaseUrl,
} from './model-env.mjs';
import { CODEX_PRICES } from './list-prices.mjs';
import { validateNightPatch, NIGHT_TOGGLES } from './night/config.mjs';
import { normalizeDomainList, normalizeDomainPattern, domainError, DOMAIN_LIST_MAX, RESERVED_KEY_VAR } from './web-allowlist.mjs';

/**
 * The real OS home base, honoring HOME/USERPROFILE so tests can sandbox it.
 * This is the DEFAULT Worca CC root when nothing is configured, and the parent
 * of the fixed settings file. (Mirrors normalizeProjectPath's tilde idiom.)
 */
export function defaultRoot() {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

/** Fixed bootstrap path — ALWAYS under defaultRoot(), never the movable root. */
export function settingsFile() {
  return join(defaultRoot(), '.worca-cc', 'settings.json');
}

/** Read settings synchronously. Missing/corrupt/non-object -> {}. Never throws. */
export function readSettings() {
  try {
    const data = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/** The configured root base, or '' when unset/blank. Synchronous, never throws. */
export function getWorcaRoot() {
  const r = readSettings().root;
  return typeof r === 'string' && r.trim() ? r : '';
}

export const DEFAULT_RUN_ROOT_MODE = 'detached'; // Phase-5 flip landed; WORCA_RUN_ROOT=legacy is the §10 rollback

/** Effective run-root mode. Precedence: WORCA_RUN_ROOT env → settings.runRootMode →
 *  DEFAULT_RUN_ROOT_MODE. Values are validated to 'detached' | 'legacy'; anything
 *  else falls back to the default with a console warning naming the bad value.
 *  Read FRESH on every call — never cached at module load (tests pin the env per
 *  test; the orchestrator reads it exactly once per pipeline, at _setupRunRoot). */
export function runRootMode() {
  const env = process.env.WORCA_RUN_ROOT;
  const cfg = readSettings().runRootMode;
  const raw = (env && env.trim()) || (typeof cfg === 'string' && cfg.trim()) || DEFAULT_RUN_ROOT_MODE;
  if (raw === 'detached' || raw === 'legacy') return raw;
  console.warn(`[worca] invalid run-root mode ${JSON.stringify(raw)} — using ${DEFAULT_RUN_ROOT_MODE}`);
  return DEFAULT_RUN_ROOT_MODE;
}

function expandTilde(p) {
  return p.startsWith('~') ? join(defaultRoot(), p.slice(1)) : p;
}

/**
 * Atomically persist the whole settings object (temp+rename), pre-creating the
 * fixed bootstrap dir the settings file lives in. Every setter below funnels
 * through here, so they all share one write shape and one atomicity guarantee.
 * Callers pass the object they got from readSettings() with their own key
 * added/deleted — that read-modify-write is what makes unknown keys survive
 * (no migration, no key loss; §5.1 storage note).
 */
async function persistSettings(settings) {
  await mkdir(join(defaultRoot(), '.worca-cc'), { recursive: true }); // bootstrap dir
  const file = settingsFile();
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  await rename(tmp, file);
}

/**
 * Persist the chosen root base. Pass '' / null / non-string to CLEAR it (reset
 * to default). A non-empty value is resolved to an absolute path and validated:
 * it must not be an existing non-directory, and <base>/.worca-cc must be
 * creatable (this both validates writability and pre-creates the dir). Atomic
 * temp+rename. Returns { root, default } describing the resulting state.
 * @throws {Error} when the path cannot be used as a root.
 */
export async function setWorcaRoot(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  const settings = readSettings();

  if (!raw) {
    delete settings.root; // reset to default
  } else {
    const base = resolve(expandTilde(raw));
    if (existsSync(base) && !statSync(base).isDirectory()) {
      throw new Error('path is not a directory');
    }
    try {
      await mkdir(join(base, '.worca-cc'), { recursive: true });
    } catch (err) {
      throw new Error(`cannot use this folder as the Worca CC root: ${err.message}`);
    }
    settings.root = base;
  }

  await persistSettings(settings);
  return { root: settings.root || '', default: defaultRoot() };
}

// ---------------------------------------------------------------------------
// §5.1 projectsRoot — "the top-level folder under which your projects live".
//
// DELIBERATELY NOT derived from `root`: `root` means "where worca-cc's data
// lives", so relocating the data dir to an external volume must not silently
// relocate the user's instruction root.
// ---------------------------------------------------------------------------

/**
 * The effective projects root. Precedence: WORCA_PROJECTS_ROOT env →
 * settings.projectsRoot → defaultRoot(). ALWAYS an absolute path (never '',
 * unlike getWorcaRoot()) — the root context layer must always have a base.
 *
 * Only the SETTER validates dir-ness. The env tier passes through unchecked, so a
 * WORCA_PROJECTS_ROOT pointing at a nonexistent path degrades at *read* time
 * (the root layer contributes nothing + one named warning, §8.20) instead of
 * throwing here. Read fresh on every call — never cached.
 */
export function getProjectsRoot() {
  const env = process.env.WORCA_PROJECTS_ROOT;
  if (env && env.trim()) return resolve(expandTilde(env.trim()));
  const r = readSettings().projectsRoot;
  return typeof r === 'string' && r.trim() ? resolve(expandTilde(r.trim())) : defaultRoot();
}

/**
 * The RAW persisted projectsRoot — '' when the key is absent, blank, or not a
 * string. The exact mirror of getWorcaRoot(), and what the settings UI puts in
 * its field: "unset" must stay distinguishable from "explicitly set", so a blank
 * field can round-trip as blank and the "leave blank to use your home folder"
 * affordance is real.
 *
 * DELIBERATELY ignores the WORCA_PROJECTS_ROOT env tier: the env is an
 * override, not a setting, and surfacing it as the field value would let a plain
 * Save promote it into settings.json — persisting a root the user never authored
 * and outliving the env var. Runs still resolve through getProjectsRoot(), which
 * is the sole authority on the EFFECTIVE value and is unchanged by this reader.
 */
export function rawProjectsRoot() {
  const r = readSettings().projectsRoot;
  return typeof r === 'string' && r.trim() ? resolve(expandTilde(r.trim())) : '';
}

/**
 * What applies when projectsRoot is left blank — the env tier if it is exported,
 * else defaultRoot(). This is the settings-UI placeholder, i.e. the honest answer
 * to "what do I get if I clear this field?", and it is why the API cannot just
 * reuse `default` (which is defaultRoot(), the worca-cc root default, and would
 * lie whenever WORCA_PROJECTS_ROOT is set).
 *
 * Mirrors the first and last tiers of getProjectsRoot()'s precedence; that
 * function stays the single source of truth for the effective value consumed by
 * a run and is intentionally left untouched.
 */
export function defaultProjectsRoot() {
  const env = process.env.WORCA_PROJECTS_ROOT;
  if (env && env.trim()) return resolve(expandTilde(env.trim()));
  return defaultRoot();
}

/**
 * Persist the projects root. Pass '' / null / non-string to CLEAR it (reset to
 * defaultRoot()). A non-empty value is `~`-expanded, resolved absolute, and must
 * be an EXISTING directory — worca-cc never writes anything under projectsRoot
 * (this is the one divergence from setWorcaRoot, which pre-creates
 * <base>/.worca-cc to prove writability; there is nothing to pre-create here, and
 * silently mkdir-ing a mistyped path would be worse than rejecting it).
 * Atomic temp+rename over the same read-modify-write object, so `root` and every
 * other/unknown key survive.
 * @returns {{projectsRoot: string, default: string}} the RAW persisted state
 *   ('' after a reset), exactly as setWorcaRoot reports `root`. Raw, not
 *   effective, so a save round-trips to what the caller typed — a blank stays
 *   blank instead of echoing the default (or an env override) back as if it had
 *   been stored. `default` is what applies when it is blank (defaultProjectsRoot).
 * @throws {Error} when the path cannot be used as the projects root.
 */
export async function setProjectsRoot(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  const settings = readSettings();

  if (!raw) {
    delete settings.projectsRoot; // reset to default
  } else {
    const base = resolve(expandTilde(raw));
    if (!existsSync(base)) throw new Error('path does not exist');
    if (!statSync(base).isDirectory()) throw new Error('path is not a directory');
    settings.projectsRoot = base;
  }

  await persistSettings(settings);
  return { projectsRoot: settings.projectsRoot || '', default: defaultProjectsRoot() };
}

// ---------------------------------------------------------------------------
// §5.4 / §5.6 scalars. Settings-file-only in this change (no UI field, no API):
// the escape hatch for a member whose memory exceeds a cap, and the opt-in
// write-through skill mount. Readers mirror runRootMode(): validate, and on an
// invalid hand-written value fall back to the default with a warning naming it
// (reads are never-throwing by this module's contract). Setters reject instead —
// a programmatic write of a bad value is a caller bug, not a degraded file.
// ---------------------------------------------------------------------------

export const DEFAULT_CONTEXT_MAX_BYTES_PER_FILE = 20480;  // 20 KB per source file
export const DEFAULT_CONTEXT_MAX_BYTES_TOTAL = 65536;     // 64 KB total memory budget
export const DEFAULT_SKILL_MOUNT = 'copy';                // 'symlink' is the opt-in variant

const SKILL_MOUNTS = ['copy', 'symlink'];

/** A byte cap must be a positive whole number of bytes; nothing else is meaningful. */
const isByteCap = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** Read a numeric cap key, falling back (loudly) to `fallback` on a bad value. */
function readByteCap(key, fallback) {
  const v = readSettings()[key];
  if (v === undefined) return fallback;
  if (isByteCap(v)) return v;
  console.warn(`[worca] invalid ${key} ${JSON.stringify(v)} — using ${fallback}`);
  return fallback;
}

/** Per-source-file inlining cap for generated run context (§5.4). */
export function contextMaxBytesPerFile(scope) {
  const p = projectOverride('contextMaxBytesPerFile', scope); if (p !== undefined) return p;
  return readByteCap('contextMaxBytesPerFile', DEFAULT_CONTEXT_MAX_BYTES_PER_FILE);
}

/** Total memory budget for generated run context (§5.4). */
export function contextMaxBytesTotal(scope) {
  const p = projectOverride('contextMaxBytesTotal', scope); if (p !== undefined) return p;
  return readByteCap('contextMaxBytesTotal', DEFAULT_CONTEXT_MAX_BYTES_TOTAL);
}

// ── Agent memory caps (agent-memory-design.md §2 / §12) ─────────────────────
export const DEFAULT_MEMORY_SOFT_BYTES_PER_FILE = 8192;    // flagged in health above this
export const DEFAULT_MEMORY_HARD_BYTES_PER_FILE = 32768;   // rejected at sync-back / write above this
export const DEFAULT_MEMORY_MAX_FILES_PER_SCOPE = 50;
export const DEFAULT_MEMORY_HOOK_MAX_CHARS = 160;

export const DEFAULT_MEMORY_DEFRAG_WRITES = 10;     // writesSinceDefrag at which a scope is "due"
export const DEFAULT_MEMORY_DEFRAG_FILES = 30;      // file count at which a scope is "due"
export const DEFAULT_MEMORY_DEFRAG_BYTES_PCT = 60;  // % of (maxFilesPerScope × softBytesPerFile) at which a scope is "due"
export const DEFAULT_MEMORY_DEFRAG_ALWAYS_ON_BYTES = 16384;  // bytes of path-less memory (loaded into EVERY agent's context) at which a scope is "due"

/** settings.json → { memory: { maxBytesPerFile, softBytesPerFile, maxFilesPerScope, hookMaxChars,
 *  defrag: { writes, files, bytesPct, alwaysOnBytes } } }. Every key optional; a bad value warns (naming the full key) and falls back. */
function memoryBlock() {
  const block = readSettings().memory;
  return block && typeof block === 'object' && !Array.isArray(block) ? block : {};
}
function readMemoryCap(key, fallback) {
  const v = memoryBlock()[key];
  if (v === undefined) return fallback;
  if (isByteCap(v)) return v;
  console.warn(`[worca] invalid memory.${key} ${JSON.stringify(v)} — using ${fallback}`);
  return fallback;
}
let warnedDefragBlock = false;   // module-level: the reader runs once per threshold key, the block is one mistake
/** `memory.defrag.<key>`: a positive integer; `bytesPct` additionally ≤ 100 (it is a share).
 *  A `defrag` that is not a plain object is one mistake, not three: warn ONCE and fall back. */
function readDefragThreshold(key, fallback, { pct = false } = {}) {
  const d = memoryBlock().defrag;
  const isBlock = Boolean(d) && typeof d === 'object' && !Array.isArray(d);
  if (d !== undefined && !isBlock) {
    if (!warnedDefragBlock) {
      warnedDefragBlock = true;
      console.warn(`[worca] invalid memory.defrag ${JSON.stringify(d)} — using the defaults`);
    }
    return fallback;
  }
  const v = isBlock ? d[key] : undefined;
  if (v === undefined) return fallback;
  if (isByteCap(v) && (!pct || v <= 100)) return v;
  console.warn(`[worca] invalid memory.defrag.${key} ${JSON.stringify(v)} — using ${fallback}`);
  return fallback;
}

/** The caps every memory reader/writer takes (memory-store.mjs, memory-sync.mjs). Read fresh per call.
 *  `defrag` is the health threshold block (agent-memory-design.md §8 / §12). */
export function memoryCaps(scope) {
  return {
    softBytesPerFile: projectOverride('memory.softBytesPerFile', scope) ?? readMemoryCap('softBytesPerFile', DEFAULT_MEMORY_SOFT_BYTES_PER_FILE),
    hardBytesPerFile: projectOverride('memory.maxBytesPerFile', scope) ?? readMemoryCap('maxBytesPerFile', DEFAULT_MEMORY_HARD_BYTES_PER_FILE),
    maxFilesPerScope: projectOverride('memory.maxFilesPerScope', scope) ?? readMemoryCap('maxFilesPerScope', DEFAULT_MEMORY_MAX_FILES_PER_SCOPE),
    hookMaxChars: projectOverride('memory.hookMaxChars', scope) ?? readMemoryCap('hookMaxChars', DEFAULT_MEMORY_HOOK_MAX_CHARS),
    defrag: {
      writes: projectOverride('memory.defrag.writes', scope) ?? readDefragThreshold('writes', DEFAULT_MEMORY_DEFRAG_WRITES),
      files: projectOverride('memory.defrag.files', scope) ?? readDefragThreshold('files', DEFAULT_MEMORY_DEFRAG_FILES),
      bytesPct: projectOverride('memory.defrag.bytesPct', scope) ?? readDefragThreshold('bytesPct', DEFAULT_MEMORY_DEFRAG_BYTES_PCT, { pct: true }),
      alwaysOnBytes: projectOverride('memory.defrag.alwaysOnBytes', scope) ?? readDefragThreshold('alwaysOnBytes', DEFAULT_MEMORY_DEFRAG_ALWAYS_ON_BYTES),
    },
  };
}

// ── Memory defragment model (Settings › Memory) ─────────────────────────────
// `memory.defrag.model` / `memory.defrag.effort`: the pair EVERY Memory defragment run uses
// (memory-defrag-model.mjs resolves it at run start; the setting is GLOBAL, there is no
// per-project variant). They share the `memory.defrag` block with the numeric health
// thresholds, but readDefragThreshold reads only its own four keys and memoryCaps() —
// which feeds every memory sync — never carries them.
const DEFRAG_MODEL_MAX_LEN = 200;
const UNSET_DEFRAG_MODEL = Object.freeze({ model: null, effort: null });
// The reader runs on every GET /api/settings, every memory report and every defragment run: a
// hand-edited bad value is one mistake — warn once per key + value, not once per request.
const warnedDefragModel = new Set();
function warnDefragModelOnce(key, value, tail) {
  const id = `${key}:${JSON.stringify(value)}`;
  if (warnedDefragModel.has(id)) return;
  warnedDefragModel.add(id);
  console.warn(`[worca] invalid memory.defrag.${key} ${JSON.stringify(value)} — ${tail}`);
}

/** The STORED pair: `{ model, effort }`, both null when unset (= the workflow default). Sync and
 *  never throws. An effort without a model means nothing and reads as unset; a bad value warns
 *  (once) and reads as unset. Under the node:test runner it reads unset unless the test sandboxes
 *  HOME and sets WORCA_TEST_ALLOW_HOME_FALLBACK (the listGlobalModels guard): settings.json lives
 *  under HOME, not WORCA_HOME, so a developer's own pick must never leak into a mock run. */
export function memoryDefragModel() {
  if (process.env.NODE_TEST_CONTEXT && !process.env.WORCA_TEST_ALLOW_HOME_FALLBACK) return { ...UNSET_DEFRAG_MODEL };
  const d = memoryBlock().defrag;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ...UNSET_DEFRAG_MODEL }; // readDefragThreshold warns about the block
  const m = d.model;
  if (m === undefined) return { ...UNSET_DEFRAG_MODEL };
  if (typeof m !== 'string' || !m.trim() || m.length > DEFRAG_MODEL_MAX_LEN) {
    warnDefragModelOnce('model', m, 'defragment runs use the workflow default');
    return { ...UNSET_DEFRAG_MODEL };
  }
  const e = d.effort;
  const effort = typeof e === 'string' && EFFORTS.includes(e) ? e : null;
  if (e !== undefined && effort === null) warnDefragModelOnce('effort', e, 'defragment runs use the model\'s default effort');
  return { model: m.trim(), effort };
}

/**
 * Validate a POST value: `{ model, effort }`, or null / '' to clear (a blank model clears the
 * effort with it). With `models` (the effective catalog) the model must name an entry — it comes
 * back in the catalog's casing — and the effort must be one that entry offers; without it the ids
 * pass as given (tests, callers that validated already).
 * @returns {{model:string, effort:(string|null)}|null} the pair to store, null to clear
 * @throws {Error} on a malformed value, an effort without a model, an unknown model or an effort
 *   the model does not offer
 */
export function assertMemoryDefragModelInput(input, models = null) {
  if (input === '' || input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('memoryDefrag must be { model, effort } or null');
  const blank = (v) => v === null || v === undefined || (typeof v === 'string' && !v.trim());
  if (blank(input.model)) {
    if (!blank(input.effort)) throw new Error('memoryDefrag.effort needs a model — an effort without a model means nothing');
    return null;
  }
  if (typeof input.model !== 'string' || !input.model.trim() || input.model.length > DEFRAG_MODEL_MAX_LEN) {
    throw new Error('memoryDefrag.model must be a catalog model id');
  }
  const effortIn = typeof input.effort === 'string' ? input.effort.trim() : input.effort;   // trimmed like setNodeModel / checkStartPair
  if (!blank(effortIn) && !EFFORTS.includes(effortIn)) {
    throw new Error(`memoryDefrag.effort must be one of ${EFFORTS.join(' | ')}`);
  }
  let model = input.model.trim();
  const effort = blank(effortIn) ? null : effortIn;
  if (Array.isArray(models)) {
    const hit = models.find((m) => m && typeof m.id === 'string' && m.id.toLowerCase() === model.toLowerCase());
    if (!hit) throw new Error(`unknown model "${model}" — add it to the catalog first`);
    model = hit.id;
    if (effort && !(Array.isArray(hit.efforts) && hit.efforts.includes(effort))) {
      throw new Error(`${model} does not offer effort "${effort}"`);
    }
  }
  return { model, effort };
}

/** Store (or, on null / a blank model, clear) the pair — read-modify-write of the `memory` block,
 *  so the health thresholds and every other memory key survive. A block left empty is removed. */
export async function setMemoryDefragModel(input, { models = null } = {}) {
  const pair = assertMemoryDefragModelInput(input, models);
  const settings = readSettings();
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const memory = isObj(settings.memory) ? { ...settings.memory } : {};
  const defrag = isObj(memory.defrag) ? { ...memory.defrag } : {};
  delete defrag.model;
  delete defrag.effort;
  if (pair) {
    defrag.model = pair.model;
    if (pair.effort) defrag.effort = pair.effort;
  }
  if (Object.keys(defrag).length) memory.defrag = defrag; else delete memory.defrag;
  if (Object.keys(memory).length) settings.memory = memory; else delete settings.memory;
  await persistSettings(settings);
  return { memoryDefrag: memoryDefragModel() };
}

// `workspaces.scan`: the models a Workspace scan starts with (Settings › Runs › Workspaces) —
// the scan agent's catalog model + effort and its project agents' sub-agent alias + effort. Unset
// = WORKSPACE_SCAN_DEFAULT_MODELS (builtin-workflows.mjs). Create workspace can override it for one
// scan; Re-scan uses it (workspace-scan-run.mjs resolveScanModels).
const warnedWorkspaceScan = new Set();

/** The STORED pick, or null when unset or unreadable (a bad hand edit warns once and reads unset).
 *  The memoryDefragModel node:test guard: settings.json lives under HOME, not WORCA_HOME. */
export function workspaceScanModels() {
  if (process.env.NODE_TEST_CONTEXT && !process.env.WORCA_TEST_ALLOW_HOME_FALLBACK) return null;
  const s = readSettings();
  const raw = s && s.workspaces && typeof s.workspaces === 'object' && !Array.isArray(s.workspaces) ? s.workspaces.scan : undefined;
  if (raw === undefined) return null;
  try {
    return assertWorkspaceScanInput(raw);
  } catch (err) {
    const id = JSON.stringify(raw);
    if (!warnedWorkspaceScan.has(id)) {
      warnedWorkspaceScan.add(id);
      console.warn(`[worca] invalid workspaces.scan ${id} — ${err.message}; scans use the default models`);
    }
    return null;
  }
}

/**
 * Validate `{ scanModel, scanEffort, agentModel, agentEffort }`, or null / '' to clear. The scan
 * model is a catalog id — with `models` it must name an entry (catalog casing back) that offers
 * scanEffort; a blank scanEffort means the model's default. The project agents' model is a
 * sub-agent alias: the Task tool takes aliases only (model-env.mjs SUBAGENT_MODELS).
 * @returns {{scanModel:string, scanEffort:(string|null), agentModel:string, agentEffort:string}|null}
 * @throws {Error} on any malformed field, an unknown model or an effort the model does not offer
 */
export function assertWorkspaceScanInput(input, models = null) {
  if (input === '' || input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('workspaceScan must be { scanModel, scanEffort, agentModel, agentEffort } or null');
  }
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  let scanModel = s(input.scanModel);
  const scanEffort = s(input.scanEffort) || null;
  const agentModel = s(input.agentModel);
  const agentEffort = s(input.agentEffort);
  if (!scanModel || scanModel.length > DEFRAG_MODEL_MAX_LEN) throw new Error('workspaceScan.scanModel must be a catalog model id');
  if (scanEffort && !EFFORTS.includes(scanEffort)) throw new Error(`workspaceScan.scanEffort must be one of ${EFFORTS.join(' | ')}`);
  if (!SUBAGENT_MODELS.includes(agentModel)) throw new Error(`workspaceScan.agentModel must be one of ${SUBAGENT_MODELS.join(' | ')}`);
  if (!EFFORTS.includes(agentEffort)) throw new Error(`workspaceScan.agentEffort must be one of ${EFFORTS.join(' | ')}`);
  if (Array.isArray(models)) {
    const hit = models.find((m) => m && typeof m.id === 'string' && m.id.toLowerCase() === scanModel.toLowerCase());
    if (!hit) throw new Error(`unknown model "${scanModel}" — add it to the catalog first`);
    scanModel = hit.id;
    if (scanEffort && !(Array.isArray(hit.efforts) && hit.efforts.includes(scanEffort))) {
      throw new Error(`${scanModel} does not offer effort "${scanEffort}"`);
    }
  }
  return { scanModel, scanEffort, agentModel, agentEffort };
}

/** Store (or, on null, clear) the pick — read-modify-write of the `workspaces` block. */
export async function setWorkspaceScanModels(input, { models = null } = {}) {
  const pick = assertWorkspaceScanInput(input, models);
  const settings = readSettings();
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const ws = isObj(settings.workspaces) ? { ...settings.workspaces } : {};
  if (pick) ws.scan = pick; else delete ws.scan;
  if (Object.keys(ws).length) settings.workspaces = ws; else delete settings.workspaces;
  await persistSettings(settings);
  return { workspaceScan: workspaceScanModels() };
}

/** Skill delivery mechanism (§5.6): 'copy' (default, isolated) | 'symlink' (write-through). */
export function skillMount(scope) {
  const p = projectOverride('skillMount', scope); if (p !== undefined) return p;
  const v = readSettings().skillMount;
  if (v === undefined) return DEFAULT_SKILL_MOUNT;
  if (SKILL_MOUNTS.includes(v)) return v;
  console.warn(`[worca] invalid skillMount ${JSON.stringify(v)} — using ${DEFAULT_SKILL_MOUNT}`);
  return DEFAULT_SKILL_MOUNT;
}

/** Write (or, on '' / null / undefined input, delete) a numeric cap key. */
async function setByteCap(key, input, fallback) {
  const settings = readSettings();
  if (input === '' || input === null || input === undefined) {
    delete settings[key];                       // reset to the built-in default
  } else if (isByteCap(input)) {
    settings[key] = input;
  } else {
    throw new Error(`${key} must be a positive integer number of bytes`);
  }
  await persistSettings(settings);
  return { [key]: readByteCap(key, fallback) }; // the EFFECTIVE value
}

/** @throws {Error} unless `input` is a positive integer (or empty, which resets). */
export const setContextMaxBytesPerFile = (input) =>
  setByteCap('contextMaxBytesPerFile', input, DEFAULT_CONTEXT_MAX_BYTES_PER_FILE);

/** @throws {Error} unless `input` is a positive integer (or empty, which resets). */
export const setContextMaxBytesTotal = (input) =>
  setByteCap('contextMaxBytesTotal', input, DEFAULT_CONTEXT_MAX_BYTES_TOTAL);

/** @throws {Error} unless `input` is 'copy' | 'symlink' (or empty, which resets). */
export async function setSkillMount(input) {
  const settings = readSettings();
  if (input === '' || input === null || input === undefined) {
    delete settings.skillMount;                 // reset to 'copy'
  } else if (SKILL_MOUNTS.includes(input)) {
    settings.skillMount = input;
  } else {
    throw new Error(`skillMount must be one of ${SKILL_MOUNTS.join(' | ')}`);
  }
  await persistSettings(settings);
  return { skillMount: skillMount() };
}

// ---------------------------------------------------------------------------
// Cost limits (spec 2026-08-07). Readers fall back loudly to null (= no limit)
// or the default period; setters throw; '' / null / undefined clears the key.

export const COST_RESET_PERIODS = ['weekly', 'monthly'];
export const DEFAULT_COST_RESET_PERIOD = 'monthly';

/** A USD cap is a positive finite number (fractional dollars allowed). */
const isUsdCap = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Read a USD cap key: number, or null = unlimited. */
function readUsdCap(key) {
  const v = readSettings()[key];
  if (v === undefined) return null;
  if (isUsdCap(v)) return v;
  console.warn(`[worca] invalid ${key} ${JSON.stringify(v)} — treating as unset (no limit)`);
  return null;
}

/** Per-pipeline lifetime spend cap in USD, or null (no limit). */
export function pipelineCostLimitUsd(scope) { return projectOverride('pipelineCostLimitUsd', scope) ?? readUsdCap('pipelineCostLimitUsd'); }
/** Windowed all-pipelines spend cap in USD, or null (no limit). */
export function totalCostLimitUsd() { return readUsdCap('totalCostLimitUsd'); }

/** Estimator constant overrides (money-saved design §4): `humanEstimate: { codeDiv: 40, … }`,
 *  or {}. Validation is the estimator's resolveConstants (unknown keys ignored). */
export function humanEstimateOverrides() {
  const v = readSettings().humanEstimate;
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/** Reset period for the total budget window: 'weekly' (Mon 00:00) | 'monthly' (1st 00:00). */
export function costLimitResetPeriod() {
  const v = readSettings().costLimitResetPeriod;
  if (v === undefined) return DEFAULT_COST_RESET_PERIOD;
  if (COST_RESET_PERIODS.includes(v)) return v;
  console.warn(`[worca] invalid costLimitResetPeriod ${JSON.stringify(v)} — using ${DEFAULT_COST_RESET_PERIOD}`);
  return DEFAULT_COST_RESET_PERIOD;
}

/** '' / null / undefined all mean "clear this key" on the write path. */
const isClearInput = (v) => v === '' || v === null || v === undefined;

/** @throws {Error} unless `input` is a positive finite number (or a clear). */
function assertUsdCapInput(key, input) {
  if (!isClearInput(input) && !isUsdCap(input)) {
    throw new Error(`${key} must be a positive number of USD`);
  }
}

/** @throws {Error} unless `input` is 'weekly' | 'monthly' (or a clear). */
function assertResetPeriodInput(input) {
  if (!isClearInput(input) && !COST_RESET_PERIODS.includes(input)) {
    throw new Error(`costLimitResetPeriod must be one of ${COST_RESET_PERIODS.join(' | ')}`);
  }
}

/**
 * Validate a whole cost-limit write SET before any of it is persisted. The three
 * setters each persist on their own, so a multi-key write whose second key is
 * invalid would otherwise leave the first one on disk and still fail — a caller
 * that reports the failure (and repaints its pre-save values) would then be out of
 * sync with a half-applied settings file. Only the keys PRESENT on `inputs` are
 * checked; a key set to undefined means "clear", so use hasOwnProperty semantics
 * at the call site to decide what to include.
 * @param {{pipelineCostLimitUsd?: *, totalCostLimitUsd?: *, costLimitResetPeriod?: *}} inputs
 * @throws {Error} on the first invalid input
 */
export function assertCostLimitInputs(inputs = {}) {
  const has = (k) => Object.prototype.hasOwnProperty.call(inputs, k);
  if (has('pipelineCostLimitUsd')) assertUsdCapInput('pipelineCostLimitUsd', inputs.pipelineCostLimitUsd);
  if (has('totalCostLimitUsd')) assertUsdCapInput('totalCostLimitUsd', inputs.totalCostLimitUsd);
  if (has('costLimitResetPeriod')) assertResetPeriodInput(inputs.costLimitResetPeriod);
}

// ── Ask Worca per-turn limits (ask-worca-design.md §6.9, D12) ────────────────
// Two keys, both read fresh on every chat turn. `askMaxTurns` is an integer cap
// on claude's agentic turns (--max-turns); `askMaxBudgetUsd` is the per-turn
// dollar cap (--max-budget-usd). For the budget key the literal `null` is a
// STORED value meaning "no cap" (the flag is omitted), while '' / undefined clear
// the key back to the default — the two semantics the design assigns to that key.
// The defaults are 400 turns and NO cost cap: the default budget is itself `null`,
// so an absent or invalid stored budget also means "no cap".
export const DEFAULT_ASK_MAX_TURNS = 400;
export const DEFAULT_ASK_MAX_BUDGET_USD = null;

const isAskMaxTurns = (v) => Number.isSafeInteger(v) && v >= 1 && v <= 500;
const isAskMaxBudget = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0.1 && v <= 100;

/** --max-turns for one chat turn: integer 1..500; absent/invalid ⇒ the default (loudly). */
export function askMaxTurns(scope) {
  const p = projectOverride('askMaxTurns', scope); if (p !== undefined) return p;
  const v = readSettings().askMaxTurns;
  if (v === undefined) return DEFAULT_ASK_MAX_TURNS;
  if (isAskMaxTurns(v)) return v;
  console.warn(`[worca] invalid askMaxTurns ${JSON.stringify(v)} — using the default (${DEFAULT_ASK_MAX_TURNS})`);
  return DEFAULT_ASK_MAX_TURNS;
}

/** --max-budget-usd for one chat turn: number 0.1..100, or null = no cap; absent/invalid ⇒ the default, no cap (loudly). */
export function askMaxBudgetUsd(scope) {
  const p = projectOverride('askMaxBudgetUsd', scope); if (p !== undefined) return p;
  const v = readSettings().askMaxBudgetUsd;
  if (v === undefined) return DEFAULT_ASK_MAX_BUDGET_USD;
  if (v === null) return null;
  if (isAskMaxBudget(v)) return v;
  console.warn(`[worca] invalid askMaxBudgetUsd ${JSON.stringify(v)} — using the default (${DEFAULT_ASK_MAX_BUDGET_USD ?? 'no cap'})`);
  return DEFAULT_ASK_MAX_BUDGET_USD;
}

function assertAskMaxTurnsInput(input) {
  if (!isClearInput(input) && !isAskMaxTurns(input)) {
    throw new Error('askMaxTurns must be an integer between 1 and 500');
  }
}
function assertAskMaxBudgetInput(input) {
  if (input === '' || input === undefined || input === null) return; // clear, or stored no-cap
  if (!isAskMaxBudget(input)) {
    throw new Error('askMaxBudgetUsd must be null (no cap) or a number between 0.1 and 100');
  }
}

/** Validate the ask keys PRESENT in `inputs` as a set, before any write (assertCostLimitInputs pattern). */
export function assertAskLimitInputs(inputs = {}) {
  const has = (k) => Object.prototype.hasOwnProperty.call(inputs, k);
  if (has('askMaxTurns')) assertAskMaxTurnsInput(inputs.askMaxTurns);
  if (has('askMaxBudgetUsd')) assertAskMaxBudgetInput(inputs.askMaxBudgetUsd);
}

export async function setAskMaxTurns(input) {
  assertAskMaxTurnsInput(input);
  const settings = readSettings();
  if (isClearInput(input)) delete settings.askMaxTurns;
  else settings.askMaxTurns = input;
  await persistSettings(settings);
  return { askMaxTurns: askMaxTurns() };
}

export async function setAskMaxBudgetUsd(input) {
  assertAskMaxBudgetInput(input);
  const settings = readSettings();
  if (input === '' || input === undefined) delete settings.askMaxBudgetUsd;
  else settings.askMaxBudgetUsd = input;          // a number, or the literal null (no cap)
  await persistSettings(settings);
  return { askMaxBudgetUsd: askMaxBudgetUsd() };
}

// ── Ask Worca web access (docs/guardrails.md "Web access") ─────────────────────────────────
// `askWeb` = { enabled, allowedDomains, search? }. Off by default; the allowlist is enforced by
// worca's own MCP server (web-fetch.mjs). The search key is only ever a ${VAR} reference read from
// worca's environment — a literal key is refused so settings.json never holds one.
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function normalizeAskWebSearch(s) {
  if (s === null || s === undefined || s === '') return null;
  if (!isObj(s)) throw new Error('askWeb.search must be an object or null');
  const url = typeof s.url === 'string' ? s.url.trim() : '';
  if (!url) return null;                                     // an empty URL field = search off
  let u; try { u = new URL(url.replace('{query}', 'q').replace('{key}', 'k')); } catch { throw new Error('askWeb.search.url is not a valid URL'); }
  if (u.protocol !== 'https:') throw new Error('askWeb.search.url must be an https URL');
  if (u.username || u.password) throw new Error('askWeb.search.url must not carry credentials');
  if (!url.includes('{query}')) throw new Error('askWeb.search.url must contain {query}');
  if (url.length > 500) throw new Error('askWeb.search.url is longer than 500 characters');
  const key = typeof s.key === 'string' ? s.key.trim() : '';
  const keyVar = key ? modelEnvRef(key) : null;
  if (key && !keyVar) throw new Error('askWeb.search.key must be a ${VAR} reference — worca never stores a search API key in settings.json');
  if (keyVar && RESERVED_KEY_VAR.test(keyVar)) throw new Error(`askWeb.search.key: ${keyVar} is a reserved variable name`);
  const keyHeader = typeof s.keyHeader === 'string' ? s.keyHeader.trim() : '';
  if (keyHeader && !/^[A-Za-z0-9-]{1,64}$/.test(keyHeader)) throw new Error('askWeb.search.keyHeader must be an HTTP header name');
  const keyPrefix = typeof s.keyPrefix === 'string' ? s.keyPrefix : '';
  if (keyPrefix.length > 20 || /[\r\n]/.test(keyPrefix)) throw new Error('askWeb.search.keyPrefix must be at most 20 characters on one line');
  if ((keyHeader || url.includes('{key}')) && !keyVar) throw new Error('askWeb.search.key is required when a key header or {key} is used');
  return { url, key, keyVar, keyHeader, keyPrefix };
}

/** Throws a 400-able message; returns the normalized value. */
export function assertAskWebInput(input) {
  if (!isObj(input)) throw new Error('askWeb must be an object');
  if (typeof input.enabled !== 'boolean') throw new Error('askWeb.enabled must be true or false');
  if (input.anyHost !== undefined && typeof input.anyHost !== 'boolean') throw new Error('askWeb.anyHost must be true or false');
  if (!Array.isArray(input.allowedDomains)) throw new Error('askWeb.allowedDomains must be a list');
  if (input.allowedDomains.length > DOMAIN_LIST_MAX) throw new Error(`askWeb.allowedDomains holds at most ${DOMAIN_LIST_MAX} entries`);
  const { domains, invalid } = normalizeDomainList(input.allowedDomains);
  if (invalid.length) throw new Error(`askWeb.allowedDomains: ${domainError(invalid[0])}`);
  return { enabled: input.enabled, anyHost: input.anyHost === true, allowedDomains: domains, search: normalizeAskWebSearch(input.search) };
}

let askWebWarned = null;
/** The local Ask web settings; invalid stored data falls back to off (never throws). */
export function askWeb(scope) {
  const p = projectOverride('askWeb', scope);
  const raw = p !== undefined ? p : readSettings().askWeb;
  const off = { enabled: false, anyHost: false, allowedDomains: [], search: null };
  if (raw === undefined || raw === null) return off;
  try { return assertAskWebInput(isObj(raw) ? { enabled: raw.enabled, anyHost: raw.anyHost ?? false, allowedDomains: raw.allowedDomains ?? [], search: raw.search ?? null } : raw); }
  catch (err) {
    // Read on every turn and settings view: warn once per distinct problem, not on every read.
    if (err.message !== askWebWarned) { askWebWarned = err.message; console.warn(`[worca] invalid askWeb setting (${err.message}) — web access stays off`); }
    return off;
  }
}

/** The stored shape shared by the user and project layers. */
export function askWebStoreShape(next) {
  return {
    enabled: next.enabled,
    ...(next.anyHost ? { anyHost: true } : {}),
    allowedDomains: next.allowedDomains,
    ...(next.search ? { search: { url: next.search.url, key: next.search.key, keyHeader: next.search.keyHeader, keyPrefix: next.search.keyPrefix } } : {}),
  };
}

/** Stores exactly what the user saved; `null` clears the key (back to "unset" = off). */
export async function setAskWeb(input) {
  const settings = readSettings();
  if (input === null) { delete settings.askWeb; await persistSettings(settings); return { askWeb: askWeb() }; }
  settings.askWeb = askWebStoreShape(assertAskWebInput(input));
  await persistSettings(settings);
  return { askWeb: askWeb() };
}

// ── Night mode (src/core/night/*) ─────────────────────────────────────────────
// `nightMode` is the user layer of the night config (only the fields the user set);
// `nightModeToggle` is the live global switch and is NOT part of the field precedence.
const nightModeWarned = new Set();

/** The user's night mode layer: only the fields the user set (validated; bad fields dropped). */
export function nightModeSettings() {
  const raw = readSettings().nightMode;
  if (!isObj(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    try { Object.assign(out, validateNightPatch({ [k]: v })); }
    catch {
      if (!nightModeWarned.has(k)) { nightModeWarned.add(k); console.warn(`[worca] ignoring invalid nightMode.${k} in settings.json`); }
    }
  }
  return out;
}

/** Merge a patch into settings.nightMode. `null` clears the whole block; a key listed in
 *  `patch.__unset` (array of field names) is removed so the team value applies again. */
export async function setNightMode(patch) {
  const settings = readSettings();
  if (patch === null) { delete settings.nightMode; return persistSettings(settings); }
  const { __unset = [], ...rest } = patch || {};
  const clean = validateNightPatch(rest, { level: 'user' });
  const next = { ...(isObj(settings.nightMode) ? settings.nightMode : {}), ...clean };
  for (const k of Array.isArray(__unset) ? __unset : []) delete next[k];
  if (Object.keys(next).length) settings.nightMode = next; else delete settings.nightMode;
  return persistSettings(settings);
}

export function nightModeToggle() {
  const v = readSettings().nightModeToggle;
  return NIGHT_TOGGLES.includes(v) ? v : 'auto';
}

/** When the user last said "I'm here" (ms), or null. It only skips the away-hours stretch it was said in. */
export function nightModeHereSince() {
  const t = Date.parse(readSettings().nightModeHereSince);
  return Number.isFinite(t) ? t : null;
}

// 'here' is an INPUT, not a stored status: "I'm here" = follow my away hours, minus the stretch I am in now.
const NIGHT_TOGGLE_INPUTS = [...NIGHT_TOGGLES, 'here'];

export function assertNightModeToggleInput(v) {
  if (!NIGHT_TOGGLE_INPUTS.includes(v)) throw Object.assign(new Error(`nightModeToggle must be one of ${NIGHT_TOGGLE_INPUTS.join(' | ')}`), { status: 400 });
  return v;
}

export async function setNightModeToggle(v, { now = Date.now() } = {}) {
  assertNightModeToggleInput(v);
  const settings = readSettings();
  if (v === 'auto' || v === 'here') delete settings.nightModeToggle; else settings.nightModeToggle = v;
  if (v === 'here') settings.nightModeHereSince = new Date(now).toISOString(); else delete settings.nightModeHereSince;
  return persistSettings(settings);
}

/** The web card's "Always allow": one exact host joins the stored allowlist; everything else is kept. */
export async function addAskWebHost(host) {
  const h = normalizeDomainPattern(host);
  if (!h || h.startsWith('*.')) throw new Error(`askWeb: "${host}" is not an exact host name`);
  const cur = askWeb();
  if (cur.allowedDomains.includes(h)) return { askWeb: cur };
  const s = cur.search;
  return setAskWeb({ enabled: cur.enabled, anyHost: cur.anyHost, allowedDomains: [...cur.allowedDomains, h],
    search: s ? { url: s.url, key: s.key, keyHeader: s.keyHeader, keyPrefix: s.keyPrefix } : null });
}

/** Write (or clear) a USD cap key. @throws {Error} unless positive finite number (or empty). */
async function setUsdCap(key, input) {
  assertUsdCapInput(key, input);
  const settings = readSettings();
  if (isClearInput(input)) delete settings[key];  // reset to unlimited
  else settings[key] = input;
  await persistSettings(settings);
  return { [key]: readUsdCap(key) };            // the EFFECTIVE value
}

/** @throws {Error} unless `input` is a positive number (or empty, which clears). */
export const setPipelineCostLimitUsd = (input) => setUsdCap('pipelineCostLimitUsd', input);

/** @throws {Error} unless `input` is a positive number (or empty, which clears). */
export const setTotalCostLimitUsd = (input) => setUsdCap('totalCostLimitUsd', input);

// ── Developer rate (money-saved design §8) ───────────────────────────────────
// Prices the estimated human hours in Statistics and Team metrics. Stored value or
// null; the EFFECTIVE rate (team policy default, then 35) is human-rate.mjs.
export const DEFAULT_HUMAN_RATE_USD = 35;

/** Stored developer rate in USD per hour, or null when unset (→ policy → 35). */
export function humanRateUsdPerHour(scope) { return projectOverride('humanRateUsdPerHour', scope) ?? readUsdCap('humanRateUsdPerHour'); }

/** @throws {Error} unless a positive finite number, or '' / null / undefined (clear). */
export function assertHumanRateInput(input) { assertUsdCapInput('humanRateUsdPerHour', input); }

/** Write (or clear) the developer rate. */
export const setHumanRateUsdPerHour = (input) => setUsdCap('humanRateUsdPerHour', input);

// ── chat notification preferences (chat-connectivity-design.md §4.5) ─────────

const CHAT_NOTIFY_EVENTS = ['done', 'error', 'question', 'paused', 'away'];

/**
 * Effective chat preferences. Every notification event defaults ON; channels default
 * enabled (an absent "<plugin>/<channelId>" key means enabled — presence with
 * {enabled:false} is the opt-out record); `scriptTools` (scripts-workbench W20) is the
 * chat's "Create and run scripts" switch and defaults ON, so only a stored false ever
 * takes save_script / test_script away.
 * @returns {{notify: Record<string, boolean>, channels: Record<string, {enabled: boolean}>, scriptTools: boolean}}
 */
export function chatPrefs() {
  const raw = readSettings().chat;
  const chat = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const notify = {};
  for (const ev of CHAT_NOTIFY_EVENTS) notify[ev] = chat.notify?.[ev] !== false;
  const channels = {};
  for (const [key, v] of Object.entries(chat.channels && typeof chat.channels === 'object' ? chat.channels : {})) {
    channels[key] = { enabled: v?.enabled !== false };
  }
  return { notify, channels, scriptTools: chat.scriptTools !== false };
}

/**
 * Merge-patch the chat prefs: {notify?: {done?, error?, question?, paused?, away?},
 * channels?: {"<plugin>/<id>"?: {enabled: boolean}}, scriptTools?: boolean}. Unknown
 * notify keys and a non-boolean scriptTools are rejected (400 at the API layer);
 * channels merge per key.
 */
export async function setChatPrefs(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('chat prefs must be an object');
  for (const k of Object.keys(patch.notify || {})) {
    if (!CHAT_NOTIFY_EVENTS.includes(k)) throw new Error(`unknown chat notify event "${k}"`);
  }
  const hasScriptTools = Object.prototype.hasOwnProperty.call(patch, 'scriptTools');
  if (hasScriptTools && typeof patch.scriptTools !== 'boolean') throw new Error('chat scriptTools must be true or false');
  const settings = readSettings();
  const cur = settings.chat && typeof settings.chat === 'object' ? settings.chat : {};
  settings.chat = {
    ...cur,
    ...(patch.notify ? { notify: { ...cur.notify, ...Object.fromEntries(Object.entries(patch.notify).map(([k, v]) => [k, v !== false])) } } : {}),
    ...(patch.channels ? {
      channels: {
        ...cur.channels,
        ...Object.fromEntries(Object.entries(patch.channels).map(([k, v]) => [k, { enabled: v?.enabled !== false }])),
      },
    } : {}),
    ...(hasScriptTools ? { scriptTools: patch.scriptTools } : {}),
  };
  await persistSettings(settings);
  return chatPrefs();
}

/** @throws {Error} unless `input` is 'weekly' | 'monthly' (or empty, which resets). */
export async function setCostLimitResetPeriod(input) {
  assertResetPeriodInput(input);
  const settings = readSettings();
  if (isClearInput(input)) delete settings.costLimitResetPeriod;  // reset to 'monthly'
  else settings.costLimitResetPeriod = input;
  await persistSettings(settings);
  return { costLimitResetPeriod: costLimitResetPeriod() };
}

// ── Python interpreter (scripts-workbench spec §7) ───────────────────────────
// The second candidate the script-card probe tries, after the WORCA_PYTHON
// environment override and before the platform defaults. Settings-file-only, the
// company runRootMode / skillMount / the context caps keep: no /api/settings key
// and no Settings card in this version, so it is deliberately absent from
// SETTINGS_POST_KEYS below.
export const PYTHON_PATH_MAX_LEN = 500;

const isPythonPath = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= PYTHON_PATH_MAX_LEN;

/** The STORED interpreter path (trimmed), or null when unset/invalid (loudly). */
export function pythonPath() {
  const v = readSettings().pythonPath;
  if (v === undefined) return null;
  if (isPythonPath(v)) return v.trim();
  console.warn(`[worca] invalid pythonPath ${JSON.stringify(v)} — probing the platform defaults`);
  return null;
}

/** @throws {Error} unless `input` is a non-empty path (or empty, which clears). */
export function assertPythonPathInput(input) {
  if (isClearInput(input)) return;
  if (!isPythonPath(input)) {
    throw new Error(`pythonPath must be a path of at most ${PYTHON_PATH_MAX_LEN} characters, or empty to probe the platform defaults`);
  }
}

export async function setPythonPath(input) {
  assertPythonPathInput(input);
  const settings = readSettings();
  if (isClearInput(input)) delete settings.pythonPath;
  else settings.pythonPath = input.trim();
  await persistSettings(settings);
  return { pythonPath: pythonPath() };
}

// ── Actions (issue #529) ─────────────────────────────────────────────────────
// One nested key `actions`: the keep policy for finished-run checkouts, the
// `auto` port range, the editor/terminal overrides of the built-ins, and the
// checkout cap. editor/terminal are command paths the built-ins route spawns as
// the server user, so POST /api/settings refuses an `actions` key from agent callers.
export const ACTIONS_KEEP = ['never', 'on-success', 'until-pr'];
export const DEFAULT_ACTIONS_SETTINGS = Object.freeze({ keep: 'never', portLow: 4400, portHigh: 4499, editor: '', terminal: '', maxCheckouts: null });
const isPort = (v) => Number.isSafeInteger(v) && v >= 1024 && v <= 65535;
const isCap = (v) => Number.isSafeInteger(v) && v >= 1 && v <= 100;

export function actionsSettings() {
  const a = readSettings().actions;
  const s = a && typeof a === 'object' ? a : {};
  const low = isPort(s.portLow) ? s.portLow : DEFAULT_ACTIONS_SETTINGS.portLow;
  const high = isPort(s.portHigh) && s.portHigh >= low ? s.portHigh : Math.max(low, DEFAULT_ACTIONS_SETTINGS.portHigh);
  return {
    keep: ACTIONS_KEEP.includes(s.keep) ? s.keep : 'never',
    portLow: low, portHigh: high,
    editor: typeof s.editor === 'string' ? s.editor.trim() : '',
    terminal: typeof s.terminal === 'string' ? s.terminal.trim() : '',
    maxCheckouts: isCap(s.maxCheckouts) ? s.maxCheckouts : null,
  };
}

/** @throws {Error} on any invalid key of an `actions` patch (absent / '' / null keys clear). */
export function assertActionsInput(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('actions must be an object');
  const has = (k) => Object.hasOwn(patch, k);
  const clear = (v) => v === '' || v === null || v === undefined;
  if (has('keep') && !clear(patch.keep) && !ACTIONS_KEEP.includes(patch.keep)) throw new Error(`actions.keep must be one of ${ACTIONS_KEEP.join(' | ')}`);
  for (const k of ['portLow', 'portHigh']) if (has(k) && !clear(patch[k]) && !isPort(patch[k])) throw new Error(`actions.${k} must be a whole number from 1024 to 65535`);
  const cur = actionsSettings();
  const low = has('portLow') && !clear(patch.portLow) ? patch.portLow : cur.portLow;
  const high = has('portHigh') && !clear(patch.portHigh) ? patch.portHigh : cur.portHigh;
  if (low > high) throw new Error('actions: the low port must not be above the high port');
  if (has('maxCheckouts') && !clear(patch.maxCheckouts) && !isCap(patch.maxCheckouts)) throw new Error('actions.maxCheckouts must be a whole number from 1 to 100');
  // A command line run through the shell (src/core/actions/launcher.mjs); the person decides what it runs.
  for (const k of ['editor', 'terminal']) if (has(k) && !clear(patch[k]) && (typeof patch[k] !== 'string' || patch[k].length > 2000)) throw new Error(`The ${k} command must be text of at most 2000 characters`);
}

export async function setActionsSettings(patch = {}) {
  assertActionsInput(patch);
  const settings = readSettings();
  const next = { ...(settings.actions && typeof settings.actions === 'object' ? settings.actions : {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_ACTIONS_SETTINGS)) continue;
    if (v === '' || v === null || v === undefined) delete next[k]; else next[k] = typeof v === 'string' ? v.trim() : v;
  }
  if (Object.keys(next).length) settings.actions = next; else delete settings.actions;
  await persistSettings(settings);
  return actionsSettings();
}

// ── The keys POST /api/settings understands ──────────────────────────────────
// The route keeps a legacy contract: a body naming NONE of these clears root
// (test/settings-projects-root.test.mjs "a bodyless POST resets root"). Every
// setter's key is listed HERE, beside the setters, so a new key cannot forget
// to join a hand-maintained exclusion list in the route and wipe the root on
// its first save.
export const SETTINGS_POST_KEYS = Object.freeze([
  'root', 'projectsRoot', 'chat',
  'pipelineCostLimitUsd', 'totalCostLimitUsd', 'costLimitResetPeriod', 'humanRateUsdPerHour',
  'askMaxTurns', 'askMaxBudgetUsd',
  'askWeb',                                  // Ask Worca web access { enabled, allowedDomains, search }
  'debugSpawnEnabled',
  'titleModel', 'hideBuiltinModels',
  'theme',
  'uiLevel',                                 // interface mode (docs/ui-levels.md)
  'autoWorkflowModel',                       // auto-workflow spec D14
  'prDescriptionModel',                      // the "Ship it?" modal's Generate with AI
  'memoryDefrag',                            // Settings › Memory: the defragment model + effort
  'workspaceScan',                           // Settings › Runs › Workspaces: the scan's models
  'schedule',                                // scheduled-run defaults { graceMin, ifMissed, maxFailures }
  'nightMode',                               // night mode user layer (night/config.mjs fields)
  'nightModeToggle',                         // night mode live switch: auto | on | off
  'sync',                                    // sync before run (#527) { beforeRun, remote, refreshMinutes, onDiverged }
  'actions',                                 // Settings › Runs › Actions { keep, portLow, portHigh, editor, terminal, maxCheckouts }
  'runEngine', 'stepModels', 'utilityModels',
  'askEngine', 'askModels',                  // Ask Worca's engine for new chats and its model per engine (user-only, D17)
]);

let projectLayerReader = null;
export function setProjectLayerReader(fn) { projectLayerReader = typeof fn === 'function' ? fn : null; }
function projectOverride(id, scope) {
  if (!scope || !projectLayerReader) return undefined;
  try { return projectLayerReader(id, scope); } catch { return undefined; }
}

export const UTILITY_JOBS = Object.freeze(['title', 'classifier', 'overview', 'prDescription', 'memoryDefrag', 'workspaceScan']);
const MODEL_PAIR_MAX_LEN = 200;
const homeGuarded = () => !!process.env.NODE_TEST_CONTEXT && !process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
export function runEngineSetting() {
  if (homeGuarded()) return undefined;
  const value = readSettings().runEngine;
  return value === null ? undefined : value;
}
export function stepModelsSetting() {
  if (homeGuarded()) return {};
  const value = readSettings().stepModels;
  return isObj(value) ? value : {};
}
export function utilityModelsSetting() {
  if (homeGuarded()) return {};
  const value = readSettings().utilityModels;
  return isObj(value) ? value : {};
}
/** Ask Worca's engine for NEW chats (cascading-settings-design.md D17): user-only; a chat keeps the engine it started on. */
export function askEngineSetting() {
  if (homeGuarded()) return undefined;
  const value = readSettings().askEngine;
  return value === null ? undefined : value;
}
/** The Ask model slot per engine, { claude?: {model, effort}, codex?: {model, effort} } (D17). */
export function askModelsSetting() {
  if (homeGuarded()) return {};
  const value = readSettings().askModels;
  return isObj(value) ? value : {};
}
export function assertAskEngineInput(input) {
  if (input === null || input === undefined || input === '') return null;
  if (!MODEL_ENGINES.includes(input)) throw new Error(`askEngine must be one of ${MODEL_ENGINES.join(' | ')}`);
  return input;
}
export async function setAskEngineSetting(input) {
  const value = assertAskEngineInput(input);
  const settings = readSettings();
  if (value === null) delete settings.askEngine; else settings.askEngine = value;
  await persistSettings(settings);
  return { askEngine: askEngineSetting() ?? null };
}
export function assertAskModelsInput(input) {
  if (!isObj(input)) throw new Error('askModels must be { <engine>: { model, effort } | null }');
  const out = {};
  for (const [engine, value] of Object.entries(input)) {
    if (!MODEL_ENGINES.includes(engine)) throw new Error(`askModels: unknown engine "${engine}"`);
    out[engine] = normalizeModelPair(engine, value, `askModels.${engine}`);
  }
  return out;
}
export async function setAskModels(input) {
  const patch = assertAskModelsInput(input);
  const settings = readSettings();
  const all = isObj(settings.askModels) ? { ...settings.askModels } : {};
  for (const [engine, pair] of Object.entries(patch)) { if (pair === null) delete all[engine]; else all[engine] = pair; }
  if (Object.keys(all).length) settings.askModels = all; else delete settings.askModels;
  await persistSettings(settings);
  return { askModels: askModelsSetting() };
}
export function assertRunEngineInput(input) {
  if (input === null || input === undefined || input === '') return null;
  if (!RUN_ENGINES.includes(input)) throw new Error(`runEngine must be one of ${RUN_ENGINES.join(' | ')}`);
  return input;
}
export async function setRunEngineSetting(input) {
  const value = assertRunEngineInput(input);
  const settings = readSettings();
  if (value === null) delete settings.runEngine; else settings.runEngine = value;
  await persistSettings(settings);
  return { runEngine: runEngineSetting() ?? null };
}
const ROLE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
export function assertStepModelsInput(input) {
  if (!isObj(input)) throw new Error('stepModels must be { <engine>: { <role>: { model, effort } | null } }');
  const out = {};
  for (const [engine, roles] of Object.entries(input)) {
    if (!MODEL_ENGINES.includes(engine)) throw new Error(`stepModels: unknown engine "${engine}"`);
    if (!isObj(roles)) throw new Error(`stepModels.${engine} must be an object of role → { model, effort } | null`);
    out[engine] = {};
    for (const [role, value] of Object.entries(roles)) {
      if (!ROLE_KEY_RE.test(role)) throw new Error(`stepModels.${engine}: invalid role "${role}"`);
      out[engine][role] = normalizeModelPair(engine, value, `stepModels.${engine}.${role}`);
    }
  }
  return out;
}
export async function setStepModels(input) {
  const patch = assertStepModelsInput(input); const settings = readSettings();
  const all = isObj(settings.stepModels) ? { ...settings.stepModels } : {};
  for (const [engine, roles] of Object.entries(patch)) {
    const current = isObj(all[engine]) ? { ...all[engine] } : {};
    for (const [role, pair] of Object.entries(roles)) pair === null ? delete current[role] : current[role] = pair;
    if (Object.keys(current).length) all[engine] = current; else delete all[engine];
  }
  if (Object.keys(all).length) settings.stepModels = all; else delete settings.stepModels;
  await persistSettings(settings); return { stepModels: stepModelsSetting() };
}
export function assertUtilityModelsInput(input) {
  if (!isObj(input)) throw new Error('utilityModels must be { codex: { <job>: { model, effort } | null } }');
  const out = {};
  for (const [engine, jobs] of Object.entries(input)) {
    if (engine === 'claude') throw new Error("utilityModels.claude: Claude's helper models are the titleModel, autoWorkflowModel, prDescriptionModel and memoryDefrag settings");
    if (!MODEL_ENGINES.includes(engine)) throw new Error(`utilityModels: unknown engine "${engine}"`);
    if (!isObj(jobs)) throw new Error(`utilityModels.${engine} must be an object of job → { model, effort } | null`);
    out[engine] = {};
    for (const [job, value] of Object.entries(jobs)) {
      if (!UTILITY_JOBS.includes(job)) throw new Error(`utilityModels.${engine}: unknown job "${job}" (one of ${UTILITY_JOBS.join(', ')})`);
      out[engine][job] = normalizeModelPair(engine, value, `utilityModels.${engine}.${job}`);
    }
  }
  return out;
}
export async function setUtilityModels(input) {
  const patch = assertUtilityModelsInput(input); const settings = readSettings();
  const all = isObj(settings.utilityModels) ? { ...settings.utilityModels } : {};
  for (const [engine, jobs] of Object.entries(patch)) {
    const current = isObj(all[engine]) ? { ...all[engine] } : {};
    for (const [job, pair] of Object.entries(jobs)) pair === null ? delete current[job] : current[job] = pair;
    if (Object.keys(current).length) all[engine] = current; else delete all[engine];
  }
  if (Object.keys(all).length) settings.utilityModels = all; else delete settings.utilityModels;
  await persistSettings(settings); return { utilityModels: utilityModelsSetting() };
}
export function normalizeModelPair(engine, input, label = 'model') {
  if (input === null || input === undefined || input === '') return null;
  if (!isObj(input)) throw new Error(`${label} must be { model, effort } or null`);
  for (const key of Object.keys(input)) if (key !== 'model' && key !== 'effort') throw new Error(`${label}: unknown field "${key}"`);
  const model = input.model == null ? '' : (typeof input.model === 'string' ? input.model.trim() : null);
  if (model === null || model.length > MODEL_PAIR_MAX_LEN) throw new Error(`${label}.model must be a model id`);
  const effort = input.effort == null ? '' : (typeof input.effort === 'string' ? input.effort.trim() : null);
  if (effort === null) throw new Error(`${label}.effort must be a string`);
  const efforts = effortsForEngine(engine);
  if (effort && !efforts.includes(effort)) throw new Error(`${label}.effort must be one of ${efforts.join(' | ')}`);
  if (!model && !effort) return null;
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}
export const SETTING_CHECKS = Object.freeze({
  usdCap: (value) => isUsdCap(value), byteCap: (value) => isByteCap(value),
  pct: (value) => isByteCap(value) && value <= 100,
  askMaxTurns: (value) => isAskMaxTurns(value), askMaxBudgetUsd: (value) => value === null || isAskMaxBudget(value),
  skillMount: (value) => SKILL_MOUNTS.includes(value), engine: (value) => MODEL_ENGINES.includes(value), runEngine: (value) => RUN_ENGINES.includes(value),
});

// ── Title-generation model + hidden built-ins (#422) ─────────────────────────
// `titleModel` is the catalog id every run/chat title is written with; absent
// means "the model of the run or chat that asked for the title" (title.mjs owns
// that precedence, and the catalog check — settings.mjs cannot import config.mjs).
// `hideBuiltinModels` drops the first-party built-ins from every model picker
// for an install with no first-party account; it is cosmetic + defaults only,
// a hidden id still resolves (config.mjs#composeCatalog). Both are read at use
// time like every other stored setting — a UI save reaches the next title call.
export const DEFAULT_HIDE_BUILTIN_MODELS = false;
const TITLE_MODEL_MAX_LEN = 200;

const isTitleModelId = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= TITLE_MODEL_MAX_LEN;

/** The STORED title model id (trimmed), or null when unset/invalid (loudly). */
export function titleModel() {
  const v = readSettings().titleModel;
  if (v === undefined) return null;
  if (isTitleModelId(v)) return v.trim();
  console.warn(`[worca] invalid titleModel ${JSON.stringify(v)} — titles use the run's model`);
  return null;
}

/** @throws {Error} unless `input` is a non-empty model id (or empty, which clears). */
export function assertTitleModelInput(input) {
  if (isClearInput(input)) return;
  if (!isTitleModelId(input)) throw new Error(`titleModel must be a model id of at most ${TITLE_MODEL_MAX_LEN} characters, or empty to use the run's model`);
}

export async function setTitleModel(input) {
  assertTitleModelInput(input);
  const settings = readSettings();
  if (isClearInput(input)) delete settings.titleModel;
  else settings.titleModel = input.trim();
  await persistSettings(settings);
  return { titleModel: titleModel() };
}

/** Whether built-in (first-party) models are hidden from every picker. */
export function hideBuiltinModels() {
  const v = readSettings().hideBuiltinModels;
  if (v === undefined) return DEFAULT_HIDE_BUILTIN_MODELS;
  if (typeof v === 'boolean') return v;
  console.warn(`[worca] invalid hideBuiltinModels ${JSON.stringify(v)} — using the default (${DEFAULT_HIDE_BUILTIN_MODELS})`);
  return DEFAULT_HIDE_BUILTIN_MODELS;
}

/** @throws {Error} unless `input` is a boolean. */
export function assertHideBuiltinModelsInput(input) {
  if (typeof input !== 'boolean') throw new Error('hideBuiltinModels must be true or false');
}

export async function setHideBuiltinModels(input) {
  assertHideBuiltinModelsInput(input);
  const settings = readSettings();
  if (input === DEFAULT_HIDE_BUILTIN_MODELS) delete settings.hideBuiltinModels;
  else settings.hideBuiltinModels = input;
  // The developer has now made their own choice, even when it is the default: a team-policy
  // `models.hideBuiltins` default no longer applies on this machine (team-policy design §6).
  settings.hideBuiltinModelsChosen = true;
  await persistSettings(settings);
  return { hideBuiltinModels: hideBuiltinModels() };
}

// ── Theme mode (2026-09-04 dark-mode design §6.1) ────────────────────────────
// One machine-wide preference: `system` follows the OS, `light`/`dark` force a
// scheme. The server writes it into the shell's <html data-theme> at serve time
// (ui/server.mjs sendIndex) and the client keeps it live; the value is read at
// use time like every other stored setting, so a save reaches the next request.
export const THEME_MODES = Object.freeze(['system', 'light', 'dark']);
export const DEFAULT_THEME = 'system';
const isThemeMode = (v) => THEME_MODES.includes(v);

/** STORED theme mode; an absent key is the default, an invalid value is the default (loudly). */
export function theme() {
  const v = readSettings().theme;
  if (v === undefined) return DEFAULT_THEME;
  if (isThemeMode(v)) return v;
  console.warn(`[worca] invalid theme ${JSON.stringify(v)} — using the default (${DEFAULT_THEME})`);
  return DEFAULT_THEME;
}

/** @throws {Error} unless `input` is system|light|dark, or empty/null (a clear). */
export function assertThemeInput(input) {
  if (isClearInput(input)) return;
  if (!isThemeMode(input)) throw new Error('theme must be system, light or dark');
}

export async function setTheme(input) {
  assertThemeInput(input);
  const settings = readSettings();
  if (isClearInput(input) || input === DEFAULT_THEME) delete settings.theme;
  else settings.theme = input;
  await persistSettings(settings);
  return { theme: theme() };
}

// ── Auto workflow classifier model (auto-workflow spec D14) ─────────────────
// '' = unset: the runtime resolves a default from the catalog
// (src/core/auto/model.mjs). Read at use time like every other stored setting.

/** The configured classifier model id, or '' when unset. */
export function autoWorkflowModel() {
  const v = readSettings().autoWorkflowModel;
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Validate a POST value. With `models` (the effective catalog) the id must name an
 * entry and comes back in the catalog's casing; without it the id is returned as
 * given (CLI, tests). Empty/null/undefined means "clear".
 * @returns {string|null} the canonical id to store, null to clear
 * @throws {Error} on a non-string or an id the catalog does not carry
 */
export function assertAutoWorkflowModelInput(input, models = null) {
  if (input === '' || input === null || input === undefined) return null;
  if (typeof input !== 'string' || !input.trim()) throw new Error('autoWorkflowModel must be a catalog model id');
  const id = input.trim();
  if (!Array.isArray(models)) return id;
  const hit = models.find((m) => m && typeof m.id === 'string' && m.id.toLowerCase() === id.toLowerCase());
  if (!hit) throw new Error(`unknown model "${id}" — add it to the catalog first`);
  return hit.id;
}

export async function setAutoWorkflowModel(input, { models = null } = {}) {
  const id = assertAutoWorkflowModelInput(input, models);
  const settings = readSettings();
  if (id === null) delete settings.autoWorkflowModel; else settings.autoWorkflowModel = id;
  await persistSettings(settings);
  return { autoWorkflowModel: autoWorkflowModel() };
}

// ── PR description model (the "Ship it?" modal's Generate with AI) ──────────
// '' = unset: the runtime resolves a Sonnet-class default from the catalog
// (src/core/pr-description.mjs). Read at use time like every other stored setting.

/** The configured PR-description model id, or '' when unset. */
export function prDescriptionModel() {
  const v = readSettings().prDescriptionModel;
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Validate a POST value exactly like assertAutoWorkflowModelInput: with `models`
 * (the effective catalog) the id must name an entry and comes back in the
 * catalog's casing. Empty/null/undefined means "clear".
 * @returns {string|null} the canonical id to store, null to clear
 * @throws {Error} on a non-string or an id the catalog does not carry
 */
export function assertPrDescriptionModelInput(input, models = null) {
  if (input === '' || input === null || input === undefined) return null;
  if (typeof input !== 'string' || !input.trim()) throw new Error('prDescriptionModel must be a catalog model id');
  const id = input.trim();
  if (!Array.isArray(models)) return id;
  const hit = models.find((m) => m && typeof m.id === 'string' && m.id.toLowerCase() === id.toLowerCase());
  if (!hit) throw new Error(`unknown model "${id}" — add it to the catalog first`);
  return hit.id;
}

export async function setPrDescriptionModel(input, { models = null } = {}) {
  const id = assertPrDescriptionModelInput(input, models);
  const settings = readSettings();
  if (id === null) delete settings.prDescriptionModel; else settings.prDescriptionModel = id;
  await persistSettings(settings);
  return { prDescriptionModel: prDescriptionModel() };
}

// ── Spawn-debug diagnostics toggle (the stored side of WORCA_DEBUG_SPAWN) ────
// Like every other stored setting (skillMount, the cost caps, the ask caps) this
// is READ AT USE TIME: claude-runner.mjs#debugSpawnEnabled calls
// effectiveDebugSpawn() on every spawn, so a UI save reaches the very next spawn
// in this process and in any CLI process with no restart, and nothing here ever
// mutates process.env (a runtime env write would leak an explicit
// WORCA_DEBUG_SPAWN=0 into every inherited child env and break the runner's
// "OFF ⇒ byte-identical spawn env" invariant).
export const DEFAULT_DEBUG_SPAWN_ENABLED = false;

const isBool = (v) => typeof v === 'boolean';

/** @throws {Error} unless `input` is a boolean (the route and the setter share this). */
export function assertDebugSpawnInput(input) {
  if (!isBool(input)) throw new Error('debugSpawnEnabled must be true or false');
}

/** STORED spawn-debug preference: boolean, default OFF. Invalid stored value ⇒ OFF (loudly). */
export function debugSpawnEnabled() {
  const v = readSettings().debugSpawnEnabled;
  if (v === undefined) return DEFAULT_DEBUG_SPAWN_ENABLED;
  if (isBool(v)) return v;
  console.warn(`[worca] invalid debugSpawnEnabled ${JSON.stringify(v)} — using the default (${DEFAULT_DEBUG_SPAWN_ENABLED})`);
  return DEFAULT_DEBUG_SPAWN_ENABLED;
}

/**
 * What the runner will actually do on the next spawn, and why. ONE precedence
 * rule, shared by the runner gate and the settings API: a NON-EMPTY
 * WORCA_DEBUG_SPAWN in the environment wins (parsed with the envFlag rule, so an
 * exported "0"/"false" is an explicit OFF override), otherwise the stored
 * preference applies. An empty export (`export WORCA_DEBUG_SPAWN=` in a profile
 * or a dotenv template) is NOT an override — the runner would read it as OFF
 * while the UI showed the stored value checked, with nothing explaining why.
 * @returns {{enabled: boolean, source: 'env'|'settings'}}
 */
export function effectiveDebugSpawn() {
  const v = process.env.WORCA_DEBUG_SPAWN;
  if (v !== undefined && v !== '') return { enabled: envFlag('WORCA_DEBUG_SPAWN'), source: 'env' };
  return { enabled: debugSpawnEnabled(), source: 'settings' };
}

/**
 * Persist the preference. Nothing else: the runner reads it back per spawn, so
 * the change is live everywhere without touching this process's environment.
 * @throws {Error} unless `input` is a boolean.
 */
export async function setDebugSpawnEnabled(input) {
  assertDebugSpawnInput(input);
  const settings = readSettings();
  if (input === DEFAULT_DEBUG_SPAWN_ENABLED) delete settings.debugSpawnEnabled;
  else settings.debugSpawnEnabled = input;
  await persistSettings(settings);
  return { debugSpawnEnabled: debugSpawnEnabled() };
}

// ---------------------------------------------------------------------------
// Global model catalog (configurable-models-design.md §4.1). Stored entries are
// MINIMAL — label only when it differs from id, efforts only when a proper
// subset, env only when non-empty — so an entry with default metadata keeps
// tracking a future EFFORTS change instead of freezing today's list. Readers
// are loud-and-lenient per this module's contract; setters throw. Effort
// SUBSET validation happens here; catalog COMPOSITION (shadowing
// PREDEFINED_MODELS, legacy per-project entries) is config.mjs's job.
// ---------------------------------------------------------------------------

/** Order-normalize an efforts subset to EFFORTS order, deduplicated. */
const orderEfforts = (list, engine = 'claude') => effortsForEngine(engine).filter((e) => list.includes(e));
const CLAUDE_MODEL_ID_RE = /^(claude-|opus|sonnet|haiku|fable)/i;

/**
 * Sanitize one raw catalog entry to its EFFECTIVE shape, or null when it is
 * not salvageable (no id). Unknown efforts and reserved/malformed env pairs
 * are dropped with a warning naming the entry — a reserved key here means a
 * hand-edited settings file, since setters reject them.
 */
function sanitizeGlobalModel(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) return null;
  const label = (typeof raw.label === 'string' && raw.label.trim()) || id;
  const engine = raw.engine === 'codex' ? 'codex' : 'claude';
  const efforts = Array.isArray(raw.efforts) ? orderEfforts(raw.efforts, engine) : [];
  const env = {};
  const rawEnv = raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env) ? raw.env : {};
  for (const [k, v] of Object.entries(rawEnv)) {
    // Trim before storing: an ANTHROPIC_MODEL wire id (#374) reaches `--model`
    // verbatim, so a pasted ' claude-opus-4-8' or whitespace-only value must not
    // land on disk. Whitespace-only (truthy but empty after trim) is dropped.
    const t = typeof v === 'string' ? v.trim() : '';
    if (isReservedModelEnvKey(k) || typeof v !== 'string' || !t) {
      console.warn(`[worca] models entry ${JSON.stringify(id)}: dropping env key ${JSON.stringify(k)} (reserved or not a non-empty string)`);
      continue;
    }
    env[k] = t;
  }
  const cost = sanitizeModelCost(raw.cost, id);
  let upstream = sanitizeModelUpstream(raw.upstream, id);
  if (engine === 'codex') {
    for (const k of Object.keys(env)) { console.warn(`[worca] models entry ${JSON.stringify(id)}: dropping env key ${JSON.stringify(k)} — a codex model takes no routing env`); delete env[k]; }
    const why = codexUpstreamProblem(upstream);
    if (why) { console.warn(`[worca] models entry ${JSON.stringify(id)}: dropping upstream — ${why}`); upstream = undefined; }
  }
  if (upstream) {
    // The bridge owns the routing keys (model-env.mjs BRIDGE_ROUTING_KEYS); a
    // hand-edited file carrying both is degraded, not rejected: the bridge wins.
    const clash = upstreamEnvConflict(env);
    if (clash) {
      console.warn(`[worca] models entry ${JSON.stringify(id)}: dropping env key ${JSON.stringify(clash)} — the bridge sets it for an upstream entry`);
      for (const k of Object.keys(env)) if (upstreamEnvConflict({ [k]: env[k] })) delete env[k];
    }
  }
  return {
    id,
    label,
    efforts: efforts.length ? efforts : [...effortsForEngine(engine)],
    ...(engine === 'codex' ? { engine } : {}),
    ...(Object.keys(env).length ? { env } : {}),
    ...(cost ? { cost } : {}),
    ...(upstream ? { upstream } : {}),
  };
}

/** Lenient read-side counterpart of assertModelUpstream: drops an invalid
 *  `upstream` loudly instead of throwing. */
function sanitizeModelUpstream(raw, id) {
  if (raw == null) return undefined;
  try {
    return assertModelUpstream(raw);
  } catch (e) {
    console.warn(`[worca] models entry ${JSON.stringify(id)}: dropping invalid upstream — ${e.message}`);
    return undefined;
  }
}

/** Lenient read-side counterpart of assertModelCost (model-env.mjs): drops an
 *  invalid `cost` loudly instead of throwing (a corrupt settings.json must never
 *  break reads). */
function sanitizeModelCost(raw, id) {
  if (raw == null) return undefined;
  try {
    return assertModelCost(raw);
  } catch (e) {
    console.warn(`[worca] models entry ${JSON.stringify(id)}: dropping invalid cost — ${e.message}`);
    return undefined;
  }
}

/**
 * The sanitized global model catalog: [{id, label, efforts, env?, cost?}],
 * effective shape (label/efforts always present). Missing/corrupt -> []. Malformed and
 * case-insensitively duplicate entries are dropped loudly (first wins). Never
 * throws.
 */
export function listGlobalModels() {
  // Under the node:test runner the real ~/.worca-cc/settings.json must not
  // leak models into tests (mirrors projects.mjs#worcaHome's guard): treat the
  // catalog as EMPTY unless the test sandboxes HOME/USERPROFILE itself and
  // says so via WORCA_TEST_ALLOW_HOME_FALLBACK. Reads never throw, so empty —
  // not an error — is the degradation.
  if (process.env.NODE_TEST_CONTEXT && !process.env.WORCA_TEST_ALLOW_HOME_FALLBACK) return [];
  const raw = readSettings().models;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    console.warn(`[worca] invalid models ${JSON.stringify(raw)} — treating as empty`);
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    const m = sanitizeGlobalModel(entry);
    if (!m) {
      console.warn(`[worca] invalid models entry ${JSON.stringify(entry)} — ignored`);
      continue;
    }
    const key = m.id.toLowerCase();
    if (seen.has(key)) {
      console.warn(`[worca] duplicate models id ${JSON.stringify(m.id)} — keeping the first`);
      continue;
    }
    seen.add(key);
    out.push(m);
  }
  return out;
}

/** @throws {Error} unless `id` is a non-empty string; returns it trimmed. */
function assertModelId(id) {
  const v = typeof id === 'string' ? id.trim() : '';
  if (!v) throw new Error('model id must be a non-empty string');
  return v;
}

/** @throws {Error} unless every member is a known effort; returns EFFORTS-ordered subset ([] = default/full). */
function assertEfforts(input, engine = 'claude') {
  const allowed = effortsForEngine(engine);
  if (isClearInput(input) || (Array.isArray(input) && input.length === 0)) return [];
  if (!Array.isArray(input)) throw new Error(`efforts must be an array drawn from ${allowed.join(' | ')}`);
  for (const e of input) {
    if (!allowed.includes(e)) throw new Error(`unknown effort ${JSON.stringify(e)} — must be one of ${allowed.join(' | ')}`);
  }
  return orderEfforts(input, engine);
}

function assertModelEngine(input) { if (isClearInput(input) || input === 'claude') return 'claude'; if (input === 'codex') return input; throw new Error('engine must be one of claude | codex'); }
/** A Codex model takes no routing env, and only an OpenAI-compatible Responses endpoint as its upstream (codexUpstreamProblem). */
function assertCodexFields(engine, env, upstream) {
  if (engine !== 'codex') return;
  if (Object.keys(env || {}).length) throw new Error('a codex model takes no env');
  const why = codexUpstreamProblem(upstream);
  if (why) throw new Error(why);
}
function assertIdForEngine(id, engine) { if (engine === 'codex' && CLAUDE_MODEL_ID_RE.test(id)) throw new Error(`"${id}" is a Claude model id`); if (engine === 'claude' && CODEX_PRICES[id.toLowerCase()]) throw new Error(`"${id}" is a Codex built-in`); }

/** @throws {Error} on a reserved key or a non-string value. `allowNull` admits
 *  the PATCH delete marker (env: {KEY: null}). Returns entries as given. */
function assertEnvPairs(env, { allowNull = false } = {}) {
  if (isClearInput(env)) return {};
  if (typeof env !== 'object' || Array.isArray(env)) throw new Error('env must be an object of string values');
  for (const [k, v] of Object.entries(env)) {
    if (isReservedModelEnvKey(k)) throw new Error(`env key ${JSON.stringify(k)} is reserved and cannot be set on a model`);
    if (allowNull && v === null) continue;
    if (typeof v !== 'string' || !v) throw new Error(`env value for ${JSON.stringify(k)} must be a non-empty string`);
  }
  return { ...env };
}

/** Catalog WRITES under node:test would hit the user's REAL settings.json —
 *  throw unless the test sandboxes HOME and opts in (worcaHome-guard mirror). */
function assertTestSettingsAccess() {
  if (process.env.NODE_TEST_CONTEXT && !process.env.WORCA_TEST_ALLOW_HOME_FALLBACK) {
    throw new Error(
      'global model catalog write under the node:test runner — sandbox HOME/USERPROFILE ' +
      'and set WORCA_TEST_ALLOW_HOME_FALLBACK=1 (tests must never touch the real ~/.worca-cc)'
    );
  }
}

/** The MINIMAL stored shape for validated parts (see section comment). */
function storedModelShape(id, label, efforts, env, cost, upstream, engine = 'claude') {
  return {
    id,
    ...(label && label !== id ? { label } : {}),
    ...(engine === 'codex' ? { engine } : {}),
    ...(efforts.length && efforts.length !== effortsForEngine(engine).length ? { efforts } : {}),
    ...(Object.keys(env).length ? { env } : {}),
    ...(cost ? { cost } : {}),
    ...(upstream ? { upstream } : {}),
  };
}

/** @throws {Error} when an `env` map carries a key the bridge owns for an upstream entry. */
function assertUpstreamEnvCompatible(env, upstream) {
  if (!upstream) return;
  const clash = upstreamEnvConflict(env);
  if (clash) {
    throw new Error(`env key ${JSON.stringify(clash)} cannot be set on a model with an upstream — the bridge sets it (remove it or drop the upstream)`);
  }
}

/** Find the index of the raw `models` entry matching `id` (case-insensitive). */
function findModelIndex(models, id) {
  const key = id.toLowerCase();
  return models.findIndex((e) => e && typeof e === 'object'
    && typeof e.id === 'string' && e.id.trim().toLowerCase() === key);
}

/** Read the raw models array for a read-modify-write (non-array -> []). */
function rawModels(settings) {
  return Array.isArray(settings.models) ? settings.models : [];
}

/**
 * Add a global catalog entry. `label` defaults to the id; `efforts` must be a
 * subset of EFFORTS (empty/absent = all); `env` keys must not be reserved;
 * `cost` is an optional per-model override ({free} | {perMtok}, see assertModelCost).
 * `dryRun` validates exactly as a write would and returns the would-be entry
 * without persisting (Ask Worca's model card validates with it).
 * @returns {Promise<{id:string,label:string,efforts:string[],env?:object,cost?:object}>} the effective entry
 * @throws {Error} on invalid input or a case-insensitively duplicate id
 */
export async function addGlobalModel({ id, label, efforts, env, cost, upstream, engine } = {}, { dryRun = false } = {}) {
  assertTestSettingsAccess();
  const vid = assertModelId(id);
  if (!isClearInput(label) && typeof label !== 'string') throw new Error('label must be a string');
  const vengine = assertModelEngine(engine); assertIdForEngine(vid, vengine);
  const vefforts = assertEfforts(efforts, vengine);
  const venv = assertEnvPairs(env);
  const vcost = assertModelCost(cost);
  const vupstream = assertModelUpstream(upstream);
  assertCodexFields(vengine, venv, vupstream);
  assertUpstreamEnvCompatible(venv, vupstream);
  const settings = readSettings();
  const models = rawModels(settings);
  if (findModelIndex(models, vid) !== -1) throw new Error(`a model with id ${JSON.stringify(vid)} already exists`);
  const vlabel = (typeof label === 'string' && label.trim()) || vid;
  if (dryRun) return sanitizeGlobalModel(storedModelShape(vid, vlabel, vefforts, venv, vcost, vupstream, vengine));
  settings.models = [...models, storedModelShape(vid, vlabel, vefforts, venv, vcost, vupstream, vengine)];
  await persistSettings(settings);
  return listGlobalModels().find((m) => m.id.toLowerCase() === vid.toLowerCase());
}

/**
 * Patch a global catalog entry. Omitted fields are kept. `label`: ''/null
 * resets to the id. `efforts`: []/null resets to all. `env`: null clears the
 * whole map; an object merges per key, where a null value DELETES that key and
 * a string sets it (write-only PATCH semantics, design §4.10). `cost`: null/''
 * removes the override; an object replaces it wholesale. `dryRun` as addGlobalModel.
 * @returns {Promise<object>} the effective entry
 * @throws {Error} on an unknown id or invalid input
 */
export async function updateGlobalModel(id, { label, efforts, env, cost, upstream, engine } = {}, { dryRun = false } = {}) {
  assertTestSettingsAccess();
  const vid = assertModelId(id);
  const settings = readSettings();
  const models = rawModels(settings);
  const idx = findModelIndex(models, vid);
  if (idx === -1) throw new Error(`unknown model id ${JSON.stringify(vid)}`);
  const current = sanitizeGlobalModel(models[idx]);
  const curEngine = current.engine === 'codex' ? 'codex' : 'claude';
  if (engine !== undefined && assertModelEngine(engine) !== curEngine) throw new Error("a model's engine cannot change — delete it and add it again");

  let nextLabel = current.label;
  if (label !== undefined) {
    if (!isClearInput(label) && typeof label !== 'string') throw new Error('label must be a string');
    nextLabel = (typeof label === 'string' && label.trim()) || current.id;
  }
  const nextEfforts = efforts === undefined
    ? orderEfforts(current.efforts, curEngine)
    : assertEfforts(efforts, curEngine);
  let nextEnv = { ...(current.env || {}) };
  if (env === null) {
    nextEnv = {};
  } else if (env !== undefined) {
    const patch = assertEnvPairs(env, { allowNull: true });
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete nextEnv[k];
      else nextEnv[k] = v;
    }
  }

  // cost: omitted keeps the current override; null/'' removes it; an object
  // replaces it wholesale (not a per-key merge — the table is small).
  let nextCost = current.cost;
  if (cost !== undefined) nextCost = isClearInput(cost) ? undefined : assertModelCost(cost);

  // upstream: omitted keeps the current block; null/'' removes it (the entry
  // reverts to plain env routing); an object replaces it wholesale.
  let nextUpstream = current.upstream;
  if (upstream !== undefined) nextUpstream = isClearInput(upstream) ? undefined : assertModelUpstream(upstream);
  assertUpstreamEnvCompatible(nextEnv, nextUpstream);
  assertCodexFields(curEngine, nextEnv, nextUpstream);

  if (dryRun) return sanitizeGlobalModel(storedModelShape(current.id, nextLabel, nextEfforts, nextEnv, nextCost, nextUpstream, curEngine));
  settings.models = models.slice();
  settings.models[idx] = storedModelShape(current.id, nextLabel, nextEfforts, nextEnv, nextCost, nextUpstream, curEngine);
  await persistSettings(settings);
  return listGlobalModels().find((m) => m.id.toLowerCase() === vid.toLowerCase());
}

/**
 * Remove a global catalog entry. Dangling per-node/per-step refs are the
 * caller's (config.mjs's) responsibility — design §4.5.
 * @throws {Error} on an unknown id
 */
export async function removeGlobalModel(id) {
  assertTestSettingsAccess();
  const vid = assertModelId(id);
  const settings = readSettings();
  const models = rawModels(settings);
  const idx = findModelIndex(models, vid);
  if (idx === -1) throw new Error(`unknown model id ${JSON.stringify(vid)}`);
  settings.models = models.slice(0, idx).concat(models.slice(idx + 1));
  if (!settings.models.length) delete settings.models;
  await persistSettings(settings);
}

// ---------------------------------------------------------------------------
// Providers (model-bridge-design.md §6.2): account-level state the bridged
// catalog entries share — one GitHub Copilot sign-in for every `copilot`
// entry, one key/base URL for every `openai` entry. Stored under `providers`
// in settings.json. Secrets are literal strings or whole-value ${VAR} refs
// (resolved at use time from worca's own process.env), masked by the API.
// The Copilot SHORT-LIVED token is never stored: providers/copilot.mjs keeps
// it in memory. Readers are loud-and-lenient; setters throw.
//
//   providers: {
//     copilot:   { githubToken?, accountType?, acknowledgedTerms?, termsVersion?, maxConcurrent?, login? },
//     openai:    { baseUrl?, apiKey?, maxConcurrent? },
//     anthropic: { baseUrl?, apiKey?, maxConcurrent? },
//     speech:    { stt: {...}, tts: {...} },   // voice mode, NOT an upstream — see the Speech block below
//   }
// ---------------------------------------------------------------------------

const PROVIDER_SECRET_KEYS = Object.freeze({ copilot: ['githubToken'], openai: ['apiKey'], anthropic: ['apiKey'] });
const PROVIDER_DEFAULT_BASE_URL = Object.freeze({ openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com' });

/** Sanitize one provider's stored block to its effective shape. Never throws. */
function sanitizeProvider(name, raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  const warn = (k, why) => console.warn(`[worca] providers.${name}.${k}: ${why} — ignored`);
  for (const k of PROVIDER_SECRET_KEYS[name]) {
    if (r[k] === undefined) continue;
    if (typeof r[k] === 'string' && r[k].trim()) out[k] = r[k].trim();
    else warn(k, 'not a non-empty string');
  }
  if (name === 'copilot') {
    if (r.accountType !== undefined) {
      if (COPILOT_ACCOUNT_TYPES.includes(r.accountType)) out.accountType = r.accountType;
      else warn('accountType', `must be one of ${COPILOT_ACCOUNT_TYPES.join(' | ')}`);
    }
    if (r.acknowledgedTerms !== undefined) {
      if (typeof r.acknowledgedTerms === 'string' && !Number.isNaN(Date.parse(r.acknowledgedTerms))) out.acknowledgedTerms = r.acknowledgedTerms;
      else warn('acknowledgedTerms', 'not an ISO timestamp');
    }
    if (r.termsVersion !== undefined) {
      if (Number.isInteger(r.termsVersion) && r.termsVersion > 0) out.termsVersion = r.termsVersion;
      else warn('termsVersion', 'not a positive integer');
    }
    if (r.login !== undefined) {
      if (typeof r.login === 'string' && r.login.trim()) out.login = r.login.trim();
      else warn('login', 'not a non-empty string');
    }
  } else if (r.baseUrl !== undefined) {
    if (isUpstreamBaseUrl(r.baseUrl)) out.baseUrl = r.baseUrl.trim().replace(/\/+$/, '');
    else warn('baseUrl', 'not an http(s) URL');
  }
  if (r.maxConcurrent !== undefined) {
    const n = Number(r.maxConcurrent);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_PROVIDER_CONCURRENCY) out.maxConcurrent = n;
    else warn('maxConcurrent', `must be an integer from 1 to ${MAX_PROVIDER_CONCURRENCY}`);
  }
  return out;
}

/**
 * The EFFECTIVE provider config: stored values plus defaults (base URL,
 * concurrency, account type). Secrets are returned as stored (literal or
 * ${VAR}); use resolveProviderSecret for the live value. Never throws.
 * @param {string} name
 * @returns {object}
 */
export function providerConfig(name) {
  if (!UPSTREAM_PROVIDERS.includes(name)) throw new Error(`unknown provider ${JSON.stringify(name)}`);
  if (process.env.NODE_TEST_CONTEXT && !process.env.WORCA_TEST_ALLOW_HOME_FALLBACK) return providerDefaults(name);
  const all = readSettings().providers;
  const raw = all && typeof all === 'object' && !Array.isArray(all) ? all[name] : undefined;
  return { ...providerDefaults(name), ...sanitizeProvider(name, raw) };
}

function providerDefaults(name) {
  const d = { maxConcurrent: DEFAULT_PROVIDER_CONCURRENCY[name] };
  if (name === 'copilot') d.accountType = 'individual';
  else d.baseUrl = PROVIDER_DEFAULT_BASE_URL[name];
  return d;
}

/** Every provider's effective config keyed by name. */
export function allProviders() {
  return Object.fromEntries(UPSTREAM_PROVIDERS.map((n) => [n, providerConfig(n)]));
}

/** Whether a stored provider secret exists (as a literal or a ${VAR} ref). */
export function providerSecretSet(name) {
  const cfg = providerConfig(name);
  return PROVIDER_SECRET_KEYS[name].some((k) => typeof cfg[k] === 'string' && cfg[k]);
}

/**
 * The live value of a stored secret: a `${VAR}` ref is read from `sourceEnv`
 * (unset → ''), a literal is returned as is.
 */
export function resolveProviderSecret(value, sourceEnv = process.env) {
  if (typeof value !== 'string' || !value) return '';
  const ref = modelEnvRef(value);
  if (ref === null) return value;
  const v = sourceEnv ? sourceEnv[ref] : undefined;
  return typeof v === 'string' ? v.trim() : '';
}

/** Whether the Copilot terms notice has been acknowledged at the CURRENT wording version. */
export function copilotTermsAcknowledged() {
  const c = providerConfig('copilot');
  return !!c.acknowledgedTerms && (c.termsVersion || 0) >= COPILOT_TERMS_VERSION;
}

/**
 * Patch a provider's stored block. Omitted keys are kept; null/'' deletes a
 * key. Validates the whole patch before writing. `dryRun` returns the
 * would-be effective config without persisting.
 * @returns {Promise<object>} the effective config
 * @throws {Error}
 */
export async function updateProvider(name, patch = {}, { dryRun = false } = {}) {
  if (!UPSTREAM_PROVIDERS.includes(name)) throw new Error(`unknown provider ${JSON.stringify(name)}`);
  assertTestSettingsAccess();
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('provider patch must be an object');
  const allowed = new Set([...PROVIDER_SECRET_KEYS[name], 'maxConcurrent',
    ...(name === 'copilot' ? ['accountType', 'acknowledgedTerms', 'termsVersion', 'login'] : ['baseUrl'])]);
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.has(k)) throw new Error(`unknown provider field ${JSON.stringify(k)} for ${name}`);
    if (isClearInput(v)) continue;
    if (PROVIDER_SECRET_KEYS[name].includes(k) || k === 'login') {
      if (typeof v !== 'string' || !v.trim()) throw new Error(`${k} must be a non-empty string`);
    } else if (k === 'accountType') {
      if (!COPILOT_ACCOUNT_TYPES.includes(v)) throw new Error(`accountType must be one of ${COPILOT_ACCOUNT_TYPES.join(' | ')}`);
    } else if (k === 'baseUrl') {
      if (!isUpstreamBaseUrl(v)) throw new Error('baseUrl must be an http(s) URL with no query or fragment');
    } else if (k === 'maxConcurrent') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > MAX_PROVIDER_CONCURRENCY) throw new Error(`maxConcurrent must be an integer from 1 to ${MAX_PROVIDER_CONCURRENCY}`);
    } else if (k === 'acknowledgedTerms') {
      if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw new Error('acknowledgedTerms must be an ISO timestamp');
    } else if (k === 'termsVersion') {
      if (!Number.isInteger(v) || v <= 0) throw new Error('termsVersion must be a positive integer');
    }
  }
  const settings = readSettings();
  const all = settings.providers && typeof settings.providers === 'object' && !Array.isArray(settings.providers) ? settings.providers : {};
  const cur = all[name] && typeof all[name] === 'object' && !Array.isArray(all[name]) ? { ...all[name] } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (isClearInput(v)) delete cur[k];
    else if (k === 'maxConcurrent') cur[k] = Number(v);
    else if (k === 'baseUrl') cur[k] = v.trim().replace(/\/+$/, '');
    else cur[k] = typeof v === 'string' ? v.trim() : v;
  }
  if (dryRun) return { ...providerDefaults(name), ...sanitizeProvider(name, cur) };
  if (Object.keys(cur).length) all[name] = cur; else delete all[name];
  if (Object.keys(all).length) settings.providers = all; else delete settings.providers;
  await persistSettings(settings);
  return providerConfig(name);
}

// ── Speech (Ask Worca voice mode, docs/speech.md) ──
//   providers: { …, speech: {
//     stt: { engine?, baseUrl?, apiKey?, model?, language?, pause? },
//     tts: { engine?, baseUrl?, apiKey?, model?, voice?, speed? },
//   } }
// engine: 'browser' (the default — Whisper / Kokoro run in the page, src/core/speech-assets.mjs)
// or 'server' (the baseUrl fields); tts may also be 'off' (replies stay text only).
// NOT a model-bridge upstream: it never joins UPSTREAM_PROVIDERS, allProviders(),
// the catalog or /api/models. Keys are literal or a whole-value ${VAR}, resolved at
// use time by resolveProviderSecret like every provider key.
const SPEECH_DEFAULTS = Object.freeze({
  // pause: seconds of silence that end an utterance (the voice detector's wait), any engine.
  stt: Object.freeze({ engine: 'browser', baseUrl: 'http://127.0.0.1:8080/v1', model: 'whisper-1', language: 'auto', pause: 1.2 }),
  tts: Object.freeze({ engine: 'browser', baseUrl: '', model: 'tts-1', voice: 'af_heart', speed: 1 }),
});
const SPEECH_FIELDS = Object.freeze({
  stt: Object.freeze(['engine', 'baseUrl', 'apiKey', 'model', 'language', 'pause']),
  tts: Object.freeze(['engine', 'baseUrl', 'apiKey', 'model', 'voice', 'speed']),
});
const SPEECH_ENGINES = Object.freeze({ stt: Object.freeze(['browser', 'server']), tts: Object.freeze(['browser', 'server', 'off']) });
const SPEECH_LANG_RE = /^(auto|[a-z]{2,3})$/;
const SPEECH_ID_RE = /^[\w.:/@+-]{1,128}$/;
const speechObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Why `v` is not a valid value for speech field `k` of `kind`, or null when it is. */
function speechFieldError(k, v, kind) {
  if (k === 'engine') return typeof v === 'string' && SPEECH_ENGINES[kind].includes(v.trim().toLowerCase()) ? null : `engine must be ${SPEECH_ENGINES[kind].map((e) => `"${e}"`).join(' or ')}`;
  if (k === 'baseUrl') return isUpstreamBaseUrl(v) ? null : 'baseUrl must be an http(s) URL with no query or fragment';
  if (k === 'apiKey') return typeof v === 'string' && v.trim() ? null : 'apiKey must be a non-empty string';
  if (k === 'language') return typeof v === 'string' && SPEECH_LANG_RE.test(v.trim().toLowerCase()) ? null : 'language must be "auto" or an ISO 639 code such as "bg"';
  if (k === 'pause') { const n = Number(v); return (typeof v === 'number' || typeof v === 'string') && String(v).trim() !== '' && Number.isFinite(n) && n >= 0.3 && n <= 5 ? null : 'pause must be a number of seconds from 0.3 to 5'; }
  if (k === 'speed') { const n = Number(v); return (typeof v === 'number' || typeof v === 'string') && Number.isFinite(n) && n >= 0.25 && n <= 4 ? null : 'speed must be a number from 0.25 to 4'; }
  return typeof v === 'string' && SPEECH_ID_RE.test(v.trim()) ? null : `${k} must be an id (letters, digits and . _ - : / @ +)`;
}

function normSpeechField(k, v) {
  if (k === 'baseUrl') return v.trim().replace(/\/+$/, '');
  if (k === 'speed' || k === 'pause') return Number(v);
  if (k === 'language' || k === 'engine') return v.trim().toLowerCase();
  return v.trim();
}

/** Stored speech block → only the valid fields (never throws; like sanitizeProvider). */
function sanitizeSpeech(raw) {
  const r = speechObj(raw) ? raw : {};
  const out = { stt: {}, tts: {} };
  for (const kind of Object.keys(SPEECH_FIELDS)) {
    const side = speechObj(r[kind]) ? r[kind] : {};
    for (const k of SPEECH_FIELDS[kind]) {
      if (side[k] === undefined) continue;
      const why = speechFieldError(k, side[k], kind);
      if (why) console.warn(`[worca] providers.speech.${kind}.${k}: ${why} — ignored`);
      else out[kind][k] = normSpeechField(k, side[k]);
    }
  }
  return out;
}

/** Effective speech config: defaults under the stored block. The key stays raw (literal or ${VAR}). */
export function speechConfig() {
  const d = { stt: { ...SPEECH_DEFAULTS.stt }, tts: { ...SPEECH_DEFAULTS.tts } };
  if (process.env.NODE_TEST_CONTEXT && !process.env.WORCA_TEST_ALLOW_HOME_FALLBACK) return d;
  const all = readSettings().providers;
  const s = sanitizeSpeech(speechObj(all) ? all.speech : undefined);
  return { stt: { ...d.stt, ...s.stt }, tts: { ...d.tts, ...s.tts } };
}

/** Patch { stt?: {...}, tts?: {...} }; '' / null clears a field back to its default. */
export async function updateSpeech(patch = {}) {
  assertTestSettingsAccess();
  if (!speechObj(patch)) throw new Error('speech patch must be an object');
  for (const [kind, side] of Object.entries(patch)) {
    if (!SPEECH_FIELDS[kind]) throw new Error(`unknown speech service ${JSON.stringify(kind)} (stt or tts)`);
    if (!speechObj(side)) throw new Error(`speech.${kind} must be an object`);
    for (const [k, v] of Object.entries(side)) {
      if (!SPEECH_FIELDS[kind].includes(k)) throw new Error(`unknown speech field ${JSON.stringify(k)} for ${kind}`);
      if (isClearInput(v)) continue;
      const why = speechFieldError(k, v, kind);
      if (why) throw new Error(`${kind}: ${why}`);
    }
  }
  const settings = readSettings();
  const all = speechObj(settings.providers) ? settings.providers : {};
  const cur = speechObj(all.speech) ? { ...all.speech } : {};
  for (const [kind, side] of Object.entries(patch)) {
    const s = speechObj(cur[kind]) ? { ...cur[kind] } : {};
    for (const [k, v] of Object.entries(side)) {
      if (isClearInput(v)) delete s[k]; else s[k] = normSpeechField(k, v);
    }
    if (Object.keys(s).length) cur[kind] = s; else delete cur[kind];
  }
  if (Object.keys(cur).length) all.speech = cur; else delete all.speech;
  if (Object.keys(all).length) settings.providers = all; else delete settings.providers;
  await persistSettings(settings);
  return speechConfig();
}

/** Record the Copilot terms acknowledgement at the current wording version. */
export async function acknowledgeCopilotTerms(now = new Date()) {
  return updateProvider('copilot', { acknowledgedTerms: now.toISOString(), termsVersion: COPILOT_TERMS_VERSION });
}

/** Forget the Copilot sign-in (token + login); the acknowledgement stays. */
export async function clearCopilotSignIn() {
  return updateProvider('copilot', { githubToken: null, login: null });
}

// ── Interface mode (docs/ui-levels.md) ───────────────────────────────────────
// One machine-wide preference deciding how much of the web UI is on screen:
// `simple` (the core loop), `advanced` (git, cost, workflows) or `expert`
// (everything). A VIEW preference, never a permission. The server writes it into
// the shell's <html data-level> at serve time, like the theme. The STORED value
// may be absent: the default then depends on whether this is a fresh install
// (defaultUiLevel), which only the server can tell, so `uiLevel()` answers null
// for "never chosen" rather than guessing.
export const UI_LEVELS = Object.freeze(['simple', 'advanced', 'expert']);
const isUiLevel = (v) => UI_LEVELS.includes(v);

/** STORED interface mode, or null when never chosen. An invalid value is null (loudly). */
export function uiLevel() {
  const v = readSettings().uiLevel;
  if (v === undefined) return null;
  if (isUiLevel(v)) return v;
  console.warn(`[worca] invalid uiLevel ${JSON.stringify(v)} — using the default`);
  return null;
}

/**
 * The mode for an install that never chose one. A fresh install starts simple;
 * an install that already has history starts expert, which is the UI it always
 * had, so an upgrade hides nothing.
 * @param {{fresh:boolean}} facts
 */
export function defaultUiLevel({ fresh } = {}) {
  return fresh ? 'simple' : 'expert';
}

/** @throws {Error} unless `input` is simple|advanced|expert, or empty/null (a clear). */
export function assertUiLevelInput(input) {
  if (isClearInput(input)) return;
  if (!isUiLevel(input)) throw new Error('uiLevel must be simple, advanced or expert');
}

/** Persist the mode. Every valid value is stored (there is no fixed default to elide); a clear deletes the key. */
export async function setUiLevel(input) {
  assertUiLevelInput(input);
  const settings = readSettings();
  if (isClearInput(input)) delete settings.uiLevel;
  else settings.uiLevel = input;
  await persistSettings(settings);
  return { uiLevel: uiLevel() };
}

// ── Getting started (onboarding) ─────────────────────────────────────────────
// Two machine-wide flags, nothing more: which steps are DONE is derived from
// product state by src/core/onboarding.mjs and never stored. `hidden` is the
// checklist's Hide (Settings › General › Getting started shows it again);
// `welcomeSeen` is the one-time welcome dialog. Both absent = both false.
export function onboardingPrefs() {
  const o = readSettings().onboarding;
  const obj = o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  return { hidden: obj.hidden === true, welcomeSeen: obj.welcomeSeen === true };
}

/** @throws {Error} unless every present key is a boolean. Unknown keys are refused. */
export function assertOnboardingPrefsInput(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('onboarding prefs must be an object');
  for (const [k, v] of Object.entries(patch)) {
    if (k !== 'hidden' && k !== 'welcomeSeen') throw new Error(`unknown onboarding key ${JSON.stringify(k)}`);
    if (typeof v !== 'boolean') throw new Error(`onboarding.${k} must be true or false`);
  }
}

/** Merge `patch` over the stored flags; a store with both flags false drops the key. */
export async function setOnboardingPrefs(patch = {}) {
  assertOnboardingPrefsInput(patch);
  const settings = readSettings();
  const next = { ...onboardingPrefs(), ...patch };
  if (!next.hidden && !next.welcomeSeen) delete settings.onboarding;
  else settings.onboarding = next;
  await persistSettings(settings);
  return onboardingPrefs();
}

// ── Scheduled runs (schema v31) ──────────────────────────────────────────────
// Defaults a new schedule inherits; each schedule stores its own copy, so a later
// change here never rewrites an existing schedule. Read fresh, never throwing.
//   scheduleGraceMin    — minutes a missed slot may still start late (default 360).
//   scheduleIfMissed    — 'run' (start late inside the grace window) | 'skip'.
//   scheduleMaxFailures — consecutive failures before a recurring schedule pauses
//                         itself; 0 = never (default 3).
export const DEFAULT_SCHEDULE_GRACE_MIN = 360;
export const DEFAULT_SCHEDULE_IF_MISSED = 'run';
export const DEFAULT_SCHEDULE_MAX_FAILURES = 3;
export const SCHEDULE_IF_MISSED = ['run', 'skip'];

const isGraceMin = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 10080;
const isMaxFailures = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 100;

/** The schedule defaults: { graceMin, ifMissed, maxFailures }. */
export function scheduleDefaults() {
  const s = readSettings();
  return {
    graceMin: isGraceMin(s.scheduleGraceMin) ? s.scheduleGraceMin : DEFAULT_SCHEDULE_GRACE_MIN,
    ifMissed: SCHEDULE_IF_MISSED.includes(s.scheduleIfMissed) ? s.scheduleIfMissed : DEFAULT_SCHEDULE_IF_MISSED,
    maxFailures: isMaxFailures(s.scheduleMaxFailures) ? s.scheduleMaxFailures : DEFAULT_SCHEDULE_MAX_FAILURES,
  };
}

/**
 * Persist any subset of the schedule defaults; '' / null clears a key back to its
 * default. The whole patch is validated before anything is written.
 * @throws {Error} on the first invalid value
 */
export async function setScheduleDefaults(patch = {}) {
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);
  const clear = (v) => v === '' || v === null || v === undefined;
  if (has('graceMin') && !clear(patch.graceMin) && !isGraceMin(patch.graceMin)) throw new Error('scheduleGraceMin must be a whole number of minutes from 0 to 10080');
  if (has('ifMissed') && !clear(patch.ifMissed) && !SCHEDULE_IF_MISSED.includes(patch.ifMissed)) throw new Error(`scheduleIfMissed must be one of ${SCHEDULE_IF_MISSED.join(' | ')}`);
  if (has('maxFailures') && !clear(patch.maxFailures) && !isMaxFailures(patch.maxFailures)) throw new Error('scheduleMaxFailures must be a whole number from 0 to 100');
  const settings = readSettings();
  const put = (key, v) => { if (clear(v)) delete settings[key]; else settings[key] = v; };
  if (has('graceMin')) put('scheduleGraceMin', patch.graceMin);
  if (has('ifMissed')) put('scheduleIfMissed', patch.ifMissed);
  if (has('maxFailures')) put('scheduleMaxFailures', patch.maxFailures);
  await persistSettings(settings);
  return scheduleDefaults();
}

// ── Sync before run (#527) ─────────────────────────────────────────────────
export const SYNC_ON_DIVERGED = Object.freeze(['ask', 'origin', 'fail']);
export const DEFAULT_SYNC_SETTINGS = Object.freeze({ beforeRun: true, remote: 'origin', refreshMinutes: 10, onDiverged: 'ask' });
const SYNC_REMOTE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Merge `v` over `base`, keeping only valid keys. Pure. */
export function normalizeSyncSettings(v, base = DEFAULT_SYNC_SETTINGS) {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  return {
    beforeRun: typeof o.beforeRun === 'boolean' ? o.beforeRun : base.beforeRun,
    remote: typeof o.remote === 'string' && SYNC_REMOTE_RE.test(o.remote) ? o.remote : base.remote,
    refreshMinutes: Number.isInteger(o.refreshMinutes) && o.refreshMinutes >= 0 && o.refreshMinutes <= 1440 ? o.refreshMinutes : base.refreshMinutes,
    onDiverged: SYNC_ON_DIVERGED.includes(o.onDiverged) ? o.onDiverged : base.onDiverged,
  };
}
export function syncDefaults() { return normalizeSyncSettings(readSettings().sync); }

/** @throws {Error} on anything but a partial, valid sync object (null / '' resets; a null key resets that key). */
export function assertSyncSettingsInput(patch) {
  if (patch === null || patch === '') return;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('sync must be an object');
  for (const k of Object.keys(patch)) if (!Object.hasOwn(DEFAULT_SYNC_SETTINGS, k)) throw new Error(`unknown sync setting: ${k}`);
  const set = (k) => k in patch && patch[k] !== null;
  if (set('beforeRun') && typeof patch.beforeRun !== 'boolean') throw new Error('sync.beforeRun must be true or false');
  if (set('remote') && !(typeof patch.remote === 'string' && SYNC_REMOTE_RE.test(patch.remote))) throw new Error('sync.remote must be a remote NAME (e.g. origin), never a URL');
  if (set('refreshMinutes') && !(Number.isInteger(patch.refreshMinutes) && patch.refreshMinutes >= 0 && patch.refreshMinutes <= 1440)) throw new Error('sync.refreshMinutes must be an integer 0–1440 (0 = never)');
  if (set('onDiverged') && !SYNC_ON_DIVERGED.includes(patch.onDiverged)) throw new Error(`sync.onDiverged must be one of ${SYNC_ON_DIVERGED.join(' | ')}`);
}
export async function setSyncDefaults(patch) {
  assertSyncSettingsInput(patch);
  const settings = readSettings();
  if (patch === null || patch === '') delete settings.sync;
  else {
    // Store only the keys someone set: a key left out follows the built-in default as it changes.
    const prev = settings.sync && typeof settings.sync === 'object' && !Array.isArray(settings.sync) ? settings.sync : {};
    const next = {};
    for (const k of Object.keys(DEFAULT_SYNC_SETTINGS)) if (Object.hasOwn(prev, k)) next[k] = normalizeSyncSettings(prev)[k];
    for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = v; }
    if (Object.keys(next).length) settings.sync = next; else delete settings.sync;
  }
  await persistSettings(settings);
  return syncDefaults();
}
