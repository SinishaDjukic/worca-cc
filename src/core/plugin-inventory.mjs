// src/core/plugin-inventory.mjs
// Consent inventory for a NOT-YET-INSTALLED plugin (spec §4.8): git-archive the
// pinned SHA from the bare cache into a throwaway temp dir, buildInstallInventory
// it, delete it. Nothing lands under ~/.worca-cc/plugins and no plugin code runs.
// Shared by the marketplace snapshot sync (marketplaces.mjs) and the web server.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoCacheDir } from './plugin-repo.mjs';
import { buildInstallInventory } from './plugin-store.mjs';
import { findEscapingSymlinks } from './plugin-manifest.mjs';

const execFileP = promisify(execFile);
const defaultExec = (cmd, args, opts = {}) =>
  execFileP(cmd, args, {
    maxBuffer: 16 * 1024 * 1024, timeout: 120_000, killSignal: 'SIGKILL',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, ...opts,
  });

export async function inventoryFromCache(repoUrl, sha, subdir, { exec = defaultExec } = {}) {
  const tmp = await mkdtemp(join(tmpdir(), 'worca-cc-consent-'));
  try {
    const tar = join(tmp, 'x.tar');
    // `--` before the subdir positional so a dir like `-x`/`--output=…` can never
    // be parsed as a git option (defense layer 2; the parser rejects it too).
    await exec('git', ['--git-dir', repoCacheDir(repoUrl), 'archive', '--format=tar', '-o', tar,
      ...(subdir ? [sha, '--', subdir] : [sha])]);
    // Extract with cwd = tmp (the destination) so tar never receives a native
    // Windows path: Git-for-Windows GNU tar reads a colon in `-f` as a `host:path`
    // remote spec ("cannot connect to C:") and cannot parse backslash separators.
    // A relative `-f` and no `-C` sidesteps both; the archive lands in cwd.
    await exec('tar', ['-xf', 'x.tar',
      ...(subdir ? ['--strip-components', String(subdir.split('/').length)] : [])], { cwd: tmp });
    await rm(tar, { force: true });
    // Defense-in-depth for the consent display: strip any symlink that escapes the
    // export root before inventorying (the tmp dir is deleted in finally regardless).
    for (const rel of findEscapingSymlinks(tmp)) rmSync(join(tmp, rel), { force: true });
    const inv = buildInstallInventory(tmp);
    // buildInstallInventory bakes the throwaway export dir into setup commands
    // (e.g. `npm ci --prefix <tmp>`); this inventory is PERSISTED in
    // marketplaces.json and shown in the consent modal long after `tmp` is gone,
    // so replace the tmp path with a stable placeholder.
    if (Array.isArray(inv.setupCommands)) {
      inv.setupCommands = inv.setupCommands.map((c) => String(c).split(tmp).join('<plugin-dir>'));
    }
    return inv;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
