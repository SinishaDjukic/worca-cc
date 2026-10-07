// ui/public/ask-panel.mjs — the Ask Worca floating sheet (spec §10). One
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
import { createThinkingOrb } from './thinking-orb.mjs';
import { workflowPickerLabel } from './results-view.mjs';
import { renderAutoProposal, AUTO_PROPOSAL_ORDER_CARD } from './auto-proposal.mjs';
import { createRunProgressCard, snapshotFromState, PROGRESS_CARD_TYPE } from './ask-run-card.mjs';
import { createCommandCard, COMMAND_CARD_TYPE } from './ask-command-card.mjs';
import { buildTrace, scheduleTrace, playAssembly } from './auto-build.mjs';
import { buildNodeConfigRows, pruneNodeSelection, modifiedFieldsOf } from './node-tunables.mjs';
import { classifyLoops } from '../../src/shared/graph/loops.mjs';
import { portsFnFor } from '../../src/shared/graph/ports.mjs';
import { parseMcpToolName } from '../../src/shared/mcp-tool-name.mjs';
import { mcpSkipView, mcpCopyNote, skillSkipView } from './mcp-run-picker.mjs';
import { notify } from './feedback.mjs';

/**
 * Cold-start pick, used ONLY until GET /api/ask/models resolves — and afterwards
 * only if that payload carries no `default` (older stubs / a 500). The authoritative
 * default is ASK_LIMITS.defaultModel/defaultEffort, shipped as `catalog.default`
 * and already validated against the live catalog by src/core/ask/models.mjs.
 */
const FALLBACK_PICK = Object.freeze({ model: 'claude-opus-5-5', effort: 'high' });

const ICONS = {
  threads: 'M4 6h16M4 12h16M4 18h9',
  plus: 'M12 5v14M5 12h14',
  chevronDown: 'M6 9l6 6 6-6',
  send: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  mic: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z', 'M19 11a7 7 0 0 1-14 0', 'M12 18v3'],
  voiceTalk: ['M7.9 20A9 9 0 1 0 4 16.1L2 22z', 'M8 10h8M8 14h5'],           // chat bubble with text lines: speak in, read the reply
  voiceHandsFree: ['M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4'],               // waveform: a live conversation
  pin: ['M12 17v5', 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'],
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

export function fmtTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1000 ? `${n} tok` : `${(n / 1000).toFixed(1)}k tok`;
}
/** Context window meter (docs: Claude Code compacts about 33k short of the window — 967k of 1M). */
export const CTX_COMPACT_BUFFER = 33000;
export const CTX_WARN = 0.75;          // amber, as a share of the compaction trigger
export const CTX_HIGH = 0.9;           // red: compaction soon
export const CTX_COST_HINT = 200000;   // from here the hover notes every message re-sends the whole context
const validWindow = (w) => Number.isInteger(w) && w > 0;
const kTok = (n) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

/** 1000000 → "1M", 1500000 → "1.5M", 200000 → "200k"; null for an unknown window. */
export function fmtWindow(w) {
  if (!validWindow(w)) return null;
  if (w >= 1e6) return `${+(w / 1e6).toFixed(1)}M`;
  if (w >= 1000) return `${+(w / 1000).toFixed(1)}k`;
  return String(w);
}
/** Where automatic compaction starts: window − buffer (the window itself when it is too small for one). */
export function ctxTrigger(w) {
  if (!validWindow(w)) return null;
  return w > 2 * CTX_COMPACT_BUFFER ? w - CTX_COMPACT_BUFFER : w;
}
export function ctxLevel(ctx, w) {
  const t = ctxTrigger(w);
  if (!t || !Number.isFinite(ctx) || ctx <= 0) return null;
  const r = ctx / t;
  return r >= CTX_HIGH ? 'high' : r >= CTX_WARN ? 'warn' : 'ok';
}
/** Share of the FULL window (Claude's own meter does the same); not clamped — a model switch can pass 100. */
export function ctxPercent(ctx, w) {
  return validWindow(w) && Number.isFinite(ctx) && ctx > 0 ? Math.round((ctx / w) * 100) : null;
}
/** Context fill (usage.ctx / totals.ctx) — a snapshot, never a cumulative sum — against the window when known. */
export function fmtCtx(n, w) {
  if (!Number.isFinite(n) || n <= 0) return null;
  const win = fmtWindow(w);
  return win ? `${kTok(n)} / ${win} ctx` : `${kTok(n)} ctx`;
}
/** The meter's hover text, or null when there is nothing worth saying. */
export function ctxTitle(ctx, w) {
  if (!Number.isFinite(ctx) || ctx <= 0) return null;
  const parts = [];
  const pct = ctxPercent(ctx, w);
  if (pct != null) {
    if (ctxLevel(ctx, w) === 'high') parts.push('Compaction soon.');
    parts.push(`${pct}% of the ${fmtWindow(w)} context window. Automatic compaction starts around ${fmtWindow(ctxTrigger(w))}.`);
  }
  if (ctx >= CTX_COST_HINT) parts.push(`Each message re-sends about ${(ctx / 1000).toFixed(1)}k tokens.`);
  return parts.length ? parts.join(' ') : null;
}
/** Share of the window with one decimal, as the popover's rows show it: 120400 of 1M → "12.0%". */
export function fmtShare(n, w) {
  return validWindow(w) && Number.isFinite(n) && n >= 0 ? `${((n / w) * 100).toFixed(1)}%` : null;
}
/** The context popover's figures, or null without a known window and fill. Only what Worca knows:
 *  the fill, the window and the documented compaction buffer — never a per-category split. */
export function ctxBreakdown(ctx, w) {
  if (!validWindow(w) || !Number.isFinite(ctx) || ctx <= 0) return null;
  const trigger = ctxTrigger(w);
  const buffer = w - trigger;
  return {
    used: ctx, buffer, free: Math.max(0, w - ctx - buffer), untilCompact: Math.max(0, trigger - ctx),
    pct: ctxPercent(ctx, w), level: ctxLevel(ctx, w),
  };
}
const validContexts = (list) => (Array.isArray(list) ? list : [])
  .filter((c) => c && typeof c.kind === 'string' && typeof c.id === 'string' && c.id);
/** A chat's topics split for the popover: where it was asked from (page) and what it mentioned (source 'chat'). */
export function groupContexts(list) {
  const all = validContexts(list);
  return { asked: all.filter((c) => c.source !== 'chat'), mentioned: all.filter((c) => c.source === 'chat') };
}
export function fmtUsd(x) {
  return Number.isFinite(x) ? `$${x.toFixed(2)}` : null;
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
function clipInput(input) {
  if (input && input._truncated === true) return String(input.preview ?? '');
  if (input == null) return '';
  let s = '';
  try { s = JSON.stringify(input); } catch { s = String(input); }
  if (s === '{}') return '';
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

const SCRIPT_TOOL_NAMES = new Set(['list_scripts', 'get_script', 'save_script', 'test_script']);

/**
 * The script tools' thread line (scripts-workbench-design.md §9.3): the key instead of a JSON
 * blob, plus what came back once the call finished. `block.script` is stamped by the reducer
 * (events.mjs#scriptToolKey at the call, #scriptResultNote at the result) and persisted with the
 * block, so the line survives a reload and a clipped input. null for every other tool — those
 * keep the op / target / preview shape.
 * @returns {{target: string}|null}  e.g. { target: 'script runTests → blocking, exit 1' }
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
  const noun = short.split('_').slice(1).join(' ');
  return { target: [noun, key, bits.length ? `→ ${bits.join(', ')}` : ''].filter(Boolean).join(' ') };
}

/** The launcher's shortcut hint: the keydown handler accepts BOTH Meta+K and
 *  Ctrl+K, but the glyph shown must match the viewer's OS — '⌘K' is meaningless
 *  on Windows/Linux, where the working chord is Ctrl+K. */
export function shortcutLabel(win) {
  const nav = win?.navigator;
  const platform = String(nav?.userAgentData?.platform || nav?.platform || '');
  return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘K' : 'Ctrl K';
}

/**
 * Sheet geometry shared with style.css: .ask-dock{padding:0 28px 26px} and
 * .ask-sheet{width:min(821px,100%);height:min(669px,calc(100% - 20px))}. The
 * user's size is clamped to [minW×minH, dock inner box]. The floor IS the
 * stylesheet default: the sheet grows from what it always was and never shrinks
 * below it, so every layout the fixed-size sheet was designed around (the
 * non-wrapping composer row, the popovers written in 100vh terms) still holds.
 * Border-box px throughout — the sheet has no padding.
 */
export const ASK_SHEET_SIZE = Object.freeze({
  defaultW: 821, defaultH: 669,
  minW: 821, minH: 669,
  dockPadX: 28, dockPadBottom: 26, topGap: 20,
});
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

const SIZE_KEY = 'worca-cc.ask.size';
/** Out-of-turn / other-thread frames that can move a History row's dots: a run a
 *  chat follows changed (tracking) or a turn started/ended there (thinking). */
const THREADS_REFRESH_FRAMES = new Set(['ask-run-status', 'ask-start', 'ask-done', 'ask-error']);
const THREADS_REFRESH_MS = 250;
/** History search debounce: one /api/ask/threads?q= per typing burst. */
export const ASK_HISTORY_SEARCH_MS = 180;
/** The pill's mark ↔ orb morph: the canvas tween (thinking-orb morphTo) runs on
 *  the same clocks as the CSS transitions on the two layers — .52s in, .8s out
 *  (style.css .ask-pill-mark rules). The settle fallback outlives the fade-out,
 *  for the case the transitionend never arrives. */
const PILL_MORPH_IN_MS = 520;
const PILL_MORPH_OUT_MS = 800;
const PILL_SETTLE_FALLBACK_MS = PILL_MORPH_OUT_MS + 150;
const PILL_NAME = 'Ask Worca';
const PILL_NAME_UNREAD = 'Ask Worca, new reply';
/** Hover has to rest on the button this long before its tooltip shows. */
const PILL_TIP_DELAY_MS = 400;

export function createAskPanel({ doc, win, fetch, sendWs, confirm, getPageContext, openNewPipeline, openComposer = null, showTerminal = () => {}, openClaudeSetup = null, loadMarkdown, hljsLoader, storage, raf, now, runStore = null, createVoice = null, voiceLongPressMs = 500 }) {
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
    catalog: null,
    // #397: the thread's project/workspace scope. pinned:false = Auto (follow the
    // page — today's behaviour). label caches the display name once resolved.
    scope: { pinned: false, projectKey: null, workspaceId: null, label: null },
    popover: null,            // {panel, trigger, onClose, build, refreshOn, refresh}
    contexts: [],             // the open chat's topics (thread.contexts), shown in the context popover
    threadsRefresh: null,     // the debounce timer behind the History popover's ask-run-status refetch
    expandedAgents: new Set(),
    worktrees: [],            // P4 §10: the chat's open worktrees (snapshot-fed)
    // MCP registry §9.4: the chat's picker choices (held here, sent with every message, PATCHed between turns),
    // the last POST /api/ask/mcp-preview body and whether it failed; gen drops a stale response, render repaints
    // an open picker, saving chains the PATCHes so they land in toggle order.
    mcp: { off: { sets: [], members: [] }, preview: null, failed: false, gen: 0, queued: false, render: null, saving: Promise.resolve() },
    // Agent mode (#574): the chat's switch (sent with every message, PATCHed like mcpOff); `available` comes from
    // GET /api/ask/commands/status once at first open — false hides the switch and nothing is sent.
    agent: { on: true, saving: Promise.resolve(), available: false },
    commands: new Map(),      // blockId → command card handle (ask-command-card.mjs)
    commandFrames: new Map(), // blockId → the last ask-command view that arrived before its card was built
    commandsShown: new Set(), // blockIds whose start already showed their terminal tab (shared terminal)
    pinned: true,
    prevFocus: null,
    size: readStoredSize(),   // {w,h} the user's persisted sheet size (hoisted reader); null = stylesheet default
    applied: null,            // {w,h} the inline size currently on the sheet (clamped); null = default
    drag: null,               // the active resize gesture — see startResize()
    pendingFiles: [],
    sending: false,
    subscribedFor: null,
    elapsedTimer: null,
    elapsedStart: null,
    pillOrbLive: false,       // what the pill orb was last told — see syncPillOrb()
    pillOrbSettle: null,      // the morph-back's fallback timer, while one runs
    flushArmed: false,
    resyncing: false,
    firstOpenDone: false,
    destroyed: false,
    voice: null,              // the voice controller (ask-voice.mjs), made on first mic use — docs/speech.md
    voicePendingSend: false,  // a hands-free transcript waiting for the live turn to end (barge-in)
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
  };
  const el = {}; // element refs, filled by the builders
  const renderer = createMarkdownRenderer({ doc, load: loadMarkdown, hljsLoader });

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
  /** The persisted sheet size, or null when nothing usable is stored. Clamped later, against a live dock. */
  function readStoredSize() {
    try {
      const raw = storage.getItem(SIZE_KEY);
      const v = raw ? JSON.parse(raw) : null;
      if (v && Number.isFinite(v.w) && Number.isFinite(v.h)) return { w: Math.round(v.w), h: Math.round(v.h) };
    } catch { /* storage unavailable */ }
    return null;
  }
  function storeSize(size) {
    try {
      if (size) storage.setItem(SIZE_KEY, JSON.stringify({ w: size.w, h: size.h }));
      else storage.removeItem(SIZE_KEY);
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
    b.appendChild(svgIcon(icon));
    b.addEventListener('click', onClick);
    return b;
  }

  // ---- shell ----------------------------------------------------------------
  function buildRoot() {
    const dock = make('div', 'ask-dock');

    const pill = make('button', 'ask-pill');
    pill.type = 'button';
    pill.setAttribute('aria-label', PILL_NAME);
    // The mark slot: the masked logo and the pill's OWN thinking orb stacked in
    // one 26px host (a CSS mask clips children, so the orb cannot live under
    // the masked span). Both exist from birth — .is-live morphs one into the
    // other in CSS and syncPillOrb() runs the canvas only while there is
    // something to paint. Its own instance on purpose: the transcript's orb
    // (ensureThinking) is re-parented into each live row and cannot be shared.
    const mark = make('span', 'ask-pill-mark');
    mark.setAttribute('aria-hidden', 'true');
    const pillLogo = make('span', 'ask-pill-logo');
    pillLogo.setAttribute('aria-hidden', 'true');
    mark.appendChild(pillLogo);
    el.pillOrb = createThinkingOrb({ doc, win, size: 26 });
    el.pillOrb.stop();                 // the factory arms its loop; nothing is lit yet
    el.pillOrb.morphTo(0, 0);          // the dots wait on the centre for the first morph-in
    // The morph-back ends when the orb layer's opacity fade does (the transform
    // fade shares the clock, so one of the two is enough); a late event from a
    // fade that a new turn aborted must not cut a live loop — hence the guard.
    el.pillOrb.el.addEventListener('transitionend', (e) => {
      if (e.target === el.pillOrb.el && e.propertyName === 'opacity' && !st.pillOrbLive) settlePillOrb();
    });
    mark.appendChild(el.pillOrb.el);
    pill.appendChild(mark);
    pill.appendChild(make('span', 'ask-pill-label', 'Ask Worca'));
    pill.addEventListener('click', openSheet);

    // The tooltip is a sibling of the button (a button's face holds no other widget); style.css .ask-tip
    // places it to the left. aria-describedby gives assistive tech the shortcut the face no longer shows.
    const tip = make('div', 'ask-tip');
    tip.id = 'ask-pill-tip';
    tip.setAttribute('role', 'tooltip');
    tip.appendChild(make('span', null, 'Ask Worca'));
    tip.appendChild(make('span', 'ask-kbd', shortcutLabel(win)));
    pill.setAttribute('aria-describedby', tip.id);
    pill.addEventListener('pointerenter', () => {
      clearTipTimer();
      st.tipTimer = setTimeout(showTip, PILL_TIP_DELAY_MS);
      if (st.tipTimer && typeof st.tipTimer.unref === 'function') st.tipTimer.unref();
    });
    pill.addEventListener('pointerleave', hideTip);
    pill.addEventListener('blur', hideTip);
    pill.addEventListener('focus', () => {
      // A mouse click focuses the button too; only keyboard focus earns the tooltip at once.
      let visible = true;
      try { visible = pill.matches(':focus-visible'); } catch { /* no :focus-visible: treat as keyboard */ }
      if (visible) showTip();
    });

    const sheet = make('section', 'ask-sheet');
    sheet.hidden = true;
    sheet.setAttribute('data-ask-sheet', '');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Ask Worca');

    const header = make('header', 'ask-header');
    const logo = make('span', 'ask-header-logo');
    logo.setAttribute('aria-hidden', 'true');
    header.appendChild(logo);
    el.title = make('div', 'ask-title', 'Ask Worca');
    // Header is logo → title → spacer → icon buttons. The #397 scope selector
    // used to sit here; it now lives in the composer's bottom row next to the
    // "+" attach button (see buildComposer). A long haiku title still ellipsizes.
    header.appendChild(el.title);
    header.appendChild(make('span', 'ask-header-spacer'));
    const threadsBtn = iconButton('ask-icon-btn', 'History', ICONS.threads, () => toggleThreadsPopover(threadsBtn));
    threadsBtn.setAttribute('data-ask-threads-btn', '');
    header.appendChild(threadsBtn);
    const newBtn = iconButton('ask-icon-btn', 'New chat', ICONS.plus, () => newThread());
    newBtn.setAttribute('data-ask-new-btn', '');
    header.appendChild(newBtn);
    header.appendChild(iconButton('ask-icon-btn', 'Close', ICONS.chevronDown, closeSheet));
    sheet.appendChild(header);

    el.transcript = make('div', 'ask-transcript');
    el.transcript.setAttribute('data-ask-scroll', '');
    el.transcript.addEventListener('scroll', updatePinFromScroll);
    // The transcript is only the scrollport; every row lands in this column,
    // which style.css caps (--ask-col-max) and centres once the sheet is
    // dragged wider than the cap. Scroll/pin logic keeps reading el.transcript.
    el.transcriptCol = make('div', 'ask-transcript-col');
    el.transcript.appendChild(el.transcriptCol);
    sheet.appendChild(el.transcript);

    sheet.appendChild(buildComposer());

    el.live = make('div', 'sr-only');
    el.live.setAttribute('aria-live', 'polite');
    sheet.appendChild(el.live);

    el.jump = make('button', 'ask-jump');
    el.jump.type = 'button';
    el.jump.appendChild(svgIcon(ICONS.down, 12, 2.2));
    el.jump.appendChild(make('span', null, 'Jump to latest'));
    el.jump.hidden = true;
    el.jump.addEventListener('click', jumpToLatest);
    sheet.appendChild(el.jump);
    for (const edge of ['n', 'e', 'w', 'ne', 'nw']) sheet.appendChild(buildResizeHandle(edge));
    sheet.appendChild(buildDropTarget(sheet));
    dock.appendChild(sheet);
    dock.appendChild(pill);
    dock.appendChild(tip);
    el.pill = pill;
    el.tip = tip;
    el.sheet = sheet;
    el.dock = dock;           // measured by dockInner(); `root` is TDZ here
    return dock;
  }

  // Mirrors src/core/ask/attachment-kind.mjs + limits.mjs (#398): text kinds are
  // UTF-8 capped at 512 KB, binary kinds (images + PDF) at 32 MB, 48 MB per message; the server
  // re-validates everything, these are just early clear messages.
  const ASK_ATTACH_EXT = ['.md', '.markdown', '.txt', '.json', '.csv', '.log', '.html', '.htm'];
  const ASK_ATTACH_BINARY = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
  };
  const ASK_MAX_TEXT_BYTES = 524_288;
  const ASK_MAX_BINARY_BYTES = 32 * 1024 * 1024;
  const ASK_MAX_MESSAGE_BYTES = 48 * 1024 * 1024;

  function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return win.btoa(bin);
  }

  function setComposerMsg(text) {
    el.composerMsg.textContent = text || '';
    el.composerMsg.hidden = !text;
  }

  function renderChips() {
    el.chips.replaceChildren();
    el.chips.hidden = !st.pendingFiles.length;
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
      const x = make('button', 'ask-chip-x', '×');
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

  async function addFiles(fileList) {
    for (const f of [...(fileList || [])]) {
      const name = String(f.name || '');
      const dot = name.lastIndexOf('.');
      const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
      const binMime = ASK_ATTACH_BINARY[ext];
      if (!ASK_ATTACH_EXT.includes(ext) && !binMime) { setComposerMsg(`attachment type not allowed: ${name}`); continue; }
      const cap = binMime ? ASK_MAX_BINARY_BYTES : ASK_MAX_TEXT_BYTES;
      if (f.size > cap) { setComposerMsg(`attachment over ${cap} bytes: ${name}`); continue; }
      const others = st.pendingFiles.filter((p) => p.name !== name); // dedupe by name, newest wins
      if (others.length >= 8) { setComposerMsg('at most 8 attachments per message'); continue; }
      const pendingBytes = others.reduce((n, p) => n + p.bytes, 0);
      if (pendingBytes + f.size > ASK_MAX_MESSAGE_BYTES) { setComposerMsg(`attachments over ${ASK_MAX_MESSAGE_BYTES} bytes per message`); continue; }
      let dataBase64 = '';
      try {
        dataBase64 = bytesToBase64(new Uint8Array(await f.arrayBuffer()));
      } catch { setComposerMsg(`could not read ${name}`); continue; }
      const attKind = binMime ? (binMime.startsWith('image/') ? 'image' : 'binary') : 'text';
      st.pendingFiles = [...others, { name, bytes: f.size, dataBase64, attKind, mime: binMime || null }];
    }
    renderChips();
  }

  // Drag-and-drop and paste feed the same addFiles() as the "+" button: no
  // validation of their own. Only drags that carry files are touched, so text
  // and element drags (widgets-input.mjs list reordering) keep their defaults.
  const carriesFiles = (dt) => !!dt && Array.from(dt.types || []).includes('Files');

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

  // A clipboard image is named "image.png" (or nothing) by the browser: every
  // paste would then replace the last one through addFiles' name dedupe. Such
  // files get a unique "pasted-<timestamp>.<ext>"; real copied files keep theirs.
  // A nameless file of an unlisted non-text type gets no extension, so addFiles
  // rejects it like the "+" button would.
  let lastPasteStamp = 0;
  function namePastedFiles(files) {
    return [...files].map((f) => {
      const name = String(f.name || '');
      if (name && !/^image\.[a-z0-9]+$/i.test(name)) return f;
      const dot = name.lastIndexOf('.');
      const type = String(f.type || '');
      const ext = dot >= 0 ? name.slice(dot).toLowerCase()
        : (Object.keys(ASK_ATTACH_BINARY).find((k) => ASK_ATTACH_BINARY[k] === type)
          || (type.startsWith('text/') ? '.txt' : ''));
      lastPasteStamp = Math.max(Date.now(), lastPasteStamp + 1);
      return new win.File([f], `pasted-${lastPasteStamp}${ext}`, { type: f.type });
    });
  }

  function onComposerPaste(e) {
    const cd = e.clipboardData;
    if (!cd || !cd.files || !cd.files.length) return; // a text paste goes ahead natively
    // Excel/Word/browser copies carry the text plus a rendered image of it: the
    // text is what was meant. Screenshots (no text) and real files still attach.
    const text = typeof cd.getData === 'function' ? cd.getData('text/plain') : '';
    if (text && [...cd.files].every((f) => String(f.type || '').startsWith('image/'))) return;
    e.preventDefault();
    addFiles(namePastedFiles(cd.files));
  }

  function updateSendStop() {
    if (!el.send) return;
    const streaming = !!(st.model && st.model.live());
    el.send.hidden = streaming;
    el.stop.hidden = !streaming;
    // The collapsed launcher pill mirrors "Ask Worca is working": a live turn, a
    // snapshot that reports one in flight (load() nulls live until a frame is
    // adopted, so Stop alone would stay dark on a collapsed reload), or the
    // POST→ask-start window (st.sending). The thinking ring and the mark↔orb
    // morph are pure CSS on this class (.ask-pill.is-live::before and
    // .ask-pill.is-live .ask-pill-mark), so a boundary costs one classList
    // write plus syncPillOrb() — local rAF bookkeeping for the pill's canvas,
    // idle when nothing changed. Keep every OTHER side effect out of here, see
    // afterFrame()'s refreshWorktrees() note.
    const inFlight = !!(st.model && st.model.inFlight && st.model.inFlight());
    if (el.pill) { el.pill.classList.toggle('is-live', streaming || inFlight || !!st.sending); syncPillOrb(); }
  }

  /**
   * The pill's mark ↔ orb morph, canvas half. CSS cross-fades and scales the
   * two layers off .is-live; this runs the orb's rAF loop only while there is
   * something to paint — live AND the pill visible — and drives the canvas
   * tween (dots grow out of the centre on lighting, sink back on rest) on the
   * same clocks. Hidden behind the open sheet the layers snap (display:none
   * skips transitions), so the factor snaps with them: nothing replays when
   * closeSheet() shows the pill again. The morph-back keeps painting until the
   * opacity transitionend (fallback: a timer), then the loop is cut.
   */
  function syncPillOrb() {
    if (!el.pillOrb) return;
    const live = el.pill.classList.contains('is-live');
    if (live !== st.pillOrbLive) {
      st.pillOrbLive = live;
      clearPillOrbSettle();
      el.pillOrb.morphTo(live ? 1 : 0, el.pill.hidden ? 0 : (live ? PILL_MORPH_IN_MS : PILL_MORPH_OUT_MS));
      if (!live && !el.pill.hidden) {
        st.pillOrbSettle = setTimeout(settlePillOrb, PILL_SETTLE_FALLBACK_MS);
        if (st.pillOrbSettle && typeof st.pillOrbSettle.unref === 'function') st.pillOrbSettle.unref();
      }
    }
    if (!el.pill.hidden && (live || st.pillOrbSettle)) el.pillOrb.start();
    else settlePillOrb();
  }
  function clearPillOrbSettle() {
    if (st.pillOrbSettle) { clearTimeout(st.pillOrbSettle); st.pillOrbSettle = null; }
  }
  function settlePillOrb() {
    clearPillOrbSettle();
    if (el.pillOrb) el.pillOrb.stop();
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

    el.mic = make('button', 'ask-voice-mic');
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

    const caret = make('button', 'ask-voice-caret');
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
        if (mode === current) it.appendChild(make('span', 'ask-model-check', '✓'));
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
        onBargeIn: () => { if (st.model && st.model.live()) stopTurn(); },
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
  function stopVoice() { st.voicePendingSend = false; if (st.voice && st.voice.active()) st.voice.stop(); }

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
    if (state === 'error') { setComposerMsg(detail || 'voice stopped'); st.voicePendingSend = false; }
    if (state === 'listening' || state === 'speaking' || state === 'error') announce(VOICE_LABELS[state]);
    if (state === 'listening' && !voiceUsedBefore()) { try { storage.setItem(VOICE_USED_KEY, '1'); } catch { /* preload is a nicety */ } }
  }

  function voiceTranscript(text, { autoSend } = {}) {
    const cur = el.input.value;
    el.input.value = cur && !/\s$/.test(cur) ? `${cur} ${text}` : `${cur}${text}`;
    fitInput();                                   // a programmatic write fires no input event
    if (!autoSend) { focusComposer(); return; }
    // A live (or loaded-but-not-yet-adopted, inFlight) turn: send once it ends. This covers barge-in.
    if (st.sending || (st.model && (st.model.live() || st.model.inFlight()))) { st.voicePendingSend = true; return; }
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

  async function sendMessage() {
    if (st.sending || st.destroyed) return false;
    if (st.model && st.model.live()) return false; // a turn is streaming — the stop button is showing
    const text = el.input.value.trim();
    if (!text) return false;
    st.sending = true;
    setComposerMsg(null);
    updateSendStop();      // the pill lights the moment the user sends; Send/Stop do not move (nothing streams yet)
    try {
      let id = st.threadId;
      if (!id) {
        let r = null;
        try {
          r = await fetch('/api/ask/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        } catch { r = null; }
        if (!r || (r.status !== 201 && !r.ok)) { setComposerMsg('could not create the thread'); return false; }
        const body = await r.json();
        id = body.thread.id;
        loadGen += 1;                     // a pending loadThread() must not replace this fresh model
        st.threadId = id;
        st.model = createThreadModel({ threadId: id });
        st.model.load({ thread: body.thread, messages: [], attachments: [], runLinks: [], inFlight: null });
        setContexts(body.thread && body.thread.contexts);
        renderTranscript();
        storeThread(id);
      }
      const sentOff = st.mcp.off;
      const sentAgent = st.agent.on;
      const payload = {
        text,
        model: st.picker.model,
        effort: st.picker.effort,
        // The browser's zone rides along: "tomorrow 02:00" is read in it (docs/scheduled-runs.md "Ask Worca").
        context: { ...scopedContext(getPageContext() || {}), timeZone: browserTimeZone() },
        // MCP registry §9.4: every message carries the picker's choices, so each turn runs what the picker shows —
        // a refused first message (429/403/400, network) or a PATCH still in flight would leave the stored ones behind.
        mcpOff: sentOff,
        // Agent mode (#574): like mcpOff, every message carries the switch (only where agent mode exists).
        ...(st.agent.available ? { agentMode: sentAgent } : {}),
        ...(st.pendingFiles.length ? { attachments: st.pendingFiles.map((f) => ({ name: f.name, dataBase64: f.dataBase64 })) } : {}),
      };
      const model = st.model;
      let res = null;
      try {
        res = await fetch(`/api/ask/threads/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } catch { setComposerMsg('network error — the message was not sent'); return false; }
      // The user may have clicked New chat or switched threads during the POST: the
      // message is on the server and arrives with its thread; touching the composer
      // or the (now different or null) model here would be wrong (review of PR #376).
      if (st.destroyed || st.model !== model || st.threadId !== id) return false;
      if (!res || res.status !== 202) {
        let msg = `request failed (${res ? res.status : 'network'})`;
        try { const b = await res.json(); if (b && b.error) msg = b.error; } catch { /* keep the fallback */ }
        setComposerMsg(msg);
        return false;
      }
      // A toggle made while this POST was out PATCHed a value the route then overwrote with sentOff: re-send the latest.
      if (st.mcp.off !== sentOff) patchMcpOff(id, st.mcp.off);
      if (st.agent.available && st.agent.on !== sentAgent) patchAgentMode(id, st.agent.on);
      const { userMessageId, attachments: stored, contexts } = await res.json();
      if (Array.isArray(contexts)) setContexts(contexts);   // an older server omits it: keep what is shown
      // Prefer the server's rows: they carry the store-minted ids that key the
      // image thumbnail (#398) and the thread's attachment ledger. The pending
      // files are the fallback for a server that predates the field.
      const echoAtts = Array.isArray(stored)
        ? stored.map((a) => ({ id: a.id, name: a.name, bytes: a.bytes, attKind: a.kind ?? 'text', mime: a.mime ?? null }))
        : st.pendingFiles.map((f) => ({ name: f.name, bytes: f.bytes, attKind: f.attKind, mime: f.mime }));
      st.model.noteLocalUserMessage({ id: userMessageId, text, attachments: echoAtts });
      // No provisional title from the prompt: the header keeps "Ask Worca" until
      // the ask-title frame lands (ask-model marks title dirty, flushExtra repaints).
      el.input.value = '';
      fitInput();                                    // a programmatic clear fires no input event
      st.pendingFiles = [];
      renderChips();
      subscribe(id);
      st.pinned = true;
      scheduleFlush();
      return true;
    } finally {
      st.sending = false;
      updateSendStop();
    }
  }

  function buildComposer() {
    const wrap = make('div', 'ask-composer');
    // The band is the padded outer strip; the rounded, bordered box inside it
    // holds chips → textarea → msg → row and shares the transcript column's cap
    // (style.css .ask-composer-box), so both centre together in a wide sheet.
    const box = make('div', 'ask-composer-box');
    el.composerBox = box;
    wrap.appendChild(box);

    el.chips = make('div', 'ask-chips');
    el.chips.hidden = true;
    box.appendChild(el.chips);

    el.input = doc.createElement('textarea');
    el.input.className = 'ask-input';
    el.input.rows = 1;
    el.input.placeholder = 'Ask about any run, agent, or project…';
    el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
    });
    el.input.addEventListener('input', fitInput);
    el.input.addEventListener('paste', onComposerPaste);
    box.appendChild(el.input);

    el.composerMsg = make('div', 'ask-composer-msg');
    el.composerMsg.hidden = true;
    box.appendChild(el.composerMsg);

    const row = make('div', 'ask-composer-row');

    el.fileInput = doc.createElement('input');
    el.fileInput.type = 'file';
    el.fileInput.multiple = true;
    el.fileInput.accept = `${ASK_ATTACH_EXT.join(',')},${Object.keys(ASK_ATTACH_BINARY).join(',')},text/*`;
    el.fileInput.hidden = true;
    el.fileInput.addEventListener('change', () => { addFiles(el.fileInput.files); el.fileInput.value = ''; });
    row.appendChild(el.fileInput);
    const attach = iconButton('ask-icon-btn', 'Attach files', ICONS.plus, () => el.fileInput.click());
    attach.setAttribute('data-ask-attach-btn', '');
    row.appendChild(attach);

    // #397: the scope selector — which project/workspace this chat is about,
    // independent of the page behind the sheet. It sits right after "+"
    // (attach → scope → spacer → meter …): the pill keeps its width (style.css
    // .ask-scope-btn flex:none), the spacer absorbs the slack. Its popover
    // (.ask-pop-scope) opens above the composer box, flush with its left edge.
    const scopeBtn = make('button', 'ask-scope-btn');
    scopeBtn.type = 'button';
    scopeBtn.setAttribute('data-ask-scope-btn', '');
    scopeBtn.title = 'Project scope for this chat';
    el.scopeLabel = make('span', 'ask-scope-label', 'Auto');
    scopeBtn.appendChild(el.scopeLabel);
    scopeBtn.appendChild(svgIcon(ICONS.chevronDown, 11, 2));
    scopeBtn.addEventListener('click', () => openScopePopover(scopeBtn));
    el.scopeBtn = scopeBtn;
    scopeBtn.dataset.minLevel = 'advanced';      // interface mode (docs/ui-levels.md): Auto scope is the simple path
    row.appendChild(scopeBtn);

    // MCP registry §9.4 + skills registry §6.8: the per-chat Sets picker — `Sets · N` (N = copies and skills that start
    // next turn), hidden while no set in play has a member or a skill. Styled as the scope pill; opens like the model
    // button's Effort sub-picker.
    const mcpBtn = make('button', 'ask-scope-btn ask-mcp-btn ask-sets-btn');
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

    // Agent mode (#574): Ask may run commands in a Worca terminal. A safety control, so it shows at every interface
    // level; hidden where agent mode cannot work (GET /api/ask/commands/status).
    const agentBtn = make('button', 'ask-scope-btn ask-agent-btn');
    agentBtn.type = 'button';
    agentBtn.setAttribute('data-ask-agent-btn', '');
    agentBtn.title = 'Agent mode: Ask can run commands in a Worca terminal';
    agentBtn.hidden = true;
    agentBtn.appendChild(make('span', 'ask-scope-label', 'Agent'));
    el.agentSwitch = make('span', 'switch on');
    el.agentSwitch.setAttribute('aria-hidden', 'true');
    agentBtn.appendChild(el.agentSwitch);
    agentBtn.addEventListener('click', () => setAgentMode(!st.agent.on));
    el.agentBtn = agentBtn;
    row.appendChild(agentBtn);

    row.appendChild(make('span', 'ask-composer-spacer'));

    // The cost (an Advanced detail), then the context ring. The ring opens the context popover — the
    // window, this chat's topics, its agents and worktrees — so it shows at every interface level.
    const meter = make('span', 'ask-meter');
    meter.setAttribute('data-ask-meter', '');
    el.meterCost = make('span', 'ask-meter-cost', '');
    el.meterCost.dataset.minLevel = 'advanced';
    meter.appendChild(el.meterCost);
    const ctxBtn = make('button', 'ask-ctx-ring');
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

    const modelBtn = make('button', 'ask-model-btn');
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

    el.send = make('button', 'ask-send');
    el.send.type = 'button';
    el.send.setAttribute('data-ask-send', '');
    el.send.setAttribute('aria-label', 'Send');
    el.send.appendChild(svgIcon(ICONS.send, 15, 2.2));
    el.send.addEventListener('click', sendMessage);
    if (createVoice) row.appendChild(buildVoiceControls());
    row.appendChild(el.send);

    el.stop = make('button', 'ask-stop');
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
    el.stop.addEventListener('click', stopTurn);
    row.appendChild(el.stop);

    box.appendChild(row);
    return wrap;
  }

  function announce(text) { el.live.textContent = text; }

  function focusComposer() {
    try { el.input.focus({ preventScroll: true }); } catch { try { el.input.focus(); } catch { /* detached */ } }
  }

  function showTip() {
    clearTipTimer();
    if (el.tip && !st.open) el.tip.classList.add('is-shown');
  }
  function hideTip() {
    clearTipTimer();
    if (el.tip) el.tip.classList.remove('is-shown');
  }
  function clearTipTimer() {
    if (st.tipTimer) { clearTimeout(st.tipTimer); st.tipTimer = null; }
  }

  /** The unread dot: a turn ended while the sheet was closed. Memory only — a reload clears it. */
  function setUnread(on) {
    if (!el.pill) return;
    el.pill.classList.toggle('has-unread', on);
    el.pill.setAttribute('aria-label', on ? PILL_NAME_UNREAD : PILL_NAME);
  }

  function openSheet() {
    if (st.open || st.destroyed) return;
    st.open = true;
    st.prevFocus = doc.activeElement;
    hideTip();
    setUnread(false);
    el.pill.hidden = true;
    syncPillOrb();                                 // nothing to paint behind the sheet
    el.sheet.hidden = false;
    restoreSize();                                 // the sheet has a box now — clamp the stored size to the dock
    st.pinned = true;
    ensureFirstOpen();
    focusComposer();
    scheduleFlush();
    repaintProgressCards({ hydrate: true });
    scheduleMcpRefresh();                          // the page may have changed while the sheet was closed
    if (createVoice && voiceUsedBefore()) voice().preload();   // the mic is ready by the time it is clicked
  }

  /**
   * Append a plain-text reference to the composer WITHOUT sending, so several can
   * stack and the user presses send once. Opens the sheet if it is closed and
   * focuses the composer either way. Returns false when there is nothing to add.
   */
  function appendToComposer(text) {
    const add = String(text ?? '').trim();
    if (!add || st.destroyed) return false;
    openSheet();                                   // no-op when already open…
    const cur = el.input.value;
    el.input.value = cur ? `${cur.replace(/\s*$/, '')}\n${add}` : add;
    // …so the autosize and the focus have to be driven here.
    fitInput();
    focusComposer();
    try { el.input.selectionStart = el.input.selectionEnd = el.input.value.length; } catch { /* jsdom */ }
    return true;
  }

  function closeSheet() {
    if (!st.open) return;
    stopVoice();
    closePopover({ focusTrigger: false });
    st.open = false;
    el.sheet.hidden = true;
    el.pill.hidden = false;
    syncPillOrb();                                 // still live? the orb loop comes back, whole
    const prev = st.prevFocus;
    st.prevFocus = null;
    if (prev && prev.isConnected && typeof prev.focus === 'function') { try { prev.focus(); return; } catch { /* fall through */ } }
    try { el.pill.focus(); } catch { /* ignore */ }
  }

  function toggleSheet() { (st.open ? closeSheet : openSheet)(); }

  // ---- resize ---------------------------------------------------------------
  // The sheet is a bottom-anchored, horizontally centred flex child of the dock,
  // so a top-edge drag is a pure height change and a side drag grows the width
  // symmetrically about the centre (each edge moves half the delta, which keeps
  // the grabbed edge under the cursor). Sizes are border-box px applied as
  // inline width/height, so the stylesheet's default rule stays byte-identical
  // and its max-width/max-height backstop still bounds a stale inline size.
  //
  // A gesture ends on pointerup/pointercancel, and — like graph/composer.mjs —
  // on window blur, lostpointercapture (the sheet was hidden, the capture was
  // taken) and a pointermove that reports no button held (the release landed
  // outside the window and never reached us). All of those COMMIT: a half-done
  // resize is still a size the user chose, unlike a half-drawn wire. Escape is
  // the one CANCEL: the pre-drag size comes back and nothing is stored. Only a
  // gesture that actually moved persists, and only the axis it dragged — the
  // other axis keeps the stored preference, so a click on a dock-clamped sheet
  // can never write the clamp back over a larger preference.
  function buildResizeHandle(edge) {
    const h = make('div', `ask-resize ask-resize-${edge}`);
    h.setAttribute('data-ask-resize', edge);
    h.setAttribute('aria-hidden', 'true');
    h.addEventListener('pointerdown', (e) => startResize(e, edge, h));
    h.addEventListener('lostpointercapture', () => { if (st.drag && st.drag.handle === h) finishResize(); });
    h.addEventListener('dblclick', (e) => { e.preventDefault(); resetSize(); });
    return h;
  }

  /** The dock's content box in px; zeros when there is no layout (hidden, detached, jsdom). */
  function dockInner() {
    const d = el.dock;
    const w = d ? d.clientWidth : 0;
    const h = d ? d.clientHeight : 0;
    return {
      w: w > 0 ? w - 2 * ASK_SHEET_SIZE.dockPadX : 0,
      h: h > 0 ? h - ASK_SHEET_SIZE.dockPadBottom - ASK_SHEET_SIZE.topGap : 0,
    };
  }

  /** Clamp to [min, dock inner]. The dock bound wins when the two conflict (a narrow viewport). */
  function clampSize(size) {
    const inner = dockInner();
    const maxW = inner.w > 0 ? inner.w : Infinity;
    const maxH = inner.h > 0 ? inner.h : Infinity;
    return {
      w: Math.round(Math.min(Math.max(size.w, ASK_SHEET_SIZE.minW), maxW)),
      h: Math.round(Math.min(Math.max(size.h, ASK_SHEET_SIZE.minH), maxH)),
    };
  }

  /** Write the inline size, or clear it (null) so min(821px,100%) rules again. */
  function applySize(size) {
    if (size) {
      el.sheet.style.width = `${size.w}px`;
      el.sheet.style.height = `${size.h}px`;
    } else {
      el.sheet.style.removeProperty('width');
      el.sheet.style.removeProperty('height');
    }
    st.applied = size;
  }

  /** Re-apply the persisted preference against the current dock — on open and on window resize. */
  function restoreSize() {
    applySize(st.size ? clampSize(st.size) : null);
  }

  /** The sheet's live border-box size; the applied/default size when there is no layout. */
  function currentSize() {
    const w = el.sheet.offsetWidth;
    const h = el.sheet.offsetHeight;
    if (w > 0 && h > 0) return { w, h };
    return st.applied ? { w: st.applied.w, h: st.applied.h } : { w: ASK_SHEET_SIZE.defaultW, h: ASK_SHEET_SIZE.defaultH };
  }

  function startResize(e, edge, handle) {
    if (st.drag || st.destroyed || (e.button != null && e.button !== 0)) return;
    const start = currentSize();
    st.drag = {
      edge, handle, pointerId: e.pointerId, x: e.clientX, y: e.clientY, w: start.w, h: start.h,
      moved: false,                                  // set by the first pointermove that applies a size
      before: st.applied ? { w: st.applied.w, h: st.applied.h } : null,   // what Escape restores
    };
    handle.classList.add('is-active');
    el.sheet.classList.add('is-resizing');
    // Capture is a bonus, never a precondition (Chrome throws for a synthetic
    // pointerId; jsdom has no such method) — the document listeners carry the
    // gesture either way, exactly like graph/composer.mjs.
    try { handle.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
    doc.addEventListener('pointermove', onResizeMove);
    doc.addEventListener('pointerup', onResizeEnd);
    doc.addEventListener('pointercancel', onResizeEnd);
    win.addEventListener('blur', onResizeBlur);
    e.preventDefault();                              // no text selection / focus steal mid-drag
  }

  function samePointer(g, e) {
    return g.pointerId == null || e.pointerId == null || e.pointerId === g.pointerId;
  }

  function onResizeMove(e) {
    const g = st.drag;
    if (!g || !samePointer(g, e)) return;
    if (e.buttons === 0) { finishResize(); return; }   // the release never reached us
    g.moved = true;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    let w = g.w;
    let h = g.h;
    if (g.edge === 'w' || g.edge === 'nw') w = g.w - 2 * dx;                  // left edge: leftwards grows
    if (g.edge === 'e' || g.edge === 'ne') w = g.w + 2 * dx;                  // right edge: rightwards grows
    if (g.edge === 'n' || g.edge === 'ne' || g.edge === 'nw') h = g.h - dy;   // top edge: upwards grows
    applySize(clampSize({ w, h }));
  }

  function onResizeEnd(e) {
    const g = st.drag;
    if (!g || !samePointer(g, e)) return;
    finishResize();
  }

  function onResizeBlur() { finishResize(); }

  /** Idempotent; also run from destroy() so a mid-drag unmount leaves no document listeners. */
  function finishResize() {
    const g = endResize();
    if (!g || !g.moved || !st.applied) return;
    // Persist the dragged axis only; the other keeps the stored preference (or,
    // with none stored, the size it had) — the clamp is never written back.
    const movesW = g.edge !== 'n';
    const movesH = g.edge !== 'e' && g.edge !== 'w';
    const prev = st.size;
    st.size = {
      w: movesW || !prev ? st.applied.w : prev.w,
      h: movesH || !prev ? st.applied.h : prev.h,
    };
    storeSize(st.size);
  }

  /** Escape: the pre-drag size comes back and nothing is stored. */
  function cancelResize() {
    const g = endResize();
    if (!g) return;
    applySize(g.before);
  }

  /** Tear the gesture down (listeners, classes, capture) and hand it back; null when none. */
  function endResize() {
    const g = st.drag;
    if (!g) return null;
    st.drag = null;
    doc.removeEventListener('pointermove', onResizeMove);
    doc.removeEventListener('pointerup', onResizeEnd);
    doc.removeEventListener('pointercancel', onResizeEnd);
    win.removeEventListener('blur', onResizeBlur);
    g.handle.classList.remove('is-active');
    el.sheet.classList.remove('is-resizing');
    try { if (g.handle.hasPointerCapture?.(g.pointerId)) g.handle.releasePointerCapture(g.pointerId); } catch { /* already gone */ }
    return g;
  }

  /** Double-click on any grip: back to the stylesheet default and forget the stored size. */
  function resetSize() {
    finishResize();
    st.size = null;
    applySize(null);
    storeSize(null);
  }

  /** Window resize or dock resize (the rail toggling, the dock's slide): re-clamp — never under a held pointer.
   *  A card graph re-measures on EVERY such change, not only when a stored size is being re-clamped. */
  function onWinResize() {
    if (st.destroyed || !st.open || st.drag) return;
    if (st.size) restoreSize();
    relayoutCards();
    if (st.popover && st.popover.trigger === el.ctxBtn) anchorCtxPopover(st.popover.panel, el.ctxBtn);
  }

  // ---- keyboard + pointer routing ------------------------------------------
  function containsNode(rootEl, t) { return !!(t && t.nodeType && rootEl.contains(t)); }

  function ownsKey(e) {
    return e.key === 'Escape' && st.open
      && (containsNode(root, e.target) || containsNode(root, doc.activeElement));
  }

  function isToggleCombo(e) {
    return (e.metaKey || e.ctrlKey) && !e.altKey && typeof e.key === 'string' && e.key.toLowerCase() === 'k';
  }

  function onDocKeydown(e) {
    if (st.destroyed) return;
    if (e.key === 'Escape' && el.tip && el.tip.classList.contains('is-shown')) hideTip();   // the tooltip yields, the key carries on
    if (st.drag && e.key === 'Escape') { e.preventDefault(); cancelResize(); return; }
    if (isToggleCombo(e)) {
      // The terminal pane (#573) owns its keys: Ctrl+K is the shell's kill-line there.
      if (e.target && typeof e.target.closest === 'function' && e.target.closest('.term-pane')) return;
      if (e.repeat || e.isComposing) return;
      e.preventDefault();
      toggleSheet();
      return;
    }
    if (e.key === 'Escape' && ownsKey(e) && st.popover) {
      // A popover may spend Escape on itself first (History search: clear the query).
      if (st.popover.onEscape && st.popover.onEscape(e)) { e.preventDefault(); return; }
      closePopover({ focusTrigger: true });
    }
    // Escape with nothing open is an owned no-op — app.js's handlers already
    // returned via ownsKey(); the sheet itself never closes on Escape (§10.4).
  }

  function onDocPointerdown(e) {
    if (st.destroyed || !st.open) return;
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (t.closest('[data-ask-sheet]')) {
      if (st.popover && !st.popover.panel.contains(t) && !st.popover.trigger.contains(t)) {
        closePopover({ focusTrigger: false });
      }
      return;
    }
    // `.hd-cmt-card` joins the allowlist: its "Ask Worca" button appends to the
    // composer, and pointerdown lands BEFORE the click that would open the sheet.
    // `.term-pane` too: Ask's terminal is shared, so the user clicks and types there while the chat stays open.
    if (t.closest('.viewer-modal, #confirm-modal, .info-bubble, .mention-popup, .hd-cmt-card, .term-pane')) return;
    closeSheet();
  }

  // ---- popover primitive (spec §10.6 .ask-pop) ------------------------------
  function closePopover({ focusTrigger = true } = {}) {
    const p = st.popover;
    if (!p) return;
    st.popover = null;
    if (st.threadsRefresh) { clearTimeout(st.threadsRefresh); st.threadsRefresh = null; }
    p.panel.remove();
    if (p.onClose) { try { p.onClose(); } catch { /* ignore */ } }
    if (focusTrigger) { try { p.trigger.focus(); } catch { /* ignore */ } }
  }

  function menuItems(panel) { return [...panel.querySelectorAll('[role="menuitem"]:not([disabled]),[role="menuitemcheckbox"]:not([disabled])')]; }

  function onPopKeydown(e) {
    const p = st.popover;
    if (!p) return;
    const items = menuItems(p.panel);
    if (!items.length) return;
    const go = (i) => { const item = items[(i + items.length) % items.length]; item.tabIndex = 0; try { item.focus(); } catch { /* ignore */ } };
    // In a search field (History) Home/End/Space/Enter edit text; ArrowDown/ArrowUp enter the rows.
    if (e.target && e.target.tagName === 'INPUT') {
      if (e.key === 'ArrowDown') { e.preventDefault(); go(0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); go(items.length - 1); }
      return;
    }
    const idx = items.indexOf(doc.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); go(idx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(idx - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(items.length - 1); }
    else if ((e.key === 'Enter' || e.key === ' ') && idx >= 0) { e.preventDefault(); items[idx].click(); }
  }

  function openPopover({ panelClass, trigger, build, onClose, refreshOn, refresh, onEscape }) {
    if (st.popover && st.popover.trigger === trigger) { closePopover({ focusTrigger: false }); return null; }
    closePopover({ focusTrigger: false });
    const panel = make('div', `ask-pop ${panelClass}`);
    panel.setAttribute('role', 'menu');
    panel.addEventListener('keydown', onPopKeydown);
    build(panel);
    el.sheet.appendChild(panel);
    // refreshOn(dirty) → true re-runs build() on that flush (flushExtra), so an
    // OPEN popover follows the live meters / worktrees instead of freezing at open.
    // refresh(panel) is the server-fed twin: scheduleThreadsRefresh calls it
    // (debounced) on out-of-turn frames the model never sees.
    st.popover = { panel, trigger, onClose: onClose || null, build, refreshOn: refreshOn || null, refresh: refresh || null, onEscape: onEscape || null };
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
    const b = make('button', `ask-pop-item ${className}`.trim());
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.tabIndex = -1;
    if (onPick) b.addEventListener('click', onPick);
    return b;
  }

  // ---- threads popover (list; switching/delete land in Task 7) -------------
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

  function toggleThreadsPopover(trigger) {
    let meter = null;
    let search = null;
    // Per open: the query never outlives the popover (every open starts empty).
    const hist = { q: '', seq: 0, timer: null };
    const panel = openPopover({
      panelClass: 'ask-pop-threads',
      trigger,
      build: (p) => {
        // Same caption-row pattern as the agents popover: the row paints at once,
        // the meter fills once the list lands (the popover opens synchronously).
        const head = make('div', 'ask-pop-caption-row');
        head.appendChild(make('span', 'ask-pop-caption', 'History'));
        meter = make('span', 'ask-pop-caption-meter', '');
        head.appendChild(meter);
        p.appendChild(head);
        // Server-side search (titles + message text): the list is capped, so filtering
        // the loaded rows would miss chats. Debounced; the rows below follow it.
        search = doc.createElement('input');
        search.type = 'search';
        search.className = 'ask-threads-search';
        search.placeholder = 'Search chats';
        search.setAttribute('aria-label', 'Search chats');
        search.autocomplete = 'off';
        search.spellcheck = false;
        search.addEventListener('input', () => {
          if (hist.timer) clearTimeout(hist.timer);
          hist.timer = setTimeout(() => {
            hist.timer = null;
            const q = search.value.trim();
            if (q === hist.q) return;
            hist.q = q;
            loadThreadRows(p, meter, hist);
          }, ASK_HISTORY_SEARCH_MS);
        });
        p.appendChild(search);
      },
      refresh: (p) => loadThreadRows(p, meter, hist),
      onClose: () => { if (hist.timer) { clearTimeout(hist.timer); hist.timer = null; } },
      // Escape in a non-empty field clears it (and reloads the full list); otherwise it closes.
      onEscape: (e) => {
        if (e.target !== search || !search.value) return false;
        search.value = '';
        if (hist.timer) { clearTimeout(hist.timer); hist.timer = null; }
        if (hist.q) { hist.q = ''; loadThreadRows(panel, meter, hist); }
        return true;
      },
    });
    if (!panel) return;
    try { search.focus(); } catch { /* ignore */ }
    loadThreadRows(panel, meter, hist);
  }

  /** History meter while searching: "3 of 120". */
  function fmtMatches(matches, total) { return `${matches} of ${total}`; }

  /** Fetch the list for the current query and (re)render the rows under the pinned caption
   *  and search field. Only the newest load renders (hist.seq): typing fires overlapping
   *  fetches. A refresh keeps the focused row by index; focus in the search field stays put. */
  function loadThreadRows(panel, meter, hist) {
    const seq = ++hist.seq;
    const q = hist.q;
    const url = `/api/ask/threads?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    Promise.resolve()
      .then(() => fetch(url))
      .then((r) => (r && r.ok ? r.json() : { threads: [] }))
      .catch(() => ({ threads: [] }))
      .then(({ threads, total, matches }) => {
        if (st.popover === null || st.popover.panel !== panel) return; // closed meanwhile
        if (seq !== hist.seq) return;                                   // a newer load owns the list
        const rows = Array.isArray(threads) ? threads : [];
        // `total` is EVERY saved chat (the route caps rows at limit); an older server
        // without it degrades to the page size. `matches` rides only a ?q= answer.
        const all = Number.isInteger(total) && total >= 0 ? total : rows.length;
        if (meter) meter.textContent = q ? fmtMatches(Number.isInteger(matches) && matches >= 0 ? matches : rows.length, all) : fmtChats(all);
        const stale = panel.querySelectorAll(':scope > .ask-threads-list, :scope > .ask-pop-empty');
        const refreshing = stale.length > 0;
        const inSearch = doc.activeElement && doc.activeElement.classList && doc.activeElement.classList.contains('ask-threads-search');
        // Focus in the search field stays there. Otherwise the first load focuses the first
        // row, and a refresh keeps the focused row by index (or leaves focus alone elsewhere).
        let focusIndex = 0;
        if (inSearch) focusIndex = null;
        else if (refreshing) focusIndex = panel.contains(doc.activeElement) ? Math.max(0, menuItems(panel).indexOf(doc.activeElement)) : null;
        for (const n of stale) n.remove();
        renderThreadRows(panel, rows, focusIndex, q);
      });
  }

  /** The History popover is open and a run some chat follows just moved: refetch
   *  the list (debounced — a run transition fans out one frame per linked thread,
   *  and a chat may follow several runs, so a single terminal status never flips a
   *  dot directly). Sits BEFORE pushServerFrame's threadId filter: the frame is
   *  usually for ANOTHER chat. A turn starting/ending elsewhere arms the thinking
   *  dot the same way. */
  function scheduleThreadsRefresh() {
    const pop = st.popover;
    if (!pop || typeof pop.refresh !== 'function' || st.threadsRefresh) return;
    st.threadsRefresh = setTimeout(() => {
      st.threadsRefresh = null;
      if (st.popover === pop) pop.refresh(pop.panel);
    }, THREADS_REFRESH_MS);
  }

  /** @param {number|null} focusIndex row to focus after the render; null leaves focus alone
   *  @param {string} q the active search ('' = none) — picks the empty-state text */
  function renderThreadRows(panel, threads, focusIndex = 0, q = '') {
    if (!threads.length) {
      panel.appendChild(make('div', 'ask-pop-empty', q ? 'No chats match.' : 'No saved chats.'));
      return;
    }
    // The rows scroll inside a capped list so 50 threads cannot run past the
    // sheet; the caption stays a direct child of the panel, hence pinned. The
    // list itself stays inside the panel: menuItems() reads the whole panel.
    const list = make('div', 'ask-threads-list');
    for (const t of threads) {
      const row = make('div', 'ask-thread-row');
      const pick = menuItem('ask-thread-pick', () => { closePopover({ focusTrigger: false }); switchThread(t.id); });
      // Two dots lead the row, sitting against the title: green = the chat's own
      // turn is thinking, violet = the chat follows a live run. Each span is
      // always emitted and .ask-thread-dot collapses it (display:none) unless
      // its arm joins it, so an idle row leaves no empty gutter and its title
      // starts at the left edge. The date rides the meter line under the title.
      pick.appendChild(make('span', `ask-dot ask-thread-dot${t.inFlight ? ' ask-dot-live' : ''}`));
      pick.appendChild(make('span', `ask-dot ask-thread-dot${t.tracking ? ' ask-dot-track' : ''}`));
      const col = make('span', 'ask-thread-col');
      // A null title = the haiku title has not landed yet (the message route
      // stamps nothing); "New chat" is the same label the turn falls back to.
      col.appendChild(make('span', 'ask-thread-title', t.title || 'New chat'));
      col.appendChild(threadMeter(t));
      pick.appendChild(col);
      row.appendChild(pick);
      row.appendChild(buildThreadTrash(t));
      list.appendChild(row);
    }
    panel.appendChild(list);
    if (focusIndex === null) return;
    const items = menuItems(panel);
    const target = items[Math.min(focusIndex, items.length - 1)];
    if (target) { target.tabIndex = 0; try { target.focus(); } catch { /* ignore */ } }
  }

  // ---- catalog + picker (D8) ------------------------------------------------
  function catalogEntry(id) { return st.catalog ? st.catalog.models.find((m) => m && m.id === id) || null : null; }

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
    const wanted = {
      model: st.pickerFromThread || st.pickerFromStore ? st.picker.model : fallback.model,
      effort: st.pickerFromThread || st.effortFromStore ? st.picker.effort : fallback.effort,
    };
    const wantedEntry = catalogEntry(wanted.model);
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
    if (changed && st.pickerFromStore && !st.pickerFromThread) storeModel();
    updatePickerButton();
  }

  /** Back to the browser-level pick (new chat, a thread with no model of its own). */
  function restoreBrowserPick() {
    const home = browserPick();
    st.picker = home.picker;
    st.pickerFromStore = home.pickerFromStore;
    st.effortFromStore = home.effortFromStore;
    st.pickerFromThread = false;
    if (st.catalog) applyCatalogToPicker();
    else updatePickerButton();
  }

  /** A thread SWITCH shows that thread's last model/effort; a row without one gets the browser-level pick. */
  function applyThreadPick(thread) {
    const t = thread && typeof thread === 'object' ? thread : null;
    if (!t || typeof t.model !== 'string' || !t.model || typeof t.effort !== 'string' || !t.effort) { restoreBrowserPick(); return; }
    st.picker = { model: t.model, effort: t.effort };
    st.pickerFromThread = true;
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

  function ensureFirstOpen() {
    if (st.firstOpenDone) return;
    st.firstOpenDone = true;
    loadCatalog();
    loadAgentStatus();
    const stored = readStoredThread();
    if (stored && !st.threadId) switchThread(stored);
  }

  /**
   * Primary-list grouping key. Claude ids group by family; a PLUGIN model groups by
   * its plugin, so a plugin shipping ten ids contributes one primary row and the rest
   * land under "More models" — instead of each foreign id becoming its own "family"
   * (the old `|| m.id` fallback) and flooding the list. Anything else shares one
   * 'other' bucket.
   */
  function familyKey(m) {
    const fam = (m.id.match(/^claude-(opus|fable|sonnet|haiku)-/) || [])[1];
    if (fam) return `claude:${fam}`;
    if (m.custom === 'plugin' && m.plugin) return `plugin:${m.plugin}`;
    return 'other';
  }

  function splitCatalog() {
    const primary = [];
    const rest = [];
    const seen = new Set();
    for (const m of st.catalog ? st.catalog.models : []) {
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
    st.pickerFromThread = false;                    // the user's own pick now, not the thread's
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
          'This model reported no cost while consuming tokens — chat spend may not count toward the budget.'));
      }
      if (Array.isArray(m.secretsMissing) && m.secretsMissing.length) {
        item.appendChild(tag('secret not set', 'is-err',
          `${m.secretsMissing.join(', ')} is not set — configure it in the ${m.plugin ? `“${m.plugin}” ` : ''}plugin's Model secrets, or this model will fail.`));
      }
      if (m.needsSignIn) {
        item.appendChild(tag('needs sign-in', 'is-err', m.signInMessage || 'The provider behind this model is not usable yet — Settings › Models › Providers.'));
      }
      // Credential broker: whether the signed-in person has the key this model spends from.
      const cb = credentialBadge(m.id);
      if (cb) item.appendChild(tag(cb.text, cb.missing ? 'is-err' : 'is-key', cb.title));
      if (m.id === st.picker.model) item.appendChild(make('span', 'ask-model-check', '✓'));
      return item;
    };
    let shownPane = 'main';
    const renderPane = (pane) => {
      shownPane = pane;
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
          if (eff === st.picker.effort) item.appendChild(make('span', 'ask-model-check', '✓'));
          panel.appendChild(item);
        }
      } else if (pane === 'more') {
        const back = menuItem('ask-pane-back', () => renderPane('main'));
        back.setAttribute('data-ask-pane-back', '');
        back.appendChild(make('span', null, '‹ Models'));
        panel.appendChild(back);
        panel.appendChild(make('div', 'ask-pop-divider'));
        for (const m of splitCatalog().rest) panel.appendChild(modelItem(m));
      } else {
        const { primary, rest } = splitCatalog();
        for (const m of primary) panel.appendChild(modelItem(m));
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
      if (c !== had && shownPane === 'main' && st.popover && st.popover.panel === panel) renderPane('main');
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

  // ---- Agent mode switch (#574) -------------------------------------------------
  /** Whether agent mode can work here at all (not hosted-off, not agent isolation): once, at first open. */
  async function loadAgentStatus() {
    let data = null;
    try {
      const r = await fetch('/api/ask/commands/status');
      data = r && r.ok ? await r.json() : null;
    } catch { data = null; }
    if (st.destroyed) return;
    st.agent.available = !!(data && data.enabled === true);
    paintAgent();
  }
  function paintAgent() {
    if (!el.agentBtn) return;
    el.agentBtn.hidden = !st.agent.available;
    el.agentBtn.setAttribute('aria-pressed', String(st.agent.on));
    el.agentSwitch.classList.toggle('on', st.agent.on);
  }
  /** Same chain as patchMcpOff: one PATCH at a time, in click order. */
  function patchAgentMode(tid, value) {
    const body = JSON.stringify({ agentMode: value });
    st.agent.saving = st.agent.saving
      .then(() => fetch(`/api/ask/threads/${tid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }))
      .catch(() => { /* the switch keeps the choice; the next message carries it */ });
  }
  function setAgentMode(on) {
    st.agent.on = on;
    if (st.threadId) patchAgentMode(st.threadId, on);
    paintAgent();
  }

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
      closeSheet();                                 // the progress card's precedent: close, then route
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
  const layerLine = (sk) => `skills from sets not loaded on this machine: ${sk.layer.text || sk.layer.blocked}`;

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
        panel.appendChild(mcpManageItem(`Manage ${set.name} in Settings › Sets`, `#settings/mcp/sets/${encodeURIComponent(set.id)}`));
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
        if (!p.sets.length) panel.appendChild(make('div', 'ask-pop-empty', st.mcp.failed ? 'Could not load the sets — reopen to retry.' : !st.mcp.preview ? 'Loading…' : 'No sets in play.'));
        // Skills registry §4.1: a host whose Claude Code refuses --plugin-dir mounts no skill — one muted line.
        if (sk.layer && sk.layer.blocked) panel.appendChild(make('div', 'ask-pop-empty', layerLine(sk)));
        panel.appendChild(make('div', 'ask-pop-divider'));
        panel.appendChild(mcpManageItem('Manage in Settings › Sets', '#settings/mcp'));
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
  /** Per-field merge: the pinned scope replaces the page context's TARGET keys;
   *  view/run/diff-file context still follow the page. Auto sends pinned:false so
   *  the server never resurrects a stale thread pin over an explicit choice. */
  function scopedContext(page) {
    const ctx = { ...page };
    if (!st.scope.pinned) return { ...ctx, pinned: false };
    delete ctx.projectDir;
    delete ctx.projectKey;
    delete ctx.workspaceId;
    delete ctx.projectSource;                     // the fallback tag goes with the target keys (MCP registry §9.1)
    ctx.pinned = true;
    if (st.scope.projectKey) ctx.projectKey = st.scope.projectKey;
    else if (st.scope.workspaceId) ctx.workspaceId = st.scope.workspaceId;
    return ctx;
  }

  function updateScopeButton() {
    if (!el.scopeLabel) return;
    el.scopeLabel.textContent = st.scope.pinned
      ? (st.scope.label || st.scope.projectKey || st.scope.workspaceId || 'Pinned')
      : 'Auto';
    el.scopeBtn.classList.toggle('is-pinned', st.scope.pinned);
  }

  function setScope(next) {
    st.scope = {
      pinned: !!next.pinned,
      projectKey: next.projectKey || null,
      workspaceId: next.workspaceId || null,
      label: next.label || null,
    };
    updateScopeButton();
    scheduleMcpRefresh();
    closePopover({ focusTrigger: false });
    focusComposer();
    // Persist on the thread so the pin survives reload with no message sent. A
    // brand-new chat has no row yet — the first message's context (pinned:true)
    // persists it then instead.
    if (!st.threadId) return;
    const scope = st.scope.pinned
      ? (st.scope.projectKey ? { pinned: true, projectKey: st.scope.projectKey } : { pinned: true, workspaceId: st.scope.workspaceId })
      : { pinned: false };
    Promise.resolve()
      .then(() => fetch(`/api/ask/threads/${st.threadId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope }) }))
      .catch(() => { /* the next message carries the scope in its context anyway */ });
  }

  /** Restore the selector from a stored thread context (loadThread / reopen). */
  function applyThreadScope(context) {
    const c = context && typeof context === 'object' ? context : null;
    const key = c && c.pinned === true && typeof c.projectKey === 'string' && c.projectKey ? c.projectKey : null;
    const ws = c && c.pinned === true && typeof c.workspaceId === 'string' && c.workspaceId ? c.workspaceId : null;
    st.scope = key
      ? { pinned: true, projectKey: key, workspaceId: null, label: null }
      : ws
        ? { pinned: true, projectKey: null, workspaceId: ws, label: null }
        : { pinned: false, projectKey: null, workspaceId: null, label: null };
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
    const panel = openPopover({ panelClass: 'ask-pop-scope', trigger, build: (p) => {
      p.appendChild(make('div', 'ask-pop-caption', 'Chat scope'));
    } });
    if (!panel) return;
    loadCardOptions().then((opts) => {
      if (!st.popover || st.popover.panel !== panel) return;
      const item = (label, on, onPick) => {
        const it = menuItem('ask-scope-item', onPick);
        it.appendChild(make('span', 'ask-model-name', label));
        if (on) it.appendChild(make('span', 'ask-model-check', '✓'));
        return it;
      };
      panel.appendChild(item('Auto (follow current page)', !st.scope.pinned, () => setScope({ pinned: false })));
      const projects = opts.projects.filter((p) => p && p.key);
      if (projects.length) {
        panel.appendChild(make('div', 'ask-pop-divider'));
        panel.appendChild(make('div', 'ask-pop-caption', 'Projects'));
        for (const p of projects) {
          panel.appendChild(item(
            p.exists === false ? `${p.name} (missing)` : p.name,
            st.scope.pinned && st.scope.projectKey === p.key,
            () => setScope({ pinned: true, projectKey: p.key, label: p.name }),
          ));
        }
      }
      const workspaces = opts.workspaces.filter((w) => w && w.id);
      if (workspaces.length) {
        panel.appendChild(make('div', 'ask-pop-divider'));
        panel.appendChild(make('div', 'ask-pop-caption', 'Workspaces'));
        for (const w of workspaces) {
          panel.appendChild(item(
            w.name || w.id,
            st.scope.pinned && st.scope.workspaceId === w.id,
            () => setScope({ pinned: true, workspaceId: w.id, label: w.name || w.id }),
          ));
        }
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
    if (!st.worktrees.length) return null;
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
      ? menuItem('ask-ctx-topic', () => { closeSheet(); if (win.location.hash !== href) win.location.hash = href.slice(1); })
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
   *  beside it, so a fixed CSS offset would miss it. Kept 6px inside the sheet; re-run on window resize. */
  function anchorCtxPopover(panel, trigger) {
    const sr = el.sheet.getBoundingClientRect();
    const tr = trigger.getBoundingClientRect();
    if (sr.width > 0) panel.style.right = `${Math.max(0, Math.min(sr.right - tr.right, sr.width - CTX_POP_WIDTH - 6))}px`;
  }

  // ---- thread actions -------------------------------------------------------
  function newThread() {
    stopVoice();
    loadGen += 1;                       // a load still in flight must not resurrect the old thread
    st.threadId = null;
    st.model = null;
    st.seenRows = new Set();            // a different chat: its rows have never been shown
    st.subscribedFor = null;
    stopElapsed();
    storeThread(null);
    el.title.textContent = 'Ask Worca';
    applyThreadScope(null);             // #397: a brand-new chat starts on Auto
    setContexts([]);
    restoreBrowserPick();               // …and on the browser-level pick, not the last chat's
    st.mcp.off = { sets: [], members: [] };   // …and with every MCP server on
    st.agent.on = true;                       // …and with Agent mode on (#574)
    paintAgent();
    scheduleMcpRefresh();
    pruneCardEls();                     // st.model is already null — renderTranscript's keep set cannot see the old ids
    renderTranscript();
    updateMeters();
    setWorktrees([]);
    updateSendStop();
    setComposerMsg(null);
    focusComposer();
  }

  async function deleteThread(t) {
    closePopover({ focusTrigger: false });
    const ok = await confirm({
      title: 'Delete this chat?',
      message: `“${t.title || 'New chat'}” and its transcript are removed${t.worktrees ? ` along with ${t.worktrees} worktree${t.worktrees === 1 ? '' : 's'}` : ''}. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) { focusComposer(); return; }
    if (!(await deleteOrReport(`/api/ask/threads/${t.id}`, 'Could not delete the chat', `ask-thread-del-${t.id}`))) { focusComposer(); return; }
    if (readStoredThread() === t.id) storeThread(null);
    if (st.threadId === t.id) newThread(); // clears + focuses the textarea (D14)
    else focusComposer();
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
      const a = make('a', 'ask-notice-link', 'open');
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
  async function loadLane(workflowId, projectDir) {
    const qs = projectDir ? `?projectDir=${encodeURIComponent(projectDir)}` : '';
    const [wf, agents, cfg] = await Promise.all([
      fetchJsonOk(`/api/workflows/${encodeURIComponent(workflowId)}`), fetchJsonOk('/api/agents'), fetchJsonOk(`/api/config${qs}`),
    ]);
    const registry = agents && Array.isArray(agents.agents) ? Object.fromEntries(agents.agents.map((a) => [a.key, a])) : {};
    if (!wf || !(Array.isArray(wf.nodes) || Array.isArray(wf.steps)) || !Object.keys(registry).length || !cfg) return null;
    const config = (cfg.config && typeof cfg.config === 'object') ? cfg.config : { steps: {}, customModels: [] };
    const runConfig = (config.workflows && config.workflows[workflowId]) || { nodes: {}, feedbacks: {} };
    const models = Array.isArray(cfg.models) ? cfg.models : [];
    // `models`: a pinned row's hidden pick is healed against this catalog (node-tunables.mjs).
    const rows = buildNodeConfigRows(wf, registry, runConfig, { ...(workflowId === 'wf_default' ? { legacySteps: config.steps || {} } : {}), models });
    return { wf, registry, runConfig, rows, edits: {}, editable: !!projectDir,
      models, efforts: Array.isArray(cfg.efforts) ? cfg.efforts : [],
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
      const k = c.model ? modelLabel(lane, c.model) : 'inherit';
      counts.set(k, (counts.get(k) || 0) + 1);
      if (c.fanOut) fan++;
    }
    return `${lane.rows.length} agents · ${[...counts].map(([k, v]) => `${k} ×${v}`).join(' · ')}${fan ? ` · ${fan} fan-out` : ''}`;
  }
  function laneSet(lane, row, patch) {
    const next = { ...(lane.edits[row.nodeId] || {}), ...patch };
    for (const k of Object.keys(next)) if (next[k] === row[k]) delete next[k];   // back to the proposal = no edit
    if (Object.keys(next).length) lane.edits[row.nodeId] = next; else delete lane.edits[row.nodeId];
  }
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
  const RP_EXTRAS_MAX_BYTES = 5 * 1024 * 1024;   // D3: the JSON body cap is 8 MB and base64 grows by a third
  /** The pills as /api/run extras. {extras} or {error}. */
  async function collectCardExtras(local) {
    const pills = local.pills || [];
    if (!pills.length) return { extras: [] };
    if (pills.reduce((n, p) => n + (p.bytes || 0), 0) > RP_EXTRAS_MAX_BYTES) return { error: 'attachments exceed 5 MB — remove one' };
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
  function rpSwitch(ctl, label, on, locked, onChange, editable) {
    const wrap = make('label', 'ask-rp-ctl');
    wrap.appendChild(make('span', null, label));
    const sw = make('span', 'ask-rp-sw');
    const cb = doc.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!on;
    cb.disabled = !!locked || !editable;
    cb.setAttribute('data-ctl', ctl);
    cb.setAttribute('aria-label', label);
    cb.addEventListener('change', () => onChange(cb.checked));
    sw.append(cb, make('span', 'ask-rp-knob'));
    if (locked) wrap.title = 'Fixed for this agent';
    wrap.appendChild(sw);
    return wrap;
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
      return;
    }
    const edited = laneEditedRows(lane).length;
    const over = laneOverrideCount(lane);
    sub.textContent = edited
      ? `you changed ${edited} agent${edited > 1 ? 's' : ''} · ${over} override${over === 1 ? '' : 's'} of the workflow defaults`
      : `proposed by Worca · ${over} override${over === 1 ? '' : 's'} of the workflow defaults`;
    reset.hidden = !edited;
    reset.addEventListener('click', () => { lane.edits = {}; renderLane(laneSec, lane, lc); });
    const box = make('div', 'ask-rp-agents');
    const opt = (v, t) => { const o = doc.createElement('option'); o.value = v; o.textContent = t; return o; };
    lane.rows.forEach((row, i) => {
      const c = laneEffective(lane, row);
      const changed = !!lane.edits[row.nodeId];
      const tile = make('div', `ask-rp-tile${changed ? ' mod' : ''}`);
      tile.dataset.nodeId = row.nodeId;
      const l1 = make('div', 'ask-rp-tile-l1');
      l1.appendChild(make('span', `ask-rp-acc${RP_ACC.has(row.color) ? ` ${row.color}` : ''}`));
      const name = make('div', 'ask-rp-name');
      name.appendChild(make('b', null, row.label));
      const small = make('small');
      // "step N" = position in the lane (launch order); row.stepIndex ranks the task card as 0.
      if (changed) { small.appendChild(make('span', 'ask-rp-m', 'edited')); small.appendChild(doc.createTextNode(` · step ${i + 1}`)); }
      else small.textContent = `step ${i + 1} · ${row.pinned ? 'model from Settings › Memory' : row.modified ? 'project override' : 'workflow default'}`;
      name.appendChild(small);
      l1.appendChild(name);
      // model
      const sel = rpSelect('ask-rp-model', `Model for ${row.label}`);
      sel.appendChild(opt('', 'inherit (workflow default)'));
      for (const m of lane.models) if ((!m.hidden && !m.needsSignIn) || m.id === c.model) sel.appendChild(opt(m.id, (m.label || m.id) + (m.needsSignIn ? ' (needs sign-in)' : '')));
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
      // effort pills
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
      tile.appendChild(l1);
      // line 2
      const l2 = make('div', 'ask-rp-tile-l2');
      l2.appendChild(rpSwitch('fanOut', 'fan-out', c.fanOut, false, (v) => { laneSet(lane, row, { fanOut: v }); renderLane(laneSec, lane, lc); }, lane.editable));
      const subWrap = make('label', 'ask-rp-ctl');
      subWrap.appendChild(make('span', null, 'sub-agents'));
      const subSel = rpSelect('ask-rp-subagent', `Sub-agent model for ${row.label}`);
      subSel.appendChild(opt('', 'subs: default (agent picks)'));
      for (const v of lane.subagentModels) subSel.appendChild(opt(v, v === 'auto' ? 'subs: agent picks' : `subs: ${v}`));
      subSel.value = lane.subagentModels.includes(c.subagentModel) ? c.subagentModel : '';
      subSel.disabled = !lane.editable;
      subSel.title = 'Model for the sub-agents this node spawns (needs fan-out)';
      subSel.addEventListener('change', () => { laneSet(lane, row, { subagentModel: subSel.value }); renderLane(laneSec, lane, lc); });
      subWrap.appendChild(subSel);
      l2.appendChild(subWrap);
      if (row.askQuestions !== null) {
        l2.appendChild(rpSwitch('questions', 'questions', c.askQuestions, row.questionsLocked, (v) => { laneSet(lane, row, { askQuestions: v }); renderLane(laneSec, lane, lc); }, lane.editable));
      }
      tile.appendChild(l2);
      box.appendChild(tile);
    });
    const foot = make('div', 'ask-rp-agents-foot');
    foot.textContent = !lane.editable
      ? 'Agent settings are per project — pick a project target to edit them.'
      : edited ? `Edits become this project's defaults for ${lane.wf.name || lc.workflowId()}` : 'Everything at the workflow default';
    box.appendChild(foot);
    laneSec.appendChild(box);
    lc.summary.textContent = laneSummary(lane);
  }

  /** The stub states. A `started` run — and a `failed` one that HAS a runId — renders the live progress
   *  card instead (buildProgressCard), so neither reaches here. */
  function buildCardTerminal(block) {
    const card = block.card || {};
    if (block.state === 'failed') {
      return make('div', 'ask-card-stub ask-card-failed', `Run failed${block.error ? `: ${block.error}` : ''} — ${card.title || card.brief || ''}`);
    }
    if (block.state === 'scheduled') return buildCardScheduled(block);
    return make('div', 'ask-card-stub', `Not now — ${card.title || card.brief || 'run proposal'}`);
  }

  // ---- scheduled proposals (docs/scheduled-runs.md "Ask Worca") ----
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
      series ? `${title} — ${block.sentence || 'repeating schedule'}${block.scheduledFor ? ` · next ${localWhen(block.scheduledFor)}` : ''}`
        : block.after ? `${title} — after ‘${block.after.title || block.after.id}’ finishes` : `${title} — starts ${localWhen(block.scheduledFor)}`));
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
    const runNow = make('button', 'ask-card-not-now', 'Run now');
    runNow.type = 'button';
    runNow.addEventListener('click', () => call('POST', `/api/schedules/${target}/run-now`, runNow));
    const cancel = make('button', 'ask-card-not-now', series ? 'Delete schedule' : 'Cancel schedule');
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
    if (block.state === 'declined') return stub(make('div', 'ask-card-stub', `Declined — ${name || 'workflow proposal'}`));
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
    const handle = renderAutoProposal({ ...card, reasoning: card.reasoning || card.note || '' }, {
      doc, order: proposed ? AUTO_PROPOSAL_ORDER_CARD : ['name', 'graph', 'loops'],
      editableName: editable, pick: editable, onName: (v) => { wf.name = v; },
    });
    if (!proposed) {
      const saved = make('div', 'ask-wfcard-saved');
      saved.appendChild(svgIcon(WF_ICO.check, 15, 2.4));
      saved.appendChild(make('span', null, name));
      const line = make('div', 'ask-wfcard-savedline', card.adopted ? 'Uses your saved workflow' : 'Saved as a new workflow, tagged Auto');
      handle.parts.name.replaceWith(saved);
      saved.after(line);
    } else if (matched) {
      const hint = make('div', 'ask-wfcard-hint', 'Model and effort come from that saved workflow — edit them in the composer.');
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
      const decline = btn('ask-card-not-now', 'Decline', 'data-ask-wf-decline');
      decline.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, decline));
      const save = btn('ask-card-start', card.thenRun ? 'Save & propose run' : 'Save as workflow', 'data-ask-wf-save', WF_ICO.save);
      // A 200 means the row exists now: drop the cached option lists so every later consumer sees it.
      save.addEventListener('click', () => postCard(block, rootEl, { state: 'saved', name: handle.getName(), nodes: diffNodes(card.nodes, wf.nodes) }, save)
        .then((out) => { if (out) st.cardOptions = null; }));
      actions.append(make('span', 'ask-card-actions-spacer'), decline, save);
    } else {
      const open = btn('ask-card-open-np', 'Open in composer', 'data-ask-wf-open');
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

  // ---- Metrics card (docs/team-metrics.md "Ask Worca"): a proposed team-metrics configuration change --------------
  const MC_KIND_LABEL = { enable: 'Enable team metrics', record: 'Include my runs', workspace_home: 'Metrics home', route_members: 'Route members' };
  const MC_APPLY_LABEL = { enable: 'Enable', record: 'Apply', workspace_home: 'Set home', route_members: 'Route members' };
  // A team-policy card (docs/team-policy.md "Ask Worca") is the same component: other words, plus the
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
    if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined — ${summary}`) };
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
      const decline = btn('ask-card-not-now', 'Decline', 'data-ask-mc-decline');
      decline.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, decline));
      const apply = btn('ask-card-start', isPolicy ? pcApplyLabel(card) : (MC_APPLY_LABEL[card.kind] || 'Apply'), 'data-ask-mc-apply', WF_ICO.save);
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
    if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined — ${summary}`) };
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
      const keep = btn('ask-card-not-now', 'Keep as is', 'data-ask-ac-decline');
      keep.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, keep));
      const apply = btn('ask-card-start', 'Apply', 'data-ask-ac-apply', WF_ICO.save);
      apply.addEventListener('click', () => postCard(block, rootEl, { state: 'applied' }, apply));
      actions.append(make('span', 'ask-card-actions-spacer'), keep, apply);
      rootEl.appendChild(actions);
    }
    return { el: rootEl };
  }

  // ---- Schedule card (docs/scheduled-runs.md "Ask Worca"): a proposed change to an existing schedule ------------
  const SC_ACTION_LABEL = { run_now: 'Run now', move: 'Change time', edit: 'Edit schedule', cancel: 'Cancel run', delete: 'Delete schedule' };
  const SC_APPLY_LABEL = { run_now: 'Run now', move: 'Move', edit: 'Apply', cancel: 'Cancel run', delete: 'Delete' };
  function buildScheduleCard(block) {
    const card = block.card || {};
    const summary = card.summary || 'schedule change';
    if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined — ${summary}`) };
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
      const decline = btn('ask-card-not-now', 'Decline', 'data-ask-sc-decline');
      decline.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, decline));
      const destructive = card.action === 'cancel' || card.action === 'delete';
      const apply = btn(destructive ? 'ask-card-start is-danger' : 'ask-card-start', SC_APPLY_LABEL[card.action] || 'Apply', 'data-ask-sc-apply',
        card.action === 'run_now' ? null : WF_ICO.save);
      apply.addEventListener('click', () => postCard(block, rootEl, { state: 'applied' }, apply));
      actions.append(make('span', 'ask-card-actions-spacer'), decline, apply);
      rootEl.appendChild(actions);
    }
    return { el: rootEl };
  }

  // ---- Model card (docs/models.md "Ask Worca"): a proposed catalog or provider change ------------------------------
  const MOD_KIND_LABEL = { add_model: 'Add model', edit_model: 'Edit model', remove_model: 'Remove model', provider: 'Provider', import_copilot: 'From Copilot' };
  const MOD_APPLY_LABEL = { add_model: 'Add', edit_model: 'Apply', remove_model: 'Remove', provider: 'Apply', import_copilot: 'Import' };
  function buildModelCard(block) {
    const card = block.card || {};
    const summary = card.summary || 'model change';
    if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined — ${summary}`) };
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
      const open = make('a', 'ask-card-sched-link', 'Settings › Models');
      open.href = '#settings/models';
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
      const decline = btn('ask-card-not-now', 'Decline', 'data-ask-mod-decline');
      decline.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, decline));
      const destructive = card.kind === 'remove_model';
      const apply = btn(destructive ? 'ask-card-start is-danger' : 'ask-card-start', MOD_APPLY_LABEL[card.kind] || 'Apply', 'data-ask-mod-apply', destructive ? null : WF_ICO.save);
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
    if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined — ${card.summary || `Read ${host}`}`) };
    const rootEl = make('div', `ask-card ask-mcard ask-webcard is-${block.state}`);
    rootEl.setAttribute('data-ask-webcard', block.state);
    const result = card.result || null;
    const head = make('div', 'ask-mcard-head');
    const title = block.state === 'failed' ? 'Web access not granted'
      : block.state === 'applied' ? (result && result.scope === 'always' ? 'Always allowed' : 'Allowed for this chat')
        : 'Ask Worca wants to read a new site';
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
      const decline = btn('ask-card-not-now', 'Deny', 'data-ask-web-decline');
      decline.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, decline));
      const always = btn('ask-card-not-now', 'Always allow', 'data-ask-web-always');
      always.title = `Adds ${host} to Settings → Ask Worca → Web access`;
      always.addEventListener('click', () => postCard(block, rootEl, { state: 'applied', scope: 'always' }, always));
      const chat = btn('ask-card-start', 'Allow for this chat', 'data-ask-web-chat');
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
    if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined — ${summary}`) };
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
      const decline = btn('ask-card-not-now', 'Decline', 'data-ask-clone-decline');
      decline.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, decline));
      const apply = btn('ask-card-start', 'Clone', 'data-ask-clone-apply', WF_ICO.save);
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
    if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined — ${summary}`) };
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
      ...(card.kind === 'create' ? (card.members || []).map((m) => ['Member', member(m)]) : []),
      ...(card.kind === 'add_members' ? (card.added || []).map((m) => ['Add', member(m)]) : []),
      ...(card.kind === 'remove_member' && card.removed ? [['Remove', member(card.removed)]] : []),
      ...(card.kind === 'rename' ? [['New name', card.name]] : []),
    ];
    const ul = make('ul', 'ask-mcard-changes');
    for (const [label, value] of rows) {
      if (!value) continue;
      const li = make('li');
      li.appendChild(make('span', 'ask-mcard-change-label', label));
      const val = make('span', 'ask-mcard-change-val');
      val.appendChild(make('span', label === 'Remove' ? 'ask-mcard-before' : 'ask-mcard-after', String(value)));
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
      const decline = btn('ask-card-not-now', 'Decline', 'data-ask-ws-decline');
      decline.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, decline));
      const destructive = card.kind === 'remove_member';
      const apply = btn(destructive ? 'ask-card-start is-danger' : 'ask-card-start', WS_APPLY_LABEL[card.kind] || 'Apply', 'data-ask-ws-apply', destructive ? null : WF_ICO.save);
      apply.addEventListener('click', () => postCard(block, rootEl, { state: 'applied' }, apply));
      actions.append(make('span', 'ask-card-actions-spacer'), decline, apply);
      rootEl.appendChild(actions);
    }
    return { el: rootEl };
  }

  // ---- Actions card (propose_actions_change): a project's setup + actions, or a workspace's stacks ----------------
  // Every command the card would store is shown word for word (docs/actions.md "Ask Worca"): applying stores config,
  // and a person's Start is what later runs it. Every value is text.
  const ACT_KIND_LABEL = { project: 'Project actions', stacks: 'Workspace stacks' };
  const ACT_OP_LABEL = { add: 'Add', change: 'Change', remove: 'Remove' };
  /** proposed → applied | failed, or declined. */
  function buildActionsCard(block) {
    const card = block.card || {};
    const summary = card.summary || 'actions change';
    if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined — ${summary}`) };
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
      const decline = btn('ask-card-not-now', 'Decline', 'data-ask-act-decline');
      decline.addEventListener('click', () => postCard(block, rootEl, { state: 'declined' }, decline));
      const apply = btn('ask-card-start', 'Save', 'data-ask-act-apply', WF_ICO.save);
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
          if (m.id === cur().model) item.appendChild(make('span', 'ask-model-check', '✓'));
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
    const local = { target: card.target === 'workspace' ? 'workspace' : 'project', options: null, lane: null, pills: [], projectDir: () => '', workflowId: () => '' };
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
    if (typeof card.note === 'string' && card.note) head.appendChild(make('p', 'ask-rp-why', card.note));
    rootEl.appendChild(head);

    // #397 guardrail: the model proposed a different target than the chat's pin.
    if (block.scopeMismatch) {
      rootEl.appendChild(make('div', 'ask-card-scope-warn',
        'This proposal targets a different project or workspace than the one pinned for this chat — check the target before starting.'));
    }

    // target section
    const targetSec = make('div', 'ask-rp-sec');
    const targetHead = make('div', 'ask-rp-sec-head');
    const targetSub = make('span', 'ask-rp-sec-sub');
    targetHead.append(make('span', 'ask-rp-sec-title', 'Where it runs'), targetSub);
    const seg = make('div', 'ask-card-seg');
    seg.setAttribute('role', 'tablist');
    const segBtns = {};
    for (const [t, label] of [['project', 'Project'], ['workspace', 'Workspace']]) {
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

    const wfRow = make('div', 'ask-rp-grid two');
    const workflowSel = rpSelect('ask-card-workflow', 'Workflow');
    const wfDesc = make('span', 'ask-rp-wfdesc', '');
    wfDesc.setAttribute('data-for', 'workflow');
    const wfField = rpField('Workflow', workflowSel);
    wfField.appendChild(wfDesc);
    const guardSel = rpSelect('ask-card-guardrails', 'Guardrails');
    const guardDesc = make('span', 'ask-rp-wfdesc', 'Applies to every agent in this run');
    guardDesc.setAttribute('data-for', 'guardrails');
    const guardField = rpField('Guardrails', guardSel);
    guardField.appendChild(guardDesc);
    // Interface mode (docs/ui-levels.md). The proposal's own non-default values stay on screen at
    // any mode: a run must never start under a policy or on a branch the card did not show.
    const lvTag = (node, min, keep) => { node.dataset.minLevel = min; if (keep) node.dataset.levelKeep = '1'; return node; };
    lvTag(guardField, 'advanced', !!card.guardrailsId && card.guardrailsId !== 'permissive');
    lvTag(seg, 'advanced', card.target === 'workspace');
    wfRow.append(wfField, guardField);
    targetSec.appendChild(wfRow);
    rootEl.appendChild(targetSec);
    workflowSel.addEventListener('change', () => {
      if (local.workflowUnavailable) { local.workflowUnavailable = false; err.textContent = ''; startBtn.disabled = false; }
      reloadLane();
    });

    // agents lane (reloadLane → renderLane fills laneSec)
    const laneSec = make('div', 'ask-rp-sec ask-rp-lane');
    laneSec.dataset.minLevel = 'expert';
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
        const x = make('button', null, '×');
        x.type = 'button';
        x.setAttribute('aria-label', `Remove ${p.name}`);
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

    const err = make('div', 'ask-card-err');
    rootEl.appendChild(err);

    // footer
    const foot = make('footer', 'ask-rp-foot');
    const openNp = make('button', 'ask-card-open-np', '↗ Open in New Pipeline');
    openNp.type = 'button';
    openNp.setAttribute('data-ask-card-open-np', '');
    openNp.dataset.minLevel = 'advanced';
    // New pipeline's task-source pane cannot be pre-filled from here yet; a tracker task runs from the card.
    if (card.source) openNp.hidden = true;
    openNp.addEventListener('click', () => prefillFromCard(block, rootEl, local));
    const dismissBtn = make('button', 'ask-card-not-now', 'Not now');
    dismissBtn.type = 'button';
    dismissBtn.setAttribute('data-ask-card-dismiss', '');
    dismissBtn.addEventListener('click', () => dismissCard(block, rootEl));
    const startBtn = make('button', 'ask-card-start');
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
      warning: 'A scheduled run is unattended. If this workflow asks questions, the run waits for your answer — chat notifications can reach you.',
      // Keyed off the card's LIVE target segment (local.target), not the proposal's frozen card.workspaceId —
      // the user can switch the card between project and workspace before opening the sheet.
      candidates: () => fetch(`/api/schedules/after-candidates?${local.target === 'workspace'
        ? `workspaceId=${encodeURIComponent((rootEl.querySelector('.ask-card-workspace-select') || {}).value || card.workspaceId || '')}`
        : `projectDir=${encodeURIComponent(local.projectDir())}`}`).then((r) => r.json()),
    });
    const laterBtn = make('button', 'ask-card-not-now ask-card-later', 'Schedule…');
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
      laterBtn.title = 'Start this run later';
      laterBtn.dataset.minLevel = 'advanced';
      laterBtn.addEventListener('click', async () => {
        const picked = await openScheduleSheet(sheetOpts());
        if (picked) startCard(block, rootEl, local, picked);
      });
    }
    foot.append(openNp, summary, dismissBtn, laterBtn, startBtn);
    rootEl.appendChild(foot);

    local.projectDir = () => (local.target === 'project' ? ((rootEl.querySelector('.ask-card-project-select') || {}).value || '') : '');
    local.workflowId = () => workflowSel.value || card.workflowId || 'wf_default';

    function updateTargetSub() {
      const opts = local.options;
      if (local.target === 'project') {
        const projSel = rootEl.querySelector('.ask-card-project-select');
        const srcSel = rootEl.querySelector('.ask-card-source');
        const name = projSel && projSel.selectedOptions[0] ? projSel.selectedOptions[0].textContent : (card.projectName || '');
        targetSub.textContent = `${name} · branch ${(srcSel && srcSel.value) || 'current'} · feature ${feature.value.trim() || 'auto'}`;
      } else {
        const wsSel = rootEl.querySelector('.ask-card-workspace-select');
        const row = opts && wsSel && opts.workspaces.find((w) => w && w.id === wsSel.value);
        const n = row && Array.isArray(row.projectKeys) ? row.projectKeys.length : (Array.isArray(card.members) ? card.members.length : 0);
        targetSub.textContent = `${(row && row.name) || card.workspaceName || 'workspace'} · ${n} member${n === 1 ? '' : 's'} · feature ${feature.value.trim() || 'auto'}`;
      }
    }
    feature.addEventListener('input', updateTargetSub);

    function renderTarget() {
      targetHost.replaceChildren();
      const opts = local.options;
      const grid = make('div', 'ask-rp-grid');
      if (local.target === 'project') {
        const projSel = rpSelect('ask-card-project-select', 'Project');
        const srcSel = rpSelect('ask-card-source', 'Source branch');
        if (opts) {
          fillSelect(projSel, opts.projects.map((p) => ({ value: p.path, label: p.exists === false ? `${p.name} (missing)` : p.name })), card.projectDir || (opts.projects[0] && opts.projects[0].path) || '');
          // The fill is async: the sub-line reads the select again when the branches land,
          // or a proposed sourceBranch would read "branch current" until the user touches it.
          loadBranchesInto(srcSel, projSel.value, card.sourceBranch || '').then(updateTargetSub);
        }
        projSel.addEventListener('change', () => { loadBranchesInto(srcSel, projSel.value, '').then(updateTargetSub); updateTargetSub(); reloadLane(); });
        // #527: "from origin/x (remote only, 2 behind)" describes the PROPOSED branch only.
        const srcField = rpField('Source branch', srcSel, sourceRefNote(card.sourceRef));
        const srcHint = srcField.querySelector('.ask-rp-hint');
        srcSel.addEventListener('change', () => {
          if (srcHint && srcSel.value !== card.sourceBranch) srcHint.textContent = '';
          updateTargetSub();
        });
        grid.append(rpField('Project', projSel), lvTag(srcField, 'advanced', !!card.sourceBranch),
          lvTag(rpField('Feature branch', feature, 'created for the run'), 'advanced', !!card.featureBranch));
        targetHost.appendChild(grid);
        updateTargetSub();
        return;
      }
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
        const list = row && Array.isArray(row.projectKeys)
          ? row.projectKeys.map((k, i) => ({ projectKey: k, name: wsBasename(row.projectPaths && row.projectPaths[i]) }))
          : Array.isArray(card.members) ? card.members.map((m) => ({ projectKey: m.projectKey, name: m.projectName })) : [];
        members.textContent = list.map((m) => m.name).join(', ');
        for (const m of list) {
          const inp = doc.createElement('input');
          inp.type = 'text';
          inp.className = 'ask-card-member-src';
          inp.placeholder = 'auto';
          inp.setAttribute('data-project-key', m.projectKey);
          if (card.sourceBranchByKey && card.sourceBranchByKey[m.projectKey]) inp.value = card.sourceBranchByKey[m.projectKey];
          memberHost.appendChild(rpField(m.name, inp));
        }
        updateTargetSub();
      };
      wsSel.addEventListener('change', renderMembers);
      const wsField = rpField('Workspace', wsSel);
      wsField.appendChild(members);
      grid.append(wsField, lvTag(rpField('Source branch', srcInput, 'default for members'), 'advanced', !!card.sourceBranch),
        lvTag(rpField('Feature branch', feature), 'advanced', !!card.featureBranch));
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
    const laneCtx = { summary, workflowId: () => local.workflowId() };
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
      loadLane(workflowId, projectDir).then((lane) => {
        if (st.destroyed || seq !== laneSeq) return;            // a later reload won
        local.lane = lane;
        wfDesc.textContent = lane ? workflowDesc(lane.wf, lane.registry, lane.runConfig) : '';
        renderLane(laneSec, lane, laneCtx);
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
      err.textContent = `Workflow ${card.workflowId} is not available — pick one`;
      startBtn.disabled = true;
      local.workflowUnavailable = true;
    }

    renderTarget();
    loadCardOptions({ fresh: true }).then((opts) => {
      if (st.destroyed) return;
      local.options = opts;
      // Auto is not a saved workflow: listed only when Ask Worca proposed it (a plain card keeps its list).
      const autoOpt = card.workflowId === 'wf_auto' ? [{ value: 'wf_auto', label: 'Auto — picks the workflow when the run starts' }] : [];
      fillSelect(workflowSel, [...autoOpt, ...opts.workflows.map((w) => ({ value: w.id, label: workflowPickerLabel(w, null) || w.name || w.id }))], card.workflowId || 'wf_default');
      if (card.workflowId && workflowSel.value !== card.workflowId) markWorkflowUnavailable();
      fillSelect(guardSel, opts.guardrails.map((g) => ({ value: g.id, label: g.id === 'permissive' ? 'Permissive' : (g.name || g.id) })), card.guardrailsId || 'normal');
      renderTarget();
      reloadLane();
    });
    rootEl.__rp = { local, wfDesc, summary, laneSec, briefSec, brief, titleInput, lane: () => local.lane };   // consumed by later tasks + tests
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
    // A tracker task: the reference, never a prompt (POST /api/run takes source OR prompt).
    if (card.source) {
      delete body.prompt;
      body.source = {
        type: 'plugin', plugin: card.source.plugin, sourceId: card.source.sourceId, taskId: card.source.taskId,
        ...(card.source.profile ? { profile: card.source.profile } : {}), ...(card.source.inputs ? { inputs: card.source.inputs } : {}),
      };
    }
    const feature = rootEl.querySelector('.ask-card-feature').value.trim();
    if (feature) body.featureBranch = feature;
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
    for (const sel of ['.ask-card-workflow', '.ask-card-project-select', '.ask-card-workspace-select', '[data-ask-card-seg]']) {
      for (const node of rootEl.querySelectorAll(sel)) node.disabled = on;
    }
  }

  async function startCard(block, rootEl, local, schedule = null) {
    const err = rootEl.querySelector('.ask-card-err');
    const startBtn = rootEl.querySelector('[data-ask-card-start]');
    err.textContent = '';
    startBtn.disabled = true;
    freezeTargetInputs(rootEl, true);
    try {
      // D3: read-only, so it runs BEFORE saveLaneEdits — a refusal here must not leave the config already written.
      const ex = await collectCardExtras(local);
      if (ex.error) { err.textContent = ex.error; return; }
      const saveErr = await saveLaneEdits(local);            // the previous phase's guard, now second
      if (saveErr) { err.textContent = saveErr; return; }
      const body = { ...collectCardBody(rootEl, local, block.card || {}), askThreadId: st.threadId, askCardId: block.id, ...(schedule || {}) };
      // Run chains: "the branch of the run before it" is a flag, and the wire refuses it next to a branch name.
      // Keyed off the schedule being POSTED — a Start now on an after-proposal carries none and keeps the picked branch.
      if (body.sourceFromPrevious) { delete body.sourceBranch; delete body.sourceBranchByKey; }
      if (ex.extras.length) body.extras = ex.extras;
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
      startBtn.disabled = false;
      freezeTargetInputs(rootEl, false);
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
      if (res.status === 409 && msg === 'turn in flight') msg = 'Ask Worca is still replying — try again once the answer lands.';
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
    if (out && out.turn && out.turn.error && err) err.textContent = `Ask Worca could not reply: ${out.turn.error}`;
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
      featureBranch: rootEl.querySelector('.ask-card-feature').value.trim(),
      // The picker has no way to re-derive this: a `project` proposal opened in New Pipeline would
      // otherwise start with the row's default `global` and restructure the wrong scope (B17).
      memoryScope: card.memoryScope || null,
    };
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
    } else {
      p.projectDir = rootEl.querySelector('.ask-card-project-select').value;
      const src = rootEl.querySelector('.ask-card-source');
      p.sourceBranch = src ? src.value : '';
    }
    // Nothing to save or fetch → hand over synchronously (the caller may not await).
    const pending = cardPending(local);
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
  function isProgressBlock(block) {
    const card = block.card || {};
    if (card.type === PROGRESS_CARD_TYPE) return true;
    if (card.type === COMMAND_CARD_TYPE || card.type === 'workflow' || card.type === 'metrics' || card.type === 'policy' || card.type === 'schedule' || card.type === 'model' || card.type === 'clone' || card.type === 'web' || card.type === 'workspace' || card.type === 'actions' || card.type === 'away') return false;
    return block.state === 'started' || (block.state === 'failed' && !!block.runId);
  }
  function buildCard(block) {
    if (!st.cardEls) st.cardEls = new Map();
    const cached = st.cardEls.get(block.id);
    const isWorkflow = !!(block.card && block.card.type === 'workflow');
    // A policy card is a metrics card with different words (buildMetricsCard branches on the type).
    const isMetrics = !!(block.card && (block.card.type === 'metrics' || block.card.type === 'policy'));
    const isSchedule = !!(block.card && block.card.type === 'schedule');
    const isModel = !!(block.card && block.card.type === 'model');
    const isClone = !!(block.card && block.card.type === 'clone');
    const isWorkspace = !!(block.card && block.card.type === 'workspace');
    const isWeb = !!(block.card && block.card.type === 'web');
    const isActions = !!(block.card && block.card.type === 'actions');
    const isAway = !!(block.card && block.card.type === 'away');
    const isCommand = !!(block.card && block.card.type === COMMAND_CARD_TYPE);
    const isProgress = isProgressBlock(block);
    if (cached && cached.state === block.state && (isWorkflow || isMetrics || isSchedule || isModel || isClone || isWeb || isWorkspace || isActions || isAway || isCommand || isProgress || block.state === 'proposed')) return cached.el;
    if (cached) disposeCardEntry(cached);
    const built = isWorkflow ? buildWorkflowCard(block, cached)
      : isMetrics ? buildMetricsCard(block)
      : isSchedule ? buildScheduleCard(block)
      : isModel ? buildModelCard(block)
      : isClone ? buildCloneCard(block)
      : isWeb ? buildWebCard(block)
      : isWorkspace ? buildWorkspaceCard(block)
      : isActions ? buildActionsCard(block)
      : isAway ? buildAwayCard(block)
      : isCommand ? buildCommandCard(block)
      : isProgress ? buildProgressCard(block)
        : { el: block.state === 'proposed' ? buildCardForm(block) : buildCardTerminal(block) };
    st.cardEls.set(block.id, { el: built.el, state: block.state, handle: built.handle || null, dispose: built.dispose || null, animate: !!built.animate, cancelAnim: null, lastW: -1 });
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
   *  mid-choreography (measured) — so cancel() (which lands everything) runs before the relayout. */
  function relayoutCards() {
    if (!st.cardEls) return;
    for (const c of st.cardEls.values()) {
      if (!c.handle || !c.el.isConnected) continue;
      const w = (c.handle.parts.graph && c.handle.parts.graph.clientWidth) || 0;
      if (w !== c.lastW) {
        if (c.cancelAnim) { try { c.cancelAnim(); } catch { /* ignore */ } c.cancelAnim = null; }
        c.lastW = w;
        c.handle.relayout(w);
      }
      if (c.animate) { c.animate = false; c.cancelAnim = playAssembly(c.handle, { win, onDone: () => { c.cancelAnim = null; } }); }
    }
  }

  // ---- command cards (ui/public/ask-command-card.mjs; Ask agent mode, #574) ------------------------------------------
  /** One command Ask ran: hydrated once over REST (a reload, a finished block), then live from ask-command frames. */
  function buildCommandCard(block) {
    const card = block.card || {};
    const blockId = String(card.blockId || '');
    const handle = createCommandCard({ doc, card, onStop: (sid) => {
      fetch(`/api/terminal/sessions/${encodeURIComponent(sid)}/stop`, { method: 'POST' }).catch(() => { /* the next frame says what happened */ });
    }, onShow: (sid) => showTerminal(sid, { auto: false }) });
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
    return { cardId: block.id, pipelineId: null, runId: block.runId || null, projectKey: card.projectKey || null, workspaceId: card.workspaceId || null,
      title: card.title || card.brief || 'run', label: card.workspaceName || card.projectName || '' };
  }
  /** Fold the thread's run links into the identity: the first `state` reveals the pipeline id; a resume moves the runId. */
  function refreshProgressIdent(ident) {
    if (!st.model) return;
    const link = (ident.pipelineId && st.model.runLinkByPipeline(ident.pipelineId)) || st.model.runLinkForCard(ident.cardId)
      || (ident.runId ? (() => { const l = st.model.runLinks().get(ident.runId); return l ? { runId: ident.runId, ...l } : null; })() : null);
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
      closeSheet();                                            // openNewPipeline precedent: close, then route
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

  function toolRow(block) {
    const rowEl = make('div', 'ask-tool-row');
    rowEl.dataset.minLevel = 'advanced';            // what the assistant ran, step by step
    const mcp = parseMcpToolName(block.name);
    if (mcp && mcp.server !== 'worca') {
      // A registry copy's tool (MCP registry §9.7): `<copy> · <tool>` in the name cell, then the
      // input preview — no op cell, since a third-party tool name has no worca verb to show.
      rowEl.appendChild(make('span', 'ask-tool-mcp', `${mcp.server} · ${mcp.tool}`));
      rowEl.appendChild(make('span', 'ask-tool-target', clipInput(block.input)));
    } else if (block.name === 'Skill' && block.input && typeof block.input.skill === 'string') {
      // Skills registry §4.4: a set skill the turn loaded — `skill`, then its qualified name (and its args).
      const args = typeof block.input.args === 'string' && block.input.args ? block.input.args : '';
      rowEl.appendChild(make('span', 'ask-tool-op', 'skill'));
      rowEl.appendChild(make('span', 'ask-tool-target', args ? `${block.input.skill} · ${args.length > 60 ? `${args.slice(0, 60)}…` : args}` : block.input.skill));
    } else {
      const short = String(block.name || '').replace(/^mcp__worca__/, '');
      const parts = short.split('_');
      rowEl.appendChild(make('span', 'ask-tool-op', parts[0] || short));
      // A script tool reads as `test script runTests → blocking, exit 1` (§9.3): the op column
      // (a fixed 38 px cell) keeps the verb, the target column carries the key and the outcome —
      // a script's input is a whole program, so the JSON preview is worth nothing there.
      const script = scriptToolLine(short, block);
      const target = script ? script.target : parts.slice(1).join(' ');
      const preview = script ? '' : clipInput(block.input);
      rowEl.appendChild(make('span', 'ask-tool-target', preview ? (target ? `${target} · ${preview}` : preview) : target));
    }
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
   * The block above the answer, with an `update(row)` that patches it IN PLACE:
   * the head is re-stated (one line, fixed height), a tool/agent row already on
   * screen is replaced by its own fresh node, and a new one is appended into its
   * group. Nothing outside `.ask-activity` is touched, so an ask-label or
   * ask-block frame can no longer re-create the message around the text being
   * read (which replayed the entry animation on every frame of a turn).
   */
  function buildActivity(row) {
    const activity = make('div', 'ask-activity');
    const head = make('div', 'ask-activity-head');
    activity.appendChild(head);
    const toolEls = new Map();     // block id → the row currently rendered for it
    const agentEls = new Map();
    let agents = null;             // the .ask-agents section, once the row has one
    let agentsCount = null;

    function renderHead(r) {
      const isLive = isLiveRow(r);
      const stopped = r.status === 'stopped' || r.status === 'error';
      const parts = [];
      if (isLive) parts.push(make('span', 'ask-activity-label', 'Thinking'));
      else if (!stopped) parts.push(make('span', 'ask-activity-label', 'Done'));
      parts.push(make('span', `ask-dot${isLive ? ' ask-dot-run' : r.status === 'error' ? '' : ' ask-dot-done'}`));
      // The head names its state in one word ahead of the dot — Thinking, Done, or
      // Stopped after — and nothing more while the turn is live: the orb row at the
      // bottom of the message owns the elapsed and the meter, and printing either
      // set twice is the noise this replaced. A turn that ended badly says so
      // instead of Done; nothing else marks a stop. A turn that ended before any
      // result, or within a few ms (a signed-out CLI answers in ~20 ms), has no
      // duration worth printing: plain Stopped, never a dangling "Stopped after"
      // or "Stopped after 0.0s".
      if (!isLive) {
        const shown = fmtElapsed(r.durationMs);
        const elapsed = shown && shown !== '0.0s' ? shown : '';
        if (stopped) parts.push(make('span', 'ask-activity-label', elapsed ? 'Stopped after' : 'Stopped'));
        parts.push(make('span', 'ask-activity-elapsed', elapsed));
        parts.push(make('span', 'ask-activity-spacer'));
        const meter = [fmtCtx(r.usage && r.usage.ctx), fmtUsd(r.costUsd)].filter(Boolean).join(' · ');
        parts.push(make('span', 'ask-activity-meter', meter));
      }
      head.replaceChildren(...parts);
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
      renderHead(r);
      const blocks = Array.isArray(r.blocks) ? r.blocks : [];
      const agentBlocks = blocks.filter((b) => b && b.kind === 'agent');
      if (agentBlocks.length && !agents) {
        agents = make('div', 'ask-agents');
        agents.dataset.minLevel = 'expert';           // per-agent logs (docs/ui-levels.md)
        const cap = make('div', 'ask-agents-cap');
        cap.appendChild(make('span', null, 'Sub-agents'));
        agentsCount = make('span', 'ask-agents-count', '');
        cap.appendChild(agentsCount);
        agents.appendChild(cap);
        activity.appendChild(agents);
      }
      // Tool rows go before the sub-agent section, so a tool that lands after the
      // first agent still slots into its own group.
      syncRows(blocks.filter((b) => b && b.kind === 'tool'), toolEls, toolRow, activity, agents);
      if (agents) {
        agentsCount.textContent = String(agentBlocks.length);
        syncRows(agentBlocks, agentEls, agentRow, agents, null);
        if (!agentBlocks.length) { agents.remove(); agents = null; agentsCount = null; }
      }
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
    el.orb = createThinkingOrb({ doc, win, size: 28.5 });
    const wrap = make('div', 'ask-thinking');
    wrap.appendChild(el.orb.el);
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
  }

  function renderAnswerInto(div, row) {
    const isLive = !!(st.model && st.model.live() && st.model.live().messageId === row.id);
    const text = isLive ? st.model.live().text : row.text || '';
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
      else if (b.kind === 'card') parts.push(`c:${b.id}:${b.state || ''}:${(b.card && b.card.type) || ''}:${b.runId || ''}:${b.error || ''}`);
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
    let renderAnswer = null;
    if (row.role === 'user') {
      // PD6: a synthetic row (a workflow-card event) is a notice, never a bubble — its text is the model-facing event line.
      const synthetic = (row.blocks || []).filter((b) => b && b.kind === 'notice' && b.synthetic);
      if (synthetic.length) {
        for (const b of synthetic) wrap.appendChild(buildNotice(b));
      } else {
        const bubble = make('div', 'ask-user-bubble', row.text || '');
        wrap.appendChild(bubble);
        const atts = (row.blocks || []).filter((b) => b && b.kind === 'attachment');
        if (atts.length) {
          const pills = make('div', 'extras-pills ask-user-pills');
          for (const b of atts) pills.appendChild(buildAttachmentPill(b));
          wrap.appendChild(pills);
        }
      }
    } else if (row.role === 'system') {
      const notices = (row.blocks || []).filter((b) => b && b.kind === 'notice');
      if (notices.length) for (const b of notices) wrap.appendChild(buildNotice(b));
      else wrap.appendChild(buildNotice({ text: row.text }));
    } else {
      const activity = buildActivity(row);
      wrap.appendChild(activity.el);
      const answer = make('div', 'ask-answer');
      wrap.appendChild(answer);
      renderAnswer = () => renderAnswerInto(answer, cur);
      renderAnswer();
      let tailSig = null;
      const renderTail = () => {
        const sig = tailSignature(cur);
        if (sig === tailSig) return;
        tailSig = sig;
        while (wrap.lastChild && wrap.lastChild !== answer) wrap.removeChild(wrap.lastChild);
        for (const b of cur.blocks || []) {
          if (!b) continue;
          if (b.kind === 'notice') wrap.appendChild(buildNotice(b));
          else if (b.kind === 'card') wrap.appendChild(buildCard(b, cur));
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
            const classified = (cur.blocks || []).some((b) => b && b.kind === 'notice' && b.errorClass);
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
          // Idempotent, and the only re-arm on the adoption path: a thread whose
          // ask-start the ring buffer already evicted goes live without ever
          // passing through startElapsed(), and would otherwise show a dead orb.
          el.orb.start();
          updateThinking();
        }
      };
      renderTail();
      // The answer is deliberately NOT re-rendered here: its text only ever moves
      // on `dirty.answer` (renderAnswerFor) or with `dirty.structure`, and
      // replacing its subtree per tool row is exactly what defeated the browser's
      // scroll anchoring mid-turn.
      patch = (row2) => { cur = row2; activity.update(row2); renderTail(); };
    }
    const entry = {
      el: wrap,
      renderAnswer,
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
    if (!st.model) return;
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
  }

  // Bumped by every loadThread()/newThread()/thread creation: whichever GET resolves
  // LAST used to win unconditionally, so a slow old thread load overwrote a newer
  // switch (review of PR #376). A load whose generation is stale returns null.
  let loadGen = 0;
  async function loadThread(id) {
    const gen = ++loadGen;
    let res = null;
    try { res = await fetch(`/api/ask/threads/${id}`); } catch { return null; }
    if (gen !== loadGen || st.destroyed) return null;
    if (!res || !res.ok) {
      if (res && res.status === 404 && readStoredThread() === id) storeThread(null);
      return null;
    }
    let snap = null;
    try { snap = await res.json(); } catch { return null; }
    if (gen !== loadGen || st.destroyed) return null;
    // A SWITCH starts a fresh ledger, so the new chat rises in. A resync or a
    // reconnect re-loads the SAME thread and must keep it: those repaint rows the
    // user is already reading, mid-turn.
    const switched = st.threadId !== id;
    if (switched) stopVoice();
    if (switched) st.seenRows = new Set();
    st.threadId = id;
    st.model = createThreadModel({ threadId: id });
    st.model.load(snap);
    el.title.textContent = (snap.thread && snap.thread.title) || 'Ask Worca';
    applyThreadScope(snap.thread && snap.thread.context);   // #397: restore the pin
    setContexts(snap.thread && snap.thread.contexts);
    // The picker follows the chat — on a SWITCH only: a resync of the same thread
    // would otherwise clobber a pick the user just made (its PATCH may not have landed).
    if (switched) applyThreadPick(snap.thread);
    if (switched) st.mcp.off = mcpOffOf(snap.thread && snap.thread.mcpOff);   // §9.4: the chat's own choices
    if (switched) { st.agent.on = snap.thread?.agentMode !== false; paintAgent(); }   // #574: a resync keeps an unsaved click
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
    if (snap.inFlight) { subscribe(id); startElapsed(); }
    repaintProgressCards({ hydrate: true });   // thread load + reconnect (onHello → resync → loadThread): re-resolve + re-hydrate every card
    return snap;
  }

  function switchThread(id) {
    if (!id) return Promise.resolve(null);
    storeThread(id);
    return loadThread(id);
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
    if (el.orb) el.orb.start();
  }
  function stopElapsed() {
    if (st.elapsedTimer) { clearInterval(st.elapsedTimer); st.elapsedTimer = null; }
    st.elapsedStart = null;
    // The orb row is simply not rebuilt into a finished message, so the node is
    // left detached — with no custom-element lifecycle to notice, the rAF loop
    // has to be cut here or it paints an orphan for the rest of the session.
    if (el.orb) el.orb.stop();
  }
  function updateLiveElapsed() {
    if (st.elapsedStart != null && el.elapsed && st.model && st.model.live()) {
      el.elapsed.textContent = fmtElapsed(now() - st.elapsedStart);
    }
    updateThinking();
  }

  function afterFrame(frame) {
    if (frame.type === 'ask-start') { startElapsed(Date.parse(frame.startedAt)); updateSendStop(); }
    else if (typeof frame.seq === 'number' && frame.type !== 'ask-done' && frame.type !== 'ask-error' && st.model && st.model.live() && el.send && !el.send.hidden) {
      // A JOB frame ADOPTED mid-turn (no ask-start seen — the ring buffer evicted
      // it, or a broadcast delta beat the subscribe replay): the turn is live now,
      // so the composer must show Stop and the timer must run (review of PR #376).
      // Out-of-turn frames (ask-title — early now — ask-worktrees, ask-message)
      // never adopt: startElapsed() here would reset the running clock.
      startElapsed(); updateSendStop();
    }
    if (frame.type === 'ask-done' || frame.type === 'ask-error') {
      stopElapsed(); updateSendStop(); announce('answer finished');
      if (!st.open) setUnread(true);
      // Conversation chips: the turn's resolved list rides ask-done (an older server omits it: keep what is shown).
      if (frame.type === 'ask-done' && Array.isArray(frame.contexts)) setContexts(frame.contexts);
      // P4: a finished turn may have created/removed/navigated worktrees. This must
      // NOT live in updateSendStop() — that also runs from loadThread, so a
      // running→idle latch there fires a SECOND snapshot GET on every resync.
      refreshWorktrees();
      if (st.voicePendingSend) { st.voicePendingSend = false; if (st.voice && st.voice.active()) voiceSend(); }
    }
    else if (frame.type === 'ask-message' && frame.message && typeof frame.message.text === 'string'
      && /is waiting for your answer/.test(frame.message.text)) announce('run needs an answer');
  }

  // Settings → "Delete all chat history" broadcast (seq-less, threadId-less): every
  // row is gone server-side, so a tab still holding st.threadId would keep a dead
  // chat in memory until its next fetch 404s. Reset exactly like the "+" button.
  function onHistoryCleared() {
    closePopover({ focusTrigger: false });
    if (st.threadId) newThread();
  }

  function pushServerFrame(frame) {
    if (st.destroyed || !frame) return;
    if (frame.type === 'ask-history-cleared') {
      // A shared deployment's clear names the threads it removed: only a tab showing one of them resets.
      if (Array.isArray(frame.threadIds) && !frame.threadIds.includes(st.threadId)) { scheduleThreadsRefresh(); return; }
      onHistoryCleared();
      return;
    }
    if (frame.type === 'ask-command') {                         // #574: a command card's live state, this chat only
      if (frame.threadId !== st.threadId) return;
      applyCommandFrame(frame.command);
      // Shared terminal: a command starting in the chat the user is looking at shows its tab in the terminal pane
      // (the pane decides whether to open or switch); once per block.
      const c = frame.command;
      if (st.open && c && c.status === 'running' && typeof c.sessionId === 'string' && !st.commandsShown.has(c.blockId)) {
        st.commandsShown.add(c.blockId);
        if (st.commandsShown.size > 200) st.commandsShown.delete(st.commandsShown.values().next().value);
        showTerminal(c.sessionId, { auto: true });
      }
      return;
    }
    if (THREADS_REFRESH_FRAMES.has(frame.type)) scheduleThreadsRefresh();
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
  // dedupe/adoption absorb it). Latched: one resync at a time.
  function resync() {
    if (st.resyncing || !st.threadId || st.destroyed) return;
    st.resyncing = true;
    const id = st.threadId;
    Promise.resolve()
      .then(() => loadThread(id))
      .then((snap) => { if (snap && snap.inFlight) subscribe(id, { force: true }); })
      .catch(() => { /* the thread may be gone; loadThread handled storage */ })
      .then(() => { st.resyncing = false; });
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
    if (d.title) el.title.textContent = st.model.thread().title || 'Ask Worca';
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
    applyPin();
    // A row counts as SHOWN once a flush ends with it in the column. Marking it
    // inside renderTranscript() would be too early: loadThread paints once and the
    // structural flush behind it repaints immediately, and the browser only ever
    // shows the second element — a freshly loaded thread would never rise in.
    if (st.rowEls) for (const id of st.rowEls.keys()) st.seenRows.add(id);
  }

  function updatePinFromScroll() {
    const t = el.transcript;
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
      if (max > 0 && t.scrollTop < max) t.scrollTop = t.scrollHeight;
    }
    if (el.jump) el.jump.hidden = st.pinned;
  }

  function jumpToLatest() {
    st.pinned = true;
    el.transcript.scrollTop = el.transcript.scrollHeight;
    if (el.jump) el.jump.hidden = true;
  }

  // ---- mount ----------------------------------------------------------------
  const root = buildRoot();
  doc.addEventListener('keydown', onDocKeydown, true);
  doc.addEventListener('pointerdown', onDocPointerdown, true);
  win.addEventListener('resize', onWinResize);
  // MCP registry §9.4: in Auto the page is the scope, so a route change re-previews the picker.
  const onHashChange = () => { if (!st.scope.pinned) scheduleMcpRefresh(); };
  win.addEventListener('hashchange', onHashChange);
  // The rail collapsing changes the dock width by 222px with no window resize;
  // observe the dock itself (guarded: jsdom has no ResizeObserver — P5's idiom).
  let dockRo = null;
  if (typeof win.ResizeObserver === 'function') {
    dockRo = new win.ResizeObserver(onWinResize);
    dockRo.observe(el.dock);
  }

  function destroy() {
    if (st.destroyed) return;
    st.destroyed = true;
    finishResize();                                  // a mid-drag unmount leaves no document listeners
    closePopover({ focusTrigger: false });
    if (st.elapsedTimer) { clearInterval(st.elapsedTimer); st.elapsedTimer = null; }
    if (el.orb) el.orb.stop();
    settlePillOrb();
    clearTipTimer();
    doc.removeEventListener('keydown', onDocKeydown, true);
    doc.removeEventListener('pointerdown', onDocPointerdown, true);
    win.removeEventListener('resize', onWinResize);
    win.removeEventListener('hashchange', onHashChange);
    if (dockRo) { dockRo.disconnect(); dockRo = null; }
    if (st.runTick) { clearInterval(st.runTick); st.runTick = null; }
    if (st.runUnsub) { try { st.runUnsub(); } catch { /* ignore */ } st.runUnsub = null; }
    pruneCardEls();                                  // every card graph mount and its ResizeObserver goes with the sheet
    clearTimeout(st.voiceLongPress);
    if (st.voice) { const v = st.voice; st.voice = null; Promise.resolve(v.destroy()).catch(() => {}); }
    root.remove();
  }

  return Object.freeze({
    root,
    open: openSheet,
    close: closeSheet,
    toggle: toggleSheet,
    isOpen: () => st.open,
    appendToComposer,
    pushServerFrame,
    onHello,
    ownsKey,
    destroy,
  });
}
