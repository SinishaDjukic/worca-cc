// ui/public/workflows/chat-dock.mjs
// The Workflows view's chat dock (composer-mockup.html chat.js): a one-line frosted pill beside the black "+"
// that grows UPWARD into a panel while you type. Scope pill ("Auto" or a registered project), New chat, and
// attachments as in Ask (the paperclip, a drop on the dock, a paste; attach-files.mjs). It runs on Ask Worca as a
// composer thread (chat-client.mjs); its cards change the open canvas (chat-cards.mjs). Everything inside carries
// data-canvas-keys="off" (on #wfc), so typing never edits the graph.
import { createComposerChatClient } from './chat-client.mjs';
import { ATTACH_ACCEPT, bytesToBase64, carriesFiles, checkAttachment, createPasteNamer, pastedFiles } from '../attach-files.mjs';
import { createCardController } from './chat-cards.mjs';
import { toggleMenu, closeMenus } from './menu.mjs';

export const PLACEHOLDERS = Object.freeze([
  'Add a security review after Implementation…',
  'Build a workflow that fixes a bug and runs the tests…',
  'Create a script that runs the linter…',
  'Create an agent that writes release notes…',
]);
const SCOPE_KEY = 'worca-cc.composer.scope';
const TOOL_VERB = {
  get_canvas: 'read canvas', edit_canvas: 'edit canvas', build_workflow: 'build workflow', draft_agent: 'draft agent',
  draft_script: 'draft script', test_script: 'test script', get_agent: 'read agent', get_workflow: 'read workflow',
  get_script: 'read script', list_scripts: 'list scripts', list_workflows: 'list workflows', list_projects: 'list projects', list_models: 'list models',
  read_attachment: 'read attachment',
};
const ICON = {
  spark: '<path d="M9 3l1.6 4.4L15 9l-4.4 1.6L9 15l-1.6-4.4L3 9l4.4-1.6z"/><path d="M17.5 13l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2H19.5A1.5 1.5 0 0 1 21 9.7v8.3A1.5 1.5 0 0 1 19.5 19.5h-15A1.5 1.5 0 0 1 3 18z"/>',
  chev: '<path d="M6 15l6-6 6 6"/>',
  clip: '<path d="M20.5 11.5l-8.1 8.1a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
};

/**
 * @param {object} o
 * @param {Document} o.doc
 * @param {HTMLElement} o.host  #wfc
 * @param {object} o.composer  the engine
 * @param {string} o.sessionId  this page load's composer session (cs_…)
 * @param {Function} o.fetch
 * @param {Function} o.sendWs
 * @param {Storage|null} [o.storage]
 * @param {Function} [o.renderMarkdown]  (text, el) => void
 * @param {object} [o.actions]  chat-cards actions (save/open drafts, reloadRegistry, libraryHas, notify)
 * @param {Function} o.canvas  () => the composer payload of the OPEN canvas (D11), drafts excluded
 * @param {Function} [o.projects]  async () => [{key, name}]; rejects when the list could not be read
 * @param {HTMLElement} [o.stage]  #wfv-stage: the dock never grows wider than it
 * @param {HTMLElement} [o.cluster]  #wfv-br: the Auto-layout + zoom bars, lifted clear of the dock when the two meet
 * @param {HTMLElement} [o.plus]  #wfv-add: the "+" beside the pill (its width is not the chat's)
 * @param {Function} [o.confirm]  ({title, message, confirmLabel, cancelLabel, danger}) => Promise<boolean> (app.js: confirmModal);
 *   absent = go ahead (headless callers), a throw = no
 */
export function createChatDock({ doc, host, composer, sessionId, fetch: fetchFn, sendWs, storage = null, renderMarkdown = null,
  actions = {}, canvas, projects = async () => [], stage = null, cluster = null, plus = null, confirm: confirmFn = null }) {
  const win = doc.defaultView || globalThis;
  const h = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const svg = (name) => {
    const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICON[name];
    return s;
  };
  const iconBtn = (id, label, icon) => {
    const b = h('button', 'wfc-ibtn');
    b.type = 'button'; b.id = id; b.title = label; b.setAttribute('aria-label', label);
    b.appendChild(svg(icon));
    return b;
  };
  const reduced = () => Boolean(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const readJson = (k) => { try { return JSON.parse((storage && storage.getItem(k)) || 'null'); } catch { return null; } };
  let scope = readJson(SCOPE_KEY) || { pinned: false };
  let pending = false;
  let error = '';
  let wasLive = false;
  let ph = 0;
  let pendingFiles = [];        // the next message's attachments: {name, bytes, dataBase64, attKind, mime}
  let adding = Promise.resolve();   // the batch of files being read (addFiles): send() waits for it

  const client = createComposerChatClient({ fetch: fetchFn, sendWs, storage, onChange: (kind) => schedule(kind) });
  const blocks = () => {
    const m = client.model();
    const out = [];
    for (const msg of m ? m.messages() : []) for (const b of (msg.blocks || [])) if (b && b.kind === 'card') out.push(b);
    return out;
  };
  // The dock floats over the stage's lower middle — the open panel while a turn runs, else the pill: an edit that
  // lands under it is out of sight, and the reveal frames the graph above it (`shell` exists before any sweep).
  const cards = createCardController({ doc, composer, sessionId, client, actions, blocks, reducedMotion: reduced, onChange: () => schedule(),
    occluder: () => shell.getBoundingClientRect() });

  // ── DOM ────────────────────────────────────────────────────────────────────
  const shell = h('div', 'wfc-shell');
  shell.dataset.open = 'false';
  const head = h('div', 'wfc-head');
  const title = h('span', 'wfc-title', 'Composer chat');
  const ctx = h('span', 'wfc-ctx');
  const sel = h('button', 'wfc-sel');
  sel.type = 'button';
  sel.title = 'Show on canvas';
  const newBtn = iconBtn('wfc-new', 'New chat', 'plus');
  const minBtn = iconBtn('wfc-min', 'Minimize', 'minus');
  head.append(title, ctx, sel, h('span', 'wfc-spacer'), newBtn, minBtn);
  const thread = h('div', 'wfc-thread');
  thread.setAttribute('role', 'log');
  // role=log implies aria-live=polite, and a structural frame rebuilds the whole thread: a screen reader would read
  // the conversation again on every card. The thread stays quiet; `sr` says one line per finished reply or card.
  thread.setAttribute('aria-live', 'off');
  thread.setAttribute('aria-label', 'Composer chat');
  const sr = h('div', 'sr-only wfc-sr');
  sr.setAttribute('aria-live', 'polite');
  const row = h('div', 'wfc-row');
  const spark = h('span', 'wfc-spark');
  spark.appendChild(svg('spark'));
  const input = h('textarea', 'wfc-input');
  input.id = 'wfc-input';
  input.rows = 1;
  input.placeholder = PLACEHOLDERS[0];
  input.setAttribute('aria-label', 'Message the composer chat');
  const scopeBtn = h('button', 'wfc-scope');
  scopeBtn.type = 'button';
  scopeBtn.id = 'wfc-scope';
  scopeBtn.setAttribute('aria-haspopup', 'menu');
  scopeBtn.setAttribute('aria-expanded', 'false');
  const stopBtn = iconBtn('wfc-stop', 'Stop', 'stop');
  stopBtn.hidden = true;
  const sendBtn = iconBtn('wfc-send', 'Send', 'up');
  // Attachments, as in Ask (attach-files.mjs): the paperclip opens the picker. Above the row sit the next message's
  // files as chips and a note saying why one was not attached; over the whole shell sits the drop overlay. The chips
  // live in .wfc-foot with the row, so the shell's 3-row grid keeps its slots.
  const attachBtn = iconBtn('wfc-attach', 'Attach files', 'clip');
  const fileInput = h('input', 'wfc-file-input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = ATTACH_ACCEPT;
  fileInput.hidden = true;
  row.append(spark, input, attachBtn, fileInput, scopeBtn, stopBtn, sendBtn);
  const fileRow = h('div', 'wfc-files');
  fileRow.setAttribute('role', 'group');
  fileRow.setAttribute('aria-label', 'Attachments for the next message');
  fileRow.hidden = true;
  const noteEl = h('p', 'wfc-note');
  noteEl.hidden = true;
  const foot = h('div', 'wfc-foot');
  foot.append(fileRow, noteEl, row);
  const dropEl = h('div', 'wfc-drop');
  dropEl.setAttribute('aria-hidden', 'true');
  dropEl.hidden = true;
  dropEl.appendChild(h('span', 'wfc-drop-l', 'Drop files to attach'));
  const dot = h('span', 'wfc-dotu');
  dot.hidden = true;
  shell.append(head, thread, foot, dropEl, dot, sr);
  host.replaceChildren(shell);

  // ── fit the stage; keep the bottom-right bars visible (mockup fitWidth + checkLegend) ───────────────────
  /** The chat never grows past the stage (the Library takes 324 px of the window), and the Auto-layout + zoom bars
   *  step up clear of the dock whenever the two meet — the open chat covers them below ≈1380 px. Only the bars'
   *  left/right are read: their `bottom` transitions, so a measured top would flap. Both sit on the stage's
   *  bottom edge, so meeting side to side IS an overlap. */
  function place() {
    const W = stage ? stage.clientWidth : 0;
    if (W) shell.style.setProperty('--wfc-avail', `${Math.max(150, W - 24 - (plus && plus.offsetWidth ? plus.offsetWidth + 8 : 0))}px`);
    if (!cluster) return;
    const a = cluster.getBoundingClientRect();
    const b = host.getBoundingClientRect();
    const meet = a.width > 0 && b.width > 0 && a.left < b.right + 10 && a.right > b.left - 10;
    cluster.classList.toggle('is-up', meet);
    if (meet && stage) cluster.style.bottom = `${Math.round(stage.getBoundingClientRect().bottom - b.top + 12)}px`;
    else cluster.style.removeProperty('bottom');
  }
  // The open/close width and height transitions, a growing input or thread, the Library toggle and a window resize
  // all resize the shell or the stage: the observer re-places after each (jsdom has none — the tests call resize).
  const ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => place()) : null;
  if (ro) { ro.observe(shell); if (stage) ro.observe(stage); }
  win.addEventListener('resize', place);

  // ── open / close ───────────────────────────────────────────────────────────
  const isOpen = () => shell.dataset.open === 'true';
  function expand() {
    if (isOpen()) return;
    shell.dataset.open = 'true';
    dot.hidden = true;
    void client.open();
    render();
    place();
  }
  function collapse() {
    if (!isOpen()) return;
    closeMenus();
    shell.dataset.open = 'false';
    if (host.contains(doc.activeElement) && doc.activeElement.blur) doc.activeElement.blur();
    place();
    autosize();
  }
  /** Empty or collapsed, the CSS height (30 px) rules: Chrome's scrollHeight counts a wrapping placeholder. */
  const autosize = () => {
    if (!input.value || !isOpen()) input.style.height = '';
    else {
      input.style.height = 'auto';
      input.style.height = `${Math.min(104, Math.max(30, input.scrollHeight || 30))}px`;
    }
    sendBtn.setAttribute('aria-disabled', input.value.trim() && !client.busy() ? 'false' : 'true');
    sendBtn.classList.toggle('is-ready', Boolean(input.value.trim()) && !client.busy());
  };
  input.addEventListener('focus', expand);
  input.addEventListener('input', () => { expand(); autosize(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); collapse(); return; }
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); void send(); }
  });
  shell.addEventListener('pointerdown', (ev) => {
    if (isOpen() || (ev.target.closest && ev.target.closest('button'))) return;
    expand();
    win.setTimeout(() => input.focus(), 0);
  });
  shell.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !ev.defaultPrevented && isOpen()) { ev.preventDefault(); ev.stopPropagation(); collapse(); }
  });
  const onDocDown = (ev) => {
    if (!isOpen() || host.contains(ev.target)) return;
    if (ev.target.closest && ev.target.closest('.wfv-menu, .viewer-modal, #toasts, .toast, dialog')) return;
    collapse();
  };
  doc.addEventListener('pointerdown', onDocDown, true);
  minBtn.addEventListener('click', collapse);
  /** Composer chats are not in Ask's History and the dock lists no earlier one: a draft left unsaved in this chat is
   *  out of reach once a new chat starts. Ask first. */
  async function leaveDrafts(drafts) {
    if (typeof confirmFn !== 'function') return true;
    const n = drafts.length;
    const names = drafts.map((d) => (d.meta && d.meta.displayName) || d.key).join(', ');
    try {
      return Boolean(await confirmFn({ title: 'Start a new chat?', confirmLabel: 'Start new chat', cancelLabel: 'Keep this chat', danger: true,
        message: `This chat holds ${n === 1 ? '1 unsaved draft' : `${n} unsaved drafts`} (${names}). Start a new chat and leave ${n === 1 ? 'it' : 'them'}? This chat cannot be reopened.` }));
    } catch { return false; }
  }
  // Disabled while a turn runs (paintChrome): the old turn would keep running and spending, its edits never applied.
  newBtn.addEventListener('click', async () => {
    if (pending || client.busy()) return;
    const drafts = cards.pendingDrafts();
    // The modal restores no focus: keep it on New chat, never <body> (where the canvas owns Backspace and the arrows).
    if (drafts.length && !(await leaveDrafts(drafts))) { newBtn.focus(); return; }
    if (pending || client.busy()) { input.focus(); return; }          // a reply started while the question was open
    client.newChat(); cards.reset(); cardEls.clear(); userAtts.clear(); clearFiles(); error = ''; render(); input.focus();
  });
  stopBtn.addEventListener('click', () => { void client.stop(); });
  sendBtn.addEventListener('click', () => { void send(); });
  sel.addEventListener('click', () => { const s = composer.selection(); if (s && s.kind === 'node') composer.view.centerOn(s.id); });

  // ── scope ──────────────────────────────────────────────────────────────────
  function paintScope() {
    scopeBtn.replaceChildren(svg('folder'), h('span', 'wfc-scope-l', scope.pinned ? (scope.label || scope.projectKey) : 'Auto'), svg('chev'));
    scopeBtn.title = scope.pinned ? `Scope: project ${scope.label || scope.projectKey}` : 'Scope: Auto';
    scopeBtn.setAttribute('aria-label', scopeBtn.title);
    scopeBtn.classList.toggle('is-set', Boolean(scope.pinned));
  }
  function saveScope(next) {
    scope = next;
    try { if (storage) storage.setItem(SCOPE_KEY, JSON.stringify(scope)); } catch { /* private mode */ }
    paintScope();
  }
  /** A pin whose project is gone (removed since) falls back to Auto. Only a list that loaded may drop it. */
  function prunePin(list) {
    if (scope.pinned && Array.isArray(list) && !list.some((p) => p && p.key === scope.projectKey)) saveScope({ pinned: false });
  }
  void Promise.resolve().then(() => projects()).then(prunePin, () => { /* offline: keep the pin */ });
  scopeBtn.addEventListener('click', async () => {
    let list = [];
    try { list = await projects(); prunePin(list); } catch { list = []; }
    const set = (next) => { saveScope(next); input.focus(); };
    toggleMenu({ doc, anchor: scopeBtn, side: 'top', align: 'end', label: 'Scope', items: [
      { label: 'Auto', checked: !scope.pinned, onSelect: () => set({ pinned: false }) },
      ...(list.length ? [{ sep: true }, { header: 'Projects' }] : []),
      ...list.map((p) => ({ label: p.name || p.key, checked: Boolean(scope.pinned && scope.projectKey === p.key),
        onSelect: () => set({ pinned: true, projectKey: p.key, label: p.name || p.key }) })),
    ] });
  });

  // ── send ───────────────────────────────────────────────────────────────────
  async function send(text = input.value.trim()) {
    if (!text || pending || client.busy()) return;
    error = '';
    setNote('');
    pending = true;
    render();
    await adding;                                       // a file still being read rides this message, not the next
    const sent = pendingFiles.slice();
    const payload = { ...canvas(), drafts: cards.pendingDrafts() };
    const context = { view: 'workflows', pinned: Boolean(scope.pinned), ...(scope.pinned ? { projectKey: scope.projectKey } : {}) };
    const r = await client.send(text, { context, composer: payload, attachments: sent });
    pending = false;
    // The chips clear only once the message is in: a refused send keeps them for the retry.
    if (r.ok) { if (input.value.trim() === text) input.value = ''; autosize(); dropFiles(sent); }
    else error = r.error || 'Not sent.';
    render();
  }

  // ── attachments (Ask's types, caps and messages: attach-files.mjs) ────────────────────────────────
  const namePasted = createPasteNamer((parts, name, opts) => new win.File(parts, name, opts));
  /** Why a file was not attached ('' clears it): shown under the chips, and said once through the live region. */
  function setNote(text) {
    noteEl.textContent = text || '';
    noteEl.hidden = !text;
    if (text) sr.replaceChildren(h('div', '', text));
    place();
  }
  let shownFiles = [];          // the files the chips show, in order: the one under a focused × (renderFiles)
  function renderFiles() {
    // A rebuild under a focused × (a read landing, a sent message leaving) would drop the focus to <body>, where the
    // canvas owns Backspace and Delete: keep it on that file's ×, else the one now in its place, else the input.
    const at = [...fileRow.querySelectorAll('.wfc-file-x')].indexOf(doc.activeElement);
    const was = at >= 0 ? shownFiles[at] : null;
    fileRow.replaceChildren(...pendingFiles.map((f) => {
      const chip = h('span', 'wfc-file');
      chip.title = f.name;
      if (f.attKind === 'image' && f.dataBase64) {
        const img = h('img', 'wfc-file-thumb');
        img.alt = '';                                   // the name beside it says what it is
        img.src = `data:${f.mime};base64,${f.dataBase64}`;
        chip.appendChild(img);
      }
      const x = h('button', 'wfc-file-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', `Remove ${f.name}`);
      x.addEventListener('click', () => removeFile(f));
      chip.append(h('span', 'wfc-file-name', f.name), x);
      return chip;
    }));
    shownFiles = pendingFiles.slice();
    fileRow.hidden = !pendingFiles.length;
    if (pendingFiles.length) attachBtn.dataset.count = String(pendingFiles.length); else delete attachBtn.dataset.count;
    attachBtn.title = pendingFiles.length ? `Attach files (${pendingFiles.length} attached)` : 'Attach files';
    if (at >= 0) {
      const xs = [...fileRow.querySelectorAll('.wfc-file-x')];
      const i = pendingFiles.indexOf(was);
      (xs[i >= 0 ? i : Math.min(at, xs.length - 1)] || input).focus({ preventScroll: true });
    }
    place();                                           // the chips change the shell's height: re-lift the bars now
  }
  /** × drops one file. Its button leaves the DOM, and a focus dropped to <body> hands Backspace and Delete to the
   *  canvas (the selected card would go): move it to the × now in its place, else the one before, else the input. */
  function removeFile(f) {
    const at = pendingFiles.indexOf(f);
    pendingFiles = pendingFiles.filter((p) => p !== f);
    renderFiles();
    const xs = [...fileRow.querySelectorAll('.wfc-file-x')];
    (xs[Math.min(at, xs.length - 1)] || input).focus({ preventScroll: true });
  }
  function dropFiles(sent) {
    if (!sent.length) return;
    pendingFiles = pendingFiles.filter((p) => !sent.includes(p));
    renderFiles();
  }
  function clearFiles() { pendingFiles = []; setNote(''); renderFiles(); }
  /** Every way in (the picker, a drop, a paste) lands here, one batch at a time: a batch reads its files before the
   *  next one checks the caps. The PDF refusal reads the chat's engine: its lock, else the next message's default. */
  function addFiles(list) {
    const batch = [...(list || [])];
    if (!batch.length) return adding;
    adding = adding.then(() => addBatch(batch)).catch(() => {});
    return adding;
  }
  async function addBatch(batch) {
    setNote('');
    let engine = null;
    try { engine = await client.engine(); } catch { engine = null; }
    for (const f of batch) {
      const v = checkAttachment(f, { pending: pendingFiles, engine });
      if (!v.ok) { setNote(v.error); continue; }
      let dataBase64 = '';
      try { dataBase64 = bytesToBase64(new Uint8Array(await f.arrayBuffer()), (s) => win.btoa(s)); }
      catch { setNote(`could not read ${v.name}`); continue; }
      // Rebuilt from the list as it is NOW: a × pressed while this file was read stays pressed.
      pendingFiles = [...pendingFiles.filter((p) => p.name !== v.name), { name: v.name, bytes: f.size, dataBase64, attKind: v.attKind, mime: v.mime }];
    }
    renderFiles();
  }
  // The picker closed (a choice or Cancel): Chrome hands the focus back to the paperclip. Make sure it is never <body>.
  const keepFocus = () => { if (!host.contains(doc.activeElement)) attachBtn.focus({ preventScroll: true }); };
  attachBtn.addEventListener('click', () => { expand(); fileInput.click(); });
  fileInput.addEventListener('change', () => { void addFiles(fileInput.files); fileInput.value = ''; keepFocus(); });
  fileInput.addEventListener('cancel', keepFocus);
  input.addEventListener('paste', (ev) => {
    const list = pastedFiles(ev.clipboardData);
    if (!list) return;                                  // a text paste goes ahead natively
    ev.preventDefault();
    void addFiles(namePasted(list));
  });
  // A drop on the dock attaches (Ask's buildDropTarget). Only drags carrying files are touched: a Library card dragged
  // over the dock keeps its defaults. dragenter/dragleave fire on every child crossed (enter on the new one before
  // leave on the old), so a depth counter decides when the files really left; drop and dragend reset it.
  let dragDepth = 0;
  const endDrag = () => { dragDepth = 0; dropEl.hidden = true; };
  shell.addEventListener('dragenter', (ev) => {
    if (!carriesFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    dragDepth += 1;
    dropEl.hidden = false;
  });
  shell.addEventListener('dragover', (ev) => {
    if (!carriesFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    try { ev.dataTransfer.dropEffect = 'copy'; } catch { /* read-only in some engines */ }
  });
  shell.addEventListener('dragleave', (ev) => {
    if (!carriesFiles(ev.dataTransfer)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropEl.hidden = true;
  });
  shell.addEventListener('drop', (ev) => {
    if (!carriesFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    endDrag();
    expand();
    // The chips show in the open chat. The focus goes to its input, never <body>, where the canvas owns the keys.
    input.focus({ preventScroll: true });
    void addFiles(ev.dataTransfer.files);
  });
  shell.addEventListener('dragend', endDrag);

  // ── render ─────────────────────────────────────────────────────────────────
  function toolLine(b) {
    const short = String(b.name || '').replace(/^mcp__worca__/, '');
    const i = b.input && typeof b.input === 'object' ? b.input : {};
    const target = i.summary || i.name || i.displayName || i.key || (short === 'read_attachment' ? attachmentName(i.id) : '') || '';
    const el = h('div', `wfc-tool is-${b.status || 'running'}`);
    el.append(h('span', 'wfc-tool-i', b.status === 'done' ? '✓' : b.status === 'error' ? '!' : '…'),
      h('span', 'mono', `${TOOL_VERB[short] || short}${target ? ` ${String(target).slice(0, 80)}` : ''}`));
    if (b.status === 'error' && b.error) el.title = b.error;
    return el;
  }
  function answer(text) {
    const div = h('div', 'wfc-text');
    if (renderMarkdown) renderMarkdown(text, div); else div.textContent = text;
    return div;
  }
  function suggestions() {
    const box = h('div', 'wfc-suggest');
    for (const p of PLACEHOLDERS) {
      const t = p.replace(/…$/, '');
      const b = h('button', 'wfc-chip-btn', t);
      b.type = 'button';
      b.addEventListener('click', () => { void send(t); });
      box.appendChild(b);
    }
    return box;
  }
  const cardEls = new Map();    // card id → {sig, el}: the rendered card, reused while its sig holds
  const userAtts = new Map();   // user message id → {sig, el}: its attachments row, reused while it shows the same files
  /** A sent message's attachment blocks, in a row under its bubble (null = none). Reused like a card, so a tool frame
   *  mid-turn never reloads a thumbnail. */
  function userAttachments(msg) {
    const atts = (msg.blocks || []).filter((b) => b && b.kind === 'attachment');
    if (!atts.length) return null;
    const tid = client.threadId();
    const sg = JSON.stringify([tid, atts.map((b) => [b.id || null, b.name, b.attKind || 'text'])]);
    const hit = userAtts.get(msg.id);
    if (hit && hit.sig === sg) return hit.el;
    const row2 = h('div', 'wfc-uatts');
    for (const b of atts) row2.appendChild(attachmentPill(b, tid));
    userAtts.set(msg.id, { sig: sg, el: row2 });
    return row2;
  }
  /** An image the store has an id for is a thumbnail served by the download route (sniff-checked mime, inline), which
   *  opens in a new tab. Anything else, including an echo without an id, is a name pill (ask-panel buildAttachmentPill). */
  function attachmentPill(b, tid) {
    const name = b.name || (b.attKind === 'image' ? '(image)' : '(attachment)');
    if (b.attKind === 'image' && b.id && tid) {
      const url = `/api/ask/threads/${encodeURIComponent(tid)}/attachments/${encodeURIComponent(b.id)}`;
      const link = h('a', 'wfc-uthumb-link');
      link.setAttribute('href', url);
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = name;
      const img = h('img', 'wfc-uthumb');
      img.alt = name;
      img.setAttribute('loading', 'lazy');
      img.setAttribute('src', url);
      link.appendChild(img);
      return link;
    }
    const pill = h('span', 'wfc-upill', name);
    pill.title = name;
    return pill;
  }
  /** read_attachment names an attachment by id: its tool line shows the file name from the thread's ledger. */
  function attachmentName(id) {
    const m = client.model();
    const a = m && id && typeof m.attachments === 'function' ? m.attachments().find((x) => x && x.id === id) : null;
    return a ? a.name : '';
  }
  let liveAnswerEl = null;      // the streaming answer's element: a text-only frame rewrites just this node
  let liveLabelEl = null;
  function paintChrome(live) {
    const t = composer.template();
    ctx.textContent = t.name || 'Untitled pipeline';
    const s = composer.selection();
    const n = s && s.kind === 'node' ? t.nodes.find((x) => x.id === s.id) : null;
    // Chrome focuses a clicked button, and hiding (or disabling) the focused one drops the focus to <body>, where the
    // canvas owns Delete and the arrows (the next key would delete the selected card): hand it to the button taking its
    // place — Stop / Send swap, and the @ chip or a New chat waiting for a reply hand it to Minimize, the header's next.
    const a = doc.activeElement;
    const newOff = pending || client.busy();
    if ((a === sel && !n) || (a === newBtn && newOff)) minBtn.focus({ preventScroll: true });
    sel.hidden = !n;
    if (n) { const meta = composer.metaOf(n); sel.textContent = `@ ${(meta && meta.displayName) || n.key || n.kind}`; }
    if (live && a === sendBtn) { stopBtn.hidden = false; stopBtn.focus({ preventScroll: true }); }
    else if (!live && a === stopBtn) { sendBtn.hidden = false; sendBtn.focus({ preventScroll: true }); }
    stopBtn.hidden = !live;
    sendBtn.hidden = Boolean(live);
    newBtn.disabled = newOff;
    newBtn.title = newBtn.disabled ? 'New chat — after this reply' : 'New chat';
    paintScope();
    autosize();
  }
  /** The one line a screen reader hears when a card arrives or changes state ('' = nothing worth saying). */
  function cardLine(b) {
    const c = b.card;
    if (c.type === 'canvas-edit') {
      const what = c.summary || 'a change';
      return b.state === 'applied' ? `Changed the canvas: ${what}` : b.state === 'undone' ? `Undone: ${what}` : b.state === 'failed' ? `Not applied: ${what}` : '';
    }
    if (c.type === 'workflow-build') {
      const name = c.name || 'Untitled pipeline';
      return b.state === 'proposed' ? `Proposed workflow: ${name}` : b.state === 'applied' ? `Applied to canvas: ${name}` : '';
    }
    const kind = c.type === 'agent-draft' ? 'agent' : c.type === 'script-draft' ? 'script' : '';
    if (!kind) return '';
    const name = (c.draft && ((c.draft.meta && c.draft.meta.displayName) || c.draft.key)) || kind;
    const why = cards.notAdded(b.id);                                  // "Save & add" saved it, the canvas refused the add
    return b.state === 'proposed' ? `New ${kind}: ${name}` : b.state === 'saved' ? `Saved ${kind}: ${name}${why ? ` — not added to the canvas: ${why}` : ''}` : b.state === 'added' ? `Saved and added ${kind}: ${name}` : '';
  }
  let srModel = null;           // the thread model the announcer last read; a new one (load, New chat) is read silently
  const srSeen = new Map();     // card id → the state already announced
  let liveId = null;            // the streaming reply, to say how it ended
  function announce(m, msgs, finishedId) {
    const lines = [];
    const fresh = m !== srModel;
    if (fresh) { srModel = m; srSeen.clear(); }
    for (const msg of msgs) {
      for (const b of msg.blocks || []) {
        if (!b || b.kind !== 'card' || !b.card) continue;
        const was = srSeen.get(b.id);
        srSeen.set(b.id, b.state);
        if (!fresh && was !== b.state) { const line = cardLine(b); if (line) lines.push(line); }
      }
      if (!fresh && finishedId && msg.id === finishedId) lines.push(msg.status === 'error' ? 'The reply failed.' : 'Reply finished.');
    }
    if (lines.length) sr.replaceChildren(...lines.map((line) => h('div', '', line)));   // one block each: a pause between
  }
  /** `full` false = a WS frame. When the frame changed only the streaming text / label (ask-model's dirty set),
   *  rewrite those two nodes: rebuilding the thread under the pointer drops a click that straddles the rebuild
   *  (Undo and Apply arrive mid-turn), collapses an open <details> and yanks the scroll. Any other frame (a tool
   *  call, a card) rebuilds the thread but REUSES each card's element while its `cards.sig` holds. */
  function render(full = true) {
    const m = client.model();
    const d = m && typeof m.takeDirty === 'function' ? m.takeDirty() : null;
    const live = m && m.live ? m.live() : null;
    if (wasLive && !live && !isOpen()) dot.hidden = false;
    const finishedId = wasLive && !live ? liveId : null;
    wasLive = Boolean(live);
    liveId = live ? live.messageId : null;
    paintChrome(live);
    const textOnly = !full && d && !d.structure && !d.messages.size && !d.blocks.size && live
      && liveAnswerEl && liveAnswerEl.isConnected && liveAnswerEl.dataset.messageId === live.messageId;
    const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 24;
    if (textOnly) {
      if (d.answer.size) { if (renderMarkdown) renderMarkdown(live.text || '', liveAnswerEl); else liveAnswerEl.textContent = live.text || ''; }
      if (liveLabelEl) liveLabelEl.textContent = live.label || 'Thinking…';
      if (atBottom) thread.scrollTop = thread.scrollHeight;          // a reader at the bottom follows the stream
      return;
    }
    liveAnswerEl = null;
    liveLabelEl = null;
    // Moving a reused card into the new thread blurs a focused button in it (a keyboard user's Save): refocus it below.
    const focused = thread.contains(doc.activeElement) ? doc.activeElement : null;
    const kids = [];
    const msgs = m ? m.messages() : [];
    for (const msg of msgs) {
      if (msg.role === 'user') {
        if (Array.isArray(msg.blocks) && msg.blocks.some((b) => b && b.synthetic)) continue;
        kids.push(h('div', 'wfc-msg wfc-u', msg.text));
        const atts = userAttachments(msg);
        if (atts) kids.push(atts);
        continue;
      }
      const wrap = h('div', 'wfc-msg wfc-a');
      for (const b of msg.blocks || []) {
        if (!b) continue;
        if (b.kind === 'tool') wrap.appendChild(toolLine(b));
        else if (b.kind === 'card' && b.card && /^(canvas-edit|workflow-build|agent-draft|script-draft)$/.test(b.card.type)) {
          // Reuse the card's element while nothing it shows changed: a tool frame mid-turn must not swap the button under
          // the pointer (the click is lost) or collapse an open System prompt / Program.
          const sg = cards.sig(b);
          const hit = cardEls.get(b.id);
          const el = hit && hit.sig === sg ? hit.el : cards.render(b);
          cardEls.set(b.id, { sig: sg, el });
          wrap.appendChild(el);
        }
        else if (b.kind === 'notice' && b.text) wrap.appendChild(h('p', 'wfc-muted', b.text));
      }
      const isLive = Boolean(live && live.messageId === msg.id);
      const text = isLive ? live.text : msg.text;
      if (text || isLive) {
        const a = answer(text || '');
        if (isLive) { a.dataset.messageId = msg.id; liveAnswerEl = a; }
        wrap.appendChild(a);
      }
      // A live `ask-error` writes row.errorMessage (ask-model.mjs); a stored row carries `reason`.
      if (msg.status === 'error') wrap.appendChild(h('p', 'wfc-err', msg.errorMessage || msg.reason || 'The reply failed.'));
      kids.push(wrap);
    }
    if (live || pending) { liveLabelEl = h('div', 'wfc-live', (live && live.label) || 'Thinking…'); kids.push(liveLabelEl); }
    if (error) kids.push(h('p', 'wfc-err', error));
    if (!msgs.length && !pending && isOpen()) kids.push(suggestions());
    thread.replaceChildren(...kids);
    if (focused && focused.isConnected) { if (doc.activeElement !== focused) focused.focus({ preventScroll: true }); }
    else if (focused) {
      // The card under the focus was rebuilt (its own Save, Undo, Decline changed its sig): keep the keyboard on that
      // card — the same button, else its first live one, its summary, the card itself — never <body>, where the
      // canvas owns the keys (a Backspace would delete the selected card).
      const old = focused.closest && focused.closest('[data-card-id]');
      const card = old ? [...thread.querySelectorAll('[data-card-id]')].find((x) => x.dataset.cardId === old.dataset.cardId) : null;
      const btns = card ? [...card.querySelectorAll('button')].filter((x) => !x.disabled) : [];
      const next = btns.find((x) => x.textContent === focused.textContent) || btns[0] || (card && card.querySelector('summary'));
      if (next) next.focus({ preventScroll: true });
      else if (card) { card.tabIndex = -1; card.focus({ preventScroll: true }); }
      else input.focus({ preventScroll: true });
    }
    if (full || atBottom) thread.scrollTop = thread.scrollHeight;   // a frame never yanks a reader back down
    announce(m, msgs, finishedId);
  }
  let queued = false;
  let queuedFull = false;
  /** kind 'frame' (a WS frame) may take render()'s text-only path; anything else repaints the thread. */
  function schedule(kind = 'structure') {
    if (kind !== 'frame') queuedFull = true;
    if (queued) return;
    queued = true;
    Promise.resolve().then(() => { queued = false; const full = queuedFull; queuedFull = false; render(full); void cards.sweep(); });
  }

  const rot = win.setInterval(() => {
    if (isOpen() || input.value) return;
    ph = (ph + 1) % PLACEHOLDERS.length;
    input.placeholder = PLACEHOLDERS[ph];
  }, 4200);

  render();
  place();
  return {
    client,
    repaint: () => schedule(),
    pushFrame: (f) => client.pushFrame(f),
    onHello: () => client.onHello(),
    focus: () => { expand(); input.focus(); },
    collapse,
    destroy() {
      win.clearInterval(rot);
      cards.dispose();                       // a sweep waiting out a drag or a focused popover field never lands
      doc.removeEventListener('pointerdown', onDocDown, true);
      win.removeEventListener('resize', place);
      if (ro) ro.disconnect();
      if (cluster) { cluster.classList.remove('is-up'); cluster.style.removeProperty('bottom'); }
      host.replaceChildren();
    },
  };
}
