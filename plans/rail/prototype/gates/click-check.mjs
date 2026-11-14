// Run: node plans/rail/prototype/gates/click-check.mjs [--small] [--workers N] [--units-json FILE]
// Every control acts (docs/rail/gate.md). On every prototype page, in every case and tab, wide and narrow, it clicks each
// visible control, and each control a click opens (a menu's items), and fails one that changes nothing: not the page, the
// address, a field, the focus or the clipboard. A disabled control must say why in its tooltip. It finds pages, cases, tabs
// and sections by itself, so a new one is read without touching this file. --small: one width, every fifth case.
// It splits one mode's walk (Expert), not modes. The walk is split into units (one case of a page, or one route of
// index.html, at one width), each started in a fresh
// browser context at every worker count. --workers N runs them on N worker processes and prints the very same report:
// default the CPU count less one, at most 4, at least 1; any whole number of 1 or more; never more than the number of units;
// `--workers 1` walks in this process. Against the app (STILLHET_TARGET) each worker above 1 gets its own sandbox app. A unit
// with no result after 900 s fails the run. --units-json FILE writes each unit's clicks, findings and non-GET requests to the
// app. It imports its worker pool from tools/stillhet-compare.mjs (runPool, parseWorkers, startApp).
import { indexUrl, pageUrl, buildBundles } from './target.mjs';
import { readdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseWorkers, parseUnitsJson, clampWorkers, runPool, finishRun, installStopHandlers, startApp, OWN_SIGNALS } from '../../../../tools/stillhet-compare.mjs';

const dir = fileURLToPath(new URL('..', import.meta.url));
const THIS = fileURLToPath(import.meta.url);
/** A unit with no result after this long counts as a crash of its worker. */
export const CLICK_TIMEOUT_MS = 900000;
/** After a click: two animation frames, then the signature is read every 25 ms for up to 250 ms; the first changed one counts. */
export const SETTLE = { frames: 2, pollMs: 25, maxMs: 250 };
/** Pages walked as one unit per width, with today's shared page and resets (none: every page splits into units). */
const FALLBACK = [];
const EXPERT = () => { try { localStorage.setItem('worca-rail.mode', 'expert'); } catch { /* none */ } };   // the gates walk every place: Expert

// Every control in the page's own area: the prototype's corner and captured pages are not the design. Against the app
// (STILLHET_TARGET) the Stillhet UI switch is left out: it turns `rail` off on the server and reloads into dev's app, which
// would end the walk (test/stillhet-app-host.test.mjs pins what it does).
const APP_SKIP = process.env.STILLHET_TARGET ? ', [data-design-switch]' : '';
const CONTROLS = `(() => {
  const SEL = 'button, a[href], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="radio"], [role="switch"], input[type="checkbox"], input[type="radio"], select, summary';
  const out = []; const seen = new Set();
  for (const e of document.querySelectorAll(SEL)) {
    if (e.closest('.mk-bar, .mk-intro, .mk-proposed, #route-today, .rail-capture, [data-capture]${APP_SKIP}')) continue;
    if (!e.getClientRects().length || getComputedStyle(e).visibility === 'hidden') continue;
    const box = e.getBoundingClientRect(); if (box.right <= 0 || box.left >= innerWidth) continue;   // off the screen: a closed drawer
    const k = e.dataset.key || [...e.attributes].filter((a) => a.name.startsWith('data-') || a.name === 'id').map((a) => a.name + '=' + a.value).join('&') || (e.tagName + ':' + (e.getAttribute('aria-label') || e.textContent.trim().slice(0, 40)));
    if (seen.has(k)) continue; seen.add(k);
    if (e.getAttribute('href') && e.getAttribute('href') === location.hash) continue;   // a link to where you already are
    if (e.matches('[aria-selected="true"], [aria-current], [aria-checked="true"][role="radio"], [aria-checked="true"][role="menuitemradio"], [aria-pressed="true"]')) continue;   // already chosen: choosing it again rightly does nothing
    out.push({ k, off: e.disabled || e.getAttribute('aria-disabled') === 'true', why: e.title || e.closest('[title]')?.title || '', name: (e.getAttribute('aria-label') || e.textContent.trim()).slice(0, 40), tag: e.tagName });
  }
  return out;
})()`;
const signature = `(() => { const fields = [...document.querySelectorAll('input, select, textarea')].map((x) => x.type === 'checkbox' || x.type === 'radio' ? x.checked : x.value).join('|');
  return document.body.innerHTML.length + '#' + document.body.textContent + '#' + [...document.querySelectorAll('[aria-expanded],[aria-checked],[aria-selected],[aria-pressed],[class]')].map((x) => (x.getAttribute('aria-expanded') || '') + (x.getAttribute('aria-checked') || '') + (x.getAttribute('aria-selected') || '') + (x.getAttribute('aria-pressed') || '') + x.className).join() + '#' + location.hash + '#' + fields + '#' + (document.activeElement?.dataset?.key || document.activeElement?.id || document.activeElement?.tagName || ''); })()`;   // a field with no id (the composer) still counts as a focus move
const clickKey = (k) => `(() => { const SEL = 'button, a[href], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="radio"], [role="switch"], input[type="checkbox"], input[type="radio"], select, summary';
  for (const e of document.querySelectorAll(SEL)) { if (!e.getClientRects().length) continue;
    const k = e.dataset.key || [...e.attributes].filter((a) => a.name.startsWith('data-') || a.name === 'id').map((a) => a.name + '=' + a.value).join('&') || (e.tagName + ':' + (e.getAttribute('aria-label') || e.textContent.trim().slice(0, 40)));
    if (k === ${JSON.stringify(k)}) { if (e.tagName === 'SELECT') { const o = [...e.options].find((x) => x.value !== e.value); if (o) { e.value = o.value; e.dispatchEvent(new Event('change', { bubbles: true })); } return true; } e.click(); return true; } }
  return false; })()`;

/** The page's signature once a click has had time to act: the first one that differs from `before`, or the last read. */
export async function settledSignature(p, before) {
  await p.evaluate((n) => new Promise((done) => { const f = () => (--n <= 0 ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); setTimeout(done, 100); }), SETTLE.frames);
  const t = Date.now();
  for (;;) {
    const now = await p.evaluate(signature);
    if (now !== before || Date.now() - t >= SETTLE.maxMs) return now;
    await p.waitForTimeout(SETTLE.pollMs);
  }
}

async function sweep(p, where, reset, seen, rec) {
  const walk = async (path, depth) => {
    await reset(); for (const k of path) await p.evaluate(clickKey(k));
    const list = await p.evaluate(CONTROLS);
    let before = new Set();
    if (path.length) { await reset(); for (const k of path.slice(0, -1)) await p.evaluate(clickKey(k)); before = new Set((await p.evaluate(CONTROLS)).map((c) => c.k)); }
    for (const c of list) {
      if (before.has(c.k) || path.includes(c.k)) continue;
      const id = path.join('>') + '>' + c.k;
      if (seen.has(id)) continue; seen.add(id);
      if (c.off) { if (!c.why) rec.add('a disabled control that does not say why', `${where}: ${c.name}`); continue; }
      await reset(); for (const k of path) await p.evaluate(clickKey(k));
      const a = await p.evaluate(signature);
      rec.clicks++;
      if (!(await p.evaluate(clickKey(c.k)))) continue;
      const bb = await settledSignature(p, a);
      if (a === bb) rec.add('a dead control', `${where}: ${c.name || c.k}`);
      else if (depth > 0 && c.tag !== 'A' && await p.evaluate(`[...document.querySelectorAll('.menu, [role="menu"], [role="dialog"]')].some((x) => x.getClientRects().length)`)) await walk([...path, c.k], depth - 1);
    }
  };
  await walk([], 1);
}

/**
 * The units of the walk, in canonical order, from the per-width, per-page discovery ({ width, page, cases } or
 * { width, page, routes, places }, in WIDTHS × readdir order): { width, page, case, other } per case (`other` from the full
 * case list) and { width, page, route } per route, then per place. `small` keeps every fifth case and route. A page in
 * `fallback` is one { width, page, cases, all } or { width, page, routes } unit per width instead.
 */
export function listUnits(probe, { small = false, fallback = FALLBACK } = {}) {
  const thin = (xs) => (small ? xs.filter((_, i) => i % 5 === 0) : xs);
  return probe.flatMap(({ width, page, cases = [], routes = [], places = [] }) => {
    if (cases.length) {
      const list = thin(cases);
      if (fallback.includes(page)) return [{ width, page, cases: list, all: cases }];
      return list.map((c) => ({ width, page, case: c, other: cases[(cases.indexOf(c) + 1) % cases.length] }));
    }
    const list = [...thin(routes), ...places];
    if (fallback.includes(page)) return [{ width, page, routes: list }];
    return list.map((route) => ({ width, page, route }));
  });
}

/** Where a finding is: `run-page.html 1280 ready/logs`, `index.html 375 #settings/runs` (also a unit's label). */
export const unitWhere = (unit, tab = '') => (unit.case !== undefined ? `${unit.page} ${unit.width} ${unit.case}${tab ? '/' + tab : ''}`
  : unit.route !== undefined ? `${unit.page} ${unit.width} #${unit.route}` : `${unit.page} ${unit.width}`);

/** The units' findings replayed in their order into one map of kind → locations, and the clicks summed. */
export function mergeUnits(results) {
  const issues = new Map(); let clicks = 0;
  for (const r of results) {
    if (!r) continue;   // an unfinished unit: finishRun names it
    clicks += r.clicks;
    for (const [k, w] of r.issues) { if (!issues.has(k)) issues.set(k, new Set()); issues.get(k).add(w); }
  }
  return { clicks, issues };
}

/** The report: the click count, then each kind with its size and first 30 locations; code 1 when there is any. */
export function formatReport({ clicks, issues }) {
  const text = `${clicks} clicks · ` + (issues.size ? '\n' + [...issues].map(([k, v]) => `${k} (${v.size})\n   ${[...v].slice(0, 30).join('\n   ')}`).join('\n') : 'every control acts');
  return { lines: text.split('\n'), code: issues.size ? 1 : 0 };
}

/** Walks one unit in a fresh context of `browser`. Returns its clicks, its findings in order and its non-GET requests to the app. */
export async function runUnit(browser, unit) {
  const issues = [];
  const rec = { clicks: 0, add: (k, w) => issues.push([k, w]) };
  let writes = 0;
  const { width: w, page } = unit;
  const target = (process.env.STILLHET_TARGET || '').replace(/\/$/, '');
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce', permissions: [] });
  try {
    const p = await ctx.newPage();
    await p.addInitScript(EXPERT);
    p.on('pageerror', (e) => rec.add('script error', `${page} ${w}: ${e.message}`));
    if (target) p.on('request', (r) => { if (r.method() !== 'GET' && r.url().startsWith(target)) writes++; });
    await p.goto(pageUrl(page, dir + page)); await p.waitForTimeout(50);
    if (unit.case !== undefined || unit.cases) {
      const pick = (x) => p.evaluate((v) => { const s = document.querySelector('#case'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, x);
      for (const c of unit.cases || [unit.case]) {
        const other = unit.cases ? unit.all[(unit.all.indexOf(c) + 1) % unit.all.length] : unit.other;
        await pick(c);
        const tabs = await p.$$eval('.rc-tabs .tab', (x) => x.map((e) => e.dataset.tab));
        const seen = new Set();   // a control shared by a case's tabs counts once
        for (const t of tabs.length ? tabs : ['']) {
          await sweep(p, unitWhere({ width: w, page, case: c }, t), async () => { await pick(other); await pick(c); if (t) await p.evaluate((x) => document.querySelector(`.tab[data-tab="${x}"]`)?.click(), t); }, seen, rec);
        }
      }
    } else {
      // The one Worca: the shell on one place (captured pages are not the design), and every section of Settings.
      for (const r of unit.routes || [unit.route]) {
        const seen = new Set();
        await sweep(p, unitWhere({ width: w, page, route: r }), async () => { await p.evaluate((x) => { location.hash = x; }, r); await p.reload(); }, seen, rec);
      }
    }
  } finally { await ctx.close(); }
  return { clicks: rec.clicks, issues, writes };
}

// Every page at every width, opened once to read its cases, or (index.html) its routes and places.
async function discover(browser, small) {
  const HTML = readdirSync(dir).filter((f) => f.endsWith('.html') && f !== 'components.html');
  const probe = [];
  for (const width of small ? [1280] : [1280, 375]) {
    for (const page of HTML) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', permissions: [] });
      try {
        const p = await ctx.newPage();
        await p.addInitScript(EXPERT);
        await p.goto(pageUrl(page, dir + page)); await p.waitForTimeout(50);
        const cases = page === 'index.html' ? [] : await p.evaluate(() => [...document.querySelectorAll('#case option')].map((o) => o.value));   // the one Worca is read by route
        if (cases.length) { probe.push({ width, page, cases }); continue; }
        const routes = await p.evaluate(() => (window.SettingsModel ? ['runs', 'chat', ...window.SettingsModel.GROUPS.flatMap((g) => g.items).map((s) => 'settings/' + s)] : ['']));
        const places = await p.evaluate(() => Object.entries(window.RailPlaces || {}).flatMap(([k, m]) => [k, ...(m.sample ? [`${k}/${m.sample}`] : [])]));   // every place built on Rail, its list and one page
        probe.push({ width, page, routes, places });
      } finally { await ctx.close(); }
    }
  }
  return probe;
}

async function preflight() {
  let pw;
  try { pw = await import('playwright'); } catch (e) { throw new Error(`cannot load the browser library "playwright": ${e.message}`); }
  return { chromium: pw.chromium, browser: await pw.chromium.launch({ channel: 'chrome', ...OWN_SIGNALS }) };
}

// --workers 1: the units run here, in one browser, against this process's target.
const inProcess = (chromium) => ({
  start: async () => { const browser = await chromium.launch({ channel: 'chrome', ...OWN_SIGNALS }); return { browser, stop: () => browser.close().catch(() => {}) }; },
  run: (w, unit) => runUnit(w.browser, unit),
  stop: (w) => w.stop(),
});

/**
 * Worker processes for runPool: each a child of this script (`args`) on an IPC channel, answering `{ unit }` with
 * `{ result }`. Against the app (`target`) each first gets its own sandbox app, started one after another by the pool; a
 * file:// run passes the env unchanged. Children write nothing to stdout; the last 20 lines of their stderr are kept (`tail`).
 */
export function childWorkers({ args = [THIS, '--worker'], target = process.env.STILLHET_TARGET, start: startOne = startApp } = {}) {
  return {
    start: async () => {
      const w = { child: null, app: null, home: null, tail: [], pending: null };
      if (target) {
        w.home = await mkdtemp(join(tmpdir(), 'stillhet-click-'));
        try { w.app = await startOne(w.home, {}, { lockRail: true }); } catch (e) { await rm(w.home, { recursive: true, force: true }); throw e; }
      }
      const child = w.child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: w.app ? { ...process.env, STILLHET_TARGET: w.app.base } : process.env });
      let partial = '';
      const keep = (lines) => { w.tail.push(...lines.filter((l) => l.trim())); w.tail.splice(0, Math.max(0, w.tail.length - 20)); };
      child.stderr.on('data', (d) => { const lines = (partial + d).split('\n'); partial = lines.pop(); keep(lines); });
      const stderrDone = new Promise((r) => child.stderr.once('close', r));
      w.exited = new Promise((r) => child.once('exit', (code, sig) => r({ code, sig })));
      child.on('message', (m) => { const p = w.pending; w.pending = null; if (p) (m.error ? p.reject(new Error(m.error)) : p.resolve(m.result)); });
      w.exited.then(async ({ code, sig }) => {
        await Promise.race([stderrDone, new Promise((r) => setTimeout(r, 200))]);
        keep([partial]); partial = '';
        const p = w.pending; w.pending = null;
        p?.reject(new Error(`the worker exited (${sig || `code ${code}`}) mid-unit`));
      });
      w.stop = async () => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM');
          const killer = setTimeout(() => child.kill('SIGKILL'), 3000);
          await w.exited; clearTimeout(killer);
        }
        await w.app?.stop();
        if (w.home) await rm(w.home, { recursive: true, force: true });
      };
      return w;
    },
    run: (w, unit) => new Promise((resolve, reject) => {
      if (w.child.exitCode !== null || w.child.signalCode !== null) { reject(new Error('the worker has exited')); return; }
      w.pending = { resolve, reject };
      w.child.send({ unit }, (err) => { if (err && w.pending) { w.pending = null; reject(err); } });
    }),
    stop: (w) => w.stop(),
  };
}

// --worker: one child of the walk. Its own browser; never builds (the parent built once before it started).
async function workerMain() {
  const { chromium } = await import('playwright');
  const browser = chromium.launch({ channel: 'chrome', ...OWN_SIGNALS });
  browser.catch(() => {});   // a failed launch answers every unit with its error
  let quitting = false;
  const quit = async () => { if (quitting) return; quitting = true; await (await browser.catch(() => null))?.close().catch(() => {}); process.exit(0); };
  process.on('disconnect', quit); process.on('SIGTERM', quit);
  process.on('message', async ({ unit }) => {
    try { process.send({ result: await runUnit(await browser, unit) }); } catch (e) { process.send({ error: String(e?.message ?? e).split('\n')[0] }); }
  });
}

/** The walk. `deps` (tests): build, preflight, timeoutMs. Prints the report and returns the exit code. */
export async function main(argv = process.argv.slice(2), deps = {}) {
  let workers, unitsFile;
  try { workers = parseWorkers(argv); unitsFile = parseUnitsJson(argv); } catch (e) { console.error(e.message); return 2; }
  const small = argv.includes('--small');
  const live = new Set();
  let pre = null;
  const off = installStopHandlers(async () => {
    await pre?.browser?.close().catch(() => {});
    await Promise.allSettled([...live].map((halt) => halt()));
  });
  try {
    try { pre = await (deps.preflight || preflight)(); } catch (e) { console.error(e.message); return 2; }
    (deps.build || buildBundles)();   // the app's CSS and the Rail components for file:// (target.mjs); here, never in a worker
    let probe;
    try { probe = await discover(pre.browser, small); } finally { await pre.browser.close().catch(() => {}); }
    const units = listUnits(probe, { small });
    const n = clampWorkers(workers, units.length);
    const { results, unfinished } = await runPool({ units, workers: n, timeoutMs: deps.timeoutMs ?? CLICK_TIMEOUT_MS, live, ...(n === 1 ? inProcess(pre.chromium) : childWorkers()) });
    if (unitsFile) writeFileSync(unitsFile, JSON.stringify(units.map((unit, i) => (results[i] ? { unit, ...results[i] } : { unit, unfinished: true })), null, 1) + '\n');
    const { lines, code } = finishRun(formatReport(mergeUnits(results)), unfinished, unitWhere);
    console.log(lines.join('\n'));
    return code;
  } finally { off(); }
}

if (process.argv[1] === THIS) {
  if (process.argv.includes('--worker')) workerMain();
  else main().then((c) => process.stdout.write('', () => process.exit(c)), (e) => { console.error(e); process.exit(2); });
}
