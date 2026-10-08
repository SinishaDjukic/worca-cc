// src/core/engines/index.mjs
// The engine registry: the only way to get a runner. An unknown name is a hard
// error at run start, never a silent fallback; mock mode (WORCA_MOCK or
// opts.mock) resolves every known engine to the offline mock.
import { runClaudeAdapter, claudeCapabilities } from './claude.mjs';
import { runMock } from './mock.mjs';
import { normalizingOnEvent } from './claude-events.mjs';
import { classifyError } from '../recoverable-error.mjs';
import { runCodexProcess, codexCapabilities, classifyCodexError, codexPreflight, unenforcedRules, partialRules, codexUnattachableMcp, CODEX_COMMAND_RULE_REACH } from './codex.mjs';
import * as copilot from './copilot.mjs';

export { CAPABILITY_KEYS, CAPABILITY_FALLBACKS } from './capabilities.mjs';

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
// unless allowed too, and the spawn still applies them; `ruleReach` says in words how far those rules reach.
// `unattachableMcp(servers)`: the --mcp-config servers this engine cannot attach (the run gate refuses a registry copy
// among them). An engine without it attaches what Claude Code does.
const codexAdapter = Object.freeze({ name: 'codex', capabilities: codexCapabilities, run: runCodexProcess, classifyError: classifyCodexError, preflight: codexPreflight,
  unenforcedRules, partialRules, ruleReach: CODEX_COMMAND_RULE_REACH, unattachableMcp: codexUnattachableMcp });
// The GitHub Copilot CLI (engines/copilot.mjs): emits the normalized vocabulary itself, like codex.
const copilotAdapter = Object.freeze({ name: 'copilot', capabilities: copilot.copilotCapabilities, run: copilot.runCopilotProcess,
  classifyError: copilot.classifyCopilotError, preflight: copilot.copilotPreflight, unenforcedRules: copilot.unenforcedRules,
  partialRules: copilot.partialRules, ruleReach: copilot.COPILOT_COMMAND_RULE_REACH, unattachableMcp: copilot.copilotUnattachableMcp });
// The mock stands in for Claude in tests and smokes, so it declares Claude's map.
const mockAdapter = Object.freeze({ name: 'mock', capabilities: claudeCapabilities, run: normalized(runMock), classifyError });

const ENGINES = new Map([
  ['claude', claudeAdapter],
  ['codex', codexAdapter],
  ['copilot', copilotAdapter],
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
