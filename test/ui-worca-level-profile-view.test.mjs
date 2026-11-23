// test/ui-worca-level-profile-view.test.mjs — the Profile level section (ui/public/worca-level/profile-view.mjs
// + ui/public/profile/profile.html + the Profile page title), driven in jsdom with fixture WorcaLevelViews.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderProfileLevel } from '../ui/public/worca-level/profile-view.mjs';
import { pageTitle } from '../ui/public/topnav.mjs';
import { createWorcaLevelWiring } from '../ui/public/worca-level/app-wiring.mjs';

const NAMES = ['Curious', 'Runner', 'Hooked', 'WorcaHolic', "Worca's Council"];
const KEYS = ['curious', 'runner', 'hooked', 'worcaholic', 'council'];

const action = (id, done, over = {}) => ({
  id, label: `Label ${id}`, hint: `Hint ${id}`, href: `#/${id}`, openLabel: `Open ${id}`,
  done, doneAt: done ? '2020-03-04T12:00:00.000Z' : null, ...over,
});

const view = (index, over = {}) => ({
  level: { index, key: KEYS[index - 1], name: NAMES[index - 1], description: `desc ${index}`, avatar: `/assets/worca-levels/${KEYS[index - 1]}.svg` },
  progress: { done: 1, total: 3, unit: 'items' },
  next: [action('a', true), action('b', false), action('c', false)],
  nextLevel: index < 5 ? { index: index + 1, key: KEYS[index], name: NAMES[index] } : null,
  top: false,
  ladder: NAMES.map((name, i) => ({ index: i + 1, key: KEYS[i], name, avatar: `/assets/worca-levels/${KEYS[i]}.svg`, state: i + 1 < index ? 'reached' : i + 1 === index ? 'current' : i + 1 === index + 1 ? 'next' : 'later' })),
  welcome: null,
  celebration: null,
  ...over,
});
const topView = () => view(5, { top: true, progress: null, next: null, nextLevel: null });

const mount = (v) => {
  const { window } = new JSDOM('<!doctype html><body><div id="host"></div></body>', { url: 'http://localhost/' });
  const host = window.document.getElementById('host');
  renderProfileLevel(host, v);
  return host;
};
const levels = (host) => [...host.querySelectorAll('.wl-level')];

test('intro and hero: 104px avatar, "Your level · X of 5", h1 name, description, next panel with large segments', () => {
  const host = mount(view(2));
  assert.match(host.querySelector('p.wl-intro').textContent, /Only you can see it\./);
  const hero = host.querySelector('section.wl-hero');
  const img = hero.querySelector('img');
  assert.equal(img.getAttribute('src'), '/assets/worca-levels/runner.svg');
  assert.equal(img.getAttribute('width'), '104');
  assert.match(hero.textContent, /Your level · 2 of 5/);
  assert.equal(hero.querySelector('h1').textContent, 'Runner');
  assert.match(hero.textContent, /desc 2/);
  assert.match(hero.textContent, /Next level/);
  assert.match(hero.textContent, /Hooked/);
  assert.match(hero.textContent, /1\s*\/\s*3/);
  const seg = hero.querySelector('.wl-seg');
  assert.equal(seg.getAttribute('data-size'), 'lg');
  assert.equal(seg.getAttribute('aria-valuenow'), '1');
  assert.equal(seg.getAttribute('aria-valuemax'), '3');
});

test('reach list done/open (R-po-16): done shows "Done · date", open shows an Open link', () => {
  const host = mount(view(2));
  const reach = host.querySelector('section.wl-reach');
  assert.equal(reach.querySelector('h2').textContent, 'To reach Hooked');
  assert.match(reach.textContent, /Marked done when you do them in Worca/);
  const items = [...reach.querySelectorAll('li.wl-item')];
  assert.equal(items.length, 3);
  assert.equal(items[0].dataset.done, 'true');
  const done = items[0].querySelector('span.wl-done');
  assert.match(done.textContent, /^Done · Mar 4, 2020$/);
  assert.equal(items[0].querySelector('a.wl-open'), null);
  assert.match(items[0].textContent, /Label a/);
  assert.match(items[0].textContent, /Hint a/);
  assert.equal(items[1].dataset.done, 'false');
  const open = items[1].querySelector('a.btn.wl-open');
  assert.equal(open.getAttribute('href'), '#/b');
  assert.equal(open.textContent, 'Open b');
  assert.equal(items[1].querySelector('span.wl-done'), null);
});

test('a done date in the current year omits the year', () => {
  const at = new Date();
  at.setUTCMonth(at.getUTCMonth(), 15);
  at.setUTCHours(12, 0, 0, 0);
  const v = view(2, { next: [action('a', true, { doneAt: at.toISOString() })] });
  const text = mount(v).querySelector('span.wl-done').textContent;
  assert.doesNotMatch(text, /\d{4}/);
  assert.match(text, /^Done · /);
});

test('a done action with no usable date still reads Done', () => {
  const v = view(2, { next: [action('a', true, { doneAt: 'not a date' })] });
  const text = mount(v).querySelector('span.wl-done').textContent;
  assert.match(text, /Done/);
  assert.doesNotMatch(text, /Invalid/);
});

test('all levels states (R-po-17): five cards with Reached / You are here / Next / Later chips', () => {
  const host = mount(view(3));
  const section = host.querySelector('section.wl-levels');
  assert.equal(section.querySelector('h2').textContent, 'All levels');
  const cards = levels(host);
  assert.equal(cards.length, 5);
  assert.deepEqual(cards.map((c) => c.dataset.state), ['reached', 'reached', 'current', 'next', 'later']);
  assert.deepEqual(
    cards.map((c) => c.querySelector('.wl-chip').textContent),
    ['Reached', 'Reached', 'You are here', 'Next', 'Later'],
  );
  assert.ok(cards.every((c) => c.querySelector('img').getAttribute('width') === '52'));
  assert.deepEqual(cards.map((c) => c.querySelector('img').getAttribute('src')), KEYS.map((k) => `/assets/worca-levels/${k}.svg`));
  assert.match(cards[4].textContent, /Worca's Council/);
  assert.ok(cards.every((c) => c.textContent.length > c.querySelector('.wl-chip').textContent.length + 10), 'each card has a description');
});

test('I-2: glyphs are role=img, there are no inputs and no click handlers on them', () => {
  const host = mount(view(2));
  assert.equal(host.querySelector('input, select, textarea, [type="checkbox"]'), null);
  const dots = [...host.querySelectorAll('.wl-dot')];
  assert.equal(dots.length, 3);
  assert.deepEqual(dots.map((d) => d.getAttribute('role')), ['img', 'img', 'img']);
  assert.deepEqual(dots.map((d) => d.getAttribute('aria-label')), ['Done', 'Not done yet', 'Not done yet']);
  assert.ok(dots.every((d) => d.onclick == null && !d.hasAttribute('onclick') && d.tagName.toLowerCase() === 'span'));
});

test('the Team metrics Open href and label pass through from the view (R-po-35)', () => {
  const v = view(4, { next: [action('teamMetrics', false, { href: '#team-policy', openLabel: 'Open Team policy' })] });
  const open = mount(v).querySelector('li.wl-item a.wl-open');
  assert.equal(open.getAttribute('href'), '#team-policy');
  assert.equal(open.textContent, 'Open Team policy');
});

test('counts read "x of n" with the item unit, only while not done', () => {
  const runs = (done) => action('realRuns', done, { count: 1, of: 3, unit: ['real run', 'real runs'] });
  const days = (done) => action('councilDays', done, { count: 12, of: 20, unit: ['active day', 'active days'] });
  assert.match(mount(view(4, { next: [runs(false)] })).querySelector('li.wl-item').textContent, /1 of 3 real runs/);
  assert.match(mount(view(4, { next: [days(false)] })).querySelector('li.wl-item').textContent, /12 of 20 active days/);
  assert.doesNotMatch(mount(view(4, { next: [runs(true)] })).querySelector('li.wl-item').textContent, /1 of 3/);
  assert.doesNotMatch(mount(view(4, { next: [days(true)] })).querySelector('li.wl-item').textContent, /of 20/);
  assert.doesNotMatch(mount(view(4, { next: [action('x', false)] })).querySelector('li.wl-item').textContent, / of \d+ /);
});

test('at the top level: section.wl-top replaces the reach section and the next panel', () => {
  const host = mount(topView());
  assert.ok(host.querySelector('section.wl-top'));
  assert.match(host.querySelector('section.wl-top').textContent, /top level/i);
  assert.equal(host.querySelector('section.wl-reach'), null);
  assert.equal(host.querySelector('.wl-seg'), null);
  assert.doesNotMatch(host.querySelector('section.wl-hero').textContent, /Next level/);
  assert.match(host.querySelector('section.wl-hero').textContent, /5 of 5/);
  assert.deepEqual(levels(host).map((c) => c.dataset.state), ['reached', 'reached', 'reached', 'reached', 'current']);
});

test('not at the top: no section.wl-top', () => {
  assert.equal(mount(view(1)).querySelector('section.wl-top'), null);
});

test('rendering again replaces the content (no duplicates)', () => {
  const { window } = new JSDOM('<!doctype html><body><div id="host"></div></body>');
  const host = window.document.getElementById('host');
  renderProfileLevel(host, view(1));
  renderProfileLevel(host, view(2));
  assert.equal(host.querySelectorAll('section.wl-hero').length, 1);
  assert.equal(levels(host).length, 5);
  assert.equal(host.querySelector('h1').textContent, 'Runner');
});

test('an action whose href is not a hash route is not a link; a view with no avatar sets no src', () => {
  const v = view(2, { next: [action('a', false, { href: 'javascript:alert(1)' }), action('b', false)] });
  v.level.avatar = undefined;
  const host = mount(v);
  assert.equal(host.querySelectorAll('a[href^="javascript"]').length, 0);
  assert.equal(host.querySelectorAll('.wl-reach a.wl-open').length, 1);
  assert.equal(host.querySelector('.wl-hero img').hasAttribute('src'), false);
});

test('profile.html keeps the feature-map marker, the host, and has no form controls; the page title is Profile (D-15)', () => {
  const html = readFileSync(new URL('../ui/public/profile/profile.html', import.meta.url), 'utf8');
  assert.match(html, /<!-- ===== VIEW: PROFILE \(worca level\) ===== -->/);
  assert.doesNotMatch(html, /<(input|select|textarea)\b/i);
  const { window } = new JSDOM(`<!doctype html><body>${html}</body>`);
  const host = window.document.querySelector('#profile-level-host');
  assert.ok(host);
  renderProfileLevel(host, view(2));
  assert.equal(host.querySelectorAll('section.wl-hero').length, 1);
  assert.equal(window.document.querySelectorAll('[data-view="profile"]').length, 1);
  assert.equal(pageTitle('profile'), 'Profile');
});

const withLadder = (v, fn) => ({ ...v, ladder: v.ladder.map((l) => ({ ...l, ...fn(l) })) });

test('every level card says reached with its date, or not reached', () => {
  const v = withLadder(view(3), (l) => ({
    reachedAt: l.index <= 3 ? `2020-0${l.index}-04T12:00:00.000Z` : null,
    items: [],
  }));
  const cards = levels(mount(v));
  const lines = cards.map((c) => c.querySelectorAll('.wl-level-desc')[1].textContent);
  assert.deepEqual(lines, ['Reached · Jan 4, 2020', 'Reached · Feb 4, 2020', 'Reached · Mar 4, 2020', 'Not reached yet', 'Not reached yet']);
});

test('a reached level with no usable date reads Reached; a missing field reads by state', () => {
  const v = withLadder(view(2), (l) => (l.index === 1 ? { reachedAt: 'junk', items: [] } : { items: [] }));
  const lines = levels(mount(v)).map((c) => c.querySelectorAll('.wl-level-desc')[1].textContent);
  assert.deepEqual(lines, ['Reached', 'Reached', 'Not reached yet', 'Not reached yet', 'Not reached yet']);
});

test('every item shows its counter', () => {
  const items = [
    action('realRuns', false, { count: 1, of: 3, unit: ['real run', 'real runs'] }),
    action('councilDays', false, { count: 12, of: 20, unit: ['active day', 'active days'] }),
    action('plain', false),
    action('finished', true),
  ];
  const v = withLadder(view(3), (l) => (l.index === 4 ? { items, reachedAt: null } : { items: [], reachedAt: null }));
  const card = levels(mount(v))[3];
  const rows = [...card.querySelectorAll('ul.wl-list > li')];
  assert.equal(rows.length, 4);
  assert.match(rows[0].textContent, /Label realRuns.*1 of 3 real runs/);
  assert.match(rows[1].textContent, /12 of 20 active days/);
  assert.match(rows[2].textContent, /Label plain/);
  assert.equal(rows[2].dataset.done, 'false');
  assert.match(rows[3].textContent, /Done · Mar 4, 2020/);
  assert.equal(rows[3].dataset.done, 'true');
});

test('the Profile repaints on load() while it is open, and stops once the page has moved on', async () => {
  const { window } = new JSDOM('<!doctype html><body><div id="host"></div><div id="menu"></div></body>', { url: 'http://localhost/' });
  const doc = window.document;
  const host = doc.getElementById('host');
  let served = view(2);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => served });
  try {
    let open = true;
    const wiring = createWorcaLevelWiring({
      menu: doc.getElementById('menu'), repaint: () => {}, isSettled: () => false, setupOpen: () => false, doc,
    });
    await wiring.showProfile(host, () => open);
    assert.equal(host.querySelector('h1').textContent, 'Runner');
    served = view(3);
    await wiring.boot();                       // load() while the Profile is open
    assert.equal(host.querySelector('h1').textContent, 'Hooked');
    open = false;
    served = view(4);
    await wiring.boot();
    assert.equal(host.querySelector('h1').textContent, 'Hooked', 'a closed Profile is left alone');
    assert.equal(wiring.state.profile, null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a person with no level yet gets a no-level hero, the next-level list and a ladder with nothing reached (M5)', () => {
  const { window } = new JSDOM('<!doctype html><body><div id="host"></div></body>', { url: 'http://localhost/' });
  const host = window.document.getElementById('host');
  const none = view(1, {
    level: null,
    setup: { finished: true, providerSignedIn: false, missing: ['provider'] },
    progress: { done: 1, total: 2, unit: 'items' },
    nextLevel: { index: 1, key: 'curious', name: 'Curious' },
    ladder: NAMES.map((name, i) => ({ index: i + 1, key: KEYS[i], name, state: i === 0 ? 'next' : 'later', reachedAt: null })),
  });
  renderProfileLevel(host, none, { initials: 'AL' });
  const hero = host.querySelector('section.wl-hero');
  assert.equal(hero.querySelector('img'), null, 'no avatar image');
  assert.equal(hero.querySelector('.wl-menu-ava').textContent, 'AL');
  assert.match(hero.textContent, /Sign in to a model provider to earn your first level\./);
  assert.match(host.textContent, /To reach Curious/);
  assert.equal(levels(host).length, 5);
  assert.deepEqual(levels(host).map((l) => l.dataset.state), ['next', 'later', 'later', 'later', 'later']);
  assert.ok(levels(host).every((l) => /Not reached yet/.test(l.textContent)));
  renderProfileLevel(host, { ...none, setup: { finished: false, providerSignedIn: false, missing: ['setup', 'provider'] } });
  assert.match(host.querySelector('section.wl-hero').textContent, /Finish setup to earn your first level\./);
});
