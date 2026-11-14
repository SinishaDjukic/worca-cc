// test/run-landings-skills.test.mjs — recurring-task skills land in a project-owned set.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshHomes } from './helpers/mcp-store-fixtures.mjs';
import { librarySkill } from './helpers/skill-sets.mjs';

freshHomes(after);
const { landSkills } = await import('../src/core/run-landings-skills.mjs');
const { readMcpStore, createSet, setProjectAssignment } = await import('../src/core/mcp/store.mjs');
const { readSkillLibrary, skillsDir } = await import('../src/core/skills-registry/library.mjs');

const KEY = 'shop-0123abcd'; // satisfies PROJECT_KEY_RE (src/core/store.mjs)
function skillDir(pipelineDir, name, body = 'steps') {
  const d = join(pipelineDir, 'readiness-worca-skills', name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: Use when adding a route\n---\n${body}\n`);
  return d;
}

test('case 1: a new skill is imported, put in the readiness set, and the set is assigned', async () => {
  const pd = mkdtempSync(join(tmpdir(), 'pd-'));
  const r = await landSkills({ projectKey: KEY, projectName: 'Shop', pipelineDir: pd, skills: [{ name: 'add-route', dir: skillDir(pd, 'add-route') }] });
  assert.deepEqual(r.skipped, []);
  assert.ok(readSkillLibrary().skills['add-route']);
  const store = await readMcpStore();
  const set = Object.entries(store.sets).map(([id, s]) => ({ id, ...s })).find((s) => s.name === 'AI readiness: Shop');
  assert.ok(set);
  assert.ok(set.skills.some((k) => k.skill === 'skill:library:add-route' && k.enabled === true));
  assert.ok(store.projects[KEY].sets.includes(set.id));
});

test('case 2: the project keeps its other sets and its General choice', async () => {
  const other = await createSet('Billing');
  await setProjectAssignment(KEY, { sets: [other.id], includeGeneral: false });
  const pd = mkdtempSync(join(tmpdir(), 'pd-'));
  await landSkills({ projectKey: KEY, projectName: 'Shop', pipelineDir: pd, skills: [{ name: 'add-route', dir: skillDir(pd, 'add-route') }] });
  const store = await readMcpStore();
  const ready = Object.entries(store.sets).find(([, s]) => s.name === 'AI readiness: Shop')[0];
  assert.ok(store.projects[KEY].sets.includes(other.id));
  assert.ok(store.projects[KEY].sets.includes(ready));
  assert.equal(store.projects[KEY].includeGeneral, false);
});

test('case 3: re-landing replaces a skill already in the readiness set', async () => {
  const pd = mkdtempSync(join(tmpdir(), 'pd-'));
  await landSkills({ projectKey: KEY, projectName: 'Shop', pipelineDir: pd, skills: [{ name: 'add-model', dir: skillDir(pd, 'add-model', 'v1') }] });
  const pd2 = mkdtempSync(join(tmpdir(), 'pd-'));
  const r = await landSkills({ projectKey: KEY, projectName: 'Shop', pipelineDir: pd2, skills: [{ name: 'add-model', dir: skillDir(pd2, 'add-model', 'v2') }] });
  assert.deepEqual(r.skipped, []);
  assert.match(readFileSync(join(skillsDir(), 'add-model', 'SKILL.md'), 'utf8'), /v2/);
});

test('case 4: a library skill of the same name outside the set is never overwritten; this one lands as <name>-<key end>', async () => {
  await librarySkill('lint-fix'); // an unrelated user skill
  const before = readFileSync(join(skillsDir(), 'lint-fix', 'SKILL.md'), 'utf8');
  const pd = mkdtempSync(join(tmpdir(), 'pd-'));
  const r = await landSkills({ projectKey: KEY, projectName: 'Shop', pipelineDir: pd, skills: [{ name: 'lint-fix', dir: skillDir(pd, 'lint-fix') }] });
  assert.deepEqual(r.skipped, []);
  assert.match(r.landed[0], /^skill lint-fix-0123abcd \(set "AI readiness: Shop"\)$/);
  assert.equal(readFileSync(join(skillsDir(), 'lint-fix', 'SKILL.md'), 'utf8'), before);
  assert.match(readFileSync(join(skillsDir(), 'lint-fix-0123abcd', 'SKILL.md'), 'utf8'), /^---\nname: lint-fix-0123abcd\n/);
  // The run's own folder is never edited.
  assert.match(readFileSync(join(pd, 'readiness-worca-skills', 'lint-fix', 'SKILL.md'), 'utf8'), /^---\nname: lint-fix\n/);
  // Landing again replaces the suffixed copy; the user's skill still stays as it was.
  const pd2 = mkdtempSync(join(tmpdir(), 'pd-'));
  const r2 = await landSkills({ projectKey: KEY, projectName: 'Shop', pipelineDir: pd2, skills: [{ name: 'lint-fix', dir: skillDir(pd2, 'lint-fix', 'again') }] });
  assert.deepEqual(r2.skipped, []);
  assert.match(r2.landed[0], /lint-fix-0123abcd/);
  assert.match(readFileSync(join(skillsDir(), 'lint-fix-0123abcd', 'SKILL.md'), 'utf8'), /again/);
  assert.equal(readFileSync(join(skillsDir(), 'lint-fix', 'SKILL.md'), 'utf8'), before);
});

test('when the suffixed name is taken outside the set too, the skill is skipped', async () => {
  await librarySkill('fmt-code');
  await librarySkill('fmt-code-0123abcd');
  const pd = mkdtempSync(join(tmpdir(), 'pd-'));
  const r = await landSkills({ projectKey: KEY, projectName: 'Shop', pipelineDir: pd, skills: [{ name: 'fmt-code', dir: skillDir(pd, 'fmt-code') }] });
  assert.equal(r.landed.length, 0);
  assert.match(r.skipped[0], /fmt-code: name taken by a library skill outside this project's set/);
});

test('a relative skill dir resolves against the run directory', async () => {
  const pd = mkdtempSync(join(tmpdir(), 'pd-'));
  skillDir(pd, 'rel-skill');
  const r = await landSkills({ projectKey: KEY, projectName: 'Shop', pipelineDir: pd, skills: [{ name: 'rel-skill', dir: 'readiness-worca-skills/rel-skill' }] });
  assert.deepEqual(r.skipped, []);
  assert.ok(readSkillLibrary().skills['rel-skill']);
});

test('a skill dir outside the run directory is refused', async () => {
  const pd = mkdtempSync(join(tmpdir(), 'pd-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'x-'));
  const r = await landSkills({ projectKey: KEY, projectName: 'Shop', pipelineDir: pd, skills: [{ name: 'evil', dir: elsewhere }] });
  assert.match(r.skipped[0], /outside the run/);
});

test('a symlinked skill dir that points outside the run directory is refused', async () => {
  const pd = mkdtempSync(join(tmpdir(), 'pd-'));
  const outside = mkdtempSync(join(tmpdir(), 'x-'));
  writeFileSync(join(outside, 'SKILL.md'), '---\nname: sneaky\ndescription: Use when sneaking\n---\nsteps\n');
  const link = join(pd, 'sneaky');
  symlinkSync(outside, link);
  const r = await landSkills({ projectKey: KEY, projectName: 'Shop', pipelineDir: pd, skills: [{ name: 'sneaky', dir: link }] });
  assert.match(r.skipped[0], /outside the run/);
  assert.equal(readSkillLibrary().skills.sneaky, undefined);
});

test('a project name longer than the set-name limit still lands', async () => {
  const pd = mkdtempSync(join(tmpdir(), 'pd-'));
  const r = await landSkills({ projectKey: KEY, projectName: 'A very long project name that goes past forty characters', pipelineDir: pd, skills: [{ name: 'add-route', dir: skillDir(pd, 'add-route') }] });
  assert.deepEqual(r.skipped, []);
  assert.equal(r.landed.length, 1);
});

test('a second project with the same name gets its own set and lands its colliding skill under its own name', async () => {
  const pd = mkdtempSync(join(tmpdir(), 'pd-'));
  await landSkills({ projectKey: KEY, projectName: 'Shop', pipelineDir: pd, skills: [{ name: 'add-route', dir: skillDir(pd, 'add-route', 'first') }] });
  const KEY2 = 'shop-0badf00d';
  const pd2 = mkdtempSync(join(tmpdir(), 'pd-'));
  const r = await landSkills({ projectKey: KEY2, projectName: 'Shop', pipelineDir: pd2, skills: [{ name: 'add-route', dir: skillDir(pd2, 'add-route', 'second') }] });
  assert.deepEqual(r.skipped, []);
  assert.match(r.landed[0], /^skill add-route-0badf00d /);
  assert.match(readFileSync(join(skillsDir(), 'add-route', 'SKILL.md'), 'utf8'), /first/);
  assert.match(readFileSync(join(skillsDir(), 'add-route-0badf00d', 'SKILL.md'), 'utf8'), /second/);
  const store = await readMcpStore();
  assert.equal(Object.values(store.sets).filter((s) => /^AI readiness: Shop/.test(s.name)).length, 2);
});

test('two workspace members sharing a task id both land, each in its own set, and re-landing never duplicates', async () => {
  const A = 'api-11111111';
  const B = 'web-22222222';
  const land = async (key, projectName, body) => {
    const pd = mkdtempSync(join(tmpdir(), 'pd-'));
    return landSkills({ projectKey: key, projectName, pipelineDir: pd, skills: [{ name: 'add-endpoint', dir: skillDir(pd, 'add-endpoint', body) }] });
  };
  const ra = await land(A, 'Api', 'a1');
  const rb = await land(B, 'Web', 'b1');
  assert.deepEqual([ra.skipped, rb.skipped], [[], []]);
  assert.match(ra.landed[0], /^skill add-endpoint \(set "AI readiness: Api"\)$/);
  assert.match(rb.landed[0], /^skill add-endpoint-22222222 \(set "AI readiness: Web"\)$/);
  const setOf = (store, key) => store.projects[key].sets.map((id) => store.sets[id]).find((s) => /^AI readiness: /.test(s.name));
  let store = await readMcpStore();
  assert.deepEqual(setOf(store, A).skills.map((k) => k.skill), ['skill:library:add-endpoint']);
  assert.deepEqual(setOf(store, B).skills.map((k) => k.skill), ['skill:library:add-endpoint-22222222']);
  // Re-landing both replaces in place.
  const ra2 = await land(A, 'Api', 'a2');
  const rb2 = await land(B, 'Web', 'b2');
  assert.deepEqual([ra2.skipped, rb2.skipped], [[], []]);
  assert.match(ra2.landed[0], /^skill add-endpoint /);
  assert.match(rb2.landed[0], /^skill add-endpoint-22222222 /);
  assert.match(readFileSync(join(skillsDir(), 'add-endpoint', 'SKILL.md'), 'utf8'), /a2/);
  assert.match(readFileSync(join(skillsDir(), 'add-endpoint-22222222', 'SKILL.md'), 'utf8'), /b2/);
  store = await readMcpStore();
  assert.deepEqual(setOf(store, A).skills.map((k) => k.skill), ['skill:library:add-endpoint']);
  assert.deepEqual(setOf(store, B).skills.map((k) => k.skill), ['skill:library:add-endpoint-22222222']);
  assert.deepEqual(Object.keys(readSkillLibrary().skills).filter((n) => n.startsWith('add-endpoint')).sort(), ['add-endpoint', 'add-endpoint-22222222']);
});

test('a 64-character task id is clipped so the suffixed name still fits the skill-name limit', async () => {
  const long = `${'a'.repeat(55)}-${'b'.repeat(8)}`; // 64 characters
  await librarySkill(long);
  const pd = mkdtempSync(join(tmpdir(), 'pd-'));
  const r = await landSkills({ projectKey: KEY, projectName: 'Shop', pipelineDir: pd, skills: [{ name: long, dir: skillDir(pd, long) }] });
  assert.deepEqual(r.skipped, []);
  const landedAs = `${'a'.repeat(55)}-0123abcd`;
  assert.equal(landedAs.length, 64);
  assert.ok(readSkillLibrary().skills[landedAs]);
});

test('a skill folder holding a secret-looking value never reaches the library', async () => {
  const pd = mkdtempSync(join(tmpdir(), 'pd-'));
  const token = 'ghp_' + 'Ab1'.repeat(12);   // built at runtime: a token-shaped literal trips push protection
  const d = skillDir(pd, 'leaky-skill');
  mkdirSync(join(d, 'scripts'));
  writeFileSync(join(d, 'scripts', 'run.sh'), `curl -H "Authorization: token ${token}" https://api.example.invalid\n`);
  const r = await landSkills({ projectKey: KEY, projectName: 'Shop', pipelineDir: pd, skills: [{ name: 'leaky-skill', dir: d }] });
  assert.equal(readSkillLibrary().skills['leaky-skill'], undefined);
  assert.ok(r.skipped.some((s) => /leaky-skill: .*secret-looking value.*scripts\/run\.sh/.test(s)), r.skipped.join('; '));
});
