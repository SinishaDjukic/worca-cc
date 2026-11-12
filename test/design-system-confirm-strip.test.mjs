// test/design-system-confirm-strip.test.mjs — ConfirmStrip's link, noBusy, back and attrs options, strip:back, and the strip's CSS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { confirmStrip, watchStrips } from '../ui/public/design-system/components/index.mjs';

const doc = (html) => new JSDOM(`<body>${html}</body>`, { pretendToBeVisual: true }).window;

test('without the new options the strip is unchanged (ask, busy, failed)', () => {
  assert.equal(confirmStrip({ text: 'Merge?', yes: 'Merge' }),
    '<div class="rc-confirm" role="alertdialog" aria-labelledby="rc-strip-t" data-motion="open"><span class="rc-confirm-t" id="rc-strip-t">Merge?</span><span class="rc-confirm-acts"><button type="button" class="btn btn-sm btn-primary" data-confirm="yes" data-key="confirm:yes" data-motion="swap">Merge</button><button type="button" class="btn btn-sm btn-quiet" data-confirm="no" data-key="confirm:no">Cancel</button></span></div>');
  const busy = doc(confirmStrip({ text: 'Q', yes: 'Go', busy: 'Going…' })).document;
  assert.equal(busy.querySelector('[data-confirm="yes"]').disabled, true);
  assert.equal(busy.querySelector('[data-confirm="no"]').disabled, false);
  assert.equal(busy.querySelector('.rc-confirm').hasAttribute('aria-busy'), false);
  const failed = doc(confirmStrip({ text: 'Q', yes: 'Go', err: { title: 'Failed', detail: 'why' } })).document;
  assert.equal(failed.querySelector('[data-confirm="yes"]').textContent, 'Try again');
});

test('link: one https text link after the sentence; none for http:, javascript: or the failed state', () => {
  const ok = doc(confirmStrip({ text: 'Q', yes: 'Y', link: { label: 'Report', href: 'https://x.test/i' } })).document;
  const a = ok.querySelectorAll('a.dc-link');
  assert.equal(a.length, 1);
  assert.equal(a[0].target, '_blank');
  assert.equal(a[0].getAttribute('rel'), 'noopener noreferrer');
  assert.ok(ok.querySelector('.rc-confirm-t a'));
  for (const href of ['http://x.test', 'javascript:alert(1)', '']) {
    assert.equal(doc(confirmStrip({ text: 'Q', yes: 'Y', link: { label: 'R', href } })).document.querySelectorAll('a').length, 0);
  }
  assert.equal(doc(confirmStrip({ text: 'Q', yes: 'Y', err: { title: 'T', detail: 'D' }, link: { label: 'R', href: 'https://x.test' } })).document.querySelectorAll('a').length, 0);
});

test('noBusy labels the quiet side and disables both; busy alone disables only the step', () => {
  const d = doc(confirmStrip({ text: 'Q', yes: 'Y', no: 'No thanks', noBusy: 'Saving…' })).document;
  assert.equal(d.querySelector('[data-confirm="no"]').textContent, 'Saving…');
  assert.equal(d.querySelector('[data-confirm="yes"]').disabled, true);
  assert.equal(d.querySelector('[data-confirm="no"]').disabled, true);
});

test('back: data-esc, attrs hooks; Esc sends strip:back and presses neither answer; without it Esc presses Cancel', () => {
  for (const back of [true, false]) {
    const w = doc(confirmStrip({ text: 'Q', yes: 'Y', back, attrs: { 'data-stillhet': 'x' } }));
    const d = w.document, strip = d.querySelector('.rc-confirm');
    assert.equal(strip.getAttribute('data-stillhet'), 'x');
    assert.equal(strip.getAttribute('data-esc'), back ? 'back' : null);
    strip.getClientRects = () => [1];
    watchStrips(d);
    let clicks = 0, backs = 0;
    d.querySelectorAll('[data-confirm]').forEach((b) => b.addEventListener('click', () => { clicks++; }));
    d.addEventListener('strip:back', () => { backs++; });
    d.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.deepEqual([clicks, backs], back ? [0, 1] : [1, 0]);
  }
});

test('back: Esc does nothing while the strip is working', () => {
  for (const o of [{ busy: 'Turning on…' }, { noBusy: 'Saving…' }]) {
    const w = doc(confirmStrip({ text: 'Q', yes: 'Y', back: true, ...o }));
    const d = w.document;
    d.querySelector('.rc-confirm').getClientRects = () => [1];
    watchStrips(d);
    let backs = 0;
    d.addEventListener('strip:back', () => { backs++; });
    d.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(backs, 0);
  }
});

test('the strip CSS exists once, in the app part', () => {
  const parts = JSON.parse(readFileSync('ui/public/parts.json', 'utf8')).css;
  assert.ok(parts.includes('design-system/confirm-strip.css'));
  const mine = readFileSync('ui/public/design-system/confirm-strip.css', 'utf8');
  for (const n of ['.rc-confirm{', '.dc-link{', '#rail-strip{']) assert.ok(mine.includes(n), n);
  const rail = readFileSync('ui/public/stillhet/css/rail.css', 'utf8'), shell = readFileSync('ui/public/stillhet/shell/shell.css', 'utf8');
  for (const n of ['.rc-confirm{', '.dc-link{']) assert.ok(!rail.includes(n), n);
  assert.ok(!shell.includes('#rail-strip{'));
});
