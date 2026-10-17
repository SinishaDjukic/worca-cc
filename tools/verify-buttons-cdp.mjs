#!/usr/bin/env node
// tools/verify-buttons-cdp.mjs — headless-Chrome proof that every main view draws its buttons on the one scale
// (sm 28 / md 34 / lg 42), with at most one lg per view, the Settings and saved-run tabs at 32px, the run page's PR CTA
// content-sized at desktop and spanning its card at 390px, and no scale :hover rule that lifts. Bespoke controls are
// printed as info lines with their heights. --out DIR writes ${prefix}-${view}-${mode}.png (light and dark) per view;
// --prefix before|after (default after); --no-check prints every check but exits 0 (for the before shots).
// NOT part of `npm test`: it needs Chrome. Its pure audit exports are tested in test/verify-buttons-cdp.test.mjs.
// Run: node tools/verify-buttons-cdp.mjs [--out DIR] [--prefix before|after] [--no-check]   (or: npm run verify:buttons)
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SCALE = [28, 34, 42];
export const LG = 42;
export const SCALE_SEL = '.btn, .btn-ghost, .btn-go, .rd-cta';
export const LINK_LOOK = '.plan-fold, .plan-persp-edit';
export const VIEW_NAMES = ['chat-home', 'chat-run-card', 'run-live', 'run-saved', 'runs', 'new', 'schedules', 'projects',
  'models', 'stats', 'settings', 'dialog'];

/** One view's desktop audit. buttons: [{ cls, h, w }] (heights rounded). Returns failure strings; [] is a pass. */
export function auditView(name, buttons, { must = [], tabs = null, tabH = 32, minButtons = 1 } = {}) {
  const fails = [];
  if (buttons.length < minButtons) fails.push(`${name}: no scale buttons drawn`);
  for (const b of buttons) if (!SCALE.includes(b.h)) fails.push(`${name}: ${b.cls} is ${b.h}px (28, 34 or 42)`);
  const lg = buttons.filter((b) => b.h === LG);
  if (lg.length > 1) fails.push(`${name}: ${lg.length} lg buttons (${lg.map((b) => b.cls).join(' | ')}), at most 1`);
  for (const m of must) {
    if (!m.found) fails.push(`${name}: ${m.sel} is not drawn`);
    else if (m.h !== m.want) fails.push(`${name}: ${m.sel} is ${m.h}px, want ${m.want}`);
  }
  if (tabs) {
    if (!tabs.length) fails.push(`${name}: no tabs drawn`);
    for (const t of tabs) if (t.h !== tabH) fails.push(`${name}: tab ${t.cls || t.text} is ${t.h}px, want ${tabH}`);
  }
  return fails;
}

/** The CTA rule: content-sized at desktop, the card's width at 390px. */
export function auditCta({ cta, box }, phone) {
  if (!cta || !box) return ['run-saved: no .rd-cta / .rd-pr-box'];
  if (phone) return cta.w >= box.w - 33 ? [] : [`run-saved: CTA ${cta.w}px at 390px does not span its card (${box.w}px)`];
  return cta.w < box.w - 100 ? [] : [`run-saved: CTA ${cta.w}px at desktop is not content-sized (card ${box.w}px)`];
}

async function main() {
  const { spawn, execFileSync } = await import('node:child_process');
  const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;

  const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
  const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
  const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
    ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
  if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
  const argv = process.argv;
  const flag = (name) => { const i = argv.indexOf(name); return i > 0 && argv[i + 1] ? argv[i + 1] : null; };
  const OUT = flag('--out') ? path.resolve(flag('--out')) : null;
  const PREFIX = flag('--prefix') || 'after';
  const NO_CHECK = argv.includes('--no-check');
  const PORT = Number(process.env.CDP_PORT || 9344);
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
  const info = (what) => log(`info ${what}`);

  // ---- a sandboxed HOME (settings live there) and WORCA_HOME (the DB), offline, then the server in process.
  home = await mkdtemp(path.join(tmpdir(), 'worca-btn-home-'));
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_HOME = path.join(home, '.worca-cc');
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  // No GitHub or Azure DevOps credential reaches the sandbox: the PR lookup must never mint a token over the network.
  const { stripGithubCredentials } = await import(new URL('../src/core/github-credentials.mjs', import.meta.url).href);
  const clean = stripGithubCredentials(process.env);
  for (const k of Object.keys(process.env)) if (!(k in clean)) delete process.env[k];
  for (const k of ['WORCA_ADO_TOKEN', 'AZURE_DEVOPS_EXT_PAT', 'WORCA_ADO_READ_TOKEN', 'WORCA_ADO_WRITE_TOKEN']) delete process.env[k];
  proj = await mkdtemp(path.join(tmpdir(), 'worca-btn-proj-'));
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'proof@worca.local'], ['config', 'user.name', 'proof']]) execFileSync('git', a, { cwd: proj });
  await writeFile(path.join(proj, 'README.md'), '# buttons proof\n');
  execFileSync('git', ['add', '-A'], { cwd: proj });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
  const { server, runs: liveRuns } = await import(new URL('../ui/server.mjs', import.meta.url).href);
  // A fake gh, before any API call: only the saved-run PR lookup's two calls answer; every other gh call fails.
  const gi = await import(new URL('../src/core/git-info.mjs', import.meta.url).href);
  const PR = 'https://github.com/o/r/pull/1';
  const fail = { ok: false, stdout: '', stderr: 'fake gh', code: 1 };
  gi._testing.setRunner(async (cmd, args, opts) => {
    if (cmd !== 'gh') return gi._testing.defaultRun(cmd, args, opts);
    if (args[0] === '--version') return { ok: true, stdout: 'gh version 2.0.0\n', stderr: '', code: 0 };
    if (args[0] === 'pr' && args[1] === 'view' && args.includes('number,state,url'))
      return { ok: true, stdout: JSON.stringify({ number: 1, state: 'OPEN', url: PR }), stderr: '', code: 0 };
    return fail;
  });
  const { getDb } = await import(new URL('../src/core/db.mjs', import.meta.url).href);
  const { projectKey } = await import(new URL('../src/core/store.mjs', import.meta.url).href);
  const { writeStoreMeta } = await import(new URL('../src/core/artifacts.mjs', import.meta.url).href);
  const { createSliceFeature } = await import(new URL('../src/core/shape/features.mjs', import.meta.url).href);
  const { addNotification } = await import(new URL('../src/core/notifications.mjs', import.meta.url).href);
  const askStore = await import(new URL('../src/core/ask/store.mjs', import.meta.url).href);
  const { validateProposal } = await import(new URL('../src/core/ask/proposal.mjs', import.meta.url).href);
  srv = server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = async (url, body) => {
    const r = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`POST ${url}: HTTP ${r.status} ${await r.text()}`);
    return r.json();
  };
  await post('/api/settings', { uiLevel: 'expert' });
  await post('/api/onboarding', { welcomeSeen: true });

  // ---- seed (D15): the project, the feature-page runs, a chat card on a done run, a live stub, a feed notification.
  await post('/api/projects', { name: 'Proof', path: proj });
  const key = projectKey(proj);
  writeStoreMeta(key, 'project', { key, name: 'Proof', path: proj });
  const now = new Date().toISOString();
  const pipeline = (id, status, title, branch) => getDb().prepare(`INSERT INTO pipelines (id, project_key, target, title, status, phase,
    cycle, started_at, updated_at, total_cost_usd, total_active_ms, branch) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, key, 'project', title, status, status, 0, now, now, 0, 0, JSON.stringify(branch));
  const sl = (n, title) => ({ id: `s${n}`, title, goal: `Goal ${n}`, inScope: [], outOfScope: [], acceptance: [`ok ${n}`], dependsOn: [], estimate: 'M' });
  const TITLES = ['Store tags', 'Run tags', 'Cost report'];
  pipeline('fp000001', 'done', 'Run tags and cost allocation · 1/3: Store tags', { source: 'main', feature: 'feat/fp1' });
  getDb().prepare("UPDATE pipelines SET pr_url = ?, pr_state = 'OPEN' WHERE id = 'fp000001'").run(PR);
  const f = createSliceFeature({ pipelineId: 'fp000001', projectDir: proj, title: 'Run tags and cost allocation',
    outline: { why: 'proof', slices: TITLES.map((t, i) => sl(i + 1, t)) }, perspectives: ['product'], workflowId: 'wf_shape' });
  pipeline('fp000002', 'paused', 'Run tags and cost allocation · 2/3: Run tags', { source: 'feat/fp1', feature: 'feat/fp2' });
  const t2 = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2').get(f.id).ticket_id;
  getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = 'fp000002' WHERE id = ?").run(t2);
  // The chat run card: the Ask run-ref check takes 8 hex characters, so this run id is hex (fp000001 would not match).
  pipeline('c0ffee01', 'done', 'Buttons chat run', { source: 'main', feature: 'feat/chat' });
  getDb().prepare("UPDATE pipelines SET pr_url = ?, pr_state = 'OPEN' WHERE id = 'c0ffee01'").run(PR);
  const thread = askStore.createThread({ title: 'Buttons chat' });
  askStore.appendMessage(thread.id, { role: 'user', text: 'Make the buttons sleeker.' });
  const cardId = askStore.newAskId('card');
  const started = await validateProposal({ projectKey: key, workflowId: 'wf_default', guardrailsId: 'normal', title: 'Buttons chat run',
    brief: 'One button scale across the app.' }, { cardId });
  if (!started.ok) throw new Error(`ask proposal: ${started.errors.join('; ')}`);
  askStore.appendMessage(thread.id, { role: 'assistant', status: 'done', text: 'Here is a run for it:',
    blocks: [{ kind: 'card', id: cardId, state: 'started', runId: 'c0ffee01', card: started.card }] });
  askStore.linkRun(thread.id, { runId: 'c0ffee01', cardId, pipelineId: 'c0ffee01', status: 'done' });
  // The live run: hello summarises the Map once per WebSocket, so the stub is in before the first load. Run after shows
  // only when pipelineId is set; it is read from the hello summary, so no DB row is written for it.
  liveRuns.set('btn-live', { id: 'btn-live', kind: 'run', status: 'running', pipelineId: 'btnlive01', title: 'Buttons live run',
    projectDir: proj, startedAt: new Date().toISOString(), events: [], pendingQuestion: null, orch: null });
  addNotification({ kind: 'completed', severity: 'info', ticketId: t2, pipelineId: 'fp000002', projectDir: proj, message: 'Run finished' });
  log(`server ${base} · project ${key} · thread ${thread.id}`);

  // ---- chrome + cdp
  profile = await mkdtemp(path.join(tmpdir(), 'worca-btn-profile-'));
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
  function cdp(method, params = {}, ms = 15000) {
    const id = ++msgId;
    return new Promise((res, rej) => {
      const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT ${method}`)); }, ms);
      pending.set(id, { res: (v) => { clearTimeout(to); res(v); }, rej: (er) => { clearTimeout(to); rej(er); } });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  /** A real page load: a distinct URL, awaited on its load event (a same-URL navigate is a fragment hop and never loads). */
  async function load(url) {
    const loaded = nextEvent('Page.loadEventFired');
    await cdp('Page.navigate', { url });
    await loaded;
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
  // Wait only for animations that END: the page always runs infinite ones (spinners), whose .finished never resolves.
  const settleStyles = () => ev(`(async () => { document.activeElement?.blur?.();
    await Promise.all(document.getAnimations()
      .filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime))
      .map((a) => a.finished.catch(() => null)));
    return true; })()`);
  async function setTheme(mode) {
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
    await ev(`document.documentElement.dataset.theme = ${JSON.stringify(mode)}, true`);
  }
  const desktop = async () => {
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await desktop();
  // A first page on the origin, so a view's `prep` (localStorage) has a document to run in.
  await load(`${base}/?s=boot#chat`);

  const VIEWS = [
    { name: 'chat-home', hash: '#chat', root: '[data-view="chat"]:not(.hidden)', ready: '.chat-home', minButtons: 0 },
    { name: 'chat-run-card', hash: `#chat/${thread.id}`, root: '[data-view="chat"]:not(.hidden)', ready: '.chat-rc-view-pr',
      must: [{ sel: '.chat-rc-view-pr', want: 28 }] },
    { name: 'run-live', hash: '#running/btn-live', root: '#run-detail', ready: '.rd-after:not([hidden])',
      must: [{ sel: '.rd-after', want: 34 }, { sel: '.rd-pause', want: 34 }, { sel: '.rd-stop', want: 34 }, { sel: '.term-opener', want: 34 }] },
    { name: 'run-saved', hash: `#history/${key}/fp000001`, root: '#hist-detail', ready: '.rd-pr-slot > .rd-cta',
      must: [{ sel: '.rd-cta', want: 42 }], cta: true },
    { name: 'run-tabs', hash: `#history/${key}/fp000001/details`, root: '#hist-detail', ready: '.hd-tab', tabs: '.hd-tab', shot: false },
    { name: 'runs', hash: '#runs', root: '[data-view="runs"]:not(.hidden)', ready: '.runs-list', minButtons: 0,
      prep: "localStorage.removeItem('worca-cc.runs.last')" },
    { name: 'new', hash: '#new', root: '[data-view="new"]:not(.hidden)', ready: '#start-btn', must: [{ sel: '#start-btn', want: 42 }] },
    { name: 'schedules', hash: '#schedules/activity', root: '[data-view="schedules"]:not(.hidden)', ready: '.sched-feed-open',
      must: [{ sel: '#schedules-new', want: 34 }, { sel: '.sched-feed-open', want: 28 }] },
    { name: 'projects', hash: '#projects', root: '[data-view="projects"]:not(.hidden)', ready: '#project-add-btn',
      must: [{ sel: '#project-add-btn', want: 28 }] },
    { name: 'models', hash: '#models', root: '[data-view="models"]:not(.hidden)', ready: '#model-create-btn',
      must: ['#model-share-btn', '#model-import-btn', '#model-create-btn'].map((sel) => ({ sel, want: 34 })) },
    // loadStatsView has no sequence guard: wait for the route's own load to finish before switching the grouping, or
    // that load can land last and repaint #stats-body without .stats-export.
    { name: 'stats', hash: '#stats', root: '[data-view="stats"]:not(.hidden)', ready: '#stats-body:not(.is-loading) > :not(small)',
      open: "(() => { const s = document.querySelector('#stats-group'); s.value = 'person'; s.dispatchEvent(new Event('change', { bubbles: true })); })()",
      after: '#stats-body:not(.is-loading) .stats-export', must: [{ sel: '.stats-export', want: 28 }] },
    { name: 'settings', hash: '#settings', root: '[data-view="settings"]:not(.hidden)', ready: '#settings-tabs', tabs: '#settings-tabs > button' },
    { name: 'dialog', hash: '#running/btn-live', root: '#stop-modal:not(.hidden)', ready: '.rd-stop:not([hidden])',
      open: "document.querySelector('#run-detail .rd-stop').click()", after: '#stop-modal:not(.hidden)',
      must: [{ sel: '.stop-cancel', want: 34 }, { sel: '.stop-confirm', want: 34 }] },
  ];
  const shotNames = VIEWS.filter((v) => v.shot !== false).map((v) => v.name);
  if (JSON.stringify(shotNames) !== JSON.stringify(VIEW_NAMES)) throw new Error(`VIEWS (${shotNames}) drift from VIEW_NAMES`);
  const measure = (root) => ev(`(() => { const host = document.querySelector(${JSON.stringify(root)}); if (!host) return null;
    const vis = (b) => b.offsetParent && b.getBoundingClientRect().height > 0;
    const row = (b) => ({ cls: b.className, text: b.textContent.replace(/\s+/g, ' ').trim().slice(0, 30), h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) });
    return { scale: [...host.querySelectorAll(${JSON.stringify(SCALE_SEL)})].filter((b) => vis(b) && !b.matches(${JSON.stringify(LINK_LOOK)})).map(row),
      other: [...host.querySelectorAll('button')].filter((b) => vis(b) && !b.matches(${JSON.stringify(SCALE_SEL)})).map(row) }; })()`);
  const measureMust = (root, sel) => ev(`(() => { const b = document.querySelector(${JSON.stringify(root)})?.querySelector(${JSON.stringify(sel)});
    return b && b.offsetParent ? { found: true, h: Math.round(b.getBoundingClientRect().height) } : { found: false }; })()`);
  // Tabs use the same visibility filter: the flag-gated Settings Tags tab and level-hidden .hd-tabs are 0px.
  const measureTabs = (root, sel) => ev(`(() => { const host = document.querySelector(${JSON.stringify(root)}); if (!host) return [];
    return [...host.querySelectorAll(${JSON.stringify(sel)})].filter((b) => b.offsetParent && b.getBoundingClientRect().height > 0)
      .map((b) => ({ cls: b.className, text: b.textContent.replace(/\s+/g, ' ').trim().slice(0, 30), h: Math.round(b.getBoundingClientRect().height) })); })()`);
  const measureCta = (root) => ev(`(() => { const host = document.querySelector(${JSON.stringify(root)});
    const w = (e) => e ? { w: Math.round(e.getBoundingClientRect().width) } : null;
    return { cta: w(host?.querySelector('.rd-cta')), box: w(host?.querySelector('.rd-pr-box')) }; })()`);
  // The no-lift check walks grouping rules too: style.css has many @media blocks, and document.styleSheets lists only top-level rules.
  const liftRules = () => ev(`(() => { const out = []; const scale = /\\.(?:btn[\\w-]*|rd-cta)(?![\\w-])/;
    const walk = (list) => { for (const r of list) { if (r.cssRules && !(r instanceof CSSStyleRule)) walk(r.cssRules);
      else if (r instanceof CSSStyleRule && /:hover/.test(r.selectorText) && scale.test(r.selectorText) && /translateY/.test(r.style.transform)) out.push(r.selectorText); } };
    for (const s of document.styleSheets) { try { walk(s.cssRules); } catch {} } return out; })()`);
  const report = (fails, what) => { if (fails.length) for (const x of fails) check(false, x); else check(true, what); };

  if (OUT) await mkdir(OUT, { recursive: true });
  const shots = [];
  for (const v of VIEWS) {
    await desktop();
    if (v.prep) await ev(`(${v.prep}, true)`);
    await load(`${base}/?s=${v.name}${v.hash}`);
    await waitFor(`!!document.querySelector(${JSON.stringify(v.ready)})`, `${v.name}: ${v.ready}`);
    if (v.open) {
      await ev(`(${v.open}, true)`);
      await waitFor(`!!document.querySelector(${JSON.stringify(v.after)})`, `${v.name}: ${v.after}`);
    }
    await settleStyles();
    const got = await measure(v.root);
    if (!got) { check(false, `${v.name}: ${v.root} is not drawn`); continue; }
    const must = [];
    for (const m of v.must || []) must.push({ ...m, ...(await measureMust(v.root, m.sel)) });
    const tabs = v.tabs ? await measureTabs(v.root, v.tabs) : null;
    report(auditView(v.name, got.scale, { must, tabs, minButtons: v.minButtons ?? 1 }),
      `${v.name}: ${got.scale.length} scale button(s) on 28/34/42${tabs ? `, ${tabs.length} tab(s) at 32` : ''}`);
    for (const b of got.scale) info(`${v.name}: scale ${b.h}px ${b.cls} "${b.text}"`);
    for (const b of got.other) info(`${v.name}: other ${b.h}px ${b.cls || '(no class)'} "${b.text}"`);
    if (v.cta) report(auditCta(await measureCta(v.root), false), `${v.name}: the CTA is content-sized at 1280px`);
    if (OUT && v.shot !== false) {
      for (const mode of ['light', 'dark']) {
        await setTheme(mode); await settleStyles();
        const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
        const file = path.join(OUT, `${PREFIX}-${v.name}-${mode}.png`);
        await writeFile(file, Buffer.from(data, 'base64'));
        shots.push(file);
      }
      await setTheme('light');
    }
    if (v.cta) {
      // Phone: 390px wide with a coarse pointer (touch emulation is what flips (pointer: coarse) in Chrome).
      await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await settleStyles();
      report(auditCta(await measureCta(v.root), true), `${v.name}: the CTA spans its card at 390px`);
      await desktop();
    }
  }
  const lifts = await liftRules();
  check(lifts.length === 0, `no scale :hover rule lifts${lifts.length ? `: ${lifts.join(' | ')}` : ''}`);
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  if (OUT) console.log(`screenshots (${shots.length}):\n  ${shots.join('\n  ')}`);
  console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
  await shutdown(failed && !NO_CHECK ? 1 : 0);
}

const isMain = (() => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) await main();
