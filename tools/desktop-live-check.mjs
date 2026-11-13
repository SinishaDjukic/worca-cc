#!/usr/bin/env node
// tools/desktop-live-check.mjs — the macOS live check of the desktop window (docs/desktop.md "Run it from a checkout"):
// launch the app in a sandbox HOME with Electron through playwright-core and measure what jsdom cannot: the wordmark
// and the header controls clear the traffic lights, the drag strip is app-region: drag (its controls no-drag), the
// collapsed rail puts the lights above the mark, a double-click on the strip zooms and restores (or minimizes, as
// "Double-click a window's title bar to…" says), full screen drops the inset, and the Dock badge follows the page's
// "(N) " title and dotted favicon and clears on a reload. Not part of npm test: it needs a
// display and `npm ci --prefix desktop`. It never stops a process it did not start.
//   node tools/desktop-live-check.mjs                              # this checkout's app, its own server
//   node tools/desktop-live-check.mjs --reuse-old 0e006ee4d        # the app reuses an older worca server (no desktop CSS)
//   node tools/desktop-live-check.mjs --desktop-dir <dir>          # launch another desktop/ (e.g. a checkpoint copy)
//   node tools/desktop-live-check.mjs --os-click                   # also post a real OS double-click (CGEvent)
//   node tools/desktop-live-check.mjs --keep                       # keep the sandbox folder
// Output: one JSON line per check { check, ok, detail }, then a summary line. Exit 0 = every check passed, 1 = a check
// failed, 2 = a usage error, not macOS, or Electron missing.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TRAFFIC_LIGHTS, TRAFFIC_LIGHTS_SIZE, titleDoubleClickAction } from '../desktop/src/title-bar.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node tools/desktop-live-check.mjs [--reuse-old <git-ref>] [--desktop-dir <dir>] [--os-click] [--keep]';
const GAP = 8;            // px between the light group and the first header element
const RAIL_GAP = 4;       // px between the light group and the rail's mark

const usageError = (flag) => Object.assign(new Error(`unknown flag: ${flag}`), { code: 'USAGE' });

/** argv (after the script) → { reuseOld, desktopDir, osClick, keep }; throws { code: 'USAGE' } on anything else. */
export function parseLiveArgs(argv) {
  const out = { reuseOld: null, desktopDir: null, osClick: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--os-click') out.osClick = true;
    else if (a === '--keep') out.keep = true;
    else if (a === '--reuse-old' || a === '--desktop-dir') {
      const v = argv[i + 1];
      if (typeof v !== 'string' || !v || v.startsWith('--')) throw usageError(a);
      out[a === '--reuse-old' ? 'reuseOld' : 'desktopDir'] = v;
      i++;
    } else throw usageError(a);
  }
  return out;
}

/** True when `rect` starts right of the light group at `lights` plus `gap`. */
export function clearOfLights(rect, lights, size, gap) {
  return rect.left >= lights.x + size.width + gap;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeoutMs = 5000, stepMs = 100 } = {}) {
  const end = Date.now() + timeoutMs;
  let v;
  for (;;) {
    v = await fn();
    if (v || Date.now() >= end) return v;
    await sleep(stepMs);
  }
}

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); });
  });
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

/** The sandbox env: its own HOME, mock engines, this node for the server; no WORCA_HOME, PORT or host pid. */
function sandboxEnv(home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, WORCA_MOCK: '1', WORCA_DESKTOP_NODE: process.execPath };
  for (const k of ['WORCA_HOME', 'PORT', 'WORCA_HOST_PID', 'ELECTRON_RUN_AS_NODE']) delete env[k];
  return env;
}

/** `git archive <ref>` of this checkout into `dir`, node_modules linked; starts its ui/server.mjs on a free port. */
async function startOldServer({ ref, sandbox, env }) {
  const dir = join(sandbox, 'old');
  mkdirSync(dir, { recursive: true });
  const tar = spawnSync('git', ['-C', ROOT, 'archive', '--format=tar', ref], { maxBuffer: 1 << 30 });
  if (tar.status !== 0) throw new Error(`git archive ${ref} failed: ${String(tar.stderr).trim()}`);
  const x = spawnSync('tar', ['-x', '-C', dir], { input: tar.stdout, maxBuffer: 1 << 30 });
  if (x.status !== 0) throw new Error(`tar -x failed: ${String(x.stderr).trim()}`);
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  const uiFile = join(sandbox, '.worca-cc', 'ui.json');
  for (let attempt = 0; attempt < 2; attempt++) {
    const port = await freePort();
    const log = join(sandbox, `old-server-${attempt}.log`);
    const out = [];
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(dir, 'ui', 'server.mjs')], { cwd: dir, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => out.push(d));
    let exited = false;
    child.once('exit', () => { exited = true; writeFileSync(log, Buffer.concat(out)); });
    const ready = await waitFor(() => exited || (readJson(uiFile)?.pid === child.pid && readJson(uiFile)?.port === port), { timeoutMs: 60000, stepMs: 200 });
    if (ready && !exited) return { child, port, url: `http://127.0.0.1:${port}`, dir };
    if (!exited) { try { process.kill(child.pid); } catch { /* gone */ } }
    const text = Buffer.concat(out).toString();
    if (attempt === 0 && /installed dependencies do not match/i.test(text)) {
      rmSync(join(dir, 'node_modules'));
      const inst = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock'], { cwd: dir, env, stdio: 'ignore' });
      if (inst.status !== 0) throw new Error('npm install in the old copy failed');
      continue;
    }
    throw new Error(`the old server did not start (see ${log}): ${text.trim().split('\n').slice(-5).join(' | ')}`);
  }
  throw new Error('the old server did not start');
}

const SWIFT = `import CoreGraphics
import Foundation
let a = CommandLine.arguments
let p = CGPoint(x: Double(a[1])!, y: Double(a[2])!)
let src = CGEventSource(stateID: .hidSystemState)
CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(150000)
for n in 1...2 {
  for t in [CGEventType.leftMouseDown, CGEventType.leftMouseUp] {
    let e = CGEvent(mouseEventSource: src, mouseType: t, mouseCursorPosition: p, mouseButton: .left)!
    e.setIntegerValueField(.mouseEventClickState, value: Int64(n))
    e.post(tap: .cghidEventTap)
    usleep(30000)
  }
}
`;

async function run(opts) {
  const results = [];
  const report = (check, ok, detail, extra = {}) => {
    const r = { check, ok: !!ok, detail: String(detail), ...extra };
    results.push(r);
    console.log(JSON.stringify({ check: r.check, ok: r.ok, detail: r.detail }));
  };
  const req = createRequire(join(ROOT, 'desktop', 'package.json'));
  let executablePath;
  try {
    executablePath = req('electron');
    if (typeof executablePath !== 'string' || !existsSync(executablePath)) throw new Error('missing');
  } catch {
    console.error('desktop-live-check: run npm ci --prefix desktop first');
    return 2;
  }
  const desktopDir = resolve(opts.desktopDir || join(ROOT, 'desktop'));
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'worca-live-')));
  const env = sandboxEnv(sandbox);
  let old = null;
  let electronApp = null;
  try {
    if (opts.reuseOld) {
      old = await startOldServer({ ref: opts.reuseOld, sandbox, env });
      console.error(`desktop-live-check: old server ${opts.reuseOld} on ${old.url} (pid ${old.child.pid})`);
    }
    const { _electron } = await import(pathToFileURL(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs')).href);
    electronApp = await _electron.launch({ executablePath, args: [desktopDir, `--user-data-dir=${join(sandbox, 'userData')}`], env, cwd: sandbox, timeout: 60000 });
    const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    if (!String(userData).startsWith(sandbox + sep)) {
      report('sandbox', false, `userData is ${userData}, outside ${sandbox}`);
      return 1;
    }
    const page = await electronApp.firstWindow({ timeout: 90000 });
    await page.waitForSelector('.brand', { state: 'attached', timeout: 60000 });
    // A fresh sandbox store opens the first-run Welcome and setup dialogs over the page: take them out of the walk.
    await page.waitForTimeout(1500);
    await page.evaluate(() => { for (const id of ['welcome-modal', 'setup-modal']) document.getElementById(id)?.remove(); });
    const win = await electronApp.browserWindow(page);
    const origin = new URL(page.url()).origin;
    if (old) report('reused', origin === old.url, `page origin ${origin}, old server ${old.url}`);

    const chrome = await page.evaluate(() => document.documentElement.getAttribute('data-shell-chrome'));
    report('chrome', chrome === 'inset', `data-shell-chrome=${chrome}`);
    // A reused server's page paints before main's injected CSS lands: give it a moment, then measure.
    await waitFor(() => page.evaluate(() => getComputedStyle(document.querySelector('.brand')).paddingLeft !== '20px'), { timeoutMs: 4000 });
    const ensureExpanded = async () => {
      if (await page.evaluate(() => document.querySelector('.sidebar')?.classList.contains('collapsed'))) {
        await page.click('#side-toggle');
        await waitFor(() => page.evaluate(() => !document.querySelector('.sidebar').classList.contains('collapsed')), { timeoutMs: 3000 });
        await sleep(400);
      }
    };
    await ensureExpanded();
    const lightsNow = async (fallback) => {
      const p = await win.evaluate((w) => (typeof w.getWindowButtonPosition === 'function' ? w.getWindowButtonPosition() : null));
      return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : fallback;
    };
    const lights = await lightsNow(TRAFFIC_LIGHTS.expanded);
    const head = await page.evaluate(() => {
      const brand = document.querySelector('.brand');
      const logo = brand.querySelector('.logo');
      const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
      const visible = [...brand.children].filter((el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; });
      return { logo: logo ? r(logo) : null, padding: getComputedStyle(brand).paddingLeft, children: visible.map((el) => ({ name: el.id ? `#${el.id}` : `.${[...el.classList].join('.')}`, rect: r(el) })) };
    });
    report('logo-clear', head.logo && clearOfLights(head.logo, lights, TRAFFIC_LIGHTS_SIZE, GAP), `.logo left ${head.logo && head.logo.left}px, bound ${lights.x + TRAFFIC_LIGHTS_SIZE.width + GAP}px (lights ${JSON.stringify(lights)}), .brand padding-left ${head.padding}`);
    const blocked = head.children.filter((c) => !clearOfLights(c.rect, lights, TRAFFIC_LIGHTS_SIZE, GAP));
    report('header-clear', head.children.length > 0 && blocked.length === 0, blocked.length ? `left of the bound: ${blocked.map((c) => `${c.name}@${c.rect.left}`).join(', ')}` : `${head.children.map((c) => `${c.name}@${c.rect.left}`).join(', ')}`);

    const regions = await page.evaluate(() => {
      const region = (sel) => { const el = document.querySelector(sel); if (!el) return 'missing'; const cs = getComputedStyle(el); return cs.getPropertyValue('-webkit-app-region') || cs.getPropertyValue('app-region') || cs.webkitAppRegion || 'none'; };
      return { brand: region('.brand'), topnav: region('.topnav'), newRun: region('#topnav-new'), search: region('#tsearch-input') };
    });
    report('drag', regions.brand === 'drag' && regions.topnav === 'drag' && regions.newRun === 'no-drag' && regions.search === 'no-drag', JSON.stringify(regions));

    await page.click('#side-toggle');
    const collapsed = await waitFor(() => page.evaluate(() => document.querySelector('.sidebar').classList.contains('collapsed')), { timeoutMs: 3000 });
    await sleep(500);
    const railLights = await lightsNow(TRAFFIC_LIGHTS.rail);
    const mark = await page.evaluate(() => { const m = document.querySelector('.brand .logo-mark'); const b = m && m.getBoundingClientRect(); return b ? { top: b.top, left: b.left, width: b.width } : null; });
    const railBound = TRAFFIC_LIGHTS.rail.y + TRAFFIC_LIGHTS_SIZE.height + RAIL_GAP;
    report('rail', collapsed && mark && mark.width > 0 && mark.top >= railBound, `collapsed ${!!collapsed}, .logo-mark top ${mark && mark.top}px ≥ ${railBound}px (lights now ${JSON.stringify(railLights)})`);
    await ensureExpanded();

    await win.evaluate((w) => w.setFullScreen(true));
    const inFull = await waitFor(() => page.evaluate(() => document.documentElement.hasAttribute('data-shell-fullscreen')), { timeoutMs: 10000 });
    await sleep(800);
    await ensureExpanded();
    const fullPad = await page.evaluate(() => getComputedStyle(document.querySelector('.brand')).paddingLeft);
    await win.evaluate((w) => w.setFullScreen(false));
    const leftFull = await waitFor(() => page.evaluate(() => !document.documentElement.hasAttribute('data-shell-fullscreen')), { timeoutMs: 10000 });
    await waitFor(async () => !(await win.evaluate((w) => w.isFullScreen())), { timeoutMs: 10000 });
    await sleep(800);
    await ensureExpanded();
    const backPad = await page.evaluate(() => getComputedStyle(document.querySelector('.brand')).paddingLeft);
    report('fullscreen', inFull && fullPad === '20px' && leftFull && backPad === '84px', `in full screen: attribute ${!!inFull}, padding-left ${fullPad}; after: attribute gone ${!!leftFull}, padding-left ${backPad}`);

    const appleAction = await electronApp.evaluate(({ systemPreferences }) => { try { return systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string'); } catch { return null; } });
    const expected = titleDoubleClickAction({ platform: 'darwin', appleAction });
    await win.evaluate((w) => { if (w.isMaximized()) w.unmaximize(); w.setBounds({ width: 1000, height: 700 }); });
    await waitFor(async () => !(await win.evaluate((w) => w.isMaximized())), { timeoutMs: 3000 });
    await sleep(400);
    const stripPoint = () => page.evaluate(() => {
      const ok = (el) => !!el && (el.matches('.topnav, .topnav-l, .topnav-title') || el.closest('.topnav-title'));
      const l = document.querySelector('.topnav-l');
      const t = document.querySelector('.topnav-title');
      let pt = null;
      if (l && t) { const lb = l.getBoundingClientRect(); const tb = t.getBoundingClientRect(); if (lb.right - tb.right > 8) pt = { x: Math.round((tb.right + lb.right) / 2), y: Math.round(lb.top + lb.height / 2) }; }
      if (!pt) { const b = document.querySelector('.brand').getBoundingClientRect(); const g = document.querySelector('.brand .logo').getBoundingClientRect(); pt = { x: Math.round((g.right + b.right) / 2), y: Math.round(b.top + b.height / 2) }; }
      const el = document.elementFromPoint(pt.x, pt.y);
      const name = el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.classList.length ? `.${[...el.classList].join('.')}` : ''}` : 'nothing';
      return { ...pt, name, strip: ok(el) || !!(el && el.matches('.brand')) };
    });
    const state = () => win.evaluate((w) => ({ max: w.isMaximized(), min: w.isMinimized() }));
    let pt = await stripPoint();
    if (!pt.strip) report('dblclick', false, `the point (${pt.x},${pt.y}) hits ${pt.name}, not the strip`);
    else {
      const before = await state();
      await page.mouse.dblclick(pt.x, pt.y);
      let detail;
      let ok;
      if (expected === 'maximize') {
        const zoomed = await waitFor(async () => (await state()).max, { timeoutMs: 3000 });
        await sleep(600);
        pt = await stripPoint();
        await page.mouse.dblclick(pt.x, pt.y);
        const restored = await waitFor(async () => !(await state()).max, { timeoutMs: 3000 });
        ok = !before.max && zoomed && restored;
        detail = `AppleActionOnDoubleClick=${JSON.stringify(appleAction)} → maximize; at (${pt.x},${pt.y}) on ${pt.name}: zoomed ${!!zoomed}, restored ${!!restored}`;
      } else if (expected === 'minimize') {
        const minimized = await waitFor(async () => (await state()).min, { timeoutMs: 3000 });
        await win.evaluate((w) => w.restore());
        ok = !!minimized;
        detail = `AppleActionOnDoubleClick=${JSON.stringify(appleAction)} → minimize; minimized ${!!minimized}`;
      } else {
        await sleep(1500);
        const after = await state();
        ok = after.max === before.max && after.min === before.min;
        detail = `AppleActionOnDoubleClick=${JSON.stringify(appleAction)} → none; unchanged ${ok}`;
      }
      report('dblclick', ok, detail);
    }

    if (opts.osClick) {
      await win.evaluate((w) => { if (w.isMaximized()) w.unmaximize(); w.show(); w.focus(); });
      await waitFor(async () => !(await win.evaluate((w) => w.isMaximized())), { timeoutMs: 3000 });
      await sleep(600);
      await page.evaluate(() => { window.__liveDbl = 0; document.addEventListener('dblclick', () => { window.__liveDbl += 1; }, true); });
      await electronApp.evaluate(({ ipcMain, BrowserWindow }) => {
        const g = globalThis;
        g.__liveCounts = { ipc: 0, maximize: 0, unmaximize: 0 };
        ipcMain.on('worca:title-dblclick', () => { g.__liveCounts.ipc += 1; });
        const w = BrowserWindow.getAllWindows()[0];
        w.on('maximize', () => { g.__liveCounts.maximize += 1; });
        w.on('unmaximize', () => { g.__liveCounts.unmaximize += 1; });
      });
      const p = await stripPoint();
      const bounds = await win.evaluate((w) => w.getContentBounds());
      const swift = join(sandbox, 'dblclick.swift');
      writeFileSync(swift, SWIFT);
      const before = await win.evaluate((w) => w.isMaximized());
      const posted = spawnSync('swift', [swift, String(bounds.x + p.x), String(bounds.y + p.y)], { encoding: 'utf8', timeout: 120000 });
      await sleep(2500);
      const seen = await page.evaluate(() => window.__liveDbl);
      const counts = await electronApp.evaluate(() => globalThis.__liveCounts);
      const after = await win.evaluate((w) => w.isMaximized());
      const base = `screen point (${bounds.x + p.x},${bounds.y + p.y}) on ${p.name}; page dblclick ${seen}; main IPC ${counts.ipc}; maximize events ${counts.maximize}, unmaximize ${counts.unmaximize}; maximized ${before} → ${after}${posted.status !== 0 ? `; swift exit ${posted.status}: ${String(posted.stderr || posted.error || '').trim().split('\n').slice(-2).join(' ')}` : ''}`;
      if (!seen && before === after && !counts.maximize && !counts.unmaximize) report('os-dblclick', false, `OS events not delivered (Accessibility permission?) — ${base}`, { unverified: true });
      else report('os-dblclick', counts.maximize + counts.unmaximize === 1 && before !== after, `${counts.maximize + counts.unmaximize > 1 ? 'DOUBLE TOGGLE (native zoom + IPC) — ' : ''}${base}`);
      if (after) await win.evaluate((w) => w.unmaximize());
    }

    // The Dock badge (desktop/src/badge.mjs). A fresh sandbox has the Alerts badge off, so each step writes the DOM
    // the way ui/public/alerts.mjs would; app.js puts the title and favicon back on every WS frame, so a step writes
    // and reads again every 100 ms until the Dock shows what it should (3 s at most).
    if (process.platform === 'darwin') {
      const dockNow = () => electronApp.evaluate(({ app }) => (app.dock ? app.dock.getBadge() : null));
      const expectDock = async (name, write, want, arg) => {
        const end = Date.now() + 3000;
        let seen;
        for (;;) {
          if (write) await page.evaluate(write, arg);
          seen = await dockNow();
          if (seen === want || Date.now() >= end) break;
          await sleep(100);
        }
        report(name, seen === want, `Dock badge ${JSON.stringify(seen)}, expected ${JSON.stringify(want)}`);
      };
      const ICON = '/assets/worca-favicon.png';
      const DOTTED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      await expectDock('badge-start', null, '');
      await expectDock('badge-count', () => { document.title = '(2) Worca'; }, '2');
      await expectDock('badge-dot', (href) => { document.querySelector('link[rel~="icon"]').setAttribute('href', href); document.title = 'Worca'; }, '•', DOTTED);
      await expectDock('badge-clear', (href) => { document.querySelector('link[rel~="icon"]').setAttribute('href', href); document.title = 'Worca'; }, '', ICON);
      await expectDock('badge-before-reload', () => { document.title = '(3) Worca'; }, '3');
      await page.reload();
      await page.waitForSelector('.brand', { state: 'attached', timeout: 60000 });
      await expectDock('badge-reload', null, '');
    } else {
      report('badge', true, 'macOS only', { unverified: true });
    }
    return results.some((r) => !r.ok && !r.unverified) ? 1 : 0;
  } catch (err) {
    report('error', false, err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : String(err));
    return 1;
  } finally {
    const failed = results.filter((r) => !r.ok && !r.unverified).length;
    const unverified = results.filter((r) => r.unverified).length;
    console.log(JSON.stringify({ summary: { passed: results.filter((r) => r.ok).length, failed, unverified, sandbox: opts.keep ? sandbox : null } }));
    await cleanup({ electronApp, old, sandbox, keep: opts.keep });
  }
}

/** Close the app (its Quit stops the server it started), stop the old server this tool spawned, remove the sandbox. */
async function cleanup({ electronApp, old, sandbox, keep }) {
  const appServer = readJson(join(sandbox, '.worca-cc', 'ui.json'));
  if (electronApp) {
    const proc = electronApp.process();
    await Promise.race([electronApp.close().catch(() => {}), sleep(45000)]);
    if (proc && proc.pid && alive(proc.pid)) { try { process.kill(proc.pid); } catch { /* gone */ } }
  }
  // The server the app started in THIS sandbox (never the old one, never the host's): its Quit normally stopped it.
  if (appServer && Number.isInteger(appServer.pid) && (!old || appServer.pid !== old.child.pid)) {
    await waitFor(() => !alive(appServer.pid), { timeoutMs: 10000, stepMs: 250 });
    const health = readJson(join(sandbox, '.worca-cc', 'ui.json'));
    if (alive(appServer.pid) && health && health.pid === appServer.pid) { try { process.kill(appServer.pid); } catch { /* gone */ } }
  }
  if (old && old.child.exitCode === null && old.child.signalCode === null) {
    try { process.kill(old.child.pid); } catch { /* gone */ }
    await waitFor(() => old.child.exitCode !== null || old.child.signalCode !== null, { timeoutMs: 15000, stepMs: 200 });
  }
  if (!keep) { try { rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ } }
}

// realpath, as import.meta.url is: a symlinked checkout or tools dir must still run the CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let opts;
  try {
    opts = parseLiveArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`desktop-live-check: ${err.message}\n${USAGE}`);
    process.exit(2);
  }
  if (process.platform !== 'darwin') {
    console.error('desktop-live-check: macOS only');
    process.exit(2);
  }
  run(opts).then((code) => process.exit(code), (err) => { console.error(err && err.stack ? err.stack : String(err)); process.exit(1); });
}
