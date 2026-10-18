#!/usr/bin/env node
// tools/verify-feature-page-cdp.mjs — headless-Chrome proof of Shaper's feature views (D16, D17): a 3-slice
// feature is ONE open row in the Runs list (members "1 · …", no row of its own for slice 2's run, the row links to
// #feature/ID), and #feature/ID renders the full-width page (one segmented bar and no stage bar, "merge first", the rare
// actions in ⋯ with Approve each unchecked, the halted line in amber), and both views pass the one-button-style audit
// (tools/button-audit.mjs) in light and dark. NOT part of `npm test`: it needs Chrome. Screenshots of both land in a temp dir; their paths are printed.
// Run: node tools/verify-feature-page-cdp.mjs   (or: npm run verify:feature-page)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditButtons, BUTTON_SPEC } from './button-audit.mjs';

const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const PORT = Number(process.env.CDP_PORT || 9336);
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let home = null; let proj = null; let profile = null; let failed = 0;
async function shutdown(code) {
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}
  try { if (srv) await new Promise((r) => srv.close(r)); } catch {}
  for (const d of [home, proj, profile]) { try { if (d) await rm(d, { recursive: true, force: true }); } catch {} }
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, what) => { if (ok) log(`ok   ${what}`); else { failed += 1; log(`FAIL ${what}`); } };

// ---- a sandboxed HOME (settings live there) and WORCA_HOME (the DB), the flag on, then the server in process.
home = await mkdtemp(path.join(tmpdir(), 'worca-fp-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
process.env.WORCA_HOME = path.join(home, '.worca-cc');
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
process.env.WORCA_MOCK = '1';
process.env.WORCA_FLAGS = 'shapeFirst';
proj = await mkdtemp(path.join(tmpdir(), 'worca-fp-proj-'));
for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) execFileSync('git', a, { cwd: proj });
await writeFile(path.join(proj, 'README.md'), '# feature page proof\n');
execFileSync('git', ['add', '-A'], { cwd: proj });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
const { server } = await import(new URL('../ui/server.mjs', import.meta.url).href);
const { getDb } = await import(new URL('../src/core/db.mjs', import.meta.url).href);
const { projectKey } = await import(new URL('../src/core/store.mjs', import.meta.url).href);
const { writeStoreMeta } = await import(new URL('../src/core/artifacts.mjs', import.meta.url).href);
const { createSliceFeature } = await import(new URL('../src/core/shape/features.mjs', import.meta.url).href);
srv = server;
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
{ const r = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uiLevel: 'expert' }) });
  if (!r.ok) throw new Error(`could not pin the interface mode: HTTP ${r.status}`); }

// ---- the feature: slice 1 done, slice 2's ticket fired to a paused run, slice 3 waiting.
const key = projectKey(proj);
writeStoreMeta(key, 'project', { key, name: 'Proof', path: proj });
const now = new Date().toISOString();
const pipeline = (id, status, title, branch) => getDb().prepare(`INSERT INTO pipelines (id, project_key, target, title, status, phase,
  cycle, started_at, updated_at, total_cost_usd, total_active_ms, branch) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(id, key, 'project', title, status, status, 0, now, now, 0, 0, JSON.stringify(branch));
const sl = (n, title) => ({ id: `s${n}`, title, goal: `Goal ${n}`, inScope: [], outOfScope: [], acceptance: [`ok ${n}`], dependsOn: [], estimate: 'M' });
const TITLES = ['Store tags', 'Run tags', 'Cost report'];
pipeline('fp000001', 'done', 'Run tags and cost allocation · 1/3: Store tags', { source: 'main', feature: 'feat/fp1' });
getDb().prepare("UPDATE pipelines SET pr_url = 'https://github.com/o/r/pull/1', pr_state = 'OPEN' WHERE id = 'fp000001'").run();
const f = createSliceFeature({ pipelineId: 'fp000001', projectDir: proj, title: 'Run tags and cost allocation',
  outline: { why: 'proof', slices: TITLES.map((t, i) => sl(i + 1, t)) }, perspectives: ['product'], workflowId: 'wf_shape' });
pipeline('fp000002', 'paused', 'Run tags and cost allocation · 2/3: Run tags', { source: 'feat/fp1', feature: 'feat/fp2' });
const t2 = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2').get(f.id).ticket_id;
getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = 'fp000002' WHERE id = ?").run(t2);
log(`server ${base} · feature ${f.id}`);

// ---- chrome + cdp
profile = await mkdtemp(path.join(tmpdir(), 'worca-fp-profile-'));
chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,900', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', 'about:blank'],
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
if (!wsUrl) { console.error('no devtools target after 60s'); await shutdown(1); }
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id != null) { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
function cdp(method, params = {}, ms = 15000) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT ${method}`)); }, ms);
    pending.set(id, { res: (v) => { clearTimeout(to); res(v); }, rej: (er) => { clearTimeout(to); rej(er); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`EVAL: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n${expr}`);
  return r.result.value;
}
async function waitFor(expr, what, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await ev(expr)) return true; await sleep(150); }
  throw new Error(`timed out waiting for ${what}`);
}
// The one-button-style audit (runs-redesign spec §5.2) in light, then dark; the page's own theme is put back after.
const BUTTON_AUDIT = `(${auditButtons})(document.body, ${JSON.stringify(BUTTON_SPEC)}, null)`;
async function auditButtonsBoth(where) {
  const before = await ev('document.documentElement.dataset.theme || ""');
  for (const theme of ['light', 'dark']) {
    await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)};0`);
    const bad = await ev(BUTTON_AUDIT);
    check(bad.length === 0, `${where}, ${theme}: every button is .btn in 3 sizes x 4 variants${bad.length ? ` — ${JSON.stringify(bad.slice(0, 12))}` : ''}`);
  }
  await ev(`document.documentElement.dataset.theme=${JSON.stringify(before)};0`);
}
async function shot(name) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  const file = path.join(tmpdir(), `worca-feature-page-${name}-${Date.now()}.png`);
  await writeFile(file, Buffer.from(data, 'base64'));
  return file;
}
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

// ---- the Runs list
await cdp('Page.navigate', { url: `${base}/#runs` });
await waitFor("document.querySelectorAll('#runs-list .runs-item[data-level=\"top\"][data-row-key^=\"chain:\"]').length === 1", 'the feature row');
const runs = await ev(`(() => {
  const host = document.getElementById('runs-list');
  const row = host.querySelector('.runs-item[data-level="top"][data-row-key^="chain:"]');
  const link = row.querySelector(':scope > a.runs-row');
  return {
    chains: host.querySelectorAll('.runs-item[data-level="top"][data-row-key^="chain:"]').length,
    title: link.textContent,
    href: link.getAttribute('href'),
    open: row.querySelector(':scope > .runs-row-tail .runs-expand').getAttribute('aria-expanded') === 'true',
    members: [...row.querySelectorAll(':scope > .runs-members > .runs-item > a.runs-row > .runs-row-title')].map((a) => a.textContent),
    ownRow: [...host.querySelectorAll('.runs-item[data-level="top"]')].filter((r) => !r.dataset.rowKey.startsWith('chain:') && /2\\/3/.test(r.textContent)).length,
  };
})()`);
check(runs.chains === 1, 'one feature row');
check(runs.title.includes('Run tags and cost allocation'), `the row names the feature (${runs.title.slice(0, 80)})`);
check(runs.href === `#feature/${f.id}`, `the row links to the feature page (${runs.href})`);
check(runs.open, 'the row is open by default');
check(JSON.stringify(runs.members) === JSON.stringify(['1 · Store tags', '2 · Run tags', '3 · Cost report']), `members ${JSON.stringify(runs.members)}`);
check(runs.ownRow === 0, 'no separate row for slice 2\'s run');
await auditButtonsBoth('the Runs list');
const runsShot = await shot('runs');

// ---- the feature page
await cdp('Page.navigate', { url: `${base}/#feature/${f.id}` });
await waitFor("!!document.querySelector('[data-view=\"feature\"] .shape-feature.is-page')", 'the feature page');
const page = await ev(`(() => {
  const el = document.querySelector('[data-view="feature"] .shape-feature.is-page');
  const main = document.querySelector('[data-view="feature"]');
  return {
    segs: el.querySelectorAll('.shape-feature-seg').length,
    merge: el.querySelector('.shape-feature-slice.is-done .shape-feature-merge')?.textContent || '',
    bars: el.querySelectorAll('.shape-feature-segs').length, stageBars: el.querySelectorAll('.run-prog').length,
    replanButton: !!el.querySelector('.shape-feature-replan'), more: !!el.querySelector('.shape-feature-more'),
    headColor: getComputedStyle(el.querySelector('.shape-feature-head')).color,
    amber: (() => { const p = document.createElement('span'); p.style.color = 'var(--amber-ink)'; el.appendChild(p);
      const c = getComputedStyle(p).color; p.remove(); return c; })(),
    menu: (() => { el.querySelector('.shape-feature-more')?.click();
      const items = [...document.querySelectorAll('.wfv-menu .wfv-menu-item')];
      return { labels: items.map((b) => b.textContent), each: items.find((b) => /Approve each/.test(b.textContent))?.getAttribute('aria-checked') }; })(),
    width: el.getBoundingClientRect().width, mainWidth: main.getBoundingClientRect().width,
  };
})()`);
check(page.segs === 3, 'three bar parts');
check(page.merge === 'merge first', 'slice 1 reads "merge first"');
check(page.bars === 1 && page.stageBars === 0, 'one segmented bar, no stage bar');
check(!page.replanButton && page.more, 'Re-plan the rest moved into ⋯');
check(['Re-plan the rest', 'Cancel the rest'].every((l) => page.menu.labels.includes(l)), `⋯ holds ${JSON.stringify(page.menu.labels)}`);
check(page.menu.each === 'false', 'Approve each slice\'s plan is unchecked');
check(page.headColor === page.amber, `the halted line is amber (${page.headColor} vs ${page.amber})`);
check(page.width > 0.8 * page.mainWidth, `full width (${Math.round(page.width)} of ${Math.round(page.mainWidth)})`);
const pageShot = await shot('page');
// A second ⋯ click closes the menu (toggleMenu); a document-level Escape would not reach the menu's own keydown.
await ev("document.querySelector('[data-view=\"feature\"] .shape-feature-more').click(), !document.querySelector('.wfv-menu')");
await auditButtonsBoth('the feature page');
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
console.log(`screenshots:\n  ${runsShot}\n  ${pageShot}`);
console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
await shutdown(failed ? 1 : 0);
