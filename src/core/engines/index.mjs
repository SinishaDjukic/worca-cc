// src/core/engines/index.mjs
// The engine registry: the only way to get a runner. An unknown name is a hard
// error at run start, never a silent fallback; mock mode (WORCA_MOCK or
// opts.mock) resolves every known engine to the offline mock. An adapter is
// {name, capabilities, run, classifyError[, preflight, unenforcedRules, partialRules,
// ruleReach, ruleKind, unattachableMcp, chat]}: see the codex, copilot, cursor, gemini, goose, opencode and qwen entries below.
import { runClaudeAdapter, claudeCapabilities, claudeDenials, buildSettingsPayload, removeClaudeSessions } from './claude.mjs';
import { runMock } from './mock.mjs';
import { normalizingOnEvent } from './claude-events.mjs';
import { classifyError } from '../recoverable-error.mjs';
import { runCodexProcess, codexCapabilities, classifyCodexError, codexPreflight, unenforcedRules, partialRules, codexMcpProblems, CODEX_COMMAND_RULE_REACH, codexRulePlan, removeCodexSessions, codexChat } from './codex.mjs';
import * as copilot from './copilot.mjs';
import { runCursorProcess, cursorCapabilities, classifyCursorError, cursorPreflight,
  unenforcedRules as cursorUnenforced, partialRules as cursorPartial, CURSOR_RULE_TERMS, cursorRulePlan, removeCursorSessions, cursorChat } from './cursor.mjs';
import * as gemini from './gemini.mjs';
import * as goose from './goose.mjs';
import * as opencode from './opencode.mjs';
import * as qwen from './qwen.mjs';

/** The denials in a captured JSONL stream, by a predicate over each parsed event that names the refused tool. */
const denialsBy = (pick) => (lines) => {
  const out = [];
  for (const raw of lines || []) { let e; try { e = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { continue; } const d = pick(e); if (d) out.push(d); }
  return out;
};
// Copilot: a tool call its --deny-tool rules refused (test/fixtures/copilot/denied.jsonl, a 1.0.100 capture).
const copilotDenials = denialsBy((e) => (e?.type === 'tool.execution_complete' && e.data?.error?.code === 'denied'
  ? { tool: e.data?.toolTelemetry?.properties?.tool_name || 'shell', subagent: !!e.data?.parentToolCallId } : null));
// Cursor: a tool call its permission file rejected.
const cursorDenials = denialsBy((e) => (e?.type === 'tool_call' && e.subtype === 'completed' && Object.values(e.tool_call || {}).some((c) => c?.result?.rejected)
  ? { tool: Object.keys(e.tool_call)[0], subagent: false } : null));

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { engineEntry, ruleKind } from '../../shared/engine-switch.mjs';

export { CAPABILITY_KEYS, CAPABILITY_FALLBACKS, describeUnattachableMcp } from './capabilities.mjs';

/** Every adapter's run() emits the normalized vocabulary (src/core/engines/events.mjs).
 *  The Claude runner and the mock still build stream-json envelopes internally;
 *  the Claude normalizer turns them into that vocabulary here, once. */
const normalized = (run) => (opts) => {
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : () => {};
  // One throwing listener call must not swallow the rest of that frame's events.
  return run({ ...opts, onEvent: normalizingOnEvent((e) => { try { onEvent(e); } catch { /* listener errors never break the stream */ } }) });
};

/** Stored session ids of other engines are engine-qualified (`codex:<thread>`);
 *  Claude's are bare UUIDs. Never hand another engine's session to `--resume`. */
const claudeRun = normalized(runClaudeAdapter);
function runClaudeEngine(opts) {
  if (typeof opts.resumeSessionId === 'string' && /^[a-z]+:/.test(opts.resumeSessionId)) {
    try { opts.onEvent?.({ type: 'stderr', stream: 'err', text: `[worca] claude: stored session ${JSON.stringify(opts.resumeSessionId.slice(0, 16))}… belongs to another engine — starting a fresh session` }); } catch { /* listener errors never break the stream */ }
    return claudeRun({ ...opts, resumeSessionId: undefined });
  }
  return claudeRun(opts);
}

// `rulePlan(rules)`: what the adapter makes of the deny rules (Claude: its --settings payload), the translation the
// catalog's rule fixtures pin (test/fixtures/engine-rules/<engine>/<kind>.json). `denials(lines)`: the refusals in a
// captured stream, `{tool, subagent}` (the proof a 'held' kind needs).
// `denySubagentTool(spawnOpts)`: the spawn options that switch the engine's sub-agent tool off (decision 11;
// subagentPolicy), or null when it cannot.
const subagentsOff = (o) => ({ ...o, subagentsOff: true });
const claudeAdapter = Object.freeze({ name: 'claude', capabilities: claudeCapabilities, run: runClaudeEngine, classifyError,
  rulePlan: (rules) => buildSettingsPayload(rules)?.settings?.permissions ?? null, denials: claudeDenials, denySubagentTool: subagentsOff,
  removeSessions: removeClaudeSessions });
// codex emits the normalized vocabulary itself (engines/codex.mjs). `preflight` is the
// optional run-start check (the binary runs and is signed in); the Claude adapter has
// its own (preflight.mjs).
// `unenforcedRules(rules)`: the deny rules this engine cannot hold (the run gate refuses those unless allowed);
// an engine without it holds every rule its `permissionRules` capability says it can.
// `partialRules(rules)`: the deny rules it holds only in part (codex: command rules); the gate refuses those
// unless allowed too, and the spawn still applies them; `ruleReach` says in words how far those rules reach, and
// `ruleKind` what those rules are on this engine (the gate and the run log name them so).
// `unattachableMcp(servers)`: the --mcp-config servers this engine cannot attach, as `{name, reason}` (reasons:
// capabilities.mjs describeUnattachableMcp); the run gate refuses a registry copy among them and warns about the rest.
// An engine without it attaches what Claude Code does.
// `chat`: the adapter's chat descriptor (engines/chat-descriptor.mjs) — Chat runs on it, locked down (engines/chat.mjs).
const codexAdapter = Object.freeze({ name: 'codex', capabilities: codexCapabilities, run: runCodexProcess, classifyError: classifyCodexError, preflight: codexPreflight,
  unenforcedRules, partialRules, ruleReach: CODEX_COMMAND_RULE_REACH, ruleKind: 'command rules', unattachableMcp: codexMcpProblems,
  rulePlan: codexRulePlan, denials: () => [], denySubagentTool: subagentsOff, removeSessions: removeCodexSessions, chat: codexChat });
// The GitHub Copilot CLI (engines/copilot.mjs): emits the normalized vocabulary itself, like codex.
const copilotAdapter = Object.freeze({ name: 'copilot', capabilities: copilot.copilotCapabilities, run: copilot.runCopilotProcess,
  classifyError: copilot.classifyCopilotError, preflight: copilot.copilotPreflight, unenforcedRules: copilot.unenforcedRules,
  partialRules: copilot.partialRules, ruleReach: copilot.COPILOT_COMMAND_RULE_REACH, ruleKind: 'command and write rules',
  unattachableMcp: copilot.copilotMcpProblems, rulePlan: copilot.copilotRulePlan, denials: copilotDenials, denySubagentTool: subagentsOff,
  removeSessions: copilot.removeCopilotSessions, chat: copilot.copilotChat });
// cursor emits the normalized vocabulary itself (engines/cursor.mjs). Every rule it is given is partial (cursorRulePlan).
const cursorAdapter = Object.freeze({ name: 'cursor', capabilities: cursorCapabilities, run: runCursorProcess, classifyError: classifyCursorError,
  preflight: cursorPreflight, unenforcedRules: cursorUnenforced, partialRules: cursorPartial,
  ruleReach: CURSOR_RULE_TERMS.reach, ruleKind: CURSOR_RULE_TERMS.kind, rulePlan: cursorRulePlan, denials: cursorDenials,
  denySubagentTool: () => null, removeSessions: removeCursorSessions, chat: cursorChat });
// Gemini CLI and Qwen Code (engines/gemini.mjs, engines/qwen.mjs on the shared engines/gemini-family.mjs runner):
// emit the normalized vocabulary themselves; command rules (and Gemini's path rules) are partial.
// Its rule plan is the policy rules it is told (the home fixed, so a fixture's `~/` paths read the same everywhere); it
// has no sub-agent tool to switch off.
const geminiAdapter = Object.freeze({ name: 'gemini', capabilities: gemini.geminiCapabilities, run: gemini.runGeminiProcess,
  classifyError: gemini.classifyGeminiError, preflight: gemini.geminiPreflight, unenforcedRules: gemini.unenforcedRules,
  partialRules: gemini.partialRules, ruleReach: gemini.GEMINI_RULE_TERMS.reach, ruleKind: gemini.GEMINI_RULE_TERMS.kind,
  rulePlan: (rules) => gemini.geminiRulePlan(rules, { home: '/home/u' }), denials: gemini.geminiDenials, denySubagentTool: () => null,
  removeSessions: gemini.removeGeminiSessions, chat: gemini.geminiChat });
// Goose (engines/goose.mjs) emits the normalized vocabulary itself. It holds no permission rule (capability false); its
// sessions are rows of its own database.
const gooseAdapter = Object.freeze({ name: 'goose', capabilities: goose.gooseCapabilities, run: goose.runGooseProcess,
  classifyError: goose.classifyGooseError, preflight: goose.goosePreflight, unattachableMcp: goose.gooseMcpProblems,
  removeSessions: goose.removeGooseSessions, chat: goose.gooseChat });
// OpenCode (engines/opencode.mjs) emits the normalized vocabulary itself; its rules ride OPENCODE_CONFIG_CONTENT.
// Its rule plan is the permission config it is told (the cwd and home fixed, so a fixture's paths read the same
// everywhere); its `task` tool is denied by config when the run's sub-agents are off.
const opencodeAdapter = Object.freeze({ name: 'opencode', capabilities: opencode.opencodeCapabilities, run: opencode.runOpencodeProcess,
  classifyError: opencode.classifyOpencodeError, preflight: opencode.opencodePreflight, unenforcedRules: opencode.unenforcedRules,
  partialRules: opencode.partialRules, ruleReach: opencode.OPENCODE_RULE_TERMS.reach, ruleKind: opencode.OPENCODE_RULE_TERMS.kind,
  rulePlan: (rules) => opencode.opencodeRulePlan(rules, { cwd: '/w/run', home: '/home/u' }), denials: () => [], denySubagentTool: subagentsOff,
  chat: opencode.opencodeChat });
// Qwen Code (engines/qwen.mjs): its sub-agent tools are excluded by flag (--exclude-tools).
const qwenAdapter = Object.freeze({ name: 'qwen', capabilities: qwen.qwenCapabilities, run: qwen.runQwenProcess,
  classifyError: qwen.classifyQwenError, preflight: qwen.qwenPreflight, unenforcedRules: qwen.unenforcedRules,
  partialRules: qwen.partialRules, ruleReach: qwen.QWEN_RULE_TERMS.reach, ruleKind: qwen.QWEN_RULE_TERMS.kind,
  rulePlan: qwen.qwenRulePlan, denials: qwen.qwenDenials, denySubagentTool: subagentsOff, removeSessions: qwen.removeQwenSessions, chat: qwen.qwenChat });
// The mock stands in for Claude in tests and smokes, so it declares Claude's map.
const mockAdapter = Object.freeze({ name: 'mock', capabilities: claudeCapabilities, run: normalized(runMock), classifyError });

// `removeSessions({sessionIds})`: removes the engine's own sessions named by a run's session ids, never its sign-in
// (catalog `sessions` other than 'none'; removeRunSessions).
const ENGINES = new Map([
  ['claude', claudeAdapter],
  ['codex', codexAdapter],
  ['copilot', copilotAdapter],
  ['cursor', cursorAdapter],
  ['gemini', geminiAdapter],
  ['goose', gooseAdapter],
  ['opencode', opencodeAdapter],
  ['qwen', qwenAdapter],
  ['mock', mockAdapter],
]);

/**
 * @param {string} [name]  engine name; blank means 'claude'
 * @param {{mock?: boolean}} [o]
 */
export function getEngine(name = 'claude', { mock = false } = {}) {
  const key = typeof name === 'string' && name.trim() ? name.trim() : 'claude';
  const engine = ENGINES.get(key);
  if (!engine) throw new Error(`unknown engine "${key}" (known: ${[...ENGINES.keys()].join(', ')})`);
  return mock ? mockAdapter : engine;
}

/**
 * The engine a run's agent nodes use (CLI --engine, the harness's `claude.engine`): a
 * real adapter by name. The mock is not one; it stands in for Claude under --mock /
 * WORCA_MOCK only. Throws on an unknown name or 'mock'.
 * @returns {string} the adapter's name
 */
export function selectRunEngine(name = 'claude') {
  const engine = getEngine(name);
  if (engine.name === 'mock') {
    throw new Error(`"mock" is not a run engine (choose one of: ${[...ENGINES.keys()].filter((k) => k !== 'mock').join(', ')}); the offline mock runs under --mock`);
  }
  return engine.name;
}

export function listEngines() {
  return [...ENGINES.values()];
}

// ── the engine gate's one reading of the catalog (plans/core-protection-layer-design.md §4.4) ─────

// Rule kinds that name a path: on an engine with a shell they bind its own tools only (decision 10).
const PATH_KINDS = new Set(['Read', 'Edit', 'Write', 'Grep', 'Glob']);
const denyOf = (rules) => (Array.isArray(rules?.deny) ? rules.deny : []).map((r) => String(r).trim()).filter(Boolean);

/**
 * What `engine` makes of the deny rules in `rules`: the one function the engine gate reads. A rule's kind
 * (engine-switch.mjs ruleKind) is looked up in the engine's catalog `rules`; the adapter's own rule plan
 * (`unenforcedRules`/`partialRules`) can only lower that, never raise it.
 *   refused     the rules it cannot hold: a kind that is 'unenforced', 'unverified' or not listed (decision 9), one
 *               the adapter cannot translate, and every rule on an engine without permission rules
 *   partial     the rules it holds only in part (refused too without --allow-unguarded-engine; the spawn applies them)
 *   shellPaths  the path rules it holds on its own tools while its shell can still reach those paths (the baseline
 *               run-log line; it never blocks)
 * @returns {{refused: string[], partial: string[], shellPaths: string[]}}
 */
export function ruleSupport(engine, rules) {
  const out = { refused: [], partial: [], shellPaths: [] };
  const deny = [...new Set(denyOf(rules))];
  if (!deny.length) return out;
  const entry = engineEntry(engine);
  const adapter = getEngine(engine);
  if (!entry || adapter.capabilities.permissionRules === false) { out.refused.push(...deny); return out; }
  const planUnenforced = new Set(typeof adapter.unenforcedRules === 'function' ? adapter.unenforcedRules(rules) : []);
  const planPartial = new Set(typeof adapter.partialRules === 'function' ? adapter.partialRules(rules) : []);
  for (const r of deny) {
    const kind = ruleKind(r);
    const level = entry.rules[kind] ?? 'unenforced';
    if (level === 'unenforced' || level === 'unverified' || planUnenforced.has(r)) { out.refused.push(r); continue; }
    if (level === 'partial' || planPartial.has(r)) out.partial.push(r);
    if (entry.shell && PATH_KINDS.has(kind) && /\(.+\)$/s.test(r)) out.shellPaths.push(r);
  }
  return out;
}

/**
 * What the core does with `engine`'s sub-agent tool (decision 11): 'allow' when the catalog proves its sub-agents
 * inherit its rules (`inheritsRules: 'yes'` with `proof`, a recorded denial from inside a sub-agent: the catalog test
 * keeps that file real, test/boundary-catalog.test.mjs) or it has no sub-agent tool; 'deny' when the adapter can
 * switch the tool off (`denySubagentTool` returns spawn options); 'refuse' when it cannot (the gate refuses without
 * --allow-unguarded-engine). `proofDir` also requires the proof file to exist there (tests; an installed worca ships
 * no fixtures).
 * @returns {'allow'|'deny'|'refuse'}
 */
export function subagentPolicy(engine, { proofDir = null } = {}) {
  const s = engineEntry(engine)?.subagents;
  if (!s || !s.tool) return 'allow';
  if (s.inheritsRules === 'yes' && s.proof && (!proofDir || existsSync(join(proofDir, s.proof)))) return 'allow';
  const deny = getEngine(engine).denySubagentTool;
  return typeof deny === 'function' && deny({}) !== null ? 'deny' : 'refuse';
}

/**
 * Archiving a run (pipeline-delete.mjs archivePipeline): every engine whose catalog keeps sessions ('managed-home',
 * 'user-store') removes the ones named by the run's session ids (`run.sessionIds`, its steps' stored ids). Never
 * throws: a removal that fails is a warning, and the archive goes on.
 * @param {{sessionIds: string[]}} run
 * @returns {Promise<{engine: string, removed: string[], warnings: string[]}[]>}
 */
export async function removeRunSessions(run) {
  const ids = [...new Set((run?.sessionIds || []).filter((x) => typeof x === 'string' && x))];
  const out = [];
  if (!ids.length) return out;
  for (const adapter of listEngines()) {
    if (adapter.name === 'mock' || typeof adapter.removeSessions !== 'function') continue;
    const sessions = engineEntry(adapter.name)?.sessions;
    if (!sessions || sessions === 'none') continue;
    try {
      const r = await adapter.removeSessions({ sessionIds: ids });
      const why = [...new Set(r.failed.map((f) => f.error))].join(', ');
      out.push({ engine: adapter.name, removed: r.removed,
        warnings: r.failed.length ? [`${adapter.name} sessions: ${r.failed.length} not removed (${why}): ${r.failed.map((f) => f.path).join(', ')}`] : [] });
    } catch (err) {
      out.push({ engine: adapter.name, removed: [], warnings: [`${adapter.name} sessions: ${err?.message || err}`] });
    }
  }
  return out;
}
