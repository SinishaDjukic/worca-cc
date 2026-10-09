// test/side-flyout.test.mjs — the sidebar popup controller (ui/public/side-flyout.mjs): placement and
// clamping (rects stubbed: jsdom has no layout), the open/close rules (a click opens, never hover; a
// pointer close lets go of focus), Escape with refocus, outside clicks, scroll and resize, [data-nav] clicks, the arrow keys,
// aria-expanded, and the one stack that orders nested and competing popups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { placeFlyout, createFlyout } from '../ui/public/side-flyout.mjs';
import { checkRows } from './helpers/rows.mjs';

const PAGE = `<!doctype html><body>
  <aside class="sidebar" id="aside"><div id="scroll">
    <button type="button" id="trig" aria-expanded="false">Nodes</button>
    <div id="menu" role="menu" hidden>
      <div class="k">Nodes</div>
      <button type="button" role="menuitem" id="a" data-nav="agents">Agents</button>
      <button type="button" role="menuitem" id="b" data-nav="scripts">Scripts</button>
      <button type="button" role="menuitem" id="gone" hidden>Gone</button>
    </div>
    <button type="button" id="trig2" aria-expanded="false">Other</button>
    <div id="menu2" role="menu" hidden><button type="button" role="menuitem" id="m2a">One</button></div>
    <div id="sub" role="menu" hidden><button type="button" role="menuitemradio" id="s1">S1</button><button type="button" role="menuitemradio" id="s2" aria-checked="true">S2</button></div>
  </div></aside>
  <button type="button" id="out">Elsewhere</button>
  <div id="extra">Counts as inside</div></body>`;

/** `mouse`: `(hover: hover)` matches, as on a desktop — jsdom has no matchMedia of its own. */
function setup({ mouse = false, ...opts } = {}) {
  const { window } = new JSDOM(PAGE);
  const doc = window.document;
  if (mouse) window.matchMedia = (q) => ({ media: q, matches: true, addEventListener() {}, removeEventListener() {} });
  const $ = (id) => doc.getElementById(id);
  const calls = [];
  const fly = createFlyout({ doc, win: window, trigger: $('trig'), menu: $('menu'), closeOn: $('scroll'),
    onOpen: () => calls.push('open'), onClose: () => calls.push('close'), ...opts });
  const click = (el, detail = 1) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail }));
  const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  return { window, doc, $, fly, calls, click, key };
}

/** Stub a layout box: getBoundingClientRect plus offsetWidth/offsetHeight. */
function box(el, { left = 0, top = 0, width = 0, height = 0 }) {
  el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
  Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => height });
}
function viewport(window, w, h) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
}

test('placeFlyout: side / up / beside, each clamped to the viewport; un-hides the menu to measure it', async () => {
  await checkRows([
    { name: 'side: beside the sidebar\'s right edge + 6, 30px above the trigger row', run: () => {
      const { window, $ } = setup();
      viewport(window, 1280, 800);
      box($('aside'), { left: 0, top: 0, width: 220, height: 800 });
      box($('trig'), { left: 10, top: 300, width: 200, height: 29 });
      box($('menu'), { width: 172, height: 100 });
      placeFlyout($('menu'), $('trig'), { win: window });
      assert.equal($('menu').hidden, false);
      assert.deepEqual([$('menu').style.left, $('menu').style.top], ['226px', '270px']);
    } },
    { name: 'side: clamped 8px inside the right and bottom edges, and never above the top', run: () => {
      const { window, $ } = setup();
      viewport(window, 300, 400);
      box($('aside'), { left: 0, top: 0, width: 220, height: 400 });
      box($('menu'), { width: 172, height: 120 });
      box($('trig'), { left: 10, top: 380, width: 200, height: 29 });
      placeFlyout($('menu'), $('trig'), { win: window });
      assert.deepEqual([$('menu').style.left, $('menu').style.top], ['120px', '272px']);
      box($('trig'), { left: 10, top: 12, width: 200, height: 29 });
      placeFlyout($('menu'), $('trig'), { win: window });
      assert.equal($('menu').style.top, '8px');
    } },
    { name: 'side: no .sidebar around the trigger measures from the trigger itself', run: () => {
      const { window, $ } = setup();
      viewport(window, 1280, 800);
      box($('out'), { left: 400, top: 200, width: 60, height: 30 });
      box($('menu'), { width: 172, height: 100 });
      placeFlyout($('menu'), $('out'), { win: window });
      assert.deepEqual([$('menu').style.left, $('menu').style.top], ['466px', '170px']);
    } },
    { name: 'up: above the trigger by its own height + gap, left-aligned; clamped at the top', run: () => {
      const { window, $ } = setup();
      viewport(window, 1280, 800);
      box($('menu'), { width: 258, height: 300 });
      box($('trig'), { left: 10, top: 700, width: 200, height: 46 });
      placeFlyout($('menu'), $('trig'), { mode: 'up', win: window });
      assert.deepEqual([$('menu').style.left, $('menu').style.top], ['10px', '394px']);
      box($('trig'), { left: 10, top: 100, width: 200, height: 46 });
      placeFlyout($('menu'), $('trig'), { mode: 'up', win: window });
      assert.equal($('menu').style.top, '8px');
    } },
    { name: 'beside: right of the parent menu + 4, 5px above the item; flips left when there is no room', run: () => {
      const { window, $ } = setup();
      viewport(window, 1280, 800);
      box($('menu2'), { left: 10, top: 300, width: 258, height: 200 });
      box($('trig2'), { left: 15, top: 400, width: 248, height: 31 });
      box($('sub'), { width: 236, height: 150 });
      placeFlyout($('sub'), $('trig2'), { mode: 'beside', parent: $('menu2'), win: window });
      assert.deepEqual([$('sub').style.left, $('sub').style.top], ['272px', '395px']);
      viewport(window, 500, 800);
      box($('menu2'), { left: 200, top: 300, width: 258, height: 200 });
      placeFlyout($('sub'), $('trig2'), { mode: 'beside', parent: $('menu2'), win: window });
      assert.equal($('sub').style.left, '8px', '200 - 236 - 4 < 8: clamped');
    } },
  ]);
});

test('createFlyout: a click opens, a second closes; aria-expanded and the hooks follow', () => {
  const { $, fly, calls, click } = setup();
  assert.equal(fly.isOpen(), false);
  click($('trig'));
  assert.equal(fly.isOpen(), true);
  assert.equal($('menu').hidden, false);
  assert.equal($('trig').getAttribute('aria-expanded'), 'true');
  click($('trig'));
  assert.equal($('menu').hidden, true);
  assert.equal($('trig').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(calls, ['open', 'close']);
  fly.toggle();
  assert.equal(fly.isOpen(), true);
  fly.toggle();
  assert.equal(fly.isOpen(), false);
});

test('createFlyout: a keyboard open focuses the first visible item, or the checked one; a keyboard click closes again', () => {
  const { doc, $, click } = setup();
  click($('trig'), 0);
  assert.equal(doc.activeElement, $('a'));
  click($('trig'), 0);
  assert.equal($('menu').hidden, true);
  assert.equal(doc.activeElement, $('trig'), 'focus goes back to the trigger');
  const sub = setup();
  const fly2 = createFlyout({ doc: sub.doc, win: sub.window, trigger: sub.$('trig2'), menu: sub.$('sub') });
  fly2.open({ focus: true });
  assert.equal(sub.doc.activeElement, sub.$('s2'), 'the [aria-checked="true"] item');
});

test('createFlyout: a mouse passing over the trigger or the menu never opens or closes it; only a click does', () => {
  const { window, $, fly, click } = setup({ mouse: true });
  const over = (el, type) => el.dispatchEvent(new window.MouseEvent(type, { bubbles: type === 'mouseover' || type === 'mouseout' }));
  over($('trig'), 'mouseenter');
  over($('trig'), 'mouseover');
  assert.equal(fly.isOpen(), false, 'hover does not open it');
  click($('trig'));
  assert.equal(fly.isOpen(), true, 'a click does');
  over($('trig'), 'mouseleave');
  over($('menu'), 'mouseenter');
  over($('menu'), 'mouseleave');
  assert.equal(fly.isOpen(), true, 'the pointer leaving does not close it');
});

test('createFlyout: a pointer close lets go of focus; the keyboard\'s hands it back to the trigger', async () => {
  await checkRows([
    { name: 'a second click on the trigger closes it and leaves the trigger unfocused', run: () => {
      const { doc, $, fly, click } = setup();
      $('trig').focus();                                     // the mouse press focuses the button (Chrome)
      click($('trig'));
      assert.equal(fly.isOpen(), true);
      click($('trig'));
      assert.equal(fly.isOpen(), false);
      assert.equal($('trig').getAttribute('aria-expanded'), 'false');
      assert.equal(doc.activeElement, doc.body, 'not left on the trigger');
    } },
    { name: 'a click outside closes it; focus stays on neither the trigger nor a hidden item', run: () => {
      const { doc, $, fly, click } = setup();
      click($('trig'), 0);
      assert.equal(doc.activeElement, $('a'));
      click($('extra'));
      assert.equal(fly.isOpen(), false);
      assert.equal(doc.activeElement, doc.body);
    } },
    { name: 'a route picked with the pointer closes it without pulling focus to the trigger', run: () => {
      const { doc, $, fly, click } = setup();
      click($('trig'));
      $('b').focus();                                        // the press focuses the item
      click($('b'));
      assert.equal(fly.isOpen(), false);
      assert.equal(doc.activeElement, doc.body);
    } },
    { name: 'focus that is somewhere else is left alone', run: () => {
      const { doc, $, fly, click } = setup();
      click($('trig'));
      $('out').focus();
      click($('extra'));
      assert.equal(fly.isOpen(), false);
      assert.equal(doc.activeElement, $('out'));
    } },
    { name: 'a keyboard click on the open trigger closes it and refocuses the trigger', run: () => {
      const { doc, $, fly, click } = setup();
      click($('trig'), 0);
      click($('trig'), 0);
      assert.equal(fly.isOpen(), false);
      assert.equal(doc.activeElement, $('trig'));
    } },
    { name: 'a submenu: a second click on its row closes it and blurs the row, the menu stays; a click outside closes both', run: () => {
      const { window, doc, $, click } = setup();
      const menu = createFlyout({ doc, win: window, trigger: $('trig2'), menu: $('menu2') });
      const sub = createFlyout({ doc, win: window, trigger: $('m2a'), menu: $('sub'), mode: 'beside', parent: $('menu2') });
      click($('trig2'));
      $('m2a').focus();
      click($('m2a'));
      assert.equal(sub.isOpen(), true);
      click($('m2a'));
      assert.equal(sub.isOpen(), false);
      assert.equal(menu.isOpen(), true, 'the menu it hangs from stays');
      assert.equal(doc.activeElement, doc.body, 'the row is not left focused');
      click($('m2a'));
      $('s1').focus();
      click($('out'));
      assert.deepEqual([menu.isOpen(), sub.isOpen()], [false, false]);
      assert.equal(doc.activeElement, doc.body);
    } },
  ]);
});

test('createFlyout: Escape closes the open popup and refocuses its trigger; with nothing open it is not consumed', () => {
  const { doc, $, fly, click, key } = setup();
  click($('trig'), 0);
  assert.equal(doc.activeElement, $('a'));
  const consumed = !key($('a'), 'Escape');
  assert.equal(consumed, true, 'preventDefault: the phone drawer must not close too');
  assert.equal(fly.isOpen(), false);
  assert.equal(doc.activeElement, $('trig'));
  assert.equal(key(doc.body, 'Escape'), true, 'nothing open: Escape passes through untouched');
});

test('createFlyout: what closes it and what does not', async () => {
  await checkRows([
    { name: 'a click outside closes; the trigger, the menu body and inside() do not', run: () => {
      const { $, fly, click } = setup({ inside: (t) => t.id === 'extra' });
      fly.open();
      click($('extra'));
      assert.equal(fly.isOpen(), true, 'inside() counts as inside');
      click($('menu').querySelector('.k'));
      assert.equal(fly.isOpen(), true, 'a click on the menu that is not a route');
      click($('out'));
      assert.equal(fly.isOpen(), false);
    } },
    { name: 'a click on a [data-nav] item inside closes it', run: () => {
      const { $, fly, click } = setup();
      fly.open();
      click($('b'));
      assert.equal(fly.isOpen(), false);
    } },
    { name: 'a click whose target was re-rendered away (detached) cannot tell, so it stays', run: () => {
      const { doc, $, fly, click } = setup();
      fly.open();
      const ghost = doc.createElement('button');
      $('out').append(ghost);
      ghost.addEventListener('click', () => ghost.remove());
      click(ghost);
      assert.equal(fly.isOpen(), true);
    } },
    { name: 'the closeOn element scrolling closes it; so does a window resize', run: () => {
      const { window, $, fly } = setup();
      fly.open();
      $('scroll').dispatchEvent(new window.Event('scroll'));
      assert.equal(fly.isOpen(), false);
      fly.open();
      window.dispatchEvent(new window.Event('resize'));
      assert.equal(fly.isOpen(), false);
    } },
  ]);
});

test('createFlyout: ArrowDown / ArrowUp / Home / End move focus among the visible items and wrap', () => {
  const { doc, $, click, key } = setup();
  click($('trig'), 0);
  assert.equal(doc.activeElement, $('a'));
  key($('a'), 'ArrowDown');
  assert.equal(doc.activeElement, $('b'));
  key($('b'), 'ArrowDown');
  assert.equal(doc.activeElement, $('a'), 'wraps, skipping the hidden item');
  key($('a'), 'ArrowUp');
  assert.equal(doc.activeElement, $('b'));
  key($('b'), 'Home');
  assert.equal(doc.activeElement, $('a'));
  key($('a'), 'End');
  assert.equal(doc.activeElement, $('b'));
});

test('one stack per document: opening a popup closes the others but keeps its parent; Escape and close walk submenus first', () => {
  const { window, doc, $, fly, click, key } = setup();
  const other = createFlyout({ doc, win: window, trigger: $('trig2'), menu: $('menu2') });
  const sub = createFlyout({ doc, win: window, trigger: $('m2a'), menu: $('sub'), mode: 'beside', parent: $('menu2') });
  fly.open();
  other.open();
  assert.equal(fly.isOpen(), false, 'a second popup closes the first');
  sub.open();
  assert.equal(other.isOpen(), true, 'a submenu keeps the menu it hangs from');
  click($('s1'));
  assert.equal(other.isOpen(), true, 'a click inside the open submenu is inside the parent too');
  key(doc.body, 'Escape');
  assert.equal(sub.isOpen(), false, 'Escape closes the newest: the submenu');
  assert.equal(other.isOpen(), true);
  assert.equal(doc.activeElement, $('m2a'), 'and refocuses its trigger');
  key(doc.body, 'Escape');
  assert.equal(other.isOpen(), false);
  other.open();
  sub.open();
  assert.equal(sub.isOpen(), true);
  other.close();
  assert.equal(sub.isOpen(), false, 'closing a menu closes its submenus');
  assert.equal($('m2a').getAttribute('aria-expanded'), 'false');
});

test('createFlyout: closing with focus inside hands focus back to the trigger; focus elsewhere is left alone', () => {
  const { window, doc, $, fly, click } = setup();
  click($('trig'), 0);
  assert.equal(doc.activeElement, $('a'));
  click($('b'), 0);                                         // a route inside: the popup closes
  assert.equal(fly.isOpen(), false);
  assert.equal(doc.activeElement, $('trig'), 'not left on a hidden item (Chrome drops it to <body>)');
  fly.open();
  $('out').focus();
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(fly.isOpen(), false);
  assert.equal(doc.activeElement, $('out'), 'focus outside the popup stays where it is');
});

test('createFlyout: a consumed Escape reaches no later listener (a page would step back); with nothing open it passes through', () => {
  const { window, doc, $, fly, click, key } = setup();
  const seen = [];
  doc.addEventListener('keydown', (e) => seen.push(`doc-capture:${e.key}`), true);
  doc.addEventListener('keydown', (e) => seen.push(`doc:${e.key}`));
  window.addEventListener('keydown', (e) => seen.push(`win:${e.key}`));
  click($('trig'), 0);
  key($('a'), 'Escape');
  assert.equal(fly.isOpen(), false);
  assert.deepEqual(seen, [], 'only the popup acted on it');
  key(doc.body, 'Escape');
  assert.deepEqual(seen, ['doc-capture:Escape', 'doc:Escape', 'win:Escape'], 'nothing open: every listener sees it');
});

test('createFlyout: Escape with focus outside the popup closes it and leaves focus where it is', () => {
  const { doc, $, fly, key } = setup();
  fly.open();
  $('out').focus();
  key($('out'), 'Escape');
  assert.equal(fly.isOpen(), false);
  assert.equal(doc.activeElement, $('out'), 'not pulled to the trigger');
  $('trig').focus();
  fly.open();
  key($('trig'), 'Escape');
  assert.equal(fly.isOpen(), false);
  assert.equal(doc.activeElement, $('trig'));
});

test('createFlyout: a pointer click opens without moving focus; reposition() re-places an open popup and leaves a closed one hidden', () => {
  const { window, doc, $, fly, click } = setup();
  viewport(window, 1280, 800);
  box($('aside'), { left: 0, top: 0, width: 220, height: 800 });
  box($('menu'), { width: 172, height: 100 });
  box($('trig'), { left: 10, top: 300, width: 200, height: 29 });
  $('out').focus();
  click($('trig'));
  assert.equal(fly.isOpen(), true);
  assert.equal(doc.activeElement, $('out'), 'a pointer open leaves focus alone');
  assert.equal($('menu').style.top, '270px');
  box($('trig'), { left: 10, top: 400, width: 200, height: 29 });
  fly.reposition();
  assert.equal($('menu').style.top, '370px');
  fly.close();
  fly.reposition();
  assert.equal($('menu').hidden, true, 'a closed popup stays closed');
});


test('createFlyout: a key typed in the popup stays in the popup; Tab and shortcuts with a modifier still reach the page', () => {
  const { window, doc, $, click, key } = setup();
  const seen = [];
  doc.addEventListener('keydown', (e) => seen.push(e.key));
  window.addEventListener('keydown', (e) => seen.push(`win:${e.key}`));
  click($('trig'), 0);
  for (const k of ['ArrowDown', ' ', 'Delete', 'Backspace', 'Enter', 'x']) key(doc.activeElement, k);
  assert.equal(doc.activeElement, $('b'), 'the popup still moved focus');
  assert.deepEqual(seen, [], 'no page handler sees them (the Workflow Composer would move or delete its selected node)');
  for (const k of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Delete', 'Backspace', ' ', 'Enter']) {
    for (const mod of ['altKey', 'ctrlKey', 'metaKey']) {
      doc.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, [mod]: true, bubbles: true, cancelable: true }));
    }
  }
  assert.deepEqual(seen, [], 'nor with a modifier held (Alt+ArrowDown nudged the node, Cmd+Backspace deleted it)');
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    doc.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', [mod]: true, bubbles: true, cancelable: true }));
  }
  key(doc.activeElement, 'Tab');
  assert.deepEqual(seen, ['k', 'win:k', 'k', 'win:k', 'k', 'win:k', 'Tab', 'win:Tab']);
});

test('createFlyout: focus leaving the popup closes it (Tab away) and stays where it went; its trigger, inside() and an open submenu keep it', () => {
  const { window, doc, $, fly, click } = setup({ inside: (t) => t.id === 'extra' });
  click($('trig'), 0);
  assert.equal(doc.activeElement, $('a'));
  $('trig').focus();
  assert.equal(fly.isOpen(), true, 'Shift+Tab back to its trigger');
  $('extra').tabIndex = 0;
  $('extra').focus();
  assert.equal(fly.isOpen(), true, 'inside() counts as inside');
  $('b').focus();
  $('out').focus();
  assert.equal(fly.isOpen(), false, 'Tab out of the popup closes it');
  assert.equal($('trig').getAttribute('aria-expanded'), 'false');
  assert.equal(doc.activeElement, $('out'), 'focus stays where it went');
  const sub = createFlyout({ doc, win: window, trigger: $('b'), menu: $('sub'), mode: 'beside', parent: $('menu') });
  fly.open({ focus: true });
  sub.open({ focus: true });
  assert.equal(doc.activeElement, $('s2'));
  assert.equal(fly.isOpen(), true, 'focus in its open submenu keeps the menu');
  assert.equal(sub.isOpen(), true);
});

test('createFlyout: only focus leaving the popup closes it: focus moving between two places outside, or put back on a re-rendered control, leaves it open', () => {
  const { doc, $, fly, click } = setup();
  $('out').focus();
  click($('trig'));                                          // a pointer open: focus stays where it was
  assert.equal(fly.isOpen(), true);
  $('extra').tabIndex = 0;
  $('extra').focus();
  assert.equal(fly.isOpen(), true, 'focus was never in the popup, so it did not leave it');
  const old = doc.createElement('button');
  $('extra').after(old);
  old.focus();
  old.remove();                                              // a row re-rendered under focus…
  const fresh = doc.createElement('button');
  $('extra').after(fresh);
  fresh.focus();                                             // …and focused again by its owner
  assert.equal(fly.isOpen(), true, 'focus came back from nowhere');
  $('a').focus();
  $('out').focus();
  assert.equal(fly.isOpen(), false, 'from the popup to the page: it left');
});

test('createFlyout: a press on the popup keeps it open while another component moves focus on that press (the Ask sheet hands focus back as it closes)', () => {
  const { window, doc, $, fly, click } = setup();
  // Like the Ask sheet: any press outside it closes it, and focus goes back where it was.
  doc.addEventListener('pointerdown', (e) => { if (e.target !== $('out')) $('out').focus(); }, true);
  const press = (el) => {
    el.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
    el.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true }));
  };
  click($('trig'), 0);
  assert.equal(doc.activeElement, $('a'));
  press($('b'));
  assert.equal(doc.activeElement, $('out'));
  assert.equal(fly.isOpen(), true, 'the press did not close the menu under the pointer');
  click($('b'));
  assert.equal(fly.isOpen(), false, 'the click that follows picks the item');
  click($('trig'), 0);                                       // the press is over (pointerup)
  $('out').focus();
  assert.equal(fly.isOpen(), false, 'with no press in progress, focus leaving closes it again');
  click($('trig'), 0);
  $('b').dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
  $('b').dispatchEvent(new window.PointerEvent('pointercancel', { bubbles: true }));   // the browser took the press (a scroll)
  assert.equal(fly.isOpen(), true);
  $('a').focus();
  $('out').focus();
  assert.equal(fly.isOpen(), false, 'a cancelled press is over too');
});

test('createFlyout: a mouse click on its own trigger closes a keyboard-opened popup and lets go of focus', () => {
  const { doc, $, fly, click } = setup();
  click($('trig'), 0);
  assert.equal(fly.isOpen(), true);
  click($('trig'));
  assert.equal(fly.isOpen(), false);
  assert.equal(doc.activeElement, doc.body, 'a pointer close: focus is not handed to the trigger');
});

test('createFlyout: a right-click on the popup (its context menu takes the mouseup) does not leave a press in progress', () => {
  const { window, $, fly, click } = setup();
  click($('trig'), 0);
  $('b').dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 2 }));
  $('b').dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
  $('a').focus();
  $('out').focus();
  assert.equal(fly.isOpen(), false, 'focus leaving after a right-click still closes it');
});
