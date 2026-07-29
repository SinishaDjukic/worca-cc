// src/core/title.mjs
import { runClaude } from './claude-runner.mjs';

// A fast, cheap model is enough for a one-line summary. Overridable for tests/cost tuning.
const DEFAULT_TITLE_MODEL =
  process.env.WORCA_TITLE_MODEL || 'claude-haiku-4-5-20251001';
const MAX_LEN = 70;

const SYSTEM = [
  'You write a SHORT, human-readable title for a software task.',
  'Rules: 3–8 words, Title Case-ish, no trailing period, no quotes, no markdown,',
  'no preamble. Output ONLY the title on a single line.',
].join(' ');

/** Normalize raw model output into a safe single-line title (pure, exported for tests). */
export function sanitizeTitle(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let t = raw.replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, '')); // drop fence markers
  t = t.split(/\r?\n/).map((l) => l.trim()).find((l) => l) || '';        // first non-empty line
  t = t.replace(/^(?:title|task)\s*[:\-]\s*/i, '');                      // strip "Title:"/"Task:" label
  t = t.replace(/^["'“”`]+|["'“”`]+$/g, '').trim();                      // strip wrapping quotes/backticks
  t = t.replace(/\s+/g, ' ').replace(/\.+$/, '').trim();                 // collapse ws, drop trailing dots
  return t.slice(0, MAX_LEN).trim();
}

/**
 * Produce a concise LLM title for a prompt. Never throws — returns '' on any
 * failure/abort/empty input so the caller keeps the provisional title.
 * @param {string} prompt
 * @param {{cwd:string, signal?:AbortSignal, model?:string}} opts
 * @returns {Promise<string>}
 */
export async function generateTitle(prompt, opts = {}) {
  const text = String(prompt || '').trim();
  if (!text) return '';
  try {
    const { text: out } = await runClaude({
      cwd: opts.cwd || process.cwd(),
      systemPrompt: SYSTEM,
      prompt: `Write the title for this task:\n\n${text.slice(0, 4000)}`,
      model: opts.model || DEFAULT_TITLE_MODEL,
      effort: 'low',
      permissionMode: 'acceptEdits',
      allowedTools: [],            // empty → no --allowedTools flag → claude defaults; pure text gen
      signal: opts.signal,
      onEvent: () => {},
    });
    return sanitizeTitle(out);
  } catch (err) {
    if (err && err.name === 'AbortError') return ''; // run was stopped — caller keeps provisional
    return '';
  }
}
