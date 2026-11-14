// test/ask-model-shared.test.mjs — dev's thread reducer has one copy, in src/shared/ (Stillhet's live chat imports it there).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as shared from '../src/shared/ask-model.mjs';
import * as dev from '../ui/public/ask-model.mjs';

test('ui/public/ask-model.mjs re-exports the shared createThreadModel, nothing else', () => {
  assert.equal(dev.createThreadModel, shared.createThreadModel);
  assert.deepEqual(Object.keys(dev).sort(), Object.keys(shared).sort());
});
