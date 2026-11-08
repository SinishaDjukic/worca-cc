// desktop/src/controller.mjs — the desktop app's life cycle (docs/desktop.md): one instance, reuse a worca already
// running on the shared store or start one (4317, else an OS port), a sandboxed window and a tray, close-to-tray, and
// a Quit that stops only a server this app started. `electron` and every helper are injected: tests pass fakes, and
// desktop/main.mjs is the only file that imports electron. Imports only node: builtins and sibling modules.
import { createWriteStream, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readLoginShellPath } from './shell-path.mjs';
import { resolveStoreDir, findRunningServer, setupSingleInstance, shouldStartHidden } from './instance.mjs';
import { choosePort, PREFERRED_PORT } from './ports.mjs';
import { resolveServerRuntime, buildServerEnv, startServer, stopServer } from './server-process.mjs';
import { windowOptions, permissionAllowed, applyContentsPolicy } from './window.mjs';
import { trayMenuTemplate } from './tray-menu.mjs';
import { APP_NAME, appMenuTemplate, aboutPanelOptions, readRootVersion, aboutVersion, devIconPath } from './app-menu.mjs';

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

const DEFAULT_HELPERS = { readLoginShellPath, resolveStoreDir, findRunningServer, choosePort, resolveServerRuntime, buildServerEnv, startServer, stopServer, openServerLog, readRootVersion };
const lastLines = (text, n) => String(text || '').split(/\r?\n/).filter((l) => l.trim()).slice(-n).join('\n');

export function createDesktopController({ electron, platform = process.platform, argv = [], env = process.env, home, resourcesPath, packaged, desktopDir, helpers = {}, log = { info: console.log, error: console.error } }) {
  const { app, BrowserWindow, Tray, Menu, shell, dialog, session, nativeImage } = electron;
  const h = { ...DEFAULT_HELPERS, ...helpers };
  const st = { url: null, owned: false, quitting: false, stopping: false, stopped: false, handle: null, starting: null, storeDir: null, loginPath: null, win: null, tray: null, openAtLogin: false, logPath: null, logStream: null, pendingShow: false };

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

  function createWindow() {
    const icon = platform === 'linux' ? join(desktopDir, 'assets', 'tray@2x.png') : undefined;
    const win = new BrowserWindow(windowOptions({ icon }));
    st.win = win;
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

  function createTray() {
    const trayPath = join(desktopDir, 'assets', 'tray.png');
    const image = nativeImage.createFromPath(trayPath);
    if (!image || image.isEmpty()) log.error(`worca desktop: the tray image is empty: ${trayPath}`);
    st.tray = new Tray(image);
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
    app.on('web-contents-created', (_e, wc) => applyContentsPolicy(wc, { getAppOrigin, openExternal: (u) => shell.openExternal(u) }));
    if (!setupSingleInstance(app, { onSecondInstance: showWindow })) return;
    await app.whenReady();
    setupAppIdentity();
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
    state: () => ({ url: st.url, owned: st.owned, quitting: st.quitting, windowVisible: !!(st.win && st.win.isVisible()) }),
  };
}
