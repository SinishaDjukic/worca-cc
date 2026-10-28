// promo-kit/capture/lib.mjs — capture the product's REAL UI, one component at a time, as transparent PNG "plates",
// and run the app in a sandbox while you do. playwright-core drives a system Chrome/Edge (tools/find-tools.mjs).
//
//   import { startApp, open, Plate, unisolate } from '<run>/promo-kit/capture/lib.mjs';
//   const app = await startApp({ cmd: 'npm', args: ['run', 'dev', '--', '--port', '$PORT'], cwd: repo, readyUrl: 'http://127.0.0.1:$PORT/' });
//   const { page, go, close } = await open({ url: app.url, dsf: 3, promoDir: '<run>/promo' });
//   await go('/settings');                                   // path, '#hash' or full URL; waits for load + fonts
//   const p = await Plate.begin(page, 'hook-composer', { target: '.composer', pad: 28, desc: 'Composer box',
//     anchors: { send: '.composer button[type=submit]' } });
//   await p.shot('empty');  …interact with the real UI (unisolate(page) first)…  await p.shot('typed');
//   await p.seq('spinner', { frames: 30, fps: 30 });         // steps the page's own CSS/WAAPI animations
//   p.save();                                                // merges into <promo>/plates/manifest.json
//   await close(); await app.stop();
//
// Every state of a plate shares ONE clip (fixed at begin), so crossfades line up. Only the target's subtree is
// painted (everything else visibility:hidden, page backgrounds transparent), so the PNG has alpha and no app chrome.
import { spawn, spawnSync } from 'node:child_process';
import { chromeEnv, chromeProxy, CHROME_SAFE_ARGS } from '../tools/cdp.mjs';
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync, renameSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir, userInfo, homedir } from 'node:os';
import { join, dirname, resolve, posix } from 'node:path';
import { findChrome, loadDep, toolHints, which } from '../tools/find-tools.mjs';

export const FREEZE_CSS = '*,*::before,*::after{transition:none!important;caret-color:transparent!important}';
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const promoDirOf = new WeakMap();   // page → promoDir given to open()

/* ---------------- leak guard ---------------- */

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// service/container accounts are not identities (a hosted app running as "node" or "app" must still be filmable)
const SERVICE_USERS = new Set(['root', 'admin', 'administrator', 'user', 'node', 'runner', 'ubuntu', 'app', 'nobody', 'daemon',
  'www-data', 'docker', 'default', 'guest', 'worca', 'runneradmin', 'ec2-user', 'vscode', 'codespace']);
/** Default deny list: the OS user name (unless a service account) and home directory of whoever runs the capture. */
export function defaultDeny() {
  const out = [];
  try { const u = userInfo().username; if (!SERVICE_USERS.has(String(u).toLowerCase())) out.push(u); } catch { /* no passwd entry */ }
  try { out.push(homedir()); } catch { /* none */ }
  return out.filter(Boolean);
}

/**
 * Throw if `text` contains a real identity: a deny entry with a path separator matches as a substring (either slash
 * style, case-insensitive); any other entry ≥ 3 chars matches as a whole word. The error never repeats the match.
 */
export function leakGuard(text, deny = defaultDeny()) {
  const t = String(text ?? '');
  const lower = t.toLowerCase().replace(/\\/g, '/');
  for (const d of deny || []) {
    const s = String(d || '').trim();
    if (s.length < 3) continue;
    if (/[\\/]/.test(s)) {
      if (lower.includes(s.toLowerCase().replace(/\\/g, '/'))) throw new Error('leak guard hit: a real home/user path is on screen');
    } else if (new RegExp(`(^|[^\\p{L}\\p{N}_])${esc(s)}($|[^\\p{L}\\p{N}_])`, 'iu').test(t)) {
      throw new Error('leak guard hit: a real identity is on screen');
    }
  }
}

/* ---------------- browser ---------------- */

/** Playwright launch options for the system Chrome: keychain-safe flags, the real HOME, and (corporate
 *  proxy on) Worca's local proxy as proxy.server. */
export function launchOptions(exe, env = process.env) {
  const proxy = chromeProxy(env);
  return { executablePath: exe, headless: true, env: chromeEnv(env),
    args: ['--force-color-profile=srgb', '--hide-scrollbars', ...CHROME_SAFE_ARGS], ...(proxy ? { proxy } : {}) };
}

/**
 * Launch headless Chrome (playwright-core, system browser) and load `url`. Returns { browser, ctx, page, go, close, url }.
 * `promoDir` is remembered for Plate.begin(page, …) so plates land in <promoDir>/plates/.
 */
export async function open({ url, dsf = 3, width = 1600, height = 1000, chrome, promoDir, colorScheme = 'light' } = {}) {
  const exe = chrome || findChrome();
  if (!exe) throw new Error('no Chrome-family browser found: ' + toolHints().chrome);
  const { chromium } = loadDep('playwright-core');
  const browser = await chromium.launch(launchOptions(exe));
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf, colorScheme, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.warn('[page error]', e.message));
  if (promoDir) promoDirOf.set(page, resolve(promoDir));
  let booted = false;
  /** Navigate: a full URL, a path relative to `url`, or '#hash' (set on the loaded app; reload:true reloads). */
  async function go(route = '', { wait = 500, reload = false, waitFor = null, timeout = 30000 } = {}) {
    if (route.startsWith('#') && booted) {
      await page.evaluate((h) => { location.hash = h; }, route.slice(1));
      if (reload) await page.reload({ waitUntil: 'load' });
    } else {
      const target = /^[a-z]+:/i.test(route) ? route : new URL(route, url).href;
      await page.goto(target, { waitUntil: 'load', timeout });
      booted = true;
    }
    if (waitFor) await page.waitForSelector(waitFor, { timeout });
    await page.evaluate(() => document.fonts.ready);
    if (wait) await page.waitForTimeout(wait);
  }
  const close = async () => { await browser.close().catch(() => {}); };
  if (url) { try { await go(url); } catch (e) { await close(); throw e; } }
  return { browser, ctx, page, go, close, url };
}

/** Rect of a selector (first match, or the union of all matches with all:true) in page CSS px. */
async function rectOf(page, sel, all = false) {
  return page.evaluate(([s, a]) => {
    const els = a ? [...document.querySelectorAll(s)] : [document.querySelector(s)].filter(Boolean);
    if (!els.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of els) { const r = e.getBoundingClientRect(); x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
    return { x: x0 + scrollX, y: y0 + scrollY, w: x1 - x0, h: y1 - y0 };
  }, [sel, all]);
}

/* ---------------- plates ---------------- */

export class Plate {
  /**
   * @param name    `<sceneId>-<component>` (letters, digits, . _ -)
   * @param target  CSS selector of the component (or an array: the union of several elements is kept + clipped)
   * @param pad     transparent margin around the target (CSS px) so its shadow survives
   * @param clip    optional explicit clip {x,y,w,h} in page CSS px (overrides target rect + pad)
   * @param card    optional presentational frame for components that normally sit on a panel:
   *                { bg:'#fff', radius:16, shadow:true, padding, border } applied to the (first) target element
   * @param anchors { name: selector } → rects relative to the clip, recorded at begin (re-record with anchor())
   * @param keepAlso extra selectors painted with the target (e.g. a popover rendered elsewhere in the DOM)
   * @param promoDir where plates/ lives (default: the promoDir given to open())
   * @param deny    leak-guard deny list (default: OS user name + home dir)
   */
  static async begin(page, name, { target, pad = 28, dsf = 3, desc = '', clip = null, card = null, anchors = {}, keepAlso = [], promoDir, deny } = {}) {
    if (!SAFE_NAME.test(String(name))) throw new Error(`plate name "${name}" must be letters, digits, . _ - (use <sceneId>-<component>)`);
    const dir = promoDir ? resolve(promoDir) : promoDirOf.get(page);
    if (!dir) throw new Error(`plate ${name}: no promoDir (pass it to open() or Plate.begin())`);
    const p = new Plate(page, name, { target, pad, dsf, desc, card, keepAlso, promoDir: dir, deny });
    await p.isolate();
    const targets = Array.isArray(target) ? target : [target];
    let r = clip;
    if (!r) {
      const rs = (await Promise.all(targets.map((s) => rectOf(page, s)))).filter(Boolean);
      if (!rs.length) throw new Error(`plate ${name}: target not found: ${targets.join(', ')}`);
      const x0 = Math.min(...rs.map((q) => q.x)), y0 = Math.min(...rs.map((q) => q.y));
      const x1 = Math.max(...rs.map((q) => q.x + q.w)), y1 = Math.max(...rs.map((q) => q.y + q.h));
      r = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
    }
    // integer CSS px so PNG pixels = w*dsf exactly
    p.clip = { x: Math.floor(r.x), y: Math.floor(r.y), w: Math.ceil(r.w), h: Math.ceil(r.h) };
    for (const [k, s] of Object.entries(anchors)) await p.anchor(k, s);
    return p;
  }
  constructor(page, name, o) {
    Object.assign(this, { page, name, ...o });
    this.meta = { desc: o.desc, dsf: o.dsf, pad: o.pad, states: {}, anchors: {}, seqs: {} };
    mkdirSync(join(this.promoDir, 'plates', name), { recursive: true });
  }
  /** Paint only the target subtree (+ keepAlso selectors); transparent page; frozen transitions. Idempotent. */
  async isolate() {
    const targets = (Array.isArray(this.target) ? this.target : [this.target]).concat(this.keepAlso || []);
    await this.page.evaluate(([sels, card, freeze]) => {
      let st = document.getElementById('promo-isolate');
      if (!st) { st = document.createElement('style'); st.id = 'promo-isolate'; document.head.appendChild(st); }
      st.textContent = `${freeze}
        html, body, #app, #root, .app, main { background: transparent !important; background-image: none !important; }
        body * { visibility: hidden !important; }
        [data-promo-keep], [data-promo-keep] * { visibility: visible !important; }
        [data-promo-keep] [hidden], [data-promo-keep] .hidden { visibility: hidden !important; }
        ::-webkit-scrollbar { display: none !important; }`;
      document.querySelectorAll('[data-promo-keep]').forEach((e) => e.removeAttribute('data-promo-keep'));
      for (const s of sels) document.querySelectorAll(s).forEach((e) => e.setAttribute('data-promo-keep', ''));
      if (card) {
        const e = document.querySelector(sels[0]);
        if (e) Object.assign(e.style, { background: card.bg || '#fff', borderRadius: (card.radius ?? 16) + 'px',
          boxShadow: card.shadow === false ? 'none' : '0 1px 2px rgba(16,16,20,.06), 0 18px 40px -18px rgba(16,16,20,.28)',
          ...(card.padding != null ? { padding: card.padding + 'px' } : {}), ...(card.border ? { border: card.border } : {}) });
      }
    }, [targets, this.card, FREEZE_CSS]);
  }
  /** Record anchor `name` = rect of `sel` relative to the clip (CSS px). */
  async anchor(name, sel, { all = false } = {}) {
    const r = await rectOf(this.page, sel, all);
    if (!r) { console.warn(`plate ${this.name}: anchor ${name} not found (${sel})`); return null; }
    const a = { x: +(r.x - this.clip.x).toFixed(1), y: +(r.y - this.clip.y).toFixed(1), w: +r.w.toFixed(1), h: +r.h.toFixed(1) };
    this.meta.anchors[name] = a;
    return a;
  }
  async _check() {
    const text = await this.page.evaluate(() => {
      const keep = [...document.querySelectorAll('[data-promo-keep]')];
      return keep.map((e) => e.innerText + ' ' + [...e.querySelectorAll('input,textarea')].map((i) => i.value).join(' ')
        + ' ' + [...e.querySelectorAll('img[alt],[title]')].map((i) => i.getAttribute('alt') || i.getAttribute('title')).join(' ')).join('\n');
    });
    try { leakGuard(text, this.deny ?? defaultDeny()); } catch (e) { throw new Error(`plate ${this.name}: ${e.message}`); }
  }
  _shotOpts(rel) {
    return { path: join(this.promoDir, ...rel.split('/')), clip: { x: this.clip.x, y: this.clip.y, width: this.clip.w, height: this.clip.h }, omitBackground: true, animations: 'allow' };
  }
  /** Screenshot the fixed clip as state `state`. Re-isolates first (the app may re-render). Returns the manifest path. */
  async shot(state, { settle = 120, check = true } = {}) {
    if (!SAFE_NAME.test(String(state))) throw new Error(`plate ${this.name}: state "${state}" must be letters, digits, . _ -`);
    await this.isolate();
    if (settle) await this.page.waitForTimeout(settle);
    if (check) await this._check();
    const file = posix.join('plates', this.name, `${state}.png`);
    await this.page.screenshot(this._shotOpts(file));
    this.meta.states[state] = { file, w: this.clip.w, h: this.clip.h };
    return file;
  }
  /** Capture `frames` frames of the page's own CSS/WAAPI animations, stepped deterministically at `fps`. */
  async seq(seqName, { frames = 30, fps = 30, loop = true, startMs = 0 } = {}) {
    if (!SAFE_NAME.test(String(seqName))) throw new Error(`plate ${this.name}: seq "${seqName}" must be letters, digits, . _ -`);
    await this.isolate();
    await this._check();
    const dir = posix.join('plates', this.name, seqName);
    mkdirSync(join(this.promoDir, ...dir.split('/')), { recursive: true });
    await this.page.evaluate(() => { window.__promoAnims = document.getAnimations(); window.__promoAnims.forEach((a) => { try { a.pause(); } catch {} }); });
    for (let k = 0; k < frames; k++) {
      await this.page.evaluate((ms) => { for (const a of window.__promoAnims) { try { a.currentTime = ms; } catch {} } }, startMs + (k * 1000) / fps);
      await this.page.waitForTimeout(16);
      await this.page.screenshot(this._shotOpts(posix.join(dir, String(k).padStart(4, '0') + '.png')));
    }
    await this.page.evaluate(() => { (window.__promoAnims || []).forEach((a) => { try { a.play(); } catch {} }); });
    this.meta.seqs[seqName] = { dir, count: frames, fps, loop, w: this.clip.w, h: this.clip.h };
    return dir;
  }
  /**
   * Merge this plate into the manifest (default <promoDir>/plates/manifest.json: {version:1, plates:{…}}).
   * Set `p.meta.extra = {…}` first for data a scene needs (wire paths, row positions): F.D.plates[name].extra.
   */
  save(manifestPath = join(this.promoDir, 'plates', 'manifest.json')) {
    mkdirSync(dirname(manifestPath), { recursive: true });
    let m = { version: 1, plates: {} };
    if (existsSync(manifestPath)) {
      try { const j = JSON.parse(readFileSync(manifestPath, 'utf8')); m = j.plates ? { ...j, version: j.version ?? 1 } : { version: 1, plates: j }; } catch { /* rewrite */ }
    }
    m.plates[this.name] = { ...this.meta };
    const tmp = `${manifestPath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(m, null, 1));
    renameSync(tmp, manifestPath);
    console.log(`plate ${this.name}: ${Object.keys(this.meta.states).join(', ')}${Object.keys(this.meta.seqs).length ? ' | seqs ' + Object.keys(this.meta.seqs).join(', ') : ''} ${this.clip.w}×${this.clip.h} @${this.dsf}x`);
    return manifestPath;
  }
}

/** Remove the isolation (to interact with the page normally between shots). */
export async function unisolate(page) {
  await page.evaluate(() => { document.getElementById('promo-isolate')?.remove(); document.querySelectorAll('[data-promo-keep]').forEach((e) => e.removeAttribute('data-promo-keep')); });
}

/* ---------------- app runner ---------------- */

/** A free TCP port on 127.0.0.1. */
export function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  });
}

const live = new Set();   // running apps: killed on process exit too
process.on('exit', () => { for (const a of live) a.killNow(); });

/** Kill a process tree: POSIX = the child's own process group; win32 = taskkill /T /F. Synchronous, never throws. */
function killTree(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    if (child && process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group gone */ } }
    return;
  }
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* best effort */ }
    try { child.kill('SIGKILL'); } catch { /* gone */ }
    return;
  }
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* gone */ } }
}

/** POSIX: wait until no process of the child's group is left, at most `ms` — a signalled grandchild still holds its
 *  port until it has died. A zombie still counts, so the wait stays bounded. win32: taskkill /T /F has already waited. */
async function treeGone(child, ms = 3000) {
  if (!child || process.platform === 'win32') return;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { process.kill(-child.pid, 0); } catch (e) { if (e.code === 'ESRCH') return; }   // EPERM: still there
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * argv for spawn (never a shell string): on win32 a .cmd/.bat shim (npm, npx, pnpm…) can only run through cmd.exe,
 * so it becomes `cmd.exe /d /s /c "<quoted line>"` with verbatim arguments; everything else is spawned directly.
 */
export function spawnArgv(cmd, args = [], { env = process.env, platform = process.platform, exists } = {}) {
  if (platform !== 'win32') return { file: cmd, args, verbatim: false };
  const resolved = which(cmd, { env, platform, ...(exists ? { exists } : {}) }) || cmd;
  if (!/\.(cmd|bat)$/i.test(resolved)) return { file: resolved, args, verbatim: false };
  const q = (a) => (/[\s"&|<>^()%!]/.test(a) || a === '' ? `"${String(a).replace(/"/g, '""')}"` : a);
  const comspec = Object.entries(env).find(([k]) => k.toLowerCase() === 'comspec')?.[1] || 'cmd.exe';
  return { file: comspec, args: ['/d', '/s', '/c', `"${[resolved, ...args].map(q).join(' ')}"`], verbatim: true };
}

/**
 * Start the app under test in a sandbox and wait until `readyUrl` answers (any status < 500).
 * - argv array (no shell); `$PORT` / `${PORT}` in args and readyUrl become the port; env PORT is set too
 * - HOME / USERPROFILE (and APPDATA/LOCALAPPDATA, XDG_* dirs) point into a fresh temp dir unless `env` provides HOME
 * - stop() kills the whole process tree (POSIX process group; win32 taskkill /T /F), returns once it is gone (its port is
 *   free; POSIX waits at most 3 s) and removes the temp HOME
 * @returns {Promise<{url:string, port:number, home:string, pid:number, output:()=>string, stop:()=>Promise<void>}>}
 */
export async function startApp({ cmd, args = [], cwd, env = {}, port, readyUrl, timeoutMs = 120000, onOutput } = {}) {
  if (!cmd) throw new Error('startApp: cmd is required');
  const p = port || await freePort();
  const sub = (s) => String(s).replace(/\$\{PORT\}|\$PORT\b/g, String(p));
  const own = env.HOME || env.USERPROFILE;
  const home = own || mkdtempSync(join(tmpdir(), 'promo-app-home-'));
  const base = { ...process.env };
  if (!own) {
    for (const k of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) delete base[k];
    Object.assign(base, { HOME: home, USERPROFILE: home });
    if (process.platform === 'win32') {
      Object.assign(base, { APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local') });
      mkdirSync(base.APPDATA, { recursive: true }); mkdirSync(base.LOCALAPPDATA, { recursive: true });
    }
  }
  const childEnv = { ...base, ...env, PORT: String(p) };
  if (own && !env.USERPROFILE) childEnv.USERPROFILE = own;
  if (own && !env.HOME) childEnv.HOME = own;
  const argv = spawnArgv(cmd, args.map(sub), { env: childEnv });
  const child = spawn(argv.file, argv.args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32', windowsHide: true, windowsVerbatimArguments: argv.verbatim });
  let out = '';
  const take = (d) => { const s = d.toString(); out = (out + s).slice(-8000); if (onOutput) onOutput(s); };
  child.stdout.on('data', take); child.stderr.on('data', take);
  const exited = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })));
  let spawnErr = null;
  child.once('error', (e) => { spawnErr = e; });
  const url = sub(readyUrl || `http://127.0.0.1:${p}/`);
  let stopped = false;
  const handle = {
    url, port: p, home, pid: child.pid,
    output: () => out,
    killNow: () => killTree(child, 'SIGKILL'),
    async stop() {
      if (stopped) return; stopped = true;
      live.delete(handle);
      if (child.exitCode === null && child.signalCode === null) {
        killTree(child, 'SIGTERM');
        const t = await Promise.race([exited.then(() => 'exit'), new Promise((r) => setTimeout(() => r('timeout'), 4000).unref())]);
        if (t === 'timeout') { killTree(child, 'SIGKILL'); await Promise.race([exited, new Promise((r) => setTimeout(r, 3000).unref())]); }
      }
      killTree(child, 'SIGKILL');   // POSIX: reap a grandchild that outlived its parent (the group stays addressable)
      await treeGone(child);        // ...and return once it has died, so its port is free
      if (!own) { try { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* locked on Windows: leave it */ } }
    },
  };
  live.add(handle);
  const deadline = Date.now() + timeoutMs;
  let done = null;
  exited.then((r) => { done = r; });
  while (true) {
    if (spawnErr) { await handle.stop(); throw new Error(`startApp: could not start ${cmd}: ${spawnErr.message}`); }
    if (done) { await handle.stop(); throw new Error(`startApp: ${cmd} exited (code ${done.code ?? done.signal}) before ${url} was ready\n${out.slice(-2000)}`); }
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
      if (r.status < 500) { await r.body?.cancel().catch(() => {}); return handle; }
    } catch { /* not up yet */ }
    if (Date.now() > deadline) { await handle.stop(); throw new Error(`startApp: ${url} not ready after ${Math.round(timeoutMs / 1000)} s\n${out.slice(-2000)}`); }
    await new Promise((r) => setTimeout(r, 250));
  }
}
