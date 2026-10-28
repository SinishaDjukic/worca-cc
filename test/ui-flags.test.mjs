// test/ui-flags.test.mjs — feature flags in the real shell (D4-D9, D12): the first paint hides an off
// flag, a `flags` frame flips it live and fires onFlagChange, data-flag + data-min-level need both,
// Settings › Labs lists / toggles / locks / resets at every level, and the chip links to the row.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { renderIndexHtml } from '../src/core/index-html.mjs';
import { applyFlags, flagOn, onFlagChange, chip, decorateFlagChips } from '../ui/public/flags.mjs';
import { createFlagsView, bindFlagSwitch } from '../ui/public/flags-view.mjs';

const trackDom = useDomRelease(afterEach);
const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
// The three level-gate selectors (ui-levels.test.mjs pins them); jsdom never loads style.css.
const LEVEL_GATES = [...css.matchAll(/:root\[data-level="\w+"\] \[data-min-level="\w+"\]:not\(\[data-level-keep\]\)/g)].map((m) => m[0]);

/** Hidden by a flag gate (#flag-gates) or a level gate, on the element or an ancestor. */
function gated(el) {
  const doc = el.ownerDocument;
  const flagSel = [...doc.getElementById('flag-gates').sheet.cssRules].map((r) => r.selectorText);
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (flagSel.some((s) => n.matches(s))) return true;
    if (LEVEL_GATES.some((s) => n.matches(s.replace(/^:root(\[[^\]]+\]) /, '')) && doc.documentElement.matches(`:root${s.match(/^:root(\[[^\]]+\])/)[1]}`))) return true;
  }
  return false;
}
const page = ({ level = 'expert', flags = { flagsDemo: false } } = {}) =>
  trackDom(new JSDOM(renderIndexHtml(html, 'system', level, flags), { url: 'http://localhost:4320/' })).window;
const tick = () => new Promise((r) => setTimeout(r, 0));

test('first paint, live flip, events, and flags × levels', async () => {
  await checkRows([
    { name: 'off: the demo note is gated from the first paint; on: it is not', run: () => {
      assert.ok(gated(page().document.getElementById('flags-demo-note')));
      assert.ok(!gated(page({ flags: { flagsDemo: true } }).document.getElementById('flags-demo-note')));
    } },
    { name: 'applyFlags (what a flags frame does) flips it without a reload; onFlagChange + worca:flags fire once per change', run: () => {
      const { document: doc } = page();
      const seen = []; const events = [];
      const off = onFlagChange('flagsDemo', (on) => seen.push(on));
      doc.addEventListener('worca:flags', (e) => events.push(e.detail.changed));
      applyFlags({ flagsDemo: true }, doc);
      applyFlags({ flagsDemo: true }, doc);
      assert.ok(flagOn('flagsDemo', doc));
      assert.equal(doc.documentElement.dataset.flags, 'flagsDemo');
      assert.ok(!gated(doc.getElementById('flags-demo-note')));
      applyFlags({ flagsDemo: false, ghostFlag: true }, doc);
      assert.ok(gated(doc.getElementById('flags-demo-note')));
      assert.deepEqual(seen, [true, false]);
      assert.deepEqual(events, [['flagsDemo'], ['flagsDemo']]);
      off();
    } },
    { name: 'data-flag with data-min-level needs both', run: () => {
      for (const [level, on, hidden] of [['simple', true, true], ['expert', true, false], ['expert', false, true]]) {
        const { document: doc } = page({ level, flags: { flagsDemo: on } });
        const el = doc.createElement('div');
        el.dataset.flag = 'flagsDemo'; el.dataset.minLevel = 'advanced';
        doc.body.appendChild(el);
        assert.equal(gated(el), hidden, `${level} / ${on}`);
      }
    } },
    { name: 'chip: links to the row, gated like its host, after an interactive host, idempotent', run: () => {
      const { document: doc } = page();
      decorateFlagChips(doc);
      const note = doc.getElementById('flags-demo-note');
      const a = note.querySelector('a.flag-chip');
      assert.equal(a.getAttribute('href'), '#settings/experimental/flagsDemo');
      assert.equal(a.textContent, 'Labs');
      assert.equal(a.dataset.flag, 'flagsDemo');
      decorateFlagChips(doc);
      assert.equal(note.querySelectorAll('a.flag-chip').length, 1);
      const b = doc.createElement('button'); b.dataset.flag = 'flagsDemo'; doc.body.appendChild(b);
      chip(b);
      assert.equal(b.nextElementSibling.className, 'flag-chip flag-chip-experimental');
    } },
    { name: 'chip: a sidebar row wears it inside, right after its label, as text (a sibling would be a rail row of its own)', run: () => {
      const { document: doc } = page({ flags: { requirements: true } });
      decorateFlagChips(doc);
      const b = doc.querySelector('.nav > button[data-nav="requirements"]');
      const c = b.querySelector(':scope > .flag-chip');
      assert.ok(c, 'the chip is inside the row');
      assert.equal(c.tagName, 'SPAN', 'no link inside a button');
      assert.equal(b.querySelector('a'), null);
      assert.equal(c.previousElementSibling.textContent, 'Requirements', 'right after the label');
      assert.equal(c.className, 'flag-chip flag-chip-experimental');
      assert.equal(c.dataset.flag, 'requirements');
      assert.match(c.title, /Requirements is in Labs/);
      // the stage word as everywhere else (Labs, like the Chat home's Shaper badge): short enough for the rail row
      assert.equal(c.textContent, 'Labs');
      assert.ok(!(b.nextElementSibling && b.nextElementSibling.classList.contains('flag-chip')), 'no chip row under it');
      assert.equal(doc.querySelectorAll('.nav > .flag-chip').length, 0, 'no flagged row of the rail gets a sibling chip');
      decorateFlagChips(doc);
      assert.equal(b.querySelectorAll('.flag-chip').length, 1, 'idempotent');
      // the label rule (flex:1, ellipsis) must not take the chip: it keeps its own width
      const at = (sel) => css.indexOf(sel);
      assert.match(css, /\.nav button > span\.flag-chip\{[^}]*flex:none/);
      assert.ok(at('.nav button > span.flag-chip{') > at('.nav button > span:not(.nav-count){'), 'after the label rule, so it wins the tie');
    } },
  ]);
});

test('Settings › Labs view: rows, toggle PATCH body, locked row, requires confirm, Reset all', async () => {
  const { document: doc } = page();
  const host = doc.getElementById('flags-host');
  const calls = []; const confirms = [];
  let state = [{ key: 'flagsDemo', title: 'Flags demo', description: 'D', stage: 'experimental', on: false, source: 'default', locked: false, docs: null, docsUrl: null, requires: [] }];
  const api = async (method, body) => {
    calls.push([method, body]);
    if (method === 'PATCH') state = state.map((f) => (f.key in body ? { ...f, on: body[f.key] === true, source: body[f.key] === null ? 'default' : 'settings' } : f));
    return { ok: true, status: 200, data: { flags: state } };
  };
  const view = createFlagsView({ host, msgEl: doc.getElementById('flags-msg'), resetBtn: doc.getElementById('flags-reset'), api,
    confirm: async (o) => { confirms.push(o.title); return true; } });
  await checkRows([
    { name: 'load lists the flag with its stage badge and an off switch', run: async () => {
      await view.load();
      const row = host.querySelector('[data-flag-row="flagsDemo"]');
      assert.equal(row.querySelector('.flag-stage').textContent, 'Labs');
      assert.equal(row.querySelector('[role="switch"]').getAttribute('aria-checked'), 'false');
      assert.ok(doc.getElementById('flags-reset').disabled, 'nothing stored: nothing to reset');
    } },
    { name: 'a click PATCHes { key: true }, repaints on and applies the flag to the page', run: async () => {
      host.querySelector('[data-flag-switch="flagsDemo"]').click();
      await tick(); await tick();
      assert.deepEqual(calls.at(-1), ['PATCH', { flagsDemo: true }]);
      assert.equal(host.querySelector('[data-flag-switch="flagsDemo"]').getAttribute('aria-checked'), 'true');
      assert.ok(!gated(doc.getElementById('flags-demo-note')));
      assert.equal(doc.activeElement.dataset.flagSwitch, 'flagsDemo', 'focus survives the repaint');
    } },
    { name: 'Reset all confirms, then PATCHes null for every unlocked flag', run: async () => {
      doc.getElementById('flags-reset').click();
      await tick(); await tick();
      assert.equal(confirms.at(-1), 'Reset all Labs features?');
      assert.deepEqual(calls.at(-1), ['PATCH', { flagsDemo: null }]);
    } },
    { name: 'a repaint (what a flags frame triggers) keeps focus on the switch', run: async () => {
      host.querySelector('[data-flag-switch="flagsDemo"]').focus();
      await view.load();
      assert.equal(doc.activeElement.dataset.flagSwitch, 'flagsDemo');
    } },
    { name: 'a locked row: disabled switch, the note, and a click does nothing', run: async () => {
      state = [{ ...state[0], on: true, source: 'env', locked: true }];
      await view.load();
      const sw = host.querySelector('[data-flag-switch="flagsDemo"]');
      assert.ok(sw.classList.contains('disabled'));
      assert.equal(sw.getAttribute('aria-disabled'), 'true');
      assert.match(host.textContent, /Locked by WORCA_FLAGS/);
      const n = calls.length;
      sw.click(); await tick();
      assert.equal(calls.length, n);
    } },
    { name: 'turning on a flag with an off prerequisite asks first, naming it', run: async () => {
      state = [
        { key: 'flagsDemo', title: 'Flags demo', description: 'D', stage: 'experimental', on: false, source: 'default', locked: false, docs: null, docsUrl: null, requires: [] },
        { key: 'childFlag', title: 'Child', description: 'D', stage: 'beta', on: false, source: 'default', locked: false, docs: null, docsUrl: 'https://x/blob/dev/docs/c.md', requires: ['flagsDemo'] },
      ];
      await view.load();
      assert.equal(host.querySelector('[data-flag-row="childFlag"] .flag-row-docs').getAttribute('href'), 'https://x/blob/dev/docs/c.md');
      await view.toggle('childFlag');
      assert.equal(confirms.at(-1), 'Turn on Child?');
    } },
  ]);
});

// The full app: the tab exists at every level, a `flags` frame flips the page, a chip deep-links to the row.
async function bootApp({ level, flags }) {
  const window = trackDom(new JSDOM(renderIndexHtml(html, 'system', level, flags), { url: 'http://localhost:4320/#settings/experimental' })).window;
  window.Element.prototype.scrollIntoView = function () {};
  class WSStub { constructor() { this.readyState = 1; WSStub.last = this; this._l = {}; } send() {} close() {}
    addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); } emit(t, e) { (this._l[t] || []).forEach((fn) => fn(e)); } }
  window.WebSocket = WSStub;
  const list = [{ key: 'flagsDemo', title: 'Flags demo', description: 'D', stage: 'experimental', on: !!flags.flagsDemo, source: 'default', locked: false, docs: null, docsUrl: null, requires: [] }];
  window.fetch = (u) => {
    const s = String(u);
    const body = s.startsWith('/api/flags') ? { flags: list } : s.startsWith('/api/settings') ? { root: '/tmp/x', default: '/tmp/x', flags } : { config: { steps: {}, customModels: [] }, models: [], efforts: [], projects: 0, pipelines: 0 };
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  for (let i = 0; i < 6; i++) await tick();
  WSStub.last?.emit('open', {});
  for (let i = 0; i < 6; i++) await tick();
  return { window, doc: window.document, frame: (msg) => WSStub.last.emit('message', { data: JSON.stringify(msg) }) };
}

test('app: the Labs tab shows at every level; a flags frame flips the page; the chip opens the row', async () => {
  await checkRows([
    { name: 'the tab button is level simple and never gated, at simple, advanced and expert', run: async () => {
      for (const level of ['simple', 'advanced', 'expert']) {
        const { doc } = await bootApp({ level, flags: { flagsDemo: false } });
        const b = doc.querySelector('#settings-tabs button[data-tab="experimental"]');
        assert.equal(b.dataset.minLevel, 'simple');
        assert.ok(!gated(b), level);
        assert.ok(!doc.querySelector('.settings-pane[data-tab="experimental"]').classList.contains('hidden'), `${level}: the pane opens`);
      }
    } },
    { name: 'a flags frame shows the demo note without a reload; hello carries flags too', run: async () => {
      const { doc, frame } = await bootApp({ level: 'simple', flags: { flagsDemo: false } });
      assert.ok(gated(doc.getElementById('flags-demo-note')));
      frame({ type: 'flags', flags: { flagsDemo: true } });
      assert.ok(!gated(doc.getElementById('flags-demo-note')));
      frame({ type: 'hello', bootId: 'b', runs: [], flags: { flagsDemo: false } });
      assert.ok(gated(doc.getElementById('flags-demo-note')));
    } },
    { name: 'window.__np.flags.set exists; the chip deep-links to and focuses the row', run: async () => {
      const { window, doc } = await bootApp({ level: 'expert', flags: { flagsDemo: true } });
      assert.equal(typeof window.__np.flags.set, 'function');
      const a = doc.querySelector('#flags-demo-note a.flag-chip');
      window.location.hash = a.getAttribute('href').slice(1);
      window.dispatchEvent(new window.HashChangeEvent('hashchange'));
      for (let i = 0; i < 6; i++) await tick();
      assert.ok(doc.getElementById('flag-row-flagsDemo').classList.contains('flag-row-target'));
      assert.equal(doc.activeElement.dataset.flagSwitch, 'flagsDemo');
    } },
  ]);
});

// A repaint queued before a test's DOM was released still asks flagOn (#718's tag chips do on every Runs
// list and header paint): releaseDom (test/helpers/jsdom-release.mjs) detaches <html> itself, so every
// flag reads off instead of throwing into the next test.
test('flagOn on a document without <html> reads off, never throws', () => {
  const { window } = new JSDOM('<!doctype html><html data-flags="runLabels"><body></body></html>');
  const doc = window.document;
  assert.equal(flagOn('runLabels', doc), true);
  doc.documentElement.remove();
  assert.equal(doc.documentElement, null);
  assert.equal(flagOn('runLabels', doc), false);
});

test('A4: a tab gets its Beta chip inside the label as plain text; other hosts keep the sibling link; data-flag-chip names an ungated flag', () => {
  const { document: doc } = page();
  const strip = doc.getElementById('settings-tabs');
  // No Settings tab is behind a flag today: a flagged tab like the old Presets one (a beta flag's tab).
  const tab = doc.createElement('button');
  Object.assign(tab, { type: 'button', className: 'tab', textContent: 'Summaries' });
  Object.assign(tab.dataset, { tab: 'demo', flag: 'commandSummaries', flagChip: '' });
  strip.appendChild(tab);
  decorateFlagChips(doc);
  const inside = tab.querySelector('.flag-chip');
  assert.ok(inside, 'the chip sits inside the tab');
  assert.equal(inside.tagName, 'SPAN');
  assert.equal(inside.getAttribute('href'), null, 'never a link inside a tab');
  assert.equal(inside.textContent, 'Beta');
  assert.match(tab.textContent, /^Summaries\s*Beta$/);
  assert.equal(strip.children.length, strip.querySelectorAll('button[data-tab]').length, 'one element child per tab');
  const b = doc.createElement('button'); b.dataset.flag = 'flagsDemo'; doc.body.appendChild(b);
  chip(b);
  assert.equal(b.nextElementSibling.tagName, 'A', 'a non-tab button keeps the sibling link');
  const named = doc.createElement('span'); named.dataset.flagChip = 'commandSummaries'; doc.body.appendChild(named);
  chip(named);
  const c = named.querySelector('.flag-chip');
  assert.ok(c, 'a data-flag-chip host shows its Beta chip');
  assert.equal(c.textContent, 'Beta');
  assert.equal(c.dataset.flag, undefined, 'an ungated host: the chip is never hidden by the flag gate');
});

test('bindFlagSwitch (a single flag\'s switch outside Labs, here a whole <button> row): one source with the Labs page', async () => {
  const { document: doc } = page({ flags: { smartRunNaming: true } });
  const el = doc.createElement('button');
  Object.assign(el, { type: 'button', className: 'mi menu-item sw-item' });
  el.setAttribute('role', 'menuitemcheckbox');
  doc.body.appendChild(el);
  const said = [];
  const onMsg = (text, o) => said.push([text, o.error]);
  await checkRows([
    { name: 'paints from data-flags, then a click sends PATCH {smartRunNaming:false} and repaints off', run: async () => {
      const calls = [];
      const api = async (method, body) => {
        calls.push([method, body]);
        return method === 'GET' ? { ok: true, status: 200, data: { flags: [{ key: 'smartRunNaming', on: true, locked: false }] } }
          : { ok: true, status: 200, data: { flags: [{ key: 'smartRunNaming', on: body.smartRunNaming }] } };
      };
      const off = bindFlagSwitch(el, 'smartRunNaming', { api, onMsg });
      assert.equal(el.getAttribute('aria-checked'), 'true');
      await tick();
      el.click();
      await tick();
      assert.deepEqual(calls, [['GET', undefined], ['PATCH', { smartRunNaming: false }]]);
      assert.equal(el.getAttribute('aria-checked'), 'false');
      assert.equal(flagOn('smartRunNaming', doc), false, 'the page state follows, so the Labs row repaints too');
      applyFlags({ smartRunNaming: true }, doc);
      assert.equal(el.getAttribute('aria-checked'), 'true', 'a flags frame repaints it');
      off();
      applyFlags({ smartRunNaming: false }, doc);
      assert.equal(el.getAttribute('aria-checked'), 'true', 'unbound: no repaint');
      applyFlags({ smartRunNaming: true }, doc);
    } },
    { name: 'a locked flag disables the switch; a click then sends nothing', run: async () => {
      const calls = [];
      const api = async (method, body) => { calls.push([method, body]); return { ok: true, status: 200, data: { flags: [{ key: 'smartRunNaming', on: true, locked: true }] } }; };
      const off = bindFlagSwitch(el, 'smartRunNaming', { api, onMsg });
      await tick();
      assert.ok(el.classList.contains('disabled'));
      assert.equal(el.getAttribute('aria-disabled'), 'true');
      assert.deepEqual(said.at(-1), ['Locked by WORCA_FLAGS', false], 'the message says why the switch is dead');
      el.click();
      await tick();
      assert.deepEqual(calls.map((c) => c[0]), ['GET']);
      off();
      el.classList.remove('disabled'); el.removeAttribute('aria-disabled'); el.tabIndex = 0;
    } },
    { name: 'a button row gets no key handler: Enter is the button\'s own click, so a bare keydown sends nothing', run: async () => {
      const calls = [];
      const api = async (method, body) => { calls.push(method); return { ok: true, status: 200, data: { flags: [{ key: 'smartRunNaming', on: method === 'PATCH' ? body.smartRunNaming : true }] } }; };
      const off = bindFlagSwitch(el, 'smartRunNaming', { api, onMsg });
      await tick();
      el.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      el.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
      await tick();
      assert.deepEqual(calls, ['GET'], 'no PATCH from keydown');
      off();
      applyFlags({ smartRunNaming: true }, doc);
    } },
    { name: 'a successful flip clears the message (onMsg gets an empty text, no error)', run: async () => {
      said.length = 0;
      const api = async (method, body) => ({ ok: true, status: 200, data: { flags: [{ key: 'smartRunNaming', on: method === 'PATCH' ? body.smartRunNaming : true, locked: false }] } });
      const off = bindFlagSwitch(el, 'smartRunNaming', { api, onMsg });
      await tick();
      el.click();
      await tick();
      assert.deepEqual(said, [['', false]]);
      off();
      applyFlags({ smartRunNaming: true }, doc);
    } },
    { name: 'a 409 reverts the switch, disables it and writes the error', run: async () => {
      const api = async (method) => (method === 'GET' ? { ok: true, status: 200, data: { flags: [{ key: 'smartRunNaming', on: true, locked: false }] } }
        : { ok: false, status: 409, data: { error: 'smartRunNaming is locked by WORCA_FLAGS' } });
      const off = bindFlagSwitch(el, 'smartRunNaming', { api, onMsg });
      await tick();
      el.click();
      await tick();
      assert.equal(el.getAttribute('aria-checked'), 'true', 'reverted');
      assert.ok(el.classList.contains('disabled'));
      assert.deepEqual(said.at(-1), ['smartRunNaming is locked by WORCA_FLAGS', true]);
      off();
    } },
  ]);
});
