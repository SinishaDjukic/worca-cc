// test/helpers/source-branch-current.mjs
// Server suites that start a branchless chat card on a git repo keep today's path under the "Chat runs: source branch"
// default (ask): the sandbox settings.json says `current`. settings.json resolves through HOME / USERPROFILE (never
// WORCA_HOME), so the user layer needs a HOME of its own.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Write `{ chat: { sourceBranch: 'current' } }` into `<home>/.worca-cc/settings.json`. */
export function seedCurrentSourceBranch(home) {
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify({ chat: { sourceBranch: 'current' } }));
}

/** Point HOME / USERPROFILE at a fresh dir seeded as above (at module-eval time, before the server is imported), and
 *  restore both on the caller's `after` hook. */
export function useCurrentSourceBranch(after) {
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  const home = mkdtempSync(join(tmpdir(), 'worca-cc-srcbranch-current-'));
  seedCurrentSourceBranch(home);
  process.env.HOME = home; process.env.USERPROFILE = home;
  after(() => {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  return home;
}
