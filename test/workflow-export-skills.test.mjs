import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyExport } from '../src/core/workflow-export.mjs';
import { readPluginsLock, writePluginsLock, pluginDir } from '../src/core/plugins-lock.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeKeyGraph, createV2Agent } from './helpers/export-fixtures.mjs';

useTempHome(after);

const dirs = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'wf-exp-sk-')); dirs.push(d); return d; };
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

const MOCK_SKILL_MD = '---\nname: mock-skill\ndescription: a mock dependency skill\n---\n\nBody of the mock skill.\n';

// Register a fixture agent that declares requiresSkills (no built-in does) and a
// workflow that references it, then return the workflow id.
async function fixtureWorkflow(name) {
  await createV2Agent({
    key: 'depNode', displayName: 'Dep Node', description: 'needs a skill',
    runnerType: 'producer', order: 50, requiresSkills: ['mock-skill'],
    markdown: '---\nname: depNode\n---\n# Dep Node\n\nDoes work that needs mock-skill.\n',
  });
  const tpl = await writeKeyGraph({ name, keys: ['depNode'] });
  return tpl.id;
}

async function makeBundle(withSkill) {
  const bundle = await tmp();
  if (withSkill) {
    await mkdir(join(bundle, 'skills', 'mock-skill'), { recursive: true });
    await writeFile(join(bundle, 'skills', 'mock-skill', 'SKILL.md'), MOCK_SKILL_MD, 'utf8');
  }
  return bundle;
}

test('resolvable dep is copied verbatim (no stamp) when missing at dest', async () => {
  const id = await fixtureWorkflow('Skill Fill');
  const dest = await tmp();
  const repoRoot = await makeBundle(true);
  await applyExport({ workflowId: id, destination: 'project', projectDir: dest, onConflict: 'overwrite', repoRoot });
  const filled = await readFile(join(dest, '.claude/skills/mock-skill/SKILL.md'), 'utf8');
  assert.equal(filled, MOCK_SKILL_MD, 'dep skill copied byte-identically from the bundle');
  assert.doesNotMatch(filled, /worca-cc-export:/, 'dep skill carries NO export stamp (third-party carve-out)');
});

test('dep already at destination scope is left untouched (fill:false, not rewritten)', async () => {
  const id = await fixtureWorkflow('Skill Present');
  const dest = await tmp();
  const repoRoot = await makeBundle(true);
  // Pre-place a DIFFERENT mock-skill at the destination; resolve-and-fill must not overwrite it.
  const existing = MOCK_SKILL_MD + '\nlocally customized\n';
  await mkdir(join(dest, '.claude/skills/mock-skill'), { recursive: true });
  await writeFile(join(dest, '.claude/skills/mock-skill/SKILL.md'), existing, 'utf8');
  const result = await applyExport({ workflowId: id, destination: 'project', projectDir: dest, onConflict: 'overwrite', repoRoot });
  assert.equal(await readFile(join(dest, '.claude/skills/mock-skill/SKILL.md'), 'utf8'), existing);
  assert.equal(result.written.some((p) => p.includes('skills/mock-skill/')), false, 'present dep is not rewritten');
});

// REGRESSION GUARD: filling a dep skill copies its dir but must NEVER clobber a same-named file
// the user already had there (the dir is filled only because its SKILL.md was absent).
test('filling a dep skill never clobbers a same-named user file in that skill dir', async () => {
  const id = await fixtureWorkflow('Skill NoClobber');
  const dest = await tmp();
  const repoRoot = await tmp();
  // Bundle mock-skill carries SKILL.md + helper.txt.
  await mkdir(join(repoRoot, 'skills', 'mock-skill'), { recursive: true });
  await writeFile(join(repoRoot, 'skills', 'mock-skill', 'SKILL.md'), MOCK_SKILL_MD, 'utf8');
  await writeFile(join(repoRoot, 'skills', 'mock-skill', 'helper.txt'), 'BUNDLE VERSION', 'utf8');
  // Dest skill dir already holds a user-edited helper.txt but NO SKILL.md → resolve-and-fill fills it.
  await mkdir(join(dest, '.claude/skills/mock-skill'), { recursive: true });
  await writeFile(join(dest, '.claude/skills/mock-skill/helper.txt'), 'USER VERSION', 'utf8');
  await applyExport({ workflowId: id, destination: 'project', projectDir: dest, onConflict: 'overwrite', repoRoot });
  assert.equal(await readFile(join(dest, '.claude/skills/mock-skill/helper.txt'), 'utf8'), 'USER VERSION', 'user file preserved');
  assert.match(await readFile(join(dest, '.claude/skills/mock-skill/SKILL.md'), 'utf8'), /mock dependency skill/, 'SKILL.md still filled');
});

// REGRESSION GUARD (#1): a PLUGIN-bundled dep skill (required by a plugin-origin agent) must
// resolve at export — resolveDepSkills has to pass pluginDirs + the agent's plugin origin into
// resolveSkill, exactly as the orchestrator does at run time. Without them, this threw
// MISSING_SKILL even though the same workflow RUNS fine.
function installPluginWithSkill(name) {
  const versionDir = join(pluginDir(name), 'versions', 'abc1234');
  mkdirSync(join(versionDir, 'agents'), { recursive: true });
  writeFileSync(join(versionDir, 'agents', 'pDep.md'), '---\nname: p-dep\n---\n# pDep\nNeeds plugin-skill.\n');
  writeFileSync(join(versionDir, 'agents', 'pDep.meta.json'), JSON.stringify({
    metaVersion: 2, key: 'pDep', displayName: 'Plugin Dep', agentFile: 'pDep.md', runnerType: 'producer',
    order: 50, inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'out', type: 'md', filename: 'pdep.md' }],
    requiresSkills: ['plugin-skill'],
  }));
  mkdirSync(join(versionDir, 'skills', 'plugin-skill'), { recursive: true });
  writeFileSync(join(versionDir, 'skills', 'plugin-skill', 'SKILL.md'),
    '---\nname: plugin-skill\ndescription: a plugin-bundled dependency skill\n---\n\nPlugin skill body.\n');
  symlinkSync(versionDir, join(pluginDir(name), 'current'), process.platform === 'win32' ? 'junction' : 'dir');
  writePluginsLock({ ...readPluginsLock(), [name]: {
    repo: 'https://example.com/p.git', subdir: name, pinnedSha: 'a'.repeat(40),
    version: '0.1.0', enabled: true, installedAt: '2026-07-12T00:00:00.000Z',
  } });
}

test('a plugin-bundled dep skill resolves and is filled at export', async () => {
  installPluginWithSkill('depplug');
  const tpl = await writeKeyGraph({ name: 'Plugin Dep Flow', keys: ['pDep'] });
  const dest = await tmp();
  const applied = await applyExport({ workflowId: tpl.id, destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  assert.ok(applied.written.some((p) => p.endsWith('skills/plugin-skill/SKILL.md')), 'plugin dep skill filled');
  const filled = await readFile(join(dest, '.claude/skills/plugin-skill/SKILL.md'), 'utf8');
  assert.match(filled, /a plugin-bundled dependency skill/);
});

test('unresolvable dep throws MISSING_SKILL listing searched paths', async () => {
  const id = await fixtureWorkflow('Skill Missing');
  const dest = await tmp();
  const repoRoot = await makeBundle(false); // bundle without the skill; not at dest either
  await assert.rejects(
    applyExport({ workflowId: id, destination: 'project', projectDir: dest, onConflict: 'overwrite', repoRoot }),
    (e) => e.code === 'MISSING_SKILL' && /mock-skill/.test(e.message) && /Searched:/.test(e.message),
  );
});
