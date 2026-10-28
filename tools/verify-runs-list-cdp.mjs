#!/usr/bin/env node
// tools/verify-runs-list-cdp.mjs — headless-Chrome proof of the Runs list layout (runs redesign §3.3a, Known bugs 5, 8, 9;
// D27). At 290px, 375px and 1440px, in light and dark, it runs the pure layout audit (tools/runs-layout-audit.mjs) over the
// list, checks the section order (Needs you, Running, Waiting, Recent) and that the one-off ticket waits, then again with the View menu open, with a row's ⋯ menu open and with the Add to group picker open, and the
// one-button-style audit (tools/button-audit.mjs). At 1440px it also drives the list's resize handle (QA 2). It prints every problem and exits 1 on any. NOT part of `npm test`:
// it needs Chrome (test/verify-runs-list-cdp.test.mjs keeps its coverage from shrinking).
// Run: node tools/verify-runs-list-cdp.mjs   (or: npm run verify:runs-list)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditButtons, auditType, BUTTON_SPEC, TYPE_SPEC } from './button-audit.mjs';
import { auditRunsLayout } from './runs-layout-audit.mjs';

const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const PORT = Number(process.env.CDP_PORT || 9337);
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
const check = (ok, what, detail = '') => { if (ok) log(`ok   ${what}`); else { failed += 1; log(`FAIL ${what}${detail ? ` — ${detail}` : ''}`); } };

// ---- a sandboxed HOME (settings live there) and WORCA_HOME (the DB), mock engine, then the server in process.
home = await mkdtemp(path.join(tmpdir(), 'worca-rl-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
process.env.WORCA_HOME = path.join(home, '.worca-cc');
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
process.env.WORCA_MOCK = '1';
proj = await mkdtemp(path.join(tmpdir(), 'worca-rl-proj-'));
for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) execFileSync('git', a, { cwd: proj });
await writeFile(path.join(proj, 'README.md'), '# runs list proof\n');
execFileSync('git', ['add', '-A'], { cwd: proj });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
const { server, runs } = await import(new URL('../ui/server.mjs', import.meta.url).href);
const { getDb } = await import(new URL('../src/core/db.mjs', import.meta.url).href);
const { projectKey } = await import(new URL('../src/core/store.mjs', import.meta.url).href);
const { writeStoreMeta } = await import(new URL('../src/core/artifacts.mjs', import.meta.url).href);
const { createSliceFeature } = await import(new URL('../src/core/shape/features.mjs', import.meta.url).href);
const { createTicket } = await import(new URL('../src/core/scheduler.mjs', import.meta.url).href);
const { createRunGroup, addToGroup } = await import(new URL('../src/core/run-groups.mjs', import.meta.url).href);
srv = server;
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
{ const r = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uiLevel: 'expert' }) });
  if (!r.ok) throw new Error(`could not pin the interface mode: HTTP ${r.status}`); }

// ---- the runs: a 3-slice feature (slice 1 parked at its plan, 2 and 3 waiting), a paused run, a done run with a merged PR,
// a scheduled ticket and a user group of 2.
const key = projectKey(proj);
writeStoreMeta(key, 'project', { key, name: 'Proof', path: proj });
const now = new Date().toISOString();
const pipeline = (id, status, title, extra = {}) => getDb().prepare(`INSERT INTO pipelines (id, project_key, target, title, status, phase,
  cycle, started_at, updated_at, total_cost_usd, total_active_ms, branch, resume_point) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(id, key, 'project', title, status, status, 0, now, now, extra.cost || 0, 0, JSON.stringify({ source: 'main', feature: `feat/${id}` }),
    extra.pauseReason ? JSON.stringify({ pauseReason: extra.pauseReason }) : null);
const sl = (n, title) => ({ id: `s${n}`, title, goal: `Goal ${n}`, inScope: [], outOfScope: [], acceptance: [`ok ${n}`], dependsOn: [], estimate: 'M' });
pipeline('rl000001', 'paused', 'Run tags and cost allocation · 1/3: Store tags', { pauseReason: 'usage_limit', cost: 1.5 });
createSliceFeature({ pipelineId: 'rl000001', projectDir: proj, title: 'Run tags and cost allocation',
  outline: { why: 'proof', slices: ['Store tags', 'Run tags', 'Cost report'].map((t, i) => sl(i + 1, t)) }, perspectives: ['product'], workflowId: 'wf_shape' });
pipeline('rl000002', 'paused', 'A paused run with a long title that has to be cut at the right column', { pauseReason: 'cost_pipeline' });
pipeline('rl000003', 'done', 'Merged work', { cost: 2.25 });
getDb().prepare("UPDATE pipelines SET pr_url = 'https://github.com/o/r/pull/3', pr_number = 3, pr_state = 'MERGED' WHERE id = 'rl000003'").run();
createTicket({ projectDir: proj, title: 'Nightly docs refresh', request: { prompt: 'docs', projectDir: proj }, runAtMs: Date.now() + 3 * 3600_000 });
pipeline('rl000004', 'done', 'Billing: invoices');
pipeline('rl000005', 'stopped', 'Billing: refunds');
const grp = createRunGroup({ title: 'Billing', pipelineId: 'rl000004' });
addToGroup({ groupId: grp.id, pipelineId: 'rl000005' });
pipeline('rl000006', 'done', 'A loose run to add to a group');
// Live rows (the mock engine ends runs at once): two running runs and a running group of two, so the divider check below
// has adjacent running rows and a group.
const { EventEmitter } = await import('node:events');
const liveRun = (id, title) => {
  pipeline(id, 'running', title);
  const orch = new EventEmitter();
  orch.state = { status: 'running', steps: [{ nodeId: 'implement', status: 'running' }] };
  orch.getState = () => orch.state;
  runs.set(`run-${id}`, { id: `run-${id}`, kind: 'run', pipelineId: id, status: 'running', events: [], pendingQuestion: null,
    projectDir: proj, startedAt: Date.now(), orch, title, tags: [] });
};
liveRun('rl000010', 'Running one'); liveRun('rl000011', 'Running two');
liveRun('rl000012', 'Running group: first'); liveRun('rl000013', 'Running group: second');
const liveGrp = createRunGroup({ title: 'Running group', pipelineId: 'rl000012' });
addToGroup({ groupId: liveGrp.id, pipelineId: 'rl000013' });
log(`server ${base}`);

// ---- chrome + cdp
profile = await mkdtemp(path.join(tmpdir(), 'worca-rl-profile-'));
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
const AUDIT = `(${auditRunsLayout})(document.getElementById('runs-list'), null, document)`;
async function audit(where) {
  const problems = await ev(AUDIT);
  check(problems.length === 0, `${where}: 0 layout problems`, JSON.stringify(problems.slice(0, 8)));
}
const BUTTON_AUDIT = `(${auditButtons})(document.body, ${JSON.stringify(BUTTON_SPEC)}, null)`;
// D23: every visible text on the type scale (docs/design-system.md › Type).
const TYPE_AUDIT = `(${auditType})(document.body, ${JSON.stringify(TYPE_SPEC)}, null)`;
const closeMenus = () => ev("document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));document.querySelector('.group-picker')?.remove();0");

// QA 2: the list's resize handle: → x4 widens by 64px, Home resets the default, a drag reaches 600px and survives a reload.
const listW = () => ev("Math.round(document.querySelector('#runs-shell .runs-list-pane').getBoundingClientRect().width)");
const valueNow = () => ev("Number(document.querySelector('#runs-shell .runs-resize').getAttribute('aria-valuenow'))");
async function press(key, code) {
  for (const type of ['keyDown', 'keyUp']) await cdp('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code });
}
async function resizeProof(at) {
  await ev("document.querySelector('#runs-shell .runs-resize').focus();0");
  // The list's rendered width: an unfocused headless page fires no focus event, so aria-valuenow may still be the
  // width painted while the view was hidden.
  const v0 = await listW();
  for (let i = 0; i < 4; i++) await press('ArrowRight', 39);
  const v1 = await valueNow();
  check(v1 === v0 + 64 && (await listW()) === v1, `${at}: → x4 widens the list by 64px`, `${v0} → ${v1}, list ${await listW()}px`);
  await press('Home', 36);
  const def = await ev("Math.max(280, Math.min(340, 640, Math.floor(document.getElementById('runs-shell').clientWidth / 2)))");
  check((await valueNow()) === def && (await listW()) === def, `${at}: Home resets the default (${def}px)`, `value ${await valueNow()}, list ${await listW()}px`);
  const h = await ev("(() => { const r = document.querySelector('#runs-shell .runs-resize').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()");
  const to = h.x + (600 - def);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.x, y: h.y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: h.x, y: h.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round((h.x + to) / 2), y: h.y, button: 'left', buttons: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to, y: h.y, button: 'left', buttons: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to, y: h.y, button: 'left', buttons: 0, clickCount: 1 });
  check((await valueNow()) === 600 && (await listW()) === 600, `${at}: a drag sets the list to 600px`, `value ${await valueNow()}, list ${await listW()}px`);
  await cdp('Page.reload');
  await waitFor("document.querySelectorAll('#runs-list .runs-item').length >= 5", `the list after a reload at ${at}`);
  await sleep(400);
  check((await listW()) === 600, `${at}: the width survives a reload`, `list ${await listW()}px`);
  await audit(`the list at 600px, ${at}`);
  await ev("localStorage.removeItem('worca-cc.runs.listWidth');0");   // the next combination starts from the default
}

await cdp('Page.enable'); await cdp('Runtime.enable');
for (const width of [290, 375, 1440]) {
  for (const theme of ['light', 'dark']) {
    const at = `${width}px ${theme}`;
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await cdp('Page.navigate', { url: `${base}/?w=${width}&t=${theme}#runs` });
    await waitFor("document.querySelectorAll('#runs-list .runs-item').length >= 5", `the list at ${at}`);
    await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)};0`);
    await sleep(400);
    await audit(`the list, ${at}`);
    // Honest status (D13): the sections read Needs you, Running, Waiting, Recent; the one-off ticket three hours out sits
    // in Waiting and says when it starts; nothing scrolls sideways (only a sub-line may ellipsise; data-line keeps it whole).
    const w = await ev(`(() => {
      const list = document.getElementById('runs-list');
      const ids = [...list.querySelectorAll('.runs-sec')].map((s) => s.dataset.section);
      const t = [...list.querySelectorAll('.runs-row-title')].find((n) => n.textContent === 'Nightly docs refresh');
      const a = t ? t.closest('a.runs-row') : null;
      const sub = a ? a.querySelector('.runs-row-sub') : null;
      return { ids, inWaiting: !!(a && a.closest('.runs-sec-waiting')), sub: sub ? sub.textContent : '', line: a ? a.dataset.line : '',
        sideways: list.scrollWidth > list.clientWidth };
    })()`);
    const ORDER = ['needs', 'running', 'waiting', 'recent'];
    const pos = w.ids.map((id) => ORDER.indexOf(id));
    const okOrder = pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1]));
    const okWait = w.inWaiting && w.sub.startsWith('Waiting · starts') && w.line.startsWith(w.sub.replace(/…$/, ''));
    check(okOrder, `${at}: the sections read Needs you, Running, Waiting, Recent`, JSON.stringify(w.ids));
    check(okWait, `${at}: the one-off ticket is in .runs-sec-waiting and reads "Waiting · starts …"`, JSON.stringify(w));
    check(!w.sideways, `${at}: the list does not scroll sideways`);
    if (okOrder && okWait && !w.sideways) log(`PASS waiting section ${at}`);
    // The View menu.
    await ev("document.getElementById('runs-view-btn').click();0");
    await waitFor("!!document.querySelector('.wfv-menu')", `the View menu at ${at}`);
    await audit(`the View menu, ${at}`);
    await closeMenus();
    // A row's ⋯ menu, then Add to group… from the loose run's ⋯.
    await ev("document.querySelector('#runs-list .runs-item[data-level=\"top\"] > .runs-row-tail .runs-more').click();0");
    await waitFor("!!document.querySelector('.wfv-menu')", `a row ⋯ menu at ${at}`);
    await audit(`a row ⋯ menu, ${at}`);
    await closeMenus();
    await ev(`(() => { const a = document.querySelector('#runs-list a.runs-row[data-pipeline-id="rl000006"]');
      a.closest('.runs-item').querySelector(':scope > .runs-row-tail .runs-more').click(); })();0`);
    await waitFor("!!document.querySelector('.wfv-menu')", `the loose run's ⋯ menu at ${at}`);
    await ev("[...document.querySelectorAll('.wfv-menu [role=\"menuitem\"]')].find((n) => n.textContent.includes('Add to group')).click();0");
    await waitFor("!!document.querySelector('.group-picker')", `the group picker at ${at}`);
    await audit(`the Add to group picker, ${at}`);
    if (width === 375) {
      const gap = await ev("innerWidth - Math.round(document.querySelector('.group-picker').getBoundingClientRect().width)");
      check(gap === 16, `${at}: the Add to group picker is the full width minus 16px`, `innerWidth - width = ${gap}`);
    }
    await closeMenus();
    // Decided corner (D11): a highlighted row takes the sidebar nav item's radius (--r-sm) and hides its own divider.
    // Probe rows carry the real classes, appended and removed in one evaluation (no repaint in between).
    const corners = await ev(`(() => {
      const row = document.querySelector('#runs-list .runs-item');
      const needs = row.cloneNode(false); needs.classList.add('is-needs');
      const sel = row.cloneNode(false); const a = document.createElement('a'); a.className = 'runs-row selected'; sel.append(a);
      row.parentElement.append(needs, sel);
      const cs = (el) => getComputedStyle(el);
      const out = { needs: cs(needs).borderTopLeftRadius, selected: cs(sel).borderTopLeftRadius,
        nav: cs(document.querySelector('.nav button')).borderTopLeftRadius,
        lines: [cs(needs).borderBottomColor, cs(sel).borderBottomColor] };
      needs.remove(); sel.remove();
      return out; })()`);
    check(corners.nav === '6px' && corners.needs === corners.nav && corners.selected === corners.nav,
      `${at}: a selected and a Needs-you row have the nav item's corner`, JSON.stringify(corners));
    check(corners.lines.every((c) => c === 'rgba(0, 0, 0, 0)'), `${at}: a highlighted row hides its own divider`, JSON.stringify(corners.lines));
    // Dividers: every top-level running row and running group draws one 1px --line bottom border, nothing paints over
    // it, and its edge pixel is the same colour as a finished row's.
    const div = await ev(`(() => {
      const cs = (el) => getComputedStyle(el);
      const top = [...document.querySelectorAll('#runs-list .runs-item[data-level="top"]')];
      const ref = top.find((n) => n.closest('.runs-sec-recent') && !n.querySelector(':scope > a.runs-row.selected'));
      const run = top.filter((n) => n.closest('.runs-sec-running') && !n.matches('.is-needs')
        && !n.querySelector(':scope > a.runs-row.selected, :scope > a.runs-row.member-open'));
      const bad = run.map((n) => {
        const r = n.getBoundingClientRect(); const s = cs(n);
        const low = Math.max(...[...n.querySelectorAll('*')].filter((d) => d.offsetParent || d.getClientRects().length)
          .map((d) => d.getBoundingClientRect().bottom));
        const hit = document.elementFromPoint(r.left + 3, r.bottom - 0.5);
        const ok = !!ref && s.borderBottomStyle === 'solid' && s.borderBottomWidth === '1px'
          && s.borderBottomColor === cs(ref).borderBottomColor
          && cs(n).borderTopStyle === 'none' && low <= r.bottom - 1 + 0.01 && (!hit || hit === n || !n.contains(hit));
        return ok ? null : { key: n.dataset.rowKey, border: s.borderBottom, top: cs(n).borderTop, low, bottom: r.bottom, hit: hit && hit.className };
      }).filter(Boolean);
      return { ref: !!ref, n: run.length, groups: run.filter((n) => n.dataset.rowKey.startsWith('chain:')).length, bad }; })()`);
    const okDiv = div.ref && div.n >= 3 && div.groups >= 1 && div.bad.length === 0;
    check(okDiv, `${at}: running rows and running groups each draw one --line divider`, JSON.stringify(div));
    if (okDiv) log(`PASS running dividers ${at}`);
    const offType = await ev(TYPE_AUDIT);
    check(offType.length === 0, `${at}: every text is on the type scale`, JSON.stringify(offType.slice(0, 8)));
    const bad = await ev(BUTTON_AUDIT);
    check(bad.length === 0, `${at}: every button is .btn in 3 sizes x 4 variants`, JSON.stringify(bad.slice(0, 8)));
    if (width === 1440 && theme === 'light') await resizeProof(at);
  }
}
check(errors.length === 0, 'no page exceptions', errors.slice(0, 4).join(' | '));
log(failed ? `${failed} check(s) failed` : 'all checks passed');
await shutdown(failed ? 1 : 0);
