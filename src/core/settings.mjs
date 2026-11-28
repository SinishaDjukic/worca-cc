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
//   resumeAfterUsageLimit  — opt-in boolean (default false): schedule a usage-limit pause's
//                            resume for just after the limit resets, unattended.
//   autoGeneratePrDescription — opt-in boolean (default false): the Create PR dialog
//                            drafts its description with AI as soon as it opens.
//   updateCheck            — boolean (default true): check npm for a newer stable Worca (Settings › About).
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
// plus the zero-import model-env.mjs and night/config.mjs leaves, the
// web-allowlist.mjs leaf, which imports only node:net and node:url, and the
// secrets/settings-resolver.mjs leaf, which imports only node:fs and refs.mjs). projects.mjs imports it, so
// importing projects.mjs back would make worcaHome() -> getWorcaRoot() ->
// projects.mjs an infinite cycle.
//
// Reads are synchronous + never-throwing (worcaHome's callers are sync). There
// is deliberately no in-module cache: worcaHome() is read fresh per operation,
// so a saved root takes effect for new runs/listing without a server restart.

import { isAnswererLead, answererLeadKeys } from '../shared/answerer.mjs';
import { CHAT_SOURCE_BRANCH_MODES, SOURCE_BRANCH_TEXT, normalizeChatSourceBranch } from '../shared/chat-source-branch.mjs';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { suggestModelHandle } from '../shared/connections.mjs';
export { suggestModelHandle };
import { readFileSync, existsSync, statSync, mkdirSync, chmodSync, readdirSync } from 'node:fs';
import { writeJsonAtomic } from './json-atomic.mjs';
import { join, resolve, dirname } from 'node:path';
import { homedir, availableParallelism } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  EFFORTS, CODEX_EFFORTS, effortsForEngine, MODEL_ENGINES, RUN_ENGINES, ASK_ENGINES, HELPER_ENGINES, OWN_SIGNIN_ENGINES, aModelOf, ownSignInNote, modelIdProblem, SUBAGENT_MODELS, isReservedModelEnvKey, assertModelCost, envFlag,
  OPENCODE_ZEN_RE,
  assertModelUpstream, upstreamEnvConflict, modelEnvRef, codexUpstreamProblem,
  UPSTREAM_PROVIDERS, COPILOT_ACCOUNT_TYPES, DEFAULT_PROVIDER_CONCURRENCY, MAX_PROVIDER_CONCURRENCY,
  isUpstreamBaseUrl, REASONING_EFFORT_LEVELS, OPENROUTER_SORTS, isReadableModelEnvKey, maskModelEnvValue,
} from './model-env.mjs';
import { isVaultRef } from './secrets/refs.mjs';
import { refsDropped, resolveSettingsSecretSync, settingsSecretField, settingsSecretRefs, settingsSecretSlots } from './secrets/settings-resolver.mjs';
import { MODEL_ROLES } from '../shared/model-roles.mjs';
import { GHE_COM_ACCOUNT_TYPE, normalizeGheHost, copilotBlockHost } from './ghe-host.mjs';
import { CODEX_PRICES, listPriceFor } from './list-prices.mjs';
import { engineLabel } from '../shared/engine-switch.mjs';
import { validateNightPatch, NIGHT_TOGGLES } from './night/config.mjs';
import { normalizeDomainList, normalizeDomainPattern, domainError, DOMAIN_LIST_MAX, RESERVED_KEY_VAR } from './web-allowlist.mjs';
import { normaliseDimensions } from '../shared/tag-dimensions.mjs';
import { isGuideAreaId } from '../shared/how-it-works/areas.mjs';
import { isExecEnvName, execEnvNames } from './exec-env/index.mjs';
import { DEFAULT_E2B_MAX_SANDBOXES, DEFAULT_E2B_MAX_WAIT_MIN } from './exec-env/e2b-config.mjs';
import { DEFAULT_DOCKER_MAX_SANDBOXES, DEFAULT_DOCKER_MAX_WAIT_MIN, sandboxResources } from './exec-env/backends/docker.mjs';
import { normalizePins, storedPins } from '../shared/home-pins.mjs';
import { DEFAULT_PATTERN, DEFAULT_TYPES, TYPE_RE, patternProblem } from '../shared/naming/pattern.mjs';
import { IMAGE_SERVICES, IMAGE_SHAPES, originOf } from '../shared/image-services.mjs';
export { IMAGE_SERVICES, IMAGE_SHAPES };

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
 * The body is synchronous on purpose: a setter that awaits nothing between its
 * readSettings() and this call reads, merges and commits in one run of the event
 * loop, so two setters saved at the same moment can never drop each other's change.
 * `beforeRename` is writeJsonAtomic's last check (a swap's stale-file check); `release: false` skips the release of
 * dropped references (export's restore: the vault and its entries go as a whole).
 */
async function persistSettings(settings, { beforeRename, release = true } = {}) {
  // The vault references the file holds now, read synchronously (still nothing awaited before the write). Parsed only
  // when the text holds one, so a file without references costs one read and no parse.
  let before = [];
  try {
    const old = readFileSync(settingsFile(), 'utf8');
    if (release && old.includes('worca:vault:v1:')) before = settingsSecretRefs(JSON.parse(old));
  } catch { /* none (ENOENT), or unreadable: nothing to release */ }
  mkdirSync(join(defaultRoot(), '.worca-cc'), { recursive: true }); // bootstrap dir
  writeJsonAtomic(settingsFile(), settings, { mode: 0o600, beforeRename });   // owner-only: it holds provider keys
  if (before.length) await releaseDroppedSettingsRefs(refsDropped(before, settingsSecretRefs(settings)));
}

/**
 * After a settings write landed: release the vault entries of the references it dropped (a cleared key, a deleted
 * model, a key replaced by `${VAR}`), while the vault is in use (flag on, or a vault file left). Never rejects: a setter's write stands, and a
 * failed release leaves an orphan entry (store-vault.mjs logs it).
 */
async function releaseDroppedSettingsRefs(dropped) {
  if (!dropped.length) return;
  try {
    const { vaultInUse } = await import('./secrets/flag.mjs');
    if (!vaultInUse()) return;
    const { releaseStoreRefs, LOCKLESS_GRACE_MS } = await import('./secrets/store-vault.mjs');
    // A strict re-read: a file that cannot be read or parsed throws, and the release keeps every entry.
    const held = () => new Set(settingsSecretRefs(JSON.parse(readFileSync(settingsFile(), 'utf8'))).map((r) => r.ref));
    await releaseStoreRefs('settings', dropped, { stillReferenced: (ref) => held().has(ref), graceMs: LOCKLESS_GRACE_MS,
      scope: () => true });
  } catch { /* never fails the setter */ }
}

// A temp copy persistSettings (writeJsonAtomic) leaves behind when the process dies mid-write.
const SETTINGS_TMP_RE = /^settings\.json\.[0-9a-f]{8}\.tmp$/;

/**
 * Make an existing settings.json, and any leftover temp copy beside it, owner-only (0600) when a group or other
 * bit is set: files written before persistSettings wrote 0600. Called at CLI and server start. A no-op on Windows
 * (the profile's own permissions are relied on). A missing settings.json answers `missing`, its temp copies tightened
 * all the same. Never throws: an fs error prints
 * one warning line naming its code. `chmod` and `stat` are test injections.
 * @returns {{ changed: boolean, reason?: 'windows'|'missing'|'already'|'error', code?: string }}
 */
export function tightenSettingsFileMode({ platform = process.platform, chmod = chmodSync, stat = statSync } = {}) {
  if (platform === 'win32') return { changed: false, reason: 'windows' };
  if (homeGuarded()) return { changed: false, reason: 'missing' };
  const file = settingsFile();
  let changed = false;
  const tighten = (p) => { if (stat(p).mode & 0o077) { chmod(p, 0o600); changed = true; } };
  let missing = false;
  try {
    try { tighten(file); } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
      missing = true;
    }
    const dir = dirname(file);
    let names = [];
    try { names = readdirSync(dir); } catch (err) { if (err?.code !== 'ENOENT') throw err; }
    // The temp copies too, even with settings.json missing: a copy left by a crash mid-write still holds the keys.
    for (const name of names) {
      if (!SETTINGS_TMP_RE.test(name)) continue;
      try { tighten(join(dir, name)); } catch (err) { if (err?.code !== 'ENOENT') throw err; }   // renamed meanwhile: fine
    }
    if (missing) return { changed: false, reason: 'missing' };
  } catch (err) {
    const code = err?.code || 'error';
    console.warn(`[worca] could not make settings.json owner-only (${code}); run chmod 600 on it or fix its owner`);
    return { changed: false, reason: 'error', code };
  }
  return changed ? { changed: true } : { changed: false, reason: 'already' };
}

/** Setup apply (D20): set or delete whole top-level keys in ONE read and ONE persistSettings. `undefined` deletes. */
export async function writeSettingsKeys(values) {
  const settings = readSettings();
  for (const [k, v] of Object.entries(values)) { if (v === undefined) delete settings[k]; else settings[k] = v; }
  await persistSettings(settings);
  return Object.keys(values);
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
// relocate the user's instruction root — that holds for an explicit value. The
// DEFAULT (nothing set) is `<worcaHome>/projects` (U6): New and Clone from URL
// create projects there, so it follows WORCA_HOME and the Settings root. Existing
// projects stay where they are.
// ---------------------------------------------------------------------------

/**
 * The effective projects root. Precedence: WORCA_PROJECTS_ROOT env →
 * settings.projectsRoot → <worcaHome>/projects (worcaProjectsFolder()). ALWAYS an absolute path (never '',
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
  return typeof r === 'string' && r.trim() ? resolve(expandTilde(r.trim())) : worcaProjectsFolder();
}

/**
 * The RAW persisted projectsRoot — '' when the key is absent, blank, or not a
 * string. The exact mirror of getWorcaRoot(), and what the settings UI puts in
 * its field: "unset" must stay distinguishable from "explicitly set", so a blank
 * field can round-trip as blank and the "leave blank to use worca's projects
 * folder" affordance is real.
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
 * else <worcaHome>/projects (worcaProjectsFolder()). This is the settings-UI placeholder, i.e. the honest answer
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
  return worcaProjectsFolder();
}

/**
 * The DEFAULT projects root, <worcaHome>/projects (U6): New and Clone from URL create projects there. Mirrors
 * projects.mjs#worcaHome()'s base rule (this module may not import projects.mjs); no node:test guard — it only
 * computes a path. Never creates it.
 */
export function worcaProjectsFolder() {
  const env = process.env.WORCA_HOME;
  const base = env && env.trim() ? env : (getWorcaRoot() || defaultRoot());
  return join(resolve(base), '.worca-cc', 'projects');
}

/** Which tier getProjectsRoot() used: 'env' | 'settings' | 'default'. Read fresh on every call. */
export function projectsRootSource() {
  const env = process.env.WORCA_PROJECTS_ROOT;
  if (env && env.trim()) return 'env';
  const r = readSettings().projectsRoot;
  return typeof r === 'string' && r.trim() ? 'settings' : 'default';
}

/**
 * Persist the projects root. Pass '' / null / non-string to CLEAR it (reset to
 * <worcaHome>/projects). A non-empty value is `~`-expanded, resolved absolute, and must
 * be an EXISTING directory — worca writes under projectsRoot only to create a
 * project folder (New, Clone from URL) and the root itself on first use; a typed
 * path must still exist, so a typo is rejected, not created (this is the one divergence from setWorcaRoot, which pre-creates
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
export const DEFAULT_MEMORY_TEAM_MAX_FILES = 50;   // team notes WITHOUT paths a run or chat loads per project, newest first; scoped ones always load

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
    teamMaxFiles: projectOverride('memory.teamMaxFiles', scope) ?? readMemoryCap('teamMaxFiles', DEFAULT_MEMORY_TEAM_MAX_FILES),
    defrag: {
      writes: projectOverride('memory.defrag.writes', scope) ?? readDefragThreshold('writes', DEFAULT_MEMORY_DEFRAG_WRITES),
      files: projectOverride('memory.defrag.files', scope) ?? readDefragThreshold('files', DEFAULT_MEMORY_DEFRAG_FILES),
      bytesPct: projectOverride('memory.defrag.bytesPct', scope) ?? readDefragThreshold('bytesPct', DEFAULT_MEMORY_DEFRAG_BYTES_PCT, { pct: true }),
      alwaysOnBytes: projectOverride('memory.defrag.alwaysOnBytes', scope) ?? readDefragThreshold('alwaysOnBytes', DEFAULT_MEMORY_DEFRAG_ALWAYS_ON_BYTES),
    },
  };
}

/** Team memory (phase 1a) is on for this project. The PROJECT layer only — no settings.json default, no team-policy
 *  field: sharing is opted into one project at a time. No scope (a global note, a workspace run) is always off.
 *  `memory.team` is `true` (on, runs and chats load local and team notes) or `"only"` (on, they load team notes only:
 *  team-memory-load-choice.md); anything else is off. */
export function teamMemoryEnabled(scope) { return teamMemoryLoad(scope) !== 'local'; }
/** Which notes of this project a run or chat loads: 'local' (team memory off), 'both' (`memory.team: true`) or 'team'
 *  (`memory.team: "only"`). */
export function teamMemoryLoad(scope) {
  const v = projectOverride('memory.team', scope);
  return v === true ? 'both' : v === TEAM_MEMORY_ONLY ? 'team' : 'local';
}
export const TEAM_MEMORY_ONLY = 'only';

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
  return assertModelPairInput('memoryDefrag', input, models);
}

/** The `{ model, effort }` pair check shared by memoryDefrag, agentGenModel, namingModel and commandSummaryModel; `key`
 *  names the setting in every message. */
function assertModelPairInput(key, input, models) {
  if (input === '' || input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error(`${key} must be { model, effort } or null`);
  const blank = (v) => v === null || v === undefined || (typeof v === 'string' && !v.trim());
  if (blank(input.model)) {
    if (!blank(input.effort)) throw new Error(`${key}.effort needs a model — an effort without a model means nothing`);
    return null;
  }
  if (typeof input.model !== 'string' || !input.model.trim() || input.model.length > DEFRAG_MODEL_MAX_LEN) {
    throw new Error(`${key}.model must be a catalog model id`);
  }
  const effortIn = typeof input.effort === 'string' ? input.effort.trim() : input.effort;   // trimmed like setNodeModel / checkStartPair
  if (!blank(effortIn) && !EFFORTS.includes(effortIn)) {
    throw new Error(`${key}.effort must be one of ${EFFORTS.join(' | ')}`);
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

/** #943: whether pipeline agents (Claude) also load the user's own Claude Code setup — `~/.claude` settings, hooks,
 *  plugins and skills. Off by default: a node spawns with `--setting-sources project`. A project setting wins. */
export function runUserClaudeSettings(scope) {
  const p = projectOverride('runUserClaudeSettings', scope); if (typeof p === 'boolean') return p;
  return readSettings().runUserClaudeSettings === true;
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

// ── Smart run naming (src/core/naming.mjs, flag smartRunNaming) ───────────────
// `smartNaming` = { suggestTitle, suggestBranch, pattern, types, trigger, addRunId }. The stored
// block holds only what differs from the defaults. The project layer may hold `pattern` and `types` only.
// The model is a helper job of its own (`namingModel`); a leftover `model` key from before is ignored.
export const SMART_NAMING_DEFAULTS = Object.freeze({
  suggestTitle: true, suggestBranch: true,
  pattern: DEFAULT_PATTERN, types: Object.freeze([...DEFAULT_TYPES]), trigger: 'debounce', addRunId: false,
});

/** Validate + normalise a user-layer block (partial allowed). Throws Error with a field-ready message. */
export function assertSmartNamingInput(input) {
  if (!isObj(input)) throw new Error('smart run naming must be an object');
  const out = {};
  for (const k of ['suggestTitle', 'suggestBranch', 'addRunId']) {
    if (k in input) { if (typeof input[k] !== 'boolean') throw new Error(`${k} must be true or false`); out[k] = input[k]; }
  }
  if ('pattern' in input) { const p = patternProblem(input.pattern); if (p) throw new Error(p); out.pattern = input.pattern.trim(); }
  if ('types' in input) {
    const t = input.types;
    if (!Array.isArray(t) || !t.length || t.length > 20 || t.some((x) => typeof x !== 'string' || !TYPE_RE.test(x))) {
      throw new Error('types must be 1 to 20 short lowercase words');
    }
    out.types = [...new Set(t)];
  }
  if ('trigger' in input) { if (!['debounce', 'manual'].includes(input.trigger)) throw new Error('trigger must be debounce or manual'); out.trigger = input.trigger; }
  return out;
}

/** Effective config: defaults, then the user block, then the project layer (pattern and types only). */
export function smartNaming(scope) {
  const user = readSettings().smartNaming;
  const proj = projectOverride('smartNaming', scope);
  const pick = (o) => (isObj(o) ? o : {});
  const { model: _legacyModel, ...stored } = pick(user);   // the model moved to namingModel: ignore a leftover
  const merged = { ...SMART_NAMING_DEFAULTS, ...stored };
  merged.types = [...merged.types];
  for (const k of ['pattern', 'types']) if (pick(proj)[k] !== undefined) merged[k] = k === 'types' ? [...proj[k]] : proj[k];
  return merged;
}

/** setSmartNaming's merge, pure: `null` deletes; keys equal to the default are dropped. undefined = delete the block. */
export function nextSmartNaming(current, input) {
  if (input === null) return undefined;
  const { model: _legacyModel, ...prev } = isObj(current) ? current : {};   // dropped on save
  const next = { ...prev, ...assertSmartNamingInput(input) };
  for (const [k, def] of Object.entries(SMART_NAMING_DEFAULTS)) if (JSON.stringify(next[k]) === JSON.stringify(def)) delete next[k];
  return Object.keys(next).length ? next : undefined;
}

/** `null` deletes the block; otherwise the validated keys merge over the stored block and keys equal to the default are dropped. */
export async function setSmartNaming(input) {
  const settings = readSettings();
  const next = nextSmartNaming(settings.smartNaming, input);
  if (next !== undefined) settings.smartNaming = next; else delete settings.smartNaming;
  await persistSettings(settings);
  return { smartNaming: smartNaming() };
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

// ── Away mode per person (B4, opt-in) ──────────────────────────────────────────
// With WORCA_AWAY_PER_PERSON=1 (a team instance with a per-person sign-in), "I'm here / I'm away"
// belongs to each signed-in person and applies only to the runs they started or last resumed.
// It lives in its own file, keyed by the identity name (identity.mjs, lowercased). Unset = the
// one instance-wide nightModeToggle above, exactly as before; a person with no record of their
// own also follows that instance value.
export function awayPerPerson(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.WORCA_AWAY_PER_PERSON || '').trim());
}

/** The person key a record is stored under, or null ('local' and blanks are nobody in particular). */
export function awayPersonKey(person) {
  const k = typeof person === 'string' ? person.trim().toLowerCase() : '';
  return k && k !== 'local' && k.length <= 200 ? k : null;
}

export function awayPeopleFile() {
  return join(defaultRoot(), '.worca-cc', 'away-people.json');
}

function readAwayPeople() {
  try {
    const data = JSON.parse(readFileSync(awayPeopleFile(), 'utf8'));
    return isObj(data) ? data : {};
  } catch {
    return {};
  }
}

/** This person's own { toggle, hereSince } (hereSince in ms or null), or null when per-person
 *  Away mode is off, the person is nobody in particular, or they never set it. */
export function personAwayStatus(person) {
  if (!awayPerPerson()) return null;
  const k = awayPersonKey(person);
  if (!k) return null;
  const r = readAwayPeople()[k];
  if (!isObj(r)) return null;
  const t = Date.parse(r.hereSince);
  return { toggle: NIGHT_TOGGLES.includes(r.toggle) ? r.toggle : 'auto', hereSince: Number.isFinite(t) ? t : null };
}

/** The live switch that applies to `person`'s runs: their own when they have one, else the instance's. */
export function nightModeToggleFor(person) {
  return personAwayStatus(person)?.toggle ?? nightModeToggle();
}

/** nightModeHereSince for `person`'s runs (see nightModeToggleFor). */
export function nightModeHereSinceFor(person) {
  const own = personAwayStatus(person);
  return own ? own.hereSince : nightModeHereSince();
}

/** Write `person`'s own switch (same inputs as setNightModeToggle). Returns false, writing nothing,
 *  when per-person Away mode is off or the person is nobody in particular: the caller then sets the
 *  instance value. */
export async function setPersonNightModeToggle(person, v, { now = Date.now() } = {}) {
  assertNightModeToggleInput(v);
  const k = awayPersonKey(person);
  if (!awayPerPerson() || !k) return false;
  const all = readAwayPeople();
  all[k] = { toggle: v === 'here' ? 'auto' : v, ...(v === 'here' ? { hereSince: new Date(now).toISOString() } : {}) };
  await mkdir(join(defaultRoot(), '.worca-cc'), { recursive: true });
  const file = awayPeopleFile();
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, file);
  return true;
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

/** setUsdCap's value, pure: the number to store, or undefined = delete (unlimited). */
export function nextUsdCap(key, input) { assertUsdCapInput(key, input); return isClearInput(input) ? undefined : input; }

/** Write (or clear) a USD cap key. @throws {Error} unless positive finite number (or empty). */
async function setUsdCap(key, input) {
  const v = nextUsdCap(key, input);
  const settings = readSettings();
  if (v === undefined) delete settings[key];  // reset to unlimited
  else settings[key] = v;
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

const CHAT_NOTIFY_EVENTS = ['done', 'error', 'question', 'paused', 'away', 'prWatch'];

/**
 * Effective chat preferences. Every notification event defaults ON; channels default
 * enabled (an absent "<plugin>/<channelId>" key means enabled — presence with
 * {enabled:false} is the opt-out record); `scriptTools` (scripts-workbench W20) is the
 * chat's "Create and run scripts" switch and defaults ON, so only a stored false ever
 * takes save_script / test_script away. `suggestions` is Ask Worca's next-prompt ghost text after
 * each reply (one cheap model call per reply), default ON as well. `summariseCommands` (#911, flag
 * commandSummaries) shows chat commands as one-line rows, default ON too.
 * @returns {{notify: Record<string, boolean>, channels: Record<string, {enabled: boolean}>, scriptTools: boolean, suggestions: boolean, summariseCommands: boolean}}
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
  // `suggestions`: Ask Worca's next-prompt ghost text after each reply — default ON, only a stored false stops it.
  // `summariseCommands` (#911, flag commandSummaries): chat commands as one-line rows — default ON.
  // `sourceBranch`: "Chat runs: source branch", normalised for display (the gate reads the cascade, not this).
  return { notify, channels, scriptTools: chat.scriptTools !== false, suggestions: chat.suggestions !== false,
    summariseCommands: chat.summariseCommands !== false, sourceBranch: normalizeChatSourceBranch(chat.sourceBranch) };
}

/** "Chat runs: source branch" input: one of the modes, or null (back to the default). Throws the shared sentence. */
export function assertChatSourceBranchInput(value) {
  if (value !== null && !CHAT_SOURCE_BRANCH_MODES.includes(value)) throw new Error(SOURCE_BRANCH_TEXT.invalid);
  return value;
}

/**
 * Merge-patch the chat prefs: {notify?: {done?, error?, question?, paused?, away?},
 * channels?: {"<plugin>/<id>"?: {enabled: boolean}}, scriptTools?: boolean, suggestions?: boolean,
 * summariseCommands?: boolean, sourceBranch?: 'current'|'ask'|'require'|null}.
 * Unknown notify keys and a non-boolean scriptTools / suggestions / summariseCommands are rejected (400 at the API layer);
 * channels merge per key. A null sourceBranch deletes it (back to 'ask'); any other value outside the modes throws.
 */
export async function setChatPrefs(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('chat prefs must be an object');
  for (const k of Object.keys(patch.notify || {})) {
    if (!CHAT_NOTIFY_EVENTS.includes(k)) throw new Error(`unknown chat notify event "${k}"`);
  }
  const hasScriptTools = Object.prototype.hasOwnProperty.call(patch, 'scriptTools');
  if (hasScriptTools && typeof patch.scriptTools !== 'boolean') throw new Error('chat scriptTools must be true or false');
  const hasSuggestions = Object.prototype.hasOwnProperty.call(patch, 'suggestions');
  if (hasSuggestions && typeof patch.suggestions !== 'boolean') throw new Error('chat suggestions must be true or false');
  const hasSummaries = Object.prototype.hasOwnProperty.call(patch, 'summariseCommands');
  if (hasSummaries && typeof patch.summariseCommands !== 'boolean') throw new Error('chat summariseCommands must be true or false');
  const hasSourceBranch = Object.prototype.hasOwnProperty.call(patch, 'sourceBranch');
  if (hasSourceBranch) assertChatSourceBranchInput(patch.sourceBranch);
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
    ...(hasSuggestions ? { suggestions: patch.suggestions } : {}),
    ...(hasSummaries ? { summariseCommands: patch.summariseCommands } : {}),
    ...(hasSourceBranch && patch.sourceBranch !== null ? { sourceBranch: patch.sourceBranch } : {}),
  };
  if (hasSourceBranch && patch.sourceBranch === null) delete settings.chat.sourceBranch;
  await persistSettings(settings);
  return chatPrefs();
}

/** setCostLimitResetPeriod's value, pure: undefined = delete (back to 'monthly'). */
export function nextCostLimitResetPeriod(input) { assertResetPeriodInput(input); return isClearInput(input) ? undefined : input; }

/** @throws {Error} unless `input` is 'weekly' | 'monthly' (or empty, which resets). */
export async function setCostLimitResetPeriod(input) {
  const v = nextCostLimitResetPeriod(input);
  const settings = readSettings();
  if (v === undefined) delete settings.costLimitResetPeriod;  // reset to 'monthly'
  else settings.costLimitResetPeriod = v;
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
// `auto` port range, the editor/terminal overrides of the built-ins, the
// checkout cap, and the Browser tab's preview-port mode. editor/terminal are command paths the built-ins route spawns as
// the server user, so POST /api/settings refuses an `actions` key from agent callers.
export const ACTIONS_KEEP = ['never', 'on-success', 'until-pr'];
/** Settings › Runs › Actions › Preview ports: every loopback port, or the Actions range and running Actions only.
 *  The server forces 'range' on a hosted Worca whatever is stored here (ui/server.mjs previewPortMode). */
export const PREVIEW_PORT_MODES = ['all', 'range'];
export const DEFAULT_ACTIONS_SETTINGS = Object.freeze({ keep: 'never', portLow: 4400, portHigh: 4499, editor: '', terminal: '', maxCheckouts: null, previewPorts: 'all' });
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
    previewPorts: PREVIEW_PORT_MODES.includes(s.previewPorts) ? s.previewPorts : DEFAULT_ACTIONS_SETTINGS.previewPorts,
  };
}

/** @throws {Error} on any invalid key of an `actions` patch (absent / '' / null keys clear). */
export function assertActionsInput(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('actions must be an object');
  const has = (k) => Object.hasOwn(patch, k);
  const clear = (v) => v === '' || v === null || v === undefined;
  if (has('keep') && !clear(patch.keep) && !ACTIONS_KEEP.includes(patch.keep)) throw new Error(`actions.keep must be one of ${ACTIONS_KEEP.join(' | ')}`);
  if (has('previewPorts') && !clear(patch.previewPorts) && !PREVIEW_PORT_MODES.includes(patch.previewPorts)) {
    throw new Error(`actions.previewPorts must be one of ${PREVIEW_PORT_MODES.join(' | ')}`);
  }
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
  'askWeb',                                  // Chat web access { enabled, allowedDomains, search }
  'smartNaming',                             // Smart run naming { suggestTitle, suggestBranch, pattern, types, trigger, addRunId }
  'debugSpawnEnabled',
  'keepAwake',                               // the account menu's Keep awake switch (default on)
  'chatLinksInPanel',                        // Settings › Chat: open chat links in the panel (default on, issue 1064)
  'resumeAfterUsageLimit',
  'updateCheck',                             // Settings › About: check npm for a newer stable Worca (#841)
  'titleModel', 'hideBuiltinModels',
  'hideBuiltinEngines',                      // Models › Catalogue: Codex / Copilot hide their built-ins { codex?, copilot? }
  'theme',
  'screensaver',                             // Settings › Appearance: the screensaver { enabled, idleMinutes }
  'uiLevel',                                // interface mode (docs/ui-levels.md)
  'flags',                                   // feature flags { key: bool } (docs/feature-flags.md)
  'autoWorkflowModel',                       // auto-workflow spec D14
  'prDescriptionModel',                      // the "Ship it?" modal's Generate with AI
  'autoGeneratePrDescription',               // run that Generate with AI when the modal opens
  'memoryDefrag',                            // Settings › Memory: the defragment model + effort
  'agentGenModel',                           // the agent wizard's Generate: model + effort (Claude, user-level)
  'namingModel',                             // Smart run naming's model + effort (Models › Jobs › Helper jobs, Claude, user-level)
  'commandSummaryModel',                     // Command summaries' model + effort (Models › Jobs › Helper jobs, Claude, user-level)
  'guideModel',                              // Guide's model + effort (Models › Jobs › Helper jobs, Claude, user-level; shaperSmallRuns)
  'secondOpinionModel',                      // Second-opinion reviewer's model + effort (Models › Jobs › Helper jobs, Claude, user-level)
  'workspaceScan',                           // Settings › Runs › Workspaces: the scan's models
  'schedule',                                // scheduled-run defaults { graceMin, ifMissed, maxFailures }
  'nightMode',                               // night mode user layer (night/config.mjs fields)
  'nightModeToggle',                         // night mode live switch: auto | on | off
  'sync',                                    // sync before run (#527) { beforeRun, remote, refreshMinutes, onDiverged }
  'networkWait',                             // Settings › Runs › Wait for the network {enabled, maxWaitMin}
  'runLimits',                               // Settings › Runs › Machine load { maxConcurrentRuns, testWorkers, keepRunsDays }
  'actions',                                 // Settings › Runs › Actions { keep, portLow, portHigh, editor, terminal, maxCheckouts, previewPorts }
  'runEngine', 'stepModels', 'utilityModels',
  'modelRoles',                              // Models › Jobs › Roles: { <engine>: { deep|everyday|quick: { model, effort } } }
  'requirementsInterview',                  // Models › Jobs › Helper jobs: the requirements interview { model, effort }
  'execEnv', 'e2bMaxSandboxes', 'e2bMaxWaitMin', // the execution environment (docs/e2b.md)
  'dockerMaxSandboxes', 'dockerMaxWaitMin', 'dockerSandbox', // the Local sandbox (Docker) backend (docs/local-sandbox.md)
  'askEngine', 'askModels',                  // Chat's engine for new chats and its model per engine (user-only, D17)
  'designModels',                            // Models › Jobs › Design: { <engine>: { lead|builder: { model, effort } } }
  'tagDimensions',                           // Settings › Tags › Tag dimensions [{ key, label, values, required, default? }]
  'enforceTags',                             // Settings › Tags › Require mandatory tags to start a run
]);

let projectLayerReader = null;
export function setProjectLayerReader(fn) { projectLayerReader = typeof fn === 'function' ? fn : null; }
function projectOverride(id, scope) {
  if (!scope || !projectLayerReader) return undefined;
  try { return projectLayerReader(id, scope); } catch { return undefined; }
}

export const UTILITY_JOBS = Object.freeze(['title', 'classifier', 'overview', 'prDescription', 'memoryDefrag', 'workspaceScan', 'secondOpinion']);
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
/** Ask Worca's engine for NEW chats (cascading-settings-design.md D17): user-only; a chat can move to another engine later (#943, POST /api/ask/threads/:id/engine). */
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
/** The Requirements interview's STORED { model?, effort? } (A1.1 D1), or undefined: user-only, Claude-only, not a UTILITY_JOBS entry. */
export function requirementsInterviewSetting() {
  if (homeGuarded()) return undefined;
  const value = readSettings().requirementsInterview;
  return isObj(value) ? value : undefined;
}
/** Validate a POST value: { model?, effort? } (an effort alone is allowed), null / '' to clear. */
export function assertRequirementsInterviewInput(input) {
  return normalizeModelPair('claude', input, 'requirementsInterview');
}
export async function setRequirementsInterview(input) {
  const value = assertRequirementsInterviewInput(input);
  const settings = readSettings();
  if (value === null) delete settings.requirementsInterview; else settings.requirementsInterview = value;
  await persistSettings(settings);
  return { requirementsInterview: requirementsInterviewSetting() ?? null };
}
export function assertAskEngineInput(input) {
  if (input === null || input === undefined || input === '') return null;
  if (!ASK_ENGINES.includes(input)) throw new Error(`askEngine must be one of ${ASK_ENGINES.join(' | ')}`);
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
    if (!ASK_ENGINES.includes(engine)) throw new Error(`askModels: unknown engine "${engine}"`);
    out[engine] = normalizeModelPair(engine, value, `askModels.${engine}`);
  }
  return out;
}
/** setAskModels' merge, pure, over an ALREADY asserted patch (setup apply canonicalises ids in between). undefined = delete. */
export function nextAskModels(current, patch) {
  const all = isObj(current) ? { ...current } : {};
  for (const [engine, pair] of Object.entries(patch)) { if (pair === null) delete all[engine]; else all[engine] = pair; }
  return Object.keys(all).length ? all : undefined;
}
export async function setAskModels(input) {
  const patch = assertAskModelsInput(input);
  const settings = readSettings();
  const v = nextAskModels(settings.askModels, patch);
  if (v === undefined) delete settings.askModels; else settings.askModels = v;
  await persistSettings(settings);
  return { askModels: askModelsSetting() };
}
/** Design's agents: the lead (the main agent) and the builders (one per section). */
export const DESIGN_AGENT_ROLES = Object.freeze(['lead', 'builder']);
/** The Models page's Design picks, { <engine>: { lead?: {model, effort?}, builder?: {model, effort?} } } (user-only). A
 *  design's own pick wins over these; an unset one falls back to the Deep thinking (lead) or Everyday tasks (builder) role. */
export function designModelsSetting() {
  if (homeGuarded()) return {};
  const value = readSettings().designModels;
  return isObj(value) ? value : {};
}
/** One Design pick: { model, effort? } with a model, or null to clear. `engine` checks the effort. */
export function normalizeDesignPick(engine, input, label = 'model') {
  const pair = normalizeModelPair(engine, input, label);
  if (pair && !pair.model) throw new Error(`${label}.model is required: pick a model, or clear the pick`);
  return pair;
}
export function assertDesignModelsInput(input) {
  if (!isObj(input)) throw new Error('designModels must be { <engine>: { lead|builder: { model, effort } | null } }');
  const out = {};
  for (const [engine, roles] of Object.entries(input)) {
    if (!MODEL_ENGINES.includes(engine)) throw new Error(`designModels: unknown engine "${engine}"`);
    if (!isObj(roles)) throw new Error(`designModels.${engine} must be an object of lead|builder → { model, effort } | null`);
    out[engine] = {};
    for (const [role, value] of Object.entries(roles)) {
      if (!DESIGN_AGENT_ROLES.includes(role)) throw new Error(`designModels.${engine}: unknown agent "${role}" (one of ${DESIGN_AGENT_ROLES.join(', ')})`);
      out[engine][role] = normalizeDesignPick(engine, value, `designModels.${engine}.${role}`);
    }
  }
  return out;
}
/** setDesignModels' merge, pure, over an ALREADY asserted patch. undefined = delete. */
export function nextDesignModels(current, patch) {
  const all = isObj(current) ? { ...current } : {};
  for (const [engine, roles] of Object.entries(patch)) {
    const cur = isObj(all[engine]) ? { ...all[engine] } : {};
    for (const [role, pair] of Object.entries(roles)) { if (pair === null) delete cur[role]; else cur[role] = pair; }
    if (Object.keys(cur).length) all[engine] = cur; else delete all[engine];
  }
  return Object.keys(all).length ? all : undefined;
}
/** Merge a Design pick patch (null clears a pick) and write it. Returns what it wrote, so the answer holds under homeGuarded. */
export async function setDesignModels(input) {
  const patch = assertDesignModelsInput(input); const settings = readSettings();
  const v = nextDesignModels(settings.designModels, patch);
  if (v === undefined) delete settings.designModels; else settings.designModels = v;
  await persistSettings(settings); return { designModels: v ?? {} };
}
export function assertRunEngineInput(input) {
  if (input === null || input === undefined || input === '') return null;
  if (!RUN_ENGINES.includes(input)) throw new Error(`runEngine must be one of ${RUN_ENGINES.join(' | ')}`);
  return input;
}
/** setRunEngineSetting's value, pure: undefined = delete. */
export function nextRunEngine(input) { const v = assertRunEngineInput(input); return v === null ? undefined : v; }
export async function setRunEngineSetting(input) {
  const value = nextRunEngine(input);
  const settings = readSettings();
  if (value === undefined) delete settings.runEngine; else settings.runEngine = value;
  await persistSettings(settings);
  return { runEngine: runEngineSetting() ?? null };
}

// ── Execution environment (plans/e2b-execution-design.md §12) ────────────────
// `execEnv` is the user default of the `run.execEnv` cascade (local | a registered backend); the two integers
// size the e2b mode: sandboxes at once (the capacity queue) and the wait for an answer.
export function execEnvSetting() {
  if (homeGuarded()) return undefined;
  const value = readSettings().execEnv;
  return value === null ? undefined : value;
}
export function assertExecEnvInput(input) {
  if (isClearInput(input)) return null;
  if (!isExecEnvName(input)) throw new Error(`execEnv must be one of ${execEnvNames().join(' | ')}`);
  return input;
}
export async function setExecEnvSetting(input) {
  const value = assertExecEnvInput(input);
  const settings = readSettings();
  if (value === null) delete settings.execEnv; else settings.execEnv = value;
  await persistSettings(settings);
  return { execEnv: execEnvSetting() ?? null };
}

const E2B_INTS = {
  e2bMaxSandboxes: { valid: (v) => Number.isSafeInteger(v) && v >= 1 && v <= 64, range: '1–64', def: DEFAULT_E2B_MAX_SANDBOXES },
  e2bMaxWaitMin: { valid: (v) => Number.isSafeInteger(v) && v >= 5 && v <= 1440, range: '5–1440', def: DEFAULT_E2B_MAX_WAIT_MIN },
  // The Local sandbox (Docker) backend's limitSettings (docs/local-sandbox.md): settings.json only.
  dockerMaxSandboxes: { valid: (v) => Number.isSafeInteger(v) && v >= 1 && v <= 64, range: '1–64', def: DEFAULT_DOCKER_MAX_SANDBOXES },
  dockerMaxWaitMin: { valid: (v) => Number.isSafeInteger(v) && v >= 5 && v <= 1440, range: '5–1440', def: DEFAULT_DOCKER_MAX_WAIT_MIN },
};
/** The stored value or null (GET: an unset field stays empty and shows the default as its placeholder). */
export function e2bIntSettingRaw(key) {
  if (homeGuarded()) return null;
  const v = readSettings()[key];
  return E2B_INTS[key].valid(v) ? v : null;
}
/** The effective value (runtime). An invalid stored value warns and falls back to the default. */
function e2bInt(key) {
  const { valid, def } = E2B_INTS[key];
  if (homeGuarded()) return def;
  const v = readSettings()[key];
  if (v === undefined || v === null) return def;
  if (!valid(v)) { console.warn(`[worca] settings: ignoring invalid ${key} ${JSON.stringify(v)}; using ${def}`); return def; }
  return v;
}
export const e2bMaxSandboxes = () => e2bInt('e2bMaxSandboxes');
export const e2bMaxWaitMin = () => e2bInt('e2bMaxWaitMin');
/** A backend's integer limit by its settings key (exec-env backend `limitSettings`); undefined for a
 *  key this build has no setting for, so the backend's own capability default applies. */
export function execEnvLimitSetting(key) { return Object.hasOwn(E2B_INTS, key) ? e2bInt(key) : undefined; }
/** maxConcurrent | maxWaitMin of an exec-env backend: its user setting, else its capability default. */
export function execEnvLimit(backend, which) {
  const key = backend.limitSettings?.[which];
  const v = key ? execEnvLimitSetting(key) : undefined;
  return v ?? (which === 'maxConcurrent' ? backend.capabilities.defaultMaxConcurrent : backend.capabilities.defaultMaxWaitMin);
}
export function assertE2bIntInput(key, input) {
  if (isClearInput(input)) return null;
  if (!E2B_INTS[key].valid(input)) throw new Error(`${key} must be a whole number in ${E2B_INTS[key].range}`);
  return input;
}
export async function setE2bIntSetting(key, input) {
  const value = assertE2bIntInput(key, input);
  const settings = readSettings();
  if (value === null) delete settings[key]; else settings[key] = value;
  await persistSettings(settings);
  return { [key]: e2bIntSettingRaw(key) };
}
// The Local sandbox (Docker) container's limits (docs/local-sandbox.md): { memory, cpus, pids, runtime }, each optional.
// sandboxResources (backends/docker.mjs) is the one check; here an invalid field is refused instead of falling back.
const DOCKER_SANDBOX_KEYS = ['memory', 'cpus', 'pids', 'runtime'];
const DOCKER_SANDBOX_LABELS = { memory: 'Memory per sandbox', cpus: 'CPUs per sandbox', pids: 'Processes per sandbox', runtime: 'Container runtime' };
/** The stored dockerSandbox (only the fields set), or null. */
export function dockerSandboxSettingRaw() {
  if (homeGuarded()) return null;
  const v = readSettings().dockerSandbox;
  if (!isObj(v)) return null;
  const out = Object.fromEntries(DOCKER_SANDBOX_KEYS.filter((k) => v[k] !== undefined && v[k] !== null && v[k] !== '').map((k) => [k, v[k]]));
  return Object.keys(out).length ? out : null;
}
export function assertDockerSandboxInput(input) {
  if (isClearInput(input)) return null;
  if (!isObj(input)) throw new Error('dockerSandbox must be { memory, cpus, pids, runtime }');
  const unknown = Object.keys(input).filter((k) => !DOCKER_SANDBOX_KEYS.includes(k));
  if (unknown.length) throw new Error(`dockerSandbox: unknown field ${unknown[0]} (known: ${DOCKER_SANDBOX_KEYS.join(', ')})`);
  const out = Object.fromEntries(DOCKER_SANDBOX_KEYS.filter((k) => !isClearInput(input[k])).map((k) => [k, input[k]]));
  const { warnings } = sandboxResources(out);
  const m = warnings.length ? /dockerSandbox\.(\w+): (.*?); using/.exec(warnings[0]) : null;
  if (m) throw new Error(`${DOCKER_SANDBOX_LABELS[m[1]] || m[1]} ${m[2]}`);
  return Object.keys(out).length ? out : null;
}
export async function setDockerSandboxSetting(input) {
  const value = assertDockerSandboxInput(input);
  const settings = readSettings();
  if (value === null) delete settings.dockerSandbox; else settings.dockerSandbox = value;
  await persistSettings(settings);
  return { dockerSandbox: dockerSandboxSettingRaw() };
}
/** The execution environment's PATCH /api/config keys beside execEnv: the backends' limits and the Docker container's. */
export const EXEC_ENV_SETTING_KEYS = Object.freeze([...Object.keys(E2B_INTS), 'dockerSandbox']);
export function assertExecEnvSettingInput(key, input) {
  return key === 'dockerSandbox' ? assertDockerSandboxInput(input) : assertE2bIntInput(key, input);
}
export function setExecEnvSettingKey(key, input) {
  return key === 'dockerSandbox' ? setDockerSandboxSetting(input) : setE2bIntSetting(key, input);
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
/** modelRoles (D1, D5): { <engine>: { deep|everyday|quick: { model, effort? } } }. Empty under node:test (homeGuarded). */
export function modelRolesSetting() {
  if (homeGuarded()) return {};
  const value = readSettings().modelRoles;
  return isObj(value) ? value : {};
}
/** A role names a model; its effort is any reasoning level, mapped to the harness's nearest one when used (effortOn). */
export function normalizeRolePair(input, label = 'role') {
  if (input === null || input === undefined || input === '') return null;
  if (!isObj(input)) throw new Error(`${label} must be { model, effort } or null`);
  // "Let <tool> decide" (#1450): exactly { cliDecides: true }, distinct from an empty role.
  if (input.cliDecides === true) {
    if (Object.keys(input).length !== 1) throw new Error(`${label}: cliDecides takes no model or effort`);
    return { cliDecides: true };
  }
  for (const key of Object.keys(input)) if (key !== 'model' && key !== 'effort') throw new Error(`${label}: unknown field "${key}"`);
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  const effort = typeof input.effort === 'string' ? input.effort.trim() : '';
  if (!model) throw new Error(`${label}.model is required: a role names the model its jobs use`);
  if (model.length > MODEL_PAIR_MAX_LEN) throw new Error(`${label}.model is too long`);
  if (effort && !REASONING_EFFORT_LEVELS.includes(effort)) throw new Error(`${label}.effort must be one of ${REASONING_EFFORT_LEVELS.join(' | ')}`);
  return { model, ...(effort ? { effort } : {}) };
}
export function assertModelRolesInput(input) {
  if (!isObj(input)) throw new Error('modelRoles must be { <engine>: { deep|everyday|quick: { model, effort } | null } }');
  const out = {};
  for (const [engine, roles] of Object.entries(input)) {
    if (!MODEL_ENGINES.includes(engine)) throw new Error(`modelRoles: unknown engine "${engine}"`);
    if (!isObj(roles)) throw new Error(`modelRoles.${engine} must be an object of role → { model, effort } | null`);
    out[engine] = {};
    for (const [role, value] of Object.entries(roles)) {
      if (!MODEL_ROLES.includes(role)) throw new Error(`modelRoles.${engine}: unknown role "${role}" (one of ${MODEL_ROLES.join(', ')})`);
      out[engine][role] = normalizeRolePair(value, `modelRoles.${engine}.${role}`);
    }
  }
  return out;
}
/** setModelRoles' merge, pure, over an ALREADY asserted patch (the server canonicalises ids in between). undefined = delete. */
export function nextModelRoles(current, patch) {
  const all = isObj(current) ? { ...current } : {};
  for (const [engine, roles] of Object.entries(patch)) {
    const cur = isObj(all[engine]) ? { ...all[engine] } : {};
    for (const [role, pair] of Object.entries(roles)) { if (pair === null) delete cur[role]; else cur[role] = pair; }
    if (Object.keys(cur).length) all[engine] = cur; else delete all[engine];
  }
  return Object.keys(all).length ? all : undefined;
}
/** Merge a role patch (null clears a role) and write it. Returns what it wrote, so the answer holds under homeGuarded. */
export async function setModelRoles(input) {
  const patch = assertModelRolesInput(input); const settings = readSettings();
  const v = nextModelRoles(settings.modelRoles, patch);
  if (v === undefined) delete settings.modelRoles; else settings.modelRoles = v;
  await persistSettings(settings); return { modelRoles: v ?? {} };
}
export function assertUtilityModelsInput(input) {
  if (!isObj(input)) throw new Error('utilityModels must be { <engine>: { <job>: { model, effort } | null } }');
  const out = {};
  for (const [engine, jobs] of Object.entries(input)) {
    if (engine === 'claude') throw new Error("utilityModels.claude: Claude's helper models are the titleModel, autoWorkflowModel, prDescriptionModel and memoryDefrag settings");
    if (MODEL_ENGINES.includes(engine) && !HELPER_ENGINES.includes(engine)) throw new Error(`utilityModels.${engine}: ${engineLabel(engine)} runs no helper jobs — on a ${engineLabel(engine)} run they run on Claude (titleModel, autoWorkflowModel, prDescriptionModel)`);
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
  // "Let <tool> decide" (#1450): exactly { cliDecides: true }, distinct from an empty role.
  if (input.cliDecides === true) {
    if (Object.keys(input).length !== 1) throw new Error(`${label}: cliDecides takes no model or effort`);
    return { cliDecides: true };
  }
  for (const key of Object.keys(input)) if (key !== 'model' && key !== 'effort') throw new Error(`${label}: unknown field "${key}"`);
  const model = input.model == null ? '' : (typeof input.model === 'string' ? input.model.trim() : null);
  if (model === null || model.length > MODEL_PAIR_MAX_LEN) throw new Error(`${label}.model must be a model id`);
  const effort = input.effort == null ? '' : (typeof input.effort === 'string' ? input.effort.trim() : null);
  if (effort === null) throw new Error(`${label}.effort must be a string`);
  const efforts = effortsForEngine(engine);
  if (effort && !efforts.length) throw new Error(`${label}: ${engineLabel(engine)} takes no effort`);
  if (effort && !efforts.includes(effort)) throw new Error(`${label}.effort must be one of ${efforts.join(' | ')}`);
  if (!model && !effort) return null;
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}
export const SETTING_CHECKS = Object.freeze({
  usdCap: (value) => isUsdCap(value), byteCap: (value) => isByteCap(value),
  bool: (value) => typeof value === 'boolean',
  teamMemory: (value) => typeof value === 'boolean' || value === TEAM_MEMORY_ONLY,
  pct: (value) => isByteCap(value) && value <= 100,
  askMaxTurns: (value) => isAskMaxTurns(value), askMaxBudgetUsd: (value) => value === null || isAskMaxBudget(value),
  skillMount: (value) => SKILL_MOUNTS.includes(value), engine: (value) => MODEL_ENGINES.includes(value), runEngine: (value) => RUN_ENGINES.includes(value),
  stringArray: (value) => Array.isArray(value) && value.every((item) => typeof item === 'string'),
  toolMap: (value) => !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every((v) => v === 'used' || v === 'unused'),
  execEnv: (value) => isExecEnvName(value),
});
/** Check ids the project's readiness report skips (project layer only — no user inheritance). Unknown ids are kept. */
export function readinessIgnore(scope) {
  const value = projectOverride('readiness.ignore', scope);
  return Array.isArray(value) ? value : [];
}
/** The project's per-tool readiness choice: { engine: 'used'|'unused' }; a missing engine is Detect (project layer only). */
export function readinessTools(scope) {
  const value = projectOverride('readiness.tools', scope);
  return SETTING_CHECKS.toolMap(value) ? value : {};
}

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

// `hideBuiltinEngines` is the same switch for the other harnesses that ship built-ins
// (Models › Catalogue, CAT-8): `{ codex?: true, copilot?: true }`. Only `true` is stored and
// an empty object is removed. It has no team default (L7): `hideBuiltinModels` keeps Claude
// Code's meaning for setup, CLI, Ask and team policy.
const HIDE_BUILTIN_ENGINE_NAMES = Object.freeze(['codex', 'copilot']);
const hideEnginesMap = (on) => Object.fromEntries(HIDE_BUILTIN_ENGINE_NAMES.filter((e) => on.has(e)).map((e) => [e, true]));
/** The stored value as `{ <engine>: true }`, or null when it is not one. */
const storedHideEngines = (v) => (isObj(v) && Object.entries(v).every(([e, on]) => HIDE_BUILTIN_ENGINE_NAMES.includes(e) && on === true)
  ? hideEnginesMap(new Set(Object.keys(v))) : null);

/** Which harnesses besides Claude Code hide their built-ins: `{ codex?: true, copilot?: true }`, `{}` when none. */
export function hideBuiltinEngines() {
  const v = readSettings().hideBuiltinEngines;
  if (v === undefined) return {};
  const hidden = storedHideEngines(v);
  if (hidden) return hidden;
  console.warn(`[worca] invalid hideBuiltinEngines ${JSON.stringify(v)} — no harness hides its built-ins`);
  return {};
}

/**
 * @throws {Error} unless `input` is `{ codex?: boolean, copilot?: boolean }`. Every message starts with
 * `hideBuiltinEngines ` so a 400 names that field, never a path under it (settings-errors.mjs).
 */
export function assertHideBuiltinEnginesInput(input) {
  if (!isObj(input)) throw new Error('hideBuiltinEngines must be an object');
  for (const [engine, on] of Object.entries(input)) {
    if (!HIDE_BUILTIN_ENGINE_NAMES.includes(engine)) throw new Error(`hideBuiltinEngines must name only ${HIDE_BUILTIN_ENGINE_NAMES.join(' or ')}, not ${JSON.stringify(engine)}`);
    if (typeof on !== 'boolean') throw new Error(`hideBuiltinEngines must set ${engine} to true or false`);
  }
}

/** Merges per harness: `true` stores, `false` deletes; an invalid stored value is replaced. */
export async function setHideBuiltinEngines(input) {
  assertHideBuiltinEnginesInput(input);
  const settings = readSettings();
  const on = new Set(Object.keys(storedHideEngines(settings.hideBuiltinEngines) || {}));
  for (const [engine, hide] of Object.entries(input)) { if (hide) on.add(engine); else on.delete(engine); }
  if (on.size) settings.hideBuiltinEngines = hideEnginesMap(on); else delete settings.hideBuiltinEngines;
  await persistSettings(settings);
  return { hideBuiltinEngines: hideBuiltinEngines() };
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

// ── Screensaver (Settings › General › Appearance) ────────────────────────────
// One machine-wide preference: a switch (off by default) and the idle minutes
// before it starts. Only non-default fields are stored; a POST carries a partial
// object that is merged onto the stored values, so each control saves only its own field.
export const SCREENSAVER_IDLE_MINUTES = Object.freeze([5, 10, 15, 20, 25, 30]);
export const DEFAULT_SCREENSAVER = Object.freeze({ enabled: false, idleMinutes: 5 });

/** The resolved screensaver setting; a missing field is its default, an invalid one is its default (loudly). */
export function screensaverSettings(settings = readSettings()) {
  const v = settings.screensaver;
  const out = { ...DEFAULT_SCREENSAVER };
  if (v === undefined) return out;
  if (!isObj(v)) {
    console.warn(`[worca] invalid screensaver ${JSON.stringify(v)} — using the defaults`);
    return out;
  }
  if ('enabled' in v) {
    if (isBool(v.enabled)) out.enabled = v.enabled;
    else console.warn(`[worca] invalid screensaver.enabled ${JSON.stringify(v.enabled)} — using the default (${DEFAULT_SCREENSAVER.enabled})`);
  }
  if ('idleMinutes' in v) {
    if (SCREENSAVER_IDLE_MINUTES.includes(v.idleMinutes)) out.idleMinutes = v.idleMinutes;
    else console.warn(`[worca] invalid screensaver.idleMinutes ${JSON.stringify(v.idleMinutes)} — using the default (${DEFAULT_SCREENSAVER.idleMinutes})`);
  }
  return out;
}

/** @throws {Error} unless `input` is a clear or a partial { enabled?: boolean, idleMinutes?: 5|10|…|30 }. */
export function assertScreensaverInput(input) {
  if (isClearInput(input)) return;
  if (!isObj(input)) throw new Error('screensaver must be an object with enabled and the minutes');
  const unknown = Object.keys(input).find((k) => k !== 'enabled' && k !== 'idleMinutes');
  if (unknown !== undefined) throw new Error(`screensaver has an unknown field "${unknown}"`);
  if ('enabled' in input && !isBool(input.enabled)) throw new Error('screensaver.enabled must be true or false');
  if ('idleMinutes' in input && !SCREENSAVER_IDLE_MINUTES.includes(input.idleMinutes)) {
    throw new Error('screensaver.idleMinutes must be 5, 10, 15, 20, 25 or 30');
  }
}

export async function setScreensaver(input) {
  assertScreensaverInput(input);
  const settings = readSettings();
  if (isClearInput(input)) delete settings.screensaver;
  else {
    const next = { ...screensaverSettings(settings), ...input };
    const stored = {};
    for (const k of Object.keys(DEFAULT_SCREENSAVER)) if (next[k] !== DEFAULT_SCREENSAVER[k]) stored[k] = next[k];
    if (Object.keys(stored).length) settings.screensaver = stored;
    else delete settings.screensaver;
  }
  await persistSettings(settings);
  return { screensaver: screensaverSettings(settings) };
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

// ── Agent generation model (Workflows › Agents › + › Generate) ───────────────
// `agentGenModel`: the { model, effort } pair of the agent wizard's one claude call
// (agent-gen.mjs). User-level and Claude-only: agent generation always runs on Claude and has
// no project, so there is no project override and no other engine's slot. Unset = the CLI's
// default model. Read when Generate is clicked (server.mjs startAgentGen).
const warnedAgentGenModel = new Set();

/** The STORED pair: `{ model, effort }`, both null when unset. Sync and never throws: a bad hand
 *  edit warns once and reads as unset (a bad effort alone reads as the model's default effort).
 *  The memoryDefragModel node:test guard: settings.json lives under HOME, not WORCA_HOME. */
export function agentGenModel() {
  if (homeGuarded()) return { model: null, effort: null };
  const v = readSettings().agentGenModel;
  if (v === undefined || v === null) return { model: null, effort: null };
  const warnOnce = (what, tail) => {
    const id = JSON.stringify(what);
    if (warnedAgentGenModel.has(id)) return;
    warnedAgentGenModel.add(id);
    console.warn(`[worca] invalid agentGenModel ${id} — ${tail}`);
  };
  const m = isObj(v) ? v.model : undefined;
  if (typeof m !== 'string' || !m.trim() || m.length > DEFRAG_MODEL_MAX_LEN) {
    warnOnce(v, 'agent generation uses the CLI default');
    return { model: null, effort: null };
  }
  const effort = typeof v.effort === 'string' && EFFORTS.includes(v.effort) ? v.effort : null;
  if (v.effort !== undefined && v.effort !== null && effort === null) warnOnce(v, 'agent generation uses the model\'s default effort');
  return { model: m.trim(), effort };
}

/**
 * Validate a POST value exactly like assertMemoryDefragModelInput: `{ model, effort }`, or null /
 * '' / a blank model to clear. With `models` (the effective catalog) the model must name an entry —
 * it comes back in the catalog's casing — and the effort must be one that entry offers.
 * @returns {{model:string, effort:(string|null)}|null} the pair to store, null to clear
 * @throws {Error} on a malformed value, an effort without a model, an unknown model or an effort
 *   the model does not offer
 */
export function assertAgentGenModelInput(input, models = null) {
  return assertModelPairInput('agentGenModel', input, models);
}

export async function setAgentGenModel(input, { models = null } = {}) {
  const pair = assertAgentGenModelInput(input, models);
  const settings = readSettings();
  if (pair === null) delete settings.agentGenModel;
  else settings.agentGenModel = pair.effort ? pair : { model: pair.model };
  await persistSettings(settings);
  return { agentGenModel: agentGenModel() };
}

// ── Run naming model (Models › Jobs › Helper jobs › Run naming) ───
// `namingModel`: the { model, effort } pair of Smart run naming's one cheap call (naming.mjs suggestNames).
// User-level and Claude-only like agentGenModel: naming always runs on Claude (auxTextCall) and the New run
// form's suggestion is not a run, so there is no project override and no other engine's slot. Unset = the
// cheapest ready Claude model at its lowest effort (naming.mjs#resolveNamingModel).
const warnedNamingModel = new Set();

/** The STORED pair: `{ model, effort }`, both null when unset. Sync and never throws (agentGenModel's rules). */
export function namingModel() {
  if (homeGuarded()) return { model: null, effort: null };
  const v = readSettings().namingModel;
  if (v === undefined || v === null) return { model: null, effort: null };
  const warnOnce = (what, tail) => {
    const id = JSON.stringify(what);
    if (warnedNamingModel.has(id)) return;
    warnedNamingModel.add(id);
    console.warn(`[worca] invalid namingModel ${id} — ${tail}`);
  };
  const m = isObj(v) ? v.model : undefined;
  if (typeof m !== 'string' || !m.trim() || m.length > DEFRAG_MODEL_MAX_LEN) {
    warnOnce(v, 'run naming uses the cheapest ready Claude model');
    return { model: null, effort: null };
  }
  const effort = typeof v.effort === 'string' && EFFORTS.includes(v.effort) ? v.effort : null;
  if (v.effort !== undefined && v.effort !== null && effort === null) warnOnce(v, 'run naming uses the model\'s default effort');
  return { model: m.trim(), effort };
}

/** Validate a POST value exactly like assertAgentGenModelInput. */
export function assertNamingModelInput(input, models = null) {
  return assertModelPairInput('namingModel', input, models);
}

export async function setNamingModel(input, { models = null } = {}) {
  const pair = assertNamingModelInput(input, models);
  const settings = readSettings();
  if (pair === null) delete settings.namingModel;
  else settings.namingModel = pair.effort ? pair : { model: pair.model };
  await persistSettings(settings);
  return { namingModel: namingModel() };
}

// ── Command summaries model (Models › Jobs › Helper jobs › Command summaries) ───
// `commandSummaryModel`: the { model, effort } pair of the chat command summary call (ask/command-summary.mjs).
// User-level and Claude-only like namingModel. Unset = the cheapest ready Claude model at its lowest effort
// (naming.mjs#resolveNamingModel); none ready = no summary, the row keeps the raw command.
const warnedCommandSummaryModel = new Set();

/** The STORED pair: `{ model, effort }`, both null when unset. Sync and never throws (namingModel's rules). */
export function commandSummaryModel() {
  if (homeGuarded()) return { model: null, effort: null };
  const v = readSettings().commandSummaryModel;
  if (v === undefined || v === null) return { model: null, effort: null };
  const warnOnce = (what, tail) => {
    const id = JSON.stringify(what);
    if (warnedCommandSummaryModel.has(id)) return;
    warnedCommandSummaryModel.add(id);
    console.warn(`[worca] invalid commandSummaryModel ${id} — ${tail}`);
  };
  const m = isObj(v) ? v.model : undefined;
  if (typeof m !== 'string' || !m.trim() || m.length > DEFRAG_MODEL_MAX_LEN) {
    warnOnce(v, 'command summaries use the cheapest ready Claude model');
    return { model: null, effort: null };
  }
  const effort = typeof v.effort === 'string' && EFFORTS.includes(v.effort) ? v.effort : null;
  if (v.effort !== undefined && v.effort !== null && effort === null) warnOnce(v, 'command summaries use the model\'s default effort');
  return { model: m.trim(), effort };
}

export function assertCommandSummaryModelInput(input, models = null) {
  return assertModelPairInput('commandSummaryModel', input, models);
}

export async function setCommandSummaryModel(input, { models = null } = {}) {
  const pair = assertCommandSummaryModelInput(input, models);
  const settings = readSettings();
  if (pair === null) delete settings.commandSummaryModel;
  else settings.commandSummaryModel = pair.effort ? pair : { model: pair.model };
  await persistSettings(settings);
  return { commandSummaryModel: commandSummaryModel() };
}

// ── Guide model (Models › Jobs › Helper jobs › Guide, flag shaperSmallRuns) ───
// `guideModel`: the { model, effort } pair of the composer's quick check of a Shaper prompt (guide-model.mjs).
// User-level and Claude-only like commandSummaryModel. Unset = the cheapest ready Claude model at its lowest effort
// (naming.mjs#resolveNamingModel).
const warnedGuideModel = new Set();

/** The STORED pair: `{ model, effort }`, both null when unset. Sync and never throws (namingModel's rules). */
export function guideModel() {
  if (homeGuarded()) return { model: null, effort: null };
  const v = readSettings().guideModel;
  if (v === undefined || v === null) return { model: null, effort: null };
  const warnOnce = (what, tail) => {
    const id = JSON.stringify(what);
    if (warnedGuideModel.has(id)) return;
    warnedGuideModel.add(id);
    console.warn(`[worca] invalid guideModel ${id} — ${tail}`);
  };
  const m = isObj(v) ? v.model : undefined;
  if (typeof m !== 'string' || !m.trim() || m.length > DEFRAG_MODEL_MAX_LEN) {
    warnOnce(v, 'Guide uses the cheapest ready Claude model');
    return { model: null, effort: null };
  }
  const effort = typeof v.effort === 'string' && EFFORTS.includes(v.effort) ? v.effort : null;
  if (v.effort !== undefined && v.effort !== null && effort === null) warnOnce(v, 'Guide uses the model\'s default effort');
  return { model: m.trim(), effort };
}

export function assertGuideModelInput(input, models = null) {
  return assertModelPairInput('guideModel', input, models);
}

export async function setGuideModel(input, { models = null } = {}) {
  const pair = assertGuideModelInput(input, models);
  const settings = readSettings();
  if (pair === null) delete settings.guideModel;
  else settings.guideModel = pair.effort ? pair : { model: pair.model };
  await persistSettings(settings);
  return { guideModel: guideModel() };
}

// ── Second-opinion reviewer (Models › Jobs › Helper jobs › Second-opinion reviewer) ───
// `secondOpinionModel`: the { model, effort } pair of the one role a role review names as `secondOpinion` (Shaper's
// Product reviewer), so it judges on another model than its step. User-level only and no model role: mapped to a
// role it would land on its step's model again. Codex's is `utilityModels.codex.secondOpinion`. Unset = Worca's factory
// default (factory-models.mjs).

/** The STORED pair, or null when unset or invalid. Sync and never throws. */
export function secondOpinionModelSetting() {
  if (homeGuarded()) return null;
  const v = readSettings().secondOpinionModel;
  const m = isObj(v) ? v.model : undefined;
  if (typeof m !== 'string' || !m.trim() || m.length > DEFRAG_MODEL_MAX_LEN) return null;
  return { model: m.trim(), effort: typeof v.effort === 'string' && EFFORTS.includes(v.effort) ? v.effort : null };
}

/** Validate a POST value exactly like assertNamingModelInput. */
export function assertSecondOpinionModelInput(input, models = null) {
  return assertModelPairInput('secondOpinionModel', input, models);
}

export async function setSecondOpinionModel(input, { models = null } = {}) {
  const pair = assertSecondOpinionModelInput(input, models);
  const settings = readSettings();
  if (pair === null) delete settings.secondOpinionModel;
  else settings.secondOpinionModel = pair.effort ? pair : { model: pair.model };
  await persistSettings(settings);
  return { secondOpinionModel: secondOpinionModelSetting() };
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

// ── Keep awake (the account menu's switch) ──────────────────────────────────
// Holds off idle system sleep while runs have agents working (src/core/keep-awake.mjs). Default ON;
// only `false` is stored. It used to be the beta flag keepAwake: migrateKeepAwakeFlag moves it here.
export const DEFAULT_KEEP_AWAKE = true;

/** @throws {Error} unless `input` is a boolean. */
export function assertKeepAwakeInput(input) {
  if (!isBool(input)) throw new Error('keepAwake must be true or false');
}

/** True unless keepAwake is stored false. A leftover flags.keepAwake (a home the boot migration
 *  could not write) still counts while keepAwake is unset. */
export function keepAwakeEnabled(settings = readSettings()) {
  const s = settings && typeof settings === 'object' ? settings : {};
  if (isBool(s.keepAwake)) return s.keepAwake;
  return !(s.flags && s.flags.keepAwake === false);
}

export async function setKeepAwake(input) {
  assertKeepAwakeInput(input);
  const settings = readSettings();
  if (input === DEFAULT_KEEP_AWAKE) delete settings.keepAwake;
  else settings.keepAwake = input;
  await persistSettings(settings);
  return { keepAwake: keepAwakeEnabled() };
}

/** The graduated flag keepAwake becomes the keepAwake setting. Pure: {changed, settings}. */
export function migrateLegacyKeepAwakeFlag(settings) {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  const flags = s.flags && typeof s.flags === 'object' && !Array.isArray(s.flags) ? s.flags : null;
  if (!flags || !Object.prototype.hasOwnProperty.call(flags, 'keepAwake')) return { changed: false, settings: s };
  const { keepAwake: was, ...restFlags } = flags;
  const next = { ...s };
  if (Object.keys(restFlags).length) next.flags = restFlags; else delete next.flags;
  if (was === false && !isBool(next.keepAwake)) next.keepAwake = false;
  return { changed: true, settings: next };
}

/** Run once at server boot, before the first syncKeepAwake. @returns {Promise<boolean>} wrote */
export async function migrateKeepAwakeFlag() {
  const r = migrateLegacyKeepAwakeFlag(readSettings());
  if (!r.changed) return false;
  try { await persistSettings(r.settings); return true; } catch { return false; }   // keepAwakeEnabled still reads the flag
}

// ── Open chat links in the panel (issue 1064 §4) ──────────────────────────────
// File paths and web links in the chat's answers open in tabs of the tool panel. Default ON; only `false` is stored.
export const DEFAULT_CHAT_LINKS_IN_PANEL = true;
export function assertChatLinksInPanelInput(input) {
  if (!isBool(input)) throw new Error('chatLinksInPanel must be true or false');
}
export function chatLinksInPanel(settings = readSettings()) {
  const s = settings && typeof settings === 'object' ? settings : {};
  return isBool(s.chatLinksInPanel) ? s.chatLinksInPanel : DEFAULT_CHAT_LINKS_IN_PANEL;
}
export async function setChatLinksInPanel(input) {
  assertChatLinksInPanelInput(input);
  const settings = readSettings();
  if (input === DEFAULT_CHAT_LINKS_IN_PANEL) delete settings.chatLinksInPanel;
  else settings.chatLinksInPanel = input;
  await persistSettings(settings);
  return { chatLinksInPanel: chatLinksInPanel() };
}

// ── Resume after a usage limit (opt-in) ──────────────────────────────────────
export const DEFAULT_RESUME_AFTER_USAGE_LIMIT = false;

/** @throws {Error} unless `input` is a boolean (the route and the setter share this). */
export function assertResumeAfterUsageLimitInput(input) {
  if (!isBool(input)) throw new Error('resumeAfterUsageLimit must be true or false');
}

/** D6: schedule a usage-limit pause's resume for just after the reset, unattended. */
export function resumeAfterUsageLimit() {
  const v = readSettings().resumeAfterUsageLimit;
  if (v === undefined) return DEFAULT_RESUME_AFTER_USAGE_LIMIT;
  if (isBool(v)) return v;
  console.warn(`[worca] invalid resumeAfterUsageLimit ${JSON.stringify(v)} — using the default (${DEFAULT_RESUME_AFTER_USAGE_LIMIT})`);
  return DEFAULT_RESUME_AFTER_USAGE_LIMIT;
}

/** @throws {Error} unless `input` is a boolean. */
export async function setResumeAfterUsageLimit(input) {
  assertResumeAfterUsageLimitInput(input);
  const settings = readSettings();
  if (input === DEFAULT_RESUME_AFTER_USAGE_LIMIT) delete settings.resumeAfterUsageLimit;
  else settings.resumeAfterUsageLimit = input;
  await persistSettings(settings);
  return { resumeAfterUsageLimit: resumeAfterUsageLimit() };
}

// ── Draft the PR description automatically (opt-in) ──────────────────────────
export const DEFAULT_AUTO_GENERATE_PR_DESCRIPTION = false;

/** @throws {Error} unless `input` is a boolean (the route and the setter share this). */
export function assertAutoGeneratePrDescriptionInput(input) {
  if (!isBool(input)) throw new Error('autoGeneratePrDescription must be true or false');
}

/** The Create PR dialog runs its Generate with AI on open when this is on. */
export function autoGeneratePrDescription() {
  const v = readSettings().autoGeneratePrDescription;
  if (v === undefined) return DEFAULT_AUTO_GENERATE_PR_DESCRIPTION;
  if (isBool(v)) return v;
  console.warn(`[worca] invalid autoGeneratePrDescription ${JSON.stringify(v)} — using the default (${DEFAULT_AUTO_GENERATE_PR_DESCRIPTION})`);
  return DEFAULT_AUTO_GENERATE_PR_DESCRIPTION;
}

/** setAutoGeneratePrDescription's value, pure: the default is elided (undefined = delete). */
export function nextAutoGeneratePrDescription(input) {
  assertAutoGeneratePrDescriptionInput(input);
  return input === DEFAULT_AUTO_GENERATE_PR_DESCRIPTION ? undefined : input;
}

/** @throws {Error} unless `input` is a boolean. */
export async function setAutoGeneratePrDescription(input) {
  const v = nextAutoGeneratePrDescription(input);
  const settings = readSettings();
  if (v === undefined) delete settings.autoGeneratePrDescription;
  else settings.autoGeneratePrDescription = v;
  await persistSettings(settings);
  return { autoGeneratePrDescription: autoGeneratePrDescription() };
}

// ── Check for new Worca versions (issue #841) ────────────────────────────────
export const DEFAULT_UPDATE_CHECK = true;

/** @throws {Error} unless `input` is a boolean (the route and the setter share this). */
export function assertUpdateCheckInput(input) {
  if (!isBool(input)) throw new Error('updateCheck must be true or false');
}

/** Whether the About card may ask npm for the latest version. Read at use time. */
export function updateCheckEnabled() {
  const v = readSettings().updateCheck;
  if (v === undefined) return DEFAULT_UPDATE_CHECK;
  if (isBool(v)) return v;
  console.warn(`[worca] invalid updateCheck ${JSON.stringify(v)} — using the default (${DEFAULT_UPDATE_CHECK})`);
  return DEFAULT_UPDATE_CHECK;
}

/** @throws {Error} unless `input` is a boolean. */
export async function setUpdateCheck(input) {
  assertUpdateCheckInput(input);
  const settings = readSettings();
  if (input === DEFAULT_UPDATE_CHECK) delete settings.updateCheck;
  else settings.updateCheck = input;
  await persistSettings(settings);
  return { updateCheck: updateCheckEnabled() };
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
  const engine = MODEL_ENGINES.includes(raw.engine) ? raw.engine : 'claude';
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
  if (OWN_SIGNIN_ENGINES.includes(engine)) {
    for (const k of Object.keys(env)) { console.warn(`[worca] models entry ${JSON.stringify(id)}: dropping env key ${JSON.stringify(k)} — ${aModelOf(engine)} takes no routing env`); delete env[k]; }
    if (upstream) { console.warn(`[worca] models entry ${JSON.stringify(id)}: dropping upstream — ${ownSignInNote(engine)}`); upstream = undefined; }
  }
  if (engine === 'copilot') {
    for (const k of Object.keys(env)) { console.warn(`[worca] models entry ${JSON.stringify(id)}: dropping env key ${JSON.stringify(k)} — a copilot model takes no routing env`); delete env[k]; }
    if (upstream) { console.warn(`[worca] models entry ${JSON.stringify(id)}: dropping upstream — a copilot model runs through the Copilot CLI's own sign-in`); upstream = undefined; }
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
  // OpenCode Zen's free models (`opencode/…`) take no reasoning variant — OpenCode 2.3.1+ refuses a `#variant`
  // outright — so a Zen entry advertises no efforts (pickers offer none, and a pick's effort never spawns).
  const zen = engine === 'opencode' && OPENCODE_ZEN_RE.test(id);
  return {
    id,
    label,
    efforts: zen ? [] : (effortsForEngine(engine).length ? (efforts.length ? efforts : [...effortsForEngine(engine)]) : []),
    ...(engine !== 'claude' ? { engine } : {}),
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
  if (!allowed.length) throw new Error(`${engineLabel(engine)} takes no effort`);
  for (const e of input) {
    if (!allowed.includes(e)) throw new Error(`unknown effort ${JSON.stringify(e)} — must be one of ${allowed.join(' | ')}`);
  }
  return orderEfforts(input, engine);
}

function assertModelEngine(input) {
  if (isClearInput(input) || input === 'claude') return 'claude';
  if (MODEL_ENGINES.includes(input)) return input;
  throw new Error(`engine must be one of ${MODEL_ENGINES.join(' | ')}`);
}
/** A model of an own-sign-in engine (OWN_SIGNIN_ENGINES) takes no routing env and no upstream: the engine connects with its own sign-in. */
function assertOwnSignInFields(engine, env, upstream) {
  if (!OWN_SIGNIN_ENGINES.includes(engine)) return;
  if (Object.keys(env || {}).length) throw new Error(`${aModelOf(engine)} takes no env`);
  if (upstream) throw new Error(`${aModelOf(engine)} takes no upstream — ${ownSignInNote(engine)}`);
}
/** A Copilot model takes no routing env and no upstream: the Copilot CLI connects with its own sign-in. */
function assertCopilotFields(engine, env, upstream) {
  if (engine !== 'copilot') return;
  if (Object.keys(env || {}).length) throw new Error('a copilot model takes no env');
  if (upstream) throw new Error('a copilot model takes no upstream — the Copilot CLI connects with its own sign-in');
}
/** A Codex model takes no routing env, and only an OpenAI-compatible Responses endpoint as its upstream (codexUpstreamProblem). */
function assertCodexFields(engine, env, upstream) {
  if (engine !== 'codex') return;
  if (Object.keys(env || {}).length) throw new Error('a codex model takes no env');
  const why = codexUpstreamProblem(upstream);
  if (why) throw new Error(why);
}
/** How an entry sends the endpoint a model id other than its catalog id, in words, for a refusal. */
function handleHint(id, { upstream, env } = {}) {
  const suggestion = suggestModelHandle(id, upstream?.provider || (env && 'ANTHROPIC_BASE_URL' in env ? 'gw' : 'my'));
  const how = upstream ? `keep ${id} as its upstream model id` : `set ANTHROPIC_MODEL=${id} in its env`;
  return `give this entry its own id, such as "${suggestion}", and ${how}`;
}

function assertIdForEngine(id, engine, conn = {}) {
  if (engine === 'codex' && CLAUDE_MODEL_ID_RE.test(id)) throw new Error(`"${id}" is a Claude model id${conn.upstream ? ` — ${handleHint(id, conn)}` : ''}`);
  // A built-in id names a harness's own sign-in (ChatGPT for Codex's): an entry on another connection — a gateway, a
  // provider — that serves the same model takes an id of its own; the endpoint still gets the model's own id.
  if (engine === 'claude' && CODEX_PRICES[id.toLowerCase()]) throw new Error(`"${id}" is the id of Codex's built-in ${id} (ChatGPT sign-in) — ${handleHint(id, conn)}`);
  // A sign-in engine's own ids may look like Claude's (Cursor's sonnet-4.5): the catalog row decides the owner. Only a
  // built-in id is taken (a Claude built-in has a list price; settings.mjs cannot import config.mjs's PREDEFINED_MODELS).
  if ((OWN_SIGNIN_ENGINES.includes(engine) || engine === 'copilot') && (CODEX_PRICES[id.toLowerCase()] || listPriceFor(id))) throw new Error(`"${id}" is a built-in model id${engine === 'copilot' ? ` — Copilot's own models are copilot/<id>, such as "copilot/${id}"` : ''}`);
  // copilot/<id> names a Copilot built-in (model-env.mjs COPILOT_MODEL_PREFIX): only a Copilot row may take one.
  if (engine !== 'copilot' && id.toLowerCase().startsWith('copilot/')) throw new Error(`"${id}" names a Copilot model — a copilot/ id is for the Copilot engine`);
  const why = modelIdProblem(engine, id);   // a Goose or OpenCode id is provider/model, so it never collides with a built-in
  if (why) throw new Error(why);
}

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
export function assertTestSettingsAccess() {
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
    ...(engine !== 'claude' ? { engine } : {}),
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
 * without persisting (Ask Worca's model card validates with it). `copied` (the server's copy path only) names the
 * values filled from the copied model, `{ env: [KEY…], apiKey: boolean }`: their vault references may be sealed into
 * new entries of this model.
 * @returns {Promise<{id:string,label:string,efforts:string[],env?:object,cost?:object}>} the effective entry
 * @throws {Error} on invalid input or a case-insensitively duplicate id
 */
export async function addGlobalModel({ id, label, efforts, env, cost, upstream, engine } = {}, { dryRun = false, copied } = {}) {
  assertTestSettingsAccess();
  const vid = assertModelId(id);
  if (!isClearInput(label) && typeof label !== 'string') throw new Error('label must be a string');
  const vengine = assertModelEngine(engine); assertIdForEngine(vid, vengine, { upstream, env });
  const vefforts = assertEfforts(efforts, vengine);
  const venv = assertEnvPairs(env);
  const vcost = assertModelCost(cost);
  const vupstream = assertModelUpstream(upstream);
  assertCodexFields(vengine, venv, vupstream);
  assertOwnSignInFields(vengine, venv, vupstream);
  assertCopilotFields(vengine, venv, vupstream);
  assertUpstreamEnvCompatible(venv, vupstream);
  const duplicate = (models) => { if (findModelIndex(models, vid) !== -1) throw new Error(`a model with id ${JSON.stringify(vid)} already exists`); };
  let sealed = { env: venv, upstream: vupstream };
  let recheck = NO_RECHECK;
  if (!dryRun) {
    const copiedEnv = new Set(copied?.env ?? []);
    ({ patch: sealed, recheck } = await sealPatch(sealed, (path) => modelLeaf(path, undefined, {
      env: (k) => copiedEnv.has(k), apiKey: !!copied?.apiKey,
    }), { before: () => duplicate(rawModels(readSettings())) }));
  }
  const settings = readSettings();
  recheck(settings);
  const models = rawModels(settings);
  duplicate(models);
  const vlabel = (typeof label === 'string' && label.trim()) || vid;
  if (dryRun) return sanitizeGlobalModel(storedModelShape(vid, vlabel, vefforts, venv, vcost, vupstream, vengine));
  settings.models = [...models, storedModelShape(vid, vlabel, vefforts, sealed.env, vcost, sealed.upstream, vengine)];
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
export async function updateGlobalModel(id, input = {}, { dryRun = false } = {}) {
  if (dryRun) return applyGlobalModelUpdate(id, input, { dryRun });
  assertTestSettingsAccess();
  const vid = assertModelId(id);
  const models = rawModels(readSettings());
  const stored = models[findModelIndex(models, vid)];
  const { patch, recheck } = await sealPatch({ env: input?.env, upstream: input?.upstream }, (path) => modelLeaf(path, stored), {
    before: () => applyGlobalModelUpdate(id, input, { dryRun: true }),   // a refused patch vaults nothing
  });
  return applyGlobalModelUpdate(id, { ...input, env: patch.env, upstream: patch.upstream }, { recheck });
}

/** updateGlobalModel's validation, merge and write: synchronous from its readSettings() to its persistSettings(). */
async function applyGlobalModelUpdate(id, { label, efforts, env, cost, upstream, engine } = {}, { dryRun = false, recheck = NO_RECHECK } = {}) {
  assertTestSettingsAccess();
  const vid = assertModelId(id);
  const settings = readSettings();
  recheck(settings);
  const models = rawModels(settings);
  const idx = findModelIndex(models, vid);
  if (idx === -1) throw new Error(`unknown model id ${JSON.stringify(vid)}`);
  const current = sanitizeGlobalModel(models[idx]);
  const curEngine = MODEL_ENGINES.includes(current.engine) ? current.engine : 'claude';
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
  assertOwnSignInFields(curEngine, nextEnv, nextUpstream);
  assertCopilotFields(curEngine, nextEnv, nextUpstream);

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
//     copilot:   { githubToken?, accountType?, enterpriseHost?, maxConcurrent?, login? },   // enterpriseHost: only with accountType 'ghe-com' (a GHE.com tenant, like acme.ghe.com)
//     openai:    { baseUrl?, apiKey?, maxConcurrent? },
//     anthropic: { baseUrl?, apiKey?, maxConcurrent? },
//     speech:    { stt: {...}, tts: {...} },   // voice mode, NOT an upstream — see the Speech block below
//     images:    { service?, baseUrl?, model?, apiKey?, price? },   // Design pictures, NOT an upstream — see the Images block below
//     sound:     { apiKey? },   // Design sound (ElevenLabs)
//     openrouter: { apiKey?, maxConcurrent?, order?, sort?, allowFallbacks? },   // OpenRouter's row, NOT an upstream — see the OpenRouter block below
//   }
//   (An older Worca also stored copilot.acknowledgedTerms / termsVersion; readers ignore them.)
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
    if (r.enterpriseHost !== undefined) {
      const h = normalizeGheHost(r.enterpriseHost);
      if (out.accountType !== GHE_COM_ACCOUNT_TYPE) warn('enterpriseHost', `ignored unless accountType is ${GHE_COM_ACCOUNT_TYPE}`);
      else if (h) out.enterpriseHost = h;
      else warn('enterpriseHost', 'must be a GHE.com host like acme.ghe.com');   // the ghe-com block stays; every network path then refuses (NO_HOST)
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
 * (unset → ''), a Worca vault reference is resolved as settings field `field`
 * (settings-resolver.mjs; '' when it does not resolve, and always '' for a
 * `field` of null: a value the user just typed), a literal is returned as is.
 * Every caller passes all three arguments (test/secrets-settings-resolver.test.mjs).
 */
export function resolveProviderSecret(value, sourceEnv = process.env, field = null) {
  if (typeof value !== 'string' || !value) return '';
  if (isVaultRef(value)) return field ? resolveSettingsSecretSync(value, field) : '';
  const ref = modelEnvRef(value);
  if (ref === null) return value;
  const v = sourceEnv ? sourceEnv[ref] : undefined;
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * A stored secret as the API shows it: `••••••` plus the last 4 characters of its value (maskModelEnvValue). A vault
 * reference shows its resolved value's mask, or `••••••` alone when it does not resolve; never any part of the
 * reference.
 */
export function maskStoredSecret(value, field) {
  if (!isVaultRef(value)) return maskModelEnvValue(value);
  const resolved = resolveSettingsSecretSync(value, field);
  return resolved ? maskModelEnvValue(resolved) : '••••••';
}

const NO_RECHECK = () => {};

/**
 * Seal a setter's string leaves before its sync read-modify-write (src/core/secrets/settings-vault.mjs
 * sealSettingsSecrets). With the secretVault flag off (or nothing to seal) the values come back unchanged and the
 * settings vault is never imported. `before()` runs only with the flag on, before anything is vaulted (a setter's
 * own validation that needs a fresh read). `recheck(settings)` runs inside the setter's sync section: after a plain
 * fallback it refuses the write when a vault or a reference appeared meanwhile.
 * @returns {Promise<{ values: any[], recheck: (settings: object) => void }>}
 */
export async function sealSecrets(items, { before } = {}) {
  const values = items.map((it) => it.value);
  if (!items.length) return { values, recheck: NO_RECHECK };
  const { secretVaultEnabled } = await import('./secrets/flag.mjs');
  if (!secretVaultEnabled()) return { values, recheck: NO_RECHECK };
  if (before) await before();
  const m = await import('./secrets/settings-vault.mjs');
  const r = await m.sealSettingsSecrets(items);
  return { values: r.values, recheck: r.plainFallback ? (settings) => m.assertNothingVaulted(settings, r.reason) : NO_RECHECK };
}

/**
 * Prime the settings vault (settings-vault.mjs) while the vault is in use (flag on, or a vault file a migration left);
 * null otherwise (nothing imported).
 * `settle: true` bounds the wait (settleSettingsVaultPrime): the store time limit plus 250 ms, then `locked`. A ready
 * prime then settles the vault's dropped entries once per home (store-vault.mjs settleDroppedOnPrime).
 */
export async function primeSettingsVaultIfEnabled({ settle = false, ...rest } = {}) {
  const { vaultInUse } = await import('./secrets/flag.mjs');
  if (!vaultInUse({ home: rest.home })) return null;
  const m = await import('./secrets/settings-vault.mjs');
  const r = await (settle ? m.settleSettingsVaultPrime(rest) : m.primeSettingsVault(rest));
  // Once per home: remove the dropped entries past their grace that no owner file holds (an owner deleted for good).
  if (r?.state === 'ready') await (await import('./secrets/store-vault.mjs')).settleDroppedOnPrime(rest);
  return r;
}

const valueAt = (o, path) => path.reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);

/**
 * The file-stored secrets a settings object holds, for the one-time move into the vault (secrets/migrate.mjs):
 * settingsSecretSlots holding a non-empty string that is neither a vault reference nor a whole-value `${VAR}`, and for
 * a model env slot only a secret key (modelEnvField; a readable key such as ANTHROPIC_MODEL is not a secret). The value
 * is kept exactly as stored (never trimmed). Pure.
 * @returns {{ path: (string|number)[], field: string, value: string, modelId?: any }[]}
 */
export function settingsSecretLiterals(settings) {
  const out = [];
  for (const slot of settingsSecretSlots(settings)) {
    const v = slot.value;
    if (typeof v !== 'string' || !v || isVaultRef(v) || modelEnvRef(v) !== null) continue;
    if (slot.path[2] === 'env' && modelEnvField(slot.path[3]) === null) continue;
    out.push({ path: slot.path, field: slot.field, value: v, ...(slot.path[0] === 'models' ? { modelId: slot.modelId } : {}) });
  }
  return out;
}

/**
 * Swap moved literals for their references in ONE synchronous re-read, compare and write. `swaps` =
 * `[{ path, value, ref, modelId? }]`; a slot is swapped only while its raw value is still `value` (and, for a model
 * slot, the model at that index still has `modelId`). `beforeWrite()` runs right before the write, only when one slot
 * matched. The write is persistSettings, whose file write happens before this returns; `write` is its promise (no
 * reference is dropped, so it releases nothing). Nothing matched: nothing is written. A file changed since the read is
 * left as it is (D20): `{ adopted: [] }` with a resolved `write`.
 * @returns {{ adopted: object[], write: Promise<void> }}
 */
export function swapSettingsSecretLiterals(swaps, { beforeWrite = () => {} } = {}) {
  const raw = settingsRawText();
  const settings = readSettings();
  const adopted = [];
  for (const sw of swaps) {
    const parent = valueAt(settings, sw.path.slice(0, -1));
    const key = sw.path[sw.path.length - 1];
    if (!parent || typeof parent !== 'object' || parent[key] !== sw.value) continue;
    if (sw.path[0] === 'models' && valueAt(settings, ['models', sw.path[1], 'id']) !== sw.modelId) continue;
    parent[key] = sw.ref;
    adopted.push(sw);
  }
  if (!adopted.length) return { adopted, write: Promise.resolve() };
  beforeWrite();
  const w = writeUnlessStale(settings, raw, { release: true });
  return w.stale ? { adopted: [], write: w.write } : { adopted, write: w.write };
}

const STALE_SETTINGS = Symbol('stale settings');

// settings.json's raw text, or null when it cannot be read.
function settingsRawText() {
  try { return readFileSync(settingsFile(), 'utf8'); } catch { return null; }
}

// persistSettings with a rename-time check (D20): the file is re-read right before the rename and the write is dropped
// when its text is no longer `raw` (another writer landed since the read). `stale` is known synchronously: the write
// happens in persistSettings' sync section. A stale write resolves; it never rejects.
function writeUnlessStale(settings, raw, { release }) {
  let stale = false;
  const beforeRename = () => { if (settingsRawText() !== raw) { stale = true; throw STALE_SETTINGS; } };
  const write = persistSettings(settings, { beforeRename, release }).catch((err) => { if (err !== STALE_SETTINGS) throw err; });
  return { stale, write };
}

/**
 * Export's restore (secrets/export.mjs): put literals back where references are, in ONE synchronous re-read and write.
 * `swaps` = `[{ path, ref, value, modelId? }]`; a slot is restored only while its raw value is still `ref` (and, for a
 * model slot, the model at that index still has `modelId`). `beforeWrite()` runs right before the write, only when one
 * slot matched. The write is atomic at 0600, releases nothing, and is dropped when the file changed since the read
 * (D20). Nothing matched, or stale: `{ restored: 0 }`.
 * @returns {Promise<{ restored: number }>}
 */
export async function restoreSettingsSecretRefs(swaps, { beforeWrite = () => {} } = {}) {
  const raw = settingsRawText();
  const settings = readSettings();
  let restored = 0;
  for (const sw of swaps) {
    const parent = valueAt(settings, sw.path.slice(0, -1));
    const key = sw.path[sw.path.length - 1];
    if (!parent || typeof parent !== 'object' || parent[key] !== sw.ref) continue;
    if (sw.path[0] === 'models' && valueAt(settings, ['models', sw.path[1], 'id']) !== sw.modelId) continue;
    parent[key] = sw.value;
    restored++;
  }
  if (!restored) return { restored: 0 };
  beforeWrite();
  const w = writeUnlessStale(settings, raw, { release: false });
  await w.write;
  return { restored: w.stale ? 0 : restored };
}

/**
 * Seal every string leaf of `patch`. `describe(path)` → `{ field, current, allowRef }`: `field` the owner field when
 * the leaf is a vaulted secret (else null), `current` the leaf's stored value. Returns the patch with the sealed values
 * (a copy when one changed) and the recheck.
 */
async function sealPatch(patch, describe, opts) {
  const items = [];
  const slots = [];
  const walk = (v, path) => {
    if (typeof v === 'string') {
      const d = describe(path);
      items.push({ value: v, current: d.current, field: d.field ?? null, vaulted: !!d.field, allowRef: !!d.allowRef });
      slots.push(path);
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
    }
  };
  walk(patch, []);
  const { values, recheck } = await sealSecrets(items, opts);
  if (values.every((v, i) => v === items[i].value)) return { patch, recheck };
  const out = structuredClone(patch);
  values.forEach((v, i) => {
    const path = slots[i];
    valueAt(out, path.slice(0, -1))[path[path.length - 1]] = v;
  });
  return { patch: out, recheck };
}

/**
 * sealPatch's description of a model patch leaf (`env.KEY`, `upstream.apiKey`, any other upstream string): its owner
 * field when it is a vaulted secret, its value in `stored` (the model entry as stored), and the copy marker.
 */
function modelLeaf(path, stored, copied = {}) {
  const current = valueAt(stored, path);
  if (path[0] === 'env' && path.length === 2) return { field: modelEnvField(path[1]), current, allowRef: !!copied.env?.(path[1]) };
  if (path[0] === 'upstream' && path[1] === 'apiKey' && path.length === 2) {
    return { field: settingsSecretField('models', 'upstream', 'apiKey'), current, allowRef: !!copied.apiKey };
  }
  return { field: null, current };
}

/** sealPatch for a flat providers block whose only secret is `apiKey` (images, sound, openrouter). */
function sealProviderBlock(name, patch) {
  const block = valueAt(readSettings(), ['providers', name]);
  return sealPatch(patch, ([k]) => ({
    field: k === 'apiKey' ? settingsSecretField('providers', name, k) : null, current: valueAt(block, [k]),
  }));
}

/** The owner field of a model env key: a secret key (not isReadableModelEnvKey) with a valid name; else null. */
function modelEnvField(key) {
  if (isReadableModelEnvKey(key)) return null;
  try { return settingsSecretField('models', 'env', key); } catch { return null; }
}

/** updateProvider's validation alone (it throws the same messages). */
export function assertProviderPatch(name, patch) {
  if (!UPSTREAM_PROVIDERS.includes(name)) throw new Error(`unknown provider ${JSON.stringify(name)}`);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('provider patch must be an object');
  const allowed = new Set([...PROVIDER_SECRET_KEYS[name], 'maxConcurrent',
    ...(name === 'copilot' ? ['accountType', 'enterpriseHost', 'login'] : ['baseUrl'])]);
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.has(k)) throw new Error(`unknown provider field ${JSON.stringify(k)} for ${name}`);
    if (isClearInput(v)) continue;
    if (PROVIDER_SECRET_KEYS[name].includes(k) || k === 'login') {
      if (typeof v !== 'string' || !v.trim()) throw new Error(`${k} must be a non-empty string`);
    } else if (k === 'accountType') {
      if (!COPILOT_ACCOUNT_TYPES.includes(v)) throw new Error(`accountType must be one of ${COPILOT_ACCOUNT_TYPES.join(' | ')}`);
    } else if (k === 'enterpriseHost') {
      if (!normalizeGheHost(v)) throw new Error('enterpriseHost must be a GHE.com host like acme.ghe.com, with no path, port or credentials');
    } else if (k === 'baseUrl') {
      if (!isUpstreamBaseUrl(v)) throw new Error('baseUrl must be an http(s) URL with no query or fragment');
    } else if (k === 'maxConcurrent') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > MAX_PROVIDER_CONCURRENCY) throw new Error(`maxConcurrent must be an integer from 1 to ${MAX_PROVIDER_CONCURRENCY}`);
    }
  }
}

/** One provider's stored block after `patch` (validated by the caller). */
function mergeProviderBlock(currentProviders, name, patch) {
  const cur = isObj(currentProviders) && isObj(currentProviders[name]) ? { ...currentProviders[name] } : {};
  const before = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (isClearInput(v)) delete cur[k];
    else if (k === 'maxConcurrent') cur[k] = Number(v);
    else if (k === 'baseUrl') cur[k] = v.trim().replace(/\/+$/, '');
    else if (k === 'enterpriseHost') cur[k] = normalizeGheHost(v);
    else cur[k] = typeof v === 'string' ? v.trim() : v;
  }
  if (name === 'copilot') reconcileCopilotBlock(before, cur, patch);
  return cur;
}

/**
 * The cross-field rules of the copilot block, applied to the merged `after` in place (it throws
 * before anything is written): a host belongs to accountType ghe-com and ghe-com needs one; a
 * block that changes GitHub host loses its sign-in in the same write (a token belongs to one
 * host). A patch touching neither accountType nor enterpriseHost never trips the "needs a host"
 * rule, so a hand-edited block without one can still be signed out.
 */
function reconcileCopilotBlock(before, after, patch) {
  const type = after.accountType ?? 'individual';
  const setsHost = Object.hasOwn(patch, 'enterpriseHost') && !isClearInput(patch.enterpriseHost);
  if (setsHost && type !== GHE_COM_ACCOUNT_TYPE) throw new Error(`enterpriseHost applies only to accountType ${GHE_COM_ACCOUNT_TYPE}`);
  if (type !== GHE_COM_ACCOUNT_TYPE) delete after.enterpriseHost;
  else if (!normalizeGheHost(after.enterpriseHost) && (Object.hasOwn(patch, 'accountType') || Object.hasOwn(patch, 'enterpriseHost'))) {
    throw new Error(`accountType ${GHE_COM_ACCOUNT_TYPE} needs enterpriseHost (your GHE.com tenant, like acme.ghe.com)`);
  }
  if (copilotBlockHost(before) !== copilotBlockHost(after) && !Object.hasOwn(patch, 'githubToken')) {
    delete after.githubToken;
    delete after.login;
  }
}

/** updateProvider's merge, pure: the whole next `providers` block (undefined = delete it). */
export function nextProviders(currentProviders, name, patch) {
  assertProviderPatch(name, patch);
  const all = isObj(currentProviders) ? { ...currentProviders } : {};
  const cur = mergeProviderBlock(currentProviders, name, patch);
  if (Object.keys(cur).length) all[name] = cur; else delete all[name];
  return Object.keys(all).length ? all : undefined;
}

/**
 * Patch a provider's stored block. Omitted keys are kept; null/'' deletes a
 * key. Validates the whole patch before writing. `dryRun` returns the
 * would-be effective config without persisting. `expectCopilotHost` (null =
 * github.com, else the tenant) refuses the write with code HOST_CHANGED when the
 * stored GitHub host differs.
 * @returns {Promise<object>} the effective config
 * @throws {Error}
 */
export async function updateProvider(name, patch = {}, { dryRun = false, expectCopilotHost } = {}) {
  if (!UPSTREAM_PROVIDERS.includes(name)) throw new Error(`unknown provider ${JSON.stringify(name)}`);
  assertTestSettingsAccess();
  assertProviderPatch(name, patch);
  const hostCheck = (settings) => {
    if (expectCopilotHost === undefined) return;
    // A device-flow sign-in commits its token here: refuse when the GitHub host moved since it began.
    const stored = isObj(settings.providers) && isObj(settings.providers.copilot) ? settings.providers.copilot : {};
    if (copilotBlockHost(stored) !== (expectCopilotHost || 'github.com')) throw Object.assign(new Error('the Copilot GitHub host changed during the sign-in — start it again'), { code: 'HOST_CHANGED' });
  };
  let recheck = NO_RECHECK;
  if (!dryRun) {
    const block = valueAt(readSettings(), ['providers', name]);
    ({ patch, recheck } = await sealPatch(patch, ([k]) => ({
      field: PROVIDER_SECRET_KEYS[name].includes(k) ? settingsSecretField('providers', name, k) : null, current: valueAt(block, [k]),
    }), { before: () => hostCheck(readSettings()) }));
  }
  const settings = readSettings();
  recheck(settings);
  hostCheck(settings);
  if (dryRun) return { ...providerDefaults(name), ...sanitizeProvider(name, mergeProviderBlock(settings.providers, name, patch)) };
  const v = nextProviders(settings.providers, name, patch);
  if (v === undefined) delete settings.providers; else settings.providers = v;
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
  // pause: pause after a finished sentence; unfinished sentences wait 2.5× (browser STT).
  stt: Object.freeze({ engine: 'browser', baseUrl: 'http://127.0.0.1:8080/v1', model: 'whisper-1', language: 'auto', pause: 0.7 }),
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
  const stored = valueAt(readSettings(), ['providers', 'speech']);
  let recheck;
  ({ patch, recheck } = await sealPatch(patch, ([kind, k]) => ({
    field: k === 'apiKey' ? settingsSecretField('providers', 'speech', kind, k) : null, current: valueAt(stored, [kind, k]),
  })));
  const settings = readSettings();
  recheck(settings);
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

// ── Images (Design pictures: the lead of a Design round can have a picture made) ──
//   providers: { …, images: { service?, baseUrl?, model?, apiKey?, price? } }
// service picks a preset of IMAGE_SERVICES (src/shared/image-services.mjs), which fills the
// address and the model under the stored block. The price has no default: a save must name
// one (0 for a free server). NOT a model-bridge upstream: it never joins UPSTREAM_PROVIDERS,
// PROVIDER_SECRET_KEYS, allProviders() or the catalog. The key is literal or a whole-value
// ${VAR}, resolved at use time by resolveProviderSecret, and only ever goes to the saved
// address's origin: a save that moves the address to another origin drops the stored key.
const IMAGES_FIELDS = Object.freeze(['service', 'baseUrl', 'model', 'apiKey', 'price']);
const IMAGES_PRICE_MISSING = 'Enter a price; 0 for a free server';
const IMAGES_QUIET = Object.freeze({ quiet: true });

/** Why `v` is not a valid value for images field `k`, or null when it is. */
function imagesFieldError(k, v) {
  if (k === 'service') return typeof v === 'string' && Object.hasOwn(IMAGE_SERVICES, v.trim().toLowerCase()) ? null : `unknown image service "${v}" (openai, xai, openrouter or other)`;
  if (k === 'baseUrl') return isUpstreamBaseUrl(v) ? null : 'baseUrl must be an http(s) URL with no query or fragment';
  if (k === 'apiKey') return typeof v === 'string' && v.trim() ? null : 'apiKey must be a non-empty string';
  if (k === 'price') {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    return Number.isFinite(n) && n >= 0 ? null : IMAGES_PRICE_MISSING;
  }
  return typeof v === 'string' && SPEECH_ID_RE.test(v.trim()) ? null : `${k} must be an id (letters, digits and . _ - : / @ +)`;
}

function normImagesField(k, v) {
  if (k === 'baseUrl') return v.trim().replace(/\/+$/, '');
  if (k === 'price') return Number(v);
  if (k === 'service') return v.trim().toLowerCase();
  return v.trim();
}

/** Stored images block → only the valid fields (never throws; like sanitizeSpeech). `quiet` skips the warnings. */
function sanitizeImages(raw, { quiet = false } = {}) {
  const r = isObj(raw) ? raw : {};
  const out = {};
  for (const k of IMAGES_FIELDS) {
    if (r[k] === undefined) continue;
    const why = imagesFieldError(k, r[k]);
    if (!why) out[k] = normImagesField(k, r[k]);
    else if (!quiet) console.warn(`[worca] providers.images.${k}: ${why} — ignored`);
  }
  return out;
}

/** A stored block → the effective config: the checked service's preset under the valid fields. */
function effectiveImages(block, opts) {
  const s = sanitizeImages(block, opts);
  const service = s.service || 'openai';
  const preset = IMAGE_SERVICES[service];
  return { service, baseUrl: preset.baseUrl, model: preset.model, apiKey: '', price: null, ...s };
}

/** Effective images config: the preset under the stored block. The key stays raw (literal or ${VAR}). */
export function imagesConfig() {
  if (process.env.NODE_TEST_CONTEXT && !process.env.WORCA_TEST_ALLOW_HOME_FALLBACK) return effectiveImages(undefined);
  const all = readSettings().providers;
  return effectiveImages(isObj(all) ? all.images : undefined);
}

/**
 * Patch { service?, baseUrl?, model?, apiKey?, price? }; '' / null clears a field. Validates the
 * whole patch before writing; a block left without a price is refused (D9), and a block
 * with nothing valid left is removed.
 * @returns {Promise<object>} the effective config
 * @throws {Error}
 */
export async function updateImages(patch = {}) {
  assertTestSettingsAccess();
  if (!isObj(patch)) throw new Error('images patch must be an object');
  for (const [k, v] of Object.entries(patch)) {
    if (!IMAGES_FIELDS.includes(k)) throw new Error(`unknown images field ${JSON.stringify(k)}`);
    if (isClearInput(v)) continue;
    const why = imagesFieldError(k, v);
    if (why) throw new Error(why);
  }
  let recheck;
  ({ patch, recheck } = await sealProviderBlock('images', patch));
  const settings = readSettings();
  recheck(settings);
  const all = isObj(settings.providers) ? settings.providers : {};
  const stored = isObj(all.images) ? all.images : {};
  const next = { ...stored };
  for (const [k, v] of Object.entries(patch)) {
    if (isClearInput(v)) delete next[k]; else next[k] = normImagesField(k, v);
  }
  // The origin rule: a stored key never follows the address to another origin.
  if (!Object.hasOwn(patch, 'apiKey')
    && originOf(effectiveImages(next, IMAGES_QUIET).baseUrl) !== originOf(effectiveImages(stored, IMAGES_QUIET).baseUrl)) delete next.apiKey;
  // The price rule (D9): what survives must name a price, else nothing is written.
  const kept = sanitizeImages(next, IMAGES_QUIET);
  if (Object.keys(kept).length && kept.price === undefined) throw new Error(IMAGES_PRICE_MISSING);
  if (Object.keys(kept).length) all.images = next; else delete all.images;
  if (Object.keys(all).length) settings.providers = all; else delete settings.providers;
  await persistSettings(settings);
  return imagesConfig();
}

// ── Sound (Design sound: a Design video's voice and music, made through ElevenLabs) ──
//   providers: { …, sound: { apiKey? } }
// NOT a model-bridge upstream: it never joins UPSTREAM_PROVIDERS, PROVIDER_SECRET_KEYS,
// allProviders() or the catalog. The key is literal or a whole-value ${VAR}, resolved at use
// time by resolveProviderSecret, and only ever goes to ElevenLabs.
const SOUND_FIELDS = Object.freeze(['apiKey']);
const SOUND_KEY_MAX = 512;
const SOUND_QUIET = Object.freeze({ quiet: true });

/** Why `v` is not a valid value for sound field `k`, or null when it is. */
function soundFieldError(k, v) {
  if (typeof v !== 'string' || !v.trim()) return `${k} must be a non-empty string`;
  return v.trim().length > SOUND_KEY_MAX ? `${k} must be at most ${SOUND_KEY_MAX} characters` : null;
}

/** Stored sound block → only the valid fields, trimmed (never throws; like sanitizeImages). `quiet` skips the warnings. */
function sanitizeSound(raw, { quiet = false } = {}) {
  const r = isObj(raw) ? raw : {};
  const out = {};
  for (const k of SOUND_FIELDS) {
    if (r[k] === undefined) continue;
    const why = soundFieldError(k, r[k]);
    if (!why) out[k] = r[k].trim();
    else if (!quiet) console.warn(`[worca] providers.sound.${k}: ${why} — ignored`);
  }
  return out;
}

/** Effective sound config: the default under the stored block. The key stays raw (literal or ${VAR}). */
export function soundConfig() {
  if (process.env.NODE_TEST_CONTEXT && !process.env.WORCA_TEST_ALLOW_HOME_FALLBACK) return { apiKey: '' };
  const all = readSettings().providers;
  return { apiKey: '', ...sanitizeSound(isObj(all) ? all.sound : undefined) };
}

/**
 * Patch { apiKey? }; '' / null clears it. Validates the whole patch before writing; a block
 * with nothing valid left is removed, and so is an empty providers.
 * @returns {Promise<{ apiKey: string }>} the effective config
 * @throws {Error}
 */
export async function updateSound(patch = {}) {
  assertTestSettingsAccess();
  if (!isObj(patch)) throw new Error('sound patch must be an object');
  for (const [k, v] of Object.entries(patch)) {
    if (!SOUND_FIELDS.includes(k)) throw new Error(`unknown sound field ${JSON.stringify(k)}`);
    if (isClearInput(v)) continue;
    const why = soundFieldError(k, v);
    if (why) throw new Error(why);
  }
  let recheck;
  ({ patch, recheck } = await sealProviderBlock('sound', patch));
  const settings = readSettings();
  recheck(settings);
  const all = isObj(settings.providers) ? settings.providers : {};
  const next = isObj(all.sound) ? { ...all.sound } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (isClearInput(v)) delete next[k]; else next[k] = v.trim();
  }
  if (Object.keys(sanitizeSound(next, SOUND_QUIET)).length) all.sound = next; else delete all.sound;
  if (Object.keys(all).length) settings.providers = all; else delete settings.providers;
  await persistSettings(settings);
  return soundConfig();
}

// ── OpenRouter (Models menu P2) ──
//   providers: { …, openrouter: { apiKey?, maxConcurrent?, order?, sort?, allowFallbacks? } }
// OpenRouter's own row: its key (literal or whole-value ${VAR}), its concurrency cap and its routing defaults
// (provider order, sort, allow fallbacks). NOT an upstream: it never joins UPSTREAM_PROVIDERS or allProviders().
// Stored minimally: a field holding its default is not written (allowFallbacks only as false), and an empty
// block is removed, and so is an empty providers.

const OPENROUTER_FIELDS = Object.freeze(['apiKey', 'maxConcurrent', 'order', 'sort', 'allowFallbacks']);
const OPENROUTER_DEFAULT_CONCURRENCY = 8;
const OPENROUTER_QUIET = Object.freeze({ quiet: true });
const openRouterDefaults = () => ({ apiKey: '', maxConcurrent: OPENROUTER_DEFAULT_CONCURRENCY, order: [], sort: '', allowFallbacks: true });

/** A provider order from a string[] or a comma string, trimmed with blanks dropped; null when it is neither. */
function openRouterOrder(v) {
  const list = typeof v === 'string' ? v.split(',') : v;
  if (!Array.isArray(list) || list.some((s) => typeof s !== 'string')) return null;
  return list.map((s) => s.trim()).filter(Boolean);
}

/** Why `v` is not a valid value for openrouter field `k` (one of OPENROUTER_FIELDS), or null when it is. */
function openRouterFieldError(k, v) {
  if (k === 'apiKey') return typeof v === 'string' && v.trim() ? null : 'apiKey must be a non-empty string';
  if (k === 'maxConcurrent') {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= MAX_PROVIDER_CONCURRENCY ? null : `maxConcurrent must be an integer from 1 to ${MAX_PROVIDER_CONCURRENCY}`;
  }
  if (k === 'order') return openRouterOrder(v) ? null : 'order must be a list of provider names';
  if (k === 'sort') return v === '' || OPENROUTER_SORTS.includes(v) ? null : `sort must be one of ${OPENROUTER_SORTS.join(' | ')}, or empty`;
  return typeof v === 'boolean' ? null : 'allowFallbacks must be true or false';
}

/** A valid value of field `k` in its stored form; undefined when it is the default (nothing to store). */
function openRouterStoredValue(k, v) {
  if (k === 'apiKey') return v.trim();
  if (k === 'maxConcurrent') { const n = Number(v); return n === OPENROUTER_DEFAULT_CONCURRENCY ? undefined : n; }
  if (k === 'order') { const list = openRouterOrder(v); return list.length ? list : undefined; }
  if (k === 'sort') return v || undefined;
  return v === false ? false : undefined;
}

/** The stored block's valid, non-default fields. Never throws. */
function sanitizeOpenRouter(raw, { quiet = false } = {}) {
  const r = isObj(raw) ? raw : {};
  const out = {};
  for (const k of OPENROUTER_FIELDS) {
    if (r[k] === undefined) continue;
    const why = openRouterFieldError(k, r[k]);
    if (why) { if (!quiet) console.warn(`[worca] providers.openrouter.${k}: ${why} — ignored`); continue; }
    const v = openRouterStoredValue(k, r[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * The OpenRouter row's effective config: the defaults under the stored block. The key stays raw (literal or
 * whole-value ${VAR}), '' when none. Never throws: a bad stored value reads as its default.
 * @returns {{ apiKey: string, maxConcurrent: number, order: string[], sort: ''|'price'|'throughput'|'latency', allowFallbacks: boolean }}
 */
export function openRouterConfig() {
  if (process.env.NODE_TEST_CONTEXT && !process.env.WORCA_TEST_ALLOW_HOME_FALLBACK) return openRouterDefaults();
  const all = readSettings().providers;
  return { ...openRouterDefaults(), ...sanitizeOpenRouter(isObj(all) ? all.openrouter : undefined) };
}

/**
 * Patch { apiKey?, maxConcurrent?, order?, sort?, allowFallbacks? }. A key left out keeps its value; '' or null
 * resets it to its default. Validates the whole patch before writing. `dryRun` validates the same way and returns
 * the would-be config without writing (Chat's model card, as updateProvider's).
 * @returns {Promise<ReturnType<typeof openRouterConfig>>} the effective config
 * @throws {Error}
 */
export async function updateOpenRouter(patch = {}, { dryRun = false } = {}) {
  assertTestSettingsAccess();
  if (!isObj(patch)) throw new Error('openrouter patch must be an object');
  for (const [k, v] of Object.entries(patch)) {
    if (!OPENROUTER_FIELDS.includes(k)) throw new Error(`unknown provider field ${JSON.stringify(k)} for openrouter`);
    if (isClearInput(v)) continue;
    const why = openRouterFieldError(k, v);
    if (why) throw new Error(why);
  }
  let recheck = NO_RECHECK;
  if (!dryRun) ({ patch, recheck } = await sealProviderBlock('openrouter', patch));
  const settings = readSettings();
  recheck(settings);
  const all = isObj(settings.providers) ? settings.providers : {};
  const next = isObj(all.openrouter) ? { ...all.openrouter } : {};
  for (const [k, v] of Object.entries(patch)) {
    const stored = isClearInput(v) ? undefined : openRouterStoredValue(k, v);
    if (stored === undefined) delete next[k]; else next[k] = stored;
  }
  // A dry run returns before `all` (settings.providers itself) changes or anything is written.
  if (dryRun) return { ...openRouterDefaults(), ...sanitizeOpenRouter(next) };
  if (Object.keys(sanitizeOpenRouter(next, OPENROUTER_QUIET)).length) all.openrouter = next; else delete all.openrouter;
  if (Object.keys(all).length) settings.providers = all; else delete settings.providers;
  await persistSettings(settings);
  return openRouterConfig();
}

/** Forget the Copilot sign-in (token + login). */
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

/** setUiLevel's value, pure: undefined = delete (a clear). */
export function nextUiLevel(input) { assertUiLevelInput(input); return isClearInput(input) ? undefined : input; }

/** Persist the mode. Every valid value is stored (there is no fixed default to elide); a clear deletes the key. */
export async function setUiLevel(input) {
  const v = nextUiLevel(input);
  const settings = readSettings();
  if (v === undefined) delete settings.uiLevel;
  else settings.uiLevel = v;
  await persistSettings(settings);
  return { uiLevel: uiLevel() };
}

// ── Feature flags (docs/feature-flags.md) ────────────────────────────────────
// settings.json `flags: { [key]: boolean }`, holding only values that differ from the registry
// default (D2). Resolution (env > settings > default), validation and `requires` live in
// src/core/flags.mjs; this is only the stored layer.
const warnedFlags = new Set();
function warnFlagOnce(path, value) {
  const id = `${path}:${JSON.stringify(value)}`;
  if (warnedFlags.has(id)) return;
  warnedFlags.add(id);
  console.warn(`[worca] ignoring settings.json ${path} = ${JSON.stringify(value)} (want true or false)`);
}

/** The STORED flag map: boolean entries only. Unknown KEYS pass through (the resolver warns about them).
 *  Under node:test it reads {} unless the test sandboxes HOME and opts in (homeGuarded): a developer's
 *  own flags must never change what a test renders. */
export function storedFlags() {
  if (homeGuarded()) return {};
  const v = readSettings().flags;
  if (v === undefined) return {};
  if (!isObj(v)) { warnFlagOnce('flags', v); return {}; }
  const out = {};
  for (const [k, b] of Object.entries(v)) {
    if (typeof b === 'boolean') out[k] = b; else warnFlagOnce(`flags.${k}`, b);
  }
  return out;
}

/** Persist the whole stored flag map; the caller has already dropped defaults and unknown keys. Empty ⇒ the key goes. */
export async function writeStoredFlags(map) {
  if (homeGuarded()) {
    throw new Error('feature-flag write under the node:test runner — sandbox HOME/USERPROFILE '
      + 'and set WORCA_TEST_ALLOW_HOME_FALLBACK=1 (tests must never touch the real ~/.worca-cc)');
  }
  const settings = readSettings();
  if (isObj(map) && Object.keys(map).length) settings.flags = { ...map };
  else delete settings.flags;
  await persistSettings(settings);
}

// ── Getting started (onboarding) ─────────────────────────────────────────────
// Machine-wide, nothing derivable: which steps are DONE is computed from product
// state by src/core/onboarding.mjs and never stored. `hidden` is the checklist's
// Hide (Settings › General › Getting started shows it again); `welcomeSeen` is the
// one-time welcome dialog; `workspaceGuideSeen` is the legacy "How workspaces work"
// flag, cleared when the last workspace is deleted. `setupFinished` records that the
// Setup Assistant was completed (install-wide, like the setup); `setupChecked` is the
// boot marker that credits an install that predates it exactly once
// (onboarding.mjs#ensureSetupMarker). `roleDefaultsNoticeSeen` is #1450's one-time
// notice about Worca's role defaults. `guidesSeen` maps a how-it-works area id
// (src/shared/how-it-works/areas.mjs) to true once that area's guide has been opened;
// `guidesReset` is a write-only command that clears the map and workspaceGuideSeen.
// All absent = all false and an empty map.
const ONBOARDING_FLAGS = Object.freeze(['hidden', 'welcomeSeen', 'workspaceGuideSeen', 'setupFinished', 'setupChecked', 'roleDefaultsNoticeSeen']);
const ONBOARDING_KEYS = Object.freeze([...ONBOARDING_FLAGS, 'guidesSeen', 'guidesReset']);
const SEEN_ONLY_KEYS = Object.freeze(['guidesSeen', 'workspaceGuideSeen']);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Only known area ids holding exactly true survive a read; anything else stored is ignored.
function storedGuidesSeen(raw) {
  if (!isPlainObject(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => isGuideAreaId(k) && v === true));
}

export function onboardingPrefs() {
  const o = readSettings().onboarding;
  const obj = isPlainObject(o) ? o : {};
  return {
    ...Object.fromEntries(ONBOARDING_FLAGS.map((k) => [k, obj[k] === true])),
    guidesSeen: storedGuidesSeen(obj.guidesSeen),
  };
}

/** @throws {Error} unless every present key is a known flag holding a boolean, or a valid guidesSeen / guidesReset. */
export function assertOnboardingPrefsInput(patch) {
  if (!isPlainObject(patch)) throw new Error('onboarding prefs must be an object');
  for (const [k, v] of Object.entries(patch)) {
    if (!ONBOARDING_KEYS.includes(k)) throw new Error(`unknown onboarding key ${JSON.stringify(k)}`);
    if (k === 'guidesSeen') {
      if (!isPlainObject(v)) throw new Error('onboarding.guidesSeen must be an object');
      for (const [area, seen] of Object.entries(v)) {
        if (!isGuideAreaId(area)) throw new Error(`unknown how-it-works area ${JSON.stringify(area)}`);
        if (typeof seen !== 'boolean') throw new Error(`onboarding.guidesSeen.${area} must be true or false`);
      }
    } else if (typeof v !== 'boolean') {
      throw new Error(`onboarding.${k} must be true or false`);
    }
  }
}

/** True when the patch only records that a guide was opened (it must not pin the interface mode). */
export function isSeenOnlyPatch(patch) {
  if (!isPlainObject(patch)) return false;
  const keys = Object.keys(patch);
  return keys.length > 0 && keys.every((k) => SEEN_ONLY_KEYS.includes(k));
}

/** Merge `patch` over the stored prefs (validated whole first); a store with every flag false and no guide seen drops the key. */
export async function setOnboardingPrefs(patch = {}) {
  assertOnboardingPrefsInput(patch);
  const { onboarding: _previous, ...rest } = readSettings();
  const current = onboardingPrefs();
  const reset = patch.guidesReset === true;
  const base = reset ? { ...current, workspaceGuideSeen: false, guidesSeen: {} } : current;
  const flags = { ...base };
  for (const k of ONBOARDING_FLAGS) if (k in patch) flags[k] = patch[k];
  const guidesSeen = { ...base.guidesSeen };
  for (const [area, seen] of Object.entries(patch.guidesSeen || {})) {
    if (seen) guidesSeen[area] = true; else delete guidesSeen[area];
  }
  const { guidesSeen: _map, ...flagsOnly } = flags;
  const empty = ONBOARDING_FLAGS.every((k) => !flagsOnly[k]) && Object.keys(guidesSeen).length === 0;
  const next = Object.keys(guidesSeen).length ? { ...flagsOnly, guidesSeen } : flagsOnly;
  await persistSettings(empty ? rest : { ...rest, onboarding: next });
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
 * Validate a schedule-defaults patch ('' / null clear a key). The setter and Ask's change_setting (worca Chat P2)
 * share it, so both refuse with the same words.
 * @throws {Error} on the first invalid value
 */
export function assertScheduleDefaultsInput(patch = {}) {
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);
  const clear = (v) => v === '' || v === null || v === undefined;
  if (has('graceMin') && !clear(patch.graceMin) && !isGraceMin(patch.graceMin)) throw new Error('scheduleGraceMin must be a whole number of minutes from 0 to 10080');
  if (has('ifMissed') && !clear(patch.ifMissed) && !SCHEDULE_IF_MISSED.includes(patch.ifMissed)) throw new Error(`scheduleIfMissed must be one of ${SCHEDULE_IF_MISSED.join(' | ')}`);
  if (has('maxFailures') && !clear(patch.maxFailures) && !isMaxFailures(patch.maxFailures)) throw new Error('scheduleMaxFailures must be a whole number from 0 to 100');
}

/**
 * Persist any subset of the schedule defaults; '' / null clears a key back to its
 * default. The whole patch is validated before anything is written.
 * @throws {Error} on the first invalid value
 */
export async function setScheduleDefaults(patch = {}) {
  assertScheduleDefaultsInput(patch);
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);
  const clear = (v) => v === '' || v === null || v === undefined;
  const settings = readSettings();
  const put = (key, v) => { if (clear(v)) delete settings[key]; else settings[key] = v; };
  if (has('graceMin')) put('scheduleGraceMin', patch.graceMin);
  if (has('ifMissed')) put('scheduleIfMissed', patch.ifMissed);
  if (has('maxFailures')) put('scheduleMaxFailures', patch.maxFailures);
  await persistSettings(settings);
  return scheduleDefaults();
}

/** The person a Chat home pin list belongs to: the signed-in name lowercased, '' for a local or operator install. */
const pinsPersonKey = (person) => String(person ?? '').trim().toLowerCase();
function pinsMap(settings) {
  const m = settings.chatHomePins;
  // A null-prototype copy: a person named "__proto__" stays an ordinary key.
  return Object.assign(Object.create(null), m && typeof m === 'object' && !Array.isArray(m) ? m : {});
}

/** The person's pinned workflow ids (Chat home quick actions), in pin order. Never set = ['wf_shape']. Never throws. */
export function chatHomePinsFor(person) {
  if (homeGuarded()) return storedPins(undefined);
  return storedPins(pinsMap(readSettings())[pinsPersonKey(person)]);
}

/** Replace the person's list ([] = nothing pinned, kept as such). Throws { code: 'BAD_HOME_PINS' } before any write. */
export async function setChatHomePinsFor(person, list) {
  const { pins, errors } = normalizePins(list);
  if (errors.length) throw Object.assign(new Error(errors[0]), { code: 'BAD_HOME_PINS' });
  const settings = readSettings();
  const map = pinsMap(settings);
  map[pinsPersonKey(person)] = pins;
  settings.chatHomePins = map;
  await persistSettings(settings);
  return chatHomePinsFor(person);
}

/** The answerer profile (the lead a person shapes as): per person, keyed like the Chat home pins. It describes the
 *  person, not a project, so it sits outside the user-to-project settings cascade. */
function answererMap(settings) {
  const m = settings.answererProfiles;
  return Object.assign(Object.create(null), m && typeof m === 'object' && !Array.isArray(m) ? m : {});
}

/** The person's profile, `{ lead }` (null when never set or unknown). `smallRuns` (the live flag) admits a Compliance
 *  lead; off, a stored one reads null. Never throws. */
export function answererProfileFor(person, { smallRuns = false } = {}) {
  if (homeGuarded()) return { lead: null };
  const lead = answererMap(readSettings())[pinsPersonKey(person)]?.lead;
  return { lead: isAnswererLead(lead, { smallRuns }) ? lead : null };
}

/** Set the person's lead, keeping the record's other keys. Under `smallRuns` an explicit `null` ("No role") removes
 *  the lead. Throws { code: 'BAD_LEAD' } before any write, naming the leads `smallRuns` allows. */
export async function setAnswererProfileFor(person, { lead } = {}, { smallRuns = false } = {}) {
  const clear = lead === null && smallRuns === true;
  if (!clear && !isAnswererLead(lead, { smallRuns })) throw Object.assign(new Error(`Pick one of: ${answererLeadKeys({ smallRuns }).join(', ')}`), { code: 'BAD_LEAD' });
  const settings = readSettings();
  const map = answererMap(settings);
  const key = pinsPersonKey(person);
  const record = map[key] && typeof map[key] === 'object' && !Array.isArray(map[key]) ? { ...map[key] } : {};
  if (clear) delete record.lead;
  else record.lead = lead;
  map[key] = record;
  settings.answererProfiles = map;
  await persistSettings(settings);
  return answererProfileFor(person, { smallRuns });
}

// Guide prefs (Shaper ask screens, flag shaperSmallRuns): in the person's answerer record, stored only away from their
// defaults — `guideOn` only when false, `guideOfferSeen` and `guideRowsOpen` only when true.
const GUIDE_PREF_KEYS = Object.freeze({ on: 'guideOn', offerSeen: 'guideOfferSeen', rowsOpen: 'guideRowsOpen' });

/** The person's Guide prefs, `{ on, offerSeen, rowsOpen }` (the defaults when never set). Never throws. */
export function guidePrefsFor(person) {
  if (homeGuarded()) return { on: true, offerSeen: false, rowsOpen: false };
  const record = answererMap(readSettings())[pinsPersonKey(person)];
  const r = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  return { on: r.guideOn !== false, offerSeen: r.guideOfferSeen === true, rowsOpen: r.guideRowsOpen === true };
}

/** A prefs patch: an object of one or more of on, offerSeen, rowsOpen, each a boolean. Throws { code: 'BAD_GUIDE_PREFS' }. */
export function assertGuidePrefsInput(patch) {
  const bad = () => Object.assign(new Error('Guide preferences take on, offerSeen and rowsOpen, each true or false'), { code: 'BAD_GUIDE_PREFS' });
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw bad();
  const keys = Object.keys(patch);
  if (!keys.length) throw bad();
  for (const k of keys) if (!Object.hasOwn(GUIDE_PREF_KEYS, k) || typeof patch[k] !== 'boolean') throw bad();
  return Object.fromEntries(keys.map((k) => [k, patch[k]]));
}

/** Merge a prefs patch into the person's record, keeping the lead and every other key. A refusal writes nothing. */
export async function setGuidePrefsFor(person, patch) {
  const next = assertGuidePrefsInput(patch);
  const settings = readSettings();
  const map = answererMap(settings);
  const key = pinsPersonKey(person);
  const record = map[key] && typeof map[key] === 'object' && !Array.isArray(map[key]) ? { ...map[key] } : {};
  for (const [k, v] of Object.entries(next)) {
    const field = GUIDE_PREF_KEYS[k];
    const atDefault = k === 'on' ? v === true : v === false;
    if (atDefault) delete record[field]; else record[field] = v;
  }
  map[key] = record;
  settings.answererProfiles = map;
  await persistSettings(settings);
  return guidePrefsFor(person);
}

/** Local tag dimensions (Settings › Tags): used when the run target's team policy sets none. Never throws. */
export function userTagDimensions() {
  if (homeGuarded()) return [];
  return normaliseDimensions(readSettings().tagDimensions).dims;
}

/** Replace the local list; [] or null clears it. Throws { code: 'BAD_TAG_DIMENSIONS' } before any write. */
export async function setUserTagDimensions(list) {
  const { dims, errors } = normaliseDimensions(list ?? []);
  if (errors.length) throw Object.assign(new Error(errors[0]), { code: 'BAD_TAG_DIMENSIONS' });
  const settings = readSettings();
  if (dims.length) settings.tagDimensions = dims; else delete settings.tagDimensions;
  await persistSettings(settings);
  return userTagDimensions();
}

/** Settings › Tags › "Require mandatory tags to start a run" (local; a team policy's runs.enforceTags wins). */
export function userEnforceTags() {
  if (homeGuarded()) return false;
  return readSettings().enforceTags === true;
}

/** true/false; false removes the key. Throws { code: 'BAD_ENFORCE_TAGS' } before any write. */
export async function setUserEnforceTags(v) {
  if (typeof v !== 'boolean') throw Object.assign(new Error('enforceTags must be true or false'), { code: 'BAD_ENFORCE_TAGS' });
  const settings = readSettings();
  if (v) settings.enforceTags = true; else delete settings.enforceTags;
  await persistSettings(settings);
  return userEnforceTags();
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
/** The stored `sync` after `patch` (undefined = delete the key). Pure; shared by the setter and the setup apply. */
export function nextSyncSettings(current, patch) {
  assertSyncSettingsInput(patch);
  if (patch === null || patch === '') return undefined;
  // Store only the keys someone set: a key left out follows the built-in default as it changes.
  const prev = isObj(current) ? current : {};
  const next = {};
  for (const k of Object.keys(DEFAULT_SYNC_SETTINGS)) if (Object.hasOwn(prev, k)) next[k] = normalizeSyncSettings(prev)[k];
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = v; }
  return Object.keys(next).length ? next : undefined;
}
export async function setSyncDefaults(patch) {
  const settings = readSettings();
  const v = nextSyncSettings(settings.sync, patch);
  if (v === undefined) delete settings.sync; else settings.sync = v;
  await persistSettings(settings);
  return syncDefaults();
}

// ── Wait for the network (auto-resume on network errors) ─────────────────────
// A network-class step failure waits for the step's endpoint to answer again, then retries,
// up to maxWaitMin from the FIRST network failure; past it a run behaves as before.
// Env pins (tests, CI) win when non-empty: WORCA_NETWORK_WAIT (0/false = off) and
// WORCA_NETWORK_WAIT_MAX_MS (the cap in ms).
export const DEFAULT_NETWORK_WAIT = Object.freeze({ enabled: true, maxWaitMin: 240 });
const isNetworkMaxWaitMin = (v) => Number.isInteger(v) && v >= 1 && v <= 1440;

/** Merge `v` over the defaults, keeping only valid keys. Pure. */
export function normalizeNetworkWait(v, base = DEFAULT_NETWORK_WAIT) {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    maxWaitMin: isNetworkMaxWaitMin(o.maxWaitMin) ? o.maxWaitMin : base.maxWaitMin,
  };
}
export function networkWaitSettings() { return normalizeNetworkWait(readSettings().networkWait); }

/** @throws {Error} on anything but a partial, valid networkWait object (null / '' resets; a null key resets that key). */
export function assertNetworkWaitInput(patch) {
  if (patch === null || patch === '') return;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('networkWait must be an object');
  for (const k of Object.keys(patch)) if (!Object.hasOwn(DEFAULT_NETWORK_WAIT, k)) throw new Error(`unknown networkWait setting: ${k}`);
  const set = (k) => k in patch && patch[k] !== null;
  if (set('enabled') && typeof patch.enabled !== 'boolean') throw new Error('networkWait.enabled must be true or false');
  if (set('maxWaitMin') && !isNetworkMaxWaitMin(patch.maxWaitMin)) throw new Error('networkWait.maxWaitMin must be a whole number of minutes from 1 to 1440');
}

/** The stored `networkWait` after `patch` (undefined = delete the key). Pure; shared by the setter and the setup apply. */
export function nextNetworkWait(current, patch) {
  assertNetworkWaitInput(patch);
  if (patch === null || patch === '') return undefined;
  // Store only the keys someone set: a key left out follows the built-in default as it changes.
  const prev = isObj(current) ? current : {};
  const next = {};
  for (const k of Object.keys(DEFAULT_NETWORK_WAIT)) if (Object.hasOwn(prev, k)) next[k] = normalizeNetworkWait(prev)[k];
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = v; }
  return Object.keys(next).length ? next : undefined;
}
export async function setNetworkWait(patch) {
  const settings = readSettings();
  const v = nextNetworkWait(settings.networkWait, patch);
  if (v === undefined) delete settings.networkWait; else settings.networkWait = v;
  await persistSettings(settings);
  return networkWaitSettings();
}

/** What a run does right now: the stored setting, with a non-empty env pin winning. */
export function effectiveNetworkWait(env = process.env) {
  const s = networkWaitSettings();
  const flag = env?.WORCA_NETWORK_WAIT;
  const enabled = flag !== undefined && flag !== '' ? !/^(0|false|off|no)$/i.test(String(flag).trim()) : s.enabled;
  const raw = env?.WORCA_NETWORK_WAIT_MAX_MS;
  const n = Number(raw);
  const maxWaitMs = raw != null && raw !== '' && Number.isFinite(n) && n >= 0 ? n : s.maxWaitMin * 60_000;
  return { enabled, maxWaitMs };
}

// ── Machine load (Settings › Runs › Machine load) ────────────────────────────
// maxConcurrentRuns: runs past it wait for a free slot (run-slots.mjs, shared by every Worca process on this
// machine). testWorkers: WORCA_TEST_CONCURRENCY in every agent's env, the worker cap a test runner that reads
// it uses (null = half the cores). keepRunsDays: finished runs older than this are archived by the daily
// sweep (run-retention.mjs; null = never). A stored key that is absent follows the default.
export const DEFAULT_RUN_LIMITS = Object.freeze({ maxConcurrentRuns: 3, testWorkers: null, keepRunsDays: null });
const RUN_LIMIT_RANGES = Object.freeze({ maxConcurrentRuns: [1, 20], testWorkers: [1, 64], keepRunsDays: [1, 3650] });
const inRunLimit = (k, v) => Number.isInteger(v) && v >= RUN_LIMIT_RANGES[k][0] && v <= RUN_LIMIT_RANGES[k][1];

export function runLimits() {
  const stored = readSettings().runLimits;
  const o = isObj(stored) ? stored : {};
  return Object.fromEntries(Object.keys(DEFAULT_RUN_LIMITS).map((k) => [k, inRunLimit(k, o[k]) ? o[k] : DEFAULT_RUN_LIMITS[k]]));
}

/** @throws {Error} on anything but a partial, valid runLimits object (null / '' resets; a null key resets that key). */
export function assertRunLimitsInput(patch) {
  if (patch === null || patch === '') return;
  if (!isObj(patch)) throw new Error('runLimits must be an object');
  for (const [k, v] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULT_RUN_LIMITS, k)) throw new Error(`unknown runLimits setting: ${k}`);
    const [lo, hi] = RUN_LIMIT_RANGES[k];
    if (v !== null && !inRunLimit(k, v)) throw new Error(`runLimits.${k} must be a whole number from ${lo} to ${hi}`);
  }
}

/** What an unset runLimits.testWorkers means on this machine: half the cores. */
export const autoTestWorkers = () => Math.max(1, Math.floor(availableParallelism() / 2));

/** The test-worker cap every agent gets as WORCA_TEST_CONCURRENCY: the setting, else autoTestWorkers(). */
export function testWorkerCap() {
  return runLimits().testWorkers ?? autoTestWorkers();
}

export async function setRunLimits(patch) {
  assertRunLimitsInput(patch);
  const settings = readSettings();
  const next = patch === null || patch === '' ? {} : { ...(isObj(settings.runLimits) ? settings.runLimits : {}) };
  if (isObj(patch)) for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = v; }
  if (Object.keys(next).length) settings.runLimits = next; else delete settings.runLimits;
  await persistSettings(settings);
  return runLimits();
}

// Settings › Network proxy (networkProxy.enabled; applied live by egress-policy.mjs startLiveEgress).
// The same list as upstream-proxy.mjs AUTH_MODES: this module imports nothing from the core graph (test pins it).
export const NETWORK_PROXY_AUTH = Object.freeze(['auto', 'none', 'basic', 'ntlm', 'digest']);
const NETWORK_PROXY_TIMEOUTS = ['connectMs', 'authMs', 'idleMs'];
const isProxyMs = (v) => Number.isInteger(v) && v >= 500 && v <= 3_600_000;
// The same range as upstream-proxy.mjs fixedPortOf (D17; a test feeds both the same values).
const isFixedPort = (v) => Number.isInteger(v) && v >= 1024 && v <= 65535;

export function networkProxySettings() {
  const v = readSettings().networkProxy;
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : {};
}

/** True when the corporate proxy is on (D6). A leftover flags.corporateProxy (a home the boot
 *  migration could not write) still counts, unless networkProxy.enabled says false. */
export function networkProxyEnabled(settings = readSettings()) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const np = s.networkProxy && typeof s.networkProxy === 'object' ? s.networkProxy : {};
  if (typeof np.enabled === 'boolean') return np.enabled;
  return !!(s.flags && s.flags.corporateProxy === true);
}

/** D6: the Labs flag that became networkProxy.enabled. Pure: {changed, settings}. */
export function migrateLegacyProxyFlag(settings) {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  const flags = s.flags && typeof s.flags === 'object' && !Array.isArray(s.flags) ? s.flags : null;
  if (!flags || !Object.prototype.hasOwnProperty.call(flags, 'corporateProxy')) return { changed: false, settings: s };
  const { corporateProxy: was, ...restFlags } = flags;
  const next = { ...s };
  if (Object.keys(restFlags).length) next.flags = restFlags; else delete next.flags;
  const np = next.networkProxy && typeof next.networkProxy === 'object' ? next.networkProxy : {};
  if (was === true && typeof np.enabled !== 'boolean') next.networkProxy = { ...np, enabled: true };
  return { changed: true, settings: next };
}

/** Run once per process start (server boot, CLI main), before the egress proxy starts. @returns {Promise<boolean>} wrote */
export async function migrateCorporateProxyFlag() {
  const r = migrateLegacyProxyFlag(readSettings());
  if (!r.changed) return false;
  try { await persistSettings(r.settings); return true; } catch { return false; }   // networkProxyEnabled still reads the flag
}

/** Poll settings.json by stat signature (the watchProxyLogin pattern, proxy-credentials.mjs). @returns {() => void} stop */
export function watchSettingsFile(onChange, { intervalMs = 1000 } = {}) {
  const file = settingsFile();
  const sig = () => {
    try { const st = statSync(file); return `${st.ino}|${st.mtimeMs}|${st.ctimeMs}|${st.size}`; } catch (err) { return err && err.code ? err.code : 'error'; }
  };
  let last = sig();
  const timer = setInterval(() => {
    const cur = sig();
    if (cur === last) return;
    last = cur;
    try { onChange(); } catch { /* ignore */ }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

/** readSettings() for watchers: null when the file is missing or is not a JSON object, so a tick
 *  mid-write, a broken hand edit or a deleted file never reads as "proxy off" (R-sec-5). */
export function readSettingsStrict() {
  try {
    const d = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
  } catch { return null; }
}

/** "host:port" or "http://host:port" -> "http://host:port"; throws on userinfo or another scheme. */
function normalizeProxyUpstream(raw) {
  const s = String(raw).trim();
  let u;
  try { u = new URL(s.includes('://') ? s : `http://${s}`); } catch { throw new Error('networkProxy.upstream is not a valid host:port'); }
  if (u.protocol !== 'http:') throw new Error('networkProxy.upstream must be an http:// proxy');
  if (u.username || u.password) throw new Error('networkProxy.upstream must not carry a user name or password (a password never goes into settings.json; use Log in)');
  if (!u.hostname) throw new Error('networkProxy.upstream has no host');
  return `http://${u.host}`;
}

export function assertNetworkProxyInput(patch) {
  if (patch === null || patch === '') return;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('networkProxy must be an object');
  for (const k of Object.keys(patch)) if (!['enabled', 'upstream', 'auth', 'noProxy', 'timeouts', 'fixedPort'].includes(k)) throw new Error(`unknown networkProxy setting: ${k}`);
  if (patch.enabled != null && typeof patch.enabled !== 'boolean') throw new Error('networkProxy.enabled must be true or false');
  if (patch.upstream != null && patch.upstream !== '') normalizeProxyUpstream(patch.upstream);
  if (patch.auth != null && !NETWORK_PROXY_AUTH.includes(patch.auth)) throw new Error(`networkProxy.auth must be one of ${NETWORK_PROXY_AUTH.join(', ')}`);
  if (patch.fixedPort != null && !isFixedPort(patch.fixedPort)) throw new Error('networkProxy.fixedPort must be a port from 1024 to 65535');
  if (patch.noProxy != null) {
    const ok = typeof patch.noProxy === 'string' ? patch.noProxy.length <= 4096
      : Array.isArray(patch.noProxy) && patch.noProxy.length <= 200 && patch.noProxy.every((e) => typeof e === 'string' && e.length <= 253);
    if (!ok) throw new Error('networkProxy.noProxy must be a comma-separated list of hosts');
  }
  if (patch.timeouts != null) {
    if (typeof patch.timeouts !== 'object' || Array.isArray(patch.timeouts)) throw new Error('networkProxy.timeouts must be an object');
    for (const [k, v] of Object.entries(patch.timeouts)) {
      if (!NETWORK_PROXY_TIMEOUTS.includes(k)) throw new Error(`unknown networkProxy timeout: ${k}`);
      if (v !== null && !isProxyMs(v)) throw new Error(`networkProxy.timeouts.${k} must be 500 to 3600000 ms`);
    }
  }
}

/** The merge PUT /api/proxy/settings applies (null/'' drops a key; the whole patch null/'' drops it all). Pure. */
export function mergeNetworkProxy(current, patch) {
  if (patch === null || patch === '') return {};
  const next = { ...(current || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === '') delete next[k];
    else if (k === 'upstream') next.upstream = normalizeProxyUpstream(v);
    else if (k === 'timeouts') {
      const t = { ...(next.timeouts || {}) };
      for (const [tk, tv] of Object.entries(v)) { if (tv === null) delete t[tk]; else t[tk] = tv; }
      if (Object.keys(t).length) next.timeouts = t; else delete next.timeouts;
    } else next[k] = v;
  }
  return next;
}

/** What setNetworkProxy(patch) would store, without writing (the chat card's validator). Throws like it. */
export function previewNetworkProxy(patch) {
  assertNetworkProxyInput(patch);
  return mergeNetworkProxy(networkProxySettings(), patch);
}

/** setNetworkProxy's merge, pure (previewNetworkProxy validates). undefined = delete. */
export function nextNetworkProxy(patch) {
  const next = previewNetworkProxy(patch);
  return Object.keys(next).length ? next : undefined;
}

export async function setNetworkProxy(patch) {
  const next = nextNetworkProxy(patch);
  const settings = readSettings();
  if (next !== undefined) settings.networkProxy = next; else delete settings.networkProxy;
  await persistSettings(settings);
  return networkProxySettings();
}
