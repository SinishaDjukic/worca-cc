// Insights' live reads (slice 10, D8): every Insights read in the live kind goes through here. GETs only; it writes
// nothing to Worca. One cached answer per query key, the newest read per key wins, and the keys of pages no longer open
// are dropped, never re-read. Answers go whole to insights-map.mjs, which is the only code that reads their fields.
import {
  statsQuery, statsSource, statsCsv, shapingSource, teamSource, heatOf, gridOf, untaggedSource, scopesOf, budgetOf, pooledOf,
  monthSpendOf, errorOf, wordsOf, tagKeysOf, recordsOf, LIVE_PAGES, TEAM_PAGES, DIM_OF,
} from './insights-map.mjs';

export const VIEWS_KEY = 'worca-rail.insights-views';
export const TEAM_EMPTY = 'No project shares its team numbers yet';
const STATS_FRAMES = new Set(['pipelines-changed', 'ask-done', 'ask-error', 'budget-changed']);
const TAGS = '/api/tag-dimensions', SCOPES = '/api/team-metrics/scopes';
const DEBOUNCE_MS = 250;
const HEAT_DIMS = ['project', 'workflow', 'client'];

export function startInsightsLive({ fetch, on = () => {}, now = Date.now, setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout, world = () => ({}),
  storage = globalThis.localStorage, model = () => globalThis.window?.RailInsightsModel } = {}) {
  const cache = new Map();   // url → { status: 'loading' | 'ready' | 'failed', data, text, seq }
  let open = new Set(), monthAsked = false, timer = 0, stopped = false;
  const SOFT = (url) => url.startsWith('/api/policy') || url === TAGS;   // a refusal here is "none", never a failed page

  function read(url) {
    const e = cache.get(url) || { status: 'loading' };
    const mine = e.seq = (e.seq || 0) + 1;
    if (e.status === 'failed') e.status = 'loading';
    cache.set(url, e);
    const done = (status, body) => {
      const cur = cache.get(url);
      if (stopped || cur !== e || cur.seq !== mine) return;   // a dropped key, or a newer read of it: never drawn
      const ok = status >= 200 && status < 300;
      if (ok) { cur.status = 'ready'; cur.data = body; }
      else if (SOFT(url)) { cur.status = 'ready'; cur.data = null; }
      else if (cur.status !== 'ready') { cur.status = 'failed'; cur.text = errorOf(status, body); }
      on();
    };
    Promise.resolve().then(() => fetch(url, { headers: { Accept: 'application/json' } })).then(
      (r) => r.json().catch(() => ({})).then((body) => done(r.status, body)),
      () => done(0, {}));
    return e;
  }
  const get = (url) => cache.get(url) || read(url);
  const want = (url) => { open.add(url); return get(url); };
  function prune() {
    const keep = new Set([...open, TAGS, SCOPES]);
    for (const k of cache.keys()) if (!keep.has(k) && !(monthAsked && k === monthKey())) cache.delete(k);
  }
  const tagKeys = () => { const t = get(TAGS); return t.status === 'ready' ? tagKeysOf(t.data) : null; };
  function monthKey() { const keys = tagKeys(); return keys ? statsQuery('this month', { tagKeys: keys, now: now() }) : ''; }
  const statsUrl = (st, keys) => statsQuery(st.from && st.to ? 'custom' : st.when, { from: st.from, to: st.to, tagKeys: keys, now: now() });

  /** D11: is a page in the bar, search and has? null while that is not known yet (the budget or the tag keys unread). */
  function offered(id) {
    if (!LIVE_PAGES.includes(id)) return false;
    if (id === 'budget') { const costs = world()?.costs; return costs ? !!budgetOf(costs, now()) : null; }
    if (id === 'untagged') { const keys = tagKeys(); return keys ? keys.length > 0 : null; }
    return true;
  }
  const stateOf = (e) => (e.status === 'loading' ? { state: 'loading' } : e.status === 'failed' ? { state: 'failed', text: e.text, retry: () => { retryKey(e); } } : null);
  function retryKey(e) { for (const [k, v] of cache) if (v === e) read(k); on(); }
  function subOf(id, src, words, extra = {}) {
    const design = model().SUB[id];
    return { ...design, src, ...(design.liveCols ? { cols: design.liveCols } : {}), ...(words.word != null ? { word: () => words.word } : {}), ...(words.why != null ? { why: () => words.why } : {}), pace: words.pace || '', ...extra };
  }

  function statsPage(id, st, keys) {
    let url;
    try { url = statsUrl(st, keys); } catch (err) { return { state: 'failed', text: err.message, retry: () => on() }; }
    const e = want(url), wait = stateOf(e);
    if (wait) return wait;
    if (id === 'shaping') return { state: 'ready', sub: subOf(id, shapingSource(e.data), {}) };
    const src = statsSource(e.data, { by: st.by, thenBy: st.then, filter: st.filter, page: id, tagKeys: keys, now: now() });
    src.whole = { labels: src.labels, days: src.days, last: src.last };
    if (st.from && st.to) {   // a narrowed read: the from and to pickers list the whole period's days
      const w = want(statsUrl({ ...st, from: null, to: null }, keys));
      if (w.status === 'ready') { const ws = statsSource(w.data, { page: id, tagKeys: keys }); src.whole = { labels: ws.labels, days: ws.days, last: ws.last }; }
    }
    const budget = budgetOf(world()?.costs, now());
    const words = wordsOf(id, src, { budget, now: now(), by: st.by });
    return { state: 'ready', sub: subOf(id, src, words, { budget: budget ? budget.limit : undefined }) };
  }

  function teamPage(id, st, keys) {
    const sc = want(SCOPES), wait = stateOf(sc);
    if (wait) return wait;
    const scopes = scopesOf(sc.data);
    if (!scopes.length) return { state: 'empty', text: TEAM_EMPTY };
    const scope = scopes.find((s) => s.id === st.scope) || scopes[0];
    const t = want(`/api/team-metrics?scope=${encodeURIComponent(scope.id)}&range=all&aggregate=0&defer=1`), tw = stateOf(t);
    if (tw) return tw;
    const { records, humanRateUsd } = recordsOf(t.data);
    const when = st.from && st.to ? 'custom' : st.when, n = now();
    const base = teamSource(records, { when, from: st.from, to: st.to, by: st.by, thenBy: st.then, filter: st.filter, now: n, humanRateUsd, page: id === 'heat' ? 'heat' : 'team' });
    let src = base, pooled = null;
    if (id === 'untagged') src = untaggedSource(base.facts, keys[0], base);
    if (id === 'heat') {
      for (const d of Object.keys(src.rows)) if (!HEAT_DIMS.includes(d)) delete src.rows[d];
      const by = HEAT_DIMS.includes(st.by) ? st.by : 'project';
      src.heat = { [by]: gridOf(heatOf(records, { by: DIM_OF[by], window: { when, from: st.from, to: st.to, filter: st.filter }, now: n })) };
      src.noTime = true;
    }
    if (id === 'team') { const p = want(`/api/policy?scope=${encodeURIComponent(scope.id)}`); pooled = p.status === 'ready' ? pooledOf(p.data, records, n) : null; }
    delete src.facts;
    src.scopes = scopes; src.scope = scope.id;
    src.whole = { labels: src.labels, days: src.days, last: src.last };
    const words = wordsOf(id, src, { pooled, now: n, by: st.by, key: keys[0] });
    return { state: 'ready', sub: subOf(id, src, words, { budget: pooled ? pooled.limit : undefined }) };
  }

  /** D8: one page's state. */
  function page(id, st) {
    open = new Set();
    const off = offered(id);
    if (off === false) { prune(); return { state: 'absent' }; }
    const t = get(TAGS);
    if (t.status === 'loading') return { state: 'loading' };
    const keys = tagKeys() || [];
    const out = TEAM_PAGES.includes(id) ? teamPage(id, st, keys) : statsPage(id, st, keys);
    prune();
    return out;
  }

  /** D24: the page's live CSV, the Cost report's own (dev's reportCsv over dev's allocate); null while unread. */
  function csv(id, st, labels) {
    const keys = tagKeys() || [], e = cache.get(statsUrl(st, keys));
    return e && e.status === 'ready' ? statsCsv(e.data, { by: st.by, thenBy: st.then, filter: st.filter, page: id, ...labels }) : null;
  }

  /** D19: a project's spend this month; null while the read is pending or the project has none. */
  function monthSpend(name) {
    monthAsked = true;
    const key = monthKey();
    if (!key) return null;
    const e = get(key);
    return e.status === 'ready' ? monthSpendOf(e.data, name) : null;
  }

  function frame(f) {
    if (!f || stopped) return;
    if (STATS_FRAMES.has(f.type)) {
      clearTimeout(timer);
      timer = setTimeout(() => { timer = 0; for (const k of [...cache.keys()]) if (k.startsWith('/api/stats')) read(k); }, DEBOUNCE_MS);
    }
    if (f.type === 'team-metrics-changed' && f.action !== 'flush-failed') {   // dev skips a failed flush too (app.js)
      for (const k of [...cache.keys()]) if (k === SCOPES || k.startsWith('/api/team-metrics?') || k.startsWith('/api/policy')) read(k);
    }
  }
  function retry() { for (const [k, v] of [...cache]) if (v.status === 'failed') read(k); on(); }

  // ---- saved views (D18): this browser keeps them ----
  function views() { try { const v = JSON.parse(storage?.getItem(VIEWS_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
  function keepViews(list) { storage.setItem(VIEWS_KEY, JSON.stringify(list)); }
  function saveView(v) {
    try { keepViews([...views(), v]); return { ok: true, text: '' }; } catch { return { ok: false, text: `Could not save ${v.name}: your browser did not keep it` }; }
  }
  function dropView(id) { try { keepViews(views().filter((v) => v.id !== id)); } catch { /* nothing was kept */ } }

  function scopes() { const sc = get(SCOPES); return sc.status === 'ready' ? scopesOf(sc.data) : []; }
  function stop() { stopped = true; clearTimeout(timer); }
  return { page, scopes, offered, monthSpend, csv, views, saveView, dropView, frame, retry, stop };
}
