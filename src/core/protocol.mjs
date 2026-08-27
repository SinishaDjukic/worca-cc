// src/core/protocol.mjs
// JSON contracts + validators shared by agents and the orchestrator.
//
// All readers are tolerant: a missing or malformed file yields a safe empty
// shape rather than throwing. Writers serialize canonical JSON shapes that the
// agent prompts (agents/*.md) are instructed to produce.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The verdict vocabulary lives in the browser-safe shared core (this module
// imports node:fs/promises and can never be loaded in a browser); re-exported
// here so every existing importer of protocol.mjs keeps working unchanged.
export {
  SEVERITIES, BLOCKING, normalizeSeverity, hasBlocking, blockingIssues,
} from '../shared/graph/verdict.mjs';
import { normalizeSeverity } from '../shared/graph/verdict.mjs';

/** Coerce any value to a trimmed string (empty string for null/undefined). */
function asString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Tolerant JSON parser.
 * - Accepts plain JSON.
 * - Strips ```json ... ``` (or bare ``` ... ```) fences.
 * - Falls back to extracting the first balanced {...} object found in the text
 *   (handles models that wrap JSON in prose).
 * Returns the parsed object/array, or null if nothing parseable is found.
 *
 * @param {string} text
 * @returns {object|Array|null}
 */
export function safeParseJson(text) {
  if (text === null || text === undefined) return null;
  let raw = String(text).trim();
  if (!raw) return null;

  // 1) Direct parse.
  const direct = tryParse(raw);
  if (direct !== undefined) return direct;

  // 2) Strip code fences (```json\n...\n``` or ```\n...\n```).
  const fence = raw.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence && fence[1]) {
    const inner = tryParse(fence[1].trim());
    if (inner !== undefined) return inner;
    raw = fence[1].trim();
  }

  // 3) Find the first balanced JSON object or array in the remaining text.
  const balanced = extractFirstBalanced(raw);
  if (balanced !== null) {
    const parsed = tryParse(balanced);
    if (parsed !== undefined) return parsed;
  }

  return null;
}

function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/**
 * Scan `text` for the first balanced {...} or [...] region, respecting strings
 * and escapes so braces inside string literals do not confuse the matcher.
 * Returns the substring (inclusive of the delimiters) or null.
 */
function extractFirstBalanced(text) {
  const startIdx = firstIndexOfEither(text, '{', '[');
  if (startIdx === -1) return null;

  const open = text[startIdx];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return text.slice(startIdx, i + 1);
      }
    }
  }
  return null;
}

function firstIndexOfEither(text, a, b) {
  const ia = text.indexOf(a);
  const ib = text.indexOf(b);
  if (ia === -1) return ib;
  if (ib === -1) return ia;
  return Math.min(ia, ib);
}

// Hard caps so a single clarify round can never overwhelm the user, regardless of
// what the clarify agent emits. Tunable; pairs with the prompt guidance in
// agents/worca-cc-clarify.md (up to 8 questions, 2–4 options each).
const MAX_CLARIFY_QUESTIONS = 8;
const MAX_CLARIFY_OPTIONS = 4;

/**
 * Coerce arbitrary parsed data into the canonical clarify shape:
 *   { questions: [ { id, question, options:[2–4 strings], allowFreeText:true } ] }
 * Always returns at least { questions: [] }. Caps questions at MAX_CLARIFY_QUESTIONS
 * and options at MAX_CLARIFY_OPTIONS; blank options are trimmed away (the UI/CLI also
 * filter them), so binary/assumption questions keep exactly their real choices —
 * nothing is padded.
 */
export function normalizeClarify(data) {
  if (!data || typeof data !== 'object') return { questions: [] };
  const list = Array.isArray(data.questions) ? data.questions : [];
  const questions = [];
  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    if (!q || typeof q !== 'object') continue;
    const id = asString(q.id).trim() || `q${i + 1}`;
    const question = asString(q.question).trim();
    if (!question) continue;
    // Allow 2–4 options: trim, drop blanks, cap at MAX_CLARIFY_OPTIONS. No padding.
    // asString does not trim, so trim explicitly here before dropping empties.
    const options = (Array.isArray(q.options) ? q.options.map(asString) : [])
      .map((o) => o.trim())
      .filter(Boolean)
      .slice(0, MAX_CLARIFY_OPTIONS);
    questions.push({ id, question, options, allowFreeText: true });
  }
  return { questions: questions.slice(0, MAX_CLARIFY_QUESTIONS) };
}

/**
 * Read clarify.json from a pipeline directory. Missing/invalid => { questions: [] }.
 * @param {string} pipelineDir
 * @returns {Promise<{questions: Array}>}
 */
export async function readClarify(pipelineDir) {
  const file = join(pipelineDir, 'clarify.json');
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return { questions: [] };
  }
  const parsed = safeParseJson(text);
  return normalizeClarify(parsed);
}

/**
 * Read one ask-then-resume questions file (per-step user questions, spec
 * 2026-07-11) from an ABSOLUTE path. Same schema, caps, and tolerance as
 * clarify.json. Missing file => { questions: [], malformed: false } (the agent
 * chose not to ask); present-but-unparseable => malformed: true so the caller
 * can audit-warn while proceeding.
 * @param {string} absPath
 * @returns {Promise<{questions: Array, malformed: boolean}>}
 */
export async function readQuestionsFile(absPath) {
  let text;
  try {
    text = await readFile(absPath, 'utf8');
  } catch {
    return { questions: [], malformed: false };
  }
  const parsed = safeParseJson(text);
  if (parsed === null) return { questions: [], malformed: true };
  return { ...normalizeClarify(parsed), malformed: false };
}

/**
 * Coerce arbitrary parsed data into the canonical review shape:
 *   { issues: [ { severity, title, detail, location } ], summary }
 * Always returns { issues: [], summary: '' } on bad input.
 */
function normalizeReview(data) {
  if (!data || typeof data !== 'object') return { issues: [], summary: '' };
  const list = Array.isArray(data.issues) ? data.issues : [];
  const issues = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    issues.push({
      severity: normalizeSeverity(it.severity),
      title: asString(it.title).trim(),
      detail: asString(it.detail).trim(),
      location: asString(it.location).trim(),
    });
  }
  return { issues, summary: asString(data.summary).trim() };
}

/**
 * Read a review JSON file from an absolute path.
 * Missing/invalid => { issues: [], summary: '' }.
 * @param {string} jsonPath
 * @returns {Promise<{issues: Array, summary: string}>}
 */
export async function readReview(jsonPath) {
  let text;
  try {
    text = await readFile(jsonPath, 'utf8');
  } catch {
    return { issues: [], summary: '' };
  }
  return normalizeReview(safeParseJson(text));
}
