// test/skills-inject.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSkills, injectSkills } from '../src/core/skills.mjs';

const dirs = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-inject-')); dirs.push(d); return d; };
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

test('injectSkills copies a bundle skill into each TARGET .claude/skills (creating parents)', async () => {
  const repoRoot = await tmp();
  const projectDir = await tmp();
  // seed bundle: repoRoot/skills/imagegen/{SKILL.md,scripts/generate_image.py}
  await mkdir(join(repoRoot, 'skills', 'imagegen', 'scripts'), { recursive: true });
  await writeFile(join(repoRoot, 'skills', 'imagegen', 'SKILL.md'), '# imagegen\n');
  await writeFile(join(repoRoot, 'skills', 'imagegen', 'scripts', 'generate_image.py'), 'print("x")\n');

  const wtA = await tmp(); // fresh dirs with NO .claude/ — cp recursive must create it
  const wtB = await tmp();
  const resolved = validateSkills(
    [{ skill: 'imagegen', requiredBy: ['artDirector'] }],
    { repoRoot, projectDir, homeDir: await tmp() },
  );
  const injected = await injectSkills(resolved, { targets: [wtA, wtB] });

  assert.deepEqual(injected, ['imagegen']);
  for (const wt of [wtA, wtB]) {
    await assert.doesNotReject(access(join(wt, '.claude', 'skills', 'imagegen', 'SKILL.md')));
    await assert.doesNotReject(access(join(wt, '.claude', 'skills', 'imagegen', 'scripts', 'generate_image.py')));
  }
});

test('injectSkills skips global/project sources (nothing to copy)', async () => {
  const repoRoot = await tmp();
  const projectDir = await tmp();
  const homeDir = await tmp();
  // seed ONLY a global skill
  await mkdir(join(homeDir, '.claude', 'skills', 'imagegen'), { recursive: true });
  await writeFile(join(homeDir, '.claude', 'skills', 'imagegen', 'SKILL.md'), '# imagegen\n');
  const resolved = validateSkills([{ skill: 'imagegen', requiredBy: ['artDirector'] }], { repoRoot, projectDir, homeDir });
  const wt = await tmp();
  const injected = await injectSkills(resolved, { targets: [wt] });
  assert.deepEqual(injected, []); // global already on scan path
  await assert.rejects(access(join(wt, '.claude', 'skills', 'imagegen'))); // nothing copied
});

// Phase 3 (§5.6): the parameter is `targets`, not `worktrees`, because a detached
// WORKSPACE run mounts ONCE at the run root instead of once per member worktree.
// The function itself is target-agnostic; the orchestrator decides what a target is.
test('injectSkills takes { targets } and accepts a single non-worktree target (the run root)', async () => {
  const repoRoot = await tmp();
  const projectDir = await tmp();
  await mkdir(join(repoRoot, 'skills', 'imagegen'), { recursive: true });
  await writeFile(join(repoRoot, 'skills', 'imagegen', 'SKILL.md'), '# imagegen\n');
  const resolved = validateSkills(
    [{ skill: 'imagegen', requiredBy: ['artDirector'] }],
    { repoRoot, projectDir, homeDir: await tmp() },
  );
  const runRoot = await tmp();
  assert.deepEqual(await injectSkills(resolved, { targets: [runRoot] }), ['imagegen']);
  await assert.doesNotReject(access(join(runRoot, '.claude', 'skills', 'imagegen', 'SKILL.md')));
});

test('injectSkills with no targets copies nothing but still reports what WOULD be injected', async () => {
  const repoRoot = await tmp();
  await mkdir(join(repoRoot, 'skills', 'imagegen'), { recursive: true });
  await writeFile(join(repoRoot, 'skills', 'imagegen', 'SKILL.md'), '# imagegen\n');
  const resolved = validateSkills(
    [{ skill: 'imagegen', requiredBy: ['artDirector'] }],
    { repoRoot, projectDir: await tmp(), homeDir: await tmp() },
  );
  // The legacy call site filters out projectDir, so an empty list is reachable
  // (a run whose workDir IS the projectDir) and must not throw.
  assert.deepEqual(await injectSkills(resolved, { targets: [] }), ['imagegen']);
  assert.deepEqual(await injectSkills(resolved, {}), ['imagegen']);
});

// ── S2: the skill-name shape guard ──────────────────────────────────────────
// A skill name becomes a PATH SEGMENT twice — `injectSkills`' `join(t, '.claude',
// 'skills', skill)` and `assembleSkills`' `join(target, effective)` — and it arrives
// from agent frontmatter (`requiresSkills`) or, on resume, from a disk-read
// `run.json.skillResolutions`. `createWorktree` already guards its two path segments
// (pipelineId, checkoutName) with exactly this regex plus the dot cases; this is the
// same standard applied at the declared-skill choke point. LOUD here (preflight,
// before any node runs) is right: a traversing name in an agent's frontmatter is an
// authoring bug the user must see, not something to quietly drop.

test('S2: validateSkills REJECTS a traversing / dotted / empty skill name, loudly', async () => {
  const ctx = { repoRoot: await tmp(), projectDir: await tmp(), homeDir: await tmp() };
  for (const bad of ['../../x', '..', '.', 'a/b', '/etc/passwd', 'a\\b', 'x y', '']) {
    assert.throws(
      () => validateSkills([{ skill: bad, requiredBy: ['artDirector'] }], ctx),
      /invalid skill name/i,
      `must reject ${JSON.stringify(bad)}`,
    );
  }
});

test('S2: the invalid-name abort names every offender and its requiring agent(s)', async () => {
  const ctx = { repoRoot: await tmp(), projectDir: await tmp(), homeDir: await tmp() };
  let err = null;
  try {
    validateSkills(
      [{ skill: '../escape', requiredBy: ['artDirector'] }, { skill: '..', requiredBy: ['planner', 'zed'] }],
      ctx,
    );
  } catch (e) { err = e; }
  assert.ok(err, 'it throws');
  assert.match(err.message, /\.\.\/escape/);
  assert.match(err.message, /artDirector/);
  assert.match(err.message, /planner, zed/);
  // The shape guard runs BEFORE the unresolvable check, so a traversal is always
  // reported as a traversal and never masked by a "not found" listing.
  assert.doesNotMatch(err.message, /Searched:/);
});

test('S2: an invalid name is rejected even when an UNRESOLVABLE name is also present', async () => {
  const ctx = { repoRoot: await tmp(), projectDir: await tmp(), homeDir: await tmp() };
  assert.throws(
    () => validateSkills(
      [{ skill: 'nope', requiredBy: ['a'] }, { skill: '../../x', requiredBy: ['b'] }], ctx,
    ),
    /invalid skill name/i,
  );
});

test('S2: legal names (dots, dashes, underscores, digits) still resolve unchanged', async () => {
  const repoRoot = await tmp();
  const legal = ['imagegen', 'my.skill-1_v2', '_x', 'A-B.c'];
  for (const name of legal) {
    await mkdir(join(repoRoot, 'skills', name), { recursive: true });
    await writeFile(join(repoRoot, 'skills', name, 'SKILL.md'), `# ${name}\n`);
  }
  const resolved = validateSkills(
    legal.map((s) => ({ skill: s, requiredBy: ['a'] })),
    { repoRoot, projectDir: await tmp(), homeDir: await tmp() },
  );
  assert.deepEqual([...resolved.keys()].sort(), ['A-B.c', '_x', 'imagegen', 'my.skill-1_v2']);
});
