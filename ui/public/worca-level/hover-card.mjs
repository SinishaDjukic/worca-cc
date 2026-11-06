// ui/public/worca-level/hover-card.mjs — the card that shows beside the account corner (#side-acct)
// when the pointer rests on it or it takes keyboard focus: the level's avatar, name, "Level n of 4",
// a progress bar, up to two "Try next" links and a link to the Profile page. A non-modal popover:
// no backdrop, no focus trap, no form control. It never takes the click: the corner still opens the
// account menu, and the card steps aside when it does. Everything is painted as text.
import { placeFlyout } from '../side-flyout.mjs';
import { setAvatarSrc, tooltipModel } from './model.mjs';

export const HOVER_OPEN_DELAY_MS = 250;
export const HOVER_CLOSE_GRACE_MS = 150;   // lets the pointer cross the gap from the corner into the card
const AVATAR_PX = 40;
const PROFILE_HREF = '#profile/level';

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function link(doc, cls, text, href) {
  const a = h(doc, 'a', cls, text);
  a.setAttribute('href', href);
  return a;
}

function progressBar(doc, progress) {
  const bar = h(doc, 'div', 'ohc-bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Progress to the next level');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(progress.total));
  bar.setAttribute('aria-valuenow', String(progress.done));
  const fill = h(doc, 'span', 'ohc-fill');
  const pct = progress.total > 0 ? Math.max(0, Math.min(100, (progress.done / progress.total) * 100)) : 0;
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  return bar;
}

/** Build the card for an WorcaLevelView (detached). */
export function renderHoverCard(view, doc = globalThis.document) {
  const m = tooltipModel(view);
  const card = h(doc, 'div', 'worca-hover-card');
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'Your worca level');
  card.style.position = 'fixed';
  card.style.zIndex = '44';

  const head = h(doc, 'div', 'ohc-head');
  const img = h(doc, 'img', 'ohc-ava');
  setAvatarSrc(img, view.level.avatar);
  img.setAttribute('alt', '');
  img.setAttribute('width', String(AVATAR_PX));
  img.setAttribute('height', String(AVATAR_PX));
  const who = h(doc, 'div', 'ohc-who');
  who.appendChild(h(doc, 'div', 'ohc-name', m.name));
  who.appendChild(h(doc, 'div', 'ohc-level', m.levelLine));
  head.append(img, who);
  card.appendChild(head);

  if (view.progress) {
    card.appendChild(progressBar(doc, view.progress));
    card.appendChild(h(doc, 'div', 'ohc-prog', m.progressLine));
  }
  if (m.topLine) {
    card.appendChild(h(doc, 'p', 'ohc-top', m.topLine));
  } else if (m.tryNext.length) {
    const next = h(doc, 'div', 'ohc-next');
    next.appendChild(h(doc, 'div', 'ohc-k', 'Try next'));
    for (const a of m.tryNext) next.appendChild(link(doc, 'ohc-act', a.label, a.href));
    card.appendChild(next);
  }
  card.appendChild(link(doc, 'ohc-profile', 'See your level in Profile', PROFILE_HREF));
  return card;
}

/** Wire the card to the corner button. `getView()` returns the current WorcaLevelView (or a promise of
 *  one; null or a failure opens nothing). Returns { destroy() }. */
export function wireHoverCard(btn, { getView } = {}) {
  const doc = btn.ownerDocument;
  const win = doc.defaultView;
  let card = null;
  let openTimer = null;
  let closeTimer = null;
  let ticket = 0;      // bumps on every close, so a view that arrives late is dropped
  let quiet = false;   // a press or the open menu has the corner: focus alone does not open the card
  const menuOpen = () => btn.getAttribute('aria-expanded') === 'true';

  const clearTimers = () => {
    if (openTimer !== null) globalThis.clearTimeout(openTimer);
    if (closeTimer !== null) globalThis.clearTimeout(closeTimer);
    openTimer = null;
    closeTimer = null;
  };

  const onKey = (e) => { if (e.key === 'Escape') close(); };

  function close() {
    ticket += 1;
    clearTimers();
    doc.removeEventListener('keydown', onKey);
    if (!card) return;
    card.remove();
    card = null;
  }

  async function open() {
    if (card || menuOpen()) return;
    const mine = ++ticket;
    let view = null;
    try {
      view = await getView();
    } catch {
      return;   // no view, no card: the corner works without it
    }
    if (mine !== ticket || card || menuOpen() || !view || !view.level) return;
    card = renderHoverCard(view, doc);
    btn.insertAdjacentElement('afterend', card);
    placeFlyout(card, btn, { mode: 'side', win });
    card.addEventListener('mouseenter', cancelClose);
    card.addEventListener('mouseleave', scheduleClose);
    card.addEventListener('focusout', (e) => {
      const to = e.relatedTarget;
      if (!to || (!card.contains(to) && to !== btn)) close();
    });
    doc.addEventListener('keydown', onKey);
  }

  function cancelClose() {
    if (closeTimer !== null) globalThis.clearTimeout(closeTimer);
    closeTimer = null;
  }

  function scheduleClose() {
    if (openTimer !== null) globalThis.clearTimeout(openTimer);
    openTimer = null;
    ticket += 1;   // a view still loading is no longer wanted
    if (!card) return;
    cancelClose();
    closeTimer = globalThis.setTimeout(close, HOVER_CLOSE_GRACE_MS);
  }

  const onEnter = () => {
    cancelClose();
    if (card || openTimer !== null) return;
    openTimer = globalThis.setTimeout(() => { openTimer = null; open(); }, HOVER_OPEN_DELAY_MS);
  };
  const onFocus = () => { if (!quiet) open(); };
  const onBlur = (e) => {
    quiet = false;
    const to = e.relatedTarget;
    if (card && to && card.contains(to)) return;
    close();
  };
  const onPress = () => { quiet = true; close(); };
  const onClick = () => { quiet = true; close(); };   // never preventDefault: the click opens the menu

  const observer = win.MutationObserver ? new win.MutationObserver(() => {
    if (menuOpen()) { quiet = true; close(); }
  }) : null;
  observer?.observe(btn, { attributes: true, attributeFilter: ['aria-expanded'] });

  btn.addEventListener('mouseenter', onEnter);
  btn.addEventListener('mouseleave', scheduleClose);
  btn.addEventListener('focus', onFocus);
  btn.addEventListener('blur', onBlur);
  btn.addEventListener('mousedown', onPress);
  btn.addEventListener('click', onClick);

  return {
    destroy() {
      close();
      observer?.disconnect();
      btn.removeEventListener('mouseenter', onEnter);
      btn.removeEventListener('mouseleave', scheduleClose);
      btn.removeEventListener('focus', onFocus);
      btn.removeEventListener('blur', onBlur);
      btn.removeEventListener('mousedown', onPress);
      btn.removeEventListener('click', onClick);
    },
  };
}
