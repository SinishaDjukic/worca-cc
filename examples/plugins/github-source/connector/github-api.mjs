// examples/plugins/github-source/connector/github-api.mjs
// Minimal GitHub REST v3 fetch wrapper. No octokit, no GraphQL, no webhooks
// (YAGNI). Every request goes through ghFetch so auth headers + error mapping
// live in exactly one place. Errors carry a `kind` the shim child forwards
// verbatim into the protocol frame: auth | rate-limit | network | plugin.

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
  let res;
  try {
    res = await gh.fetch(url, {
      method: init.method || 'GET',
      headers: headers(gh.token, init.headers),
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
