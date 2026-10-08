// src/core/night/analysis.mjs
// The nightDecider: ONE headless, read-only call on the run's engine that scores each option of
// an ask on weighted criteria. Inline prompt (like the Auto classifier), NOT a registered agent,
// so it never appears in the workflow/step catalogs.
import { runClaude, mockEnabled } from '../claude-runner.mjs';
import { normalizingOnEvent } from '../engines/claude-events.mjs';
import { isNormalized } from '../engines/events.mjs';
import { resolveModelEnv, resolveModelCost } from '../config.mjs';
import { bridgeCostFor, forgetBridgeTag } from '../bridge/telemetry.mjs';
import { safeParseJson } from '../protocol.mjs';
import { memoryRoot, GLOBAL_SCOPE, projectScope, listMemory, readMemory } from '../memory-store.mjs';
import { NIGHT_CRITERIA } from './config.mjs';
import { RUN_READ_DENY_RULES } from '../ask/deny-rules.mjs';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { writeFilesMcpConfig } from '../engines/codex-files-mcp.mjs';
import { redactAskText } from '../ask/redact.mjs';

export const NIGHT_DECIDER_SYSTEM_PROMPT = `You are worca's nightDecider. The developer is away and a run is waiting on a question they would normally answer.
Decide as THEY would. Their stated preferences (the "Worca memory" rules below) outrank everything else.
You may read the repository (Read, Grep, Glob) to check conventions and scope; never modify anything.
Score EVERY option of EVERY question on each criterion from 0 (worst) to 10 (best):
- matchesMemory: agrees with the developer's stated preferences and prior decisions
- reversible: easy to undo later (fewest irreversible effects: no data loss, no public API/schema commitments)
- smallestScope: the smallest change that satisfies the task
- codebaseConventions: fits how this codebase already does things
- cost: cheaper to build and run
Reply with ONLY this JSON (no prose, no fences):
{"decisions":[{"id":"<question id>","choice":"<one option, verbatim>","confidence":<0-100>,"rationale":"<2-3 sentences>","reversible":<true|false>,"scores":{"<option>":{"matchesMemory":n,"reversible":n,"smallestScope":n,"codebaseConventions":n,"cost":n}}}]}`;

/** The decider's system prompt on `engine`. On Codex the repository is read through worca's file tools
 *  (engines/codex-files-mcp.mjs), which take absolute paths. */
export function nightDeciderSystemPrompt(engine = 'claude', cwd = '') {
  if (!engine || engine === 'claude') return NIGHT_DECIDER_SYSTEM_PROMPT;
  return NIGHT_DECIDER_SYSTEM_PROMPT.replace('You may read the repository (Read, Grep, Glob) to check conventions and scope; never modify anything.',
    `You may read the repository at ${cwd} and the plan files with the read_file, grep and glob tools (absolute paths) to check conventions and scope; never modify anything.`);
}

const MEMORY_MAX_BYTES = 24_000;
// The task is inlined for orientation; task.md (a plan path) holds all of it.
const TASK_MAX_BYTES = 16_000;
const TIMEOUT_MS = 5 * 60_000;
const MAX_TURNS = 12;
const TOOLS = ['Read', 'Grep', 'Glob'];
// Ask Worca's secret-path denies, minus the run store and checkouts: the decider's cwd is the
// run's checkout (under .worca-cc/runs) and its plan files live in the store.
export const NIGHT_DENY_RULES = RUN_READ_DENY_RULES;

/** Cut `text` to `max` UTF-8 bytes (never mid-character) and say so with `note`. */
export function capText(text, max, note) {
  const s = String(text ?? '');
  if (Buffer.byteLength(s) <= max) return s;
  return `${Buffer.from(s, 'utf8').subarray(0, max).toString('utf8').replace(/\uFFFD+$/, '')}\n…(truncated: ${note})`;
}

/** Project + global memory bodies as one text block, capped. Project rules come first, so a cut
 *  drops global rules before the rules specific to this project. Never throws. */
export async function readMemoryText(projectKeyValue) {
  const parts = [];
  try {
    const root = memoryRoot();
    for (const [label, scope] of [['Project', projectKeyValue ? projectScope(projectKeyValue) : null], ['Global', GLOBAL_SCOPE]]) {
      if (!scope) continue;
      for (const e of await listMemory(root, scope)) {
        const m = await readMemory(root, scope, e.name).catch(() => null);
        if (m && m.body) parts.push(`### ${label}: ${e.name}\n${m.body.trim()}`);
      }
    }
  } catch { /* no memory yet */ }
  const text = parts.join('\n\n');
  return capText(text, MEMORY_MAX_BYTES, 'later rules did not fit');
}

export function buildAnalysisPrompt({ questions, task, planPaths = [], memory, criteria, context = '' }) {
  const crit = Object.entries(criteria).map(([k, w]) => `- ${k} (weight ${w})`).join('\n');
  const qs = questions.map((q) => `- id: ${q.id}\n  question: ${q.question}\n  options:\n${q.options.map((o, k) => `    - ${JSON.stringify(o)}${Array.isArray(q.confidence) ? ` (agent confidence ${q.confidence[k]}%)` : ''}`).join('\n')}`).join('\n');
  return [
    '## Task', task ? capText(task, TASK_MAX_BYTES, 'the full task is in task.md when it is listed below') : '(none)',
    planPaths.length ? `## Plan files (read them)\n${planPaths.map((p) => `- ${p}`).join('\n')}` : '',
    context ? `## Context\n${context}` : '',
    '## Worca memory (the developer\'s stated preferences)', memory || '(none recorded)',
    '## Criteria and weights', crit,
    '## Questions', qs,
  ].filter(Boolean).join('\n\n');
}

export function normalizeAnalysis(parsed) {
  const out = {};
  for (const d of Array.isArray(parsed?.decisions) ? parsed.decisions : []) {
    if (!d || typeof d.id !== 'string') continue;
    const scores = {};
    for (const [opt, s] of Object.entries(d.scores && typeof d.scores === 'object' ? d.scores : {})) {
      const row = {};
      for (const k of NIGHT_CRITERIA) if (Number.isFinite(s?.[k])) row[k] = Math.min(10, Math.max(0, s[k]));
      scores[opt] = row;
    }
    out[d.id] = {
      choice: typeof d.choice === 'string' ? d.choice : '',
      confidence: Number.isFinite(d.confidence) ? Math.min(100, Math.max(0, Math.round(d.confidence))) : 0,
      // Redacted here, at the source: the rationale is stored, broadcast over WS and served by the API.
      rationale: typeof d.rationale === 'string' ? redactAskText(d.rationale.slice(0, 2000)) : '',
      reversible: d.reversible === true,
      scores,
    };
  }
  return out;
}

const zeroTurnUsage = () => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });

/**
 * One analysis call for all questions of an ask.
 * `peakContextTokens` = the fullest the call's context got: the largest prompt (input + cache read +
 * cache write) of any of its own turns. `usage` sums every turn, so it cannot say that.
 * `priced` = at least one `result` frame carried a cost (re-priced by resolveModelCost). A call that
 * ends without one has an unknown cost, so the caller keeps only a list-price LOWER BOUND of
 * `turnUsage` (the per-message usage, each message id counted once — the CLI repeats a message's
 * usage on every content block). `turnModel` = the last model id those messages named: the floor's
 * price when no model was configured (the CLI's default). A thrown error carries the same fields;
 * `notStarted` marks a call that never reached the API, so it costs nothing: its signal was already aborted
 * (nothing is spawned), or it ended with no stream-json frame and nothing priced (the CLI's system/init
 * line precedes every API request).
 * @returns {Promise<{byId:Record<string,object>, costUsd:number, priced:boolean, usage:object, turnUsage:object, turnModel:string|null, peakContextTokens:number}>}
 */
export async function runNightAnalysis({ questions, cwd, task, planPaths, memory, criteria, context, model = null, effort = 'medium',
  engine = 'claude', run = runClaude, bin, mock = false, envScrub, envAllowlist, signal, bridgeTag = null } = {}) {
  if (mockEnabled({ mock })) {
    // Offline mock (claude.mock / WORCA_MOCK, like the Auto classifier): deterministic, $0 — recommended else first, confident enough to pass 60.
    const byId = {};
    for (const q of questions) byId[q.id] = { choice: q.recommended || q.options[0], confidence: 70, rationale: '[mock] night analysis', reversible: true, scores: {} };
    return { byId, costUsd: 0, priced: true, usage: {}, turnUsage: zeroTurnUsage(), turnModel: null, peakContextTokens: 0 };
  }
  // Aborted while the review was being prepared (the user answered, a pause or a stop): spawn nothing.
  if (signal?.aborted) {
    throw Object.assign(new Error('aborted'), { name: 'AbortError', notStarted: true, costUsd: 0, priced: false, usage: {}, turnUsage: zeroTurnUsage(), turnModel: null, peakContextTokens: 0 });
  }
  const onClaude = !engine || engine === 'claude';
  // On Codex: a read-only spawn with its shell off, reading the checkout and the plan folders through worca's
  // file tools under the same deny rules (NIGHT_DENY_RULES); maxTurns caps its tool calls (codex.mjs).
  const roots = onClaude ? [] : [...new Set([cwd, ...(planPaths || []).map((p) => dirname(p))].filter(Boolean))];
  const mcpConfigPath = onClaude ? null : writeFilesMcpConfig({ dir: join(worcaHome(), 'tmp', 'night'), roots, name: 'night' });
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal?.aborted) ctrl.abort(); else signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let costUsd = 0; let priced = false; let peakContextTokens = 0; const usage = { input_tokens: 0, output_tokens: 0 };
  const perMsg = new Map();                       // message.id → its (last) usage
  let turnModel = null;                           // the last model id the call's own messages named
  let sawFrame = false;                           // any stream-json frame: the CLI started (its system/init line precedes every API request)
  const turnUsage = () => {
    const t = zeroTurnUsage();
    for (const u of perMsg.values()) for (const k of Object.keys(t)) t[k] += Number(u?.[k]) || 0;
    return t;
  };
  // The upstream-reported USD booked under this call's bridge tag since the last read (null when none).
  const takeUpstream = () => {
    const up = bridgeTag ? bridgeCostFor(bridgeTag) : null;
    if (!up) return null;
    forgetBridgeTag(bridgeTag);
    return up.costUsd;
  };
  const onFrame = normalizingOnEvent((e) => {
    // A main-stream message's own usage (`phase: 'message'`: the completed assistant
    // message, not a partial-message start/delta); sub-agent turns do not count.
    const mu = e.type === 'usage' && e.phase === 'message' && (e.parentId ?? null) === null ? e.usage : null;
    if (mu) {
      const ctx = (Number(mu.input_tokens) || 0) + (Number(mu.cache_read_input_tokens) || 0) + (Number(mu.cache_creation_input_tokens) || 0);
      if (ctx > peakContextTokens) peakContextTokens = ctx;
      perMsg.set(e.messageId ?? `n${perMsg.size}`, mu);
      if (typeof e.model === 'string' && e.model) turnModel = e.model;
    }
    if (e.type !== 'result') return;
    const u = e.usage;
    // Codex streams no per-message usage: its one turn's prompt is the fullest the context got.
    if (!onClaude && u) peakContextTokens = Math.max(peakContextTokens, (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0));
    if (u) { usage.input_tokens += Number(u.input_tokens) || 0; usage.output_tokens += Number(u.output_tokens) || 0; }
    if (e.costUsd == null) return;
    // A bridged model: what the upstream said the call cost wins over the CLI's figure (the same
    // precedence as a pipeline node, run-harness _onAgentEvent).
    const up = takeUpstream();
    const c = up != null ? up : resolveModelCost(model, Number(e.costUsd), u);
    if (Number.isFinite(c)) { costUsd += c; priced = true; }
  });
  try {
    const res = await run({
      cwd, systemPrompt: nightDeciderSystemPrompt(engine, cwd),
      prompt: buildAnalysisPrompt({ questions, task, planPaths, memory, criteria: criteria || {}, context }),
      // `model` / `effort` = the RESOLVED decider pair (night/decider-model.mjs): env and cost follow it.
      // `bridgeTag` names this call to worca's model bridge, so a bridged model's upstream-reported cost
      // can be read back below (the CLI prices an id it does not know at $0). No-op for other models.
      model, modelEnv: onClaude ? resolveModelEnv(model, { tag: bridgeTag || undefined }) : undefined, effort,
      ...(onClaude ? {} : { engine, sandbox: 'read-only', mcpConfigPath }),
      // The prompt carries agent-written question text, so the spawn is sandboxed like Ask Worca's:
      // no MCP servers, user hooks/plugins or slash commands, no edit mode, secret paths denied.
      permissionMode: 'dontAsk', strictMcpConfig: true, settingSources: ['project'], disableSlashCommands: true,
      permissionRules: { deny: [...NIGHT_DENY_RULES] },
      allowedTools: [...TOOLS], tools: [...TOOLS], maxTurns: MAX_TURNS,
      signal: ctrl.signal, bin, envScrub, envAllowlist, spawnKind: 'aux',
      onEvent: (e) => {
        // Any stream frame (a Claude stream-json line, or an engine's normalized event): the CLI started.
        if ((e?.raw && typeof e.raw === 'object') || (isNormalized(e) && e.type !== 'stderr' && e.type !== 'log')) sawFrame = true;
        onFrame(e);
      },
    });
    return { byId: normalizeAnalysis(safeParseJson(String(res?.text || ''))), costUsd, priced, usage, turnUsage: turnUsage(), turnModel, peakContextTokens };
  } catch (err) {
    // A failed or aborted call was still billed for what it ran: hand the cost to the caller.
    // A bridged upstream may have billed turns that never reached a `result`: that figure is real (priced).
    const up = takeUpstream();
    if (up != null) { costUsd += up; priced = true; }
    // No frame at all and nothing priced (a missing binary, a broker error, a model env that would not
    // resolve, an abort before the CLI's first line): the call never reached the API — like a call that
    // never spawned, it is no review and costs nothing (notStarted).
    if (err && typeof err === 'object') Object.assign(err, { costUsd, priced, usage, turnUsage: turnUsage(), turnModel, peakContextTokens, ...(sawFrame || priced ? {} : { notStarted: true }) });
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
    if (mcpConfigPath) rmSync(mcpConfigPath, { force: true });
    if (bridgeTag) forgetBridgeTag(bridgeTag);
  }
}
