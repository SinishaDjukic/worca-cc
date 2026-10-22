import test from 'node:test';
import assert from 'node:assert/strict';
import { pickNamingModel, estimateNamingUsd } from '../src/core/naming.mjs';

const CLAUDE = { kind: 'signin', engine: 'claude' };
const row = (id, extra = {}) => ({ id, label: id, efforts: ['low', 'medium', 'high'], engine: 'claude', connection: CLAUDE, harnesses: ['claude'], ...extra });

test('the cheapest ready Claude model, at its lowest listed effort', () => {
  const rows = [row('claude-opus-5-5'), row('claude-haiku-5-5', { efforts: ['minimal', 'low'] }), row('claude-sonnet-5-5')];
  assert.deepEqual(pickNamingModel(rows, () => null), { model: 'claude-haiku-5-5', effort: 'minimal' });
});
test('a model that needs sign-in or is free is skipped', () => {
  const rows = [row('claude-haiku-5-5', { needsSignIn: true }), row('free-one'), row('claude-sonnet-5-5')];
  const costOf = (id) => (id === 'free-one' ? { free: true } : null);
  assert.equal(pickNamingModel(rows, costOf).model, 'claude-sonnet-5-5');
});
test('nothing qualifies: null', () => {
  assert.equal(pickNamingModel([], () => null), null);
  assert.equal(pickNamingModel([row('claude-haiku-5-5', { needsSignIn: true })], () => null), null);
});
test('estimateNamingUsd prices about 300 tokens in and 30 out; null when unpriced', () => {
  const rows = [row('claude-haiku-5-5')];
  assert.ok(Math.abs(estimateNamingUsd({ model: 'claude-haiku-5-5' }, rows) - (300 * 0.1 + 30 * 0.5) / 1e6) < 1e-12);
  assert.equal(estimateNamingUsd({ model: 'nope' }, rows), null);
  assert.equal(estimateNamingUsd(null, rows), null);
});
