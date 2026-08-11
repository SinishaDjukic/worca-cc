// test/ui-composer-chrome.test.mjs
// Composer chrome: the top agent drawer's disclosure state and its persistence.
//
// The module owns NO graph state — it never reads or writes a template — so it
// survives the editor teardown/rebuild that composerLoadTemplate() performs.
// The `hasAgents` predicate is deliberately NOT a node count: newCanvas()
// (composer-editor.mjs:134) preloads a Task and an End node, so a node-count
// default would collapse the drawer on exactly the blank canvas it is supposed
// to open on.
//
// The SHELL below seeds the OPPOSITE of every default on purpose. If it shipped
// data-open="true", the "an agent-free canvas opens the drawer" case would pass
// against an empty syncDefault() and prove nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createComposerChrome, DRAWER_KEY } from '../ui/public/graph/composer-chrome.mjs';

const SHELL = `<!doctype html><body>
  <section class="card builder-card">
    <div class="gv-drawer" id="drawer" data-open="false">
      <div class="gv-drawer-bar">
        <button id="toggle" type="button" aria-expanded="false" aria-controls="palette">Agents</button>
        <input id="filter" type="search">
      </div>
      <div id="palette" class="gv-palette-scroll">
        <button id="pill" class="ap" type="button" data-key="planner">Plan</button>
      </div>
    </div>
    <div class="gv-body" id="body" data-inspector="open">
      <div id="canvas" class="gv-canvas"></div>
    </div>
  </section>
</body>`;

/** An in-memory Storage stand-in. jsdom ships localStorage, but an explicit
 *  stub keeps each test's persisted state isolated and inspectable. */
function memStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    read: (k) => (map.has(k) ? map.get(k) : null),
  };
}

function boot({ storage = memStorage(), hasAgents = () => false, panelHeight = 240 } = {}) {
  const dom = new JSDOM(SHELL, { url: 'http://localhost:4317/' });
  const { window } = dom;
  const doc = window.document;
  const els = {
    drawer: doc.getElementById('drawer'),
    toggle: doc.getElementById('toggle'),
    panel: doc.getElementById('palette'),
    filter: doc.getElementById('filter'),
    canvas: doc.getElementById('canvas'),
    pill: doc.getElementById('pill'),
    body: doc.getElementById('body'),
  };
  // jsdom answers zeros for every rect, so the panel's height is stubbed.
  els.panel.getBoundingClientRect = () => ({
    height: panelHeight, width: 1046, top: 44, left: 0, right: 1046, bottom: 44 + panelHeight,
  });
  const chrome = createComposerChrome({
    drawer: els.drawer, toggle: els.toggle, panel: els.panel,
    canvas: els.canvas, filter: els.filter, storage, hasAgents,
  });
  return { window, doc, els, chrome, storage };
}

const click = (window, el) =>
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
// Returns the event so a case can assert defaultPrevented — cancelable:true is
// what makes preventDefault() observable, and stage 1 relies on it to defeat the
// UA's own input[type=search] clear.
const esc = (window, el) => {
  const ev = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
};
// `new window.PointerEvent(...)` IS constructible under jsdom — the editor's own
// suite relies on it (test/ui-composer-editor.test.mjs:15).
const down = (window, el) =>
  el.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));

const isOpen = (els) => els.drawer.dataset.open === 'true';

test('with nothing stored, an agent-free canvas opens the drawer', () => {
  const { els } = boot({ hasAgents: () => false });
  assert.equal(isOpen(els), true);
  assert.equal(els.toggle.getAttribute('aria-expanded'), 'true');
});

test('with nothing stored, a canvas that already has agents collapses it', () => {
  const { els } = boot({ hasAgents: () => true });
  assert.equal(isOpen(els), false);
  assert.equal(els.toggle.getAttribute('aria-expanded'), 'false');
});

test("a fresh newCanvas() shape — Task + End, no agents — still opens", () => {
  // newCanvas() (composer-editor.mjs:134) preloads two nodes. A node-COUNT
  // default would read that as "populated" and wrongly collapse. The real kind
  // set is {agent, task, end, and, or, combine} (graph-model.mjs:441).
  const nodes = [{ id: 'n_task', kind: 'task' }, { id: 'n_end', kind: 'end' }];
  const { els } = boot({ hasAgents: () => nodes.some((n) => n.kind === 'agent') });
  assert.equal(isOpen(els), true);
});

test('a stored value beats the default in both directions', () => {
  const closed = boot({ storage: memStorage({ [DRAWER_KEY]: 'closed' }), hasAgents: () => false });
  assert.equal(isOpen(closed.els), false, 'stored closed beats an agent-free canvas');

  const open = boot({ storage: memStorage({ [DRAWER_KEY]: 'open' }), hasAgents: () => true });
  assert.equal(isOpen(open.els), true, 'stored open beats a populated canvas');
});

test('clicking the toggle flips the drawer, mirrors aria, and persists', () => {
  const { window, els, storage } = boot({ hasAgents: () => false });

  click(window, els.toggle);
  assert.equal(isOpen(els), false);
  assert.equal(els.toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(storage.read(DRAWER_KEY), 'closed');

  click(window, els.toggle);
  assert.equal(isOpen(els), true);
  assert.equal(els.toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(storage.read(DRAWER_KEY), 'open');
});

test('syncDefault() re-evaluates the default when the template changes', () => {
  // This is what composerLoadTemplate() and every composer view entry call.
  let agents = false;
  const { els, chrome } = boot({ hasAgents: () => agents });
  assert.equal(isOpen(els), true, 'the blank first-visit canvas opens');
  agents = true;
  chrome.syncDefault();
  assert.equal(isOpen(els), false, 'opening a pipeline that already has agents collapses it');
  agents = false;
  chrome.syncDefault();
  assert.equal(isOpen(els), true, '"New canvas" opens it again');
});

test('syncDefault() is inert once the user has toggled', () => {
  const { window, els, chrome, storage } = boot({ hasAgents: () => true });
  click(window, els.toggle);                       // collapsed -> open, persisted
  assert.equal(storage.read(DRAWER_KEY), 'open');
  chrome.syncDefault();
  assert.equal(isOpen(els), true, 'the stored preference survives a template load');
});

test('Escape clears a non-empty filter before it collapses the drawer', () => {
  // The filter is input[type=search]; Blink and WebKit clear it on Escape
  // natively. Without the two stages, one keypress would clear the query AND
  // hide the panel showing the result.
  const { window, doc, els, storage } = boot({ hasAgents: () => false });
  let applied = 0;
  els.filter.addEventListener('input', () => { applied += 1; });
  els.filter.value = 'plan';
  els.filter.focus();

  const first = esc(window, els.filter);
  assert.equal(els.filter.value, '', 'the first Escape clears the filter');
  assert.equal(applied, 1, 'and re-notifies the editor so applyFilter() re-runs');
  assert.equal(first.defaultPrevented, true,
    "preventDefault() suppressed the UA's own search-clear, so it cannot double-fire");
  assert.equal(isOpen(els), true, 'the drawer stays open');
  assert.equal(storage.read(DRAWER_KEY), null, 'clearing a filter is not a disclosure decision');
  assert.equal(doc.activeElement, els.filter, 'focus stays in the input');

  const second = esc(window, els.filter);
  assert.equal(isOpen(els), false, 'the second Escape collapses it');
  assert.equal(second.defaultPrevented, false, 'stage 2 has no UA default to suppress');
  assert.equal(storage.read(DRAWER_KEY), 'closed');
});

test('Escape in a COLLAPSED drawer passes straight through to the editor', () => {
  // The bar — and the filter in it — stay visible when collapsed, so Escape can
  // still be aimed at the drawer subtree. With nothing disclosed there is
  // nothing to dismiss: the handler must bail BEFORE stopPropagation(), or the
  // editor silently loses its deselect for as long as the drawer is shut.
  const { window, doc, els } = boot({ storage: memStorage({ [DRAWER_KEY]: 'closed' }) });
  let reachedDocument = false;
  doc.addEventListener('keydown', () => { reachedDocument = true; });
  els.filter.value = 'plan';
  els.filter.focus();

  esc(window, els.filter);

  assert.equal(isOpen(els), false, 'still collapsed — and NOT re-opened by a synthetic input');
  assert.equal(reachedDocument, true, 'the editor keeps its document-level deselect');
  assert.equal(els.filter.value, 'plan', 'the module does not clear a field it is not dismissing for');
});

test('a UA-cleared search field does not re-open a collapsed drawer', () => {
  // input[type=search] fires `input` with an EMPTY value when Blink and WebKit
  // clear it themselves — on Escape, and on the native ✕. A drawer the user just
  // dismissed must not spring back: a disclosure control may never run backwards.
  // Reachable path: type (auto-opens) -> click the canvas (light dismiss, the
  // text survives) -> Escape.
  const { window, els } = boot({ storage: memStorage({ [DRAWER_KEY]: 'closed' }) });
  assert.equal(isOpen(els), false);
  els.filter.value = '';
  els.filter.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(isOpen(els), false, 'an empty-value input is a clear, not a search');
});

test('Escape inside the drawer stops propagating so the editor does not also deselect', () => {
  // The editor binds Escape on the DOCUMENT to deselect (composer-editor.mjs:686,
  // registered at :749 with no capture flag), so a bubble-phase stopPropagation
  // at the drawer suppresses it.
  const { window, doc, els } = boot({ hasAgents: () => false });
  let reachedDocument = false;
  doc.addEventListener('keydown', () => { reachedDocument = true; });

  els.pill.focus();
  esc(window, els.pill);

  assert.equal(isOpen(els), false);
  assert.equal(reachedDocument, false, 'stopPropagation kept it off the document');
});

test('focus is rescued only from the subtree that is about to hide', () => {
  const a = boot({ hasAgents: () => false });
  a.els.pill.focus();
  esc(a.window, a.els.pill);
  assert.equal(a.doc.activeElement, a.els.toggle, 'focus left the panel before it hid');

  const b = boot({ hasAgents: () => false });
  b.els.filter.focus();                  // the BAR stays visible when collapsed
  esc(b.window, b.els.filter);
  assert.equal(isOpen(b.els), false);
  assert.equal(b.doc.activeElement, b.els.filter, 'focus in the still-visible bar is left alone');
});

test('Escape from the canvas leaves the drawer alone and reaches the document', () => {
  const { window, doc, els } = boot({ hasAgents: () => false });
  let reachedDocument = false;
  doc.addEventListener('keydown', () => { reachedDocument = true; });

  esc(window, els.canvas);

  assert.equal(isOpen(els), true, 'the drawer only answers Escape from inside itself');
  assert.equal(reachedDocument, true, 'the editor still gets its deselect');
});

test('a canvas pointerdown dismisses the drawer without persisting', () => {
  // The open panel overlays the canvas's top 240px and the editor binds
  // pointerdown on the canvas only, so without this a third of the canvas
  // cannot start a gesture.
  const { window, els, storage } = boot({ hasAgents: () => false });
  down(window, els.canvas);
  assert.equal(isOpen(els), false);
  assert.equal(storage.read(DRAWER_KEY), null, 'a transient dismissal is not a preference');
});

test('clicking a pill leaves the drawer open — several agents in a row', () => {
  const { window, els, storage } = boot({ hasAgents: () => false });
  down(window, els.pill);                // a press INSIDE the drawer is not an outside click
  click(window, els.pill);
  assert.equal(isOpen(els), true);
  assert.equal(storage.read(DRAWER_KEY), null, 'a pill click is not a disclosure decision');
});

test('typing in the filter re-opens a collapsed drawer, without persisting', () => {
  const { window, els, storage } = boot({ storage: memStorage({ [DRAWER_KEY]: 'closed' }) });
  assert.equal(isOpen(els), false);
  els.filter.value = 'plan';
  els.filter.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(isOpen(els), true, 'the bar is always visible — filtering an invisible list is a dead end');
  assert.equal(storage.read(DRAWER_KEY), 'closed', 'the stored preference is untouched');
});

test('canvasInsetTop() is the panel height when open and 0 when closed', () => {
  // 173, not the real 240: a hardcoded `return 240` would satisfy the round number.
  const { window, els, chrome } = boot({ hasAgents: () => false, panelHeight: 173 });
  assert.equal(chrome.canvasInsetTop(), 173, 'it MEASURES the panel, it does not assume 240');
  click(window, els.toggle);
  assert.equal(chrome.canvasInsetTop(), 0);
});

test('a throwing Storage (private mode) degrades to the defaults', () => {
  // jsdom does NOT rethrow out of dispatchEvent — it reports listener exceptions
  // as a window 'error' event — so assert.doesNotThrow around a click would be
  // vacuous here. Count the reported errors instead.
  const boom = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('SecurityError'); },
  };
  const { window, els } = boot({ storage: boom, hasAgents: () => false });
  assert.equal(isOpen(els), true, 'an unreadable key falls through to the default');

  let reported = 0;
  window.addEventListener('error', () => { reported += 1; });
  click(window, els.toggle);
  assert.equal(reported, 0, 'the unwritable key was swallowed, not thrown at the page');
  assert.equal(isOpen(els), false, 'the in-memory state still flips');
});

test('destroy() unbinds the toggle, Escape, the canvas and the filter', () => {
  const { window, els, chrome } = boot({ hasAgents: () => false });
  chrome.destroy();

  click(window, els.toggle);
  assert.equal(isOpen(els), true, 'the toggle is inert after destroy');
  els.pill.focus();
  esc(window, els.pill);
  assert.equal(isOpen(els), true, 'Escape is inert after destroy');
  down(window, els.canvas);
  assert.equal(isOpen(els), true, 'light dismiss is inert after destroy');

  // The filter binding only ACTS on a collapsed drawer, so it has to be tested
  // from that state or the assertion is vacuous — verified: dropping the filter
  // removeEventListener left the naive version green. destroy() unbound the
  // toggle, so collapse it the way the module itself reads state.
  els.drawer.dataset.open = 'false';
  els.filter.value = 'plan';
  els.filter.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(isOpen(els), false, 'filter auto-open is inert after destroy');
});
