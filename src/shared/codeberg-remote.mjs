// src/shared/codeberg-remote.mjs
// Codeberg remote identity: a Forgejo instance with a fixed host, so the Gitea helpers with a one-entry host list.
// Pure, no imports beyond gitea-remote. A pull request web URL is https://codeberg.org/<owner>/<repo>/pulls/<index>.
import { isGiteaHost, giteaPrUrl, parseGiteaPrUrl } from './gitea-remote.mjs';

export const CODEBERG_HOST = 'codeberg.org';
const HOSTS = Object.freeze([CODEBERG_HOST]);

/** True for codeberg.org. */
export function isCodebergHost(host) {
  return isGiteaHost(host, HOSTS);
}

/** The canonical web URL of a pull request. */
export function codebergPrUrl({ owner, repo }, number) {
  return giteaPrUrl({ host: CODEBERG_HOST, owner, repo }, number);
}

/** A Codeberg PR web URL → { host, owner, repo, number, url } (url canonical, no tab) | null. */
export function parseCodebergPrUrl(url) {
  return parseGiteaPrUrl(url, HOSTS);
}
