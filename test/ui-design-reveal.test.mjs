// The Design stage's reveal pacing (ui/public/design/reveal.mjs): a burst of section text lands in order as true
// prefixes, at most 3 s after it arrived and at least 125 ms per step, on the shared fake clock
// (test/helpers/design-clock.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReveal, cutPoints } from '../ui/public/design/reveal.mjs';
import { fakeClock } from './helpers/design-clock.mjs';

const HTML = `<section>${'<p>word word word</p>'.repeat(200)}</section>`;
const rig = (o = {}) => { const clock = fakeClock(); const out = [];
  const r = createReveal({ setTimer: clock.set, clearTimer: clock.clear, now: () => clock.now, reduced: () => o.reduced === true, onPrefix: (p) => out.push({ ...p, at: clock.now }) });
  return { r, clock, out }; };
const K = { key: 'k', sectionId: 'hero' };

test('C2: a burst lands in order within 3 s, each step a real prefix, at least 125 ms apart, starting at once', () => {
  const { r, clock, out } = rig();
  r.push({ ...K, text: HTML, final: false });
  clock.tick(3000);
  assert.equal(out.at(-1).text, HTML);
  assert.equal(out[0].at, 0);
  assert.ok(out.length <= 25, String(out.length));
  for (let i = 0; i < out.length; i++) {
    assert.ok(HTML.startsWith(out[i].text));
    if (i) { assert.ok(out[i].at - out[i - 1].at >= 125); assert.ok(out[i].text.length > out[i - 1].text.length); }
  }
});
test('never cuts inside a tag; a long run of text cuts at spaces', () => {
  assert.ok(cutPoints(HTML, 0).every((c) => !/<[^>]*$/.test(HTML.slice(0, c))));
  const long = `<p>${'word '.repeat(60)}</p>`;
  assert.ok(cutPoints(long, 0).length > 5);
});
test('more text mid-burst: everything is shown within 3 s of arriving, never earlier than it arrived', () => {
  const { r, clock, out } = rig();
  r.push({ ...K, text: HTML, final: false });
  clock.tick(1000);
  const more = `${HTML}<p>tail</p>`;
  r.push({ ...K, text: more, final: false });
  assert.ok(out.every((o) => more.startsWith(o.text)));
  clock.tick(3000);
  assert.equal(out.at(-1).text, more);
});
test('an Edit rewrites earlier text: the next prefix follows the new text', () => {
  const { r, clock, out } = rig();
  r.push({ ...K, text: '<h1>Old</h1><p>rest</p>', final: false }); clock.tick(3000);
  r.push({ ...K, text: '<h1>New</h1><p>rest</p>', final: false }); clock.tick(3000);
  assert.equal(out.at(-1).text, '<h1>New</h1><p>rest</p>');
});
test('a cleared draft shows empty at once, then grows again (P2 clears before a Write over an old draft)', () => {
  const { r, clock, out } = rig();
  r.push({ ...K, text: '<p>old</p>', final: false }); clock.tick(3000);
  r.push({ ...K, text: '', final: false });
  assert.equal(out.at(-1).text, '');
  r.push({ ...K, text: '<p>new</p>', final: false }); clock.tick(3000);
  assert.equal(out.at(-1).text, '<p>new</p>');
});
test('final only on the step that reaches the whole final text; a finished key takes no more steps', () => {
  const { r, clock, out } = rig();
  r.push({ ...K, text: HTML, final: true }); clock.tick(3000);
  assert.deepEqual(out.filter((o) => o.final).map((o) => o.text), [HTML]);
  assert.equal(out.at(-1).final, true);
  r.finalize('k');
  assert.equal(out.filter((o) => o.final).length, 1);
});
test('finalize settles what is shown now, in full, as final', () => {
  const { r, clock, out } = rig();
  r.push({ ...K, text: HTML, final: false }); clock.tick(200);
  r.finalize('k');
  assert.deepEqual([out.at(-1).text, out.at(-1).final], [HTML, true]);
});
test('revs strictly rise per key, across pushes and flushes', () => {
  const { r, clock, out } = rig();
  r.push({ ...K, text: HTML, final: false }); clock.tick(500);
  r.flush({ ...K, text: HTML, final: false }); r.push({ ...K, text: `${HTML}x`, final: true }); clock.tick(3000);
  assert.ok(out.every((o, i) => !i || o.rev > out[i - 1].rev));
});
test('reduced motion: at once and in one step; a flush too, with no timer left', () => {
  const { r, clock, out } = rig({ reduced: true });
  r.push({ ...K, text: HTML, final: true });
  assert.deepEqual(out.map((o) => [o.text, o.final]), [[HTML, true]]);
  assert.equal(clock.pending(), 0);
  const b = rig(); b.r.push({ ...K, text: HTML, final: false }); b.r.flush({ ...K, text: HTML, final: false });
  assert.equal(b.clock.pending(), 0);
  assert.equal(b.out.at(-1).text, HTML);
});
test('a hidden tab catches up: one late timer lands the whole burst', () => {
  const { r, clock, out } = rig();
  r.push({ ...K, text: HTML, final: false });
  clock.jump(10000);
  assert.equal(out.at(-1).text, HTML);
});
test('drop stops the key; destroy leaves no timer', () => {
  const { r, clock, out } = rig();
  r.push({ ...K, text: HTML, final: false }); const n = out.length;
  r.drop('k'); clock.tick(5000);
  assert.equal(out.length, n);
  r.push({ ...K, text: HTML, final: false }); r.destroy();
  assert.equal(clock.pending(), 0);
});
test('a `>` inside a quoted attribute value or a comment ends nothing, so no cut falls there', () => {
  const s = `<a title="x>y" href='a>b' data-k = "c>d">link</a><!-- a > b --><p>x</p>`;
  const after = (t) => s.indexOf(t) + t.length;
  assert.deepEqual(cutPoints(s, 0), [after('"c>d">'), after('</a>'), after('-->'), after('<p>'), s.length]);
  const tag = '<p class="a b c d e f g h i j k l m n o p">';
  assert.deepEqual(cutPoints(tag, 0), [tag.length], 'a space inside a tag is never a cut');
  const p = '<p class="x y">abc</p>';
  assert.deepEqual(cutPoints(p, 12), [p.indexOf('abc'), p.length], 'a cut list from inside a tag starts at its end');
});
test('the end of the text is always a cut, mid-run or mid-tag too', () => {
  assert.deepEqual(cutPoints('<p>abc', 0), [3, 6]);
  assert.deepEqual(cutPoints('<p>abc</p><a hr', 0), [3, 10, 15]);
  assert.deepEqual(cutPoints('<p>abc', 6), []);
});
test('a steady stream keeps the burst\'s start: the first text is whole by 3 s, steps stay 125 ms apart, no timer is left', () => {
  const { r, clock, out } = rig();
  for (let t = 0; t < 3000; t += 100) {
    r.push({ ...K, text: `${HTML}${'<i>x</i>'.repeat(t / 100)}`, final: false });
    clock.tick(100);
  }
  assert.ok(out.some((o) => o.at <= 3000 && o.text.length >= HTML.length), 'the text that arrived at 0 is whole by 3000');
  for (let i = 1; i < out.length; i++) assert.ok(out[i].at - out[i - 1].at >= 125, `${out[i - 1].at} → ${out[i].at}`);
  clock.tick(3000);
  assert.deepEqual([out.at(-1).text.length, clock.pending()], [HTML.length + 29 * 8, 0]);
});
test('an Edit mid-burst re-steps from the edit (shown is the common prefix), but never shows less than was shown', () => {
  const { r, clock, out } = rig();
  r.flush({ ...K, text: HTML, final: false });
  r.push({ ...K, text: `${HTML}${HTML}`, final: false });
  const was = out.at(-1).text.length;
  assert.ok(was > HTML.length);
  const edited = `<section>X${HTML.slice(9)}${HTML}`;
  r.push({ ...K, text: edited, final: false });
  clock.tick(125);
  assert.ok(edited.startsWith(out.at(-1).text), 'the next step follows the edited text');
  assert.ok(out.at(-1).text.length >= was, `${out.at(-1).text.length} < ${was}`);
  clock.tick(3000);
  assert.equal(out.at(-1).text, edited);
});
test('an Edit to a written section (P2: a delete splice, then the insert) re-paces only the growth (review M3)', () => {
  const { r, clock, out } = rig();
  r.push({ ...K, text: HTML, final: false }); clock.tick(3000);
  assert.equal(out.at(-1).text, HTML);
  const n = out.length;
  const at = HTML.indexOf('word');
  const cut = HTML.slice(0, at) + HTML.slice(at + 4);
  const edited = `${HTML.slice(0, at)}phrase${HTML.slice(at + 4)}`;
  r.push({ ...K, text: cut, final: false });
  r.push({ ...K, text: edited, final: false });
  for (let t = 0; t < 3000; t += 125) clock.tick(125);
  const steps = out.slice(n);
  assert.equal(steps.at(-1).text, edited);
  assert.equal(steps[0].text, cut, 'the delete is shown at once');
  for (const o of steps) assert.ok(o.text.length >= HTML.length - 4, `a step showed ${o.text.length} of ${HTML.length}`);
  assert.ok(steps.slice(1).every((o) => edited.startsWith(o.text) && !/<[^>]*$/.test(o.text)), 'true prefixes, never cut inside a tag');
  assert.ok(steps.length <= 3, `${steps.length} steps: only the 2 inserted characters re-type`);
});
test('a flush always sends the whole text, unchanged too (a new build doc needs it); revs keep rising after a drop', () => {
  const { r, out } = rig();
  r.flush({ ...K, text: '<p>a</p>', final: true });
  r.flush({ ...K, text: '<p>a</p>', final: true });
  assert.deepEqual(out.map((o) => [o.rev, o.text, o.final]), [[1, '<p>a</p>', true], [2, '<p>a</p>', true]]);
  r.drop('k');
  r.flush({ ...K, text: '<p>b</p>', final: false });
  assert.equal(out.at(-1).rev, 3);
  assert.equal(r.shown('k'), '<p>b</p>');
});
test('a clear mid-burst shows empty at once and leaves no timer', () => {
  const { r, clock, out } = rig();
  r.push({ ...K, text: HTML, final: false }); clock.tick(200);
  r.push({ ...K, text: '', final: false });
  assert.deepEqual([out.at(-1).text, out.at(-1).at, clock.pending()], ['', 200, 0]);
});
test('after destroy nothing is sent and no timer is set', () => {
  const { r, clock, out } = rig();
  r.destroy();
  r.push({ ...K, text: HTML, final: false }); r.flush({ ...K, text: HTML, final: false }); r.finalize('k');
  assert.deepEqual([out.length, clock.pending()], [0, 0]);
});
