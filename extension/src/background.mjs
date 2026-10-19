// extension/src/background.mjs — the service worker (Chrome/Edge) / event page (Firefox). Owns: the sidebar ↔ tab
// binding (panel-state.mjs), content-script injection (activeTab + scripting), the context menu, the keyboard commands
// (Pinpoint on request, area capture), the capture itself (captureVisibleTab + an OffscreenCanvas crop), and the
// Pinpoint proxy (pinpoint-proxy.mjs). Content scripts never get the token; only this file and the sidebar read it.
import { api, BROWSER, DEMO_BUILD, STORAGE_KEYS, TEST_BUILD } from './ext-api.mjs';
import { createPanelState, createPendingCaptures } from './panel-state.mjs';
import { COMMANDS } from './manifest.mjs';
import { cropPlan } from './capture-geometry.mjs';
import { sanitizeCaptureMeta } from './page-context.mjs';
import { bytesToBase64 } from '../../ui/public/attach-files.mjs';
import { createWorcaClient, DEFAULT_BASE_URL, selfOriginOf } from './worca-client.mjs';
import { servePinpointPort } from './pinpoint-proxy.mjs';
import { clipQuote } from '../../ui/public/pinpoint-model.mjs';

const MENU_ID = 'worca-ask-selection';
const DRAFT_TEXT_MAX = 2000;   // Pinpoint's follow-up wording (D24); the quote itself is clipped by clipQuote
const FONTS = [['Worca Poppins', '400', 'fonts/poppins-latin-400-normal.woff2'], ['Worca Poppins', '500', 'fonts/poppins-latin-500-normal.woff2'], ['Worca Poppins', '600', 'fonts/poppins-latin-600-normal.woff2'], ['Worca JetBrains Mono', '400', 'fonts/jetbrains-mono-latin-400-normal.woff2']];
const state = createPanelState();
const sidebars = new Map();        // windowId -> sidebar Port
const contents = new Map();        // tabId -> content Port
const queuedQuotes = new Map();    // windowId -> [{quote}] until the sidebar connects
const pending = createPendingCaptures();

// No setAccessLevel call (v7): Chrome offers it on storage.session only, and storage.local is always readable from the
// extension's own content scripts, on every browser. That is acceptable because ours never reads storage, and page
// scripts cannot reach extension storage. The token stays out of the content script's messages (D7, D12).
const getConfig = async () => {
  const s = await api.storage.local.get([STORAGE_KEYS.baseUrl, STORAGE_KEYS.token]);
  return { baseUrl: s[STORAGE_KEYS.baseUrl] || DEFAULT_BASE_URL, token: s[STORAGE_KEYS.token] || null };
};
const client = createWorcaClient({ fetch: (u, o) => fetch(u, o), getConfig, selfOrigin: selfOriginOf(api.runtime) });
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const toSidebar = (windowId, m) => { try { sidebars.get(windowId)?.postMessage(m); } catch { /* closed */ } };
const toContent = (tabId, m) => { try { const p = contents.get(tabId); if (!p) return false; p.postMessage(m); return true; } catch { return false; } };

// D11: the content script never reads storage; the SW hands it the option with `activate` and on every change.
let autoSelect = false;
const autoReady = api.storage.local.get(STORAGE_KEYS.pinpointOnSelect).then((s) => { autoSelect = s[STORAGE_KEYS.pinpointOnSelect] === true; }).catch(() => {});
api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(STORAGE_KEYS.pinpointOnSelect in changes)) return;
  autoSelect = changes[STORAGE_KEYS.pinpointOnSelect].newValue === true;
  for (const tabId of contents.keys()) if (state.isActiveTab(tabId)) toContent(tabId, { type: 'pinpoint-auto', on: autoSelect });
});
const activateMsg = () => ({ type: 'activate', autoSelect });
/** Start a capture now when the tab's script is live and active; else leave it pending for its hello. */
const startPendingCapture = (tabId) => { if (pending.take(tabId)) toContent(tabId, { type: 'capture-start' }); };

function openPanel(windowId) {   // must run synchronously inside the user gesture
  // v8: choose by build, not by feature detection (a future Firefox sidePanel shim must not win over sidebarAction).
  if (BROWSER === 'firefox') api.sidebarAction.open().catch?.(() => {});
  else api.sidePanel.open({ windowId }).catch(() => {});
}

/** Basic context without the content script (s1): url/title if the browser exposes them under activeTab. */
async function tabBasics(tabId) {
  try { const t = await api.tabs.get(tabId); return t && t.url ? { url: t.url, title: t.title || '', selection: '' } : null; } catch { return null; }
}

async function inject(windowId, tabId) {
  if (contents.has(tabId)) {
    // A tab switch back to an already-injected tab: the content script sends no new hello, so ask it for the tab info
    // here — otherwise the page chip and "Sends with your message" keep describing the previous tab (review cycle 1).
    await autoReady;
    toContent(tabId, activateMsg());
    toContent(tabId, { type: 'collect', id: 'tab', withText: false });
    startPendingCapture(tabId);
    return;
  }
  try {
    await api.scripting.executeScript({ target: { tabId, allFrames: false }, files: ['content.js'] });
  } catch {
    const b = await tabBasics(tabId);
    toSidebar(windowId, { type: 'tab', tabId, readable: false, title: b && b.title, url: b && b.url, reason: 'Click the Worca button in the toolbar to use this page.' });
  }
}

async function focus(windowId, tabId) {
  const { deactivate, activate } = state.focus(windowId, tabId);
  if (deactivate != null) toContent(deactivate, { type: 'deactivate' });
  if (activate != null) { await inject(windowId, activate); return true; }
  return false;   // v8: callers inject only when focus did not, so one click never injects twice
}

function onMenuClick(info, tab) {
  if (info.menuItemId !== MENU_ID || !tab) return;
  openPanel(tab.windowId);
  // OnClickData always carries pageUrl/frameUrl; tab.url depends on permissions.
  const quote = { text: clipQuote(info.selectionText || ''), src: hostOf(info.frameUrl || info.pageUrl || tab.url) };
  if (sidebars.has(tab.windowId)) toSidebar(tab.windowId, { type: 'quote', quote });
  else queuedQuotes.set(tab.windowId, [...(queuedQuotes.get(tab.windowId) || []), { quote }]);
  // As the toolbar handler: use the fresh activeTab grant to (re-)inject even when the panel already shows this tab.
  if (state.isOpen(tab.windowId)) void focus(tab.windowId, tab.id).then((did) => { if (!did) return inject(tab.windowId, tab.id); });
}

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({ id: MENU_ID, title: 'Worca Chat: ask about selection', contexts: ['selection'] }, () => void api.runtime.lastError);
});
api.contextMenus.onClicked.addListener(onMenuClick);

api.action.onClicked.addListener((tab) => {
  openPanel(tab.windowId);                         // first: the gesture is still live
  if (state.isOpen(tab.windowId)) void focus(tab.windowId, tab.id).then((did) => { if (!did) return inject(tab.windowId, tab.id); });
});

function onCommand(command, tab) {
  if (!tab || tab.id == null) return;
  if (command === COMMANDS.pinpoint) {
    // Pinpoint lives only in the tab the sidebar is active for (D13); elsewhere the shortcut does nothing.
    if (state.isActiveTab(tab.id)) toContent(tab.id, { type: 'pinpoint-open' });
    return;
  }
  if (command !== COMMANDS.capture) return;
  const open = state.isOpen(tab.windowId);
  if (!open) openPanel(tab.windowId);              // first and synchronous: the command is the user gesture
  pending.set(tab.id);
  if (state.isActiveTab(tab.id) && contents.has(tab.id)) { startPendingCapture(tab.id); return; }
  // The command's fresh activeTab grant lets us (re-)inject; a sidebar still opening focuses + injects on its hello.
  if (open) void focus(tab.windowId, tab.id).then((did) => { if (!did) return inject(tab.windowId, tab.id); });
}
api.commands.onCommand.addListener(onCommand);

api.tabs.onActivated.addListener(({ tabId, windowId }) => { if (state.isOpen(windowId)) void focus(windowId, tabId); });
api.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete') return;
  const w = state.windowOfActiveTab(tabId) ?? (tab && state.activeTabOf(tab.windowId) === tabId ? tab.windowId : null);
  if (w != null) { contents.delete(tabId); void inject(w, tabId); }   // re-inject after navigation (best-effort, D11)
});
api.tabs.onRemoved.addListener((tabId) => contents.delete(tabId));

api.runtime.onConnect.addListener((port) => {
  if (port.sender && port.sender.id !== api.runtime.id) { port.disconnect(); return; }
  if (port.name === 'worca-sidebar') return onSidebar(port);
  if (port.name === 'worca-content') return onContent(port);
  if (port.name === 'worca-pinpoint') {
    return servePinpointPort(port, { client, allowed: () => !!(port.sender && port.sender.tab && port.sender.frameId === 0 && state.isActiveTab(port.sender.tab.id)) });
  }
  port.disconnect();
});

function onSidebar(port) {
  let windowId = null;
  port.onMessage.addListener(async (m) => {
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'hello') {
      windowId = m.windowId;
      sidebars.set(windowId, port);
      state.open(windowId, { pinnedTabId: TEST_BUILD && Number.isInteger(m.pinnedTabId) ? m.pinnedTabId : null });
      for (const q of queuedQuotes.get(windowId) || []) port.postMessage({ type: 'quote', ...q });
      queuedQuotes.delete(windowId);
      const [tab] = await api.tabs.query({ active: true, windowId });
      await focus(windowId, tab ? tab.id : null);
    } else if (m.type === 'collect') {
      const tabId = state.activeTabOf(windowId);
      if (tabId != null && toContent(tabId, { type: 'collect', id: m.id, withText: !!m.withText })) return;
      port.postMessage({ type: 'context', id: m.id, data: tabId != null ? await tabBasics(tabId) : null });   // s1
    } else if (m.type === 'capture') {
      const tabId = state.activeTabOf(windowId);
      if (tabId != null && toContent(tabId, { type: 'capture-start' })) return;
      port.postMessage({ type: 'capture-failed', error: 'Worca cannot capture this page. Click the Worca button in the toolbar (or press the capture shortcut) first.' });
    } else if (m.type === 'capture-cancel') {
      const tabId = state.activeTabOf(windowId);
      if (tabId != null) toContent(tabId, { type: 'capture-cancel' });   // Esc pressed in the sidebar (focus is there)
    }
  });
  port.onDisconnect.addListener(() => {
    // A late disconnect of a replaced port (sidebar reload) must not tear down the new port's registration (v7).
    if (windowId == null || sidebars.get(windowId) !== port) return;
    sidebars.delete(windowId);
    const tabId = state.close(windowId);
    if (tabId != null) toContent(tabId, { type: 'deactivate' });
  });
}

function onContent(port) {
  const tabId = port.sender && port.sender.tab ? port.sender.tab.id : null;
  if (tabId == null || port.sender.frameId !== 0) { port.disconnect(); return; }
  contents.set(tabId, port);
  port.onMessage.addListener(async (m) => {
    if (!m || typeof m.type !== 'string') return;
    const windowId = state.windowOfActiveTab(tabId);
    if (m.type === 'hello') {
      contents.set(tabId, port);   // a live script re-announcing itself (re-inject hit its guard) is tracked again
      if (windowId != null) {
        await autoReady;
        port.postMessage(activateMsg());
        port.postMessage({ type: 'collect', id: 'tab', withText: false });
        startPendingCapture(tabId);
      } else port.postMessage({ type: 'deactivate' });
    } else if (m.type === 'fonts') {
      port.postMessage({ type: 'fonts', fonts: await loadFonts() });
    } else if (m.type === 'context' && windowId != null) {
      if (m.id === 'tab') toSidebar(windowId, { type: 'tab', tabId, readable: !!m.data, title: m.data && m.data.title, url: m.data && m.data.url });
      else toSidebar(windowId, { type: 'context', id: m.id, data: m.data });
    } else if (m.type === 'send-to-chat' && windowId != null && m.quote && typeof m.quote.text === 'string') {
      // Pinpoint's draft(quote, text) (pinpoint.mjs:165/:271/:351/:403/:424): the quote → the chip; `text` (Use this /
      // Discuss / Go deeper wording) → appended to the draft (D24). src comes from the sender, never from the page.
      const text = typeof m.text === 'string' ? m.text.trim().slice(0, DRAFT_TEXT_MAX) : '';
      toSidebar(windowId, { type: 'quote', quote: { text: clipQuote(m.quote.text), src: hostOf(port.sender.url) }, text });
    } else if (m.type === 'capture-state' && windowId != null) {
      toSidebar(windowId, { type: 'capture-state', on: m.on === true });
    } else if (m.type === 'capture-rect' && windowId != null) {
      void captureArea(port, tabId, windowId, m);
    } else if (m.type === 'pinpoint-none' && windowId != null) {
      toSidebar(windowId, { type: 'notice', text: 'Select some text on the page first, then press the shortcut again.' });
    }
  });
  port.onDisconnect.addListener(() => { if (contents.get(tabId) === port) contents.delete(tabId); });
}

/** captureVisibleTab needs an activeTab grant (the shortcut, the toolbar button, the context menu) or <all_urls>. An
 *  E2E run can give neither: Playwright cannot press extension shortcuts, and <all_urls> would strip the Origin header
 *  the pairing gate keys on. So test builds only: when the real call is refused, a source a spec installed through the
 *  test hook (setCaptureSource) supplies the viewport PNG (a real Playwright screenshot); the crop is real. */
let testCaptureSource = null;   // stays null in production: only the TEST_BUILD hook below can set it
async function captureVisible(windowId) {
  // Demo-video build: the recorder's clean screenshot (no stage captions/cursor) beats a real capture. Folded away in production.
  if (DEMO_BUILD && testCaptureSource) return testCaptureSource(windowId);
  try {
    return await api.tabs.captureVisibleTab(windowId, { format: 'png' });
  } catch (err) {
    if (testCaptureSource) return testCaptureSource(windowId);
    throw err;
  }
}

const CAPTURE_FAIL = 'Worca could not capture this page. Click the Worca button in the toolbar (or press the capture shortcut) and try again.';
async function captureArea(port, tabId, windowId, m) {
  try {
    const t = await api.tabs.get(tabId);
    if (!t || !t.active) return toSidebar(windowId, { type: 'capture-failed', error: 'Switch back to the page to capture it.' });
    const meta = sanitizeCaptureMeta(m.meta, { url: port.sender.url || t.url || '' });   // url from the browser, never the page
    const dataUrl = await captureVisible(t.windowId);
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const plan = cropPlan({ rect: meta.rect, viewport: meta.viewport, image: { width: bmp.width, height: bmp.height } });
    if (!plan) { bmp.close?.(); return toSidebar(windowId, { type: 'capture-failed', error: 'That area is too small to capture.' }); }
    const canvas = new OffscreenCanvas(plan.dw, plan.dh);
    canvas.getContext('2d').drawImage(bmp, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, plan.dw, plan.dh);
    bmp.close?.();
    const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    toSidebar(windowId, { type: 'capture', image: { name: `screenshot-${Date.now()}.png`, mime: 'image/png', bytes: png.length, dataBase64: bytesToBase64(png), width: plan.dw, height: plan.dh }, meta });
  } catch {
    toSidebar(windowId, { type: 'capture-failed', error: CAPTURE_FAIL });
  }
}

let fontCache = null;
async function loadFonts() {
  if (fontCache) return fontCache;
  const b64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
  fontCache = await Promise.all(FONTS.map(async ([family, weight, file]) => ({ family, weight, data: b64(await (await fetch(api.runtime.getURL(file))).arrayBuffer()) })));
  return fontCache;
}

// `build`: the demo recorder checks it before recording; 'worca-demo-build' is also what the production leak check greps for.
if (TEST_BUILD) globalThis.__worcaTest = { build: DEMO_BUILD ? 'worca-demo-build' : 'test', focus, contextMenuClick: onMenuClick, command: onCommand, setCaptureSource: (fn) => { testCaptureSource = fn; } };
