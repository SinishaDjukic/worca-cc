// src/core/title.mjs
import { runClaude } from './claude-runner.mjs';
import { resolveModelEnv, catalogHasModel } from './config.mjs';
import { titleModel as storedTitleModel } from './settings.mjs';
import { AUX_EFFORT } from './model-env.mjs';

// The last-resort title model: the BUILT-IN Haiku id (config.mjs PREDEFINED_MODELS),
// not the dated API id it used to be — a global entry that shadows the built-in
// (to route it) must match, or its routing env would never reach a title call.
export const DEFAULT_TITLE_MODEL = 'claude-haiku-4-5';
const MAX_LEN = 70;

/**
 * Which model writes a title, decided PER CALL (#422) — nothing is captured at
 * import, so a Settings save or an env change reaches the very next title:
 *   1. `opts.model`            — an explicit caller choice
 *   2. WORCA_TITLE_MODEL       — a non-empty env override (tests, cost tuning);
 *                                verbatim, no catalog check: an operator escape hatch
 *   3. the stored `titleModel` — only while it is still a catalog member; a stale
 *                                id (plugin removed, entry deleted) is reported and skipped
 *   4. `opts.runModel`         — the model of the run / chat that asked for the title,
 *                                which is what makes an install with NO first-party
 *                                model produce titles with zero configuration
 *   5. DEFAULT_TITLE_MODEL     — the built-in Haiku
 * Pure apart from the injectable readers. Exported for tests and for the
 * settings API (describeTitleModel below).
 * @param {{model?:string, runModel?:string}} [opts]
 * @param {{env?:NodeJS.ProcessEnv, stored?:()=>string|null, inCatalog?:(id:string)=>boolean}} [deps]
 * @returns {{model:string, source:'explicit'|'env'|'settings'|'run'|'builtin', stale:string|null}}
 */
export function resolveTitleModel(opts = {}, { env = process.env, stored = storedTitleModel, inCatalog = catalogHasModel } = {}) {
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const explicit = str(opts.model);
  if (explicit) return { model: explicit, source: 'explicit', stale: null };
  const fromEnv = str(env.WORCA_TITLE_MODEL);
  if (fromEnv) return { model: fromEnv, source: 'env', stale: null };
  let stale = null;
  const configured = str(stored());
  if (configured) {
    if (inCatalog(configured)) return { model: configured, source: 'settings', stale: null };
    stale = configured;
  }
  const runModel = str(opts.runModel);
  if (runModel) return { model: runModel, source: 'run', stale };
  return { model: DEFAULT_TITLE_MODEL, source: 'builtin', stale };
}

/**
 * What the Settings card shows: the stored id, whether the environment
 * overrides it, and a stale stored id that no longer resolves. `model` is
 * null when titles follow the run's model (the default).
 * @returns {{model:string|null, source:'env'|'settings'|'run', stale:string|null}}
 */
export function describeTitleModel(deps) {
  const r = resolveTitleModel({}, deps);
  if (r.source === 'env' || r.source === 'settings') return { model: r.model, source: r.source, stale: null };
  return { model: null, source: 'run', stale: r.stale };
}

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
 * `runModel` is the model of the run/chat asking (resolveTitleModel step 4).
 * `onError` fires ONCE when the call yields no usable title for any reason but
 * an abort (a spawn failure, a refusal, an empty reply) — the caller logs it on
 * its own channel; the return value stays '' so every existing caller is unchanged.
 * @param {string} prompt
 * @param {{cwd:string, signal?:AbortSignal, model?:string, runModel?:string, onError?:(info:{model:string, error:Error})=>void, bin?:string, mock?:boolean, envScrub?:boolean, envAllowlist?:string[], tools?:string[], strictMcpConfig?:boolean, settingSources?:string[], disableSlashCommands?:boolean, mcpConfigPath?:string, permissionMode?:string}} opts
 * @returns {Promise<string>}
 */
export async function generateTitle(prompt, opts = {}) {
  const text = String(prompt || '').trim();
  if (!text) return '';
  const { model, stale } = resolveTitleModel(opts);
  if (stale) console.warn(`[worca] titleModel ${JSON.stringify(stale)} is no longer in the catalog — titles use ${model}`);
  const report = (error) => {
    if (typeof opts.onError !== 'function') return;
    try { opts.onError({ model, error }); } catch { /* a logging sink must never fail the caller */ }
  };
  try {
    const { text: out } = await runClaude({
      cwd: opts.cwd || process.cwd(),
      systemPrompt: SYSTEM,
      prompt: `Write the title for this task:\n\n${text.slice(0, 4000)}`,
      model,
      // Aux calls keep their model choice but still route through the catalog's
      // env (design §4.8) — a global entry matching this id carries its routing
      // env everywhere the id is used.
      modelEnv: resolveModelEnv(model),
      effort: AUX_EFFORT,
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
    if (!title) { report(new Error('the model returned an empty reply')); return ''; }
    if (isRefusalTitle(title)) { report(new Error(`the model did not write a title: ${title.slice(0, 120)}`)); return ''; }
    return title;
  } catch (err) {
    if (err && err.name === 'AbortError') return ''; // run was stopped — caller keeps provisional
    report(err instanceof Error ? err : new Error(String(err)));
    return '';
  }
}
