// src/core/pr/bitbucket-server.mjs
// Pull requests on a SELF-HOSTED Bitbucket Server / Data Center (REST 1.0; fetch, no CLI), the PR half of Ship-it
// and Watch PR for a Bitbucket Server base remote, beside pr/bitbucket.mjs (Cloud) and pr/azure.mjs. git-info.mjs
// dispatches here by forge ('bitbucket-server', hosts from WORCA_BB_SERVER_HOSTS), and every answer keeps that
// module's shapes and export names.
//
// Auth (bitbucket-server-credentials.mjs): the Bearer HTTP access token from WORCA_BB_SERVER_TOKEN (or split
// _READ_TOKEN/_WRITE_TOKEN); the header only ever goes to an allow-listed Bitbucket Server host. Deliberate scope:
// no fork PRs, no PR watch / checks / comments (those methods answer an explicit "not supported" — a Server PR URL
// never reaches the gh path or a missing method). Server exposes no synchronous mergeability, so mergeable is UNKNOWN.
//
// /** @typedef {import('./azure.mjs').PrCreateResult} PrCreateResult */
import { readBitbucketServerCredentials, bitbucketServerHosts, isBitbucketServerHost } from '../bitbucket-server-credentials.mjs';
import { parseBitbucketServerPrUrl, bitbucketServerPrUrl } from '../../shared/bitbucket-server-remote.mjs';

export { parseBitbucketServerPrUrl };

export const BITBUCKET_SERVER_TIMEOUT_MS = 20_000;
const STATE = { OPEN: 'OPEN', MERGED: 'MERGED', DECLINED: 'CLOSED', SUPERSEDED: 'CLOSED' };
const enc = encodeURIComponent;

/** The refusal when a branch would be pushed to another repository than a Bitbucket Server base. */
export function forkRefusal(baseRepo) {
  return `Bitbucket Server pull requests between repositories (forks) are not supported yet — push to ${baseRepo?.name || 'the base remote'}.`;
}

/** A base remote (listRemotes: { host, owner, repo, … }) or a parsed PR URL ({ host, key, slug }) → REST coords.
 *  Prefer `repo` over `slug`: a listRemotes entry's `slug` is the QUALIFIED remote-repo-slug ("host/owner/repo",
 *  remoteRepoSlug) and using it corrupts the REST path; `slug` appears alone only on a parsed PR URL. */
const coordsOf = (p) => ({ host: p?.host, key: p?.key || p?.owner, slug: p?.repo || p?.slug });
const apiRepo = (c, tail = '') => `https://${c.host}/rest/api/1.0/projects/${enc(c.key)}/repos/${enc(c.slug)}${tail}`;

function fail(kind, message, extra = {}) { const e = new Error(message); Object.assign(e, { kind }, extra); return e; }

let _fetch = (...a) => globalThis.fetch(...a);
export const _testing = { setFetch(fn) { _fetch = fn; }, reset() { _fetch = (...a) => globalThis.fetch(...a); } };

async function request(url, { method = 'GET', body, token, ok = [200, 201, 204] } = {}) {
  if (!token) throw fail('auth', 'no Bitbucket Server token: set WORCA_BB_SERVER_TOKEN where worca runs');
  let res;
  try {
    res = await _fetch(url, {
      method,
      signal: AbortSignal.timeout(BITBUCKET_SERVER_TIMEOUT_MS),
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        authorization: `Bearer ${token}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    throw fail(e?.name === 'TimeoutError' ? 'timeout' : 'network', `Bitbucket Server unreachable: ${e?.message || e}`);
  }
  if (res.status === 401 || res.status === 403) throw fail('auth', `Bitbucket Server refused the token (${res.status})`, { status: res.status });
  let json = null;
  if (res.status !== 204) { try { json = await res.json(); } catch { json = null; } }
  if (!ok.includes(res.status)) {
    const msg = Array.isArray(json?.errors) ? json.errors.map((e) => e.message).filter(Boolean).join('; ') : '';
    throw fail('failed', `Bitbucket Server ${res.status}${msg ? `: ${msg}` : ''}`, { status: res.status, body: json });
  }
  return { status: res.status, json };
}

const toPr = (coords, pr) => ({
  state: STATE[pr?.state] || null,
  url: bitbucketServerPrUrl(coords, pr?.id),
  number: Number.isInteger(pr?.id) ? pr.id : null,
  isDraft: pr?.draft === true,
  mergeable: 'UNKNOWN',   // Server exposes no synchronous mergeability on the bare PR object
});

const headRef = (head) => `refs/heads/${head}`;

/** Byte `limit` rows at a time (`start`), up to `maxPages`, matching a source branch client-side: the Server's
 *  `at=<ref>` source-branch query filter returns nothing on current versions (verified), so listing + matching local. */
async function listPrs(coords, states, token, maxPages = 5) {
  const per = 100;
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const start = page * per;
    const { json } = await request(`${apiRepo(coords, `/pull-requests?${states.map((s) => `state=${s}`).join('&')}&limit=${per}&start=${start}`)}`, { token });
    const values = Array.isArray(json?.values) ? json.values : [];
    out.push(...values);
    if (values.length < per || json?.isLastPage === true) break;
  }
  return out;
}

/** An existing OPEN PR for the same source+destination branch pair, else null. */
async function findOpenFor(head, base, coords, token) {
  const list = await listPrs(coords, ['OPEN'], token);
  const hit = list.find((p) => p?.fromRef?.id === headRef(head) && (!base || p?.toRef?.id === headRef(base)));
  return hit ? toPr(coords, hit) : null;
}

/** { ok:true } when a bitbucket-server host is allow-listed with a token, else a reason. */
export async function available({ env = process.env } = {}) {
  const c = readBitbucketServerCredentials(env);
  return c.mode !== 'none' && bitbucketServerHosts(env).size > 0
    ? { ok: true }
    : { ok: false, reason: 'Bitbucket Server is not configured: set WORCA_BB_SERVER_HOSTS (the server host) and WORCA_BB_SERVER_TOKEN where worca runs' };
}

/** @returns {Promise<PrCreateResult>} */
export async function createPr({ base, head, title, body = '', baseRepo, pushRepo = null, draft = false, env = process.env }) {
  const coords = coordsOf(baseRepo);
  if (!coords.host || !coords.key || !coords.slug || !isBitbucketServerHost(coords.host, env)) {
    return { ok: false, kind: 'failed', error: 'the base remote is not a Bitbucket Server repository' };
  }
  if (pushRepo) {
    const pc = coordsOf(pushRepo);
    if (pc.host !== coords.host
      || String(pc.key).toLowerCase() !== String(coords.key).toLowerCase()
      || String(pc.slug).toLowerCase() !== String(coords.slug).toLowerCase()) {
      return { ok: false, kind: 'unsupported', error: forkRefusal(baseRepo) };
    }
  }
  const token = readBitbucketServerCredentials(env).write;
  try {
    // An open PR for this branch pair is reused as-is (Server answers a duplicate create with an error).
    const found = await findOpenFor(head, base, coords, token);
    if (found) return { ok: true, url: found.url, number: found.number, existed: true };
    const payload = {
      title: title || head, description: body || title || head,
      fromRef: { id: headRef(head), repository: { slug: coords.slug, project: { key: coords.key } } },
      toRef: { id: headRef(base) },
      ...(draft === true ? { draft: true } : {}),
    };
    const { json } = await request(apiRepo(coords, '/pull-requests'), { method: 'POST', body: payload, token });
    if (!Number.isInteger(json?.id)) return { ok: false, kind: 'failed', error: 'Bitbucket Server answered without a pull request id' };
    return { ok: true, url: bitbucketServerPrUrl(coords, json.id), number: json.id, existed: false };
  } catch (e) {
    if (e?.status === 400 || e?.status === 409) {
      const dup = await findOpenFor(head, base, coords, token).catch(() => null);
      if (dup) return { ok: true, url: dup.url, number: dup.number, existed: true };
    }
    return { ok: false, kind: e?.kind === 'auth' ? 'auth' : 'failed', error: e?.message || String(e) };
  }
}

/** { state: OPEN|MERGED|CLOSED, url, number, isDraft, mergeable } | null — never throws. `withMergeable` is accepted
 *  but Server exposes no synchronous mergeability, so mergeable stays UNKNOWN. */
export async function viewPr({ prUrl, withMergeable = false, env = process.env } = {}) {
  const p = parseBitbucketServerPrUrl(prUrl);
  if (!p) return null;
  try {
    const token = readBitbucketServerCredentials(env).read;
    const { json } = await request(`${apiRepo(p, `/pull-requests/${p.number}`)}`, { token });
    const pr = toPr(p, json);
    if (!pr.state || pr.number == null) return null;
    return pr;
  } catch { return null; }
}

/** { state: OPEN|MERGED, url, number, isDraft, mergeable } | null — OPEN first, then MERGED, `includeClosed` adds
 *  DECLINED / SUPERSEDED (CLOSED). Never throws. */
export async function findPrForBranch({ head, baseRepo, includeClosed = false, withMergeable = false, env = process.env } = {}) {
  const coords = coordsOf(baseRepo);
  if (!head || !coords.host || !coords.key || !coords.slug) return null;
  try {
    const token = readBitbucketServerCredentials(env).read;
    const states = includeClosed ? ['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED'] : ['OPEN', 'MERGED'];
    const list = (await listPrs(coords, states, token)).filter((p) => p?.fromRef?.id === headRef(head));
    const pick = (st) => list.find((p) => p?.state === st);
    const hit = pick('OPEN') || pick('MERGED') || (includeClosed && (pick('DECLINED') || pick('SUPERSEDED'))) || null;
    return hit ? toPr(coords, hit) : null;
  } catch { return null; }
}

/** D24: mark a draft PR ready. PUT re-sends title/description/refs/version so the update cannot clear them. */
export async function markReady({ prUrl, env = process.env } = {}) {
  const p = parseBitbucketServerPrUrl(prUrl);
  if (!p) return { ok: false, error: 'invalid Bitbucket Server pull request URL' };
  const token = readBitbucketServerCredentials(env).write;
  try {
    const { json } = await request(`${apiRepo(p, `/pull-requests/${p.number}`)}`, { token });
    if (json?.draft !== true) return { ok: true };
    const body = {
      title: json.title, description: json.description || '', version: json.version || 0,
      fromRef: json.fromRef, toRef: json.toRef,
      reviewers: Array.isArray(json.reviewers) ? json.reviewers.map((r) => r.user?.name).filter(Boolean).map((name) => ({ user: { name } })) : [],
      draft: false,
    };
    await request(`${apiRepo(p, `/pull-requests/${p.number}`)}`, { method: 'PUT', body, token });
    return { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}

/** D24: decline a PR. REST 1.0 takes the version only; a decline comment is not wired here (`comment` is ignored). */
export async function closePr({ prUrl, comment = '', env = process.env } = {}) {
  const p = parseBitbucketServerPrUrl(prUrl);
  if (!p) return { ok: false, error: 'invalid Bitbucket Server pull request URL' };
  const token = readBitbucketServerCredentials(env).write;
  try {
    const { json } = await request(`${apiRepo(p, `/pull-requests/${p.number}`)}`, { token });
    await request(`${apiRepo(p, `/pull-requests/${p.number}/decline`)}`, { method: 'POST', body: { version: json.version || 0 }, token });
    return { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}

// PR watch / checks / comments are not implemented on Bitbucket Server (deliberate scope). Explicit unsupported
// answers keep the Runs page, the PR card and Watch out of the gh path and out of "missing method" crashes; each is
// the same shape the provider's real answer would carry (see pr/bitbucket.mjs).
/** The PR card's raw facts. null = checks unavailable (prChecks in git-info turns null into an unavailable card). */
export function prCheckFacts() { return null; }
/** @returns {Promise<{ok:false, class:'failed', error}>} — the Watch tab shows the reason. */
export function prWatchSnapshot() { return { ok: false, class: 'failed', error: 'PR Watch is not supported on Bitbucket Server' }; }
/** @returns {Promise<{ok:false, error}>} */
export function failedBuildLog() { return { ok: false, error: 'PR checks are not supported on Bitbucket Server' }; }
/** @returns {Promise<{ok:false, error}>} */
export function requeueEvaluation() { return { ok: false, error: 'PR checks are not supported on Bitbucket Server' }; }
/** @returns {Promise<{ok:false, error}>} */
export function replyToThread() { return { ok: false, error: 'PR threads are not supported on Bitbucket Server' }; }
/** @returns {Promise<{ok:false, error}>} */
export function prComment() { return { ok: false, error: 'PR comments are not supported on Bitbucket Server' }; }
