#!/usr/bin/env node
// scripts/verify-run-monitor-cdp.mjs — headless-Chrome proof of the RUN MONITOR
// (spec §8 / node-graph v2 P6): the `.run-flow.gv-host` reset on all three
// hosts, the Running card's 300px band, the footer bands against the SHARED
// nodeSize, the marching ants, the `N×` loop badge, the engaged-wheel nav, the
// chrome that must never cover a card title, the History End chip and the
// log-filter node axis. NOT part of `npm test`: it needs Chrome and a live
// server, and it drives a REAL mock pipeline end to end.
// Run: node scripts/verify-run-monitor-cdp.mjs   (or: npm run verify:run-monitor)
//
// -- CI COVERAGE (MAJ-30) ----------------------------------------------------
// .github/workflows/ci.yml job `cdp` runs this script on every push and every
// pull request. What remains CDP-only is every measurement and computed style
// jsdom cannot produce:
//   STILL CDP-ONLY
//     (1a)(1b)(1c) .gv-stage === the .run-flow-wrap padding box on all 3 hosts
//     (2)       the 300px band, node-box containment, 0.3 <= z <= 1
//     (3)       the 26/22px footer bands and offsetHeight === nodeSize()
//     (4a)(4b)  computed animationName on a live wire, live and under .settled
//     (5)       the COMPUTED font-size that hides the composer's <=N pill
//     (6)       stage-box stability across the wheel sequence
//     (7)       the measured .nrun / .ngate clearance of the title's em box
//     (console) the no-page-error gate
//   NOW ALSO IN test/
//     (4b) `.rd-graph.settled` live AND terminal -> test/ui-running-detail.test.mjs
//     (5) the <=N / Nx DOM split + the suppression RULES,
//     (6) the wheel preventDefault policy + the pan delta,
//     (7) both ornaments outside .nhead + their negative absolute offsets
//                                               -> test/ui-graph-interactions.test.mjs
//     (6) engage / disengage, (8)(8b) the End chip and the quiescence copy,
//     (9b) the .xrow log narrowing, and the (1*)(2)(3)(4a) CSS text and
//          band-count math                      -> test/ui-run-hosts.test.mjs
//     (9a) the node axis on the card bar        -> test/ui-log-filter-node-axis.test.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
const PORT = Number(process.env.CDP_PORT || 9334);
const FOOT_H = 26, EXEC_ROW_H = 22;   // geometry.mjs — re-asserted against the page's own import
const STATIC_HOST_H = 300;            // run-hosts.mjs STATIC_HOST_H (D5), the wrap's BORDER box
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let home = null; let proj = null; let profile = null; let failed = 0;
async function shutdown(code) {
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}            // kill Chrome on EVERY exit path
  try { if (srv) await new Promise((r) => srv.close(r)); } catch {}
  try { if (home) await rm(home, { recursive: true, force: true }); } catch {}
  try { if (proj) await rm(proj, { recursive: true, force: true }); } catch {}
  try { if (profile) await rm(profile, { recursive: true, force: true }); } catch {}
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a one-commit git project + the app server (the house pattern: env BEFORE
// the import). `server` — NOT http.createServer(app) — because the run monitor
// is fed by the WebSocket the app opens on the SAME port.
home = await mkdtemp(path.join(tmpdir(), 'worca-rm-home-'));
process.env.WORCA_HOME = home;
process.env.WORCA_MOCK = '1';
proj = await mkdtemp(path.join(tmpdir(), 'worca-rm-proj-'));
for (const a of [['init', '-q'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) {
  execFileSync('git', a, { cwd: proj });
}
await writeFile(path.join(proj, 'README.md'), '# run-monitor proof\n');
execFileSync('git', ['add', '-A'], { cwd: proj });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
const { server, runs } = await import(new URL('../ui/server.mjs', import.meta.url).href);
srv = server;
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
log(`server ${base} · project ${proj}`);
const api = async (p, opt) => {
  const r = await fetch(base + p, opt);
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
};

// ---- chrome + cdp
profile = await mkdtemp(path.join(tmpdir(), 'worca-rm-profile-'));
chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,900', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'],
{ stdio: ['ignore', 'pipe', 'pipe'] });
chrome.stderr.on('data', () => {});
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
/** Headless Chrome acks some input dispatches only once it produces a frame, and
 *  --headless=new emits BeginFrames on demand only — so a dispatch can sit
 *  unacked forever. Pump forced frames while one is in flight. */
function pumped(promise) {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  (async () => { for (let i = 0; i < 60 && !done; i += 1) { await kick(); if (!done) await sleep(50); } })();
  return promise;
}
const press = (x, y) => pumped(cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }));
const mup = (x, y) => pumped(cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }));
const mmove = (x, y) => pumped(cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0, clickCount: 0 }));
const click = async (x, y) => { await press(x, y); await mup(x, y); };
const keyEv = (type, k, code, vk) => cdp('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
const wheelRaw = (x, y, dx, dy, modifiers = 0) => pumped(cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy, modifiers, button: 'none' }));

// Wheel delivery, PROBED once (the composer script's idiom, extended). Measured
// 2026-08-28 on Chrome / macOS --headless=new: a CDP `mouseWheel` IS delivered,
// but as a NON-CANCELABLE event — preventDefault() is a no-op on it, so the
// browser scrolls the page underneath, `defaultPrevented` always reads false and
// every later client coordinate is off by the scroll. A synthetic WheelEvent on
// the stage is cancelable, triggers no default scroll, and runs the very same
// `createNav` listener over the very same layout — so it is the measurement path
// whenever the trusted event is not cancelable. `defaultPrevented` is what "the
// page scrolls / the canvas takes the wheel" reduces to, and only the synthetic
// path can report it.
let wheelMode = null;                   // 'trusted' | 'synthetic'
async function probeWheel(stageSel, x, y) {
  await ev(`window.__wheels=[];window.addEventListener('wheel',(e)=>{window.__wheels.push(
    {dx:e.deltaX,dy:e.deltaY,ctrl:e.ctrlKey,meta:e.metaKey,cancelable:e.cancelable,prevented:e.defaultPrevented});},false);0`);
  await mmove(x, y);
  await wheelRaw(x, y, 0, 0, 0);        // ZERO delta: the probe must not move anything
  await settle('wheel-probe');
  const seen = await ev('window.__wheels');
  wheelMode = seen.length && seen[seen.length - 1].cancelable ? 'trusted' : 'synthetic';
  log(`wheel delivery: ${wheelMode} (CDP wheels seen: ${seen.length}, cancelable: ${seen.length ? seen[seen.length - 1].cancelable : 'n/a'})`);
  await ev('window.__wheels=[];0');
}
/** One wheel over `stageSel` at client (x,y). Returns the event's
 *  `defaultPrevented` (both paths report it through the window listener). */
async function wheel(stageSel, x, y, dx, dy, ctrl = false) {
  if (wheelMode === null) await probeWheel(stageSel, x, y);
  await ev('window.__wheels=[];0');
  if (wheelMode === 'trusted') { await mmove(x, y); await wheelRaw(x, y, dx, dy, ctrl ? 2 : 0); }
  else {
    await ev(`(()=>{const st=document.querySelector(${JSON.stringify(stageSel)});
      st.dispatchEvent(new WheelEvent('wheel',{deltaX:${dx},deltaY:${dy},clientX:${x},clientY:${y},
        ctrlKey:${ctrl},bubbles:true,cancelable:true}));return 1;})()`);
  }
  await settle('wheel');
  const seen = await ev('window.__wheels');
  return seen.length ? seen[seen.length - 1].prevented : null;
}
function check(n, what, ok, detail) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} (${n}) ${what}${ok ? '' : `\n      ${JSON.stringify(detail)}`}`);
}

// ---- page helpers ----------------------------------------------------------
const R_FN = `const R=(e)=>{if(!e)return null;const b=e.getBoundingClientRect();return {l:+b.left.toFixed(2),t:+b.top.toFixed(2),r:+b.right.toFixed(2),b:+b.bottom.toFixed(2),w:+b.width.toFixed(2),h:+b.height.toFixed(2)};};`;
/** The stage box vs the wrap's PADDING box (border-box rect + clientLeft/Top, clientWidth/Height). */
const HOSTGEO = (wrapSel) => `(()=>{${R_FN}
  const wrap=document.querySelector(${JSON.stringify(wrapSel)});
  const host=wrap&&wrap.querySelector(':scope > .run-flow');
  const stage=host&&host.querySelector(':scope > .gv-stage');
  if(!stage)return {missing:true,wrapSel:${JSON.stringify(wrapSel)}};
  const wb=wrap.getBoundingClientRect();
  const pad={l:+(wb.left+wrap.clientLeft).toFixed(2),t:+(wb.top+wrap.clientTop).toFixed(2),
    w:+wrap.clientWidth.toFixed(2),h:+wrap.clientHeight.toFixed(2)};
  const world=host.querySelector('.gv-world');
  const m=new DOMMatrixReadOnly(getComputedStyle(world).transform);
  return {stage:R(stage),host:R(host),wrap:R(wrap),pad,scrollLeft:wrap.scrollLeft,
    hostInlineWidth:host.style.width||'',z:+m.a.toFixed(6),
    hostPos:getComputedStyle(host).position,hostPad:getComputedStyle(host).padding,
    hostDisplay:getComputedStyle(host).display};})()`;
/** Every node card's box, in STAGE-local coordinates, plus the stage box. */
const NODEBOXES = (wrapSel) => `(()=>{
  const stage=document.querySelector(${JSON.stringify(wrapSel)}+' .gv-stage');
  const s=stage.getBoundingClientRect();
  return {stage:{w:+s.width.toFixed(2),h:+s.height.toFixed(2)},
    nodes:[...stage.querySelectorAll('.gv-world .node')].map((el)=>{const b=el.getBoundingClientRect();
      return {id:el.dataset.nodeId,l:+(b.left-s.left).toFixed(2),t:+(b.top-s.top).toFixed(2),
        r:+(b.right-s.left).toFixed(2),b:+(b.bottom-s.top).toFixed(2)};})};})()`;
async function centreOf(sel) {
  const p = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;
    const b=e.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()`);
  if (!p) throw new Error(`no element for ${sel}`);
  return p;
}
/** Click an element's centre once its box has stopped moving. A footer expand
 *  runs paint -> refit -> a ResizeObserver pass on the wrap, which lands over
 *  several forced frames; clicking a point measured mid-flight misses. */
async function clickCentre(sel, tag = sel) {
  let last = null;
  for (let i = 0; i < 12; i += 1) {
    const p = await centreOf(sel);
    if (last && last.x === p.x && last.y === p.y) { await click(p.x, p.y); return p; }
    last = p;
    await settle(`stable ${tag}`);
  }
  throw new Error(`${tag} never stopped moving`);
}
async function go(hash, { first = false } = {}) {
  if (first) await cdp('Page.navigate', { url: `${base}/#${hash}` });
  else { await ev(`location.hash=${JSON.stringify(hash)};0`); await cdp('Page.reload', {}); }
  await waitEvent('Page.loadEventFired');
  for (let i = 0; i < 80; i += 1) { if (await ev('!!(window.__np && window.__np.getRun)')) break; await sleep(100); }
  await settle(`load ${hash}`);
}
/** Wait until `expr` is truthy, forcing frames (the app paints from rAF). */
async function until(expr, tag, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    if (await ev(`(()=>{try{return !!(${expr});}catch(e){return false;}})()`)) return true;
    await kick(); await sleep(120);
  }
  throw new Error(`timeout waiting for ${tag}`);
}

try {
  // ---- drive a REAL v2 mock pipeline; hold it at the clarify question --------
  const started = await api('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectDir: proj, prompt: 'add a flag', workflowId: 'wf_default', mock: true }) });
  if (started.status !== 200) throw new Error(`POST /api/run -> ${started.status} ${JSON.stringify(started.body)}`);
  const runId = started.body.runId;
  const entry = runs.get(runId);
  for (let i = 0; i < 400 && !entry.pendingQuestion; i += 1) await sleep(100);
  if (!entry.pendingQuestion) throw new Error('the mock run never reached the clarify question');
  log(`run ${runId} holding at ${entry.pendingQuestion.id} (status ${entry.status})`);

  // ================ PHASE 1 — the LIVE run (Running page) ====================
  const CARD_ROOT = `#run-list .run-card[data-run-id=${JSON.stringify(runId)}]`;
  const CARD = `${CARD_ROOT} .rc-detailed .run-flow-wrap`;
  await go('running', { first: true });
  await until(`document.querySelector(${JSON.stringify(CARD)}+' .gv-stage .gv-world .node')`, 'the live card graph');
  await settle('card');

  // (1a) the static host reset
  const g1 = await ev(HOSTGEO(CARD));
  check('1a', 'Running card: .gv-stage === the .run-flow-wrap padding box (the .run-flow.gv-host reset)',
    !g1.missing && Math.abs(g1.stage.t - g1.pad.t) < 0.6 && Math.abs(g1.stage.h - g1.pad.h) < 0.6
    && Math.abs(g1.stage.l - (g1.pad.l - g1.scrollLeft)) < 0.6
    && Math.abs(g1.stage.w - Math.max(g1.pad.w, parseFloat(g1.hostInlineWidth) || 0)) < 0.6
    && g1.hostPos === 'absolute' && g1.hostPad === '0px' && g1.hostDisplay === 'block', g1);

  // (2) the 300px band, every node inside the stage, 0.3 ≤ z ≤ 1
  const boxes = await ev(NODEBOXES(CARD));
  const inside = boxes.nodes.every((n) => n.l >= -0.6 && n.t >= -0.6
    && n.r <= boxes.stage.w + 0.6 && n.b <= boxes.stage.h + 0.6);
  check(2, `Running card: the wrap is ${STATIC_HOST_H}px tall, every node box is inside the stage, 0.3 ≤ z ≤ 1`,
    Math.abs(g1.wrap.h - STATIC_HOST_H) < 0.6 && boxes.nodes.length > 1 && inside
    && g1.z >= 0.3 - 1e-9 && g1.z <= 1 + 1e-9,
    { wrapBorderBoxH: g1.wrap.h, wrapPaddingBoxH: g1.pad.h, z: g1.z, stage: boxes.stage, nodes: boxes.nodes });

  // (9a) the node axis is live on the card bar, with MANIFEST labels
  const axis = await ev(`(()=>{const sel=document.querySelector(${JSON.stringify(CARD_ROOT)}+' .log-filters .log-f-step');
    return {axis:sel.dataset.axis,aria:sel.getAttribute('aria-label'),opts:[...sel.options].map((o)=>o.textContent)};})()`);
  check('9a', 'the card bar re-purposes .log-f-step as the node select (data-axis="node", manifest labels)',
    axis.axis === 'node' && axis.aria === 'Filter by node'
    && axis.opts[0] === 'all nodes' && axis.opts.includes('Clarify'), axis);

  // ---- the Running DETAIL (a monitor host) ---------------------------------
  const RD = '#run-detail .rd-graph .run-flow-wrap';
  await go(`running/${runId}`);
  await until(`document.querySelector('${RD} .gv-stage .gv-world .node')`, 'the detail graph');
  await ev('window.scrollTo(0,0);0'); await settle('detail');

  // (1b) the monitor host reset
  const g2 = await ev(HOSTGEO(RD));
  check('1b', 'Running detail: .gv-stage === the .run-flow-wrap padding box',
    !g2.missing && Math.abs(g2.stage.t - g2.pad.t) < 0.6 && Math.abs(g2.stage.h - g2.pad.h) < 0.6
    && Math.abs(g2.stage.l - g2.pad.l) < 0.6 && Math.abs(g2.stage.w - g2.pad.w) < 0.6
    && g2.hostPos === 'absolute' && g2.hostPad === '0px' && g2.hostDisplay === 'block', g2);

  // (4a) ants: the in-flight execution's trigger wire marches. The animation lives
  // ON THE PATH (the :root clock is retired — it forced a whole-document style
  // recalc per frame); phase parity comes from setWireLive's negative
  // animation-delay stamp, so the path's own animationName is the dash keyframe
  // and :root animates nothing.
  const antsAt = () => ev(`(()=>{const p=document.querySelector('${RD} .gv-wires path.wire-live');
    if(!p)return {none:true};const cs=getComputedStyle(p);
    return {wireId:p.dataset.wireId,animationName:cs.animationName,
      strokeDasharray:cs.strokeDasharray,strokeDashoffset:cs.strokeDashoffset,
      clock:getComputedStyle(document.documentElement).animationName,
      settled:document.querySelector('#run-detail .rd-graph').classList.contains('settled')};})()`);
  const ants = await antsAt();
  await sleep(250);
  const ants2 = await antsAt();
  check('4a', 'a live run marches its trigger wire per path (animationName "wireDash", :root clock gone, phase moving)',
    !ants.none && !ants2.none && ants.animationName === 'wireDash' && ants.clock === 'none'
    && ants.strokeDashoffset !== ants2.strokeDashoffset && ants.settled === false, { ants, ants2 });

  // (6) the engaged wheel (D8). FIRST on this screen, while nothing has scrolled
  // or clicked: `createNav` zooms about `view`'s ONE cached rect, which is
  // re-read on fit and on the wrap's ResizeObserver — never on a scroll — so a
  // measurement taken after a scrollIntoView would read a stale origin as drift.
  const S = () => ev(`(()=>{const b=document.querySelector('${RD} .gv-stage').getBoundingClientRect();
    const m=new DOMMatrixReadOnly(getComputedStyle(document.querySelector('${RD} .gv-world')).transform);
    return {l:+b.left.toFixed(2),t:+b.top.toFixed(2),w:+b.width.toFixed(2),h:+b.height.toFixed(2),
      T:{x:+m.e.toFixed(4),y:+m.f.toFixed(4),z:+m.a.toFixed(6)}};})()`);
  const worldAt = (cx, cy) => ev(`(()=>{const st=document.querySelector('${RD} .gv-stage').getBoundingClientRect();
    const m=new DOMMatrixReadOnly(getComputedStyle(document.querySelector('${RD} .gv-world')).transform);
    return {x:+((${cx}-st.left-m.e)/m.a).toFixed(4),y:+((${cy}-st.top-m.f)/m.a).toFixed(4)};})()`);
  const engagedNow = () => ev(`document.querySelector('${RD}').classList.contains('rg-engaged')`);
  const s0 = await S();
  const wx = Math.round(s0.l + s0.w / 2);
  const wy = Math.round(s0.t + s0.h / 2);
  await probeWheel(`${RD} .gv-stage`, wx, wy);
  // (a) ⌘/Ctrl+wheel zooms about the cursor with NO click at all
  const engagedA = await engagedNow();
  const w0 = await worldAt(wx, wy);
  const preventedZ = await wheel(`${RD} .gv-stage`, wx, wy, 0, -120, true);
  const sZoom = await S();
  const w1 = await worldAt(wx, wy);
  // (b) a plain wheel while disengaged is left to the PAGE
  const prevented0 = await wheel(`${RD} .gv-stage`, wx, wy, 0, 120, false);
  const sIdle = await S();
  const engagedB = await engagedNow();
  // (c) a TRUSTED press on empty canvas engages the nav; the plain wheel then pans
  const emptyPt = await ev(`(()=>{const st=document.querySelector('${RD} .gv-stage');const s=st.getBoundingClientRect();
    const boxes=[...st.querySelectorAll('.gv-world .node')].map((e)=>e.getBoundingClientRect());
    for(let y=s.bottom-12;y>s.top;y-=6){for(let x=s.left+8;x<s.right-8;x+=13){
      if(boxes.every((b)=>x<b.left-2||x>b.right+2||y<b.top-2||y>b.bottom+2))return {x:Math.round(x),y:Math.round(y)};}}
    return null;})()`);
  if (!emptyPt) throw new Error('no empty point inside the monitor stage');
  await click(emptyPt.x, emptyPt.y); await settle('engage');
  const engagedC = await engagedNow();
  const sEngaged = await S();
  const prevented1 = await wheel(`${RD} .gv-stage`, wx, wy, 40, -25, false);
  const sPan = await S();
  // (d) Escape releases the engagement
  await keyEv('rawKeyDown', 'Escape', 'Escape', 27); await keyEv('keyUp', 'Escape', 'Escape', 27);
  await settle('escape');
  const engagedD = await engagedNow();
  const stable = [sZoom, sIdle, sEngaged, sPan].every((s) => Math.abs(s.l - s0.l) < 0.6 && Math.abs(s.t - s0.t) < 0.6);
  check(6, `engaged wheel: ⌘/Ctrl+wheel zooms about the cursor with no click, a plain wheel is left to the page until a trusted press engages the stage, then pans by (−dx,−dy); Escape releases [${wheelMode} wheels]`,
    stable
    && engagedA === false && preventedZ === true && sZoom.T.z > s0.T.z
    && Math.abs(w1.x - w0.x) < 0.01 && Math.abs(w1.y - w0.y) < 0.01
    && prevented0 === false && engagedB === false
    && Math.abs(sIdle.T.x - sZoom.T.x) < 1e-6 && Math.abs(sIdle.T.y - sZoom.T.y) < 1e-6
    && engagedC === true
    && prevented1 === true && Math.abs(sPan.T.x - sEngaged.T.x + 40) < 1e-6
    && Math.abs(sPan.T.y - sEngaged.T.y - 25) < 1e-6 && Math.abs(sPan.T.z - sEngaged.T.z) < 1e-9
    && engagedD === false,
    { stage: [s0, sZoom, sIdle, sEngaged, sPan], world: [w0, w1],
      engaged: [engagedA, engagedB, engagedC, engagedD], prevented: [preventedZ, prevented0, prevented1] });

  // (9b) a footer-row click narrows the log to ONE execution, on BOTH bars.
  // Reload first: check (6) left the view panned and zoomed, and the Escape leg
  // re-lays the shell out — a fresh screen puts every card back under its fit.
  await go(`running/${runId}`);
  await until(`document.querySelector('${RD} .gv-stage .gv-world .node[data-node-id="n_clarify"] .xtoggle')`, 'the clarify strip');
  await clickCentre(`${RD} .gv-world .node[data-node-id="n_clarify"] .xtoggle`, 'clarify strip');
  await settle('expand');
  await until(`document.querySelector('${RD} .gv-world .node[data-node-id="n_clarify"] .xrow')`, 'the clarify exec row');
  await clickCentre(`${RD} .gv-world .node[data-node-id="n_clarify"] .xrow`, 'clarify exec row');
  await settle('row-click');
  const chips = await ev(`(()=>{const d=document.querySelector('#run-detail .rd-sec-logs .log-f-exec');
    const c=document.querySelector(${JSON.stringify(CARD_ROOT)}+' .log-f-exec');
    const r=window.__np.getRun(${JSON.stringify(runId)});
    return {detail:{hidden:d.hidden,text:d.querySelector('.lfe-text').textContent,id:d.dataset.executionId},
      card:{hidden:c.hidden,text:c.querySelector('.lfe-text').textContent,id:c.dataset.executionId},
      filter:{node:r.logFilter.node,execution:r.logFilter.execution},
      nodeSelect:document.querySelector('#run-detail .rd-sec-logs .log-f-step').value,
      visible:[...document.querySelectorAll('#run-detail .rd-sec-logs .log .log-line')].length};})()`);
  check('9b', 'an .xrow click narrows the log to `Label #ordinal` on BOTH the detail bar and the card bar',
    chips.detail.hidden === false && chips.detail.text === 'Clarify #1' && chips.detail.id === 'x:n_clarify:1'
    && chips.card.hidden === false && chips.card.text === 'Clarify #1' && chips.card.id === 'x:n_clarify:1'
    && chips.nodeSelect === 'n_clarify'
    && chips.filter.execution === 'x:n_clarify:1' && chips.filter.node === 'n_clarify', chips);

  // ================ PHASE 2 — answer, finish, settle =========================
  const q = entry.pendingQuestion;
  await api('/api/answer', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId, id: q.id, payload: { answers: (q.questions || []).map((x) => ({ id: x.id, text: 'yes' })) } }) });
  for (let i = 0; i < 900 && !['done', 'error', 'stopped', 'aborted', 'failed', 'paused'].includes(entry.status); i += 1) await sleep(200);
  log(`run finished: ${entry.status} · pipeline ${entry.pipelineId}`);
  if (entry.status !== 'done') throw new Error(`the mock run ended ${entry.status}, not done`);
  await until(`document.querySelector('#run-detail .rd-graph').classList.contains('settled')`, '.rd-graph.settled');
  await settle('settled');

  // (4b) the settled override kills the ants. A terminal bag marks NO wire live
  // (decor.liveWireIds is empty once resolved), so tag one the way
  // view.setWireLive would and read what the cascade gives it.
  const settledAnts = await ev(`(()=>{const g=document.querySelector('#run-detail .rd-graph');
    const liveBefore=g.querySelectorAll('.gv-wires path.wire-live').length;
    const p=g.querySelector('.gv-wires path[data-wire-id]');
    p.classList.add('wire-live');
    const cs=getComputedStyle(p);
    const out={settled:g.classList.contains('settled'),liveBefore,animationName:cs.animationName,
      strokeDasharray:cs.strokeDasharray,strokeDashoffset:cs.strokeDashoffset};
    p.classList.remove('wire-live');return out;})()`);
  check('4b', 'under .rd-graph.settled a live wire is pinned still (animationName "none", offset 0px)',
    settledAnts.settled === true && settledAnts.liveBefore === 0 && settledAnts.animationName === 'none'
    && settledAnts.strokeDashoffset === '0px', settledAnts);

  // ---- the History detail --------------------------------------------------
  const hist = await api('/api/history');
  const rec = (hist.body.pipelines || []).find((p) => p.id === entry.pipelineId);
  if (!rec) throw new Error(`pipeline ${entry.pipelineId} is not in /api/history`);
  const HD = '#hist-detail .hd-graph .run-flow-wrap';
  await go(`history/${rec.projectKey}/${rec.id}`);
  await until(`document.querySelector('${HD} .gv-stage .gv-world .node')`, 'the History graph');
  await ev('window.scrollTo(0,0);0'); await settle('history');
  await ev(`(async()=>{const r=await fetch('/api/history/${rec.projectKey}/${rec.id}');
    window.__histState=(await r.json()).state;return 1;})()`);

  // (1c) the History host reset
  const g3 = await ev(HOSTGEO(HD));
  check('1c', 'History detail: .gv-stage === the .run-flow-wrap padding box',
    !g3.missing && Math.abs(g3.stage.t - g3.pad.t) < 0.6 && Math.abs(g3.stage.h - g3.pad.h) < 0.6
    && Math.abs(g3.stage.l - g3.pad.l) < 0.6 && Math.abs(g3.stage.w - g3.pad.w) < 0.6
    && g3.hostPos === 'absolute' && g3.hostPad === '0px' && g3.hostDisplay === 'block', g3);

  // (3) footer bands + the SHARED nodeSize, before and after expanding a strip.
  // The expected height is recomputed IN THE PAGE from the served
  // src/shared/graph modules — the same nodeSize()/portsOf() the renderer calls,
  // not a copy of the closed form.
  const SIZES = `(async()=>{
    const geo=await import('/src/shared/graph/geometry.mjs');
    const man=await import('/src/shared/graph/manifest.mjs');
    const ports=await import('/src/shared/graph/ports.mjs');
    const st=window.__histState;
    const tpl=man.manifestTemplate(st.stepper);
    const pf=man.manifestPortsFn(st.stepper);
    const out=[];
    for(const el of document.querySelectorAll('${HD} .gv-world .node')){
      const node=tpl.nodes.find((n)=>n.id===el.dataset.nodeId);
      const bands=[...el.querySelectorAll(':scope > .xfoot > *')];
      const want=geo.nodeSize(node,ports.portsOf(pf,node),{footerRows:bands.length}).h;
      out.push({id:node.id,offsetHeight:el.offsetHeight,styleHeight:el.style.height,want,bands:bands.length,
        bandH:bands.map((b,i)=>({cls:b.className,first:i===0,h:+getComputedStyle(b).height.replace('px','')}))});
    }
    return {FOOT_H:geo.FOOT_H,EXEC_ROW_H:geo.EXEC_ROW_H,cards:out};})()`;
  const s1 = await ev(SIZES);
  await clickCentre(`${HD} .gv-world .node[data-node-id="n_review"] .xtoggle`, 'review strip');
  await settle('hd-expand');
  await until(`document.querySelector('${HD} .gv-world .node[data-node-id="n_review"] .xrow')`, 'the review exec rows');
  const s2 = await ev(SIZES);
  const bands = [...s1.cards, ...s2.cards].flatMap((c) => c.bandH);
  const strips = bands.filter((b) => /(^|\s)(xtoggle|fan|xresult)(\s|$)/.test(b.cls));
  const rows = bands.filter((b) => /(^|\s)xrow(\s|$)/.test(b.cls));
  // style.css bills the footer the way nodeSize does (since f332d12c): the FIRST
  // band is the tall --gv-foot-h line, every later .fan/.xtoggle/.xresult is one
  // --gv-exec-row-h line, and a wrapped fan (.f2) adds one more exec line.
  const stripWant = (b) => (b.first ? FOOT_H : EXEC_ROW_H) + (/(^|\s)f2(\s|$)/.test(b.cls) ? EXEC_ROW_H : 0);
  check(3, `footer bands: the first .xtoggle/.fan/.xresult is ${FOOT_H}px, later strips and .xrow ${EXEC_ROW_H}px; every card's offsetHeight === nodeSize() before AND after expanding a strip`,
    s1.FOOT_H === FOOT_H && s1.EXEC_ROW_H === EXEC_ROW_H
    && bands.some((b) => /(^|\s)fan(\s|$)/.test(b.cls)) && bands.some((b) => /xtoggle/.test(b.cls))
    && strips.every((b) => Math.abs(b.h - stripWant(b)) < 0.01)
    && rows.length >= 2 && rows.every((b) => Math.abs(b.h - EXEC_ROW_H) < 0.01)
    // `offsetHeight` is an INTEGER, and nodeSize() lands on a .5 (PAD_T 8.5 +
    // 2×BORDER 1.5) — so the exact equality is on the height the renderer WRITES
    // (`el.style.height`), and offsetHeight is checked as its rounding.
    && s1.cards.every((c) => c.styleHeight === `${c.want}px` && Math.abs(c.offsetHeight - c.want) <= 0.5)
    && s2.cards.every((c) => c.styleHeight === `${c.want}px` && Math.abs(c.offsetHeight - c.want) <= 0.5)
    && s2.cards.some((c) => c.bands > s1.cards.find((x) => x.id === c.id).bands),
    { strips: strips.slice(0, 5), rows: rows.slice(0, 3),
      before: s1.cards.map((c) => [c.id, c.bands, c.offsetHeight, c.styleHeight, c.want]),
      after: s2.cards.map((c) => [c.id, c.bands, c.offsetHeight, c.styleHeight, c.want]) });

  // (5) the loop badge shows ONLY `N×` (the composer's `≤N` pill is font-size:0)
  const badges = await ev(`(()=>[...document.querySelectorAll('${HD} .gv-world .wbadge')].map((b)=>{
    const f=b.querySelector('.wfired');const cb=getComputedStyle(b);
    return {wireId:b.dataset.wireId,badgeText:b.textContent,badgeFontSize:cb.fontSize,badgeDisplay:cb.display,
      fired:f?f.textContent:null,firedFontSize:f?getComputedStyle(f).fontSize:null,
      firedVisible:!!(f&&f.getClientRects().length)};}))()`);
  const fired = badges.filter((b) => b.fired);
  check(5, 'the loop badge renders ONLY the N× delivery count (the ≤N budget pill is font-size:0)',
    badges.length >= 1 && fired.length >= 1
    && fired.every((b) => b.badgeFontSize === '0px' && b.badgeDisplay !== 'none'
      && /^\d+×$/.test(b.fired) && b.firedVisible && parseFloat(b.firedFontSize) > 0
      && b.badgeText.startsWith('≤')), badges);

  // (7) header ornaments never cover a card title. The `.nrun` duration·cost
  // pills are the run's own; this workflow holds no wire gate, so the `.ngate`
  // pip is painted through the app's OWN decor path (paintGraphFor + a `gate` on
  // the bag) onto the real History host — real CSS, real layout.
  await ev(`(async()=>{const rd=await import('/graph/run-decor.mjs');
    const st=window.__histState;
    const host=document.querySelector('${HD} .run-flow');
    const d=rd.decorFromState(st,{live:false,now:0,subsOf:(id)=>window.__np.subAgentsForNode(st,id)});
    d.gate={nodeId:'n_review',wireId:'w9'};
    window.__np.paintGraphFor(host,st.stepper,Object.assign(d,
      {run:st,runId:${JSON.stringify(rec.id)},mode:'monitor',record:${JSON.stringify(rec)}}));
    return 1;})()`);
  await settle('gate-paint');
  const chrome7 = await ev(`(()=>{
    const out=[];
    for(const el of document.querySelectorAll('${HD} .gv-world .node')){
      const tt=el.querySelector(':scope > .nhead .tt');
      if(!tt)continue;
      // offset* is UNSCALED and relative to the .node (its offsetParent for both
      // the absolutely-positioned ornaments and the static title span), so the
      // whole comparison is in real CSS pixels, free of the world transform.
      const fs=parseFloat(getComputedStyle(tt).fontSize);
      const line={t:tt.offsetTop,b:tt.offsetTop+tt.offsetHeight,l:tt.offsetLeft,r:tt.offsetLeft+tt.offsetWidth};
      const em={t:line.t+(tt.offsetHeight-fs)/2,b:line.t+(tt.offsetHeight+fs)/2,l:line.l,r:line.r};
      for(const sel of ['.nrun','.ngate']){
        const orn=el.querySelector(':scope > '+sel);
        if(!orn)continue;
        const a={t:orn.offsetTop,b:orn.offsetTop+orn.offsetHeight,l:orn.offsetLeft,r:orn.offsetLeft+orn.offsetWidth};
        const xOverlap=Math.max(0,Math.min(a.r,line.r)-Math.max(a.l,line.l));
        out.push({node:el.dataset.nodeId,orn:sel,ornBox:a,lineBox:line,fontSize:fs,
          xOverlapPx:+xOverlap.toFixed(2),
          lineBoxOverlapPx:+(xOverlap>0?Math.max(0,Math.min(a.b,line.b)-Math.max(a.t,line.t)):0).toFixed(2),
          emBoxOverlapPx:+(xOverlap>0?Math.max(0,Math.min(a.b,em.b)-Math.max(a.t,em.t)):0).toFixed(2)});
      }
    }
    return out;})()`);
  const worstLine = Math.max(0, ...chrome7.map((o) => o.lineBoxOverlapPx));
  check(7, `no chrome overlap: .nrun / .ngate clear the title's em box on every card (worst line-box encroachment ${worstLine}px of leading, 0px of glyph)`,
    chrome7.length >= 2 && chrome7.some((o) => o.orn === '.ngate') && chrome7.some((o) => o.orn === '.nrun')
    && chrome7.every((o) => o.emBoxOverlapPx === 0),
    chrome7.filter((o) => o.emBoxOverlapPx > 0).length ? chrome7.filter((o) => o.emBoxOverlapPx > 0) : chrome7.slice(0, 4));

  // (8) History header End chip
  const head = await ev(`(()=>{const m=document.querySelector('#hist-detail .hd-meta .hd-result');
    return {text:m?m.textContent:null,endReached:window.__histState.endReached,
      result:window.__histState.result,
      endCardResult:(document.querySelector('${HD} .gv-world .node[data-node-id="n_end"] .xresult')||{}).textContent||null,
      warn:!!document.querySelector('#hist-detail .hd-banners .run-warn:not([hidden])'),
      ovNote:(document.querySelector('#hist-detail .hd-ov-note')||{}).textContent||null};})()`);
  check(8, 'History header meta carries the End chip (— completed) for a run that reached End, and no quiescence banner',
    head.endReached === true && head.text === '— completed' && head.endCardResult === '— completed'
    && head.warn === false && head.ovNote === null, head);
  // The seeded run REACHES End, so there is no quiescence banner on it. Prove the
  // copy where it lives instead: paint a quiescent bag into the REAL .hd-banners
  // through the app's own painter and read the rendered text back.
  const quiet = await ev(`(()=>{const host=document.querySelector('#hist-detail .hd-banners');
    window.__np.paintQuiescenceBanner(host,{quiescent:true});
    const el=host.querySelector(':scope > .run-warn');
    const out={text:el.textContent,hidden:el.hidden,display:getComputedStyle(el).display,
      background:getComputedStyle(el).backgroundColor};
    window.__np.paintQuiescenceBanner(host,{quiescent:false});
    out.afterHidden=host.querySelector(':scope > .run-warn').hidden;return out;})()`);
  check('8b', 'n/a: this run reached End — the quiescence copy is proven by painting a quiescent bag into the real .hd-banners',
    head.endReached === true && quiet.hidden === false && quiet.display !== 'none'
    && quiet.text === 'finished at quiescence — End not reached' && quiet.afterHidden === true, quiet);

  check('console', 'no page errors or exceptions', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  failed += 1;
  console.log(`FAIL (fatal) ${e && e.stack ? e.stack : e}`);
}
console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`} — ${((Date.now() - T0) / 1000).toFixed(1)}s`);
await shutdown(failed === 0 ? 0 : 1);
