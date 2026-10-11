import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, symlinkSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slugify, defaultSpecPath, nextFreeName, saveSpec, SpecSaveError } from '../src/core/spec-builder/save.mjs';

const dirs = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test('slugify and defaultSpecPath', () => {
  assert.equal(slugify('Dark mode: the  Toggle!'), 'dark-mode-the-toggle');
  assert.equal(slugify('***'), 'spec');
  assert.equal(slugify('x'.repeat(80)).length, 60);
  assert.equal(defaultSpecPath('---\nworca:\n  kind: fix\n---\n# Dark mode\n'), 'plans/dark-mode-design.md');
  assert.equal(defaultSpecPath('no title'), 'plans/spec-design.md');
});

test('nextFreeName: -v2 upward, a -vN name restarts from its stem, null when all are taken', async () => {
  const taken = new Set(['plans/x-design-v2.md']);
  assert.equal(await nextFreeName('plans/x-design.md', async (r) => taken.has(r)), 'plans/x-design-v3.md');
  assert.equal(await nextFreeName('plans/x-design-v3.md', async () => false), 'plans/x-design-v2.md');
  assert.equal(await nextFreeName('plans/x.md', async () => true), null);
});

test('saveSpec writes once, never overwrites, and refuses odd or escaping paths', async () => {
  const project = tmp('worca-sb-save-');
  const md = '# Dark mode\n';
  assert.deepEqual(await saveSpec({ projectDir: project, markdown: md }), { ok: true, path: 'plans/dark-mode-design.md' });
  assert.equal(readFileSync(join(project, 'plans/dark-mode-design.md'), 'utf8'), md);
  assert.deepEqual(await saveSpec({ projectDir: project, markdown: '# other\n', path: 'plans/dark-mode-design.md' }),
    { ok: false, code: 'EXISTS', path: 'plans/dark-mode-design.md', suggestion: 'plans/dark-mode-design-v2.md' });
  assert.equal(readFileSync(join(project, 'plans/dark-mode-design.md'), 'utf8'), md, 'unchanged');
  for (const path of ['../x.md', 'src/x.md', '/abs/plans/x.md', 'plans/a/b.md', 'plans/x.txt']) {
    await assert.rejects(saveSpec({ projectDir: project, markdown: md, path }), SpecSaveError, path);
  }
});

test('saveSpec: a plans/ symlink pointing outside the project is refused and nothing is written there', async () => {
  const project = tmp('worca-sb-save-link-');
  const outside = tmp('worca-sb-save-out-');
  symlinkSync(outside, join(project, 'plans'), 'dir');
  await assert.rejects(saveSpec({ projectDir: project, markdown: '# x\n', path: 'plans/x-design.md' }), /outside the project/);
  assert.deepEqual(readdirSync(outside), []);
  assert.equal(existsSync(join(outside, 'x-design.md')), false);
});
