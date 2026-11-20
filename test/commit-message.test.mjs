// test/commit-message.test.mjs — the run commit message (#1143): builder, parsers, readers.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { artifactPaths, recordArtifact, writeReview, newestPlanPath } from '../src/core/artifacts.mjs';
import {
  RUN_TRAILER, wrapText, planGoal, cleanSummary, parseStagedChanges, buildRunCommitMessage,
  readStagedChanges, readCommitSummary,
} from '../src/core/commit-message.mjs';

useTempHome(after, 'worca-cc-commitmsg-');
const created = [];
after(async () => { for (const d of created) await rm(d, { recursive: true, force: true }); });
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const runner = (cwd) => async (args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr, code: r.status };
};

test('the full message: subject, wrapped summary, stats, file rows, Worca-Run trailer last', () => {
  const msg = buildRunCommitMessage({
    title: '  Add   login\nhelper ',
    runId: 'ab12cd34',
    summary: 'Add a login helper so the app can check the session before it renders any page that needs a signed-in user.',
    changes: {
      files: [
        { status: 'A', path: 'src/login.mjs', added: 30, removed: 0 },
        { status: 'M', path: 'src/app.mjs', added: 10, removed: 7 },
        { status: 'R', from: 'src/a.mjs', path: 'src/b.mjs', added: 0, removed: 0 },
        { status: 'M', path: 'logo.png', added: 0, removed: 0, binary: true },
      ],
      insertions: 40, deletions: 7,
    },
  });
  assert.equal(msg, [
    'worca: Add login helper',
    '',
    'Add a login helper so the app can check the session before it renders',
    'any page that needs a signed-in user.',
    '',
    '4 files changed, 40 insertions(+), 7 deletions(-)',
    '',
    'A  src/login.mjs (+30)',
    'M  src/app.mjs (+10 -7)',
    'R  src/a.mjs -> src/b.mjs',
    'M  logo.png (binary)',
    '',
    `${RUN_TRAILER}: ab12cd34`,
  ].join('\n'));
});

test('git reads the trailer back, and finds no Pipeline line', () => {
  const repo = templateRepo('cmsg', { branch: 'main', user: true, files: { 'README.md': '# hi\n' } });
  created.push(repo);
  const msg = buildRunCommitMessage({ title: 't', runId: 'ab12cd34', summary: 'Why: because it is needed.',
    changes: { files: [{ status: 'A', path: 'x.txt', added: 1, removed: 0 }], insertions: 1, deletions: 0 } });
  assert.equal(git(repo, ['commit', '--allow-empty', '-q', '-m', msg]).status, 0);
  assert.equal(git(repo, ['log', '-1', '--format=%(trailers:key=Worca-Run,valueonly)']).stdout.trim(), 'ab12cd34');
  assert.doesNotMatch(git(repo, ['log', '-1', '--format=%B']).stdout, /Pipeline/);
});

test('parts drop out: no summary, no changes, no run id; an empty title reads "changes"', () => {
  assert.equal(buildRunCommitMessage({ title: '', runId: 'r1' }), 'worca: changes\n\nWorca-Run: r1');
  assert.equal(buildRunCommitMessage({ title: 'T' }), 'worca: T');
  assert.equal(buildRunCommitMessage({ title: 'T', changes: null, summary: '   ' }), 'worca: T');
  assert.equal(buildRunCommitMessage({ title: 'T', changes: { files: [], insertions: 0, deletions: 0 } }), 'worca: T');
});

test('stats: zero parts are omitted, singular words, at most 20 rows then "and N more"', () => {
  const one = buildRunCommitMessage({ title: 'T', changes: { files: [{ status: 'D', path: 'gone.txt', added: 0, removed: 3 }], insertions: 0, deletions: 3 } });
  assert.equal(one, 'worca: T\n\n1 file changed, 3 deletions(-)\n\nD  gone.txt (-3)');
  const files = Array.from({ length: 25 }, (_, i) => ({ status: 'A', path: `f${String(i).padStart(2, '0')}.txt`, added: 1, removed: 0 }));
  const many = buildRunCommitMessage({ title: 'T', changes: { files, insertions: 25, deletions: 0 } });
  const rows = many.split('\n').filter((l) => /^A  /.test(l));
  assert.equal(rows.length, 20);
  assert.match(many, /\n\.\.\. and 5 more files$/);
  const ctl = buildRunCommitMessage({ title: 'T', changes: { files: [{ status: 'A', path: 'a\nb.txt', added: 1, removed: 0 }], insertions: 1, deletions: 0 } });
  assert.match(ctl, /\nA  a\?b\.txt \(\+1\)$/);
});

test('wrapText: 72 columns, a long word keeps its own line', () => {
  const long = `see https://example.com/${'x'.repeat(80)} for details and more words to wrap around here ok`;
  const lines = wrapText(long).split('\n');
  assert.equal(lines[0], 'see');
  assert.ok(lines[1].length > 72 && !/\s/.test(lines[1]));
  for (const l of lines.slice(2)) assert.ok(l.length <= 72, l);
  assert.equal(wrapText(''), '');
});

test('planGoal: the paragraph under a goal heading wins; front matter, fences and tables are skipped', () => {
  const md = [
    '---', 'title: x', '---',
    '# Plan: thing',
    '',
    'Intro line that is not the goal.',
    '',
    '```js', 'const notIt = 1;', '```',
    '| a | b |',
    '## 1. Goal and scope',
    '',
    'Make the run commit say what changed',
    'and why.',
    '',
    'Second paragraph.',
  ].join('\n');
  assert.equal(planGoal(md), 'Make the run commit say what changed and why.');
  assert.equal(planGoal('# T\n\n```\ncode\n```\n\n| x |\n\nFirst prose.\n\nNext.'), 'First prose.');
  assert.equal(planGoal('# T\n\n## Goals\n\n- one\n- two\n  continued\n'), 'one; two continued');
  assert.equal(planGoal('# Only a heading\n'), '');
  assert.equal(planGoal(''), '');
  assert.equal(planGoal(null), '');
});

test('planGoal: a goal word inside another heading does not make it the goal', () => {
  const md = '# Export\n\n**Goal:** Add CSV export.\n\n## Task 3: Overview page\n\n**Files:**\n- Modify ui/overview.mjs\n';
  assert.equal(planGoal(md), '**Goal:** Add CSV export.');
  assert.equal(planGoal('# T\n\nAdd CSV export.\n\n## Fix the summary bug\n\nStep text.\n'), 'Add CSV export.');
});

test('planGoal: non-goals are never the goal', () => {
  assert.equal(planGoal('# T\n\nAdd CSV export.\n\n## Non-goals\n\n- Excel output\n'), 'Add CSV export.');
  assert.equal(planGoal('# T\n\n## Non-Goals\n\nNo PDF.\n\n## Goal\n\nAdd CSV.\n'), 'Add CSV.');
  assert.equal(planGoal('# T\n\nAdd CSV export.\n\n## Out of scope goals\n\nNo PDF.\n'), 'Add CSV export.');
});

test('planGoal: a goal heading beats an earlier summary or problem heading', () => {
  assert.equal(planGoal('# T\n\n## Problem\n\nExports are slow.\n\n## Overview\n\nA cache.\n\n## Goal\n\nAdd CSV.\n'), 'Add CSV.');
  assert.equal(planGoal('# T\n\n## Problem\n\nExports are slow.\n\n## Overview\n\nA cache.\n'), 'A cache.');
  assert.equal(planGoal('# T\n\n## **Objective**\n\nAdd CSV.\n'), 'Add CSV.');
});

test('cleanSummary: strips links and bold, caps the length; a summary holding a secret is dropped whole', () => {
  assert.equal(cleanSummary('Uses **the db**\nand see [docs](https://x.y/z).'), 'Uses the db and see docs.');
  assert.equal(cleanSummary('Connect to postgres://admin:hunter2pass@db.example.com:5432/app first.'), '');
  assert.equal(cleanSummary('Token wbt_abcdefghijklmnopqrstuvwxyz0123 leaked.'), '');
  assert.equal(cleanSummary('Second pass: the fix is in place.'), 'Second pass: the fix is in place.', 'prose with "pass:" is kept as written');
  assert.equal(cleanSummary('   '), '');
  const long = cleanSummary(`${'A sentence that goes on. '.repeat(40)}`);
  assert.ok(long.length <= 600, String(long.length));
  assert.match(long, /\.$/);
  const words = cleanSummary('word '.repeat(200));
  assert.ok(words.length <= 603 && words.endsWith('...'), words.slice(-10));
});

test('cleanSummary: only real bold markers go; code and maths keep theirs', () => {
  assert.equal(cleanSummary('Fix __init__ and __main__ handling.'), 'Fix __init__ and __main__ handling.');
  assert.equal(cleanSummary('Compute 2**3 and 4**5.'), 'Compute 2**3 and 4**5.');
  assert.equal(cleanSummary('Call f(**a, **b) here.'), 'Call f(**a, **b) here.');
  assert.equal(cleanSummary('**Goal:** Add **CSV** export.'), 'Goal: Add CSV export.');
});

test('cleanSummary: a reference after a closing keyword cannot close the issue', () => {
  assert.equal(cleanSummary('Does not fix #88 yet.'), 'Does not fix issue 88 yet.');
  assert.equal(cleanSummary('Closes GH-12 and fixes acme/app#7.'), 'Closes issue 12 and fixes acme/app issue 7.');
  assert.equal(cleanSummary('Resolved: #3 was hard.'), 'Resolved: issue 3 was hard.');
});

test('cleanSummary: other references and @ words stay as written', () => {
  const kept = 'See PR #12, step #1, C#9, the prefix #4, color #fff, @Override, @someone and @types/node.';
  assert.equal(cleanSummary(kept), kept);
});

test('parseStagedChanges reads -z name-status and numstat, renames and binaries included', () => {
  const ns = ['A', 'new.txt', 'M', 'mod.txt', 'R100', 'old.mjs', 'moved.mjs', 'D', 'gone.txt', 'M', 'img.png', ''].join('\0');
  const num = ['3\t0\tnew.txt', '1\t1\tmod.txt', '0\t0\t', 'old.mjs', 'moved.mjs', '0\t2\tgone.txt', '-\t-\timg.png', ''].join('\0');
  assert.deepEqual(parseStagedChanges(ns, num), {
    files: [
      { status: 'D', path: 'gone.txt', added: 0, removed: 2 },
      { status: 'M', path: 'img.png', added: 0, removed: 0, binary: true },
      { status: 'M', path: 'mod.txt', added: 1, removed: 1 },
      { status: 'R', path: 'moved.mjs', from: 'old.mjs', added: 0, removed: 0 },
      { status: 'A', path: 'new.txt', added: 3, removed: 0 },
    ],
    insertions: 4, deletions: 3,
  });
  assert.deepEqual(parseStagedChanges('', ''), { files: [], insertions: 0, deletions: 0 });
});

test('readStagedChanges: the staged diff of a real repo; null when git fails', async () => {
  const repo = templateRepo('cstaged', { branch: 'main', user: true, files: { 'keep.txt': 'a\nb\n', 'old.txt': 'same content here\nline two\nline three\n' } });
  created.push(repo);
  await writeFile(join(repo, 'keep.txt'), 'a\nc\n');
  await writeFile(join(repo, 'added.txt'), 'x\n');
  git(repo, ['mv', 'old.txt', 'renamed.txt']);
  await writeFile(join(repo, 'unstaged.txt'), 'not staged\n');
  git(repo, ['add', 'keep.txt', 'added.txt']);
  const c = await readStagedChanges(runner(repo));
  assert.deepEqual(c.files.map((f) => [f.status, f.path, f.from || null, f.added, f.removed]), [
    ['A', 'added.txt', null, 1, 0],
    ['M', 'keep.txt', null, 1, 1],
    ['R', 'renamed.txt', 'old.txt', 0, 0],
  ]);
  assert.equal(c.insertions, 2);
  assert.equal(c.deletions, 1);
  assert.equal(await readStagedChanges(async () => ({ ok: false, stdout: '', stderr: 'boom', code: 1 })), null);
  assert.equal(await readStagedChanges(async () => { throw new Error('spawn failed'); }), null);
});

async function seededRun(title) {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-cmsg-proj-'));
  created.push(projectDir);
  const { id, dir } = await seedPipeline(projectDir, { title, prompt: 'PROMPT-CANARY internal notes' });
  const { root } = artifactPaths(projectDir);
  return { id, dir, root };
}

test('readCommitSummary: the newest plan goal first, never the task prompt', async () => {
  const { id, dir, root } = await seededRun('plan first');
  await writeFile(join(dir, 'task.md'), '# Task\n\nPROMPT-CANARY internal notes\n');
  await writeFile(join(dir, 'overview.json'), JSON.stringify({ narrative: 'The overview says this.' }));
  await mkdir(join(root, 'plans'), { recursive: true });
  await writeFile(join(root, 'plans', '05-11-26-x.md'), '# P\n\n## Goal\n\nOld goal.\n');
  await writeFile(join(root, 'plans', '05-11-26-x-v2.md'), '# P\n\n## Goal\n\nNew goal: ship it.\n');
  recordArtifact(id, 'plan', 'plans/05-11-26-x.md');
  recordArtifact(id, 'plan', 'plans/05-11-26-x-v2.md');
  assert.equal(await newestPlanPath(id, root), join(root, 'plans', '05-11-26-x-v2.md'));
  const s = await readCommitSummary({ pipelineId: id, pipelineDir: dir, storeRoot: root });
  assert.equal(s, 'New goal: ship it.');
  assert.doesNotMatch(s, /PROMPT-CANARY/);
});

test('readCommitSummary: a plan file that is a symlink is refused; the overview is used instead', async () => {
  const { id, dir, root } = await seededRun('symlinked plan');
  const outside = await mkdtemp(join(tmpdir(), 'worca-cc-cmsg-outside-'));
  created.push(outside);
  await writeFile(join(outside, 'secret.md'), '# Host\n\n## Goal\n\nHOST-ONLY-CANARY paragraph.\n');
  await mkdir(join(root, 'plans'), { recursive: true });
  await symlink(join(outside, 'secret.md'), join(root, 'plans', '05-11-26-link.md'));
  recordArtifact(id, 'plan', 'plans/05-11-26-link.md');
  await writeFile(join(dir, 'overview.json'), JSON.stringify({ narrative: 'The overview says this.' }));
  const s = await readCommitSummary({ pipelineId: id, pipelineDir: dir, storeRoot: root });
  assert.equal(s, 'The overview says this.');
  assert.doesNotMatch(s, /HOST-ONLY-CANARY/);
});

test('newestPlanPath: a symlinked newest plan falls back to the older regular plan', async () => {
  const { id, dir, root } = await seededRun('symlink over plan');
  const outside = await mkdtemp(join(tmpdir(), 'worca-cc-cmsg-outside-'));
  created.push(outside);
  await writeFile(join(outside, 'secret.md'), '# Host\n\n## Goal\n\nHOST-ONLY-CANARY paragraph.\n');
  await mkdir(join(root, 'plans'), { recursive: true });
  await writeFile(join(root, 'plans', '06-11-26-y.md'), '# P\n\n## Goal\n\nThe real goal.\n');
  await symlink(join(outside, 'secret.md'), join(root, 'plans', '06-11-26-y-v2.md'));
  recordArtifact(id, 'plan', 'plans/06-11-26-y.md');
  recordArtifact(id, 'plan', 'plans/06-11-26-y-v2.md');
  assert.equal(await newestPlanPath(id, root), join(root, 'plans', '06-11-26-y.md'));
  assert.equal(await readCommitSummary({ pipelineId: id, pipelineDir: dir, storeRoot: root }), 'The real goal.');
});

test('readCommitSummary: a source the secret scan rejects falls through to the next one', async () => {
  const a = await seededRun('flagged plan');
  await mkdir(join(a.root, 'plans'), { recursive: true });
  await writeFile(join(a.root, 'plans', '06-11-26-z.md'), '# P\n\n## Goal\n\nMail bob@acme-corp.com about CSV.\n');
  recordArtifact(a.id, 'plan', 'plans/06-11-26-z.md');
  await writeFile(join(a.dir, 'overview.json'), JSON.stringify({ narrative: 'Adds CSV export.' }));
  assert.equal(await readCommitSummary({ pipelineId: a.id, pipelineDir: a.dir, storeRoot: a.root }), 'Adds CSV export.');

  const b = await seededRun('flagged overview');
  await writeFile(join(b.dir, 'overview.json'), JSON.stringify({ narrative: 'Mail bob@acme-corp.com about CSV.' }));
  await writeReview(b.id, 'impl', 1, { issues: [], summary: 'The export works.' });
  assert.equal(await readCommitSummary({ pipelineId: b.id, pipelineDir: b.dir, storeRoot: b.root }), 'The export works.');

  const c = await seededRun('all flagged');
  await writeFile(join(c.dir, 'overview.json'), JSON.stringify({ narrative: 'Mail bob@acme-corp.com about CSV.' }));
  assert.equal(await readCommitSummary({ pipelineId: c.id, pipelineDir: c.dir, storeRoot: c.root }), '');
});

test('readCommitSummary: the cached overview, then the latest impl review, else empty', async () => {
  const a = await seededRun('overview');
  await writeFile(join(a.dir, 'overview.json'), JSON.stringify({ narrative: 'Adds a helper.\nIt checks sessions.' }));
  assert.equal(await readCommitSummary({ pipelineId: a.id, pipelineDir: a.dir, storeRoot: a.root }), 'Adds a helper. It checks sessions.');

  const b = await seededRun('review');
  await writeFile(join(b.dir, 'task.md'), 'PROMPT-CANARY');
  await writeReview(b.id, 'plan', 3, { issues: [], summary: 'Plan review text.' });   // a later cycle of another kind
  await writeReview(b.id, 'impl', 1, { issues: [], summary: 'First pass.' });
  await writeReview(b.id, 'impl', 2, { issues: [], summary: 'Second pass: the fix is in place.' });
  assert.equal(await readCommitSummary({ pipelineId: b.id, pipelineDir: b.dir, storeRoot: b.root }), 'Second pass: the fix is in place.');

  const c = await seededRun('nothing');
  await writeFile(join(c.dir, 'task.md'), 'PROMPT-CANARY');
  assert.equal(await readCommitSummary({ pipelineId: c.id, pipelineDir: c.dir, storeRoot: c.root }), '');
  assert.equal(await readCommitSummary({}), '');
  assert.equal(await readCommitSummary({ pipelineId: 'nope', pipelineDir: '/nonexistent', storeRoot: '/nonexistent' }), '');
});
