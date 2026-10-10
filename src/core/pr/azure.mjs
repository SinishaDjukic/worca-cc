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
const withVersion = (url, version = API_VERSION) => `${url}${url.includes('?') ? '&' : '?'}api-version=${version}`;
const fail = (kind, message, extra = {}) => Object.assign(new Error(message), { kind, ...extra });

/**
 * One REST call. Throws Error{kind:'auth'|'network'|'timeout'|'failed', status?, body?}. `version` overrides the
 * api-version (preview APIs); `text: true` reads a plain-text body (build logs) into `text` instead of `json`.
 */
export async function adoFetch(role, url, { method = 'GET', body, env = process.env, version = API_VERSION, text = false } = {}) {
  const auth = azureAuthHeader(role, env);
  if (!auth) throw fail('auth', 'no Azure DevOps credential: set WORCA_ADO_TOKEN (Code: Read & Write) where worca runs');
  let res;
  try {
    res = await _fetch(withVersion(url, version), {
      method,
      headers: { accept: text ? 'text/plain' : 'application/json', 'content-type': 'application/json', 'x-tfs-fedauthredirect': 'Suppress', ...auth },
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
  if (text && res.ok) return { status: res.status, text: String(await res.text()) };
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
export async function createPr({ base, head, title, body = '', baseRepo, pushRepo = null, workItemId = null, draft = false, env = process.env }) {
  if (!baseRepo?.org) return { ok: false, kind: 'failed', error: 'the base remote is not an Azure DevOps repository' };
  if (pushRepo && !sameRepo(pushRepo, baseRepo)) return { ok: false, kind: 'unsupported', error: forkRefusal(baseRepo) };
  const payload = {
    sourceRefName: `refs/heads/${head}`, targetRefName: `refs/heads/${base}`,
    title: title || head, description: fitDescription(body || title || head),
    ...(workItemId ? { workItemRefs: [{ id: String(workItemId) }] } : {}),
    ...(draft === true ? { isDraft: true } : {}),   // a new PR only: a 409 recovers the existing one as-is
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

// ── Watch PR (#619) ─────────────────────────────────────────────────────────
// The Azure DevOps half of the PR watch adapter. Each answer is the snapshot shape pr-watch.mjs's
// collectTriggers reads (the GitHub field names), so the watcher itself stays forge-blind. Failures are
// { ok:false, class:'rate-limit'|'auth'|'failed', error }, like the gh adapter's.

const POLICY = Object.freeze({
  build: '0609b952-1397-4640-95ec-e00a01b2c241',          // Build validation
  status: 'cbdc66da-9728-4af8-aada-9a5a32e4a226',         // Status check (an external service's PR status)
  minReviewers: 'fa4e907d-c16b-4a4c-9dfa-4906e5d171dd',   // Minimum number of reviewers
  requiredReviewers: 'fd2167ab-b0be-447a-8ec8-39368250530e',
});
const PREVIEW = '7.1-preview.1';                            // policy evaluations: list and requeue
const UNRESOLVED = new Set(['active', 'pending']);
const STATUS_STATE = { succeeded: 'SUCCESS', failed: 'FAILURE', error: 'ERROR', pending: 'PENDING', notSet: 'EXPECTED', notApplicable: 'NEUTRAL' };
const EVALUATION_STATE = { approved: 'SUCCESS', rejected: 'FAILURE', broken: 'ERROR', queued: 'PENDING', running: 'PENDING' };
const VOTE = { '-10': 'Rejected', '-5': 'Waiting for author' };
const LOG_LINES = 200;

const projectApi = (p) => `https://dev.azure.com/${enc(p.org)}/${enc(p.project)}/_apis`;
const prApi = (p) => `${repoApi(p)}/pullRequests/${p.number}`;
const watchFailure = (e) => ({ ok: false, class: e?.status === 429 ? 'rate-limit' : e?.kind === 'auth' ? 'auth' : 'failed',
  error: e?.message || String(e) });
const branchOf = (ref) => (typeof ref === 'string' && ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null);
const statusKey = (genre, name) => (genre ? `${genre}/${name}` : String(name || ''));
// Anyone who can comment on an Azure Repos PR is a member of its project: there is no outside contributor.
const member = (identity) => ({ author: { login: identity?.uniqueName || identity?.id || null }, authorAssociation: 'MEMBER' });
const live = (ev) => ev?.configuration && ev.configuration.isEnabled !== false && !ev.configuration.isDeleted && ev.status !== 'notApplicable';
/** A best-effort read: the snapshot still answers without it (a token without Build (Read), an older server). */
const optional = (promise, fallback) => promise.catch((e) => { if (e?.status === 429) throw e; return fallback; });

async function listEvaluations(p, projectId, env) {
  const artifactId = enc(`vstfs:///CodeReview/CodeReviewId/${projectId}/${p.number}`);
  const out = [];
  for (let skip = 0; skip < 10_000; skip += 100) {
    const { json } = await adoFetch('read', `${projectApi(p)}/policy/evaluations?artifactId=${artifactId}&$top=100&$skip=${skip}`,
      { env, version: PREVIEW });
    const items = Array.isArray(json?.value) ? json.value : [];
    out.push(...items);
    if (items.length < 100) return out;
  }
  return out;
}

const buildName = (ev) => ev.configuration.settings?.displayName || ev.context?.buildDefinitionName || ev.configuration.type?.displayName || 'Build';

/**
 * The checks of a PR. Azure Repos runs PR builds only through a build validation policy, so its evaluations are
 * the checks (blocking = required); a status check policy makes an external service's status required. Statuses no
 * policy covers are listed as optional. An evaluation with a build is a `check` (its log is readable, and its
 * evaluation re-queues it: `runId`); one without (not queued yet, broken) is a `status` keyed by name and head.
 */
function checksOf(p, evaluations, statuses, headSha) {
  const contexts = []; const covered = new Set();
  for (const ev of evaluations.filter(live)) {
    const cfg = ev.configuration; const isRequired = cfg.isBlocking === true;
    const state = EVALUATION_STATE[ev.status] || 'PENDING';
    if (cfg.type?.id === POLICY.build) {
      const name = buildName(ev); const buildId = ev.context?.buildId;
      if (Number.isSafeInteger(buildId) && buildId > 0) {
        contexts.push({ type: 'check', databaseId: buildId, name, isRequired, runId: ev.evaluationId || null,
          status: state === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED', conclusion: state === 'PENDING' ? null : state === 'SUCCESS' ? 'SUCCESS' : 'FAILURE',
          detailsUrl: `https://dev.azure.com/${enc(p.org)}/${enc(p.project)}/_build/results?buildId=${buildId}` });
      } else {
        contexts.push({ type: 'status', context: name, state, targetUrl: null, isRequired, headSha });
      }
    } else if (cfg.type?.id === POLICY.status) {
      const key = statusKey(cfg.settings?.statusGenre, cfg.settings?.statusName);
      if (key) covered.add(key);
      contexts.push({ type: 'status', context: key || cfg.type?.displayName || 'Status check', state, targetUrl: null, isRequired, headSha });
    }
  }
  // The newest status per context (the list holds one entry per post, across iterations).
  for (const [key, s] of latestStatuses(statuses)) {
    if (covered.has(key)) continue;
    contexts.push({ type: 'status', context: key, state: STATUS_STATE[s.state] || 'EXPECTED', targetUrl: s.targetUrl || null, isRequired: false, headSha });
  }
  return contexts;
}

function latestStatuses(statuses) {
  const latest = new Map();
  for (const s of Array.isArray(statuses) ? statuses : []) {
    const key = statusKey(s?.context?.genre, s?.context?.name);
    if (!key) continue;
    if (!latest.has(key) || Number(s.id) > Number(latest.get(key).id)) latest.set(key, s);
  }
  return latest;
}

/**
 * The base branch head's results for the PR's checks, by the same names: a build policy's pipeline on the
 * base branch at `baseSha` (the newest of its builds there), and the commit statuses on `baseSha`. A check
 * with no result on the base head is in no list. `settled` once none still runs. Best effort: a read
 * that fails leaves the lists empty, so every failure counts as the PR's own.
 */
async function baseResults(p, { base, baseSha, evaluations, env }) {
  const out = { failing: [], passing: [], pending: [], settled: true };
  if (!base || !baseSha) return out;
  const sets = { failing: new Set(), passing: new Set(), pending: new Set() };
  const defs = new Map();
  for (const ev of evaluations.filter(live)) {
    const id = ev.configuration.type?.id === POLICY.build ? ev.configuration.settings?.buildDefinitionId : null;
    if (Number.isSafeInteger(id) && !defs.has(id)) defs.set(id, buildName(ev));
  }
  const reads = [...defs].map(([id, name]) => optional(adoFetch('read',
    `${projectApi(p)}/build/builds?definitions=${id}&branchName=${enc(`refs/heads/${base}`)}&queryOrder=queueTimeDescending&$top=20`, { env })
    .then(({ json }) => {
      const b = (Array.isArray(json?.value) ? json.value : []).find((x) => x?.sourceVersion === baseSha);
      if (!b) return;
      sets[b.status !== 'completed' ? 'pending' : ['succeeded', 'partiallySucceeded'].includes(b.result) ? 'passing' : 'failing'].add(name);
    }), undefined));
  reads.push(optional(adoFetch('read', `${repoApi(p)}/commits/${enc(baseSha)}/statuses?latestOnly=true`, { env }).then(({ json }) => {
    for (const [key, s] of latestStatuses(json?.value)) {
      const st = STATUS_STATE[s.state] || 'EXPECTED';
      sets[['PENDING', 'EXPECTED'].includes(st) ? 'pending' : ['FAILURE', 'ERROR'].includes(st) ? 'failing' : 'passing'].add(key);
    }
  }), undefined));
  await Promise.all(reads);
  return { failing: [...sets.failing], passing: [...sets.passing], pending: [...sets.pending], settled: sets.pending.size === 0 };
}

/** The base branch's live tip (a PR's lastMergeTargetCommit is the base as of its last merge, and lags). */
async function baseTip(p, base, fallback, env) {
  const { json } = await adoFetch('read', `${repoApi(p)}/refs?filter=${enc(`heads/${base}`)}`, { env });
  return (Array.isArray(json?.value) ? json.value : []).find((r) => r?.name === `refs/heads/${base}`)?.objectId || fallback;
}

/** How many base commits the PR head lacks (0 when unknown). */
async function behindBy(p, baseSha, headSha, env) {
  const q = `baseVersion=${enc(baseSha)}&baseVersionType=commit&targetVersion=${enc(headSha)}&targetVersionType=commit&$top=1`;
  const { json } = await adoFetch('read', `${repoApi(p)}/diffs/commits?${q}`, { env });
  return Number(json?.behindCount) || 0;
}

/** The PR and everything the watch and the checks line read about it. `threads: false` skips the review threads. */
async function readPr(p, env, { threads: withThreads = true } = {}) {
  const { json: pr } = await adoFetch('read', prApi(p), { env });
  const state = STATE[pr?.status]; const branch = branchOf(pr?.sourceRefName); const base = branchOf(pr?.targetRefName);
  const headSha = pr?.lastMergeSourceCommit?.commitId; const projectId = pr?.repository?.project?.id;
  if (!state || !branch || typeof headSha !== 'string' || !projectId) return null;
  const facts = { url: azurePrUrl(p, p.number), state, branch, headSha, base, author: { login: pr.createdBy?.uniqueName || pr.createdBy?.id || null } };
  if (state !== 'OPEN') return { pr, facts, closed: true };
  const [threadList, statusList, evaluations, baseSha] = await Promise.all([
    withThreads ? adoFetch('read', `${prApi(p)}/threads`, { env }).then((r) => r.json?.value) : [],
    adoFetch('read', `${prApi(p)}/statuses`, { env }).then((r) => r.json?.value),
    listEvaluations(p, projectId, env),
    base ? optional(baseTip(p, base, pr.lastMergeTargetCommit?.commitId || null, env), pr.lastMergeTargetCommit?.commitId || null) : null,
  ]);
  if (!Array.isArray(threadList) || !Array.isArray(statusList)) throw fail('failed', 'malformed Azure DevOps listing');
  const [baseRes, behind] = await Promise.all([
    baseResults(p, { base, baseSha, evaluations, env }),
    baseSha ? optional(behindBy(p, baseSha, headSha, env), 0) : 0,
  ]);
  return { pr, facts: { ...facts, baseSha }, threadList, evaluations, baseRes, behind,
    contexts: checksOf(p, evaluations, statusList, headSha) };
}

/**
 * { ok, pr } for a watched Azure PR, in the gh snapshot's shape: the facts, base, baseSha (live tip), mergeable,
 * behindBy and the base head's results, the checks, the unresolved threads and the rejecting votes. Comment ids are
 * per thread in Azure, so a comment's key is "<thread>.<comment>". A reviewer's Rejected or Waiting-for-author vote
 * is a changes-requested review keyed by reviewer and vote: it fires once, and again only after the vote changes.
 */
export async function prWatchSnapshot({ prUrl, env = process.env } = {}) {
  const p = parseAzurePrUrl(prUrl);
  if (!p) return { ok: false, class: 'failed', error: 'invalid Azure DevOps pull request URL' };
  try {
    const r = await readPr(p, env);
    if (!r) return { ok: false, class: 'failed', error: 'malformed Azure DevOps pull request' };
    if (r.closed) return { ok: true, pr: { ...r.facts, contexts: [], threads: [], reviews: [] } };
    const threads = r.threadList.filter((t) => t && !t.isDeleted && Number.isSafeInteger(t.id)).map((t) => ({
      nodeId: t.id, isResolved: !UNRESOLVED.has(t.status),
      comments: (t.comments || []).filter((c) => c && !c.isDeleted && c.commentType === 'text' && Number.isSafeInteger(c.id))
        .map((c) => ({ databaseId: `${t.id}.${c.id}`, body: String(c.content || ''), ...member(c.author) })),
    }));
    const reviews = rejecting(r.pr).map((x) => ({ databaseId: `${x.id}:${x.vote}`, state: 'CHANGES_REQUESTED',
      body: `${x.displayName || x.uniqueName || 'A reviewer'} voted "${VOTE[x.vote]}".`, ...member(x) }));
    return { ok: true, pr: { ...r.facts, mergeable: MERGE[r.pr.mergeStatus] || 'UNKNOWN', behindBy: r.behind,
      baseFailing: r.baseRes.failing, basePassing: r.baseRes.passing, basePending: r.baseRes.pending, baseSettled: r.baseRes.settled,
      contexts: r.contexts, threads, reviews } };
  } catch (e) { return watchFailure(e); }
}

const rejecting = (pr) => (Array.isArray(pr?.reviewers) ? pr.reviewers : []).filter((r) => r && !r.isContainer && VOTE[r.vote]);

/**
 * The PR card's raw facts for git-info's prChecks: the checks in the rollup's item shape, mergeability, the review
 * decision and merge state in GitHub's terms, the draft flag, the base name and the checks failing on the base head.
 *   reviewDecision: a rejecting vote → CHANGES_REQUESTED; a blocking reviewer policy not yet met → REVIEW_REQUIRED.
 *   mergeState: any other blocking policy not yet approved (linked work items, comment resolution, …) → BLOCKED;
 *   all approved and Azure's merge check succeeded → CLEAN; otherwise unknown. Azure never requires an up-to-date branch.
 * null on any failure. Never throws.
 */
export async function prCheckFacts({ prUrl, env = process.env } = {}) {
  const p = parseAzurePrUrl(prUrl);
  if (!p) return null;
  try {
    const r = await readPr(p, env, { threads: false });
    if (!r || r.closed) return null;
    const items = r.contexts.map((c) => (c.type === 'check'
      ? { __typename: 'CheckRun', name: c.name, status: c.status, conclusion: c.conclusion }
      : { __typename: 'StatusContext', context: c.context, state: c.state }));
    const blocking = r.evaluations.filter((ev) => live(ev) && ev.configuration.isBlocking === true);
    const reviewerIds = new Set([POLICY.minReviewers, POLICY.requiredReviewers]);
    const checkIds = new Set([POLICY.build, POLICY.status]);
    const reviewDecision = rejecting(r.pr).length ? 'CHANGES_REQUESTED'
      : blocking.some((ev) => reviewerIds.has(ev.configuration.type?.id) && ev.status !== 'approved') ? 'REVIEW_REQUIRED' : null;
    const others = blocking.filter((ev) => !reviewerIds.has(ev.configuration.type?.id) && !checkIds.has(ev.configuration.type?.id));
    const mergeState = others.some((ev) => ev.status !== 'approved') ? 'BLOCKED' : r.pr.mergeStatus === 'succeeded' ? 'CLEAN' : null;
    return { items, mergeable: MERGE[r.pr.mergeStatus] || 'UNKNOWN', mergeState, reviewDecision, draft: r.pr.isDraft === true,
      base: r.facts.base, baseFailing: r.baseRes.failing };
  } catch { return null; }
}

/**
 * The failed tasks of one build: each task's name, its error issues and the last lines of its log (timestamps cut).
 * Raw text: the caller redacts and caps it. Reading builds needs the Build (Read) scope on the read token.
 */
export async function failedBuildLog({ prUrl, databaseId, env = process.env } = {}) {
  const p = parseAzurePrUrl(prUrl);
  if (!p || !Number.isSafeInteger(databaseId) || databaseId <= 0) return { ok: false, class: 'failed', error: 'invalid build log request' };
  try {
    const build = `${projectApi(p)}/build/builds/${databaseId}`;
    const { json } = await adoFetch('read', `${build}/timeline`, { env });
    const failed = (Array.isArray(json?.records) ? json.records : []).filter((r) => r?.type === 'Task' && r.result === 'failed');
    const parts = [];
    for (const r of failed) {
      const issues = (r.issues || []).filter((i) => i?.type === 'error').map((i) => i.message);
      let log = '';
      if (Number.isSafeInteger(r.log?.id)) {
        const { text } = await adoFetch('read', `${build}/logs/${r.log.id}`, { env, text: true });
        log = text.split(/\r?\n/).map((l) => l.replace(/^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '')).slice(-LOG_LINES).join('\n');
      }
      parts.push([`## ${r.name || 'Task'}`, ...issues, log].filter(Boolean).join('\n'));
    }
    return { ok: true, text: parts.join('\n\n') };
  } catch (e) { return watchFailure(e); }
}

/** Re-queue a build validation policy (`runId` is its evaluation id): one more build before a fix, like a re-run. */
export async function requeueEvaluation({ prUrl, runId, env = process.env } = {}) {
  const p = parseAzurePrUrl(prUrl);
  if (!p || typeof runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(runId)) return { ok: false, class: 'failed', error: 'invalid re-queue request' };
  try {
    await adoFetch('write', `${projectApi(p)}/policy/evaluations/${runId}`, { method: 'PATCH', env, version: PREVIEW });
    return { ok: true };
  } catch (e) { return watchFailure(e); }
}

/** Reply on a review thread (it stays open: the reviewer resolves it). */
export async function replyToThread({ prUrl, threadId, body, env = process.env } = {}) {
  const p = parseAzurePrUrl(prUrl);
  if (!p || !Number.isSafeInteger(Number(threadId))) return { ok: false, class: 'failed', error: 'invalid thread reply request' };
  try {
    await adoFetch('write', `${prApi(p)}/threads/${Number(threadId)}/comments`, { method: 'POST', env,
      body: { content: String(body || ''), parentCommentId: 1, commentType: 1 } });
    return { ok: true };
  } catch (e) { return watchFailure(e); }
}

/** A PR-level comment: a new thread created closed, so it never blocks a comment-resolution policy. */
export async function prComment({ prUrl, body, env = process.env } = {}) {
  const p = parseAzurePrUrl(prUrl);
  if (!p) return { ok: false, class: 'failed', error: 'invalid Azure DevOps pull request URL' };
  try {
    await adoFetch('write', `${prApi(p)}/threads`, { method: 'POST', env,
      body: { comments: [{ parentCommentId: 0, content: String(body || ''), commentType: 1 }], status: 4 } });
    return { ok: true };
  } catch (e) { return watchFailure(e); }
}
