// test/helpers/readiness-project-boot.mjs — boots the real app.js in jsdom on one project with a stubbed API, for the
// project page's readiness tests (test/readiness-project-page.test.mjs, test/readiness-project-runs.test.mjs).
// makeBoot takes the file's own useDomRelease tracker, so each window is released in that file's afterEach.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { readIndexHtml } from '../../src/core/read-index-html.mjs';

const appPath = fileURLToPath(new URL('../../ui/public/app.js', import.meta.url));
export const NOT_READY = JSON.parse(readFileSync(new URL('../fixtures/readiness-report-not-ready.json', import.meta.url), 'utf8'));
export const READY = {
  ...NOT_READY,
  level: 'ready',
  engines: { ...NOT_READY.engines, claude: { ...NOT_READY.engines.claude, level: 'ready', failing: [] } },
  counts: { ...NOT_READY.counts, mustFix: 0, shouldFix: 0 },
};
export const KEY = 'alpha-00000001';
const summary = (r) => ({ level: r.level, failingCount: r.counts.mustFix + r.counts.shouldFix, ...r.counts });

export class WSStub {
  constructor() { WSStub.last = this; this.readyState = 0; this._listeners = {}; }
  send() {} close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  _open() { this.readyState = 1; (this._listeners.open || []).forEach((fn) => fn({})); }
  _frame(msg) { (this._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(msg) })); }
}

export function makeBoot(trackDom) {
  return async function boot(state) {
    const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4321/' }));
    const { window } = dom;
    window.Element.prototype.scrollIntoView = function () {};
    window.WebSocket = WSStub;
    window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
    const fail = () => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    // The project settings layer: GET reads `state.own`, PATCH replaces the keys it names (null removes one), as the server does.
    state.own = state.own || {};
    state.patches = [];
    window.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes(`/api/projects/${KEY}/readiness-run`)) { state.posts = (state.posts || []).concat(opts.method || 'GET'); state.bodies = (state.bodies || []).concat(opts.body ? JSON.parse(opts.body) : null); return ok({ runId: 'run-setup-1' }); }
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
        return ok({ projects: [{ name: 'alpha', path: '/Users/me/dev/alpha', exists: true, key: KEY, readiness: summary(state.report) }] });
      }
      if (u.includes('/api/history')) return ok({ pipelines: [], ghAvailable: false });
      return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [], workspaces: [], agents: [], channels: [] });
    };
    for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
      try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
    }
    globalThis.window = window; globalThis.document = window.document;
    await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
    await new Promise((r) => setTimeout(r, 0));
    if (WSStub.last) WSStub.last._open();
    return { window };
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
export const cardOf = (doc) => doc.querySelector(`.readiness-settings-card[data-key="${KEY}"]`);
