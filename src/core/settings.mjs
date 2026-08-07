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
//   pipelineCostLimitUsd   — per-pipeline lifetime USD spend cap; unset = no limit.
//   totalCostLimitUsd      — windowed all-pipelines USD spend cap; unset = no limit.
//   costLimitResetPeriod   — total-budget window, 'weekly' | 'monthly' (default).
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
// only). projects.mjs imports it, so importing projects.mjs back would make
// worcaHome() -> getWorcaRoot() -> projects.mjs an infinite cycle.
//
// Reads are synchronous + never-throwing (worcaHome's callers are sync). There
// is deliberately no in-module cache: worcaHome() is read fresh per operation,
// so a saved root takes effect for new runs/listing without a server restart.

import { mkdir, writeFile, rename } from 'node:fs/promises';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

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
export function contextMaxBytesPerFile() {
  return readByteCap('contextMaxBytesPerFile', DEFAULT_CONTEXT_MAX_BYTES_PER_FILE);
}

/** Total memory budget for generated run context (§5.4). */
export function contextMaxBytesTotal() {
  return readByteCap('contextMaxBytesTotal', DEFAULT_CONTEXT_MAX_BYTES_TOTAL);
}

/** Skill delivery mechanism (§5.6): 'copy' (default, isolated) | 'symlink' (write-through). */
export function skillMount() {
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
export function pipelineCostLimitUsd() { return readUsdCap('pipelineCostLimitUsd'); }
/** Windowed all-pipelines spend cap in USD, or null (no limit). */
export function totalCostLimitUsd() { return readUsdCap('totalCostLimitUsd'); }

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

/** @throws {Error} unless `input` is 'weekly' | 'monthly' (or empty, which resets). */
export async function setCostLimitResetPeriod(input) {
  assertResetPeriodInput(input);
  const settings = readSettings();
  if (isClearInput(input)) delete settings.costLimitResetPeriod;  // reset to 'monthly'
  else settings.costLimitResetPeriod = input;
  await persistSettings(settings);
  return { costLimitResetPeriod: costLimitResetPeriod() };
}
