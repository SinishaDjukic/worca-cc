// test/shape-route.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTE_CHOICES, routeLabel, routeCardVerb, changesCardVerb } from '../src/shared/shape/route.mjs';

test('ROUTE_CHOICES are the three Route options, in card order', () => {
  assert.deepEqual([...ROUTE_CHOICES], ['add', 'own', 'save']);
});
test('the primary label names the choice', () => {
  assert.equal(routeLabel('add', 'Charts'), 'Add to Charts');
  assert.equal(routeLabel('own', 'Charts'), 'Own run now');
  assert.equal(routeLabel('save', 'Charts'), 'Save for later');
});
test('route verbs: the card type decides', () => {
  assert.deepEqual(routeCardVerb({ verb: 'add', where: 'extra' }), { ok: true, verb: 'add', where: 'extra' });
  assert.equal(routeCardVerb({ verb: 'ship-one' }).ok, false);
  assert.equal(routeCardVerb({ verb: 'add', where: 'sideways' }).ok, false);
  assert.deepEqual(changesCardVerb({ verb: 'start' }), { ok: true, verb: 'start' });
  assert.equal(changesCardVerb({ state: 'declined' }).ok, false);
});
