// ui/public/ask-panel.mjs — the Ask Worca floating sheet (spec §10). One
// factory, everything in the closure: the module is evaluated once per test
// file even though app.js is re-imported with a cache-buster, so module scope
// holds no state. All markup is built with DOM APIs and textContent — no
// innerHTML for content anywhere in this file (the markdown renderer owns the
// only sanitized-HTML path).
import { createThreadModel } from './ask-model.mjs';
import { createMarkdownRenderer } from './ask-markdown.mjs';
import { workflowPickerLabel } from './results-view.mjs';

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

export function createAskPanel({ doc, win, fetch, sendWs, confirm, getPageContext, openNewPipeline, loadMarkdown, hljsLoader, storage, raf, now }) {
  const st = {
    open: false,
    threadId: null,
    model: null,              // createThreadModel for the active thread (Task 4+)
    picker: readStoredModel(),
    catalog: null,
    popover: null,            // {panel, trigger, onClose}
    expandedAgents: new Set(),
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
  function readStoredModel() {
    try {
      const raw = storage.getItem('worca-cc.ask.model');
      const v = raw ? JSON.parse(raw) : null;
      if (v && typeof v.model === 'string' && typeof v.effort === 'string') return { model: v.model, effort: v.effort };
    } catch { /* storage unavailable */ }
    return { model: 'claude-opus-5', effort: 'high' };
  }
  function storeModel() { try { storage.setItem('worca-cc.ask.model', JSON.stringify(st.picker)); } catch { /* ignore */ } }
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
    pill.appendChild(make('span', 'ask-kbd', '⌘K'));
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

  const ASK_ATTACH_EXT = ['.md', '.markdown', '.txt', '.json', '.csv', '.log'];

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
      if (!ASK_ATTACH_EXT.includes(ext)) { setComposerMsg(`attachment type not allowed: ${name}`); continue; }
      if (f.size > 524_288) { setComposerMsg(`attachment over 524288 bytes: ${name}`); continue; }
      const others = st.pendingFiles.filter((p) => p.name !== name); // dedupe by name, newest wins
      if (others.length >= 8) { setComposerMsg('at most 8 attachments per message'); continue; }
      const serverBytes = st.model ? st.model.attachmentsBytes() : 0;
      const pendingBytes = others.reduce((n, p) => n + p.bytes, 0);
      if (serverBytes + pendingBytes + f.size > 4 * 1024 * 1024) { setComposerMsg('attachment budget for this thread exceeded'); continue; }
      let dataBase64 = '';
      try {
        dataBase64 = bytesToBase64(new Uint8Array(await f.arrayBuffer()));
      } catch { setComposerMsg(`could not read ${name}`); continue; }
      st.pendingFiles = [...others, { name, bytes: f.size, dataBase64 }];
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
    // cost comes from thread totals only — never from a live null (P3-F5)
    // No cost yet → empty cell, never a fabricated $0.00 (P3-F5).
    el.meterCost.textContent = totals.costUsd == null ? '' : (fmtUsd(totals.costUsd) || '');
    el.agentsBtnLabel.textContent = fmtAgents(totals.agents) || '0 agents';
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
        context: getPageContext() || {},
        ...(st.pendingFiles.length ? { attachments: st.pendingFiles.map((f) => ({ name: f.name, dataBase64: f.dataBase64 })) } : {}),
      };
      let res = null;
      try {
        res = await fetch(`/api/ask/threads/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } catch { setComposerMsg('network error — the message was not sent'); return; }
      if (!res || res.status !== 202) {
        let msg = `request failed (${res ? res.status : 'network'})`;
        try { const b = await res.json(); if (b && b.error) msg = b.error; } catch { /* keep the fallback */ }
        setComposerMsg(msg);
        return;
      }
      const { userMessageId } = await res.json();
      st.model.noteLocalUserMessage({ id: userMessageId, text, attachments: st.pendingFiles.map((f) => ({ name: f.name, bytes: f.bytes })) });
      if (!st.model.thread().title) {
        // The deterministic first title has NO frame — record it in the MODEL
        // as well as the header: model.load() left `title` dirty and the very
        // next flushExtra() repaints el.title from thread().title.
        st.model.thread().title = text.split('\n')[0].slice(0, 80);
        el.title.textContent = st.model.thread().title;
      }
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
    el.fileInput.accept = `${ASK_ATTACH_EXT.join(',')},text/*`;
    el.fileInput.hidden = true;
    el.fileInput.addEventListener('change', () => { addFiles(el.fileInput.files); el.fileInput.value = ''; });
    row.appendChild(el.fileInput);
    const attach = iconButton('ask-icon-btn', 'Attach files', ICONS.plus, () => el.fileInput.click());
    attach.setAttribute('data-ask-attach-btn', '');
    row.appendChild(attach);

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
    if (t.closest('.viewer-modal, #confirm-modal, .info-bubble, .mention-popup')) return;
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

  function openPopover({ panelClass, trigger, build, onClose }) {
    if (st.popover && st.popover.trigger === trigger) { closePopover({ focusTrigger: false }); return null; }
    closePopover({ focusTrigger: false });
    const panel = make('div', `ask-pop ${panelClass}`);
    panel.setAttribute('role', 'menu');
    panel.addEventListener('keydown', onPopKeydown);
    build(panel);
    el.sheet.appendChild(panel);
    st.popover = { panel, trigger, onClose: onClose || null };
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
  function threadMeter(t) {
    const parts = [fmtCtx(t.totals && t.totals.ctx), fmtUsd(t.totals && t.totals.costUsd), fmtAgents(t.totals && t.totals.agents)];
    return parts.filter(Boolean).join(' · ');
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
    for (const t of threads) {
      const row = make('div', 'ask-thread-row');
      const pick = menuItem('ask-thread-pick', () => { closePopover({ focusTrigger: false }); switchThread(t.id); });
      pick.appendChild(make('span', `ask-dot${t.inFlight ? ' ask-dot-live' : ''}`));
      const col = make('span', 'ask-thread-col');
      col.appendChild(make('span', 'ask-thread-title', t.title || '(untitled)'));
      col.appendChild(make('span', 'ask-thread-meter', threadMeter(t)));
      pick.appendChild(col);
      row.appendChild(pick);
      row.appendChild(buildThreadTrash(t));
      panel.appendChild(row);
    }
    const first = menuItems(panel)[0];
    if (first) { first.tabIndex = 0; try { first.focus(); } catch { /* ignore */ } }
  }

  // ---- catalog + picker (D8) ------------------------------------------------
  function catalogEntry(id) { return st.catalog ? st.catalog.models.find((m) => m && m.id === id) || null : null; }

  function updatePickerButton() {
    if (!el.modelBtnLabel) return;
    const entry = catalogEntry(st.picker.model);
    el.modelBtnLabel.textContent = entry ? entry.label : st.picker.model;
    el.modelBtnEffort.textContent = st.picker.effort;
  }

  function coerceEffort(entry, effort) {
    if (!entry || !Array.isArray(entry.efforts) || entry.efforts.includes(effort)) return effort;
    return entry.efforts.includes('high') ? 'high' : entry.efforts[0];
  }

  function applyCatalogToPicker() {
    const entry = catalogEntry(st.picker.model);
    const next = entry
      ? { model: st.picker.model, effort: coerceEffort(entry, st.picker.effort) }
      : { model: 'claude-opus-5', effort: 'high' }; // unknown stored model → initial default (§11)
    if (next.model !== st.picker.model || next.effort !== st.picker.effort) {
      st.picker = next;
      storeModel();
    }
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

  function splitCatalog() {
    const primary = [];
    const rest = [];
    const seen = new Set();
    for (const m of st.catalog ? st.catalog.models : []) {
      if (!m) continue;
      if (m.custom === 'global') { primary.push(m); continue; }
      const fam = (m.id.match(/^claude-(opus|fable|sonnet|haiku)-/) || [])[1] || m.id;
      if (seen.has(fam)) rest.push(m);
      else { seen.add(fam); primary.push(m); }
    }
    return { primary, rest };
  }

  function setPickerModel(id) {
    st.picker = { model: id, effort: coerceEffort(catalogEntry(id), st.picker.effort) };
    storeModel();
    updatePickerButton();
    closePopover({ focusTrigger: false });
    focusComposer();
  }

  function setPickerEffort(effort) {
    st.picker = { ...st.picker, effort };
    storeModel();
    updatePickerButton();
    closePopover({ focusTrigger: false });
    focusComposer();
  }

  function openModelPopover(trigger) {
    const panel = openPopover({ panelClass: 'ask-pop-model', trigger, build: () => {} });
    if (!panel) return;
    const focusFirst = () => { const f = menuItems(panel)[0]; if (f) { f.tabIndex = 0; try { f.focus(); } catch { /* ignore */ } } };
    const modelItem = (m) => {
      const item = menuItem('ask-model-item', () => setPickerModel(m.id));
      item.appendChild(make('span', 'ask-model-name', m.label || m.id));
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

  // ---- run-info popover ("Agents this chat") --------------------------------
  function openRunInfoPopover(trigger) {
    openPopover({ panelClass: 'ask-pop-runinfo', trigger, build: (p) => {
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
    st.threadId = null;
    st.model = null;
    st.subscribedFor = null;
    stopElapsed();
    storeThread(null);
    el.title.textContent = 'Ask Worca';
    renderTranscript();
    updateMeters();
    updateSendStop();
    setComposerMsg(null);
    focusComposer();
  }

  async function deleteThread(t) {
    closePopover({ focusTrigger: false });
    const ok = await confirm({
      title: 'Delete this chat?',
      message: `“${t.title || '(untitled)'}” and its transcript are removed. This cannot be undone.`,
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
    b.setAttribute('aria-label', `Delete "${t.title || '(untitled)'}"`);
    b.appendChild(svgIcon('M4 7h16M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7', 14, 1.8));
    b.addEventListener('click', (e) => { e.stopPropagation(); deleteThread(t); });
    return b;
  }

  // ---- stubs the later tasks replace wholesale ------------------------------
  // ---- transcript (spec §10.5) ---------------------------------------------
  function buildAttachmentPill(b) {
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
        details.className = 'ask-card-members-src';
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
    const live = isLive ? st.model.live() : null;
    const activity = make('div', 'ask-activity');
    const head = make('div', 'ask-activity-head');
    head.appendChild(make('span', `ask-dot${isLive ? ' ask-dot-run' : row.status === 'error' ? '' : ' ask-dot-done'}`));
    const label = isLive
      ? (live.label || 'Thinking')
      : row.status === 'stopped' || row.status === 'error' ? 'Stopped after' : 'Worked for';
    head.appendChild(make('span', 'ask-activity-label', label));
    const elapsed = make('span', 'ask-activity-elapsed', isLive ? '' : (fmtElapsed(row.durationMs) || ''));
    if (isLive) el.elapsed = elapsed; // the ONE live elapsed node; tickElapsed (Task 5) writes it
    head.appendChild(elapsed);
    head.appendChild(make('span', 'ask-activity-spacer'));
    const usage = isLive ? live.usage : row.usage;
    const cost = isLive ? live.costUsd : row.costUsd;
    const meter = [fmtCtx(usage && usage.ctx), fmtUsd(cost)].filter(Boolean).join(' · ');
    head.appendChild(make('span', 'ask-activity-meter', meter));
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

  async function loadThread(id) {
    let res = null;
    try { res = await fetch(`/api/ask/threads/${id}`); } catch { return null; }
    if (!res || !res.ok) {
      if (res && res.status === 404 && readStoredThread() === id) storeThread(null);
      return null;
    }
    let snap = null;
    try { snap = await res.json(); } catch { return null; }
    st.threadId = id;
    st.model = createThreadModel({ threadId: id });
    st.model.load(snap);
    el.title.textContent = (snap.thread && snap.thread.title) || 'Ask Worca';
    renderTranscript();
    updateMeters();
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
  }
  function stopElapsed() {
    if (st.elapsedTimer) { clearInterval(st.elapsedTimer); st.elapsedTimer = null; }
    st.elapsedStart = null;
  }
  function updateLiveElapsed() {
    if (st.elapsedStart != null && el.elapsed && st.model && st.model.live()) {
      el.elapsed.textContent = fmtElapsed(now() - st.elapsedStart);
    }
  }

  function afterFrame(frame) {
    if (frame.type === 'ask-start') { startElapsed(Date.parse(frame.startedAt)); updateSendStop(); }
    else if (frame.type === 'ask-done' || frame.type === 'ask-error') { stopElapsed(); updateSendStop(); announce('answer finished'); }
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
    pushServerFrame,
    onHello,
    ownsKey,
    destroy,
  });
}
