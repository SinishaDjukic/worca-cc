// test/ui-worca-level-hover-card.test.mjs — the account hover card: opens 250ms after the pointer
// enters #side-acct (and on focus), closes on leave, blur, Escape and when the account menu opens,
// holds no form control (I-7), shows name, "x of y" and an action (R-po 2), and never cancels the
// click that opens the menu. Fake timers drive the delay; jsdom holds the markup.
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { wireHoverCard } from '../ui/public/worca-level/hover-card.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

const trackDom = useDomRelease(afterEach);
afterEach(() => mock.timers.reset());

const action = (id, done) => ({ id, label: `Label ${id}`, hint: `Hint ${id}`, href: `#/${id}`, done, doneAt: done ? 't' : null });
const view = (over = {}) => ({
  level: { index: 2, key: 'runner', name: 'Runner', tagline: 'Running real work', description: 'd', avatar: '/assets/worca-levels/runner.svg' },
  nextLevel: { index: 3, key: 'hooked', name: 'Hooked' },
  progress: { done: 1, total: 4 },
  next: [action('a', true), action('b', false), action('c', false), action('d', false)],
  top: false,
  ladder: [],
  welcome: null,
  celebration: null,
  ...over,
});

function setup({ getView = () => view() } = {}) {
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout'] });
  const dom = trackDom(new JSDOM(
    '<body><div class="side-foot"><button id="side-acct" aria-expanded="false" aria-label="Profile"><span class="acct-ava">P</span></button></div></body>',
    { url: 'http://localhost:4317/', pretendToBeVisual: true },
  ));
  const { window } = dom;
  const doc = window.document;
  const btn = doc.getElementById('side-acct');
  const handle = wireHoverCard(btn, { getView });
  const card = () => doc.querySelector('.worca-hover-card');
  const fire = (el, type, init = {}) => el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  const key = (k) => doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
  return { window, doc, btn, handle, card, fire, key, flush };
}

test('opens on mouseenter after 250ms and not before; the card is a non-modal popover', async () => {
  const { btn, card, fire, flush } = setup();
  fire(btn, 'mouseenter');
  mock.timers.tick(249);
  await flush();
  assert.equal(card(), null, 'not before 250ms');
  mock.timers.tick(1);
  await flush();
  assert.ok(card(), 'open at 250ms');
  assert.equal(card().getAttribute('aria-modal'), null, 'no modal');
  assert.equal(card().previousElementSibling, btn, 'follows the button in tab order');
  assert.equal(card().querySelector('.worca-hover-backdrop'), null, 'no backdrop');
});

test('a mouse that leaves before 250ms opens nothing', async () => {
  const { btn, card, fire, flush } = setup();
  fire(btn, 'mouseenter');
  mock.timers.tick(100);
  fire(btn, 'mouseleave');
  mock.timers.tick(1000);
  await flush();
  assert.equal(card(), null);
});

test('runner tooltip: 40px avatar, name, "Level 2 of 5 · tagline", Next: Hooked with 4 segments, 2 Try next links, Profile link', async () => {
  const { btn, card, fire, flush } = setup();
  fire(btn, 'mouseenter');
  mock.timers.tick(250);
  await flush();
  const c = card();
  const img = c.querySelector('img');
  assert.deepEqual([img.getAttribute('src'), img.getAttribute('width'), img.getAttribute('height')], ['/assets/worca-levels/runner.svg', '40', '40']);
  assert.equal(c.querySelector('.wl-hc-name').textContent, 'Runner');
  assert.equal(c.querySelector('.wl-hc-level').textContent, 'Level 2 of 5 · Running real work');
  assert.match(c.querySelector('.wl-hc-next').textContent, /^Next: Hooked/);
  assert.equal(c.querySelector('.wl-hc-next strong').textContent, 'Hooked');
  assert.match(c.textContent, /1 of 4 done/);
  const seg = c.querySelector('.wl-seg');
  assert.deepEqual([seg.getAttribute('aria-valuenow'), seg.getAttribute('aria-valuemax'), seg.getAttribute('data-size')], ['1', '4', 'sm']);
  assert.equal(seg.querySelectorAll('.wl-seg-i').length, 4);
  assert.equal(seg.querySelectorAll('.wl-seg-i[data-done="true"]').length, 1);
  assert.equal(c.querySelector('.wl-hc-k').textContent, 'Try next');
  const tries = [...c.querySelectorAll('a.wl-try')];
  assert.deepEqual(tries.map((a) => a.getAttribute('href')), ['#/b', '#/c'], 'two not-done actions, each linking to its href');
  assert.deepEqual([...tries[0].children].map((n) => n.textContent), ['Label b', '→', 'Hint b'], 'title, arrow, hint');
  const profile = c.querySelector('a.wl-profile-link');
  assert.deepEqual([profile.textContent, profile.getAttribute('href')], ['See your level in Profile', '#profile/level']);
});

test('top tooltip has no segments: p.wl-top replaces Next, the segments and Try next', async () => {
  const top = setup({ getView: () => view({ top: true, nextLevel: null, level: { index: 5, key: 'council', name: 'Council', tagline: 'Leading the pod', description: 'd', avatar: '/p.svg' }, progress: { done: 9, total: 9 } }) });
  top.fire(top.btn, 'mouseenter');
  mock.timers.tick(250);
  await top.flush();
  const c = top.card();
  assert.match(c.querySelector('p.wl-top').textContent, /top level/);
  assert.equal(c.querySelector('.wl-seg'), null);
  assert.equal(c.querySelector('.wl-hc-next'), null);
  assert.equal(c.querySelector('a.wl-try'), null);
  assert.equal(c.querySelector('.wl-hc-name').textContent, 'Council');
  assert.equal(c.querySelector('.wl-hc-level').textContent, 'Level 5 of 5 · Leading the pod');
  assert.ok(c.querySelector('a.wl-profile-link'));
});

test('Try next shows at most 2 not-done actions and only hash links; level 1 says "Your first steps"', async () => {
  const rows = [
    { name: 'a non-hash href is not a link', next: [{ ...action('x', false), href: 'https://example.com' }, action('y', false)], index: 2, links: ['#/y'], heading: 'Try next' },
    { name: 'done actions are skipped, three open ones show two', next: [action('a', true), action('b', false), action('c', false), action('d', false)], index: 2, links: ['#/b', '#/c'], heading: 'Try next' },
    { name: 'level 1 heading', next: [action('a', false)], index: 1, links: ['#/a'], heading: 'Your first steps' },
  ];
  for (const r of rows) {
    const s = setup({ getView: () => view({ next: r.next, level: { index: r.index, key: 'curious', name: 'Curious', tagline: 't', description: 'd', avatar: '/c.svg' } }) });
    s.fire(s.btn, 'mouseenter');
    mock.timers.tick(250);
    await s.flush();
    assert.deepEqual([...s.card().querySelectorAll('a.wl-try')].map((a) => a.getAttribute('href')), r.links, r.name);
    assert.equal(s.card().querySelector('.wl-hc-k').textContent, r.heading, r.name);
  }
});

test('I-7: the card holds no input, select, textarea, checkbox or file picker', async () => {
  const { btn, card, fire, flush } = setup();
  fire(btn, 'mouseenter');
  mock.timers.tick(250);
  await flush();
  assert.equal(card().querySelector('input, select, textarea, [type="checkbox"], [type="file"], [role="checkbox"]'), null);
});

test('closes on mouse leave (a short grace lets the pointer cross into the card), blur, Escape and when the account menu opens', async () => {
  const s = setup();
  const open = async () => {
    s.fire(s.btn, 'mouseenter');
    mock.timers.tick(250);
    await s.flush();
    assert.ok(s.card(), 'opened');
  };
  await checkRows([
    { name: 'mouse leave closes after the grace', run: async () => {
      await open();
      s.fire(s.btn, 'mouseleave');
      mock.timers.tick(300);
      assert.equal(s.card(), null);
    } },
    { name: 'entering the card during the grace keeps it; leaving the card closes it', run: async () => {
      await open();
      s.fire(s.btn, 'mouseleave');
      s.fire(s.card(), 'mouseenter');
      mock.timers.tick(300);
      assert.ok(s.card(), 'kept while the pointer is on the card');
      s.fire(s.card(), 'mouseleave');
      mock.timers.tick(300);
      assert.equal(s.card(), null);
    } },
    { name: 'blur closes it', run: async () => {
      await open();
      s.btn.dispatchEvent(new s.window.FocusEvent('blur'));
      assert.equal(s.card(), null);
    } },
    { name: 'Escape closes it', run: async () => {
      await open();
      s.key('Escape');
      assert.equal(s.card(), null);
    } },
    { name: 'aria-expanded turning true (the account menu opened) closes it', run: async () => {
      await open();
      s.btn.setAttribute('aria-expanded', 'true');
      await s.flush();
      assert.equal(s.card(), null);
      s.btn.setAttribute('aria-expanded', 'false');
    } },
    { name: 'while the menu is open, hovering opens nothing', run: async () => {
      s.btn.setAttribute('aria-expanded', 'true');
      s.fire(s.btn, 'mouseenter');
      mock.timers.tick(250);
      await s.flush();
      assert.equal(s.card(), null);
      s.btn.setAttribute('aria-expanded', 'false');
    } },
  ]);
});

test('focus opens the card at once', async () => {
  const { btn, card, window, flush } = setup();
  btn.dispatchEvent(new window.FocusEvent('focus'));
  await flush();
  assert.ok(card());
});

test('a click on the corner is not cancelled and closes the card', async () => {
  const { btn, card, fire, flush, window } = setup();
  fire(btn, 'mouseenter');
  mock.timers.tick(250);
  await flush();
  const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  btn.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false);
  assert.equal(card(), null);
});

test('a view that is unavailable or fails opens nothing', async () => {
  for (const getView of [() => null, () => Promise.reject(new Error('x'))]) {
    const { btn, card, fire, flush } = setup({ getView });
    fire(btn, 'mouseenter');
    mock.timers.tick(250);
    await flush();
    assert.equal(card(), null);
  }
});

test('destroy removes the card and the listeners', async () => {
  const { btn, card, handle, fire, flush } = setup();
  fire(btn, 'mouseenter');
  mock.timers.tick(250);
  await flush();
  handle.destroy();
  assert.equal(card(), null);
  fire(btn, 'mouseenter');
  mock.timers.tick(250);
  await flush();
  assert.equal(card(), null);
});
