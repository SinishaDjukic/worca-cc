// src/core/executor/backends/k8s-api.mjs
// The few Kubernetes API calls the kubernetes backend needs — create/get/list/delete a pod, its
// log tail, and a watch on one pod — over plain HTTPS with undici, no client library. In a
// cluster the defaults are the service-account mount (KUBERNETES_SERVICE_HOST/PORT, the token,
// the CA and the namespace under /var/run/secrets/kubernetes.io/serviceaccount); each can be
// overridden for another cluster or a test fake:
//
//   WORCA_K8S_API_URL       https://host:port (or http:// for a fake)
//   WORCA_K8S_TOKEN_FILE    bearer token file; re-read when older than 5 min or after a 401
//   WORCA_K8S_CA_FILE       the API server's CA bundle (PEM)
//   WORCA_K8S_NAMESPACE     the namespace worker pods live in
//
// The API server is never reached through HTTPS_PROXY: every request goes through its own
// undici Agent (a dispatcher of our own bypasses the proxy-aware global one). Errors from the
// API arrive as a `Status` body; they surface as `K8sApiError { status, reason, message }`.
import { readFileSync } from 'node:fs';
import { sleep } from '../shared.mjs';
import { fetch, Agent } from 'undici';

const SA_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';
const TOKEN_MAX_AGE_MS = 5 * 60_000;
const WATCH_TIMEOUT_S = 300;
const WATCH_FAILURES_BEFORE_POLL = 3;

export class K8sApiError extends Error {
  constructor({ status, reason, message, method, path }) {
    super(message);
    this.name = 'K8sApiError';
    this.status = status;
    this.reason = reason || null;
    this.method = method;
    this.path = path;
  }
}

const readText = (file) => { try { return readFileSync(file, 'utf8'); } catch { return null; } };
const isAbort = (err) => err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.cause?.name === 'AbortError';

/** The API endpoint, token/CA files and namespace from the environment (pure; no I/O). */
export function k8sApiConfig(env = process.env) {
  const explicit = String(env.WORCA_K8S_API_URL || '').trim();
  const host = String(env.KUBERNETES_SERVICE_HOST || '').trim();
  const port = String(env.KUBERNETES_SERVICE_PORT || '443').trim();
  const apiUrl = explicit || (host ? `https://${host.includes(':') ? `[${host}]` : host}:${port}` : null);
  return {
    apiUrl: apiUrl ? apiUrl.replace(/\/+$/, '') : null,
    tokenFile: String(env.WORCA_K8S_TOKEN_FILE || '').trim() || `${SA_DIR}/token`,
    caFile: String(env.WORCA_K8S_CA_FILE || '').trim() || `${SA_DIR}/ca.crt`,
    namespace: String(env.WORCA_K8S_NAMESPACE || '').trim() || null,
  };
}

/**
 * A client bound to one API server. `pollMs` / `retryMs` are the watch fallback's cadence and the
 * reconnect backoff (tests shrink them).
 */
export function createK8sApi({ env = process.env, log = () => {}, pollMs = 2000, retryMs = 1000 } = {}) {
  const cfg = k8sApiConfig(env);
  if (!cfg.apiUrl) throw new Error('no Kubernetes API: set WORCA_K8S_API_URL, or run inside a cluster (KUBERNETES_SERVICE_HOST)');
  const namespace = cfg.namespace || readText(`${SA_DIR}/namespace`)?.trim() || 'default';
  const ca = cfg.apiUrl.startsWith('https:') ? readText(cfg.caFile) : null;
  // An https API with a CA file that cannot be read would fail every call later with a certificate error that reads
  // as a cluster problem: say what it is now.
  if (cfg.apiUrl.startsWith('https:') && cfg.caFile && ca == null) throw new Error(`cannot read the Kubernetes API CA bundle ${cfg.caFile} (WORCA_K8S_CA_FILE, or the service account mount)`);
  const dispatcher = new Agent({ connect: ca ? { ca } : {} });
  let token = { value: null, readAt: 0 };

  const bearer = (force = false) => {
    if (force || !token.value || Date.now() - token.readAt > TOKEN_MAX_AGE_MS) {
      token = { value: readText(cfg.tokenFile)?.trim() || null, readAt: Date.now() };
    }
    return token.value;
  };

  const url = (path, query = {}) => {
    const u = new URL(cfg.apiUrl + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    return u;
  };

  async function toError(res, method, path) {
    let body = null; let text = '';
    try { text = await res.text(); body = JSON.parse(text); } catch { /* not a Status */ }
    const message = body?.message || text.slice(0, 500) || `${res.status} ${res.statusText}`;
    return new K8sApiError({ status: res.status, reason: body?.reason || null, message: `${message}`, method, path });
  }

  /** One request with the bearer token; a 401 re-reads the token and retries once. */
  async function request(method, path, { query, body, headers = {}, signal, stream = false, retried = false } = {}) {
    const t = bearer(retried);
    const res = await fetch(url(path, query), {
      method, dispatcher, signal,
      headers: { accept: 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && !retried) { await res.body?.cancel().catch(() => {}); return request(method, path, { query, body, headers, signal, stream, retried: true }); }
    if (!res.ok) throw await toError(res, method, path);
    if (stream) return res;
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  const podsPath = (ns) => `/api/v1/namespaces/${encodeURIComponent(ns)}/pods`;
  const podPath = (ns, name) => `${podsPath(ns)}/${encodeURIComponent(name)}`;

  const api = {
    namespace,
    apiUrl: cfg.apiUrl,

    createPod: (ns, manifest, { signal } = {}) => request('POST', podsPath(ns), { body: manifest, signal }),

    getPod: (ns, name, { signal } = {}) => request('GET', podPath(ns, name), { signal }),

    async listPods(ns, { labelSelector, signal } = {}) {
      const list = await request('GET', podsPath(ns), { query: { labelSelector }, signal });
      return Array.isArray(list?.items) ? list.items : [];
    },

    /** Delete a pod; a pod that is already gone is fine (null). */
    async deletePod(ns, name, { gracePeriodSeconds, signal } = {}) {
      try {
        return await request('DELETE', podPath(ns, name), {
          query: { gracePeriodSeconds }, signal,
          body: { apiVersion: 'v1', kind: 'DeleteOptions', ...(gracePeriodSeconds != null ? { gracePeriodSeconds } : {}) },
        });
      } catch (err) {
        if (err instanceof K8sApiError && err.status === 404) return null;
        throw err;
      }
    },

    /** The log tail of the pod's container, or null when the API refuses (403) or has nothing (404/400). */
    async podLog(ns, name, { tailLines = 50, container, signal } = {}) {
      try {
        const res = await request('GET', `${podPath(ns, name)}/log`, { query: { tailLines, container }, signal, stream: true, headers: { accept: 'text/plain' } });
        return await res.text();
      } catch (err) {
        if (err instanceof K8sApiError && [400, 403, 404].includes(err.status)) return null;
        throw err;
      }
    },

    /**
     * Follow one pod until `signal` aborts: `onEvent(type, pod)` for every ADDED/MODIFIED/DELETED
     * event the watch streams (NDJSON, reconnecting with the last resourceVersion when the server
     * closes it). After three consecutive failed connects it polls the pod every `pollMs` instead,
     * delivering each state as MODIFIED (DELETED when the pod is gone).
     */
    async watchPod(ns, name, { resourceVersion, signal, onEvent } = {}) {
      let rv = resourceVersion;
      let failures = 0;
      let errorEvents = 0;   // ERROR events in a row with nothing delivered between them
      const deliver = (type, obj) => { if (obj?.metadata?.resourceVersion) rv = obj.metadata.resourceVersion; if (!signal?.aborted) onEvent(type, obj); };
      while (!signal?.aborted) {
        if (failures >= WATCH_FAILURES_BEFORE_POLL) {
          try {
            const pod = await api.getPod(ns, name, { signal });
            deliver('MODIFIED', pod);
          } catch (err) {
            if (isAbort(err) || signal?.aborted) return;
            if (err instanceof K8sApiError && err.status === 404) { deliver('DELETED', { metadata: { name } }); return; }
            log(`watch ${ns}/${name}: poll failed: ${err.message}`);
          }
          await sleep(pollMs, signal);
          continue;
        }
        let res;
        try {
          res = await request('GET', podsPath(ns), {
            query: { watch: 1, fieldSelector: `metadata.name=${name}`, resourceVersion: rv, timeoutSeconds: WATCH_TIMEOUT_S, allowWatchBookmarks: 'true' },
            signal, stream: true,
          });
        } catch (err) {
          if (isAbort(err) || signal?.aborted) return;
          failures += 1;
          log(`watch ${ns}/${name}: connect failed (${failures}): ${err.message}`);
          await sleep(Math.min(retryMs * failures, 5000), signal);
          continue;
        }
        failures = 0;
        try {
          for await (const line of ndjson(res.body)) {
            let ev;
            try { ev = JSON.parse(line); } catch { continue; }
            if (ev.type === 'ERROR') {
              // 410 Gone: our resourceVersion is too old; start over from the current state. Any other error status
              // (a 500, "too many requests") would be answered the same way again at once: back off, more each time.
              if (ev.object?.code === 410) rv = undefined;
              else { errorEvents += 1; log(`watch ${ns}/${name}: ${ev.object?.message || 'error event'} (${errorEvents})`); await sleep(Math.min(retryMs * errorEvents, 5000), signal); }
              break;
            }
            if (ev.type === 'BOOKMARK') { if (ev.object?.metadata?.resourceVersion) rv = ev.object.metadata.resourceVersion; continue; }
            errorEvents = 0;
            deliver(ev.type, ev.object);
          }
        } catch (err) {
          if (isAbort(err) || signal?.aborted) return;
          failures += 1;
          log(`watch ${ns}/${name}: stream dropped (${failures}): ${err.message}`);
          await sleep(Math.min(retryMs * failures, 5000), signal);
        }
      }
    },

    /** Drop every connection, open watches included (close() would wait for them). */
    async close() { await dispatcher.destroy().catch(() => {}); },
  };
  return api;
}

/** Lines of a chunked NDJSON body. */
async function* ndjson(body) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield line;
    }
  }
  const rest = (buf + decoder.decode()).trim();
  if (rest) yield rest;
}
