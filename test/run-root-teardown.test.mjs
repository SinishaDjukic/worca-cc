// test/run-root-teardown.test.mjs
// Phase 1 (run-root plumbing): _teardownRunRoot — the ONLY owner of normal-path
// teardown, wired into BOTH terminal finallys. Covers the normative per-member
// order (rescue → strip-section → commit → remove-injected → remove-worktree), the
// run-root-level triple (§8.20 rescue → §8.11 stray scan → §5.2 run.json copy →
// §8.13 guarded rm), the pause exemption, and detached partial-setup containment.
//
// MODE PINNING (§6 intro): every test here pins process.env.WORCA_RUN_ROOT.
//
// The Phase-1 fixture HAND-WRITES `injectedPaths` entries into run.json: the schema
// field formally lands with Phase 3's assembly, but readRunManifest is shape-tolerant
// JSON, so the teardown/rescue machinery is fully testable now.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile, realpath } from 'node:fs/promises';
import { existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { readPipelineForResume, readPipelineByKey } from '../src/core/artifacts.mjs';
import {
  readRunManifest, updateRunManifest, claudeMdFenceBegin, CLAUDE_MD_FENCE_END,
} from '../src/core/run-manifest.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

async function tmp(prefix = 'worca-cc-rrt-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  return realpath(dir);   // macOS /var -> /private/var, matching git's own reports
}

async function freshRepo(prefix = 'worca-cc-rrt-repo-') {
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
/** Files in the tip commit of `branch`. */
function treeOf(dir, branch) {
  return spawnSync('git', ['-C', dir, 'ls-tree', '-r', '--name-only', branch])
    .stdout.toString().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
function showFile(dir, branch, path) {
  const r = spawnSync('git', ['-C', dir, 'show', `${branch}:${path}`]);
  return r.status === 0 ? r.stdout.toString() : null;
}

// Phase 3's assembleRunContext reads the §5.1 ROOT layer, whose default is the
// developer's real home. Pin it at an empty dir so these orchestrator-driven tests
// stay hermetic (and so a stray ~/CLAUDE.md can never change an assertion).
const HERMETIC_PROJECTS_ROOT = mkdtempSync(join(tmpdir(), 'worca-cc-rrt-proot-'));
after(() => rmSync(HERMETIC_PROJECTS_ROOT, { recursive: true, force: true }));

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

function workspaceOpts(dirs, { branch = { source: 'main' } } = {}) {
  const projects = dirs.map((d) => ({
    projectDir: d, projectKey: projectKey(d), projectName: d.split('/').filter(Boolean).pop(),
  }));
  projects.sort((a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0));
  const key = `wks-rrt-${projects.map((p) => p.projectKey).join('').slice(0, 8)}`;
  return {
    workspace: { id: key, key, name: 'RRT WS', description: '', projects: projects.map((p) => ({ ...p, branch })) },
    branch,
  };
}

// ── the run root is destroyed on completion, kept on pause ───────────────────

test('detached: a completed run leaves NO <worcaHome>/runs/<id> behind', async () => {
  const repo = await freshRepo();
  await withMode('detached', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    let liveRunRoot = null;
    orch.on('state', (s) => { if (!liveRunRoot && s.branch?.worktreeDir) liveRunRoot = join(worcaHome(), 'runs', s.id); });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    assert.ok(liveRunRoot, 'a run root existed during the run');
    assert.ok(existsSync(liveRunRoot) === false, `run root must be gone: ${liveRunRoot}`);
    // The branch survives and carries the mock agent's work.
    const feature = orch.getState().branch.feature;
    assert.ok(branchList(repo).includes(feature), 'the feature branch is KEPT');
    assert.ok(treeOf(repo, feature).includes('src/feature.mjs'), 'the agent work was committed');
  });
});

test('detached: a failed teardown commit retains the worktree + run root and persists the reason', async () => {
  const repo = await freshRepo();
  await withMode('detached', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    const realGit = orch._git.bind(orch);
    orch._git = (args, opts) => {
      const msgAt = args.indexOf('-m');
      if (args.includes('commit') && msgAt >= 0 && String(args[msgAt + 1] || '').startsWith('worca:')) {
        return Promise.resolve({ ok: false, code: 1, stdout: '', stderr: 'simulated commit failure' });
      }
      return realGit(args, opts);
    };
    const res = await orch.run();
    assert.equal(res.status, 'done');
    const st = orch.getState();
    assert.ok(existsSync(st.branch.worktreeDir), 'the only checkout containing the work survives');
    const runRoot = join(worcaHome(), 'runs', st.id);
    assert.ok(existsSync(runRoot), 'the containing run root survives too');
    const saved = await readPipelineByKey(projectKey(repo), st.id);
    assert.equal(saved.state.status, 'done', 'commit failure is orthogonal to pipeline status');
    assert.equal(saved.state.branch.commitFailed.code, 'commit_failed');
    assert.equal(saved.state.branch.commitFailed.step, 'commit');
    assert.equal(saved.state.branch.worktreeRemoved, false);
    const liveManifest = await readRunManifest(runRoot);
    assert.equal(liveManifest.retain.reason, 'commit_failed');
    assert.equal(liveManifest.retain.members[0].worktreeDir, st.branch.worktreeDir);
    const durableManifest = JSON.parse(await readFile(join(st.pipelineDir, 'run.json'), 'utf8'));
    assert.equal(durableManifest.retain.reason, 'commit_failed', 'retain is written before the durable copy');
  });
});

// Phase 3 addition: the generated context files are part of the run root, so they go
// with it — and they are NOT strays (RUN_ROOT_KNOWN_SET whitelists all of them), so
// the §8.11 scan must stay silent about them.
test('detached: the generated CLAUDE.md / mcp.json / skill mount are removed WITH the run root, never rescued as strays', async () => {
  const repo = await freshRepo();
  await writeFile(join(repo, 'CLAUDE.md'), '# memory\n');
  await mkdir(join(repo, '.claude', 'skills', 'deploy'), { recursive: true });
  await writeFile(join(repo, '.claude', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\n---\nbody\n');
  await writeFile(join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'node', args: ['/abs/db.js'] } } }));

  await withMode('detached', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    const warnings = [];
    orch.on('log', (e) => { if (e.level === 'warn') warnings.push(e.text); });
    let live = null;
    orch.on('state', async (s) => {
      if (live || !s.branch?.worktreeDir) return;
      const runRoot = join(worcaHome(), 'runs', s.id);
      if (!existsSync(join(runRoot, 'CLAUDE.md'))) return;
      live = { runRoot, mcp: existsSync(join(runRoot, 'mcp.json')), worktree: s.branch.worktreeDir };
    });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    assert.ok(live, 'the generated CLAUDE.md existed during the run');
    assert.ok(live.mcp, 'so did the merged mcp.json');
    assert.ok(!existsSync(live.runRoot), 'the whole run root — context files included — is gone');
    // The generated files are in the known set, so nothing was "rescued" as a stray.
    const pdir = orch.getState().pipelineDir;
    for (const f of ['CLAUDE.md', 'mcp.json']) {
      assert.ok(!existsSync(join(pdir, 'stray', f)), `${f} is a KNOWN run-root entry, not a stray`);
      assert.ok(!warnings.some((w) => w.includes(`unexpected entry \`${f}\``)), `no stray warning for ${f}`);
    }
    // The single-mode skill mount lived in the worktree and left no trace in the commit.
    const tree = treeOf(repo, orch.getState().branch.feature);
    assert.ok(!tree.some((p) => p.startsWith('.claude/skills/')), `the mount is not committed: ${tree.join(',')}`);
    // The durable manifest copy survives with the context fields (§5.2 ledger).
    const manifest = JSON.parse(await readFile(join(pdir, 'run.json'), 'utf8'));
    assert.deepEqual(manifest.injectedSkillNames, ['deploy']);
    assert.deepEqual(manifest.mcpServerNames, ['db']);
  });
});

test('detached: a PAUSED run keeps its run root whole (§8.13 pause exemption)', async () => {
  const dir = await freshRepo();
  await withMode('detached', async () => {
    let orchRef = null;
    let hangOnce = true;
    const runners = {
      producer: async (ctx) => {
        if (hangOnce) {
          hangOnce = false;
          queueMicrotask(() => orchRef.pause());
          return new Promise((_r, rej) => {
            const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
            if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
          });
        }
        return { status: 'ok', summary: 'ok' };
      },
      verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }),
    };
    const orch = createOrchestrator({
      projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners,
      branch: { source: 'main' },
    });
    orchRef = orch;
    const res = await orch.run();
    assert.equal(res.status, 'paused', JSON.stringify(res));
    const runRoot = join(worcaHome(), 'runs', orch.getState().id);
    assert.ok(existsSync(runRoot), 'the run root survives a pause');
    assert.ok(existsSync(join(runRoot, 'run.json')), 'the live manifest is still there');
    assert.ok(existsSync(orch.getState().branch.worktreeDir), 'the checkout we resume into survives');
  });
});

test('detached: a paused -> resumed -> completed run ALSO leaves no run root (resume finally wiring)', async () => {
  const dir = await freshRepo();
  await withMode('detached', async () => {
    let orchRef = null;
    let hangOnce = true;
    const mkRunners = () => ({
      producer: async (ctx) => {
        ctx.onEvent({ type: 'session', sessionId: `sess-${ctx.nodeId}` });
        if (hangOnce) {
          hangOnce = false;
          queueMicrotask(() => orchRef.pause());
          return new Promise((_r, rej) => {
            const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
            if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
          });
        }
        return { status: 'ok', summary: 'ok' };
      },
      verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }),
    });
    const orch1 = createOrchestrator({
      projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners: mkRunners(),
      branch: { source: 'main' },
    });
    orchRef = orch1;
    assert.equal((await orch1.run()).status, 'paused');
    const id = orch1.state.id;
    const runRoot = join(worcaHome(), 'runs', id);
    assert.ok(existsSync(runRoot), 'paused: run root kept');

    // Restart simulation: a brand-new instance built ONLY from the DB.
    const saved = readPipelineForResume(id);
    const orch2 = createOrchestrator({
      projectDir: dir, auto: true, claude: { mock: true }, runners: mkRunners(), resume: saved,
    });
    orchRef = orch2;
    const r2 = await orch2.resume();
    assert.equal(r2.status, 'done', JSON.stringify(r2));
    assert.equal(orch2.runRootMode, 'detached', 'resume honored the RECORDED mode');
    assert.ok(!existsSync(runRoot),
      `a detached run finishing after a resume must tear its run root down too: ${runRoot}`);
  });
});

// Phase 3 (§5.2): the resume path re-assembles, IDEMPOTENTLY, from the persisted
// skillResolutions map — it never re-runs collectRequiredSkills/validateSkills. A
// deleted CLAUDE.md / mcp.json / skill mount therefore self-heals byte-identically.
test('detached resume: assembleRunContext re-runs and SELF-HEALS the deleted context files', async () => {
  const dir = await freshRepo();
  await writeFile(join(dir, 'CLAUDE.md'), '# memory\nRESUME-TOKEN\n');
  await mkdir(join(dir, '.claude', 'skills', 'deploy'), { recursive: true });
  await writeFile(join(dir, '.claude', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\n---\nbody\n');
  await writeFile(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'node', args: ['/abs/db.js'] } } }));

  await withMode('detached', async () => {
    let orchRef = null;
    let hangOnce = true;
    const mkRunners = () => ({
      producer: async (ctx) => {
        if (hangOnce) {
          hangOnce = false;
          queueMicrotask(() => orchRef.pause());
          return new Promise((_r, rej) => {
            const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
            if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
          });
        }
        return { status: 'ok', summary: 'ok' };
      },
      verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }),
    });
    const orch1 = createOrchestrator({
      projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners: mkRunners(),
      branch: { source: 'main' },
    });
    orchRef = orch1;
    assert.equal((await orch1.run()).status, 'paused');
    const id = orch1.state.id;
    const runRoot = join(worcaHome(), 'runs', id);
    const wt = orch1.getState().branch.worktreeDir;
    const before = {
      md: await readFile(join(runRoot, 'CLAUDE.md'), 'utf8'),
      mcp: await readFile(join(runRoot, 'mcp.json'), 'utf8'),
    };
    assert.match(before.md, /RESUME-TOKEN/);
    // Wipe everything the assembly owns, as a crash mid-write would.
    await rm(join(runRoot, 'CLAUDE.md'), { force: true });
    await rm(join(runRoot, 'mcp.json'), { force: true });
    await rm(join(wt, '.claude', 'skills', 'deploy'), { recursive: true, force: true });

    const orch2 = createOrchestrator({
      projectDir: dir, auto: true, claude: { mock: true }, runners: mkRunners(),
      resume: readPipelineForResume(id),
    });
    orchRef = orch2;
    let healed = null;
    orch2.on('state', async () => {
      if (healed) return;
      const md = await readFile(join(runRoot, 'CLAUDE.md'), 'utf8').catch(() => null);
      if (md) {
        healed = {
          md, mcp: await readFile(join(runRoot, 'mcp.json'), 'utf8').catch(() => null),
          skill: existsSync(join(wt, '.claude', 'skills', 'deploy', 'SKILL.md')),
          grants: orch2.mcpServerGrants.slice(),
        };
      }
    });
    const r2 = await orch2.resume();
    assert.equal(r2.status, 'done', JSON.stringify(r2));
    assert.ok(healed, 'the resume re-assembled the context');
    assert.equal(healed.md, before.md, 'IDEMPOTENT: the regenerated CLAUDE.md is byte-identical');
    assert.equal(healed.mcp, before.mcp, 'and so is the merged mcp.json');
    assert.ok(healed.skill, 'the skill mount was re-created');
    assert.deepEqual(healed.grants, ['mcp__db'], 'and the resumed nodes get the same V1(a) grants');
  });
});

// ── §8.11 stray scan ─────────────────────────────────────────────────────────

test('detached: an unexpected file at the run root is copied to <pipelineDir>/stray/ with a warning', async () => {
  const repo = await freshRepo();
  await withMode('detached', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    const warnings = [];
    orch.on('log', (e) => { if (e.level === 'warn') warnings.push(e.text); });
    let planted = false;
    orch.on('state', (s) => {
      if (planted || !s.branch?.worktreeDir) return;
      const runRoot = join(worcaHome(), 'runs', s.id);
      if (!existsSync(runRoot)) return;
      planted = true;
      // An agent writing at cwd instead of repos/<key>.
      writeFileSync(join(runRoot, 'oops-notes.md'), '# valuable notes\n');
      mkdirSync(join(runRoot, 'scratch'), { recursive: true });
      writeFileSync(join(runRoot, 'scratch', 'deep.txt'), 'deep\n');
    });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    assert.ok(planted, 'precondition: a stray was planted at the run root');
    const pdir = orch.getState().pipelineDir;
    assert.equal(await readFile(join(pdir, 'stray', 'oops-notes.md'), 'utf8'), '# valuable notes\n');
    assert.equal(await readFile(join(pdir, 'stray', 'scratch', 'deep.txt'), 'utf8'), 'deep\n');
    assert.ok(warnings.some((w) => /oops-notes\.md/.test(w) && /run root/.test(w)),
      `a loud warning names the stray: ${JSON.stringify(warnings)}`);
    // The durable ledger carries it too (run.json copied out before removal).
    const manifest = JSON.parse(await readFile(join(pdir, 'run.json'), 'utf8'));
    assert.ok((manifest.warnings || []).some((w) => /oops-notes\.md/.test(w)),
      'the warning is in run.json.warnings');
  });
});

test('detached: run.json is copied to <pipelineDir>/run.json before the run root is removed', async () => {
  const repo = await freshRepo();
  await withMode('detached', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    const pdir = orch.getState().pipelineDir;
    const copied = JSON.parse(await readFile(join(pdir, 'run.json'), 'utf8'));
    assert.equal(copied.pipelineId, orch.getState().id);
    assert.equal(copied.runRootMode, 'detached');
    assert.ok(Array.isArray(copied.members) && copied.members.length === 1);
    assert.ok(!existsSync(join(worcaHome(), 'runs', orch.getState().id)), 'the original is gone');
  });
});

// ── the normative per-member order, driven by a hand-written injectedPaths set ──

/**
 * Plant a mounted skill, a linkPaths symlink, and a fenced CLAUDE.md section into a
 * live worktree, and record all three in run.json exactly as Phase 3's assembly
 * will. Returns the recorded source paths so the rescue can be asserted.
 */
async function plantInjected({ runRoot, worktreeDir, key, pipelineId, realSkillDir }) {
  const skillRel = join('.claude', 'skills', 'deploy');
  await mkdir(join(worktreeDir, skillRel), { recursive: true });
  await writeFile(join(worktreeDir, skillRel, 'SKILL.md'), 'original skill body\n');

  const linkRel = '.env';
  await writeFile(join(worktreeDir, linkRel), 'SECRET=1\n');

  // The tracked CLAUDE.md variant: a real tracked file plus a worca-cc fence.
  const claudeRel = 'CLAUDE.md';
  const fenceBody = 'generated worca-cc context\n';
  await writeFile(
    join(worktreeDir, claudeRel),
    `# project memory\n\n${claudeMdFenceBegin(pipelineId)}\n${fenceBody}${CLAUDE_MD_FENCE_END}\n`,
  );
  const sectionSource = join(realSkillDir, 'section.md');
  await writeFile(sectionSource, fenceBody);

  // MERGE, never replace: from Phase 3 on, assembleRunContext owns
  // injectedPaths[<key>] (its skill mounts), and these fixtures add the two kinds
  // assembly does not produce yet (`link` from §8.1 linkPaths and the §4.1 V3
  // `claudeMdSection` fallback, whose teardown machinery landed in Phase 1).
  const cur = (await readRunManifest(runRoot))?.injectedPaths || {};
  await updateRunManifest(runRoot, {
    injectedPaths: {
      ...cur,
      [key]: [
        ...(Array.isArray(cur[key]) ? cur[key] : []).filter((e) => e.path !== skillRel),
        { path: skillRel, source: join(realSkillDir, 'deploy'), kind: 'skill' },
        { path: linkRel, source: join(realSkillDir, '.env'), kind: 'link' },
        { path: claudeRel, source: sectionSource, kind: 'claudeMdSection' },
      ],
    },
  });
  return { skillRel, linkRel, claudeRel, fenceBody };
}

/**
 * Plant the fixture AFTER Phase 3's assembly has run — `orch.runContext` is set only
 * by _assembleContext, and run() emits `state` again at step 5 (right before
 * _dispatch), so this latches on the first post-assembly emit. Planting on the
 * earlier _setupRunRoot emit would be silently clobbered by the assembly's own
 * injectedPaths write.
 */
function plantAfterAssembly(orch, build) {
  let planted = null;
  orch.on('state', (s) => {
    if (planted || !orch.runContext || !s.branch?.worktreeDir || !existsSync(s.branch.worktreeDir)) return;
    planted = build(s);
  });
  return () => planted;
}

test('detached: per-member order — mounts/fence never reach the commit and are gone before removeWorktree', async () => {
  const repo = await freshRepo();
  // The recorded `source` tree the rescue byte-compares against.
  const real = await tmp('worca-cc-rrt-real-');
  await mkdir(join(real, 'deploy'), { recursive: true });
  await writeFile(join(real, 'deploy', 'SKILL.md'), 'original skill body\n');
  await writeFile(join(real, '.env'), 'SECRET=1\n');
  // The worktree must TRACK CLAUDE.md for the fence variant to be the real case.
  await writeFile(join(repo, 'CLAUDE.md'), '# project memory\n');
  spawnSync('git', ['-C', repo, 'add', '-A']);
  spawnSync('git', ['-C', repo, 'commit', '-qm', 'add memory']);

  await withMode('detached', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    let seenWorktree = null;
    const planted = plantAfterAssembly(orch, (s) => {
      const runRoot = join(worcaHome(), 'runs', s.id);
      seenWorktree = s.branch.worktreeDir;
      return plantInjected({
        runRoot, worktreeDir: s.branch.worktreeDir, key: projectKey(repo),
        pipelineId: s.id, realSkillDir: real,
      }).then(async (info) => {
        // Phase 3 owns this field (assembleRunContext's return); the fixture
        // re-reads the MERGED manifest set, exactly as resume() rehydrates it.
        orch.injectedPaths = (await readRunManifest(runRoot)).injectedPaths;
        // An honest agent edit that MUST survive.
        await writeFile(join(s.branch.worktreeDir, 'agent.txt'), 'real work\n');
        return info;
      });
    });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    const info = await planted();
    assert.ok(info, 'precondition: injected paths were planted');

    const feature = orch.getState().branch.feature;
    const tree = treeOf(repo, feature);
    // (3) the commit excludes every injected path…
    assert.ok(!tree.some((p) => p.startsWith('.claude/')), `no mount in the commit: ${tree.join(',')}`);
    assert.ok(!tree.includes('.env'), 'no linkPaths entry in the commit');
    // …and the fenced block never reaches it, while the tracked file itself does.
    assert.ok(tree.includes('CLAUDE.md'), 'the tracked CLAUDE.md is still committed');
    const committedMemory = showFile(repo, feature, 'CLAUDE.md');
    assert.doesNotMatch(committedMemory, /worca-cc:context:begin/, 'the fence was stripped BEFORE the commit');
    assert.doesNotMatch(committedMemory, /generated worca-cc context/, 'the generated body is not committed');
    assert.match(committedMemory, /# project memory/, 'the user content is untouched');
    // …the agent's honest work IS committed.
    assert.equal(showFile(repo, feature, 'agent.txt'), 'real work\n');
    // (4)+(5) the checkout (and hence every injected path in it) is gone.
    assert.ok(!existsSync(seenWorktree), 'the checkout was removed after the injected paths');
    assert.ok(!existsSync(join(worcaHome(), 'runs', orch.getState().id)), 'the run root is gone');
  });
});

test('detached: §8.20 — a MODIFIED mounted skill is rescued with a warning naming the skill and both paths', async () => {
  const repo = await freshRepo();
  const real = await tmp('worca-cc-rrt-real2-');
  await mkdir(join(real, 'deploy'), { recursive: true });
  await writeFile(join(real, 'deploy', 'SKILL.md'), 'original skill body\n');
  await writeFile(join(real, '.env'), 'SECRET=1\n');

  await withMode('detached', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    const warnings = [];
    orch.on('log', (e) => { if (e.level === 'warn') warnings.push(e.text); });
    const planted = plantAfterAssembly(orch, (s) => {
      const runRoot = join(worcaHome(), 'runs', s.id);
      const wt = s.branch.worktreeDir;
      return plantInjected({ runRoot, worktreeDir: wt, key: projectKey(repo), pipelineId: s.id, realSkillDir: real })
        .then(async (info) => {
          orch.injectedPaths = (await readRunManifest(runRoot)).injectedPaths;
          // The agent "improves the deploy skill" — an edit to a DISPOSABLE copy.
          await writeFile(join(wt, info.skillRel, 'SKILL.md'), 'IMPROVED skill body\n');
          await writeFile(join(wt, info.skillRel, 'extra.md'), 'a brand new file\n');
          // A write-through link edit must NOT be rescued (exempt by design).
          await writeFile(join(wt, info.linkRel), 'SECRET=2\n');
          return info;
        });
    });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    const info = await planted();
    const pdir = orch.getState().pipelineDir;
    const strayBase = join(pdir, 'stray', projectKey(repo), info.skillRel);
    assert.equal(await readFile(join(strayBase, 'SKILL.md'), 'utf8'), 'IMPROVED skill body\n',
      'the modified mount content is preserved verbatim');
    assert.equal(await readFile(join(strayBase, 'extra.md'), 'utf8'), 'a brand new file\n',
      'an ADDED file inside the mount counts as a change and is rescued too');
    const named = warnings.find((w) => /deploy/.test(w));
    assert.ok(named, `a warning names the skill: ${JSON.stringify(warnings)}`);
    assert.match(named, /stray/, 'the warning names the rescue destination');
    assert.match(named, new RegExp(real.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'the warning names the real source path so the operator can apply it');
    // run.json.warnings carries it durably.
    const manifest = JSON.parse(await readFile(join(pdir, 'run.json'), 'utf8'));
    assert.ok((manifest.warnings || []).some((w) => /deploy/.test(w)), 'durable in run.json.warnings');
    // The write-through link was NOT rescued.
    assert.ok(!existsSync(join(pdir, 'stray', projectKey(repo), info.linkRel)),
      'kind:link is exempt — it is write-through by design');
  });
});

test('detached: §8.20 — an edit INSIDE the CLAUDE.md fence is rescued, never committed, never lost', async () => {
  const repo = await freshRepo();
  const real = await tmp('worca-cc-rrt-real3-');
  await mkdir(join(real, 'deploy'), { recursive: true });
  await writeFile(join(real, 'deploy', 'SKILL.md'), 'original skill body\n');
  await writeFile(join(real, '.env'), 'SECRET=1\n');
  await writeFile(join(repo, 'CLAUDE.md'), '# project memory\n');
  spawnSync('git', ['-C', repo, 'add', '-A']);
  spawnSync('git', ['-C', repo, 'commit', '-qm', 'add memory']);

  await withMode('detached', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    const planted = plantAfterAssembly(orch, (s) => {
      const runRoot = join(worcaHome(), 'runs', s.id);
      const wt = s.branch.worktreeDir;
      return plantInjected({ runRoot, worktreeDir: wt, key: projectKey(repo), pipelineId: s.id, realSkillDir: real })
        .then(async (info) => {
          orch.injectedPaths = (await readRunManifest(runRoot)).injectedPaths;
          // The agent edits INSIDE the fence and, separately, the user's own section.
          await writeFile(
            join(wt, info.claudeRel),
            `# project memory\n\nMY OWN EDIT\n\n${claudeMdFenceBegin(s.id)}\nAGENT EDITED THE FENCE\n${CLAUDE_MD_FENCE_END}\n`,
          );
          return info;
        });
    });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    const info = await planted();
    const pdir = orch.getState().pipelineDir;
    const rescued = await readFile(join(pdir, 'stray', projectKey(repo), info.claudeRel), 'utf8');
    assert.match(rescued, /AGENT EDITED THE FENCE/, 'the fence-internal edit is rescued');
    const feature = orch.getState().branch.feature;
    const committed = showFile(repo, feature, 'CLAUDE.md');
    assert.doesNotMatch(committed, /AGENT EDITED THE FENCE/, 'the fence body never reaches the commit');
    assert.doesNotMatch(committed, /worca-cc:context/, 'no fence markers in the commit');
    // The agent's LEGITIMATE edit to the tracked file IS committed — the whole reason
    // claudeMdSection is never in the pathspec exclusion set.
    assert.match(committed, /MY OWN EDIT/, "the agent's own CLAUDE.md edit is committed");
  });
});

// ── detached partial-setup containment ───────────────────────────────────────

test('detached: one member failing createWorktree tears down the sibling — no orphan under runs/<id>/repos', async () => {
  const a = await freshRepo('worca-cc-rrt-a-');
  const b = await freshRepo('worca-cc-rrt-b-');
  const ws = workspaceOpts([a, b], { branch: { source: 'main', feature: 'collide' } });
  // Pre-occupy member b's feature branch in a separate live worktree so its
  // createWorktree throws the M2 "already checked out" error mid-setup.
  const bSlug = b.split('/').filter(Boolean).pop().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const bFeature = `collide-${bSlug}`.slice(0, 80);
  const squatDir = join(b, 'squatter');
  const add = spawnSync('git', ['-C', b, 'worktree', 'add', '-b', bFeature, '--', squatDir, 'main']);
  assert.equal(add.status, 0, `precondition: squat b's feature branch: ${add.stderr}`);

  await withMode('detached', async () => {
    const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
    const res = await orch.run();
    assert.equal(res.status, 'error', JSON.stringify(res));
    const id = orch.getState().id;
    const reposBase = join(worcaHome(), 'runs', id, 'repos');
    // Whichever member DID get a worktree must be torn down, and the run root with it.
    assert.ok(!existsSync(reposBase), `no orphan checkout under ${reposBase}`);
    assert.ok(!existsSync(join(worcaHome(), 'runs', id)), 'the run root is reclaimed too');
    // a's branch is still KEPT (only the disposable checkout goes).
    assert.ok(branchList(a).some((x) => x.startsWith('collide-')), "member a's branch is kept");
  });
});

// ── legacy delegation (the rollback guard) ───────────────────────────────────

test('legacy (pinned): _teardownRunRoot delegates verbatim — worktree removed, branch kept, no run root', async () => {
  const repo = await freshRepo();
  await withMode('legacy', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    const st = orch.getState();
    assert.ok(!existsSync(st.branch.worktreeDir), 'the legacy checkout is removed');
    assert.equal(st.branch.worktreeRemoved, true);
    assert.equal(st.branch.branchKept, true);
    assert.ok(branchList(repo).includes(st.branch.feature), 'the branch is kept');
    assert.ok(!existsSync(join(worcaHome(), 'runs', st.id)), 'a legacy run never makes a run root');
    // No stray/ artifact dir is created when there is no run root to scan.
    assert.ok(!existsSync(join(st.pipelineDir, 'stray')), 'no stray dir on a legacy run');
    assert.ok(!existsSync(join(st.pipelineDir, 'run.json')), 'no manifest copy on a legacy run');
  });
});

test('legacy: a failed teardown commit survives a DB round trip and keeps the checkout', async () => {
  const repo = await freshRepo();
  await withMode('legacy', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    const realGit = orch._git.bind(orch);
    orch._git = (args, opts) => {
      const msgAt = args.indexOf('-m');
      if (args.includes('commit') && msgAt >= 0 && String(args[msgAt + 1] || '').startsWith('worca:')) {
        return Promise.resolve({ ok: false, code: 1, stdout: '', stderr: 'legacy commit failure' });
      }
      return realGit(args, opts);
    };
    const res = await orch.run();
    assert.equal(res.status, 'done');
    const st = orch.getState();
    assert.ok(existsSync(st.branch.worktreeDir));
    const saved = await readPipelineByKey(projectKey(repo), st.id);
    assert.equal(saved.state.branch.commitFailed.code, 'commit_failed');
    assert.equal(saved.state.branch.commitFailed.step, 'commit');
    assert.equal(saved.state.branch.worktreeRemoved, false);
  });
});
