#!/usr/bin/env node
// tools/stillhet-compare.mjs — the parts comparison (docs/rail/gate.md): a library part drawn by the app and by the prototype,
// element by element, must match pixel for pixel. Slice 2 extends it to every route.
//   npm run stillhet:compare -- --parts invitation,design-switch
// Needs the prototype's built files (`npm run rail`) and a Chromium that playwright can launch. NOT part of `npm test`.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
// playwright's own download is optional: CHROME_BIN or an installed Chrome is used when present.
const launchOptions = () => { const exe = process.env.CHROME_BIN || CHROME_PATHS.find((c) => existsSync(c)); return exe ? { executablePath: exe } : {}; };

/** How many pixels differ (any RGBA channel). A size mismatch counts every pixel. */
export function countDiffPixels(a, b, w, h) {
  if (a.length !== b.length || a.length !== w * h * 4) return w * h;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) n++;
  return n;
}

const ASK = { WORCA_STILLHET_ASK: '1' };
export const PARTS = [
  { id: 'invitation', app: { route: '#chat/new', env: ASK }, proto: { route: '?invite=stillhet#chat' } },
  { id: 'design-switch', app: { route: '#chat/new', env: ASK }, proto: { route: '#chat' } },
];
export const CELLS = [['dark', 1280], ['light', 1280], ['light', 360]];

/** The exit code and report lines for a list of { part, theme, width, appBox, protoBox, diff }. */
export function report(cells) {
  const lines = [];
  let code = 0;
  for (const c of cells) {
    const sameBox = c.appBox.w === c.protoBox.w && c.appBox.h === c.protoBox.h;
    const bad = !sameBox || c.diff > 0;
    if (bad) code = 1;
    lines.push(`${bad ? 'FAIL' : 'ok  '} ${c.part} ${c.theme} ${c.width}: ${sameBox ? `${c.diff} differing pixels` : `box sizes differ, app ${c.appBox.w}x${c.appBox.h}, prototype ${c.protoBox.w}x${c.protoBox.h}`}`);
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

async function freePort() {
  const net = await import('node:net');
  return new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}

async function startApp(home, env) {
  const port = await freePort();
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  await writeFile(join(home, '.worca-cc', 'settings.json'), JSON.stringify({ onboarding: { welcomeSeen: true } }));
  let log = '';
  const child = spawn(process.execPath, ['ui/server.mjs'], { cwd: ROOT, env: { ...process.env, ...env, PORT: String(port), HOME: home, USERPROFILE: home, WORCA_HOME: join(home, 'worca-home'), WORCA_MOCK: '1', WORCA_TEST_ALLOW_HOME_FALLBACK: '1', FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/projects`)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  if (/already in use/.test(log)) throw new Error('the sandbox port is already in use');
  const proj = join(home, 'proj'); await mkdir(proj, { recursive: true });
  await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'proj', path: proj }) });
  return { base, stop: () => child.kill('SIGTERM') };
}

async function shoot(page, id, outFile) {
  await page.addStyleTag({ content: ISOLATE(id) });
  await page.evaluate(() => document.activeElement?.blur?.());
  const el = page.locator(`[data-stillhet="${id}"]`).first();
  await el.waitFor({ state: 'visible', timeout: 15000 });
  const box = await el.boundingBox();
  const png = await el.screenshot({ path: outFile, animations: 'disabled' });
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

export async function main(argv = process.argv.slice(2)) {
  // the prototype's generated files (app.css, components.js, today.js) are built, not committed
  (await import('../plans/rail/prototype/gates/app-css.mjs')).writeAppCss();
  (await import('../plans/rail/prototype/gates/components-js.mjs')).writeComponentsJs();
  (await import('../plans/rail/prototype/gates/today-js.mjs')).writeTodayJs();
  const pi = argv.indexOf('--parts');
  const ids = pi >= 0 ? argv[pi + 1].split(',') : PARTS.map((p) => p.id);
  const parts = PARTS.filter((p) => ids.includes(p.id));
  const out = join(ROOT, 'out/stillhet-compare');
  await mkdir(out, { recursive: true });
  const { chromium } = await playwright();
  const home = await mkdtemp(join(tmpdir(), 'stillhet-compare-'));
  const app = await startApp(home, ASK);
  const browser = await chromium.launch(launchOptions());
  const cells = [];
  try {
    for (const part of parts) {
      for (const [theme, width] of CELLS) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
        const a = await ctx.newPage();
        await a.goto(app.base + '/' + part.app.route);
        await a.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
        // The app takes Stillhet's tokens only when it serves Stillhet (slice 2): the Rail look's table is laid over it here, as the prototype has it.
        await a.addStyleTag({ content: await readFile(join(ROOT, 'plans/rail/prototype/design-system/rail-look.css'), 'utf8') });
        const A = await shoot(a, part.id, join(out, `${part.id}-${theme}-${width}-app.png`));
        const p = await ctx.newPage();
        const protoUrl = pathToFileURL(join(ROOT, 'plans/rail/prototype/index.html')).href;
        await p.goto(protoUrl);
        await p.evaluate((t) => { localStorage.setItem('worca-rail.mode', 'expert'); localStorage.setItem('worca-rail.appearance', t); localStorage.removeItem('worca-rail.stillhetAsked'); }, theme);
        await p.goto(protoUrl.replace(/index\.html.*$/, 'index.html') + part.proto.route);
        const P = await shoot(p, part.id, join(out, `${part.id}-${theme}-${width}-proto.png`));
        const diff = A.box.w === P.box.w && A.box.h === P.box.h ? countDiffPixels(A.rgba, P.rgba, A.w, A.h) : A.w * A.h;
        cells.push({ part: part.id, theme, width, appBox: A.box, protoBox: P.box, diff });
        await ctx.close();
      }
    }
  } finally { await browser.close(); app.stop(); await rm(home, { recursive: true, force: true }); }
  const { code, lines } = report(cells);
  console.log(lines.join('\n'));
  return code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
