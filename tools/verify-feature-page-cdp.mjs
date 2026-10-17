#!/usr/bin/env node
// tools/verify-feature-page-cdp.mjs — headless-Chrome proof of Shaper's feature views (D16, D17): a 3-slice
// feature is ONE open row in the Runs list (members "1 · …", no row of its own for slice 2's run, the row links to
// #feature/ID), and #feature/ID renders the full-width page (one segmented bar and no stage bar, "merge first", the rare
// actions in ⋯ with Approve each unchecked, the halted line in amber), and the one button scale on every Shaper
// surface (28 / 34px, 40px+ and stacked at 390px with a coarse pointer, no underlined a.btn); --out DIR writes
// light and dark PNGs of each surface. NOT part of `npm test`: it needs Chrome. Screenshots of both land in a temp dir; their paths are printed.
// Run: node tools/verify-feature-page-cdp.mjs [--out DIR]   (or: npm run verify:feature-page)
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const OUT = (() => { const i = process.argv.indexOf('--out'); return i > 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : null; })();
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
// The same module instance exports the live-runs Map the hello summarises. `runs` is taken by the Runs-list result
// below, hence the alias.
const { server, runs: liveRuns } = await import(new URL('../ui/server.mjs', import.meta.url).href);
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

// ---- before Chrome starts: stub live runs whose asks the REAL renderers draw. hello is sent once per WebSocket, so
// they must be in the Map before the first load. summarizeRuns reads r.id, and the subscribe replay iterates events.
// The stubs have no orch.answer, so the proof never clicks an answer button.
const SHAPING = { perspectives: [], rounds: [], approved: null, savedTo: null };
const planFile = path.join(home, 'plan.md');   // GET /api/runs/:id/plan reads it: an absolute .md path that exists
await writeFile(planFile, '# Proof plan\n\n## 1. Problem and goal\n\nOne button scale.\n');
const live = (id, pendingQuestion, shaping = null) => liveRuns.set(id, { id, kind: 'run', status: 'running', title: `Buttons · ${id}`,
  projectDir: proj, startedAt: now, events: [], pendingQuestion, orch: shaping ? { state: { shaping } } : null });
const OSLICE = (id) => ({ id, title: `Slice ${id}`, goal: `Make ${id} possible`, inScope: ['a'], outOfScope: ['b'], acceptance: ['ok'], dependsOn: [], estimate: 'medium' });
live('btn-gate', { id: 'gate-refine-1', kind: 'gate', issues: [{ severity: 'major', title: 'Missing tests' }] });
live('btn-recovery', { id: 'recovery-n_impl-1', kind: 'recovery', recovery: { cls: 'rate_limit', message: '429 from the API' } });
live('btn-clarify', { id: 'clarify-1', kind: 'clarify',
  questions: [{ id: 'q1', question: 'Where to store sessions?', options: ['Redis', 'Postgres', ''], allowFreeText: true }] }, SHAPING);
live('btn-plan', { id: 'plan-n_plan-1', kind: 'plan', nodeId: 'n_plan',
  plan: { port: 'plan', round: 1, revisable: true, nodeId: 'n_plan', file: planFile, check: { ok: false, passed: 3, total: 8, items: [], grounding: [] } } }, SHAPING);
live('btn-outline', { id: 'plan-outline-n_plan-1', kind: 'plan',
  plan: { port: 'plan', round: 1, revisable: true, nodeId: 'n_plan', outline: { why: 'proof', slices: [OSLICE('s1'), OSLICE('s2')] },
    check: { ok: true, passed: 5, total: 5, items: [], grounding: [] } } }, SHAPING);

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
const waiters = new Map();   // CDP event method -> [resolve]
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id != null) { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  const w = waiters.get(m.method); if (w) { waiters.delete(m.method); for (const r of w) r(m.params); }
};
/** Resolves on the next `method` event. Create it BEFORE the command that triggers the event. */
const nextEvent = (method, ms = 15000) => new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error(`timeout ${method}`)), ms);
  waiters.set(method, [...(waiters.get(method) || []), (p) => { clearTimeout(to); res(p); }]);
});
/** A real page load: a distinct URL, awaited on its load event (a same-URL navigate is a fragment hop and never loads). */
async function load(url) {
  const loaded = nextEvent('Page.loadEventFired');
  await cdp('Page.navigate', { url });
  await loaded;
}
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
await waitFor("document.querySelectorAll('#runs-list .runs-chain').length === 1", 'the feature row');
const runs = await ev(`(() => {
  const host = document.getElementById('runs-list');
  const row = host.querySelector('.runs-chain');
  return {
    chains: host.querySelectorAll('.runs-chain').length,
    title: row.querySelector('.runs-row').textContent,
    href: row.querySelector('.runs-row').getAttribute('href'),
    open: !row.querySelector('.runs-chain-members').hidden,
    members: [...row.querySelectorAll('.runs-chain-member:not(.runs-chain-open-feature) .runs-chain-link')].map((a) => a.textContent),
    ownRow: [...host.querySelectorAll('.runs-row')].filter((r) => !r.closest('.runs-chain') && /2\\/3/.test(r.textContent)).length,
  };
})()`);
check(runs.chains === 1, 'one feature row');
check(runs.title.includes('Run tags and cost allocation'), `the row names the feature (${runs.title.slice(0, 80)})`);
check(runs.href === `#feature/${f.id}`, `the row links to the feature page (${runs.href})`);
check(runs.open, 'the row is open by default');
check(JSON.stringify(runs.members) === JSON.stringify(['1 · Store tags', '2 · Run tags', '3 · Cost report']), `members ${JSON.stringify(runs.members)}`);
check(runs.ownRow === 0, 'no separate row for slice 2\'s run');
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
// ---- the one button scale on every Shaper surface: each a real page load (a distinct ?s= URL, a fresh hello).
// Wait only for animations that END: the page always runs infinite ones (gs-pill-glow, the wr-spin / ws-spin
// spinners), whose .finished never resolves and would hang the proof.
const settleStyles = () => ev(`(async () => { document.activeElement?.blur?.();
  await Promise.all(document.getAnimations()
    .filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime))
    .map((a) => a.finished.catch(() => null)));
  return true; })()`);
// Each root names its own surface, so a check can never pass on a panel of another kind.
const SURFACES = [
  { name: 'feature', hash: `#feature/${f.id}`, root: '[data-view="feature"] .shape-feature.is-page', rows: [],
    must: ['.shape-feature-open', '.shape-feature-resume', '.shape-feature-more'] },
  { name: 'slice-line', hash: `#history/${key}/fp000001`, root: '#hist-detail .rd-slice-line:not([hidden])', rows: [], must: ['.rd-slice-open'] },
  { name: 'gate', hash: '#running/btn-gate', root: '#run-detail .qpanel[data-kind="gate"]', rows: ['.qpanel-foot.gate-actions'],
    must: ['.gate-continue', '.gate-another'] },
  { name: 'recovery', hash: '#running/btn-recovery', root: '#run-detail .qpanel[data-kind="recovery"]', rows: ['.qpanel-foot.gate-actions'],
    must: ['.qpanel-foot .btn-primary'] },
  { name: 'clarify', hash: '#running/btn-clarify', root: '#run-detail .qpanel[data-kind="clarify"]', rows: [],
    must: ['.clarify-defaults', '.qpanel-foot .btn-go'] },
  { name: 'plan', hash: '#running/btn-plan', root: '#run-detail .qpanel[data-kind="plan"]:has(.plan-approve)', rows: ['.qpanel-foot.plan-actions'],
    must: ['.plan-approve', '.plan-more'] },
  { name: 'outline', hash: '#running/btn-outline', root: '#run-detail .qpanel[data-kind="plan"]:has(.outline-approve)', rows: ['.qpanel-foot.plan-actions'],
    must: ['.outline-approve', '.plan-more'] },
];
// The link-look controls that carry .btn but are not on the scale: they keep their text height (min-height:0).
const LINK_LOOK = '.plan-fold, .plan-persp-edit';
// Every visible scale button in a surface: its height, its classes and, for a link, its underline.
const measure = (root) => ev(`(() => {
  const host = document.querySelector(${JSON.stringify(root)});
  if (!host) return null;
  return [...host.querySelectorAll('.btn')].filter((b) => b.offsetParent && !b.matches(${JSON.stringify(LINK_LOOK)}))
    .map((b) => ({ cls: b.className, h: Math.round(b.getBoundingClientRect().height),
      w: Math.round(b.getBoundingClientRect().width), line: getComputedStyle(b).textDecorationLine, tag: b.tagName }));
})()`);
const rowStacked = (root, row) => ev(`(() => {
  const r = document.querySelector(${JSON.stringify(root)})?.querySelector(${JSON.stringify(row)});
  if (!r) return null;
  const rw = r.getBoundingClientRect().width;
  const wide = [...r.querySelectorAll(':scope > .btn:not(.btn-icon)')].filter((b) => b.offsetParent);
  return { column: getComputedStyle(r).flexDirection === 'column', full: wide.every((b) => b.getBoundingClientRect().width >= rw - 1), n: wide.length };
})()`);
async function setTheme(mode) {
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
  await ev(`document.documentElement.dataset.theme = ${JSON.stringify(mode)}, true`);
}
async function clipShot(root, file) {
  const rect = await ev(`(() => { const e = document.querySelector(${JSON.stringify(root)}); e?.scrollIntoView({ block: 'center' });
    const r = e?.getBoundingClientRect(); return r ? { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16 } : null; })()`);
  if (!rect) return null;
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } });
  await writeFile(file, Buffer.from(data, 'base64'));
  return file;
}
if (OUT) await mkdir(OUT, { recursive: true });
const shots = [];
for (const s of SURFACES) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  await load(`${base}/?s=${s.name}${s.hash}`);
  await waitFor(`!!document.querySelector(${JSON.stringify(s.root)})`, `the ${s.name} surface`);
  await settleStyles();
  const desk = await measure(s.root);
  check(desk && desk.length > 0, `${s.name}: buttons drawn (${desk ? desk.length : 0})`);
  // Pin the buttons each surface must draw, so a missing footer button cannot hide behind the others' sizes.
  for (const sel of s.must) {
    const ok = await ev(`(() => { const b = document.querySelector(${JSON.stringify(s.root)})?.querySelector(${JSON.stringify(sel)});
      return !!(b && b.offsetParent && b.classList.contains('btn')); })()`);
    check(ok, `${s.name}: ${sel} is drawn and carries .btn`);
  }
  for (const b of desk || []) {
    check(b.h === 28 || b.h === 34, `${s.name}: ${b.cls} is ${b.h}px at desktop width (28 or 34)`);
    if (b.tag === 'A') check(!/underline/.test(b.line), `${s.name}: a.${b.cls.split(' ').pop()} is not underlined`);
  }
  if (OUT) for (const mode of ['light', 'dark']) { await setTheme(mode); await settleStyles(); shots.push(await clipShot(s.root, path.join(OUT, `${s.name}-${mode}.png`))); }
  await setTheme('light');
  // Phone: 390px wide with a coarse pointer (touch emulation is what flips (pointer: coarse) in Chrome).
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await settleStyles();
  check(await ev("matchMedia('(pointer: coarse)').matches"), `${s.name}: the 390px pass has a coarse pointer`);
  for (const b of (await measure(s.root)) || []) check(b.h >= 40, `${s.name}: ${b.cls} is ${b.h}px at 390px, coarse (>= 40)`);
  for (const row of s.rows) {
    const st = await rowStacked(s.root, row);
    check(st && st.column && st.full && st.n > 0, `${s.name}: ${row} stacks full width at 390px (${JSON.stringify(st)})`);
  }
}
// Hover states of the links: forced :hover through CDP, then read the computed underline.
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
await load(`${base}/?s=hover#history/${key}/fp000001`);
await waitFor("!!document.querySelector('#hist-detail .rd-slice-open')", 'the slice line');
// paintSliceLine rebuilds the line on each History repaint, which drops a held nodeId: wait until the detail is quiet
// for 500ms, then resolve each node from a fresh document.
await ev(`new Promise((res) => { let t = setTimeout(done, 500); function done() { mo.disconnect(); res(true); }
  const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(done, 500); });
  mo.observe(document.getElementById('hist-detail'), { childList: true, subtree: true }); })`);
await cdp('DOM.enable'); await cdp('CSS.enable');
for (const [sel, want] of [['#hist-detail .rd-slice-open', false], ['#hist-detail .rd-slice-link', true]]) {
  const { root: docRoot } = await cdp('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: docRoot.nodeId, selector: sel });
  const before = await ev(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).textDecorationLine`);
  check(!/underline/.test(before), `${sel} is not underlined at rest (${before})`);
  await cdp('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover', 'focus', 'focus-visible'] });
  const hover = await ev(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).textDecorationLine`);
  check(/underline/.test(hover) === want, `${sel} ${want ? 'underlines' : 'stays plain'} on hover/focus (${hover})`);
  await cdp('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
}
if (OUT) console.log(`button screenshots (${shots.filter(Boolean).length}):\n  ${shots.filter(Boolean).join('\n  ')}`);
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
console.log(`screenshots:\n  ${runsShot}\n  ${pageShot}`);
console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
await shutdown(failed ? 1 : 0);
