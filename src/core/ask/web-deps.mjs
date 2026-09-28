// src/core/ask/web-deps.mjs
// The web bundle of the Ask MCP child. Config comes ONLY from WORCA_ASK_WEB, which the parent
// sets per turn from askWebAccess() (settings ⊕ team policy) — absent ⇒ no bundle ⇒ no web tools.
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { normalizeDomainList, ANY_HOST } from '../web-allowlist.mjs';
import { redactAskText } from './redact.mjs';
import { createWebFetcher, createWebSearcher, httpsTransport, guardedLookup } from './web-fetch.mjs';
import { createWebValidator } from './web-proposal.mjs';

const LOG_MAX_BYTES = 5 * 1024 * 1024;

export function parseWebEnv(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let v; try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== 'object' || !Array.isArray(v.allowedDomains)) return null;
  // An empty list is web access ON with every host behind an approval card; ['*'] is the any-host switch.
  const allowedDomains = v.allowedDomains.includes(ANY_HOST) ? [ANY_HOST] : normalizeDomainList(v.allowedDomains).domains;
  const s = v.search;
  const search = s && typeof s.url === 'string' && s.url.startsWith('https://') && s.url.includes('{query}')
    ? { url: s.url, keyHeader: typeof s.keyHeader === 'string' ? s.keyHeader : '', keyPrefix: typeof s.keyPrefix === 'string' ? s.keyPrefix : '', keyVar: typeof s.keyVar === 'string' ? s.keyVar : null }
    : null;
  return { allowedDomains, search };
}

/** One JSON line per web call (refusals too) in <worcaHome>/logs/ask-web.jsonl — redacted, clipped URLs only. */
export function webRequestLogger({ threadId = null, file = null } = {}) {
  return (entry) => {
    const path = file || join(worcaHome(), 'logs', 'ask-web.jsonl');
    try {
      mkdirSync(join(path, '..'), { recursive: true });
      try { if (statSync(path).size > LOG_MAX_BYTES) renameSync(path, `${path}.1`); } catch { /* first write */ }
      const line = { ts: new Date().toISOString(), threadId, ...entry, url: entry.url ? redactAskText(entry.url).slice(0, 512) : null,
        finalUrl: entry.finalUrl ? redactAskText(entry.finalUrl).slice(0, 512) : null };
      appendFileSync(path, `${JSON.stringify(line)}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch (err) { process.stderr.write(`[ask-mcp] web log failed: ${err?.message || err}\n`); }
  };
}

export function defaultWebDeps({ threadId = null, signal = null, env = process.env, transport = httpsTransport, lookup = guardedLookup, log = null } = {}) {
  const cfg = parseWebEnv(env.WORCA_ASK_WEB);
  if (!cfg) return {};
  const logger = log || webRequestLogger({ threadId });
  const fetcher = createWebFetcher({ allowedDomains: cfg.allowedDomains, transport, lookup, signal, log: logger });
  const key = cfg.search?.keyVar && typeof env[cfg.search.keyVar] === 'string' ? env[cfg.search.keyVar].trim() : '';
  const searcher = cfg.search ? createWebSearcher({ search: cfg.search, key, allowedDomains: cfg.allowedDomains, transport, lookup, signal, log: logger }) : null;
  return {
    web: {
      allowedDomains: cfg.allowedDomains,
      fetch: (url) => fetcher.fetch(url),
      validateProposal: createWebValidator({ allowed: () => cfg.allowedDomains }),
      ...(searcher ? { search: (q, n) => searcher.search(q, n) } : {}),
    },
  };
}
