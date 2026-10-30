// test/helpers/credential-env.mjs
// Model credentials in the developer's shell (CODEX_API_KEY, OPENAI_API_KEY, …) would change which sign-in mode the
// route resolver picks for a test that runs an adapter or the resolver with process.env (tools/test.mjs gives each file
// a temp HOME, but does not scrub them). clearCredentialEnv(t) deletes every catalog credential name for the test and
// puts each one back in t.after.
import { ENGINE_NAMES } from '../../src/shared/engine-switch.mjs';
import { credentialNamesOf } from '../../src/core/exec-env/credentials.mjs';

/** Every credential name the catalog declares (credentials.mjs credentialNamesOf, over every engine). */
export const CATALOG_CREDENTIAL_NAMES = Object.freeze([...new Set(ENGINE_NAMES.flatMap(credentialNamesOf))]);

/** Delete every catalog credential name from process.env until the test `t` ends (restored in t.after). */
export function clearCredentialEnv(t, extra = []) {
  const saved = {};
  for (const k of [...CATALOG_CREDENTIAL_NAMES, ...extra]) {
    if (Object.hasOwn(process.env, k)) saved[k] = process.env[k];
    delete process.env[k];
  }
  t.after(() => {
    for (const k of [...CATALOG_CREDENTIAL_NAMES, ...extra]) {
      if (Object.hasOwn(saved, k)) process.env[k] = saved[k]; else delete process.env[k];
    }
  });
}
