// src/core/pr/azure.mjs
// Azure DevOps pull requests over REST 7.1 (fetch; no az CLI). The PR half of Ship-it for a base remote
// on dev.azure.com — git-info.mjs dispatches here by forge. Auth from azure-credentials.mjs.
//
/** @typedef {{ ok:true, url:string, number:number|null, existed:boolean } | { ok:false, error:string, kind?:'auth'|'unsupported'|'failed' }} PrCreateResult */
import { azureAuthHeader, readAzureCredentials } from '../azure-credentials.mjs';
import { azurePrUrl, parseAzurePrUrl } from '../../shared/azure-remote.mjs';
import { sameRepo } from '../forge.mjs';

export const API_VERSION = '7.1';
export const DESCRIPTION_MAX = 4000;
export const AZURE_TIMEOUT_MS = 20_000;
const STATE = { active: 'OPEN', completed: 'MERGED', abandoned: 'CLOSED' };
const MERGE = { succeeded: 'MERGEABLE', conflicts: 'CONFLICTING' };
const FOOTER_RE = /\n\n---\nStarted by [^\n]* via worca\s*$/;
const enc = encodeURIComponent;

let _fetch = (...a) => globalThis.fetch(...a);
export const _testing = {
  setFetch(fn) { _fetch = typeof fn === 'function' ? fn : (...a) => globalThis.fetch(...a); },
  reset() { _fetch = (...a) => globalThis.fetch(...a); },
};

const repoApi = (r) => `https://dev.azure.com/${enc(r.org)}/${enc(r.project)}/_apis/git/repositories/${enc(r.repo)}`;
const withVersion = (url) => `${url}${url.includes('?') ? '&' : '?'}api-version=${API_VERSION}`;
const fail = (kind, message, extra = {}) => Object.assign(new Error(message), { kind, ...extra });

/** One REST call. Throws Error{kind:'auth'|'network'|'timeout'|'failed', status?, body?}. */
export async function adoFetch(role, url, { method = 'GET', body, env = process.env } = {}) {
  const auth = azureAuthHeader(role, env);
  if (!auth) throw fail('auth', 'no Azure DevOps credential: set WORCA_ADO_TOKEN (Code: Read & Write) where worca runs');
  let res;
  try {
    res = await _fetch(withVersion(url), {
      method,
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-tfs-fedauthredirect': 'Suppress', ...auth },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(AZURE_TIMEOUT_MS),
    });
  } catch (e) {
    throw fail(e?.name === 'TimeoutError' ? 'timeout' : 'network', `Azure DevOps unreachable: ${e?.message || e}`);
  }
  // A rejected PAT answers 401 — or 203 with a sign-in page when the redirect is not suppressed.
  if (res.status === 401 || res.status === 203) {
    throw fail('auth', 'Azure DevOps refused the token (expired, revoked, or missing the Code scope)', { status: res.status });
  }
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  if (!res.ok) {
    throw fail(res.status === 403 ? 'auth' : 'failed', `Azure DevOps ${res.status}${json?.message ? `: ${json.message}` : ''}`, { status: res.status, body: json });
  }
  return { status: res.status, json };
}

const toPr = (coords, pr) => ({
  state: STATE[pr?.status] || null,
  url: azurePrUrl(coords, pr.pullRequestId),
  number: Number.isInteger(pr?.pullRequestId) ? pr.pullRequestId : null,
  mergeable: MERGE[pr?.mergeStatus] || 'UNKNOWN',
});

/** Azure caps a PR description at 4,000 chars: cut at a paragraph boundary, keep worca's attribution footer last. */
export function fitDescription(body, max = DESCRIPTION_MAX) {
  const text = String(body || '');
  if (text.length <= max) return text;
  const m = FOOTER_RE.exec(text);
  const footer = m ? m[0] : '';
  const main = m ? text.slice(0, m.index) : text;
  const note = '\n\n_(Description shortened to fit Azure DevOps.)_';
  const room = Math.max(0, max - footer.length - note.length);
  let cut = main.slice(0, room);
  const para = cut.lastIndexOf('\n\n');
  if (para > room / 2) cut = cut.slice(0, para);
  return `${cut.trimEnd()}${note}${footer}`;
}

export function forkRefusal(baseRepo) {
  return `Azure DevOps pull requests between repositories (forks) are not supported yet — push to ${baseRepo?.name || 'the base remote'}.`;
}

/** { ok } | { ok:false, reason } — no network. */
export async function available({ env = process.env } = {}) {
  return readAzureCredentials(env).mode !== 'none'
    ? { ok: true }
    : { ok: false, reason: 'Azure DevOps is not configured: set WORCA_ADO_TOKEN (a PAT with Code: Read & Write) where worca runs' };
}

async function activePr(baseRepo, head, base, env) {
  const q = `searchCriteria.sourceRefName=${enc(`refs/heads/${head}`)}&searchCriteria.targetRefName=${enc(`refs/heads/${base}`)}&searchCriteria.status=active`;
  const { json } = await adoFetch('read', `${repoApi(baseRepo)}/pullrequests?${q}`, { env });
  const pr = Array.isArray(json?.value) ? json.value.find((x) => !x.forkSource) : null;
  return pr ? toPr(baseRepo, pr) : null;
}

/** @returns {Promise<PrCreateResult>} */
export async function createPr({ base, head, title, body = '', baseRepo, pushRepo = null, workItemId = null, env = process.env }) {
  if (!baseRepo?.org) return { ok: false, kind: 'failed', error: 'the base remote is not an Azure DevOps repository' };
  if (pushRepo && !sameRepo(pushRepo, baseRepo)) return { ok: false, kind: 'unsupported', error: forkRefusal(baseRepo) };
  const payload = {
    sourceRefName: `refs/heads/${head}`, targetRefName: `refs/heads/${base}`,
    title: title || head, description: fitDescription(body || title || head),
    ...(workItemId ? { workItemRefs: [{ id: String(workItemId) }] } : {}),
  };
  try {
    const { json } = await adoFetch('write', `${repoApi(baseRepo)}/pullrequests`, { method: 'POST', body: payload, env });
    if (!Number.isInteger(json?.pullRequestId)) return { ok: false, kind: 'failed', error: 'Azure DevOps answered without a pull request id (no pull request id)' };
    return { ok: true, url: azurePrUrl(baseRepo, json.pullRequestId), number: json.pullRequestId, existed: false };
  } catch (e) {
    if (e.status === 409) {
      const found = await activePr(baseRepo, head, base, env).catch(() => null);
      if (found) return { ok: true, url: found.url, number: found.number, existed: true };
    }
    return { ok: false, kind: e.kind === 'auth' ? 'auth' : 'failed', error: e.message };
  }
}

/** { state: OPEN|MERGED|CLOSED|null, url, number, mergeable } | null — never throws. */
export async function viewPr({ prUrl, env = process.env }) {
  const p = parseAzurePrUrl(prUrl);
  if (!p) return null;
  try {
    const { json } = await adoFetch('read', `https://dev.azure.com/${enc(p.org)}/${enc(p.project)}/_apis/git/pullrequests/${p.number}`, { env });
    return toPr(p, json);
  } catch { return null; }
}

/** { state: OPEN|MERGED, url, number, mergeable } | null — OPEN first, like the GitHub lookup. Never throws. */
export async function findPrForBranch({ head, baseRepo, env = process.env }) {
  if (!head || !baseRepo?.org) return null;
  try {
    const q = `searchCriteria.sourceRefName=${enc(`refs/heads/${head}`)}&searchCriteria.status=all&$top=30`;
    const { json } = await adoFetch('read', `${repoApi(baseRepo)}/pullrequests?${q}`, { env });
    const prs = (Array.isArray(json?.value) ? json.value : []).filter((x) => !x?.forkSource)   // a fork's same-named branch is not ours
      .map((x) => toPr(baseRepo, x)).filter((x) => x.state === 'OPEN' || x.state === 'MERGED');
    return prs.find((x) => x.state === 'OPEN') || prs[0] || null;
  } catch { return null; }
}

/**
 * The PRs of one repo created since `minTime` (ISO), as raw API objects (the list is newest first). Throws adoFetch
 * errors (metrics status). `complete` is false when `maxPages` full pages ran out before the listing reached `minTime`:
 * older PRs inside the window may exist beyond the cap, so a branch with no match is UNKNOWN, not "no PR" (M2).
 * @returns {Promise<{ prs: object[], complete: boolean }>}
 */
export async function listPullRequests(coords, { minTime = null, maxPages = 10, top = 100, env = process.env } = {}) {
  const min = minTime ? Date.parse(minTime) : NaN;
  const before = (p) => Number.isFinite(min) && !!p?.creationDate && Date.parse(p.creationDate) < min;
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const q = ['searchCriteria.status=all', `$top=${top}`, `$skip=${page * top}`,
      ...(minTime ? [`searchCriteria.minTime=${enc(minTime)}`, 'searchCriteria.queryTimeRangeType=created'] : [])].join('&');
    const { json } = await adoFetch('read', `${repoApi(coords)}/pullrequests?${q}`, { env });
    const items = Array.isArray(json?.value) ? json.value : [];
    // minTime/queryTimeRangeType are unconfirmed in 7.1 (design §8): filter locally too.
    out.push(...items.filter((p) => !before(p)));
    if (items.length < top) return { prs: out, complete: true };                 // the listing ended
    // The list is ordered by pullRequestId descending, i.e. newest created first (§7 manual check). Test the page's
    // LAST (oldest) item, not any item: once the oldest on a page predates minTime, later pages hold only older PRs.
    if (before(items.at(-1))) return { prs: out, complete: true };
  }
  return { prs: out, complete: false };
}

/** Work item to link on create: a run from the Azure Boards source ("org/project#123") in the base repo's org. */
export function workItemIdFromSourceRef(sourceRef, baseRepo) {
  let ref = null;
  try { ref = typeof sourceRef === 'string' ? JSON.parse(sourceRef) : sourceRef; } catch { return null; }
  if (ref?.plugin !== 'azure-boards-source' || !baseRepo?.org) return null;
  const m = /^([^/#]+)\/[^#]+#(\d+)$/.exec(String(ref.taskId || ''));
  return m && m[1].toLowerCase() === baseRepo.org.toLowerCase() ? Number(m[2]) : null;
}
