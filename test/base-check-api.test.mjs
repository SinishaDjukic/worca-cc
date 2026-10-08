// Base conflicts (#620): the HTTP routes. POST /api/runs/:id/base-check records each member's check,
// update-branch merges a clean base (and fast-forward pushes a published branch), resolve-pipeline starts a
// mock run on the EXISTING branch and marks the original, and a live resolve run blocks the other actions (D18).
// Real repositories, the real server on an ephemeral port, WORCA_MOCK=1 so a started run is a mock run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests as closeDbForTests, getDb } from '../src/core/db.mjs';
import { writeStoreMeta, findPipelineRowById } from '../src/core/artifacts.mjs';
import { updateBranchRecords } from '../src/core/checkout.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';
import { stopAndSettle } from './helpers/stop-and-settle.mjs';
import { g, GITCONFIG, world as makeWorld, teammatePush, commitOnFeat } from './helpers/base-world.mjs';

const ENV_KEYS = ['WORCA_HOME', 'WORCA_MOCK', 'HOME', 'USERPROFILE', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'WORCA_RUN_ROOT'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let root, mod, srv, base;
let conflict, clean, upToDate, running, wsId, wsKeys, wsWorlds;

const post = async (path, rid, q, body = {}) => {
  const r = await fetch(`${base}/api/runs/${encodeURIComponent(rid)}/${path}?${new URLSearchParams(q)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const brOf = (id) => JSON.parse(findPipelineRowById(id).branch);

/** A finished run on `feat` of world `w`, registered as a project. */
async function seedRun(w, branch = {}, state = {}) {
  const { id, key } = await seedPipeline(w.a, { title: 'My feature', prompt: 'Build the thing', status: 'done', ...state,
    branch: { source: 'dev', feature: 'feat', branchKept: true, ...branch } });
  writeStoreMeta(key, 'project', { key, name: 'a', path: w.a });
  return { id, key, w };
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'base-check-api-'));
  await writeFile(join(root, 'gitconfig'), GITCONFIG);
  Object.assign(process.env, { WORCA_HOME: join(root, 'home'), WORCA_MOCK: '1', HOME: root, USERPROFILE: root,
    GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', WORCA_RUN_ROOT: 'legacy' });
  closeDbForTests();
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;

  const wc = makeWorld(root); commitOnFeat(wc, 'f.txt', 'feature\n'); teammatePush(wc, 'f.txt', 'upstream\n');
  conflict = await seedRun(wc);
  const wl = makeWorld(root); commitOnFeat(wl, 'f.txt', 'feature\n'); g(wl.a, 'push', '-q', 'origin', 'feat'); teammatePush(wl, 'g.txt', 'u\n');
  clean = await seedRun(wl, { published: { remote: 'origin', sha: g(wl.a, 'rev-parse', 'feat'), at: 'x' } });
  upToDate = await seedRun(makeWorld(root));
  running = await seedRun(makeWorld(root), {}, { status: 'running' });

  const wa = makeWorld(root); commitOnFeat(wa, 'g.txt', 'feature\n'); teammatePush(wa, 'f.txt', 'u\n');   // clean
  const wb = makeWorld(root); commitOnFeat(wb, 'f.txt', 'feature\n'); teammatePush(wb, 'f.txt', 'u\n');   // conflicts
  const projects = [
    { projectKey: 'mem-a-00000001', projectDir: wa.a, projectName: 'api' },
    { projectKey: 'mem-b-00000002', projectDir: wb.a, projectName: 'web' },
  ];
  wsKeys = projects.map((p) => p.projectKey);
  const branches = Object.fromEntries(wsKeys.map((k) => [k, { source: 'dev', feature: 'feat', branchKept: true }]));
  ({ id: wsId } = await seedWorkspacePipeline(wa.a, 'wks-bcapi-00000001', { title: 'WS', status: 'done', projects,
    projectKeys: wsKeys, branches, branch: { ...branches[wsKeys[0]] } }, projects));
  wsWorlds = [wa, wb];
});

after(async () => {
  await stopAndSettle(mod.runs);
  if (srv) await new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); });
  closeDbForTests();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
});

test('POST base-check records and answers each member; the project checkout is untouched', async () => {
  const r = await post('base-check', conflict.id, { projectKey: conflict.key });
  assert.equal(r.status, 200);
  assert.equal(r.json.members[0].baseCheck.status, 'conflicts');
  assert.deepEqual(r.json.members[0].baseCheck.files, ['f.txt']);
  assert.equal(r.json.members[0].tree, undefined, 'no tree id leaves the server');
  assert.equal(g(conflict.w.a, 'status', '--porcelain'), '');
  assert.equal(brOf(conflict.id).baseCheck.status, 'conflicts');
});

test('POST base-check on a running run is 409 NOT_FINISHED; unknown run 404', async () => {
  let r = await post('base-check', running.id, { projectKey: running.key });
  assert.equal(r.status, 409); assert.equal(r.json.code, 'NOT_FINISHED');
  r = await post('base-check', 'nope0000', { projectKey: running.key });
  assert.equal(r.status, 404);
});

test('POST update-branch: clean -> merge commit (two parents), pushed without --force; conflicts -> 409 CONFLICTS', async () => {
  let r = await post('update-branch', clean.id, { projectKey: clean.key });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(g(clean.w.a, 'rev-list', '--parents', '-n', '1', 'feat').split(' ').length, 3);
  assert.equal(r.json.push.pushed, true);
  assert.equal(g(clean.w.a, 'rev-parse', 'origin/feat'), r.json.to);
  r = await post('update-branch', conflict.id, { projectKey: conflict.key });
  assert.equal(r.status, 409); assert.equal(r.json.code, 'CONFLICTS');
  assert.equal(r.json.baseCheck.status, 'conflicts', 'the refusal carries the fresh check');
  r = await post('update-branch', upToDate.id, { projectKey: upToDate.key });
  assert.equal(r.status, 409); assert.equal(r.json.code, 'UP_TO_DATE');
});

test('workspace: update-branch without member is 400 MEMBER_REQUIRED; with member it merges only that repo', async () => {
  const [ka, kb] = wsKeys; const [wa, wb] = wsWorlds;
  const q = { workspaceId: 'wks-bcapi-00000001' };
  let r = await post('update-branch', wsId, q);
  assert.equal(r.status, 400); assert.equal(r.json.code, 'MEMBER_REQUIRED');
  const featB = g(wb.a, 'rev-parse', 'feat');
  r = await post('update-branch', wsId, q, { member: ka });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.member, ka);
  assert.equal(g(wa.a, 'rev-list', '--parents', '-n', '1', 'feat').split(' ').length, 3);
  assert.equal(g(wb.a, 'rev-parse', 'feat'), featB, 'the other member is untouched');
  r = await post('base-check', wsId, q);
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.json.members.map((m) => [m.projectKey, m.baseCheck.status]));
  assert.deepEqual(by, { [ka]: 'up-to-date', [kb]: 'conflicts' });
  const wm = JSON.parse(findPipelineRowById(wsId).workspace_meta);
  assert.equal(wm.branches[kb].baseCheck.status, 'conflicts');
});

test('D18: a member marked by a live resolve run refuses update/resolve with 409 RESOLVING', async () => {
  // Deterministic: a fake live entry instead of racing a mock run's end.
  mod.runs.set('R-live', { settled: false, kind: 'test' });
  updateBranchRecords(conflict.id, [conflict.key], (br) => { br.baseResolve = { via: 'pipeline', runId: 'R-live', at: 'x', files: ['f.txt'], fileCount: 1 }; });
  try {
    for (const path of ['update-branch', 'resolve-pipeline']) {
      const r = await post(path, conflict.id, { projectKey: conflict.key });
      assert.equal(r.status, 409, path); assert.equal(r.json.code, 'RESOLVING');
    }
    const r = await post('base-check', conflict.id, { projectKey: conflict.key });   // records, does not settle
    assert.equal(r.status, 200);
    assert.equal(brOf(conflict.id).baseResolve.runId, 'R-live');
  } finally {
    mod.runs.delete('R-live');
    updateBranchRecords(conflict.id, [conflict.key], (br) => { delete br.baseResolve; });
  }
});

test('resolve-pipeline refuses a clean branch, a checked-out branch and a name sanitizeBranchName would change', async () => {
  const wl = makeWorld(root); commitOnFeat(wl, 'f.txt', 'feature\n'); teammatePush(wl, 'g.txt', 'u\n');
  const cl = await seedRun(wl);
  let r = await post('resolve-pipeline', cl.id, { projectKey: cl.key });
  assert.equal(r.status, 409); assert.equal(r.json.code, 'NOT_CONFLICTING');

  const wc = makeWorld(root); commitOnFeat(wc, 'f.txt', 'feature\n'); teammatePush(wc, 'f.txt', 'u\n');
  g(wc.a, 'worktree', 'add', '-q', join(wc.dir, 'co'), 'feat');
  const co = await seedRun(wc);
  r = await post('resolve-pipeline', co.id, { projectKey: co.key });
  assert.equal(r.status, 409); assert.equal(r.json.code, 'BRANCH_CHECKED_OUT');
  assert.equal(brOf(co.id).baseResolve, undefined);

  const wu = makeWorld(root, { feature: 'Feat_Upper' }); commitOnFeat(wu, 'f.txt', 'feature\n'); teammatePush(wu, 'f.txt', 'u\n');
  const un = await seedRun(wu, { feature: 'Feat_Upper' });
  r = await post('resolve-pipeline', un.id, { projectKey: un.key });
  assert.equal(r.status, 409); assert.equal(r.json.code, 'UNSUPPORTED_BRANCH');
});

test('resolve-pipeline: a start refusal removes the mark it wrote', async () => {
  const wc = makeWorld(root); commitOnFeat(wc, 'f.txt', 'feature\n'); teammatePush(wc, 'f.txt', 'u\n');
  const s = await seedRun(wc);
  // An unknown guardrails set on the original run: startRunHandler refuses the start.
  getDb().prepare('UPDATE pipelines SET guardrails_id = ? WHERE id = ?').run('gr-does-not-exist', s.id);
  const r = await post('resolve-pipeline', s.id, { projectKey: s.key });
  assert.notEqual(r.status, 200, JSON.stringify(r.json));
  assert.equal(brOf(s.id).baseResolve, undefined);
});

test('simultaneous resolve-pipeline requests start exactly one run', async () => {
  const wc = makeWorld(root); commitOnFeat(wc, 'f.txt', 'feature\n'); teammatePush(wc, 'f.txt', 'u\n');
  const s = await seedRun(wc);
  const beforeIds = new Set(mod.runs.keys());

  const replies = await Promise.all([
    post('resolve-pipeline', s.id, { projectKey: s.key }),
    post('resolve-pipeline', s.id, { projectKey: s.key }),
  ]);

  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
  const loser = replies.find((r) => r.status === 409);
  const winner = replies.find((r) => r.status === 200);
  assert.equal(loser.json.code, 'RESOLVING');
  const added = [...mod.runs.entries()].filter(([runId]) => !beforeIds.has(runId));
  assert.equal(added.length, 1);
  assert.equal(added[0][0], winner.json.runId);
  assert.equal(brOf(s.id).baseResolve.runId, winner.json.runId);
  await stopAndSettle(mod.runs, (e) => e === added[0][1]);
  updateBranchRecords(s.id, [s.key], (br) => { delete br.baseResolve; });
});

test('POST resolve-pipeline starts a mock run on the existing branch and marks the original', async () => {
  const r = await post('resolve-pipeline', conflict.id, { projectKey: conflict.key });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const { runId } = r.json;
  assert.ok(runId);
  const br = brOf(conflict.id);
  assert.equal(br.baseResolve.via, 'pipeline'); assert.equal(br.baseResolve.runId, runId);
  assert.deepEqual(br.baseResolve.files, ['f.txt']);
  const entry = mod.runs.get(runId);
  assert.ok(entry, 'the live entry exists');
  assert.equal(entry.orch.opts.branch.feature, 'feat');
  assert.deepEqual(entry.orch.opts.branch.resolves, { runId: conflict.id, member: conflict.key });
  assert.equal(entry.orch.workflowId, 'wf_default');
  assert.match(String(entry.orch.opts.prompt), /f\.txt/);
  // The mock planner stops at a clarify question, so the run never ends by itself: wait for its setup.
  const ownBranch = () => { const id = entry.orch.state.id; const row = id && findPipelineRowById(id); return row?.branch ? JSON.parse(row.branch) : null; };
  for (let i = 0; i < 200 && !ownBranch()?.worktreeDir; i++) await new Promise((res) => setTimeout(res, 50));
  const own = ownBranch();
  assert.equal(own.feature, 'feat');
  assert.equal(own.reusedExisting, true);
  assert.deepEqual(own.resolves, { runId: conflict.id, member: conflict.key });
  await stopAndSettle(mod.runs, (e) => e === entry);
  // Stopped, the resolve run's post-run step copied its check onto the original: still conflicting, mark kept.
  const after = brOf(conflict.id);
  assert.equal(after.baseCheck.status, 'conflicts');
  assert.equal(after.baseCheck.via.runId, entry.orch.state.id);
  assert.equal(after.baseResolve.runId, runId);
  updateBranchRecords(conflict.id, [conflict.key], (b) => { delete b.baseResolve; });
});
