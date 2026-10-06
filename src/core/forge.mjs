// src/core/forge.mjs
// Which code host a remote / PR URL belongs to, and the one remote-URL parser every caller shares
// (Ship-it, sync, clone, metrics; the workspace map shares the Azure fold via src/shared/azure-remote.mjs).
import { isAzureHost, parseAzurePath, parseAzurePrUrl } from '../shared/azure-remote.mjs';

export const FORGE_LABEL = Object.freeze({ github: 'GitHub', azure: 'Azure DevOps' });

/**
 * Parse a git remote URL into { host, owner, repo } or null when it is not a
 * hosted owner/repo URL (local paths, file://, bare hosts). Accepts
 *   https://github.com/owner/repo.git   https://user@host/owner/repo
 *   ssh://git@github.com/owner/repo.git ssh://git@host:2222/owner/repo
 *   git@github.com:owner/repo.git       (scp-style, cf. marketplaces.mjs:31)
 *   git@github.com:/owner/repo.git      host:owner/repo
 *   git://host/owner/repo.git
 * Trailing `.git` / `/` are dropped; owner/repo are the LAST two path segments.
 * GitHub's SSH-over-443 alias host (`ssh.github.com`) is folded into `github.com`:
 * it names the same repository, and gh's --repo form only knows the real host.
 * Azure DevOps remotes (every spelling) fold to { host:'dev.azure.com', org, project,
 * owner:'org/project', repo } via src/shared/azure-remote.mjs.
 * Pure; never throws.
 */
const HOST_ALIASES = { 'ssh.github.com': 'github.com' };

export function parseRemoteUrl(url) {
  const s = String(url || '').trim();
  if (!s) return null;
  let host = '';
  let pathPart = '';
  let m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(s);
  if (m) {
    host = m[1]; pathPart = m[2];
  } else if ((m = /^(?:([^@/\s]+)@)?([^:/\s]+):(.+)$/.exec(s))) {
    // scp-style [user@]host:path. Without a user@ prefix a leading `/` is
    // indistinguishable from a Windows drive path (C:/repos/x) → not hosted.
    if (!m[1] && m[3].startsWith('/')) return null;
    host = m[2]; pathPart = m[3];
  } else {
    return null;
  }
  const segs = pathPart.replace(/\/+$/, '').replace(/\.git$/i, '').split('/').filter(Boolean);
  const h = host.toLowerCase();
  // Azure DevOps before the generic rule: org (and project) live in the path, not the last two segments.
  if (isAzureHost(h)) return parseAzurePath(h, segs);
  if (segs.length < 2) return null;
  const owner = segs[segs.length - 2];
  const repo = segs[segs.length - 1];
  if (!owner || !repo) return null;
  return { host: HOST_ALIASES[h] || h, owner, repo };
}

/** gh's `[HOST/]OWNER/REPO` form for --repo; the host is omitted for github.com. */
export function remoteRepoSlug(parsed) {
  if (!parsed || !parsed.owner || !parsed.repo) return null;
  const base = `${parsed.owner}/${parsed.repo}`;
  return parsed.host && parsed.host !== 'github.com' ? `${parsed.host}/${base}` : base;
}

/** True when two parsed remotes name the same repository (GitHub is case-insensitive). */
export function sameRepo(a, b) {
  if (!a || !b || !a.owner || !b.owner || !a.repo || !b.repo) return false;
  return String(a.host || '').toLowerCase() === String(b.host || '').toLowerCase()
    && a.owner.toLowerCase() === b.owner.toLowerCase()
    && a.repo.toLowerCase() === b.repo.toLowerCase();
}

/** 'github' | 'azure' | null for a parsed remote (or a listRemotes entry). null = plain git. */
export function forgeOf(parsed) {
  if (!parsed) return null;
  if (parsed.host === 'github.com') return 'github';
  if (parsed.host === 'dev.azure.com' && parsed.org) return 'azure';
  return null;
}

/** The forge of a persisted pr_url. */
export function forgeOfPrUrl(url) {
  if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/i.test(String(url || ''))) return 'github';
  return parseAzurePrUrl(url) ? 'azure' : null;
}

/** PR number from a GitHub (/pull/N) or Azure DevOps (/pullrequest/N) URL, else null. */
export function prNumberFromUrl(url) {
  const az = parseAzurePrUrl(url);
  if (az) return az.number;
  return Number((/\/pull\/(\d+)/.exec(String(url || '')) || [])[1]) || null;
}
