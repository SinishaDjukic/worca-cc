// test/ui-stillhet.test.mjs — the one-time Stillhet question and the root sync (ui/public/stillhet.mjs): who is asked,
// the strip's words, accept, decline, Esc, a double press, both failures, a close from elsewhere, and data-rail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';
import * as S from '../ui/public/stillhet.mjs';
import { applyFlags } from '../ui/public/flags.mjs';

const { STILLHET_ISSUES_URL, shouldAskStillhet, stillhetStripHtml, mountStillhetAsk, syncRailRoot } = S;
const settle = () => new Promise((r) => setTimeout(r, 0));

function page() {
  const dom = new JSDOM('<!DOCTYPE html><html data-flags=""><head></head><body><header id="topnav"></header><div id="stillhet-ask" class="hidden"></div><input id="field"></body></html>', { url: 'http://localhost/' });
  return { window: dom.window, doc: dom.window.document, host: dom.window.document.getElementById('stillhet-ask') };
}
// A fetch that answers each request with the next reply (a status, or 'throw'); a held reply waits for release().
function fetcher(replies = []) {
  const calls = [];
  let release;
  const fetchImpl = (url, init = {}) => {
    calls.push({ url, method: init.method, body: init.body });
    const r = replies.length ? replies.shift() : 200;
    if (r === 'throw') return Promise.reject(new Error('network down'));
    const answer = () => ({ ok: r >= 200 && r < 300, status: r, json: async () => (r >= 300 ? { error: `server said ${r}` } : url === '/api/flags' ? { flags: [{ key: 'rail', on: true }] } : { stillhetAsked: true }) });
    if (r === 'hold') return new Promise((res) => { release = () => res({ ok: true, status: 200, json: async () => ({ flags: [{ key: 'rail', on: true }] }) }); });
    return Promise.resolve(answer());
  };
  return { fetchImpl, calls, release: () => release() };
}
function mount(replies, o = {}) {
  const p = page();
  const f = fetcher(replies);
  const done = [];
  if (o.focusField) p.doc.getElementById('field').focus();
  const ctl = mountStillhetAsk({ host: p.host, doc: p.doc, fetchImpl: f.fetchImpl, onDone: (how) => done.push(how) });
  const yes = () => p.host.querySelector('[data-confirm="yes"]');
  const no = () => p.host.querySelector('[data-confirm="no"]');
  const esc = (el) => el.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return { ...p, ...f, done, ctl, yes, no, esc };
}

test('the module exports exactly the five names; the link is package.json bugs.url', () => {
  assert.deepEqual(Object.keys(S).sort(), ['STILLHET_ISSUES_URL', 'mountStillhetAsk', 'shouldAskStillhet', 'stillhetStripHtml', 'syncRailRoot']);
  assert.equal(STILLHET_ISSUES_URL, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).bugs.url);
});

test('shouldAskStillhet: only an install that is not fresh, not asked, off and unlocked, with no welcome or setup open', async () => {
  const base = { onboarding: { stillhetAsked: false, fresh: false }, railFlag: { on: false, locked: false }, welcomeThisLoad: false, setupOpen: false };
  await checkRows([
    { name: 'asked false, not fresh, off and unlocked, no welcome, no setup: asks', run: () => assert.equal(shouldAskStillhet(base), true) },
    { name: 'already asked', run: () => assert.equal(shouldAskStillhet({ ...base, onboarding: { ...base.onboarding, stillhetAsked: true } }), false) },
    { name: 'a fresh install', run: () => assert.equal(shouldAskStillhet({ ...base, onboarding: { ...base.onboarding, fresh: true } }), false) },
    { name: 'rail already on', run: () => assert.equal(shouldAskStillhet({ ...base, railFlag: { on: true, locked: false } }), false) },
    { name: 'rail env-locked', run: () => assert.equal(shouldAskStillhet({ ...base, railFlag: { on: false, locked: true } }), false) },
    { name: 'the welcome shown in this load', run: () => assert.equal(shouldAskStillhet({ ...base, welcomeThisLoad: true }), false) },
    { name: 'the setup assistant open', run: () => assert.equal(shouldAskStillhet({ ...base, setupOpen: true }), false) },
    { name: 'a missing input (no flag row, no status)', run: () => {
      assert.equal(shouldAskStillhet({ ...base, railFlag: undefined }), false);
      assert.equal(shouldAskStillhet({ ...base, onboarding: undefined }), false);
      assert.equal(shouldAskStillhet(), false);
    } },
  ]);
});

test('stillhetStripHtml: the form strip, its words, the OutLink and both actions', () => {
  const html = stillhetStripHtml({});
  assert.match(html, /class="rc-confirm is-form"/);
  const { doc } = page();
  const el = doc.createElement('div');
  el.innerHTML = html;
  const text = el.textContent;
  assert.match(text, /Try Stillhet, the calmer Worca\?/);
  assert.match(text, /today it changes the colours/);
  assert.match(text, /for this Worca any time in Settings › Labs/);
  const a = el.querySelector('a.dc-out');
  assert.equal(a.getAttribute('href'), STILLHET_ISSUES_URL);
  assert.equal(a.textContent, 'Report a bug on GitHub');
  assert.deepEqual([...el.querySelectorAll('button')].map((b) => b.textContent), ['Try Stillhet', 'No thanks']);
  assert.equal(el.firstElementChild.getAttribute('role'), 'dialog');
});

test('mount: focus goes to "No thanks" only from the page body; a field keeps it', () => {
  const a = mount();
  assert.equal(a.host.classList.contains('hidden'), false);
  assert.equal(a.doc.activeElement, a.no());
  const b = mount([], { focusField: true });
  assert.equal(b.doc.activeElement, b.doc.getElementById('field'));
});

test('answers: accept, decline, Esc, a double press, Esc while working', async () => {
  await checkRows([
    { name: 'Try Stillhet: one PATCH {rail:true}, data-rail on, the strip closes, onDone accepted once', run: async () => {
      const m = mount();
      const off = syncRailRoot(m.doc);
      try {
        m.yes().click();
        await settle(); await settle();
        assert.deepEqual(m.calls, [{ url: '/api/flags', method: 'PATCH', body: '{"rail":true}' }]);
        assert.equal(m.doc.documentElement.hasAttribute('data-rail'), true);
        assert.deepEqual(m.done, ['accepted']);
        assert.equal(m.host.children.length, 0);
        assert.equal(m.host.classList.contains('hidden'), true);
      } finally { off(); applyFlags({ rail: false }, m.doc); }
    } },
    { name: 'No thanks: one POST {stillhetAsked:true}, no data-rail, onDone declined', run: async () => {
      const m = mount();
      m.no().click();
      await settle(); await settle();
      assert.deepEqual(m.calls, [{ url: '/api/onboarding', method: 'POST', body: '{"stillhetAsked":true}' }]);
      assert.equal(m.doc.documentElement.hasAttribute('data-rail'), false);
      assert.deepEqual(m.done, ['declined']);
      assert.equal(m.host.classList.contains('hidden'), true);
    } },
    { name: 'Esc outside the strip sends nothing; inside, it declines once', run: async () => {
      const m = mount([], { focusField: true });
      m.esc(m.doc.getElementById('field'));
      await settle();
      assert.deepEqual(m.calls, []);
      m.no().focus();
      m.esc(m.no());
      await settle(); await settle();
      assert.deepEqual(m.calls.map((c) => [c.url, c.body]), [['/api/onboarding', '{"stillhetAsked":true}']]);
      assert.deepEqual(m.done, ['declined']);
    } },
    { name: 'a double press on yes, and Esc while working, send one request and one onDone', run: async () => {
      const m = mount(['hold']);
      m.yes().click();
      assert.equal(m.yes().textContent, 'Turning on…');
      assert.ok(m.yes().disabled && m.no().disabled, 'both buttons are disabled while it works');
      m.yes().click();
      m.esc(m.no());
      m.release();
      await settle(); await settle();
      assert.equal(m.calls.length, 1);
      assert.deepEqual(m.done, ['accepted']);
      applyFlags({ rail: false }, m.doc);
    } },
  ]);
});

test('failures keep the strip: the alert, the reason, the link and Try again with focus; nothing stored', async () => {
  await checkRows([
    { name: 'a 500 on accept', run: async () => {
      const m = mount([500]);
      m.yes().focus();
      m.yes().click();
      await settle(); await settle();
      const t = m.host.querySelector('[role="alert"]');
      assert.match(t.textContent, /Couldn't turn Stillhet on/);
      assert.match(t.textContent, /server said 500/);
      assert.equal(m.host.querySelector('a.dc-out').getAttribute('href'), STILLHET_ISSUES_URL);
      assert.equal(m.yes().textContent, 'Try again');
      assert.equal(m.doc.activeElement, m.yes());
      assert.equal(m.doc.documentElement.hasAttribute('data-rail'), false);
      assert.deepEqual(m.done, []);
      m.yes().click();   // Try again retries the accept
      await settle(); await settle();
      assert.deepEqual(m.calls.map((c) => c.url), ['/api/flags', '/api/flags']);
      assert.deepEqual(m.done, ['accepted']);
      applyFlags({ rail: false }, m.doc);
    } },
    { name: 'a network failure on decline', run: async () => {
      const m = mount(['throw']);
      m.no().focus();
      m.no().click();
      await settle(); await settle();
      assert.match(m.host.querySelector('[role="alert"]').textContent, /Couldn't save your answer/);
      assert.match(m.host.querySelector('[role="alert"]').textContent, /network down/);
      assert.equal(m.doc.activeElement, m.yes());
      assert.deepEqual(m.done, []);
      m.yes().click();   // Try again retries the decline
      await settle(); await settle();
      assert.deepEqual(m.calls.map((c) => c.url), ['/api/onboarding', '/api/onboarding']);
      assert.deepEqual(m.done, ['declined']);
    } },
  ]);
});

test('answered elsewhere: rail turning on closes the strip; close() empties and hides the host', () => {
  const m = mount();
  applyFlags({ rail: true }, m.doc);
  assert.equal(m.host.children.length, 0);
  assert.equal(m.host.classList.contains('hidden'), true);
  assert.deepEqual(m.done, [], 'answered elsewhere: no onDone here');
  applyFlags({ rail: false }, m.doc);
  const n = mount();
  n.ctl.close();
  assert.equal(n.host.classList.contains('hidden'), true);
  n.ctl.close();   // twice is harmless
});

test('syncRailRoot: data-rail follows the flag at mount and live, until unsubscribed', () => {
  const { doc } = page();
  doc.documentElement.dataset.flags = 'rail';
  const off = syncRailRoot(doc);
  assert.equal(doc.documentElement.hasAttribute('data-rail'), true);
  applyFlags({ rail: false }, doc);
  assert.equal(doc.documentElement.hasAttribute('data-rail'), false);
  applyFlags({ rail: true }, doc);
  assert.equal(doc.documentElement.hasAttribute('data-rail'), true);
  off();
  applyFlags({ rail: false }, doc);
  assert.equal(doc.documentElement.hasAttribute('data-rail'), true, 'unsubscribed: no longer follows');
});
