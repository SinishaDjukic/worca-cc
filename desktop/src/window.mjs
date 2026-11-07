// desktop/src/window.mjs — the desktop window's safe defaults and the link / navigation / permission policy that
// every webContents gets (docs/desktop.md). The app origin is read on every call: a Restart may change the port.
// Imports only node: builtins (none needed).

const ALLOWED_PERMISSIONS = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen']);
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** BrowserWindow options: sandboxed, isolated renderer, no Node, no preload; shown on ready-to-show. */
export function windowOptions({ title = 'Worca', icon } = {}) {
  return {
    title,
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      spellcheck: true,
    },
  };
}

function originOf(value) {
  try { return new URL(String(value)).origin; } catch { return null; }
}

/** internal = the app's own origin; external = http(s)/mailto elsewhere (system browser / mail app); else deny. */
export function linkPolicy(url, appOrigin) {
  let u;
  try { u = new URL(String(url)); } catch { return 'deny'; }
  if (appOrigin && u.origin === appOrigin) return 'internal';
  if (EXTERNAL_SCHEMES.has(u.protocol)) return 'external';
  return 'deny';
}

/** Only the app origin, and only voice (media), notifications, clipboard writes and fullscreen. */
export function permissionAllowed(permission, requestingUrl, appOrigin) {
  const origin = originOf(requestingUrl);
  return !!appOrigin && origin === appOrigin && ALLOWED_PERMISSIONS.has(permission);
}

/** Wire one webContents: window.open / target=_blank, will-navigate and will-redirect follow linkPolicy. */
export function applyContentsPolicy(contents, { getAppOrigin, openExternal }) {
  contents.setWindowOpenHandler((details) => {
    const url = details && details.url;
    const policy = linkPolicy(url, getAppOrigin());
    // A same-origin popup is a child app window with the same safe options; it must show (windowOptions hides
    // until ready-to-show, which only the main window waits for).
    if (policy === 'internal') return { action: 'allow', overrideBrowserWindowOptions: { ...windowOptions(), show: true } };
    if (policy === 'external') openExternal(url);
    return { action: 'deny' };
  });
  const guard = (event, url) => {
    const target = url ?? event?.url;
    const policy = linkPolicy(target, getAppOrigin());
    if (policy === 'internal') return;
    event.preventDefault();
    if (policy === 'external') openExternal(target);
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
}
