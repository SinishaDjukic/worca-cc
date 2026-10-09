// src/core/engines/claude.mjs
// The Claude Code adapter: argv (buildClaudeArgs and the --settings seam), the
// GH #380 staging plan, the model env and wire model, the host-guard preamble,
// and the stream-json line parser. Process supervision is engines/spawn.mjs;
// the public entry point stays runClaude in src/core/claude-runner.mjs.
import { prepareModelEnv, envFlag, describeModelEnv, withProviderModesOff, withStreamTimeouts } from '../model-env.mjs';
import { effectiveDebugSpawn } from '../settings.mjs';
import { classifyError } from '../recoverable-error.mjs';
import { bridgeEvents } from '../bridge/telemetry.mjs';
import { explainUnspawnableClaude, resolveClaudeBin } from '../preflight.mjs';
import { hostGuardEnabled, hostGuardHookEntry, hostGuardSystemPrompt } from '../host-guard.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentIdentity } from '../agent-user.mjs';
import { agentIdentityFor } from '../agent-pool.mjs';
import { brokerEnabled, brokerInfo, mintSpawnToken, revokeSpawnToken, slotBaseUrl, slotOfBaseUrl } from '../broker-client.mjs';
import { resolveBillTo, normalizeBillTo, currentOwner } from '../billing.mjs';
import { redactSecrets, redactDeep, createRedactor } from '../redact.mjs';
import { MODEL_CREDENTIAL_ENV_KEYS } from '../broker-guard.mjs';
import { modelSlot } from '../broker-routing.mjs';
import { pluginModelRoute, syncPluginSlots } from '../plugin-broker-slots.mjs';
import { superviseSpawn, composeSpawnEnv, cleanRunEnv, safeEmit } from './spawn.mjs';
import { CAPABILITY_KEYS } from './capabilities.mjs';

export const DEFAULT_BIN = process.env.WORCA_CLAUDE_BIN || process.env.ORCH_CLAUDE_BIN || 'claude';

// Settings keys a caller's extraSettings never sets (skills registry §4.1): the runner's own guardrail `permissions`
// and `hooks` (telemetry + the host guard), and the two that would switch those hooks off or rewrite the env the
// host guard reads (`disableAllHooks`, `env`).
const RUNNER_SETTINGS_KEYS = new Set(['permissions', 'hooks', 'disableAllHooks', 'env']);

/** A caller's extra settings (skills registry §4.1: Ask's `disableSkillShellExecution`) minus the runner's own
 *  keys and undefined values; null when nothing is left or the value is not a plain object. */
function extraSettingsOf(extraSettings) {
  if (!extraSettings || typeof extraSettings !== 'object' || Array.isArray(extraSettings)) return null;
  const out = {};
  for (const [k, v] of Object.entries(extraSettings)) if (!RUNNER_SETTINGS_KEYS.has(k) && v !== undefined) out[k] = v;
  return Object.keys(out).length ? out : null;
}

/** What `--settings` carries, or null when there is nothing to carry (no hook
 *  telemetry, no permission rules, no host guard, no extra settings) — then the flag is omitted
 *  entirely. `hostGuard` (set by runClaudeProcess, gated by hostGuardEnabled) merges the
 *  host-process-protection PreToolUse hook into the SAME single payload; the
 *  returned `hook` flag stays telemetry-only (it drives --include-hook-events,
 *  which the guard does not need). `extraSettings` (skills registry §4.1) merges in
 *  first, so the runner's own `hooks` / `permissions` always win. */
export function buildSettingsPayload(permissionRules, { hostGuard = false, extraSettings = null } = {}) {
  const hook = buildHookSettings();
  const extra = extraSettingsOf(extraSettings);
  const guard = hostGuard && hostGuardEnabled() ? hostGuardHookEntry() : null;
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
  if (!hook && !hasRules && !guard && !extra) return null;
  const settings = { ...(extra ?? {}) };
  if (hook) settings.hooks = { ...hook.hooks };
  if (guard) {
    settings.hooks = settings.hooks ?? {};
    settings.hooks.PreToolUse = [...(settings.hooks.PreToolUse ?? []), guard];
  }
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

const ARGV_VALUE_PREVIEW = 64;

/** A copy of `args` safe to log: EVERY token longer than ARGV_VALUE_PREVIEW is
 *  shortened to a 64-char prefix + "…(<N> chars)". Token-level, not flag-aware, on
 *  purpose: an inline prompt, the `--settings` JSON (uncapped for a custom rule
 *  set), `--allowedTools`, `--mcp-config` — any free-text value buildClaudeArgs
 *  adds later — is capped without this list having to track it. Flags and short
 *  values pass through verbatim, so argv order is always preserved. Pure. */
export function redactArgvForLog(args) {
  return args.map((a) => {
    const v = String(a);
    return v.length > ARGV_VALUE_PREVIEW ? `${v.slice(0, ARGV_VALUE_PREVIEW)}…(${v.length} chars)` : v;
  });
}

/** Log each npm-shim resolution once per process, not once per spawn. */
const _resolveNoted = new Set();

/** The spawn-failure Error for `bin`: the OS message, plus the Windows npm-shim
 *  explanation when that is what actually went wrong (ENOENT on a bare name
 *  whose only PATH hit is claude.cmd; EINVAL on an explicit .cmd). */
function spawnFailure(bin, err, prefix) {
  const unspawnable = /ENOENT|EINVAL/.test(String(err && err.code || err && err.message || ''));
  const hint = unspawnable ? explainUnspawnableClaude(bin) : null;
  const out = new Error(`${prefix}: ${err.message}${hint ? ` — ${hint}` : ''}`);
  // An unspawnable CLI (not installed / not on PATH) is user-fixable, not a
  // pipeline bug: stamp the recovery class so the orchestrator's gate pauses
  // the run for manual resume instead of hard-failing it (ENOENT matches no
  // message-sniff pattern, so without the stamp it would classify null).
  if (unspawnable) out.errorClass = 'network';
  return out;
}

// stderr lines the CLI prints on spawns that go on to succeed, which are never
// the cause of a failure. `[claude-code:unrecognized_model]` fires on EVERY spawn
// whose model id the CLI does not know — every bridged or endpoint-routed catalog
// id — so as exit detail it masked the real cause (a 429 carried on the stdout
// result) and classified null, which kept the rate-limit retry from running.
// Such a line is still streamed as a stderr event; it only stops being evidence.
export const BENIGN_STDERR_PATTERNS = Object.freeze([
  /^\[claude-code:unrecognized_model\]/,
]);

/** Whether a stderr line is a known-benign CLI notice (BENIGN_STDERR_PATTERNS). */
export function isBenignStderrLine(line) {
  const t = String(line ?? '').trim();
  return !!t && BENIGN_STDERR_PATTERNS.some((re) => re.test(t));
}

// A bridged spawn's base URL names its catalog id and run tag (bridge/server.mjs
// bridgeBaseUrl: …/m/<id>[/r/<tag>]). Null for any other endpoint.
const BRIDGE_PATH_RE = /\/m\/([^/?#]+)(?:\/r\/([^/?#]+))?\/?$/;
function bridgeSpawnKey(modelEnv) {
  const url = modelEnv && typeof modelEnv.ANTHROPIC_BASE_URL === 'string' ? modelEnv.ANTHROPIC_BASE_URL : '';
  const m = /^https?:\/\/127\.0\.0\.1:\d+\//.test(url) ? BRIDGE_PATH_RE.exec(url) : null;
  if (!m) return null;
  try {
    return { catalogId: decodeURIComponent(m[1]).toLowerCase(), tag: m[2] ? decodeURIComponent(m[2]) : '' };
  } catch { return null; }
}

// The CLI reports an upstream API failure as an assistant text block ("API Error:
// Request rejected (429) · …"), usually repeated in the is_error result. The
// assistant copy is kept as the fallback detail for an exit without a result.
const API_ERROR_TEXT_RE = /^API Error\b/;

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
 * (anything but "", "0", "false") turns it on. OFF ⇒ runClaudeProcess adds NO extra flags
 * and the baseline sub-agent lifecycle (tool_use/tool_result) is unaffected.
 */
export function subagentHooksEnabled() {
  return envFlag('WORCA_SUBAGENT_HOOKS');
}

/**
 * Opt-in spawn diagnostics, DEFAULT OFF. A NON-EMPTY WORCA_DEBUG_SPAWN in the
 * environment wins (envFlag rule: any value but "0"/"false" turns it on, so an
 * exported "0" is an explicit OFF); otherwise the stored `debugSpawnEnabled`
 * setting applies — read fresh per spawn (settings.mjs#effectiveDebugSpawn, the
 * one precedence rule the settings API also reports), so the UI checkbox reaches
 * the next spawn in this process AND in a CLI run with no restart and no env
 * mutation. OFF ⇒ runClaudeProcess emits NO spawn-debug event and does not touch
 * argv/env, so the spawn path is byte-identical to today. (The once-per-process
 * "routing env applied" confirmation below is a separate, always-on line: it
 * fires only for a model env that carries an ANTHROPIC_* routing key, once per
 * distinct model + env, never per spawn.) Read directly in runClaudeProcess (not a
 * runClaude option) so it bypasses the runClaude→runClaudeProcess gate by construction.
 */
export function debugSpawnEnabled() {
  return effectiveDebugSpawn().enabled;
}

/** Once per process per distinct (model, described env): see runClaudeProcess. */
const _routingNoted = new Set();

// ── Sub-agent telemetry + the --settings seam ────────────────────────────────
// Telemetry is GATED (subagentHooksEnabled) and OFF by default. When on it adds
// `--include-hook-events` (surfaces hook lifecycle on the SAME stdout stream)
// and registers a PostToolUse hook matched to `Agent` that runs `cat`. The
// lifecycle line the CLI streams (system/hook_response) carries only hook_name/
// hook_event plus the command's output: the PostToolUse payload (tool_use_id,
// tool_response with totalDurationMs/totalTokens/usage) reaches the stream ONLY
// as that echoed stdout, so the command must echo its stdin, and must run
// synchronously for the response to land on the stream we read. `--bare`-proof
// (inline settings need no settings file). The argv contract is on buildSettingsArgs.
// ─────────────────────────────────────────────────────────────────────────────

/** The telemetry hook-settings OBJECT (see subagentHooksEnabled). null when off. */
export function buildHookSettings() {
  if (!subagentHooksEnabled()) return null;
  return {
    hooks: { PostToolUse: [{ matcher: 'Agent', hooks: [{ type: 'command', command: 'cat' }] }] },
  };
}

/**
 * Is this stream-json line a hook lifecycle event? Under --include-hook-events
 * the CLI emits (verified on Claude Code 2.1.258 and 2.1.282, see
 * test/fixtures/hooks/):
 *   {"type":"system","subtype":"hook_started","hook_name":"PostToolUse:Agent","hook_event":"PostToolUse",…}
 *   {"type":"system","subtype":"hook_response",…,"output":…,"stdout":…,"exit_code":0,"outcome":"success"}
 * and "hook_progress" for long-running hooks. There is no `hook-event` type and
 * no top-level `hook_event_name` on the envelope.
 * @param {any} evt
 * @returns {boolean}
 */
export function isHookEvent(evt) {
  return evt?.type === 'system' &&
    (evt.subtype === 'hook_started' || evt.subtype === 'hook_progress' || evt.subtype === 'hook_response');
}

/**
 * The ONE --settings seam. Telemetry hook settings (gated, default off) and the
 * guardrails `permissions` rules merge into a SINGLE inline JSON — two --settings
 * flags would be last-wins at the CLI, silently dropping one payload.
 * [] when there is nothing to say, so the baseline argv is byte-identical.
 * @param {{deny?:string[],allow?:string[],ask?:string[]}|null|undefined} permissionRules
 * @param {string|null} [settingsFile] staged path (GH #380): `--settings <path>` carries the same JSON
 * @param {{hostGuard?:boolean, extraSettings?:object|null}} [opts] host-process guard (runClaudeProcess sets it; see
 *   buildSettingsPayload) and extra settings merged into the same payload (skills registry §4.1)
 * @returns {string[]}
 */
export function buildSettingsArgs(permissionRules, settingsFile = null, { hostGuard = false, extraSettings = null } = {}) {
  const payload = buildSettingsPayload(permissionRules, { hostGuard, extraSettings });
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
 *  `--add-dir` carries Ask Worca's memory mount (with the
 *  CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 override, which is what makes the CLI LOAD rules
 *  from it) and, since the memory write split, every pipeline spawn's writable memory copy (no
 *  override: nothing is loaded from it, it is only made editable under acceptEdits). */
export function buildClaudeArgs({
  prompt, systemPrompt, permissionMode, model, effort, allowedTools, resumeSessionId,
  mcpConfigPath, mcpServerGrants, permissionRules,
  // Ask Worca hardening options (ask-worca-design.md §6.3). `tools` is renamed on the
  // way in because the legacy body below already owns a local `tools` (the
  // --allowedTools union).
  tools: builtinTools, strictMcpConfig, settingSources, disableSlashCommands, includePartialMessages,
  maxTurns, maxBudgetUsd, appendSubagentSystemPrompt, hostGuard, addDirs, disallowedTools, agents,
  pluginDirs, extraSettings,
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
  for (const a of buildSettingsArgs(permissionRules, settingsFile, { hostGuard, extraSettings })) args.push(a);
  if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath);
  const tools = Array.isArray(allowedTools) ? allowedTools.slice() : [];
  for (const s of (Array.isArray(mcpServerGrants) ? mcpServerGrants : [])) {
    if (s && !tools.includes(s)) tools.push(s);          // union, never a duplicate
  }
  if (tools.length) {
    args.push('--allowedTools', tools.join(','));
  }
  // Model bridge (model-bridge-design.md §5.3): a translated (openai-chat / openai-responses)
  // model has no server-side web tools, so the runner withholds them outright —
  // a deny outranks any allow, frontmatter grant included. Absent/empty ⇒
  // nothing emitted, so every other argv stays byte-identical.
  const denied = Array.isArray(disallowedTools) ? disallowedTools.filter((s) => typeof s === 'string' && s) : [];
  if (denied.length) args.push('--disallowedTools', denied.join(','));
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
  // Run-scoped sub-agent definitions (the pinned investigator, phases.mjs investigatorAgents).
  // ALWAYS inline JSON, on the staged branch too: Claude Code reads `--agents <file>` only from
  // 2.1.281, and docker/CLAUDE_CODE_VERSION pins 2.1.278 (a path there fails at spawn with
  // "Invalid --agents configuration"). The definition is ~600 chars. Before --add-dir (LAST).
  if (agents && typeof agents === 'object' && Object.keys(agents).length) {
    args.push('--agents', JSON.stringify(agents));
  }
  // Native-rules revision (2026-09-13): Ask Worca's memory mount. LAST, so every earlier argv
  // stays a prefix; absent / [] / non-strings ⇒ nothing (the `names` filter above).
  // Skills registry §4.1: one generated plugin per set (materializeSkillMount), after --agents and before
  // --add-dir; absent / [] / non-strings ⇒ nothing, so every earlier argv stays byte-identical.
  for (const d of names(pluginDirs)) args.push('--plugin-dir', d);
  for (const d of names(addDirs)) args.push('--add-dir', d);
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
  const payload = buildSettingsPayload(opts.permissionRules, { hostGuard: opts.hostGuard, extraSettings: opts.extraSettings });
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
 *  spawn, and it keeps the spawn sequence in runClaudeProcess linear. */
export function stageClaudeInvocation(opts, { bin = DEFAULT_BIN, limit = ARGV_INLINE_LIMIT } = {}) {
  let dir = null;
  const plan = planClaudeInvocation(opts, { bin, limit, dir: () => (dir = mkdtempSync(join(tmpdir(), 'worca-claude-'))) });
  for (const file of plan.files) writeFileSync(file.path, file.content, 'utf8');
  return { ...plan, dir };
}

export function runClaudeProcess({ cwd, systemPrompt, prompt, allowedTools, permissionMode, model, effort, onEvent, signal, bin, resumeSessionId, mcpConfigPath, mcpServerGrants, permissionRules, envScrub, envAllowlist, modelEnv, spawnEnv: runSpawnEnv, redactValues, disallowedTools, tools, strictMcpConfig, settingSources, disableSlashCommands, includePartialMessages, maxTurns, maxBudgetUsd, appendSubagentSystemPrompt, addDirs, agents, pluginDirs, extraSettings, argvInlineLimit, asAgent }) { // billTo/spawnKind/runId/threadId are consumed by runViaBroker
  // MCP registry §5.5.3: with registry secrets in this spawn's env, every emit, the result text and the error
  // message leave redacted — wrapped once here, so the broker path (which calls runClaudeProcess) is covered too.
  const redactor = Array.isArray(redactValues) && redactValues.length ? createRedactor(redactValues) : null;
  if (redactor) { const emit = onEvent; onEvent = (e) => emit(redactor.deep(e)); }
  return new Promise((resolveRaw, rejectRaw) => {
    const resolveP = redactor ? (r) => resolveRaw({ ...r, text: redactor.text(r.text) }) : resolveRaw;
    const rejectP = redactor ? (err) => {
      if (err && typeof err.message === 'string') err.message = redactor.text(err.message);
      if (err && typeof err.stack === 'string') err.stack = redactor.text(err.stack);
      rejectRaw(err);
    } : rejectRaw;
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
    // Confirm a resolved card's routing env actually reached a spawn — even when
    // the wire id equals the catalog id, the case the wire-model line above stays
    // silent for (that silence is exactly what hid a gateway card whose
    // ANTHROPIC_MODEL matched its catalog id). Fires only for an env that carries
    // an ANTHROPIC_* routing key (Ask Worca merges a CLAUDE_CODE_* knob into
    // EVERY turn's env, which is not routing) and once per process per distinct
    // line, like _resolveNoted — never per spawn. describeModelEnv prints the
    // routing keys readable (endpoint, wire id — the diagnostic) and every other
    // key as `<set, N chars>`: ANTHROPIC_AUTH_TOKEN and plugin {secret} values live
    // in this map and no part of them may reach a log. Worded WITHOUT the
    // substrings "wire model"/"modelEnv" — test/spawn-args.test.mjs counts by those.
    const routingApplied = safeModelEnv && Object.keys(safeModelEnv).some((k) => k.startsWith('ANTHROPIC_'))
      ? describeModelEnv(safeModelEnv) : null;
    if (routingApplied) {
      const line = `[worca] model ${JSON.stringify(model ?? '')}: routing env applied: ${routingApplied}`;
      if (!_routingNoted.has(line)) { _routingNoted.add(line); console.warn(line); }
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
    // Host guard (host-guard.mjs, 2026-08-31 incident): every REAL spawn — any
    // role, custom agent, plugin agent, ask chat — carries the protection
    // preamble, the PreToolUse hook (hostGuard -> the --settings payload), and
    // WORCA_HOST_PID (below). One kill-switch: WORCA_HOST_GUARD=0. Mock spawns
    // nothing, so runMock stays untouched.
    const guardOn = hostGuardEnabled();
    const guardedSystemPrompt = guardOn
      ? [hostGuardSystemPrompt(process.pid), systemPrompt].filter(Boolean).join('\n\n')
      : systemPrompt;
    let plan;
    try {
      plan = stageClaudeInvocation({
        prompt, systemPrompt: guardedSystemPrompt, hostGuard: guardOn,
        permissionMode, model: wireModel, effort, allowedTools, resumeSessionId,
        mcpConfigPath, mcpServerGrants, permissionRules,
        tools, strictMcpConfig, settingSources, disableSlashCommands, includePartialMessages,
        maxTurns, maxBudgetUsd, appendSubagentSystemPrompt, addDirs, disallowedTools, agents,
        pluginDirs, extraSettings,
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

    // Scrub (guardrails), then the run-level env (wsmap D9: a fan-out node's
    // concurrency cap; it survives scrub and replaces an ambient value), then the
    // model env merged LAST (it survives scrub and wins collisions: explicit
    // operator config outranks ambient-env hygiene, and a catalog entry that sets
    // the cap wins too), then WORCA_HOST_PID on every guarded spawn (scrub would
    // drop it — WORCA_ is not an allowlisted prefix), then no GitHub or Azure DevOps
    // credential in any tier (src/core/host-credentials.mjs): pushes and PRs are worca's own
    // calls, and no broker secret (composeSpawnEnv).
    const { env: composedEnv, scrubbed } = composeSpawnEnv({
      envScrub, envAllowlist, prefixes: ['ANTHROPIC_', 'CLAUDE_'],
      runEnv: cleanRunEnv(runSpawnEnv), overlay: safeModelEnv, hostPid: guardOn ? process.pid : null,
    });
    let spawnEnv = composedEnv;
    // With the broker on, no ambient model credential reaches the agent either (the
    // boot guard refuses them; this is the second line): the spawn's broker token
    // is the only one it holds, and it wins over nothing.
    if (brokerEnabled()) {
      for (const k of MODEL_CREDENTIAL_ENV_KEYS) if (k !== 'ANTHROPIC_AUTH_TOKEN' || !safeModelEnv?.ANTHROPIC_AUTH_TOKEN) delete spawnEnv[k];
    }
    // Routed off first party, a long turn behind a stream-buffering gateway must
    // not hit Bun's ~5-min fetch timeout or the CLI's first-byte watchdog
    // (model-env.mjs#withStreamTimeouts).
    // Read off the FINAL env so the ambient shell, the run env and the model entry
    // all count for both the route and an explicit value.
    spawnEnv = withStreamTimeouts(spawnEnv);

    // Opt-in spawn diagnostics (WORCA_DEBUG_SPAWN, default off — byte-identical spawn
    // path when unset). Everything here is derived from values already computed above
    // (safeModelEnv is null or non-empty, so the routing field is either the described
    // env — secrets as `<set, N chars>` — or "(none)"). Emitted right before spawn so
    // it reflects the exact bin/argv/env handed to the child, ONCE, as the same
    // `stderr` event the child's own stderr rides (run-harness logs it at `warn`
    // into the run stream and live-log.ndjson; nothing here also console.warns, so
    // a run never prints the line twice). Field is `routingEnv`, not `modelEnv`:
    // test/spawn-args.test.mjs counts "modelEnv" warnings for the dropped-key path.
    if (debugSpawnEnabled()) {
      const summary =
        `[worca] spawn-debug: bin=${JSON.stringify(resolved.bin)} `
        + `argv=${JSON.stringify(redactArgvForLog(args))} `
        + `promptViaStdin=${plan.stdin != null} staged=${plan.staged} `
        + `envScrub=${scrubbed ? 'on' : 'off'} childEnvKeys=${Object.keys(spawnEnv).length} `
        + `routingEnv=[${safeModelEnv ? describeModelEnv(safeModelEnv) : '(none)'}]`;
      safeEmit(onEvent, { type: 'stderr', stream: 'err', text: summary });
    }

    let resultText = '';
    let assistantText = '';
    // In stream-json mode claude reports failures (auth, unknown/unavailable
    // model, API errors) as a terminal `result` event with is_error:true on
    // STDOUT and exits non-zero with EMPTY stderr. Capture that text so a
    // non-zero exit surfaces the real cause instead of an opaque "no stderr".
    let errorDetail = '';
    let apiErrorText = '';   // the last "API Error: …" assistant text (API_ERROR_TEXT_RE)
    // A bridged spawn: the in-process bridge records the upstream's own reason
    // (bridge/telemetry.mjs 'failure'), matched on this spawn's catalog id + tag
    // as model-test.mjs does. The last fallback before the CLI's bare notice, so
    // a CLI that exits without an API Error line still names the real cause.
    let bridgeFailureText = '';
    const bridgeKey = bridgeSpawnKey(modelEnv);
    const onBridgeFailure = (e) => {
      if (e && e.message && String(e.catalogId || '').toLowerCase() === bridgeKey.catalogId && (e.tag || '') === bridgeKey.tag) {
        bridgeFailureText = String(e.message);
      }
    };
    if (bridgeKey) bridgeEvents.on('failure', onBridgeFailure);

    superviseSpawn({
      file: resolved.bin, args, displayBin: bin, cwd, env: spawnEnv, stdin: plan.stdin ?? null,
      signal, asAgent, stagedDir: plan.dir || null, onEvent,
      cleanup: () => {
        if (bridgeKey) bridgeEvents.off('failure', onBridgeFailure);
        cleanupStaged();
      },
      stdoutErrorDetail: () => errorDetail || apiErrorText || bridgeFailureText,
      classify: classifyError,
      isBenignStderr: isBenignStderrLine,
      redactText: redactor ? redactor.text : null,
      spawnError: (err, prefix) => spawnFailure(bin, err, prefix),
      onDone: (code) => ({ text: resultText || assistantText, exitCode: code }),
      onStdoutLine: (trimmed) => {
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
        if (evt?.type === 'assistant' && text) {
          assistantText += text;
          if (API_ERROR_TEXT_RE.test(text.trim())) apiErrorText = text.trim();
        }
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
        // Surface Claude's hook lifecycle lines (only present under --include-hook-events)
        // as a stable type:'hook-event' the orchestrator reads for sub-agent telemetry.
        if (isHookEvent(evt)) {
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
      },
    }).then(resolveP, rejectP);
  });
}

/**
 * Pull human-readable text out of a stream-json event. Handles the common
 * Claude Code shapes: { type:"assistant", message:{ content:[{type:"text", text}] } }
 * and { type:"result", result:"..." }.
 */
export function extractText(evt) {
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

// ── Credential broker ────────────────────────────────────────────────────────
// With WORCA_BROKER_URL set (plans/credential-broker-design.html §5.2), worca holds
// no model credential. Each spawn gets its own short-lived token from the broker and
// talks to `<broker>/p/<slot>`; the broker adds the paying person's key on the way
// out. The token is revoked when the process exits, and never survives in anything
// worca stores: events and error text pass through redactSecrets.

/** Error in the recovery classes the orchestrator already knows (auth pauses, never retries blindly). */
function brokerSpawnError(message, errorClass = 'auth') {
  const err = new Error(`worca-broker: ${message}`);
  err.errorClass = errorClass;
  return err;
}

function isLoopbackUrl(v) {
  try {
    const h = new URL(v).hostname.replace(/^\[|\]$/g, '');
    return h === '127.0.0.1' || h === 'localhost' || h === '::1';
  } catch { return false; }
}

/** Which broker slot a spawn's model env routes to: {slot}, {bridge:true}, or {error}. */
export function brokerRouteFor(modelEnv, env = process.env) {
  const base = modelEnv && typeof modelEnv.ANTHROPIC_BASE_URL === 'string' ? modelEnv.ANTHROPIC_BASE_URL.trim() : '';
  if (!base) return { slot: 'anthropic' };
  const slot = slotOfBaseUrl(base, env);
  if (slot) return { slot };
  // worca's own in-process bridge (bridge/server.mjs): it reaches a keyless local
  // endpoint itself; the broker guard refuses any bridged entry that holds a key.
  if (isLoopbackUrl(base)) return { bridge: true };
  let host = base;
  try { host = new URL(base).host; } catch { /* keep the raw value */ }
  return { error: `this model routes to ${host} directly; with the credential broker on, a model must use a broker slot (set its credential on the Models page)` };
}

const SPAWN_TTL_SEC = { aux: 600, test: 600, ask: 7200, phase: 86400 };

async function runViaBroker(opts) {
  // An env-style plugin model spends from its plugin's own slot, at the plugin's base path;
  // the plugin's secrets were never resolved into its env (config.mjs).
  const pluginRoute = pluginModelRoute(opts.model);
  if (pluginRoute?.error) throw brokerSpawnError(pluginRoute.error);
  const route = pluginRoute || brokerRouteFor(opts.modelEnv);
  if (route.error) throw brokerSpawnError(route.error);
  // Register the plugins' slots first if they changed since (a plugin enabled from the CLI).
  try { await syncPluginSlots(); }
  catch (err) { if (pluginRoute) throw brokerSpawnError(`cannot register plugin credential slots: ${err.message}`, 'network'); }
  const onEvent = opts.onEvent;
  const redactingOnEvent = (e) => onEvent(redactDeep(e));

  let info;
  try { info = await brokerInfo(); }
  catch (err) { throw brokerSpawnError(err.message, 'network'); }

  // A bridged model (OpenAI, OpenRouter, Copilot, a gateway): the CLI still talks to worca's
  // loopback bridge, which translates, but it presents THIS spawn's broker token and the
  // bridge forwards it to the model's slot. A keyless local endpoint needs no token.
  let bridgeSlot = null;
  if (route.bridge) {
    const ms = modelSlot(opts.model);
    if (ms && ms.error) throw brokerSpawnError(ms.error);
    if (!ms || ms.keyless) {
      try {
        const r = await runClaudeProcess({ ...opts, onEvent: redactingOnEvent });
        return { ...r, text: redactSecrets(r.text) };
      } catch (err) { if (err && typeof err.message === 'string') err.message = redactSecrets(err.message); throw err; }
    }
    bridgeSlot = ms.slot;
  }
  let billTo = resolveBillTo(opts.billTo);
  if (info.mode === 'multi' && (!billTo || billTo === 'local')) {
    billTo = normalizeBillTo(process.env.WORCA_BROKER_SYSTEM_BILL_TO);
    if (!billTo) throw brokerSpawnError('this action has no signed-in person to bill it to. Start it from the web UI, or set WORCA_BROKER_SYSTEM_BILL_TO for work nobody in particular starts');
  }
  const kind = ['aux', 'test', 'ask', 'phase'].includes(opts.spawnKind) ? opts.spawnKind
    : (opts.permissionMode === 'dontAsk' ? 'ask' : 'phase');
  // Whether this spawn runs where no other person's agent can read it: an agent spawn under
  // the paying person's own pool user (not a resumed run's starter's), or a server-side spawn
  // when agents run under their own users (they can't read the server's processes). The
  // broker uses a personal Claude subscription only for such spawns.
  const owner = normalizeBillTo(currentOwner()) || billTo;
  const isolated = opts.asAgent
    ? owner === billTo && !!agentIdentityFor(owner)?.dedicated
    : !!agentIdentity();
  let minted;
  try {
    minted = await mintSpawnToken({
      billTo: billTo || 'local', slots: [bridgeSlot || route.slot], kind, ttlSec: SPAWN_TTL_SEC[kind],
      runId: opts.runId || null, threadId: opts.threadId || null, isolated,
    });
  } catch (err) {
    throw brokerSpawnError(`cannot get a token for this spawn: ${err.message}`, err.status === 401 ? 'auth' : 'network');
  }
  const modelEnv = bridgeSlot
    // Bridged: keep the bridge URL (and the rest of the resolved env); swap the bridge's own
    // secret for the spawn token.
    ? { ...opts.modelEnv, ANTHROPIC_AUTH_TOKEN: minted.token }
    : withProviderModesOff({
      ENABLE_TOOL_SEARCH: 'true',
      ...(opts.modelEnv || {}),
      ANTHROPIC_BASE_URL: `${slotBaseUrl(route.slot)}${route.prefix || ''}`,
      ANTHROPIC_AUTH_TOKEN: minted.token,
    });
  try {
    const r = await runClaudeProcess({ ...opts, modelEnv, onEvent: redactingOnEvent });
    return { ...r, text: redactSecrets(r.text) };
  } catch (err) {
    if (err && typeof err.message === 'string') err.message = redactSecrets(err.message);
    throw err;
  } finally {
    revokeSpawnToken(minted.spawnId);
  }
}

/** Claude Code declares every capability worca uses (plans/harness-bridge-design.md §6). */
export const claudeCapabilities = Object.freeze(Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, true])));

/** The adapter's run(): every spawn goes through the credential broker when it is
 *  on (WORCA_BROKER_URL, runViaBroker), else straight to runClaudeProcess. Raw
 *  stream-json envelopes; engines/index.mjs normalizes them. */
export function runClaudeAdapter(opts) {
  return (brokerEnabled() ? runViaBroker : runClaudeProcess)(opts);
}
