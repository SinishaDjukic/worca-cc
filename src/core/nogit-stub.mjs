// src/core/nogit-stub.mjs — SEAMS S6: on macOS without git, every claude / agent / script / terminal spawn finds
// worca's own `git` stub (exit 127, "git is not installed on this machine") ahead of the /usr/bin/git CLT shim,
// which opens the install dialog when it runs. Linux and Windows answer ENOENT with no dialog: no stub there.
import { mkdirSync, readFileSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { worcaHome } from './projects.mjs';
import { gitAvailable, currentGitState, GIT_MISSING } from './git-available.mjs';

export const NOGIT_STUB = `#!/bin/sh\necho "${GIT_MISSING.message}" >&2\nexit 127\n`;
let _platform = null;
// Known missing = probed (or WORCA_GIT=0) and unavailable. A process that never probed adds nothing: before the
// probe gitAvailable() is false, and a stub then would hide an installed git from claude and its agents.
const gitKnownMissing = () => !gitAvailable() && currentGitState().reason !== 'not-probed';

export function noGitBinDir(home = worcaHome()) { return join(home, 'nogit-bin'); }

/** darwin + git missing: <home>/nogit-bin/git (mode 755), rewritten only when its content differs; the dir, else null. */
export function ensureNoGitStub({ home, platform = _platform ?? process.platform, available = !gitKnownMissing() } = {}) {
  if (platform !== 'darwin' || available) return null;
  const dir = noGitBinDir(home ?? worcaHome());
  const file = join(dir, 'git');
  let same = false;
  // Content AND exec bit: PATH lookup skips a 644 stub (a chmod that failed once after the write) and falls through to
  // the /usr/bin/git shim. A Windows host (tests inject darwin) reports no exec bits.
  try { same = readFileSync(file, 'utf8') === NOGIT_STUB && (process.platform === 'win32' || (statSync(file).mode & 0o111) === 0o111); } catch { /* missing: write it */ }
  if (!same) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, NOGIT_STUB);
      chmodSync(file, 0o755);                     // after every write: the umask must not decide
    } catch { return null; }                      // an unwritable home never breaks the spawn itself
  }
  return dir;
}

/** `env` with the stub dir first on PATH while ensureNoGitStub answers a dir; else `env` itself. Idempotent. */
export function withNoGitPath(env, { home, platform, available } = {}) {
  const dir = ensureNoGitStub({ home, platform, available });
  if (!dir) return env;
  const cur = env.PATH ?? env.Path ?? '';            // findOnPath reads the same keys (a Windows-host test injects darwin)
  if (cur === dir || cur.startsWith(`${dir}:`)) return env;
  return { ...env, PATH: cur ? `${dir}:${cur}` : dir };   // never a trailing ':' (an empty entry = the cwd)
}

export const _testing = {
  setPlatform(p) { _platform = p ?? null; },
};
