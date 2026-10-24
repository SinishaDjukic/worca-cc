// tools/mock-artifact/check.mjs — the check half of the mock artifact (docs/screenshots.md#mock-artifact). Opens the
// built page in headless Chrome and walks the recording's views the way record.mjs did, then reports:
//   - every request the mock could not answer (a missing view or endpoint: re-record),
//   - page errors,
//   - per view, the share of pixels that differ from the real app's screenshot (when real-shots/ is there).
// A view over the limit is shot once more on its own first (a headless frame can paint late).
//
//   node tools/mock-artifact/check.mjs <dir> [--max-diff 2]    <dir> holds worca-mock.html, rec.json, real-shots/
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPEN_TABS, STILL, shotName } from './record.mjs';

const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Share (percent) of pixels where any channel differs by more than 24. Each 64 px band of rows is compared at its
 *  best vertical offset within ±MAX_SHIFT px: content that sits a pixel or two lower (a list that scrolled a little
 *  further, a row that laid out 2 px taller) is not a visual change. Runs in the page, on two PNG URLs. */
const MAX_SHIFT = 4;
const DIFF_FN = `async (a, b) => {
  const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('cannot load ' + src)); i.src = src; });
  const [x, y] = await Promise.all([load(a), load(b)]);
  if (x.width !== y.width || x.height !== y.height) return { size: [x.width, x.height, y.width, y.height] };
  const px = (img) => { const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
  const p = px(x); const q = px(y); const w = x.width; const h = x.height; const S = ${MAX_SHIFT}; const BAND = 64;
  const rowDiff = (r, dy) => { let n = 0; const i0 = r * w * 4; const j0 = (r + dy) * w * 4;
    for (let k = 0; k < w * 4; k += 4) { const i = i0 + k; const j = j0 + k;
      if (Math.abs(p[i] - q[j]) > 24 || Math.abs(p[i + 1] - q[j + 1]) > 24 || Math.abs(p[i + 2] - q[j + 2]) > 24) n += 1; }
    return n; };
  let total = 0;
  for (let top = S; top < h - S; top += BAND) {
    const end = Math.min(top + BAND, h - S);
    let best = Infinity;
    for (const dy of [0, -1, 1, -2, 2, -3, 3, -4, 4].filter((d) => Math.abs(d) <= S)) {
      let n = 0;
      for (let r = top; r < end && n < best; r += 1) n += rowDiff(r, dy);
      best = Math.min(best, n);
      if (best === 0) break;
    }
    total += best;
  }
  return { pct: (100 * total) / (w * (h - 2 * S)) };
}`;

/** A static server on 127.0.0.1 for the built page and both shot folders; port 0 picks a free one. */
export async function serveDir(dir, port = 0) {
  const root = path.resolve(dir);
  const srv = http.createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // A blank page of this origin for the pixel diff: Chrome swaps a 404 for its own error page, another origin.
    if (p === '/blank.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>diff</title>'); return; }
    const file = path.join(root, path.normalize(p === '/' ? '/worca-mock.html' : p));
    if (!file.startsWith(root + path.sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'image/png', 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(500).end(); }
  });
  await new Promise((r, j) => { srv.once('error', j); srv.listen(port, '127.0.0.1', r); });
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}

export async function checkMock(dir, { maxDiff = 2, cdpPort = Number(process.env.CDP_PORT || 9371), log = console.error } = {}) {
  const rec = JSON.parse(await readFile(path.join(dir, 'rec.json'), 'utf8'));
  const realDir = path.join(dir, 'real-shots');
  const mockDir = path.join(dir, 'mock-shots');
  await mkdir(mockDir, { recursive: true });
  const compare = existsSync(realDir);

  const { srv, base } = await serveDir(dir);

  const chromeBin = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p));
  if (!chromeBin) throw new Error('no Chrome found - set CHROME_BIN');
  const profile = await mkdtemp(path.join(os.tmpdir(), 'worca-mock-check-'));
  const chrome = spawn(chromeBin, ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', '--force-color-profile=srgb', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
  // Stopped even when this process dies on an uncaught error.
  const killChrome = () => { try { chrome.kill('SIGKILL'); } catch { /* already gone */ } };
  process.once('exit', killChrome);
  try {
    let wsUrl = null;
    for (let i = 0; i < 150 && !wsUrl; i += 1) {
      try { wsUrl = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up yet */ }
      if (!wsUrl) await sleep(200);
    }
    if (!wsUrl) throw new Error(`Chrome did not open its debugging port ${cdpPort} (taken? set CDP_PORT)`);
    const sock = new WebSocket(wsUrl);
    await new Promise((r, j) => { sock.onopen = r; sock.onerror = j; });
    let id = 0; const pending = new Map(); const errors = [];
    sock.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    };
    const cdp = (method, params = {}) => new Promise((r, j) => { const i = ++id; pending.set(i, (m) => (m.error ? j(new Error(`${method}: ${m.error.message}`)) : r(m.result))); sock.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expression) => (await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value;
    const kick = () => cdp('Page.captureScreenshot', { format: 'jpeg', quality: 1, clip: { x: 0, y: 0, width: 16, height: 16, scale: 1 } });
    await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
    await cdp('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1728, height: 1117, deviceScaleFactor: 2, mobile: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    if (rec.timeZone) await cdp('Emulation.setTimezoneOverride', { timezoneId: rec.timeZone });
    const open = async (route) => { await cdp('Page.navigate', { url: `${base}/worca-mock.html#${route}` }); await sleep(3000); };
    const visit = async (i, route) => {
      await ev(`location.hash=${JSON.stringify(route)};0`); await sleep(1800); await kick(); await sleep(400);
      await ev(OPEN_TABS);
      await ev(`location.hash=${JSON.stringify(route)};0`); await sleep(900); await kick();
      await ev(STILL); await kick();
      const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(mockDir, shotName(i, route)), Buffer.from(data, 'base64'));
    };

    await open('chat');
    for (const [i, route] of rec.routes.entries()) { await visit(i, route); log(`checked ${route}`); }
    const misses = JSON.parse(await ev('JSON.stringify([...(window.__worcaMockMisses||[])])') || '[]');

    const views = [];
    if (compare) {
      const diff = async (name) => {
        await cdp('Page.navigate', { url: `${base}/blank.html` }); await sleep(300);
        return ev(`(${DIFF_FN})(${JSON.stringify(`/real-shots/${name}`)}, ${JSON.stringify(`/mock-shots/${name}`)})`);
      };
      for (const [i, route] of rec.routes.entries()) {
        const name = shotName(i, route);
        if (!existsSync(path.join(realDir, name))) { views.push({ route, missing: true }); continue; }
        views.push({ route, name, i, ...(await diff(name)) });
      }
      for (const v of views.filter((x) => x.pct > maxDiff)) {   // once more, on its own
        await open(v.route); await visit(v.i, v.route);
        Object.assign(v, await diff(v.name), { retried: true });
      }
    }
    const report = { misses, errors, maxDiff, views };
    await writeFile(path.join(dir, 'check.json'), JSON.stringify(report, null, 1));
    return report;
  } finally {
    killChrome();
    process.off('exit', killChrome);
    srv.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}

/** One line per view and the verdict; true when the mock passes. */
export function printReport({ misses, errors, maxDiff, views }, out = console.log) {
  for (const v of views) {
    if (v.missing) out(`   no shot  ${v.route}`);
    else if (v.size) out(`  size ≠    ${v.route}`);
    else if (typeof v.pct !== 'number') out(`  no score ${v.route}`);
    else out(`${v.pct.toFixed(2).padStart(7)}%  ${v.route}${v.pct > maxDiff ? '  <- over the limit' : ''}`);
  }
  if (misses.length) out(`requests the mock could not answer (re-record):\n  ${misses.join('\n  ')}`);
  if (errors.length) out(`page errors:\n  ${errors.slice(0, 10).join('\n  ')}`);
  const over = views.filter((v) => v.size || typeof v.pct !== 'number' || v.pct > maxDiff);
  const ok = !misses.length && !errors.length && !over.length;
  out(ok ? `PASS: ${views.length ? `${views.length} views within ${maxDiff}% of the real app` : 'every view answered'}` : 'FAIL');
  return ok;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const i = args.indexOf('--max-diff');
  if (!dir) { console.error('usage: node tools/mock-artifact/check.mjs <dir> [--max-diff 2]'); process.exit(2); }
  const report = await checkMock(path.resolve(dir), { maxDiff: i >= 0 ? Number(args[i + 1]) : 2 });
  process.exit(printReport(report) ? 0 : 1);
}
