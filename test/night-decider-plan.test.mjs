// test/night-decider-plan.test.mjs — Away mode never decides a plan approval (shape-it-first D2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAsk } from '../src/core/night/decider.mjs';
import { NIGHT_DEFAULTS } from '../src/core/night/config.mjs';

test('a plan ask is never decided: it always waits for a person', async () => {
  assert.equal(await decideAsk({ kind: 'plan', id: 'plan-x-1' }, { config: NIGHT_DEFAULTS }), null);
});
