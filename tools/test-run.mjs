// tools/test-run.mjs — child of tools/test.mjs (which sets the hermetic env). Runs the
// file list through node:test's run(): same per-file process isolation as `node --test`,
// no command-line length limit. Optionally records per-file seconds: the file's whole run (spawn to
// exit), which the sum of its tests misses (imports, module-level setup, a process that lingers).
// forceExit ends each file as soon as its tests are done, and a file that still held its process open then gets a
// warning naming the handles it held (tools/test-handles.mjs, loaded into each test file's process). A run with
// measureTails (tools/test.mjs --measure-tails) keeps forceExit off instead and warns about each file's tail: the time
// its process stayed up outside its tests. That is its top-level hooks plus anything (a timer, a child) still holding
// it open after them; the event stream cannot tell the two apart, and forceExit only cuts the second.
// Optionally records the files that failed (failuresOut), rewritten on each new one so a suite killed at its
// time limit still leaves the files that failed before.
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { handleWarning, preloadUrl, readHandles } from './test-handles.mjs';

const { files, concurrency, timingsOut, failuresOut, measureTails, testNamePatterns } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const forceExit = !measureTails;
// Each test file's process writes the handles it held at exit into this folder.
// Inside the list file's folder (the suite's work folder), so the suite's cleanup removes it even after a kill.
let handlesDir = null;
if (forceExit) { try { handlesDir = mkdtempSync(join(dirname(process.argv[2]), 'handles-')); } catch { /* no handle report */ } }
const perFile = {}; // sum of top-level tests: the fallback when a file reports no file-level event
const wall = {};
const rootRun = {}; // the file's own test run (its summary): first test registered to exit, so the tail is in it
const TAIL_WARN_S = 2;
// Fail closed: only the run's final summary (the one without a `file`) turns this green.
// It decides exactly like `node --test` (a failing `todo` test emits test:fail yet stays
// green), and a run that dies before its summary stays red.
process.exitCode = 1;
// Workers: the list's concurrency (tools/test.mjs parseArgs: --concurrency, else WORCA_TEST_CONCURRENCY, its only
// reader), else all cores but one (also for a direct `node tools/test-run.mjs LIST` with concurrency null).
const stream = run({
  files: files.map((f) => resolve(f)),
  concurrency: concurrency || Math.max(1, availableParallelism() - 1),
  timeout: 300_000,
  // A test that hits its timeout is abandoned, not ended: a live server or child kept its file's process up
  // forever, and the whole suite with it (process audit §8c, 18 h). forceExit ends each file once its tests
  // are done, timing runs included, so a recorded timing is the slot the file really holds. Only a measureTails
  // run keeps it off, so the tail warnings below still see lingering processes.
  forceExit,
  // The preload's folder travels in its URL, never in the env: it reaches the test file's process only.
  ...(handlesDir ? { execArgv: ['--import', preloadUrl(handlesDir)] } : {}),
  // tools/test.mjs --test-name-pattern, read as Node reads its own flag (a RegExp source, or /re/flags).
  ...(testNamePatterns ? { testNamePatterns } : {}),
});
// realpath: on macOS one event names a temp file under /var and another under /private/var (a symlink).
const real = (file) => { try { return realpathSync(file); } catch { return file; } };
const cwd = real(process.cwd());
const relOf = new Map();
const rel = (file) => {
  if (!relOf.has(file)) relOf.set(file, relative(cwd, real(file)).replace(/\\/g, '/'));
  return relOf.get(file);
};
// The file-level test (named after the file itself) is never a top-level test of the file.
const isFileLevel = (ev) => ev.name && resolve(ev.name) === resolve(ev.file);
const note = (ev) => {
  if (ev.nesting !== 0 || !ev.file || isFileLevel(ev)) return;
  const f = rel(ev.file);
  perFile[f] = (perFile[f] || 0) + (ev.details?.duration_ms || 0) / 1000;
};
stream.on('test:pass', note);
stream.on('test:fail', note);
// A top-level failure (a test, or the file itself when it throws at import); a failing `todo` keeps the run green.
const failed = new Set();
stream.on('test:fail', (ev) => {
  if (!failuresOut || ev.nesting !== 0 || !ev.file || ev.todo) return;
  const f = rel(ev.file);
  if (failed.has(f)) return;
  failed.add(f);
  writeFileSync(failuresOut, JSON.stringify([...failed].sort()));
});
// A file's events reach this process only once the files ahead of it are reported, so their arrival
// times say nothing; the durations do. Tail = the file's own run minus its top-level tests: any top-level
// before/after hooks, plus work after them (an armed timer, a live child). Only a measureTails run reports it: under
// forceExit the remainder is hook time alone, which forceExit cannot cut. Printed per file once both its summary and
// its file-level completion are in (they come in either order), so a run cut off at its time limit still logs the
// tails it saw.
const completed = new Set();
const warnTail = (f) => {
  if (!measureTails || !completed.has(f) || !(f in rootRun)) return;
  const t = rootRun[f] - (perFile[f] || 0);
  if (t > TAIL_WARN_S) console.error(`warning: ${f} stayed up ${t.toFixed(1)} s outside its tests (top-level hooks, or a timer or child still holding the process? unref or clear it)`);
};
// With process isolation each file completes as a test named after its path, timed spawn to exit.
stream.on('test:complete', (ev) => {
  if (!(ev.nesting === 0 && ev.file && isFileLevel(ev))) return;
  const f = rel(ev.file);
  wall[f] = (ev.details?.duration_ms || 0) / 1000;
  completed.add(f);
  warnTail(f);
  // The file's process has exited by now, so its handles sidecar (if any) is written.
  if (handlesDir) {
    try {
      const held = readHandles(handlesDir, ev.file);
      if (held && held.length) console.error(handleWarning(f, held));
    } catch { /* a diagnostic never changes the result */ }
  }
});
stream.on('test:summary', (ev) => {
  if (ev.file === undefined) process.exitCode = ev.success ? 0 : 1;
  else {
    const f = rel(ev.file);
    rootRun[f] = (ev.duration_ms || 0) / 1000;
    warnTail(f);
  }
});
stream.compose(spec).pipe(process.stdout);
stream.on('close', () => {
  if (handlesDir) { try { rmSync(handlesDir, { recursive: true, force: true }); } catch { /* left for the suite's temp cleanup */ } }
  if (timingsOut) writeFileSync(timingsOut, JSON.stringify(Object.fromEntries(Object.entries({ ...perFile, ...wall }).map(([k, v]) => [k, Math.round(v * 100) / 100]))));
});
