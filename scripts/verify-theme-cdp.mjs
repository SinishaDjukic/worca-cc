#!/usr/bin/env node
// scripts/verify-theme-cdp.mjs — headless-Chrome proof for the light + dark theme
// (spec docs/superpowers/specs/2026-09-04-dark-mode-design.md §7.2-§7.4). NOT part
// of `npm test`: needs Chrome. CI job `cdp` runs it (`npm run verify:theme`).
//
//   node scripts/verify-theme-cdp.mjs                 audit both themes; exit 1 on a
//                                                     dark violation or a light one
//                                                     outside the committed baseline
//   … --snapshot [FILE]     write the LIGHT computed-style identity snapshot, exit 0
//   … --compare  [FILE]     compare the light rendering with FILE (D9); exit 1 on a
//                           difference outside ALLOW_DRIFT; no contrast gate runs
//   … --write-baseline      (re)write test/fixtures/contrast-baseline-light.json
//   … --out DIR             where the per-theme JSON reports go
//   … --states a,b          run only these state ids (debugging). Most states build on
//                           the screen the previous one left (new-error←new, running-list-
//                           compact←running-list, composer-*←composer, ask-*-picker←ask-sheet,
//                           modal-*←modal-confirm): pick a CONTIGUOUS run. The identity
//                           compare is skipped under --states (a skipped state would read
//                           as "every row vanished").
// --snapshot and --compare are mutually exclusive (writing first would compare the file
// with itself). Every mode exits 1 on a page error.
//
// FILE / DIR default to <git common dir>/worca-theme/ — shared by every worktree of
// this repo, never seen by git, created on demand (the identity snapshot is ~3 MB and
// is never committed).
//
// Determinism: every sample is taken (1) under an EXPLICIT prefers-color-scheme
// emulation (this Mac's headless Chrome defaults to dark — spec F14), (2) after the
// webfonts and the two mask assets have loaded (an unloaded CSS mask paints its
// element unmasked), and (3) with every transition and animation frozen — the app
// transitions colours over .12-.18 s and one rAF after a theme flip getComputedStyle
// returns interpolated values (measured 2026-09-05: 478 spurious cells per run).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
// A bare flag (no value, or followed by another flag) yields '' so the caller can
// take the default location.
const flag = (name) => { const i = args.indexOf(name); if (i === -1) return null; const v = args[i + 1]; return v && !v.startsWith('--') ? v : ''; };
const ROOT = new URL('..', import.meta.url);
const REPO = fileURLToPath(ROOT);
const COMMON = path.resolve(REPO, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: REPO }).toString().trim());
const SCRATCH_DIR = path.join(COMMON, 'worca-theme');
mkdirSync(SCRATCH_DIR, { recursive: true });
const DEFAULT_SNAPSHOT = path.join(SCRATCH_DIR, 'light-identity.json');
const SNAPSHOT = flag('--snapshot') === '' ? DEFAULT_SNAPSHOT : flag('--snapshot');
const COMPARE = flag('--compare') === '' ? DEFAULT_SNAPSHOT : flag('--compare');
const WRITE_BASELINE = args.includes('--write-baseline');
const OUT = flag('--out') || SCRATCH_DIR;
mkdirSync(OUT, { recursive: true });
const ONLY = (flag('--states') || '').split(',').filter(Boolean);
if (SNAPSHOT && COMPARE) { console.error('--snapshot and --compare are mutually exclusive: write the snapshot in one run, compare in the next'); process.exit(2); }
if (COMPARE && ONLY.length) console.warn('WARN --states given: the identity compare is skipped (partial runs cannot be compared with a full snapshot)');
const BASELINE_FILE = new URL('test/fixtures/contrast-baseline-light.json', ROOT);
const FIXTURE_FILE = new URL('test/fixtures/theme-kitchen-sink.html', ROOT);

const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const PORT = Number(process.env.CDP_PORT || 9336);   // 9333 composer, 9334 run-monitor, 9335 memory, 9337 the mask generator
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let home = null; let proj = null; let profile = null;
async function shutdown(code) {
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}
  try { if (srv) await new Promise((r) => srv.close(r)); } catch {}
  for (const d of [home, proj, profile]) { try { if (d) await rm(d, { recursive: true, force: true }); } catch {} }
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a one-commit git project + the app server (env BEFORE the import) -------
home = await mkdtemp(path.join(tmpdir(), 'worca-theme-home-'));
// settings.json lives under defaultRoot() = HOME/USERPROFILE (src/core/settings.mjs:58), which
// WORCA_HOME does NOT cover: without these two lines the proof reads — and the booted app can
// write — the developer's real ~/.worca-cc/settings.json, so their STORED THEME, budget caps
// and root would leak into every sample and the committed light baseline. Chrome, however,
// needs the developer's real home (macOS caches, crashpad): it gets REAL_ENV back below.
const REAL_ENV = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.WORCA_HOME = home;
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.WORCA_MOCK = '1';
proj = await mkdtemp(path.join(tmpdir(), 'worca-theme-proj-'));
for (const a of [['init', '-q'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) {
  execFileSync('git', a, { cwd: proj });
}
await writeFile(path.join(proj, 'README.md'), '# theme proof\n');
execFileSync('git', ['add', '-A'], { cwd: proj });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
const { server, runs } = await import(new URL('ui/server.mjs', ROOT).href);
srv = server;
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
// These proofs measure the full UI, so pin the interface mode to Expert (docs/ui-levels.md) —
// a fresh WORCA_HOME would otherwise serve Simple and hide what they measure.
{ const r = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uiLevel: 'expert' }) });
  if (!r.ok) throw new Error(`could not pin the interface mode: HTTP ${r.status}`); }
log(`server ${base} · project ${proj} · scratch ${SCRATCH_DIR}`);
const api = async (p, opt) => {
  const r = await fetch(base + p, opt);
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
};
// The one-time welcome dialog (docs/getting-started.md) would otherwise open over the first
// New pipeline sample and sit on top of every state after it — it is a dialog, not a state.
// Marking it seen is the only onboarding flag the proof touches; the sidebar pill stays and
// is sampled with the rail like any other row.
await api('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ welcomeSeen: true }) });

// ---- chrome + cdp ------------------------------------------------------------
profile = await mkdtemp(path.join(tmpdir(), 'worca-theme-profile-'));
chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1440,900', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'],
{ stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...REAL_ENV } });
const chromeErr = [];
chrome.stderr.on('data', (d) => { chromeErr.push(String(d)); if (chromeErr.length > 40) chromeErr.shift(); });
let chromeExit = null;
chrome.on('exit', (code, signal) => { chromeExit = { code, signal }; });
let wsUrl = null;
const targetDeadline = Date.now() + 60_000;
while (!wsUrl && Date.now() < targetDeadline && !chromeExit) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(200);
  } catch { await sleep(250); }
}
if (!wsUrl) {
  console.error(chromeExit ? `no devtools target: chrome exited (code ${chromeExit.code}, signal ${chromeExit.signal})` : 'no devtools target after 60s');
  if (chromeErr.length) console.error(chromeErr.join('').trim().split('\n').slice(-15).join('\n'));
  await shutdown(1);
}
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map(); const listeners = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id != null) { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)); return; }
  for (const l of [...listeners]) l(m);
};
function cdp(method, params = {}, ms = 20000) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT ${method}`)); }, ms);
    pending.set(id, { res: (v) => { clearTimeout(to); res(v); }, rej: (er) => { clearTimeout(to); rej(er); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const waitEvent = (name, ms = 20000) => new Promise((res, rej) => {
  const to = setTimeout(() => { off(); rej(new Error(`timeout ${name}`)); }, ms);
  const l = (m) => { if (m.method === name) { clearTimeout(to); off(); res(m.params); } };
  const off = () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
  listeners.push(l);
});
const pageErrors = [];
const consoleErrors = [];   // report-only: the run-monitor proof gates on these too, but this proof visits every view (plugins, models, stats) — a benign console.error there must not fail the theme gate
listeners.push((m) => {
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
});
await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('DOM.enable'); await cdp('CSS.enable');
// A headless page is not "focused": without this, element.focus() sets activeElement but
// fires no focus/focusin events, so :focus-visible outlines and focus-opened tooltips never appear.
await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
// A full-body walker resolves ~16 computed styles per element (up to 8000): give it 90 s, not the 20 s default.
async function ev(expr, ms = 20000) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, ms);
  if (r.exceptionDetails) throw new Error(`EVAL: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n${expr.slice(0, 300)}`);
  return r.result.value;
}
const kick = () => cdp('Page.captureScreenshot', { format: 'jpeg', quality: 1, clip: { x: 0, y: 0, width: 16, height: 16, scale: 1 } }, 20000).catch(() => null);
async function settle(tag = '') {
  await ev('window.__rafHit=0;requestAnimationFrame(()=>{window.__rafHit=1;});0');
  for (let i = 0; i < 10; i += 1) { if (await ev('window.__rafHit')) return; await kick(); }
  throw new Error(`no animation frame after 10 forced frames (${tag})`);
}
async function until(expr, tag, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    if (await ev(`(()=>{try{return !!(${expr});}catch(e){return false;}})()`)) return true;
    await kick(); await sleep(120);
  }
  throw new Error(`timeout waiting for ${tag}`);
}
// Fonts + mask assets loaded (see the header), then every transition/animation
// frozen and any running animation cancelled; two settles so the frozen values are
// the ones getComputedStyle reports.
const READY = `(async()=>{await document.fonts.ready;
  await Promise.all(['/assets/worca-logo-mask.png','/assets/worca-mark-mask.png','/assets/worca-favicon.png'].map((src)=>new Promise((r)=>{const i=new Image();i.onload=i.onerror=r;i.src=src;})));return 1;})()`;
const FREEZE_CSS = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';
async function freeze(tag) {
  await ev(`(()=>{let s=document.getElementById('theme-freeze');if(!s){s=document.createElement('style');s.id='theme-freeze';s.textContent=${JSON.stringify(FREEZE_CSS)};document.head.appendChild(s);}
    (document.getAnimations?.()||[]).forEach((a)=>{try{a.cancel();}catch{}});return 1;})()`);
  await settle(`${tag} freeze-1`); await settle(`${tag} freeze-2`);
}
async function go(hash) {
  await ev(`location.hash=${JSON.stringify(hash)};0`);
  await cdp('Page.reload', {});
  await waitEvent('Page.loadEventFired');
  await until('window.__np && window.__np.getRun', 'app boot');          // the house boot marker (app.js:2344)
  const view = hash.split('/')[0];                                        // the routed section must be the visible one
  await until(`document.querySelector('[data-view=${JSON.stringify(view)}]:not(.hidden)')`, `view ${view}`);
  await sleep(400);                                                       // async list loads (projects, agents, stats, plugins) land here
  await ev(READY);
  await freeze(hash);
}

// ---- theme audit ---------------------------------------------------------------
// THEMES: [id, data-theme attribute, emulated prefers-color-scheme]
const THEMES = [
  ['light', 'light', 'light'],
  ['dark', 'dark', 'light'],
  ['system-dark', 'system', 'dark'],
  ['system-light', 'system', 'light'],
];
async function setTheme([, attr, emulated]) {
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: emulated }] });
  await ev(`document.documentElement.dataset.theme=${JSON.stringify(attr)};0`);
  await freeze('theme');
}
const fixture = readFileSync(FIXTURE_FILE, 'utf8');
async function injectKitchen() {
  await ev(`(()=>{const old=document.getElementById('theme-kitchen');if(old)old.remove();
    const host=document.querySelector('.main')||document.body;host.insertAdjacentHTML('beforeend',${JSON.stringify(fixture)});return 1;})()`);
  await ev(READY);
  await freeze('kitchen');
}
async function unhide(sel) { const ok = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return 0;e.classList.remove('hidden');e.hidden=false;return 1;})()`); if (!ok) throw new Error(`no element for ${sel}`); await freeze(sel); }
// unhide/rehide are for the CLASS-hidden modals only (every modal in index.html is a <div class="viewer-modal hidden">);
// attribute-hidden elements (.ask-sheet, .run-ask-banner) are opened through their own controls.
async function rehide(sel) { await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return 0;e.classList.add('hidden');return 1;})()`); }
async function clickSel(sel) { const ok = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return 0;e.click();return 1;})()`); if (!ok) throw new Error(`no element for ${sel}`); await freeze(sel); }

// The page-side walker. `WALKER(rootSel)` returns {samples, styles} for the CURRENT
// theme over `rootSel`'s subtree (the whole body when null). It is ONE template literal:
// never put a backtick inside it, not even in a comment.
//   samples: text / placeholder / icon / graphic / pseudo / outline contrast samples
//   styles:  the identity rows (light only): [sig, chain, ...12 computed colours]
// Keys are STRUCTURAL SIGNATURES (tag + sorted classes), never positions: a card
// inserted before its siblings, a reordered list or a fresh run id must not move a
// row. `chain` is the class list of the four nearest ancestors, for the drift
// allow-list (inherited colour on a child of an allow-listed element).
// `withStyles` false skips the identity rows (the focus and hover passes discard them —
// without the flag every pass re-serialised up to 8000 × 14 strings for nothing).
const WALKER = (rootSel, withStyles = false) => `(() => {
  const withStyles = ${withStyles ? 'true' : 'false'};
  const parse = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s || ''); if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x)); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const over = (fg, bg) => { const a = fg[3]; return [fg[0]*a + bg[0]*(1-a), fg[1]*a + bg[1]*(1-a), fg[2]*a + bg[2]*(1-a), 1]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
    return 0.2126*f(c[0]) + 0.7152*f(c[1]) + 0.0722*f(c[2]); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const cls = (e) => (typeof e.className === 'string' ? e.className : (e.className && e.className.baseVal) || '').trim().split(/\\s+/).filter(Boolean);
  const sigOf = (el) => el.tagName.toLowerCase() + (cls(el).length ? '.' + cls(el).sort().join('.') : '');
  const chainOf = (el) => { const c = []; for (let e = el.parentElement, i = 0; e && i < 4; e = e.parentElement, i += 1) { const k = cls(e); if (k.length) c.push(k.join('.')); } return c.join(' '); };
  const chainOpacity = (el) => { let o = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  // Translucent layers are collected until the first OPAQUE ancestor and then
  // composited bottom-up onto it (or onto the body); the old "first layer onto
  // white" shortcut judged --on-ink-wash chips as white-on-white.
  const effectiveBg = (el) => { const layers = []; let base = null; let unknown = false;
    for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); const bi = cs.backgroundImage;
      if (bi && bi !== 'none' && !/gradient\\(/.test(bi)) unknown = true;
      const c = parse(cs.backgroundColor); if (!c || c[3] <= 0) continue;
      if (c[3] >= 1) { base = c; break; } layers.push(c); }
    let acc = base || parse(getComputedStyle(document.body).backgroundColor) || [255,255,255,1];
    if (acc[3] < 1) acc = over(acc, [255,255,255,1]);
    for (let i = layers.length - 1; i >= 0; i -= 1) acc = over(layers[i], acc);
    return { bg: acc, unknown }; };
  const visible = (el) => { if (!el.getClientRects().length) return false; const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && chainOpacity(el) > 0.05; };
  const samples = []; const styles = []; let seen = 0; let capped = false;
  const rootEl = ${rootSel ? `document.querySelector(${JSON.stringify(rootSel)})` : 'document.body'};
  const all = rootEl ? [rootEl, ...rootEl.querySelectorAll('*')] : [];
  for (const el of all) {
    if (el.id === 'theme-freeze') continue;
    if (!visible(el)) continue;
    if (seen++ > 8000) { capped = true; break; }
    const cs = getComputedStyle(el); const isSvg = el instanceof SVGElement;
    if (parseFloat(cs.fontSize) === 0) continue;   // e.g. the collapsed rail's section labels: a text node with no glyphs
    const sig = sigOf(el); const chain = chainOf(el);
    if (withStyles) styles.push([sig, chain, cs.color, cs.backgroundColor, cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor, cs.outlineColor, cs.boxShadow, cs.fill, cs.stroke, cs.backgroundImage, cs.maskImage || '']);
    const text = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join('').trim();
    const tag = el.tagName; const isInput = /^(INPUT|TEXTAREA|SELECT)$/.test(tag);
    const control = /^(BUTTON|A)$/.test(tag) || el.getAttribute('role') === 'button';
    const iconOnly = !text && control && el.querySelector('svg') && !el.textContent.trim();
    const { bg, unknown } = effectiveBg(el); const op = chainOpacity(el);
    // D11 (report-only): disabled controls, anything the design deliberately dims with opacity
    // (the composited colour is not the design's contrast claim) and aria-hidden decoration.
    const disabled = el.matches(':disabled,[aria-disabled="true"]') || !!el.closest(':disabled') || op < 0.999 || !!el.closest('[aria-hidden="true"]');
    const size = parseFloat(cs.fontSize); const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const push = (kind, fgStr, need, extra) => { const fg = parse(fgStr); if (!fg || fg[3] === 0) return;   // transparent text (the mention-highlight textarea) is painted by its backdrop
      const eff = over([fg[0], fg[1], fg[2], fg[3] * op], bg);
      samples.push({ sig, chain, kind, text: (text || el.getAttribute('aria-label') || el.placeholder || '').slice(0, 40), fg: fgStr, bg: 'rgb(' + bg.slice(0,3).map(Math.round).join(',') + ')', ratio: +ratio(eff, bg).toFixed(2), need, unknown, disabled, size, weight, ...(extra || {}) }); };
    if (isSvg && text) push('text', cs.fill, large ? 3 : 4.5);
    else if (text || isInput) push('text', cs.color, large ? 3 : 4.5);
    if (iconOnly) push('icon', cs.color, 3);
    // SVG-namespace tagNames keep their case ('svg', 'path', 'g'): skip the ROOT svg only, sample its paths.
    if (isSvg && !text && tag.toLowerCase() !== 'svg') { const paint = cs.stroke !== 'none' && parse(cs.stroke) ? cs.stroke : (cs.fill !== 'none' ? cs.fill : null); if (paint) push('graphic', paint, 3, { advisory: true }); }
    if (isInput && el.placeholder) push('placeholder', getComputedStyle(el, '::placeholder').color, 4.5);
    for (const ps of ['::before', '::after']) { const pcs = getComputedStyle(el, ps); const content = pcs.content;
      if (content && content !== 'none' && content !== 'normal' && /^".+"$/.test(content)) {
        const pbg = parse(pcs.backgroundColor); const pbase = pbg && pbg[3] >= 1 ? pbg : (pbg && pbg[3] > 0 ? over(pbg, bg) : bg);
        const fg = parse(pcs.color); if (fg && fg[3] > 0) samples.push({ sig: sig + ps, chain, kind: 'pseudo', text: content.slice(1, 21), fg: pcs.color, bg: 'rgb(' + pbase.slice(0,3).map(Math.round).join(',') + ')', ratio: +ratio(over([fg[0], fg[1], fg[2], fg[3] * op], pbase), pbase).toFixed(2), need: 4.5, unknown, disabled, size: parseFloat(pcs.fontSize), weight }); } }
    // A focus ring with a positive outline-offset is drawn OUTSIDE the element, over the parent's
    // background — judge it there, not against the element's own fill.
    if (document.activeElement === el && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) {
      const ringBg = parseFloat(cs.outlineOffset) >= 0 && el.parentElement ? effectiveBg(el.parentElement).bg : bg;
      const fg = parse(cs.outlineColor);
      if (fg && fg[3] > 0) samples.push({ sig, chain, kind: 'outline', text: (text || el.getAttribute('aria-label') || '').slice(0, 40), fg: cs.outlineColor, bg: 'rgb(' + ringBg.slice(0,3).map(Math.round).join(',') + ')', ratio: +ratio(over([fg[0], fg[1], fg[2], fg[3] * op], ringBg), ringBg).toFixed(2), need: 3, unknown, disabled, size, weight });
    }
  }
  return { samples, styles, capped };
})()`;

// Hover-only rules (a dozen Task 2 entries) are sampled with the :hover pseudo-class
// FORCED through the CSS domain, element by element, in every theme.
// A selector with no element on the current screen is skipped (nodeId 0). At 5a22ca47 `.icon-btn` and `.field-clear`
// have hover RULES but no live element (the buttons are `.ask-icon-btn`; `.field-clear` lives only in a mockup) — kept
// so a future element is sampled; `.sidebar.collapsed .nav button.nav-cta` matches only in the rail-collapsed state.
const HOVER_SELECTORS = ['.icon-btn', '.ask-icon-btn', '.btn', '.btn-ghost', '.btn-primary', '.hist-open', '.rc-open', '.wiz-proj', '.sp-row', '.grv-source-row',
  '.gr-rm', '.field-clear', '.agent-row-head', '.sidebar.collapsed .nav button.nav-cta', '.nav button', '.spend-ind', '.hd-tree-file', '.ap'];
async function hoverSamples() {
  // CDP node ids die on every Page.reload (every go()): fetch the document per call, and let a
  // querySelector error THROW — a swallowed "Could not find node" would silently drop hover coverage.
  const docNodeId = (await cdp('DOM.getDocument', { depth: 0 })).root.nodeId;
  const out = [];
  for (const sel of HOVER_SELECTORS) {
    const { nodeId } = await cdp('DOM.querySelector', { nodeId: docNodeId, selector: sel });   // a miss is nodeId 0
    if (!nodeId) continue;
    await cdp('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
    await settle(`hover ${sel}`);
    const { samples } = await ev(WALKER(sel), 90000);
    for (const s of samples) out.push({ ...s, hover: sel });
    await cdp('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
  }
  await settle('hover-clear');
  return out;
}
// Focus rings: the app paints them on :focus-visible, which Chrome grants to KEYBOARD focus —
// element.focus() from a script leaves outlineStyle 'none' (measured: 0 outline samples). So
// the first three tab stops are reached with trusted Tab key events (headless acks an input
// dispatch only once it produces a frame: pump frames while one is in flight). The element
// that was active before (a dialog's autofocused input, a popover's first item) is focused
// again afterwards, so every theme pass sees the SAME state.
function pumped(promise) {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  (async () => { for (let i = 0; i < 60 && !done; i += 1) { await kick(); if (!done) await sleep(50); } })();
  return promise;
}
const tab = async () => {
  for (const type of ['keyDown', 'keyUp']) await pumped(cdp('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 }));
};
async function focusSamples() {
  await ev('window.__prevActive=document.activeElement;if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();0');
  const out = [];
  for (let i = 0; i < 3; i += 1) {
    await tab();
    await settle('tab');
    const { samples } = await ev(WALKER(null), 90000);   // no identity rows: only the outline samples are kept
    out.push(...samples.filter((s) => s.kind === 'outline'));
  }
  await ev(`(()=>{const p=window.__prevActive;if(p&&p!==document.body&&p.isConnected&&typeof p.focus==='function')p.focus({preventScroll:true});else if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();return 1;})()`);
  await settle('focus-restore');
  return out;
}

// ---- the state matrix -------------------------------------------------------
// Each state: [id, async prepare(), async cleanup()]. prepare() leaves the state on
// screen; the four themes are applied in place afterwards.
let runId = null; let pipelineId = null; let projectKey = null;
const states = [
  ['new', async () => { await go('new'); await until(`document.querySelector('.agent-row-head')`, 'the agent rows (rendered after /api/agents)'); await clickSel('.agent-row-head'); await ev(`document.querySelector('details.advanced')?.setAttribute('open','');0`); await freeze('new'); }],
  ['new-error', async () => { await ev(`document.getElementById('prompt').value='';0`); await clickSel('#start-btn'); await until(`document.querySelector('.form-msg.err')`, 'the empty-prompt error'); }],
  ['running-list', async () => { await go('running'); await until(`document.querySelector('#run-list .run-card')`, 'a run card'); }],
  ['running-list-compact', async () => { await clickSel('.run-density .rc-dseg[data-density="compact"]'); }, async () => { await clickSel('.run-density .rc-dseg[data-density="detailed"]'); }],
  ['running-detail', async () => { await go(`running/${runId}`); await until(`document.querySelector('#run-detail .rd-tabs .rd-tab')`, 'detail tabs'); }],
  ['running-detail-tabs', async () => { const n = await ev(`document.querySelectorAll('#run-detail .rd-tab').length`); if (n < 2) throw new Error(`running-detail has ${n} tab(s): nothing to audit`); for (let i = 1; i < n; i += 1) { await ev(`document.querySelectorAll('#run-detail .rd-tab')[${i}].click();0`); await freeze('tab'); await auditCurrent(`running-detail-tab-${i}`); } }],
  ['running-detail-done', async () => { await go(`running/${runId}`); await until(`document.querySelector('#run-detail .rd-graph.settled, #run-detail .rd-tabs .rd-tab')`, 'settled detail'); }],
  // The just-finished mock run LINGERS on the Running page and renderHistory hides
  // its pipeline until the linger key is cleared (app.js isLingering).
  ['history-list', async () => { await ev(`localStorage.removeItem('worca-cc.lingerRuns');0`); await go('history'); await until(`document.querySelector('#hist-shell .hist-card')`, 'a history card'); }],
  ['history-detail', async () => { await go(`history/${projectKey}/${pipelineId}`); await until(`document.querySelector('.hd-tabs .hd-tab')`, 'history tabs'); }],
  ['history-detail-tabs', async () => { const n = await ev(`document.querySelectorAll('.hd-tabs .hd-tab').length`); if (n < 2) throw new Error(`history-detail has ${n} tab(s): nothing to audit`); for (let i = 1; i < n; i += 1) { await ev(`document.querySelectorAll('.hd-tabs .hd-tab')[${i}].click();0`); await until(`!document.querySelector('.hd-diff-pane') || document.querySelector('.hd-diff-pane .hd-dl-row, .hd-diff-none, .hd-diff-note')`, 'tab content'); await freeze('tab'); await auditCurrent(`history-detail-tab-${i}`); } }],
  // The fresh canvas holds a Task and an End node only (no <select> in their inspectors); the
  // seeded default pipeline (.pl-item[data-id=wf_default], click loads it) carries agent nodes.
  // Node selection lives in the stage's pointerdown hit-test (graph/composer.mjs onDown → hitNodeAt →
  // select), so a synthetic click never opens the inspector: press and release a real pointer.
  ['composer', async () => { await go('composer'); await until(`document.querySelector('[data-view="composer"] .gv-world .node')`, 'composer nodes');
    await until(`document.querySelector('.pl-item[data-id="wf_default"] .pl-row')`, 'the saved-pipeline list (rendered after listWorkflows)');
    await clickSel('.pl-item[data-id="wf_default"] .pl-row');
    await until(`document.querySelector('[data-view="composer"] .gv-world .node.node-agent .nhead')`, 'an agent node of the default pipeline');
    const c = await ev(`(()=>{const b=document.querySelector('[data-view="composer"] .gv-world .node.node-agent .nhead').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 });
    await until(`document.querySelector('.ins-panel.ins-agent .ins-select')`, 'the agent inspector'); await freeze('composer'); }],
  ['composer-palette-filtered', async () => { await ev(`(()=>{const f=document.querySelector('.pal-filter');f.value='rev';f.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await freeze('filter'); }, async () => { await ev(`(()=>{const f=document.querySelector('.pal-filter');f.value='';f.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); }],
  // #gv-save is disabled on the default canvas: render the dialog through the
  // module's own exports instead (the same markup the button would open).
  ['composer-save-dialog', async () => { await ev(`(async()=>{const m=await import('/graph/save-dialog.mjs');const d=m.renderSaveDialog({name:'Theme proof',domain:'',domains:[],title:'Save pipeline',note:'',doc:document});d.id='theme-proof-dialog';document.body.appendChild(d);m.openDialog(d);return 1;})()`); await until(`document.querySelector('.save-dialog[open]')`, 'save dialog'); await freeze('dialog'); },
    async () => { await ev(`(()=>{const d=document.getElementById('theme-proof-dialog');if(d){try{d.close();}catch{}d.remove();}return 1;})()`); }],
  ['agents', async () => { await go('agents'); }],
  ['agent-create', async () => { await go('agent-create'); }],
  ['projects', async () => { await go('projects'); }],
  // The project page: register a folder through the API first (the proof's home has none), then
  // open it — Overview + header. The Memory tab is the Settings grid already audited above.
  ['projects-detail', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'worca-theme-proj-'));
    const r = await api('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'themeproof', path: dir }) });
    const p = (r.body.projects || []).find((x) => x.name === 'themeproof');
    if (!p) throw new Error(`could not register the theme project: ${JSON.stringify(r.body)}`);
    await go(`projects/${p.key}`);
    await until(`document.querySelector('#proj-shell.detail-open .pd-ov-card-key')`, 'the project page');
  }],
  ['workspaces', async () => { await go('workspaces'); }],
  ['workspace-create', async () => { await go('workspace-create'); }],
  ['stats', async () => { await go('stats'); }],
  ['team-metrics', async () => { await go('team-metrics'); }],
  ['settings-general', async () => { await go('settings'); await until(`document.querySelector('.settings-pane[data-tab="general"]:not(.hidden) .card')`, 'general pane'); }],
  // Tooltips open on mouseover / focusin (app.js TIP_SELECTOR handlers), not on click: a bubbling
  // synthetic mouseover reaches the document listener whatever the page's focus state.
  // The tip is named, not "the first one": document order is not the audit's business, and a
  // card inserted above the root-folder one would silently swap which bubble the identity
  // baseline holds (its <code>/<b> rows would read as vanished pairs).
  ['settings-tooltip', async () => { await ev(`(()=>{const t=document.querySelector('.settings-pane[data-tab="general"] .info-tip[aria-label="About Worca root folder"]');if(!t)throw new Error('no info-tip');t.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));return 1;})()`); await until(`document.querySelector('#info-bubble:not(.hidden)')`, 'a live tooltip'); await freeze('tooltip'); }, async () => { await ev(`(()=>{const t=document.querySelector('.settings-pane[data-tab="general"] .info-tip[aria-label="About Worca root folder"]');if(t)t.dispatchEvent(new MouseEvent('mouseout',{bubbles:true}));document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return 1;})()`); }],
  ['settings-guardrails', async () => { await go('settings/guardrails'); }],
  ['settings-models', async () => { await go('settings/models'); }],
  ['settings-plugins', async () => { await go('settings/plugins'); }],
  // Agent memory (§10): seed ONE file through the API and open it, so the audit samples a selected
  // row, the editor, its status line and a History row — an empty scope would paint the fresh badge
  // and nothing else. The contrast baseline is NEVER regenerated for this: a new failing pair means
  // a memory rule uses a wrong token.
  ['settings-memory', async () => {
    await api('/api/memory/global/files/theme-proof', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '---\nname: theme-proof\ndescription: Theme audit seed\n---\nOne seeded rule.\n' }) });
    await go('settings/memory/theme-proof');
    await until(`document.querySelector('.settings-pane[data-tab="memory"]:not(.hidden) .mem-editor')`, 'the memory editor');
  }],
  ['ask-sheet', async () => { await go('new'); await clickSel('.ask-pill'); await until(`document.querySelector('.ask-sheet:not([hidden])')`, 'ask sheet'); }],
  ['ask-model-picker', async () => { await clickSel('.ask-model-btn'); await until(`document.querySelector('.ask-pop-model')`, 'model popover'); }, async () => { await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));0`); }],
  ['ask-scope-picker', async () => { await clickSel('.ask-scope-btn'); await until(`document.querySelector('.ask-pop-scope')`, 'scope popover'); }, async () => { await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));0`); await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));0`); }],
  ['rail-collapsed', async () => { await go('new'); await clickSel('#side-toggle'); await until(`document.body.classList.contains('rail-collapsed')`, 'collapsed rail'); }, async () => { await clickSel('#side-toggle'); }],
  ['modal-confirm', async () => { await go('new'); await unhide('#confirm-modal'); await ev(`document.getElementById('confirm-message').textContent='Delete this project?';0`); }, async () => { await rehide('#confirm-modal'); }],
  ['modal-export', async () => { await unhide('#export-modal'); }, async () => { await rehide('#export-modal'); }],
  ['modal-stop', async () => { await unhide('#stop-modal'); }, async () => { await rehide('#stop-modal'); }],
  ['modal-shipit', async () => { await unhide('#shipit-modal'); }, async () => { await rehide('#shipit-modal'); }],
  ['modal-viewer', async () => { await unhide('#viewer-card'); }, async () => { await rehide('#viewer-card'); }],
  ['kitchen', async () => { await go('new'); await injectKitchen(); }],
];

// ---- collection ---------------------------------------------------------------
const report = { light: [], dark: [], 'system-dark': [], 'system-light': [] };   // violations per theme id
const identity = {};                                                             // light identity rows per state
let sampleCount = 0; let cappedStates = [];
async function auditCurrent(stateId) {
  // `#refresh-history.busy` paints color:transparent while /api/history is in flight — sampling
  // through it made the snapshot bistable (measured: 4 cells flipping between runs).
  await until(`!document.querySelector('#refresh-history.busy')`, 'the history refresh to settle');
  for (const theme of THEMES) {
    await setTheme(theme);
    const { samples, styles, capped } = await ev(WALKER(null, theme[0] === 'light'), 90000);   // identity rows only for the light pass
    if (capped) cappedStates.push(`${stateId}/${theme[0]}`);
    const extra = [...await focusSamples(), ...await hoverSamples()];
    if (theme[0] === 'light') identity[stateId] = styles;
    sampleCount += samples.length + extra.length;
    for (const s of [...samples, ...extra]) {
      if (s.unknown) continue;                              // image background: not judged, listed in the JSON
      const advisory = s.disabled || s.advisory === true;    // D11: disabled text and decorative graphics are report-only
      if (s.ratio < s.need) report[theme[0]].push({ state: stateId, ...s, advisory });
    }
  }
  await setTheme(THEMES[0]);
}
const key = (v) => `${v.state}|${v.kind}|${v.sig}|${v.hover || ''}|${v.fg}|${v.bg}`;
// Spec §4.3's intended light drift + the logo/chevron rewrites: excluded from the identity compare
// AND from the light gates (their colours change on purpose, so their baseline keys change too).
const ALLOW_DRIFT = [/(^|[\s.])logo($|[\s.])|logo-mark|ask-pill-logo|ask-header-logo/, /hist-pr-link|hd-pr-link/, /pal-head|pal-chip|pl-domain|mv-cost-rate-unit/,
  /results-chip|results-narrative|origin-review|pl-setup-cmd|pl-diffstat|sp-row|sp-label|src-badge|grv-source-row/, /fanout-toggle/, /ins-select/];
const isDrift = (v) => ALLOW_DRIFT.some((re) => re.test(` ${v.sig} ${v.chain} `));

try {
  // ---- seed: a mock run held at its clarify question, answered later -----------
  const started = await api('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectDir: proj, prompt: 'add a --verbose flag', workflowId: 'wf_default', mock: true }) });
  if (started.status !== 200) throw new Error(`POST /api/run -> ${started.status} ${JSON.stringify(started.body)}`);
  runId = started.body.runId;
  const entry = runs.get(runId);
  for (let i = 0; i < 400 && !entry.pendingQuestion; i += 1) await sleep(100);
  if (!entry.pendingQuestion) throw new Error('the mock run never reached the clarify question');
  await cdp('Page.navigate', { url: `${base}/#new` });
  await waitEvent('Page.loadEventFired');
  await until('window.__np && window.__np.getRun', 'app boot');

  // Phase A: the live run (question panel visible) — running states only.
  const phaseA = new Set(['running-list', 'running-list-compact', 'running-detail', 'running-detail-tabs']);   // running-detail-done is a Phase-B state on purpose: the run must be finished
  for (const [id, prepare, cleanup] of states) {
    if (!phaseA.has(id) || (ONLY.length && !ONLY.includes(id))) continue;
    log(`state ${id}`); await prepare(); if (id !== 'running-detail-tabs') await auditCurrent(id); if (cleanup) await cleanup();
  }
  // answer → finish → history has a pipeline with a diff
  const q = entry.pendingQuestion;
  await api('/api/answer', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId, id: q.id, payload: { answers: [] } }) });
  for (let i = 0; i < 900 && !['done', 'error', 'stopped', 'aborted', 'failed', 'paused'].includes(entry.status); i += 1) await sleep(200);
  if (entry.status !== 'done') throw new Error(`the mock run ended ${entry.status}, not done`);
  const hist = await api('/api/history');
  const rec = (hist.body.pipelines || []).find((p) => p.id === entry.pipelineId) || null;
  if (!rec) throw new Error(`pipeline ${entry.pipelineId} is not in /api/history`);
  pipelineId = rec.id; projectKey = rec.projectKey;

  // Phase B: everything else.
  for (const [id, prepare, cleanup] of states) {
    if (phaseA.has(id) || (ONLY.length && !ONLY.includes(id))) continue;
    log(`state ${id}`); await prepare(); if (id !== 'history-detail-tabs') await auditCurrent(id); if (cleanup) await cleanup();
  }

  // ---- outputs ------------------------------------------------------------------
  for (const t of Object.keys(report)) await writeFile(path.join(OUT, `theme-audit-${t}.json`), JSON.stringify(report[t], null, 1));
  log(`samples ${sampleCount}; violations light ${report.light.length} dark ${report.dark.length} system-dark ${report['system-dark'].length} system-light ${report['system-light'].length}; reports in ${OUT}`);
  if (cappedStates.length) console.warn(`WARN walker cap (8000 visible elements) hit in: ${cappedStates.join(', ')}`);
  let failed = 0;
  if (SNAPSHOT) { await writeFile(SNAPSHOT, JSON.stringify(identity)); log(`identity snapshot → ${SNAPSHOT}`); }
  if (COMPARE && !ONLY.length) {
    // Identity: every (sig, colour-tuple) the snapshot saw in a state must still exist
    // in that state (additions and reorders are ignored); a vanished tuple is a diff
    // unless its signature or ancestor chain is allow-listed (spec §4.3 + the logos).
    const prev = JSON.parse(await readFile(COMPARE, 'utf8'));
    const diffs = [];
    for (const [state, rows] of Object.entries(prev)) {
      const now = new Set((identity[state] || []).map((r) => r.slice(0, 1).concat(r.slice(2)).join('|')));   // sig + tuple, chain ignored
      const seenKeys = new Set();
      for (const row of rows) {
        const k = row.slice(0, 1).concat(row.slice(2)).join('|');
        if (seenKeys.has(k)) continue; seenKeys.add(k);
        if (!now.has(k)) diffs.push({ state, sig: row[0], chain: row[1], tuple: row.slice(2) });
      }
    }
    const real = diffs.filter((d) => !ALLOW_DRIFT.some((re) => re.test(` ${d.sig} ${d.chain} `)));
    await writeFile(path.join(OUT, 'theme-identity-diff.json'), JSON.stringify(diffs, null, 1));
    console.log(`${real.length ? 'FAIL' : 'PASS'} light identity: ${diffs.length} vanished (signature, colours) pairs, ${real.length} outside the allowed drift`);
    if (real.length) { failed += 1; console.log(JSON.stringify(real.slice(0, 40), null, 1)); }
  }
  const lightHard = report.light.filter((v) => !v.advisory);
  if (WRITE_BASELINE) {
    await writeFile(BASELINE_FILE, JSON.stringify({ version: 2, note: 'light-theme contrast failures that pre-date the dark theme (spec D10), keyed state|kind|signature|hover|fg|bg; shrink, never grow', entries: [...new Set(lightHard.map(key))].sort() }, null, 1) + '\n');
    log(`light baseline → ${fileURLToPath(BASELINE_FILE)} (${new Set(lightHard.map(key)).size} entries)`);
  } else if (!SNAPSHOT && !COMPARE) {
    const baseline = new Set(existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).entries : []);
    const newLight = lightHard.filter((v) => !baseline.has(key(v)) && !isDrift(v));
    console.log(`${newLight.length ? 'FAIL' : 'PASS'} light: ${lightHard.length} text failures, ${newLight.length} outside the baseline`);
    if (newLight.length) { failed += 1; console.log(JSON.stringify(newLight.slice(0, 40), null, 1)); }
    for (const t of ['dark', 'system-dark']) {
      const hard = report[t].filter((v) => !v.advisory);
      console.log(`${hard.length ? 'FAIL' : 'PASS'} ${t}: ${hard.length} text/icon/placeholder/pseudo/outline failures (${report[t].length - hard.length} advisory)`);
      if (hard.length) { failed += 1; console.log(JSON.stringify(hard.slice(0, 60), null, 1)); }
    }
    const sysLight = report['system-light'].filter((v) => !v.advisory && !baseline.has(key(v)) && !isDrift(v));
    console.log(`${sysLight.length ? 'FAIL' : 'PASS'} system-light equals light: ${sysLight.length} failures outside the light baseline`);
    if (sysLight.length) failed += 1;
  }
  console.log(`${pageErrors.length ? 'FAIL' : 'PASS'} no page errors (${pageErrors.length})`);
  if (pageErrors.length) { failed += 1; console.log(pageErrors.slice(0, 10).join('\n')); }
  if (consoleErrors.length) console.warn(`WARN ${consoleErrors.length} console.error call(s) (report-only):\n${consoleErrors.slice(0, 10).join('\n')}`);
  await shutdown(failed ? 1 : 0);
} catch (e) {
  console.error(e && e.stack ? e.stack : String(e));
  await shutdown(1);
}
