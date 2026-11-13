// test/restart-build-api.test.mjs — POST /api/runs/:id/restart-build (Stillhet's Restart Build on a stopped or errored
// task): one wf_pr_fix run on the kept branch with the saved plan as its brief, folded under its origin as a
// `by: 'restart'` round, keeping the origin's raised cap. Each refusal starts nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { addProject } from '../src/core/projects.mjs';
import { recordArtifact } from '../src/core/artifacts.mjs';
import { projectStorePath } from '../src/core/store.mjs';
import { setRunCostCap } from '../src/core/cost-budget.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { gitDir } from './helpers/git-dir.mjs';

let home, prevHome, sandboxHome, prevUserHome, srv, base, app, runs, repo;
const PLAN = '# Plan\n\nAdd the pager to the audit log.\n';

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-restart-'));
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-restart-home-'));
  prevHome = process.env.WORCA_HOME; prevUserHome = process.env.HOME;
  process.env.WORCA_HOME = home; process.env.HOME = sandboxHome;
  _resetForTests();
  repo = gitDir('restart');
  execSync('git branch -M main && git branch worca-cc/pager', { cwd: repo });
  await addProject({ name: 'restart-repo', path: repo });
  ({ app, runs } = await import('../ui/server.mjs'));
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  for (const e of runs.values()) { try { e.orch?.stop?.('test'); } catch { /* settled */ } }
  await new Promise((r) => setTimeout(r, 300));
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  process.env.HOME = prevUserHome;
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(sandboxHome, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const post = (path, body = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function seedTask({ status = 'stopped', plan = true, feature = 'worca-cc/pager' } = {}) {
  const s = await seedPipeline(repo, { title: 'Audit pager', status, branch: { source: 'main', feature, branchKept: true },
    resumePoint: { version: 2, kind: 'boundary', mock: true } });
  if (plan) {
    const rel = `plans/2026-11-13-${s.id}.md`;
    mkdirSync(join(projectStorePath(s.key), 'plans'), { recursive: true });
    writeFileSync(join(projectStorePath(s.key), rel), PLAN);
    recordArtifact(s.id, 'plan', rel);
  }
  return s;
}
const started = () => runs.size;

test('a stopped and an errored task each start one wf_pr_fix round on the kept branch, with the plan as its brief and the origin\'s cap', async () => {
  for (const status of ['stopped', 'error']) {
    const s = await seedTask({ status });
    setRunCostCap(s.id, 9);
    const r = await post(`/api/runs/${s.id}/restart-build`);
    const out = await r.json();
    assert.equal(r.status, 200, JSON.stringify(out));
    const entry = runs.get(out.runId);
    assert.ok(entry, 'a live run');
    const o = entry.orch.opts;
    assert.equal(o.workflowId, 'wf_pr_fix');
    assert.match(o.prompt, /Add the pager to the audit log\./);
    assert.match(o.prompt, /kept branch `worca-cc\/pager`/);
    assert.deepEqual([o.branch.source, o.branch.feature], ['main', 'worca-cc/pager']);
    assert.deepEqual(o.branch.roundOf, { pipelineId: s.id, round: 2, request: 'restart Build', by: 'restart' });
    assert.equal(entry.orch.runCostCapUsd, 9);
    for (let i = 0; i < 200 && !entry.pipelineId; i++) await new Promise((res) => setTimeout(res, 25));
    assert.ok(entry.pipelineId, 'the round has its own pipeline row');
    assert.equal(getDb().prepare('SELECT cost_cap_usd FROM pipelines WHERE id = ?').get(entry.pipelineId).cost_cap_usd, 9, 'the cap is on the new row');
    const branchRow = () => getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(entry.pipelineId)?.branch;
    for (let i = 0; i < 400 && !branchRow(); i++) await new Promise((res) => setTimeout(res, 25));
    try { entry.orch.stop('test'); } catch { /* already settled */ }
    for (let i = 0; i < 200 && !runs.get(out.runId)?.settled; i++) await new Promise((res) => setTimeout(res, 50));
    // The round folds under its origin and reads as a restart.
    const { roundsOf } = await import('../src/core/shape/rounds.mjs');
    const folded = roundsOf([s.id]).get(s.id) || [];
    assert.deepEqual(folded.map((x) => [x.round, x.request, x.by]), [[2, 'restart Build', 'restart']]);
  }
});

test('refusals start nothing: unknown, archived, NOT_STOPPED, NO_PLAN, NO_BRANCH, and the total budget 403', async () => {
  const n = started();
  let r = await post('/api/runs/nope-00000000/restart-build');
  assert.equal(r.status, 404);
  const archived = await seedTask();
  getDb().prepare('UPDATE pipelines SET archived_at = ? WHERE id = ?').run('2026-11-13T00:00:00Z', archived.id);
  assert.equal((await post(`/api/runs/${archived.id}/restart-build`)).status, 404);
  for (const [task, code] of [
    [await seedTask({ status: 'paused' }), 'NOT_STOPPED'],
    [await seedTask({ status: 'done' }), 'NOT_STOPPED'],
    [await seedTask({ plan: false }), 'NO_PLAN'],
    [await seedTask({ feature: 'worca-cc/gone' }), 'NO_BRANCH'],
  ]) {
    r = await post(`/api/runs/${task.id}/restart-build`);
    const out = await r.json();
    assert.deepEqual([r.status, out.code], [409, code], JSON.stringify(out));
  }
  // The paused seed holds the branch (a paused run keeps its checkout), so it would refuse every later restart BUSY.
  getDb().prepare("UPDATE pipelines SET archived_at = ? WHERE status = 'paused'").run('2026-11-13T00:00:00Z');
  const nb = await seedTask({ plan: false });
  assert.equal((await (await post(`/api/runs/${nb.id}/restart-build`)).json()).error, 'This task has no saved plan to build from.');

  const { recordCostDelta } = await import('../src/core/cost-budget.mjs');
  const settings = (body) => fetch(`${base}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try {
    await settings({ totalCostLimitUsd: 1 });
    recordCostDelta({ pipelineId: 'y', amountUsd: 2, tsMs: Date.now() });
    const t = await seedTask();
    r = await post(`/api/runs/${t.id}/restart-build`);
    assert.deepEqual([r.status, (await r.json()).error], [403, 'total cost limit reached']);
  } finally {
    await settings({ totalCostLimitUsd: '' });
    getDb().exec('DELETE FROM cost_ledger');
    delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
  }
  assert.equal(started(), n, 'no run started');
});

test('a double press starts one round; a run live on the branch refuses BUSY; a workspace task refuses WORKSPACE', async () => {
  const s = await seedTask();
  const n = started();
  const [a, b] = await Promise.all([post(`/api/runs/${s.id}/restart-build`), post(`/api/runs/${s.id}/restart-build`)]);
  const outs = [await a.json(), await b.json()];
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409], JSON.stringify(outs));
  assert.equal(outs.find((o) => o.code)?.code, 'RESTART_BUSY', JSON.stringify(outs));
  assert.equal(started(), n + 1, 'one run started');
  const runId = outs.find((o) => o.runId).runId;
  // While that round is live, a third press is refused: it holds the branch.
  const again = await post(`/api/runs/${s.id}/restart-build`);
  assert.deepEqual([again.status, (await again.json()).code], [409, 'BUSY']);
  assert.equal(started(), n + 1, 'no second run');
  const entry = runs.get(runId);
  try { entry.orch.stop('test'); } catch { /* already settled */ }
  for (let i = 0; i < 200 && !runs.get(runId)?.settled; i++) await new Promise((res) => setTimeout(res, 50));

  const ws = await seedTask();
  getDb().prepare("UPDATE pipelines SET target = 'workspace' WHERE id = ?").run(ws.id);
  const r = await post(`/api/runs/${ws.id}/restart-build`);
  const out = await r.json();
  assert.deepEqual([r.status, out.code, out.error], [409, 'WORKSPACE', 'Restart Build is not offered for a workspace task yet.']);
});

test('a run still finishing on the branch (done, pushing or opening its PR) refuses BUSY, as the PR watcher\'s branch rule does', async () => {
  const holder = await seedTask({ status: 'done', plan: false });
  const fake = 'finishing-' + holder.id;
  runs.set(fake, { orch: {}, status: 'done', settled: false, pipelineId: holder.id, projectDir: repo });
  try {
    const s = await seedTask();
    const n = started();
    const r = await post(`/api/runs/${s.id}/restart-build`);
    assert.deepEqual([r.status, (await r.json()).code], [409, 'BUSY']);
    assert.equal(started(), n, 'no run started');
  } finally { runs.delete(fake); }
});
