// test/helpers/jsdom-release.mjs
// Release a jsdom window's memory after its test, for suites that boot the real
// app.js once per test.
//
// Those suites import app.js under a fresh `?b=<random>` URL per test so its
// top-level state starts clean. Node never unloads an ES module, so every
// instance stays in the module map for the life of the process, and its
// top-level bindings (cached elements like `nodesGroupBox`) keep that test's
// whole DOM reachable. window.close() stops the window's timers but cannot cut
// that path. A file with ~100 such tests grew past Node's 4GB heap on CI and
// aborted, even though every test passed.
//
// releaseDom() detaches every element from its parent and drops its attributes,
// so a leaked module pins only the few elements it named, not the document
// behind them. It measured a 57% lower heap at the end of
// test/ui-history-detail.test.mjs. The module's own code and state still leak;
// keep files that boot app.js per test from growing without bound.
//
// app.js's bare setTimeout/setInterval are Node's timers, not the window's, so
// close() does not stop them. A guide's poll interval kept the process alive,
// and a live view's exit timeout fired into the released DOM after its test.
// useDomRelease() clears the intervals started while a tracked window was open.
// Timeouts end on their own and some free app.js state when they fire (clearing
// them measured 40% more heap), so they still run; an error one throws after
// its window was released is swallowed, since only the teardown caused it.
// Except while a later test's window is open: app.js's bare `document`, `fetch`
// and `localStorage` are globals that now name that window, so a released
// instance's timeout would paint its own stale state into it. History's 15 s PR
// watchdog did that under load: it reset a later test's nav count and hid its
// selection bar. Such a timeout is dropped.

import { promisify } from 'node:util';

/**
 * Close a jsdom window and take its DOM apart.
 * @param {import('jsdom').JSDOM} dom
 * @param {Document} [document]  the window's document; pass it when the test may
 *   already have closed the window, since a closed window's `document` is undefined
 */
export function releaseDom(dom, document = dom.window.document) {
  if (!document) return;
  // Collect before close(): the walk must not race app.js handlers, and close()
  // stops the window's timers and observers first.
  const elements = [...document.querySelectorAll('*')];
  try { dom.window.close(); } catch { /* already closed */ }
  for (const el of elements) {
    el.replaceChildren();
    for (const attr of [...el.attributes]) el.removeAttributeNode(attr);
  }
  document.replaceChildren();
}

// Node timers started while any tracked window is open. Shared by every
// useDomRelease() caller in the process (a test file and a boot helper may both
// track), so the globals are wrapped once.
const intervals = new Set();
let openCount = 0;
let generation = 0;   // bumped at every release; a timeout from an older one is stale
let wrapped = false;
function wrapTimers() {
  if (wrapped) return;
  wrapped = true;
  const { setTimeout: startTimeout, setInterval: startInterval } = globalThis;
  globalThis.setInterval = function (...args) {
    const handle = startInterval.apply(this, args);
    if (openCount) intervals.add(handle);
    return handle;
  };
  globalThis.setTimeout = function (fn, ...rest) {
    if (!openCount || typeof fn !== 'function') return startTimeout.call(this, fn, ...rest);
    const born = generation;
    return startTimeout.call(this, function (...args) {
      if (born === generation) return fn.apply(this, args);
      if (openCount) return undefined;
      try {
        const out = fn.apply(this, args);
        if (typeof out?.then === 'function') out.then(undefined, () => { /* its window was released */ });
        return out;
      } catch { /* its window was released */ }
    }, ...rest);
  };
  // util.promisify(setTimeout) resolves through this symbol; keep it working.
  globalThis.setTimeout[promisify.custom] = startTimeout[promisify.custom];
}

/**
 * Release every DOM the current test tracked, after each test: clear the Node
 * intervals started while it was open, then close and take apart each window.
 * @param {(fn: () => void) => void} afterEach  the node:test `afterEach` hook
 * @returns {<T extends import('jsdom').JSDOM>(dom: T) => T}  track a DOM; returns it
 */
export function useDomRelease(afterEach) {
  wrapTimers();
  const open = [];
  afterEach(() => {
    if (!open.length) return;
    openCount -= open.length;
    generation++;
    for (const handle of intervals) clearInterval(handle);
    intervals.clear();
    for (const [dom, document] of open.splice(0)) releaseDom(dom, document);
  });
  return (dom) => { open.push([dom, dom.window.document]); openCount++; return dom; };
}
