// test/ui-worca-level-profile-view.test.mjs — the Profile level view (ui/public/worca-level/profile-view.mjs
// + ui/public/profile/profile.html), driven in jsdom with fixture WorcaLevelViews. Pure DOM, no fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderProfileLevel } from '../ui/public/worca-level/profile-view.mjs';

const NAMES = ['Calf', 'Swimmer', 'Hunter', 'Pod Leader'];
const KEYS = ['calf', 'swimmer', 'hunter', 'pod-leader'];

const action = (id, done) => ({
  id, label: `Label ${id}`, hint: `Hint ${id}`, href: `#/${id}`, done, doneAt: done ? '2026-03-04T10:00:00.000Z' : null,
});

const view = (index, over = {}) => ({
  level: { index, key: KEYS[index - 1], name: NAMES[index - 1], description: 'd', avatar: `/assets/worca-levels/${KEYS[index - 1]}.svg` },
  progress: { done: 1, total: 3 },
  next: [action('a', true), action('b', false), action('c', false)],
  top: false,
  ladder: NAMES.map((name, i) => ({ index: i + 1, key: KEYS[i], name, avatar: `/assets/worca-levels/${KEYS[i]}.svg`, reached: i + 1 <= index })),
  welcome: null,
  celebration: null,
  ...over,
});

const mount = (v, html = '') => {
  const { window } = new JSDOM(`<!doctype html><body><div id="host">${html}</div></body>`, { url: 'http://localhost/' });
  const host = window.document.getElementById('host');
  renderProfileLevel(host, v);
  return host;
};
const cards = (host) => [...host.querySelectorAll('.ol-level-card')];

test('level 1: hero, next card with progress, to-reach list with done date and not-done links', () => {
  const host = mount(view(1));
  const img = host.querySelector('.ol-hero img');
  assert.equal(img.getAttribute('src'), '/assets/worca-levels/calf.svg');
  assert.equal(img.getAttribute('width'), '104');
  assert.equal(img.getAttribute('height'), '104');
  assert.equal(host.querySelector('.ol-hero h2').textContent, 'Calf');
  assert.match(host.querySelector('.ol-hero').textContent, /Level 1 of 4/);

  const bar = host.querySelector('.ol-next [role="progressbar"]');
  assert.equal(bar.getAttribute('aria-valuenow'), '1');
  assert.equal(bar.getAttribute('aria-valuemax'), '3');
  assert.match(host.querySelector('.ol-next').textContent, /1 of 3 done/);

  assert.match(host.querySelector('.ol-reach h3').textContent, /To reach Swimmer/);
  const items = [...host.querySelectorAll('.ol-reach li')];
  assert.equal(items.length, 3);
  assert.equal(items[0].dataset.done, 'true');
  assert.match(items[0].textContent, /Label a/);
  assert.match(items[0].textContent, /Done · /);
  assert.equal(items[0].querySelector('a'), null);
  assert.equal(items[1].dataset.done, 'false');
  const link = items[1].querySelector('a');
  assert.equal(link.getAttribute('href'), '#/b');
  assert.match(link.textContent, /not done/i);
  assert.ok(items.every((li) => li.querySelector('svg')), 'every item carries an SVG status glyph');
});

test('level 3: the grid has 4 cards marked Reached / You are here / Next / Later', () => {
  const host = mount(view(3));
  const grid = cards(host);
  assert.equal(grid.length, 4);
  assert.deepEqual(grid.map((c) => c.dataset.state), ['reached', 'reached', 'current', 'next']);
  assert.deepEqual(
    grid.map((c) => c.querySelector('.ol-chip').textContent),
    ['Reached', 'Reached', 'You are here', 'Next'],
  );
  assert.deepEqual(grid.map((c) => c.querySelector('img').getAttribute('src')), KEYS.map((k) => `/assets/worca-levels/${k}.svg`));
  assert.match(grid[3].textContent, /Pod Leader/);
});

test('level 1 grid: current, next, later, later', () => {
  const grid = cards(mount(view(1)));
  assert.deepEqual(grid.map((c) => c.dataset.state), ['current', 'next', 'later', 'later']);
  assert.deepEqual(grid.map((c) => c.querySelector('.ol-chip').textContent), ['You are here', 'Next', 'Later', 'Later']);
});

test('level 4 (top): the top message replaces the next card and the to-reach list', () => {
  const host = mount(view(4, { top: true, progress: null, next: [] }));
  assert.match(host.querySelector('.ol-top').textContent, /top level/i);
  assert.equal(host.querySelector('.ol-next'), null);
  assert.equal(host.querySelector('.ol-reach'), null);
  assert.equal(host.querySelector('[role="progressbar"]'), null);
  assert.deepEqual(cards(host).map((c) => c.dataset.state), ['reached', 'reached', 'reached', 'current']);
});

test('a done action with no usable date still reads Done', () => {
  const v = view(1, { next: [{ ...action('a', true), doneAt: 'not a date' }] });
  const li = mount(v).querySelector('.ol-reach li');
  assert.match(li.textContent, /Done/);
  assert.doesNotMatch(li.textContent, /Invalid/);
});

test('rendering again replaces the content (no duplicates)', () => {
  const { window } = new JSDOM('<!doctype html><body><div id="host"></div></body>');
  const host = window.document.getElementById('host');
  renderProfileLevel(host, view(1));
  renderProfileLevel(host, view(2));
  assert.equal(host.querySelectorAll('.ol-hero').length, 1);
  assert.equal(cards(host).length, 4);
  assert.equal(host.querySelector('.ol-hero h2').textContent, 'Swimmer');
});

test('fills the profile.html skeleton in place and I-7: no inputs anywhere', () => {
  const html = readFileSync(new URL('../ui/public/profile/profile.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<(input|select|textarea)\b/i);
  assert.doesNotMatch(html, /type=["']?(checkbox|file)/i);
  const { window } = new JSDOM(`<!doctype html><body>${html}</body>`);
  const host = window.document.querySelector('#profile-level-host');
  assert.ok(host, 'skeleton has the level host');
  renderProfileLevel(host, view(2));
  assert.equal(host.querySelectorAll('.ol-hero').length, 1);
  assert.equal(cards(host).length, 4);
  assert.equal(window.document.querySelectorAll('[data-view="profile"]').length, 1);
  assert.equal(window.document.querySelector('input, select, textarea, [type="checkbox"], [type="file"]'), null);
});

test('rendered output never contains form controls (I-7)', () => {
  for (const v of [view(1), view(3), view(4, { top: true, progress: null, next: [] })]) {
    assert.equal(mount(v).querySelector('input, select, textarea, button[role="checkbox"]'), null);
  }
});

test('an action whose href is not a hash route is not rendered as a link, and a view with no avatar sets no src', () => {
  const v = view(1, { next: [{ ...action('a', false), href: 'javascript:alert(1)' }, action('b', false)] });
  v.level.avatar = undefined;
  const host = mount(v);
  assert.equal(host.querySelectorAll('a[href^="javascript"]').length, 0);
  assert.equal(host.querySelectorAll('.ol-reach a').length, 1);
  assert.equal(host.querySelector('.ol-hero img').hasAttribute('src'), false);
});
