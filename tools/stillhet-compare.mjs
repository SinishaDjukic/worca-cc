#!/usr/bin/env node
// tools/stillhet-compare.mjs — the comparison (docs/rail/gate.md): what the app draws and what the prototype draws must match
// pixel for pixel. Parts (the invitation, the design switch) are compared element by element; every route of the shell is
// compared as a whole page, in both themes at 1280 and in light at 360, with the fonts pinned, the clock fixed and animations off;
// so is every deep route the prototype has (deepRoutes: each task case, chat, schedule, Settings section and place item).
// A console error or a page error in either page fails the cell. --pages opens the three standalone prototype pages
// (components.html, run-page.html, pulse.html), built from the shared code, and fails on a console or page error in them.
//   npm run stillhet:compare [-- --parts invitation,design-switch,route-chat] [-- --pages]
// Needs the prototype's built files (`npm run rail`) and a Chromium that playwright can launch. NOT part of `npm test`.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
// playwright's own download is optional: CHROME_BIN or an installed Chrome is used when present.
// Raster that does not depend on timing: a loaded machine otherwise re-rasters a damaged tile with other anti-aliasing at
// ring and border edges (1–44 pixels, a different cell each run).
export const RASTER_ARGS = ['--disable-gpu', '--disable-partial-raster', '--disable-lcd-text', '--force-color-profile=srgb', '--font-render-hinting=none'];
export const launchOptions = () => { const exe = process.env.CHROME_BIN || CHROME_PATHS.find((c) => existsSync(c)); return { args: RASTER_ARGS, ...(exe ? { executablePath: exe } : {}) }; };

/** How many pixels differ (any RGBA channel). A size mismatch counts every pixel. */
export function countDiffPixels(a, b, w, h) {
  if (a.length !== b.length || a.length !== w * h * 4) return w * h;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) n++;
  return n;
}

const ASK = { WORCA_STILLHET_ASK: '1' };
export const PARTS = [
  // the shared shell shows the Invitation while the address says ?invite=stillhet, in both hosts
  { id: 'invitation', app: { route: '?invite=stillhet#chat' }, proto: { route: '?invite=stillhet#chat' } },
  { id: 'design-switch', app: { route: '#chat/new', env: ASK }, proto: { route: '#chat' } },
];
// The shell's routes: the places of the sidebar (ui/public/stillhet/shell/shell.js PLACES) and Pulse, compared as whole pages.
export const ROUTES = ['chat', 'runs', 'schedules', 'workflows', 'requirements', 'marketplace', 'projects', 'settings', 'insights', 'pulse'];
for (const r of ROUTES) PARTS.push({ id: `route-${r}`, route: true, app: { route: `#${r}` }, proto: { route: `#${r}` } });
// Each non-default state, opened cold by its address in both hosts (shell/world.js reads ?state=NAME and ?first): the lists'
// states on Tasks, the connection's and the newcomer's on Chat.
export const STATES = [['loading', 'runs'], ['empty', 'runs'], ['offline', 'runs'], ['failed', 'runs'], ['refresh-failed', 'runs'], ['connection-lost', 'chat'], ['session-expired', 'chat'], ['first-run', 'chat']];
for (const [s, r] of STATES) { const q = s === 'first-run' ? `?first#${r}` : `?state=${s}#${r}`; PARTS.push({ id: `state-${s}`, route: true, app: { route: q }, proto: { route: q } }); }
// Pulse's own list states (docs/rail/failures.md, fail.pulse-list): the popover opened by the old Activity address, which lands
// on Chat with Pulse open on Now (shell/old-addresses.js), over the same ?state= in both hosts.
export const PULSE_STATES = [['loading-pulse', 'loading'], ['failed-pulse', 'failed']];
for (const [id, s] of PULSE_STATES) PARTS.push({ id: `state-${id}`, route: true, app: { route: `?state=${s}#activity` }, proto: { route: `?state=${s}#activity` } });
export const PAGES = ['components.html', 'run-page.html', 'pulse.html'];
// The deep routes, read from the prototype's own route list once it has drawn (it runs inside the page): RailShell.routes()
// (ui/public/stillhet/shell/shell.js) less the top-level places, which ROUTES compares as whole pages.
export function deepRoutes() {
  return window.RailShell.routes().filter((h) => h.includes('/'));
}
// One deep route of each kind keeps its pairs beside the other cells, for the PR; the rest go to out/stillhet-compare/deep/
// (git-ignored: about 230 routes in three cells would weigh ~100 MB). Every cell is compared and reported either way.
export const SHOWN = ['run/ready', 'run/question', 'run/failed', 'chat/c1', 'schedule/s1', 'settings/runs', 'workflows/workflow:default', 'projects/billing-api', 'requirements/FEAT-2', 'marketplace/slack-chat', 'insights/spend'];
/** The whole-page cell of one deep route (#run/ready → route-run-ready). */
export const deepPart = (hash) => ({ id: `route-${hash.replace(/[^\w@.-]+/g, '-')}`, route: true, dir: SHOWN.includes(hash) ? '' : 'deep', app: { route: `#${hash}` }, proto: { route: `#${hash}` } });
export const CELLS = [['dark', 1280], ['light', 1280], ['light', 360]];
const FIXED_CLOCK = Date.UTC(2026, 10, 11, 9, 0, 0);
const ROUTE_STYLE = '.mk-tools{display:none!important}*{font-family:Arial,Helvetica,sans-serif!important;animation:none!important;transition:none!important;caret-color:transparent!important}';

/** The exit code and report lines for a list of { part, theme, width, appBox, protoBox, diff }. */
export function report(cells) {
  const lines = [];
  let code = 0;
  for (const c of cells) {
    const sameBox = c.appBox.w === c.protoBox.w && c.appBox.h === c.protoBox.h;
    const errors = c.errors || [];
    const bad = !sameBox || c.diff > 0 || errors.length > 0;
    if (bad) code = 1;
    lines.push(`${bad ? 'FAIL' : 'ok  '} ${c.part} ${c.theme} ${c.width}: ${sameBox ? `${c.diff} differing pixels` : `box sizes differ, app ${c.appBox.w}x${c.appBox.h}, prototype ${c.protoBox.w}x${c.protoBox.h}`}`);
    for (const e of errors) lines.push(`     ${e}`);
  }
  return { code, lines };
}

// What is hidden around the part, so both shells paint the same blank page behind it.
// The page typeface is the one thing the two shells do not share until slice 2 serves Stillhet (the app is Poppins, the prototype Inter),
// so both are pinned to one family here: what is compared is structure, spacing and colour.
const ISOLATE = (id) => `*{font-family:Arial,Helvetica,sans-serif!important}html,body{background:var(--bg,#fff)!important}body *{visibility:hidden!important}[data-stillhet="${id}"],[data-stillhet="${id}"] *{visibility:visible!important}*{animation:none!important;transition:none!important;caret-color:transparent!important}`
  + (id === 'design-switch' ? '[data-stillhet="design-switch"]{position:fixed!important;top:0!important;left:0!important;z-index:2147483647!important;background:var(--bg)!important}' : '')
  + (id === 'invitation' ? '#rail-strip{position:fixed!important;top:0!important;left:0!important;right:0!important;z-index:2147483647!important}' : '');

async function playwright() {
  try { return await import('playwright'); } catch { return import('playwright-core'); }
}

export async function freePort() {
  const net = await import('node:net');
  return new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}

/** `lockRail`: turn `rail` on with WORCA_FLAGS (the gates: a click on the switch then changes nothing); else stored, as a
 *  person turns it on (the comparison: the switch is drawn as the prototype draws it). */
export async function startApp(home, env, { lockRail = false } = {}) {
  const port = await freePort();
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  // a locked flag draws the top-bar switch disabled (nav.design-switch), which the prototype's switch is not
  await writeFile(join(home, '.worca-cc', 'settings.json'), JSON.stringify({ onboarding: { welcomeSeen: true }, ...(lockRail ? {} : { flags: { rail: true } }) }));
  let log = '';
  const child = spawn(process.execPath, ['ui/server.mjs'], { cwd: ROOT, env: { ...process.env, ...env, WORCA_FLAGS: lockRail ? 'rail' : '', WORCA_STILLHET_DEMO: '1', PORT: String(port), HOME: home, USERPROFILE: home, WORCA_HOME: join(home, 'worca-home'), WORCA_MOCK: '1', WORCA_TEST_ALLOW_HOME_FALLBACK: '1', FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/projects`)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  if (/already in use/.test(log)) throw new Error('the sandbox port is already in use');
  const proj = join(home, 'proj'); await mkdir(proj, { recursive: true });
  await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'proj', path: proj }) });
  return { base, stop: () => child.kill('SIGTERM') };
}

// Collects console errors and page errors of a page into `into`, labelled with `who`.
const watch = (page, who, into) => {
  page.on('console', (m) => { if (m.type() === 'error') into.push(`${who} console: ${m.text()}`); });
  page.on('pageerror', (e) => into.push(`${who} pageerror: ${e.message}`));
};
// Expert and the theme, set before the page's first script runs (a same-page hash change never reloads it).
const setLook = (t) => { try { localStorage.setItem('worca-rail.mode', 'expert'); localStorage.setItem('worca-rail.appearance', t); } catch { /* none */ } };
const freezeClock = (page) => page.addInitScript((t) => {
  const Real = Date;
  const Fixed = class extends Real { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } };
  window.Date = Fixed;
}, FIXED_CLOCK);

/** A whole page once it has settled: Motion's script animations (motion.mjs, Element.animate) are finished, which the
 *  CSS that turns animations off does not reach, and two frames in a row are the same. A loaded machine draws late; a fixed
 *  wait caught a page mid-fade. */
export async function settledShot(page, { rounds = 12, gap = 150 } = {}) {
  await page.waitForTimeout(300);
  let last = null;
  for (let i = 0; i < rounds; i++) {
    await page.evaluate(() => new Promise((done) => {
      for (const a of document.getAnimations()) { try { a.finish(); } catch { a.cancel(); } }   // an endless one cannot finish
      requestAnimationFrame(() => requestAnimationFrame(done));
    }));
    const png = await page.screenshot({ animations: 'disabled', fullPage: true });
    if (last && png.equals(last)) return png;
    last = png;
    await page.waitForTimeout(gap);
  }
  return last;
}

async function shoot(page, id, outFile, route) {
  await page.addStyleTag({ content: route ? ROUTE_STYLE : ISOLATE(id) });
  await page.evaluate(() => document.activeElement?.blur?.());
  const el = route ? page.locator('body') : page.locator(`[data-stillhet="${id}"]`).first();
  if (!route) await el.waitFor({ state: 'visible', timeout: 15000 });
  // a route is the whole document, below the fold too: its box is the page's scroll size
  const box = route ? await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })) : await el.boundingBox();
  const png = route ? await settledShot(page) : await el.screenshot({ animations: 'disabled' });
  await writeFile(outFile, png);
  const rgba = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let s = ''; for (let i = 0; i < d.length; i += 8192) s += String.fromCharCode(...d.subarray(i, i + 8192));
    return { w: c.width, h: c.height, b64: btoa(s) };
  }, png.toString('base64'));
  return { box: { w: Math.round(box.width), h: Math.round(box.height) }, rgba: new Uint8ClampedArray(Buffer.from(rgba.b64, 'base64')), w: rgba.w, h: rgba.h };
}

// The prototype is opened once, in Expert, to read its deep routes.
async function listDeep(chromium) {
  const browser = await chromium.launch(launchOptions());
  try {
    const p = await browser.newPage();
    await p.addInitScript(() => { try { localStorage.setItem('worca-rail.mode', 'expert'); } catch { /* none */ } });
    await p.goto(pathToFileURL(join(ROOT, 'plans/rail/prototype/index.html')).href + '#chat');
    await p.waitForFunction(() => !!(window.RunCardModel && window.RailPlaces && window.RailChats && window.RailShell));
    return await p.evaluate(deepRoutes);
  } finally { await browser.close(); }
}

/** --pages: the standalone prototype pages open without a console or page error. Returns the exit code. */
async function pagesMain() {
  const { chromium } = await playwright();
  const browser = await chromium.launch(launchOptions());
  let code = 0;
  try {
    for (const name of PAGES) {
      const errors = [];
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      watch(p, name, errors);
      await p.goto(pathToFileURL(join(ROOT, 'plans/rail/prototype', name)).href);
      await p.waitForTimeout(500);
      await p.close();
      if (errors.length) code = 1;
      console.log(`${errors.length ? 'FAIL' : 'ok  '} ${name}: ${errors.length} console or page errors`);
      for (const e of errors) console.log('     ' + e);
    }
  } finally { await browser.close(); }
  return code;
}

export async function main(argv = process.argv.slice(2)) {
  // the prototype's generated files (app.css, components.js) are built, not committed
  await (await import('./stillhet-build.mjs')).buildStillhet();
  if (argv.includes('--pages')) return pagesMain();
  const { chromium } = await playwright();
  const all = [...PARTS, ...(await listDeep(chromium)).map(deepPart)];
  const pi = argv.indexOf('--parts');
  const ids = pi >= 0 ? argv[pi + 1].split(',') : all.map((p) => p.id);
  const parts = all.filter((p) => ids.includes(p.id));
  const outRoot = join(ROOT, 'out/stillhet-compare');
  await mkdir(join(outRoot, 'deep'), { recursive: true });
  const home = await mkdtemp(join(tmpdir(), 'stillhet-compare-'));
  const app = await startApp(home, ASK);
  const browser = await chromium.launch(launchOptions());
  const cells = [];
  try {
    for (const part of parts) {
      for (const [theme, width] of CELLS) {
        const out = join(outRoot, part.dir || '');
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
        const errors = [];
        try {
          const a = await ctx.newPage();
          watch(a, 'app', errors);
          if (part.route) { await freezeClock(a); await a.addInitScript(setLook, theme); }
          await a.goto(app.base + '/' + part.app.route);
          await a.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
          const A = await shoot(a, part.id, join(out, `${part.id}-${theme}-${width}-app.png`), part.route);
          const p = await ctx.newPage();
          watch(p, 'prototype', errors);
          if (part.route) { await freezeClock(p); await p.addInitScript(setLook, theme); }
          const protoUrl = pathToFileURL(join(ROOT, 'plans/rail/prototype/index.html')).href;
          // a route opens once, on its own address (a first visit to Chat would mark its unread dot seen); a part is seeded, then moved
          if (!part.route) await p.goto(protoUrl);
          if (!part.route) await p.evaluate((t) => { localStorage.setItem('worca-rail.mode', 'expert'); localStorage.setItem('worca-rail.appearance', t); localStorage.removeItem('worca-rail.stillhetAsked'); }, theme);
          await p.goto(protoUrl.replace(/index\.html.*$/, 'index.html') + part.proto.route);
          const P = await shoot(p, part.id, join(out, `${part.id}-${theme}-${width}-proto.png`), part.route);
          const diff = A.box.w === P.box.w && A.box.h === P.box.h ? countDiffPixels(A.rgba, P.rgba, A.w, A.h) : A.w * A.h;
          cells.push({ part: part.id, theme, width, appBox: A.box, protoBox: P.box, diff, errors });
        } catch (e) {   // a cell that cannot be shot (a part that never shows, a page that hangs) fails alone; the rest still run
          cells.push({ part: part.id, theme, width, appBox: { w: 0, h: 0 }, protoBox: { w: 0, h: 0 }, diff: 0, errors: [...errors, `not shot: ${String(e.message || e).split('\n')[0]}`] });
        }
        await ctx.close();
      }
    }
  } finally { await browser.close(); app.stop(); await rm(home, { recursive: true, force: true }); }
  const { code, lines } = report(cells);
  console.log(lines.join('\n'));
  return code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
