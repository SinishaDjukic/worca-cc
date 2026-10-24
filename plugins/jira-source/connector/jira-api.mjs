// plugins/jira-source/connector/jira-api.mjs
// Minimal Jira REST wrapper (its own token; connector children get only PATH/HOME and the proxy and CA variables).
// Jira Cloud: Basic base64(email:API token). Data Center / Server: Bearer personal access token.
// Errors carry a `kind` the shim child forwards: auth | rate-limit | network | plugin.
const err = (kind, message, extra = {}) => Object.assign(new Error(message), { kind, ...extra });

export function authHeader({ email, token }) {
  return email ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` : `Bearer ${token}`;
}

export async function jiraFetch(jira, path, { method = 'GET', body, anonymous = false } = {}) {
  const url = `${jira.base}${path}`;
  let res;
  try {
    res = await jira.fetch(url, {
      method,
      headers: { accept: 'application/json', 'content-type': 'application/json', ...(anonymous ? {} : { authorization: authHeader(jira) }),
        'user-agent': 'worca-cc-jira-source', 'x-atlassian-token': 'no-check' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) { throw err('network', `Jira unreachable: ${e?.message || e}`); }
  if (res.status === 401) throw err('auth', 'Jira token invalid or expired (or the email does not match it)', { status: 401 });
  if (res.status === 429) {
    const after = res.headers?.get?.('retry-after');
    throw err('rate-limit', `Jira rate limit${after ? ` (retry after ${after}s)` : ''}`);
  }
  let json = null;
  if (res.status !== 204) { try { json = await res.json(); } catch { json = null; } }
  if (!res.ok) {
    const detail = [...(json?.errorMessages || []), ...Object.values(json?.errors || {})].join('; ');
    throw err('plugin', `Jira ${res.status}${detail ? `: ${detail}` : ''} (${method} ${path})`, { status: res.status });
  }
  return json;
}
