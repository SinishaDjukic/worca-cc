// test/stillhet-click-check.test.mjs — the pure parts of plans/rail/prototype/gates/click-check.mjs: its units, their merge and
// report, the settle step, and its worker processes on the shared pool (tools/stillhet-compare.mjs runPool).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';

const CSS = new URL('../ui/public/stillhet/app.css', import.meta.url);
const cssBefore = existsSync(CSS) ? statSync(CSS).mtimeMs : null;
const cc = await import('../plans/rail/prototype/gates/click-check.mjs');
const { runPool, finishRun } = await import('../tools/stillhet-compare.mjs');
const { listUnits, unitWhere, mergeUnits, formatReport, settledSignature, childWorkers, SETTLE, CLICK_TIMEOUT_MS } = cc;

test('importing the module builds nothing and launches no browser (playwright is loaded only inside main)', () => {
  assert.equal(existsSync(CSS) ? statSync(CSS).mtimeMs : null, cssBefore);
  const src = readFileSync(new URL('../plans/rail/prototype/gates/click-check.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import [^;]*from 'playwright'/m);
  assert.equal(CLICK_TIMEOUT_MS, 900000);
  assert.deepEqual(SETTLE, { frames: 2, pollMs: 25, maxMs: 250 });
});

const cases = Array.from({ length: 12 }, (_, i) => `c${i}`);
const probe = [
  { width: 1280, page: 'index.html', routes: ['runs', 'chat', 'settings/a', 'settings/b', 'settings/c', 'settings/d', 'settings/e'], places: ['tasks', 'tasks/t1'] },
  { width: 1280, page: 'pulse.html', cases },
  { width: 375, page: 'index.html', routes: ['runs', 'chat'], places: ['tasks'] },
  { width: 375, page: 'pulse.html', cases: ['x', 'y'] },
];

test('listUnits: width × route on index (routes, then places) and width × page × case elsewhere, in canonical order', () => {
  const units = listUnits(probe);
  assert.deepEqual(units.slice(0, 10).map((u) => u.route), ['runs', 'chat', 'settings/a', 'settings/b', 'settings/c', 'settings/d', 'settings/e', 'tasks', 'tasks/t1', undefined]);
  assert.deepEqual(units[9], { width: 1280, page: 'pulse.html', case: 'c0', other: 'c1' });
  assert.deepEqual(units[20], { width: 1280, page: 'pulse.html', case: 'c11', other: 'c0' });
  assert.deepEqual(units.slice(21).map((u) => `${u.width} ${u.page} ${u.route ?? u.case}`), ['375 index.html runs', '375 index.html chat', '375 index.html tasks', '375 pulse.html x', '375 pulse.html y']);
  assert.equal(units.length, 26);
});

test('listUnits: --small keeps every fifth case and route and every place, with `other` from the full case list', () => {
  const units = listUnits(probe.slice(0, 2), { small: true });
  assert.deepEqual(units.map((u) => u.route ?? u.case), ['runs', 'settings/d', 'tasks', 'tasks/t1', 'c0', 'c5', 'c10']);
  assert.equal(units.find((u) => u.case === 'c5').other, 'c6');
  assert.equal(units.find((u) => u.case === 'c10').other, 'c11');
});

test('listUnits: a page in the fallback is one unit per width, holding its cases or routes', () => {
  const units = listUnits(probe, { fallback: ['pulse.html'] });
  const pulse = units.filter((u) => u.page === 'pulse.html');
  assert.deepEqual(pulse, [{ width: 1280, page: 'pulse.html', cases, all: cases }, { width: 375, page: 'pulse.html', cases: ['x', 'y'], all: ['x', 'y'] }]);
  const idx = listUnits(probe, { fallback: ['index.html'] }).filter((u) => u.page === 'index.html');
  assert.deepEqual(idx.map((u) => u.routes.length), [9, 3]);
});

test('unitWhere: the location text the report has always used', () => {
  assert.equal(unitWhere({ width: 1280, page: 'run-page.html', case: 'ready', other: 'x' }, 'logs'), 'run-page.html 1280 ready/logs');
  assert.equal(unitWhere({ width: 1280, page: 'run-page.html', case: 'ready', other: 'x' }, ''), 'run-page.html 1280 ready');
  assert.equal(unitWhere({ width: 375, page: 'index.html', route: 'settings/runs' }), 'index.html 375 #settings/runs');
  assert.equal(unitWhere({ width: 375, page: 'pulse.html', cases: ['x'], all: ['x'] }), 'pulse.html 375');
});

// six units: one kind with 35 locations spread across them (one repeated), clicks 1..6
const sixUnits = Array.from({ length: 6 }, (_, i) => ({ width: 1280, page: 'index.html', route: `r${i}` }));
const sixResults = sixUnits.map((u, i) => ({
  clicks: i + 1, writes: 0,
  issues: [
    ...Array.from({ length: 6 }, (_, j) => ['a dead control', `index.html 1280 #${u.route}: c${j}`]),
    ...(i === 5 ? [['a dead control', 'index.html 1280 #r0: c0'], ['a disabled control that does not say why', 'index.html 1280 #r5: Off']] : []),
    ...(i === 2 ? [['script error', 'index.html 1280: boom']] : []),
  ],
}));

test('mergeUnits + formatReport: any completion order through runPool gives the single-worker report', async () => {
  // 6 units × 6 locations = 36; one dropped from unit 4 leaves 35, and unit 5 repeats unit 0's first one
  const results = sixResults.map((r, i) => (i === 4 ? { ...r, issues: r.issues.slice(1) } : r));
  const runWith = async (workers, delays) => {
    const { results: got, unfinished } = await runPool({ units: sixUnits, workers, start: async () => ({}), stop: async () => {}, run: async (_w, _u, i) => { await new Promise((r) => setTimeout(r, delays[i])); return results[i]; } });
    assert.deepEqual(unfinished, []);
    return finishRun(formatReport(mergeUnits(got)), unfinished, unitWhere);
  };
  const single = await runWith(1, [0, 0, 0, 0, 0, 0]);
  let s = 11;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let k = 0; k < 20; k++) {
    const split = await runWith(4, sixUnits.map(() => Math.floor(rnd() * 15)));
    assert.equal(split.lines.join('\n'), single.lines.join('\n'), `order ${k}`);
    assert.equal(split.code, single.code);
  }
  const text = single.lines.join('\n');
  assert.ok(text.startsWith('21 clicks · \na dead control (35)\n'));
  assert.equal(text.split('\n').filter((l) => l.startsWith('   index.html 1280 #r')).length, 31);   // 30 of the dead ones, and the one disabled
  assert.match(text, /\nscript error \(1\)\n {3}index\.html 1280: boom/);
  assert.equal(single.code, 1);
});

test('formatReport: code 0 and "every control acts" with no issues, code 1 otherwise', () => {
  assert.deepEqual(formatReport({ clicks: 7, issues: new Map() }), { lines: ['7 clicks · every control acts'], code: 0 });
  const r = formatReport(mergeUnits([{ clicks: 2, issues: [['a dead control', 'x']] }, undefined]));
  assert.deepEqual(r, { lines: ['2 clicks · ', 'a dead control (1)', '   x'], code: 1 });
});

test('settledSignature: the first changed signature counts; an unchanged one is read again until 250 ms have passed', async () => {
  const fake = (sigs) => { let i = 0, frames = 0, waits = 0; return { page: { evaluate: async (x) => { if (typeof x === 'function') { frames++; return undefined; } return sigs[Math.min(i++, sigs.length - 1)]; }, waitForTimeout: async (ms) => { waits++; await new Promise((r) => setTimeout(r, ms)); } }, reads: () => i, frames: () => frames, waits: () => waits }; };
  const slow = fake(['a', 'a', 'a', 'b']);
  assert.equal(await settledSignature(slow.page, 'a'), 'b');
  assert.equal(slow.reads(), 4);
  assert.equal(slow.frames(), 1);
  const dead = fake(['a']);
  const t = Date.now();
  assert.equal(await settledSignature(dead.page, 'a'), 'a');
  assert.ok(Date.now() - t >= SETTLE.maxMs, `${Date.now() - t} ms`);
  assert.ok(dead.reads() >= 5);
});

const unit = { width: 1280, page: 'index.html', route: 'settings/runs' };

test('a worker child that exits mid-unit fails the run, naming that unit and its stderr tail', async () => {
  const script = "process.on('message', () => { process.stderr.write('first\\nboom from the worker\\n'); process.exit(5); });";
  const { results, unfinished } = await runPool({ units: [unit], workers: 1, timeoutMs: 10000, ...childWorkers({ args: ['-e', script], target: '' }) });
  const out = finishRun(formatReport(mergeUnits(results)), unfinished, unitWhere);
  assert.equal(out.code, 1);
  const text = out.lines.join('\n');
  assert.match(text, /worker 1 stopped \(the worker exited \(code 5\) mid-unit\); unfinished: index\.html 1280 #settings\/runs/);
  assert.match(text, / {5}boom from the worker/);
});

test('a hung worker child times out, fails the run naming its unit, and is no longer running', async () => {
  const script = "process.on('message', () => {});";
  const procs = childWorkers({ args: ['-e', script], target: '' });
  const kids = [];
  const start = async (i) => { const w = await procs.start(i); kids.push(w.child); return w; };
  const { results, unfinished } = await runPool({ units: [unit], workers: 1, timeoutMs: 100, ...procs, start });
  const out = finishRun(formatReport(mergeUnits(results)), unfinished, unitWhere);
  assert.equal(out.code, 1);
  assert.match(out.lines.join('\n'), /worker 1 stopped \(timed out after 0\.1 s\); unfinished: index\.html 1280 #settings\/runs/);
  assert.ok(kids[0].exitCode !== null || kids[0].signalCode !== null);
});

test('main: an invalid --workers, or --units-json without a file name, returns 2 with no build and no browser', async () => {
  let built = 0, launched = 0;
  const was = console.error; console.error = () => {};
  let code;
  try {
    for (const argv of [['--workers', 'x'], ['--units-json'], ['--units-json', '--small']]) {
      code = await cc.main(argv, { build: () => { built++; }, preflight: async () => { launched++; } });
      assert.equal(code, 2, argv.join(' '));
    }
  } finally { console.error = was; }
  assert.equal(built + launched, 0);
});
