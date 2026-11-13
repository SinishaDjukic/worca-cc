// test/desktop-controller.test.mjs — the desktop app's window policy, tray and controller with a fake electron
// (desktop/src/window.mjs, tray-menu.mjs, controller.mjs). desktop/main.mjs is glue that imports electron: not loaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { windowOptions, linkPolicy, permissionAllowed, applyContentsPolicy } from '../desktop/src/window.mjs';
import { trayMenuTemplate } from '../desktop/src/tray-menu.mjs';
import { createDesktopController, openServerLog } from '../desktop/src/controller.mjs';
import { appMenuTemplate } from '../desktop/src/app-menu.mjs';
import { TRAFFIC_LIGHTS, THEME_COLORS } from '../desktop/src/title-bar.mjs';
import { serverTreeRoot } from '../desktop/src/server-process.mjs';
import { BADGE_CHANNEL, NO_BADGE, badgeBitmap } from '../desktop/src/badge.mjs';
import { APP_ID } from '../desktop/src/app-id.mjs';

const tick = () => new Promise((r) => setImmediate(r));
async function until(cond, n = 100) { for (let i = 0; i < n && !cond(); i++) await tick(); assert.ok(cond(), 'condition reached'); }
const APP = 'http://127.0.0.1:4317';

function fakeContents() {
  const wc = new EventEmitter();
  wc.openHandler = null;
  wc.setWindowOpenHandler = (fn) => { wc.openHandler = fn; };
  wc.sent = [];
  wc.send = (...args) => { wc.sent.push(args); };
  wc.mainFrame = { url: '' };
  wc.inserted = [];
  wc.insertCSS = (css) => { wc.inserted.push(css); return Promise.resolve('key'); };
  wc.getURL = () => wc.mainFrame.url;
  return wc;
}
const navEvent = () => { const e = { prevented: false, preventDefault() { e.prevented = true; } }; return e; };

const THROW = Symbol('throw');
const MISSING = Symbol('missing');

function fakeElectron({ lock = true, loginItem = { openAtLogin: false, wasOpenedAtLogin: false }, dark = false, systemUIDark = dark, appleAction } = {}) {
  const calls = { userDefaults: [], quit: 0, enableSandbox: 0, setLogin: [], getLogin: [], openExternal: [], errorBox: [], messageBox: [], windows: [], trays: [], menus: [], images: [], setName: [], order: [], about: [], setPath: [], dockIcon: [], appMenu: [], dockBadge: [], badgeCount: [], aumid: [], overlay: [], toolTips: [], bitmaps: [] };
  const app = new EventEmitter();
  app.isPackaged = false;
  app.requestSingleInstanceLock = () => lock;
  app.quit = () => { calls.quit++; const e = { defaultPrevented: false, preventDefault() { e.defaultPrevented = true; } }; app.emit('before-quit', e); calls.lastQuitEvent = e; };
  app.whenReady = async () => {};
  app.enableSandbox = () => { calls.enableSandbox++; calls.order.push('enableSandbox'); };
  app.setName = (n) => { calls.setName.push(n); calls.order.push('setName'); };
  app.getVersion = () => '0.0.0';
  app.setAboutPanelOptions = (o) => { calls.about.push(o); };
  app.setPath = (...a) => { calls.setPath.push(a); };
  let dockText = '';
  app.dock = { setIcon: (p) => calls.dockIcon.push(p), setBadge: (t) => { calls.dockBadge.push(t); dockText = t; }, getBadge: () => dockText };
  app.setBadgeCount = (n) => { calls.badgeCount.push(n); return true; };
  app.setAppUserModelId = (id) => { calls.aumid.push(id); calls.order.push('setAppUserModelId'); };
  app.setLoginItemSettings = (o) => { calls.setLogin.push(o); loginItem = { ...loginItem, openAtLogin: o.openAtLogin }; };
  app.getLoginItemSettings = (o) => { calls.getLogin.push(o); return loginItem; };
  app.getPath = () => '/user-data';
  class BrowserWindow extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts; this.visible = false; this.loaded = []; this.shows = 0; this.hides = 0; this.focuses = 0;
      this.webContents = fakeContents();
      this.chromeCalls = [];
      this.winCalls = [];
      this.fullScreen = false;
      this.maximized = false;
      calls.windows.push(this);
      app.emit('web-contents-created', {}, this.webContents);
    }
    loadURL(u) { this.loaded.push(u); this.webContents.mainFrame.url = `${u}/#history`; return Promise.resolve(); }
    setBackgroundColor(c) { this.chromeCalls.push(['setBackgroundColor', c]); }
    setTitleBarOverlay(o) { this.chromeCalls.push(['setTitleBarOverlay', o]); }
    setWindowButtonPosition(p) { this.chromeCalls.push(['setWindowButtonPosition', p]); }
    isFullScreen() { return this.fullScreen; }
    show() { this.shows++; this.visible = true; }
    hide() { this.hides++; this.visible = false; }
    focus() { this.focuses++; }
    isVisible() { return this.visible; }
    isMinimized() { return false; }
    isMaximized() { return this.maximized; }
    maximize() { this.winCalls.push('maximize'); this.maximized = true; }
    unmaximize() { this.winCalls.push('unmaximize'); this.maximized = false; }
    minimize() { this.winCalls.push('minimize'); }
    setOverlayIcon(img, desc) { calls.overlay.push([img, desc]); }
  }
  class Tray extends EventEmitter {
    constructor(img) { super(); this.img = img; this.menu = null; this.images = []; calls.trays.push(this); }
    setContextMenu(m) { this.menu = m; }
    setImage(img) { this.images.push(img); }
    setToolTip(t) { calls.toolTips.push(t); }
  }
  const Menu = { buildFromTemplate: (t) => { calls.menus.push(t); return { template: t }; }, setApplicationMenu: (m) => { calls.appMenu.push(m); } };
  const shell = { openExternal: (u) => { calls.openExternal.push(u); return Promise.resolve(); } };
  const dialog = {
    showErrorBox: (title, text) => calls.errorBox.push({ title, text }),
    response: 0,
    showMessageBox: async (o) => { calls.messageBox.push(o); return { response: dialog.response }; },
  };
  const handlers = {};
  const session = { defaultSession: { setPermissionRequestHandler: (fn) => { handlers.request = fn; }, setPermissionCheckHandler: (fn) => { handlers.check = fn; } } };
  const nativeImage = { createFromBitmap: (buf, opts) => { calls.bitmaps.push([buf, opts]); return { bitmap: true, opts }; }, createFromPath: (p) => { calls.images.push(p); const img = { path: p, template: [], isEmpty: () => false, setTemplateImage: (v) => img.template.push(v) }; return img; } };
  const ipcMain = new EventEmitter();
  const nativeTheme = new EventEmitter();
  nativeTheme.shouldUseDarkColors = dark;
  nativeTheme.shouldUseDarkColorsForSystemIntegratedUI = systemUIDark;
  const systemPreferences = { getUserDefault: (key, type) => { calls.userDefaults.push([key, type]); if (appleAction === THROW) throw new Error('no defaults'); return appleAction; } };
  const electron = { app, BrowserWindow, Tray, Menu, shell, dialog, session, nativeImage, ipcMain, nativeTheme, systemPreferences };
  if (appleAction === MISSING) delete electron.systemPreferences;
  return { electron, calls, handlers };
}

function fakeChildHandle(url, port, pid = 900) {
  const child = new EventEmitter();
  child.pid = pid;
  let resolveExit;
  const exited = new Promise((r) => { resolveExit = r; });
  return { child, pid, url, port, owned: true, exited, stderrTail: () => '', die: (code) => resolveExit({ code, signal: null }) };
}

function fakeHelpers(over = {}) {
  const seen = { find: 0, start: [], stop: [], choose: 0, prefs: [], writes: [], cssReads: [], treeRoots: [] };
  const helpers = {
    readLoginShellPath: async () => ({ path: '/opt/homebrew/bin:/usr/bin', source: 'login-shell' }),
    readRootVersion: () => '1.2.3',
    resolveStoreDir: () => '/store',
    findRunningServer: async () => { seen.find++; return null; },
    choosePort: async () => { seen.choose++; return 4317; },
    resolveServerRuntime: () => ({ nodePath: '/n', serverRoot: '/srv' }),
    buildServerEnv: ({ port }) => ({ PORT: String(port), WORCA_DESKTOP: '1' }),
    startServer: async ({ env }) => { const h = fakeChildHandle(`http://127.0.0.1:${env.PORT === '0' ? 50123 : env.PORT}`, Number(env.PORT) || 50123); seen.start.push({ env, handle: h }); return h; },
    stopServer: async (h, o) => { seen.stop.push({ h, o }); return { exitCode: 0, via: 'request' }; },
    openServerLog: () => ({ stream: null, path: '/user-data/logs/server.log' }),
    readShellPrefs: (dir) => { seen.prefs.push(dir); return { mode: 'system', rail: false }; },
    writeShellPrefs: (dir, prefs, opts) => { seen.writes.push({ dir, prefs, onError: typeof opts?.onError }); },
    readDesktopShellCss: (root) => { seen.cssReads.push(root); return 'CSS'; },
    serverTreeRoot: (o) => { seen.treeRoots.push(o); return '/srv'; },
    ...over,
  };
  return { helpers, seen };
}

function makeController({ platform = 'darwin', argv = ['Worca'], lock, over, loginItem, packaged = false, log = { info() {}, error() {} }, dark, systemUIDark, appleAction } = {}) {
  const fe = fakeElectron({ lock, loginItem, dark, systemUIDark, appleAction });
  const { helpers, seen } = fakeHelpers(over);
  const ctl = createDesktopController({ electron: fe.electron, platform, argv, env: { PATH: '/usr/bin' }, home: '/Users/u', resourcesPath: '/res', packaged, desktopDir: '/app/desktop', helpers, log });
  return { ctl, ...fe, seen };
}

test('1. windowOptions: context isolation, sandbox, no node integration, no preload by default', () => {
  const o = windowOptions();
  assert.equal(o.webPreferences.contextIsolation, true);
  assert.equal(o.webPreferences.sandbox, true);
  assert.equal(o.webPreferences.nodeIntegration, false);
  assert.equal(o.webPreferences.nodeIntegrationInWorker, false);
  assert.ok(!('preload' in o.webPreferences));
  assert.ok(!('additionalArguments' in o.webPreferences));
  assert.deepEqual([o.width, o.height, o.minWidth, o.minHeight, o.show], [1280, 860, 900, 600, false]);
  assert.equal(o.backgroundColor, '#F1F1EF');
  assert.ok(!('titleBarStyle' in o));
});

test('1b. windowOptions with a preload: the chrome argument, the inset title bar, the dark background; sandbox unchanged', () => {
  const o = windowOptions({ preload: '/p.cjs', chrome: 'inset', scheme: 'dark', rail: true });
  assert.equal(o.webPreferences.preload, '/p.cjs');
  assert.deepEqual(o.webPreferences.additionalArguments, ['--worca-chrome=inset']);
  assert.equal(o.titleBarStyle, 'hidden');
  assert.deepEqual(o.trafficLightPosition, TRAFFIC_LIGHTS.rail);
  assert.equal(o.backgroundColor, '#161614');
  const { preload, additionalArguments, ...rest } = o.webPreferences;
  assert.deepEqual(rest, windowOptions().webPreferences, 'the sandbox flags are unchanged');
  assert.deepEqual([o.width, o.height, o.minWidth, o.minHeight, o.show], [1280, 860, 900, 600, false]);
  const w = windowOptions({ preload: '/p.cjs', chrome: 'overlay', scheme: 'light' });
  assert.deepEqual(w.titleBarOverlay, { color: '#FFFFFF', symbolColor: '#19191B', height: 48 });
  assert.deepEqual(w.webPreferences.additionalArguments, ['--worca-chrome=overlay']);
});

test('2. linkPolicy: same origin internal; http(s)/mailto external; file/javascript/custom/garbage denied', () => {
  assert.equal(linkPolicy(`${APP}/#history`, APP), 'internal');
  assert.equal(linkPolicy('https://github.com/x', APP), 'external');
  assert.equal(linkPolicy('http://127.0.0.1:9999/', APP), 'external');
  assert.equal(linkPolicy('mailto:a@b.c', APP), 'external');
  for (const u of ['file:///etc/hosts', 'javascript:alert(1)', 'worca://x', 'about:blank', 'not a url', '']) assert.equal(linkPolicy(u, APP), 'deny', u);
});

test('3. permissionAllowed: media from the app origin only; geolocation never; garbage false', () => {
  assert.equal(permissionAllowed('media', `${APP}/x`, APP), true);
  assert.equal(permissionAllowed('media', APP, APP), true, 'the check handler passes an origin');
  assert.equal(permissionAllowed('media', 'https://evil.example/', APP), false);
  assert.equal(permissionAllowed('geolocation', APP, APP), false);
  assert.equal(permissionAllowed('media', 'garbage', APP), false);
  assert.equal(permissionAllowed('media', APP, null), false);
});

test('4. single instance: lock refused → quit, no discovery, no server, no window; enableSandbox ran first', async () => {
  const { ctl, calls, seen } = makeController({ lock: false });
  await ctl.start();
  assert.equal(calls.enableSandbox, 1);
  assert.equal(calls.quit, 1);
  assert.equal(seen.find, 0);
  assert.equal(seen.start.length, 0);
  assert.equal(calls.windows.length, 0);
});

test('4b. lock granted: a second launch shows and focuses the window', async () => {
  const { ctl, electron, calls } = makeController();
  await ctl.start();
  const win = calls.windows[0];
  const [s, f] = [win.shows, win.focuses];
  electron.app.emit('second-instance', {}, ['Worca']);
  assert.equal(win.shows, s + 1);
  assert.equal(win.focuses, f + 1);
});

test('5. reuse: a running server is loaded, no server started; Quit never contacts it', async () => {
  const { ctl, electron, calls, seen } = makeController({ over: { findRunningServer: async () => ({ url: 'http://127.0.0.1:4317', port: 4317, pid: 5, owned: false }) } });
  await ctl.start();
  assert.equal(seen.start.length, 0);
  assert.deepEqual(calls.windows[0].loaded, ['http://127.0.0.1:4317']);
  assert.equal(ctl.state().owned, false);
  const e = navEvent();
  electron.app.emit('before-quit', e);
  await tick();
  assert.equal(seen.stop.length, 0);
  assert.equal(e.prevented, false);
  assert.equal(calls.menus.at(-1).at(-1).label, 'Quit Worca');
});

test('6. own server: started on 4317; Quit stops it via stopServer, then quits; a second before-quit does not stop twice', async () => {
  const { ctl, electron, calls, seen } = makeController();
  await ctl.start();
  assert.equal(seen.start.length, 1);
  assert.equal(seen.start[0].env.PORT, '4317');
  assert.deepEqual(calls.windows[0].loaded, ['http://127.0.0.1:4317']);
  assert.equal(ctl.state().owned, true);
  assert.equal(calls.menus.at(-1).at(-1).label, 'Quit Worca (stops the Worca server)');
  const e = navEvent();
  electron.app.emit('before-quit', e);
  assert.equal(e.prevented, true);
  assert.equal(ctl.state().quitting, true);
  await tick(); await tick();
  assert.equal(seen.stop.length, 1);
  assert.equal(seen.stop[0].h, seen.start[0].handle);
  assert.equal(seen.stop[0].o.storeDir, '/store');
  assert.equal(calls.quit, 1, 'app.quit() called again after the stop');
  assert.equal(calls.lastQuitEvent.defaultPrevented, false, 'the second before-quit lets the app quit');
  assert.equal(seen.stop.length, 1);
});

test('6b. a second Quit while the stop is still running does not stop the server again', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const stops = [];
  const { ctl, electron, calls } = makeController({ over: { stopServer: async (h) => { stops.push(h); await gate; return { exitCode: 0, via: 'request' }; } } });
  await ctl.start();
  const e1 = navEvent(); const e2 = navEvent();
  electron.app.emit('before-quit', e1);
  await tick();
  electron.app.emit('before-quit', e2);
  await tick();
  assert.deepEqual([e1.prevented, e2.prevented], [true, true]);
  assert.equal(stops.length, 1);
  release();
  await tick(); await tick();
  assert.equal(stops.length, 1);
  assert.equal(calls.quit, 1);
});

test('7. port race: 4317 lost (SERVER_EXITED + portBusy), no worca found → the second start uses PORT=0', async () => {
  let n = 0;
  const { ctl, calls, seen } = makeController({ over: {
    startServer: async ({ env }) => {
      n++;
      if (n === 1) throw Object.assign(new Error('worca server exited with code 1 before it was ready'), { code: 'SERVER_EXITED', portBusy: true, stderrTail: '' });
      const h = fakeChildHandle('http://127.0.0.1:50123', 50123);
      seen.start.push({ env, handle: h });
      return h;
    },
  } });
  await ctl.start();
  assert.equal(seen.find, 2, 'discovery ran again after the lost race');
  assert.equal(seen.start.length, 1);
  assert.equal(seen.start[0].env.PORT, '0');
  assert.deepEqual(calls.windows[0].loaded, ['http://127.0.0.1:50123']);
});

test('7b. port race: the second discovery finds the worca that won → reused, not owned', async () => {
  let finds = 0;
  const { ctl, seen } = makeController({ over: {
    findRunningServer: async () => (++finds === 2 ? { url: 'http://127.0.0.1:4317', port: 4317, pid: 3, owned: false } : null),
    startServer: async () => { throw Object.assign(new Error('exited'), { code: 'SERVER_EXITED', portBusy: true, stderrTail: '' }); },
  } });
  await ctl.start();
  assert.equal(ctl.state().owned, false);
  assert.equal(ctl.state().url, 'http://127.0.0.1:4317');
  assert.equal(seen.start.length, 0);
});

test('8. a start failure → error box with the stderr tail and the log path, then quit; no window', async () => {
  const tail = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  const { ctl, calls } = makeController({ over: {
    startServer: async () => { throw Object.assign(new Error('worca server exited with code 1 before it was ready'), { code: 'SERVER_EXITED', portBusy: false, stderrTail: tail }); },
  } });
  await ctl.start();
  assert.equal(calls.errorBox.length, 1);
  assert.equal(calls.errorBox[0].title, 'Worca could not start');
  assert.match(calls.errorBox[0].text, /exited with code 1/);
  assert.match(calls.errorBox[0].text, /line 29/);
  assert.doesNotMatch(calls.errorBox[0].text, /line 9\b/, 'only the last 20 stderr lines');
  assert.match(calls.errorBox[0].text, /\/user-data\/logs\/server\.log/);
  assert.equal(calls.quit, 1);
  assert.equal(calls.windows.length, 0);
});

test('9. main window close while running → prevented + hidden; after before-quit → not prevented', async () => {
  const { ctl, electron, calls } = makeController({ over: { findRunningServer: async () => ({ url: APP, port: 4317, pid: 5, owned: false }) } });
  await ctl.start();
  const win = calls.windows[0];
  const e = navEvent();
  win.emit('close', e);
  assert.equal(e.prevented, true);
  assert.equal(win.hides, 1);
  electron.app.emit('before-quit', navEvent());
  const e2 = navEvent();
  win.emit('close', e2);
  assert.equal(e2.prevented, false);
});

test('9b. the window shows on ready-to-show unless started at login', async () => {
  const shown = makeController();
  await shown.ctl.start();
  shown.calls.windows[0].emit('ready-to-show');
  assert.equal(shown.calls.windows[0].shows, 1);
  const hidden = makeController({ loginItem: { openAtLogin: true, wasOpenedAtLogin: true } });
  await hidden.ctl.start();
  hidden.calls.windows[0].emit('ready-to-show');
  assert.equal(hidden.calls.windows[0].shows, 0);
});

test('10. applyContentsPolicy: external → openExternal + deny; internal → allow with the safe options; about:blank deny; navigation guarded', () => {
  const opened = [];
  const wc = fakeContents();
  applyContentsPolicy(wc, { getAppOrigin: () => APP, openExternal: (u) => opened.push(u) });
  assert.deepEqual(wc.openHandler({ url: 'https://github.com/x' }), { action: 'deny' });
  assert.deepEqual(opened, ['https://github.com/x']);
  const allow = wc.openHandler({ url: `${APP}/#chat` });
  assert.equal(allow.action, 'allow');
  assert.deepEqual(allow.overrideBrowserWindowOptions.webPreferences, windowOptions().webPreferences);
  assert.equal(allow.overrideBrowserWindowOptions.show, true);
  assert.deepEqual(wc.openHandler({ url: 'about:blank' }), { action: 'deny' });
  const dark = fakeContents();
  applyContentsPolicy(dark, { getAppOrigin: () => APP, openExternal: () => {}, getScheme: () => 'dark' });
  const popup = dark.openHandler({ url: `${APP}/#chat` }).overrideBrowserWindowOptions;
  assert.equal(popup.backgroundColor, '#161614', 'the popup takes the current scheme');
  assert.ok(!('preload' in popup.webPreferences), 'no preload in a popup');
  assert.ok(!('titleBarStyle' in popup), 'the popup keeps the native frame');
  assert.equal(allow.overrideBrowserWindowOptions.backgroundColor, '#F1F1EF', 'no getScheme → light');
  for (const ev of ['will-navigate', 'will-redirect']) {
    const e = navEvent();
    wc.emit(ev, e, 'https://example.com/');
    assert.equal(e.prevented, true, ev);
    const e2 = navEvent();
    wc.emit(ev, e2, `${APP}/#x`);
    assert.equal(e2.prevented, false, ev);
    const e3 = navEvent();
    wc.emit(ev, e3, 'file:///etc/hosts');
    assert.equal(e3.prevented, true);
  }
  assert.deepEqual(opened, ['https://github.com/x', 'https://example.com/', 'https://example.com/']);
});

test('10b. every webContents (a child window too) gets the policy; a Restart on a new port moves the app origin', async () => {
  let n = 0;
  const { ctl, electron, calls, seen } = makeController({ over: {
    startServer: async ({ env }) => {
      const port = ++n === 1 ? 4317 : 50777;
      const h = fakeChildHandle(`http://127.0.0.1:${port}`, port, 900 + n);
      seen.start.push({ env, handle: h });
      return h;
    },
  } });
  await ctl.start();
  const childWc = fakeContents();
  electron.app.emit('web-contents-created', {}, childWc);
  assert.deepEqual(childWc.openHandler({ url: 'file:///etc/hosts' }), { action: 'deny' });
  assert.equal(childWc.openHandler({ url: `${APP}/x` }).action, 'allow');
  seen.start[0].handle.die(1);
  await until(() => calls.windows[0].loaded.length === 2);
  assert.equal(calls.messageBox.length, 1);
  assert.equal(ctl.state().url, 'http://127.0.0.1:50777');
  assert.equal(childWc.openHandler({ url: `${APP}/x` }).action, 'deny', 'the old origin is external now');
  assert.deepEqual(childWc.openHandler({ url: 'https://github.com/' }), { action: 'deny' });
  assert.equal(childWc.openHandler({ url: 'http://127.0.0.1:50777/x' }).action, 'allow');
  assert.deepEqual(calls.windows[0].loaded, [APP, 'http://127.0.0.1:50777']);
});

test('10c. the session permission handlers follow permissionAllowed with the current app origin', async () => {
  const { ctl, handlers } = makeController();
  await ctl.start();
  let got = null;
  handlers.request({}, 'media', (v) => { got = v; }, { requestingUrl: `${APP}/#chat` });
  assert.equal(got, true);
  handlers.request({}, 'geolocation', (v) => { got = v; }, { requestingUrl: `${APP}/` });
  assert.equal(got, false);
  assert.equal(handlers.check({}, 'notifications', APP), true);
  assert.equal(handlers.check({}, 'notifications', 'https://evil.example'), false);
  assert.equal(ctl.state().url, APP);
});

test('11. tray: no Launch at login on linux; darwin toggle args []; win32 args --hidden; tray image path', async () => {
  const lin = trayMenuTemplate({ platform: 'linux', openAtLogin: false, ownsServer: true, onOpen() {}, onToggleLogin() {}, onQuit() {} });
  assert.ok(!lin.some((i) => i.label === 'Launch at login'));
  assert.deepEqual(lin.map((i) => i.label || i.type), ['Open Worca', 'separator', 'Quit Worca (stops the Worca server)']);
  const mac = makeController({ platform: 'darwin' });
  await mac.ctl.start();
  assert.deepEqual(mac.calls.images, [join('/app/desktop', 'assets', 'trayTemplate.png')], 'one image: darwin has no window icon');
  const item = mac.calls.menus.at(-1).find((i) => i.label === 'Launch at login');
  assert.equal(item.type, 'checkbox');
  assert.equal(item.checked, false);
  const before = mac.calls.menus.length;
  item.click();
  assert.deepEqual(mac.calls.setLogin, [{ openAtLogin: true, args: [] }]);
  assert.ok(mac.calls.menus.length > before, 'the menu is rebuilt');
  assert.equal(mac.calls.menus.at(-1).find((i) => i.label === 'Launch at login').checked, true);
  const win = makeController({ platform: 'win32' });
  await win.ctl.start();
  win.calls.menus.at(-1).find((i) => i.label === 'Launch at login').click();
  assert.deepEqual(win.calls.setLogin, [{ openAtLogin: true, args: ['--hidden'] }]);
  assert.ok(win.calls.getLogin.length > 0);
  for (const o of win.calls.getLogin) assert.deepEqual(o, { args: ['--hidden'] });
  const w = win.calls.windows[0];
  const shows = w.shows;
  win.calls.trays[0].emit('click');
  assert.equal(w.shows, shows + 1, 'a tray click opens the window on win32');
  assert.equal(mac.calls.trays[0].listenerCount('click'), 0, 'darwin: the tray click opens the menu only');
  const opens = [];
  const t = trayMenuTemplate({ platform: 'darwin', openAtLogin: true, ownsServer: false, onOpen: () => opens.push('o'), onToggleLogin: (v) => opens.push(v), onQuit: () => opens.push('q') });
  for (const i of t) i.click?.();
  assert.deepEqual(opens, ['o', false, 'q']);
});

test('12. an owned server exiting while not quitting → message box; Restart starts a server again; Quit quits', async () => {
  const { ctl, electron, calls, seen } = makeController();
  await ctl.start();
  seen.start[0].handle.die(3);
  await until(() => calls.windows[0].loaded.length === 2);
  assert.equal(calls.messageBox.length, 1);
  assert.match(calls.messageBox[0].message, /The Worca server stopped \(exit 3\)\./);
  assert.deepEqual(calls.messageBox[0].buttons, ['Restart', 'Quit']);
  assert.equal(seen.start.length, 2);
  // Quit on the next crash
  electron.dialog.response = 1;
  seen.start[1].handle.die(4);
  await tick(); await tick(); await tick();
  assert.equal(calls.messageBox.length, 2);
  assert.ok(calls.quit >= 1);
  assert.equal(seen.start.length, 2);
});

test('12b. an owned server exiting during Quit shows no message box', async () => {
  const { ctl, electron, calls, seen } = makeController({ over: { stopServer: async (h) => { h.die(0); return { exitCode: 0, via: 'request' }; } } });
  await ctl.start();
  electron.app.emit('before-quit', navEvent());
  await tick(); await tick(); await tick();
  assert.equal(calls.messageBox.length, 0);
  assert.equal(seen.start.length, 1);
});

/** A start that stays in flight until the test's stopServer kills the child; then waitForReady fails as in real life. */
function inFlightStart(seen, port = 4317) {
  return async ({ env, onSpawn }) => {
    const hd = fakeChildHandle(`http://127.0.0.1:${port}`, port, 950 + seen.start.length);
    seen.start.push({ env, handle: hd });
    onSpawn(hd);
    const { code } = await hd.exited;
    throw Object.assign(new Error(`worca server exited with code ${code} before it was ready`), { code: 'SERVER_EXITED', portBusy: false, stderrTail: '' });
  };
}

test('13. Quit while the server is still starting → that child is stopped; no error box, no window; the app quits', async () => {
  const { helpers, seen } = fakeHelpers();
  const fe = fakeElectron();
  helpers.startServer = inFlightStart(seen);
  helpers.stopServer = async (hd, o) => { seen.stop.push({ h: hd, o }); hd.die(null); return { exitCode: null, via: 'signal' }; };
  const ctl = createDesktopController({ electron: fe.electron, platform: 'darwin', argv: ['Worca'], env: {}, home: '/Users/u', resourcesPath: '/res', packaged: false, desktopDir: '/app/desktop', helpers, log: { info() {}, error() {} } });
  const started = ctl.start();
  await until(() => seen.start.length === 1);
  const e = navEvent();
  fe.electron.app.emit('before-quit', e);
  assert.equal(e.prevented, true, 'the quit waits for the stop');
  await started;
  await until(() => fe.calls.quit === 1);
  assert.deepEqual(seen.stop.map((x) => x.h), [seen.start[0].handle]);
  assert.equal(fe.calls.errorBox.length, 0, 'no "could not start" box during a quit');
  assert.equal(fe.calls.windows.length, 0);
  assert.equal(fe.calls.lastQuitEvent.defaultPrevented, false);
});

test('13b. Quit during a Restart → the new child is stopped, not only the old exited one', async () => {
  const seenRef = {};
  let restart = null;
  const stopped = [];
  const { ctl, electron, calls, seen } = makeController({ over: {
    startServer: async (o) => {
      if (restart) return restart(o);
      const hd = fakeChildHandle(APP, 4317);
      seenRef.seen.start.push({ env: o.env, handle: hd });
      return hd;
    },
    stopServer: async (hd) => { stopped.push(hd); hd.die(null); return { exitCode: null, via: 'signal' }; },
  } });
  seenRef.seen = seen;
  await ctl.start();
  restart = inFlightStart(seen);
  seen.start[0].handle.die(3);
  await until(() => seen.start.length === 2);
  electron.app.emit('before-quit', navEvent());
  await until(() => calls.quit >= 1);
  assert.ok(stopped.includes(seen.start[1].handle), 'the starting child was stopped');
  assert.equal(calls.errorBox.length, 0);
});

test('13c. a start that turns ready just after Quit opens no window and no tray; that server is stopped', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const stopped = [];
  const { ctl, electron, calls, seen } = makeController({ over: {
    startServer: async ({ env, onSpawn }) => { const hd = fakeChildHandle(APP, 4317); seen.start.push({ env, handle: hd }); onSpawn(hd); await gate; return hd; },
    stopServer: async (hd) => { stopped.push(hd); return { exitCode: 0, via: 'request' }; },
  } });
  const started = ctl.start();
  await until(() => seen.start.length === 1);
  electron.app.emit('before-quit', navEvent());
  release();
  await started;
  await until(() => calls.quit >= 1);
  assert.deepEqual(stopped, [seen.start[0].handle]);
  assert.equal(calls.windows.length, 0);
  assert.equal(calls.trays.length, 0);
});

test('14. openServerLog: an open error is reported, never thrown into the main process; a Restart closes the previous stream', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'desk-log-'));
  try {
    mkdirSync(join(dir, 'logs', 'server.log'), { recursive: true });   // a folder where the file should be: open fails
    const { stream, path } = openServerLog(dir);
    assert.equal(path, join(dir, 'logs', 'server.log'));
    await new Promise((r) => stream.once('close', r));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const streams = [];
  const { ctl, seen } = makeController({ over: { openServerLog: () => { const st = { ended: 0, end() { st.ended++; } }; streams.push(st); return { stream: st, path: '/l' }; } } });
  await ctl.start();
  seen.start[0].handle.die(1);
  await until(() => seen.start.length === 2);
  assert.deepEqual(streams.map((x) => x.ended), [1, 0]);
});

test('15. a second launch while the server starts shows the window once it exists, even when started at login', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { ctl, electron, calls, seen } = makeController({ loginItem: { openAtLogin: true, wasOpenedAtLogin: true }, over: {
    startServer: async ({ env }) => { await gate; const hd = fakeChildHandle(APP, 4317); seen.start.push({ env, handle: hd }); return hd; },
  } });
  const started = ctl.start();
  await tick();
  electron.app.emit('second-instance', {}, ['Worca']);
  release();
  await started;
  calls.windows[0].emit('ready-to-show');
  assert.equal(calls.windows[0].shows, 1);
});

/** A shell-state IPC event from the main window's own top frame (override any part to forge it). */
function shellEvent(win, over = {}) {
  const sender = win.webContents;
  return { sender, senderFrame: sender.mainFrame, ...over };
}
const STATE = (o = {}) => ({ mode: 'system', scheme: 'light', rail: false, ...o });
const fullScreenReplies = (win) => win.webContents.sent.filter(([c]) => c === 'worca:shell-fullscreen');

test('16. darwin launch: the preload, the inset title bar, the saved dark mode and rail; no window icon', async () => {
  const dirs = [];
  const { ctl, calls } = makeController({ platform: 'darwin', over: { readShellPrefs: (dir) => { dirs.push(dir); return { mode: 'dark', rail: true }; } } });
  await ctl.start();
  const o = calls.windows[0].opts;
  assert.equal(o.webPreferences.preload, join('/app/desktop', 'preload.cjs'));
  assert.deepEqual(o.webPreferences.additionalArguments, ['--worca-chrome=inset']);
  assert.equal(o.titleBarStyle, 'hidden');
  assert.deepEqual(o.trafficLightPosition, TRAFFIC_LIGHTS.rail);
  assert.equal(o.backgroundColor, THEME_COLORS.dark.background);
  assert.ok(!('icon' in o), 'macOS takes the Dock icon from the bundle');
  assert.deepEqual([ctl.state().chrome, ctl.state().scheme], ['inset', 'dark']);
  assert.deepEqual(dirs, ['/user-data']);
  assert.equal(o.webPreferences.sandbox, true);
});

test('16b. win32: the overlay follows the system scheme; linux: the native frame and assets/icon.png', async () => {
  const win = makeController({ platform: 'win32', dark: true });
  await win.ctl.start();
  const wo = win.calls.windows[0].opts;
  assert.deepEqual(wo.titleBarOverlay, { color: THEME_COLORS.dark.overlay, symbolColor: THEME_COLORS.dark.symbol, height: 48 });
  assert.equal(wo.backgroundColor, THEME_COLORS.dark.background);
  assert.equal(wo.icon, join('/app/desktop', 'assets', 'icon.png'));
  assert.deepEqual(wo.webPreferences.additionalArguments, ['--worca-chrome=overlay']);
  const lin = makeController({ platform: 'linux' });
  await lin.ctl.start();
  const lo = lin.calls.windows[0].opts;
  assert.ok(!('titleBarStyle' in lo) && !('titleBarOverlay' in lo));
  assert.equal(lo.icon, join('/app/desktop', 'assets', 'icon.png'));
  assert.equal(lo.backgroundColor, THEME_COLORS.light.background);
  assert.deepEqual(lo.webPreferences.additionalArguments, ['--worca-chrome=native']);
});

test('17. a valid state message: background, overlay (win32), button position on a rail flip (darwin), one write, a reply', async () => {
  const mac = makeController({ platform: 'darwin' });
  await mac.ctl.start();
  const mw = mac.calls.windows[0];
  mac.electron.ipcMain.emit('worca:shell-state', shellEvent(mw), STATE({ mode: 'dark', scheme: 'dark', rail: true }));
  assert.deepEqual(mw.chromeCalls, [['setBackgroundColor', '#161614'], ['setWindowButtonPosition', TRAFFIC_LIGHTS.rail]]);
  assert.deepEqual(mac.seen.writes, [{ dir: '/user-data', prefs: { mode: 'dark', rail: true }, onError: 'function' }]);
  assert.deepEqual(fullScreenReplies(mw), [['worca:shell-fullscreen', false]]);
  assert.equal(mac.ctl.state().scheme, 'dark');
  mac.electron.ipcMain.emit('worca:shell-state', shellEvent(mw), STATE({ mode: 'dark', scheme: 'dark', rail: true }));
  assert.equal(mw.chromeCalls.length, 2, 'the same state again: no window call');
  assert.equal(mac.seen.writes.length, 1, 'and no write');
  assert.equal(fullScreenReplies(mw).length, 2, 'only the reply');
  mac.electron.ipcMain.emit('worca:shell-state', shellEvent(mw), STATE({ mode: 'dark', scheme: 'dark', rail: false }));
  assert.deepEqual(mw.chromeCalls.slice(2), [['setBackgroundColor', '#161614'], ['setWindowButtonPosition', TRAFFIC_LIGHTS.expanded]]);
  mac.electron.ipcMain.emit('worca:shell-state', shellEvent(mw), STATE({ mode: 'system', scheme: 'light', rail: false }));
  assert.deepEqual(mw.chromeCalls.slice(4), [['setBackgroundColor', '#F1F1EF']], 'no button move without a rail change');
  assert.equal(mac.seen.writes.length, 3);
  mac.electron.ipcMain.emit('worca:shell-state', shellEvent(mw), STATE({ mode: 'system', scheme: 'dark', rail: false }));
  assert.deepEqual(mw.chromeCalls.at(-1), ['setBackgroundColor', '#161614'], 'the OS turned dark under System');
  assert.equal(mac.seen.writes.length, 3, 'the saved mode and rail did not change: no write');
  mw.fullScreen = true;
  mac.electron.ipcMain.emit('worca:shell-state', shellEvent(mw), STATE());
  assert.deepEqual(fullScreenReplies(mw).at(-1), ['worca:shell-fullscreen', true], 'a reload in full screen learns it');
  const win = makeController({ platform: 'win32' });
  await win.ctl.start();
  const ww = win.calls.windows[0];
  win.electron.ipcMain.emit('worca:shell-state', shellEvent(ww), STATE({ mode: 'dark', scheme: 'dark', rail: true }));
  assert.deepEqual(ww.chromeCalls, [['setBackgroundColor', '#161614'], ['setTitleBarOverlay', { color: '#222220', symbolColor: '#ECECE8', height: 48 }]]);
  const popup = ww.webContents.openHandler({ url: `${APP}/#chat` }).overrideBrowserWindowOptions;
  assert.equal(popup.backgroundColor, '#161614', 'a popup takes the last applied scheme');
});

test('17b. a state equal to the launch state changes nothing; missing window methods do not throw', async () => {
  const { ctl, electron, calls, seen } = makeController({ platform: 'darwin' });
  await ctl.start();
  const w = calls.windows[0];
  electron.ipcMain.emit('worca:shell-state', shellEvent(w), STATE());
  assert.deepEqual(w.chromeCalls, []);
  assert.deepEqual(seen.writes, []);
  assert.equal(fullScreenReplies(w).length, 1);
  w.setBackgroundColor = undefined; w.setWindowButtonPosition = undefined; w.isFullScreen = undefined;
  assert.doesNotThrow(() => electron.ipcMain.emit('worca:shell-state', shellEvent(w), STATE({ mode: 'dark', scheme: 'dark', rail: true })));
  assert.deepEqual(fullScreenReplies(w).at(-1), ['worca:shell-fullscreen', false]);
  assert.equal(seen.writes.length, 1);
});

test('18. refused state messages change nothing: another sender, a sub-frame, no frame, a foreign or stale origin, a bad payload', async () => {
  let n = 0;
  const { ctl, electron, calls, seen } = makeController({ platform: 'win32', over: {
    startServer: async ({ env }) => { const port = ++n === 1 ? 4317 : 50777; const hd = fakeChildHandle(`http://127.0.0.1:${port}`, port, 900 + n); seen.start.push({ env, handle: hd }); return hd; },
  } });
  await ctl.start();
  const w = calls.windows[0];
  const popup = fakeContents();
  popup.mainFrame = { url: `${APP}/` };
  const dark = STATE({ mode: 'dark', scheme: 'dark' });
  const refused = [
    [{ sender: popup, senderFrame: popup.mainFrame }, dark],
    [shellEvent(w, { senderFrame: { url: `${APP}/` } }), dark],
    [shellEvent(w, { senderFrame: null }), dark],
    [shellEvent(w, { senderFrame: undefined }), dark],
    [{ sender: w.webContents }, dark],
    [shellEvent(w), { ...dark, rail: 'yes' }],
    [shellEvent(w), '{"mode":"dark"}'],
    [shellEvent(w), null],
  ];
  const foreign = () => { w.webContents.mainFrame = { url: 'https://evil.example/' }; return shellEvent(w); };
  const check = (label) => {
    assert.deepEqual(w.chromeCalls, [], label);
    assert.deepEqual(seen.writes, [], label);
    assert.deepEqual(w.webContents.sent, [], label);
    assert.deepEqual(popup.sent, [], label);
  };
  for (const [ev, payload] of refused) { electron.ipcMain.emit('worca:shell-state', ev, payload); check(JSON.stringify(payload)); }
  electron.ipcMain.emit('worca:shell-state', foreign(), dark);
  check('foreign origin');
  seen.start[0].handle.die(1);
  await until(() => calls.windows[0].loaded.length === 2);
  w.webContents.mainFrame = { url: `${APP}/#history` };   // still on the old port
  electron.ipcMain.emit('worca:shell-state', shellEvent(w), dark);
  check('stale origin after a Restart');
  w.webContents.mainFrame = { url: 'http://127.0.0.1:50777/#history' };
  electron.ipcMain.emit('worca:shell-state', shellEvent(w), dark);
  assert.equal(w.chromeCalls.length, 2, 'the new origin is accepted');
  assert.equal(seen.writes.length, 1);
});

test('18b. a state message before the window exists is ignored', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { ctl, electron, calls, seen } = makeController({ over: { startServer: async ({ env }) => { await gate; const hd = fakeChildHandle(APP, 4317); seen.start.push({ env, handle: hd }); return hd; } } });
  const started = ctl.start();
  await tick();
  const wc = fakeContents();
  wc.mainFrame = { url: `${APP}/` };
  assert.doesNotThrow(() => electron.ipcMain.emit('worca:shell-state', { sender: wc, senderFrame: wc.mainFrame }, STATE({ mode: 'dark', scheme: 'dark' })));
  assert.deepEqual(seen.writes, []);
  assert.deepEqual(wc.sent, []);
  release();
  await started;
  assert.equal(electron.ipcMain.listenerCount('worca:shell-state'), 1, 'registered once');
  assert.equal(calls.windows.length, 1);
});

test('19. full screen: enter and leave are sent to the page', async () => {
  const { ctl, calls } = makeController({ platform: 'darwin' });
  await ctl.start();
  const w = calls.windows[0];
  w.emit('enter-full-screen');
  w.emit('leave-full-screen');
  assert.deepEqual(fullScreenReplies(w), [['worca:shell-fullscreen', true], ['worca:shell-fullscreen', false]]);
});

test('20. tray: a darwin template image; win32 white on a dark taskbar, swapped to black when the theme turns light', async () => {
  const mac = makeController({ platform: 'darwin', systemUIDark: true });
  await mac.ctl.start();
  assert.deepEqual(mac.calls.trays[0].img.template, [true]);
  assert.equal(mac.electron.nativeTheme.listenerCount('updated'), 0, 'macOS tints the template itself');
  const win = makeController({ platform: 'win32', dark: false, systemUIDark: true });
  await win.ctl.start();
  const tray = win.calls.trays[0];
  assert.equal(tray.img.path, join('/app/desktop', 'assets', 'tray-white.png'));
  assert.deepEqual(tray.img.template, [], 'no template outside macOS');
  win.electron.nativeTheme.emit('updated');
  assert.deepEqual(tray.images, [], 'unchanged theme: no new image');
  win.electron.nativeTheme.shouldUseDarkColorsForSystemIntegratedUI = false;
  win.electron.nativeTheme.emit('updated');
  assert.deepEqual(tray.images.map((i) => i.path), [join('/app/desktop', 'assets', 'tray-black.png')]);
  const lin = makeController({ platform: 'linux', dark: true, systemUIDark: undefined });
  await lin.ctl.start();
  assert.equal(lin.calls.trays[0].img.path, join('/app/desktop', 'assets', 'tray-white.png'), 'linux falls back to shouldUseDarkColors');
});

const ICON = join('/app/desktop', 'build-resources', 'icon.png');
const viewRoles = (template) => template.find((m) => m.label === 'View').submenu.map((i) => i.role || i.type);

test('21. setName(\'Worca\') is the first app call, before enableSandbox, even when the lock is refused; setPath is never called', async () => {
  for (const lock of [true, false]) {
    const { ctl, calls } = makeController({ lock });
    await ctl.start();
    assert.deepEqual(calls.setName, ['Worca'], `lock ${lock}`);
    assert.deepEqual(calls.order.slice(0, 2), ['setName', 'enableSandbox'], `lock ${lock}`);
    assert.deepEqual(calls.setPath, [], `lock ${lock}`);
  }
  const packaged = makeController({ packaged: true });
  await packaged.ctl.start();
  assert.deepEqual(packaged.calls.setPath, []);
});

test('22. darwin: the app menu is set from appMenuTemplate after whenReady (DevTools in dev), before discovery; the tray menu is still calls.menus.at(-1)', async () => {
  const snap = {};
  let calls;
  let seenRef;
  const mk = makeController({ over: { readLoginShellPath: async () => { snap.appMenu = calls.appMenu.length; snap.find = seenRef.find; return { path: '/usr/bin', source: 'login-shell' }; } } });
  calls = mk.calls; seenRef = mk.seen;
  await mk.ctl.start();
  assert.deepEqual(snap, { appMenu: 1, find: 0 }, 'the menu was set before discovery began');
  assert.equal(calls.appMenu.length, 1);
  const template = calls.appMenu[0].template;
  assert.deepEqual(template, appMenuTemplate({ packaged: false }));
  assert.deepEqual(template.map((m) => m.label), ['Worca', 'Edit', 'View', 'Window']);
  assert.ok(viewRoles(template).includes('toggleDevTools'));
  assert.equal(calls.menus[0], template, 'built from the template first');
  assert.equal(calls.menus.at(-1).at(-1).label, 'Quit Worca (stops the Worca server)', 'the tray template stays last');
});

test('23. darwin dev: About shows Worca and the root version (1.2.3), iconPath = desktop/build-resources/icon.png; dock.setIcon gets that path; no extra nativeImage', async () => {
  const { ctl, calls } = makeController();
  await ctl.start();
  assert.deepEqual(calls.about, [{ applicationName: 'Worca', applicationVersion: '1.2.3', version: '1.2.3', iconPath: ICON }]);
  assert.deepEqual(calls.dockIcon, [ICON]);
  assert.deepEqual(calls.images, [join('/app/desktop', 'assets', 'trayTemplate.png')]);
});

test('23b. darwin dev: readRootVersion null → About shows app.getVersion() and one log.error line', async () => {
  const errors = [];
  const { ctl, calls } = makeController({ over: { readRootVersion: () => null }, log: { info() {}, error: (m) => errors.push(m) } });
  await ctl.start();
  assert.equal(calls.about.length, 1);
  assert.equal(calls.about[0].applicationVersion, '0.0.0');
  assert.equal(calls.about[0].version, '0.0.0');
  assert.deepEqual(errors, [`worca desktop: could not read the worca version from ${resolve('/app/desktop', '..', 'package.json')}; the About panel shows 0.0.0`]);
  assert.equal(calls.windows.length, 1);
});

test('24. darwin packaged: About shows app.getVersion(); no dock.setIcon; no toggleDevTools in the menu', async () => {
  let reads = 0;
  const { ctl, calls } = makeController({ packaged: true, over: { readRootVersion: () => { reads++; return '1.2.3'; } } });
  await ctl.start();
  assert.equal(reads, 0, 'the root package.json is not read when packaged');
  assert.deepEqual(calls.about, [{ applicationName: 'Worca', applicationVersion: '0.0.0', version: '0.0.0', iconPath: ICON }]);
  assert.deepEqual(calls.dockIcon, []);
  assert.equal(calls.appMenu.length, 1);
  assert.ok(!viewRoles(calls.appMenu[0].template).includes('toggleDevTools'));
});

test('25. linux and win32: no setApplicationMenu, no About options, no dock calls; setName still called', async () => {
  for (const platform of ['linux', 'win32']) {
    const { ctl, calls } = makeController({ platform });
    await ctl.start();
    assert.deepEqual(calls.appMenu, [], platform);
    assert.deepEqual(calls.about, [], platform);
    assert.deepEqual(calls.dockIcon, [], platform);
    assert.deepEqual(calls.setName, ['Worca'], platform);
    assert.equal(calls.windows.length, 1, platform);
  }
});

test('26. a throwing setApplicationMenu is logged and the window and tray still open', async () => {
  const errors = [];
  const { ctl, electron, calls, seen } = makeController({ log: { info() {}, error: (m) => errors.push(m) } });
  electron.Menu.setApplicationMenu = () => { throw new Error('menu boom'); };
  await ctl.start();
  assert.deepEqual(errors, ['worca desktop: app menu/about setup failed: menu boom']);
  assert.equal(seen.start.length, 1);
  assert.equal(calls.windows.length, 1);
  assert.equal(calls.trays.length, 1);
  assert.equal(calls.errorBox.length, 0);
});

const REUSED = { findRunningServer: async () => ({ url: APP, port: 4317, pid: 5, owned: false }) };
const domReady = (win) => win.webContents.emit('dom-ready');

test('27. a reused server: every dom-ready on the app origin inserts the app\'s desktop CSS (twice after a reload); read once', async () => {
  const { ctl, calls, seen } = makeController({ over: REUSED });
  await ctl.start();
  const w = calls.windows[0];
  assert.deepEqual(w.webContents.inserted, [], 'nothing before the document exists');
  domReady(w);
  assert.deepEqual(w.webContents.inserted, ['CSS']);
  domReady(w);   // a reload
  assert.deepEqual(w.webContents.inserted, ['CSS', 'CSS']);
  assert.deepEqual(seen.cssReads, ['/srv'], 'read once per controller');
  assert.deepEqual(seen.treeRoots, [{ packaged: false, resourcesPath: '/res', desktopDir: '/app/desktop' }]);
  // Packaged: the CSS comes from the bundled server tree (<resources>/server), never the dev checkout.
  const pkg = makeController({ packaged: true, over: { ...REUSED, serverTreeRoot } });
  await pkg.ctl.start();
  domReady(pkg.calls.windows[0]);
  assert.deepEqual(pkg.calls.windows[0].webContents.inserted, ['CSS']);
  assert.deepEqual(pkg.seen.cssReads, [join('/res', 'server')], 'packaged: <resources>/server');
  // An owned server that dies and, on Restart, loses 4317 to a worca that won: now reused, so the CSS is injected.
  let starts = 0;
  let finds = 0;
  const flip = makeController({ over: {
    findRunningServer: async () => (++finds === 2 ? { url: APP, port: 4317, pid: 3, owned: false } : null),
    startServer: async ({ env }) => {
      if (++starts === 2) throw Object.assign(new Error('exited'), { code: 'SERVER_EXITED', portBusy: true, stderrTail: '' });
      const hd = fakeChildHandle(APP, 4317); flip.seen.start.push({ env, handle: hd }); return hd;
    },
  } });
  await flip.ctl.start();
  const fw = flip.calls.windows[0];
  domReady(fw);
  assert.deepEqual(fw.webContents.inserted, [], 'owned: the server serves its own CSS');
  flip.seen.start[0].handle.die(1);
  await until(() => fw.loaded.length === 2);
  assert.equal(flip.ctl.state().owned, false);
  domReady(fw);
  assert.deepEqual(fw.webContents.inserted, ['CSS'], 'st.owned is read at every dom-ready');
});

test('27b. an owned server, the native chrome (linux) or a foreign origin: no insertCSS', async () => {
  const owned = makeController();
  await owned.ctl.start();
  domReady(owned.calls.windows[0]);
  assert.deepEqual(owned.calls.windows[0].webContents.inserted, []);
  assert.deepEqual(owned.seen.cssReads, []);
  const lin = makeController({ platform: 'linux', over: REUSED });
  await lin.ctl.start();
  domReady(lin.calls.windows[0]);
  assert.deepEqual(lin.calls.windows[0].webContents.inserted, []);
  assert.deepEqual(lin.seen.cssReads, []);
  const win = makeController({ platform: 'win32', over: REUSED });
  await win.ctl.start();
  domReady(win.calls.windows[0]);
  assert.deepEqual(win.calls.windows[0].webContents.inserted, ['CSS'], 'the overlay chrome needs it too');
  const mac = makeController({ over: REUSED });
  await mac.ctl.start();
  const w = mac.calls.windows[0];
  for (const url of ['https://evil.example/', 'http://127.0.0.1:9999/#history', 'about:blank', 'not a url', '']) {
    w.webContents.mainFrame.url = url;
    domReady(w);
    assert.deepEqual(w.webContents.inserted, [], url);
  }
  assert.deepEqual(mac.seen.cssReads, []);
  w.webContents.getURL = undefined;
  assert.doesNotThrow(() => domReady(w));
  assert.deepEqual(w.webContents.inserted, [], 'no URL: refused');
});

test('27c. unreadable CSS logs once and inserts nothing; a rejected insertCSS is logged, never thrown', async () => {
  const errors = [];
  const log = { info() {}, error: (m) => errors.push(m) };
  const none = makeController({ log, over: { ...REUSED, readDesktopShellCss: (root) => { none.seen.cssReads.push(root); return null; } } });
  await none.ctl.start();
  const w = none.calls.windows[0];
  domReady(w); domReady(w);
  assert.deepEqual(w.webContents.inserted, []);
  assert.deepEqual(none.seen.cssReads, ['/srv'], 'a missing file is not read again');
  assert.deepEqual(errors, [`worca desktop: ${join('/srv', 'ui', 'public', 'shell', 'desktop-shell.css')} is missing; the window chrome falls back to the page's own CSS`]);
  errors.length = 0;
  const bad = makeController({ log, over: REUSED });
  await bad.ctl.start();
  const bw = bad.calls.windows[0];
  bw.webContents.insertCSS = () => Promise.reject(new Error('boom'));
  assert.doesNotThrow(() => domReady(bw));
  await tick();
  assert.deepEqual(errors, ['worca desktop: injecting the desktop chrome CSS failed: boom']);
  bw.webContents.insertCSS = () => { throw new Error('sync boom'); };
  assert.doesNotThrow(() => domReady(bw));
  assert.deepEqual(errors.at(-1), 'worca desktop: injecting the desktop chrome CSS failed: sync boom');
  bw.webContents.insertCSS = undefined;
  assert.doesNotThrow(() => domReady(bw));
  const throwing = makeController({ log, over: { ...REUSED, readDesktopShellCss: () => { throw new Error('fs gone'); } } });
  await throwing.ctl.start();
  assert.doesNotThrow(() => domReady(throwing.calls.windows[0]));
  assert.deepEqual(throwing.calls.windows[0].webContents.inserted, []);
});

const dbl = (mk, ev) => mk.electron.ipcMain.emit('worca:title-dblclick', ev ?? shellEvent(mk.calls.windows[0]), { evil: true });

test('28. title double-click on darwin: unset/Maximize/Fill zoom then restore; Minimize minimizes; None does nothing; getUserDefault gets (AppleActionOnDoubleClick, string)', async () => {
  for (const appleAction of [undefined, '', 'Maximize', 'Fill']) {
    const mk = makeController({ appleAction });
    await mk.ctl.start();
    const w = mk.calls.windows[0];
    dbl(mk);
    assert.deepEqual(w.winCalls, ['maximize'], String(appleAction));
    dbl(mk);
    assert.deepEqual(w.winCalls, ['maximize', 'unmaximize'], String(appleAction));
    assert.deepEqual(mk.calls.userDefaults, [['AppleActionOnDoubleClick', 'string'], ['AppleActionOnDoubleClick', 'string']], 'read per click');
    assert.deepEqual(w.webContents.sent, [], 'no reply');
  }
  const min = makeController({ appleAction: 'Minimize' });
  await min.ctl.start();
  dbl(min);
  assert.deepEqual(min.calls.windows[0].winCalls, ['minimize']);
  const none = makeController({ appleAction: 'None' });
  await none.ctl.start();
  dbl(none); dbl(none);
  assert.deepEqual(none.calls.windows[0].winCalls, []);
  assert.equal(none.calls.userDefaults.length, 2);
});

test('28b. title double-click on win32 toggles maximize and never reads systemPreferences; a throwing or missing systemPreferences means maximize', async () => {
  const win = makeController({ platform: 'win32', appleAction: 'None' });
  await win.ctl.start();
  dbl(win); dbl(win); dbl(win);
  assert.deepEqual(win.calls.windows[0].winCalls, ['maximize', 'unmaximize', 'maximize']);
  assert.deepEqual(win.calls.userDefaults, []);
  for (const appleAction of [THROW, MISSING]) {
    const mk = makeController({ appleAction });
    await mk.ctl.start();
    assert.doesNotThrow(() => dbl(mk));
    assert.deepEqual(mk.calls.windows[0].winCalls, ['maximize'], String(appleAction));
  }
  const noFn = makeController({ appleAction: 'Minimize' });
  noFn.electron.systemPreferences.getUserDefault = undefined;
  await noFn.ctl.start();
  dbl(noFn);
  assert.deepEqual(noFn.calls.windows[0].winCalls, ['maximize'], 'no getUserDefault: the default');
  const bare = makeController({ platform: 'win32' });
  await bare.ctl.start();
  const bw = bare.calls.windows[0];
  bw.isMaximized = undefined; bw.maximize = undefined; bw.unmaximize = undefined; bw.minimize = undefined;
  assert.doesNotThrow(() => dbl(bare), 'missing window methods do not throw');
  const minNo = makeController({ appleAction: 'Minimize' });
  await minNo.ctl.start();
  minNo.calls.windows[0].minimize = undefined;
  assert.doesNotThrow(() => dbl(minNo));
});

test('28d. desktop/main.mjs hands systemPreferences to the controller (else the macOS double-click setting is never read)', () => {
  const main = readFileSync(new URL('../desktop/main.mjs', import.meta.url), 'utf8');
  const m = /createDesktopController\(\{\s*electron:\s*\{([^}]*)\}/.exec(main);
  assert.ok(m, 'main.mjs passes an electron object to createDesktopController');
  assert.ok(m[1].split(',').map((x) => x.trim()).includes('systemPreferences'), m[1]);
});

test('28c. title double-click refused: another sender, a sub-frame, no frame, a foreign or stale origin, before the window exists; in full screen it does nothing; exactly one listener', async () => {
  let n = 0;
  const mk = makeController({ platform: 'darwin', over: {
    startServer: async ({ env }) => { const port = ++n === 1 ? 4317 : 50777; const hd = fakeChildHandle(`http://127.0.0.1:${port}`, port, 900 + n); mk.seen.start.push({ env, handle: hd }); return hd; },
  } });
  await mk.ctl.start();
  const w = mk.calls.windows[0];
  const popup = fakeContents();
  popup.mainFrame = { url: `${APP}/` };
  const refused = [
    { sender: popup, senderFrame: popup.mainFrame },
    shellEvent(w, { senderFrame: { url: `${APP}/` } }),
    shellEvent(w, { senderFrame: null }),
    shellEvent(w, { senderFrame: undefined }),
    { sender: w.webContents },
    null,
  ];
  const check = (label) => {
    assert.deepEqual(w.winCalls, [], label);
    assert.deepEqual(w.webContents.sent, [], label);
    assert.deepEqual(popup.sent, [], label);
    assert.deepEqual(mk.calls.userDefaults, [], label);
  };
  for (const ev of refused) { assert.doesNotThrow(() => mk.electron.ipcMain.emit('worca:title-dblclick', ev)); check(JSON.stringify(ev && Object.keys(ev))); }
  w.webContents.mainFrame = { url: 'https://evil.example/' };
  dbl(mk);
  check('foreign origin');
  w.webContents.mainFrame = { url: `${APP}/#history` };
  w.fullScreen = true;
  dbl(mk);
  check('full screen');
  w.fullScreen = false;
  mk.seen.start[0].handle.die(1);
  await until(() => w.loaded.length === 2);
  w.webContents.mainFrame = { url: `${APP}/#history` };   // still on the old port
  dbl(mk);
  check('stale origin after a Restart');
  w.webContents.mainFrame = { url: 'http://127.0.0.1:50777/#history' };
  dbl(mk);
  assert.deepEqual(w.winCalls, ['maximize'], 'the new origin is accepted');
  assert.equal(mk.electron.ipcMain.listenerCount('worca:title-dblclick'), 1, 'registered once');

  let release;
  const gate = new Promise((r) => { release = r; });
  const early = makeController({ over: { startServer: async ({ env }) => { await gate; const hd = fakeChildHandle(APP, 4317); early.seen.start.push({ env, handle: hd }); return hd; } } });
  const started = early.ctl.start();
  await tick();
  const wc = fakeContents();
  wc.mainFrame = { url: `${APP}/` };
  assert.doesNotThrow(() => early.electron.ipcMain.emit('worca:title-dblclick', { sender: wc, senderFrame: wc.mainFrame }));
  assert.deepEqual(early.calls.userDefaults, []);
  assert.deepEqual(wc.sent, []);
  release();
  await started;
  assert.deepEqual(early.calls.windows[0].winCalls, []);
  assert.equal(early.electron.ipcMain.listenerCount('worca:title-dblclick'), 1);
});

/** A badge report from the main window's own top frame (or a forged event). */
const sendBadge = (mk, state, ev) => mk.electron.ipcMain.emit(BADGE_CHANNEL, ev ?? shellEvent(mk.calls.windows[0]), state);
const B = (count, dot = false) => ({ count, dot });
const badgeCalls = (calls) => ({ dock: calls.dockBadge, overlay: calls.overlay, count: calls.badgeCount, bitmaps: calls.bitmaps });
const NO_CALLS = { dock: [], overlay: [], count: [], bitmaps: [] };
/** Test 18's server helper: the first start on 4317, a Restart on 50777. */
const movingServer = (ref) => {
  let n = 0;
  return { startServer: async ({ env }) => { const port = ++n === 1 ? 4317 : 50777; const hd = fakeChildHandle(`http://127.0.0.1:${port}`, port, 900 + n); ref.mk.seen.start.push({ env, handle: hd }); return hd; } };
};

test('29a. darwin: (2) → dock \'2\' and tooltip \'Worca — 2 runs need you\'; problems only → \'•\'; 0 → \'\' and \'Worca\'; the same state twice → no call; no overlay or setBadgeCount', async () => {
  const mk = makeController({ platform: 'darwin' });
  await mk.ctl.start();
  const { calls } = mk;
  assert.deepEqual(calls.toolTips, ['Worca'], 'the tray starts with the plain name');
  sendBadge(mk, B(2));
  assert.deepEqual(calls.dockBadge, ['2']);
  assert.equal(calls.toolTips.at(-1), 'Worca — 2 runs need you');
  assert.deepEqual(mk.ctl.state().badge, B(2));
  sendBadge(mk, B(2));
  assert.deepEqual(calls.dockBadge, ['2'], 'unchanged → no call');
  assert.equal(calls.toolTips.length, 2, 'unchanged → no tooltip call');
  sendBadge(mk, B(0, true));
  assert.deepEqual(calls.dockBadge, ['2', '•']);
  assert.equal(calls.toolTips.at(-1), 'Worca — unread schedule problems');
  sendBadge(mk, B(2, true));
  assert.deepEqual(calls.dockBadge, ['2', '•', '2']);
  sendBadge(mk, B(0));
  assert.deepEqual(calls.dockBadge, ['2', '•', '2', '']);
  assert.equal(calls.toolTips.at(-1), 'Worca');
  assert.equal(mk.electron.app.dock.getBadge(), '');
  assert.deepEqual(mk.ctl.state().badge, B(0));
  assert.deepEqual([calls.overlay, calls.badgeCount, calls.bitmaps], [[], [], []]);
});

test('29b. win32: 2 → overlay bitmap \'2\' with \'2 runs need you\'; 12 → the \'9+\' bitmap; problems only → the dot bitmap; 0 → setOverlayIcon(null, \'\'); bitmaps cached per label; no dock or setBadgeCount', async () => {
  const mk = makeController({ platform: 'win32' });
  await mk.ctl.start();
  const { calls } = mk;
  const OPTS = { width: 32, height: 32, scaleFactor: 2 };
  sendBadge(mk, B(2));
  assert.equal(calls.overlay.length, 1);
  assert.deepEqual(calls.overlay[0], [{ bitmap: true, opts: OPTS }, '2 runs need you']);
  assert.ok(calls.bitmaps[0][0].equals(badgeBitmap('2').buffer), 'the \'2\' bitmap');
  assert.deepEqual(calls.bitmaps[0][1], OPTS);
  assert.equal(calls.toolTips.at(-1), 'Worca — 2 runs need you');
  sendBadge(mk, B(12));
  assert.ok(calls.bitmaps[1][0].equals(badgeBitmap('9+').buffer), 'the \'9+\' bitmap');
  assert.deepEqual(calls.overlay[1][1], '12 runs need you');
  sendBadge(mk, B(0, true));
  assert.ok(calls.bitmaps[2][0].equals(badgeBitmap('•').buffer), 'the dot bitmap');
  assert.deepEqual(calls.overlay[2][1], 'Unread schedule problems');
  sendBadge(mk, B(0));
  assert.deepEqual(calls.overlay[3], [null, '']);
  assert.equal(calls.toolTips.at(-1), 'Worca');
  sendBadge(mk, B(2));
  assert.equal(calls.bitmaps.length, 3, 'the \'2\' image is reused');
  assert.equal(calls.overlay[4][0], calls.overlay[0][0], 'the same nativeImage');
  sendBadge(mk, B(15));
  assert.equal(calls.bitmaps.length, 3, '\'9+\' again: reused');
  assert.equal(calls.overlay[5][0], calls.overlay[1][0]);
  assert.deepEqual([calls.dockBadge, calls.badgeCount], [[], []]);
});

test('29c. linux: setBadgeCount(2), then 0 for problems only and for 0; no dock or overlay; the tooltip follows', async () => {
  const mk = makeController({ platform: 'linux' });
  await mk.ctl.start();
  const { calls } = mk;
  sendBadge(mk, B(2));
  assert.deepEqual(calls.badgeCount, [2]);
  assert.equal(calls.toolTips.at(-1), 'Worca — 2 runs need you');
  sendBadge(mk, B(0, true));
  assert.deepEqual(calls.badgeCount, [2, 0]);
  assert.equal(calls.toolTips.at(-1), 'Worca — unread schedule problems');
  sendBadge(mk, B(0));
  assert.deepEqual(calls.badgeCount, [2, 0, 0]);
  assert.equal(calls.toolTips.at(-1), 'Worca');
  assert.deepEqual([calls.dockBadge, calls.overlay, calls.bitmaps], [[], [], []]);
});

test('29d. refused badge messages change nothing: another sender, a sub-frame, no frame, a foreign or stale origin (after a Restart), before the window exists; bad payloads', async () => {
  for (const platform of ['win32', 'darwin']) {
    const ref = {};
    const mk = makeController({ platform, over: movingServer(ref) });
    ref.mk = mk;
    await mk.ctl.start();
    const w = mk.calls.windows[0];
    const popup = fakeContents();
    popup.mainFrame = { url: `${APP}/` };
    const refused = [
      [{ sender: popup, senderFrame: popup.mainFrame }, B(2)],
      [shellEvent(w, { senderFrame: { url: `${APP}/` } }), B(2)],
      [shellEvent(w, { senderFrame: null }), B(2)],
      [shellEvent(w, { senderFrame: undefined }), B(2)],
      [{ sender: w.webContents }, B(2)],
      [null, B(2)],
    ];
    for (const payload of ['2', 2, NaN, 2.5, -1, 100000, null, undefined, [2, false], { count: 1, dot: 'yes' }, { count: '2', dot: false }, { count: NaN, dot: false }, { count: 2.5, dot: false }, { count: -1, dot: false }, { count: 100000, dot: false }, { count: 1 }]) {
      refused.push([shellEvent(w), payload]);
    }
    const check = (label) => {
      assert.deepEqual(badgeCalls(mk.calls), NO_CALLS, `${platform} ${label}`);
      assert.deepEqual(mk.calls.toolTips, ['Worca'], `${platform} ${label}`);
      assert.deepEqual(mk.ctl.state().badge, NO_BADGE, `${platform} ${label}`);
      assert.deepEqual(w.webContents.sent, [], `${platform} ${label}: no reply`);
      assert.deepEqual(popup.sent, [], `${platform} ${label}`);
    };
    for (const [ev, payload] of refused) {
      assert.doesNotThrow(() => mk.electron.ipcMain.emit(BADGE_CHANNEL, ev, payload));
      check(String(JSON.stringify(payload)));
    }
    w.webContents.mainFrame = { url: 'https://evil.example/' };
    sendBadge(mk, B(2));
    check('foreign origin');
    w.webContents.mainFrame = { url: `${APP}/#history` };
    mk.seen.start[0].handle.die(1);
    await until(() => w.loaded.length === 2);
    w.webContents.mainFrame = { url: `${APP}/#history` };   // still on the old port
    sendBadge(mk, B(2));
    check('stale origin after a Restart');
    w.webContents.mainFrame = { url: 'http://127.0.0.1:50777/#history' };
    sendBadge(mk, B(2));
    assert.deepEqual(mk.ctl.state().badge, B(2), `${platform}: the new origin is accepted`);
    assert.equal(platform === 'darwin' ? mk.calls.dockBadge.length : mk.calls.overlay.length, 1);
  }
  let release;
  const gate = new Promise((r) => { release = r; });
  const early = makeController({ platform: 'win32', over: { startServer: async ({ env }) => { await gate; const hd = fakeChildHandle(APP, 4317); early.seen.start.push({ env, handle: hd }); return hd; } } });
  const started = early.ctl.start();
  await tick();
  const wc = fakeContents();
  wc.mainFrame = { url: `${APP}/` };
  assert.doesNotThrow(() => early.electron.ipcMain.emit(BADGE_CHANNEL, { sender: wc, senderFrame: wc.mainFrame }, B(2)));
  release();
  await started;
  assert.deepEqual(badgeCalls(early.calls), NO_CALLS, 'before the window exists');
  assert.deepEqual(early.calls.toolTips, ['Worca']);
  assert.deepEqual(early.ctl.state().badge, NO_BADGE);
});

test('29e. an owned server exit clears the badge before the Restart dialog; after Restart the new origin\'s badge is accepted', async () => {
  const ref = {};
  const mk = makeController({ platform: 'darwin', over: movingServer(ref) });
  ref.mk = mk;
  await mk.ctl.start();
  const w = mk.calls.windows[0];
  sendBadge(mk, B(2));
  assert.deepEqual(mk.calls.dockBadge, ['2']);
  const snap = {};
  const show = mk.electron.dialog.showMessageBox;
  mk.electron.dialog.showMessageBox = (o) => { snap.badge = mk.ctl.state().badge; snap.dock = [...mk.calls.dockBadge]; snap.tip = mk.calls.toolTips.at(-1); return show(o); };
  mk.seen.start[0].handle.die(3);
  await until(() => w.loaded.length === 2);
  assert.deepEqual(snap, { badge: NO_BADGE, dock: ['2', ''], tip: 'Worca' }, 'cleared before the dialog');
  assert.equal(w.webContents.mainFrame.url, 'http://127.0.0.1:50777/#history');
  sendBadge(mk, B(3));
  assert.deepEqual(mk.calls.dockBadge, ['2', '', '3']);
  assert.deepEqual(mk.ctl.state().badge, B(3));
});

test('29f. did-navigate clears; did-fail-load clears for (main frame, -105) but not for (main frame, -3) nor (sub-frame, -105); did-start-navigation and did-navigate-in-page leave the badge; render-process-gone clears', async () => {
  const mk = makeController({ platform: 'darwin' });
  await mk.ctl.start();
  const wc = mk.calls.windows[0].webContents;
  const URL_ = `${APP}/`;
  const cases = [
    ['did-navigate', [{}, URL_, 200, 'OK'], true],
    ['did-fail-load', [{}, -105, 'ERR_NAME_NOT_RESOLVED', URL_, true, 1, 1], true],
    ['did-fail-load', [{}, -3, 'ERR_ABORTED', URL_, true, 1, 1], false],
    ['did-fail-load', [{}, -105, 'ERR_NAME_NOT_RESOLVED', 'http://frame.example/', false, 1, 2], false],
    ['did-fail-load', [{}, -105, 'ERR_NAME_NOT_RESOLVED', URL_, 1, 1, 1], false],
    ['did-start-navigation', [{ url: URL_, isMainFrame: true, isSameDocument: false }], false],
    ['did-navigate-in-page', [{}, `${APP}/#chat`, true, 1, 1], false],
    ['render-process-gone', [{}, { reason: 'crashed', exitCode: 1 }], true],
  ];
  for (const [ev, args, clears] of cases) {
    sendBadge(mk, B(2));
    assert.deepEqual(mk.ctl.state().badge, B(2), `${ev} set`);
    const before = mk.calls.dockBadge.length;
    wc.emit(ev, ...args);
    const label = `${ev} ${JSON.stringify(args.slice(1))}`;
    if (clears) {
      assert.deepEqual(mk.ctl.state().badge, NO_BADGE, label);
      assert.deepEqual(mk.calls.dockBadge.slice(before), [''], label);
      assert.equal(mk.calls.toolTips.at(-1), 'Worca', label);
    } else {
      assert.deepEqual(mk.ctl.state().badge, B(2), label);
      assert.equal(mk.calls.dockBadge.length, before, label);
    }
  }
});

test('29g. win32: setAppUserModelId(APP_ID) once, third in calls.order after setName and enableSandbox, before whenReady, also when the single-instance lock is refused; darwin and linux never call it', async () => {
  assert.equal(APP_ID, 'dev.worca.desktop');
  for (const lock of [true, false]) {
    const mk = makeController({ platform: 'win32', lock });
    mk.electron.app.whenReady = async () => { mk.calls.order.push('whenReady'); };
    await mk.ctl.start();
    assert.deepEqual(mk.calls.aumid, [APP_ID], `lock ${lock}`);
    assert.deepEqual(mk.calls.order, lock ? ['setName', 'enableSandbox', 'setAppUserModelId', 'whenReady'] : ['setName', 'enableSandbox', 'setAppUserModelId'], `lock ${lock}`);
  }
  for (const platform of ['darwin', 'linux']) {
    const mk = makeController({ platform });
    await mk.ctl.start();
    assert.deepEqual(mk.calls.aumid, [], platform);
    assert.ok(!mk.calls.order.includes('setAppUserModelId'), platform);
  }
  const bare = makeController({ platform: 'win32' });
  bare.electron.app.setAppUserModelId = undefined;
  await assert.doesNotReject(bare.ctl.start());
  assert.equal(bare.calls.windows.length, 1);
});

test('29h. a throwing dock.setBadge / setOverlayIcon / setBadgeCount is logged and the tooltip is still set; nothing throws out of the IPC handler', async () => {
  const boom = () => { throw new Error('boom'); };
  const rows = [
    ['darwin', (mk) => { mk.electron.app.dock.setBadge = boom; }, 'worca desktop: the Dock badge failed: boom'],
    ['win32', (mk) => { mk.calls.windows[0].setOverlayIcon = boom; }, 'worca desktop: the taskbar overlay failed: boom'],
    ['win32', (mk) => { mk.electron.nativeImage.createFromBitmap = boom; }, 'worca desktop: the taskbar overlay failed: boom'],
    ['linux', (mk) => { mk.electron.app.setBadgeCount = boom; }, 'worca desktop: the launcher badge failed: boom'],
  ];
  for (const [platform, breakIt, line] of rows) {
    const errors = [];
    const mk = makeController({ platform, log: { info() {}, error: (m) => errors.push(m) } });
    await mk.ctl.start();
    breakIt(mk);
    assert.doesNotThrow(() => sendBadge(mk, B(2)), platform);
    assert.deepEqual(errors, [line], platform);
    assert.equal(mk.calls.toolTips.at(-1), 'Worca — 2 runs need you', platform);
    assert.deepEqual(mk.ctl.state().badge, B(2), platform);
  }
  const errors = [];
  const mk = makeController({ platform: 'darwin', log: { info() {}, error: (m) => errors.push(m) } });
  await mk.ctl.start();
  mk.calls.trays[0].setToolTip = boom;
  assert.doesNotThrow(() => sendBadge(mk, B(2)));
  assert.deepEqual(errors, ['worca desktop: the tray tooltip failed: boom']);
  assert.deepEqual(mk.calls.dockBadge, ['2'], 'the Dock still got it');
});

test('29i. exactly one listener on worca:badge', async () => {
  const mk = makeController();
  await mk.ctl.start();
  assert.equal(BADGE_CHANNEL, 'worca:badge');
  assert.equal(mk.electron.ipcMain.listenerCount(BADGE_CHANNEL), 1);
});

test('29j. win32: showing the window again re-applies a shown overlay; none when the badge is clear', async () => {
  const mk = makeController({ platform: 'win32' });
  await mk.ctl.start();
  const w = mk.calls.windows[0];
  w.emit('show');
  assert.deepEqual(mk.calls.overlay, [], 'nothing to re-apply');
  sendBadge(mk, B(2));
  assert.equal(mk.calls.overlay.length, 1);
  w.emit('show');
  assert.equal(mk.calls.overlay.length, 2);
  assert.deepEqual(mk.calls.overlay[1], mk.calls.overlay[0], 'the same image and text');
  assert.equal(mk.calls.bitmaps.length, 1, 'from the cache');
  sendBadge(mk, B(0));
  assert.deepEqual(mk.calls.overlay[2], [null, '']);
  w.emit('show');
  assert.equal(mk.calls.overlay.length, 3, 'a clear badge is not re-applied');
  const mac = makeController({ platform: 'darwin' });
  await mac.ctl.start();
  sendBadge(mac, B(2));
  mac.calls.windows[0].emit('show');
  assert.deepEqual(mac.calls.overlay, [], 'darwin has no overlay');
});
