// desktop/src/window.mjs — the desktop window's safe defaults and the link / navigation / permission policy that
// every webContents gets (docs/desktop.md). The app origin is read on every call: a Restart may change the port.
// Only the main window gets a preload (desktop/preload.cjs): sandboxed, it can require nothing but electron, it is told
// the title bar kind through additionalArguments, and it exposes nothing to the page. Imports only sibling modules.
import { chromeWindowOptions } from './title-bar.mjs';

const ALLOWED_PERMISSIONS = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen']);
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** BrowserWindow options: sandboxed, isolated renderer, no Node; shown on ready-to-show. The title bar and background
 *  follow `chrome` and `scheme`; a `preload` (absolute path) also gets `--worca-chrome=<chrome>`. */
export function windowOptions({ title = 'Worca', icon, preload, chrome = 'native', scheme = 'light', rail = false } = {}) {
  return {
    title,
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    ...(icon ? { icon } : {}),
    ...chromeWindowOptions({ chrome, scheme, rail }),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      spellcheck: true,
      ...(preload ? { preload, additionalArguments: [`--worca-chrome=${chrome}`] } : {}),
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

/** Wire one webContents: window.open / target=_blank, will-navigate and will-redirect follow linkPolicy.
 *  `getScheme` gives a popup the current theme's background (popups keep the native frame and get no preload). */
export function applyContentsPolicy(contents, { getAppOrigin, openExternal, getScheme = () => 'light' }) {
  contents.setWindowOpenHandler((details) => {
    const url = details && details.url;
    const policy = linkPolicy(url, getAppOrigin());
    // A same-origin popup is a child app window with the same safe options; it must show (windowOptions hides
    // until ready-to-show, which only the main window waits for).
    if (policy === 'internal') return { action: 'allow', overrideBrowserWindowOptions: { ...windowOptions({ scheme: getScheme() }), show: true } };
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
