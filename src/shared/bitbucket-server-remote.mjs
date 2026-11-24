// src/shared/bitbucket-server-remote.mjs
// Bitbucket Server / Data Center remote identity, the sibling of bitbucket-remote.mjs (Bitbucket Cloud). Pure, no imports.
// A self-hosted Bitbucket Server is matched by HOST ALLOWLIST (WORCA_BB_SERVER_HOSTS, resolved in
// bitbucket-server-credentials.mjs), not by URL shape: any host can host a /scm/ remote. A pull request web URL is
// https://<host>/projects/<projectKey>/repos/<repoSlug>/pull-requests/<id>. A repo is { host, key: <projectKey>, slug: <repoSlug> }.

const SEG = '[A-Za-z0-9][A-Za-z0-9._-]*';
const PR_RE = new RegExp(`^https://([^/?#]+)/projects/(${SEG})/repos/(${SEG})/pull-requests/([1-9]\\d{0,9})(?:/(?:overview|diff|commits|activity))?/?(?:[?#].*)?$`, 'i');

/** The canonical web URL of a pull request on a Bitbucket Server repo ({ host, key, slug }). */
export function bitbucketServerPrUrl({ host, key, slug }, id) {
  return `https://${host}/projects/${key}/repos/${slug}/pull-requests/${Number(id)}`;
}

/** A Bitbucket Server PR web URL → { host, key, slug, number, url } (url canonical, no tab) | null. */
export function parseBitbucketServerPrUrl(url) {
  const m = PR_RE.exec(String(url || '').trim());
  if (!m) return null;
  const [, host, key, slug, raw] = m;
  const number = Number(raw);
  if (!Number.isSafeInteger(number)) return null;
  return { host, key, slug, number, url: bitbucketServerPrUrl({ host, key, slug }, number) };
}
