// One Ask Worca turn: spawn `claude -p` through the P1 sandbox recipe, feed
// every event to the P1 reducer, persist the assistant message, and emit bare
// ask-* frames through deps.onFrame (the SERVER stamps {threadId, messageId,
// seq} — spec §17 contract). run() NEVER throws; stop() aborts. One instance
// owns one turn INCLUDING the §6.2.7 resume retry (fresh reducer per attempt,
// one AbortController + one 30-minute wall clock spanning both attempts).
// Shape: agent-gen.mjs (EventEmitter, terminal latch, finally cleanup).
// Binding rules enforced here: R-A (settle-before-finish, persist card/notice
// mid-turn), R-C (rejection classification, abort branch FIRST — the runner
// throws a synchronous AbortError before any init when pre-aborted), R-F
// (turn.mock rides EVERY attempt), R-G (spawn wiring: scratch dir, RAW home
// base, per-message mcp json deleted in finally), R-D + B-1 (title call:
// hardened options + permissionMode 'dontAsk', no signal).
import { EventEmitter } from 'node:events';
import { join, dirname, resolve as pathResolve } from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';

import { runClaude } from '../claude-runner.mjs';
import { resolveModelEnv, resolveModelCost, estimateCost, liveCostRates as defaultLiveCostRates } from '../config.mjs';
import { worcaHome } from '../projects.mjs';
import { generateTitle } from '../title.mjs';
import { createTurnReducer } from './events.mjs';
import { buildAskSpawnOptions, buildMcpConfig, ASK_MCP_SERVER_PATH } from './spawn.mjs';
import { validateProposal } from './proposal.mjs';
import { askLimits, ASK_LIMITS } from './limits.mjs';
import {
  newAskId, finishMessage, setMessageBlocks, addThreadTotals, updateThread, setThreadTitle,
} from './store.mjs';
import { recordAskCostDelta } from '../cost-budget.mjs';
import { setPendingCardComments } from '../diff-comments.mjs';

export function createAskTurn(opts) { return new AskTurn(opts); }

const TERMINAL = new Set(['done', 'stopped', 'error']);

class AskTurn extends EventEmitter {
  constructor({
    threadId, assistantMessageId, userMessageId,
    prompt, systemPrompt, restoredPrompt = '',
    model, effort, resumeSessionId = null,
    firstTurn = false, firstText = '', deterministicTitle = null,
    mock = null, attachmentNames = {},
    pinnedScope = null,
    deps = {},
  } = {}) {
    super();
    this.threadId = threadId;
    this.assistantMessageId = assistantMessageId;
    this.userMessageId = userMessageId;
    this.prompt = prompt;
    this.systemPrompt = systemPrompt;
    this.restoredPrompt = restoredPrompt;
    this.model = model;
    this.effort = effort;
    this.resumeSessionId = resumeSessionId || null;
    this.firstTurn = !!firstTurn;
    this.firstText = firstText;
    this.deterministicTitle = deterministicTitle ?? null;
    this.mock = mock || null;
    this.attachmentNames = attachmentNames || {};
    // #397: {projectKey}|{workspaceId}|null — the user-pinned scope at POST time.
    this.pinnedScope = pinnedScope && typeof pinnedScope === 'object' ? pinnedScope : null;
    this.deps = {
      runClaudeImpl: deps.runClaudeImpl ?? runClaude,
      store: {
        finishMessage, setMessageBlocks, addThreadTotals, updateThread, setThreadTitle,
        ...(deps.store || {}),
      },
      validateProposal: deps.validateProposal ?? validateProposal,
      generateTitle: deps.generateTitle ?? generateTitle,
      askLimits: deps.askLimits ?? askLimits,
      limits: deps.limits ?? ASK_LIMITS,
      resolveModelEnv: deps.resolveModelEnv ?? resolveModelEnv,
      resolveModelCost: deps.resolveModelCost ?? resolveModelCost,
      worcaHome: deps.worcaHome ?? worcaHome,
      buildMcpConfig: deps.buildMcpConfig ?? buildMcpConfig,
      serverPath: deps.serverPath ?? ASK_MCP_SERVER_PATH,
      newAskId: deps.newAskId ?? newAskId,
      setPendingCardComments: deps.setPendingCardComments ?? setPendingCardComments,
      recordAskCost: deps.recordAskCost ?? recordAskCostDelta,
      now: deps.now ?? Date.now,
      // Default timers unref so a 30-minute clock never holds the process open
      // (orchestrator.mjs:2627 _backoff precedent). Tests inject both.
      setTimeout: deps.setTimeout ?? ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }),
      clearTimeout: deps.clearTimeout ?? ((t) => clearTimeout(t)),
      fs: deps.fs ?? { mkdir, writeFile, unlink },
      onFrame: deps.onFrame ?? (() => {}),
      onOutOfTurn: deps.onOutOfTurn ?? (() => {}),
      onCommentMutation: deps.onCommentMutation ?? (() => {}),
      onWorktreeMutation: deps.onWorktreeMutation ?? (() => {}),
      // DISPLAY-ONLY rates for the footer's live "≈" estimate (config.mjs
      // liveCostRates: override → list price → null). Injectable so tests pin
      // the frame arithmetic without the catalog.
      liveCostRates: deps.liveCostRates ?? defaultLiveCostRates,
    };
    this.abort = new AbortController();
    this.status = 'created';
    this.timedOut = false;
    this.stopping = false;
    this.reducer = null;
    this.sessionId = this.resumeSessionId;
    this.scratchDir = null;
    this.titlePromise = Promise.resolve();
    this._titleKicked = false;
    this._completed = false;
  }

  stop() {
    if (TERMINAL.has(this.status)) return;
    this.stopping = true;
    try { this.abort.abort(); } catch { /* ignore */ }
  }

  _frame(frame) {
    try { this.deps.onFrame(frame); } catch { /* a broken sink must not break the turn */ }
  }

  _emit(event, payload) {
    // EventEmitter special-cases 'error': emitting it with ZERO listeners throws
    // ERR_UNHANDLED_ERROR, and a listener that throws escapes too — either would
    // break the "run() NEVER throws" contract P3 builds on. Both terminal emits
    // go through here; same swallow posture as _frame.
    if (event === 'error' && this.listenerCount('error') === 0) return;
    try { this.emit(event, payload); } catch { /* a broken listener must not break the turn */ }
  }

  _persistBlocks() {
    // R-A: the card (and every mid-turn notice) must survive a server restart
    // and be visible to findCard/updateCardBlock while the turn streams.
    try { this.deps.store.setMessageBlocks(this.assistantMessageId, this.reducer.snapshot().blocks); }
    catch { /* thread may be gone — the terminal write is equally guarded */ }
  }

  async _onProposal(input) {
    const d = this.deps;
    const cardId = d.newAskId('card');
    const raw = input && typeof input === 'object' ? input : {};
    // #397: a proposal that names NO target falls back to the user-pinned scope.
    // Mirrors the MCP child's own defaulting, so this authoritative re-validation
    // builds the same card the model was shown.
    const pin = this.pinnedScope;
    const hasTarget = (typeof raw.projectKey === 'string' && raw.projectKey.trim())
      || (typeof raw.workspaceId === 'string' && raw.workspaceId.trim());
    const inp = pin && !hasTarget ? { ...raw, ...pin } : raw;
    try {
      const r = await d.validateProposal(inp, { cardId });
      if (r && r.ok) {
        // #397 guardrail: a proposal targeting a DIFFERENT project/workspace than
        // the pinned one is accepted but flagged — the card renders the mismatch
        // instead of silently absorbing it.
        const scopeMismatch = !!pin && ((pin.projectKey && r.card.projectKey !== pin.projectKey)
          || (pin.workspaceId && r.card.workspaceId !== pin.workspaceId));
        this.reducer.addBlock({ kind: 'card', id: cardId, state: 'proposed', card: r.card, ...(scopeMismatch ? { scopeMismatch: true } : {}) });
        // commentIds are propose_run INPUT only: they never enter the card block (its
        // key set is pinned in test/ask-proposal.test.mjs) nor CARD_PATCH_KEYS. Parked
        // against the card id until the user starts the run; unknown ids are dropped,
        // because the model may cite a comment the user has since deleted and that
        // must not sink an otherwise valid proposal.
        try { d.setPendingCardComments(cardId, input?.commentIds); }
        catch { /* comment metadata is never worth failing a proposal for */ }
      } else {
        const errors = (r && Array.isArray(r.errors) && r.errors.length) ? r.errors : ['invalid proposal'];
        this.reducer.addBlock({ kind: 'notice', text: `Proposal rejected: ${errors.join('; ')}` });
      }
    } catch (err) {
      this.reducer.addBlock({ kind: 'notice', text: `Proposal rejected: ${err?.message || err}` });
    }
    this._persistBlocks();
  }

  _makeReducer() {
    const d = this.deps;
    // One settings read per attempt, never per frame. null → the frames carry
    // estimatedCostUsd:null and the footer keeps today's behaviour.
    let liveRates = null;
    try { liveRates = d.liveCostRates(this.model) ?? null; } catch { liveRates = null; }
    this.reducer = createTurnReducer({
      onFrame: (f) => this._frame(f),
      now: d.now,
      setTimeout: d.setTimeout,
      clearTimeout: d.clearTimeout,
      attachmentNames: this.attachmentNames,
      // Ask spend feeds the SAME windowed budget as pipeline spend
      // (cost-budget.mjs combinedWindowedSpendUsd), so an on-prem model the CLI
      // prices by name inflates it from here too — re-price the turn exactly as
      // the orchestrator's result intake does. Trusts the CLI when the model
      // carries no override, which is the default.
      resolveCost: (cliCostUsd, usage) => d.resolveModelCost(this.model, cliCostUsd, usage),
      limits: d.limits,
      onProposal: ({ input }) => this._onProposal(input),
      // The MCP child cannot broadcast; the parent turns its comment writes into
      // the same poke the REST routes emit.
      onCommentMutation: (e) => { try { this.deps.onCommentMutation(e); } catch { /* a broken sink never breaks the turn */ } },
      // Same shape for worktrees: open/remove/navigate in the child → the server
      // broadcasts the thread's worktree envelope (ui/server.mjs emitAskWorktrees).
      onWorktreeMutation: (e) => { try { this.deps.onWorktreeMutation(e); } catch { /* a broken sink never breaks the turn */ } },
      // DISPLAY ONLY — never a sink input: prices the running usage sum (main +
      // sub-agent tokens) at the TURN model's rates; the "≈" in the footer owns
      // that approximation. _complete() reads summary.costUsd, not this.
      estimateLiveCost: liveRates ? (usage) => estimateCost(usage, liveRates) : null,
    });
    return this.reducer;
  }

  async _settle() {
    // R-A verbatim: settle() has no timeout of its own — race it against the
    // turn's abort so a hung proposal hook cannot wedge the terminal write.
    const aborted = new Promise((res) => {
      if (this.abort.signal.aborted) return res();
      this.abort.signal.addEventListener('abort', () => res(), { once: true });
    });
    await Promise.race([this.reducer.settle(), aborted]);
  }

  /**
   * The single terminal writer — called exactly once per run().
   * kind 'done'  → ask-done{status:'done'|'stopped', reason?}
   * kind 'error' → ask-error{message, errorClass?} with message status 'error'.
   * The §6.2.8 costUsd:null rule needs no plumbing here: the P1 reducer sets
   * lastResult and sawResult together (events.mjs currentCost() reads lastResult,
   * set only by a `result` frame), so summary.costUsd is ALREADY null whenever no
   * `result` arrived — source-verified. P1's ask-events tests pin only the
   * per-frame ask-usage costUsd:null (:51); the R-C stop test in THIS file is
   * the end-to-end pin of the summary rule.
   */
  async _complete({ kind, status, reason = null, message = null, errorClass = undefined }) {
    if (this._completed) return { status: this.status };
    this._completed = true;
    const d = this.deps;
    await this._settle();
    const summary = this.reducer.finish();
    const finalStatus = kind === 'error' ? 'error' : status;
    // Already AUTHORITATIVE: the reducer applied this turn's per-model cost
    // override (the `resolveCost` hook in _makeReducer), so this one value is
    // correct for all four sinks below — the message row, the thread totals, the
    // budget ledger, and the ask-done frame.
    const costUsd = summary.costUsd;
    // Persist BEFORE broadcasting: a client re-fetch on the terminal frame must
    // never see a still-streaming row. finishMessage gets the FULL patch (B-5).
    try {
      d.store.finishMessage(this.assistantMessageId, {
        text: summary.text, blocks: summary.blocks, status: finalStatus, reason,
        usage: summary.usage, costUsd, durationMs: summary.durationMs,
      });
    } catch { /* deleted thread — the frames still settle the UI */ }
    let threadTotals = null;
    try {
      threadTotals = d.store.addThreadTotals(this.threadId, {
        costUsd, usage: summary.usage, agents: summary.agents,
      });
    } catch { /* deleted thread */ }
    // D10: the spend is a financial fact even when the thread was deleted
    // mid-turn — sits OUTSIDE the store try/catches above so it is never
    // skipped; best-effort so a DB hiccup still settles the frames. Written
    // after finishMessage: a process death between the two loses only this
    // row (accepted — the v20 backfill never re-runs). Runs on done, stopped
    // AND error turns alike: a result frame means money was spent.
    try {
      d.recordAskCost({
        threadId: this.threadId, messageId: this.assistantMessageId,
        amountUsd: costUsd,                    // null → the writer no-ops (D2)
        tokens: ['input', 'output', 'cacheRead', 'cacheCreation']
          .reduce((a, k) => a + (Number(summary.usage?.[k]) || 0), 0),
        model: this.model, tsMs: d.now(),
      });
    } catch { /* ledger append is best-effort */ }
    this.status = finalStatus;
    if (summary.reducerErrors) {
      console.warn(`[worca-ask] turn ${this.assistantMessageId}: ${summary.reducerErrors} reducer error(s) absorbed`);
    }
    if (kind === 'error') {
      this._frame({ type: 'ask-error', message: message || 'unknown error', ...(errorClass !== undefined ? { errorClass } : {}) });
      this._emit('error', { message: message || 'unknown error' });
    } else {
      this._frame({
        type: 'ask-done', text: summary.text, blocks: summary.blocks, usage: summary.usage,
        costUsd, durationMs: summary.durationMs, model: this.model, status: finalStatus,
        ...(reason ? { reason } : {}), threadTotals,
      });
      this._emit('done', { status: finalStatus, reason });
    }
    return { status: finalStatus };
  }

  _limitNotice(reason, limitsNow) {
    const text = reason === 'max_budget'
      ? `Stopped: reached the $${limitsNow.maxBudgetUsd} per-turn cap (Settings → Ask Worca)`
      : `Stopped: reached the ${limitsNow.maxTurns}-turn limit (Settings → Ask Worca)`;
    this.reducer.addBlock({ kind: 'notice', text });
    this._persistBlocks();
  }

  async run() {
    if (this.status !== 'created') return { status: this.status };
    this.status = 'running';
    const d = this.deps;
    this._makeReducer();
    this._frame({
      type: 'ask-start', userMessageId: this.userMessageId,
      model: this.model, effort: this.effort, startedAt: new Date(d.now()).toISOString(),
    });
    let timer = null;
    let mcpConfigPath = null;
    let out;
    try {
      // R-G: ONE scratch dir for all threads, RAW home base (never worcaHome()
      // itself — it already ends in /.worca-cc), per-message config json.
      const scratchDir = join(d.worcaHome(), 'tmp', 'ask');
      this.scratchDir = scratchDir;
      await d.fs.mkdir(scratchDir, { recursive: true });
      // D13 title runs CONCURRENTLY with the turn from here — the haiku call
      // cwd's into scratchDir, so not a line earlier. Idempotent: the call after
      // _attempts below is the backstop for a mkdir/write failure, so "fires
      // after ANY terminal status of the first turn" stays true.
      this._kickoffTitle();
      const homeBase = process.env.WORCA_HOME?.trim()
        ? pathResolve(process.env.WORCA_HOME)
        : dirname(d.worcaHome());
      mcpConfigPath = join(scratchDir, `mcp-${this.assistantMessageId}.json`);
      await d.fs.writeFile(
        mcpConfigPath,
        JSON.stringify(d.buildMcpConfig({ homeBase, threadId: this.threadId, serverPath: d.serverPath }), null, 2),
        'utf8',
      );
      // One 30-minute budget for the whole turn, retry included. The timedOut
      // flag and abort() run in ONE synchronous callback, so R-C always reads
      // the flag set (the awaiting continuation resumes a microtask later);
      // flag-first is kept as defensive style (plugin-shim.mjs:164 precedent).
      timer = d.setTimeout(() => { this.timedOut = true; try { this.abort.abort(); } catch { /* ignore */ } }, d.limits.turnTimeoutMs);
      const limitsNow = d.askLimits(); // D12: read fresh every turn
      out = await this._attempts(limitsNow, mcpConfigPath, scratchDir);
    } catch (err) {
      // Backstop for a deps failure (mkdir/write) — _attempts itself never throws.
      out = await this._complete({ kind: 'error', message: err?.message || String(err) });
    } finally {
      if (timer != null) d.clearTimeout(timer);
      if (mcpConfigPath) await d.fs.unlink(mcpConfigPath).catch(() => {});
    }
    this._kickoffTitle();
    return out;
  }

  async _attempts(limitsNow, mcpConfigPath, scratchDir) {
    const d = this.deps;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const isRetry = attempt === 2;
      if (isRetry) {
        this._makeReducer(); // fresh reducer; the dead attempt's reducer is discarded unfinished
        // Deliberate deviation from §6.2.7's ordering (which posts the notice
        // after a successful restore): the notice is added EAGERLY so it is
        // visible while the retry streams (R-A persistence below). If the retry
        // then fails, the notice stays above the ask-error — acceptable, and
        // recorded in the Clarifications Q&A.
        this.reducer.addBlock({ kind: 'notice', text: 'Context restored from history' });
        this._persistBlocks();
      }
      const options = buildAskSpawnOptions({
        thread: { id: this.threadId, sessionId: isRetry ? null : this.resumeSessionId }, // B-7: the only no-resume lever
        turn: {
          prompt: isRetry ? this.restoredPrompt : this.prompt,
          systemPrompt: this.systemPrompt,
          model: this.model,
          effort: this.effort,
          modelEnv: d.resolveModelEnv(this.model),
          mock: this.mock, // R-F: markers on EVERY attempt
          signal: this.abort.signal,
          onEvent: (e) => {
            if (e && e.type === 'session' && typeof e.sessionId === 'string' && e.sessionId) {
              // §6.2.4: stored on the thread immediately, not at turn end.
              this.sessionId = e.sessionId;
              try { d.store.updateThread(this.threadId, { sessionId: e.sessionId }); } catch { /* deleted thread */ }
            }
            this.reducer.push(e);
          },
        },
        limits: limitsNow,
        mcpConfigPath,
        scratchDir,
      });
      try {
        await d.runClaudeImpl(options);
        // Resolve path. Future-proofing: if a later CLI exits 0 on a limit,
        // the reducer still computed status/reason from the result subtype.
        await this._settle();
        const s = this.reducer.snapshot();
        if (/max_turns|max_budget/.test(s.resultSubtype ?? '')) this._limitNotice(s.reason, limitsNow);
        return await this._complete({ kind: 'done', status: s.reason ? 'stopped' : 'done', reason: s.reason ?? null });
      } catch (err) {
        const s = this.reducer.snapshot();
        // R-C, literal order. (1) The abort branch FIRST — B-4: a pre-aborted
        // runClaude throws before any init, so this must precede the resume test.
        if (err?.name === 'AbortError') {
          // costUsd falls out of the reducer: no `result` seen ⇒ summary.costUsd
          // is null (spec §6.2.8); a result that DID land before the abort keeps
          // its real cost.
          if (this.timedOut) {
            return await this._complete({ kind: 'error', message: 'timed out after 30 min' });
          }
          return await this._complete({ kind: 'done', status: 'stopped', reason: 'user' });
        }
        // (2) The per-turn limits — F5: exit 1, classify from the reducer.
        if (/max_turns|max_budget/.test(s.resultSubtype ?? '')) {
          this._limitNotice(s.reason, limitsNow);
          return await this._complete({ kind: 'done', status: 'stopped', reason: s.reason });
        }
        // (3) The narrow resume-fallback predicate (F9): only a session that
        // never produced an init or said "No conversation found".
        if (!isRetry && this.resumeSessionId
          && (!s.sawInit || s.errors.some((m) => /No conversation found/.test(m)))) {
          continue;
        }
        // (4) Everything else is a turn failure.
        if (isRetry) {
          try { d.store.updateThread(this.threadId, { sessionId: null }); } catch { /* deleted */ }
        }
        return await this._complete({
          kind: 'error',
          message: err?.message || String(err),
          errorClass: err?.errorClass ?? undefined,
        });
      }
    }
    /* c8 ignore next */
    return { status: this.status };
  }

  _kickoffTitle() {
    if (!this.firstTurn || this._titleKicked) return;
    this._titleKicked = true;
    const d = this.deps;
    // Fire-and-forget: kicked off at the START of the first turn (right after
    // the scratch dir exists) and backstopped after its terminal status (§7.4).
    // Stored for test determinism, never awaited by run() (orchestrator.mjs:3821).
    // NO signal: a user stop aborts this.abort mid-turn and would kill the call
    // before it spawns. permissionMode 'dontAsk' is the B-1 fix.
    this.titlePromise = Promise.resolve()
      .then(() => d.generateTitle(this.firstText, {
        cwd: this.scratchDir || join(d.worcaHome(), 'tmp', 'ask'),
        tools: [], strictMcpConfig: true, settingSources: ['project'],
        disableSlashCommands: true, envScrub: true, envAllowlist: [],
        permissionMode: 'dontAsk',
      }))
      .then((generated) => {
        // The route stamps NOTHING before the 202 (the header reads "Ask Worca"
        // until this frame lands), so an empty result — generateTitle swallows
        // every failure/abort/refusal into '' — falls back to the route's
        // deterministicTitle (sanitized first 80 chars, or "New chat"). That is
        // the ONLY moment the prompt text may become the title.
        const title = generated || this.deterministicTitle;
        if (!title) return;
        // `onlyIf: null` (title IS NULL) is the rename guard: a PATCHed or
        // deleted thread makes the UPDATE match 0 rows and the frame is suppressed.
        let applied = false;
        try { applied = d.store.setThreadTitle(this.threadId, title, { onlyIf: null }); }
        catch { /* deleted thread */ }
        if (applied) {
          try { d.onOutOfTurn({ type: 'ask-title', title }); } catch { /* sink */ }
        }
      })
      .catch(() => { /* generateTitle already swallows; final backstop */ });
  }
}
