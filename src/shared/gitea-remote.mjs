// src/shared/gitea-remote.mjs
// Gitea / Forgejo remote identity for forge.mjs, metrics and clone: pure, no imports, so browser code could share it.
// There is no fixed host: the deployment names its instances (WORCA_GITEA_HOSTS, a comma list of
// host names) and every helper takes that list. A repository is { host, owner, repo }; a pull request web URL is
// https://<host>/<owner>/<repo>/pulls/<index>, optionally with a tab (/files, /commits).
// Forgejo is API-compatible for everything worca uses and is the same forge here. codeberg.org is its own forge
// (src/shared/codeberg-remote.mjs) built on these helpers with a fixed host list.

const SEG = '[A-Za-z0-9][A-Za-z0-9._-]*';
const LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const HOST_RE = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})*$`);
const PR_RE = new RegExp(`^https://([^/?#:]+)/(${SEG})/(${SEG})/pulls/([1-9]\\d{0,9})(?:/(?:files|commits))?/?(?:[?#].*)?$`, 'i');

/** WORCA_GITEA_HOSTS → host names, lowercased and deduplicated. Entries with a scheme, port or path are dropped. */
export function parseGiteaHosts(value) {
  const out = [];
  for (const raw of String(value || '').split(',')) {
    const h = raw.trim().toLowerCase();
    if (HOST_RE.test(h) && !out.includes(h)) out.push(h);
  }
  return out;
}

/** True when `host` is one of `hosts`. */
export function isGiteaHost(host, hosts) {
  const h = String(host || '').toLowerCase();
  return !!h && Array.isArray(hosts) && hosts.includes(h);
}

/** The REST base of one host. */
export function giteaApiOrigin(host) {
  return `https://${host}/api/v1`;
}

/** The canonical web URL of a pull request. */
export function giteaPrUrl({ host, owner, repo }, number) {
  return `https://${host}/${owner}/${repo}/pulls/${Number(number)}`;
}

/** A PR web URL on one of `hosts` → { host, owner, repo, number, url } (url canonical, no tab) | null. */
export function parseGiteaPrUrl(url, hosts) {
  const m = PR_RE.exec(String(url || '').trim());
  if (!m) return null;
  const [, rawHost, owner, repo, raw] = m;
  const host = rawHost.toLowerCase();
  if (!isGiteaHost(host, hosts)) return null;
  const number = Number(raw);
  if (!Number.isSafeInteger(number)) return null;
  return { host, owner, repo, number, url: giteaPrUrl({ host, owner, repo }, number) };
}
