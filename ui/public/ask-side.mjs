// ui/public/ask-side.mjs — Ask worca beside the page: the side column's controller (aside#ask-side under the top bar,
// beside main.main). It shows and hides the column (the person's choice is remembered across pages and reloads; a page
// without the column hides it without forgetting), sizes it (360-680px from its left edge, remembered), plays the
// 320 ms slide, and answers the rail question app.js asks (railCollapsed). The chat itself is app.js's: onShow moves
// the ONE Ask panel in (told whether the header button asked), onHide closes it. Where the column covers the page
// (<= 1080px), uncover() steps it aside for a page the chat itself opened (a run card, a link).

export const SIDE_MIN = 360;
export const SIDE_MAX = 680;
export const SIDE_DEFAULT = 440;
export const SIDE_MS = 320;
export const PAGE_MIN = 640;
export const MENU_W = 224;
export const OPEN_KEY = 'worca-cc.askSide.open';
export const WIDTH_KEY = 'worca-cc.askSide.width';
const STEP = 20;

/** A stored or dragged width as the column takes it: nothing usable → the default; else rounded into 360-680. */
export function clampWidth(px) {
  if (px === null || px === undefined || px === '') return SIDE_DEFAULT;
  const n = Number(px);
  if (!Number.isFinite(n)) return SIDE_DEFAULT;
  return Math.min(SIDE_MAX, Math.max(SIDE_MIN, Math.round(n)));
}

/** > 1080px the column pushes the page; 761-1080px it covers the main column; ≤ 760px it is full width under the bar. */
export function sideTier(innerWidth) {
  const w = Number(innerWidth) || 0;
  if (w > 1080) return 'push';
  if (w > 760) return 'over';
  return 'full';
}

/** The sidebar folds to its rail while a pushing column would leave the page narrower than 640px (never stored). */
export function railForced({ innerWidth, sideW, termW = 0, shown }) {
  return !!shown && sideTier(innerWidth) === 'push' && (Number(innerWidth) || 0) - MENU_W - (Number(sideW) || 0) - (Number(termW) || 0) < PAGE_MIN;
}

/**
 * @param {{ doc: Document, win: Window, storage: Storage|null, aside: HTMLElement, button: HTMLElement,
 *   getTermW?: () => number, onShow?: (o: { focus: boolean, button: boolean }) => void, onHide?: () => void, onLayout?: () => void }} o
 */
export function createAskSide({ doc, win, storage, aside, button, getTermW = () => 0, onShow = () => {}, onHide = () => {}, onLayout = () => {} }) {
  const read = (k) => { try { return storage ? storage.getItem(k) : null; } catch { return null; } };
  const write = (k, v) => { try { if (storage) storage.setItem(k, v); } catch { /* private mode: a remembered choice is a nicety */ } };
  // parked: stepped aside for a page the chat opened (uncover): routes leave it aside until a page has no column; the
  // person's show() reveals it whatever the flag says.
  const st = { available: false, shown: false, width: clampWidth(read(WIDTH_KEY)), timer: null, drag: null, dead: false, parked: false };
  const body = doc.body;
  const reduced = () => {
    try { return !!(win && typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
  };
  const wanted = () => read(OPEN_KEY) === '1';

  // The left edge's grab zone: a keyboard separator too (ArrowLeft widens, ArrowRight narrows).
  const grip = doc.createElement('div');
  grip.className = 'ask-side-grip';
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  grip.setAttribute('aria-label', 'Resize the chat');
  grip.setAttribute('aria-valuemin', String(SIDE_MIN));
  grip.setAttribute('aria-valuemax', String(SIDE_MAX));
  grip.setAttribute('aria-valuenow', String(st.width));
  grip.tabIndex = 0;
  aside.prepend(grip);

  function setWidth(px, { store = false } = {}) {
    st.width = clampWidth(px);
    body.style.setProperty('--ask-side-w', `${st.width}px`);
    grip.setAttribute('aria-valuenow', String(st.width));
    if (store) write(WIDTH_KEY, String(st.width));
    onLayout();
  }
  function clearMotion() {
    if (st.timer) { win.clearTimeout(st.timer); st.timer = null; }
    aside.classList.remove('is-entering', 'is-leaving');
  }
  function reveal({ focus = false, button: viaButton = false } = {}) {
    if (st.shown || st.dead) return;
    clearMotion();
    st.shown = true;
    aside.hidden = false;
    body.classList.add('ask-side-open');
    body.style.setProperty('--ask-side-w', `${st.width}px`);
    button.setAttribute('aria-expanded', 'true');
    if (!reduced()) {
      aside.classList.add('is-entering');
      st.timer = win.setTimeout(() => { st.timer = null; aside.classList.remove('is-entering'); }, SIDE_MS);
    }
    onShow({ focus: !!focus, button: !!viaButton });
    onLayout();
  }
  function conceal({ animate = true } = {}) {
    if (!st.shown) {
      // A hide still sliding out when the route takes the column away (Chat, Workflows): gone at once, as promised.
      if (!animate && aside.classList.contains('is-leaving')) { clearMotion(); aside.hidden = true; body.classList.remove('ask-side-open'); }
      return;
    }
    clearMotion();
    st.shown = false;
    button.setAttribute('aria-expanded', 'false');
    const done = () => {
      st.timer = null;
      aside.classList.remove('is-leaving');
      aside.hidden = true;
      body.classList.remove('ask-side-open');
    };
    onHide();
    onLayout();
    if (animate && !reduced()) {
      aside.classList.add('is-leaving');
      st.timer = win.setTimeout(done, SIDE_MS);
    } else done();
  }
  /** The person's: remembered. Shown at once where the column is available, else on the next page that has it.
   *  `button`: the header button asked (onShow then lands on the chat whose reply lit its dot, as the Chat row does). */
  function show({ focus = false, button: viaButton = false } = {}) {
    write(OPEN_KEY, '1');
    if (st.available) reveal({ focus, button: viaButton });
  }
  function hide() {
    write(OPEN_KEY, '0');
    const hadFocus = aside.contains(doc.activeElement);
    conceal();
    if (hadFocus) { try { button.focus(); } catch { /* detached */ } }   // a keyboard Hide chat lands on the toggle, never <body>
  }
  function toggle() {
    if (st.shown) hide();
    else show({ focus: true, button: true });
  }
  /** A run card or a page link in the chat opens a page: where the column covers the page (<= 1080px) it steps aside
   *  so that page shows, the choice kept; the button, an entry point or a page without the column ends it. Above
   *  1080px the page is beside the chat already (L9). */
  function uncover() {
    if (!st.shown || sideTier(win.innerWidth) === 'push') return;
    st.parked = true;
    // A focus in the column, or one the opener's own close already dropped on <body> (a topic row or Manage in Connectors
    // closes its menu first), goes to the toggle; a focus on the page or in the bar stays where it is.
    const f = doc.activeElement;
    const hadFocus = !f || f === doc.body || aside.contains(f);
    conceal();
    if (hadFocus) { try { button.focus(); } catch { /* detached */ } }   // the link or card that opened the page goes with the column
  }
  /** The route's: Chat and Workflows have no column (hidden at once, the choice kept); every other page shows it when wanted. */
  function setAvailable(on) {
    st.available = !!on;
    if (!st.available) { st.parked = false; conceal({ animate: false }); }
    else if (wanted() && !st.parked) reveal({ focus: false });
  }

  const onButton = () => toggle();
  const onResize = () => onLayout();
  const onMove = (e) => {
    if (!st.drag) return;
    if (!e.buttons) { onUp(); return; }                // a release this document never saw (over an iframe)
    const right = aside.getBoundingClientRect().right;
    setWidth(right - e.clientX);
  };
  const onUp = () => {
    if (!st.drag) return;
    st.drag = null;
    aside.classList.remove('is-resizing');
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerup', onUp);
    doc.removeEventListener('pointercancel', onUp);
    write(WIDTH_KEY, String(st.width));
  };
  const onDown = (e) => {
    if (e.button !== 0 || st.drag) return;
    e.preventDefault();
    st.drag = { id: e.pointerId };
    try { grip.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
    aside.classList.add('is-resizing');
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
    doc.addEventListener('pointercancel', onUp);
  };
  const onKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;  // Alt+Left is the browser's Back
    e.preventDefault();
    setWidth(st.width + (e.key === 'ArrowLeft' ? STEP : -STEP), { store: true });
  };
  button.addEventListener('click', onButton);
  grip.addEventListener('pointerdown', onDown);
  grip.addEventListener('keydown', onKey);
  win.addEventListener('resize', onResize);

  return {
    show,
    hide,
    toggle,
    uncover,
    setAvailable,
    available: () => st.available,
    shown: () => st.shown,
    wanted,
    width: () => st.width,
    forcesRail: () => railForced({ innerWidth: win.innerWidth || 0, sideW: st.width, termW: getTermW(), shown: st.shown }),
    /** Something else moved the layout (the terminal pane opened or closed): re-ask the rail question. */
    relayout: () => onLayout(),
    destroy() {
      st.dead = true;
      clearMotion();
      onUp();
      button.removeEventListener('click', onButton);
      grip.removeEventListener('pointerdown', onDown);
      grip.removeEventListener('keydown', onKey);
      win.removeEventListener('resize', onResize);
      grip.remove();
    },
  };
}
