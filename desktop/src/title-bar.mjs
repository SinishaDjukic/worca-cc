// desktop/src/title-bar.mjs — the desktop window's title bar (docs/desktop.md "Window and icons"): macOS hides it and
// moves the traffic lights into the sidebar's logo row (inset), Windows draws its controls over the top bar in the
// theme's colours (overlay), Linux keeps the native bar. The preload reports { mode, scheme, rail } enums; colours
// come only from THEME_COLORS (= the CSS tokens --bg, --panel, --ink). Imports only node: builtins.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TOP_BAR_HEIGHT = 48;

export const THEME_COLORS = Object.freeze({
  light: Object.freeze({ background: '#F1F1EF', overlay: '#FFFFFF', symbol: '#19191B' }),
  dark: Object.freeze({ background: '#161614', overlay: '#222220', symbol: '#ECECE8' }),
});

/** Top-left of the ~52×14 light group: centred on the 48px logo row, or above the mark in the 60px rail's 32px top. */
export const TRAFFIC_LIGHTS = Object.freeze({
  expanded: Object.freeze({ x: 18, y: 17 }),
  rail: Object.freeze({ x: 4, y: 9 }),
});
export const TRAFFIC_LIGHTS_SIZE = Object.freeze({ width: 52, height: 14 });

/** The renderer's title-strip double-click (no payload); the sandboxed preload repeats the literal. */
export const TITLE_DBLCLICK_CHANNEL = 'worca:title-dblclick';

/** The desktop chrome CSS part, relative to a server tree (main injects it when a server it did not start serves the page). */
export const DESKTOP_SHELL_CSS = Object.freeze(['ui', 'public', 'shell', 'desktop-shell.css']);

const MODES = new Set(['system', 'light', 'dark']);
const SCHEMES = new Set(['light', 'dark']);
const PREFS_FILE = 'window-shell.json';
const DEFAULT_PREFS = Object.freeze({ mode: 'system', rail: false });

/** <serverRoot>/ui/public/shell/desktop-shell.css as text; null on any read error or an empty file. Never throws. */
export function readDesktopShellCss(serverRoot, { readFile = readFileSync } = {}) {
  try {
    const text = String(readFile(join(serverRoot, ...DESKTOP_SHELL_CSS), 'utf8'));
    return text ? text : null;
  } catch {
    return null;
  }
}

/**
 * What a double-click on the title strip does: macOS follows "Double-click a window's title bar to…"
 * (AppleActionOnDoubleClick: Minimize, None; Maximize, Fill, unset or anything else zoom); every other OS toggles
 * maximize. 'maximize' means toggle: maximize, or restore when already maximized.
 */
export function titleDoubleClickAction({ platform, appleAction } = {}) {
  if (platform !== 'darwin') return 'maximize';
  if (appleAction === 'Minimize') return 'minimize';
  if (appleAction === 'None') return 'none';
  return 'maximize';
}

export function titleBarChrome(platform) {
  if (platform === 'darwin') return 'inset';
  if (platform === 'win32') return 'overlay';
  return 'native';
}

const isPlainObject = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};
const own = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/** A renderer's shell-state message → { mode, scheme, rail }, or null for anything else. Extra keys are dropped. */
export function parseShellState(value) {
  if (!isPlainObject(value)) return null;
  const mode = own(value, 'mode');
  const scheme = own(value, 'scheme');
  const rail = own(value, 'rail');
  if (!MODES.has(mode) || !SCHEMES.has(scheme) || typeof rail !== 'boolean') return null;
  return { mode, scheme, rail };
}

export function resolveScheme(mode, systemDark) {
  if (mode === 'light' || mode === 'dark') return mode;
  return systemDark ? 'dark' : 'light';
}

/** The BrowserWindow option subset for a chrome kind; an unknown chrome is native, an unknown scheme light. */
export function chromeWindowOptions({ chrome, scheme, rail } = {}) {
  const colors = THEME_COLORS[SCHEMES.has(scheme) ? scheme : 'light'];
  if (chrome === 'inset') return { backgroundColor: colors.background, titleBarStyle: 'hidden', trafficLightPosition: { ...TRAFFIC_LIGHTS[rail ? 'rail' : 'expanded'] } };
  if (chrome === 'overlay') return { backgroundColor: colors.background, titleBarStyle: 'hidden', titleBarOverlay: { color: colors.overlay, symbolColor: colors.symbol, height: TOP_BAR_HEIGHT } };
  return { backgroundColor: colors.background };
}

/** <userData>/window-shell.json → { mode, rail }; the default on any read, parse or shape failure. Never throws. */
export function readShellPrefs(userDataDir) {
  try {
    const v = JSON.parse(readFileSync(join(userDataDir, PREFS_FILE), 'utf8'));
    if (isPlainObject(v) && MODES.has(own(v, 'mode')) && typeof own(v, 'rail') === 'boolean') return { mode: v.mode, rail: v.rail };
  } catch { /* missing or corrupt: the default */ }
  return { ...DEFAULT_PREFS };
}

/** Save { mode, rail } (never colours). Errors go to onError; never throws. */
export function writeShellPrefs(userDataDir, { mode, rail }, { onError = () => {} } = {}) {
  try {
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(join(userDataDir, PREFS_FILE), `${JSON.stringify({ mode, rail })}\n`);
  } catch (err) {
    try { onError(err); } catch { /* a failing logger must not reach the main process */ }
  }
}
