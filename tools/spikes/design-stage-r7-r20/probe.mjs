// tools/spikes/design-stage-r7-r20/probe.mjs — Design P4 Task 1 (risks R7 and R20): does the overlay keep up with a
// scrolling sandboxed frame, and what do `vh` units do when the camera sizes the frame to `stageH / scale`?
// Standalone: node:http, playwright-core, and Chrome from findChrome(). manual: needs a real browser, not part of
// npm test (M14).
//
//   node tools/spikes/design-stage-r7-r20/probe.mjs --browser chromium|firefox|webkit
//
// Prints `ok|FAIL <id> <detail>` per check after `#` header lines. Exit 0 when every row is ok, 1 on any FAIL.
//
// The parent page `/` holds the stage (1091 x 900, the well colour) with `.frame-box` (`position:absolute;
// transform-origin:0 0`, `translate(ox,0) scale(s)`, 1280 px wide, `viewH` tall) holding a `sandbox="allow-scripts"`
// iframe and `.overlay-doc`. The overlay is translated by `-scrollX,-scrollY` on each posted `rects` and holds the
// markers. The frame posts `rects` from one animation-frame flag on `scroll`, `resize` and a ResizeObserver, as P3's
// bridge does. The frame page has sections `A` (`height:100vh`), `B` (`height:clamp(480px,60vh,800px)`) and `C`
// (`height:600px`), then a striped filler for scroll travel.
import http from 'node:http';
import { inflateSync } from 'node:zlib';
import { chromium, firefox, webkit } from 'playwright-core';
import { findChrome } from '../../../assets/deck-preview/chrome.mjs';

const VIEWPORT = { width: 1280, height: 1000 };
const STAGE = { left: 20, top: 20, w: 1091, h: 900 };
const PAGE_W = 1280;
const FIT = STAGE.w / PAGE_W;                 // 0.8523: the frame at fit is 900 / FIT = 1056 px tall
const FLOOR = 0.45;                            // CAMERA_MIN: the frame at the floor is 900 / 0.45 = 2000 px tall
const EFFECTIVE_H = STAGE.h - 96 - 2 * 14;     // 776: stageH minus the HUD band and 14 px of padding each side (L4.22)
const R7_SPEED = 2000;                         // px/s of document scroll; the step per frame comes from the frame's own rate
const R7_FRAMES = 120;
const R7_WARMUP = 10;
const R7_SHOTS = 12;
const R7_PASS_FRAMES = 1.5;                    // "at most about one frame of travel", in the parent's (the screen's) frames
const RATE_FRAMES = 21;
const CLICK = { x: STAGE.left + 500, y: STAGE.top + 450 };
const BAND_GAP = 400;
const REFLOW_HEIGHTS = [1056, 2000, 1056];
const EASE_MS = 400;
const EASE_STEPS = 24;                         // 25 samples, one per 16.7 ms frame of the 400 ms ease
const TWEEN_Y = 3000;
const TWEEN_MS = 400;
const TWEEN_PASS_MS = 450;
const CREW_EXTRAS = [['c1'], [], ['c1'], ['c1', 'c2'], ['c2'], [], ['c1'], []];
const HARD_LIMIT_MS = 240000;
const PAGE_WAIT_MS = 30000;

const WELL = [255, 0, 170];
const BAND = [0, 160, 0];
const MARK = [0, 0, 255];
const SECTION_BG = ['rgb(222,230,245)', 'rgb(245,232,214)', 'rgb(232,226,245)', 'rgb(245,226,230)', 'rgb(226,240,238)', 'rgb(238,238,226)'];

const ABC = [['A', 'height:100vh'], ['B', 'height:clamp(480px,60vh,800px)'], ['C', 'height:600px']];
const PAGES = {
  abc: { secs: ABC, bands: 60 },
  smooth: { secs: ABC, bands: 60, smooth: true },
  vh2: { secs: [['nav', 'height:80px'], ['h1', 'height:100vh'], ['h2', 'height:100vh'], ['c1', 'height:300px'], ['c2', 'height:300px'], ['foot', 'height:300px']] },
  vh1: { secs: [['nav', 'height:80px'], ['h1', 'height:100vh'], ['c1', 'height:300px'], ['c2', 'height:300px'], ['foot', 'height:300px']] },
  kit: { secs: [['nav', 'height:80px'], ['h1', 'height:clamp(480px,60vh,800px)'], ['c1', 'height:300px'], ['c2', 'height:300px'], ['foot', 'height:300px']] },
};

/* The two functions below run in the browser; they are inlined with Function.prototype.toString and use nothing
 * from this module's scope. */

function frameMain(cfg) {
  const post = (m) => parent.postMessage(m, '*');
  const abs = (t) => performance.timeOrigin + t;
  const docRect = (el) => {
    const r = el.getBoundingClientRect();
    return [r.left + scrollX, r.top + scrollY, r.width, r.height];
  };
  let queued = false;
  const sendRects = () => {
    queued = false;
    post({
      t: 'rects', page: cfg.page, scrollX, scrollY, vw: innerWidth, vh: innerHeight,
      docH: document.documentElement.scrollHeight,
      sections: [...document.querySelectorAll('[data-section]')].map((el) => ({ id: el.dataset.section, rect: docRect(el) })),
      bands: [...document.querySelectorAll('[data-band]')].map((el) => docRect(el)[1]),
    });
  };
  // `rects` at most once per animation frame, however many scrolls, resizes and observations ask for it.
  const requestRects = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sendRects);
  };
  addEventListener('scroll', requestRects, { passive: true });
  addEventListener('resize', requestRects);
  const ro = new ResizeObserver(requestRects);
  ro.observe(document.documentElement);
  document.querySelectorAll('[data-section]').forEach((el) => ro.observe(el));

  const go = (y, behavior = 'instant') => scrollTo({ top: y, left: 0, behavior });
  let drive = null;

  // R7: scroll by a fixed step every animation frame and log what each frame set.
  function startDrive(d) {
    const run = { stop: false, log: [] };
    drive = run;
    let y = d.from;
    let n = 0;
    go(y);
    const tick = (ts) => {
      if (run.stop || (d.frames && n >= d.frames)) {
        drive = null;
        post({ t: 'drive-log', log: run.log });
        return;
      }
      y += d.step;
      go(y);
      run.log.push([abs(ts), scrollY]);
      n += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // The camera's scroll (L4.27): a rAF tween capped at `ms`, with a timer landing the end.
  function tween(d) {
    const t0 = performance.now();
    const y0 = scrollY;
    const steps = [];
    let landed = false;
    let endMs = null;
    const ease = (p) => 1 - (1 - p) ** 3;
    const check = () => { if (endMs === null && Math.abs(scrollY - d.y) < 1) endMs = performance.now() - t0; };
    const watch = () => {
      const until = performance.now() + 2000;
      const poll = () => {
        check();
        if (endMs !== null || performance.now() > until) {
          post({ t: 'tween-done', behavior: d.behavior, endMs, steps, finalY: scrollY, smooth: getComputedStyle(document.documentElement).scrollBehavior });
        } else requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    };
    let timer = 0;
    const land = () => {
      if (landed) return;
      landed = true;
      clearTimeout(timer);
      go(d.y, d.behavior);
      check();
      watch();
    };
    timer = setTimeout(land, d.ms);
    const step = () => {
      if (landed) return;
      const p = Math.min(1, (performance.now() - t0) / d.ms);
      const y = Math.round(y0 + (d.y - y0) * ease(p));
      go(y, d.behavior);
      steps.push([Math.round(performance.now() - t0), y, scrollY]);
      if (p >= 1) land();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // The frame's own animation-frame interval over `n` frames.
  function rate(d) {
    const ivs = [];
    let prev = 0;
    let n = 0;
    const t = (ts) => {
      if (prev) ivs.push(ts - prev);
      prev = ts;
      n += 1;
      if (n < d.n) requestAnimationFrame(t);
      else {
        ivs.sort((a, b) => a - b);
        post({ t: 'rate', med: ivs[ivs.length >> 1], min: ivs[0], max: ivs[ivs.length - 1] });
      }
    };
    requestAnimationFrame(t);
  }

  addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const d = e.data && typeof e.data === 'object' ? e.data : {};
    if (d.cmd === 'rects') requestRects();
    else if (d.cmd === 'rate') rate(d);
    else if (d.cmd === 'scroll') { go(d.y); requestRects(); }
    else if (d.cmd === 'drive') startDrive(d);
    else if (d.cmd === 'stop') { if (drive) drive.stop = true; }
    else if (d.cmd === 'tween') tween(d);
  });
  post({ t: 'ready', page: cfg.page });
  requestRects();
}

function parentMain(cfg) {
  const stage = document.getElementById('stage');
  const box = document.querySelector('.frame-box');
  const frame = box.querySelector('iframe');
  const ov = box.querySelector('.overlay-doc');
  const track = document.createElement('div');
  track.className = 'mk-track';
  ov.appendChild(track);
  const bandMarks = [];
  const tally = { n: 0, badOrigin: 0, badSource: 0, origins: [] };
  let last = null;
  let applied = 0;
  let waiters = [];
  let loads = 0;
  let cur = { s: 1, h: 0 };
  const abs = (t) => performance.timeOrigin + t;
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const frames = async (n) => { for (let i = 0; i < n; i += 1) await raf(); };
  const send = (m) => frame.contentWindow.postMessage(m, '*');

  function apply(d) {
    last = d;
    applied = d.scrollY;
    ov.style.transform = `translate(${-d.scrollX}px, ${-d.scrollY}px)`;
    const t = d.sections.find((x) => x.id === cfg.trackId);
    track.hidden = !t;
    if (t) track.style.top = `${t.rect[1]}px`;
    for (let i = 0; i < d.bands.length; i += 1) {
      if (!bandMarks[i]) {
        const m = document.createElement('div');
        m.className = 'mk';
        ov.appendChild(m);
        bandMarks.push(m);
      }
      bandMarks[i].hidden = false;
      bandMarks[i].style.top = `${d.bands[i]}px`;
    }
    for (let i = d.bands.length; i < bandMarks.length; i += 1) bandMarks[i].hidden = true;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) { tally.badSource += 1; return; }
    tally.n += 1;
    if (e.origin !== 'null') {
      tally.badOrigin += 1;
      if (tally.origins.length < 4) tally.origins.push(String(e.origin));
    }
    const d = e.data && typeof e.data === 'object' ? e.data : {};
    if (d.t === 'rects') apply(d);
    for (const w of [...waiters]) {
      if (w.pred(d)) {
        waiters = waiters.filter((x) => x !== w);
        w.resolve(d);
      }
    }
  });

  const waitFor = (pred, ms, label) => new Promise((resolve, reject) => {
    const w = { pred, resolve: (d) => { clearTimeout(timer); resolve(d); } };
    const timer = setTimeout(() => {
      waiters = waiters.filter((x) => x !== w);
      reject(new Error(`timed out waiting for ${label}`));
    }, ms);
    waiters.push(w);
  });

  const tf = (s) => `translate(${Math.max(0, (cfg.stageW - cfg.pageW * s) / 2)}px, 0px) scale(${s})`;
  function place(s, h) {
    box.style.transform = tf(s);
    box.style.height = `${h}px`;
    cur = { s, h };
  }
  async function settle() {
    await frames(2);
    const p = waitFor((d) => d.t === 'rects', 5000, 'rects');
    send({ cmd: 'rects' });
    return p;
  }
  async function layout(s, h) {
    const changed = h !== cur.h;
    place(s, h);
    if (changed) await waitFor((d) => d.t === 'rects' && Math.abs(d.vh - h) <= 1, 5000, `rects at frame height ${h}`);
    return settle();
  }
  async function scrollFrame(y) {
    send({ cmd: 'scroll', y });
    await waitFor((d) => d.t === 'rects' && Math.abs(d.scrollY - y) < 1, 5000, `frame scroll ${y}`);
    await frames(3);
    return settle();
  }
  async function load(page) {
    loads += 1;
    const ready = waitFor((d) => d.t === 'ready' && d.page === page, 10000, `frame page ${page}`);
    frame.src = `/frame?page=${page}&n=${loads}`;
    await ready;
    return settle();
  }

  // The frame's and the parent's animation-frame intervals, measured over the same frames.
  async function rate() {
    const fp = waitFor((d) => d.t === 'rate', 15000, 'frame rate');
    send({ cmd: 'rate', n: cfg.rateFrames });
    const own = [];
    let prev = 0;
    for (let i = 0; i < cfg.rateFrames; i += 1) {
      const ts = await raf();
      if (prev) own.push(ts - prev);
      prev = ts;
    }
    const f = await fp;
    own.sort((a, b) => a - b);
    return { frame: f.med, frameMin: f.min, frameMax: f.max, parent: own[own.length >> 1] };
  }

  // R7 in two halves, so the probe can click in the frame between them.
  let r7 = null;
  async function r7Prepare(s) {
    await load('abc');
    await layout(s, Math.round(cfg.stageH / s));
    await scrollFrame(0);
    r7 = { s };
    return true;
  }
  async function r7Run() {
    const { s } = r7;
    const r = await rate();
    const step = (cfg.speed * r.frame) / 1000;
    const trackY = last.sections.find((x) => x.id === cfg.trackId).rect[1];
    const frameTop = frame.getBoundingClientRect().top;
    const samples = [];
    let on = true;
    const sample = (ts) => {
      if (!on) return;
      samples.push([abs(ts), applied, track.getBoundingClientRect().top]);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    const done = waitFor((d) => d.t === 'drive-log', 60000, 'drive log');
    send({ cmd: 'drive', from: 0, step, frames: cfg.r7Warmup + cfg.r7Frames + 10 });
    const { log } = await done;
    await frames(3);
    on = false;
    return { s, h: cur.h, trackY, frameTop, samples, log, step, rate: r };
  }

  let driveDone = null;
  let driveStep = 0;
  async function pixelSetup(s) {
    await load('abc');
    await layout(s, Math.round(cfg.stageH / s));
    await scrollFrame(Math.max(0, last.bands[0] - 50));
    const r = await rate();
    driveStep = (cfg.speed * r.frame) / 1000;
    const fr = frame.getBoundingClientRect();
    return { s, markerX: fr.left + s * cfg.markX, bandX: fr.left + s * cfg.bandX, from: last.scrollY, step: driveStep, rate: r };
  }
  function driveGo() {
    driveDone = waitFor((d) => d.t === 'drive-log', 120000, 'drive log');
    send({ cmd: 'drive', from: last.scrollY, step: driveStep, frames: 0 });
    return true;
  }
  async function driveStop() {
    send({ cmd: 'stop' });
    const d = await driveDone;
    await settle();
    return { frames: d.log.length, travel: d.log.length ? d.log[d.log.length - 1][1] - d.log[0][1] : 0 };
  }

  async function reflow(heights) {
    await load('abc');
    const out = [];
    for (const h of heights) {
      const d = await layout(cfg.stageH / h, h);
      const get = (id) => d.sections.find((x) => x.id === id).rect;
      out.push({ h, vh: d.vh, A: get('A'), B: get('B'), C: get('C') });
    }
    return out;
  }

  const spanOf = (d, ids) => {
    const rs = d.sections.filter((x) => ids.includes(x.id)).map((x) => x.rect);
    return Math.max(...rs.map((r) => r[1] + r[3])) - Math.min(...rs.map((r) => r[1]));
  };
  async function feedback({ page, crews, hold }) {
    await load(page);
    const holdH = Math.round(cfg.stageH / cfg.floor);
    await layout(cfg.fit, hold ? holdH : Math.round(cfg.stageH / cfg.fit));
    await scrollFrame(0);
    const out = [];
    for (let k = 0; k < crews.length; k += 1) {
      const crew = crews[k];
      const spanH = spanOf(last, crew);
      const s = Math.min(cfg.fit, Math.max(cfg.floor, cfg.effH / spanH));
      const h = hold ? holdH : Math.round(cfg.stageH / s);
      const d = await layout(s, h);
      out.push({ k: k + 1, crew, spanH, s, h, vh: d.vh, spanAfter: spanOf(d, crew) });
    }
    return out;
  }

  let anim = null;
  async function easeStart(keepTall) {
    await load('abc');
    await layout(cfg.floor, Math.round(cfg.stageH / cfg.floor));
    await scrollFrame(0);
    // The mutant resizes the frame to the zoomed-in height before the ease; the rule keeps the taller one.
    if (!keepTall) await layout(cfg.floor, Math.round(cfg.stageH / cfg.fit));
    return [{ transform: tf(cfg.floor) }, { transform: tf(cfg.fit) }];
  }
  async function easeSetup(keepTall) {
    const keys = await easeStart(keepTall);
    anim = box.animate(keys, { duration: cfg.easeMs, easing: 'ease', fill: 'forwards' });
    anim.pause();
    anim.currentTime = 0;
    await frames(2);
    return true;
  }
  async function easeSeek(t) {
    anim.currentTime = t;
    await frames(2);
    const r = box.getBoundingClientRect();
    return { t, left: r.left, right: r.right, bottom: r.bottom, stageBottom: stage.getBoundingClientRect().bottom };
  }
  async function easeEnd() {
    if (anim) anim.cancel();
    anim = null;
    await layout(cfg.fit, Math.round(cfg.stageH / cfg.fit));
    return true;
  }
  async function easeLive(keepTall) {
    const keys = await easeStart(keepTall);
    const stageBottom = stage.getBoundingClientRect().bottom;
    const a = box.animate(keys, { duration: cfg.easeMs, easing: 'ease', fill: 'forwards' });
    const out = [];
    await new Promise((resolve) => {
      const tick = () => {
        out.push(box.getBoundingClientRect().bottom - stageBottom);
        if (a.playState === 'finished') resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    a.cancel();
    place(cfg.fit, cur.h);
    await layout(cfg.fit, Math.round(cfg.stageH / cfg.fit));
    return out;
  }

  async function tween(behavior) {
    await load('smooth');
    await layout(cfg.fit, Math.round(cfg.stageH / cfg.fit));
    await scrollFrame(0);
    const p = waitFor((d) => d.t === 'tween-done', 8000, `tween ${behavior}`);
    send({ cmd: 'tween', y: cfg.tweenY, ms: cfg.tweenMs, behavior });
    return p;
  }

  window.__p = {
    load, rate, r7Prepare, r7Run, pixelSetup, driveGo, driveStop, reflow, feedback, easeSetup, easeSeek, easeEnd, easeLive, tween,
    tally: () => tally,
  };
  window.__ready = true;
}

const PARENT_CFG = {
  stageW: STAGE.w, stageH: STAGE.h, pageW: PAGE_W, fit: FIT, floor: FLOOR, effH: EFFECTIVE_H, trackId: 'C',
  speed: R7_SPEED, rateFrames: RATE_FRAMES, r7Frames: R7_FRAMES, r7Warmup: R7_WARMUP, markX: 70, bandX: 640, easeMs: EASE_MS, tweenY: TWEEN_Y, tweenMs: TWEEN_MS,
};
const rgb = (c) => `rgb(${c.join(',')})`;

const PARENT_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>worca R7 R20 probe</title><style>
html,body{margin:0;background:#fff}
#stage{position:absolute;left:${STAGE.left}px;top:${STAGE.top}px;width:${STAGE.w}px;height:${STAGE.h}px;overflow:hidden;background:${rgb(WELL)}}
.frame-box{position:absolute;left:0;top:0;width:${PAGE_W}px;transform-origin:0 0;overflow:hidden}
.frame-box iframe{display:block;width:100%;height:100%;border:0}
.overlay-doc{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none}
.mk{position:absolute;left:40px;width:60px;height:6px;background:${rgb(MARK)}}
.mk-track{position:absolute;left:120px;width:60px;height:6px;background:rgb(255,128,0)}
[hidden]{display:none}
</style></head><body><div id="stage"><div class="frame-box"><iframe sandbox="allow-scripts" title="frame"></iframe><div class="overlay-doc"></div></div></div>
<script src="/parent.js"></script></body></html>`;
const PARENT_JS = `(${parentMain})(${JSON.stringify(PARENT_CFG)});\n`;

function frameDoc(name) {
  const p = PAGES[name];
  const secs = p.secs.map(([id, css], i) => `<section data-section="${id}" style="${css};background:${SECTION_BG[i % SECTION_BG.length]}"><span>${id}</span></section>`).join('');
  const bands = p.bands ? `<section data-section="D">${'<div class="band" data-band></div>'.repeat(p.bands)}</section>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><style>
html{background:rgb(244,241,234)${p.smooth ? ';scroll-behavior:smooth' : ''}}
body{margin:0;font:16px/1 sans-serif}
section{display:block;box-sizing:border-box;overflow:hidden}
.band{height:${BAND_GAP}px;box-sizing:border-box;border-top:6px solid ${rgb(BAND)}}
</style></head><body>${secs}${bands}<script>(${frameMain})(${JSON.stringify({ page: name })});</script></body></html>`;
}

function handler(req, res) {
  const url = new URL(req.url, 'http://probe.invalid');
  const send = (status, type, body) => {
    res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body);
  };
  if (req.method !== 'GET') return send(405, 'text/plain', '');
  if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', PARENT_HTML);
  if (url.pathname === '/parent.js') return send(200, 'text/javascript; charset=utf-8', PARENT_JS);
  const page = url.searchParams.get('page');
  if (url.pathname === '/frame' && Object.hasOwn(PAGES, page)) return send(200, 'text/html; charset=utf-8', frameDoc(page));
  return send(404, 'text/plain', '');
}

/** An 8-bit RGB or RGBA, non-interlaced PNG (what Playwright's screenshots are) -> {width, height, channels, data}. */
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
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (kind === 'IDAT') idat.push(body);
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
      let r;
      if (f === 0) r = v;
      else if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`bad PNG filter ${f}`);
      data[dst + x] = r & 255;
    }
  }
  return { width, height, channels, data };
}

const pixel = (img, x, y) => {
  const i = (y * img.width + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const near = (p, c, tol) => Math.abs(p[0] - c[0]) <= tol && Math.abs(p[1] - c[1]) <= tol && Math.abs(p[2] - c[2]) <= tol;

/** Rows where a run of `color` starts in column x, leaving out runs cut by the image's top or bottom edge. */
function runTops(img, x, color, tol = 60) {
  const tops = [];
  let prev = true;
  for (let y = 0; y < img.height; y += 1) {
    const m = near(pixel(img, x, y), color, tol);
    if (m && !prev && y < img.height - 3) tops.push(y);
    prev = m;
  }
  return tops;
}

/** Each marker's top minus its nearest stripe's top, in screen px, for pairs closer than maxGap. Pure. */
function pairLags(markTops, bandTops, maxGap) {
  const out = [];
  for (const m of markTops) {
    let best = null;
    for (const b of bandTops) if (best === null || Math.abs(m - b) < Math.abs(m - best)) best = b;
    if (best !== null && Math.abs(m - best) <= maxGap) out.push(m - best);
  }
  return out;
}

const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : String(n));
const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : String(n));
const f3 = (n) => (Number.isFinite(n) ? n.toFixed(3) : String(n));
const sc = (s) => (s === 1 ? '1' : String(s));

const rateText = (r) => `frame ${f1(r.frame)} ms (${f1(r.frameMin)}-${f1(r.frameMax)}), parent ${f1(r.parent)} ms`;

/** R7 over the drive's 120 measured frames: for each parent frame, the marker's screen y minus the element's screen y,
 *  where the element sits where the frame's own log says it had scrolled by that frame. The drive scrolls 2000 px/s
 *  in steps of the frame's own animation frames; the lag is judged in the parent's frames, which are the screen's. Pure. */
function r7LagRow(m, id) {
  const { log, samples, s, rate } = m;
  const ivP = rate.parent;
  const vMs = R7_SPEED / 1000;
  const tol = Math.min(ivP, rate.frame) / 2;
  const first = log[R7_WARMUP];
  const end = log[Math.min(log.length - 1, R7_WARMUP + R7_FRAMES - 1)];
  const lags = [];
  let mapErr = 0;
  for (const [T, appliedY, markerTop] of samples) {
    if (!first || T < first[0] - tol || T > end[0] + tol) continue;
    let actual = null;
    for (const e of log) {
      if (e[0] <= T + tol) actual = e[1];
      else break;
    }
    if (actual === null) continue;
    const screen = markerTop - (m.frameTop + s * (m.trackY - actual));
    mapErr = Math.max(mapErr, Math.abs(screen - s * (actual - appliedY)));
    lags.push(screen / s / vMs);
  }
  const worstMs = lags.length ? Math.max(...lags.map(Math.abs)) : NaN;
  const worst = worstMs / ivP;
  const ok = lags.length >= R7_FRAMES * 0.8 && worst <= R7_PASS_FRAMES;
  const ms = (x) => `${f1(x)} ms`;
  return {
    ok, id,
    detail: `scale ${sc(s)}, frame ${m.h} px tall; ${rateText(rate)}; drive ${R7_SPEED} px/s as ${f1(m.step)} px a frame; `
      + `${lags.length} parent frames over the drive's ${R7_FRAMES}; lag worst ${ms(worstMs)} = ${f2(worst)} parent frames, `
      + `p95 ${ms(quantile(lags, 0.95))}, median ${ms(median(lags))}, best ${ms(Math.min(...lags))}; `
      + `worst on screen ${f1(worstMs * vMs * s)} px (one parent frame of travel = ${f1(ivP * vMs * s)} px); marker mapping error ${f2(mapErr)} px`,
  };
}

/** The alignment on screen: marker top minus stripe top in one screenshot, judged at rest (within 1.5 px). The numbers
 *  while scrolling are printed, not judged: Firefox's and WebKit's screenshots draw the page on request, after both
 *  documents caught up, and Chrome's, though copied from a composited frame, still read one frame or none with the
 *  overlay held back a whole extra frame. The timing rows judge the lag. */
async function r7PixelRow(page, s) {
  const g = await page.evaluate((x) => window.__p.pixelSetup(x), s);
  const clip = { x: Math.floor(g.markerX) - 1, y: STAGE.top, width: Math.ceil(g.bandX) - Math.floor(g.markerX) + 3, height: STAGE.h };
  const colM = Math.round(g.markerX) - clip.x;
  const colB = Math.round(g.bandX) - clip.x;
  const maxGap = (s * BAND_GAP) / 2 - 2;
  const read = async () => {
    const img = decodePng(await page.screenshot({ clip }));
    if (img.width !== clip.width || img.height !== clip.height) throw new Error(`screenshot ${img.width}x${img.height}, asked ${clip.width}x${clip.height}`);
    return pairLags(runTops(img, colM, MARK), runTops(img, colB, BAND), maxGap);
  };
  const restBefore = await read();
  await page.evaluate(() => window.__p.driveGo());
  await page.waitForTimeout(250);
  const shots = [];
  for (let i = 0; i < R7_SHOTS; i += 1) shots.push(await read());
  const drive = await page.evaluate(() => window.__p.driveStop());
  const restAfter = await read();
  const all = shots.flat();
  const onePx = s * (R7_SPEED / 1000) * g.rate.parent;
  const worstPx = all.length ? Math.max(...all.map(Math.abs)) : NaN;
  const rest = [...restBefore, ...restAfter];
  const restWorst = rest.length ? Math.max(...rest.map(Math.abs)) : NaN;
  const perShot = shots.map((x) => (x.length ? f1(median(x)) : '-'));
  const ok = restBefore.length > 0 && restAfter.length > 0 && restWorst <= 1.5;
  return {
    ok, id: `r7-pixels-s${sc(s)}`,
    detail: `scale ${sc(s)}: at rest ${rest.length} marker/stripe pairs, worst ${f1(restWorst)} px. Not judged: `
      + `${R7_SHOTS} screenshots while scrolling (${drive.frames} drive frames of ${f1(g.step)} px, ${Math.round(drive.travel)} px), `
      + `${all.length} pairs; marker y minus stripe y per shot [${perShot.join(' ')}] px; worst ${f1(worstPx)} px `
      + `= ${f2(worstPx / onePx)} parent frames of travel (one = ${f1(onePx)} px)`,
  };
}

/** Whether the sandboxed frame's animation frames keep the parent's pace: fresh, after a wheel over it, after a click
 *  in it. The bridge posts `rects` and runs the camera's scroll tween on those frames. */
async function frameRafRow(page) {
  await page.evaluate(() => window.__p.load('abc'));
  const fresh = await page.evaluate(() => window.__p.rate());
  await page.mouse.move(CLICK.x, CLICK.y);
  await page.mouse.wheel(0, 40);
  await page.waitForTimeout(300);
  const wheel = await page.evaluate(() => window.__p.rate());
  await page.mouse.click(CLICK.x, CLICK.y);
  await page.waitForTimeout(300);
  const click = await page.evaluate(() => window.__p.rate());
  const keeps = (r) => r.frame <= r.parent * 1.5;
  const yes = (r) => (keeps(r) ? 'keeps' : 'does NOT keep');
  return {
    ok: keeps(fresh), id: 'frame-raf',
    detail: `animation-frame interval, median of ${RATE_FRAMES - 1}: fresh frame ${rateText(fresh)}; after a wheel over the frame ${rateText(wheel)}; `
      + `after a click in the frame ${rateText(click)}; the frame ${yes(fresh)} the parent's pace fresh, ${yes(wheel)} it after a wheel, `
      + `${yes(click)} it after a click`,
  };
}

async function r7Lag(page, s, { click = false } = {}) {
  await page.evaluate((x) => window.__p.r7Prepare(x), s);
  if (click) {
    await page.mouse.click(CLICK.x, CLICK.y);
    await page.waitForTimeout(300);
  }
  return r7LagRow(await page.evaluate(() => window.__p.r7Run()), `r7-lag-s${sc(s)}${click ? '-clicked' : ''}`);
}

/** R20 reflow: A tracks vh, B stops at its clamp, C holds its 600 px. Pure. */
function reflowRow(steps) {
  const close = (a, b) => Math.abs(a - b) <= 0.5;
  const bad = [];
  for (const st of steps) {
    const clampB = Math.min(800, Math.max(480, 0.6 * st.vh));
    if (!close(st.vh, st.h)) bad.push(`frame ${st.vh} not ${st.h}`);
    if (!close(st.A[3], st.vh)) bad.push(`A ${st.A[3]} at vh ${st.vh}`);
    if (!close(st.B[3], clampB)) bad.push(`B ${st.B[3]} not clamp ${clampB}`);
    if (!close(st.C[3], 600)) bad.push(`C ${st.C[3]} at frame ${st.h}`);
    if (!close(st.C[1], st.A[3] + st.B[3])) bad.push(`C top ${st.C[1]} not A+B`);
  }
  const a = steps[0];
  const z = steps[steps.length - 1];
  if (!['A', 'B', 'C'].every((k) => a[k].every((v, i) => close(v, z[k][i])))) bad.push('the way back differs from the start');
  const fmt = (st) => `frame ${st.h}: A ${f1(st.A[3])} (vh ${st.vh}), B ${f1(st.B[3])}, C ${f1(st.C[3])} at y ${f1(st.C[1])}`;
  const moved = Math.max(...steps.map((st) => st.C[1])) - Math.min(...steps.map((st) => st.C[1]));
  return {
    ok: bad.length === 0, id: 'r20-reflow',
    detail: `${steps.map(fmt).join('; ')}; C held 600 px at every height and its top moved ${f1(moved)} px, exactly A's and B's change`
      + `${bad.length ? `; wrong: ${bad.join(', ')}` : ''}`,
  };
}

const floorAt = (runs) => runs.find((r) => r.s === FLOOR)?.k ?? null;

/** R20 feedback over 8 crew changes. Pure. */
function feedbackRow({ vh2, vh1, kit, hold }) {
  const scales = (runs) => runs.map((r) => f3(r.s)).join(' ');
  const perCrew = new Map();
  for (const r of hold) {
    const key = r.crew.join('+');
    if (!perCrew.has(key)) perCrew.set(key, new Set());
    perCrew.get(key).add(r.s);
  }
  const holdSteady = hold.every((r) => r.vh === hold[0].vh) && [...perCrew.values()].every((v) => v.size === 1);
  const kitAbove = kit.every((r) => r.s > FLOOR);
  const ok = floorAt(vh2) !== null && kitAbove && holdSteady;
  const at = (runs) => (floorAt(runs) === null ? 'never at 0.45' : `0.45 at change ${floorAt(runs)}`);
  return {
    ok, id: 'r20-feedback',
    detail: `scale = clamp(${EFFECTIVE_H} / spanH, ${FLOOR}, ${f3(FIT)}), frame = 900 / scale, 8 crew changes. `
      + `Two 100vh running: ${at(vh2)} (scales ${scales(vh2)}; spans ${vh2.map((r) => Math.round(r.spanH)).join(' ')}). `
      + `One 100vh running: ${at(vh1)} (scales ${scales(vh1)}). `
      + `Kit rule, the same page with clamp(480px,60vh,800px) for the 100vh: ${at(kit)} (scales ${scales(kit)}). `
      + `Fallback, frame held at ${hold[0].h} for the round, two 100vh running: frame ${holdSteady ? 'and scale per crew held still' : 'MOVED'}, `
      + `${at(hold)} (scales ${scales(hold)})`,
  };
}

async function easeRun(page, keepTall) {
  await page.evaluate((k) => window.__p.easeSetup(k), keepTall);
  const clip = { x: STAGE.left, y: STAGE.top + STAGE.h - 1, width: STAGE.w, height: 1 };
  const out = [];
  for (let i = 0; i <= EASE_STEPS; i += 1) {
    const t = (EASE_MS * i) / EASE_STEPS;
    const r = await page.evaluate((x) => window.__p.easeSeek(x), t);
    const img = decodePng(await page.screenshot({ clip }));
    const from = Math.max(0, Math.ceil(r.left - STAGE.left) + 1);
    const to = Math.min(img.width - 1, Math.floor(r.right - STAGE.left) - 2);
    let well = 0;
    for (let x = from; x <= to; x += 1) if (near(pixel(img, x, 0), WELL, 40)) well += 1;
    out.push({ t, well, cols: to - from + 1, short: r.stageBottom - r.bottom });
  }
  await page.evaluate(() => window.__p.easeEnd());
  return out;
}

async function easeRow(page) {
  const kept = await easeRun(page, true);
  const keptLive = await page.evaluate((k) => window.__p.easeLive(k), true);
  const ctl = await easeRun(page, false);
  const ctlLive = await page.evaluate((k) => window.__p.easeLive(k), false);
  const keptWell = kept.filter((f) => f.well > 0);
  const ctlWell = ctl.filter((f) => f.well > 0);
  const liveShort = keptLive.filter((d) => d < -0.5);
  const ctlShort = ctlLive.filter((d) => d < -0.5);
  const ok = keptWell.length === 0 && liveShort.length === 0 && keptLive.length > 0 && ctlWell.length > 0;
  return {
    ok, id: 'r20-ease',
    detail: `zoom in ${FLOOR} -> ${f3(FIT)} over ${EASE_MS} ms (ease). Frame kept at 2000 px: the well under the page in `
      + `${keptWell.length} of ${kept.length} frames seeked every ${f1(EASE_MS / EASE_STEPS)} ms (bottom row, ${kept[0].cols}-${kept[kept.length - 1].cols} px under the page); `
      + `live, ${keptLive.length} frames, box bottom above the stage bottom in ${liveShort.length} (least margin ${f1(Math.min(...keptLive))} px). `
      + `Control, frame set to 1056 px first: the well in ${ctlWell.length} of ${ctl.length} frames (up to ${Math.max(0, ...ctl.map((f) => f.well))} px of the row), `
      + `live ${ctlShort.length} of ${ctlLive.length} frames short`,
  };
}

function tweenRow(inst, auto) {
  const off = (r) => r.steps.filter(([, y, at]) => Math.abs(at - y) >= 1).length;
  const ok = inst.smooth === 'smooth' && inst.endMs !== null && inst.endMs <= TWEEN_PASS_MS && off(inst) === 0;
  const end = (r) => (r.endMs === null ? `not at ${TWEEN_Y} after 2 s (at ${Math.round(r.finalY)})` : `at ${TWEEN_Y} after ${Math.round(r.endMs)} ms`);
  return {
    ok, id: 'tween',
    detail: `page scroll-behavior:${inst.smooth}; 0 -> ${TWEEN_Y} by rAF over ${TWEEN_MS} ms plus a landing timer. `
      + `behavior:'instant': ${end(inst)}, ${inst.steps.length} steps, ${off(inst)} off target. `
      + `Control behavior:'auto': ${end(auto)}, ${off(auto)} of ${auto.steps.length} steps off target`,
  };
}

function originRow(t) {
  return {
    ok: t.n > 0 && t.badOrigin === 0 && t.badSource === 0, id: 'origin',
    detail: `${t.n} messages from the frame over the whole run; e.origin other than 'null': ${t.badOrigin}${t.origins.length ? ` (${t.origins.join(', ')})` : ''}; `
      + `e.source other than frame.contentWindow: ${t.badSource}`,
  };
}

function printRows(rows) {
  for (const r of rows) console.log(`${r.ok ? 'ok' : 'FAIL'} ${r.id} ${r.detail.replace(/\s+/g, ' ').trim()}`);
  return rows.every((r) => r.ok) ? 0 : 1;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function stop(server) {
  server.close();
  server.closeAllConnections();
}

function launchOptions(name) {
  if (name !== 'chromium') return { headless: true };
  const executablePath = findChrome();
  if (!executablePath) throw new Error('no Chrome found: findChrome() returned null (set WORCA_CHROME)');
  const noSandbox = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0;
  return { executablePath, headless: true, args: noSandbox ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] };
}

/** Chrome only: whether the sandboxed frame got its own renderer (an `iframe` target). */
async function frameProcess(name, ctx, page) {
  if (name !== 'chromium') return 'unknown';
  try {
    const cdp = await ctx.newCDPSession(page);
    const { targetInfos } = await cdp.send('Target.getTargets');
    await cdp.detach();
    return targetInfos.some((t) => t.type === 'iframe') ? 'out-of-process' : 'in-process';
  } catch {
    return 'unknown';
  }
}

async function probeBrowser(name) {
  const server = http.createServer(handler);
  const port = await listen(server);
  const browser = await { chromium, firefox, webkit }[name].launch(launchOptions(name));
  try {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: PAGE_WAIT_MS });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: PAGE_WAIT_MS });
    await page.evaluate(() => window.__p.load('abc'));
    const proc = await frameProcess(name, ctx, page);
    const rows = [];
    for (const s of [1, FLOOR]) rows.push(await r7Lag(page, s));
    rows.push(await r7Lag(page, 1, { click: true }));
    for (const s of [1, FLOOR]) rows.push(await r7PixelRow(page, s));
    rows.push(await frameRafRow(page));
    rows.push(reflowRow(await page.evaluate((hs) => window.__p.reflow(hs), REFLOW_HEIGHTS)));
    const crews = (base) => CREW_EXTRAS.map((x) => [...base, ...x]);
    const fb = {};
    fb.vh2 = await page.evaluate((o) => window.__p.feedback(o), { page: 'vh2', crews: crews(['h1', 'h2']), hold: false });
    fb.vh1 = await page.evaluate((o) => window.__p.feedback(o), { page: 'vh1', crews: crews(['h1']), hold: false });
    fb.kit = await page.evaluate((o) => window.__p.feedback(o), { page: 'kit', crews: crews(['h1']), hold: false });
    fb.hold = await page.evaluate((o) => window.__p.feedback(o), { page: 'vh2', crews: crews(['h1', 'h2']), hold: true });
    rows.push(feedbackRow(fb));
    rows.push(await easeRow(page));
    const inst = await page.evaluate((b) => window.__p.tween(b), 'instant');
    const auto = await page.evaluate((b) => window.__p.tween(b), 'auto');
    rows.push(tweenRow(inst, auto));
    rows.push(originRow(await page.evaluate(() => window.__p.tally())));
    console.log(`# r7-r20 probe ${new Date().toISOString()} browser=${name} version=${browser.version()} os=${process.platform} `
      + `viewport=${VIEWPORT.width}x${VIEWPORT.height} stage=${STAGE.w}x${STAGE.h} pageW=${PAGE_W} fit=${f3(FIT)} frame=${proc}`);
    return printRows(rows);
  } finally {
    await browser.close();
    stop(server);
  }
}

function parseArgs(argv) {
  const o = { browser: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--browser') o.browser = argv[(i += 1)];
    else return { error: `unknown flag ${a}` };
  }
  if (!['chromium', 'firefox', 'webkit'].includes(o.browser)) return { error: '--browser must be chromium, firefox or webkit' };
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.error) {
    console.error(`${o.error}\nusage: probe.mjs --browser chromium|firefox|webkit`);
    return 64;
  }
  setTimeout(() => { console.log(`FAIL setup the probe hit its ${HARD_LIMIT_MS / 1000}s hard limit`); process.exit(1); }, HARD_LIMIT_MS).unref();
  return probeBrowser(o.browser);
}

main().then((code) => process.exit(code), (e) => { console.log(`FAIL setup ${String((e && e.message) || e).split('\n')[0]}`); process.exit(1); });
