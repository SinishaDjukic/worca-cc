// test/desktop-preload.test.mjs — desktop/preload.cjs, run as Electron runs a sandboxed preload: a function body whose
// only module is `electron`, with the page's window as its global (a JSDOM window here; jsdom is needed for real
// MutationObserver and DOMContentLoaded timing). It marks <html> as the desktop shell, reports { mode, scheme, rail }
// and follows the full-screen flag. It must expose nothing to the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { JSDOM } from 'jsdom';

const SOURCE = readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setImmediate(r));

function page({ theme = 'system', collapsed = false, argv = ['--worca-chrome=inset'], dark = false, matchMedia = true } = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><html lang="en" data-theme="${theme}"><head></head><body><aside class="sidebar${collapsed ? ' collapsed' : ''}" id="side-rail"></aside></body></html>`, { runScripts: 'outside-only' });
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
