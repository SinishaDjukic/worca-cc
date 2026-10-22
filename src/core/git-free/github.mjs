// src/core/git-free/github.mjs — the one GitHub REST client of the git-free transports (P6 Task 2).
// Credentials come from githubEnv (role read|write, never "as person"); a token is never logged, stored, put in a URL
// or in an error message. GETs revalidate with their ETag. Every failure is a GithubError with one GITHUB_* code.
import { createHash } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { githubEnv } from '../github-credentials.mjs';

export const GITHUB_API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const JSON_ACCEPT = 'application/vnd.github+json';
const TIMEOUT_MS = 20_000;
const ARCHIVE_TIMEOUT_MS = 300_000;
const MAX_WAIT_S = 3600;                  // the longest a rate-limited credential is refused locally

export class GithubError extends Error {
  constructor(code, message, { status = null, apiMessage = null, anonymous = false, resetAtMs = null } = {}) {
    super(message);
    this.name = 'GithubError';
    this.code = code;
    this.status = status;
    this.apiMessage = apiMessage;
    this.anonymous = anonymous;                     // the request went out without a token
    if (resetAtMs != null) this.resetAtMs = resetAtMs;
  }
}

const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const URL_RES = [
  /^https?:\/\/(?:[^@/:\s]+@)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
  /^ssh:\/\/git@(?:ssh\.)?github\.com(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
  /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
  /^git:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
];
const SHORTHAND_RE = /^([^/\s]+)\/([^/\s]+)$/;

/** { owner, repo } for a github.com URL naming one repository (and `owner/repo` with `shorthand`), else null. */
export function githubRepoOf(input, { shorthand = false } = {}) {
  const s = String(input ?? '').trim();
  for (const re of shorthand ? [...URL_RES, SHORTHAND_RE] : URL_RES) {
    const m = re.exec(s);
    if (!m) continue;
    const [, owner, repo] = m;
    if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === '.' || repo === '..') return null;
    return { owner, repo };
  }
  return null;
}

let fetchOverride = null;
const etags = new Map();                  // `${tokenHash|anon}|${accept}|${url}` → { etag, body }; at most 500 entries
const limited = new Map();                // `${tokenHash|anon}` → epoch ms when GitHub's rate limit for that credential resets
const IMMUTABLE_RE = /(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])/i;   // a URL naming a commit/tree/blob sha never changes: no ETag entry
const PRIVATE_HINT = ' (a private repository needs GH_TOKEN)';
const WRITE_HINT = ' (writing needs GH_TOKEN)';

const tokenKey = (token) => (token ? createHash('sha256').update(token).digest('hex').slice(0, 16) : 'anon');
// URL parsing folds a `.`, `..` or empty segment (`rel/./v2` would ask for rel/v2, a name git refuses): never sent.
const encodePath = (p) => {
  const segs = String(p).split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) throw new GithubError('GITHUB_NOT_FOUND', `not found on GitHub: ${p}`, { status: 404 });
  return segs.map(encodeURIComponent).join('/');
};
const resetTime = (sec) => new Date(sec * 1000).toISOString().slice(11, 16);

function networkError(err, anonymous) {
  // AbortSignal.timeout rejects with a DOMException 'TimeoutError' whose legacy numeric `code` is 23: name first.
  const why = err?.name === 'TimeoutError' ? 'timeout' : err?.cause?.code || (typeof err?.code === 'string' && err.code) || err?.name || 'error';
  return new GithubError('GITHUB_NETWORK', `GitHub unreachable (${why})`, { anonymous });
}
/** A body that fails after the headers (a reset, the timeout mid-download) is a network failure too. */
async function bodyText(res, anonymous) {
  try { return await res.text(); } catch (err) { throw networkError(err, anonymous); }
}
/** A body that is not JSON (a proxy's or a captive portal's page answered 200) is GitHub's failure too, never a SyntaxError. */
function parseJson(text) {
  try { return JSON.parse(text); } catch { throw new GithubError('GITHUB_HTTP', 'GitHub answered no JSON'); }
}
/** GitHub answers 404 for a private repository the caller may not see: without a token, say so. */
const notFoundError = (slug, anonymous, opts = { status: 404 }) =>
  new GithubError('GITHUB_NOT_FOUND', `not found on GitHub: ${slug}${anonymous ? PRIVATE_HINT : ''}`, { ...opts, anonymous });
const rateLimited = (untilMs, opts) =>
  new GithubError('GITHUB_RATE_LIMITED', `GitHub rate limit reached (resets ${resetTime(untilMs / 1000)} UTC)`, { ...opts, resetAtMs: untilMs });

async function httpError(res, slug, anonymous) {
  let apiMessage = null;
  try { const j = JSON.parse(await res.text()); if (typeof j?.message === 'string' && j.message) apiMessage = j.message; } catch { /* not JSON */ }
  const s = res.status;
  const opts = { status: s, apiMessage, anonymous };
  // Without a token a 401 means the endpoint needs one (a write): no token was rejected.
  if (s === 401) return new GithubError('GITHUB_AUTH', anonymous ? `GitHub (HTTP 401)${apiMessage ? `: ${apiMessage}` : ''}${WRITE_HINT}` : 'GitHub rejected the token (HTTP 401)', opts);
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (s === 429 || (s === 403 && (remaining === '0' || res.headers.get('retry-after') || /rate limit/i.test(apiMessage ?? '')))) {
    // GitHub's rule: `retry-after` seconds when present (a secondary limit; the primary headers ride along), else the
    // primary bucket's `x-ratelimit-reset` when it is spent, else a minute (a secondary limit may send neither). At most
    // an hour, GitHub's window: a garbled header or a clock far off never refuses longer (nor names an invalid date).
    const now = Date.now() / 1000;
    const after = Number(res.headers.get('retry-after'));
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const at = after > 0 ? now + after : remaining === '0' && reset > 0 ? reset : now + 60;
    return rateLimited(Math.min(at, now + MAX_WAIT_S) * 1000, opts);
  }
  if (s === 403) return new GithubError('GITHUB_FORBIDDEN', `GitHub refused (HTTP 403): ${apiMessage ?? 'forbidden'}`, opts);
  if (s === 404) return notFoundError(slug, anonymous, opts);
  if (s === 409 || s === 422) return new GithubError('GITHUB_CONFLICT', `GitHub (HTTP ${s}): ${apiMessage ?? ''}`.replace(/: $/, ''), opts);
  return new GithubError('GITHUB_HTTP', `GitHub (HTTP ${s})${apiMessage ? `: ${apiMessage}` : ''}`, opts);
}

/** A client for one repository. `sub` is the path below /repos/<owner>/<repo>; `timeoutMs` bounds each JSON/text request. */
export function createGithubClient({ owner, repo, role = 'read', fetchImpl, timeoutMs: requestTimeoutMs = TIMEOUT_MS } = {}) {
  const slug = `${owner}/${repo}`;
  const base = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const doFetch = (...a) => (fetchImpl ?? fetchOverride ?? globalThis.fetch)(...a);
  let tokenP = null;
  // GitHub App mode mints the token on the first request (github-app.mjs, 20 s per call): through this client's fetch,
  // under that request's own deadline.
  const mintFetch = (signal) => (url, init = {}) => doFetch(url, { ...init, signal: AbortSignal.any([init.signal, signal].filter(Boolean)) });
  const token = (signal) => (tokenP ??= githubEnv(role, { repo: slug, asPerson: false, fetchImpl: mintFetch(signal) }).then(({ env, error }) => {
    if (error) console.warn(`[worca] GitHub credential for ${slug}: ${error}; going anonymous`);
    return env.GH_TOKEN || null;
  }));

  async function request(method, sub, { accept = JSON_ACCEPT, body, timeoutMs = requestTimeoutMs, cache = method === 'GET' } = {}) {
    const url = `${base}${sub}`;
    const signal = AbortSignal.timeout(timeoutMs);   // one deadline per request, its credential included
    const tok = await token(signal);
    const cred = tokenKey(tok);
    // A credential GitHub rate-limited stays refused until its reset: no request spends the next hour's budget.
    const until = limited.get(cred);
    if (until !== undefined) {
      if (Date.now() < until) throw rateLimited(until, { anonymous: !tok });
      limited.delete(cred);
    }
    const headers = { accept, 'x-github-api-version': API_VERSION, 'user-agent': 'worca' };
    if (tok) headers.authorization = `Bearer ${tok}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const key = `${cred}|${accept}|${url}`;
    const keep = cache && !IMMUTABLE_RE.test(sub);
    const hit = keep ? etags.get(key) : null;
    if (hit) headers['if-none-match'] = hit.etag;
    let res;
    try {
      res = await doFetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
    } catch (err) {
      throw networkError(err, !tok);
    }
    if (res.status === 304 && hit) return { status: 200, text: hit.body };
    if (!res.ok) {
      const e = await httpError(res, slug, !tok);
      if (e.code === 'GITHUB_RATE_LIMITED') limited.set(cred, e.resetAtMs);
      return { status: res.status, error: e };
    }
    if (!cache) return { status: res.status, res, anonymous: !tok };
    const text = await bodyText(res, !tok);
    const etag = res.headers.get('etag');
    if (etag && keep) {
      etags.set(key, { etag, body: text });
      if (etags.size > 500) etags.delete(etags.keys().next().value);   // a size cap: the oldest entry goes first
    }
    return { status: res.status, text };
  }

  async function json(method, sub = '', body) {
    const r = await request(String(method).toUpperCase(), sub, { body });
    if (r.error) throw r.error;
    const text = r.text ?? (r.res ? await bodyText(r.res, r.anonymous) : '');
    return text ? parseJson(text) : null;
  }
  async function text(sub, accept) {
    const r = await request('GET', sub, { accept });
    if (r.error) { if (r.status === 404) return null; throw r.error; }
    return r.text;
  }
  async function contents(path, ref) {
    const t = await text(`/contents/${encodePath(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, JSON_ACCEPT);
    if (t === null) return null;
    const j = parseJson(t);
    if (j?.type === 'symlink') return { type: 'symlink', target: String(j.target ?? '') };
    if (j?.type !== 'file') return null;
    // `path`: GitHub answers the file an in-repository symlink names, under that file's own path.
    if (j.encoding === 'base64') return { type: 'file', bytes: Buffer.from(String(j.content ?? ''), 'base64'), path: j.path };
    // 1–100 MB: the contents API answers encoding "none" and no content; the blob API still serves it (base64).
    const blob = await json('GET', `/git/blobs/${encodePath(j.sha)}`);
    return { type: 'file', bytes: Buffer.from(String(blob?.content ?? ''), 'base64'), path: j.path };
  }
  async function archive(sha) {
    const r = await request('GET', `/tarball/${encodePath(sha)}`, { cache: false, timeoutMs: ARCHIVE_TIMEOUT_MS });
    if (r.error) throw r.error;
    // A download that fails midway (a reset, the 300 s deadline) reaches the reader as GITHUB_NETWORK.
    const src = Readable.fromWeb(r.res.body);
    const out = new PassThrough();
    src.on('error', (err) => out.destroy(networkError(err, r.anonymous)));
    out.on('close', () => { if (!src.destroyed) src.destroy(); });
    return src.pipe(out);
  }
  const anonymous = async () => !(await token());
  return { owner, repo, slug, json, text, contents, archive, anonymous };
}

// A resolved sha names folders (snapshots, versions/<sha7>, `<dir>@sha`): an answer that is not one is refused.
const COMMIT_RE = /^[0-9a-f]{40}$/;
const noCommit = () => new GithubError('GITHUB_HTTP', 'GitHub answered no commit');

/** The commit sha of `ref` (null = the default branch; a branch, tag or commit otherwise). */
export async function resolveCommit(client, ref) {
  const name = ref ?? (await client.json('GET', '')).default_branch;
  const sha = await client.text(`/commits/${encodePath(name)}`, 'application/vnd.github.sha');
  if (sha === null) throw notFoundError(client.slug, !!(await client.anonymous?.()));
  if (!COMMIT_RE.test(sha.trim())) throw noCommit();
  return sha.trim();
}

/** The head sha of `branch`, or null when there is no such branch. */
export async function resolveBranch(client, branch) {
  try {
    const sha = (await client.json('GET', `/git/ref/heads/${encodePath(branch)}`))?.object?.sha;
    if (!COMMIT_RE.test(sha)) throw noCommit();
    return sha;
  } catch (err) {
    if (err.code === 'GITHUB_NOT_FOUND') return null;
    throw err;
  }
}

export const _testing = {
  setFetch(fn) { fetchOverride = fn; },
  reset() { fetchOverride = null; etags.clear(); limited.clear(); },
};
