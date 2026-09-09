// test/artifact-view.test.mjs — the PURE, node-testable parts of the artifact
// viewers. The marked/DOMPurify/hljs render path is browser-only (jsdom UI
// harness); here we only assert viewerKindFor and artifactsByNodeCycle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewerKindFor, artifactsByNodeCycle, renderDiff } from '../ui/public/artifact-view.mjs';
import { KIND_BY_EXT, BINARY_KINDS } from '../src/shared/artifact-kinds.mjs';

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
  // Binary kinds never reach a text viewer, whatever the extension says (D11).
  assert.equal(viewerKindFor('image', 'steps/n_webui-c1/screenshots/one.png'), 'binary');
  assert.equal(viewerKindFor('binary', 'steps/n_x-c1/bundle.zip'), 'binary');
  assert.equal(viewerKindFor('binary', 'looks-like.md'), 'binary', 'the kind wins over the extension');
  // The scan's format kinds map straight to their viewers.
  assert.equal(viewerKindFor('markdown', 'steps/n_impl-c1/DEVIATIONS.md'), 'markdown');
  assert.equal(viewerKindFor('verdict', 'steps/n_review-c1/impl-review-cycle1.json'), 'json');
  assert.equal(viewerKindFor('combine', 'steps/n_comb-c1/combine.md'), 'markdown');
  assert.equal(viewerKindFor('text', 'steps/n_impl-c1/notes/scratch.txt'), 'text');
  // The scan's format kinds win over an unknown/odd extension, and a binary
  // extension under any kind never reaches a text viewer (the route answers 415).
  assert.equal(viewerKindFor('markdown', 'steps/n_impl-c1/NOTES.markdown'), 'markdown');
  assert.equal(viewerKindFor('json', 'steps/n_x-c1/verdict'), 'json');
  assert.equal(viewerKindFor('diff', 'steps/n_x-c1/changes'), 'diff');
  assert.equal(viewerKindFor('extra', 'extras/shot.png'), 'binary');
  assert.equal(viewerKindFor('notes', 'steps/n_x-c1/report.pdf'), 'binary');
  assert.equal(viewerKindFor('text', 'steps/n_x-c1/no-ext'), 'text');
  // The viewer's binary set is DERIVED from the shared table the read route
  // refuses by, so every image/binary extension there is binary here too.
  for (const [ext, kind] of Object.entries(KIND_BY_EXT)) {
    if (BINARY_KINDS.has(kind)) assert.equal(viewerKindFor('text', `steps/n_x-c1/f.${ext}`), 'binary', ext);
  }
});

test('renderDiff: `--- `/`+++ ` are headers only outside a hunk (a `diff ` line closes it); inside one, `--- note` + `+++ counter` are content', () => {
  // A minimal DOM: only the members renderDiff touches.
  const el = (tag) => ({ tag, className: '', textContent: '', children: [], appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; } });
  const mount = { ownerDocument: { createElement: el }, replaceChildren(...c) { this.children = c; } };
  const text = [
    '--- a', '+++ b', '@@ -1 +1 @@', '-- note', '--- note', '+++ counter', // inside the hunk: content, even as a pair
    'diff --git a/c b/d', '--- c', '+++ d', '@@ -1 +1 @@', '+x',          // second file: `diff ` closes the hunk
  ].join('\n');
  const pre = renderDiff(text, mount);
  const classes = pre.children.map((r) => r.className.replace('artifact-diff-line', '').trim());
  assert.deepEqual(classes, ['meta', 'meta', 'hunk', 'del', 'del', 'add', 'meta', 'meta', 'meta', 'hunk', 'add']);
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
