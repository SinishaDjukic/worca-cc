// src/core/model-addons.mjs — prompt add-ons: a short, harness- and model-specific correction appended after the
// shared agent prompt (executor.mjs prepare()). This is the ONE module that maps an engine and a model id to add-on files.
//
// Files live in agents/addons/, in two layers read in this order, each file only when it exists:
//   harness/<engine>.md             the engine's harness layer (every known engine; real harness differences)
//   harness/<engine>.unattended.md  unattended steps only
//   harness/<engine>.<agentKey>.md  that agent only
//   <family>.md                     the model layer: every mode
//   <family>.unattended.md          unattended steps only (keep-going and don't-ask text lives here)
//   <family>.<agentKey>.md          every mode, for that agent only (`unattended` is never an agent key)
// They are joined by a blank line, so model notes come last. No files at all give no add-on, and so a byte-identical
// prompt. A resumed step never comes here: it sends the add-on its first turn pinned (pinFitsSpawn checks the record).
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { copilotWireModel } from './model-env.mjs';
import { ENGINE_NAMES } from '../shared/engine-switch.mjs';

/** The families that have add-on files. Any other family (claude-opus-4-7, …) resolves to null. */
export const ADDON_FAMILIES = Object.freeze([
  'fable-5-2', 'fable-5-1', 'fable-5', 'opus-5-5', 'opus-5', 'opus-4-8', 'sonnet-5-5', 'sonnet-5', 'haiku-5-5',
  'opus-4-6', 'sonnet-4-6', 'haiku-4-5', 'gpt-6', 'gpt-5-codex', 'gemini-3', 'kimi-k3',
]);

/** The families resolveModelFamily (effort intents) knows: exactly the 9 it knew before the add-on families grew. */
const LEGACY_FAMILIES = Object.freeze([
  'fable-5-2', 'fable-5-1', 'fable-5', 'opus-5-5', 'opus-5', 'opus-4-8', 'sonnet-5-5', 'sonnet-5', 'haiku-5-5',
]);

/** The engines whose spawns carry an add-on: every known engine. A harness file is named after one of them. */
export const ADDON_ENGINES = ENGINE_NAMES;

/**
 * Non-Anthropic model ids (normalised: lower case, the last `/` segment) → their add-on family, one family per vendor
 * prompting guide (docs/models.md names each source). An id not listed gets no model file. Anthropic ids resolve by
 * ADDON_FAMILY_RE instead. Looked up with Object.hasOwn, so `constructor` and `__proto__` find nothing.
 */
export const MODEL_ID_FAMILIES = Object.freeze({
  'gpt-6-astra': 'gpt-6', 'gpt-6.1-sol': 'gpt-6', 'gpt-6.1-terra': 'gpt-6', 'gpt-6-sol': 'gpt-6', 'gpt-6-luna': 'gpt-6',
  'gpt-5.3-codex': 'gpt-5-codex',
  'gemini-3-pro-preview': 'gemini-3', 'gemini-3.1-pro-preview': 'gemini-3', 'gemini-3-flash-preview': 'gemini-3',
  'gemini-3.5-flash': 'gemini-3', 'gemini-3.6-flash': 'gemini-3', 'gemini-3.7-flash': 'gemini-3', 'gemini-3.8-flash': 'gemini-3',
  'kimi-k3': 'kimi-k3',
});

/** The built-in add-on folder, beside the built-in agents (the same URL math as plugin-manifest BUILTIN_AGENTS_DIR). */
export const ADDONS_DIR = fileURLToPath(new URL('../../agents/addons/', import.meta.url));

/** Test seam: when `dir` is set it replaces the default add-on folder. */
export const _testing = { dir: null };

const MODES = ['interactive', 'unattended'];
const MAX_FILE_BYTES = 2048;
// Up to 6 files of 2048 bytes and 5 blank-line separators.
const MAX_TEXT_CHARS = 12800;
// Anchored: the engine backtracks, so a dated id like claude-opus-4-20250514 reads as opus-4 (no family) and
// claude-opus-4-8-20260101 as opus-4-8. The optional date group is what lets dated ids resolve.
const FAMILY_RE = /^claude-(fable|opus|sonnet|haiku)-(\d+)(?:[-.](\d{1,2}))?(?:-\d{8})?$/;
// The add-on resolver's form: also Copilot's `-fast` variants (claude-opus-4.8-fast → opus-4-8).
const ADDON_FAMILY_RE = /^claude-(fable|opus|sonnet|haiku)-(\d+)(?:[-.](\d{1,2}))?(?:-fast)?(?:-\d{8})?$/;

// A per-agent file name part: a plain agent key, never a path (`../x` would read outside the add-on folder).
const AGENT_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/** The engine a spawn runs on: none named is claude. */
const normEngine = (engine) => engine || 'claude';

/**
 * Whether a spawn on this engine can carry an add-on at all: no engine named (claude) or any known engine. An unknown
 * name never reads a harness file. The model plays no part.
 * @param {{ engine?: string|null, model?: string|null }} [opts]
 */
export function engineTakesAddon({ engine } = {}) {
  return !engine || ADDON_ENGINES.includes(engine);
}

/** The rule before every engine took add-ons: the claude engine (or none named), or copilot with a claude-* wire
 *  model. resolveModelFamily (effort) keeps it, and a v1 pin (stored before the harness layer) resumes under it. */
function legacyEngineOk({ engine, model } = {}) {
  if (!engine || engine === 'claude') return true;
  if (engine !== 'copilot') return false;
  return typeof model === 'string' && copilotWireModel(model).toLowerCase().startsWith('claude-');
}

/**
 * The effort family of a model, or null (effort-intents.mjs): the claude-* rule as it was before add-ons covered every
 * engine, frozen so no effort fill changes. Bare aliases (opus, sonnet, …) resolve to null: the version they name
 * changes with the CLI. Only the claude engine (or none named) and copilot with a claude-* wire model are covered.
 * Add-ons use resolveAddonFamily.
 * @param {string|null|undefined} model the catalog handle
 * @param {{ engine?: string|null }} [opts]
 * @returns {string|null}
 */
export function resolveModelFamily(model, { engine } = {}) {
  if (typeof model !== 'string') return null;
  if (!legacyEngineOk({ engine, model })) return null;
  let id = engine === 'copilot' ? copilotWireModel(model) : model;
  id = id.trim().toLowerCase().replace(/\[1m\]$/, '');
  const m = FAMILY_RE.exec(id);
  if (!m) return null;
  const family = m[3] != null ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
  return LEGACY_FAMILIES.includes(family) ? family : null;
}

/**
 * The add-on (model layer) family of a model, or null. The id is lower-cased, loses a trailing `[1m]` and keeps the
 * text after its last `/` (`copilot/…`, `openai/…`, `openrouter/anthropic/…`); a claude-* id resolves by its version,
 * any other by MODEL_ID_FAMILIES. The engine plays no part: a model's habits travel with it to any harness. Bare
 * aliases resolve to null. Never throws.
 * @param {string|null|undefined} model the catalog handle
 * @param {{ engine?: string|null }} [_opts]
 * @returns {string|null}
 */
export function resolveAddonFamily(model, _opts = {}) {
  if (typeof model !== 'string') return null;
  let id = model.trim().toLowerCase().replace(/\[1m\]$/, '');
  id = id.slice(id.lastIndexOf('/') + 1);
  const m = ADDON_FAMILY_RE.exec(id);
  if (m) {
    const family = m[3] != null ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
    return ADDON_FAMILIES.includes(family) ? family : null;
  }
  return Object.hasOwn(MODEL_ID_FAMILIES, id) ? MODEL_ID_FAMILIES[id] : null;
}

/** A clarifier, or a step that may stop to ask, is interactive; every other step runs unattended. */
export function addonMode({ runnerType, questionsEnabled } = {}) {
  return runnerType === 'clarifier' || questionsEnabled === true ? 'interactive' : 'unattended';
}

/**
 * @typedef {{ v: 2, engine: string, harness: string|null, family: string|null, mode: 'interactive'|'unattended',
 *   files: string[], text: string, sha256: string }} PinnedAddon
 * `engine` is the spawn's engine (`claude` when none was named); `harness` is that engine when a harness file was read,
 * `family` the model family when a model file was read (at least one of the two). `files` are paths relative to the
 * add-on folder (`harness/codex.md`, `gpt-6.md`). A v1 record (`{ v: 1, family, mode, files, text, sha256 }`, stored by
 * runs before the harness layer) is still accepted on resume, under the legacy engine rule.
 */

/** Whether `<dir>/harness` is a real folder. Missing (or `dir` missing) is silent; a symlink, a file or an lstat error
 *  skips the layer with a warning. */
function harnessDirOk(dir, warnings) {
  let st;
  try { st = lstatSync(join(dir, 'harness')); } catch (err) {
    if (err?.code !== 'ENOENT' && err?.code !== 'ENOTDIR') warnings.push('model add-on folder "harness" skipped: unreadable');
    return false;
  }
  if (!st.isDirectory()) { warnings.push('model add-on folder "harness" skipped: not a directory'); return false; }
  return true;
}

/** One add-on file's trimmed text, '' when absent or empty, or null (with a warning) when it fails a check. */
function readAddonFile(dir, name, warnings) {
  const path = join(dir, name);
  let st;
  try { st = lstatSync(path); } catch (err) {
    if (err?.code !== 'ENOENT' && err?.code !== 'ENOTDIR') warnings.push(`model add-on "${name}" skipped: unreadable`);
    return '';
  }
  if (!st.isFile()) { warnings.push(`model add-on "${name}" skipped: not a regular file`); return ''; }
  if (st.size > MAX_FILE_BYTES) { warnings.push(`model add-on "${name}" skipped: over ${MAX_FILE_BYTES} bytes`); return ''; }
  try { return readFileSync(path, 'utf8').trim(); } catch {
    warnings.push(`model add-on "${name}" skipped: unreadable`);
    return '';
  }
}

/**
 * Resolve the add-on for one spawn session: the harness layer of the engine, then the model layer of the model's
 * family. Never throws: a file that fails a check is skipped with a warning. An unknown engine reads no file at all.
 * @param {{ model?: string|null, engine?: string|null, agentKey?: string|null, mode?: string, dir?: string }} opts
 * @returns {{ addon: PinnedAddon|null, warnings: string[] }}
 */
export function resolveAddon({ model, engine, agentKey, mode, dir = _testing.dir || ADDONS_DIR } = {}) {
  const warnings = [];
  if (!engineTakesAddon({ engine })) return { addon: null, warnings };
  const eng = normEngine(engine);
  const m = mode === 'interactive' ? 'interactive' : 'unattended';
  const key = typeof agentKey === 'string' && AGENT_KEY_RE.test(agentKey) && agentKey !== 'unattended' ? agentKey : null;
  const files = [];
  const parts = [];
  /** Reads one layer's files (base, unattended, per-agent) under `prefix`; true when any had text. */
  const readLayer = (prefix, base) => {
    const names = [`${base}.md`];
    if (m === 'unattended') names.push(`${base}.unattended.md`);
    if (key) names.push(`${base}.${key}.md`);
    let found = false;
    for (const name of names.map((n) => `${prefix}${n}`)) {
      let text = '';
      try { text = readAddonFile(dir, name, warnings); } catch { warnings.push(`model add-on "${name}" skipped: unreadable`); }
      if (text) { files.push(name); parts.push(text); found = true; }
    }
    return found;
  };
  let harness = null;
  try { if (harnessDirOk(dir, warnings) && readLayer('harness/', eng)) harness = eng; } catch { warnings.push('model add-on folder "harness" skipped: unreadable'); }
  const resolved = resolveAddonFamily(model, { engine });
  const family = resolved && readLayer('', resolved) ? resolved : null;
  if (!parts.length) return { addon: null, warnings };
  const text = parts.join('\n\n');
  return { addon: { v: 2, engine: eng, harness, family, mode: m, files, text, sha256: sha256(text) }, warnings };
}

/** The system prompt with the add-on as its last part; the SAME string when there is no add-on. */
export function appendAddon(systemPrompt, addon) {
  const text = addon && typeof addon.text === 'string' ? addon.text : '';
  if (!text) return systemPrompt;
  return systemPrompt ? `${systemPrompt}\n\n${text}` : text;
}

/** The shape check a resume applies to a pinned record (v1 or v2). The sha256 is unkeyed: a corruption check, not
 *  authentication. */
export function isPinnedAddon(x) {
  if (!x || typeof x !== 'object') return false;
  if (x.v !== 1 && x.v !== 2) return false;
  if (typeof x.text !== 'string' || !x.text || x.text.length > MAX_TEXT_CHARS) return false;
  if (typeof x.sha256 !== 'string' || x.sha256 !== sha256(x.text)) return false;
  if (!MODES.includes(x.mode)) return false;
  if (!Array.isArray(x.files) || !x.files.every((f) => typeof f === 'string')) return false;
  if (x.v === 1) return ADDON_FAMILIES.includes(x.family);
  if (!ADDON_ENGINES.includes(x.engine)) return false;
  if (x.harness !== null && x.harness !== x.engine) return false;
  if (x.family !== null && !ADDON_FAMILIES.includes(x.family)) return false;
  return x.harness !== null || x.family !== null;
}

/**
 * Whether a resume may send this pin: a valid record, and a v2 pin only on the engine it was chosen for (a step resumed
 * on another engine starts a fresh session there); a v1 pin only under the legacy rule (claude, or copilot on a
 * claude-* wire model), so a run paused before the harness layer resumes exactly as before.
 * @param {unknown} pin
 * @param {{ engine?: string|null, model?: string|null }} [spawn]
 */
export function pinFitsSpawn(pin, { engine, model } = {}) {
  if (!isPinnedAddon(pin)) return false;
  return pin.v === 1 ? legacyEngineOk({ engine, model }) : pin.engine === normEngine(engine);
}
