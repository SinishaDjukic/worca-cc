// test/helpers/stillhet-insights-host.mjs — Stillhet Insights in the live kind (slice 10): the app host over dev-shaped
// answers. GET /api/stats?…, /api/tag-dimensions, /api/team-metrics/scopes, /api/team-metrics?… and /api/policy?… are
// answered by URL prefix; every request URL is recorded (liveHost's `calls`). Options pick the variants: `limit` (the budget,
// or null), `tagKeys` (0 or 1 cost tag keys), `scopes` (0, 1 or 2 enabled team scopes).
import { liveHost, SOURCES, NOW, settle, go, clone, closeHosts } from './stillhet-chat-live-host.mjs';
import { makeRecord } from '../fixtures/team-metrics/records.mjs';
export { settle, go, closeHosts, NOW };

const DAY = 86_400_000, B0 = new Date(2026, 10, 1).getTime(), BUCKETS = [B0, B0 + DAY, B0 + 2 * DAY];
const fact = (id, o) => ({ id, person: 'Maya', project: 'billing-api', workflow: 'Default', status: 'finished', pr: null, tags: {}, usd: 0, hours: 0, inCohort: true, startedMs: B0 + 3600_000, hourBucket: 0, spend: [], ...o });
/** Four runs: Maya $300 (billing-api acme, worca-cc globex failed), Jonas $112.40 (web-app and billing-api, no client). */
export const FACTS = Object.freeze([
  fact('r1', { usd: 250, tags: { client: 'acme' }, spend: [[0, 250]], pr: 'merged' }),
  fact('r2', { person: 'Jonas', project: 'web-app', usd: 100, spend: [[1, 100]], startedMs: B0 + DAY + 1, hourBucket: 1, pr: 'opened' }),
  fact('r3', { project: 'worca-cc', usd: 50, status: 'failed', tags: { client: 'globex' }, spend: [[1, 50]], startedMs: B0 + DAY + 2, hourBucket: 1 }),
  fact('r4', { person: 'Jonas', usd: 12.4, status: 'stopped', spend: [[2, 12.4]], startedMs: B0 + 2 * DAY + 1, hourBucket: 2 }),
]);
/** A stats answer in dev's shape (report=1) for the window, scaled so a re-read is told apart: `k` multiplies every spend. */
export function statsAnswer(k = 1) {
  const runs = FACTS.map((f) => ({ ...f, usd: f.usd * k, spend: f.spend.map(([i, u]) => [i, u * k]) }));
  const per = (i) => runs.reduce((a, f) => a + f.spend.filter(([j]) => j === i).reduce((x, [, u]) => x + u, 0), 0);
  const spent = runs.reduce((a, f) => a + f.usd, 0);
  return { range: 'month', bucket: 'day', windowStartMs: B0, windowEndMs: new Date(2026, 11, 1).getTime(), humanRateUsd: 0,
    totals: { spentUsd: spent, pipelineSpendUsd: spent, humanHours: 0, savedUsd: -spent, runs: 4, finished: 2, failed: 1, stopped: 1, paused: 0, running: 0, prsOpened: 2, prsMerged: 1, ask: { spendUsd: 0 } },
    prev: { spentUsd: 100, humanHours: 0, savedUsd: -100, runs: 1, finished: 1, failed: 0, stopped: 0, prsOpened: 0, prsMerged: 0 },
    series: BUCKETS.map((b, i) => ({ bucketStartMs: b, spentUsd: per(i), finished: [1, 1, 0][i], failed: [0, 1, 0][i], stopped: [0, 0, 1][i] })),
    people: ['Jonas', 'Maya'], report: { buckets: BUCKETS, runs, prevRuns: [fact('p1', { usd: 100 })] }, shaping: { groups: [{ size: 'small', shaped: { runs: 2, avgCostUsd: 4, avgActiveMs: 600000, avgReviewCycles: 1 }, unshaped: { runs: 3, avgCostUsd: 9, avgActiveMs: 900000, avgReviewCycles: 2 } }] } };
}
const at = (d, h = 10) => new Date(Date.UTC(2026, 10, d, h)).toISOString();
export const RECORDS = Object.freeze([
  { ...makeRecord({ id: 't1', startedAt: at(3), usd: 40, actor: 'Maya', project: 'acme/billing-api' }), tags: ['client:acme'] },
  { ...makeRecord({ id: 't2', startedAt: at(4), usd: 25, actor: 'Jonas', project: 'acme/web-app' }) },
  { ...makeRecord({ id: 't3', startedAt: at(5), usd: 10, actor: 'Maya', project: 'acme/web-app', result: 'failed' }) },
]);
const SCOPES = [{ id: 'project:billing-api-1111aaaa', label: 'billing-api' }, { id: 'workspace:wks-shop', label: 'Shop' }];

export function insightsLists({ limit = 100, tagKeys = 1, scopes = 1 } = {}) {
  return {
    budget: { totalLimitUsd: limit, resetPeriod: 'monthly', windowSpendUsd: 412.4, windowSavedUsd: 0, windowEndMs: new Date(2026, 11, 1).getTime() },
    answer(url) {
      if (url === '/api/tag-dimensions') return [200, { dims: tagKeys ? [{ key: 'client', required: true }] : [] }];
      if (url === '/api/team-metrics/scopes') return [200, { projects: [], workspaces: [], scopes: { projects: SCOPES.slice(0, Math.min(scopes, 1)), workspaces: scopes > 1 ? SCOPES.slice(1) : [] }, anyEnabled: scopes > 0 }];
      if (url.startsWith('/api/team-metrics?')) return [200, { scope: {}, records: clone(RECORDS), humanRateUsd: 0, aggregate: null }];
      if (url.startsWith('/api/policy?')) return [404, { error: 'no policy', code: 'NOT_FOUND' }];
      if (url.startsWith('/api/stats?')) return [200, statsAnswer(url.includes('range=custom') ? 2 : 1)];
      return null;
    },
  };
}

/** dev's POST /api/team-metrics/prs answer for the asked runs (#1310): `prs` is run id → PRs (an absent id is [] : looked
 *  up, none), a status code (a refusal with dev's error), or 'unknown' (every entry null: no source could read them). */
export function prsAnswer(prs, body) {
  if (typeof prs === 'number') return [prs, { error: 'gh is not signed in' }];
  const ids = (body?.runs || []).map((r) => r.id);
  return [200, { prs: Object.fromEntries(ids.map((id) => [id, prs === 'unknown' ? null : clone(prs[id] || [])])), status: { gh: prs === 'unknown' ? 'missing' : 'ok', actionRepos: [] } }];
}

/** The live app on `hash` (Expert), its Insights reads answered from the fixtures; `read` and `hold` come first. `records`
 *  replaces the team records, `prs` answers the PR lookups (prsAnswer), `events` the scope's PR events. */
export async function insightsHost({ hash = '#insights/spend', limit = 100, tagKeys = 1, scopes = 1, hold = () => null, read = () => null, write, beforeScripts = () => {}, records = null, prs = {}, events = [] } = {}) {
  const v = insightsLists({ limit, tagKeys, scopes });
  const own = (u) => (records && u.startsWith('/api/team-metrics?') ? [200, { scope: {}, records: clone(typeof records === 'function' ? records() : records), humanRateUsd: 0, aggregate: null }] : u.startsWith('/api/team-metrics/pr-events?') ? [200, { prs: clone(events) }] : null);
  const writes = async (u, body, m) => (u === '/api/team-metrics/prs' ? prsAnswer(prs, body) : write ? write(u, body, m) : [200, {}]);
  const h = await liveHost({ hash: '#chat', sources: { ...clone(SOURCES), budget: v.budget }, hold, write: writes, read: async (u) => (await read(u)) || own(u) || v.answer(u),
    beforeScripts: (win) => { win.structuredClone ||= structuredClone; beforeScripts(win); } });
  await go(h.w, hash, 200); await settle(150);
  return h;
}
/** Insights' own reads, in order. */
export const insightsCalls = (calls) => calls.map((c) => c.url).filter((u) => /^\/api\/(stats|tag-dimensions|team-metrics|policy)/.test(u));
