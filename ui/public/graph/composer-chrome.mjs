// ui/public/graph/composer-chrome.mjs
// Composer chrome: the top agent drawer's disclosure state and its persistence.
//
// This module deliberately owns NO graph state. It never reads or writes a
// template, so it is constructed once and survives the editor teardown/rebuild
// that composerLoadTemplate() performs on every "New canvas" and every saved-
// pipeline open.
//
// Escape is bound on the DRAWER, not the document, because the editor already
// owns a document-level Escape (deselect, composer-editor.mjs:686, registered
// at :749 in the bubble phase). A second document listener would fire both.

/** 'open' | 'closed' — any manual toggle writes it, and it then wins forever. */
export const DRAWER_KEY = 'worca-cc.composer.drawer';

/** 'open' | 'collapsed' — the right rail's disclosure, same sticky contract.
 *  Unlike the drawer it has NO template-derived default: a rail the user
 *  collapsed stays collapsed, and syncDefault() never touches it. */
export const INSPECTOR_KEY = 'worca-cc.composer.inspector';

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }   // private mode throws
}

function readKey(storage, key) {
  try { return storage ? storage.getItem(key) : null; } catch { return null; }
}

function writeKey(storage, key, value) {
  try { if (storage) storage.setItem(key, value); } catch { /* private mode */ }
}

/**
 * @param {object}   opts
 * @param {Element}  opts.drawer      #composer-drawer — carries data-open
 * @param {Element}  opts.toggle      #composer-drawer-toggle
 * @param {Element}  opts.panel       #composer-palette — measured for the canvas inset
 * @param {Element}  [opts.canvas]    #composer-canvas — light dismiss target
 * @param {Element}  [opts.filter]    #composer-agent-filter — Escape stage 1, auto-open
 * @param {Element}  [opts.body]      #composer-body — carries data-inspector
 * @param {Element}  [opts.insToggle] #composer-inspector-toggle
 * @param {Element}  [opts.insRail]  #composer-ins-rail — measured for the right inset
 * @param {Storage}  [opts.storage]   defaults to globalThis.localStorage
 * @param {Function} [opts.hasAgents] () => boolean, consulted ONLY while no key is stored
 * @returns {{ canvasInsetTop(): number, canvasInsetRight(): number, syncDefault(): void, destroy(): void }}
 */
export function createComposerChrome({
  drawer = null,
  toggle = null,
  panel = null,
  canvas = null,
  filter = null,
  body = null,
  insToggle = null,
  insRail = null,
  storage = defaultStorage(),
  hasAgents = () => false,
} = {}) {
  const isOpen = () => Boolean(drawer) && drawer.dataset.open === 'true';
  const ownerDoc = () => (drawer ? drawer.ownerDocument : null);

  function setDrawer(open, { persist = false } = {}) {
    if (!drawer) return;
    drawer.dataset.open = open ? 'true' : 'false';
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (persist) writeKey(storage, DRAWER_KEY, open ? 'open' : 'closed');
  }

  /** Apply the stored preference, or — only while none exists — the first-visit
   *  default. `hasAgents`, never a node count: newCanvas() preloads Task + End. */
  function syncDefault() {
    const stored = readKey(storage, DRAWER_KEY);
    if (stored === 'open' || stored === 'closed') return void setDrawer(stored === 'open');
    setDrawer(!hasAgents());
  }

  function onToggleClick() {
    setDrawer(!isOpen(), { persist: true });
  }

  function onDrawerKeyDown(ev) {
    if (ev.key !== 'Escape' || !isOpen()) return;
    ev.stopPropagation();               // the editor's deselect must not also fire
    // Stage 1: a non-empty filter is the innermost dismissable state. The field
    // is input[type=search], which Blink and WebKit clear on Escape themselves —
    // preventDefault suppresses that so the clear happens exactly once here, and
    // the synthetic `input` re-runs the editor's applyFilter().
    if (filter && filter.value) {
      ev.preventDefault();
      filter.value = '';
      const view = ownerDoc() ? ownerDoc().defaultView : null;
      if (view) filter.dispatchEvent(new view.Event('input', { bubbles: true }));
      return;
    }
    // Stage 2: collapse, and persist — Escape is a deliberate manual toggle.
    // Rescue focus ONLY out of the part about to be hidden: the bar, and the
    // filter in it, stay visible.
    const active = ownerDoc() ? ownerDoc().activeElement : null;
    if (panel && active && panel.contains(active) && toggle && toggle.focus) toggle.focus();
    setDrawer(false, { persist: true });
  }

  /** Light dismiss. The open panel overlays the canvas's top 240px, and the
   *  editor binds pointerdown on the canvas only (composer-editor.mjs:745), so
   *  without this a third of the canvas cannot start a gesture. Deliberately
   *  does NOT persist: a canvas press is a statement about the graph, not a
   *  disclosure decision — the same rule as a pill click. Closing now DOES
   *  reflow (the body row is 240px shorter with the drawer shut,
   *  style.css:778), but only its BOTTOM edge moves: the canvas still starts
   *  45px below the card top, so the editor's own onPointerDown, running next
   *  on this same event, reads an unchanged rect.left/rect.top and toWorld()
   *  stays accurate. */
  function onCanvasPointerDown() {
    if (isOpen()) setDrawer(false);
  }

  /** The bar is always visible, so typing into it while collapsed would filter
   *  a list nobody can see. Reveal, but do not persist — the intent was to
   *  search, not to change the disclosure preference. The `filter.value` test is
   *  load-bearing and jsdom cannot show why: while the drawer is collapsed the
   *  Escape handler bails early, so Blink/WebKit run their OWN
   *  input[type=search] clear and fire a real `input` — which without this guard
   *  would spring the drawer back open on a keystroke that meant "dismiss". */
  function onFilterInput() {
    if (!isOpen() && filter && filter.value) setDrawer(true);
  }

  const insOpen = () => !body || body.dataset.inspector !== 'collapsed';

  function setInspector(open, { persist = false } = {}) {
    if (!body) return;
    body.dataset.inspector = open ? 'open' : 'collapsed';
    if (insToggle) {
      insToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      insToggle.setAttribute('aria-label', open ? 'Collapse inspector' : 'Expand inspector');
    }
    if (persist) writeKey(storage, INSPECTOR_KEY, open ? 'open' : 'collapsed');
  }

  function onInsToggleClick() {
    setInspector(!insOpen(), { persist: true });
  }

  if (toggle) toggle.addEventListener('click', onToggleClick);
  if (drawer) drawer.addEventListener('keydown', onDrawerKeyDown);
  if (canvas) canvas.addEventListener('pointerdown', onCanvasPointerDown);
  if (filter) filter.addEventListener('input', onFilterInput);
  if (insToggle) insToggle.addEventListener('click', onInsToggleClick);
  syncDefault();
  setInspector(readKey(storage, INSPECTOR_KEY) !== 'collapsed');

  return {
    canvasInsetTop() {
      if (!panel || !isOpen() || !panel.getBoundingClientRect) return 0;
      return panel.getBoundingClientRect().height || 0;
    },
    /** The rail FLOATS over the canvas's right edge (style.css:978), so the
     *  canvas rect is wider than the visible band. No isOpen()-style guard:
     *  unlike the palette the rail is always present, and its collapsed 28px is
     *  a real inset. jsdom answers 0, which is the pre-inset arithmetic. */
    canvasInsetRight() {
      if (!insRail || !insRail.getBoundingClientRect) return 0;
      return insRail.getBoundingClientRect().width || 0;
    },
    syncDefault,
    destroy() {
      if (toggle) toggle.removeEventListener('click', onToggleClick);
      if (drawer) drawer.removeEventListener('keydown', onDrawerKeyDown);
      if (canvas) canvas.removeEventListener('pointerdown', onCanvasPointerDown);
      if (filter) filter.removeEventListener('input', onFilterInput);
      if (insToggle) insToggle.removeEventListener('click', onInsToggleClick);
    },
  };
}
