// extension/src/sidebar/sidebar.mjs — the Worca sidebar: connection & pairing, Ask threads over the existing API, the
// composer with page context (page-context.mjs / compose.mjs) and Pinpoint's quote chip. Renders with Ask Worca's
// classes inside worca's Chat page shell. The paired shell — composer and textarea included — is built ONCE; later
// state changes patch only chips, note, Send/Stop and changed rows, so a half-typed draft is never lost.
import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import { api, BROWSER, STORAGE_KEYS, TEST_BUILD } from '../ext-api.mjs';
import { createWorcaClient, DEFAULT_BASE_URL, normalizeBaseUrl } from '../worca-client.mjs';
import { buildMessageBody } from '../compose.mjs';
import { createThreadModel } from '../../../ui/public/ask-model.mjs';
import { createMarkdownRenderer } from '../../../ui/public/ask-markdown.mjs';
import * as V from './sidebar-view.mjs';

const doc = document;
const app = doc.getElementById('app');
const params = new URLSearchParams(location.search);
const st = {
  phase: 'loading', baseUrl: DEFAULT_BASE_URL, token: null, code: null,
  catalog: null, threads: [], threadId: null, model: null,
  quote: null, draft: '', tab: null, withText: false, scope: { pinned: false }, projects: [], workspaces: [],
  ws: null, posting: false, error: null, theme: 'system',
  sentQuotes: new Map(),   // userMessageId -> quote (this session: the quote rode page-quote.md, M1)
};
let el = null;                 // the paired shell's live nodes (null while a state screen shows)
const rowEls = new Map();      // messageId -> { el, answer }
const renderer = createMarkdownRenderer({ doc, load: async () => ({ marked, createDOMPurify }), hljsLoader: null });
const getConfig = async () => ({ baseUrl: st.baseUrl, token: st.token });
const client = createWorcaClient({ fetch: (u, o) => fetch(u, o), getConfig });
let bg = null;
let windowId = null;
let collectSeq = 0;
const collectWaits = new Map();

// ---- service-worker port (tab binding, page context, Pinpoint quotes) ------------------------------------------
/** The window this sidebar belongs to (test builds may pin it). Resolved before the draft loads and before the port
 *  connects, so the draft key is known and no quote can arrive ahead of the restored draft (review m7). */
async function resolveWindowId() {
  if (TEST_BUILD && params.has('windowId')) return Number(params.get('windowId'));
  return (await api.windows.getCurrent()).id;
}

async function connectBackground() {
  bg = api.runtime.connect({ name: 'worca-sidebar' });
  bg.onMessage.addListener((m) => {
    if (m.type === 'tab') { st.tab = m; patchComposer(); }
    else if (m.type === 'context') { collectWaits.get(m.id)?.(m.data); collectWaits.delete(m.id); }
    else if (m.type === 'quote' && m.quote && m.quote.text) {
      st.quote = m.quote;                          // the chip (rides page-quote.md, D10)
      if (m.text) appendToDraft(m.text);           // Use this / Discuss / Go deeper wording (D24, review M5)
      patchComposer();
      el?.input.focus();
    }
  });
  bg.onDisconnect.addListener(() => { bg = null; setTimeout(connectBackground, 500); });   // the SW restarted: rebind
  const pinned = TEST_BUILD && params.has('tabId') ? Number(params.get('tabId')) : null;
  bg.postMessage({ type: 'hello', windowId, pinnedTabId: pinned, theme: st.theme });   // windowId: set by boot()
}
setInterval(() => { try { bg?.postMessage({ type: 'ping' }); } catch { /* reconnecting */ } }, 20_000);   // keeps the SW awake while open

function collectContext(withText) {
  return new Promise((resolve) => {
    const id = `c${++collectSeq}`;
    collectWaits.set(id, resolve);
    try { bg.postMessage({ type: 'collect', id, withText }); } catch { resolve(null); }
    setTimeout(() => { if (collectWaits.delete(id)) resolve(null); }, 3000);
  });
}

// ---- the draft (D23) ----------------------------------------------------------------------------------------------
// storage.session: in memory, cleared when the browser quits, trusted contexts only by default. Per window.
const draftKey = () => `worca.draft.${windowId}`;
async function loadDraft() {
  try { const s = await api.storage.session.get(draftKey()); return typeof s[draftKey()] === 'string' ? s[draftKey()] : ''; } catch { return ''; }
}
let draftTimer = 0;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { api.storage.session.set({ [draftKey()]: st.draft }).catch?.(() => {}); }, 250);
}
function setDraft(v) { st.draft = v; saveDraft(); }
// Closing the side panel kills the page before the 250 ms debounce fires. Flush on pagehide so the last keystrokes survive (D23, v7).
addEventListener('pagehide', () => { clearTimeout(draftTimer); try { api.storage.session.set({ [draftKey()]: st.draft })?.catch?.(() => {}); } catch { /* closing */ } });
/** Append Pinpoint's wording to the draft without losing what is typed (ask-panel.mjs appendToComposer). */
function appendToDraft(text) {
  setDraft(V.appendDraftText(st.draft, text));
  if (el) { el.input.value = st.draft; V.fitInput(el.input); try { el.input.selectionStart = el.input.selectionEnd = el.input.value.length; } catch { /* closed */ } }
}

// ---- connection & pairing ---------------------------------------------------------------------------------------
async function boot() {
  const s = await api.storage.local.get([STORAGE_KEYS.baseUrl, STORAGE_KEYS.token, STORAGE_KEYS.theme]);
  st.baseUrl = normalizeBaseUrl(s[STORAGE_KEYS.baseUrl]) || DEFAULT_BASE_URL;
  st.token = s[STORAGE_KEYS.token] || null;
  st.theme = s[STORAGE_KEYS.theme] || 'system';
  doc.documentElement.dataset.theme = st.theme;
  void renderer.ensure();
  windowId = await resolveWindowId();
  st.draft = await loadDraft();                    // D23: survives a sidebar reload / reopen (review m12)…
  await connectBackground();                       // …and is in place BEFORE a quote / Use-this text can arrive (m7)
  await probe();
}

async function probe() {
  try {
    await client.call('/api/extension/hello', { auth: false });
    if (!st.token) return setPhase('unpaired');
    await client.call('/api/extension/status');
    await enterPaired();
  } catch (err) {
    if (err.kind === 'unpaired') { await forgetToken(); return setPhase('unpaired'); }
    if (err.kind === 'remote') return setPhase('remote');
    // Worca answered but a paired call failed (e.g. a 500 from /api/ask/models): say so instead of "isn't running".
    st.offlineReason = err.kind === 'http' ? err.message : null;
    setPhase('offline');
    setTimeout(() => { if (st.phase === 'offline') void probe(); }, 5000);
  }
}

// v8: one pairing loop at a time. A double click on Connect, or Settings → Save while a loop polls, starts a new
// generation; the stale loop stops instead of seeing 410 for its replaced request and painting "expired" over the live code.
let pairGen = 0;
async function startPairing() {
  const gen = ++pairGen;
  try {
    const r = await client.call('/api/extension/pair', { method: 'POST', auth: false, body: { name: `Worca for ${BROWSER[0].toUpperCase()}${BROWSER.slice(1)}`, browser: BROWSER } });
    if (gen !== pairGen) return;
    st.code = r.code;
    setPhase('pairing');
    for (;;) {
      await new Promise((res) => setTimeout(res, 1500));
      if (gen !== pairGen) return;
      let p;
      try { p = await client.call(`/api/extension/pair/${r.requestId}`, { auth: false, headers: { 'X-Worca-Pair-Poll': r.pollKey } }); }
      catch (err) { if (gen !== pairGen) return; return setPhase(err.status === 410 ? 'expired' : err.kind === 'offline' ? 'offline' : 'unpaired'); }
      if (gen !== pairGen) return;
      if (p.status === 'pending') continue;
      if (p.status === 'denied') return setPhase('denied');
      if (p.status === 'approved') {
        st.token = p.token;
        await api.storage.local.set({ [STORAGE_KEYS.token]: p.token, [STORAGE_KEYS.pairedId]: p.id });
        // Paired, but a follow-up call (e.g. /api/ask/models) may fail. Retry through probe(), which shows
        // "offline"/offlineReason, instead of falling into the outer catch and showing "Connect" again (v7).
        return enterPaired().catch(() => probe());
      }
      return setPhase('expired');
    }
  } catch (err) {
    if (gen !== pairGen) return;
    setPhase(err.kind === 'remote' ? 'remote' : err.kind === 'offline' ? 'offline' : 'unpaired');
  }
}

async function forgetToken() {
  st.token = null;
  await api.storage.local.remove([STORAGE_KEYS.token, STORAGE_KEYS.pairedId]);
}

// ---- paired: catalog, threads, socket -----------------------------------------------------------------------------
async function enterPaired() {
  const [catalog, threads, projects, workspaces] = await Promise.all([
    client.call('/api/ask/models'),
    client.call('/api/ask/threads?limit=20'),
    client.call('/api/projects').catch(() => ({ projects: [] })),
    client.call('/api/workspaces').catch(() => ({ workspaces: [] })),
  ]);
  st.catalog = catalog;
  st.threads = threads.threads || [];
  if (st.threadId) st.threads = V.upsertThread(st.threads, { id: st.threadId });   // the open chat stays listed
  st.projects = (projects.projects || []).filter((p) => p.exists !== false);
  st.workspaces = workspaces.workspaces || [];
  setPhase('paired');
  patchHead();   // a reconnect re-enters here with the shell already mounted: setPhase returns early (review M1)
  void openSocket();
}

const reportLoadError = (err) => { st.error = err && err.message ? err.message : String(err); patchComposer(); };

async function openSocket() {
  const url = await client.wsUrl();
  // probe() can run concurrently (offline retry, "Try again", onclose timer, releaseSocket, onPairingEnded); each run
  // ends here. Close the previous socket first — its onclose then sees st.ws !== ws and stays quiet (review cycle 1).
  const prev = st.ws;
  st.ws = null;
  try { prev?.close(); } catch { /* already closed */ }
  const ws = new WebSocket(url, ['worca-ext', st.token]);
  st.ws = ws;
  ws.onmessage = (ev) => {
    if (st.ws !== ws) return;          // a superseded socket's late frames never apply twice
    let f = null;
    try { f = JSON.parse(ev.data); } catch { return; }
    // A fresh socket forgot every subscription and may have missed frames, including an ask-done (review M6a). Re-sync
    // over REST like ask-panel.mjs onHello → resync() (:5392): openThread re-fetches the snapshot, rebuilds the
    // model and re-subscribes (the server replays a job only while it is still in askJobs).
    if (f.type === 'hello') { if (st.threadId) void openThread(st.threadId).catch(reportLoadError); return; }
    // A title lands for ANY of this user's threads (turn.mjs:1394 → broadcast; extension sockets get every ask-*
    // frame the viewer filter lets through): repaint the head's list (review M1).
    if (f.type === 'ask-title' && typeof f.threadId === 'string') { st.threads = V.retitleThread(st.threads, f.threadId, f.title); patchHead(); }
    if (!st.model || f.threadId !== st.threadId) return;
    const out = st.model.apply(f);
    if (out && out.gap) { void openThread(st.threadId).catch(reportLoadError); return; }   // a seq gap: re-fetch the snapshot
    renderTranscript();
  };
  ws.onclose = (ev) => {
    if (st.ws !== ws) return;
    st.ws = null;
    if (ev.code === 4003) { void onPairingEnded(); return; }      // revoked, or re-paired (review m3)
    if (holdReconnect) return;                                    // test builds only (holdSocket, review m2)
    setTimeout(() => void probe(), 1500);
  };
}

/** 4003: this socket's pairing ended. Forget the token only if it is still the stored one: a sidebar in another window
 *  may have just re-paired (that is what closed us) and stored a fresh token in the shared storage.local. */
async function onPairingEnded() {
  const used = st.token;
  // A re-pair from ANOTHER window closes this socket (4003) up to one poll (1.5 s) before that window stores the new
  // token. Give it 2 s, so this window adopts the new token instead of forgetting it (plan review cycle 4, minor).
  await new Promise((res) => setTimeout(res, 2000));
  const s = await api.storage.local.get(STORAGE_KEYS.token);
  if (s[STORAGE_KEYS.token] === used) await forgetToken();
  else st.token = s[STORAGE_KEYS.token] || null;
  await probe();   // no token → Connect; the fresh token → paired again
}

// Load generation, as ask-panel.mjs loadThread (:5155-5171): a hello resync and a user's switch can overlap; only the
// newest load may install its model (review m6).
let loadGen = 0;

/** Open a thread (id) or a new chat (null). Resolves once the newest load is installed; a superseded load is dropped. */
async function openThread(id) {
  const gen = ++loadGen;
  st.threadId = id;      // frames for any other thread are ignored from now on
  st.model = null;
  if (!id) { patchHead(); renderTranscript({ force: true }); return; }
  let snap;
  try {
    snap = await client.call(`/api/ask/threads/${encodeURIComponent(id)}`);
  } catch (err) {
    if (gen !== loadGen) return;
    if (err.status === 404) { st.threads = V.dropThread(st.threads, id); return openThread(null); }   // deleted in Worca
    throw err;
  }
  if (gen !== loadGen) return;                                   // a newer switch / resync won
  const m = createThreadModel({ threadId: id });
  m.load(snap);
  st.model = m;
  st.threads = V.upsertThread(st.threads, snap.thread);         // listed, with its current title (review M1)
  const ctx = snap.thread && snap.thread.context;
  st.scope = ctx && ctx.pinned ? { pinned: true, projectKey: ctx.projectKey || null, workspaceId: ctx.workspaceId || null } : { pinned: false };
  if (st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify({ type: 'subscribe', threadId: id }));
  patchHead();
  renderTranscript({ force: true });
}

/** "New chat" in the head: an empty transcript; the draft, quote and page chip stay (the user may be mid-question). */
function newChat() {
  st.error = null;
  void openThread(null);
}

// Test builds only: hold the socket closed without reconnecting, so an E2E test can let a turn end while the sidebar
// is deaf, then release (review m2). Never in production bundles (TEST_BUILD is a build-time constant).
let holdReconnect = false;
if (TEST_BUILD) {
  globalThis.__worcaSidebarTest = {
    holdSocket() { holdReconnect = true; st.ws?.close(); },
    releaseSocket() { holdReconnect = false; void probe(); },
    threadId: () => st.threadId,
  };
}

const busy = () => st.posting || !!(st.model && st.model.inFlight());

async function send() {
  if (!el) return;
  const text = el.input.value.trim();
  if (!text || busy()) return;
  st.posting = true;
  st.error = null;
  patchComposer();
  // The scope is captured BEFORE any await (v7). A WS `hello` during the POST or collectContext calls
  // openThread(st.threadId), which re-adopts the thread's stored (still empty) context as st.scope.
  const scope = st.scope;
  try {
    if (!st.threadId) {
      // openThread adopts the new thread's (empty) context as the scope; a project/workspace picked before the first
      // message must survive it, as the Ask panel keeps its picker scope (ask-panel.mjs:930-947) (review cycle 1).
      const gen0 = loadGen;
      const r = await client.call('/api/ask/threads', { method: 'POST', body: {} });
      st.threads = V.upsertThread(st.threads, r.thread);        // listed and selectable right away (review M1)
      // The user picked another thread while the POST ran: keep the draft and do not drag the view back
      // (ask-panel.mjs:920-929 aborts the same way). The empty thread stays listed; DELETE is not on the allowlist.
      if (loadGen !== gen0) { st.posting = false; patchComposer(); return; }
      await openThread(r.thread.id);
      if (st.threadId !== r.thread.id) { st.posting = false; patchComposer(); return; }   // a later load won the loadGen race
      st.scope = scope;
      patchHead();
    }
    const threadId = st.threadId;                                // the thread this message goes to, whatever loads next (m6)
    const ctx = await collectContext(st.withText);
    const quote = st.quote;
    // The thread's own model/effort (a chat started in Worca on another model, or a Codex-locked chat) — never silently
    // switched to the catalog default (review cycle 1).
    const thread = st.model && st.threadId === threadId ? st.model.thread() : null;
    const body = buildMessageBody({ text, quote, ctx, withText: st.withText, catalog: st.catalog, scope, thread, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    const r = await client.call(`/api/ask/threads/${encodeURIComponent(threadId)}/messages`, { method: 'POST', body });
    if (quote) st.sentQuotes.set(r.userMessageId, quote);
    // A resync may have replaced the model meanwhile (its snapshot then already holds this message, and noteLocal…
    // dedupes by id); a switch away means this thread is not on screen.
    if (st.model && st.threadId === threadId) st.model.noteLocalUserMessage({ id: r.userMessageId, text: body.text, attachments: V.echoAttachments(r.attachments) });   // kind → attKind (m8)
    // Only now: a failed send keeps the draft (M4). The state is cleared first. `el` may be null when the socket
    // dropped during the POST and setPhase('offline') unmounted the composer (v7); the message was still sent, so a
    // remount must not restore the text and invite a double send.
    setDraft('');
    st.quote = null;
    st.withText = false;           // the page-text chip is per message (Clarify: page-context-default)
    if (el) { el.input.value = ''; V.fitInput(el.input); }   // an assignment fires no input event (m10)
  } catch (err) {
    // Only the plain "turn in flight" 409 is "still replying". The engine-broker / credential-missing 409s carry a
    // code; 'thread is being deleted' has none but does not match /in flight/ (ui/server.mjs:11242, :11260, :11265).
    st.error = err.status === 409 && !err.code && /in flight/i.test(err.message || '') ? 'Ask Worca is still replying — try again once the answer lands.' : err.message;
    if (err.kind === 'offline') { st.posting = false; return setPhase('offline'); }
  }
  st.posting = false;
  patchComposer();
  renderTranscript();
}

async function stop() {
  if (st.threadId) await client.call(`/api/ask/threads/${encodeURIComponent(st.threadId)}/stop`, { method: 'POST', body: {} }).catch(() => null);
}

async function setScope(value) {
  const [kind, id] = String(value).split(':');
  st.scope = kind === 'p' ? { pinned: true, projectKey: id } : kind === 'w' ? { pinned: true, workspaceId: id } : { pinned: false };
  if (st.threadId) {
    const scope = st.scope.pinned ? (st.scope.workspaceId ? { pinned: true, workspaceId: st.scope.workspaceId } : { pinned: true, projectKey: st.scope.projectKey }) : { pinned: false };
    await client.call(`/api/ask/threads/${encodeURIComponent(st.threadId)}`, { method: 'PATCH', body: { scope } }).catch((e) => { st.error = e.message; patchComposer(); });
  }
}

// ---- rendering ----------------------------------------------------------------------------------------------------
const openInWorca = () => api.tabs.create({ url: `${st.baseUrl}/${st.threadId ? `#chat/${st.threadId}` : '#chat'}` });

function setPhase(p) {
  st.phase = p;
  if (p === 'paired') { if (!el) mountPaired(); return; }
  el = null;
  rowEls.clear();
  const box = V.buildState(doc, p === 'loading' ? 'offline' : p, { baseUrl: st.baseUrl, reason: p === 'offline' ? st.offlineReason : null, code: st.code && `${st.code.slice(0, 3)} ${st.code.slice(3)}` });
  const row = V.make(doc, 'div', 'wx-state-actions');
  const btn = (cls, label, fn) => { const b = V.make(doc, 'button', cls, label); b.type = 'button'; b.onclick = fn; row.append(b); };
  if (['unpaired', 'denied', 'expired'].includes(p)) btn('btn-go', p === 'unpaired' ? 'Connect' : 'Ask again', () => void startPairing());
  if (p === 'offline' || p === 'loading') btn('btn-ghost', 'Try again', () => void probe());
  if (p === 'pairing') btn('btn-ghost', 'Open Worca', openInWorca);
  box.append(row, buildSettings());
  app.replaceChildren(box);
}

/** The paired shell — the real Chat page structure (index.html chat view / ask-panel.mjs :480-498). Built once. */
function mountPaired() {
  const page = V.make(doc, 'div', 'chat-page');
  page.dataset.view = 'thread';
  page.dataset.history = 'closed';
  const convo = V.make(doc, 'div', 'chat-convo');
  const head = V.make(doc, 'div', 'chat-head');
  const threads = V.make(doc, 'select', 'wx-select');
  threads.setAttribute('aria-label', 'Chat');
  threads.onchange = () => { if (threads.value) void openThread(threads.value).catch(reportLoadError); else newChat(); };
  const scope = V.make(doc, 'select', 'wx-select');
  scope.setAttribute('aria-label', 'Project or workspace');
  scope.onchange = () => void setScope(scope.value);
  head.append(threads, scope);
  const transcript = V.make(doc, 'div', 'ask-transcript');
  transcript.setAttribute('data-ask-scroll', '');
  const col = V.make(doc, 'div', 'ask-transcript-col');
  transcript.appendChild(col);
  const dock = V.make(doc, 'div', 'chat-dock');
  const composer = V.buildComposer(doc, { placeholder: 'Ask about this page…', onInput: (v) => setDraft(v), onSend: () => void send(), onStop: () => void stop() });
  dock.appendChild(composer.el);
  convo.append(head, transcript, dock);
  page.appendChild(convo);
  app.replaceChildren(page);
  el = { page, threads, scope, transcript, col, dock, ...composer };
  el.input.value = st.draft;                                    // restore the draft (M4, D23)
  requestAnimationFrame(() => V.fitInput(el.input));            // measured once laid out (m10)
  new ResizeObserver(() => page.style.setProperty('--chat-dock-h', `${dock.offsetHeight}px`)).observe(dock);   // as ask-panel mirrors it
  patchHead();
  patchComposer();
  renderTranscript({ force: true });
}

/** The head: the thread list (V.threadOptions: the open thread is always listed and selected) and the scope. Called
 *  after every list or thread change: create, load, ask-title, enterPaired (review M1). */
function patchHead() {
  if (!el) return;
  el.threads.replaceChildren(...V.threadOptions(st.threads, st.threadId).map((o) => new Option(o.label, o.value, false, o.selected)));
  el.scope.replaceChildren(new Option('Auto', 'auto'),
    ...st.projects.map((p) => new Option(p.name, `p:${p.key}`, false, st.scope.projectKey === p.key)),
    ...st.workspaces.map((w) => new Option(`${w.name} (workspace)`, `w:${w.id}`, false, st.scope.workspaceId === w.id)));
}

/** Chips, the sends-note, the error line, Send/Stop — never the textarea (M4). */
function patchComposer() {
  if (!el) return;
  const chips = [];
  if (st.quote) chips.push(V.buildQuoteChip(doc, st.quote, () => { st.quote = null; patchComposer(); el.input.focus(); }));
  chips.push(V.buildPageChip(doc, { title: st.tab && st.tab.title, readable: !!(st.tab && st.tab.readable), on: st.withText }, () => { st.withText = !st.withText; patchComposer(); }));
  el.chips.replaceChildren(...chips);
  el.chips.hidden = false;
  el.lead.replaceChildren(V.buildSendsNote(doc, st.tab, st.withText, !!st.quote));
  el.msg.textContent = st.error || '';
  el.msg.hidden = !st.error;
  const b = busy();
  el.send.hidden = b;
  el.stop.hidden = !b;
}

const rowText = (r) => { const live = st.model && st.model.live(); return live && live.messageId === r.id ? live.text : (r.text || ''); };
const rowLive = (r) => { const live = st.model && st.model.live(); return !!(live && live.messageId === r.id); };
const entryFor = (r) => V.buildRow(doc, r, { text: rowText, live: rowLive, renderer, sentQuote: st.sentQuotes.get(r.id) || null, openInWorca });

/** Incremental, like ask-panel.mjs renderTranscript: structure → rebuild; changed rows → replace; ask-delta → repaint
 *  only that answer from live().text (M3). */
function renderTranscript({ force = false } = {}) {
  if (!el) return;
  if (!st.model) { el.col.replaceChildren(); rowEls.clear(); patchComposer(); return; }
  const d = st.model.takeDirty();
  const rows = st.model.messages();
  const nearBottom = el.transcript.scrollHeight - el.transcript.scrollTop - el.transcript.clientHeight < 80;
  if (force || d.structure || rows.some((r) => !rowEls.has(r.id)) || rowEls.size !== rows.length) {
    rowEls.clear();
    el.col.replaceChildren(...rows.map((r) => { const e = entryFor(r); rowEls.set(r.id, e); return e.el; }));
  } else {
    // d.blocks (Map<messageId, Set<blockId>>): a notice or card arrived mid-turn (ask-block / ask-card, ask-model.mjs
    // :171-177). The Ask panel patches the row's tail; the sidebar rebuilds the row, which renders the live text too (m9).
    const rebuild = new Set([...d.messages, ...d.blocks.keys()]);
    for (const id of rebuild) {
      const r = rows.find((x) => x.id === id); const old = rowEls.get(id);
      if (!r || !old) continue;
      const e = entryFor(r); old.el.replaceWith(e.el); rowEls.set(id, e);
    }
    for (const id of d.answer) {
      if (rebuild.has(id)) continue;
      const r = rows.find((x) => x.id === id); const e = rowEls.get(id);
      if (r && e && e.answer) V.renderAnswerInto(e.answer, rowText(r), renderer, { live: rowLive(r) });
    }
  }
  if (nearBottom || force) el.transcript.scrollTop = el.transcript.scrollHeight;
  patchComposer();
}

function buildSettings() {
  const d = V.make(doc, 'details', 'wx-settings');
  d.append(V.make(doc, 'summary', null, 'Connection settings'));
  const url = V.make(doc, 'input', 'input');
  url.type = 'text';
  url.value = st.baseUrl;
  url.setAttribute('aria-label', 'Worca address');
  const save = V.make(doc, 'button', 'btn-ghost', 'Save');
  save.type = 'button';
  save.onclick = async () => {
    const v = normalizeBaseUrl(url.value);
    if (!v) { url.setCustomValidity('Use http://127.0.0.1:<port> or http://localhost:<port>'); url.reportValidity(); return; }
    st.baseUrl = v;
    await api.storage.local.set({ [STORAGE_KEYS.baseUrl]: v });
    pairGen += 1;          // v8: a pairing loop for the old address stops
    await forgetToken();   // a token belongs to the Worca that issued it
    void probe();
  };
  const theme = V.make(doc, 'select', 'wx-select');
  theme.setAttribute('aria-label', 'Theme');
  for (const [v, l] of [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]) theme.append(new Option(l, v, false, st.theme === v));
  theme.onchange = async () => { st.theme = theme.value; doc.documentElement.dataset.theme = st.theme; await api.storage.local.set({ [STORAGE_KEYS.theme]: st.theme }); bg?.postMessage({ type: 'theme', theme: st.theme }); };
  d.append(url, save, theme);
  return d;
}

void boot();
