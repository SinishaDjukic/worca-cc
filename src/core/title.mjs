// src/core/title.mjs
import { runClaude } from './claude-runner.mjs';
import { resolveModelEnv } from './config.mjs';

// A fast, cheap model is enough for a one-line summary. Overridable for tests/cost tuning.
const DEFAULT_TITLE_MODEL =
  process.env.WORCA_TITLE_MODEL || 'claude-haiku-4-5-20251001';
const MAX_LEN = 70;

const SYSTEM = [
  'You write a SHORT, human-readable title for a software task.',
  'Rules: 3–8 words, Title Case-ish, no trailing period, no quotes, no markdown,',
  'no preamble. Output ONLY the title on a single line.',
  'Never ask questions, never ask for more context, never apologize or explain.',
  'If the task is vague or conversational, still output your best-guess topic title.',
].join(' ');

/** Normalize raw model output into a safe single-line title (pure, exported for tests). */
export function sanitizeTitle(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let t = raw.replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, '')); // drop fence markers
  t = t.split(/\r?\n/).map((l) => l.trim()).find((l) => l) || '';        // first non-empty line
  t = t.replace(/^(?:title|task)\s*[:\-]\s*/i, '');                      // strip "Title:"/"Task:" label
  t = t.replace(/^["'“”`]+|["'“”`]+$/g, '').trim();                      // strip wrapping quotes/backticks
  t = t.replace(/\s+/g, ' ').replace(/\.+$/, '').trim();                 // collapse ws, drop trailing dots
  if (t.length > MAX_LEN) {
    // Cut at a word boundary instead of mid-word ("…you'd li"). The window is
    // MAX_LEN+1 so a word ending exactly at the cap survives; a boundary too
    // close to the start (or none at all — one unbroken run) hard-slices.
    const cut = t.slice(0, MAX_LEN + 1);
    const sp = cut.lastIndexOf(' ');
    t = (sp >= 30 ? cut.slice(0, sp) : t.slice(0, MAX_LEN)).replace(/[\s,;:–—-]+$/, '');
  }
  return t.trim();
}

// A title that is really a clarifying question / refusal ("I need more context
// to write a title…"). First-person or plea openers, a trailing question mark,
// or prose far beyond the 3–8-word instruction all mean the model did not
// title the task — the caller should keep its provisional title instead.
// Narrow on purpose (review of PR #376): bare `what`/`which`/`unable`/`please`
// openers dropped legitimate titles ("What's New Page Redesign", "Which Tab Is
// Active Indicator", "Unable To Login Error Fix", "Please Wait Spinner Timing").
// A question is caught by its trailing `?` above; `unable`/`please` count only
// with the verbs a refusal actually uses.
const REFUSAL_OPENER_RE =
  /^(?:i(?:['’](?:m|d|ll|ve))?\s|sorry\b|apolog|unfortunately\b|unable to (?:determine|identify|generate|create|provide|write|title|summari[sz]e|infer|tell|help|assist)\b|please (?:provide|share|clarify|give|specify|tell|include|describe|let me know)\b|could you\b|can you\b|tell me\b|what(?:['’]s)? (?:is|are|was|were|do|does|did|would|should|task|work)\b|which (?:task|one|of)\b|help me\b)/i;
const MAX_WORDS = 12;

/** True when sanitized model output looks like a refusal/question, not a title (pure, exported for tests). */
export function isRefusalTitle(t) {
  if (!t || typeof t !== 'string') return false;
  if (/\?$/.test(t)) return true;
  if (REFUSAL_OPENER_RE.test(t)) return true;
  return t.split(' ').length > MAX_WORDS;
}

/**
 * Produce a concise LLM title for a prompt. Never throws — returns '' on any
 * failure/abort/empty input so the caller keeps the provisional title.
 * `permissionMode` (default 'acceptEdits') exists for Ask Worca: its title call
 * passes 'dontAsk' so the mock dispatcher can never reach a file-writing role.
 * @param {string} prompt
 * @param {{cwd:string, signal?:AbortSignal, model?:string, bin?:string, mock?:boolean, envScrub?:boolean, envAllowlist?:string[], tools?:string[], strictMcpConfig?:boolean, settingSources?:string[], disableSlashCommands?:boolean, mcpConfigPath?:string, permissionMode?:string}} opts
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
      // Aux calls keep their model choice but still route through the catalog's
      // env (design §4.8) — a global entry matching this id carries its routing
      // env everywhere the id is used.
      modelEnv: resolveModelEnv(opts.model || DEFAULT_TITLE_MODEL),
      effort: 'low',
      permissionMode: opts.permissionMode || 'acceptEdits',
      allowedTools: [],            // empty → no --allowedTools flag → claude defaults; pure text gen
      signal: opts.signal,
      // Title generation runs DURING a pipeline run, so it must honor the same
      // guardrails as the run itself. All three are undefined when absent, and
      // runClaude treats undefined as "not passed" — existing callers are unchanged.
      bin: opts.bin,
      // A run configured with claude:{mock:true} (tests, `--mock`) must title
      // through runMock too: runClaude decides mock-vs-real from THIS field or
      // WORCA_MOCK, and the 29 test files that only pass the option spawned the
      // developer's real binary 157x per `npm test` (2026-08-30).
      mock: opts.mock,
      envScrub: opts.envScrub,
      envAllowlist: opts.envAllowlist,
      // Ask Worca (ask-worca-design.md §6.8): sandbox hardening pass-through for the
      // chat's background title call. All undefined for every existing caller, and
      // runClaude emits nothing for undefined — pipeline title argv is unchanged.
      tools: opts.tools,
      strictMcpConfig: opts.strictMcpConfig,
      settingSources: opts.settingSources,
      disableSlashCommands: opts.disableSlashCommands,
      mcpConfigPath: opts.mcpConfigPath,
      onEvent: () => {},
    });
    const title = sanitizeTitle(out);
    return isRefusalTitle(title) ? '' : title;
  } catch (err) {
    if (err && err.name === 'AbortError') return ''; // run was stopped — caller keeps provisional
    return '';
  }
}
