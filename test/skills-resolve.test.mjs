// test/skills-resolve.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSkill, collectRequiredSkills, validateSkills } from '../src/core/skills.mjs';

const dirs = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-skills-')); dirs.push(d); return d; };
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

async function seedSkill(root, layerRel, name) {
  const dir = join(root, layerRel, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), `# ${name}\n`);
}

test('resolveSkill: bundle, global, project, and miss in priority order', async () => {
  const repoRoot = await tmp();
  const homeDir = await tmp();
  const projectDir = await tmp();
  const ctx = { repoRoot, homeDir, projectDir };

  // miss
  assert.equal(resolveSkill('imagegen', ctx).source, null);
  // project only
  await seedSkill(projectDir, '.claude/skills', 'imagegen');
  assert.equal(resolveSkill('imagegen', ctx).source, 'project');
  // global shadows project
  await seedSkill(homeDir, '.claude/skills', 'imagegen');
  assert.equal(resolveSkill('imagegen', ctx).source, 'global');
  // bundle shadows all
  await seedSkill(repoRoot, 'skills', 'imagegen');
  const hit = resolveSkill('imagegen', ctx);
  assert.equal(hit.source, 'bundle');
  assert.equal(hit.path, join(repoRoot, 'skills', 'imagegen'));
  assert.equal(hit.searched.length, 3);
});

test('collectRequiredSkills: union across plan nodes, deduped, with attribution', () => {
  const registry = {
    artDirector: { requiresSkills: ['imagegen'] },
    visualIdentityDirector: { requiresSkills: ['imagegen'] },
    planner: {},
  };
  const plan = { steps: [[{ key: 'planner' }], [{ key: 'artDirector' }, { key: 'visualIdentityDirector' }]] };
  assert.deepEqual(collectRequiredSkills(registry, plan), [
    { skill: 'imagegen', requiredBy: ['artDirector', 'visualIdentityDirector'] },
  ]);
});

test('collectRequiredSkills: empty when no node requires a skill', () => {
  const registry = { planner: {}, implementer: {} };
  const plan = { steps: [[{ key: 'planner' }], [{ key: 'implementer' }]] };
  assert.deepEqual(collectRequiredSkills(registry, plan), []);
});

test('collectRequiredSkills: ignores skills from agents not in the plan', () => {
  const registry = { artDirector: { requiresSkills: ['imagegen'] }, planner: {} };
  const plan = { steps: [[{ key: 'planner' }]] }; // artDirector absent from plan
  assert.deepEqual(collectRequiredSkills(registry, plan), []);
});

test('validateSkills: passes when all resolvable, returns bundle resolutions', async () => {
  const repoRoot = await tmp();
  const projectDir = await tmp();
  const homeDir = await tmp();
  await seedSkill(repoRoot, 'skills', 'imagegen');
  const resolved = validateSkills(
    [{ skill: 'imagegen', requiredBy: ['artDirector'] }],
    { repoRoot, projectDir, homeDir },
  );
  assert.equal(resolved.get('imagegen').source, 'bundle');
});

test('validateSkills: aborts naming agent + skill + searched paths', async () => {
  const repoRoot = await tmp();
  const projectDir = await tmp();
  const homeDir = await tmp();
  assert.throws(
    () => validateSkills([{ skill: 'imagegen', requiredBy: ['artDirector'] }], { repoRoot, projectDir, homeDir }),
    (err) => /imagegen/.test(err.message) && /artDirector/.test(err.message) && /Searched/.test(err.message),
  );
});
