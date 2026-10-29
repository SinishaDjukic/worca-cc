// src/core/engines/index.mjs
// The engine registry: the only way to get a runner. An unknown name is a hard
// error at run start, never a silent fallback; mock mode (WORCA_MOCK or
// opts.mock) resolves every known engine to the offline mock. An adapter is
// {name, capabilities, run, classifyError[, preflight, unenforcedRules, partialRules,
// ruleReach, ruleKind, unattachableMcp, chat]}: see the codex, copilot, cursor, gemini, goose, opencode and qwen entries below.
import { runClaudeAdapter, claudeCapabilities } from './claude.mjs';
import { runMock } from './mock.mjs';
import { normalizingOnEvent } from './claude-events.mjs';
import { classifyError } from '../recoverable-error.mjs';
import { runCodexProcess, codexCapabilities, classifyCodexError, codexPreflight, unenforcedRules, partialRules, codexMcpProblems, CODEX_COMMAND_RULE_REACH, codexChat } from './codex.mjs';
import * as copilot from './copilot.mjs';
import { runCursorProcess, cursorCapabilities, classifyCursorError, cursorPreflight,
  unenforcedRules as cursorUnenforced, partialRules as cursorPartial, CURSOR_RULE_TERMS, cursorChat } from './cursor.mjs';
import * as gemini from './gemini.mjs';
import * as goose from './goose.mjs';
import * as opencode from './opencode.mjs';
import * as qwen from './qwen.mjs';

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

const claudeAdapter = Object.freeze({ name: 'claude', capabilities: claudeCapabilities, run: runClaudeEngine, classifyError });
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
  unenforcedRules, partialRules, ruleReach: CODEX_COMMAND_RULE_REACH, ruleKind: 'command rules', unattachableMcp: codexMcpProblems, chat: codexChat });
// The GitHub Copilot CLI (engines/copilot.mjs): emits the normalized vocabulary itself, like codex.
const copilotAdapter = Object.freeze({ name: 'copilot', capabilities: copilot.copilotCapabilities, run: copilot.runCopilotProcess,
  classifyError: copilot.classifyCopilotError, preflight: copilot.copilotPreflight, unenforcedRules: copilot.unenforcedRules,
  partialRules: copilot.partialRules, ruleReach: copilot.COPILOT_COMMAND_RULE_REACH, ruleKind: 'command and write rules',
  unattachableMcp: copilot.copilotMcpProblems, chat: copilot.copilotChat });
// cursor emits the normalized vocabulary itself (engines/cursor.mjs). Every rule it is given is partial (cursorRulePlan).
const cursorAdapter = Object.freeze({ name: 'cursor', capabilities: cursorCapabilities, run: runCursorProcess, classifyError: classifyCursorError,
  preflight: cursorPreflight, unenforcedRules: cursorUnenforced, partialRules: cursorPartial,
  ruleReach: CURSOR_RULE_TERMS.reach, ruleKind: CURSOR_RULE_TERMS.kind, chat: cursorChat });
// Gemini CLI and Qwen Code (engines/gemini.mjs, engines/qwen.mjs on the shared engines/gemini-family.mjs runner):
// emit the normalized vocabulary themselves; command rules (and Gemini's path rules) are partial.
const geminiAdapter = Object.freeze({ name: 'gemini', capabilities: gemini.geminiCapabilities, run: gemini.runGeminiProcess,
  classifyError: gemini.classifyGeminiError, preflight: gemini.geminiPreflight, unenforcedRules: gemini.unenforcedRules,
  partialRules: gemini.partialRules, ruleReach: gemini.GEMINI_RULE_TERMS.reach, ruleKind: gemini.GEMINI_RULE_TERMS.kind, chat: gemini.geminiChat });
// Goose (engines/goose.mjs) emits the normalized vocabulary itself. It holds no permission rule (capability false).
const gooseAdapter = Object.freeze({ name: 'goose', capabilities: goose.gooseCapabilities, run: goose.runGooseProcess,
  classifyError: goose.classifyGooseError, preflight: goose.goosePreflight, unattachableMcp: goose.gooseMcpProblems, chat: goose.gooseChat });
// OpenCode (engines/opencode.mjs) emits the normalized vocabulary itself; its rules ride OPENCODE_CONFIG_CONTENT.
const opencodeAdapter = Object.freeze({ name: 'opencode', capabilities: opencode.opencodeCapabilities, run: opencode.runOpencodeProcess,
  classifyError: opencode.classifyOpencodeError, preflight: opencode.opencodePreflight, unenforcedRules: opencode.unenforcedRules,
  partialRules: opencode.partialRules, ruleReach: opencode.OPENCODE_RULE_TERMS.reach, ruleKind: opencode.OPENCODE_RULE_TERMS.kind, chat: opencode.opencodeChat });
const qwenAdapter = Object.freeze({ name: 'qwen', capabilities: qwen.qwenCapabilities, run: qwen.runQwenProcess,
  classifyError: qwen.classifyQwenError, preflight: qwen.qwenPreflight, unenforcedRules: qwen.unenforcedRules,
  partialRules: qwen.partialRules, ruleReach: qwen.QWEN_RULE_TERMS.reach, ruleKind: qwen.QWEN_RULE_TERMS.kind, chat: qwen.qwenChat });
// The mock stands in for Claude in tests and smokes, so it declares Claude's map.
const mockAdapter = Object.freeze({ name: 'mock', capabilities: claudeCapabilities, run: normalized(runMock), classifyError });

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
