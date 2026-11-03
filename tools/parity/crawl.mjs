// tools/parity/crawl.mjs — #919 final round: the differential crawler. One template per worker (built with A), then A twice
// (control), then each B; every screen in every variant × flag pass; full element exercise in the two exercise variants.
//   node tools/parity.mjs crawl --a T --b T [--b T …] [--b-screens T …] --out DIR [--workers N] [--screens GLOB] [--no-control] [--keep] [--dev SHA]
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { startTarget, fixedRoot, HOST_APP_PORT } from './launch.mjs';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { chromePath, chromeArgs, SEEDED_RANDOM, FROZEN_INTERVALS } from './flows.mjs';
export { SEEDED_RANDOM, FROZEN_INTERVALS };
import { holdRun, SEED_PROMPT } from './seed.mjs';
import { shapeKey } from './shape.mjs';
import { writeDiffPng } from './visual.mjs';
import { decodePNG } from '../../assets/promo-kit/tools/analyze.mjs';
import { buildTemplate } from './crawl-seed.mjs';
import { enumerateIn, serializeDom, actionsFor } from './crawl-page.mjs';
import { normalizeLine, deriveMasks, compareCrawls, coverage, mutated, loadCalls, renderCrawlReport } from './crawl-compare.mjs';
import { catalogue } from './crawl-routes.mjs';
import { appLines } from './stub-apps.mjs';
import { servedFingerprint } from './reuse.mjs';

export const VARIANTS = [
  { id: 'd-light-expert', width: 1280, height: 800, theme: 'light', level: 'expert', exercise: true },
  { id: 'm-light-expert', width: 375, height: 812, theme: 'light', level: 'expert', exercise: true },
  ...[['d', 1280, 800], ['m', 375, 812]].flatMap(([w, width, height]) => [
    { id: `${w}-dark-expert`, width, height, theme: 'dark', level: 'expert' },
    { id: `${w}-light-simple`, width, height, theme: 'light', level: 'simple' },
    { id: `${w}-dark-simple`, width, height, theme: 'dark', level: 'simple' },
    { id: `${w}-light-advanced`, width, height, theme: 'light', level: 'advanced' }]),
];
export const FLAG_PASSES = ['off', 'on'];
export const KEY_PROBES_EXTRA = ['Escape'];   // plus every key keys-sheet.mjs sheetSections() lists for the screen's page

/** Shard: route i goes to worker i % n, so worker k of A and of B see the same routes on the same template. */
export const shard = (routes, n, k) => routes.filter((_, i) => i % n === k);
const portFree = (port) => new Promise((ok) => { const s = createServer(); s.once('error', () => ok(false)); s.listen(port, '127.0.0.1', () => s.close(() => ok(true))); });
/** N consecutive free ports (never the host app's). Worker K's servers all listen on the K-th, on every side, so a page
 *  that prints its own URL (a failed dynamic import names it) reads the same everywhere: no port in a record differs. */
export async function freePortRun(n, { from = 47100 } = {}) {
  for (let base = from; base + n - 1 <= 65535; base += 1) {
    const run = Array.from({ length: n }, (_, i) => base + i);
    if (run.includes(HOST_APP_PORT)) continue;
    let ok = true;
    for (const p of run) if (!(await portFree(p))) { ok = false; base = p; break; }
    if (ok) return run;
  }
  throw new Error(`crawl: no ${n} consecutive free ports`);
}

/** The one worker that crawls a discovered route (FNV-1a of the pattern, mod n): stable across sides and runs. */
export function ownerOf(route, n) {
  let h = 0x811c9dc5;
  for (const c of route) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % n;
}

// every server this process started and has not stopped: a SIGINT/SIGTERM stops them before exiting (no orphans)
const LIVE = new Set();
const startLive = async (spec, opts) => { const t = await startTarget(spec, opts); LIVE.add(t); const stop = t.stop; t.stop = async () => { LIVE.delete(t); await stop(); }; return t; };
function onSignals() {
  const bye = (sig) => { for (const t of LIVE) { try { process.kill(t.pid, 'SIGTERM'); } catch {} } process.exit(sig === 'SIGINT' ? 130 : 143); };
  process.once('SIGINT', bye); process.once('SIGTERM', bye);
}
const openBrowser = () => chromium.launch({ executablePath: chromePath(), headless: true, args: chromeArgs() });
const OVERLAY = 'dialog[open], [role=dialog], [role=alertdialog], [role=menu], [role=listbox], [class*="-pop"], #info-bubble';
const MAX_DISCOVERED = 400;
const sha1 = (b) => createHash('sha1').update(b).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const globRe = (g) => new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

/** keys-sheet tokens → a Playwright key ('mod' is ⌘ on a Mac, Ctrl elsewhere, as list-keys.mjs isMac). */
export function chordKeys(chord, mac = process.platform === 'darwin') {
  const MOD = { mod: mac ? 'Meta' : 'Control', alt: 'Alt', shift: 'Shift', ctrl: 'Control' };
  const name = (k) => (k === 'Space' ? ' ' : k.length === 1 ? k.toLowerCase() : k);
  const mods = chord.filter((k) => MOD[k]).map((k) => MOD[k]);
  const keys = chord.filter((k) => !MOD[k]);
  // a chord without a modifier lists alternatives (['ArrowUp', 'ArrowDown'] is "↑ or ↓"); with one, it is one combo
  return mods.length ? [[...mods, ...keys.map(name)].join('+')] : keys.map(name);
}

/** The key probes of a route: its page's own sections; Anywhere's keys only once per pass (shared, like the chrome). */
export function keyProbes(sections, { anywhere = false } = {}) {
  const out = new Set();
  for (const s of sections) if (anywhere || s.list) for (const r of s.rows) for (const c of r.keys) for (const k of chordKeys(c)) out.add(k);
  for (const k of KEY_PROBES_EXTRA) out.add(k);
  return [...out];
}

/** Replace seed ids in a discovered hash with their `{key}`; null when an unknown id remains (a crawl-made entity). */
export function canonicalHash(hash, ids) {
  let h = hash;
  for (const [k, v] of Object.entries(ids).sort(([, a], [, b]) => String(b).length - String(a).length)) {
    if (v && String(v).length >= 4 && k !== 'projectPath') h = h.split(encodeURIComponent(String(v))).join(`{${k}}`).split(String(v)).join(`{${k}}`);
  }
  return /[0-9a-f]{8}|_[0-9a-f]{6,}/i.test(h.replace(/\{\w+\}/g, '')) ? null : h;
}

/** Content-addressed stores: dom/SHA.txt.gz and png/SHA.png (D10). */
function store(out) {
  const dirs = { dom: join(out, 'dom'), png: join(out, 'png') };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  const cache = new Map();
  return {
    putDom: (lines) => { const t = lines.join('\n'); const h = sha1(t); const f = join(dirs.dom, `${h}.txt.gz`); if (!existsSync(f)) writeFileSync(f, gzipSync(t)); return h; },
    putPng: (buf) => { const h = sha1(buf); const f = join(dirs.png, `${h}.png`); if (!existsSync(f)) writeFileSync(f, buf); return h; },
    dom: (h) => {
      if (!h) return [];
      if (!cache.has(h)) { if (cache.size > 3000) cache.clear(); const t = gunzipSync(readFileSync(join(dirs.dom, `${h}.txt.gz`))).toString('utf8'); cache.set(h, t ? t.split('\n') : []); }
      return cache.get(h);
    },
    png: (h) => readFileSync(join(dirs.png, `${h}.png`)),
    remove: () => { for (const d of Object.values(dirs)) rmSync(d, { recursive: true, force: true }); },
  };
}

async function api(t, path, body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(`${t.base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!r.ok) throw new Error(`crawl: ${method} ${path} -> ${r.status}`);
  return r.json();
}

/**
 * One worker of one side: a server on the worker's template, one Chrome, every route of its shard in every pass.
 * exercise false (a screen-level B, D7): screen records only, no elements and no key probes.
 */
export async function crawlSide(spec, { worker, workers = 1, port, fixed, template, routes, all = routes, ids, clock, out, store: st, log = () => {}, screens = null, exercise = true }) {
  mkdirSync(out, { recursive: true });
  const recFile = join(out, `records-w${worker}.ndjson`);
  writeFileSync(recFile, '');
  const records = []; const visits = []; const counts = { found: 0, exercised: 0, skipped: 0, byReason: {} };
  // every worker knows the whole catalogue; a discovered route not in it is crawled by its owner worker only
  const discovered = new Set(); const queue = [...routes]; const known = new Set(all);
  // routes are patterns ({projectKey}, {pipelineId}, …): each worker's template has its own ids, filled here
  const fill = (p) => p.replace(/\{(\w+)\}/g, (all, k) => (k !== 'held' && ids[k] != null ? encodeURIComponent(ids[k]) : all));
  let t = null; let held = null; let heldPid = null; let flagKeys = [];
  // the held run is made per server, so its run and pipeline ids differ on every side: normalised in every record
  const scrub = (x) => (held ? String(x).split(held).join('<held-run>') : String(x)).split(heldPid ?? '\0').join('<held-pid>');
  // the app stub's launches (stub-apps.mjs) since the last record become `app …` net lines; the canary log holds any app
  // program that ran for real, read before each stop (prepareRoot wipes home on the next start)
  let appsAt = 0; const canary = []; let apps = 0;
  const drainApps = () => {
    if (!t?.stubLog || !existsSync(t.stubLog)) return [];
    const text = readFileSync(t.stubLog, 'utf8'); const fresh = text.slice(appsAt); appsAt = text.length;
    const lines = appLines(fresh); apps += lines.length; return lines;
  };
  const collectCanary = () => { if (t?.canaryLog && existsSync(t.canaryLog)) canary.push(...readFileSync(t.canaryLog, 'utf8').split('\n').filter(Boolean).map(scrub)); };
  const start = async () => {
    // the server clock starts at the template's fixed time, the time the browser clock is fixed to (D5)
    t = await startLive(spec, { fixed, template, offline: true, clockMs: clock.now, ...(port ? { port } : {}) });
    appsAt = 0; held = null; heldPid = null;
    flagKeys = (await api(t, '/api/flags')).flags.filter((f) => !f.locked).map((f) => f.key).sort();
  };
  const reset = async () => { collectCanary(); await t.stop(); await start(); };
  const applyPass = async (flags, v) => {
    await api(t, '/api/flags', Object.fromEntries(flagKeys.map((k) => [k, flags === 'on'])), 'PATCH');
    await api(t, '/api/settings', { theme: v.theme, uiLevel: v.level });
  };
  const ensureHeld = async () => {
    if (held) return held;
    const { runId } = await api(t, '/api/run', { projectDir: ids.projectPath, prompt: `${SEED_PROMPT} (held)` });
    await holdRun(t, runId); held = runId;
    try { heldPid = (await api(t, `/api/ask/runs/${encodeURIComponent(runId)}`)).state?.id ?? null; } catch { heldPid = null; }
    return held;
  };
  const browser = await openBrowser();
  try {
    await start();
    for (const flags of FLAG_PASSES) {
      for (const v of VARIANTS) {
        await applyPass(flags, v);
        const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
        await context.clock.setFixedTime(new Date(clock.now));
        await context.addInitScript(SEEDED_RANDOM);
        await context.addInitScript(FROZEN_INTERVALS);
        const side = { net: [], console: [], pending: 0, lastIdle: Date.now(), bodies: [], prof: {} };
        const timed = async (k, fn) => { const s0 = Date.now(); try { return await fn(); } finally { side.prof[k] = (side.prof[k] ?? 0) + Date.now() - s0; } };
        // D9: every non-localhost request is aborted and recorded; popups closed; downloads cancelled; dialogs dismissed
        await context.route('**/*', (route) => {
          const u = new URL(route.request().url());
          if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
          side.net.push(`stubbed ${u.hostname}`); return route.abort();
        });
        let page = null;   // set before any popup can open: the context's 'page' event fires for this page too
        context.on('page', (p) => { if (page && p !== page) { side.net.push('popup closed'); p.close().catch(() => {}); } });
        page = await context.newPage();
        page.on('download', (d) => { side.net.push('download cancelled'); d.cancel().catch(() => {}); });
        page.on('dialog', (d) => { side.net.push(`dialog ${d.type()} dismissed`); d.dismiss().catch(() => {}); });
        page.on('console', (m) => { if (m.type() === 'error') side.console.push(normalizeLine(m.text()).slice(0, 300)); });
        page.on('pageerror', (e) => side.console.push(`pageerror: ${normalizeLine(String(e.message)).slice(0, 300)}`));
        const same = (url) => { try { return new URL(url).origin === new URL(t.base).origin; } catch { return false; } };
        const inflight = new Set();
        page.on('request', (r) => { if (same(r.url())) { side.pending += 1; inflight.add(r); side.lastIdle = Date.now(); } });
        const done = (r) => { if (same(r.url())) { side.pending = Math.max(0, side.pending - 1); side.lastIdle = Date.now(); inflight.delete(r); } };
        page.on('requestfailed', done);
        // a server push (a chat reply, a run state frame) is activity too: the quiet window waits for the WebSocket as well
        page.on('websocket', (ws) => ws.on('framereceived', () => { side.lastIdle = Date.now(); }));
        page.on('requestfinished', done);
        page.on('response', (r) => {
          if (!same(r.url())) return;
          const q = r.request(); const u = new URL(r.url());
          const path = normalizeLine(`${u.pathname}${u.search}`);
          let req = '-'; try { const pd = q.postData(); if (pd) req = shapeKey(JSON.parse(pd)); } catch { req = 'body'; }
          const isApi = u.pathname.startsWith('/api/');
          // static files are recorded only when they fail: whether a font or module came from the cache is timing, not behaviour
          if (!isApi && r.status() < 400) return;
          side.bodies.push((isApi ? r.text().then((x) => { try { return shapeKey(JSON.parse(x)); } catch { return 'text'; } }, () => '-') : Promise.resolve('-'))
            .then((res) => { side.net.push(`${q.method()} ${path} ${r.status()} ${req} ${res}`); }));
        });
        const settle = () => timed('settle', settleNow);
        const settleNow = async () => {
          const end = Date.now() + 8000;
          side.lastIdle = Math.max(side.lastIdle, Date.now());   // the quiet window starts at the action, not at the last finish
          // a chat turn in flight (Chat's Stop button, ask-panel.mjs data-ask-stop, shows while it streams) is waited out:
          // the mock reply arrives in WebSocket frames with gaps longer than the quiet window, and the transcript
          // rebuilds when it lands
          await page.waitForFunction(() => ![...document.querySelectorAll('[data-ask-stop]')].some((b) => !b.hidden && b.getBoundingClientRect().width > 0),
            null, { timeout: 20000 }).catch(() => {});
          await page.waitForSelector('section.view:not(.hidden)', { state: 'visible', timeout: 6000 }).catch(() => {});
          while (Date.now() < end && (side.pending > 0 || Date.now() - side.lastIdle < 300)) await sleep(50);
          if (process.env.CRAWL_DEBUG && side.pending > 0) log(`settle cap: ${[...inflight].map((r) => `${r.method()} ${r.url()}`).join(' ')}`);
          // every declared font face loaded, not only the ones requested so far: text that appears late otherwise renders
          // in a fallback face on one side (a #chat* smoke showed whole transcript lines in another font, DOM equal)
          await page.evaluate(() => Promise.all([...document.fonts].map((f) => f.load().catch(() => {})))
            .then(() => document.fonts.ready).then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))).catch(() => {});
          // DOM quiet: no mutation for 300 ms (cap 3 s), so a late repaint or a class flip (the graph's 160 ms gv-moving)
          // lands before the record
          await page.evaluate(() => new Promise((done) => {
            let t = setTimeout(fin, 300); const cap = setTimeout(fin, 3000);
            const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(fin, 300); });
            function fin() { mo.disconnect(); clearTimeout(t); clearTimeout(cap); done(); }
            mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
          })).catch(() => {});
          await Promise.all(side.bodies.splice(0));
        };
        // a step's record holds what the step did: its fresh load's requests and errors are the screen record's (keep)
        const fresh = async (hash, { keep = false } = {}) => {
          await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} }).catch(() => {});
          await timed('load', () => page.goto('about:blank'));
          // requests the old document had in flight are cancelled by the navigation, and Playwright reports no finish
          // for them: without this reset they stay "pending" for good and every settle waits out its 8 s cap
          side.pending = 0; inflight.clear(); side.lastIdle = Date.now();
          const h = fill(hash.includes('{held}') ? hash.replace('{held}', await ensureHeld()) : hash);
          await timed('load', async () => {
            await page.goto(`${t.base}/${h}`, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
            await page.waitForFunction(() => !!(window.__np && window.__np.getRun), null, { timeout: 15000 }).catch(() => {});
          });
          await settle();
          if (!keep) { side.net.length = 0; side.console.length = 0; }
        };
        const record = async (id, route, kind) => {
          await Promise.all(side.bodies.splice(0));
          side.net.push(...drainApps().map((x) => scrub(normalizeLine(x))));
          // string expressions: CDP evaluates them outside the page's CSP (a `new Function` in the page would be refused)
          const s = await timed('dom', () => page.evaluate(`(() => {
            const r = ${JSON.stringify(route)};
            const view = [...document.querySelectorAll('section.view:not(.hidden)')].some((el) => el.getBoundingClientRect().width > 0);
            const unknown = document.body.innerText.includes('is not a page. Opened Chat.');
            return { lines: (${serializeDom})(document, window), hash: location.hash, rendered: view && !unknown && (r.startsWith('#chat') || !location.hash.startsWith('#chat')),
              hrefs: [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href')) };
          })()`).catch((e) => ({ lines: [], hash: '', rendered: false, hrefs: [], err: String(e.message).split('\n')[0] })));
          // the held run's ids differ per server (the port does not: freePortRun)
          const mask = [held, heldPid].filter(Boolean).map((x) => page.getByText(x, { exact: false }));
          // visually stable: two consecutive shots 100 ms apart must match (up to 4), so a paint caught mid-transition is
          // never the record (a dev-vs-dev smoke showed an 18 px corner of a segmented control mid-paint after Escape)
          const shoot = () => page.screenshot({ animations: 'disabled', caret: 'hide', mask, maskColor: '#ff00ff' }).catch(() => null);
          const png = await timed('png', async () => {
            let prev = await shoot();
            for (let n = 0; n < 3 && prev; n += 1) { await sleep(100); const next = await shoot(); if (next && next.equals(prev)) return next; prev = next; }
            return prev;
          });
          const now = Date.now(); const ms = now - (side.lastRec ?? now); side.lastRec = now;   // diagnostics only, never compared
          const rec = { id, kind, route, ms, hash: scrub(normalizeLine(s.hash ?? '')), dom: st.putDom(s.lines.map((l) => scrub(normalizeLine(l)))), png: png ? st.putPng(png) : null,
            net: [...new Set(side.net.splice(0).map(scrub))].sort(), console: side.console.splice(0).map(scrub), rendered: s.rendered };
          if (s.err) rec.console.push(`record: ${normalizeLine(s.err).slice(0, 200)}`);
          records.push(rec); appendFileSync(recFile, `${JSON.stringify(rec)}\n`);
          for (const href of [...s.hrefs, s.hash]) {
            const c = href && canonicalHash(decodeURIComponent(href.split('?')[0]), ids);
            if (c && !known.has(c) && c !== '#' && discovered.size < MAX_DISCOVERED && (!screens || screens.test(c))) {
              known.add(c);
              if (ownerOf(c, workers) === worker) { discovered.add(c); queue.push(c); }
            }
          }
          return rec;
        };
        const enumerate = (overlaySel = null) => page.evaluate(`(() => {
          const r = ${overlaySel ? `[...document.querySelectorAll(${JSON.stringify(overlaySel)})].filter((el) => !window.__crawlBefore?.has(el) && el.getBoundingClientRect().width > 0).at(-1)` : 'document'};
          return r ? (${enumerateIn})(r, window, { keep: true }) : [];
        })()`).catch(() => []);
        const act = (i, step) => timed('act', () => actNow(i, step));
        const actNow = async (i, [verb, arg]) => {
          const h = await page.evaluateHandle((n) => window.__crawlEls?.[n], i);
          const el = h.asElement();
          if (!el) return 'gone';
          try {
            if (verb === 'click') await el.click({ timeout: 2500 });
            else if (verb === 'fill') await el.fill(arg, { timeout: 2500 });
            else if (verb === 'hover') await el.hover({ timeout: 2500 });
            else if (verb === 'press') await el.press(arg, { timeout: 2500 });
            else if (verb === 'selectNext') await el.evaluate((s) => { s.selectedIndex = (s.selectedIndex + 1) % Math.max(1, s.options.length); s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); });
            return 'ok';
          } catch (e) { return /Timeout/.test(e.message) ? 'timeout' : /detached|not attached/.test(e.message) ? 'detached' : 'error'; }
        };
        const markOverlays = () => page.evaluate((sel) => { window.__crawlBefore = new Set(document.querySelectorAll(sel)); }, OVERLAY).catch(() => {});
        const indexOf = (list, key) => list.findIndex((x) => x.key === key);
        const exercisedChrome = new Map();
        let anywhereDone = false;
        for (let qi = 0; qi < queue.length; qi += 1) {
          const route = queue[qi];
          const base = `${route}|${v.id}|${flags}`;
          await fresh(route, { keep: true });
          const screen = await record(`${base}|-|screen`, route, 'screen');
          const load = loadCalls(screen.net);
          visits.push({ route, rendered: screen.rendered, flags, variant: v.id });
          if (!v.exercise || !exercise) continue;
          const els = await enumerate();
          let dirty = false;
          for (const e of els) {
            counts.found += 1;
            const why = e.dupOf ? `duplicate of ${e.dupOf}` : e.chrome && exercisedChrome.has(e.key) ? `shared chrome, exercised on ${exercisedChrome.get(e.key)}` : e.disabled ? 'disabled' : null;
            if (why) { counts.skipped += 1; const r = why.replace(/ (of|on) .*/, ' $1 …'); counts.byReason[r] = (counts.byReason[r] ?? 0) + 1; continue; }
            if (e.chrome) exercisedChrome.set(e.key, route);
            counts.exercised += 1;
            const steps = actionsFor(e);
            await fresh(route);
            let i = indexOf(await enumerate(), e.key);
            if (i < 0) { await record(`${base}|${e.key}|gone`, route, 'step'); continue; }
            const netAll = [];
            for (const [n, step] of steps.entries()) {
              if (n === 0) await markOverlays();
              const res = await act(i, step);
              if (res !== 'ok') side.console.push(`action ${step[0]}: ${res}`);
              await settle();
              const rec = await record(`${base}|${e.key}|${n}`, route, 'step');
              netAll.push(...rec.net);
              // depth 2: an overlay the click opened — every element in it, each from a fresh load with the overlay re-opened
              if (n === 0 && step[0] === 'click') {
                const kids = await enumerate(OVERLAY);
                for (const c of kids) {
                  counts.found += 1;
                  if (c.dupOf || c.disabled) { counts.skipped += 1; const r = c.dupOf ? 'duplicate of …' : 'disabled'; counts.byReason[r] = (counts.byReason[r] ?? 0) + 1; continue; }
                  counts.exercised += 1;
                  await fresh(route);
                  const j = indexOf(await enumerate(), e.key);
                  if (j < 0) { await record(`${base}|${e.key}>${c.key}|gone`, route, 'step'); continue; }
                  await markOverlays(); await act(j, ['click']); await settle();
                  const ci = indexOf(await enumerate(OVERLAY), c.key);
                  if (ci < 0) { await record(`${base}|${e.key}>${c.key}|gone`, route, 'step'); continue; }
                  for (const [m, cs] of actionsFor(c).entries()) {
                    const r2 = await act(ci, cs);
                    if (r2 !== 'ok') side.console.push(`action ${cs[0]}: ${r2}`);
                    await settle();
                    netAll.push(...(await record(`${base}|${e.key}>${c.key}|${m}`, route, 'step')).net);
                  }
                  if (mutated(netAll, load)) { await reset(); await applyPass(flags, v); netAll.length = 0; }
                }
                await fresh(route); i = indexOf(await enumerate(), e.key);
                if (i < 0) break;
                await act(i, step); await settle();   // back to the state after step 0 for the next steps
              }
            }
            if (mutated(netAll, load)) dirty = true;
            if (dirty) { await reset(); await applyPass(flags, v); dirty = false; }
          }
          const sections = await page.evaluate(async (r) => (await import('/keys-sheet.mjs')).sheetSections({ advanced: true, page: r.startsWith('#chat') ? 'chat' : 'runs' }), route).catch(() => []);
          const onList = /^#(runs|chat)\b/.test(route);
          for (const key of keyProbes(onList ? sections : [], { anywhere: !anywhereDone })) {
            await fresh(route);
            await page.keyboard.press(key).catch(() => side.console.push(`action press: error`));
            await settle();
            const rec = await record(`${base}|key:${key}|0`, route, 'key');
            if (mutated(rec.net, load)) { await reset(); await applyPass(flags, v); }
          }
          anywhereDone = true;
        }
        await context.close();
        log(`crawl ${spec.label ?? spec.kind} w${worker}: ${flags}/${v.id} done (${queue.length} routes; ms ${Object.entries(side.prof).map(([k, n]) => `${k} ${n}`).join(', ')})`);
      }
    }
  } finally { collectCanary(); await browser.close().catch(() => {}); await t?.stop(); }
  return { records, visits, counts, discovered: [...discovered], apps, canary };
}

const treeOf = (spec) => {
  if (spec.kind !== 'tree') return null;
  try {
    const dirty = execFileSync('git', ['-C', spec.root, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim();
    return dirty ? null : execFileSync('git', ['-C', spec.root, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  } catch { return null; }
};

/** The report's sides, with the crawl reuse rule's inputs (tools/parity/reuse.mjs): `dev`, and a `served` fingerprint per tree side. */
export async function crawlSides({ a, bs, dev = null, tree = treeOf, fingerprint = servedFingerprint }) {
  const side = async (t, extra = {}) => ({ spec: t.label, ...extra, tree: tree(t), served: t.kind === 'tree' && t.root ? await fingerprint(t.root) : null });
  return { dev, a: await side(a), bs: await Promise.all(bs.map((b) => side(b, { level: b.level ?? 'full' }))) };
}

/** The registered routes, read in a running app (D5): PAGE_TITLES, SETTING_ENTRIES, GROUP_TABS, marketplace TABS, app.js. */
async function readCatalogue(spec, template, fixed, ids) {
  const t = await startLive(spec, { fixed, template, offline: true });
  const browser = await openBrowser();
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${t.base}/#chat/new`);
    await page.waitForFunction(() => !!(window.__np && window.__np.getRun), null, { timeout: 20000 });
    const src = await page.evaluate(async () => {
      const top = await import('/topnav.mjs'); const si = await import('/settings-index.mjs');
      const gp = await import('/group-page.mjs'); const mp = await import('/marketplace/page.mjs');
      return { views: Object.keys(top.PAGE_TITLES), cards: [...new Set(si.SETTING_ENTRIES.map((e) => e.href).filter(Boolean))],
        groupTabs: gp.GROUP_TABS, marketplaceTabs: [...mp.TABS], appJs: await (await fetch('/app.js')).text() };
    });
    return catalogue({ ...src, ids });
  } finally { await browser.close(); await t.stop(); }
}

/** A1 vs B per record, with masked rects zeroed; a differing PNG writes diffs/N.png. */
function pngTools(st, diffsDir) {
  let n = 0;
  const decode = (h) => decodePNG(st.png(h));
  const bbox = (a, b) => {
    if (a.width !== b.width || a.height !== b.height) return [0, 0, Math.max(a.width, b.width), Math.max(a.height, b.height)];
    let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
    for (let y = 0; y < a.height; y += 1) for (let x = 0; x < a.width; x += 1) {
      const k = (y * a.width + x) * 3;
      if (a.rgb[k] !== b.rgb[k] || a.rgb[k + 1] !== b.rgb[k + 1] || a.rgb[k + 2] !== b.rgb[k + 2]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
  };
  return {
    rect: (ha, hb) => (ha && hb ? bbox(decode(ha), decode(hb)) : [0, 0, 1e6, 1e6]),
    diff: (ha, hb, rects) => {
      if (!ha || !hb) return { pixels: ha === hb ? 0 : 1, diff: null };
      const a = decode(ha); const b = decode(hb);
      if (a.width !== b.width || a.height !== b.height) return { pixels: a.width * a.height, diff: null };
      const inMask = (x, y) => rects.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
      const mark = new Uint8Array(a.width * a.height); let pixels = 0;
      for (let y = 0; y < a.height; y += 1) for (let x = 0; x < a.width; x += 1) {
        const i = y * a.width + x; const k = i * 3;
        if ((a.rgb[k] !== b.rgb[k] || a.rgb[k + 1] !== b.rgb[k + 1] || a.rgb[k + 2] !== b.rgb[k + 2]) && !inMask(x, y)) { mark[i] = 1; pixels += 1; }
      }
      if (!pixels) return { pixels: 0 };
      n += 1; mkdirSync(diffsDir, { recursive: true });
      const file = join(diffsDir, `${n}.png`); writeDiffPng(file, { a, mark, width: a.width, height: a.height });
      return { pixels, diff: `diffs/${n}.png` };
    },
  };
}

/** Hydrated per record (DOM lines from the store), compared one id at a time to keep memory flat. */
function compareSides(a1all, b, masks, st, png, level = 'full') {
  const a1 = level === 'screen' ? a1all.filter((r) => r.kind === 'screen') : a1all;
  const byId = new Map(b.map((r) => [r.id, r]));
  const maskBy = new Map(); for (const m of masks) (maskBy.get(m.id) ?? maskBy.set(m.id, []).get(m.id)).push(m);
  const hyd = (r) => ({ ...r, dom: st.dom(r.dom) });
  const diffs = [];
  const one = (x, y) => compareCrawls(x ? [hyd(x)] : [], y ? [hyd(y)] : [], maskBy.get((x ?? y).id) ?? [], { pngDiff: png.diff, level }).diffs;
  for (const r of a1) diffs.push(...one(r, byId.get(r.id)));
  const ids = new Set(a1.map((r) => r.id));
  for (const s of b) if (!ids.has(s.id)) diffs.push(...one(null, s));
  return diffs;
}
function controlMasks(a1, a2, st, png) {
  const byId = new Map(a2.map((r) => [r.id, r]));
  const masks = [];
  for (const r of a1) {
    const s = byId.get(r.id);
    masks.push(...deriveMasks([{ ...r, dom: st.dom(r.dom) }], s ? [{ ...s, dom: st.dom(s.dom) }] : [], { pngDiff: png.rect }));
  }
  const ids = new Set(a1.map((r) => r.id));
  for (const s of a2) if (!ids.has(s.id)) masks.push({ id: s.id, field: 'presence', why: 'record on one control side only' });
  return masks;
}
/** The final hash after a step is part of the record: compared like a DOM line. */
const withHash = (recs) => recs.map((r) => ({ ...r, net: [...r.net, `hash ${r.hash}`] }));

/**
 * crawl({ a, bs, out, workers, screens, control, keep, dev, log }): a and bs are resolved specs ({ kind, ref, root|appDir, label,
 * level? }); a B with level 'screen' is crawled and compared at screen level (D7).
 * Writes out/report.json, out/report.md and out/masks.json; returns the report.
 */
export async function crawl({ a, bs, out, workers = 4, screens = null, control = true, keep = false, dev = null, log = console.log }) {
  const t0 = Date.now();
  onSignals();
  mkdirSync(out, { recursive: true });
  const st = store(out);
  const locks = Array.from({ length: workers }, (_, k) => fixedRoot(tmpdir(), `worca-parity-crawl-${k}`));
  try {
    // 1. templates (one per worker, built with A at that worker's fixed root)
    const templates = [];
    for (let k = 0; k < workers; k += 1) {
      const dir = join(out, 'templates', `w${k}`);
      const { ids, missing } = await buildTemplate(a, locks[k].root, dir, log);
      templates.push({ dir, ids, clock: JSON.parse(readFileSync(join(dir, 'clock.json'), 'utf8')) });
      log(`crawl: template w${k} built${missing.length ? `; not seeded: ${missing.join(', ')}` : ''}`);
    }
    const ids = templates[0].ids;
    // 2. the route catalogue, in A's page and in each B's
    const catA = await readCatalogue(a, templates[0].dir, locks[0].root, ids);
    const catalogueDiffs = [];
    for (const b of bs) {
      const catB = await readCatalogue(b, templates[0].dir, locks[0].root, ids);
      const sa = new Set(catA.registered); const sb = new Set(catB.registered);   // both filled from worker 0's ids
      for (const r of catA.registered) if (!sb.has(r)) catalogueDiffs.push(`${b.label}: ${r} registered in A only`);
      for (const r of catB.registered) if (!sa.has(r)) catalogueDiffs.push(`${b.label}: ${r} registered in B only`);
    }
    const ports = await freePortRun(workers);
    log(`crawl: worker ports ${ports[0]}–${ports.at(-1)}`);
    const sel = screens ? globRe(screens) : null;
    const pat = (r) => canonicalHash(decodeURIComponent(r), ids) ?? r;   // worker 0's ids → {key}: every worker fills its own
    const routes = [...new Set(catA.registered.map(pat))].filter((r) => !sel || sel.test(r)).sort();
    log(`crawl: ${routes.length} registered routes${catA.unfillable.length ? `, ${catA.unfillable.length} unfillable` : ''}; ${workers} workers`);
    // 3. A1, A2 (control), each B; the workers of a side in parallel
    const side = async (spec, name, { exercise = true } = {}) => {
      const parts = await Promise.all(templates.map((tp, k) => crawlSide(spec, { worker: k, workers, port: ports[k], fixed: locks[k].root, template: tp.dir, routes: shard(routes, workers, k), all: routes,
        ids: tp.ids, clock: tp.clock, out: join(out, name), store: st, log, screens: sel, exercise })));
      log(`crawl: side ${name} done (${Math.round((Date.now() - t0) / 60000)} min so far)`);
      return { records: withHash(parts.flatMap((p) => p.records)), visits: parts.flatMap((p) => p.visits),
        counts: parts.reduce((acc, p) => ({ found: acc.found + p.counts.found, exercised: acc.exercised + p.counts.exercised, skipped: acc.skipped + p.counts.skipped,
          byReason: Object.entries(p.counts.byReason).reduce((o, [k, n]) => ({ ...o, [k]: (o[k] ?? 0) + n }), acc.byReason) }), { found: 0, exercised: 0, skipped: 0, byReason: {} }),
        discovered: parts.flatMap((p) => p.discovered), apps: parts.reduce((n, p) => n + p.apps, 0), canary: parts.flatMap((p) => p.canary) };
    };
    const A1 = await side(a, 'a1');
    const A2 = control ? await side(a, 'a2') : null;
    const B = []; for (const [i, b] of bs.entries()) B.push(await side(b, `b${i + 1}`, { exercise: b.level !== 'screen' }));
    // 4. masks from the control, then A1 vs each B
    const png = pngTools(st, join(out, 'diffs'));
    const masks = A2 ? controlMasks(A1.records, A2.records, st, png) : [];
    const comparisons = B.map((x, i) => { const diffs = compareSides(A1.records, x.records, masks, st, png, bs[i].level); return { label: bs[i].label, level: bs[i].level ?? 'full', pass: !diffs.length, diffs }; });
    const externalApps = { stubbed: [A1, A2, ...B].filter(Boolean).reduce((n, x) => n + x.apps, 0), canary: [A1, A2, ...B].filter(Boolean).flatMap((x) => x.canary) };
    // 5. coverage over the union of visits (discovered routes count as registered)
    const registered = [...new Set([...routes, ...A1.discovered])].sort();
    const cov = coverage({ registered, visits: [A1, A2, ...B].filter(Boolean).flatMap((x) => x.visits) });
    const report = {
      pass: !!A2 && comparisons.every((c) => c.pass) && !cov.unvisited.length && !catA.unfillable.length && !catalogueDiffs.length && !externalApps.canary.length,
      control: !!A2, ...(await crawlSides({ a, bs, dev })), masks, comparisons, catalogueDiffs, externalApps,
      coverage: { screens: A1.visits.length, routes: { registered: registered.length, visited: cov.visited, unvisited: cov.unvisited, unfillable: catA.unfillable },
        elements: A1.counts, discovered: A1.discovered.length },
      masksPerRecord: Object.entries(masks.reduce((o, m) => ({ ...o, [m.id]: (o[m.id] ?? 0) + 1 }), {})).filter(([, n]) => n > 20).map(([id, n]) => ({ id, n })),
      minutes: Math.round((Date.now() - t0) / 60000),
    };
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
    writeFileSync(join(out, 'masks.json'), JSON.stringify({ aTree: report.a.tree, masks }, null, 2));
    writeFileSync(join(out, 'report.md'), renderCrawlReport(report));
    return report;
  } finally {
    for (const l of locks) l.release();
    if (!keep) st.remove();
  }
}
