// e2e/extension/fixtures.mjs — Chromium with the built test extension, a mock-mode worca, and a fixture site served
// as http://fixture.test:<port> (a NON-loopback origin, mapped by --host-resolver-rules).
// Pairing budget (review M3, D25): the shared worker-scoped `worca` is paired ONCE per worker (tokenFor) and every test
// seeds that token; the pairing-UI specs use `freshWorca`, their own server. PAIR_RATE (10 / 10 min) is never hit.
import { test as base, chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extensionWorkerHandle } from './sw-handle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXT_DIR = join(ROOT, 'extension/dist/chrome-test');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });

/** A mock-mode worca in a temp home. Throws (with the log tail) when it does not come up (review m13). */
export async function startWorca() {
  const home = mkdtempSync(join(tmpdir(), 'wx-e2e-'));
  const port = await freePort();
  // WORCA_MOCK_SLOW_MS: a MOCK_SLOW turn's 7 frames take ~6 s, so Stop and the reconnect test have room under CI load
  // (review m1). Only MOCK_SLOW turns/quotes are slowed; every other mock answer is immediate.
  const env = { ...process.env, PORT: String(port), WORCA_MOCK: '1', WORCA_MOCK_SLOW_MS: '900', HOME: home, USERPROFILE: home, WORCA_HOME: home };
  for (const k of ['WORCA_HOST_PID', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME', 'WORCA_ALLOWED_HOSTS']) delete env[k];   // no agent isolation, local mode
  const logFile = join(home, 'server.log');
  const fd = openSync(logFile, 'a');
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'ui/server.mjs'], { cwd: ROOT, env, stdio: ['ignore', fd, fd] });
  closeSync(fd);                                                      // the child holds its own copy
  let exited = null;
  child.once('exit', (code, signal) => { exited = { code, signal }; });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  let up = false;
  while (!up && !exited && Date.now() < deadline) {
    try { up = (await fetch(`${url}/api/health`)).ok; } catch { /* starting */ }
    if (!up) await sleep(100);
  }
  const cleanup = () => rmSync(home, { recursive: true, force: true });
  if (!up) {
    let tail = '';
    try { tail = readFileSync(logFile, 'utf8').slice(-4000); } catch { /* no log */ }
    if (!exited) child.kill();
    cleanup();
    throw new Error(`worca did not start at ${url} (${exited ? `exited ${exited.code ?? exited.signal}` : 'no answer in 30 s'})\n${tail}`);
  }
  const stop = async () => {
    if (!exited) { const gone = new Promise((r) => child.once('exit', r)); child.kill(); await gone; }
    cleanup();
  };
  // A fresh home has welcomeSeen=false, so the Chat page would open #welcome-modal (app.js:31813-31837; a fixed,
  // z-index 50 overlay) over the transcript and block visual.spec's clicks. Same fix as tools/verify-theme-cdp.mjs:120.
  const onb = await fetch(`${url}/api/onboarding`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ welcomeSeen: true }) });
  if (!onb.ok) throw new Error(`POST /api/onboarding → ${onb.status}; the welcome modal would block the Chat page (v7)`);
  return { url, port, home, child, stop };
}

/** http.request, because fetch drops a caller-set Origin. → { status, headers, body } */
export function rawCall(worca, method, path, { origin, headers = {}, body } = {}) {
  return new Promise((resolveP, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const h = { ...headers };
    if (origin) h.origin = origin;
    if (data) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port: worca.port, path, method, headers: h }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => { let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ } resolveP({ status: res.statusCode, headers: res.headers, body: json }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const tokens = new Map();   // `${worca.url}|${extensionId}` -> token (one pairing per worker per server)
/** Pair this extension origin with `worca` through the real routes, once, and reuse the token. */
export async function tokenFor(worca, extensionId) {
  const key = `${worca.url}|${extensionId}`;
  if (tokens.has(key)) return tokens.get(key);
  const origin = `chrome-extension://${extensionId}`;
  const r = await rawCall(worca, 'POST', '/api/extension/pair', { origin, body: { name: 'Worca for Chrome', browser: 'chrome' } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const ok = await rawCall(worca, 'POST', `/api/extension/pair/${r.body.requestId}/approve`);   // "the person": same origin, no Origin header
  expect(ok.status).toBe(200);
  const got = await rawCall(worca, 'GET', `/api/extension/pair/${r.body.requestId}`, { origin, headers: { 'x-worca-pair-poll': r.body.pollKey } });
  expect(got.body.status).toBe('approved');
  tokens.set(key, got.body.token);
  return got.body.token;
}

export async function startSite() {
  const pages = {
    '/page.html': [readFileSync(join(ROOT, 'e2e/extension/site/page.html')), "default-src 'self'; style-src 'self'; script-src 'self'"],   // Pinpoint under a strict CSP
    '/open.html': [readFileSync(join(ROOT, 'e2e/extension/site/open.html')), null],                                                       // no CSP: only CORS can block a fetch
  };
  const srv = http.createServer((req, res) => {
    const hit = pages[new URL(req.url, 'http://x').pathname];
    if (!hit) { res.statusCode = 404; res.end(); return; }
    if (hit[1]) res.setHeader('Content-Security-Policy', hit[1]);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(hit[0]);
  });
  const port = await freePort();
  await new Promise((r) => srv.listen(port, '127.0.0.1', r));
  const origin = `http://fixture.test:${port}`;
  return { url: `${origin}/page.html`, openUrl: `${origin}/open.html`, origin, stop: () => new Promise((r) => srv.close(r)) };
}

export const test = base.extend({
  worca: [async ({}, use) => { const w = await startWorca(); await use(w); await w.stop(); }, { scope: 'worker' }],
  freshWorca: async ({}, use) => { const w = await startWorca(); await use(w); await w.stop(); },   // pairing-UI specs only
  site: [async ({}, use) => { const s = await startSite(); await use(s); await s.stop(); }, { scope: 'worker' }],
  context: async ({}, use) => {
    const ctx = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: !process.env.HEADED,
      args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--host-resolver-rules=MAP fixture.test 127.0.0.1'],
    });
    await use(ctx);
    await ctx.close();
  },
  sw: async ({ context }, use) => { await use(await extensionWorkerHandle(context)); },   // see sw-handle.mjs
  extensionId: async ({ sw }, use) => { await use(new URL(sw.url()).host); },
});
export { expect };

/** Point the extension at this worca: clear storage, then set the base URL (and, optionally, a token). pinpointOnSelect:
 *  the Settings option "Show Pinpoint when I select text" (off by default: Pinpoint then opens on the command only). */
export async function configure(sw, worca, { token = null, pinpointOnSelect = false } = {}) {
  await sw.evaluate(async ([url, tok, onSelect]) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ 'worca.baseUrl': url, ...(tok ? { 'worca.token': tok } : {}), ...(onSelect ? { 'worca.pinpointOnSelect': true } : {}) });
  }, [worca.url, token, pinpointOnSelect]);
}

/** captureVisibleTab needs activeTab (a real shortcut press) or <all_urls>, neither of which an E2E run can have: hand
 *  the test build a real viewport screenshot of `page` as its capture source (background.mjs captureVisible). The
 *  overlay, the rectangle, the crop and the upload stay the extension's own code. */
export async function stubCapture(sw, page) {
  const b64 = (await page.screenshot()).toString('base64');
  await sw.evaluate((png) => { globalThis.__worcaTest.setCaptureSource(async () => `data:image/png;base64,${png}`); }, b64);
}

/** Run a manifest command (worca-pinpoint / worca-capture) for `page`'s tab, as the browser would on its shortcut. */
export async function runCommand(sw, page, name) {
  await sw.evaluate(async ([u, cmd]) => { const [tab] = await chrome.tabs.query({ url: u }); globalThis.__worcaTest.command(cmd, tab); }, [page.url(), name]);
}

/** Open the sidebar page bound to `page`'s tab (test builds honour ?tabId/&windowId, and ?retryMs= for the offline retry). */
export async function openSidebar(context, sw, extensionId, page, { retryMs = null } = {}) {
  const { tabId, windowId } = await sw.evaluate(async (u) => { const [t] = await chrome.tabs.query({ url: u }); return { tabId: t.id, windowId: t.windowId }; }, page.url());
  const sidebar = await context.newPage();
  await sidebar.setViewportSize({ width: 400, height: 760 });
  await sidebar.goto(`chrome-extension://${extensionId}/sidebar.html?tabId=${tabId}&windowId=${windowId}${retryMs ? `&retryMs=${retryMs}` : ''}`);
  return sidebar;
}

/** A paired sidebar for `url` (default: the CSP fixture page), using the worker's one pairing. */
export async function pairedSidebar({ context, sw, extensionId, worca, site }, { url = site.url, select = '#para', scheme = null, pinpointOnSelect = false } = {}) {
  await configure(sw, worca, { token: await tokenFor(worca, extensionId), pinpointOnSelect });
  const page = await context.newPage();
  if (scheme) await page.emulateMedia({ colorScheme: scheme });
  await page.goto(url);
  if (select) await page.locator(select).selectText();
  const sidebar = await openSidebar(context, sw, extensionId, page);
  if (scheme) await sidebar.emulateMedia({ colorScheme: scheme });
  await expect(sidebar.locator('textarea.ask-input')).toBeVisible();
  return { page, sidebar };
}

/** The snapshot of the sidebar's OWN thread when `sidebar` is given (threads[0] is by updated_at DESC, which a title
 *  write bumps — store.mjs:160/227 — so "newest" is only a fallback for specs with exactly one thread). */
export async function snapshotOf(worca, sidebar = null) {
  let id = sidebar ? await sidebar.evaluate(() => globalThis.__worcaSidebarTest.threadId()) : null;
  if (!id) id = (await (await fetch(`${worca.url}/api/ask/threads`)).json()).threads[0].id;
  return (await fetch(`${worca.url}/api/ask/threads/${id}`)).json();
}

/** Mock turns: a "MOCK_SLOW" message streams at WORCA_MOCK_SLOW_MS (900 here) per frame (src/core/engines/mock.mjs:220,
 *  :407-414, mockSlowMs); a MOCK_SLOW Pinpoint quote spaces the mock Explain deltas the same way (Step 3). */
export const SLOW = 'MOCK_SLOW';
