#!/usr/bin/env node
// tools/runs-redesign-shots.mjs — the runs redesign's before/after screenshots (spec §5 item 8) for
// docs/changelog/unreleased.md: the Runs list, a run page, a group page and the chat card, light and dark, at 1440 and
// 375 px. Shoots one phase against a running sandbox (docs/screenshots.md):
//   node tools/runs-redesign-shots.mjs --phase after --base http://127.0.0.1:4399 --routes routes.json
// routes.json: { "runs": "#runs", "run": "#history/KEY/PID", "group": "#feature/ID", "card": "#chat/THREAD" }
// NOT part of `npm test`: it needs Chrome (test/runs-redesign-shots.test.mjs checks the plan and the committed files).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SHOT_DIR = 'docs/changelog/shots/unreleased/runs-redesign';
export const SURFACES = ['runs', 'run', 'group', 'card'];

export function shotPlan() {
  const out = [];
  for (const surface of SURFACES) for (const phase of ['before', 'after']) for (const theme of ['light', 'dark']) for (const width of [1440, 375]) {
    out.push({ surface, phase, theme, width, mobile: width === 375, height: width === 375 ? 812 : 900,
      file: `${SHOT_DIR}/${surface}-${phase}-${theme}-${width}.jpg` });
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chrome over CDP as tools/verify-runs-list-cdp.mjs does it. That file exports nothing, so its CHROME_PATHS /
// CHROME_BIN lookup, the headless spawn and its local cdp() are copied here.
async function openChrome() {
  const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
  const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
  if (!existsSync(CHROME)) throw new Error(`no Chrome at ${CHROME} - set CHROME_BIN`);
  const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0 ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
  const PORT = Number(process.env.CDP_PORT || 9338);
  const profile = await mkdtemp(path.join(tmpdir(), 'worca-shots-profile-'));
  const chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1440,900', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', 'about:blank'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  let wsUrl = null;
  const deadline = Date.now() + 60_000;
  while (!wsUrl && Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(200);
    } catch { await sleep(250); }
  }
  if (!wsUrl) { chrome.kill('SIGKILL'); throw new Error('no devtools target after 60s'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0; const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id != null) { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)); }
  };
  function cdp(method, params = {}, ms = 15000) {
    const id = ++msgId;
    return new Promise((res, rej) => {
      const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT ${method}`)); }, ms);
      pending.set(id, { res: (v) => { clearTimeout(to); res(v); }, rej: (er) => { clearTimeout(to); rej(er); } });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function close() {
    try { ws.close(); } catch { /* gone */ }
    chrome.kill('SIGKILL');
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
  return { cdp, close };
}

async function main(argv) {
  const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const phase = arg('--phase');
  const base = arg('--base');
  if (!['before', 'after'].includes(phase) || !base || !arg('--routes')) {
    console.error('usage: --phase before|after --base URL --routes routes.json'); process.exit(2);
  }
  const routes = JSON.parse(readFileSync(arg('--routes'), 'utf8'));
  const { cdp, close } = await openChrome();
  try {
    await cdp('Page.enable');
    // The What's new note is set aside before the first page loads, so the shots show the list itself.
    await cdp('Page.navigate', { url: `${base}/` });
    await sleep(800);
    await cdp('Runtime.evaluate', { expression: "localStorage.setItem('worca-cc.whatsNew.runsRedesign','1');0" });
    let n = 0;
    for (const s of shotPlan().filter((x) => x.phase === phase)) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: s.width, height: s.height, deviceScaleFactor: 2, mobile: s.mobile });
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: s.theme }] });
      // A distinct URL per shot: a hash-only change is a same-document navigation and would not reload the page.
      await cdp('Page.navigate', { url: `${base}/?shot=${++n}${routes[s.surface]}` });
      await sleep(1500);
      await cdp('Runtime.evaluate', { expression: `document.documentElement.dataset.theme=${JSON.stringify(s.theme)};0` });
      await sleep(800);   // fonts, the first frame and the bars' transition
      const { data } = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
      mkdirSync(dirname(s.file), { recursive: true });
      writeFileSync(s.file, Buffer.from(data, 'base64'));
      process.stderr.write(`${s.file}\n`);
    }
  } finally { await close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
