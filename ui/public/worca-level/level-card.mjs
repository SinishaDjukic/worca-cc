// ui/public/worca-level/level-card.mjs — the level card at the top of the account menu (#acct-menu). It opens
// with the menu, on a click or Enter; nothing opens on hover or focus. A header (avatar, name, "Level n of 5"),
// the progress to the next level, up to two "Try next" links and a link to the Profile page; a top-level view
// shows the top message instead of progress. A person with no level yet gets the initials and the step that
// earns the first one. The wrapper has role "none": only the links and buttons are menu items, so the arrow
// keys move between them. Everything is painted as text.
import { setAvatarSrc, tooltipModel } from './model.mjs';
import { renderSegments } from './segments.mjs';

const AVATAR_PX = 40;
const PROFILE_HREF = '#profile/level';
export const CARD_ID = 'acct-level-card';
const NO_LEVEL_SETUP = 'Finish setup to earn your first level.';
const NO_LEVEL_PROVIDER = 'Sign in to a model provider to earn your first level.';

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function shell(doc) {
  const card = h(doc, 'div', 'wl-menu-card');
  card.id = CARD_ID;
  card.setAttribute('role', 'none');
  return card;
}

/** A menu link to an in-app hash route. data-nav lets the account menu route the click and close itself. */
function menuLink(doc, cls, text, href) {
  const a = h(doc, 'a', cls, text);
  a.setAttribute('href', href);
  a.setAttribute('role', 'menuitem');
  const route = href.slice(1);
  const slash = route.indexOf('/');
  a.dataset.nav = slash === -1 ? route : route.slice(0, slash);
  a.dataset.hash = route;
  return a;
}

function tryRow(doc, a) {
  const row = menuLink(doc, 'wl-try', null, a.href);
  row.append(h(doc, 'span', 'wl-try-t', a.label), h(doc, 'span', 'wl-try-go', '→'), h(doc, 'span', 'wl-try-h', a.hint));
  return row;
}

function nextBlock(doc, m) {
  const next = h(doc, 'div', 'wl-hc-next');
  next.append('Next: ', h(doc, 'strong', null, m.nextName));
  if (m.progressText) next.append(h(doc, 'span', 'wl-hc-prog', ` · ${m.progressText}`));
  return next;
}

function header(doc, level, m) {
  const head = h(doc, 'div', 'wl-hc-head');
  const img = h(doc, 'img', 'wl-hc-ava');
  setAvatarSrc(img, level.avatar);
  img.setAttribute('alt', '');
  img.setAttribute('width', String(AVATAR_PX));
  img.setAttribute('height', String(AVATAR_PX));
  const who = h(doc, 'div', 'wl-hc-who');
  who.appendChild(h(doc, 'div', 'wl-hc-name', m.name));
  who.appendChild(h(doc, 'div', 'wl-hc-level', m.tagline ? `${m.levelLine} · ${m.tagline}` : m.levelLine));
  head.append(img, who);
  return head;
}

/** The card for a WorcaLevelView; null until the view has a level. */
export function renderLevelCard(doc, view) {
  const level = view && view.level;
  if (!level || typeof level.name !== 'string' || !level.name) return null;
  const m = tooltipModel(view);
  const card = shell(doc);
  card.appendChild(header(doc, level, m));
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
  card.appendChild(menuLink(doc, 'wl-profile-link', 'See your level in Profile', PROFILE_HREF));
  return card;
}

function action(doc, text, onPress) {
  const b = h(doc, 'button', 'wl-menu-act', text);
  b.type = 'button';
  b.setAttribute('role', 'menuitem');
  b.addEventListener('click', () => { if (typeof onPress === 'function') onPress(); });
  return b;
}

/** The card for a person with no level yet. `missing` is the setup's list ('setup' / 'provider'); only the
 *  provider missing asks for a sign-in, anything else asks to finish setup. */
export function renderNoLevelCard(doc, { initials = '', missing = [], onFinishSetup, onSignIn } = {}) {
  const providerOnly = Array.isArray(missing) && missing.length === 1 && missing[0] === 'provider';
  const card = shell(doc);
  const head = h(doc, 'div', 'wl-hc-head');
  head.append(h(doc, 'span', 'wl-menu-ava', initials), h(doc, 'p', 'wl-top', providerOnly ? NO_LEVEL_PROVIDER : NO_LEVEL_SETUP));
  card.appendChild(head);
  card.appendChild(providerOnly ? action(doc, 'Sign in to a model', onSignIn) : action(doc, 'Finish setup', onFinishSetup));
  return card;
}

/** Put the card for `view` first in `menu`: a repaint replaces it in place, and a null view removes it. A view
 *  whose level is null gets the no-level card, which asks for `setup.missing`. */
export function mountLevelCard(doc, menu, view, { initials = '', onFinishSetup, onSignIn } = {}) {
  const old = menu.querySelector(`#${CARD_ID}`);
  const noLevel = !!view && view.level === null;
  const card = noLevel
    ? renderNoLevelCard(doc, { initials, missing: view.setup && view.setup.missing, onFinishSetup, onSignIn })
    : renderLevelCard(doc, view);
  if (!card) { old?.remove(); return; }
  if (old) old.replaceWith(card);
  else menu.prepend(card);
}
