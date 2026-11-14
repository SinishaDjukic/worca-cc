// plugins/jira-source/connector/jira-api.mjs
// Minimal Jira REST wrapper (its own token; connector children get only PATH/HOME and the proxy and CA variables).
// Jira Cloud: Basic base64(email:API token). Data Center / Server: Bearer personal access token.
// Errors carry a `kind` the shim child forwards: auth | rate-limit | network | plugin.
import { createWriteStream, rmSync } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
const err = (kind, message, extra = {}) => Object.assign(new Error(message), { kind, ...extra });

export function authHeader({ email, token }) {
  return email ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` : `Bearer ${token}`;
}

// timeoutMs: give up on a request that does not answer (an export op after the issue exists, A6 D10); a network failure then.
export async function jiraFetch(jira, path, { method = 'GET', body, anonymous = false, timeoutMs = 0 } = {}) {
  const url = `${jira.base}${path}`;
  let res;
  try {
    res = await jira.fetch(url, {
      method,
      headers: { accept: 'application/json', 'content-type': 'application/json', ...(anonymous ? {} : { authorization: authHeader(jira) }),
        'user-agent': 'worca-cc-jira-source', 'x-atlassian-token': 'no-check' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  } catch (e) {
    if (e?.name === 'TimeoutError') throw err('network', `Jira did not answer within ${Math.round(timeoutMs / 1000)} s`);
    throw err('network', `Jira unreachable: ${e?.message || e}`);
  }
  if (res.status === 401) throw err('auth', 'Jira token invalid or expired (or the email does not match it)', { status: 401 });
  if (res.status === 429) {
    const after = res.headers?.get?.('retry-after');
    throw err('rate-limit', `Jira rate limit${after ? ` (retry after ${after}s)` : ''}`);
  }
  let json = null;
  if (res.status !== 204) { try { json = await res.json(); } catch { json = null; } }
  if (!res.ok) {
    const detail = [...(json?.errorMessages || []), ...Object.values(json?.errors || {})].join('; ');
    // `body`: Jira's own errors, for an export op that turns a refused field into a result (A6 D11)
    throw err('plugin', `Jira ${res.status}${detail ? `: ${detail}` : ''} (${method} ${path})`, { status: res.status, body: json });
  }
  return json;
}

/**
 * A6.1 (plans/requirements-a61-design.md D9, D15, §5): one attachment's body streamed into `dest`, a path the host made. Only the
 * site's own content address, with the profile's auth and `redirect: 'manual'`; one redirect at most, to the site with the header,
 * elsewhere only over https: (or plain http when a test allows it) and without it. The size is checked on the response and while
 * it streams; `dest` is created exclusively and deleted on any failure, never a file this call did not create. It has no timeout
 * of its own: the host's callSource kills the child at DOWNLOAD_TIMEOUT_MS (120 s), and a partial body.part left by that kill is
 * removed with the host's single-use folder (the contract, D9).
 */
export async function jiraDownload(jira, content, { dest, maxBytes, allowHttpRedirect = false } = {}) {
  const site = new URL(jira.base).origin;
  let url;
  try { url = new URL(String(content || '')); } catch { throw err('plugin', 'the attachment has no address Jira serves'); }
  if (url.origin !== site) throw err('plugin', "the attachment's address is not on this Jira site");
  const get = (u, withAuth) => jira.fetch(u.href, { method: 'GET', redirect: 'manual',
    headers: { accept: '*/*', 'user-agent': 'worca-cc-jira-source', ...(withAuth ? { authorization: authHeader(jira) } : {}) } });
  const drop = async (r) => { try { await r.body?.cancel(); } catch { /* nothing to read */ } };
  let res;
  let authed = true;   // whether the answer below came from a request that carried the token
  try {
    res = await get(url, true);
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location') ? new URL(res.headers.get('location'), url) : null;
      if (!next) throw err('plugin', 'Jira redirected the file without saying where');
      const same = next.origin === site;
      if (!same && next.protocol !== 'https:' && !(allowHttpRedirect && next.protocol === 'http:')) throw err('plugin', 'Jira redirected the file to an address that is not https');
      await drop(res);
      authed = same;
      res = await get(next, same);
      if (res.status >= 300 && res.status < 400) { await drop(res); throw err('plugin', 'Jira redirected the file more than once'); }
    }
  } catch (e) {
    if (e && e.kind) throw e;
    throw err('network', `Jira unreachable: ${e?.message || e}`);
  }
  // A 401 is the token only when the request carried it; from Cloud's signed address (no header) it is that address's problem, and
  // Try again asks the site for a new one (final review M2)
  if (res.status === 401 && authed) { await drop(res); throw err('auth', 'Jira token invalid or expired (or the email does not match it)', { status: 401 }); }
  if (res.status === 403 || res.status === 404) { await drop(res); return { gone: true, ...(res.status === 403 ? { forbidden: true } : {}) }; }
  if (res.status === 429) { await drop(res); throw err('rate-limit', 'Jira rate limit'); }
  if (!res.ok || !res.body) { await drop(res); throw err('plugin', `Jira did not send the file (${res.status})`, { status: res.status }); }
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) { await drop(res); return { tooLarge: true, bytes: declared }; }
  let written = 0;
  let over = false;
  const counter = new Transform({ transform(chunk, _enc, cb) {
    written += chunk.length;
    if (written > maxBytes) { over = true; cb(new Error('the file is larger than allowed')); } else cb(null, chunk);
  } });
  let created = false;
  const out = createWriteStream(dest, { flags: 'wx', mode: 0o600 });
  out.once('open', () => { created = true; });
  try {
    await pipeline(Readable.fromWeb(res.body), counter, out);
  } catch (e) {
    if (created) { try { rmSync(dest, { force: true }); } catch { /* the host removes its folder anyway */ } }
    if (e && e.code === 'EEXIST') throw err('plugin', 'a file is already where the download should go');
    if (over) return { tooLarge: true, bytes: written };
    throw err('network', `the download stopped: ${e?.message || e}`);
  }
  return { bytes: written };
}
