// test/no-project-prompts.test.mjs — P3 Task 6: what agents are told in a run without a project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { gitDir } from './helpers/git-dir.mjs';
import { diffInstruction, taskHeader, folderRunNote, noProjectRunNote, runOpts } from '../src/core/phases.mjs';
import { changesInstruction } from '../src/core/graph/executor.mjs';
import { buildEnvelope, envForShell } from '../src/core/graph/script-runner.mjs';
import gitDiff from '../scripts/git-diff.mjs';
import { generateClaudeMd } from '../src/core/run-context.mjs';
import { NO_PROJECT_KEY } from '../src/shared/no-project.mjs';
import { runCodexProcess } from '../src/core/engines/codex.mjs';
import { runCopilotProcess } from '../src/core/engines/copilot.mjs';
import { fakeCodex } from './helpers/fake-codex.mjs';
import { fakeCopilot } from './helpers/fake-copilot.mjs';

const P = join(tmpdir(), 'pipe');
const NOTE = 'This run has no project and no git repository: your cwd is the run\'s own working folder. Never run git here (no `git init`, `git diff`, `git status`, `git add` or `git commit`), even where your role instructions say so. Every file you make in this folder is kept as this run\'s result.\n\n';

test('diffInstruction: a no-project run reviews the files directly; git and folder bytes unchanged', () => {
  assert.equal(diffInstruction({ workMode: 'none', pipelineDir: P, checkpointRef: null }),
    'There is no repository and no diff in this run: every file in your cwd was made by this run. Review those files directly with Glob, Grep and Read.');
  assert.equal(diffInstruction({ workMode: 'none', pipelineDir: P, checkpointRef: 'abc123' }),
    'There is no repository and no diff in this run: every file in your cwd was made by this run. Review those files directly with Glob, Grep and Read.');
  assert.match(diffInstruction({ checkpointRef: 'abc123' }), /^Inspect the diff with `git diff abc123`/);
  assert.match(diffInstruction({ workMode: 'folder', pipelineDir: P }), /changes\.patch/);
});

test('changesInstruction: a no-project run points the checklist hint at the files in the cwd', () => {
  assert.equal(changesInstruction({ workMode: 'none', pipelineDir: P }),
    'by reading the files in your cwd (there is no repository: every file there was made by this run)');
  assert.equal(changesInstruction({}), 'via `git diff` in your cwd');
});

test('noProjectRunNote: only a no-project run gets it', () => {
  assert.equal(noProjectRunNote({ workMode: 'none', pipelineDir: P }), NOTE);
  for (const ctx of [{ workMode: 'folder', pipelineDir: P }, { workMode: 'git', pipelineDir: P }, { pipelineDir: P }, undefined]) {
    assert.equal(noProjectRunNote(ctx), '', JSON.stringify(ctx));
  }
  assert.equal(folderRunNote({ workMode: 'none', pipelineDir: P }), '', 'the folder note never rides a no-project run');
});

test('taskHeader: the note sits right after the pipeline-directory line; the location line is unchanged', () => {
  const base = { projectDir: join(tmpdir(), 'runs', 'abcd1234', 'work'), pipelineDir: P, node: { key: 'reviewer' }, taskPrompt: 'x' };
  const git = taskHeader(base, 'Review');
  const marker = `Pipeline directory (shared artifacts): ${P}\n\n`;
  assert.ok(git.includes(marker));
  assert.ok(git.includes(`Project directory (your cwd): ${base.projectDir}\n`));
  assert.equal(taskHeader({ ...base, workMode: 'none' }, 'Review'), git.replace(marker, marker + NOTE));
});

test('an agent\'s own git never walks up from work/ into a repository that holds worcaHome; a git run\'s spawn env is unchanged', () => {
  const work = join(tmpdir(), 'runs', 'abcd1234', 'work');
  const opts = (ctx) => runOpts({ pipelineDir: P, ...ctx }, { role: 'implementer', prompt: 'x', systemPrompt: '', allowedTools: [] });
  assert.deepEqual(opts({ workMode: 'none', projectDir: work }).spawnEnv, { GIT_CEILING_DIRECTORIES: join(tmpdir(), 'runs', 'abcd1234') });
  assert.equal(opts({ projectDir: '/repo' }).spawnEnv, undefined);
  assert.equal(opts({ workMode: 'folder', projectDir: '/copy' }).spawnEnv, undefined);
});

test('the git ceiling reaches the agent on every engine: codex and copilot children get GIT_CEILING_DIRECTORIES (P3-D20)', { skip: process.platform === 'win32' }, async () => {
  const host = gitDir('np-engine-ceiling');
  try {
    const work = join(host, 'runs', 'abcd1234', 'work');
    mkdirSync(work, { recursive: true });
    const { spawnEnv } = runOpts({ workMode: 'none', projectDir: work, pipelineDir: P }, { role: 'implementer', prompt: 'x', systemPrompt: '', allowedTools: [] });
    const codex = fakeCodex(mkdtempSync(join(host, 'codex-')), 'ok');
    await runCodexProcess({ cwd: work, bin: codex.bin, prompt: 'P', usageDir: host, spawnEnv });
    assert.equal(codex.env().GIT_CEILING_DIRECTORIES, join(host, 'runs', 'abcd1234'), 'codex: its shell\'s git stops at runs/<id>');
    const fix = join(host, 'copilot.jsonl');
    writeFileSync(fix, '');
    const copilot = fakeCopilot(mkdtempSync(join(host, 'copilot-')), { fixture: fix, envNames: ['GIT_CEILING_DIRECTORIES'] });
    await runCopilotProcess({ cwd: work, bin: copilot.bin, prompt: 'P', usageDir: host, scratchBase: join(host, 'scratch'), spawnEnv }).catch(() => {});
    assert.equal(copilot.record().env.GIT_CEILING_DIRECTORIES, join(host, 'runs', 'abcd1234'), 'copilot: its shell\'s git stops at runs/<id>');
    // A spawn env without a ceiling (every git or folder run) adds none.
    const plain = fakeCodex(mkdtempSync(join(host, 'codex-plain-')), 'ok');
    await runCodexProcess({ cwd: work, bin: plain.bin, prompt: 'P', usageDir: host, spawnEnv: { MCPSECRET_X: 'v' } });
    assert.equal(plain.env().GIT_CEILING_DIRECTORIES, process.env.GIT_CEILING_DIRECTORIES);
    assert.equal(plain.env().MCPSECRET_X, undefined, 'the rest of the run env still stays out of codex\'s shell');
  } finally { rmSync(host, { recursive: true, force: true }); }
});

test('worca\'s gitDiff card never runs git in a run without a project, even inside a repository; a script child\'s git never walks up', async () => {
  const host = gitDir('np-gitdiff');
  try {
    const git = (...a) => execFileSync('git', ['-C', host, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a]);
    writeFileSync(join(host, 'secret.txt'), 'v1\n');
    git('add', 'secret.txt');
    git('commit', '-q', '-m', 'v1');
    writeFileSync(join(host, 'secret.txt'), 'v2 HOST-REPO-UNCOMMITTED-CHANGE\n');
    const work = join(host, 'runs', 'abcd1234', 'work');
    mkdirSync(work, { recursive: true });
    const out = join(host, 'diff-cycle1.md');
    await gitDiff({ outputs: { diff: { type: 'md', path: out } }, params: {}, ctx: { cwd: work, workMode: 'none', checkpointRef: null }, log: () => {} });
    assert.equal(readFileSync(out, 'utf8'), '# Diff\n\nThis run has no repository, so there is no diff.\n', 'never the enclosing repository\'s diff');
    const copy = join(host, 'runs', 'abcd1235', 'repos', 'site-00000001');
    mkdirSync(copy, { recursive: true });
    const outF = join(host, 'diff-folder.md');
    assert.deepEqual(await gitDiff({ outputs: { diff: { type: 'md', path: outF } }, params: {}, ctx: { cwd: copy, pipelineDir: host, workMode: 'folder', checkpointRef: null }, log: () => {} }), { summary: 'no repository' });
    assert.equal(readFileSync(outF, 'utf8'), `# Diff\n\nThis run works on a copy of the project's folder, with no git: its changes are in \`${join(host, 'changes.patch')}\`.\n`,
      'a Folder run\'s copy never diffs the enclosing repository (S-Z), and its card names the patch P1 writes');
    const envelope = buildEnvelope({ node: { id: 'n_diff', key: 'gitDiff' }, projectDir: work, pipelineDir: host, workMode: 'none', outputs: { diff: { path: out } }, ports: { outputs: [{ id: 'diff', type: 'md' }] } });
    assert.equal(envelope.ctx.workMode, 'none', 'the card learns the run\'s mode from its envelope');
    assert.equal('workMode' in buildEnvelope({ node: { id: 'n_diff', key: 'gitDiff' }, projectDir: host, pipelineDir: host, workMode: 'git' }).ctx, false, 'a git run\'s envelope is unchanged');
    assert.deepEqual(await gitDiff({ outputs: envelope.outputs, params: {}, ctx: envelope.ctx, log: () => {} }), { summary: 'no repository' });
    assert.equal(envForShell(envelope, {}).GIT_CEILING_DIRECTORIES, join(host, 'runs', 'abcd1234'));
    assert.equal(envForShell(envelope, { GIT_CEILING_DIRECTORIES: '/mnt/slow' }).GIT_CEILING_DIRECTORIES, [join(host, 'runs', 'abcd1234'), '/mnt/slow'].join(delimiter), 'the host\'s own ceiling is kept');
    assert.equal('GIT_CEILING_DIRECTORIES' in envForShell(buildEnvelope({ node: { id: 'n', key: 'k' }, projectDir: host, pipelineDir: host }), {}), false);
  } finally { rmSync(host, { recursive: true, force: true }); }
});

test('generateClaudeMd: a sole no-project member gets the work/ intro, layout line and roster, and never names repos/ or git', () => {
  const m = { projectKey: NO_PROJECT_KEY, projectName: 'No project', projectDir: '/w', worktreeDir: '/w', workMode: 'none' };
  const text = generateClaudeMd({ pipelineId: 'abcd1234', members: [m] }).text;
  assert.ok(text.includes('You are working in a **worca-cc run root** with no project. Your working folder is `work/`: every file you make goes there, and worca keeps them as this run\'s files. The run root holds run metadata only. This file is generated per run — do not edit it.'), text);
  assert.ok(text.includes('- `work/` — this run\'s working folder (no project, no git). **All files you make go here.**'), text);
  assert.ok(text.includes('## Projects in this run\n\n*(none — a run without a project)*\n'), text);
  assert.doesNotMatch(text, /repos\/|git checkout|git worktree/);
  assert.doesNotMatch(text, /no CLAUDE\.md found in this project/);
  // A git member keeps today's bytes.
  const git = generateClaudeMd({ pipelineId: 'abcd1234', members: [{ ...m, projectKey: 'site-00000001', projectName: 'site', worktreeDir: '/rr/repos/site-00000001', workMode: undefined }] }).text;
  assert.match(git, /one git checkout per project below/);
  assert.match(git, /## Project: site — repos\/site-00000001/);
});
