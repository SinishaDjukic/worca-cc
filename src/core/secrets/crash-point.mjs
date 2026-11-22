// src/core/secrets/crash-point.mjs — the one test-only fault hook of the secret migration (migrate.mjs, and vault.mjs's
// save). `crashPoint(name)` SIGKILLs this process only under the node:test runner marker (NODE_TEST_CONTEXT, as the
// WORCA_TEST_OS_STORE switch) AND with WORCA_TEST_SECRETS_CRASH equal to `name@store`, the store the migration set
// through `setCrashStore`. Anywhere else it does nothing. Pure: node:process only.
import process from 'node:process';

export const CRASH_ENV = 'WORCA_TEST_SECRETS_CRASH';

/** The named points, in migration order; `mid-vault-write` fires inside the vault save, before its rename; the last two
 * are export's (store `export`). */
export const CRASH_POINTS = Object.freeze(['after-vault-write', 'after-read-back', 'before-config-rewrite', 'after-swap',
  'between-stores', 'mid-vault-write', 'after-restore', 'after-vault-unlink']);

let current = null;

/** The store the migration is working on now (null between runs). */
export function setCrashStore(store) {
  current = store ?? null;
}

/** SIGKILL this process when the test switch names `name@` the current store; otherwise nothing. */
export function crashPoint(name, env = process.env) {
  if (!env.NODE_TEST_CONTEXT || !current || env[CRASH_ENV] !== `${name}@${current}`) return;
  process.kill(process.pid, 'SIGKILL');
}
