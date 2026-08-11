import test from 'node:test';
import assert from 'node:assert/strict';
import { taskHeader } from '../src/core/phases.mjs';

const base = { projectDir: '/p', pipelineDir: '/pipe', taskPrompt: 'BUILD THE THING' };

test('entry node gets the raw request block', () => {
  const h = taskHeader({ ...base, isEntry: true, node: { key: 'planner' } }, 'Plan');
  assert.match(h, /## Original request/);
  assert.match(h, /BUILD THE THING/);
});

test('the request gate is isEntry alone — no agent key is special-cased', () => {
  // v1 named refiner|reviewer|planReviewer here; v2 decides upstream (task-wired
  // binding or `wantsRequest`) and hands the answer down as isEntry, so the same
  // keys with isEntry unset must fall through to the upstream-input block.
  for (const key of ['refiner', 'reviewer', 'planReviewer']) {
    const h = taskHeader({ ...base, node: { key } }, key);
    assert.doesNotMatch(h, /## Original request/, `${key} is not special-cased`);
    assert.match(h, /## Upstream input/, `${key} reads its upstream artifacts`);
    assert.doesNotMatch(h, /BUILD THE THING/, `${key} must not leak the prompt`);
  }
});

test('non-entry nodes omit the request block', () => {
  for (const key of ['implementer', 'manualTestsChecklist', 'manualWebUiTesting']) {
    const h = taskHeader({ ...base, node: { key } }, key);
    assert.doesNotMatch(h, /## Original request/, `${key} omits request`);
    assert.match(h, /## Upstream input/);
    assert.doesNotMatch(h, /BUILD THE THING/, `${key} must not leak the prompt`);
  }
});

test('entry node (isEntry) gets the request block regardless of role', () => {
  for (const key of ['implementer', 'manualWebUiTesting']) {
    const h = taskHeader({ ...base, isEntry: true, node: { key } }, key);
    assert.match(h, /## Original request/, `${key} entry gets request`);
    assert.match(h, /BUILD THE THING/);
  }
});

test('a header with no node at all still renders off isEntry', () => {
  assert.match(taskHeader({ ...base, isEntry: true }, 'Clarify'), /## Original request/);
  assert.match(taskHeader({ ...base }, 'Clarify'), /## Upstream input/);
});

test('entry node lists attached files', () => {
  const h = taskHeader(
    { ...base, isEntry: true, node: { key: 'implementer' },
      extras: [{ name: 'spec.md', path: '/pipe/extras/spec.md' }] },
    'Implement',
  );
  assert.match(h, /## Attached files/);
  assert.match(h, /\/pipe\/extras\/spec\.md/);
});

test('entry node with no attachments omits the attachments section', () => {
  const h = taskHeader({ ...base, isEntry: true, node: { key: 'implementer' } }, 'Implement');
  assert.match(h, /## Original request/);
  assert.doesNotMatch(h, /## Attached files/);
});

test('a non-entry node never renders attachments', () => {
  const h = taskHeader(
    { ...base, node: { key: 'implementer' }, extras: [{ name: 'spec.md', path: '/pipe/extras/spec.md' }] },
    'Implement',
  );
  assert.doesNotMatch(h, /## Attached files/);
  assert.doesNotMatch(h, /spec\.md/);
});
