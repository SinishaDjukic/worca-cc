// src/core/helper-call/index.mjs — the one-off model call of Requirements on any harness (plans/requirements-9c-design.md §4, D12, D13, D15, D16).
// Claude: the caller's interviewCallOptions go to the runner unchanged. Other harnesses: gated, launched from a profile, cost read from the result.
import { join } from 'node:path';
import { runClaude, mockEnabled } from '../claude-runner.mjs';
import { normalizingOnEvent } from '../engines/claude-events.mjs';
import { chatDescriptor, chatEngineGate } from '../engines/chat.mjs';
import { writeFilesMcpConfig as realWriteFilesMcpConfig } from '../engines/codex-files-mcp.mjs';
import { CODEX_SESSION_PREFIX, removeCodexThread as realRemoveCodexThread } from '../engines/codex.mjs';
import { withRecoveryRetry } from '../recovery-backoff.mjs';
import { worcaHome } from '../projects.mjs';
import { ratesFor as realRatesFor, costOfResult as realCostOfResult, addCost } from './cost.mjs';
import { requirementsEngines, launchOptions, stepNotices, notReadyWords } from './profiles.mjs';

/** A helper call that did not produce text. `code`: NOT_READY | NOT_OFFERED | TIMEOUT | the runner's own; `costUsd`/`costKind` are what it spent. */
export class HelperCallError extends Error {
  constructor(message, { code, docsUrl = null, costUsd = 0, costKind = 'unknown', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'HelperCallError';
    this.code = code;
    this.docsUrl = docsUrl;
    this.costUsd = costUsd;
    this.costKind = costKind;
  }
}

const defaultScratch = () => join(worcaHome(), 'tmp', 'requirements');
const CODEX_KEEPS_COPY = 'Codex keeps its own copy of this step in its history on this computer.';

/**
 * One helper call. `claudeOptions` (interviewCallOptions) is required for engine 'claude'.
 * @returns {Promise<{text:string, engine:string, model:string, costUsd:number, costKind:string, inputTokens:number|null, outputTokens:number|null, notices:string[], events:object[], readGuardDecisions?:object[]}>}
 */
export async function helperCall(args, deps = {}) {
  const { model, effort, profile, cwd, systemPrompt, prompt, timeoutMs, signal = null, claudeOptions = null, files = [], roots = null, maxTurns = null } = args;
  const engine = args.engine || 'claude';
  const run = deps.run || runClaude;
  const gate = deps.gate || chatEngineGate;
  const mock = deps.mock || (() => mockEnabled({}));
  const removeThread = deps.removeCodexThread || realRemoveCodexThread;

  let options;
  if (engine === 'claude') {
    if (!claudeOptions) throw new TypeError('helperCall: Claude calls need claudeOptions');
    options = claudeOptions;
  } else {
    const descriptor = engine === 'cursor' ? null : chatDescriptor(engine);
    if (!descriptor || !(deps.engines || requirementsEngines()).includes(engine)) {
      throw new HelperCallError(`${engine} can't run Requirements. Change the model.`, { code: 'NOT_OFFERED' });
    }
    const refusal = await gate(descriptor, { model, mock: mock() });
    if (refusal) {
      throw new HelperCallError(notReadyWords(engine, refusal.message).sentence, { code: 'NOT_READY', docsUrl: descriptor.notReady?.docsUrl ?? null });
    }
    let mcpConfigPath;
    if (profile === 'repo') {
      const write = deps.writeFilesMcpConfig || realWriteFilesMcpConfig;
      const scratch = typeof deps.scratch === 'function' ? deps.scratch() : (deps.scratch || defaultScratch());
      mcpConfigPath = write({ dir: join(scratch, 'files-mcp'), roots: roots || [cwd], name: 'requirements' });
    }
    options = launchOptions({ engine, profile, cwd, systemPrompt, prompt, model, effort, mcpConfigPath, maxTurns });
  }

  const rates = (deps.ratesFor || realRatesFor)(engine, model);
  const costOf = deps.costOfResult || realCostOfResult;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);

  let cost = { costUsd: 0, costKind: 'unknown' };
  let inputTokens = null;
  let outputTokens = null;
  let thread = null;
  const events = [];
  const onEvent = normalizingOnEvent((e) => {
    events.push(e);
    if (e.type === 'result') {
      const r = costOf({ engine, model, event: e, rates });
      cost = addCost(cost, r);
      if (r.inputTokens != null) inputTokens = (inputTokens ?? 0) + r.inputTokens;
      if (r.outputTokens != null) outputTokens = (outputTokens ?? 0) + r.outputTokens;
    } else if (e.type === 'session' && engine === 'codex' && typeof e.sessionId === 'string' && e.sessionId.startsWith(CODEX_SESSION_PREFIX)) {
      thread = e.sessionId.slice(CODEX_SESSION_PREFIX.length) || thread;
    }
  });

  // Success or failure: a Codex step leaves no session file behind (D12). `kept` is true when one could not be removed.
  const dropSession = () => (engine === 'codex' && thread ? removeThread(thread) !== true : false);
  try {
    const res = await withRecoveryRetry(() => run({ ...options, signal: ctrl.signal, onEvent }),
      { classes: ['rate_limit'], signal: ctrl.signal, ...(deps.retryEnv ? { env: deps.retryEnv } : {}) });
    const kept = dropSession();
    const notices = stepNotices({ engine, profile, files, estimated: cost.costKind === 'estimated' });
    if (kept) notices.splice(cost.costKind === 'estimated' ? notices.length - 1 : notices.length, 0, CODEX_KEEPS_COPY);
    return {
      text: res?.text || '', engine, model, costUsd: cost.costUsd, costKind: cost.costKind, inputTokens, outputTokens, notices, events,
      ...(Array.isArray(res?.readGuardDecisions) ? { readGuardDecisions: res.readGuardDecisions } : {}),
    };
  } catch (err) {
    dropSession();
    const base = err instanceof Error ? err : new Error(String(err));
    const out = timedOut
      ? new HelperCallError(`Worca got no reply within ${Math.round(timeoutMs / 1000)} seconds. Try again.`, { code: 'TIMEOUT', cause: base })
      : base;
    out.costUsd = cost.costUsd;
    out.costKind = cost.costKind;
    throw out;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
