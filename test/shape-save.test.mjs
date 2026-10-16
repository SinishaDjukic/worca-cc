import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { savePlanToCheckout, planSaveName } from '../src/core/shape/save.mjs';

async function fixture(text = '# Plan\n\nBody\n') {
  const root = await mkdtemp(join(tmpdir(), 'shape-save-'));
  const projectDir = join(root, 'project');
  await mkdir(projectDir);
  const file = join(root, 'plan.md');
  await writeFile(file, text);
  return { root, projectDir, file };
}

test('writes plans/<slug>-design.md and returns the relative path', async () => {
  const { projectDir, file } = await fixture('# Add CSV export\n');
  const r = await savePlanToCheckout({ file, projectDir, title: 'Add CSV export' });
  assert.deepEqual(r, { ok: true, path: 'plans/add-csv-export-design.md' });
  assert.equal(await readFile(join(projectDir, 'plans', 'add-csv-export-design.md'), 'utf8'), '# Add CSV export\n');
});

test('a second save answers 409 exists and leaves the file unchanged', async () => {
  const { root, projectDir, file } = await fixture('first\n');
  await savePlanToCheckout({ file, projectDir, title: 'X' });
  const second = join(root, 'second.md');
  await writeFile(second, 'second\n');
  const r = await savePlanToCheckout({ file: second, projectDir, title: 'X' });
  assert.deepEqual(r, { ok: false, status: 409, error: 'exists', path: 'plans/x-design.md' });
  assert.equal(await readFile(join(projectDir, 'plans', 'x-design.md'), 'utf8'), 'first\n');
});

test('overwrite:true replaces the existing file', async () => {
  const { root, projectDir, file } = await fixture('first\n');
  await savePlanToCheckout({ file, projectDir, title: 'X' });
  const second = join(root, 'second.md');
  await writeFile(second, 'second\n');
  const r = await savePlanToCheckout({ file: second, projectDir, title: 'X', overwrite: true });
  assert.deepEqual(r, { ok: true, path: 'plans/x-design.md' });
  assert.equal(await readFile(join(projectDir, 'plans', 'x-design.md'), 'utf8'), 'second\n');
});

test('a plans symlink pointing outside the project is refused with 409', async () => {
  const { root, projectDir, file } = await fixture();
  const outside = join(root, 'outside');
  await mkdir(outside);
  await symlink(outside, join(projectDir, 'plans'));
  const r = await savePlanToCheckout({ file, projectDir, title: 'X' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.deepEqual(await readdir(outside), []);
});

test('a symlinked target file is refused with 409', async () => {
  const { root, projectDir, file } = await fixture('new\n');
  const victim = join(root, 'victim.md');
  await writeFile(victim, 'keep\n');
  await mkdir(join(projectDir, 'plans'));
  await symlink(victim, join(projectDir, 'plans', 'x-design.md'));
  const r = await savePlanToCheckout({ file, projectDir, title: 'X', overwrite: true });
  assert.deepEqual(r, { ok: false, status: 409, error: 'refusing to write through a symlink', path: 'plans/x-design.md' });
  assert.equal(await readFile(victim, 'utf8'), 'keep\n');
});

test('a dangling plans symlink answers 409 instead of throwing', async () => {
  const { root, projectDir, file } = await fixture();
  await symlink(join(root, 'gone'), join(projectDir, 'plans'));
  const r = await savePlanToCheckout({ file, projectDir, title: 'X' });
  assert.deepEqual(r, { ok: false, status: 409, error: 'plans/ is a broken link' });
});

test('runs no git: the only change is the untracked plans/', async () => {
  const { projectDir, file } = await fixture();
  const git = (...args) => execFileSync('git', args, { cwd: projectDir, encoding: 'utf8' });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  const r = await savePlanToCheckout({ file, projectDir, title: 'X' });
  assert.equal(r.ok, true);
  assert.equal(git('status', '--porcelain'), '?? plans/\n');
});

test('planSaveName slugs the title and falls back to plan', () => {
  assert.equal(planSaveName('Add CSV export'), 'add-csv-export-design.md');
  for (const t of ['', null, '!!!']) assert.equal(planSaveName(t), 'plan-design.md');
  const long = planSaveName('word '.repeat(40));
  const slug = long.replace(/-design\.md$/, '');
  assert.ok(slug.length <= 60);
  assert.ok(!slug.endsWith('-'));
  assert.ok(slug.startsWith('word-word'));
});
