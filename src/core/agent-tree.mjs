// src/core/agent-tree.mjs
// Is a silent agent still working? The node idle limit (graph/executor.mjs) counts the agent's own output only, so an
// agent waiting on a long background job it started (a full test suite, a build) looked exactly like a hung one and was
// stopped at 20 minutes, then re-run from scratch, again and again. Before stopping, the watchdog now asks whether the
// agent's process tree is burning CPU: a running suite is; a deadlocked one, or an agent waiting on nothing, is not.
//
// superviseSpawn reports each child's pid to the async context that started the spawn (watchSpawns), so the executor
// learns its agent's pid without threading a parameter through every engine adapter. A spawn made elsewhere (the
// credential broker) reports nothing, and the idle limit then applies as before.
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { descendantPids } from './terminal/pty.mjs';

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

/** One `ps -o pid=,ppid=,pgid=,time=,comm=` line → [pid, ppid, pgid, cpuSec, comm], or null. `comm` is last: a macOS
 *  path may hold spaces. */
export function psRow(line) {
  const [p, pp, pg, t, ...name] = String(line).trim().split(/\s+/);
  const row = [Number(p), Number(pp), Number(pg), cpuSeconds(t)];
  return row.every(Number.isFinite) ? [...row, name.join(' ')] : null;
}

/** Every process as psRow; [] where ps is missing or fails (Windows). */
function psRows() {
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid=,pgid=,time=,comm='], { encoding: 'utf8', timeout: 10_000, windowsHide: true }, (err, out) => {
      if (err) { resolve([]); return; }
      resolve(String(out).split('\n').map(psRow).filter(Boolean));
    });
  });
}

/**
 * Map pid → CPU seconds for the jobs the agent started below `root`. The agent itself is left out (its own output is
 * what the idle timer sees): `root`, or — under agent isolation, where `root` is `sudo` — the first non-sudo processes
 * below it. Counted: the agent's descendants, and every process still in its process group, which keeps a background
 * job (`cmd &`, `nohup`) its shell left behind when it exited and the job was reparented to init.
 */
export function descendantCpu(root, rows) {
  const byPid = new Map(rows.map((r) => [r[0], r]));
  const isSudo = (p) => basename(String(byPid.get(p)?.[4] || '')) === 'sudo';
  const children = (p) => rows.filter((r) => r[1] === p).map((r) => r[0]);
  const agents = new Set();
  const skip = new Set();
  const findAgents = (p) => {
    if (skip.has(p)) return;
    skip.add(p);
    if (!isSudo(p)) { agents.add(p); return; }
    for (const c of children(p)) findAgents(c);
  };
  if (byPid.has(root)) findAgents(root); else agents.add(root);
  const out = new Map();
  const add = (p) => { if (!skip.has(p) && !agents.has(p) && byPid.has(p)) out.set(p, byPid.get(p)[3]); };
  for (const a of agents) {
    for (const p of descendantPids(a, () => rows)) add(p);
    // Only a group the spawn owns (superviseSpawn starts it detached, as its group's leader; sudo's own or the command's
    // under use_pty): a group shared with the server would count the server and every sibling.
    const group = byPid.get(a)?.[2];
    if (group === a || group === root) for (const r of rows) if (r[2] === group) add(r[0]);
  }
  return out;
}

/** CPU seconds the tree used between two samples: what each descendant added, a new one counted whole, an exited one not. */
export function cpuDelta(before, after) {
  let d = 0;
  for (const [p, t] of after) d += Math.max(0, t - (before.get(p) ?? 0));
  return d;
}

export const BUSY_PROBE_MS = 60_000;
/** The CPU share (of one core) a working tree uses at least: 2 CPU seconds a minute. */
export const BUSY_MIN_CPU_SHARE = 2 / 60;

/**
 * True when `root`'s jobs used at least `minCpuSec` CPU seconds over `probeMs` (by default BUSY_MIN_CPU_SHARE of the
 * window): a background job is working. False on Windows, without a pid, or when ps cannot be read. `signal` aborts the
 * wait (resolves false).
 */
export async function treeBusy(root, { probeMs = BUSY_PROBE_MS, minCpuSec = (probeMs / 1000) * BUSY_MIN_CPU_SHARE, signal, rows = psRows } = {}) {
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
