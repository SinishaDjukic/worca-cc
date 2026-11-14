// test/design-system-invitation.test.mjs — the Invitation is a ConfirmStrip with Stillhet's words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { stillhetInvitation, confirmStrip } from '../ui/public/design-system/components/index.mjs';

const U = 'https://github.com/o/r/issues';
const doc = (o) => new JSDOM(`<body>${stillhetInvitation({ bugsUrl: U, ...o })}</body>`).window.document;

test('stillhetInvitation: the strip, its hooks, link and buttons', () => {
  const d = doc({});
  assert.equal(d.querySelectorAll('.rc-confirm').length, 1);
  const s = d.querySelector('.rc-confirm');
  assert.equal(s.getAttribute('role'), 'alertdialog');
  assert.equal(s.dataset.stillhet, 'invitation');
  assert.equal(s.dataset.esc, 'back');
  assert.match(s.textContent, /^Stillhet is an evolution of Worca's design system, in beta: calm, only what needs you is lit, and Chat comes first\. Try it while it is shaped, and/);
  const a = d.querySelector('a.dc-link');
  assert.equal(a.textContent, 'Report bugs on GitHub');
  assert.equal(a.getAttribute('href'), U);
  assert.deepEqual([...d.querySelectorAll('button')].map((b) => b.textContent), ['Try Stillhet', 'No thanks']);
  assert.equal(d.querySelectorAll('dialog, .rl-dialog, .scrim').length, 0);
});

test('stillhetInvitation adds no markup of its own', () => {
  assert.equal(stillhetInvitation({ bugsUrl: U }), confirmStrip({
    text: "Stillhet is an evolution of Worca's design system, in beta: calm, only what needs you is lit, and Chat comes first. Try it while it is shaped, and",
    yes: 'Try Stillhet', no: 'No thanks', busy: '', noBusy: '', err: null, back: true,
    link: { label: 'Report bugs on GitHub', href: U }, id: 'stillhet-strip-t', attrs: { 'data-stillhet': 'invitation' },
  }));
});

test('busy states', () => {
  let b = [...doc({ busy: 'yes' }).querySelectorAll('button')];
  assert.equal(b[0].textContent, 'Turning on…'); assert.equal(b[0].disabled, true);
  b = [...doc({ busy: 'no' }).querySelectorAll('button')];
  assert.equal(b[1].textContent, 'Saving…'); assert.ok(b.every((x) => x.disabled));
});

test('failed states name the reason and escape it', () => {
  let d = doc({ err: { title: 'Stillhet could not be turned on', detail: '<b>x</b>', from: 'yes' } });
  assert.match(d.body.textContent, /Stillhet could not be turned on<b>x<\/b>/);
  assert.equal(d.querySelector('b'), null);
  assert.deepEqual([...d.querySelectorAll('button')].map((x) => x.textContent), ['Try again', 'No thanks']);
  d = doc({ err: { title: 'Your answer could not be saved', detail: 'disk', from: 'no' } });
  assert.deepEqual([...d.querySelectorAll('button')].map((x) => x.textContent), ['Try again', 'Not now']);
});

test('a non-https issues URL renders no link', () => {
  assert.equal(doc({ bugsUrl: 'http://x.test' }).querySelectorAll('a').length, 0);
});
