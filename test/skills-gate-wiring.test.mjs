// test/skills-gate-wiring.test.mjs
// Proves the orchestrator's gate composition (collect -> validate) throws loudly
// on a missing skill, using the same calls run() makes, without spawning claude.
//
// Phase 3 adds the WIRING GUARD for this phase's one catastrophic failure mode. The
// `requiresSkills` gate is false on EVERY shipped workflow (`grep requiresSkills
// agents/` → zero hits), so if context assembly is ever nested back inside
// `if (requiredSkills.length) { … }` the result is: no CLAUDE.md, no mcp.json, no
// skill mount, no --mcp-config on any default pipeline — R1(a)-(d) and R2 silently
// void — while `npm test` and both mock smokes stay green. Case (1) below is the
// test that fails when that happens.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectRequiredSkills, validateSkills } from '../src/core/skills.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { readRunManifest } from '../src/core/run-manifest.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { fileURLToPath } from 'node:url';

/** appendAudit writes pipeline_events rows, not a file (artifacts.mjs:920). */
function auditText(pipelineId) {
  return getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id')
    .all(pipelineId).map((r) => r.text).join('\n');
}

useTempHome(after);

const dirs = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-gate-')); dirs.push(d); return d; };
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

const HERMETIC_PROJECTS_ROOT = mkdtempSync(join(tmpdir(), 'worca-cc-gate-proot-'));
after(() => rmSync(HERMETIC_PROJECTS_ROOT, { recursive: true, force: true }));

/** MODE PINNING (§6 intro): the default is `legacy` through Phase 4. */
async function withMode(mode, fn) {
  const prev = process.env.WORCA_RUN_ROOT;
  const prevRoot = process.env.WORCA_PROJECTS_ROOT;
  process.env.WORCA_RUN_ROOT = mode;
  process.env.WORCA_PROJECTS_ROOT = HERMETIC_PROJECTS_ROOT;
  try { return await fn(); }
  finally {
    if (prev === undefined) delete process.env.WORCA_RUN_ROOT;
    else process.env.WORCA_RUN_ROOT = prev;
    if (prevRoot === undefined) delete process.env.WORCA_PROJECTS_ROOT;
    else process.env.WORCA_PROJECTS_ROOT = prevRoot;
  }
}

async function freshRepo() {
  const dir = await tmp();
  const g = (args) => spawnSync('git', args, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'seed.txt'), 'seed\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}

test('gate: a plan whose agent requires a missing skill throws before any node', async () => {
  const registry = { artDirector: { requiresSkills: ['imagegen'] } };
  const plan = { steps: [[{ key: 'artDirector' }]] };
  const required = collectRequiredSkills(registry, plan);
  assert.deepEqual(required, [{ skill: 'imagegen', requiredBy: ['artDirector'] }]);
  // repoRoot/projectDir/homeDir all empty => unresolvable => throw
  const ctx = { repoRoot: await tmp(), projectDir: await tmp(), homeDir: await tmp() };
  assert.throws(() => validateSkills(required, ctx), /imagegen/);
});

test('gate: a plan that requires no skills produces an empty set (no gate, no inject)', () => {
  const registry = { planner: {}, implementer: {} };
  const plan = { steps: [[{ key: 'planner' }], [{ key: 'implementer' }]] };
  assert.deepEqual(collectRequiredSkills(registry, plan), []);
});

// ── Phase 3: the three wiring cases against the restructured :544+ region ─────

const REAL_AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url));

/** A copy of the real agents dir with `requiresSkills` added to the implementer. */
async function agentsDirRequiring(skills) {
  const { cp } = await import('node:fs/promises');
  const dir = join(await tmp(), 'agents');
  await cp(REAL_AGENTS_DIR, dir, { recursive: true });
  const file = join(dir, 'implementer.meta.json');
  const meta = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...meta, requiresSkills: skills }, null, 2));
  return dir;
}

// (1) THE guard for this phase's catastrophic failure mode.
test('detached + ZERO required skills (the default workflow) still assembles the run context exactly once', async () => {
  const repo = await freshRepo();
  await writeFile(join(repo, 'CLAUDE.md'), '# memory\nZERO-SKILL-TOKEN\n');
  await withMode('detached', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    // Spy on the real method, then delegate: we assert the CALL and its argument,
    // and still let assembly actually happen so the files below exist.
    const calls = [];
    const real = orch._assembleContext.bind(orch);
    orch._assembleContext = async (resolutions) => { calls.push(resolutions); return real(resolutions); };

    let live = null;
    orch.on('state', async (s) => {
      if (live || !s.branch?.worktreeDir) return;
      const runRoot = join(worcaHome(), 'runs', s.id);
      const text = await readFile(join(runRoot, 'CLAUDE.md'), 'utf8').catch(() => null);
      if (text) live = { text, manifest: await readRunManifest(runRoot) };
    });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));

    assert.equal(calls.length, 1, 'assembleRunContext runs EXACTLY once per run, unconditionally');
    assert.ok(calls[0] instanceof Map, 'it receives a Map');
    assert.equal(calls[0].size, 0, 'EMPTY — no shipped agent declares requiresSkills');
    assert.ok(live, '<runRoot>/CLAUDE.md exists on a zero-skill run');
    assert.match(live.text, /ZERO-SKILL-TOKEN/);
    assert.equal(live.manifest.bytes.total > 0, true, 'run.json carries the context fields');
    assert.deepEqual(live.manifest.skillResolutions, {});
  });
});

// (2) Declared skills: the validated Map is forwarded, and an unresolvable one still
//     hard-fails before any node.
test('detached + declared skills forwards the validated resolutions and mounts them', async () => {
  const repo = await freshRepo();
  const agentsDir = await agentsDirRequiring(['worca']);      // a REAL bundled skill
  await withMode('detached', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true },
      branch: { source: 'main' }, agentsDir,
    });
    const calls = [];
    const real = orch._assembleContext.bind(orch);
    orch._assembleContext = async (r) => { calls.push(r); return real(r); };
    let live = null;
    orch.on('state', async (s) => {
      if (live || !s.branch?.worktreeDir) return;
      const runRoot = join(worcaHome(), 'runs', s.id);
      const m = await readRunManifest(runRoot);
      if (m?.injectedSkillNames) {
        live = { m, mounted: existsSync(join(s.branch.worktreeDir, '.claude', 'skills', 'worca', 'SKILL.md')) };
      }
    });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].get('worca')?.source, 'bundle', 'the VALIDATED resolutions Map is forwarded');
    assert.ok(live, 'the manifest was readable during the run');
    assert.ok(live.mounted, 'the bundle skill is delivered by the assembly mount (§5.6 entry class 3)');
    assert.deepEqual(live.m.injectedSkillNames, ['worca']);
    assert.equal(live.m.skillResolutions.worca.source, 'bundle');
    assert.deepEqual(live.m.skillResolutions.worca.requiredBy, ['implementer']);
  });
});

test('detached + an UNRESOLVABLE declared skill still gates before any node — PAUSES the run, and the gate holds on resume', async () => {
  const repo = await freshRepo();
  const agentsDir = await agentsDirRequiring(['no-such-skill-anywhere']);
  await withMode('detached', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true },
      branch: { source: 'main' }, agentsDir,
    });
    let assembled = 0;
    const real = orch._assembleContext.bind(orch);
    orch._assembleContext = async (r) => { assembled++; return real(r); };
    const res = await orch.run();
    assert.equal(res.status, 'paused', JSON.stringify(res));
    assert.equal(res.reason, 'error');
    assert.match(res.detail, /no-such-skill-anywhere/);
    assert.equal(assembled, 0, 'the gate throws BEFORE assembly, so no context is generated');
    assert.equal(orch.getState().resumePoint?.setupIncomplete, true, 'resume replays the setup — including this gate');
    assert.ok(!orch.getState().steps.some((s) => s.status === 'start' || s.status === 'ok'),
      JSON.stringify(orch.getState().steps));

    // The gate HOLDS on resume: with the skill still missing the replay pauses again
    // on the same cause, and still nothing is assembled or dispatched.
    const saved = readPipelineForResume(orch.getState().id);
    const orch2 = createOrchestrator({
      projectDir: repo, auto: true, claude: { mock: true },
      branch: { source: 'main' }, agentsDir, resume: saved,
    });
    let assembled2 = 0;
    const real2 = orch2._assembleContext.bind(orch2);
    orch2._assembleContext = async (r) => { assembled2++; return real2(r); };
    const res2 = await orch2.resume();
    assert.equal(res2.status, 'paused', JSON.stringify(res2));
    assert.equal(res2.reason, 'error');
    assert.match(res2.detail, /no-such-skill-anywhere/);
    assert.equal(assembled2, 0, 'the replayed gate throws BEFORE the replayed assembly');
    assert.equal(readPipelineForResume(orch.getState().id).row.status, 'paused');
  });
});

// (3) Legacy: no assembly at all, and today's injectSkills delivery + audit line.
test('legacy (pinned) + declared skills: NO assembleRunContext, today\'s worktree injection and audit line', async () => {
  const repo = await freshRepo();
  const agentsDir = await agentsDirRequiring(['worca']);
  await withMode('legacy', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true },
      branch: { source: 'main' }, agentsDir,
    });
    let assembled = 0;
    const real = orch._assembleContext.bind(orch);
    orch._assembleContext = async (r) => { assembled++; return real(r); };
    let mounted = false;
    orch.on('state', (s) => {
      if (mounted || !s.branch?.worktreeDir) return;
      mounted = existsSync(join(s.branch.worktreeDir, '.claude', 'skills', 'worca', 'SKILL.md'));
    });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    assert.equal(assembled, 0, 'legacy runs never assemble a run context (§10 rollback contract)');
    assert.ok(mounted, 'injectSkills({ targets }) delivered it into the worktree, exactly as today');
    assert.equal(orch.runContext, null);
    assert.equal(orch.mcpConfigPath, null);
    // Today's audit line, verbatim — and NO context audit line.
    const audit = auditText(orch.getState().id);
    assert.match(audit, /Skills: injected worca into 1 worktree\(s\)\./);
    assert.doesNotMatch(audit, /^Context: /m, 'and no context audit line');
  });
});
