// src/core/host-credentials.mjs
// One host-aware entry point for worca's own git calls against a remote, and one strip for every spawn
// that must never see a code-host credential (agents, scripts, actions).
import { parseRemoteUrl, forgeOf } from './forge.mjs';
import { githubEnv, stripGithubCredentials, readGithubCredentials, asPersonMode } from './github-credentials.mjs';
import { azureEnv, stripAzureCredentials, readAzureCredentials } from './azure-credentials.mjs';
import { bitbucketEnv, stripBitbucketCredentials, readBitbucketCredentials } from './bitbucket-credentials.mjs';

/**
 * Tracker tokens worca never hands to a child: the documented {"$env":…} targets of task-source plugin token
 * fields (plugin-config.mjs resolves them in the host at read time, so stripping every spawn is safe).
 * WORCA_JIRA_TOKEN is jira-source's, and WORCA_JIRA_TOKEN_<NAME> gives each further profile (one per Jira site)
 * its own variable. Strip-only: worca itself never reads them.
 */
export const TRACKER_STRIP_ONLY_KEYS = Object.freeze(['WORCA_JIRA_TOKEN']);
export const TRACKER_STRIP_ONLY_PREFIXES = Object.freeze(['WORCA_JIRA_TOKEN_']);

/** Ignoring case: Windows environment names are case-insensitive, and stripping one too many is harmless. */
export function isTrackerTokenKey(key) {
  const k = String(key).toUpperCase();
  return TRACKER_STRIP_ONLY_KEYS.includes(k) || TRACKER_STRIP_ONLY_PREFIXES.some((p) => k.startsWith(p) && k.length > p.length);
}

function stripTrackerTokens(env) {
  const out = { ...env };
  for (const k of Object.keys(out)) if (isTrackerTokenKey(k)) delete out[k];
  return out;
}

export function stripHostCredentials(env) {
  return stripTrackerTokens(stripBitbucketCredentials(stripAzureCredentials(stripGithubCredentials(env))));
}

/**
 * True when a remote's host can change which credential a git call gets, so it is worth a
 * `git remote get-url`: GitHub App mode (the mint is per repo), an Azure DevOps or Bitbucket credential (only those
 * Azure hosts may get it), or — for pushes — WORCA_GH_AS_PERSON (it must apply to github.com only).
 * Otherwise the host-blind GitHub env is exactly right and no subprocess is spent.
 */
export function hostLookupNeeded({ push = false, env = process.env } = {}) {
  return readGithubCredentials(env).mode === 'app'
    || readAzureCredentials(env).mode !== 'none'
    || readBitbucketCredentials(env).mode !== 'none'
    || (push && asPersonMode(env) !== null);
}

/**
 * The env for a git call against `remoteUrl`: GitHub creds for github.com (App mode mints for that repo),
 * the ADO PAT for Azure DevOps, the Bitbucket token for bitbucket.org, every host credential stripped otherwise. Never throws.
 * `base` is forwarded to the GitHub env only when the caller gave one (keeps injected seams' arguments stable).
 * @returns {Promise<{env: object, error: string|null}>}
 */
export async function gitEnvFor(role, remoteUrl, { base, githubEnvImpl = githubEnv, ...githubOpts } = {}) {
  const env0 = base || process.env;
  const p = parseRemoteUrl(remoteUrl);
  switch (forgeOf(p)) {
    case 'github': {
      const r = await githubEnvImpl(role, { ...githubOpts, ...(base ? { base } : {}), repo: `${p.owner}/${p.repo}` });
      return { ...r, env: stripTrackerTokens(stripBitbucketCredentials(stripAzureCredentials(r.env))) };
    }
    case 'azure': return { env: stripTrackerTokens(stripBitbucketCredentials(azureEnv(role, env0))), error: null };
    case 'bitbucket': return { env: stripTrackerTokens(bitbucketEnv(role, env0)), error: null };
    default: return { env: stripHostCredentials(env0), error: null };
  }
}

/**
 * Today's host-blind GitHub env (the closed-gate path of pushEnv/metricsGitEnv), with every Azure key removed.
 * With the gate closed no Azure credential is configured, so this only drops the strip-only Boards token,
 * which a project's pre-push/post-checkout hook could otherwise read (s4, D21); likewise the tracker tokens.
 * @returns {Promise<{env: object, error: string|null}>}
 */
export async function githubOnlyEnv(role, opts = {}) {
  const r = await githubEnv(role, opts);
  return { ...r, env: stripTrackerTokens(stripBitbucketCredentials(stripAzureCredentials(r.env))) };
}
