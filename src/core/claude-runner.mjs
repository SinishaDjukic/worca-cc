// src/core/claude-runner.mjs
// Spawn Claude Code headless and stream its events, with a fully offline MOCK
// mode that performs the same role-appropriate side effects so the whole
// pipeline can run end-to-end without spawning claude or spending tokens.
//
// ── MOCK MARKER PROTOCOL (shared with phases.mjs) ────────────────────────────
// In mock mode the runner does not call any model. Instead it reads simple
// markers embedded (one per line) in the `prompt` (and, as a fallback, the
// `systemPrompt`). The phases layer is responsible for emitting these markers.
//
//   MOCK_ROLE: <role>      one of:
//                            clarify | planner-plan |
//                            refiner | implementer | reviewer
//   MOCK_OUT: <path>       primary output artifact path (absolute)
//                          - clarify : clarify.json path
//                          - planner-plan    : plan .md path
//                          - refiner         : output -vN plan .md path
//                          - reviewer        : review .md path
//   MOCK_JSON: <path>      review json path (refiner + reviewer)
//   MOCK_CYCLE: <n>        loop cycle number (refiner + reviewer)
//   MOCK_IN: <path>        input plan path (refiner; optional, used to seed -vN)
//   MOCK_BASE: <name>      base slug (optional, used for nicer mock content)
//   MOCK_ASK: <path>       ask-then-resume questions file (per-step user
//                          questions). When present the mock writes ONE canned
//                          question there and STOPS (no role side effects); the
//                          resumed prompt carries no MOCK_ASK, so the role arm
//                          runs then.
//
// Markers are matched leniently: "KEY: value" anywhere at the start of a line,
// case-sensitive keys, value trimmed. Missing markers degrade gracefully.
// The mock is deterministic: blocking-issue counts decrease with cycle so the
// orchestrator's refine/review loops always terminate.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { prepareModelEnv } from './model-env.mjs';
import { classifyError, strongestClass } from './recoverable-error.mjs';
import { explainUnspawnableClaude, resolveClaudeBin } from './preflight.mjs';
import { writeFile, mkdir, appendFile, readFile, access } from 'node:fs/promises';
import { constants as FS, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const DEFAULT_BIN = process.env.WORCA_CLAUDE_BIN || process.env.ORCH_CLAUDE_BIN || 'claude';

/** What `--settings` carries, or null when there is nothing to carry (no hook
 *  telemetry, no permission rules) — then the flag is omitted entirely. */
export function buildSettingsPayload(permissionRules) {
  const hook = buildHookSettings();
  const hasRules = !!permissionRules && Object.values(permissionRules).some((a) => Array.isArray(a) && a.length);
  // Present-but-malformed rules (e.g. `{deny: 'Bash(curl:*)'}`) make the object
  // truthy while hasRules stays false, so the whole policy would drop out of
  // argv silently. Say it once, then take the same no-rules path (fail-open,
  // matching the guardrail-set read path) — the empty/absent cases ({}, {deny: []}, null)
  // are normal and stay quiet.
  if (!hasRules && permissionRules && typeof permissionRules === 'object'
      && Object.values(permissionRules).some((a) => a != null && !Array.isArray(a))) {
    console.warn('[worca] guardrails: permissionRules is malformed (deny/allow/ask must be arrays of strings) — ignoring it; this spawn carries NO permission rules');
  }
  if (!hook && !hasRules) return null;
  const settings = {};
  if (hook) settings.hooks = hook.hooks;
  if (hasRules) settings.permissions = permissionRules;
  return { hook: !!hook, settings };
}

/**
 * Largest command line we hand to spawn() inline (GH #380). Windows caps the
 * whole CreateProcess command line at 32,767 chars and Linux caps a single
 * argument at 128 KiB, and a real task prompt (a 1000-line markdown plus the
 * rendered channel artifacts) sails past both — `spawn ENAMETOOLONG` / E2BIG at
 * the first node. Above this limit the prompt travels on stdin and the system
 * prompt / settings as files (planClaudeInvocation); below it the argv is
 * byte-identical to what it always was. The figure leaves ~12K of headroom
 * under the Windows cap for the exe path, quoting, and flags this measure
 * cannot see, and is deliberately platform-independent so the offload path is
 * exercised (and testable) everywhere, not only on Windows.
 *
 * Inline JSON, or the path of a file holding that same JSON when the invocation
 * is staged (GH #380 — the CLI accepts either).
 */
export const ARGV_INLINE_LIMIT = 20000;

/** Conservative size of the command line spawn() would build: every argument
 *  quoted and space-separated, after the binary. Over-counts slightly on
 *  purpose (a prompt with embedded quotes grows under Windows escaping). */
export function argvLength(bin, args) {
  return String(bin || '').length + args.reduce((n, a) => n + String(a).length + 3, 0);
}

/** Log each npm-shim resolution once per process, not once per spawn. */
const _resolveNoted = new Set();

/** The spawn-failure Error for `bin`: the OS message, plus the Windows npm-shim
 *  explanation when that is what actually went wrong (ENOENT on a bare name
 *  whose only PATH hit is claude.cmd; EINVAL on an explicit .cmd). */
function spawnFailure(bin, err, prefix) {
  const hint = /ENOENT|EINVAL/.test(String(err && err.code || err && err.message || ''))
    ? explainUnspawnableClaude(bin) : null;
  return new Error(`${prefix}: ${err.message}${hint ? ` — ${hint}` : ''}`);
}

// Cap for the stderr detail embedded in a non-zero-exit Error message. The
// audit trail and the UI error banner consume that message; an uncapped
// stderrBuf (hundreds of KB of MCP/retry chatter) must not ride into them when
// every stderr line was already streamed as its own warn event. Classification
// does NOT ride on the capped message: recovery markers are classified line-by-
// line as stderr streams (see rlErr) and stamped on the error as `errorClass`.
const STDERR_DETAIL_MAX = 2000;

/**
 * Translate a pipeline "effort" level into claude CLI argv additions. This is
 * the ONE place that knows the CLI surface for effort.
 *
 * The flag NAME is read from WORCA_EFFORT_FLAG (default "--effort") so it can
 * be retargeted to whatever the installed `claude` actually names it WITHOUT a
 * code change. Empty effort adds nothing (the model's own default is used), so
 * the default run path is never affected by the flag name.
 *
 * NOTE: "--effort" is an ASSUMED default, NOT a verified CLI contract. Confirm
 * it against your installed CLI before relying on per-step effort (see the plan's
 * verification section). If your CLI rejects an unknown flag, a run that sets an
 * effort would fail fast with a non-zero exit; set WORCA_EFFORT_FLAG to fix it.
 *
 * @param {string|undefined} effort  one of EFFORTS (medium|high|xhigh|max)
 * @returns {string[]}
 */
export function buildEffortArgs(effort) {
  if (!effort) return [];
  const flag = (process.env.WORCA_EFFORT_FLAG || '--effort').trim() || '--effort';
  return [flag, String(effort)];
}

/**
 * Whether per-sub-agent telemetry via Claude's hook-events is enabled. Feature-
 * detected and DEFAULT OFF: only `WORCA_SUBAGENT_HOOKS` set to a truthy value
 * (anything but "", "0", "false") turns it on. OFF ⇒ runReal adds NO extra flags
 * and the baseline sub-agent lifecycle (tool_use/tool_result) is unaffected.
 */
export function subagentHooksEnabled() {
  const v = process.env.WORCA_SUBAGENT_HOOKS;
  return !!v && v !== '0' && v.toLowerCase() !== 'false';
}

// ── Sub-agent telemetry + the --settings seam ────────────────────────────────
// Telemetry is GATED (subagentHooksEnabled) and OFF by default. When on it adds
// `--include-hook-events` (surfaces hook lifecycle on the SAME stdout stream)
// and registers a no-op `true` PostToolUse hook matched to `Agent` — just enough
// to make `claude` run+emit the PostToolUse event whose `tool_response` carries
// totalDurationMs/totalTokens/usage. We read telemetry off the surfaced
// stream-json event, NOT the hook command's stdout. `--bare`-proof (inline
// settings need no settings file). The argv contract is on buildSettingsArgs.
// ─────────────────────────────────────────────────────────────────────────────

/** The telemetry hook-settings OBJECT (see subagentHooksEnabled). null when off. */
export function buildHookSettings() {
  if (!subagentHooksEnabled()) return null;
  return {
    hooks: { PostToolUse: [{ matcher: 'Agent', hooks: [{ type: 'command', command: 'true', async: true }] }] },
  };
}

/**
 * The ONE --settings seam. Telemetry hook settings (gated, default off) and the
 * guardrails `permissions` rules merge into a SINGLE inline JSON — two --settings
 * flags would be last-wins at the CLI, silently dropping one payload.
 * [] when there is nothing to say, so the baseline argv is byte-identical.
 * @param {{deny?:string[],allow?:string[],ask?:string[]}|null|undefined} permissionRules
 * @param {string|null} [settingsFile] staged path (GH #380): `--settings <path>` carries the same JSON
 * @returns {string[]}
 */
export function buildSettingsArgs(permissionRules, settingsFile = null) {
  const payload = buildSettingsPayload(permissionRules);
  if (!payload) return [];
  const args = [];
  if (payload.hook) args.push('--include-hook-events');
  args.push('--settings', settingsFile || JSON.stringify(payload.settings));
  return args;
}

/** Back-compat alias for the pre-guardrails name (telemetry-only payload). */
export function buildHookArgs() {
  return buildSettingsArgs(null);
}

// Base env a headless claude needs to function at all; everything else is
// withheld under scrub. ANTHROPIC_*/CLAUDE_* prefixes carry the CLI's own auth
// and configuration and MUST survive, or every scrubbed run would fail auth.
// The proxy / CA vars are CONNECTIVITY config, not secrets: without them a
// scrubbed run behind a TLS-intercepting corporate proxy fails TLS on every
// spawn (the 2.1.220 binary reads all of them). Cloud-provider creds
// (AWS_*/GOOGLE_APPLICATION_CREDENTIALS/AZURE_*) are intentionally NOT here —
// a Bedrock/Vertex/Foundry deployment allowlists them per-project (documented).
const SPAWN_ENV_BASE = [
  'PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'USER', 'LOGNAME', 'TERM',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
];

/**
 * The spawn env under guardrails. undefined when scrub is off — spawn() then
 * inherits process.env exactly as today. When on: base vars + every `ANTHROPIC_`-
 * and `CLAUDE_`-prefixed var + the per-project allowlist. (Do not rewrite those
 * prefixes with a `*` glob here — the resulting `*` + `/` would end this comment.)
 *
 * We deliberately do NOT set CLAUDE_CODE_SUBPROCESS_ENV_SCRUB. On CLI 2.1.220
 * (live-verified 2026-08-01) a truthy value forces the permission mode to
 * "default", overriding our `--permission-mode acceptEdits` (and, per static
 * analysis, forces a strict sandbox) — which would break scrubbed pipeline runs.
 * Do not reinstate it without re-verifying against the installed CLI.
 *
 * @param {boolean|undefined} envScrub
 * @param {string[]|undefined} envAllowlist
 * @returns {Record<string,string>|undefined}
 */
export function buildSpawnEnv(envScrub, envAllowlist) {
  if (!envScrub) return undefined;
  const allow = new Set(Array.isArray(envAllowlist) ? envAllowlist : []);
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (SPAWN_ENV_BASE.includes(k) || k.startsWith('ANTHROPIC_') || k.startsWith('CLAUDE_') || allow.has(k)) {
      env[k] = v;
    }
  }
  return env;
}

/**
 * Whether mock mode is active. Driven by WORCA_MOCK or an explicit opts.mock
 * passed through by the orchestrator (handled by caller mapping mock->env or
 * by passing systemPrompt/prompt markers; we also honor a `mock` field).
 */
export function mockEnabled(opts) {
  if (opts && opts.mock) return true;
  const v = process.env.WORCA_MOCK ?? process.env.ORCH_MOCK;
  return !!v && v !== '0' && v.toLowerCase() !== 'false';
}

/**
 * Run Claude headless (or the mock). Streams events via onEvent and resolves
 * with the accumulated assistant/result text and the process exit code.
 *
 * @param {object} o
 * @param {string} o.cwd                 working directory for claude
 * @param {string} [o.systemPrompt]      appended system prompt
 * @param {string} o.prompt              the user prompt (-p)
 * @param {string[]} [o.allowedTools]    e.g. ["Read","Write","Edit","Bash"]
 * @param {string} [o.permissionMode]    e.g. "acceptEdits"
 * @param {string} [o.model]             optional model id
 * @param {string} [o.effort]            optional reasoning effort
 * @param {(e:{type:string, raw?:any, text?:string})=>void} [o.onEvent]
 * @param {AbortSignal} [o.signal]
 * @param {string} [o.resumeSessionId]   resume a previous claude session (--resume)
 * @param {string} [o.bin]               claude binary (default "claude")
 * @param {boolean} [o.mock]             force mock mode
 * @param {string} [o.mcpConfigPath]     §5.5 generated <runRoot>/mcp.json (--mcp-config)
 * @param {string[]} [o.mcpServerGrants] §5.3 `mcp__<server>` grants unioned into --allowedTools
 * @param {{deny?:string[],allow?:string[],ask?:string[]}} [o.permissionRules] guardrail permission
 *   rules merged into the single `--settings` payload (absent => argv unchanged)
 * @param {boolean} [o.envScrub]         guardrail: spawn with a minimal env instead of
 *   inheriting process.env (absent/false => spawn inherits, today's behavior)
 * @param {string[]} [o.envAllowlist]    guardrail: extra env var names to keep under scrub
 * @param {Record<string,string>} [o.modelEnv] per-model routing env (design §4.4), merged
 *   LAST over the spawn env (it survives scrub and wins collisions — explicit operator
 *   config outranks ambient-env hygiene); reserved keys are re-dropped here defensively.
 *   An ANTHROPIC_MODEL key is the WIRE id (#374): it replaces `model` in the spawned
 *   `--model` flag, while `model` (the catalog id) stays worca's handle everywhere else
 * @param {string[]} [o.workspaceWriteTargets] §8.10 MOCK-ONLY member checkouts the mock
 *   implementer writes into instead of `cwd` (empty/absent => today's cwd behavior).
 *   Never reaches argv: `runReal` ignores it by construction.
 * @param {string[]} [o.tools]              --tools <list>: the built-in tool allowlist ([] ⇒ `--tools ""`,
 *   no built-ins at all; MCP tools are unaffected). Absent ⇒ flag omitted (claude defaults).
 * @param {boolean} [o.strictMcpConfig]     --strict-mcp-config: only --mcp-config servers load
 * @param {string[]} [o.settingSources]     --setting-sources <list> (e.g. ['project'] drops user hooks/plugins/skills)
 * @param {boolean} [o.disableSlashCommands] --disable-slash-commands
 * @param {boolean} [o.includePartialMessages] --include-partial-messages (stream_event text deltas)
 * @param {number} [o.maxTurns]             --max-turns <n> (positive safe integer; else omitted)
 * @param {number|null} [o.maxBudgetUsd]    --max-budget-usd <n> (finite > 0; null/else omitted)
 * @param {string} [o.appendSubagentSystemPrompt] --append-subagent-system-prompt <text> (Task children only)
 *   All eight are Ask Worca sandbox options (ask-worca-design.md §6.3) and default-off.
 * @param {number} [o.argvInlineLimit]     override ARGV_INLINE_LIMIT (GH #380; tests force the staged path)
 * @returns {Promise<{text:string, exitCode:number}>}
 */
export async function runClaude(o = {}) {
  // NOTE: this destructure + the runReal call below are the GATE, not a
  // pass-through. Every field must be named in BOTH places or it is silently
  // dropped before runReal sees it — a field added only to buildClaudeArgs would
  // never reach argv while a builder-only test still passed
  // (test/spawn-args.test.mjs asserts the forwarding end to end).
  const {
    cwd = process.cwd(),
    systemPrompt = '',
    prompt = '',
    allowedTools,
    permissionMode = 'acceptEdits',
    model,
    effort,
    onEvent = () => {},
    signal,
    mcpConfigPath,
    mcpServerGrants,
    permissionRules,
    envScrub,
    envAllowlist,
    modelEnv,
    workspaceWriteTargets,
    resumeSessionId,
    // Ask Worca sandbox hardening (ask-worca-design.md §6.3/§6.8). All default-off:
    // undefined here ⇒ nothing emitted ⇒ every legacy argv stays byte-identical.
    tools,
    strictMcpConfig,
    settingSources,
    disableSlashCommands,
    includePartialMessages,
    maxTurns,
    maxBudgetUsd,
    appendSubagentSystemPrompt,
    argvInlineLimit,
    bin = DEFAULT_BIN,
  } = o;

  if (signal?.aborted) {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  }

  if (mockEnabled(o)) {
    // runMock spawns nothing, so the MCP fields are meaningless to it —
    // workspaceWriteTargets is the one option that is mock-ONLY (§8.10) and it must be
    // named HERE too, or the mock implementer never sees it (this call is a gate, not
    // a pass-through; test/spawn-args.test.mjs asserts the forwarding end to end).
    return runMock({ cwd, systemPrompt, prompt, onEvent, signal, resumeSessionId, workspaceWriteTargets, permissionMode });
  }

  return runReal({
    cwd,
    systemPrompt,
    prompt,
    allowedTools,
    permissionMode,
    model,
    effort,
    onEvent,
    signal,
    bin,
    resumeSessionId,
    mcpConfigPath,
    mcpServerGrants,
    permissionRules,
    envScrub,
    envAllowlist,
    modelEnv,
    tools,
    strictMcpConfig,
    settingSources,
    disableSlashCommands,
    includePartialMessages,
    maxTurns,
    maxBudgetUsd,
    appendSubagentSystemPrompt,
    argvInlineLimit,
  });
}

// ── Real execution ───────────────────────────────────────────────────────────

/** Pure argv builder for the headless claude spawn (exported for tests).
 *  resumeSessionId re-attaches a previous session: `--resume <sid>` makes -p send
 *  the prompt as the next user message of THAT session instead of a fresh one.
 *
 *  Two §5.3 additions for detached runs, both no-ops when absent (so every legacy
 *  argv stays byte-identical):
 *   - mcpConfigPath   -> `--mcp-config <file>` (E5: config servers connect and their
 *                        tools are callable in headless -p; it MERGES with `.mcp.json`,
 *                        user scope, and plugin servers, so `--strict-mcp-config` is
 *                        deliberately never passed — E11).
 *   - mcpServerGrants -> unioned into `--allowedTools`. The server-WILDCARD shape
 *                        (`mcp__<server>`) is what Phase-0 gate V1 verified as
 *                        callable under `--permission-mode acceptEdits`
 *                        (docs/run-root-verification.md, branch (a); argv-attested
 *                        transcript phase0/out/v1a-rerun.jsonl, with a no-grant
 *                        negative control proving the grant is load-bearing).
 *  `--add-dir` is deliberately absent: it needs an env override to carry memory at
 *  all (E2) and no shipped feature uses it (§5.3 / §8.18). */
export function buildClaudeArgs({
  prompt, systemPrompt, permissionMode, model, effort, allowedTools, resumeSessionId,
  mcpConfigPath, mcpServerGrants, permissionRules,
  // Ask Worca hardening options (ask-worca-design.md §6.3). `tools` is renamed on the
  // way in because the legacy body below already owns a local `tools` (the
  // --allowedTools union).
  tools: builtinTools, strictMcpConfig, settingSources, disableSlashCommands, includePartialMessages,
  maxTurns, maxBudgetUsd, appendSubagentSystemPrompt,
}, delivery = {}) {
  // delivery (GH #380, set only by planClaudeInvocation's staged branch):
  //   promptViaStdin   -> bare `-p`; the prompt is written to the child's stdin
  //   systemPromptFile -> `--append-system-prompt-file <path>` instead of the text
  //   settingsFile     -> `--settings <path>` instead of the inline JSON
  const { promptViaStdin = false, systemPromptFile = null, settingsFile = null } = delivery;
  const args = promptViaStdin ? ['-p'] : ['-p', prompt];
  args.push('--output-format', 'stream-json', '--verbose', '--permission-mode', permissionMode);
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  if (systemPrompt) {
    if (systemPromptFile) args.push('--append-system-prompt-file', systemPromptFile);
    else args.push('--append-system-prompt', systemPrompt);
  }
  if (model) {
    args.push('--model', model);
  }
  for (const a of buildEffortArgs(effort)) args.push(a);
  // The ONE --settings seam: gated, default-off per-sub-agent telemetry
  // (WORCA_SUBAGENT_HOOKS) and the guardrails `permissions` rules merge into a
  // SINGLE inline JSON (two --settings flags would be last-wins at the CLI). [] when
  // there is neither, so the baseline argv is unchanged; a CLI that rejects these
  // flags would only ever fail when the operator opted in.
  for (const a of buildSettingsArgs(permissionRules, settingsFile)) args.push(a);
  if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath);
  const tools = Array.isArray(allowedTools) ? allowedTools.slice() : [];
  for (const s of (Array.isArray(mcpServerGrants) ? mcpServerGrants : [])) {
    if (s && !tools.includes(s)) tools.push(s);          // union, never a duplicate
  }
  if (tools.length) {
    args.push('--allowedTools', tools.join(','));
  }
  // ── Ask Worca hardening flags (ask-worca-design.md §6.3 / §6.8) ──────────────
  // Every one is default-off: absent / false / invalid ⇒ NOTHING is emitted, so
  // every legacy argv stays byte-identical (test/spawn-args.test.mjs). Appended
  // AFTER the legacy block so the baseline prefix never moves. Probed on 2.1.239:
  // `--tools ""` = no built-in tools (MCP tools survive); the hidden `--max-turns`
  // and `--append-subagent-system-prompt` are accepted and enforced.
  // Filter to usable names FIRST, then decide: testing the RAW list while emitting
  // the FILTERED join made `settingSources: [1]` emit `--setting-sources ""` (where
  // `[]` emits nothing) and `['Read', '']` emit a trailing comma.
  const names = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s) : []);
  // --tools is the one list whose empty value is meaningful (`--tools ""` = no
  // built-in tools at all, §6.3), so the ARRAY decides whether the flag is emitted.
  if (Array.isArray(builtinTools)) {
    args.push('--tools', names(builtinTools).join(','));
  }
  if (strictMcpConfig === true) args.push('--strict-mcp-config');
  const sources = names(settingSources);
  if (sources.length) {
    args.push('--setting-sources', sources.join(','));
  }
  if (disableSlashCommands === true) args.push('--disable-slash-commands');
  if (includePartialMessages === true) args.push('--include-partial-messages');
  if (Number.isSafeInteger(maxTurns) && maxTurns > 0) args.push('--max-turns', String(maxTurns));
  if (typeof maxBudgetUsd === 'number' && Number.isFinite(maxBudgetUsd) && maxBudgetUsd > 0) {
    args.push('--max-budget-usd', String(maxBudgetUsd));
  }
  if (typeof appendSubagentSystemPrompt === 'string' && appendSubagentSystemPrompt) {
    args.push('--append-subagent-system-prompt', appendSubagentSystemPrompt);
  }
  return args;
}

/**
 * Decide how ONE invocation reaches the CLI (GH #380). Pure: no I/O.
 *  - inline (the common case): `args` is exactly buildClaudeArgs(opts); `stdin`
 *    null; `files` empty.
 *  - staged (argv over `limit`): the prompt goes on stdin (`-p` reads it — the
 *    model sees the exact text, unlike a "read this file" instruction), the
 *    system prompt and the settings JSON become files under `dir`, and no
 *    argument carries free text any more, so the argv is short by construction.
 * @param {object} opts  the buildClaudeArgs options
 * @param {{bin?:string, dir?:string|(() => string), limit?:number}} [o]  `dir` may be a
 *   factory, called only when staging is actually needed (so the caller creates
 *   a temp dir exactly when one will be used)
 * @returns {{args:string[], stdin:string|null, files:{path:string,content:string}[], staged:boolean, inlineLength:number}}
 */
export function planClaudeInvocation(opts, { bin = DEFAULT_BIN, dir = null, limit = ARGV_INLINE_LIMIT } = {}) {
  const inline = buildClaudeArgs(opts);
  const inlineLength = argvLength(bin, inline);
  if (inlineLength <= limit) return { args: inline, stdin: null, files: [], staged: false, inlineLength };
  if (!dir) throw new Error('planClaudeInvocation: a staging dir is required when the argv is over the limit');
  if (typeof dir === 'function') dir = dir();
  const files = [];
  const prompt = typeof opts.prompt === 'string' ? opts.prompt : '';
  const promptViaStdin = prompt.length > 0;             // an empty prompt stays `-p ''` — nothing to pipe
  let systemPromptFile = null;
  if (opts.systemPrompt) {
    systemPromptFile = join(dir, 'system-prompt.md');
    files.push({ path: systemPromptFile, content: opts.systemPrompt });
  }
  let settingsFile = null;
  const payload = buildSettingsPayload(opts.permissionRules);
  if (payload) {
    settingsFile = join(dir, 'settings.json');
    files.push({ path: settingsFile, content: JSON.stringify(payload.settings) });
  }
  const args = buildClaudeArgs(opts, { promptViaStdin, systemPromptFile, settingsFile });
  return { args, stdin: promptViaStdin ? prompt : null, files, staged: true, inlineLength };
}

/** planClaudeInvocation + the I/O: a private temp dir is created and the files
 *  written ONLY on the staged branch (`dir` is null otherwise, so the caller has
 *  nothing to clean up). Synchronous on purpose — a few hundred KB once per
 *  spawn, and it keeps the spawn sequence in runReal linear. */
export function stageClaudeInvocation(opts, { bin = DEFAULT_BIN, limit = ARGV_INLINE_LIMIT } = {}) {
  let dir = null;
  const plan = planClaudeInvocation(opts, { bin, limit, dir: () => (dir = mkdtempSync(join(tmpdir(), 'worca-claude-'))) });
  for (const file of plan.files) writeFileSync(file.path, file.content, 'utf8');
  return { ...plan, dir };
}

function runReal({ cwd, systemPrompt, prompt, allowedTools, permissionMode, model, effort, onEvent, signal, bin, resumeSessionId, mcpConfigPath, mcpServerGrants, permissionRules, envScrub, envAllowlist, modelEnv, tools, strictMcpConfig, settingSources, disableSlashCommands, includePartialMessages, maxTurns, maxBudgetUsd, appendSubagentSystemPrompt, argvInlineLimit }) {
  return new Promise((resolveP, rejectP) => {
    // Per-model routing env (design §4.4), prepared BEFORE argv: reserved keys
    // are re-dropped here defensively — the write path already rejects them, so
    // a drop means a hand-edited settings file — and the surviving map is also
    // where the wire id (below) is read from.
    let safeModelEnv = null;
    let wireModelDropped = false;
    if (modelEnv && Object.keys(modelEnv).length) {
      const { env: safe, dropped } = prepareModelEnv(modelEnv);
      for (const k of dropped) {
        console.warn(`[worca] modelEnv: dropping reserved/invalid key ${JSON.stringify(k)}`);
      }
      // A configured wire id that didn't survive (unresolvable ${VAR}, empty, or
      // whitespace-only) fell into `dropped`: we silently fall back to the catalog
      // id below, so warn specifically — the generic drop line above doesn't say
      // the argv model changed, and the wire-model line never fires (ids match).
      wireModelDropped = 'ANTHROPIC_MODEL' in modelEnv && dropped.includes('ANTHROPIC_MODEL');
      if (Object.keys(safe).length) safeModelEnv = safe;
    }

    // Wire id (#374): ANTHROPIC_MODEL in the resolved model env names the id the
    // ENDPOINT should see; the catalog id stays worca's handle (config refs, cost
    // flags). Passed as an explicit --model — self-documenting in logs and immune
    // to CLI flag/env precedence — so the env var alone would otherwise be dead.
    const wireModel = safeModelEnv?.ANTHROPIC_MODEL || model;
    if (wireModelDropped && wireModel === model) {
      console.warn(`[worca] model ${JSON.stringify(model ?? '')}: configured wire model was dropped (unresolved/empty) — using the catalog id`);
    } else if (wireModel !== model) {
      console.warn(`[worca] model ${JSON.stringify(model ?? '')}: wire model ${JSON.stringify(wireModel)}`);
    }

    // Windows + npm-installed Claude Code: the bare name is a .cmd shim Node
    // cannot spawn; resolveClaudeBin swaps in the package's native claude.exe.
    // Everywhere else this is `bin` unchanged. Resolved BEFORE the argv plan so
    // the command-line measure below counts the path that is actually spawned.
    const resolved = resolveClaudeBin(bin);
    if (resolved.note && !_resolveNoted.has(resolved.bin)) {
      _resolveNoted.add(resolved.bin);
      console.warn(`[worca] ${resolved.note}`);
    }

    // GH #380: inline argv when it fits, else prompt on stdin + files (see
    // ARGV_INLINE_LIMIT). The staging dir, when any, is removed on every
    // terminal path below (finish) and on a failed spawn.
    const limit = Number.isFinite(argvInlineLimit) && argvInlineLimit > 0 ? argvInlineLimit : ARGV_INLINE_LIMIT;
    let plan;
    try {
      plan = stageClaudeInvocation({
        prompt, systemPrompt, permissionMode, model: wireModel, effort, allowedTools, resumeSessionId,
        mcpConfigPath, mcpServerGrants, permissionRules,
        tools, strictMcpConfig, settingSources, disableSlashCommands, includePartialMessages,
        maxTurns, maxBudgetUsd, appendSubagentSystemPrompt,
      }, { bin: resolved.bin, limit });
    } catch (err) {
      rejectP(new Error(`Failed to stage the claude prompt files: ${err.message}`));
      return;
    }
    const { args } = plan;
    const cleanupStaged = () => {
      if (!plan.dir) return;
      try { rmSync(plan.dir, { recursive: true, force: true }); } catch { /* best effort */ }
    };
    if (plan.staged) {
      console.warn(`[worca] claude argv would be ${plan.inlineLength} chars (limit ${limit}): prompt on stdin, system prompt/settings as files`);
    }

    // undefined when the guardrail is off, and the spread then adds NO `env` key —
    // spawn inherits process.env exactly as it did before guardrails existed.
    const guardrailEnv = buildSpawnEnv(envScrub, envAllowlist);

    // Model env merges LAST: it survives scrub and wins collisions (explicit
    // operator config outranks ambient-env hygiene). With no modelEnv (or
    // nothing surviving the filter) the spawn env is byte-identical to the
    // pre-feature behavior, including the undefined -> inherit-process.env case.
    let spawnEnv = guardrailEnv;
    if (safeModelEnv) spawnEnv = { ...(guardrailEnv ?? process.env), ...safeModelEnv };

    let child;
    try {
      child = spawn(resolved.bin, args, {
        cwd, stdio: [plan.stdin != null ? 'pipe' : 'ignore', 'pipe', 'pipe'], ...(spawnEnv ? { env: spawnEnv } : {}),
      });
    } catch (err) {
      cleanupStaged();
      rejectP(spawnFailure(bin, err, `Failed to spawn ${bin}`));
      return;
    }
    if (plan.stdin != null) {
      // A child that dies before draining stdin (bad flag, ENOENT surfaced
      // late) raises EPIPE here; the 'error'/'close' handlers own the real cause.
      child.stdin.on('error', () => {});
      child.stdin.end(plan.stdin, 'utf8');
    }

    let resultText = '';
    let assistantText = '';
    let stderrBuf = '';
    // Strongest recovery class seen across ALL stderr lines — classified at
    // receive time, so it survives both the rolling trim and the tail cap.
    let stderrClass = null;
    // In stream-json mode claude reports failures (auth, unknown/unavailable
    // model, API errors) as a terminal `result` event with is_error:true on
    // STDOUT and exits non-zero with EMPTY stderr. Capture that text so a
    // non-zero exit surfaces the real cause instead of an opaque "no stderr".
    let errorDetail = '';
    let settled = false;

    const onAbort = () => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      // Escalate if it ignores SIGTERM.
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 1500).unref?.();
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener?.('abort', onAbort);
      cleanupStaged();
      fn(arg);
    };

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let evt;
      try {
        evt = JSON.parse(trimmed);
      } catch {
        // Non-JSON line (rare). Surface as a raw log.
        safeEmit(onEvent, { type: 'log', text: trimmed, raw: trimmed });
        return;
      }
      const text = extractText(evt);
      // Pause/Resume: surface the session id from the init event so the
      // orchestrator can persist it per step (claude --resume needs it).
      if (evt?.type === 'system' && evt?.subtype === 'init' && typeof evt.session_id === 'string') {
        safeEmit(onEvent, { type: 'session', sessionId: evt.session_id });
      }
      if (evt?.type === 'assistant' && text) assistantText += text;
      if (evt?.type === 'result' && typeof evt.result === 'string') resultText += evt.result;
      // Remember the most specific error text we see, for the non-zero-exit path.
      if (evt?.type === 'result' && evt.is_error) {
        errorDetail =
          (typeof evt.result === 'string' && evt.result.trim()) ||
          (typeof evt.error === 'string' && evt.error.trim()) ||
          errorDetail;
      } else if (!errorDetail && typeof evt?.error === 'string' && evt.error.trim()) {
        errorDetail = evt.error.trim();
      }
      // Surface Claude's hook-event lines (only present under --include-hook-events)
      // as a stable type:'hook-event' the orchestrator reads for sub-agent telemetry.
      // The exact envelope key varies by CLI build; match the documented shapes.
      const isHook = evt?.type === 'hook-event' || evt?.type === 'hook_event' ||
        (typeof evt?.hook_event_name === 'string');
      if (isHook) {
        safeEmit(onEvent, { type: 'hook-event', raw: evt });
        return;
      }
      const cost = extractResultCost(evt);
      safeEmit(onEvent, {
        type: evt?.type || 'event',
        raw: evt,
        text: text || undefined,
        ...(cost != null ? { costUsd: cost } : {}),
      });
    });

    // stderr is a FIRST-CLASS log stream, not just failure evidence. The CLI puts
    // retry/throttle notices (429/529), MCP server chatter, and runtime warnings
    // here on runs that go on to succeed — all of it was previously discarded,
    // since stderrBuf is only read on the non-zero-exit path below.
    //
    // Framed with the SAME readline as stdout: readline decodes through an
    // internal StringDecoder (a multi-byte character split across pipe chunks
    // survives) and treats a lone \r as a line break, so CR-rewriting progress
    // output surfaces live instead of accumulating until exit. Each line is
    // emitted at receive time — the closest available proxy for event time.
    // `stream:'err'` tags the origin channel; the orchestrator decides the level.
    const rlErr = createInterface({ input: child.stderr });
    rlErr.on('line', (line) => {
      // Classify BEFORE buffering: the class must see every line ever printed —
      // an early 401 or session-limit notice followed by hundreds of KB of MCP
      // chatter would otherwise scroll past both the trim and the tail cap.
      stderrClass = strongestClass(stderrClass, classifyError(line));
      stderrBuf += line + '\n';        // still the source of the exit-code detail
      // Rolling tail: bound memory against chatty MCP servers. Trim at 4x the
      // cap down to 2x — amortized, and the kept tail always exceeds
      // STDERR_DETAIL_MAX so the close handler's `… ` marker still fires.
      if (stderrBuf.length > STDERR_DETAIL_MAX * 4) stderrBuf = stderrBuf.slice(-STDERR_DETAIL_MAX * 2);
      const text = line.trim();
      // A pause/stop SIGTERMs the child: whatever it writes while dying (and the
      // torn fragment readline flushes at stream end) is not run output.
      if (text && !signal?.aborted) safeEmit(onEvent, { type: 'stderr', stream: 'err', text });
    });

    child.on('error', (err) => {
      finish(rejectP, spawnFailure(bin, err, `${bin} error`));
    });

    child.on('close', (code) => {
      rl.close();
      rlErr.close(); // readline already flushed its final unterminated line when the stream ended
      if (signal?.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        finish(rejectP, err);
        return;
      }
      if (code !== 0) {
        const fromStderr = stderrBuf.trim();
        const raw = fromStderr || errorDetail || 'no stderr';
        // Tail, not head: the terminal cause sits at the END of a long stderr.
        const detail = raw.length > STDERR_DETAIL_MAX ? `… ${raw.slice(-STDERR_DETAIL_MAX)}` : raw;
        const err = new Error(`${bin} exited with code ${code}: ${detail}`);
        // The recovery class, judged on the FULL evidence: the per-line stream
        // class when stderr fed the detail, else the (already fully in-memory)
        // stdout errorDetail. classifyError() returns this stamp verbatim, so
        // the tail cap above can never starve recovery — or flip an early auth
        // failure into 'network' because connection chatter filled the tail.
        err.errorClass = fromStderr ? stderrClass : classifyError(raw);
        // Mark the origin channel so the orchestrator can tag its `error` log
        // line with stream:'err' without sniffing the message. Absent when the
        // detail came from the stdout `result` envelope (the common case — see
        // the errorDetail comment above), which is not an stderr line.
        if (fromStderr) err.stream = 'err';
        finish(rejectP, err);
        return;
      }
      const text = resultText || assistantText;
      finish(resolveP, { text, exitCode: code ?? 0 });
    });
  });
}

function safeEmit(onEvent, e) {
  try {
    onEvent(e);
  } catch {
    /* listener errors must not break the stream */
  }
}

/**
 * Pull human-readable text out of a stream-json event. Handles the common
 * Claude Code shapes: { type:"assistant", message:{ content:[{type:"text", text}] } }
 * and { type:"result", result:"..." }.
 */
function extractText(evt) {
  if (!evt || typeof evt !== 'object') return '';
  if (typeof evt.result === 'string') return evt.result;
  const content = evt.message?.content ?? evt.content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('');
  }
  if (typeof content === 'string') return content;
  return '';
}

/**
 * Pull the ACTUAL dollar cost out of a stream-json `result` event. Claude Code
 * reports spend for the headless invocation as `total_cost_usd` on the terminal
 * result event (older builds: `cost_usd`). Returns a finite number (INCLUDING 0),
 * or null when the event is not a cost-bearing result (so callers can simply skip
 * null). A genuine zero must survive: `?? ` only falls through on null/undefined,
 * never on 0.
 * @param {any} evt
 * @returns {number|null}
 */
export function extractResultCost(evt) {
  if (!evt || typeof evt !== 'object' || evt.type !== 'result') return null;
  const raw = evt.total_cost_usd ?? evt.cost_usd; // accept either spelling; keeps 0
  if (raw == null) return null;                   // no cost field present
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null; // a negative spend is malformed → no cost
}

// ── Mock execution ───────────────────────────────────────────────────────────

/**
 * Parse "KEY: value" markers from the prompt (preferred) and systemPrompt.
 */
function parseMarkers(prompt, systemPrompt) {
  const markers = {};
  const scan = (txt) => {
    if (!txt) return;
    for (const line of String(txt).split(/\r?\n/)) {
      const m = line.match(/^\s*(MOCK_[A-Z_]+)\s*:\s*(.*)$/);
      if (m) {
        const key = m[1];
        if (markers[key] === undefined) markers[key] = m[2].trim();
      }
    }
  };
  scan(prompt);
  scan(systemPrompt);
  return markers;
}

async function ensureDir(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
}

async function exists(p) {
  try {
    await access(p, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Emit a canned log line and yield to the event loop. */
async function emitLog(onEvent, text) {
  safeEmit(onEvent, { type: 'assistant', text, raw: { mock: true, text } });
  // Let consumers process the event; keeps mock async-realistic.
  await new Promise((r) => setTimeout(r, 0));
}

/**
 * The roles the offline mock runner can SERVE — one per arm of the role switch
 * below (the `ask` arm is the Ask-Worca assistant, not a writer role). Exported
 * because three consumers need the vocabulary and none of them may hard-code it:
 * meta v2 validation (an unknown `mockRole` is a warning + drop), GET /api/agents
 * (the Agents view's role picker) and the graph executor's mock-role chain.
 * test/mock-writer-roles.test.mjs parses the switch and pins the lockstep.
 */
export const MOCK_WRITER_ROLES = new Set([
  'clarify', 'planner-plan', 'refiner', 'decomposer', 'implementer', 'reviewer', 'plan-review',
  'workspace-scan', 'agent-gen', 'workspace-reviewer', 'manual-tests-checklist', 'manual-web-ui-testing',
  'generic-producer', 'generic-verifier',
]);

/** Named so the executor's mock-role chain and the switch cannot drift apart. */
export const MOCK_ROLE_CLARIFY = 'clarify';
export const MOCK_ROLE_DECOMPOSER = 'decomposer';

/**
 * The mock-fan-out roles (mirror the orchestrator's FANOUT_ELIGIBLE intent): the
 * roles whose real runs may spawn sub-agents. Keyed by the MOCK_ROLE strings.
 */
const MOCK_FANOUT_ROLES = new Set([
  'planner-plan', 'refiner', 'implementer', 'plan-review',
  'workspace-reviewer', 'workspace-scan',
]);

/**
 * Emit a couple of fake sub-agent spawn (assistant.tool_use Agent) + finish
 * (user.tool_result) events for a fan-out-eligible role so the offline mock
 * exercises the sub-agent lifecycle indicator. No-op for other roles. The ids are
 * role-namespaced so concurrent mock nodes never collide on a tool_use id.
 */
async function emitMockSubAgents(role, onEvent, signal) {
  if (!MOCK_FANOUT_ROLES.has(role)) return;
  const labels = ['investigate area A', 'investigate area B'];
  const types = ['general-purpose', 'Explore'];   // exercise both a built-in and a named type
  const ids = labels.map((_, i) => `mock_${role}_${i + 1}`);

  // (1) MAIN-agent skill + MCP-tool use (no parent_tool_use_id) -> the step/group
  // header gets a blue `skill:graphify` pill AND a green three-part
  // `mcp:playwright:browser_snapshot` pill, so an offline run exercises BOTH pill
  // kinds on the header row, not just the sub-agent rows (§7.6).
  safeEmit(onEvent, {
    type: 'assistant',
    raw: { type: 'assistant', message: { content: [
      { type: 'tool_use', id: `mock_${role}_skill`, name: 'Skill', input: { skill: 'graphify' } },
      { type: 'tool_use', id: `mock_${role}_mcp`, name: 'mcp__plugin_playwright_playwright__browser_snapshot', input: {} },
    ] } },
  });
  // (2) Spawns (one assistant event carrying both Agent tool_use blocks).
  safeEmit(onEvent, {
    type: 'assistant',
    raw: { type: 'assistant', message: { content: ids.map((id, i) => ({
      type: 'tool_use', id, name: 'Agent', input: { description: labels[i], subagent_type: types[i] },
    })) } },
  });
  await new Promise((r) => setTimeout(r, 0));
  abortIfNeeded(signal);
  // (3) The FIRST sub-agent uses a skill + TWO tools of the SAME MCP server (child
  // stream: parent_tool_use_id). Two tools on one server is the §7.1 granularity
  // change made visible offline: it yields TWO pills where it used to yield one.
  safeEmit(onEvent, {
    type: 'assistant',
    raw: { type: 'assistant', parent_tool_use_id: ids[0], message: { content: [
      { type: 'tool_use', id: `${ids[0]}_s1`, name: 'Skill', input: { skill: 'brainstorming' } },
      { type: 'tool_use', id: `${ids[0]}_s2`, name: 'mcp__plugin_playwright_playwright__browser_navigate', input: { url: 'http://localhost' } },
      { type: 'tool_use', id: `${ids[0]}_s3`, name: 'mcp__plugin_playwright_playwright__browser_click', input: { ref: 'e1' } },
    ] } },
  });
  await new Promise((r) => setTimeout(r, 0));
  abortIfNeeded(signal);
  // (4) Matching tool_result finishes.
  for (const id of ids) {
    safeEmit(onEvent, {
      type: 'user',
      raw: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } },
    });
    await new Promise((r) => setTimeout(r, 0));
  }
}

// ── Ask Worca mock role (ask-worca-design.md §6.7) ───────────────────────────

/** Emit a raw stream-json frame through the SAME envelope runReal uses (the rl 'line' handler above). */
function emitRaw(onEvent, raw) {
  const cost = extractResultCost(raw);
  const text = extractText(raw);
  safeEmit(onEvent, { type: raw.type, raw, text: text || undefined, ...(cost != null ? { costUsd: cost } : {}) });
}

const ASK_CONTEXT_BLOCK_RE = /\[worca context\][\s\S]*?\[\/worca context\]\s*/;

/**
 * The offline Ask Worca assistant: frames in the shapes probed on claude 2.1.239
 * (system/init → message_start → text deltas → assistant blocks → tool_use /
 * tool_result pairs → message_delta → result), chosen from the USER text so
 * tests control the scenario. Never touches the filesystem, never reads prompt
 * markers, never spawns the MCP child. The limit / failure scenarios emit their
 * `result` frame and then REJECT exactly like the real CLI (exit 1, empty stderr).
 */
async function mockAsk({ markers, prompt, cwd, onEvent, signal, resumeSessionId }) {
  const userText = String(prompt ?? '').replace(ASK_CONTEXT_BLOCK_RE, '');
  let card = {};
  try { card = markers.MOCK_ASK_CARD ? JSON.parse(markers.MOCK_ASK_CARD) : {}; } catch { card = {}; }
  if (!card || typeof card !== 'object' || Array.isArray(card)) card = {};
  const fail = /\bMOCK_FAIL\b/.test(userText);
  const maxTurns = /\bMOCK_MAX_TURNS\b/.test(userText);
  const maxBudget = /\bMOCK_MAX_BUDGET\b/.test(userText);
  const slow = /\bMOCK_SLOW\b/.test(userText);
  const agents = /\bagents?\b/i.test(userText);
  const propose = /\b(propose|start|run)\b/i.test(userText);

  const SID = resumeSessionId || 'mock-session-ask-1';
  const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const firstLine = userText.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  const ANSWER = `[mock] ${firstLine.slice(0, 200)}`;
  const init = { type: 'system', subtype: 'init', session_id: SID, cwd, model: 'mock', permissionMode: 'dontAsk',
    tools: ['Task', 'mcp__worca__list_runs', 'mcp__worca__get_run', 'mcp__worca__propose_run'],
    mcp_servers: [{ name: 'worca', status: 'connected' }], plugins: [], skills: [], slash_commands: [], agents: [], uuid: 'mock-uuid-init' };
  const mstart = (id) => ({ type: 'stream_event', event: { type: 'message_start', message: { id, model: 'mock', role: 'assistant', content: [], usage: USAGE } }, parent_tool_use_id: null, session_id: SID });
  const delta = (t) => ({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }, parent_tool_use_id: null, session_id: SID });
  const mdelta = { type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: USAGE }, parent_tool_use_id: null, session_id: SID };
  const atext = (id, t) => ({ type: 'assistant', message: { id, model: 'mock', role: 'assistant', content: [{ type: 'text', text: t }], usage: USAGE }, parent_tool_use_id: null, session_id: SID });
  const atool = (id, toolId, name, input, ptu = null) => ({ type: 'assistant', message: { id, model: 'mock', role: 'assistant', content: [{ type: 'tool_use', id: toolId, name, input, caller: { type: 'direct' } }], usage: USAGE }, parent_tool_use_id: ptu, session_id: SID });
  const uresult = (toolId, text, ptu = null, extra = {}) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: [{ type: 'text', text }] }] }, parent_tool_use_id: ptu, session_id: SID, ...extra });
  const result = (over = {}) => ({ type: 'result', subtype: 'success', is_error: false, duration_ms: 10, duration_api_ms: 8, num_turns: 1, session_id: SID, total_cost_usd: 0,
    usage: USAGE, modelUsage: {}, permission_denials: [], terminal_reason: 'completed', result: ANSWER, ...over });
  const MSG1 = 'msg_mock_ask_1';
  const MSG2 = 'msg_mock_ask_2';

  const frames = [init, mstart(MSG1)];
  if (fail) {
    frames.push(result({ subtype: 'error_during_execution', is_error: true, errors: ['mock failure'], terminal_reason: 'api_error', result: 'mock failure', num_turns: 0 }));
  } else if (maxTurns || maxBudget) {
    frames.push(delta('[mock] '), delta('partial'), atext(MSG1, '[mock] partial'),
      atool(MSG1, 'toolu_mock_1', 'mcp__worca__list_runs', {}), uresult('toolu_mock_1', '[]'));
    frames.push(maxTurns
      ? result({ subtype: 'error_max_turns', is_error: true, errors: ['Reached maximum number of turns (1)'], terminal_reason: 'max_turns', num_turns: 2, stop_reason: 'tool_use', result: undefined })
      : result({ subtype: 'error_max_budget_usd', is_error: true, errors: ['Reached maximum budget ($0.0001)'], terminal_reason: 'budget_exhausted', result: undefined }));
  } else {
    let answerMsg = MSG1;
    if (agents) {
      frames.push(
        atool(MSG1, 'toolu_mock_task', 'Agent', { description: 'count runs', subagent_type: 'general-purpose', prompt: 'count the runs' }),
        atool('msg_mock_child_1', 'toolu_mock_child_1', 'mcp__worca__list_runs', {}, 'toolu_mock_task'),
        uresult('toolu_mock_child_1', '[]', 'toolu_mock_task'),
        uresult('toolu_mock_task', 'count: 0', null, { tool_use_result: {
          status: 'completed', agentId: 'mock-agent-1', agentType: 'general-purpose', content: [{ type: 'text', text: 'count: 0' }],
          resolvedModel: 'mock-haiku', totalDurationMs: 10, totalTokens: 1234, totalToolUseCount: 1,
          usage: { input_tokens: 1000, output_tokens: 234, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        } }),
      );
      answerMsg = MSG2;
    }
    if (propose) {
      frames.push(delta('[mock] '), delta('preparing '), delta('a run'), atext(MSG1, 'Preparing a run card.'),
        atool(MSG1, 'toolu_mock_propose', 'mcp__worca__propose_run', card), uresult('toolu_mock_propose', JSON.stringify({ ok: true })));
      answerMsg = MSG2;
    }
    if (answerMsg !== MSG1) frames.push(mstart(answerMsg));
    frames.push(delta('[mock] '), delta(firstLine.slice(0, 200)), atext(answerMsg, ANSWER), mdelta);
    frames.push(result(agents
      ? { modelUsage: { 'mock-haiku': { inputTokens: 1000, outputTokens: 234, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0, canonicalModel: 'mock-haiku' } } }
      : {}));
  }

  safeEmit(onEvent, { type: 'session', sessionId: SID });
  for (const f of frames) {
    abortIfNeeded(signal);
    emitRaw(onEvent, f);
    await new Promise((r) => setTimeout(r, slow ? 300 : 0));
  }
  abortIfNeeded(signal);
  if (fail || maxTurns || maxBudget) {
    // Probed on 2.1.239: these subtypes exit 1 with EMPTY stderr, so runReal rejects with the
    // stdout `result` text (MOCK_FAIL) or 'no stderr' (the limits). turn.mjs (P2) reads the
    // reducer's resultSubtype before classifying the rejection.
    const err = new Error(`claude exited with code 1: ${fail ? 'mock failure' : 'no stderr'}`);
    err.errorClass = null;
    throw err;
  }
  return { text: ANSWER, exitCode: 0 };
}

function abortIfNeeded(signal) {
  if (signal?.aborted) {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  }
}

/**
 * Offline mock: emits a few log lines and performs role-appropriate writes.
 */
async function runMock({ cwd, systemPrompt, prompt, onEvent, signal, resumeSessionId, workspaceWriteTargets, permissionMode }) {
  abortIfNeeded(signal);
  // Ask Worca mock role (ask-worca-design.md §6.7): detected from the SYSTEM PROMPT
  // ONLY and dispatched before any prompt-sourced marker is honoured — a chat
  // message containing `MOCK_ASK: /x.json` (or any MOCK_* line) must never reach
  // the MOCK_ASK file-write arm below, and the user text can never pick the role.
  // `dontAsk` is the ask recipe's permission mode and has no legacy caller
  // (spawn.mjs:20), so it takes the ask arm markers or not: a P2 turn that forgot
  // `turn.mock` must not fall through to parseMarkers(prompt)/inferRole, where the
  // chat text alone picks a role that writes to the scratch cwd.
  const sysMarkers = parseMarkers('', systemPrompt);
  if (sysMarkers.MOCK_ROLE === 'ask' || permissionMode === 'dontAsk') {
    return mockAsk({ markers: sysMarkers, prompt, cwd, onEvent, signal, resumeSessionId });
  }
  const m = parseMarkers(prompt, systemPrompt);
  const role = m.MOCK_ROLE || inferRole(prompt, systemPrompt);
  const cycle = Number(m.MOCK_CYCLE || '1') || 1;

  // Pause/Resume parity with the real runner: deterministic per-role session ids,
  // and an assertable log line when a session is re-attached.
  const sessionId = `mock-session-${role || 'unknown'}-c${cycle}`;
  safeEmit(onEvent, { type: 'session', sessionId });
  if (resumeSessionId) await emitLog(onEvent, `[mock] resumed session ${resumeSessionId}`);

  await emitLog(onEvent, `[mock] starting role=${role || 'unknown'} cycle=${cycle}`);
  abortIfNeeded(signal);

  // Ask-then-resume (spec 2026-07-11): asking replaces the role side effects
  // for this invocation; the orchestrator gates the user and resumes. The
  // session event above already fired, so the resume has a session id.
  if (m.MOCK_ASK && permissionMode !== 'dontAsk') {   // belt and braces: dontAsk already took the ask arm above
    await ensureDir(m.MOCK_ASK);
    await writeFile(m.MOCK_ASK, JSON.stringify({
      questions: [{ id: 'q1', question: `Mock question from ${role}?`, options: ['Option A', 'Option B'], allowFreeText: true }],
    }, null, 2) + '\n', 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${m.MOCK_ASK}`, raw: { mock: true, file: m.MOCK_ASK } });
    safeEmit(onEvent, { type: 'result', costUsd: 0, raw: { mock: true, type: 'result', total_cost_usd: 0 } });
    await emitLog(onEvent, `[mock] questions written; stopping for answers (role=${role})`);
    return { text: '[mock] asked questions', exitCode: 0 };
  }

  let text = `[mock] role ${role} complete`;
  switch (role) {
    case MOCK_ROLE_CLARIFY:
      text = await mockClarify(m, cycle, onEvent);
      break;
    case 'planner-plan':
      text = await mockPlannerPlan(m, onEvent);
      break;
    case 'refiner':
      text = await mockRefiner(m, cycle, onEvent);
      break;
    case MOCK_ROLE_DECOMPOSER:
      text = await mockDecomposer(m, onEvent);
      break;
    case 'implementer':
      text = await mockImplementer(m, cwd, onEvent, workspaceWriteTargets);
      break;
    case 'reviewer':
      text = await mockReviewer(m, cycle, onEvent);
      break;
    case 'plan-review':
      text = await mockPlanReview(m, cycle, onEvent);
      break;
    case 'workspace-scan':
      text = await mockWorkspaceScan(m, prompt, onEvent);
      break;
    case 'agent-gen':
      text = await mockAgentGen(m, onEvent);
      break;
    case 'workspace-reviewer':
      text = await mockWorkspaceReviewer(m, cycle, onEvent);
      break;
    case 'manual-tests-checklist':
      text = await mockManualTestsChecklist(m, onEvent);
      break;
    case 'manual-web-ui-testing':
      text = await mockManualWebUiTesting(m, cycle, onEvent);
      break;
    case 'generic-producer':
      text = await mockGenericProducer(m, onEvent);
      break;
    case 'generic-verifier':
      // Reuses the reviewer mock: writes MOCK_OUT md + MOCK_JSON verdict with the
      // standard cycle-decreasing severity, so generic loops terminate offline.
      text = await mockReviewer(m, cycle, onEvent);
      break;
    default:
      await emitLog(onEvent, `[mock] no side effects for unknown role`);
      break;
  }

  abortIfNeeded(signal);
  // Offline sub-agent indicator: for the fan-out-eligible roles, emit a couple of
  // fake Task/Agent spawn tool_use blocks + matching tool_result finishes so
  // `npm run smoke` exercises the sub-agent lifecycle (squares/pill) with no real
  // claude. Shapes mirror the real stream: spawn = assistant.tool_use(Agent) with
  // an id; finish = user.tool_result with that tool_use_id. Non-fan-out roles emit
  // nothing, so their mock output is unchanged.
  await emitMockSubAgents(role, onEvent, signal);
  abortIfNeeded(signal);
  // No model was called, so the truthful spend is $0. Emit a result event the
  // orchestrator attributes to the current phase, so mock/demo runs still show
  // a (zero) per-phase and total cost in the UI.
  safeEmit(onEvent, { type: 'result', costUsd: 0, raw: { mock: true, type: 'result', total_cost_usd: 0 } });
  await emitLog(onEvent, `[mock] done role=${role}`);
  return { text, exitCode: 0 };
}

/** Best-effort role inference if MOCK_ROLE is absent. */
function inferRole(prompt, systemPrompt) {
  const hay = `${prompt}\n${systemPrompt}`.toLowerCase();
  if (hay.includes('clarif')) return 'clarify';
  if (hay.includes('refine')) return 'refiner';
  if (hay.includes('review')) return 'reviewer';
  if (hay.includes('implement')) return 'implementer';
  if (hay.includes('plan')) return 'planner-plan';
  return 'unknown';
}

async function mockClarify(m, cycle, onEvent) {
  const out = m.MOCK_OUT;
  // Ask one question while no answers have been fed back; once the user's prior
  // answers are present (MOCK_PRIOR > 0) report no further questions so the
  // orchestrator's clarify loop terminates naturally. This mirrors the real fix:
  // the loop converges because answers are returned to the planner.
  const hasPrior = Number(m.MOCK_PRIOR || '0') > 0;
  const payload = hasPrior
    ? { questions: [] }
    : {
        questions: [
          {
            id: 'invalid-input',
            question:
              'How should the feature handle invalid input — fail fast, coerce, or ignore?',
            options: [
              'Fail fast with a clear error',
              'Coerce to a safe default',
              'Ignore and continue',
              'Reject at the boundary', // 4 options — exercises the upper bound
            ],
            allowFreeText: true,
          },
          {
            id: 'delete-behavior',
            question: 'Should delete be a hard delete or a soft delete?',
            options: ['Hard delete', 'Soft delete'], // 2 options — exercises the relaxed floor
            allowFreeText: true,
          },
        ],
      };
  await emitLog(
    onEvent,
    hasPrior
      ? '[mock] planner has no further questions'
      : '[mock] planner asking one clarifying question',
  );
  if (!out) return '[mock] clarify: no MOCK_OUT given';
  await ensureDir(out);
  await writeFile(out, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  safeEmit(onEvent, { type: 'tool_use', text: `wrote ${out}`, raw: { mock: true, file: out } });
  return JSON.stringify(payload);
}

/** Generic producer mock: deterministic content to MOCK_OUT (json if the path
 *  ends .json, else markdown). Lets user-defined agents run offline with no
 *  bespoke mock branch. */
async function mockGenericProducer(m, onEvent) {
  const out = m.MOCK_OUT;
  await emitLog(onEvent, '[mock] generic producer writing output artifact');
  if (!out) return '[mock] generic-producer: no MOCK_OUT given';
  const body = out.endsWith('.json')
    ? JSON.stringify({ mock: true, note: 'generic artifact' }, null, 2) + '\n'
    : '# Mock artifact\n\nDeterministic generic producer output.\n';
  await ensureDir(out);
  await writeFile(out, body, 'utf8');
  safeEmit(onEvent, { type: 'tool_use', text: `wrote ${out}`, raw: { mock: true, file: out } });
  return `[mock] generic artifact written to ${out}`;
}

async function mockPlannerPlan(m, onEvent) {
  const out = m.MOCK_OUT;
  const base = m.MOCK_BASE || 'feature';
  await emitLog(onEvent, '[mock] planner writing initial plan with code snippet');
  if (!out) return '[mock] planner-plan: no MOCK_OUT given';
  const md = mockPlanMarkdown(base, 1);
  await ensureDir(out);
  await writeFile(out, md, 'utf8');
  safeEmit(onEvent, { type: 'tool_use', text: `wrote ${out}`, raw: { mock: true, file: out } });
  return `[mock] plan written to ${out}`;
}

function mockPlanMarkdown(base, version) {
  return (
    `# Plan: ${base} (v${version})\n\n` +
    `## Overview\n\n` +
    `Deterministic mock plan for "${base}". Implements a small module using TDD.\n\n` +
    `## Steps\n\n` +
    `1. Write a failing test for the core function.\n` +
    `2. Implement the function until the test passes.\n` +
    `3. Refactor for clarity.\n\n` +
    `## Code Snippets\n\n` +
    '```js\n' +
    `// src/feature.mjs\n` +
    `export function feature(input) {\n` +
    `  if (input == null) throw new Error('input required');\n` +
    `  return String(input).trim();\n` +
    `}\n` +
    '```\n\n' +
    '```js\n' +
    `// test/feature.test.mjs\n` +
    `import { feature } from '../src/feature.mjs';\n` +
    `import assert from 'node:assert';\n` +
    `assert.equal(feature('  hi '), 'hi');\n` +
    '```\n\n' +
    `## Clarifications (Q&A)\n\n` +
    `- **Q:** How should the feature handle invalid input?\n` +
    `  - **A:** Fail fast with a clear error\n`
  );
}

async function mockRefiner(m, cycle, onEvent) {
  const out = m.MOCK_OUT;
  const jsonPath = m.MOCK_JSON;
  const base = m.MOCK_BASE || 'feature';
  await emitLog(onEvent, `[mock] refiner reviewing plan (cycle ${cycle})`);

  // Seed the -vN plan from the input plan if available, else from template.
  if (out) {
    let body = '';
    if (m.MOCK_IN && (await exists(m.MOCK_IN))) {
      try {
        body = await readFile(m.MOCK_IN, 'utf8');
      } catch {
        body = '';
      }
    }
    if (!body) body = mockPlanMarkdown(base, cycle + 1);
    const refined =
      body +
      `\n## Refinement notes (cycle ${cycle})\n\n` +
      `- Tightened error handling and added an edge-case test.\n`;
    await ensureDir(out);
    await writeFile(out, refined, 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${out}`, raw: { mock: true, file: out } });
  }

  // Cycle 1 has one blocking (major) issue; cycle >=2 has only minor.
  const review =
    cycle <= 1
      ? {
          summary: 'Plan is mostly solid but one major gap remains.',
          issues: [
            {
              severity: 'major',
              title: 'Missing error-path test',
              detail: 'The plan does not test the invalid-input branch.',
              location: 'test/feature.test.mjs',
            },
            {
              severity: 'minor',
              title: 'Naming',
              detail: 'Consider a more descriptive function name.',
              location: 'src/feature.mjs',
            },
          ],
        }
      : {
          summary: 'No blocking issues remain.',
          issues: [
            {
              severity: 'minor',
              title: 'Doc comment',
              detail: 'Add a short JSDoc to the exported function.',
              location: 'src/feature.mjs',
            },
          ],
        };

  if (jsonPath) {
    await ensureDir(jsonPath);
    await writeFile(jsonPath, JSON.stringify(review, null, 2) + '\n', 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${jsonPath}`, raw: { mock: true, file: jsonPath } });
  }
  return JSON.stringify(review);
}

async function mockDecomposer(m, onEvent) {
  const out = m.MOCK_OUT;
  const tasksDir = m.MOCK_TASKS_DIR;
  if (!out || !tasksDir) return '[mock] decomposer: no MOCK_OUT / MOCK_TASKS_DIR given';
  await mkdir(tasksDir, { recursive: true });
  const phases = [
    { ordinal: 1, tasks: [
      { id: 'p1t1', title: 'Slice one', file: 'tasks/p1-t1-slice-one.md' },
      { id: 'p1t2', title: 'Slice two', file: 'tasks/p1-t2-slice-two.md' },
    ] },
    { ordinal: 2, tasks: [
      { id: 'p2t1', title: 'Slice three', file: 'tasks/p2-t1-slice-three.md' },
    ] },
  ];
  for (const ph of phases) {
    for (const t of ph.tasks) {
      await writeFile(join(tasksDir, t.file.replace(/^tasks\//, '')),
        `# ${t.title}\n\nSelf-contained mock task for phase ${ph.ordinal}.\n`, 'utf8');
    }
  }
  await writeFile(out, JSON.stringify({ phases }, null, 2) + '\n', 'utf8');
  await emitLog(onEvent, `[mock] decomposer wrote ${phases.length} phases`);
  return '[mock] decomposer complete';
}

/**
 * §8.10: the mock's only cwd-dependent role. `workspaceWriteTargets` (threaded
 * runOpts -> runClaude -> runMock -> here) redirects the writes into EVERY member
 * checkout on a detached workspace run, where `cwd` is the run root and therefore no
 * repository: writing there would leave every member clean, commit nothing, and
 * produce an empty patch. Empty/absent targets keep today's exact single-dir
 * behavior — the same `edited …` event and the same returned text — so single-project
 * runs and legacy workspace runs are byte-identical. `ctx.workspace` is NOT available
 * here by design; these absolute paths are the only channel.
 */
async function mockImplementer(m, cwd, onEvent, workspaceWriteTargets) {
  await emitLog(onEvent, '[mock] implementer applying plan via TDD (red-green-refactor)');
  const targets = Array.isArray(workspaceWriteTargets) && workspaceWriteTargets.length
    ? workspaceWriteTargets
    : [cwd];
  // One stamp for the whole invocation, so a multi-member pass is deterministic.
  const stamp = new Date().toISOString();
  const written = [];
  for (const target of targets) {
    const srcDir = join(target, 'src');
    const testDir = join(target, 'test');
    await mkdir(srcDir, { recursive: true });
    await mkdir(testDir, { recursive: true });

    const srcFile = join(srcDir, 'feature.mjs');
    const testFile = join(testDir, 'feature.test.mjs');

    // Append (not overwrite) so repeated fix cycles keep producing a non-empty diff.
    const srcContent =
      `// generated by mock implementer @ ${stamp}\n` +
      `export function feature(input) {\n` +
      `  if (input == null) throw new Error('input required');\n` +
      `  return String(input).trim();\n` +
      `}\n`;
    if (await exists(srcFile)) {
      await appendFile(srcFile, `\n// fix pass @ ${stamp}\n`, 'utf8');
    } else {
      await writeFile(srcFile, srcContent, 'utf8');
    }

    const testContent =
      `// generated by mock implementer @ ${stamp}\n` +
      `import { feature } from '../src/feature.mjs';\n` +
      `import assert from 'node:assert';\n` +
      `assert.equal(feature('  hi '), 'hi');\n` +
      `assert.throws(() => feature(null));\n`;
    if (await exists(testFile)) {
      await appendFile(testFile, `\n// fix pass @ ${stamp}\n`, 'utf8');
    } else {
      await writeFile(testFile, testContent, 'utf8');
    }

    safeEmit(onEvent, { type: 'tool_use', text: `edited ${srcFile} and ${testFile}`, raw: { mock: true } });
    written.push({ srcFile, testFile });
  }
  if (written.length === 1) {
    return `[mock] implemented feature in ${written[0].srcFile} with test ${written[0].testFile}`;
  }
  return `[mock] implemented feature in ${written.length} member checkouts: ` +
    written.map((w) => w.srcFile).join(', ');
}

async function mockReviewer(m, cycle, onEvent) {
  const mdPath = m.MOCK_OUT;
  const jsonPath = m.MOCK_JSON;
  await emitLog(onEvent, `[mock] reviewer reviewing git diff (cycle ${cycle})`);

  // Cycle 1: one major. Cycle >=2: only suggestion. Loop terminates by cycle 2.
  const review =
    cycle <= 1
      ? {
          summary: 'Implementation works but a major issue needs a fix.',
          issues: [
            {
              severity: 'major',
              title: 'Unhandled empty-string input',
              detail: 'feature("") returns "" but the plan expects a thrown error.',
              location: 'src/feature.mjs',
            },
          ],
        }
      : {
          summary: 'Looks good. Only a suggestion remains.',
          issues: [
            {
              severity: 'suggestion',
              title: 'Add a usage example',
              detail: 'A short example in the README would help.',
              location: 'README.md',
            },
          ],
        };

  if (mdPath) {
    const md =
      `# Implementation Review (cycle ${cycle})\n\n` +
      `## Summary\n\n${review.summary}\n\n` +
      `## Issues\n\n` +
      review.issues
        .map((i) => `- **[${i.severity}]** ${i.title} — ${i.detail} (\`${i.location}\`)`)
        .join('\n') +
      '\n';
    await ensureDir(mdPath);
    await writeFile(mdPath, md, 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${mdPath}`, raw: { mock: true, file: mdPath } });
  }
  if (jsonPath) {
    await ensureDir(jsonPath);
    await writeFile(jsonPath, JSON.stringify(review, null, 2) + '\n', 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${jsonPath}`, raw: { mock: true, file: jsonPath } });
  }
  return JSON.stringify(review);
}

async function mockPlanReview(m, cycle, onEvent) {
  const mdPath = m.MOCK_OUT;
  const jsonPath = m.MOCK_JSON;
  await emitLog(onEvent, `[mock] plan reviewer reviewing the plan (cycle ${cycle})`);

  const review =
    cycle <= 1
      ? {
          summary: 'Plan is close but one major gap blocks implementation.',
          issues: [
            {
              severity: 'major',
              title: 'Missing error-path coverage in the plan',
              detail: 'The plan does not specify a test for the invalid-input branch.',
              location: 'Steps / Code Snippets',
            },
          ],
        }
      : {
          summary: 'Plan is correct, complete, and testable.',
          issues: [
            {
              severity: 'suggestion',
              title: 'Add a short rationale',
              detail: 'A one-line rationale per step would aid the reviewer.',
              location: 'Overview',
            },
          ],
        };

  if (mdPath) {
    const md =
      `# Plan Review (cycle ${cycle})\n\n## Summary\n\n${review.summary}\n\n## Issues\n\n` +
      review.issues.map((i) => `- **[${i.severity}]** ${i.title} — ${i.detail} (\`${i.location}\`)`).join('\n') +
      '\n';
    await ensureDir(mdPath);
    await writeFile(mdPath, md, 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${mdPath}`, raw: { mock: true, file: mdPath } });
  }
  if (jsonPath) {
    await ensureDir(jsonPath);
    await writeFile(jsonPath, JSON.stringify(review, null, 2) + '\n', 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${jsonPath}`, raw: { mock: true, file: jsonPath } });
  }
  return JSON.stringify(review);
}

/**
 * Mock the off-pipeline workspace scanner. Writes a deterministic interconnection
 * description following the §5.8 template (so the wizard textarea is populated in
 * mock mode) and emits one `INVESTIGATING <key> relations to <other>` log line per
 * project so the live-status UI can be exercised offline. Project keys are parsed
 * from the prompt's member lines (the runner does NOT spawn sub-agents — fan-out is
 * a prompt directive the mock ignores).
 */
async function mockWorkspaceScan(m, prompt, onEvent) {
  const out = m.MOCK_OUT;
  const name = m.MOCK_BASE || 'Workspace';
  // Parse `(`backtick-key`)` member markers the scan task prompt renders, in order.
  const keys = [];
  for (const line of String(prompt || '').split(/\r?\n/)) {
    const mm = line.match(/^\s*-\s+\*\*.*\*\*\s+\(`([^`]+)`\)/);
    if (mm) keys.push(mm[1]);
  }
  await emitLog(onEvent, `[mock] workspace scanner investigating ${keys.length} project(s)`);
  // One INVESTIGATING line per project (paired with the next project, round-robin),
  // then the synthesize line — the changing live-status text the server maps.
  for (let i = 0; i < keys.length; i++) {
    const other = keys[(i + 1) % keys.length] || keys[i];
    await emitLog(onEvent, `INVESTIGATING ${keys[i]} relations to ${other}`);
  }
  await emitLog(onEvent, 'SYNTHESIZING workspace description');

  const projects = keys.length ? keys : ['project-a', 'project-b'];
  const md =
    `# Workspace: ${name}\n` +
    `## Overview\n` +
    `Deterministic mock interconnection description for ${projects.length} member project(s). ` +
    `The dominant integration theme is a shared REST contract.\n` +
    `## Projects\n` +
    projects.map((k) => `- ${k}: member project`).join('\n') + '\n' +
    `## Interconnections\n` +
    (projects.length >= 2
      ? `- ${projects[0]} -> ${projects[1]}: REST API; ${projects[0]} calls ${projects[1]}'s HTTP endpoints.\n`
      : `- (single project — no interconnections)\n`) +
    `## Change-coordination notes\n` +
    `- Changes that touch the shared REST contract must be coordinated across both members.\n` +
    `## Suggested change order\n` +
    (projects.length >= 2 ? `${projects[1]} before ${projects[0]} (provider before consumer).\n` : `no strict ordering\n`);

  if (!out) return '[mock] workspace-scan: no MOCK_OUT given';
  await ensureDir(out);
  await writeFile(out, md, 'utf8');
  safeEmit(onEvent, { type: 'tool_use', text: `wrote ${out}`, raw: { mock: true, file: out } });
  return `[mock] workspace description written to ${out}`;
}

/**
 * Mock the agent builder. Writes a deterministic meta JSON to MOCK_JSON and —
 * ONLY when MOCK_OUT is present (Mode A) — a deterministic agent body to MOCK_OUT.
 * Mode B (user-pasted markdown) omits MOCK_OUT so the mock never writes a body.
 */
async function mockAgentGen(m, onEvent) {
  const name = m.MOCK_BASE || 'Custom Agent';
  await emitLog(onEvent, `DRAFTING agent metadata for ${name}`);
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());
  const key = words.length
    ? words[0] + words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
    : 'customAgent';
  const meta = {
    key, displayName: name, description: `mock-generated agent for ${name}`,
    color: 'amber', runnerType: 'producer', loopSource: false, fanOut: false,
    asksQuestions: true, questionsLocked: false, questionsDefault: false,
    consumes: ['plan'], optionalConsumes: [], produces: ['review'], connectsTo: '*', order: 99,
  };
  if (m.MOCK_OUT) {
    const md = `# Agent: ${name}\n\nYou are ${name} (deterministic mock body).\n\n## Inputs\n- the plan\n\n## Outputs\n- a review markdown\n`;
    await ensureDir(m.MOCK_OUT);
    await writeFile(m.MOCK_OUT, md, 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${m.MOCK_OUT}`, raw: { mock: true, file: m.MOCK_OUT } });
  }
  if (m.MOCK_JSON) {
    await ensureDir(m.MOCK_JSON);
    await writeFile(m.MOCK_JSON, JSON.stringify(meta, null, 2) + '\n', 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${m.MOCK_JSON}`, raw: { mock: true, file: m.MOCK_JSON } });
  }
  return '[mock] agent draft written';
}

/**
 * Mock the in-pipeline workspace reviewer. Mirrors mockReviewer: the blocking-issue
 * count DECREASES with `cycle` so the workspace review -> implementer loop terminates
 * deterministically. Writes ONE merged review markdown + ONE merged review JSON
 * (the union shape the real synthesizer produces, with projectKey-prefixed locations).
 */
async function mockWorkspaceReviewer(m, cycle, onEvent) {
  const mdPath = m.MOCK_OUT;
  const jsonPath = m.MOCK_JSON;
  await emitLog(onEvent, `[mock] workspace reviewer synthesizing per-project reviews (cycle ${cycle})`);

  // Cycle 1: two major issues across two members (a real union). Cycle >=2: only a
  // suggestion. The loop terminates by cycle 2 (no critical/major remain).
  const review =
    cycle <= 1
      ? {
          summary: 'Across the member projects, two major issues need a fix before acceptance.',
          issues: [
            {
              severity: 'major',
              title: 'Unhandled empty-string input',
              detail: 'feature("") returns "" but the plan expects a thrown error.',
              location: 'project-a: src/feature.mjs',
            },
            {
              severity: 'major',
              title: 'Missing contract validation',
              detail: 'The consumer does not validate the provider response shape.',
              location: 'project-b: src/client.mjs',
            },
          ],
        }
      : {
          summary: 'All member projects look good. Only a suggestion remains.',
          issues: [
            {
              severity: 'suggestion',
              title: 'Add a usage example',
              detail: 'A short cross-project example in the README would help.',
              location: 'project-a: README.md',
            },
          ],
        };

  if (mdPath) {
    const md =
      `# Workspace Implementation Review (cycle ${cycle})\n\n` +
      `## Summary\n\n${review.summary}\n\n` +
      `## Issues (union across all member projects)\n\n` +
      review.issues
        .map((i) => `- **[${i.severity}]** ${i.title} — ${i.detail} (\`${i.location}\`)`)
        .join('\n') +
      '\n';
    await ensureDir(mdPath);
    await writeFile(mdPath, md, 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${mdPath}`, raw: { mock: true, file: mdPath } });
  }
  if (jsonPath) {
    await ensureDir(jsonPath);
    await writeFile(jsonPath, JSON.stringify(review, null, 2) + '\n', 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${jsonPath}`, raw: { mock: true, file: jsonPath } });
  }
  return JSON.stringify(review);
}

async function mockManualTestsChecklist(m, onEvent) {
  const out = m.MOCK_OUT;
  await emitLog(onEvent, '[mock] manual-tests author drafting checklist');
  if (!out) return '[mock] manual-tests-checklist: no MOCK_OUT given';
  const md =
    `# Manual Test Checklist\n\n` +
    `- [ ] App boots without errors — open the app; expect no console errors.\n` +
    `- [ ] Core flow works — exercise the new feature; expect the documented result.\n` +
    `- [ ] Invalid input is handled — submit bad input; expect a clear error.\n`;
  await ensureDir(out);
  await writeFile(out, md, 'utf8');
  safeEmit(onEvent, { type: 'tool_use', text: `wrote ${out}`, raw: { mock: true, file: out } });
  return `[mock] manual checklist written to ${out}`;
}

async function mockManualWebUiTesting(m, cycle, onEvent) {
  const mdPath = m.MOCK_OUT;
  const jsonPath = m.MOCK_JSON;
  await emitLog(onEvent, `[mock] manual web UI testing run (cycle ${cycle})`);
  // Cycle 1: one major (a case fails). Cycle >=2: only a suggestion. Terminates by cycle 2.
  const review =
    cycle <= 1
      ? {
          summary: 'One manual case failed in the live UI.',
          issues: [
            {
              severity: 'major',
              title: 'Core flow case failed',
              detail: 'The documented result did not appear when exercising the feature.',
              location: 'manual-tests-checklist.md',
            },
          ],
        }
      : {
          summary: 'All manual cases passed.',
          issues: [
            {
              severity: 'suggestion',
              title: 'Add an accessibility pass',
              detail: 'Consider a keyboard-only walkthrough next time.',
              location: 'manual-tests-checklist.md',
            },
          ],
        };
  if (mdPath) {
    const md =
      `# Manual Web UI Test Result (cycle ${cycle})\n\n## Summary\n\n${review.summary}\n\n## Issues\n\n` +
      review.issues.map((i) => `- **[${i.severity}]** ${i.title} — ${i.detail} (\`${i.location}\`)`).join('\n') +
      '\n';
    await ensureDir(mdPath);
    await writeFile(mdPath, md, 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${mdPath}`, raw: { mock: true, file: mdPath } });
  }
  if (jsonPath) {
    await ensureDir(jsonPath);
    await writeFile(jsonPath, JSON.stringify(review, null, 2) + '\n', 'utf8');
    safeEmit(onEvent, { type: 'tool_use', text: `wrote ${jsonPath}`, raw: { mock: true, file: jsonPath } });
  }
  return JSON.stringify(review);
}
