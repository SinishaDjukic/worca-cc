// Watch PR live test (PR #659): the base branch is broken here on purpose; the next base commit removes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('watch probe: broken on the base on purpose', () => assert.fail('the test base branch is broken here on purpose'));
