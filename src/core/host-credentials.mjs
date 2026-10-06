// src/core/host-credentials.mjs
// One host-aware entry point for worca's own git calls against a remote, and one strip for every spawn
// that must never see a code-host credential (agents, scripts, actions).
import { parseRemoteUrl, forgeOf } from './forge.mjs';
import { githubEnv, stripGithubCredentials, readGithubCredentials, asPersonMode } from './github-credentials.mjs';
import { azureEnv, stripAzureCredentials, readAzureCredentials } from './azure-credentials.mjs';

export function stripHostCredentials(env) {
  return stripAzureCredentials(stripGithubCredentials(env));
}

/**
 * True when a remote's host can change which credential a git call gets, so it is worth a
 * `git remote get-url`: GitHub App mode (the mint is per repo), an Azure DevOps credential (only
 * Azure hosts may get it), or — for pushes — WORCA_GH_AS_PERSON (it must apply to github.com only).
 * Otherwise the host-blind GitHub env is exactly right and no subprocess is spent.
 */
export function hostLookupNeeded({ push = false, env = process.env } = {}) {
  return readGithubCredentials(env).mode === 'app'
    || readAzureCredentials(env).mode !== 'none'
    || (push && asPersonMode(env) !== null);
}

/**
 * The env for a git call against `remoteUrl`: GitHub creds for github.com (App mode mints for that repo),
 * the ADO PAT for Azure DevOps, every host credential stripped otherwise. Never throws.
 * `base` is forwarded to the GitHub env only when the caller gave one (keeps injected seams' arguments stable).
 * @returns {Promise<{env: object, error: string|null}>}
 */
export async function gitEnvFor(role, remoteUrl, { base, githubEnvImpl = githubEnv, ...githubOpts } = {}) {
  const env0 = base || process.env;
  const p = parseRemoteUrl(remoteUrl);
  switch (forgeOf(p)) {
    case 'github': {
      const r = await githubEnvImpl(role, { ...githubOpts, ...(base ? { base } : {}), repo: `${p.owner}/${p.repo}` });
      return { ...r, env: stripAzureCredentials(r.env) };
    }
    case 'azure': return { env: azureEnv(role, env0), error: null };
    default: return { env: stripHostCredentials(env0), error: null };
  }
}

/**
 * Today's host-blind GitHub env (the closed-gate path of pushEnv/metricsGitEnv), with every Azure key removed.
 * With the gate closed no Azure credential is configured, so this only drops the strip-only Boards token,
 * which a project's pre-push/post-checkout hook could otherwise read (s4, D21).
 * @returns {Promise<{env: object, error: string|null}>}
 */
export async function githubOnlyEnv(role, opts = {}) {
  const r = await githubEnv(role, opts);
  return { ...r, env: stripAzureCredentials(r.env) };
}
