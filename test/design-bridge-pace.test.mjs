import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootBridge, SLOT_HERO, SLOTS } from './helpers/design-bridge.mjs';
test('one section applies at most 8 times a second, newest text wins, and the last rev lands', () => {
  const b = bootBridge({ html: SLOT_HERO });
  for (let i = 1; i <= 20; i++) { b.send('section', { id: 'hero', rev: i, html: `<section><p>${i}</p></section>`, final: false }); b.clock.tick(50); }
  b.clock.tick(200);
  const revs = b.of('applied').map((a) => a.rev);
  assert.ok(revs.length <= 9, String(revs));
  assert.deepEqual(revs, [...revs].sort((x, y) => x - y));
  assert.equal(revs.at(-1), 20);
});
test('sections share one beat: the first applies at once, the next waits for the beat', () => {
  const b = bootBridge({ html: SLOTS });
  b.send('section', { id: 'hero', rev: 1, html: '<section>a</section>', final: false });
  b.send('section', { id: 'price', rev: 1, html: '<section>b</section>', final: false });
  assert.deepEqual(b.of('applied').map((a) => a.id), ['hero']);
  b.clock.tick(125);
  assert.deepEqual(b.of('applied').map((a) => a.id), ['hero', 'price']);
});
test('M5: 12 live sections of 40 hold 8 Hz each, with no timer per section', () => {
  const ids = Array.from({ length: 40 }, (_, i) => `s${i}`);
  const rows = ids.map((id) => `<div data-worca-slot="${id}"></div>`).join('');
  const b = bootBridge({ html: `<!doctype html><html><head></head><body><div class="grid">${rows}</div></body></html>` });
  const live = ids.slice(0, 12);
  for (let t = 1; t <= 20; t++) { for (const id of live) b.send('section', { id, rev: t, html: `<section><p>${t}</p></section>`, final: false }); b.clock.tick(50); }
  b.clock.tick(200);
  const applied = b.of('applied');
  for (const id of live) {
    const mine = applied.filter((a) => a.id === id);
    assert.ok(mine.length >= 1 && mine.length <= 9, `${id}: ${mine.length}`);
    assert.equal(mine.at(-1).rev, 20);
  }
  assert.equal(new Set(applied.map((a) => a.id)).size, 12);
  assert.ok(b.clock.maxPending <= 2, String(b.clock.maxPending));
});
test('final skips the wait once, for that section only', () => {
  const b = bootBridge({ html: SLOTS });
  b.send('section', { id: 'hero', rev: 1, html: '<section>a</section>', final: false });
  b.send('section', { id: 'price', rev: 1, html: '<section>p</section>', final: false });
  b.send('section', { id: 'hero', rev: 2, html: '<section>b</section>', final: true });
  b.clock.tick(0);
  assert.equal(b.doc.querySelector('[data-section="hero"]').textContent, 'b');
  assert.ok(b.doc.querySelector('[data-worca-slot="price"]'), 'not final: still waits for the beat');
  b.clock.tick(125);
  assert.ok(b.doc.querySelector('[data-section="price"]'));
});
test('applies do not depend on animation frames: a hidden tab still lands text', () => {
  const b = bootBridge({ html: SLOT_HERO });
  b.send('section', { id: 'hero', rev: 1, html: '<section>a</section>', final: false });
  b.clock.tick(125);
  b.send('section', { id: 'hero', rev: 2, html: '<section>b</section>', final: false });
  assert.equal(b.of('applied').length, 2);   // clock.frame() was never called
});
test('settle: WAAPI on top-most new elements only, at most 250 ms, no attribute added', () => {
  const b = bootBridge({ html: SLOT_HERO, animate: true });
  b.send('section', { id: 'hero', rev: 1, html: '<section><h1>a</h1><p>b</p></section>', final: false });
  assert.deepEqual(b.animated.map((c) => c.el.tagName), ['SECTION']);
  assert.ok(b.animated[0].options.duration <= 250);
  b.clock.tick(125); b.animated.length = 0;
  b.send('section', { id: 'hero', rev: 2, html: '<section><h1>a</h1><p>b</p><div><span>c</span></div></section>', final: false });
  assert.deepEqual(b.animated.map((c) => c.el.tagName), ['DIV']);
  assert.equal(b.doc.querySelector('[data-section="hero"] div').outerHTML, '<div><span>c</span></div>');
});
test('settle: at most 24 per apply, skipped under reduced motion, and no throw where animate is missing', () => {
  const many = `<section>${'<p>x</p>'.repeat(60)}</section>`;
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><section data-section="hero"></section></body></html>', animate: true });
  b.send('section', { id: 'hero', rev: 1, html: many, final: false });
  assert.equal(b.animated.length, 24);
  const r = bootBridge({ html: SLOT_HERO, animate: true, reducedMotion: true });
  r.send('section', { id: 'hero', rev: 1, html: '<section>a</section>', final: false });
  assert.equal(r.animated.length, 0);
  const n = bootBridge({ html: SLOT_HERO });
  n.send('section', { id: 'hero', rev: 1, html: '<section>a</section>', final: false });
  assert.deepEqual(n.of('err'), []);
});
test('finals that arrive during one beat share one zero-delay timer and land together', () => {
  const b = bootBridge({ html: SLOTS });
  b.send('section', { id: 'hero', rev: 1, html: '<section>a</section>', final: false });
  b.send('section', { id: 'price', rev: 1, html: '<section>p</section>', final: true });
  b.send('section', { id: 'hero', rev: 2, html: '<section>b</section>', final: true });
  assert.equal(b.clock.maxPending, 2);
  b.clock.tick(0);
  assert.deepEqual(b.of('applied').map((a) => [a.id, a.rev]), [['hero', 1], ['price', 1], ['hero', 2]]);
});
test('a write that throws inside the beat costs only its own apply-failed: CSS goes first, the rest lands and the beat goes on', () => {
  const b = bootBridge({ html: '<!doctype html><html><head></head><body><section data-section="hero">old</section><div data-worca-slot="a"></div><div data-worca-slot="b"></div></body></html>', morphdom: false });
  b.send('section', { id: 'a', rev: 1, html: '<p>a</p>', final: false });
  b.send('section', { id: 'hero', rev: 1, html: '<section>new</section>', final: false });
  b.send('css', { file: 'global', rev: 1, text: '.g{x:y}', final: false });
  b.send('section', { id: 'b', rev: 1, html: '<p>b</p>', final: false });
  // The bridge takes document's methods at boot, so the CSS write is made to fail where it adds its style to <head>.
  const head = b.doc.head;
  head.appendChild = () => { throw new Error('css boom'); };
  b.clock.tick(125);
  assert.deepEqual(b.of('err').map((e) => [e.code, e.message]), [['apply-failed', 'css boom'], ['apply-failed', 'morphdom is not loaded in this doc']]);
  assert.deepEqual(b.of('applied').map((a) => a.id), ['a', 'b']);
  delete head.appendChild;
  b.send('css', { file: 'global', rev: 2, text: '.g{x:z}', final: false });
  b.clock.tick(125);
  assert.equal(b.doc.querySelector('style[data-worca-css="global"]').textContent, '.g{x:z}');
});
test('a final the beat already wrote is skipped by the zero-delay timer', () => {
  const b = bootBridge({ html: SLOT_HERO });
  // Due with the beat but queued before it: the final arrives on the beat's tick, and the beat runs first.
  b.win.setTimeout(() => b.send('section', { id: 'hero', rev: 2, html: '<section>b</section>', final: true }), 125);
  b.send('section', { id: 'hero', rev: 1, html: '<section>a</section>', final: false });
  b.clock.tick(125);
  assert.deepEqual(b.of('applied').map((a) => a.rev), [1, 2]);
  assert.deepEqual(b.of('err'), []);
});
