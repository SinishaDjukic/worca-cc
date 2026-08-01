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
import { writeFile, mkdir, appendFile, readFile, access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_BIN = process.env.WORCA_CLAUDE_BIN || process.env.ORCH_CLAUDE_BIN || 'claude';

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
 * @returns {string[]}
 */
export function buildSettingsArgs(permissionRules) {
  const hook = buildHookSettings();
  const hasRules = !!permissionRules && Object.values(permissionRules).some((a) => Array.isArray(a) && a.length);
  // Present-but-malformed rules (e.g. `{deny: 'Bash(curl:*)'}`) make the object
  // truthy while hasRules stays false, so the whole policy would drop out of
  // argv silently. Say it once, then take the same no-rules path (fail-open,
  // matching readGuardrails) — the empty/absent cases ({}, {deny: []}, null)
  // are normal and stay quiet.
  if (!hasRules && permissionRules && typeof permissionRules === 'object'
      && Object.values(permissionRules).some((a) => a != null && !Array.isArray(a))) {
    console.warn('[worca] guardrails: permissionRules is malformed (deny/allow/ask must be arrays of strings) — ignoring it; this spawn carries NO permission rules');
  }
  if (!hook && !hasRules) return [];
  const settings = {};
  if (hook) settings.hooks = hook.hooks;
  if (hasRules) settings.permissions = permissionRules;
  const args = [];
  if (hook) args.push('--include-hook-events');
  args.push('--settings', JSON.stringify(settings));
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
function mockEnabled(opts) {
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
 * @param {string[]} [o.workspaceWriteTargets] §8.10 MOCK-ONLY member checkouts the mock
 *   implementer writes into instead of `cwd` (empty/absent => today's cwd behavior).
 *   Never reaches argv: `runReal` ignores it by construction.
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
    workspaceWriteTargets,
    resumeSessionId,
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
    return runMock({ cwd, systemPrompt, prompt, onEvent, signal, resumeSessionId, workspaceWriteTargets });
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
}) {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', permissionMode];
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  if (systemPrompt) {
    args.push('--append-system-prompt', systemPrompt);
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
  for (const a of buildSettingsArgs(permissionRules)) args.push(a);
  if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath);
  const tools = Array.isArray(allowedTools) ? allowedTools.slice() : [];
  for (const s of (Array.isArray(mcpServerGrants) ? mcpServerGrants : [])) {
    if (s && !tools.includes(s)) tools.push(s);          // union, never a duplicate
  }
  if (tools.length) {
    args.push('--allowedTools', tools.join(','));
  }
  return args;
}

function runReal({ cwd, systemPrompt, prompt, allowedTools, permissionMode, model, effort, onEvent, signal, bin, resumeSessionId, mcpConfigPath, mcpServerGrants, permissionRules, envScrub, envAllowlist }) {
  return new Promise((resolveP, rejectP) => {
    const args = buildClaudeArgs({
      prompt, systemPrompt, permissionMode, model, effort, allowedTools, resumeSessionId,
      mcpConfigPath, mcpServerGrants, permissionRules,
    });

    // undefined when the guardrail is off, and the spread then adds NO `env` key —
    // spawn inherits process.env exactly as it did before guardrails existed.
    const spawnEnv = buildSpawnEnv(envScrub, envAllowlist);

    let child;
    try {
      child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], ...(spawnEnv ? { env: spawnEnv } : {}) });
    } catch (err) {
      rejectP(new Error(`Failed to spawn ${bin}: ${err.message}`));
      return;
    }

    let resultText = '';
    let assistantText = '';
    let stderrBuf = '';
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

    child.stderr.on('data', (d) => {
      stderrBuf += d.toString();
    });

    child.on('error', (err) => {
      finish(rejectP, new Error(`${bin} error: ${err.message}`));
    });

    child.on('close', (code) => {
      rl.close();
      if (signal?.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        finish(rejectP, err);
        return;
      }
      if (code !== 0) {
        const detail = stderrBuf.trim() || errorDetail || 'no stderr';
        finish(rejectP, new Error(`${bin} exited with code ${code}: ${detail}`));
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
async function runMock({ cwd, systemPrompt, prompt, onEvent, signal, resumeSessionId, workspaceWriteTargets }) {
  abortIfNeeded(signal);
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
  if (m.MOCK_ASK) {
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
    case 'clarify':
      text = await mockClarify(m, cycle, onEvent);
      break;
    case 'planner-plan':
      text = await mockPlannerPlan(m, onEvent);
      break;
    case 'refiner':
      text = await mockRefiner(m, cycle, onEvent);
      break;
    case 'decomposer':
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
