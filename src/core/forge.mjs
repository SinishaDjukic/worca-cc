// src/core/forge.mjs
// Which code host a remote / PR URL belongs to, and the one remote-URL parser every caller shares
// (Ship-it, sync, clone, metrics; the workspace map shares the Azure fold via src/shared/azure-remote.mjs).
import { isAzureHost, parseAzurePath, parseAzurePrUrl } from '../shared/azure-remote.mjs';
import { parseBitbucketPrUrl } from '../shared/bitbucket-remote.mjs';

export { FORGE_LABEL, forgeOfPrUrl } from '../shared/pr-forge.mjs';

export function parseGithubPrUrl(value) {
  if (typeof value !== 'string') return null;
  const m = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/pull\/([1-9]\d*)$/.exec(value);
  if (!m) return null;
  const [, owner, repo, raw] = m;
  if (!owner || !repo || owner.includes('@')) return null;
  const number = Number(raw);
  if (!Number.isSafeInteger(number)) return null;
  return { owner, repo, number, url: `https://github.com/${owner}/${repo}/pull/${number}` };
}

/** A PR Watch PR can follow (#619): a canonical github.com PR, an Azure DevOps one, or a Bitbucket Cloud one. */
export function watchablePrUrl(value) {
  return !!(parseGithubPrUrl(value) || parseAzurePrUrl(value) || parseBitbucketPrUrl(value));
}

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
 * it names the same repository, and gh's --repo form only knows the real host. Bitbucket's `altssh.bitbucket.org`
 * folds into `bitbucket.org` the same way.
 * Azure DevOps remotes (every spelling) fold to { host:'dev.azure.com', org, project,
 * owner:'org/project', repo } via src/shared/azure-remote.mjs.
 * Pure; never throws.
 */
const HOST_ALIASES = { 'ssh.github.com': 'github.com', 'altssh.bitbucket.org': 'bitbucket.org' };

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

/** 'github' | 'azure' | 'bitbucket' | null for a parsed remote (or a listRemotes entry). null = plain git. */
export function forgeOf(parsed) {
  if (!parsed) return null;
  if (parsed.host === 'github.com') return 'github';
  if (parsed.host === 'dev.azure.com' && parsed.org) return 'azure';
  if (parsed.host === 'bitbucket.org') return 'bitbucket';
  return null;
}

/** PR number from a GitHub (/pull/N), Azure DevOps (/pullrequest/N) or Bitbucket (/pull-requests/N) URL, else null. */
export function prNumberFromUrl(url) {
  const az = parseAzurePrUrl(url);
  if (az) return az.number;
  const bb = parseBitbucketPrUrl(url);
  if (bb) return bb.number;
  return Number((/\/pull\/(\d+)/.exec(String(url || '')) || [])[1]) || null;
}

const posInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

/** A PR web URL → { forge, owner, repo, number, key } (key = lowercase canonical identity; tails, query, case and
 *  the visualstudio.com spelling do not change it) | null for an unsupported host or a bad number. */
export function prIdentity(url) {
  const text = String(url ?? '').trim();
  const gh = /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(text);
  if (gh) {
    const number = posInt(gh[3]);
    return number ? { forge: 'github', owner: gh[1], repo: gh[2], number, key: `github.com/${gh[1]}/${gh[2]}/pull/${number}`.toLowerCase() } : null;
  }
  const az = parseAzurePrUrl(text);
  if (az) {
    const number = posInt(az.number);
    return number ? { forge: 'azure', owner: `${az.org}/${az.project}`, org: az.org, project: az.project, repo: az.repo, number,
      key: `dev.azure.com/${az.org}/${az.project}/${az.repo}/pullrequest/${number}`.toLowerCase() } : null;
  }
  const bb = parseBitbucketPrUrl(text);
  if (bb) {
    const number = posInt(bb.number);
    return number ? { forge: 'bitbucket', owner: bb.owner, repo: bb.repo, number, key: `bitbucket.org/${bb.owner}/${bb.repo}/pull-requests/${number}`.toLowerCase() } : null;
  }
  return null;
}

/** A user's PR reference: a URL, owner/repo#N, or N / #N → a PrRef, else null. */
export function parsePrRef(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  let m = /^#?(\d+)$/.exec(t);
  if (m) { const number = posInt(m[1]); return number ? { kind: 'number', number } : null; }
  m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/.exec(t);
  if (m) { const number = posInt(m[3]); return number ? { kind: 'slug', owner: m[1], repo: m[2], number } : null; }
  if (/^https?:\/\//i.test(t)) {
    const id = prIdentity(t);
    return id ? { kind: 'url', number: id.number, key: id.key, forge: id.forge } : null;
  }
  return null;
}

/** Does a recorded PR ({ url, number? }) match a PrRef? Never throws. */
export function prRefMatches(ref, pr) {
  try {
    if (!ref || !pr) return false;
    if (ref.kind === 'number') return (pr.number ?? prIdentity(pr.url)?.number) === ref.number;
    const id = prIdentity(pr.url);
    if (!id) return false;
    if (ref.kind === 'url') return id.key === ref.key;
    if (ref.kind === 'slug') {
      if (id.number !== ref.number || id.repo.toLowerCase() !== ref.repo.toLowerCase()) return false;
      const o = ref.owner.toLowerCase();
      return id.forge === 'azure' ? (id.org.toLowerCase() === o || id.project.toLowerCase() === o) : id.owner.toLowerCase() === o;
    }
    return false;
  } catch { return false; }
}
