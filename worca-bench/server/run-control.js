// server/run-control.js
//
// Stop active runs for a profile, and clear a profile's recorded results.
// Stopping kills the process TREE rooted at the profile's runner CLI (so the
// run_pipeline subprocess + agent/git children go too) — POSIX-native via
// pgrep; a no-op fallback on platforms without pgrep.
//
// The pipeline spawns each agent in its OWN session/process-group
// (start_new_session=True), so the agent's ppid no longer chains back to the
// pipeline once that session is created — `pgrep -P` can't reach it, and an
// agent left running after the pipeline dies is reparented to init (a leak).
// worca records every spawned agent's pgid under <run_dir>/procs/<pgid>.json
// for exactly this reason; we read those and SIGTERM→SIGKILL the whole group so
// no agent (or its MCP/pytest children) survives a Stop.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';

// Profile names flow into a pgrep regex and into filesystem paths, so they must
// be strictly validated to prevent arbitrary process kills / path traversal.
const NAME_RE = /^[A-Za-z0-9_.-]+$/;
export function assertValidProfileName(name) {
  if (
    typeof name !== 'string' ||
    name === '.' ||
    name === '..' ||
    !NAME_RE.test(name)
  ) {
    throw new Error('invalid profile name');
  }
  return name;
}

function pgrep(args) {
  try {
    const r = spawnSync('pgrep', args, { encoding: 'utf8' });
    if (r.status !== 0 || !r.stdout) return [];
    return r.stdout
      .trim()
      .split('\n')
      .map((s) => Number.parseInt(s, 10))
      .filter(Number.isInteger);
  } catch {
    return [];
  }
}

function collectTree(pid, acc) {
  acc.add(pid);
  for (const child of pgrep(['-P', String(pid)])) {
    if (!acc.has(child)) collectTree(child, acc);
  }
}

const _delay = (ms) => new Promise((r) => setTimeout(r, ms));

function _safeNames(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Collect worca's tracked agent process groups for a profile by reading every
 * <dir>/work/<name>/<instance>/rep<N>/.worca/runs/<run_id>/procs/<pgid>.json.
 * Returns a deduped list of { pgid, pid } leaders.
 */
function collectTrackedGroups(dirs, name) {
  const groups = new Map(); // pgid -> { pgid, pid }
  for (const dir of dirs || []) {
    const workProfile = join(dir, 'work', name);
    if (!existsSync(workProfile)) continue;
    for (const inst of _safeNames(workProfile)) {
      const instDir = join(workProfile, inst);
      for (const rep of _safeNames(instDir)) {
        const runsDir = join(instDir, rep, '.worca', 'runs');
        for (const runId of _safeNames(runsDir)) {
          const procsDir = join(runsDir, runId, 'procs');
          for (const f of _safeNames(procsDir)) {
            if (!f.endsWith('.json')) continue;
            try {
              const e = JSON.parse(readFileSync(join(procsDir, f), 'utf8'));
              const pgid = Number(e?.pgid);
              if (Number.isInteger(pgid) && pgid > 1) {
                groups.set(pgid, { pgid, pid: Number(e?.pid) || pgid });
              }
            } catch {
              /* skip unreadable/partial entry */
            }
          }
        }
      }
    }
  }
  return [...groups.values()];
}

/**
 * SIGTERM→SIGKILL worca's tracked agent process GROUPS for a profile (the
 * session-detached agents `pgrep -P` can't reach). Guarded by a liveness check
 * on the recorded leader pid (cheap PID-reuse guard). POSIX-only — the negative
 * pid group-signal throws on Windows and is swallowed (degrades to no-op, like
 * the rest of the control plane). Returns the number of live groups reaped.
 * @returns {Promise<number>}
 */
export async function killTrackedGroups(dirs, name) {
  assertValidProfileName(name);
  const live = collectTrackedGroups(dirs, name).filter((g) => {
    try {
      process.kill(g.pid, 0); // leader alive? (throws if gone → stale entry)
      return true;
    } catch {
      return false;
    }
  });
  for (const g of live) {
    try {
      process.kill(-g.pgid, 'SIGTERM'); // negative pid = whole process group
    } catch {
      /* group gone / not ours / Windows */
    }
  }
  if (live.length) await _delay(1500);
  for (const g of live) {
    try {
      process.kill(-g.pgid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
  return live.length;
}

/**
 * Stop a single action by the pid of its runner CLI: SIGTERM then SIGKILL the
 * whole process tree (so run_pipeline / regrade children go too). Used by the
 * Activity dock's per-row Stop. Returns true if a live root was found.
 * @param {number} pid
 * @returns {Promise<boolean>}
 */
export async function stopPidTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // alive? (throws if gone)
  } catch {
    return false;
  }
  const acc = new Set();
  collectTree(pid, acc);
  const pids = [...acc];
  for (const p of pids) {
    try {
      process.kill(p, 'SIGTERM');
    } catch {
      /* gone / not ours */
    }
  }
  await _delay(1500);
  for (const p of pids) {
    try {
      process.kill(p, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
  return true;
}

/**
 * Stop active runs for a profile: SIGTERM then SIGKILL the runner CLI tree(s)
 * AND worca's session-detached agent process groups (so no agent leaks as an
 * orphan when the pipeline dies). `dirs` are the result dirs to scan for the
 * per-run procs/ registry; omit to skip the group reap (tree-only).
 * @returns {Promise<number>} number of runner roots stopped
 */
export async function stopProfileRuns(name, dirs = []) {
  assertValidProfileName(name);
  // Reap the tracked agent groups first — while the pipeline is still alive its
  // procs/ entries are intact; doing it before the tree kill avoids any window
  // where the pipeline tears the registry down.
  await killTrackedGroups(dirs, name);
  // Escape regex metachars (only `.` is possible in our charset) and anchor the
  // match so a name can't broaden the pattern or prefix-match another run.
  const safe = name.replace(/[.]/g, '\\.');
  const roots = pgrep(['-f', `worca_bench\\.cli run --profile ${safe}( |$)`]);
  if (roots.length === 0) return 0;
  const acc = new Set();
  for (const r of roots) collectTree(r, acc);
  const pids = [...acc];
  for (const p of pids) {
    try {
      process.kill(p, 'SIGTERM');
    } catch {
      /* already gone / not ours */
    }
  }
  await _delay(1500);
  for (const p of pids) {
    try {
      process.kill(p, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
  return roots.length;
}

/**
 * Stop an in-flight regrade sweep for a profile: SIGTERM→SIGKILL the regrade CLI
 * tree (so its swebench/modal child goes too). The runner pid is read from the
 * profile's regrade heartbeat.
 * @returns {Promise<number>} number of regrade processes stopped
 */
export async function stopRegrade(name, dirs) {
  assertValidProfileName(name);
  const roots = new Set();
  for (const dir of dirs) {
    const f = join(dir, 'runs', name, 'regrade-status.json');
    if (!existsSync(f)) continue;
    try {
      const s = JSON.parse(readFileSync(f, 'utf8'));
      if (Number.isInteger(s.pid) && s.status === 'running') roots.add(s.pid);
    } catch {
      /* ignore unreadable heartbeat */
    }
  }
  if (roots.size === 0) return 0;
  const acc = new Set();
  for (const r of roots) collectTree(r, acc);
  const pids = [...acc];
  for (const p of pids) {
    try {
      process.kill(p, 'SIGTERM');
    } catch {
      /* already gone / not ours */
    }
  }
  await _delay(1500);
  for (const p of pids) {
    try {
      process.kill(p, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
  return roots.size;
}

/**
 * Clear a profile's recorded results across the given dirs: drop its rows from
 * each results.jsonl and remove its runs/<name> + work/<name> trees.
 * @returns {number} rows removed
 */
export function clearProfileResults(name, dirs) {
  assertValidProfileName(name);
  let removed = 0;
  for (const dir of dirs) {
    const file = join(dir, 'results.jsonl');
    if (existsSync(file)) {
      const kept = [];
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          if ((JSON.parse(t).profile || '') === name) {
            removed++;
            continue;
          }
        } catch {
          /* keep malformed lines verbatim */
        }
        kept.push(t);
      }
      writeFileSync(file, kept.length ? `${kept.join('\n')}\n` : '');
    }
    for (const sub of ['runs', 'work']) {
      const base = resolve(join(dir, sub));
      const p = resolve(join(base, name));
      // Defense in depth: never delete outside <dir>/<sub>/.
      if (p.startsWith(base + sep) && existsSync(p)) {
        rmSync(p, { recursive: true, force: true });
      }
    }
  }
  return removed;
}
