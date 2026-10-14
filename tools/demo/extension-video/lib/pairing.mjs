// tools/demo/extension-video/lib/pairing.mjs — pair the demo extension through Worca's real pairing routes
// (as e2e/extension/fixtures.mjs#tokenFor does): request with the extension Origin, approve as "the person", poll.
import http from 'node:http';

/** http.request, because fetch drops a caller-set Origin. → { status, json } */
export function rawCall(base, method, path, { headers = {}, body } = {}) {
  const u = new URL(path, base);
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...headers } }, (res) => {
      let s = ''; res.setEncoding('utf8'); res.on('data', (c) => { s += c; });
      res.on('end', () => { let json = null; try { json = s ? JSON.parse(s) : null; } catch { /* not json */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

export async function pairExtension(worcaUrl, extensionId) {
  const origin = `chrome-extension://${extensionId}`;
  const r1 = await rawCall(worcaUrl, 'POST', '/api/extension/pair', { headers: { origin }, body: { name: 'Worca for Chrome', browser: 'chrome' } });
  if (r1.status !== 201) throw new Error(`pair request → ${r1.status} ${JSON.stringify(r1.json)}`);
  // "the person": same origin, no Origin header, no body (byte for byte as fixtures.mjs#tokenFor)
  const r2 = await rawCall(worcaUrl, 'POST', `/api/extension/pair/${r1.json.requestId}/approve`);
  if (r2.status !== 200) throw new Error(`pair approve → ${r2.status} ${JSON.stringify(r2.json)}`);
  const r3 = await rawCall(worcaUrl, 'GET', `/api/extension/pair/${r1.json.requestId}`, { headers: { origin, 'x-worca-pair-poll': r1.json.pollKey } });
  if (r3.json?.status !== 'approved' || !r3.json.token) throw new Error(`pair poll → ${r3.status} ${JSON.stringify(r3.json)}`);
  return r3.json.token;
}
