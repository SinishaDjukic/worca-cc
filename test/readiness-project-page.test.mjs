// test/readiness-project-page.test.mjs — the readiness chip on the project page header, and the way back to the
// report from the Settings tab: the header chip opens the same popover as the list chip, the Agent readiness card's
// "View report" opens it, and a readiness change repaints the header chip.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

const trackDom = useDomRelease(afterEach);

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
    if (u.includes(`/api/projects/${KEY}/readiness`)) return ok({ readiness: state.report });
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
  // Name, then the project-type chip (.pd-kind), then readiness.
  assert.equal(doc.querySelector('#proj-detail .pd-kind').nextElementSibling.className, 'pd-rd-slot');
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

test('the × in the popover head closes it; from the keyboard, focus goes back to the chip', async () => {
  const { window } = await boot({ report: NOT_READY });
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}`);
  const chip = headChip(doc);

  click(window, chip);
  await settle();
  let close = openPops(doc)[0].querySelector('.rp-head .rp-close');
  assert.ok(close, 'a close button in the head');
  assert.equal(close.getAttribute('aria-label'), 'Close');
  assert.equal(close.type, 'button');
  click(window, close);
  await settle();
  assert.equal(openPops(doc).length, 0, 'a pointer click closes it');
  assert.equal(chip.getAttribute('aria-expanded'), 'false');

  chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 0 }));   // Enter on the chip
  await settle();
  close = openPops(doc)[0].querySelector('.rp-close');
  close.focus();
  close.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 0 }));   // Enter on the ×
  await settle();
  assert.equal(openPops(doc).length, 0, 'a keyboard press closes it');
  assert.equal(doc.activeElement, chip, 'focus is back on the chip');
});

test('the × closes the header chip popover and stays on the project page', async () => {
  const { window } = await boot({ report: NOT_READY });
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}`);
  click(window, headChip(doc));
  await settle();
  click(window, openPops(doc)[0].querySelector('.rp-close'));
  await settle();
  assert.equal(openPops(doc).length, 0);
  assert.equal(window.location.hash, `#projects/${KEY}`, 'still on the project page');
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cardOf = (doc) => doc.querySelector(`.readiness-settings-card[data-key="${KEY}"]`);
const segOf = (doc, label) => [...cardOf(doc).querySelectorAll('.rs-row')].find((r) => r.querySelector('.rs-name').textContent === label);

// A focused button that the browser blurs when it is disabled (jsdom does not): blur FIRST, then set.
function blurOnDisable(window) {
  const proto = window.HTMLButtonElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'disabled');
  Object.defineProperty(proto, 'disabled', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) { if (v) this.blur(); desc.set.call(this, v); },
  });
}

test('two quick toggles both land', async () => {
  const state = { report: NOT_READY };
  const { window } = await boot(state);
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}/settings`);
  await wait(10);
  state.getDelayMs = 20;
  const inputs = [...cardOf(doc).querySelectorAll('.sw-input')];
  assert.ok(inputs.length >= 2, 'two check switches');
  for (const input of inputs.slice(0, 2)) { input.checked = true; input.dispatchEvent(new window.Event('change', { bubbles: true })); }
  await wait(150);
  assert.equal(state.own['readiness.ignore'].length, 2, JSON.stringify(state.own));
});

test('a failed settings read writes nothing', async () => {
  const state = { report: NOT_READY, own: { 'readiness.ignore': ['deps.lockfile'], 'readiness.tools': { cursor: 'used' } } };
  const { window } = await boot(state);
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}/settings`);
  await wait(10);
  state.getFails = true;
  const input = cardOf(doc).querySelector('.sw-input:not(:checked)');
  input.checked = true;
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(50);
  assert.equal(input.checked, false, 'the switch goes back');
  click(window, [...segOf(doc, 'OpenAI Codex').querySelectorAll('button')].find((b) => b.textContent === 'Used'));
  await wait(50);
  assert.deepEqual(state.patches, [], 'no PATCH');
  assert.deepEqual(state.own, { 'readiness.ignore': ['deps.lockfile'], 'readiness.tools': { cursor: 'used' } });
});

test("a failed tool choice keeps 'Could not save.'", async () => {
  const state = { report: NOT_READY };
  const { window } = await boot(state);
  const doc = window.document;
  await goHash(window, 'projects');
  await goHash(window, `projects/${KEY}/settings`);
  await wait(10);
  state.patchFails = true;
  blurOnDisable(window);
  const row = segOf(doc, 'OpenAI Codex');
  const before = [...row.querySelectorAll('button')].map((b) => b.getAttribute('aria-pressed'));
  const used = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Used');
  used.focus();
  click(window, used);
  await wait(50);
  assert.match(cardOf(doc).textContent, /Could not save\./);
  const now = segOf(doc, 'OpenAI Codex');
  assert.equal(now, row, 'the card was not rebuilt');
  assert.ok([...now.querySelectorAll('button')].every((b) => !b.disabled), 'the buttons are usable again');
  assert.deepEqual([...now.querySelectorAll('button')].map((b) => b.getAttribute('aria-pressed')), before);
  assert.equal(doc.activeElement, used, 'focus stays on the button');
  const runs = [...segOf(doc, 'Claude Code').querySelectorAll('button')].find((b) => b.textContent === 'Not used');
  assert.equal(runs.disabled, true, "the run engine's Not used stays disabled");
});

test("the list row's chip is status only", async () => {
  const { window } = await boot({ report: NOT_READY });
  const doc = window.document;
  await goHash(window, 'projects');
  const chip = doc.querySelector(`#projects-list .pl-item[data-key="${KEY}"] .pl-rd`);
  assert.ok(chip, 'a chip on the row');
  assert.equal(chip.getAttribute('role'), null);
  assert.equal(chip.getAttribute('tabindex'), null);
  assert.ok(chip.id, 'the chip has an id');
  assert.equal(chip.closest('.pl-row').getAttribute('aria-describedby'), chip.id);
  click(window, chip);
  await settle();
  assert.equal(window.location.hash, `#projects/${KEY}`, 'a click opens the project page');
  assert.equal(openPops(doc).length, 0, 'no popover from the list');
});

test("'See what to add' opens the project page's report", async () => {
  const { window } = await boot({ report: NOT_READY });
  const doc = window.document;
  await goHash(window, 'projects');
  WSStub.last._frame({ type: 'readiness-added', projectKey: KEY, name: 'alpha', engine: 'Claude Code' });
  await settle();
  const act = [...doc.querySelectorAll('button')].find((b) => b.textContent === 'See what to add');
  assert.ok(act, 'the toast offers the action');
  click(window, act);
  await settle();
  await wait(10);
  assert.equal(window.location.hash, `#projects/${KEY}`);
  assert.equal(openPops(doc).length, 1, 'the header popover is open');
  assert.equal(headChip(doc).getAttribute('aria-expanded'), 'true');
});
