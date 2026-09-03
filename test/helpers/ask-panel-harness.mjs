// test/helpers/ask-panel-harness.mjs — jsdom rig for the ask-panel unit suites.
// No app boot: the panel takes every environment dependency through its factory
// (spec §10.1), so the harness only builds a bare document and records what the
// panel does with fetch / sendWs / raf / storage.
import { JSDOM } from 'jsdom';
import { createAskPanel } from '../../ui/public/ask-panel.mjs';

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

export function makePanel(overrides = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:4317/' });
  const { window } = dom;
  const fetchCalls = [];
  const wsSends = [];
  const rafQueue = [];
  let lastRaf = null;
  const storage = overrides.storage || makeStorage();
  const deps = {
    doc: window.document,
    win: window,
    fetch: (url, opts) => {
      fetchCalls.push({ url: String(url), opts: opts || {} });
      const h = overrides.fetchHandler;
      if (h) return Promise.resolve(h(String(url), opts || {}));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    },
    sendWs: (obj) => { wsSends.push(obj); },
    confirm: overrides.confirm || (async () => true),
    getPageContext: overrides.getPageContext || (() => ({})),
    openNewPipeline: overrides.openNewPipeline || (() => {}),
    loadMarkdown: overrides.loadMarkdown || (async () => { throw new Error('markdown disabled in this suite'); }),
    hljsLoader: overrides.hljsLoader || { forLanguage: async () => null },
    storage,
    raf: (fn) => { rafQueue.push(fn); lastRaf = fn; return rafQueue.length; },
    now: overrides.now || (() => 1_000_000),
    ...(overrides.deps || {}),
  };
  const panel = createAskPanel(deps);
  window.document.body.appendChild(panel.root);
  // Force one flush pass, then drain whatever it re-arms. With nothing armed
  // the panel's flush must still run: in production the 1 s elapsed interval
  // keeps calling scheduleFlush(), and a test that only advances the injected
  // `now` has no other stand-in for that tick.
  const flush = () => {
    if (!rafQueue.length && lastRaf) lastRaf();
    for (let i = 0; i < 5 && rafQueue.length; i++) rafQueue.splice(0).forEach((fn) => fn());
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { panel, window, doc: window.document, fetchCalls, wsSends, flush, tick, storage };
}

export function key(window, target, key, init = {}) {
  const e = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  (target || window.document).dispatchEvent(e);
  return e;
}

export function pointerdown(window, target) {
  const e = new window.Event('pointerdown', { bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

/**
 * A PointerEvent with a stable pointerId for drag simulations. jsdom lays nothing
 * out, so the coordinates mean whatever the test says they mean.
 */
export function pointer(window, type, init = {}) {
  return new window.PointerEvent(type, { pointerId: 1, button: 0, bubbles: true, cancelable: true, ...init });
}

/**
 * jsdom reports every box as 0×0. Give the dock a content box so the sheet's
 * clamp has an upper bound: inner width = width − 2×28, inner height = height − 26 − 20.
 */
export function sizeDock(doc, width, height) {
  const dock = doc.querySelector('.ask-dock');
  Object.defineProperty(dock, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(dock, 'clientHeight', { value: height, configurable: true });
  return dock;
}
