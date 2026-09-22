#!/usr/bin/env node
// tools/make-logo-mask.mjs — derive ui/public/assets/worca-logo-mask.png (the
// wordmark as an ALPHA mask) from worca-logo.png, which is fully opaque on a white
// background and therefore cannot mask anything. Fallback only: the shipped asset
// is the user's white-on-transparent art. Refuses to overwrite an existing file
// unless --force. Needs Chrome (same discovery as the CDP proofs).
//   alpha = (255 − luminance) × srcAlpha / 255, rgb → 0  (black ink, white → transparent)
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'ui/public/assets/worca-logo.png');
const OUT = path.join(ROOT, 'ui/public/assets/worca-logo-mask.png');
if (existsSync(OUT) && !process.argv.includes('--force')) { console.log(`${OUT} exists — keeping it (pass --force to regenerate)`); process.exit(0); }
const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0 ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
const PORT = Number(process.env.CDP_PORT || 9337);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const work = await mkdtemp(path.join(tmpdir(), 'worca-logo-mask-'));
await copyFile(SRC, path.join(work, 'src.png'));
await writeFile(path.join(work, 'gen.html'), `<!doctype html><body><script>
window.__done = new Promise((resolve) => {
  const img = new Image(); img.src = 'src.png';
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height); const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const lum = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
      p[i + 3] = Math.round((255 - lum) * (p[i + 3] / 255)); p[i] = 0; p[i + 1] = 0; p[i + 2] = 0;
    }
    x.putImageData(d, 0, 0);
    resolve({ w: c.width, h: c.height, dataUrl: c.toDataURL('image/png') });
  };
  img.onerror = () => resolve({ error: 'source failed to load' });
});
</script></body>`);
const profile = await mkdtemp(path.join(tmpdir(), 'worca-logo-mask-profile-'));
const chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--allow-file-access-from-files', '--no-first-run', '--no-default-browser-check', pathToFileURL(path.join(work, 'gen.html')).href], { stdio: 'ignore' });
let code = 1;
try {
  let wsUrl = null;
  for (let i = 0; i < 240 && !wsUrl; i += 1) {
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (page) wsUrl = page.webSocketDebuggerUrl; } catch {}
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) throw new Error('no devtools target after 60s');
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id != null) { const p = pending.get(m.id); pending.delete(m.id); if (p) p(m.result); } };
  const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const r = await cdp('Runtime.evaluate', { expression: 'window.__done', awaitPromise: true, returnByValue: true });
  const v = r.result.value;
  if (!v || v.error) throw new Error(v ? v.error : 'no result');
  await writeFile(OUT, Buffer.from(v.dataUrl.split(',')[1], 'base64'));
  console.log(`wrote ${OUT} (${v.w}×${v.h})`);
  ws.close(); code = 0;
} catch (e) {
  console.error(e && e.stack ? e.stack : String(e));
} finally {
  try { chrome.kill('SIGKILL'); } catch {}
  await rm(work, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true });
}
process.exit(code);
