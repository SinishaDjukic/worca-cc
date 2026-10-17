// test/helpers/git-app-boot.mjs — boot the real shell + app.js in jsdom with <html data-git>, a recording fetch and a
// WS stub (ui-clone-project.test.mjs's recipe). The caller passes its useDomRelease tracker.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { renderIndexHtml } from '../../src/core/index-html.mjs';

const html = readFileSync(fileURLToPath(new URL('../../ui/public/index.html', import.meta.url)), 'utf8');
const appPath = fileURLToPath(new URL('../../ui/public/app.js', import.meta.url));
const tick = () => new Promise((r) => setTimeout(r, 0));
const json = (status, body) => Promise.resolve({ ok: status < 300, status, json: async () => body });
class WSStub {
  constructor() { WSStub.last = this; this.readyState = 0; this._l = {}; }
  send() {} close() {}
  addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); }
  _open() { this.readyState = 1; (this._l.open || []).forEach((fn) => fn({})); }
  _msg(o) { (this._l.message || []).forEach((fn) => fn({ data: JSON.stringify(o) })); }
}
export async function bootGitApp({ trackDom, git = false, projects = [{ name: 'alpha', path: '/data/alpha', exists: true, key: 'alpha-00000001' }] } = {}) {
  const calls = [];
  const { window } = trackDom(new JSDOM(renderIndexHtml(html, 'system', 'expert', undefined, { git }), { url: 'http://localhost:4321/' }));
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub; window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.fetch = (url) => {
    const u = String(url); calls.push(u);
    if (u.startsWith('/api/git')) return json(200, { available: git, version: git ? '2.47.0' : null, reason: git ? 'ok' : 'not-on-path', checkedAt: 1 });
    if (u.includes('/api/fs/pick-folder')) return json(200, { available: false });
    if (u.includes('/api/projects')) return json(200, { projects });
    if (u.includes('/api/history')) return json(200, { pipelines: [], ghAvailable: true });
    return json(200, { config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [], workspaces: [], agents: [], channels: [], projects: {} });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick(); WSStub.last._open(); WSStub.last._msg({ type: 'hello', bootId: 'b1', runs: [], git: { available: git } });
  return { window, doc: window.document, calls, ws: WSStub.last };
}
