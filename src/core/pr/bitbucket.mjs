// src/core/pr/bitbucket.mjs
// Bitbucket Cloud pull requests over REST 2.0 (fetch; no CLI). The PR half of Ship-it and Watch PR for a base remote
// on bitbucket.org — git-info.mjs dispatches here by forge, beside pr/azure.mjs, and every answer keeps that module's
// shapes and export names. Auth from bitbucket-credentials.mjs; the header only ever goes to api.bitbucket.org.
//
/** @typedef {import('./azure.mjs').PrCreateResult} PrCreateResult */
import { bitbucketAuthHeader, readBitbucketCredentials } from '../bitbucket-credentials.mjs';
import { bitbucketPrUrl, parseBitbucketPrUrl } from '../../shared/bitbucket-remote.mjs';
import { sameRepo } from '../forge.mjs';

export const API_ORIGIN = 'https://api.bitbucket.org';
export const BITBUCKET_TIMEOUT_MS = 20_000;
const STATE = { OPEN: 'OPEN', MERGED: 'MERGED', DECLINED: 'CLOSED', SUPERSEDED: 'CLOSED' };
// Without a state filter the listing answers OPEN pull requests only.
const ALL_STATES = 'state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED';
const MAX_REDIRECTS = 3;
const SHA_RE = /^[0-9a-f]{7,64}$/i;
const enc = encodeURIComponent;
// Memos that keep a watched PR's poll small (Bitbucket allows about 1,000 API requests an hour per token): the merge
// verdict of a source/destination commit pair (it never changes) and, for 10 minutes, a repository's visibility.
const mergeMemo = new Map();
const privacy = new Map();
const MEMO_MAX = 500;
const PRIVACY_TTL_MS = 10 * 60_000;
const remember = (map, key, value) => { if (map.size >= MEMO_MAX) map.clear(); map.set(key, value); return value; };

let _fetch = (...a) => globalThis.fetch(...a);
export const _testing = {
  setFetch(fn) { _fetch = typeof fn === 'function' ? fn : (...a) => globalThis.fetch(...a); mergeMemo.clear(); privacy.clear(); },
  reset() { _fetch = (...a) => globalThis.fetch(...a); mergeMemo.clear(); privacy.clear(); },
};

const repoApi = (r) => `${API_ORIGIN}/2.0/repositories/${enc(r.owner)}/${enc(r.repo)}`;
const prApi = (p) => `${repoApi(p)}/pullrequests/${p.number}`;
const fail = (kind, message, extra = {}) => Object.assign(new Error(message), { kind, ...extra });
/** A BBQL string literal. */
const lit = (s) => `"${String(s).replace(/[\\"]/g, (c) => `\\${c}`)}"`;
const fullName = (r) => `${r.owner}/${r.repo}`.toLowerCase();
/** A PR whose source branch lives in the base repository (a fork's same-named branch is not ours). */
const ownSource = (pr, r) => String(pr?.source?.repository?.full_name || '').toLowerCase() === fullName(r);

/**
 * One REST call to api.bitbucket.org. Throws Error{kind:'auth'|'network'|'timeout'|'failed', status?, body?}.
 * Redirects are followed by hand (at most 3): a hop on api.bitbucket.org keeps the auth header; a hop to another host
 * (a step log on storage) is followed only with `foreignRedirect` and never carries it. `text: true` reads the body as
 * text into `text`.
 */
export async function bbFetch(role, url, { method = 'GET', body, env = process.env, text = false,
  auth = bitbucketAuthHeader(role, env), timeoutMs = BITBUCKET_TIMEOUT_MS, foreignRedirect = false } = {}) {
  if (!auth) throw fail('auth', 'no Bitbucket credential: set WORCA_BB_TOKEN where worca runs');
  if (!String(url).startsWith(`${API_ORIGIN}/`)) throw fail('failed', 'not a Bitbucket API URL');
  const signal = AbortSignal.timeout(timeoutMs);
  const accept = text ? '*/*' : 'application/json';
  let res;
  let at = String(url);
  try {
    for (let hop = 0; ; hop++) {
      const own = new URL(at).origin === API_ORIGIN;
      res = await _fetch(at, {
        method, redirect: 'manual', signal,
        headers: own ? { accept, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...auth } : { accept },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const loc = res.status >= 300 && res.status < 400 && method === 'GET' ? res.headers?.get?.('location') : null;
      if (!loc) break;
      if (hop >= MAX_REDIRECTS) throw fail('failed', 'Bitbucket redirected too many times');
      const next = new URL(loc, at);
      if (next.protocol !== 'https:') throw fail('failed', 'Bitbucket redirected off https');
      if (next.origin !== API_ORIGIN && !foreignRedirect) throw fail('failed', `Bitbucket redirected to ${next.host}`);
      try { await res.body?.cancel?.(); } catch { /* the redirect's own body is never read */ }
      at = next.href;
    }
  } catch (e) {
    if (e?.kind) throw e;
    throw fail(e?.name === 'TimeoutError' ? 'timeout' : 'network', `Bitbucket unreachable: ${e?.message || e}`);
  }
  if (res.status === 401) throw fail('auth', 'Bitbucket refused the token (expired, revoked, or missing a scope)', { status: 401 });
  if (text && res.ok) return { status: res.status, text: String(await res.text()) };
  let json = null;
  if (res.status !== 204) { try { json = await res.json(); } catch { json = null; } }
  if (!res.ok) {
    const msg = typeof json?.error?.message === 'string' ? json.error.message : '';
    throw fail(res.status === 403 ? 'auth' : 'failed', `Bitbucket ${res.status}${msg ? `: ${msg}` : ''}`, { status: res.status, body: json });
  }
  return { status: res.status, json };
}

/** Every page of a paged listing (`values` + `next`), at most `maxPages`. `complete` is false when pages ran out. */
async function listAll(role, url, { env, maxPages = 10 } = {}) {
  const values = [];
  let next = url;
  for (let page = 0; next && page < maxPages; page++) {
    const { json } = await bbFetch(role, next, { env });
    values.push(...(Array.isArray(json?.values) ? json.values : []));
    next = typeof json?.next === 'string' ? json.next : null;
  }
  return { values, complete: !next };
}

const toPr = (coords, pr) => ({
  state: STATE[pr?.state] || null,
  url: bitbucketPrUrl(coords, pr?.id),
  number: Number.isInteger(pr?.id) ? pr.id : null,
  isDraft: pr?.draft === true,
  mergeable: 'UNKNOWN',
});

/**
 * MERGEABLE | CONFLICTING | UNKNOWN for an OPEN PR (D4): the PR's file conflicts (`pullrequests/<id>/conflicts`, which
 * redirects to `file-conflicts/<src>%0D<dst>`) list each file the merge would conflict on, at the PR's current source
 * and destination commits. (The `diffstat?merge=true` preview merge this used to read answers 410 since Bitbucket's
 * CHANGE-3407.) A verdict is memoised per commit pair. Throws only a 429 (the watcher backs off on it); any other
 * failure, or a commit that is not a sha, is UNKNOWN.
 */
async function mergeableOf(p, number, src, dst, env) {
  if (!Number.isSafeInteger(number) || number <= 0) return 'UNKNOWN';
  if (!SHA_RE.test(String(src || '')) || !SHA_RE.test(String(dst || ''))) return 'UNKNOWN';
  const key = `${fullName(p)}#${src}..${dst}`.toLowerCase();
  if (mergeMemo.has(key)) return mergeMemo.get(key);
  try {
    const { values, complete } = await listAll('read', `${repoApi(p)}/pullrequests/${number}/conflicts?pagelen=100`, { env, maxPages: 10 });
    if (values.length) return remember(mergeMemo, key, 'CONFLICTING');
    return complete ? remember(mergeMemo, key, 'MERGEABLE') : 'UNKNOWN';
  } catch (e) {
    if (e?.status === 429) throw e;
    return 'UNKNOWN';
  }
}
const commitOf = (side) => side?.commit?.hash;

export function forkRefusal(baseRepo) {
  return `Bitbucket pull requests between repositories (forks) are not supported yet — push to ${baseRepo?.name || 'the base remote'}.`;
}

/** { ok } | { ok:false, reason } — no network. */
export async function available({ env = process.env } = {}) {
  return readBitbucketCredentials(env).mode !== 'none'
    ? { ok: true }
    : { ok: false, reason: 'Bitbucket is not configured: set WORCA_BB_TOKEN (an access token, or an Atlassian API token with WORCA_BB_EMAIL) with Repositories and Pull requests: Read & Write, and Pipelines: Read, where worca runs' };
}

async function openPr(baseRepo, head, base, env) {
  const filter = `source.branch.name=${lit(head)} AND destination.branch.name=${lit(base)}`;
  const { json } = await bbFetch('read', `${repoApi(baseRepo)}/pullrequests?state=OPEN&pagelen=50&q=${enc(filter)}`, { env });
  const pr = (Array.isArray(json?.values) ? json.values : []).find((x) => ownSource(x, baseRepo));
  return pr ? toPr(baseRepo, pr) : null;
}

/** @returns {Promise<PrCreateResult>} */
export async function createPr({ base, head, title, body = '', baseRepo, pushRepo = null, draft = false, env = process.env }) {
  if (baseRepo?.host !== 'bitbucket.org' || !baseRepo.owner || !baseRepo.repo) {
    return { ok: false, kind: 'failed', error: 'the base remote is not a Bitbucket repository' };
  }
  if (pushRepo && !sameRepo(pushRepo, baseRepo)) return { ok: false, kind: 'unsupported', error: forkRefusal(baseRepo) };
  try {
    // An open PR for this branch pair is reused as-is (Bitbucket answers a duplicate create with an error).
    const found = await openPr(baseRepo, head, base, env);
    if (found) return { ok: true, url: found.url, number: found.number, existed: true };
    const payload = {
      title: title || head, description: body || title || head,
      source: { branch: { name: head } }, destination: { branch: { name: base } },
      ...(draft === true ? { draft: true } : {}),
    };
    const { json } = await bbFetch('write', `${repoApi(baseRepo)}/pullrequests`, { method: 'POST', body: payload, env });
    if (!Number.isInteger(json?.id)) return { ok: false, kind: 'failed', error: 'Bitbucket answered without a pull request id' };
    return { ok: true, url: bitbucketPrUrl(baseRepo, json.id), number: json.id, existed: false };
  } catch (e) {
    if (e.status === 400 || e.status === 409) {
      const found = await openPr(baseRepo, head, base, env).catch(() => null);
      if (found) return { ok: true, url: found.url, number: found.number, existed: true };
    }
    return { ok: false, kind: e.kind === 'auth' ? 'auth' : 'failed', error: e.message };
  }
}

/** { state: OPEN|MERGED|CLOSED, url, number, isDraft, mergeable } | null — never throws. `withMergeable` reads the
 *  file conflicts of an OPEN PR (one more call); otherwise mergeable is UNKNOWN. */
export async function viewPr({ prUrl, withMergeable = false, env = process.env }) {
  const p = parseBitbucketPrUrl(prUrl);
  if (!p) return null;
  try {
    const { json } = await bbFetch('read', prApi(p), { env });
    const pr = toPr(p, json);
    if (!pr.state || pr.number == null) return null;
    return withMergeable && pr.state === 'OPEN'
      ? { ...pr, mergeable: await mergeableOf(p, pr.number, commitOf(json.source), commitOf(json.destination), env) } : pr;
  } catch { return null; }
}

/** { state: OPEN|MERGED, url, number, isDraft, mergeable } | null — OPEN first, then MERGED, like the GitHub lookup;
 *  `includeClosed` adds the newest declined or superseded PR (CLOSED). Never throws. */
export async function findPrForBranch({ head, baseRepo, includeClosed = false, withMergeable = false, env = process.env }) {
  if (!head || !baseRepo?.owner || !baseRepo?.repo) return null;
  try {
    const url = `${repoApi(baseRepo)}/pullrequests?${ALL_STATES}&sort=-created_on&pagelen=30&q=${enc(`source.branch.name=${lit(head)}`)}`;
    const { json } = await bbFetch('read', url, { env });
    const raw = (Array.isArray(json?.values) ? json.values : []).filter((x) => ownSource(x, baseRepo));
    const pick = (state) => raw.find((x) => toPr(baseRepo, x).state === state);
    const hit = pick('OPEN') || pick('MERGED') || (includeClosed && pick('CLOSED')) || null;
    if (!hit) return null;
    const pr = toPr(baseRepo, hit);
    return withMergeable && pr.state === 'OPEN'
      ? { ...pr, mergeable: await mergeableOf(baseRepo, pr.number, commitOf(hit.source), commitOf(hit.destination), env) } : pr;
  } catch { return null; }
}

/**
 * The PRs (every state) whose source branch is one of `branches`, as raw API objects (team metrics). BBQL ORs at most
 * 10 branches per query. Throws bbFetch errors (metrics status). `complete` is false when a query's pages ran out.
 * @returns {Promise<{ prs: object[], complete: boolean }>}
 */
export async function listPullRequestsForBranches(coords, branches, { maxPages = 5, env = process.env } = {}) {
  const list = [...new Set(branches)].filter((b) => typeof b === 'string' && b);
  const prs = [];
  let complete = true;
  for (let i = 0; i < list.length; i += 10) {
    const filter = list.slice(i, i + 10).map((b) => `source.branch.name=${lit(b)}`).join(' OR ');
    const r = await listAll('read', `${repoApi(coords)}/pullrequests?${ALL_STATES}&pagelen=50&q=${enc(filter)}`, { env, maxPages });
    prs.push(...r.values.filter((x) => ownSource(x, coords)));
    complete &&= r.complete;
  }
  return { prs, complete };
}

const iso = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);

/** When a MERGED PR merged (D8): closed_on, else its merge commit's date, else updated_on. Never throws. */
export async function mergedAt(coords, pr, { env = process.env } = {}) {
  if (iso(pr?.closed_on)) return pr.closed_on;
  const sha = pr?.merge_commit?.hash;
  if (typeof sha === 'string' && /^[0-9a-f]{7,64}$/i.test(sha)) {
    try {
      const { json } = await bbFetch('read', `${repoApi(coords)}/commit/${enc(sha)}`, { env });
      if (iso(json?.date)) return json.date;
    } catch { /* fall back */ }
  }
  return iso(pr?.updated_on);
}

/** D24: mark a draft PR ready for review. The PUT carries the title (an update must) and the description and reviewers
 *  as read, so the update cannot clear them. */
export async function markReady({ prUrl, env = process.env } = {}) {
  const p = parseBitbucketPrUrl(prUrl);
  if (!p) return { ok: false, error: 'invalid Bitbucket pull request URL' };
  try {
    const { json } = await bbFetch('read', prApi(p), { env });
    if (json?.draft !== true) return { ok: true };
    const reviewers = (Array.isArray(json.reviewers) ? json.reviewers : []).filter((r) => r?.uuid).map((r) => ({ uuid: r.uuid }));
    await bbFetch('write', prApi(p), { method: 'PUT', env,
      body: { title: json.title, description: typeof json.description === 'string' ? json.description : '', reviewers, draft: false } });
    return { ok: true };
  } catch (e) { return watchFailure(e); }
}

/** D24: close a PR (declined), after a PR-level comment saying why. */
export async function closePr({ prUrl, comment = '', env = process.env } = {}) {
  const p = parseBitbucketPrUrl(prUrl);
  if (!p) return { ok: false, error: 'invalid Bitbucket pull request URL' };
  if (comment) { const c = await prComment({ prUrl, body: comment, env }); if (!c.ok) return c; }
  try { await bbFetch('write', `${prApi(p)}/decline`, { method: 'POST', env }); return { ok: true }; }
  catch (e) { return watchFailure(e); }
}

// Bitbucket's Markdown escapes HTML, so pr-watch's `<!-- worca:pr-watch -->` marker would show as text in every reply.
// Outgoing bodies carry a link-reference marker instead, which Bitbucket renders as nothing, and get a blank line
// before a list (Bitbucket needs one, GitHub does not); incoming bodies map it back, so countsAsRequest still knows
// worca's own replies. HTML_WATCH_MARKER is pr-watch's WATCH_MARKER (not imported: pr-watch -> git-info -> here).
export const HTML_WATCH_MARKER = '<!-- worca:pr-watch -->';
export const BB_WATCH_MARKER = '[//]: # (worca:pr-watch)';
export const toBitbucketMarkdown = (body) => String(body || '')
  .replace(HTML_WATCH_MARKER, BB_WATCH_MARKER)
  .replace(/([^\n])\n(- )/, '$1\n\n$2');
const fromBitbucketMarkdown = (raw) => String(raw || '').replace(BB_WATCH_MARKER, HTML_WATCH_MARKER);

/** A PR-level comment. */
export async function prComment({ prUrl, body, env = process.env } = {}) {
  const p = parseBitbucketPrUrl(prUrl);
  if (!p) return { ok: false, class: 'failed', error: 'invalid Bitbucket pull request URL' };
  try {
    await bbFetch('write', `${prApi(p)}/comments`, { method: 'POST', env, body: { content: { raw: toBitbucketMarkdown(body) } } });
    return { ok: true };
  } catch (e) { return watchFailure(e); }
}

const watchFailure = (e) => ({ ok: false, class: e?.status === 429 ? 'rate-limit' : e?.kind === 'auth' ? 'auth' : 'failed',
  error: e?.message || String(e) });

// ── Watch PR (#619 parity) ──────────────────────────────────────────────────
// The Bitbucket half of the PR watch adapter. Each answer is the snapshot shape pr-watch.mjs's collectTriggers reads
// (the GitHub field names), so the watcher stays forge-blind. Failures are { ok:false, class:'rate-limit'|'auth'|
// 'failed', error }, like the gh and Azure adapters'.

const STATUS_STATE = { SUCCESSFUL: 'SUCCESS', FAILED: 'FAILURE', INPROGRESS: 'PENDING', STOPPED: 'ERROR' };
// A Bitbucket Pipelines status links its result page, in either form Bitbucket has used:
// https://bitbucket.org/<ws>/<repo>/pipelines/results/<n> or https://bitbucket.org/<ws>/<repo>/addon/pipelines/home#!/results/<n>.
const PIPELINE_URL_RE = /^https:\/\/bitbucket\.org\/([^/?#]+)\/([^/?#]+)\/(?:addon\/pipelines\/home#!\/|pipelines\/)results\/(\d+)(?:[/?#]|$)/i;
// Pipelines names its status after the build ("Pipeline #41 for feat/x"): a new name on every run and on the base
// branch. Every Pipelines status therefore gets this one stable name, and only the newest build of a commit counts.
export const PIPELINES_CHECK = 'Bitbucket Pipelines';
const PIPELINE_NAME_RE = /^Pipeline #\d+\b/;
const LOG_LINES = 200;
/** A best-effort read: the snapshot still answers without it; a 429 is never swallowed. */
const optional = (promise, fallback) => promise.catch((e) => { if (e?.status === 429) throw e; return fallback; });
/** The build number of a Pipelines status of repository `p` (its result link), else null. */
function pipelineNo(p, s) {
  const m = PIPELINE_URL_RE.exec(String(s?.url || ''));
  return m && `${m[1]}/${m[2]}`.toLowerCase() === fullName(p) ? Number(m[3]) : null;
}
const statusName = (p, s) => (pipelineNo(p, s) != null || PIPELINE_NAME_RE.test(String(s?.name || ''))
  ? PIPELINES_CHECK : String(s?.name || s?.key || ''));
/** One status per name: for Pipelines the newest build (a re-run is a new build on the same commit), else the newest update. */
function latestByName(p, statuses) {
  const rank = (s) => [pipelineNo(p, s) ?? -1, Date.parse(s?.updated_on || '') || 0];
  const newer = (a, b) => { const [x, y] = [rank(a), rank(b)]; return x[0] !== y[0] ? x[0] > y[0] : x[1] > y[1]; };
  const out = new Map();
  for (const s of statuses) { const n = statusName(p, s); if (!out.has(n) || newer(s, out.get(n))) out.set(n, s); }
  return [...out.values()];
}

/** A branch's full tip sha (the PR object carries an abbreviated one). */
async function branchTip(p, branch, env) {
  const { json } = await bbFetch('read', `${repoApi(p)}/refs/branches?q=${enc(`name=${lit(branch)}`)}`, { env });
  const hit = (Array.isArray(json?.values) ? json.values : []).find((b) => b?.name === branch);
  return typeof hit?.target?.hash === 'string' ? hit.target.hash : null;
}

async function statusesAt(p, sha, env) {
  const { values } = await listAll('read', `${repoApi(p)}/commit/${enc(sha)}/statuses?pagelen=100`, { env, maxPages: 3 });
  return latestByName(p, values.filter((s) => s && typeof s.key === 'string'));
}

/** Commit statuses as checks (D5): a Pipelines status with a result link is a `check` whose step log is readable;
 *  others are `status`es. */
function contextsOf(p, statuses, headSha) {
  return statuses.map((s) => {
    const state = STATUS_STATE[s.state] || 'PENDING';
    const n = pipelineNo(p, s);
    if (n != null) {
      return { type: 'check', databaseId: n, name: statusName(p, s), isRequired: false, runId: null,
        status: state === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED',
        conclusion: state === 'PENDING' ? null : state === 'SUCCESS' ? 'SUCCESS' : 'FAILURE', detailsUrl: s.url };
    }
    return { type: 'status', context: statusName(p, s), state, targetUrl: s.url || null, isRequired: false, headSha };
  });
}
const failedContext = (c) => (c.type === 'check' ? c.conclusion === 'FAILURE' : c.state === 'FAILURE' || c.state === 'ERROR');
const NO_BASE = Object.freeze({ failing: [], passing: [], pending: [], settled: true });

/** The base branch head's statuses, by the same names; `settled` once none still runs. Best effort. */
async function baseResults(p, baseSha, env) {
  const sets = { failing: new Set(), passing: new Set(), pending: new Set() };
  if (baseSha) {
    for (const s of await optional(statusesAt(p, baseSha, env), [])) {
      const st = STATUS_STATE[s.state] || 'PENDING';
      sets[st === 'PENDING' ? 'pending' : st === 'SUCCESS' ? 'passing' : 'failing'].add(statusName(p, s));
    }
  }
  return { failing: [...sets.failing], passing: [...sets.passing], pending: [...sets.pending], settled: sets.pending.size === 0 };
}

/** How many base commits the PR head lacks (one page, so at most 100; 0 when unknown). */
async function behindBy(p, baseSha, headSha, env) {
  const { json } = await bbFetch('read', `${repoApi(p)}/commits?include=${enc(baseSha)}&exclude=${enc(headSha)}&pagelen=100`, { env });
  return Array.isArray(json?.values) ? json.values.length : 0;
}

/** Whether the repository is private, memoised for 10 minutes (one read per repository, not one per poll). */
async function repoIsPrivate(p, env) {
  const hit = privacy.get(fullName(p));
  if (hit && Date.now() - hit.at < PRIVACY_TTL_MS) return hit.priv;
  const { json } = await bbFetch('read', `${repoApi(p)}?fields=is_private`, { env });
  return remember(privacy, fullName(p), { priv: json?.is_private === true, at: Date.now() }).priv;
}

// A comment whose author has no uuid gets this login, so it never equals a PR author's missing (null) login.
const NO_USER = '(unknown user)';

/** Comments grouped into threads by their root (Bitbucket has no thread objects). Draft (pending) comments are not
 *  posted yet; a deleted comment is skipped but keeps its thread. A thread is resolved when its root is. */
function threadsOf(comments, trustOf) {
  const live = comments.filter((c) => c && Number.isSafeInteger(c.id) && c.pending !== true).sort((a, b) => a.id - b.id);
  const byId = new Map(live.map((c) => [c.id, c]));
  const rootOf = (c) => {
    let x = c;
    for (let i = 0; i < 100 && Number.isSafeInteger(x?.parent?.id) && byId.has(x.parent.id); i++) x = byId.get(x.parent.id);
    return x;
  };
  const threads = new Map();
  for (const c of live) {
    const root = rootOf(c);
    if (!threads.has(root.id)) threads.set(root.id, { nodeId: root.id, isResolved: root.resolution != null, comments: [] });
    if (c.deleted === true) continue;
    threads.get(root.id).comments.push({ databaseId: c.id, body: fromBitbucketMarkdown(c.content?.raw),
      author: { login: c.user?.uuid || NO_USER }, authorAssociation: trustOf(c.user) });
  }
  return [...threads.values()];
}

/** The PR and everything the watch and the checks line read about it. `threads: false` skips comments and trust. */
async function readPr(p, env, { threads: withThreads = true } = {}) {
  const { json: pr } = await bbFetch('read', prApi(p), { env });
  const state = STATE[pr?.state]; const branch = pr?.source?.branch?.name; const base = pr?.destination?.branch?.name;
  if (!state || typeof branch !== 'string' || typeof base !== 'string' || !ownSource(pr, p)) return null;
  const facts = { url: bitbucketPrUrl(p, p.number), state, branch, base, author: { login: pr.author?.uuid || null } };
  if (state !== 'OPEN') return { pr, facts: { ...facts, headSha: pr.source?.commit?.hash || null }, closed: true };
  const [headSha, baseSha] = await Promise.all([branchTip(p, branch, env), optional(branchTip(p, base, env), null)]);
  if (!headSha) return null;
  const [statuses, comments, priv, mergeable] = await Promise.all([
    statusesAt(p, headSha, env),
    withThreads ? listAll('read', `${prApi(p)}/comments?pagelen=100`, { env }).then((r) => r.values) : [],
    withThreads ? optional(repoIsPrivate(p, env), false) : false,
    mergeableOf(p, p.number, headSha, baseSha, env),
  ]);
  const contexts = contextsOf(p, statuses, headSha);
  // The base head's results and how far behind the PR is only sort a finished failure (collectTriggers, the checks
  // line's "also failing on main"): without one, both reads are skipped to keep the poll small.
  const [baseRes, behind] = contexts.some(failedContext)
    ? await Promise.all([baseResults(p, baseSha, env), baseSha ? optional(behindBy(p, baseSha, headSha, env), 0) : 0])
    : [NO_BASE, 0];
  return { pr, facts: { ...facts, headSha, baseSha }, comments, priv, mergeable, baseRes, behind, contexts };
}

/**
 * { ok, pr } for a watched Bitbucket PR, in the gh snapshot's shape. Trust (D3): in a private repository every
 * commenter is a MEMBER; in a public one only the PR author and its listed reviewers are, so a stranger's comment never
 * starts a fix run. A participant's "changes requested" is a review keyed by user and state (D6).
 */
export async function prWatchSnapshot({ prUrl, env = process.env } = {}) {
  const p = parseBitbucketPrUrl(prUrl);
  if (!p) return { ok: false, class: 'failed', error: 'invalid Bitbucket pull request URL' };
  try {
    const r = await readPr(p, env);
    if (!r) return { ok: false, class: 'failed', error: 'malformed Bitbucket pull request (or a pull request from a fork)' };
    if (r.closed) return { ok: true, pr: { ...r.facts, contexts: [], threads: [], reviews: [] } };
    const reviewers = new Set((Array.isArray(r.pr.reviewers) ? r.pr.reviewers : []).map((x) => x?.uuid).filter(Boolean));
    // An app user (a bot or integration: Snyk, Sonar, …) is never trusted, private repository or not.
    const trustOf = (user) => (user?.type !== 'app_user'
      && (r.priv || (user?.uuid && (user.uuid === r.facts.author.login || reviewers.has(user.uuid)))) ? 'MEMBER' : 'NONE');
    const reviews = (Array.isArray(r.pr.participants) ? r.pr.participants : [])
      .filter((x) => x?.state === 'changes_requested' && x.user?.uuid)
      .map((x) => ({ databaseId: `${x.user.uuid}:changes_requested`, state: 'CHANGES_REQUESTED',
        body: `${x.user.display_name || x.user.nickname || 'A reviewer'} requested changes.`,
        author: { login: x.user.uuid }, authorAssociation: trustOf(x.user) }));
    return { ok: true, pr: { ...r.facts, mergeable: r.mergeable, behindBy: r.behind,
      baseFailing: r.baseRes.failing, basePassing: r.baseRes.passing, basePending: r.baseRes.pending, baseSettled: r.baseRes.settled,
      contexts: r.contexts, threads: threadsOf(r.comments, trustOf), reviews } };
  } catch (e) { return watchFailure(e); }
}

/**
 * The PR card's raw facts for git-info's prChecks, in GitHub's terms: a participant's "changes requested" →
 * CHANGES_REQUESTED. Bitbucket's merge checks (required approvals, passing builds) are not readable without admin, so
 * mergeState is unknown and the row never says "Ready to merge" or "Review required". null on any failure.
 */
export async function prCheckFacts({ prUrl, env = process.env } = {}) {
  const p = parseBitbucketPrUrl(prUrl);
  if (!p) return null;
  try {
    const r = await readPr(p, env, { threads: false });
    if (!r || r.closed) return null;
    const items = r.contexts.map((c) => (c.type === 'check'
      ? { __typename: 'CheckRun', name: c.name, status: c.status, conclusion: c.conclusion }
      : { __typename: 'StatusContext', context: c.context, state: c.state }));
    const changes = (Array.isArray(r.pr.participants) ? r.pr.participants : []).some((x) => x?.state === 'changes_requested');
    return { items, mergeable: r.mergeable, mergeState: null, reviewDecision: changes ? 'CHANGES_REQUESTED' : null,
      draft: r.pr.draft === true, base: r.facts.base, baseFailing: r.baseRes.failing };
  } catch { return null; }
}

/** A pipeline by its build number: the direct read first, else the newest pipelines listed. */
async function pipelineByNumber(p, n, env) {
  try {
    const { json } = await bbFetch('read', `${repoApi(p)}/pipelines/${n}`, { env });
    if (json?.build_number === n && typeof json.uuid === 'string') return json;
  } catch (e) { if (e?.status !== 404 && e?.status !== 400) throw e; }
  const { values } = await listAll('read', `${repoApi(p)}/pipelines/?sort=-created_on&pagelen=100`, { env, maxPages: 3 });
  return values.find((x) => x?.build_number === n && typeof x.uuid === 'string') || null;
}

/**
 * The failed steps of one pipeline (`databaseId` = its build number): each step's name and the last lines of its log.
 * Raw text: the caller redacts and caps it. A log may redirect to storage: followed without the credential (D9).
 */
export async function failedBuildLog({ prUrl, databaseId, env = process.env } = {}) {
  const p = parseBitbucketPrUrl(prUrl);
  if (!p || !Number.isSafeInteger(databaseId) || databaseId <= 0) return { ok: false, class: 'failed', error: 'invalid build log request' };
  try {
    const pipe = await pipelineByNumber(p, databaseId, env);
    if (!pipe) return { ok: false, class: 'failed', error: `Bitbucket pipeline #${databaseId} not found` };
    const steps = (await listAll('read', `${repoApi(p)}/pipelines/${enc(pipe.uuid)}/steps/?pagelen=100`, { env, maxPages: 2 })).values;
    const parts = [];
    for (const s of steps.filter((x) => ['FAILED', 'ERROR'].includes(x?.state?.result?.name) && typeof x.uuid === 'string')) {
      const { text } = await bbFetch('read', `${repoApi(p)}/pipelines/${enc(pipe.uuid)}/steps/${enc(s.uuid)}/log`, { env, text: true, foreignRedirect: true });
      parts.push([`## ${s.name || 'Step'}`, text.split(/\r?\n/).slice(-LOG_LINES).join('\n')].filter(Boolean).join('\n'));
    }
    return { ok: true, text: parts.join('\n\n') };
  } catch (e) { return watchFailure(e); }
}

/** Bitbucket checks carry no runId (D5), so the watcher never asks for a re-run; any call is refused. */
export async function requeueEvaluation() {
  return { ok: false, class: 'failed', error: 'Bitbucket checks cannot be re-run from worca' };
}

/** Reply on a review thread (`threadId` = its root comment id); it stays open for the reviewer. */
export async function replyToThread({ prUrl, threadId, body, env = process.env } = {}) {
  const p = parseBitbucketPrUrl(prUrl);
  const id = Number(threadId);
  if (!p || !Number.isSafeInteger(id) || id <= 0) return { ok: false, class: 'failed', error: 'invalid thread reply request' };
  try {
    await bbFetch('write', `${prApi(p)}/comments`, { method: 'POST', env, body: { content: { raw: toBitbucketMarkdown(body) }, parent: { id } } });
    return { ok: true };
  } catch (e) { return watchFailure(e); }
}
