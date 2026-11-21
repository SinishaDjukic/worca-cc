// src/core/agent-tree.mjs
// Is a silent agent still working? The node idle limit (graph/executor.mjs) counts the agent's own output only, so an
// agent waiting on a long background job it started (a full test suite, a build) looked exactly like a hung one and was
// stopped at 20 minutes, then re-run from scratch, again and again. Before stopping, the watchdog now asks whether the
// agent's process tree is burning CPU: a running suite is; a deadlocked one, or an agent waiting on nothing, is not.
//
// superviseSpawn reports each child's pid to the async context that started the spawn (watchSpawns), so the executor
// learns its agent's pid without threading a parameter through every engine adapter. A spawn made elsewhere (a session
// host's shared process, the credential broker) reports nothing, and the idle limit then applies as before.
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile } from 'node:child_process';

const als = new AsyncLocalStorage();

/** Run `fn` with `onPid` called for every harness child superviseSpawn starts inside it. */
export function watchSpawns(onPid, fn) {
  return als.run({ onPid }, fn);
}

/** superviseSpawn's side: report a just-spawned child to the context that started it. Never throws. */
export function noteSpawned(pid) {
  if (typeof pid !== 'number') return;
  try { als.getStore()?.onPid?.(pid); } catch { /* a listener never breaks a spawn */ }
}

/** ps's cumulative CPU time (`[[dd-]hh:]mm:ss[.cc]`, macOS and procps alike) in seconds; NaN when unreadable. */
export function cpuSeconds(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(String(s).trim());
  if (!m) return NaN;
  return Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/** `ps -A -o pid=,ppid=,time=` → [[pid, ppid, cpuSec], …]; [] where ps is missing or fails (Windows). */
function psRows() {
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid=,time='], { encoding: 'utf8', timeout: 10_000, windowsHide: true }, (err, out) => {
      if (err) { resolve([]); return; }
      const rows = [];
      for (const line of String(out).split('\n')) {
        const [p, pp, t] = line.trim().split(/\s+/);
        const row = [Number(p), Number(pp), cpuSeconds(t)];
        if (row.every(Number.isFinite)) rows.push(row);
      }
      resolve(rows);
    });
  });
}

/** Map pid → CPU seconds for every descendant of `root` (not `root` itself: its own output is what the idle timer sees). */
export function descendantCpu(root, rows) {
  const kids = new Map();
  const cpu = new Map();
  for (const [p, pp, t] of rows) { cpu.set(p, t); if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(p); }
  const out = new Map();
  const walk = (p) => { for (const c of kids.get(p) || []) { if (out.has(c)) continue; out.set(c, cpu.get(c)); walk(c); } };
  walk(root);
  return out;
}

/** CPU seconds the tree used between two samples: what each descendant added, a new one counted whole, an exited one not. */
export function cpuDelta(before, after) {
  let d = 0;
  for (const [p, t] of after) d += Math.max(0, t - (before.get(p) ?? 0));
  return d;
}

export const BUSY_PROBE_MS = 60_000;
export const BUSY_MIN_CPU_SEC = 2;

/**
 * True when `root`'s descendants used at least `minCpuSec` CPU seconds over `probeMs`: a background job is working.
 * False on Windows, without a pid, or when ps cannot be read. `signal` aborts the wait (resolves false).
 */
export async function treeBusy(root, { probeMs = BUSY_PROBE_MS, minCpuSec = BUSY_MIN_CPU_SEC, signal, rows = psRows } = {}) {
  if (typeof root !== 'number' || process.platform === 'win32') return false;
  const before = descendantCpu(root, await rows());
  if (!before.size) return false;
  const waited = await new Promise((resolve) => {
    if (signal?.aborted) { resolve(false); return; }
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(true); }, probeMs);
    t.unref();
    const onAbort = () => { clearTimeout(t); resolve(false); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  if (!waited) return false;
  return cpuDelta(before, descendantCpu(root, await rows())) >= minCpuSec;
}
