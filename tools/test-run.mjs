// tools/test-run.mjs — child of tools/test.mjs (which sets the hermetic env). Runs the
// file list through node:test's run(): same per-file process isolation as `node --test`,
// no command-line length limit. Optionally records per-file seconds: the file's whole run (spawn to
// exit), which the sum of its tests misses (imports, module-level setup, a process that lingers).
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { relative, resolve } from 'node:path';

const { files, concurrency, timingsOut } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const perFile = {}; // sum of top-level tests: the fallback when a file reports no file-level event
const wall = {};
// Fail closed: only the run's final summary (the one without a `file`) turns this green.
// It decides exactly like `node --test` (a failing `todo` test emits test:fail yet stays
// green), and a run that dies before its summary stays red.
process.exitCode = 1;
const stream = run({
  files: files.map((f) => resolve(f)),
  concurrency: concurrency || Math.max(1, availableParallelism() - 1),
  timeout: 300_000,
});
const rel = (file) => relative(process.cwd(), file).replace(/\\/g, '/');
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
stream.on('test:summary', (ev) => { if (ev.file === undefined) process.exitCode = ev.success ? 0 : 1; });
stream.compose(spec).pipe(process.stdout);
stream.on('close', () => {
  if (timingsOut) writeFileSync(timingsOut, JSON.stringify(Object.fromEntries(Object.entries({ ...perFile, ...wall }).map(([k, v]) => [k, Math.round(v * 100) / 100]))));
});
