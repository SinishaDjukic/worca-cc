// test/ui-switch.test.mjs — ui/public/switch.mjs: the checkbox driver of the one switch (docs/design-system.md › Switch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { makeSwitch } from '../ui/public/switch.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

test('makeSwitch: a label row holding input.sw-input[role=switch], then span.switch, then the label', () => {
  const { row, input } = makeSwitch(doc, { label: 'Fan-out', checked: true, inputClass: 'step-fanout', rowClass: 'fanout-toggle', data: { nodeId: 'n0' } });
  assert.equal(row.tagName, 'LABEL');
  assert.equal(row.className, 'switch-row fanout-toggle');
  assert.equal(input.type, 'checkbox');
  assert.equal(input.className, 'sw-input step-fanout');
  assert.equal(input.getAttribute('role'), 'switch');
  assert.equal(input.checked, true);
  assert.equal(input.dataset.nodeId, 'n0');
  assert.equal(input.nextElementSibling.className, 'switch');
  assert.equal(input.nextElementSibling.getAttribute('aria-hidden'), 'true');
  assert.equal(row.querySelector('.switch-label').textContent, 'Fan-out');
  assert.equal(row.textContent.trim(), 'Fan-out', 'the empty reason line adds no text');
});

test('makeSwitch: locked disables the input, marks it data-locked and shows the reason as text and tooltip', () => {
  const s = makeSwitch(doc, { label: 'Questions', locked: 'Always on for this agent', checked: true });
  assert.equal(s.input.disabled, true);
  assert.equal(s.input.dataset.locked, '1');
  const why = s.row.querySelector('.switch-why');
  assert.equal(why.hidden, false);
  assert.equal(why.textContent, 'Always on for this agent');
  assert.equal(s.row.title, 'Always on for this agent');
  s.setLocked(null);
  assert.equal(s.input.disabled, false);
  assert.equal('locked' in s.input.dataset, false);
  assert.equal(why.hidden, true);
  assert.equal(s.row.hasAttribute('title'), false);
});

test('makeSwitch: no visible label names the input through aria-label', () => {
  const { row, input } = makeSwitch(doc, { ariaLabel: 'Mandatory', inputClass: 'tag-dim-required' });
  assert.equal(input.getAttribute('aria-label'), 'Mandatory');
  assert.equal(row.querySelector('.switch-label'), null);
});


test('index.html: every static switch track sits inside a label whose control is its own input, so a click on the track toggles it', () => {
  const page = new JSDOM(readFileSync(new URL('../ui/public/index.html', import.meta.url), 'utf8')).window.document;
  const inputs = [...page.querySelectorAll('input.sw-input')];
  assert.ok(inputs.length > 10, 'the page has its switches');
  const unreachable = inputs.filter((i) => {
    const track = i.nextElementSibling;
    return !track?.classList.contains('switch') || ![...i.labels].some((l) => l.contains(track));
  }).map((i) => i.id || i.className);
  assert.deepEqual(unreachable, [], 'a label without for= names its FIRST labelable child (an info-tip button wins), and .sw-input takes no pointer events');
});
