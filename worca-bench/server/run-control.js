// server/run-control.js
//
// Stop active runs for a profile, and clear a profile's recorded results.
// Stopping kills the process TREE rooted at the profile's runner CLI (so the
// run_pipeline subprocess + agent/git children go too) — POSIX-native via
// pgrep; a no-op fallback on platforms without pgrep.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * Stop active runs for a profile: SIGTERM then SIGKILL the runner CLI tree(s).
 * @returns {Promise<number>} number of runner roots stopped
 */
export async function stopProfileRuns(name) {
  assertValidProfileName(name);
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
