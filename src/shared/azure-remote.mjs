// src/shared/azure-remote.mjs
// Azure DevOps Services remote identity, shared by the server (forge.mjs, metrics, clone) and the
// workspace map (keys.mjs, browser-importable): pure, no imports. Every spelling of one repository —
// https dev.azure.com, legacy {org}.visualstudio.com (with or without DefaultCollection), ssh v3 —
// folds to { host:'dev.azure.com', org, project, owner:'org/project', repo }. Names are percent-decoded.

export const AZURE_HOST = 'dev.azure.com';
const SSH_HOSTS = new Set(['ssh.dev.azure.com', 'vs-ssh.visualstudio.com']);
const VS_RE = /^([a-z0-9][a-z0-9-]*)\.visualstudio\.com$/;

const dec = (x) => { try { return decodeURIComponent(x); } catch { return x; } };

/** True for every Azure DevOps Services git/web host. */
export function isAzureHost(host) {
  const h = String(host || '').toLowerCase();
  return h === AZURE_HOST || SSH_HOSTS.has(h) || VS_RE.test(h);
}

function build(org, project, repo) {
  const [o, p, r] = [org, project, repo].map((x) => (typeof x === 'string' ? dec(x).trim() : ''));
  if (!o || !p || !r) return null;
  return { host: AZURE_HOST, org: o, project: p, owner: `${o}/${p}`, repo: r };
}

/**
 * host + path segments (already split, '.git' and trailing '/' stripped) → identity | null.
 * https needs `_git` (`org/proj/_git/repo`, or `org/_git/repo` for the project's default repo);
 * ssh needs `v3/org/proj/repo`.
 */
export function parseAzurePath(host, segs) {
  const h = String(host || '').toLowerCase();
  const s = Array.isArray(segs) ? segs.filter(Boolean) : [];
  if (SSH_HOSTS.has(h)) {
    if (s.length !== 4 || s[0].toLowerCase() !== 'v3') return null;
    return build(s[1], s[2], s[3]);
  }
  let org;
  let rest = s;
  if (h === AZURE_HOST) { org = rest[0]; rest = rest.slice(1); } else {
    const m = VS_RE.exec(h);
    if (!m) return null;
    org = m[1];
    if (rest[0]?.toLowerCase() === 'defaultcollection') rest = rest.slice(1);
  }
  const i = rest.indexOf('_git');
  if (i === 0 && rest.length === 2) return build(org, rest[1], rest[1]);
  if (i === 1 && rest.length === 3) return build(org, rest[0], rest[2]);
  return null;
}

/** The canonical web URL of a pull request (always dev.azure.com, names encoded). */
export function azurePrUrl({ org, project, repo }, id) {
  const e = encodeURIComponent;
  return `https://dev.azure.com/${e(org)}/${e(project)}/_git/${e(repo)}/pullrequest/${Number(id)}`;
}

/** "https://dev.azure.com/o/p/_git/r/pullrequest/12" (or the visualstudio.com spelling) → identity + number | null. */
export function parseAzurePrUrl(url) {
  const m = /^https:\/\/(?:[^@/]+@)?([^/:]+)\/(.+?)\/pullrequest\/(\d+)\/?(?:[?#].*)?$/i.exec(String(url || '').trim());
  if (!m || !isAzureHost(m[1])) return null;
  const id = parseAzurePath(m[1], m[2].split('/'));
  return id ? { ...id, number: Number(m[3]) } : null;
}
