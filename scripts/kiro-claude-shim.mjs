#!/usr/bin/env node
// scripts/kiro-claude-shim.mjs
// Drop-in stand-in for the `claude` binary that runs the turn on Kiro CLI instead.
//
// Worca already has the seam this needs: claude-runner.mjs resolves its binary from
// WORCA_CLAUDE_BIN. Point that at this file and NOTHING in src/ changes — the shim
// speaks claude's headless contract on the outside (claude argv in, stream-json
// NDJSON out) and Kiro's Agent Client Protocol on the inside.
//
//   export WORCA_CLAUDE_BIN=/abs/path/to/scripts/kiro-claude-shim.mjs
//
// ── Why ACP and not `kiro-cli chat --no-interactive` ─────────────────────────
// `chat --no-interactive` emits human prose wrapped in ANSI escapes and has no
// structured output mode (`-f json` only applies to --list-models/--list-sessions).
// Parsing it would lose the session id (pause/resume), the tool-call events (the
// UI's tool pills) and the spend. `kiro-cli acp` is line-delimited JSON-RPC 2.0
// over stdio and carries all three. Verified against kiro-cli 2.18.0.
//
// ── Protocol mapping ─────────────────────────────────────────────────────────
//   session/new -> sessionId          => {type:"system",subtype:"init",session_id}
//   agent_message_chunk               => {type:"assistant",message:{content:[{type:"text"}]}}
//   tool_call                         => {type:"assistant",message:{content:[{type:"tool_use"}]}}
//   tool_call_update status=completed => {type:"user",message:{content:[{type:"tool_result"}]}}
//   session/prompt response           => {type:"result",result:<full text>}
//
// ── Cost ─────────────────────────────────────────────────────────────────────
// Kiro meters in CREDITS, not dollars, and the credit price is a property of the
// OPERATOR'S PLAN, not of the protocol — nothing on the wire carries it. So the rate
// is configuration, never a built-in constant:
//
//   export WORCA_KIRO_USD_PER_CREDIT=0.04     # read off your own Kiro billing page
//
// Set it and the shim emits a real `total_cost_usd` that worca's extractResultCost()
// picks up, so per-phase spend, the budget cap and the stats rollups all work on the
// Kiro route. Leave it unset and NO cost field is emitted (unchanged behaviour) —
// guessing a rate would make worca report a confident wrong number, which is worse
// than reporting nothing. The credits are logged either way.
//
// Under the envScrub guardrail buildSpawnEnv() keeps only base + ANTHROPIC_/CLAUDE_
// vars, so WORCA_KIRO_USD_PER_CREDIT (like every WORCA_KIRO_* var) must be added to
// the project's envAllowlist or the cost silently reverts to unreported.
//
// ── Deliberate omissions ─────────────────────────────────────────────────────
//   --settings      Guardrail permission rules have no ACP equivalent. The shim
//                   REFUSES to run when real rules are present rather than
//                   silently running less sandboxed than the operator asked for.
//   --allowedTools  Not enforced; the run is --trust-all-tools (the acceptEdits
//                   analogue). Tool names differ entirely between the two CLIs.
//   --mcp-config    Not translated. session/new takes an mcpServers[] array, but
//                   worca's generated config shape was never mapped or tested.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const KIRO_BIN = process.env.WORCA_KIRO_BIN || 'kiro-cli';

// Model ids live-read from `kiro-cli chat --list-models -f json` (2.18.0). An id in
// this set is passed through untouched; anything else goes through MODEL_ALIASES.
const KIRO_MODELS = new Set([
  'auto', 'claude-sonnet-4.5', 'claude-sonnet-4', 'claude-haiku-4.5',
  'deepseek-3.2', 'minimax-m2.5', 'minimax-m2.1', 'glm-5', 'qwen3-coder-next',
]);

// Worca's built-in catalog is all Claude ids (claude-sonnet-4-6, claude-opus-4-8,
// the dated haiku id used by title generation, ...) and Kiro knows none of them, so
// an unmapped run would fail on every step. Map to the nearest Kiro model and SAY SO
// on the log stream — a silent substitution would misreport which model did the work.
const MODEL_ALIASES = [
  [/^claude-haiku/i, 'claude-haiku-4.5', ''],
  [/^claude-sonnet/i, 'claude-sonnet-4.5', ''],
  [/^claude-opus/i, 'claude-sonnet-4.5', ' (Kiro has no Opus tier)'],
];

/** ACP tool `kind` -> a Claude-style tool name, so worca's existing tool-pill
 *  formatter keeps rendering. Unknown kinds fall back to a capitalized kind rather
 *  than a wrong-but-familiar name. */
const TOOL_KINDS = {
  read: 'Read', edit: 'Edit', delete: 'Bash', move: 'Bash',
  search: 'Grep', execute: 'Bash', fetch: 'WebFetch', think: 'Task', other: 'Bash',
};

/** Resolve a worca model id to one Kiro accepts. Returns {model, note}. */
export function mapModel(id) {
  const forced = (process.env.WORCA_KIRO_MODEL || '').trim();
  if (forced) return { model: forced, note: id && id !== forced ? `model ${id} -> ${forced} (WORCA_KIRO_MODEL)` : '' };
  const raw = String(id || '').trim();
  if (!raw) return { model: '', note: '' };
  const bare = raw.replace(/\[1m\]$/i, '');            // worca's 1M-context twins
  if (KIRO_MODELS.has(bare)) return { model: bare, note: bare === raw ? '' : `model ${raw} -> ${bare}` };
  for (const [re, target, why] of MODEL_ALIASES) {
    if (re.test(bare)) return { model: target, note: `model ${raw} -> ${target}${why}` };
  }
  return { model: bare, note: '' };                    // unknown: let Kiro decide
}

/** Parse the subset of claude's headless argv that worca actually emits
 *  (buildClaudeArgs in src/core/claude-runner.mjs). Unknown flags are ignored. */
export function parseArgs(argv) {
  const o = { prompt: '', systemPrompt: '', model: '', effort: '', resume: '', settings: '', mcpConfig: '', allowedTools: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i] ?? '';
    if (a === '-p' || a === '--print') o.prompt = val();
    else if (a === '--append-system-prompt') o.systemPrompt = val();
    else if (a === '--model') o.model = val();
    else if (a === '--effort') o.effort = val();
    else if (a === '--resume') o.resume = val();
    else if (a === '--settings') o.settings = val();
    else if (a === '--mcp-config') o.mcpConfig = val();
    else if (a === '--allowedTools') o.allowedTools = val();
    else if (a === '--output-format' || a === '--permission-mode') val();  // consumed, unused
    // --verbose / --include-hook-events and anything else: no value, ignored
  }
  return o;
}

/** ACP has no system-prompt channel, and kiro-cli 2.18.0 IGNORES the `prompt` field
 *  of an agent config in headless mode (probed twice against the real binary — the
 *  override never applied). Folding it into the user message is the only path that
 *  actually reaches the model. */
export function foldSystemPrompt(systemPrompt, prompt) {
  if (!systemPrompt) return prompt;
  return `<system-instructions>\n${systemPrompt}\n</system-instructions>\n\n${prompt}`;
}

/**
 * The operator-declared credit price, or null when unset/unusable.
 * A malformed or non-positive value is treated as UNSET rather than coerced: a typo'd
 * rate must degrade to "no cost reported", never to a fabricated one. 0 is rejected
 * too — a free plan still costs nothing per credit, and emitting $0.00 would be
 * indistinguishable from a real measured zero.
 * @param {string|undefined} raw
 * @returns {number|null}
 */
export function parseUsdPerCredit(raw) {
  const n = Number(String(raw ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Convert metered credits to dollars. Returns null when either side is missing, so
 * the caller can simply omit the field.
 *
 * Null on credits <= 0 is load-bearing, not defensive tidiness: `_kiro.dev/metadata`
 * has no ordering guarantee against the session/prompt response, so a turn whose
 * metering line lands after the result settles ends with 0 credits counted. Emitting
 * $0.00 there would report "this step was free" when the truth is "we never saw the
 * meter" — the exact confident-wrong-number failure this shim avoids elsewhere.
 * @param {number} credits
 * @param {number|null} usdPerCredit
 * @returns {number|null}
 */
export function usdFromCredits(credits, usdPerCredit) {
  if (!usdPerCredit || !(credits > 0)) return null;
  const usd = credits * usdPerCredit;
  return Number.isFinite(usd) ? usd : null;
}

/** True when a --settings payload carries guardrail permission rules we cannot honor. */
export function hasPermissionRules(settingsJson) {
  if (!settingsJson) return false;
  try {
    const p = JSON.parse(settingsJson).permissions;
    return !!p && Object.values(p).some((a) => Array.isArray(a) && a.length > 0);
  } catch {
    return false;   // unparseable payload is not a rule set; the CLI would ignore it too
  }
}

/**
 * Translate one ACP message into the stream-json events worca expects.
 * Pure and stateful-by-argument so it can be unit-tested without a child process.
 *
 * @param {any} m       parsed JSON-RPC message from kiro-cli acp
 * @param {{replaying:boolean}} state
 * @returns {object[]}  zero or more stream-json events
 */
export function translate(m, state) {
  const u = m?.params?.update;
  if (!u) return [];
  // session/load REPLAYS the entire prior conversation as agent_message_chunk before
  // going live (verified). Without this guard every resumed step returns stale text.
  if (u.sessionUpdate === 'agent_message_chunk') {
    if (state.replaying) return [];
    const text = u.content?.text || '';
    return text ? [{ type: 'assistant', message: { content: [{ type: 'text', text }] } }] : [];
  }
  if (u.sessionUpdate === 'tool_call') {
    return [{ type: 'assistant', message: { content: [{
      type: 'tool_use',
      id: u.toolCallId,
      name: TOOL_KINDS[u.kind] || (u.kind ? u.kind[0].toUpperCase() + u.kind.slice(1) : 'Bash'),
      input: u.rawInput || { title: u.title },
    }] } }];
  }
  if (u.sessionUpdate === 'tool_call_update' && u.status === 'completed') {
    return [{ type: 'user', message: { content: [{
      type: 'tool_result', tool_use_id: u.toolCallId, content: u.title || 'ok',
    }] } }];
  }
  return [];
}

// ── the run ──────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  // A non-JSON stdout line is surfaced by worca's runner as {type:'log'} — the right
  // channel for shim diagnostics that must not pollute the assistant text.
  const log = (t) => process.stdout.write(`[kiro-shim] ${t}\n`);

  // Fail loudly rather than run less sandboxed than the operator asked for.
  if (hasPermissionRules(opts.settings)) {
    out({ type: 'result', subtype: 'error', is_error: true,
          result: 'kiro-claude-shim: guardrail permission rules are not supported on the Kiro route ' +
                  '(--settings has no ACP equivalent). Disable the guardrail or run this project on Claude Code.' });
    process.exitCode = 1;
    return;
  }
  if (opts.mcpConfig) log('warning: --mcp-config is not translated to ACP; MCP servers will be unavailable this run');

  const { model, note } = mapModel(opts.model);
  if (note) log(note);

  const args = ['acp', '--trust-all-tools'];
  if (model) args.push('--model', model);
  if (opts.effort) args.push('--effort', opts.effort);   // same value set as worca's EFFORTS

  let child;
  try {
    child = spawn(KIRO_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    out({ type: 'result', subtype: 'error', is_error: true, result: `failed to spawn ${KIRO_BIN}: ${err.message}` });
    process.exitCode = 1;
    return;
  }

  const state = { replaying: false };
  const usdPerCredit = parseUsdPerCredit(process.env.WORCA_KIRO_USD_PER_CREDIT);
  let nextId = 1, initId = 0, sessionRpcId = 0, promptId = 0;
  let sessionId = opts.resume || null;
  let text = '';
  let credits = 0;
  let settled = false;

  const send = (o) => { try { child.stdin.write(JSON.stringify(o) + '\n'); } catch { /* child gone */ } };
  const call = (method, params) => { const id = nextId++; send({ jsonrpc: '2.0', id, method, params }); return id; };

  const settle = (code, errText) => {
    if (settled) return;
    settled = true;
    // Credits are burned whether the turn succeeded or blew up, so the cost rides on
    // BOTH result shapes. Absent an operator rate this spreads to {} and the event is
    // byte-identical to the pre-costing one — worca then treats the missing field as
    // "no cost reported" rather than a confident $0.00 (see header).
    const usd = usdFromCredits(credits, usdPerCredit);
    const cost = usd == null ? {} : { total_cost_usd: usd };
    if (usd != null) log(`cost: ${credits.toFixed(4)} credits x $${usdPerCredit}/credit = $${usd.toFixed(4)} (WORCA_KIRO_USD_PER_CREDIT)`);
    else if (credits > 0) log('cost: set WORCA_KIRO_USD_PER_CREDIT to report these credits as dollars');
    if (errText) out({ type: 'result', subtype: 'error', is_error: true, result: errText, ...cost });
    else out({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: sessionId, ...cost });
    process.exitCode = code;
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } process.exit(code); }, 2000).unref();
  };

  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.trim()) return;
    let m;
    try { m = JSON.parse(line); } catch { return; }   // kiro's own non-JSON chatter

    // 1. handshake -> a new session, or re-attach the one worca handed us
    if (m.id === initId && m.result) {
      if (opts.resume) {
        state.replaying = true;
        sessionRpcId = call('session/load', { sessionId: opts.resume, cwd: process.cwd(), mcpServers: [] });
      } else {
        sessionRpcId = call('session/new', { cwd: process.cwd(), mcpServers: [] });
      }
      return;
    }

    // 2. session ready -> surface the id (worca persists it for --resume), then prompt
    if (m.id === sessionRpcId && sessionRpcId) {
      if (m.error) return settle(1, `kiro session failed: ${JSON.stringify(m.error)}`);
      state.replaying = false;
      sessionId = m.result?.sessionId || sessionId;
      out({ type: 'system', subtype: 'init', session_id: String(sessionId) });
      promptId = call('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: foldSystemPrompt(opts.systemPrompt, opts.prompt) }],
      });
      return;
    }

    // 3. streaming updates -> worca's event shapes
    if (m.method === 'session/update') {
      for (const evt of translate(m, state)) {
        if (evt.type === 'assistant' && evt.message?.content?.[0]?.type === 'text') {
          text += evt.message.content[0].text;
        }
        out(evt);
      }
      return;
    }

    // 4. metering — accumulated across every metadata message of the turn (a multi-step
    //    turn meters more than once), converted to USD at settle if a rate is configured
    if (m.method === '_kiro.dev/metadata' && Array.isArray(m.params?.meteringUsage)) {
      const delta = m.params.meteringUsage.reduce((a, x) => a + (Number(x.value) || 0), 0);
      if (delta > 0) { credits += delta; log(`credits: ${delta.toFixed(4)}`); }
      return;
    }

    // 5. permission requests — defensive; --trust-all-tools should prevent these
    if (m.method === 'session/request_permission' && m.id != null) {
      const optionId = m.params?.options?.find((o) => /allow/i.test(o.optionId || o.name || ''))?.optionId
        ?? m.params?.options?.[0]?.optionId;
      send({ jsonrpc: '2.0', id: m.id, result: { outcome: { outcome: 'selected', optionId } } });
      return;
    }

    // 6. turn complete
    if (m.id === promptId && promptId) {
      if (m.error) return settle(1, `kiro prompt failed: ${JSON.stringify(m.error)}`);
      settle(0);
    }
  });

  let stderrBuf = '';
  child.stderr.on('data', (d) => { stderrBuf += d.toString(); });
  child.on('error', (err) => settle(1, `${KIRO_BIN} error: ${err.message}`));
  child.on('close', (code) => {
    if (settled) return;
    settle(code === 0 ? 0 : (code ?? 1),
      code === 0 ? 'kiro-cli exited before the turn completed' : `kiro-cli exited with code ${code}: ${stderrBuf.trim() || 'no stderr'}`);
  });

  // Worca aborts a run by SIGTERM-ing this process; take the child down with us.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => { try { child.kill('SIGKILL'); } catch { /* ignore */ } process.exit(143); });
  }

  // fs/* declared false so kiro does its own file IO and never calls back into us.
  initId = call('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
  });
}

// Run only when executed as a binary; importing for tests must not spawn anything.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
