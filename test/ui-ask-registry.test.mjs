// test/ui-ask-registry.test.mjs — the ask renderer registry (ask-forms design §6,
// D6): the pure module. That app.js's renderQpanel dispatches through it is pinned
// where the panels render: test/ui-question.test.mjs (clarify) and
// test/ui-running-detail.test.mjs (gate, recovery).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerAskRenderer, askRendererFor, askKindOf } from '../ui/public/ask/registry.mjs';

// ---------------------------------------------------------------- pure module

test('askKindOf reproduces the legacy ladder, including the issues-array arm', () => {
  assert.equal(askKindOf(null), null);
  assert.equal(askKindOf({ kind: 'workflow', issues: [] }), 'workflow');
  assert.equal(askKindOf({ kind: 'recovery' }), 'recovery');
  assert.equal(askKindOf({ kind: 'form', form: 'f', version: 1, askId: 'a_1', surface: 'any' }), 'form');
  assert.equal(askKindOf({ kind: 'gate' }), 'gate');
  assert.equal(askKindOf({ issues: [{ title: 'x' }] }), 'gate', 'a bare issues array is still a gate');
  assert.equal(askKindOf({ kind: 'questions' }), 'clarify');
  assert.equal(askKindOf({ kind: 'clarify' }), 'clarify');
  assert.equal(askKindOf({}), 'clarify');
});

test('askKindOf routes a plan ask to the plan renderer, not the clarify catch-all', () => {
  assert.equal(askKindOf({ kind: 'plan' }), 'plan');
  assert.equal(askKindOf({ kind: 'plan', issues: [] }), 'plan', 'plan wins over the issues-array gate arm');
});

test('register/lookup: last wins, missing members are filled, junk is ignored', () => {
  registerAskRenderer('zz-probe', { render: () => 'first' });
  registerAskRenderer('zz-probe', { render: () => 'second' });
  const r = askRendererFor('zz-probe');
  assert.equal(r.render(), 'second');
  assert.equal(r.collect(null), null, 'collect defaults to null');
  assert.equal(r.title({}, {}), '');
  assert.equal(r.count({}, {}), null);
  assert.equal(r.setErrors(null, []), undefined);
  registerAskRenderer('', { render: () => {} });
  assert.equal(askRendererFor(''), null);
  registerAskRenderer('zz-bad', { collect: () => {} });
  assert.equal(askRendererFor('zz-bad'), null, 'no render function, no registration');
  assert.equal(askRendererFor('nope'), null);
});
