// tools/test-run.mjs — child of tools/test.mjs (which sets the hermetic env). Runs the
// file list through node:test's run(): same per-file process isolation as `node --test`,
// no command-line length limit. Optionally records per-file seconds: the file's whole run (spawn to
// exit), which the sum of its tests misses (imports, module-level setup, a process that lingers).
// Warns about each file's tail: the time its process stayed up outside its tests, mostly a timer or
// child still holding it open after the last test, which costs a CI slot for nothing.
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { relative, resolve } from 'node:path';

const { files, concurrency, timingsOut } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const perFile = {}; // sum of top-level tests: the fallback when a file reports no file-level event
const wall = {};
const rootRun = {}; // the file's own test run (its summary): first test registered to exit, so the tail is in it
const TAIL_WARN_S = 2;
// Fail closed: only the run's final summary (the one without a `file`) turns this green.
// It decides exactly like `node --test` (a failing `todo` test emits test:fail yet stays
// green), and a run that dies before its summary stays red.
process.exitCode = 1;
const stream = run({
  files: files.map((f) => resolve(f)),
  concurrency: concurrency || Math.max(1, availableParallelism() - 1),
  timeout: 300_000,
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
// With process isolation each file completes as a test named after its path, timed spawn to exit.
stream.on('test:complete', (ev) => {
  if (ev.nesting === 0 && ev.file && isFileLevel(ev)) wall[rel(ev.file)] = (ev.details?.duration_ms || 0) / 1000;
});
stream.on('test:summary', (ev) => {
  if (ev.file === undefined) process.exitCode = ev.success ? 0 : 1;
  else rootRun[rel(ev.file)] = (ev.duration_ms || 0) / 1000;
});
stream.compose(spec).pipe(process.stdout);
stream.on('close', () => {
  // A file's events reach this process only once the files ahead of it are reported, so their arrival
  // times say nothing; the durations do. Tail = the file's own run minus its top-level tests: work
  // after the last test (an armed timer, a live child), plus any top-level before/after hooks.
  const tails = Object.entries(rootRun).map(([f, s]) => [f, s - (perFile[f] || 0)]).filter(([, t]) => t > TAIL_WARN_S);
  for (const [f, t] of tails.sort((a, b) => b[1] - a[1])) {
    console.error(`warning: ${f} stayed up ${t.toFixed(1)} s outside its tests (a timer or child still holding the process? unref or clear it)`);
  }
  if (timingsOut) writeFileSync(timingsOut, JSON.stringify(Object.fromEntries(Object.entries({ ...perFile, ...wall }).map(([k, v]) => [k, Math.round(v * 100) / 100]))));
});
