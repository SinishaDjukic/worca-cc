// test/helpers/readiness-project-boot.mjs — the project page's readiness tests (test/readiness-project-page.test.mjs,
// test/readiness-project-runs.test.mjs) on one shared boot of the real app.js (test/helpers/shared-app-boot.mjs): each
// test gets its own project key and run id, so the readiness report and run line the app cached for an earlier test
// never apply, and answers the API for that project through app.fresh().
import { readFileSync } from 'node:fs';
export const NOT_READY = JSON.parse(readFileSync(new URL('../fixtures/readiness-report-not-ready.json', import.meta.url), 'utf8'));
export const READY = {
  ...NOT_READY,
  level: 'ready',
  engines: { ...NOT_READY.engines, claude: { ...NOT_READY.engines.claude, level: 'ready', failing: [] } },
  counts: { ...NOT_READY.counts, mustFix: 0, shouldFix: 0 },
};
// The current test's project key and new-run id (set by boot()); a test reads its own from boot()'s answer.
const current = { key: 'alpha-00000001', runId: 'run-setup-1' };
const summary = (r) => ({ level: r.level, failingCount: r.counts.mustFix + r.counts.shouldFix, ...r.counts });

// The server's socket: tests send frames through WSStub.last._frame(msg) as before; on the shared app they go to app.recv.
export const WSStub = { last: null };

export function makeBoot(app) {
  return async function boot(state) {
    const KEY = `alpha-${app.uid('p')}`;
    const runId = app.uid('run-setup-');
    current.key = KEY; current.runId = runId;
    WSStub.last = { _frame: (msg) => app.recv(msg), _open() {} };
    const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
    const fail = () => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    // The project settings layer: GET reads `state.own`, PATCH replaces the keys it names (null removes one), as the server does.
    state.own = state.own || {};
    state.patches = [];
    const fetchHandler = async (u, opts = {}) => {
      if (u.includes(`/api/projects/${KEY}/readiness-run`)) { state.posts = (state.posts || []).concat(opts.method || 'GET'); state.bodies = (state.bodies || []).concat(opts.body ? JSON.parse(opts.body) : null); return ok({ runId }); }
      if (u.includes(`/api/projects/${KEY}/readiness`)) return ok({ readiness: state.report, ...(state.run ? { run: state.run } : state.setup ? { run: { available: { check: false, setup: !!state.setup.available }, hasCode: true, lastCheck: null, lastSetup: state.setup.lastRun, live: null } } : {}) });
      if (u.includes(`/api/projects/${KEY}/settings`)) {
        if (opts.method === 'PATCH') {
          state.patches.push(JSON.parse(opts.body));
          if (state.patchFails) return fail();
          for (const [k, v] of Object.entries(JSON.parse(opts.body))) { if (v === null) delete state.own[k]; else state.own[k] = v; }
          return ok({ ok: true });
        }
        const own = JSON.parse(JSON.stringify(state.own));   // read now, answered after the delay (a slow server)
        if (state.getDelayMs) await new Promise((r) => setTimeout(r, state.getDelayMs));
        return state.getFails ? fail() : ok({ own, effective: {} });
      }
      if (u.includes('/api/projects')) {
        return ok({ projects: [{ name: 'alpha', path: `/Users/me/dev/${KEY}`, exists: true, key: KEY, readiness: summary(state.report) }] });
      }
      if (u.includes('/api/history')) return ok({ pipelines: [], ghAvailable: false });
      return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [], workspaces: [], agents: [], channels: [] });
    };
    await app.fresh({ fetchHandler: (u, opts) => fetchHandler(u, opts) });
    // The project list is loaded once at boot: a changed frame makes the app read this test's list.
    app.recv({ type: 'projects-changed', action: 'added' });
    await settle();
    return { window: app.window, key: KEY, runId };
  };
}

export const tick = () => new Promise((r) => setTimeout(r, 0));
export const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
export const click = (window, node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));

export async function goHash(window, hash) {
  window.location.hash = hash;
  await settle();
}

export const headChip = (doc) => doc.querySelector('#proj-detail .pd-row1 .pd-rd-slot .pl-rd');
export const openPops = (doc) => [...doc.querySelectorAll('.readiness-pop')].filter((m) => !m.hidden);
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const cardOf = (doc) => doc.querySelector(`.readiness-settings-card[data-key="${current.key}"]`);
