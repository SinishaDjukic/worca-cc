#!/usr/bin/env node
// tools/verify-design-stage-cdp.mjs: the Design stage's real-browser proof (P4 Task 17), `npm run verify:design-stage`.
// Everything jsdom cannot show about the stage (layout, CSS transitions, `light-dark()`, WAAPI, the opaque frame, real
// wheels and real timing) is driven here through the real server, the real worca shell, the real stage and real frames.
//
//   node tools/verify-design-stage-cdp.mjs [--browser chromium|firefox|webkit]
//
// 1. Scratch HOME and WORCA_HOME first, before any store import. P1's store then seeds three web designs, each with a
//    `work/` written here: `stage` (12 sections, each `height:800px`: px, never `vh`, R20), `change` (a gallery of
//    unsized images above the sections a change round edits) and `leave` (one section whose script navigates its run
//    doc away: while the doc parses, then from a DOMContentLoaded handler, after its bridge said `ready`).
// 2. One `node ui/server.mjs` on a free port with WORCA_FLAGS=design and WORCA_MOCK=1. It runs no agents.
// 3. The page is the real shell at http://localhost:<port>/#design/<id>. A test driver pushes scripted C-5 frames
//    through `window.__design.pushFrame`, as P2's socket would (L4.31): no product path records or replays a build
//    (M1), and the frames name build ids the server does not hold, so a `subscribe` gets no snapshot. The frame, its
//    bridge, its `ready`, `rects` and `applied` are all real.
// 4. One `ok`/`FAIL` line per check of the plan's table; exit 1 on any FAIL.
//
// Chromium is the system Chrome (CHROME_BIN, else findChrome()), with --no-sandbox --disable-dev-shm-usage when
// CHROME_NO_SANDBOX=1 or the uid is 0. Firefox and WebKit are playwright-core's own builds. Playwright drives the
// browser over a pipe, so the proof takes no CDP port. Manual or CI only, never inside npm test (M14).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { chromium, firefox, webkit } from 'playwright-core';
import { findChrome } from '../assets/deck-preview/chrome.mjs';

const BROWSERS = { chromium, firefox, webkit };
const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const NAME = arg('--browser', 'chromium');
if (!Object.hasOwn(BROWSERS, NAME)) {
  console.error(`--browser must be chromium, firefox or webkit, not ${NAME}`);
  process.exit(2);
}
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HARD_LIMIT_MS = 420000;

// The stage the plan's numbers assume: a 1680 x 1000 window whose stage well is 900 px tall (M11's 776 = 900 - 96 - 28).
const VIEW_W = 1680;
const VIEW_H = 1000;
const STAGE_H = 900;
const PAGE_W = 1280;
const FLOOR = 0.45;
const BAND = 96;
const PAD = 14;
const SECTION_H = 800;
// The well painted a colour no page, overlay or blend makes (Task 1's probe did the same) while the ease is shot.
const WELL_MARK = [255, 0, 170];
const TEAL_DARK = 'rgb(134, 211, 202)';   // --teal-ink's dark arm
// R7 (Task 1's measure): a 2000 px/s scroll, judged in the parent's frames, "about one frame" = at most 1.5.
const R7_SPEED = 2000;
const R7_WARMUP = 10;
const R7_FRAMES = 120;
const R7_PASS = 1.5;
const EASE_SAMPLES = 25;
const FRAME_MS = 1000 / 60;

const JOBS = ['Nav', 'Hero', 'Proof', 'Features', 'Schedule', 'Steps', 'Coverage', 'API', 'Quotes', 'Pricing', 'FAQ', 'Closing', 'Footer'];
const SECS = JOBS.map((job, i) => ({ id: `s${i}`, job }));
const STAGE_SECS = SECS.slice(0, 12);
const SHADES = ['#0B0F16', '#101722', '#0D131C', '#121A26', '#0E1520', '#141C29', '#0C1119', '#111925', '#0F1621', '#131B28', '#0D121B', '#151E2C', '#0B1018'];
const GHOST_TEXT = 'Built for the nine minutes that matter.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HANG = Symbol('hang');
const within = (p, ms) => {
  let t;
  return Promise.race([p, new Promise((r) => { t = setTimeout(r, ms, HANG); })]).finally(() => clearTimeout(t));
};
const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : v);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

const NO_SIGNAL_HANDLERS = { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false };
function launchOptions(name, env) {
  if (name !== 'chromium') return { headless: true, env, ...NO_SIGNAL_HANDLERS };
  const executablePath = process.env.CHROME_BIN || findChrome();
  if (!executablePath) throw new Error('no Chrome found: set CHROME_BIN or WORCA_CHROME');
  const noSandbox = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0;
  return { executablePath, headless: true, env, args: noSandbox ? ['--no-sandbox', '--disable-dev-shm-usage'] : [], ...NO_SIGNAL_HANDLERS };
}

// --- PNG: a solid image for the seeds, and a decoder for the screenshots (8-bit RGB or RGBA, as Playwright writes). ---
function chunk(kind, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(kind, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(kind, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
function solidPng(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x += 1) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('screenshot is not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const kind = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (kind === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    off += 12 + len;
  }
  const channels = { 2: 3, 6: 4 }[type];
  if (depth !== 8 || !channels || interlace) throw new Error(`unsupported PNG: depth ${depth} type ${type} interlace ${interlace}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? data[dst + x - channels] : 0;
      const b = y ? data[dst - stride + x] : 0;
      const c = x >= channels && y ? data[dst - stride + x - channels] : 0;
      const v = raw[src + x];
      let out;
      if (f === 0) out = v;
      else if (f === 1) out = v + a;
      else if (f === 2) out = v + b;
      else if (f === 3) out = v + ((a + b) >> 1);
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`bad PNG filter ${f}`);
      data[dst + x] = out & 255;
    }
  }
  return { width, height, channels, data };
}
const near = (p, c, tol) => Math.abs(p[0] - c[0]) <= tol && Math.abs(p[1] - c[1]) <= tol && Math.abs(p[2] - c[2]) <= tol;

// --- The designs' work folders (the store's layout: plan.json, shell.html, global.css, sections/<id>/...). ---
const SHELL = '<!doctype html><html><head><meta charset="utf-8"><!--worca:head--></head><body><main><!--worca:sections--></main><!--worca:foot--></body></html>';
const GLOBAL_CSS = 'body{margin:0;background:#06080C;color:#EEF1F5;font:16px/1.5 system-ui,sans-serif}'
  + 'section{box-sizing:border-box;padding:56px 72px}h2{margin:0 0 16px;font-size:40px;line-height:1.1}p{margin:0 0 12px;color:#8B95A3}img{display:block}';
function writeWork(work, { title, sections, crew = null, files = {} }) {
  mkdirSync(path.join(work, 'sections'), { recursive: true });
  const plan = { v: 1, kind: 'web', title, canvas: { w: PAGE_W }, sections: sections.map((s) => ({ id: s.id, job: s.job, brief: 'b', parts: ['html', 'css'], estHeight: s.estHeight ?? SECTION_H })) };
  writeFileSync(path.join(work, 'plan.json'), JSON.stringify(plan));
  writeFileSync(path.join(work, 'shell.html'), SHELL);
  writeFileSync(path.join(work, 'global.css'), GLOBAL_CSS);
  if (crew) writeFileSync(path.join(work, '.crew.json'), JSON.stringify(crew));
  for (const s of sections) {
    mkdirSync(path.join(work, 'sections', s.id), { recursive: true });
    writeFileSync(path.join(work, 'sections', s.id, 'index.html'), s.html);
    writeFileSync(path.join(work, 'sections', s.id, 'style.css'), `[data-section="${s.id}"]{background:${s.shade}}`);
  }
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
    writeFileSync(path.join(work, rel), body);
  }
}
// The stage design's own writer: twelve sections, each exactly 800 px tall.
const stageSection = (s, i) => ({ ...s, shade: SHADES[i], html: `<section data-section="${s.id}" style="height:${SECTION_H}px"><h2>${s.job}</h2><p>Section ${i + 1} of 12, ${SECTION_H} px tall.</p></section>` });

// --- C-5 frames, shaped as P2 sends them (src/core/design/build.mjs, frames.mjs). ---
let seq = 0;
let idn = 0;
const hex = (n, w) => n.toString(16).padStart(w, '0');
const newBuildId = () => `b_${hex(0xb00000000000 + (idn += 1), 12)}`;
const newAgentId = () => `a_${hex(0xa0000000 + (idn += 1), 8)}`;
const stats = (o = {}) => ({ agentsNow: 0, agentsTotal: 0, sectionsDone: 0, sectionsPlanned: 12, failed: 0, layers: 0, costUsd: 0, estimatedUsd: 0, costKnown: true, elapsedMs: 0, ...o });
function framesFor(designId) {
  const env = (type, buildId) => ({ type, designId, buildId, seq: (seq += 1), ts: Date.now() });
  return {
    build: (b, status, o = {}) => ({ ...env('design-build', b), status, round: o.round ?? 1, kind: o.kind ?? 'first', reason: o.reason ?? null, waiting: o.waiting ?? 0, stats: stats(o.stats) }),
    plan: (b, secs, o = {}) => ({
      ...env('design-plan', b), planRev: o.planRev ?? 1, canvas: { w: PAGE_W },
      sections: secs.map((s) => ({ id: s.id, job: s.job, status: s.status ?? 'planned', estHeight: o.estHeight ?? s.estHeight ?? SECTION_H, parts: ['html', 'css'], agentId: null, summary: '' })),
    }),
    agent: (b, id, sec, status, o = {}) => ({
      ...env('design-agent', b), agentId: id, role: 'builder', job: sec.job, sectionId: sec.id, status, engine: 'claude', model: 'mock',
      tool: status === 'writing' ? { name: 'Write', path: `sections/${sec.id}/index.html` } : null,
      tokens: { in: 0, out: 0, cr: 0, cw: 0 }, costUsd: null, estimatedUsd: 0.12, costKnown: true, error: null, ...o,
    }),
    section: (b, id, status, o = {}) => ({ ...env('design-section', b), sectionId: id, status, agentId: o.agentId ?? null, summary: o.summary ?? '' }),
    delta: (b, agentId, sec, rev, text) => ({ ...env('design-delta', b), agentId, path: `sections/${sec.id}/index.html`, sectionId: sec.id, part: 'html', rev, splice: { at: 0, del: 0, text } }),
    file: (b, sec, rev, text) => ({ ...env('design-file', b), path: `sections/${sec.id}/index.html`, sectionId: sec.id, part: 'html', rev, sha256: '0'.repeat(64), bytes: text.length, text }),
  };
}

let home = null;
let server = null;
let browser = null;
let serverLog = '';
const stopServer = async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const gone = new Promise((r) => server.once('exit', r));
  try { server.kill(); } catch { /* gone */ }
  await Promise.race([gone, sleep(5000)]);
};
let finishing = null;
const finish = () => {
  finishing ??= (async () => {
    if (browser) await within(browser.close().catch(() => {}), 15000);
    await stopServer();
    if (home) await rm(home, { recursive: true, force: true }).catch(() => {});
  })();
  return finishing;
};
process.on('exit', () => {
  if (server && server.exitCode === null && server.signalCode === null) { try { server.kill(); } catch { /* gone */ } }
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { finish().finally(() => process.exit(130)); });
setTimeout(() => {
  console.log(`FAIL the proof did not finish within ${HARD_LIMIT_MS / 1000} s`);
  finish().finally(() => process.exit(1));
}, HARD_LIMIT_MS).unref();

try {
  home = await mkdtemp(path.join(tmpdir(), 'worca-dstage-home-'));
  const WH = path.join(home, '.worca-cc');
  await mkdir(WH, { recursive: true });
  const REAL_ENV = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };   // the browser keeps the real HOME
  Object.assign(process.env, { HOME: home, USERPROFILE: home, WORCA_HOME: WH, WORCA_TEST_ALLOW_HOME_FALLBACK: '1' });
  const browserEnv = { ...process.env };
  for (const [k, v] of Object.entries(REAL_ENV)) { if (v === undefined) delete browserEnv[k]; else browserEnv[k] = v; }
  const { createDesign } = await import('../src/core/design/store.mjs');
  const { designWorkDir } = await import('../src/core/design/paths.mjs');

  // The designs, seeded before the server starts, so only one process runs the first migration.
  const ids = { stage: createDesign({ kind: 'web', title: 'Stage proof' }).id, change: createDesign({ kind: 'web', title: 'Change round' }).id,
    leave: createDesign({ kind: 'web', title: 'Leaves its preview' }).id };
  writeWork(designWorkDir(ids.stage), { title: 'Stage proof', sections: STAGE_SECS.map(stageSection) });
  // `change`: c0 is a gallery of two unsized 1280 x 500 images, so the run doc grows 1000 px above c3 once they land.
  // c3, the section the change round edits, is 1600 px tall: one builder on it zooms the camera out to 776/1600.
  const CHANGE = [{ id: 'c0', job: 'Gallery', estHeight: 1100 }, ...['Steps', 'Coverage', 'API', 'Quotes', 'Pricing'].map((job, i) => ({ id: `c${i + 1}`, job, estHeight: i === 2 ? 2 * SECTION_H : SECTION_H }))];
  writeWork(designWorkDir(ids.change), {
    title: 'Change round',
    sections: CHANGE.map((s, i) => ({ ...s, shade: SHADES[i],
      html: i === 0 ? '<section data-section="c0"><h2>Gallery</h2><img src="assets/a.png" alt=""><img src="assets/b.png" alt=""></section>'
        : `<section data-section="${s.id}" style="height:${s.estHeight}px"><h2>${s.job}</h2><p>${s.estHeight} px.</p></section>` })),
    crew: CHANGE.map((s) => ({ id: s.id, status: 'done', summary: 's' })),
    files: { 'assets/a.png': solidPng(PAGE_W, 500, [0x2f, 0x52, 0x7a]), 'assets/b.png': solidPng(PAGE_W, 500, [0x7a, 0x52, 0x2f]) },
  });
  const LEAVE = { id: 'l0', job: 'Hero' };
  const leaveWork = designWorkDir(ids.leave);
  writeWork(leaveWork, {
    title: 'Leaves its preview',
    sections: [{ ...LEAVE, shade: SHADES[0], html: `<section data-section="l0" style="height:${SECTION_H}px"><h2>Hero</h2></section>` }],
    files: { 'sections/l0/script.js': "location.href = 'elsewhere.html';" },
  });

  const port = await freePort();   // never the inherited PORT (the host app's 4317)
  const childEnv = { ...process.env, WORCA_FLAGS: 'design', WORCA_MOCK: '1', PORT: String(port) };
  for (const k of ['FORCE_COLOR', 'WORCA_HOST_PID', 'WORCA_HOST', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME', 'WORCA_ALLOWED_HOSTS']) delete childEnv[k];
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'ui', 'server.mjs')],
    { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  const API = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 300 && !up && server.exitCode === null; i += 1) {
    try { up = (await fetch(`${API}/api/health`)).ok; } catch { /* starting */ }
    if (!up) await sleep(100);
  }
  if (!up) throw new Error(`server did not start on ${port}\n${serverLog}`);
  const postJson = (url, body) => fetch(`${API}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await postJson('/api/onboarding', { welcomeSeen: true });
  await postJson('/api/settings', { theme: 'light' });

  browser = await BROWSERS[NAME].launch(launchOptions(NAME, browserEnv));
  const ctx = await browser.newContext({ viewport: { width: VIEW_W, height: VIEW_H }, reducedMotion: 'no-preference', colorScheme: 'light' });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message).split('\n')[0]));
  await page.goto(`http://localhost:${port}/#design/${ids.stage}`, { waitUntil: 'load', timeout: 60000 });
  console.log(`# browser=${NAME} version=${browser.version()} os=${process.platform} page=http://localhost:<port>/#design/<id>`);
  // The page's own listeners: every `ready` it sees, with its origin and whether its source is a stage frame; and, per
  // frame, the order of its `loaded` reports and its `load` events (R16), to say how often a report came first.
  await page.evaluate(() => {
    document.getElementById('welcome-modal')?.remove();
    const vs = { readies: [], order: [] };
    window.__vs = vs;
    const ids = new WeakMap();
    const idOf = (o) => { if (!ids.has(o)) ids.set(o, vs.order.length + 1); return ids.get(o); };
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || typeof d !== 'object' || d.ns !== 'worca-design') return;
      if (d.t === 'loaded' && e.source) vs.order.push({ frame: idOf(e.source), kind: 'loaded', at: performance.now() });
      if (d.t !== 'ready') return;
      const frames = Array.from(document.querySelectorAll('iframe.dz-frame'));
      vs.readies.push({ origin: String(e.origin), mode: d.mode, fromFrame: frames.some((f) => f.contentWindow === e.source) });
    });
    // A `load` never reaches the window (DOM: the document is its last parent), so the document captures it.
    document.addEventListener('load', (e) => {
      const t = e.target;
      if (t instanceof HTMLIFrameElement && t.classList.contains('dz-frame') && t.contentWindow) vs.order.push({ frame: idOf(t.contentWindow), kind: 'load', at: performance.now() });
    }, true);
  });

  // --- Page helpers. ---
  const until = async (fn, argv, ms = 10000, every = 50) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await page.evaluate(fn, argv).catch(() => null);
      if (v || Date.now() > end) return v || null;
      await sleep(every);
    }
  };
  const push = (...frames) => page.evaluate((list) => { for (const f of list) window.__design.pushFrame(f); }, frames);
  const painted = (ms = 0) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);
  // What the stage shows now: the model's doc and camera, the box's scale and offsets, the counts.
  const look = () => page.evaluate(() => {
    const st = window.__design.stage();
    const m = st ? st.model() : null;
    const box = document.querySelector('.frame-box');
    const wrap = document.querySelector('.dz-wrap');
    const w = wrap ? wrap.getBoundingClientRect() : null;
    const b = box ? box.getBoundingClientRect() : null;
    const text = document.querySelector('.dz-hud-text')?.textContent ?? '';
    const n = /^(\d+) agents?\b/.exec(text);
    return {
      docMode: m?.docMode ?? null, nextMode: m?.nextMode ?? null, status: m?.status ?? null, rects: m ? Object.keys(m.rects).length : 0,
      camera: m?.camera ?? null, scroll: m?.scroll ?? null, s: box ? Number(box.style.getPropertyValue('--s')) : NaN,
      camMs: box ? box.style.getPropertyValue('--cam-ms') : '', boxH: box ? parseFloat(box.style.height) : NaN,
      wrap: w && { left: w.left, top: w.top, right: w.right, bottom: w.bottom, width: wrap.clientWidth, height: wrap.clientHeight },
      box: b && { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
      hudText: text, hudCount: n ? Number(n[1]) : null, dots: document.querySelectorAll('.dz-hud .dz-dots button').length,
      cursors: document.querySelectorAll('.dz-cursor:not(.is-leaving)').length, allCursors: document.querySelectorAll('.dz-cursor').length,
      iframes: document.querySelectorAll('iframe.dz-frame').length, follow: Array.from(document.querySelectorAll('.dz-hud-acts button')).some((x) => x.textContent === 'Follow'),
      lost: document.querySelector('.dz-lost') ? !document.querySelector('.dz-lost').hidden : false,
    };
  });
  const fitNow = (L) => L.wrap.width / PAGE_W;
  const expectScale = (L, span) => Math.min(fitNow(L), Math.max(FLOOR, (L.wrap.height - BAND - 2 * PAD) / span));
  // Waits for the stage to show `mode`'s doc, alone and ready, with `rects` for `n` sections.
  const waitDoc = (mode, n, ms = 15000) => until(({ mode, n }) => {
    const m = window.__design.stage()?.model();
    return !!m && m.docMode === mode && m.nextMode == null && document.querySelectorAll('iframe.dz-frame').length === 1
      && Object.keys(m.rects).length >= n;
  }, { mode, n }, ms);
  const curFrame = async () => {
    const h = await page.$('iframe.dz-frame:not(.is-next)');
    return h ? h.contentFrame() : null;
  };
  const frameScroll = async () => { const f = await curFrame(); return f ? f.evaluate(() => scrollY).catch(() => NaN) : NaN; };
  // A point in the frame that no cursor, HUD or popover covers, for real wheels and clicks.
  const framePoint = () => page.evaluate(() => {
    const f = document.querySelector('iframe.dz-frame:not(.is-next)');
    const r = f.getBoundingClientRect();
    const w = document.querySelector('.dz-wrap').getBoundingClientRect();
    const left = Math.max(r.left, w.left);
    const right = Math.min(r.right, w.right);
    const top = Math.max(r.top, w.top);
    const bottom = Math.min(r.bottom, w.bottom - 110);
    for (let fy = 0.3; fy < 0.95; fy += 0.07) {
      for (let fx = 0.15; fx < 0.9; fx += 0.07) {
        const x = left + (right - left) * fx;
        const y = top + (bottom - top) * fy;
        if (document.elementFromPoint(x, y) === f) return { x, y };
      }
    }
    return null;
  });
  const openDesign = async (id) => {
    await page.evaluate((h) => { location.hash = h; }, `#design/${id}`);
    const ok = await until((id) => {
      const st = window.__design?.stage();
      const wrap = document.querySelector('.dz-wrap');
      return !!st && st.model().designId === id && !!wrap && wrap.clientHeight > 0;
    }, id, 15000);
    if (!ok) throw new Error(`design ${id} did not open`);
    await painted();
  };
  const leaveDesign = async () => {
    await page.evaluate(() => { location.hash = '#design'; });
    await until(() => window.__design.stage() === null, null, 10000);
  };

  // The stage's well must be 900 px tall for the plan's 776; the window's height makes it so.
  await openDesign(ids.stage);
  let L = await look();
  let viewH = VIEW_H + (STAGE_H - L.wrap.height);
  if (viewH !== VIEW_H) {
    await page.setViewportSize({ width: VIEW_W, height: viewH });
    await until((h) => document.querySelector('.dz-wrap').clientHeight === h, STAGE_H, 5000);
  }
  L = await look();
  console.log(`# stage ${L.wrap.width}x${L.wrap.height} at (${r1(L.wrap.left)}, ${r1(L.wrap.top)}) in a ${VIEW_W}x${viewH} window; fit ${r3(fitNow(L))}`);

  const S = framesFor(ids.stage);
  const sec = (i) => SECS[i];
  // Starts builders on sections; returns their agent ids by section index.
  const crew = {};
  const start = (b, idxs) => {
    const out = [];
    for (const i of idxs) {
      const id = newAgentId();
      crew[i] = id;
      out.push(S.agent(b, id, sec(i), 'writing'), S.section(b, sec(i).id, 'writing', { agentId: id }));
    }
    return out;
  };
  const end = (b, idxs, status = 'done') => {
    const out = [];
    for (const i of idxs) {
      out.push(S.agent(b, crew[i], sec(i), status), S.section(b, sec(i).id, status, { agentId: crew[i], summary: status === 'done' ? `${sec(i).job} written` : '' }));
      delete crew[i];
    }
    return out;
  };
  const settleCamera = () => sleep(750);

  // ======== Round 1 (first): the camera, cursors, HUD, ghost, R7 and the round's end. ========
  const B1 = newBuildId();
  await push(S.build(B1, 'planning'), S.plan(B1, STAGE_SECS));
  if (!await waitDoc('build', 12)) throw new Error(`round 1: no build doc with 12 rects\n${JSON.stringify(await look())}`);
  await push(S.build(B1, 'building', { stats: { agentsNow: 3, agentsTotal: 3 } }), ...start(B1, [3, 4, 5]));
  await settleCamera();
  L = await look();
  const fit2400 = { s: L.s, expect: expectScale(L, 3 * SECTION_H) };

  // HUD radius and height as painted.
  const hudBox = await page.evaluate(() => {
    const h = document.querySelector('.dz-hud');
    const cs = getComputedStyle(h);
    return { radii: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius], height: h.getBoundingClientRect().height };
  });
  check('HUD radius is 8px', hudBox.radii.every((r) => r === '8px') && Math.abs(hudBox.height - 44) < 0.01,
    `border radius ${hudBox.radii.join(' ')}, height ${r1(hudBox.height)} px`);

  // The crew colours: the second builder holds --teal-ink; in a light page its label paints the dark arm.
  const colours = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--teal-ink)';
    document.body.append(probe);
    const pageTeal = getComputedStyle(probe).color;
    probe.remove();
    const cur = Array.from(document.querySelectorAll('.dz-cursor')).find((c) => c.style.getPropertyValue('--crew') === 'var(--teal-ink)');
    const label = cur?.querySelector('.dz-cursor-label');
    return { pageTeal, label: label ? getComputedStyle(label).backgroundColor : null, arrow: cur ? getComputedStyle(cur.querySelector('svg')).fill : null,
      scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', theme: document.documentElement.dataset.theme ?? '' };
  });
  check('crew colours are the dark arm in a light page', colours.label === TEAL_DARK && colours.arrow === TEAL_DARK && colours.pageTeal !== TEAL_DARK,
    `page theme ${colours.theme || colours.scheme}: --teal-ink in the page ${colours.pageTeal}; on the stage, the label ${colours.label}, the arrow ${colours.arrow}`);

  // Hide cursors: none drawn, the HUD keeps its text and dots.
  const beforeHide = await look();
  await page.locator('.dz-hud-acts button[aria-label="Hide cursors"]').click();
  await painted();
  const hiddenL = await look();
  await page.locator('.dz-hud-acts button[aria-label="Show cursors"]').click();
  await painted();
  const shownL = await look();
  check('hide cursors keeps the count', beforeHide.cursors === 3 && hiddenL.allCursors === 0 && hiddenL.hudText === beforeHide.hudText
    && hiddenL.dots === beforeHide.dots && shownL.cursors === 3,
    `before: ${beforeHide.cursors} cursors, "${beforeHide.hudText}"; hidden: ${hiddenL.allCursors} cursors, "${hiddenL.hudText}", ${hiddenL.dots} dots; shown again: ${shownL.cursors}`);

  // Enter and leave at 0.45: a cursor's first painted place, and where a leaving one is sent.
  await page.evaluate(() => {
    const vs = window.__vs;
    vs.enters = [];
    vs.leaves = [];
    const layer = document.querySelector('.overlay-doc.is-cursors');
    const wrapR = () => document.querySelector('.dz-wrap').getBoundingClientRect();
    vs.obs?.disconnect();
    vs.obs = new MutationObserver((list) => {
      for (const m of list) {
        for (const n of m.addedNodes) {
          if (!(n instanceof HTMLElement) || !n.classList.contains('dz-cursor') || n.classList.contains('is-leaving')) continue;
          const r = n.getBoundingClientRect();
          vs.enters.push({ label: n.textContent, left: r.left, top: r.top });
        }
        if (m.type === 'attributes' && m.target.classList.contains('is-leaving') && !m.target.__vsLeave) {
          const el = m.target;
          const rec = { label: el.textContent, lefts: [], x: null };
          el.__vsLeave = rec;
          vs.leaves.push(rec);
          const tick = () => {
            if (!el.isConnected) { rec.gone = true; return; }
            rec.lefts.push(el.getBoundingClientRect().left);
            const x = parseFloat(el.style.getPropertyValue('--x'));
            if (Number.isFinite(x)) rec.x = x;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      }
    });
    vs.obs.observe(layer, { childList: true, attributes: true, subtree: true, attributeFilter: ['class'] });
    vs.wrapR = wrapR;
  });
  await push(...start(B1, [6]));
  await sleep(1200);
  await push(...end(B1, [6]));
  await sleep(1400);
  const edge = await page.evaluate(() => {
    const vs = window.__vs;
    vs.obs.disconnect();
    const w = document.querySelector('.dz-wrap').getBoundingClientRect();
    const box = document.querySelector('.frame-box');
    const b = box.getBoundingClientRect();
    const layer = document.querySelector('.overlay-doc.is-cursors').getBoundingClientRect();
    return { enters: vs.enters, leaves: vs.leaves.map((l) => ({ ...l, lefts: l.lefts.slice(-3) })), wrapLeft: w.left, wrapRight: w.right, pageRight: b.right,
      layerLeft: layer.left, s: Number(box.style.getPropertyValue('--s')) };
  });
  const enter = edge.enters.find((e) => e.label === sec(6).job);
  const leave = edge.leaves.find((e) => e.label === sec(6).job);
  const leaveX = leave && Number.isFinite(leave.x) ? edge.layerLeft + leave.x * edge.s : NaN;
  check('cursors enter and leave at the stage edge',
    Math.abs(edge.s - FLOOR) < 0.001 && !!enter && enter.left > edge.pageRight && enter.left < edge.wrapRight && !!leave && leave.gone === true && leaveX >= edge.wrapRight,
    `scale ${r3(edge.s)}; page edge ${r1(edge.pageRight)}, stage ${r1(edge.wrapLeft)}..${r1(edge.wrapRight)}; `
      + `enter first painted at x ${enter ? r1(enter.left) : 'never'}; leave sent to x ${r1(leaveX)}, last seen at ${leave ? leave.lefts.map(r1).join(', ') : 'never'}, removed ${leave?.gone === true}`);

  // The camera fits the crew: 3 sections spanning 2400 px (the floor), then, the slots at 400 px, 3 spanning 1200.
  await push(S.plan(B1, STAGE_SECS, { planRev: 2, estHeight: SECTION_H / 2 }));
  await until(() => window.__design.stage().model().rects.s4?.[3] === 400, null, 5000);
  await push(...end(B1, [3]), ...start(B1, [6]));
  await settleCamera();
  await painted();
  L = await look();
  const parked1200 = await page.evaluate(async () => {
    const M = await import('/design/stage-model.mjs');
    const st = window.__design.stage().model();
    const lay = M.selectLayout(st);
    const placed = M.placeCursors(M.selectCursors(st), { scrollY: st.scroll.y, s: lay.s, ox: lay.ox, oy: lay.oy, stageW: lay.stageW, stageH: lay.stageH, frameW: lay.frameW });
    return { parked: placed.map((c) => c.parked), arrows: document.querySelectorAll('.dz-cursor-label .ic').length };
  }).catch((e) => ({ error: String(e && e.message).split('\n')[0] }));
  const fit1200 = { s: L.s, expect: expectScale(L, 3 * SECTION_H / 2) };
  check('the camera fits the crew',
    L.wrap.height === STAGE_H && Math.abs(fit2400.s - fit2400.expect) < 0.001 && Math.abs(fit2400.expect - FLOOR) < 1e-9
      && Math.abs(fit1200.s - fit1200.expect) < 0.001 && Math.abs(fit1200.expect - 776 / 1200) < 1e-9
      && Array.isArray(parked1200.parked) && parked1200.parked.length === 3 && parked1200.parked.every((p) => p === 0) && parked1200.arrows === 0,
    `stage ${L.wrap.height} px tall; 2400 px span: --s ${r3(fit2400.s)} (776/2400 = 0.323, floor ${FLOOR}); 1200 px span: --s ${r3(fit1200.s)} (776/1200 = ${r3(776 / 1200)}); `
      + `parked ${JSON.stringify(parked1200.parked ?? parked1200.error)}, ${parked1200.arrows} label arrows`);

  // Parked only past 0.45: a crew spanning 4000 px. The far cursor is parked on the HUD band, the near one is not.
  await push(S.plan(B1, STAGE_SECS, { planRev: 3 }));
  await until(() => window.__design.stage().model().rects.s4?.[3] === 800, null, 5000);
  await push(...end(B1, [5, 6]), ...start(B1, [0]));
  await settleCamera();
  await painted();
  const park = await page.evaluate((jobs) => {
    const label = (job) => Array.from(document.querySelectorAll('.dz-cursor:not(.is-leaving) .dz-cursor-label')).find((l) => l.textContent === job);
    const far = label(jobs.far);
    const nearL = label(jobs.near);
    return { s: Number(document.querySelector('.frame-box').style.getPropertyValue('--s')), far: far ? !!far.querySelector('.ic') : null, near: nearL ? !!nearL.querySelector('.ic') : null };
  }, { far: sec(4).job, near: sec(0).job });
  check('parked only past 0.45', Math.abs(park.s - FLOOR) < 0.001 && park.far === true && park.near === false,
    `crew ${sec(0).id} and ${sec(4).id} span 4000 px; --s ${r3(park.s)}; far cursor (${sec(4).job}) arrow ${park.far}, near cursor (${sec(0).job}) arrow ${park.near}`);

  // The box covers the stage during the ease: a zoom in from 0.45 to fit (the crew drops to s4), seeked at every
  // 16.7 ms frame of its 400 ms transition, the stage's bottom row shot each time; then once live, every frame.
  const seekEase = (t) => page.evaluate((t) => {
    const box = document.querySelector('.frame-box');
    getComputedStyle(box).transform;
    const a = box.getAnimations().find((x) => x.transitionProperty === 'transform' || x.effect?.getKeyframes?.().some((k) => 'transform' in k));
    if (!a) return { anim: false, h: parseFloat(box.style.height) };
    a.pause();
    a.currentTime = t;
    const b = box.getBoundingClientRect();
    return { anim: true, h: parseFloat(box.style.height), left: b.left, right: b.right, bottom: b.bottom };
  }, t);
  const easeEnd = () => page.evaluate(() => { for (const a of document.querySelector('.frame-box').getAnimations()) a.finish(); });
  const ease = { shots: 0, well: 0, worst: 0, short: 0, noAnim: 0, heights: new Set() };
  await page.evaluate(() => document.querySelector('.dz-wrap').style.setProperty('background', 'rgb(255, 0, 170)', 'important'));
  for (let k = 0; k < EASE_SAMPLES; k += 1) {
    const t = Math.min(400, k * FRAME_MS);
    await push(...end(B1, [0]));
    const at = await seekEase(t);
    if (!at.anim) { ease.noAnim += 1; await easeEnd(); await push(...start(B1, [0])); await sleep(500); continue; }
    ease.heights.add(at.h);
    const w = await look();
    const shot = decodePng(await page.screenshot({ clip: { x: w.wrap.left, y: w.wrap.bottom - 1, width: w.wrap.right - w.wrap.left, height: 1 } }));
    let well = 0;
    for (let x = Math.ceil(at.left - w.wrap.left) + 1; x < Math.floor(at.right - w.wrap.left) - 1; x += 1) {
      const i = x * shot.channels;
      if (near([shot.data[i], shot.data[i + 1], shot.data[i + 2]], WELL_MARK, 40)) well += 1;
    }
    ease.shots += 1;
    if (well) ease.well += 1;
    ease.worst = Math.max(ease.worst, well);
    if (at.bottom < w.wrap.bottom - 0.5) ease.short += 1;
    await easeEnd();
    await sleep(80);
    await push(...start(B1, [0]));
    await sleep(500);
  }
  await page.evaluate(() => document.querySelector('.dz-wrap').style.removeProperty('background'));
  // Live: the same zoom in, unpaused; every animation frame the box's bottom against the stage's.
  await push(...end(B1, [0]));
  const live = await page.evaluate(() => new Promise((resolve) => {
    const box = document.querySelector('.frame-box');
    const wrap = document.querySelector('.dz-wrap').getBoundingClientRect();
    const out = { frames: 0, short: 0, least: Infinity };
    const t0 = performance.now();
    const tick = () => {
      const b = box.getBoundingClientRect();
      out.frames += 1;
      out.least = Math.min(out.least, b.bottom - wrap.bottom);
      if (b.bottom < wrap.bottom - 0.5) out.short += 1;
      if (performance.now() - t0 < 600) requestAnimationFrame(tick);
      else resolve(out);
    };
    requestAnimationFrame(tick);
  }));
  await settleCamera();
  L = await look();
  const tallH = STAGE_H / FLOOR;
  check('the box covers the stage during the ease',
    ease.shots === EASE_SAMPLES && ease.well === 0 && ease.short === 0 && live.short === 0 && Math.abs(L.s - fitNow(L)) < 0.001
      && [...ease.heights].every((h) => Math.abs(h - tallH) < 0.5),
    `zoom in ${FLOOR} -> fit ${r3(fitNow(L))}: ${ease.shots} of ${EASE_SAMPLES} seeked frames shot (${ease.noAnim} without a transition), the well under the page in ${ease.well} `
      + `(worst ${ease.worst} px of the row), box short of the stage in ${ease.short}; box height while easing ${[...ease.heights].map(r1).join('/')} px; `
      + `live, ${live.frames} frames: short in ${live.short}, least margin ${r1(live.least)} px`);

  // Follow: a real wheel over the frame stops the camera, Follow shows, and clicking it brings the camera back.
  const followBefore = await look();
  const pt = await framePoint();
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.wheel(0, 900);
  const followShown = await until(() => Array.from(document.querySelectorAll('.dz-hud-acts button')).some((x) => x.textContent === 'Follow'), null, 4000);
  const scrolledTo = await frameScroll();
  await page.locator('.dz-hud-acts button', { hasText: 'Follow' }).click();
  await settleCamera();
  const followAfter = await look();
  const backTo = await frameScroll();
  check('Follow appears after a scroll and brings the camera back',
    !followBefore.follow && !!followShown && Math.abs(scrolledTo - followBefore.scroll.y) > 100 && followAfter.camera.on === true && !followAfter.follow
      && Math.abs(backTo - followAfter.camera.y) <= 1 && Math.abs(backTo - followBefore.camera.y) <= 1,
    `Follow before the wheel ${followBefore.follow}; camera y ${r1(followBefore.camera.y)}; after page.mouse.wheel(0, 900): Follow ${!!followShown}, frame at ${r1(scrolledTo)}; `
      + `after Follow: camera on ${followAfter.camera.on}, y ${r1(followAfter.camera.y)}, frame at ${r1(backTo)}, Follow shown ${followAfter.follow}`);

  // Ctrl wheel over the frame: a zoom out to the floor, and the camera stops.
  const zoomBefore = await look();
  await page.mouse.move(pt.x, pt.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 100);
  await page.keyboard.up('Control');
  await until((s) => Number(document.querySelector('.frame-box').style.getPropertyValue('--s')) !== s, zoomBefore.s, 4000);
  await painted(100);
  const zoomAfter = await look();
  check('ctrl wheel zooms and stops the camera',
    Math.abs(zoomBefore.s - fitNow(zoomBefore)) < 0.001 && Math.abs(zoomAfter.s - FLOOR) < 0.001 && zoomAfter.camera.on === false && zoomAfter.follow && zoomAfter.camMs === '0ms',
    `--s ${r3(zoomBefore.s)} -> ${r3(zoomAfter.s)} (0ms); camera on ${zoomAfter.camera.on}; Follow shown ${zoomAfter.follow}`);
  await page.locator('.dz-hud-acts button', { hasText: 'Follow' }).click();
  await settleCamera();

  // The ghost: s4's builder writes a paragraph (not final), so the bridge holds it; its end settles it crisp.
  const ghostHtml = `<section style="height:${SECTION_H}px"><h2>${sec(4).job}</h2><p>${GHOST_TEXT}</p></section>`;
  let rev4 = 1;
  await push(S.delta(B1, crew[4], sec(4), rev4, ghostHtml));
  const frame4 = await curFrame();
  const heldAt = Date.now();
  const held = await (async () => {
    for (;;) {
      const g = await frame4.evaluate((text) => {
        const p = document.querySelector('[data-section="s4"] p');
        if (!p || p.textContent !== text) return null;
        return { ghost: document.getAnimations().filter((a) => a.id === 'worca-ghost' && a.effect?.target === p).map((a) => a.playState) };
      }, GHOST_TEXT).catch(() => null);
      if ((g && g.ghost.length) || Date.now() - heldAt > 6000) return g;
      await sleep(50);
    }
  })();
  await push(...end(B1, [4]));
  const settledAt = Date.now();
  await sleep(700);
  const crisp = await frame4.evaluate(() => {
    const p = document.querySelector('[data-section="s4"] p');
    return { ghost: document.getAnimations().filter((a) => a.id === 'worca-ghost').length, html: p ? p.outerHTML : null };
  }).catch((e) => ({ error: String(e && e.message).split('\n')[0] }));
  check('ghost held, then crisp',
    !!held && held.ghost.includes('running') && crisp.ghost === 0 && crisp.html === `<p>${GHOST_TEXT}</p>`,
    `while writing: ${held ? `worca-ghost on the p, ${held.ghost.join('/') || 'none'}` : 'the text never landed'}; ${Date.now() - settledAt} ms after the final: `
      + `${crisp.error ? crisp.error : `${crisp.ghost} ghost animations, p ${crisp.html}`}`);

  // 40 scripted frames: after each, the cursors drawn, the HUD's count and its dots agree.
  const script = [];
  const ag = {};
  const on = (i, status) => { ag[i] ??= newAgentId(); script.push(S.agent(B1, ag[i], sec(i), status)); };
  const off = (i, status = 'done') => { script.push(S.agent(B1, ag[i], sec(i), status)); delete ag[i]; };
  for (let i = 0; i < 12; i += 1) on(i, i % 3 ? 'writing' : 'starting');
  for (let i = 0; i < 4; i += 1) script.push(S.section(B1, sec(i).id, 'writing', { agentId: ag[i] }));
  for (let i = 0; i < 6; i += 1) off(i);
  script.push(S.build(B1, 'building', { stats: { agentsTotal: 18, costUsd: 0.84 } }), S.build(B1, 'building', { waiting: 1, stats: { agentsTotal: 18, costUsd: 0.91 } }));
  for (const i of [6, 7]) on(i, 'reading');
  for (const i of [8, 9]) on(i, 'thinking');
  on(10, 'waiting');
  for (let i = 6; i < 12; i += 1) off(i, i === 11 ? 'error' : 'done');
  for (let i = 0; i < 5; i += 1) on(i, 'writing');
  const counts = [];
  for (const f of script) {
    await push(f);
    await painted();
    const c = await look();
    counts.push([c.cursors, c.hudCount, c.dots]);
  }
  const bad = counts.map((c, i) => [i + 1, ...c]).filter(([, a, b, d]) => a !== b || a !== d);
  check('cursor count equals the HUD count', script.length === 40 && bad.length === 0,
    `${script.length} frames; cursors per frame ${counts.map((c) => c[0]).join(' ')}${bad.length ? `; mismatches (frame, cursors, HUD, dots) ${JSON.stringify(bad.slice(0, 5))}` : ''}`);

  // R7: the blue box of s4's new writer against its element, over a 2000 px/s scroll of the frame, at scale 1 and 0.45.
  await push(...[0, 1, 2, 3].map((i) => S.agent(B1, ag[i], sec(i), 'done')));
  for (const i of [0, 1, 2, 3]) delete ag[i];
  crew[4] = ag[4];
  rev4 += 1;
  const trackHtml = `<section style="height:${SECTION_H}px"><h2>${sec(4).job}</h2><p>${GHOST_TEXT}</p><p id="r7">Tracked line.</p></section>`;
  await push(S.file(B1, sec(4), rev4, trackHtml));
  const boxed = await until(() => {
    const m = window.__design.stage().model();
    const a = Object.values(m.agents).find((x) => x.sectionId === 's4' && x.status === 'writing');
    return !!a?.box && !!Array.from(document.querySelectorAll('.overlay-doc.is-marks .dz-box')).find((b) => b.classList.length === 1);
  }, null, 8000);
  const r7Rows = [];
  const r7Run = async (s) => {
    const f = await curFrame();
    if (NAME === 'webkit') {
      // Task 1: WebKit runs a sandboxed frame's animation frames every 50 ms until the person clicks in it.
      const p = await framePoint();
      await page.mouse.click(p.x, p.y);
    }
    await f.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await until(() => window.__design.stage().model().scroll.y === 0, null, 3000);
    await painted(300);
    const trackY = await f.evaluate(() => { const r = document.getElementById('r7').getBoundingClientRect(); return r.top + scrollY; });
    const frameIv = await f.evaluate(() => new Promise((res) => {
      const ts = [];
      const tick = (t) => { ts.push(t); if (ts.length < 21) requestAnimationFrame(tick); else res(ts.slice(1).map((x, i) => x - ts[i]).sort((a, b) => a - b)[10]); };
      requestAnimationFrame(tick);
    }));
    await page.evaluate(() => {
      const vs = window.__vs;
      vs.r7 = { on: true, samples: [] };
      const box = Array.from(document.querySelectorAll('.overlay-doc.is-marks .dz-box')).find((b) => b.classList.length === 1);
      const frame = document.querySelector('iframe.dz-frame:not(.is-next)');
      const clip = document.querySelector('.overlay-clip');
      // Read after the frame's paints: a timer from the animation frame runs once the frame is drawn.
      const tick = (ts) => {
        if (!vs.r7.on) return;
        setTimeout(() => vs.r7.samples.push([performance.timeOrigin + ts, box.getBoundingClientRect().top, frame.getBoundingClientRect().top, clip.style.visibility === 'hidden']), 0);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const step = (R7_SPEED * frameIv) / 1000;
    const log = await f.evaluate(({ step, frames }) => new Promise((res) => {
      const out = [];
      let y = 0;
      const tick = (ts) => {
        y += step;
        scrollTo({ top: y, behavior: 'instant' });
        out.push([performance.timeOrigin + ts, scrollY]);
        if (out.length < frames) requestAnimationFrame(tick);
        else res(out);
      };
      requestAnimationFrame(tick);
    }), { step, frames: R7_WARMUP + R7_FRAMES + 10 });
    await painted(100);
    const samples = await page.evaluate(() => { window.__vs.r7.on = false; return window.__vs.r7.samples; });
    const ivP = median(samples.slice(1).map((x, i) => x[0] - samples[i][0]));
    const tol = Math.min(ivP, frameIv) / 2;
    const first = log[R7_WARMUP];
    const last = log[Math.min(log.length - 1, R7_WARMUP + R7_FRAMES - 1)];
    const lags = [];
    let hidden = 0;
    for (const [T, boxTop, frameTop, hid] of samples) {
      if (T < first[0] - tol || T > last[0] + tol) continue;
      let actual = null;
      for (const e of log) { if (e[0] <= T + tol) actual = e[1]; else break; }
      if (actual === null) continue;
      const elTop = frameTop + s * (trackY - actual);
      lags.push((boxTop - elTop) / s / (R7_SPEED / 1000));
      if (hid) hidden += 1;
    }
    const worstMs = lags.length ? Math.max(...lags.map(Math.abs)) : NaN;
    const worst = worstMs / ivP;
    r7Rows.push({ s, ok: lags.length >= R7_FRAMES * 0.8 && worst <= R7_PASS,
      text: `scale ${s}: ${lags.length} parent frames, frame ${r1(frameIv)} ms, parent ${r1(ivP)} ms; worst ${r1(worstMs)} ms = ${(worst).toFixed(2)} frames `
        + `(${r1(worstMs * (R7_SPEED / 1000) * s)} px), median ${r1(median(lags))} ms; marks hidden while scrolling in ${hidden}` });
  };
  // Scale 1: a stage exactly as wide as the page (fit 1), zoomed in to it.
  const wide = await look();
  await page.setViewportSize({ width: VIEW_W + (PAGE_W - wide.wrap.width), height: viewH });
  await until((w) => document.querySelector('.dz-wrap').clientWidth === w, PAGE_W, 5000);
  await settleCamera();
  const zp = await framePoint();
  await page.mouse.move(zp.x, zp.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await until(() => Math.abs(Number(document.querySelector('.frame-box').style.getPropertyValue('--s')) - 1) < 1e-9, null, 4000);
  if (boxed) await r7Run(1);
  await page.keyboard.down('Control');
  await page.mouse.move(zp.x, zp.y);
  await page.mouse.wheel(0, 200);
  await page.keyboard.up('Control');
  await until((f) => Math.abs(Number(document.querySelector('.frame-box').style.getPropertyValue('--s')) - f) < 1e-9, FLOOR, 4000);
  if (boxed) await r7Run(FLOOR);
  check('overlay within one frame while scrolling', !!boxed && r7Rows.length === 2 && r7Rows.every((r) => r.ok),
    `${!boxed ? 'no blue box on s4' : r7Rows.map((r) => r.text).join('; ')}${NAME === 'webkit' ? '; WebKit: clicked in the frame first' : ''}`);
  await page.setViewportSize({ width: VIEW_W, height: viewH });
  await until((h) => document.querySelector('.dz-wrap').clientHeight === h, STAGE_H, 5000);
  await page.locator('.dz-hud-acts button', { hasText: 'Follow' }).click();

  // The round ends done: the old build doc stays, visible, until the run doc (held 500 ms) says ready; then fit, top.
  await push(...[ag[4] && S.agent(B1, ag[4], sec(4), 'done')].filter(Boolean), ...start(B1, [6, 7, 8]));
  delete ag[4];
  await settleCamera();
  const preDone = await look();
  const RUN_DOC = /\/design-preview\/[^/]+\/run\/(\?[^#]*)?$/;
  let held500 = 0;
  await page.route(RUN_DOC, async (route) => { held500 += 1; await sleep(500); await route.continue(); });
  await page.evaluate(() => {
    const vs = window.__vs;
    const old = document.querySelector('iframe.dz-frame');
    vs.swap = { samples: [], t0: performance.now() };
    const tick = () => {
      const all = document.querySelectorAll('iframe.dz-frame');
      const r = old.getBoundingClientRect();
      vs.swap.samples.push([Math.round(performance.now() - vs.swap.t0), all.length, old.isConnected, old.isConnected && getComputedStyle(old).visibility === 'visible' && r.width > 0 && r.height > 0]);
      if (performance.now() - vs.swap.t0 < 8000 && !(all.length === 1 && !old.isConnected)) requestAnimationFrame(tick);
      else vs.swap.end = true;
    };
    requestAnimationFrame(tick);
  });
  await push(...end(B1, [6, 7, 8]), S.build(B1, 'done', { stats: { agentsTotal: 26, sectionsDone: 12, costUsd: 2.4, elapsedMs: 374000 } }));
  await until(() => window.__vs.swap.end === true, null, 10000);
  await page.unroute(RUN_DOC);
  const swap = await page.evaluate(() => window.__vs.swap.samples);
  const two = swap.filter((x) => x[1] === 2);
  const twoMs = two.length ? two.at(-1)[0] - two[0][0] : 0;
  const runSrc = await page.evaluate(() => document.querySelector('iframe.dz-frame')?.getAttribute('src') ?? '');
  check('the old frame stays until ready',
    held500 >= 1 && two.length > 0 && twoMs >= 450 && swap.filter((x) => x[2]).every((x) => x[3]) && swap.at(-1)[1] === 1 && !swap.at(-1)[2] && /\/run\/#n=/.test(runSrc),
    `run doc held ${held500 ? '500 ms' : 'never (not requested)'}; iframes ${[...new Set(swap.map((x) => x[1]))].join(' -> ')} (2 for ${twoMs} ms over ${two.length} frames); `
      + `old frame visible in ${swap.filter((x) => x[3]).length} of ${swap.filter((x) => x[2]).length} frames it was in; now ${runSrc.replace(/#n=.*/, '#n=…').replace(/\/design-preview\/[^/]+/, '/design-preview/<token>')}`);
  await waitDoc('run', 0);
  await painted(600);
  const doneL = await look();
  const runScroll = await frameScroll();
  check('a first round done is fit-width at the top',
    preDone.s < fitNow(preDone) - 0.01 && preDone.camera.y > 0 && Math.abs(doneL.s - fitNow(doneL)) < 0.001 && doneL.camera.scale === null && runScroll === 0 && doneL.docMode === 'run',
    `before: --s ${r3(preDone.s)}, camera y ${r1(preDone.camera.y)}; done: --s ${r3(doneL.s)} (fit ${r3(fitNow(doneL))}), ${doneL.docMode} doc at scrollY ${runScroll}; HUD "${doneL.hudText}"`);

  // ======== Round 2: the person's whole-round Stop keeps the zoom and the scroll. ========
  const B2 = newBuildId();
  await push(S.build(B2, 'planning'), S.plan(B2, STAGE_SECS));
  if (!await waitDoc('build', 12)) throw new Error('round 2: no build doc');
  // The new build doc gets s4's text even though the last round's frame already showed exactly that text.
  await push(S.delta(B2, newAgentId(), sec(4), 1, trackHtml));
  const again = await until(() => {
    const f = document.querySelector('iframe.dz-frame');
    return f && window.__design.stage().model().drafts['sections/s4/index.html']?.rev === 1 ? true : null;
  }, null, 3000) && await (async () => {
    const f = await curFrame();
    for (let i = 0; i < 80; i += 1) {
      if (await f.evaluate(() => !!document.querySelector('[data-section="s4"] #r7')).catch(() => false)) return true;
      await sleep(50);
    }
    return false;
  })();
  check('a new round shows text the last round already showed', again === true,
    `round 2's build doc ${again ? 'shows' : 'never shows'} s4's text, which round 1's frame showed last`);
  await push(S.build(B2, 'building'), ...start(B2, [6, 7, 8]));
  await settleCamera();
  const preStop = await look();
  const preStopY = await frameScroll();
  let stopCalls = 0;
  const STOP = /\/api\/design\/[^/]+\/builds\/[^/]+\/stop$/;
  await page.route(STOP, (route) => { stopCalls += 1; return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await page.locator('.dz-hud-acts button', { hasText: /^Stop$/ }).first().click();
  await page.locator('.dz-hud-acts button.btn-danger').click();
  await until(() => window.__design.stage().model().stopping === true, null, 3000);
  await push(...[6, 7, 8].map((i) => S.agent(B2, crew[i], sec(i), 'stopped')), ...[6, 7, 8].map((i) => S.section(B2, sec(i).id, 'stopped')),
    S.build(B2, 'stopped', { reason: 'user', stats: { agentsTotal: 3 } }));
  for (const i of [6, 7, 8]) delete crew[i];
  await page.unroute(STOP);
  await sleep(900);
  const postStop = await look();
  const postStopY = await frameScroll();
  check('whole-round Stop keeps the zoom',
    stopCalls === 1 && Math.abs(preStop.s - FLOOR) < 0.001 && postStop.s === preStop.s && preStopY > 0 && Math.abs(postStopY - preStopY) <= 1
      && postStop.docMode === 'build' && postStop.allCursors === 0 && postStop.status === 'stopped',
    `Stop answered ${stopCalls}x; --s ${r3(preStop.s)} -> ${r3(postStop.s)}; frame scrollY ${r1(preStopY)} -> ${r1(postStopY)}; still the ${postStop.docMode} doc; `
      + `${postStop.allCursors} cursors; HUD "${postStop.hudText}"`);

  // ======== Round 3: the HUD at 1280 with 12 agents and at 1680 with 13; dark mode. ========
  const B3 = newBuildId();
  await push(S.build(B3, 'planning', { stats: { sectionsPlanned: 13 } }), S.plan(B3, SECS));
  if (!await waitDoc('build', 13)) throw new Error('round 3: no build doc');
  await page.setViewportSize({ width: 1280, height: 800 });
  await until(() => document.querySelector('.dz-wrap').clientWidth < 900, null, 5000);
  await push(S.build(B3, 'building', { stats: { sectionsPlanned: 13, costUsd: 3.12 } }), ...start(B3, [...Array(12).keys()]));
  await painted(300);
  const hud1280 = await page.evaluate(() => {
    const w = document.querySelector('.dz-wrap').getBoundingClientRect();
    const btn = (sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null; };
    const stop = Array.from(document.querySelectorAll('.dz-hud-acts button')).find((b) => b.textContent === 'Stop');
    const sr = stop?.getBoundingClientRect();
    return { wrap: { left: w.left, right: w.right, top: w.top, bottom: w.bottom }, stop: sr ? { left: sr.left, right: sr.right, top: sr.top, bottom: sr.bottom } : null,
      hide: btn('.dz-hud-acts button[aria-label="Hide cursors"]'), dots: document.querySelectorAll('.dz-dots button').length, text: document.querySelector('.dz-hud-text').textContent };
  });
  const inside = (r, w) => !!r && r.left >= w.left && r.right <= w.right && r.top >= w.top && r.bottom <= w.bottom;
  await page.setViewportSize({ width: VIEW_W, height: viewH });
  await until((h) => document.querySelector('.dz-wrap').clientHeight === h, STAGE_H, 5000);
  await push(...start(B3, [12]));
  await painted(300);
  const hud1680 = await page.evaluate(() => {
    const t = document.querySelector('.dz-hud-text');
    return { text: t.textContent, scrollW: t.scrollWidth, clientW: t.clientWidth, line: document.querySelector('.dz-line').getBoundingClientRect().width, dots: document.querySelectorAll('.dz-dots button').length };
  });
  check('HUD Stop inside the stage at 1280',
    hud1280.dots === 12 && inside(hud1280.stop, hud1280.wrap) && inside(hud1280.hide, hud1280.wrap)
      && hud1680.dots === 13 && hud1680.text.startsWith('13 agents') && hud1680.scrollW <= hud1680.clientW && Math.abs(hud1680.line - 96) < 0.01,
    `1280x800, stage ${r1(hud1280.wrap.left)}..${r1(hud1280.wrap.right)}: 12 agents, Stop ${hud1280.stop ? `${r1(hud1280.stop.left)}..${r1(hud1280.stop.right)}` : 'missing'}, `
      + `hide ${hud1280.hide ? `${r1(hud1280.hide.left)}..${r1(hud1280.hide.right)}` : 'missing'}; 1680: "${hud1680.text}" ${hud1680.scrollW}/${hud1680.clientW} px, line ${r1(hud1680.line)} px`);

  // Dark mode: the stage keeps its dark HUD and crew colours; the head takes the page's dark tokens.
  const paintOf = () => page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;color-scheme:dark;background:var(--panel)';
    document.body.append(probe);
    const darkPanel = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      hud: getComputedStyle(document.querySelector('.dz-hud')).backgroundColor,
      hudInk: getComputedStyle(document.querySelector('.dz-hud-text')).color,
      labels: Array.from(document.querySelectorAll('.dz-cursor-label')).slice(0, 4).map((l) => getComputedStyle(l).backgroundColor),
      well: getComputedStyle(document.querySelector('.dz-wrap')).backgroundColor,
      head: getComputedStyle(document.querySelector('.dz-stage')).backgroundColor,
      headInk: getComputedStyle(document.querySelector('.dz-state')).color, darkPanel,
    };
  });
  const lightPaint = await paintOf();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await painted(100);
  const darkPaint = await paintOf();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await painted();
  check('dark mode keeps the stage',
    darkPaint.hud === lightPaint.hud && darkPaint.hudInk === lightPaint.hudInk && darkPaint.well === lightPaint.well && lightPaint.labels.length === 4
      && JSON.stringify(darkPaint.labels) === JSON.stringify(lightPaint.labels) && darkPaint.head === darkPaint.darkPanel && darkPaint.head !== lightPaint.head
      && darkPaint.headInk !== lightPaint.headInk,
    `HUD ${lightPaint.hud} -> ${darkPaint.hud}, text ${lightPaint.hudInk} -> ${darkPaint.hudInk}; labels ${lightPaint.labels.join(' ')} -> ${darkPaint.labels.join(' ')}; `
      + `well ${darkPaint.well}; head ${lightPaint.head} -> ${darkPaint.head} (dark --panel ${darkPaint.darkPanel}), its word ${lightPaint.headInk} -> ${darkPaint.headInk}`);
  await push(S.build(B3, 'stopped', { reason: 'user' }));
  for (const k of Object.keys(crew)) delete crew[k];

  // ======== Round 4, under reduced motion: a new stage reads it once. ========
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await leaveDesign();
  await openDesign(ids.stage);
  const B4 = newBuildId();
  await push(S.build(B4, 'planning'), S.plan(B4, STAGE_SECS));
  if (!await waitDoc('build', 12)) throw new Error('round 4: no build doc');
  await page.evaluate(() => {
    const vs = window.__vs;
    vs.rm = { added: [], trails: 0, leaving: 0, anims: [] };
    const layer = document.querySelector('.overlay-doc.is-cursors');
    vs.rmObs?.disconnect();
    vs.rmObs = new MutationObserver((list) => {
      for (const m of list) {
        for (const n of m.addedNodes) {
          if (!(n instanceof HTMLElement)) continue;
          if (n.classList.contains('dz-trail')) vs.rm.trails += 1;
          if (n.classList.contains('dz-cursor')) {
            const rec = { label: n.textContent, x0: n.style.getPropertyValue('--x'), y0: n.style.getPropertyValue('--y'), el: n };
            vs.rm.added.push(rec);
          }
        }
        if (m.type === 'attributes' && m.target.classList.contains('is-leaving')) vs.rm.leaving += 1;
      }
    });
    vs.rmObs.observe(layer, { childList: true, attributes: true, subtree: true, attributeFilter: ['class'] });
    const stage = document.querySelector('.dz-stage');
    vs.rm.sample = () => vs.rm.anims.push(document.getAnimations().filter((a) => {
      const t = a.effect?.target;
      return t && stage.contains(t);
    }).map((a) => `${a.constructor.name}:${a.effect.target.className}`));
  });
  const sampleAnims = async (n) => { for (let i = 0; i < n; i += 1) { await page.evaluate(() => window.__vs.rm.sample()); await sleep(40); } };
  await push(S.build(B4, 'building'), ...start(B4, [3, 4, 5]));
  await sampleAnims(8);
  await sleep(700);
  const rmMove1 = await look();
  await push(...end(B4, [3]), ...start(B4, [9]));
  await sampleAnims(8);
  await sleep(700);
  const rmMove2 = await look();
  await sampleAnims(3);
  const rm = await page.evaluate(() => {
    const vs = window.__vs;
    vs.rmObs.disconnect();
    return { added: vs.rm.added.map((a) => ({ label: a.label, x0: a.x0, y0: a.y0, x: a.el.style.getPropertyValue('--x'), y: a.el.style.getPropertyValue('--y'), on: a.el.isConnected })),
      trails: vs.rm.trails, leaving: vs.rm.leaving, anims: vs.rm.anims.flat() };
  });
  // A cursor entering with motion starts 4 screen px inside the stage's right edge, past the page (x > its width); under
  // reduced motion it is placed where it stands, inside the page.
  const jumped = rm.added.length === 4 && rm.added.every((a) => parseFloat(a.x0) < PAGE_W);
  check('reduced motion: nothing animates',
    rm.anims.length === 0 && rm.trails === 0 && rm.leaving === 0 && jumped && rmMove1.camMs === '0ms' && rmMove2.camMs === '0ms' && Math.abs(rmMove2.s - expectScale(rmMove2, 7 * SECTION_H)) < 0.001,
    `${rm.anims.length} animations on the stage over 19 samples${rm.anims.length ? ` (${[...new Set(rm.anims)].slice(0, 4).join(', ')})` : ''}; trails ${rm.trails}; leaving cursors ${rm.leaving}; `
      + `${rm.added.length} cursors placed where they stand (first x ${rm.added.map((a) => r1(parseFloat(a.x0))).join(', ')} px of a ${PAGE_W} px page): ${jumped}; `
      + `--cam-ms ${rmMove1.camMs} and ${rmMove2.camMs}, --s ${r3(rmMove2.s)}`);
  await push(S.build(B4, 'stopped', { reason: 'user' }));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await leaveDesign();

  // ======== The change design: a change round ends on its section, over unsized images above it. ========
  await openDesign(ids.change);
  const C = framesFor(ids.change);
  const BC = newBuildId();
  const cDone = (id) => (id === 'c3' ? 'planned' : 'done');
  await push(C.build(BC, 'planning', { round: 2, kind: 'change', stats: { sectionsPlanned: 6 } }), C.plan(BC, CHANGE.map((s) => ({ ...s, status: cDone(s.id) }))));
  if (!await waitDoc('build', 6)) throw new Error('change: no build doc');
  const cFrame = await curFrame();
  for (let i = 0; i < 100 && (await cFrame.evaluate(() => document.readyState).catch(() => '')) !== 'complete'; i += 1) await sleep(50);
  await painted(200);
  // One builder edits c3, which zooms the camera out; it finishes (the crew empties, nothing moves), then the round ends.
  const c3 = CHANGE[3];
  const c3Agent = newAgentId();
  await push(C.build(BC, 'building', { round: 2, kind: 'change' }), C.agent(BC, c3Agent, c3, 'writing'), C.section(BC, 'c3', 'writing', { agentId: c3Agent }));
  await settleCamera();
  const framed = await look();
  await push(C.agent(BC, c3Agent, c3, 'done'), C.section(BC, 'c3', 'done', { agentId: c3Agent, summary: 'Coverage, edited' }));
  await settleCamera();
  const preChange = await look();
  const IMAGES = /\/design-preview\/[^/]+\/run\/assets\/[ab]\.png(\?.*)?$/;
  let delayed = 0;
  await page.route(IMAGES, async (route) => { delayed += 1; await sleep(800); await route.continue(); });
  await push(C.build(BC, 'done', { round: 2, kind: 'change', stats: { agentsTotal: 2, sectionsDone: 6, sectionsPlanned: 6, elapsedMs: 52000 } }));
  await waitDoc('run', 0);
  const rFrame = await curFrame();
  for (let i = 0; i < 120 && (await rFrame.evaluate(() => document.readyState).catch(() => '')) !== 'complete'; i += 1) await sleep(50);
  await sleep(400);
  await page.unroute(IMAGES);
  const postChange = await look();
  const runDoc = await rFrame.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const imgs = performance.getEntriesByType('resource').filter((e) => /assets\/[ab]\.png/.test(e.name));
    const c3 = document.querySelector('[data-section="c3"]').getBoundingClientRect();
    return { scrollY, dcl: nav ? nav.domContentLoadedEventEnd : null, imgs: imgs.map((e) => e.responseEnd), c3Top: c3.top + scrollY,
      heights: Array.from(document.images).map((i) => i.getBoundingClientRect().height) };
  }).catch((e) => ({ error: String(e && e.message).split('\n')[0] }));
  const imgsAfter = runDoc.dcl != null && runDoc.imgs.length ? Math.round(Math.min(...runDoc.imgs) - runDoc.dcl) : null;
  check('a change round stays on its section when done',
    Math.abs(framed.s - expectScale(framed, 2 * SECTION_H)) < 0.001 && preChange.s === framed.s && preChange.s < fitNow(preChange) - 0.01 && postChange.s === preChange.s
      && postChange.docMode === 'run' && postChange.camera.y === preChange.camera.y && preChange.camera.y > 0 && delayed >= 2 && Math.abs(runDoc.scrollY - postChange.camera.y) <= 1,
    `c3 framed at --s ${r3(framed.s)} (776/1600 = ${r3(776 / 1600)}); its builder done: ${r3(preChange.s)}; round done: ${r3(postChange.s)}; `
      + `camera y ${r1(preChange.camera.y)} -> ${r1(postChange.camera.y)}; run doc scrollY ${runDoc.error ?? r1(runDoc.scrollY)} `
      + `(c3 at ${r1(runDoc.c3Top)}); images ${delayed} held 800 ms, landing ${imgsAfter} ms after DOMContentLoaded, ${JSON.stringify(runDoc.heights)} px tall`);
  await leaveDesign();

  // ======== The leave design: a run doc whose section script navigates away. ========
  await openDesign(ids.leave);
  const LV = framesFor(ids.leave);
  await push(LV.build(newBuildId(), 'done', { stats: { agentsTotal: 1, sectionsDone: 1, sectionsPlanned: 1 } }));
  const lostShown = await until(() => !document.querySelector('.dz-lost').hidden, null, 20000, 100);
  const lostText = await page.evaluate(() => document.querySelector('.dz-lost').textContent);
  writeFileSync(path.join(leaveWork, 'sections', 'l0', 'script.js'), '/* stays */');
  if (lostShown) await page.locator('.dz-lost button', { hasText: 'Reload' }).click();
  const restored = lostShown ? await until(() => {
    const m = window.__design.stage().model();
    return document.querySelector('.dz-lost').hidden && m.docMode === 'run' && document.querySelectorAll('iframe.dz-frame').length === 1;
  }, null, 15000) : null;
  const lvFrame = await curFrame();
  const lvBody = lvFrame ? await lvFrame.evaluate(() => document.querySelector('[data-section="l0"] h2')?.textContent ?? null).catch(() => null) : null;
  check('a frame that navigates away offers Reload', !!lostShown && !!restored && lvBody === 'Hero',
    `.dz-lost ${lostShown ? `shown ("${lostText}")` : 'never shown'}; after Reload: ${restored ? `run doc back, section l0 reads "${lvBody}"` : 'not restored'}`);

  // R16 after `ready`: the section script navigates from a DOMContentLoaded handler, so the doc's bridge (whose listener
  // came first) has said `ready`, its own `load` never comes, and the frame's one `load` is the page it went to.
  writeFileSync(path.join(leaveWork, 'sections', 'l0', 'script.js'), "document.addEventListener('DOMContentLoaded', () => { location.href = 'elsewhere.html'; });");
  const readiesBefore = await page.evaluate(() => window.__vs.readies.length);
  await page.evaluate(() => { window.__design.stage().loadRunDoc(); });
  const lostAfterReady = await until(() => !document.querySelector('.dz-lost').hidden, null, 20000, 100);
  const readiedThenLeft = (await page.evaluate(() => window.__vs.readies.length)) - readiesBefore;
  writeFileSync(path.join(leaveWork, 'sections', 'l0', 'script.js'), '/* stays */');
  if (lostAfterReady) await page.locator('.dz-lost button', { hasText: 'Reload' }).click();
  const restoredAgain = lostAfterReady ? await until(() => {
    const m = window.__design.stage().model();
    return document.querySelector('.dz-lost').hidden && m.docMode === 'run' && document.querySelectorAll('iframe.dz-frame').length === 1;
  }, null, 15000) : null;
  const againFrame = await curFrame();
  const againBody = againFrame ? await againFrame.evaluate(() => document.querySelector('[data-section="l0"] h2')?.textContent ?? null).catch(() => null) : null;
  check('a frame that navigates away after its ready offers Reload', !!lostAfterReady && readiedThenLeft >= 2 && !!restoredAgain && againBody === 'Hero',
    `${readiedThenLeft} ready messages from the doc and its reload before they left; .dz-lost ${lostAfterReady ? 'shown' : 'never shown'}; `
      + `after Reload: ${restoredAgain ? `run doc back, section l0 reads "${againBody}"` : 'not restored'}`);

  // R16 after the doc's own load (review cycle 2): the section script navigates 300 ms after the window `load`, so the
  // doc has said `ready` and `loaded` and its frame's own load came (most often before its `ready`). The page it goes to
  // keeps the nonce in its hash and forges a `rects` every 100 ms; a host that still believed the frame would put that
  // docH in the model, and would post the stage's messages to it.
  const FORGED_DOC_H = 77777;
  writeFileSync(path.join(leaveWork, 'elsewhere.html'), '<!doctype html><html><body><p>elsewhere</p><script>'
    + 'const n = (/#n=([^&#]*)/.exec(location.hash) || [])[1] || "";'
    + `addEventListener('load', () => setTimeout(() => setInterval(() => parent.postMessage({ ns: 'worca-design', v: 1, n, t: 'rects', scrollX: 0, scrollY: 0, vw: 1280, vh: 900, docH: ${FORGED_DOC_H}, sections: [] }, '*'), 100), 200));`
    + '</script></body></html>');
  writeFileSync(path.join(leaveWork, 'sections', 'l0', 'script.js'), "addEventListener('load', () => setTimeout(() => { location.href = 'elsewhere.html' + location.hash; }, 300));");
  const readiesBeforeLoad = await page.evaluate((docH) => {
    window.__vs.forged = 0;
    window.__vs.believed = false;
    window.addEventListener('message', (e) => { if (e.data && e.data.ns === 'worca-design' && e.data.docH === docH) window.__vs.forged += 1; });
    window.__design.stage().loadRunDoc();
    return window.__vs.readies.length;
  }, FORGED_DOC_H);
  const lostAfterLoad = await until((docH) => {
    if (window.__design.stage().model().scroll.docH === docH) window.__vs.believed = true;
    return !document.querySelector('.dz-lost').hidden;
  }, FORGED_DOC_H, 20000, 50);
  const afterLoad = await page.evaluate(() => ({ readies: window.__vs.readies.length, forged: window.__vs.forged, believed: window.__vs.believed }));
  writeFileSync(path.join(leaveWork, 'sections', 'l0', 'script.js'), '/* stays */');
  if (lostAfterLoad) await page.locator('.dz-lost button', { hasText: 'Reload' }).click();
  const restoredThird = lostAfterLoad ? await until(() => {
    const m = window.__design.stage().model();
    return document.querySelector('.dz-lost').hidden && m.docMode === 'run' && document.querySelectorAll('iframe.dz-frame').length === 1;
  }, null, 15000) : null;
  const thirdFrame = await curFrame();
  const thirdBody = thirdFrame ? await thirdFrame.evaluate(() => document.querySelector('[data-section="l0"] h2')?.textContent ?? null).catch(() => null) : null;
  const loadedThenLeft = afterLoad.readies - readiesBeforeLoad;
  check('a frame that navigates away after its load offers Reload', !!lostAfterLoad && loadedThenLeft >= 2 && afterLoad.forged > 0 && !afterLoad.believed
      && !!restoredThird && thirdBody === 'Hero',
    `${loadedThenLeft} ready messages from the doc and its reload before they left; ${afterLoad.forged} forged rects from the page they went to, `
      + `${afterLoad.believed ? 'BELIEVED' : 'none believed'}; .dz-lost ${lostAfterLoad ? 'shown' : 'never shown'}; `
      + `after Reload: ${restoredThird ? `run doc back, section l0 reads "${thirdBody}"` : 'not restored'}`);

  // R16 after a script's own `load` event (review cycle 3): 50 ms after the window `load` the section script dispatches
  // a synthetic `load` (as code that re-runs its late initialisers does), tells the page it did, and navigates 300 ms
  // later. A bridge that reported every `load` event would leave a spare credit, and the page it went to would be
  // believed for good.
  writeFileSync(path.join(leaveWork, 'sections', 'l0', 'script.js'), "addEventListener('load', () => setTimeout(() => {"
    + " dispatchEvent(new Event('load')); parent.postMessage({ probe: 'synthetic-load' }, '*');"
    + " setTimeout(() => { location.href = 'elsewhere.html' + location.hash; }, 300); }, 50), { once: true });");
  const readiesBeforeSynthetic = await page.evaluate(() => {
    window.__vs.forged = 0;
    window.__vs.believed = false;
    window.__vs.synthetic = 0;
    window.addEventListener('message', (e) => { if (e.data && e.data.probe === 'synthetic-load') window.__vs.synthetic += 1; });
    window.__design.stage().loadRunDoc();
    return window.__vs.readies.length;
  });
  const lostAfterSynthetic = await until((docH) => {
    if (window.__design.stage().model().scroll.docH === docH) window.__vs.believed = true;
    return !document.querySelector('.dz-lost').hidden;
  }, FORGED_DOC_H, 20000, 50);
  const afterSynthetic = await page.evaluate(() => ({ readies: window.__vs.readies.length, forged: window.__vs.forged, believed: window.__vs.believed,
    synthetic: window.__vs.synthetic }));
  writeFileSync(path.join(leaveWork, 'sections', 'l0', 'script.js'), '/* stays */');
  if (lostAfterSynthetic) await page.locator('.dz-lost button', { hasText: 'Reload' }).click();
  const restoredFourth = lostAfterSynthetic ? await until(() => {
    const m = window.__design.stage().model();
    return document.querySelector('.dz-lost').hidden && m.docMode === 'run' && document.querySelectorAll('iframe.dz-frame').length === 1;
  }, null, 15000) : null;
  const fourthFrame = await curFrame();
  const fourthBody = fourthFrame ? await fourthFrame.evaluate(() => document.querySelector('[data-section="l0"] h2')?.textContent ?? null).catch(() => null) : null;
  const syntheticThenLeft = afterSynthetic.readies - readiesBeforeSynthetic;
  check('a frame that fires its own load event, then navigates away, offers Reload', !!lostAfterSynthetic && syntheticThenLeft >= 2
      && afterSynthetic.synthetic >= 2 && afterSynthetic.forged > 0 && !afterSynthetic.believed && !!restoredFourth && fourthBody === 'Hero',
    `${syntheticThenLeft} ready messages and ${afterSynthetic.synthetic} synthetic loads from the doc and its reload before they left; `
      + `${afterSynthetic.forged} forged rects from the page they went to, ${afterSynthetic.believed ? 'BELIEVED' : 'none believed'}; `
      + `.dz-lost ${lostAfterSynthetic ? 'shown' : 'never shown'}; `
      + `after Reload: ${restoredFourth ? `run doc back, section l0 reads "${fourthBody}"` : 'not restored'}`);
  // Which came first, a doc's `loaded` report or its frame's `load`: a load before its report holds the frame's
  // messages, both ways, until the report (frame-host.mjs).
  const order = await page.evaluate(() => window.__vs.order);
  const owed = new Map();   // frame -> the times of its loads still waiting for a report
  const credit = new Map(); // frame -> reports not yet matched by a load
  let after = 0;
  const gaps = [];
  for (const o of order) {
    if (o.kind === 'loaded') {
      const waiting = owed.get(o.frame) ?? [];
      if (waiting.length) gaps.push(o.at - waiting.shift());
      else credit.set(o.frame, (credit.get(o.frame) ?? 0) + 1);
      continue;
    }
    if ((credit.get(o.frame) ?? 0) > 0) { credit.set(o.frame, credit.get(o.frame) - 1); after += 1; continue; }
    owed.set(o.frame, [...(owed.get(o.frame) ?? []), o.at]);
  }
  const never = [...owed.values()].reduce((n, l) => n + l.length, 0);
  console.log(`# R16 order: ${after + gaps.length + never} frame loads; ${after} after their doc's loaded report, ${gaps.length} before it `
    + `(report ${gaps.length ? `${r1(Math.min(...gaps))} to ${r1(Math.max(...gaps))} ms later` : 'never late'}), ${never} never reported`);

  // Every `ready` the page saw: an opaque origin, from a stage frame's own window.
  const readies = await page.evaluate(() => window.__vs.readies);
  const modes = new Set(readies.map((r) => r.mode));
  check('frame origin is null', readies.length >= 4 && modes.has('build') && modes.has('run') && readies.every((r) => r.origin === 'null' && r.fromFrame),
    `${readies.length} ready messages (${[...modes].join(', ')}); e.origin ${JSON.stringify([...new Set(readies.map((r) => r.origin))])}; from a .dz-frame ${readies.filter((r) => r.fromFrame).length}`);
  if (pageErrors.length) console.log(`# page errors: ${pageErrors.slice(0, 5).join(' | ')}`);

  console.log(failures.length ? `${failures.length} failed: ${failures.join('; ')}` : 'all ok');
} catch (e) {
  console.error(e && e.stack ? e.stack : e);
  failures.push('the proof itself');
  console.log('FAIL the proof did not finish');
} finally {
  await finish();
}
process.exitCode = failures.length ? 1 : 0;
