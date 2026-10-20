// test/orchestrator-workspace-folder.test.mjs
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { projectKey } from '../src/core/store.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { readPipelineStateById } from '../src/core/artifacts.mjs';
import { workModeOf } from '../ui/public/run-kind.mjs';
import { _testing as gitInfoTesting } from '../src/core/git-info.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { addProject } from '../src/core/projects.mjs';
import { workspaceKey } from '../src/core/workspaces.mjs';
import { WORKSPACE_SCAN_WORKFLOW_ID } from '../src/core/graph/builtin-workflows.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);
const prevMode = process.env.WORCA_RUN_ROOT;
beforeEach(() => { process.env.WORCA_RUN_ROOT = 'detached'; });
after(() => { if (prevMode === undefined) delete process.env.WORCA_RUN_ROOT; else process.env.WORCA_RUN_ROOT = prevMode; });
after(() => gitInfoTesting.reset());
const created = [];
after(() => { for (const d of created) rmSync(d, { recursive: true, force: true }); });

const repo = () => { const d = templateRepo('wsf', { branch: 'main', user: true, files: { 'seed.txt': 'seed\n' } }); created.push(d); return d; };
const folder = (tag) => { const d = mkdtempSync(join(tmpdir(), `worca-wsf-${tag}-`)); writeFileSync(join(d, 'notes.txt'), 'n\n'); created.push(d); return d; };
const norm = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
const under = (cwd, roots) => !!cwd && roots.some((r) => norm(cwd) === norm(r) || norm(cwd).startsWith(norm(r) + sep));
const branchList = (dir) => spawnSync('git', ['-C', dir, 'branch', '--format=%(refname:short)']).stdout.toString().split(/\r?\n/).filter(Boolean);
/** The workspace opts the server builds (Task 5): sorted by projectKey, each member with its workMode. */
function wsOpts(members, branch = { source: 'main', feature: 'add-x' }) {
  const projects = members
    .map(([dir, workMode]) => ({ projectDir: dir, projectKey: projectKey(dir), projectName: basename(dir), workMode, branch }))
    .sort((a, b) => (a.projectKey < b.projectKey ? -1 : 1));
  return { workspace: { id: 'wks-mixed-0000abcd', key: 'wks-mixed-0000abcd', name: 'Mixed', description: '', projects }, branch };
}
/** Every git cwd the harness spawns through its two seams (H1 §7): `_git` and git-info's runner. */
function spyGit(orch) {
  const cwds = [];
  const realGit = orch._git.bind(orch);
  orch._git = (args, o = {}) => { cwds.push(o.cwd); return realGit(args, o); };
  gitInfoTesting.setRunner((cmd, args, o = {}) => { if (cmd === 'git') cwds.push(o.cwd); return gitInfoTesting.defaultRun(cmd, args, o); });
  return cwds;
}

test('mixed workspace run: the Git member gets a worktree and a branch, the Folder member a copy with its own changes; git never runs for the folder', async () => {
  const g = repo(); const f = folder('mixed');
  const kg = projectKey(g), kf = projectKey(f);
  const orch = createOrchestrator({ ...wsOpts([[g, 'git'], [f, 'folder']]), prompt: 'Add x', auto: true, claude: { mock: true } });
  const cwds = spyGit(orch);
  const seen = {};
  orch.on('state', () => {
    if (!seen.channel && orch.workDirs.size === 2) { seen.channel = orch._workspaceChannel().projects; seen.repos = orch._reposCtx(); }
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  const runRoot = join(worcaHome(), 'runs', st.id);
  const copy = join(runRoot, 'repos', kf);
  await checkRows([
    { name: 'the Git member: a worca branch in its own repo, its worktree removed', run: () => {
      assert.match(st.branches[kg].feature, /^add-x-/);
      assert.ok(branchList(g).includes(st.branches[kg].feature));
      assert.ok(!existsSync(join(runRoot, 'repos', kg)));
    } },
    { name: 'the Folder member: P1a\'s copy record (copyDir, never worktreeDir), no checkpoint, workMode on state.projects', run: () => {
      assert.equal(st.branches[kf].workMode, 'folder');
      assert.equal(st.branches[kf].copyDir, copy);
      assert.equal(st.branches[kf].realDir, f);
      assert.equal(st.branches[kf].worktreeDir ?? null, null);
      assert.equal(st.branches[kf].feature ?? null, null);
      assert.equal(st.branches[kf].changes.state, 'pending');
      assert.equal(st.checkpointRefs[kf] ?? null, null);
      assert.deepEqual(st.projects.map((p) => `${p.projectKey}:${p.workMode ?? '-'}`).sort(), [`${kf}:folder`, `${kg}:-`].sort());
      assert.equal(Object.hasOwn(st, 'workMode'), false, 'a workspace with a Git member is a git run: state.workMode stays absent (absent = git)');
    } },
    { name: 'the Folder member has its own changes under members/<key>/, and its files join results.json perProject', run: () => {
      assert.deepEqual(JSON.parse(readFileSync(join(st.pipelineDir, 'results.json'), 'utf8')).perProject[kf].summary.filesNew, 2);
      const ch = JSON.parse(readFileSync(join(st.pipelineDir, 'members', kf, 'changes.json'), 'utf8'));
      assert.deepEqual(ch.files.map((x) => `${x.change} ${x.path}`), ['added src/feature.mjs', 'added test/feature.test.mjs']);
      assert.deepEqual(ch.counts, { added: 2, modified: 0, deleted: 0 });
      assert.ok(existsSync(join(st.pipelineDir, 'members', kf, 'changes.patch')));
    } },
    { name: 'the real folder is untouched: no .git, no new file', run: () => {
      assert.deepEqual(readdirSync(f), ['notes.txt']);
    } },
    { name: '0 git calls for the Folder member (its real folder or its copy)', run: () => {
      assert.deepEqual(cwds.filter((c) => under(c, [f, realpathSync.native(f), copy])), []);
      assert.ok(cwds.some((c) => under(c, [g, realpathSync.native(g)])), 'the spy is live: it saw the Git member');
    } },
    { name: 'the channel and the repos roster mark only the Folder member (workMode + its changes.patch)', run: () => {
      const pick = (list, k) => list.find((p) => p.projectKey === k);
      for (const list of [seen.channel, seen.repos]) {
        assert.equal(pick(list, kf).workMode, 'folder');
        assert.equal(pick(list, kf).changesPatch, join(st.pipelineDir, 'members', kf, 'changes.patch'));
        assert.equal(Object.hasOwn(pick(list, kg), 'workMode'), false);
        assert.equal(Object.hasOwn(pick(list, kg), 'changesPatch'), false);
      }
    } },
    { name: 'the run root is retained for the Folder member only (folder-apply)', run: () => {
      const man = JSON.parse(readFileSync(join(runRoot, 'run.json'), 'utf8'));
      assert.equal(man.retain.reason, 'folder-apply');
      assert.deepEqual(man.retain.members.map((m) => `${m.projectKey} ${m.reason} ${m.copyDir}`), [`${kf} folder-apply ${copy}`]);
      assert.deepEqual(man.members.map((m) => `${m.projectKey}:${m.workMode ?? '-'}`).sort(), [`${kf}:folder`, `${kg}:-`].sort());
      assert.ok(existsSync(copy));
    } },
    { name: 'the Git primary\'s scalar mirror gets its teardown stamps: a pending Folder copy is no retained worktree', run: () => {
      assert.ok(kg < kf, 'the Git member sorts first: it is the primary');
      for (const b of [st.branch, readPipelineStateById(st.id).branch]) {
        assert.deepEqual([b.worktreeRemoved, b.branchKept], [true, true]);
      }
    } },
  ]);
});

test('a Folder primary under run-root mode legacy: its copy still lives in the run root and state.branch mirrors its record', async () => {
  process.env.WORCA_RUN_ROOT = 'legacy';
  const g = repo();
  const f = mkdtempSync(join(tmpdir(), 'worca-a-')); writeFileSync(join(f, 'notes.txt'), 'n\n'); created.push(f);
  const kg = projectKey(g), kf = projectKey(f);
  assert.ok(kf < kg, 'the Folder member sorts first: it is the primary');
  const orch = createOrchestrator({ ...wsOpts([[g, 'git'], [f, 'folder']]), prompt: 'Add x', auto: true, claude: { mock: true } });
  const frames = new Set();
  orch.on('state', (s) => frames.add(workModeOf(s)));
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  assert.equal(st.runRootMode, 'detached');
  assert.equal(st.branches[kf].copyDir, join(worcaHome(), 'runs', st.id, 'repos', kf));
  const { workMode, ...mirror } = st.branches[kf];
  assert.equal(workMode, 'folder');
  assert.deepEqual(st.branch, mirror, 'the scalar mirror is the primary Folder member\'s record, without its workMode (a mixed workspace is a git run)');
  assert.equal(workModeOf(st), 'git', 'live state: the UI reads a git run (Diff, PR, Actions)');
  assert.deepEqual([...frames], ['git'], 'every state frame from setup on reads a git run');
  assert.equal(workModeOf(readPipelineStateById(st.id)), 'git', 'History detail: the persisted branch column says git too');
  assert.deepEqual(readdirSync(f), ['notes.txt']);
});

const pauseWhenCopied = (orch, keys) => {
  let fired = false;
  orch.on('state', (s) => {
    if (fired || !s.branches || !keys.every((k) => s.branches[k]?.copyDir && existsSync(s.branches[k].copyDir))) return;
    fired = true; orch.pause();
  });
};

test('an orphan Git member started without git resumes as a folder with git installed; a paused run stops into a retained copy', async (t) => {
  const o = repo(); const f = folder('orphan');                  // `o` has .git; started without git it is a folder
  const ko = projectKey(o), kf = projectKey(f);
  const opts = wsOpts([[o, 'folder'], [f, 'folder']]);
  const ids = [];
  // Only this subtest runs without git: withNoGit restores git when the subtest ends.
  await t.test('two runs start and pause without git', async (st) => {
    await withNoGit(st);
    for (let i = 0; i < 2; i++) {
      const orch = createOrchestrator({ ...opts, prompt: 'Add x', auto: true, claude: { mock: true } });
      pauseWhenCopied(orch, [ko, kf]);
      assert.equal((await orch.run()).status, 'paused');
      ids.push(orch.getState().id);
    }
  });
  await checkRows([
    { name: 'resume (git on): the members come back from workspace_meta.projects as folders; 0 git calls for either', run: async () => {
      const saved = readPipelineForResume(ids[0]);
      const meta = JSON.parse(saved.row.workspace_meta);
      assert.deepEqual(meta.projects.map((p) => p.workMode), ['folder', 'folder']);
      const orch = createOrchestrator({ workspace: { ...opts.workspace, projects: meta.projects }, auto: true, claude: { mock: true }, resume: saved });
      const cwds = spyGit(orch);
      assert.equal((await orch.resume()).status, 'done');
      const st = orch.getState();
      const copies = [ko, kf].map((k) => join(worcaHome(), 'runs', st.id, 'repos', k));
      assert.deepEqual(cwds.filter((c) => under(c, [o, realpathSync.native(o), f, realpathSync.native(f), ...copies])), []);
      assert.equal(st.branches[ko].copyDir, copies[0], 're-attached, not re-copied');
      assert.ok(!branchList(o).some((b) => b.startsWith('worca-cc/')), 'no worca branch in the orphan repo');
      assert.deepEqual(JSON.parse(readFileSync(join(st.pipelineDir, 'members', kf, 'changes.json'), 'utf8')).counts, { added: 2, modified: 0, deleted: 0 });
    } },
    { name: 'stop of a paused run: status stopped, each Folder member has its changes and its copy is retained', run: async () => {
      const saved = readPipelineForResume(ids[1]);
      const meta = JSON.parse(saved.row.workspace_meta);
      for (const k of [ko, kf]) writeFileSync(join(worcaHome(), 'runs', ids[1], 'repos', k, 'stopped.txt'), 'work so far\n');   // the agent's work so far
      const orch = createOrchestrator({ workspace: { ...opts.workspace, projects: meta.projects }, claude: { mock: true }, resume: saved });
      assert.equal((await orch.stopPaused('local')).status, 'stopped');
      const man = JSON.parse(readFileSync(join(worcaHome(), 'runs', ids[1], 'run.json'), 'utf8'));
      assert.deepEqual(man.retain.members.map((m) => m.projectKey).sort(), [ko, kf].sort());
      for (const k of [ko, kf]) {
        assert.deepEqual(JSON.parse(readFileSync(join(orch.getState().pipelineDir, 'members', k, 'changes.json'), 'utf8')).files.map((x) => `${x.change} ${x.path}`), ['added stopped.txt']);
      }
    } },
  ]);
});

test('WORCA_GIT=0: an all-Folder workspace run never spawns git and lands one changes.json per member', async (t) => {
  const f1 = folder('nog1'); const f2 = folder('nog2');
  await withNoGit(t);
  {
    const orch = createOrchestrator({ ...wsOpts([[f1, 'folder'], [f2, 'folder']]), prompt: 'Add x', auto: true, claude: { mock: true } });
    const cwds = spyGit(orch);
    assert.equal((await orch.run()).status, 'done');
    const st = orch.getState();
    assert.equal(st.workMode, 'folder');
    assert.equal(st.checkpointRef ?? null, null);
    assert.deepEqual(cwds, [], 'no git anywhere');
    const k1 = projectKey(f1), k2 = projectKey(f2);
    const man = JSON.parse(readFileSync(join(worcaHome(), 'runs', st.id, 'run.json'), 'utf8'));
    assert.equal(man.isWorkspace, true);
    assert.deepEqual(man.members.map((m) => `${m.projectKey}:${m.workMode}`).sort(), [`${k1}:folder`, `${k2}:folder`].sort());
    assert.deepEqual(man.retain.members.map((m) => m.projectKey).sort(), [k1, k2].sort());
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(st.pipelineDir, 'results.json'), 'utf8')).perProject).sort(), [k1, k2].sort());
    assert.equal(orch.runCwd, join(worcaHome(), 'runs', st.id), 'the agents work at the neutral run root');
    for (const k of [projectKey(f1), projectKey(f2)]) {
      assert.deepEqual(JSON.parse(readFileSync(join(st.pipelineDir, 'members', k, 'changes.json'), 'utf8')).counts, { added: 2, modified: 0, deleted: 0 });
    }
  }
});

test('a read-only Workspace scan copies a Folder member, retains nothing, writes no changes and saves the workspace', async () => {
  const g = repo(); const f = folder('scan');
  await addProject({ name: 'Scan Notes', path: f });              // finalize creates the workspace: Task 1's rule applies
  const name = 'Scan Mixed';
  const id = workspaceKey({ name, projectPaths: [g, f] });
  const orch = createOrchestrator({ workspace: { id, key: id, name, description: '', projects: wsOpts([[g, 'git'], [f, 'folder']]).workspace.projects },
    branch: { source: 'main' }, workflowId: WORKSPACE_SCAN_WORKFLOW_ID, prompt: `Scan the interconnections of the workspace "${name}".`,
    auto: true, claude: { mock: true } });
  const cwds = spyGit(orch);
  assert.equal((await orch.run()).status, 'done');
  const st = orch.getState();
  assert.equal(st.workspaceScan.outcome, 'created');
  assert.ok(!existsSync(join(worcaHome(), 'runs', st.id)), 'a scan lands nothing: the run root is gone');
  assert.ok(!existsSync(join(st.pipelineDir, 'members', projectKey(f), 'changes.json')));
  assert.deepEqual(cwds.filter((c) => under(c, [f, realpathSync.native(f)])), []);
  assert.deepEqual(readdirSync(f), ['notes.txt']);
});

test('a resumed workspace whose Folder member copy was swapped for a link ends with copy missing and never writes the folder', async () => {
  const f1 = folder('swap1'); const f2 = folder('swap2');
  const k1 = projectKey(f1), k2 = projectKey(f2);
  const opts = wsOpts([[f1, 'folder'], [f2, 'folder']]);
  const first = createOrchestrator({ ...opts, prompt: 'Add x', auto: true, claude: { mock: true } });
  pauseWhenCopied(first, [k1, k2]);
  assert.equal((await first.run()).status, 'paused');
  const id = first.getState().id;
  const copy2 = join(worcaHome(), 'runs', id, 'repos', k2);
  rmSync(copy2, { recursive: true, force: true });
  symlinkSync(f2, copy2, 'dir');                                   // the copy now points at the real folder
  const saved = readPipelineForResume(id);
  const orch = createOrchestrator({ workspace: { ...opts.workspace, projects: JSON.parse(saved.row.workspace_meta).projects }, auto: true, claude: { mock: true }, resume: saved });
  const res = await orch.resume();
  assert.equal(res.status, 'error', JSON.stringify(res));
  assert.equal(res.error, `copy missing: ${copy2} — cannot resume`);
  assert.deepEqual(readdirSync(f2), ['notes.txt']);
});

test('a mixed workspace whose Folder member copy is swapped for a link mid-run pauses at the next node and never writes the link target', async () => {
  const g = repo(); const f = folder('swapm'); const target = folder('swapm-target');
  const kf = projectKey(f);
  const orch = createOrchestrator({ ...wsOpts([[g, 'git'], [f, 'folder']]), prompt: 'Add x', auto: true, claude: { mock: true } });
  let swapped = false;
  orch.on('state', () => {
    const copy = orch.workDirs.get(kf);
    if (swapped || orch.workDirs.size !== 2 || !orch.runCwd || !copy || !existsSync(copy)) return;
    swapped = copy;
    rmSync(copy, { recursive: true, force: true });
    symlinkSync(target, copy, 'dir');                                // the copy now points at another folder
  });
  const res = await orch.run();
  assert.ok(swapped, 'the copy was swapped after setup');
  assert.equal(res.status, 'paused', JSON.stringify(res));
  // The pause names the member's copy that was swapped, not the run root (a workspace's cwd names no member).
  assert.equal(orch.getState().pauseDetail, `the run's copy is not the run's own folder: ${swapped}`);
  assert.deepEqual(readdirSync(target), ['notes.txt'], 'no agent wrote through the link');
  assert.deepEqual(readdirSync(f), ['notes.txt']);
});

test('a stopped mixed workspace run whose only changes are its Folder member\'s still writes results.json', async () => {
  const g = repo(); const f = folder('stopf');
  const kg = projectKey(g), kf = projectKey(f);
  const opts = wsOpts([[g, 'git'], [f, 'folder']]);
  const first = createOrchestrator({ ...opts, prompt: 'Add x', auto: true, claude: { mock: true } });
  let fired = false;
  first.on('state', (s) => { if (!fired && first.workDirs.size === 2 && s.checkpointRefs?.[kg]) { fired = true; first.pause(); } });
  assert.equal((await first.run()).status, 'paused');
  const id = first.getState().id;
  writeFileSync(join(worcaHome(), 'runs', id, 'repos', kf, 'stopped.txt'), 'work so far\n');
  const saved = readPipelineForResume(id);
  const orch = createOrchestrator({ workspace: { ...opts.workspace, projects: JSON.parse(saved.row.workspace_meta).projects }, claude: { mock: true }, resume: saved });
  assert.equal((await orch.stopPaused('local')).status, 'stopped');
  const file = join(orch.getState().pipelineDir, 'results.json');
  assert.ok(existsSync(file), 'results.json is written for the Folder member\'s changes');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).perProject[kf].summary.filesNew, 1);
});

test('an all-Git workspace run writes no Folder key anywhere (byte-identical without a Folder member)', async () => {
  const a = repo(); const b = repo();
  const orch = createOrchestrator({ ...wsOpts([[a, 'git'], [b, 'git']]), prompt: 'Add x', auto: true, claude: { mock: true } });
  const seen = {};
  orch.on('state', () => {
    if (!seen.channel && orch.workDirs.size === 2) { seen.channel = orch._workspaceChannel().projects; seen.repos = orch._reposCtx(); seen.rp = orch._workspaceProjects(); }
  });
  assert.equal((await orch.run()).status, 'done');
  const st = orch.getState();
  const man = JSON.parse(readFileSync(join(st.pipelineDir, 'run.json'), 'utf8'));
  const meta = JSON.parse(getDb().prepare('SELECT workspace_meta FROM pipelines WHERE id = ?').get(st.id).workspace_meta);
  const noKey = (o, k, where) => assert.equal(Object.hasOwn(o, k), false, `${where}: ${k}`);
  noKey(st, 'workMode', 'state'); noKey(meta, 'workMode', 'workspace_meta');
  for (const [where, list] of [['state.projects', st.projects], ['workspace_meta.projects', meta.projects], ['run.json members', man.members],
    ['channel', seen.channel], ['repos', seen.repos], ['resume point', seen.rp], ['members', orch.members]]) {
    for (const x of list) for (const k of ['workMode', 'copyDir', 'changesPatch']) noKey(x, k, where);
  }
  for (const r of Object.values(st.branches)) for (const k of ['workMode', 'copyDir', 'changes']) noKey(r, k, 'state.branches');
  assert.ok(!existsSync(join(st.pipelineDir, 'members')));
});

test('a mixed workspace keeps its Folder member\'s copy warnings in run.json (the minimal manifest never drops them)', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const { chmodSync } = await import('node:fs');
  const g = repo(); const f = folder('warn');
  writeFileSync(join(f, 'secret.key'), 'k\n'); chmodSync(join(f, 'secret.key'), 0o000);
  try {
    const orch = createOrchestrator({ ...wsOpts([[g, 'git'], [f, 'folder']]), prompt: 'Add x', auto: true, claude: { mock: true } });
    assert.equal((await orch.run()).status, 'done');
    const man = JSON.parse(readFileSync(join(orch.getState().pipelineDir, 'run.json'), 'utf8'));
    assert.ok((man.warnings || []).includes('left 1 unreadable item(s) out of the copy: secret.key'), JSON.stringify(man.warnings));
  } finally { chmodSync(join(f, 'secret.key'), 0o600); }
});
