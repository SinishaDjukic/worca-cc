// test/helpers/vault-on.mjs — the secretVault flag on over the file-backed OS-store fake, for store tests that run in
// process: `vaultOn(fn)` runs fn with WORCA_FLAGS=secretVault and WORCA_TEST_OS_STORE set (restored after), and
// `vaultOf(home)` opens the vault of a Worca home over the same fake, to count or read its entries.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createVault } from '../../src/core/secrets/vault.mjs';
import { osItemName } from '../../src/core/secrets/os-store.mjs';
import { worcaHome } from '../../src/core/projects.mjs';
import { fileFakeOsStore, writeFakeState } from './os-store-fake.mjs';

/** The helpers over a fake state file under `dir` (a temp directory the caller removes). */
export function fakeVault(dir) {
  const state = join(dir, 'fake-os-store', 'state.json');
  async function vaultOn(fn) {
    if (!existsSync(state)) writeFakeState(state, { state: 'available' });
    const keep = { WORCA_FLAGS: process.env.WORCA_FLAGS, WORCA_TEST_OS_STORE: process.env.WORCA_TEST_OS_STORE };
    Object.assign(process.env, { WORCA_FLAGS: 'secretVault', WORCA_TEST_OS_STORE: state });
    try { return await fn(); } finally {
      for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  }
  const vaultOf = (home = worcaHome()) => createVault({ home, store: fileFakeOsStore(state, { item: osItemName(home) }) });
  return { state, vaultOn, vaultOf };
}
