// src/core/model-addons.mjs — per-model-family prompt add-ons: a short, model-specific correction appended after the
// shared agent prompt (executor.mjs prepare()). This is the ONE module that maps a model id to an add-on family.
//
// Files live in agents/addons/ and are read in this order, each only when it exists:
//   <family>.md             every mode
//   <family>.unattended.md  unattended steps only (keep-going and don't-ask text lives here)
//   <family>.<agentKey>.md  every mode, for that agent only (`unattended` is never an agent key)
// They are joined by a blank line. A family with no files gets no add-on, and so a byte-identical prompt.
// A resumed step never comes here: it sends the add-on its first turn pinned (isPinnedAddon checks the record).
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { copilotWireModel } from './model-env.mjs';

/** The families that have add-on files. Any other family (claude-opus-4-7, …) resolves to null. */
export const ADDON_FAMILIES = Object.freeze([
  'fable-5-2', 'fable-5-1', 'fable-5', 'opus-5-5', 'opus-5', 'opus-4-8', 'sonnet-5-5', 'sonnet-5', 'haiku-5-5',
]);

/** The built-in add-on folder, beside the built-in agents (the same URL math as plugin-manifest BUILTIN_AGENTS_DIR). */
export const ADDONS_DIR = fileURLToPath(new URL('../../agents/addons/', import.meta.url));

/** Test seam: when `dir` is set it replaces the default add-on folder. */
export const _testing = { dir: null };

const MODES = ['interactive', 'unattended'];
const MAX_FILE_BYTES = 2048;
const MAX_TEXT_CHARS = 6400;
// Anchored: the engine backtracks, so a dated id like claude-opus-4-20250514 reads as opus-4 (no family) and
// claude-opus-4-8-20260101 as opus-4-8. The optional date group is what lets dated ids resolve.
const FAMILY_RE = /^claude-(fable|opus|sonnet|haiku)-(\d+)(?:[-.](\d{1,2}))?(?:-\d{8})?$/;

// A per-agent file name part: a plain agent key, never a path (`../x` would read outside the add-on folder).
const AGENT_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * Whether a spawn on this engine can carry an add-on at all: the claude engine (or none named), or copilot with a
 * claude-* wire model. A resume checks it too: a paused claude step resumed on another engine starts a fresh session
 * there, which must not get the Claude-family pin.
 * @param {{ engine?: string|null, model?: string|null }} [opts]
 */
export function engineTakesAddon({ engine, model } = {}) {
  if (!engine || engine === 'claude') return true;
  if (engine !== 'copilot') return false;
  return typeof model === 'string' && copilotWireModel(model).toLowerCase().startsWith('claude-');
}

/**
 * The add-on family of a model, or null. Bare aliases (opus, sonnet, …) resolve to null: the version they name changes
 * with the CLI. Only the claude engine (or none named) and copilot with a claude-* wire model are covered.
 * @param {string|null|undefined} model the catalog handle
 * @param {{ engine?: string|null }} [opts]
 * @returns {string|null}
 */
export function resolveModelFamily(model, { engine } = {}) {
  if (typeof model !== 'string') return null;
  if (!engineTakesAddon({ engine, model })) return null;
  let id = engine === 'copilot' ? copilotWireModel(model) : model;
  id = id.trim().toLowerCase().replace(/\[1m\]$/, '');
  const m = FAMILY_RE.exec(id);
  if (!m) return null;
  const family = m[3] != null ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
  return ADDON_FAMILIES.includes(family) ? family : null;
}

/** A clarifier, or a step that may stop to ask, is interactive; every other step runs unattended. */
export function addonMode({ runnerType, questionsEnabled } = {}) {
  return runnerType === 'clarifier' || questionsEnabled === true ? 'interactive' : 'unattended';
}

/**
 * @typedef {{ v: 1, family: string, mode: 'interactive'|'unattended', files: string[], text: string, sha256: string }} PinnedAddon
 * `files` holds basenames only.
 */

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
 * Resolve the add-on for one spawn session. Never throws: a file that fails a check is skipped with a warning.
 * @param {{ model?: string|null, engine?: string|null, agentKey?: string|null, mode?: string, dir?: string }} opts
 * @returns {{ addon: PinnedAddon|null, warnings: string[] }}
 */
export function resolveAddon({ model, engine, agentKey, mode, dir = _testing.dir || ADDONS_DIR } = {}) {
  const warnings = [];
  const family = resolveModelFamily(model, { engine });
  if (!family) return { addon: null, warnings };
  const m = mode === 'interactive' ? 'interactive' : 'unattended';
  const names = [`${family}.md`];
  if (m === 'unattended') names.push(`${family}.unattended.md`);
  if (typeof agentKey === 'string' && AGENT_KEY_RE.test(agentKey) && agentKey !== 'unattended') names.push(`${family}.${agentKey}.md`);
  const files = [];
  const parts = [];
  for (const name of names) {
    let text = '';
    try { text = readAddonFile(dir, name, warnings); } catch { warnings.push(`model add-on "${name}" skipped: unreadable`); }
    if (text) { files.push(name); parts.push(text); }
  }
  if (!parts.length) return { addon: null, warnings };
  const text = parts.join('\n\n');
  return { addon: { v: 1, family, mode: m, files, text, sha256: sha256(text) }, warnings };
}

/** The system prompt with the add-on as its last part; the SAME string when there is no add-on. */
export function appendAddon(systemPrompt, addon) {
  const text = addon && typeof addon.text === 'string' ? addon.text : '';
  if (!text) return systemPrompt;
  return systemPrompt ? `${systemPrompt}\n\n${text}` : text;
}

/** The shape check a resume applies to a pinned record. The sha256 is unkeyed: a corruption check, not authentication. */
export function isPinnedAddon(x) {
  if (!x || typeof x !== 'object') return false;
  if (x.v !== 1) return false;
  if (typeof x.text !== 'string' || !x.text || x.text.length > MAX_TEXT_CHARS) return false;
  if (typeof x.sha256 !== 'string' || x.sha256 !== sha256(x.text)) return false;
  if (!ADDON_FAMILIES.includes(x.family) || !MODES.includes(x.mode)) return false;
  return Array.isArray(x.files) && x.files.every((f) => typeof f === 'string');
}
