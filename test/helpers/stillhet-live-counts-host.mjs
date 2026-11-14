// test/helpers/stillhet-live-counts-host.mjs — the live-kind app host and the helpers the stillhet-live-counts-*.test.mjs files
// share. The tests are split in three files: in one process each jsdom window is kept until the process ends and every
// later test gets slower, so one long file passed CI's 300 s per file; a file is its own process.
import { stillhetHost } from './stillhet-host.mjs';
import { SOURCES, NOW } from './stillhet-live-fixture.mjs';
import { SOURCES as URLS } from '../../ui/public/stillhet/live/live-adapter.mjs';
import { countNeedsYou } from '../../src/shared/needs-you.mjs';
export { SOURCES, NOW, URLS, countNeedsYou };

const closers = [];
/** Closes every window opened since the last call: each test file calls it in afterEach. */
export const closeHosts = () => { while (closers.length) closers.pop()(); };

export const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
export const BY_URL = Object.fromEntries(Object.entries(URLS).map(([k, u]) => [u, k]));
export const clone = (x) => JSON.parse(JSON.stringify(x));

// Hand-computed from the fixture: tasks that need you by dev's rule (run-a asks, run-c paused, h1 paused; pa is live, so its
// saved row does not count), the missed ticket, and two projects (gone-3's folder is missing, api-2 is out of sync).
export const TASK_NEEDS = 3, MISSED = 1, PROJECT_NEEDS = 2, BELL = TASK_NEEDS + MISSED + PROJECT_NEEDS;

// read(url) → [status, data] answers a GET no source names (a workspace's map); null falls through to the sources.
export async function liveHost({ sources = SOURCES, getStatus = () => 200, post = () => [200, {}], read = () => null, level = 'expert', hash = '#chat', before } = {}) {
  const gets = [], posts = [], sockets = [];
  const fetch = async (u, o = {}) => {
    const url = String(u), method = o.method || 'GET';
    if (url === '/api/ask/mcp-preview') return { ok: true, status: 200, json: async () => ({ sets: [] }) };   // Chat's Sets preview: a read, POST by dev's design
    if (url === '/api/history/pr') return { ok: true, status: 200, json: async () => ({ ok: true }) };   // History's PR lookup: a read, its answer comes as frames
    if (method !== 'GET') {
      const body = o.body ? JSON.parse(o.body) : null; posts.push({ url, method, body });
      const [status, data] = post(url, body);
      return { ok: status < 300, status, json: async () => data };
    }
    gets.push(url);
    const own = read(url);
    if (own) return { ok: own[0] < 300, status: own[0], json: async () => clone(own[1]) };
    const s = getStatus(url), key = BY_URL[url];
    return { ok: s < 300, status: s, json: async () => clone(sources[key] ?? {}) };
  };
  const w = stillhetHost({ adapter: 'live', level, hash, fetch, after: (fn) => closers.push(fn), beforeScripts: (win) => {
    win.WebSocket = class { constructor(url) { this.url = url; sockets.push(this); } close() {} send() {} };
    win.Date.now = () => NOW;
    if (before) before(win);
  } });
  w.RailAdapter.importLive = () => import('../../ui/public/stillhet/live/live-adapter.mjs');
  const hello = async (runs = sources.hello.runs) => { await settle(); sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'hello', bootId: 'b', runs }) }); await settle(); };
  return { w, d: w.document, gets, posts, sockets, hello };
}
export const bellN = (d) => { const b = d.querySelector('#rail-pulse-slot .topnav-badge'); return b ? +b.textContent : null; };
export const openAcct = (d) => { if (!d.querySelector('#app .acct-menu')) d.querySelector('[data-acct]').click(); };
export const toastText = (d) => d.querySelector('body > .rc-toast')?.textContent || '';
export const store = (w) => clone({ data: w.RailWorld.data(), parts: ['chats', 'schedules', 'projects', 'costs', 'updates', 'actions', 'away', 'keep'].map((k) => w.RailWorld.part(k)) });
export const DEMO_NAMES = ['Add CSV export to billing', 'Fix flaky login test', 'billing-api', 'Billing CSV export', 'Nightly export check'];
export const REFUSE = { error: 'not now' };
export async function refusalHost() {
  const h = await liveHost({ post: () => [409, REFUSE] });
  await h.hello();
  return h;
}

// Two live workspaces (D10): w1's map has one heuristic and one inferred auto link (2 questions), one exact and one verified
// (no question), a manual one (no question, no Undo) and a stale and a missing one (never drawn); w2's map read fails, so it has none and the bell is still drawn.
const EDGE = (id, from, to, confidence, state = 'auto') => ({ id, from, to, kind: 'http', display: `${from} → ${to}`, confidence, state });
export const WORKSPACES = { workspaces: [{ id: 'w1', name: 'Shop', description: '', projectKeys: ['web-1', 'api-2'], exists: [true, true], mapSummary: { scannedAt: '2026-11-12T10:00:00Z' } },
  { id: 'w2', name: 'Broken map', description: '', projectKeys: ['web-1'], exists: [true], mapSummary: null }] };
export const MAPS = { w1: { edges: [EDGE('x_000000000001', 'web-1', 'api-2', 'heuristic'), EDGE('x_000000000002', 'api-2', 'web-1', 'inferred'),
  EDGE('x_000000000003', 'web-1', 'gone-3', 'exact'), EDGE('x_000000000004', 'api-2', 'gone-3', 'verified'),
  EDGE('x_000000000005', 'api-2', 'web-1', undefined, 'manual'), EDGE('x_000000000006', 'web-1', 'api-2', 'heuristic', 'stale'), EDGE('x_000000000007', 'web-1', 'api-2', 'inferred', 'missing')] } };
export const WS_QUESTIONS = 2;
export const mapRead = (maps = MAPS) => (u) => { const m = /^\/api\/workspaces\/([\w-]+)\/map$/.exec(u); return m ? (maps[m[1]] ? [200, maps[m[1]]] : [500, { error: 'boom' }]) : null; };
export const withWorkspaces = () => ({ ...clone(SOURCES), workspaces: clone(WORKSPACES) });
