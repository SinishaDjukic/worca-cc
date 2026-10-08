// Base conflicts (#620): the run-level orchestration in base-conflicts.mjs — check and record per member,
// Update branch (merge commit + fast-forward push when published), settling a resolution (leftover markers,
// a still-active resolve run) and the harness post-run step on a resolve run. Real repositories, temp DB.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { writeStoreMeta, findPipelineRowById } from '../src/core/artifacts.mjs';
import { updateBranchRecords } from '../src/core/checkout.mjs';
import { _testing as gitSync } from '../src/core/git-sync.mjs';
import { checkRunBase, updateRunBranch, settleResolutions, afterRunBaseCheck, resolveTaskText, workflowOfRow } from '../src/core/base-conflicts.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';
import { g, GITCONFIG, world as makeWorld, teammatePush, commitOnFeat, mergeBaseOnFeat } from './helpers/base-world.mjs';

let root; const saved = {};
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'base-conflicts-'));
  for (const k of ['HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'WORCA_HOME']) saved[k] = process.env[k];
  process.env.HOME = root; process.env.GIT_CONFIG_GLOBAL = join(root, 'gitconfig'); process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.WORCA_HOME = join(root, 'home');
  await writeFile(process.env.GIT_CONFIG_GLOBAL, GITCONFIG);
  _resetForTests();
});
after(async () => {
  _resetForTests();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true });
});
beforeEach(() => gitSync.reset());

const world = () => makeWorld(root);
const brOf = (id) => JSON.parse(findPipelineRowById(id).branch);
const auditOf = (id) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(id).map((r) => r.text);

/** A finished single-project run on `feat` of world `w`, registered as a project. */
async function seedRun(w, branch = {}, state = {}) {
  const { id, key } = await seedPipeline(w.a, { title: 'T', status: 'done', ...state,
    branch: { source: 'dev', feature: 'feat', branchKept: true, ...branch } });
  writeStoreMeta(key, 'project', { key, name: 'a', path: w.a });
  return { id, key };
}
/** A conflicting world: f.txt edited on both sides. */
function conflictWorld() {
  const w = world(); commitOnFeat(w, 'f.txt', 'feature\n'); teammatePush(w, 'f.txt', 'upstream\n');
  return w;
}

test('checkRunBase records conflicts on the branch record and returns them', async () => {
  const w = conflictWorld();
  const { id } = await seedRun(w);
  const r = await checkRunBase(id, { by: 'ann' });
  assert.equal(r.members.length, 1);
  assert.equal(r.members[0].baseCheck.status, 'conflicts');
  const br = brOf(id);
  assert.deepEqual(br.baseCheck.files, ['f.txt']);
  assert.equal(br.baseCheck.by, 'ann');
  assert.equal(br.baseCheck.tree, undefined, 'the tree id is never stored');
});

test('workspace: one record per member, in its own repo', async () => {
  const wa = conflictWorld();
  const wb = world();
  const projects = [
    { projectKey: 'mem-a-00000001', projectDir: wa.a, projectName: 'api' },
    { projectKey: 'mem-b-00000002', projectDir: wb.a, projectName: 'web' },
  ];
  const branches = {
    'mem-a-00000001': { source: 'dev', feature: 'feat', branchKept: true },
    'mem-b-00000002': { source: 'dev', feature: 'feat', branchKept: true },
  };
  const { id } = await seedWorkspacePipeline(wa.a, 'wks-bc-00000001', { title: 'WS', status: 'done', projects,
    projectKeys: projects.map((p) => p.projectKey), branches, branch: { ...branches['mem-a-00000001'] } }, projects);
  const r = await checkRunBase(id);
  assert.equal(r.members.length, 2);
  const wm = JSON.parse(findPipelineRowById(id).workspace_meta);
  assert.equal(wm.branches['mem-a-00000001'].baseCheck.status, 'conflicts');
  assert.equal(wm.branches['mem-b-00000002'].baseCheck.status, 'up-to-date');
});

test('updateRunBranch: clean -> merge commit, record up-to-date, ff push when published; never --force', async () => {
  const w = world(); commitOnFeat(w, 'f.txt', 'feature\n'); g(w.a, 'push', '-q', 'origin', 'feat'); teammatePush(w, 'g.txt', 'u\n');
  const { id } = await seedRun(w, { published: { remote: 'origin', sha: g(w.a, 'rev-parse', 'feat'), at: 'x' } });
  const r = await updateRunBranch({ id, by: 'ann' });
  assert.equal(r.via, 'commit-tree');
  assert.equal(r.push.pushed, true);
  assert.equal(g(w.a, 'rev-parse', 'origin/feat'), r.to);
  const br = brOf(id);
  assert.equal(br.baseCheck.status, 'up-to-date');
  assert.equal(br.published.sha, r.to);
  assert.ok(auditOf(id).some((t) => /Merged `origin\/dev` into `feat`.*pushed to `origin`/.test(t)));
});

test('updateRunBranch: an unpublished branch merges locally and is not pushed', async () => {
  const w = world(); commitOnFeat(w, 'f.txt', 'feature\n'); teammatePush(w, 'g.txt', 'u\n');
  const { id } = await seedRun(w);
  const r = await updateRunBranch({ id });
  assert.equal(r.push.pushed, false); assert.equal(r.push.reason, 'unpublished');
  assert.equal(g(w.a, 'rev-parse', 'feat'), r.to);
});

test('updateRunBranch refuses conflicts (CONFLICTS) and an up-to-date branch (UP_TO_DATE)', async () => {
  const w = conflictWorld();
  const { id } = await seedRun(w);
  await assert.rejects(updateRunBranch({ id }), { code: 'CONFLICTS' });
  assert.equal(brOf(id).baseCheck.status, 'conflicts', 'the refusal records the fresh check');
  const w2 = world();
  const { id: id2 } = await seedRun(w2);
  await assert.rejects(updateRunBranch({ id: id2 }), { code: 'UP_TO_DATE' });
});

test('updateRunBranch refuses a run that has not finished (NOT_FINISHED)', async () => {
  const w = world(); commitOnFeat(w, 'f.txt', 'feature\n'); teammatePush(w, 'g.txt', 'u\n');
  const { id } = await seedRun(w, {}, { status: 'running' });
  await assert.rejects(updateRunBranch({ id }), { code: 'NOT_FINISHED' });
});

test('settleResolutions: a marked member that no longer conflicts is pushed and unmarked', async () => {
  const w = conflictWorld();
  g(w.a, 'push', '-q', 'origin', 'feat');
  const { id, key } = await seedRun(w, { published: { remote: 'origin', sha: g(w.a, 'rev-parse', 'feat'), at: 'x' },
    baseResolve: { via: 'terminal', at: 'x', files: ['f.txt'], fileCount: 1 } });
  mergeBaseOnFeat(w);
  const { members } = await checkRunBase(id);
  assert.equal(members[0].baseCheck.status, 'up-to-date');
  const s = await settleResolutions(id, members, { by: 'ann' });
  assert.equal(s[key].push.pushed, true);
  assert.equal(s[key].baseCheck.status, 'up-to-date');
  assert.equal(brOf(id).baseResolve, undefined);
  assert.equal(g(w.a, 'rev-parse', 'origin/feat'), g(w.a, 'rev-parse', 'feat'));
  assert.ok(auditOf(id).some((t) => /resolved/.test(t)));
});

test('settleResolutions: markers committed in a terminal are caught, the mark stays, nothing is pushed', async () => {
  const w = conflictWorld();
  g(w.a, 'push', '-q', 'origin', 'feat');
  const pushed = g(w.a, 'rev-parse', 'feat');
  const { id, key } = await seedRun(w, { published: { remote: 'origin', sha: pushed, at: 'x' },
    baseResolve: { via: 'terminal', at: 'x', files: ['f.txt'], fileCount: 1 } });
  mergeBaseOnFeat(w, { markers: true });
  const { members } = await checkRunBase(id);
  assert.equal(members[0].baseCheck.status, 'up-to-date');
  const s = await settleResolutions(id, members);
  assert.equal(s[key].baseCheck.status, 'conflicts');
  assert.equal(s[key].baseCheck.kind, 'markers');
  assert.deepEqual(s[key].baseCheck.files, ['f.txt']);
  assert.equal(s[key].push, null);
  const br = brOf(id);
  assert.equal(br.baseCheck.kind, 'markers');
  assert.ok(br.baseResolve, 'the mark stays');
  assert.equal(g(w.a, 'rev-parse', 'origin/feat'), pushed, 'nothing was pushed');
});

test('settleResolutions keeps the mark and does not push when marker verification fails', async () => {
  const w = conflictWorld();
  g(w.a, 'push', '-q', 'origin', 'feat');
  const pushed = g(w.a, 'rev-parse', 'feat');
  const { id, key } = await seedRun(w, { published: { remote: 'origin', sha: pushed, at: 'x' },
    baseResolve: { via: 'terminal', at: 'x', files: ['f.txt'], fileCount: 1 } });
  mergeBaseOnFeat(w);
  const { members } = await checkRunBase(id);
  const real = gitSync.defaultRun;
  gitSync.setRunner((args, opts) => (args[0] === 'grep'
    ? Promise.resolve({ ok: false, stdout: '', stderr: 'fatal: object read failed', code: 128 })
    : real(args, opts)));

  const settled = await settleResolutions(id, members);

  assert.equal(settled[key].push, null);
  assert.equal(settled[key].verification.kind, 'failed');
  assert.ok(brOf(id).baseResolve, 'the mark stays');
  assert.equal(g(w.a, 'rev-parse', 'origin/feat'), pushed, 'nothing was pushed');
});

test('settleResolutions skips a member whose resolve run is still active (isActive)', async () => {
  const w = conflictWorld();
  const { id } = await seedRun(w, { baseResolve: { via: 'pipeline', runId: 'R1', at: 'x', files: ['f.txt'], fileCount: 1 } });
  mergeBaseOnFeat(w);
  const { members } = await checkRunBase(id);
  const s = await settleResolutions(id, members, { isActive: (r) => r === 'R1' });
  assert.deepEqual(s, {});
  assert.equal(brOf(id).baseResolve.runId, 'R1');
});

test('updateRunBranch refuses a member being resolved by an active run (RESOLVING)', async () => {
  const w = world(); commitOnFeat(w, 'f.txt', 'feature\n'); teammatePush(w, 'g.txt', 'u\n');
  const { id } = await seedRun(w, { baseResolve: { via: 'pipeline', runId: 'R1', at: 'x', files: [], fileCount: 0 } });
  await assert.rejects(updateRunBranch({ id, isActive: () => true }), { code: 'RESOLVING' });
  // A stale mark from a dead server does not block forever.
  const r = await updateRunBranch({ id, isActive: () => false });
  assert.equal(r.via, 'commit-tree');
  assert.equal(brOf(id).baseResolve, undefined);
});

test('afterRunBaseCheck on a resolve run refreshes the original and catches leftover markers', async () => {
  // Case 1: markers left in f.txt.
  {
    const w = conflictWorld();
    g(w.a, 'push', '-q', 'origin', 'feat');
    const pushed = g(w.a, 'rev-parse', 'feat');
    const { id: O, key } = await seedRun(w, { published: { remote: 'origin', sha: pushed, at: 'x' },
      baseResolve: { via: 'pipeline', runId: 'R-uuid', at: 'x', files: ['f.txt'], fileCount: 1 } });
    const { id: R } = await seedRun(w, { resolves: { runId: O, member: key } });
    mergeBaseOnFeat(w, { markers: true });
    await afterRunBaseCheck(R);
    const o = brOf(O);
    assert.equal(o.baseCheck.status, 'conflicts'); assert.equal(o.baseCheck.kind, 'markers');
    assert.equal(brOf(R).baseCheck.kind, 'markers');
    assert.ok(o.baseResolve, 'the mark stays');
    assert.equal(g(w.a, 'rev-parse', 'origin/feat'), pushed, 'nothing was pushed');
  }
  // Case 2: merged cleanly.
  {
    const w = conflictWorld();
    g(w.a, 'push', '-q', 'origin', 'feat');
    const { id: O, key } = await seedRun(w, { published: { remote: 'origin', sha: g(w.a, 'rev-parse', 'feat'), at: 'x' },
      baseResolve: { via: 'pipeline', runId: 'R-uuid', at: 'x', files: ['f.txt'], fileCount: 1 } });
    const { id: R } = await seedRun(w, { resolves: { runId: O, member: key } });
    mergeBaseOnFeat(w);
    await afterRunBaseCheck(R);
    const o = brOf(O);
    assert.equal(o.baseCheck.status, 'up-to-date');
    assert.equal(o.baseCheck.via.runId, R);
    assert.equal(o.baseResolve, undefined);
    assert.equal(g(w.a, 'rev-parse', 'origin/feat'), g(w.a, 'rev-parse', 'feat'), 'pushed');
  }
});

test('resolveTaskText names the merge, the files and the original task; workflowOfRow reads the stepper', () => {
  const t = resolveTaskText({ check: { base: 'dev', baseRef: 'origin/dev', baseSha: 'abcdef1234', at: 'T', files: ['a.js'], fileCount: 3 },
    feature: 'feat', title: 'Title', prompt: 'Do the thing' });
  assert.match(t, /git merge --no-ff origin\/dev/);
  assert.match(t, /- a\.js/);
  assert.match(t, /…and 2 more/);
  assert.match(t, /Do the thing$/);
  assert.equal(workflowOfRow({ stepper: JSON.stringify({ template: { id: 'wf_x' } }) }), 'wf_x');
  assert.equal(workflowOfRow({ stepper: null }), 'wf_default');
});
