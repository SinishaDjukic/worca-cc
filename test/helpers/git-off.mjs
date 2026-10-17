// test/helpers/git-off.mjs — "no git on this machine" for a test, without touching PATH (CONTRACT §0, SEAMS S1/S24).
import { _testing } from '../../src/core/git-available.mjs';

/** WORCA_GIT=0 + a stored "missing" state until restore() (registered on t.after when a node:test context is given). */
export function withNoGit(t) {
  const saved = process.env.WORCA_GIT;
  process.env.WORCA_GIT = '0';
  _testing.set({ available: false });
  const restore = () => { if (saved === undefined) delete process.env.WORCA_GIT; else process.env.WORCA_GIT = saved; _testing.reset(); };
  if (t && typeof t.after === 'function') t.after(restore);
  return restore;
}
/** git "installed meanwhile": WORCA_GIT=1 and a stored flip to available, so onGitChange subscribers run. */
export function gitArrives({ version = '2.43.0' } = {}) {
  process.env.WORCA_GIT = '1';
  return _testing.set({ available: true, version, path: '/usr/bin/git', reason: 'ok' });
}
