// GitHub credentials: which one worca holds, and the env for ONE git or gh call.
//
//   GH_TOKEN / GITHUB_TOKEN   single mode (today): one token for everything
//   WORCA_GH_READ_TOKEN       split mode: clone and fetch
//   WORCA_GH_WRITE_TOKEN      split mode: push and pull requests
//
// Two rules (plans: "Worca hosting: projects, GitHub identity, Ask Worca"):
//  - no agent ever gets a credential: stripGithubCredentials() runs on every
//    claude and script spawn, in every guardrail tier and every mode;
//  - worca's own git and gh calls get the credential for their role in THAT
//    call's env only (credentialEnv), through a credential helper that reads a
//    variable only worca sets. No global `gh auth setup-git` is needed.
// Pure: reads only the env it is given.

/** Every variable that carries a GitHub credential. Never reaches an agent. */
export const GITHUB_CREDENTIAL_KEYS = Object.freeze([
  'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN',
  'WORCA_GH_READ_TOKEN', 'WORCA_GH_WRITE_TOKEN', 'WORCA_GIT_TOKEN',
]);

const val = (v) => (typeof v === 'string' ? v.trim() : '');

/** A copy of `env` without any GitHub credential. */
export function stripGithubCredentials(env) {
  const out = { ...env };
  for (const k of GITHUB_CREDENTIAL_KEYS) delete out[k];
  return out;
}

/** { mode: 'none'|'single'|'split', read, write }: tokens by role (null when none).
 *  Split mode falls back to the single token for a role it leaves unset. */
export function readGithubCredentials(env = process.env) {
  const single = val(env.GH_TOKEN) || val(env.GITHUB_TOKEN) || null;
  const r = val(env.WORCA_GH_READ_TOKEN) || null;
  const w = val(env.WORCA_GH_WRITE_TOKEN) || null;
  const mode = r || w ? 'split' : single ? 'single' : 'none';
  return { mode, read: r || single, write: w || single };
}

// The helper git runs for github.com: it answers `get` with the token worca put in
// WORCA_GIT_TOKEN for this one call, and nothing for store/erase.
export const GIT_CREDENTIAL_HELPER =
  '!f() { test "$1" = get || exit 0; echo username=x-access-token; echo "password=$WORCA_GIT_TOKEN"; }; f';
const HELPER_KEY = 'credential.https://github.com.helper';

/**
 * The env for one git or gh call that needs `role` ('read' | 'write'). Every
 * credential is removed from `base`; the role's token (if any) is added back as
 * GH_TOKEN for gh and, for git, as a github.com credential helper configured via
 * GIT_CONFIG_* (appended after any the caller already set). The first helper
 * entry is empty, which clears helpers from the user's and system config for
 * github.com, so the token worca chose is the one used. With no token: the
 * credential-free env, and git falls back to the user's own config, as before.
 */
export function credentialEnv(role, base = process.env) {
  const creds = readGithubCredentials(base);
  const token = role === 'write' ? creds.write : creds.read;
  const env = stripGithubCredentials(base);
  if (!token) return env;
  const n = Number.parseInt(env.GIT_CONFIG_COUNT, 10);
  const i = Number.isInteger(n) && n > 0 ? n : 0;
  env[`GIT_CONFIG_KEY_${i}`] = HELPER_KEY;
  env[`GIT_CONFIG_VALUE_${i}`] = '';
  env[`GIT_CONFIG_KEY_${i + 1}`] = HELPER_KEY;
  env[`GIT_CONFIG_VALUE_${i + 1}`] = GIT_CREDENTIAL_HELPER;
  env.GIT_CONFIG_COUNT = String(i + 2);
  env.WORCA_GIT_TOKEN = token;
  env.GH_TOKEN = token;
  return env;
}
