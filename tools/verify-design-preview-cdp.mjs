#!/usr/bin/env node
// tools/verify-design-preview-cdp.mjs: the Design preview's real-browser proof (P3 Task 13), `npm run verify:design-preview`.
// The "frame loads and merges in isolation" hand-off: everything jsdom cannot show (CSP, opaque origin, real layout,
// WAAPI, media, timing) is driven here through the real server, the real worca shell and C-6.
//
//   node tools/verify-design-preview-cdp.mjs [--browser chromium|firefox|webkit]
//
// 1. Scratch HOME and WORCA_HOME first, before any store import. P1's store then seeds four designs: a hostile one, a
//    clean one (with assets/p.woff2, assets/p.webm and a hero script.js), the `fine` one (40 sections, 20 of their
//    slots nested in grid rows) and the `form` one (`form=` controls in its shell and in a finished section).
// 2. One `node ui/server.mjs` on a free port with WORCA_FLAGS=design and WORCA_MOCK=1. Tokens come from the real
//    POST /api/design/:id/preview-token, by Node fetch (no Origin).
// 3. The page is the real shell at http://localhost:<port>/, so the parent runs under the shell's own CSP. Each doc goes
//    in a frame added there with sandbox="allow-scripts" and referrerpolicy="no-referrer", beside a collector that
//    keeps every message whose e.source is that frame's contentWindow.
// 4. One `ok`/`FAIL` line per check of the plan's table; exit 1 on any FAIL.
//
// Chromium is the system Chrome (CHROME_BIN, else findChrome()), with --no-sandbox --disable-dev-shm-usage when
// CHROME_NO_SANDBOX=1 or the uid is 0. Firefox and WebKit are playwright-core's own builds. Playwright drives the
// browser over a pipe, so the proof takes no CDP port. Manual or CI only, never inside npm test (M14).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';
import { findChrome } from '../assets/deck-preview/chrome.mjs';
import { hostileMarkup, writeDesignWork } from '../test/helpers/design-preview-fixture.mjs';

const BROWSERS = { chromium, firefox, webkit };
const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const NAME = arg('--browser', 'chromium');
if (!Object.hasOwn(BROWSERS, NAME)) {
  console.error(`--browser must be chromium, firefox or webkit, not ${NAME}`);
  process.exit(2);
}
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FONT_SRC = path.join(ROOT, 'node_modules', '@fontsource', 'poppins', 'files', 'poppins-latin-400-normal.woff2');

// Every hostile payload tries to tell the parent it ran.
const fire = (n) => "parent.postMessage({pwn:" + n + "},'*')";
const CLICK_IDS = ['jsl', 'jsl2', 'jsl3', 'b'];
// Links that would take the build doc away from a live stage with no script at all: an empty and a bare href (a reload
// without `#n=`), a link in an open declarative shadow root (the click targets its host), SVG links whose href only a
// SMIL `set` or `animate` gives, a `<use>` copy of a link (the copy lives in the use element's closed shadow tree) and
// an SVG `a` with no href inside a link (the browser follows the outer one). Build doc only: the raw file has no
// bridge, so these would navigate it.
const NAV_MARKUP = [
  '<a id="empty" href="">empty href</a>',
  '<a id="bare" href>bare href</a>',
  '<span id="dsd"><template shadowrootmode="open"><a href="elsewhere-dsd">shadow link</a></template></span>',
  '<svg width="300" height="40"><a id="smil"><set attributeName="href" to="elsewhere-smil" begin="0s" fill="freeze"/><text x="4" y="24">smil link</text></a></svg>',
  '<svg width="300" height="40"><a id="anim"><animate attributeName="href" values="elsewhere-anim" dur="1000s" fill="freeze"/><text x="4" y="24">animated link</text></a></svg>',
  '<svg width="300" height="40"><defs><a id="navlink" href="elsewhere-use"><rect width="300" height="40"/></a></defs><use id="navuse" href="#navlink"/></svg>',
  '<a href="elsewhere-nest"><svg width="300" height="40"><a id="nest"><text x="4" y="24">nested link</text></a></svg></a>',
].join('\n');
const NAV_IDS = ['empty', 'bare', 'dsd', 'smil', 'anim', 'navuse', 'nest'];
// The hostile shell's markup before its explicit <head>: the parser puts it in the doc before the bridge script runs, so
// these Document named properties (which override its built-ins) are in place when morphdom loads and the bridge boots.
const SHELL_CLOBBER = ['createElement', 'createElementNS', 'createRange', 'addEventListener', 'readyState'].map((n) => `<img name="${n}" alt="">`).join('');
const FRAME_W = 1280;
const FRAME_H = 800;
const NS = 'worca-design';
const HARD_LIMIT_MS = 240000;

// The form design's shell markup and its finished `other` section: `form=` controls whose names are members morphdom walks.
// A hero rev adding `<form id="f">` would make morphdom walk from it into the aside, where a form and its control name
// each other `nextSibling` (an endless walk); a hero form root given `id="h"` would take `other`'s control and rewrite it.
const FORM_ASIDE = '<aside><input form="f" name="firstChild"><input form="g" name="nextSibling"><form id="g"></form></aside>';
const FORM_OTHER = '<section data-section="other"><p>B</p><input form="h" name="firstChild"></section>';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A browser call that may never settle, raced in Node: a frame that hangs hangs the parent page too in Firefox and
// WebKit, and page.evaluate has no timeout. HANG once `ms` pass first.
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
const round = (v) => Math.round(v * 10) / 10;

// Playwright's own signal handlers would exit before `finish()` removes the scratch HOME: the proof's handlers do it.
const NO_SIGNAL_HANDLERS = { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false };
function launchOptions(name, env) {
  if (name !== 'chromium') return { headless: true, env, ...NO_SIGNAL_HANDLERS };
  const executablePath = process.env.CHROME_BIN || findChrome();
  if (!executablePath) throw new Error('no Chrome found: set CHROME_BIN or WORCA_CHROME');
  const noSandbox = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0;
  return { executablePath, headless: true, env, args: noSandbox ? ['--no-sandbox', '--disable-dev-shm-usage'] : [], ...NO_SIGNAL_HANDLERS };
}

// assets/p.webm: the repo tracks no video and CI has no ffmpeg, so a browser records one. One second of a canvas
// captureStream() through MediaRecorder in a blank page, back to Node as base64; null where webm cannot be recorded.
async function recordWebm(browser) {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    return await page.evaluate(async () => {
      if (typeof MediaRecorder !== 'function' || !MediaRecorder.isTypeSupported('video/webm')) return null;
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      document.body.appendChild(canvas);
      const g = canvas.getContext('2d');
      let i = 0;
      const draw = () => { g.fillStyle = `hsl(${(i++ * 12) % 360} 80% 50%)`; g.fillRect(0, 0, 160, 90); };
      draw();
      const timer = setInterval(draw, 33);
      const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const stopped = new Promise((r) => { rec.onstop = r; });
      rec.start(100);
      await new Promise((r) => setTimeout(r, 1000));
      rec.stop();
      await stopped;
      clearInterval(timer);
      const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
      let s = '';
      for (let k = 0; k < bytes.length; k++) s += String.fromCharCode(bytes[k]);
      return btoa(s);
    });
  } finally {
    await ctx.close();
  }
}

// A section's full text, about `size` bytes, that a stream sends in growing prefixes.
function streamHtml(id, size) {
  let html = `<section class="live"><h2>Section ${id}</h2>`;
  for (let i = 1; html.length < size - 120; i++) html += `<p>Line ${i} of ${id}: <b>live</b> text that grows while its builder writes it.</p>`;
  return `${html}</section>`;
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
// One cleanup for a normal end, a crash and a signal: the browser, the server child, then the scratch HOME by its path.
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
// A hung browser call must not hold a CI runner: about 30 s is a normal run.
setTimeout(() => {
  console.log(`FAIL the proof did not finish within ${HARD_LIMIT_MS / 1000} s`);
  finish().finally(() => process.exit(1));
}, HARD_LIMIT_MS).unref();

try {
  home = await mkdtemp(path.join(tmpdir(), 'worca-dpreview-home-'));
  const WH = path.join(home, '.worca-cc');
  await mkdir(WH, { recursive: true });
  const REAL_ENV = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };   // the browser keeps the real HOME
  Object.assign(process.env, { HOME: home, USERPROFILE: home, WORCA_HOME: WH, WORCA_TEST_ALLOW_HOME_FALLBACK: '1' });
  const browserEnv = { ...process.env };
  for (const [k, v] of Object.entries(REAL_ENV)) { if (v === undefined) delete browserEnv[k]; else browserEnv[k] = v; }
  const { createDesign } = await import('../src/core/design/store.mjs');
  const { designWorkDir } = await import('../src/core/design/paths.mjs');

  browser = await BROWSERS[NAME].launch(launchOptions(NAME, browserEnv));
  let webm = await recordWebm(browser);
  let webmBy = NAME;
  if (!webm && NAME !== 'chromium') {
    const rec = await chromium.launch(launchOptions('chromium', browserEnv));
    try { webm = await recordWebm(rec); webmBy = 'chromium'; } finally { await rec.close(); }
  }
  if (!webm) throw new Error('no browser could record assets/p.webm');

  // The designs, seeded before the server starts, so only one process runs the first migration.
  const designs = { hostile: createDesign({ kind: 'web', title: 'Hostile' }).id, clean: createDesign({ kind: 'web', title: 'Clean' }).id,
    fine: createDesign({ kind: 'web', title: 'Fine' }).id, form: createDesign({ kind: 'web', title: 'Form' }).id };
  const hostileWork = designWorkDir(designs.hostile);
  writeDesignWork(hostileWork, { hostile: true });
  const hostileShell = path.join(hostileWork, 'shell.html');
  writeFileSync(hostileShell, readFileSync(hostileShell, 'utf8').replace('<html><head>', `<html>${SHELL_CLOBBER}<head>`));
  writeFileSync(path.join(hostileWork, 'sections', 'hero', 'index.html'), `<section data-section="hero"><h1>Ship</h1>\n${hostileMarkup(fire)}\n${NAV_MARKUP}\n</section>`);
  writeFileSync(path.join(hostileWork, 'hostile.html'), hostileMarkup(fire));
  const cleanWork = designWorkDir(designs.clean);
  writeDesignWork(cleanWork);
  copyFileSync(FONT_SRC, path.join(cleanWork, 'assets', 'p.woff2'));
  writeFileSync(path.join(cleanWork, 'assets', 'p.webm'), Buffer.from(webm, 'base64'));
  writeFileSync(path.join(cleanWork, 'sections', 'hero', 'script.js'), [
    "document.addEventListener('securitypolicyviolation', (e) => parent.postMessage({ csp: e.effectiveDirective || e.violatedDirective }, '*'));",
    "parent.postMessage({ ran: 1 }, '*');",
    "fetch(location.origin + '/api/flags').then((r) => parent.postMessage({ api: 'answered', status: r.status }, '*'), (e) => parent.postMessage({ api: 'rejected', why: String(e && e.name) }, '*'));",
    "fetch('assets/p.woff2').then((r) => parent.postMessage({ asset: r.status }, '*'), (e) => parent.postMessage({ asset: 'rejected', why: String(e && e.name) }, '*'));",
  ].join('\n'));
  const fineWork = designWorkDir(designs.fine);
  writeDesignWork(fineWork, { fine: true });
  // The lead's grid: four columns per row, so a slot replaced in place keeps its neighbours where they stand.
  writeFileSync(path.join(fineWork, 'global.css'), 'body{margin:0;color:var(--ink);background:var(--paper)}.row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}');
  // The form design: the default one, its shell carrying FORM_ASIDE, plus a finished section `other` (FORM_OTHER).
  const formWork = designWorkDir(designs.form);
  const formPlan = writeDesignWork(formWork);
  formPlan.sections.push({ id: 'other', job: 'Other', brief: 'b', parts: ['html'], estHeight: 100 });
  writeFileSync(path.join(formWork, 'plan.json'), JSON.stringify(formPlan));
  writeFileSync(path.join(formWork, '.crew.json'), JSON.stringify([{ id: 'hero', status: 'done', summary: 's' },
    { id: 'price', status: 'planned', summary: '' }, { id: 'other', status: 'done', summary: 's' }]));
  const formShell = path.join(formWork, 'shell.html');
  writeFileSync(formShell, readFileSync(formShell, 'utf8').replace('<header>H</header>', `${FORM_ASIDE}<header>H</header>`));
  await mkdir(path.join(formWork, 'sections', 'other'), { recursive: true });
  writeFileSync(path.join(formWork, 'sections', 'other', 'index.html'), FORM_OTHER);

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
  await fetch(`${API}/api/onboarding`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ welcomeSeen: true }) });
  const bases = {};
  for (const [k, id] of Object.entries(designs)) {
    const r = await fetch(`${API}/api/design/${id}/preview-token`, { method: 'POST' });
    if (r.status !== 200) throw new Error(`mint ${k}: ${r.status} ${await r.text()}`);
    bases[k] = (await r.json()).base;
  }

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  const fontRequests = [];
  page.on('request', (r) => { if (/\/build\/assets\/p\.woff2$/.test(r.url())) fontRequests.push(r); });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 60000 });
  console.log(`# browser=${NAME} version=${browser.version()} os=${process.platform} webm=${webmBy} page=http://localhost:<port>/`);
  await page.evaluate(() => {
    document.getElementById('welcome-modal')?.remove();
    const dp = { log: [], els: {}, loads: {} };
    window.__dp = dp;
    window.addEventListener('message', (e) => {
      for (const name of Object.keys(dp.els)) {
        if (dp.els[name].contentWindow === e.source) { dp.log.push({ frame: name, origin: String(e.origin), data: e.data, at: performance.now() }); return; }
      }
    });
  });

  // The collected messages, mirrored in Node; `until` polls them.
  const log = [];
  const sync = async () => { log.push(...await page.evaluate((from) => window.__dp.log.slice(from), log.length)); };
  const until = async (fn, ms = 5000) => {
    const end = Date.now() + ms;
    for (;;) {
      await sync();
      const v = fn();
      if (v || Date.now() > end) return v || null;
      await sleep(40);
    }
  };
  const msgs = (name, t) => log.filter((m) => m.frame === name && m.data && m.data.ns === NS && m.data.t === t);
  const appliedOf = (name, id, rev) => msgs(name, 'applied').filter((m) => m.data.id === id && (rev === undefined || m.data.rev === rev));
  const pwns = (name) => log.filter((m) => m.frame === name && m.data && typeof m.data === 'object' && 'pwn' in m.data).map((m) => m.data.pwn);
  const errs = (name) => msgs(name, 'err').map((m) => `${m.data.code}: ${m.data.message}`);
  const loadsOf = (name) => page.evaluate((n) => window.__dp.loads[n], name);

  // One frame on the stage at a time, fixed on top of the shell, so frameLocator clicks land in it.
  async function openFrame(name, src) {
    await page.evaluate(({ name, src, w, h }) => {
      for (const el of Object.values(window.__dp.els)) el.remove();
      const el = document.createElement('iframe');
      el.id = `dp-${name}`;
      el.setAttribute('sandbox', 'allow-scripts');
      el.setAttribute('referrerpolicy', 'no-referrer');
      el.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;border:0;background:#fff;z-index:2147483647`;
      window.__dp.els[name] = el;
      window.__dp.loads[name] = 0;
      el.addEventListener('load', () => { window.__dp.loads[name] += 1; });
      el.src = src;
      document.body.appendChild(el);
    }, { name, src, w: FRAME_W, h: FRAME_H });
    const handle = await page.waitForSelector(`#dp-${name}`, { state: 'attached' });
    return handle.contentFrame();
  }
  const send = (f, t, fields) => page.evaluate(({ name, msg }) => {
    window.__dp.els[name].contentWindow.postMessage(msg, '*');
    return performance.now();
  }, { name: f.name, msg: { ns: NS, v: 1, n: f.nonce, t, ...fields } });

  // A generated doc: waits for its `ready`, then greets it as P4 does.
  async function openDoc(name, base, mode) {
    const f = { name, nonce: randomBytes(12).toString('base64url'), mode };
    f.frame = await openFrame(name, `${base}/${mode}/#n=${f.nonce}`);
    f.ready = await until(() => msgs(name, 'ready')[0], 15000);
    if (!f.ready) throw new Error(`${name}: no ready from ${mode} doc; errors ${JSON.stringify(errs(name))}`);
    await send(f, 'hello', { mode, kind: 'web', canvas: { w: 1440 } });
    return f;
  }
  // A raw file under work/: no bridge, so it is loaded once its frame fires `load`.
  async function openFile(name, base, mode, file) {
    const f = { name, nonce: 'x', mode };
    f.frame = await openFrame(name, `${base}/${mode}/${file}#n=x`);
    const end = Date.now() + 15000;
    while (!(await loadsOf(name)) && Date.now() < end) await sleep(40);
    return f;
  }
  // Clicks each id through frameLocator at a point where the element itself is hit (an SVG link's glyph can sit
  // partly outside its <svg>), and records what the frame's own capture listener saw.
  async function clickAll(f, ids) {
    await f.frame.evaluate(() => {
      window.__dpClicks = [];
      addEventListener('click', (e) => {
        const t = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
        const owner = t && t.closest('[id]');
        window.__dpClicks.push(owner ? owner.id : null);
      }, true);
    });
    const errors = [];
    for (const id of ids) {
      try {
        const position = await f.frame.evaluate((id) => {
          const el = document.getElementById(id);
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          const clip = el.ownerSVGElement ? el.ownerSVGElement.getBoundingClientRect() : r;
          const left = Math.max(r.left, clip.left);
          const right = Math.min(r.right, clip.right);
          const top = Math.max(r.top, clip.top);
          const bottom = Math.min(r.bottom, clip.bottom);
          for (let fy = 0.5; fy > 0; fy -= 0.1) {
            for (let fx = 0.5; fx > 0; fx -= 0.1) {
              const x = left + (right - left) * fx;
              const y = top + (bottom - top) * fy;
              const hit = document.elementFromPoint(x, y);
              if (hit && (hit === el || el.contains(hit))) return { x: x - r.left, y: y - r.top };
            }
          }
          return { x: r.width / 2, y: r.height / 2 };
        }, id);
        await page.frameLocator(`#dp-${f.name}`).locator(`#${id}`).click({ position, timeout: 5000 });
      } catch (e) {
        errors.push(`${id}: ${String(e && e.message).split('\n')[0]}`);
      }
    }
    // A frame a click navigated holds another doc, with no record of its own.
    const hit = await f.frame.evaluate(() => window.__dpClicks || []).catch(() => []);
    return { ok: !errors.length && ids.every((id) => hit.includes(id)), hit, errors };
  }
  // Sends `ticks` rounds of one `section` per id, every `every` ms, each a longer prefix of that id's full text,
  // from the parent page itself so the pace is the page's, not this process's.
  const stream = (f, ids, fulls, ticks, every) => page.evaluate(async ({ name, n, ids, fulls, ticks, every, ns }) => {
    const w = window.__dp.els[name].contentWindow;
    const sent = {};
    const t0 = performance.now();
    for (let k = 1; k <= ticks; k++) {
      const wait = t0 + (k - 1) * every - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      for (const id of ids) {
        const full = fulls[id];
        w.postMessage({ ns, v: 1, n, t: 'section', id, rev: k, html: full.slice(0, Math.ceil((full.length * k) / ticks)), final: false }, '*');
        sent[id] = { rev: k, at: performance.now() };
      }
    }
    return { t0, ms: performance.now() - t0, sent };
  }, { name: f.name, n: f.nonce, ids, fulls, ticks, every, ns: NS });

  // --- The hostile design's build doc: the strip and the CSP together. ---
  const hb = await openDoc('hb', bases.hostile, 'build');
  const hbUrl = hb.frame.url();
  await sleep(1500);
  const hbLoads1500 = await loadsOf('hb');
  const hbUrl1500 = hb.frame.url();
  const hbClicks = await clickAll(hb, [...CLICK_IDS, ...NAV_IDS]);
  await sleep(500);
  const hbWinPwn = await hb.frame.evaluate(() => window.__pwn ?? null);
  check('build doc: no hostile payload fired', hbClicks.ok && !pwns('hb').length && hbWinPwn === null,
    `clicked ${hbClicks.hit.join(',')}${hbClicks.errors.length ? `; click errors ${hbClicks.errors.join(' | ')}` : ''}; pwn ${JSON.stringify(pwns('hb'))}; window.__pwn ${hbWinPwn}`);
  const hbLoadsEnd = await loadsOf('hb');
  check('meta refresh did not navigate', hbLoads1500 === 1 && hbLoadsEnd === 1 && hbUrl1500 === hbUrl && hb.frame.url() === hbUrl,
    `loads ${hbLoads1500} at 1500 ms, ${hbLoadsEnd} after the clicks; url ${hb.frame.url() === hbUrl ? 'unchanged' : `${hbUrl} -> ${hb.frame.url()}`}`);
  // The same doc sent `ready` (openDoc) under SHELL_CLOBBER; morphdom loaded and a root still merges.
  await send(hb, 'section', { id: 'hero', rev: 1, html: '<section><h1>Ship, merged</h1></section>', final: true });
  const hbApplied = await until(() => appliedOf('hb', 'hero', 1)[0], 5000);
  const hbHero = await hb.frame.evaluate(() => ({ morphdom: typeof window.morphdom, clobbered: document.createElement instanceof Element,
    html: Document.prototype.querySelector.call(document, '[data-section="hero"]')?.outerHTML ?? null })).catch((e) => ({ error: String(e && e.message).split('\n')[0] }));
  check('a shell naming Document members still boots and merges',
    !!hbApplied && hbHero.morphdom === 'function' && hbHero.clobbered === true && hbHero.html === '<section data-section="hero"><h1>Ship, merged</h1></section>',
    `applied ${hbApplied ? 'rev 1' : 'never'}; ${JSON.stringify(hbHero)}${errs('hb').length ? `; err ${errs('hb').join(' | ')}` : ''}`);

  // --- A raw hostile file under the build CSP (no strip: the CSP alone), then the same markup as a live section. ---
  const hr = await openFile('hr', bases.hostile, 'build', 'hostile.html');
  const hrLoads = await loadsOf('hr');
  await sleep(1500);
  const hrClicks = await clickAll(hr, CLICK_IDS);
  await sleep(500);
  const lv = await openDoc('lv', bases.clean, 'build');
  await send(lv, 'section', { id: 'price', rev: 1, html: `<section>${hostileMarkup(fire)}</section>`, final: true });
  const lvApplied = await until(() => appliedOf('lv', 'price', 1)[0], 5000);
  const lvClicks = await clickAll(lv, CLICK_IDS);
  await sleep(1000);
  await sync();
  check('raw file under build CSP: no hostile payload fired',
    hrLoads === 1 && hrClicks.ok && !pwns('hr').length && !!lvApplied && lvClicks.ok && !pwns('lv').length,
    `raw: loaded ${hrLoads}, clicked ${hrClicks.hit.join(',')}${hrClicks.errors.length ? ` errors ${hrClicks.errors.join(' | ')}` : ''}, pwn ${JSON.stringify(pwns('hr'))}; `
      + `live section: applied ${lvApplied ? `rev ${lvApplied.data.rev}` : 'never'}, clicked ${lvClicks.hit.join(',')}, pwn ${JSON.stringify(pwns('lv'))}${errs('lv').length ? `, err ${errs('lv').join(' | ')}` : ''}`);

  // --- The font: a css message with @font-face from assets/p.woff2, fetched by the opaque frame. ---
  const fo = await openDoc('fo', bases.clean, 'build');
  await send(fo, 'css', { file: 'hero', rev: 1, text: "@font-face{font-family:Probe;src:url(assets/p.woff2) format('woff2')}[data-section=\"hero\"] h1{font-family:Probe}", final: true });
  const faces = await fo.frame.evaluate(async () => {
    try {
      const r = await Promise.race([document.fonts.load('16px Probe'), new Promise((res) => setTimeout(() => res('timeout'), 6000))]);
      return Array.isArray(r) ? r.map((face) => face.status) : r;
    } catch (e) {
      return `rejected ${e && e.name}`;
    }
  });
  const fontSeen = [];
  for (const r of fontRequests) {
    const headers = await r.allHeaders();
    const resp = await r.response();
    fontSeen.push({ origin: headers.origin, mode: headers['sec-fetch-mode'], status: resp ? resp.status() : null, acao: resp ? resp.headers()['access-control-allow-origin'] : null });
  }
  // Task 1's table: Chrome and Firefox send a CORS request with Origin: null; WebKit fetches the face no-cors with no Origin.
  const originOk = (s) => s.origin === 'null' || (NAME === 'webkit' && s.origin === undefined);
  check('font loaded with Origin: null',
    Array.isArray(faces) && faces.length > 0 && faces.every((s) => s === 'loaded') && fontSeen.length > 0
      && fontSeen.every((s) => s.status === 200 && s.acao === '*' && originOk(s)),
    `faces ${JSON.stringify(faces)}; requests ${fontSeen.map((s) => `Origin=${s.origin ?? 'absent'} Sec-Fetch-Mode=${s.mode ?? '-'} ${s.status} ACAO=${s.acao}`).join(', ') || 'none'}`);

  // --- applied geometry after the frame scrolled. ---
  const rc = await openDoc('rc', bases.clean, 'build');
  await send(rc, 'css', { file: 'price', rev: 1, text: '.pad{height:1400px}', final: true });
  await send(rc, 'section', { id: 'price', rev: 1, html: '<section><h2>Price</h2><div class="pad"></div><p>End of price</p></section>', final: true });
  await until(() => appliedOf('rc', 'price', 1)[0], 5000);
  const scrolled = await rc.frame.evaluate(() => { scrollTo(0, 600); return scrollY; });
  await send(rc, 'section', { id: 'price', rev: 2, html: '<section><h2>Price</h2><div class="pad"></div><p>End of price, once more</p></section>', final: true });
  const rcApplied = await until(() => appliedOf('rc', 'price', 2)[0], 5000);
  const real = await rc.frame.evaluate(() => {
    const r = document.querySelector('[data-section="price"]').getBoundingClientRect();
    return { rect: [r.x + scrollX, r.y + scrollY, r.width, r.height], scrollY };
  });
  const ar = rcApplied ? rcApplied.data.rect : null;
  const tail = rcApplied ? rcApplied.data.tail.rect : null;
  const rectOk = !!ar && ar.every((v, i) => Math.abs(v - real.rect[i]) <= 1);
  const tailOk = !!tail && !!ar && tail[0] >= ar[0] - 1 && tail[1] >= ar[1] - 1 && tail[0] + tail[2] <= ar[0] + ar[2] + 1 && tail[1] + tail[3] <= ar[1] + ar[3] + 1;
  check('applied rect matches the element', scrolled > 0 && real.scrollY === scrolled && rectOk && tailOk,
    `scrollY ${real.scrollY}; applied ${JSON.stringify(ar)} vs element ${JSON.stringify(real.rect.map(round))}; tail ${JSON.stringify(tail)}`);

  // --- One section, 40 messages at 50 ms: the shared 125 ms beat holds it near 8 Hz. ---
  const pc = await openDoc('pc', bases.clean, 'build');
  const pcRun = await stream(pc, ['price'], { price: streamHtml('price', 4096) }, 40, 50);
  await sleep(700);
  await sync();
  const pcApplied = appliedOf('pc', 'price');
  const pcLast = appliedOf('pc', 'price', 40)[0];
  const pcLag = pcLast ? pcLast.at - pcRun.sent.price.at : null;
  check('at most 8 applies a second', pcApplied.length <= 18 && !!pcLast && pcLag <= 500,
    `${pcApplied.length} applies for 40 messages over ${Math.round(pcRun.ms)} ms; last rev ${pcLast ? `landed ${Math.round(pcLag)} ms after its send` : 'never landed'}`);

  // --- The settle: WAAPI running right after an apply, and nothing left on the markup once it ends. ---
  const st = await openDoc('st', bases.clean, 'build');
  await st.frame.evaluate((n) => {
    window.__dpAnim = [];
    // Added after the bridge's listener, so it runs right after the bridge's synchronous flush of the same message.
    // The ghost (P4, id 'worca-ghost') is its own animation with a 550 ms settle: only the settle is counted here.
    addEventListener('message', (e) => { if (e.data && e.data.n === n && e.data.t === 'section') window.__dpAnim.push(document.getAnimations().filter((a) => a.id !== 'worca-ghost').length); });
  }, st.nonce);
  const settleHtml = ['<section class="settle"><h2>Settle</h2><p>one</p></section>', '<section class="settle"><h2>Settle</h2><p>one</p><p>two</p></section>'];
  const settled = [];
  for (const [i, html] of settleHtml.entries()) {
    await send(st, 'section', { id: 'price', rev: i + 1, html, final: true });
    await until(() => appliedOf('st', 'price', i + 1)[0], 5000);
    await sleep(500);
    settled.push(await st.frame.evaluate(() => ({ html: document.querySelector('[data-section="price"]').outerHTML, live: document.getAnimations().filter((a) => a.id !== 'worca-ghost').length })));
  }
  const anims = await st.frame.evaluate(() => window.__dpAnim);
  const expected = settleHtml.map((h) => h.replace('<section class="settle">', '<section class="settle" data-section="price">'));
  check('settle ran and added no attribute',
    anims.length === 2 && anims.every((n) => n > 0) && settled.every((s, i) => s.html === expected[i] && s.live === 0),
    `animations right after each apply ${JSON.stringify(anims)}; once finished ${JSON.stringify(settled.map((s) => s.live))}; markup ${settled.every((s, i) => s.html === expected[i]) ? 'as sent plus data-section' : JSON.stringify(settled.map((s) => s.html))}`);

  // --- Media across a morph (R13): the same <video> keeps playing while a sibling changes. ---
  const vd = await openDoc('vd', bases.clean, 'build');
  const video = (p) => `<section><video muted loop playsinline src="assets/p.webm"></video>${p}</section>`;
  await send(vd, 'section', { id: 'price', rev: 1, html: video('<p>one</p>'), final: true });
  await until(() => appliedOf('vd', 'price', 1)[0], 5000);
  const started = await vd.frame.evaluate(async () => {
    const v = document.querySelector('[data-section="price"] video');
    v.__dpProbe = true;
    try { await v.play(); } catch (e) { return { error: `${e && e.name}: ${e && e.message}`, code: v.error && v.error.code }; }
    const end = performance.now() + 3000;
    while (v.currentTime === 0 && performance.now() < end) await new Promise((r) => setTimeout(r, 50));
    return { t: v.currentTime, paused: v.paused, code: v.error && v.error.code };
  });
  await send(vd, 'section', { id: 'price', rev: 2, html: video('<p>one, edited</p><p>two</p>'), final: true });
  const vdApplied = await until(() => appliedOf('vd', 'price', 2)[0], 5000);
  const playing = await vd.frame.evaluate(async () => {
    const v = document.querySelector('[data-section="price"] video');
    const ts = [];
    for (let i = 0; i < 6; i++) { ts.push(v.currentTime); await new Promise((r) => setTimeout(r, 100)); }
    return { same: !!(v && v.__dpProbe && v.isConnected), paused: v.paused, ts, sibling: document.querySelector('[data-section="price"] p').textContent };
  });
  const rises = playing.ts.filter((t, i) => i > 0 && t > playing.ts[i - 1]).length;
  check('video kept playing across a morph',
    !started.error && started.t > 0 && !!vdApplied && playing.same && !playing.paused && playing.sibling === 'one, edited' && rises >= 3,
    started.error ? `play failed: ${started.error} (media error ${started.code})`
      : `same element ${playing.same}, paused ${playing.paused}, currentTime ${playing.ts.map((t) => t.toFixed(2)).join(' ')} (${rises} of 5 steps rose)`);

  // --- The fine design (M5): a slot nested in the lead's grid, 40 rects, and 12 live sections. ---
  const ids = Array.from({ length: 40 }, (_, i) => `s${i}`);
  const rowOf = (f) => f.frame.evaluate(() => Array.from(document.querySelector('.row').children, (c) => ({
    key: c.getAttribute('data-section') || c.getAttribute('data-worca-slot'), slot: c.hasAttribute('data-worca-slot'), x: c.getBoundingClientRect().x })));
  const ns = await openDoc('ns', bases.fine, 'build');
  const rowBefore = await rowOf(ns);
  await send(ns, 'section', { id: 's1', rev: 1, html: '<article><h3>S1</h3><p>Nested in the first row.</p></article>', final: true });
  const nsApplied = await until(() => appliedOf('ns', 's1', 1)[0], 5000);
  const rowAfter = await rowOf(ns);
  const slotsLeft = await ns.frame.evaluate(() => document.querySelectorAll('[data-worca-slot="s1"]').length);
  const neighboursKept = [0, 2, 3].every((i) => rowBefore[i] && rowAfter[i] && rowBefore[i].key === rowAfter[i].key && Math.abs(rowBefore[i].x - rowAfter[i].x) <= 0.5);
  check('a nested slot was replaced where it stood',
    !!nsApplied && rowBefore.map((c) => c.key).join() === 's0,s1,s2,s3' && rowAfter.length === 4 && rowAfter[1].key === 's1' && !rowAfter[1].slot
      && slotsLeft === 0 && neighboursKept,
    `row before ${rowBefore.map((c) => `${c.key}@${round(c.x)}`).join(' ')}; after ${rowAfter.map((c) => `${c.slot ? 'slot ' : ''}${c.key}@${round(c.x)}`).join(' ')}`);

  const plan40 = { sections: ids.map((id) => ({ id, estHeight: 100 })) };
  const p40 = await openDoc('p40', bases.fine, 'build');
  const p40At = await send(p40, 'plan', plan40);
  const finite = (r) => Array.isArray(r) && r.length === 4 && r.every((v) => Number.isFinite(v));
  const p40Rects = await until(() => msgs('p40', 'rects').find((m) => m.at > p40At && m.data.sections.length === 40 && m.data.sections.every((s) => s.rect[3] >= 99.5)), 5000);
  const p40Last = msgs('p40', 'rects').at(-1);
  const p40Ids = p40Rects ? p40Rects.data.sections.map((s) => s.id) : [];
  check('rects reported all 40',
    !!p40Rects && new Set(p40Ids).size === 40 && ids.every((id) => p40Ids.includes(id)) && p40Rects.data.sections.every((s) => finite(s.rect)),
    p40Rects ? `${p40Rects.data.sections.length} sections, each finite and at least its estHeight tall; docH ${p40Rects.data.docH}`
      : `latest rects held ${p40Last ? p40Last.data.sections.length : 0} sections`);

  const l12 = await openDoc('l12', bases.fine, 'build');
  await send(l12, 'plan', plan40);
  await sleep(300);
  const longtaskOn = await l12.frame.evaluate(() => {
    window.__dpLong = [];
    window.__dpGap = 0;
    let on = false;
    try {
      if ((PerformanceObserver.supportedEntryTypes || []).includes('longtask')) {
        new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__dpLong.push(e.duration); }).observe({ type: 'longtask' });
        on = true;
      }
    } catch { on = false; }
    let last = performance.now();
    window.__dpGapTimer = setInterval(() => { const now = performance.now(); window.__dpGap = Math.max(window.__dpGap, now - last); last = now; }, 16);
    return on;
  });
  const live = ids.slice(0, 12);
  const l12Run = await stream(l12, live, Object.fromEntries(live.map((id) => [id, streamHtml(id, 8192)])), 100, 50);
  await sleep(800);
  await sync();
  const frameStats = await l12.frame.evaluate(() => { clearInterval(window.__dpGapTimer); return { long: window.__dpLong, gap: window.__dpGap }; });
  const perSection = live.map((id) => {
    const last = appliedOf('l12', id, 100)[0];
    return { id, applies: appliedOf('l12', id).length, lag: last ? last.at - l12Run.sent[id].at : null };
  });
  const most = Math.max(...perSection.map((s) => s.applies));
  const lags = perSection.map((s) => s.lag);
  const slowest = lags.includes(null) ? null : Math.max(...lags);
  const largest = frameStats.long.length ? Math.max(...frameStats.long) : 0;
  const stallOk = longtaskOn ? largest <= 200 : frameStats.gap <= 200;
  check('12 live of 40 held the limit',
    most <= 44 && slowest !== null && slowest <= 500 && stallOk && !errs('l12').length,
    `${longtaskOn ? `long tasks ${frameStats.long.length}, largest ${Math.round(largest)} ms` : 'longtask not observable here, judged by the largest timer gap'}; `
      + `largest 16 ms timer gap ${Math.round(frameStats.gap)} ms; most applies per section ${most} over ${Math.round(l12Run.ms)} ms; `
      + `slowest last rev ${slowest === null ? `never landed for ${perSection.filter((s) => s.lag === null).map((s) => s.id).join(',')}` : `${Math.round(slowest)} ms`}`
      + `${errs('l12').length ? `; err ${errs('l12').slice(0, 3).join(' | ')}` : ''}`);

  // --- The run doc: the model's own script runs, and reaches {B} only. ---
  const rn = await openDoc('rn', bases.clean, 'run');
  const ran = await until(() => log.find((m) => m.frame === 'rn' && m.data && m.data.ran === 1), 5000);
  check('run doc: model script ran', !!ran, ran ? `{ran:1} from the frame, origin ${ran.origin}` : 'no {ran:1}');
  const api = await until(() => log.find((m) => m.frame === 'rn' && m.data && m.data.api), 5000);
  const asset = await until(() => log.find((m) => m.frame === 'rn' && m.data && 'asset' in m.data), 5000);
  const cspHits = log.filter((m) => m.frame === 'rn' && m.data && m.data.csp).map((m) => m.data.csp);
  check('run doc: /api refused',
    !!api && api.data.api === 'rejected' && cspHits.includes('connect-src') && !!asset && asset.data.asset === 200,
    `fetch(location.origin + '/api/flags') ${api ? (api.data.api === 'rejected' ? `rejected ${api.data.why}` : `answered ${api.data.status}`) : 'never settled'}; `
      + `violations ${JSON.stringify(cspHits)}; fetch('assets/p.woff2') ${asset ? asset.data.asset : 'never settled'}`);
  await send(rn, 'pick', { on: true });
  let pickError = '';
  try { await page.frameLocator('#dp-rn').locator('h1').click({ timeout: 5000 }); } catch (e) { pickError = String(e && e.message).split('\n')[0]; }
  const picked = await until(() => msgs('rn', 'picked')[0], 5000);
  check('picked the clicked element', !!picked && picked.data.id === 'hero' && picked.data.tag === 'h1',
    picked ? `id ${picked.data.id}, tag ${picked.data.tag}, path ${picked.data.path}` : `no picked${pickError ? `; click: ${pickError}` : ''}`);

  // --- Every doc's ready: an opaque origin, from the frame's own window. ---
  const readies = log.filter((m) => m.data && m.data.ns === NS && m.data.t === 'ready');
  const modes = new Set(readies.map((m) => m.data.mode));
  check('frame origin is null', readies.length >= 2 && modes.has('build') && modes.has('run') && readies.every((m) => m.origin === 'null'),
    `${readies.length} ready messages, each matched to its frame's contentWindow; e.origin ${JSON.stringify([...new Set(readies.map((m) => m.origin))])}`);

  // --- form= controls in the shell and in a finished section: hero's rev adds `<form id="f">`. Last of all: a frame that
  // hangs takes the parent page with it in Firefox and WebKit, so every call after rev 2 is raced in Node (`within`). ---
  const fm = await openDoc('fm', bases.form, 'build');
  const fmRead = () => fm.frame.evaluate(() => {
    const q = (s) => Document.prototype.querySelector.call(document, s);
    const hero = q('[data-section="hero"]');
    return { hero: hero?.outerHTML ?? null, heroIs: hero ? Element.prototype.matches.call(hero, 'form#h.a') : false,
      other: q('[data-section="other"]')?.outerHTML ?? null, aside: q('aside')?.outerHTML ?? null,
      withForm: Document.prototype.querySelectorAll.call(document, '[form]').length };
  }).catch((e) => ({ error: String(e && e.message).split('\n')[0] }));
  const fmBefore = await fmRead();
  await send(fm, 'plan', { sections: [{ id: 'hero' }, { id: 'price' }, { id: 'other' }] });
  // One hero rev: sent and its `applied` awaited, both raced in Node; true, false (never applied) or HANG.
  const fmRev = async (rev, html, final) => {
    if (await within(send(fm, 'section', { id: 'hero', rev, html, final }), 5000) === HANG) return HANG;
    const applied = await within(until(() => appliedOf('fm', 'hero', rev)[0], 5000), 8000);
    return applied === HANG ? HANG : !!applied;
  };
  const fmRevs = [];
  const fmReads = [];
  for (const [html, final, read] of [['<section><h1>Sign up</h1>', false, false],
    ['<section><h1>Sign up</h1><form id="f"><input name="email"></form></section>', true, true],
    ['<form class="a"><p>1</p></form>', true, false], ['<form id="h" class="a"><input name="q"><p>2</p></form>', true, true]]) {
    fmRevs.push(await fmRev(fmRevs.length + 1, html, final));
    if (fmRevs.at(-1) === HANG) break;
    if (read) fmReads.push(await within(fmRead(), 5000));
    if (fmReads.at(-1) === HANG) break;
  }
  const fmHung = fmRevs.includes(HANG) || fmReads.includes(HANG);
  const [fmMid, fmEnd] = fmReads;
  const FM_ASIDE = '<aside><input name="firstChild"><input name="nextSibling"><form id="g"></form></aside>';
  const FM_OTHER = '<section data-section="other"><p>B</p><input name="firstChild"></section>';
  check('form= controls neither hang a merge nor reach another section',
    !fmHung && fmRevs.length === 4 && fmRevs.every((a) => a === true) && !errs('fm').length
      && [fmBefore, fmMid, fmEnd].every((r) => r.withForm === 0 && r.aside === FM_ASIDE && r.other === FM_OTHER)
      && fmMid.hero === '<section data-section="hero"><h1>Sign up</h1><form id="f"><input name="email"></form></section>'
      && fmEnd.heroIs && String(fmEnd.hero).endsWith('><input name="q"><p>2</p></form>'),
    fmHung ? `the frame hung after rev ${fmRevs.length}${fmReads.includes(HANG) ? ' (reading it)' : ''}`
      : `applied ${fmRevs.map((a, i) => `rev ${i + 1} ${a ? 'yes' : 'no'}`).join(', ')}; before ${JSON.stringify(fmBefore)}; after rev 2 ${JSON.stringify(fmMid)}; `
        + `after rev 4 ${JSON.stringify(fmEnd)}${errs('fm').length ? `; err ${errs('fm').join(' | ')}` : ''}`);

  console.log(failures.length ? `${failures.length} failed: ${failures.join('; ')}` : 'all ok');
} catch (e) {
  console.error(e && e.stack ? e.stack : e);
  failures.push('the proof itself');
  console.log('FAIL the proof did not finish');
} finally {
  await finish();
}
process.exitCode = failures.length ? 1 : 0;
