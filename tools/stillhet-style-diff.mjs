#!/usr/bin/env node
// tools/stillhet-style-diff.mjs — the flag-off computed-style diff: dev's commit and this tree, two sandbox servers on one seed,
// a frozen clock and animations off; every visible element's computed style, route by route. Any difference exits 1.
//   npm run stillhet:style-diff -- --dev SHA      (SHA: the dev commit merged in first)
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
// playwright's own download is optional: CHROME_BIN or an installed Chrome is used when present.
const launchOptions = () => { const exe = process.env.CHROME_BIN || CHROME_PATHS.find((c) => existsSync(c)); return exe ? { executablePath: exe } : {}; };

export const ROUTES = ['#chat/new', '#runs', '#schedules', '#workflows', '#marketplace', '#projects', '#stats', '#team-metrics', '#requirements', '#settings', '#settings/experimental'];
export const CELLS = [['dark', 1280], ['light', 1280], ['light', 360]];

/** dump: { "route|theme|width": { domPath: { prop: value } } } → one row per difference. */
export function diffStyles(devDump, sliceDump) {
  const rows = [];
  const keys = new Set([...Object.keys(devDump), ...Object.keys(sliceDump)]);
  for (const key of keys) {
    const [route, theme, width] = key.split('|');
    const d = devDump[key] || {}, s = sliceDump[key] || {};
    for (const path of new Set([...Object.keys(d), ...Object.keys(s)])) {
      if (!(path in d) || !(path in s)) { rows.push({ route, theme, width, path, prop: '(element)', dev: path in d ? 'present' : 'absent', slice: path in s ? 'present' : 'absent' }); continue; }
      for (const prop of new Set([...Object.keys(d[path]), ...Object.keys(s[path])])) {
        if (d[path][prop] !== s[path][prop]) rows.push({ route, theme, width, path, prop, dev: d[path][prop], slice: s[path][prop] });
      }
    }
  }
  return rows;
}

const USAGE = 'usage: node tools/stillhet-style-diff.mjs --dev SHA   (SHA: the dev commit merged in first)';

async function freePort() {
  const net = await import('node:net');
  return new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}

async function startServer(cwd, seedHome) {
  const port = await freePort();
  let log = '';
  const child = spawn(process.execPath, ['ui/server.mjs'], { cwd, env: { ...process.env, PORT: String(port), HOME: seedHome, USERPROFILE: seedHome, WORCA_HOME: join(seedHome, 'worca-home'), WORCA_MOCK: '1', WORCA_TEST_ALLOW_HOME_FALLBACK: '1', FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/projects`)).ok) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 200)); }
  if (/already in use/.test(log)) throw new Error('a sandbox port is already in use');
  return { base, stop: () => child.kill('SIGTERM') };
}

const DUMP = () => {
  const out = {};
  // a random id suffix (ask-suggest-cc31ka8k, pl-rd-proj-4320a671) is not a difference: the path keeps the id's stem
  const stem = (id) => id.replace(/[a-z0-9]{8}$/, '*');
  const path = (e) => { const p = []; for (; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) p.unshift(`${e.tagName.toLowerCase()}${e.id ? '#' + stem(e.id) : ''}:${[...e.parentElement.children].indexOf(e)}`); return p.join('>'); };
  for (const e of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const o = {}; for (const p of cs) o[p] = cs.getPropertyValue(p).replace(/https?:\/\/127\.0\.0\.1:\d+/g, 'ORIGIN');   // the two servers' ports differ
    out[path(e)] = o;
  }
  return out;
};

export async function main(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--dev');
  if (i < 0 || !argv[i + 1]) { console.error(USAGE); return 2; }
  const sha = argv[i + 1];
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = await import('playwright-core')); }
  const tmp = await mkdtemp(join(tmpdir(), 'stillhet-style-'));
  const wt = join(tmp, 'dev');
  execFileSync('git', ['worktree', 'add', '--detach', wt, sha], { cwd: ROOT, stdio: 'ignore' });
  let servers = [], browser;
  try {
    await symlink(join(ROOT, 'node_modules'), join(wt, 'node_modules'));
    const seed = join(tmp, 'seed'); await mkdir(join(seed, 'proj'), { recursive: true });
    await mkdir(join(seed, '.worca-cc'), { recursive: true });
    await writeFile(join(seed, '.worca-cc', 'settings.json'), JSON.stringify({ onboarding: { welcomeSeen: true } }));
    const homes = [join(tmp, 'h-dev'), join(tmp, 'h-slice')];
    for (const h of homes) await cp(seed, h, { recursive: true });
    servers = [await startServer(wt, homes[0]), await startServer(ROOT, homes[1])];
    for (const s of servers) await fetch(`${s.base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'proj', path: join(seed, 'proj') }) });
    browser = await chromium.launch(launchOptions());
    const rows = [];   // each cell is diffed as soon as both sides are dumped: a full dump of every route would not fit in memory
    for (const [theme, width] of CELLS) {
      for (const route of ROUTES) {
        const dumps = [{}, {}];
        for (const [n, s] of servers.entries()) {
          const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
          await ctx.addInitScript(() => { const t = 1750000000000; Date.now = () => t; });
          const page = await ctx.newPage();
          await page.goto(s.base + '/' + route);
          await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;caret-color:transparent!important}' });
          await page.waitForTimeout(1500);
          dumps[n][`${route}|${theme}|${width}`] = await page.evaluate(DUMP);
          await ctx.close();
        }
        rows.push(...diffStyles(dumps[0], dumps[1]));
      }
    }
    for (const r of rows) console.log(`${r.route} ${r.theme} ${r.width} ${r.path} ${r.prop}: dev ${r.dev} | slice ${r.slice}`);
    console.log(`${rows.length} computed-style differences`);
    return rows.length ? 1 : 0;
  } finally {
    if (browser) await browser.close();
    for (const s of servers) s.stop();
    try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT, stdio: 'ignore' }); } catch { /* already gone */ }
    await rm(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
