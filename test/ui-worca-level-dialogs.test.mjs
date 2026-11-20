// test/ui-worca-level-dialogs.test.mjs — the three worca level dialogs (welcome-new, welcome-existing,
// celebration): their copy, the single onClose, the backdrop grace window, and the invariants that
// they hold no inputs, never call the server and never touch <html data-level>.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { renderWorcaDialog } from '../ui/public/worca-level/dialogs.mjs';
import { WORCA_LEVELS, WORCA_LEVEL_COUNT } from '../src/shared/worca-levels.mjs';

const trackDom = useDomRelease(afterEach);
const realFetch = globalThis.fetch;
const realNow = Date.now;
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

const action = (id, done) => ({ id, label: `Label ${id}`, hint: `Hint ${id}`, href: `#/${id}`, done, doneAt: done ? 't' : null });
const levelView = (index, over = {}) => {
  const l = WORCA_LEVELS[index - 1];
  return {
    level: { index, key: l.key, name: l.name, description: l.description, avatar: l.avatar },
    progress: { done: 1, total: 3 },
    next: [action('a', true), action('b', false), action('c', false), action('d', false)],
    top: index === WORCA_LEVEL_COUNT,
    ladder: [],
    welcome: null,
    celebration: null,
    ...over,
  };
};

function setup() {
  const dom = trackDom(new JSDOM('<!doctype html><html data-level="beginner"><body></body></html>', { url: 'http://localhost:4317/' }));
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { dom, doc: dom.window.document, calls };
}

const open = (kind, v, doc, onClose) => renderWorcaDialog(kind, v, { doc, onClose });
const text = (modal) => modal.textContent.replace(/\s+/g, ' ');
const closeButton = (modal) => modal.querySelector('button.worca-dlg-close');

test('every dialog is a guarded .viewer-modal with the avatar and the shared dialog anatomy', () => {
  for (const kind of ['welcome-new', 'welcome-existing', 'celebration']) {
    const { doc } = setup();
    const modal = open(kind, levelView(3), doc);
    assert.ok(modal.classList.contains('viewer-modal'), kind);
    assert.equal(modal.getAttribute('role'), 'dialog');
    assert.ok(doc.body.contains(modal), `${kind} is attached`);
    assert.equal(modal.querySelector('img').getAttribute('src'), '/assets/worca-levels/hooked.svg');
    assert.ok(modal.querySelector('.dlg-head') && modal.querySelector('.dlg-body') && modal.querySelector('.dlg-foot'));
    assert.equal(modal.querySelectorAll('input, select, textarea, [contenteditable]').length, 0, kind);
  }
});

test('welcome-new: headline, the five-level paragraph, two open Runner actions and a Got it button', () => {
  const { doc } = setup();
  const modal = open('welcome-new', levelView(1), doc);
  assert.match(text(modal), /Welcome to Worca/);
  assert.equal(modal.querySelector('h2').textContent, 'You start out Curious');
  assert.match(text(modal), /five levels[^.]*Curious, Runner, Hooked, WorcaHolic and Worca's Council/);
  assert.match(text(modal), /Your first steps toward Runner/);
  const links = [...modal.querySelectorAll('a[href]')];
  assert.deepEqual(links.map((a) => a.getAttribute('href')), ['#/b', '#/c'], 'done actions skipped, capped at two');
  assert.equal(closeButton(modal).textContent, 'Got it');
});

test('welcome-existing: phrase, recap, n-of-5 segments, next block with two links, privacy line', () => {
  const { doc } = setup();
  const modal = open('welcome-existing', levelView(2, { progress: { done: 0, total: 4 } }), doc);
  assert.match(text(modal), /New in Worca: levels/);
  assert.equal(modal.querySelector('h2').textContent, 'Your work so far makes you a Runner');
  assert.match(text(modal), /You already finished Getting started, wrote a requirement and ran a feature to the end\. That's level 2 of 5\./);
  const bar = modal.querySelector('.wl-seg');
  assert.equal(bar.getAttribute('data-size'), 'lg');
  assert.equal(bar.querySelectorAll('.wl-seg-i').length, WORCA_LEVEL_COUNT);
  assert.equal(bar.querySelectorAll('[data-done]').length, 2);
  assert.match(text(modal), /Next up: Hooked · 0 of 4 done/);
  assert.equal(modal.querySelectorAll('a[href]').length, 2);
  assert.match(text(modal), /Only you can see your level\./);
  assert.equal(closeButton(modal).textContent, 'Got it');
});

test('welcome-existing at the top level has no Next block', () => {
  const { doc } = setup();
  const modal = open('welcome-existing', levelView(5, { next: [] }), doc);
  assert.match(modal.querySelector('h2').textContent, /part of Worca's Council/);
  assert.doesNotMatch(text(modal), /Next up/);
  assert.equal(modal.querySelectorAll('a[href]').length, 0);
  assert.equal(modal.querySelectorAll('.wl-seg [data-done]').length, WORCA_LEVEL_COUNT);
  assert.match(text(modal), /Only you can see your level\./);
});

test('celebration: tinted art, level counter, headline, recap with hat, next line, two buttons', () => {
  const { doc } = setup();
  const modal = open('celebration', levelView(3), doc);
  const art = modal.querySelector('.worca-dlg-art');
  assert.equal(art.style.getPropertyValue('--wl-hue'), '295');
  assert.ok(art.querySelector('img'));
  assert.match(text(modal), /New level · 3 of 5/);
  assert.equal(modal.querySelector('h2').textContent, "You're Hooked");
  assert.match(text(modal), /You've added an add-on, set up a space and a schedule, and opened Statistics\. Your avatar now wears the flat cap\./);
  assert.match(text(modal), /Next: WorcaHolic · 4 actions/);
  const see = modal.querySelector('a.worca-dlg-see');
  assert.equal(see.getAttribute('href'), '#profile/level');
  assert.equal(see.textContent, 'See your level');
  assert.equal(closeButton(modal).textContent, 'Carry on');
});

test('celebration of WorcaHolic shows "30 days in a row" for the Council next', () => {
  const { doc } = setup();
  const modal = open('celebration', levelView(4), doc);
  assert.match(text(modal), /Next: Worca's Council · 30 days in a row/);
  assert.doesNotMatch(text(modal), /actions/);
});

test('celebration at the top level has no Next line', () => {
  const { doc } = setup();
  const modal = open('celebration', levelView(5, { next: [] }), doc);
  assert.equal(modal.querySelector('h2').textContent, "You're part of Worca's Council");
  assert.match(text(modal), /Your avatar now wears the graduation cap\./);
  assert.doesNotMatch(text(modal), /Next:/);
});

test('onClose runs once even if both buttons are clicked, and the dialog never calls the server', () => {
  const { doc, calls } = setup();
  let closed = 0;
  const modal = open('celebration', levelView(3), doc, () => { closed += 1; });
  modal.querySelector('a.worca-dlg-see').click();
  closeButton(modal).click();
  closeButton(modal).click();
  assert.equal(closed, 1);
  assert.ok(!doc.body.contains(modal));
  assert.equal(calls.length, 0);
});

test('Escape closes once', () => {
  const { dom, doc } = setup();
  let closed = 0;
  const modal = open('welcome-new', levelView(1), doc, () => { closed += 1; });
  for (let i = 0; i < 2; i += 1) modal.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(closed, 1);
  assert.ok(!doc.body.contains(modal));
});

test('a scrim click straight after opening is ignored; one after the grace window closes', () => {
  const { dom, doc } = setup();
  const start = realNow();
  Date.now = () => start;
  let closed = 0;
  const modal = open('celebration', levelView(3), doc, () => { closed += 1; });
  const scrim = () => {
    modal.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
    modal.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  };
  scrim();
  assert.equal(closed, 0);
  assert.ok(doc.body.contains(modal));
  Date.now = () => start + 600;
  scrim();
  assert.equal(closed, 1);
  assert.ok(!doc.body.contains(modal));
});

test('rendering and closing leave <html data-level> untouched', () => {
  for (const kind of ['welcome-new', 'welcome-existing', 'celebration']) {
    const { doc } = setup();
    const modal = open(kind, levelView(2), doc);
    closeButton(modal).click();
    assert.equal(doc.documentElement.getAttribute('data-level'), 'beginner', kind);
  }
});

test('an unknown kind throws', () => {
  const { doc } = setup();
  assert.throws(() => open('nope', levelView(1), doc), /unknown/i);
});
