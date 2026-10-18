// src/core/ask/refs.mjs — POST /api/ask/refs/resolve (Chat answer chips, ui/public/ask-ref-chips.mjs): one batch of
// ref keys (src/shared/chip-refs.mjs) → a title and a status per ref. worca's own runs and chats are read fresh on
// every call (the route passes those lookups in). GitHub and Azure DevOps answers are cached per key — OK_TTL_MS for
// an answer, MISS_TTL_MS for none — with one lookup in flight per key (however long it takes), at most PROVIDER_CAP
// provider calls at once across every batch, and a lookup that fails (no credential, 404, offline, a timeout) answers
// { ok:false }: the chip keeps its plain ref. A batch answers within REFS_DEADLINE_MS: a ref still pending then is
// { ok:false } for this batch, while its lookup goes on and fills the cache for the next one. Errors never reach the
// answer, so no provider text (or token) can either.
// Pure: the providers are injected (server.mjs wires git-info.mjs and pr/azure.mjs); no I/O here.
import { parseRefKey } from '../../shared/chip-refs.mjs';

export const OK_TTL_MS = 60_000;
export const MISS_TTL_MS = 30_000;
export const CACHE_MAX = 2000;
export const PROVIDER_CAP = 4;
export const REFS_DEADLINE_MS = 15_000;
const MISS = Object.freeze({ ok: false });
const ITEM_STATES = new Set(['open', 'draft', 'merged', 'closed']);
const str = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');

/** A provider's item → the wire shape, or MISS. `kinds`: what that provider may answer. */
function item(x, kinds) {
  if (!x || !kinds.includes(x.kind) || typeof x.title !== 'string' || typeof x.state !== 'string' || !x.state) return MISS;
  if (x.kind !== 'workitem' && !ITEM_STATES.has(x.state)) return MISS;
  return { ok: true, kind: x.kind, title: str(x.title, 300), state: str(x.state, 40), ...(x.kind === 'workitem' ? { type: str(x.type, 40) } : {}) };
}
/** A run by its History id, or by its app run id alone while the run has no History row yet. */
function run(x) {
  const id = x && typeof x.id === 'string' && x.id ? x.id : null;
  const runId = x && typeof x.runId === 'string' && x.runId ? x.runId : null;
  if (!id && !runId) return MISS;
  return { ok: true, kind: 'run', id, runId, title: str(x.title, 300), status: str(x.status, 40),
    pauseReason: typeof x.pauseReason === 'string' ? x.pauseReason : null, home: typeof x.home === 'string' ? x.home : null };
}
const chat = (x) => (x && typeof x.title === 'string' ? { ok: true, kind: 'chat', title: str(x.title, 300) } : MISS);
const safely = (fn, id) => { try { return typeof fn === 'function' ? fn(id) : null; } catch { return null; } };

/**
 * @param {{ github?: (repo: string, numbers: number[]) => Promise<Map<number, object>>,
 *   azurePr?: (ref: {org: string, project: string, number: number}) => Promise<object|null>,
 *   workItems?: (org: string, ids: number[]) => Promise<Map<number, object>>, now?: () => number }} providers
 */
export function createRefResolver({ github = null, azurePr = null, workItems = null, now = () => Date.now() } = {}) {
  const cache = new Map();   // key -> { at, ttl, promise } — insertion order is age (a refresh re-inserts)
  const queue = [];          // provider calls waiting for one of the PROVIDER_CAP slots, oldest first
  let busy = 0;
  /** Run one provider call in a free slot (at once when one is free), else after the calls queued before it. */
  async function capped(fn) {
    if (busy < PROVIDER_CAP) busy++;
    else await new Promise((r) => { queue.push(r); });   // a finishing call hands its slot straight on
    try { return await fn(); } finally { const next = queue.shift(); if (next) next(); else busy--; }
  }

  function cached(key) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < hit.ttl) return hit.promise;
    if (hit) cache.delete(key);
    return null;
  }
  function remember(key, promise) {
    const entry = { at: now(), ttl: Infinity, promise };   // in flight: shared until it settles, then timed from then
    cache.set(key, entry);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    promise.then((r) => { entry.at = now(); entry.ttl = r && r.ok ? OK_TTL_MS : MISS_TTL_MS; });
    return promise;
  }

  /** One provider call per GitHub repo, per Azure PR, per Azure organization's work items. → key -> Promise<result>. */
  function lookup(refs) {
    const groups = new Map();
    const add = (gk, make, r) => { if (!groups.has(gk)) groups.set(gk, { refs: [], make }); groups.get(gk).refs.push(r); };
    for (const r of refs) {
      if (r.kind === 'gh') add(`gh:${r.owner}/${r.repo}`.toLowerCase(), async (rs) => {
        const m = github ? await github(`${rs[0].owner}/${rs[0].repo}`, rs.map((x) => x.number)) : null;
        return rs.map((x) => item(m instanceof Map ? m.get(x.number) : null, ['pr', 'issue']));
      }, r);
      else if (r.kind === 'adopr') add(r.key, async (rs) => [item(azurePr ? await azurePr({ org: rs[0].org, project: rs[0].project, number: rs[0].number }) : null, ['pr'])], r);
      else if (r.kind === 'adowi') add(`adowi:${r.org}`.toLowerCase(), async (rs) => {
        const m = workItems ? await workItems(rs[0].org, rs.map((x) => x.number)) : null;
        return rs.map((x) => item(m instanceof Map ? m.get(x.number) : null, ['workitem']));
      }, r);
    }
    const tasks = [...groups.values()].map((g) => ({ ...g, promise: capped(() => g.make(g.refs)).catch(() => null)
      .then((out) => (Array.isArray(out) ? out : g.refs.map(() => MISS))) }));
    const out = {};
    for (const t of tasks) t.refs.forEach((r, i) => { out[r.key] = remember(r.key, t.promise.then((rs) => rs[i] || MISS)); });
    return out;
  }

  /**
   * @param {string[]} keys   unparseable keys are dropped from the answer
   * @param {{ run?: (id: string) => object|null, chat?: (id: string) => object|null, external?: boolean }} local
   *   the request's own lookups (a chat the caller may not see answers null); external:false = no GitHub / Azure call
   * @returns {Promise<Record<string, object>>} key -> { ok:true, kind, … } | { ok:false }
   */
  async function resolve(keys, { run: runOf = null, chat: chatOf = null, external = true } = {}) {
    const out = {};
    const todo = [];
    for (const key of new Set(Array.isArray(keys) ? keys : [])) {
      const r = parseRefKey(key);
      if (!r) continue;
      if (r.kind === 'run') out[key] = run(safely(runOf, r.id));
      else if (r.kind === 'chat') out[key] = chat(safely(chatOf, r.id));
      else if (!external) out[key] = MISS;
      else out[key] = cached(key) || (todo.push(r), null);
    }
    Object.assign(out, lookup(todo));
    let timer = null;
    const late = new Promise((r) => { timer = setTimeout(r, REFS_DEADLINE_MS, MISS); });
    if (timer && typeof timer.unref === 'function') timer.unref();
    try {
      const entries = await Promise.all(Object.entries(out).map(async ([k, v]) => [k, (await Promise.race([Promise.resolve(v).catch(() => MISS), late])) || MISS]));
      return Object.fromEntries(entries);
    } finally { clearTimeout(timer); }
  }

  return { resolve, clear: () => cache.clear(), get size() { return cache.size; } };
}
