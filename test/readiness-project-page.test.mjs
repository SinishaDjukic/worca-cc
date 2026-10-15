// test/readiness-project-page.test.mjs — the readiness chip on the project page header, and the way back to the
// report from the Settings tab: the header chip opens the same popover as the list chip, the Agent readiness card's
// "View report" opens it, and a readiness change repaints the header chip.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const NOT_READY = JSON.parse(readFileSync(new URL('./fixtures/readiness-report-not-ready.json', import.meta.url), 'utf8'));
const READY = {
  ...NOT_READY,
  level: 'ready',
  engines: { ...NOT_READY.engines, claude: { ...NOT_READY.engines.claude, level: 'ready', failing: [] } },
  counts: { ...NOT_READY.counts, mustFix: 0, shouldFix: 0 },
};
const KEY = 'alpha-00000001';
const summary = (r) => ({ level: r.level, failingCount: r.counts.mustFix + r.counts.shouldFix, ...r.counts });

class WSStub {
  constructor() { WSStub.last = this; this.readyState = 0; this._listeners = {}; }
  send() {} close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  _open() { this.readyState = 1; (this._listeners.open || []).forEach((fn) => fn({})); }
  _frame(msg) { (this._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(msg) })); }
}

async function boot(state) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4321/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes(`/api/projects/${KEY}/readiness`)) return ok({ readiness: state.report });
    if (u.includes(`/api/projects/${KEY}/settings`)) return ok({ own: {}, effective: {} });
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
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const click = (window, node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));

async function goHash(window, hash) {
  window.location.hash = hash;
  await settle();
}

const headChip = (doc) => doc.querySelector('#proj-detail .pd-row1 .pd-rd-slot .pl-rd');
const openPops = (doc) => [...doc.querySelectorAll('.readiness-pop')].filter((m) => !m.hidden);

test('the project page header shows the readiness chip after the name', async () => {
  const { window } = await boot({ report: NOT_READY });
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}`);
  const chip = headChip(doc);
  assert.ok(chip, 'a chip in the header');
  assert.match(chip.textContent, /^Not agent-ready/);
  assert.equal(doc.querySelector('#proj-detail .pd-title').textContent.trim(), 'alpha', 'the name keeps its own element');
  assert.equal(doc.querySelector('#proj-detail .pd-title').nextElementSibling.className, 'pd-rd-slot');
});

test('the header chip opens the readiness popover and stays on the project page', async () => {
  const { window } = await boot({ report: NOT_READY });
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}`);
  click(window, headChip(doc));
  await settle();
  const pops = openPops(doc);
  assert.equal(pops.length, 1, 'one popover open');
  assert.match(pops[0].textContent, /Agent readiness/);
  assert.equal(window.location.hash, `#projects/${KEY}`);
});

test('"View report" on the Settings card opens the header chip popover', async () => {
  const { window } = await boot({ report: NOT_READY });
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}/settings`);
  const card = doc.querySelector(`.readiness-settings-card[data-key="${KEY}"]`);
  assert.ok(card, 'the Agent readiness card is on the Settings tab');
  const link = [...card.querySelectorAll('button')].find((b) => b.textContent === 'View report');
  assert.ok(link, 'the card has a View report button');
  click(window, link);
  await settle();
  const pops = openPops(doc);
  assert.equal(pops.length, 1, 'the popover is open after the click finished');
  assert.equal(headChip(doc).getAttribute('aria-expanded'), 'true', 'it is the header chip that opened');
  assert.equal(window.location.hash, `#projects/${KEY}/settings`, 'still on the Settings tab');
});

test('a readiness change repaints the header chip', async () => {
  const state = { report: NOT_READY };
  const { window } = await boot(state);
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}/settings`);
  assert.match(headChip(doc).textContent, /^Not agent-ready/);
  state.report = READY;
  WSStub.last._frame({ type: 'readiness-changed', action: KEY });
  await settle();
  assert.equal(headChip(doc).textContent, 'Agent-ready');
});

test('"Settings" in the header popover, while already on the Settings tab, closes it and goes to the card', async () => {
  const { window } = await boot({ report: NOT_READY });
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}/settings`);
  click(window, headChip(doc));
  await settle();
  const pop = openPops(doc)[0];
  const settings = [...pop.querySelectorAll('.rp-foot a')].find((a) => a.textContent === 'Settings');
  click(window, settings);
  await settle();
  assert.equal(openPops(doc).length, 0, 'the popover closed');
  assert.equal(doc.activeElement, doc.querySelector(`.readiness-settings-card[data-key="${KEY}"]`), 'focus is on the card');
});
