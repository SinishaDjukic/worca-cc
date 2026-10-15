import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkPlan } from '../src/core/shape/check.mjs';
import { wellShapedPlan, WELL_SHAPED_PATHS } from './helpers/shape-plan.mjs';

const PERSPECTIVES = ['product', 'architect', 'qa'];

async function project() {
  const dir = await mkdtemp(join(tmpdir(), 'shape-check-'));
  for (const p of WELL_SHAPED_PATHS) {
    await mkdir(dirname(join(dir, p)), { recursive: true });
    await writeFile(join(dir, p), 'x\n');
  }
  const file = join(dir, 'plan.md');
  await writeFile(file, wellShapedPlan());
  return { dir, file };
}
const byId = (r, id) => r.items.find((i) => i.id === id);

test('a well-shaped plan in a project holding its paths passes all eight checks, with grounding marks', async () => {
  const { dir, file } = await project();
  const r = await checkPlan(file, { projectDir: dir, perspectives: PERSPECTIVES });
  assert.equal(r.passed, 8);
  assert.equal(r.ok, true);
  assert.ok(r.grounding.length > 0);
});

test('a missing or falsy plan file gives null', async () => {
  const { dir } = await project();
  assert.equal(await checkPlan(join(dir, 'nope.md'), { projectDir: dir, perspectives: PERSPECTIVES }), null);
  assert.equal(await checkPlan(null, { projectDir: dir }), null);
  assert.equal(await checkPlan('', { projectDir: dir }), null);
});

test('projectDir null skips grounding: grounding is null and paths is not checked', async () => {
  const { file } = await project();
  const r = await checkPlan(file, { projectDir: null, perspectives: PERSPECTIVES });
  assert.equal(r.grounding, null);
  assert.equal(byId(r, 'paths').pass, true);
});

test('without perspectives the architect/qa checklist items name a perspective the plan lacks', async () => {
  const { dir, file } = await project();
  const r = await checkPlan(file, { projectDir: dir });
  assert.equal(byId(r, 'checklists').pass, false);
});

const UNMARKED = (md) => md.replace('lives in `src/charts.mjs` (new).', 'lives in `src/charts.mjs`.');

test('D27: a missing path without (new) is fixed in the plan file; fixed lists it and the check passes', async () => {
  const { dir, file } = await project();
  await writeFile(file, UNMARKED(wellShapedPlan()));
  const r = await checkPlan(file, { projectDir: dir, perspectives: PERSPECTIVES });
  assert.deepEqual(r.fixed, [{ check: 'paths', detail: 'marked src/charts.mjs (new)' }]);
  assert.equal(r.ok, true);
  assert.equal(r.passed, 8);
  assert.match(await readFile(file, 'utf8'), /lives in `src\/charts\.mjs` \(new\)\./);
});

test('D27: a judgement check still fails after the mechanical fix', async () => {
  const { dir, file } = await project();
  await writeFile(file, UNMARKED(wellShapedPlan({ failing: 'testable' })));
  const r = await checkPlan(file, { projectDir: dir, perspectives: PERSPECTIVES });
  assert.equal(r.fixed.length, 1);
  assert.equal(byId(r, 'paths').pass, true);
  assert.equal(byId(r, 'testable').pass, false);
  assert.equal(r.ok, false);
});

test('D27: a clean plan has fixed [] and its file is not rewritten; workspace runs (projectDir null) never fix', async () => {
  const { dir, file } = await project();
  const before = await readFile(file, 'utf8');
  assert.deepEqual((await checkPlan(file, { projectDir: dir, perspectives: PERSPECTIVES })).fixed, []);
  assert.equal(await readFile(file, 'utf8'), before);
  await writeFile(file, UNMARKED(before));
  assert.deepEqual((await checkPlan(file, { projectDir: null, perspectives: PERSPECTIVES })).fixed, []);
  assert.equal(await readFile(file, 'utf8'), UNMARKED(before));
});
