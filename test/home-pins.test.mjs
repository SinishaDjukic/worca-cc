// test/home-pins.test.mjs — the Chat home's pinned workflow list (src/shared/home-pins.mjs), pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_HOME_PINS, SHAPER_PIN_ID, HOME_PINS_MAX, normalizePins, storedPins, isPinned,
  pinWorkflow, unpinWorkflow, visiblePins, splitPins,
} from '../src/shared/home-pins.mjs';

const WF = [{ id: 'wf_default', name: 'Default' }, { id: 'wf_pay', name: 'Payroll close' }, { id: 'wf_post', name: 'Social post' }];

test('default pin: never set = Shaper; a stored [] stays empty (unpinning Shaper sticks)', () => {
  assert.deepEqual([...DEFAULT_HOME_PINS], ['wf_shape']);
  assert.deepEqual(storedPins(undefined), ['wf_shape']);
  assert.deepEqual(storedPins([]), []);
  assert.deepEqual(storedPins(['wf_pay', 'wf_pay', ' wf_post ']), ['wf_pay', 'wf_post']);
});

test('add appends in pin order, never twice; remove keeps the order of the rest', () => {
  let pins = pinWorkflow(['wf_shape'], 'wf_pay');
  pins = pinWorkflow(pins, 'wf_post');
  assert.deepEqual(pins, ['wf_shape', 'wf_pay', 'wf_post']);
  assert.deepEqual(pinWorkflow(pins, 'wf_pay'), pins, 'already pinned: unchanged');
  assert.deepEqual(unpinWorkflow(pins, 'wf_shape'), ['wf_pay', 'wf_post']);
  assert.deepEqual(unpinWorkflow(pins, 'wf_none'), pins);
  assert.equal(isPinned(pins, 'wf_post'), true);
  assert.equal(isPinned(null, 'wf_post'), false);
});

test('normalizePins rejects a non-list, a non-string id and more than the cap', () => {
  assert.deepEqual(normalizePins('wf_pay').errors, ['pins must be a list of workflow ids']);
  assert.deepEqual(normalizePins([42]).errors, ['each pin must be a workflow id']);
  const many = Array.from({ length: HOME_PINS_MAX + 1 }, (_, i) => `wf_${i}`);
  assert.deepEqual(normalizePins(many).errors, [`at most ${HOME_PINS_MAX} pins`]);
  assert.equal(pinWorkflow(many.slice(0, HOME_PINS_MAX), 'wf_x').length, HOME_PINS_MAX, 'a full list refuses a new pin');
});

test('a deleted workflow simply does not show; order follows the pins, not the list', () => {
  const v = visiblePins({ pins: ['wf_gone', 'wf_post', 'wf_pay'], workflows: WF, flags: {} });
  assert.deepEqual(v.map((p) => p.id), ['wf_post', 'wf_pay']);
  assert.deepEqual(v[0], { id: 'wf_post', name: 'Social post', shaper: false });
});

test('Shaper shows only while its flag is on — listed or not — and other pins need the list', () => {
  assert.deepEqual(visiblePins({ pins: [SHAPER_PIN_ID], workflows: WF, flags: { shapeFirst: false } }), []);
  assert.deepEqual(visiblePins({ pins: [SHAPER_PIN_ID], workflows: null, flags: { shapeFirst: true } }),
    [{ id: 'wf_shape', name: 'Shaper', shaper: true }]);
  assert.deepEqual(visiblePins({ pins: ['wf_pay'], workflows: null, flags: { shapeFirst: true } }), [], 'list not loaded yet');
});

test('splitPins: one inline slot, the rest overflow in order', () => {
  const v = visiblePins({ pins: ['wf_shape', 'wf_pay', 'wf_post'], workflows: WF, flags: { shapeFirst: true } });
  const { inline, overflow } = splitPins(v);
  assert.deepEqual(inline.map((p) => p.id), ['wf_shape']);
  assert.deepEqual(overflow.map((p) => p.id), ['wf_pay', 'wf_post']);
  assert.deepEqual(splitPins([]), { inline: [], overflow: [] });
});
