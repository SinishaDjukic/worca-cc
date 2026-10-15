// test/pinpoint-shadow.test.mjs — Pinpoint mounted in a CLOSED shadow root (the browser extension's production mode).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPinpoint } from '../ui/public/pinpoint.mjs';

const RECT = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 };
const LINE = { left: 100, top: 200, right: 300, bottom: 218, width: 200, height: 18, x: 100, y: 200 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(opts = {}, { mode = 'closed', withShadow = true } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><p id="t">Rate limits apply per token bucket.</p><p id="o">Other text.</p></body></html>', { url: 'http://fixture.test/', pretendToBeVisual: true });
  const { window } = dom;
  window.Element.prototype.getBoundingClientRect = () => RECT;
  window.Range.prototype.getClientRects = () => [LINE];
  window.Range.prototype.getBoundingClientRect = () => LINE;
  window.navigator.clipboard = { writeText: async () => {} };
  const host = window.document.createElement('worca-pinpoint');
  window.document.documentElement.append(host);
  const root = host.attachShadow({ mode });
  const layer = window.document.createElement('div');
  root.append(layer);
  const hit = { el: null };
  root.elementFromPoint = () => hit.el;   // jsdom has no layout; browsers implement this on ShadowRoot
  const drafts = [];
  // The global Response (Node ≥ 18): jsdom has no window.Response (review m10).
  const pp = createPinpoint({ doc: window.document, win: window, fetch: async () => new Response(''), ...(withShadow ? { shadow: { host, root } } : {}), ...opts });
  pp.addSurface(window.document.body, { kind: 'web', layer: () => layer, container: () => window.document.documentElement, source: () => 'fixture.test', draft: (q, t) => drafts.push([q, t]) });
  return { window, doc: window.document, host, root, layer, pp, drafts, hit };
}
async function selectPara(s) {
  const r = s.doc.createRange();
  r.selectNodeContents(s.doc.getElementById('t'));
  s.window.getSelection().removeAllRanges();
  s.window.getSelection().addRange(r);
  s.doc.dispatchEvent(new s.window.Event('pointerup', { bubbles: true }));
  await wait(150);
}
const pointerdown = (s, target) => target.dispatchEvent(new s.window.MouseEvent('pointerdown', { bubbles: true, composed: true, cancelable: true, clientX: 150, clientY: 210 }));

test('the failure mode is real: a document listener sees only the host for a closed root', async () => {
  const s = setup({}, { withShadow: false });
  await selectPara(s);
  const btn = s.layer.querySelector('.pp-bar [data-k="send"]');
  let seen = null;
  s.doc.addEventListener('pointerdown', (e) => { seen = { target: e.target, path: e.composedPath() }; }, true);
  pointerdown(s, btn);
  assert.equal(seen.target, s.host);
  assert.ok(!seen.path.includes(btn));
  assert.equal(s.layer.querySelector('.pp-bar'), null, 'without the shadow option the bar closes on its own button (review C1)');
});

test('closed root + shadow option: a pointerdown on a toolbar button keeps the bar; the click acts', async () => {
  const s = setup();
  await selectPara(s);
  const btn = s.layer.querySelector('.pp-bar [data-k="send"]');
  assert.ok(btn);
  s.hit.el = btn;
  pointerdown(s, btn);
  assert.ok(s.layer.querySelector('.pp-bar'), 'bar still open');
  btn.click();
  assert.equal(s.drafts.length, 1);
  assert.match(s.drafts[0][0].text, /Rate limits/);
});

test('closed root: arrow keys move focus between toolbar buttons (activeElement read from the root)', async () => {
  const s = setup();
  await selectPara(s);
  const btns = [...s.layer.querySelectorAll('.pp-bar .pp-b')];
  btns[0].focus();
  assert.equal(s.doc.activeElement, s.host);   // retargeted
  btns[0].dispatchEvent(new s.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true, cancelable: true }));
  assert.equal(s.root.activeElement, btns[1]);
});

test('closed root: a pointerdown on the page outside still closes the bar', async () => {
  const s = setup();
  await selectPara(s);
  s.hit.el = null;
  pointerdown(s, s.doc.getElementById('o'));
  assert.equal(s.layer.querySelector('.pp-bar'), null);
});

test('trustedOnly ignores synthetic clicks and shortcut keys', async () => {
  const s = setup({ trustedOnly: true });
  await selectPara(s);
  s.layer.querySelector('.pp-bar [data-k="send"]').click();   // jsdom events are untrusted
  s.window.dispatchEvent(new s.window.KeyboardEvent('keydown', { key: 's', bubbles: true }));
  assert.equal(s.drafts.length, 0);
});

test('closed root: a pointer over nothing in the root counts as outside, even with a bar button focused (review m5)', async () => {
  const s = setup();
  await selectPara(s);
  s.layer.querySelector('.pp-bar .pp-b').focus();             // root.activeElement is a bar button…
  s.hit.el = null;                                            // …but the pointer is over the page
  pointerdown(s, s.host);                                     // the host is what a page-level listener would see
  assert.equal(s.layer.querySelector('.pp-bar'), null);
});

test('trustedOnly: a page script cannot drive an open popover with keys (Enter = "Use this") (review m4)', async () => {
  const alts = [{ title: 'Narrow it', detail: 'Do only the part the rest depends on now.' }];
  const body = `${JSON.stringify({ type: 'alternatives', alternatives: alts })}\n${JSON.stringify({ type: 'done' })}\n`;
  // jsdom cannot make a trusted event, so the test passes trustedOnly as a predicate: a "person" opens the popover
  // (trust on), then a "page script" presses keys (trust off). Production passes `true` (e.isTrusted).
  let trust = true;
  const s = setup({ trustedOnly: () => trust, fetch: async () => new Response(body, { headers: { 'content-type': 'application/x-ndjson' } }) });
  await selectPara(s);
  s.layer.querySelector('.pp-bar [data-k="alts"]').click();
  await wait(50);
  const pop = s.layer.querySelector('.pp-pop');
  assert.ok(pop, 'Alternatives opened');
  assert.ok(pop.querySelector('[data-use="0"]'), 'the alternative rendered');
  trust = false;
  // NOT pop.querySelector('button'): that is the header close [data-x] (head() renders first), and the
  // [data-disc],[data-x] guard in the Alternatives onKey would skip Enter even without the gate, so the red phase
  // would prove nothing. The 30 ms auto-focus has already run during the 50 ms wait; this focus() overrides it.
  const btn = pop.querySelector('[data-use="0"]');
  btn.focus();
  for (const key of ['Enter', '1']) btn.dispatchEvent(new s.window.KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
  await wait(20);
  assert.equal(s.drafts.length, 0, 'an untrusted Enter must not run "Use this"');
  trust = true;                                               // the same keys from a person still work
  btn.dispatchEvent(new s.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true }));
  await wait(20);
  assert.equal(s.drafts.length, 1);
  assert.match(s.drafts[0][1], /^Use this instead: Narrow it/);
});
