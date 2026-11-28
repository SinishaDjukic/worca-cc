// tools/test-handles.mjs — names the handles a test file's process still held when forceExit closed it.
// tools/test-run.mjs loads this module into each test file's own process (`run({ execArgv: ['--import', URL] })`),
// with the handles folder in the URL's query, never in the environment. There it takes a baseline of the
// process's active resources (the stdio pipes) and, at exit, writes what was added since to a sidecar file the
// runner reads once that file completes. A sidecar, not stderr: the reporter prints a child's stderr verbatim,
// and pipe writes at exit are asynchronous on macOS. Imported without the query (a unit test), it installs nothing.
// Nothing here may change a run's result: every error is swallowed.
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainThread } from 'node:worker_threads';

export function preloadUrl(dir) {
  return `${new URL(import.meta.url).href.split('?')[0]}?dir=${encodeURIComponent(dir)}`;
}

// The parent names a file by its event path, the child by process.argv[1]; the realpath makes both agree.
export function sidecarName(file) {
  let p = file;
  try { p = realpathSync(file); } catch { /* the path itself */ }
  return createHash('sha1').update(p).digest('hex') + '.json';
}

export function diffHandles(baseline, atExit) {
  const left = new Map();
  for (const t of baseline) left.set(t, (left.get(t) || 0) + 1);
  const added = [];
  for (const t of atExit) {
    const n = left.get(t) || 0;
    if (n > 0) left.set(t, n - 1);
    else added.push(t);
  }
  return added.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function formatHandles(types) {
  const counts = new Map();
  for (const t of [...types].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts].map(([t, n]) => (n > 1 ? `${t} x${n}` : t)).join(', ');
}

export function handleWarning(rel, types) {
  return `warning: ${rel} held the process open after its tests: ${formatHandles(types)} (force-closed; unref or clear it)`;
}

export function readHandles(dir, file) {
  try {
    const p = join(dir, sidecarName(file));
    const text = readFileSync(p, 'utf8');
    rmSync(p, { force: true });
    const { handles } = JSON.parse(text);
    return Array.isArray(handles) && handles.every((h) => typeof h === 'string' && /^[A-Za-z0-9_]+$/.test(h)) ? handles : null;
  } catch {
    return null;
  }
}

const dir = new URL(import.meta.url).searchParams.get('dir');
// Only the test file's own process: a Worker or a fork() child would write a sidecar of its own (under the test
// file's name, for a Worker). Both inherit process.execArgv by default, so the preload takes itself out of it.
if (dir && isMainThread) {
  try {
    const i = process.execArgv.findIndex((a) => a.includes('test-handles.mjs?dir='));
    if (i > 0 && process.execArgv[i - 1] === '--import') process.execArgv.splice(i - 1, 2);
    // Touch stdio first so its pipes are in the baseline, not reported as held.
    void process.stdout; void process.stderr;
    const baseline = process.getActiveResourcesInfo();
    process.on('exit', () => {
      try {
        const file = process.argv[1];
        const handles = diffHandles(baseline, process.getActiveResourcesInfo());
        if (file && handles.length) writeFileSync(join(dir, sidecarName(file)), JSON.stringify({ file, handles }));
      } catch { /* a diagnostic never changes the result */ }
    });
  } catch { /* a diagnostic never changes the result */ }
}
