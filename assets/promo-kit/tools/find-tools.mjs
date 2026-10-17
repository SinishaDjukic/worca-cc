// Where the promo kit's external tools live on this host: a Chrome-family browser (capture, snap, fluency,
// sheet, export) and ffmpeg (mix, export). Pure lookups — every input is injectable, so the Windows/Linux/macOS
// paths are unit-tested on any host. No dependencies beyond node:*.
//
//   findChrome({env, platform, exists, which})              → path | null   (WORCA_CHROME → PATH → app/install paths)
//   findFfmpeg({env, platform, exists, which, resolveStatic}) → path | null (WORCA_FFMPEG → ffmpeg-static → PATH → usual paths)
//   toolHints(platform)                                     → { chrome, ffmpeg } install hints
//   which(name, {env, platform, exists})                    → path | null   (PATH, × PATHEXT on win32)
//   loadDep(name, {env})                                    → require()d module from worca's own node_modules
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const pathOf = (platform) => (platform === 'win32' ? path.win32 : path.posix);

/** Environment lookup; case-insensitive on win32 (an injected plain object is not, process.env is). */
function envGet(env, platform, name) {
  if (env[name] != null) return env[name];
  if (platform !== 'win32') return undefined;
  const k = Object.keys(env).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? env[k] : undefined;
}

/** First executable `name` on PATH (win32: each PATHEXT extension, `.EXE` style as PATHEXT spells it). */
export function which(name, { env = process.env, platform = process.platform, exists = isFile } = {}) {
  if (!name) return null;
  const P = pathOf(platform);
  const win = platform === 'win32';
  const exts = win ? String(envGet(env, platform, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const variants = (base) => {
    if (!win) return [base];
    const hasExt = exts.some((e) => base.toLowerCase().endsWith(e.toLowerCase()));
    return hasExt ? [base, ...exts.map((e) => base + e)] : exts.map((e) => base + e);
  };
  if (name.includes('/') || (win && name.includes('\\'))) {
    for (const c of variants(name)) if (exists(c)) return c;
    return null;
  }
  const dirs = String(envGet(env, platform, 'PATH') || '').split(win ? ';' : ':')
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
  for (const d of dirs) for (const c of variants(P.join(d, name))) if (exists(c)) return c;
  return null;
}

const CHROME_ON_PATH = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'msedge',
  'microsoft-edge', 'microsoft-edge-stable'];
const MAC_APPS = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Chromium.app/Contents/MacOS/Chromium',
  'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
const LINUX_CHROMES = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/snap/bin/chromium', '/opt/google/chrome/chrome', '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'];

/** Windows install roots: %ProgramFiles%, %ProgramFiles(x86)%, %LocalAppData% (+ the stock defaults). */
function winRoots(env) {
  const g = (n) => envGet(env, 'win32', n);
  return [...new Set([g('ProgramFiles'), g('ProgramFiles(x86)'), g('LOCALAPPDATA'), 'C:\\Program Files', 'C:\\Program Files (x86)'].filter(Boolean))];
}

/** A Chrome-family browser for headless rendering, or null. */
export function findChrome({ env = process.env, platform = process.platform, exists = isFile, which: w } = {}) {
  const override = envGet(env, platform, 'WORCA_CHROME');
  if (override && exists(override)) return override;
  const lookup = w || ((n) => which(n, { env, platform, exists }));
  for (const n of CHROME_ON_PATH) { const p = lookup(n); if (p) return p; }
  const P = pathOf(platform);
  let candidates = [];
  if (platform === 'darwin') {
    const home = envGet(env, platform, 'HOME');
    candidates = [...MAC_APPS.map((a) => `/Applications/${a}`), ...(home ? MAC_APPS.map((a) => P.join(home, 'Applications', a)) : [])];
  } else if (platform === 'win32') {
    const roots = winRoots(env);
    candidates = [...roots.map((r) => P.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')),
      ...roots.map((r) => P.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))];
  } else candidates = LINUX_CHROMES;
  return candidates.find((c) => exists(c)) || null;
}

/** ffmpeg-static's binary path from worca's own node_modules (null when not installed / not downloaded). */
function defaultResolveStatic(env) {
  try { return loadDep('ffmpeg-static', { env }) || null; } catch { return null; }
}

/** An ffmpeg binary, or null. */
export function findFfmpeg({ env = process.env, platform = process.platform, exists = isFile, which: w, resolveStatic } = {}) {
  const override = envGet(env, platform, 'WORCA_FFMPEG');
  if (override && exists(override)) return override;
  let stat = null;
  try { stat = (resolveStatic || (() => defaultResolveStatic(env)))(); } catch { stat = null; }
  if (stat && exists(stat)) return stat;
  const lookup = w || ((n) => which(n, { env, platform, exists }));
  const onPath = lookup('ffmpeg');
  if (onPath) return onPath;
  const P = pathOf(platform);
  let candidates;
  if (platform === 'darwin') candidates = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  else if (platform === 'win32') {
    const local = envGet(env, platform, 'LOCALAPPDATA');
    candidates = [...(local ? [P.join(local, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe')] : []),
      ...winRoots(env).map((r) => P.join(r, 'ffmpeg', 'bin', 'ffmpeg.exe'))];
  } else candidates = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/snap/bin/ffmpeg'];
  return candidates.find((c) => exists(c)) || null;
}

/** One-line install hints for a missing tool on `platform`. */
export function toolHints(platform = process.platform) {
  if (platform === 'win32') return {
    chrome: 'Install Google Chrome or Microsoft Edge, or set WORCA_CHROME to chrome.exe / msedge.exe',
    ffmpeg: 'winget install Gyan.FFmpeg (then open a new terminal), or set WORCA_FFMPEG to ffmpeg.exe',
  };
  if (platform === 'darwin') return {
    chrome: 'Install Google Chrome (or Microsoft Edge / Chromium), or set WORCA_CHROME to its binary',
    ffmpeg: 'brew install ffmpeg, or set WORCA_FFMPEG to an ffmpeg binary',
  };
  return {
    chrome: 'Install Chromium or Google Chrome (e.g. sudo apt install chromium), or set WORCA_CHROME to its binary',
    ffmpeg: 'sudo apt install ffmpeg (or your distro\'s package), or set WORCA_FFMPEG to an ffmpeg binary',
  };
}

/** worca's package root from the `worca` command on PATH (npm global install: symlink or Windows shim). */
function worcaRootsFromCli(env) {
  const out = [];
  try {
    const cli = which('worca', { env });
    if (!cli) return out;
    if (process.platform === 'win32') out.push(path.join(path.dirname(cli), 'node_modules', '@worca', 'app'));
    let dir = path.dirname(realpathSync(cli));
    for (let i = 0; i < 6; i++) {
      const pkg = path.join(dir, 'package.json');
      if (existsSync(pkg)) { try { if (JSON.parse(readFileSync(pkg, 'utf8')).name === '@worca/app') { out.push(dir); break; } } catch { /* keep walking */ } }
      const up = path.dirname(dir); if (up === dir) break; dir = up;
    }
  } catch { /* best effort */ }
  return out;
}

/**
 * require() a worca dependency (playwright-core, ffmpeg-static) from wherever this kit file runs:
 * next to the kit (worca's checkout/install), then $WORCA_APP_ROOT, then $npm_package_json (when it is worca's),
 * then the `worca` CLI's package, then cwd.
 * A staged copy of the kit (<run>/promo-kit/) has no node_modules of its own — this is what finds them.
 */
export function loadDep(name, { env = process.env } = {}) {
  const bases = [import.meta.url];
  // a STAGED kit (<run>/promo-kit/) carries worca's package root in .worca-app-root (written by run-assets stageAssets)
  try {
    const marker = fileURLToPath(new URL('../.worca-app-root', import.meta.url));
    if (existsSync(marker)) { const root = readFileSync(marker, 'utf8').trim(); if (root) bases.push(pathToFileURL(path.join(root, 'package.json')).href); }
  } catch { /* no marker: a repo copy */ }
  if (env.WORCA_APP_ROOT) bases.push(pathToFileURL(path.join(env.WORCA_APP_ROOT, 'package.json')).href);
  // a server started with `npm start` from a checkout hands its children npm_package_json
  if (env.npm_package_json && /package\.json$/.test(env.npm_package_json)) {
    try { if (JSON.parse(readFileSync(env.npm_package_json, 'utf8')).name === '@worca/app') bases.push(pathToFileURL(env.npm_package_json).href); } catch { /* not worca */ }
  }
  for (const r of worcaRootsFromCli(env)) bases.push(pathToFileURL(path.join(r, 'package.json')).href);
  bases.push(pathToFileURL(path.join(process.cwd(), 'package.json')).href);
  let last;
  for (const b of bases) {
    try { return createRequire(b)(name); } catch (e) { last = e; }
  }
  throw new Error(`cannot load ${name} (${last && last.code ? last.code : 'not found'}): run the kit from worca's install, or set WORCA_APP_ROOT to worca's package directory`);
}
