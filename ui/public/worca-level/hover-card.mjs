// ui/public/worca-level/hover-card.mjs — the card that shows beside the account corner (#side-acct)
// when the pointer rests on it or it takes keyboard focus: the level's avatar, name, "Level n of 5 ·
// tagline", the Next level with its progress segments, up to two "Try next" links and a link to the
// Profile page (a top-level view shows the top message instead). A non-modal popover:
// no backdrop, no focus trap, no form control. It never takes the click: the corner still opens the
// account menu, and the card steps aside when it does. Everything is painted as text.
import { placeFlyout } from '../side-flyout.mjs';
import { setAvatarSrc, tooltipModel } from './model.mjs';
import { renderSegments } from './segments.mjs';

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

function tryRow(doc, a) {
  const row = link(doc, 'wl-try', null, a.href);
  row.append(h(doc, 'span', 'wl-try-t', a.label), h(doc, 'span', 'wl-try-go', '→'), h(doc, 'span', 'wl-try-h', a.hint));
  return row;
}

function nextBlock(doc, m) {
  const next = h(doc, 'div', 'wl-hc-next');
  next.append('Next: ', h(doc, 'strong', null, m.nextName));
  if (m.progressText) next.append(h(doc, 'span', 'wl-hc-prog', ` · ${m.progressText}`));
  return next;
}

/** Build the card for an WorcaLevelView (detached). */
export function renderHoverCard(view, doc = globalThis.document) {
  const m = tooltipModel(view);
  const card = h(doc, 'div', 'worca-hover-card');
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'Your worca level');
  card.style.position = 'fixed';
  card.style.zIndex = '44';

  const head = h(doc, 'div', 'wl-hc-head');
  const img = h(doc, 'img', 'wl-hc-ava');
  setAvatarSrc(img, view.level.avatar);
  img.setAttribute('alt', '');
  img.setAttribute('width', String(AVATAR_PX));
  img.setAttribute('height', String(AVATAR_PX));
  const who = h(doc, 'div', 'wl-hc-who');
  who.appendChild(h(doc, 'div', 'wl-hc-name', m.name));
  const levelText = m.tagline ? `${m.levelLine} · ${m.tagline}` : m.levelLine;
  who.appendChild(h(doc, 'div', 'wl-hc-level', levelText));
  head.append(img, who);
  card.appendChild(head);

  if (m.topLine) {
    card.appendChild(h(doc, 'p', 'wl-top', m.topLine));
  } else {
    if (m.nextName) card.appendChild(nextBlock(doc, m));
    if (m.segments) card.appendChild(renderSegments(doc, m.segments, { size: 'sm' }));
    if (m.tryNext.length) {
      const tries = h(doc, 'div', 'wl-hc-tries');
      tries.appendChild(h(doc, 'div', 'wl-hc-k', m.tryNextHeading));
      for (const a of m.tryNext) tries.appendChild(tryRow(doc, a));
      card.appendChild(tries);
    }
  }
  card.appendChild(link(doc, 'wl-profile-link', 'See your level in Profile', PROFILE_HREF));
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
