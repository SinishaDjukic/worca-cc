// test/shape-route.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeGuess, routeLabel, isQuestion, routeCardVerb, changesCardVerb } from '../src/shared/shape/route.mjs';

const F = { title: 'Charts', slices: [
  { index: 1, state: 'done', title: 'Store chart data', goal: '' },
  { index: 2, state: 'running', title: 'Runs list', goal: '' },
  { index: 3, state: 'planned', title: 'Chart legend', goal: 'Show a legend under every chart' }] };

test('a fix word guesses Own run now', () => {
  assert.deepEqual(routeGuess('hotfix: login is broken', F), { choice: 'own', where: null, reason: 'reads like a fix that should not wait for Charts' });
});
test('a word an upcoming run touches guesses Add to its plan, with the run named', () => {
  assert.deepEqual(routeGuess('make the legend smaller', F), { choice: 'add', where: 'next', reason: 'touches "legend", which run 3 changes' });
});
test('runs still to go, no overlap → Add to the next run\'s plan', () => {
  assert.equal(routeGuess('also export a PNG', F).reason, 'Run 3 has not started yet: its plan can take it');
});
test('nothing left to plan → Save for later', () => {
  const done = { ...F, slices: F.slices.map((s) => ({ ...s, state: 'done' })) };
  assert.deepEqual(routeGuess('also export a PNG', done), { choice: 'save', where: null, reason: 'nothing in Charts is still to plan' });
});
test('the primary label names the choice', () => {
  assert.equal(routeLabel('add', 'Charts'), 'Add to Charts');
  assert.equal(routeLabel('own', 'Charts'), 'Own run now');
  assert.equal(routeLabel('save', 'Charts'), 'Save for later');
});
test('questions are told apart from statements', () => {
  for (const q of ['why did the build fail?', 'What changed in run 2', 'can you explain the legend']) assert.equal(isQuestion(q), true, q);
  for (const s of ['make the legend smaller', 'also export a PNG', 'hotfix: login is broken']) assert.equal(isQuestion(s), false, s);
});
test('route verbs: the card type decides', () => {
  assert.deepEqual(routeCardVerb({ verb: 'add', where: 'extra' }), { ok: true, verb: 'add', where: 'extra' });
  assert.equal(routeCardVerb({ verb: 'ship-one' }).ok, false);
  assert.equal(routeCardVerb({ verb: 'add', where: 'sideways' }).ok, false);
  assert.deepEqual(changesCardVerb({ verb: 'start' }), { ok: true, verb: 'start' });
  assert.equal(changesCardVerb({ state: 'declined' }).ok, false);
});
