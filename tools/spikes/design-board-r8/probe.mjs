// tools/spikes/design-board-r8/probe.mjs — Design P7 Task 1 (risk R8): does a board tile, a 1920×1080 slide or scene
// scaled into a fixed grid track by `boardCss`, report true geometry in a real, opaque, sandboxed frame? Measured for
// both scales (`transform` and `zoom`), so BOARD_SCALE is a measured choice. Standalone: node:http, playwright-core,
// and Chrome from findChrome(). manual: needs a real browser, not part of npm test (M14).
//
//   node tools/spikes/design-board-r8/probe.mjs --browser chromium|firefox|webkit [--dpr <n>]
//   node tools/spikes/design-board-r8/probe.mjs --serve        # prints a URL; open it in real Safari
//
// The shell page `/` carries worca's shell CSP and frames one doc per (scale, case) as P4 frames the build doc:
// `sandbox="allow-scripts"`, `referrerpolicy="no-referrer"`, a served URL `/doc?scale=<mode>&s=<s>&case=<id>` under
// C-7's build CSP with a nonced script. Each doc is `boardCss(mode)` over the build doc's board (`<deck-stage
// data-worca-board>` or `<div data-film data-worca-board>`, sections and `data-worca-slot` tiles, the sections
// comment inside), sets the `--worca-board-*` variables on its document element the way the bridge's `board` message
// does, measures what the bridge measures, and reports to the parent by postMessage. The `ref` case lays the same
// tiles out at s = 1: it is the authored layout every other case is compared against.
//
// Prints `ok|FAIL <scale>.<id> <detail>` per check (rows r1-r7) after `#` header lines, then
// `verdict: <first scale with no FAIL, or none>`. Exit 0 when the shipped BOARD_SCALE has no FAIL, 1 when it has one,
// 2 when --serve got no report in time (`not reached`).
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { chromium, firefox, webkit } from 'playwright-core';
import { findChrome } from '../../../assets/deck-preview/chrome.mjs';
import { BOARD_SCALE, boardCss } from '../../../src/core/design/kinds.mjs';
import { previewCsp, previewHeaders } from '../../../src/core/design/preview-doc.mjs';
import { SHELL_CSP } from '../../../src/core/index-html.mjs';

const MODES = ['transform', 'zoom'];
const PAGE_WAIT_MS = 30000;
const SERVE_WAIT_MS = 120000;
const HARD_LIMIT_MS = 170000;
const SCROLL_BY = 300;
const LINE = 1.3;
const SIZES = [20, 28, 36, 56];
const TEXT_TOP = [40, 190, 390, 640];
const TEXT_W = [620, 820, 1040, 1560];

const DECK_VARS = { cols: 3, s: 0.178703, gap: 12, pad: 16, padB: 76, r: 8, bg: '#101217' };
const RAIL_VARS = { gap: 8, pad: 0, padB: 0, r: 4, bg: '#0B0D11', cols: 1 };
// The boards the stage posts (plan Task 9's 12-slide, 3-slide and video boards in a 1096×900 frame, Task 10's rail
// at 12 and 40 slides as a frame one fractional tile wide), the 12-slide board scrolled by 300 px, and the reference.
const CASES = [
  { id: 'ref', root: 'deck', n: 12, frame: [1920, 1080], vars: { cols: 1, s: 1, gap: 0, pad: 0, padB: 0, r: 8, bg: '#101217' }, ref: true },
  { id: 'deck12', root: 'deck', n: 12, frame: [1096, 900], vars: DECK_VARS },
  { id: 'deck12-scroll', root: 'deck', n: 12, frame: [1096, 500], vars: DECK_VARS, scroll: SCROLL_BY },
  { id: 'deck3', root: 'deck', n: 3, frame: [1096, 900], vars: { ...DECK_VARS, cols: 2, s: 0.273958 } },
  { id: 'film8', root: 'film', n: 8, frame: [1096, 772], vars: { ...DECK_VARS, s: 0.180555, padB: 70 } },
  { id: 'rail12', root: 'deck', n: 12, frame: [116.74, 900], vars: { ...RAIL_VARS, s: 0.060802 } },
  { id: 'rail40', root: 'deck', n: 40, frame: [71.11, 900], vars: { ...RAIL_VARS, s: 0.037037 } },
];
const CASE_BY_ID = new Map(CASES.map((c) => [c.id, c]));

// Tile content repeats every 12 tiles (k = i % 12); its shape walks the pattern by 5, so 3- and 8-tile boards still
// hold a full-bleed tile, plain tiles, a slot and (8) an overflow.
const PATTERN = ['full', 'fit', 'fit', 'fit', 'fit', 'fit', 'fit', 'over-y', 'over-x', 'over-xy', 'slot', 'slot'];
const shapeOf = (k) => PATTERN[(k * 5) % 12];
// The extra child each shape carries, as an authored [left, top, width, height]: exactly the tile, 4 px past the
// bottom, 4 px past the right, or well past both.
const OVER = { full: [0, 0, 1920, 1080], 'over-y': [300, 1000, 200, 84], 'over-x': [1824, 300, 100, 100], 'over-xy': [1800, 1000, 300, 300] };
const OVERFLOWS = { full: [false, false], fit: [false, false], slot: [false, false], 'over-y': [false, true], 'over-x': [true, false], 'over-xy': [true, true] };
const boxOf = (k) => [40 + 13 * k, 24 + 7 * k, 400 + 31 * k, 20 + 3 * k];
const WORDS = ('Every slide is a tile while the round builds and the crew writes each one in place so the board shows the real '
  + 'layout at a glance with headlines figures captions and lists wrapping exactly as they will on the stage once the deck is done').split(' ');

function textOf(k, j) {
  const out = [];
  let len = 0;
  for (let w = k * 3 + j * 7; len < 230; w += 1) {
    const word = WORDS[w % WORDS.length];
    out.push(word);
    len += word.length + 1;
  }
  return `${out.join(' ')}.`;
}

const place = ([l, t, w, h]) => `left:${l}px;top:${t}px;width:${w}px;height:${h}px`;

function tileHtml(root, i) {
  const k = i % 12;
  const shape = shapeOf(k);
  const id = `s${i + 1}`;
  const attrs = `data-probe-k="${k}" data-probe-shape="${shape}"`;
  if (shape === 'slot') return `<div data-worca-slot="${id}" ${attrs}></div>`;
  const over = OVER[shape] ? `<div data-probe-over style="${place(OVER[shape])}"></div>` : '';
  const texts = SIZES.map((size, j) => `<p data-probe-text="${size}" style="top:${TEXT_TOP[j]}px;width:${TEXT_W[j]}px;font-size:${size}px">${textOf(k, j)}</p>`).join('');
  const body = `<div data-probe-box style="${place(boxOf(k))}"></div>${over}${texts}`;
  return root === 'film'
    ? `<div data-scene data-section="${id}" ${attrs}>${body}</div>`
    : `<section data-label="Slide ${i + 1}" data-section="${id}" ${attrs}>${body}</section>`;
}

// The design's own CSS, which the board style (last in the head, as the assembler puts it) must override: a slide
// placed over the whole stage, padded, as a kit's authored layout would.
const AUTHORED_CSS = 'deck-stage{display:block;position:relative;width:1920px;height:1080px;overflow:hidden}'
  + 'section[data-label],[data-scene]{position:absolute;inset:0;padding:64px;background:#090C12;color:#EEF1F5}'
  + '[data-probe-box],[data-probe-over]{position:absolute;background:rgba(47,128,255,.35)}'
  + `[data-probe-text]{position:absolute;margin:0;left:120px;font-family:Arial,Helvetica,sans-serif;line-height:${LINE};white-space:normal}`;

/* The functions below run in the browser; they are inlined with Function.prototype.toString and use nothing from
 * this module's scope. */

function docMain(cfg) {
  const de = document.documentElement;
  const units = { cols: '', s: '', gap: 'px', pad: 'px', padB: 'px', r: 'px', bg: '' };
  const names = { padB: 'pad-b' };
  // As the bridge's `board` message: one custom property per field, on the document element.
  for (const k of Object.keys(cfg.vars)) de.style.setProperty(`--worca-board-${names[k] || k}`, String(cfg.vars[k]) + units[k]);
  const post = (m) => parent.postMessage(m, '*');
  // C-6's [x, y, w, h] in document coordinates, as the bridge's docRect (unrounded).
  const doc = (r) => [r.x + scrollX, r.y + scrollY, r.width, r.height];
  const rectOf = (el) => doc(el.getBoundingClientRect());
  const textNode = (p) => [...p.childNodes].find((n) => n.nodeType === 3) || null;
  const lines = (p, size) => {
    const range = document.createRange();
    range.selectNodeContents(textNode(p));
    const tops = [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0).map((r) => r.top).sort((a, b) => a - b);
    const apart = size * cfg.line * cfg.s * 0.5;
    let n = 0;
    let last = -Infinity;
    for (const y of tops) if (y - last > apart) { n += 1; last = y; }
    return n;
  };
  // The bridge's tail: a Range over the last character of the last text.
  const tail = (p) => {
    const t = textNode(p);
    const range = document.createRange();
    range.setStart(t, t.data.length - 1);
    range.setEnd(t, t.data.length);
    return doc(range.getBoundingClientRect());
  };
  const measure = () => {
    const board = document.querySelector('[data-worca-board]');
    const tiles = [...board.children].filter((el) => el.matches('[data-section],[data-worca-slot]'));
    return {
      iw: innerWidth, ih: innerHeight, cw: de.clientWidth, ch: de.clientHeight, sw: de.scrollWidth, sh: de.scrollHeight,
      sx: scrollX, sy: scrollY, board: rectOf(board),
      tiles: tiles.map((t) => {
        const box = t.querySelector('[data-probe-box]');
        const ps = [...t.querySelectorAll('[data-probe-text]')];
        return {
          id: t.getAttribute('data-section') || t.getAttribute('data-worca-slot'), k: Number(t.dataset.probeK), shape: t.dataset.probeShape,
          rect: rectOf(t), box: box ? rectOf(box) : null, tail: ps.length ? tail(ps[ps.length - 1]) : null,
          sw: t.scrollWidth, cw: t.clientWidth, sh: t.scrollHeight, ch: t.clientHeight,
          text: ps.map((p) => ({ size: Number(p.dataset.probeText), lines: lines(p, Number(p.dataset.probeText)), fs: getComputedStyle(p).fontSize })),
        };
      }),
    };
  };
  const run = () => {
    try {
      const m0 = measure();
      let m1 = null;
      if (cfg.scroll) {
        scrollTo(0, cfg.scroll);
        m1 = measure();
      }
      post({ probe: 'r8', id: cfg.id, mode: cfg.mode, zoom: CSS.supports('zoom', '0.5'), m0, m1 });
    } catch (e) {
      post({ probe: 'r8', id: cfg.id, mode: cfg.mode, error: String(e && e.message || e) });
    }
  };
  const go = () => setTimeout(run, 100);
  addEventListener('load', () => { (document.fonts ? document.fonts.ready : Promise.resolve()).then(go, go); });
}

function parentMain(list) {
  const serve = new URLSearchParams(location.search).get('serve') === '1';
  const out = { ua: navigator.userAgent, dpr: devicePixelRatio, reports: {}, unmatched: 0, done: false };
  const status = (t) => { document.getElementById('status').textContent = t; };
  const frames = list.map((f) => {
    const el = document.createElement('iframe');
    el.setAttribute('sandbox', 'allow-scripts');
    el.setAttribute('referrerpolicy', 'no-referrer');
    el.title = `${f.mode} ${f.id}`;
    el.style.cssText = `display:block;border:0;margin:0 0 8px;width:${f.w}px;height:${f.h}px`;
    el.src = f.src;
    document.getElementById('frames').appendChild(el);
    return { key: `${f.mode}/${f.id}`, el };
  });
  addEventListener('message', (e) => {
    const f = frames.find((x) => x.el.contentWindow === e.source);
    if (!f) { out.unmatched += 1; return; }
    const d = e.data && typeof e.data === 'object' ? e.data : {};
    if (d.probe === 'r8') out.reports[f.key] = d;
  });
  const deadline = Date.now() + 20000;
  const finish = () => {
    out.done = true;
    window.__probe = out;
    if (!serve) { status('done'); return; }
    status('posting the report');
    fetch('/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(out) })
      .then((r) => status(r.ok ? 'done: the probe has the report; this tab can be closed' : `report refused: ${r.status}`))
      .catch((err) => status(`report failed: ${err}`));
  };
  const tick = () => {
    if (frames.every((f) => out.reports[f.key]) || Date.now() > deadline) setTimeout(finish, 200);
    else setTimeout(tick, 100);
  };
  tick();
}

const FRAMES = MODES.flatMap((mode) => CASES.map((c) => ({
  id: c.id, mode, w: c.frame[0], h: c.frame[1], src: `/doc?scale=${mode}&s=${c.vars.s}&case=${c.id}`,
})));
const SHELL_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>worca R8 probe</title></head><body>'
  + '<h1>worca R8 probe</h1><p id="status">running</p><div id="frames"></div><script src="/parent.js"></script></body></html>';
const PARENT_JS = `(${parentMain})(${JSON.stringify(FRAMES)});\n`;

function boardDoc({ c, mode, s, nonce }) {
  const tiles = Array.from({ length: c.n }, (_, i) => tileHtml(c.root, i)).join('');
  const root = c.root === 'film'
    ? `<div data-film data-worca-board>${tiles}<!--worca:sections--></div>`
    : `<deck-stage data-worca-board width="1920" height="1080">${tiles}<!--worca:sections--></deck-stage>`;
  const cfg = { id: c.id, mode, vars: { ...c.vars, s }, s, scroll: c.scroll || 0, line: LINE };
  return `<!doctype html><html><head><meta charset="utf-8"><title>r8 ${c.id} ${mode}</title>
<script nonce="${nonce}">(${docMain})(${JSON.stringify(cfg)});</script>
<style>${AUTHORED_CSS}</style>
<style data-worca-board-css>${boardCss(mode)}</style>
</head><body>${root}</body></html>`;
}

function createHandler({ onReport = null } = {}) {
  return (req, res) => {
    const url = new URL(req.url, 'http://probe.invalid');
    const send = (status, type, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...headers });
      res.end(body);
    };
    if (req.method === 'POST' && url.pathname === '/report' && onReport) {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => { size += c.length; if (size <= 8 << 20) chunks.push(c); });
      req.on('end', () => {
        send(204, 'text/plain', '');
        try { onReport(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { onReport({ invalid: true }); }
      });
      return;
    }
    if (req.method !== 'GET') return send(405, 'text/plain', '');
    if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', SHELL_HTML, { 'Content-Security-Policy': SHELL_CSP, 'X-Frame-Options': 'DENY' });
    if (url.pathname === '/parent.js') return send(200, 'text/javascript; charset=utf-8', PARENT_JS, { 'Cache-Control': 'no-store' });
    if (url.pathname !== '/doc') return send(404, 'text/plain', '');
    const mode = url.searchParams.get('scale');
    const c = CASE_BY_ID.get(url.searchParams.get('case'));
    const s = Number(url.searchParams.get('s'));
    if (!MODES.includes(mode) || !c || !(s > 0 && s <= 1)) return send(404, 'text/plain', '');
    const nonce = randomBytes(16).toString('base64url');
    const csp = previewCsp({ mode: 'build', base: `http://${req.headers.host}/doc/`, nonce });
    return send(200, 'text/html; charset=utf-8', boardDoc({ c, mode, s, nonce }), previewHeaders({ csp }));
  };
}

const r2 = (v) => Math.round(v * 100) / 100;
const fmt = (a) => `[${a.map(r2).join(',')}]`;
const dev = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

/** Where the grid tracks put tile i, and the grid's height, from the case's variables and the doc's client width. */
function gridOf(c, m) {
  const v = c.vars;
  const W = 1920 * v.s;
  const H = 1080 * v.s;
  const rows = Math.ceil(c.n / v.cols);
  const x0 = v.pad + (m.cw - 2 * v.pad - (v.cols * W + (v.cols - 1) * v.gap)) / 2;
  return {
    gridH: v.pad + rows * H + (rows - 1) * v.gap + v.padB,
    tile: (i) => [x0 + (i % v.cols) * (W + v.gap), v.pad + Math.floor(i / v.cols) * (H + v.gap), W, H],
  };
}

/** A worst-case tracker: `add(d, where)` keeps the largest deviation and where it was. */
function worst() {
  const w = { d: 0, where: '', n: 0 };
  w.add = (d, where) => { w.n += 1; if (d > w.d || !w.where) { w.d = d; w.where = where; } };
  return w;
}

/** One scale's rows (r1-r7), keyed in print order, from the parent's report. Pure. */
function modeRows(mode, report) {
  const rows = [];
  const add = (ok, id, detail) => rows.push({ ok: Boolean(ok), id: `${mode}.${id}`, detail: detail.replace(/\s+/g, ' ').trim() });
  const got = (c) => (report.reports || {})[`${mode}/${c.id}`];
  const missing = CASES.filter((c) => !got(c) || got(c).error || !got(c).m0);
  if (missing.length) {
    add(false, 'setup', `no measurement from ${missing.map((c) => `${c.id}${got(c) && got(c).error ? ` (${got(c).error})` : ''}`).join(', ')}`);
    return rows;
  }
  const ref = new Map(got(CASE_BY_ID.get('ref')).m0.tiles.map((t) => [t.k, t]));
  const boards = CASES.filter((c) => !c.ref);
  const each = (fn) => { for (const c of boards) got(c).m0.tiles.forEach((t, i) => fn(c, t, i, got(c).m0)); };

  const rect = worst();
  each((c, t) => {
    if (!t.box) return;
    const [l, tp, w, h] = boxOf(t.k);
    const s = c.vars.s;
    rect.add(dev(t.box, [t.rect[0] + l * s, t.rect[1] + tp * s, w * s, h * s]), `${c.id}/${t.id} box ${fmt(t.box)}`);
  });
  add(rect.n > 0 && rect.d <= 1, 'r1-rect', `child getBoundingClientRect vs tile origin + authored × s: max |Δ| ${r2(rect.d)} px over ${rect.n} boxes (worst ${rect.where})`);

  const track = worst();
  each((c, t, i, m) => { track.add(dev(t.rect, gridOf(c, m).tile(i)), `${c.id}/${t.id} ${fmt(t.rect)} want ${fmt(gridOf(c, m).tile(i))}`); });
  add(track.n > 0 && track.d <= 1, 'r2-tile-track', `tile rect vs its grid track [x, y, 1920·s, 1080·s]: max |Δ| ${r2(track.d)} px over ${track.n} tiles (worst ${track.where})`);

  const tl = worst();
  each((c, t) => {
    const r = ref.get(t.k);
    if (!t.tail || !r || !r.tail) return;
    const s = c.vars.s;
    const want = [t.rect[0] + (r.tail[0] - r.rect[0]) * s, t.rect[1] + (r.tail[1] - r.rect[1]) * s, r.tail[2] * s, r.tail[3] * s];
    tl.add(dev(t.tail, want), `${c.id}/${t.id} ${fmt(t.tail)} want ${fmt(want)}`);
  });
  add(tl.n > 0 && tl.d <= 2, 'r3-range-tail', `Range over the last character vs authored × s: max |Δ| ${r2(tl.d)} px over ${tl.n} tails (worst ${tl.where})`);

  const wrap = new Map();
  const wrapBad = [];
  each((c, t) => {
    const r = ref.get(t.k);
    if (!r) return;
    const k = String(c.vars.s);
    if (!wrap.has(k)) wrap.set(k, { same: 0, n: 0 });
    t.text.forEach((x, j) => {
      const want = r.text[j].lines;
      wrap.get(k).n += 1;
      if (x.lines === want) wrap.get(k).same += 1;
      else if (wrapBad.length < 4) wrapBad.push(`${c.id}/${t.id} ${x.size}px ${want}→${x.lines} lines (computed ${x.fs})`);
    });
  });
  const refLines = [...ref.values()].filter((t) => t.text.length).flatMap((t) => t.text.map((x) => x.lines));
  const wrapOk = [...wrap.values()].every((w) => w.n > 0 && w.same === w.n) && wrap.size > 0;
  add(wrapOk, 'r4-wrap', `line count vs s = 1 (${Math.min(...refLines)}-${Math.max(...refLines)} lines at ${SIZES.join('/')} px): `
    + `${[...wrap].map(([s, w]) => `s=${s} ${w.same}/${w.n}`).join('; ')}${wrapBad.length ? `; first: ${wrapBad.join(', ')}` : ''}`);

  const fitBad = [];
  const fitAll = [];
  for (const c of boards) {
    const m = got(c).m0;
    const g = gridOf(c, m);
    const wantH = Math.max(m.ch, g.gridH);
    const ok = m.sw <= m.iw && Math.abs(m.sh - wantH) <= 2 && Math.abs(m.board[3] - g.gridH) <= 2;
    const line = `${c.id} scrollWidth ${m.sw}/innerWidth ${m.iw} scrollHeight ${m.sh} want ${r2(wantH)} board ${r2(m.board[3])}/${r2(g.gridH)}`
      + `${m.iw !== m.cw ? ` scrollbar ${m.iw - m.cw}` : ''}`;
    fitAll.push(line);
    if (!ok) fitBad.push(line);
  }
  add(fitBad.length === 0, 'r5-fits', fitBad.length ? `FAIL on ${fitBad.join('; ')}` : `scrollWidth <= innerWidth and scrollHeight = max(clientHeight, grid) within 2 px: ${fitAll.join('; ')}`);

  const ovBad = [];
  let ovSeen = 0;
  let ovTiles = 0;
  each((c, t) => {
    const want = OVERFLOWS[t.shape];
    const x = t.sw > t.cw + 1;
    const y = t.sh > t.ch + 1;
    ovTiles += 1;
    if (want[0] || want[1]) ovSeen += 1;
    if (x !== want[0] || y !== want[1]) {
      if (ovBad.length < 4) ovBad.push(`${c.id}/${t.id} ${t.shape} scroll ${t.sw}×${t.sh} client ${t.cw}×${t.ch}`);
      else ovBad.push('');
    }
  });
  add(ovBad.length === 0 && ovSeen > 0, 'r6-overflow', `scroll > client + 1 per axis (4 px past one edge, well past both, a full-bleed child, slots): `
    + `${ovTiles - ovBad.length}/${ovTiles} tiles as expected, ${ovSeen} overflowing${ovBad.length ? `; first: ${ovBad.filter(Boolean).join(', ')}` : ''}`);

  const sc = CASES.find((c) => c.scroll);
  const { m0, m1 } = got(sc);
  const moved = worst();
  if (m1) {
    m0.tiles.forEach((t, i) => {
      const u = m1.tiles[i];
      for (const key of ['rect', 'box', 'tail']) if (t[key] && u && u[key]) moved.add(dev(t[key], u[key]), `${t.id} ${key} ${fmt(t[key])}→${fmt(u[key])}`);
    });
  }
  add(m1 && m0.sy === 0 && Math.abs(m1.sy - sc.scroll) <= 0.5 && moved.n > 0 && moved.d <= 1, 'r7-scroll',
    `${m1 ? `scrollY ${m0.sy}→${m1.sy} (asked ${sc.scroll}), doc coordinates of tiles, boxes and tails max |Δ| ${r2(moved.d)} px over ${moved.n} rects (worst ${moved.where})` : 'no measurement after the scroll'}`);
  return rows;
}

function printReport(report, header) {
  console.log(header);
  console.log(`# board-scale shipped=${BOARD_SCALE} css-zoom-supported=${(report.reports || {})['zoom/ref']?.zoom ?? '?'} `
    + `page-dpr=${report.dpr} unmatched=${report.unmatched}`);
  const byMode = new Map(MODES.map((mode) => [mode, modeRows(mode, report)]));
  for (const rows of byMode.values()) for (const r of rows) console.log(`${r.ok ? 'ok' : 'FAIL'} ${r.id} ${r.detail}`);
  const clean = MODES.find((mode) => byMode.get(mode).every((r) => r.ok));
  console.log(`verdict: ${clean || 'none'}`);
  return byMode.get(BOARD_SCALE).every((r) => r.ok) ? 0 : 1;
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

async function probeBrowser({ name, dpr }) {
  const server = http.createServer(createHandler());
  const port = await listen(server);
  const browser = await { chromium, firefox, webkit }[name].launch(launchOptions(name));
  try {
    // bypassCSP stays false: the build CSP applies, as in the product.
    const ctx = await browser.newContext({ bypassCSP: false, deviceScaleFactor: dpr, viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: PAGE_WAIT_MS });
    const deadline = Date.now() + PAGE_WAIT_MS;
    let report = null;
    while (!report && Date.now() < deadline) {
      report = await page.evaluate(() => (window.__probe && window.__probe.done ? window.__probe : null));
      if (!report) await new Promise((r) => setTimeout(r, 200));
    }
    const header = `# r8 probe ${new Date().toISOString()} browser=${name} version=${browser.version()} os=${process.platform} dpr=${dpr}`;
    if (!report) {
      console.log(header);
      console.log('FAIL setup the parent page never finished');
      return 1;
    }
    return printReport(report, header);
  } finally {
    await browser.close();
    stop(server);
  }
}

async function serveForSafari() {
  let gotReport;
  const reported = new Promise((r) => { gotReport = r; });
  const server = http.createServer(createHandler({ onReport: (rep) => gotReport(rep) }));
  const port = await listen(server);
  console.log(`# serve http://localhost:${port}/?serve=1`);
  let timer;
  const timedOut = new Promise((r) => { timer = setTimeout(() => r(null), SERVE_WAIT_MS); });
  const report = await Promise.race([reported, timedOut]);
  clearTimeout(timer);
  stop(server);
  if (!report || report.invalid) {
    console.log(`not reached safari ${report ? 'the report was not JSON' : `no report within ${SERVE_WAIT_MS / 1000}s`}`);
    return 2;
  }
  const version = /Version\/(\S+)/.exec(String(report.ua))?.[1] || 'unknown';
  return printReport(report, `# r8 probe ${new Date().toISOString()} browser=safari version=${version} os=${process.platform} `
    + `ua=${String(report.ua).replace(/\s+/g, '_')}`);
}

function parseArgs(argv) {
  const o = { browser: null, serve: false, dpr: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--browser') o.browser = argv[(i += 1)];
    else if (a === '--serve') o.serve = true;
    else if (a === '--dpr') o.dpr = Number(argv[(i += 1)]);
    else return { error: `unknown flag ${a}` };
  }
  if (o.serve && o.browser) return { error: '--serve takes no --browser (real Safari)' };
  if (!o.serve && !['chromium', 'firefox', 'webkit'].includes(o.browser)) return { error: '--browser must be chromium, firefox or webkit' };
  if (!(o.dpr >= 1 && o.dpr <= 4)) return { error: '--dpr must be a number from 1 to 4' };
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.error) {
    console.error(`${o.error}\nusage: probe.mjs --browser chromium|firefox|webkit [--dpr <n>] | --serve`);
    return 64;
  }
  setTimeout(() => { console.log(`FAIL setup the probe hit its ${HARD_LIMIT_MS / 1000}s hard limit`); process.exit(1); }, HARD_LIMIT_MS).unref();
  return o.serve ? serveForSafari() : probeBrowser({ name: o.browser, dpr: o.dpr });
}

main().then((code) => process.exit(code), (e) => { console.log(`FAIL setup ${String(e && e.message || e).split('\n')[0]}`); process.exit(1); });
