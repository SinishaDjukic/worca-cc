// src/core/pr/gitea-family.mjs
// Pull requests on the Gitea family (Gitea, Forgejo, Codeberg) over REST v1 (fetch; no CLI): one implementation that
// pr/gitea.mjs, pr/forgejo.mjs and pr/codeberg.mjs bind with their forge key, host list, credentials and flavour.
// Every function keeps the shapes and export names of pr/azure.mjs and pr/bitbucket.mjs, so git-info.mjs dispatches by
// forge and the watcher stays forge-blind. Shapes verified against Gitea 28.3 and Forgejo 17 (Codeberg) captures.
/** @typedef {import('./azure.mjs').PrCreateResult} PrCreateResult */
import { giteaApiOrigin, giteaPrUrl, parseGiteaPrUrl } from '../../shared/gitea-remote.mjs';
import { sameRepo } from '../forge.mjs';

export const FAMILY_TIMEOUT_MS = 20_000;
const PAGE = 50;            // the default MAX_RESPONSE_ITEMS: a shorter page is the last one
const LOG_LINES = 200;
const SHA_RE = /^[0-9a-f]{7,64}$/i;
const WIP_RE = /^\s*(?:WIP:|\[WIP\])\s*/i;   // the default WORK_IN_PROGRESS_PREFIXES: a draft is a title prefix
const STATUS_STATE = { success: 'SUCCESS', failure: 'FAILURE', error: 'ERROR', pending: 'PENDING', warning: 'SUCCESS' };
const RUN_URL_RE = /\/actions\/runs\/(\d+)\/jobs\/(\d+)(?:[/?#]|$)/;
const NO_USER = '(unknown user)';
const NO_BASE = Object.freeze({ failing: [], passing: [], pending: [], settled: true });
const enc = encodeURIComponent;
const iso = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);

/**
 * Where Gitea and Forgejo answer differently. The Actions run model: a status links Gitea's run by its database id and
 * Forgejo's by index_in_repo; Gitea's job has a conclusion, Forgejo's a status that already holds success/failure. A reply inside a
 * review thread: Forgejo adds a comment to the review (POST /reviews/{id}/comments), Gitea has no such endpoint and
 * a comment on the same path and line in a new review joins the thread. Everything else worca uses is identical.
 */
export const FLAVOUR = Object.freeze({
  gitea: Object.freeze({ runNumber: (r) => r?.id, jobFailed: (j) => j?.conclusion === 'failure',
    stepFailed: (s) => s?.conclusion === 'failure', replyInReview: false }),
  forgejo: Object.freeze({ runNumber: (r) => r?.index_in_repo, jobFailed: (j) => j?.status === 'failure',
    stepFailed: (s) => s?.status === 'failure', replyInReview: true }),
});

/**
 * The PR functions of one forge. `hosts(env)` lists its hosts, `authHeader(role, host, env)` its REST header or null,
 * `configured(env)` says whether any host has a token, `configureHint` completes the "not configured" messages and
 * `tokenName(host)` names the variable that would hold one host's token.
 */
export function makeFamilyPr({ forge, label, flavour, hosts, authHeader, configured, configureHint, tokenName }) {
  let _fetch = (...a) => globalThis.fetch(...a);
  const _testing = {
    setFetch(fn) { _fetch = typeof fn === 'function' ? fn : (...a) => globalThis.fetch(...a); },
    reset() { _fetch = (...a) => globalThis.fetch(...a); },
    apiFetch: (...a) => apiFetch(...a),   // the URL guard, for tests; the bindings do not export apiFetch
  };

  const fail = (kind, message, extra = {}) => Object.assign(new Error(message), { kind, ...extra });
  const parse = (url, env) => parseGiteaPrUrl(url, hosts(env));
  const isHost = (r, env) => !!r?.host && hosts(env).includes(String(r.host).toLowerCase());
  const repoApi = (r) => `${giteaApiOrigin(r.host)}/repos/${enc(r.owner)}/${enc(r.repo)}`;
  const prApi = (p) => `${repoApi(p)}/pulls/${p.number}`;
  const issueApi = (p) => `${repoApi(p)}/issues/${p.number}`;
  const fullName = (r) => `${r.owner}/${r.repo}`.toLowerCase();
  /** A PR whose head lives in the base repository (a fork's same-named branch is not ours). */
  const ownHead = (pr, r) => String(pr?.head?.repo?.full_name || '').toLowerCase() === fullName(r);
  const stateOf = (pr) => (pr?.merged === true ? 'MERGED' : pr?.state === 'open' ? 'OPEN' : pr?.state === 'closed' ? 'CLOSED' : null);
  // mergeable is computed by the server after each push; null until then.
  const mergeableOf = (pr) => (pr?.mergeable === true ? 'MERGEABLE' : pr?.mergeable === false ? 'CONFLICTING' : 'UNKNOWN');
  const toPr = (coords, pr) => ({
    state: stateOf(pr), url: giteaPrUrl(coords, pr?.number), number: Number.isInteger(pr?.number) ? pr.number : null,
    isDraft: pr?.draft === true, mergeable: stateOf(pr) === 'OPEN' ? mergeableOf(pr) : 'UNKNOWN',
  });
  const watchFailure = (e) => ({ ok: false, class: e?.status === 429 ? 'rate-limit' : e?.kind === 'auth' ? 'auth' : 'failed',
    error: e?.message || String(e) });
  /** A best-effort read: the snapshot still answers without it; a 429 is never swallowed. */
  const optional = (promise, fallback) => promise.catch((e) => { if (e?.status === 429) throw e; return fallback; });

  /**
   * One REST call to `host`. Throws Error{kind:'auth'|'network'|'timeout'|'failed', status?, body?}. The URL must be
   * on that host's API, so the header never leaves it. `text: true` reads the body as text into `text`.
   */
  async function apiFetch(role, host, url, { method = 'GET', body, env = process.env, text = false, timeoutMs = FAMILY_TIMEOUT_MS } = {}) {
    if (!hosts(env).includes(String(host).toLowerCase())) throw fail('failed', `${host} is not a ${label} host worca knows`);
    const auth = authHeader(role, host, env);
    if (!auth) throw fail('auth', `no ${label} credential for ${host}: ${configureHint}`);
    if (!String(url).startsWith(`${giteaApiOrigin(host)}/`)) throw fail('failed', `not a ${label} API URL on ${host}`);
    let res;
    try {
      res = await _fetch(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: text ? '*/*' : 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...auth },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      throw fail(e?.name === 'TimeoutError' ? 'timeout' : 'network', `${label} ${host} unreachable: ${e?.message || e}`);
    }
    if (res.status === 401) throw fail('auth', `${label} ${host} refused the token (expired, revoked, or missing a scope)`, { status: 401 });
    if (text && res.ok) return { status: res.status, text: String(await res.text()), headers: res.headers };
    let json = null;
    if (res.status !== 204) { try { json = await res.json(); } catch { json = null; } }
    if (!res.ok) {
      // Messages differ between Gitea and Forgejo: callers key on `status`, the message is for people.
      const msg = typeof json?.message === 'string' ? json.message : '';
      throw fail(res.status === 403 ? 'auth' : 'failed', `${label} ${res.status}${msg ? `: ${msg}` : ''}`, { status: res.status, body: json });
    }
    return { status: res.status, json, headers: res.headers };
  }

  /** Every page of a listing (`page`/`limit`), at most `maxPages`; `key` names the array inside an object answer
   *  (Actions: workflow_runs). Both forges send X-Total-Count, which says when the listing is complete; without it a
   *  page shorter than the default page size is taken as the last (an instance may cap pages lower than 50).
   *  `complete` is false when pages ran out. */
  async function listAll(host, url, { env, maxPages = 10, key = null } = {}) {
    const values = [];
    for (let page = 1; page <= maxPages; page++) {
      const { json, headers } = await apiFetch('read', host, `${url}${url.includes('?') ? '&' : '?'}limit=${PAGE}&page=${page}`, { env });
      const items = key ? json?.[key] : json;
      values.push(...(Array.isArray(items) ? items : []));
      if (!Array.isArray(items) || items.length === 0) return { values, complete: true };
      const total = Number(headers?.get?.('x-total-count'));
      if (Number.isFinite(total) && total > 0 ? values.length >= total : items.length < PAGE) return { values, complete: true };
    }
    return { values, complete: false };
  }

  function forkRefusal(baseRepo) {
    return `${label} pull requests between repositories (forks) are not supported yet — push to ${baseRepo?.name || 'the base remote'}.`;
  }

  /** { ok } | { ok:false, reason } — no network. With a `host` (the base remote's), that host must have a token;
   *  without one, any listed host. */
  async function available({ host = null, env = process.env } = {}) {
    if (host) {
      return authHeader('read', host, env) ? { ok: true }
        : { ok: false, reason: `${label} host ${host} has no token: set ${tokenName(host)} where worca runs` };
    }
    return configured(env) ? { ok: true } : { ok: false, reason: `${label} is not configured: ${configureHint}` };
  }

  /** PRs whose head is `head` (every state, newest update first). `head=` narrows the listing on Forgejo and is ignored
   *  by Gitea, so the match is always made here as well. */
  async function prsByHead(coords, head, env, maxPages) {
    const r = await listAll(coords.host, `${repoApi(coords)}/pulls?state=all&sort=recentupdate&head=${enc(head)}`, { env, maxPages });
    return { prs: r.values.filter((x) => x?.head?.ref === head && ownHead(x, coords)), complete: r.complete };
  }

  /** A branch name as URL path segments: each segment encoded, the slashes kept (Gitea's PR route takes the head as
   *  a wildcard, so `#`, `?` and `%` in a name must not end or alter the path). */
  const branchPath = (name) => String(name).split('/').map(enc).join('/');

  /** The open PR for a head/base pair, else null. GET /pulls/{base}/{head} answers the pair's newest PR in any state
   *  (a merged one included) and takes the base as one path segment, so it settles the question only with an OPEN
   *  answer or a 404; otherwise the listing decides. */
  async function openPr(baseRepo, head, base, env) {
    if (!base.includes('/')) {
      try {
        const { json } = await apiFetch('read', baseRepo.host, `${repoApi(baseRepo)}/pulls/${enc(base)}/${branchPath(head)}`, { env });
        if (json && ownHead(json, baseRepo) && stateOf(json) === 'OPEN') return toPr(baseRepo, json);
      } catch (e) { if (e?.status === 404) return null; throw e; }
    }
    const { prs } = await prsByHead(baseRepo, head, env, 4);
    const hit = prs.find((x) => stateOf(x) === 'OPEN' && x.base?.ref === base);
    return hit ? toPr(baseRepo, hit) : null;
  }

  /** @returns {Promise<PrCreateResult>} */
  async function createPr({ base, head, title, body = '', baseRepo, pushRepo = null, draft = false, env = process.env }) {
    if (!isHost(baseRepo, env) || !baseRepo.owner || !baseRepo.repo) {
      return { ok: false, kind: 'failed', error: `the base remote is not a ${label} repository` };
    }
    if (pushRepo && !sameRepo(pushRepo, baseRepo)) return { ok: false, kind: 'unsupported', error: forkRefusal(baseRepo) };
    try {
      // An open PR for this branch pair is reused as-is (a duplicate create answers 409).
      const found = await openPr(baseRepo, head, base, env);
      if (found) return { ok: true, url: found.url, number: found.number, existed: true };
      // The create call has no draft field: a draft is the WIP: title prefix.
      const payload = { head, base, title: `${draft === true ? 'WIP: ' : ''}${title || head}`, body: body || '' };
      const { json } = await apiFetch('write', baseRepo.host, `${repoApi(baseRepo)}/pulls`, { method: 'POST', body: payload, env });
      if (!Number.isInteger(json?.number)) return { ok: false, kind: 'failed', error: `${label} answered without a pull request number` };
      return { ok: true, url: giteaPrUrl(baseRepo, json.number), number: json.number, existed: false };
    } catch (e) {
      if (e.status === 409) {
        // The pair has a PR after all (a race, or a by-branches 404 that lied): the listing is the authority.
        const found = await prsByHead(baseRepo, head, env, 4).then(({ prs }) => prs.find((x) => stateOf(x) === 'OPEN' && x.base?.ref === base)).catch(() => null);
        if (found) return { ok: true, url: giteaPrUrl(baseRepo, found.number), number: found.number, existed: true };
      }
      return { ok: false, kind: e.kind === 'auth' ? 'auth' : 'failed', error: e.message };
    }
  }

  /** { state: OPEN|MERGED|CLOSED, url, number, isDraft, mergeable } | null — never throws. The PR carries its own
   *  merge verdict, so `withMergeable` costs nothing and is accepted for the shared signature. */
  async function viewPr({ prUrl, env = process.env }) {
    const p = parse(prUrl, env);
    if (!p) return null;
    try {
      const { json } = await apiFetch('read', p.host, prApi(p), { env });
      const pr = toPr(p, json);
      return pr.state && pr.number != null ? pr : null;
    } catch { return null; }
  }

  /** { state: OPEN|MERGED, url, number, isDraft, mergeable } | null — OPEN first, then MERGED; `includeClosed` adds the
   *  newest closed unmerged PR. Never throws. */
  async function findPrForBranch({ head, baseRepo, includeClosed = false, env = process.env }) {
    if (!head || !isHost(baseRepo, env) || !baseRepo.owner || !baseRepo.repo) return null;
    try {
      const { prs } = await prsByHead(baseRepo, head, env, 4);
      const pick = (state) => prs.find((x) => stateOf(x) === state);
      const hit = pick('OPEN') || pick('MERGED') || (includeClosed && pick('CLOSED')) || null;
      return hit ? toPr(baseRepo, hit) : null;
    } catch { return null; }
  }

  /**
   * The PRs (every state) whose head is one of `branches`, as raw API objects (team metrics): one paged listing,
   * matched here. Throws apiFetch errors (metrics status). `complete` is false when pages ran out.
   * @returns {Promise<{ prs: object[], complete: boolean }>}
   */
  async function listPullRequestsForBranches(coords, branches, { maxPages = 5, env = process.env } = {}) {
    const want = new Set(branches.filter((b) => typeof b === 'string' && b));
    const r = await listAll(coords.host, `${repoApi(coords)}/pulls?state=all&sort=recentupdate`, { env, maxPages });
    return { prs: r.values.filter((x) => want.has(x?.head?.ref) && ownHead(x, coords)), complete: r.complete };
  }

  /** When a MERGED PR merged: merged_at, else its merge commit's date, else updated_at. Never throws. */
  async function mergedAt(coords, pr, { env = process.env } = {}) {
    if (iso(pr?.merged_at)) return pr.merged_at;
    const sha = pr?.merge_commit_sha;
    if (SHA_RE.test(String(sha || ''))) {
      try {
        const { json } = await apiFetch('read', coords.host, `${repoApi(coords)}/git/commits/${enc(sha)}`, { env });
        if (iso(json?.commit?.committer?.date)) return json.commit.committer.date;
      } catch { /* fall back */ }
    }
    return iso(pr?.updated_at);
  }

  /** Mark a draft PR ready: drop the WIP prefix from the title. An instance with custom prefixes is left alone. */
  async function markReady({ prUrl, env = process.env } = {}) {
    const p = parse(prUrl, env);
    if (!p) return { ok: false, error: `invalid ${label} pull request URL` };
    try {
      const { json } = await apiFetch('read', p.host, prApi(p), { env });
      if (json?.draft !== true) return { ok: true };
      const title = String(json.title || '').replace(WIP_RE, '');
      if (!title || title === json.title) return { ok: false, error: `${label} marks this draft with a prefix worca does not know; mark it ready on ${p.host}` };
      await apiFetch('write', p.host, prApi(p), { method: 'PATCH', env, body: { title } });
      return { ok: true };
    } catch (e) { return watchFailure(e); }
  }

  /** Close a PR, after a PR-level comment saying why. */
  async function closePr({ prUrl, comment = '', env = process.env } = {}) {
    const p = parse(prUrl, env);
    if (!p) return { ok: false, error: `invalid ${label} pull request URL` };
    if (comment) { const c = await prComment({ prUrl, body: comment, env }); if (!c.ok) return c; }
    try { await apiFetch('write', p.host, prApi(p), { method: 'PATCH', env, body: { state: 'closed' } }); return { ok: true }; }
    catch (e) { return watchFailure(e); }
  }

  /** A PR-level comment. The body is kept as is: the raw Markdown comes back unchanged from the API, so pr-watch's
   *  HTML marker survives. */
  async function prComment({ prUrl, body, env = process.env } = {}) {
    const p = parse(prUrl, env);
    if (!p) return { ok: false, class: 'failed', error: `invalid ${label} pull request URL` };
    try { await apiFetch('write', p.host, `${issueApi(p)}/comments`, { method: 'POST', env, body: { body } }); return { ok: true }; }
    catch (e) { return watchFailure(e); }
  }

  // ── Watch PR ──────────────────────────────────────────────────────────────
  // Each answer is the snapshot shape pr-watch.mjs's collectTriggers reads (the GitHub field names). Actions jobs show
  // up as commit statuses with context "<workflow> / <job> (<event>)" and a target link into the run, on both forges,
  // so checks come from statuses alone; a status with that link is a `check` whose log is readable.

  /** The run number of an Actions job status: its target link on this repository, which both flavours send as a path
   *  (/<owner>/<repo>/actions/runs/<n>/jobs/<j>), accepted as a full URL too. Else null. */
  const runOf = (p, s) => {
    const u = String(s?.target_url || '').toLowerCase();
    const m = RUN_URL_RE.exec(u);
    return m && (u.startsWith(`/${fullName(p)}/`) || u.startsWith(`https://${p.host}/${fullName(p)}/`)) ? Number(m[1]) : null;
  };
  /** One status per context: the newest (ids grow). */
  function latestByContext(statuses) {
    const out = new Map();
    for (const s of statuses) { const k = String(s.context); if (!out.has(k) || Number(s.id) > Number(out.get(k).id)) out.set(k, s); }
    return [...out.values()];
  }
  async function statusesAt(p, sha, env) {
    const { values } = await listAll(p.host, `${repoApi(p)}/commits/${enc(sha)}/statuses`, { env, maxPages: 3 });
    return latestByContext(values.filter((s) => s && typeof s.context === 'string'));
  }
  function contextsOf(p, statuses, headSha) {
    return statuses.map((s) => {
      const state = STATUS_STATE[s.status] || 'PENDING';
      const n = runOf(p, s);
      if (n != null) {
        return { type: 'check', databaseId: n, name: s.context, isRequired: false, runId: null,
          status: state === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED',
          conclusion: state === 'PENDING' ? null : state === 'SUCCESS' ? 'SUCCESS' : 'FAILURE', detailsUrl: s.target_url };
      }
      return { type: 'status', context: s.context, state, targetUrl: s.target_url || null, isRequired: false, headSha };
    });
  }
  const failedContext = (c) => (c.type === 'check' ? c.conclusion === 'FAILURE' : c.state === 'FAILURE' || c.state === 'ERROR');

  /** The base branch head's statuses, by the same names; `settled` once none still runs. Best effort. */
  async function baseResults(p, baseSha, env) {
    const sets = { failing: new Set(), passing: new Set(), pending: new Set() };
    if (baseSha) {
      for (const s of await optional(statusesAt(p, baseSha, env), [])) {
        const st = STATUS_STATE[s.status] || 'PENDING';
        sets[st === 'PENDING' ? 'pending' : st === 'SUCCESS' ? 'passing' : 'failing'].add(s.context);
      }
    }
    return { failing: [...sets.failing], passing: [...sets.passing], pending: [...sets.pending], settled: sets.pending.size === 0 };
  }

  /** How many base commits the PR head lacks (compare head...base). 0 when unknown. */
  async function behindBy(p, baseSha, headSha, env) {
    const { json } = await apiFetch('read', p.host, `${repoApi(p)}/compare/${enc(headSha)}...${enc(baseSha)}`, { env });
    return Number.isInteger(json?.total_commits) ? json.total_commits : 0;
  }

  /** Every inline comment of the PR's reviews, each tagged with its review id. One read per review that has comments. */
  async function reviewComments(p, reviews, env) {
    const out = [];
    for (const rv of reviews.filter((r) => Number.isSafeInteger(r?.id) && r.comments_count > 0)) {
      const { json } = await apiFetch('read', p.host, `${prApi(p)}/reviews/${rv.id}/comments`, { env });
      for (const c of Array.isArray(json) ? json : []) if (Number.isSafeInteger(c?.id)) out.push({ ...c, reviewId: rv.id });
    }
    return out.sort((a, b) => a.id - b.id);
  }

  /** Inline comments grouped into threads by path and line (the family has no thread objects; `position` is the new
   *  side, `original_position` the old side, one of them 0); a thread is resolved when its root carries a resolver.
   *  PR-level comments are threads of one, with a `c` prefix on their id. */
  async function threadsOf(p, reviews, env, trustOf) {
    const [inline, { values: issueComments }] = await Promise.all([reviewComments(p, reviews, env), listAll(p.host, `${issueApi(p)}/comments`, { env })]);
    const comment = (c) => ({ databaseId: c.id, body: String(c.body || ''), author: { login: c.user?.login || NO_USER }, authorAssociation: trustOf(c.user) });
    const threads = new Map();
    for (const c of inline) {
      const key = `${c.path}@${c.position}/${c.original_position}`;
      if (!threads.has(key)) threads.set(key, { nodeId: c.id, isResolved: c.resolver != null, comments: [] });
      threads.get(key).comments.push(comment(c));
    }
    const top = issueComments.filter((c) => Number.isSafeInteger(c?.id)).map((c) => ({ nodeId: `c${c.id}`, isResolved: false, comments: [comment(c)] }));
    return [...threads.values(), ...top];
  }

  /** The PR and everything the watch and the checks line read about it. */
  async function readPr(p, env) {
    const { json: pr } = await apiFetch('read', p.host, prApi(p), { env });
    const state = stateOf(pr); const branch = pr?.head?.ref; const base = pr?.base?.ref;
    if (!state || typeof branch !== 'string' || typeof base !== 'string' || !ownHead(pr, p)) return null;
    const facts = { url: giteaPrUrl(p, p.number), state, branch, base, author: { login: pr.user?.login || null } };
    const headSha = SHA_RE.test(String(pr.head?.sha || '')) ? pr.head.sha : null;
    if (state !== 'OPEN') return { pr, facts: { ...facts, headSha }, closed: true };
    if (!headSha) return null;
    const baseSha = SHA_RE.test(String(pr.base?.sha || '')) ? pr.base.sha : null;   // the base branch's current tip
    const [statuses, { values: reviews }] = await Promise.all([statusesAt(p, headSha, env), listAll(p.host, `${prApi(p)}/reviews`, { env })]);
    const contexts = contextsOf(p, statuses, headSha);
    // The base head's results and how far behind the PR is only sort a finished failure: without one both reads are skipped.
    const [baseRes, behind] = contexts.some(failedContext)
      ? await Promise.all([baseResults(p, baseSha, env), baseSha ? optional(behindBy(p, baseSha, headSha, env), 0) : 0])
      : [NO_BASE, 0];
    return { pr, facts: { ...facts, headSha, baseSha }, reviews, mergeable: mergeableOf(pr), baseRes, behind, contexts };
  }

  /** Each user's newest review that is not dismissed, keyed by login. */
  const latestReviews = (reviews) => {
    const by = new Map();
    for (const r of reviews) if (r?.user?.login && r.dismissed !== true && ['APPROVED', 'REQUEST_CHANGES'].includes(r.state)) by.set(r.user.login, r);
    return [...by.values()];
  };

  /**
   * { ok, pr } for a watched PR, in the gh snapshot's shape. Trust: in a private repository every commenter is a
   * MEMBER; in a public one only the PR author and its requested reviewers are, so a stranger's comment never starts a
   * fix run. A reviewer's "request changes" is a review keyed by its id.
   */
  async function prWatchSnapshot({ prUrl, env = process.env } = {}) {
    const p = parse(prUrl, env);
    if (!p) return { ok: false, class: 'failed', error: `invalid ${label} pull request URL` };
    try {
      const r = await readPr(p, env);
      if (!r) return { ok: false, class: 'failed', error: `malformed ${label} pull request (or a pull request from a fork)` };
      if (r.closed) return { ok: true, pr: { ...r.facts, contexts: [], threads: [], reviews: [] } };
      const priv = r.pr.base?.repo?.private === true;
      const insiders = new Set([r.facts.author.login, ...(Array.isArray(r.pr.requested_reviewers) ? r.pr.requested_reviewers : []).map((u) => u?.login)].filter(Boolean));
      const trustOf = (user) => (priv || insiders.has(user?.login) ? 'MEMBER' : 'NONE');
      const reviews = latestReviews(r.reviews).filter((x) => x.state === 'REQUEST_CHANGES')
        .map((x) => ({ databaseId: x.id, state: 'CHANGES_REQUESTED', body: String(x.body || `${x.user.login} requested changes.`),
          author: { login: x.user.login }, authorAssociation: trustOf(x.user) }));
      return { ok: true, pr: { ...r.facts, mergeable: r.mergeable, behindBy: r.behind,
        baseFailing: r.baseRes.failing, basePassing: r.baseRes.passing, basePending: r.baseRes.pending, baseSettled: r.baseRes.settled,
        contexts: r.contexts, threads: await threadsOf(p, r.reviews, env, trustOf), reviews } };
    } catch (e) { return watchFailure(e); }
  }

  /**
   * The PR card's raw facts for git-info's prChecks, in GitHub's terms. Branch protection is not readable without
   * admin rights, so mergeState is unknown and the row never says "Ready to merge" or "Review required". null on failure.
   */
  async function prCheckFacts({ prUrl, env = process.env } = {}) {
    const p = parse(prUrl, env);
    if (!p) return null;
    try {
      const r = await readPr(p, env);
      if (!r || r.closed) return null;
      const items = r.contexts.map((c) => (c.type === 'check'
        ? { __typename: 'CheckRun', name: c.name, status: c.status, conclusion: c.conclusion }
        : { __typename: 'StatusContext', context: c.context, state: c.state }));
      const latest = latestReviews(r.reviews);
      const decision = latest.some((x) => x.state === 'REQUEST_CHANGES') ? 'CHANGES_REQUESTED' : latest.some((x) => x.state === 'APPROVED') ? 'APPROVED' : null;
      return { items, mergeable: r.mergeable, mergeState: null, reviewDecision: decision, draft: r.pr.draft === true, base: r.facts.base, baseFailing: r.baseRes.failing };
    } catch { return null; }
  }

  /**
   * The failed jobs of one Actions run (`databaseId` = its run number from the status link): each job's name, its
   * failed step, and the last lines of its log. Raw text: the caller redacts and caps it.
   */
  async function failedBuildLog({ prUrl, databaseId, env = process.env } = {}) {
    const p = parse(prUrl, env);
    if (!p || !Number.isSafeInteger(databaseId) || databaseId <= 0) return { ok: false, class: 'failed', error: 'invalid build log request' };
    try {
      const { values: runs } = await listAll(p.host, `${repoApi(p)}/actions/runs`, { env, maxPages: 3, key: 'workflow_runs' });
      const run = runs.find((r) => flavour.runNumber(r) === databaseId);
      if (!run) return { ok: false, class: 'failed', error: `${label} Actions run #${databaseId} not found` };
      const { json } = await apiFetch('read', p.host, `${repoApi(p)}/actions/runs/${run.id}/jobs`, { env });
      const jobs = (Array.isArray(json) ? json : Array.isArray(json?.jobs) ? json.jobs : []).filter((j) => flavour.jobFailed(j) && Number.isSafeInteger(j?.id));
      const parts = [];
      for (const j of jobs) {
        // Gitea's job list carries the steps, Forgejo's needs the job read.
        const detail = Array.isArray(j.steps) ? j : (await apiFetch('read', p.host, `${repoApi(p)}/actions/jobs/${j.id}`, { env })).json;
        const step = (Array.isArray(detail?.steps) ? detail.steps : []).find((s) => flavour.stepFailed(s));
        const { text } = await apiFetch('read', p.host, `${repoApi(p)}/actions/jobs/${j.id}/logs`, { env, text: true });
        parts.push([`## ${j.name || 'Job'}${step?.name ? ` › ${step.name}` : ''}`, text.split(/\r?\n/).slice(-LOG_LINES).join('\n')].filter(Boolean).join('\n'));
      }
      return { ok: true, text: parts.join('\n\n') };
    } catch (e) { return watchFailure(e); }
  }

  /** Checks carry no runId, so the watcher never asks for a re-run; any call is refused. */
  async function requeueEvaluation() {
    return { ok: false, class: 'failed', error: `${label} checks cannot be re-run from worca` };
  }

  /** Reply on a thread: a PR-level comment for a `c<id>` thread, else a comment on the root's path and line that joins
   *  the review thread (the flavour says how); it stays open for the reviewer. */
  async function replyToThread({ prUrl, threadId, body, env = process.env } = {}) {
    const p = parse(prUrl, env);
    const id = String(threadId ?? '');
    if (!p || !/^c?[1-9]\d*$/.test(id)) return { ok: false, class: 'failed', error: 'invalid thread reply request' };
    try {
      if (id.startsWith('c')) { await apiFetch('write', p.host, `${issueApi(p)}/comments`, { method: 'POST', env, body: { body } }); return { ok: true }; }
      const { values: reviews } = await listAll(p.host, `${prApi(p)}/reviews`, { env });
      const root = (await reviewComments(p, reviews, env)).find((c) => c.id === Number(id));
      if (!root) return { ok: false, class: 'failed', error: `${label} review comment ${id} not found` };
      const at = { path: root.path, body, ...(root.position > 0 ? { new_position: root.position } : { old_position: root.original_position }) };
      if (flavour.replyInReview) await apiFetch('write', p.host, `${prApi(p)}/reviews/${root.reviewId}/comments`, { method: 'POST', env, body: at });
      else await apiFetch('write', p.host, `${prApi(p)}/reviews`, { method: 'POST', env, body: { event: 'COMMENT', body: '', comments: [at] } });
      return { ok: true };
    } catch (e) { return watchFailure(e); }
  }

  return { forge, label, available, createPr, viewPr, findPrForBranch, listPullRequestsForBranches, mergedAt, markReady, closePr,
    prComment, prWatchSnapshot, prCheckFacts, failedBuildLog, requeueEvaluation, replyToThread, forkRefusal, apiFetch, _testing };
}
