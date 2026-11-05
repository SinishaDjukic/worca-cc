// src/core/engines/claude.mjs
// The Claude Code adapter: argv (buildClaudeArgs and the --settings seam), the
// GH #380 staging plan, the model env and wire model, the host-guard preamble,
// and the stream-json line parser. Process supervision is engines/spawn.mjs;
// the public entry point stays runClaude in src/core/claude-runner.mjs.
import { prepareModelEnv, isReadableModelEnvKey, envFlag, describeModelEnv, withProviderModesOff, withStreamTimeouts } from '../model-env.mjs';
import { effectiveDebugSpawn } from '../settings.mjs';
import { classifyError } from '../recoverable-error.mjs';
import { bridgeEvents } from '../bridge/telemetry.mjs';
import { resolveClaudeBin } from '../preflight.mjs';
import { CLAUDE_CLI } from './cli-specs.mjs';
import { hostGuardEnabled, hostGuardHookEntry, hostGuardSystemPrompt } from '../host-guard.mjs';
import { memoryUsageHookEntry } from '../memory-usage.mjs';
import { readGuardHookEntry, readGuardDecisions } from '../file-read-guard.mjs';
import { tryGuardHookEntry, withTryDeny } from '../workflow-tests/try-guard-env.mjs';
import { lstatSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
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
import { readUserSignIn, readUserSafety, sandboxProblem, SIGN_IN_SETTINGS_KEYS } from './claude-sign-in.mjs';

export const DEFAULT_BIN = process.env.WORCA_CLAUDE_BIN || process.env.ORCH_CLAUDE_BIN || 'claude';

const _ov = { superviseSpawn: null };
/** Test seam (as exec-cli.mjs's): stub the process supervision runClaudeProcess hands its spawn to (it receives the same
 *  options object: args, env, cleanup, onDone, onStdoutLine, ...). */
export const _testing = {
  set({ superviseSpawn: sup = _ov.superviseSpawn } = {}) { _ov.superviseSpawn = sup; },
  reset() { _ov.superviseSpawn = null; },
};

// Env every Claude spawn carries, over the ambient, run and model env (#810). Claude Code 2.1.302 offers
// `subagent_type: "fork"` in -p by default: a fork inherits the parent's context, tools and model, so a
// fan-out node's children would bypass the pinned investigator (--agents, phases.mjs investigatorAgents)
// and the sub-agent model policy (a fork ignores the Agent call's `model`). 0 turns forks off; the key is
// a reserved model-env key, so no catalog entry sets it.
export const CLAUDE_SPAWN_ENV = Object.freeze({ CLAUDE_CODE_FORK_SUBAGENT: '0' });

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

/** Workflow tests 3b (D71): the sign-in helpers a Pretend try carries over from the person's user settings (non-empty strings
 *  of SIGN_IN_SETTINGS_KEYS only); null when there are none. */
function signInSettingsOf(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const out = {};
  for (const k of SIGN_IN_SETTINGS_KEYS) if (typeof s[k] === 'string' && s[k] !== '') out[k] = s[k];
  return Object.keys(out).length ? out : null;
}

/** Workflow tests 3b (D81): the person's own deny rules and sandbox, or null when there are none. C1: a sandbox the CLI
 *  would reject (sandboxProblem) is never carried: it would make the CLI drop the whole settings file, Worca's guards with it. */
function safetySettingsOf(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const deny = Array.isArray(s.deny) ? s.deny.filter((x) => typeof x === 'string' && x.trim()) : [];
  const sandbox = s.sandbox && sandboxProblem(s.sandbox) === null ? s.sandbox : null;
  return deny.length || sandbox ? { deny, sandbox } : null;
}

/** M8 (security review): the permission rules as the payload carries them: only `allow` / `ask` / `deny`, each a list of
 *  strings (other entries dropped), in their given order; null when nothing is left. A wrong-typed `permissions` value
 *  would make the CLI drop the whole settings file, as C1's sandbox does. */
function permissionListsOf(rules) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return null;
  const out = {};
  for (const [k, v] of Object.entries(rules)) {
    if ((k === 'allow' || k === 'ask' || k === 'deny') && Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string');
  }
  return Object.keys(out).length ? out : null;
}

/** What `--settings` carries, or null when there is nothing to carry (no hook
 *  telemetry, no permission rules, no host guard, no extra settings) — then the flag is omitted
 *  entirely. `hostGuard` (set by runClaudeProcess, gated by hostGuardEnabled) merges the
 *  host-process-protection PreToolUse hook into the SAME single payload; the
 *  returned `hook` flag stays telemetry-only (it drives --include-hook-events,
 *  which the guard does not need). `extraSettings` (skills registry §4.1) merges in
 *  first, so the runner's own `hooks` / `permissions` always win. `memoryLoadLog` (memory usage, U3: set by the
 *  harness only when the mounted rules hold a note with `paths:`) adds the `InstructionsLoaded` counting hook the
 *  same way — never into the user's settings files. `readGuard` (Requirements A8: the one file a read may open) adds
 *  the file-read guard (file-read-guard.mjs) on every tool, with `disableAllHooks: false`, logging each decision to
 *  `readGuardLog` (stageClaudeInvocation names it); absent (null/undefined), nothing changes. `tryGuard` (workflow tests 3a
 *  D56: a test try's `{ logFile }`) adds the try guard's PreToolUse Bash hook beside the host guard and its deny rules
 *  (workflow-tests/try-guard-env.mjs); absent, nothing changes. `signInSettings` (workflow tests 3b D71): a Pretend try's
 *  carried `apiKeyHelper` / `awsAuthRefresh` / `awsCredentialExport`; the payload then says `signIn: true`, and it only ever
 *  travels as a file (buildSettingsArgs). `safetySettings` (workflow tests 3b D81): the person's own `{ deny, sandbox }`; the
 *  deny rules join after Worca's and the try guard's, the sandbox is kept as given (readUserSafety has already laid the
 *  checkout's project and local sandbox over the person's, D81a), and the payload says `signIn: true` (a file only).
 *  `mainThreadGuard` (session groups C40): a session host's main-thread guard; its PreToolUse entries join the runner's own. */
export function buildSettingsPayload(permissionRules, { hostGuard = false, extraSettings = null, memoryLoadLog = null, readGuard = null, readGuardLog = null, tryGuard = null, signInSettings = null, safetySettings = null, mainThreadGuard = null } = {}) {
  const hook = buildHookSettings();
  const extra = extraSettingsOf(extraSettings);
  const guard = hostGuard && hostGuardEnabled() ? hostGuardHookEntry() : null;
  const usage = typeof memoryLoadLog === 'string' && memoryLoadLog ? memoryUsageHookEntry(memoryLoadLog) : null;
  // Workflow tests 3a (D56): a try's outward guard: its PreToolUse hook beside the host guard, and its deny rules.
  const tg = tryGuard ? tryGuardHookEntry() : null;
  const rules0 = tg ? withTryDeny(permissionRules) : permissionRules;
  // D81: the person's own deny rules, after Worca's and the try guard's (deduplicated): they only add blocks.
  const safety = safetySettingsOf(safetySettings);
  const rules = permissionListsOf(safety && safety.deny.length
    ? { ...(rules0 && typeof rules0 === 'object' ? rules0 : {}), deny: [...new Set([...(rules0 && Array.isArray(rules0.deny) ? rules0.deny : []), ...safety.deny])] }
    : rules0);
  const hasRules = !!rules && Object.values(rules).some((a) => Array.isArray(a) && a.length);
  // Present-but-malformed rules (e.g. `{deny: 'Bash(curl:*)'}`) make the object
  // truthy while hasRules stays false, so the whole policy would drop out of
  // argv silently. Say it once, then take the same no-rules path (fail-open,
  // matching the guardrail-set read path) — the empty/absent cases ({}, {deny: []}, null)
  // are normal and stay quiet.
  if (!hasRules && permissionRules && typeof permissionRules === 'object'
      && Object.values(permissionRules).some((a) => a != null && !Array.isArray(a))) {
    console.warn('[worca] guardrails: permissionRules is malformed (deny/allow/ask must be arrays of strings) — ignoring it; this spawn carries NO permission rules');
  }
  // A8: a Requirements file read's guard (file-read-guard.mjs): every tool, fail-closed; the user settings cannot turn it off.
  // Any value but null/undefined goes to readGuardHookEntry, which throws unless it is an absolute path: never a silent no-guard.
  const read = readGuard != null ? readGuardHookEntry(readGuard, { log: readGuardLog }) : null;
  // Workflow tests 3b (D71): a Pretend try's carried sign-in helpers. Absent ⇒ nothing changes.
  const signIn = signInSettingsOf(signInSettings);
  // Session groups C40: a session host's main-thread guard (session-host-guard.mjs, Task 41). Its PreToolUse entries are
  // the runner's own, like the host guard's; extraSettings never carries hooks (RUNNER_SETTINGS_KEYS), so it has its own key.
  const hostOnly = Array.isArray(mainThreadGuard?.hooks?.PreToolUse) && mainThreadGuard.hooks.PreToolUse.length
    ? mainThreadGuard.hooks.PreToolUse : null;
  if (!hook && !hasRules && !guard && !extra && !usage && !read && !tg && !signIn && !safety && !hostOnly) return null;
  const settings = { ...(extra ?? {}), ...(signIn ?? {}), ...(safety && safety.sandbox ? { sandbox: safety.sandbox } : {}) };
  if (hook) settings.hooks = { ...hook.hooks };
  if (guard) {
    settings.hooks = settings.hooks ?? {};
    settings.hooks.PreToolUse = [...(settings.hooks.PreToolUse ?? []), guard];
  }
  if (tg) {
    settings.hooks = settings.hooks ?? {};
    settings.hooks.PreToolUse = [...(settings.hooks.PreToolUse ?? []), tg];
    settings.disableAllHooks = false;   // as the A8 read guard: the user's settings cannot switch the try's hook off
  }
  if (hostOnly) {
    settings.hooks = settings.hooks ?? {};
    settings.hooks.PreToolUse = [...(settings.hooks.PreToolUse ?? []), ...hostOnly];
    settings.disableAllHooks = false;              // v3: like the read guard, a user's settings cannot switch it off
  }
  if (usage) {
    settings.hooks = settings.hooks ?? {};
    settings.hooks.InstructionsLoaded = [...(settings.hooks.InstructionsLoaded ?? []), usage];
  }
  if (read) {
    settings.hooks = settings.hooks ?? {};
    settings.hooks.PreToolUse = [...(settings.hooks.PreToolUse ?? []), read];
    settings.disableAllHooks = false;
  }
  if (hasRules) settings.permissions = rules;
  return signIn || safety ? { hook: !!hook, settings, signIn: true } : { hook: !!hook, settings };
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

/** The spawn-failure Error: the OS message (superviseSpawn already appended the
 *  Windows npm-shim explanation when that is what actually went wrong). */
function spawnFailure(err, prefix) {
  const unspawnable = /ENOENT|EINVAL/.test(String(err && err.code || err && err.message || ''));
  const out = new Error(`${prefix}: ${err.message}`);
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
// Likewise the connectors notice: printed on every spawn that carries ANTHROPIC_API_KEY or another auth
// source (every custom-endpoint model), it masked a 403 "Failed to authenticate" result as the exit detail.
export const BENIGN_STDERR_PATTERNS = Object.freeze([
  /^\[claude-code:unrecognized_model\]/,
  /^⚠ claude\.ai connectors are disabled because\b/,
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
 * @param {{hostGuard?:boolean, extraSettings?:object|null, readGuard?:string|null, readGuardLog?:string|null}} [opts]
 *   host-process guard (runClaudeProcess sets it; see buildSettingsPayload), extra settings merged into the same payload
 *   (skills registry §4.1), the A8 file-read guard's one allowed file and its decision log, a workflow-test try's guard
 * @returns {string[]}
 */
export function buildSettingsArgs(permissionRules, settingsFile = null, { hostGuard = false, extraSettings = null, memoryLoadLog = null, readGuard = null, readGuardLog = null, tryGuard = null, signInSettings = null, safetySettings = null, mainThreadGuard = null } = {}) {
  const payload = buildSettingsPayload(permissionRules, { hostGuard, extraSettings, memoryLoadLog, readGuard, readGuardLog, tryGuard, signInSettings, safetySettings, mainThreadGuard });
  if (!payload) return [];
  // Workflow tests 3b (D71): a carried sign-in helper is a command (and maybe a secret): never on the command line.
  if (payload.signIn && !settingsFile) throw new Error('a carried Claude Code sign-in travels in a settings file, never on the command line');
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
 *                        user scope, and plugin servers — E11). A pipeline node adds
 *                        `--strict-mcp-config` only when mcp.json holds every server it
 *                        needs (phases.mjs strictMcpFor), and a pretend workflow-test try
 *                        always does: it must load only its stand-ins
 *                        (plans/workflow-tests-part2-plan.md D35).
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
  pluginDirs, extraSettings, memoryLoadLog, readGuard, readGuardLog,
  // Workflow tests 3a (D56): a test try's outward guard ({ logFile }): its hook and deny rules in --settings. Absent ⇒ nothing.
  tryGuard,
  signInSettings, safetySettings,
  // Session groups (Task 29): a session host spawn only. Absent ⇒ argv byte-identical.
  forwardSubagentText, agentsFile, mainThreadGuard,
  // Requirements A1.1: 'replace' swaps Claude Code's own system prompt for ours
  // (--system-prompt / --system-prompt-file). Anything else, absent included, is
  // today's --append-system-prompt(-file), so every other argv stays byte-identical.
  systemPromptMode,
  // Requirements A8: true ⇒ --no-session-persistence (-p only): Claude Code keeps no session transcript of this call,
  // so a read of the product owner's file leaves no copy of it in Claude Code's own logs. Anything else ⇒ nothing.
  noSessionPersistence,
}, delivery = {}) {
  // delivery (GH #380, set only by planClaudeInvocation's staged branch):
  //   promptViaStdin   -> bare `-p`; the prompt is written to the child's stdin
  //   systemPromptFile -> `--append-system-prompt-file <path>` (or `--system-prompt-file`) instead of the text
  //   settingsFile     -> `--settings <path>` instead of the inline JSON
  const { promptViaStdin = false, systemPromptFile = null, settingsFile = null } = delivery;
  const args = promptViaStdin ? ['-p'] : ['-p', prompt];
  args.push('--output-format', 'stream-json', '--verbose', '--permission-mode', permissionMode);
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  if (systemPrompt) {
    const replace = systemPromptMode === 'replace';
    if (systemPromptFile) args.push(replace ? '--system-prompt-file' : '--append-system-prompt-file', systemPromptFile);
    else args.push(replace ? '--system-prompt' : '--append-system-prompt', systemPrompt);
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
  for (const a of buildSettingsArgs(permissionRules, settingsFile, { hostGuard, extraSettings, memoryLoadLog, readGuard, readGuardLog, tryGuard, signInSettings, safetySettings, mainThreadGuard })) args.push(a);
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
  if (noSessionPersistence === true) args.push('--no-session-persistence');
  if (includePartialMessages === true) args.push('--include-partial-messages');
  if (Number.isSafeInteger(maxTurns) && maxTurns > 0) args.push('--max-turns', String(maxTurns));
  if (typeof maxBudgetUsd === 'number' && Number.isFinite(maxBudgetUsd) && maxBudgetUsd > 0) {
    args.push('--max-budget-usd', String(maxBudgetUsd));
  }
  if (typeof appendSubagentSystemPrompt === 'string' && appendSubagentSystemPrompt) {
    args.push('--append-subagent-system-prompt', appendSubagentSystemPrompt);
  }
  // --forward-subagent-text (session host spawns, M-11): the member's text reaches the host's stream, where the demux
  // re-roots it onto the member's row. Absent/false ⇒ nothing, so every other argv stays byte-identical.
  if (forwardSubagentText === true) args.push('--forward-subagent-text');
  // Sub-agent definitions. Ungrouped spawns (the pinned investigator, phases.mjs investigatorAgents) pass them as inline
  // JSON on BOTH branches: Claude Code reads `--agents <file>` only from 2.1.281, and a user's own CLI may be older
  // (docker/CLAUDE_CODE_VERSION pins 2.1.294, which reads both). A session host spawn (agentsViaFile, floor-checked by
  // chooseSessionMode) passes `agentsFile`, the agents.json planClaudeInvocation writes into the spawn's own staging
  // dir (C3); the file wins. The investigator definition is ~600 chars. Before --add-dir (LAST).
  if (typeof agentsFile === 'string' && agentsFile) {
    args.push('--agents', agentsFile);
  } else if (agents && typeof agents === 'object' && Object.keys(agents).length) {
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
 *  - a carried sign-in or the person's own guards (workflow tests 3b D71/D81, `signInSettings` / `safetySettings`): the
 *    settings always go in a file under `dir`; when the argv fits, only they move (the prompt stays inline, `staged` false).
 *  - agentsViaFile (session host spawns, C3): `files` holds `<dir>/agents.json` on BOTH branches, `--agents` names it,
 *    and `dir` is taken even when the argv is short. `staged` still means only "argv over the limit".
 * @param {object} opts  the buildClaudeArgs options
 * @param {{bin?:string, dir?:string|(() => string), limit?:number}} [o]  `dir` may be a
 *   factory, called only when staging is actually needed (so the caller creates
 *   a temp dir exactly when one will be used)
 * @returns {{args:string[], stdin:string|null, files:{path:string,content:string}[], staged:boolean, inlineLength:number}}
 */
export function planClaudeInvocation(opts, { bin = DEFAULT_BIN, dir = null, limit = ARGV_INLINE_LIMIT } = {}) {
  // Session host spawns only (C3, critique C-2): the definitions ride agents.json in this spawn's OWN staging dir, which
  // superviseSpawn shares with the agent user (stagedDir) and the cleanup removes. The dir is taken even when the argv
  // is short. Ungrouped spawns never set agentsViaFile: their --agents stays inline JSON on both branches (M-12).
  const agents = opts.agents && typeof opts.agents === 'object' && Object.keys(opts.agents).length ? opts.agents : null;
  let agentsEntry = null;
  if (opts.agentsViaFile === true && agents) {
    if (!dir) throw new Error('planClaudeInvocation: a staging dir is required for agentsViaFile');
    if (typeof dir === 'function') dir = dir();
    agentsEntry = { path: join(dir, 'agents.json'), content: JSON.stringify(agents) };
    opts = { ...opts, agents: undefined, agentsFile: agentsEntry.path };
  }
  // Workflow tests 3b (D71, D81): a carried sign-in helper or the person's own guards always go in the settings file, also
  // when the argv fits.
  const fileSettings = !!(signInSettingsOf(opts.signInSettings) || safetySettingsOf(opts.safetySettings));
  const inline = buildClaudeArgs(fileSettings ? { ...opts, signInSettings: null, safetySettings: null } : opts);
  const inlineLength = argvLength(bin, inline);
  if (inlineLength <= limit && !fileSettings) return { args: inline, stdin: null, files: agentsEntry ? [agentsEntry] : [], staged: false, inlineLength };
  if (!dir) throw new Error('planClaudeInvocation: a staging dir is required when the argv is over the limit or carries a sign-in');
  if (typeof dir === 'function') dir = dir();
  const payload = buildSettingsPayload(opts.permissionRules, { hostGuard: opts.hostGuard, extraSettings: opts.extraSettings, memoryLoadLog: opts.memoryLoadLog,
    readGuard: opts.readGuard, readGuardLog: opts.readGuardLog, tryGuard: opts.tryGuard, signInSettings: opts.signInSettings,
    safetySettings: opts.safetySettings, mainThreadGuard: opts.mainThreadGuard });
  const files = agentsEntry ? [agentsEntry] : [];
  if (inlineLength <= limit) {
    // Only the settings move to a file; the prompt and the system prompt stay inline (not the GH #380 staging).
    const settingsFile = join(dir, 'settings.json');
    return { args: buildClaudeArgs(opts, { settingsFile }), stdin: null, files: [...files, { path: settingsFile, content: JSON.stringify(payload.settings) }],
      staged: false, inlineLength };
  }
  const prompt = typeof opts.prompt === 'string' ? opts.prompt : '';
  const promptViaStdin = prompt.length > 0;             // an empty prompt stays `-p ''` — nothing to pipe
  let systemPromptFile = null;
  if (opts.systemPrompt) {
    systemPromptFile = join(dir, 'system-prompt.md');
    files.push({ path: systemPromptFile, content: opts.systemPrompt });
  }
  let settingsFile = null;
  if (payload) {
    settingsFile = join(dir, 'settings.json');
    files.push({ path: settingsFile, content: JSON.stringify(payload.settings) });
  }
  const args = buildClaudeArgs(opts, { promptViaStdin, systemPromptFile, settingsFile });
  return { args, stdin: promptViaStdin ? prompt : null, files, staged: true, inlineLength };
}

/** Task 5 (security review M2): the staging folders' prefix in the OS temp folder, and the age after which a folder is
 *  left over from a spawn Worca no longer runs (Worca was killed before its cleanup); the newest of the folder's and its
 *  files' times counts, so a long spawn whose guard still writes its log keeps its folder. */
export const STAGING_PREFIX = 'worca-claude-';
export const STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** M2: remove the staging folders older than `maxAgeMs` in `dir` (never a link, never anything else). Never throws.
 *  @returns {string[]} the folder names removed */
export function sweepStaleStagingDirs({ dir = tmpdir(), maxAgeMs = STAGING_MAX_AGE_MS, now = Date.now() } = {}) {
  const removed = [];
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.startsWith(STAGING_PREFIX)); } catch { return removed; }
  for (const name of names) {
    const p = join(dir, name);
    try {
      const st = lstatSync(p);
      if (!st.isDirectory()) continue;   // a symlink or junction is not a directory to lstat
      let newest = st.mtimeMs;
      for (const f of readdirSync(p)) { try { newest = Math.max(newest, lstatSync(join(p, f)).mtimeMs); } catch { /* gone */ } }
      if (now - newest < maxAgeMs) continue;
      rmSync(p, { recursive: true, force: true });
      removed.push(name);
    } catch { /* best effort: the next boot tries again */ }
  }
  return removed;
}

/**
 * Task 5 (M13, from PR #979's code scanning): the try's connector-calls.ndjson is written raw by the stand-in connectors and
 * the try guard (child processes that hold no secret list), then shown in "Would have sent", while the same values in the
 * transcript are redacted. When a spawn with a redactor ends, its log is rewritten through that redactor: every whole line
 * (as JSON, keys included; a line that is not JSON as text), a torn last line kept as it is. Only when something changes,
 * through a new temp file and a rename (never through a link, never into a hardlink's other name); a log that grew while it
 * was read is read again (three tries, then left for the next spawn's end). Never throws.
 * @returns {boolean} whether the log was rewritten
 */
export function redactTryLog(file, redactor) {
  if (typeof file !== 'string' || !file || !redactor) return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    let tmp = null;
    try {
      const st = lstatSync(file);
      if (!st.isFile()) return false;   // a symlink (or anything but a plain file): never followed
      const text = readFileSync(file, 'utf8');
      const parts = text.split('\n');
      const torn = parts.pop();          // after the last newline: '' or a line still being written
      const lines = parts.map((l) => {
        if (!l.trim()) return l;
        try { return JSON.stringify(redactor.deep(JSON.parse(l))); } catch { return redactor.text(l); }
      });
      const next = [...lines, torn].join('\n');
      if (next === text) return false;
      const now = lstatSync(file);
      if (now.size !== st.size || now.mtimeMs !== st.mtimeMs) continue;   // it grew: read it again
      tmp = `${file}.worca-${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
      writeFileSync(tmp, next, { encoding: 'utf8', flag: 'wx' });
      renameSync(tmp, file);
      return true;
    } catch {
      if (tmp) { try { rmSync(tmp, { force: true }); } catch { /* best effort */ } }
      return false;
    }
  }
  return false;
}

/** planClaudeInvocation + the I/O: a private temp dir is created and the files
 *  written ONLY on the staged branch, or when a session host spawn passes
 *  `agentsViaFile` (C3) (`dir` is null otherwise, so the caller has nothing to
 *  clean up). Synchronous on purpose — a few hundred KB once per
 *  spawn, and it keeps the spawn sequence in runClaudeProcess linear. */
export function stageClaudeInvocation(opts, { bin = DEFAULT_BIN, limit = ARGV_INLINE_LIMIT } = {}) {
  let dir = null;
  const makeDir = () => (dir ??= mkdtempSync(join(tmpdir(), STAGING_PREFIX)));
  // A8: a guarded read logs every decision of its guard to a file in this private dir: the server's path, never a
  // caller's, read back when the spawn ends (runClaudeProcess) and removed with the dir.
  const o = opts.readGuard != null ? { ...opts, readGuardLog: join(makeDir(), 'read-guard.jsonl') } : opts;
  let plan;
  try {
    plan = planClaudeInvocation(o, { bin, limit, dir: makeDir });
    for (const file of plan.files) writeFileSync(file.path, file.content, 'utf8');
  } catch (err) {
    if (dir) rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return { ...plan, dir, ...(o.readGuardLog ? { readGuardLog: o.readGuardLog } : {}) };
}

/**
 * Workflow tests 3b (D71): the sign-in a Pretend try carries over from the person's user settings, and the person's own
 * guards (D81); null when there is neither. Read per spawn from the folder the spawn's CLI will read (a model profile may
 * move CLAUDE_CONFIG_DIR). Nothing at all with the credential broker on (its token is the spawn's only model credential) or
 * into a spawn that runs as another OS user (agent isolation: one user's sign-in never moves to another; M12: nor are the
 * operator's own rules shown to agents). M3: an agent user that cannot be looked up counts as one (fail closed). `cwd`: the
 * spawn's working directory, whose `.claude` sandbox stays on top of the person's (D81a); `sources`: the spawn's setting
 * sources (M7); `userLoaded`: the run itself loads user settings (M11); `ownDeny`: Worca's own deny rules for the same
 * --settings file (Task 5 fix review, concern 1). Never throws.
 * @returns {{env: Record<string,string>, settings: Record<string,string>, safety?: {deny: string[], sandbox: object|null},
 *   warnings?: string[], notes?: string[]} | null}
 */
export function signInCarry({ modelEnv = null, asAgent = false, read = readUserSignIn, readSafety = readUserSafety,
  agentUser = () => agentIdentityFor(currentOwner()), cwd = null, sources = undefined, userLoaded = true, ownDeny = [] } = {}) {
  try {
    // D71, M12: neither the sign-in nor the guards with the broker on or into a spawn that runs as another OS user.
    let isolated = false;
    if (asAgent) { try { isolated = !!agentUser(); } catch { isolated = true; } }
    if (brokerEnabled() || isolated) return null;
    const extra = modelEnv && typeof modelEnv === 'object' && Object.keys(modelEnv).length ? prepareModelEnv(modelEnv).env : {};
    const env = { ...process.env, ...extra };
    // D81: the person's own deny rules and sandbox. The deny rules only add blocks; the sandbox keeps Claude Code's order
    // (D81a): the spawn's checkout (`cwd`) has its project, then local sandbox laid on top.
    let safety = null;
    let warnings = [];
    let notes = [];
    const texts = (a) => (Array.isArray(a) ? a.filter((w) => typeof w === 'string' && w) : []);
    try {
      const g = readSafety({ env, cwd, sources, userLoaded, ownDeny: Array.isArray(ownDeny) ? ownDeny : [] });
      if (g && ((Array.isArray(g.deny) && g.deny.length) || g.sandbox)) safety = { deny: g.deny || [], sandbox: g.sandbox || null };
      if (g) { warnings = texts(g.warnings); notes = texts(g.notes); }
    } catch { safety = null; }
    const s = read({ env });
    const signIn = s && s.state === 'found' ? s : null;
    if (!signIn && !safety && !warnings.length && !notes.length) return null;
    return { env: { ...(signIn ? signIn.env || {} : {}) }, settings: { ...(signIn ? signIn.settings || {} : {}) }, ...(safety ? { safety } : {}),
      ...(warnings.length ? { warnings } : {}), ...(notes.length ? { notes } : {}) };
  } catch { return null; }
}

/** Task 5 (security review I3, decision D71b): whether the carried sign-in env goes OVER the model env, where a normal
 *  every-source run puts the user settings' env (the CLI lets it win: proof settingsEnvWins), so the person's own gateway
 *  credentials never go to a model profile's endpoint. Not over Worca's in-process bridge (a loopback `/m/<id>` base URL):
 *  the bridge forwards no credential upstream, and its routing must hold. */
export function carryOverModelEnv(modelEnv) {
  return !bridgeSpawnKey(modelEnv);
}

/** Task 5 (security review M1): every carried value the run redacts: the secret env values (secretValuesOf) and the
 *  helper commands (`apiKeyHelper` may hold a key inline); the redactor itself ignores those under 8 characters. */
export function carryRedactValues(carry) {
  if (!carry) return [];
  const helpers = carry.settings && typeof carry.settings === 'object' ? Object.values(carry.settings).filter((v) => typeof v === 'string') : [];
  return [...secretValuesOf(carry.env), ...helpers];
}

/** Task 5 (security review C1, L5): what the runner says about a Pretend try's carry, as a stderr line of the spawn. The run
 *  harness records a warning once as a run warning, and a note once in the run log (carryLine). */
export const CARRY_WARNING_PREFIX = '[worca] try carry warning: ';
export const CARRY_NOTE_PREFIX = '[worca] try carry note: ';
/** A carry line's kind and text, or null for any other line. */
export function carryLine(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (t.startsWith(CARRY_WARNING_PREFIX)) return { kind: 'warning', text: t.slice(CARRY_WARNING_PREFIX.length) };
  if (t.startsWith(CARRY_NOTE_PREFIX)) return { kind: 'note', text: t.slice(CARRY_NOTE_PREFIX.length) };
  return null;
}
/** The lines a carry gives: each sandbox warning (C1), each note of what a sandbox layer left out (D81b), then how many
 *  personal deny rules came along (L5). */
function carryLines(carry) {
  if (!carry) return [];
  const n = carry.safety && Array.isArray(carry.safety.deny) ? carry.safety.deny.length : 0;
  return [...(carry.warnings || []).map((w) => `${CARRY_WARNING_PREFIX}${w}`), ...(carry.notes || []).map((t) => `${CARRY_NOTE_PREFIX}${t}`),
    ...(n ? [`${CARRY_NOTE_PREFIX}This try also follows ${n} deny rule${n === 1 ? '' : 's'} from your own Claude Code settings.`] : [])];
}

// M9: plain routing keys a run may show (AWS_DEFAULT_REGION and Vertex's per-model VERTEX_REGION_* are regions, not secrets).
const ROUTING_KEY_RE = /^(CLOUD_ML_REGION|AWS_REGION|AWS_DEFAULT_REGION|AWS_PROFILE|ANTHROPIC_VERTEX_PROJECT_ID|HTTP_PROXY|HTTPS_PROXY|NO_PROXY|VERTEX_REGION_[A-Z0-9_]+)$/i;
const URL_PARTS_RE = /^[a-z][a-z0-9+.-]*:\/\/(?:([^@/?#]*)@)?[^/?#]*([^?#]*)(\?[^#]*)?/i;
const decoded = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
/**
 * The carried values a run must never show (D71, D71a): every string value of 8+ characters except the keys that are
 * safe to print (readable model-env keys and plain routing keys). A URL's username and password (4+ chars) are redacted
 * on their own, also on the printable keys (ANTHROPIC_BASE_URL, the proxies): as written, decoded, and as URL re-encodes
 * them (M9). M9: so are a URL's path (other than `/`) and query, which can carry a tenant key or a token.
 */
export function secretValuesOf(env) {
  const out = [];
  for (const [k, v] of Object.entries(env || {})) {
    if (typeof v !== 'string') continue;
    if (v.length >= 8 && !isReadableModelEnvKey(k) && !ROUTING_KEY_RE.test(k)) out.push(v);
    let u = null;
    try { u = new URL(v); } catch { /* not a URL */ }
    if (!u) continue;
    const m = URL_PARTS_RE.exec(v.trim());
    const raw = m && m[1] != null ? [m[1].split(':')[0], m[1].includes(':') ? m[1].slice(m[1].indexOf(':') + 1) : ''] : [];
    if (!m) {   // not `scheme://…` (e.g. a header line that happens to parse): no login, path or query of its own
      for (const part of [u.username, u.password]) { if (part.length >= 4) out.push(part); }
      continue;
    }
    // Task 5 fix review (m7): the whole URL as carried, its login and its query; of its path only a segment that looks like a
    // secret (SECRET_SEGMENT_RE), so a plain gateway path such as `/anthropic` is not blanked out of every text.
    if (v.length >= 8) out.push(v);
    for (const part of [...raw, ...raw.map(decoded), u.username, u.password]) { if (part.length >= 4) out.push(part); }
    const query = m[3] && m[3] !== '?' ? m[3] : '';
    for (const part of [query, u.search]) { if (part) out.push(part); }
    for (const seg of (m[2] || '').split('/')) { if (SECRET_SEGMENT_RE.test(seg)) out.push(seg, decoded(seg)); }
  }
  return [...new Set(out)];
}
/** m7: a URL path segment that looks like a token: 16 or more characters of a token's alphabet. */
const SECRET_SEGMENT_RE = /^[A-Za-z0-9._~+=%-]{16,}$/;

export function runClaudeProcess({ cwd, systemPrompt, prompt, allowedTools, permissionMode, model, effort, onEvent, signal, bin, resumeSessionId, mcpConfigPath, mcpServerGrants, permissionRules, envScrub, envAllowlist, modelEnv, spawnEnv: runSpawnEnv, redactValues, disallowedTools, tools, strictMcpConfig, settingSources, disableSlashCommands, includePartialMessages, maxTurns, maxBudgetUsd, appendSubagentSystemPrompt, addDirs, agents, pluginDirs, extraSettings, memoryLoadLog, argvInlineLimit, asAgent, systemPromptMode, readGuard, noSessionPersistence, tryGuard, pluginsOff, runLoadsUserSettings, forwardSubagentText, agentsViaFile, mainThreadGuard }) { // billTo/spawnKind/runId/threadId are consumed by runViaBroker
  // MCP registry §5.5.3: with registry secrets in this spawn's env, every emit, the result text and the error
  // message leave redacted — wrapped once here, so the broker path (which calls runClaudeProcess) is covered too.
  // Workflow tests 3b (D71): a Pretend try loads no user settings (runOpts: the run's sources minus user, D70a); only the
  // sign-in kept there (and the person's own guards, D81) is carried over, and its secret values are redacted like the
  // registry's. Absent on every other spawn: nothing is read and the redactor is as before.
  const carry = pluginsOff === true
    ? signInCarry({ modelEnv, asAgent, cwd: cwd || process.cwd(), sources: settingSources, userLoaded: runLoadsUserSettings === true,
      ownDeny: permissionRules && Array.isArray(permissionRules.deny) ? permissionRules.deny : [] }) : null;
  const redactList = [...(Array.isArray(redactValues) ? redactValues : []), ...carryRedactValues(carry)];
  const redactor = redactList.length ? createRedactor(redactList) : null;
  if (redactor) { const emit = onEvent; onEvent = (e) => emit(redactor.deep(e)); }
  return new Promise((resolveRaw, rejectRaw) => {
    const resolveP = redactor ? (r) => resolveRaw({ ...r, text: redactor.text(r.text) }) : resolveRaw;
    const rejectP = redactor ? (err) => {
      if (err && typeof err.message === 'string') err.message = redactor.text(err.message);
      if (err && typeof err.stack === 'string') err.stack = redactor.text(err.stack);
      rejectRaw(err);
    } : rejectRaw;
    // Task 5 (C1, L5): what the carry left out or brought along, said before anything can fail.
    for (const text of carryLines(carry)) safeEmit(onEvent, { type: 'stderr', stream: 'err', text });
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
    // (superviseSpawn resolves the same bin through CLAUDE_CLI and logs the note once.)
    const resolved = resolveClaudeBin(bin);

    // GH #380: inline argv when it fits, else prompt on stdin + files (see
    // ARGV_INLINE_LIMIT). The staging dir, when any, is removed on every
    // terminal path below (finish) and on a failed spawn.
    const limit = Number.isFinite(argvInlineLimit) && argvInlineLimit > 0 ? argvInlineLimit : ARGV_INLINE_LIMIT;
    // Host guard (host-guard.mjs, 2026-08-31 incident): every REAL spawn — any
    // role, custom agent, plugin agent, ask chat — carries the protection
    // preamble, the PreToolUse hook (hostGuard -> the --settings payload), and
    // WORCA_HOST_PID (below). One kill-switch: WORCA_HOST_GUARD=0. Mock spawns
    // nothing, so runMock stays untouched. The preamble heads the system prompt
    // whether it is appended or (systemPromptMode replace, Requirements A1.1) replaces
    // Claude Code's own.
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
        pluginDirs, extraSettings, memoryLoadLog, tryGuard,
        signInSettings: carry && Object.keys(carry.settings).length ? carry.settings : null,
        safetySettings: carry && carry.safety ? carry.safety : null,
        systemPromptMode, readGuard, noSessionPersistence,
        forwardSubagentText, agentsViaFile, mainThreadGuard,
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
    // Task 5 (security review M2): a synchronous throw from here to the spawn (the env composition, the stream timeouts,
    // the bridge key, ...) still removes the staging folder, which may hold the carried helper strings, and is redacted.
    let detachBridge = () => {};
    // Task 5 (M13): the try's connector-calls log, redacted like this spawn's transcript once the spawn ends.
    const redactLog = () => { if (redactor && tryGuard && typeof tryGuard.logFile === 'string') redactTryLog(tryGuard.logFile, redactor); };
    try {
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
        tryGuard: tryGuard || null,
        signInEnv: carry && Object.keys(carry.env).length ? carry.env : null,
        signInOverModel: carryOverModelEnv(modelEnv),   // D71b (I3): where a normal run puts the user settings env
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
      // CLAUDE_SPAWN_ENV last: no fork sub-agents, whatever any tier says.
      spawnEnv = { ...withStreamTimeouts(spawnEnv), ...CLAUDE_SPAWN_ENV };

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
      detachBridge = () => { if (bridgeKey) bridgeEvents.off('failure', onBridgeFailure); };

      (_ov.superviseSpawn ?? superviseSpawn)({
        file: bin, cli: CLAUDE_CLI, args, displayBin: bin, cwd, env: spawnEnv, stdin: plan.stdin ?? null,
        signal, asAgent, stagedDir: plan.dir || null, onEvent,
        cleanup: () => {
          if (bridgeKey) bridgeEvents.off('failure', onBridgeFailure);
          cleanupStaged();
          redactLog();
        },
        stdoutErrorDetail: () => errorDetail || apiErrorText || bridgeFailureText,
        classify: classifyError,
        isBenignStderr: isBenignStderrLine,
        redactText: redactor ? redactor.text : null,
        spawnError: (err, prefix) => spawnFailure(err, prefix),
        // A8: a guarded read also returns its guard's decisions (read before cleanup removes the log), so the caller can
        // check that every tool call was decided (file-read-guard.mjs guardDecisionsCover).
        onDone: (code) => ({ text: resultText || assistantText, exitCode: code, ...(plan.readGuardLog ? { readGuardDecisions: readGuardDecisions(plan.readGuardLog) } : {}) }),
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
          // Claude Code can announce a spent subscription allowance as a
          // synthetic assistant frame while an async Bash/tool process keeps the
          // CLI alive indefinitely. Waiting for process exit in that case leaves
          // the WORCA run stuck in "running". Treat only the CLI's own synthetic
          // usage-limit message as terminal; ordinary model text that happens to
          // discuss a limit must remain normal output. superviseSpawn terminates
          // the CLI (and its tool tree) before rejecting, after which the existing
          // recovery policy turns this structured class into a graceful pause.
          if (evt?.type === 'assistant' && evt?.message?.model === '<synthetic>' && text
              && classifyError(text) === 'usage_limit') {
            const err = new Error(`${bin} reported: ${text.trim()}`);
            err.errorClass = 'usage_limit';
            return err;
          }
        },
      }).then(resolveP, rejectP);
    } catch (err) {
      detachBridge();
      cleanupStaged();
      redactLog();
      rejectP(err);
    }
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
  // A spawn with its own cost cap (an Ask turn's) gets the same cap as its token's budget: the
  // CLI's --max-budget-usd is the agent's own bookkeeping, the broker's holds whatever it does.
  const budgetUsd = typeof opts.maxBudgetUsd === 'number' && Number.isFinite(opts.maxBudgetUsd) && opts.maxBudgetUsd > 0 ? opts.maxBudgetUsd : undefined;
  let minted;
  try {
    minted = await mintSpawnToken({
      billTo: billTo || 'local', slots: [bridgeSlot || route.slot], kind, ttlSec: SPAWN_TTL_SEC[kind],
      runId: opts.runId || null, threadId: opts.threadId || null, isolated, budgetUsd,
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

/** Claude Code declares every capability worca uses. */
export const claudeCapabilities = Object.freeze(Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, true])));

/** The adapter's run(): every spawn goes through the credential broker when it is
 *  on (WORCA_BROKER_URL, runViaBroker), else straight to runClaudeProcess. Raw
 *  stream-json envelopes; engines/index.mjs normalizes them. */
export function runClaudeAdapter(opts) {
  return (brokerEnabled() ? runViaBroker : runClaudeProcess)(opts);
}
