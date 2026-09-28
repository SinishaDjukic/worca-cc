// GitHub credentials: which one worca holds, and the env for ONE git or gh call.
//
//   GH_TOKEN / GITHUB_TOKEN   single mode (today): one token for everything
//   WORCA_GH_READ_TOKEN       split mode: clone and fetch
//   WORCA_GH_WRITE_TOKEN      split mode: push and pull requests
//   WORCA_GH_APP_*            App mode (github-app.mjs): a token minted per call
//
// Two rules (plans: "Worca hosting: projects, GitHub identity, Ask Worca"):
//  - no agent ever gets a credential: stripGithubCredentials() runs on every
//    claude and script spawn, in every guardrail tier and every mode;
//  - worca's own git and gh calls get the credential for their role in THAT
//    call's env only (credentialEnv), through a credential helper that reads a
//    variable only worca sets. No global `gh auth setup-git` is needed.
// credentialEnv is pure (token modes); githubEnv also mints in App mode.
import { appConfigured, loadAppConfig, mintInstallationToken } from './github-app.mjs';
import { currentBillTo } from './billing.mjs';
import { personGithubToken } from './broker-client.mjs';

/** Every variable that carries a GitHub credential. Never reaches an agent. */
export const GITHUB_CREDENTIAL_KEYS = Object.freeze([
  'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN',
  'WORCA_GH_READ_TOKEN', 'WORCA_GH_WRITE_TOKEN', 'WORCA_GIT_TOKEN',
  'WORCA_GH_APP_ID', 'WORCA_GH_APP_KEY_FILE', 'WORCA_GH_APP_KEY_B64', 'WORCA_GH_APP_INSTALLATION_ID',
]);

const val = (v) => (typeof v === 'string' ? v.trim() : '');

/** A copy of `env` without any GitHub credential. */
export function stripGithubCredentials(env) {
  const out = { ...env };
  for (const k of GITHUB_CREDENTIAL_KEYS) delete out[k];
  return out;
}

/** { mode: 'none'|'single'|'split'|'app', read, write }: tokens by role (null when none, and
 *  always in App mode, where githubEnv mints one per call). Split mode falls back to the
 *  single token for a role it leaves unset. App mode wins over both. */
export function readGithubCredentials(env = process.env) {
  if (appConfigured(env)) return { mode: 'app', read: null, write: null };
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
  return withToken(base, role === 'write' ? creds.write : creds.read);
}

/**
 * credentialEnv for any mode: in App mode a fresh installation token for `role` is minted
 * for this one call (`repo` "owner/name" helps find the installation). Never throws:
 * `{ env, error }`, where a failed mint leaves a credential-free env and says why.
 */
export async function githubEnv(role, { base = process.env, repo = null, fetchImpl = fetch, now = Date.now(), asPerson = true, person = undefined } = {}) {
  // "Push as me" (optional, docs/credential-broker.md): a write (push, pull request) goes out
  // with the acting person's own GitHub token, from the credential broker, for this call only.
  //   WORCA_GH_AS_PERSON=prefer    their token when they connected GitHub, else the App/token below
  //   WORCA_GH_AS_PERSON=required  their token or nothing: the push fails and says how to connect
  if (role === 'write' && asPerson) {
    const p = await personWriteEnv(base, person === undefined ? currentBillTo() : person);
    if (p) return p;
  }
  if (readGithubCredentials(base).mode !== 'app') return { env: credentialEnv(role, base), error: null };
  try {
    const { token } = await mintInstallationToken(loadAppConfig(base), { role, repo, fetchImpl, now });
    return { env: withToken(base, token), error: null };
  } catch (e) {
    return { env: stripGithubCredentials(base), error: e.message };
  }
}

/** WORCA_GH_AS_PERSON: 'prefer' | 'required' | null (off). Needs the credential broker. */
export function asPersonMode(env = process.env) {
  const v = String(env.WORCA_GH_AS_PERSON || '').trim().toLowerCase();
  if (!(typeof env.WORCA_BROKER_URL === 'string' && env.WORCA_BROKER_URL.trim())) return null;
  return v === 'prefer' || v === 'required' ? v : null;
}

/**
 * The write env with `person`'s own token, `{env, error}` when "push as me" decides the
 * call (their token, or — in required mode — a refusal), or null to fall through to
 * worca's own credential (off, or prefer mode without a connected GitHub).
 */
async function personWriteEnv(base, person) {
  const mode = asPersonMode(base);
  if (!mode) return null;
  const who = typeof person === 'string' && person.includes('@') ? person : null;
  if (!who) {
    return mode === 'required'
      ? { env: stripGithubCredentials(base), error: 'pushes go out as the person who acted (WORCA_GH_AS_PERSON=required), and nobody signed in is behind this one' }
      : null;
  }
  try {
    const { token } = await personGithubToken(who);
    return { env: withToken(base, token), error: null, as: who };
  } catch (err) {
    if (mode === 'required') {
      return { env: stripGithubCredentials(base), error: `pushing as ${who}: ${err.message.replace(/^credential broker: /, '')}` };
    }
    if (err.code !== 'not_connected') console.warn(`[worca] push as ${who}: ${err.message}; using worca's own GitHub credential`);
    return null;
  }
}

function withToken(base, token) {
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
