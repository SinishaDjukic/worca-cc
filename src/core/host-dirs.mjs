// The folders this process runs from. A checkout, worktree or run root holding one
// of them is never removed: the server would delete its own code (agents/,
// ui/public/) and keep running without it.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

const canon = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

/** This process's code root and cwd. */
export const hostDirsOfThisProcess = () => [fileURLToPath(new URL('../../', import.meta.url)), process.cwd()];

/** The first of `dirs` that contains (or is) one of `hostDirs`, else null. */
export function dirHostingServer(dirs, hostDirs = hostDirsOfThisProcess()) {
  const hosts = hostDirs.filter(Boolean).map(canon);
  for (const d of dirs) {
    if (!d) continue;
    const p = canon(d);
    if (hosts.some((h) => h === p || h.startsWith(p + sep))) return d;
  }
  return null;
}

export const hostsServerMessage = (dir) =>
  `Can't remove ${dir}: the running Worca server is started from it. Restart Worca from another folder, then try again.`;
