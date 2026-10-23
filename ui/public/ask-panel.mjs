// ui/public/ask-panel.mjs — the Chat page (worca Chat P1; once the Ask Worca floating sheet, spec §10). One
// factory, everything in the closure: the module is evaluated once per test
// file even though app.js is re-imported with a cache-buster, so module scope
// holds no state. All markup is built with DOM APIs and textContent — no
// innerHTML for content anywhere in this file (the markdown renderer owns the
// only sanitized-HTML path).
import { openScheduleSheet, browserTimeZone } from './schedule-sheet.mjs';
import { chooseSyncRefusal, sourceRefNote } from './branch-sync.mjs';
import { formatInstant, describeRule } from '../../src/shared/schedule/recurrence.mjs';
import { createThreadModel } from './ask-model.mjs';
import { credentialBadge } from './credential-badges.mjs';
import { createMarkdownRenderer } from './ask-markdown.mjs';
import { createRefChips } from './ask-ref-chips.mjs';
import { createDotOrbs, turnPhase } from './dot-orb.mjs';
import { workflowPickerLabel } from './results-view.mjs';
import { renderAutoProposal, AUTO_PROPOSAL_ORDER_CARD } from './auto-proposal.mjs';
import { createRunProgressCard, snapshotFromState, PROGRESS_CARD_TYPE } from './ask-run-card.mjs';
import { createCommandCard, COMMAND_CARD_TYPE } from './ask-command-card.mjs';
import { buildTrace, scheduleTrace, playAssembly } from './auto-build.mjs';
import { buildNodeConfigRows, pruneNodeSelection, modifiedFieldsOf, healForEngine } from './node-tunables.mjs';
import { ENGINE_EFFORTS } from './engine-settings-view.mjs';
import { ENGINE_NAMES, engineLabel, isBetaEngine } from '../../src/shared/engine-switch.mjs';
import { lockEngineOptions } from './engine-locks.mjs';
import { runsOn, modelGroups } from '../../src/shared/connections.mjs';
import { appendModelGroups, modelOptionText } from './model-options.mjs';
import { classifyLoops } from '../../src/shared/graph/loops.mjs';
import { portsFnFor } from '../../src/shared/graph/ports.mjs';
import { parseMcpToolName } from '../../src/shared/mcp-tool-name.mjs';
import { mcpSkipView, mcpCopyNote, skillSkipView } from './mcp-run-picker.mjs';
import { engineOfEntry, chatEngineOf, pickerGroups, ASK_CHAT_ENGINES } from './ask-engine.mjs';
import { formatQuotedMessage, parseQuotedMessage } from './pinpoint-model.mjs';
import { ATTACH_ACCEPT, ATTACH_MAX_MESSAGE_BYTES, bytesToBase64 as attachBase64, carriesFiles, checkAttachment, createPasteNamer, pastedFiles } from './attach-files.mjs';
import { notify } from './feedback.mjs';
import { currentLevel, levelShows } from './ui-level.mjs';
import { chatCardBuilder, composerAddons } from './chat/extensions.mjs';
import { flagOn } from './flags.mjs';
import { gitOn } from './git-gate.mjs';
import { NO_PROJECT_KEY, NO_PROJECT_NAME, NEEDS_REPO_NOTE } from '../../src/shared/no-project.mjs';
import { createTagInput, fetchTagVocabulary, createTagRulesLine } from './tag-input.mjs';
import { shapeFirstOn } from './chat/shape-gate.mjs';
import { INTENTS, splitIntentLead } from './chat/intent.mjs';
import { homeIcon } from './chat/home-icons.mjs';
import { NO_PROJECT_LABEL, scopeFromContext, scopeKind, scopeIcon, kindChip, projectKind } from './chat/scope-ui.mjs';
import { icon } from './icons.mjs';
import { makeSwitch } from './switch.mjs';
import { shapeCardExtras, shapeWhatHappens, shapeAdvancedSummary } from './shape/proposal.mjs';
import { createAskComposerCards, ASK_COMPOSER_CARD_TYPES } from './ask-composer-cards.mjs';
import { applyPresetStart } from '../../src/shared/run-presets.mjs';
import {
  fmtTokens, CTX_COMPACT_BUFFER, CTX_WARN, CTX_HIGH, CTX_COST_HINT, kTok,
  fmtWindow, ctxTrigger, ctxLevel, ctxPercent, fmtCtx, ctxTitle, fmtShare, ctxBreakdown, fmtUsd,
} from './ask-meter.mjs';
export {
  fmtTokens, CTX_COMPACT_BUFFER, CTX_WARN, CTX_HIGH, CTX_COST_HINT,
  fmtWindow, ctxTrigger, ctxLevel, ctxPercent, fmtCtx, ctxTitle, fmtShare, ctxBreakdown, fmtUsd,
} from './ask-meter.mjs';

/**
 * Cold-start pick, used ONLY until GET /api/ask/models resolves — and afterwards
 * only if that payload carries no `default` (older stubs / a 500). The authoritative
 * default is ASK_LIMITS.defaultModel/defaultEffort, shipped as `catalog.default`
 * and already validated against the live catalog by src/core/ask/models.mjs.
 */
const FALLBACK_PICK = Object.freeze({ model: 'claude-opus-5-5', effort: 'high' });
/** The composer's resting placeholder; an add-on's setPlaceholder(null) comes back to it (worca Chat CONTRACT §2). */
const INPUT_PLACEHOLDER = 'Ask about any run, agent, or project…';
const QUEUE_MAX = 3;            // messages a chat may stack while a reply runs (client-side: the server runs one turn per chat)

const ICONS = {
  plus: 'M12 5v14M5 12h14',
  chevronDown: 'M6 9l6 6 6-6',
  send: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  mic: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z', 'M19 11a7 7 0 0 1-14 0', 'M12 18v3'],
  voiceTalk: ['M7.9 20A9 9 0 1 0 4 16.1L2 22z', 'M8 10h8M8 14h5'],           // chat bubble with text lines: speak in, read the reply
  voiceHandsFree: ['M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4'],               // waveform: a live conversation
  pencil: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  check: 'M5 13l4 4L19 7',
  pin: ['M12 17v5', 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'],
  search: ['M5 11a6 6 0 1 0 12 0a6 6 0 1 0-12 0', 'M20 20l-4.5-4.5'],    // the Workflows Library's search glyph
};
// One icon per voice mode; the mic button and the ▾ menu both draw from this.
const VOICE_MODE_ICONS = { dictate: ICONS.mic, talk: ICONS.voiceTalk, handsfree: ICONS.voiceHandsFree };

/** A context chip's in-app route, or null when it has none (a run with no known home). */
function contextHref(c) {
  const e = encodeURIComponent;
  if (c.kind === 'project') return `#projects/${e(c.id)}`;
  if (c.kind === 'workspace') return `#workspaces/${e(c.id)}`;
  if (c.kind === 'page') return `#${e(c.id)}`;
  if (c.kind === 'run' && typeof c.home === 'string' && c.home) return `#history/${c.home.split('/').map(e).join('/')}/${e(c.id)}`;
  return null;
}

const validContexts = (list) => (Array.isArray(list) ? list : [])
  .filter((c) => c && typeof c.kind === 'string' && typeof c.id === 'string' && c.id);
/** A chat's topics split for the popover: where it was asked from (page) and what it mentioned (source 'chat'). */
export function groupContexts(list) {
  const all = validContexts(list);
  return { asked: all.filter((c) => c.source !== 'chat'), mentioned: all.filter((c) => c.source === 'chat') };
}
export function fmtAgents(n) {
  return Number.isFinite(n) && n > 0 ? `${n} agent${n === 1 ? '' : 's'}` : null;
}

/** When a chat was started: relative while it is recent, a short absolute date
 *  once it is older than a month. Mirrors plugins-view.mjs relTime's thresholds,
 *  but returns null — not the raw input — for a missing or unparsable stamp, so
 *  renderThreadRows skips the date element and the row shows nothing rather than
 *  "Invalid Date". Pure; callers pass the injected now() to stay jsdom-safe. */
export function fmtStarted(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d}d ago`;
  return String(iso).slice(0, 10);
}

export function fmtElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
}
function mmss(ms) {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
/** A tool row's args: the persisted input as JSON, or the preview of one the server clipped (events.mjs clipJson caps
 *  both at limits.blockIoMaxChars). Never cut here: the row's CSS clamps it to two lines and the hover holds it all. */
function toolArgs(input) {
  if (input && input._truncated === true) return String(input.preview ?? '');
  if (input == null) return '';
  try { return JSON.stringify(input); } catch { return String(input); }
}

const SCRIPT_TOOL_NAMES = new Set(['list_scripts', 'get_script', 'save_script', 'test_script']);

/**
 * The script tools' thread line (scripts-workbench-design.md §9.3): the key instead of a JSON
 * blob, plus what came back once the call finished. `block.script` is stamped by the reducer
 * (events.mjs#scriptToolKey at the call, #scriptResultNote at the result) and persisted with the
 * block, so the line survives a reload and a clipped input. The row already names the tool (test_script), so
 * this is its args: the key and the outcome. null for every other tool — those show their input.
 * @returns {{target: string}|null}  e.g. { target: 'runTests → blocking, exit 1' }
 */
export function scriptToolLine(short, block = {}) {
  if (!SCRIPT_TOOL_NAMES.has(short)) return null;
  const s = block.script && typeof block.script === 'object' ? block.script : null;
  const key = typeof s?.key === 'string' && s.key ? s.key
    : (block.input && typeof block.input.key === 'string' ? block.input.key : '');
  const bits = [];
  if (s) {
    if (typeof s.saved === 'string' && s.saved) bits.push(s.saved);
    if (typeof s.status === 'string' && s.status) bits.push(s.status);
    if (Number.isInteger(s.exitCode)) bits.push(`exit ${s.exitCode}`);
  }
  return { target: [key, bits.length ? `→ ${bits.join(', ')}` : ''].filter(Boolean).join(' ') };
}

/**
 * Where the chip picker's panel sits inside the sheet (sheet-relative px, from
 * sheet-relative chip edges). Every other .ask-pop is CSS-anchored (the header
 * corner, or the composer box's inset — style.css --ask-col-inset); a band chip
 * sits wherever the transcript scrolled it, and .ask-sheet
 * clips (overflow:hidden), so a downward-only anchor chops the menu's Effort row
 * off with no way to reach it. Prefer the space under the chip, flip above it
 * when the menu would not fit, and clamp into the sheet when neither side has
 * room — .ask-pop-chip's own max-height/overflow-y makes the rest reachable.
 * A sheetH of 0 (jsdom measures nothing) skips the clamp: no fake geometry.
 */
export function chipPickerTop({ top, bottom, panelH, sheetH, gap = 6 }) {
  const below = bottom + gap;
  const above = top - gap - panelH;
  let t = (below + panelH <= sheetH - gap) || above < gap ? below : above;
  if (sheetH > 0 && t + panelH > sheetH - gap) t = sheetH - panelH - gap;
  return Math.max(0, t);
}

/** Out-of-turn / other-thread frames that can move a History row's dots: a run a
 *  chat follows changed (tracking) or a turn started/ended there (thinking). */
// worca Chat: a followed run's question notice (ask-message) can turn a dot amber; a new title renames a row.
const THREADS_REFRESH_FRAMES = new Set(['ask-run-status', 'ask-start', 'ask-done', 'ask-error', 'ask-message', 'ask-title']);
const THREADS_REFRESH_MS = 250;
/** The History column (worca Chat P1): the user's open/closed choice, the width it starts open from, and the width
 *  below which it is an overlay with a scrim (style.css @media (max-width:1099px)). */
const HISTORY_KEY = 'worca-cc.chat.history';
const HISTORY_OPEN_MIN_W = 1600;
const HISTORY_OVERLAY_BELOW = 1100;
const HISTORY_GROUPS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['earlier', 'Earlier']];
/** The column's search waits this long after the last keystroke before it asks the server. */
const HISTORY_SEARCH_MS = 200;

export function createAskPanel({ doc, win, fetch, sendWs, confirm, getPageContext, openNewPipeline, openComposer = null, showTerminal = () => {}, openClaudeSetup = null, loadMarkdown, hljsLoader, storage, raf, now, runStore = null, createVoice = null, voiceLongPressMs = 500, chatDeps = null, onRoute = null, onUnread = null, composerActions = null }) {
  const homePick = browserPick();         // hoisted declaration (defined below)
  const st = {
    open: false,
    threadId: null,
    model: null,              // createThreadModel for the active thread (Task 4+)
    picker: homePick.picker,
    // D11 provenance, tracked per slot: only a MODEL the user actually picked
    // outranks the backend default. An effort-only record leaves the model slot
    // unclaimed, so a later change to ASK_LIMITS.defaultModel still reaches here.
    pickerFromStore: homePick.pickerFromStore,
    effortFromStore: homePick.effortFromStore,
    // The picker shows the open thread's own last pick (its row's model/effort).
    // It outranks the backend default like a stored pick, but it is the chat's,
    // not the browser's: nothing sourced from a thread reaches worca-cc.ask.model.
    pickerFromThread: false,
    // The model was chosen in the picker during this chat (setPickerModel): it outranks the Ask-engine default
    // that a stored pick yields to. Cleared whenever the picker is re-seeded from the browser or a thread.
    pickerExplicit: false,
    catalog: null,
    // #397: the thread's project/workspace scope. pinned:false = No project: no page target rides along (CONTRACT §4).
    // label caches the display name once resolved.
    scope: { pinned: false, projectKey: null, workspaceId: null, label: null },
    scopeHeld: null,          // S39: the thread id whose scope PATCH a running reply refused; the next send carries it
    popover: null,           // {panel, trigger, onClose, build, refreshOn, refresh}
    contexts: [],             // the open chat's topics (thread.contexts), shown in the context popover
    threadsRefresh: null,     // the debounce timer behind the History popover's ask-run-status refetch
    expandedAgents: new Set(),
    expandedActivity: new Set(), // assistant message ids whose activity body (tool rows, sub-agents) the user opened
    worktrees: [],            // P4 §10: the chat's open worktrees (snapshot-fed)
    // MCP registry §9.4: the chat's picker choices (held here, sent with every message, PATCHed between turns),
    // the last POST /api/ask/mcp-preview body and whether it failed; gen drops a stale response, render repaints
    // an open picker, saving chains the PATCHes so they land in toggle order.
    mcp: { off: { sets: [], members: [] }, preview: null, failed: false, gen: 0, queued: false, render: null, saving: Promise.resolve() },
    commands: new Map(),      // blockId → command card handle (ask-command-card.mjs)
    commandFrames: new Map(), // blockId → the last ask-command view that arrived before its card was built
    commandsOpen: new Set(),  // blockIds whose output the user unfolded (the card's toggle; outlives a rebuild of the card)
    pinned: true,
    wantThread: undefined,    // the chat the page shows or is loading: an id, null = home (a new chat), undefined = none yet
    unread: false,            // what onUnread was last told (the Chat row's dot)
    historyStale: true,       // the History rows need a fetch at the next show (a refresh frame landed while hidden)
    historyLoaded: false,     // rows (or the empty line) have been painted once
    historyGen: 0,            // drops a stale list response
    historyAsPush: false,     // the column was opened as a push column: narrowing the window below 1100px closes it
    historySearchOpen: false, // the column's search field is unfolded (the head's .is-searching)
    historyQuery: '',         // the search field's text; loadHistory sends it trimmed as ?q=
    historyListQuery: '',     // the trimmed query the last list request carried ('' = the full list, null = it failed)
    historySearchTimer: null, // the typing debounce (HISTORY_SEARCH_MS)
    unreadThread: null,       // the chat whose reply lit the dot — the most recent one (app.js opens it from the Chat row)
    askedIn: new Set(),       // chats this tab sent a message in: only their replies (and the open chat's) light the dot
    pendingFiles: [],
    quote: null,          // Pinpoint (#669): {text, src?, code?} sent above the next message as a blockquote
    sending: false,
    subscribedFor: null,
    elapsedTimer: null,
    elapsedStart: null,
    flushArmed: false,
    resyncing: false,
    firstOpenDone: false,
    destroyed: false,
    voice: null,              // the voice controller (ask-voice.mjs), made on first mic use — docs/speech.md
    voiceLongPress: null,     // the mic's long-press timer
    voiceSwallowClick: false, // the click that ends a long-press must not also start dictation
    lastAnswerRender: 0,
    rowEls: null,
    seenRows: new Set(),      // message ids the transcript has already shown — see renderTranscript
    cardEls: null,
    cardOptions: null,
    catalogLoading: null,
    mdKicked: false,
    answerPending: null,
    rowPending: null,
    progress: null,           // Map<cardId, {ident, handle, rest, hydrating, nextHydrateAt}> — the live run cards
    runTick: null,
    runUnsub: null,
    runPoked: false,
    addons: [],               // worca Chat CONTRACT §2: the mounted composer add-ons, [{ id, handle }] in registration order
    queues: new Map(),        // threadId → {items:[{key,text,quote,files}], paused, draining}: messages sent while a reply ran
    queueEdit: null,          // {id, item, li, ta}: the queued card whose text is being edited in place (one at a time)
    stopBy: null,             // who asked the live turn to stop: 'button' pauses the queue, 'voice' (barge-in) lets it send
    hist: { idx: -1, draft: '' },   // ArrowUp history walk: idx into historyEntries(), -1 = not walking; the draft it replaced
    basePlaceholder: INPUT_PLACEHOLDER,   // the add-ons' placeholder (addonCtx.setPlaceholder); a suggestion shows only over the default
    suggestion: null,         // the suggestion on screen ({messageId, text}) — what Tab accepts
    suggestDismissed: null,   // the reply id whose suggestion the user typed over (or accepted): never shown again
  };
  const el = {}; // element refs, filled by the builders
  const renderer = createMarkdownRenderer({ doc, load: loadMarkdown, hljsLoader });
  // Answer chips (ask-ref-chips.mjs): the PRs, issues, work items, runs and chats an answer names. The run chips follow
  // the run store like the run cards; lookups go out once an answer is done (renderAnswerPiece).
  const refChips = createRefChips({ doc, fetch, runStore, now, root: () => el.transcript || null, visible: () => st.open });
  const orbs = createDotOrbs({ doc, win });   // the live turn's orb (ensureThinking), the Workflows chat's dot sphere

  // ---- storage --------------------------------------------------------------
  /**
   * The stored pick, or null when nothing usable is stored. `model` is null for an
   * EFFORT-ONLY record — the user moved the effort while the model was still the
   * backend default, so there is no model choice to honour (D11). `effort` is always
   * a string. A legacy record (always `{model,effort}`) reads back unchanged.
   */
  function readStoredModel() {
    try {
      const raw = storage.getItem('worca-cc.ask.model');
      const v = raw ? JSON.parse(raw) : null;
      if (v && typeof v.effort === 'string') {
        return { model: typeof v.model === 'string' && v.model ? v.model : null, effort: v.effort };
      }
    } catch { /* storage unavailable */ }
    return null;                                    // no stored pick — the catalog decides (D5/D6/D11)
  }
  /** The browser-level pick — what a new chat starts with: the stored record over the cold-start literal, with each slot's provenance. */
  function browserPick() {
    const stored = readStoredModel();
    return {
      picker: {
        model: stored && stored.model ? stored.model : FALLBACK_PICK.model,
        effort: stored ? stored.effort : FALLBACK_PICK.effort,
      },
      pickerFromStore: !!(stored && stored.model),
      effortFromStore: stored !== null,
    };
  }
  function storeModel() {
    // Provenance travels with the record: writing st.picker.model when the user never
    // chose one would pin the cold-start literal (or a default they merely saw), and
    // the backend would be authoritative exactly once per browser. A thread's model
    // is not the user's browser-level choice either: an effort picked on it leaves
    // the record's model slot as it was.
    const model = st.pickerFromThread
      ? (readStoredModel() || { model: null }).model
      : (st.pickerFromStore ? st.picker.model : null);
    if (st.storeOtherEngine && !st.pickerFromStore) return;   // the stored pair is the other engine's: kept whole
    const rec = { model, effort: st.picker.effort };
    try { storage.setItem('worca-cc.ask.model', JSON.stringify(rec)); } catch { /* ignore */ }
  }
  function readStoredThread() { try { return storage.getItem('worca-cc.ask.thread') || null; } catch { return null; } }
  function storeThread(id) {
    try {
      if (id) storage.setItem('worca-cc.ask.thread', id);
      else storage.removeItem('worca-cc.ask.thread');
    } catch { /* ignore */ }
  }

  /**
   * Size the composer textarea to its content, one line minimum, 120px maximum.
   * Bound to the input event; every programmatic write to el.input.value (the
   * post-send clear, appendToComposer) must call it too, since assignment
   * fires no input event and the box would keep the previous draft's height.
   */
  function fitInput() {
    el.input.style.height = 'auto';
    el.input.style.height = `${Math.min(el.input.scrollHeight || 0, 120)}px`;
  }

  // ---- tiny DOM helpers -----------------------------------------------------
  /** The ✓ beside the current pick in a menu: a stroke icon, not a character (spec §1.3). */
  function checkMark() {
    const n = make('span', 'ask-model-check');
    n.append(icon(doc, 'check', 12));
    return n;
  }
  function make(tag, className, text) {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }
  /** The context ring: a track and an arc on a 100-unit path, so stroke-dasharray "<fill%> 100" draws the fill. */
  function ctxRing() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    for (const cls of ['ask-ctx-ring-track', 'ask-ctx-ring-arc']) {
      const c = doc.createElementNS(NS, 'circle');
      c.setAttribute('class', cls);
      c.setAttribute('cx', '8');
      c.setAttribute('cy', '8');
      c.setAttribute('r', '6');
      c.setAttribute('stroke-width', '2.5');
      svg.appendChild(c);
    }
    el.ctxArc = svg.lastChild;
    el.ctxArc.setAttribute('pathLength', '100');
    el.ctxArc.setAttribute('transform', 'rotate(-90 8 8)');   // the fill starts at 12 o'clock
    el.ctxArc.setAttribute('stroke-dasharray', '0 100');
    return svg;
  }

  function svgIcon(d, size = 17, sw = 1.9) {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(sw));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const part of Array.isArray(d) ? d : [d]) {
      const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', part);
      svg.appendChild(path);
    }
    return svg;
  }
  function iconButton(className, title, icon, onClick) {
    const b = make('button', className);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.appendChild(icon && icon.nodeType ? icon : svgIcon(icon));
    b.addEventListener('click', onClick);
    return b;
  }
  /** "+ New chat" — the head's and the History column's: a labelled ghost button (style.css .chat-new-btn). Both carry
   *  [data-ask-new-btn], which the add-ons' capture-phase listeners read (chat/home-flip.mjs arms the glide,
   *  chat/intent.mjs drops the intent). Below 1100px the overlay closes first, as after a pick, so the new chat has its
   *  room and newThread() can focus its composer. */
  function newChatButton(className) {
    const b = make('button', `btn btn-sm btn-quiet chat-new-btn ${className}`);
    b.type = 'button';
    b.setAttribute('data-ask-new-btn', '');
    b.appendChild(svgIcon(ICONS.plus, 14, 2));
    b.appendChild(make('span', null, 'New chat'));
    b.addEventListener('click', () => {
      if (historyOverlayOpen()) setHistoryOpen(false, { persist: false });
      newThread();
      route(null);
    });
    return b;
  }
  /** The History toggle's glyph: a page with a folded corner and lines of text (the saved chats). */
  function historyIcon() {
    return svgIcon(['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v4a1 1 0 0 0 1 1h4',
      'M9 9h2', 'M9 13h6', 'M9 17h6'], 20, 1.5);
  }

  // ---- shell: the Chat page (worca Chat P1, CONTRACT §1) ---------------------
  // div.chat-page = the history column · its overlay scrim · the conversation column (head · home with the hero
  // slot · transcript · dock) · the run panel slot P4 fills. The composer is ONE element that syncView() moves
  // between the hero slot (home) and the dock (thread).
  function buildRoot() {
    const page = make('div', 'chat-page');
    page.setAttribute('data-chat-page', '');
    page.dataset.view = 'home';
    page.dataset.panel = 'closed';
    st.historyAsPush = initialHistoryOpen();          // never below 1100px: there a load starts closed
    page.dataset.history = st.historyAsPush ? 'open' : 'closed';

    el.history = buildHistory();
    page.appendChild(el.history);
    el.scrim = make('div', 'chat-scrim');
    el.scrim.setAttribute('data-chat-scrim', '');
    el.scrim.hidden = true;
    el.scrim.addEventListener('click', () => {
      setHistoryOpen(false, { persist: false });
      try { el.historyBtn.focus(); } catch { /* detached */ }   // as Escape does
    });
    page.appendChild(el.scrim);

    const convo = make('div', 'chat-convo');
    const head = make('header', 'chat-head');
    const threadsBtn = iconButton('btn btn-quiet btn-icon chat-head-btn chat-history-toggle', 'History', historyIcon(), () => toggleHistory());
    threadsBtn.setAttribute('data-ask-threads-btn', '');
    threadsBtn.setAttribute('aria-controls', 'chat-history');
    el.historyBtn = threadsBtn;
    head.appendChild(threadsBtn);
    el.title = make('div', 'ask-title', 'New chat');
    head.appendChild(el.title);
    head.appendChild(make('span', 'chat-head-spacer'));
    head.appendChild(newChatButton('chat-head-btn'));
    convo.appendChild(head);

    el.home = make('div', 'chat-home');
    el.home.setAttribute('data-chat-home', '');
    el.heroSlot = make('div', 'chat-hero-slot');
    el.heroSlot.setAttribute('data-chat-hero-slot', '');
    el.home.appendChild(el.heroSlot);
    convo.appendChild(el.home);

    el.transcript = make('div', 'ask-transcript');
    el.transcript.setAttribute('data-ask-scroll', '');
    el.transcript.addEventListener('scroll', updatePinFromScroll);
    // The transcript is only the scrollport; every row lands in this column, which style.css caps
    // (--ask-col-max) and centres. Scroll/pin logic keeps reading el.transcript.
    el.transcriptCol = make('div', 'ask-transcript-col');
    el.transcript.appendChild(el.transcriptCol);
    convo.appendChild(el.transcript);

    el.chatDock = make('div', 'chat-dock');
    el.chatDock.setAttribute('data-chat-dock', '');
    convo.appendChild(el.chatDock);
    el.composer = buildComposer();
    el.heroSlot.appendChild(el.composer);              // a new chat starts on home; syncView() moves it

    el.live = make('div', 'sr-only');
    el.live.setAttribute('aria-live', 'polite');
    convo.appendChild(el.live);

    el.jump = make('button', 'ask-jump');
    el.jump.type = 'button';
    el.jump.appendChild(svgIcon(ICONS.down, 12, 2.2));
    el.jump.appendChild(make('span', null, 'Jump to latest'));
    el.jump.hidden = true;
    el.jump.addEventListener('click', jumpToLatest);
    el.chatDock.appendChild(el.jump);                  // rides the dock's top edge, however tall the draft grows (style.css)
    convo.appendChild(buildDropTarget(convo));
    page.appendChild(convo);

    el.panelSlot = make('aside', 'chat-panel');
    el.panelSlot.setAttribute('data-chat-panel', '');
    el.panelSlot.hidden = true;
    page.appendChild(el.panelSlot);

    el.sheet = convo;         // the popover host outside the composer — the floating sheet's role, its name kept
    el.page = page;
    paintHistory();
    return page;
  }

  // The type tables, caps and early checks (#398, D16) live in attach-files.mjs, shared with the Workflows chat
  // dock. The server re-validates everything; these are just early clear messages. The run card's extras use this too.
  function bytesToBase64(bytes) { return attachBase64(bytes, (s) => win.btoa(s)); }

  function setComposerMsg(text) {
    el.composerMsg.textContent = text || '';
    el.composerMsg.hidden = !text;
  }

  function renderChips() {
    el.chips.replaceChildren();
    el.chips.hidden = !st.pendingFiles.length && !st.quote;
    if (st.quote) el.chips.appendChild(buildQuoteChip(st.quote));
    for (const f of st.pendingFiles) {
      const chip = make('span', 'ask-chip');
      if (f.attKind === 'image' && f.dataBase64) {
        // #398: composer thumbnail straight from the bytes just read — no
        // object-URL lifecycle to manage, the chip owns its data URI.
        const img = doc.createElement('img');
        img.className = 'ask-chip-thumb';
        img.alt = f.name;
        img.src = `data:${f.mime};base64,${f.dataBase64}`;
        chip.appendChild(img);
      }
      chip.appendChild(make('span', 'ask-chip-name', f.name));
      const x = make('button', 'ask-chip-x');
      x.append(icon(doc, 'x', 12));
      x.type = 'button';
      x.setAttribute('aria-label', `Remove ${f.name}`);
      x.addEventListener('click', () => {
        st.pendingFiles = st.pendingFiles.filter((p) => p !== f);
        renderChips();
      });
      chip.appendChild(x);
      el.chips.appendChild(chip);
    }
  }

  /** Pinpoint (#669): the quote the next message carries — a card above the attachments, removable. */
  function buildQuoteChip(q) {
    const chip = make('div', 'ask-chip ask-chip-quote');
    chip.setAttribute('role', 'group');
    chip.setAttribute('aria-label', 'Quoted text');
    const m = make('div', 'ask-chip-quote-m');
    m.append(make('div', 'ask-chip-quote-k', q.src ? `From ${q.src}` : 'Quoting'), make('div', `ask-chip-quote-t${q.code ? ' mono' : ''}`, q.text));
    const x = make('button', 'ask-chip-x');
    x.append(icon(doc, 'x', 12));
    x.type = 'button';
    x.setAttribute('aria-label', 'Remove quote');
    x.addEventListener('click', () => { setQuote(null); focusComposer(); });
    chip.append(m, x);
    return chip;
  }

  /** Set (or clear, with null) the quote the next message carries. */
  function setQuote(q) {
    if (st.destroyed) return false;
    const text = q && typeof q.text === 'string' ? q.text.trim() : '';
    st.quote = text ? { text, ...(q.src ? { src: String(q.src) } : {}), ...(q.code ? { code: true } : {}) } : null;
    renderChips();
    return !!st.quote;
  }

  /**
   * Pinpoint's chat actions (Disagree, Use this, Go deeper): quote `quote` and send `text` at once. A draft already in
   * the composer is never sent along — the quote and the text are added to it instead and wait for the user.
   */
  function sendQuoted({ quote, text }) {
    const add = String(text ?? '').trim();
    if (!add || st.destroyed) return false;
    setQuote(quote);
    if (el.input.value.trim() || (st.model && st.model.live())) { appendToComposer(add); return false; }
    el.input.value = add;
    fitInput();
    Promise.resolve().then(() => sendMessage()).catch(() => false).then((ok) => { if (!ok) focusComposer(); });
    return true;
  }

  async function addFiles(fileList) {
    for (const f of [...(fileList || [])]) {
      // Type, D16 (a Codex chat refuses PDFs), size, count, message total — in that order, with those messages.
      const v = checkAttachment(f, { pending: st.pendingFiles, engine: pickerEngine() });
      if (!v.ok) { setComposerMsg(v.error); continue; }
      let dataBase64 = '';
      try {
        dataBase64 = bytesToBase64(new Uint8Array(await f.arrayBuffer()));
      } catch { setComposerMsg(`could not read ${v.name}`); continue; }
      st.pendingFiles = [...v.others, { name: v.name, bytes: f.size, dataBase64, attKind: v.attKind, mime: v.mime }];
    }
    renderChips();
  }

  // Drag-and-drop and paste feed the same addFiles() as the "+" button: no
  // validation of their own. Only drags that carry files are touched (carriesFiles,
  // attach-files.mjs), so text and element drags (widgets-input.mjs list reordering) keep their defaults.

  /**
   * The whole sheet is the drop target. dragenter/dragleave fire on every child
   * crossed (enter on the new child lands before leave on the old one), so a
   * depth counter — not the event target — decides when the pointer really left;
   * drop and dragend reset it outright.
   */
  function buildDropTarget(sheet) {
    const overlay = make('div', 'ask-drop');
    overlay.setAttribute('data-ask-drop', '');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.hidden = true;
    overlay.appendChild(make('span', 'ask-drop-label', 'Drop files to attach'));
    let depth = 0;
    const show = (on) => { overlay.hidden = !on; };
    const reset = () => { depth = 0; show(false); };
    sheet.addEventListener('dragenter', (e) => {
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      depth += 1;
      show(true);
    });
    sheet.addEventListener('dragover', (e) => {
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    sheet.addEventListener('dragleave', (e) => {
      if (!carriesFiles(e.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) show(false);
    });
    sheet.addEventListener('drop', (e) => {
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      reset();
      addFiles(e.dataTransfer.files);
    });
    sheet.addEventListener('dragend', reset);
    return overlay;
  }

  // Pasted files (attach-files.mjs): a unique "pasted-<timestamp>.<ext>" for the browser's generic
  // "image.png" (createPasteNamer), and a text paste carrying only a rendered image of that text stays text (pastedFiles).
  const namePastedFiles = createPasteNamer((parts, name, opts) => new win.File(parts, name, opts));

  function onComposerPaste(e) {
    const files = pastedFiles(e.clipboardData);
    if (!files) return;                               // a text paste goes ahead natively
    e.preventDefault();
    addFiles(namePastedFiles(files));
  }

  /** A reply is running in the open chat — streaming, or loaded but not yet adopted (inFlight). */
  function turnBusy() { return !!(st.model && (st.model.live() || st.model.inFlight())); }
  function queueOf(id) { return id ? st.queues.get(id) || null : null; }
  function motionOk() {
    try { return !(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return true; }
  }

  function updateSendStop() {
    if (!el.send) return;
    const streaming = !!(st.model && st.model.live());
    const busy = turnBusy();
    const q = queueOf(st.threadId);
    const full = busy && !!q && q.items.length >= QUEUE_MAX;
    // While a reply streams, Send stands beside Stop as soon as there is something to queue.
    el.send.hidden = streaming && !el.input.value.trim();
    el.stop.hidden = !streaming;
    el.send.disabled = full;
    el.send.setAttribute('aria-label', !busy ? 'Send' : (full ? 'Queue full' : 'Add to queue'));
    updateSuggestion();
  }

  /** The open chat's context fill and window: the streaming call's while live, else the last turn's.
   *  A thread with turns but no ctx predates the metric — null, never a fake 0. */
  function currentCtx() {
    const totals = st.model ? st.model.totals() : { live: null };
    const liveUsage = totals.live && totals.live.usage ? totals.live.usage : null;
    const ctx = liveUsage && Number.isFinite(liveUsage.ctx) ? liveUsage.ctx : totals.ctx;
    // The window: this turn's once its result landed, else the thread's last known (same model, as a rule).
    const win = liveUsage && Number.isInteger(liveUsage.ctxWindow) ? liveUsage.ctxWindow : totals.ctxWindow;
    return { ctx: Number.isFinite(ctx) ? ctx : null, win: Number.isInteger(win) ? win : null, turns: totals.turns || 0 };
  }

  function updateMeters() {
    if (!el.ctxBtn) return;
    const totals = st.model ? st.model.totals() : { live: null };
    const { ctx, win } = currentCtx();
    const pct = ctxPercent(ctx, win);
    // The ring: the arc is the fill (full past the window), the figure is the hover.
    const fill = pct != null ? +Math.min(100, (ctx / win) * 100).toFixed(2) : 0;
    el.ctxArc.setAttribute('stroke-dasharray', `${fill} 100`);
    const figure = fmtCtx(ctx, win);
    if (figure) el.ctxBtn.title = `${figure}${pct != null ? ` · ${pct}%` : ''}`;
    else el.ctxBtn.removeAttribute('title');
    const level = ctxLevel(ctx, win);
    el.ctxBtn.classList.toggle('is-ctx-warn', level === 'warn');
    el.ctxBtn.classList.toggle('is-ctx-high', level === 'high');
    el.ctxBtn.setAttribute('aria-label', pct != null ? `Context window, ${pct}% full` : 'Context window');
    // Cost: the stored thread total; while a turn streams, "≈" + that total plus
    // this turn's live figure — the CLI's once its result landed, else the
    // display-only list-price estimate the ask-usage frame carries. ask-done
    // nulls `live` and replaces the totals in one frame, so the authoritative
    // figure takes over with no special case. No figure at all → empty cell,
    // never a fabricated $0.00 (P3-F5).
    const lv = totals.live;
    const liveCost = lv ? (Number.isFinite(lv.costUsd) ? lv.costUsd : (Number.isFinite(lv.estimatedCostUsd) ? lv.estimatedCostUsd : null)) : null;
    if (liveCost != null) el.meterCost.textContent = `≈${fmtUsd((Number.isFinite(totals.costUsd) ? totals.costUsd : 0) + liveCost)}`;
    else el.meterCost.textContent = totals.costUsd == null ? '' : (fmtUsd(totals.costUsd) || '');
  }

  function stopTurn() {
    if (!st.threadId) return;
    Promise.resolve()
      .then(() => fetch(`/api/ask/threads/${st.threadId}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))
      .catch(() => { /* the turn will end via its own frames */ });
  }

  // ---- voice mode (docs/speech.md) ------------------------------------------
  // One mic: click = one-shot dictation (text lands in the composer, not sent);
  // long-press or the caret menu = hands-free (listen → send → speak → listen).
  // The controller (ask-voice.mjs) owns audio; the panel owns the composer, the
  // turn and the lifecycle (voice off on close / New chat / switch / destroy).
  const VOICE_LABELS = { loading: 'Starting mic…', listening: 'Listening…', transcribing: 'Transcribing…', thinking: 'Thinking…', speaking: 'Speaking…', error: 'Voice error' };

  function buildVoiceControls() {
    const wrap = make('span', 'ask-voice');
    el.voiceStatus = make('span', 'ask-voice-status');
    el.voiceStatus.hidden = true;
    el.voiceStatus.setAttribute('role', 'status');
    wrap.appendChild(el.voiceStatus);

    el.mic = make('button', 'btn btn-icon ask-voice-mic');
    el.mic.type = 'button';
    el.mic.setAttribute('data-ask-mic', '');
    el.mic.setAttribute('aria-pressed', 'false');
    el.mic.setAttribute('aria-label', 'Voice input');
    el.mic.addEventListener('pointerdown', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      st.voiceSwallowClick = false;                 // a long-press that never produced a click must not eat the next one
      clearTimeout(st.voiceLongPress);
      st.voiceLongPress = setTimeout(() => {
        st.voiceLongPress = null;
        st.voiceSwallowClick = true;
        toggleHandsFree();
      }, voiceLongPressMs);
    });
    const cancelPress = () => { if (st.voiceLongPress) { clearTimeout(st.voiceLongPress); st.voiceLongPress = null; } };
    el.mic.addEventListener('pointerup', cancelPress);
    el.mic.addEventListener('pointerleave', cancelPress);
    el.mic.addEventListener('click', () => {
      if (st.voiceSwallowClick) { st.voiceSwallowClick = false; return; }
      const v = voice();
      if (v.active()) { stopVoice(); return; }
      startVoice(lastVoiceMode());
    });
    paintMicMode(lastVoiceMode());
    wrap.appendChild(el.mic);

    const caret = make('button', 'btn btn-quiet btn-icon ask-voice-caret');
    caret.type = 'button';
    caret.setAttribute('data-ask-voice-caret', '');
    caret.setAttribute('aria-label', 'Voice options');
    caret.title = 'Voice options';
    caret.appendChild(svgIcon(ICONS.chevronDown, 11, 2));
    caret.addEventListener('click', () => openVoicePopover(caret));
    wrap.appendChild(caret);
    return wrap;
  }

  function openVoicePopover(trigger) {
    openPopover({ panelClass: 'ask-pop-voice', trigger, build: (p) => {
      p.appendChild(make('div', 'ask-pop-caption', 'Voice'));
      // The check marks the mode that is on now, or, with voice off, the one a click will start.
      const v = st.voice;
      const current = v && v.active() ? v.mode() : lastVoiceMode();
      const item = (label, mode, onPick) => {
        const it = menuItem('ask-voice-item', () => { closePopover({ focusTrigger: false }); onPick(); });
        it.dataset.mode = mode;
        if (VOICE_MODE_ICONS[mode]) it.appendChild(svgIcon(VOICE_MODE_ICONS[mode], 16, 1.9));
        it.appendChild(make('span', 'ask-model-name', label));
        if (mode === current) it.appendChild(checkMark());
        return it;
      };
      p.appendChild(item('Dictate once', 'dictate', () => startVoice('dictate')));
      p.appendChild(item('Talk, read the replies', 'talk', () => startVoice('talk')));
      p.appendChild(item('Hands-free conversation', 'handsfree', () => startVoice('handsfree')));
      if (st.voice && st.voice.active()) p.appendChild(item('Turn voice off', 'off', () => stopVoice()));
    } });
  }

  function voice() {
    if (!st.voice) {
      st.voice = createVoice({
        onState: paintVoice,
        onTranscript: voiceTranscript,
        onBargeIn: () => { if (st.model && st.model.live()) { st.stopBy = 'voice'; stopTurn(); } },
        onNotice: (msg) => setComposerMsg(msg),
      });
    }
    return st.voice;
  }

  const VOICE_USED_KEY = 'worca-cc.ask.voiceUsed';
  function voiceUsedBefore() { try { return storage.getItem(VOICE_USED_KEY) === '1'; } catch { return false; } }

  // The mode a plain click starts: the last one started (menu, hold or click), remembered across
  // reloads. Dictate until the user picks another.
  const VOICE_MODE_KEY = 'worca-cc.ask.voiceMode';
  const VOICE_MODE_NAMES = { dictate: 'Dictate once', talk: 'Talk, read the replies', handsfree: 'Hands-free conversation' };
  function lastVoiceMode() {
    try { const m = storage.getItem(VOICE_MODE_KEY); if (m && VOICE_MODE_NAMES[m]) return m; } catch { /* default */ }
    return 'dictate';
  }
  function paintMicMode(shown) {
    if (!el.mic) return;
    el.mic.replaceChildren(svgIcon(VOICE_MODE_ICONS[shown] || ICONS.mic, 16, 1.9));
    el.mic.title = `${VOICE_MODE_NAMES[lastVoiceMode()]} (click) · hands-free conversation (hold) · other modes (the arrow menu)`;
  }
  function startVoice(mode) {
    if (st.destroyed) return;
    try { storage.setItem(VOICE_MODE_KEY, mode); } catch { /* sticky is a nicety */ }
    paintMicMode(mode);
    voice().start(mode);
  }
  function toggleHandsFree() { const v = voice(); if (v.active() && v.mode() === 'handsfree') stopVoice(); else startVoice('handsfree'); }
  function stopVoice() { if (st.voice && st.voice.active()) st.voice.stop(); }

  function paintVoice(state, { mode, detail } = {}) {
    if (!el.mic) return;
    const on = state !== 'off' && state !== 'error';
    paintMicMode(on && mode ? mode : lastVoiceMode());
    el.mic.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.mic.classList.toggle('is-on', on);
    el.mic.classList.toggle('is-handsfree', on && (mode === 'handsfree' || mode === 'talk'));
    el.mic.classList.toggle('is-error', state === 'error');
    el.voiceStatus.hidden = state === 'off';
    el.voiceStatus.dataset.state = state;
    el.voiceStatus.textContent = (state === 'loading' && detail) || VOICE_LABELS[state] || '';
    if (state === 'error') setComposerMsg(detail || 'voice stopped');
    if (state === 'listening' || state === 'speaking' || state === 'error') announce(VOICE_LABELS[state]);
    if (state === 'listening' && !voiceUsedBefore()) { try { storage.setItem(VOICE_USED_KEY, '1'); } catch { /* preload is a nicety */ } }
  }

  function voiceTranscript(text, { autoSend } = {}) {
    const cur = el.input.value;
    el.input.value = cur && !/\s$/.test(cur) ? `${cur} ${text}` : `${cur}${text}`;
    fitInput();                                   // a programmatic write fires no input event
    if (!autoSend) { focusComposer(); return; }
    // While a reply runs (barge-in included) sendMessage() queues it like a typed send; the queue sends it after.
    voiceSend();
  }

  function voiceSend() {
    Promise.resolve()
      .then(() => sendMessage())
      .catch(() => false)                          // sendMessage can throw on a malformed response body
      .then((ok) => {
        if (!ok && st.voice && st.voice.active()) st.voice.fail(el.composerMsg.hidden ? 'the message was not sent' : el.composerMsg.textContent);
      });
  }

  /**
   * Send the composer's message — or `queued`, an item the queue drains ({text, quote, files}). While a reply runs the
   * composer's message joins this chat's queue instead ('queued'); a queued item that meets a running turn answers
   * 'busy' and stays first. true = sent, false = not sent (the reason is on the composer line).
   * @returns {Promise<boolean|'queued'|'busy'>}
   */
  async function sendMessage(queued = null) {
    if (st.sending || st.destroyed) return false;
    const draft = queued || { text: el.input.value.trim(), quote: st.quote, files: st.pendingFiles };
    let text = draft.text;
    if (!text) return false;
    // Pinpoint (#669): the quote chip rides as a blockquote above the text — for an add-on's direction too.
    const quoted = draft.quote;
    if (quoted) text = formatQuotedMessage(quoted, text);
    // A chat is still loading (a History pick, Back to a chat): the send would land in the chat being left — or, from
    // home, in a brand-new chat — while the address already names the loading one. The draft waits for it, and so do
    // the add-ons (a direction would reach the run of the chat being left).
    if (typeof st.wantThread === 'string' && st.wantThread !== st.threadId) return false;
    // worca Chat CONTRACT §2: an add-on may take the send first (P3's direction to a live run) — even while a reply
    // streams, since it never starts an Ask turn: true = handled, the input cleared; 'keep' = handled, the input kept
    // (the server refused it). Not taken: the add-ons may reword it (transformSend, e.g. P6's intent prefix) — that
    // text is what is sent and shown. The reword runs only for a send that goes ahead (never under a streaming reply).
    // A queued item already passed this when it was sent to the queue.
    if (!queued && st.addons.length) {
      st.sending = true;
      let taken = false;
      try { taken = await addonsTakeSend(text); } finally { st.sending = false; }
      if (st.destroyed) return false;
      if (taken === 'keep') { updateSendStop(); return true; }
      if (taken) {
        if (st.quote === quoted) setQuote(null);
        el.input.value = '';
        fitInput();                                  // a programmatic clear fires no input event
        updateSendStop();
        return true;
      }
    }
    // A reply is running (or loaded, not yet adopted): the composer's message waits in this chat's queue.
    if (turnBusy()) return queued ? 'busy' : enqueueDraft(draft);
    // …or one the user started while an add-on decided (the same check, above the add-ons).
    if (typeof st.wantThread === 'string' && st.wantThread !== st.threadId) return false;
    if (st.addons.length) text = addonsTransform(text);
    st.sending = true;
    setComposerMsg(null);
    updateSendStop();      // Send/Stop do not move yet (nothing streams)
    try {
      let id = st.threadId;
      if (!id) {
        let r = null;
        try {
          r = await fetch('/api/ask/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        } catch { r = null; }
        if (!r || (r.status !== 201 && !r.ok)) { setComposerMsg('could not create the thread'); return false; }
        const body = await r.json();
        // The user moved while the chat was being created (Back to a chat, a History pick): nothing is sent, the draft
        // stays — the swap below would otherwise drop that load and rewrite its address. The chat just made stays
        // empty and unseen: it is deleted, or History would list a "New chat" the user never started.
        if (st.destroyed || st.threadId || typeof st.wantThread === 'string') {
          const orphan = body && body.thread && body.thread.id;
          if (orphan && !st.destroyed) {
            Promise.resolve().then(() => fetch(`/api/ask/threads/${orphan}`, { method: 'DELETE' })).catch(() => { /* an empty leftover is harmless */ });
          }
          return false;
        }
        id = body.thread.id;
        loadGen += 1;                     // a pending loadThread() must not replace this fresh model
        st.threadId = id;
        st.model = createThreadModel({ threadId: id });
        st.model.load({ thread: body.thread, messages: [], attachments: [], runLinks: [], inFlight: null });
        setContexts(body.thread && body.thread.contexts);
        renderTranscript();
        storeThread(id);
        st.wantThread = id;
        route(id, { replace: true });          // #chat → #chat/<id>, swapped: Back never lands on an empty new chat
      }
      const sentOff = st.mcp.off;
      const payload = {
        text,
        model: st.picker.model,
        effort: st.picker.effort,
        // The browser's zone rides along: "tomorrow 02:00" is read in it (docs/scheduled-runs.md "Chat").
        context: { ...scopedContext(getPageContext() || {}), timeZone: browserTimeZone() },
        // MCP registry §9.4: every message carries the picker's choices, so each turn runs what the picker shows —
        // a refused first message (429/403/400, network) or a PATCH still in flight would leave the stored ones behind.
        mcpOff: sentOff,
        ...(draft.files.length ? { attachments: draft.files.map((f) => ({ name: f.name, dataBase64: f.dataBase64 })) } : {}),
      };
      const model = st.model;
      let res = null;
      try {
        res = await fetch(`/api/ask/threads/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } catch { setComposerMsg('network error: the message was not sent'); return false; }
      const accepted = !!res && res.status === 202;
      // The user may have clicked New chat or switched threads during the POST: the
      // message is on the server and arrives with its thread; touching the composer
      // or the (now different or null) model here would be wrong (review of PR #376) —
      // but a queued message the server took is sent, and must leave its queue (else it is sent twice).
      if (st.destroyed || st.model !== model || st.threadId !== id) return !!queued && accepted;
      if (!accepted) {
        let msg = `request failed (${res ? res.status : 'network'})`;
        let body = null;
        try { body = await res.json(); if (body && body.error) msg = body.error; } catch { /* keep the fallback */ }
        // Another turn (an event turn started at settle) got the chat first: the message waits for it.
        if (res && res.status === 409 && body && body.error === 'turn in flight') return queued ? 'busy' : enqueueDraft(draft);
        setComposerMsg(msg);
        return false;
      }
      st.scopeHeld = null;                           // S39: this message carried the held pick (its pinned is authoritative)
      // A toggle made while this POST was out PATCHed a value the route then overwrote with sentOff: re-send the latest.
      if (st.mcp.off !== sentOff) patchMcpOff(id, st.mcp.off);
      const { userMessageId, attachments: stored, contexts } = await res.json();
      if (Array.isArray(contexts)) setContexts(contexts);   // an older server omits it: keep what is shown
      // Prefer the server's rows: they carry the store-minted ids that key the
      // image thumbnail (#398) and the thread's attachment ledger. The pending
      // files are the fallback for a server that predates the field.
      const echoAtts = Array.isArray(stored)
        ? stored.map((a) => ({ id: a.id, name: a.name, bytes: a.bytes, attKind: a.kind ?? 'text', mime: a.mime ?? null }))
        : draft.files.map((f) => ({ name: f.name, bytes: f.bytes, attKind: f.attKind, mime: f.mime }));
      st.model.noteLocalUserMessage({ id: userMessageId, text, attachments: echoAtts });
      st.askedIn.add(id);                            // its replies may light the Chat row's dot, even after a switch
      // No provisional title from the prompt: the header keeps "New chat" until
      // the ask-title frame lands (ask-model marks title dirty, flushExtra repaints).
      // A drained queue item leaves the composer alone: it holds whatever the user is typing now.
      if (!queued) {
        el.input.value = '';
        fitInput();                                    // a programmatic clear fires no input event
        st.pendingFiles = [];
        if (st.quote === quoted) st.quote = null;
        renderChips();
        st.hist = { idx: -1, draft: '' };
      }
      subscribe(id);
      st.pinned = true;
      scheduleFlush();
      return true;
    } finally {
      st.sending = false;
      updateSendStop();
    }
  }

  // ---- the queue (messages sent while a reply runs; max 3, oldest first, per chat) --------------------------------
  /** The composer's draft joins the open chat's queue: text, quote and files are snapshotted and the composer clears. */
  function enqueueDraft(draft) {
    const id = st.threadId;
    if (!id) return false;
    let q = st.queues.get(id);
    if (!q) { q = { items: [], paused: false, draining: false }; st.queues.set(id, q); }
    if (q.items.length >= QUEUE_MAX) {
      announce(`Queue full: ${QUEUE_MAX} messages wait for this reply`);
      renderQueue();
      return false;
    }
    const item = { key: `q${++queueSeq}`, text: draft.text, quote: draft.quote || null, files: draft.files.slice() };
    q.items.push(item);
    el.input.value = '';
    fitInput();                                      // a programmatic clear fires no input event
    st.pendingFiles = [];
    if (st.quote === draft.quote) st.quote = null;
    renderChips();
    st.hist = { idx: -1, draft: '' };
    renderQueue();
    announce(`Queued: ${q.items.length} of ${QUEUE_MAX}, sends when the reply finishes`);
    return 'queued';
  }

  /** Send the oldest item of the open chat's queue (one per finished reply). */
  async function drainQueue() {
    const id = st.threadId;
    const q = queueOf(id);
    if (!q) return;
    // A finish seen while an item's POST is out (its turn ran and ended before the 202): drain again after it.
    if (q.draining) { q.again = true; return; }
    if (q.paused || !q.items.length || st.destroyed) return;
    if (st.sending || turnBusy()) return;            // the next ask-done drains
    const item = q.items[0];
    if (st.queueEdit && st.queueEdit.item === item) return;   // it waits: saving or cancelling the edit drains
    q.draining = true;
    q.again = false;
    renderQueue();
    announce('Sending the next queued message');
    let r = false;
    try { r = await sendMessage(item); } catch { r = false; }
    q.draining = false;
    if (st.destroyed) return;
    if (r === true) {
      removeQueued(id, item, { sent: true });
      if (q.again && id === st.threadId) { q.again = false; drainQueue(); }
    } else if (r !== 'busy' && q.items.includes(item)) pauseQueue(id);   // the composer line says why
    else if (id === st.threadId) renderQueue();
  }

  function pauseQueue(id = st.threadId) {
    const q = queueOf(id);
    if (!q || !q.items.length || q.paused) return;
    q.paused = true;
    if (id === st.threadId) { renderQueue(); announce('Queue paused'); }
  }

  function resumeQueue() {
    const q = queueOf(st.threadId);
    if (!q) return;
    q.paused = false;
    const hadFocus = doc.activeElement === el.queueResume;
    renderQueue();
    if (hadFocus) focusComposer();                    // the button hides itself: focus must not fall to the page
    announce('Queue resumed');
    drainQueue();                                     // sends now when idle; else the next clean finish sends
  }

  function removeQueued(id, item, { sent = false, silent = false } = {}) {
    const q = queueOf(id);
    if (!q) return;
    const i = q.items.indexOf(item);
    if (i < 0) return;
    q.items.splice(i, 1);
    if (!q.items.length) st.queues.delete(id);
    if (id === st.threadId) renderQueue({ leaving: item.key, sent });
    if (!silent && id === st.threadId) announce(sent ? 'Queued message sent' : 'Removed from the queue');
  }

  /** The pencil or a card's text: the text turns into a textarea in place — the item keeps its place, files and quote.
   *  Not the item being sent. */
  function startQueueEdit(item) {
    const id = st.threadId;
    const q = queueOf(id);
    if (!q || !q.items.includes(item) || (q.draining && q.items[0] === item)) return;
    if (st.queueEdit) {
      if (st.queueEdit.item === item) { st.queueEdit.ta.focus(); return; }
      endQueueEdit(true, { refocus: false });
    }
    const li = [...el.queueList.children].find((c) => c.dataset.key === item.key);
    if (!li) return;
    const ta = make('textarea', 'ask-queue-edit');
    ta.rows = 1;
    ta.value = item.text;
    ta.addEventListener('input', () => fitQueueEdit(ta));
    ta.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); endQueueEdit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endQueueEdit(false); }
    });
    // Leaving the field keeps a change (and drops an unchanged edit); Save and Escape got there first otherwise.
    ta.addEventListener('blur', () => { if (st.queueEdit && st.queueEdit.ta === ta) endQueueEdit(true, { refocus: false }); });
    st.queueEdit = { id, item, li, ta };
    li.classList.add('is-editing');
    li.querySelector('.ask-queue-text').after(ta);
    renderQueue();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    fitQueueEdit(ta);
  }

  function fitQueueEdit(ta) {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight || 0, 120)}px`;
  }

  /** Drop the open edit's field; with `save` its text becomes the item's (non-empty only). Paints nothing.
   *  @returns {'saved'|'emptied'|'same'|'gone'} */
  function closeQueueEdit(save) {
    const ed = st.queueEdit;
    st.queueEdit = null;
    ed.ta.remove();
    ed.li.classList.remove('is-editing');
    const q = queueOf(ed.id);
    if (!q || !q.items.includes(ed.item)) return 'gone';
    const text = ed.ta.value.trim();
    if (!save || text === ed.item.text) return 'same';
    if (!text) return 'emptied';
    ed.item.text = text;
    return 'saved';
  }

  /** Save (Enter, ✓, blur with a change) or cancel (Escape, blur without one). Saving empty text removes the item,
   *  like ×. Focus goes back to the card's text; a first item the edit held back drains now if the chat is idle. */
  function endQueueEdit(save, { refocus = true } = {}) {
    const ed = st.queueEdit;
    if (!ed) return;
    const how = closeQueueEdit(save);
    const open = ed.id === st.threadId;
    if (how === 'emptied') {
      if (refocus && open) removeQueuedByUser(ed.item); else removeQueued(ed.id, ed.item);
    } else if (open) {
      renderQueue();
      if (how === 'saved') announce('Queued message updated');
      if (refocus && ed.li.isConnected) ed.li.querySelector('.ask-queue-text').focus();
    }
    const q = queueOf(ed.id);
    if (open && how !== 'emptied' && q && q.items[0] === ed.item && !q.draining) drainQueue();
  }

  function queueExcerpt(text) { const line = String(text).split('\n').find((l) => l.trim()) || ''; return line.trim(); }

  /** A new card: its parts are built once; fillQueueCard keeps text, position and state current.
   *  Only a new card plays the entry animation — a kept card must not, or it hides the FLIP shift. */
  function queueCard(item) {
    const li = make('li', 'ask-queue-item is-entering');
    li.dataset.key = item.key;
    li.setAttribute('data-ask-queue-item', '');
    li.addEventListener('animationend', () => li.classList.remove('is-entering'), { once: true });
    const txt = make('button', 'ask-queue-text', queueExcerpt(item.text));
    txt.type = 'button';
    txt.title = 'Edit this message';
    txt.addEventListener('click', () => startQueueEdit(item));
    li.appendChild(txt);
    const extras = [];
    if (item.files.length) extras.push(`${item.files.length} file${item.files.length === 1 ? '' : 's'}`);
    if (item.quote) extras.push('quote');
    if (extras.length) li.appendChild(make('span', 'ask-queue-meta', extras.join(' · ')));
    // The pencil turns into ✓ (Save) while the card is edited.
    const pen = make('button', 'ask-queue-pen');
    pen.type = 'button';
    pen.addEventListener('mousedown', (e) => { if (li.classList.contains('is-editing')) e.preventDefault(); });   // keep the field's focus: no blur-save first
    pen.addEventListener('click', () => { if (st.queueEdit && st.queueEdit.item === item) endQueueEdit(true); else startQueueEdit(item); });
    li.appendChild(pen);
    const x = make('button', 'btn btn-sm btn-quiet btn-icon ask-queue-x');
    x.type = 'button';
    x.setAttribute('aria-label', 'Remove from the queue');
    x.append(icon(doc, 'x', 14));
    x.addEventListener('click', () => removeQueuedByUser(item));
    li.appendChild(x);
    return li;
  }

  function fillQueueCard(li, item, pos, total, q) {
    const sending = q.draining && q.items[0] === item;
    li.classList.toggle('is-sending', sending);
    const editing = !!st.queueEdit && st.queueEdit.item === item;
    const txt = li.querySelector('.ask-queue-text');
    const pen = li.querySelector('.ask-queue-pen');
    const x = li.querySelector('.ask-queue-x');
    txt.disabled = sending;
    pen.disabled = sending;
    x.disabled = sending;
    txt.textContent = queueExcerpt(item.text);
    txt.setAttribute('aria-label', `Queued message ${pos} of ${total}${pos === 1 ? ', sends next' : ''}: ${queueExcerpt(item.text)}. Edit`);
    if (pen.dataset.mode !== (editing ? 'save' : 'edit')) {
      pen.dataset.mode = editing ? 'save' : 'edit';
      pen.replaceChildren(svgIcon(editing ? ICONS.check : ICONS.pencil, 13, 2));
    }
    pen.setAttribute('aria-label', `${editing ? 'Save' : 'Edit'} queued message ${pos}`);
    pen.title = editing ? 'Save' : 'Edit';
    if (editing) st.queueEdit.ta.setAttribute('aria-label', `Edit queued message ${pos}`);
    x.setAttribute('aria-label', `Remove queued message ${pos}`);
  }

  /** × on a card: the item leaves and focus goes to a neighbour card (or the input), not to the page body. */
  function removeQueuedByUser(item) {
    const shown = [...el.queueList.children];
    const at = shown.findIndex((li) => li.dataset.key === item.key);
    removeQueued(st.threadId, item);
    const left = [...el.queueList.children];
    const next = left[Math.min(at, left.length - 1)];
    if (next) next.querySelector('.ask-queue-text').focus();
    else focusComposer();
  }

  /** Repaint the open chat's queue, keyed by item: shown cards are kept and updated, new ones created. `leaving`: the
   *  key of a card just sent or removed — its clone slides out while the rest shift (FLIP). Motion is skipped under
   *  prefers-reduced-motion; the data is already final either way. */
  function renderQueue({ leaving = null, sent = false } = {}) {
    if (!el.queue) return;
    const q = queueOf(st.threadId);
    const items = q ? q.items : [];
    const shown = [...el.queueList.children];
    const hadFocus = el.queueList.contains(doc.activeElement);
    const motion = motionOk() && shown.length > 0;
    const before = motion ? new Map(shown.map((li) => [li.dataset.key, li.getBoundingClientRect()])) : null;
    if (motion && leaving) {
      const old = shown.find((li) => li.dataset.key === leaving);
      if (old) spawnQueueGhost(old, sent);
    }
    const kept = new Map(shown.map((li) => [li.dataset.key, li]));
    // Newest on top, oldest last — next to the input box it will be sent from.
    const want = items.map((it, i) => {
      const li = kept.get(it.key) || queueCard(it);
      fillQueueCard(li, it, i + 1, items.length, q);
      return li;
    }).reverse();
    // A card edited in another chat, or whose item went away, keeps a non-empty change and closes its field.
    if (st.queueEdit && !want.includes(st.queueEdit.li)) closeQueueEdit(true);
    for (const li of shown) if (!want.includes(li)) li.remove();
    // Insert only what is not already in place: moving a kept card would restart its animations and drop its focus.
    want.forEach((li, i) => { if (el.queueList.children[i] !== li) el.queueList.insertBefore(li, el.queueList.children[i] || null); });
    el.queue.hidden = !items.length;
    // A focused card that left (sent or removed) or turned to sending: focus goes to the input, not the page.
    const at = doc.activeElement;
    if (hadFocus && (!el.queueList.contains(at) || at.disabled)) focusComposer();
    const paused = !!q && q.paused;
    el.queueResume.hidden = !paused;
    el.queueNote.textContent = paused ? 'Queue paused'
      : items.length >= QUEUE_MAX ? 'Queue full: sends when the reply finishes'
        : 'Sends when the reply finishes';
    if (before) {
      for (const li of el.queueList.children) {
        const was = before.get(li.dataset.key);
        if (!was) continue;
        const dy = was.top - li.getBoundingClientRect().top;
        if (!dy) continue;
        li.style.transition = 'none';
        li.style.transform = `translateY(${dy}px)`;
        void li.offsetHeight;                        // commit the start position before the transition runs
        li.style.transition = '';
        li.style.transform = '';
      }
    }
    updateSendStop();
  }

  function spawnQueueGhost(li, sent) {
    const host = el.queue.parentNode;
    if (!host) return;
    const box = host.getBoundingClientRect();
    const r = li.getBoundingClientRect();
    const ghost = li.cloneNode(true);
    ghost.classList.remove('is-entering');           // its entry animation would outrank the exit one
    ghost.classList.add('ask-queue-ghost');
    if (sent) ghost.classList.add('is-sent');
    ghost.removeAttribute('data-ask-queue-item');
    ghost.setAttribute('data-ask-queue-ghost', '');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    ghost.style.top = `${r.top - box.top}px`;
    ghost.style.left = `${r.left - box.left}px`;
    ghost.style.width = `${r.width}px`;
    host.appendChild(ghost);
    const done = () => ghost.remove();
    ghost.addEventListener('animationend', done, { once: true });
    const t = setTimeout(done, 400);                 // backstop: no animationend (hidden tab, reduced motion set late)
    if (t && typeof t.unref === 'function') t.unref();
  }

  // ---- composer keys: Enter sends, Tab takes the suggestion, ArrowUp/Down walk this chat's history --------------
  function onComposerKeydown(e) {
    if (e.isComposing) return;
    const plain = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); return; }
    // Ghost text: only Tab takes it (Enter on the empty input sends nothing); no suggestion → native focus move.
    if (e.key === 'Tab' && plain && st.suggestion && !el.input.value) { e.preventDefault(); acceptSuggestion(); return; }
    if (e.key === 'ArrowUp' && plain && historyUp()) { e.preventDefault(); return; }
    if (e.key === 'ArrowDown' && plain && historyDown()) { e.preventDefault(); return; }
    if (e.key === 'Escape' && st.hist.idx >= 0) { e.preventDefault(); e.stopPropagation(); historyCancel(); }
  }

  function onComposerInput() {
    fitInput();
    // An edit ends a history walk: the edited text is the draft now.
    if (st.hist.idx >= 0) st.hist = { idx: -1, draft: '' };
    // Anything typed after a reply retires that reply's suggestion — also one still being written.
    if (el.input.value) st.suggestDismissed = newestAssistantId();
    updateSendStop();
  }

  function newestAssistantId() {
    const rows = st.model ? st.model.messages() : [];
    for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i] && rows[i].role === 'assistant') return rows[i].id;
    return null;
  }

  // ---- ArrowUp history (this chat's sent messages, as stored) ---------------------------------------------------
  function historyEntries() {
    const out = [];
    for (const r of st.model ? st.model.messages() : []) {
      if (!r || r.role !== 'user' || typeof r.text !== 'string' || !r.text.trim()) continue;
      if (Array.isArray(r.blocks) && r.blocks.some((b) => b && b.synthetic)) continue;   // an event turn's row: nobody typed it
      if (out[out.length - 1] !== r.text) out.push(r.text);
    }
    return out;
  }
  function caretOnFirstLine() {
    const { selectionStart: a, selectionEnd: b, value } = el.input;
    return a === b && !value.slice(0, a).includes('\n');
  }
  // A walk starts only from an empty input or a caret at the very start: a typed newline is not the only line break —
  // a long paragraph wraps in the narrow dock, and ArrowUp there must move the caret, not replace the draft.
  // (On a one-line draft the native ArrowUp takes the caret to the start, so a second press starts the walk.)
  function canStartHistory() {
    const { selectionStart: a, selectionEnd: b, value } = el.input;
    return !value || (a === 0 && b === 0);
  }
  function caretOnLastLine() {
    const { selectionStart: a, selectionEnd: b, value } = el.input;
    return a === b && !value.slice(b).includes('\n');
  }
  function showHistory(text) {
    el.input.value = text;
    fitInput();                                      // a programmatic write fires no input event
    try { el.input.selectionStart = el.input.selectionEnd = text.length; } catch { /* jsdom */ }
    updateSendStop();
  }
  function historyUp() {
    if (st.hist.idx < 0 ? !canStartHistory() : !caretOnFirstLine()) return false;
    const list = historyEntries();
    if (!list.length) return false;
    if (st.hist.idx < 0) st.hist = { idx: list.length, draft: el.input.value };
    const next = Math.min(st.hist.idx, list.length) - 1;
    if (next < 0) return true;                       // on the oldest: stay there
    st.hist.idx = next;
    showHistory(list[next]);
    return true;
  }
  function historyDown() {
    if (st.hist.idx < 0 || !caretOnLastLine()) return false;
    const list = historyEntries();
    const next = st.hist.idx + 1;
    if (next >= list.length) { const { draft } = st.hist; st.hist = { idx: -1, draft: '' }; showHistory(draft); }
    else { st.hist.idx = next; showHistory(list[next]); }
    return true;
  }
  function historyCancel() {
    const { draft } = st.hist;
    st.hist = { idx: -1, draft: '' };
    showHistory(draft);
  }

  // ---- ghost-text suggestion (ask-suggestion, live-only) --------------------------------------------------------
  function updateSuggestion() {
    if (!el.input || !el.suggestHint) return;
    const s = st.model && st.model.suggestion ? st.model.suggestion() : null;
    const q = queueOf(st.threadId);
    const show = !!s && !el.input.value && st.basePlaceholder === INPUT_PLACEHOLDER
      && st.suggestDismissed !== s.messageId && !turnBusy() && !st.sending
      && !(q && q.items.length) && st.hist.idx < 0;
    st.suggestion = show ? s : null;
    el.input.placeholder = show ? s.text : st.basePlaceholder;
    el.input.classList.toggle('is-suggesting', show);
    el.suggestHint.textContent = show ? `Suggestion: ${s.text}. Press Tab to use it.` : '';
    if (show) el.input.setAttribute('aria-describedby', el.suggestHint.id);
    else el.input.removeAttribute('aria-describedby');
  }
  function acceptSuggestion() {
    const s = st.suggestion;
    if (!s) return;
    st.suggestDismissed = s.messageId;
    showHistory(s.text);                             // fills, fits, caret at the end, repaints (the suggestion hides)
    announce('Suggestion added');
  }

  function buildComposer() {
    const wrap = make('div', 'ask-composer');
    // The band is the padded outer strip; the rounded, bordered box inside it
    // holds chips → textarea → msg → row and shares the transcript column's cap
    // (style.css .ask-composer-box), so both centre together in a wide sheet.
    const box = make('div', 'ask-composer-box');
    el.composerBox = box;
    // The queue (messages sent while a reply runs): directly above the box, oldest card nearest the input.
    el.queue = make('div', 'ask-queue');
    el.queue.setAttribute('data-ask-queue', '');
    el.queue.hidden = true;
    const qbar = make('div', 'ask-queue-bar');
    el.queueNote = make('span', 'ask-queue-note');
    el.queueResume = make('button', 'ask-queue-resume', 'Resume queue');
    el.queueResume.type = 'button';
    el.queueResume.setAttribute('data-ask-queue-resume', '');
    el.queueResume.hidden = true;
    el.queueResume.addEventListener('click', resumeQueue);
    qbar.append(el.queueNote, el.queueResume);
    el.queueList = make('ol', 'ask-queue-list');
    el.queueList.setAttribute('aria-label', 'Queued messages');
    el.queue.append(qbar, el.queueList);
    wrap.appendChild(el.queue);
    wrap.appendChild(box);

    // worca Chat CONTRACT §2: the add-ons' lead row (an intent chip, a direction chip…) above the attachments.
    el.lead = make('div', 'chat-composer-lead');
    el.lead.setAttribute('data-chat-composer-lead', '');
    box.appendChild(el.lead);

    el.chips = make('div', 'ask-chips');
    el.chips.hidden = true;
    box.appendChild(el.chips);

    el.input = doc.createElement('textarea');
    el.input.className = 'ask-input';
    el.input.rows = 1;
    el.input.placeholder = INPUT_PLACEHOLDER;
    el.input.setAttribute('aria-label', 'Message Chat');   // fixed: the placeholder may hold a suggestion
    el.input.addEventListener('keydown', onComposerKeydown);
    el.input.addEventListener('input', onComposerInput);
    el.input.addEventListener('paste', onComposerPaste);
    box.appendChild(el.input);

    // The suggestion's words for screen readers (aria-describedby while it shows; the placeholder alone is not enough).
    // Outside the box: the browser extension's composer mirrors the box's children one for one.
    el.suggestHint = make('span', 'sr-only');
    el.suggestHint.id = `ask-suggest-${Math.random().toString(36).slice(2, 10)}`;
    wrap.appendChild(el.suggestHint);

    el.composerMsg = make('div', 'ask-composer-msg');
    el.composerMsg.hidden = true;
    box.appendChild(el.composerMsg);

    const row = make('div', 'ask-composer-row');

    el.fileInput = doc.createElement('input');
    el.fileInput.type = 'file';
    el.fileInput.multiple = true;
    el.fileInput.accept = ATTACH_ACCEPT;
    el.fileInput.hidden = true;
    el.fileInput.addEventListener('change', () => { addFiles(el.fileInput.files); el.fileInput.value = ''; });
    row.appendChild(el.fileInput);
    const attach = iconButton('btn btn-quiet btn-icon', 'Attach files', ICONS.plus, () => el.fileInput.click());
    attach.setAttribute('data-ask-attach-btn', '');
    row.appendChild(attach);

    // #397: the scope selector — which project/workspace this chat is about,
    // independent of the page behind the sheet. It sits right after "+"
    // (attach → scope → spacer → meter …): the pill keeps its width (style.css
    // .ask-scope-btn flex:none), the spacer absorbs the slack. Its popover
    // (.ask-pop-scope) opens above the composer box, flush with its left edge.
    const scopeBtn = make('button', 'btn btn-sm btn-quiet ask-scope-btn');
    scopeBtn.type = 'button';
    scopeBtn.setAttribute('data-ask-scope-btn', '');
    scopeBtn.title = `Chat scope: ${NO_PROJECT_LABEL}`;
    scopeBtn.setAttribute('aria-haspopup', 'menu');
    scopeBtn.setAttribute('aria-expanded', 'false');
    scopeBtn.setAttribute('aria-label', `Chat scope: ${NO_PROJECT_LABEL}`);   // updateScopeButton() runs on the first scope change
    el.scopeIco = scopeIcon(doc, 'none', 13);
    el.scopeIcoKind = 'none';
    el.scopeLabel = make('span', 'ask-scope-label', NO_PROJECT_LABEL);
    scopeBtn.appendChild(el.scopeIco);
    scopeBtn.appendChild(el.scopeLabel);
    scopeBtn.appendChild(svgIcon(ICONS.chevronDown, 11, 2));
    scopeBtn.addEventListener('click', () => openScopePopover(scopeBtn));
    el.scopeBtn = scopeBtn;
    row.appendChild(scopeBtn);
    // Never a two-letter stub (run 1): when the label would be cut below 56px, show the icon alone; the label stays in
    // the tooltip and the accessible name. The row's width changes with the level, the engine and the window.
    const fitScope = () => {
      scopeBtn.classList.remove('is-compact');
      const l = el.scopeLabel;
      if (l.scrollWidth > l.clientWidth + 1 && l.clientWidth < 56) scopeBtn.classList.add('is-compact');
    };
    el.fitScope = fitScope;
    const RO = doc.defaultView && doc.defaultView.ResizeObserver;
    if (typeof RO === 'function') { el.scopeRo = new RO(() => fitScope()); el.scopeRo.observe(row); }

    // MCP registry §9.4 + skills registry §6.8: the per-chat Sets picker — `Sets · N` (N = copies and skills that start
    // next turn), hidden while no set in play has a member or a skill. Styled as the scope pill; opens like the model
    // button's Effort sub-picker.
    const mcpBtn = make('button', 'btn btn-sm btn-quiet ask-scope-btn ask-mcp-btn ask-sets-btn');
    mcpBtn.type = 'button';
    mcpBtn.setAttribute('data-ask-mcp-btn', '');
    mcpBtn.title = 'Sets for this chat';
    mcpBtn.hidden = true;
    mcpBtn.dataset.minLevel = 'advanced';
    el.mcpBtnLabel = make('span', 'ask-scope-label', 'Sets · 0');
    mcpBtn.appendChild(el.mcpBtnLabel);
    mcpBtn.addEventListener('click', () => openMcpPopover(mcpBtn));
    el.mcpBtn = mcpBtn;
    row.appendChild(mcpBtn);

    row.appendChild(make('span', 'ask-composer-spacer'));

    // The cost (an Advanced detail), then the context ring. The ring opens the context popover — the
    // window, this chat's topics, its agents and worktrees — so it shows at every interface level.
    const meter = make('span', 'ask-meter');
    meter.setAttribute('data-ask-meter', '');
    el.meterCost = make('span', 'ask-meter-cost', '');
    el.meterCost.dataset.minLevel = 'advanced';
    meter.appendChild(el.meterCost);
    const ctxBtn = make('button', 'btn btn-sm btn-quiet btn-icon ask-ctx-ring');
    ctxBtn.type = 'button';
    ctxBtn.setAttribute('data-ask-ctx-btn', '');
    ctxBtn.setAttribute('aria-haspopup', 'menu');
    ctxBtn.setAttribute('aria-expanded', 'false');
    ctxBtn.setAttribute('aria-label', 'Context window');
    ctxBtn.appendChild(ctxRing());
    ctxBtn.addEventListener('click', () => openCtxPopover(ctxBtn));
    el.ctxBtn = ctxBtn;
    meter.appendChild(ctxBtn);
    row.appendChild(meter);

    const modelBtn = make('button', 'btn btn-sm btn-quiet ask-model-btn');
    modelBtn.type = 'button';
    modelBtn.setAttribute('data-ask-model-btn', '');
    modelBtn.dataset.minLevel = 'advanced';
    el.modelBtnLabel = make('span', 'ask-model-btn-label', st.picker.model);
    el.modelBtnEffort = make('span', 'ask-model-btn-effort', st.picker.effort);
    modelBtn.appendChild(el.modelBtnLabel);
    modelBtn.appendChild(el.modelBtnEffort);
    modelBtn.appendChild(svgIcon(ICONS.chevronDown, 12, 2));
    modelBtn.addEventListener('click', () => openModelPopover(modelBtn));
    row.appendChild(modelBtn);

    el.send = make('button', 'btn btn-primary btn-icon ask-send');
    el.send.type = 'button';
    el.send.setAttribute('data-ask-send', '');
    el.send.setAttribute('aria-label', 'Send');
    el.send.appendChild(svgIcon(ICONS.send, 15, 2.2));
    el.send.addEventListener('click', () => sendMessage());   // the click event must never reach sendMessage(queued)
    if (createVoice) row.appendChild(buildVoiceControls());
    row.appendChild(el.send);

    el.stop = make('button', 'btn btn-icon ask-stop');
    el.stop.type = 'button';
    el.stop.setAttribute('data-ask-stop', '');
    el.stop.setAttribute('aria-label', 'Stop');
    el.stop.hidden = true;
    const stopRect = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    stopRect.setAttribute('width', '10');
    stopRect.setAttribute('height', '10');
    stopRect.setAttribute('viewBox', '0 0 24 24');
    stopRect.setAttribute('fill', 'currentColor');
    stopRect.setAttribute('aria-hidden', 'true');
    const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '6'); rect.setAttribute('y', '6');
    rect.setAttribute('width', '12'); rect.setAttribute('height', '12');
    rect.setAttribute('rx', '2');
    stopRect.appendChild(rect);
    el.stop.appendChild(stopRect);
    el.stop.addEventListener('click', () => { st.stopBy = 'button'; stopTurn(); });
    row.appendChild(el.stop);

    box.appendChild(row);
    return wrap;
  }

  function announce(text) { el.live.textContent = text; }

  /** Never under a dialog: the welcome (app.js shows it on Chat BEFORE the route opens the page) or a confirm keeps its
   *  focus. */
  function focusComposer() {
    // …nor under the History overlay (below 1100px): closing it hands the focus on (a pick, a delete, Escape).
    if (historyOverlayOpen() || doc.querySelector('.viewer-modal:not(.hidden), dialog[open]')) return;
    try { el.input.focus({ preventScroll: true }); } catch { try { el.input.focus(); } catch { /* detached */ } }
  }

  /** The Chat row's dot (app.js paints it through onUnread): a reply ended while the page was hidden — in the open
   *  chat, or in another chat this tab asked in. `threadId` = that chat; the most recent one wins. Off clears it. */
  function setUnread(on, threadId = null) {
    if (on && threadId) st.unreadThread = threadId;
    if (!on) st.unreadThread = null;
    if (st.unread === on) return;
    st.unread = on;
    if (typeof onUnread === 'function') { try { onUnread(on); } catch { /* the dot is a nicety */ } }
  }

  /**
   * The page became visible (app.js: the #chat route) — or, with `req`, is routed: `{ threadId: null }` = home
   * (a new chat; the draft stays), `{ threadId }` = that chat. Every hidden → shown step re-pins the transcript,
   * repaints the run cards and re-previews the Sets; the FIRST one also loads the model catalog and — only for a
   * bare open() with no route — the stored chat. (`req`, not `route`: route() is the address callback below.)
   */
  function openPage(req) {
    if (st.destroyed) return;
    const routed = !!(req && typeof req === 'object' && Object.prototype.hasOwnProperty.call(req, 'threadId'));
    const showing = !st.open;
    if (showing) {
      st.open = true;
      setUnread(false);
      st.pinned = true;
      ensureFirstOpen({ restore: !routed });
      composerCards().stale();   // the chat was hidden: a wizard may have saved a draft meanwhile
      scheduleFlush();
      repaintProgressCards({ hydrate: true });
      refChips.show();                               // run chips skipped the store events while hidden
      scheduleMcpRefresh();                          // the page may have changed while Chat was hidden
      if (st.historyStale) loadHistory();            // the first show, or a refresh frame landed while hidden
      if (createVoice && voiceUsedBefore()) voice().preload();   // the mic is ready by the time it is clicked
    }
    if (routed) showThread(req.threadId);
    // Text appended while the page was hidden (openChat from another page) was measured at 0px under display:none:
    // size the textarea again now that it has a box.
    if (showing) { fitInput(); focusComposer(); }
  }

  /** Show chat `id` (null = home). A no-op for the chat already shown or loading, so the address echo of onRoute
   *  (hashchange → app.js enterChatView → open) never loads it twice. */
  function showThread(id) {
    const want = typeof id === 'string' && id ? id : null;
    if (st.wantThread === want) return;
    if (want) switchThread(want);
    else newThread();
  }

  /** The panel moved to another chat: app.js points the address at it (pushed, or swapped with `replace`). */
  function route(threadId, { replace = false } = {}) {
    if (typeof onRoute !== 'function') return;
    try { onRoute(threadId || null, { replace }); } catch { /* the address is a nicety */ }
  }

  /**
   * Append a plain-text reference to the composer WITHOUT sending, so several can
   * stack and the user presses send once. The caller routes to Chat first (app.js
   * openChat); a hidden page keeps the text for its next show. Returns false when
   * there is nothing to add.
   */
  function appendToComposer(text) {
    const add = String(text ?? '').trim();
    if (!add || st.destroyed) return false;
    const cur = el.input.value;
    el.input.value = cur ? `${cur.replace(/\s*$/, '')}\n${add}` : add;
    fitInput();                                    // a programmatic write fires no input event
    focusComposer();
    try { el.input.selectionStart = el.input.selectionEnd = el.input.value.length; } catch { /* jsdom */ }
    return true;
  }

  /** The page was hidden (app.js: another route). Voice stops and popovers close; focus belongs to the next page. */
  function closePage() {
    if (!st.open) return;
    stopVoice();
    closePopover({ focusTrigger: false });
    if (historyOverlayOpen()) setHistoryOpen(false, { persist: false });
    st.open = false;
  }

  /** Home (no message yet) or thread — CONTRACT §1 `chat-page[data-view]` — and the ONE composer follows: the hero
   *  slot on home, the dock on a thread. A chat still loading (a routed open from home, Back to a chat) is a thread
   *  already: home never flashes before it, and P6's home never starts a visit for it. No animation here (P6 adds
   *  the FLIP); keyboard focus survives the move. */
  function syncView() {
    if (!el.page) return;
    const loading = typeof st.wantThread === 'string' && st.wantThread !== st.threadId;
    const home = !loading && (!st.model || st.model.messages().length === 0);
    const view = home ? 'home' : 'thread';
    if (el.page.dataset.view !== view) el.page.dataset.view = view;
    const slot = home ? el.heroSlot : el.chatDock;
    if (el.composer.parentNode !== slot) {
      const hadFocus = el.composer.contains(doc.activeElement);
      slot.appendChild(el.composer);
      if (hadFocus) focusComposer();
    }
    paintHistoryCurrent();
  }

  // ---- layout changes ---------------------------------------------------------
  /** A window resize, the conversation column changing width with none (the rail, the history column, the run
   *  panel), or the transcript column growing with no frame (a card's graph or a registered card that grows from
   *  the run store — the ResizeObservers at the mount): card graphs re-measure, a pinned transcript stays at the
   *  bottom and an open context popover re-anchors. */
  function onWinResize() {
    if (st.destroyed || !st.open) return;
    // Narrowed past 1100px with the push column open: as an overlay it would cover the chat (and the focused composer).
    // Close it, as a load at that width does (initialHistoryOpen); the stored choice is kept.
    if (st.historyAsPush && overlayMode() && historyOpen()) setHistoryOpen(false, { persist: false });
    // Widened past 1100px with the overlay open: a push column now — narrowing again closes it too.
    if (historyOpen() && !overlayMode()) st.historyAsPush = true;
    paintHistory();                                  // crossing 1100px turns the column into an overlay, or back
    relayoutCards();
    applyPin();
    if (st.popover && st.popover.trigger === el.ctxBtn) anchorCtxPopover(st.popover.panel, el.ctxBtn);
  }

  // ---- keyboard + pointer routing ------------------------------------------
  function containsNode(rootEl, t) { return !!(t && t.nodeType && rootEl.contains(t)); }

  /** A dialog over the page (confirmModal, the stop modal, a viewer…) or a running tour owns Escape. */
  function modalUp() {
    return !!doc.querySelector('.viewer-modal:not(.hidden), .guide-layer');
  }

  /** Escape is the page's only while something of it is open: a popover. app.js's capture-phase Escape arms ask
   *  this BEFORE onDocKeydown closes anything. Never under a dialog, never from the terminal pane (vim, less), never
   *  from inside the run panel (P4 owns its keys), never one another handler already took (P4's panel close: one
   *  Escape closes one thing), never while the page is inert (the phone drawer is open over it). */
  function ownsKey(e) {
    if (e.key !== 'Escape' || e.defaultPrevented || st.destroyed || !st.open || modalUp() || el.page.closest('[inert]')) return false;
    if (e.target && typeof e.target.closest === 'function' && e.target.closest('.term-pane, [data-chat-panel]')) return false;
    if (e.target === el.historySearchInput) return false;   // the History search clears, then folds, before the overlay closes
    return !!st.popover || historyOverlayOpen();
  }

  function onDocKeydown(e) {
    if (!ownsKey(e)) return;
    e.preventDefault();
    if (st.popover) { closePopover({ focusTrigger: true }); return; }
    setHistoryOpen(false, { persist: false });       // the overlay (below 1100px) closes; focus back on its toggle
    try { el.historyBtn.focus(); } catch { /* detached */ }
  }

  /** A press outside the open popover (and its trigger) closes it. The page itself never closes on a press — the
   *  router owns it. A dialog (a confirm opened from a popover), the diff comment card, the shared terminal and the
   *  top bar search keep the popover. */
  function onDocPointerdown(e) {
    if (st.destroyed || !st.open || !st.popover) return;
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (st.popover.panel.contains(t) || st.popover.trigger.contains(t)) return;
    if (t.closest('.viewer-modal, #confirm-modal, .info-bubble, .mention-popup, .hd-cmt-card, .term-pane, .tsearch')) return;
    closePopover({ focusTrigger: false });
  }

  // ---- popover primitive (spec §10.6 .ask-pop) ------------------------------
  function closePopover({ focusTrigger = true } = {}) {
    const p = st.popover;
    if (!p) return;
    st.popover = null;
    p.panel.remove();
    if (p.onClose) { try { p.onClose(); } catch { /* ignore */ } }
    if (focusTrigger) { try { p.trigger.focus(); } catch { /* ignore */ } }
  }

  function menuItems(panel) { return [...panel.querySelectorAll('[role="menuitem"]:not([disabled]),[role="menuitemcheckbox"]:not([disabled]),[role="menuitemradio"]:not([disabled])')]; }

  function onPopKeydown(e) {
    const p = st.popover;
    if (!p) return;
    const items = menuItems(p.panel);
    if (!items.length) return;
    const idx = items.indexOf(doc.activeElement);
    const go = (i) => { const item = items[(i + items.length) % items.length]; item.tabIndex = 0; try { item.focus(); } catch { /* ignore */ } };
    if (e.key === 'ArrowDown') { e.preventDefault(); go(idx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(idx - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(items.length - 1); }
    else if ((e.key === 'Enter' || e.key === ' ') && idx >= 0) { e.preventDefault(); items[idx].click(); }
  }

  function openPopover({ panelClass, trigger, build, onClose, refreshOn, refresh }) {
    if (st.popover && st.popover.trigger === trigger) { closePopover({ focusTrigger: false }); return null; }
    closePopover({ focusTrigger: false });
    const panel = make('div', `menu ask-pop ${panelClass}`);
    panel.setAttribute('role', 'menu');
    panel.addEventListener('keydown', onPopKeydown);
    build(panel);
    // The composer's own popovers ride the composer (it moves between the hero slot and the dock); every other one
    // (a card's chip picker, the @-popover, the History popover) is anchored to the conversation column.
    (el.composer && el.composer.contains(trigger) ? el.composer : el.sheet).appendChild(panel);
    // refreshOn(dirty) → true re-runs build() on that flush (flushExtra), so an
    // OPEN popover follows the live meters / worktrees instead of freezing at open.
    // refresh(panel) is the server-fed twin: scheduleThreadsRefresh calls it
    // (debounced) on out-of-turn frames the model never sees.
    st.popover = { panel, trigger, onClose: onClose || null, build, refreshOn: refreshOn || null, refresh: refresh || null };
    const first = menuItems(panel)[0];
    if (first) { first.tabIndex = 0; try { first.focus(); } catch { /* ignore */ } }
    return panel;
  }

  /** Rebuild an open popover in place. Keyboard focus inside it moves to the item at the same place in
   *  the new list (or to the trigger when the list got shorter than that), so Escape and the arrows keep working. */
  function rebuildPopover(pop) {
    const at = pop.panel.contains(doc.activeElement) ? menuItems(pop.panel).indexOf(doc.activeElement) : null;
    pop.panel.replaceChildren();
    pop.build(pop.panel);
    if (at === null) return;
    const item = at >= 0 ? menuItems(pop.panel)[at] : null;
    if (item) item.tabIndex = 0;
    try { (item || pop.trigger).focus(); } catch { /* ignore */ }
  }

  function menuItem(className, onPick) {
    const b = make('button', `menu-item ask-pop-item ${className}`.trim());
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.tabIndex = -1;
    if (onPick) b.addEventListener('click', onPick);
    return b;
  }

  // ---- the History column (worca Chat P1) -----------------------------------
  /** History-row topics: the first one's name plus "+N", every name in the hover. Display-only — the row is the click target. */
  function threadTopics(t) {
    const list = validContexts(t.contexts);
    if (!list.length) return null;
    const name = (c) => c.label || c.id;
    const span = make('span', 'ask-thread-topics', list.length > 1 ? `${name(list[0])} +${list.length - 1}` : name(list[0]));
    span.title = list.map((c) => `${name(c)}${c.source === 'chat' ? ' (mentioned)' : ''}`).join('\n');
    return span;
  }

  // The start date leads the meter line, bold and on the primary ink, so the eye
  // scans it down the list while the cost/agent figures keep the meter's grey.
  // Hence an element rather than a string: only the date changes weight and
  // colour. An unusable createdAt drops the span and its separator with it.
  function threadMeter(t) {
    const meter = make('span', 'ask-thread-meter');
    const tot = t.totals || {};
    const when = fmtStarted(t.createdAt, now());
    if (when) meter.appendChild(make('span', 'ask-thread-when', when));
    // With a known window the fill is its own span (level colour + hover); without one it stays plain
    // text, so a legacy row's meter is exactly the date element plus "… · $x · n agents".
    const fillText = fmtCtx(tot.ctx, tot.ctxWindow);
    let fill = fillText;
    if (fillText && Number.isInteger(tot.ctxWindow) && tot.ctxWindow > 0) {
      const level = ctxLevel(tot.ctx, tot.ctxWindow);
      fill = make('span', `ask-thread-fill${level === 'warn' ? ' is-ctx-warn' : level === 'high' ? ' is-ctx-high' : ''}`, fillText);
      const title = ctxTitle(tot.ctx, tot.ctxWindow);
      if (title) fill.title = title;
    }
    const parts = [threadTopics(t), fill, fmtUsd(tot.costUsd), fmtAgents(tot.agents)].filter(Boolean);
    parts.forEach((p, i) => {
      if (when || i > 0) meter.appendChild(doc.createTextNode(' · '));
      meter.appendChild(typeof p === 'string' ? doc.createTextNode(p) : p);
    });
    return meter;
  }

  /** History meter: "12 chats" / "1 chat" / '' at 0 (same empty-string convention as the agents meter). */
  function fmtChats(n) {
    return Number.isFinite(n) && n > 0 ? `${n} chat${n === 1 ? '' : 's'}` : '';
  }
  /** History meter while searching: "3 of 54 chats" (the matches of every saved chat). */
  function fmtMatches(n, all) {
    return Number.isInteger(all) && all > 0 ? `${n} of ${all} chat${all === 1 ? '' : 's'}` : fmtChats(n);
  }

  // CONTRACT §1 aside.chat-history: every saved chat, newest first, grouped Today / Yesterday / Earlier by its last
  // activity; a row opens the chat, its trash deletes it (confirm). A 264px push column, an overlay with a scrim below
  // 1100px (style.css). The page's data-history attribute is the truth (setHistoryOpen, P4 reads and sets it).
  function buildHistory() {
    const aside = make('aside', 'chat-history');
    aside.setAttribute('data-chat-history', '');
    aside.id = 'chat-history';
    aside.setAttribute('aria-label', 'Chats');
    aside.tabIndex = -1;                             // the overlay takes focus when it opens (toggleHistory)
    // Below 1100px the column is an overlay over the chat: focus leaving it (Tab past the last row, Shift+Tab out)
    // closes it, so the keyboard never walks the controls hidden under it. A dialog it opened (delete) keeps it.
    aside.addEventListener('focusout', (e) => {
      const to = e.relatedTarget;
      if (!historyOverlayOpen() || !to || aside.contains(to) || (typeof to.closest === 'function' && to.closest('.viewer-modal'))) return;
      setHistoryOpen(false, { persist: false });
    });
    // The head is built once and kept across repaints (renderHistory touches only the meter's text and the body), so the
    // search box's slide (style.css .is-searching) runs and typing never loses the caret. Folded: "Chats  54 chats 🔍".
    // Open: "🔍 Search chats…  3 of 54 chats" — the box's left edge slides over the title and the meter's resting place
    // (the Workflows Library's search), and the meter rides at the end of the field.
    const head = make('div', 'chat-history-head');
    el.historyHead = head;
    head.appendChild(make('span', 'chat-history-title', 'Chats'));
    el.historyMeter = make('span', 'chat-history-meter', '');
    head.appendChild(el.historyMeter);
    head.appendChild(buildHistorySearch());
    aside.appendChild(head);
    // New chat leads the list, outside the body renderHistory repaints: a refresh or a search never drops it.
    aside.appendChild(newChatButton('chat-history-new'));
    el.historyBody = make('div', 'chat-history-body');
    aside.appendChild(el.historyBody);
    syncHistorySearch();
    return aside;
  }

  /** The search box: its button (aria-controls the field) and the field. The server searches titles and message text
   *  (GET /api/ask/threads?q=); the field only holds the text. */
  function buildHistorySearch() {
    const box = make('div', 'chat-history-sbox');
    const input = make('input', 'chat-history-search-input');
    input.id = 'chat-history-search';
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'Search chats…';
    input.setAttribute('aria-label', 'Search chats');
    const btn = iconButton('chat-history-search-btn', 'Search chats', ICONS.search, () => {
      if (!st.historySearchOpen) { st.historySearchOpen = true; syncHistorySearch(); input.focus(); return; }
      if (st.historyQuery) { input.focus(); return; }            // a field with text stays open
      closeHistorySearch(btn);
    });
    btn.id = 'chat-history-search-btn';
    btn.setAttribute('aria-controls', input.id);
    // Typing waits for a pause, then fetches: only the body repaints, so the caret and an IME composition survive.
    input.addEventListener('input', () => {
      st.historyQuery = input.value;
      clearTimeout(st.historySearchTimer);
      st.historySearchTimer = setTimeout(searchHistoryNow, HISTORY_SEARCH_MS);
      if (st.historySearchTimer && typeof st.historySearchTimer.unref === 'function') st.historySearchTimer.unref();
    });
    // Escape clears the text first, then folds the field (ownsKey leaves it to the field, even over the overlay).
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (st.historyQuery) { st.historyQuery = ''; input.value = ''; searchHistoryNow(); } else closeHistorySearch(btn);
    });
    box.append(btn, input);
    el.historySearch = box;
    el.historySearchBtn = btn;
    el.historySearchInput = input;
    return box;
  }
  /** The head follows the search state: the slide, aria-expanded, the folded field inert (no focus, no Tab stop), and
   *  the meter beside the button (folded) or at the end of the open field. */
  function syncHistorySearch() {
    const open = st.historySearchOpen;
    el.historyHead.classList.toggle('is-searching', open);
    el.historySearchBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    el.historySearchInput.toggleAttribute('inert', !open);
    if (el.historySearchInput.value !== st.historyQuery) el.historySearchInput.value = st.historyQuery;
    if (open) el.historySearch.appendChild(el.historyMeter);
    else el.historyHead.insertBefore(el.historyMeter, el.historySearch);
  }
  /** Fold the search and drop its text; `focusEl` takes the focus (the field goes inert — never leave it on <body>). */
  function closeHistorySearch(focusEl) {
    st.historyQuery = '';
    st.historySearchOpen = false;
    syncHistorySearch();
    searchHistoryNow();
    if (focusEl) focusEl.focus();
  }
  /** Run the search for the field's text now (the debounce ended, or Escape / a fold cleared it): fetch only when the
   *  list shows something else, so a fold with nothing searched fetches nothing. */
  function searchHistoryNow() {
    clearTimeout(st.historySearchTimer);
    st.historySearchTimer = null;
    if (st.destroyed) return;
    if (st.historyQuery.trim() !== st.historyListQuery) loadHistory();
  }
  function overlayMode() { return (win.innerWidth || 0) < HISTORY_OVERLAY_BELOW; }
  function historyOpen() { return !!el.page && el.page.dataset.history === 'open'; }
  function historyOverlayOpen() { return historyOpen() && overlayMode(); }
  /** Closed under an overlay width; else the stored choice; else open from 1600px. */
  function initialHistoryOpen() {
    if (overlayMode()) return false;
    let stored = null;
    try { stored = storage.getItem(HISTORY_KEY); } catch { stored = null; }
    if (stored === 'open' || stored === 'closed') return stored === 'open';
    return (win.innerWidth || 0) >= HISTORY_OPEN_MIN_W;
  }
  /** Open or close the column — synchronously, on the page's data-history. persist:false keeps the stored choice
   *  (an overlay's open/close, P4's auto-close beside the run panel). */
  function setHistoryOpen(open, { persist = true } = {}) {
    if (!el.page) return;
    el.page.dataset.history = open ? 'open' : 'closed';
    st.historyAsPush = !!open && !overlayMode();
    paintHistory();
    if (persist) { try { storage.setItem(HISTORY_KEY, open ? 'open' : 'closed'); } catch { /* a remembered choice is a nicety */ } }
  }
  function toggleHistory() {
    const opening = !historyOpen();
    setHistoryOpen(opening, { persist: !overlayMode() });
    if (opening && st.open) loadHistory();          // fresh rows whenever the column opens
    // The overlay sits before the chat in the DOM: keyboard users land in it, not behind it.
    if (opening && overlayMode()) { try { el.history.focus({ preventScroll: true }); } catch { /* detached */ } }
  }
  /** The toggle's pressed state and the overlay's scrim follow the column. */
  function paintHistory() {
    if (!el.page) return;
    const open = historyOpen();
    if (el.historyBtn) el.historyBtn.setAttribute('aria-pressed', String(open));
    if (el.scrim) el.scrim.hidden = !(open && overlayMode());
  }

  /** Fetch the list and paint it. A failed refresh keeps the rows already shown and marks the list stale, so the next
   *  show tries again (a boot whose endpoints failed does not keep "No saved chats." for good). While the column's
   *  search holds text, every fetch (a show, a refresh frame, a delete) asks for its matches. */
  function loadHistory() {
    st.historyStale = false;
    const gen = ++st.historyGen;
    const query = st.historyQuery.trim();
    st.historyListQuery = query;
    Promise.resolve()
      .then(() => fetch(query ? `/api/ask/threads?limit=50&q=${encodeURIComponent(query)}` : '/api/ask/threads?limit=50'))
      .then((r) => (r && r.ok ? r.json() : null))
      .catch(() => null)
      .then((body) => {
        if (st.destroyed || gen !== st.historyGen) return;
        if (!body || !Array.isArray(body.threads)) {
          st.historyStale = true;
          st.historyListQuery = null;            // the list still shows the last good answer: any text asks again
          if (!st.historyLoaded) renderHistory([], 0);
          return;
        }
        renderHistory(body.threads, body.total, query ? { query, all: body.all } : {});
      });
  }

  /** A refresh frame landed (a run some chat follows moved, a turn started or ended, a question notice, a title):
   *  refetch the list, debounced — a run transition fans out one frame per linked chat. Sits BEFORE
   *  pushServerFrame's threadId filter: the frame is usually for ANOTHER chat. While Chat is hidden it only marks the
   *  list stale; the next show fetches it. */
  function scheduleThreadsRefresh() {
    if (st.destroyed) return;
    if (!st.open) { st.historyStale = true; return; }
    if (st.threadsRefresh) return;
    st.threadsRefresh = setTimeout(() => {
      st.threadsRefresh = null;
      if (st.destroyed) return;
      if (st.open) loadHistory();
      else st.historyStale = true;                   // Chat was left inside the debounce: the next show fetches it
    }, THREADS_REFRESH_MS);
    if (st.threadsRefresh && typeof st.threadsRefresh.unref === 'function') st.threadsRefresh.unref();
  }

  /** Today / Yesterday / Earlier by the chat's last activity in the browser's own day; an unreadable date is Earlier. */
  function historyGroupOf(t, nowMs) {
    const ms = Date.parse((t && (t.updatedAt || t.createdAt)) || '');
    if (!Number.isFinite(ms)) return 'earlier';
    const day = new Date(nowMs);
    day.setHours(0, 0, 0, 0);
    if (ms >= day.getTime()) return 'today';
    const prev = new Date(day);
    prev.setDate(prev.getDate() - 1);
    return ms >= prev.getTime() ? 'yesterday' : 'earlier';
  }

  /** One row: the dots lead the title (green = this chat's turn is thinking; amber = a run it follows waits on you,
   *  else violet = a run it follows is running), the meter line under it, the trash on hover. */
  function historyRow(t) {
    const rowEl = make('div', 'ask-thread-row');
    rowEl.setAttribute('role', 'listitem');
    rowEl.dataset.threadId = t.id;
    const pick = make('button', 'menu-item ask-pop-item ask-thread-pick');
    pick.type = 'button';
    pick.appendChild(make('span', `ask-dot ask-thread-dot${t.inFlight ? ' ask-dot-live' : ''}`));
    pick.appendChild(make('span', `ask-dot ask-thread-dot${t.waiting ? ' ask-dot-wait' : t.tracking ? ' ask-dot-track' : ''}`));
    const col = make('span', 'ask-thread-col');
    // A null title = the haiku title has not landed yet; "New chat" is the label the turn falls back to.
    col.appendChild(make('span', 'ask-thread-title', t.title || 'New chat'));
    // A search hit in a message (not in the title): the server's excerpt around it, as text.
    const snippet = t.match && typeof t.match.snippet === 'string' ? t.match.snippet : '';
    if (snippet) col.appendChild(make('span', 'ask-thread-match', snippet));
    col.appendChild(threadMeter(t));
    pick.appendChild(col);
    const status = [t.inFlight ? 'Replying' : '', t.waiting ? 'Needs you' : (t.tracking ? 'Following a run' : '')].filter(Boolean).join(', ');
    if (status) pick.appendChild(make('span', 'sr-only', status));
    pick.addEventListener('click', () => {
      const overlay = historyOverlayOpen();
      if (overlay) setHistoryOpen(false, { persist: false });   // the overlay gives the chat its room
      showThread(t.id);
      route(t.id);
      if (overlay) focusComposer();                  // the picked row is hidden now: focus goes to the chat
    });
    rowEl.appendChild(pick);
    rowEl.appendChild(buildThreadTrash(t));
    return rowEl;
  }

  /** Paint the list (rows replaced in place; keyboard focus inside the column stays on the same chat's button). A
   *  `query` = these are its matches: the meter reads "n of N chats" (`all` = every saved chat), none = "No chats match." */
  function renderHistory(threads, total, { query = '', all = null } = {}) {
    if (!el.historyBody) return;
    st.historyLoaded = true;
    const n = Number.isInteger(total) && total >= 0 ? total : threads.length;
    el.historyMeter.textContent = query ? fmtMatches(n, all) : fmtChats(n);
    const buttons = () => [...el.historyBody.querySelectorAll('button')];
    const focusAt = el.historyBody.contains(doc.activeElement) ? buttons().indexOf(doc.activeElement) : -1;
    // A refresh can reorder the rows: focus follows the chat; a row that is gone (deleted) falls back to the index.
    const focusRow = focusAt >= 0 ? doc.activeElement.closest('.ask-thread-row') : null;
    const focusId = focusRow ? focusRow.dataset.threadId : null;
    const focusSel = focusRow && doc.activeElement.classList.contains('ask-thread-trash') ? '.ask-thread-trash' : '.ask-thread-pick';
    el.historyBody.replaceChildren();
    if (!threads.length) {
      el.historyBody.appendChild(make('div', 'chat-history-empty', query ? 'No chats match.' : 'No saved chats.'));
      // The focused row went with the list (the last chat deleted): the column keeps the focus, never <body>.
      if (focusAt >= 0) { try { el.history.focus({ preventScroll: true }); } catch { /* detached */ } }
      return;
    }
    const t0 = now();
    for (const [key, label] of HISTORY_GROUPS) {
      const rows = threads.filter((t) => t && t.id && historyGroupOf(t, t0) === key);
      if (!rows.length) continue;
      const group = make('div', 'chat-history-group');
      group.dataset.group = key;
      const cap = make('div', 'chat-history-group-label', label);
      cap.id = `chat-history-${key}`;
      group.appendChild(cap);
      const list = make('div', 'ask-threads-list');
      list.setAttribute('role', 'list');
      list.setAttribute('aria-labelledby', cap.id);
      for (const t of rows) list.appendChild(historyRow(t));
      group.appendChild(list);
      el.historyBody.appendChild(group);
    }
    paintHistoryCurrent();
    if (focusAt >= 0) {
      const same = focusId ? [...el.historyBody.querySelectorAll('.ask-thread-row')].find((r) => r.dataset.threadId === focusId) : null;
      const b = (same && same.querySelector(focusSel)) || buttons()[Math.min(focusAt, buttons().length - 1)];
      if (b) { try { b.focus(); } catch { /* ignore */ } }
    }
  }

  /** Mark the chat the page shows (or is loading). */
  function paintHistoryCurrent() {
    if (!el.historyBody) return;
    const cur = typeof st.wantThread === 'string' ? st.wantThread : st.threadId;
    for (const rowEl of el.historyBody.querySelectorAll('.ask-thread-row')) {
      const on = !!cur && rowEl.dataset.threadId === cur;
      rowEl.classList.toggle('is-current', on);
      const pick = rowEl.querySelector('.ask-thread-pick');
      if (on) pick.setAttribute('aria-current', 'true');
      else pick.removeAttribute('aria-current');
    }
  }

  // ---- catalog + picker (D8) ------------------------------------------------
  function catalogEntry(id) { return st.catalog ? st.catalog.models.find((m) => m && m.id === id) || null : null; }
  /** The engine this chat is locked to (D12), or null for a chat without a turn yet. */
  function lockedEngine() {
    const thread = st.model && typeof st.model.thread === 'function' ? st.model.thread() : null;
    return chatEngineOf(st.model ? st.model.messages() : [], st.picker.model, st.catalog, thread && thread.engine);
  }
  /** The engine the next message will run on: the lock, else the picked model's. */
  function pickerEngine() { return lockedEngine() || engineOfEntry(catalogEntry(st.picker.model)); }

  function updatePickerButton() {
    if (!el.modelBtnLabel) return;
    const entry = catalogEntry(st.picker.model);
    // Same '⚠' marker the run-graph node label uses (ui/public/app.js:998).
    const flagged = !!entry && (entry.costUnreliable === true
      || (Array.isArray(entry.secretsMissing) && entry.secretsMissing.length > 0));
    el.modelBtnLabel.textContent = (entry ? entry.label : st.picker.model) + (flagged ? ' ⚠' : '');
    // A model that takes no reasoning effort shows none (the bridge leaves it out).
    el.modelBtnEffort.textContent = entry && entry.noEffort ? '' : st.picker.effort;
    el.modelBtnEffort.hidden = !!(entry && entry.noEffort);
  }

  function coerceEffort(entry, effort) {
    if (!entry || !Array.isArray(entry.efforts) || entry.efforts.includes(effort)) return effort;
    return entry.efforts.includes('high') ? 'high' : entry.efforts[0];
  }

  /** The backend's D8 default, or the cold-start literal for a payload without one. */
  function catalogDefault() {
    const d = st.catalog && st.catalog.default;
    if (d && typeof d.model === 'string' && typeof d.effort === 'string') return { model: d.model, effort: d.effort };
    return { ...FALLBACK_PICK };
  }

  function applyCatalogToPicker() {
    const list = st.catalog && Array.isArray(st.catalog.models) ? st.catalog.models : [];
    // A thread's model the catalog no longer has (a removed user model) falls back
    // to the browser-level pick, then the backend default. The thread is not
    // patched: its next send stores whatever is used.
    if (st.pickerFromThread && list.length && !catalogEntry(st.picker.model)) { restoreBrowserPick(); return; }
    const fallback = catalogDefault();
    // Each slot is decided by its own provenance: a stored MODEL outranks the backend
    // default, and a stored EFFORT survives even when the model comes from the default.
    // (effortFromStore ⊇ pickerFromStore — a stored model always carries its effort.)
    // A thread's pick claims both slots.
    // D12/D17: a new chat starts on the user's Ask engine; a stored pick of the OTHER engine does not override it.
    const askEngine = st.catalog && ASK_CHAT_ENGINES.includes(st.catalog.askEngine) ? st.catalog.askEngine : 'claude';
    const storeFits = st.pickerFromStore && (st.pickerExplicit || !catalogEntry(st.picker.model) || engineOfEntry(catalogEntry(st.picker.model)) === askEngine);
    if (st.pickerFromStore && !storeFits && !st.pickerFromThread) {
      // The stored pick is the other engine's: this chat claims neither its model nor its effort (the Ask slot's pair
      // applies), and nothing short of an explicit model choice writes over it (storeModel).
      st.pickerFromStore = false;
      st.effortFromStore = false;
      st.storeOtherEngine = true;
    }
    const wanted = {
      model: st.pickerFromThread || storeFits ? st.picker.model : fallback.model,
      effort: st.pickerFromThread || st.effortFromStore ? st.picker.effort : fallback.effort,
    };
    const wantedEntry = catalogEntry(wanted.model);
    if (!wantedEntry && list.length) st.pickerExplicit = false;   // the picked model left the catalog: the fallback below is not a user pick
    // Unknown stored/default id -> the backend default -> the first model we do
    // have that is not a hidden built-in (#422; a hidden id is still a valid pick).
    const entry = wantedEntry || catalogEntry(fallback.model) || list.find((m) => m && !m.hidden && !m.needsSignIn) || list[0] || null;
    if (!entry) { updatePickerButton(); return; }  // empty catalog: keep what we have
    const effort = wantedEntry ? wanted.effort : fallback.effort;
    const next = { model: entry.id, effort: coerceEffort(entry, effort) };
    const changed = next.model !== st.picker.model || next.effort !== st.picker.effort;
    if (next.model !== st.picker.model) scheduleMcpRefresh();   // MCP registry §9.4: the model sets the §5.6 tool-name limit
    st.picker = next;
    // D11: persist ONLY a repair of a pick the user actually made. Writing the
    // backend default here would make it authoritative exactly once, ever — and a
    // thread's pick is never the browser's.
    if (changed && storeFits && !st.pickerFromThread) storeModel();
    updatePickerButton();
  }

  /** Back to the browser-level pick (new chat, a thread with no model of its own). */
  function restoreBrowserPick() {
    const home = browserPick();
    st.picker = home.picker;
    st.pickerFromStore = home.pickerFromStore;
    st.effortFromStore = home.effortFromStore;
    st.storeOtherEngine = false;
    st.pickerFromThread = false;
    st.pickerExplicit = false;
    if (st.catalog) applyCatalogToPicker();
    else updatePickerButton();
  }

  /** A thread SWITCH shows that thread's last model/effort; a row without one gets the browser-level pick. */
  function applyThreadPick(thread) {
    const t = thread && typeof thread === 'object' ? thread : null;
    if (!t || typeof t.model !== 'string' || !t.model || typeof t.effort !== 'string' || !t.effort) { restoreBrowserPick(); return; }
    st.picker = { model: t.model, effort: t.effort };
    st.pickerFromThread = true;
    st.pickerExplicit = false;
    if (st.catalog) applyCatalogToPicker();   // effort coerced against the entry; a dropped model falls back
    else updatePickerButton();               // the raw id shows until the catalog lands
  }

  /** Keep the pick on the open thread, so switching away and back finds it before any send. */
  function persistThreadPick() {
    const id = st.threadId;
    if (!id) return;                           // a brand-new chat: the first send stores it
    const body = JSON.stringify({ model: st.picker.model, effort: st.picker.effort });
    Promise.resolve()
      .then(() => fetch(`/api/ask/threads/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }))
      .catch(() => { /* the next message stores the pick anyway */ });
  }

  // fresh: fetch again even with a catalog in hand. Models imported (or keys set on the key
  // page) after the first load reach the menu when it next opens, without a page reload.
  function loadCatalog({ fresh = false } = {}) {
    if (st.catalog && !fresh) return Promise.resolve(st.catalog);
    if (st.catalogLoading) return st.catalogLoading;
    st.catalogLoading = Promise.resolve()
      .then(() => fetch('/api/ask/models'))
      .then((r) => (r && r.ok ? r.json() : null))
      .catch(() => null)
      .then((body) => {
        st.catalogLoading = null;
        if (body && Array.isArray(body.models)) { st.catalog = body; applyCatalogToPicker(); }
        return st.catalog;
      });
    return st.catalogLoading;
  }

  /** restore: false when the route names the chat (app.js always routes) — the stored pointer is for a bare open(). */
  function ensureFirstOpen({ restore = true } = {}) {
    if (st.firstOpenDone) return;
    st.firstOpenDone = true;
    loadCatalog();
    const stored = restore ? readStoredThread() : null;
    if (stored && !st.threadId) switchThread(stored);
  }

  /**
   * Primary-list grouping key. Claude ids group by family; a PLUGIN model groups by
   * its plugin, so a plugin shipping ten ids contributes one primary row and the rest
   * land under "More models" — instead of each foreign id becoming its own "family"
   * (the old `|| m.id` fallback) and flooding the list. A Copilot built-in (copilot/<id>) groups by its model family
   * (claude-sonnet, gpt, gemini, …), so the newest of each is up front. Anything else shares one 'other' bucket.
   */
  function familyKey(m) {
    if ((m.engine || 'claude') === 'copilot' && m.id.startsWith('copilot/')) {
      return `copilot:${(m.id.slice('copilot/'.length).match(/^[a-z]+(?:-[a-z]+)*/) || ['other'])[0]}`;
    }
    const fam = (m.id.match(/^claude-(opus|fable|sonnet|haiku)-/) || [])[1];
    if (fam) return `claude:${fam}`;
    if (m.custom === 'plugin' && m.plugin) return `plugin:${m.plugin}`;
    return 'other';
  }

  function splitCatalog(list = st.catalog ? st.catalog.models : []) {
    const primary = [];
    const rest = [];
    const seen = new Set();
    for (const m of list) {
      if (!m || typeof m.id !== 'string') continue;
      if (m.hidden && m.id !== st.picker.model) continue;         // hidden built-in (#422); the current pick stays
      if (m.needsSignIn && m.id !== st.picker.model) continue;    // bridged, provider not usable (model-bridge §8.5)
      if (m.custom === 'global') { primary.push(m); continue; }   // user models are never demoted
      const fam = familyKey(m);
      // The picked model always shows up front so its ✓ is visible and it is one click away.
      if (seen.has(fam) && m.id !== st.picker.model) rest.push(m);
      else { seen.add(fam); primary.push(m); }
    }
    return { primary, rest };
  }

  function setPickerModel(id) {
    st.picker = { model: id, effort: coerceEffort(catalogEntry(id), st.picker.effort) };
    st.pickerFromStore = true;                      // an explicit model choice claims the slot (D11)
    st.effortFromStore = true;
    st.storeOtherEngine = false;
    st.pickerFromThread = false;                    // the user's own pick now, not the thread's
    st.pickerExplicit = true;
    storeModel();
    persistThreadPick();
    updatePickerButton();
    scheduleMcpRefresh();                           // the model sets the §5.6 tool-name limit
    closePopover({ focusTrigger: false });
    focusComposer();
  }

  function setPickerEffort(effort) {
    st.picker = { ...st.picker, effort };
    st.effortFromStore = true;                      // the effort only — the model slot is untouched (D11)
    storeModel();
    persistThreadPick();
    updatePickerButton();
    closePopover({ focusTrigger: false });
    focusComposer();
  }

  function openModelPopover(trigger) {
    const panel = openPopover({ panelClass: 'ask-pop-model', trigger, build: () => {} });
    if (!panel) return;
    const focusFirst = () => { const f = menuItems(panel)[0]; if (f) { f.tabIndex = 0; try { f.focus(); } catch { /* ignore */ } } };
    const tag = (text, variant, title) => {
      const t = make('span', variant ? `ask-model-tag ${variant}` : 'ask-model-tag', text);
      if (title) t.title = title;
      return t;
    };
    const modelItem = (m) => {
      const item = menuItem('ask-model-item', () => setPickerModel(m.id));
      // The row carries NO provenance: a plugin name is arbitrary text and an origin
      // badge starved the label in a 292px panel. Where a model comes from is the
      // Models view's job; here the name is the thing being picked.
      item.appendChild(make('span', 'ask-model-name', m.label || m.id));
      // The two STATUS badges stay (models-view.mjs:116,120-123) — they are warnings, not provenance.
      if (m.costUnreliable) {
        item.appendChild(tag('⚠cost', 'is-warn',
          'This model reported no cost while consuming tokens. Chat spend may not count toward the budget.'));
      }
      if (Array.isArray(m.secretsMissing) && m.secretsMissing.length) {
        item.appendChild(tag('secret not set', 'is-err',
          `${m.secretsMissing.join(', ')} is not set. Configure it in the ${m.plugin ? `“${m.plugin}” ` : ''}plugin's Model secrets, or this model will fail.`));
      }
      if (m.needsSignIn) {
        item.appendChild(tag('needs sign-in', 'is-err', m.signInMessage || 'The provider behind this model is not usable yet. See the Providers page.'));
      }
      // Credential broker: whether the signed-in person has the key this model spends from.
      const cb = credentialBadge(m.id);
      if (cb) item.appendChild(tag(cb.text, cb.missing ? 'is-err' : 'is-key', cb.title));
      if (m.id === st.picker.model) item.appendChild(checkMark());
      return item;
    };
    // Inside an engine's section the models group by connection, like every model picker (modelGroups); a sub-heading
    // only when the section holds more than one connection.
    const appendByConnection = (models, engine) => {
      const groups = modelGroups(models, { engine });
      for (const c of groups) {
        if (groups.length > 1) panel.appendChild(make('div', 'ask-pop-subgroup', c.label));
        for (const m of c.models) panel.appendChild(modelItem(m));
      }
    };
    let shownPane = 'main';
    let effortPaneKey = '';   // the model + effort list the effort pane was painted from
    const effortKeyNow = () => { const e = catalogEntry(st.picker.model); return `${st.picker.model}:${e && Array.isArray(e.efforts) ? e.efforts.join() : ''}`; };
    const renderPane = (pane) => {
      shownPane = pane;
      if (pane === 'effort') effortPaneKey = effortKeyNow();
      panel.replaceChildren();
      if (pane === 'effort') {
        const back = menuItem('ask-pane-back', () => renderPane('main'));
        back.setAttribute('data-ask-pane-back', '');
        back.appendChild(make('span', null, '‹ Effort'));
        panel.appendChild(back);
        panel.appendChild(make('div', 'ask-pop-divider'));
        const entry = catalogEntry(st.picker.model);
        for (const eff of entry && Array.isArray(entry.efforts) ? entry.efforts : ['medium', 'high', 'xhigh', 'max']) {
          const item = menuItem('ask-effort-item', () => setPickerEffort(eff));
          item.appendChild(make('span', 'ask-model-name', eff));
          if (eff === st.picker.effort) item.appendChild(checkMark());
          panel.appendChild(item);
        }
      } else if (pane === 'more') {
        const back = menuItem('ask-pane-back', () => renderPane('main'));
        back.setAttribute('data-ask-pane-back', '');
        back.appendChild(make('span', null, '‹ Models'));
        panel.appendChild(back);
        panel.appendChild(make('div', 'ask-pop-divider'));
        // Each engine's more models under its name, as in the main pane, when more than one engine has some.
        const more = pickerGroups(st.catalog ? st.catalog.models : [], { lock: lockedEngine() })
          .map((g) => ({ ...g, rest: splitCatalog(g.models).rest })).filter((g) => g.rest.length);
        for (const g of more) {
          if (more.length > 1) panel.appendChild(make('div', 'ask-pop-group', g.label));
          appendByConnection(g.rest, g.engine);
        }
      } else {
        // D12: a new chat shows each engine under its name; inside a chat only the chat's engine is offered.
        const sections = pickerGroups(st.catalog ? st.catalog.models : [], { lock: lockedEngine() });
        const rest = [];
        for (const g of sections) {
          if (sections.length > 1) panel.appendChild(make('div', 'ask-pop-group', g.label));
          const split = splitCatalog(g.models);
          appendByConnection(split.primary, g.engine);
          rest.push(...split.rest);
        }
        panel.appendChild(make('div', 'ask-pop-divider'));
        const noEffort = !!catalogEntry(st.picker.model)?.noEffort;
        const effortRow = menuItem('ask-effort-row', noEffort ? null : () => renderPane('effort'));
        effortRow.setAttribute('data-ask-effort-row', '');
        effortRow.appendChild(make('span', null, 'Effort'));
        if (noEffort) {
          // The model's provider refused a reasoning effort; worca leaves it out of the request.
          effortRow.disabled = true;
          effortRow.title = 'This model takes no reasoning effort, so none is sent.';
          effortRow.appendChild(make('span', 'ask-pop-row-value', 'not supported'));
        } else {
          effortRow.appendChild(make('span', 'ask-pop-row-value', st.picker.effort));
          effortRow.appendChild(make('span', 'ask-pop-row-chev', '›'));
        }
        panel.appendChild(effortRow);
        if (rest.length) {
          const moreRow = menuItem('ask-more-models', () => renderPane('more'));
          moreRow.setAttribute('data-ask-more-models', '');
          moreRow.appendChild(make('span', null, 'More models'));
          moreRow.appendChild(make('span', 'ask-pop-row-chev', '›'));
          panel.appendChild(moreRow);
        }
      }
      focusFirst();
    };
    // What we have paints at once; the refetch repaints the main pane if it is still showing.
    const had = st.catalog;
    loadCatalog({ fresh: true }).then((c) => {
      if (c === had || !st.popover || st.popover.panel !== panel) return;
      // The effort pane repaints only when the refresh changed what it lists (a dropped model fell back): a repaint moves focus.
      if (shownPane === 'main' || (shownPane === 'effort' && effortKeyNow() !== effortPaneKey)) renderPane(shownPane);
    });
    renderPane('main');
  }

  // ---- MCP picker (MCP registry §9.4) -----------------------------------------
  const MCP_ROUTE_LABEL = { pinned: 'pinned', page: 'this page', worktree: 'open worktree' };
  const mcpOffOf = (v) => ({
    sets: v && Array.isArray(v.sets) ? [...v.sets] : [],
    members: v && Array.isArray(v.members) ? [...v.members] : [],
  });

  /** One POST /api/ask/mcp-preview per tick, whatever asked for it; only while the sheet is open. */
  function scheduleMcpRefresh() {
    if (st.mcp.queued || st.destroyed || !st.open) return;
    st.mcp.queued = true;
    Promise.resolve().then(refreshMcp);
  }

  async function refreshMcp() {
    st.mcp.queued = false;
    const gen = ++st.mcp.gen;
    const body = {
      context: scopedContext(getPageContext() || {}),
      mcpOff: st.mcp.off,                       // the client holds the choices: they override the stored ones
      ...(st.picker.model ? { model: st.picker.model } : {}),
      ...(st.threadId ? { threadId: st.threadId } : {}),
    };
    let data = null;
    try {
      const r = await fetch('/api/ask/mcp-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      data = r && r.ok ? await r.json() : null;
    } catch { data = null; }
    if (gen !== st.mcp.gen || st.destroyed) return;
    st.mcp.failed = !(data && Array.isArray(data.sets));
    st.mcp.preview = st.mcp.failed ? null : data;
    const p = st.mcp.preview;
    // A failed preview leaves the chip as it was (the open picker says so): the user can reopen it to retry.
    // §4.6: registry MCP servers are offered in Claude chats only; a Codex chat's preview carries its set skills alone
    // (#635), so the picker shows there when a set has skills.
    if (p) el.mcpBtn.hidden = !p.sets.some((x) => x.members > 0 || (x.skills || 0) > 0);
    el.mcpBtnLabel.textContent = p ? `Sets · ${p.started + ((p.skills && p.skills.started) || 0)}` : 'Sets · ?';
    if (st.mcp.render) st.mcp.render();
  }

  /** Save the choices: every message carries them; once a thread exists they are also PATCHed (card-event turns and
   *  reloads read the stored value) — one PATCH at a time, in toggle order, since two in flight can land out of order. */
  function patchMcpOff(tid, value) {
    const body = JSON.stringify({ mcpOff: value });
    st.mcp.saving = st.mcp.saving
      .then(() => fetch(`/api/ask/threads/${tid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }))
      .catch(() => { /* the picker keeps the choice; the next message carries it */ });
  }
  function setMcpOff(next) {
    st.mcp.off = next;
    if (st.threadId) patchMcpOff(st.threadId, next);
    if (st.mcp.render) st.mcp.render();          // the switch moves now; the counts follow the preview
    scheduleMcpRefresh();
  }
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  function mcpSwitch(on, label, onToggle, focusKey) {
    const b = make('button', `switch ask-mcp-switch${on ? ' on' : ''}`);
    b.dataset.mcpKey = focusKey;
    b.type = 'button';
    b.setAttribute('role', 'menuitemcheckbox');
    b.setAttribute('aria-checked', String(on));
    b.setAttribute('aria-label', label);
    b.tabIndex = -1;
    b.addEventListener('click', onToggle);
    return b;
  }

  function mcpManageItem(text, hash) {
    const item = menuItem('ask-mcp-manage', () => {
      closePopover({ focusTrigger: false });        // the route hides the page; the picker goes first
      if (win.location.hash !== hash) win.location.hash = hash.slice(1);
    });
    item.dataset.mcpKey = 'manage';                 // a re-render keeps focus on the footer too
    item.appendChild(make('span', null, text));
    return item;
  }

  const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  /** Skills registry §6.8: a level-1 set row's small line — "2 servers · 1 skill · pinned". */
  function setSummary(x) {
    const route = x.routes[0]?.route;               // the resolver sorts a set's routes by rank
    return [x.members ? plural(x.members, 'server') : '', x.skills ? plural(x.skills, 'skill') : '',
      x.group === 'set' && route ? MCP_ROUTE_LABEL[route] || route : ''].filter(Boolean).join(' · ');
  }
  /** One level-2 membership: a live switch (started, or switched off in this chat), else a disabled row with its reason
   *  (§5.7 wording: choices muted, problems amber). `key` is the membership key mcpOff.members holds. */
  function pickerMember(panel, set, setOff, { name, key, skip, why, problem }) {
    if (skip && skip.reason !== 'chat-off') {
      const item = menuItem(`ask-mcp-member is-skipped${problem ? ' is-problem' : ''}`);
      item.disabled = true;
      item.appendChild(make('span', 'ask-model-name', name));
      item.appendChild(make('span', 'ask-pop-row-value', why));
      panel.appendChild(item);
      return;
    }
    const row = make('div', 'ask-mcp-row');
    row.setAttribute('role', 'none');
    row.appendChild(make('span', 'ask-mcp-copy', name));
    const sw = mcpSwitch(!setOff && !st.mcp.off.members.includes(key), name,
      () => setMcpOff({ ...st.mcp.off, members: toggle(st.mcp.off.members, key) }), `member:${key}`);
    if (setOff) { sw.disabled = true; sw.title = `${set.name} is off in this chat`; }   // the whole set is off
    row.appendChild(sw);
    panel.appendChild(row);
  }
  // Switches first, then the disabled rows (Appendix B 10, P4); by the name each shows.
  const memberOrder = (a, b) => (Number(!!a.skip && a.skip.reason !== 'chat-off') - Number(!!b.skip && b.skip.reason !== 'chat-off'))
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const layerLine = (sk) => `skills from sets not loaded: ${sk.layer.text || sk.layer.blocked}`;

  function openMcpPopover(trigger) {
    const panel = openPopover({ panelClass: 'ask-pop-mcp', trigger, build: () => {}, onClose: () => { st.mcp.render = null; } });
    if (!panel) return;
    let pane = null;                                // null = level 1; else the set id drilled into
    let first = true;
    const render = (focusKey = null) => {
      const p = st.mcp.preview || { sets: [], copies: [], skipped: [] };
      const sk = p.skills || { mounted: [], skipped: [], started: 0, layer: { blocked: null, text: null } };
      // A re-render (a toggle, a preview landing) keeps keyboard focus on the same control.
      const keep = focusKey ?? (panel.contains(doc.activeElement) ? doc.activeElement.dataset.mcpKey || '' : null);
      panel.replaceChildren();
      const set = pane ? p.sets.find((x) => x.id === pane) : null;
      if (pane && set) {
        // Level 2: one row per membership of the set; a skipped one is a disabled row with its reason.
        const back = menuItem('ask-pane-back', () => { const from = pane; pane = null; render(`drill:${from}`); });
        back.setAttribute('data-ask-pane-back', '');
        back.appendChild(make('span', null, `‹ ${set.name}`));
        panel.appendChild(back);
        panel.appendChild(make('div', 'ask-pop-divider'));
        const setOff = st.mcp.off.sets.includes(set.id);
        const servers = [
          ...p.copies.filter((c) => c.setId === set.id).map((c) => {
            const note = mcpCopyNote(p, c);                                     // §4.4 name provisional, §5.6 withheld tools
            return { name: note ? `${c.name} · ${note}` : c.name, key: `${set.id}|${c.serverId}`, skip: null };
          }),
          ...p.skipped.filter((x) => x.setId === set.id).map((x) => {
            const v = mcpSkipView(x);                                           // §5.7 in the New Pipeline picker's wording
            return { name: v.name, key: `${set.id}|${x.serverId}`, skip: x, why: v.why, problem: v.problem };
          }),
        ].sort(memberOrder);
        // Skills registry §6.8: then the set's skills; a blocked layer (§2b-14) lists none — one muted line, P4's rule.
        const blocked = !!(sk.layer && sk.layer.blocked);
        const skills = blocked ? [] : [
          ...sk.mounted.filter((m) => m.setId === set.id).map((m) => ({ name: m.qualifiedName, key: `${set.id}|${m.id}`, skip: null })),
          ...sk.skipped.filter((x) => x.setId === set.id).map((x) => {
            const v = skillSkipView(x);                                         // P4's New Pipeline wording (needs-consent: "off — …")
            return { name: v.name, key: `${set.id}|${x.skillId}`, skip: x, why: v.why, problem: x.problem === true };
          }),
        ].sort(memberOrder);
        const hasSkills = skills.length > 0 || (blocked && (set.skills || 0) > 0);
        if (hasSkills && servers.length) panel.appendChild(make('div', 'ask-pop-caption', 'Servers'));
        for (const m of servers) pickerMember(panel, set, setOff, m);
        if (hasSkills) {
          panel.appendChild(make('div', 'ask-pop-caption', 'Skills'));
          if (blocked) panel.appendChild(make('div', 'ask-pop-empty', layerLine(sk)));
          for (const m of skills) pickerMember(panel, set, setOff, m);
        }
        panel.appendChild(make('div', 'ask-pop-divider'));
        panel.appendChild(mcpManageItem(`Manage in Connectors › ${set.name}`, `#connectors/sets/${encodeURIComponent(set.id)}`));
      } else {
        pane = null;
        // Level 1: one row per set in play, in the resolver's picker order (General, user sets by rank, Team).
        for (const x of p.sets) {
          const row = make('div', 'ask-mcp-row');
          row.setAttribute('role', 'none');
          row.appendChild(mcpSwitch(!st.mcp.off.sets.includes(x.id), x.name,
            () => setMcpOff({ ...st.mcp.off, sets: toggle(st.mcp.off.sets, x.id) }), `set:${x.id}`));
          const drill = menuItem('ask-mcp-set', () => { pane = x.id; render(); });
          drill.dataset.mcpKey = `drill:${x.id}`;
          const name = make('span', 'ask-model-name', x.name);
          const summary = setSummary(x);
          if (summary) name.appendChild(make('small', null, summary));
          drill.appendChild(name);
          drill.appendChild(make('span', 'ask-pop-row-value', `${x.started + (x.startedSkills || 0)}/${x.members + (x.skills || 0)}`));
          drill.appendChild(make('span', 'ask-pop-row-chev', '›'));
          row.appendChild(drill);
          panel.appendChild(row);
        }
        // Before the first preview lands, or when it failed: say so rather than show an empty menu.
        if (!p.sets.length) panel.appendChild(make('div', 'ask-pop-empty', st.mcp.failed ? 'Could not load the sets. Reopen to retry.' : !st.mcp.preview ? 'Loading…' : 'No sets in play.'));
        // Skills registry §4.1: a host whose Claude Code refuses --plugin-dir mounts no skill — one muted line.
        if (sk.layer && sk.layer.blocked) panel.appendChild(make('div', 'ask-pop-empty', layerLine(sk)));
        // §4.6 (#635): a Codex chat starts the sets' skills but none of their MCP servers — said, never just left out.
        if (p.codexServers > 0) panel.appendChild(make('div', 'ask-pop-empty', 'MCP servers from sets are available in Claude chats'));
        panel.appendChild(make('div', 'ask-pop-divider'));
        panel.appendChild(mcpManageItem('Manage on the Connectors page', '#connectors'));
      }
      if (first || keep !== null) {
        const items = menuItems(panel);
        const f = items.find((x) => keep && x.dataset.mcpKey === keep) || items[0];
        if (f) { f.tabIndex = 0; try { f.focus(); } catch { /* ignore */ } }
      }
      first = false;
    };
    st.mcp.render = render;
    render();
    scheduleMcpRefresh();
  }

  // ---- scope selector (#397) ------------------------------------------------
  /** Per-field merge: the page context's TARGET keys never ride (CONTRACT §4); view/run/diff-file context still
   *  follow the page. A pin adds its one key. No project sends pinned:false and no page target, so the server never
   *  resurrects a stale thread pin over an explicit choice. */
  function scopedContext(page) {
    const ctx = { ...page };
    delete ctx.projectDir;
    delete ctx.projectKey;
    delete ctx.workspaceId;
    delete ctx.projectSource;                     // the fallback tag goes with the target keys (MCP registry §9.1)
    if (!st.scope.pinned) return { ...ctx, pinned: false };
    ctx.pinned = true;
    if (st.scope.projectKey) ctx.projectKey = st.scope.projectKey;
    else if (st.scope.workspaceId) ctx.workspaceId = st.scope.workspaceId;
    return ctx;
  }

  function updateScopeButton() {
    if (!el.scopeLabel) return;
    const label = st.scope.pinned
      ? (st.scope.label || st.scope.projectKey || st.scope.workspaceId)
      : NO_PROJECT_LABEL;
    el.scopeLabel.textContent = label;
    el.scopeBtn.setAttribute('aria-label', `Chat scope: ${label}`);
    el.scopeBtn.title = `Chat scope: ${label}`;
    const kind = scopeKind(st.scope);
    if (kind !== el.scopeIcoKind) {
      const ico = scopeIcon(doc, kind, 13);
      el.scopeIco.replaceWith(ico);
      el.scopeIco = ico;
      el.scopeIcoKind = kind;
    }
    el.scopeBtn.classList.toggle('is-pinned', st.scope.pinned);
    if (el.fitScope) el.fitScope();
  }

  /** `persist:false` sends no PATCH (the server stored it already); `focus:false` neither closes popovers nor focuses
   *  the composer (the panel API and server switches never move the focus). */
  function setScope(next, { persist = true, focus = true } = {}) {
    st.scope = {
      pinned: !!next.pinned,
      projectKey: next.projectKey || null,
      workspaceId: next.workspaceId || null,
      label: next.label || null,
    };
    updateScopeButton();
    scheduleMcpRefresh();
    if (focus) {
      closePopover({ focusTrigger: false });
      focusComposer();
    }
    // Persist on the thread so the pin survives reload with no message sent. A
    // brand-new chat has no row yet — the first message's context (pinned:true)
    // persists it then instead.
    if (!persist || !st.threadId) return;
    const id = st.threadId;
    const scope = st.scope.pinned
      ? (st.scope.projectKey ? { pinned: true, projectKey: st.scope.projectKey } : { pinned: true, workspaceId: st.scope.workspaceId })
      : { pinned: false };
    // SEAMS S39: a PATCH refused while a reply runs (409 TURN_IN_FLIGHT) keeps the pick: a resync of this chat does not
    // undo it, and the next send carries it (a message's explicit pinned is authoritative, P4a S4).
    Promise.resolve()
      .then(() => fetch(`/api/ask/threads/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope }) }))
      .then((r) => {
        if (r && r.ok) { if (st.scopeHeld === id) st.scopeHeld = null; return; }
        if (r && r.status === 409) return r.json().then((b) => { if (b && b.code === 'TURN_IN_FLIGHT' && st.threadId === id) st.scopeHeld = id; }, () => {});
      })
      .catch(() => { /* the next message carries the scope in its context anyway */ });
  }

  /** The panel API's and the card ctx's setScope (CONTRACT §4): `{ pinned:false }` | `{ pinned:true, projectKey,
   *  label? }` | `{ pinned:true, workspaceId, label? }`. PATCHes an existing chat and never moves the focus; false (and
   *  nothing changes) for any other shape, or after destroy(). */
  function setScopeFromApi(scope) {
    if (st.destroyed || !scope || typeof scope !== 'object' || typeof scope.pinned !== 'boolean') return false;
    const next = scopeFromContext(scope);
    if (scope.pinned === true && !next.pinned) return false;
    const label = typeof scope.label === 'string' && scope.label ? scope.label : null;
    setScope({ ...next, label }, { focus: false });
    if (next.pinned && !label) resolveScopeLabel();
    return true;
  }

  /** Restore the selector from a stored thread context (loadThread / reopen). */
  function applyThreadScope(context) {
    // S41: the stored context reads as the server reads it (a row without pinned names its scope by key).
    st.scope = { ...scopeFromContext(context), label: null };
    updateScopeButton();          // the raw key shows until the name resolves
    if (st.scope.pinned) resolveScopeLabel();
  }

  function resolveScopeLabel() {
    const want = { projectKey: st.scope.projectKey, workspaceId: st.scope.workspaceId };
    loadCardOptions().then((opts) => {
      if (st.destroyed || !st.scope.pinned) return;
      if (st.scope.projectKey !== want.projectKey || st.scope.workspaceId !== want.workspaceId) return;
      const p = want.projectKey ? opts.projects.find((x) => x && x.key === want.projectKey) : null;
      const w = want.workspaceId ? opts.workspaces.find((x) => x && x.id === want.workspaceId) : null;
      st.scope.label = (p && p.name) || (w && (w.name || w.id)) || null;
      updateScopeButton();
    });
  }

  function openScopePopover(trigger) {
    const caption = (text) => {
      const c = make('div', 'ask-pop-caption', text);
      c.setAttribute('role', 'presentation');
      return c;
    };
    const divider = () => {
      const d = make('div', 'ask-pop-divider');
      d.setAttribute('role', 'separator');
      return d;
    };
    const panel = openPopover({
      panelClass: 'ask-pop-scope',
      trigger,
      onClose: () => trigger.setAttribute('aria-expanded', 'false'),
      build: (p) => { p.appendChild(caption('Chat scope')); },
    });
    if (!panel) return;
    panel.setAttribute('aria-label', 'Chat scope');
    trigger.setAttribute('aria-expanded', 'true');
    loadCardOptions().then((opts) => {
      if (!st.popover || st.popover.panel !== panel) return;
      // A radio row: the line icon, the text, then the fixed check slot, ✓ on the pick only, so the chips line up on
      // every row (aria-checked carries the pick for screen readers).
      const radio = (cls, on, kids, onPick) => {
        const it = menuItem(`ask-scope-item ${cls}`, onPick);
        it.setAttribute('role', 'menuitemradio');
        it.setAttribute('aria-checked', on ? 'true' : 'false');
        for (const k of kids) it.appendChild(k);
        const slot = make('span', 'ask-scope-check');
        slot.setAttribute('aria-hidden', 'true');
        if (on) {
          const check = checkMark();
          check.setAttribute('aria-hidden', 'true');
          slot.appendChild(check);
        }
        it.appendChild(slot);
        return it;
      };
      // The name (and its kind chip, when it has one) on one line, an optional sub-line under it.
      const col = (name, chip, sub) => {
        const c = make('span', 'ask-scope-col');
        const line = make('span', 'ask-scope-line');
        line.appendChild(make('span', 'ask-model-name', name));
        if (chip) line.appendChild(chip);
        c.appendChild(line);
        if (sub) c.appendChild(make('span', 'ask-scope-sub', sub));
        return c;
      };
      panel.appendChild(radio('ask-scope-none', !st.scope.pinned,
        [scopeIcon(doc, 'none', 14), make('span', 'ask-model-name', NO_PROJECT_LABEL)],
        () => setScope({ pinned: false })));
      const projects = opts.projects.filter((p) => p && p.key);
      if (projects.length) {
        panel.appendChild(divider());
        panel.appendChild(caption('Projects'));
        for (const p of projects) {
          const it = radio('ask-scope-proj', st.scope.pinned && st.scope.projectKey === p.key, [
            scopeIcon(doc, 'project', 14),
            col(p.exists === false ? `${p.name} (missing)` : p.name, kindChip(doc, projectKind(p)), p.displayPath || p.path),
          ], () => setScope({ pinned: true, projectKey: p.key, label: p.name }));
          if (p.path) it.title = p.path;          // the absolute path; the sub-line shows displayPath (S22), as text only
          panel.appendChild(it);
        }
      }
      const workspaces = opts.workspaces.filter((w) => w && w.id);
      if (workspaces.length) {
        panel.appendChild(divider());
        panel.appendChild(caption('Workspaces'));
        for (const w of workspaces) {
          panel.appendChild(radio('ask-scope-ws', st.scope.pinned && st.scope.workspaceId === w.id, [
            scopeIcon(doc, 'workspace', 14),
            col(w.name || w.id, null, null),
          ], () => setScope({ pinned: true, workspaceId: w.id, label: w.name || w.id })));
        }
      }
      // Add project… opens the app's Add project dialog (chatDeps.openAddProject, read at call time; SEAMS S19).
      if (chatDeps && typeof chatDeps.openAddProject === 'function') {
        panel.appendChild(divider());
        const add = menuItem('ask-scope-item ask-scope-add', () => {
          closePopover({ focusTrigger: false });
          chatDep('openAddProject');
        });
        add.appendChild(scopeIcon(doc, 'add', 14));
        add.appendChild(make('span', 'ask-model-name', 'Add project…'));
        panel.appendChild(add);
      }
      const first = menuItems(panel)[0];
      if (first) { first.tabIndex = 0; try { first.focus(); } catch { /* ignore */ } }
    });
  }

  // ---- worktrees (P4 §10) ---------------------------------------------------
  function setWorktrees(list) {
    const ids = (l) => l.map((w) => w && w.worktreeId).join(',');
    const next = Array.isArray(list) ? list : [];
    if (ids(next) !== ids(st.worktrees)) scheduleMcpRefresh();   // an open worktree brings its project's sets (D17)
    st.worktrees = next;
  }

  function refreshWorktrees() {
    if (!st.threadId) { setWorktrees([]); return Promise.resolve([]); }
    const tid = st.threadId;
    return Promise.resolve()
      .then(() => fetch(`/api/ask/threads/${tid}`))
      .then((r) => (r && r.ok ? r.json() : null))
      .catch(() => null)
      .then((snap) => {
        if (st.threadId !== tid) return st.worktrees;
        const list = snap && Array.isArray(snap.worktrees) ? snap.worktrees : [];
        // The model owns the list (ask-worktrees frames land there too) and the
        // flush repaints an open popover; the count is ALSO written synchronously
        // — deleteWorktree and the tests read it right after the awaited refetch.
        if (st.model) { st.model.setWorktrees(list); scheduleFlush(); }
        setWorktrees(list);
        return st.worktrees;
      });
  }

  /** DELETE `url`; a refusal or a network failure raises an error toast in this panel's own
   *  document (#555). Returns true only when the server accepted it. */
  async function deleteOrReport(url, title, key) {
    let detail = '';
    try {
      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok) return true;
      const data = await res.json().catch(() => ({}));
      detail = (data && data.error) || `request failed (${res.status})`;
    } catch (e) {
      detail = (e && e.message) || 'network error';
    }
    notify({ tone: 'err', title, detail, key }, { doc });
    return false;
  }

  const wtShortSha = (c) => (typeof c === 'string' ? c.slice(0, 7) : '');

  async function deleteWorktree(w) {
    const ok = await confirm({
      title: 'Remove this worktree?',
      message: `${w.projectKey} @ ${w.ref} is checked out at ${w.path}. The checkout is deleted; branches are untouched.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await deleteOrReport(`/api/ask/threads/${st.threadId}/worktrees/${w.worktreeId}`, 'Could not remove the worktree', `ask-wt-del-${w.worktreeId}`);
    await refreshWorktrees();   // the refetch shows the truth either way
  }

  function renderWorktreeRows(panel, list) {
    for (const w of list) {
      const row = make('div', 'ask-runinfo-row ask-wt-row');
      const col = make('span', 'ask-runinfo-col');
      col.appendChild(make('span', 'ask-runinfo-name', `${w.projectKey} · ${w.ref}@${wtShortSha(w.commit)}`));
      const path = make('span', 'ask-runinfo-sub ask-wt-path', w.path);
      path.title = 'Click to copy';
      path.addEventListener('click', () => { try { win.navigator.clipboard.writeText(w.path); } catch { /* unsupported */ } });
      col.appendChild(path);
      row.appendChild(col);
      // AGE (spec §10 row: project · ref@sha7 · AGE · path · trash). Reuses the
      // run-info popover's `.ask-runinfo-elapsed` cell — its `margin-left:auto`
      // also right-aligns the trash that follows.
      row.appendChild(make('span', 'ask-runinfo-elapsed', w.createdAt ? fmtElapsed(now() - Date.parse(w.createdAt)) : '—'));
      const trash = make('button', 'ask-thread-trash');
      trash.type = 'button';
      trash.setAttribute('aria-label', `Remove worktree ${w.worktreeId}`);
      trash.appendChild(svgIcon('M4 7h16M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7', 14, 1.8));
      trash.addEventListener('click', (e) => { e.stopPropagation(); closePopover({ focusTrigger: false }); deleteWorktree(w); });
      row.appendChild(trash);
      panel.appendChild(row);
    }
  }

  /** A popover section under its own divider, captioned "<title>" with a meter on the right. Expert-only
   *  sections carry the level on the box, so the divider hides with them. */
  function popSection(className, title, meter, minLevel) {
    const box = make('div', className);
    if (minLevel) box.dataset.minLevel = minLevel;
    box.appendChild(make('div', 'ask-pop-divider'));
    const head = make('div', 'ask-pop-caption-row');
    head.appendChild(make('span', 'ask-pop-caption', title));
    head.appendChild(make('span', 'ask-pop-caption-meter', meter));
    box.appendChild(head);
    return box;
  }

  /** The chat's sub-agents, one row each. Rebuilt on every meters flush: agent blocks mark meters
   *  dirty (ask-model), so rows, dots, ctx and cost move while agents run. */
  function agentsSection() {
    const agents = [];
    if (st.model) {
      for (const row of st.model.messages()) {
        for (const b of row.blocks || []) if (b && b.kind === 'agent') agents.push(b);
      }
    }
    // Count and cost: costs sum across agents; context fills do not.
    const cost = agents.reduce((n, a) => n + (Number.isFinite(a.costUsd) ? a.costUsd : 0), 0);
    const box = popSection('ask-ctx-agents', 'Agents', agents.length ? `${agents.length} · ≈${fmtUsd(cost)}` : '', 'expert');
    if (!agents.length) { box.appendChild(make('div', 'ask-pop-empty', 'No agents spawned yet.')); return box; }
    for (const a of agents) {
      const row = make('div', 'ask-runinfo-row');
      row.appendChild(make('span', `ask-dot${a.status === 'running' ? ' ask-dot-run' : a.status === 'done' ? ' ask-dot-done' : ''}`));
      const col = make('span', 'ask-runinfo-col');
      col.appendChild(make('span', 'ask-runinfo-name', a.label || a.type || 'agent'));
      const sub = make('span', 'ask-runinfo-sub', [a.model, fmtCtx(a.ctx, a.ctxWindow) || fmtTokens(a.tokens), Number.isFinite(a.costUsd) ? `≈${fmtUsd(a.costUsd)}` : null, a.status || null].filter(Boolean).join(' · '));
      sub.title = sub.textContent;                                // one line in the popover; the whole of it on hover
      col.appendChild(sub);
      row.appendChild(col);
      row.appendChild(make('span', 'ask-runinfo-elapsed', fmtElapsed(a.durationMs) || '—'));
      box.appendChild(row);
    }
    return box;
  }

  /** The chat's open worktrees, or null while it has none. Synchronous: st.worktrees is the DOM mirror,
   *  fed by the snapshot or the last frame, and flushExtra refreshes it BEFORE rebuilding the popover. */
  function worktreesSection() {
    if (!st.worktrees.length || !gitOn(doc)) return null;
    const box = popSection('ask-ctx-worktrees', 'Worktrees', String(st.worktrees.length), 'expert');
    renderWorktreeRows(box, st.worktrees);
    return box;
  }

  // ---- context popover (window fill, topics, agents, worktrees) -------------
  /** The open chat's topics; an open context popover is rebuilt in place (same node, focus kept). */
  function setContexts(list) {
    st.contexts = validContexts(list);
    const pop = st.popover;
    if (pop && pop.trigger === el.ctxBtn) rebuildPopover(pop);
  }

  const CTX_POP_WIDTH = 340;                                      // .ask-pop-ctx width
  const levelClass = (level) => (level === 'warn' || level === 'high' ? ` is-ctx-${level}` : '');

  /** One topic row: a menuitem that closes the sheet and routes, or a plain row when it has no route. */
  function topicRow(c) {
    const href = contextHref(c);
    const mentioned = c.source === 'chat';                       // only a page topic is ever pinned
    const pinned = c.pinned && !mentioned;
    const row = href
      ? menuItem('ask-ctx-topic', () => { closePopover({ focusTrigger: false }); if (win.location.hash !== href) win.location.hash = href.slice(1); })
      : make('div', 'ask-ctx-topic');
    if (mentioned) row.classList.add('is-mentioned');
    if (pinned) row.classList.add('is-pinned');
    row.dataset.kind = c.kind;
    row.title = `${c.label || c.id}${mentioned ? ' (mentioned)' : pinned ? ' (pinned)' : ''}`;   // the full name when it is cut off; History's wording
    row.appendChild(make('span', 'ask-ctx-swatch'));
    row.appendChild(make('span', 'ask-ctx-topic-name', c.label || c.id));
    if (pinned) {
      row.appendChild(svgIcon(ICONS.pin, 11, 2));
      row.appendChild(make('span', 'ask-ctx-topic-pin', 'pinned'));
    }
    row.appendChild(make('span', 'ask-ctx-topic-kind', c.kind));
    return row;
  }

  function topicsSection() {
    const box = make('div', 'ask-ctx-topics');
    const { asked, mentioned } = groupContexts(st.contexts);
    const total = asked.length + mentioned.length;
    const head = make('div', 'ask-pop-caption-row');
    head.appendChild(make('span', 'ask-pop-caption', 'Topics'));
    head.appendChild(make('span', 'ask-pop-caption-meter', total ? String(total) : ''));
    box.appendChild(head);
    if (!total) { box.appendChild(make('div', 'ask-pop-empty', 'No topics yet.')); return box; }
    for (const [key, label, list] of [['asked', 'Asked from', asked], ['mentioned', 'Mentioned in chat', mentioned]]) {
      if (!list.length) continue;
      const g = make('div', 'ask-ctx-topic-group');
      g.dataset.ctxGroup = key;
      g.appendChild(make('div', 'ask-ctx-group', label));
      for (const c of list) g.appendChild(topicRow(c));
      box.appendChild(g);
    }
    return box;
  }

  /** Caption, then the window's bar / rows / footer (or one line while the window is unknown), then the
   *  topics, the agents and (while there are any) the worktrees. */
  function buildCtxPopover(p) {
    const { ctx, win } = currentCtx();
    const b = ctxBreakdown(ctx, win);
    const head = make('div', 'ask-pop-caption-row');
    head.appendChild(make('span', 'ask-pop-caption', 'Context window'));
    head.appendChild(make('span', 'ask-pop-caption-meter', b ? `${kTok(ctx)} / ${fmtWindow(win)} (${b.pct}%)` : (ctx > 0 ? kTok(ctx) : '')));
    p.appendChild(head);
    if (!b) {
      p.appendChild(make('div', 'ask-pop-empty', 'The window shows after the first answer.'));
    } else {
      const bar = make('div', 'ask-ctx-bar');
      bar.setAttribute('aria-hidden', 'true');               // the rows below carry the numbers
      const used = make('span', `ask-ctx-bar-used${levelClass(b.level)}`);
      used.style.width = `${+Math.min(100, (ctx / win) * 100).toFixed(2)}%`;
      bar.appendChild(used);
      // The hatch covers only the window the fill has not reached, so past the compaction point it shrinks
      // instead of painting over the fill (the row below still reports the whole buffer).
      const hatch = Math.min(b.buffer, Math.max(0, win - ctx));
      if (hatch > 0) {
        const buf = make('span', 'ask-ctx-bar-buffer');
        buf.style.width = `${+((hatch / win) * 100).toFixed(2)}%`;
        bar.appendChild(buf);
      }
      p.appendChild(bar);
      const rows = [['used', 'Used', b.used], ['buffer', 'Autocompact buffer', b.buffer], ['free', 'Free space', b.free]];
      for (const [key, name, n] of rows) {
        if (key === 'buffer' && n <= 0) continue;
        const r = make('div', `ask-ctx-stat${key === 'used' ? levelClass(b.level) : ''}`);
        r.dataset.stat = key;
        r.appendChild(make('span', 'ask-ctx-swatch'));
        r.appendChild(make('span', 'ask-ctx-stat-name', name));
        r.appendChild(make('span', 'ask-ctx-stat-tokens', kTok(n)));
        r.appendChild(make('span', 'ask-ctx-stat-share', fmtShare(n, win)));
        p.appendChild(r);
      }
      p.appendChild(b.level === 'high'
        ? make('div', 'ask-ctx-foot is-ctx-high', 'Compaction soon')
        : make('div', 'ask-ctx-foot', `${kTok(b.untilCompact)} until auto-compact`));
    }
    if (ctx >= CTX_COST_HINT) p.appendChild(make('div', 'ask-ctx-hint', `Each message re-sends about ${(ctx / 1000).toFixed(1)}k tokens.`));
    p.appendChild(make('div', 'ask-pop-divider'));
    p.appendChild(topicsSection());
    p.appendChild(agentsSection());
    const wts = worktreesSection();
    if (wts) p.appendChild(wts);
  }

  function openCtxPopover(trigger) {
    const panel = openPopover({
      panelClass: 'ask-pop-ctx', trigger, refreshOn: (d) => d.meters || d.worktrees,
      onClose: () => trigger.setAttribute('aria-expanded', 'false'),
      build: buildCtxPopover,
    });
    if (!panel) return;
    panel.setAttribute('aria-label', 'Context window');
    anchorCtxPopover(panel, trigger);
    trigger.setAttribute('aria-expanded', 'true');
    // Heal the worktree list on open (one snapshot GET): it lands in the model and the
    // dirty.worktrees flush rebuilds the popover — one render path.
    refreshWorktrees();
  }

  /** Right edge flush with the trigger: the meter moves with the interface level and the controls
   *  beside it, so a fixed CSS offset would miss it. Kept 6px inside its host (the composer); re-run on resize. */
  function anchorCtxPopover(panel, trigger) {
    const host = panel.parentElement || el.sheet;
    const sr = host.getBoundingClientRect();
    const tr = trigger.getBoundingClientRect();
    if (sr.width > 0) panel.style.right = `${Math.max(0, Math.min(sr.right - tr.right, sr.width - CTX_POP_WIDTH - 6))}px`;
  }

  // ---- thread actions -------------------------------------------------------
  function newThread() {
    stopVoice();
    loadGen += 1;                       // a load still in flight must not resurrect the old thread
    st.threadId = null;
    st.wantThread = null;               // home: a new chat
    st.model = null;
    st.hist = { idx: -1, draft: '' };
    st.suggestDismissed = null;
    st.seenRows = new Set();            // a different chat: its rows have never been shown
    st.subscribedFor = null;
    stopElapsed();
    storeThread(null);
    el.title.textContent = 'New chat';
    st.scopeHeld = null;                // S39: a held pick belongs to the chat it was made in
    applyThreadScope(null);             // U5: a brand-new chat starts in No project
    setContexts([]);
    restoreBrowserPick();               // …and on the browser-level pick, not the last chat's
    st.mcp.off = { sets: [], members: [] };   // …and with every MCP server on
    scheduleMcpRefresh();
    pruneCardEls();                     // st.model is already null — renderTranscript's keep set cannot see the old ids
    renderTranscript();
    updateMeters();
    setWorktrees([]);
    renderQueue();                      // the open chat is none: no cards (the other chats keep theirs)
    updateSendStop();
    setComposerMsg(null);
    updateAddons();                     // CONTRACT §2: the add-ons see the new (empty) chat
    focusComposer();
  }

  async function deleteThread(t) {
    closePopover({ focusTrigger: false });
    // A trash in the History column keeps the focus in the column (below 1100px the composer sits under the overlay).
    const from = el.history && el.history.contains(doc.activeElement) ? doc.activeElement : null;
    const back = () => {
      if (!from) { focusComposer(); return; }
      try { (from.isConnected ? from : el.history).focus({ preventScroll: true }); } catch { /* detached */ }
    };
    const ok = await confirm({
      title: 'Delete this chat?',
      message: `“${t.title || 'New chat'}” and its transcript are removed${t.worktrees ? ` along with ${t.worktrees} worktree${t.worktrees === 1 ? '' : 's'}` : ''}. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) { back(); return; }
    if (!(await deleteOrReport(`/api/ask/threads/${t.id}`, 'Could not delete the chat', `ask-thread-del-${t.id}`))) { back(); return; }
    if (readStoredThread() === t.id) storeThread(null);
    st.askedIn.delete(t.id);                         // a stopped turn's late reply never lights the Chat row for it
    st.queues.delete(t.id);                          // its queued messages go with it (newThread below repaints)
    loadHistory();                                   // the column drops the row
    // The chat shown — or the one still loading (its GET may answer after the delete) — goes home; an overlay closes,
    // as after a pick, so the new chat has its room.
    if (st.threadId === t.id || st.wantThread === t.id) {
      if (historyOverlayOpen()) setHistoryOpen(false, { persist: false });
      newThread();                                   // clears + focuses the textarea (D14)
      route(null, { replace: true });
    } else back();
  }

  function buildThreadTrash(t) {
    const b = make('button', 'ask-thread-trash');
    b.type = 'button';
    b.setAttribute('aria-label', `Delete "${t.title || 'New chat'}"`);
    b.appendChild(svgIcon('M4 7h16M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7', 14, 1.8));
    b.addEventListener('click', (e) => { e.stopPropagation(); deleteThread(t); });
    return b;
  }

  // ---- stubs the later tasks replace wholesale ------------------------------
  // ---- transcript (spec §10.5) ---------------------------------------------
  function buildAttachmentPill(b) {
    // #398: an image attachment renders as a thumbnail served by the download
    // route (sniff-verified mime, inline disposition); everything else keeps the
    // name pill. The id comes from the 202 body or the ask-message broadcast; an
    // echo without one (older server) pills until the snapshot.
    if (b.attKind === 'image' && b.id && st.threadId) {
      const link = make('a', 'ask-attachment-thumb-link');
      link.href = `/api/ask/threads/${st.threadId}/attachments/${b.id}`;
      link.target = '_blank';
      link.rel = 'noopener';
      const img = doc.createElement('img');
      img.className = 'ask-attachment-thumb';
      img.alt = b.name || '(image)';
      img.loading = 'lazy';
      img.src = link.href;
      link.appendChild(img);
      return link;
    }
    const pill = make('span', 'extra-pill ask-attachment-pill');
    pill.appendChild(make('span', 'extra-pill-name', b.name || '(attachment)'));
    return pill;
  }

  function buildNotice(b) {
    const n = make('div', 'ask-notice');
    n.appendChild(make('span', null, b.text || ''));
    if (b.href) {
      n.appendChild(doc.createTextNode(' '));
      const a = make('a', 'ask-notice-link', b.hrefLabel || 'open');
      if (b.codexSetup || b.copilotSetup) { a.target = '_blank'; a.rel = 'noopener'; }   // §4.6: the Codex / Copilot setup docs
      a.setAttribute('href', b.href);
      n.appendChild(a);
    }
    if (b.mcp) {
      // MCP registry §9.1 (D17): the worktree join notice's "Sets" opens the per-chat picker (skills registry §6.8).
      n.appendChild(doc.createTextNode(' · '));
      const mcp = make('button', 'ask-notice-mcp', 'Sets');
      mcp.type = 'button';
      mcp.addEventListener('click', () => { if (el.mcpBtn) openMcpPopover(el.mcpBtn); });
      n.appendChild(mcp);
    }
    // The raw failure evidence, for those who debug: expert only — the human
    // line above is the explanation at every level.
    if (b.errorClass && b.detail) {
      const det = doc.createElement('details');
      det.className = 'ask-error-details';
      det.dataset.minLevel = 'expert';
      det.appendChild(make('summary', null, 'Details'));
      det.appendChild(make('div', 'ask-error-detail-text', b.detail));
      n.appendChild(det);
    }
    return n;
  }

  // P4 (canvas Switched): a scope switch's divider row — the new scope's icon, `Switched to <name>` and its kind chip,
  // centered between two hairlines. A project's Git/Folder chip comes from the cached /api/projects; No project and an
  // unknown project get none.
  function buildDivider(b) {
    const s = scopeFromContext(b.scope);
    const text = String(b.text || '');
    const d = make('div', 'ask-divider');
    d.setAttribute('role', 'separator');
    d.setAttribute('aria-label', text);
    const inner = make('span', 'ask-divider-in');
    inner.append(scopeIcon(doc, scopeKind(s), 13), make('span', 'ask-divider-t', text));
    if (s.workspaceId) inner.appendChild(kindChip(doc, 'ws'));
    else if (s.projectKey) {
      loadCardOptions().then((o) => {
        const p = o.projects.find((x) => x && x.key === s.projectKey);
        const c = p ? kindChip(doc, projectKind(p)) : null;
        if (c && !st.destroyed) inner.appendChild(c);
      });
    }
    d.appendChild(inner);
    return d;
  }

  // ---- Start-run card (spec §9, §10.5; D1-D3) -------------------------------
  // Field edits live in the DOM only (V7): a proposed card's element is CACHED
  // by card id and REUSED across message re-renders, so streaming updates and
  // proposed re-emits never clobber what the user typed. Only a STATE change
  // (started/dismissed/failed) builds a fresh terminal element.
  // The four lists are cached for the panel's lifetime (the scope label / popover read
  // them on every open). `fresh: true` refetches and REPLACES the cache — the run card
  // builds with it, because a workflow saved seconds earlier in this chat is not in the
  // cached list and fillSelect would silently leave the select on another row.
  function loadCardOptions({ fresh = false } = {}) {
    if (st.cardOptions && !fresh) return st.cardOptions;
    const grab = (url, key) => Promise.resolve()
      .then(() => fetch(url))
      .then((r) => (r && r.ok ? r.json() : null))
      .catch(() => null)
      .then((body) => {
        if (Array.isArray(body)) return body;
        if (body && Array.isArray(body[key])) return body[key];
        return [];
      });
    st.cardOptions = Promise.all([
      grab('/api/projects', 'projects'),
      grab('/api/workflows', 'workflows'),
      // Verified against ui/server.mjs:2905-2913 — the envelope key is
      // `guardrails`, NOT `sets` (app.js listGuardrailsApi:3090-3095). The
      // wrong key renders an empty select, Start posts guardrailsId:'' and
      // /api/run silently coerces that to 'permissive'.
      grab('/api/guardrails', 'guardrails'),
      grab('/api/workspaces', 'workspaces'),
    ]).then(([projects, workflows, guardrails, workspaces]) => ({ projects, workflows, guardrails, workspaces }));
    return st.cardOptions;
  }

  function fillSelect(select, options, value) {
    select.replaceChildren();
    for (const o of options) {
      const opt = doc.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      select.appendChild(opt);
    }
    if (value != null && [...select.options].some((o) => o.value === value)) select.value = value;
  }

  /** Returns the fill promise so a caller can re-read the select once the list lands. */
  function loadBranchesInto(select, projectDir, want) {
    fillSelect(select, [{ value: '', label: 'current branch (auto)' }], '');
    if (!projectDir) return Promise.resolve();
    return Promise.resolve()
      .then(() => fetch(`/api/branches?projectDir=${encodeURIComponent(projectDir)}`))
      .then((r) => (r && r.ok ? r.json() : null))
      .catch(() => null)
      .then((body) => {
        const branches = Array.isArray(body) ? body : (body && Array.isArray(body.branches)) ? body.branches : [];
        const opts = [{ value: '', label: 'current branch (auto)' }, ...branches.map((b) => ({ value: b, label: b }))];
        if (want && !opts.some((o) => o.value === want)) opts.push({ value: want, label: want });
        fillSelect(select, opts, want || '');
      });
  }

  function wsBasename(p) { return String(p || '').replace(/\/+$/, '').split('/').pop() || String(p || ''); }

  // ---- Run proposal card v2 (spec 2026-09-06-ask-run-card-v2 §7.3) --------------------------------------------------
  const RP_ACC = new Set(['violet', 'blue', 'green', 'peach', 'red', 'amber']);
  function rpField(labelText, control, hint) {
    const f = make('div', 'ask-rp-field');
    const l = make('span', 'ask-rp-label', labelText);
    if (hint) l.appendChild(make('span', 'ask-rp-hint', ` · ${hint}`));
    f.append(l, control);
    return f;
  }
  function rpSelect(className, ariaLabel) {
    const s = doc.createElement('select');
    s.className = className;
    s.setAttribute('aria-label', ariaLabel);
    return s;
  }
  /** "3 agents · 1 loop · Review → Implement, max 3 cycles" from a v2 template + registry (v1: agents only).
   *  Loop wires and the cycle budget follow New Pipeline's buildGraphWireRows: classifyLoops decides what is a
   *  loop (needs the registry's ported metas), runConfig.wires[id].maxCycles beats the template's config. */
  function workflowDesc(wf, registry, runConfig) {
    if (!wf) return '';
    if (Array.isArray(wf.nodes)) {
      const agents = wf.nodes.filter((n) => n && n.kind === 'agent');
      const label = (id) => { const n = agents.find((a) => a.id === id); const m = n && registry && registry[n.key]; return (m && m.displayName) || (n && n.key) || id; };
      const { loopWireIds } = classifyLoops(wf, portsFnFor(registry || {}));
      const savedWires = (runConfig && runConfig.wires) || {};
      const loops = (wf.wires || []).filter((w) => w && loopWireIds.has(w.id));
      const parts = [`${agents.length} agent${agents.length === 1 ? '' : 's'}`, `${loops.length} loop${loops.length === 1 ? '' : 's'}`];
      for (const w of loops) {
        const n = Number((savedWires[w.id] || {}).maxCycles);
        const cfg = Number(w.config && w.config.maxCycles);
        const max = Number.isFinite(n) && n >= 1 ? n : (Number.isFinite(cfg) && cfg >= 1 ? cfg : 3);
        parts.push(`${label(w.from.node)} → ${label(w.to.node)}, max ${max} cycles`);
      }
      return parts.join(' · ');
    }
    const n = (wf.steps || []).flat().length;
    return `${n} agent${n === 1 ? '' : 's'}`;
  }

  async function fetchJsonOk(url) {
    try { const r = await fetch(url); return r && r.ok ? await r.json() : null; } catch { return null; }
  }
  /** The lane's three sources (spec D5): workflow template, registry, per-project config. null = unusable. */
  async function loadLane(workflowId, projectDir, picked = '') {
    const qs = projectDir ? `?projectDir=${encodeURIComponent(projectDir)}` : '';
    const [wf, agents, cfg, defaults] = await Promise.all([
      fetchJsonOk(`/api/workflows/${encodeURIComponent(workflowId)}`), fetchJsonOk('/api/agents'), fetchJsonOk(`/api/config${qs}`),
      fetchJsonOk(`/api/run-defaults${qs}`),
    ]);
    // §6: the card's agent models follow the engine the proposed run will start on (the same default /api/run resolves).
    const defaultEngine = defaults && defaults.engine && ENGINE_NAMES.includes(defaults.engine.value) ? defaults.engine.value : 'claude';
    const engine = ENGINE_NAMES.includes(picked) ? picked : defaultEngine;
    const registry = agents && Array.isArray(agents.agents) ? Object.fromEntries(agents.agents.map((a) => [a.key, a])) : {};
    if (!wf || !(Array.isArray(wf.nodes) || Array.isArray(wf.steps)) || !Object.keys(registry).length || !cfg) return null;
    const config = (cfg.config && typeof cfg.config === 'object') ? cfg.config : { steps: {}, customModels: [] };
    const runConfig = (config.workflows && config.workflows[workflowId]) || { nodes: {}, feedbacks: {} };
    const allModels = Array.isArray(cfg.models) ? cfg.models : [];
    const models = allModels.filter((m) => m && runsOn(m, engine));
    // `models` + `engine`: the rows are built exactly as New pipeline builds them (app.js buildNodeConfigRows) — a pick
    // of the other engine shows as inherit (D10: it is skipped at run time) and rides the row as `enginePair`, so a
    // save that leaves it untouched re-sends it (pruneNodeSelection) instead of erasing it. `slotDefaults`: the
    // inherit default is the run engine's step slot, as on New pipeline.
    const slotDefaults = defaults && defaults.steps && defaults.steps[engine] ? defaults.steps[engine] : null;
    const rows = buildNodeConfigRows(wf, registry, runConfig, { ...(workflowId === 'wf_default' ? { legacySteps: config.steps || {} } : {}),
      models: allModels, engine, ...(slotDefaults ? { slotDefaults } : {}) });
    // `editable`: every target edits the lane — the edits ride THIS run (`overlay`); only a project target can also save
    // them as its defaults ("Save as project defaults", saveLaneEdits). `explicit`: a workspace card's rows are the
    // built-in defaults, not the run's baseline (laneOverlay names its picks outright). `proposal` / `proposed` /
    // `warnings`: Ask Worca's per-agent picks (card.nodes) once applyProposal lays them in as the lane's baseline.
    return { wf, registry, runConfig, rows, edits: {}, editable: true, explicit: !projectDir, engine, defaultEngine, allModels, proposal: {}, proposed: {}, warnings: [],
      models, efforts: engine === 'claude' ? (Array.isArray(cfg.efforts) ? cfg.efforts : []) : [...(ENGINE_EFFORTS[engine] || [])],
      subagentModels: Array.isArray(cfg.subagentModels) ? cfg.subagentModels : [] };
  }
  const laneEffective = (lane, row) => ({ ...row, ...(lane.edits[row.nodeId] || {}) });
  const laneCaps = (row) => ({ asksQuestions: row.askQuestions !== null, questionsLocked: row.questionsLocked });
  const laneEditedRows = (lane) => lane.rows.filter((r) => lane.edits[r.nodeId]);
  const laneOverrideCount = (lane) => lane.rows.filter((r) => modifiedFieldsOf(laneEffective(lane, r), r.def, laneCaps(r)).length).length;
  const modelLabel = (lane, id) => { const m = lane.models.find((x) => x.id === id); return m ? (m.label || m.id).replace(' (1M)', '') : id; };
  function laneSummary(lane) {
    const counts = new Map();
    let fan = 0;
    for (const r of lane.rows) {
      const c = laneEffective(lane, r);
      const k = c.model ? `on ${modelLabel(lane, c.model)}` : 'on the workflow’s model';
      counts.set(k, (counts.get(k) || 0) + 1);
      if (c.fanOut || fanForced(lane, r)) fan++;
    }
    const picked = laneProposedCount(lane);
    return `${lane.rows.length} agents · ${[...counts].map(([k, v]) => `${v} ${k}`).join(' · ')}${fan ? ` · ${fan} fan-out` : ''}${picked ? ` · ${picked} picked by Chat` : ''}`;
  }
  function laneSet(lane, row, patch) {
    const next = { ...(lane.edits[row.nodeId] || {}), ...patch };
    for (const k of Object.keys(next)) if (next[k] === row[k]) delete next[k];   // back to the proposal = no edit
    if (Object.keys(next).length) lane.edits[row.nodeId] = next; else delete lane.edits[row.nodeId];
  }
  // Ask Worca's per-agent picks (card.nodes) are the lane's BASELINE edits: "changed" means the user moved a row off
  // them; with no proposal that is exactly "the row has an edit", as before.
  const editKey = (e) => JSON.stringify(Object.keys(e || {}).sort().map((k) => [k, e[k]]));
  const sameEdit = (a, b) => editKey(a) === editKey(b);
  const cloneEdits = (edits) => Object.fromEntries(Object.entries(edits || {}).map(([id, e]) => [id, { ...e }]));
  // `lane.dropped`: workspace picks the user set aside with "Use default" (a pick equal to the built-in row is no edit,
  // so deleting the edit cannot drop it).
  const laneDropped = (lane, row) => !!(lane.dropped && lane.dropped.has(row.nodeId));
  const laneDiverged = (lane, row) => laneDropped(lane, row) || !sameEdit(lane.edits[row.nodeId], lane.proposal[row.nodeId]);
  /** Ask Worca's pick for the row while it still stands — the row runs its model and effort, whatever else the user
   *  changed there ({ model, effort, reason, facts }) — else null. */
  const proposedPick = (lane, row) => {
    if (!Object.hasOwn(lane.proposed, row.nodeId) || laneDropped(lane, row)) return null;
    const p = lane.proposed[row.nodeId];
    const c = laneEffective(lane, row);
    return (c.model || '') === p.model && (c.effort || '') === p.effort ? p : null;
  };
  const laneProposedCount = (lane) => lane.rows.filter((r) => proposedPick(lane, r)).length;
  /** The project's own setting for a row, as the lane shows it: "Opus 5.5 · high", "inherit". */
  const projectPick = (lane, row) => `${row.model ? modelLabel(lane, row.model) : 'inherit'}${row.model && row.effort ? ` · ${row.effort}` : ''}`;
  /** Lay Ask Worca's picks in as the lane's baseline: each healed to the run's engine first (healForEngine — another
   *  engine's model is dropped and the row keeps the project's setting) and dropped when this catalog lacks it; a row
   *  Settings › Memory pins keeps its pin. `lane.proposal` is what "Reset to proposal" restores. */
  function applyProposal(lane, nodes) {
    lane.edits = {};
    lane.proposed = {};
    lane.dropped = new Set();
    const picks = nodes && typeof nodes === 'object' && !Array.isArray(nodes) ? nodes : {};
    for (const row of lane.rows) {
      const p = Object.hasOwn(picks, row.nodeId) ? picks[row.nodeId] : null;
      if (!p || typeof p !== 'object' || typeof p.model !== 'string' || !p.model || row.pinned) continue;
      const effort = typeof p.effort === 'string' ? p.effort : '';
      const healed = healForEngine({ def: { model: row.model, effort: row.effort }, override: { model: p.model, effort }, model: p.model, effort },
        { models: lane.allModels, engine: lane.engine });
      if (healed.enginePair) continue;                       // a model this run's engine cannot run
      const hit = lane.models.find((m) => typeof m.id === 'string' && m.id.toLowerCase() === p.model.toLowerCase());
      if (!hit) continue;                                    // left the catalog since the proposal
      const patch = { model: hit.id, effort: (hit.efforts || []).includes(effort) ? effort : '' };
      if (lane.engine === 'claude' && typeof p.subagentModel === 'string' && lane.subagentModels.includes(p.subagentModel)) patch.subagentModel = p.subagentModel;
      laneSet(lane, row, patch);
      lane.proposed[row.nodeId] = { model: patch.model, effort: patch.effort, reason: typeof p.reason === 'string' ? p.reason : '', facts: typeof p.facts === 'string' ? p.facts : '' };
    }
    lane.proposal = cloneEdits(lane.edits);
  }
  /** The lane rows that differ from the project's settings, as POST /api/run's `overlay.nodes` (src/core/run-overlay.mjs):
   *  { nodes } or { error }. A model always travels with its effort ('' = the model's default). An overlay names
   *  values and never clears one, so "inherit" over the project's own pick falls back to the workflow default when
   *  there is one, else needs "Save as project defaults"; "subs: default" rides as `auto`, what an unset node runs
   *  (model-env.mjs SUBAGENT_DEFAULT). A workspace card's rows are the built-in defaults, not this run's baseline (the
   *  run merges over its primary member's own settings, which the card never loads): there a standing pick and an
   *  edited model are named outright, even when they equal the row (`lane.explicit`). */
  function laneOverlay(lane) {
    const nodes = {};
    for (const row of lane.rows) {
      const ed = lane.edits[row.nodeId];
      const c = laneEffective(lane, row);
      // A workspace card names a pick whose model is still on the row (whatever else the user changed there) and any
      // edited model or effort outright.
      const pp = lane.explicit && Object.hasOwn(lane.proposed, row.nodeId) && !laneDropped(lane, row) ? lane.proposed[row.nodeId] : null;
      const named = !!lane.explicit && ((!!pp && (c.model || '') === pp.model) || (!!ed && ('model' in ed || 'effort' in ed)));
      if (!ed && !named) continue;
      const e = {};
      if (named || (c.model || '') !== (row.model || '') || (c.effort || '') !== (row.effort || '')) {
        const pair = c.model ? { model: c.model, effort: c.effort || '' } : (row.def.model ? { model: row.def.model, effort: row.def.effort || '' } : null);
        if (!pair && !lane.explicit) return { error: `${row.label}: "inherit" over this project's own model only works as a project default. Turn on "Save as project defaults", or pick a model` };
        if (pair) Object.assign(e, pair);
      }
      if (!!c.fanOut !== !!row.fanOut) e.fanOut = !!c.fanOut;
      if (row.askQuestions !== null && !row.questionsLocked && !!c.askQuestions !== !!row.askQuestions) e.askQuestions = !!c.askQuestions;
      if ((c.subagentModel || '') !== (row.subagentModel || '')) e.subagentModel = c.subagentModel || row.def.subagentModel || 'auto';
      if (Object.keys(e).length) nodes[row.nodeId] = e;
    }
    return { nodes };
  }
  /** Ask Worca's picks as proposed (card.nodes), for a Start whose lane has not loaded (still loading, or it could
   *  not): { nodes } or null. POST /api/run checks them again (catalog, efforts, the run's engine). */
  function proposalOverlay(card, workflowId) {
    const picks = card && card.workflowId === workflowId && card.nodes && typeof card.nodes === 'object' && !Array.isArray(card.nodes) ? card.nodes : {};
    const nodes = {};
    for (const [id, p] of Object.entries(picks)) {
      if (!p || typeof p !== 'object' || typeof p.model !== 'string' || !p.model) continue;
      nodes[id] = { model: p.model, effort: typeof p.effort === 'string' ? p.effort : '',
        ...(typeof p.subagentModel === 'string' && p.subagentModel ? { subagentModel: p.subagentModel } : {}) };
    }
    return Object.keys(nodes).length ? { nodes } : null;
  }
  /** Ask Worca's picks this card would run with that are no lane edits, so lanePending misses them: the proposal while
   *  the lane is not loaded, or picks standing on a workspace lane (they equal its built-in rows). Open in New run asks
   *  before leaving them behind. */
  const picksPending = (local, card) => (local.lane
    ? !!local.lane.explicit && laneProposedCount(local.lane) > 0
    : !!proposalOverlay(card || {}, local.workflowId()));
  /** A workspace run fans out every agent whose meta says workspaceFanOut (workflows.mjs), whatever the lane says. */
  const fanForced = (lane, row) => !!lane.workspace && !!(lane.registry && lane.registry[row.key] && lane.registry[row.key].workspaceFanOut === true);
  /** D1: persist every edited row through the New Pipeline writers' bodies (app.js saveStep / saveNode), pruned to
   *  inherit. Returns an error line or null. Nothing is written for a workspace target or an unloaded lane. */
  async function saveLaneEdits(local) {
    const lane = local.lane;
    const projectDir = local.projectDir();
    if (!lane || !lane.editable || !projectDir) return null;
    const workflowId = local.workflowId();
    for (const row of laneEditedRows(lane)) {
      const patch = pruneNodeSelection(row, lane.edits[row.nodeId]);
      const body = row.role
        ? { projectDir, step: row.role, ...patch }
        : { projectDir, workflowId, nodes: { [row.nodeId]: patch } };
      let res = null;
      try {
        res = await fetch('/api/config', { method: row.role ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } catch { return `network error saving ${row.label}`; }
      if (!res || !res.ok) {
        let msg = `request failed (${res ? res.status : '?'})`;
        try { const b = await res.json(); if (b && b.error) msg = b.error; } catch { /* keep */ }
        return `could not save ${row.label}: ${msg}`;
      }
    }
    return null;
  }
  const lanePending = (local) => !!(local.lane && local.lane.editable && laneEditedRows(local.lane).length);
  // D3: as much as one message may carry; /api/run's JSON window (ui/server.mjs) is sized for it at base64's 4/3
  const RP_EXTRAS_MAX_BYTES = ATTACH_MAX_MESSAGE_BYTES;
  /** The pills as /api/run extras. {extras} or {error}. */
  async function collectCardExtras(local) {
    const pills = local.pills || [];
    if (!pills.length) return { extras: [] };
    if (pills.reduce((n, p) => n + (p.bytes || 0), 0) > RP_EXTRAS_MAX_BYTES) return { error: `attachments exceed ${RP_EXTRAS_MAX_BYTES / (1024 * 1024)} MB: remove one` };
    const extras = [];
    for (const p of pills) {
      let res = null;
      try { res = await fetch(`/api/ask/threads/${st.threadId}/attachments/${p.id}`); } catch { res = null; }
      if (!res || !res.ok || typeof res.arrayBuffer !== 'function') return { error: `could not read attachment ${p.name}` };
      let buf = null;
      try { buf = await res.arrayBuffer(); } catch { return { error: `could not read attachment ${p.name}` }; }
      extras.push({ name: p.name, dataBase64: bytesToBase64(new Uint8Array(buf)) });   // the composer's helper (:345) takes a view
    }
    return { extras };
  }
  const cardPending = (local) => lanePending(local) || !!(local.pills && local.pills.length);
  function rpSwitch(ctl, label, on, locked, onChange, editable, why = 'Fixed for this agent') {
    const { row, input } = makeSwitch(doc, { label, ariaLabel: label, checked: on, rowClass: 'ask-rp-ctl', data: { ctl },
      locked: locked ? why : null });
    if (!editable) input.disabled = true;      // a read-only card: off-limits, not locked (no reason line)
    input.addEventListener('change', () => onChange(input.checked));
    return row;
  }
  /** Paint the lane section: header (sub-line + Reset), tiles, footer. Re-run on every edit.
   *  `lc` = { summary: <span>, workflowId(): string }. lane === null → the unusable state. */
  function renderLane(laneSec, lane, lc, loadingText = null) {
    laneSec.replaceChildren();
    const head = make('div', 'ask-rp-sec-head');
    const sub = make('span', 'ask-rp-sec-sub');
    const reset = make('button', 'ask-rp-mini', 'Reset to proposal');
    reset.type = 'button';
    head.append(make('span', 'ask-rp-sec-title', 'Agents'), sub, reset);
    laneSec.appendChild(head);
    if (!lane) {
      sub.textContent = '';
      reset.hidden = true;
      laneSec.appendChild(make('div', 'ask-rp-lane-msg', loadingText || 'Could not load agent settings.'));
      lc.summary.textContent = '';
      if (lc.onPaint) lc.onPaint(null);
      return;
    }
    // "changed" = rows the user moved off the proposal (Ask Worca's picks are the baseline, not the user's edits).
    const edited = lane.rows.filter((r) => laneDiverged(lane, r)).length;
    const picked = laneProposedCount(lane);
    const over = laneOverrideCount(lane);
    const overText = `${over} override${over === 1 ? '' : 's'} of the workflow defaults`;
    sub.textContent = edited
      ? `you changed ${edited} agent${edited > 1 ? 's' : ''} · ${overText}`
      : picked ? `Chat picked ${picked} agent${picked > 1 ? 's' : ''} for this run · ${overText}`
        : `proposed by Worca · ${overText}`;
    reset.hidden = !edited;
    reset.addEventListener('click', () => { lane.edits = cloneEdits(lane.proposal); if (lane.dropped) lane.dropped.clear(); renderLane(laneSec, lane, lc); });
    // The lane shows at every mode while Ask Worca's picks are laid in (data-level-keep, set when the card is built);
    // healed away on another engine, or on another workflow, it is Expert-only again — and the team policy's word on
    // the picks (card.warnings, soft: the run still starts) goes with them.
    const laid = Object.keys(lane.proposed || {}).length;
    if (laid) laneSec.dataset.levelKeep = '1'; else delete laneSec.dataset.levelKeep;
    // Each warning names the off-policy model (policy/effective.mjs deviationsFor): it stays while this card's picks or
    // edits carry it (what the run sends and records, overlayStepModels) — an agent on the project's own setting is not
    // this card's pick, whatever model it runs.
    const ov = laneOverlay(lane);
    // laneOverlay errors (an "inherit" over the project's own model): the rows whose edit carries a model — its pair rule.
    const carried = ov.nodes ? Object.values(ov.nodes).map((e) => e.model)
      : lane.rows.filter((r) => { const ed = lane.edits[r.nodeId]; return !!ed && ('model' in ed || 'effort' in ed); }).map((r) => laneEffective(lane, r).model);
    const running = new Set(carried.map((m) => (m || '').toLowerCase()).filter(Boolean));
    const holds = (w) => String(w).split(/\s+/).some((t) => running.has(t.toLowerCase()));
    if (laid) for (const w of (lane.warnings || []).filter(holds)) laneSec.appendChild(make('div', 'ask-card-task-warn ask-rp-lane-warn', w));
    const box = make('div', 'ask-rp-agents');
    const opt = (v, t) => { const o = doc.createElement('option'); o.value = v; o.textContent = t; return o; };
    lane.rows.forEach((row, i) => {
      const c = laneEffective(lane, row);
      const changed = laneDiverged(lane, row);
      const pick = proposedPick(lane, row);
      const tile = make('div', `ask-rp-tile${changed ? ' mod' : ''}`);
      tile.dataset.nodeId = row.nodeId;
      const l1 = make('div', 'ask-rp-tile-l1');
      l1.appendChild(make('span', `ask-rp-acc${RP_ACC.has(row.color) ? ` ${row.color}` : ''}`));
      const name = make('div', 'ask-rp-name');
      name.appendChild(make('b', null, row.label));
      const small = make('small');
      // "step N" = position in the lane (launch order); row.stepIndex ranks the task card as 0.
      if (pick) {
        // Ask Worca's pick: its reason (and the model's facts) on hover and to assistive tech, the project's own setting
        // beside it (a workspace card shows the workflow default: agent settings are per project). `role="note"`: a
        // generic span may not carry aria-label (ARIA 1.2), so a screen reader would skip the reason.
        const mark = make('span', 'ask-rp-prop', 'Chat');
        mark.title = ['Proposed by Chat for this run', pick.reason, pick.facts].filter(Boolean).join('\n');
        mark.tabIndex = 0;
        mark.setAttribute('role', 'note');
        mark.setAttribute('aria-label', mark.title);
        // The project's own setting is the point of this caption: it wraps instead of ellipsizing (a narrow column).
        small.classList.add('ask-rp-pickcap');
        small.appendChild(mark);
        small.appendChild(doc.createTextNode(` · step ${i + 1} · ${lane.explicit ? 'default' : 'project'}: ${projectPick(lane, row)}`));
        if (changed) { small.appendChild(doc.createTextNode(' · ')); small.appendChild(make('span', 'ask-rp-m', 'edited')); }
      } else if (changed) {
        small.appendChild(make('span', 'ask-rp-m', lane.edits[row.nodeId] ? 'edited' : lane.explicit ? 'default' : 'project default'));
        small.appendChild(doc.createTextNode(` · step ${i + 1}`));
      } else small.textContent = `step ${i + 1} · ${row.pinned ? 'model from Settings › Memory' : row.modified ? 'project override' : 'workflow default'}`;
      name.appendChild(small);
      l1.appendChild(name);
      // model
      const sel = rpSelect('ask-rp-model', `Model for ${row.label}`);
      sel.appendChild(opt('', 'inherit (workflow default)'));
      appendModelGroups(sel, lane.models.filter((m) => (!m.hidden && !m.needsSignIn) || m.id === c.model), {
        engine: lane.engine, text: (m) => modelOptionText(m) + (m.needsSignIn ? ' (needs sign-in)' : '') });
      sel.value = c.model || '';
      // Settings › Memory pins a defragment run's pair (node-tunables.mjs `pinned`): shown, locked.
      sel.disabled = !lane.editable || !!row.pinned;
      if (row.pinned) sel.title = 'Set in Settings › Memory';
      sel.addEventListener('change', () => {
        const mid = sel.value;
        const list = (lane.models.find((m) => m.id === mid) || {}).efforts || [];
        const keep = list.includes(c.effort) ? c.effort : (list[1] || list[0] || '');   // the qpanel's rule (app.js buildTunablesTable)
        laneSet(lane, row, { model: mid, effort: mid ? keep : '' });
        renderLane(laneSec, lane, lc);
      });
      l1.appendChild(sel);
      // effort pills — none for an engine without effort levels (Copilot, Cursor…): an empty group would leave only
      // its "inherits workflow" label, overflowing the tile.
      if (lane.efforts.length) {
        const eff = make('div', `ask-rp-eff${c.model ? '' : ' unset'}`);
        eff.setAttribute('role', 'radiogroup');
        eff.setAttribute('aria-label', `Effort for ${row.label}`);
        const offered = (lane.models.find((m) => m.id === c.model) || {}).efforts || [];
        for (const e of lane.efforts) {
          const b = make('button', `ask-rp-effbtn${e === c.effort ? ' on' : ''}`, e);
          b.type = 'button';
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-checked', String(e === c.effort));
          b.disabled = !lane.editable || !!row.pinned || !offered.includes(e);
          if (!offered.includes(e) && c.model) b.title = `Not offered by ${modelLabel(lane, c.model)}`;
          b.addEventListener('click', () => { laneSet(lane, row, { effort: e }); renderLane(laneSec, lane, lc); });
          eff.appendChild(b);
        }
        l1.appendChild(eff);
      }
      tile.appendChild(l1);
      // line 2
      const l2 = make('div', 'ask-rp-tile-l2');
      // A workspace run fans this agent out over its projects whatever the switch says (workflows.mjs workspaceFanOut):
      // it shows on and locked, as on Auto's proposal panel.
      const forced = fanForced(lane, row);
      const fan = rpSwitch('fanOut', 'Fan-out', forced || c.fanOut, forced, (v) => { laneSet(lane, row, { fanOut: v }); renderLane(laneSec, lane, lc); }, lane.editable,
        'A workspace run fans this agent out over its projects');
      l2.appendChild(fan);
      const subWrap = make('label', 'ask-rp-ctl');
      subWrap.appendChild(make('span', null, 'Sub-agents'));
      const subSel = rpSelect('ask-rp-subagent', `Sub-agent model for ${row.label}`);
      subSel.appendChild(opt('', 'subs: default (agent picks)'));
      for (const v of lane.subagentModels) subSel.appendChild(opt(v, v === 'auto' ? 'subs: agent picks' : `subs: ${v}`));
      subSel.value = lane.subagentModels.includes(c.subagentModel) ? c.subagentModel : '';
      subSel.disabled = !lane.editable;
      subSel.title = 'Model for the sub-agents this node spawns (needs fan-out)';
      subSel.addEventListener('change', () => { laneSet(lane, row, { subagentModel: subSel.value }); renderLane(laneSec, lane, lc); });
      subWrap.appendChild(subSel);
      if (lane.engine === 'claude') l2.appendChild(subWrap);   // §6: sub-agents are Claude only; a Codex or Cursor run has none
      if (row.askQuestions !== null) {
        l2.appendChild(rpSwitch('questions', 'Questions', c.askQuestions, row.questionsLocked, (v) => { laneSet(lane, row, { askQuestions: v }); renderLane(laneSec, lane, lc); }, lane.editable));
      }
      // Back to the project's own setting for this agent (the proposal's pick or the user's edit dropped).
      // A workspace pick equal to the built-in row is no edit but still rides (laneOverlay names it): it can be dropped too.
      if (lane.edits[row.nodeId] || (lane.explicit && pick)) {
        const back = make('button', 'ask-rp-mini ask-rp-row-reset', lane.explicit ? 'Use default' : 'Use project default');
        back.type = 'button';
        back.title = lane.explicit ? 'This agent runs without a pick for this run' : `This agent runs on the project's setting: ${projectPick(lane, row)}`;
        back.addEventListener('click', () => {
          delete lane.edits[row.nodeId];
          if (lane.explicit && Object.hasOwn(lane.proposed, row.nodeId)) lane.dropped.add(row.nodeId);
          renderLane(laneSec, lane, lc);
        });
        l2.appendChild(back);
      }
      tile.appendChild(l2);
      box.appendChild(tile);
    });
    // A per-run lane: changes (and Ask Worca's picks) apply to THIS run only, unless the user saves them as the
    // project's defaults — a project target only (agent defaults are per project).
    const foot = make('div', 'ask-rp-agents-foot');
    const projectDir = lc.projectDir();
    const saving = !!projectDir && lc.saveDefaults();
    const pending = laneEditedRows(lane).length > 0;
    foot.appendChild(make('span', 'ask-rp-foot-text', !projectDir
      ? 'Changes apply to this run only. Agent defaults are per project.'
      : saving ? `Edits become this project's defaults for ${lane.wf.name || lc.workflowId()}`
        : pending ? 'Changes apply to this run only' : "Runs on this project's agent settings"));
    const save = rpSwitch('saveDefaults', 'Save as project defaults', saving, false, (v) => { lc.setSaveDefaults(v); renderLane(laneSec, lane, lc); }, !!projectDir);
    if (!projectDir) save.title = 'Agent defaults are per project. Pick a project target to save them';
    foot.appendChild(save);
    box.appendChild(foot);
    laneSec.appendChild(box);
    lc.summary.textContent = laneSummary(lane);
    if (lc.onPaint) lc.onPaint(lane);
  }

  /** The stub states. A `started` run — and a `failed` one that HAS a runId — renders the live progress
   *  card instead (buildProgressCard), so neither reaches here. */
  function buildCardTerminal(block) {
    const card = block.card || {};
    if (block.state === 'failed') {
      return make('div', 'ask-card-stub ask-card-failed', `Run failed (${card.title || card.brief || 'run proposal'})${block.error ? `: ${block.error}` : ''}`);
    }
    if (block.state === 'scheduled') return buildCardScheduled(block);
    return make('div', 'ask-card-stub', `Not now: ${card.title || card.brief || 'run proposal'}`);
  }

  // ---- scheduled proposals (docs/scheduled-runs.md "Chat") ----
  const CLOCK_ICO = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 2';
  const localWhen = (iso) => { const ms = Date.parse(iso || ''); return Number.isFinite(ms) ? formatInstant(ms, browserTimeZone()) : 'later'; };
  /** The POST /api/run fields of a proposal's schedule (schedule-spec.mjs scheduleRequestFields). */
  function scheduleFieldsOf(s) {
    if (s && s.kind === 'once') return { scheduledFor: s.runAt };
    if (s && s.kind === 'repeat') return { repeat: { rule: s.rule, overlap: s.overlap, maxFailures: s.maxFailures } };
    if (s && s.kind === 'after') return { after: { kind: s.after.kind, id: s.after.id, title: s.after.title }, afterPolicy: s.policy || 'done', ...(s.sourceFromPrevious ? { sourceFromPrevious: true } : {}) };
    return null;
  }
  /** The schedule sheet's `initial` for a pick (so Change… opens on what the card shows). */
  function sheetInitialOf(pick) {
    if (!pick) return {};
    if (pick.after) return { after: pick.after, afterPolicy: pick.afterPolicy };
    if (pick.repeat) return { rule: pick.repeat.rule, overlap: pick.repeat.overlap, maxFailures: pick.repeat.maxFailures, ifMissed: pick.ifMissed, graceMin: pick.graceMin };
    return { scheduledFor: pick.scheduledFor, ifMissed: pick.ifMissed, graceMin: pick.graceMin };
  }
  function scheduleLineText(s) {
    if (s.kind === 'after') return `${s.text}${s.sourceFromPrevious ? ' · from its branch' : ''}`;
    if (s.kind === 'repeat') return `${s.sentence}${s.next && s.next[0] ? ` · first run ${localWhen(s.next[0].at)}` : ''}`;
    return `Starts ${localWhen(s.runAt)}`;
  }
  function pickedLineText(p) {
    if (p.after) return `After ‘${p.after.title || p.after.id}’ finishes${p.sourceFromPrevious ? ' · from its branch' : ''}`;
    if (p.repeat) return describeRule(p.repeat.rule);
    return `Starts ${localWhen(p.scheduledFor)}`;
  }

  /** A proposal the user scheduled: it waits as a ticket (block.runId) — or, when it became a repeating
   *  schedule, follows the series (block.scheduleId) — until the server starts it. */
  function buildCardScheduled(block) {
    const card = block.card || {};
    const rootEl = make('div', 'ask-card-stub ask-card-sched');
    rootEl.setAttribute('data-ask-card-scheduled', '');
    const series = !!block.scheduleId;
    const title = card.title || card.brief || 'Run';
    rootEl.append(make('span', 'badge grey', series ? 'Repeats' : block.after ? 'After run' : 'Scheduled'), make('span', 'ask-card-sched-text',
      series ? `${title}: ${block.sentence || 'repeating schedule'}${block.scheduledFor ? ` · next ${localWhen(block.scheduledFor)}` : ''}`
        : block.after ? `${title}: after ‘${block.after.title || block.after.id}’ finishes` : `${title}: starts ${localWhen(block.scheduledFor)}`));
    const err = make('span', 'ask-card-err');
    const call = async (method, path, btn) => {
      err.textContent = ''; btn.disabled = true;
      try {
        const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) err.textContent = data.error || `request failed (${res.status})`;
        else if (data.status === 'failed') err.textContent = data.failReason || 'The run could not be started.';
      } catch { err.textContent = 'network error'; }
      btn.disabled = false;   // the flip frame re-renders the card on success
    };
    const target = series ? block.scheduleId : block.runId;
    const runNow = make('button', 'btn btn-sm btn-quiet ask-card-not-now', 'Run now');
    runNow.type = 'button';
    runNow.addEventListener('click', () => call('POST', `/api/schedules/${target}/run-now`, runNow));
    const cancel = make('button', 'btn btn-sm btn-quiet ask-card-not-now', series ? 'Delete schedule' : 'Cancel schedule');
    cancel.type = 'button';
    cancel.addEventListener('click', async () => {
      if (series && typeof confirm === 'function' && !(await confirm(`Delete the schedule "${title}"? Runs it already started are kept.`))) return;
      call('DELETE', `/api/schedules/${target}`, cancel);
    });
    const open = make('a', 'ask-card-sched-link', 'Schedules');
    open.href = '#schedules';
    rootEl.append(runNow, cancel, open, err);
    return rootEl;
  }

  // ---- Workflow card (spec §8.3, mockup 2026-09-05 §A-§C, plan PD4/PD7/PD12-15) ---------------------------------
  const WF_ICO = { check: 'M5 13l4 4L19 7', save: 'M5 12l5 5L20 7' };
  const TUNABLE_KEYS = ['model', 'effort', 'fanOut', 'askQuestions'];
  /** The answer's `nodes`: a DIFF against the proposal (the qpanel's rule, app.js renderWorkflowBody). */
  function diffNodes(base, edits) {
    const nodes = {};
    for (const [id, sel] of Object.entries(edits || {})) {
      const diff = {};
      for (const k of TUNABLE_KEYS) if (sel[k] !== undefined && sel[k] !== ((base || {})[id] || {})[k]) diff[k] = sel[k];
      if (Object.keys(diff).length) nodes[id] = diff;
    }
    return nodes;
  }

  /** The card's target: the workspace (+ member count once proposed), else the project name or key; '' on old cards. */
  const wfTargetLine = (card) => card.workspaceId
    ? `workspace · ${card.workspaceName || card.workspaceId}${Array.isArray(card.members) && card.members.length ? ` · ${card.members.length} projects` : ''}`
    : (card.projectName || card.projectKey || '');
  function wfTargetEl(text) {
    const el = make('div', 'ask-wfcard-meta ask-wfcard-target', text);
    el.setAttribute('data-ask-wf-target', '');
    return el;
  }

  /** A proposed Auto card as a NEW unsaved workflow: the graph the card shows (its well's template — the positions the
   *  card drew), every agent's template config (it carries the proposal's model and effort) with only the chips' edits
   *  applied, as Save stores them (diffNodes, then src/core/ask/workflow-deps.mjs applyTunables: '' clears a key).
   *  card.nodes is a display row whose fanOut/askQuestions are resolved defaults: never baked in. Assemble's domain is
   *  'coding'. */
  function wfDraft(card, wf, name, tpl) {
    const nodes = (tpl.nodes || []).map((n) => {
      if (!n || n.kind !== 'agent') return n;
      const sel = wf.nodes[n.id] || {};
      const config = { ...(n.config || {}) };
      for (const k of TUNABLE_KEYS) {
        if (sel[k] === undefined) continue;
        if (sel[k] === '') delete config[k]; else config[k] = sel[k];
      }
      return { ...n, config };
    });
    return { name: String(name || card.name || ''), domain: card.domain || 'coding', nodes, wires: tpl.wires || [] };
  }
  /** The workflow card's way into the Workflows composer (its graph well's Expand, "Open full screen in Workflows"): a
   *  saved card opens its row; a proposed one matching a saved workflow opens that row (a new copy would invite a
   *  duplicate); a NEW proposal opens as a new unsaved workflow through the build card's path (app.js
   *  askComposerActions().openBuild). null = no way in: the well shows no Expand. */
  function wfOpenAction(block, card, wf, handleOf) {
    const rowId = block.state === 'saved' ? (block.workflowId || null) : (card.match && card.match.id) || null;
    if (block.state !== 'proposed' || rowId) return typeof openComposer === 'function' && rowId ? () => openComposer(rowId) : null;
    const openBuild = composerActions && typeof composerActions.openBuild === 'function' ? composerActions.openBuild : null;
    if (!openBuild) return null;
    return () => {
      const handle = handleOf();
      const tpl = handle && handle.well ? handle.well.template() : null;
      return tpl ? openBuild(wfDraft(card, wf, handle.getName(), tpl)) : undefined;
    };
  }

  function buildWorkflowCard(block, prev) {
    const card = block.card || {};
    const name = card.name || '';
    const target = wfTargetLine(card);
    // Old cards (no target fields) stay the bare stub; otherwise the stub keeps its text and the target sits under it.
    const stub = (el) => {
      if (!target) return { el };
      const wrap = make('div', 'ask-wfcard-stubwrap');
      wrap.append(el, wfTargetEl(target));
      return { el: wrap };
    };
    if (block.state === 'declined') return stub(make('div', 'ask-card-stub', `Declined: ${name || 'workflow proposal'}`));
    if (block.state === 'failed') return stub(make('div', 'ask-card-stub ask-card-failed', `Proposal failed: ${block.error || 'unknown error'}`));
    // State modifier = `is-<state>` (v6): `ask-wfcard-${state}` would make the SAVED root carry the same class as the check line below.
    const rootEl = make('div', `ask-card ask-wfcard is-${block.state}`);
    rootEl.setAttribute('data-ask-wfcard', block.state);
    const head = make('div', 'ask-wfcard-head');
    head.appendChild(make('span', 'ask-wfcard-title', block.state === 'saved' ? 'Saved workflow' : 'Proposed workflow'));
    head.appendChild(make('span', 'ask-wfcard-round', `round ${card.round || 1}`));
    if (block.state === 'saved') { head.appendChild(make('span', 'ask-wfcard-spacer')); head.appendChild(make('span', 'ask-wfcard-tag', 'Auto')); }
    rootEl.appendChild(head);
    if (target) rootEl.appendChild(wfTargetEl(target));
    if (block.state === 'building') {
      const trace = buildTrace(doc, { mode: card.mode });
      rootEl.appendChild(trace.el);
      const stop = scheduleTrace(trace, { win, mode: card.mode });
      return { el: rootEl, dispose: stop };
    }
    const proposed = block.state === 'proposed';
    const matched = !!(card.match && card.match.id);
    const editable = proposed && !matched;                       // PD4: only a NEW row takes a name and chip edits
    const wf = { nodes: {}, name };
    // The Workflows canvas rendering in a pannable well (graph/proposal-host.mjs). Its Expand opens the workflow in the
    // composer (wfOpenAction) — the only Open a proposed card has; footers read Ask's library (composerCards describe).
    const handle = renderAutoProposal({ ...card, reasoning: card.reasoning || card.note || '' }, {
      doc, order: proposed ? AUTO_PROPOSAL_ORDER_CARD : ['name', 'graph', 'loops'],
      editableName: editable, pick: editable, onName: (v) => { wf.name = v; },
      canvas: true, descriptionOf: composerCards().describe, onExpand: wfOpenAction(block, card, wf, () => handle),
    });
    if (!proposed) {
      const saved = make('div', 'ask-wfcard-saved');
      saved.appendChild(svgIcon(WF_ICO.check, 15, 2.4));
      saved.appendChild(make('span', null, name));
      const line = make('div', 'ask-wfcard-savedline', card.adopted ? 'Uses your saved workflow' : 'Saved as a new workflow, tagged Auto');
      handle.parts.name.replaceWith(saved);
      saved.after(line);
    } else if (matched) {
      const hint = make('div', 'ask-wfcard-hint', 'Model and effort come from that saved workflow. Edit them in the Workflows view.');
      handle.parts.match.after(hint);
    }
    rootEl.appendChild(handle.el);
    rootEl.appendChild(make('div', 'ask-card-err'));
    const actions = make('div', 'ask-wfcard-actions');
    const btn = (cls, text, attr, icon) => {
      const b = make('button', cls, text); b.type = 'button'; b.setAttribute(attr, '');
      if (icon) b.prepend(svgIcon(icon, 12, 2.2));
      return b;
    };
    if (proposed) {
      const decline = btn('btn btn-sm btn-quiet ask-card-not-now', 'Decline', 'data-ask-wf-decline');
      decline.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, decline));
      const save = btn('btn btn-sm btn-primary', card.thenRun ? 'Save & propose' : 'Save as workflow', 'data-ask-wf-save', WF_ICO.save);
      // A 200 means the row exists now: drop the cached option lists so every later consumer sees it.
      save.addEventListener('click', () => postCard(block, rootEl, { state: 'saved', name: handle.getName(), nodes: diffNodes(card.nodes, wf.nodes) }, save)
        .then((out) => { if (out) st.cardOptions = null; }));
      actions.append(make('span', 'ask-card-actions-spacer'), decline, save);
    } else {
      const open = btn('link-btn ask-card-open-np', 'Open in Workflows', 'data-ask-wf-open');
      open.disabled = !(typeof openComposer === 'function' && block.workflowId);   // v7: an inert button beats a dead click
      open.addEventListener('click', () => { if (typeof openComposer === 'function' && block.workflowId) openComposer(block.workflowId); });
      // No "Run with this": the save already fired the event turn, which proposes the run
      // itself (thenRun) or offers one in chat — a card verb would only queue a second paid turn.
      actions.append(open);
    }
    rootEl.appendChild(actions);
    if (editable) {
      // PD12: paintBand re-creates the chips on every repaint, so the click is delegated from the card root.
      rootEl.addEventListener('click', (e) => {
        const chip = e.target && e.target.closest ? e.target.closest('.bchip[data-chip]') : null;
        if (!chip) return;
        const nodeEl = chip.closest('[data-node-id]');
        if (!nodeEl) return;
        e.stopPropagation();
        openChipPicker(chip, nodeEl.dataset.nodeId, card, wf, handle);
      });
    }
    rootEl.__wf = { handle, wf };                                  // tests (like the qpanel's panel.__wf)
    return { el: rootEl, handle, dispose: () => handle.destroy(), animate: proposed && !!prev && prev.state === 'building' };
  }

  // ---- Metrics card (docs/team-metrics.md "Chat"): a proposed team-metrics configuration change --------------
  const MC_KIND_LABEL = { enable: 'Enable team metrics', record: 'Include my runs', workspace_home: 'Metrics home', route_members: 'Route members' };
  const MC_APPLY_LABEL = { enable: 'Enable', record: 'Apply', workspace_home: 'Set home', route_members: 'Route members' };
  // A team-policy card (docs/team-policy.md "Chat") is the same component: other words, plus the
  // before → after list of an edit.
  const PC_KIND_LABEL = { enable: 'Set up team policy', edit: 'Edit team policy', workspace_home: 'Policy home', route_members: 'Route members' };
  const pcApplyLabel = (card) => (card.kind === 'enable' ? (card.mode === 'follow' ? 'Follow' : 'Set up') : card.kind === 'edit' ? 'Publish'
    : card.kind === 'workspace_home' ? 'Set home' : card.kind === 'route_members' ? 'Route members' : 'Apply');
  function buildMetricsCard(block) {
    const card = block.card || {};
    const isPolicy = card.type === 'policy';
    const noun = isPolicy ? 'policy change' : 'metrics change';
    const Noun = isPolicy ? 'Policy change' : 'Metrics change';
    const summary = card.summary || noun;
    if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined: ${summary}`) };
    const rootEl = make('div', `ask-card ask-mcard${isPolicy ? ' ask-pcard' : ''} is-${block.state}`);
    rootEl.setAttribute(isPolicy ? 'data-ask-pcard' : 'data-ask-mcard', block.state);
    const head = make('div', 'ask-mcard-head');
    head.appendChild(make('span', 'ask-mcard-title', block.state === 'applied' ? `Applied ${noun}` : block.state === 'failed' ? `${Noun} failed` : `Proposed ${noun}`));
    head.appendChild(make('span', 'ask-mcard-kind', (isPolicy ? PC_KIND_LABEL : MC_KIND_LABEL)[card.kind] || card.kind || ''));
    rootEl.appendChild(head);
    const body = make('div', 'ask-mcard-body');
    const target = card.workspaceName ? `workspace ${card.workspaceName}` : card.projectName ? `project ${card.projectName}` : '';
    const sum = make('div', 'ask-mcard-summary');
    if (block.state === 'applied') sum.appendChild(svgIcon(WF_ICO.check, 15, 2.4));
    sum.appendChild(make('span', null, summary));
    body.appendChild(sum);
    if (target) body.appendChild(make('div', 'ask-mcard-target', target));
    if (card.note) body.appendChild(make('div', 'ask-mcard-note', card.note));
    if (isPolicy && Array.isArray(card.changes) && card.changes.length) {
      const ul = make('ul', 'ask-mcard-changes');
      for (const c of card.changes) {
        const li = make('li');
        li.appendChild(make('span', 'ask-mcard-change-label', c.label || c.key || ''));
        const val = make('span', 'ask-mcard-change-val');
        val.appendChild(make('span', c.before ? 'ask-mcard-before' : 'ask-mcard-before is-unset', c.before || 'unset'));
        val.appendChild(make('span', 'ask-mcard-arrow', '→'));
        val.appendChild(make('span', c.after ? 'ask-mcard-after' : 'ask-mcard-after is-unset', c.after || 'unset'));
        li.appendChild(val);
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }
    if (Array.isArray(card.effects) && card.effects.length && block.state === 'proposed') {
      const ul = make('ul', 'ask-mcard-effects');
      for (const e of card.effects) ul.appendChild(make('li', null, e));
      body.appendChild(ul);
    }
    const result = card.result || null;
    if (block.state === 'failed') {
      body.appendChild(make('div', 'ask-mcard-failed', `Could not apply: ${block.error || (result && result.error) || 'unknown error'}`));
      if (result && result.hint) body.appendChild(make('div', 'ask-mcard-hint', result.hint));
    } else if (block.state === 'applied' && result) {
      if (result.detail) body.appendChild(make('div', 'ask-mcard-detail', result.detail));
      if (Array.isArray(result.results) && result.results.length) {
        const ul = make('ul', 'ask-mcard-results');
        for (const r of result.results) {
          const li = make('li', `is-${r.result || 'unknown'}`);
          li.appendChild(make('span', 'mono', r.slug || r.path || ''));
          li.appendChild(make('span', null, ` · ${r.result || ''}${r.reason ? ` · ${r.reason}` : ''}${r.error ? ` · ${r.error}` : ''}`));
          if (r.hint) li.appendChild(make('div', 'ask-mcard-hint', r.hint));
          ul.appendChild(li);
        }
        body.appendChild(ul);
      }
    }
    rootEl.appendChild(body);
    rootEl.appendChild(make('div', 'ask-card-err'));
    if (block.state === 'proposed') {
      const actions = make('div', 'ask-mcard-actions');
      const btn = (cls, text, attr, icon) => {
        const b = make('button', cls, text); b.type = 'button'; b.setAttribute(attr, '');
        if (icon) b.prepend(svgIcon(icon, 12, 2.2));
        return b;
      };
      const decline = btn('btn btn-sm btn-quiet ask-card-not-now', 'Decline', 'data-ask-mc-decline');
      decline.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, decline));
      const apply = btn('btn btn-sm btn-primary', isPolicy ? pcApplyLabel(card) : (MC_APPLY_LABEL[card.kind] || 'Apply'), 'data-ask-mc-apply', WF_ICO.save);
      apply.addEventListener('click', () => postCard(block, rootEl, { state: 'applied' }, apply));
      actions.append(make('span', 'ask-card-actions-spacer'), decline, apply);
      rootEl.appendChild(actions);
    }
    return { el: rootEl };
  }

  // ---- Away mode card (plans/away-mode-wording.md §3.7): a proposed change to the stored Away mode settings -------
  // The metrics card's frame (ask-mcard) with its own body: the summary lines before and after, the changed words
  // marked, one line per changed field.
  /** One After line, each word that its Before line (same index) lacks wrapped in <mark>. */
  function awayLineWithMarks(after, before) {
    const line = make('div', 'ask-awcard-line');
    const had = new Set(String(before || '').split(/\s+/).filter(Boolean));
    for (const part of String(after || '').split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part) || had.has(part)) line.appendChild(doc.createTextNode(part));
      else line.appendChild(make('mark', null, part));
    }
    return line;
  }
  function buildAwayCard(block) {
    const card = block.card || {};
    const summary = card.summary || 'Away mode change';
    if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined: ${summary}`) };
    const rootEl = make('div', `ask-card ask-mcard ask-awcard is-${block.state}`);
    rootEl.setAttribute('data-ask-awcard', block.state);
    const head = make('div', 'ask-mcard-head');
    const where = card.level === 'project' ? `(project ${card.projectName || card.projectKey || ''})` : '(user settings)';
    head.appendChild(make('span', 'ask-mcard-title', `Change Away mode? ${where}`));
    rootEl.appendChild(head);
    const body = make('div', 'ask-mcard-body');
    if (card.note) body.appendChild(make('div', 'ask-mcard-note', card.note));
    const before = Array.isArray(card.before) ? card.before : [];
    const after = Array.isArray(card.after) ? card.after : [];
    const now = make('div', 'ask-awcard-now');
    now.appendChild(make('b', null, 'Now: '));
    for (const l of before) now.appendChild(make('div', 'ask-awcard-line', l));
    const next = make('div', 'ask-awcard-after');
    next.appendChild(make('b', null, 'After: '));
    after.forEach((l, i) => next.appendChild(awayLineWithMarks(l, before[i])));
    body.append(now, next);
    if (Array.isArray(card.changes) && card.changes.length) {
      const changed = make('div', 'ask-awcard-changed');
      changed.appendChild(make('b', null, 'Changed:'));
      const ul = make('ul', 'ask-awcard-changes');
      for (const c of card.changes) ul.appendChild(make('li', null, `${c.label || c.field || ''}: ${c.before ?? ''} → ${c.after ?? ''}`));
      changed.appendChild(ul);
      body.appendChild(changed);
    }
    const result = card.result || null;
    if (block.state === 'failed') body.appendChild(make('div', 'ask-mcard-failed', `Could not apply: ${block.error || (result && result.error) || 'unknown error'}`));
    else if (block.state === 'applied') body.appendChild(make('div', 'ask-awcard-saved', `Saved.${result && result.detail ? ` ${result.detail}` : ''}`));
    rootEl.appendChild(body);
    rootEl.appendChild(make('div', 'ask-card-err'));
    if (block.state === 'proposed') {
      const actions = make('div', 'ask-mcard-actions');
      const btn = (cls, text, attr, icon) => {
        const b = make('button', cls, text); b.type = 'button'; b.setAttribute(attr, '');
        if (icon) b.prepend(svgIcon(icon, 12, 2.2));
        return b;
      };
      const keep = btn('btn btn-sm btn-quiet ask-card-not-now', 'Keep as is', 'data-ask-ac-decline');
      keep.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, keep));
      const apply = btn('btn btn-sm btn-primary', 'Apply', 'data-ask-ac-apply', WF_ICO.save);
      apply.addEventListener('click', () => postCard(block, rootEl, { state: 'applied' }, apply));
      actions.append(make('span', 'ask-card-actions-spacer'), keep, apply);
      rootEl.appendChild(actions);
    }
    return { el: rootEl };
  }

  // ---- Schedule card (docs/scheduled-runs.md "Chat"): a proposed change to an existing schedule ------------
  const SC_ACTION_LABEL = { run_now: 'Run now', move: 'Change time', edit: 'Edit schedule', cancel: 'Cancel run', delete: 'Delete schedule' };
  const SC_APPLY_LABEL = { run_now: 'Run now', move: 'Move', edit: 'Apply', cancel: 'Cancel run', delete: 'Delete' };
  function buildScheduleCard(block) {
    const card = block.card || {};
    const summary = card.summary || 'schedule change';
    if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined: ${summary}`) };
    const rootEl = make('div', `ask-card ask-mcard ask-scard is-${block.state}`);
    rootEl.setAttribute('data-ask-scard', block.state);
    const head = make('div', 'ask-mcard-head');
    head.appendChild(make('span', 'ask-mcard-title', block.state === 'applied' ? 'Applied schedule change' : block.state === 'failed' ? 'Schedule change failed' : 'Proposed schedule change'));
    head.appendChild(make('span', 'ask-mcard-kind', SC_ACTION_LABEL[card.action] || card.action || ''));
    rootEl.appendChild(head);
    const body = make('div', 'ask-mcard-body');
    const sum = make('div', 'ask-mcard-summary');
    if (block.state === 'applied') sum.appendChild(svgIcon(WF_ICO.check, 15, 2.4));
    sum.appendChild(make('span', null, summary));
    body.appendChild(sum);
    if (card.targetName) body.appendChild(make('div', 'ask-mcard-target', card.targetName));
    if (card.note) body.appendChild(make('div', 'ask-mcard-note', card.note));
    if (block.state === 'proposed' && (card.before || card.after)) {
      const kv = make('div', 'ask-scard-kv');
      const row = (k, v) => { if (!v) return; kv.append(make('span', 'ask-scard-k', k), make('span', 'ask-scard-v', v)); };
      const b = card.before || {};
      const a = card.after || {};
      if (card.action === 'edit') {
        row('Now', b.sentence);
        if (a.sentence && a.sentence !== b.sentence) row('Becomes', a.sentence);
        if (Array.isArray(a.next) && a.next.length) row('Next runs', a.next.map((n) => localWhen(n.at)).join(' · '));
      } else if (card.action === 'move') {
        // Run chains: a move to AFTER another run has no instant on either side — say what it is.
        row('From', b.at ? localWhen(b.at) : b.when || '');
        row('To', a.at ? localWhen(a.at) : a.text || '');
      } else if (b.at) row(card.itemKind === 'recurring' ? 'Next run' : 'Scheduled for', localWhen(b.at));
      if (kv.childNodes.length) body.appendChild(kv);
    }
    const result = card.result || null;
    if (block.state === 'failed') body.appendChild(make('div', 'ask-mcard-failed', `Could not apply: ${block.error || (result && result.error) || 'unknown error'}`));
    else if (block.state === 'applied' && result && result.detail) body.appendChild(make('div', 'ask-mcard-detail', result.detail));
    if (block.state !== 'proposed') {
      const open = make('a', 'ask-card-sched-link', 'Schedules');
      open.href = '#schedules';
      body.appendChild(open);
    }
    rootEl.appendChild(body);
    rootEl.appendChild(make('div', 'ask-card-err'));
    if (block.state === 'proposed') {
      const actions = make('div', 'ask-mcard-actions');
      const btn = (cls, text, attr, icon) => {
        const b = make('button', cls, text); b.type = 'button'; b.setAttribute(attr, '');
        if (icon) b.prepend(svgIcon(icon, 12, 2.2));
        return b;
      };
      const decline = btn('btn btn-sm btn-quiet ask-card-not-now', 'Decline', 'data-ask-sc-decline');
      decline.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, decline));
      const destructive = card.action === 'cancel' || card.action === 'delete';
      const apply = btn(destructive ? 'btn btn-sm btn-danger' : 'btn btn-sm btn-primary', SC_APPLY_LABEL[card.action] || 'Apply', 'data-ask-sc-apply',
        card.action === 'run_now' ? null : WF_ICO.save);
      apply.addEventListener('click', () => postCard(block, rootEl, { state: 'applied' }, apply));
      actions.append(make('span', 'ask-card-actions-spacer'), decline, apply);
      rootEl.appendChild(actions);
    }
    return { el: rootEl };
  }

  // ---- Model card (docs/models.md "Chat"): a proposed catalog or provider change ------------------------------
  const MOD_KIND_LABEL = { add_model: 'Add model', edit_model: 'Edit model', remove_model: 'Remove model', provider: 'Provider', import_copilot: 'From Copilot' };
  const MOD_APPLY_LABEL = { add_model: 'Add', edit_model: 'Apply', remove_model: 'Remove', provider: 'Apply', import_copilot: 'Import' };
  function buildModelCard(block) {
    const card = block.card || {};
    const summary = card.summary || 'model change';
    if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined: ${summary}`) };
    const rootEl = make('div', `ask-card ask-mcard ask-modcard is-${block.state}`);
    rootEl.setAttribute('data-ask-modcard', block.state);
    const noun = card.kind === 'provider' ? 'provider change' : 'model change';
    const head = make('div', 'ask-mcard-head');
    head.appendChild(make('span', 'ask-mcard-title', block.state === 'applied' ? `Applied ${noun}` : block.state === 'failed' ? `${noun[0].toUpperCase()}${noun.slice(1)} failed` : `Proposed ${noun}`));
    head.appendChild(make('span', 'ask-mcard-kind', MOD_KIND_LABEL[card.kind] || card.kind || ''));
    rootEl.appendChild(head);
    const body = make('div', 'ask-mcard-body');
    const sum = make('div', 'ask-mcard-summary');
    if (block.state === 'applied') sum.appendChild(svgIcon(WF_ICO.check, 15, 2.4));
    sum.appendChild(make('span', null, summary));
    body.appendChild(sum);
    if (card.note) body.appendChild(make('div', 'ask-mcard-note', card.note));
    if (block.state === 'proposed' && Array.isArray(card.rows) && card.rows.length) {
      const ul = make('ul', 'ask-mcard-changes');
      const oneSided = card.kind === 'add_model' || card.kind === 'remove_model';
      for (const r of card.rows) {
        const li = make('li');
        li.appendChild(make('span', 'ask-mcard-change-label', r.field || ''));
        const val = make('span', 'ask-mcard-change-val');
        if (oneSided) val.appendChild(make('span', card.kind === 'remove_model' ? 'ask-mcard-before' : 'ask-mcard-after', (card.kind === 'remove_model' ? r.before : r.after) || ''));
        else {
          val.appendChild(make('span', r.before ? 'ask-mcard-before' : 'ask-mcard-before is-unset', r.before || 'unset'));
          val.appendChild(make('span', 'ask-mcard-arrow', '→'));
          val.appendChild(make('span', r.after ? 'ask-mcard-after' : 'ask-mcard-after is-unset', r.after || 'unset'));
        }
        li.appendChild(val);
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }
    if (block.state === 'proposed' && Array.isArray(card.warnings) && card.warnings.length) {
      const ul = make('ul', 'ask-mcard-effects ask-modcard-warn');
      for (const w of card.warnings) ul.appendChild(make('li', null, w));
      body.appendChild(ul);
    }
    const result = card.result || null;
    if (block.state === 'failed') body.appendChild(make('div', 'ask-mcard-failed', `Could not apply: ${block.error || (result && result.error) || 'unknown error'}`));
    else if (block.state === 'applied' && result && result.detail) body.appendChild(make('div', 'ask-mcard-detail', result.detail));
    if (block.state !== 'proposed') {
      const open = make('a', 'ask-card-sched-link', 'Models');
      open.href = '#models';
      body.appendChild(open);
    }
    rootEl.appendChild(body);
    rootEl.appendChild(make('div', 'ask-card-err'));
    if (block.state === 'proposed') {
      const actions = make('div', 'ask-mcard-actions');
      const btn = (cls, text, attr, icon) => {
        const b = make('button', cls, text); b.type = 'button'; b.setAttribute(attr, '');
        if (icon) b.prepend(svgIcon(icon, 12, 2.2));
        return b;
      };
      const decline = btn('btn btn-sm btn-quiet ask-card-not-now', 'Decline', 'data-ask-mod-decline');
      decline.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, decline));
      const destructive = card.kind === 'remove_model';
      const apply = btn(destructive ? 'btn btn-sm btn-danger' : 'btn btn-sm btn-primary', MOD_APPLY_LABEL[card.kind] || 'Apply', 'data-ask-mod-apply', destructive ? null : WF_ICO.save);
      apply.addEventListener('click', () => postCard(block, rootEl, { state: 'applied' }, apply));
      actions.append(make('span', 'ask-card-actions-spacer'), decline, apply);
      rootEl.appendChild(actions);
    }
    return { el: rootEl };
  }

  /** The web card (propose_web_access): proposed → applied | failed, or declined. The exact URL is shown, so a
   *  request that smuggles data is visible before the click. Every value is text. */
  function buildWebCard(block) {
    const card = block.card || {};
    const host = card.host || 'a website';
    if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined: ${card.summary || `Read ${host}`}`) };
    const rootEl = make('div', `ask-card ask-mcard ask-webcard is-${block.state}`);
    rootEl.setAttribute('data-ask-webcard', block.state);
    const result = card.result || null;
    const head = make('div', 'ask-mcard-head');
    const title = block.state === 'failed' ? 'Web access not granted'
      : block.state === 'applied' ? (result && result.scope === 'always' ? 'Always allowed' : 'Allowed for this chat')
        : 'Chat wants to read a new site';
    head.appendChild(make('span', 'ask-mcard-title', title));
    head.appendChild(make('span', 'ask-mcard-kind', 'Web'));
    rootEl.appendChild(head);
    const body = make('div', 'ask-mcard-body');
    const sum = make('div', 'ask-mcard-summary');
    if (block.state === 'applied') sum.appendChild(svgIcon(WF_ICO.check, 15, 2.4));
    sum.appendChild(make('span', null, host));
    body.appendChild(sum);
    if (card.reason) body.appendChild(make('div', 'ask-mcard-note', card.reason));
    const ul = make('ul', 'ask-mcard-changes');
    const li = make('li');
    li.appendChild(make('span', 'ask-mcard-change-label', 'URL'));
    const val = make('span', 'ask-mcard-change-val');
    val.appendChild(make('span', 'ask-mcard-after', String(card.url || '')));
    li.appendChild(val);
    ul.appendChild(li);
    body.appendChild(ul);
    if (block.state === 'failed') body.appendChild(make('div', 'ask-mcard-failed', `Could not allow: ${block.error || (result && result.error) || 'unknown error'}`));
    rootEl.appendChild(body);
    rootEl.appendChild(make('div', 'ask-card-err'));
    if (block.state === 'proposed') {
      const actions = make('div', 'ask-mcard-actions');
      const btn = (cls, text, attr) => { const b = make('button', cls, text); b.type = 'button'; b.setAttribute(attr, ''); return b; };
      const decline = btn('btn btn-sm btn-quiet ask-card-not-now', 'Deny', 'data-ask-web-decline');
      decline.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, decline));
      const always = btn('btn btn-sm btn-quiet ask-card-not-now', 'Always allow', 'data-ask-web-always');
      always.title = `Adds ${host} to Settings → Chat → Web access`;
      always.addEventListener('click', () => postCard(block, rootEl, { state: 'applied', scope: 'always' }, always));
      const chat = btn('btn btn-sm btn-primary', 'Allow in chat', 'data-ask-web-chat');
      chat.addEventListener('click', () => postCard(block, rootEl, { state: 'applied', scope: 'chat' }, chat));
      actions.append(make('span', 'ask-card-actions-spacer'), decline, always, chat);
      rootEl.appendChild(actions);
    }
    return { el: rootEl };
  }

  /** The clone card (propose_clone_project): proposed → cloning → applied | failed, or declined. Every value is text. */
  function buildCloneCard(block) {
    const card = block.card || {};
    const summary = card.summary || 'clone a repository';
    if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined: ${summary}`) };
    const rootEl = make('div', `ask-card ask-mcard ask-clonecard is-${block.state}`);
    rootEl.setAttribute('data-ask-clonecard', block.state);
    const head = make('div', 'ask-mcard-head');
    const title = block.state === 'applied' ? 'Project cloned' : block.state === 'failed' ? 'Clone failed'
      : block.state === 'cloning' ? 'Cloning…' : 'Proposed project';
    head.appendChild(make('span', 'ask-mcard-title', title));
    head.appendChild(make('span', 'ask-mcard-kind', 'Clone'));
    rootEl.appendChild(head);
    const body = make('div', 'ask-mcard-body');
    const sum = make('div', 'ask-mcard-summary');
    if (block.state === 'applied') sum.appendChild(svgIcon(WF_ICO.check, 15, 2.4));
    sum.appendChild(make('span', null, summary));
    body.appendChild(sum);
    if (card.note) body.appendChild(make('div', 'ask-mcard-note', card.note));
    const azureCard = /^https:\/\/dev\.azure\.com\//i.test(String(card.url || ''));
    const rows = [['Repository', card.url], ['Branch', card.branch || 'default branch'], ['Folder', card.dir],
      [azureCard ? 'Azure DevOps' : 'GitHub', card.github]];
    const ul = make('ul', 'ask-mcard-changes');
    for (const [label, value] of rows) {
      if (!value) continue;
      const li = make('li');
      li.appendChild(make('span', 'ask-mcard-change-label', label));
      const val = make('span', 'ask-mcard-change-val');
      val.appendChild(make('span', 'ask-mcard-after', String(value)));
      li.appendChild(val);
      ul.appendChild(li);
    }
    body.appendChild(ul);
    const result = card.result || null;
    if (block.state === 'failed') body.appendChild(make('div', 'ask-mcard-failed', `Could not clone: ${block.error || (result && result.error) || 'unknown error'}`));
    else if (block.state === 'applied' && result && result.project && result.project.path) {
      body.appendChild(make('div', 'ask-mcard-detail', `Registered as ${result.project.name || card.name} at ${result.project.path}`));
    }
    rootEl.appendChild(body);
    rootEl.appendChild(make('div', 'ask-card-err'));
    if (block.state === 'proposed') {
      const actions = make('div', 'ask-mcard-actions');
      const btn = (cls, text, attr, icon) => {
        const b = make('button', cls, text); b.type = 'button'; b.setAttribute(attr, '');
        if (icon) b.prepend(svgIcon(icon, 12, 2.2));
        return b;
      };
      const decline = btn('btn btn-sm btn-quiet ask-card-not-now', 'Decline', 'data-ask-clone-decline');
      decline.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, decline));
      const apply = btn('btn btn-sm btn-primary', 'Clone', 'data-ask-clone-apply', WF_ICO.save);
      apply.addEventListener('click', () => postCard(block, rootEl, { state: 'applied' }, apply));
      actions.append(make('span', 'ask-card-actions-spacer'), decline, apply);
      rootEl.appendChild(actions);
    }
    return { el: rootEl };
  }

  /** The project card (propose_project_change, ChatCreate board): proposed → applied | failed, or declined. New makes a
   *  folder by name, Folder adds one that exists. Every value is text; paths are shown as sent, never parsed (S22). */
  function buildProjectCard(block) {
    const card = block.card || {};
    const add = card.kind === 'add';
    const summary = card.summary || (add ? 'add a project' : 'create a project');
    if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined — ${summary}`) };
    const rootEl = make('div', `ask-card ask-mcard ask-projectcard is-${block.state}`);
    rootEl.setAttribute('data-ask-projectcard', block.state);
    const head = make('div', 'ask-mcard-head');
    const title = block.state === 'applied' ? (add ? 'Project added' : 'Project created')
      : block.state === 'failed' ? (add ? 'Add failed' : 'Create failed') : 'Proposed project';
    head.appendChild(make('span', 'ask-mcard-title', title));
    head.appendChild(make('span', 'ask-mcard-kind', add ? 'Folder' : 'New'));
    rootEl.appendChild(head);
    const body = make('div', 'ask-mcard-body');
    const sum = make('div', 'ask-mcard-summary');
    if (block.state === 'applied') sum.appendChild(svgIcon(WF_ICO.check, 15, 2.4));
    sum.appendChild(make('span', null, summary));
    body.appendChild(sum);
    if (card.note) body.appendChild(make('div', 'ask-mcard-note', card.note));
    const ul = make('ul', 'ask-mcard-changes');
    const row = (label, fill) => {
      const li = make('li');
      li.appendChild(make('span', 'ask-mcard-change-label', label));
      const val = make('span', 'ask-mcard-change-val');
      fill(val);
      li.appendChild(val);
      ul.appendChild(li);
    };
    row('Name', (val) => val.appendChild(make('span', 'ask-mcard-after', String(card.name || ''))));
    row('Folder', (val) => {
      if (card.path) val.title = String(card.path);
      val.appendChild(make('span', 'ask-mcard-after', String(card.displayPath || card.path || '')));
    });
    row('Kind', (val) => { const chip = kindChip(doc, card.vcs === 'git' ? 'git' : 'folder'); if (chip) val.appendChild(chip); });
    body.appendChild(ul);
    const result = card.result || null;
    if (block.state === 'failed') {
      body.appendChild(make('div', 'ask-mcard-failed', `Could not ${add ? 'add' : 'create'}: ${block.error || (result && result.error) || 'unknown error'}`));
    } else if (block.state === 'applied' && result && result.project) {
      const p = result.project;
      body.appendChild(make('div', 'ask-mcard-detail', `Registered as ${p.name || card.name} at ${p.displayPath || p.path}`));
    }
    rootEl.appendChild(body);
    rootEl.appendChild(make('div', 'ask-card-err'));
    if (block.state === 'proposed') {
      const actions = make('div', 'ask-mcard-actions');
      const btn = (cls, text, attr, icon) => {
        const b = make('button', cls, text); b.type = 'button'; b.setAttribute(attr, '');
        if (icon) b.prepend(svgIcon(icon, 12, 2.2));
        return b;
      };
      const decline = btn('btn btn-sm btn-quiet ask-card-not-now', 'Decline', 'data-ask-project-decline');
      decline.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, decline));
      const apply = btn('btn btn-sm btn-primary', add ? 'Add' : 'Create', 'data-ask-project-apply', WF_ICO.save);
      apply.addEventListener('click', () => postCard(block, rootEl, { state: 'applied' }, apply));
      actions.append(make('span', 'ask-card-actions-spacer'), decline, apply);
      rootEl.appendChild(actions);
    }
    return { el: rootEl };
  }

  // ---- Workspace card (propose_workspace_change): create, add / remove members, rename ------------------------------
  const WS_KIND_LABEL = { create: 'Create', add_members: 'Add members', remove_member: 'Remove member', rename: 'Rename' };
  const WS_APPLY_LABEL = { create: 'Create', add_members: 'Add', remove_member: 'Remove', rename: 'Rename' };
  /** proposed → applied | failed, or declined. Every value is text. */
  function buildWorkspaceCard(block) {
    const card = block.card || {};
    const summary = card.summary || 'workspace change';
    if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined: ${summary}`) };
    const rootEl = make('div', `ask-card ask-mcard ask-wscard is-${block.state}`);
    rootEl.setAttribute('data-ask-wscard', block.state);
    const head = make('div', 'ask-mcard-head');
    head.appendChild(make('span', 'ask-mcard-title', block.state === 'applied' ? 'Applied workspace change' : block.state === 'failed' ? 'Workspace change failed' : 'Proposed workspace change'));
    head.appendChild(make('span', 'ask-mcard-kind', WS_KIND_LABEL[card.kind] || card.kind || ''));
    rootEl.appendChild(head);
    const body = make('div', 'ask-mcard-body');
    const sum = make('div', 'ask-mcard-summary');
    if (block.state === 'applied') sum.appendChild(svgIcon(WF_ICO.check, 15, 2.4));
    sum.appendChild(make('span', null, summary));
    body.appendChild(sum);
    if (card.note) body.appendChild(make('div', 'ask-mcard-note', card.note));
    const member = (m) => (m && m.path ? `${m.name || ''} · ${m.path}` : (m && m.name) || '');
    const rows = [
      ['Workspace', card.kind === 'create' ? card.name : card.workspaceName],
      ...(card.kind === 'create' ? (card.members || []).map((m) => ['Member', member(m), m]) : []),
      ...(card.kind === 'add_members' ? (card.added || []).map((m) => ['Add', member(m), m]) : []),
      ...(card.kind === 'remove_member' && card.removed ? [['Remove', member(card.removed), card.removed]] : []),
      ...(card.kind === 'rename' ? [['New name', card.name]] : []),
    ];
    const ul = make('ul', 'ask-mcard-changes');
    for (const [label, value, m] of rows) {
      if (!value) continue;
      const li = make('li');
      li.appendChild(make('span', 'ask-mcard-change-label', label));
      const val = make('span', 'ask-mcard-change-val');
      val.appendChild(make('span', label === 'Remove' ? 'ask-mcard-before' : 'ask-mcard-after', String(value)));
      if (m && m.vcs === 'none') val.appendChild(kindChip(doc, 'folder'));   // P5: a Folder member (P4b's kindChip binding, S59)
      li.appendChild(val);
      ul.appendChild(li);
    }
    body.appendChild(ul);
    if (block.state === 'proposed') {
      for (const [items, cls] of [[card.warnings, 'ask-mcard-effects ask-wscard-warn'], [card.effects, 'ask-mcard-effects ask-wscard-effects']]) {
        if (!Array.isArray(items) || !items.length) continue;
        const list = make('ul', cls);
        for (const w of items) list.appendChild(make('li', null, w));
        body.appendChild(list);
      }
    }
    const result = card.result || null;
    if (block.state === 'failed') body.appendChild(make('div', 'ask-mcard-failed', `Could not apply: ${block.error || (result && result.error) || 'unknown error'}`));
    else if (block.state === 'applied' && result && result.detail) body.appendChild(make('div', 'ask-mcard-detail', result.detail));
    const wid = (result && result.workspaceId) || card.workspaceId;
    if (block.state === 'applied' && wid) {
      const open = make('a', 'ask-card-sched-link', 'Open the workspace');
      open.href = `#workspaces/${encodeURIComponent(wid)}`;
      body.appendChild(open);
    }
    rootEl.appendChild(body);
    rootEl.appendChild(make('div', 'ask-card-err'));
    if (block.state === 'proposed') {
      const actions = make('div', 'ask-mcard-actions');
      const btn = (cls, text, attr, icon) => {
        const b = make('button', cls, text); b.type = 'button'; b.setAttribute(attr, '');
        if (icon) b.prepend(svgIcon(icon, 12, 2.2));
        return b;
      };
      const decline = btn('btn btn-sm btn-quiet ask-card-not-now', 'Decline', 'data-ask-ws-decline');
      decline.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, decline));
      const destructive = card.kind === 'remove_member';
      const apply = btn(destructive ? 'btn btn-sm btn-danger' : 'btn btn-sm btn-primary', WS_APPLY_LABEL[card.kind] || 'Apply', 'data-ask-ws-apply', destructive ? null : WF_ICO.save);
      apply.addEventListener('click', () => postCard(block, rootEl, { state: 'applied' }, apply));
      actions.append(make('span', 'ask-card-actions-spacer'), decline, apply);
      rootEl.appendChild(actions);
    }
    return { el: rootEl };
  }

  // ---- Actions card (propose_actions_change): a project's setup + actions, or a workspace's stacks ----------------
  // Every command the card would store is shown word for word (docs/actions.md "Chat"): applying stores config,
  // and a person's Start is what later runs it. Every value is text.
  const ACT_KIND_LABEL = { project: 'Project actions', stacks: 'Workspace stacks' };
  const ACT_OP_LABEL = { add: 'Add', change: 'Change', remove: 'Remove' };
  /** proposed → applied | failed, or declined. */
  function buildActionsCard(block) {
    const card = block.card || {};
    const summary = card.summary || 'actions change';
    if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined: ${summary}`) };
    const rootEl = make('div', `ask-card ask-mcard ask-acard is-${block.state}`);
    rootEl.setAttribute('data-ask-acard', block.state);
    const head = make('div', 'ask-mcard-head');
    head.appendChild(make('span', 'ask-mcard-title', block.state === 'applied' ? 'Applied actions change' : block.state === 'failed' ? 'Actions change failed' : 'Proposed actions change'));
    head.appendChild(make('span', 'ask-mcard-kind', ACT_KIND_LABEL[card.kind] || card.kind || ''));
    rootEl.appendChild(head);
    const body = make('div', 'ask-mcard-body');
    const sum = make('div', 'ask-mcard-summary');
    if (block.state === 'applied') sum.appendChild(svgIcon(WF_ICO.check, 15, 2.4));
    sum.appendChild(make('span', null, summary));
    body.appendChild(sum);
    if (card.note) body.appendChild(make('div', 'ask-mcard-note', card.note));
    const ul = make('ul', 'ask-mcard-changes');
    for (const c of Array.isArray(card.changes) ? card.changes : []) {
      const li = make('li', 'ask-acard-change');
      li.setAttribute('data-op', c.op || '');
      li.appendChild(make('span', 'ask-mcard-change-label', `${ACT_OP_LABEL[c.op] || ''} ${c.label || c.id || ''}`.trim()));
      const val = make('span', 'ask-mcard-change-val');
      const both = c.before != null && c.after != null;
      if (c.before != null && block.state === 'proposed') {
        if (both) val.appendChild(make('span', 'ask-acard-tag', 'Now'));
        val.appendChild(make('span', 'ask-mcard-before ask-acard-cmd', String(c.before)));
      }
      if (c.after != null) {
        if (both && block.state === 'proposed') val.appendChild(make('span', 'ask-acard-tag', 'New'));
        val.appendChild(make('span', 'ask-mcard-after ask-acard-cmd', String(c.after)));
      }
      li.appendChild(val);
      ul.appendChild(li);
    }
    body.appendChild(ul);
    if (block.state === 'proposed') {
      for (const [items, cls] of [[card.warnings, 'ask-mcard-effects ask-wscard-warn'], [card.effects, 'ask-mcard-effects ask-wscard-effects']]) {
        if (!Array.isArray(items) || !items.length) continue;
        const list = make('ul', cls);
        for (const w of items) list.appendChild(make('li', null, w));
        body.appendChild(list);
      }
    }
    const result = card.result || null;
    if (block.state === 'failed') body.appendChild(make('div', 'ask-mcard-failed', `Could not apply: ${block.error || (result && result.error) || 'unknown error'}`));
    else if (block.state === 'applied' && result && result.detail) body.appendChild(make('div', 'ask-mcard-detail', result.detail));
    if (block.state === 'applied') {
      const href = card.kind === 'stacks' && card.workspaceId ? `#workspaces/${encodeURIComponent(card.workspaceId)}`
        : card.projectKey ? `#projects/${encodeURIComponent(card.projectKey)}/actions` : null;
      if (href) {
        const open = make('a', 'ask-card-sched-link', card.kind === 'stacks' ? 'Open the workspace' : 'Open the Actions tab');
        open.href = href;
        body.appendChild(open);
      }
    }
    rootEl.appendChild(body);
    rootEl.appendChild(make('div', 'ask-card-err'));
    if (block.state === 'proposed') {
      const actions = make('div', 'ask-mcard-actions');
      const btn = (cls, text, attr, icon) => {
        const b = make('button', cls, text); b.type = 'button'; b.setAttribute(attr, '');
        if (icon) b.prepend(svgIcon(icon, 12, 2.2));
        return b;
      };
      const decline = btn('btn btn-sm btn-quiet ask-card-not-now', 'Decline', 'data-ask-act-decline');
      decline.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, decline));
      const apply = btn('btn btn-sm btn-primary', 'Save', 'data-ask-act-apply', WF_ICO.save);
      apply.addEventListener('click', () => postCard(block, rootEl, { state: 'applied' }, apply));
      actions.append(make('span', 'ask-card-actions-spacer'), decline, apply);
      rootEl.appendChild(actions);
    }
    return { el: rootEl };
  }

  /** The model · effort picker (mockup §C): the panel's popover chrome, anchored under the chip. Rows are menuitems (PD28). */
  function openChipPicker(chip, nodeId, card, wf, handle) {
    const node = card.nodes && card.nodes[nodeId];
    if (!node) return;
    const models = Array.isArray(card.models) ? card.models : [];
    const cur = () => ({ ...node, ...(wf.nodes[nodeId] || {}) });
    const effortsOf = (mid) => (models.find((m) => m.id === mid) || {}).efforts || [];
    const set = (patch) => { wf.nodes[nodeId] = { ...(wf.nodes[nodeId] || {}), ...patch }; handle.setNodeTunables(nodeId, patch); };
    const panel = openPopover({
      panelClass: 'ask-pop-chip', trigger: chip,
      onClose: () => chip.setAttribute('aria-expanded', 'false'),
      build: (p) => {
        p.appendChild(make('div', 'ask-pop-cap', `Model · ${node.label || nodeId}`));
        for (const m of models) {
          const item = menuItem(`ask-model-item${m.id === cur().model ? ' on' : ''}`, () => {
            const list = effortsOf(m.id);
            const keep = list.includes(cur().effort) ? cur().effort : (list[1] || list[0] || '');   // the qpanel's rule (app.js buildTunablesTable)
            set({ model: m.id, effort: keep });
            closePopover({ focusTrigger: true });
          });
          item.appendChild(make('span', 'ask-model-name', m.label || m.id));
          const cb = credentialBadge(m.id);
          if (cb) {
            const t = make('span', `ask-model-tag ${cb.missing ? 'is-err' : 'is-key'}`, cb.text);
            t.title = cb.title;
            item.appendChild(t);
          }
          if (m.id === cur().model) item.appendChild(checkMark());
          p.appendChild(item);
        }
        p.appendChild(make('div', 'ask-pop-divider'));
        const row = make('div', 'ask-pop-effort');
        row.appendChild(make('span', 'ask-pop-effort-label', 'Effort'));
        for (const e of effortsOf(cur().model)) {
          const b = menuItem(`ask-effort-pill${e === cur().effort ? ' on' : ''}`, () => { set({ effort: e }); closePopover({ focusTrigger: true }); });
          b.textContent = e;
          row.appendChild(b);
        }
        if (!cur().model) row.appendChild(make('span', 'ask-pop-effort-none', 'pick a model first'));
        p.appendChild(row);
      },
    });
    if (!panel) return;                                             // same chip toggled the open picker shut
    // Anchor under the chip (the composer's popovers are CSS-anchored; a chip lives anywhere in the transcript).
    const cr = chip.getBoundingClientRect();
    const sr = el.sheet.getBoundingClientRect();
    const width = 288;
    let left = cr.left - sr.left;
    if (left + width > el.sheet.clientWidth - 6) left = Math.max(6, el.sheet.clientWidth - width - 6);
    panel.style.left = `${Math.max(0, left)}px`;
    // Vertical: measured, then flipped/clamped — the sheet chops whatever hangs out of it.
    panel.style.top = `${chipPickerTop({
      top: cr.top - sr.top, bottom: cr.bottom - sr.top, panelH: panel.offsetHeight || 0, sheetH: el.sheet.clientHeight,
    })}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    chip.setAttribute('aria-expanded', 'true');
  }

  /** D9: the `@` popover — the thread's attachments not yet pilled; picking inserts the name at the caret
   *  (right after the `@` the user typed) and adds the pill. Closes a same-trigger popover first:
   *  openPopover toggles SHUT on the same trigger, so a second `@` would otherwise close it.
   *  Focus: openPopover (:949-950) moves focus to the first menu item — right for a click-opened menu, wrong for
   *  a picker opened by a keystroke — so the brief takes it back and keeps its caret; ArrowDown in the brief
   *  enters the list (buildCardForm), Escape (onDocKeydown :891) and a pointerdown elsewhere close it. `pos` is
   *  the `@` position at open time; the caret cannot move by typing while the picker is open (typing closes it),
   *  only by mouse/arrow keys — the name still lands right after the `@`, which is what the user meant. */
  function openAtPopover(brief, pos, local, renderPills) {
    const have = new Set((local.pills || []).map((p) => p.id));
    const list = (st.model ? st.model.attachments() : []).filter((a) => a && a.id && !have.has(a.id));
    if (st.popover && st.popover.trigger === brief) closePopover({ focusTrigger: false });
    if (!list.length) return;
    const panel = openPopover({
      panelClass: 'ask-pop-at', trigger: brief,
      build: (p) => {
        p.appendChild(make('div', 'ask-pop-cap', 'Attach to the run'));
        for (const a of list) {
          const item = menuItem('ask-at-item', () => {
            brief.setRangeText(a.name, pos, pos, 'end');
            local.pills = [...local.pills, { id: a.id, name: a.name, bytes: a.bytes || 0, kind: a.kind || 'text' }];
            renderPills();
            closePopover({ focusTrigger: true });
            brief.dispatchEvent(new win.Event('input', { bubbles: true }));   // count + autosize; the char before the caret is now a letter, so no reopen
          });
          item.textContent = a.name;
          p.appendChild(item);
        }
      },
    });
    if (!panel) return;
    const br = brief.getBoundingClientRect();
    const sr = el.sheet.getBoundingClientRect();
    panel.style.left = `${Math.max(0, br.left - sr.left + 12)}px`;
    // Same flip/clamp as the chip picker: the brief is the LAST section of the card, so under a
    // tall card the list would hang out of the overflow:hidden sheet and be chopped or invisible.
    panel.style.top = `${chipPickerTop({
      top: br.top - sr.top, bottom: br.bottom - sr.top,
      panelH: panel.offsetHeight || 0, sheetH: el.sheet.clientHeight,
    })}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    // Take the caret back from the first menu item (openPopover focused it) — the user is still typing.
    try { brief.focus(); brief.setSelectionRange(pos, pos); } catch { /* ignore */ }
  }

  function buildCardForm(block) {
    const card = block.card || {};
    const rootEl = make('div', 'ask-card ask-rp');
    const local = { target: card.target === 'workspace' ? 'workspace' : card.target === 'none' ? 'none' : 'project', options: null, lane: null, pills: [], projectDir: () => '', workflowId: () => '' };
    const summary = make('span', 'ask-rp-summary');   // footer; renderLane paints it from the loaded lane

    // head
    const head = make('header', 'ask-rp-head');
    const eyebrow = make('div', 'ask-rp-eyebrow');
    eyebrow.append(make('span', 'ask-rp-kicker', 'Run proposal'), make('span', 'ask-rp-from', 'from this chat'));
    head.appendChild(eyebrow);
    const titleRow = make('div', 'ask-rp-title');
    const titleInput = doc.createElement('input');
    titleInput.type = 'text';
    titleInput.value = card.title || '';
    titleInput.setAttribute('aria-label', 'Run title');
    titleInput.placeholder = 'Run title';
    titleRow.append(titleInput, make('span', 'ask-rp-edit', '✎ click to rename'));
    head.appendChild(titleRow);
    // Run presets (#712 slice 3): a card proposed from a preset names it; Start adds what the card has no control for.
    const presetLine = card.preset ? make('div', 'ask-card-preset muted', `From preset ${card.preset.name}`) : null;
    if (presetLine) head.appendChild(presetLine);
    // Run tags (#718), behind the experimental flag: prefilled from the proposal, sent on Start.
    // s2: suggestions follow the card's project and its target's policy dimensions (getters: both exist only later).
    const tagInput = flagOn('runTags', doc) ? createTagInput(doc, { value: card.tags || [],
      suggest: () => fetchTagVocabulary(local.projectDir() || null), dims: () => rootEl.__rp?.tagRules?.dims() || [] }) : null;
    const tagRow = tagInput ? make('div', 'ask-rp-tags') : null;
    if (tagInput) {
      tagRow.appendChild(tagInput.el);
      head.appendChild(tagRow);
    }
    if (typeof card.note === 'string' && card.note) head.appendChild(make('p', 'ask-rp-why', card.note));
    // A shaped card follows card.shape: the server puts it there only while the gate is on, and a card built before the
    // first hello (a boot on Chat) must still start its shaped run. The nudge is advisory and needs the client gate.
    const shapeUi = card.shape ? shapeCardExtras(doc, card)
      : card.nudge && shapeFirstOn() ? shapeCardExtras(doc, card) : null;
    local.shapeUi = shapeUi;
    rootEl.appendChild(head);

    // target section
    const targetSec = make('div', 'ask-rp-sec');
    const targetHead = make('div', 'ask-rp-sec-head');
    const targetSub = make('span', 'ask-rp-sec-sub');
    targetHead.append(make('span', 'ask-rp-sec-title', 'Where it runs'), targetSub);
    const seg = make('div', 'seg seg-sm ask-card-seg');
    seg.setAttribute('role', 'tablist');
    const segBtns = {};
    for (const [t, label] of [['none', 'No project'], ['project', 'Project'], ['workspace', 'Workspace']]) {
      const b = make('button', 'ask-card-seg-btn', label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('data-ask-card-seg', t);
      b.addEventListener('click', () => {
        if (local.target === t) return;
        local.target = t;
        paintSeg();
        renderTarget();
        reloadLane();
        if (!card.schedule) laterBtn.hidden = local.target === 'none';   // with a proposed time this button is Start now
      });
      segBtns[t] = b;
      seg.appendChild(b);
    }
    // Both tabs carry aria-selected from the first paint (not only the active one).
    function paintSeg() { for (const k of Object.keys(segBtns)) { segBtns[k].classList.toggle('on', k === local.target); segBtns[k].setAttribute('aria-selected', String(k === local.target)); } }
    paintSeg();
    targetHead.appendChild(seg);
    targetSec.appendChild(targetHead);
    const targetHost = make('div', 'ask-card-target');
    targetSec.appendChild(targetHost);

    const wfRow = make('div', 'ask-rp-grid wf-row');
    const workflowSel = rpSelect('ask-card-workflow', 'Workflow');
    const wfDesc = make('span', 'ask-rp-wfdesc', '');
    wfDesc.setAttribute('data-for', 'workflow');
    const wfField = rpField('Workflow', workflowSel);
    wfField.appendChild(wfDesc);
    // Engine: "Default" sends none, so /api/run resolves the user's / project's engine (the label names it once the
    // lane has read it); a proposal that names an engine preselects it. Beta engines say so.
    const engineSel = rpSelect('ask-card-engine', 'Engine');
    fillSelect(engineSel, [{ value: '', label: 'Default' }, ...ENGINE_NAMES.map((e) => ({ value: e, label: `${engineLabel(e)}${isBetaEngine(e) ? ' (Beta)' : ''}` }))], card.engine || '');
    // An engine this instance never starts (the credential broker is on) is greyed out; a proposal naming one falls back to Default.
    if (lockEngineOptions(engineSel)) engineSel.value = '';
    const engineField = rpField('Engine', engineSel);
    local.engine = () => engineSel.value;
    const guardSel = rpSelect('ask-card-guardrails', 'Guardrails');
    const guardDesc = make('span', 'ask-rp-wfdesc', 'Applies to every agent in this run');
    guardDesc.setAttribute('data-for', 'guardrails');
    const guardField = rpField('Guardrails', guardSel);
    guardField.appendChild(guardDesc);
    // Interface mode (docs/ui-levels.md). The proposal's own non-default values stay on screen at
    // any mode: a run must never start under a policy or on a branch the card did not show.
    const lvTag = (node, min, keep) => { node.dataset.minLevel = min; if (keep) node.dataset.levelKeep = '1'; return node; };
    lvTag(guardField, 'advanced', !!card.guardrailsId && card.guardrailsId !== 'permissive');
    lvTag(seg, 'advanced', card.target === 'workspace' || card.target === 'none');
    lvTag(engineField, 'advanced', !!card.engine && card.engine !== 'claude');
    wfRow.append(wfField, engineField, guardField);
    targetSec.appendChild(wfRow);
    if (shapeUi) rootEl.appendChild(shapeUi.el);
    rootEl.appendChild(targetSec);
    engineSel.addEventListener('change', () => reloadLane());   // the agent rows offer the engine's models
    workflowSel.addEventListener('change', () => {
      if (local.workflowUnavailable) { local.workflowUnavailable = false; err.textContent = ''; startBtn.disabled = false; }
      paintNeedsRepo();
      reloadLane();
    });
    if (presetLine) workflowSel.addEventListener('change', () => {
      presetLine.textContent = workflowSel.value === card.preset.workflowId ? `From preset ${card.preset.name}`
        : `From preset ${card.preset.name}: agent picks dropped (another workflow)`;
    });

    // agents lane (reloadLane → renderLane fills laneSec)
    const laneSec = make('div', 'ask-rp-sec ask-rp-lane');
    laneSec.dataset.minLevel = 'expert';
    // Ask Worca's per-agent picks apply at Start: the lane that shows them stays on screen at any mode.
    if (card.nodes && typeof card.nodes === 'object' && Object.keys(card.nodes).length) laneSec.dataset.levelKeep = '1';
    rootEl.appendChild(laneSec);

    const briefSec = make('div', 'ask-rp-sec ask-rp-brief-host');
    const briefHead = make('div', 'ask-rp-sec-head');
    briefHead.append(make('span', 'ask-rp-sec-title', 'Task brief'), make('span', 'ask-rp-sec-sub', 'what the first agent reads · Markdown ok'));
    const pillRow = make('div', 'ask-rp-pills');
    briefHead.appendChild(pillRow);
    briefSec.appendChild(briefHead);
    const brief = doc.createElement('textarea');
    brief.className = 'ask-card-brief ask-rp-brief';
    brief.value = card.brief || '';
    brief.setAttribute('aria-label', 'Task brief');
    briefSec.appendChild(brief);
    const briefFoot = make('div', 'ask-rp-brief-foot');
    const hint = make('span');
    hint.appendChild(make('kbd', null, '@'));
    hint.appendChild(doc.createTextNode(' mention an attached file'));
    const count = make('span', 'ask-rp-count');
    briefFoot.append(hint, count);
    briefSec.appendChild(briefFoot);
    if (card.source) {
      // The task IS a tracker task (propose_run source): the run reads it when it starts, so the
      // card shows the reference — never an editable copy that would silently go stale.
      briefHead.firstChild.textContent = 'Task';
      briefHead.children[1].textContent = `from ${card.source.displayName || card.source.plugin} · read when the run starts`;
      brief.hidden = true;
      briefFoot.hidden = true;
      const task = make('div', 'ask-card-task');
      task.setAttribute('data-ask-card-task', '');
      task.appendChild(make('span', 'badge grey mono', card.source.taskId));
      const name = card.source.url ? make('a', 'ask-card-task-title', card.source.title || card.source.taskId) : make('span', 'ask-card-task-title', card.source.title || '');
      if (card.source.url) { name.href = card.source.url; name.target = '_blank'; name.rel = 'noopener noreferrer'; }
      task.appendChild(name);
      if (card.source.profile) task.appendChild(make('span', 'ask-card-task-meta', `profile ${card.source.profile}`));
      briefSec.insertBefore(task, brief);
      if (card.sourceWarning) briefSec.insertBefore(make('div', 'ask-card-task-warn', card.sourceWarning), brief);
    }
    rootEl.appendChild(briefSec);
    local.pills = Array.isArray(card.attachments) ? card.attachments.filter((a) => a && a.id).map((a) => ({ ...a })) : [];
    function renderPills() {
      pillRow.replaceChildren();
      for (const p of local.pills) {
        const pill = make('span', 'ask-rp-pill', `@${p.name} `);
        const x = make('button', 'ask-rp-pill-x');
        x.type = 'button';
        x.setAttribute('aria-label', `Remove ${p.name}`);
        x.append(icon(doc, 'x', 12));
        x.addEventListener('click', () => { local.pills = local.pills.filter((q) => q.id !== p.id); renderPills(); });   // the text stays (D9)
        pill.appendChild(x);
        pillRow.appendChild(pill);
      }
    }
    const grow = () => {
      brief.style.height = 'auto';
      brief.style.height = `${Math.min((brief.scrollHeight || 0) + 2, 420)}px`;   // jsdom: scrollHeight 0 → 2px, harmless (CSS min-height wins)
      count.textContent = `${brief.value.length.toLocaleString('en-US')} chars`;
    };
    brief.addEventListener('input', () => {
      grow();
      const pos = typeof brief.selectionStart === 'number' ? brief.selectionStart : brief.value.length;
      if (brief.value[pos - 1] === '@') openAtPopover(brief, pos, local, renderPills);
      else if (st.popover && st.popover.trigger === brief) closePopover({ focusTrigger: false });   // typed past the @: the picker never filters, so it goes
    });
    // The caret stays in the brief while the picker is open (see openAtPopover); ArrowDown hands focus to the
    // list, where the popover's own keydown handler (arrows / Enter / Escape → back to the brief) takes over.
    brief.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' || !st.popover || st.popover.trigger !== brief) return;
      const first = st.popover.panel.querySelector('[role="menuitem"]');
      if (!first) return;
      e.preventDefault();
      first.tabIndex = 0;
      try { first.focus(); } catch { /* ignore */ }
    });
    renderPills();
    grow();

    // ONE feature-branch input for both targets; renderTarget moves it into the current grid.
    const feature = doc.createElement('input');
    feature.type = 'text';
    feature.className = 'ask-card-feature';
    feature.value = card.featureBranch || '';
    feature.setAttribute('aria-label', 'Feature branch');

    // Run on the source branch (branch.sameAsSource): ONE checkbox for both targets, like `feature`.
    const sameSw = makeSwitch(doc, { ariaLabel: 'Run on the source branch', checked: card.sameAsSource === true, inputClass: 'ask-card-same-source' });
    const sameSrc = sameSw.input;
    feature.disabled = sameSrc.checked;
    // updateTargetSub is a function declaration further down in this same scope (hoisted).
    sameSrc.addEventListener('change', () => { feature.disabled = sameSrc.checked; updateTargetSub(); });
    // The card header names the feature branch: never a typed name the run will ignore.
    const featureWord = () => (sameSrc.checked ? 'none (source branch)' : (feature.value.trim() || 'auto'));

    const err = make('div', 'ask-card-err');
    rootEl.appendChild(err);

    // footer
    const foot = make('footer', 'ask-rp-foot');
    const openNp = make('button', 'link-btn ask-card-open-np', '↗ Open in New run');
    openNp.type = 'button';
    openNp.setAttribute('data-ask-card-open-np', '');
    openNp.dataset.minLevel = 'advanced';
    // New pipeline's task-source pane cannot be pre-filled from here yet; a tracker task runs from the card.
    if (card.source) openNp.hidden = true;
    openNp.addEventListener('click', () => prefillFromCard(block, rootEl, local));
    const dismissBtn = make('button', 'btn btn-sm btn-quiet ask-card-not-now', 'Not now');
    dismissBtn.type = 'button';
    dismissBtn.setAttribute('data-ask-card-dismiss', '');
    dismissBtn.addEventListener('click', () => dismissCard(block, rootEl));
    const startBtn = make('button', 'btn btn-sm btn-primary');
    startBtn.type = 'button';
    startBtn.setAttribute('data-ask-card-start', '');
    const play = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');   // filled, unlike svgIcon's stroked glyphs
    play.setAttribute('viewBox', '0 0 24 24'); play.setAttribute('fill', 'currentColor'); play.setAttribute('aria-hidden', 'true');
    const playPath = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); playPath.setAttribute('d', 'M6 4l14 8-14 8V4Z');
    play.appendChild(playPath); startBtn.appendChild(play);
    startBtn.appendChild(doc.createTextNode('Start run'));
    // A proposal Ask Worca scheduled starts at its (possibly changed) time; any other starts now.
    startBtn.addEventListener('click', () => startCard(block, rootEl, local, local.schedulePick || null));
    // Schedule…: the same request, started later — once, or on a repeat (the card then follows the schedule).
    const sheetOpts = (initial = {}) => ({
      mode: 'create', allowRepeat: true, initial, runTitle: (block.card && (block.card.title || block.card.brief)) || '',
      warning: 'A scheduled run is unattended. If this workflow asks questions, the run waits for your answer. Chat notifications can reach you.',
      // Keyed off the card's LIVE target segment (local.target), not the proposal's frozen card.workspaceId —
      // the user can switch the card between project and workspace before opening the sheet.
      candidates: () => fetch(`/api/schedules/after-candidates?${local.target === 'workspace'
        ? `workspaceId=${encodeURIComponent((rootEl.querySelector('.ask-card-workspace-select') || {}).value || card.workspaceId || '')}`
        : `projectDir=${encodeURIComponent(local.projectDir())}`}`).then((r) => r.json()),
    });
    const laterBtn = make('button', 'btn btn-sm btn-quiet ask-card-not-now ask-card-later', 'Schedule…');
    laterBtn.type = 'button';
    if (card.schedule) {
      // Ask Worca proposed WHEN (propose_run when / every): scheduling is the answer, so it is the primary
      // action at every interface level (docs/ui-levels.md rule 4), and Start now is the alternative.
      local.schedulePick = scheduleFieldsOf(card.schedule);
      const line = make('div', 'ask-card-sched ask-card-sched-proposed');
      line.setAttribute('data-ask-card-sched-proposed', '');
      const badge = make('span', 'badge grey', card.schedule.kind === 'repeat' ? 'Repeats' : card.schedule.kind === 'after' ? 'After run' : 'Scheduled');
      const text = make('span', 'ask-card-sched-text', scheduleLineText(card.schedule));
      const change = make('button', 'link-btn ask-card-sched-change', 'Change…');
      change.type = 'button';
      change.setAttribute('data-ask-card-sched-change', '');
      change.addEventListener('click', async () => {
        const picked = await openScheduleSheet(sheetOpts(sheetInitialOf(local.schedulePick)));
        if (!picked) return;
        // A sheet pick that stays "after another run" keeps a sourceFromPrevious the proposal carried.
        local.schedulePick = { ...picked, ...(local.schedulePick && local.schedulePick.sourceFromPrevious && picked.after ? { sourceFromPrevious: true } : {}) };
        badge.textContent = picked.repeat ? 'Repeats' : picked.after ? 'After run' : 'Scheduled';
        text.textContent = pickedLineText(local.schedulePick);
      });
      line.append(badge, text, change);
      rootEl.insertBefore(line, err);
      play.replaceWith(svgIcon(CLOCK_ICO, 13, 2.2));
      startBtn.lastChild.textContent = 'Schedule';
      startBtn.setAttribute('data-ask-card-schedule-go', '');
      laterBtn.textContent = 'Start now';
      laterBtn.title = 'Start this run now instead';
      laterBtn.setAttribute('data-ask-card-start-now', '');
      laterBtn.addEventListener('click', () => startCard(block, rootEl, local));
    } else {
      laterBtn.setAttribute('data-ask-card-schedule', '');
      laterBtn.hidden = local.target === 'none';
      laterBtn.title = 'Start this run later';
      laterBtn.dataset.minLevel = 'advanced';
      laterBtn.addEventListener('click', async () => {
        const picked = await openScheduleSheet(sheetOpts());
        if (picked) startCard(block, rootEl, local, picked);
      });
    }
    // Shape it first: Start holds an icon and a text node, so only the text node is relabelled.
    let shapeBtn = null;
    if (shapeUi) {
      const setLabel = (b, t) => { const n = [...b.childNodes].find((x) => x.nodeType === 3); if (n) n.textContent = t; else b.append(t); };
      if (card.shape) {
        setLabel(startBtn, 'Start planning');            // a shaped card is never scheduled
      } else {
        shapeBtn = make('button', 'btn btn-sm', 'Shaper');
        shapeBtn.type = 'button';
        shapeBtn.dataset.askCardShape = '';
        shapeBtn.addEventListener('click', () => startCard(block, rootEl, local, null, { shaped: true }));
        setLabel(startBtn, 'Run as is');                 // D32: the choice card's own words, never "anyway"
      }
    }
    foot.append(openNp, summary, dismissBtn, laterBtn, ...(shapeBtn ? [shapeBtn] : []), startBtn);
    rootEl.appendChild(foot);

    // Shaper (D20, mock board 13): a shaped card shows the title, the brief clamped, Project, Base branch,
    // Perspectives and what happens; every other field MOVES, unchanged, into a collapsed Advanced. Moves only: each
    // control keeps its class, so collectCardBody / startCard read the same values and the request is unchanged.
    let paintAdvanced = () => {};
    if (card.shape && shapeUi) {
      const kicker = eyebrow.querySelector('.ask-rp-kicker');
      kicker.textContent = 'Shaper';
      kicker.classList.add('ask-rp-kicker-shape');
      const main = make('div', 'ask-rp-sec ask-rp-shape-main');
      const preview = make('div', 'ask-rp-brief-preview',
        card.source ? (card.source.title || card.source.taskId || '') : brief.value);
      const more = make('button', 'link-btn ask-rp-brief-more', 'Show brief');
      more.type = 'button';
      more.setAttribute('data-ask-card-brief-more', '');
      briefSec.hidden = true;
      more.addEventListener('click', () => { preview.hidden = true; more.hidden = true; briefSec.hidden = false; grow(); });
      const what = make('div', 'ask-rp-shape-what');
      what.append(make('span', 'ask-rp-label', 'What happens'), make('span', null, shapeWhatHappens(card.shape)));
      main.append(preview, more, briefSec, targetHost, rpField('Perspectives', shapeUi.el), what);
      const adv = doc.createElement('details');
      adv.className = 'ask-rp-adv disclosure';
      adv.setAttribute('data-ask-card-advanced', '');
      const advSum = make('summary', 'ask-rp-adv-sum', 'Advanced');
      adv.appendChild(advSum);
      const why = head.querySelector('.ask-rp-why');
      if (why) adv.appendChild(why);
      // renderTarget fills this with Feature branch + Run on the source branch on a project target (it rebuilds on every call).
      local.shapeBranchHost = make('div', 'ask-rp-grid two ask-rp-adv-branch');
      targetSec.insertBefore(local.shapeBranchHost, wfRow);
      const sched = make('div', 'ask-rp-adv-sched');
      sched.appendChild(laterBtn);
      adv.append(targetSec, laneSec, sched);
      rootEl.insertBefore(main, err);
      rootEl.insertBefore(adv, err);
      openNp.classList.add('link-btn');
      delete openNp.dataset.minLevel;                       // one of the small card's own controls (D20)
      foot.replaceChildren(openNp, dismissBtn, startBtn);   // the Advanced summary stands in for the lane summary
      let advLane = null;
      paintAdvanced = (lane = advLane) => {
        advLane = lane;
        const g = guardSel.selectedOptions[0];
        advSum.textContent = shapeAdvancedSummary({
          engine: engineLabel(engineSel.value || (lane && lane.defaultEngine) || ''),
          guardrails: g ? g.textContent : '',
          agents: lane ? lane.rows.length : 0,
          overrides: lane ? laneOverrideCount(lane) : 0,
        });
      };
      guardSel.addEventListener('change', () => paintAdvanced());
      engineSel.addEventListener('change', () => paintAdvanced());   // the lane reload repaints again once loaded
      paintAdvanced(null);
    }

    local.projectDir = () => (local.target === 'project' ? ((rootEl.querySelector('.ask-card-project-select') || {}).value || '') : '');
    local.workflowId = () => workflowSel.value || card.workflowId || 'wf_default';

    /** The loaded /api/projects row behind a project select value (SEAMS S12), else null. */
    function projectRowOf(value) {
      const opts = local.options;
      return (opts && value && opts.projects.find((p) => p && p.path === value)) || null;
    }
    /** S12: a Folder project has no branches, and a Git project runs as Folder while git is missing (U3). */
    function noBranches(value) { return projectKind(projectRowOf(value)) === 'folder' || !gitOn(doc); }
    function updateTargetSub() {
      const opts = local.options;
      if (local.target === 'none') targetSub.textContent = NO_PROJECT_NAME;
      else if (local.target === 'project') {
        const projSel = rootEl.querySelector('.ask-card-project-select');
        const srcSel = rootEl.querySelector('.ask-card-source');
        const name = projSel && projSel.selectedOptions[0] ? projSel.selectedOptions[0].textContent : (card.projectName || '');
        // B10 (canvas Switched): the name, the kind chip, then the branch words (none for a Folder project or without git).
        const chip = kindChip(doc, projectKind(projectRowOf(projSel ? projSel.value : '')));
        const parts = [doc.createTextNode(name)];
        if (chip) parts.push(chip);
        if (!noBranches(projSel ? projSel.value : '')) parts.push(doc.createTextNode(` · branch ${(srcSel && srcSel.value) || 'current'} · feature ${featureWord()}`));
        targetSub.replaceChildren(...parts);
      } else {
        const wsSel = rootEl.querySelector('.ask-card-workspace-select');
        const row = opts && wsSel && opts.workspaces.find((w) => w && w.id === wsSel.value);
        const n = row && Array.isArray(row.projectKeys) ? row.projectKeys.length : (Array.isArray(card.members) ? card.members.length : 0);
        targetSub.textContent = `${(row && row.name) || card.workspaceName || 'workspace'} · ${n} member${n === 1 ? '' : 's'} · feature ${featureWord()}`;
      }
      // Every target change lands here (renderTarget rebuilds the selects, so outside listeners are lost).
      rootEl.__rp?.refreshTagRules?.();
    }
    feature.addEventListener('input', updateTargetSub);

    function paintNeedsRepo() {
      targetHost.querySelector('.ask-card-needs-repo')?.remove();
      const row = local.options && local.options.workflows.find((w) => w && w.id === workflowSel.value);
      if (local.target === 'none' && row && row.needsRepo) targetHost.appendChild(make('p', 'ask-card-needs-repo', NEEDS_REPO_NOTE));
    }
    function renderTarget() {
      targetHost.replaceChildren();
      const opts = local.options;
      const grid = make('div', 'ask-rp-grid');
      if (local.target === 'none') {
        if (local.shapeBranchHost) local.shapeBranchHost.replaceChildren();
        paintNeedsRepo();
        updateTargetSub();
        return;
      }
      if (local.target === 'project') {
        const projSel = rpSelect('ask-card-project-select', 'Project');
        const srcSel = rpSelect('ask-card-source', 'Source branch');
        // #527: "from origin/x (remote only, 2 behind)" describes the PROPOSED branch only.
        const srcField = rpField('Source branch', srcSel, sourceRefNote(card.sourceRef));
        const srcHint = srcField.querySelector('.ask-rp-hint');
        srcSel.addEventListener('change', () => {
          if (srcHint && srcSel.value !== card.sourceBranch) srcHint.textContent = '';
          updateTargetSub();
        });
        const featureField = lvTag(rpField('Feature branch', feature, 'created for the run'), 'advanced', !!card.featureBranch);
        const sameField = lvTag(rpField('Run on the source branch', sameSw.row, 'commits onto the source branch'), 'advanced', !!card.sameAsSource);
        for (const f of [srcField, featureField, sameField]) f.dataset.needsGit = '';
        // S12: a Folder project, or no git, shows no branch rows and asks for no branches. The fill is async: the
        // sub-line reads the select again when the branches land, or a proposed sourceBranch would read "branch current".
        const paintBranches = (want) => {
          const off = noBranches(projSel.value);
          for (const f of [srcField, featureField, sameField]) f.hidden = off;
          if (!off) loadBranchesInto(srcSel, projSel.value, want).then(updateTargetSub); else updateTargetSub();
        };
        if (opts) {
          fillSelect(projSel, opts.projects.map((p) => ({ value: p.path, label: p.exists === false ? `${p.name} (missing)` : p.name })), card.projectDir || (opts.projects[0] && opts.projects[0].path) || '');
          paintBranches(card.sourceBranch || '');
        }
        projSel.addEventListener('change', () => { paintBranches(''); updateTargetSub(); reloadLane(); });
        if (local.shapeBranchHost) {
          // Shaper (D20): Project and Base branch on the small card, at every level; the rest in Advanced.
          srcField.querySelector('.ask-rp-label').firstChild.textContent = 'Base branch';
          grid.classList.add('two');
          grid.append(rpField('Project', projSel), srcField);
          local.shapeBranchHost.replaceChildren(featureField, sameField);
        } else {
          grid.append(rpField('Project', projSel), lvTag(srcField, 'advanced', !!card.sourceBranch), featureField, sameField);
        }
        targetHost.appendChild(grid);
        updateTargetSub();
        return;
      }
      if (local.shapeBranchHost) local.shapeBranchHost.replaceChildren();
      const wsSel = rpSelect('ask-card-workspace-select', 'Workspace');
      const members = make('div', 'ask-card-members');
      const srcInput = doc.createElement('input');
      srcInput.type = 'text';
      srcInput.className = 'ask-card-source-input';
      srcInput.placeholder = 'auto';
      srcInput.value = card.sourceBranch || '';
      srcInput.setAttribute('aria-label', 'Source branch default');
      const details = doc.createElement('details');
      details.className = 'ask-card-members-src disclosure';   // .disclosure swaps the OS triangle for the app's chevron
      details.appendChild(make('summary', null, 'Per-member source branches'));
      const memberHost = make('div', 'ask-card-members-src-list');
      details.appendChild(memberHost);
      const renderMembers = () => {
        members.replaceChildren();
        memberHost.replaceChildren();
        const row = opts && opts.workspaces.find((w) => w && w.id === wsSel.value);
        // P5: a Folder member (live list vcs 'none', else the card's workMode 'folder') has no branch to pick.
        const list = row && Array.isArray(row.projectKeys)
          ? row.projectKeys.map((k, i) => ({ projectKey: k, name: wsBasename(row.projectPaths && row.projectPaths[i]), folder: Array.isArray(row.vcs) && row.vcs[i] === 'none' }))
          : Array.isArray(card.members) ? card.members.map((m) => ({ projectKey: m.projectKey, name: m.projectName, folder: m.workMode === 'folder' })) : [];
        members.textContent = list.map((m) => m.name).join(', ');
        for (const m of list) {
          if (m.folder) continue;   // listed above, but no per-member source input: never in sourceBranchByKey
          const inp = doc.createElement('input');
          inp.type = 'text';
          inp.className = 'ask-card-member-src';
          inp.placeholder = 'auto';
          inp.setAttribute('data-project-key', m.projectKey);
          if (card.sourceBranchByKey && card.sourceBranchByKey[m.projectKey]) inp.value = card.sourceBranchByKey[m.projectKey];
          memberHost.appendChild(rpField(m.name, inp));
        }
        details.hidden = list.length > 0 && !memberHost.childElementCount;   // every member a Folder project: nothing to pick
        for (const f of wsGitFields) f.hidden = list.length > 0 && list.every((m) => m.folder);   // ...and no branch to start from, name or commit onto
        updateTargetSub();
      };
      wsSel.addEventListener('change', renderMembers);
      const wsField = rpField('Workspace', wsSel);
      wsField.appendChild(members);
      const wsGitFields = [lvTag(rpField('Source branch', srcInput, 'default for members'), 'advanced', !!card.sourceBranch),
        lvTag(rpField('Feature branch', feature), 'advanced', !!card.featureBranch),
        lvTag(rpField('Run on the source branch', sameSw.row, 'commits onto the source branch'), 'advanced', !!card.sameAsSource)];
      for (const f of [...wsGitFields, details]) f.dataset.needsGit = '';
      grid.append(wsField, ...wsGitFields);
      targetHost.appendChild(grid);      // attach BEFORE filling: renderMembers → updateTargetSub finds the select through rootEl
      targetHost.appendChild(details);
      if (opts) {
        fillSelect(wsSel, opts.workspaces.map((w) => ({ value: w.id, label: w.name || w.id })), card.workspaceId || (opts.workspaces[0] && opts.workspaces[0].id) || '');
        renderMembers();
      }
      updateTargetSub();
    }

    // A reload (workflow / project / target change) rebuilds the lane from scratch:
    // `edits` are per workflow-and-project and are DISCARDED, silently.
    // `saveDefaults`: the card's "Save as project defaults" switch (off by default), kept across lane reloads.
    const laneCtx = { summary, workflowId: () => local.workflowId(), projectDir: () => local.projectDir(),
      saveDefaults: () => !!local.saveDefaults, setSaveDefaults: (v) => { local.saveDefaults = !!v; },
      onPaint: (lane) => paintAdvanced(lane) };
    let laneSeq = 0;
    function reloadLane() {
      const seq = ++laneSeq;
      const workflowId = local.workflowId();
      const projectDir = local.projectDir();
      local.lane = null;
      if (workflowId === 'wf_auto') {
        // No graph yet: the run classifies its task and picks the agents when it starts.
        renderLane(laneSec, null, laneCtx, 'Auto picks the agents when the run starts.');
        wfDesc.textContent = '';
        return;
      }
      renderLane(laneSec, null, laneCtx, 'Loading agent settings…');
      // Kept so a Start during the load waits for it (startCard): the loaded lane heals Ask Worca's picks to the engine.
      local.lanePending = loadLane(workflowId, projectDir, local.engine()).then((lane) => {
        if (st.destroyed || seq !== laneSeq) return;            // a later reload won
        local.lane = lane;
        // A workspace run fans out every workspaceFanOut agent (fanForced): the lane locks that switch there.
        if (lane) lane.workspace = local.target === 'workspace';
        // Ask Worca's per-agent picks are for the workflow it proposed: laid in again on every reload of it (another
        // engine heals them away, another project keeps them over its own settings); any other workflow starts clean.
        if (lane && workflowId === card.workflowId) {
          applyProposal(lane, card.nodes);
          // The team-policy word was checked for the proposed target's policy: another project or target has its own.
          const proposedTarget = local.target === (card.target === 'workspace' ? 'workspace' : 'project') && projectDir === (card.projectDir || '');
          lane.warnings = proposedTarget && Array.isArray(card.warnings) ? card.warnings.filter((w) => typeof w === 'string') : [];
        }
        if (lane) {
          engineSel.options[0].textContent = `${engineLabel(lane.defaultEngine)} (default)`;
          for (const o of engineSel.options) o.hidden = o.value !== '' && o.value === lane.defaultEngine && engineSel.value !== o.value;   // listed once
        }
        wfDesc.textContent = lane ? workflowDesc(lane.wf, lane.registry, lane.runConfig) : '';
        renderLane(laneSec, lane, laneCtx);
        // A lane that could not load: a Start sends Ask Worca's picks as proposed (proposalOverlay), so it shows at every
        // mode and names them (the rows that would show them are gone). Without picks for this workflow nothing on it
        // applies at Start: Expert-only again (renderLane(null) leaves the mark as it was).
        const unseen = lane ? null : proposalOverlay(card, workflowId);
        if (unseen) {
          laneSec.dataset.levelKeep = '1';
          const list = Object.entries(unseen.nodes).map(([id, p]) => `${id} → ${p.model}${p.effort ? ` · ${p.effort}` : ''}${p.subagentModel ? ` · sub-agents ${p.subagentModel}` : ''}`);
          laneSec.appendChild(make('div', 'ask-rp-lane-msg', `Start runs Chat's picks as proposed (checked again at Start): ${list.join(', ')}`));
        } else if (!lane) delete laneSec.dataset.levelKeep;
      });
    }
    local.reloadLane = reloadLane;   // after a successful save the lane re-reads the persisted config
    renderLane(laneSec, null, laneCtx, 'Loading agent settings…');   // until the option lists arrive

    // Fail loudly, never substitute: the proposed id is in no list, so the select shows
    // nothing, the error says which id is missing and Start stays inert until the user
    // picks a row (the change handler above lifts all three). local.workflowId() keeps
    // reporting the proposed id meanwhile, so the lane shows its unusable state instead
    // of another workflow's agents.
    function markWorkflowUnavailable() {
      workflowSel.selectedIndex = -1;
      err.textContent = `Workflow ${card.workflowId} is not available: pick one`;
      startBtn.disabled = true;
      local.workflowUnavailable = true;
    }

    renderTarget();
    loadCardOptions({ fresh: true }).then((opts) => {
      if (st.destroyed) return;
      local.options = opts;
      if (card.shape && local.shapeUi) {
        // Shape it first (D9): the workflow is fixed; the server re-derives wf_shape / wf_shape_ux from the chips at start.
        fillSelect(workflowSel, [{ value: card.workflowId, label: card.workflowName || 'Shaper' }], card.workflowId);
        workflowSel.disabled = true;
      } else {
        // Auto is not a saved workflow: listed only when Ask Worca proposed it (a plain card keeps its list).
        const autoOpt = card.workflowId === 'wf_auto' ? [{ value: 'wf_auto', label: 'Auto: picks the workflow when the run starts' }] : [];
        fillSelect(workflowSel, [...autoOpt, ...opts.workflows.map((w) => ({ value: w.id, label: workflowPickerLabel(w, null) || w.name || w.id }))], card.workflowId || 'wf_default');
        if (card.workflowId && workflowSel.value !== card.workflowId) markWorkflowUnavailable();
      }
      fillSelect(guardSel, opts.guardrails.map((g) => ({ value: g.id, label: g.id === 'permissive' ? 'Permissive' : (g.name || g.id) })), card.guardrailsId || 'normal');
      renderTarget();
      reloadLane();
    });
    rootEl.__rp = { local, wfDesc, summary, laneSec, briefSec, brief, titleInput, tagInput, lane: () => local.lane };   // consumed by later tasks + tests
    // Enforced run tags (slice 4A): the target's rules pre-fill the chips and, when enforced, gate Start
    // with an inline picker per missing mandatory tag. The server gate still answers a stale rule set (422).
    if (tagInput) {
      const line = createTagRulesLine(doc, tagInput);
      tagRow.appendChild(line.el);
      rootEl.__rp.tagRules = line;
      const sync = () => { const why = line.blocked(); startBtn.disabled = !!why; startBtn.title = why || ''; };
      line.onChange(sync);
      let gen = 0;
      let lastQ = null;
      const refreshTagRules = () => {
        const wsId = local.target === 'workspace' ? ((rootEl.querySelector('.ask-card-workspace-select') || {}).value || card.workspaceId || '') : '';
        const dir = wsId ? '' : local.projectDir();
        const q = wsId ? `workspaceId=${encodeURIComponent(wsId)}` : dir ? `projectDir=${encodeURIComponent(dir)}` : '';
        if (q === lastQ) return;            // updateTargetSub also runs on branch/feature edits: same target, no fetch
        lastQ = q;
        const mine = ++gen;
        if (!q) { line.update(null); return; }
        fetch(`/api/tag-dimensions?${q}`).then((r) => (r.ok ? r.json() : null))
          .then((info) => { if (mine === gen && !st.destroyed) line.update(info && Array.isArray(info.dims) ? info : null); })
          .catch(() => {});
      };
      rootEl.__rp.refreshTagRules = refreshTagRules;
      refreshTagRules();
    }
    return rootEl;
  }

  function collectCardBody(rootEl, local, card) {
    const body = {
      prompt: rootEl.querySelector('.ask-card-brief').value,
      workflowId: rootEl.querySelector('.ask-card-workflow').value,
      guardrailsId: rootEl.querySelector('.ask-card-guardrails').value, // ALWAYS sent (spec §9.4)
      title: ((rootEl.querySelector('.ask-rp-title input') || {}).value || '').trim() || card.title || undefined,
      mock: false,
    };
    // Agent memory (§7.3 / B17): the card's scope rides along only while its workflow is still the
    // defragment one — a user who switched the picker to another workflow gets a legacy body.
    if (card.memoryScope && body.workflowId === 'wf_memory_defrag') body.memoryScope = card.memoryScope;
    const tags = rootEl.__rp?.tagInput ? rootEl.__rp.tagInput.get() : [];
    if (tags.length) body.tags = tags;                      // none: a legacy body, byte for byte
    const engine = (rootEl.querySelector('.ask-card-engine') || {}).value;
    if (engine) body.engine = engine;                       // none: /api/run's default engine
    // A tracker task: the reference, never a prompt (POST /api/run takes source OR prompt).
    if (card.source) {
      delete body.prompt;
      body.source = {
        type: 'plugin', plugin: card.source.plugin, sourceId: card.source.sourceId, taskId: card.source.taskId,
        ...(card.source.profile ? { profile: card.source.profile } : {}), ...(card.source.inputs ? { inputs: card.source.inputs } : {}),
      };
    }
    if (local.target === 'none') { body.noProject = true; return body; }
    const feature = rootEl.querySelector('.ask-card-feature').value.trim();
    const same = rootEl.querySelector('.ask-card-same-source');
    if (same && same.checked) body.sameAsSource = true;   // the run auto-names its hidden branch
    else if (feature) {
      body.featureBranch = feature;
      // Smart run naming: the card's own derived name, still untouched, is a suggestion (kept unique at start).
      if (card.featureBranchDerived === true && feature === card.featureBranch) body.featureBranchSuggested = true;
    }
    if (local.target === 'workspace') {
      body.workspaceId = rootEl.querySelector('.ask-card-workspace-select').value;
      const src = rootEl.querySelector('.ask-card-source-input');
      if (src && src.value.trim()) body.sourceBranch = src.value.trim();
      const byKey = {};
      for (const inp of rootEl.querySelectorAll('.ask-card-member-src')) {
        const k = inp.getAttribute('data-project-key');
        const v = inp.value.trim();
        if (k && v) byKey[k] = v;
      }
      if (Object.keys(byKey).length) body.sourceBranchByKey = byKey;
    } else {
      body.projectDir = rootEl.querySelector('.ask-card-project-select').value;
      const src = rootEl.querySelector('.ask-card-source');
      if (src && src.value) body.sourceBranch = src.value;
    }
    return body;
  }

  /** Freeze the controls Start's two awaits straddle. A workflow or target change mid-flight
   *  repoints the lane (reloadLane nulls local.lane) while saveLaneEdits still holds the old
   *  one, so the config written and the body posted would describe different runs. */
  function freezeTargetInputs(rootEl, on) {
    for (const sel of ['.ask-card-workflow', '.ask-card-engine', '.ask-card-project-select', '.ask-card-workspace-select', '[data-ask-card-seg]']) {
      for (const node of rootEl.querySelectorAll(sel)) node.disabled = on;
    }
  }

  async function startCard(block, rootEl, local, schedule = null, { shaped = false } = {}) {
    const err = rootEl.querySelector('.ask-card-err');
    const startBtn = rootEl.querySelector('[data-ask-card-start]');
    err.textContent = '';
    startBtn.disabled = true;
    const shapeBtn = rootEl.querySelector('[data-ask-card-shape]');
    if (shapeBtn) shapeBtn.disabled = true;               // a double click must not post /api/run twice
    freezeTargetInputs(rootEl, true);
    try {
      // D3: read-only, so it runs BEFORE saveLaneEdits — a refusal here must not leave the config already written.
      const ex = await collectCardExtras(local);
      if (ex.error) { err.textContent = ex.error; return; }
      // The lane's agent picks: with "Save as project defaults" on they become the project's settings first (D1,
      // saveLaneEdits); otherwise they ride THIS run's body as `overlay` and nothing is written (run-overlay.mjs). A lane
      // still loading (an engine or workflow switch a moment ago) is waited for: it heals the picks to the run's engine
      // (the target inputs are frozen, so no newer reload starts meanwhile). One that could not load sends Ask Worca's
      // picks as proposed — POST /api/run checks them — so they are never dropped without a word.
      let overlay = null;
      if (!local.lane && local.lanePending) {
        try { await local.lanePending; } catch { /* it could not load: the picks ride as proposed */ }
        if (st.destroyed) return;
      }
      if (!local.lane) overlay = proposalOverlay(block.card || {}, local.workflowId());
      else if (local.saveDefaults && local.projectDir()) {
        const saveErr = await saveLaneEdits(local);            // the previous phase's guard, now second
        if (saveErr) { err.textContent = saveErr; return; }
      } else {
        const ov = laneOverlay(local.lane);
        if (ov.error) { err.textContent = ov.error; return; }
        if (Object.keys(ov.nodes).length) overlay = { nodes: ov.nodes };
      }
      const body = { ...collectCardBody(rootEl, local, block.card || {}), askThreadId: st.threadId, askCardId: block.id, ...(schedule || {}) };
      if (local.shapeUi && (shaped || (block.card || {}).shape)) Object.assign(body, local.shapeUi.body());
      if (overlay) body.overlay = overlay;
      // Run chains: "the branch of the run before it" is a flag, and the wire refuses it next to a branch name.
      // Keyed off the schedule being POSTED — a Start now on an after-proposal carries none and keeps the picked branch.
      if (body.sourceFromPrevious) { delete body.sourceBranch; delete body.sourceBranchByKey; }
      if (ex.extras.length) body.extras = ex.extras;
      if (block.card && block.card.preset) applyPresetStart(body, block.card.preset);
      let res = null;
      try {
        res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } catch { err.textContent = 'network error'; return; }
      if (!res.ok) {
        let b = null;
        try { b = await res.json(); } catch { /* keep */ }
        // #527: the base diverged or could not be fetched — ask once and resend with the choice.
        // No syncBeforeStart: the project's own setting applies.
        if (b && (b.code === 'sync-diverged' || b.code === 'sync-fetch-failed')) {
          const choice = await chooseSyncRefusal(b);
          if (!choice) { err.textContent = 'Start cancelled.'; return; }
          try {
            res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, syncPolicy: choice }) });
          } catch { err.textContent = 'network error'; return; }
          b = null;
          if (!res.ok) { try { b = await res.json(); } catch { /* keep */ } }
        }
        if (!res.ok) {
          err.textContent = (b && b.error) || `request failed (${res.status})`;
          return;
        }
      }
      // Success: the server links, flips the card to started and broadcasts;
      // the flip frame renders the terminal state. The browser never navigates
      // (beginRun is NEVER called — spec §10.5).
    } finally {
      const tagBlocked = !!rootEl.__rp?.tagRules?.blocked();   // an enforced tag still missing keeps Start off
      startBtn.disabled = tagBlocked;
      if (shapeBtn) shapeBtn.disabled = tagBlocked;            // Shaper starts a run too: the same tag rule
      freezeTargetInputs(rootEl, false);
      // freezeTargetInputs re-enabled the select; a shaped card's workflow is fixed.
      if ((block.card || {}).shape && local.shapeUi) rootEl.querySelector('.ask-card-workflow').disabled = true;
    }
  }

  /** POST the card endpoint; the flip FRAME renders the next state (never a local flip). Returns the body or null. */
  async function postCard(block, rootEl, body, btn = null) {
    const err = rootEl.querySelector('.ask-card-err');
    if (err) err.textContent = '';
    // `posting` marks OUR disable so the per-flush run-button sync leaves it alone.
    if (btn) { btn.disabled = true; btn.dataset.posting = '1'; }
    const release = () => { if (btn) { btn.disabled = false; delete btn.dataset.posting; } };
    let res = null;
    try {
      res = await fetch(`/api/ask/threads/${st.threadId}/cards/${block.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch { if (err) err.textContent = 'network error'; release(); return null; }
    if (!res.ok) {
      let msg = `request failed (${res.status})`;
      try { const b = await res.json(); if (b && b.error) msg = b.error; } catch { /* keep */ }
      // One turn per thread: the route refuses every card verb that starts one while a
      // reply streams. Say what to do instead of echoing the wire's `turn in flight`.
      if (res.status === 409 && msg === 'turn in flight') msg = 'Chat is still replying. Try again once the answer lands.';
      if (err) err.textContent = msg;
      release();
      return null;
    }
    let out = null;
    try { out = await res.json(); } catch { out = null; }
    // v6: re-enable on success for EVERY verb. For save/decline the flip frame replaces this element within milliseconds anyway;
    // a click landing in that window is answered 409 by the route's state check (+ askCardBusy) — harmless.
    release();
    // A failed event turn ALSO posts a system notice row (the server's failedEventTurn):
    // for save/decline the flip has already rebuilt this element, so the row is the only
    // message that survives. This line is what the run verb — which never flips — shows.
    if (out && out.turn && out.turn.error && err) err.textContent = `Chat could not reply: ${out.turn.error}`;
    return out;
  }
  function dismissCard(block, rootEl) { return postCard(block, rootEl, { state: 'dismissed' }); }

  function prefillFromCard(block, rootEl, local) {
    const card = block.card || {};
    const p = {
      target: local.target,
      workflowId: rootEl.querySelector('.ask-card-workflow').value,
      guardrailsId: rootEl.querySelector('.ask-card-guardrails').value,
      prompt: rootEl.querySelector('.ask-card-brief').value,
      title: ((rootEl.querySelector('.ask-rp-title input') || {}).value || '').trim() || card.title || '',
      featureBranch: local.target === 'none' ? '' : rootEl.querySelector('.ask-card-feature').value.trim(),
      // The picker has no way to re-derive this: a `project` proposal opened in New Pipeline would
      // otherwise start with the row's default `global` and restructure the wrong scope (B17).
      memoryScope: card.memoryScope || null,
      engine: (rootEl.querySelector('.ask-card-engine') || {}).value || null,
    };
    if ((rootEl.querySelector('.ask-card-same-source') || {}).checked) p.sameAsSource = true;
    const tags = rootEl.__rp?.tagInput ? rootEl.__rp.tagInput.get() : (card.tags || []);
    if (tags.length) p.tags = tags;
    if (local.target === 'workspace') {
      p.workspaceId = rootEl.querySelector('.ask-card-workspace-select').value;
      const src = rootEl.querySelector('.ask-card-source-input');
      p.sourceBranch = src ? src.value.trim() : '';
      const byKey = {};
      for (const inp of rootEl.querySelectorAll('.ask-card-member-src')) {
        const k = inp.getAttribute('data-project-key');
        const v = inp.value.trim();
        if (k && v) byKey[k] = v;
      }
      if (Object.keys(byKey).length) p.sourceBranchByKey = byKey;
    } else if (local.target === 'project') {
      p.projectDir = rootEl.querySelector('.ask-card-project-select').value;
      const src = rootEl.querySelector('.ask-card-source');
      p.sourceBranch = src ? src.value : '';
    }
    // Nothing to save or fetch → hand over synchronously (the caller may not await).
    // Ask Worca's picks count as well, edits or not: New run cannot carry them (picksPending).
    const pending = cardPending(local) || picksPending(local, card);
    if (!pending) { openNewPipeline(p); return; }
    const err = rootEl.querySelector('.ask-card-err');
    if (err) err.textContent = '';
    // Same guard Start has: without it two quick clicks run two extras fetches, two save
    // rounds and two handovers. Released on every exit of the continuation.
    const openNp = rootEl.querySelector('[data-ask-card-open-np]');
    if (openNp) openNp.disabled = true;
    collectCardExtras(local).then(async (ex) => {
      if (st.destroyed) return;
      if (ex.error) { if (err) err.textContent = ex.error; return; }
      // A lane still loading is waited for, as Start does: "Save as project defaults" saves the loaded lane. One that
      // could not load has nothing to save, so the picks would stay behind even with the switch on.
      if (!local.lane && local.lanePending) {
        try { await local.lanePending; } catch { /* asks below */ }
        if (st.destroyed) return;
      }
      const saving = !!(local.saveDefaults && local.projectDir() && local.lane);
      // New run has no per-run agent picks: without "Save as project defaults" the lane's picks stay on this card.
      if ((lanePending(local) || picksPending(local, card)) && !saving) {
        const ok = typeof confirm !== 'function' || await confirm({
          title: 'Open New run without the agent picks?',
          message: local.projectDir() && local.saveDefaults
            ? 'New run starts from the project\'s saved agent settings, and this card\'s agent settings could not load to be saved, so the models picked on this card do not come along. Start the run from the card to use them.'
            : local.projectDir()
            ? 'New run starts from the project\'s saved agent settings, so the models picked on this card do not come along. Start the run from the card to use them, or turn on "Save as project defaults" first.'
            : 'New run starts from each project\'s saved agent settings, so the models picked on this card do not come along. Start the run from the card to use them.',
          confirmLabel: 'Open New run',
        });
        if (st.destroyed || !ok) return;
        if (ex.extras.length) p.extras = ex.extras;
        openNewPipeline(p);
        return;
      }
      const saveErr = await saveLaneEdits(local);
      if (st.destroyed) return;
      if (saveErr) { if (err) err.textContent = saveErr; return; }
      if (ex.extras.length) p.extras = ex.extras;
      if (typeof local.reloadLane === 'function') local.reloadLane();   // the card stays proposed: show the persisted state, not stale edits
      openNewPipeline(p);
    }).finally(() => { if (openNp) openNp.disabled = false; });
  }

  // ---- card cache: ONE element per card id, rebuilt only on a STATE change (V7 for run cards; every state for
  // workflow cards AND run progress cards, whose graph mount + ResizeObserver must not be re-created on each
  // streaming re-render, PD15 / D10).
  /** A block that renders as the live run progress card: a track_run card, or a run proposal the user started.
   *  A `failed` proposal WITH a runId is a run that errored after launch — still the card; without one it is a
   *  rejected proposal and stays the stub. */
  // ---- extension cards (worca Chat CONTRACT §2, ui/public/chat/extensions.mjs) --------------------------------
  /** Call a chatDeps member at CALL time: app.js passes one mutable object and later plans reassign its members
   *  (P4 openRunPanel, P5 openArtifact, P2 openShipIt), so a card built before a swap reaches the new function. */
  function chatDep(name, ...args) {
    const fn = chatDeps && typeof chatDeps[name] === 'function' ? chatDeps[name] : null;
    return fn ? fn(...args) : undefined;
  }
  /** ctx.postCard: POST the card route; resolves with the parsed body, throws an Error with .status and .body on a
   *  refusal (status 0 and body null when there is no chat or the network failed). */
  async function postCardJson(block, body) {
    const id = st.threadId;
    if (!id || !block || !block.id) {
      const e = new Error('no chat to post to');
      e.status = 0;
      e.body = null;
      throw e;
    }
    let res = null;
    try {
      res = await fetch(`/api/ask/threads/${id}/cards/${block.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    } catch {
      const e = new Error('network error');          // the built-in cards' word for it, never the browser's TypeError
      e.status = 0;
      e.body = null;
      throw e;
    }
    let out = null;
    try { out = await res.json(); } catch { out = null; }
    if (!res.ok) {
      const e = new Error((out && out.error) || `request failed (${res.status})`);
      e.status = res.status;
      e.body = out;
      throw e;
    }
    return out;
  }
  /** Shaper s5: ctx.postChanges — "Ask for changes" from a finished card (`ref` = {pipelineId} or {featureId}). The
   *  server mints the changes card; it arrives through the thread's ask-message frame. Throws {status, body} when refused. */
  async function postChangesJson(ref, text) {
    const id = st.threadId;
    const fail = (status, body, msg) => { const e = new Error(msg); e.status = status; e.body = body; return e; };
    if (!id) throw fail(0, null, 'no chat to post to');
    let res = null;
    try {
      res = await fetch(`/api/ask/threads/${id}/changes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(ref || {}), text }) });
    } catch { throw fail(0, null, 'network error'); }
    let out = null;
    try { out = await res.json(); } catch { out = null; }
    if (!res.ok) throw fail(res.status, out, (out && out.error) || `request failed (${res.status})`);
    return out;
  }
  /** The open chat's run link for a card / pipeline / run — pipeline id first, then the card id, then the run id
   *  (the order refreshProgressIdent always used; it calls this now) — as { runId, pipelineId }, or null. */
  function runLinkFor({ cardId = null, pipelineId = null, runId = null } = {}) {
    if (!st.model) return null;
    const link = (pipelineId && st.model.runLinkByPipeline(pipelineId)) || st.model.runLinkForCard(cardId)
      || (runId ? (() => { const l = st.model.runLinks().get(runId); return l ? { runId, ...l } : null; })() : null);
    return link ? { runId: link.runId || null, pipelineId: link.pipelineId || null } : null;
  }
  /** The ONE ctx every registered card builder gets (CONTRACT §2, plus openShipIt for P2 and runLinkFor for P3). */
  const cardCtx = {
    doc, win, fetch,
    threadId: () => st.threadId,
    postCard: (block, body) => postCardJson(block, body),
    postChanges: (ref, text) => postChangesJson(ref, text),                               // Shaper s5
    confirm,
    runStore,
    openRunPanel: (ref, opts) => chatDep('openRunPanel', ref, opts),
    shaperCard: (pipelineId, onChange) => chatDep('shaperCard', pipelineId, onChange),   // Shaper s2 (D12)
    openArtifact: (ref, artifact) => chatDep('openArtifact', ref, artifact),
    downloadArtifact: (ref, artifact) => chatDep('downloadArtifact', ref, artifact),
    checklists: (ref) => chatDep('checklists', ref),                                     // Shaper s3 (D18)
    openPlan: (ref) => chatDep('openPlan', ref),                                         // Shaper s3 (D7)
    openFiles: (o) => chatDep('openFiles', o),
    revealInfo: () => chatDep('revealInfo'),
    revealFile: (o) => chatDep('revealFile', o),
    openShipIt: (ref, link) => chatDep('openShipIt', ref, link),
    runLinkFor: (ref) => runLinkFor(ref || {}),
    appendToComposer: (text) => appendToComposer(text),
    announce: (text) => announce(text),
    setScope: (scope) => setScopeFromApi(scope),
    focusComposer: () => focusComposer(),
  };
  /** Ask Worca's drafted agent / script cards and its graph card (ask-composer-cards.mjs): the Workflows chat's cards
   *  without a canvas, their actions app.js's (composerActions). Made on first use (never during construction). */
  function composerCards() {
    if (!st.composerCards) {
      st.composerCards = createAskComposerCards({
        doc, fetch, now,
        blocks: () => {
          const out = [];
          if (st.model) for (const row of st.model.messages()) for (const b of row.blocks || []) if (b && b.kind === 'card') out.push(b);
          return out;
        },
        postCard: (block, body) => postCardJson(block, body),
        actions: composerActions || {},
        openComposer,
        onChange: () => scheduleFlush(),
      });
    }
    return st.composerCards;
  }
  /** The registered builder a block renders with, or null. The key (lead ruling, P3): every block the built-in
   *  progress card would take — a track_run card AND a typeless run proposal that started (or failed with a runId) —
   *  looks up `progress`; anything else its own type. A registered type is never a progress block (below). */
  function registeredCardBuilder(block) {
    const key = isProgressBlock(block) ? PROGRESS_CARD_TYPE : (block.card && block.card.type);
    return typeof key === 'string' && key ? chatCardBuilder(key) : null;
  }
  /** A registered card's payload revision (its `card` object): buildCard and tailSignature compare it, so a change
   *  that keeps the state (a result filled in) still reaches the card. */
  function cardRev(block) {
    try { return JSON.stringify((block && block.card) ?? null); } catch { return ''; }
  }

  function isProgressBlock(block) {
    const card = block.card || {};
    if (card.type === PROGRESS_CARD_TYPE) return true;
    if (card.type && chatCardBuilder(card.type)) return false;      // an extension type is never a run card, whatever its state
    if (ASK_COMPOSER_CARD_TYPES.includes(card.type)) return false;   // Ask's draft / graph cards are never run cards
    if (card.type === COMMAND_CARD_TYPE || card.type === 'workflow' || card.type === 'metrics' || card.type === 'policy' || card.type === 'schedule' || card.type === 'model' || card.type === 'clone' || card.type === 'web' || card.type === 'workspace' || card.type === 'actions' || card.type === 'away' || card.type === 'project') return false;
    return block.state === 'started' || (block.state === 'failed' && !!block.runId);
  }
  function buildCard(block) {
    if (!st.cardEls) st.cardEls = new Map();
    const cached = st.cardEls.get(block.id);
    // CONTRACT §2: a registered builder wins. The built-ins' cache rule: reused while the state holds, rebuilt (the old
    // entry disposed) when it changes. A registered card's payload may also change while its state holds (P2's
    // pull-request card fills `card.result`): the handle's blockChanged(block) absorbs it when the handle has one, else
    // the card is rebuilt. A builder that throws falls back to the built-in card; the entry keeps the builder
    // (`custom`) and the payload (`rev`), so the fallback is not retried on every render.
    const custom = registeredCardBuilder(block);
    const rev = custom ? cardRev(block) : '';
    if (custom && cached && cached.custom === custom && cached.state === block.state) {
      if (cached.rev === rev) return cached.el;
      if (cached.handle && typeof cached.handle.blockChanged === 'function') {
        let kept = false;
        try { cached.handle.blockChanged(block); kept = true; } catch (err) { console.warn('[worca] a chat card update failed', err); }
        if (kept) { cached.rev = rev; return cached.el; }
      }
    }
    if (custom) {
      let made = null;
      try { made = custom(block, cardCtx); } catch (err) { console.warn('[worca] a chat card builder failed', err); }
      if (made && made.el) {
        if (cached) disposeCardEntry(cached);
        st.cardEls.set(block.id, { el: made.el, state: block.state, rev, custom, handle: made.handle || null, dispose: made.dispose || null, animate: !!made.animate, cancelAnim: null, lastW: -1, shapeOn: shapeFirstOn() });
        return made.el;
      }
    }
    const isWorkflow = !!(block.card && block.card.type === 'workflow');
    // A policy card is a metrics card with different words (buildMetricsCard branches on the type).
    const isMetrics = !!(block.card && (block.card.type === 'metrics' || block.card.type === 'policy'));
    const isSchedule = !!(block.card && block.card.type === 'schedule');
    const isModel = !!(block.card && block.card.type === 'model');
    const isClone = !!(block.card && block.card.type === 'clone');
    const isProject = !!(block.card && block.card.type === 'project');
    const isWorkspace = !!(block.card && block.card.type === 'workspace');
    const isWeb = !!(block.card && block.card.type === 'web');
    const isActions = !!(block.card && block.card.type === 'actions');
    const isAway = !!(block.card && block.card.type === 'away');
    const isCommand = !!(block.card && block.card.type === COMMAND_CARD_TYPE);
    const isComposer = !!(block.card && ASK_COMPOSER_CARD_TYPES.includes(block.card.type));
    const isProgress = isProgressBlock(block);
    // Proposed cards only: `card.nudge` stays on the block after it flips to 'started', and a live run card must never
    // be disposed and remounted because the gate changed.
    const nudgeStale = block.state === 'proposed' && !!(block.card && block.card.nudge) && cached && cached.shapeOn !== shapeFirstOn();
    // Ask's draft cards also change with the cards AROUND them (a newer draft of the key replaces one): rebuilt when
    // what they show changes, not only their state.
    const view = isComposer ? composerCards().view(block) : '';
    if (cached && !nudgeStale && cached.state === block.state && (cached.view || '') === view && (isWorkflow || isMetrics || isSchedule || isModel || isClone || isProject || isWeb || isWorkspace || isActions || isAway || isCommand || isComposer || isProgress || block.state === 'proposed')) return cached.el;
    if (cached) disposeCardEntry(cached);
    const built = isWorkflow ? buildWorkflowCard(block, cached)
      : isMetrics ? buildMetricsCard(block)
      : isSchedule ? buildScheduleCard(block)
      : isModel ? buildModelCard(block)
      : isClone ? buildCloneCard(block)
      : isProject ? buildProjectCard(block)
      : isWeb ? buildWebCard(block)
      : isWorkspace ? buildWorkspaceCard(block)
      : isActions ? buildActionsCard(block)
      : isAway ? buildAwayCard(block)
      : isCommand ? buildCommandCard(block)
      : isComposer ? composerCards().render(block)
      : isProgress ? buildProgressCard(block)
        : custom ? { el: make('div', 'ask-card-stub', (block.card && (block.card.summary || block.card.title)) || 'Card unavailable') }
        : { el: block.state === 'proposed' ? buildCardForm(block) : buildCardTerminal(block) };
    st.cardEls.set(block.id, { el: built.el, state: block.state, view, rev, custom: custom || null, handle: built.handle || null, dispose: built.dispose || null, animate: !!built.animate, cancelAnim: null, lastW: -1, shapeOn: shapeFirstOn() });
    return built.el;
  }
  function disposeCardEntry(c) {
    try { if (c.cancelAnim) c.cancelAnim(); } catch { /* ignore */ }
    try { if (c.dispose) c.dispose(); } catch { /* a dead mount never breaks a render */ }
  }
  /** Drop cached card elements whose block is gone (keep = the live ids), or every one. */
  function pruneCardEls(keep = null) {
    if (!st.cardEls) return;
    for (const [id, c] of st.cardEls) {
      if (keep && keep.has(id)) continue;
      disposeCardEntry(c);
      st.cardEls.delete(id);
    }
  }
  /** After a flush: measure the attached graph hosts once per width (jsdom: 0 ⇒ the 702 default) and start a pending build animation.
   *  A width change DURING a build lands it first (v5): view.relayout re-creates the wire paths, which would drop their `is-hid`
   *  mid-choreography (measured) — so cancel() (which lands everything) runs before the relayout. A canvas well
   *  (`handle.well`) never moves a node or rewrites a wire on relayout: its build keeps running. */
  function relayoutCards() {
    if (!st.cardEls) return;
    for (const c of st.cardEls.values()) {
      if (!c.handle || !c.el.isConnected) continue;
      // A built-in handle measures its graph host; an extension card's handle (CONTRACT §2) has no `parts` — its element then.
      const w = (c.handle.parts ? (c.handle.parts.graph && c.handle.parts.graph.clientWidth) : c.el.clientWidth) || 0;
      if (w !== c.lastW) {
        if (c.cancelAnim && !c.handle.well) { try { c.cancelAnim(); } catch { /* ignore */ } c.cancelAnim = null; }
        c.lastW = w;
        if (typeof c.handle.relayout === 'function') c.handle.relayout(w);
      }
      // A canvas well's description footers fill in once the library behind them loads (ask-composer-cards describe):
      // text only — the footer heights are fixed, so no card moves and a running build keeps its hidden wires.
      if (st.composerCards && typeof c.handle.setDescriptions === 'function' && c.descAt !== st.composerCards.describedAt()) {
        c.descAt = st.composerCards.describedAt();
        c.handle.setDescriptions(st.composerCards.describe);
      }
      if (c.animate) { c.animate = false; c.cancelAnim = playAssembly(c.handle, { win, onDone: () => { c.cancelAnim = null; } }); }
    }
  }

  /** True while a card whose graph well shows description footers is in the column (relayoutCards fills them in). */
  function describedGraphShowing() {
    if (!st.cardEls) return false;
    for (const c of st.cardEls.values()) if (c.handle && typeof c.handle.setDescriptions === 'function' && c.el.isConnected) return true;
    return false;
  }

  // ---- command cards (ui/public/ask-command-card.mjs; Ask agent mode, #574) ------------------------------------------
  /** One command Ask ran: hydrated once over REST (a reload, a finished block), then live from ask-command frames. */
  function buildCommandCard(block) {
    const card = block.card || {};
    const blockId = String(card.blockId || '');
    const handle = createCommandCard({ doc, card, onStop: (sid) => {
      fetch(`/api/terminal/sessions/${encodeURIComponent(sid)}/stop`, { method: 'POST' }).catch(() => { /* the next frame says what happened */ });
    }, onShow: (sid) => showTerminal(sid), expanded: st.commandsOpen.has(blockId), keepInPlace, onToggle: (open) => {
      if (open) st.commandsOpen.add(blockId); else st.commandsOpen.delete(blockId);
    } });
    st.commands.set(blockId, handle);
    const early = st.commandFrames.get(blockId);
    if (early) { st.commandFrames.delete(blockId); handle.update(early); }
    const tid = st.threadId;
    if (!early && tid) {
      fetch(`/api/ask/threads/${tid}/commands/${encodeURIComponent(blockId)}`)
        .then((r) => (r && r.ok ? r.json() : null))
        .catch(() => null)
        .then((view) => {
          if (st.destroyed || st.commands.get(blockId) !== handle) return;
          // A `running` reply may be older than a frame that already landed (even the final one): it only fills an empty card.
          if (view && typeof view.status === 'string') { if (!handle.view || view.status !== 'running') handle.update(view); }
          else if (!handle.view) handle.update({ status: 'done', exitCode: null, tail: '' });   // 404/403: the command, an `ended` pill
        });
    }
    // No `handle` here: relayoutCards() measures a graph on cached handles, and this card has none.
    return { el: handle.el, dispose: () => { if (st.commands.get(blockId) === handle) st.commands.delete(blockId); handle.destroy(); } };
  }
  /** An ask-command frame: the card's live state. Never a row change, so it never reaches the model. */
  function applyCommandFrame(view) {
    if (!view || typeof view.blockId !== 'string') return;
    const handle = st.commands.get(view.blockId);
    if (handle) { handle.update(view); return; }
    st.commandFrames.set(view.blockId, view);                  // the turn's card block and the first frames race
    if (st.commandFrames.size > 50) st.commandFrames.delete(st.commandFrames.keys().next().value);
  }

  // ---- run progress cards (ui/public/ask-run-card.mjs; D1 runStore seam, D9 REST hydration, D11 cadence) ------------
  const PROGRESS_TICK_MS = 1000, PROGRESS_REHYDRATE_MS = 30_000;
  const PIPELINE_ID_RE = /^[0-9a-f]{8}$/;

  /** The persisted identity a card starts from (§4.2). The pipeline id of a started proposal arrives later
   *  (run store, then the thread's run links — keyed by the card, so a resume cannot orphan it). */
  function progressIdent(block) {
    const card = block.card || {};
    if (card.type === PROGRESS_CARD_TYPE) {
      return { cardId: block.id, pipelineId: card.pipelineId || null, runId: card.runId || null, projectKey: card.projectKey || null,
        workspaceId: card.workspaceId || null, title: card.title || '', label: card.label || '' };
    }
    const none = card.target === 'none';   // P3: a No project proposal — the reserved key and its name until the first frame
    return { cardId: block.id, pipelineId: null, runId: block.runId || null, projectKey: none ? NO_PROJECT_KEY : (card.projectKey || null), workspaceId: card.workspaceId || null,
      title: card.title || card.brief || 'run', label: none ? NO_PROJECT_NAME : (card.workspaceName || card.projectName || '') };
  }
  /** Fold the thread's run links into the identity: the first `state` reveals the pipeline id; a resume moves the runId. */
  function refreshProgressIdent(ident) {
    const link = runLinkFor(ident);
    if (!link) return;
    if (link.pipelineId) ident.pipelineId = link.pipelineId;
    if (link.runId && !PIPELINE_ID_RE.test(link.runId)) ident.runId = link.runId;   // a pipeline-id-keyed link has no live UUID (D5)
  }
  function progressSnapshot(entry) {
    const ident = entry.ident;
    let snap = null;
    // D23: the pipeline id is the stable key; byPipeline resolves the LIVE lineage when a superseded twin shares it.
    if (runStore) {
      if (ident.pipelineId) snap = runStore.byPipeline(ident.pipelineId);
      if (!snap && ident.runId) snap = runStore.get(ident.runId);
    }
    if (snap) {
      if (snap.pipelineId && !ident.pipelineId) ident.pipelineId = snap.pipelineId;
      if (snap.runId) ident.runId = snap.runId;
      return snap;
    }
    return entry.rest;
  }
  function buildProgressCard(block) {
    if (!st.progress) st.progress = new Map();
    const ident = progressIdent(block);
    const handle = createRunProgressCard({ doc, ident, onOpen: (href) => {
      // The route hides the Chat page (app.js showView); nothing to close here.
      if (href && href.startsWith('#') && win.location.hash !== href) win.location.hash = href.slice(1);
    } });
    const entry = { ident, handle, rest: null, hydrating: false, nextHydrateAt: 0 };
    st.progress.set(block.id, entry);
    if (block.state === 'failed' && block.error) handle.setReason(`Run failed: ${block.error}`);
    repaintProgress(entry, { hydrate: true });
    ensureRunTick();
    return { el: handle.el, handle, dispose: () => { if (st.progress && st.progress.get(block.id) === entry) st.progress.delete(block.id); handle.destroy(); } };
  }
  function repaintProgress(entry, { hydrate = false } = {}) {
    refreshProgressIdent(entry.ident);
    const snap = progressSnapshot(entry);
    // D24: a lineage this tab just dropped (the acting tab's resume evicts the superseded entry) must not regress the
    // card to "Starting" — keep the last paint until the new lineage's first state or REST lands.
    entry.handle.update(snap || entry.handle.snapshot, now());
    if (hydrate && !(snap && snap.source === 'live') && entry.ident.pipelineId) hydrateProgress(entry);
  }
  /** Repaint every attached progress card; `hydrate` re-reads REST for the ones the live map does not hold. */
  function repaintProgressCards({ hydrate = false } = {}) {
    st.runPoked = false;
    if (!st.progress || !st.progress.size) return;
    for (const entry of st.progress.values()) if (entry.handle.el.isConnected) repaintProgress(entry, { hydrate });
  }
  async function hydrateProgress(entry) {
    if (entry.hydrating || st.destroyed) return;
    entry.hydrating = true;
    const id = entry.ident.pipelineId;
    try {
      const res = await fetch(`/api/ask/runs/${id}`);
      if (res && res.ok) {
        const body = await res.json();
        // The envelope, not any 200: a stub that answers every URL must never paint a run (test/ui-ask-card.test.mjs boot stub).
        if (body && body.state && typeof body.state.status === 'string' && body.state.id === id) {
          entry.rest = snapshotFromState(body.state, { now: now() });
          if (body.live && body.live.runId) entry.ident.runId = body.live.runId;
        }
      }
    } catch { /* offline: the card keeps its last paint */ }
    entry.hydrating = false;
    entry.nextHydrateAt = now() + PROGRESS_REHYDRATE_MS;
    if (st.destroyed || !st.progress || st.progress.get(entry.ident.cardId) !== entry) return;
    entry.handle.update(progressSnapshot(entry) || entry.handle.snapshot, now());   // D24: a failed/junk hydrate keeps the last paint
  }
  function ensureRunTick() {
    if (st.runTick || st.destroyed) return;
    // Bare setInterval, unref'd — the startElapsed() precedent (a jsdom window timer has no unref()).
    st.runTick = setInterval(onRunTick, PROGRESS_TICK_MS);
    if (st.runTick && typeof st.runTick.unref === 'function') st.runTick.unref();
  }
  function onRunTick() {
    if (st.destroyed || !st.progress || !st.progress.size) { if (st.runTick) { clearInterval(st.runTick); st.runTick = null; } return; }
    if (!st.open) return;                                       // the tick idles behind a closed sheet (a frame-driven flush may still patch the hidden DOM — harmless); openSheet() catches up
    const t = now();
    for (const entry of st.progress.values()) {
      if (!entry.handle.el.isConnected) continue;
      const snap = entry.handle.snapshot;
      if (!snap || snap.terminal) continue;
      if (snap.source === 'live') entry.handle.update(progressSnapshot(entry) || snap, t); // fresh elapsed + cost from the store (D24: never null)
      else if (t >= entry.nextHydrateAt) hydrateProgress(entry);                            // a run this tab gets no frames for
    }
  }
  if (runStore && typeof runStore.subscribe === 'function') {
    st.runUnsub = runStore.subscribe((runId, type) => {
      if (st.destroyed || type === 'log' || !st.progress || !st.progress.size) return;
      st.runPoked = true;
      if (st.open) scheduleFlush();
    });
  }

  /** A tool row's name and args. Worca's own tools drop their `mcp__worca__` prefix (list_projects), built-ins keep
   *  their name (Read, Grep). The special cases keep their own args: a registry copy's tool (MCP registry §9.7) is
   *  named `<copy> · <tool>`; a set skill (skills registry §4.4) shows its qualified name (and its args); a script
   *  tool (§9.3) its key and outcome — its input is a whole program, so the JSON is worth nothing there. */
  function toolLine(block) {
    const mcp = parseMcpToolName(block.name);
    if (mcp && mcp.server !== 'worca') return { name: `${mcp.server} · ${mcp.tool}`, args: toolArgs(block.input), mcp: true };
    if (block.name === 'Skill' && block.input && typeof block.input.skill === 'string') {
      const args = typeof block.input.args === 'string' && block.input.args ? block.input.args : '';
      return { name: block.name, args: args ? `${block.input.skill} · ${args}` : block.input.skill, mcp: false };
    }
    const short = String(block.name || '').replace(/^mcp__worca__/, '');
    const script = scriptToolLine(short, block);
    return { name: short, args: script ? script.target : toolArgs(block.input), mcp: false };
  }

  function toolRow(block) {
    const rowEl = make('div', 'ask-tool-row');
    rowEl.dataset.minLevel = 'advanced';            // what the assistant ran, step by step
    rowEl.appendChild(make('span', `ask-tool-dot${block.status === 'running' ? ' is-running' : block.status === 'error' ? ' is-error' : ''}`));
    // The name and the args flow as one text, clamped to two lines by CSS (.ask-tool-target); the hover holds it all.
    const { name, args, mcp } = toolLine(block);
    const text = make('span', 'ask-tool-target');
    text.appendChild(make('span', mcp ? 'ask-tool-name ask-tool-mcp' : 'ask-tool-name', name));
    if (args) text.append(' ', make('span', 'ask-tool-args', args));
    text.title = args ? `${name} ${args}` : name;
    rowEl.appendChild(text);
    const note = block.status === 'error' ? 'error' : block.status === 'running' ? '…' : fmtElapsed(block.durationMs);
    rowEl.appendChild(make('span', 'ask-tool-note', note || ''));
    return rowEl;
  }

  function agentRow(block) {
    const wrap = make('div', 'ask-agent');
    const rowEl = make('button', 'ask-agent-row');
    rowEl.type = 'button';
    rowEl.appendChild(make('span', `ask-dot${block.status === 'running' ? ' ask-dot-run' : block.status === 'done' ? ' ask-dot-done' : ''}`));
    rowEl.appendChild(make('span', 'ask-agent-name', block.label || block.type || 'agent'));
    rowEl.appendChild(make('span', 'ask-agent-model', block.model || ''));
    const fillEl = make('span', 'ask-agent-tokens', fmtCtx(block.ctx, block.ctxWindow) || fmtTokens(block.tokens) || '');
    const level = ctxLevel(block.ctx, block.ctxWindow);             // null without a window: no colour, as before
    if (level === 'warn' || level === 'high') fillEl.classList.add(`is-ctx-${level}`);
    const fillTitle = Number.isInteger(block.ctxWindow) ? ctxTitle(block.ctx, block.ctxWindow) : null;
    if (fillTitle) fillEl.title = fillTitle;
    rowEl.appendChild(fillEl);
    rowEl.appendChild(make('span', 'ask-agent-cost', Number.isFinite(block.costUsd) ? `≈${fmtUsd(block.costUsd)}` : ''));
    rowEl.appendChild(make('span', `ask-agent-status${block.status === 'done' ? ' is-done' : ''}`, block.status || ''));
    rowEl.addEventListener('click', () => {
      if (st.expandedAgents.has(block.id)) st.expandedAgents.delete(block.id);
      else st.expandedAgents.add(block.id);
      const found = st.model && findRowOfBlock(block.id);
      if (found) refreshRow(found);
    });
    wrap.appendChild(rowEl);
    if (st.expandedAgents.has(block.id)) {
      const log = make('div', 'ask-agent-log');
      const head = make('div', 'ask-agent-log-head');
      head.appendChild(make('span', null, [block.model, fmtCtx(block.ctx, block.ctxWindow) || fmtTokens(block.tokens), Number.isFinite(block.costUsd) ? `≈${fmtUsd(block.costUsd)}` : null].filter(Boolean).join(' · ')));
      head.appendChild(make('span', 'ask-agent-log-type', block.type || ''));
      log.appendChild(head);
      const body = make('div', 'ask-agent-log-body');
      for (const line of Array.isArray(block.log) ? block.log : []) {
        const l = make('div', 'ask-agent-log-line');
        l.appendChild(make('span', 'ask-agent-log-t', mmss(line.t)));
        l.appendChild(make('span', 'ask-agent-log-text', line.text || ''));
        body.appendChild(l);
      }
      log.appendChild(body);
      wrap.appendChild(log);
    }
    return wrap;
  }

  function findRowOfBlock(blockId) {
    for (const row of st.model.messages()) {
      if ((row.blocks || []).some((b) => b && b.id === blockId)) return row;
    }
    return null;
  }

  function refreshRow(row) {
    const entry = st.rowEls && st.rowEls.get(row.id);
    if (entry) entry.update(row);
  }

  const isLiveRow = (row) => !!(row && st.model && st.model.live() && st.model.live().messageId === row.id);

  /**
   * The block above the answer: one head line (`Done · 7.4s · 19.8k ctx · $0.05`) over a body holding the tool rows
   * and the sub-agent section. The body is collapsed by default in every state, live turns included, so nothing
   * jumps when a turn lands; an open body keeps updating live. The head is a button (aria-expanded, a chevron) only
   * while the body holds rows the current mode shows — tool rows are Advanced, sub-agents Expert (docs/ui-levels.md)
   * — so a Simple user never gets a toggle that opens nothing. What is open is panel state (st.expandedActivity, by
   * message id, like st.expandedAgents): it outlives the per-frame sync and a structural repaint.
   *
   * `update(row)` patches it IN PLACE: the head is re-stated, a tool/agent row
   * already on screen is replaced by its own fresh node, and a new one is
   * appended into its group. Nothing outside `.ask-activity` is touched, so an
   * ask-label or ask-block frame can no longer re-create the message around the
   * text being read (which replayed the entry animation on every frame of a turn).
   */
  function buildActivity(row) {
    const activity = make('div', 'ask-activity');
    let head = make('div', 'ask-activity-head');
    const body = make('div', 'ask-activity-body');
    body.hidden = true;
    activity.append(head, body);
    let cur = row;
    const toolEls = new Map();     // block id → the row currently rendered for it
    const agentEls = new Map();
    let agents = null;             // the .ask-agents section, once the row has one
    let agentsCount = null;

    function renderHead(r, canOpen) {
      const stopped = r.status === 'stopped' || r.status === 'error';
      // A turn still running that no frame has made live yet (a chat loaded mid-turn, before the subscribe replay
      // adopts it) is in progress too: its unfinished row has no duration or cost, and "Done" would be a lie.
      const inFlight = st.model && st.model.inFlight();
      const isLive = isLiveRow(r) || (!stopped && (r.status === 'streaming' || !!(inFlight && inFlight.messageId === r.id)));
      const parts = [];
      // The head names its state in one word — Thinking, Done, or Stopped after —
      // and nothing more while the turn is live: the orb row at the bottom of the
      // message owns the elapsed and the meter, and printing either set twice is
      // the noise this replaced. A turn that ended badly says so instead of Done;
      // nothing else marks a stop. A turn that ended before any result, or within
      // a few ms (a signed-out CLI answers in ~20 ms), has no duration worth
      // printing: plain Stopped, never a dangling "Stopped after" or "Stopped
      // after 0.0s". The rest follows on the same line, dot-separated.
      if (isLive) parts.push(make('span', 'ask-activity-label', 'Thinking'));
      else {
        const shown = fmtElapsed(r.durationMs);
        const elapsed = shown && shown !== '0.0s' ? shown : '';
        const meter = [fmtCtx(r.usage && r.usage.ctx), fmtUsd(r.costUsd)].filter(Boolean).join(' · ');
        parts.push(make('span', 'ask-activity-label', stopped ? (elapsed ? 'Stopped after' : 'Stopped') : 'Done'));
        if (elapsed) parts.push(stopped ? ' ' : ' · ');
        parts.push(make('span', 'ask-activity-elapsed', elapsed));
        if (meter) parts.push(' · ');
        parts.push(make('span', 'ask-activity-meter', meter));
      }
      if (canOpen) {
        const chev = make('span', 'ask-activity-chev', '›');
        chev.setAttribute('aria-hidden', 'true');
        parts.push(chev);
      }
      head.replaceChildren(...parts);
    }

    function toggle() {
      if (st.expandedActivity.has(cur.id)) st.expandedActivity.delete(cur.id);
      else st.expandedActivity.add(cur.id);
      keepInPlace(head, () => sync(cur));
    }

    /** Re-render the tracked rows of one kind against `blocks`, in order, inside `host` before `before`. */
    function syncRows(blocks, els, build, host, before) {
      const keep = new Set();
      for (const b of blocks) {
        const fresh = build(b);
        const prev = els.get(b.id);
        if (prev) prev.replaceWith(fresh);      // a block upserts by id: same slot, new node
        else host.insertBefore(fresh, before);
        els.set(b.id, fresh);
        keep.add(b.id);
      }
      for (const [id, node] of els) if (!keep.has(id)) { node.remove(); els.delete(id); }
    }

    function sync(r) {
      cur = r;
      const blocks = Array.isArray(r.blocks) ? r.blocks : [];
      const toolBlocks = blocks.filter((b) => b && b.kind === 'tool');
      const agentBlocks = blocks.filter((b) => b && b.kind === 'agent');
      if (agentBlocks.length && !agents) {
        agents = make('div', 'ask-agents');
        agents.dataset.minLevel = 'expert';           // per-agent logs (docs/ui-levels.md)
        const cap = make('div', 'ask-agents-cap');
        cap.appendChild(make('span', null, 'Sub-agents'));
        agentsCount = make('span', 'ask-agents-count', '');
        cap.appendChild(agentsCount);
        agents.appendChild(cap);
        body.appendChild(agents);
      }
      // Tool rows go before the sub-agent section, so a tool that lands after the
      // first agent still slots into its own group.
      syncRows(toolBlocks, toolEls, toolRow, body, agents);
      if (agents) {
        agentsCount.textContent = String(agentBlocks.length);
        syncRows(agentBlocks, agentEls, agentRow, agents, null);
        if (!agentBlocks.length) { agents.remove(); agents = null; agentsCount = null; }
      }
      const level = currentLevel(doc);
      const canOpen = (toolBlocks.length > 0 && levelShows(level, 'advanced')) || (agentBlocks.length > 0 && levelShows(level, 'expert'));
      const open = canOpen && st.expandedActivity.has(r.id);
      if (head.tagName !== (canOpen ? 'BUTTON' : 'DIV')) {
        // Rare (the first row lands, the mode changes): the head becomes a button or stops being one.
        const next = make(canOpen ? 'button' : 'div', 'ask-activity-head');
        if (canOpen) { next.type = 'button'; next.addEventListener('click', toggle); }
        head.replaceWith(next);
        head = next;
      }
      if (canOpen) head.setAttribute('aria-expanded', String(open));
      renderHead(r, canOpen);
      body.hidden = !open;
    }

    sync(row);
    return { el: activity, update: sync };
  }

  // The ONE orb: created on first live turn and re-parented into each live row a
  // STRUCTURAL repaint rebuilds (a tool block no longer rebuilds the row — see
  // buildMessage's patch path). Rebuilding it per row would restart the canvas
  // and the sphere would visibly snap back mid-turn.
  function ensureThinking() {
    if (el.thinking) return el.thinking;
    el.orb = orbs.create(28, 'ask-orb');
    const wrap = make('div', 'ask-thinking');
    wrap.appendChild(el.orb);
    el.thinkingLabel = make('span', 'ask-thinking-label');
    wrap.appendChild(el.thinkingLabel);
    const meter = make('span', 'ask-thinking-meter');
    el.thinkingElapsed = make('span', 'ask-thinking-elapsed');
    el.thinkingUsage = make('span', 'ask-thinking-usage');
    meter.appendChild(el.thinkingElapsed);
    meter.appendChild(el.thinkingUsage);
    wrap.appendChild(meter);
    el.thinking = wrap;
    return wrap;
  }

  function updateThinking() {
    const live = st.model && st.model.live();
    if (!live || !el.thinking) return;
    el.thinkingLabel.textContent = `${live.label || 'Thinking'}…`;
    // ask-usage marks only `meters` dirty, so the row is NOT rebuilt when the
    // numbers move — this runs every flush instead (updateLiveElapsed).
    const rest = [fmtCtx(live.usage && live.usage.ctx), fmtUsd(live.costUsd)].filter(Boolean).join(' · ');
    el.thinkingUsage.textContent = rest ? ` · ${rest}` : '';
    // Thinking · a tool or sub-agent running · writing, as in the Workflows chat. Only once the row is in the page:
    // the orb reads its colour from the canvas's computed `color` (.dot-orb in style.css). A row renderTail builds
    // detached gets its phase at the end of the same flush (updateLiveElapsed).
    const row = rowOf(live.messageId);
    if (el.orb.isConnected) orbs.set(el.orb, turnPhase(live, row && row.blocks));
  }

  /** A card that sits inside the answer where it happened (textAt: the answer's length then — a command card), in block order. */
  function inlineCards(row) {
    return (row.blocks || []).filter((b) => b && b.kind === 'card' && Number.isFinite(b.textAt));
  }
  /** The answer cut at each inline card's offset: one more piece than there are cards (clamped, never backwards). */
  function answerPieces(text, cards) {
    const pieces = [];
    let at = 0;
    for (const b of cards) {
      const cut = Math.min(text.length, Math.max(at, b.textAt));
      pieces.push(text.slice(at, cut));
      at = cut;
    }
    pieces.push(text.slice(at));
    return pieces;
  }
  /** Render the answer into its pieces: `divs[0]` before the first inline card, `divs[i]` after card i. */
  function renderAnswerInto(divs, row) {
    const isLive = !!(st.model && st.model.live() && st.model.live().messageId === row.id);
    const full = isLive ? st.model.live().text : row.text || '';
    const pieces = answerPieces(full, inlineCards(row).slice(0, divs.length - 1));
    divs.forEach((div, i) => {
      renderAnswerPiece(div, pieces[i] || '', isLive);
      if (i > 0) div.hidden = !(pieces[i] || '').trim();      // no empty gap between two cards, or after the last
    });
  }
  function renderAnswerPiece(div, text, isLive) {
    // Seed the >32 KB throttle clock here, not only in renderAnswerFor: a
    // structural flush repaints answers through renderTranscript, which never
    // passes through renderAnswerFor — left at 0, the 250 ms window would be
    // permanently expired and the size ladder dead.
    st.lastAnswerRender = now();
    if (!renderer.isReady() && !renderer.isFailed() && !st.mdKicked) {
      st.mdKicked = true;
      renderer.ensure().then((ok) => { if (ok && !st.destroyed) rerenderAnswers(); });
    }
    const out = renderer.render(text);
    if (out.kind === 'md') {
      div.classList.add('ask-md');
      div.classList.remove('ask-answer-plain');
      div.replaceChildren(out.frag);
      refChips.decorate(div, { live: isLive });
      if (!isLive) renderer.highlight(div); // fire-and-forget; §10.5: highlight on done
    } else {
      div.classList.add('ask-answer-plain');
      div.classList.remove('ask-md');
      div.textContent = text;
    }
  }

  function rerenderAnswers() {
    if (!st.rowEls) return;
    for (const entry of st.rowEls.values()) { if (entry.renderAnswer) entry.renderAnswer(); }
    scheduleFlush();
  }

  /**
   * What the region BELOW the answer is made of — the notices, the cards, the
   * error line and whether the orb row belongs here. Rebuilding that region on
   * every frame would re-insert the cards inside the message, and a re-inserted
   * element replays its OWN entry animation (.ask-rp/.ask-wfcard/.ask-rc all
   * carry wr-rise), so it is rebuilt only when this string changes.
   */
  function tailSignature(row) {
    const parts = [];
    for (const b of row.blocks || []) {
      if (!b) continue;
      if (b.kind === 'notice') parts.push(`n:${b.id ?? ''}:${b.text || ''}:${b.href || ''}`);
      else if (b.kind === 'card') parts.push(`c:${b.id}:${b.state || ''}:${(b.card && b.card.type) || ''}:${b.runId || ''}:${b.error || ''}:${registeredCardBuilder(b) ? cardRev(b) : ''}`);
    }
    parts.push(`r:${row.status || ''}:${row.errorMessage || ''}:${row.errorCode || ''}:${isLiveRow(row) ? 1 : 0}`);
    return parts.join('|');
  }

  function buildMessage(row) {
    const wrap = make('div', `ask-msg ask-msg-${row.role}`);
    // The model REPLACES a row object on upsert (ask-model upsertRow), so every
    // closure below reads the latest one through this, never the captured `row`.
    let cur = row;
    let patch = null;   // the in-place update for an assistant row; null ⇒ update() rebuilds
    let relevel = null; // re-decides the activity's toggle after a mode change (assistant rows only)
    let renderAnswer = null;
    if (row.role === 'user') {
      // PD6: a synthetic row (a workflow-card event) is a notice, never a bubble — its text is the model-facing event line.
      const synthetic = (row.blocks || []).filter((b) => b && b.kind === 'notice' && b.synthetic);
      if (synthetic.length) {
        // S39: a quiet notice (a scope switch's event turn) shows nothing — the divider and the answered card say it.
        for (const b of synthetic) if (!b.quiet) wrap.appendChild(buildNotice(b));
        if (synthetic.every((b) => b.quiet)) wrap.hidden = true;
      } else {
        // Shaper (D21): the lead went to the model; the bubble shows the intent chip and the person's own text.
        const own = splitIntentLead(row.text || '');
        if (own.intent) {
          const chip = make('div', 'ask-user-intent');
          chip.append(homeIcon(doc, INTENTS[own.intent].icon, 14), make('span', null, INTENTS[own.intent].label));
          wrap.appendChild(chip);
        }
        // Pinpoint (#669): a message that opens with a blockquote shows it as a quote card above the bubble.
        const { quote, rest } = parseQuotedMessage(own.text);
        if (quote) {
          const card = make('div', 'ask-user-quote');
          card.append(make('div', 'ask-user-quote-h', quote.src ? `From ${quote.src}` : 'Quoted'), make('div', 'ask-user-quote-t', quote.text));
          wrap.appendChild(card);
        }
        const bubbleText = quote ? rest : own.text;
        if (bubbleText || (!quote && !own.intent)) wrap.appendChild(make('div', 'ask-user-bubble', bubbleText));
        const atts = (row.blocks || []).filter((b) => b && b.kind === 'attachment');
        if (atts.length) {
          const pills = make('div', 'extras-pills ask-user-pills');
          for (const b of atts) pills.appendChild(buildAttachmentPill(b));
          wrap.appendChild(pills);
        }
      }
    } else if (row.role === 'system') {
      // Notices and dividers — and a card worca posted out of turn (a PR fix run's progress card, ui/server.mjs askPrFixRun).
      const shown = (row.blocks || []).filter((b) => b && (b.kind === 'notice' || b.kind === 'divider' || b.kind === 'card'));
      if (shown.length) for (const b of shown) wrap.appendChild(b.kind === 'card' ? buildCard(b) : b.kind === 'divider' ? buildDivider(b) : buildNotice(b));
      else wrap.appendChild(buildNotice({ text: row.text }));
    } else {
      const activity = buildActivity(row);
      wrap.appendChild(activity.el);
      const answer = make('div', 'ask-answer');
      wrap.appendChild(answer);
      // Inline cards (a command card) sit between answer pieces, in the order they happened: [card, piece] per card.
      let inline = [];
      const answerDivs = () => [answer, ...inline.map((x) => x.piece)];
      renderAnswer = () => renderAnswerInto(answerDivs(), cur);
      renderAnswer();
      let tailSig = null;
      const renderTail = () => {
        const sig = tailSignature(cur);
        if (sig === tailSig) return;
        tailSig = sig;
        const cards = inlineCards(cur);
        const sameInline = cards.length === inline.length && cards.every((b, i) => b.id === inline[i].id);
        if (sameInline) {
          // Kept in place: a card swaps its element only when buildCard hands back a new one.
          cards.forEach((b, i) => {
            const cardEl = buildCard(b, cur);
            if (cardEl !== inline[i].card) { inline[i].card.replaceWith(cardEl); inline[i].card = cardEl; }
          });
        }
        const last = inline.length ? inline[inline.length - 1].piece : answer;
        while (wrap.lastChild && wrap.lastChild !== last) wrap.removeChild(wrap.lastChild);
        if (!sameInline) {
          while (wrap.lastChild && wrap.lastChild !== answer) wrap.removeChild(wrap.lastChild);
          inline = cards.map((b) => {
            const card = buildCard(b, cur);
            const piece = make('div', 'ask-answer');
            wrap.append(card, piece);
            return { id: b.id, card, piece };
          });
          renderAnswer();
        }
        for (const b of cur.blocks || []) {
          if (!b) continue;
          if (b.kind === 'notice') wrap.appendChild(buildNotice(b));
          else if (b.kind === 'card' && !Number.isFinite(b.textAt)) wrap.appendChild(buildCard(b, cur));
        }
        if (cur.status === 'error') {
          if (cur.errorCode === 'claude-signed-out' && typeof openClaudeSetup === 'function') {
            // The CLI's raw "Not logged in" → one line whose link opens Connect Claude Code.
            const line = make('div', 'ask-error-line', "Claude Code isn't signed in. ");
            const link = make('a', '', 'Sign in…');
            link.href = '#';
            link.addEventListener('click', (e) => { e.preventDefault(); openClaudeSetup(); });
            line.appendChild(link);
            wrap.appendChild(line);
          } else {
            // A classified notice (errorClass on the block) IS the explanation —
            // it renders the human line and, at expert, the raw detail in its
            // own expander. The raw line here is only for the unclassified case.
            const classified = (cur.blocks || []).some((b) => b && b.kind === 'notice' && (b.errorClass || b.codexSetup || b.copilotSetup));
            if (!classified) {
              const explained = (cur.blocks || []).some((b) => b && b.kind === 'notice');
              if (cur.errorMessage) wrap.appendChild(make('div', 'ask-error-line', cur.errorMessage));
              else if (!explained) wrap.appendChild(make('div', 'ask-error-line', 'This turn ended with an error.'));
            }
          }
        }
        if (isLiveRow(cur)) {
          wrap.appendChild(ensureThinking());   // last child: the bottom of the message
          el.elapsed = el.thinkingElapsed;      // the ONE live elapsed node
          // Also the adoption path: a thread whose ask-start the ring buffer
          // already evicted goes live without ever passing through startElapsed();
          // the orb's phase comes from the live turn here, not from a start call.
          updateThinking();
        }
      };
      renderTail();
      // The answer is deliberately NOT re-rendered here: its text only ever moves
      // on `dirty.answer` (renderAnswerFor) or with `dirty.structure`, and
      // replacing its subtree per tool row is exactly what defeated the browser's
      // scroll anchoring mid-turn.
      patch = (row2) => { cur = row2; activity.update(row2); renderTail(); };
      relevel = () => activity.update(cur);
    }
    const entry = {
      el: wrap,
      renderAnswer,
      relevel,
      update(row2) {
        // An assistant row is PATCHED. Rebuilding it handed the column a brand-new
        // `.ask-msg` on every ask-label and every ask-block frame, so the whole
        // message — entry animation, answer subtree and cards — was re-created
        // under the text being read. A user/system row carries nothing live and
        // changes only through a structural repaint, so it still rebuilds.
        if (patch) { patch(row2); return; }
        const fresh = buildMessage(row2);
        wrap.replaceWith(fresh.el);
        st.rowEls.set(row2.id, fresh);
      },
    };
    return entry;
  }

  function renderTranscript() {
    // A card element outlives its row entry (it is cached by card id): drop — and dispose — the ones no row carries any more.
    const keep = new Set();
    if (st.model) for (const row of st.model.messages()) for (const b of row.blocks || []) if (b && b.kind === 'card' && b.id != null) keep.add(b.id);
    pruneCardEls(keep);
    st.rowEls = new Map();
    el.transcriptCol.replaceChildren();
    if (!st.model) { syncView(); return; }
    for (const row of st.model.messages()) {
      const entry = buildMessage(row);
      // The entry animation belongs to a message this transcript has never shown.
      // ask-start, ask-done and every ask-message rebuild the WHOLE column, so
      // without the ledger the rows already on screen would rise and fade in
      // again — including on a mid-turn resync, which repaints the same thread.
      // The ledger is written at the END of a flush, not here: see flush().
      if (!st.seenRows.has(row.id)) entry.el.setAttribute('data-ask-enter', '');
      st.rowEls.set(row.id, entry);
      el.transcriptCol.appendChild(entry.el);
    }
    syncView();                                      // home ↔ thread: the composer follows the first message
  }

  // Bumped by every loadThread()/newThread()/thread creation: whichever GET resolves
  // LAST used to win unconditionally, so a slow old thread load overwrote a newer
  // switch (review of PR #376). A load whose generation is stale returns null.
  let loadGen = 0;
  let queueSeq = 0;   // the queue items' keys (a card's identity across repaints, for its exit and FLIP shift)
  async function loadThread(id) {
    const gen = ++loadGen;
    let res = null;
    try { res = await fetch(`/api/ask/threads/${id}`); } catch { if (gen === loadGen) abandonWant(id); return null; }
    if (gen !== loadGen || st.destroyed) return null;
    if (!res || !res.ok) {
      if (res && res.status === 404 && readStoredThread() === id) storeThread(null);
      // A routed chat that is gone (a stale link, deleted elsewhere): home, and the address says so. Any other
      // failure (a 500, a proxy error) keeps the chat on screen and gives the want back (abandonWant).
      if (res && res.status === 404 && st.wantThread === id) { newThread(); route(null, { replace: true }); }
      else abandonWant(id);
      return null;
    }
    let snap = null;
    try { snap = await res.json(); } catch { if (gen === loadGen) abandonWant(id); return null; }
    if (gen !== loadGen || st.destroyed) return null;
    // A SWITCH starts a fresh ledger, so the new chat rises in. A resync or a
    // reconnect re-loads the SAME thread and must keep it: those repaint rows the
    // user is already reading, mid-turn.
    const switched = st.threadId !== id;
    if (switched) stopVoice();
    if (switched) st.seenRows = new Set();
    st.threadId = id;
    if (st.open && st.unread && st.unreadThread === id) setUnread(false);   // the dot's chat is on screen now
    st.model = createThreadModel({ threadId: id });
    st.model.load(snap);
    if (switched) { st.hist = { idx: -1, draft: '' }; st.suggestDismissed = null; }
    // A queue whose reply ended while this chat was not open (or while frames were missed) waits for Resume queue.
    const q = queueOf(id);
    if (q && q.items.length && !snap.inFlight && !q.draining) q.paused = true;
    renderQueue();
    el.title.textContent = (snap.thread && snap.thread.title) || 'New chat';
    if (switched) st.scopeHeld = null;    // S39: a held pick belongs to the chat it was made in
    // #397: restore the pin — S39: a resync of the same chat does not undo a held pick (the stored row is older).
    if (switched || st.scopeHeld !== id) applyThreadScope(snap.thread && snap.thread.context);
    setContexts(snap.thread && snap.thread.contexts);
    // The picker follows the chat — on a SWITCH only: a resync of the same thread
    // would otherwise clobber a pick the user just made (its PATCH may not have landed).
    if (switched) applyThreadPick(snap.thread);
    if (switched) st.mcp.off = mcpOffOf(snap.thread && snap.thread.mcpOff);   // §9.4: the chat's own choices
    scheduleMcpRefresh();
    renderTranscript();
    updateMeters();
    // P4: the count rides the snapshot loadThread ALREADY fetched — no extra GET.
    // The model owns the list (load() seeded it). It belongs here, not in
    // switchThread: resync()/onHello() come through loadThread too.
    setWorktrees(st.model.worktrees());
    st.pinned = true;
    scheduleFlush();
    stopElapsed();      // a mid-stream thread switch must not leave the old
    updateSendStop();   // turn's timer or stop button behind (V3/D2 reset)
    // Forced: the model above is fresh (no live turn), so the server must replay the running job into it — also when
    // this socket subscribed to the chat before (a switch A → B → A, a resync), or the row never goes live again.
    if (snap.inFlight) { subscribe(id, { force: true }); startElapsed(); }
    repaintProgressCards({ hydrate: true });   // thread load + reconnect (onHello → resync → loadThread): re-resolve + re-hydrate every card
    return snap;
  }

  function switchThread(id) {
    if (!id) return Promise.resolve(null);
    st.wantThread = id;
    storeThread(id);
    syncView();                                      // a chat that loads is a thread already: no home flash
    return loadThread(id);
  }
  /** A switch to `id` failed for a reason other than "gone" (offline, a 500): the page still shows the chat it showed,
   *  so the want, the stored pointer and the address go back to it — and a later pick of `id` tries again (showThread
   *  would otherwise skip it as "already loading"). */
  function abandonWant(id) {
    if (st.destroyed || st.wantThread !== id || st.threadId === id) return;
    st.wantThread = st.threadId;                     // null = home
    storeThread(st.threadId);
    syncView();
    route(st.threadId, { replace: true });
    // A reconnect or a seq gap during the switch skipped this chat's resync — or started one whose load the switch
    // then dropped as stale (loadGen): that one runs again once it settles.
    if (st.resyncing) st.resyncAgain = true;
    else resync();
  }
  // ---- live streaming (spec §10.8) -----------------------------------------
  function rowOf(id) {
    if (!st.model) return null;
    for (const r of st.model.messages()) if (r && r.id === id) return r;
    return null;
  }

  function hasSelectionInside(entry) {
    let sel = null;
    try { sel = win.getSelection ? win.getSelection() : null; } catch { return false; }
    if (!sel || !sel.rangeCount || sel.isCollapsed) return false;
    return containsNode(entry.el, sel.anchorNode) || containsNode(entry.el, sel.focusNode);
  }

  // Streaming answers re-parse the whole accumulated text (spec §10.5); the
  // ladder bounds the cost: ≤32 KB every flush, above that at most one render
  // per 250 ms (measured ≈50 ms/64 KB under jsdom), >200 KB the renderer
  // itself falls back to plain. A live selection inside the answer defers the
  // render to the next flush (§10.8).
  function renderAnswerFor(id) {
    const entry = st.rowEls && st.rowEls.get(id);
    const row = rowOf(id);
    if (!row) return;
    if (!entry || !entry.renderAnswer) { refreshRow(row); return; }
    const live = st.model.live();
    const isLive = !!(live && live.messageId === id);
    if (isLive) {
      if (live.text.length > 32_000 && now() - st.lastAnswerRender < 250) { st.answerPending = id; scheduleFlush(); return; }
      if (hasSelectionInside(entry)) { st.answerPending = id; scheduleFlush(); return; }
    }
    st.lastAnswerRender = now();
    entry.renderAnswer();
  }

  function startElapsed(startedAtMs) {
    st.elapsedStart = Number.isFinite(startedAtMs) ? startedAtMs : now();
    if (st.elapsedTimer) clearInterval(st.elapsedTimer);
    // Bare setInterval on purpose (app.js:14247-14253 precedent): in a browser
    // it IS window.setInterval; under node:test this module resolves it to
    // Node's global, whose Timeout can be unref'd — jsdom's window.setInterval
    // returns a bare number with no unref(), and a leaked 1s tick would hold
    // the event loop open for every turn a test leaves streaming.
    st.elapsedTimer = setInterval(() => scheduleFlush(), 1000);
    if (st.elapsedTimer && typeof st.elapsedTimer.unref === 'function') st.elapsedTimer.unref();
  }
  function stopElapsed() {
    if (st.elapsedTimer) { clearInterval(st.elapsedTimer); st.elapsedTimer = null; }
    st.elapsedStart = null;
    // The orb row is simply not rebuilt into a finished message, so the node is
    // left detached: back at rest here, the orb eases to a stop (a detached one
    // soon drops out of dot-orb's shared loop) and the next turn picks it up.
    if (el.orb) orbs.set(el.orb, 'rest');
  }
  function updateLiveElapsed() {
    if (st.elapsedStart != null && el.elapsed && st.model && st.model.live()) {
      el.elapsed.textContent = fmtElapsed(now() - st.elapsedStart);
    }
    updateThinking();
  }

  function afterFrame(frame) {
    if (frame.type === 'ask-start') { st.stopBy = null; startElapsed(Date.parse(frame.startedAt)); updateSendStop(); }
    // Stop still hidden is the "not adopted yet" signal: Send may stand beside Stop mid-reply (the queue).
    else if (typeof frame.seq === 'number' && frame.type !== 'ask-done' && frame.type !== 'ask-error' && st.model && st.model.live() && el.stop && el.stop.hidden) {
      // A JOB frame ADOPTED mid-turn (no ask-start seen — the ring buffer evicted
      // it, or a broadcast delta beat the subscribe replay): the turn is live now,
      // so the composer must show Stop and the timer must run (review of PR #376).
      // Out-of-turn frames (ask-title — early now — ask-worktrees, ask-message)
      // never adopt: startElapsed() here would reset the running clock.
      startElapsed(); updateSendStop();
    }
    if (frame.type === 'ask-done' || frame.type === 'ask-error') {
      stopElapsed(); updateSendStop(); announce('answer finished');
      if (!st.open) setUnread(true, st.threadId);
      // Conversation chips: the turn's resolved list rides ask-done (an older server omits it: keep what is shown).
      if (frame.type === 'ask-done' && Array.isArray(frame.contexts)) setContexts(frame.contexts);
      // P4: a finished turn may have created/removed/navigated worktrees. This must
      // NOT live in updateSendStop() — that also runs from loadThread, so a
      // running→idle latch there fires a SECOND snapshot GET on every resync.
      refreshWorktrees();
      // The queue: a clean finish sends the next message; an error or a Stop pauses it (a voice barge-in's stop
      // does not — the utterance queued behind it is meant to go now).
      const q = queueOf(st.threadId);
      if (q && q.items.length) {
        const status = frame.status || 'done';
        const clean = frame.type === 'ask-done' && (status === 'done' || (status === 'stopped' && st.stopBy === 'voice'));
        if (clean) drainQueue(); else pauseQueue();
      }
      st.stopBy = null;
    }
    else if (frame.type === 'ask-message' && frame.message && typeof frame.message.text === 'string'
      && /is waiting for your answer/.test(frame.message.text)) announce('run needs an answer');
  }

  // Settings → "Delete all chat history" broadcast (seq-less, threadId-less): every
  // row is gone server-side, so a tab still holding st.threadId would keep a dead
  // chat in memory until its next fetch 404s. Reset exactly like the "+" button.
  function onHistoryCleared({ scoped = false } = {}) {
    closePopover({ focusTrigger: false });
    // Every row is gone server-side: no fetch. A shared clear removed only the caller's chats: refetch the rest.
    if (scoped) scheduleThreadsRefresh();
    else renderHistory([], 0);
    if (st.threadId) { newThread(); route(null, { replace: true }); }
  }

  function pushServerFrame(frame) {
    if (st.destroyed || !frame) return;
    if (frame.type === 'ask-history-cleared') {
      // The chats it removed (every one when it names none) leave the "asked in" set, and a Chat row dot lit for one
      // of them goes out: the Chat row never routes to a deleted chat.
      const gone = Array.isArray(frame.threadIds) ? frame.threadIds : [...st.askedIn];
      for (const id of gone) st.askedIn.delete(id);
      // …and so do their queues (every one when it names none).
      if (Array.isArray(frame.threadIds)) for (const id of frame.threadIds) st.queues.delete(id);
      else st.queues.clear();
      if (st.unread && (!Array.isArray(frame.threadIds) || frame.threadIds.includes(st.unreadThread))) setUnread(false);
      // A shared deployment's clear names the threads it removed: only a tab showing one of them resets.
      if (Array.isArray(frame.threadIds) && !frame.threadIds.includes(st.threadId)) { scheduleThreadsRefresh(); return; }
      onHistoryCleared({ scoped: Array.isArray(frame.threadIds) });
      return;
    }
    if (frame.type === 'ask-command') {                         // #574: a command card's live state, this chat only
      if (frame.threadId !== st.threadId) return;
      // Only the card: the terminal pane is never opened or switched for Ask's command (its tab waits there).
      applyCommandFrame(frame.command);
      return;
    }
    if (frame.type === 'ask-scope') {                           // Projects, any way P4 (CONTRACT §4): a server-side switch
      // The open chat's pill follows it with no PATCH (the server stored it), so the next send keeps the new scope.
      if (frame.threadId === st.threadId && frame.scope && typeof frame.scope === 'object') {
        const label = typeof frame.label === 'string' && frame.label ? frame.label : null;
        st.scopeHeld = null;                                    // S39: the server's switch wins over a held pick
        setScope({ ...scopeFromContext(frame.scope), label }, { persist: false, focus: false });
        if (st.scope.pinned && !label) resolveScopeLabel();
      }
      return;
    }
    if (THREADS_REFRESH_FRAMES.has(frame.type)) scheduleThreadsRefresh();
    // A PR fix run's card landed, or its outcome did (ui/server.mjs askPrFixRun marks the frame unread), in a chat that
    // is not on screen: the Chat row's dot, as a finished reply lights it. Any chat of this person — worca posted it.
    if (frame.type === 'ask-message' && frame.unread === true && typeof frame.threadId === 'string'
      && (!st.open || frame.threadId !== st.threadId)) setUnread(true, frame.threadId);
    // The Chat row's dot (worca Chat): a reply in ANOTHER chat this tab asked in (the user switched chats before it
    // landed) ended while Chat was hidden. The open chat's own reply is afterFrame's.
    if ((frame.type === 'ask-done' || frame.type === 'ask-error') && !st.open && typeof frame.threadId === 'string'
      && frame.threadId !== st.threadId && st.askedIn.has(frame.threadId)) setUnread(true, frame.threadId);
    // A reply in a chat that is not open ended: its queue waits for the user (Resume queue) instead of sending unseen.
    if ((frame.type === 'ask-done' || frame.type === 'ask-error') && typeof frame.threadId === 'string' && frame.threadId !== st.threadId) {
      const q = queueOf(frame.threadId);
      if (q && q.items.length) q.paused = true;
    }
    // Defence-in-depth: the model's own threadId filter is the real router — this early return only saves an apply() call and cannot be observed from tests (the model would drop the frame identically).
    if (!st.model || frame.threadId !== st.threadId) return;
    const r = st.model.apply(frame);
    if (r && r.gap) { resync(); return; }
    if (!r || !r.ok) return;
    if (st.voice && st.voice.active() && frame.messageId) {
      const live = st.model && st.model.live();
      st.voice.onFrame(frame, live && live.messageId === frame.messageId ? live.text : null);
    }
    afterFrame(frame);
    scheduleFlush();
  }

  function subscribe(threadId, { force = false } = {}) {
    if (!threadId) return;
    if (!force && st.subscribedFor === threadId) return;
    st.subscribedFor = threadId;
    sendWs({ type: 'subscribe', threadId });
  }

  // Re-fetch + resubscribe (spec §10.8: a seq gap or a reconnect re-syncs over
  // REST — the ring buffer replay then re-plays from seq 1 and the model's seq
  // dedupe/adoption absorb it). loadThread itself re-subscribes (forced) when the
  // snapshot still shows a turn in flight. Latched: one resync at a time.
  function resync() {
    if (st.resyncing || !st.threadId || st.destroyed) return;
    // A switch is loading: its own load brings fresh state, and re-loading the chat being left would bump loadGen and
    // drop the switch (the page would keep the old chat while the address names the new one).
    if (typeof st.wantThread === 'string' && st.wantThread !== st.threadId) return;
    st.resyncing = true;
    const id = st.threadId;
    Promise.resolve()
      .then(() => loadThread(id))
      .catch(() => { /* the thread may be gone; loadThread handled storage */ })
      .then(() => {
        st.resyncing = false;
        if (st.resyncAgain) { st.resyncAgain = false; resync(); }   // abandonWant asked while this one was out
      });
  }

  function onHello(list) {
    if (st.destroyed || !Array.isArray(list)) return;
    st.subscribedFor = null; // a fresh socket forgot every prior subscribe
    // A fresh socket may have dropped out-of-turn frames for ANY thread (spec
    // §11: reconnect = re-subscribe + REST re-sync); re-sync whenever a thread
    // is active — the latch bounds it to one GET, and resync() re-subscribes
    // only when the snapshot still shows a turn in flight.
    if (st.threadId) resync();
  }

  function flushExtra() {
    if (!st.model) return;
    if (st.answerPending) { const pid = st.answerPending; st.answerPending = null; renderAnswerFor(pid); }
    if (st.rowPending) {
      const rid = st.rowPending;
      st.rowPending = null;
      const held = st.rowEls && st.rowEls.get(rid);
      if (held && hasSelectionInside(held)) { st.rowPending = rid; scheduleFlush(); }
      else { const row = rowOf(rid); if (row) refreshRow(row); }
    }
    const d = st.model.takeDirty();
    if (d.suggestion) updateSuggestion();
    if (d.title) el.title.textContent = st.model.thread().title || 'New chat';
    if (d.structure) {
      renderTranscript();
    } else {
      for (const id of d.messages) { const row = rowOf(id); if (row) refreshRow(row); }
      if (d.label && st.model.live()) {
        const liveId = st.model.live().messageId;
        const entry = st.rowEls && st.rowEls.get(liveId);
        // §10.8: a whole-row rebuild would destroy a live selection — defer it
        // exactly like a throttled answer render.
        if (entry && hasSelectionInside(entry)) { st.rowPending = liveId; scheduleFlush(); }
        else { const row = rowOf(liveId); if (row) refreshRow(row); }
      }
      for (const id of d.blocks.keys()) {
        if (d.messages.has(id)) continue;
        if (d.label && st.model.live() && st.model.live().messageId === id) continue; // already rebuilt
        const entry = st.rowEls && st.rowEls.get(id);
        if (st.model.live() && st.model.live().messageId === id && entry && hasSelectionInside(entry)) { st.rowPending = id; scheduleFlush(); continue; }
        const row = rowOf(id);
        if (row) refreshRow(row);
      }
      for (const id of d.answer) renderAnswerFor(id);
    }
    if (d.meters) updateMeters();
    if (d.worktrees) setWorktrees(st.model.worktrees());
    if (d.runLinks) st.runPoked = true;   // D13: a first `state` reveals the pipeline id; a resume moves the runId
    // An open popover that subscribed to this flush's dirt is rebuilt in place
    // (same node — never reopened, never refocused). Runs AFTER the mirror and
    // the meters above: the worktrees build() reads st.worktrees.
    const pop = st.popover;
    if (pop && typeof pop.refreshOn === 'function' && pop.refreshOn(d)) rebuildPopover(pop);
    updateLiveElapsed();
  }

  // ---- flush + scroll (minimal now; Task 5 extends via flushExtra) ---------
  function scheduleFlush() {
    if (st.flushArmed || st.destroyed) return;
    st.flushArmed = true;
    raf(() => { st.flushArmed = false; flush(); });
  }

  function flush() {
    if (st.destroyed) return;
    flushExtra();
    if (st.runPoked) repaintProgressCards();
    relayoutCards();
    if (st.open) void composerCards().sweep();   // a draft saved through its wizard is recorded saved
    if (st.open && describedGraphShowing()) void composerCards().describeGraphs();   // the graph wells' description footers
    applyPin();
    updateAddons();                                  // CONTRACT §2: every render hands the add-ons the open chat
    // A row counts as SHOWN once a flush ends with it in the column. Marking it
    // inside renderTranscript() would be too early: loadThread paints once and the
    // structural flush behind it repaints immediately, and the browser only ever
    // shows the second element — a freshly loaded thread would never rise in.
    if (st.rowEls) for (const id of st.rowEls.keys()) st.seenRows.add(id);
  }

  function updatePinFromScroll() {
    const t = el.transcript;
    // The scroll event of our OWN pin write (applyPin, jumpToLatest) can arrive after the column grew again (a card's
    // graph laying out): that is not the user leaving the bottom — stay pinned and follow. A user scroll up from
    // there reads below the written position and unpins as before.
    if (st.pinned && st.pinWrite != null && t.scrollTop >= st.pinWrite) {
      st.pinWrite = null;
      applyPin();
      return;
    }
    st.pinWrite = null;
    st.pinned = t.scrollHeight - t.scrollTop - t.clientHeight < 24;
    if (el.jump) el.jump.hidden = st.pinned;
  }

  function applyPin() {
    if (!st.open) return;
    if (st.pinned) {
      const t = el.transcript;
      // Only when the bottom has actually moved away. flush() runs this on EVERY
      // rAF of a stream, and an unconditional write re-snapped the scrollport on
      // each one — which is what turned a growing answer into a twitch.
      const max = t.scrollHeight - t.clientHeight;
      if (max > 0 && t.scrollTop < max) { t.scrollTop = t.scrollHeight; st.pinWrite = t.scrollTop; }
    }
    if (el.jump) el.jump.hidden = st.pinned;
  }

  /** A user toggle (an activity head, a command's output) opens or closes content below its control. The pin was
   *  written to follow a growing stream: pinned to the end, applyPin() (the next frame, the column's ResizeObserver)
   *  would follow the opened body and scroll the clicked control off the top. So the control keeps its place on
   *  screen, and the pin follows the new geometry, as after a user scroll: a body opened past the end leaves it,
   *  one closed back at the end pins again. */
  function keepInPlace(control, change) {
    const t = el.transcript;
    const before = control.getBoundingClientRect().top;
    change();
    const moved = control.getBoundingClientRect().top - before;
    if (moved) t.scrollTop += moved;
    st.pinWrite = null;
    st.pinned = t.scrollHeight - t.scrollTop - t.clientHeight < 24;
    if (el.jump) el.jump.hidden = st.pinned;
  }

  function jumpToLatest() {
    st.pinned = true;
    el.transcript.scrollTop = el.transcript.scrollHeight;
    st.pinWrite = el.transcript.scrollTop;
    if (el.jump) el.jump.hidden = true;
  }

  // ---- composer add-ons (worca Chat CONTRACT §2) ----------------------------
  /** Addon ctx.thread(): the open chat as plain data, or null before the chat has a row. */
  function threadSnapshot() {
    if (!st.model) return null;
    const t = st.model.thread() || {};
    return {
      ...t,
      id: st.threadId,
      live: !!st.model.live(),
      inFlight: !!st.model.inFlight(),
      messages: st.model.messages(),
      runLinks: [...st.model.runLinks()].map(([runId, l]) => ({ runId, ...l })),
    };
  }
  const addonCtx = {
    doc, fetch,
    threadId: () => st.threadId,
    thread: () => threadSnapshot(),
    runStore,
    setPlaceholder: (text) => { st.basePlaceholder = typeof text === 'string' && text ? text : INPUT_PLACEHOLDER; updateSuggestion(); },
    focus: () => focusComposer(),
    announce: (text) => announce(text),
  };
  function mountAddons() {
    for (const addon of composerAddons()) {
      try {
        const handle = addon.mount(el.lead, addonCtx);
        st.addons.push({ id: addon.id, handle: handle && typeof handle === 'object' ? handle : {} });
      } catch (err) { console.warn(`[worca] composer add-on "${addon.id}" failed to mount`, err); }
    }
  }
  function updateAddons() {
    if (!st.addons.length) return;
    const thread = threadSnapshot();
    for (const a of st.addons) {
      if (typeof a.handle.update !== 'function') continue;
      try { a.handle.update(thread); } catch (err) { console.warn(`[worca] composer add-on "${a.id}" update failed`, err); }
    }
  }
  /** Whether an add-on took the send, in registration order: true (clear the input), 'keep' (keep it), or false.
   *  Any other return, and a throwing hook, counts as not taken. */
  async function addonsTakeSend(text) {
    for (const a of st.addons) {
      if (typeof a.handle.beforeSend !== 'function') continue;
      let r = false;
      try { r = await a.handle.beforeSend(text); } catch (err) { console.warn(`[worca] composer add-on "${a.id}" beforeSend failed`, err); }
      if (r === true) return true;
      if (r === 'keep') return 'keep';
    }
    return false;
  }
  /** CONTRACT §2 (lead amendment): fold transformSend over the add-ons in registration order. A throw, a non-string
   *  or an empty result keeps the text it was given (the server refuses an empty message). */
  function addonsTransform(text) {
    let out = text;
    for (const a of st.addons) {
      if (typeof a.handle.transformSend !== 'function') continue;
      try {
        const next = a.handle.transformSend(out);
        if (typeof next === 'string' && next.trim()) out = next;
      } catch (err) { console.warn(`[worca] composer add-on "${a.id}" transformSend failed`, err); }
    }
    return out;
  }
  function destroyAddons() {
    for (const a of st.addons.splice(0)) {
      if (typeof a.handle.destroy === 'function') { try { a.handle.destroy(); } catch { /* a dead add-on never blocks teardown */ } }
    }
  }

  // ---- mount ----------------------------------------------------------------
  const root = buildRoot();
  mountAddons();
  doc.addEventListener('keydown', onDocKeydown, true);
  doc.addEventListener('pointerdown', onDocPointerdown, true);
  // A mode change (ui-level.mjs applyLevel) re-decides every activity toggle: a mode that hides the rows opens nothing.
  const onLevelChange = () => { if (st.rowEls) for (const entry of st.rowEls.values()) if (entry.relevel) entry.relevel(); };
  doc.addEventListener('worca:level', onLevelChange);
  win.addEventListener('resize', onWinResize);
  // MCP registry §9.4: in Auto the page is the scope, so a route change re-previews the picker.
  const onHashChange = () => { if (!st.scope.pinned) scheduleMcpRefresh(); };
  win.addEventListener('hashchange', onHashChange);
  // The rail, the history column and the run panel change the conversation column's width with no window
  // resize; observe the column itself (guarded: jsdom has no ResizeObserver — P5's idiom). The transcript column
  // too: a card that grows after the flush that pinned it (a graph laying out, P3's card answering the run store)
  // must not leave a pinned transcript short of the bottom.
  let dockRo = null;
  // The docked composer floats over the transcript (style.css .chat-dock): its height is the transcript's bottom
  // clearance, re-read whenever a draft, a chip row or an attachment grows or shrinks it.
  let clearRo = null;
  if (typeof win.ResizeObserver === 'function') {
    dockRo = new win.ResizeObserver(onWinResize);
    dockRo.observe(el.sheet);
    dockRo.observe(el.transcriptCol);
    clearRo = new win.ResizeObserver(paintDockClearance);
    clearRo.observe(el.chatDock);
  }
  function paintDockClearance() {
    if (st.destroyed) return;
    const h = el.chatDock.offsetHeight;
    if (h > 0) { el.sheet.style.setProperty('--chat-dock-h', `${h}px`); applyPin(); }   // 0: home hides the dock
  }

  function destroy() {
    if (st.destroyed) return;
    st.destroyed = true;
    closePopover({ focusTrigger: false });
    if (st.threadsRefresh) { clearTimeout(st.threadsRefresh); st.threadsRefresh = null; }
    if (st.historySearchTimer) { clearTimeout(st.historySearchTimer); st.historySearchTimer = null; }
    if (st.elapsedTimer) { clearInterval(st.elapsedTimer); st.elapsedTimer = null; }
    orbs.destroy();
    doc.removeEventListener('keydown', onDocKeydown, true);
    doc.removeEventListener('pointerdown', onDocPointerdown, true);
    doc.removeEventListener('worca:level', onLevelChange);
    win.removeEventListener('resize', onWinResize);
    win.removeEventListener('hashchange', onHashChange);
    if (dockRo) { dockRo.disconnect(); dockRo = null; }
    if (clearRo) { clearRo.disconnect(); clearRo = null; }
    if (el.scopeRo) { el.scopeRo.disconnect(); el.scopeRo = null; }
    if (st.runTick) { clearInterval(st.runTick); st.runTick = null; }
    if (st.runUnsub) { try { st.runUnsub(); } catch { /* ignore */ } st.runUnsub = null; }
    refChips.destroy();
    pruneCardEls();                                  // every card graph mount and its ResizeObserver goes with the sheet
    destroyAddons();
    st.queues.clear();
    clearTimeout(st.voiceLongPress);
    if (st.voice) { const v = st.voice; st.voice = null; Promise.resolve(v.destroy()).catch(() => {}); }
    root.remove();
  }

  return Object.freeze({
    root,
    open: openPage,
    close: closePage,
    isOpen: () => st.open,
    threadId: () => (typeof st.wantThread === 'string' ? st.wantThread : st.threadId) || null,
    setHistoryOpen: (open, opts) => setHistoryOpen(open, opts),
    unreadThreadId: () => (st.unread ? st.unreadThread : null),
    contextChanged: () => onHashChange(),           // P4: the run panel's run changed with no hashchange (replaceState)
    appendToComposer,
    setQuote,
    sendQuoted,
    pushServerFrame,
    onHello,
    ownsKey,
    setScope: (scope) => setScopeFromApi(scope),
    optionsChanged: () => { st.cardOptions = null; },   // projects-changed / workspaces-changed: the next read refetches
    destroy,
  });
}
