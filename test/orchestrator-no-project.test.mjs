// test/orchestrator-no-project.test.mjs — P3: a run without a project, harness level. The store lives INSIDE a git
// repository (as the full suite's .worca-cc-test does), so any git call in work/ would reach it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { gitDir } from './helpers/git-dir.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { newPipelineId, findPipelineRowById, listRunArtifacts, readStoreMeta } from '../src/core/artifacts.mjs';
import { NO_PROJECT_KEY, noProjectWorkDir } from '../src/core/store.mjs';
import { countProjects, worcaHome } from '../src/core/projects.mjs';
import { mountDirs } from '../src/core/memory-sync.mjs';
import { withNoGit } from './helpers/git-off.mjs';     // P0 (S24): WORCA_GIT=0 + _testing.set({ available:false }), restored after

// Every git child process, whoever starts it (harness _git, the git-info / git-sync runners, store.mjs
// canonicalProjectRoot, run-context, worktree.mjs, preflight, mcpjson-approval …): child_process is wrapped once
// and the live ESM bindings re-synced, so a module's `import { execFileSync }` reaches the wrapper too.
const cp = createRequire(import.meta.url)('node:child_process');
const gitSpawns = { armed: false, sites: [] };
const SHELL = /^(.*[\\/])?(sh|bash|zsh|cmd(\.exe)?)$/i;
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync']) {
  const orig = cp[name];
  cp[name] = function (cmd, args, ...rest) {
    const argv = Array.isArray(args) ? args : [];
    const line = name === 'exec' || name === 'execSync' ? String(cmd) : SHELL.test(String(cmd)) ? argv.join(' ') : '';
    if (gitSpawns.armed && (/(^|[\\/])git(\.exe)?$/i.test(String(cmd)) || /(^|[\s;&|(])git\s/.test(line))) {
      gitSpawns.sites.push(`${name}(${cmd} ${argv.slice(0, 3).join(' ')}) ${new Error().stack.split('\n').slice(2, 5).map((l) => l.trim()).join(' < ')}`);
    }
    return orig.call(this, cmd, args, ...rest);
  };
}
syncBuiltinESMExports();

const host = gitDir('np-host');
const prevHome = process.env.WORCA_HOME;
process.env.WORCA_HOME = join(host, 'home');
mkdirSync(process.env.WORCA_HOME, { recursive: true });
_resetForTests();
after(() => {
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  _resetForTests();
  rmSync(host, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
const hostGit = (...a) => execFileSync('git', ['-C', host, ...a]).toString().trim();

async function runNoProject(workflowId, prompt, { beforeTeardown = null } = {}) {
  const pipelineId = newPipelineId();
  gitSpawns.sites = [];
  gitSpawns.armed = true;                          // armed before construction: the constructor reads settings too
  try {
    const orch = createOrchestrator({ workMode: 'none', pipelineId, projectKey: NO_PROJECT_KEY, projectDir: noProjectWorkDir(pipelineId), workflowId, prompt, claude: { mock: true }, auto: true });
    if (beforeTeardown) {
      const real = orch._teardownRunRoot.bind(orch);
      orch._teardownRunRoot = async () => { await beforeTeardown(orch); return real(); };
    }
    const res = await orch.run();
    return { orch, res, gitCalls: gitSpawns.sites.slice(), pipelineId };
  } finally { gitSpawns.armed = false; }
}

test('never process.cwd(): a run without a project needs its id and works only in its own folder', () => {
  assert.throws(() => createOrchestrator({ workMode: 'none', prompt: 'x', claude: { mock: true } }), { message: 'a run without a project needs its pipeline id' });
  assert.throws(() => createOrchestrator({ workMode: 'none', pipelineId: 'abcd1234', projectDir: host, prompt: 'x', claude: { mock: true } }),
    { message: 'a run without a project works only in its own work folder' });
  assert.throws(() => createOrchestrator({ workMode: 'none', pipelineId: 'abcd1234', projectDir: noProjectWorkDir('ffff0000'), prompt: 'x', claude: { mock: true } }),
    { message: 'a run without a project works only in its own work folder' }, 'another run\'s work folder is not its own');
  for (const workMode of [undefined, 'git', 'folder']) {
    assert.throws(() => createOrchestrator({ workMode, projectDir: noProjectWorkDir('ffff0000'), prompt: 'x', claude: { mock: true } }),
      { message: 'this folder belongs to a run without a project' }, `a ${workMode || 'default'} run never takes a run's work folder`);
  }
  const cwd = process.cwd();
  mkdirSync(noProjectWorkDir('ffff0000'), { recursive: true });
  process.chdir(noProjectWorkDir('ffff0000'));   // a caller that names no projectDir runs in its cwd: never a run's work folder either
  try {
    assert.throws(() => createOrchestrator({ prompt: 'x', claude: { mock: true } }), { message: 'this folder belongs to a run without a project' });
  } finally {
    process.chdir(cwd);
    rmSync(join(worcaHome(), 'runs', 'ffff0000'), { recursive: true, force: true });
  }
  const o = createOrchestrator({ workMode: 'none', pipelineId: 'abcd1234', prompt: 'x', claude: { mock: true } });
  assert.equal(o.projectDir, noProjectWorkDir('abcd1234'));
  assert.deepEqual(o.members, [{ projectKey: NO_PROJECT_KEY, projectName: 'No project', projectDir: noProjectWorkDir('abcd1234') }], 'even without opts.projectKey');
  assert.deepEqual(o.getState().branch, { workMode: 'none', runRootMode: 'detached' }, 'recorded before setup, so a pre-setup pause resumes as none');
  assert.deepEqual([o.getState().projectKey, o.getState().projectName], [NO_PROJECT_KEY, 'No project']);
  assert.deepEqual(mountDirs({ members: o.members }).map((d) => d.rel), ['global'], 'memory: global only');
  // a resume of a row paused before its first branch persist still knows it is a run without a project
  const r = createOrchestrator({ resume: { row: { id: 'abcd1234', project_key: NO_PROJECT_KEY, branch: null }, resumePoint: null, steps: [] }, claude: { mock: true } });
  assert.deepEqual([r.workMode, r.projectDir], ['none', noProjectWorkDir('abcd1234')]);
});

test('the default workflow with no project: done, 0 git spawns, work/ kept as artifacts, the host repo untouched', { timeout: 180000 }, async () => {
  // git IS installed (tools/test.mjs exports WORCA_GIT=1, S1): the skips, not P0's short-circuit, keep it at 0
  const head = hostGit('rev-parse', 'HEAD');
  const projects = countProjects();
  const { orch, res, gitCalls, pipelineId } = await runNoProject('wf_default', 'Make a hello page');
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(gitCalls, []);
  const row = findPipelineRowById(pipelineId);
  assert.equal(row.project_key, NO_PROJECT_KEY);
  assert.equal(row.target, 'project');
  assert.deepEqual(JSON.parse(row.branch), { workMode: 'none', runRootMode: 'detached' });
  assert.equal(orch.getState().workMode, 'none');
  assert.equal(orch.policyRun, null, 'no team policy for no project');
  assert.equal(readStoreMeta(NO_PROJECT_KEY).name, 'No project');
  // Every run without a project shares one store: its plan and review names carry its own id, so another run with the
  // same title on the same day never overwrites them (and archiving that run never deletes them).
  assert.ok(row.base_name.endsWith(`-${pipelineId}`), row.base_name);
  const docs = (await listRunArtifacts(pipelineId)).filter((a) => /^(plans|reviews)\//.test(a.relPath));
  assert.ok(docs.length && docs.every((a) => a.relPath.includes(`-${pipelineId}`)), docs.map((a) => a.relPath).join('\n'));
  assert.ok(existsSync(join(orch.pipeline.dir, 'work', 'src', 'feature.mjs')), 'the mock implementer wrote into its cwd');
  assert.equal(existsSync(join(orch.pipeline.dir, 'work', '.claude', 'rules', 'worca')), false, 'the memory rules copy is removed before the move');
  assert.equal(existsSync(join(orch.pipeline.dir, 'results.json')), false, 'no results.json: the files are the result');
  assert.ok((await listRunArtifacts(pipelineId)).some((a) => a.kind === 'work' && a.relPath === 'work/src/feature.mjs'));
  const manifest = JSON.parse(readFileSync(join(orch.pipeline.dir, 'run.json'), 'utf8'));
  assert.deepEqual([manifest.workMode, manifest.members, manifest.workHarvested.files, manifest.retain], ['none', [], 2, null]);
  assert.equal((manifest.warnings || []).some((w) => /projects root/.test(w)), false, 'the default projects root never warns, and a run\'s own work/ is never a project');
  assert.equal(existsSync(join(worcaHome(), 'runs', pipelineId)), false, 'the run root is gone');
  assert.doesNotMatch(readFileSync(join(orch.pipeline.dir, 'live-log.ndjson'), 'utf8'), /memory not mounted/);
  assert.equal(countProjects(), projects);
  assert.equal(hostGit('rev-parse', 'HEAD'), head);
  assert.equal(hostGit('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length, 1);
  assert.deepEqual(hostGit('branch', '--format=%(refname:short)').split('\n'), [hostGit('rev-parse', '--abbrev-ref', 'HEAD')]);
  assert.equal(existsSync(join(orch.pipeline.dir, 'work', '.git')), false);
});

test('Presentation with no project: done, 0 git spawns, its deck in Artifacts', { timeout: 180000 }, async () => {
  const { res, gitCalls, pipelineId } = await runNoProject('wf_presentation', 'a five-minute deck on why worca');
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(gitCalls, []);
  const kinds = (await listRunArtifacts(pipelineId)).map((a) => `${a.kind}:${a.relPath}`);
  assert.ok(kinds.includes('deck:deck/deck.html'), kinds.join('\n'));
  assert.equal(findPipelineRowById(pipelineId).project_key, NO_PROJECT_KEY);
});

test('work/ that cannot be copied keeps the run root, records why, and indexes nothing', { timeout: 180000 }, async () => {
  // a FILE where the harvest's destination folder goes: the move takes the copy path and the copy fails
  const { orch, res, pipelineId } = await runNoProject('wf_default', 'Make a hello page', { beforeTeardown: (o) => writeFileSync(join(o.pipeline.dir, 'work'), 'in the way') });
  assert.equal(res.status, 'done', res.error);
  const work = join(worcaHome(), 'runs', pipelineId, 'work');
  assert.ok(existsSync(join(work, 'src', 'feature.mjs')), 'the run root and its work/ are kept');
  const { retain } = JSON.parse(readFileSync(join(orch.pipeline.dir, 'run.json'), 'utf8'));
  assert.equal(retain.reason, 'work_copy_failed');
  assert.deepEqual(retain.members.map(({ at, ...m }) => m), [{ projectKey: NO_PROJECT_KEY, copyDir: work, workMode: 'none', reason: 'work_copy_failed' }]);
  assert.equal((await listRunArtifacts(pipelineId)).some((a) => a.kind === 'work'), false);
  assert.match(readFileSync(join(orch.pipeline.dir, 'live-log.ndjson'), 'utf8'), /work\/ could not be copied \(.+\); the run root is kept at /);
});

test('a work/ an agent swapped for a link before teardown: nothing is rescued or removed through it, the root is kept (P3-D19)', { timeout: 180000 }, async () => {
  const outside = join(host, 'outside');
  mkdirSync(join(outside, '.claude', 'rules', 'worca'), { recursive: true });
  writeFileSync(join(outside, '.claude', 'rules', 'worca', 'keep.md'), 'not worca\'s');
  const { orch, res, pipelineId } = await runNoProject('wf_default', 'Make a hello page', { beforeTeardown: (o) => {
    const work = join(worcaHome(), 'runs', o.pipeline.id, 'work');
    renameSync(work, `${work}.real`);
    symlinkSync(outside, work, 'junction');
  } });
  assert.equal(res.status, 'done', res.error);
  assert.equal(readFileSync(join(outside, '.claude', 'rules', 'worca', 'keep.md'), 'utf8'), 'not worca\'s', 'the memory mount\'s path is never removed through the link');
  assert.equal(JSON.parse(readFileSync(join(orch.pipeline.dir, 'run.json'), 'utf8')).retain.reason, 'work_copy_failed');
  assert.equal((await listRunArtifacts(pipelineId)).some((a) => a.kind === 'work'), false);
});

test('a machine without git: a no-project run still ends done with its files', { timeout: 180000 }, async (t) => {
  withNoGit(t);
  const { res, pipelineId } = await runNoProject('wf_default', 'Make a hello page');
  assert.equal(res.status, 'done', res.error);
  assert.ok((await listRunArtifacts(pipelineId)).some((a) => a.relPath === 'work/src/feature.mjs'));
});

test('Memory defragment with no project (U13): global memory only, done, 0 git spawns', { timeout: 180000 }, async () => {
  const pipelineId = newPipelineId();
  gitSpawns.sites = [];
  gitSpawns.armed = true;
  let orch, res;
  try {
    orch = createOrchestrator({ workMode: 'none', pipelineId, projectKey: NO_PROJECT_KEY, projectDir: noProjectWorkDir(pipelineId), workflowId: 'wf_memory_defrag', memoryScope: 'global', prompt: 'Defragment global memory.', claude: { mock: true }, auto: true });
    res = await orch.run();
  } finally { gitSpawns.armed = false; }
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(gitSpawns.sites, []);
  assert.deepEqual(orch.memory.dirs.map((d) => d.rel), ['global']);
});
