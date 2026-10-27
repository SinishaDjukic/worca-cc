// test/ui-ask-side.test.mjs — Ask worca beside the page (Task 6): the side column's controller on a minimal shell (a
// button, div.main-row with main.main and aside#ask-side): width and tier math, remembered show/hide, availability,
// the resize grip, re-layout on a tier crossing, reduced motion.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { pointer } from './helpers/ask-panel-harness.mjs';
import {
  createAskSide, clampWidth, sideTier, railForced,
  SIDE_MIN, SIDE_MAX, SIDE_DEFAULT, SIDE_MS, OPEN_KEY, WIDTH_KEY,
} from '../ui/public/ask-side.mjs';

const trackDom = useDomRelease(afterEach);

function shell({ stored = {}, reduce = false, innerWidth = 1440 } = {}) {
  const dom = trackDom(new JSDOM(`<!doctype html><body><button id="topnav-ask" aria-expanded="false"></button>
    <div class="main-row" id="main-row"><main class="main"></main><aside class="ask-side" id="ask-side" hidden><div class="ask-side-in" data-ask-side-host></div></aside></div></body>`));
  const { window } = dom;
  const doc = window.document;
  Object.defineProperty(window, 'innerWidth', { value: innerWidth, configurable: true, writable: true });
  window.matchMedia = (q) => ({ matches: reduce && /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  const timers = [];
  window.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  window.clearTimeout = (n) => { if (timers[n - 1]) timers[n - 1].fn = null; };
  const runTimers = () => { for (const t of timers.splice(0)) if (t.fn) t.fn(); };
  const map = new Map(Object.entries(stored));
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  const calls = [];
  const aside = doc.getElementById('ask-side');
  const button = doc.getElementById('topnav-ask');
  const make = (o = {}) => createAskSide({
    doc, win: window, storage, aside, button,
    onShow: (x) => calls.push(['show', x]), onHide: () => calls.push(['hide']), onLayout: () => calls.push(['layout']),
    ...o,
  });
  return { window, doc, aside, button, storage, map, calls, timers, runTimers, make };
}

test('clampWidth, sideTier and railForced', () => {
  assert.deepEqual([SIDE_MIN, SIDE_MAX, SIDE_DEFAULT, SIDE_MS], [360, 560, 440, 320]);
  assert.equal(clampWidth('x'), 440);
  assert.equal(clampWidth(null), 440, 'nothing stored: the default');
  assert.equal(clampWidth(''), 440);
  assert.equal(clampWidth(100), 360);
  assert.equal(clampWidth(900), 560);
  assert.equal(clampWidth(451.6), 452);
  assert.equal(clampWidth('500'), 500);
  assert.deepEqual([1440, 1081, 1080, 761, 760, 390].map(sideTier), ['push', 'push', 'over', 'over', 'full', 'full']);
  assert.equal(railForced({ innerWidth: 1440, sideW: 440, shown: true }), false);      // a 776px page
  assert.equal(railForced({ innerWidth: 1280, sideW: 440, shown: true }), true);       // 616 < 640
  assert.equal(railForced({ innerWidth: 1304, sideW: 440, shown: true }), false);      // exactly 640
  assert.equal(railForced({ innerWidth: 1440, sideW: 440, termW: 460, shown: true }), true);
  assert.equal(railForced({ innerWidth: 1000, sideW: 440, shown: true }), false, 'over tier: the page is not narrowed');
  assert.equal(railForced({ innerWidth: 1280, sideW: 440, shown: false }), false);
});

test('show and hide are remembered; availability hides without forgetting', () => {
  const s = shell();
  const side = s.make();
  assert.equal(s.aside.querySelectorAll('.ask-side-grip').length, 1, 'the grip is built inside the column');
  side.setAvailable(true);
  assert.equal(side.shown(), false, 'hidden by default');
  s.button.click();                                                 // the header button toggles
  assert.equal(side.shown(), true);
  assert.equal(s.map.get(OPEN_KEY), '1');
  assert.equal(s.button.getAttribute('aria-expanded'), 'true');
  assert.equal(s.aside.hidden, false);
  assert.ok(s.doc.body.classList.contains('ask-side-open'));
  assert.equal(s.doc.body.style.getPropertyValue('--ask-side-w'), '440px');
  assert.deepEqual(s.calls.filter((c) => c[0] === 'show'), [['show', { focus: true, button: true }]], 'the button focuses the composer');
  side.setAvailable(false);
  assert.equal(side.shown(), false);
  assert.equal(s.aside.hidden, true, 'at once: Chat takes the chat');
  assert.equal(s.map.get(OPEN_KEY), '1', 'the choice is kept');
  assert.equal(s.calls.filter((c) => c[0] === 'hide').length, 1);
  side.setAvailable(true);
  assert.equal(side.shown(), true, 'the next page shows it again');
  assert.deepEqual(s.calls.filter((c) => c[0] === 'show').at(-1), ['show', { focus: false, button: false }], 'a route leaves the focus on the page');
  side.hide();
  assert.equal(s.map.get(OPEN_KEY), '0');
  assert.equal(s.aside.hidden, false, 'leaving: the slide out runs first');
  assert.ok(s.aside.classList.contains('is-leaving'));
  s.runTimers();
  assert.equal(s.aside.hidden, true);
  assert.equal(s.doc.body.classList.contains('ask-side-open'), false);
  const again = s.make();
  again.setAvailable(true);
  assert.equal(again.shown(), false, 'a hidden choice survives a reload');
  side.destroy();
  again.destroy();
});

test('the grip resizes within 360-560, live and stored on release; arrows step 20px and store', () => {
  const s = shell({ stored: { [WIDTH_KEY]: '9999' } });
  const side = s.make();
  assert.equal(side.width(), 560, 'a stored width is clamped');
  side.setAvailable(true);
  side.show();
  s.aside.getBoundingClientRect = () => ({ right: 1440, left: 880, top: 0, bottom: 900, width: 560, height: 900 });
  const grip = s.aside.querySelector('.ask-side-grip');
  assert.deepEqual(['role', 'aria-orientation', 'aria-label', 'aria-valuemin', 'aria-valuemax'].map((a) => grip.getAttribute(a)),
    ['separator', 'vertical', 'Resize the chat', '360', '560']);
  assert.equal(grip.tabIndex, 0);
  grip.dispatchEvent(pointer(s.window, 'pointerdown', { clientX: 880 }));
  assert.ok(s.aside.classList.contains('is-resizing'));
  grip.dispatchEvent(pointer(s.window, 'pointermove', { clientX: 940 }));
  assert.equal(s.doc.body.style.getPropertyValue('--ask-side-w'), '500px', 'live');
  assert.equal(s.map.get(WIDTH_KEY), '9999', 'not stored while dragging');
  s.doc.dispatchEvent(pointer(s.window, 'pointermove', { clientX: 100 }));
  assert.equal(side.width(), 560, 'clamped, and the drag follows outside the grip');
  s.doc.dispatchEvent(pointer(s.window, 'pointerup', {}));
  assert.equal(s.map.get(WIDTH_KEY), '560');
  assert.equal(s.aside.classList.contains('is-resizing'), false);
  assert.equal(grip.getAttribute('aria-valuenow'), '560');
  const before = s.calls.filter((c) => c[0] === 'layout').length;
  grip.dispatchEvent(new s.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(side.width(), 540);
  assert.equal(s.map.get(WIDTH_KEY), '540');
  grip.dispatchEvent(new s.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  assert.equal(side.width(), 560);
  assert.ok(s.calls.filter((c) => c[0] === 'layout').length >= before + 2, 'every width change re-lays out');
  side.destroy();
});

test('tier crossing re-lays out without closing', () => {
  const s = shell({ innerWidth: 1440 });
  const side = s.make();
  side.setAvailable(true);
  side.show();
  const layouts = () => s.calls.filter((c) => c[0] === 'layout').length;
  const n = layouts();
  for (const w of [1000, 700, 1280]) {
    s.window.innerWidth = w;
    s.window.dispatchEvent(new s.window.Event('resize'));
  }
  assert.equal(layouts(), n + 3);
  assert.equal(side.shown(), true);
  assert.equal(s.aside.hidden, false);
  assert.equal(side.forcesRail(), true, '1280: a 616px page folds the menu');
  s.window.innerWidth = 1000;
  assert.equal(side.forcesRail(), false, 'over the main column: no fold');
  side.destroy();
});

test('the terminal pane counts toward the rail', () => {
  const s = shell({ innerWidth: 1440 });
  let term = 0;
  const side = s.make({ getTermW: () => term });
  side.setAvailable(true);
  side.show();
  assert.equal(side.forcesRail(), false);
  term = 460;
  assert.equal(side.forcesRail(), true);
  side.destroy();
});

test('hiding from inside the column gives the focus to the header button', () => {
  const s = shell();
  const side = s.make();
  side.setAvailable(true);
  side.show();
  const inside = s.doc.createElement('button');
  s.aside.querySelector('[data-ask-side-host]').appendChild(inside);
  inside.focus();
  side.hide();
  assert.equal(s.doc.activeElement, s.button);
  side.show();
  s.doc.body.focus();
  const other = s.doc.createElement('input');
  s.doc.querySelector('main').appendChild(other);
  other.focus();
  side.hide();
  assert.equal(s.doc.activeElement, other, 'focus elsewhere stays where it is');
  side.destroy();
});

test('reduced motion: no entering or leaving classes, the column goes at once', () => {
  const s = shell({ reduce: true });
  const side = s.make();
  side.setAvailable(true);
  side.show();
  assert.equal(s.aside.classList.contains('is-entering'), false);
  side.hide();
  assert.equal(s.aside.classList.contains('is-leaving'), false);
  assert.equal(s.aside.hidden, true);
  assert.equal(s.timers.length, 0);
  side.destroy();
});

test('motion: entering for 320ms, then the class goes', () => {
  const s = shell();
  const side = s.make();
  side.setAvailable(true);
  side.show();
  assert.ok(s.aside.classList.contains('is-entering'));
  assert.equal(s.timers.at(-1).ms, 320);
  s.runTimers();
  assert.equal(s.aside.classList.contains('is-entering'), false);
  side.destroy();
});

const arrow = (s, k, init = {}) => new s.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
const DRAG_RECT = () => ({ right: 1440, left: 1000, top: 0, bottom: 900, width: 440, height: 900 });

test('a hide still sliding out when the route takes the column away goes at once', () => {
  const s = shell();
  const side = s.make();
  side.setAvailable(true);
  side.show();
  s.runTimers();
  side.hide();
  assert.ok(s.aside.classList.contains('is-leaving'), 'sliding out');
  side.setAvailable(false);                                         // Chat or Workflows within the 320ms
  assert.equal(s.aside.hidden, true, 'gone at once, beside the next page');
  assert.equal(s.doc.body.classList.contains('ask-side-open'), false);
  assert.equal(s.aside.classList.contains('is-leaving'), false);
  side.destroy();
});

test('the grip: a release the document never saw (over an iframe) ends the drag on the next move; the pointer is captured', () => {
  const s = shell();
  const side = s.make();
  side.setAvailable(true);
  side.show();
  s.aside.getBoundingClientRect = DRAG_RECT;
  const grip = s.aside.querySelector('.ask-side-grip');
  const captured = [];
  grip.setPointerCapture = (id) => captured.push(id);
  grip.dispatchEvent(pointer(s.window, 'pointerdown', { clientX: 1000 }));
  assert.deepEqual(captured, [1], 'the grip captures the pointer, so its release comes back here');
  s.doc.dispatchEvent(pointer(s.window, 'pointermove', { clientX: 960 }));
  assert.equal(side.width(), 480);
  s.doc.dispatchEvent(pointer(s.window, 'pointermove', { clientX: 900, buttons: 0 }));
  assert.equal(s.aside.classList.contains('is-resizing'), false, 'no button held: the drag is over');
  assert.equal(side.width(), 480, 'and the column does not follow a hovering mouse');
  assert.equal(s.map.get(WIDTH_KEY), '480', 'the width it had is stored');
  s.doc.dispatchEvent(pointer(s.window, 'pointermove', { clientX: 1200 }));
  assert.equal(side.width(), 480);
  side.destroy();
});

test('the grip keys: only the two bare arrows resize and are swallowed; Tab and Alt+Left keep their jobs', () => {
  const s = shell();
  const side = s.make();
  side.setAvailable(true);
  side.show();
  const grip = s.aside.querySelector('.ask-side-grip');
  for (const ev of [arrow(s, 'Tab'), arrow(s, 'ArrowLeft', { altKey: true }), arrow(s, 'ArrowRight', { metaKey: true })]) {
    grip.dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, false, `${ev.key} with a modifier or Tab is not the grip's`);
  }
  assert.equal(side.width(), 440);
  assert.equal(s.map.get(WIDTH_KEY), undefined, 'and stores nothing');
  const left = arrow(s, 'ArrowLeft');
  grip.dispatchEvent(left);
  assert.equal(left.defaultPrevented, true, 'an arrow must not also scroll the page');
  assert.equal(side.width(), 460);
  assert.equal(grip.getAttribute('aria-valuenow'), '460', 'aria-valuenow follows');
  side.destroy();
});

test('a storage that throws (private mode) reads as nothing and never breaks show or hide', () => {
  const s = shell();
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const side = s.make({ storage: denied });
  assert.equal(side.width(), 440, 'a failing read is no stored width');
  assert.equal(side.wanted(), false);
  side.setAvailable(true);
  assert.doesNotThrow(() => side.show(), 'a failing write is only a lost nicety');
  assert.equal(side.shown(), true);
  assert.doesNotThrow(() => side.hide());
  side.destroy();
});

test('showing a shown column does nothing; a quick hide then show keeps the column that came back', () => {
  const s = shell();
  const side = s.make();
  side.setAvailable(true);
  side.show();
  s.runTimers();
  const shows = () => s.calls.filter((c) => c[0] === 'show').length;
  const n = shows();
  side.show({ focus: true });
  assert.equal(shows(), n, 'no second onShow');
  assert.equal(s.aside.classList.contains('is-entering'), false, 'the slide does not replay');
  side.hide();
  assert.equal(s.button.getAttribute('aria-expanded'), 'false', 'collapsed at once');
  side.show();                                                      // a double click inside the 320ms
  s.runTimers();                                                    // the leave timer would fire here
  assert.equal(side.shown(), true);
  assert.equal(s.aside.hidden, false);
  assert.ok(s.doc.body.classList.contains('ask-side-open'));
  assert.equal(s.aside.classList.contains('is-leaving'), false);
  side.destroy();
});

test('show() where the column is unavailable remembers the choice but reveals nothing', () => {
  const s = shell();
  const side = s.make();
  side.setAvailable(false);
  side.show();
  assert.equal(side.shown(), false);
  assert.equal(s.aside.hidden, true);
  assert.equal(s.map.get(OPEN_KEY), '1');
  side.setAvailable(true);
  assert.equal(side.shown(), true, 'the next page that has the column shows it');
  side.destroy();
});

test('the grip: only the primary button drags, pointerdown is default-prevented, a cancelled pointer ends the drag', () => {
  const s = shell();
  const side = s.make();
  side.setAvailable(true);
  side.show();
  s.aside.getBoundingClientRect = DRAG_RECT;
  const grip = s.aside.querySelector('.ask-side-grip');
  grip.dispatchEvent(pointer(s.window, 'pointerdown', { button: 2, clientX: 1000 }));
  assert.equal(s.aside.classList.contains('is-resizing'), false, 'a right-click is no drag');
  const down = pointer(s.window, 'pointerdown', { clientX: 1000 });
  grip.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true, 'no text selection or focus change while dragging');
  assert.ok(s.aside.classList.contains('is-resizing'));
  s.doc.dispatchEvent(pointer(s.window, 'pointercancel', {}));
  assert.equal(s.aside.classList.contains('is-resizing'), false, 'a cancelled pointer (touch) ends the drag');
  s.doc.dispatchEvent(pointer(s.window, 'pointermove', { clientX: 900 }));
  assert.equal(side.width(), 440, 'and the grip no longer follows the pointer');
  side.destroy();
});

test('a finished drag leaves no pointer listener behind on the document', () => {
  const s = shell();
  const live = new Map();
  const add = s.doc.addEventListener.bind(s.doc);
  const rem = s.doc.removeEventListener.bind(s.doc);
  s.doc.addEventListener = (t, fn, o) => { (live.get(t) || live.set(t, new Set()).get(t)).add(fn); return add(t, fn, o); };
  s.doc.removeEventListener = (t, fn, o) => { live.get(t)?.delete(fn); return rem(t, fn, o); };
  const side = s.make();
  side.setAvailable(true);
  side.show();
  s.aside.getBoundingClientRect = DRAG_RECT;
  const grip = s.aside.querySelector('.ask-side-grip');
  grip.dispatchEvent(pointer(s.window, 'pointerdown', { clientX: 1000 }));
  for (const t of ['pointermove', 'pointerup', 'pointercancel']) assert.equal(live.get(t)?.size, 1, `${t} is listened while dragging`);
  s.doc.dispatchEvent(pointer(s.window, 'pointerup', {}));
  for (const t of ['pointermove', 'pointerup', 'pointercancel']) assert.equal(live.get(t)?.size, 0, `${t} is released with the drag`);
  side.destroy();
});

test('destroy tears the controller down: the button, the resize listener, the grip, a drag in flight and any late show', () => {
  const s = shell();
  const side = s.make();
  side.setAvailable(true);
  side.show();
  s.aside.getBoundingClientRect = DRAG_RECT;
  s.aside.querySelector('.ask-side-grip').dispatchEvent(pointer(s.window, 'pointerdown', { clientX: 1000 }));
  assert.ok(s.aside.classList.contains('is-resizing'));
  side.destroy();
  assert.equal(s.aside.classList.contains('is-resizing'), false, 'a drag in flight ends with the controller');
  assert.equal(s.aside.querySelector('.ask-side-grip'), null, 'the grip goes');
  const layouts = () => s.calls.filter((c) => c[0] === 'layout').length;
  const n = layouts();
  s.window.dispatchEvent(new s.window.Event('resize'));
  assert.equal(layouts(), n, 'no re-layout after destroy');
  s.button.click();
  assert.equal(s.calls.filter((c) => c[0] === 'hide').length, 0, 'a click after destroy toggles nothing');
  const never = shell().make();
  never.setAvailable(true);
  never.destroy();
  never.show();
  assert.equal(never.shown(), false, 'a column never shown is not revealed after destroy');
});

test('onShow learns who showed the column: a route, an entry point, or the header button', () => {
  const s = shell({ stored: { [OPEN_KEY]: '1' } });
  const side = s.make();
  side.setAvailable(true);                                          // a route
  side.hide();
  s.runTimers();
  side.show({ focus: true });                                       // an entry point (openChat)
  side.hide();
  s.runTimers();
  s.button.click();                                                 // the person's toggle
  assert.deepEqual(s.calls.filter((c) => c[0] === 'show').map((c) => c[1]), [{ focus: false, button: false }, { focus: true, button: false }, { focus: true, button: true }]);
});

test('uncover: where the column covers the page it steps aside for a page the chat opened, until the person shows it again', () => {
  const s = shell({ innerWidth: 1000 });
  const side = s.make();
  side.setAvailable(true);
  side.show();
  assert.equal(side.shown(), true);
  side.uncover();
  s.runTimers();
  assert.equal(side.shown(), false);
  assert.equal(s.aside.hidden, true);
  assert.equal(s.map.get(OPEN_KEY), '1', 'the choice is kept');
  side.setAvailable(true);                                          // the route to the page the chat opened
  assert.equal(side.shown(), false, 'the page shows: the column stays aside');
  s.button.click();
  assert.equal(side.shown(), true, 'the button brings it back');
  side.uncover();
  side.setAvailable(false);                                         // Chat or Workflows
  side.setAvailable(true);
  assert.equal(side.shown(), true, 'a page without the column ends it: the next page shows it again (L8)');
  side.uncover();
  s.runTimers();
  side.show({ focus: true });
  assert.equal(side.shown(), true, 'an entry point (openChat) shows it too');
  s.window.innerWidth = 1440;
  side.uncover();
  assert.equal(side.shown(), true, 'pushing: the page is beside it already');
});

test('uncover from inside the column gives the focus to the header button, as Hide chat does; from the page it moves nothing', () => {
  const s = shell({ innerWidth: 1000 });
  const side = s.make();
  side.setAvailable(true);
  side.show();
  const link = s.doc.createElement('a');
  link.href = '#runs';
  s.aside.querySelector('[data-ask-side-host]').appendChild(link);
  link.focus();
  side.uncover();                                                   // a run card or a link in an answer, opened by keyboard
  s.runTimers();
  assert.equal(s.aside.hidden, true);
  assert.equal(s.doc.activeElement, s.button, 'never <body>: the focus goes where Hide chat sends it');
  const other = s.doc.querySelector('main.main');
  other.tabIndex = -1;
  s.button.click();
  other.focus();
  side.uncover();
  assert.equal(s.doc.activeElement, other, 'a focus outside the column stays where it is');
});

test('uncover after the opener took the focus with it (a menu row its own close removed) gives it to the header button too', () => {
  const s = shell({ innerWidth: 1000 });
  const side = s.make();
  side.setAvailable(true);
  side.show();
  const row = s.doc.createElement('button');
  s.aside.querySelector('[data-ask-side-host]').appendChild(row);
  row.focus();
  row.remove();                                                     // a topic row: its menu closes before it routes
  assert.equal(s.doc.activeElement, s.doc.body, 'precondition: the focus fell to <body>');
  side.uncover();
  s.runTimers();
  assert.equal(s.aside.hidden, true);
  assert.equal(s.doc.activeElement, s.button, 'never <body>');
});
