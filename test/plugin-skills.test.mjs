// test/plugin-skills.test.mjs
// Plugin layer in skill resolution (spec §9.2): the plugin OWNING the requesting
// agent is searched FIRST; for everyone else plugin dirs come AFTER
// bundle -> global -> project. injectSkills copies plugin-sourced skills
// (helper scripts included) into worktrees exactly like bundle skills.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  resolveSkill, collectRequiredSkills, validateSkills, injectSkills, pluginSkillDirs,
} from '../src/core/skills.mjs';
import { writePluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';

useTempHome(after); // only the pluginSkillDirs test reads the home; harmless for the rest

const dirs = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-pskills-')); dirs.push(d); return d; };
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

async function seedSkill(root, layerRel, name, extraFiles = {}) {
  const dir = join(root, layerRel, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), `# ${name}\n`);
  for (const [rel, body] of Object.entries(extraFiles)) {
    await mkdir(join(dir, rel, '..'), { recursive: true });
    await writeFile(join(dir, rel), body);
  }
}

test('the owning plugin\'s skill wins over an identically named bundle skill for that plugin\'s agent', async () => {
  const repoRoot = await tmp(); const projectDir = await tmp(); const homeDir = await tmp();
  const pdir = await tmp(); // stands in for <plugins>/pdf-source/current/skills
  await seedSkill(repoRoot, 'skills', 'convert');
  await seedSkill(pdir, '', 'convert');
  const hit = resolveSkill('convert', {
    repoRoot, projectDir, homeDir,
    pluginDirs: [{ plugin: 'pdf-source', dir: pdir }],
    origin: 'plugin:pdf-source',
  });
  assert.equal(hit.source, 'plugin:pdf-source');
  assert.equal(hit.path, join(pdir, 'convert'));
  assert.equal(hit.searched.length, 4);
  assert.equal(hit.searched[0], join(pdir, 'convert', 'SKILL.md'), 'owner plugin dir searched FIRST');
});

test('for a non-plugin agent the bundle wins; plugin dirs are searched LAST', async () => {
  const repoRoot = await tmp(); const projectDir = await tmp(); const homeDir = await tmp();
  const pdir = await tmp();
  await seedSkill(repoRoot, 'skills', 'convert');
  await seedSkill(pdir, '', 'convert');
  const hit = resolveSkill('convert', {
    repoRoot, projectDir, homeDir,
    pluginDirs: [{ plugin: 'pdf-source', dir: pdir }], // no origin => nobody owns
  });
  assert.equal(hit.source, 'bundle');
  assert.equal(hit.searched.length, 4);
  assert.equal(hit.searched[3], join(pdir, 'convert', 'SKILL.md'), 'non-owner plugin dirs come after bundle/global/project');
});

test('collectRequiredSkills attributes a plugin origin — and OMITS the field otherwise', () => {
  const registry = {
    pdfImporter: { requiresSkills: ['convert'], origin: 'plugin:pdf-source' },
    planner: { requiresSkills: ['graphing'], origin: 'builtin' },
  };
  const plan = { steps: [[{ key: 'pdfImporter' }, { key: 'planner' }]] };
  assert.deepEqual(collectRequiredSkills(registry, plan), [
    { skill: 'convert', requiredBy: ['pdfImporter'], origin: 'plugin:pdf-source' },
    { skill: 'graphing', requiredBy: ['planner'] }, // no origin key at all: legacy shape preserved
  ]);
});

test('validateSkills resolves via the owner plugin and still HARD-FAILS a skill missing everywhere', async () => {
  const repoRoot = await tmp(); const projectDir = await tmp(); const homeDir = await tmp();
  const pdir = await tmp();
  await seedSkill(pdir, '', 'convert');
  const ctx = { repoRoot, projectDir, homeDir, pluginDirs: [{ plugin: 'pdf-source', dir: pdir }] };
  const resolved = validateSkills(
    [{ skill: 'convert', requiredBy: ['pdfImporter'], origin: 'plugin:pdf-source' }], ctx,
  );
  assert.equal(resolved.get('convert').source, 'plugin:pdf-source');
  assert.throws(
    () => validateSkills([{ skill: 'ghost', requiredBy: ['pdfImporter'], origin: 'plugin:pdf-source' }], ctx),
    (err) => /ghost/.test(err.message) && /pdfImporter/.test(err.message) && /Searched/.test(err.message),
  );
});

test('injectSkills copies a plugin-sourced skill (helper script included) into each worktree', async () => {
  const repoRoot = await tmp(); const projectDir = await tmp(); const homeDir = await tmp();
  const pdir = await tmp();
  await seedSkill(pdir, '', 'convert', { 'scripts/convert.py': 'print("x")\n' });
  const ctx = { repoRoot, projectDir, homeDir, pluginDirs: [{ plugin: 'pdf-source', dir: pdir }] };
  const resolved = validateSkills(
    [{ skill: 'convert', requiredBy: ['pdfImporter'], origin: 'plugin:pdf-source' }], ctx,
  );
  const wt = await tmp();
  const injected = await injectSkills(resolved, { targets: [wt] });
  assert.deepEqual(injected, ['convert']);
  await assert.doesNotReject(access(join(wt, '.claude', 'skills', 'convert', 'SKILL.md')));
  await assert.doesNotReject(access(join(wt, '.claude', 'skills', 'convert', 'scripts', 'convert.py')));
});

test('pluginSkillDirs: enabled plugins with an existing current/skills dir, lexicographic', () => {
  // current/ as a real dir is fine here — the reader only joins/probes through it
  // (the symlink shape itself is pinned by test/plugin-agent-registry.test.mjs).
  for (const name of ['zulu', 'alpha']) mkdirSync(join(pluginCurrentDir(name), 'skills'), { recursive: true });
  mkdirSync(join(pluginCurrentDir('dis'), 'skills'), { recursive: true });
  mkdirSync(pluginCurrentDir('bare'), { recursive: true }); // no skills/ inside
  const entry = (enabled) => ({
    repo: 'r', subdir: '.', pinnedSha: 'a'.repeat(40), version: '0.1.0',
    enabled, installedAt: '2026-07-12T00:00:00.000Z',
  });
  writePluginsLock({ zulu: entry(true), alpha: entry(true), dis: entry(false), bare: entry(true) });
  assert.deepEqual(pluginSkillDirs(), [
    { plugin: 'alpha', dir: join(pluginCurrentDir('alpha'), 'skills') },
    { plugin: 'zulu',  dir: join(pluginCurrentDir('zulu'), 'skills') },
  ]);
});
