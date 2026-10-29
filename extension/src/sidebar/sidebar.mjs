// extension/src/sidebar/sidebar.mjs — the Worca sidebar: connection & pairing, Ask threads over the existing API, Ask's
// composer (attachments, area captures, chat scope, model + effort, cost and context) with page context
// (page-context.mjs / compose.mjs), Pinpoint's quote chip and the running-Action match. Renders with Ask Worca's
// classes inside worca's Chat page shell. The paired shell — composer and textarea included — is built ONCE; later
// state changes patch only chips, note, Send/Stop and changed rows, so a half-typed draft is never lost.
import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import { api, BROWSER, LEGACY_STORAGE_KEYS, STORAGE_KEYS, TEST_BUILD } from '../ext-api.mjs';
import { createWorcaClient, DEFAULT_BASE_URL, normalizeBaseUrl, selfOriginOf } from '../worca-client.mjs';
import { buildMessageBody, pickModel, validPick, reservedSlots } from '../compose.mjs';
import { CAPTURE_MAX } from '../page-context.mjs';
import { COMMANDS } from '../manifest.mjs';
import { ATTACH_MAX_FILES, bytesToBase64, carriesFiles, checkAttachment, createPasteNamer, pastedFiles } from '../../../ui/public/attach-files.mjs';
import { chatEngineOf, engineOfEntry } from '../../../ui/public/ask-engine.mjs';
import { createThreadModel } from '../../../ui/public/ask-model.mjs';
import { createMarkdownRenderer } from '../../../ui/public/ask-markdown.mjs';
import * as V from './sidebar-view.mjs';

const doc = document;
const app = doc.getElementById('app');
const params = new URLSearchParams(location.search);
const st = {
  phase: 'loading', baseUrl: DEFAULT_BASE_URL, token: null, code: null,
  catalog: null, threads: [], threadId: null, model: null,
  quote: null, draft: '', tab: null, withText: false, scope: { pinned: false }, projects: [], workspaces: [], lists: 'loading',
  scopeNames: new Map(),   // 'p:<key>' | 'w:<id>' -> name, from the last good lists and thread snapshots (a pin's label)
  ws: null, posting: false, error: null,
  sentQuotes: new Map(),   // userMessageId -> quote (this session: the quote rode page-quote.md, M1)
  files: [],               // pending [{name, bytes, dataBase64, attKind, mime, capture?}] (Ask's pendingFiles + capture meta)
  pick: null,              // {model, effort}: the composer's model picker (D12)
  modelPane: 'main',
  action: null,            // the running Action matching the tab's origin (D7), or null
  actionOrigin: null,
  scopeChosen: false,      // the user picked a scope from the pill in this chat (D9)
  pinpointOnSelect: false, // "Show Pinpoint when I select text" (D11)
  pinShortcut: 'Alt+Shift+W',
  capturing: false,        // the active tab shows the capture overlay (capture-state from the content script)
};
let el = null;                 // the paired shell's live nodes (null while a state screen shows)
let screen = null;             // the state screen, built once: setPhase patches its body, never its Settings
let pops = null;               // the composer's popovers (V.createPopovers), while paired
// While offline, probe() runs again after this long. Test builds may shorten it (?retryMs=) so an E2E run sees retries.
const OFFLINE_RETRY_MS = TEST_BUILD && params.has('retryMs') ? Number(params.get('retryMs')) : 5000;
const rowEls = new Map();      // messageId -> { el, answer }
const renderer = createMarkdownRenderer({ doc, load: async () => ({ marked, createDOMPurify }), hljsLoader: null });
const getConfig = async () => ({ baseUrl: st.baseUrl, token: st.token });
const client = createWorcaClient({ fetch: (u, o) => fetch(u, o), getConfig, selfOrigin: selfOriginOf(api.runtime) });
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
    if (m.type === 'tab') { st.tab = m; st.capturing = false; patchComposer(); void matchAction(); }
    else if (m.type === 'capture-state') st.capturing = m.on === true;
    else if (m.type === 'capture' && m.image && m.meta) { void addCapture(m.image, m.meta); }
    else if (m.type === 'capture-failed' || m.type === 'notice') { st.error = String(m.error || m.text || ''); patchComposer(); }
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
  bg.postMessage({ type: 'hello', windowId, pinnedTabId: pinned });   // windowId: set by boot()
}
setInterval(() => { try { bg?.postMessage({ type: 'ping' }); } catch { /* reconnecting */ } }, 20_000);   // keeps the SW awake while open
// A capture started from here (the camera, or the shortcut while typing) leaves focus in the sidebar, so the page's
// overlay never sees Esc: while one is up, Esc here cancels it through the service worker (review M1).
doc.addEventListener('keydown', (e) => {
  if (!st.capturing || e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  st.capturing = false;
  try { bg?.postMessage({ type: 'capture-cancel' }); } catch { /* reconnecting */ }
}, true);

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
  const s = await api.storage.local.get([STORAGE_KEYS.baseUrl, STORAGE_KEYS.token, STORAGE_KEYS.pinpointOnSelect, STORAGE_KEYS.askPick]);
  st.baseUrl = normalizeBaseUrl(s[STORAGE_KEYS.baseUrl]) || DEFAULT_BASE_URL;
  st.token = s[STORAGE_KEYS.token] || null;
  st.pinpointOnSelect = s[STORAGE_KEYS.pinpointOnSelect] === true;
  st.pick = s[STORAGE_KEYS.askPick] && typeof s[STORAGE_KEYS.askPick] === 'object' ? s[STORAGE_KEYS.askPick] : null;
  void loadShortcut();
  // The sidebar and Pinpoint follow the browser's colour scheme; the old theme choice is dropped, never read.
  void api.storage.local.remove([...LEGACY_STORAGE_KEYS]).catch?.(() => {});
  void renderer.ensure();
  windowId = await resolveWindowId();
  st.draft = await loadDraft();                    // D23: survives a sidebar reload / reopen (review m12)…
  await connectBackground();                       // …and is in place BEFORE a quote / Use-this text can arrive (m7)
  await probe();
}

/** The Pinpoint shortcut as the user bound it (chrome://extensions/shortcuts), for the Settings hint. */
async function loadShortcut() {
  try {
    const all = api.commands && typeof api.commands.getAll === 'function' ? await api.commands.getAll() : [];
    const c = (all || []).find((x) => x && x.name === COMMANDS.pinpoint);
    if (!c) return;
    st.pinShortcut = c.shortcut || '';
    for (const set of [screen && screen.settings, el && el.settings]) set?.setShortcut(st.pinShortcut);
  } catch { /* keep the default text */ }
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
    setTimeout(() => { if (st.phase === 'offline') void probe(); }, OFFLINE_RETRY_MS);
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
        resetActionMatch();
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
  resetActionMatch();
  await api.storage.local.remove([STORAGE_KEYS.token, STORAGE_KEYS.pairedId]);
}

// ---- paired: catalog, threads, socket -----------------------------------------------------------------------------
async function enterPaired() {
  const [catalog, threads] = await Promise.all([
    client.call('/api/ask/models'),
    client.call('/api/ask/threads?limit=20'),
    loadLists(),
  ]);
  st.catalog = catalog;
  st.pick = validPick(catalog, st.pick) || pickModel(catalog);   // the stored pick when the catalog still offers it
  st.threads = threads.threads || [];
  if (st.threadId) st.threads = V.upsertThread(st.threads, { id: st.threadId });   // the open chat stays listed
  setPhase('paired');
  patchHead();   // a reconnect re-enters here with the shell already mounted: setPhase returns early (review M1)
  patchComposer();
  void openSocket();
  void matchAction();
}

/** The project picker's lists. Never rejects: a failed request is st.lists = 'error' ("Couldn't load projects" + Retry),
 *  never an empty list that reads as "no projects". `show`: Retry paints "Loading projects…" meanwhile. */
let listsGen = 0;
async function loadLists({ show = false } = {}) {
  const gen = ++listsGen;
  if (show) { st.lists = 'loading'; patchHead(); pops?.rebuild(); }
  try {
    const [projects, workspaces] = await Promise.all([client.call('/api/projects'), client.call('/api/workspaces')]);
    if (gen !== listsGen) return;
    st.projects = (projects.projects || []).filter((p) => p.exists !== false);
    st.workspaces = workspaces.workspaces || [];
    st.lists = 'ok';
    for (const p of st.projects) if (p.name) st.scopeNames.set(`p:${p.key}`, p.name);
    for (const w of st.workspaces) if (w.name) st.scopeNames.set(`w:${w.id}`, w.name);
  } catch {
    if (gen !== listsGen) return;
    st.lists = 'error';
  }
  patchHead();
  if (pops && el && pops.isOpen(el.scope)) pops.rebuild();
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
  else { st.token = s[STORAGE_KEYS.token] || null; resetActionMatch(); }
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
  // The thread's context chips name its project/workspace (src/core/ask/contexts.mjs): a pin's label before the lists load.
  for (const c of (snap.thread && Array.isArray(snap.thread.contexts) ? snap.thread.contexts : [])) {
    if (c && (c.kind === 'project' || c.kind === 'workspace') && typeof c.id === 'string' && c.label && c.label !== c.id) st.scopeNames.set(`${c.kind[0] === 'p' ? 'p' : 'w'}:${c.id}`, String(c.label));
  }
  st.scope = ctx && ctx.pinned ? { pinned: true, projectKey: ctx.projectKey || null, workspaceId: ctx.workspaceId || null } : { pinned: false };
  // The thread's own model/effort wins (existing rule). A thread with none yet (one send() just created) keeps the pick.
  if (snap.thread && snap.thread.model) st.pick = pickModel(st.catalog, snap.thread) || st.pick;
  if (st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify({ type: 'subscribe', threadId: id }));
  patchHead();
  renderTranscript({ force: true });
  void maybeAutoPin();
}

/** "New chat" in the head: an empty transcript; the draft, quote and page chip stay (the user may be mid-question). */
function newChat() {
  st.error = null;
  st.scopeChosen = false;
  void openThread(null).then(() => maybeAutoPin());
}

// Test builds only: hold the socket closed without reconnecting, so an E2E test can let a turn end while the sidebar
// is deaf, then release (review m2). Never in production bundles (TEST_BUILD is a build-time constant).
let holdReconnect = false;
if (TEST_BUILD) {
  globalThis.__worcaSidebarTest = {
    holdSocket() { holdReconnect = true; st.ws?.close(); },
    releaseSocket() { holdReconnect = false; void probe(); },
    threadId: () => st.threadId,
    pick: () => st.pick,
    files: () => st.files.map((f) => f.name),
  };
}

const busy = () => st.posting || !!(st.model && st.model.inFlight());

async function send() {
  if (!el) return;
  const text = el.input.value.trim();
  if (!text || busy()) return;
  // buildMessageBody refuses an over-limit message, but only after a new thread exists: check first, so a refused
  // send never leaves an empty thread behind (DELETE is not on the allowlist).
  if (st.files.length + reserved(st.files.some((f) => f.capture)) > ATTACH_MAX_FILES) {
    st.error = `A message carries at most ${ATTACH_MAX_FILES} attachments, the page context included. Remove a file.`;
    patchComposer();
    return;
  }
  st.posting = true;
  st.error = null;
  patchComposer();
  const files = st.files;                                        // the chips as they are now (user files and screenshots)
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
    const body = buildMessageBody({ text, quote, ctx, withText: st.withText, catalog: st.catalog, scope, thread, pick: st.pick, files, action: st.action, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
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
    st.files = st.files.filter((f) => !files.includes(f));   // sent; a chip added during the POST stays
    st.withText = false;           // the page-text chip is per message (Clarify: page-context-default)
    if (el) { el.input.value = ''; V.fitInput(el.input); }   // an assignment fires no input event (m10)
  } catch (err) {
    // Only the plain "turn in flight" 409 is "still replying". The engine-broker / credential-missing 409s carry a
    // code; 'thread is being deleted' has none but does not match /in flight/ (ui/server.mjs:11242, :11260, :11265).
    st.error = err.status === 409 && !err.code && /in flight/i.test(err.message || '') ? 'Chat is still replying — try again once the answer lands.' : err.message;
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
  patchScope();
  if (st.threadId) {
    const scope = st.scope.pinned ? (st.scope.workspaceId ? { pinned: true, workspaceId: st.scope.workspaceId } : { pinned: true, projectKey: st.scope.projectKey }) : { pinned: false };
    await client.call(`/api/ask/threads/${encodeURIComponent(st.threadId)}`, { method: 'PATCH', body: { scope } }).catch((e) => { st.error = e.message; patchComposer(); });
  }
}

// ---- the composer's controls: files, captures, model, scope, the running-Action match ---------------------------
const catalogEntry = (id) => ((st.catalog && st.catalog.models) || []).find((x) => x.id === id) || null;
const lockEngine = () => (st.model ? chatEngineOf(st.model.messages(), st.pick && st.pick.model, st.catalog, st.model.thread() && st.model.thread().engine) : null);
/** The engine the next message runs on (ask-panel.mjs pickerEngine): the chat's lock, else the picked model's. */
const pickerEngine = () => lockEngine() || engineOfEntry(catalogEntry(st.pick && st.pick.model));
const reserved = (hasCapture) => reservedSlots({ tab: st.tab, withText: st.withText, quote: st.quote, hasCapture });

/** Ask's addFiles with the shared checks; the page context's slots are reserved first (the extension's own rule). */
async function addFiles(list) {
  st.error = null;
  for (const f of [...(list || [])]) {
    const v = checkAttachment(f, { pending: st.files, engine: pickerEngine() });
    if (!v.ok) { st.error = v.error; continue; }
    const r = reserved(st.files.some((x) => x.capture));
    if (v.others.length + r >= ATTACH_MAX_FILES) { st.error = `At most ${ATTACH_MAX_FILES - r} files with this page's context`; break; }
    let dataBase64 = '';
    try { dataBase64 = bytesToBase64(new Uint8Array(await f.arrayBuffer())); } catch { st.error = `could not read ${v.name}`; continue; }
    st.files = [...v.others, { name: v.name, bytes: f.size, dataBase64, attKind: v.attKind, mime: v.mime }];
  }
  patchComposer();
}

async function addCapture(image, meta) {
  if (st.files.filter((x) => x.capture).length >= CAPTURE_MAX) { st.error = `At most ${CAPTURE_MAX} screenshots per message`; patchComposer(); return; }
  if (st.files.length + reserved(true) >= ATTACH_MAX_FILES) { st.error = 'Remove a file to add this screenshot'; patchComposer(); return; }
  st.files = [...st.files, { name: image.name, bytes: image.bytes, dataBase64: image.dataBase64, attKind: 'image', mime: 'image/png', capture: meta }];
  st.error = null;
  patchComposer();
  el?.input.focus();
}

const namePasted = createPasteNamer((parts, name, opts) => new File(parts, name, opts));
function onPaste(e) {
  const fs = pastedFiles(e.clipboardData);
  if (!fs) return;                                  // a text paste goes ahead natively
  e.preventDefault();
  void addFiles(namePasted(fs));
}

/** ask-panel.mjs buildDropTarget's events: a depth counter on the conversation, files only. */
function wireDrop(target, overlay) {
  let depth = 0;
  const show = (on) => { overlay.hidden = !on; };
  const reset = () => { depth = 0; show(false); };
  target.addEventListener('dragenter', (e) => { if (!carriesFiles(e.dataTransfer)) return; e.preventDefault(); depth += 1; show(true); });
  target.addEventListener('dragover', (e) => { if (!carriesFiles(e.dataTransfer)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
  target.addEventListener('dragleave', (e) => { if (!carriesFiles(e.dataTransfer)) return; depth = Math.max(0, depth - 1); if (!depth) show(false); });
  target.addEventListener('drop', (e) => { if (!carriesFiles(e.dataTransfer)) return; e.preventDefault(); reset(); void addFiles(e.dataTransfer.files); });
  target.addEventListener('dragend', reset);
}

/** ask-panel.mjs coerceEffort: keep the effort when the model offers it, else high, else its first. */
function coerceEffort(entry, effort) {
  if (!entry || !Array.isArray(entry.efforts) || entry.efforts.includes(effort)) return effort;
  return entry.efforts.includes('high') ? 'high' : entry.efforts[0];
}

/** D12: stored like Ask's worca-cc.ask.model; an open thread is PATCHed too (Ask's persistThreadPick). */
async function setPick(next) {
  st.pick = next;
  st.modelPane = 'main';
  void api.storage.local.set({ [STORAGE_KEYS.askPick]: next })?.catch?.(() => {});
  patchModel();
  if (st.threadId) {
    await client.call(`/api/ask/threads/${encodeURIComponent(st.threadId)}`, { method: 'PATCH', body: { model: next.model, effort: next.effort } })
      .catch((e) => { st.error = e.message; patchComposer(); });
  }
}

function openModel(btn) {
  st.modelPane = 'main';
  pops.open(btn, 'ask-pop-model', (panel) => V.fillModelPopover(doc, panel, {
    catalog: st.catalog, pick: st.pick, lock: lockEngine(), pane: st.modelPane,
    onModel: (id) => { pops.close({ focusTrigger: false }); void setPick({ model: id, effort: coerceEffort(catalogEntry(id), st.pick && st.pick.effort) }); el?.input.focus(); },
    // No pick when the catalog is empty: nothing to set an effort on.
    onEffort: (eff) => { pops.close({ focusTrigger: false }); if (st.pick) void setPick({ model: st.pick.model, effort: eff }); el?.input.focus(); },
    onPane: (p) => { st.modelPane = p; pops.rebuild(); },
  }));
}

const scopeView = () => V.scopeModel({ status: st.lists, projects: st.projects, workspaces: st.workspaces, scope: st.scope, names: st.scopeNames });
function openScope(btn) {
  pops.open(btn, 'ask-pop-scope', (panel) => V.fillScopePopover(doc, panel, scopeView(), {
    onPick: (v) => { st.scopeChosen = true; pops.close(); void setScope(v); },
    onRetry: () => { void loadLists({ show: true }); },
    onOpen: () => { pops.close(); api.tabs.create({ url: st.baseUrl }); },
  }));
}

const actionCache = new Map();   // origin -> {at, match}
const ACTION_TTL_MS = 30_000;
const ACTION_CACHE_MAX = 50;
let actionGen = 0;               // bumped by resetActionMatch: a lookup still in flight is dropped
let actionLoading = null;        // the origin a lookup is running for
const freshMatch = (origin) => { const hit = actionCache.get(origin); return hit && Date.now() - hit.at < ACTION_TTL_MS ? hit : null; };
/** Another Worca, or a fresh pairing: no earlier answer applies. */
function resetActionMatch() {
  actionGen += 1;
  actionCache.clear();
  actionLoading = null;
  st.actionOrigin = null;
  st.action = null;
}
/** D7: the running worca Action that serves the tab's origin (one cached lookup per origin for ACTION_TTL_MS, the same
 *  origin included). A failure is silent. */
async function matchAction() {
  let origin = null;
  try { const u = new URL(st.tab && st.tab.url); origin = /^https?:$/.test(u.protocol) ? u.origin : null; } catch { origin = null; }
  if (st.phase !== 'paired') return;                                  // enterPaired runs it once paired
  const same = origin === st.actionOrigin;
  if (same && (!origin || freshMatch(origin) || actionLoading === origin)) return;
  st.actionOrigin = origin;
  if (!same) st.action = null;                     // the same origin keeps its match while it is asked again
  if (!origin) { patchComposer(); return; }
  const gen = actionGen;
  const hit = freshMatch(origin);
  let match = hit ? hit.match : undefined;
  if (match === undefined) {
    actionLoading = origin;
    try { match = (await client.call(`/api/extension/actions/match?origin=${encodeURIComponent(origin)}`)).match || null; } catch { match = null; }
    if (gen !== actionGen) return;                 // re-paired or another address meanwhile
    if (actionLoading === origin) actionLoading = null;
    const t = Date.now();
    for (const [o, h] of actionCache) if (t - h.at >= ACTION_TTL_MS) actionCache.delete(o);   // prune what expired
    actionCache.set(origin, { at: t, match });
    while (actionCache.size > ACTION_CACHE_MAX) actionCache.delete(actionCache.keys().next().value);
  }
  if (st.actionOrigin !== origin) return;          // the tab moved on meanwhile
  st.action = match;
  await maybeAutoPin();
  patchComposer();
}

/** D9: pre-pin to the run's project only while the chat is "No project" and the user has not chosen a scope here. */
async function maybeAutoPin() {
  const a = st.action;
  if (!a || st.scope.pinned || st.scopeChosen || (!a.projectKey && !a.workspaceId)) return;
  await setScope(a.workspaceId ? `w:${a.workspaceId}` : `p:${a.projectKey}`);
}

async function setPinpointOnSelect(on) {
  st.pinpointOnSelect = !!on;
  for (const set of [screen && screen.settings, el && el.settings]) set?.setPinpoint(st.pinpointOnSelect);
  await api.storage.local.set({ [STORAGE_KEYS.pinpointOnSelect]: st.pinpointOnSelect });   // the SW relays it (D11)
}

// ---- rendering ----------------------------------------------------------------------------------------------------
const openInWorca = () => api.tabs.create({ url: `${st.baseUrl}/${st.threadId ? `#chat/${st.threadId}` : '#chat'}` });

/** Every non-paired state. The offline retry, the pairing poll, the socket's onclose timer and releaseSocket call this
 *  over and over: only the screen's body is replaced, so an open Connection settings panel keeps its typed address,
 *  focus and caret. */
function setPhase(p) {
  st.phase = p;
  if (p === 'paired') { if (!el) mountPaired(); return; }
  el = null;
  pops?.close({ focusTrigger: false });
  pops = null;
  rowEls.clear();
  const kind = p === 'loading' ? 'offline' : p;
  const s = stateScreen();
  s.box.className = `wx-state wx-${kind}`;
  const row = V.make(doc, 'div', 'wx-state-actions');
  const btn = (cls, label, fn) => { const b = V.make(doc, 'button', cls, label); b.type = 'button'; b.onclick = fn; row.append(b); };
  if (['unpaired', 'denied', 'expired'].includes(p)) btn('btn btn-primary', p === 'unpaired' ? 'Connect' : 'Ask again', () => void startPairing());
  if (p === 'offline' || p === 'loading') btn('btn', 'Try again', () => void probe());
  if (p === 'pairing') btn('btn', 'Open Worca', openInWorca);
  s.body.replaceChildren(...V.stateNodes(doc, kind, { baseUrl: st.baseUrl, reason: p === 'offline' ? st.offlineReason : null, code: st.code && `${st.code.slice(0, 3)} ${st.code.slice(3)}` }), row);
  s.settings.sync(st.baseUrl);
  if (s.box.parentNode !== app) app.replaceChildren(s.box);
}

function stateScreen() {
  if (screen) return screen;
  const box = V.make(doc, 'div', 'wx-state');
  const body = V.make(doc, 'div', 'wx-state-body');
  const settings = V.buildSettings(doc, { value: st.baseUrl, onSave: (v) => void saveBaseUrl(v, settings), pinpointOnSelect: st.pinpointOnSelect, onPinpoint: (on) => void setPinpointOnSelect(on) });
  settings.setShortcut(st.pinShortcut);
  box.append(body, settings.el);
  screen = { box, body, settings };
  return screen;
}

async function saveBaseUrl(raw, settings = screen.settings) {
  const v = normalizeBaseUrl(raw);
  if (!v) { settings.invalid('Use http://127.0.0.1:<port> or http://localhost:<port>'); return; }
  st.baseUrl = v;
  settings.reset(v);   // only Save (or a changed stored address, setPhase → sync) resets the input
  await api.storage.local.set({ [STORAGE_KEYS.baseUrl]: v });
  pairGen += 1;          // v8: a pairing loop for the old address stops
  await forgetToken();   // a token belongs to the Worca that issued it
  void probe();
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
  threads.onchange = () => { if (threads.value) { st.scopeChosen = false; void openThread(threads.value).catch(reportLoadError); } else newChat(); };
  // worca's Chat head New chat (ask-panel.mjs newChatPlus): the + right after the chat list.
  const newBtn = V.buildNewChatButton(doc, 'chat-head-btn', () => newChat());
  // Settings (D10): the same disclosure as the state screens, revealed under the head.
  const settingsBtn = V.buildIconButton(doc, 'btn btn-quiet btn-icon chat-head-btn', 'Settings', V.ICON.settings, () => {
    settings.el.hidden = !settings.el.hidden;
    if (!settings.el.hidden) settings.el.open = true;
  });
  settingsBtn.setAttribute('data-wx-settings-btn', '');
  head.append(threads, newBtn, settingsBtn);
  const settings = V.buildSettings(doc, { value: st.baseUrl, onSave: (v) => void saveBaseUrl(v, settings), pinpointOnSelect: st.pinpointOnSelect, onPinpoint: (on) => void setPinpointOnSelect(on) });
  settings.setShortcut(st.pinShortcut);
  settings.el.hidden = true;
  settings.el.classList.add('wx-settings-paired');
  const transcript = V.make(doc, 'div', 'ask-transcript');
  transcript.setAttribute('data-ask-scroll', '');
  const col = V.make(doc, 'div', 'ask-transcript-col');
  transcript.appendChild(col);
  const dock = V.make(doc, 'div', 'chat-dock');
  const composer = V.buildComposer(doc, {
    placeholder: 'Ask about this page…', onInput: (v) => setDraft(v), onSend: () => void send(), onStop: () => void stop(),
    onFiles: (fs) => void addFiles(fs), onPaste,
    onCapture: () => { st.error = null; patchComposer(); try { bg?.postMessage({ type: 'capture' }); } catch { /* reconnecting */ } },
    onScope: (btn) => openScope(btn), onModel: (btn) => openModel(btn),
    onCtx: (btn) => pops.open(btn, 'ask-pop-ctx', (p) => V.fillCtxPopover(doc, p, V.meterState(st.model ? st.model.totals() : {}))),
  });
  dock.appendChild(composer.el);
  const drop = V.buildDropOverlay(doc);
  convo.append(head, settings.el, transcript, dock, drop);
  page.appendChild(convo);
  app.replaceChildren(page);
  pops = V.createPopovers(doc, composer.el);
  wireDrop(convo, drop);
  el = { page, threads, settings, transcript, col, dock, drop, ...composer };
  el.input.value = st.draft;                                    // restore the draft (M4, D23)
  requestAnimationFrame(() => V.fitInput(el.input));            // measured once laid out (m10)
  new ResizeObserver(() => page.style.setProperty('--chat-dock-h', `${dock.offsetHeight}px`)).observe(dock);   // as ask-panel mirrors it
  patchHead();
  patchComposer();
  renderTranscript({ force: true });
}

/** The head: the thread list (V.threadOptions: the open thread is always listed and selected), and the composer's
 *  scope pill. Called after every list, thread or scope change: create, load, ask-title, enterPaired, loadLists (M1). */
function patchHead() {
  if (!el) return;
  el.threads.replaceChildren(...V.threadOptions(st.threads, st.threadId).map((o) => new Option(o.label, o.value, false, o.selected)));
  patchScope();
}

function patchScope() { if (el) V.patchScopePill(el.scope, el.scopeLabel, scopeView()); }

/** ask-panel.mjs updatePickerButton: the catalog label (+ ⚠ for a flagged model), the effort unless it takes none. */
function patchModel() {
  if (!el) return;
  const entry = catalogEntry(st.pick && st.pick.model);
  const flagged = !!entry && (entry.costUnreliable === true || (Array.isArray(entry.secretsMissing) && entry.secretsMissing.length > 0));
  el.modelLabel.textContent = (entry ? entry.label || entry.id : (st.pick ? st.pick.model : '')) + (flagged ? ' ⚠' : '');
  el.modelEffort.textContent = entry && entry.noEffort ? '' : (st.pick ? st.pick.effort : '');
  el.modelEffort.hidden = !!(entry && entry.noEffort);
}

/** The meter and an open context popover, only when the figures changed: every streaming frame lands here. */
function patchMeter() {
  if (!el) return;
  const s = V.meterState(st.model ? st.model.totals() : {});
  const key = JSON.stringify(s);
  if (key === el.meterKey) return;
  el.meterKey = key;
  V.patchMeter(el, s);
  if (pops && pops.isOpen(el.ctxBtn)) pops.rebuild();
}

/** Chips, the sends-note, the error line, Send/Stop — never the textarea (M4). The chips are rebuilt only when what
 *  they show changed (st.quote / st.files are replaced, never mutated), so a focused × survives streaming frames. */
function patchComposer() {
  if (!el) return;
  const chipsKey = [st.quote, st.files, st.tab && st.tab.title, !!(st.tab && st.tab.readable), st.withText];
  if (!el.chipsKey || chipsKey.some((v, i) => v !== el.chipsKey[i])) {
    el.chipsKey = chipsKey;
    const chips = [];
    if (st.quote) chips.push(V.buildQuoteChip(doc, st.quote, () => { st.quote = null; patchComposer(); el.input.focus(); }));
    for (const f of st.files) chips.push(V.buildFileChip(doc, f, () => { st.files = st.files.filter((x) => x !== f); patchComposer(); el.input.focus(); }));
    chips.push(V.buildPageChip(doc, { title: st.tab && st.tab.title, readable: !!(st.tab && st.tab.readable), on: st.withText }, () => { st.withText = !st.withText; patchComposer(); }));
    el.chips.replaceChildren(...chips);
  }
  el.chips.hidden = false;
  el.lead.replaceChildren(V.buildSendsNote(doc, st.tab, st.withText, !!st.quote, { screenshots: st.files.filter((f) => f.capture).length, action: st.action }));
  el.msg.textContent = st.error || '';
  el.msg.hidden = !st.error;
  const b = busy();
  el.send.hidden = b;
  el.stop.hidden = !b;
  patchScope();
  patchModel();
  patchMeter();
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

void boot();
