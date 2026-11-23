// test/helpers/temp-home.mjs
// Shared test isolation for the durable store. worcaHome() resolves to
// <WORCA_HOME or os.homedir()>/.worca-cc (src/core/projects.mjs), and the
// store key for a temp repo is <basename>-<sha1(path)[:8]> (src/core/store.mjs).
// Tests that run a pipeline therefore write meta/plans/reviews under the REAL
// ~/.worca-cc/store unless WORCA_HOME is overridden — orphaning a dir per run.
//
// useTempHome() points WORCA_HOME at a throwaway dir and registers cleanup on
// the caller's `after` hook, so the store lands in temp and is reaped with the
// rest of the test's scratch. Synchronous (mkdtempSync) so the env var is set
// at module-eval time, before any test body runs.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../../src/core/db.mjs';

let quarantine = null;
/** Where late writes land once a file's home is gone: one folder per test process, removed when the process exits,
 *  so it never grows across runs. */
function quarantineHome() {
  if (!quarantine) {
    quarantine = mkdtempSync(join(tmpdir(), 'worca-cc-test-quarantine-'));
    const dir = quarantine;
    process.once('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
  }
  return quarantine;
}

/**
 * Isolate WORCA_HOME for the current test file.
 *
 * The db.mjs singleton opened against an earlier home stays cached when this
 * file flips WORCA_HOME (multiple suites can share one process, e.g. plain
 * `node file.mjs` or --test with isolation disabled). So we reset the
 * singleton on both edges: after setting the env var (so the next getDb()
 * reopens against THIS home, before the first service call) and again in
 * teardown (so whatever runs next starts clean). This folds the
 * Phase-6 §0 "DB-touching test must reset the singleton" rule into the helper,
 * giving every useTempHome() caller DB isolation for free.
 *
 * Importing db.mjs here is safe: it is synchronous, Node-builtin-only, and does
 * NOT open the DB on import (only on first getDb()).
 *
 * @param {(fn: () => void) => void} after  the node:test `after` hook
 * @param {string} [prefix]                 mkdtemp prefix (for debuggability)
 * @returns {string} the isolated home dir
 */
export function useTempHome(after, prefix = 'worca-cc-home-') {
  const home = mkdtempSync(join(tmpdir(), prefix));
  process.env.WORCA_HOME = home;
  _resetForTests(); // db reopens at this home on the next getDb()
  after(() => {
    // NEVER re-expose the real ~/.worca-cc. node:test runs after-hooks FIFO, so
    // this cleanup can fire BEFORE a suite's own after() that stops background
    // orch.run() work — and a late status write re-resolves worcaHome() at
    // write time. So park the env on a quarantine path under tmpdir instead of
    // restoring the previous value: late writes land in throwaway /tmp junk.
    // Never restore `prev` — a direct `node --test file.mjs` inherits the
    // shell's WORCA_HOME, which may be a live store (an agent run under
    // `WORCA_HOME=… worca ui` left its mock runs in that store's database).
    process.env.WORCA_HOME = quarantineHome();
    _resetForTests(); // next getDb() reopens against the restored home
    // Throwaway tmp: on Windows a lingering handle (Defender, a just-closed
    // sqlite file) EPERMs the delete — retry, and never fail the file over it.
    try { rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* best effort */ }
  });
  return home;
}
