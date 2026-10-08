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
import { mkdir, writeFile, unlink, rm, readdir, lstat } from 'node:fs/promises';

import { runClaude } from '../claude-runner.mjs';
import { CLAUDE_SIGNED_OUT_CODE } from '../preflight.mjs';
import { failedBecauseSignedOut } from '../claude-auth.mjs';
import { resolveModelEnv, resolveModelCost, estimateCost, liveCostRates as defaultLiveCostRates } from '../config.mjs';
import { worcaHome } from '../projects.mjs';
import { generateTitle } from '../title.mjs';
import { cleanText } from '../../shared/graph/assemble.mjs';
import { MCP_TOOL_NAME_400_RE, MCP_TOOL_NAME_TOO_LONG } from '../../shared/mcp-tool-name.mjs';
import { createRedactor } from '../redact.mjs';
import { redactAskText } from './redact.mjs';
import { createTurnReducer } from './events.mjs';
import { buildAskSpawnOptions, buildMcpConfig, ASK_MCP_SERVER_PATH } from './spawn.mjs';
import { refreshAskMemoryMount } from './memory-deps.mjs';
import { materializeSkillMount } from '../skills-registry/mount.mjs';
import { SIDELOAD_REFUSAL_RE as SIDELOAD_REFUSED_RE } from '../skills-registry/host.mjs';
import { renderSkillsSection, renderCodexSkillsSection, codexSkillNames } from './prompt.mjs';
import { validateProposal } from './proposal.mjs';
import { validateMetricsChange } from './metrics-deps.mjs';
import { validateAwayChange } from './away-deps.mjs';
import { validatePolicyChange } from './policy-deps.mjs';
import { validateModelChange } from './model-deps.mjs';
import { validateCloneProposal } from './clone-deps.mjs';
import { validateWorkspaceChange } from './workspace-deps.mjs';
import { validateActionsChange } from './actions-deps.mjs';
import { actionsProposalInput } from './actions-proposal.mjs';
import { createWebValidator } from './web-proposal.mjs';
import { validateScheduleChange } from './schedule-deps.mjs';
import { lookupTask } from './source-deps.mjs';
import { effectiveTimeZone } from './schedule-spec.mjs';
import { scheduleDefaults } from '../settings.mjs';
import { ASK_ENGINES } from '../model-env.mjs';
import { engineLabel } from '../../shared/engine-switch.mjs';
import { revalidateWorkflowProposal } from './workflow-deps.mjs';
import { askLimits, ASK_LIMITS } from './limits.mjs';
import { codexPreflight, codexAskSupport, codexModelPriced, codexResumeNotFound, CODEX_ASK_LOCKDOWN } from '../engines/codex.mjs';
import { hasCodexEndpoint } from '../engines/codex-endpoint.mjs';
import { codexMemoryLine } from './prompt.mjs';
import { resolveSetting } from '../settings-cascade.mjs';
import { mentionedRefs } from './contexts.mjs';
import {
  newAskId, finishMessage, setMessageBlocks, addThreadTotals, addThreadContexts, updateThread, setThreadTitle, listAttachments, ASK_ID_RE,
} from './store.mjs';
import { recordAskCostDelta } from '../cost-budget.mjs';
import { setPendingCardComments } from '../diff-comments.mjs';

export function createAskTurn(opts) { return new AskTurn(opts); }

const TERMINAL = new Set(['done', 'stopped', 'error']);

// The classified notice's raw-detail cap — the runner's own reject is already
// tail-capped tighter than this; the slice(-N) here only bounds the unusual
// non-runner error paths so a huge message can never bloat the persisted block.
const ERROR_DETAIL_MAX = 2000;
// Ask Worca on Codex (cascading-settings-design.md §4.6, D13, D14).
export const CODEX_NOT_READY_CODE = 'codex-not-ready';
export const CODEX_SETUP_DOCS_URL = 'https://github.com/SinishaDjukic/worca-cc/blob/dev/docs/models.md#codex';
export const CODEX_NO_LOCKDOWN_MESSAGE = "Ask on Codex is unavailable: this codex version cannot switch off its image viewer (which reads any image on disk) or its sub-agents, and a chat must stay inside its own files. Use a Claude chat.";
export const CODEX_MCP_NOTE = 'Your MCP servers are available in Claude chats';
export const CODEX_SHELL_TRIPPED_MESSAGE = 'Codex tried to run a shell command although its shell was switched off — worca stopped the turn.';
/** D13 fail-closed beyond the shell: a Codex chat may call worca's own tools (mcp__…) only. */
export const codexToolTrippedMessage = (what) => `Codex used ${what}, which a chat must not have — worca stopped the turn.`;
const askSlotOf = (engine) => { try { return resolveSetting(`models.${engine}.ask`).value; } catch { return undefined; } };

// MCP registry §10 (Ask column): what a registry copy's `system/init` status reads as (connected/pending: nothing).
const MCP_UNAVAILABLE = Object.freeze({
  failed: 'failed', 'needs-auth': 'needs-auth',
  disabled: 'disabled by your Claude Code settings', absent: 'blocked by managed MCP policy',
});

// Skills registry §4.4 safety net: a Claude Code that refuses --plugin-dir exits before any init — managed
// disableSideloadFlags ("--plugin-dir is disabled by your organization's managed settings (disableSideloadFlags)…",
// P3 probe 10) or a CLI without the flag ("unknown option '--plugin-dir'"). The regex is P3's SIDELOAD_REFUSAL_RE.
const SKILLS_REFUSED_NOTICE = 'skills from sets not loaded (Claude Code refuses --plugin-dir here)';
const SKILLS_MOUNT_FAILED_NOTICE = 'skills from sets not loaded (they could not be copied for this turn)';
// The only folders the mount's sweep removes under ask/<thread>/skills/: message ids (store.mjs newAskId('askm')).
const MESSAGE_FOLDER_RE = /^askm_[0-9a-f]{8}$/;

/** The human line a classified failure carries. The block is persisted and
 *  shared by every viewer, so the wording is level-neutral: it names where a
 *  remedy lives (including which interface mode gates it) instead of assuming
 *  one. Pure, exported for tests. */
export function humanErrorText(errorClass) {
  switch (errorClass) {
    case 'model': return "This model isn't available in your environment — Claude Code couldn't use it. Try another model, or add your custom model in Settings › Models (Expert mode).";
    case 'auth': return 'Authentication failed — check the credentials behind this model.';
    case 'usage_limit': return 'A usage limit was reached — wait for it to reset.';
    case 'rate_limit': return 'The endpoint is rate-limiting — try again shortly.';
    case 'quota': return 'A quota/billing problem was reported — check the account behind this model.';
    case 'network': return 'The endpoint was unreachable — check your connection and retry.';
    default: return null;
  }
}

class AskTurn extends EventEmitter {
  constructor({
    threadId, assistantMessageId, userMessageId,
    prompt, systemPrompt, restoredPrompt = '',
    model, effort, resumeSessionId = null,
    firstTurn = false, firstText = '', deterministicTitle = null,
    mock = null, attachmentNames = {},
    pinnedScope = null,
    memoryProject = null,
    timeZone = null,
    reader = null,
    web = null,
    mcp = null,
    engine = 'claude', images = [], mcpCodexNote = false,
    skills = null,
    agentMode = true,
    deps = {},
  } = {}) {
    super();
    // D5 backstop: an engine Ask does not run on (Cursor: CURSOR_ASK_LOCKDOWN = null) is refused outright.
    if (engine && !ASK_ENGINES.includes(engine)) throw new Error(`Ask on ${engineLabel(engine)} is unavailable`);
    this.threadId = threadId;
    // The chat's engine (D12) — fixed by the server from the chat's model; a Claude turn never reads the fields below.
    this.engine = engine === 'codex' ? 'codex' : 'claude';
    this.images = Array.isArray(images) ? images.filter((p) => typeof p === 'string' && p) : [];   // D16: this turn's images (-i)
    this.mcpCodexNote = this.engine === 'codex' && mcpCodexNote === true;
    this._cap = null;                 // Task 10: the watchdog's verdict ('max_turns' | 'max_budget' | 'shell')
    this._toolCalls = 0;
    this._spentUsd = 0;
    // Skills registry §4.4: resolveAskSkills()'s result for this turn; null, a blocked layer or no plugin ⇒ no mount and a
    // byte-identical spawn. Set to null again when the mount fails or the CLI refuses --plugin-dir. A Codex chat mounts
    // the same way but reads the skills through read_file (#635), so Claude Code's --plugin-dir block does not apply.
    this.skills = skills && (this.engine === 'codex' || !skills.blocked) && Array.isArray(skills.plugins) && skills.plugins.length ? skills : null;
    this.skillMount = null;           // materializeSkillMount()'s answer: { base, pluginDirs, plugins, failed }
    this.skillNames = [];             // the qualified names the mount holds — the prompt section, the note, the allow rules
    this._promptWithoutSkills = null; // the route's system prompt, restored when the safety net drops the layer
    this._skillBase = null;           // the per-message mount folder — removed in run()'s finally, whatever the mount did
    this._skillsNotices = [];         // what happened to the layer: re-added to the resume-fallback retry's fresh reducer
    // MCP registry §9.2: resolveRegistry()'s result for this turn; null (or no copies) keeps the spawn byte-identical.
    this.mcp = mcp && Array.isArray(mcp.copies) && mcp.copies.length ? mcp : null;
    this._mcpNoted = new Set();       // §10: copies already given a muted line by THIS attempt's reducer
    this._worktreeMutated = false;    // §9.1 (D17): set by the reducer's onWorktreeMutation; asks for the join notice
    // §5.5.3: the reducer's text redactor — Ask's patterns, then this turn's registry values (and their encodings).
    this._mcpRedact = this.mcp && this.mcp.secretValues.length
      ? ((r) => (s) => r.text(redactAskText(s)))(createRedactor(this.mcp.secretValues))
      : null;
    // A shared sign-in's name (identity.mjs): the MCP child's per-person reads (notifications).
    this.reader = typeof reader === 'string' && reader ? reader : null;
    // askWebAccess() for this turn (docs/guardrails.md "Web access"): the MCP child's web tools + the sub-agent note.
    this.web = web && web.enabled === true ? web : null;
    // Agent mode (#574): this chat's switch (the server already folded in whether commands exist here at all).
    this.agentMode = agentMode !== false;
    this.commands = null;
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
    // The user's timezone (the browser's, validated) — the zone a proposal's when / every is read in.
    this.timeZone = effectiveTimeZone(timeZone);
    // Native-rules revision (D16): {key, name}|null — the scope set this turn mounts through --add-dir.
    this.memoryProject = memoryProject && typeof memoryProject === 'object' ? memoryProject : null;
    this.memoryDir = null;
    this._wfCards = new Map();        // tool_use id → card id (START → RESULT of one propose_workflow call)
    this._tracked = new Set();        // pipeline ids minted as progress cards in THIS reply (one card per pipeline)
    this.extraCostUsd = 0;            // PD2: money the MCP child spent on the workflow classifier, booked by this turn
    this.deps = {
      runClaudeImpl: deps.runClaudeImpl ?? runClaude,
      failedBecauseSignedOut: deps.failedBecauseSignedOut ?? failedBecauseSignedOut,
      codexPreflight: deps.codexPreflight ?? ((o) => codexPreflight(o)),
      codexAskSupport: deps.codexAskSupport ?? ((o) => codexAskSupport(o)),
      codexLockdown: deps.codexLockdown ?? (() => CODEX_ASK_LOCKDOWN),
      codexModelPriced: deps.codexModelPriced ?? codexModelPriced,
      askSlot: deps.askSlot ?? askSlotOf,
      memoryMount: deps.memoryMount ?? refreshAskMemoryMount,
      // Skills registry §4.4: the per-turn set-skill mount (P3) and its removal.
      materializeSkillMount: deps.materializeSkillMount ?? materializeSkillMount,
      removeSkillMount: deps.removeSkillMount ?? ((base) => rm(base, { recursive: true, force: true })),
      store: {
        finishMessage, setMessageBlocks, addThreadTotals, addThreadContexts, updateThread, setThreadTitle, listAttachments,
        ...(deps.store || {}),
      },
      validateProposal: deps.validateProposal ?? validateProposal,
      revalidateWorkflow: deps.revalidateWorkflow ?? revalidateWorkflowProposal,
      validateMetricsChange: deps.validateMetricsChange ?? validateMetricsChange,
      validateAwayChange: deps.validateAwayChange ?? validateAwayChange,
      validatePolicyChange: deps.validatePolicyChange ?? validatePolicyChange,
      validateScheduleChange: deps.validateScheduleChange ?? validateScheduleChange,
      validateModelChange: deps.validateModelChange ?? validateModelChange,
      validateCloneProposal: deps.validateCloneProposal ?? validateCloneProposal,
      validateWorkspaceChange: deps.validateWorkspaceChange ?? validateWorkspaceChange,
      validateActionsChange: deps.validateActionsChange ?? validateActionsChange,
      // The web card's authoritative check runs against THIS turn's resolved access (allowlist + team cap).
      validateWebProposal: deps.validateWebProposal ?? ((input) => createWebValidator({
        allowed: () => (this.web ? this.web.allowedDomains : []), teamCap: () => (this.web ? this.web.teamCap ?? null : null) })(input)),
      scheduleDefaults: deps.scheduleDefaults ?? scheduleDefaults,
      // A proposed plugin task is looked up here, once: it must exist, and the card shows its title.
      lookupTask: deps.lookupTask === undefined ? lookupTask : deps.lookupTask,
      trackRun: deps.trackRun ?? null,
      awaySwitch: deps.awaySwitch ?? null,
      // Conversation chips: (refs) → resolved chip entries (ui/server.mjs resolveAskMentions). null = none.
      resolveMentions: deps.resolveMentions ?? null,
      generateTitle: deps.generateTitle ?? generateTitle,
      askLimits: deps.askLimits ?? askLimits,
      limits: deps.limits ?? ASK_LIMITS,
      resolveModelEnv: deps.resolveModelEnv ?? resolveModelEnv,
      resolveModelCost: deps.resolveModelCost ?? resolveModelCost,
      worcaHome: deps.worcaHome ?? worcaHome,
      buildMcpConfig: deps.buildMcpConfig ?? buildMcpConfig,
      // ({threadId, reader, web}) => {url, token, dispose()} | null. Set by the server when agents run
      // under their own users (agent-pool.mjs): the chat's claude then runs as the person's
      // agent user and its worca tools run in the server through this relay. null = classic.
      agentRelay: deps.agentRelay ?? null,
      // Agent mode (#574): ({threadId}) => {url, token, dispose()} | null. Set by the server only where the
      // terminal is enabled (terminalEnabledHere). null = no command tools.
      commandBridge: deps.commandBridge ?? null,
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
      // () => Promise<string|null>: §9.1 (D17) — the server re-runs the targets in play at turn end and names the
      // copies a worktree change brings into the next turn. null = no notice.
      mcpJoinNotice: deps.mcpJoinNotice ?? null,
      mcpJoinNoticeMs: deps.mcpJoinNoticeMs ?? 5000,   // its bound: a hung resolve never wedges the terminal write
      onMemoryMutation: deps.onMemoryMutation ?? (() => {}),
      onScriptMutation: deps.onScriptMutation ?? (() => {}),
      onScheduleMutation: deps.onScheduleMutation ?? (() => {}),
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
    if (this._completed) return;                                  // v7: after _complete() the terminal write owns the row
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
      // The thread's attachment ledger, so attachmentIds the model cites resolve
      // to real rows (spec §6.4). A ledger failure never blocks the card.
      let attachments = [];
      try { attachments = (typeof d.store.listAttachments === 'function' && d.store.listAttachments(this.threadId)) || []; } catch { attachments = []; }
      let defaults = {};
      try { defaults = d.scheduleDefaults() || {}; } catch { defaults = {}; }
      const r = await d.validateProposal(inp, { cardId, attachments, timeZone: this.timeZone, nowMs: d.now(), scheduleDefaults: defaults, lookupTask: d.lookupTask });
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

  /** run_command RESULT (#574): one command card per block (the live state comes from ask-command frames). */
  _onRunCommand(text, isError) {
    if (isError) return;
    let r = null;
    try { r = JSON.parse(text); } catch { return; }
    if (!r || r.ok !== true || typeof r.blockId !== 'string') return;
    const card = { type: 'command', blockId: r.blockId, sessionId: r.sessionId, seq: r.seq, command: String(r.command || '').slice(0, 4000),
      folder: r.folder || null, cwd: r.cwd || null, warning: r.warning || null };
    const block = this.reducer.addBlock({ kind: 'card', id: this.deps.newAskId('card'), state: 'command', card });
    if (block) this._persistBlocks();
  }

  /** track_run's card (D3/D4): the MCP child only resolved the id — deps.trackRun (ui/server.mjs askTrackRun)
   *  links the run to this thread and follows a live one; this mints ONE stateless progress card per pipeline
   *  per reply (older replies keep theirs — every card derives what it shows). */
  async _onTrackRun(input, isError) {
    if (isError) return;
    const d = this.deps;
    if (typeof d.trackRun !== 'function') return;
    const raw = input && typeof input === 'object' ? input : {};
    let r = null;
    try { r = await d.trackRun(raw, { threadId: this.threadId, pin: this.pinnedScope }); }
    catch (err) { r = { ok: false, error: err?.message || String(err) }; }
    if (!r || !r.ok || !r.card || !r.card.pipelineId) {
      this.reducer.addBlock({ kind: 'notice', text: `Could not track the run: ${(r && r.error) || 'unknown error'}` });
      this._persistBlocks();
      return;
    }
    if (this._tracked.has(r.card.pipelineId)) return;          // the hook continuations run one at a time after their await
    this._tracked.add(r.card.pipelineId);
    const block = this.reducer.addBlock({ kind: 'card', id: d.newAskId('card'), state: 'tracked', card: r.card });
    if (!block) return;                                          // null after finish() (events.mjs:511) — _onWorkflowResult's own guard
    this._persistBlocks();                                       // a store write; the browser gets the reducer's ask-card frame
  }

  /** set_away_now / set_run_away_mode RESULT: the child validated; the parent owns settings and live runs. */
  async _onAwaySwitch(text, isError) {
    if (isError || typeof this.deps.awaySwitch !== 'function') return;
    let req = null;
    try { req = JSON.parse(text)?.requested || null; } catch { req = null; }
    if (!req || (req.kind !== 'global' && req.kind !== 'run')) return;
    let r;
    try { r = await this.deps.awaySwitch(req); }
    catch (err) { r = { ok: false, error: err?.message || String(err) }; }
    // One closing mark, never two: the paused line already ends "(Marked runs wait too.)".
    const line = String(r?.line ?? '').trim();
    this.reducer.addBlock({ kind: 'notice', text: r?.ok ? `Done — ${/[.!?)]$/.test(line) ? line : `${line}.`}` : `Could not change Away mode${req.kind === 'run' ? ' on this run' : ''}: ${r?.error || 'unknown error'}` });
    this._persistBlocks();
  }

  /**
   * propose_metrics_change RESULT: the child validated for the model's self-correction; the parent re-validates the
   * same INPUT authoritatively (metrics-proposal.mjs is pure over the real readers) and mints the card. An isError
   * result or a child {ok:false} already reached the model as text — no card, no notice.
   */
  async _onMetricsProposal(input, text, isError) {
    if (isError) return;
    let out = null;
    try { out = JSON.parse(text); } catch { out = null; }
    if (!out || out.ok !== true) return;
    const d = this.deps;
    const raw = input && typeof input === 'object' ? input : {};
    // The child's pinned-scope default, replayed (tools.mjs propose_metrics_change): the card matches what the model saw.
    const pin = this.pinnedScope;
    const kind = typeof raw.kind === 'string' ? raw.kind.trim() : '';
    let inp = raw;
    if (pin && !(typeof raw.projectKey === 'string' && raw.projectKey.trim()) && !(typeof raw.workspaceId === 'string' && raw.workspaceId.trim())) {
      if (pin.projectKey && (kind === 'enable' || kind === 'record')) inp = { ...raw, projectKey: pin.projectKey };
      if (pin.workspaceId && (kind === 'workspace_home' || kind === 'route_members')) inp = { ...raw, workspaceId: pin.workspaceId };
    }
    try {
      const r = await d.validateMetricsChange(inp);
      if (r && r.ok) this.reducer.addBlock({ kind: 'card', id: d.newAskId('card'), state: 'proposed', card: r.card });
      else {
        const errors = (r && Array.isArray(r.errors) && r.errors.length) ? r.errors : ['invalid proposal'];
        this.reducer.addBlock({ kind: 'notice', text: `Metrics change rejected: ${errors.join('; ')}` });
      }
    } catch (err) {
      this.reducer.addBlock({ kind: 'notice', text: `Metrics change rejected: ${err?.message || err}` });
    }
    this._persistBlocks();
  }

  /**
   * propose_away_mode_change RESULT: the metrics card's split — the child validated for the model, the parent
   * re-validates the same INPUT over the real readers (away-proposal.mjs) and mints the card.
   */
  async _onAwayProposal(input, text, isError) {
    if (isError) return;
    let out = null;
    try { out = JSON.parse(text); } catch { out = null; }
    if (!out || out.ok !== true) return;
    const d = this.deps;
    const raw = input && typeof input === 'object' ? input : {};
    // The child's pinned-project default, replayed (tools.mjs propose_away_mode_change).
    const pin = this.pinnedScope;
    const inp = raw.level === 'project' && !(typeof raw.projectKey === 'string' && raw.projectKey.trim()) && pin && pin.projectKey ? { ...raw, projectKey: pin.projectKey } : raw;
    try {
      const r = await d.validateAwayChange(inp);
      if (r && r.ok) this.reducer.addBlock({ kind: 'card', id: d.newAskId('card'), state: 'proposed', card: r.card });
      else {
        const errors = (r && Array.isArray(r.errors) && r.errors.length) ? r.errors : ['invalid proposal'];
        this.reducer.addBlock({ kind: 'notice', text: `Away mode change rejected: ${errors.join('; ')}` });
      }
    } catch (err) {
      this.reducer.addBlock({ kind: 'notice', text: `Away mode change rejected: ${err?.message || err}` });
    }
    this._persistBlocks();
  }

  /**
   * propose_policy_change RESULT: the metrics card's split — the child validated for the model, the parent re-validates
   * the same INPUT over the real readers (policy-proposal.mjs) and mints the card.
   */
  async _onPolicyProposal(input, text, isError) {
    if (isError) return;
    let out = null;
    try { out = JSON.parse(text); } catch { out = null; }
    if (!out || out.ok !== true) return;
    const d = this.deps;
    const raw = input && typeof input === 'object' ? input : {};
    // The child's pinned-scope default, replayed (tools.mjs fillPolicyPin): the card matches what the model saw.
    const pin = this.pinnedScope;
    const kind = typeof raw.kind === 'string' ? raw.kind.trim() : '';
    let inp = raw;
    if (pin && !(typeof raw.projectKey === 'string' && raw.projectKey.trim()) && !(typeof raw.workspaceId === 'string' && raw.workspaceId.trim())) {
      if (pin.projectKey && (kind === 'enable' || kind === 'edit')) inp = { ...raw, projectKey: pin.projectKey };
      if (pin.workspaceId && (kind === 'edit' || kind === 'workspace_home' || kind === 'route_members')) inp = { ...raw, workspaceId: pin.workspaceId };
    }
    try {
      const r = await d.validatePolicyChange(inp);
      if (r && r.ok) this.reducer.addBlock({ kind: 'card', id: d.newAskId('card'), state: 'proposed', card: r.card });
      else {
        const errors = (r && Array.isArray(r.errors) && r.errors.length) ? r.errors : ['invalid proposal'];
        this.reducer.addBlock({ kind: 'notice', text: `Policy change rejected: ${errors.join('; ')}` });
      }
    } catch (err) {
      this.reducer.addBlock({ kind: 'notice', text: `Policy change rejected: ${err?.message || err}` });
    }
    this._persistBlocks();
  }

  /**
   * propose_schedule_change RESULT: the metrics card's split — the child validated for the model, the parent
   * re-validates the same INPUT against the live rows and mints the card. A child {ok:false} already reached
   * the model as text: no card, no notice.
   */
  async _onScheduleProposal(input, text, isError) {
    if (isError) return;
    let out = null;
    try { out = JSON.parse(text); } catch { out = null; }
    if (!out || out.ok !== true) return;
    const d = this.deps;
    try {
      const r = await d.validateScheduleChange(input && typeof input === 'object' ? input : {}, { timeZone: this.timeZone });
      if (r && r.ok) this.reducer.addBlock({ kind: 'card', id: d.newAskId('card'), state: 'proposed', card: r.card });
      else {
        const errors = (r && Array.isArray(r.errors) && r.errors.length) ? r.errors : ['invalid proposal'];
        this.reducer.addBlock({ kind: 'notice', text: `Schedule change rejected: ${errors.join('; ')}` });
      }
    } catch (err) {
      this.reducer.addBlock({ kind: 'notice', text: `Schedule change rejected: ${err?.message || err}` });
    }
    this._persistBlocks();
  }

  /**
   * propose_model_change RESULT: the metrics card's split — the child validated for the model, the parent
   * re-validates the same INPUT over the real catalog and providers and mints the card. A child {ok:false}
   * already reached the model as text: no card, no notice.
   */
  async _onModelProposal(input, text, isError) {
    if (isError) return;
    let out = null;
    try { out = JSON.parse(text); } catch { out = null; }
    if (!out || out.ok !== true) return;
    const d = this.deps;
    try {
      const r = await d.validateModelChange(input && typeof input === 'object' ? input : {});
      if (r && r.ok) this.reducer.addBlock({ kind: 'card', id: d.newAskId('card'), state: 'proposed', card: r.card });
      else {
        const errors = (r && Array.isArray(r.errors) && r.errors.length) ? r.errors : ['invalid proposal'];
        this.reducer.addBlock({ kind: 'notice', text: `Model change rejected: ${errors.join('; ')}` });
      }
    } catch (err) {
      this.reducer.addBlock({ kind: 'notice', text: `Model change rejected: ${err?.message || err}` });
    }
    this._persistBlocks();
  }

  /**
   * propose_clone_project RESULT: the model card's split — the child validated for the model, the parent
   * re-validates the same INPUT (and adds how GitHub is reached) and mints the card. A child {ok:false}
   * already reached the model as text: no card, no notice.
   */
  async _onCloneProposal(input, text, isError) {
    if (isError) return;
    let out = null;
    try { out = JSON.parse(text); } catch { out = null; }
    if (!out || out.ok !== true) return;
    const d = this.deps;
    try {
      const r = await d.validateCloneProposal(input && typeof input === 'object' ? input : {});
      if (r && r.ok) this.reducer.addBlock({ kind: 'card', id: d.newAskId('card'), state: 'proposed', card: r.card });
      else {
        const errors = (r && Array.isArray(r.errors) && r.errors.length) ? r.errors : ['invalid proposal'];
        this.reducer.addBlock({ kind: 'notice', text: `Clone rejected: ${errors.join('; ')}` });
      }
    } catch (err) {
      this.reducer.addBlock({ kind: 'notice', text: `Clone rejected: ${err?.message || err}` });
    }
    this._persistBlocks();
  }

  /** propose_web_access RESULT: the clone card's split — a child {ok:false} already reached the model as text. */
  async _onWebProposal(input, text, isError) {
    if (isError || !this.web) return;
    let out = null;
    try { out = JSON.parse(text); } catch { out = null; }
    if (!out || out.ok !== true) return;
    const d = this.deps;
    try {
      const r = await d.validateWebProposal(input && typeof input === 'object' ? input : {});
      if (r && r.ok) this.reducer.addBlock({ kind: 'card', id: d.newAskId('card'), state: 'proposed', card: r.card });
      else {
        const errors = (r && Array.isArray(r.errors) && r.errors.length) ? r.errors : ['invalid proposal'];
        this.reducer.addBlock({ kind: 'notice', text: `Web access request rejected: ${errors.join('; ')}` });
      }
    } catch (err) {
      this.reducer.addBlock({ kind: 'notice', text: `Web access request rejected: ${err?.message || err}` });
    }
    this._persistBlocks();
  }

  /**
   * propose_workspace_change RESULT: the model card's split — the child validated for the model, the parent
   * re-validates the same INPUT against the live registry and mints the card. The child's pinned-workspace
   * default is replayed (tools.mjs propose_workspace_change) so the card matches what the model saw. A child
   * {ok:false} already reached the model as text: no card, no notice.
   */
  async _onWorkspaceProposal(input, text, isError) {
    if (isError) return;
    let out = null;
    try { out = JSON.parse(text); } catch { out = null; }
    if (!out || out.ok !== true) return;
    const d = this.deps;
    const raw = input && typeof input === 'object' ? input : {};
    const pin = this.pinnedScope;
    const inp = pin && pin.workspaceId && raw.kind !== 'create' && !(typeof raw.workspaceId === 'string' && raw.workspaceId.trim())
      ? { ...raw, workspaceId: pin.workspaceId } : raw;
    try {
      const r = await d.validateWorkspaceChange(inp);
      if (r && r.ok) this.reducer.addBlock({ kind: 'card', id: d.newAskId('card'), state: 'proposed', card: r.card });
      else {
        const errors = (r && Array.isArray(r.errors) && r.errors.length) ? r.errors : ['invalid proposal'];
        this.reducer.addBlock({ kind: 'notice', text: `Workspace change rejected: ${errors.join('; ')}` });
      }
    } catch (err) {
      this.reducer.addBlock({ kind: 'notice', text: `Workspace change rejected: ${err?.message || err}` });
    }
    this._persistBlocks();
  }

  /**
   * propose_actions_change RESULT: the workspace card's split — the child validated for the model, the parent
   * re-validates the same INPUT against the stored config and mints the card. The child's pinned-target default
   * is replayed (actionsProposalInput) so the card matches what the model saw. A child {ok:false} already
   * reached the model as text: no card, no notice.
   */
  async _onActionsProposal(input, text, isError) {
    if (isError) return;
    let out = null;
    try { out = JSON.parse(text); } catch { out = null; }
    if (!out || out.ok !== true) return;
    const d = this.deps;
    try {
      const r = await d.validateActionsChange(actionsProposalInput(input, this.pinnedScope));
      if (r && r.ok) this.reducer.addBlock({ kind: 'card', id: d.newAskId('card'), state: 'proposed', card: r.card });
      else {
        const errors = (r && Array.isArray(r.errors) && r.errors.length) ? r.errors : ['invalid proposal'];
        this.reducer.addBlock({ kind: 'notice', text: `Actions change rejected: ${errors.join('; ')}` });
      }
    } catch (err) {
      this.reducer.addBlock({ kind: 'notice', text: `Actions change rejected: ${err?.message || err}` });
    }
    this._persistBlocks();
  }

  /** The card exists from the tool_use on (spec §8.2, PD7): a building block with the four-step trace, persisted. */
  _onWorkflowStart(toolUseId, input) {
    const d = this.deps;
    const cardId = d.newAskId('card');
    this._wfCards.set(toolUseId, cardId);
    const raw = input && typeof input === 'object' ? input : {};
    const pin = this.pinnedScope;
    // The target resolves as the tool does: an explicit projectKey, else an explicit workspaceId, else the pin.
    const inKey = typeof raw.projectKey === 'string' ? raw.projectKey.trim() : '';
    const inWs = typeof raw.workspaceId === 'string' ? raw.workspaceId.trim() : '';
    const projectKey = inKey || (!inWs && pin && pin.projectKey) || null;
    const workspaceId = projectKey ? null : (inWs || (pin && pin.workspaceId) || null);
    const mode = typeof raw.task === 'string' && raw.task.trim() ? 'task' : 'shape';
    this.reducer.addBlock({ kind: 'card', id: cardId, state: 'building', card: {
      type: 'workflow', mode, projectKey, projectName: null, workspaceId, workspaceName: null,
      // v7: the building payload is transient (the proposed flip replaces `card` wholesale) — cap a hand-authored shape like the task text.
      ...(mode === 'task' ? { task: String(raw.task).slice(0, 2000) } : { shape: raw.shape && typeof raw.shape === 'object' && JSON.stringify(raw.shape).length <= 8000 ? raw.shape : null }),
      name: cleanText(raw.name, 60), note: cleanText(raw.note, d.limits.workflowNoteMaxChars ?? 200), thenRun: raw.thenRun === true,
      trace: { step: 1, startedAt: new Date(d.now()).toISOString() },
    } });
    this._persistBlocks();
  }

  /** RESULT: re-validate the returned shape in the parent (assemble, validateGraph, match, buildProposal) and flip the block. */
  async _onWorkflowResult(toolUseId, text, isError) {
    const d = this.deps;
    const cardId = this._wfCards.get(toolUseId);
    if (!cardId) return;
    this._wfCards.delete(toolUseId);
    const fail = (reason) => this.reducer.updateBlock(cardId, { state: 'failed', error: cleanText(reason, 300) || 'proposal failed' });
    let out = null;
    if (!isError) { try { out = JSON.parse(text); } catch { out = null; } }
    // PD2: the classifier ran in the child whatever happens next — book its spend BEFORE judging the result. v7: a
    // {ok:false, error, costUsd} result (classifier timeout / two unusable replies / a shape still rejected after the retry)
    // carries what the failed attempts cost (ClassifierError.costUsd); v6 booked only on ok:true and lost it.
    if (out && Number(out.costUsd) > 0) this.extraCostUsd += Number(out.costUsd);
    if (isError || !out || out.ok !== true || !out.shape || typeof out.shape !== 'object') {
      const reason = isError ? String(text ?? '').replace(/^error:\s*/, '') : (out && typeof out.error === 'string' && out.error) || 'the tool returned no shape';
      if (!fail(reason)) return;                                  // null: the reducer is finished (stop/timeout) — the terminal write already happened
      this._persistBlocks();
      return;
    }
    try {
      const workspaceId = typeof out.workspaceId === 'string' && out.workspaceId ? out.workspaceId : null;
      // workspaceId rides the revalidate input only when set — a project card's input stays exactly what it was.
      const r = await d.revalidateWorkflow({ shape: out.shape, projectKey: out.projectKey, ...(workspaceId ? { workspaceId } : {}), warnings: Array.isArray(out.warnings) ? out.warnings : [], costUsd: Number(out.costUsd) || 0, fingerprint: typeof out.fingerprint === 'string' ? out.fingerprint : '' });
      // v4: the child's name first (the real child resolves it), else the parent's own lookup (the MOCK child
      // returns null — without this every mock card, and its context-header line, would have no target name).
      const workspaceName = workspaceId ? (cleanText(out.workspaceName, 120) || cleanText(r.workspace && r.workspace.name, 120) || null) : null;
      const projectName = workspaceId ? null : (cleanText(out.projectName, 120) || cleanText(r.project && r.project.name, 120) || null);
      const flipped = this.reducer.updateBlock(cardId, { state: 'proposed', card: {
        type: 'workflow', mode: out.mode === 'shape' ? 'shape' : 'task', projectKey: !workspaceId && typeof out.projectKey === 'string' ? out.projectKey : null,
        projectName, workspaceId, workspaceName, note: cleanText(out.note, 200), thenRun: out.thenRun === true,
        shape: r.shape, summary: cleanText(r.summary, 2000),
        ...r.proposal,
      } });
      if (!flipped) return;                                       // v7: finished reducer (the turn was stopped mid-revalidate) — never persist a stale snapshot
    } catch (err) {
      if (!fail(err && err.message ? err.message : String(err))) return;
    }
    this._persistBlocks();
  }

  _makeReducer() {
    this._wfCards.clear();
    this._tracked.clear();
    this._mcpNoted.clear();          // the retry's fresh reducer starts its own lines; only the last reducer is persisted
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
      ...(this.engine === 'codex' ? { emitWholeMessages: true } : {}),
      // MCP registry §5.5.3: the persisted text is redacted whole with this turn's registry values (the runner redacts
      // per event, and a value split across stream deltas is only whole here). Without secrets: the default redactor.
      ...(this._mcpRedact ? { redact: this._mcpRedact } : {}),
      // Ask spend feeds the SAME windowed budget as pipeline spend
      // (cost-budget.mjs combinedWindowedSpendUsd), so an on-prem model the CLI
      // prices by name inflates it from here too — re-price the turn exactly as
      // the orchestrator's result intake does. Trusts the CLI when the model
      // carries no override, which is the default.
      resolveCost: (cliCostUsd, usage) => d.resolveModelCost(this.model, cliCostUsd, usage),
      limits: d.limits,
      onProposal: ({ input }) => this._onProposal(input),
      onWorkflowStart: ({ toolUseId, input }) => this._onWorkflowStart(toolUseId, input),
      onWorkflowResult: ({ toolUseId, text, isError }) => this._onWorkflowResult(toolUseId, text, isError),   // the hook's `input` is not needed here: the card is rebuilt from `out`
      onTrackRun: ({ input, isError }) => this._onTrackRun(input, isError),
      onRunCommand: ({ text, isError }) => this._onRunCommand(text, isError),
      onAwaySwitch: ({ text, isError }) => this._onAwaySwitch(text, isError),
      onMetricsProposal: ({ input, text, isError }) => this._onMetricsProposal(input, text, isError),
      onAwayProposal: ({ input, text, isError }) => this._onAwayProposal(input, text, isError),
      onPolicyProposal: ({ input, text, isError }) => this._onPolicyProposal(input, text, isError),
      onScheduleProposal: ({ input, text, isError }) => this._onScheduleProposal(input, text, isError),
      onModelProposal: ({ input, text, isError }) => this._onModelProposal(input, text, isError),
      onCloneProposal: ({ input, text, isError }) => this._onCloneProposal(input, text, isError),
      onWorkspaceProposal: ({ input, text, isError }) => this._onWorkspaceProposal(input, text, isError),
      onActionsProposal: ({ input, text, isError }) => this._onActionsProposal(input, text, isError),
      onWebProposal: ({ input, text, isError }) => this._onWebProposal(input, text, isError),
      // pause / resume / skip / mark-read in the child → the server's schedules-changed frames.
      onScheduleMutation: (e) => { try { this.deps.onScheduleMutation(e); } catch { /* a broken sink never breaks the turn */ } },
      // The MCP child cannot broadcast; the parent turns its comment writes into
      // the same poke the REST routes emit.
      onCommentMutation: (e) => { try { this.deps.onCommentMutation(e); } catch { /* a broken sink never breaks the turn */ } },
      // Same shape for worktrees: open/remove/navigate in the child → the server
      // broadcasts the thread's worktree envelope (ui/server.mjs emitAskWorktrees).
      onWorktreeMutation: (e) => { this._worktreeMutated = true; try { this.deps.onWorktreeMutation(e); } catch { /* a broken sink never breaks the turn */ } },
      // ...and for memory: a remember/forget in the child becomes the server's memory-changed frame.
      onMemoryMutation: (e) => { try { this.deps.onMemoryMutation(e); } catch { /* a broken sink never breaks the turn */ } },
      // ...and for scripts: a save_script in the child becomes the server's scripts-changed frame.
      onScriptMutation: (e) => { try { this.deps.onScriptMutation(e); } catch { /* a broken sink never breaks the turn */ } },
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

  /** Skills registry §4.4: materialize this turn's mount, then name exactly what was written — P3 leaves out a skill it
   *  could not copy (`failed`) and a plugin left with none — in the prompt section (appended last), the sub-agent note
   *  and the allow rules. A failure never breaks the turn: it runs without set skills and says so. Both ids become path
   *  segments, so both are shape-checked first, and the two folders they name must be real folders, never symlinks. */
  async _mountSkills() {
    const d = this.deps;
    try {
      if (!ASK_ID_RE.test(String(this.threadId)) || !ASK_ID_RE.test(String(this.assistantMessageId))) throw new Error('not a store id');
      const threadDir = join(d.worcaHome(), 'ask', this.threadId);
      const parent = join(threadDir, 'skills');
      // Hosted mode: ask/ is group-writable for every pool user (docker/entrypoint.sh: setgid 2770, no sticky bit), so
      // another person's agent could put a symlink where ask/<thread>/ or its skills/ folder stands — the sweep and the
      // mount below would then delete and write wherever it points, as the server. Each is a real folder or not there yet.
      for (const p of [threadDir, parent]) {
        const st = await lstat(p).catch((err) => { if (err?.code === 'ENOENT') return null; throw err; });
        if (st && !st.isDirectory()) throw new Error(`${p} is not a real folder`);
      }
      this._skillBase = join(parent, this.assistantMessageId);
      // A folder an earlier turn of this thread left (a server killed mid-turn never ran its finally) goes now: one turn
      // per thread runs at a time, and the previous turn's spawn exited before its ask-done. Message folders only.
      for (const e of await readdir(parent).catch(() => [])) {
        if (e !== this.assistantMessageId && MESSAGE_FOLDER_RE.test(e)) await rm(join(parent, e), { recursive: true, force: true }).catch(() => {});
      }
      // The sweep awaited: a turn stopped meanwhile (a thread delete stops the turn, then removes ask/<thread>/ without
      // waiting for it) mounts nothing — the synchronous P3 mount below would recreate the deleted thread's folder.
      // Nothing yields from this check to the end of that mount.
      if (this.abort.signal.aborted) { this.skills = null; return; }
      const mount = await d.materializeSkillMount({ result: this.skills, base: this._skillBase });
      const failed = new Set((Array.isArray(mount?.failed) ? mount.failed : []).map((f) => `${f.pluginName}:${f.name}`));
      const written = new Set((Array.isArray(mount?.plugins) ? mount.plugins : []).map((p) => p.pluginName));
      const kept = this.skills.mounted.filter((m) => written.has(m.pluginName) && !failed.has(m.qualifiedName));
      if (!kept.length || !Array.isArray(mount.pluginDirs)) throw new Error('no skill was written');   // P3 writes no empty plugin
      this.skillMount = mount;
      // A Codex chat has no plugin namespace (#635): its names come from the whole resolved list, as the picker's do.
      const codexNames = this.engine === 'codex' ? codexSkillNames(this.skills.mounted) : null;
      const nameOf = (m) => (codexNames ? codexNames.get(m.qualifiedName) : m.qualifiedName);
      this.skillNames = kept.map(nameOf);
      const lost = this.skills.mounted.filter((m) => !kept.includes(m)).map(nameOf);
      if (lost.length) {
        console.warn(`[worca-ask] thread ${this.threadId}: ${lost.join(', ')} not copied (${(mount.failed || []).map((f) => f.error).join('; ')})`);
        this._skillsNotices.push(`skills from sets not loaded: ${lost.join(', ')} (they could not be copied for this turn)`);
        this.reducer.addBlock({ kind: 'notice', text: this._skillsNotices.at(-1) });
        this._persistBlocks();
      }
      this._promptWithoutSkills = this.systemPrompt;
      this.systemPrompt = `${this.systemPrompt}\n\n${codexNames
        // Codex: each SKILL.md under this message's mount, which the turn's read_file takes as one more root (file-deps.mjs).
        ? renderCodexSkillsSection({ skills: kept.map((m) => ({ name: nameOf(m), description: m.description, path: join(this._skillBase, m.pluginName, 'skills', m.name, 'SKILL.md') })) })
        : renderSkillsSection({ skills: kept.map((m) => ({ qualifiedName: m.qualifiedName, setName: m.setName })) })}`;
    } catch (err) {
      this.skills = null;
      this.skillMount = null;
      this._skillsNotices.push(SKILLS_MOUNT_FAILED_NOTICE);
      console.warn(`[worca-ask] thread ${this.threadId}: skills mount failed (${err?.message || err}) — this turn runs without skills from sets`);
      this.reducer.addBlock({ kind: 'notice', text: SKILLS_MOUNT_FAILED_NOTICE });
      this._persistBlocks();
    }
  }

  /** §10 (Ask): one muted line per registry copy the CLI could not start, once per attempt's reducer. */
  _noteMcpInit(list) {
    const status = new Map((Array.isArray(list) ? list : []).filter((x) => x && typeof x.name === 'string').map((x) => [x.name, x.status]));
    for (const c of this.mcp.copies) {
      const s = status.has(c.name) ? status.get(c.name) : 'absent';
      const why = typeof s === 'string' && Object.hasOwn(MCP_UNAVAILABLE, s) ? MCP_UNAVAILABLE[s] : null;
      if (!why || this._mcpNoted.has(c.name)) continue;
      this._mcpNoted.add(c.name);
      this.reducer.addBlock({ kind: 'notice', text: `${c.name} unavailable (${why})` });
    }
    this._persistBlocks();
  }

  /** The turn's closing MCP notices: the §10 tool-name 400 mapping and the §9.1 worktree join notice. */
  async _mcpClosingNotices(kind, message) {
    if (this.mcp && kind === 'error') {
      // P4's bounded regex over clipped texts (run-harness.mjs does the same with a result's errors).
      const text = [message, this.reducer.snapshot().cliErrorText].filter((t) => typeof t === 'string').map((t) => t.slice(0, 4096)).join(' ');
      if (MCP_TOOL_NAME_400_RE.test(text)) {
        // §10: "naming the untested or stale copies" (P4's warning names them too); none untested ⇒ every copy's set.
        const untested = this.mcp.copies.filter((c) => c.untested);
        const sets = [...new Set((untested.length ? untested : this.mcp.copies).map((c) => c.setName))].sort();
        const names = untested.length ? ` (${untested.map((c) => c.name).sort().join(', ')})` : '';
        this.reducer.addBlock({ kind: 'notice', text: `${MCP_TOOL_NAME_TOO_LONG} — Test the servers in ${sets.join(', ')}${names}` });
      }
    }
    if (!this._worktreeMutated || typeof this.deps.mcpJoinNotice !== 'function') return;   // §9.1: only a worktree change
    // Bounded like _settle: a hung resolve must never hold the terminal write (the thread would answer 409 until a restart).
    // The timer stays ref'd: it is the only thing left to wake the turn when the resolve hangs, and finally clears it.
    let text = null;
    let timer = null;
    const bound = new Promise((res) => { timer = setTimeout(() => res(null), this.deps.mcpJoinNoticeMs); });
    try { text = await Promise.race([this.deps.mcpJoinNotice(), bound]); } catch { text = null; } finally { clearTimeout(timer); }
    if (text) this.reducer.addBlock({ kind: 'notice', text, mcp: true });
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
  async _complete({ kind, status, reason = null, message = null, errorClass = undefined, code = undefined }) {
    if (this._completed) return { status: this.status };
    this._completed = true;
    const d = this.deps;
    await this._settle();
    await this._mcpClosingNotices(kind, message);
    // PD7: a card still building when the reply ends can never flip — fail it while the reducer is still open.
    for (const b of this.reducer.snapshot().blocks) {
      if (b && b.kind === 'card' && b.state === 'building') this.reducer.updateBlock(b.id, { state: 'failed', error: 'the reply ended before the proposal was ready' });
    }
    // A classified failure tells the user what happened and what to do, as a
    // notice block: it rides the terminal write below (like _limitNotice's
    // notice), so the human line survives a reload, and the extra fields
    // (errorClass, detail) let the chat render its recovery affordance. The
    // wording is level-neutral — the block is shared by every viewer — and
    // an UNCLASSIFIED error adds nothing: the raw message stays the only
    // evidence, exactly as before.
    if (kind === 'error' && errorClass) {
      // The detail carries the full evidence: the runner's exit verdict, plus
      // the CLI's own refusal line when it spoke synthetically (it is often
      // the clearest statement of the cause). Skipped when the runner message
      // already contains it — an empty stderr makes the runner echo it verbatim.
      const cli = this.reducer.snapshot().cliErrorText;
      const extra = cli && message && !String(message).includes(cli) ? cli : null;
      const detail = [message, extra].filter((s) => s && String(s).trim()).join('\n');
      this.reducer.addBlock({
        kind: 'notice',
        text: humanErrorText(errorClass),
        errorClass,
        detail: detail ? String(detail).slice(-ERROR_DETAIL_MAX) : null,
      });
    }
    const summary = this.reducer.finish();
    const finalStatus = kind === 'error' ? 'error' : status;
    // Already AUTHORITATIVE: the reducer applied this turn's per-model cost
    // override (the `resolveCost` hook in _makeReducer), so this one value is
    // correct for all four sinks below — the message row, the thread totals, the
    // budget ledger, and the ask-done frame.
    // PD2: the MCP child's classifier spend (propose_workflow task mode) is real money this turn caused — it rides
    // the SAME figure the four sinks read. No `result` frame (stopped early) still books it: the classifier ran.
    const extra = Math.round((Number(this.extraCostUsd) || 0) * 1e6) / 1e6;
    const costUsd = summary.costUsd == null ? (extra > 0 ? extra : null) : Math.round((summary.costUsd + extra) * 1e6) / 1e6;
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
    const contexts = await this._mentionedContexts(summary);
    this.status = finalStatus;
    if (summary.reducerErrors) {
      console.warn(`[worca-ask] turn ${this.assistantMessageId}: ${summary.reducerErrors} reducer error(s) absorbed`);
    }
    if (kind === 'error') {
      // `code` lets the panel swap the CLI's raw error for a Sign in… line. Signed
      // out, the CLI may not even say so (`unrecognized_model` on a first-party id),
      // so claude-auth asks `claude auth status` instead of trusting the text.
      // A Codex chat never asks `claude auth status`: its readiness is codexPreflight (code codex-not-ready).
      const signedOut = this.engine === 'claude' ? await d.failedBecauseSignedOut({ message, model: this.model }).catch(() => false) : false;
      // The persisted blocks ride along, mirroring ask-done: the live client
      // must render the same classified notice a reload re-derives — an
      // ask-error frame without them shows the raw message until refresh.
      this._frame({
        type: 'ask-error', message: message || 'unknown error', blocks: summary.blocks,
        ...(errorClass !== undefined ? { errorClass } : {}),
        ...(code ? { code } : signedOut ? { code: CLAUDE_SIGNED_OUT_CODE } : {}),
      });
      this._emit('error', { message: message || 'unknown error' });
    } else {
      this._frame({
        type: 'ask-done', text: summary.text, blocks: summary.blocks, usage: summary.usage,
        costUsd, durationMs: summary.durationMs, model: this.model, status: finalStatus,
        ...(reason ? { reason } : {}), threadTotals, ...(contexts ? { contexts } : {}),
      });
      this._emit('done', { status: finalStatus, reason });
    }
    return { status: finalStatus };
  }

  /** Conversation chips: what this turn's answer linked to and its worca tools touched, resolved by the
   *  server and merged into the thread as source 'chat'. Returns the thread's list for the ask-done frame,
   *  or null (no resolver, a deleted thread, a failure). Cosmetic — a failure is logged, never thrown. */
  async _mentionedContexts(summary) {
    const d = this.deps;
    if (typeof d.resolveMentions !== 'function') return null;
    try {
      const refs = mentionedRefs(summary);
      const entries = refs.length ? await d.resolveMentions(refs) : [];
      return d.store.addThreadContexts(this.threadId, entries) || null;
    } catch (e) {
      console.warn(`[worca-ask] turn ${this.assistantMessageId}: mentioned contexts not recorded: ${e && e.message ? e.message : e}`);
      return null;
    }
  }

  _limitNotice(reason, limitsNow) {
    const text = reason === 'max_budget'
      ? `Stopped: reached the $${limitsNow.maxBudgetUsd} per-turn cap (Settings → Ask Worca)`
      : `Stopped: reached the ${limitsNow.maxTurns}-turn limit (Settings → Ask Worca)`;
    this.reducer.addBlock({ kind: 'notice', text });
    this._persistBlocks();
  }

  /**
   * D14: codex has no --max-turns / --max-budget-usd, so worca watches the stream. Tool calls are counted against
   * askMaxTurns (the call PAST the cap trips it, as the CLI lets the capped turn finish its own last step); each
   * `result` cost is summed against askMaxBudgetUsd (codex reports usage per turn — plans/ask-on-codex-spike.md (e′) —
   * so on Codex the cap is checked when a reply ends). D13 fail-closed: ANY shell item (the adapter names it Bash), any
   * other tool that is not worca's own, or a sub-agent spawn means the lockdown did not hold, and the turn stops as an error.
   */
  _watch(e, limitsNow) {
    if (this._cap || !e || typeof e !== 'object') return;
    if (e.type === 'subagent' && e.event === 'spawn') { this._trip('tool', 'a sub-agent'); return; }
    if (e.type === 'tool' && Array.isArray(e.calls)) {
      if (e.calls.some((c) => c && c.name === 'Bash')) { this._trip('shell'); return; }
      // Any other tool that is not worca's (a native web search, a file edit, …) means the lockdown did not hold either.
      const foreign = e.calls.find((c) => c && !String(c.name || '').startsWith('mcp__'));
      if (foreign) { this._trip('tool', String(foreign.name || 'an unknown tool')); return; }
      if ((e.parentId ?? null) !== null) return;
      this._toolCalls += e.calls.length;
      if (Number.isInteger(limitsNow.maxTurns) && this._toolCalls > limitsNow.maxTurns) this._trip('max_turns');
      return;
    }
    if (e.type === 'result' && Number.isFinite(e.costUsd)) {
      this._spentUsd += e.costUsd;
      this._lastUsage = e.usage ?? null;
      if (limitsNow.maxBudgetUsd != null && this._spentUsd > limitsNow.maxBudgetUsd) this._trip('max_budget');
    }
  }

  _trip(kind, what = null) {
    this._cap = kind;
    this._capWhat = what;
    if (kind === 'max_turns' || kind === 'max_budget') {
      // The same result subtype the Claude CLI reports, so the reducer, the notice and the stored reason are unchanged.
      this.reducer.push({ type: 'result', subtype: kind === 'max_turns' ? 'error_max_turns' : 'error_max_budget_usd', isError: false, text: '',
        ...(this._lastUsage ? { usage: this._lastUsage } : {}), ...(this._spentUsd > 0 ? { costUsd: this._spentUsd } : {}) });
    }
    try { this.abort.abort(); } catch { /* already aborted */ }
  }

  /** The error a fail-closed trip ends the turn with, or null for a cap (a stop, not an error). */
  _trippedMessage() {
    if (this._cap === 'shell') return CODEX_SHELL_TRIPPED_MESSAGE;
    if (this._cap === 'tool') return codexToolTrippedMessage(this._capWhat);
    return null;
  }

  /** A Codex turn starts only with its lockdown, a priced model under a cost cap (D14), a codex that has every lockdown
   *  flag, and a ready codex (§4.6). Returns
   *  the completed result when it refuses, else null. The mock never asks the real binary. */
  async _codexGate(limitsNow) {
    const d = this.deps;
    if (!d.codexLockdown()) return this._complete({ kind: 'error', message: CODEX_NO_LOCKDOWN_MESSAGE });
    if (limitsNow.maxBudgetUsd != null && !d.codexModelPriced(this.model)) {
      return this._complete({ kind: 'error', message: `A per-turn cost cap is set, and ${this.model} has no known price on Codex, so worca cannot keep this turn under it. Pick a priced Codex model, or turn the cap off (Settings › Ask Worca).` });
    }
    if (this.mock) return null;
    const refuse = (refusal) => {
      this.reducer.addBlock({ kind: 'notice', text: `Codex isn't ready: ${refusal}`, href: CODEX_SETUP_DOCS_URL, hrefLabel: 'Codex setup', codexSetup: true });
      return this._complete({ kind: 'error', message: refusal, code: CODEX_NOT_READY_CODE });
    };
    // The lockdown's flags must all exist in this codex (codexAskSupport): a property of the binary, so a relayed turn,
    // which runs the same binary as the person's agent user, is checked too.
    let support = null;
    try { support = await d.codexAskSupport(); } catch (err) { support = { refusal: err?.message || String(err) }; }
    if (support && support.refusal) return refuse(support.refusal);
    // A relayed turn runs codex as the person's agent user, with that user's HOME and sign-in (agent-user.mjs): a check
    // run here would ask about the server user's codex instead. Its sign-in failure surfaces from the turn itself.
    if (this.relay) return null;
    let pf = null;
    // A chat model on its own endpoint needs no codex sign-in, only the binary (codex-endpoint.mjs).
    try { pf = await d.codexPreflight({ signIn: !hasCodexEndpoint(this.model) }); } catch (err) { pf = { warning: err?.message || String(err) }; }
    if (pf && pf.refusal) return refuse(pf.refusal);
    return null;
  }

  async run() {
    if (this.status !== 'created') return { status: this.status };
    this.status = 'running';
    const d = this.deps;
    this._makeReducer();
    // §4.6: a Codex chat names the registry servers it does not get, once per chat (the server decides "once").
    if (this.mcpCodexNote) this.reducer.addBlock({ kind: 'notice', text: CODEX_MCP_NOTE, mcpCodex: true });
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
      // after ANY terminal status of the first turn" stays true. A Codex chat's
      // title is a codex spawn too, so it waits for the gate below.
      if (this.engine !== 'codex') this._kickoffTitle();
      // Native-rules revision: refresh the chat's memory mount for this turn's scope set and hand
      // it to the spawn as --add-dir. A store failure never breaks a turn — the turn carries no
      // memory and says so on the server log (the rules are additive; the chat is unaffected).
      try { this.memoryDir = await d.memoryMount({ projectKey: this.memoryProject?.key ?? null, projectName: this.memoryProject?.name ?? null }); }
      catch (err) {
        this.memoryDir = null;
        console.warn(`[worca-ask] thread ${this.threadId}: memory mount failed (${err?.message || err}) — this turn carries no memory`);
      }
      // Skills registry §4.4: this turn's set skills, one generated plugin per set, under the thread's folder and per
      // message like the mcp json (a deferred event turn starts before this turn's finally runs). A turn stopped before
      // this point (its thread being deleted) writes nothing.
      if (this.skills && !this.abort.signal.aborted) await this._mountSkills();
      const homeBase = process.env.WORCA_HOME?.trim()
        ? pathResolve(process.env.WORCA_HOME)
        : dirname(d.worcaHome());
      mcpConfigPath = join(scratchDir, `mcp-${this.assistantMessageId}.json`);
      // A Codex turn's set skills (#635): this message's mount folder only, read through read_file for this turn only.
      const skillRoot = this.engine === 'codex' && this.skills && this.skillMount ? this._skillBase : null;
      this.relay = d.agentRelay ? d.agentRelay({ threadId: this.threadId, reader: this.reader || null, web: this.web, ...(skillRoot ? { skillRoot } : {}) }) : null;
      // Agent mode never rides the relay: relay mode is agent isolation, where the terminal refuses agent callers.
      this.commands = !this.relay && this.agentMode && d.commandBridge ? d.commandBridge({ threadId: this.threadId }) : null;
      await d.fs.writeFile(
        mcpConfigPath,
        // MCP registry §9.2: the copies ride after `worca` — refs only (`${MCPSECRET_…}`); the values go in spawnEnv.
        JSON.stringify(d.buildMcpConfig({ homeBase, threadId: this.threadId, serverPath: d.serverPath, ...(this.reader ? { reader: this.reader } : {}), ...(this.relay ? { relay: this.relay } : {}), ...(this.web ? { web: this.web } : {}), ...(this.mcp ? { extraServers: this.mcp.servers } : {}), ...(this.commands ? { commands: this.commands } : {}), ...(this.engine === 'codex' ? { engine: 'codex' } : {}), ...(skillRoot ? { skillRoot } : {}) }), null, 2),
        // Never a key value (webKeyVar: the key rides the process env). A relayed turn runs as
        // the person's agent user (agent-pool.mjs), which reads this file through its group: the
        // scratch dir is setgid worca-share (2770), so 0640 reaches the agent users and nobody
        // else. It carries this turn's relay token, which that agent must present anyway.
        { encoding: 'utf8', mode: this.relay ? 0o640 : 0o600 },
      );
      // One 30-minute budget for the whole turn, retry included. The timedOut
      // flag and abort() run in ONE synchronous callback, so R-C always reads
      // the flag set (the awaiting continuation resumes a microtask later);
      // flag-first is kept as defensive style (plugin-shim.mjs:164 precedent).
      timer = d.setTimeout(() => { this.timedOut = true; try { this.abort.abort(); } catch { /* ignore */ } }, d.limits.turnTimeoutMs);
      // D12: read fresh every turn. The pinned project's team policy may start the limits off (team-policy §5).
      const limitsNow = d.askLimits({ projectKey: this.pinnedScope?.projectKey || null });
      if (this.engine === 'codex') {
        out = await this._codexGate(limitsNow);
        // A refused turn never starts codex — not even for the title, which falls back to the prompt's own words.
        if (out) this._titleOffline = true;
        else this._kickoffTitle();
      }
      out = out || await this._attempts(limitsNow, mcpConfigPath, scratchDir);
    } catch (err) {
      // Backstop for a deps failure (mkdir/write) — _attempts itself never throws.
      out = await this._complete({ kind: 'error', message: err?.message || String(err) });
    } finally {
      if (timer != null) d.clearTimeout(timer);
      if (mcpConfigPath) await d.fs.unlink(mcpConfigPath).catch(() => {});
      if (this._skillBase) { try { await d.removeSkillMount(this._skillBase); } catch { /* best effort: the thread's folder goes with the thread */ } }
      if (this.relay) { try { this.relay.dispose(); } catch { /* already gone */ } this.relay = null; }
      if (this.commands) { try { this.commands.dispose(); } catch { /* already gone */ } this.commands = null; }
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
        for (const text of this._skillsNotices) this.reducer.addBlock({ kind: 'notice', text });
        this.reducer.addBlock({ kind: 'notice', text: 'Context restored from history' });
        this._persistBlocks();
        // The watchdog's counts start over with the fresh codex process, as the Claude CLI's own caps do per process.
        this._toolCalls = 0;
        this._spentUsd = 0;
        this._lastUsage = null;
      }
      // Skills registry §4.4 safety net: this spawn's plain (non-JSON) stdout lines — a refusal printed on stdout reaches
      // onEvent only as a `log` event, never the runner's error (built from stderr). P4's spawnAgent keeps the same 20.
      const said = [];
      const options = buildAskSpawnOptions({
        thread: { id: this.threadId, sessionId: isRetry ? null : this.resumeSessionId }, // B-7: the only no-resume lever
        turn: {
          prompt: isRetry ? this.restoredPrompt : this.prompt,
          // A Codex chat reads its memory rules itself (no --add-dir rules loading, D13); Claude's prompt is unchanged.
          systemPrompt: this.engine === 'codex' ? this.systemPrompt + codexMemoryLine(this.memoryDir) : this.systemPrompt,
          model: this.model,
          effort: this.effort,
          modelEnv: this.engine === 'claude' ? d.resolveModelEnv(this.model) : undefined,   // routing env is Claude's (§4.3)
          ...(this.images.length ? { images: this.images } : {}),
          mock: this.mock, // R-F: markers on EVERY attempt
          signal: this.abort.signal,
          onEvent: (e) => {
            if (e && e.type === 'log' && typeof e.text === 'string' && said.length < 20) said.push(e.text.slice(0, 500));
            // The adapter's own session event; the init frame's copy (`init`) repeats it.
            if (e && e.type === 'session' && !e.init && typeof e.sessionId === 'string' && e.sessionId) {
              // §6.2.4: stored on the thread immediately, not at turn end.
              this.sessionId = e.sessionId;
              try { d.store.updateThread(this.threadId, { sessionId: e.sessionId }); } catch { /* deleted thread */ }
            }
            this.reducer.push(e);
            if (this.engine === 'codex') this._watch(e, limitsNow);   // D13/D14: Claude's caps are the CLI's own
            // §10: the turn's own init only (the normalizer sets mcpServers on a main-stream init only), and only with
            // a list — an init without one says nothing (never "absent"). After the push, so a failing note can never
            // cost the reducer its init.
            if (this.mcp && e && e.type === 'session' && e.init && Array.isArray(e.mcpServers)) {
              try { this._noteMcpInit(e.mcpServers); } catch { /* a muted line never breaks the stream */ }
            }
          },
        },
        limits: limitsNow,
        mcpConfigPath,
        scratchDir,
        memoryDir: this.memoryDir,
        web: this.web,
        relayed: !!this.relay,
        registry: this.mcp,   // MCP registry §9.2: EVERY attempt, the resume-fallback retry included
        ...(this.engine === 'codex' ? { engine: 'codex' } : {}),
        commands: this.commands,
        // Skills registry §4.4: every attempt too, until the sideload safety net drops the layer.
        skills: this.skills && this.skillMount ? { pluginDirs: this.skillMount.pluginDirs, names: this.skillNames } : null,
      });
      // With the relay, the chat's claude runs as the person's agent user (agent-pool.mjs).
      if (this.relay) options.asAgent = true;
      try {
        await d.runClaudeImpl(options);
        // Resolve path. Future-proofing: if a later CLI exits 0 on a limit,
        // the reducer still computed status/reason from the result subtype.
        await this._settle();
        if (this._trippedMessage()) return await this._complete({ kind: 'error', message: this._trippedMessage() });
        const s = this.reducer.snapshot();
        if (/max_turns|max_budget/.test(s.resultSubtype ?? '')) this._limitNotice(s.reason, limitsNow);
        return await this._complete({ kind: 'done', status: s.reason ? 'stopped' : 'done', reason: s.reason ?? null });
      } catch (err) {
        const s = this.reducer.snapshot();
        // R-C, literal order. (1) The abort branch FIRST — B-4: a pre-aborted
        // runClaude throws before any init, so this must precede the resume test.
        if (err?.name === 'AbortError' && this._cap) {
          // The watchdog aborted (Codex only): a cap is a stop with the limit notice, a shell item an error.
          if (this._trippedMessage()) return await this._complete({ kind: 'error', message: this._trippedMessage() });
          this._limitNotice(this._cap, limitsNow);
          return await this._complete({ kind: 'done', status: 'stopped', reason: this._cap });
        }
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
        // (2b) Skills registry §4.4 safety net: a Claude Code that refuses --plugin-dir (managed disableSideloadFlags the
        // host check could not read, or a CLI without the flag) fails before any init — said in the runner's error
        // (stderr), the reducer's errors or a plain stdout line (`said`). The same attempt runs again without the set
        // skills — same prompt, same --resume (the session was never reached). Before (3), which would otherwise spend
        // the one retry on a dead-session guess and fail again on the same flag.
        if (!isRetry && options.pluginDirs && !s.sawInit && SIDELOAD_REFUSED_RE.test([err?.message || '', ...(s.errors || []), ...said].join('\n'))) {
          this.skills = null;
          if (this._promptWithoutSkills !== null) this.systemPrompt = this._promptWithoutSkills;   // no skills, no section
          this._skillsNotices = [SKILLS_REFUSED_NOTICE];   // no skill of this turn loads: a partial-copy notice would say less
          this._makeReducer();   // the refused spawn's events (a result, its errors, its cost) never reach the re-run
          for (const text of this._skillsNotices) this.reducer.addBlock({ kind: 'notice', text });
          this._persistBlocks();
          attempt -= 1;   // the loop's += 1 repeats this attempt
          continue;
        }
        // (3) The narrow resume-fallback predicate (F9): only a session that
        // never produced an init or said "No conversation found".
        if (!isRetry && this.resumeSessionId
          && (!s.sawInit || s.errors.some((m) => /No conversation found/.test(m))
            || (this.engine === 'codex' && codexResumeNotFound(err)))) {   // §4.6: codex's own "no rollout found"
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
      .then(() => (this._titleOffline ? '' : d.generateTitle(this.firstText, {
        cwd: this.scratchDir || join(d.worcaHome(), 'tmp', 'ask'),
        tools: [], strictMcpConfig: true, settingSources: ['project'],
        disableSlashCommands: true, envScrub: true, envAllowlist: [],
        permissionMode: 'dontAsk',
        // The chat's own model is the title default (#422) — a chat on a
        // custom endpoint titles itself there, not on a first-party Haiku.
        runModel: this.model,
        // §4.6: a Codex chat titles itself on Codex, read-only (D11), with the Ask slot's model or the chat's own.
        ...(this.engine === 'codex' ? { engine: 'codex', model: d.askSlot('codex')?.model || this.model } : {}),
        onError: ({ model, error }) => console.warn(
          `[worca-ask] thread ${this.threadId}: title generation failed (${model ? `model ${model}` : 'the CLI default model'}): ${error?.message || error} — keeping the fallback title`),
      })))
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
