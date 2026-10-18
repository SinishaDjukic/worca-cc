// test/resume-base-check.test.mjs — the opt-in resume base check inside resumeRun (#527, plan
// §5.5, D7): 409 base-moved / base-missing only for callers that send baseCheck, measured from
// the recorded remote tip, never for defrag runs, and a cancellable check defers the cost-cap
// override write. Real bare origin; HOME sandboxed before the server import.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';

const home = useTempHome(after, 'worca-cc-resume-base-');
const saved = {};
for (const k of ['HOME', 'USERPROFILE', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) saved[k] = process.env[k];
process.env.HOME = home; process.env.USERPROFILE = home;

let srv, base, root, runs, addProject, gitSync, seedPipeline, readCostCapOverride, getDb;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'resume-base-'));
  process.env.GIT_CONFIG_GLOBAL = join(root, 'gitconfig'); process.env.GIT_CONFIG_NOSYSTEM = '1';
  await writeFile(process.env.GIT_CONFIG_GLOBAL, '[user]\n\tname = t\n\temail = t@t\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = dev\n');
  let app;
  ({ app, runs } = await import('../ui/server.mjs'));
  ({ addProject } = await import('../src/core/projects.mjs'));
  ({ _testing: gitSync } = await import('../src/core/git-sync.mjs'));
  ({ seedPipeline } = await import('./helpers/db-seed.mjs'));
  ({ readCostCapOverride } = await import('../src/core/cost-budget.mjs'));
  ({ getDb } = await import('../src/core/db.mjs'));
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  runs.clear();
  gitSync.reset();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true });
});
beforeEach(() => gitSync.reset());

const g = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
let n = 0;
async function world() {
  const dir = join(root, `w${++n}`);
  g(root, 'init', '-q', '--bare', `${dir}-origin.git`);
  g(root, 'clone', '-q', `${dir}-origin.git`, `${dir}-a`);
  await writeFile(join(`${dir}-a`, 'f.txt'), 'one\n');
  g(`${dir}-a`, 'add', '-A'); g(`${dir}-a`, 'commit', '-qm', 'init'); g(`${dir}-a`, 'push', '-q', 'origin', 'dev');
  g(root, 'clone', '-q', `${dir}-origin.git`, `${dir}-b`);
  let k = 0;
  const push = async (count = 1) => {
    const b = `${dir}-b`;
    g(b, 'pull', '-q', 'origin', 'dev');
    for (let i = 0; i < count; i++) { await writeFile(join(b, `t${++k}.txt`), `${k}\n`); g(b, 'add', '-A'); g(b, 'commit', '-qm', `t${k}`); }
    g(b, 'push', '-q', 'origin', 'dev');
  };
  await addProject({ name: `p${n}`, path: `${dir}-a` });
  return { a: `${dir}-a`, push, sha: (ref) => g(`${dir}-a`, 'rev-parse', ref) };
}
/** A paused, resumable pipeline of `dir` whose branch record is `branch`. */
const paused = (dir, branch, extra = {}) => seedPipeline(dir, { status: 'paused', branch,
  resumePoint: { version: 2, kind: 'boundary', ...(extra.resumePoint || {}) }, ...(extra.state || {}) });
const resume = (body) => fetch(`${base}/api/resume`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const countFetches = () => {
  const seen = [];
  gitSync.setRunner((args, opts) => { if (args[0] === 'fetch') seen.push(args); return gitSync.defaultRun(args, opts); });
  return seen;
};
const ageFetchHead = async (dir) => { const t = (Date.now() - 3_600_000) / 1000; await utimes(join(dir, '.git', 'FETCH_HEAD'), t, t); };

test('base-moved: 409 with baseCheck, not with baseAck, and nothing without baseCheck', async () => {
  const w = await world();
  const start = w.sha('dev');
  const { id } = await paused(w.a, { source: 'dev', feature: 'worca/f1', baseSha: start, sync: { remote: 'origin', remoteSha: start } });
  await w.push(1);
  let r = await resume({ pipelineId: id, baseCheck: true });
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.code, 'base-moved');
  assert.equal(j.members[0].movedBy, 1);
  assert.match(j.error, /dev moved 1 commit\(s\) on origin/);
  r = await resume({ pipelineId: id, baseCheck: true, baseAck: true });
  assert.notEqual(r.status, 409, 'acknowledged: the resume goes on');
  runs.clear();
  const seen = countFetches();
  r = await resume({ pipelineId: id });
  assert.notEqual(r.status, 409, 'callers that do not opt in are unaffected');
  assert.equal(seen.length, 0, 'and nothing is fetched for them');
  runs.clear();
});

test('base-missing: a source that resolves nowhere; a tag source is never "missing"', async () => {
  const w = await world();
  const start = w.sha('dev');
  const { id } = await paused(w.a, { source: 'gone-branch', feature: 'worca/f2', baseSha: start });
  const r = await resume({ pipelineId: id, baseCheck: true });
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.code, 'base-missing');
  assert.match(j.error, /gone-branch no longer exists/);

  g(w.a, 'tag', 'v1.0');
  const t = await paused(w.a, { source: 'v1.0', feature: 'worca/f3', baseSha: start });
  const r2 = await resume({ pipelineId: t.id, baseCheck: true });
  assert.notEqual(r2.status, 409);
  runs.clear();
});

test('measured from the recorded remote tip: 2 behind at start + 1 new upstream = movedBy 1', async () => {
  const w = await world();
  const localAtStart = w.sha('dev');
  await w.push(2);
  g(w.a, 'fetch', '-q', 'origin');
  const remoteAtStart = w.sha('origin/dev');
  const { id } = await paused(w.a, { source: 'dev', feature: 'worca/f4', baseSha: localAtStart, sync: { remote: 'origin', remoteSha: remoteAtStart, result: 'disabled' } });
  await w.push(1);
  await ageFetchHead(w.a);                     // past the 45 s TTL: the check fetches
  const r = await resume({ pipelineId: id, baseCheck: true });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).members[0].movedBy, 1);
});

test('a remote-tracking source (origin/dev, as the Ask agent starts runs) is measured as dev on origin', async () => {
  const w = await world();
  const start = w.sha('dev');
  const { id } = await paused(w.a, { source: 'origin/dev', feature: 'worca/f5', baseSha: start });
  await w.push(2);
  const r = await resume({ pipelineId: id, baseCheck: true });
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.code, 'base-moved');
  assert.deepEqual([j.members[0].base, j.members[0].movedBy], ['dev', 2]);
  runs.clear();
});

test('a memory-defrag run with baseCheck: no fetch, no 409', async () => {
  const w = await world();
  const start = w.sha('dev');
  const { id } = await paused(w.a, { source: 'dev', feature: 'worca/f5', baseSha: start },
    { resumePoint: { memoryScope: 'global' } });
  await w.push(1);
  const seen = countFetches();
  const r = await resume({ pipelineId: id, baseCheck: true });
  assert.notEqual(r.status, 409);
  assert.equal(seen.length, 0);
  runs.clear();
});

test('a cancellable base check defers the cost-cap override write until it passes', async () => {
  const w = await world();
  const start = w.sha('dev');
  await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pipelineCostLimitUsd: 1 }) });
  try {
    const { id } = await paused(w.a, { source: 'dev', feature: 'worca/f6', baseSha: start, sync: { remote: 'origin', remoteSha: start } },
      { state: { totalCostUsd: 2 }, resumePoint: { pauseReason: 'cost_pipeline' } });
    await w.push(1);
    let r = await resume({ pipelineId: id, baseCheck: true });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).needsOverride, true);

    r = await resume({ pipelineId: id, baseCheck: true, ignoreCostCap: true });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, 'base-moved');
    assert.equal(readCostCapOverride(id), false, 'cancelling the base prompt leaves no override armed');
    const audit = () => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(id).map((x) => x.text);
    assert.ok(!audit().some((t) => /override set/.test(t)), 'and no audit line claims it');

    r = await resume({ pipelineId: id, baseCheck: true, ignoreCostCap: true, baseAck: true });
    assert.notEqual(r.status, 409);
    assert.equal(readCostCapOverride(id), true);
    assert.ok(audit().some((t) => /Pipeline cost limit override set/.test(t)));
    runs.clear();
  } finally {
    await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pipelineCostLimitUsd: '' }) });
  }
});

test('a resume that goes live while the base check fetches: the second resume is refused as already live', async () => {
  const w = await world();
  const start = w.sha('dev');
  const { id } = await paused(w.a, { source: 'dev', feature: 'worca/f7', baseSha: start, sync: { remote: 'origin', remoteSha: start } });
  gitSync.setRunner((args, opts) => {
    // Another Resume wins the race while this one waits on its fetch.
    if (args[0] === 'fetch') runs.set('racer', { id: 'racer', pipelineId: id, status: 'running', events: [] });
    return gitSync.defaultRun(args, opts);
  });
  try {
    const r = await resume({ pipelineId: id, baseCheck: true });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /already live/);
  } finally { runs.clear(); }
});
