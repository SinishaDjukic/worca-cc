// src/core/json-atomic.mjs
// Atomic JSON write shared by plugin config (plugin-config.mjs), the MCP registry store
// (mcp/store.mjs) and the saved proxy login (proxy-credentials.mjs): temp file + chmod + rename,
// so a reader never sees a half-written file.

import { writeFileSync, renameSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * `prepareTmp(tmp)` runs on the EMPTY tmp file (already at `mode`), before the content is written:
 * the proxy login's Windows ACL goes on there, so the hash never sits under an inherited ACL. The
 * write that follows keeps the mode and the DACL. `beforeRename(tmp)` runs after the write, right
 * before the rename (a last check; throw to abort). Any throw removes the tmp file.
 */
export function writeJsonAtomic(file, obj, { mode, prepareTmp, beforeRename } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  const text = JSON.stringify(obj, null, 2) + '\n';
  try {
    if (prepareTmp) {
      writeFileSync(tmp, '', mode !== undefined ? { mode, flag: 'wx' } : { flag: 'wx' });
      if (mode !== undefined) chmodSync(tmp, mode); // umask-proof: mode is exact
      prepareTmp(tmp);
      writeFileSync(tmp, text, { encoding: 'utf8', flag: 'r+' }); // r+ keeps the inode, mode and ACL
    } else {
      writeFileSync(tmp, text, mode !== undefined ? { mode } : { encoding: 'utf8' });
      if (mode !== undefined) chmodSync(tmp, mode); // umask-proof: mode is exact
    }
    if (beforeRename) beforeRename(tmp);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
