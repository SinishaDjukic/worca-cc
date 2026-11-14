// test/design-system-design-switch.test.mjs — the Stillhet UI switch in the top bar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { designSwitch } from '../ui/public/design-system/components/index.mjs';

const sw = (o) => { const d = new JSDOM(`<body>${designSwitch(o)}</body>`).window.document; return { d, b: d.querySelector('[role="switch"]') }; };

test('designSwitch: a switch labelled Stillhet UI with a beta chip', () => {
  for (const on of [true, false]) assert.equal(sw({ on }).b.getAttribute('aria-checked'), String(on));
  const { d, b } = sw({ on: false });
  assert.equal(b.getAttribute('aria-label'), 'Stillhet UI');
  assert.equal(d.querySelector('[data-stillhet="design-switch"]').className, 'rl-design-switch');
  assert.match(d.body.textContent, /Stillhet UI.*beta/);
  assert.equal(b.disabled, false);
});

test('designSwitch: busy sets aria-busy and disables; locked disables and says why', () => {
  const busy = sw({ on: true, busy: true }).b;
  assert.equal(busy.getAttribute('aria-busy'), 'true'); assert.equal(busy.disabled, true);
  const { d, b } = sw({ on: true, locked: true });
  assert.equal(b.disabled, true);
  assert.equal(b.title, 'Locked by WORCA_FLAGS');
  assert.equal(d.getElementById(b.getAttribute('aria-describedby')).textContent, 'Locked by WORCA_FLAGS');
});
