// test/folder-prompts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { diffInstruction, taskHeader, folderRunNote } from '../src/core/phases.mjs';
import { changesInstruction } from '../src/core/graph/executor.mjs';
import { generateClaudeMd } from '../src/core/run-context.mjs';

const P = join(tmpdir(), 'pipe');
const patch = join(P, 'changes.patch'); const list = join(P, 'changes.json');

test('diffInstruction: git bytes unchanged; a folder run names changes.patch', () => {
  assert.equal(diffInstruction({ checkpointRef: 'abc123' }),
    'Inspect the diff with `git diff abc123` (the orchestrator\'s pre-implementation checkpoint) and `git status` in your cwd. New/untracked files are intent-to-added, so they DO appear in that diff; use `git status` to cross-check.');
  assert.equal(diffInstruction({ workMode: 'folder', pipelineDir: P, checkpointRef: null }),
    `Inspect the changes in \`${patch}\` (the folder as it was when the run started → your cwd; new and deleted files included) and \`${list}\` (the list), then read the changed files in your cwd. There is no git in this run.`);
});

test('changesInstruction: a folder run points the checklist hint at changes.patch', () => {
  assert.equal(changesInstruction({}), 'via `git diff` in your cwd');
  assert.equal(changesInstruction({ workMode: 'folder', pipelineDir: P }), `in \`${patch}\`, a unified diff of everything the run changed — there is no git in this run`);
});

test('taskHeader: the no-git note rides a folder run only; a git header keeps its bytes', () => {
  const base = { projectDir: join(tmpdir(), 'copy'), pipelineDir: P, node: { key: 'reviewer' }, taskPrompt: 'x' };
  const note = folderRunNote({ workMode: 'folder', pipelineDir: P });
  assert.equal(note, `This run works on a copy of a plain folder, not a git repository. Never run git here (no \`git init\`, \`git diff\`, \`git status\`, \`git add\` or \`git commit\`), even where your role instructions say so. The changes so far are in \`${patch}\` (a unified diff from the folder as it was to your cwd) and \`${list}\` (the file list).\n\n`);
  assert.equal(folderRunNote({ pipelineDir: P }), '');
  const git = taskHeader(base, 'Review');
  const marker = `Pipeline directory (shared artifacts): ${P}\n\n`;
  assert.equal(taskHeader({ ...base, workMode: 'folder' }, 'Review'), git.replace(marker, marker + note));
});

test('generateClaudeMd: a folder run says copy and never git; a git run keeps its bytes', () => {
  const m = { projectKey: 'site-00000001', projectName: 'site', projectDir: '/real/site', worktreeDir: '/runs/x/repos/site-00000001' };
  const git = generateClaudeMd({ pipelineId: 'abcd1234', members: [m] }).text;
  const folder = generateClaudeMd({ pipelineId: 'abcd1234', members: [{ ...m, workMode: 'folder' }] }).text;
  assert.match(git, /one git checkout per project below/);
  assert.match(git, /- `repos\/<projectKey>\/` — one git worktree per project in this run\. \*\*All code edits happen here\.\*\*/);
  assert.doesNotMatch(folder, /git checkout|git worktree/);
  assert.match(folder, /All edits happen inside `repos\/<projectKey>`, a copy of the project's folder \(not a git repository: never run git there\); the run root holds run metadata only\./);
  assert.match(folder, /- `repos\/<projectKey>\/` — a copy of the project's folder \(no git\)\. \*\*All code edits happen here\.\*\*/);
});
