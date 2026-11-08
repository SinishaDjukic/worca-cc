// desktop/src/controller.mjs — the desktop app's life cycle (docs/desktop.md): one instance, reuse a worca already
// running on the shared store or start one (4317, else an OS port), a sandboxed window and a tray, close-to-tray, and
// a Quit that stops only a server this app started. The window's title bar follows the OS and the page's theme
// (title-bar.mjs): the preload reports { mode, scheme, rail } over `worca:shell-state`, accepted only from the main
// window's own top frame on the app origin. A double-click on the title strip arrives over `worca:title-dblclick`
// under the same guard and zooms, minimizes or does nothing as the OS setting says. A server this app did not start
// may serve an older page without the desktop CSS, so main injects its own copy of desktop-shell.css into the main
// window on every document load of the app origin. `electron` and every helper are injected: tests pass fakes, and
// desktop/main.mjs is the only file that imports electron. Imports only node: builtins and sibling modules.
import { createWriteStream, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readLoginShellPath } from './shell-path.mjs';
import { resolveStoreDir, findRunningServer, setupSingleInstance, shouldStartHidden } from './instance.mjs';
import { choosePort, PREFERRED_PORT } from './ports.mjs';
import { resolveServerRuntime, serverTreeRoot, buildServerEnv, startServer, stopServer } from './server-process.mjs';
import { windowOptions, permissionAllowed, applyContentsPolicy } from './window.mjs';
import { trayMenuTemplate } from './tray-menu.mjs';
import { APP_NAME, appMenuTemplate, aboutPanelOptions, readRootVersion, aboutVersion, devIconPath } from './app-menu.mjs';
import { THEME_COLORS, TOP_BAR_HEIGHT, TRAFFIC_LIGHTS, TITLE_DBLCLICK_CHANNEL, DESKTOP_SHELL_CSS, titleBarChrome, titleDoubleClickAction, parseShellState, resolveScheme, readShellPrefs, writeShellPrefs, readDesktopShellCss } from './title-bar.mjs';
import { windowIconFile, trayImageFile, systemUIDark } from './app-icons.mjs';

/** <userData>/logs/server.log, truncated on every start. An open or write error is logged: createWriteStream reports
 *  it asynchronously, and an unhandled stream 'error' would end the main process. */
export function openServerLog(userDataDir, { onError = (err) => console.error(`worca desktop: the server log failed: ${err && err.message ? err.message : err}`) } = {}) {
  const dir = join(userDataDir, 'logs');
  const path = join(dir, 'server.log');
  try {
    mkdirSync(dir, { recursive: true });
    const stream = createWriteStream(path, { flags: 'w' });
    stream.on('error', onError);
    return { stream, path };
  } catch {
    return { stream: null, path };
  }
}

const DEFAULT_HELPERS = { readLoginShellPath, resolveStoreDir, findRunningServer, choosePort, resolveServerRuntime, buildServerEnv, startServer, stopServer, openServerLog, readRootVersion, readShellPrefs, writeShellPrefs, readDesktopShellCss, serverTreeRoot };
const errText = (err) => (err && err.message ? err.message : String(err));
const lastLines = (text, n) => String(text || '').split(/\r?\n/).filter((l) => l.trim()).slice(-n).join('\n');

export function createDesktopController({ electron, platform = process.platform, argv = [], env = process.env, home, resourcesPath, packaged, desktopDir, helpers = {}, log = { info: console.log, error: console.error } }) {
  const { app, BrowserWindow, Tray, Menu, shell, dialog, session, nativeImage, ipcMain, nativeTheme, systemPreferences } = electron;
  const h = { ...DEFAULT_HELPERS, ...helpers };
  const st = { url: null, owned: false, quitting: false, stopping: false, stopped: false, handle: null, starting: null, storeDir: null, loginPath: null, win: null, tray: null, trayFile: null, openAtLogin: false, logPath: null, logStream: null, pendingShow: false, chrome: titleBarChrome(platform), scheme: 'light', shellState: null, prefs: null, shellCss: undefined };

  const getAppOrigin = () => { try { return st.url ? new URL(st.url).origin : null; } catch { return null; } };
  const loginArgs = () => (platform === 'win32' ? { args: ['--hidden'] } : undefined);

  function showWindow() {
    const w = st.win;
    if (!w) { st.pendingShow = true; return; }
    if (typeof w.isMinimized === 'function' && w.isMinimized() && typeof w.restore === 'function') w.restore();
    w.show();
    w.focus();
  }

  /** Start a server child; st.starting holds it while it is not ready yet, so a Quit then can stop it. */
  async function launch(runtime, port) {
    const logFile = h.openServerLog(app.getPath('userData'));
    if (st.logStream && st.logStream !== logFile.stream) { try { st.logStream.end(); } catch { /* already closed */ } }
    st.logStream = logFile.stream;
    st.logPath = logFile.path;
    const serverEnv = h.buildServerEnv({ baseEnv: env, loginPath: st.loginPath && st.loginPath.path, port, platform });
    try {
      return await h.startServer({ runtime, env: serverEnv, logStream: logFile.stream, home, onSpawn: (handle) => { st.starting = handle; } });
    } finally {
      st.starting = null;
    }
  }

  function adopt(handle) {
    st.handle = handle;
    st.owned = true;
    st.stopped = false;
    st.url = handle.url;
    handle.exited.then(({ code, signal }) => onOwnedExit(handle, code ?? signal));
  }

  /** Step 7: start our own server (4317 when free, else an OS port), with one retry on a lost port race. */
  async function startOwned() {
    const runtime = h.resolveServerRuntime({ packaged, resourcesPath, desktopDir, platform, env });
    const port = await h.choosePort();
    let handle;
    try {
      handle = await launch(runtime, port);
    } catch (err) {
      if (st.quitting || !(err && err.code === 'SERVER_EXITED' && err.portBusy && port === PREFERRED_PORT)) throw err;
      const winner = await h.findRunningServer({ storeDir: st.storeDir });
      if (winner) { st.url = winner.url; st.owned = false; st.handle = null; return; }
      handle = await launch(runtime, 0);
    }
    adopt(handle);
  }

  function reportStartFailure(err) {
    if (st.quitting) return;   // the start was stopped by a Quit: before-quit finishes the quit
    const tail = lastLines(err && err.stderrTail, 20);
    const text = [err && err.message ? err.message : String(err), tail, st.logPath ? `Log: ${st.logPath}` : ''].filter(Boolean).join('\n\n');
    log.error(`worca desktop: start failed: ${text}`);
    dialog.showErrorBox('Worca could not start', text);
    app.quit();
  }

  function buildTrayMenu() {
    if (!st.tray) return;
    const template = trayMenuTemplate({
      platform,
      openAtLogin: st.openAtLogin,
      ownsServer: st.owned,
      onOpen: showWindow,
      onToggleLogin: (v) => {
        app.setLoginItemSettings({ openAtLogin: v, args: platform === 'win32' ? ['--hidden'] : [] });
        st.openAtLogin = !!app.getLoginItemSettings(loginArgs()).openAtLogin;
        buildTrayMenu();
      },
      onQuit: () => app.quit(),
    });
    st.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  const sendFullScreen = (contents, on) => { if (contents && typeof contents.send === 'function') contents.send('worca:shell-fullscreen', !!on); };

  /** The main window when `event` comes from its own top frame on the app origin (re-read per message: a Restart can
   *  move the port), else null. Every renderer message fails closed through it. */
  function fromMainTopFrame(event) {
    const win = st.win;
    if (!win || !event || event.sender !== win.webContents) return null;
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame) return null;
    const appOrigin = getAppOrigin();
    let frameOrigin = null;
    try { frameOrigin = new URL(String(frame.url)).origin; } catch { /* not a URL: refused below */ }
    if (!appOrigin || frameOrigin !== appOrigin) return null;
    return win;
  }

  /** The renderer's { mode, scheme, rail }: a refused message changes nothing and gets no reply. */
  function onShellState(event, payload) {
    const win = fromMainTopFrame(event);
    if (!win) return;
    const state = parseShellState(payload);
    if (!state) return;
    applyShellState(win, state);
    sendFullScreen(event.sender, typeof win.isFullScreen === 'function' && win.isFullScreen());
  }

  /** A double-click on the title strip (payload ignored): refused like a shell-state message, and a no-op in full
   *  screen. macOS follows AppleActionOnDoubleClick; every other OS toggles maximize. */
  function onTitleDoubleClick(event) {
    const win = fromMainTopFrame(event);
    if (!win) return;
    if (typeof win.isFullScreen === 'function' && win.isFullScreen()) return;
    let appleAction = null;
    if (platform === 'darwin') {
      try { appleAction = systemPreferences && typeof systemPreferences.getUserDefault === 'function' ? systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string') : null; } catch { appleAction = null; }
    }
    const action = titleDoubleClickAction({ platform, appleAction });
    const call = (name) => { if (typeof win[name] === 'function') win[name](); };
    if (action === 'maximize') call(typeof win.isMaximized === 'function' && win.isMaximized() ? 'unmaximize' : 'maximize');
    else if (action === 'minimize') call('minimize');
  }

  /** Every document load: a server this app did not start may serve an older page without the desktop CSS, so the
   *  app's own copy goes in (read once). Only for a reused server, a non-native chrome and the app origin; never throws. */
  function injectShellCss(contents) {
    try {
      if (st.owned || st.chrome === 'native' || !contents) return;
      const appOrigin = getAppOrigin();
      let origin = null;
      try { origin = new URL(String(contents.getURL())).origin; } catch { /* no URL: refused below */ }
      if (!appOrigin || origin !== appOrigin) return;
      if (st.shellCss === undefined) {
        const root = h.serverTreeRoot({ packaged, resourcesPath, desktopDir });
        st.shellCss = h.readDesktopShellCss(root);
        if (st.shellCss === null) log.error(`worca desktop: ${join(root, ...DESKTOP_SHELL_CSS)} is missing; the window chrome falls back to the page's own CSS`);
      }
      if (!st.shellCss || typeof contents.insertCSS !== 'function') return;
      Promise.resolve(contents.insertCSS(st.shellCss)).catch((err) => log.error(`worca desktop: injecting the desktop chrome CSS failed: ${errText(err)}`));
    } catch (err) {
      try { log.error(`worca desktop: injecting the desktop chrome CSS failed: ${errText(err)}`); } catch { /* a failing logger must not reach Electron */ }
    }
  }

  /** Colours come from THEME_COLORS only; an unchanged state makes no window call and no write. */
  function applyShellState(win, state) {
    const prev = st.shellState;
    if (prev && prev.mode === state.mode && prev.scheme === state.scheme && prev.rail === state.rail) return;
    st.shellState = state;
    st.scheme = state.scheme;
    const colors = THEME_COLORS[state.scheme];
    if (typeof win.setBackgroundColor === 'function') win.setBackgroundColor(colors.background);
    if (st.chrome === 'overlay' && typeof win.setTitleBarOverlay === 'function') win.setTitleBarOverlay({ color: colors.overlay, symbolColor: colors.symbol, height: TOP_BAR_HEIGHT });
    if (st.chrome === 'inset' && (!prev || prev.rail !== state.rail) && typeof win.setWindowButtonPosition === 'function') win.setWindowButtonPosition({ ...TRAFFIC_LIGHTS[state.rail ? 'rail' : 'expanded'] });
    if (!st.prefs || st.prefs.mode !== state.mode || st.prefs.rail !== state.rail) {
      st.prefs = { mode: state.mode, rail: state.rail };
      h.writeShellPrefs(app.getPath('userData'), st.prefs, { onError: (err) => log.error(`worca desktop: saving window-shell.json failed: ${err && err.message ? err.message : err}`) });
    }
  }

  function createWindow() {
    // The saved mode and rail (not colours) give the launch background, overlay and lights: no flash before the page reports.
    const prefs = h.readShellPrefs(app.getPath('userData'));
    st.prefs = { mode: prefs.mode, rail: prefs.rail };
    st.scheme = resolveScheme(prefs.mode, !!(nativeTheme && nativeTheme.shouldUseDarkColors));
    st.shellState = { mode: prefs.mode, scheme: st.scheme, rail: prefs.rail };
    const iconFile = windowIconFile(platform);
    const icon = iconFile ? join(desktopDir, 'assets', iconFile) : undefined;
    const win = new BrowserWindow(windowOptions({ icon, preload: join(desktopDir, 'preload.cjs'), chrome: st.chrome, scheme: st.scheme, rail: prefs.rail }));
    st.win = win;
    win.on('enter-full-screen', () => sendFullScreen(win.webContents, true));
    win.on('leave-full-screen', () => sendFullScreen(win.webContents, false));
    win.webContents.on('dom-ready', () => injectShellCss(win.webContents));
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_wc, permission, cb, details) => cb(permissionAllowed(permission, details && details.requestingUrl, getAppOrigin())));
    ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => permissionAllowed(permission, requestingOrigin, getAppOrigin()));
    win.on('close', (e) => {
      if (st.quitting) return;
      e.preventDefault();
      win.hide();
    });
    const hidden = !st.pendingShow && shouldStartHidden({ platform, argv, loginItem: platform === 'darwin' ? app.getLoginItemSettings() : undefined });
    win.once('ready-to-show', () => { if (!hidden) win.show(); });
    win.loadURL(st.url);
  }

  function trayImage(file) {
    const trayPath = join(desktopDir, 'assets', file);
    const image = nativeImage.createFromPath(trayPath);
    if (!image || image.isEmpty()) log.error(`worca desktop: the tray image is empty: ${trayPath}`);
    return image;
  }

  function createTray() {
    st.trayFile = trayImageFile({ platform, darkSystemUI: systemUIDark(nativeTheme) });
    const image = trayImage(st.trayFile);
    if (platform === 'darwin' && image && typeof image.setTemplateImage === 'function') image.setTemplateImage(true);
    st.tray = new Tray(image);
    if (platform !== 'darwin' && nativeTheme && typeof nativeTheme.on === 'function') {
      nativeTheme.on('updated', () => {
        const file = trayImageFile({ platform, darkSystemUI: systemUIDark(nativeTheme) });
        if (!st.tray || file === st.trayFile) return;
        st.trayFile = file;
        if (typeof st.tray.setImage === 'function') st.tray.setImage(trayImage(file));
      });
    }
    if (typeof st.tray.setToolTip === 'function') st.tray.setToolTip('Worca');
    st.openAtLogin = platform === 'linux' ? false : !!app.getLoginItemSettings(loginArgs()).openAtLogin;
    buildTrayMenu();
    if (platform !== 'darwin') st.tray.on('click', showWindow);
  }

  /** macOS: the Worca/Edit/View/Window menu, the About panel and (dev) the Dock icon. Cosmetic: a failure is logged
   *  and never stops the server start. The menu-bar title itself comes from the bundle's CFBundleName. */
  function setupAppIdentity() {
    if (platform !== 'darwin') return;
    try {
      Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate({ packaged })));
      const appVersion = app.getVersion();
      const rootVersion = packaged ? null : h.readRootVersion(desktopDir);
      if (!packaged && rootVersion === null) {
        log.error(`worca desktop: could not read the worca version from ${resolve(desktopDir, '..', 'package.json')}; the About panel shows ${appVersion}`);
      }
      const iconPath = devIconPath(desktopDir);
      app.setAboutPanelOptions(aboutPanelOptions({ version: aboutVersion({ packaged, appVersion, rootVersion }), iconPath }));
      // A path, not a nativeImage: the stock Electron.app fallback in dev still gets the worca icon in the Dock.
      if (!packaged && app.dock) app.dock.setIcon(iconPath);
    } catch (err) {
      log.error(`worca desktop: app menu/about setup failed: ${err && err.message ? err.message : err}`);
    }
  }

  async function onOwnedExit(handle, code) {
    if (st.quitting || st.stopping || handle !== st.handle) return;
    log.error(`worca desktop: the server stopped (exit ${code})`);
    const { response } = await dialog.showMessageBox({ type: 'warning', message: `The Worca server stopped (exit ${code}).`, buttons: ['Restart', 'Quit'], defaultId: 0, cancelId: 1 });
    if (response !== 0) { app.quit(); return; }
    try {
      await startOwned();
    } catch (err) {
      reportStartFailure(err);
      return;
    }
    if (st.quitting) return;
    buildTrayMenu();
    if (st.win) st.win.loadURL(st.url);
  }

  async function start() {
    app.setName(APP_NAME);   // the same name the userData folder already has (productName): it does not move
    app.enableSandbox();
    app.on('web-contents-created', (_e, wc) => applyContentsPolicy(wc, { getAppOrigin, openExternal: (u) => shell.openExternal(u), getScheme: () => st.scheme }));
    if (!setupSingleInstance(app, { onSecondInstance: showWindow })) return;
    await app.whenReady();
    setupAppIdentity();
    if (ipcMain) {
      ipcMain.on('worca:shell-state', onShellState);
      ipcMain.on(TITLE_DBLCLICK_CHANNEL, onTitleDoubleClick);
    }
    app.on('before-quit', (e) => {
      st.quitting = true;
      if (st.stopped) return;
      // Our server, and a child still starting (the first start, or a Restart while st.handle is the exited one).
      const handles = [...new Set([st.starting, st.owned ? st.handle : null].filter(Boolean))];
      if (!handles.length) return;
      e.preventDefault();
      if (st.stopping) return;
      st.stopping = true;
      Promise.all(handles.map((handle) => Promise.resolve()
        .then(() => h.stopServer(handle, { storeDir: st.storeDir }))
        .catch((err) => log.error(`worca desktop: stopping the server failed: ${err && err.message ? err.message : err}`))))
        .finally(() => { st.stopped = true; app.quit(); });
    });
    st.loginPath = await h.readLoginShellPath({ platform, env, home });
    st.storeDir = h.resolveStoreDir({ env, home });
    try {
      const existing = await h.findRunningServer({ storeDir: st.storeDir });
      if (existing) { st.url = existing.url; st.owned = false; } else await startOwned();
    } catch (err) {
      reportStartFailure(err);
      return;
    }
    if (st.quitting) return;
    createWindow();
    createTray();
    app.on('activate', showWindow);
    app.on('window-all-closed', () => { /* stay in the tray */ });
  }

  return {
    start,
    state: () => ({ url: st.url, owned: st.owned, quitting: st.quitting, windowVisible: !!(st.win && st.win.isVisible()), scheme: st.scheme, chrome: st.chrome }),
  };
}
