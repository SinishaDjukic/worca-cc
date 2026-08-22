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
// plus the zero-import model-env.mjs leaf only). projects.mjs imports it, so
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
import { EFFORTS, isReservedModelEnvKey } from './model-env.mjs';

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

// ── Ask Worca per-turn limits (ask-worca-design.md §6.9, D12) ────────────────
// Two keys, both read fresh on every chat turn. `askMaxTurns` is an integer cap
// on claude's agentic turns (--max-turns); `askMaxBudgetUsd` is the per-turn
// dollar cap (--max-budget-usd). For the budget key the literal `null` is a
// STORED value meaning "no cap" (the flag is omitted), while '' / undefined clear
// the key back to the default — the two semantics the design assigns to that key.
export const DEFAULT_ASK_MAX_TURNS = 40;
export const DEFAULT_ASK_MAX_BUDGET_USD = 2;

const isAskMaxTurns = (v) => Number.isSafeInteger(v) && v >= 1 && v <= 500;
const isAskMaxBudget = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0.1 && v <= 100;

/** --max-turns for one chat turn: integer 1..500; absent/invalid ⇒ the default (loudly). */
export function askMaxTurns() {
  const v = readSettings().askMaxTurns;
  if (v === undefined) return DEFAULT_ASK_MAX_TURNS;
  if (isAskMaxTurns(v)) return v;
  console.warn(`[worca] invalid askMaxTurns ${JSON.stringify(v)} — using the default (${DEFAULT_ASK_MAX_TURNS})`);
  return DEFAULT_ASK_MAX_TURNS;
}

/** --max-budget-usd for one chat turn: number 0.1..100, or null = no cap; absent/invalid ⇒ the default (loudly). */
export function askMaxBudgetUsd() {
  const v = readSettings().askMaxBudgetUsd;
  if (v === undefined) return DEFAULT_ASK_MAX_BUDGET_USD;
  if (v === null) return null;
  if (isAskMaxBudget(v)) return v;
  console.warn(`[worca] invalid askMaxBudgetUsd ${JSON.stringify(v)} — using the default (${DEFAULT_ASK_MAX_BUDGET_USD})`);
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

// ── chat notification preferences (chat-connectivity-design.md §4.5) ─────────

const CHAT_NOTIFY_EVENTS = ['done', 'error', 'question', 'paused'];

/**
 * Effective chat notification prefs. Every event defaults ON; channels default
 * enabled (an absent "<plugin>/<channelId>" key means enabled — presence with
 * {enabled:false} is the opt-out record).
 * @returns {{notify: Record<string, boolean>, channels: Record<string, {enabled: boolean}>}}
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
  return { notify, channels };
}

/**
 * Merge-patch the chat prefs: {notify?: {done?, error?, question?, paused?},
 * channels?: {"<plugin>/<id>"?: {enabled: boolean}}}. Unknown notify keys are
 * rejected (400 at the API layer); channels merge per key.
 */
export async function setChatPrefs(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('chat prefs must be an object');
  for (const k of Object.keys(patch.notify || {})) {
    if (!CHAT_NOTIFY_EVENTS.includes(k)) throw new Error(`unknown chat notify event "${k}"`);
  }
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
const orderEfforts = (list) => EFFORTS.filter((e) => list.includes(e));

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
  const efforts = Array.isArray(raw.efforts) ? orderEfforts(raw.efforts) : [];
  const env = {};
  const rawEnv = raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env) ? raw.env : {};
  for (const [k, v] of Object.entries(rawEnv)) {
    if (isReservedModelEnvKey(k) || typeof v !== 'string' || !v) {
      console.warn(`[worca] models entry ${JSON.stringify(id)}: dropping env key ${JSON.stringify(k)} (reserved or not a non-empty string)`);
      continue;
    }
    env[k] = v;
  }
  return {
    id,
    label,
    efforts: efforts.length ? efforts : [...EFFORTS],
    ...(Object.keys(env).length ? { env } : {}),
  };
}

/**
 * The sanitized global model catalog: [{id, label, efforts, env?}], effective
 * shape (label/efforts always present). Missing/corrupt -> []. Malformed and
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
function assertEfforts(input) {
  if (isClearInput(input) || (Array.isArray(input) && input.length === 0)) return [];
  if (!Array.isArray(input)) throw new Error(`efforts must be an array drawn from ${EFFORTS.join(' | ')}`);
  for (const e of input) {
    if (!EFFORTS.includes(e)) throw new Error(`unknown effort ${JSON.stringify(e)} — must be one of ${EFFORTS.join(' | ')}`);
  }
  return orderEfforts(input);
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
function assertTestSettingsAccess() {
  if (process.env.NODE_TEST_CONTEXT && !process.env.WORCA_TEST_ALLOW_HOME_FALLBACK) {
    throw new Error(
      'global model catalog write under the node:test runner — sandbox HOME/USERPROFILE ' +
      'and set WORCA_TEST_ALLOW_HOME_FALLBACK=1 (tests must never touch the real ~/.worca-cc)'
    );
  }
}

/** The MINIMAL stored shape for validated parts (see section comment). */
function storedModelShape(id, label, efforts, env) {
  return {
    id,
    ...(label && label !== id ? { label } : {}),
    ...(efforts.length && efforts.length !== EFFORTS.length ? { efforts } : {}),
    ...(Object.keys(env).length ? { env } : {}),
  };
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
 * subset of EFFORTS (empty/absent = all); `env` keys must not be reserved.
 * @returns {Promise<{id:string,label:string,efforts:string[],env?:object}>} the effective entry
 * @throws {Error} on invalid input or a case-insensitively duplicate id
 */
export async function addGlobalModel({ id, label, efforts, env } = {}) {
  assertTestSettingsAccess();
  const vid = assertModelId(id);
  if (!isClearInput(label) && typeof label !== 'string') throw new Error('label must be a string');
  const vefforts = assertEfforts(efforts);
  const venv = assertEnvPairs(env);
  const settings = readSettings();
  const models = rawModels(settings);
  if (findModelIndex(models, vid) !== -1) throw new Error(`a model with id ${JSON.stringify(vid)} already exists`);
  const vlabel = (typeof label === 'string' && label.trim()) || vid;
  settings.models = [...models, storedModelShape(vid, vlabel, vefforts, venv)];
  await persistSettings(settings);
  return listGlobalModels().find((m) => m.id.toLowerCase() === vid.toLowerCase());
}

/**
 * Patch a global catalog entry. Omitted fields are kept. `label`: ''/null
 * resets to the id. `efforts`: []/null resets to all. `env`: null clears the
 * whole map; an object merges per key, where a null value DELETES that key and
 * a string sets it (write-only PATCH semantics, design §4.10).
 * @returns {Promise<object>} the effective entry
 * @throws {Error} on an unknown id or invalid input
 */
export async function updateGlobalModel(id, { label, efforts, env } = {}) {
  assertTestSettingsAccess();
  const vid = assertModelId(id);
  const settings = readSettings();
  const models = rawModels(settings);
  const idx = findModelIndex(models, vid);
  if (idx === -1) throw new Error(`unknown model id ${JSON.stringify(vid)}`);
  const current = sanitizeGlobalModel(models[idx]);

  let nextLabel = current.label;
  if (label !== undefined) {
    if (!isClearInput(label) && typeof label !== 'string') throw new Error('label must be a string');
    nextLabel = (typeof label === 'string' && label.trim()) || current.id;
  }
  const nextEfforts = efforts === undefined
    ? orderEfforts(current.efforts)
    : assertEfforts(efforts);
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

  settings.models = models.slice();
  settings.models[idx] = storedModelShape(current.id, nextLabel, nextEfforts, nextEnv);
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
