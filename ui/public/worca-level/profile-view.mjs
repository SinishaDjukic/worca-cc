// ui/public/worca-level/profile-view.mjs — the Profile "level" view: hero, next-level card, the
// "to reach" list and the grid of all four levels. Pure DOM in, pure DOM out: it paints an
// WorcaLevelView (no fetch) into the host. Display only — it never renders a form control (I-7).
import { isHashHref, setAvatarSrc, tooltipModel } from './model.mjs';

const HERO_SIZE = 104;
const LEVEL_COUNT = 4;
const SVG_NS = 'http://www.w3.org/2000/svg';
const GLYPH_DONE = 'M5 12.5l4.5 4.5L19 7.5';
const CHIP_TEXT = { reached: 'Reached', current: 'You are here', next: 'Next', later: 'Later' };

function make(doc, tag, cls, text) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function avatar(doc, src, alt, size) {
  const img = make(doc, 'img', 'ol-avatar');
  setAvatarSrc(img, src);
  img.setAttribute('alt', alt);
  img.setAttribute('width', String(size));
  img.setAttribute('height', String(size));
  return img;
}

function statusGlyph(doc, done) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `ol-glyph ${done ? 'done' : 'todo'}`);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (done) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', GLYPH_DONE);
    svg.appendChild(path);
  } else {
    const ring = doc.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('cx', '12');
    ring.setAttribute('cy', '12');
    ring.setAttribute('r', '8');
    svg.appendChild(ring);
  }
  return svg;
}

function formatDate(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function heroNode(doc, view) {
  const hero = make(doc, 'div', 'ol-hero');
  hero.appendChild(avatar(doc, view.level.avatar, view.level.name, HERO_SIZE));
  const text = make(doc, 'div', 'ol-hero-text');
  text.appendChild(make(doc, 'h2', null, view.level.name));
  text.appendChild(make(doc, 'p', 'ol-hero-line', `Level ${view.level.index} of ${LEVEL_COUNT}`));
  hero.appendChild(text);
  return hero;
}

function progressNode(doc, progress) {
  const wrap = make(doc, 'div', 'ol-progress');
  const bar = make(doc, 'div', 'ol-bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Progress to the next level');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(progress.total));
  bar.setAttribute('aria-valuenow', String(progress.done));
  const fill = make(doc, 'div', 'ol-bar-fill');
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  wrap.appendChild(bar);
  wrap.appendChild(make(doc, 'p', 'ol-progress-line', `${progress.done} of ${progress.total} done`));
  return wrap;
}

function nextCard(doc, view) {
  const card = make(doc, 'section', 'card ol-next');
  card.appendChild(make(doc, 'h3', null, 'Next level'));
  if (view.progress) card.appendChild(progressNode(doc, view.progress));
  return card;
}

function reachItem(doc, action) {
  const li = make(doc, 'li', 'ol-item');
  li.dataset.done = String(action.done === true);
  li.appendChild(statusGlyph(doc, action.done === true));
  const body = make(doc, 'div', 'ol-item-body');
  body.appendChild(make(doc, 'span', 'ol-item-label', action.label));
  if (action.done === true) {
    const date = formatDate(action.doneAt);
    body.appendChild(make(doc, 'span', 'ol-item-status', date ? `Done · ${date}` : 'Done'));
  } else {
    if (isHashHref(action.href)) {
      const link = make(doc, 'a', 'ol-item-status', 'Not done, open it');
      link.setAttribute('href', action.href);
      body.appendChild(link);
    } else {
      body.appendChild(make(doc, 'span', 'ol-item-status', 'Not done'));
    }
  }
  if (action.hint) body.appendChild(make(doc, 'span', 'ol-item-hint', action.hint));
  li.appendChild(body);
  return li;
}

function reachCard(doc, view) {
  const nextLevel = view.ladder.find((l) => l.index === view.level.index + 1);
  const card = make(doc, 'section', 'card ol-reach');
  card.appendChild(make(doc, 'h3', null, `To reach ${nextLevel ? nextLevel.name : 'the next level'}`));
  const list = make(doc, 'ul', 'ol-list');
  for (const action of view.next) list.appendChild(reachItem(doc, action));
  card.appendChild(list);
  return card;
}

function topCard(doc, view) {
  const card = make(doc, 'section', 'card ol-top');
  card.appendChild(make(doc, 'p', null, tooltipModel(view).topLine));
  return card;
}

function levelState(entry, current) {
  if (entry.index === current) return 'current';
  if (entry.reached) return 'reached';
  return entry.index === current + 1 ? 'next' : 'later';
}

function levelCard(doc, entry, current) {
  const state = levelState(entry, current);
  const card = make(doc, 'div', 'ol-level-card');
  card.dataset.state = state;
  card.appendChild(avatar(doc, entry.avatar, '', 56));
  card.appendChild(make(doc, 'span', 'ol-level-name', entry.name));
  card.appendChild(make(doc, 'span', 'ol-chip', CHIP_TEXT[state]));
  return card;
}

function levelsGrid(doc, view) {
  const section = make(doc, 'section', 'card ol-levels');
  section.appendChild(make(doc, 'h3', null, 'All levels'));
  const grid = make(doc, 'div', 'ol-grid');
  for (const entry of view.ladder) grid.appendChild(levelCard(doc, entry, view.level.index));
  section.appendChild(grid);
  return section;
}

/** Paint the level view into `host`, replacing whatever it held. */
export function renderProfileLevel(host, view) {
  const doc = host.ownerDocument;
  const parts = [heroNode(doc, view)];
  if (view.top === true) {
    parts.push(topCard(doc, view));
  } else {
    parts.push(nextCard(doc, view), reachCard(doc, view));
  }
  parts.push(levelsGrid(doc, view));
  host.replaceChildren(...parts);
}
