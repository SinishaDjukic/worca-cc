// test/helpers/folder-flipper.mjs — M3 (hosted isolation): a process the agent left behind swaps a FOLDER above a changed
// file for a link in a loop (atomically: Linux `renameat2(RENAME_EXCHANGE)`). `withFlipper` plays an ideal one: `folder`
// is a link to `target` exactly while an lstat, an open or a readlink of one of `paths` (exact strings) runs, and the real
// folder at every other moment, so every realpath check sees the real folder. Linux checks each open descriptor's real
// path through /proc/self/fd; elsewhere a stand-in resolver answers what /proc would: the realpath of what each open
// resolved, taken as the open returns. With no `paths`, only the stand-in is on. Resolves { result, flips }.
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { realpathSync, renameSync, symlinkSync, rmSync } from 'node:fs';
import { _testing } from '../../src/core/folder-copy.mjs';

const fspCjs = createRequire(import.meta.url)('node:fs/promises');

export async function withFlipper({ folder = null, target = null, paths = [] }, fn) {
  const { lstat: origLstat, open: origOpen, readlink: origReadlink } = fspCjs;
  const hit = new Set(paths.map(String)); const fdReal = new Map(); let depth = 0; let flips = 0;
  const swap = () => { if (depth++ === 0) { renameSync(folder, `${folder}-real`); symlinkSync(target, folder); flips++; } };
  const back = () => { if (--depth === 0) { rmSync(folder); renameSync(`${folder}-real`, folder); } };
  const flipped = async (p, call) => {
    const on = hit.has(String(p));
    if (on) swap();
    try { return await call(); } finally { if (on) back(); }
  };
  fspCjs.lstat = (p, ...rest) => flipped(p, () => origLstat(p, ...rest));
  fspCjs.readlink = (p, ...rest) => flipped(p, () => origReadlink(p, ...rest));
  fspCjs.open = (p, ...rest) => flipped(p, async () => {
    const fh = await origOpen(p, ...rest);
    try { fdReal.set(fh.fd, realpathSync(String(p))); } catch { fdReal.delete(fh.fd); }
    return fh;
  });
  syncBuiltinESMExports();
  const prev = process.platform === 'linux' ? null : _testing.setFdPaths({ resolve: async (fd) => fdReal.get(fd) ?? null });
  try {
    const result = await fn();
    return { result, flips };
  } finally {
    if (prev) _testing.setFdPaths(prev);
    fspCjs.lstat = origLstat; fspCjs.open = origOpen; fspCjs.readlink = origReadlink; syncBuiltinESMExports();
  }
}
