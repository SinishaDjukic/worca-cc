// test/helpers/onboarding-app-boot.mjs — boot the real ui/public/app.js in jsdom against a stub
// server whose /api/onboarding behaves like the real one for the Workspaces flag, the
// "How it works" guidesSeen map and guidesReset (pattern: test/ui-workspaces.test.mjs).
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { readIndexHtml } from '../../src/core/read-index-html.mjs';
import { GETTING_STARTED_STEPS } from '../../ui/public/getting-started.mjs';

const appPath = fileURLToPath(new URL('../../ui/public/app.js', import.meta.url));
const tick = () => new Promise((r) => setTimeout(r, 0));
export const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };
export const click = (win, node) => node.dispatchEvent(new win.Event('click', { bubbles: true, cancelable: true }));

export const WS_ONE = [{ id: 'wks-alpha-00000001', name: 'Alpha WS', description: '', projectPaths: ['/a/svc-iam', '/a/svc-ui'], projectKeys: ['k1', 'k2'], exists: [true, true], createdAt: 'x', updatedAt: 'x' }];
export const PROJECTS = [{ name: 'svc-iam', path: '/a/svc-iam', exists: true, key: 'k1' }, { name: 'svc-ui', path: '/a/svc-ui', exists: true, key: 'k2' }];
// Keeps its listeners, so a test can deliver a server frame (a cross-tab "onboarding-changed").
class WSStub {
  static last = null;
  constructor() { this.readyState = 1; this.handlers = {}; WSStub.last = this; }
  send() {}
  close() {}
  addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
}

function onboardingPayload(state) {
  return {
    steps: Object.fromEntries(GETTING_STARTED_STEPS.map((s) => [s.id, s.id === 'project'])), done: 1, total: GETTING_STARTED_STEPS.length,
    claude: { bin: 'claude', hint: null, auth: 'signed-in' }, hidden: state.hidden, welcomeSeen: true, workspaceGuideSeen: state.seen, fresh: false,
    guidesSeen: structuredClone(state.guidesSeen),
  };
}

// What the server does with one POST body.
function applyPost(state, body) {
  if (typeof body.workspaceGuideSeen === 'boolean') state.seen = body.workspaceGuideSeen;
  if (typeof body.hidden === 'boolean') state.hidden = body.hidden;
  if (body.guidesReset === true) { state.guidesSeen = {}; state.seen = false; }
  if (body.guidesSeen && typeof body.guidesSeen === 'object') Object.assign(state.guidesSeen, body.guidesSeen);
}

/**
 * @param {object} o
 * @param {(w:JSDOM)=>JSDOM} o.trackDom   the suite's useDomRelease(afterEach) tracker
 * @param {boolean} [o.seen]               the legacy Workspaces flag
 * @param {object}  [o.guidesSeen]         the server's "How it works" map
 * @param {boolean} [o.hidden]             the checklist is hidden from the sidebar
 * @param {object[]} [o.workspaces]
 * @param {boolean} [o.onboardingDown]     /api/onboarding answers 500
 * @param {string[]} [o.flags]             feature flags on in the shell (<html data-flags>)
 * @param {string}  [o.level]              interface mode (<html data-level>); none = expert
 */
export async function bootApp({ trackDom, seen = false, guidesSeen = {}, hidden = false, workspaces = [], onboardingDown = false, flags = [], level = '' } = {}) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  const state = { seen, hidden, guidesSeen: structuredClone(guidesSeen) };
  const posts = [];
  const requests = [];
  let list = structuredClone(workspaces);
  const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  if (flags.length) window.document.documentElement.dataset.flags = flags.join(' ');
  if (level) window.document.documentElement.dataset.level = level;
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    requests.push({ url: u, method: opts.method || 'GET' });
    if (u.includes('/api/onboarding')) {
      if (onboardingDown) return json(500, { error: 'down' });
      if (opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        posts.push(body);
        applyPost(state, body);
      }
      return json(200, onboardingPayload(state));
    }
    if (/\/api\/workspaces\/[^/?]+$/.test(u) && opts.method === 'DELETE') {
      list = list.filter((w) => !u.endsWith(w.id));
      if (!list.length && state.seen) { state.seen = false; state.guidesSeen.workspaces = true; }   // what the server's reset does
      return json(200, { ok: true, warnings: [] });
    }
    // Pages this stub has no data for show their own error line instead of painting a shape it would have to invent.
    if (u.includes('/api/stats') || u.includes('/api/mcp')) return json(404, { error: 'not served by this stub' });
    if (u.includes('/api/projects')) return json(200, { projects: PROJECTS });
    if (u.endsWith('/api/workspaces') || u.includes('/api/workspaces?')) return json(200, { workspaces: structuredClone(list) });
    return json(200, { config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await settle();
  const show = async (hash = 'workspaces') => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); await settle(); };
  const doc = window.document;
  const frame = (msg) => { for (const fn of WSStub.last?.handlers.message || []) fn({ data: JSON.stringify(msg) }); };
  return { window, doc, show, posts, requests, frame, server: state, guide: () => doc.getElementById('workspace-guide-modal') };
}
