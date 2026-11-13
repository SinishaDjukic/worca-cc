// test/desktop-preload.test.mjs — desktop/preload.cjs, run as Electron runs a sandboxed preload: a function body whose
// only module is `electron`, with the page's window as its global (a JSDOM window here; jsdom is needed for real
// MutationObserver and DOMContentLoaded timing). It marks <html> as the desktop shell, reports { mode, scheme, rail }
// and follows the full-screen flag; a double-click on the title strip (not on a control) goes to main over
// worca:title-dblclick. It reports the page's badge ({ count, dot } from the "(N) " title and the dotted favicon) over
// worca:badge. It must expose nothing to the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { JSDOM } from 'jsdom';
import { cssRules } from './helpers/css-rules.mjs';
import { TITLE_DBLCLICK_CHANNEL } from '../desktop/src/title-bar.mjs';
import { BADGE_CHANNEL, MAX_BADGE_COUNT } from '../desktop/src/badge.mjs';
import { titleWithCount } from '../ui/public/alerts.mjs';

const SOURCE = readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setImmediate(r));

// The title strip as ui/public/shell/sidebar.html and main-column.html build it, plus the terminal head (inside its
// aside.term-pane, an overlay root, as ui/public/terminal-pane.mjs builds it), the Workflows view and a dialog.
const STRIP_HTML = `<div class="brand"><a class="logo" href="#chat/new" aria-label="worca: Chat"></a><a class="logo-mark" href="#chat/new" aria-label="worca: Chat"></a><button type="button" class="side-close" aria-label="Close"><span class="ic">x</span></button></div>`;
const MAIN_HTML = `<div class="main-col"><header class="topnav" id="topnav"><div class="topnav-l"><button type="button" id="side-toggle" aria-label="Menu"></button><h1 class="topnav-title" id="topnav-title">History</h1></div>`
  + `<div class="topnav-c"><div class="tsearch"><div class="tsearch-field"><input type="search" class="tsearch-input" id="tsearch-input"></div><div class="tsearch-pop" id="tsearch-pop" role="listbox" tabindex="-1" hidden><div class="tsearch-group">Runs</div></div></div></div>`
  + `<div class="topnav-r"><button type="button" class="btn topnav-new" id="topnav-new"><span class="topnav-new-label">New run</span></button><dialog class="in-bar" open><p class="in-dlg">menu</p></dialog></div></header>`
  + `<main class="main"><section class="view" data-view="workflows"><div class="wfv"><div class="wfv-node">node</div></div></section><p class="outside">body text</p>`
  + `<aside class="term-pane"><div class="term-resize"></div><div class="term-head"><span class="term-title">Terminal</span><button type="button" class="term-x">x</button></div><div class="term-screen">$</div></aside></main></div>`;

function page({ theme = 'system', collapsed = false, argv = ['--worca-chrome=inset'], dark = false, matchMedia = true, bodyClass = '', head = '' } = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><html lang="en" data-theme="${theme}"><head>${head}</head><body class="${bodyClass}"><aside class="sidebar${collapsed ? ' collapsed' : ''}" id="side-rail">${STRIP_HTML}</aside>${MAIN_HTML}</body></html>`, { runScripts: 'outside-only' });
  const win = dom.window;
  const media = new EventEmitter();
  media.matches = dark;
  if (matchMedia) {
    win.matchMedia = (q) => {
      assert.equal(q, '(prefers-color-scheme: dark)');
      return { get matches() { return media.matches; }, addEventListener: (ev, fn) => media.on(ev, fn), removeEventListener: (ev, fn) => media.off(ev, fn) };
    };
  }
  const ipcRenderer = new EventEmitter();
  ipcRenderer.sent = [];
  ipcRenderer.send = (channel, payload) => ipcRenderer.sent.push([channel, payload]);
  const required = [];
  const require = (name) => { required.push(name); if (name !== 'electron') throw new Error(`module not found: ${name}`); return { ipcRenderer }; };
  const globalsBefore = Object.getOwnPropertyNames(win);
  const fn = compileFunction(SOURCE, ['require', 'process'], { parsingContext: dom.getInternalVMContext() });
  fn(require, { argv: ['/electron', ...argv] });
  const loaded = new Promise((r) => win.document.addEventListener('DOMContentLoaded', () => setImmediate(r)));
  return { dom, win, doc: win.document, media, ipcRenderer, required, globalsBefore, loaded };
}
// The payload is built in the page's realm: copy it into this one before deepEqual.
const states = (p) => p.ipcRenderer.sent.filter(([c]) => c === 'worca:shell-state').map(([, s]) => JSON.parse(JSON.stringify(s)));

test('attributes from argv: inset, overlay, and a bogus or missing value → native', () => {
  for (const [argv, want] of [[['--worca-chrome=inset'], 'inset'], [['--worca-chrome=overlay'], 'overlay'], [['--worca-chrome=evil'], 'native'], [[], 'native']]) {
    const p = page({ argv });
    assert.equal(p.doc.documentElement.getAttribute('data-shell'), 'desktop');
    assert.equal(p.doc.documentElement.getAttribute('data-shell-chrome'), want, JSON.stringify(argv));
    p.win.close();
  }
});

test('a late <html>: the attributes land when it is inserted', async () => {
  // The preload runs after DOMContentLoaded here, so only its <html> insertion observer can mark the new element.
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'outside-only' });
  await new Promise((r) => dom.window.document.addEventListener('DOMContentLoaded', r));
  const doc = dom.window.document;
  doc.removeChild(doc.documentElement);
  const ipcRenderer = Object.assign(new EventEmitter(), { send() {} });
  compileFunction(SOURCE, ['require', 'process'], { parsingContext: dom.getInternalVMContext() })(() => ({ ipcRenderer }), { argv: ['/electron', '--worca-chrome=overlay'] });
  assert.equal(doc.documentElement, null);
  const html = doc.createElement('html');
  doc.appendChild(html);
  await tick();
  assert.equal(html.getAttribute('data-shell'), 'desktop');
  assert.equal(html.getAttribute('data-shell-chrome'), 'overlay');
  const later = doc.createElement('html');
  doc.replaceChild(later, html);
  await tick();
  assert.equal(later.hasAttribute('data-shell'), false, 'the observer disconnected after the first insertion');
  dom.window.close();
});

test('the first report waits for DOMContentLoaded and carries mode, scheme and rail', async () => {
  const p = page({ theme: 'dark', collapsed: true });
  assert.deepEqual(states(p), [], 'nothing before DOMContentLoaded');
  await p.loaded;
  assert.deepEqual(states(p), [{ mode: 'dark', scheme: 'dark', rail: true }]);
  assert.deepEqual(p.required, ['electron']);
  p.win.close();
});

test('a theme flip, a rail toggle and a media change each send one message; an unchanged state sends none', async () => {
  const p = page({ theme: 'system', dark: false });
  await p.loaded;
  assert.deepEqual(states(p), [{ mode: 'system', scheme: 'light', rail: false }]);
  p.doc.documentElement.setAttribute('data-theme', 'dark');
  await tick();
  assert.deepEqual(states(p).at(-1), { mode: 'dark', scheme: 'dark', rail: false });
  p.doc.documentElement.setAttribute('data-theme', 'dark');   // app.js re-applies the same value on a media change
  await tick();
  assert.equal(states(p).length, 2, 'the same state is not sent again');
  p.doc.getElementById('side-rail').classList.add('collapsed');
  await tick();
  assert.deepEqual(states(p).at(-1), { mode: 'dark', scheme: 'dark', rail: true });
  p.doc.documentElement.setAttribute('data-theme', 'system');
  await tick();
  assert.deepEqual(states(p).at(-1), { mode: 'system', scheme: 'light', rail: true });
  p.media.matches = true;
  p.media.emit('change', { matches: true });
  assert.deepEqual(states(p).at(-1), { mode: 'system', scheme: 'dark', rail: true });
  p.media.emit('change', { matches: true });
  p.doc.getElementById('side-rail').classList.add('other');
  await tick();
  assert.equal(states(p).length, 5);
  p.doc.documentElement.setAttribute('data-theme', 'bogus');
  await tick();
  assert.equal(states(p).length, 5, 'an unknown data-theme reads as system: unchanged');
  p.win.close();
});

test('system follows matchMedia; no matchMedia → light', async () => {
  const dark = page({ theme: 'system', dark: true });
  await dark.loaded;
  assert.deepEqual(states(dark), [{ mode: 'system', scheme: 'dark', rail: false }]);
  dark.win.close();
  const none = page({ theme: 'system', matchMedia: false });
  await none.loaded;
  assert.deepEqual(states(none), [{ mode: 'system', scheme: 'light', rail: false }]);
  none.win.close();
});

test('worca:shell-fullscreen true / false / non-boolean toggles data-shell-fullscreen', () => {
  const p = page();
  const root = p.doc.documentElement;
  p.ipcRenderer.emit('worca:shell-fullscreen', {}, true);
  assert.equal(root.hasAttribute('data-shell-fullscreen'), true);
  p.ipcRenderer.emit('worca:shell-fullscreen', {}, false);
  assert.equal(root.hasAttribute('data-shell-fullscreen'), false);
  p.ipcRenderer.emit('worca:shell-fullscreen', {}, true);
  p.ipcRenderer.emit('worca:shell-fullscreen', {}, 'x');
  assert.equal(root.hasAttribute('data-shell-fullscreen'), false, "'x' counts as false");
  p.win.close();
});

test('the page gets nothing: no new window property, no contextBridge', async () => {
  const p = page();
  await p.loaded;
  assert.deepEqual(Object.getOwnPropertyNames(p.win).filter((k) => !p.globalsBefore.includes(k)), []);
  assert.doesNotMatch(SOURCE, /contextBridge/);
  assert.doesNotMatch(SOURCE, /\bwindow\.[A-Za-z_$][\w$]*\s*=[^=]/, 'no window.* writes');
  p.win.close();
});

const dblclicks = (p) => p.ipcRenderer.sent.filter(([c]) => c === TITLE_DBLCLICK_CHANNEL);
/** Dispatch a dblclick on `target` (an element or a text node); jsdom has no layout, so the target is the hit. */
function dbl(p, target, button = 0) {
  const ev = new p.win.MouseEvent('dblclick', { bubbles: true, cancelable: true, button });
  target.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false, 'never preventDefault');
}

test('a double-click on the logo row\'s empty space, the top bar\'s title or the Workflows strip sends worca:title-dblclick once (inset and overlay)', () => {
  for (const chrome of ['inset', 'overlay']) {
    const p = page({ argv: [`--worca-chrome=${chrome}`], bodyClass: 'view-workflows' });
    const $ = (sel) => p.doc.querySelector(sel);
    const targets = [$('.brand'), $('.topnav'), $('.topnav-l'), $('.topnav-title'), $('.topnav-title').firstChild, $('.topnav-c'), $('.topnav-r'), $('.view[data-view="workflows"]')];
    targets.forEach((t, i) => {
      dbl(p, t);
      assert.equal(dblclicks(p).length, i + 1, `${chrome}: ${t.nodeType === 3 ? 'title text' : t.className || t.tagName}`);
    });
    for (const [channel, payload] of dblclicks(p)) assert.deepEqual([channel, payload], [TITLE_DBLCLICK_CHANNEL, undefined], 'no payload');
    p.win.close();
  }
});

test('no send: on a link, button, input, [tabindex], a popover/listbox inside the top bar, the .wfv canvas, outside the strip, a right button, in full screen (inset), or under the native chrome', () => {
  const p = page({ bodyClass: 'view-workflows' });
  const $ = (sel) => p.doc.querySelector(sel);
  const pop = $('.tsearch-pop');
  pop.hidden = false;
  for (const sel of ['.logo', '.logo-mark', '.side-close', '.side-close .ic', '#side-toggle', '#tsearch-input', '.tsearch-pop', '.tsearch-group', '#topnav-new', '.topnav-new-label', 'dialog.in-bar', '.in-dlg', '.wfv', '.wfv-node', '.outside', 'main.main', '.sidebar', 'body']) {
    dbl(p, $(sel));
    assert.equal(dblclicks(p).length, 0, sel);
  }
  for (const sel of ['.brand', '.topnav-title']) {
    dbl(p, $(sel), 2);
    dbl(p, $(sel), 1);
  }
  assert.equal(dblclicks(p).length, 0, 'only the primary button');
  p.doc.documentElement.setAttribute('data-shell-fullscreen', '');
  dbl(p, $('.brand'));
  dbl(p, $('.view[data-view="workflows"]'));
  assert.equal(dblclicks(p).length, 0, 'inset in full screen');
  p.doc.documentElement.removeAttribute('data-shell-fullscreen');
  dbl(p, $('.brand'));
  assert.equal(dblclicks(p).length, 1, 'out of full screen again');
  p.doc.body.className = '';
  dbl(p, $('.view[data-view="workflows"]'));
  assert.equal(dblclicks(p).length, 1, 'the Workflows view is a strip only while it shows');
  p.win.close();
  const over = page({ argv: ['--worca-chrome=overlay'] });
  over.doc.documentElement.setAttribute('data-shell-fullscreen', '');
  dbl(over, over.doc.querySelector('.brand'));
  assert.equal(dblclicks(over).length, 1, 'the full-screen gate is inset only; main still refuses in full screen');
  over.win.close();
  for (const argv of [['--worca-chrome=native'], [], ['--worca-chrome=evil']]) {
    const nat = page({ argv, bodyClass: 'view-workflows' });
    for (const sel of ['.brand', '.topnav-title', '.term-head', '.view[data-view="workflows"]']) dbl(nat, nat.doc.querySelector(sel));
    assert.equal(dblclicks(nat).length, 0, JSON.stringify(argv));
    nat.win.close();
  }
});

test('.term-head double-click sends only under overlay', () => {
  const inset = page();
  dbl(inset, inset.doc.querySelector('.term-head'));
  dbl(inset, inset.doc.querySelector('.term-title'));
  assert.equal(dblclicks(inset).length, 0);
  inset.win.close();
  const over = page({ argv: ['--worca-chrome=overlay'] });
  dbl(over, over.doc.querySelector('.term-head'));
  dbl(over, over.doc.querySelector('.term-title'));
  assert.equal(dblclicks(over).length, 2);
  dbl(over, over.doc.querySelector('.term-x'));
  assert.equal(dblclicks(over).length, 2, 'its close button is a control');
  dbl(over, over.doc.querySelector('.term-screen'));
  dbl(over, over.doc.querySelector('.term-pane'));
  dbl(over, over.doc.querySelector('.term-resize'));
  assert.equal(dblclicks(over).length, 2, 'the rest of the pane is no-drag');
  over.win.close();
});

test('a strip inside a no-drag root still sends (it sets drag itself); a no-drag element inside the strip does not', () => {
  const p = page({ argv: ['--worca-chrome=overlay'] });
  const $ = (sel) => p.doc.querySelector(sel);
  const dlg = p.doc.createElement('div');
  dlg.setAttribute('role', 'dialog');
  $('main.main').append(dlg);
  dlg.append($('.topnav'));
  dbl(p, $('.topnav-title'));
  assert.equal(dblclicks(p).length, 1, 'an ancestor overlay root does not cancel the strip');
  dbl(p, $('#topnav-new'));
  dbl(p, $('.in-dlg'));
  assert.equal(dblclicks(p).length, 1, 'controls and overlay roots inside the strip still block');
  p.win.close();
});

test('the listener runs in the capture phase: a bubbling stopPropagation in the strip still lets the send through', () => {
  const p = page();
  p.doc.querySelector('.topnav-l').addEventListener('dblclick', (e) => e.stopPropagation());
  dbl(p, p.doc.querySelector('.topnav-title'));
  assert.equal(dblclicks(p).length, 1);
  p.win.close();
});

/** The string items of `const <name> = [ … ];` in the preload source. */
function sourceArray(name) {
  const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(SOURCE);
  assert.ok(m, `the preload declares ${name}`);
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}
const splitList = (list) => list.split(/,(?![^()[\]]*[)\]])/).map((x) => x.trim()).filter(Boolean);

test('the preload\'s no-drag list covers every selector of the CSS no-drag rules, and its channel equals TITLE_DBLCLICK_CHANNEL', () => {
  const css = readFileSync(new URL('../ui/public/shell/desktop-shell.css', import.meta.url), 'utf8');
  const selectors = (rule) => rule.sel.split(/,(?![^()]*\))/).map((x) => x.trim());
  const noDrag = cssRules(css).filter((r) => /(^|;)\s*app-region:no-drag/.test(r.body)).flatMap(selectors);
  assert.ok(noDrag.length >= 6);
  const preload = new Set(sourceArray('NO_DRAG'));
  const names = new Set();
  for (const sel of noDrag) {
    const last = sel.split(/\s+(?![^()]*\))/).at(-1);
    const m = /^:is\((.*)\)$/.exec(last);
    for (const n of m ? splitList(m[1]) : [last]) names.add(n);
  }
  assert.ok(names.has('button') && names.has('.req-dlg-wrap') && names.has('.wfv'), [...names].join(' '));
  for (const n of names) assert.ok(preload.has(n), `the preload's NO_DRAG has ${n}`);
  assert.deepEqual(sourceArray('SEND_CHROMES'), ['inset', 'overlay']);
  const sends = [...SOURCE.matchAll(/ipcRenderer\.send\('([^']+)'\)/g)].map((x) => x[1]);
  assert.deepEqual(sends, [TITLE_DBLCLICK_CHANNEL], 'one payload-free send, on the shared channel');
});

// The page's own head (ui/public/shell/sidebar.html): the base title and the one icon link alerts.mjs dots.
const HEAD = '<title>Worca</title><link rel="icon" type="image/png" href="/assets/worca-favicon.png">';
const FAVICON = '/assets/worca-favicon.png';
const DOTTED = 'data:image/png;base64,iVBORw0KGgo=';
const badgeSends = (p) => p.ipcRenderer.sent.filter(([c]) => c === BADGE_CHANNEL);
const badges = (p) => badgeSends(p).map(([, b]) => JSON.parse(JSON.stringify(b)));
const B = (count, dot = false) => ({ count, dot });

test('badge: the first report at DOMContentLoaded is {count:0, dot:false}; a title already in the parsed head (\'(2) Worca\' via the head param) is reported then', async () => {
  const p = page({ head: HEAD });
  assert.deepEqual(badges(p), [], 'nothing before DOMContentLoaded');
  await p.loaded;
  assert.deepEqual(badges(p), [B(0)]);
  p.win.close();
  const two = page({ head: '<title>(2) Worca</title><link rel="icon" href="/assets/worca-favicon.png">' });
  await two.loaded;
  assert.deepEqual(badges(two), [B(2)]);
  assert.deepEqual(two.required, ['electron']);
  two.win.close();
});

test('badge: titleWithCount(\'Worca\', 2) → {2,false}; a data: favicon → dot; title back to Worca with the dot → {0,true}; the original href → {0,false}; an unchanged state sends nothing', async () => {
  const p = page({ head: HEAD });
  await p.loaded;
  const link = p.doc.querySelector('link[rel~="icon"]');
  p.doc.title = titleWithCount(p.doc.title, 2);
  await tick();
  assert.deepEqual(badges(p).at(-1), B(2));
  link.setAttribute('href', DOTTED);
  await tick();
  assert.deepEqual(badges(p).at(-1), B(2, true));
  link.setAttribute('href', DOTTED);   // app.js re-sets the same dotted href on every frame
  p.doc.title = titleWithCount(p.doc.title, 2);
  await tick();
  assert.equal(badges(p).length, 3, 'unchanged: nothing sent');
  p.doc.title = titleWithCount(p.doc.title, 0);
  await tick();
  assert.deepEqual(badges(p).at(-1), B(0, true), 'problems only');
  link.setAttribute('href', FAVICON);
  await tick();
  assert.deepEqual(badges(p), [B(0), B(2), B(2, true), B(0, true), B(0)]);
  p.win.close();
});

test('badge: a title created later in an empty head is seen; \'(x) Worca\', \'Worca (2)\' and \'(2)Worca\' → 0', async () => {
  const p = page();
  await p.loaded;
  assert.deepEqual(badges(p), [B(0)]);
  const seq = [['(3) Worca', 3], ['(x) Worca', 0], ['(4) Worca', 4], ['Worca (2)', 0], ['(5) Worca', 5], ['(2)Worca', 0]];
  for (const [title, count] of seq) {
    p.doc.title = title;
    await tick();
    assert.deepEqual(badges(p).at(-1), B(count), title);
  }
  assert.equal(badges(p).length, seq.length + 1);
  p.win.close();
});

test('badge: channel and clamp — the sent channel is BADGE_CHANNEL, \'(123456) Worca\' → MAX_BADGE_COUNT, the payload has exactly the keys count and dot with primitive types', async () => {
  assert.equal(/const BADGE = '([^']+)';/.exec(SOURCE)?.[1], BADGE_CHANNEL);
  assert.equal(Number(/const MAX_COUNT = (\d+);/.exec(SOURCE)?.[1]), MAX_BADGE_COUNT);
  const p = page({ head: '<title>(123456) Worca</title><link rel="icon" href="data:image/png;base64,AA==">' });
  await p.loaded;
  const sends = badgeSends(p);
  assert.equal(sends.length, 1);
  const [channel, payload] = sends[0];
  assert.equal(channel, BADGE_CHANNEL);
  assert.deepEqual(Object.keys(payload).sort(), ['count', 'dot']);
  assert.equal(typeof payload.count, 'number');
  assert.equal(typeof payload.dot, 'boolean');
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), B(MAX_BADGE_COUNT, true));
  p.doc.title = '(99999) Worca';
  await tick();
  assert.equal(badgeSends(p).length, 1, 'the clamp: the same state');
  p.win.close();
});
