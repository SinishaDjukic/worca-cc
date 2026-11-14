// tools/spikes/design-preview-r5/probe.mjs — Design P3 Task 1 (risk R5): does C-7's CSP behave as designed in a real,
// opaque, sandboxed frame? Standalone: node:http (node:https with --tls), playwright-core, and Chrome from findChrome().
// manual: needs a real browser, not part of npm test (M3, M14).
//
//   node tools/spikes/design-preview-r5/probe.mjs --browser chromium|firefox|webkit [--tls [--default-port]]
//   node tools/spikes/design-preview-r5/probe.mjs --serve [--open-safari]
//
// --tls serves over https with a throwaway cert; p10 and p11 then compare {B} as http:// and https://. The page is
// https://localhost:<port>/; --default-port loads https://r5-probe.test/ through a local CONNECT proxy instead, so the
// Host carries no port, as behind a real TLS proxy. --serve prints a URL for real Safari and waits for its report;
// --open-safari opens it with `open -a Safari`.
//
// Prints `ok|FAIL <id> <detail>` per check (rows p1-p12 of the plan's Task 1 table) after `#` header lines.
// Exit 0 when every row is ok, 1 on any FAIL, 2 when --serve got no report in time (`not reached`).
//
// The shell page `/` carries worca's literal shell CSP and frames two docs (build, run) under C-7's literal CSPs and
// headers, exactly as P4 will: `sandbox="allow-scripts"`, `referrerpolicy="no-referrer"`, a served URL. Each doc
// reports to the parent by postMessage; the server logs every request under the token path and `/outside.png`, so
// the verdicts combine what the frame saw with what reached the server.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';
import { findChrome } from '../../../assets/deck-preview/chrome.mjs';

// src/core/index-html.mjs:18, byte for byte. ui/server.mjs sends it with X-Frame-Options: DENY.
const SHELL_CSP = "script-src 'self' 'wasm-unsafe-eval'; base-uri 'none'; frame-ancestors 'none'";
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');
const FONT = readFileSync(new URL('../../../node_modules/@fontsource/poppins/files/poppins-latin-400-normal.woff2', import.meta.url));
const PAGE_WAIT_MS = 30000;
const SERVE_WAIT_MS = 90000;
const HARD_LIMIT_MS = 140000;
const PROXY_HOST = 'r5-probe.test';

/** C-7's CSP for one doc, byte for byte (SPEC C-7; plan Task 3's tests spell the same strings). */
function docCsp(mode, B, nonce) {
  const script = mode === 'build' ? `'nonce-${nonce}'` : `'unsafe-inline' ${B}`;
  const connect = mode === 'build' ? "'none'" : B;
  return `sandbox allow-scripts; default-src 'none'; script-src ${script}; style-src 'unsafe-inline' ${B}; `
    + `img-src ${B} data: blob:; font-src ${B} data:; media-src ${B} data: blob:; connect-src ${connect}; `
    + "frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
}

/** The six headers of every token-verified response (plan Global Constraints). */
function previewHeaders(csp) {
  return {
    'Content-Security-Policy': csp,
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  };
}

/** A real-shaped token (plan: randomBytes(32).toString('base64url')) that holds both `-` and `_`, so every run puts
 *  the two non-alphanumeric base64url characters into the CSP path sources. */
function mintToken() {
  for (;;) {
    const t = randomBytes(32).toString('base64url');
    if (t.includes('-') && t.includes('_')) return t;
  }
}

// Model JS: each vector records itself in the frame and tells the parent directly, so a vector that runs is seen
// even when the doc's own reporter is broken. No spaces, so the same text works as a `javascript:` URL.
const MODEL = (via) => `void((window.__mj=window.__mj||[]).push('${via}'),parent.postMessage({probe:'modeljs',via:'${via}'},'*'))`;
const P_CSS = '/* probe-css */\n#css-probe { color: rgb(1, 2, 3); }\n';
// Served as real JavaScript, so in the build doc only the CSP can stop it.
const P_JS = `${MODEL('script-src-file')};\n`;
const ASSETS = {
  'assets/p.css': ['text/css; charset=utf-8', Buffer.from(P_CSS)],
  'assets/p.png': ['image/png', PNG],
  'assets/p.woff2': ['font/woff2', FONT],
  'assets/p.js': ['text/javascript; charset=utf-8', Buffer.from(P_JS)],
};

/* The functions below run in the browser; they are inlined with Function.prototype.toString and use nothing from
 * this module's scope. */

function parentMain() {
  const q = new URLSearchParams(location.search);
  const token = q.get('t') || '';
  const srcs = (q.get('src') || 'http').split(',');
  const serve = q.get('serve') === '1';
  const out = { ua: navigator.userAgent, page: location.protocol.replace(':', ''), frames: {}, unmatched: 0, violations: [], done: false };
  const status = (t) => { document.getElementById('status').textContent = t; };
  document.addEventListener('securitypolicyviolation', (e) => {
    out.violations.push(`${e.effectiveDirective || e.violatedDirective} ${String(e.blockedURI || '').slice(0, 120)}`);
  });
  const frames = [];
  for (const src of srcs) {
    for (const mode of ['build', 'run']) {
      const name = `${mode}@${src}`;
      const el = document.createElement('iframe');
      el.setAttribute('sandbox', 'allow-scripts');
      el.setAttribute('referrerpolicy', 'no-referrer');
      el.title = name;
      out.frames[name] = { loads: 0, origins: [], boot: null, final: null, modeljs: [] };
      el.addEventListener('load', () => { out.frames[name].loads += 1; });
      el.src = `/design-preview/${token}/${mode}/?src=${src}#n=probe`;
      frames.push({ name, el });
      document.getElementById('frames').appendChild(el);
    }
  }
  window.addEventListener('message', (e) => {
    const f = frames.find((x) => x.el.contentWindow === e.source);
    if (!f) { out.unmatched += 1; return; }
    const st = out.frames[f.name];
    const d = e.data && typeof e.data === 'object' ? e.data : {};
    if (!st.origins.includes(String(e.origin))) st.origins.push(String(e.origin));
    if (d.probe === 'boot') st.boot = d;
    else if (d.probe === 'final') st.final = d;
    else if (d.probe === 'modeljs') st.modeljs.push(String(d.via));
  });
  const deadline = Date.now() + 15000;
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
    if (frames.every((f) => out.frames[f.name].final) || Date.now() > deadline) setTimeout(finish, 500);
    else setTimeout(tick, 100);
  };
  tick();
}

function buildBridge() {
  const post = (m) => parent.postMessage(m, '*');
  const violations = [];
  const trig = { onerror: false, onload: false };
  document.addEventListener('securitypolicyviolation', (e) => {
    violations.push(`${e.effectiveDirective || e.violatedDirective} ${String(e.blockedURI || '')}`.slice(0, 160));
  });
  // Capture listeners prove the inline-handler targets really got their events, so "did not run" means blocked.
  document.addEventListener('error', (e) => { if (e.target && e.target.id === 'h-err') trig.onerror = true; }, true);
  document.addEventListener('load', (e) => { if (e.target && e.target.id === 'h-load') trig.onload = true; }, true);
  post({ probe: 'boot', doc: 'build', origin: String(self.origin) });
  window.addEventListener('load', () => {
    const anchor = document.getElementById('js-anchor');
    if (anchor) anchor.click();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const fontLoad = document.fonts.load('16px ProbeFont').then((l) => `resolved ${l.length}`, (e) => `rejected ${e.name}`);
    Promise.race([fontLoad, wait(4000).then(() => 'timeout')]).then(async (load) => {
      await wait(500);
      const faces = [];
      document.fonts.forEach((f) => { if (f.family.replace(/["']/g, '') === 'ProbeFont') faces.push(f.status); });
      const img = (id) => { const i = document.getElementById(id); return { complete: i.complete, w: i.naturalWidth }; };
      const link = document.querySelector('link[rel=stylesheet]');
      post({
        probe: 'final', doc: 'build', origin: String(self.origin),
        css: { color: getComputedStyle(document.getElementById('css-probe')).color, sheet: Boolean(link && link.sheet) },
        imgIn: img('img-in'), imgOut: img('img-out'), font: { load, faces },
        trig, clicked: Boolean(anchor), mj: (window.__mj || []).slice(), violations,
      });
    });
  });
}

function runBridge() {
  const post = (m) => parent.postMessage(m, '*');
  const violations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    violations.push(`${e.effectiveDirective || e.violatedDirective} ${String(e.blockedURI || '')}`.slice(0, 160));
  });
  post({ probe: 'boot', doc: 'run', origin: String(self.origin) });
  window.addEventListener('load', async () => {
    const src = new URLSearchParams(location.search).get('src') || 'http';
    const attempt = async (url, needle) => {
      try {
        const r = await fetch(url);
        const t = await r.text();
        return r.ok && t.includes(needle) ? 'ok' : `status ${r.status}`;
      } catch (e) { return `rejected ${e.name}`; }
    };
    const inside = await attempt(`assets/p.css?src=${src}`, 'probe-css');
    const outside = await attempt(`/outside.png?from=run-fetch&src=${src}`, '');
    await new Promise((r) => setTimeout(r, 300));
    post({ probe: 'final', doc: 'run', origin: String(self.origin), fetch: { inside, outside }, mj: (window.__mj || []).slice(), violations });
  });
}

const SHELL_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>worca R5 probe</title></head><body>'
  + '<h1>worca R5 probe</h1><p id="status">running</p><div id="frames"></div><script src="/parent.js"></script></body></html>';
const PARENT_JS = `(${parentMain})();\n`;

function buildDoc({ nonce, src }) {
  const q = `?src=${src}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>build</title>
<script nonce="${nonce}">(${buildBridge})();</script>
<link rel="stylesheet" href="assets/p.css${q}">
<style>@font-face{font-family:ProbeFont;src:url("assets/p.woff2${q}") format("woff2")}#font-probe{font-family:ProbeFont,monospace}</style>
<script src="assets/p.js${q}"></script>
<script>${MODEL('inline-script')}</script>
</head><body>
<p id="css-probe">css probe</p>
<p id="font-probe">font probe</p>
<img id="img-in" alt="" src="assets/p.png${q}">
<img id="img-out" alt="" src="/outside.png?from=build-img&amp;src=${src}">
<img id="h-err" alt="" src="data:," onerror="${MODEL('onerror')}">
<img id="h-load" alt="" src="data:image/png;base64,${PNG_B64}" onload="${MODEL('onload')}">
<a id="js-anchor" href="javascript:${MODEL('javascript-url')}">anchor</a>
</body></html>`;
}

function runDoc({ src }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>run</title>
<script>(${runBridge})();</script>
<script>${MODEL('inline-script')}</script>
<script src="assets/p.js?src=${src}"></script>
</head><body><p>run doc</p></body></html>`;
}

/** The probe's request handler. `log` gets one entry per request under the token path or `/outside.png`. */
function createHandler({ token, log, onReport = null }) {
  return (req, res) => {
    const url = new URL(req.url, 'http://probe.invalid');
    const send = (status, type, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...headers });
      res.end(body);
    };
    if (req.method === 'POST' && url.pathname === '/report' && onReport) {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => { size += c.length; if (size <= 1 << 20) chunks.push(c); });
      req.on('end', () => {
        send(204, 'text/plain', '');
        try { onReport(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { onReport({ invalid: true }); }
      });
      return;
    }
    if (req.method !== 'GET') return send(405, 'text/plain', '');
    if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', SHELL_HTML, { 'Content-Security-Policy': SHELL_CSP, 'X-Frame-Options': 'DENY' });
    if (url.pathname === '/parent.js') return send(200, 'text/javascript; charset=utf-8', PARENT_JS, { 'Cache-Control': 'no-store' });
    const m = /^\/design-preview\/([^/]+)\/(build|run)\/(.*)$/.exec(url.pathname);
    const src = url.searchParams.get('src') === 'https' ? 'https' : 'http';
    const entry = {
      path: url.pathname, token: m ? m[1] : null, mode: m ? m[2] : null, rest: m ? m[3] : null, src,
      from: url.searchParams.get('from'), origin: req.headers.origin ?? null,
      site: req.headers['sec-fetch-site'] ?? null, dest: req.headers['sec-fetch-dest'] ?? null,
      fetchMode: req.headers['sec-fetch-mode'] ?? null, acao: null, status: 0,
    };
    const answer = (status, type, body, headers) => {
      entry.acao = headers['Access-Control-Allow-Origin'] ?? null;
      entry.status = status;
      log.push(entry);
      send(status, type, body, headers);
    };
    // Negative control: same host, outside the token path. It sends ACAO * too, so only the CSP can stop a fetch.
    if (url.pathname === '/outside.png') {
      return answer(200, 'image/png', PNG, { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': 'no-store' });
    }
    if (!m || m[1] !== token) return send(404, 'text/plain', '');
    const mode = m[2];
    const B = `${src}://${req.headers.host}/design-preview/${token}/`;
    const nonce = randomBytes(16).toString('base64url');
    const headers = previewHeaders(docCsp(mode, B, nonce));
    if (m[3] === '') {
      return answer(200, 'text/html; charset=utf-8', mode === 'build' ? buildDoc({ nonce, src }) : runDoc({ src }), headers);
    }
    const asset = ASSETS[m[3]];
    if (!asset) return answer(404, 'text/plain', '', headers);
    return answer(200, asset[0], asset[1], headers);
  };
}

/** One {B} variant's rows, keyed by id, from the parent's report and the server log. Pure. */
function variantRows({ report, log, token, src }) {
  const rows = {};
  const add = (ok, id, detail) => { rows[id] = { ok: Boolean(ok), id, detail: detail.replace(/\s+/g, ' ').trim() }; };
  const frames = (report && report.frames) || {};
  const b = frames[`build@${src}`] || { origins: [], modeljs: [] };
  const r = frames[`run@${src}`] || { origins: [], modeljs: [] };
  const bf = b.final;
  const rf = r.final;
  const hits = log.filter((e) => e.token === token && e.src === src);
  const asset = (mode, rest) => hits.filter((e) => e.mode === mode && e.rest === rest);
  const outside = (from) => log.filter((e) => e.path === '/outside.png' && e.from === from && e.src === src);

  add(b.boot, 'p1-nonce-runs', b.boot ? 'the build doc nonce script ran' : 'no message from the build doc nonce script');

  const ran = [...new Set([...(b.modeljs || []), ...((bf && bf.mj) || [])])];
  const triggered = bf && bf.trig && bf.trig.onerror && bf.trig.onload && bf.clicked;
  let p2;
  if (ran.length) p2 = `ran: ${ran.join(',')}`;
  else if (!triggered) p2 = `inconclusive: no proof the handlers fired and the anchor was clicked (${JSON.stringify(bf ? { trig: bf.trig, clicked: bf.clicked } : null)})`;
  else p2 = `none of inline-script, script-src-file, onerror, onload, javascript-url ran; ${bf.violations.length} CSP violations reported in the doc`;
  add(!ran.length && triggered, 'p2-no-model-js', p2);

  const selfOrigins = [b.boot && b.boot.origin, r.boot && r.boot.origin];
  const msgOrigins = [...(b.origins || []), ...(r.origins || [])];
  const p3 = selfOrigins.every((o) => o === 'null') && msgOrigins.every((o) => o === 'null')
    && (b.origins || []).length > 0 && (r.origins || []).length > 0 && report.unmatched === 0;
  add(p3, 'p3-opaque', `self.origin build=${selfOrigins[0]} run=${selfOrigins[1]}; e.origin build=${JSON.stringify(b.origins)} `
    + `run=${JSON.stringify(r.origins)}; e.source matched frame.contentWindow for every message (unmatched=${report.unmatched})`);

  const css = asset('build', 'assets/p.css');
  const png = asset('build', 'assets/p.png');
  const p4 = bf && bf.css.color === 'rgb(1, 2, 3)' && bf.css.sheet && bf.imgIn.w > 0 && css.length > 0 && png.length > 0;
  add(p4, 'p4-path-css-img', `${bf ? `link color=${bf.css.color} sheet=${bf.css.sheet} img naturalWidth=${bf.imgIn.w}` : 'no final report'}; `
    + `server saw p.css ${css.length}x, p.png ${png.length}x`);

  // A CORS font request must carry Origin: null and get ACAO *. WebKit fetches @font-face no-cors: no Origin, and
  // ACAO is not consulted; such a request still counts when the font loads.
  const font = asset('build', 'assets/p.woff2');
  const fontShape = (e) => e.acao === '*' && (e.origin === 'null' || (e.origin === null && e.fetchMode === 'no-cors'));
  const p5 = bf && bf.font.faces.includes('loaded') && font.length > 0 && font.every(fontShape);
  add(p5, 'p5-path-font', `${bf ? `font faces=${JSON.stringify(bf.font.faces)} load=${bf.font.load}` : 'no final report'}; `
    + `server saw p.woff2 ${font.length}x with Origin=${font.map((e) => e.origin ?? 'absent').join(',') || '-'} `
    + `Sec-Fetch-Mode=${font.map((e) => e.fetchMode ?? 'absent').join(',') || '-'} answered ACAO=${font.map((e) => e.acao ?? 'absent').join(',') || '-'}`);

  const out6 = outside('build-img');
  add(bf && bf.imgOut.w === 0 && out6.length === 0, 'p6-path-enforced',
    `${bf ? `/outside.png img naturalWidth=${bf.imgOut.w}` : 'no final report'}; server saw it ${out6.length}x`);

  add(r.boot && (r.modeljs || []).includes('inline-script'), 'p7-run-inline',
    `run bridge (inline, no nonce) ${r.boot ? 'ran' : 'did not run'}; model inline-script `
    + `${(r.modeljs || []).includes('inline-script') ? 'ran' : 'did not run'}; assets/p.js under {B} `
    + `${(r.modeljs || []).includes('script-src-file') ? 'ran' : 'did not run'}`);

  const out8 = outside('run-fetch');
  add(rf && rf.fetch.inside === 'ok' && rf.fetch.outside.startsWith('rejected') && out8.length === 0, 'p8-run-connect',
    `${rf ? `fetch(assets/p.css)=${rf.fetch.inside} fetch(/outside.png)=${rf.fetch.outside}` : 'no final report'}; server saw /outside.png ${out8.length}x`);

  const subs = hits.filter((e) => e.rest !== '');
  const sites = [...new Set(subs.map((e) => `${e.mode}/${e.rest.replace('assets/', '')}=${e.site}`))];
  add(subs.length > 0 && subs.every((e) => e.site === 'cross-site'), 'p9-fetch-metadata',
    subs.length ? `Sec-Fetch-Site ${sites.join(' ')}` : 'no subresource request seen');

  const docs = hits.filter((e) => e.rest === '');
  const sawDoc = (mode) => docs.some((e) => e.mode === mode && e.status === 200);
  const frameViolations = (report.violations || []).filter((v) => /^(frame-src|child-src|default-src)/.test(v));
  const p12 = sawDoc('build') && sawDoc('run') && b.loads > 0 && r.loads > 0 && Boolean(b.boot || r.boot) && frameViolations.length === 0;
  add(p12, 'p12-shell-frames', `under the shell CSP: server served build=${sawDoc('build')} run=${sawDoc('run')}; frame loads `
    + `build=${b.loads} run=${r.loads}; frames reported=${Boolean(b.boot || r.boot)}; parent violations=${JSON.stringify(report.violations || [])}`);
  return rows;
}

const BASE_IDS = ['p1-nonce-runs', 'p2-no-model-js', 'p3-opaque', 'p4-path-css-img', 'p5-path-font', 'p6-path-enforced',
  'p7-run-inline', 'p8-run-connect', 'p9-fetch-metadata', 'p12-shell-frames'];

/** Rows in print order. Plain: p1-p9 and p12 with {B} as http://. --tls: the same rows with {B} as https:// on the
 *  https page, then p10 ({B} as http:// on that page, as behind a proxy that sends no X-Forwarded-Proto) and p11. Pure. */
function verdicts({ report, log, token, tls }) {
  const main = variantRows({ report, log, token, src: tls ? 'https' : 'http' });
  const rows = BASE_IDS.map((id) => main[id]);
  if (!tls) return rows;
  const h = variantRows({ report, log, token, src: 'http' });
  const both = (v) => v['p4-path-css-img'].ok && v['p5-path-font'].ok;
  const brief = (v, id) => `${id.split('-')[0]} ${v[id].ok ? 'ok' : 'FAIL'} (${v[id].detail})`;
  rows.push({
    ok: both(h), id: 'p10-http-source-on-https',
    detail: `{B}=http:// on the https page: ${brief(h, 'p4-path-css-img')}; ${brief(h, 'p5-path-font')}; `
      + `same {B} in the run doc, for P8: ${brief(h, 'p7-run-inline')}; ${brief(h, 'p8-run-connect')}`,
  });
  rows.push({
    ok: both(main), id: 'p11-https-source',
    detail: `{B}=https://: p4 ${main['p4-path-css-img'].ok ? 'ok' : 'FAIL'}, p5 ${main['p5-path-font'].ok ? 'ok' : 'FAIL'}`,
  });
  return rows;
}

function printRows(rows) {
  for (const r of rows) console.log(`${r.ok ? 'ok' : 'FAIL'} ${r.id} ${r.detail}`);
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

/** A throwaway self-signed cert, made in a mkdtemp folder that is removed before this returns. */
function throwawayCert() {
  const dir = mkdtempSync(join(tmpdir(), 'r5-cert-'));
  try {
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-days', '1',
      '-keyout', keyPath, '-out', certPath], { stdio: 'ignore' });
    return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function launchOptions(name) {
  if (name !== 'chromium') return { headless: true };
  const executablePath = findChrome();
  if (!executablePath) throw new Error('no Chrome found: findChrome() returned null (set WORCA_CHROME)');
  const noSandbox = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0;
  return { executablePath, headless: true, args: noSandbox ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] };
}

/** --default-port: an HTTP CONNECT proxy that tunnels only `r5-probe.test:443` to the probe's https server, so the page
 *  is https://r5-probe.test/ and its Host carries no port, as behind a TLS proxy on the default port. Binding 443
 *  itself needs root. */
function connectProxy(targetPort) {
  const sockets = new Set();
  const track = (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); };
  const server = http.createServer((req, res) => { res.writeHead(403); res.end(); });
  server.on('connect', (req, client, head) => {
    track(client);
    client.on('error', () => client.destroy());
    if (req.url !== `${PROXY_HOST}:443`) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const upstream = connect(targetPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    track(upstream);
    upstream.on('error', () => client.destroy());
  });
  return { server, close() { for (const s of sockets) s.destroy(); stop(server); } };
}

async function probeBrowser({ name, tls, defaultPort }) {
  const token = mintToken();
  const log = [];
  const handler = createHandler({ token, log });
  const server = tls ? https.createServer(throwawayCert(), handler) : http.createServer(handler);
  const port = await listen(server);
  const proto = tls ? 'https' : 'http';
  const srcs = tls ? ['https', 'http'] : ['http'];
  const launch = launchOptions(name);
  let proxy = null;
  if (defaultPort) {
    proxy = connectProxy(port);
    launch.proxy = { server: `http://127.0.0.1:${await listen(proxy.server)}` };
  }
  const host = defaultPort ? PROXY_HOST : `localhost:${port}`;
  const browser = await { chromium, firefox, webkit }[name].launch(launch);
  try {
    // bypassCSP stays false: the CSP under test must apply.
    const ctx = await browser.newContext({ ignoreHTTPSErrors: tls, bypassCSP: false });
    const page = await ctx.newPage();
    await page.goto(`${proto}://${host}/?t=${token}&src=${srcs.join(',')}`, { waitUntil: 'load', timeout: PAGE_WAIT_MS });
    const deadline = Date.now() + PAGE_WAIT_MS;
    let report = null;
    while (!report && Date.now() < deadline) {
      report = await page.evaluate(() => (window.__probe && window.__probe.done ? window.__probe : null));
      if (!report) await new Promise((r) => setTimeout(r, 200));
    }
    console.log(`# r5 probe ${new Date().toISOString()} browser=${name} version=${browser.version()} page=${proto} host=${host}`
      + `${defaultPort ? ' (default port, through a CONNECT proxy)' : ''} os=${process.platform}`);
    if (!report) {
      console.log('FAIL setup the parent page never finished');
      return 1;
    }
    return printRows(verdicts({ report, log, token, tls }));
  } finally {
    await browser.close();
    if (proxy) proxy.close();
    stop(server);
  }
}

async function serveForSafari({ openSafari }) {
  const token = mintToken();
  const log = [];
  let gotReport;
  const reported = new Promise((r) => { gotReport = r; });
  const server = http.createServer(createHandler({ token, log, onReport: (rep) => gotReport(rep) }));
  const port = await listen(server);
  const url = `http://localhost:${port}/?t=${token}&src=http&serve=1`;
  console.log(`# serve ${url}`);
  let openNote = '';
  if (openSafari) {
    const child = spawn('open', ['-a', 'Safari', url], { stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', (c) => { openNote += c.toString(); });
    child.on('error', (e) => { openNote += e.message; });
    child.on('exit', (code) => { if (code) openNote += ` (open exit ${code})`; });
  }
  let timer;
  const timedOut = new Promise((r) => { timer = setTimeout(() => r(null), SERVE_WAIT_MS); });
  const report = await Promise.race([reported, timedOut]);
  clearTimeout(timer);
  stop(server);
  if (!report || report.invalid) {
    const why = report ? 'the report was not JSON' : `no report within ${SERVE_WAIT_MS / 1000}s`;
    console.log(`not reached safari ${why}; requests seen=${log.length}${openNote ? `; open: ${openNote.trim()}` : ''}`);
    return 2;
  }
  const version = /Version\/(\S+)/.exec(String(report.ua))?.[1] || 'unknown';
  console.log(`# r5 probe ${new Date().toISOString()} browser=safari version=${version} page=http host=localhost:${port} os=${process.platform} `
    + `ua=${String(report.ua).replace(/\s+/g, '_')}`);
  return printRows(verdicts({ report, log, token, tls: false }));
}

function parseArgs(argv) {
  const o = { browser: null, tls: false, defaultPort: false, serve: false, openSafari: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--browser') o.browser = argv[(i += 1)];
    else if (a === '--tls') o.tls = true;
    else if (a === '--default-port') o.defaultPort = true;
    else if (a === '--serve') o.serve = true;
    else if (a === '--open-safari') o.openSafari = true;
    else return { error: `unknown flag ${a}` };
  }
  if (o.serve && (o.browser || o.tls || o.defaultPort)) return { error: '--serve takes no --browser, --tls or --default-port (real Safari over plain http)' };
  if (o.defaultPort && !o.tls) return { error: '--default-port needs --tls' };
  if (!o.serve && !['chromium', 'firefox', 'webkit'].includes(o.browser)) return { error: '--browser must be chromium, firefox or webkit' };
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.error) {
    console.error(`${o.error}\nusage: probe.mjs --browser chromium|firefox|webkit [--tls [--default-port]] | --serve [--open-safari]`);
    return 64;
  }
  setTimeout(() => { console.log(`FAIL setup the probe hit its ${HARD_LIMIT_MS / 1000}s hard limit`); process.exit(1); }, HARD_LIMIT_MS).unref();
  return o.serve ? serveForSafari(o) : probeBrowser({ name: o.browser, tls: o.tls, defaultPort: o.defaultPort });
}

main().then((code) => process.exit(code), (e) => { console.log(`FAIL setup ${String(e && e.message || e).split('\n')[0]}`); process.exit(1); });
