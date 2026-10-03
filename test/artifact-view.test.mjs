// test/artifact-view.test.mjs — the PURE, node-testable parts of the artifact
// viewers. The marked/DOMPurify/hljs render path is browser-only (jsdom UI
// harness); here we only assert viewerKindFor and artifactsByNodeStep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewerKindFor, artifactsByNodeStep, renderDiff } from '../ui/public/artifact-view.mjs';
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

test('artifactsByNodeStep groups by nodeId then EXECUTION, null -> run bucket', () => {
  const groups = artifactsByNodeStep([
    { nodeId: 'planner', stepKey: 'x:planner:1', cycle: 1, relPath: 'plan.md' },
    { nodeId: 'planner', stepKey: 'x:planner:2', cycle: 2, relPath: 'plan-v2.md' },
    { nodeId: 'planner', stepKey: 'x:planner:1', cycle: 1, relPath: 'extra.md' },
    { nodeId: null, stepKey: null, cycle: null, relPath: 'prompt.md' },
  ]);
  assert.deepEqual([...groups.keys()], ['planner', '__run__']);
  assert.deepEqual([...groups.get('planner').keys()], ['x:planner:1', 'x:planner:2']);
  assert.equal(groups.get('planner').get('x:planner:1').artifacts.length, 2);
  assert.equal(groups.get('planner').get('x:planner:1').cycle, 1);
  assert.equal(groups.get('planner').get('x:planner:2').artifacts.length, 1);
  const run = groups.get('__run__').get('c0');
  assert.equal(run.artifacts.length, 1);
  assert.equal(run.artifacts[0].relPath, 'prompt.md');
});

test('artifactsByNodeStep keeps two slices of ONE cycle apart, and orders buckets by cycle', () => {
  // A fan-out: both executions are cycle 1, so grouping by cycle alone would merge
  // them into one list even though their step folders are distinct on disk.
  const groups = artifactsByNodeStep([
    { nodeId: 'impl', stepKey: 'x:impl:2', cycle: 2, relPath: 'steps/impl-c2/late.md' },
    { nodeId: 'impl', stepKey: 'x:impl:1:p1t2', cycle: 1, relPath: 'steps/impl-c1-p1t2/b.md' },
    { nodeId: 'impl', stepKey: 'x:impl:1:p1t1', cycle: 1, relPath: 'steps/impl-c1-p1t1/a.md' },
  ]);
  // Cycle order first, arrival order within the cycle (p1t2 was framed first).
  assert.deepEqual([...groups.get('impl').keys()], ['x:impl:1:p1t2', 'x:impl:1:p1t1', 'x:impl:2']);
  for (const b of groups.get('impl').values()) assert.equal(b.artifacts.length, 1, 'no slice absorbs another');
});

test('artifactsByNodeStep falls back to the cycle when a row carries no stepKey (v1)', () => {
  const groups = artifactsByNodeStep([
    { nodeId: 'planner', cycle: 1, relPath: 'plans/a.md' },
    { nodeId: 'planner', cycle: 2, relPath: 'plans/b.md' },
    { nodeId: 'planner', cycle: 1, relPath: 'plans/c.md' },
  ]);
  assert.deepEqual([...groups.get('planner').keys()], ['c1', 'c2']);
  assert.equal(groups.get('planner').get('c1').artifacts.length, 2);
  assert.equal(groups.get('planner').get('c1').stepKey, null);
});
