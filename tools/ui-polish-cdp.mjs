#!/usr/bin/env node
// tools/ui-polish-cdp.mjs — the UI/UX polish measurements (review 2026-10-19, D23): a mock server on a temp HOME, a
// finished 3-run feature with PRs (test/helpers/ship-world.mjs), and headless Chrome over the 9 review screens plus a
// Chat feature card and a Ship card, in light and dark at 1280, 375 and 290 px. Each combination runs the one-button audit
// and the surface audit (tools/button-audit.mjs) and records the measured heights of tabs, segments, tiles, info tips
// and the page heading. NOT part of `npm test`: it needs Chrome.
// Run: node tools/ui-polish-cdp.mjs [--out after.json] [--before before.json]
//   --out writes the measurements as JSON; --before reads an earlier run's JSON (e.g. on b15f0381) for the table.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditButtons, auditSurface, BUTTON_SPEC, SURFACE_SPEC } from './button-audit.mjs';

// `ready` must be on screen before the audits run (the tool fails otherwise, so a card screen never measures a stand-in);
// `prep` names a step the page needs first (open-plan: Chat › Plans, then open the plan's feature card). `also` is a second
// view of the same screen, audited into the same row: the saved run page's tab strip lives in its Details mode.
const view = (v) => `[data-view="${v}"]:not(.hidden)`;
export const SCREENS = Object.freeze([
  { key: 'chat', hash: '#chat', ready: '.chat-home-title' }, { key: 'new-run', hash: '#new', ready: view('new') },
  { key: 'runs', hash: '#runs', ready: view('runs') },
  { key: 'run-page', hash: '#history/{run}', ready: '.hd .rd-glance:not([hidden])',
    also: { hash: '#history/{run}/details', ready: '.hd-tabs [role="tab"]' } },
  { key: 'group-page', hash: '#feature/{feature}', ready: '#runs-pane #group-detail .gpage' },
  { key: 'schedules', hash: '#schedules', ready: view('schedules') }, { key: 'workflows', hash: '#workflows', ready: view('workflows') },
  { key: 'statistics', hash: '#stats', ready: view('stats') }, { key: 'settings', hash: '#settings/runs', ready: view('settings') },
  { key: 'feature-card', hash: '#chat', prep: 'open-plan', ready: '.chat-home-plan .shape-feature' },
  { key: 'ship-card', hash: '#chat/{shipThread}', ready: '.ask-card[data-ship-card="ready"]' },
].map(Object.freeze));
export const MATRIX = Object.freeze({ themes: ['light', 'dark'], widths: [1280, 375, 290] });

/** One Markdown row per screen × theme × width: violations before → after. */
export function table(before, after) {
  const k = (m) => `${m.screen}|${m.theme}|${m.width}`;
  const a = new Map(after.map((m) => [k(m), m]));
  const lines = ['| Screen | Theme | Width | Violations before | after |', '|---|---|---|---|---|'];
  for (const b of before) lines.push(`| ${b.screen} | ${b.theme} | ${b.width} | ${b.violations} | ${a.get(k(b))?.violations ?? '–'} |`);
  return lines.join('\n');
}

// The measured heights the PR quotes beside the counts (page-side, serialised like the audits).
function measure() {
  const hs = (sel) => [...new Set([...document.querySelectorAll(sel)].map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h > 0))];
  const h1 = document.querySelector('.rd-page-title, .gpage-title');
  return { tab: hs('.tab'), seg: hs('.seg button'), tile: hs('.chat-home-act'), infoTip: hs('.info-tip'),
    h1: h1 && h1.getBoundingClientRect().height > 0 ? getComputedStyle(h1).fontSize : null };
}

async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
  const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
  const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0 ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
  if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
  const PORT = Number(process.env.CDP_PORT || 9337);
  const T0 = Date.now();
  const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let chrome = null; let srv = null; let home = null; let profile = null; let cleanup = null;
  async function shutdown(code) {
    try { if (chrome) chrome.kill('SIGKILL'); } catch {}
    try { if (srv) await new Promise((r) => srv.close(r)); } catch {}
    try { if (cleanup) cleanup(); } catch {}
    for (const d of [home, profile]) { try { if (d) await rm(d, { recursive: true, force: true }); } catch {} }
    process.exit(code);
  }
  for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
    process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
  }

  // ---- a sandboxed HOME (settings) and WORCA_HOME (the DB), the Shaper on, then the server in process.
  home = await mkdtemp(path.join(tmpdir(), 'worca-polish-home-'));
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_HOME = path.join(home, '.worca-cc');
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  const { server } = await import(new URL('../ui/server.mjs', import.meta.url).href);
  const { shipKit } = await import(new URL('../test/helpers/ship-world.mjs', import.meta.url).href);
  const { createThread, appendMessage, linkRun } = await import(new URL('../src/core/ask/store.mjs', import.meta.url).href);
  const { recordShapePlan } = await import(new URL('../src/core/shape/features.mjs', import.meta.url).href);
  const { projectKey } = await import(new URL('../src/core/store.mjs', import.meta.url).href);
  srv = server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
  { const r = await post('/api/settings', { uiLevel: 'expert' });
    if (!r.ok) throw new Error(`could not pin the interface mode: HTTP ${r.status}`); }

  // ---- the world: a finished 3-run feature with a PR each. Its plan thread puts the feature card on Chat › Plans
  // (shape_plans + the run link, as the Shaper records them); a second thread holds the Ship card the server offers
  // when the last run is done (offerShipCard, ui/server.mjs).
  let n = 0;
  const kit = shipKit({ nextId: () => `pl${String(++n).padStart(6, '0')}`,
    outlineOf: (k) => ({ why: 'polish', slices: Array.from({ length: k }, (_, i) => ({ id: `s${i + 1}`, title: `Slice ${i + 1}`,
      goal: `Goal ${i + 1}`, inScope: [], outOfScope: [], acceptance: [`ok ${i + 1}`], dependsOn: [], estimate: 'M' })) }) });
  cleanup = kit.cleanup;
  const world = kit.shipWorld();
  const key = projectKey(world.dir);
  const pid = world.pids[0];
  const plan = createThread({ title: 'Charts' });
  appendMessage(plan.id, { role: 'assistant', text: 'Started.', status: 'done',
    blocks: [{ kind: 'card', id: `card_${pid}`, state: 'started', runId: pid, card: { target: 'project', projectKey: key, pipelineId: pid } }] });
  recordShapePlan({ threadId: plan.id, cardId: `card_${pid}`, title: 'Charts' });
  linkRun(plan.id, { runId: pid, cardId: `card_${pid}`, pipelineId: pid, status: 'done' });
  const ship = createThread({ title: 'Ship Charts' });
  appendMessage(ship.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: 'card_ship', state: 'proposed',
    card: { type: 'ship', featureId: world.f.id, title: world.f.title || 'Charts', runs: 3, files: 12, added: 840, deleted: 120, suggested: 'one', release: null } }] });
  const fill = { run: `${key}/${pid}`, feature: world.f.id, shipThread: ship.id };
  const hashOf = (s) => s.hash.replace(/\{(\w+)\}/g, (_, k) => fill[k]);
  log(`server ${base} · feature ${world.f.id}`);

  // ---- chrome + cdp
  profile = await mkdtemp(path.join(tmpdir(), 'worca-polish-profile-'));
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
  let msgId = 0; const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id == null) return;
    const p = pending.get(m.id); pending.delete(m.id);
    if (p) (m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result));
  };
  const cdp = (method, params = {}, ms = 15000) => {
    const id = ++msgId;
    return new Promise((res, rej) => {
      const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT ${method}`)); }, ms);
      pending.set(id, { res: (v) => { clearTimeout(to); res(v); }, rej: (er) => { clearTimeout(to); rej(er); } });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  const ev = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`EVAL: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };
  await cdp('Page.enable'); await cdp('Runtime.enable');

  // A screen whose `ready` never shows is a failed measurement, not a row of zeros.
  const waitFor = async (sel, screen, ms = 15000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await ev(`!!document.querySelector(${JSON.stringify(sel)})`)) return;
      await sleep(200);
    }
    const at = await ev(`location.hash + ' · ' + ([...document.querySelectorAll('[data-view]:not(.hidden)')].map((v) => v.dataset.view).join(',') || 'no view')
      + ' · ' + (document.querySelector('[data-view]:not(.hidden)')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 300)`);
    throw new Error(`${screen}: ${sel} never appeared (${at})`);
  };
  const BUTTONS = `(${auditButtons})(document.body, ${JSON.stringify(BUTTON_SPEC)}, null)`;
  const SURFACE = `(${auditSurface})(document.body, ${JSON.stringify(SURFACE_SPEC)}, null)`;
  const results = [];
  try {
    for (const width of MATRIX.widths) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      for (const s of SCREENS) {
        const rows = new Map(MATRIX.themes.map((theme) => [theme, { screen: s.key, theme, width, violations: 0, buttons: [], surface: [], heights: {} }]));
        for (const pass of [s, ...(s.also ? [s.also] : [])]) {
          await cdp('Page.navigate', { url: `${base}/?w=${width}${hashOf(pass)}` });
          await sleep(1500);   // boot, the hello and the first paints
          if (pass.prep === 'open-plan') {
            await waitFor('#chat-home-tab-plans:not([hidden])', s.key);
            await ev(`document.querySelector('#chat-home-tab-plans').click();0`);
            await waitFor('details.chat-home-plan-feature', s.key);
            await ev(`document.querySelector('details.chat-home-plan-feature > summary').click();0`);
          }
          await waitFor(pass.ready, s.key);
          for (const theme of MATRIX.themes) {
            await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)};0`);
            await sleep(100);
            const row = rows.get(theme);
            row.buttons.push(...await ev(BUTTONS));
            row.surface.push(...await ev(SURFACE));
            for (const [k, v] of Object.entries(await ev(`(${measure})()`))) {
              row.heights[k] = Array.isArray(v) ? [...new Set([...(row.heights[k] || []), ...v])] : row.heights[k] ?? v;
            }
          }
        }
        for (const row of rows.values()) {
          row.violations = row.buttons.length + row.surface.length;
          results.push(row);
          log(`${s.key} ${row.theme} ${width}: ${row.buttons.length} button, ${row.surface.length} surface`);
        }
      }
    }
  } catch (e) { console.error(e.message); await shutdown(1); }
  const out = arg('--out');
  if (out) await writeFile(out, JSON.stringify(results, null, 2));
  const beforePath = arg('--before');
  const before = beforePath ? JSON.parse(await readFile(beforePath, 'utf8')) : results;
  const md = table(before, results);
  const mdPath = arg('--md');
  if (mdPath) await writeFile(mdPath, `${md}\n`);
  console.log(md);
  await shutdown(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
