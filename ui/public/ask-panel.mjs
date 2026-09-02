// ui/public/ask-panel.mjs — the Ask Worca floating sheet (spec §10). One
// factory, everything in the closure: the module is evaluated once per test
// file even though app.js is re-imported with a cache-buster, so module scope
// holds no state. All markup is built with DOM APIs and textContent — no
// innerHTML for content anywhere in this file (the markdown renderer owns the
// only sanitized-HTML path).
import { createThreadModel } from './ask-model.mjs';
import { createMarkdownRenderer } from './ask-markdown.mjs';
import { createThinkingOrb } from './thinking-orb.mjs';
import { workflowPickerLabel } from './results-view.mjs';

/**
 * Cold-start pick, used ONLY until GET /api/ask/models resolves — and afterwards
 * only if that payload carries no `default` (older stubs / a 500). The authoritative
 * default is ASK_LIMITS.defaultModel/defaultEffort, shipped as `catalog.default`
 * and already validated against the live catalog by src/core/ask/models.mjs.
 */
const FALLBACK_PICK = Object.freeze({ model: 'claude-opus-5', effort: 'high' });

const ICONS = {
  threads: 'M4 6h16M4 12h16M4 18h9',
  plus: 'M12 5v14M5 12h14',
  chevronDown: 'M6 9l6 6 6-6',
  send: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
};

export function fmtTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1000 ? `${n} tok` : `${(n / 1000).toFixed(1)}k tok`;
}
/** Context fill (usage.ctx / totals.ctx) — a snapshot, never a cumulative sum. */
export function fmtCtx(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1000 ? `${n} ctx` : `${(n / 1000).toFixed(1)}k ctx`;
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

/** The launcher's shortcut hint: the keydown handler accepts BOTH Meta+K and
 *  Ctrl+K, but the glyph shown must match the viewer's OS — '⌘K' is meaningless
 *  on Windows/Linux, where the working chord is Ctrl+K. */
export function shortcutLabel(win) {
  const nav = win?.navigator;
  const platform = String(nav?.userAgentData?.platform || nav?.platform || '');
  return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘K' : 'Ctrl K';
}

export function createAskPanel({ doc, win, fetch, sendWs, confirm, getPageContext, openNewPipeline, loadMarkdown, hljsLoader, storage, raf, now }) {
  const storedPick = readStoredModel();   // hoisted declaration (defined below); null when nothing is stored
  const st = {
    open: false,
    threadId: null,
    model: null,              // createThreadModel for the active thread (Task 4+)
    picker: {
      model: storedPick && storedPick.model ? storedPick.model : FALLBACK_PICK.model,
      effort: storedPick ? storedPick.effort : FALLBACK_PICK.effort,
    },
    // D11 provenance, tracked per slot: only a MODEL the user actually picked
    // outranks the backend default. An effort-only record leaves the model slot
    // unclaimed, so a later change to ASK_LIMITS.defaultModel still reaches here.
    pickerFromStore: !!(storedPick && storedPick.model),
    effortFromStore: storedPick !== null,
    catalog: null,
    // #397: the thread's project/workspace scope. pinned:false = Auto (follow the
    // page — today's behaviour). label caches the display name once resolved.
    scope: { pinned: false, projectKey: null, workspaceId: null, label: null },
    popover: null,            // {panel, trigger, onClose, build, refreshOn}
    expandedAgents: new Set(),
    worktrees: [],            // P4 §10: the chat's open worktrees (snapshot-fed)
    pinned: true,
    prevFocus: null,
    pendingFiles: [],
    sending: false,
    subscribedFor: null,
    elapsedTimer: null,
    elapsedStart: null,
    flushArmed: false,
    resyncing: false,
    firstOpenDone: false,
    destroyed: false,
    lastAnswerRender: 0,
    rowEls: null,
    cardEls: null,
    cardOptions: null,
    catalogLoading: null,
    mdKicked: false,
    answerPending: null,
    rowPending: null,
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
  function storeModel() {
    // Provenance travels with the record: writing st.picker.model when the user never
    // chose one would pin the cold-start literal (or a default they merely saw), and
    // the backend would be authoritative exactly once per browser.
    const rec = { model: st.pickerFromStore ? st.picker.model : null, effort: st.picker.effort };
    try { storage.setItem('worca-cc.ask.model', JSON.stringify(rec)); } catch { /* ignore */ }
  }
  function readStoredThread() { try { return storage.getItem('worca-cc.ask.thread') || null; } catch { return null; } }
  function storeThread(id) {
    try {
      if (id) storage.setItem('worca-cc.ask.thread', id);
      else storage.removeItem('worca-cc.ask.thread');
    } catch { /* ignore */ }
  }

  // ---- tiny DOM helpers -----------------------------------------------------
  function make(tag, className, text) {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
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
    const pillLogo = doc.createElement('img');
    pillLogo.className = 'ask-pill-logo';
    pillLogo.src = '/assets/worca-favicon.png';
    pillLogo.alt = '';
    pill.appendChild(pillLogo);
    pill.appendChild(make('span', 'ask-pill-label', 'Ask Worca'));
    pill.appendChild(make('span', 'ask-kbd', shortcutLabel(win)));
    pill.addEventListener('click', openSheet);

    const sheet = make('section', 'ask-sheet');
    sheet.hidden = true;
    sheet.setAttribute('data-ask-sheet', '');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Ask Worca');

    const header = make('header', 'ask-header');
    const logo = doc.createElement('img');
    logo.className = 'ask-header-logo';
    logo.src = '/assets/worca-favicon.png';
    logo.alt = '';
    header.appendChild(logo);
    el.title = make('div', 'ask-title', 'Ask Worca');
    // Header is logo → title → spacer → icon buttons. The #397 scope selector
    // used to sit here; it now lives in the composer's bottom row next to the
    // "+" attach button (see buildComposer). A long haiku title still ellipsizes.
    header.appendChild(el.title);
    header.appendChild(make('span', 'ask-header-spacer'));
    const threadsBtn = iconButton('ask-icon-btn', 'Recent chats', ICONS.threads, () => toggleThreadsPopover(threadsBtn));
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
    dock.appendChild(sheet);
    dock.appendChild(pill);
    el.pill = pill;
    el.sheet = sheet;
    return dock;
  }

  // Mirrors src/core/ask/attachment-kind.mjs + limits.mjs (#398): text kinds are
  // UTF-8 capped at 512 KB, binary kinds (images + PDF) at 5 MB; the server
  // re-validates everything, these are just early clear messages.
  const ASK_ATTACH_EXT = ['.md', '.markdown', '.txt', '.json', '.csv', '.log'];
  const ASK_ATTACH_BINARY = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
  };
  const ASK_MAX_TEXT_BYTES = 524_288;
  const ASK_MAX_BINARY_BYTES = 5 * 1024 * 1024;
  const ASK_MAX_THREAD_BYTES = 25 * 1024 * 1024;

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
      const serverBytes = st.model ? st.model.attachmentsBytes() : 0;
      const pendingBytes = others.reduce((n, p) => n + p.bytes, 0);
      if (serverBytes + pendingBytes + f.size > ASK_MAX_THREAD_BYTES) { setComposerMsg('attachment budget for this thread exceeded'); continue; }
      let dataBase64 = '';
      try {
        dataBase64 = bytesToBase64(new Uint8Array(await f.arrayBuffer()));
      } catch { setComposerMsg(`could not read ${name}`); continue; }
      const attKind = binMime ? (binMime.startsWith('image/') ? 'image' : 'binary') : 'text';
      st.pendingFiles = [...others, { name, bytes: f.size, dataBase64, attKind, mime: binMime || null }];
    }
    renderChips();
  }

  function updateSendStop() {
    if (!el.send) return;
    const streaming = !!(st.model && st.model.live());
    el.send.hidden = streaming;
    el.stop.hidden = !streaming;
  }

  function updateMeters() {
    if (!el.meterTokens) return;
    const totals = st.model ? st.model.totals() : { live: null };
    // Context fill: the streaming call's figure while live, else the last turn's.
    // A thread with turns but no ctx predates the metric — show nothing, never a fake 0.
    const liveCtx = totals.live && totals.live.usage ? totals.live.usage.ctx : null;
    const ctx = Number.isFinite(liveCtx) ? liveCtx : totals.ctx;
    el.meterTokens.textContent = fmtCtx(ctx) || ((totals.turns || 0) > 0 ? '' : '0 ctx');
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
    el.agentsBtnLabel.textContent = fmtAgents(totals.agents) || '0 agents';   // totals().agents already includes the live row's agents
  }

  function stopTurn() {
    if (!st.threadId) return;
    Promise.resolve()
      .then(() => fetch(`/api/ask/threads/${st.threadId}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))
      .catch(() => { /* the turn will end via its own frames */ });
  }

  async function sendMessage() {
    if (st.sending || st.destroyed) return;
    if (st.model && st.model.live()) return; // a turn is streaming — the stop button is showing
    const text = el.input.value.trim();
    if (!text) return;
    st.sending = true;
    setComposerMsg(null);
    try {
      let id = st.threadId;
      if (!id) {
        let r = null;
        try {
          r = await fetch('/api/ask/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        } catch { r = null; }
        if (!r || (r.status !== 201 && !r.ok)) { setComposerMsg('could not create the thread'); return; }
        const body = await r.json();
        id = body.thread.id;
        loadGen += 1;                     // a pending loadThread() must not replace this fresh model
        st.threadId = id;
        st.model = createThreadModel({ threadId: id });
        st.model.load({ thread: body.thread, messages: [], attachments: [], runLinks: [], inFlight: null });
        renderTranscript();
        storeThread(id);
      }
      const payload = {
        text,
        model: st.picker.model,
        effort: st.picker.effort,
        context: scopedContext(getPageContext() || {}),
        ...(st.pendingFiles.length ? { attachments: st.pendingFiles.map((f) => ({ name: f.name, dataBase64: f.dataBase64 })) } : {}),
      };
      const model = st.model;
      let res = null;
      try {
        res = await fetch(`/api/ask/threads/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } catch { setComposerMsg('network error — the message was not sent'); return; }
      // The user may have clicked New chat or switched threads during the POST: the
      // message is on the server and arrives with its thread; touching the composer
      // or the (now different or null) model here would be wrong (review of PR #376).
      if (st.destroyed || st.model !== model || st.threadId !== id) return;
      if (!res || res.status !== 202) {
        let msg = `request failed (${res ? res.status : 'network'})`;
        try { const b = await res.json(); if (b && b.error) msg = b.error; } catch { /* keep the fallback */ }
        setComposerMsg(msg);
        return;
      }
      const { userMessageId, attachments: stored } = await res.json();
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
      st.pendingFiles = [];
      renderChips();
      subscribe(id);
      st.pinned = true;
      scheduleFlush();
    } finally {
      st.sending = false;
      updateSendStop();
    }
  }

  function buildComposer() {
    const wrap = make('div', 'ask-composer');

    el.chips = make('div', 'ask-chips');
    el.chips.hidden = true;
    wrap.appendChild(el.chips);

    el.input = doc.createElement('textarea');
    el.input.className = 'ask-input';
    el.input.rows = 1;
    el.input.placeholder = 'Ask about any run, agent, or project…';
    el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
    });
    el.input.addEventListener('input', () => {
      el.input.style.height = 'auto';
      el.input.style.height = `${Math.min(el.input.scrollHeight || 0, 120)}px`;
    });
    wrap.appendChild(el.input);

    el.composerMsg = make('div', 'ask-composer-msg');
    el.composerMsg.hidden = true;
    wrap.appendChild(el.composerMsg);

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
    // (.ask-pop-scope) opens upward from the sheet's bottom-left.
    const scopeBtn = make('button', 'ask-scope-btn');
    scopeBtn.type = 'button';
    scopeBtn.setAttribute('data-ask-scope-btn', '');
    scopeBtn.title = 'Project scope for this chat';
    el.scopeLabel = make('span', 'ask-scope-label', 'Auto');
    scopeBtn.appendChild(el.scopeLabel);
    scopeBtn.appendChild(svgIcon(ICONS.chevronDown, 11, 2));
    scopeBtn.addEventListener('click', () => openScopePopover(scopeBtn));
    el.scopeBtn = scopeBtn;
    row.appendChild(scopeBtn);

    row.appendChild(make('span', 'ask-composer-spacer'));

    const meter = make('span', 'ask-meter');
    meter.setAttribute('data-ask-meter', '');
    el.meterTokens = make('span', 'ask-meter-tokens', '0 ctx');
    meter.appendChild(el.meterTokens);
    meter.appendChild(make('span', 'ask-meter-sep', '|'));
    el.meterCost = make('span', 'ask-meter-cost', '');
    meter.appendChild(el.meterCost);
    meter.appendChild(make('span', 'ask-meter-sep', '|'));
    row.appendChild(meter);

    const wtBtn = make('button', 'ask-agents-btn ask-wt-btn');
    wtBtn.type = 'button';
    wtBtn.setAttribute('data-ask-wt-btn', '');
    wtBtn.hidden = true;
    el.wtBtn = wtBtn;
    el.wtBtnLabel = make('span', null, '0 worktrees');
    wtBtn.appendChild(el.wtBtnLabel);
    wtBtn.appendChild(svgIcon('M6 15l6-6 6 6', 11, 2));
    wtBtn.addEventListener('click', () => openWorktreesPopover(wtBtn));
    row.appendChild(wtBtn);

    const agentsBtn = make('button', 'ask-agents-btn');
    agentsBtn.type = 'button';
    agentsBtn.setAttribute('data-ask-agents-btn', '');
    el.agentsBtnLabel = make('span', null, '0 agents');
    agentsBtn.appendChild(el.agentsBtnLabel);
    agentsBtn.appendChild(svgIcon('M6 15l6-6 6 6', 11, 2));
    agentsBtn.addEventListener('click', () => openRunInfoPopover(agentsBtn));
    row.appendChild(agentsBtn);

    const modelBtn = make('button', 'ask-model-btn');
    modelBtn.type = 'button';
    modelBtn.setAttribute('data-ask-model-btn', '');
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

    wrap.appendChild(row);
    return wrap;
  }

  function announce(text) { el.live.textContent = text; }

  function focusComposer() {
    try { el.input.focus({ preventScroll: true }); } catch { try { el.input.focus(); } catch { /* detached */ } }
  }

  function openSheet() {
    if (st.open || st.destroyed) return;
    st.open = true;
    st.prevFocus = doc.activeElement;
    el.pill.hidden = true;
    el.sheet.hidden = false;
    st.pinned = true;
    ensureFirstOpen();
    focusComposer();
    scheduleFlush();
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
    // …so the autosize listener and the focus have to be driven here.
    el.input.dispatchEvent(new win.Event('input'));
    focusComposer();
    try { el.input.selectionStart = el.input.selectionEnd = el.input.value.length; } catch { /* jsdom */ }
    return true;
  }

  function closeSheet() {
    if (!st.open) return;
    closePopover({ focusTrigger: false });
    st.open = false;
    el.sheet.hidden = true;
    el.pill.hidden = false;
    const prev = st.prevFocus;
    st.prevFocus = null;
    if (prev && prev.isConnected && typeof prev.focus === 'function') { try { prev.focus(); return; } catch { /* fall through */ } }
    try { el.pill.focus(); } catch { /* ignore */ }
  }

  function toggleSheet() { (st.open ? closeSheet : openSheet)(); }

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
    if (isToggleCombo(e)) {
      if (e.repeat || e.isComposing) return;
      e.preventDefault();
      toggleSheet();
      return;
    }
    if (e.key === 'Escape' && ownsKey(e) && st.popover) closePopover({ focusTrigger: true });
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
    if (t.closest('.viewer-modal, #confirm-modal, .info-bubble, .mention-popup, .hd-cmt-card')) return;
    closeSheet();
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

  function menuItems(panel) { return [...panel.querySelectorAll('[role="menuitem"]:not([disabled])')]; }

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

  function openPopover({ panelClass, trigger, build, onClose, refreshOn }) {
    if (st.popover && st.popover.trigger === trigger) { closePopover({ focusTrigger: false }); return null; }
    closePopover({ focusTrigger: false });
    const panel = make('div', `ask-pop ${panelClass}`);
    panel.setAttribute('role', 'menu');
    panel.addEventListener('keydown', onPopKeydown);
    build(panel);
    el.sheet.appendChild(panel);
    // refreshOn(dirty) → true re-runs build() on that flush (flushExtra), so an
    // OPEN popover follows the live meters / worktrees instead of freezing at open.
    st.popover = { panel, trigger, onClose: onClose || null, build, refreshOn: refreshOn || null };
    const first = menuItems(panel)[0];
    if (first) { first.tabIndex = 0; try { first.focus(); } catch { /* ignore */ } }
    return panel;
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
  // The start date leads the meter line, bold and on the primary ink, so the eye
  // scans it down the list while the cost/agent figures keep the meter's grey.
  // Hence an element rather than a string: only the date changes weight and
  // colour. An unusable createdAt drops the span and its separator with it.
  function threadMeter(t) {
    const meter = make('span', 'ask-thread-meter');
    const when = fmtStarted(t.createdAt, now());
    const rest = [fmtCtx(t.totals && t.totals.ctx), fmtUsd(t.totals && t.totals.costUsd), fmtAgents(t.totals && t.totals.agents)]
      .filter(Boolean).join(' · ');
    if (when) meter.appendChild(make('span', 'ask-thread-when', when));
    if (rest) meter.appendChild(doc.createTextNode(when ? ` · ${rest}` : rest));
    return meter;
  }

  function toggleThreadsPopover(trigger) {
    const panel = openPopover({ panelClass: 'ask-pop-threads', trigger, build: (p) => { p.appendChild(make('div', 'ask-pop-caption', 'Recent chats')); } });
    if (!panel) return;
    Promise.resolve()
      .then(() => fetch('/api/ask/threads?limit=50'))
      .then((r) => (r && r.ok ? r.json() : { threads: [] }))
      .catch(() => ({ threads: [] }))
      .then(({ threads }) => {
        if (st.popover === null || st.popover.panel !== panel) return; // closed meanwhile
        renderThreadRows(panel, Array.isArray(threads) ? threads : []);
      });
  }

  function renderThreadRows(panel, threads) {
    if (!threads.length) {
      panel.appendChild(make('div', 'ask-pop-empty', 'No saved chats.'));
      return;
    }
    // The rows scroll inside a capped list so 50 threads cannot run past the
    // sheet; the caption stays a direct child of the panel, hence pinned. The
    // list itself stays inside the panel: menuItems() reads the whole panel.
    const list = make('div', 'ask-threads-list');
    for (const t of threads) {
      const row = make('div', 'ask-thread-row');
      const pick = menuItem('ask-thread-pick', () => { closePopover({ focusTrigger: false }); switchThread(t.id); });
      // The dot leads the row, sitting against the title where it reads as "this
      // chat is live" -- .ask-thread-dot collapses it (display:none) unless the
      // live arm joins it, so an idle row leaves no empty gutter and its title
      // starts at the left edge. The date rides the meter line under the title.
      pick.appendChild(make('span', `ask-dot ask-thread-dot${t.inFlight ? ' ask-dot-live' : ''}`));
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
    const first = menuItems(panel)[0];
    if (first) { first.tabIndex = 0; try { first.focus(); } catch { /* ignore */ } }
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
    el.modelBtnEffort.textContent = st.picker.effort;
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
    const fallback = catalogDefault();
    // Each slot is decided by its own provenance: a stored MODEL outranks the backend
    // default, and a stored EFFORT survives even when the model comes from the default.
    // (effortFromStore ⊇ pickerFromStore — a stored model always carries its effort.)
    const wanted = {
      model: st.pickerFromStore ? st.picker.model : fallback.model,
      effort: st.effortFromStore ? st.picker.effort : fallback.effort,
    };
    const list = st.catalog && Array.isArray(st.catalog.models) ? st.catalog.models : [];
    const wantedEntry = catalogEntry(wanted.model);
    // Unknown stored/default id -> the backend default -> the first model we do have.
    const entry = wantedEntry || catalogEntry(fallback.model) || list[0] || null;
    if (!entry) { updatePickerButton(); return; }  // empty catalog: keep what we have
    const effort = wantedEntry ? wanted.effort : fallback.effort;
    const next = { model: entry.id, effort: coerceEffort(entry, effort) };
    const changed = next.model !== st.picker.model || next.effort !== st.picker.effort;
    st.picker = next;
    // D11: persist ONLY a repair of a pick the user actually made. Writing the
    // backend default here would make it authoritative exactly once, ever.
    if (changed && st.pickerFromStore) storeModel();
    updatePickerButton();
  }

  function loadCatalog() {
    if (st.catalog) return Promise.resolve(st.catalog);
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
    storeModel();
    updatePickerButton();
    closePopover({ focusTrigger: false });
    focusComposer();
  }

  function setPickerEffort(effort) {
    st.picker = { ...st.picker, effort };
    st.effortFromStore = true;                      // the effort only — the model slot is untouched (D11)
    storeModel();
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
      if (m.id === st.picker.model) item.appendChild(make('span', 'ask-model-check', '✓'));
      return item;
    };
    const renderPane = (pane) => {
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
        const effortRow = menuItem('ask-effort-row', () => renderPane('effort'));
        effortRow.setAttribute('data-ask-effort-row', '');
        effortRow.appendChild(make('span', null, 'Effort'));
        effortRow.appendChild(make('span', 'ask-pop-row-value', st.picker.effort));
        effortRow.appendChild(make('span', 'ask-pop-row-chev', '›'));
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
    loadCatalog().then(() => { if (st.popover && st.popover.panel === panel) renderPane('main'); });
    renderPane('main');
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

  // ---- run-info popover ("Agents this chat") --------------------------------
  // ---- worktrees (P4 §10) ---------------------------------------------------
  function setWorktrees(list) {
    st.worktrees = Array.isArray(list) ? list : [];
    if (!el.wtBtn) return;
    el.wtBtn.hidden = st.worktrees.length === 0;
    el.wtBtnLabel.textContent = `${st.worktrees.length} worktree${st.worktrees.length === 1 ? '' : 's'}`;
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

  const wtShortSha = (c) => (typeof c === 'string' ? c.slice(0, 7) : '');

  async function deleteWorktree(w) {
    const ok = await confirm({
      title: 'Remove this worktree?',
      message: `${w.projectKey} @ ${w.ref} is checked out at ${w.path}. The checkout is deleted; branches are untouched.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try { await fetch(`/api/ask/threads/${st.threadId}/worktrees/${w.worktreeId}`, { method: 'DELETE' }); } catch { /* refetch shows the truth */ }
    await refreshWorktrees();
  }

  function openWorktreesPopover(trigger) {
    const panel = openPopover({ panelClass: 'ask-pop-runinfo ask-pop-worktrees', trigger, refreshOn: (d) => d.worktrees, build: (p) => {
      p.appendChild(make('div', 'ask-pop-caption', 'Worktrees this chat'));
      // Synchronous: st.worktrees is the DOM mirror, already fed by the snapshot
      // or the last frame, and flushExtra refreshes it BEFORE re-running build().
      renderWorktreeRows(p, st.worktrees);
    } });
    if (!panel) return;
    // Heal on open (one snapshot GET): the list lands in the model and the
    // dirty.worktrees flush re-runs build() above — one render path.
    refreshWorktrees();
  }

  function renderWorktreeRows(panel, list) {
    if (!list.length) { panel.appendChild(make('div', 'ask-pop-empty', 'No worktrees open.')); return; }
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

  function openRunInfoPopover(trigger) {
    // Rebuilt on every meters flush: agent blocks mark meters dirty (ask-model),
    // so rows, dots, ctx and cost move while agents run.
    openPopover({ panelClass: 'ask-pop-runinfo', trigger, refreshOn: (d) => d.meters, build: (p) => {
      const agents = [];
      if (st.model) {
        for (const row of st.model.messages()) {
          for (const b of row.blocks || []) if (b && b.kind === 'agent') agents.push(b);
        }
      }
      const head = make('div', 'ask-pop-caption-row');
      head.appendChild(make('span', 'ask-pop-caption', 'Agents this chat'));
      const cost = agents.reduce((n, a) => n + (Number.isFinite(a.costUsd) ? a.costUsd : 0), 0);
      // Cost only: costs sum across agents; context fills do not.
      head.appendChild(make('span', 'ask-pop-caption-meter', agents.length ? `≈${fmtUsd(cost)}` : ''));
      p.appendChild(head);
      if (!agents.length) { p.appendChild(make('div', 'ask-pop-empty', 'No agents spawned yet.')); return; }
      for (const a of agents) {
        const row = make('div', 'ask-runinfo-row');
        row.appendChild(make('span', `ask-dot${a.status === 'running' ? ' ask-dot-run' : a.status === 'done' ? ' ask-dot-done' : ''}`));
        const col = make('span', 'ask-runinfo-col');
        col.appendChild(make('span', 'ask-runinfo-name', a.label || a.type || 'agent'));
        col.appendChild(make('span', 'ask-runinfo-sub', [a.model, fmtCtx(a.ctx) || fmtTokens(a.tokens), Number.isFinite(a.costUsd) ? `≈${fmtUsd(a.costUsd)}` : null, a.status || null].filter(Boolean).join(' · ')));
        row.appendChild(col);
        row.appendChild(make('span', 'ask-runinfo-elapsed', fmtElapsed(a.durationMs) || '—'));
        p.appendChild(row);
      }
    } });
  }

  // ---- thread actions -------------------------------------------------------
  function newThread() {
    loadGen += 1;                       // a load still in flight must not resurrect the old thread
    st.threadId = null;
    st.model = null;
    st.subscribedFor = null;
    stopElapsed();
    storeThread(null);
    el.title.textContent = 'Ask Worca';
    applyThreadScope(null);             // #397: a brand-new chat starts on Auto
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
    try { await fetch(`/api/ask/threads/${t.id}`, { method: 'DELETE' }); } catch { /* the list will show it either way */ }
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
    return n;
  }

  // ---- Start-run card (spec §9, §10.5; D1-D3) -------------------------------
  // Field edits live in the DOM only (V7): a proposed card's element is CACHED
  // by card id and REUSED across message re-renders, so streaming updates and
  // proposed re-emits never clobber what the user typed. Only a STATE change
  // (started/dismissed/failed) builds a fresh terminal element.
  function loadCardOptions() {
    if (st.cardOptions) return st.cardOptions;
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

  function loadBranchesInto(select, projectDir, want) {
    fillSelect(select, [{ value: '', label: 'current branch (auto)' }], '');
    if (!projectDir) return;
    Promise.resolve()
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

  function buildCardTerminal(block) {
    const card = block.card || {};
    if (block.state === 'started') {
      const n = make('div', 'ask-card ask-card-started');
      n.appendChild(make('span', null, `Run started — ${card.title || card.brief || 'run'} `));
      const a = make('a', 'ask-card-link', 'open');
      a.setAttribute('href', `#running/${block.runId || ''}`);
      n.appendChild(a);
      return n;
    }
    if (block.state === 'failed') {
      return make('div', 'ask-card-stub ask-card-failed', `Run failed${block.error ? `: ${block.error}` : ''} — ${card.title || card.brief || ''}`);
    }
    return make('div', 'ask-card-stub', `Not now — ${card.title || card.brief || 'run proposal'}`);
  }

  function buildCardForm(block) {
    const card = block.card || {};
    const rootEl = make('div', 'ask-card');
    const local = { target: card.target === 'workspace' ? 'workspace' : 'project', options: null };

    rootEl.appendChild(make('div', 'ask-card-title', card.title || 'Run proposal'));

    // #397 guardrail: the model proposed a different target than the chat's pin.
    if (block.scopeMismatch) {
      rootEl.appendChild(make('div', 'ask-card-scope-warn',
        'This proposal targets a different project or workspace than the one pinned for this chat — check the target before starting.'));
    }

    const seg = make('div', 'ask-card-seg');
    const segBtns = {};
    for (const [t, label] of [['project', 'Project'], ['workspace', 'Workspace']]) {
      const b = make('button', 'ask-card-seg-btn', label);
      b.type = 'button';
      b.setAttribute('data-ask-card-seg', t);
      b.addEventListener('click', () => {
        if (local.target === t) return;
        local.target = t;
        for (const k of Object.keys(segBtns)) segBtns[k].classList.toggle('on', k === local.target);
        renderTarget();
      });
      segBtns[t] = b;
      seg.appendChild(b);
    }
    segBtns[local.target].classList.add('on');
    rootEl.appendChild(seg);

    const targetHost = make('div', 'ask-card-target');
    rootEl.appendChild(targetHost);

    const field = (label, control) => {
      const f = make('div', 'ask-card-field');
      f.appendChild(make('label', 'ask-card-label', label));
      f.appendChild(control);
      return f;
    };

    const workflowSel = doc.createElement('select');
    workflowSel.className = 'ask-card-workflow';
    rootEl.appendChild(field('Workflow', workflowSel));

    const guardSel = doc.createElement('select');
    guardSel.className = 'ask-card-guardrails';
    rootEl.appendChild(field('Guardrails', guardSel));

    const brief = doc.createElement('textarea');
    brief.className = 'ask-card-brief';
    brief.value = card.brief || '';
    brief.addEventListener('input', () => {
      brief.style.height = 'auto';
      brief.style.height = `${Math.min(brief.scrollHeight || 0, 160)}px`;
    });
    rootEl.appendChild(field('Task brief', brief));

    const feature = doc.createElement('input');
    feature.type = 'text';
    feature.className = 'ask-card-feature';
    feature.value = card.featureBranch || '';
    rootEl.appendChild(field('Feature branch', feature));

    const err = make('div', 'ask-card-err');
    rootEl.appendChild(err);

    const actions = make('div', 'ask-card-actions');
    const openNp = make('button', 'ask-card-open-np', 'Open in New Pipeline');
    openNp.type = 'button';
    openNp.setAttribute('data-ask-card-open-np', '');
    openNp.addEventListener('click', () => prefillFromCard(block, rootEl, local));
    actions.appendChild(openNp);
    actions.appendChild(make('span', 'ask-card-actions-spacer'));
    const dismissBtn = make('button', 'ask-card-not-now', 'Not now');
    dismissBtn.type = 'button';
    dismissBtn.setAttribute('data-ask-card-dismiss', '');
    dismissBtn.addEventListener('click', () => dismissCard(block, rootEl));
    actions.appendChild(dismissBtn);
    const startBtn = make('button', 'ask-card-start', 'Start');
    startBtn.type = 'button';
    startBtn.setAttribute('data-ask-card-start', '');
    startBtn.addEventListener('click', () => startCard(block, rootEl, local));
    actions.appendChild(startBtn);
    rootEl.appendChild(actions);

    function renderTarget() {
      targetHost.replaceChildren();
      const opts = local.options;
      if (local.target === 'project') {
        const projSel = doc.createElement('select');
        projSel.className = 'ask-card-project-select';
        const srcSel = doc.createElement('select');
        srcSel.className = 'ask-card-source';
        if (opts) {
          fillSelect(projSel, opts.projects.map((p) => ({ value: p.path, label: p.exists === false ? `${p.name} (missing)` : p.name })), card.projectDir || (opts.projects[0] && opts.projects[0].path) || '');
          loadBranchesInto(srcSel, projSel.value, card.sourceBranch || '');
        }
        projSel.addEventListener('change', () => loadBranchesInto(srcSel, projSel.value, ''));
        targetHost.appendChild(field('Project', projSel));
        targetHost.appendChild(field('Source branch', srcSel));
      } else {
        const wsSel = doc.createElement('select');
        wsSel.className = 'ask-card-workspace-select';
        const members = make('div', 'ask-card-members');
        const srcInput = doc.createElement('input');
        srcInput.type = 'text';
        srcInput.className = 'ask-card-source-input';
        srcInput.placeholder = 'auto';
        srcInput.value = card.sourceBranch || '';
        const details = doc.createElement('details');
        // .disclosure swaps the OS triangle for the app's own chevron
        details.className = 'ask-card-members-src disclosure';
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
            memberHost.appendChild(field(m.name, inp));
          }
        };
        if (opts) {
          fillSelect(wsSel, opts.workspaces.map((w) => ({ value: w.id, label: w.name || w.id })), card.workspaceId || (opts.workspaces[0] && opts.workspaces[0].id) || '');
          renderMembers();
        }
        wsSel.addEventListener('change', renderMembers);
        targetHost.appendChild(field('Workspace', wsSel));
        targetHost.appendChild(members);
        targetHost.appendChild(field('Source branch (default)', srcInput));
        targetHost.appendChild(details);
      }
    }

    renderTarget();
    loadCardOptions().then((opts) => {
      if (st.destroyed) return;
      local.options = opts;
      fillSelect(workflowSel, opts.workflows.map((w) => ({ value: w.id, label: workflowPickerLabel(w, null) || w.name || w.id })), card.workflowId || 'wf_default');
      fillSelect(guardSel, opts.guardrails.map((g) => ({ value: g.id, label: g.id === 'permissive' ? 'Permissive' : (g.name || g.id) })), card.guardrailsId || 'normal');
      renderTarget();
    });
    return rootEl;
  }

  function collectCardBody(rootEl, local, card) {
    const body = {
      prompt: rootEl.querySelector('.ask-card-brief').value,
      workflowId: rootEl.querySelector('.ask-card-workflow').value,
      guardrailsId: rootEl.querySelector('.ask-card-guardrails').value, // ALWAYS sent (spec §9.4)
      title: card.title || undefined,
      mock: false,
    };
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

  async function startCard(block, rootEl, local) {
    const err = rootEl.querySelector('.ask-card-err');
    const startBtn = rootEl.querySelector('[data-ask-card-start]');
    err.textContent = '';
    startBtn.disabled = true;
    try {
      const body = { ...collectCardBody(rootEl, local, block.card || {}), askThreadId: st.threadId, askCardId: block.id };
      let res = null;
      try {
        res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } catch { err.textContent = 'network error'; return; }
      if (!res.ok) {
        let msg = `request failed (${res.status})`;
        try { const b = await res.json(); if (b && b.error) msg = b.error; } catch { /* keep */ }
        err.textContent = msg;
        return;
      }
      // Success: the server links, flips the card to started and broadcasts;
      // the flip frame renders the terminal state. The browser never navigates
      // (beginRun is NEVER called — spec §10.5).
    } finally {
      startBtn.disabled = false;
    }
  }

  async function dismissCard(block, rootEl) {
    const err = rootEl.querySelector('.ask-card-err');
    err.textContent = '';
    let res = null;
    try {
      res = await fetch(`/api/ask/threads/${st.threadId}/cards/${block.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'dismissed' }) });
    } catch { err.textContent = 'network error'; return; }
    if (!res.ok) {
      let msg = `request failed (${res.status})`;
      try { const b = await res.json(); if (b && b.error) msg = b.error; } catch { /* keep */ }
      err.textContent = msg;
    }
    // the flip frame renders the stub
  }

  function prefillFromCard(block, rootEl, local) {
    const card = block.card || {};
    const p = {
      target: local.target,
      workflowId: rootEl.querySelector('.ask-card-workflow').value,
      guardrailsId: rootEl.querySelector('.ask-card-guardrails').value,
      prompt: rootEl.querySelector('.ask-card-brief').value,
      title: card.title || '',
      featureBranch: rootEl.querySelector('.ask-card-feature').value.trim(),
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
    openNewPipeline(p);
  }

  function buildCard(block) {
    if (!st.cardEls) st.cardEls = new Map();
    const cached = st.cardEls.get(block.id);
    if (cached && cached.state === block.state && block.state === 'proposed') return cached.el;
    const built = block.state === 'proposed' ? buildCardForm(block) : buildCardTerminal(block);
    st.cardEls.set(block.id, { el: built, state: block.state });
    return built;
  }

  function toolRow(block) {
    const rowEl = make('div', 'ask-tool-row');
    const short = String(block.name || '').replace(/^mcp__worca__/, '');
    const parts = short.split('_');
    rowEl.appendChild(make('span', 'ask-tool-op', parts[0] || short));
    const target = parts.slice(1).join(' ');
    const preview = clipInput(block.input);
    rowEl.appendChild(make('span', 'ask-tool-target', preview ? (target ? `${target} · ${preview}` : preview) : target));
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
    rowEl.appendChild(make('span', 'ask-agent-tokens', fmtCtx(block.ctx) || fmtTokens(block.tokens) || ''));
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
      head.appendChild(make('span', null, [block.model, fmtCtx(block.ctx) || fmtTokens(block.tokens), Number.isFinite(block.costUsd) ? `≈${fmtUsd(block.costUsd)}` : null].filter(Boolean).join(' · ')));
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

  function buildActivity(row) {
    const isLive = !!(st.model && st.model.live() && st.model.live().messageId === row.id);
    const activity = make('div', 'ask-activity');
    const head = make('div', 'ask-activity-head');
    const stopped = row.status === 'stopped' || row.status === 'error';
    if (isLive) head.appendChild(make('span', 'ask-activity-label', 'Thinking'));
    else if (!stopped) head.appendChild(make('span', 'ask-activity-label', 'Done'));
    head.appendChild(make('span', `ask-dot${isLive ? ' ask-dot-run' : row.status === 'error' ? '' : ' ask-dot-done'}`));
    // The head names its state in one word ahead of the dot — Thinking, Done, or
    // Stopped after — and nothing more while the turn is live: the orb row at the
    // bottom of the message owns the elapsed and the meter, and printing either
    // set twice is the noise this replaced. A turn that ended badly says so
    // instead of Done; nothing else marks a stop.
    if (!isLive) {
      if (stopped) head.appendChild(make('span', 'ask-activity-label', 'Stopped after'));
      head.appendChild(make('span', 'ask-activity-elapsed', fmtElapsed(row.durationMs) || ''));
      head.appendChild(make('span', 'ask-activity-spacer'));
      const meter = [fmtCtx(row.usage && row.usage.ctx), fmtUsd(row.costUsd)].filter(Boolean).join(' · ');
      head.appendChild(make('span', 'ask-activity-meter', meter));
    }
    activity.appendChild(head);
    const tools = (row.blocks || []).filter((b) => b && b.kind === 'tool');
    for (const b of tools) activity.appendChild(toolRow(b));
    const agents = (row.blocks || []).filter((b) => b && b.kind === 'agent');
    if (agents.length) {
      const sect = make('div', 'ask-agents');
      const cap = make('div', 'ask-agents-cap');
      cap.appendChild(make('span', null, 'Sub-agents'));
      cap.appendChild(make('span', 'ask-agents-count', String(agents.length)));
      sect.appendChild(cap);
      for (const b of agents) sect.appendChild(agentRow(b));
      activity.appendChild(sect);
    }
    return { el: activity };
  }

  // The ONE orb: created on first live turn and re-parented into each rebuilt
  // live row. Rebuilding it per row would restart the canvas — and since a tool
  // block rebuilds the row, the sphere would visibly snap back mid-turn.
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

  function buildMessage(row) {
    const wrap = make('div', `ask-msg ask-msg-${row.role}`);
    let renderAnswer = null;
    if (row.role === 'user') {
      const bubble = make('div', 'ask-user-bubble', row.text || '');
      wrap.appendChild(bubble);
      const atts = (row.blocks || []).filter((b) => b && b.kind === 'attachment');
      if (atts.length) {
        const pills = make('div', 'extras-pills ask-user-pills');
        for (const b of atts) pills.appendChild(buildAttachmentPill(b));
        wrap.appendChild(pills);
      }
    } else if (row.role === 'system') {
      const notices = (row.blocks || []).filter((b) => b && b.kind === 'notice');
      if (notices.length) for (const b of notices) wrap.appendChild(buildNotice(b));
      else wrap.appendChild(buildNotice({ text: row.text }));
    } else {
      wrap.appendChild(buildActivity(row).el);
      const answer = make('div', 'ask-answer');
      wrap.appendChild(answer);
      renderAnswer = () => renderAnswerInto(answer, row);
      renderAnswer();
      for (const b of row.blocks || []) {
        if (!b) continue;
        if (b.kind === 'notice') wrap.appendChild(buildNotice(b));
        else if (b.kind === 'card') wrap.appendChild(buildCard(b, row));
      }
      if (row.status === 'error') {
        const explained = (row.blocks || []).some((b) => b && b.kind === 'notice');
        if (row.errorMessage) wrap.appendChild(make('div', 'ask-error-line', row.errorMessage));
        else if (!explained) wrap.appendChild(make('div', 'ask-error-line', 'This turn ended with an error.'));
      }
      if (st.model && st.model.live() && st.model.live().messageId === row.id) {
        wrap.appendChild(ensureThinking());   // last child: the bottom of the message
        el.elapsed = el.thinkingElapsed;      // the ONE live elapsed node
        // Idempotent, and the only re-arm on the adoption path: a thread whose
        // ask-start the ring buffer already evicted goes live without ever
        // passing through startElapsed(), and would otherwise show a dead orb.
        el.orb.start();
        updateThinking();
      }
    }
    const entry = {
      el: wrap,
      renderAnswer,
      update(row2) {
        const fresh = buildMessage(row2);
        wrap.replaceWith(fresh.el);
        st.rowEls.set(row2.id, fresh);
      },
    };
    return entry;
  }

  function renderTranscript() {
    st.rowEls = new Map();
    el.transcript.replaceChildren();
    if (!st.model) return;
    for (const row of st.model.messages()) {
      const entry = buildMessage(row);
      st.rowEls.set(row.id, entry);
      el.transcript.appendChild(entry.el);
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
    st.threadId = id;
    st.model = createThreadModel({ threadId: id });
    st.model.load(snap);
    el.title.textContent = (snap.thread && snap.thread.title) || 'Ask Worca';
    applyThreadScope(snap.thread && snap.thread.context);   // #397: restore the pin
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
      // P4: a finished turn may have created/removed/navigated worktrees. This must
      // NOT live in updateSendStop() — that also runs from loadThread, so a
      // running→idle latch there fires a SECOND snapshot GET on every resync.
      refreshWorktrees();
    }
    else if (frame.type === 'ask-message' && frame.message && typeof frame.message.text === 'string'
      && /is waiting for your answer/.test(frame.message.text)) announce('run needs an answer');
  }

  function pushServerFrame(frame) {
    // Defence-in-depth: the model's own threadId filter is the real router — this early return only saves an apply() call and cannot be observed from tests (the model would drop the frame identically).
    if (st.destroyed || !frame || !st.model || frame.threadId !== st.threadId) return;
    const r = st.model.apply(frame);
    if (r && r.gap) { resync(); return; }
    if (!r || !r.ok) return;
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
    // An open popover that subscribed to this flush's dirt is rebuilt in place
    // (same node — never reopened, never refocused). Runs AFTER the mirror and
    // the meters above: the worktrees build() reads st.worktrees.
    const pop = st.popover;
    if (pop && typeof pop.refreshOn === 'function' && pop.refreshOn(d)) { pop.panel.replaceChildren(); pop.build(pop.panel); }
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
    applyPin();
  }

  function updatePinFromScroll() {
    const t = el.transcript;
    st.pinned = t.scrollHeight - t.scrollTop - t.clientHeight < 24;
    if (el.jump) el.jump.hidden = st.pinned;
  }

  function applyPin() {
    if (!st.open) return;
    if (st.pinned) el.transcript.scrollTop = el.transcript.scrollHeight;
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

  function destroy() {
    if (st.destroyed) return;
    st.destroyed = true;
    closePopover({ focusTrigger: false });
    if (st.elapsedTimer) { clearInterval(st.elapsedTimer); st.elapsedTimer = null; }
    if (el.orb) el.orb.stop();
    doc.removeEventListener('keydown', onDocKeydown, true);
    doc.removeEventListener('pointerdown', onDocPointerdown, true);
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
