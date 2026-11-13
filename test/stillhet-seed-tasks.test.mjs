// test/stillhet-seed-tasks.test.mjs — tools/stillhet-seed-tasks.mjs seeds one REAL record per task state the Tasks walk acts
// on (D18): a run that failed for real (WORCA_MOCK_FAIL_STEP) and one paused at its cap for real (WORCA_MOCK_STEP_COST_USD),
// a run at its plan, a stopped run with a saved plan and kept branch, and two open PRs on a stub `gh` that answers merge,
// re-run and checks, and refuses a merge under STUB_GH_REFUSE=merge. It needs the in-process server and real mock runs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let srv, base, mod, seeded, proj, gh;
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_MOCK: process.env.WORCA_MOCK, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK, PATH: process.env.PATH };

before(async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-seed-tasks-test-'));
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  const seed = await import('../tools/stillhet-seed-tasks.mjs');
  gh = await seed.installStubGh(join(home, 'bin'));
  proj = await mkdtemp(join(tmpdir(), 'worca-seed-tasks-proj-'));
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 't@worca.local'], ['config', 'user.name', 't']]) execFileSync('git', a, { cwd: proj });
  await writeFile(join(proj, 'README.md'), '# t\n');
  execFileSync('git', ['add', '-A'], { cwd: proj });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  seeded = await seed.seedTasks({ base, runs: mod.runs, projectDir: proj });
});
after(async () => {
  for (const id of Object.values(seeded?.runs || {})) await fetch(`${base}/api/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: id }) }).catch(() => {});
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  for (const [k, v] of Object.entries({ HOME: saved.HOME, USERPROFILE: saved.USERPROFILE, WORCA_MOCK: saved.WORCA_MOCK, WORCA_TEST_ALLOW_HOME_FALLBACK: saved.ALLOW, PATH: saved.PATH })) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
const row = async (id) => (await import('../src/core/db.mjs')).getDb().prepare('SELECT status, resume_point, total_cost_usd, pr_url, pr_state FROM pipelines WHERE id = ?').get(id);

test('the failed run failed for real and dev paused it on the step; the capped run is paused at its cap', async () => {
  const f = await row(seeded.pipelines.failed);
  assert.ok(['paused', 'error'].includes(f.status), f.status);
  const c = await row(seeded.pipelines.capped);
  assert.equal(c.status, 'paused');
  assert.match(JSON.parse(c.resume_point || '{}').pauseReason || '', /cost/);
  assert.ok(c.total_cost_usd >= 0.4, `real spend ${c.total_cost_usd}`);
});

test('the plan run waits at its plan; the stopped run has its plan and branch; the two PRs are open', async () => {
  assert.equal(mod.runs.get(seeded.runs.plan).pendingQuestion?.kind, 'plan');
  assert.equal((await row(seeded.pipelines.stopped)).status, 'stopped');
  assert.ok(execFileSync('git', ['branch', '--list', `worca/${seeded.pipelines.stopped}`], { cwd: proj, encoding: 'utf8' }).trim());
  for (const k of ['approved', 'failing']) assert.equal((await row(seeded.pipelines[k])).pr_state, 'OPEN');
});

test('the stub gh answers merge, re-run and checks, and refuses a merge under STUB_GH_REFUSE=merge', async () => {
  const { PR_APPROVED, PR_FAILING } = await import('../tools/stillhet-seed-tasks.mjs');
  const run = (args, env = {}) => { try { return { ok: true, out: execFileSync(gh, args, { encoding: 'utf8', env: { ...process.env, ...env } }) }; } catch (e) { return { ok: false, err: String(e.stderr) }; } };
  assert.equal(run(['pr', 'merge', PR_APPROVED, '--squash']).ok, true);
  assert.equal(run(['run', 'rerun', '77', '--failed']).ok, true);
  assert.equal(JSON.parse(run(['pr', 'view', PR_APPROVED, '--json', 'x']).out).latestReviews[0].author.login, 'maya');
  assert.equal(JSON.parse(run(['pr', 'view', PR_FAILING, '--json', 'x']).out).statusCheckRollup[0].conclusion, 'FAILURE');
  const refused = run(['pr', 'merge', PR_APPROVED, '--squash'], { STUB_GH_REFUSE: 'merge' });
  assert.equal(refused.ok, false);
  assert.match(refused.err, /not mergeable/);
  // STUB_GH_LOG records each call, so a walk reads back what reached the host (code review r9, R-qa-11)
  const logFile = join(await mkdtemp(join(tmpdir(), 'worca-stub-gh-log-')), 'gh-calls.log');
  run(['run', 'rerun', '77', '--failed'], { STUB_GH_LOG: logFile });
  run(['pr', 'merge', PR_APPROVED, '--squash'], { STUB_GH_LOG: logFile });
  assert.deepEqual(readFileSync(logFile, 'utf8').trim().split('\n'), ['run rerun 77 --failed', `pr merge ${PR_APPROVED} --squash`]);
  // a merged PR stays merged afterwards, as its host answers it (with STUB_GH_HEADS set, as the seed sets it)
  const heads = join(await mkdtemp(join(tmpdir(), 'worca-stub-gh-heads-')), 'heads.json');
  await writeFile(heads, '{}');
  const view = (url) => JSON.parse(run(['pr', 'view', url, '--json', 'x'], { STUB_GH_HEADS: heads }).out).state;
  assert.equal(view(PR_APPROVED), 'OPEN');
  run(['pr', 'merge', PR_APPROVED, '--squash'], { STUB_GH_HEADS: heads });
  assert.deepEqual([view(PR_APPROVED), view(PR_FAILING)], ['MERGED', 'OPEN']);
});

test('the seeded failing PR can be fixed: its branch is on a real origin at the PR\'s head, so Fix checks starts a round (web-UI review cycle 1)', async () => {
  const r = await fetch(`${base}/api/pr/fix-checks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: seeded.pipelines.failing, projectKey: seeded.project }) });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.match(String(body.status), /^(starting|fixing)$/, 'a fix round is on its way (never NOT_STARTED)');
});
