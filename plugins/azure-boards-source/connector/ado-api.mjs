// plugins/azure-boards-source/connector/ado-api.mjs
// Minimal Azure DevOps REST wrapper for the Boards connector (its own PAT; connector children get only PATH/HOME).
// Errors carry a `kind` the shim child forwards: auth | rate-limit | network | plugin.
const err = (kind, message, extra = {}) => Object.assign(new Error(message), { kind, ...extra });

export async function adoFetch(ado, url, { method = 'GET', body, contentType = 'application/json' } = {}) {
  const sep = url.includes('?') ? '&' : '?';
  const full = /api-version=/.test(url) || /\/_apis\/connectionData$/.test(url) ? url : `${url}${sep}api-version=7.1`;
  let res;
  try {
    res = await ado.fetch(full, {
      method,
      headers: { accept: 'application/json', 'content-type': contentType, 'x-tfs-fedauthredirect': 'Suppress',
        authorization: `Basic ${Buffer.from(`:${ado.token}`).toString('base64')}`, 'user-agent': 'worca-cc-azure-boards-source' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) { throw err('network', `Azure DevOps unreachable: ${e?.message || e}`); }
  if (res.status === 401 || res.status === 203) throw err('auth', 'Azure DevOps token invalid or expired');
  if (res.status === 429) {
    const after = res.headers?.get?.('retry-after');
    throw err('rate-limit', `Azure DevOps rate limit${after ? ` (retry after ${after}s)` : ''}`);
  }
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  if (!res.ok) throw err('plugin', `Azure DevOps ${res.status}${json?.message ? `: ${json.message}` : ''} (${method} ${full})`, { status: res.status });
  return json;
}
