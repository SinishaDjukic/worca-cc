#!/usr/bin/env node
// scripts/verify-composer-cdp.mjs — headless-Chrome proof of the composer's
// pointer pipeline (spec §7.11 (1)-(9)). NOT part of `npm test`: it needs Chrome
// and a live server. Run: node scripts/verify-composer-cdp.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const INSET_OPEN = 280;        // composer.mjs INSET_OPEN — the open rail's width
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
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
log(`server ${base}`);

// ---- chrome + cdp
profile = await mkdtemp(path.join(tmpdir(), 'worca-cdp-profile-'));
chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,900', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'],
{ stdio: ['ignore', 'pipe', 'pipe'] });
chrome.stderr.on('data', () => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(200);
  } catch { await sleep(250); }
}
if (!wsUrl) { console.error('no devtools target'); await shutdown(1); }
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
let wheelTrusted = null;        // null = not probed yet
async function probeWheel(x, y) {   // x,y come from the caller and are already inside the stage
  await ev('window.__wp=0;window.__wpH=(e)=>{window.__wp++;};window.addEventListener("wheel",window.__wpH,{passive:true});0');
  await mmove(x, y, 0);
  // A ZERO delta: the probe must not move the canvas. A real delta pans the view
  // (t -= delta), which shifts the world point under the cursor and makes the
  // very next invariance measurement read as broken.
  await wheelRaw(x, y, 0, 0, 0);
  await settle('wheel-probe');
  const seen = await ev('(()=>{const n=window.__wp;window.removeEventListener("wheel",window.__wpH);return n;})()');
  wheelTrusted = seen > 0;
  log(`wheel delivery: ${wheelTrusted ? 'trusted CDP events' : 'SYNTHETIC (this browser drops CDP wheels)'}`);
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
  if (first) await cdp('Page.navigate', { url: `${base}/#composer` }); else await cdp('Page.reload', {});
  await waitEvent('Page.loadEventFired');
  for (let i = 0; i < 60; i += 1) { if (await ev('!!(window.__gv && window.__gv())')) break; await sleep(100); }
  if (!await ev('!!(window.__gv && window.__gv())')) throw new Error('composer never mounted');
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
    return {ok,z:v.getTransform().z,worlds:document.querySelectorAll('#gv-canvas .gv-world').length,out};})()`);
  check(7, 'auto-fit keeps every node box inside the stage and z ≤ 1', fitR.ok && fitR.z <= 1 && fitR.worlds === 1, fitR);

  // (3) ghost fill:none at rest
  const fillRest = await ev(`getComputedStyle(document.querySelector('#gv-canvas .gv-wires path.ghost')).fill`);
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

  // (5) mirrored tangent from an INPUT port
  await load();
  const fix = await clientOfAnchor('n_agent', 'task', 'in');
  await press(fix.x, fix.y); await settle('press-in');
  await mmove(fix.x - 120, fix.y); await settle('move-left');
  const mir = await ev(`(()=>{const {v}=window.__gv();const d=v.ghostEl.getAttribute('d');const n=(d.match(/-?\\d+(?:\\.\\d+)?/g)||[]).map(Number);
    return {d,ax:n[0],c1x:n[2]};})()`);
  check(5, 'a drag from an input mirrors the tangent (first control x < anchor x)', mir.c1x < mir.ax, mir);
  await keyEv('rawKeyDown', 'Escape', 'Escape', 27); await keyEv('keyUp', 'Escape', 'Escape', 27); await settle('esc');

  // (6) zoom about the cursor + plain-wheel pan
  await load();
  // The wheel point must be INSIDE the stage and LEFT of the floating inspector
  // rail: measured 2026-08-28 the stage is 868px wide, so a hard `left + 600`
  // lands on #gv-ins-toggle and the composer rightly ignores it (the transform
  // then never moves and the check reads as a product bug that is not one).
  // Refresh the composer's rect cache FIRST. Under --headless=new the
  // ResizeObserver's initial callback only runs once frames are forced, so it can
  // land BETWEEN the two world-point reads below and shift R.top by a pixel or
  // two — the invariance then reads as broken when only the harness moved.
  await settle('rect-quiesce'); await ev('window.__gv().c._internal.readRect()');
  const sr = await ev('window.__gv().v.rect()');
  // INTEGER client coordinates: Chrome rounds Input.dispatchMouseEvent's x/y, so a
  // fractional probe point is measured half a pixel away from where the browser
  // actually zoomed — which shows up as a sub-pixel invariance drift, not a bug.
  const wx = Math.round(sr.left + (sr.width - INSET_OPEN) / 2);
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
  const saveBox = await ev(`(()=>{const b=document.getElementById('gv-save').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};})()`);
  const empty = await ev(`(()=>{const r=window.__gv().v.rect();return {x:r.left+120,y:r.top+r.height-60};})()`);
  await ev('window.__clicks=0;document.getElementById("gv-autolayout").addEventListener("click",()=>{window.__clicks++;});0');
  await press(empty.x, empty.y); await settle('e1'); await mmove(empty.x + 60, empty.y - 30); await settle('e2'); await mup(empty.x + 60, empty.y - 30); await settle('e3');
  const alBox = await ev(`(()=>{const b=document.getElementById('gv-autolayout').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};})()`);
  await press(alBox.x, alBox.y); await mup(alBox.x, alBox.y); await settle('e4');
  const c1 = await ev('window.__clicks');
  await press(empty.x, empty.y); await settle('e5'); await mmove(alBox.x, alBox.y); await settle('e6'); await mup(alBox.x, alBox.y); await settle('e7');
  const c2 = await ev('({clicks:window.__clicks,gesture:window.__gv().c.gesture()})');
  check(4, 'a real header click fires after a canvas drag; press-on-canvas → release-over-button does not',
    c1 === 1 && c2.clicks === 1 && c2.gesture === null, { c1, c2, saveBox });

  // (8) node drag: incident wires only, 11px snap, Escape reverts
  await load();
  const head = await ev(`(()=>{const {v}=window.__gv();const s=v.toScreen(500,95);const r=v.rect();return {x:s.x+r.left,y:s.y+r.top};})()`);
  const d0 = await ev(`(()=>{const o={};for(const p of document.querySelectorAll('#gv-canvas .gv-wires path[data-wire-id]'))o[p.dataset.wireId]=p.getAttribute('d');
    return {d:o,pos:window.__gv().c.template().nodes[1].x};})()`);
  await press(head.x, head.y); await settle('n1');
  await mmove(head.x + 93, head.y + 62); await settle('n2');
  const drag = await ev(`(()=>{const o={};for(const p of document.querySelectorAll('#gv-canvas .gv-wires path[data-wire-id]'))o[p.dataset.wireId]=p.getAttribute('d');
    const el=document.querySelector('#gv-canvas [data-node-id="n_agent"]');const n=(el.style.transform.match(/-?\\d+(?:\\.\\d+)?/g)||[]).map(Number);return {d:o,tf:n};})()`);
  await keyEv('rawKeyDown', 'Escape', 'Escape', 27); await keyEv('keyUp', 'Escape', 'Escape', 27); await settle('n3');
  const esc = await ev(`(()=>{const o={};for(const p of document.querySelectorAll('#gv-canvas .gv-wires path[data-wire-id]'))o[p.dataset.wireId]=p.getAttribute('d');
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

  check('console', 'no page errors or exceptions', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  failed += 1;
  console.log(`FAIL (fatal) ${e && e.stack ? e.stack : e}`);
}
console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`} — ${((Date.now() - T0) / 1000).toFixed(1)}s`);
await shutdown(failed === 0 ? 0 : 1);
