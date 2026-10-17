// scripts/c4-raster.mjs — SVG → JPEG/PNG for the c4Render card, through a headless Chrome-family
// browser driven over the DevTools protocol with Node's own WebSocket. No Playwright, no npm
// dependency, no shell: the browser is found by path on macOS, Windows and Linux (WORCA_CHROME
// overrides), launched with `--remote-debugging-port=0`, and its port read back from the
// DevToolsActivePort file it writes into the throwaway profile — the one handshake that works the
// same on every OS. The page embeds worca's own webfonts, so a JPEG matches the screen.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const FONTS_DIR = new URL('../ui/public/fonts/', import.meta.url);
const FONT_FILES = [
  ['Poppins', 400, 'poppins-latin-400-normal.woff2'], ['Poppins', 500, 'poppins-latin-500-normal.woff2'],
  ['Poppins', 600, 'poppins-latin-600-normal.woff2'], ['Poppins', 700, 'poppins-latin-700-normal.woff2'],
  ['JetBrains Mono', 400, 'jetbrains-mono-latin-400-normal.woff2'],
];

/** Candidate browser executables for this OS, most specific first. Pure apart from env reads. */
export function browserCandidates(platform = process.platform, env = process.env) {
  const out = [];
  if (env.WORCA_CHROME) out.push(env.WORCA_CHROME);
  if (env.WORCA_C4_CHROMIUM) out.push(env.WORCA_C4_CHROMIUM);
  if (platform === 'darwin') {
    for (const app of ['Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser', 'Google Chrome Canary']) {
      out.push(`/Applications/${app}.app/Contents/MacOS/${app}`);
      if (env.HOME) out.push(join(env.HOME, 'Applications', `${app}.app`, 'Contents', 'MacOS', app));
    }
  } else if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    for (const r of roots) {
      out.push(join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      out.push(join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      out.push(join(r, 'Chromium', 'Application', 'chrome.exe'));
    }
  }
  const names = platform === 'win32'
    ? ['chrome.exe', 'msedge.exe', 'chromium.exe']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'chrome'];
  for (const dir of String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean)) {
    for (const n of names) out.push(join(dir, n));
  }
  return out;
}

/** The first candidate that exists as a file, or null. */
export function findBrowser(platform = process.platform, env = process.env) {
  for (const p of browserCandidates(platform, env)) {
    try { if (p && existsSync(p) && statSync(p).isFile()) return p; } catch { /* next */ }
  }
  return null;
}

/** Why there are no images, in the words that fix it: the slim container image ships no browser. */
export function noBrowserReason(env = process.env) {
  if (env.WORCA_CONTAINER === '1') return 'no browser in this image: run the -full image (it ships Chromium) or set WORCA_CHROME';
  return 'no Chrome, Chromium or Edge found (set WORCA_CHROME to its executable)';
}

function fontFaces() {
  const faces = [];
  for (const [family, weight, file] of FONT_FILES) {
    try {
      const b64 = readFileSync(new URL(file, FONTS_DIR)).toString('base64');
      faces.push(`@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${b64}) format('woff2')}`);
    } catch { /* a missing font falls back to the system's */ }
  }
  return faces.join('');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPort(profile, child, timeoutMs) {
  const file = join(profile, 'DevToolsActivePort');
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`the browser exited (code ${child.exitCode}) before it opened its debugging port`);
    try {
      const [port, path] = readFileSync(file, 'utf8').split(/\r?\n/);
      if (port && path) return `ws://127.0.0.1:${port.trim()}${path.trim()}`;
    } catch { /* not written yet */ }
    await sleep(50);
  }
  throw new Error('the browser did not open its debugging port in time');
}

/** A minimal CDP client over one browser-level WebSocket, flattened sessions. */
function cdpClient(ws) {
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.method) for (const l of listeners) l(msg);
  });
  return {
    send(method, params = {}, sessionId) {
      const n = ++id;
      ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
      return new Promise((resolve, reject) => pending.set(n, { resolve, reject }));
    },
    once(method, sessionId) {
      return new Promise((resolve) => {
        const l = (m) => { if (m.method === method && (!sessionId || m.sessionId === sessionId)) { listeners.delete(l); resolve(m.params); } };
        listeners.add(l);
      });
    },
  };
}

/**
 * Open a headless browser for a batch of captures. Returns null (with `reason`) when no browser
 * is available or it will not start, so the caller ships SVG and says why.
 * @returns {Promise<{capture(svg:string, o:{width:number,height:number,scale:number,format:'jpeg'|'png',background:string}):Promise<Buffer>, close():Promise<void>}|{reason:string}>}
 */
export async function openRaster({ timeoutMs = 20000 } = {}) {
  if (typeof WebSocket !== 'function') return { reason: 'this Node has no WebSocket (needs Node 22+)' };
  const exe = findBrowser();
  if (!exe) return { reason: noBrowserReason() };
  const profile = mkdtempSync(join(tmpdir(), 'worca-c4-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--use-mock-keychain', '--password-store=basic', 'about:blank'];   // never the macOS login keychain (a temp HOME raises a dialog)
  if (process.platform === 'linux' && (process.getuid?.() === 0 || process.env.CHROME_NO_SANDBOX === '1')) args.unshift('--no-sandbox', '--disable-dev-shm-usage');
  const child = spawn(exe, args, { stdio: 'ignore', windowsHide: true });
  const cleanup = async () => {
    try { child.kill(); } catch { /* gone */ }
    for (let i = 0; i < 20 && child.exitCode === null; i += 1) await sleep(50);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows may hold a lock briefly */ }
  };
  let ws;
  try {
    const url = await waitForPort(profile, child, timeoutMs);
    ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('could not connect to the browser')), { once: true }); });
  } catch (e) {
    await cleanup();
    return { reason: `${exe}: ${e.message}` };
  }
  const cdp = cdpClient(ws);
  const faces = fontFaces();
  return {
    exe,
    async capture(svg, { width, height, scale = 2, format = 'jpeg', background = '#FBFBF9' }) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      try {
        const w = Math.max(1, Math.ceil(width)); const h = Math.max(1, Math.ceil(height));
        await cdp.send('Page.enable', {}, sessionId);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: false }, sessionId);
        const { frameTree } = await cdp.send('Page.getFrameTree', {}, sessionId);
        const html = `<!doctype html><html><head><meta charset="utf-8"><style>${faces}html,body{margin:0;background:${background}}svg{display:block}</style></head><body>${svg}</body></html>`;
        await cdp.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html }, sessionId);
        // the fonts are data: URLs, so this resolves as soon as they are decoded
        await cdp.send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true }, sessionId);
        const shot = await cdp.send('Page.captureScreenshot', {
          format, ...(format === 'jpeg' ? { quality: 85 } : {}),
          clip: { x: 0, y: 0, width: w, height: h, scale: 1 }, captureBeyondViewport: true,
        }, sessionId);
        return Buffer.from(shot.data, 'base64');
      } finally {
        await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
      }
    },
    async close() {
      try { await cdp.send('Browser.close'); } catch { /* already gone */ }
      try { ws.close(); } catch { /* closed */ }
      await cleanup();
    },
  };
}
