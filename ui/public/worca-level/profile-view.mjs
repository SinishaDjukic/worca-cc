// ui/public/worca-level/profile-view.mjs — the Profile "level" section: intro, hero with the next-level
// panel, the "to reach" list and the grid of all levels. Pure DOM in, pure DOM out: it paints a
// WorcaLevelView (no fetch) into the host. Display only — it never renders a form control (I-2, I-7).
// Styling lives in worca-level.css.
import { isHashHref, setAvatarSrc } from './model.mjs';
import { renderSegments } from './segments.mjs';
import { WORCA_LEVELS, WORCA_LEVEL_COUNT, WORCA_THRESHOLDS } from '../../../src/shared/worca-levels.mjs';

const HERO_SIZE = 104;
const CARD_SIZE = 52;
const CHIP_TEXT = { reached: 'Reached', current: 'You are here', next: 'Next', later: 'Later' };
const COUNT_UNIT = Object.freeze({
  teamMetrics: ` of ${WORCA_THRESHOLDS.teamMetricsRuns} runs in Team metrics`,
  councilStreak: ` of ${WORCA_THRESHOLDS.councilDays} days`,
});
const INTRO =
  'Your level shows how much you know about orchestrating agents in Worca. Worca keeps track as you work. Only you can see it.';
const TOP_TEXT = "You've reached the top level. There is no next level to work toward.";

function make(doc, tag, cls, text) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function avatar(doc, src, alt, size) {
  const img = make(doc, 'img', 'wl-avatar');
  setAvatarSrc(img, src);
  img.setAttribute('alt', alt);
  img.setAttribute('width', String(size));
  img.setAttribute('height', String(size));
  return img;
}

/** "Oct 14", with the year when it is not the current year; null for a missing or unreadable date. */
function formatDate(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

function nextLevelOf(view) {
  if (view.nextLevel && view.nextLevel.name) return view.nextLevel;
  return view.ladder.find((l) => l.index === view.level.index + 1) || null;
}

const descriptionOf = (index) => WORCA_LEVELS.find((l) => l.index === index)?.description ?? '';

function nextPanel(doc, view) {
  const panel = make(doc, 'div', 'wl-next');
  panel.appendChild(make(doc, 'span', 'wl-next-kicker', 'Next level'));
  const row = make(doc, 'div', 'wl-next-row');
  const next = nextLevelOf(view);
  row.appendChild(make(doc, 'b', 'wl-next-name', next ? next.name : ''));
  if (view.progress) {
    const counter = make(doc, 'span', 'wl-next-count', String(view.progress.done));
    counter.appendChild(make(doc, 'span', 'wl-next-of', ` / ${view.progress.total}`));
    row.appendChild(counter);
  }
  panel.appendChild(row);
  if (view.progress) panel.appendChild(renderSegments(doc, view.progress, { size: 'lg' }));
  return panel;
}

function hero(doc, view) {
  const section = make(doc, 'section', 'wl-hero');
  const who = make(doc, 'div', 'wl-hero-who');
  who.appendChild(avatar(doc, view.level.avatar, view.level.name, HERO_SIZE));
  const text = make(doc, 'div', 'wl-hero-text');
  text.appendChild(make(doc, 'span', 'wl-hero-kicker', `Your level · ${view.level.index} of ${WORCA_LEVEL_COUNT}`));
  text.appendChild(make(doc, 'h1', 'wl-hero-name', view.level.name));
  text.appendChild(make(doc, 'span', 'wl-hero-desc', view.level.description || descriptionOf(view.level.index)));
  who.appendChild(text);
  section.appendChild(who);
  if (view.top !== true) section.appendChild(nextPanel(doc, view));
  return section;
}

function statusDot(doc, done) {
  const dot = make(doc, 'span', `wl-dot ${done ? 'is-done' : 'is-todo'}`);
  dot.setAttribute('role', 'img');
  dot.setAttribute('aria-label', done ? 'Done' : 'Not done yet');
  return dot;
}

function countText(action) {
  const unit = COUNT_UNIT[action.id];
  if (!unit || action.done === true || action.count == null) return null;
  return `${action.count}${unit}`;
}

function itemEnd(doc, action) {
  if (action.done === true) {
    const date = formatDate(action.doneAt);
    return make(doc, 'span', 'wl-done', date ? `Done · ${date}` : 'Done');
  }
  if (!isHashHref(action.href)) return null;
  const open = make(doc, 'a', 'btn wl-open', action.openLabel || 'Open');
  open.setAttribute('href', action.href);
  return open;
}

function reachItem(doc, action) {
  const li = make(doc, 'li', 'wl-item');
  li.dataset.done = String(action.done === true);
  li.appendChild(statusDot(doc, action.done === true));
  const body = make(doc, 'div', 'wl-item-body');
  body.appendChild(make(doc, 'span', 'wl-item-label', action.label));
  if (action.hint) body.appendChild(make(doc, 'span', 'wl-item-hint', action.hint));
  const count = countText(action);
  if (count) body.appendChild(make(doc, 'span', 'wl-item-count', count));
  li.appendChild(body);
  const end = itemEnd(doc, action);
  if (end) li.appendChild(end);
  return li;
}

function reach(doc, view) {
  const next = nextLevelOf(view);
  const section = make(doc, 'section', 'wl-reach');
  const head = make(doc, 'div', 'wl-reach-head');
  head.appendChild(make(doc, 'h2', null, `To reach ${next ? next.name : 'the next level'}`));
  head.appendChild(make(doc, 'span', 'wl-reach-note', 'Marked done when you do them in Worca'));
  section.appendChild(head);
  const list = make(doc, 'ul', 'wl-list');
  for (const action of view.next || []) list.appendChild(reachItem(doc, action));
  section.appendChild(list);
  return section;
}

function top(doc) {
  const section = make(doc, 'section', 'wl-top');
  section.appendChild(make(doc, 'p', null, TOP_TEXT));
  return section;
}

const LEVEL_STATES = new Set(['reached', 'current', 'next', 'later']);

/** The server sends each ladder entry's `state`; the index comparison covers an entry without one. */
function levelState(entry, current) {
  if (LEVEL_STATES.has(entry.state)) return entry.state;
  if (entry.index === current) return 'current';
  if (entry.index < current) return 'reached';
  return entry.index === current + 1 ? 'next' : 'later';
}

function levelCard(doc, entry, current) {
  const state = levelState(entry, current);
  const card = make(doc, 'div', 'wl-level');
  card.dataset.state = state;
  const head = make(doc, 'div', 'wl-level-head');
  head.appendChild(avatar(doc, entry.avatar, '', CARD_SIZE));
  head.appendChild(make(doc, 'span', 'wl-chip', CHIP_TEXT[state]));
  card.appendChild(head);
  card.appendChild(make(doc, 'b', 'wl-level-name', entry.name));
  card.appendChild(make(doc, 'span', 'wl-level-desc', entry.description || descriptionOf(entry.index)));
  return card;
}

function levelsGrid(doc, view) {
  const section = make(doc, 'section', 'wl-levels');
  section.appendChild(make(doc, 'h2', null, 'All levels'));
  const grid = make(doc, 'div', 'wl-grid');
  for (const entry of view.ladder) grid.appendChild(levelCard(doc, entry, view.level.index));
  section.appendChild(grid);
  return section;
}

/** Paint the level view into `host`, replacing whatever it held. */
export function renderProfileLevel(host, view) {
  const doc = host.ownerDocument;
  const isTop = view.top === true;
  host.replaceChildren(
    make(doc, 'p', 'wl-intro', INTRO),
    hero(doc, view),
    isTop ? top(doc) : reach(doc, view),
    levelsGrid(doc, view),
  );
}
