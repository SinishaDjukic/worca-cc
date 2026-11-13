// test/stillhet-compare.test.mjs — the pure parts of tools/stillhet-compare.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countDiffPixels, PARTS, ROUTES, STATES, PULSE_STATES, CHAT_STATES, PAGES, report, deepRoutes, deepPart, settledShot, launchOptions } from '../tools/stillhet-compare.mjs';

test('countDiffPixels: 0 for equal buffers, 1 for one changed channel, w*h for a size mismatch', () => {
  const a = new Uint8ClampedArray(2 * 2 * 4).fill(7), b = new Uint8ClampedArray(a);
  assert.equal(countDiffPixels(a, b, 2, 2), 0);
  b[5] = 8;
  assert.equal(countDiffPixels(a, b, 2, 2), 1);
  assert.equal(countDiffPixels(a, new Uint8ClampedArray(8), 2, 2), 4);
});

test('PARTS lists the invitation, the design switch, one whole-page cell per shell route and one per non-default state', () => {
  assert.deepEqual(PARTS.map((p) => p.id), ['invitation', 'design-switch', ...ROUTES.map((r) => `route-${r}`), ...STATES.map(([s]) => `state-${s}`), ...PULSE_STATES.map(([s]) => `state-${s}`), ...CHAT_STATES.map(([s]) => `state-${s}`),
    'state-task-loading-run', 'state-task-failed-run', 'state-task-gone-run', 'action-failed-run', 'terminal-chat']);
  assert.deepEqual(PAGES, ['components.html', 'run-page.html', 'pulse.html']);
});

test('STATES: every non-default state is a whole-page cell, opened by the same address in both hosts', () => {
  assert.deepEqual(STATES.map(([s]) => s), ['loading', 'empty', 'offline', 'failed', 'refresh-failed', 'connection-lost', 'session-expired', 'first-run']);
  for (const [s] of STATES) {
    const p = PARTS.find((x) => x.id === `state-${s}`);
    assert.equal(p.route, true);
    assert.equal(p.app.route, p.proto.route);
    assert.match(p.app.route, s === 'first-run' ? /^\?first#/ : new RegExp(`^\\?state=${s}#`));
  }
  // the invitation is drawn by the shared shell from its address, so the app cell uses the prototype's address
  const inv = PARTS.find((x) => x.id === 'invitation');
  assert.equal(inv.app.route, inv.proto.route);
});

test('report: exit 1 on a box-size mismatch or any differing pixel, 0 otherwise', () => {
  const cell = (o) => ({ part: 'invitation', theme: 'dark', width: 1280, appBox: { w: 10, h: 5 }, protoBox: { w: 10, h: 5 }, diff: 0, ...o });
  assert.equal(report([cell({})]).code, 0);
  assert.equal(report([cell({ diff: 1 })]).code, 1);
  const r = report([cell({ protoBox: { w: 11, h: 5 } })]);
  assert.equal(r.code, 1);
  assert.match(r.lines[0], /app 10x5, prototype 11x5/);
});

test('report: a console or page error in a cell fails it even with 0 differing pixels, and the error is listed', () => {
  const r = report([{ part: 'route-chat', theme: 'light', width: 360, appBox: { w: 1, h: 1 }, protoBox: { w: 1, h: 1 }, diff: 0, errors: ['app pageerror: boom'] }]);
  assert.equal(r.code, 1);
  assert.match(r.lines.join('\n'), /app pageerror: boom/);
});

test('deepRoutes: the shell\'s own route list (RailShell.routes) less the top-level places', () => {
  const was = globalThis.window;
  globalThis.window = { RailShell: { routes: () => ['chat', 'chat/c1', 'pulse', 'run/ready', 'settings', 'settings/runs'] } };
  try {
    assert.deepEqual(deepRoutes(), ['chat/c1', 'run/ready', 'settings/runs']);
  } finally { globalThis.window = was; }
  const p = deepPart('workflows/workflow:default');
  assert.equal(p.id, 'route-workflows-workflow-default');
  assert.equal(p.route, true);
  assert.equal(p.app.route, '#workflows/workflow:default');
  assert.equal(p.app.route, p.proto.route);
  assert.equal(deepPart('projects/ws:web-shop').id, 'route-projects-ws-web-shop');
  // one of each kind keeps its pairs beside the other cells for the PR; the rest go to the git-ignored deep/ folder
  assert.equal(p.dir, '');
  assert.equal(deepPart('run/working').dir, 'deep');
});

test('settledShot: shoots until two frames in a row are the same, and gives up after its rounds with the last frame', async () => {
  const fake = (frames) => { let i = 0, evals = 0; return { page: { waitForTimeout: async () => {}, evaluate: async () => { evals++; }, screenshot: async () => Buffer.from(frames[Math.min(i++, frames.length - 1)]) }, shots: () => i, evals: () => evals }; };
  const a = fake(['fading', 'almost', 'still', 'still']);
  assert.equal(String(await settledShot(a.page)), 'still');
  assert.equal(a.shots(), 4);
  assert.equal(a.evals(), 4);   // the script animations are finished before every frame
  const b = fake(['1', '2', '3', '4', '5']);
  assert.equal(String(await settledShot(b.page, { rounds: 3 })), '3');
});

test('launchOptions: the browser rasters on the CPU, whole tiles, so a loaded machine draws the same edges', () => {
  for (const a of ['--disable-gpu', '--disable-partial-raster']) assert.ok(launchOptions().args.includes(a), a);
});

test('the Pulse state parts open the popover on the loading and failed looks, by the same address in both hosts', () => {
  assert.deepEqual(PULSE_STATES.map(([id]) => `state-${id}`), ['state-loading-pulse', 'state-failed-pulse']);
  for (const [id, s] of PULSE_STATES) {
    const p = PARTS.find((x) => x.id === `state-${id}`);
    assert.equal(p.app.route, `?state=${s}#activity`);
    assert.equal(p.app.route, p.proto.route);
  }
});

test('the compare and the gates start the app on demo data (WORCA_STILLHET_DEMO=1)', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['stillhet-compare.mjs', 'stillhet-gates.mjs']) assert.match(readFileSync(new URL(`../tools/${f}`, import.meta.url), 'utf8'), /WORCA_STILLHET_DEMO: '1'/, f);
});

test('the comparison stores rail as a person does; the gates lock it with WORCA_FLAGS', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../tools/stillhet-compare.mjs', import.meta.url), 'utf8');
  assert.match(src, /lockRail \? \{\} : \{ flags: \{ rail: true \} \}/);
  assert.match(src, /WORCA_FLAGS: lockRail \? 'rail' : ''/);
  assert.match(readFileSync(new URL('../tools/stillhet-gates.mjs', import.meta.url), 'utf8'), /\{ lockRail: true \}/);
});

test('CHAT_STATES: each Chat cell id of the plan is a whole-page cell, opened by the same address in both hosts; a missing one fails', () => {
  const ids = ['state-thread-loading-chat', 'state-thread-failed-chat', 'state-thread-gone-chat', 'state-loading-chat', 'state-empty-chat', 'state-failed-chat', 'terminal-chat'];
  for (const id of ids) {
    const p = PARTS.find((x) => x.id === id);
    assert.ok(p, `${id} is a cell`);
    assert.equal(p.route, true);
    assert.equal(p.app.route, p.proto.route);
  }
  for (const [id, q] of CHAT_STATES) assert.match(q, new RegExp(`^\\?state=${id.replace(/-chat$/, '')}#chat`));
  assert.equal(PARTS.find((x) => x.id === 'terminal-chat').seed, '#route-chat [data-terminal]');
});

// ---- the worker pool (parallel walks): parseWorkers, clampWorkers, runPool, finishRun, installStopHandlers, verifyApp, main
const pool = await import('../tools/stillhet-compare.mjs');
const { parseWorkers, clampWorkers, runPool, finishRun, unfinishedLines, installStopHandlers, verifyApp, startApp, UNIT_TIMEOUT_MS } = pool;

test('parseWorkers: CPU count less one, at most 4, at least 1, without the flag; any whole number of 1 or more with it', () => {
  assert.equal(parseWorkers([], 11), 4);
  assert.equal(parseWorkers([], 1), 1);
  assert.equal(parseWorkers([], 2), 1);
  assert.equal(parseWorkers([], 64), 4);
  assert.equal(parseWorkers(['--workers', '8'], 2), 8);
  assert.equal(parseWorkers(['--parts', 'x', '--workers=8'], 2), 8);
  assert.equal(parseWorkers(['--workers', '1']), 1);
});

test('parseWorkers: rejects 0, -2, x, 1.5, a missing value and a following flag, naming the value', () => {
  for (const [argv, v] of [[['--workers', '0'], '0'], [['--workers', '-2'], '-2'], [['--workers', 'x'], 'x'], [['--workers=1.5'], '1.5'], [['--workers'], 'nothing'], [['--workers', '--parts'], '--parts']]) {
    assert.throws(() => parseWorkers(argv, 11), { message: `--workers must be a whole number of 1 or more, got "${v}"` }, argv.join(' '));
  }
});

test('clampWorkers: never more workers than units, never fewer than one', () => {
  assert.equal(clampWorkers(4, 3), 3);
  assert.equal(clampWorkers(4, 0), 1);
  assert.equal(clampWorkers(2, 10), 2);
  assert.equal(UNIT_TIMEOUT_MS, 300000);
});

// a seeded random so the "random order" case is the same every run
const seeded = (s) => () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
const cellUnits = (n) => Array.from({ length: n }, (_, i) => ({ part: `p${i}`, theme: 'light', width: 1280 }));
const fakeCell = (u) => ({ part: u.part, theme: u.theme, width: u.width, appBox: { w: 1, h: 1 }, protoBox: { w: 1, h: 1 }, diff: Number(u.part.slice(1)) % 3 });

test('runPool: results in unit order whatever order workers finish, and the report is the same at 1 and 4 workers', async () => {
  const units = cellUnits(12);
  const rnd = seeded(7);
  const delays = { reverse: (i) => (12 - i) * 3, random: () => Math.floor(rnd() * 20) };
  const texts = [];
  for (const [name, delay] of Object.entries(delays)) {
    for (const workers of [1, 4]) {
      const finished = [];
      const { results, unfinished } = await runPool({ units, workers, start: async (i) => ({ i }), stop: async () => {}, run: async (_w, u, i) => { await new Promise((r) => setTimeout(r, delay(i))); finished.push(i); return fakeCell(u); } });
      assert.deepEqual(unfinished, [], name);
      assert.deepEqual(results.map((c) => c.part), units.map((u) => u.part), `${name} ${workers}`);
      if (workers === 4 && name === 'reverse') assert.notDeepEqual(finished, [...finished].sort((a, b) => a - b));
      texts.push(report(results).lines.join('\n'));
    }
  }
  assert.ok(texts.every((t) => t === texts[0]));
});

test('runPool: a rejecting and a timed-out worker list their in-flight unit as unfinished; the other units still have results', async () => {
  const units = cellUnits(8);
  const { results, unfinished } = await runPool({
    units, workers: 3, timeoutMs: 50, start: async (i) => ({ i }), stop: async () => {},
    run: async (_w, u) => { if (u.part === 'p1') throw new Error('browser went away\nstack line'); if (u.part === 'p2') return new Promise(() => {}); return fakeCell(u); },
  });
  const byUnit = Object.fromEntries(unfinished.map((e) => [e.units.map((x) => x.part).join(','), e.reason]));
  assert.equal(byUnit.p1, 'browser went away');
  assert.equal(byUnit.p2, 'timed out after 0.05 s');
  assert.deepEqual(results.map((r, i) => (r ? i : null)).filter((x) => x !== null), [0, 3, 4, 5, 6, 7]);
});

test('runPool: when every worker crashed, the still-queued units go to the last crashed worker', async () => {
  const { results, unfinished } = await runPool({ units: cellUnits(5), workers: 2, start: async (i) => ({ i }), stop: async () => {}, run: async () => { throw new Error('gone'); } });
  assert.equal(results.filter(Boolean).length, 0);
  assert.deepEqual(unfinished.flatMap((e) => e.units.map((u) => u.part)).sort(), ['p0', 'p1', 'p2', 'p3', 'p4']);
  assert.equal(unfinished.at(-1).units.length, 4);
});

test('runPool: stop is awaited once per started worker, on success and on crash, and workers start one after another', async () => {
  for (const crash of [false, true]) {
    const stops = [], log = [];
    let starting = 0;
    await runPool({
      units: cellUnits(6), workers: 3, timeoutMs: 50,
      start: async (i) => { assert.equal(starting, 0, 'two workers starting at once'); starting++; await new Promise((r) => setTimeout(r, 5)); starting--; log.push(i); return { i }; },
      stop: async (w) => { await new Promise((r) => setTimeout(r, 2)); stops.push(w.i); },
      run: async (w, u) => { if (crash && w.i === 1) throw new Error('x'); return fakeCell(u); },
    });
    assert.deepEqual(log, [0, 1, 2]);
    assert.deepEqual(stops.sort(), [0, 1, 2], `crash ${crash}`);
  }
});

test('finishRun: an unfinished entry gives code 1 and a line naming the worker, the reason and the units; none keeps the report', () => {
  const label = (u) => `${u.part} ${u.theme} ${u.width}`;
  const rep = { lines: ['ok   route-chat light 1280: 0 differing pixels'], code: 0 };
  assert.deepEqual(finishRun(rep, [], label), rep);
  const out = finishRun(rep, [{ worker: 2, reason: 'timed out after 300 s', units: [{ part: 'route-chat', theme: 'dark', width: 1280 }, { part: 'route-runs', theme: 'light', width: 360 }], tail: ['boom'] }], label);
  assert.equal(out.code, 1);
  assert.ok(out.lines.includes('worker 2 stopped (timed out after 300 s); unfinished: route-chat dark 1280, route-runs light 360'));
  assert.ok(out.lines.includes('     boom'));
  assert.equal(out.lines[0], rep.lines[0]);
  assert.deepEqual(unfinishedLines([], label), []);
  assert.deepEqual(unfinishedLines([{ worker: 3, reason: 'no Chrome', units: [], tail: [] }], label), ['worker 3 did not start (no Chrome)']);
});

test('installStopHandlers: two SIGINTs run cleanup once and exit 130; SIGTERM exits 143; uninstall removes both listeners', async () => {
  const { EventEmitter } = await import('node:events');
  for (const [sig, want] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    const proc = new EventEmitter(); const exits = []; proc.exit = (c) => exits.push(c);
    let runs = 0;
    installStopHandlers(async () => { runs++; await new Promise((r) => setTimeout(r, 5)); }, proc);
    proc.emit(sig); proc.emit(sig);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(runs, 1);
    assert.deepEqual(exits, [want]);
  }
  const proc = new EventEmitter(); proc.exit = () => {};
  const off = installStopHandlers(async () => {}, proc);
  assert.equal(proc.listenerCount('SIGINT') + proc.listenerCount('SIGTERM'), 2);
  off();
  assert.equal(proc.listenerCount('SIGINT') + proc.listenerCount('SIGTERM'), 0);
});

test('verifyApp: refuses a non-empty project list before the POST and a foreign one after; accepts the realpath form of proj', async () => {
  const http = await import('node:http');
  const { mkdtemp: mk, realpath, rm: rmr } = await import('node:fs/promises');
  const { tmpdir: td } = await import('node:os');
  const { join: j } = await import('node:path');
  const dir = await mk(j(td(), 'stillhet-verify-'));
  const proj = j(dir, 'proj');
  let projects = [];
  const srv = http.createServer((_q, s) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ projects })); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const child = { exitCode: null, signalCode: null };
  try {
    await verifyApp({ base, proj, child, log: '', phase: 'ready' });
    projects = [{ name: 'other', path: '/elsewhere' }];
    await assert.rejects(verifyApp({ base, proj, child, log: '', phase: 'ready' }), /is not this worker's/);
    await assert.rejects(verifyApp({ base, proj, child, log: '', phase: 'added' }), /is not this worker's/);
    projects = [{ name: 'proj', path: (await realpath(dir)) + '/proj' }];
    await verifyApp({ base, proj, child, log: '', phase: 'added' });
    projects = [];
    await assert.rejects(verifyApp({ base, proj, child, log: 'port 1 is already in use', phase: 'ready' }), /is not this worker's/);
    await assert.rejects(verifyApp({ base, proj, child: { exitCode: 1, signalCode: null }, log: '', phase: 'ready' }), /exited/);
  } finally { srv.close(); await rmr(dir, { recursive: true, force: true }); }
});

test('startApp: a child that exits during readiness fails at once, not after 20 s', async () => {
  const { mkdtemp: mk, rm: rmr } = await import('node:fs/promises');
  const { tmpdir: td } = await import('node:os');
  const { join: j } = await import('node:path');
  const home = await mk(j(td(), 'stillhet-exit-'));
  const t = Date.now();
  try {
    await assert.rejects(startApp(home, {}, { serverArgs: ['-e', 'process.exit(3)'] }), /exited/);
    assert.ok(Date.now() - t < 5000, `${Date.now() - t} ms`);
  } finally { await rmr(home, { recursive: true, force: true }); }
});

test('main: an invalid --workers returns 2 before building, starting an app or a browser', async () => {
  let built = 0, launched = 0;
  const code = await pool.main(['--workers', '0'], { build: async () => { built++; }, preflight: async () => { launched++; } });
  assert.equal(code, 2);
  assert.equal(built + launched, 0);
});

test('main: a cell with no result after the timeout fails the run, names the cell, and every app is stopped', async () => {
  const fakePage = { addInitScript: async () => {}, goto: async () => {}, waitForFunction: async () => {}, evaluate: async () => [] };
  const fakeBrowser = () => ({ newPage: async () => fakePage, close: async () => {} });
  const stopped = [];
  const lines = [];
  const was = console.log;
  console.log = (s) => lines.push(String(s));
  let code;
  try {
    code = await pool.main(['--parts', 'route-chat', '--workers', '2'], {
      build: async () => {},
      preflight: async () => ({ chromium: { launch: async () => fakeBrowser() }, browser: fakeBrowser() }),
      startApp: async (home) => ({ base: 'http://127.0.0.1:1', stop: async () => { stopped.push(home); } }),
      shoot: async (_b, _a, part, theme, width) => (theme === 'light' && width === 360 ? new Promise(() => {}) : { part: part.id, theme, width, appBox: { w: 1, h: 1 }, protoBox: { w: 1, h: 1 }, diff: 0, errors: [] }),
      timeoutMs: 50,
    });
  } finally { console.log = was; }
  assert.equal(code, 1);
  const out = lines.join('\n');
  assert.match(out, /ok {3}route-chat dark 1280/);
  assert.match(out, /worker \d stopped \(timed out after 0\.05 s\); unfinished: route-chat light 360/);
  assert.equal(stopped.length, 2);
});

test('runPool: a signal while a worker is still starting stops that worker once it is up, and no later worker starts', async () => {
  const live = new Set();
  const started = [], stopped = [];
  let release;
  const slow = new Promise((r) => { release = r; });
  const pool = runPool({
    units: cellUnits(4), workers: 3, live,
    start: async (i) => { started.push(i); if (i === 1) await slow; return { i }; },
    stop: async (w) => { stopped.push(w.i); },
    run: async (_w, u) => { await new Promise((r) => setTimeout(r, 5)); return fakeCell(u); },
  });
  await new Promise((r) => setTimeout(r, 1));
  assert.deepEqual(started, [0, 1]);
  const signal = Promise.all([...live].map((halt) => halt()));
  let settled = false;
  signal.then(() => { settled = true; });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(settled, false, 'the signal path must wait for the worker still starting');
  release();
  await signal;
  assert.deepEqual(stopped.sort(), [0, 1], 'the worker that was starting is stopped too');
  await pool;
  assert.deepEqual(started, [0, 1], 'no worker starts after the signal');
  assert.deepEqual(stopped.sort(), [0, 1]);
});

test('runPool: a signal stopping the live workers while a crash stops the same one runs its stop once, and both wait for it', async () => {
  const live = new Set();
  let stops = 0, release;
  const gate = new Promise((r) => { release = r; });
  const pool = runPool({
    units: cellUnits(2), workers: 1, live, start: async () => ({}),
    stop: async () => { stops++; await gate; },
    run: async () => { await new Promise((r) => setTimeout(r, 5)); throw new Error('browser closed'); },
  });
  await new Promise((r) => setTimeout(r, 1));
  const signal = Promise.all([...live].map((halt) => halt()));
  await new Promise((r) => setTimeout(r, 20));   // the crash path reaches the same stop meanwhile
  let settled = false;
  signal.then(() => { settled = true; });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(settled, false, 'the signal path must wait for the stop already running');
  release();
  await signal; await pool;
  assert.equal(stops, 1);
});

test('the pool owns SIGINT and SIGTERM: every browser the compare and click-check launch leaves them to installStopHandlers', async () => {
  // playwright's own handler otherwise closes the browsers and exits 130 before the apps are stopped and the homes removed
  assert.deepEqual(pool.OWN_SIGNALS, { handleSIGINT: false, handleSIGTERM: false });
  const { readFileSync } = await import('node:fs');
  for (const f of ['../tools/stillhet-compare.mjs', '../plans/rail/prototype/gates/click-check.mjs']) {
    const launches = readFileSync(new URL(f, import.meta.url), 'utf8').match(/chromium\.launch\([^\n]*/g);
    // --pages (pagesMain) keeps today's single path and playwright's own handlers: it starts no app and no temp home
    for (const l of launches.filter((x) => x !== 'chromium.launch(launchOptions());')) assert.match(l, /OWN_SIGNALS/, `${f}: ${l}`);
  }
});

test('TASKS_CELL_IDS (Stillhet Tasks): every Tasks cell is a part or a shown deep route, opened by the same address in both hosts; a missing one fails', async () => {
  const { TASKS_CELL_IDS, TASK_STATES, SHOWN, CELLS, tasksCoverage, isTasksCell } = await import('../tools/stillhet-compare.mjs');
  const ids = new Set([...PARTS.map((p) => p.id), ...SHOWN.map((h) => deepPart(h).id)]);
  for (const id of TASKS_CELL_IDS) assert.ok(ids.has(id), id);
  for (const id of ['state-task-loading-run', 'state-task-failed-run', 'state-task-gone-run', 'action-failed-run', 'route-chat-c17', 'route-chat-c18']) assert.ok(TASKS_CELL_IDS.includes(id), id);
  for (const [id] of TASK_STATES) { const p = PARTS.find((x) => x.id === `state-${id}`); assert.equal(p.app.route, p.proto.route); }
  assert.ok(isTasksCell('route-run-capped') && !isTasksCell('route-chat-c1'));
  const all = TASKS_CELL_IDS.flatMap((part) => CELLS.map(([theme, width]) => ({ part, theme, width })));
  assert.deepEqual(tasksCoverage(all), []);
  assert.deepEqual(tasksCoverage(all.filter((c) => !(c.part === 'route-chat-c18' && c.width === 360))), ['route-chat-c18 light 360']);
});
