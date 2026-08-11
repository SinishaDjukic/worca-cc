// test/ui-composer-chrome.test.mjs
// Composer chrome: the inspector rail's disclosure state and its persistence,
// plus the one shortcut left over from the old agent drawer — Escape clears the
// filter.
//
// The module owns NO graph state — it never reads or writes a template — so it
// survives the editor teardown/rebuild that composerLoadTemplate() performs.
//
// The SHELL below seeds `data-inspector="collapsed"`, the OPPOSITE of the
// default, on purpose. If it shipped "open", the "defaults to open" case would
// pass against an empty setInspector() and prove nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createComposerChrome, INSPECTOR_KEY } from '../ui/public/graph/composer-chrome.mjs';

const SHELL = `<!doctype html><body>
  <section class="card builder-card">
    <div class="gv-body" id="body" data-inspector="collapsed">
      <div id="canvas" class="gv-canvas"></div>
      <div class="gv-ins-rail" id="rail">
        <button id="ins-toggle" type="button" aria-expanded="false"
                aria-controls="inspector" aria-label="Expand inspector"></button>
        <aside id="inspector" class="gv-inspector"></aside>
      </div>
    </div>
  </section>
  <section class="card gv-palette-card">
    <div class="gv-palette-head">
      <b class="gv-palette-title">Agents</b>
      <input id="filter" type="search">
    </div>
    <div id="palette" class="gv-palette-scroll">
      <button id="pill" class="ap" type="button" data-key="planner">Plan</button>
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

function boot({ storage = memStorage(), railWidth = 280 } = {}) {
  const dom = new JSDOM(SHELL, { url: 'http://localhost:4317/' });
  const { window } = dom;
  const doc = window.document;
  const els = {
    filter: doc.getElementById('filter'),
    palette: doc.getElementById('palette'),
    canvas: doc.getElementById('canvas'),
    pill: doc.getElementById('pill'),
    body: doc.getElementById('body'),
    insToggle: doc.getElementById('ins-toggle'),
    inspector: doc.getElementById('inspector'),
    rail: doc.getElementById('rail'),
  };
  // jsdom answers zeros for every rect, so the floating rail's width is stubbed.
  els.rail.getBoundingClientRect = () => ({
    width: railWidth, height: 638, top: 0, left: 1046 - railWidth, right: 1046, bottom: 638,
  });
  const chrome = createComposerChrome({
    body: els.body, insToggle: els.insToggle, insRail: els.rail,
    filter: els.filter, storage,
  });
  return { window, doc, els, chrome, storage };
}

const click = (window, el) =>
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
// Returns the event so a case can assert defaultPrevented — cancelable:true is
// what makes preventDefault() observable, and the filter clear relies on it to
// defeat the UA's own input[type=search] clear.
const esc = (window, el) => {
  const ev = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
};

test('Escape clears a non-empty filter and goes no further', () => {
  const { window, els } = boot();
  els.filter.value = 'plan';
  let reachedDocument = 0;
  els.filter.ownerDocument.addEventListener('keydown', () => { reachedDocument += 1; });

  const ev = esc(window, els.filter);
  assert.equal(els.filter.value, '', 'the field is cleared');
  assert.equal(ev.defaultPrevented, true,
    'preventDefault stops the UA clearing input[type=search] a second time');
  assert.equal(reachedDocument, 0,
    'and no document-level Escape handler sees it');
});

test('the clear fires a synthetic input so the editor re-filters', () => {
  const { window, els } = boot();
  els.filter.value = 'plan';
  let inputs = 0;
  els.filter.addEventListener('input', () => { inputs += 1; });
  esc(window, els.filter);
  assert.equal(inputs, 1, 'applyFilter() re-runs exactly once');
});

test('Escape in an EMPTY filter still reaches the document', () => {
  // app.js owns document-level Escape handlers for the viewer modal, the
  // confirm dialog, the project-add modal, the info tip, the plugin wizard and
  // the folder browser among others, and none of them skip typing targets.
  // Swallowing every Escape the focused filter sees would strand all of them
  // open. NOT the editor's deselect: its onKeyDown bails at isTyping() before
  // its Escape branch for any INPUT, so this key never deselects either way.
  const { window, els } = boot();
  els.filter.value = '';
  let reachedDocument = 0;
  els.filter.ownerDocument.addEventListener('keydown', () => { reachedDocument += 1; });

  const ev = esc(window, els.filter);
  assert.equal(ev.defaultPrevented, false);
  assert.equal(reachedDocument, 1, 'the modal and dialog handlers still get their Escape');
});

test('the inspector defaults to open when nothing is stored', () => {
  // SHELL seeds `collapsed`, so this asserts the module wrote the default.
  const { els } = boot();
  assert.equal(els.body.dataset.inspector, 'open');
  assert.equal(els.insToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(els.insToggle.getAttribute('aria-label'), 'Collapse inspector');
});

test('a stored inspector preference is restored, in both directions', () => {
  // SHELL seeds `collapsed`, so the 'collapsed' direction alone would pass
  // against an empty setInspector() — verified vacuous. Only the 'open'
  // direction proves the module wrote anything.
  const collapsed = boot({ storage: memStorage({ [INSPECTOR_KEY]: 'collapsed' }) });
  assert.equal(collapsed.els.body.dataset.inspector, 'collapsed');
  assert.equal(collapsed.els.insToggle.getAttribute('aria-expanded'), 'false');

  const open = boot({ storage: memStorage({ [INSPECTOR_KEY]: 'open' }) });
  assert.equal(open.els.body.dataset.inspector, 'open');
  assert.equal(open.els.insToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(open.els.insToggle.getAttribute('aria-label'), 'Collapse inspector');
});

test('the inspector handle flips the rail, relabels itself, and persists', () => {
  const { window, els, storage } = boot();

  click(window, els.insToggle);
  assert.equal(els.body.dataset.inspector, 'collapsed');
  assert.equal(els.insToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(els.insToggle.getAttribute('aria-label'), 'Expand inspector');
  assert.equal(storage.read(INSPECTOR_KEY), 'collapsed');

  click(window, els.insToggle);
  assert.equal(els.body.dataset.inspector, 'open');
  assert.equal(els.insToggle.getAttribute('aria-label'), 'Collapse inspector');
  assert.equal(storage.read(INSPECTOR_KEY), 'open');
});

test('the palette has no disclosure state left to read or write', () => {
  // The whole point of the change: there is no code path that can hide the
  // agents. A returning drawer would need a stored key, and there is none.
  const { window, els, storage } = boot();
  click(window, els.insToggle);
  assert.equal(storage.read('worca-cc.composer.drawer'), null,
    'the dead key is never written, even by an inspector toggle');
  assert.equal(els.palette.hasAttribute('hidden'), false);
});

test('a throwing Storage (private mode) degrades to the defaults', () => {
  // jsdom does NOT rethrow out of dispatchEvent — it reports listener exceptions
  // as a window 'error' event — so assert.doesNotThrow around a click would be
  // vacuous here. Count the reported errors instead.
  const boom = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('SecurityError'); },
  };
  const { window, els } = boot({ storage: boom });
  assert.equal(els.body.dataset.inspector, 'open',
    'an unreadable key falls through to the default');

  let reported = 0;
  window.addEventListener('error', () => { reported += 1; });
  click(window, els.insToggle);
  assert.equal(reported, 0, 'the unwritable key was swallowed, not thrown at the page');
  assert.equal(els.body.dataset.inspector, 'collapsed', 'the in-memory state still flips');
});

test('destroy() unbinds the inspector handle and the filter Escape', () => {
  const { window, els, chrome } = boot();
  chrome.destroy();

  click(window, els.insToggle);
  assert.equal(els.body.dataset.inspector, 'open', 'the handle is inert after destroy');

  els.filter.value = 'plan';
  esc(window, els.filter);
  assert.equal(els.filter.value, 'plan', 'the Escape clear is inert after destroy');
});

// --- the real index.html and style.css --------------------------------------
// The palette is only a layout change: #composer-palette keeps its id and its
// rendered subtree, so renderPalette/applyFilter/onPaletteClick are untouched
// and ui-agent-xss's `#composer-palette .ap[data-key]` query still resolves.
//
// Several of these read style.css as text. That is the house pattern for rules
// that cannot be exercised under jsdom (see test/ui-run-flow-css.test.mjs,
// test/ui-pinned-sidebar.test.mjs) — jsdom applies no stylesheet, so a DOM
// assertion here would be a tautology.

const REAL_HTML = readFileSync(
  fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8',
);
const REAL_CSS = readFileSync(
  fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8',
);
const realDoc = new JSDOM(REAL_HTML).window.document;

test('index.html: the palette lives in its own card, right below the canvas card', () => {
  const panel = realDoc.querySelector('#composer-palette');
  assert.ok(panel, '#composer-palette still exists');
  assert.ok(panel.classList.contains('gv-palette-scroll'));
  const card = panel.closest('.gv-palette-card');
  assert.ok(card, 'it sits inside the agents card');
  assert.ok(card.classList.contains('card'), 'which is a real .card surface');
  assert.equal(realDoc.querySelector('.builder-card').nextElementSibling, card,
    'the canvas card comes first, the agents card immediately after');
});

test('index.html: nothing can hide the agents any more', () => {
  assert.equal(realDoc.querySelector('#composer-drawer'), null, 'the drawer is gone');
  assert.equal(realDoc.querySelector('#composer-drawer-toggle'), null, 'and its toggle');
  assert.equal(realDoc.querySelector('.gv-drawer-bar'), null, 'and its bar');
  assert.ok(!realDoc.querySelector('.gv-palette'), '.gv-palette, the 264px rail, is still gone');
  assert.ok(!realDoc.querySelector('.gv-palette-top'), 'and so is .gv-palette-top');
});

test('index.html: the filter is in the head, OUTSIDE the panel renderPalette() replaces', () => {
  const filter = realDoc.querySelector('#composer-agent-filter');
  assert.ok(filter, '#composer-agent-filter still exists');
  assert.ok(filter.closest('.gv-palette-head'), 'it is in the card head');
  assert.equal(filter.closest('#composer-palette'), null,
    'renderPalette() calls replaceChildren() on #composer-palette on every repaint');
});

test('index.html: canvas and inspector are siblings inside the body row', () => {
  const body = realDoc.querySelector('#composer-body');
  assert.ok(body, '#composer-body exists');
  assert.ok(realDoc.querySelector('#composer-canvas').closest('#composer-body'));
  assert.ok(realDoc.querySelector('#composer-inspector').closest('#composer-body'));
});

test('index.html: the body row is the canvas card\'s only child', () => {
  const body = realDoc.querySelector('#composer-body');
  assert.equal(body.parentElement.className, 'card builder-card');
  assert.equal(body.parentElement.children.length, 1,
    'nothing sits above the canvas inside its card any more');
});

test('style.css: the palette is in flow, fixed height, with its own scrollbar', () => {
  // Comments are stripped first: the guard is about SELECTORS, so prose stays
  // free to name the drawer when explaining what replaced it.
  assert.equal(/\.gv-drawer/.test(REAL_CSS.replace(/\/\*[\s\S]*?\*\//g, '')), false,
    'every drawer rule is gone');
  assert.match(REAL_CSS, /\.gv-palette-card\{padding:0;overflow:hidden;display:flex;flex-direction:column;\}/,
    'same column-flex shape as .builder-card, and padding:0 beats .card{padding:24px}');
  assert.match(REAL_CSS, /\.gv-palette-scroll\{height:300px;overflow-y:auto;padding:14px 18px 8px;\}/,
    'height, NOT max-height, and no position/top/left/right/shadow — it overlays nothing');
  // Paired constants: .pal-pinned bleeds sideways by exactly the scroll
  // container's gutter to reach the card edge. Change one number without the
  // other and the pinned band sits inset or overhangs.
  assert.match(REAL_CSS, /\.pal-pinned\{[^}]*margin:0 -18px;padding:13px 18px 15px/,
    "the pinned band's bleed matches .gv-palette-scroll's 18px gutter");
});

test('style.css: the three composer cards are 22px apart', () => {
  assert.match(REAL_CSS, /\.view\[data-view="composer"\] > \.card ~ \.card\{margin-top:22px;\}/,
    '`~` not `+`: the empty #composer-dialog host sits between two of them');
});

test('style.css: the canvas keeps exactly the height it had', () => {
  // Neither is observable at runtime — jsdom has no layout — and both are the
  // difference between "the canvas moved" and "only the chrome around it did".
  assert.match(REAL_CSS, /\.builder-card\{[^}]*flex-direction:column[^}]*min-height:640px/,
    '640 = the 638px canvas + .card\'s two borders; the old 685 carried the 45px bar');
  assert.match(REAL_CSS, /\.gv-body\{[^}]*min-height:638px/,
    'the body row, not the card, owns the height');
  assert.match(REAL_CSS, /\.pills\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(min\(196px,100%\),1fr\)\)/,
    'the pills still wrap across the width instead of stacking in a column');
});

test('style.css: nothing pushes the canvas empty state down any more', () => {
  // No whole-file negative on the old `top:264px` here: it was a bare magic
  // number any unrelated rule could legitimately reuse, and the `.gv-drawer`
  // guard above already covers the selector that carried it.
  assert.match(REAL_CSS, /\.gv-empty\{[^}]*top:24px/);
});

test('index.html: the collapse handle is a SIBLING of the inspector host', () => {
  // renderInspector() calls replaceChildren() on #composer-inspector on every
  // repaint — a handle inside it would be deleted on the first selection.
  const rail = realDoc.querySelector('#composer-ins-rail');
  assert.ok(rail, '#composer-ins-rail exists');
  const handle = realDoc.querySelector('#composer-inspector-toggle');
  assert.ok(handle, '#composer-inspector-toggle exists');
  const host = realDoc.querySelector('#composer-inspector');
  assert.equal(handle.parentElement, rail, 'the handle hangs off the rail wrapper');
  assert.equal(host.parentElement, rail, 'and the host is its SIBLING, not its child');
  assert.equal(rail.parentElement, realDoc.querySelector('#composer-body'),
    'the rail sits in the body row');
  assert.equal(realDoc.querySelector('#composer-canvas').parentElement, rail.parentElement,
    'canvas and rail share that row');
  assert.equal(host.children.length, 0,
    'the inspector host ships empty — the editor owns its contents');
  assert.equal(handle.getAttribute('aria-controls'), 'composer-inspector');
  assert.equal(handle.querySelector('svg').getAttribute('aria-hidden'), 'true',
    'the chevron is decorative — the name comes from aria-label');
});

test('index.html: the collapse arrow points the way the panel travels', () => {
  // Expanded, the click collapses the rail RIGHTWARD, so the base path is a
  // right chevron. style.css rotates it 180deg while collapsed, which yields the
  // left chevron that means "click me to bring the panel back". The old base
  // path, M15 6l-6 6 6 6, was the left chevron and had both states backwards.
  const path = realDoc.querySelector('#composer-inspector-toggle svg path');
  assert.ok(path, 'the handle still ships an inline chevron');
  assert.equal(path.getAttribute('d'), 'M9 6l6 6-6 6');
});

test('style.css: the inspector floats over the canvas instead of shrinking it', () => {
  // position:absolute, not a flex item: the canvas keeps its full width and
  // collapsing the rail never reflows it. z-index 6 puts the rail over the
  // canvas decorations (.gv-empty/.gv-legend/.gv-zoom are 4) and nothing paints
  // above it now that the drawer is gone.
  assert.match(REAL_CSS, /\.gv-ins-rail\{[^}]*position:absolute/, 'the rail is out of flow');
  assert.match(REAL_CSS, /\.gv-ins-rail\{[^}]*right:0/, 'flush to the canvas right edge');
  assert.match(REAL_CSS, /\.gv-ins-rail\{[^}]*z-index:6/, 'over the canvas decorations');
  assert.match(REAL_CSS, /\.gv-ins-rail\{[^}]*width:280px/, 'width, not flex-basis, now sizes it');
  assert.match(REAL_CSS, /\.gv-body\{[^}]*position:relative/,
    'the row is the containing block the rail resolves against');
  assert.match(REAL_CSS, /\.gv-body\[data-inspector="collapsed"\] \.gv-ins-rail\{width:28px;\}/,
    'the collapsed rule sizes by width too — flex-basis no longer applies');
});

test('style.css: the inspector seam reads as a deliberate 2px edge', () => {
  // The palette's own 2px border-bottom went with the overlay — the card's
  // border and the 22px gap separate it now.
  assert.match(REAL_CSS, /\.gv-ins-rail\{[^}]*border-left:2px solid var\(--line-2\)/);
});

test('style.css: the canvas decorations clear the floating rail', () => {
  // .gv-zoom is the control a lost user reaches for; at right:20px it would sit
  // BEHIND the rail now that the canvas runs the full width.
  assert.match(REAL_CSS, /\.gv-body\{[^}]*--ins-w:280px/);
  assert.match(REAL_CSS, /\.gv-body\[data-inspector="collapsed"\]\{--ins-w:28px;\}/);
  assert.match(REAL_CSS, /\.gv-zoom\{[^}]*right:calc\(var\(--ins-w\) \+ 20px\)/);
  assert.match(REAL_CSS, /\.gv-empty\{[^}]*left:calc\(50% - var\(--ins-w\) \/ 2\)/);
});

test('canvasInsetRight() reports the floating rail width, collapsed or not', () => {
  // Deliberately NOT gated on data-inspector: the rail is always present, and
  // its collapsed 28px still covers the canvas's right edge. The number comes
  // off the live element, so the two states need no duplicated constants here.
  const { chrome } = boot({ railWidth: 280 });
  assert.equal(chrome.canvasInsetRight(), 280);

  const narrow = boot({ railWidth: 28 });
  assert.equal(narrow.chrome.canvasInsetRight(), 28);
});

test('canvasInsetRight() is 0 when no rail is wired', () => {
  // app.js passes null for a partial DOM, and every pre-inset test constructs
  // the chrome without one — 0 has to mean "the old arithmetic".
  const chrome = createComposerChrome({ storage: memStorage() });
  assert.equal(chrome.canvasInsetRight(), 0);
});
