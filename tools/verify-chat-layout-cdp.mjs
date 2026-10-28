#!/usr/bin/env node
// tools/verify-chat-layout-cdp.mjs — headless-Chrome proof of the Chat layout rules (#959): one column edge for every
// card, no part of a card outside the text column (a graph well is as wide as its card), no horizontal page overflow,
// every graph inside its well, the run card's dot centred on its title line, one centre for the column, the
// composer and Jump to latest, nothing under the composer, and the run proposal's fields (one-line labels, a whole
// placeholder, an ellipsized branch with its tooltip, no pill), and the proposed workflow card's well: a graph that fits
// is drawn whole, one still wider than its well at the 0.3 floor opens at its start edge, and no well is taller than
// its placed graph needs. Mock mode: `worca ui start --mock` as a child on a
// free port, with a scratch HOME and WORCA_HOME, at 1024 and 1440 px, dark theme. NOT part of `npm test`.
// Run: npm run verify:chat-layout [-- --root DIR] [--label before|after] [--report-only]
//   --root DIR    the tree whose CLI is started and whose store seeds the chats (default: this repo)
//   --label NAME  the screenshot prefix (default after); shots go to $CHAT_LAYOUT_SHOTS or <tmp>/worca-chat-layout-shots
//   --report-only print the failed checks but exit 0 (the "before" pass on the checkpoint)
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(arg('--root', fileURLToPath(new URL('..', import.meta.url))));
const LABEL = arg('--label', 'after');
const REPORT_ONLY = process.argv.includes('--report-only');
const WIDTHS = [1024, 1440];
const SHOTS = process.env.CHAT_LAYOUT_SHOTS || path.join(tmpdir(), 'worca-chat-layout-shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
const failures = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`); if (!ok) failures.push(name); };

// Chrome is overridable so this proof also runs on a Linux CI runner (verify-run-monitor-cdp.mjs): CHROME_BIN picks
// the binary, and headless Chrome refuses to start as root without --no-sandbox, which CHROME_NO_SANDBOX=1 forces.
const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }

let cli = null, chrome = null, home = null, proj = null, profile = null;
async function shutdown(code) {
  if (chrome) { try { chrome.kill('SIGKILL'); } catch { /* gone */ } }
  if (cli) { try { cli.kill('SIGTERM'); } catch { /* gone */ } }   // the CLI forwards SIGTERM to its server
  await sleep(300);
  for (const d of [home, proj, profile]) if (d) await rm(d, { recursive: true, force: true }).catch(() => {});
  process.exit(code);
}
process.on('SIGINT', () => shutdown(130));

try {
  // ---- a scratch HOME (settings) + WORCA_HOME (the DB), BEFORE any store import (the house rule)
  home = await mkdtemp(path.join(tmpdir(), 'worca-chatlayout-home-'));
  const WH = path.join(home, '.worca-cc');
  await mkdir(WH, { recursive: true });
  const REAL_ENV = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };   // Chrome keeps the real HOME, as verify-ask-forms does
  Object.assign(process.env, { HOME: home, USERPROFILE: home, WORCA_HOME: WH, WORCA_TEST_ALLOW_HOME_FALLBACK: '1' });
  const port = await freePort();   // never the inherited PORT (the host app's 4317)
  const childEnv = { ...process.env };
  delete childEnv.FORCE_COLOR; delete childEnv.PORT;
  cli = spawn(process.execPath, [path.join(ROOT, 'src/cli/worca-cc.mjs'), 'ui', 'start', '--mock', '--port', String(port)],
    { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let cliLog = '';
  cli.stdout.on('data', (d) => { cliLog += d; }); cli.stderr.on('data', (d) => { cliLog += d; });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 200 && !up; i += 1) { try { up = (await fetch(`${base}/api/projects`)).ok; } catch { /* starting */ } if (!up) await sleep(150); }
  if (!up || /already in use/.test(cliLog)) { console.error(`server did not start on ${port}\n${cliLog}`); await shutdown(1); }
  const api = (p, body) => fetch(`${base}${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin: base }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

  // ---- seed: settings, a git project, a live mock run, two chats
  await api('/api/settings', { uiLevel: 'expert' });
  await api('/api/onboarding', { welcomeSeen: true });
  proj = realpathSync(await mkdtemp(path.join(tmpdir(), 'worca-chatlayout-proj-')));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: proj });
  execFileSync('git', ['-c', 'user.email=proof@worca.local', '-c', 'user.name=proof', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: proj });
  await api('/api/projects', { name: 'proj', path: proj });
  const started = await api('/api/run', { projectDir: proj, prompt: 'Fix the login bug', workflowId: 'wf_default', mock: true });
  const runId = started && started.runId;
  if (!runId) { console.error(`the mock run did not start: ${JSON.stringify(started)}\n${cliLog}`); await shutdown(1); }
  let pipelineId = null;
  for (let i = 0; i < 200 && !pipelineId; i += 1) {
    const r = await api(`/api/runs?projectDir=${encodeURIComponent(proj)}`).catch(() => null);
    const e = r && Array.isArray(r.live) ? r.live.find((x) => x.runId === runId) : null;
    if (e && e.id && e.id !== runId) pipelineId = e.id; else await sleep(150);
  }
  if (!pipelineId) { console.error(`the mock run never got a pipeline id\n${cliLog}`); await shutdown(1); }

  const store = await import(pathToFileURL(path.join(ROOT, 'src/core/ask/store.mjs')).href);
  const { validateProposal } = await import(pathToFileURL(path.join(ROOT, 'src/core/ask/proposal.mjs')).href);
  const { projectKey } = await import(pathToFileURL(path.join(ROOT, 'src/core/store.mjs')).href);
  const key = projectKey(proj);
  const LOREM = 'The login form posts to /api/session and the handler compares the hash. '.repeat(6);
  // Chat A — every message card kind next to text: the live run card, a command card, a files card, an applied change
  // and a stub; enough text rows above them that the transcript scrolls at 1440 × 900 (Jump to latest needs a scroll).
  const a = store.createThread({ title: 'Layout: cards' });
  for (let i = 0; i < 6; i += 1) {
    store.appendMessage(a.id, { role: 'user', text: `Question ${i + 1}: why does the login fail?` });
    store.appendMessage(a.id, { role: 'assistant', status: 'done', text: LOREM });
  }
  store.appendMessage(a.id, { role: 'user', text: 'Fix the login bug and show me the screens.' });
  const rcId = store.newAskId('card');
  store.appendMessage(a.id, { role: 'assistant', status: 'done', text: 'Started a run for it:', blocks: [
    { kind: 'card', id: rcId, state: 'tracked', card: { type: 'progress', pipelineId, runId, projectKey: key, workspaceId: null, title: 'Fix the login bug', label: 'proj', status: 'running' } }] });
  store.linkRun(a.id, { runId, cardId: rcId, pipelineId });
  store.appendMessage(a.id, { role: 'assistant', status: 'done', text: 'Running the tests:', blocks: [
    { kind: 'card', id: store.newAskId('card'), state: 'command', card: { type: 'command', blockId: 't-0000000001:1', sessionId: 't-0000000001', seq: 1, command: 'npm test', folder: 'proj · main', cwd: proj, warning: null } },
    { kind: 'card', id: store.newAskId('card'), state: 'shown', card: { type: 'files', title: 'Screens', caption: 'Screens', items: [{ attId: 'att_00000001', name: 'home.png', kind: 'image', mime: 'image/png', bytes: 2048, width: 640, height: 480 }] } },
    { kind: 'card', id: store.newAskId('card'), state: 'applied', card: { type: 'receipt', kind: 'setting', label: 'Theme', target: { settingId: 'theme', scope: 'user' }, before: 'System (default)', after: 'Dark', raw: { before: null, after: 'dark' }, revertible: true } },
    { kind: 'card', id: store.newAskId('card'), state: 'dismissed', card: { title: 'Add a docs page' } }] });
  // Chat B — the run proposal, with tags and a branch longer than its column.
  const b = store.createThread({ title: 'Layout: proposal' });
  const BRANCH = 'worca/paginate-the-search-endpoint-with-a-cursor-and-keep-all';
  const v = await validateProposal({ projectKey: key, workflowId: 'wf_default', guardrailsId: 'normal', title: 'Paginate the search endpoint',
    brief: 'GET /contacts reads every row; page it with a cursor.', tags: ['client:acme'], featureBranch: BRANCH }, { cardId: 'card_rp000001' });
  if (!v.ok) throw new Error(`proposal: ${v.errors.join('; ')}`);
  // validateProposal may drop fields it does not own; the card is what the panel renders, so pin them on it.
  const rp = { ...v.card, tags: ['client:acme'], featureBranch: BRANCH };
  store.appendMessage(b.id, { role: 'user', text: 'Propose a run to page the contacts search.' });
  store.appendMessage(b.id, { role: 'assistant', status: 'done', text: 'Here is a run for it:', blocks: [{ kind: 'card', id: 'card_rp000001', state: 'proposed', card: rp }] });
  // Chat C — two proposed workflow cards, built the way turn.mjs _onWorkflowResult builds one: a 2-agent shape that fits
  // its well, and a 9-agent one still wider than its well at the 0.3 floor (it pans, and must open at its Task node).
  const { revalidateWorkflowProposal } = await import(pathToFileURL(path.join(ROOT, 'src/core/ask/workflow-deps.mjs')).href);
  const wfCard = async (note, stages) => {
    const r = await revalidateWorkflowProposal({ shape: { name: note, taskKind: 'prompt', reasoning: note, size: 'medium', signals: [], stages }, projectKey: key });
    return { kind: 'card', id: store.newAskId('card'), state: 'proposed', card: { type: 'workflow', mode: 'shape', projectKey: key, projectName: 'proj',
      workspaceId: null, workspaceName: null, note, thenRun: false, shape: r.shape, summary: r.summary, ...r.proposal } };
  };
  const c = store.createThread({ title: 'Layout: workflows' });
  store.appendMessage(c.id, { role: 'user', text: 'Propose a small workflow and a big one.' });
  store.appendMessage(c.id, { role: 'assistant', status: 'done', text: 'Two workflows:', blocks: [
    await wfCard('Small', [{ agent: 'implementer' }, { agent: 'reviewer' }]),
    await wfCard('Big', [{ agent: 'clarify' }, { agent: 'planner' }, { agent: 'planReviewer' }, { agent: 'refiner', selfLoop: true }, { agent: 'decomposer' },
      { agent: 'implementer', fanOut: true }, { agent: 'reviewer' }, { agent: 'manualTestsChecklist' }, { agent: 'manualWebUiTesting' }]),
  ] });

  // ---- chrome + cdp (verify-run-monitor-cdp.mjs). Scrollbars stay drawn: the proof measures classic ones.
  profile = await mkdtemp(path.join(tmpdir(), 'worca-chatlayout-profile-'));
  const CDP_PORT = await freePort();
  chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1440,900', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', '--force-color-profile=srgb',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...REAL_ENV } });
  const chromeErr = [];
  chrome.stderr.on('data', (d) => { chromeErr.push(String(d)); if (chromeErr.length > 40) chromeErr.shift(); });
  let chromeExit = null;
  chrome.on('exit', (code, signal) => { chromeExit = { code, signal }; });
  let wsUrl = null;
  const targetDeadline = Date.now() + 60_000;
  while (!wsUrl && Date.now() < targetDeadline && !chromeExit) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(200);
    } catch { await sleep(250); }
  }
  if (!wsUrl) {
    console.error(chromeExit ? `no devtools target: chrome exited (code ${chromeExit.code}, signal ${chromeExit.signal})` : 'no devtools target after 60s');
    if (chromeErr.length) console.error(chromeErr.join('').trim().split('\n').slice(-15).join('\n'));
    await shutdown(1);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0; const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id != null) { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)); }
  };
  const send = (method, params = {}, ms = 15000) => {
    const id = ++msgId;
    return new Promise((res, rej) => {
      const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT ${method}`)); }, ms);
      pending.set(id, { res: (x) => { clearTimeout(to); res(x); }, rej: (er) => { clearTimeout(to); rej(er); } });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`EVAL: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };
  // Headless Chrome does not tick rAF on its own: arm a marker and force frames.
  const kick = () => send('Page.captureScreenshot', { format: 'jpeg', quality: 1, clip: { x: 0, y: 0, width: 16, height: 16, scale: 1 } }, 15000).catch(() => null);
  const settle = async (tag = '') => {
    await ev('window.__rafHit=0;requestAnimationFrame(()=>{window.__rafHit=1;});0');
    for (let i = 0; i < 10; i += 1) { if (await ev('window.__rafHit')) return; await kick(); }
    throw new Error(`no animation frame after 10 forced frames (${tag})`);
  };
  const until = async (expr, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await ev(expr)) return true; await kick(); await sleep(150); }
    return false;
  };
  await mkdir(SHOTS, { recursive: true });
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, 30000);
    await writeFile(path.join(SHOTS, name), Buffer.from(data, 'base64'));
  };
  await send('Page.enable'); await send('Runtime.enable');

  // The proof forces classic 15 px scrollbars: headless Chrome draws overlay scrollbars, which hide the gutter bug.
  const CLASSIC = `(() => { const s = document.createElement('style'); s.textContent = '.ask-transcript::-webkit-scrollbar{width:15px}.ask-transcript::-webkit-scrollbar-thumb{background:#888}'; document.head.appendChild(s); return 1; })()`;
  const MEASURE = `(() => {
    const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
    const page = document.querySelector('[data-chat-page]');
    const col = R(page.querySelector('.ask-transcript-col'));
    const tr = page.querySelector('.ask-transcript');
    const fade = parseFloat(getComputedStyle(page.querySelector('.chat-convo')).getPropertyValue('--chat-dock-fade')) || 0;
    const jumpEl = page.querySelector('.chat-dock > .ask-jump');
    const out = { col, fade, cards: [], wells: [], spill: [], head: null, overflowX: document.documentElement.scrollWidth - innerWidth, composer: R(page.querySelector('.chat-dock .ask-composer-box')),
      dock: R(page.querySelector('.chat-dock')), last: null, radii: [], rp: null,
      jump: jumpEl && !jumpEl.hidden ? R(jumpEl) : null };
    const CARDS = '.ask-transcript-col > .ask-msg > :is(.ask-card,.ask-card-stub,.ask-ccard)';
    for (const c of page.querySelectorAll(CARDS)) out.cards.push({ cls: c.className, ...R(c) });
    // No part of a card leaves the text column: each descendant's box, cut by the ancestors that clip it (a graph well
    // clips its panned graph, a scroller its wide output), lies within the column.
    for (const c of page.querySelectorAll(CARDS)) {
      for (const e of c.querySelectorAll('*')) {
        const b = e.getBoundingClientRect(); if (!b.width && !b.height) continue;
        let l = b.left, r = b.right;
        for (let p = e.parentElement; p && p !== c.parentElement; p = p.parentElement) {
          if (getComputedStyle(p).overflowX === 'visible') continue;
          const pb = p.getBoundingClientRect(); l = Math.max(l, pb.left); r = Math.min(r, pb.right);
        }
        if (r > l && (l < col.l - 0.5 || r > col.r + 0.5)) out.spill.push(((typeof e.className === 'string' && e.className) || e.tagName) + ' ' + Math.round(l) + '..' + Math.round(r));
      }
    }
    // A proposal well (.ask-wfcard) PANS by design when its graph is still wider than the span left of the nav cluster
    // (proposal-host NAV_INSET 54) at the 0.3 floor: then it opens at its start edge. Its height is the placed graph's
    // (the world's drawn content, nodes, wires and their pills, at its zoom) plus the padding, clamped 220..480; view.bounds
    // also lets a pill hang 12 px below its wire, so the check allows that much.
    for (const w of page.querySelectorAll('.ask-transcript-col .gv-well')) {
      const nodes = [...w.querySelectorAll('.gv-world .node')].filter((n) => n.offsetParent).map(R);
      const world = w.querySelector('.gv-world');
      const z = world ? new DOMMatrix(getComputedStyle(world).transform).a || 1 : 1;
      const drawn = world ? [...world.querySelectorAll('.node, svg path, .wbadge')].map(R).filter((x) => x.w || x.h) : [];
      const l = Math.min(...nodes.map((n) => n.l)), r = Math.max(...nodes.map((n) => n.r));
      const wf = !!w.closest('.ask-wfcard');
      const host = w.closest('.ask-card,.ask-card-stub,.ask-ccard'), hs = getComputedStyle(host), hb = host.getBoundingClientRect();
      const inner = { l: hb.left + parseFloat(hs.borderLeftWidth) + parseFloat(hs.paddingLeft), r: hb.right - parseFloat(hs.borderRightWidth) - parseFloat(hs.paddingRight) };
      out.wells.push({ well: R(w), inner, l, r, n: nodes.length, z, wf, first: nodes.length ? nodes.reduce((a, x) => (x.l < a.l ? x : a)) : null,
        pans: wf && z <= 0.3 + 1e-6 && r - l + 2 * 24 * z > R(w).w - 54 + 1,
        graphH: drawn.length ? Math.max(...drawn.map((x) => x.b)) - Math.min(...drawn.map((x) => x.t)) : 0 });
    }
    const dot = page.querySelector('.chat-rc .ask-rc-head > .status-dot'), ttl = page.querySelector('.chat-rc .ask-rc-head > .ask-rc-title');
    if (dot && ttl) out.head = { dot: R(dot).cy, title: R(ttl).cy, chip: !!page.querySelector('.chat-rc .ask-rc-head > .kind-chip:not([hidden])') };
    const msgs = page.querySelectorAll('.ask-transcript-col > .ask-msg');
    if (msgs.length) out.last = R(msgs[msgs.length - 1]);
    // Corners inside a card: none past the card's own 8px, none a pill (radius ≥ half the short side on a non-square box
    // at least 12px tall: a control or a chip; a thinner box is a bar or a track, such as .run-chain-track at 6px with
    // a 4px token corner, and is not a pill); inside the run proposal none past 6px. Round dots/knobs (square boxes) and
    // the shared .switch track are allowed.
    for (const card of page.querySelectorAll(CARDS)) {
      const cap = card.matches('.ask-rp') ? 6 : 8;
      for (const e of card.querySelectorAll('*')) {
        if (e.closest('.switch')) continue;
        // A graph node is drawn in the zoomed .gv-world: its box is scaled, so its corner is too.
        const world = e.closest('.gv-world'); const z = world ? new DOMMatrix(getComputedStyle(world).transform).a || 1 : 1;
        const cs = getComputedStyle(e); const r = z * Math.max(...['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].map((k) => parseFloat(cs['border' + k + 'Radius']) || 0));
        if (!r) continue;
        const b = R(e); if (!b.w || !b.h) continue;
        const square = Math.abs(b.w - b.h) < 1;
        const pill = !square && Math.min(b.w, b.h) >= 12 && r >= Math.min(b.w, b.h) / 2 - 0.5;
        if (pill || (!square && r > cap + 0.01)) out.radii.push((typeof e.className === 'string' && e.className ? e.className : e.tagName) + ' ' + r + 'px');
      }
    }
    const card = page.querySelector('.ask-card.ask-rp');
    if (card) {
      const tags = card.querySelector('.tag-input-text'), feat = card.querySelector('.ask-card-feature');
      const fit = (inp) => { const cs = getComputedStyle(inp); const c = document.createElement('canvas').getContext('2d'); c.font = cs.font;
        return c.measureText(inp.placeholder).width <= inp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + 0.5; };
      const lines = (l) => { const lh = parseFloat(getComputedStyle(l).lineHeight) || 16; return Math.round(l.getBoundingClientRect().height / lh); };
      out.rp = { placeholder: tags ? fit(tags) : null, featTitle: feat ? feat.title === feat.value : null,
        featEllipsis: feat ? getComputedStyle(feat).textOverflow === 'ellipsis' : null,
        wrapped: [...card.querySelectorAll('.ask-rp-label, .ask-rp-ctl > span:first-child')].filter((l) => l.offsetParent && lines(l) > 1).map((l) => l.textContent),
        sameRow: (() => { const f = card.querySelector('.ask-card-same-source')?.closest('.ask-rp-field'); const g = f?.parentElement; return f && g ? Math.abs(R(f).w - R(g).w) < 1 : null; })() };
    }
    return { ...out, scrollGap: tr.scrollHeight - tr.clientHeight - tr.scrollTop };
  })()`;
  // (Wrapped labels: getClientRects() returns one rect for a wrapped inline-block or block, so the line count is the
  // height over the line height.)

  const near = (x, y, tol) => Math.abs(x - y) <= tol;
  const THREADS = [['cards', a.id, '.chat-rc .chat-rc-well .gv-world .node'], ['proposal', b.id, '.ask-card.ask-rp .ask-card-feature'],
    ['workflows', c.id, '.ask-wfcard .gv-well .gv-world .node']];
  let n = 0;
  for (const w of WIDTHS) {
    for (const [t, id, ready] of THREADS) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
      n += 1;
      await send('Page.navigate', { url: `${base}/?r=${n}#chat/${id}` });
      await until(`document.readyState === 'complete' && !!document.querySelector('[data-chat-page]')`);
      await ev(`document.documentElement.setAttribute('data-theme','dark'); 1`);
      await ev(CLASSIC);
      const shown = await until(`!!document.querySelector(${JSON.stringify(ready)})`);
      check(`${w}px ${t}: the thread renders (${ready})`, shown);
      if (!shown) { await shot(`${LABEL}-${t}-${w}.png`); continue; }
      await settle(`${w} ${t}`); await sleep(400); await settle(`${w} ${t}`);
      const m = await ev(MEASURE);
      check(`${w}px ${t}: every card's left and right edge is the text column's`, m.cards.length > 0 && m.cards.every((c) => near(c.l, m.col.l, 0.5) && near(c.r, m.col.r, 0.5)), JSON.stringify(m.cards.filter((c) => !near(c.l, m.col.l, 0.5) || !near(c.r, m.col.r, 0.5))));
      check(`${w}px ${t}: no part of a card leaves the text column`, m.spill.length === 0, `col ${Math.round(m.col.l)}..${Math.round(m.col.r)}: ` + m.spill.slice(0, 8).join(', '));
      check(`${w}px ${t}: every graph well is as wide as its card's content`, m.wells.every((x) => near(x.well.l, x.inner.l, 0.5) && near(x.well.r, x.inner.r, 0.5)), JSON.stringify(m.wells.map((x) => ({ well: [x.well.l, x.well.r], card: [x.inner.l, x.inner.r] }))));
      check(`${w}px ${t}: the page has no horizontal overflow`, m.overflowX <= 0, `scrollWidth - innerWidth = ${m.overflowX}`);
      const fits = m.wells.filter((x) => !x.pans);
      check(`${w}px ${t}: no graph wider than its well`, fits.every((x) => x.n && x.l >= x.well.l - 1 && x.r <= x.well.r + 1), JSON.stringify(fits));
      if (t === 'workflows') {
        const wf = m.wells.filter((x) => x.wf);
        check(`${w}px ${t}: both workflow cards host a graph, and the 9-agent one pans at the floor`, wf.length === 2 && wf.filter((x) => x.pans).length === 1, JSON.stringify(wf.map((x) => ({ n: x.n, z: x.z, pans: x.pans }))));
        check(`${w}px ${t}: a graph that does not fit opens at 0.3x at its start edge, its first node wholly inside the well`,
          wf.filter((x) => x.pans).every((x) => near(x.z, 0.3, 1e-3) && x.first.l >= x.well.l - 0.5 && x.first.l <= x.well.l + 24), JSON.stringify(wf.filter((x) => x.pans).map((x) => ({ z: x.z, first: x.first.l, well: x.well.l }))));
        check(`${w}px ${t}: no well taller than its placed graph plus padding (within 220..480)`,
          wf.every((x) => x.well.h <= Math.min(480, Math.max(220, Math.ceil(x.graphH + (2 * 24 + 12) * x.z))) + 1), JSON.stringify(wf.map((x) => ({ h: x.well.h, graphH: x.graphH, z: x.z }))));
      }
      check(`${w}px ${t}: every well is centred on the column`, m.wells.every((x) => near(x.well.cx, m.col.cx, 0.5)), JSON.stringify(m.wells.map((x) => x.well.cx)) + ` vs ${m.col.cx}`);
      if (t === 'cards') check(`${w}px ${t}: the run card hosts a graph`, m.wells.length >= 1 && !!m.head);
      if (m.head) check(`${w}px ${t}: the run card dot is centred on its title line (≤1px)`, near(m.head.dot, m.head.title, 1), `${m.head.dot} vs ${m.head.title}`);
      if (m.head) check(`${w}px ${t}: a single run's head has no kind chip`, !m.head.chip);
      check(`${w}px ${t}: the composer and the column share one centre`, near(m.composer.cx, m.col.cx, 0.5), `${m.composer.cx} vs ${m.col.cx}`);
      check(`${w}px ${t}: nothing under the composer at the pinned bottom`, m.scrollGap > 1 || m.last.b <= m.dock.t - m.fade + 1, `${m.last.b} > ${m.dock.t - m.fade}`);
      check(`${w}px ${t}: no pill and no corner past the card's inside a chat card`, m.radii.length === 0, m.radii.join(', '));
      if (m.rp) check(`${w}px ${t}: run proposal — whole tags placeholder, ellipsized branch with its tooltip, one-line labels, the switch on its own row`,
        m.rp.placeholder !== false && m.rp.featTitle && m.rp.featEllipsis && !m.rp.wrapped.length && m.rp.sameRow !== false, JSON.stringify(m.rp));
      await shot(`${LABEL}-${t}-${w}.png`);
      if (t === 'cards') {
        // Scroll up the way a reader does (a wheel over the transcript), so the panel unpins and shows the pill.
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(m.col.cx), y: 300, deltaX: 0, deltaY: -4000 });
        await settle('scrolled'); await sleep(250); await settle('scrolled');
        const s = await ev(MEASURE);
        const j = s.jump;
        check(`${w}px ${t}: Jump to latest sits in the band above the dock, on the column's centre`,
          !!j && j.b <= s.dock.t + 1 && j.t >= s.dock.t - s.fade - 1 && near(j.cx, s.col.cx, 0.5), JSON.stringify({ j, dock: s.dock.t, fade: s.fade, col: s.col.cx }));
        await shot(`${LABEL}-${t}-${w}-scrolled.png`);
        // The run card itself, its graph well in view: the before/after pair for the well's width.
        await ev(`document.querySelector('.chat-rc').scrollIntoView({ block: 'start' }); 1`);
        await settle('card'); await sleep(250);
        await shot(`${LABEL}-${t}-${w}-card.png`);
      }
    }
  }
  console.log(failures.length ? `${failures.length} failed` : 'all ok');
  console.log(`shots: ${SHOTS}`);
  await shutdown(failures.length && !REPORT_ONLY ? 1 : 0);
} catch (e) {
  console.error(e);
  await shutdown(1);
}
