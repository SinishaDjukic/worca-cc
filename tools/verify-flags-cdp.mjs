#!/usr/bin/env node
// tools/verify-flags-cdp.mjs — headless-Chrome proof of live feature flags (docs/feature-flags.md, D6):
// flip the demo flag through window.__np.flags.set in tab A and watch tab B's note appear and
// disappear through the `flags` WebSocket frame, with no reload. NOT part of `npm test`.
// Run: node tools/verify-flags-cdp.mjs   (or: npm run verify:flags)
//
// --stillhet [--base REF]: the Stillhet proof, by hand once per slice (docs/feature-flags.md, `rail`). Two sandboxed mock
// servers, this tree and a temporary git worktree of REF (default origin/dev), both seeded onboarding.stillhetAsked and
// welcomeSeen, so neither shows a prompt. Pass A, flag off: computed styles of every element on #chat/new, #runs and
// #settings at 1280 and 375, light and dark, matched by DOM path, diff to 0 (#stillhet-ask is excluded and checked apart:
// display none, 0 px tall). Pass B, flag on: on #runs and #settings only the non-colour properties are diffed (custom
// properties are tokens: what they change shows in the real properties). Pass C:
// the question shows, links to the issues page, and accept, decline and a Labs write each leave 0 strips after a reload;
// at 360 and 420, light and dark, in all three modes, the strip never overflows and its buttons are 44 px or taller.
//
// -- CI COVERAGE -------------------------------------------------------------
// .github/workflows/ci.yml job `cdp` runs this on every push and pull request.
// What stays CDP-only: two real tabs on one server, real CSS (the #flag-gates
// sheet against computed display), and the no-page-error gate. The DOM shapes
// are pinned in test/ui-flags.test.mjs.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const PORT = Number(process.env.CDP_PORT || 9343);
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

const STILLHET = process.argv.includes('--stillhet');
const BASE_REF = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'origin/dev';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let chrome = null; let srv = null; let home = null; let profile = null; let failed = 0;
const sockets = []; const children = []; let devTree = null;
async function shutdown(code) {
  for (const s of sockets) { try { s.close(); } catch {} }
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}
  for (const c of children) { try { c.kill('SIGTERM'); } catch {} }
  if (devTree) { try { execFileSync('git', ['worktree', 'remove', '--force', devTree], { cwd: ROOT, stdio: 'ignore' }); } catch {} }
  try { if (srv) { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); } } catch {}
  for (const dir of [home, profile]) { try { if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 3 }); } catch {} }
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail = '') => {
  if (ok) log(`ok   ${name}`);
  else { failed += 1; log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`); }
};

// ---- an isolated home + the app server (env BEFORE the import, the house pattern). settings.json
// lives under HOME and this proof PATCHes flags, so HOME is sandboxed too: the developer's real
// settings are never rewritten. Chrome keeps the real profile env.
home = await mkdtemp(path.join(tmpdir(), 'worca-flags-home-'));
const REAL_ENV = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.WORCA_HOME = home;
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.WORCA_MOCK = '1';
delete process.env.WORCA_FLAGS;
// The WebSocketServer is attached to the MODULE's `server` (a bare
// http.createServer(app) answers the /ws upgrade with 404 and no frame arrives).
let base = '';
if (!STILLHET) {
  const { server } = await import(new URL('../ui/server.mjs', import.meta.url).href);
  srv = server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  log(`server on ${base}`);
}

// ---- Chrome, with the REAL home back for its caches
profile = await mkdtemp(path.join(tmpdir(), 'worca-flags-profile-'));
chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--disable-gpu', '--use-mock-keychain', '--window-size=1400,1000', ...SANDBOX, 'about:blank'],
{ env: { ...process.env, ...REAL_ENV }, stdio: 'ignore' });

// Up to 30 s: a cold Chrome on a busy CI runner can take more than 10 s to open its endpoint.
let up = false;
for (let i = 0; i < 120 && !up; i += 1) {
  try { up = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { /* not listening yet */ }
  if (!up) await sleep(250);
}
if (!up) { log('no CDP endpoint'); await shutdown(1); }

const { WebSocket } = await import('ws');

/** One CDP session on one page target: { send, evalJs, pageErrors }. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  sockets.push(ws);
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  let msgId = 0;
  const pending = new Map();
  const pageErrors = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(m.params.exceptionDetails?.exception?.description || 'exception');
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = (msgId += 1);
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  for (let t0 = Date.now(); Date.now() - t0 < 15000;) {
    if (await evalJs(`document.readyState === 'complete' && location.href !== 'about:blank'`).catch(() => false)) break;
    await sleep(100);
  }
  return { send, evalJs, pageErrors };
}

/** A new tab on `url`, through the DevTools HTTP endpoint (PUT is required since Chrome 111). */
async function openPage(url) {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!r.ok) throw new Error(`could not open a tab: HTTP ${r.status}`);
  const { webSocketDebuggerUrl } = await r.json();
  return connect(webSocketDebuggerUrl);
}

if (STILLHET) await stillhetProof();

const A = await openPage(`${base}/#settings/experimental`);
const B = await openPage(`${base}/#settings/experimental`);
const shown = (p) => p.evalJs(`(() => { const n = document.getElementById('flags-demo-note'); return !!n && getComputedStyle(n).display !== 'none'; })()`);
const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(50); } return false; };

// Both tabs booted and their sockets said hello (the flags frame only reaches an open socket).
await until(async () => (await A.evalJs('!!window.__np && !!window.__np.flags')) && (await B.evalJs('!!window.__np && !!window.__np.flags')), 15000);
await sleep(500);
check('first paint: the note is hidden in both tabs (flag off, no flash)', !(await shown(A)) && !(await shown(B)));
await A.evalJs(`window.__np.flags.set('flagsDemo', true)`);
check('on in tab A shows the note in tab B within a second, no reload', await until(() => shown(B), 1000));
check('tab B\'s chip links to the row', await B.evalJs(`document.querySelector('#flags-demo-note a.flag-chip')?.getAttribute('href') === '#settings/experimental/flagsDemo'`));
await A.evalJs(`window.__np.flags.set('flagsDemo', false)`);
check('off in tab A hides it again in tab B', await until(async () => !(await shown(B)), 1000));
check('no page errors', A.pageErrors.length + B.pageErrors.length === 0, [...A.pageErrors, ...B.pageErrors].join(' | '));
log(failed ? `${failed} check(s) failed` : 'all checks passed');
await shutdown(failed ? 1 : 0);

// ---- --stillhet ------------------------------------------------------------------------------------------------------
/** A mock server from `dir` on a free port, its HOME seeded with `onboarding`. Resolves to its base URL. */
async function child(dir, onboarding) {
  const h = await mkdtemp(path.join(tmpdir(), 'worca-stillhet-home-'));
  await mkdir(path.join(h, '.worca-cc'), { recursive: true });
  await writeFile(path.join(h, '.worca-cc', 'settings.json'), JSON.stringify({ onboarding }));
  const port = 4900 + Math.floor(Math.random() * 90);
  const env = { ...process.env, HOME: h, USERPROFILE: h, WORCA_HOME: path.join(h, 'wh'), WORCA_MOCK: '1', PORT: String(port) };
  delete env.WORCA_FLAGS; delete env.FORCE_COLOR;
  const c = spawn(process.execPath, ['ui/server.mjs'], { cwd: dir, env, stdio: 'ignore' });
  children.push(c);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i += 1) {
    try { const r = await fetch(`${url}/api/projects`); if (r.ok && (await r.json()).projects.length === 0) return url; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`no server from ${dir} on ${port} (in use?)`);
}

async function stillhetProof() {
  // --base must name a commit: never an option for git worktree add
  if (!BASE_REF || BASE_REF.startsWith('-')) throw new Error(`--base wants a commit, not ${JSON.stringify(BASE_REF)}`);
  execFileSync('git', ['rev-parse', '--verify', '--quiet', '--end-of-options', `${BASE_REF}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
  devTree = await mkdtemp(path.join(tmpdir(), 'worca-stillhet-dev-'));
  await rm(devTree, { recursive: true, force: true });
  execFileSync('git', ['worktree', 'add', '--detach', devTree, BASE_REF], { cwd: ROOT, stdio: 'ignore' });
  await symlink(path.join(ROOT, 'node_modules'), path.join(devTree, 'node_modules'));
  const seeded = { stillhetAsked: true, welcomeSeen: true };
  const [mine, dev] = await Promise.all([child(ROOT, seeded), child(devTree, seeded)]);
  log(`this tree on ${mine}, ${BASE_REF} on ${dev}`);
  const P = await openPage(`${mine}/#runs`); const D = await openPage(`${dev}/#runs`);
  // Both tabs act focused, so a focused field draws the same in each (headless focuses one tab at a time).
  for (const t of [P, D]) await t.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  let n = 0;
  const go = async (page, url, width, scheme) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: scheme }] });
    const [u, hash] = url.split('#');
    await page.send('Page.navigate', { url: `${u}?r=${(n += 1)}#${hash}` });
    await sleep(2500);
  };
  const json = (url, method, body) => fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  // Every element's computed style by DOM path (an id, else tag and nth-of-type up to the nearest id); #stillhet-ask is
  // left out of the walk and of the sibling counts, so the paths of both trees line up.
  // A page holds thousands of elements: the snapshot sends each one's hash, and the full text only for the keys asked for.
  const SNAP = (colourToo, only = null) => `(() => {
    const ONLY = ${JSON.stringify(only)};
    const hash = (t) => { let h = 2166136261; for (let i = 0; i < t.length; i += 1) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + '.' + t.length; };
    const COLOUR = /color|background|shadow|fill|stroke|caret|outline|filter/;
    const key = (el) => { const parts = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.id && !/-[a-z0-9]{8}$/.test(e.id)) { parts.unshift('#' + e.id); break; }   // a generated id (ask-suggest-x7k…) is not a name
      let i = 1; for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === e.tagName && s.id !== 'stillhet-ask') i += 1;
      parts.unshift(e.tagName.toLowerCase() + ':' + i); } return parts.join('>'); };
    const out = {};
    for (const el of document.querySelectorAll('html, body *')) {
      if (el.closest('#stillhet-ask')) continue;
      const k = key(el); if (ONLY && !ONLY.includes(k)) continue;
      const cs = getComputedStyle(el); const v = [];
      for (const p of cs) if (${colourToo} || !(COLOUR.test(p) || p.startsWith('--'))) v.push(p + ':' + cs.getPropertyValue(p).split(location.origin).join(''));   // the two servers' origins differ
      const text = v.sort().join(';');   // a custom property's place in the list is not stable across pages
      out[k] = ONLY ? text : hash(text);
    }
    return out; })()`;
  const diff = (a, b) => { const bad = []; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) bad.push(k); return bad; };
  const props = (s) => Object.fromEntries((s || '').split(';').map((x) => [x.slice(0, x.indexOf(':')), x.slice(x.indexOf(':') + 1)]));
  // A late paint (a list that loads after the page) can land between the two snapshots: a difference is read twice.
  const compare = async (colourToo) => { let bad = diff(await P.evalJs(SNAP(colourToo)), await D.evalJs(SNAP(colourToo)));
    if (bad.length) { await sleep(1500); bad = diff(await P.evalJs(SNAP(colourToo)), await D.evalJs(SNAP(colourToo))); } return bad; };
  const explain = async (colourToo, bad) => { const ks = bad.slice(0, 3); const a = await P.evalJs(SNAP(colourToo, ks)); const b = await D.evalJs(SNAP(colourToo, ks)); return ks.map((k) => why(a, b, k)).join(' | '); };
  const why = (a, b, k) => { const x = props(a[k]); const y = props(b[k]); return `${k} ${Object.keys({ ...x, ...y }).filter((p) => x[p] !== y[p]).slice(0, 4).map((p) => `${p}: ${y[p]} → ${x[p]}`).join(', ')}`; };

  // Pass A: flag off, no strip.
  for (const route of ['#chat/new', '#runs', '#settings']) for (const width of [1280, 375]) for (const scheme of ['light', 'dark']) {
    await go(P, `${mine}/${route}`, width, scheme); await go(D, `${dev}/${route}`, width, scheme);
    const bad = await compare(true);
    check(`A ${route} ${width} ${scheme}: 0 elements differ from ${BASE_REF} (flag off)`, bad.length === 0, bad.length ? `${bad.length}: ${await explain(true, bad)}` : '');
    check(`A ${route} ${width} ${scheme}: #stillhet-ask is hidden and 0 px tall`, await P.evalJs(`(() => { const h = document.getElementById('stillhet-ask'); return !!h && getComputedStyle(h).display === 'none' && h.offsetHeight === 0; })()`));
  }
  // Pass B: flag on, only the non-colour properties.
  await json(`${mine}/api/flags`, 'PATCH', { rail: true });
  for (const route of ['#runs', '#settings']) for (const width of [1280, 375]) for (const scheme of ['light', 'dark']) {
    await go(P, `${mine}/${route}`, width, scheme); await go(D, `${dev}/${route}`, width, scheme);
    const bad = await compare(false);
    check(`B ${route} ${width} ${scheme}: data-rail on, 0 elements differ in non-colour properties`, (await P.evalJs(`document.documentElement.hasAttribute('data-rail')`)) && bad.length === 0, bad.length ? `${bad.length}: ${await explain(false, bad)}` : '');
  }
  // Pass C: the question itself.
  const ask = async () => { await json(`${mine}/api/flags`, 'PATCH', { rail: null }); await json(`${mine}/api/onboarding`, 'POST', { stillhetAsked: false }); };
  const strips = () => P.evalJs(`document.querySelectorAll('#stillhet-ask .rc-confirm').length`);
  await ask(); await go(P, `${mine}/#runs`, 1280, 'light');
  check('C the question shows once, linking to the issues page', (await strips()) === 1 && (await P.evalJs(`document.querySelector('#stillhet-ask a.dc-out')?.href`)) === 'https://github.com/SinishaDjukic/worca-cc/issues');
  await P.evalJs(`document.querySelector('#stillhet-ask [data-confirm="yes"]').click()`); await sleep(800);
  await go(P, `${mine}/#runs`, 1280, 'light');
  check('C accept, then reload: 0 strips, data-rail present', (await strips()) === 0 && await P.evalJs(`document.documentElement.hasAttribute('data-rail')`));
  await ask(); await go(P, `${mine}/#runs`, 1280, 'light');
  await P.evalJs(`document.querySelector('#stillhet-ask [data-confirm="no"]').click()`); await sleep(800);
  await go(P, `${mine}/#runs`, 1280, 'light');
  check('C decline, then reload: 0 strips, data-rail absent', (await strips()) === 0 && !(await P.evalJs(`document.documentElement.hasAttribute('data-rail')`)));
  await ask(); await P.evalJs(`window.__np.flags.set('rail', true).then(() => window.__np.flags.set('rail', false))`); await sleep(800);
  await go(P, `${mine}/#runs`, 1280, 'light');
  check('C Labs on then off, then reload: 0 strips', (await strips()) === 0);
  for (const level of ['simple', 'advanced', 'expert']) for (const width of [360, 420]) for (const scheme of ['light', 'dark']) {
    await ask(); await json(`${mine}/api/settings`, 'POST', { uiLevel: level });
    await go(P, `${mine}/#runs`, width, scheme);
    const m = await P.evalJs(`(() => { const f = document.querySelector('#stillhet-ask .rc-confirm'); if (!f) return null;
      return { fits: f.scrollWidth <= f.clientWidth, tall: [...f.querySelectorAll('button')].every((b) => b.getBoundingClientRect().height >= 44), rail: document.documentElement.hasAttribute('data-rail') }; })()`);
    check(`C ${level} ${width} ${scheme}: the strip fits and its buttons are 44 px or taller (data-rail absent)`, !!m && m.fits && m.tall && !m.rail, JSON.stringify(m));
  }
  check('no page errors', P.pageErrors.length + D.pageErrors.length === 0, [...P.pageErrors, ...D.pageErrors].slice(0, 3).join(' | '));
  log(failed ? `${failed} check(s) failed` : 'all checks passed');
  await shutdown(failed ? 1 : 0);
}
