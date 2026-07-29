import { test } from 'node:test';
import assert from 'node:assert/strict';
import { implementerBody } from '../src/core/phases.mjs';

test('implementer body: TASK path is authoritative when present', () => {
  const body = implementerBody({ mode: 'implement', planPath: '/plans/x.md', taskPath: '/run/tasks/p1-t1.md' });
  assert.match(body, /\/run\/tasks\/p1-t1\.md/);
  assert.match(body, /authoritative|self-contained/i);
  assert.match(body, /\/plans\/x\.md/); // plan still referenced
});

test('implementer body: no TASK path -> plan is authoritative (today behavior)', () => {
  const body = implementerBody({ mode: 'implement', planPath: '/plans/x.md' });
  assert.doesNotMatch(body, /TASK \(authoritative/);
  assert.match(body, /\/plans\/x\.md/);
});

test('implementer body: fix mode references the review', () => {
  const body = implementerBody({ mode: 'fix', planPath: '/plans/x.md', reviewPath: '/rev/r.md' });
  assert.match(body, /\/rev\/r\.md/);
});

test('implementer body: siblings render the shared-tree block with each sibling task', () => {
  const body = implementerBody({
    mode: 'implement',
    planPath: '/plans/x.md',
    taskPath: '/run/tasks/p1-t1.md',
    siblings: [
      { id: 'p1t2', title: 'Wire settings API', file: 'tasks/p1-t2-wire-settings-api.md' },
      { id: 'p1t3', title: 'Add export button', file: 'tasks/p1-t3-add-export-button.md' },
    ],
  });
  assert.match(body, /Parallel siblings — shared working tree/);
  assert.match(body, /2 other implementer\(s\)/);
  assert.match(body, /p1t2 "Wire settings API" \(tasks\/p1-t2-wire-settings-api\.md\)/);
  assert.match(body, /p1t3 "Add export button" \(tasks\/p1-t3-add-export-button\.md\)/);
  // The four hard rules.
  assert.match(body, /Edit ONLY the files your TASK file lists/);
  assert.match(body, /SCOPED to your slice/);
  assert.match(body, /Never edit or "fix" a sibling's file/);
  assert.match(body, /No tree-wide git operations/);
});

test('implementer body: solo task (no siblings) has no shared-tree block', () => {
  const solo = implementerBody({ mode: 'implement', planPath: '/plans/x.md', taskPath: '/run/tasks/p2-t1.md', siblings: [] });
  assert.doesNotMatch(solo, /Parallel siblings/);
  const omitted = implementerBody({ mode: 'implement', planPath: '/plans/x.md', taskPath: '/run/tasks/p2-t1.md' });
  assert.equal(solo, omitted); // empty list and absent list are identical
});

test('implementer body: legacy (no taskPath) and fix mode ignore siblings entirely', () => {
  const sibs = [{ id: 'p1t2', title: 'X', file: 'tasks/p1-t2-x.md' }];
  const legacy = implementerBody({ mode: 'implement', planPath: '/plans/x.md', siblings: sibs });
  assert.equal(legacy, implementerBody({ mode: 'implement', planPath: '/plans/x.md' }));
  const fix = implementerBody({ mode: 'fix', planPath: '/plans/x.md', reviewPath: '/rev/r.md', siblings: sibs });
  assert.equal(fix, implementerBody({ mode: 'fix', planPath: '/plans/x.md', reviewPath: '/rev/r.md' }));
});
