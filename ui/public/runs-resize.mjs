// ui/public/runs-resize.mjs — QA 2: the handle on the border between the Runs list and the run / feature page. A
// focusable vertical separator: drag, ←/→ by 16px, Home or a double-click resets to the default; the width is kept per
// browser. Pure DOM over the shell's document; app.js mounts it once on #runs-shell.
export const LIST_W_KEY = 'worca-cc.runs.listWidth';
export const MIN_W = 280;
export const MAX_W = 640;
export const KEY_STEP = 16;

function readStore(storage, key) { try { return storage ? storage.getItem(key) : null; } catch { return null; } }
function writeStore(storage, key, v) { try { if (storage) storage.setItem(key, v); } catch { /* private mode */ } }
function dropStore(storage, key) { try { if (storage) storage.removeItem(key); } catch { /* private mode */ } }

/** The largest list width for a window: the smaller of half the window and 640px, never under the minimum. */
export const maxListWidth = (winW) => Math.max(MIN_W, Math.min(MAX_W, Math.floor(winW / 2)));
/** `w` inside [MIN_W, maxListWidth(winW)], rounded to a pixel. */
export function clampListWidth(w, winW) {
  return Math.min(maxListWidth(winW), Math.max(MIN_W, Math.round(Number(w) || 0)));
}
export const DEFAULT_W = 340;
/** The default (style.css `clamp(280px,340px,min(50%,640px))`): 340px, at most half the shell and 640px, never under 280px. */
export const defaultListWidth = (shellW) => Math.max(MIN_W, Math.min(DEFAULT_W, MAX_W, Math.floor((Number(shellW) || 0) / 2)));

/**
 * Mount the handle into `shell`'s `.runs-list-pane`. `storage` is app.js's guarded localStorage, `win` the window.
 * Returns { width() → the current px width, reset(), paint(), destroy() }. `key`, `cssVar`, `paneSel` and `label` default to the
 * Runs list's; the Chats column (#948 s2) passes its own.
 */
export function mountRunsResize(shell, { storage, win, key = LIST_W_KEY, cssVar = '--runs-list-w', paneSel = '.runs-list-pane',
  label = 'Resize the runs list' }) {
  const doc = shell.ownerDocument;
  const pane = shell.querySelector(paneSel) || shell;
  const handle = doc.createElement('div');
  handle.className = 'runs-resize';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', label);
  handle.setAttribute('aria-valuemin', String(MIN_W));
  handle.tabIndex = 0;
  pane.append(handle);
  const stored = Number.parseInt(readStore(storage, key) || '', 10);
  let chosen = Number.isFinite(stored) ? stored : null;      // the person's width; null = the default
  // The width the list has right now. With no chosen width it is the CSS default as rendered: measured live, because
  // app.js mounts this at boot while the Runs view is usually hidden (0 wide). The formula covers jsdom and hidden.
  const width = () => {
    if (chosen != null) return clampListWidth(chosen, win.innerWidth);
    const live = Math.round(pane.getBoundingClientRect().width);
    return live > 0 ? live : defaultListWidth(shell.clientWidth);
  };
  const paint = () => {
    handle.setAttribute('aria-valuemax', String(maxListWidth(win.innerWidth)));
    if (chosen == null) shell.style.removeProperty(cssVar);
    else shell.style.setProperty(cssVar, `${width()}px`);
    handle.setAttribute('aria-valuenow', String(width()));
  };
  const set = (w, { persist = false } = {}) => {
    chosen = clampListWidth(w, win.innerWidth);
    paint();
    if (persist) writeStore(storage, key, String(chosen));
  };
  const reset = () => { chosen = null; dropStore(storage, key); paint(); };
  handle.addEventListener('focus', paint);                  // aria-valuenow is current when a screen reader lands here
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      set(width() + (e.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP), { persist: true });
    } else if (e.key === 'Home') { e.preventDefault(); reset(); }
  });
  handle.addEventListener('dblclick', (e) => { e.preventDefault(); reset(); });
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width();
    shell.classList.add('is-resizing');
    const move = (ev) => set(w0 + (ev.clientX - x0));
    // Release saves the width the drag reached; a cancelled pointer (a touch taken over, a lost capture) ends the drag too.
    const end = () => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', end);
      doc.removeEventListener('pointercancel', end);
      shell.classList.remove('is-resizing');
      if (chosen != null) writeStore(storage, key, String(chosen));
    };
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', end);
    doc.addEventListener('pointercancel', end);
  });
  win.addEventListener('resize', paint);
  paint();
  const destroy = () => { win.removeEventListener('resize', paint); handle.remove(); };
  return { width, reset, paint, destroy };
}
