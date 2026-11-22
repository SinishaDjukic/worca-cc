// ui/public/worca-level/level-card.mjs — the level card at the top of the account menu (#acct-menu): a compact
// button, avatar + level name + "View level", then "To <Next>" with the progress and a small segment bar. A click
// or Enter goes straight to #profile/level through the menu's delegated data-nav handler, which also closes the
// menu; nothing opens on hover or focus, and there is no popover in between. At the top level a note replaces
// the progress. A person with no level yet gets the initials, what earns the first level and one action.
// Everything is painted as text.
import { setAvatarSrc, tooltipModel } from './model.mjs';
import { renderSegments } from './segments.mjs';

const AVATAR_PX = 22;
export const CARD_ID = 'acct-level-card';
const TOP_NOTE = "You've reached the top level.";
const NO_LEVEL_SETUP = 'Finish setup to earn your first level.';
const NO_LEVEL_PROVIDER = 'Sign in to a model provider to earn your first level.';

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** The card for a WorcaLevelView: a 22px avatar, the level name and "View level"; then "To <Next>" with the
 *  progress ("1 of 4", or "12 of 30 days"); then small segments. At the top level it says so instead, with no
 *  second row and no segments. The progress is in the button's accessible name, so the segments are aria-hidden.
 *  Opens #profile/level. No data-min-level: every interface mode reaches it. null until the view has a level. */
export function renderLevelCard(doc, view) {
  const level = view && view.level;
  if (!level || typeof level.name !== 'string' || !level.name) return null;
  const m = tooltipModel(view);
  const card = h(doc, 'button', 'wl-card');
  card.type = 'button';
  card.id = CARD_ID;
  card.setAttribute('role', 'menuitem');
  card.dataset.nav = 'profile';
  card.dataset.hash = 'profile/level';

  const head = h(doc, 'span', 'wl-card-head');
  const img = h(doc, 'img', 'wl-card-ava');
  setAvatarSrc(img, level.avatar);
  img.setAttribute('alt', '');
  img.setAttribute('width', String(AVATAR_PX));
  img.setAttribute('height', String(AVATAR_PX));
  head.append(img, h(doc, 'span', 'wl-card-name', m.name), h(doc, 'span', 'wl-card-go', 'View level'));
  card.appendChild(head);

  if (m.topLine || !m.nextName) {
    card.appendChild(h(doc, 'span', 'wl-card-top', TOP_NOTE));
    card.setAttribute('aria-label', `${m.name}, you've reached the top level. View level`);
    return card;
  }
  const row = h(doc, 'span', 'wl-card-row');
  row.appendChild(h(doc, 'span', 'wl-card-next', `To ${m.nextName}`));
  if (m.segments) {
    const count = view.progress && view.progress.unit === 'days' ? m.progressText : `${m.segments.done} of ${m.segments.total}`;
    row.appendChild(h(doc, 'b', 'wl-card-prog', count));
  }
  card.appendChild(row);
  if (m.segments) {
    const seg = renderSegments(doc, m.segments, { size: 'sm' });
    seg.setAttribute('aria-hidden', 'true');
    card.appendChild(seg);
  }
  const progress = m.progressText ? `, ${m.progressText}` : '';
  card.setAttribute('aria-label', `${m.name}, to ${m.nextName}${progress}. View level`);
  return card;
}

function action(doc, text, onPress) {
  const b = h(doc, 'button', 'wl-menu-act', text);
  b.type = 'button';
  b.setAttribute('role', 'menuitem');
  b.addEventListener('click', () => { if (typeof onPress === 'function') onPress(); });
  return b;
}

/** The card for a person with no level yet: a small initials row with what earns the first level, and one
 *  action. `missing` is the setup's list ('setup' / 'provider'); only the provider missing asks for a sign-in,
 *  anything else asks to finish setup. */
export function renderNoLevelCard(doc, { initials = '', missing = [], onFinishSetup, onSignIn } = {}) {
  const providerOnly = Array.isArray(missing) && missing.length === 1 && missing[0] === 'provider';
  const card = h(doc, 'div', 'wl-card wl-card-none');
  card.id = CARD_ID;
  card.setAttribute('role', 'none');
  const head = h(doc, 'span', 'wl-card-head');
  head.append(h(doc, 'span', 'wl-menu-ava', initials), h(doc, 'span', 'wl-card-top', providerOnly ? NO_LEVEL_PROVIDER : NO_LEVEL_SETUP));
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
