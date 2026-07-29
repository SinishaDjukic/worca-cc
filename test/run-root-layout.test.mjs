// test/run-root-layout.test.mjs
// Phase 1 (run-root plumbing): the §10 flag reader, the detached worktree layout
// under <worcaHome>/runs/<pipelineId>/repos/<projectKey>, the minimal run.json,
// the §8.13 removal guard, and BOTH sweeps (§8.12).
//
// MODE PINNING (§6 intro): the DEFAULT mode is `legacy` through Phase 4, so every
// mode-sensitive assertion pins process.env.WORCA_RUN_ROOT per test and restores
// it in finally. runRootMode() reads the env fresh on every call and the
// orchestrator consults it exactly once per pipeline (at _setupRunRoot), so a pin
// that lives only for the duration of one test is sufficient AND necessary — the
// Phase-5 default flip must change zero test outcomes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import {
  runRootMode, DEFAULT_RUN_ROOT_MODE, setWorcaRoot, settingsFile,
} from '../src/core/settings.mjs';
import {
  createWorktree, sweepRunRoots, sweepLegacyWorktrees, sweepLegacyWorktreesAll,
  listLocalBranches,
} from '../src/core/worktree.mjs';
import { writeRunManifest, readRunManifest, rmGuarded } from '../src/core/run-manifest.mjs';
import { RESULTS_FILE, DIFF_PATCH_FILE } from '../src/core/results.mjs';
import { runRootSweepLookups, legacySweepLookups } from '../src/core/artifacts.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { _resetForTests } from '../src/core/db.mjs';

useTempHome(after);

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

// realpath: macOS mkdtemp hands back /var/... while git (and createWorktree's own
// base canonicalization) reports /private/var/... — canonicalize here so path
// assertions compare like with like.
async function tmp(prefix = 'worca-cc-rr-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  return realpath(dir);
}

async function freshRepo(prefix = 'worca-cc-rr-repo-') {
  const dir = await tmp(prefix);
  const g = (args) => spawnSync('git', args, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'seed.txt'), 'seed\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}

function branchList(dir) {
  return spawnSync('git', ['-C', dir, 'branch', '--format=%(refname:short)'])
    .stdout.toString().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

// Phase 3's assembleRunContext reads the §5.1 ROOT layer, whose default is the
// developer's real home. Pin it at an empty dir so these orchestrator-driven tests
// stay hermetic (a stray ~/CLAUDE.md must never change an assertion).
const HERMETIC_PROJECTS_ROOT = mkdtempSync(join(tmpdir(), 'worca-cc-rr-proot-'));
after(() => rmSync(HERMETIC_PROJECTS_ROOT, { recursive: true, force: true }));

/** Run `fn` with WORCA_RUN_ROOT pinned, restoring the previous value after. */
async function withMode(mode, fn) {
  const prev = process.env.WORCA_RUN_ROOT;
  const prevRoot = process.env.WORCA_PROJECTS_ROOT;
  if (mode === undefined) delete process.env.WORCA_RUN_ROOT;
  else process.env.WORCA_RUN_ROOT = mode;
  process.env.WORCA_PROJECTS_ROOT = HERMETIC_PROJECTS_ROOT;
  try { return await fn(); }
  finally {
    if (prev === undefined) delete process.env.WORCA_RUN_ROOT;
    else process.env.WORCA_RUN_ROOT = prev;
    if (prevRoot === undefined) delete process.env.WORCA_PROJECTS_ROOT;
    else process.env.WORCA_PROJECTS_ROOT = prevRoot;
  }
}

// ── §10 flag reader: precedence + validation ──────────────────────────────────

test('runRootMode: default is detached (the Phase-5 flip landed)', async () => {
  assert.equal(DEFAULT_RUN_ROOT_MODE, 'detached');
  await withMode(undefined, () => {
    assert.equal(runRootMode(), 'detached');
  });
});

test('runRootMode: WORCA_RUN_ROOT env is honored and read FRESH on every call', async () => {
  await withMode('detached', () => {
    assert.equal(runRootMode(), 'detached');
    // Same process, same module instance: flipping the env must take effect at once
    // (no module-load caching — the whole per-test pinning scheme depends on it).
    process.env.WORCA_RUN_ROOT = 'legacy';
    assert.equal(runRootMode(), 'legacy');
    process.env.WORCA_RUN_ROOT = 'detached';
    assert.equal(runRootMode(), 'detached');
  });
});

test('runRootMode: precedence env > settings.runRootMode > default, + invalid-value fallback', async () => {
  // Sandbox HOME so settingsFile() resolves into a temp dir (mirrors settings.test.mjs).
  const home = await tmp('worca-cc-rr-home-');
  const prev = {
    HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
    WORCA_HOME: process.env.WORCA_HOME,
    ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
    MODE: process.env.WORCA_RUN_ROOT,
  };
  process.env.HOME = home; process.env.USERPROFILE = home;
  delete process.env.WORCA_HOME;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  delete process.env.WORCA_RUN_ROOT;
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    // No settings key, no env -> the code constant.
    assert.equal(runRootMode(), DEFAULT_RUN_ROOT_MODE);

    // settings.runRootMode is read (unknown keys already survive read-modify-write,
    // so it is hand-writable from day one).
    await setWorcaRoot('');                        // ensure the file exists
    const cur = JSON.parse(await readFile(settingsFile(), 'utf8'));
    await writeFile(settingsFile(), JSON.stringify({ ...cur, runRootMode: 'detached' }, null, 2));
    assert.equal(runRootMode(), 'detached', 'settings tier is consulted');

    // env beats settings.
    process.env.WORCA_RUN_ROOT = 'legacy';
    assert.equal(runRootMode(), 'legacy', 'env beats settings');
    delete process.env.WORCA_RUN_ROOT;

    // An invalid value falls back to the default WITH a warning naming it.
    warnings.length = 0;
    await writeFile(settingsFile(), JSON.stringify({ ...cur, runRootMode: 'sideways' }, null, 2));
    assert.equal(runRootMode(), DEFAULT_RUN_ROOT_MODE, 'invalid settings value -> default');
    assert.ok(warnings.some((w) => /invalid run-root mode/.test(w) && /sideways/.test(w)),
      `warning names the bad value: ${JSON.stringify(warnings)}`);

    warnings.length = 0;
    process.env.WORCA_RUN_ROOT = 'DETACHED';        // case-sensitive on purpose
    assert.equal(runRootMode(), DEFAULT_RUN_ROOT_MODE, 'invalid env value -> default');
    assert.ok(warnings.some((w) => /DETACHED/.test(w)), 'warning names the bad env value');
  } finally {
    console.warn = origWarn;
    _resetForTests();
    for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE],
      ['WORCA_HOME', prev.WORCA_HOME], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW],
      ['WORCA_RUN_ROOT', prev.MODE]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    _resetForTests();
  }
});

// ── detached layout: worktrees under the run root, nothing in the project ─────

test('detached: the worktree lands at <worcaHome>/runs/<id>/repos/<projectKey>', async () => {
  const repo = await freshRepo();
  await withMode('detached', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'Add login flow', auto: true, claude: { mock: true },
      branch: { source: 'main' },
    });
    // Capture the worktree path while the run is live (teardown removes it).
    let seen = null;
    orch.on('state', (s) => { if (!seen && s.branch?.worktreeDir) seen = s.branch.worktreeDir; });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    const id = orch.getState().id;
    const expected = join(await realpath(worcaHome()), 'runs', id, 'repos', projectKey(repo));
    assert.equal(seen, expected, `worktree under the run root: ${seen}`);
    assert.equal(orch.getState().branch.runRootMode, 'detached', 'the mode pin rides state.branch');
  });
});

test('detached: NOTHING is created under <projectDir>/.worca-cc', async () => {
  const repo = await freshRepo();
  await withMode('detached', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    assert.ok(!existsSync(join(repo, '.worca-cc')),
      `<projectDir>/.worca-cc must not exist on a detached run: ${join(repo, '.worca-cc')}`);
  });
});

test('legacy (pinned): the worktree stays at <projectDir>/.worca-cc/worktrees/<id>', async () => {
  const repo = await freshRepo();
  await withMode('legacy', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    let seen = null;
    orch.on('state', (s) => { if (!seen && s.branch?.worktreeDir) seen = s.branch.worktreeDir; });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    const id = orch.getState().id;
    assert.match(seen, /\.worca-cc\/worktrees\//, `legacy placement retained: ${seen}`);
    assert.ok(seen.endsWith(join('.worca-cc', 'worktrees', id)), `legacy dir is the pipelineId: ${seen}`);
    assert.ok(!existsSync(join(worcaHome(), 'runs', id)), 'legacy runs create no run root');
  });
});

test('createWorktree: baseDir + checkoutName place the checkout; omitting baseDir keeps the legacy default', async () => {
  const repo = await freshRepo();
  const base = await tmp('worca-cc-rr-base-');
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'pid1', sourceBranch: 'main', featureBranch: 'worca-cc/a-pid1',
    baseDir: join(base, 'repos'), checkoutName: 'my-key',
  });
  assert.equal(wt.worktreeDir, join(base, 'repos', 'my-key'));
  assert.ok(existsSync(join(base, 'repos', 'my-key', 'seed.txt')), 'a real checkout landed there');
  assert.ok(!existsSync(join(repo, '.worca-cc')), 'nothing under the project when baseDir is given');

  // No baseDir/checkoutName -> today's exact path.
  const legacy = await createWorktree({
    projectDir: repo, pipelineId: 'pid2', sourceBranch: 'main', featureBranch: 'worca-cc/b-pid2',
  });
  assert.match(legacy.worktreeDir, /\.worca-cc\/worktrees\/pid2$/);
});

test('createWorktree: the containment guard rejects a traversal-shaped checkoutName', async () => {
  const repo = await freshRepo();
  const base = await tmp('worca-cc-rr-base2-');
  for (const bad of ['../escape', '..', '.', 'a/b', 'a\\b']) {
    await assert.rejects(
      () => createWorktree({
        projectDir: repo, pipelineId: 'ok', sourceBranch: 'main', featureBranch: 'worca-cc/x',
        baseDir: base, checkoutName: bad,
      }),
      /invalid checkout name|escapes base|invalid pipelineId/,
      `expected rejection for checkoutName ${JSON.stringify(bad)}`,
    );
  }
  // Nothing was created for any rejected attempt.
  assert.deepEqual(await readdir(base), []);
});

// ── the minimal run.json ──────────────────────────────────────────────────────

test('detached: _setupRunRoot writes a readable minimal run.json with REAL projectDirs', async () => {
  const repo = await freshRepo();
  await withMode('detached', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    // Read the manifest while the run is live — teardown removes the run root.
    let manifest = null;
    orch.on('state', async (s) => {
      if (manifest || !s.branch?.worktreeDir) return;
      manifest = await readRunManifest(join(worcaHome(), 'runs', s.id));
    });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    assert.ok(manifest, 'run.json was readable during the run');
    assert.equal(manifest.pipelineId, orch.getState().id);
    assert.equal(manifest.runRootMode, 'detached');
    assert.equal(manifest.isWorkspace, false);
    assert.equal(manifest.members.length, 1);
    const m = manifest.members[0];
    assert.equal(m.projectKey, projectKey(repo));
    assert.equal(m.projectDir, repo, 'the REAL repo — what `git worktree remove` needs');
    assert.equal(m.worktreeDir,
      join(await realpath(worcaHome()), 'runs', orch.getState().id, 'repos', m.projectKey));
  });
});

// ── Phase 3 (§9.2): the DEFAULT workflow produces CLAUDE.md + the extended run.json ──
// The default workflow declares ZERO skills (`grep requiresSkills agents/` → nothing),
// so this is the test that fails if context assembly is ever re-nested under the
// `if (requiredSkills.length)` guard.

test('detached: the default workflow writes <runRoot>/CLAUDE.md and the EXTENDED run.json', async () => {
  const repo = await freshRepo();
  await writeFile(join(repo, 'CLAUDE.md'), '# real project memory\nMEMBER-TOKEN-1\n');
  spawnSync('git', ['-C', repo, 'add', '-A']);
  spawnSync('git', ['-C', repo, 'commit', '-qm', 'memory']);
  // An UNCOMMITTED edit: the whole point of assembling from the real dir (E6).
  await writeFile(join(repo, 'CLAUDE.md'), '# real project memory\nUNCOMMITTED-TOKEN-2\n');

  await withMode('detached', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    let seen = null;
    orch.on('state', async (s) => {
      if (seen || !s.branch?.worktreeDir) return;
      const runRoot = join(worcaHome(), 'runs', s.id);
      const text = await readFile(join(runRoot, 'CLAUDE.md'), 'utf8').catch(() => null);
      if (!text) return;                                   // assembly has not run yet
      seen = { text, manifest: await readRunManifest(runRoot) };
    });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    assert.ok(seen, '<runRoot>/CLAUDE.md existed during the run (§9.2 post-condition)');
    assert.match(seen.text, new RegExp(`^# Worca CC run ${orch.getState().id}\\n`));
    assert.match(seen.text, /UNCOMMITTED-TOKEN-2/, 'the REAL dir was inlined, not the checkout');
    assert.match(seen.text, new RegExp(`repos/${projectKey(repo)}`), 'the roster names the checkout path');
    // §5.4: the roster carries each member's branch and checkpoint ref.
    assert.match(seen.text, new RegExp(`branch: \`${orch.getState().branch.feature}\``));
    assert.match(seen.text, /checkpoint: `[0-9a-f]{7,}`/, 'the diff base is in the roster');
    // The manifest carries the Phase-3 context fields beside the Phase-1 minimal ones.
    const m = seen.manifest;
    assert.equal(m.pipelineId, orch.getState().id);
    assert.ok(m.bytes && typeof m.bytes.total === 'number' && m.bytes.total > 0, JSON.stringify(m.bytes));
    assert.ok(m.renames && m.renames.skills && m.renames.mcpServers, 'the rename maps are recorded');
    assert.deepEqual(m.skillResolutions, {}, 'the default workflow declares zero skills');
    assert.ok(Array.isArray(m.warnings));
    assert.equal(m.capabilities.mcpGrants, 'server', 'the V1(a) outcome is recorded in run.json');
    assert.equal(m.capabilities.probed, false, 'mock runs never spawn claude, so no probe');
    assert.equal(m.mcpConfigPath, null, 'no MCP server anywhere in this fixture');
  });
});

test('legacy (pinned): the default workflow assembles NO context at all', async () => {
  const repo = await freshRepo();
  await withMode('legacy', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    assert.equal(orch.runContext, null, 'no assembly on a legacy run (§10 rollback contract)');
    assert.equal(orch.mcpConfigPath, null, 'so no --mcp-config can reach argv');
    assert.deepEqual(orch.mcpServerGrants, []);
    assert.deepEqual(orch.injectedPaths, {}, 'and the §8.8 pathspec set stays empty');
    assert.ok(!existsSync(join(worcaHome(), 'runs', orch.getState().id)));
  });
});

// ── the checkpoint-mirror fix: single-run results are NOT empty ───────────────

test('detached single run: results.json / diff.patch carry the mock edit (checkpoint mirror)', async () => {
  const repo = await freshRepo();
  await withMode('detached', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    // Inject an agent-like edit into the worktree so the diff is non-empty.
    let injected = false;
    orch.on('state', (s) => {
      if (injected || !s.branch?.worktreeDir || !existsSync(s.branch.worktreeDir)) return;
      injected = true;
      spawnSync('sh', ['-c', `printf 'agent\\n' > ${JSON.stringify(join(s.branch.worktreeDir, 'agent.txt'))}`]);
    });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    assert.ok(injected, 'precondition: a file was injected into the worktree');
    const dir = orch.getState().pipelineDir;
    const results = JSON.parse(await readFile(join(dir, RESULTS_FILE), 'utf8'));
    const patch = await readFile(join(dir, DIFF_PATCH_FILE), 'utf8');
    // Single-project OUTPUT shape is byte-identical: ONE results.json with the flat
    // shape (no perProject rollup) and ONE un-prefixed patch.
    assert.equal(results.perProject, undefined, 'single-project results keep the flat shape');
    const touched = [...(results.newFiles || []), ...(results.changedFiles || [])];
    assert.ok(touched.length > 0, `single-run results must be non-empty: ${JSON.stringify(results)}`);
    assert.ok(touched.some((f) => f.path === 'agent.txt'), 'the injected edit is in results.json');
    assert.ok(results.summary.filesNew + results.summary.filesChanged > 0, 'the summary counts it too');
    assert.match(patch, /agent\.txt/, 'the injected edit is in diff.patch');
    assert.doesNotMatch(patch, /^# /m, 'no per-member `# <key>` prefix on a single run');
  });
});

// ── §8.13 removal guard ──────────────────────────────────────────────────────

test('rmGuarded refuses a path outside <worcaHome>/runs/ or with a mismatched basename', async () => {
  const home = await tmp('worca-cc-rr-guard-');
  const runs = join(home, 'runs');
  const good = join(runs, 'abc12345');
  await mkdir(good, { recursive: true });
  await writeFile(join(good, 'run.json'), '{}');
  const outside = await tmp('worca-cc-rr-outside-');
  await writeFile(join(outside, 'keep.txt'), 'keep\n');

  const off = await rmGuarded(outside, { worcaHome: home, pipelineId: 'abc12345' });
  assert.equal(off.removed, false);
  assert.match(off.reason, /outside/);
  assert.ok(existsSync(join(outside, 'keep.txt')), 'the outside path is untouched');

  const mismatch = await rmGuarded(good, { worcaHome: home, pipelineId: 'other-id' });
  assert.equal(mismatch.removed, false);
  assert.match(mismatch.reason, /basename/);
  assert.ok(existsSync(good), 'a basename mismatch removes nothing');

  // The run root itself is refused (basename 'runs' !== pipelineId), so a bad
  // caller can never wipe every run at once.
  const wipeAll = await rmGuarded(runs, { worcaHome: home, pipelineId: 'abc12345' });
  assert.equal(wipeAll.removed, false);
  assert.ok(existsSync(good));

  const ok = await rmGuarded(good, { worcaHome: home, pipelineId: 'abc12345' });
  assert.equal(ok.removed, true);
  assert.ok(!existsSync(good));
});

// ── §8.12 sweepRunRoots: the POSITIVE keep-set ───────────────────────────────

/** A run root with a manifest whose single member's worktree is a real checkout. */
async function seedRunRoot(home, id, repo) {
  const runRoot = join(home, 'runs', id);
  const wt = await createWorktree({
    projectDir: repo, pipelineId: id, sourceBranch: 'main', featureBranch: `worca-cc/${id}`,
    baseDir: join(runRoot, 'repos'), checkoutName: 'key1',
  });
  await writeRunManifest(runRoot, {
    pipelineId: id, runRootMode: 'detached', isWorkspace: false,
    members: [{ projectKey: 'key1', projectName: 'r', projectDir: repo, worktreeDir: wt.worktreeDir }],
  });
  return { runRoot, worktreeDir: wt.worktreeDir, branch: wt.branch };
}

test('sweep: KEEP running/pausing/paused/interrupted; REMOVE done/stopped/error; branches always survive', async () => {
  const home = await tmp('worca-cc-rr-sweep-');
  const repo = await freshRepo();
  const keepStatuses = ['running', 'pausing', 'paused', 'interrupted'];
  const removeStatuses = ['done', 'stopped', 'error'];
  const byId = new Map();
  let n = 0;
  for (const st of [...keepStatuses, ...removeStatuses]) {
    const id = `sw${String(++n).padStart(6, '0')}`;
    byId.set(id, { status: st, ...(await seedRunRoot(home, id, repo)) });
  }
  const res = await sweepRunRoots({
    worcaHome: home,
    statusOf: (id) => byId.get(id)?.status ?? null,
    log: () => {},
  });
  for (const st of keepStatuses) {
    const [, e] = [...byId].find(([, v]) => v.status === st);
    assert.ok(existsSync(e.runRoot), `${st} run root must SURVIVE the sweep (crash-recovery guard)`);
    assert.ok(res.keep.includes(e.runRoot), `${st} is reported as kept`);
    assert.ok(existsSync(e.worktreeDir), `${st} member checkout survives`);
  }
  for (const st of removeStatuses) {
    const [, e] = [...byId].find(([, v]) => v.status === st);
    assert.ok(!existsSync(e.runRoot), `${st} run root must be RECLAIMED`);
    assert.ok(res.removed.includes(e.runRoot), `${st} is reported as removed`);
  }
  // Every feature branch survives every disposition — only checkouts are disposable.
  const branches = branchList(repo);
  for (const [, e] of byId) assert.ok(branches.includes(e.branch), `branch ${e.branch} KEPT`);
});

test('sweep: `interrupted` explicitly survives — the crash-recovery guard', async () => {
  const home = await tmp('worca-cc-rr-int-');
  const repo = await freshRepo();
  const e = await seedRunRoot(home, 'intrrupt', repo);
  const res = await sweepRunRoots({ worcaHome: home, statusOf: () => 'interrupted', log: () => {} });
  assert.deepEqual(res.removed, [], 'nothing removed');
  assert.ok(existsSync(e.runRoot), 'the interrupted run root survives the boot that made it resumable');
  assert.ok(existsSync(e.worktreeDir), 'its uncommitted work is still on disk');
});

test('sweep: an unknown status is quarantine-logged, never removed', async () => {
  const home = await tmp('worca-cc-rr-unk-');
  const repo = await freshRepo();
  const e = await seedRunRoot(home, 'weird001', repo);
  const res = await sweepRunRoots({ worcaHome: home, statusOf: () => 'levitating', log: () => {} });
  assert.deepEqual(res.removed, []);
  assert.deepEqual(res.quarantined, [e.runRoot]);
  assert.ok(existsSync(e.runRoot));
});

test('sweep: a row-less run root WITH a readable manifest is reclaimed (deleted pipeline)', async () => {
  const home = await tmp('worca-cc-rr-rowless-');
  const repo = await freshRepo();
  const e = await seedRunRoot(home, 'rowless1', repo);
  const res = await sweepRunRoots({ worcaHome: home, statusOf: () => null, log: () => {} });
  assert.deepEqual(res.removed, [e.runRoot]);
  assert.ok(!existsSync(e.runRoot));
  assert.ok(!existsSync(e.worktreeDir), 'the recorded real dirs let us remove the worktree properly');
  assert.ok(branchList(repo).includes(e.branch), 'the branch is still KEPT');
});

test('sweep: a row-less run root WITHOUT a manifest is quarantined ONCE and skipped afterwards', async () => {
  const home = await tmp('worca-cc-rr-orphan-');
  const dir = join(home, 'runs', 'orphan01');
  await mkdir(join(dir, 'repos'), { recursive: true });
  await writeFile(join(dir, 'run.json'), 'not json at all');   // unparseable
  const logs = [];
  const first = await sweepRunRoots({
    worcaHome: home, statusOf: () => null, log: (lvl, m) => logs.push(`${lvl}:${m}`),
  });
  assert.deepEqual(first.removed, [], 'nothing is deleted on a guess');
  assert.equal(first.quarantined.length, 1);
  assert.match(first.quarantined[0], /orphan01\.orphan-\d+$/);
  assert.ok(!existsSync(dir), 'the original name is gone (renamed, not deleted)');
  assert.ok(existsSync(first.quarantined[0]), 'the content survives under the quarantine name');
  assert.ok(logs.some((l) => /quarantine/.test(l)), 'the rename is logged');

  // A second sweep must skip `*.orphan-*` entirely: nothing re-logged forever.
  const logs2 = [];
  const second = await sweepRunRoots({
    worcaHome: home, statusOf: () => null, log: (lvl, m) => logs2.push(`${lvl}:${m}`),
  });
  assert.deepEqual(second, { keep: [], removed: [], quarantined: [], failed: [], warnings: [] });
  assert.deepEqual(logs2, [], 'a quarantined root is silent on every later sweep');
  assert.ok(existsSync(first.quarantined[0]), 'and still not deleted');
});

test('sweep: with run.json deleted it falls back to the injected membersOf callback', async () => {
  const home = await tmp('worca-cc-rr-fallback-');
  const repo = await freshRepo();
  const e = await seedRunRoot(home, 'nomanif1', repo);
  await rm(join(e.runRoot, 'run.json'), { force: true });      // manifest gone
  let asked = 0;
  const res = await sweepRunRoots({
    worcaHome: home,
    statusOf: () => 'done',
    // The DB fallback: no DB in this unit test, just a stub with the same shape
    // ui/server.mjs and `worca doctor` build from the pipelines row.
    membersOf: async (id) => { asked++; return [{ projectKey: 'key1', projectDir: repo, worktreeDir: e.worktreeDir }]; },
    log: () => {},
  });
  assert.equal(asked, 1, 'the injected DB fallback was consulted exactly once');
  assert.deepEqual(res.removed, [e.runRoot]);
  assert.ok(!existsSync(e.worktreeDir), 'the worktree was removed via the fallback members');
  assert.ok(branchList(repo).includes(e.branch), 'branch KEPT');
  // git no longer holds a stale registration for the removed checkout.
  const list = spawnSync('git', ['-C', repo, 'worktree', 'list']).stdout.toString();
  assert.doesNotMatch(list, /nomanif1/, 'the worktree registration was pruned');
});

// ── a LOOKUP FAILURE is not "no row" (the reclaim path must never be reached) ──
// The row-less disposition is *reclaim*. If a DB that cannot be opened (corrupt file,
// ABI mismatch after a Node upgrade, bad permissions) collapsed to null, the very next
// boot would force-remove the worktrees and rm -rf the run roots of every paused /
// interrupted run — with the rescue triple skipped too, because that only runs when a
// row exists. These tests pin the three-state contract.

test('sweep: a THROWING statusOf leaves the run root untouched, logs, and never throws out', async () => {
  const home = await tmp('worca-cc-rr-dbfail-');
  const repo = await freshRepo();
  const e = await seedRunRoot(home, 'dbfail01', repo);
  const logs = [];
  const res = await sweepRunRoots({
    worcaHome: home,
    statusOf: () => { throw new Error('SQLITE_CANTOPEN: unable to open database file'); },
    membersOf: async () => { throw new Error('membersOf must not even be consulted'); },
    log: (lvl, msg) => logs.push(`${lvl}:${msg}`),
  });
  // Nothing removed, nothing renamed — a transient DB problem must not
  // orphan-quarantine everything either.
  assert.deepEqual(res.removed, [], 'nothing was removed');
  assert.deepEqual(res.quarantined, [], 'nothing was renamed');
  assert.deepEqual(res.keep, [], 'and it is not silently counted as kept');
  assert.deepEqual(res.failed, [e.runRoot], 'the root is reported as a classification failure');
  assert.ok(existsSync(e.runRoot), 'the run root survives verbatim');
  assert.ok(existsSync(e.worktreeDir), 'so does the checkout with its uncommitted work');
  assert.ok(existsSync(join(e.runRoot, 'run.json')), 'and its manifest');
  assert.ok(branchList(repo).includes(e.branch), 'the branch is untouched');
  // Loud: both the log sink and the durable warnings list name the failure.
  assert.ok(logs.some((l) => l.startsWith('warn:') && /lookup FAILED/.test(l)), `logs: ${JSON.stringify(logs)}`);
  assert.ok(res.warnings.some((w) => /SQLITE_CANTOPEN/.test(w)), `warnings: ${JSON.stringify(res.warnings)}`);
});

test('sweep: one root failing classification does not stop the others', async () => {
  const home = await tmp('worca-cc-rr-mixed-');
  const repo = await freshRepo();
  const bad = await seedRunRoot(home, 'aaabad01', repo);      // sorts first
  const good = await seedRunRoot(home, 'zzzgood1', repo);     // sorts last
  const res = await sweepRunRoots({
    worcaHome: home,
    statusOf: (id) => {
      if (id === 'aaabad01') throw new Error('db is locked');
      return 'done';
    },
    log: () => {},
  });
  assert.deepEqual(res.failed, [bad.runRoot], 'the unclassifiable root is skipped');
  assert.deepEqual(res.removed, [good.runRoot], 'the classifiable one is still reclaimed');
  assert.ok(existsSync(bad.runRoot));
  assert.ok(!existsSync(good.runRoot));
});

test('sweep: a missing statusOf callback classifies nothing and removes nothing', async () => {
  const home = await tmp('worca-cc-rr-nocb-');
  const repo = await freshRepo();
  const e = await seedRunRoot(home, 'nocb0001', repo);
  const res = await sweepRunRoots({ worcaHome: home, log: () => {} }); // no statusOf
  assert.deepEqual(res.removed, []);
  assert.deepEqual(res.quarantined, []);
  assert.deepEqual(res.failed, [e.runRoot]);
  assert.ok(existsSync(e.runRoot), 'a caller that forgets the lookup destroys nothing');
});

test('sweep: a THROWING membersOf (manifest gone) leaves the root untouched too', async () => {
  const home = await tmp('worca-cc-rr-mfail-');
  const repo = await freshRepo();
  const e = await seedRunRoot(home, 'mfail001', repo);
  await rm(join(e.runRoot, 'run.json'), { force: true });   // forces the DB fallback
  const res = await sweepRunRoots({
    worcaHome: home,
    statusOf: () => 'done',
    membersOf: async () => { throw new Error('no such table: pipelines'); },
    log: () => {},
  });
  assert.deepEqual(res.removed, [], 'we cannot enumerate what to clean up, so we remove nothing');
  assert.deepEqual(res.failed, [e.runRoot]);
  assert.ok(existsSync(e.runRoot), 'the run root survives');
  assert.ok(existsSync(e.worktreeDir), 'and so does the member checkout');
  assert.ok(res.warnings.some((w) => /member lookup FAILED/.test(w)), JSON.stringify(res.warnings));
});

test('runRootSweepLookups: a real DB failure PROPAGATES instead of reading as "no row"', async () => {
  // Make <worcaHome>/worca-cc.db a DIRECTORY so node:sqlite cannot open it. This is
  // the shape of the real hazard (corrupt/unopenable DB), and the contract is that the
  // callback throws rather than returning null.
  const base = await tmp('worca-cc-rr-realdb-');
  const prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = base;
  _resetForTests();
  try {
    await mkdir(join(base, '.worca-cc', 'worca-cc.db'), { recursive: true });
    const { statusOf, membersOf } = runRootSweepLookups();
    assert.throws(() => statusOf('whatever'), /.+/, 'statusOf must THROW, not return null');
    await assert.rejects(() => membersOf('whatever'), /.+/, 'membersOf must REJECT, not resolve null');
    // And the sweep survives it: a run root under this broken home is skipped whole.
    const runRoot = join(base, '.worca-cc', 'runs', 'brokendb');
    await mkdir(runRoot, { recursive: true });
    await writeRunManifest(runRoot, { pipelineId: 'brokendb', members: [] });
    const res = await sweepRunRoots({
      worcaHome: join(base, '.worca-cc'), ...runRootSweepLookups(), log: () => {},
    });
    assert.deepEqual(res.removed, []);
    assert.deepEqual(res.quarantined, []);
    assert.deepEqual(res.failed, [runRoot]);
    assert.ok(existsSync(runRoot), 'an unopenable DB reclaims NOTHING');
  } finally {
    _resetForTests();
    if (prevHome === undefined) delete process.env.WORCA_HOME;
    else process.env.WORCA_HOME = prevHome;
    _resetForTests();
  }
});

test('sweep: no <worcaHome>/runs dir at all is a silent no-op', async () => {
  const home = await tmp('worca-cc-rr-none-');
  const res = await sweepRunRoots({ worcaHome: home, statusOf: () => 'done', log: () => {} });
  assert.deepEqual(res, { keep: [], removed: [], quarantined: [], failed: [], warnings: [] });
});

// ── the legacy sweep (defined + tested HERE; wired at boot in Phase 7) ───────

test('sweepLegacyWorktrees: a TOTAL no-op while the effective mode is legacy', async () => {
  const repo = await freshRepo();
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'legacy01', sourceBranch: 'main', featureBranch: 'worca-cc/legacy01',
  });
  // `done` would normally be removed — but under legacy this dir is the LIVE
  // location of every active run, so sweeping it would make the documented §10
  // rollback self-destroying.
  const res = await sweepLegacyWorktrees(repo, { statusOf: () => 'done', mode: () => 'legacy' });
  assert.equal(res.skipped, true, 'the sweep declares itself skipped');
  assert.deepEqual(res.removed, []);
  assert.ok(existsSync(wt.worktreeDir), 'the live legacy checkout is untouched');
});

test('sweepLegacyWorktrees (mode=detached): skips non-terminal ids, prunes terminal ones, keeps branches', async () => {
  const repo = await freshRepo();
  const mk = (id) => createWorktree({
    projectDir: repo, pipelineId: id, sourceBranch: 'main', featureBranch: `worca-cc/${id}`,
  });
  const kept = await mk('keepme01');      // paused -> KEEP
  const live = await mk('running01');     // running -> KEEP
  const gone = await mk('doneme01');      // done -> REMOVE
  const unknown = await mk('nostatus');   // no row -> quarantine-log, never remove
  const status = { keepme01: 'paused', running01: 'running', doneme01: 'done' };
  const res = await sweepLegacyWorktrees(repo, {
    statusOf: (id) => status[id] ?? null, mode: () => 'detached', log: () => {},
  });
  assert.equal(res.skipped, false);
  assert.ok(existsSync(kept.worktreeDir), 'paused is KEPT');
  assert.ok(existsSync(live.worktreeDir), 'running is KEPT');
  assert.ok(!existsSync(gone.worktreeDir), 'done is removed');
  assert.ok(existsSync(unknown.worktreeDir), 'a row-less dir is quarantine-logged, never removed');
  assert.deepEqual(res.removed, [gone.worktreeDir]);
  assert.deepEqual(res.quarantined, [unknown.worktreeDir]);
  const branches = await listLocalBranches(repo);
  for (const b of ['worca-cc/keepme01', 'worca-cc/running01', 'worca-cc/doneme01', 'worca-cc/nostatus']) {
    assert.ok(branches.includes(b), `branch ${b} survives every disposition`);
  }
});

test('sweepLegacyWorktrees (mode=detached): a still-referenced path is skipped even for a terminal id', async () => {
  const repo = await freshRepo();
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'refd0001', sourceBranch: 'main', featureBranch: 'worca-cc/refd0001',
  });
  const res = await sweepLegacyWorktrees(repo, {
    statusOf: () => 'done', mode: () => 'detached',
    referencedPaths: [wt.worktreeDir],     // a row recorded this path under another id shape
    log: () => {},
  });
  assert.deepEqual(res.removed, []);
  assert.deepEqual(res.keep, [wt.worktreeDir]);
  assert.ok(existsSync(wt.worktreeDir));
});

// ── Phase 7: the legacy sweep's THREE-STATE rule, the registry fan-out, and the
//    DB lookups both wirings (server boot + `worca doctor`) share ────────────────

test('sweepLegacyWorktrees: a THROWING statusOf skips the candidate — never "row-less"', async () => {
  const repo = await freshRepo();
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'dbfail01', sourceBranch: 'main', featureBranch: 'worca-cc/dbfail01',
  });
  const logs = [];
  const res = await sweepLegacyWorktrees(repo, {
    statusOf: () => { throw new Error('SQLITE_CANTOPEN: unable to open database file'); },
    mode: () => 'detached',
    log: (level, msg) => logs.push(`${level}:${msg}`),
  });
  assert.deepEqual(res.removed, []);
  assert.deepEqual(res.quarantined, [], 'a lookup FAILURE is not the row-less disposition');
  assert.deepEqual(res.failed, [wt.worktreeDir], 'it is reported in `failed`, like sweepRunRoots');
  assert.ok(existsSync(wt.worktreeDir), 'the checkout is left untouched');
  assert.ok(logs.some((l) => l.startsWith('warn:') && /lookup FAILED/.test(l)), JSON.stringify(logs));
  assert.ok(res.warnings.some((w) => /SQLITE_CANTOPEN/.test(w)), JSON.stringify(res.warnings));
});

test('sweepLegacyWorktreesAll: fans out over every given project dir, and is idempotent', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const mk = (repo, id) => createWorktree({
    projectDir: repo, pipelineId: id, sourceBranch: 'main', featureBranch: `worca-cc/${id}`,
  });
  const gone = await mk(a, 'faneda01');    // done   -> REMOVE
  const kept = await mk(b, 'fanepb01');    // paused -> KEEP
  const status = { faneda01: 'done', fanepb01: 'paused' };
  const opts = { statusOf: (id) => status[id] ?? null, mode: 'detached', log: () => {} };

  const res = await sweepLegacyWorktreesAll([a, b], opts);
  assert.equal(res.skipped, false);
  assert.equal(res.projects, 2, 'both registered projects were swept');
  assert.deepEqual(res.removed, [gone.worktreeDir]);
  assert.deepEqual(res.keep, [kept.worktreeDir]);
  assert.ok(!existsSync(gone.worktreeDir));
  assert.ok(existsSync(kept.worktreeDir));

  // Idempotent: every boot re-runs this, so a second pass must remove nothing new.
  const again = await sweepLegacyWorktreesAll([a, b], opts);
  assert.deepEqual(again.removed, []);
  assert.deepEqual(again.keep, [kept.worktreeDir]);
  const branches = await listLocalBranches(a);
  assert.ok(branches.includes('worca-cc/faneda01'), 'branches survive every disposition');
});

test('sweepLegacyWorktreesAll: a TOTAL no-op while the effective mode is legacy', async () => {
  const a = await freshRepo();
  const wt = await createWorktree({
    projectDir: a, pipelineId: 'fanleg01', sourceBranch: 'main', featureBranch: 'worca-cc/fanleg01',
  });
  const res = await sweepLegacyWorktreesAll([a], { statusOf: () => 'done', mode: 'legacy', log: () => {} });
  assert.equal(res.skipped, true);
  assert.equal(res.projects, 0, 'not one project dir is even read under legacy');
  assert.deepEqual(res.removed, []);
  assert.ok(existsSync(wt.worktreeDir), 'the live legacy checkout is untouched');
});

test('legacySweepLookups: a snapshot statusOf + every worktree path any row still claims', async () => {
  // Seeded against the module-level temp home (useTempHome), like the rest of the
  // DB-touching assertions in this file.
  seedPipelineRow({
    id: 'lkupdn01', status: 'done',
    branch: { feature: 'worca-cc/lkupdn01', worktreeDir: '/tmp/p1/.worca-cc/worktrees/lkupdn01' },
  });
  seedPipelineRow({
    id: 'lkupws01', status: 'paused', target: 'workspace', workspaceKey: 'wks-lookup',
    workspaceMeta: {
      branches: {
        a: { worktreeDir: '/tmp/wa/.worca-cc/worktrees/lkupws01' },
        b: { worktreeDir: '/tmp/wb/.worca-cc/worktrees/lkupws01' },
      },
    },
  });
  const { statusOf, referencedPaths } = legacySweepLookups();
  assert.equal(statusOf('lkupdn01'), 'done');
  assert.equal(statusOf('lkupws01'), 'paused');
  assert.equal(statusOf('no-such-run'), null, 'a VERIFIABLY absent row reads as null');
  // Single runs record one path; workspace runs record one per member — both are
  // "still referenced" and must survive the sweep no matter what the status says.
  assert.ok(referencedPaths.has('/tmp/p1/.worca-cc/worktrees/lkupdn01'));
  assert.ok(referencedPaths.has('/tmp/wa/.worca-cc/worktrees/lkupws01'));
  assert.ok(referencedPaths.has('/tmp/wb/.worca-cc/worktrees/lkupws01'));
});

test('legacySweepLookups: a real DB failure PROPAGATES instead of reading as "no rows"', async () => {
  // Same hazard shape as the runRootSweepLookups case above: an unopenable DB must
  // throw out of the factory, so the caller sweeps NOTHING — rather than handing the
  // sweep a lookup that reads every legacy worktree as row-less.
  const base = await tmp('worca-cc-rr-legacydb-');
  const prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = base;
  _resetForTests();
  try {
    await mkdir(join(base, '.worca-cc', 'worca-cc.db'), { recursive: true });
    assert.throws(() => legacySweepLookups(), /.+/, 'legacySweepLookups must THROW');
  } finally {
    _resetForTests();
    if (prevHome === undefined) delete process.env.WORCA_HOME;
    else process.env.WORCA_HOME = prevHome;
    _resetForTests();
  }
});
