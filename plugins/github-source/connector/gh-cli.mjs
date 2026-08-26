// plugins/github-source/connector/gh-cli.mjs
// The one subprocess seam in this connector: `gh auth token`, so a user who has
// already run `gh auth login` needs no PAT in the plugin config. The connector
// child runs with a scrubbed env (PATH + HOME only), which is exactly what gh
// needs — PATH finds the binary, HOME finds ~/.config/gh and the OS keyring.
//
// The runner is injected so the mapping logic is testable without spawning gh;
// the suite never shells out.

import { execFileSync } from 'node:child_process';

/** Default runner. Short timeout: this sits in front of a 30s op budget. */
const spawnGh = () =>
  execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * The gh CLI's token for its logged-in account.
 * @param {() => string} [run] injected runner (tests pass a fake)
 * @returns {string} the trimmed token
 * @throws {Error & {kind: 'auth'}} gh missing, not logged in, or silent — all of
 *   which are the same thing to the user: no usable credential. `auth` is also
 *   the kind validateConfig turns into a `token` field error.
 */
export function ghAuthToken(run = spawnGh) {
  let detail;
  try {
    const out = String(run() || '').trim();
    if (out) return out;
    detail = 'gh auth token printed nothing';
  } catch (e) {
    detail = String(e?.stderr || '').trim() || e?.message || String(e);
  }
  throw Object.assign(
    new Error(`no GitHub token configured and the gh CLI could not supply one: ${detail}`),
    { kind: 'auth' },
  );
}
