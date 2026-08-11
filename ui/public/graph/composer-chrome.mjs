// ui/public/graph/composer-chrome.mjs
// Composer chrome: the inspector rail's disclosure state and its persistence.
//
// This module deliberately owns NO graph state. It never reads or writes a
// template, so it is constructed once and survives the editor teardown/rebuild
// that composerLoadTemplate() performs on every "New canvas" and every saved-
// pipeline open.
//
// The agent palette used to be a collapsible top drawer and this module owned
// its disclosure. The palette now lives in its own always-expanded card below
// the canvas, so the only thing left of that here is the Escape-clears-the-
// filter shortcut. `worca-cc.composer.drawer` is a dead localStorage key:
// nothing reads it, nothing writes it, and nothing migrates it away.

/** 'open' | 'collapsed' — the right rail's disclosure. A rail the user
 *  collapsed stays collapsed, across reloads and across template loads. */
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
 * @param {Element}  [opts.body]      #composer-body — carries data-inspector
 * @param {Element}  [opts.insToggle] #composer-inspector-toggle
 * @param {Element}  [opts.insRail]   #composer-ins-rail — measured for the right inset
 * @param {Element}  [opts.filter]    #composer-agent-filter — Escape clears it
 * @param {Storage}  [opts.storage]   defaults to globalThis.localStorage
 * @returns {{ canvasInsetRight(): number, destroy(): void }}
 */
export function createComposerChrome({
  body = null,
  insToggle = null,
  insRail = null,
  filter = null,
  storage = defaultStorage(),
} = {}) {
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

  /** Escape inside a non-empty filter clears it and stops there.
   *
   *  Bound on the FILTER, not the document: the editor already owns a
   *  document-level Escape (deselect, composer-editor.mjs:686), and a second
   *  document listener would fire both. stopPropagation runs ONLY when this
   *  handler actually consumed the key, so an Escape in an empty field still
   *  reaches the editor and still deselects.
   *
   *  preventDefault is load-bearing: the field is input[type=search], which
   *  Blink and WebKit clear on Escape themselves. Suppressing that keeps the
   *  clear happening exactly once here, and the synthetic `input` is what
   *  re-runs the editor's applyFilter(). */
  function onFilterKeyDown(ev) {
    if (ev.key !== 'Escape' || !filter || !filter.value) return;
    ev.preventDefault();
    ev.stopPropagation();
    filter.value = '';
    const doc = filter.ownerDocument;
    const view = doc ? doc.defaultView : null;
    if (view) filter.dispatchEvent(new view.Event('input', { bubbles: true }));
  }

  if (insToggle) insToggle.addEventListener('click', onInsToggleClick);
  if (filter) filter.addEventListener('keydown', onFilterKeyDown);
  setInspector(readKey(storage, INSPECTOR_KEY) !== 'collapsed');

  return {
    /** The rail FLOATS over the canvas's right edge (style.css), so the canvas
     *  rect is wider than the visible band. No isOpen()-style guard: the rail is
     *  always present, and its collapsed 28px is a real inset. jsdom answers 0,
     *  which is the pre-inset arithmetic. */
    canvasInsetRight() {
      if (!insRail || !insRail.getBoundingClientRect) return 0;
      return insRail.getBoundingClientRect().width || 0;
    },
    destroy() {
      if (insToggle) insToggle.removeEventListener('click', onInsToggleClick);
      if (filter) filter.removeEventListener('keydown', onFilterKeyDown);
    },
  };
}
