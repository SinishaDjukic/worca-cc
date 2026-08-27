// CDP measurement harness for composer-proto/proto.html — checklist items 1..10 of adj-c.md
//
// Headless note: `--headless=new` produces an animation frame only when the compositor is asked for one.
// Late in a session it stops producing them spontaneously, so a queued requestAnimationFrame (the prototype's
// frame()) can sit unserviced forever. settle() therefore ARMS a marker rAF, then forces real frames with
// Page.captureScreenshot until the marker fires. Extra forced frames cannot inflate stats.frames: frame()
// clears `raf` and is only re-armed by the next pointermove. On a real display the browser ticks at 60Hz
// unconditionally, so this reproduces on-screen behaviour rather than changing what is measured.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PROTO = path.resolve(HERE, '..', 'proto.html');
const PORT = Number(process.env.CDP_PORT || 9333);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

const console_log = [];
let phase = 'boot';
const results = {};
const settleReports = [];
const note = (item, o) => { results[item] = o; log(`ITEM ${item}: pass=${o.pass}`); };

// ---------------------------------------------------------------- chrome + cdp plumbing
const proc = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${HERE}/profile`,
  '--window-size=1280,800', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank',
], { detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
proc.stderr.on('data', () => {});
const bail = (msg) => { try { proc.kill('SIGKILL'); } catch {} console.error(msg); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wsUrl = null, version = null;
for (let i = 0; i < 60 && !wsUrl; i++) {
  try {
    version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(200);
  } catch { await sleep(250); }
}
if (!wsUrl) bail('no devtools target');
log(`chrome up: ${version && version.Browser}`);

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map(); const listeners = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id != null) { const p = pending.get(m.id); pending.delete(m.id); if (p) m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
  for (const l of [...listeners]) l(m);
};
function cdp(method, params = {}, ms = 12000) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT ${method} (${JSON.stringify(params).slice(0, 110)})`)); }, ms);
    pending.set(id, { res: (v) => { clearTimeout(to); res(v); }, rej: (er) => { clearTimeout(to); rej(er); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
function waitEvent(name, ms = 10000) {
  return new Promise((res, rej) => {
    const to = setTimeout(() => { off(); rej(new Error(`timeout ${name}`)); }, ms);
    const l = (m) => { if (m.method === name) { clearTimeout(to); off(); res(m.params); } };
    const off = () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
    listeners.push(l);
  });
}
listeners.push((m) => {
  if (m.method === 'Runtime.consoleAPICalled') console_log.push({ phase, kind: `console.${m.params.type}`, text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ') });
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; console_log.push({ phase, kind: 'exception', text: d.exception?.description || d.text }); }
  if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) console_log.push({ phase, kind: `log.${m.params.entry.level}`, text: m.params.entry.text });
});
await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable');
log('domains enabled');

// ---------------------------------------------------------------- helpers
async function ev(expr, awaitPromise = false) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n--- expr ---\n' + expr);
  return r.result.value;
}
const armRaf = () => ev('window.__rafHit=0;requestAnimationFrame(()=>{window.__rafHit=1;});0');
const kick = () => cdp('Page.captureScreenshot', { format: 'jpeg', quality: 1, clip: { x: 0, y: 0, width: 16, height: 16, scale: 1 } }, 10000).catch(() => null);
async function settleFrames(tag = '') {                     // wait until ONE animation frame has been serviced
  for (let i = 0; i < 10; i++) {
    if (await ev('window.__rafHit')) { settleReports.push({ phase, tag, kicks: i }); return 'raf'; }
    await kick();
  }
  settleReports.push({ phase, tag, kicks: 'FAILED' }); log(`  !! no frame after 10 kicks (${phase} ${tag})`);
  return 'timeout';
}
async function settle(tag = '') { await armRaf(); return settleFrames(tag); }

async function load(ph, first = false) {
  phase = ph; log(`load: ${ph}`);
  if (first) await cdp('Page.navigate', { url: `file://${PROTO}` }); else await cdp('Page.reload', {});
  await waitEvent('Page.loadEventFired');
  for (let i = 0; i < 40; i++) { if (await ev('typeof window.__proto === "object" && !!window.__proto')) break; await sleep(50); }
  if (!(await ev('typeof window.__proto === "object" && !!window.__proto'))) bail('window.__proto missing after load; console=' + JSON.stringify(console_log));
  await settle('post-load');
}
const press = (x, y, button = 'left') => cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'middle' ? 4 : 1, clickCount: 1 });
const move = (x, y, buttons = 1, button = 'left') => cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button, buttons, clickCount: 0 });
const up = (x, y, button = 'left') => cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 });
const wheel = (x, y, deltaX, deltaY, modifiers = 0) => cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers, button: 'none' });
const key = (type, k, code, vk) => cdp('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(k === ' ' ? { text: ' ' } : {}) });
const nums = (d) => (d || '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
async function moveSettle(x, y, buttons = 1, button = 'left', tag = '') { await move(x, y, buttons, button); await armRaf(); return settleFrames(tag); }

const clientOfAnchor = (nodeId, port, dir) =>
  ev(`(()=>{const P=window.__proto,a=P.anchor(${JSON.stringify(nodeId)},${JSON.stringify(port)},${JSON.stringify(dir)}),s=P.toScreen(a.x,a.y),r=P.rect();return {wx:a.x,wy:a.y,x:s.x+r.left,y:s.y+r.top};})()`);
const clientOfWorld = (wx, wy) =>
  ev(`(()=>{const P=window.__proto,s=P.toScreen(${wx},${wy}),r=P.rect();return {x:s.x+r.left,y:s.y+r.top};})()`);

// burst: dispatch N synthetic pointermoves, then let exactly one animation frame be serviced
const BURST_ARM = (n, expr) => `(()=>{const P=window.__proto,st=P.stage();window.__s0={...P.stats};window.__gbcr=0;
 window.__origGBCR=Element.prototype.getBoundingClientRect;
 Element.prototype.getBoundingClientRect=function(){window.__gbcr++;return window.__origGBCR.apply(this,arguments);};
 for(let i=0;i<${n};i++){st.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,${expr},bubbles:true}));}
 window.__rafHit=0;requestAnimationFrame(()=>{window.__rafHit=1;});return window.__s0;})()`;
const BURST_READ = `(()=>{const P=window.__proto,s0=window.__s0,s1={...P.stats};
 Element.prototype.getBoundingClientRect=window.__origGBCR;const dd={};
 for(const p of document.querySelectorAll('#wires path[data-wire-id]'))dd[p.dataset.wireId]=p.getAttribute('d');
 return {dFrames:s1.frames-s0.frames,dGhost:s1.ghostUpdates-s0.ghostUpdates,dRect:s1.rectReads-s0.rectReads,
  dMoves:s1.pointerMoves-s0.pointerMoves,dWireD:s1.wireDUpdates-s0.wireDUpdates,gbcr:window.__gbcr,
  ghostD:P.ghostD(),ghostClass:P.ghost().getAttribute('class'),fill:getComputedStyle(P.ghost()).fill,
  chipHidden:document.getElementById('chip').hidden,d:dd,pos:{x:P.nodes[1].x,y:P.nodes[1].y},
  tf:document.querySelector('[data-node-id="n_agent"]').style.transform,cls:document.querySelector('[data-node-id="n_agent"]').className};})()`;

let fatal = null;
try {
// ================================================================ RUN A — items 1, 2, 4(static)
await load('A: load + fit', true);
const boot = await ev(`(()=>{const P=window.__proto;return {rect:P.rect(),T:P.transform(),stats:{...P.stats},nodes:P.nodes.map(n=>({id:n.id,x:n.x,y:n.y,h:P.size(n.id).h,w:P.size(n.id).w})),wires:P.wires.length,
  anchors:{agent_task:P.anchor('n_agent','task','in'),agent_fix:P.anchor('n_agent','fix','in'),agent_plan:P.anchor('n_agent','plan','out'),agent_review:P.anchor('n_agent','review','out'),agent_await:P.anchor('n_agent','await','in'),task_out:P.anchor('n_task','task','out'),end_result:P.anchor('n_end','result','in')},
  ghostClass:P.ghost().getAttribute('class'), ghostFill:getComputedStyle(P.ghost()).fill, ghostD:P.ghostD(),
  headEl:(()=>{const b=document.getElementById('btn-save').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};})()};})()`);
note(1, { what: 'load file:// at 1280x800; rect/transform/anchors/geometry read back', measured: { rect: boot.rect, T: boot.T, anchors: boot.anchors, nodes: boot.nodes, wires: boot.wires, statsAtBoot: boot.stats }, pass: boot.rect.width === 1280 && boot.wires === 2 });

const corners = await ev(`(()=>{const P=window.__proto,r=P.rect(),out=[];let ok=true;
 for(const n of P.nodes){const s=P.size(n.id);for(const [dx,dy] of [[0,0],[s.w,0],[0,s.h],[s.w,s.h]]){const p=P.toScreen(n.x+dx,n.y+dy);
  const inside=p.x>=0&&p.x<=r.width&&p.y>=0&&p.y<=r.height; if(!inside)ok=false; out.push({node:n.id,sx:+p.x.toFixed(2),sy:+p.y.toFixed(2),inside});}}
 return {ok,z:P.transform().z,t:{x:P.transform().x,y:P.transform().y},band:{w:r.width,h:r.height},extent:{minx:Math.min(...out.map(o=>o.sx)),maxx:Math.max(...out.map(o=>o.sx)),miny:Math.min(...out.map(o=>o.sy)),maxy:Math.max(...out.map(o=>o.sy))},corners:out.length};})()`);
note(2, { what: 'auto-fit: all 12 node-box corners via toScreen inside the stage rect; z<=1', measured: corners, pass: corners.ok && corners.z <= 1 });
note('4a', { what: 'getComputedStyle(ghost).fill at rest', measured: { fill: boot.ghostFill, cls: boot.ghostClass, d: boot.ghostD }, pass: boot.ghostFill === 'none' });

// ================================================================ RUN B — item 3 (60-move burst) + 4 mid-drag
await load('B: ghost burst');
const plan = await clientOfAnchor('n_agent', 'plan', 'out');
await press(plan.x, plan.y); await settle('B-after-press');
const afterDown = await ev(`(()=>{const P=window.__proto,g=P.gesture();return {type:g&&g.type,origin:g&&{node:g.origin.node.id,port:g.origin.port,dir:g.origin.dir},mirror:g&&g.mirror,cls:P.ghost().getAttribute('class'),stats:{...P.stats}};})()`);
const bs = await ev(`(()=>{const r=window.__proto.rect();return {x:r.left+200,y:r.top+480};})()`);
await ev(BURST_ARM(60, `clientX:${bs.x}+i,clientY:${bs.y}+(i%7)`));
const via3 = await settleFrames('B-burst');
const burst = await ev(BURST_READ);
await up(bs.x + 59, bs.y + (59 % 7)); await settle('B-after-up');
const afterUp = await ev(`(()=>{const P=window.__proto;return {gesture:P.gesture(),cls:P.ghost().getAttribute('class'),wires:P.wires.length,stats:{...P.stats}};})()`);
note(3, {
  what: 'mousePressed on n_agent.plan anchor; 60 synthetic pointermove on #stage; exactly one animation frame; mouseReleased on empty canvas',
  measured: { pressClient: plan, gestureAfterDown: afterDown, frameVia: via3, burst: { dFrames: burst.dFrames, dGhostUpdates: burst.dGhost, dRectReads: burst.dRect, gbcrCalls: burst.gbcr, dPointerMoves: burst.dMoves, dWireDUpdates: burst.dWireD, ghostD: burst.ghostD, ghostClass: burst.ghostClass }, afterUp: { gesture: afterUp.gesture, ghostClass: afterUp.cls, wires: afterUp.wires, statsFinal: afterUp.stats } },
  pass: burst.dFrames === 1 && burst.dGhost <= 1 && burst.dRect === 0 && burst.gbcr === 0 && burst.dMoves === 60 && afterUp.gesture === null && afterUp.cls === 'wire ghost' && afterUp.wires === 2,
});
note('4b', { what: 'getComputedStyle(ghost).fill mid-drag', measured: { fill: burst.fill, cls: burst.ghostClass }, pass: burst.fill === 'none' });

// ================================================================ RUN C — item 5 mirrored tangent
await load('C: mirrored tangent');
const fix = await clientOfAnchor('n_agent', 'fix', 'in');
await press(fix.x, fix.y); await settle('C-press');
await moveSettle(fix.x - 120, fix.y, 1, 'left', 'C-left120');
const mir = await ev(`(()=>{const P=window.__proto,d=P.ghostD(),n=(d.match(/-?\\d+(?:\\.\\d+)?/g)||[]).map(Number);
 return {d,ax:n[0],ay:n[1],c1x:n[2],c1y:n[3],c2x:n[4],c2y:n[5],bx:n[6],by:n[7],cls:P.ghost().getAttribute('class'),anchor:P.anchor('n_agent','fix','in')};})()`);
const taskOut = await clientOfAnchor('n_task', 'task', 'out');
await moveSettle(taskOut.x, taskOut.y, 1, 'left', 'C-onto-port');
const snap = await ev(`(()=>{const P=window.__proto,d=P.ghostD(),n=(d.match(/-?\\d+(?:\\.\\d+)?/g)||[]).map(Number);
 return {d,c1x:n[2],endX:n[6],endY:n[7],cls:P.ghost().getAttribute('class'),target:P.anchor('n_task','task','out'),chip:{hidden:document.getElementById('chip').hidden,text:document.getElementById('chip').textContent}};})()`);
await up(taskOut.x, taskOut.y); await settle('C-up');
const committed = await ev(`(()=>{const P=window.__proto,w=P.wires[P.wires.length-1];return {count:P.wires.length,last:{from:w.from,to:w.to},gesture:P.gesture(),ghostCls:P.ghost().getAttribute('class'),paths:[...document.querySelectorAll('#wires path')].length,ghostIsLast:document.querySelector('#wires path:last-child').dataset.ghost==='1'};})()`);
note(5, {
  what: 'press n_agent.fix (INPUT) -> move 120px left -> move onto n_task.task (output) -> release',
  measured: { mirrored: { d: mir.d, anchorX: mir.ax, c1x: mir.c1x, c1_minus_anchor: mir.c1x - mir.ax, cls: mir.cls }, snapped: { endX: snap.endX, endY: snap.endY, targetAnchor: snap.target, cls: snap.cls, chip: snap.chip }, committed },
  pass: mir.c1x < mir.ax && /legal/.test(snap.cls) && !/illegal/.test(snap.cls) && near(snap.endX, snap.target.x, 1e-9) && near(snap.endY, snap.target.y, 1e-9) && committed.count === 3 && committed.ghostIsLast,
});

// ================================================================ RUN D — item 6 illegal + reason chip
await load('D: illegal + chip');
const planD = await clientOfAnchor('n_agent', 'plan', 'out');
const endRes = await clientOfAnchor('n_end', 'result', 'in');
const agTask = await clientOfAnchor('n_agent', 'task', 'in');
await press(planD.x, planD.y); await settle('D-press');
await moveSettle(endRes.x, endRes.y, 1, 'left', 'D-over-end');
const ill1 = await ev(`(()=>{const c=document.getElementById('chip'),P=window.__proto;return {cls:P.ghost().getAttribute('class'),chipText:c.textContent,chipHidden:c.hidden,chipLeft:c.style.left,chipTop:c.style.top};})()`);
await moveSettle(agTask.x, agTask.y, 1, 'left', 'D-over-own-input');
const ill2 = await ev(`(()=>{const c=document.getElementById('chip'),P=window.__proto;return {cls:P.ghost().getAttribute('class'),chipText:c.textContent,chipHidden:c.hidden};})()`);
await up(agTask.x, agTask.y); await settle('D-up');
const afterIll = await ev(`(()=>{const P=window.__proto;return {wires:P.wires.length,gesture:P.gesture(),ghostCls:P.ghost().getAttribute('class'),chipHidden:document.getElementById('chip').hidden};})()`);
note(6, {
  what: 'press n_agent.plan -> hover n_end.result (already wired) -> hover n_agent.task (same node) -> release',
  measured: { overEndResult: ill1, overOwnInput: ill2, afterRelease: afterIll },
  pass: /illegal/.test(ill1.cls) && ill1.chipText === 'already connected' && ill1.chipHidden === false && /illegal/.test(ill2.cls) && ill2.chipText === 'same node' && afterIll.wires === 2 && afterIll.gesture === null && afterIll.chipHidden === true,
});

// ================================================================ RUN E — item 7 header buttons
await load('E: header buttons');
const save = boot.headEl;
const empty = await ev(`(()=>{const r=window.__proto.rect();return {x:r.left+180,y:r.top+500};})()`);
const before7 = await ev('({clicks:window.__proto.stats.headerClicks,T:window.__proto.transform()})');
await press(empty.x, empty.y); await settle('E-press');
await moveSettle(empty.x + 60, empty.y + 30, 1, 'left', 'E-drag');
await up(empty.x + 60, empty.y + 30); await settle('E-up');
const afterDrag7 = await ev('({clicks:window.__proto.stats.headerClicks,T:window.__proto.transform(),gesture:window.__proto.gesture()})');
await press(save.x, save.y); await up(save.x, save.y); await settle('E-click-save');
const afterClick7 = await ev('({clicks:window.__proto.stats.headerClicks,gesture:window.__proto.gesture(),st:document.getElementById("st").textContent})');
await press(empty.x, empty.y); await settle('E-press2');
await moveSettle(save.x, save.y, 1, 'left', 'E-move-over-button');
await up(save.x, save.y); await settle('E-up-over-button');
const afterCross7 = await ev('({clicks:window.__proto.stats.headerClicks,gesture:window.__proto.gesture(),stageCls:window.__proto.stage().className})');
note(7, {
  what: 'canvas pan drag -> trusted click on #btn-save -> press-on-canvas + release-over-#btn-save',
  measured: { saveButtonClient: save, clicksBefore: before7.clicks, T_before: { x: before7.T.x, y: before7.T.y }, T_afterDrag: { x: afterDrag7.T.x, y: afterDrag7.T.y }, clicksAfterDrag: afterDrag7.clicks, clicksAfterRealClick: afterClick7.clicks, headerChip: afterClick7.st, clicksAfterCrossRelease: afterCross7.clicks, gestureAfterCross: afterCross7.gesture, stageClass: afterCross7.stageCls },
  pass: afterClick7.clicks === before7.clicks + 1 && afterCross7.clicks === afterClick7.clicks && afterCross7.gesture === null && afterDrag7.T.x !== before7.T.x,
});

// ================================================================ RUN F — item 8 zoom about cursor + wheel pan
await load('F: zoom + wheel pan');
const zBefore = await ev('({T:window.__proto.transform(),w:window.__proto.toWorld(600,300),rect:window.__proto.rect()})');
await wheel(600, 300, 0, -120, 2); await settle('F-zoom');
const zAfter = await ev('({T:window.__proto.transform(),w:window.__proto.toWorld(600,300)})');
for (let i = 0; i < 12; i++) await wheel(600, 300, 0, -240, 2);
await settle('F-zmax');
const zMax = await ev('window.__proto.transform().z');
for (let i = 0; i < 30; i++) await wheel(600, 300, 0, 240, 2);
await settle('F-zmin');
const zMin = await ev('window.__proto.transform().z');
const pBefore = await ev('window.__proto.transform()');
await wheel(600, 300, 40, -25, 0); await settle('F-pan');
const pAfter = await ev('window.__proto.transform()');
note(8, {
  what: 'ctrl+wheel (modifiers:2) deltaY -120 at client(600,300); clamp probes; plain wheel deltaX 40 / deltaY -25',
  measured: {
    worldUnderCursorBefore: zBefore.w, worldUnderCursorAfter: zAfter.w,
    absDelta: { x: Math.abs(zAfter.w.x - zBefore.w.x), y: Math.abs(zAfter.w.y - zBefore.w.y) },
    zBefore: zBefore.T.z, zAfter: zAfter.T.z, zExpected: zBefore.T.z * Math.exp(0.24), zMaxClamp: zMax, zMinClamp: zMin,
    panBefore: { x: pBefore.x, y: pBefore.y }, panAfter: { x: pAfter.x, y: pAfter.y }, panDelta: { x: pAfter.x - pBefore.x, y: pAfter.y - pBefore.y },
  },
  pass: near(zAfter.w.x, zBefore.w.x, 1e-6) && near(zAfter.w.y, zBefore.w.y, 1e-6) && near(zAfter.T.z, zBefore.T.z * Math.exp(0.24), 1e-9)
     && zMax <= 1.6 + 1e-12 && zMin >= 0.4 - 1e-12 && near(pAfter.x - pBefore.x, -40, 1e-9) && near(pAfter.y - pBefore.y, 25, 1e-9),
});

// ================================================================ RUN G — item 9 node drag + Escape
await load('G: node drag');
const head = await clientOfWorld(510, 97);
const g0 = await ev(`(()=>{const P=window.__proto,dd={};for(const p of document.querySelectorAll('#wires path[data-wire-id]'))dd[p.dataset.wireId]=p.getAttribute('d');
 return {stats:{...P.stats},pos:{x:P.nodes[1].x,y:P.nodes[1].y},d:dd,tf:document.querySelector('[data-node-id="n_agent"]').style.transform};})()`);
await press(head.x, head.y); await settle('G-press');
const afterPressG = await ev(`(()=>{const P=window.__proto,g=P.gesture();return {gesture:g&&{type:g.type,id:g.id,grab:g.grab,start:g.start},cls:document.querySelector('[data-node-id="n_agent"]').className};})()`);
await ev(BURST_ARM(30, `clientX:${head.x}+3*i,clientY:${head.y}+2*i`));
const via9 = await settleFrames('G-burst');
const drag = await ev(BURST_READ);
await key('rawKeyDown', 'Escape', 'Escape', 27); await key('keyUp', 'Escape', 'Escape', 27);
await settle('G-escape');
const esc = await ev(`(()=>{const P=window.__proto,dd={};for(const p of document.querySelectorAll('#wires path[data-wire-id]'))dd[p.dataset.wireId]=p.getAttribute('d');
 return {gesture:P.gesture(),pos:{x:P.nodes[1].x,y:P.nodes[1].y},d:dd,tf:document.querySelector('[data-node-id="n_agent"]').style.transform,cls:document.querySelector('[data-node-id="n_agent"]').className};})()`);
await up(head.x + 90, head.y + 60);
const tfNums = nums(drag.tf);
const changed = Object.keys(g0.d).filter((k) => g0.d[k] !== drag.d[k]).sort().join();
note(9, {
  what: 'press n_agent header; 30 synthetic pointermove; one animation frame; then Escape mid-drag',
  measured: {
    gestureAfterPress: afterPressG.gesture, nodeClassAfterPress: afterPressG.cls, frameVia: via9,
    dFrames: drag.dFrames, dWireDUpdates: drag.dWireD, dRectReads: drag.dRect, gbcrCalls: drag.gbcr, dPointerMoves: drag.dMoves,
    posBefore: g0.pos, posDuring: drag.pos, transformDuring: drag.tf, transformMod11: tfNums.map((v) => v % 11),
    wireIds: Object.keys(g0.d), wiresWhoseDChanged: changed, wireDBefore: g0.d, wireDDuring: drag.d,
    afterEscape: { gesture: esc.gesture, pos: esc.pos, transform: esc.tf, cls: esc.cls, dRevertedToBaseline: JSON.stringify(esc.d) === JSON.stringify(g0.d) },
  },
  pass: drag.dFrames === 1 && drag.dWireD <= 2 * drag.dFrames && drag.dRect === 0 && drag.gbcr === 0 && drag.dMoves === 30
     && tfNums.length === 2 && tfNums.every((v) => v % 11 === 0) && changed === 'w1,w2'
     && esc.gesture === null && esc.pos.x === g0.pos.x && esc.pos.y === g0.pos.y && JSON.stringify(esc.d) === JSON.stringify(g0.d),
});

// supplementary: both w1 and w2 touch n_agent, so "incident wires ONLY" needs a node with a non-incident wire.
// n_task is incident to w1 only; w2 (n_agent.plan -> n_end.result) must not be repainted while n_task is dragged.
const tHead = await clientOfWorld(170, 160);
const t0b = await ev(`(()=>{const P=window.__proto,dd={};for(const p of document.querySelectorAll('#wires path[data-wire-id]'))dd[p.dataset.wireId]=p.getAttribute('d');return {d:dd,stats:{...P.stats},inc:[...(P.wires.filter(w=>w.from.node==='n_task'||w.to.node==='n_task').map(w=>w.id))]};})()`);
await press(tHead.x, tHead.y); await settle('G2-press');
await ev(BURST_ARM(20, `clientX:${tHead.x}+4*i,clientY:${tHead.y}-2*i`));
const via9b = await settleFrames('G2-burst');
const drag2 = await ev(BURST_READ);
await up(tHead.x + 80, tHead.y - 40); await settle('G2-up');
const changed2 = Object.keys(t0b.d).filter((k) => t0b.d[k] !== drag2.d[k]).sort().join();
note('9b', {
  what: 'supplementary: drag n_task (incident = w1 only); 20 synthetic pointermove; one animation frame',
  measured: { incidentWires: t0b.inc, frameVia: via9b, dFrames: drag2.dFrames, dWireDUpdates: drag2.dWireD, dRectReads: drag2.dRect, gbcrCalls: drag2.gbcr, dPointerMoves: drag2.dMoves, wiresWhoseDChanged: changed2, w2_unchanged: t0b.d.w2 === drag2.d.w2 },
  pass: drag2.dFrames === 1 && drag2.dWireD === 1 && changed2 === 'w1' && t0b.d.w2 === drag2.d.w2 && drag2.dRect === 0 && drag2.gbcr === 0,
});

// ================================================================ RUN H — item 10 middle / space pan + blur
await load('H: middle + space pan + blur');
const emptyH = await ev(`(()=>{const r=window.__proto.rect();return {x:r.left+180,y:r.top+500};})()`);
const cardH = await clientOfWorld(510, 97);
const t0 = await ev('window.__proto.transform()');
await press(emptyH.x, emptyH.y, 'middle'); await settle('H-mid-press');
const gMid = await ev('window.__proto.gesture()&&window.__proto.gesture().type');
await moveSettle(emptyH.x + 55, emptyH.y - 35, 4, 'middle', 'H-mid-move');
const tMid = await ev('window.__proto.transform()');
await up(emptyH.x + 55, emptyH.y - 35, 'middle'); await settle('H-mid-up');
await key('rawKeyDown', ' ', 'Space', 32);
const spaceCls = await ev('window.__proto.stage().className');
const posBeforeSpace = await ev('({x:window.__proto.nodes[1].x,y:window.__proto.nodes[1].y})');
const t1 = await ev('window.__proto.transform()');
await press(cardH.x, cardH.y); await settle('H-space-press');
const gSpace = await ev('window.__proto.gesture()&&window.__proto.gesture().type');
await moveSettle(cardH.x - 40, cardH.y + 25, 1, 'left', 'H-space-move');
const t2 = await ev('window.__proto.transform()');
await up(cardH.x - 40, cardH.y + 25); await settle('H-space-up');
await key('keyUp', ' ', 'Space', 32);
const posAfterSpace = await ev('({x:window.__proto.nodes[1].x,y:window.__proto.nodes[1].y,cls:window.__proto.stage().className})');
await press(emptyH.x, emptyH.y); await settle('H-blur-press');
const gLive = await ev('window.__proto.gesture()&&window.__proto.gesture().type');
const blur = await ev(`(()=>{window.dispatchEvent(new Event('blur'));const P=window.__proto;return {gesture:P.gesture(),stageCls:P.stage().className,ghostCls:P.ghost().getAttribute('class')};})()`);
await up(emptyH.x, emptyH.y);
note(10, {
  what: 'middle-button drag; space+drag starting ON a card; window blur mid-gesture',
  measured: {
    middle: { gestureType: gMid, tBefore: { x: t0.x, y: t0.y }, tAfter: { x: tMid.x, y: tMid.y }, delta: { x: tMid.x - t0.x, y: tMid.y - t0.y } },
    space: { stageClassWhileHeld: spaceCls, gestureType: gSpace, tBefore: { x: t1.x, y: t1.y }, tAfter: { x: t2.x, y: t2.y }, delta: { x: t2.x - t1.x, y: t2.y - t1.y }, nodePosBefore: posBeforeSpace, nodePosAfter: { x: posAfterSpace.x, y: posAfterSpace.y }, stageClassAfterKeyUp: posAfterSpace.cls },
    blur: { gestureTypeBeforeBlur: gLive, afterBlur: blur },
  },
  pass: gMid === 'pan' && tMid.x - t0.x === 55 && tMid.y - t0.y === -35 && /space/.test(spaceCls) && gSpace === 'pan'
     && t2.x - t1.x === -40 && t2.y - t1.y === 25 && posAfterSpace.x === posBeforeSpace.x && posAfterSpace.y === posBeforeSpace.y
     && gLive === 'pan' && blur.gesture === null && blur.stageCls === 'gv-stage',
});
} catch (e) { fatal = String(e && e.stack || e); log('FATAL: ' + fatal); }

const out = { chrome: version, protoPath: PROTO, wallMs: Date.now() - T0, fatal, console: console_log, settleFailures: settleReports.filter((r) => r.kicks === 'FAILED'), settleKickHistogram: settleReports.reduce((a, r) => (a[r.kicks] = (a[r.kicks] || 0) + 1, a), {}), results };
writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(out, null, 2));
log(`wall ${out.wallMs}ms; pass=${Object.values(results).filter((v) => v.pass).length}/${Object.keys(results).length}; console=${console_log.length}`);
try { proc.kill('SIGKILL'); } catch {}
process.exit(0);
