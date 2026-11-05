// src/core/dep-seed.mjs
// Seed a fresh run checkout with the project's installed dependencies (performance audit §4.2): a git
// worktree has no untracked node_modules, so the first agent that ran tests used to install them, at
// 10–100 s a time and a full copy of disk per checkout. A copy-on-write clone takes ~3 s and shares disk
// blocks until written: `cp -c` (APFS clonefile) on macOS, `cp --reflink=auto` on Linux (a plain copy
// where the filesystem cannot clone). Agents that run `npm ci` anyway still work: they replace the clone.
//
// Only when it is safe: the project has node_modules, the checkout has none, the checkout ignores
// node_modules (else the clone would reach the commit), and every lockfile matches byte for byte between
// the project and the checkout (else tests would run against other dependencies). Windows is skipped.

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { guardedGitEnvSync } from './git-guard.mjs';

const run = promisify(execFile);
const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb'];
const CLONE_TIMEOUT_MS = 120_000;

const readOrNull = (file) => { try { return readFileSync(file); } catch { return null; } };

/** Why the checkout cannot take the project's node_modules, or null when it can. Pure fs reads, exported for tests. */
export function seedRefusal(projectDir, worktreeDir) {
  if (process.platform === 'win32') return 'not on Windows';
  if (!existsSync(join(projectDir, 'node_modules'))) return 'the project has no node_modules';
  if (existsSync(join(worktreeDir, 'node_modules'))) return 'the checkout already has node_modules';
  if (!existsSync(join(worktreeDir, 'package.json'))) return 'the checkout has no package.json';
  let locks = 0;
  for (const name of LOCKFILES) {
    const a = readOrNull(join(projectDir, name));
    const b = readOrNull(join(worktreeDir, name));
    if (!a && !b) continue;
    if (!a || !b || !a.equals(b)) return `${name} differs from the project's`;
    locks++;
  }
  return locks ? null : 'no lockfile';
}

/**
 * Clone <projectDir>/node_modules into <worktreeDir>. Never throws.
 * @returns {Promise<{ seeded: boolean, ms?: number, reason?: string }>}
 */
export async function seedNodeModules({ projectDir, worktreeDir }) {
  const refusal = seedRefusal(projectDir, worktreeDir);
  if (refusal) return { seeded: false, reason: refusal };
  try {
    await run('git', ['check-ignore', '-q', 'node_modules/'], { cwd: worktreeDir, env: guardedGitEnvSync(worktreeDir), timeout: 10_000 });
  } catch {
    return { seeded: false, reason: 'the checkout does not ignore node_modules' };
  }
  const t0 = Date.now();
  const src = join(projectDir, 'node_modules');
  const dst = join(worktreeDir, 'node_modules');
  const attempt = async (args) => {
    try { await run('cp', args, { timeout: CLONE_TIMEOUT_MS, maxBuffer: 1024 * 1024 }); return null; }
    catch (err) { await rm(dst, { recursive: true, force: true }).catch(() => {}); return err; }   // never leave half a tree
  };
  let err = await attempt(process.platform === 'darwin' ? ['-c', '-R', src, dst] : ['-R', '--reflink=auto', src, dst]);
  // macOS off APFS refuses -c: a plain copy still beats every agent installing.
  if (err && process.platform === 'darwin') err = await attempt(['-R', src, dst]);
  if (err) return { seeded: false, reason: `cp failed: ${String(err?.message || err).slice(0, 200)}` };
  return { seeded: true, ms: Date.now() - t0 };
}
