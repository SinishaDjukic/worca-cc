// src/core/env-proxy.mjs
// Node's built-in fetch() ignores HTTP_PROXY / HTTPS_PROXY / NO_PROXY unless the process
// opts in (--use-env-proxy or NODE_USE_ENV_PROXY=1, both read only at startup). On a
// network whose only way out is a proxy (a corporate LAN), every outbound call then died
// with "fetch failed" (ENOTFOUND github.com: Copilot sign-in) while curl and git, which
// honor the variables, worked. Each process entry point (ui/server.mjs, the CLI, the
// plugin connector and chat channel children) calls useEnvProxy() once at boot. A Node
// with http.setGlobalProxyFromEnv uses it (fetch and the http(s) global agents); every
// other supported Node (22.x, 24.x LTS today) gets undici's EnvHttpProxyAgent as fetch's
// global dispatcher, which works from 22.13 on.
//
// Loopback always bypasses the proxy: the app calls itself (the model bridge, the UI
// probe, the broker on this host), and a machine with HTTP_PROXY but no NO_PROXY would
// otherwise send those calls to the proxy. Nothing here throws: no proxy set or a
// malformed proxy URL leaves fetch exactly as it was.
//
// No worca imports, and node:http loads only once a proxy is set: the plugin children
// run with no WORCA_HOME (a store import would resolve wrong paths), and every connector
// op starts one (the plugin-shim and channel-host tests pin their import closures).

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** The loopback names (remote-access.mjs LOCAL_HOSTNAMES), always appended to NO_PROXY. */
const LOOPBACK = ['localhost', '127.0.0.1', '::1', '[::1]'];

/** undici is CommonJS, so it loads synchronously; null when it can't be loaded. */
function loadUndici() {
  try { return require('undici'); } catch { return null; }
}

/**
 * Route this process's fetch() through the proxy named by the environment, with loopback
 * always direct.
 * @param {{env?: Record<string, string|undefined>, api?: {setGlobalProxyFromEnv?: Function}, undici?: object|null}} [opts]
 *   `api` defaults to node:http.
 * @returns {{status: 'off'|'on'|'unsupported'|'invalid', error?: string, restore: () => void}}
 */
export function useEnvProxy({ env = process.env, api, undici } = {}) {
  const none = () => {};
  const proxied = env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY;
  if (!proxied) return { status: 'off', restore: none };
  // Node and undici read no_proxy before NO_PROXY; merge both and set both so the list wins.
  const listed = [];
  for (const v of [env.no_proxy, env.NO_PROXY]) {
    for (const h of String(v || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!listed.includes(h)) listed.push(h);
    }
  }
  const noProxy = [...listed, ...LOOPBACK.filter((h) => !listed.includes(h))].join(',');
  const http = api === undefined ? require('node:http') : api;
  try {
    if (typeof http.setGlobalProxyFromEnv === 'function') {
      const restore = http.setGlobalProxyFromEnv({ ...env, no_proxy: noProxy, NO_PROXY: noProxy });
      return { status: 'on', restore: typeof restore === 'function' ? restore : none };
    }
    const lib = undici === undefined ? loadUndici() : undici;
    if (!lib || typeof lib.EnvHttpProxyAgent !== 'function') return { status: 'unsupported', restore: none };
    const agent = new lib.EnvHttpProxyAgent({
      httpProxy: env.http_proxy || env.HTTP_PROXY,
      httpsProxy: env.https_proxy || env.HTTPS_PROXY,
      noProxy,
    });
    const before = lib.getGlobalDispatcher();
    lib.setGlobalDispatcher(agent);
    return { status: 'on', restore: () => { lib.setGlobalDispatcher(before); agent.close().catch(() => {}); } };
  } catch (err) {
    // Node's message for a bad URL is the URL itself, and proxy URLs often carry user:password.
    const error = err && (err.code === 'ERR_PROXY_INVALID_CONFIG' || err.code === 'ERR_INVALID_URL' || err instanceof TypeError)
      ? 'HTTP_PROXY / HTTPS_PROXY is not a valid proxy URL'
      : (err && err.message) || String(err);
    return { status: 'invalid', error, restore: none };
  }
}

/** D8: the proxy variables changed at runtime: undo the previous install, then install from env again. */
export function reinstallEnvProxy(prev, opts = {}) {
  try { prev?.restore?.(); } catch { /* the old dispatcher is gone */ }
  return useEnvProxy(opts);
}

/**
 * The one line an entry point prints about useEnvProxy()'s result, or null for 'off'.
 * @param {{status: string, error?: string}} result
 * @returns {{level: 'info'|'warn', text: string}|null}
 */
export function proxyNotice(result) {
  switch (result.status) {
    case 'on': return { level: 'info', text: 'outbound requests use the proxy from HTTP(S)_PROXY (NO_PROXY and loopback go direct)' };
    case 'invalid': return { level: 'warn', text: `proxy: ${result.error}; outbound requests go direct` };
    case 'unsupported': return { level: 'warn', text: `proxy: HTTP(S)_PROXY is set, but Node ${process.version} cannot apply it to fetch; outbound requests go direct` };
    default: return null;
  }
}
