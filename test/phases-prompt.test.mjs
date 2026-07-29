import test from 'node:test';
import assert from 'node:assert/strict';
import { taskHeader, buildClarifyPrompt } from '../src/core/phases.mjs'; // now exported

const base = { projectDir: '/p', pipelineDir: '/pipe', taskPrompt: 'BUILD THE THING' };

test('userPrompt consumer gets the raw request block', () => {
  const h = taskHeader({ ...base, node: { key: 'planner' }, inputs: { userPrompt: { text: 'BUILD THE THING' } } }, 'Plan');
  assert.match(h, /## Original request/);
  assert.match(h, /BUILD THE THING/);
});

test('refiner & reviewer keep the request block even though they do not consume userPrompt', () => {
  for (const key of ['refiner', 'reviewer']) {
    const h = taskHeader({ ...base, node: { key }, inputs: { plan: { path: '/x.md' } } }, key);
    assert.match(h, /## Original request/, `${key} keeps request`);
  }
});

test('implementer/checklist/web-ui omit the request block', () => {
  for (const key of ['implementer', 'manualTestsChecklist', 'manualWebUiTesting']) {
    const h = taskHeader({ ...base, node: { key }, inputs: { plan: { path: '/x.md' } } }, key);
    assert.doesNotMatch(h, /## Original request/, `${key} omits request`);
    assert.match(h, /## Upstream input/);
    assert.doesNotMatch(h, /BUILD THE THING/, `${key} must not leak the prompt`);
  }
});

test('clarify pre-step (no inputs) still gets the prompt', () => {
  const h = taskHeader({ ...base }, 'Clarify'); // ctx.inputs === undefined, ctx.node === undefined
  assert.match(h, /## Original request/);
});

test('entry node (isEntry) gets the request block regardless of role', () => {
  for (const key of ['implementer', 'manualWebUiTesting']) {
    const h = taskHeader({ ...base, isEntry: true, node: { key }, inputs: { plan: { path: '/x.md' } } }, key);
    assert.match(h, /## Original request/, `${key} entry gets request`);
    assert.match(h, /BUILD THE THING/);
  }
});

test('entry node lists attached files', () => {
  const h = taskHeader(
    { ...base, isEntry: true, node: { key: 'implementer' }, inputs: { plan: { path: '/x.md' } },
      extras: [{ name: 'spec.md', path: '/pipe/extras/spec.md' }] },
    'Implement',
  );
  assert.match(h, /## Attached files/);
  assert.match(h, /\/pipe\/extras\/spec\.md/);
});

test('entry node with no attachments omits the attachments section', () => {
  const h = taskHeader({ ...base, isEntry: true, node: { key: 'implementer' }, inputs: { plan: { path: '/x.md' } } }, 'Implement');
  assert.match(h, /## Original request/);
  assert.doesNotMatch(h, /## Attached files/);
});

test('non-entry node still omits the request block (no isEntry)', () => {
  const h = taskHeader({ ...base, node: { key: 'implementer' }, inputs: { plan: { path: '/x.md' } } }, 'Implement');
  assert.doesNotMatch(h, /## Original request/);
});

test('buildClarifyPrompt advertises the new limits (up to 8, 2–4 options)', () => {
  const h = buildClarifyPrompt({ ...base });
  assert.match(h, /2 to 4 options/i);
  assert.match(h, /up to 8/i);
  assert.doesNotMatch(h, /exactly three options/i);
});
