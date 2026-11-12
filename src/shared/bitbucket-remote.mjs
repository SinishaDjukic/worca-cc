// src/shared/bitbucket-remote.mjs
// Bitbucket Cloud remote identity, shared by the server (forge.mjs, metrics, clone) and browser code (run-model):
// pure, no imports. A repository is { host:'bitbucket.org', owner: <workspace>, repo: <repo slug> }; a pull request
// web URL is https://bitbucket.org/<workspace>/<repo>/pull-requests/<id>, optionally with a tab (/overview, /diff, …).
// Bitbucket Data Center (self-hosted, /scm/ remotes) is a different product and is not matched here.

export const BITBUCKET_HOST = 'bitbucket.org';
const SEG = '[A-Za-z0-9][A-Za-z0-9._-]*';
const PR_RE = new RegExp(`^https://(?:www\\.)?bitbucket\\.org/(${SEG})/(${SEG})/pull-requests/([1-9]\\d{0,9})(?:/(?:overview|diff|commits|activity))?/?(?:[?#].*)?$`, 'i');
const ISSUE_RE = new RegExp(`^https://(?:www\\.)?bitbucket\\.org/(${SEG})/(${SEG})/issues/([1-9]\\d{0,9})(?:/[^/?#]*)?/?(?:[?#].*)?$`, 'i');

/** True for bitbucket.org (and its SSH-over-443 alias altssh.bitbucket.org). */
export function isBitbucketHost(host) {
  const h = String(host || '').toLowerCase();
  return h === BITBUCKET_HOST || h === 'altssh.bitbucket.org';
}

/** The canonical web URL of a pull request. */
export function bitbucketPrUrl({ owner, repo }, id) {
  return `https://bitbucket.org/${owner}/${repo}/pull-requests/${Number(id)}`;
}

/** A Bitbucket Cloud PR web URL → { host, owner, repo, number, url } (url canonical, no tab) | null. */
export function parseBitbucketPrUrl(url) {
  const m = PR_RE.exec(String(url || '').trim());
  if (!m) return null;
  const [, owner, repo, raw] = m;
  const number = Number(raw);
  if (!Number.isSafeInteger(number)) return null;
  return { host: BITBUCKET_HOST, owner, repo, number, url: bitbucketPrUrl({ owner, repo }, number) };
}

/** A Bitbucket Cloud issue web URL (…/issues/<id>, optionally /<title slug>) → { host, owner, repo, number } | null. */
export function parseBitbucketIssueUrl(url) {
  const m = ISSUE_RE.exec(String(url || '').trim());
  if (!m) return null;
  const [, owner, repo, raw] = m;
  const number = Number(raw);
  if (!Number.isSafeInteger(number)) return null;
  return { host: BITBUCKET_HOST, owner, repo, number };
}
