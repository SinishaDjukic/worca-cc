#!/usr/bin/env node
// tools/verify-composer-cdp.mjs — headless-Chrome proof of the composer's
// pointer pipeline (spec §7.11 (1)-(9)). NOT part of `npm test`: it needs Chrome
// and a live server. Run: node tools/verify-composer-cdp.mjs
//
// -- CI COVERAGE (MAJ-30) ----------------------------------------------------
// .github/workflows/ci.yml job `cdp` runs this script on every push and every
// pull request, so every check below gates a merge. What still has NO test/
// equivalent -- and therefore dies with the runner's Chrome -- is every
// assertion that is a MEASUREMENT or a COMPUTED style: jsdom has no layout
// engine (every getBoundingClientRect there is 0x0) and no style cascade.
//   STILL CDP-ONLY
//     (2)       the real getBoundingClientRect count during the move burst
//     (3a)(3b)  getComputedStyle(ghost).fill, at rest and mid-drag
//     (4)       real pointer-capture RETARGETING (the port below MODELS it; it
//               cannot reproduce it)
//     (6)       stage-box stability across the wheel sequence
//     (7)       measured post-fit containment of every node box
//     (10)      the 300px Library card right of the stage, open, three tabs
//     (11)      the top bar's rendered controls; the app chrome computes display:none
//     (12)      frosted cards: a backdrop blur and a 0.4–0.6 alpha in both themes
//     (13)      the PAINTED wires are orthogonal lane routes; a loop's pill sits under its cards
//     (14)      the zoom menu's items and a real Zoom in (100% -> 120%); the zoom and
//               "+" menus open flush with their trigger's right / left edge
//     (15)      a script placed from the Library: its runtime in the label row,
//               the Params popover's command commit, both themes
//     (16)      the chat dock never covers the bottom-right bars; its input stays
//               inside the pill and grows (≤ 104px) with typed lines
//     (17)      the More popover stays inside the stage, clear of the dock
//     (console) the no-page-error gate
//   NOW ALSO IN test/ (green with no browser at all)
//     (1), (2) counters, (5), (6) zoom/pan math, (7) fit math, (8) undo + the
//               blur revert, (11) tab swap   -> test/ui-composer-editor.test.mjs
//     (4) set/release pairing + a modelled retarget
//                                            -> test/ui-composer-pointer-capture.test.mjs
//     (6) wheel preventDefault, (9) middle-button and space+drag pan
//                                            -> test/ui-graph-interactions.test.mjs
//     (8) incident-wires-only repaint        -> test/ui-graph-view.test.mjs
//     (3a)(10)(12) as CSS TEXT only          -> test/ui-graph-css.test.mjs,
//                                               test/ui-composer-shell.test.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Chrome is overridable so this proof also runs on a Linux CI runner: CHROME_BIN
// picks the binary, and headless Chrome refuses to start as root (containers)
// without --no-sandbox, which CHROME_NO_SANDBOX=1 forces.
const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const PORT = Number(process.env.CDP_PORT || 9333);
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let home = null; let profile = null; let failed = 0;
async function shutdown(code) {
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}          // kill Chrome on EVERY exit path
  try { if (srv) await new Promise((r) => srv.close(r)); } catch {}
  try { if (home) await rm(home, { recursive: true, force: true }); } catch {}
  try { if (profile) await rm(profile, { recursive: true, force: true }); } catch {}
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}

// ---- app server on an ephemeral port (the house pattern: env BEFORE the import)
home = await mkdtemp(path.join(tmpdir(), 'worca-cdp-'));
process.env.WORCA_HOME = home;
process.env.WORCA_MOCK = '1';
const { app } = await import(new URL('../ui/server.mjs', import.meta.url).href);
srv = http.createServer(app);
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
// These proofs measure the full UI, so pin the interface mode to Expert (docs/ui-levels.md) —
// a fresh WORCA_HOME would otherwise serve Simple and hide what they measure.
{ const r = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uiLevel: 'expert' }) });
  if (!r.ok) throw new Error(`could not pin the interface mode: HTTP ${r.status}`); }
log(`server ${base}`);

// ---- chrome + cdp
profile = await mkdtemp(path.join(tmpdir(), 'worca-cdp-profile-'));
chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,900', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'],
{ stdio: ['ignore', 'pipe', 'pipe'] });
// Keep Chrome's last stderr lines: when no DevTools target ever appears, its own
// words (a sandbox refusal, a profile lock, a crash) are the diagnosis.
const chromeErr = [];
chrome.stderr.on('data', (d) => { chromeErr.push(String(d)); if (chromeErr.length > 40) chromeErr.shift(); });
let chromeExit = null;
chrome.on('exit', (code, signal) => { chromeExit = { code, signal }; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
// Deadline-based, not iteration-based: a cold CI runner can take well over the
// old ~15s (60 × 250ms) to bring the first page target up, and that budget was
// the difference between a green and a red proofs job on the same commit.
const targetDeadline = Date.now() + 60_000;
while (!wsUrl && Date.now() < targetDeadline && !chromeExit) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(200);
  } catch { await sleep(250); }
}
if (!wsUrl) {
  console.error(chromeExit
    ? `no devtools target: chrome exited (code ${chromeExit.code}, signal ${chromeExit.signal})`
    : 'no devtools target after 60s');
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
function cdp(method, params = {}, ms = 15000) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT ${method}`)); }, ms);
    pending.set(id, { res: (v) => { clearTimeout(to); res(v); }, rej: (er) => { clearTimeout(to); rej(er); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const waitEvent = (name, ms = 15000) => new Promise((res, rej) => {
  const to = setTimeout(() => { off(); rej(new Error(`timeout ${name}`)); }, ms);
  const l = (m) => { if (m.method === name) { clearTimeout(to); off(); res(m.params); } };
  const off = () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
  listeners.push(l);
});
const errors = [];
listeners.push((m) => {
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args || []).map((a) => a.value || a.description).join(' '));
});
await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable');

async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`EVAL: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n${expr}`);
  return r.result.value;
}
// Headless Chrome does not tick rAF on its own: arm a marker and force frames.
const kick = () => cdp('Page.captureScreenshot', { format: 'jpeg', quality: 1, clip: { x: 0, y: 0, width: 16, height: 16, scale: 1 } }, 15000).catch(() => null);
async function settle(tag = '') {
  await ev('window.__rafHit=0;requestAnimationFrame(()=>{window.__rafHit=1;});0');
  for (let i = 0; i < 10; i += 1) { if (await ev('window.__rafHit')) return; await kick(); }
  throw new Error(`no animation frame after 10 forced frames (${tag})`);
}
/** Headless Chrome acks some input dispatches (mouseWheel above all) only once
 *  it produces a frame, and --headless=new emits BeginFrames on demand only — so
 *  a dispatch can sit unacked forever. Pump forced frames while one is in flight.
 *  This cannot perturb any counter: forcing a frame runs the SAME rAF callback
 *  the app already queued, never an extra one. */
function pumped(promise) {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  (async () => { for (let i = 0; i < 60 && !done; i += 1) { await kick(); if (!done) await sleep(50); } })();
  return promise;
}
const press = (x, y, button = 'left') => pumped(cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'middle' ? 4 : 1, clickCount: 1 }));
const mmove = (x, y, buttons = 1, button = 'left') => pumped(cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button, buttons, clickCount: 0 }));
const mup = (x, y, button = 'left') => pumped(cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 }));
// Wheel delivery: measured 2026-08-28 on Chrome 141 / macOS, a CDP wheel reaches
// the page in NEITHER headless mode and by NONE of the three dispatch APIs
// (mouseWheel bare, mouseWheel after mouseMoved, synthesizeScrollGesture) — even
// on a trivial data: URL with a plain listener. So the script PROBES once: a
// trusted wheel is used where the browser delivers one, and a synthetic
// WheelEvent on the stage otherwise. The synthetic path still exercises the real
// handler with real layout, and check (6) additionally asserts defaultPrevented,
// which is what "the page never scrolls under the canvas" reduces to.
// A delivered wheel counts as trusted ONLY when it is cancelable. Measured
// 2026-09-02 on Chrome 151 / Linux (the GitHub runner): a CDP wheel reaches the
// page as a NON-cancelable event, and only while some wheel listener other than
// the composer's own is registered — the probe's. Once the probe's listener is
// gone every later wheel is dropped outright, so the transform never moves and
// check (6) fails while reporting delivery as trusted. The run-monitor proof
// gates on `cancelable` for the same reason; this one now matches it.
let wheelTrusted = null;        // null = not probed yet
// Two probe wheels, not one: Chrome latches a wheel SEQUENCE — when the first
// wheel of a sequence is not cancelled, every later wheel in it is dispatched
// non-cancelable (preventDefault() becomes a no-op and `defaultPrevented` never
// reads true), and a sequence outlives the settle() between two of our
// dispatches. Linux CI Chrome 152 reports the FIRST wheel cancelable, so a
// one-wheel probe picked the trusted path and then watched every real wheel
// arrive non-cancelable (the run-monitor proof split on it).
// Only a runner whose SECOND consecutive wheel is still cancelable can measure
// `defaultPrevented` through trusted events; everything else runs the same
// listener over the same layout through the synthetic path.
async function probeWheel(x, y) {   // x,y come from the caller and are already inside the stage
  await ev('window.__wp=[];window.__wpH=(e)=>{window.__wp.push(e.cancelable);};window.addEventListener("wheel",window.__wpH,{passive:true});0');
  await mmove(x, y, 0);
  // A ZERO delta: the probe must not move the canvas. A real delta pans the view
  // (t -= delta), which shifts the world point under the cursor and makes the
  // very next invariance measurement read as broken.
  await wheelRaw(x, y, 0, 0, 0);
  await settle('wheel-probe');
  await wheelRaw(x, y, 0, 0, 0);        // the second wheel of the sequence is the one that tells
  await settle('wheel-probe');
  const seen = await ev('(()=>{const n=window.__wp;window.removeEventListener("wheel",window.__wpH);return n;})()');
  wheelTrusted = seen.length >= 2 && seen.every((c) => c === true);
  log(`wheel delivery: ${wheelTrusted ? 'trusted CDP events' : 'SYNTHETIC'} (CDP wheels seen: ${seen.length}, cancelable: ${seen.join(',') || 'n/a'})`);
}
async function wheel(x, y, dx, dy, modifiers = 0) {
  if (wheelTrusted === null) await probeWheel(x, y);
  if (wheelTrusted) { await mmove(x, y, 0); return wheelRaw(x, y, dx, dy, modifiers); }
  return ev(`(()=>{const {v}=window.__gv();const e=new WheelEvent('wheel',{deltaX:${dx},deltaY:${dy},clientX:${x},clientY:${y},
    ctrlKey:${(modifiers & 2) === 2},bubbles:true,cancelable:true});v.stage.dispatchEvent(e);
    window.__wheelPrevented=e.defaultPrevented;return 1;})()`);
}
const wheelRaw = (x, y, dx, dy, modifiers = 0) => pumped(cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy, modifiers, button: 'none' }));
const keyEv = (type, k, code, vk) => cdp('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(k === ' ' ? { text: ' ' } : {}) });
function check(n, what, ok, detail) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} (${n}) ${what}${ok ? '' : `\n      ${JSON.stringify(detail)}`}`);
}

async function load(first = false) {
  if (first) await cdp('Page.navigate', { url: `${base}/#workflows` }); else await cdp('Page.reload', {});
  await waitEvent('Page.loadEventFired');
  for (let i = 0; i < 60; i += 1) { if (await ev('!!(window.__gv && window.__gv())')) break; await sleep(100); }
  if (!await ev('!!(window.__gv && window.__gv())')) throw new Error('composer never mounted');
  // …and wait for the AGENT REGISTRY behind it: the editor mounts before /api/agents answers, and a
  // card seeded in that window has no ports (ports().known === false), so every anchor below is
  // null. It used to win this race by luck; the size of the document decides it.
  const probeAgent = JSON.stringify(process.env.PROBE_AGENT || 'planner');
  for (let i = 0; i < 100; i += 1) {
    if (await ev(`(()=>{const {v}=window.__gv();try{return !!v.ports({id:'probe',kind:'agent',key:${probeAgent}}).known;}catch{return false;}})()`)) break;
    await sleep(50);
  }
  if (!await ev(`(()=>{const {v}=window.__gv();try{return !!v.ports({id:'probe',kind:'agent',key:${probeAgent}}).known;}catch{return false;}})()`)) {
    throw new Error(`the composer never learned the agent ${probeAgent}`);
  }
  // seed a deterministic 3-card graph through the public editor API
  await ev(`(()=>{const {c}=window.__gv();c.loadTemplate({id:'',name:'probe',version:2,domain:'coding',
    nodes:[{id:'n_task',kind:'task',x:60,y:143,config:{}},{id:'n_agent',kind:'agent',key:${JSON.stringify(process.env.PROBE_AGENT || 'planner')},x:400,y:80,config:{}},{id:'n_end',kind:'end',x:760,y:143,config:{}}],
    wires:[{id:'w1',from:{node:'n_task',port:'task'},to:{node:'n_agent',port:'task'}}]});c.fit();return 1;})()`);
  await settle('post-load');
}
const clientOfAnchor = (id, port, dir) => ev(`(()=>{const {c,v}=window.__gv();const n=c.template().nodes.find(n=>n.id===${JSON.stringify(id)});
  const a=v.anchor(n,${JSON.stringify(port)},${JSON.stringify(dir)});const s=v.toScreen(a.x,a.y);const r=v.rect();return {x:s.x+r.left,y:s.y+r.top};})()`);

try {
  await load(true);

  // (7) every node's nodeSize box maps inside the stage rect after auto-fit
  const fitR = await ev(`(()=>{const {c,v}=window.__gv();const r=v.rect();let ok=true;const out=[];
    for(const n of c.template().nodes){const s=v.size(n);for(const [dx,dy] of [[0,0],[s.w,0],[0,s.h],[s.w,s.h]]){const p=v.toScreen(n.x+dx,n.y+dy);
      const inside=p.x>=0&&p.x<=r.width&&p.y>=0&&p.y<=r.height;if(!inside)ok=false;out.push([n.id,+p.x.toFixed(1),+p.y.toFixed(1),inside]);}}
    return {ok,z:v.getTransform().z,worlds:document.querySelectorAll('#wfv-canvas .gv-world').length,out};})()`);
  check(7, 'auto-fit keeps every node box inside the stage and z ≤ 1', fitR.ok && fitR.z <= 1 && fitR.worlds === 1, fitR);

  // (3) ghost fill:none at rest
  const fillRest = await ev(`getComputedStyle(document.querySelector('#wfv-canvas .gv-wires path.ghost')).fill`);
  check('3a', 'getComputedStyle(ghost).fill === "none" at rest', fillRest === 'none', { fillRest });

  // (1)+(2) 60-move burst: Δframes 1, Δghost ≤ 1, ΔrectReads 0
  const plan = await clientOfAnchor('n_agent', 'plan', 'out');
  await press(plan.x, plan.y); await settle('press');
  // Drain any pending ResizeObserver callback (it calls readRect) BEFORE the
  // counters are snapshotted: forcing frames is what makes it run at all here,
  // and it is app chrome, not the pointer-move path this check measures.
  await settle('press-quiesce'); await settle('press-quiesce2');
  await ev(`(()=>{const {c,v}=window.__gv();const st=v.stage;window.__s0={f:c.stats.frames,g:v.stats.ghostUpdates,r:c.stats.rectReads};
    window.__gb=0;window.__oGB=Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect=function(){window.__gb++;return window.__oGB.apply(this,arguments);};
    for(let i=0;i<60;i++)st.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:${Math.round(plan.x)}-i,clientY:${Math.round(plan.y)}+(i%7),bubbles:true}));
    window.__rafHit=0;requestAnimationFrame(()=>{window.__rafHit=1;});return 1;})()`);
  for (let i = 0; i < 10 && !(await ev('window.__rafHit')); i += 1) await kick();
  const burst = await ev(`(()=>{const {c,v}=window.__gv();Element.prototype.getBoundingClientRect=window.__oGB;
    return {df:c.stats.frames-window.__s0.f,dg:v.stats.ghostUpdates-window.__s0.g,dr:c.stats.rectReads-window.__s0.r,gb:window.__gb,
      fill:getComputedStyle(v.ghostEl).fill,cls:v.ghostEl.getAttribute('class')};})()`);
  check(1, '60 pointermoves ⇒ Δframes === 1 and ΔghostUpdates ≤ 1', burst.df === 1 && burst.dg <= 1, burst);
  check(2, 'zero getBoundingClientRect calls during the burst', burst.dr === 0 && burst.gb === 0, burst);
  check('3b', 'getComputedStyle(ghost).fill === "none" mid-drag', burst.fill === 'none', burst);
  await mup(plan.x - 59, plan.y + 3); await settle('up');

  // (5) a drag from an INPUT: the ghost is wireCurve(cursor, input) — it STARTS at the cursor and
  // ENDS on the input anchor, entering it from its LEFT (the last control point lies left of the end).
  await load();
  const fix = await clientOfAnchor('n_agent', 'task', 'in');
  await press(fix.x, fix.y); await settle('press-in');
  await mmove(fix.x - 120, fix.y); await settle('move-left');
  const mir = await ev(`(()=>{const {c,v}=window.__gv();const d=v.ghostEl.getAttribute('d')||'';
    const m=d.match(/^M\\s*(-?[\\d.]+)[ ,]+(-?[\\d.]+)\\s*C\\s*(-?[\\d.]+)[ ,]+(-?[\\d.]+)[ ,]+(-?[\\d.]+)[ ,]+(-?[\\d.]+)[ ,]+(-?[\\d.]+)[ ,]+(-?[\\d.]+)/);
    const n=c.template().nodes.find((x)=>x.id==='n_agent');const a=v.anchor(n,'task','in');
    return m?{d,x2:+m[5],x3:+m[7],y3:+m[8],ax:a.x,ay:a.y}:{d,ax:a.x,ay:a.y};})()`);
  check(5, 'a drag from an input draws a bezier that ENDS on the input anchor and enters it from its LEFT',
    mir.x3 != null && Math.abs(mir.x3 - mir.ax) < 0.5 && mir.x2 < mir.x3, mir);
  await keyEv('rawKeyDown', 'Escape', 'Escape', 27); await keyEv('keyUp', 'Escape', 'Escape', 27); await settle('esc');

  // (6) zoom about the cursor + plain-wheel pan
  await load();
  // The wheel point must be INSIDE the stage and clear of the floating bars: the stage's centre.
  // Refresh the composer's rect cache FIRST. Under --headless=new the
  // ResizeObserver's initial callback only runs once frames are forced, so it can
  // land BETWEEN the two world-point reads below and shift R.top by a pixel or
  // two — the invariance then reads as broken when only the harness moved.
  await settle('rect-quiesce'); await ev('window.__gv().c._internal.readRect()');
  const sr = await ev('window.__gv().v.rect()');
  // INTEGER client coordinates: Chrome rounds Input.dispatchMouseEvent's x/y, so a
  // fractional probe point is measured half a pixel away from where the browser
  // actually zoomed — which shows up as a sub-pixel invariance drift, not a bug.
  const wx = Math.round(sr.left + sr.width / 2);
  const wy = Math.round(sr.top + sr.height / 2);
  const z0 = await ev(`(()=>{const {c,v}=window.__gv();return {w:c._internal.toWorld(${wx},${wy}),T:v.getTransform(),r:v.rect()};})()`);
  await wheel(wx, wy, 0, -120, 2); await settle('zoom');
  const z1 = await ev(`(()=>{const {c,v}=window.__gv();return {w:c._internal.toWorld(${wx},${wy}),T:v.getTransform()};})()`);
  for (let i = 0; i < 14; i += 1) await wheel(wx, wy, 0, -240, 2);
  await settle('zmax');
  const zMax = await ev('window.__gv().v.getTransform().z');
  for (let i = 0; i < 32; i += 1) await wheel(wx, wy, 0, 240, 2);
  await settle('zmin');
  const zMin = await ev('window.__gv().v.getTransform().z');
  await ev('window.__gv().v.setTransform({x:0,y:0,z:1})');
  await wheel(wx, wy, 40, -25, 0); await settle('pan');
  const pan = await ev('window.__gv().v.getTransform()');
  const prevented = wheelTrusted ? true : await ev('window.__wheelPrevented === true');
  check(6, `ctrl+wheel keeps the world point under the cursor; clamps 0.4..1.6; plain wheel pans by −delta${wheelTrusted ? '' : ' [synthetic wheel]'}`,
    Math.abs(z1.w.x - z0.w.x) < 1e-6 && Math.abs(z1.w.y - z0.w.y) < 1e-6
    && zMax <= 1.6 + 1e-12 && zMin >= 0.4 - 1e-12 && Math.abs(pan.x + 40) < 1e-9 && Math.abs(pan.y - 25) < 1e-9
    && prevented,
    { z0: z0.w, z1: z1.w, zMax, zMin, pan, prevented });

  // (4) header buttons still click after a canvas drag; cross-release never clicks
  await load();
  const saveBox = await ev(`(()=>{const b=document.getElementById('wfv-save').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};})()`);
  const empty = await ev(`(()=>{const r=window.__gv().v.rect();return {x:r.left+120,y:r.top+r.height-60};})()`);
  await ev('window.__clicks=0;document.getElementById("wfv-autolayout").addEventListener("click",()=>{window.__clicks++;});0');
  await press(empty.x, empty.y); await settle('e1'); await mmove(empty.x + 60, empty.y - 30); await settle('e2'); await mup(empty.x + 60, empty.y - 30); await settle('e3');
  const alBox = await ev(`(()=>{const b=document.getElementById('wfv-autolayout').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};})()`);
  await press(alBox.x, alBox.y); await mup(alBox.x, alBox.y); await settle('e4');
  const c1 = await ev('window.__clicks');
  await press(empty.x, empty.y); await settle('e5'); await mmove(alBox.x, alBox.y); await settle('e6'); await mup(alBox.x, alBox.y); await settle('e7');
  const c2 = await ev('({clicks:window.__clicks,gesture:window.__gv().c.gesture()})');
  check(4, 'a real header click fires after a canvas drag; press-on-canvas → release-over-button does not',
    c1 === 1 && c2.clicks === 1 && c2.gesture === null, { c1, c2, saveBox });

  // (8) node drag: incident wires only, 11px snap, Escape reverts
  await load();
  const head = await ev(`(()=>{const {v}=window.__gv();const s=v.toScreen(500,95);const r=v.rect();return {x:s.x+r.left,y:s.y+r.top};})()`);
  const d0 = await ev(`(()=>{const o={};for(const p of document.querySelectorAll('#wfv-canvas .gv-wires path[data-wire-id]'))o[p.dataset.wireId]=p.getAttribute('d');
    return {d:o,pos:window.__gv().c.template().nodes[1].x};})()`);
  await press(head.x, head.y); await settle('n1');
  await mmove(head.x + 93, head.y + 62); await settle('n2');
  const drag = await ev(`(()=>{const o={};for(const p of document.querySelectorAll('#wfv-canvas .gv-wires path[data-wire-id]'))o[p.dataset.wireId]=p.getAttribute('d');
    const el=document.querySelector('#wfv-canvas [data-node-id="n_agent"]');const n=(el.style.transform.match(/-?\\d+(?:\\.\\d+)?/g)||[]).map(Number);return {d:o,tf:n};})()`);
  await keyEv('rawKeyDown', 'Escape', 'Escape', 27); await keyEv('keyUp', 'Escape', 'Escape', 27); await settle('n3');
  const esc = await ev(`(()=>{const o={};for(const p of document.querySelectorAll('#wfv-canvas .gv-wires path[data-wire-id]'))o[p.dataset.wireId]=p.getAttribute('d');
    return {d:o,pos:window.__gv().c.template().nodes[1].x,gesture:window.__gv().c.gesture()};})()`);
  await mup(head.x + 93, head.y + 62);
  check(8, 'node drag snaps to 11px, repaints only incident wires, Escape reverts',
    drag.tf.length === 2 && drag.tf.every((v) => v % 11 === 0)
    && JSON.stringify(esc.d) === JSON.stringify(d0.d) && esc.pos === d0.pos && esc.gesture === null,
    { tf: drag.tf, reverted: JSON.stringify(esc.d) === JSON.stringify(d0.d) });

  // (9) middle-drag / space+drag pan; window blur ends a gesture
  await load();
  const t0 = await ev('window.__gv().v.getTransform()');
  const e2 = await ev(`(()=>{const r=window.__gv().v.rect();return {x:r.left+150,y:r.top+r.height-70};})()`);
  await press(e2.x, e2.y, 'middle'); await settle('m1');
  await mmove(e2.x + 55, e2.y - 35, 4, 'middle'); await settle('m2');
  const tMid = await ev('window.__gv().v.getTransform()');
  await mup(e2.x + 55, e2.y - 35, 'middle'); await settle('m3');
  await keyEv('rawKeyDown', ' ', 'Space', 32);
  const t1 = await ev('window.__gv().v.getTransform()');
  await press(head.x, head.y); await settle('s1');
  await mmove(head.x - 40, head.y + 25); await settle('s2');
  const t2 = await ev('window.__gv().v.getTransform()');
  await mup(head.x - 40, head.y + 25); await settle('s3');
  await keyEv('keyUp', ' ', 'Space', 32);
  await press(e2.x, e2.y); await settle('b1');
  const blur = await ev(`(()=>{window.dispatchEvent(new Event('blur'));const {c,v}=window.__gv();return {g:c.gesture(),cls:v.ghostEl.getAttribute('class')};})()`);
  await mup(e2.x, e2.y);
  check(9, 'middle-drag and space+drag pan by the exact delta; blur ends the gesture',
    Math.abs(tMid.x - t0.x - 55) < 1e-9 && Math.abs(tMid.y - t0.y + 35) < 1e-9
    && Math.abs(t2.x - t1.x + 40) < 1e-9 && Math.abs(t2.y - t1.y - 25) < 1e-9
    && blur.g === null && blur.cls === 'wire ghost',
    { t0, tMid, t1, t2, blur });

  // ---- (10)–(12) the Workflows view's chrome, measured in REAL layout --------
  await load();
  const rect = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const b=e.getBoundingClientRect();
    return {l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height};})()`);
  const lib = await ev(`(()=>{const q=(s)=>document.querySelector(s);const lib=q('#wfv-library'),stage=q('#wfv-stage');
    const r=(e)=>{const b=e.getBoundingClientRect();return {l:b.left,r:b.right,w:b.width};};
    return {open:lib.dataset.open,lib:r(lib),stage:r(stage),tabs:[...lib.querySelectorAll('[data-tab]')].map((t)=>[...t.childNodes].filter((n)=>n.nodeType===3).map((n)=>n.textContent).join('').trim())};})()`);
  check(10, 'the Library card is 300px wide, open, right of the stage, with the Agents / Scripts / Workflows tabs',
    lib.open === 'true' && Math.abs(lib.lib.w - 300) < 0.6 && lib.lib.l >= lib.stage.r - 0.6
    && JSON.stringify(lib.tabs) === JSON.stringify(['Agents', 'Scripts', 'Workflows']), lib);
  const bar = await ev(`(()=>{const q=(s)=>document.querySelector(s);
    const shown=(e)=>!!e&&!e.closest('[hidden]')&&getComputedStyle(e).display!=='none'&&e.getClientRects().length>0;
    const ctl=[...document.querySelectorAll('#wfv-stage .wfv-tl button, #wfv-stage .wfv-tl input, #wfv-stage .wfv-tr button, #wfv-stage .wfv-tr input')]
      .filter(shown).map((e)=>e.id).filter(Boolean);
    const disp=(s)=>{const e=q(s);return e?getComputedStyle(e).display:'absent';};
    return {ctl,sidebar:disp('.sidebar'),topnav:disp('#topnav'),dock:disp('body > .ask-dock'),errorsShown:shown(q('#wfv-errors'))};})()`);
  const expectBar = ['wfv-back', 'wfv-wf-menu', 'wfv-name', ...(bar.errorsShown ? ['wfv-errors'] : []), 'wfv-lib-toggle', 'wfv-save'];
  check(11, 'the top bar holds exactly Back, the workflow menu, the name, (errors), the Library toggle and Save; the app chrome is hidden',
    JSON.stringify([...bar.ctl].sort()) === JSON.stringify([...expectBar].sort())
    && bar.sidebar === 'none' && bar.topnav === 'none' && (bar.dock === 'none' || bar.dock === 'absent'), { ...bar, expectBar });
  const frost = async () => ev(`(()=>{const n=document.querySelector('#wfv-canvas .gv-world .node');if(!n)return null;const cs=getComputedStyle(n);
    const m=cs.backgroundColor.match(/rgba?\\(([^)]+)\\)/);const parts=m?m[1].split(/[ ,/]+/).filter(Boolean).map(Number):[];
    return {blur:cs.backdropFilter||cs.webkitBackdropFilter||'',bg:cs.backgroundColor,alpha:parts.length>=4?parts[3]:1,theme:document.documentElement.dataset.theme||''};})()`);
  const prevTheme12 = await ev(`document.documentElement.dataset.theme||''`);
  await ev(`document.documentElement.dataset.theme='light';1`); await sleep(320); await settle('frost-light');
  const fl = await frost();
  await ev(`document.documentElement.dataset.theme='dark';1`); await sleep(320); await settle('frost-dark');
  const fd = await frost();
  await ev(`(()=>{const t=${JSON.stringify(prevTheme12)};if(t)document.documentElement.dataset.theme=t;else delete document.documentElement.dataset.theme;return 1;})()`);
  await sleep(320); await settle('frost-restore');
  const frosted = (f) => !!f && f.blur.includes('blur(') && f.alpha >= 0.4 && f.alpha <= 0.6;
  check(12, 'cards are frosted: a backdrop blur and a 0.4–0.6 background alpha, in light AND dark', frosted(fl) && frosted(fd), { light: fl, dark: fd });

  // ---- (14) the zoom menu --------------------------------------------------------
  await load();
  await ev('window.__gv().c.zoomAbout(1, 0, 0);1'); await settle('zoom-100');
  const z100 = await ev(`document.getElementById('wfv-zoom-label').textContent`);
  const zb = await rect('#wfv-zoom');
  await press(zb.l + zb.w / 2, zb.t + zb.h / 2); await mup(zb.l + zb.w / 2, zb.t + zb.h / 2); await settle('zoom-menu');
  const items = await ev(`[...document.querySelectorAll('.wfv-menu [role^="menuitem"]')].map((b)=>(b.querySelector('.wfv-menu-l')||b).textContent.trim())`);
  const zoomMenu = await rect('.wfv-menu');
  const zi = await ev(`(()=>{const b=[...document.querySelectorAll('.wfv-menu [role^="menuitem"]')].find((x)=>x.textContent.trim().startsWith('Zoom in'));
    if(!b)return null;const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  if (zi) { await press(zi.x, zi.y); await mup(zi.x, zi.y); await settle('zoom-in'); }
  const z120 = await ev(`document.getElementById('wfv-zoom-label').textContent`);
  const ab = await rect('#wfv-add');
  await press(ab.l + ab.w / 2, ab.t + ab.h / 2); await mup(ab.l + ab.w / 2, ab.t + ab.h / 2); await settle('add-menu');
  const addMenu = await rect('.wfv-menu');
  await keyEv('rawKeyDown', 'Escape', 'Escape', 27); await keyEv('keyUp', 'Escape', 'Escape', 27); await settle('add-menu-close');
  // A menu measured before it is position:fixed reads the viewport's width and lands at left:8.
  const flush = !!zoomMenu && !!addMenu && Math.abs(zoomMenu.r - zb.r) <= 1 && Math.abs(addMenu.l - ab.l) <= 1;
  check(14, 'the zoom menu reads Zoom in / Zoom out / Fit graph to view, and Zoom in takes 100% to 120%; the zoom menu ends at its trigger\'s right edge, the "+" menu starts at its left',
    JSON.stringify(items) === JSON.stringify(['Zoom in', 'Zoom out', 'Fit graph to view']) && z100 === '100%' && z120 === '120%' && !!zi && flush,
    { items, z100, z120, zoom: zb, zoomMenu, add: ab, addMenu });

  // ---- (13) wires are orthogonal lanes (lanes.mjs) and may cross cards; a loop returns UNDER ----
  await load();
  await ev(`(()=>{const {c}=window.__gv();c.loadTemplate({id:'',name:'loop',version:2,domain:'coding',
    nodes:[{id:'n_impl',kind:'agent',key:'implementer',x:100,y:100,config:{}},{id:'n_rev',kind:'agent',key:'reviewer',x:460,y:100,config:{}}],
    wires:[{id:'w1',from:{node:'n_impl',port:'done'},to:{node:'n_rev',port:'done'}},
      {id:'w2',from:{node:'n_rev',port:'review'},to:{node:'n_impl',port:'fix'},config:{maxCycles:2}}]});c.fit();return 1;})()`);
  await settle('loop-load');
  const loop = await ev(`(()=>{const ds=[...document.querySelectorAll('#wfv-canvas .gv-wires path[data-wire-id]')].map((p)=>p.getAttribute('d')||'');
    const pill=document.querySelector('#wfv-canvas .wbadge');const pr=pill&&pill.getBoundingClientRect();
    const cards=['n_impl','n_rev'].map((id)=>{const e=document.querySelector('#wfv-canvas [data-node-id="'+id+'"]');return e?e.getBoundingClientRect().bottom:null;});
    return {ds,pillY:pr?pr.top+pr.height/2:null,pillText:pill?pill.textContent.trim():'',cards};})()`);
  check(13, 'every committed wire is an orthogonal lane route (straight runs and rounded corners, no C / S / A); the loop pill sits under both cards and reads ≤N',
    loop.ds.length >= 2 && loop.ds.every((d) => d.includes(' L ') && !/[CSA]/.test(d))
    && loop.pillY != null && loop.cards.every((b) => b != null && loop.pillY > b) && /^≤\d+/.test(loop.pillText), loop);

  // ---- (15) a script placed from the Library, its Params popover, both themes ----
  await ev(`location.hash='#workflows/scripts';1`);
  for (let i = 0; i < 100; i += 1) { if (await ev(`!!document.querySelector('#wfv-library .wfl-item[data-item="script:shell"] .wfl-add')`)) break; await sleep(100); }
  await ev(`(()=>{const e=document.querySelector('#wfv-library .wfl-item[data-item="script:shell"] .wfl-add');if(e)e.scrollIntoView({block:'center'});return 1;})()`); await settle('shell-into-view');
  const add15 = await rect('#wfv-library .wfl-item[data-item="script:shell"] .wfl-add');
  let s15 = { add: add15 };
  if (add15) {
    await press(add15.l + add15.w / 2, add15.t + add15.h / 2); await mup(add15.l + add15.w / 2, add15.t + add15.h / 2); await settle('script-add');
    const state15 = () => ev(`(()=>{const {c}=window.__gv();const cards=[...document.querySelectorAll('#wfv-canvas .node.node-script')];
      const card=cards[0]||null;const lm=card&&card.querySelector('.nlabel .lm');const cs=(el,p)=>el?getComputedStyle(el)[p]:null;
      const node=c.template().nodes.find((n)=>n.kind==='script');const sel=c.selection();
      return {cards:cards.length,rt:lm&&lm.textContent.trim(),lmColor:cs(lm,'color'),stageBg:cs(document.getElementById('wfv-stage'),'backgroundColor'),
        selected:!!(sel&&node&&sel.id===node.id),command:(node&&node.config&&node.config.params&&node.config.params.command)||null,
        theme:document.documentElement.dataset.theme||''};})()`);
    const light = await state15();
    const pb = await rect('.wfv-tb [data-tb="params"]');
    if (pb) { await press(pb.l + pb.w / 2, pb.t + pb.h / 2); await mup(pb.l + pb.w / 2, pb.t + pb.h / 2); await settle('params'); }
    const hasTa = await ev(`!!document.querySelector('.wfv-pop textarea[data-field="param:command"]')`);
    if (hasTa) {
      await ev(`(()=>{const ta=document.querySelector('.wfv-pop textarea[data-field="param:command"]');ta.focus();ta.value='npm test';
        ta.dispatchEvent(new Event('input',{bubbles:true}));ta.blur();ta.dispatchEvent(new Event('change',{bubbles:true}));return 1;})()`);
      await settle('script-command');
    }
    const typed = await state15();
    const prevTheme = await ev(`document.documentElement.dataset.theme||''`);
    await ev(`document.documentElement.dataset.theme='dark';1`); await sleep(320); await settle('script-dark');
    const dark = await state15();
    await ev(`(()=>{const t=${JSON.stringify(prevTheme)};if(t)document.documentElement.dataset.theme=t;else delete document.documentElement.dataset.theme;return 1;})()`);
    await sleep(320); await settle('script-light');
    s15 = { ...s15, light, params: !!pb, hasTa, command: typed.command, dark: { rt: dark.rt, colors: [dark.lmColor, dark.stageBg], theme: dark.theme } };
    check(15, 'the Library "+" on the shell row places one selected script card with its runtime in the label row; Params opens the popover and the command commits; legible in both themes',
      light.cards === 1 && light.rt === 'shell' && light.selected && !!pb && hasTa && typed.command === 'npm test'
      && light.lmColor !== light.stageBg && dark.lmColor !== dark.stageBg && dark.theme === 'dark', s15);
  } else {
    check(15, 'the Library Scripts tab lists the built-in shell script with its "+"', false, s15);
  }

  // ---- (16) the chat never covers the bottom-right bars ---------------------------
  await ev(`location.hash='#workflows';1`);
  for (let i = 0; i < 60; i += 1) { if (await ev(`!!document.getElementById('wfc-input')`)) break; await sleep(100); }
  const steady = async (tag) => {      // #wfv-br's bottom transitions: poll ≤ 2 s until its rect stops moving
    let prev = null;
    for (let i = 0; i < 20; i += 1) {
      await settle(`${tag}-${i}`); await sleep(100);
      const r = await rect('#wfv-br');
      if (prev && r && Math.abs(r.t - prev.t) < 0.1 && Math.abs(r.l - prev.l) < 0.1) return r;
      prev = r;
    }
    return prev;
  };
  const meet = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const inside = (a, b) => !!a && !!b && a.l >= b.l - 0.6 && a.r <= b.r + 0.6 && a.t >= b.t - 0.6 && a.b <= b.b + 0.6;
  // The house textarea rule (min-height:120px) must not reach the pill: its input stays inside it, one line tall.
  const pill = { input: await rect('#wfc-input'), shell: await rect('.wfc-shell') };
  await ev(`(()=>{const i=document.getElementById('wfc-input');if(i)i.focus();return 1;})()`);
  const brOpen = await steady('chat-open');
  const dockOpen = await rect('#wfv-dock'); const stage16 = await rect('#wfv-stage');
  const shiftEnter = async () => {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 8, text: '\r' });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 8 });
  };
  await cdp('Input.insertText', { text: 'line one' }); await shiftEnter();
  await cdp('Input.insertText', { text: 'line two' }); await shiftEnter();
  await cdp('Input.insertText', { text: 'line three' }); await settle('chat-typed');
  const typed = { input: await rect('#wfc-input'), lines: await ev(`document.getElementById('wfc-input').value.split('\\n').length`) };
  await keyEv('rawKeyDown', 'Escape', 'Escape', 27); await keyEv('keyUp', 'Escape', 'Escape', 27);
  const brClosed = await steady('chat-close');
  const dockClosed = await rect('#wfv-dock');
  const pillAfter = { input: await rect('#wfc-input'), shell: await rect('.wfc-shell') };
  const onePill = (p) => inside(p.input, p.shell) && p.input.h <= 40;
  check(16, 'with the chat open (and after Escape) the bottom-right bars never meet the dock and stay inside the stage; the collapsed input sits inside the pill (≤ 40px), three typed lines grow it past 30px up to 104px',
    !!brOpen && !!dockOpen && !meet(brOpen, dockOpen) && inside(brOpen, stage16) && !meet(brClosed, dockClosed)
    && onePill(pill) && onePill(pillAfter) && typed.lines === 3 && !!typed.input && typed.input.h > 30 && typed.input.h <= 104,
    { brOpen, dockOpen, brClosed, dockClosed, stage: stage16, pill, typed, pillAfter });

  // ---- (17) the More popover keeps inside the stage, clear of the dock ----------------
  await load();
  await ev(`(()=>{const {c}=window.__gv();c.select({kind:'node',id:'n_agent'});c.view.centerOn('n_agent');return 1;})()`);
  await settle('pop-select');
  const more = await rect('.wfv-tb [data-tb="more"]');
  if (more) { await press(more.l + more.w / 2, more.t + more.h / 2); await mup(more.l + more.w / 2, more.t + more.h / 2); await settle('pop-open'); }
  const p17 = { more, pop: await rect('.wfv-pop'), stage: await rect('#wfv-stage'), dock: await rect('#wfv-dock'), tb: await rect('.wfv-tb') };
  check(17, 'an agent\'s More popover opened at the canvas middle lies inside the stage and clear of the chat dock',
    !!p17.pop && inside(p17.pop, p17.stage) && !meet(p17.pop, p17.dock), p17);

  check('console', 'no page errors or exceptions', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  failed += 1;
  console.log(`FAIL (fatal) ${e && e.stack ? e.stack : e}`);
}
console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`} — ${((Date.now() - T0) / 1000).toFixed(1)}s`);
await shutdown(failed === 0 ? 0 : 1);
