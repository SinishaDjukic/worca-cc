// src/core/ask/suggest.mjs
// Ask Worca's next-prompt suggestion: after a finished reply, one cheap, tool-less, out-of-turn call writes the
// short prompt the user is likely to send next (the composer shows it as ghost text). Live-only: never stored.
// One call per thread at a time — a newer one, or a new turn on the thread, aborts the older one.
import { auxTextCall, DEFAULT_TITLE_MODEL, modelReady } from '../title.mjs';
import { catalogHasModel } from '../config.mjs';

export const SUGGESTION_TIMEOUT_MS = 30_000;
/** Codex's suggestion model: the cheapest priced gpt-5.6 model (list-prices.mjs). */
export const CODEX_SUGGESTION_MODEL = 'gpt-5.6-luna';
const MAX_LEN = 80;
const MAX_WORDS = 12;

const SYSTEM = [
  "You suggest the user's NEXT message in a chat with Worca's assistant.",
  'Output ONE short prompt the user is likely to send next, written as the user speaking to the assistant,',
  "2-8 words, on a single line, no quotes, no markdown, no trailing period (e.g. 'Start the run', 'Open a PR', 'Show the failing test').",
  'It must follow from the last exchange. If no follow-up is clearly useful, output NONE.',
  'Never explain, never apologize, never ask the user a question about the task itself.',
].join(' ');

/** The fixed cheap model per engine: Haiku on Claude while it is in the catalog and ready (else null: no
 *  suggestion — never the chat's own, possibly expensive, model), the small model on Codex. Copilot: none — every
 *  copilot call spends a premium request, and a Copilot chat makes no Claude call. */
export function suggestionModel(engine, { inCatalog = (id) => catalogHasModel(id, { engine: 'claude' }), ready = modelReady } = {}) {
  if (engine === 'codex') return CODEX_SUGGESTION_MODEL;
  if (engine === 'copilot') return null;
  try { return inCatalog(DEFAULT_TITLE_MODEL) && ready(DEFAULT_TITLE_MODEL) ? DEFAULT_TITLE_MODEL : null; } catch { return null; }
}

const REFUSAL_RE = /^(?:none\b|n\/a\b|i(?:['’](?:m|d|ll|ve))?\s|sorry\b|apolog|unfortunately\b|as an ai\b)/i;

/** Raw model output → one short single-line prompt, or '' (pure, exported for tests). */
export function sanitizeSuggestion(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let t = raw.replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''));   // drop fence markers
  t = t.split(/\r?\n/).map((l) => l.trim()).find((l) => l) || '';          // first non-empty line
  t = t.replace(/^(?:suggestion|next(?: prompt)?|prompt|user)\s*[:\-]\s*/i, '');   // strip a "Suggestion:" label
  t = t.replace(/^["'“”`]+|["'“”`]+$/g, '').trim();                        // strip wrapping quotes/backticks
  t = t.replace(/\s+/g, ' ').replace(/\.+$/, '').trim();                   // collapse ws, drop trailing dots
  if (!t || REFUSAL_RE.test(t) || t.split(' ').length > MAX_WORDS) return '';
  if (t.length > MAX_LEN) {
    // Cut at a word boundary, like sanitizeTitle.
    const cut = t.slice(0, MAX_LEN + 1);
    const sp = cut.lastIndexOf(' ');
    t = (sp >= 20 ? cut.slice(0, sp) : t.slice(0, MAX_LEN)).replace(/[\s,;:–—-]+$/, '');
  }
  return t;
}

/** The call's prompt: the last exchange, both sides clipped (the reply's tail is what the next step follows). */
export function suggestionPrompt(userText, replyText) {
  const user = String(userText || '').trim().slice(0, 2000);
  const reply = String(replyText || '').trim();
  const tail = reply.length > 4000 ? reply.slice(-4000) : reply;
  return `The user wrote:\n${user || '(nothing)'}\n\nThe assistant replied:\n${tail}\n\nWrite the user's next message.`;
}

/**
 * One suggestion. Never throws: '' on an empty reply, no model, a failure, an abort or a refusal.
 * opts: the aux-call options (cwd, signal, onCost, permissionMode, tools…), plus `model` (required),
 * `engine` ('codex' | anything else = Claude) and `onError(err)` — called once for a failure that is not an abort.
 * @returns {Promise<string>}
 */
export async function generateSuggestion({ userText, replyText }, opts = {}) {
  if (!String(replyText || '').trim() || !opts.model) return '';
  try {
    const out = await auxTextCall({
      systemPrompt: SYSTEM,
      prompt: suggestionPrompt(userText, replyText),
      model: opts.model,
      engine: opts.engine === 'codex' ? 'codex' : null,
    }, opts);
    return sanitizeSuggestion(out);
  } catch (err) {
    if (err?.name !== 'AbortError' && typeof opts.onError === 'function') { try { opts.onError(err); } catch { /* a log sink never fails */ } }
    return '';
  }
}

// ---- one in-flight suggestion per thread --------------------------------------------------------------------
const pending = new Map();   // threadId → AbortController

/** Start a suggestion for `threadId`: aborts the thread's older one. */
export function claimSuggestion(threadId) {
  cancelSuggestion(threadId);
  const c = new AbortController();
  pending.set(threadId, c);
  return c;
}
/** A finished call lets go of its slot (only its own: a newer claim may own it already). */
export function releaseSuggestion(threadId, c) {
  if (pending.get(threadId) === c) pending.delete(threadId);
}
/** A new turn on the thread (or its deletion): the suggestion being written is stale. */
export function cancelSuggestion(threadId) {
  const c = pending.get(threadId);
  if (!c) return;
  pending.delete(threadId);
  try { c.abort(); } catch { /* already aborted */ }
}
