// test/helpers/stillhet-chat-live-host.mjs — the live-kind Chat host and the helpers the stillhet-chat-app-host-*.test.mjs
// files share. The tests are split in four files: every file runs in its own process, so one file's jsdom windows (never
// freed while the process lives) cannot slow the next file's tests past CI's 300 s per file.
import assert from 'node:assert/strict';
import { stillhetHost } from './stillhet-host.mjs';
import { SOURCES, NOW, THREAD, RUN_STATE } from './stillhet-live-fixture.mjs';
import { SOURCES as URLS } from '../../ui/public/stillhet/live/live-adapter.mjs';
export { SOURCES, NOW, THREAD, RUN_STATE, URLS };
export const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
export const BY_URL = Object.fromEntries(Object.entries(URLS).map(([k, u]) => [u, k]));
export const clone = (x) => JSON.parse(JSON.stringify(x));
export const toastText = (d) => (d.defaultView.RailHost?.toastEl || d.querySelector('body > .rc-toast'))?.textContent || '';

// dev's GET lists a Chat control picks from (chat-live.mjs CATALOG)
export const LISTS = {
  '/api/ask/models': { models: [{ id: 'opus', label: 'Opus 5.5', efforts: ['low', 'medium', 'high'] }, { id: 'sonnet', label: 'Sonnet 5.5', efforts: ['low', 'high'] }, { id: 'gpt', label: 'Codex 5', engine: 'codex', efforts: ['high'] }], default: { model: 'opus', effort: 'high' } },
  '/api/chat-home/pins': { pins: ['wf_shape'] },
  '/api/workflows': { workflows: [{ id: 'wf_shape', name: 'Shaper' }, { id: 'wf_lean', name: 'Lean' }] },
  '/api/guardrails': { guardrails: [{ id: 'normal', name: 'Normal' }, { id: 'strict', name: 'Strict' }, { id: 'permissive', name: 'Permissive' }] },
};
// each test's window closes when that test ends: the pages keep timers on it, and 48 open windows slow every later test
export const closers = [];
export async function liveHost({ sources = SOURCES, thread = () => [200, THREAD], write = () => [200, {}], hash = '#chat', lists = LISTS, beforeScripts = () => {}, hold = () => null } = {}) {
  const calls = [], sockets = [];
  const fetch = async (u, o = {}) => {
    const url = String(u), method = o.method || 'GET', body = o.body ? JSON.parse(o.body) : undefined;
    if (url !== '/api/ask/mcp-preview' && url !== '/api/history/pr') calls.push({ url, method, body });   // the Sets preview and History's PR lookup are reads (POST by dev's design)
    await hold(url);   // a source held back: its answer lands when the test says
    const [status, data] = method !== 'GET' ? await write(url, body, method) : BY_URL[url] ? [200, clone(sources[BY_URL[url]] ?? {})] : lists[url] ? [200, lists[url]] : url.startsWith('/api/ask/threads/') ? await thread(url) : [404, {}];
    return { ok: status < 300, status, json: async () => clone(data) };
  };
  const w = stillhetHost({ adapter: 'live', hash, fetch, after: (fn) => closers.push(fn), beforeScripts: (win) => {
    win.WebSocket = class { constructor(url) { this.url = url; this.readyState = 1; sockets.push(this); } close() {} send() {} };
    win.Date.now = () => NOW;
    win.Element.prototype.scrollIntoView = function () {};
    win.Element.prototype.scrollTo = function () {};
    beforeScripts(win);
  } });
  w.RailAdapter.importLive = () => import('../../ui/public/stillhet/live/live-adapter.mjs');
  await settle();
  sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'hello', bootId: 'b', runs: sources.hello.runs }) });
  await settle();
  return { w, d: w.document, calls, sockets };
}
export const go = async (w, hash, ms = 60) => { w.location.hash = hash; await settle(ms); };
export const store = (w) => clone({ data: w.RailWorld.data(), chats: w.RailWorld.part('chats') });
// Step 7's DISABLED_OK: the only controls the live kind may draw disabled, each for its runtime reason. At rest none of
// them holds, so the walk finds no disabled control at all; a pending one is checked in its own test above.
export const DISABLED_OK = Object.freeze({
  '[data-cp-mic]': 'the browser gives the page no microphone (voiceSupport says no)',
  '[data-bulk]': 'a busy chat in the bulk bar (dev refuses CHAT_BUSY)',
  '[data-cp-send]': 'Send while the message is on its way',
  '[data-pp-start], [data-live], [data-act], [data-cp-apply], [data-changes-send], [data-direction-send], [data-wt-yes]': 'its action is pending (asserted in the pending test)',
});
export const CONTROLS = 'button, a[href], [role="menuitem"], [role="option"], input, textarea';
export async function walk(w, d, rootSel) {
  const seen = [], disabled = [];
  const all = () => [...d.querySelectorAll(`${rootSel} :is(${CONTROLS})`)];
  const n = all().length;
  for (let k = 0; k < n; k++) {
    const el = all()[k];
    if (!el) continue;
    if (el.disabled) { disabled.push(el.outerHTML.slice(0, 120)); continue; }
    if (el.matches('input, textarea')) { el.focus(); el.dispatchEvent(new w.Event('input', { bubbles: true })); continue; }
    if (el.matches('[data-dl-copy], [data-copy]')) continue;   // the clipboard: its own test (copy)
    el.click(); await settle(5);
    seen.push(toastText(d));
    if (d.querySelector('dialog[open], .discard-modal[open]')) d.querySelector('dialog[open] [data-dialog-no], dialog[open] .btn-quiet')?.click();
  }
  return { n, seen, disabled };
}
export const posts = (calls) => calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.url, c.body]);
export const withRun = (over) => { const src = clone(SOURCES); src.hello.runs = src.hello.runs.map((r) => (r.runId === 'run-a' ? { ...r, ...over } : r)); return src; };
// run-a ended: the store holds it as its saved row (pipeline pa), stopped, and ask_1's card is that task's
export const stoppedRun = () => { const src = clone(SOURCES); src.hello.runs = src.hello.runs.filter((r) => r.runId !== 'run-a'); src.history.pipelines = src.history.pipelines.map((r) => (r.id === 'pa' ? { ...r, status: 'stopped' } : r)); return src; };
// Chromium blurs a focused button the moment it is disabled; jsdom does not, so the test does (blur first, then set)
export function blurOnDisable(win) {
  const proto = win.HTMLButtonElement.prototype, desc = Object.getOwnPropertyDescriptor(proto, 'disabled');
  Object.defineProperty(proto, 'disabled', { configurable: true, get() { return desc.get.call(this); }, set(v) { if (v) this.blur(); desc.set.call(this, v); } });
}
export const menuPick = async (d, menuId, item) => { d.querySelector(`#route-chat [data-menu="${menuId}"]`).click(); await settle(5); d.querySelector(`#route-chat [data-menu-pick="${menuId}|${item}"]`).click(); await settle(40); };
// a page's own sentence (RailPulse.say, the first `body > .rc-toast`) next to the host's refusal toast
export const saidText = (d) => [...d.querySelectorAll('body > .rc-toast')].map((e) => e.textContent).join(' | ');
export const savedRun = (row) => { const src = clone(SOURCES); src.hello.runs = src.hello.runs.filter((r) => r.runId !== 'run-a'); src.history.pipelines = src.history.pipelines.map((r) => (r.id === 'pa' ? { ...r, ...row } : r)); return src; };
export const cardItems = async (d, id) => { d.querySelector(`#route-chat [data-menu="card:${id}"]`).click(); await settle(5); return [...d.querySelectorAll(`#route-chat [data-menu-pick^="card:${id}|"]`)].map((e) => e.dataset.menuPick.split('|')[1]); };
/** Closes every window opened since the last call: each test file calls it in afterEach. */
export const closeHosts = () => { while (closers.length) closers.pop()(); };
