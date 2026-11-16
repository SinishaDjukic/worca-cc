// test/helpers/stillhet-projects-host.mjs — Stillhet Projects and Workspaces in the live kind (slice 9): the app host over
// dev-shaped answers. PJ_SOURCES are the store's reads (projects, their sync, workspaces); PJ_LISTS the reads a page makes
// on open (a workspace's map with evidence, a project's settings and defaults, a workspace's defaults).
import { liveHost, LISTS, SOURCES, settle, go, clone, toastText, closeHosts } from './stillhet-chat-live-host.mjs';
export { settle, go, clone, toastText, closeHosts };

const at = (h) => new Date(Date.UTC(2026, 10, 14, h)).toISOString();
const P = (key, name, extra = {}) => ({ key, name, path: `/src/${name}`, displayPath: `~/src/${name}`, exists: true, vcs: 'git', ownedFolder: false, ...extra });
export const KEYS = Object.freeze({ ok: 'seed-ok-1111aaaa', behind: 'seed-behind-2222bbbb', local: 'seed-local-3333cccc', folder: 'seed-folder-4444dddd', moved: 'seed-moved-5555eeee', owned: 'seed-owned-6666ffff', offline: 'seed-offline-7777aaaa' });
export const WS = 'wks-seed-shop-8888bbbb';
export const PJ_SOURCES = Object.freeze({
  projects: { projects: [P(KEYS.ok, 'seed-ok'), P(KEYS.behind, 'seed-behind'), P(KEYS.local, 'seed-local'), P(KEYS.folder, 'seed-folder', { vcs: 'none', workMode: 'folder' }),
    P(KEYS.moved, 'seed-moved', { exists: false }), P(KEYS.owned, 'seed-owned', { vcs: 'none', workMode: 'folder', ownedFolder: true }), P(KEYS.offline, 'seed-offline')] },
  sync: { projects: {
    [KEYS.ok]: { base: 'main', remote: 'origin', state: 'up-to-date', ahead: 0, behind: 0, fetchedAt: at(9) },
    [KEYS.behind]: { base: 'main', remote: 'origin', state: 'behind', ahead: 0, behind: 2, fetchedAt: at(9) },
    [KEYS.local]: { base: 'main', remote: null, state: 'no-upstream', ahead: 0, behind: 0 },
    [KEYS.offline]: { base: 'main', remote: 'origin', state: 'unknown', fetchError: 'could not reach origin', fetchedAt: at(9) },
  } },
  workspaces: { workspaces: [{ id: WS, name: 'Seed shop', description: 'A shop over two projects.', projectKeys: [KEYS.ok, KEYS.local], projectPaths: ['/src/seed-ok', '/src/seed-local'], exists: [true, true], mapSummary: { scannedAt: at(8) } }] },
});
export const SETTINGS = { own: {}, roles: [],
  effective: { 'pr.open': { value: 'none', source: 'user' }, 'run.engine': { value: 'claude', source: 'user' }, pipelineCostLimitUsd: { value: 50, source: 'user' }, 'memory.team': { value: false, source: 'default' }, runUserClaudeSettings: { value: true, source: 'user' } },
  layers: { 'pr.open': { user: 'none', default: 'none' }, 'run.engine': { user: 'claude', default: 'claude' }, pipelineCostLimitUsd: { user: 50, default: null }, 'memory.team': { default: false }, runUserClaudeSettings: { user: true, default: false } } };
export const PJ_LISTS = Object.freeze({
  [`/api/workspaces/${WS}/map`]: { edges: [{ id: 'e_shop_1', from: KEYS.ok, to: KEYS.local, kind: 'http', confidence: 'heuristic', state: 'auto', evidence: { from: [{ file: 'src/client.js', line: 3, match: 'GET /invoices' }], to: [] } }] },
  [`/api/workspaces/${WS}/defaults`]: { tags: ['team:shop'], labels: ['shop'] },
  ...Object.fromEntries(Object.values(KEYS).flatMap((k) => [[`/api/projects/${k}/settings`, SETTINGS], [`/api/projects/${k}/tags/defaults`, { tags: ['team:web'], labels: [] }]])),
});

// COV-1: Add probes a typed folder first, and a refused probe blocks Add (as classic): by default every folder is a git one
const PROBE_GIT = { exists: true, isDir: true, vcs: 'git' };
/** The live app host on Projects: `write(url, body, method)` answers a write, `hold(url)` holds any request back,
 *  `read(url)` answers a GET itself, `beforeScripts(win)` runs before the pages load (a timer the test fires itself). Returns liveHost's { w, d, calls, sockets }. */
export async function projectsHost({ hash = '#projects', write = () => [200, { ok: true }], hold = () => null, read = () => null, sources = {}, beforeScripts = () => {} } = {}) {
  // jsdom's window has no structuredClone (a browser's has): the workspace draft copies its projects with it
  const h = await liveHost({ hash: '#chat', sources: { ...clone(SOURCES), ...clone(PJ_SOURCES), ...sources }, lists: { ...LISTS, ...clone(PJ_LISTS) }, write, hold, read: (u) => read(u) ?? (u.startsWith('/api/projects/probe?') ? [200, PROBE_GIT] : null), beforeScripts: (win) => { win.structuredClone ||= structuredClone; beforeScripts(win); } });
  await go(h.w, hash, 200);
  await settle(120);
  return h;
}
/** The requests that write, as [method, url, body]. */
export const sent = (calls) => calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.url, c.body]);
/** A held request: its promise and the function that lets it through. */
export const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
/** Each RailWould phrase asked for while the host runs: none may be, live. */
export const noWould = (win) => { const orig = win.RailWould; win.__would = []; win.RailWould = (ph) => { win.__would.push(ph); return orig(ph); }; };
/** Before the pages load: every 5 s timer (the toast's undo window) waits in `win.__undo` for the test to fire it. */
export const undoTimers = (win) => { const real = win.setTimeout.bind(win); win.__undo = []; win.setTimeout = (fn, ms, ...a) => (ms === 5000 ? (win.__undo.push(fn), 1e6 + win.__undo.length) : real(fn, ms, ...a)); };
