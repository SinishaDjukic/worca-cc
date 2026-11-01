// src/broker/upstream-request.mjs
// The broker's calls to a model upstream, made with fetch() behind the small part of
// http.request()'s interface service.mjs uses: end(body), destroy(err), and the
// 'response' / 'error' / 'timeout' events (timeout = no bytes for `timeout` ms).
//
// Why fetch: useEnvProxy() (src/core/env-proxy.mjs) routes fetch through HTTP(S)_PROXY
// on every supported Node, NO_PROXY and loopback direct. http(s).request only follows
// the proxy on a Node with http.setGlobalProxyFromEnv; elsewhere (the undici fallback)
// the model upstream went direct behind a corporate proxy while the Copilot token calls,
// which use fetch, were proxied.
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

/**
 * @param {URL} url
 * @param {{method?:string, headers?:Record<string, string|string[]>, timeout?:number}} opts
 */
export function fetchUpstream(url, { method = 'GET', headers = {}, timeout = 0 } = {}) {
  const req = new EventEmitter();
  const ac = new AbortController();
  let res = null;
  let destroyed = false;
  let timer = null;
  const idle = () => {
    if (!timeout || destroyed) return;
    clearTimeout(timer);
    timer = setTimeout(() => req.emit('timeout'), timeout);
    timer.unref?.();
  };

  req.destroy = (err) => {
    if (destroyed) return req;
    destroyed = true;
    clearTimeout(timer);
    // Like ClientRequest, an abort with no reason still errors whoever is waiting: the
    // response stream once it exists, else the request. service.mjs books and releases
    // the concurrency slot from those 'error' handlers (an agent hanging up mid-stream).
    // The response goes first: on Node 24 the abort errors it with its own AbortError.
    const e = err || Object.assign(new Error(res ? 'aborted' : 'socket hang up'), { code: 'ECONNRESET' });
    if (res && !res.readableEnded) res.destroy(e);
    ac.abort();
    if (err || !res) process.nextTick(() => req.emit('error', e));
    return req;
  };

  req.end = (body) => {
    // fetch sets content-length itself, and refuses a body on GET/HEAD (even an empty one).
    const h = {};
    for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() !== 'content-length') h[k] = Array.isArray(v) ? v.join(', ') : v;
    const withBody = body && body.length && method !== 'GET' && method !== 'HEAD';
    idle();
    fetch(url, { method, headers: h, body: withBody ? body : undefined, redirect: 'manual', signal: ac.signal }).then((r) => {
      if (destroyed) { r.body?.cancel().catch(() => {}); return; }
      res = r.body ? Readable.fromWeb(r.body) : Readable.from([]);
      res.statusCode = r.status;
      res.headers = Object.fromEntries(r.headers);
      res.on('data', idle);
      res.on('end', () => clearTimeout(timer));
      res.on('error', () => clearTimeout(timer));
      idle();
      req.emit('response', res);
    }, (err) => {
      clearTimeout(timer);
      if (!destroyed) { destroyed = true; req.emit('error', err); }
    });
    return req;
  };
  return req;
}
