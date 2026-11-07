// test/desktop-controller.test.mjs — the desktop app's window policy, tray and controller with a fake electron
// (desktop/src/window.mjs, tray-menu.mjs, controller.mjs). desktop/main.mjs is glue that imports electron: not loaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { windowOptions, linkPolicy, permissionAllowed, applyContentsPolicy } from '../desktop/src/window.mjs';
import { trayMenuTemplate } from '../desktop/src/tray-menu.mjs';
import { createDesktopController, openServerLog } from '../desktop/src/controller.mjs';

const tick = () => new Promise((r) => setImmediate(r));
async function until(cond, n = 100) { for (let i = 0; i < n && !cond(); i++) await tick(); assert.ok(cond(), 'condition reached'); }
const APP = 'http://127.0.0.1:4317';

function fakeContents() {
  const wc = new EventEmitter();
  wc.openHandler = null;
  wc.setWindowOpenHandler = (fn) => { wc.openHandler = fn; };
  return wc;
}
const navEvent = () => { const e = { prevented: false, preventDefault() { e.prevented = true; } }; return e; };

function fakeElectron({ lock = true, loginItem = { openAtLogin: false, wasOpenedAtLogin: false } } = {}) {
  const calls = { quit: 0, enableSandbox: 0, setLogin: [], getLogin: [], openExternal: [], errorBox: [], messageBox: [], windows: [], trays: [], menus: [], images: [] };
  const app = new EventEmitter();
  app.isPackaged = false;
  app.requestSingleInstanceLock = () => lock;
  app.quit = () => { calls.quit++; const e = { defaultPrevented: false, preventDefault() { e.defaultPrevented = true; } }; app.emit('before-quit', e); calls.lastQuitEvent = e; };
  app.whenReady = async () => {};
  app.enableSandbox = () => { calls.enableSandbox++; };
  app.setLoginItemSettings = (o) => { calls.setLogin.push(o); loginItem = { ...loginItem, openAtLogin: o.openAtLogin }; };
  app.getLoginItemSettings = (o) => { calls.getLogin.push(o); return loginItem; };
  app.getPath = () => '/user-data';
  class BrowserWindow extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts; this.visible = false; this.loaded = []; this.shows = 0; this.hides = 0; this.focuses = 0;
      this.webContents = fakeContents();
      calls.windows.push(this);
      app.emit('web-contents-created', {}, this.webContents);
    }
    loadURL(u) { this.loaded.push(u); return Promise.resolve(); }
    show() { this.shows++; this.visible = true; }
    hide() { this.hides++; this.visible = false; }
    focus() { this.focuses++; }
    isVisible() { return this.visible; }
    isMinimized() { return false; }
  }
  class Tray extends EventEmitter {
    constructor(img) { super(); this.img = img; this.menu = null; calls.trays.push(this); }
    setContextMenu(m) { this.menu = m; }
    setToolTip() {}
  }
  const Menu = { buildFromTemplate: (t) => { calls.menus.push(t); return { template: t }; } };
  const shell = { openExternal: (u) => { calls.openExternal.push(u); return Promise.resolve(); } };
  const dialog = {
    showErrorBox: (title, text) => calls.errorBox.push({ title, text }),
    response: 0,
    showMessageBox: async (o) => { calls.messageBox.push(o); return { response: dialog.response }; },
  };
  const handlers = {};
  const session = { defaultSession: { setPermissionRequestHandler: (fn) => { handlers.request = fn; }, setPermissionCheckHandler: (fn) => { handlers.check = fn; } } };
  const nativeImage = { createFromPath: (p) => { calls.images.push(p); return { path: p, isEmpty: () => false }; } };
  return { electron: { app, BrowserWindow, Tray, Menu, shell, dialog, session, nativeImage }, calls, handlers };
}

function fakeChildHandle(url, port, pid = 900) {
  const child = new EventEmitter();
  child.pid = pid;
  let resolveExit;
  const exited = new Promise((r) => { resolveExit = r; });
  return { child, pid, url, port, owned: true, exited, stderrTail: () => '', die: (code) => resolveExit({ code, signal: null }) };
}

function fakeHelpers(over = {}) {
  const seen = { find: 0, start: [], stop: [], choose: 0 };
  const helpers = {
    readLoginShellPath: async () => ({ path: '/opt/homebrew/bin:/usr/bin', source: 'login-shell' }),
    resolveStoreDir: () => '/store',
    findRunningServer: async () => { seen.find++; return null; },
    choosePort: async () => { seen.choose++; return 4317; },
    resolveServerRuntime: () => ({ nodePath: '/n', serverRoot: '/srv' }),
    buildServerEnv: ({ port }) => ({ PORT: String(port), WORCA_DESKTOP: '1' }),
    startServer: async ({ env }) => { const h = fakeChildHandle(`http://127.0.0.1:${env.PORT === '0' ? 50123 : env.PORT}`, Number(env.PORT) || 50123); seen.start.push({ env, handle: h }); return h; },
    stopServer: async (h, o) => { seen.stop.push({ h, o }); return { exitCode: 0, via: 'request' }; },
    openServerLog: () => ({ stream: null, path: '/user-data/logs/server.log' }),
    ...over,
  };
  return { helpers, seen };
}

function makeController({ platform = 'darwin', argv = ['Worca'], lock, over, loginItem } = {}) {
  const fe = fakeElectron({ lock, loginItem });
  const { helpers, seen } = fakeHelpers(over);
  const ctl = createDesktopController({ electron: fe.electron, platform, argv, env: { PATH: '/usr/bin' }, home: '/Users/u', resourcesPath: '/res', packaged: false, desktopDir: '/app/desktop', helpers, log: { info() {}, error() {} } });
  return { ctl, ...fe, seen };
}

test('1. windowOptions: context isolation, sandbox, no node integration, no preload', () => {
  const o = windowOptions();
  assert.equal(o.webPreferences.contextIsolation, true);
  assert.equal(o.webPreferences.sandbox, true);
  assert.equal(o.webPreferences.nodeIntegration, false);
  assert.equal(o.webPreferences.nodeIntegrationInWorker, false);
  assert.ok(!('preload' in o.webPreferences));
  assert.deepEqual([o.width, o.height, o.minWidth, o.minHeight, o.show], [1280, 860, 900, 600, false]);
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
  assert.deepEqual(mac.calls.images, [join('/app/desktop', 'assets', 'tray.png')]);
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
