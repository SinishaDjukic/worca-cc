// Watch PR live test (PR #659): the base branch was broken here on purpose; this commit fixes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('watch probe: fixed on the base', () => assert.ok(true));
