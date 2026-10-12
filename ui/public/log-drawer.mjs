// ui/public/log-drawer.mjs — the step log drawer docked under a run's workflow graph
// (plans/workflow-log-drawer-design.md). A card click opens one step's log here, so the graph
// stays in view; another click retargets it; × or Esc closes it. The drawer owns its DOM, the
// close keys, focus return and its height (dragged or arrow keys on the handle, kept per browser).
// It knows nothing about runs: the caller fills `body` and sets the header.

export const HEIGHT_KEY = 'worca-cc.logDrawer.height';
export const MIN_H = 120;
export const MAX_FRACTION = 0.7;   // of the viewport
const KEY_STEP = 24;

function readStore(storage, key) { try { return storage ? storage.getItem(key) : null; } catch { return null; } }
function writeStore(storage, key, v) { try { if (storage) storage.setItem(key, v); } catch { /* private mode */ } }

/** `h` clamped to [MIN_H, 70% of the viewport]; null for a value that is not a number. */
export function clampHeight(h, viewport) {
  const n = Number(h);
  if (!Number.isFinite(n) || n <= 0) return null;
  const max = Math.max(MIN_H, Math.floor((Number(viewport) || 0) * MAX_FRACTION));
  return Math.round(Math.min(Math.max(n, MIN_H), max));
}

/**
 * @param {{doc: Document, win?: {innerHeight?: number}, storage?: object,
 *   onClose?: () => void, onOpenInLogs?: () => void}} o
 */
export function createLogDrawer({ doc, win = {}, storage = null, onClose = null, onOpenInLogs = null }) {
  const el = doc.createElement('section');
  el.className = 'wf-log-drawer';
  el.hidden = true;
  el.setAttribute('aria-label', 'Step log');
  el.innerHTML =
    '<div class="wf-log-resize" role="separator" aria-orientation="horizontal" tabindex="0" aria-label="Resize the step log"></div>' +
    '<header class="wf-log-head">' +
      '<span class="wf-log-title"></span><span class="wf-log-live" hidden>live</span>' +
      '<span class="wf-log-spacer"></span>' +
      '<button type="button" class="btn-ghost btn-mini wf-log-full">Open in Logs</button>' +
      '<button type="button" class="wf-log-close" aria-label="Close the step log" title="Close (Esc)">×</button>' +
    '</header>' +
    '<div class="log wf-log-body" tabindex="0"></div>';
  const title = el.querySelector('.wf-log-title');
  const live = el.querySelector('.wf-log-live');
  const body = el.querySelector('.wf-log-body');
  const handle = el.querySelector('.wf-log-resize');
  let returnFocus = null;

  const viewport = () => Number(win.innerHeight) || 800;
  function setHeight(h, { persist = false } = {}) {
    const v = clampHeight(h, viewport());
    if (v == null) { el.style.removeProperty('--wf-log-h'); return null; }
    el.style.setProperty('--wf-log-h', `${v}px`);
    handle.setAttribute('aria-valuenow', String(v));
    if (persist) writeStore(storage, HEIGHT_KEY, String(v));
    return v;
  }
  const currentHeight = () => parseInt(el.style.getPropertyValue('--wf-log-h'), 10) || el.getBoundingClientRect().height || 0;

  function close() {
    if (el.hidden) return;
    el.hidden = true;
    const back = returnFocus;
    returnFocus = null;
    if (typeof onClose === 'function') onClose();
    if (back && back.isConnected && typeof back.focus === 'function') back.focus();
  }

  el.querySelector('.wf-log-close').addEventListener('click', close);
  el.querySelector('.wf-log-full').addEventListener('click', () => { if (typeof onOpenInLogs === 'function') onOpenInLogs(); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.target === handle && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      setHeight(currentHeight() + (e.key === 'ArrowUp' ? KEY_STEP : -KEY_STEP), { persist: true });
    }
  });
  // Dragging the top edge up makes the drawer taller.
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = currentHeight();
    const move = (ev) => setHeight(startH + (startY - ev.clientY));
    const up = () => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      setHeight(currentHeight(), { persist: true });
    };
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
  });

  setHeight(readStore(storage, HEIGHT_KEY));   // nothing stored: style.css's default height

  return {
    el,
    body,
    /** Show the drawer. `opener` gets focus back on close; `isLive` shows the live mark. */
    open({ label = '', isLive = false, opener = null } = {}) {
      title.textContent = label;
      live.hidden = !isLive;
      if (opener) returnFocus = opener;
      el.hidden = false;
    },
    setLive(on) { live.hidden = !on; },
    close,
    isOpen: () => !el.hidden,
    setHeight,
  };
}
