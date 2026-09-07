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
  // jsdom has no ResizeObserver. `resizeObserver: true` installs a recording
  // fake BEFORE the panel is built: a test fires an observer's `cb` by hand and
  // reads `disconnected` after destroy().
  const resizeObservers = [];
  if (overrides.resizeObserver) {
    window.ResizeObserver = class FakeResizeObserver {
      constructor(cb) { this.cb = cb; this.targets = []; this.disconnected = false; resizeObservers.push(this); }
      observe(t) { this.targets.push(t); }
      unobserve(t) { this.targets = this.targets.filter((x) => x !== t); }
      disconnect() { this.targets = []; this.disconnected = true; }
    };
  }
  // jsdom has no requestAnimationFrame, so every createThinkingOrb() stays
  // inert (no canvas, no loop). `orb: true` installs, BEFORE the panel is
  // built, a recording rAF pair, a stub 2d context that logs the arcs painted
  // per canvas, and a visible document (draw() skips a hidden one) — so a suite
  // can tell WHICH orb is looping: `orbFrames.run()` runs every armed-and-not-
  // cancelled frame once and the paints land on the looping orbs' canvases.
  // Only the orbs read window.requestAnimationFrame; the panel's own scheduling
  // goes through the injected `raf` below. The orbs' clock (performance.now)
  // becomes `orbFrames.t`, so a morph tween can be stepped by hand.
  const orbFrames = { armed: [], cancelled: new Set(), paints: new Map(), t: 0, run: null };
  if (overrides.orb) {
    let id = 0;
    window.requestAnimationFrame = (fn) => { orbFrames.armed.push({ id: ++id, fn }); return id; };
    window.cancelAnimationFrame = (n) => { orbFrames.cancelled.add(n); };
    Object.defineProperty(window, 'performance', { value: { now: () => orbFrames.t }, configurable: true });
    window.HTMLCanvasElement.prototype.getContext = function getContext() {
      const cv = this;
      const log = (a) => { if (!orbFrames.paints.has(cv)) orbFrames.paints.set(cv, []); orbFrames.paints.get(cv).push(a); };
      return { scale() {}, clearRect() {}, beginPath() {}, fill() {}, fillStyle: '', arc(x, y, r) { log([x, y, r]); } };
    };
    Object.defineProperty(window.document, 'hidden', { value: false, configurable: true });
  }
  orbFrames.run = () => {
    const pending = orbFrames.armed.filter((f) => !orbFrames.cancelled.has(f.id));
    orbFrames.armed = [];
    for (const f of pending) f.fn();
  };
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
  return { panel, window, doc: window.document, fetchCalls, wsSends, flush, tick, storage, resizeObservers, orbFrames };
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
 * out, so the coordinates mean whatever the test says they mean. `buttons` is
 * what a real primary-button gesture reports: held (1) on down/move, released
 * (0) on up/cancel — a test passes buttons:0 on a move to mean "the release
 * never reached us".
 */
export function pointer(window, type, init = {}) {
  const buttons = type === 'pointerup' || type === 'pointercancel' ? 0 : 1;
  return new window.PointerEvent(type, { pointerId: 1, button: 0, buttons, bubbles: true, cancelable: true, ...init });
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
