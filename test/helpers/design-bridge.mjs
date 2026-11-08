// jsdom harness for the Design preview bridge (src/core/design/preview/bridge.js).
//
// The bridge is a classic script: it is read as text and evaluated, never imported (package.json is
// "type": "module", so Node would load it as ESM). `bootBridge` builds a frame doc around it with a
// fake parent, a fake clock and layout stubs; `pureHelpers` runs it with only `module` defined.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

export const BRIDGE_SRC = readFileSync(new URL('../../src/core/design/preview/bridge.js', import.meta.url), 'utf8');
const MORPHDOM_SRC = readFileSync(createRequire(import.meta.url).resolve('morphdom/dist/morphdom-umd.min.js'), 'utf8');

const page = (body) => `<!doctype html><html><head></head><body>${body}</body></html>`;
const EMPTY = page('');
export const SLOT_HERO = page('<div data-worca-slot="hero"></div>');
export const SLOTS = page('<header>H</header><div data-worca-slot="hero"></div><div data-worca-slot="price"></div><footer>F</footer>');
export const FINISHED_HERO = page('<section data-section="hero"><h1>a</h1></section>');
export const BAND = page('<header>H</header><div class="row"><div data-worca-slot="a"></div><div data-worca-slot="b"></div></div><main><div data-worca-slot="c"></div><!--worca:sections--></main><footer>F</footer>');

/** The bridge's pure helpers, from a context that holds only `module`. */
export function pureHelpers() {
  const module = { exports: {} };
  vm.runInNewContext(BRIDGE_SRC, { module });
  return module.exports;
}

// `n` numbers from a comma-separated attribute; a missing one reads 0. Number() keeps NaN and
// out-of-range values, so the bridge's own clamps are what a test sees. Read through Element.prototype, so a
// test that overrides a form's own getAttribute (as its named controls would) still lays it out.
function attrNumbers(el, name, n) {
  const win = el?.ownerDocument?.defaultView;
  const raw = win && el instanceof win.Element ? win.Element.prototype.getAttribute.call(el, name) : null;
  const parts = raw == null ? [] : raw.split(',').map(Number);
  return Array.from({ length: n }, (_, i) => (i < parts.length ? parts[i] : 0));
}

// setTimeout/clearTimeout and requestAnimationFrame/cancelAnimationFrame on one fake clock.
// tick(ms) runs the timers due by now + ms in (due, id) order, never animation frames; frame() runs the
// animation-frame callbacks queued before the call. maxPending is the most setTimeout timers ever
// pending at once.
function fakeClock() {
  const timers = new Map();
  const frames = new Map();
  let now = 0;
  let nextId = 1;
  const clock = {
    maxPending: 0,
    tick(ms = 0) {
      const end = now + ms;
      for (let runs = 0; ; runs++) {
        if (runs > 100000) throw new Error('fake clock: timers keep rescheduling themselves');
        let dueId = 0;
        let due = null;
        for (const [id, t] of timers) if (t.at <= end && (!due || t.at < due.at)) { dueId = id; due = t; }
        if (!due) break;
        timers.delete(dueId);
        now = due.at;
        due.fn(...due.args);
      }
      now = end;
    },
    frame() {
      for (const id of [...frames.keys()]) {
        const fn = frames.get(id);
        if (!fn) continue;
        frames.delete(id);
        fn(now);
      }
    },
  };
  const install = (win) => {
    win.setTimeout = (fn, ms, ...args) => {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, args });
      clock.maxPending = Math.max(clock.maxPending, timers.size);
      return id;
    };
    win.clearTimeout = (id) => { timers.delete(id); };
    win.requestAnimationFrame = (fn) => { const id = nextId++; frames.set(id, fn); return id; };
    win.cancelAnimationFrame = (id) => { frames.delete(id); };
  };
  return { clock, install };
}

/**
 * Boot the bridge in a jsdom frame doc at /design-preview/TOK/<mode>/<hash>.
 * `before(win)` runs once the stubs are in place, just before morphdom and the bridge load: the bridge takes the Node
 * and Element members it calls from the prototypes at boot, so a test stubs one there, never on an element.
 * @returns {{win, doc, sent: Array<{m, o}>, send: Function, of: Function, clock: {tick, frame, maxPending},
 *   animated: Array<{el, keyframes, options}>, observed: Set<Element>, writesSeenAtRead: number[], close: Function}}
 */
export function bootBridge({ mode = 'build', nonce = 'n1', hash, html = EMPTY, morphdom, animate = false,
  reducedMotion = false, trackWrites = false, resizeObserver = false, before } = {}) {
  const dom = new JSDOM(html, {
    url: `http://localhost/design-preview/TOK/${mode}/${hash === undefined ? `#n=${nonce}` : hash}`,
    runScripts: 'outside-only',
  });
  const win = dom.window;
  const doc = win.document;

  // jsdom fires DOMContentLoaded a microtask after the constructor; pinning readyState lets the
  // bridge post `ready` at once, so synchronous tests see it. On the prototype: the bridge reads it there.
  Object.defineProperty(win.Document.prototype, 'readyState', { configurable: true, get: () => 'interactive' });

  // The bridge posts from the window's realm; a structured clone gives the test plain Node objects,
  // as a real postMessage would give the receiving realm's.
  const sent = [];
  const parent = { postMessage(m, o) { sent.push({ m: structuredClone(m), o }); } };
  win.parent = parent;

  const { clock, install } = fakeClock();
  install(win);

  const writesSeenAtRead = [];
  let mo = null;
  if (trackWrites) {
    mo = new win.MutationObserver(() => {});
    mo.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  const read = () => { if (mo) writesSeenAtRead.push(mo.takeRecords().length); };
  win.Element.prototype.getBoundingClientRect = function () {
    read();
    const [x, y, w, h] = attrNumbers(this, 'data-r', 4);
    return new win.DOMRect(x, y, w, h);
  };
  win.Range.prototype.getBoundingClientRect = function () {
    read();
    const [x, y, w, h] = attrNumbers(this.startContainer && this.startContainer.parentElement, 'data-tr', 4);
    return new win.DOMRect(x, y, w, h);
  };
  ['scrollWidth', 'scrollHeight', 'clientWidth', 'clientHeight'].forEach((name, i) => {
    Object.defineProperty(win.Element.prototype, name, {
      configurable: true,
      get() { return attrNumbers(this, 'data-scroll', 4)[i]; },
    });
  });

  const animated = [];
  if (animate) {
    win.Element.prototype.animate = function (keyframes, options) {
      animated.push({ el: this, keyframes: structuredClone(keyframes), options: structuredClone(options) });
      return { cancel() {}, finish() {}, finished: Promise.resolve() };
    };
  }
  if (reducedMotion) {
    win.matchMedia = (media) => ({ matches: true, media: String(media), addEventListener() {}, removeEventListener() {} });
  }

  // jsdom has no scrollIntoView, so the bridge's feature guard sees none until a test assigns one to
  // Element.prototype. The bridge's options then reach that stub structured-cloned, as plain Node
  // objects, the way `sent` hands over messages.
  let scrollIntoView;
  Object.defineProperty(win.Element.prototype, 'scrollIntoView', {
    configurable: true,
    get() { return scrollIntoView; },
    set(fn) { scrollIntoView = typeof fn === 'function' ? function (options) { return fn.call(this, structuredClone(options)); } : fn; },
  });

  const observed = new Set();
  if (resizeObserver) {
    win.ResizeObserver = class {
      constructor(callback) { this.callback = callback; this.targets = new Set(); }
      observe(el) { this.targets.add(el); observed.add(el); }
      unobserve(el) { this.targets.delete(el); observed.delete(el); }
      disconnect() { for (const el of this.targets) observed.delete(el); this.targets.clear(); }
    };
  }

  if (before) before(win);
  if (morphdom ?? mode === 'build') win.eval(MORPHDOM_SRC);
  win.eval(BRIDGE_SRC);

  const send = (t, fields = {}, opts = {}) => {
    const data = {
      ns: 'ns' in opts ? opts.ns : 'worca-design',
      v: 'v' in opts ? opts.v : 1,
      n: 'n' in opts ? opts.n : nonce,
      t,
      ...fields,
    };
    win.dispatchEvent(new win.MessageEvent('message', { data, source: 'source' in opts ? opts.source : parent }));
  };
  const of = (t) => sent.filter(({ m }) => m && m.t === t).map(({ m }) => m);
  const close = () => { if (mo) mo.disconnect(); win.close(); };

  return { win, doc, sent, send, of, clock, animated, observed, writesSeenAtRead, close };
}

// A form's named controls override its own members ([LegacyOverrideBuiltIns]): `<input name="getAttribute">` makes
// `form.getAttribute` that input while it is in the form, and a control elsewhere with `form=` reaches it too. jsdom
// has no such override, so each one is an own getter here. hasAttribute, localName, attributes, parentNode and nodeType
// are left out: jsdom's own selector engine reads those off the element.
export const FORM_MEMBERS = ['getAttribute', 'setAttribute', 'getBoundingClientRect', 'querySelectorAll', 'closest', 'parentElement',
  'isConnected', 'remove', 'replaceWith', 'firstChild', 'nextSibling', 'lastElementChild', 'previousElementSibling',
  'namespaceURI', 'outerHTML', 'textContent', 'insertBefore', 'appendChild', 'isEqualNode', 'scrollWidth', 'scrollHeight',
  'clientWidth', 'clientHeight'];
/** Gives `form` those overrides, for its first `input`. */
export function overrideByControl(form, names = FORM_MEMBERS) {
  const win = form.ownerDocument.defaultView;
  const control = form.querySelector('input');
  for (const name of names) {
    let desc;
    for (let p = Object.getPrototypeOf(form); p && !desc; p = Object.getPrototypeOf(p)) desc = Object.getOwnPropertyDescriptor(p, name);
    Object.defineProperty(form, name, { configurable: true,
      get: () => (win.Node.prototype.contains.call(form, control) ? control : desc.get ? desc.get.call(form) : desc.value) });
  }
  return form;
}
/**
 * The same override for forms a test cannot reach before the bridge does (a live apply makes them): on
 * HTMLFormElement.prototype, each of `names` reads the form's `<input name="<member>">` while it holds one. Call it from
 * `bootBridge`'s `before`. The control is found with getElementsByTagName, never a selector, since jsdom's selector
 * engine reads these members back off the form.
 */
export function overrideOnFormPrototype(win, names) {
  for (const name of names) {
    const desc = Object.getOwnPropertyDescriptor(win.Element.prototype, name) ?? Object.getOwnPropertyDescriptor(win.Node.prototype, name);
    Object.defineProperty(win.HTMLFormElement.prototype, name, { configurable: true, get() {
      for (const el of win.Element.prototype.getElementsByTagName.call(this, 'input')) if (win.Element.prototype.getAttribute.call(el, 'name') === name) return el;
      return desc.get ? desc.get.call(this) : desc.value;
    } });
  }
}
