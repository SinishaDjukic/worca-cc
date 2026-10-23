import os from 'node:os';
// Minimal headless-Chrome driver over CDP — no dependencies (Node ≥ 22: global WebSocket). Used by snap, fluency,
// sheet and export. Each launch() gets its own browser process + temp profile; close() ends only that process tree.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { findChrome, toolHints } from './find-tools.mjs';

/** Chrome's environment: the REAL home dir even when the caller sandboxed HOME (tests, runs). On macOS a Chrome with a
 *  temp HOME finds no keychain (system dialog per launch) and may never answer Page.navigate. */
export function chromeEnv(env = process.env) {
  let home = env.HOME;
  try { home = os.userInfo().homedir || home; } catch { /* no passwd entry: keep HOME */ }
  return process.platform === 'win32' ? { ...env } : { ...env, HOME: home };
}

/** Flags EVERY kit Chrome launch carries (cdp launch() and capture/lib.mjs open()): never touch the login keychain —
 *  a Chrome started under a temp HOME raises a macOS "Keychain Not Found" dialog on the user's screen per launch. */
export const CHROME_SAFE_ARGS = ['--use-mock-keychain', '--password-store=basic'];

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Worca's local corporate proxy for a browser launch, or null. WORCA_CORPORATE_PROXY_URL is set only while
 *  Worca's corporateProxy flag runs the proxy (a credential-free http://127.0.0.1 URL). Chrome ignores
 *  HTTPS_PROXY on macOS and Windows, so launches pass it explicitly. Loopback goes direct anyway (Chrome's
 *  implicit bypass); other NO_PROXY hosts are passed on as the bypass list. */
export function chromeProxy(env = process.env) {
  let u;
  try { u = new URL(String(env.WORCA_CORPORATE_PROXY_URL || '')); } catch { return null; }
  if (u.protocol !== 'http:' || u.username || u.password || !u.port || !LOOPBACK_HOSTS.has(u.hostname)) return null;
  const np = String(env.NO_PROXY ?? env.no_proxy ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  if (np.includes('*')) return null;
  const bypass = np.filter((h) => !LOOPBACK_HOSTS.has(h));
  return { server: `http://${u.host}`, ...(bypass.length ? { bypass: bypass.join(',') } : {}) };
}

/** chromeProxy() as Chrome flags, for a raw spawn (launch()). */
export function chromeProxyArgs(env = process.env) {
  const p = chromeProxy(env);
  return p ? [`--proxy-server=${p.server}`, ...(p.bypass ? [`--proxy-bypass-list=${p.bypass.split(',').join(';')}`] : [])] : [];
}

/** The argv launch() starts Chrome with (minus the about:blank URL and the Linux no-sandbox retry). */
export function chromeArgs({ dir, width = 1920, height = 1080, platform = process.platform, env = process.env } = {}) {
  const args = [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--force-color-profile=srgb', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-extensions',
    '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required', `--window-size=${width},${height}`,
    ...chromeProxyArgs(env), ...CHROME_SAFE_ARGS,
  ];
  if (platform === 'linux') args.push('--disable-dev-shm-usage');
  return args;
}

/** Launch headless Chrome with a width×height viewport at deviceScaleFactor `scale`. */
export async function launch({ width = 1920, height = 1080, scale = 1, chrome } = {}) {
  const exe = chrome || findChrome();
  if (!exe) throw new Error('no Chrome-family browser found: ' + toolHints().chrome);
  const dir = mkdtempSync(join(tmpdir(), 'promo-chrome-'));
  const args = chromeArgs({ dir, width, height });
  // root in a container, or a host whose user namespaces are locked down (CHROME_NO_SANDBOX=1, as CI sets it)
  const noSandbox = (typeof process.getuid === 'function' && process.getuid() === 0) || process.env.CHROME_NO_SANDBOX === '1';
  const portFile = join(dir, 'DevToolsActivePort');
  let proc, exited = false, port, wsPath;
  const kill = () => {
    if (process.platform === 'win32') { try { spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* gone */ } }
    try { proc.kill('SIGKILL'); } catch { /* gone */ }
  };
  async function start(extra) {
    exited = false;
    proc = spawn(exe, [...args, ...extra, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true, env: chromeEnv() });
    proc.once('exit', () => { exited = true; });
    proc.once('error', () => { exited = true; });
    for (let i = 0; i < 600 && !port && !exited; i++) {
      if (existsSync(portFile)) {
        const [p, w] = readFileSync(portFile, 'utf8').split('\n');
        if (p && w) { port = p.trim(); wsPath = w.trim(); }
      }
      if (!port) await sleep(50);
    }
    if (!port) kill();
  }
  await start(noSandbox ? ['--no-sandbox'] : []);
  // Linux: a browser that dies at once without a usable sandbox (AppArmor user-namespace limits) gets one retry without it
  if (!port && exited && !noSandbox && process.platform === 'linux') await start(['--no-sandbox']);
  if (!port) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {} throw new Error(`Chrome did not start (${exe})`); }

  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP socket failed')); });
  let id = 0;
  const pending = new Map(), listeners = new Set();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      if (m.error) rej(new Error(m.error.message)); else res(m.result);
    } else if (m.method) for (const l of listeners) l(m);
  };
  ws.onclose = () => { for (const { rej } of pending.values()) rej(new Error('CDP socket closed')); pending.clear(); };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (m, p) => send(m, p, sessionId);
  await page('Page.enable');
  await page('Runtime.enable');
  const setViewport = (w, h, s) => page('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: s, mobile: false });
  await setViewport(width, height, scale);

  const logs = [];
  listeners.add((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push(`exception: ${(d.exception && d.exception.description) || d.text}`);
    }
  });

  async function evaluate(expression) {
    const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  }
  async function goto(url) {
    const loaded = new Promise((res) => {
      const l = (m) => { if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { listeners.delete(l); res(); } };
      listeners.add(l);
    });
    await page('Page.navigate', { url });
    await loaded;
  }
  async function capture({ format = 'jpeg', quality = 88, clip } = {}) {
    const p = format === 'jpeg' ? { format, quality } : { format };
    if (clip) Object.assign(p, { clip: { scale: 1, ...clip }, captureBeyondViewport: true });
    const r = await page('Page.captureScreenshot', p);
    return Buffer.from(r.data, 'base64');
  }
  async function close() {
    try { await Promise.race([send('Browser.close'), sleep(1500)]); } catch {}
    try { ws.close(); } catch {}
    for (let i = 0; i < 20 && !exited; i++) await sleep(50);
    if (!exited) kill();
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
  return { send, page, evaluate, goto, capture, close, setViewport, logs, pid: proc.pid };
}

/** Open a built film (…/film/index.html) in export mode and wait until it is ready. Returns { seek(t), violations }. */
export async function openFilm(browser, htmlPath, extra = '') {
  if (!htmlPath) throw new Error('openFilm: the film html path is required');
  await browser.goto(pathToFileURL(resolve(htmlPath)).href + '?export=1' + (extra ? '&' + extra : ''));
  const ok = await browser.evaluate('(async () => { for (let i = 0; i < 2400 && !window.__film; i++) await new Promise(r => setTimeout(r, 25)); return window.__film ? window.__film.ready : false })()');
  if (!ok) throw new Error('film did not become ready (window.__film missing): ' + [...new Set(browser.logs)].slice(0, 5).join(' | '));
  const violations = await browser.evaluate('window.__film.violations || []');
  return {
    violations,
    /** Seek to film time t and wait two frames so the capture shows it. */
    seek: (t) => browser.evaluate(`(async () => { await window.__film.seek(${Number(t)}); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))); return true })()`),
  };
}

/** Default parallelism for frame work: max(1, cpus − 2), at most 8. */
export async function defaultWorkers() {
  const { availableParallelism, cpus } = await import('node:os');
  const n = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
  return Math.min(8, Math.max(1, n - 2));
}

/** Tiny argv parser shared by the CLIs: --key value | --flag. */
export function parseArgs(argv) {
  const A = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) A[k] = true; else { A[k] = v; i++; } }
    else A._.push(argv[i]);
  }
  return A;
}
