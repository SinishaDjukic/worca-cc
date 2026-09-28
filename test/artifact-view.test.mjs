// test/artifact-view.test.mjs — the PURE, node-testable parts of the artifact
// viewers. The marked/DOMPurify/hljs render path is browser-only (jsdom UI
// harness); here we only assert viewerKindFor, escapeHtml and artifactsByNodeCycle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewerKindFor, escapeHtml, artifactsByNodeCycle } from '../ui/public/artifact-view.mjs';

test('viewerKindFor maps kind/relPath to a viewer', () => {
  assert.equal(viewerKindFor('plan', 'plans/plan.md'), 'markdown');
  assert.equal(viewerKindFor('review', 'reviews/r.md'), 'markdown');
  assert.equal(viewerKindFor('result', 'result.patch'), 'diff');
  assert.equal(viewerKindFor('result', 'x.diff'), 'diff');
  assert.equal(viewerKindFor('questions', 'questions.json'), 'json');
  assert.equal(viewerKindFor('extra', 'notes.txt'), 'text');
  // An explicit extension wins over the generic kind fallback.
  assert.equal(viewerKindFor('result', 'verdict.json'), 'json');
  assert.equal(viewerKindFor('plan', 'plan.txt'), 'markdown');
  assert.equal(viewerKindFor('result', 'result'), 'diff');
});

test('escapeHtml escapes the five metacharacters', () => {
  assert.equal(escapeHtml(`<a & "b" 'c'>`), '&lt;a &amp; &quot;b&quot; &#39;c&#39;&gt;');
});

test('artifactsByNodeCycle groups by nodeId then cycle, null -> run bucket', () => {
  const groups = artifactsByNodeCycle([
    { nodeId: 'planner', cycle: 0, relPath: 'plan.md' },
    { nodeId: 'planner', cycle: 1, relPath: 'plan-v2.md' },
    { nodeId: 'planner', cycle: 0, relPath: 'extra.md' },
    { nodeId: null, cycle: null, relPath: 'prompt.md' },
  ]);
  assert.deepEqual([...groups.keys()], ['planner', '__run__']);
  assert.equal(groups.get('planner').get(0).length, 2);
  assert.equal(groups.get('planner').get(1).length, 1);
  assert.equal(groups.get('__run__').get(0).length, 1);
  assert.equal(groups.get('__run__').get(0)[0].relPath, 'prompt.md');
});
