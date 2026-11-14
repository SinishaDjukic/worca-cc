// T-task-files: the `## Files you may touch` parser and the task map (plan §3.3 file-list rule, §4.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskFiles, normPath, buildTaskMap } from '../lib/task-files.mjs';

// the real p2-t3 task of pipeline 03-10-26-built-in-terminal-pane-github-573-25d78e23 (head of the file)
const REAL_P2T3 = `# Task p2t3: Schema v50 and the terminal store

Part of: Built-in Terminal Pane (GitHub #573). Source plan: \`03-10-26-built-in-terminal-pane-github-573-v4.md\`, Task 4.

Phase 2 runs after Phase 1 (\`p1-t1\`). This task runs IN PARALLEL with three siblings in the same
phase (\`p2-t1-marker-parser\`, \`p2-t2-pty-or-pipes\`, \`p2-t4-folder-targets-and-session-env\`). Those
siblings touch different files — do not touch anything outside the list below. In particular, you are
the ONLY task in this phase allowed to edit \`src/core/db.mjs\`.

## Files you may touch

- Modify: \`src/core/db.mjs\`
- Create: \`src/core/terminal/store.mjs\`
- Create: \`test/db-migrate-v50.test.mjs\`
- Create: \`test/terminal-store.test.mjs\`

Do not touch any other file.

## Background

The terminal needs durable storage for: sessions, blocks (one row per recorded command — what ran,
where, its output tail, exit code, duration, who ran it).
- Modify: \`not/in/the/section.mjs\`
`;

test('the three bullet forms, in order, deduped; prose after the list is ignored', () => {
  const md = [
    '# T', '', '## Files you may touch', '',
    '- Create: `src/a.mjs`',
    '- Modify: `./src/b.mjs` (near line 16 for the import)',
    '- Delete: `src/old.mjs`',
    '- `test/a.test.mjs`',
    '- Modify: `src/a.mjs`',
    '', 'Do not touch any other file.', '', '## Background', '- Modify: `src/c.mjs`',
  ].join('\n');
  assert.deepEqual(parseTaskFiles(md), { parsed: true, files: ['src/a.mjs', 'src/b.mjs', 'src/old.mjs', 'test/a.test.mjs'] });
});

test('no section → parsed:false; a section without path bullets → parsed:false', () => {
  assert.deepEqual(parseTaskFiles('# T\n\n## Background\n- Modify: `x.mjs`\n'), { parsed: false, files: [] });
  assert.deepEqual(parseTaskFiles('## Files you may touch\n\nAny file, but ONLY to fix a trivial break.\n'), { parsed: false, files: [] });
});

test('a path escaping the root is dropped', () => {
  const md = '## Files you may touch\n- Modify: `../outside.mjs`\n- Modify: `a/../../x.mjs`\n- Create: `a/../b.mjs`\n';
  assert.deepEqual(parseTaskFiles(md), { parsed: true, files: ['b.mjs'] });
});

test('the real p2-t3 task text', () => {
  assert.deepEqual(parseTaskFiles(REAL_P2T3), {
    parsed: true,
    files: ['src/core/db.mjs', 'src/core/terminal/store.mjs', 'test/db-migrate-v50.test.mjs', 'test/terminal-store.test.mjs'],
  });
});

test('normPath: POSIX, no ./, .. resolved, duplicate / removed, null when escaping or absolute', () => {
  assert.equal(normPath('./a//b/./c.mjs'), 'a/b/c.mjs');
  assert.equal(normPath('a/b/../c.mjs'), 'a/c.mjs');
  assert.equal(normPath('a\\b.mjs'), 'a/b.mjs');
  assert.equal(normPath('../x'), null);
  assert.equal(normPath('/etc/passwd'), null);
  assert.equal(normPath(''), null);
  assert.equal(normPath('.'), null);
});

test('buildTaskMap: one entry per task with title, file, files and parsed', () => {
  const decomposition = { phases: [{ ordinal: 1, tasks: [
    { id: 'p1t1', title: 'One', file: 'tasks/p1.md' },
    { id: 'p1t2', title: 'Two', file: 'tasks/p2.md' },
  ] }] };
  const texts = { 'tasks/p1.md': REAL_P2T3, 'tasks/p2.md': '# no list\n' };
  const map = buildTaskMap(decomposition, (f) => texts[f]);
  assert.equal(map.v, 1);
  assert.deepEqual(map.tasks.p1t1, { title: 'One', file: 'tasks/p1.md', files: parseTaskFiles(REAL_P2T3).files, parsed: true });
  assert.deepEqual(map.tasks.p1t2, { title: 'Two', file: 'tasks/p2.md', files: [], parsed: false });
});
