// src/core/helper-call/index.mjs — the one-off model call of Requirements on any harness (plans/requirements-9c-design.md §4, D12, D13, D15, D16).
// Claude: the caller's interviewCallOptions go to the runner unchanged. Other harnesses: gated, launched from a profile, cost read from the result.
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { runClaude, mockEnabled } from '../claude-runner.mjs';
import { normalizingOnEvent } from '../engines/claude-events.mjs';
import { chatDescriptor, chatEngineGate } from '../engines/chat.mjs';
import { writeFilesMcpConfig as realWriteFilesMcpConfig } from '../engines/codex-files-mcp.mjs';
import { codexThreadOf, removeCodexThread as realRemoveCodexThread } from '../engines/codex.mjs';
import { withRecoveryRetry } from '../recovery-backoff.mjs';
import { engineLabel } from '../../shared/engine-switch.mjs';
import { worcaHome } from '../projects.mjs';
import { ratesFor as realRatesFor, costOfResult as realCostOfResult, addCost } from './cost.mjs';
import { requirementsEngines, capabilities, launchOptions, stepNotices, notReadyWords } from './profiles.mjs';

/** A helper call that did not produce text. `code`: NOT_READY | NOT_OFFERED | TIMEOUT | the runner's own; `costUsd`/`costKind` are what it spent. */
export class HelperCallError extends Error {
  constructor(message, { code, docsUrl = null, costUsd = 0, costKind = null, cause } = {}) {
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
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) throw new TypeError('helperCall: timeoutMs must be a positive number');
  const run = deps.run || runClaude;
  const gate = deps.gate || chatEngineGate;
  const mock = deps.mock || (() => mockEnabled({}));
  const removeThread = deps.removeCodexThread || realRemoveCodexThread;

  let options;
  let mcpConfigPath = null;
  if (engine === 'claude') {
    if (!claudeOptions) throw new TypeError('helperCall: Claude calls need claudeOptions');
    options = claudeOptions;
  } else {
    const descriptor = engine === 'cursor' ? null : chatDescriptor(engine);
    if (!descriptor || !(deps.engines || requirementsEngines()).includes(engine)) {
      throw new HelperCallError(`${engineLabel(engine)} can't run Requirements. Change the model.`, { code: 'NOT_OFFERED' });
    }
    const refusal = await gate(descriptor, { model, mock: mock() });
    if (refusal) {
      throw new HelperCallError(notReadyWords(engine, refusal.message).sentence, { code: 'NOT_READY', docsUrl: descriptor.notReady?.docsUrl ?? null });
    }
    if (profile === 'repo' && !capabilities(engine).repo) throw new TypeError(`helperCall: ${engine} cannot read the repo`);
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

  let cost = null;
  let inputTokens = null;
  let outputTokens = null;
  const threads = new Set();
  const events = [];
  const onEvent = normalizingOnEvent((e) => {
    events.push(e);
    if (e.type === 'result') {
      const r = costOf({ engine, model, event: e, rates });
      cost = cost ? addCost(cost, r) : { costUsd: r.costUsd, costKind: r.costKind };
      if (r.inputTokens != null) inputTokens = (inputTokens ?? 0) + r.inputTokens;
      if (r.outputTokens != null) outputTokens = (outputTokens ?? 0) + r.outputTokens;
    } else if (e.type === 'session' && engine === 'codex') {
      const t = codexThreadOf(e.sessionId);
      if (t) threads.add(t);
    }
  });

  // Success or failure: a Codex step leaves no session file behind (D12). `kept` is true when one could not be removed.
  const dropSessions = () => { let kept = false; for (const t of threads) if (removeThread(t) !== true) kept = true; return kept; };
  const spent = () => cost || { costUsd: 0, costKind: 'unknown' };
  const noticesFor = (kept) => {
    const notices = stepNotices({ engine, profile, files, estimated: spent().costKind === 'estimated' });
    if (kept && !notices.includes(CODEX_KEEPS_COPY)) notices.splice(spent().costKind === 'estimated' ? notices.length - 1 : notices.length, 0, CODEX_KEEPS_COPY);
    return notices;
  };
  try {
    // Per attempt: a retried call's events (and the guard decisions beside them) are the last attempt's; cost and Codex threads accumulate.
    const res = await withRecoveryRetry(() => { events.length = 0; return run({ ...options, signal: ctrl.signal, onEvent }); },
      { classes: ['rate_limit'], signal: ctrl.signal, ...(deps.retryEnv ? { env: deps.retryEnv } : {}) });
    const notices = noticesFor(dropSessions());
    return {
      text: res?.text || '', engine, model, costUsd: spent().costUsd, costKind: spent().costKind, inputTokens, outputTokens, notices, events,
      ...(Array.isArray(res?.readGuardDecisions) ? { readGuardDecisions: res.readGuardDecisions } : {}),
    };
  } catch (err) {
    const notices = noticesFor(dropSessions());
    const base = err instanceof Error ? err : new Error(String(err));
    const out = timedOut
      ? new HelperCallError(`Worca got no reply within ${Math.round(timeoutMs / 1000)} seconds. Try again.`, { code: 'TIMEOUT', cause: base })
      : base;
    out.costUsd = spent().costUsd;
    out.costKind = spent().costKind;
    out.notices = notices;
    throw out;
  } finally {
    clearTimeout(timer);
    if (mcpConfigPath) try { rmSync(mcpConfigPath, { force: true }); } catch { /* scratch file */ }
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
