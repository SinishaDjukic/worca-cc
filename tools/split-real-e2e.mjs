#!/usr/bin/env node
// tools/split-real-e2e.mjs — #919 T2: the same steps on two REAL instances side by side (no mock; the real claude CLI through
// the login keychain; claude-haiku-5-5): A the unsplit branch, B its split tree. Never posts, never pushes, stops only the
// servers it started. Writes OUT/report.json, OUT/report.md and OUT/shots/*.png (A | B in one image).
//   node tools/split-real-e2e.mjs --a DIR --b DIR --out DIR [--model claude-haiku-5-5]
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, openSync, readFileSync, writeFileSync, realpathSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, homedir, devNull } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { chromePath } from './parity/flows.mjs';
import { freePort, HOST_APP_PORT, STUB_APPS } from './parity/launch.mjs';

export const FLOWS = ['pages', 'chat', 'run', 'history', 'setting', 'labs'];
// `#requirements` is left out: it is behind the `requirements` flag (src/shared/flags/registry.mjs), so it is not a main page
export const PAGES = ['#chat/new', '#new', '#runs', '#stats', '#workflows', '#projects', '#settings', '#models', '#schedules'];
export const VIEWPORTS = [{ id: 'desktop', width: 1280, height: 800 }, { id: 'm375', width: 375, height: 812 }];
const ANSWER = '.ask-msg-assistant';   // ask-panel.mjs `ask-msg ask-msg-${row.role}`: answer text may differ (request)
const TITLE = '.rd-page-title, .hd-title';   // the run's title is written by the model (title job): kept as a heading, its text left out
const NODES = ['n_clarify', 'n_plan', 'n_refine', 'n_impl', 'n_review'];   // wf_default (src/core/graph/builtin-workflows.mjs)
export const SETTLED = ['done', 'stopped', 'error', 'paused', 'interrupted'];   // ui/server.mjs SETTLED_RUN

export function realEnv(base, { home, port, stubLog }) {
  if (port === HOST_APP_PORT) throw new Error(`refusing port ${HOST_APP_PORT}: it belongs to the host worca app`);
  const env = Object.fromEntries(Object.entries(base).filter(([k]) => !k.startsWith('WORCA_') && k !== 'FORCE_COLOR' && k !== 'NODE_TEST_CONTEXT'));
  return { ...env, HOME: home, USERPROFILE: home, WORCA_HOME: home, PORT: String(port), WORCA_NO_NATIVE_DIALOG: '1', WORCA_STUB_APPS_LOG: stubLog };
}

/** Structure of the visible view: view ids, headings, tabs (digits → #), the button count; answer text left out. */
export const STRUCTURE = `(() => {
  const vis = (el) => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
  const pick = (sel) => [...document.querySelectorAll(sel)].filter(vis).filter((el) => !el.closest(${JSON.stringify(ANSWER)}))
    .map((el) => el.tagName.toLowerCase() + ':' + (el.matches(${JSON.stringify(TITLE)}) ? '(run title)' : (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').replace(/\\d+/g, '#').slice(0, 60)));
  return { view: [...document.querySelectorAll('section.view:not(.hidden)')].filter(vis).map((s) => s.id || s.dataset.view),
    headings: pick('h1,h2,h3,[role=heading]'), tabs: pick('[role=tab]'), buttons: pick('button').length };
})()`;

export function judgeFlow(id, a, b) {
  const why = [];
  if (!a.ok) why.push(`A failed: ${a.error ?? '?'}`);
  if (!b.ok) why.push(`B failed: ${b.error ?? '?'}`);
  if ((a.status ?? null) !== (b.status ?? null)) why.push(`status ${a.status} ≠ ${b.status}`);
  for (const k of ['view', 'headings', 'tabs', 'buttons']) if (JSON.stringify(a.structure?.[k]) !== JSON.stringify(b.structure?.[k])) why.push(`structure differs: ${k}`);
  const fresh = b.console.filter((x) => !a.console.includes(x));
  if (fresh.length) why.push(`${fresh.length} new console error${fresh.length > 1 ? 's' : ''}: ${fresh[0].slice(0, 160)}`);
  return { id, ok: !why.length, detail: why.length ? why.join('; ') : 'same structure and status; 0 new console errors' };
}

/** The payload POST /api/answer takes for a pending ask, the way auto mode answers it; null = no auto answer. */
export function answerFor(pq) {
  if (pq.kind === 'clarify' || pq.kind === 'questions') {
    return { answers: (pq.questions || []).map((q) => ({ id: q.id, choice: (q.options || []).find((o) => o && String(o).trim()) || 'auto' })) };
  }
  if (pq.kind === 'gate') return { decision: 'continue' };
  return null;
}

// the server's own log file (never ui/ sources): opened for its stdout, read for "already in use"
const openLog = (file) => openSync(file, 'a');
const logSays = (file, re) => re.test(readFileSync(file, 'utf8'));

async function api(base, path, body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

/** One real server on `tree`: temp HOME with the login keychain linked (sandbox-home-real-claude-chat rule), a free port. */
export async function startReal(tree, { out, name }) {
  const home = mkdtempSync(join(tmpdir(), `split-real-e2e-${name}-`));
  mkdirSync(join(home, 'Library'), { recursive: true });
  symlinkSync(join(homedir(), 'Library', 'Keychains'), join(home, 'Library', 'Keychains'));
  const port = await freePort(); const logFile = join(out, `${name}-server.log`); const fd = openLog(logFile);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', pathToFileURL(STUB_APPS).href, join(realpathSync(tree), 'ui', 'server.mjs')],
    { cwd: home, env: realEnv(process.env, { home, port, stubLog: join(home, '.parity-stubbed-apps.ndjson') }), stdio: ['ignore', fd, fd] });
  const base = `http://127.0.0.1:${port}`;
  for (const end = Date.now() + 60_000; ;) {
    if (logSays(logFile, /already in use/)) { child.kill('SIGTERM'); throw new Error(`${name}: port ${port} already in use (${logFile})`); }
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    if (Date.now() > end) { child.kill('SIGTERM'); throw new Error(`${name}: no /api/health in 60 s (${logFile})`); }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`${name}: pid ${child.pid}, port ${port}, home ${home}`);
  let exited = false; child.once('exit', () => { exited = true; });
  return { name, base, home, pid: child.pid, stop: () => (exited ? Promise.resolve() : new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); })) };
}

/** Open ws://…/ws, read the first `hello` frame, close; the run's summary ({ pipelineId, pendingQuestion, … }) or null. */
function helloRun(base, runId) {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`);
    const t = setTimeout(() => { ws.close(); fail(new Error('no ws hello in 10 s')); }, 10_000);
    ws.onmessage = (m) => { const f = JSON.parse(m.data); if (f.type !== 'hello') return;
      clearTimeout(t); ws.close(); ok((f.runs || []).find((r) => r.runId === runId) ?? null); };
    ws.onerror = () => { clearTimeout(t); fail(new Error('ws error')); };
  });
}

/** Poll until the run settles; answer every pending ask once. Returns { value, ref: { key, pid } } (pid = pipeline id). */
export async function waitRun(s, runId, project, { timeoutMs = 30 * 60_000, everyMs = 5_000 } = {}) {
  const answered = new Set(); let pipelineId = null;
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, everyMs))) {
    const { live = [], pipelines = [] } = await api(s.base, `/api/runs?projectDir=${encodeURIComponent(project)}`);
    const e = live.find((x) => x.runId === runId);
    if (e?.id) pipelineId = e.id;
    const row = pipelineId ? pipelines.find((p) => p.id === pipelineId) : null;
    const value = e && SETTLED.includes(e.status) ? e.status : !e && row ? row.status : null;
    if (value) {
      const { projects } = await api(s.base, '/api/projects');
      const key = projects.find((p) => realpathSync(p.path) === realpathSync(project))?.key;
      return { value, ref: { key, pid: pipelineId } };
    }
    // pendingQuestion travels only in the WS hello frame (summarizeRuns): a fresh socket per poll
    const hello = await helloRun(s.base, runId);
    if (hello?.pipelineId) pipelineId = hello.pipelineId;
    const pq = hello?.pendingQuestion;
    if (pq && !answered.has(pq.id)) {
      const payload = answerFor(pq);
      if (!payload) throw new Error(`run ${runId}: a '${pq.kind}' ask has no auto answer`);
      answered.add(pq.id); await api(s.base, '/api/answer', { runId, id: pq.id, payload });
    }
  }
  throw new Error(`run ${runId}: not settled in ${timeoutMs / 60_000} min`);
}

export async function runSide(s, { browser, project, model, shots }) {
  await api(s.base, '/api/onboarding', { welcomeSeen: true });
  await api(s.base, '/api/settings', { uiLevel: 'expert', askModels: { claude: { model, effort: 'medium' } } });
  await api(s.base, '/api/projects', { name: 'split-e2e', path: project });
  const res = {};
  const withPage = async (vp, fn) => {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } }); const page = await ctx.newPage();
    const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:<port>')); });
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    try { return { ...(await fn(page)), console: errs }; } catch (e) { return { ok: false, error: String(e.message).split('\n')[0], console: errs }; } finally { await ctx.close(); }
  };
  // the page's own fetches (workflows, guardrails, extension install) land late under load: wait for the network to go
  // quiet before reading the structure, and before a reload, which would otherwise abort a fetch and log its failure
  const idle = (page) => page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  // the structure once it holds still: two reads 1 s apart agree (late content such as Settings › Install or the
  // project rows' buttons arrives on either side at random under load), at most 20 s
  const structure = async (page) => {
    let prev = await page.evaluate(STRUCTURE);
    for (const end = Date.now() + 20_000; Date.now() < end;) {
      await page.waitForTimeout(1000); const now = await page.evaluate(STRUCTURE);
      if (JSON.stringify(now) === JSON.stringify(prev)) return now; prev = now;
    }
    return prev;
  };
  const go = async (page, hash) => { await page.goto(`${s.base}/${hash}`, { waitUntil: 'load' }); await page.waitForFunction(() => !!window.__np?.getRun, null, { timeout: 20_000 }); await idle(page); await page.waitForTimeout(800); };
  // pages: every main page, light and dark, desktop and 375 px; one structure per page/theme/width (res.pageStructures, compared
  // one by one in main), shots for the side-by-side; the flow's own structure is their concatenation
  res.pageStructures = {}; const errs = []; let failed = null;
  for (const theme of ['light', 'dark']) {
    await api(s.base, '/api/settings', { theme });
    for (const vp of VIEWPORTS) {
      const r = await withPage(vp, async (page) => {
        for (const h of PAGES) {
          await go(page, h);
          res.pageStructures[`${theme}/${vp.id}/${h}`] = await structure(page);
          await page.screenshot({ path: join(shots, `${s.name}-${theme}-${vp.id}-${h.replace(/\W+/g, '_')}.png`) });
        }
        return { ok: true };
      });
      errs.push(...r.console); if (!r.ok) failed ??= r.error;
    }
  }
  await api(s.base, '/api/settings', { theme: 'light' });
  const ps = Object.values(res.pageStructures);
  res.pages = { ok: !failed, ...(failed ? { error: failed } : {}), status: `${ps.length} page views`, console: errs,
    structure: { view: Object.keys(res.pageStructures), headings: ps.flatMap((x) => x.headings), tabs: ps.flatMap((x) => x.tabs), buttons: ps.reduce((n, x) => n + x.buttons, 0) } };
  // chat: one real message; the turn ends when Stop hides again and an answer row exists
  res.chat = await withPage(VIEWPORTS[0], async (page) => {
    await go(page, '#chat/new');
    await page.fill('[data-chat-page] textarea.ask-input', 'Reply with the single word: pong');
    await page.click('[data-chat-page] button[data-ask-send]');
    await page.waitForSelector(ANSWER, { timeout: 180_000 });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-ask-stop]')].every((b) => b.hidden), null, { timeout: 180_000 });
    const bad = await page.locator('.ask-error-line').count();
    await page.screenshot({ path: join(shots, `${s.name}-light-desktop-chat.png`) });
    return { ok: bad === 0, status: bad ? 'error' : 'answered', structure: await structure(page) };
  });
  // run: a small real run to finish (wf_default, every node on the model); a clarify question gets its first option
  res.run = await (async () => {
    try {
      const { runId } = await api(s.base, '/api/run', { projectDir: project, prompt: 'Add a file NOTES.md with exactly one line: hello from the 919 e2e check.',
        workflowId: 'wf_default', overlay: { nodes: Object.fromEntries(NODES.map((n) => [n, { model }])) } });
      const status = await waitRun(s, runId, project);
      res.runRef = status.ref;
      return { ok: status.value === 'done', status: status.value, structure: { view: [], headings: [], tabs: [], buttons: 0 }, console: [] };
    } catch (e) { return { ok: false, error: e.message, console: [] }; }
  })();
  // history: Diff, Logs and Artifacts tabs of that run, each non-empty (`.hd-sec[data-sec=…]`; uiLevel expert shows all three)
  res.history = await withPage(VIEWPORTS[0], async (page) => {
    if (!res.runRef) return { ok: false, error: 'no finished run' };
    for (const tab of ['diff', 'logs', 'artifacts']) {
      const sel = `.hd-sec[data-sec="${tab}"]:not([hidden])`;
      await go(page, `#history/${res.runRef.key}/${res.runRef.pid}/details/${tab}`);
      await page.waitForSelector(sel, { timeout: 20_000 });
      if (!(await page.locator(sel).first().innerText()).trim()) return { ok: false, error: `${tab} tab empty` };
      await page.screenshot({ path: join(shots, `${s.name}-light-desktop-history_${tab}.png`) });
    }
    return { ok: true, status: 'tabs filled', structure: await structure(page) };
  });
  // setting: "Draft the PR description with AI automatically" persists after a reload
  res.setting = await withPage(VIEWPORTS[0], async (page) => {
    await go(page, '#settings/runs'); const before = await page.isChecked('#prAutoDescribe');
    // the checkbox is a visually hidden .sw-input under its switch: click its label, as a person does
    await page.click('label[for="prAutoDescribe"]'); await page.click('#prSettingsSave'); await idle(page); await page.waitForTimeout(500);
    await page.reload({ waitUntil: 'load' }); await go(page, '#settings/runs');
    const after = await page.isChecked('#prAutoDescribe'); const saved = (await api(s.base, '/api/settings')).autoGeneratePrDescription;
    return { ok: after === !before && saved === after, status: `prAutoDescribe ${before} → ${after}`, structure: await structure(page) };
  });
  // labs: flagsDemo on shows its note, and it survives a reload (the switch is a div[role=switch]: a click PATCHes /api/flags)
  res.labs = await withPage(VIEWPORTS[0], async (page) => {
    await go(page, '#settings/experimental'); await page.click('[data-flag-switch="flagsDemo"]');
    await page.waitForSelector('#flags-demo-note', { state: 'visible', timeout: 10_000 }); await idle(page);
    await page.reload({ waitUntil: 'load' }); await go(page, '#settings/experimental');
    const shown = await page.isVisible('#flags-demo-note');
    await page.screenshot({ path: join(shots, `${s.name}-light-desktop-labs.png`) });
    return { ok: shown, status: shown ? 'note shown' : 'note hidden', structure: await structure(page) };
  });
  return res;
}

const GIT_ENV = { GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'split-e2e', GIT_AUTHOR_EMAIL: 'split-e2e@example.invalid',
  GIT_COMMITTER_NAME: 'split-e2e', GIT_COMMITTER_EMAIL: 'split-e2e@example.invalid', GIT_AUTHOR_DATE: '2026-11-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-01T00:00:00Z' };

/** The throwaway project, rebuilt byte-identical before each side (same path, same HEAD SHA). */
export function makeProject(dir) {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const git = (...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${devNull}`, ...a], { cwd: dir, env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), '# split-e2e\n\nA throwaway project for the #919 real-instance check.\n');
  git('add', 'README.md'); git('commit', '-q', '-m', 'init');
  return git('rev-parse', 'HEAD').trim();
}

/** A | B in one PNG: a page with the two shots as data URLs in a two-column grid, screenshotted. */
export async function sideBySide(browser, aFile, bFile, outFile) {
  const url = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 400 } }); const page = await ctx.newPage();
  try {
    await page.setContent(`<style>body{margin:0;font:12px system-ui;background:#fff}main{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px}
      figure{margin:0}figcaption{padding:2px 0}img{width:100%;border:1px solid #ccc}</style><main><figure><figcaption>A (unsplit)</figcaption><img src="${url(aFile)}"></figure>
      <figure><figcaption>B (split)</figcaption><img src="${url(bFile)}"></figure></main>`);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    await page.screenshot({ path: outFile, fullPage: true });
  } finally { await ctx.close(); }
}

export function renderReport(r) {
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return `# Real-instance e2e (#919 T2) — ${r.pass ? 'PASS' : 'FAIL'}\n\nModel \`${r.model}\` · A \`${r.a.tree}\` · B \`${r.b.tree}\` · project HEAD ${r.a.projectHead} (A), ${r.b.projectHead} (B)\n\n`
    + '| Flow | Result | Detail | Evidence |\n|---|---|---|---|\n'
    + r.flows.map((f) => `| ${f.id} | ${f.ok ? 'pass' : 'FAIL'} | ${cell(f.detail)} | ${cell(f.evidence)} |`).join('\n') + '\n';
}

export async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const a = arg('--a'); const b = arg('--b'); const outArg = arg('--out'); const model = arg('--model') ?? 'claude-haiku-5-5';
  if (!a || !b || !outArg) { log('usage: node tools/split-real-e2e.mjs --a DIR --b DIR --out DIR [--model claude-haiku-5-5]'); return 2; }
  const out = resolve(outArg); const shots = join(out, 'shots'); mkdirSync(join(shots, 'side-by-side'), { recursive: true });
  const project = join(mkdtempSync(join(tmpdir(), 'split-real-e2e-project-')), 'split-e2e');
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const servers = []; const sides = {}; const heads = {};
  try {
    for (const [name, tree] of [['A', a], ['B', b]]) {
      heads[name] = makeProject(project);
      const s = await startReal(tree, { out, name }); servers.push(s);
      try { sides[name] = await runSide(s, { browser, project, model, shots }); } finally { await s.stop(); }
    }
    const flows = FLOWS.map((id) => ({ ...judgeFlow(id, sides.A[id], sides.B[id]), evidence: 'report.md' }));
    // pages: also each page/theme/width one by one
    const pageDiffs = Object.keys({ ...sides.A.pageStructures, ...sides.B.pageStructures })
      .filter((k) => JSON.stringify(sides.A.pageStructures[k]) !== JSON.stringify(sides.B.pageStructures[k]));
    const pages = flows.find((f) => f.id === 'pages');
    if (pageDiffs.length) Object.assign(pages, { ok: false, detail: `${pages.detail}; ${pageDiffs.length} page views differ, first ${pageDiffs[0]}` });
    for (const f of readdirSync(shots).filter((x) => x.startsWith('A-') && x.endsWith('.png'))) {
      const bf = join(shots, `B-${f.slice(2)}`);
      if (existsSync(bf)) await sideBySide(browser, join(shots, f), bf, join(shots, 'side-by-side', f.slice(2)));
    }
    const report = { model, a: { tree: realpathSync(a), projectHead: heads.A }, b: { tree: realpathSync(b), projectHead: heads.B }, flows, pass: flows.every((f) => f.ok) };
    writeFileSync(join(out, 'report.json'), JSON.stringify({ ...report, sides }, null, 2));
    writeFileSync(join(out, 'report.md'), renderReport(report));
    log(`split-real-e2e: ${report.pass ? 'PASS' : 'FAIL'} (${join(out, 'report.md')})`);
    return report.pass ? 0 : 1;
  } finally {
    for (const s of servers) await s.stop();
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main();
