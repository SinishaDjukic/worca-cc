// test/helpers/marketplace-sheet-harness.mjs — one jsdom window and a fake Marketplace page for P6's sheet controllers
// (each builds its own P3 sheet layer): a scripted api ("METHOD url" → response or fn(body)), recorded acts / loads /
// toasts / navigations / cache drops, scripted confirm / prompt answers, and an instant wait() on a fake clock.
import { JSDOM } from 'jsdom';

export const ok = (data) => ({ ok: true, status: 200, data });
export const fail = (status, data) => ({ ok: false, status, data });
export const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
export const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };

export function sheetHarness({ trackDom = (d) => d, plugins = [], channelStatus = [], routes = {}, confirms = [], prompts = [] } = {}) {
  const { window } = trackDom(new JSDOM('<!doctype html><body><button id="opener" type="button">opener</button></body>',
    { url: 'http://localhost/#marketplace/installed' }));
  const doc = window.document;
  const calls = [];
  const api = async (method, url, body) => {
    calls.push([method, url, body]);
    const r = routes[`${method} ${url}`];
    return (typeof r === 'function' ? await r(body || {}) : r) || fail(404, { error: 'no route' });
  };
  const listeners = new Set();
  const page = {
    state: { tab: 'installed', plugins, orphans: [], marketplaces: [], channelStatus, policy: null },
    loads: 0, acts: [],
    load() { this.loads += 1; return Promise.resolve(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(next) { this.state = { ...this.state, ...next }; for (const fn of listeners) fn(this.state); },
    act(...a) { this.acts.push(a); },
  };
  const notified = [];
  const navigated = [];
  let clock = 0;
  const waits = [];
  const deps = {
    api, gitOn: () => true,
    notify: (t) => notified.push(t),
    navigate: (hash) => navigated.push(hash),
    invalidateAgentCaches: () => calls.push(['invalidate']),
    confirmModal: async (o) => { calls.push(['confirm', o.title]); return confirms.length ? confirms.shift() : true; },
    promptModal: async (o) => { calls.push(['prompt', o.title, o.message || '']); return prompts.length ? prompts.shift() : null; },
  };
  return { window, doc, calls, page, deps, notified, navigated, waits,
    wait: async (ms) => { waits.push(ms); clock += ms; }, now: () => clock };
}
