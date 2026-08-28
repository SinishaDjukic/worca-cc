// plugins/github-source/connector/github-api.mjs
// Minimal GitHub REST v3 fetch wrapper, plus GraphQL only where REST cannot:
// reviewThreads.isResolved / resolveReviewThread (the PR comments source). No
// octokit, no webhooks (YAGNI). Every request goes through ghFetch so auth
// headers + error mapping live in exactly one place. Errors carry a `kind` the
// shim child forwards verbatim into the protocol frame:
// auth | rate-limit | network | plugin.

const API = 'https://api.github.com';

function headers(token, extra = {}) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': 'worca-cc-github-source',
    'x-github-api-version': '2022-11-28',
    ...extra,
  };
}

function err(kind, message) {
  return Object.assign(new Error(message), { kind });
}

/**
 * Perform one GitHub API request.
 * @param {{fetch: Function, token: string}} gh injected fetch (tests pass a fake) + token
 * @param {string} path e.g. '/repos/o/r/issues?state=open' (absolute URLs pass through)
 * @param {{method?: string, body?: object, headers?: object}} [init]
 * @returns {Promise<{status: number, headers: {get: Function}, json: any}>}
 *   304 returns { status: 304, json: null } — the caller serves its cache.
 */
export async function ghFetch(gh, path, init = {}) {
  const url = path.startsWith('http') ? path : API + path;
  // Read the token OUTSIDE the try: it may be a lazy getter that shells out to
  // the gh CLI and throws kind:'auth'. Inside, the catch below would relabel
  // that as 'network' ("GitHub unreachable") and hide the real cause.
  const token = gh.token;
  let res;
  try {
    res = await gh.fetch(url, {
      method: init.method || 'GET',
      headers: headers(token, init.headers),
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (e) {
    throw err('network', `GitHub unreachable: ${e?.message || e}`);
  }
  if (res.status === 304) return { status: 304, headers: res.headers, json: null };
  if (res.status === 401) throw err('auth', 'GitHub token invalid or expired');
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = res.headers.get('x-ratelimit-reset');
    throw err('rate-limit', `GitHub rate limit exhausted${reset ? ` (resets at epoch ${reset})` : ''}`);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.message || ''; } catch { /* body is optional */ }
    throw err('plugin', `GitHub API ${res.status}${detail ? `: ${detail}` : ''} (${init.method || 'GET'} ${url})`);
  }
  return { status: res.status, headers: res.headers, json: await res.json() };
}

/**
 * One GitHub GraphQL v4 request. Auth + transport errors are ghFetch's; a 200
 * with an `errors` array is a query-level failure and maps to kind:'plugin'
 * (NOT_FOUND for a PR the token cannot see is the common case).
 * @returns {Promise<any>} the `data` object
 */
export async function ghGraphql(gh, query, variables = {}) {
  const { json } = await ghFetch(gh, '/graphql', {
    method: 'POST', body: { query, variables }, headers: { 'content-type': 'application/json' },
  });
  if (Array.isArray(json?.errors) && json.errors.length) {
    const msg = json.errors.map((e) => e.message).filter(Boolean).join('; ') || 'unknown GraphQL error';
    throw err('plugin', `GitHub GraphQL: ${msg}`);
  }
  return json?.data ?? null;
}
