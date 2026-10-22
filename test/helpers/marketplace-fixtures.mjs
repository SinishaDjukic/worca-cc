// test/helpers/marketplace-fixtures.mjs — marketplace P3 fixtures (board 1.1 data, trimmed): two marketplaces, one stale.
import { JSDOM } from 'jsdom';
import { createMarketplacePage } from '../../ui/public/marketplace/page.mjs';

export const OFF = { id: 'off', name: 'Worca CC Official', url: 'https://github.com/SinishaDjukic/worca-cc', builtin: true, ref: 'dev',
  lastSync: { sha: `735b354${'a'.repeat(33)}`, at: '2026-10-20T09:57:00.000Z' }, lastError: null, warnings: [],
  plugins: [
    { name: 'github-source', subdir: 'plugins/github-source', description: 'Pull tasks from GitHub Issues, write results back', version: '0.3.0', notes: [],
      inventory: { taskSources: [{ id: 'github', displayName: 'GitHub Issues', secrets: ['token'] }] } },
    { name: 'slack-chat', subdir: 'plugins/slack-chat', description: 'Two-way Slack channel via Socket Mode', version: '0.1.0', notes: [],
      inventory: { chatChannels: [{ id: 'slack', displayName: 'Slack', secrets: ['botToken', 'appToken'] }] } },
    { name: 'release-notes', subdir: 'plugins/release-notes', description: 'Release notes workflow with its agents and skill', version: '0.1.0', notes: [],
      inventory: { agents: [{ key: 'release-drafter' }, { key: 'changelog-checker' }], skills: ['release-style'], workflows: ['Release notes'] } },
  ] };
export const BD = { id: 'bd', name: 'BD-AI-SDLC/worca-marketplace', url: 'https://github.com/BD-AI-SDLC/worca-marketplace',
  lastSync: { sha: `16b6363${'b'.repeat(33)}`, at: '2026-09-03T12:00:00.000Z' },
  lastError: { message: 'HTTP 403', code: 'UNREACHABLE', at: '2026-10-20T09:57:00.000Z' }, warnings: [],
  plugins: [{ name: 'bmf-models', subdir: 'bmf-models', description: 'BMF Models', version: null, notes: [],
    inventory: { models: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }] } }] };
export const ROWS = [{ name: 'github-source', version: '0.2.0', marketplace: 'off', enabled: true, linked: false,
  contributions: { taskSources: 1, chatChannels: 0, models: 0, mcpServers: 0, agents: 0, scripts: 0, skills: 0, workflows: 0 },
  ignored: [], mcpSets: ['General'], skillSets: [], latest: { version: '0.3.0', sha: OFF.lastSync.sha, marketplace: 'off', access: [] } }];

/** deps for createMarketplacePage / mountMarketplace: api answers by "METHOD url" (a function returns the whole result). */
export function fakeDeps(routes = {}) {
  const calls = []; const msgs = []; const navs = []; const seen = [];
  const answers = { 'GET /api/plugins': { plugins: ROWS, orphans: [] }, 'GET /api/marketplaces': { marketplaces: [OFF, BD] },
    'GET /api/chat/status': { channels: [] }, 'POST /api/marketplaces/refresh': { ok: true, marketplaces: [OFF, BD] } };
  const api = async (method, url, body) => {
    calls.push(`${method} ${url}`);
    const r = routes[`${method} ${url}`];
    return typeof r === 'function' ? r(body) : { ok: true, status: 200, data: r ?? answers[`${method} ${url}`] ?? {} };
  };
  const fallbacks = {
    openInstallConsent: (e) => { seen.push(['consent', e.name, e.marketplace, e.sha]); },
  };
  const deps = { api, notify: () => {}, confirmModal: async () => false, openMenu: () => null, gitOn: () => true,
    navigate: (h) => navs.push(h), setMsg: (t, k) => msgs.push([t, k ?? null]), loadPolicy: async () => ({ requirements: [] }), fallbacks };
  return { deps, calls, msgs, navs, seen };
}

/** A page on a bare document (#plugins-msg + #mk-root) at `url`; `mount` = mountMarketplace to test the registration
 *  lines. `navigate` records the hash and really moves the address, as app.js's does. */
export function pageHarness({ trackDom, routes = {}, mount = null, url = 'http://localhost:4319/#marketplace' } = {}) {
  const { window } = trackDom(new JSDOM('<!doctype html><body><p id="plugins-msg"></p><div id="mk-root"></div></body>', { url }));
  const doc = window.document; const f = fakeDeps(routes);
  const record = f.deps.navigate;
  f.deps.navigate = (h) => { record(h); window.location.hash = h; };
  const page = mount ? mount({ doc, win: window, deps: f.deps })
    : createMarketplacePage({ doc, win: window, host: doc.getElementById('mk-root'), deps: f.deps });
  return { window, doc, page, ...f };
}
