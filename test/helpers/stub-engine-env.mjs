// test/helpers/stub-engine-env.mjs — a side-effect module: import it FIRST in a test file that starts
// real (non-mock) runs. It points HOME/USERPROFILE at a scratch dir and WORCA_CLAUDE_BIN/ORCH_CLAUDE_BIN
// at a stub engine (leaves a marker line, exits 0) before any module that reads them at import
// (src/core/engines/claude.mjs DEFAULT_BIN) is loaded.
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const stubHome = mkdtempSync(join(tmpdir(), 'worca-cc-stub-home-'));
export const STUB_MARKER = join(stubHome, 'engine-spawned.log');
export const STUB_BIN = join(stubHome, 'stub-claude.sh');
writeFileSync(STUB_BIN, `#!/bin/sh\necho "spawned $$" >> '${STUB_MARKER}'\nexit 0\n`);
chmodSync(STUB_BIN, 0o755);

const KEYS = ['HOME', 'USERPROFILE', 'WORCA_CLAUDE_BIN', 'ORCH_CLAUDE_BIN'];
const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
process.env.HOME = stubHome; process.env.USERPROFILE = stubHome;
process.env.WORCA_CLAUDE_BIN = STUB_BIN; process.env.ORCH_CLAUDE_BIN = STUB_BIN;

export function restoreStubEnv() {
  for (const k of KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  try { rmSync(stubHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* best effort */ }
}
