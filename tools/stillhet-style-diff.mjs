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
/** The flag-off differences from dev the owner accepts, each with the owner's reason: taken off this tree's page before its
 *  dump, so the rest of the page is still compared. Nothing else may differ. */
export const ACCEPTED = Object.freeze([
  { route: '#settings/experimental', selector: '[data-flag-row="rail"]', reason: 'Settings › Labs shows the Stillhet row in every level until the end of feature 3. The owner, in writing: "before enrolling everything I would recommend to be de-activated, labs is reasonable."' },
]);

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

const USAGE = 'usage: node tools/stillhet-style-diff.mjs --dev SHA [--route R[,R…]]   (SHA: the dev commit merged in first; --route: only these routes)';
/** One page's whole budget: load, settle, dump. A page past it ends the run with an error naming the page, never a hang. */
export const PAGE_TIMEOUT_MS = 120_000;
const SERVER_READY_MS = 120_000;

/** Rejects with `label` when `promise` has not settled in `ms`. */
export function withTimeout(promise, ms, label) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: timed out after ${Math.round(ms / 1000)} s`)), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** A sandbox server on a port the OS picks (PORT=0: no clash with servers already running, no probe-then-bind race) and its
 *  own HOME; ready when it has said where it listens and answers /api/projects. A server that exits or never gets there throws
 *  with its log's tail. */
async function startServer(cwd, seedHome, name) {
  let log = '', exited = null;
  const child = spawn(process.execPath, ['ui/server.mjs'], { cwd, env: { ...process.env, PORT: '0', HOME: seedHome, USERPROFILE: seedHome, WORCA_HOME: join(seedHome, 'worca-home'), WORCA_MOCK: '1', WORCA_TEST_ALLOW_HOME_FALLBACK: '1', FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  child.on('exit', (code, sig) => { exited = sig || code; });
  const stop = () => { if (exited === null) child.kill('SIGTERM'); };
  const fail = (why) => { stop(); return new Error(`${name} server ${why}\n${log.slice(-2000)}`); };
  const t0 = Date.now();
  for (let base; ; await new Promise((r) => setTimeout(r, 200))) {
    if (exited !== null) throw fail(`exited (${exited}) before it was ready`);
    if (Date.now() - t0 > SERVER_READY_MS) throw fail(`not ready after ${SERVER_READY_MS / 1000} s`);
    base ||= /listening on (http:\/\/[^\s]+)/.exec(log)?.[1]?.replace('localhost', '127.0.0.1');
    if (base && await fetch(`${base}/api/projects`).then((r) => r.ok, () => false)) return { base, stop };
  }
}

/** In the page. want null: { domPath: hash of its computed style } for every visible element (a few bytes each: the full
 *  style of a 14 000-element Settings page is over 200 MB, more than the browser hands back). want [domPath]: those
 *  elements' full computed style. */
const DUMP = (want) => {
  const out = {};
  // a random id suffix (ask-suggest-cc31ka8k, pl-rd-proj-4320a671) is not a difference: the path keeps the id's stem
  const stem = (id) => id.replace(/[a-z0-9]{8}$/, '*');
  const path = (e) => { const p = []; for (; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) p.unshift(`${e.tagName.toLowerCase()}${e.id ? '#' + stem(e.id) : ''}:${[...e.parentElement.children].indexOf(e)}`); return p.join('>'); };
  const wanted = want && new Set(want);
  const hash = (str) => {   // cyrb53: 53 bits, so two different styles do not meet by chance
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  };
  for (const e of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const at = path(e);
    if (wanted && !wanted.has(at)) continue;
    const o = {}; for (const p of cs) o[p] = cs.getPropertyValue(p).replace(/https?:\/\/127\.0\.0\.1:\d+/g, 'ORIGIN');   // the two servers' ports differ
    out[at] = wanted ? o : hash(Object.keys(o).sort().map((p) => `${p}:${o[p]}`).join(';'));   // sorted: the two sides list custom properties in their own order
  }
  return out;
};

/** Two { domPath: hash } maps → the paths to fetch in full (same element, different hash) and each side's dump skeleton for
 *  the elements on one side only. */
export function hashDiff(devHashes, sliceHashes) {
  const changed = Object.keys(devHashes).filter((p) => p in sliceHashes && devHashes[p] !== sliceHashes[p]);
  const only = (a, b) => Object.fromEntries(Object.keys(a).filter((p) => !(p in b)).map((p) => [p, {}]));
  return { changed, devOnly: only(devHashes, sliceHashes), sliceOnly: only(sliceHashes, devHashes) };
}

/** Git-ignored build output in this checkout that a `git worktree add` of dev lacks; linked into the dev copy when present. */
export const LOCAL_BUILDS = ['extension/dist'];

export async function main(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--dev');
  if (i < 0 || !argv[i + 1]) { console.error(USAGE); return 2; }
  const sha = argv[i + 1];
  const r = argv.indexOf('--route');
  const routes = r < 0 ? ROUTES : argv[r + 1]?.split(',').filter(Boolean) ?? [];
  const unknown = routes.filter((x) => !ROUTES.includes(x));
  if (!routes.length || unknown.length) { console.error(`unknown route ${unknown.join(', ')}; routes: ${ROUTES.join(' ')}`); return 2; }
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = await import('playwright-core')); }
  const tmp = await mkdtemp(join(tmpdir(), 'stillhet-style-'));
  const wt = join(tmp, 'dev');
  execFileSync('git', ['worktree', 'add', '--detach', wt, sha], { cwd: ROOT, stdio: 'ignore' });
  const servers = [];
  let browser;
  // `timeout` or Ctrl-C ends the run: the servers and the dev worktree go with it, not left behind for the next run
  const onSignal = (sig) => {
    for (const s of servers) s.stop();
    try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT, stdio: 'ignore' }); } catch { /* already gone */ }
    process.exit(sig === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  try {
    await symlink(join(ROOT, 'node_modules'), join(wt, 'node_modules'));
    // git-ignored builds the server serves (Settings › Browser extension reads extension/dist): the same on both sides
    for (const built of LOCAL_BUILDS) if (existsSync(join(ROOT, built))) await symlink(join(ROOT, built), join(wt, built));
    const seed = join(tmp, 'seed'); await mkdir(join(seed, 'proj'), { recursive: true });
    await mkdir(join(seed, '.worca-cc'), { recursive: true });
    await writeFile(join(seed, '.worca-cc', 'settings.json'), JSON.stringify({ onboarding: { welcomeSeen: true } }));
    const homes = [join(tmp, 'h-dev'), join(tmp, 'h-slice')];
    for (const h of homes) await cp(seed, h, { recursive: true });
    servers.push(await startServer(wt, homes[0], 'dev'));
    servers.push(await startServer(ROOT, homes[1], 'slice'));
    for (const s of servers) await fetch(`${s.base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'proj', path: join(seed, 'proj') }) });
    browser = await chromium.launch(launchOptions());
    const rows = [], cells = CELLS.flatMap(([theme, width]) => routes.map((route) => [route, theme, width])), t0 = Date.now();
    // one cell at a time, its two sides side by side; only hashes cross from the page, then the full style of what differs
    for (const [k, [route, theme, width]] of cells.entries()) {
      const key = `${route}|${theme}|${width}`, t = Date.now();
      const contexts = [];
      try {
        const pages = await Promise.all(servers.map((s, n) => withTimeout((async () => {
          const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
          contexts.push(ctx);
          await ctx.addInitScript(() => { const t = 1750000000000; Date.now = () => t; });
          const page = await ctx.newPage();
          page.setDefaultTimeout(PAGE_TIMEOUT_MS);
          await page.goto(s.base + '/' + route);
          await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;caret-color:transparent!important}' });
          // a loaded page, not a fixed time: under load a fixed 1.5 s caught either server mid-load (rows its fetches had not
          // drawn yet), and which cells differed changed from run to run. A page that keeps polling ends the wait at 10 s.
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
          await page.waitForTimeout(1500);
          if (n === 1) await page.evaluate((sels) => { for (const s of sels) for (const e of document.querySelectorAll(s)) e.remove(); }, ACCEPTED.filter((a) => a.route === route).map((a) => a.selector));
          return { page, hashes: await page.evaluate(DUMP, null) };
        })(), PAGE_TIMEOUT_MS, `${route} ${theme} ${width} on ${n ? 'slice' : 'dev'}`)));
        const { changed, devOnly, sliceOnly } = hashDiff(pages[0].hashes, pages[1].hashes);
        const full = changed.length ? await Promise.all(pages.map(({ page }, n) => withTimeout(page.evaluate(DUMP, changed), PAGE_TIMEOUT_MS, `${route} ${theme} ${width} on ${n ? 'slice' : 'dev'}, the differing styles`))) : [{}, {}];
        const found = diffStyles({ [key]: { ...full[0], ...devOnly } }, { [key]: { ...full[1], ...sliceOnly } });
        rows.push(...found);
        console.error(`[${k + 1}/${cells.length}] ${route} ${theme} ${width}: ${Object.keys(pages[1].hashes).length} elements, ${found.length} differences (${((Date.now() - t) / 1000).toFixed(1)} s, ${Math.round((Date.now() - t0) / 1000)} s in all)`);
      } catch (e) {
        throw new Error(`${route} ${theme} ${width}: ${e.message.split('\n')[0]}`, { cause: e });
      } finally {
        await Promise.all(contexts.map((c) => c.close().catch(() => {})));
      }
    }
    for (const r of rows) console.log(`${r.route} ${r.theme} ${r.width} ${r.path} ${r.prop}: dev ${r.dev} | slice ${r.slice}`);
    for (const a of ACCEPTED) console.log(`accepted: ${a.route} ${a.selector}: ${a.reason}`);
    console.log(`${rows.length} computed-style differences`);
    return rows.length ? 1 : 0;
  } finally {
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    if (browser) await browser.close().catch(() => {});
    for (const s of servers) s.stop();
    try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT, stdio: 'ignore' }); } catch { /* already gone */ }
    await rm(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(`stillhet:style-diff: ${e.message}`); process.exit(2); });
