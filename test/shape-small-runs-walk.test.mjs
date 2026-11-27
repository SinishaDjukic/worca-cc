// test/shape-small-runs-walk.test.mjs — Shaper small runs D4: the whole flow with the flag on, on the prototype's example
// feature "Email for website X", from Start to Ship.
// Phase A runs the real orchestrator (mock engine) through Start (Care), Requirements, Prototype (build, confirm) and the
// Split: the planning run finishes as run 1. Phase B goes on with that feature: the build runs 2–5 are seeded as finished
// pipeline rows on real branches (as every Ship test's world does), run 3 stops live on a requirement stop and its
// "Change it" goes through the real applyStop, both Verifier rounds run as real wf_shape_verify orchestrator runs and
// settle through verifyAfterSettled, and the marks and Ship go through the server's routes. Only git and gh are stubbed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { withEnv } from './helpers/with-env.mjs';
import { NO_ADO, REMOTES_V, okRun, failRun, argOf, ghCalls, git } from './helpers/ship-world.mjs';

useTempHome(after, 'worca-shape-walk-');
// HOME is sandboxed before any src/core import (settings live under HOME), as the orchestrator Shaper tests do.
const ENV = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_FLAGS', 'WORCA_MOCK', 'WORCA_MOCK_VERIFY', 'WORCA_MOCK_SPLIT_OUTLINE'];
const prevEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const sandboxHome = mkdtempSync(join(tmpdir(), 'worca-shape-walk-home-'));
Object.assign(process.env, { HOME: sandboxHome, USERPROFILE: sandboxHome, WORCA_TEST_ALLOW_HOME_FALLBACK: '1', WORCA_MOCK: '1',
  WORCA_FLAGS: 'shaperSmallRuns,design' });

const { server: srv } = await import('../ui/server.mjs');
const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
const { resolveShapeRequest } = await import('../src/core/shape/run.mjs');
const { createDesignBuilds } = await import('../src/core/design/registry.mjs');
const { snapshotVersion } = await import('../src/core/design/versions.mjs');
const { getDb } = await import('../src/core/db.mjs');
const { projectKey } = await import('../src/core/store.mjs');
const { getTicket, markTicketFired, previousBranchesOf } = await import('../src/core/scheduler.mjs');
const { featureView, featureOfPipeline, liveSliceFrom, featureFigures } = await import('../src/core/shape/features.mjs');
const { careOfFeature, careOfPipeline } = await import('../src/core/shape/small-runs.mjs');
const { createRequirementChanges } = await import('../src/core/shape/changes.mjs');
const { createHeldStops } = await import('../src/core/shape/held-stops.mjs');
const { verifyAfterSettled } = await import('../src/core/shape/verifier.mjs');
const { planStop } = await import('../src/shared/shape/run-stops.mjs');
const { VERIFY_WORDS } = await import('../src/shared/shape/verifier.mjs');
const { careOutcome, unmetLines } = await import('../src/shared/shape/ship-ledger.mjs');
const { oneCardModel } = await import('../ui/public/shape/feature-card.mjs');
const { _testing: gitInfo } = await import('../src/core/git-info.mjs');

await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
after(async () => {
  await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { setTimeout(r, 500).unref?.(); })]);
  gitInfo.reset();
  for (const k of ENV) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  rmSync(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
const ship = (fid) => post(`/api/shape/features/${fid}/ship`, { mode: 'stacked' });
const confirm = (fid, body) => post(`/api/shape/features/${fid}/confirm`, body);
const iso = (ms) => new Date(ms).toISOString();
const ghOnly = (seen) => seen.filter((a) => a[0] === 'gh');
const careLines = (body) => String(body).match(/^Care: .*$/gm) || [];

// The prototype's example feature: its title, its requirement ids and texts. R-comp-4 (the signed agreement) is the one a
// person confirms; every other id is owned by a run (Decision 3).
const TITLE = 'Email for website X';
const AGREED = [
  ['R-po-1', 'A reset email arrives within a minute', 'a reset asked at 10:00 is in the inbox by 10:01'],
  ['R-arch-1', 'One service sends every email through a queue', 'sign-up puts one job on the queue'],
  ['R-po-2', 'Sign-up sends one confirmation email', 'a new account gets exactly one email'],
  ['R-arch-2', 'A failed send retries 3 times, then is recorded', 'the provider fails four times: 3 retries, then one record'],
  ['R-ops-1', 'The sending domain passes SPF, DKIM and DMARC', 'a test email to a mail checker passes all three'],
  ['R-ops-2', 'Bounces and failures raise an alert', 'bounces over 2% in an hour raise one alert'],
  ['R-comp-4', 'Signed data processing agreement with the email provider', 'the signed agreement is on file'],
].map(([id, text, example]) => ({ id, text, example }));
const RUN_OWNS = [['R-po-1', 'R-arch-1'], ['R-po-2', 'R-arch-2'], ['R-ops-1', 'R-ops-2']];
const NEW_ARCH_2 = 'reset emails retry once, within 20 seconds';
const REASON = 'Legal has not signed the agreement yet';

/** The forge stub: every argv recorded; `gh pr create` mints PR N and keeps its body; `gh pr edit` replaces it and is
 *  kept in `edited`; `gh pr view … body` answers it. */
function forge(seen) {
  let n = 0;
  const bodies = new Map();
  const edited = new Map();
  gitInfo.setRunner((cmd, args) => {
    seen.push([cmd, ...args]);
    if (cmd === 'gh' && args[0] === '--version') return okRun('gh 2.x');
    if (cmd === 'git' && args[0] === 'remote') return okRun(REMOTES_V);
    if (cmd === 'git' && args[0] === 'describe') return failRun('fatal: No names found');
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') {
      const url = `https://github.com/me/repo/pull/${++n}`;
      bodies.set(url, argOf(args, '--body'));
      return okRun(`${url}\n`);
    }
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'edit') { edited.set(args[2], argOf(args, '--body')); return okRun(''); }
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view' && args.includes('body')) return okRun(`${bodies.get(args[2]) || ''}\n\nWhat changed.`);
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') return okRun('https://github.com/me/repo/pull/3\n');
    return okRun('');
  });
  return { bodies, edited };
}

/** The Split card's "Merge with next": the mock's passing small-runs outline (WORCA_MOCK_SPLIT_OUTLINE) has one run per
 *  agreed id but the last, which a person confirms; 4 merges make it 3 runs of at most 3 ids. */
const MERGES = ['s1', 's1', 's4', 's6'].map((id) => ({ op: 'merge', id }));

/** Phase A: the planning run on the real orchestrator. */
async function planningRun(dir) {
  const req = resolveShapeRequest({ shape: { size: 'large', lead: 'security' } }, { smallRuns: true });
  assert.equal(req.ok, true, req.error);
  const designBuilds = createDesignBuilds({ broadcast: () => {}, deps: { staggerMs: 0, retryDelayMs: 0, snapshotVersion } });
  const orch = createOrchestrator({ projectDir: dir, workflowId: req.workflowId, prompt: `${TITLE}: plan this in 3 slices`,
    claude: { mock: true }, shape: req.shape, designBuilds });
  const asks = [];
  orch.on('question', (q) => {
    asks.push(q);
    if (q.kind === 'care') setImmediate(() => orch.answer(q.id, { care: { position: 'balanced' } }));
    else if (q.kind === 'plan' && q.plan?.outline) setImmediate(() => orch.answer(q.id, { decision: 'approve', edits: MERGES }));
    else if (q.kind === 'plan') setImmediate(() => orch.answer(q.id, { decision: 'approve' }));
    else if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => orch.answer(q.id, { answers: [] }));
    else if (q.kind === 'prototype') setImmediate(() => orch.answer(q.id, { decision: q.prototype.moment === 'offered' ? 'build' : 'confirm' }));
  });
  return { orch, asks, res: await orch.run() };
}
const askName = (q) => (q.kind === 'prototype' ? `prototype:${q.prototype.moment}` : q.kind === 'plan' && q.plan?.criteria ? 'requirements'
  : q.kind === 'plan' && q.plan?.outline ? 'outline' : q.kind);

/** One Verifier round: a real wf_shape_verify run built from the check ticket's request, linked to the ticket, settled. */
async function verifierRound(ticketId, deps, { gaps = [] } = {}) {
  const t = getTicket(ticketId, { withRequest: true });
  assert.equal(t.request.workflowId, 'wf_shape_verify');
  const orch = createOrchestrator({ projectDir: t.request.projectDir, workflowId: t.request.workflowId, prompt: t.request.prompt,
    claude: { mock: true }, shape: t.request.shape, branch: { source: previousBranchesOf(t.after.id).sourceBranch } });   // as fireTicket does
  const asked = [];
  // Slice 8: a round with gaps asks before any run is added; this walk answers each with a fix run.
  orch.on('question', (q) => {
    asked.push(q);
    if (q.stop?.form === 'gaps') setImmediate(() => orch.answer(q.id, { decision: 'answer', answers: q.stop.gaps.map((g) => ({ id: g.id, answer: 'fix' })) }));
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(asked.map((q) => [q.stop?.form, q.stop?.gaps.map((g) => g.id)]), gaps.length ? [['gaps', gaps]] : [],
    'one gap question for a round with gaps, none for a clean one');
  const pid = orch.getState().id;
  markTicketFired(ticketId, { pipelineId: pid });
  await verifyAfterSettled({ id: pid, status: 'done', pipelineDir: orch.pipeline.dir }, deps);
  return pid;
}

test('email for website X: Start to Ship with a stop, a change and a Verifier gap', { timeout: 180_000 }, () => withEnv({ ...NO_ADO,
  WORCA_MOCK_SPLIT_OUTLINE: 'pass', WORCA_MOCK_VERIFY: JSON.stringify([['R-ops-2'], []]) }, async () => {
  const dir = gitDir('shape-walk');
  // The changelog commit Ship writes is made by Worca, not by this test: the repo itself carries the identity, so the test
  // does not depend on a global git identity (a CI runner has none).
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'branch', '-M', 'main');   // gitDir takes the host's default branch
  try {
    // ── Phase A: Start, Requirements, Prototype, the Split; the planning run finishes as run 1 ──
    const a = await planningRun(dir);
    assert.equal(a.res.status, 'done', a.res.error);
    assert.deepEqual(a.asks.map(askName), ['care', 'requirements', 'prototype:offered', 'prototype:built', 'outline', 'plan']);
    assert.equal(a.asks.at(-1).stop.reason, 'check', 'run 1 stops on the mock plan\'s failing checks and is approved as is');
    const p1 = a.orch.getState().id;
    const db = getDb();
    assert.equal(JSON.parse(db.prepare('SELECT shape_stats FROM pipelines WHERE id = ?').get(p1).shape_stats).smallRuns, true);
    const fid = featureOfPipeline(p1)?.featureId;
    assert.ok(fid, 'the Split created the feature');
    assert.equal(careOfFeature(fid).position, 'balanced');
    assert.equal(careOfPipeline(p1).position, 'balanced');
    const branch1 = JSON.parse(db.prepare('SELECT branch FROM pipelines WHERE id = ?').get(p1).branch).feature;
    assert.ok(git(dir, 'rev-parse', '--verify', branch1), 'run 1 left its branch');

    // ── Phase B, 1: the example's title and requirement ids on the feature; runs 2 and 3 fired ──
    const row = db.prepare('SELECT outline, source_branch FROM shape_features WHERE id = ?').get(fid);
    const outline = JSON.parse(row.outline);
    assert.equal(outline.slices.length, 3);
    // What the Split itself stored, before the example's ids replace it: the id the mock's outline has a person confirm.
    const splitLast = outline.agreed.at(-1).id;
    assert.deepEqual(JSON.parse(db.prepare('SELECT requirement_kinds FROM shape_features WHERE id = ?').get(fid).requirement_kinds)[splitLast],
      { kind: 'confirmed', role: 'security' });
    assert.deepEqual(featureView(fid).requirementKinds.at(-1), { id: splitLast, kind: 'confirmed', role: 'security' });
    outline.agreed = AGREED;
    outline.slices.forEach((s, i) => { s.requirements = RUN_OWNS[i]; });
    db.prepare('UPDATE shape_features SET title = ?, outline = ?, requirement_kinds = ? WHERE id = ?')
      .run(TITLE, JSON.stringify(outline), JSON.stringify({ 'R-comp-4': { kind: 'confirmed', role: 'compliance' } }), fid);
    const t1 = Date.parse(db.prepare('SELECT MAX(updated_at) AS t FROM pipeline_steps WHERE pipeline_id = ?').get(p1).t);
    assert.ok(Number.isFinite(t1), 'run 1 recorded its finish');
    let seq = 0;
    let lastBranch = branch1;
    const finish = (pid, k) => {
      db.prepare("UPDATE pipelines SET status = 'done' WHERE id = ?").run(pid);
      db.prepare("INSERT INTO pipeline_steps (pipeline_id, key, status, updated_at) VALUES (?, ?, 'done', ?)").run(pid, 'n_impl', iso(t1 + k * 1000));
    };
    /** Fire run `idx`'s ticket as a pipeline row on a real branch off the latest finished one. */
    const fire = (idx, status) => {
      const pid = `ew${String(++seq).padStart(6, '0')}`;
      const feature = `feat/${pid}`;
      git(dir, 'checkout', '-q', '-b', feature, lastBranch);
      writeFileSync(join(dir, `${pid}.txt`), `${pid}\n`); git(dir, 'add', '-A');
      git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', `run ${idx}`);
      git(dir, 'checkout', '-q', 'main');
      seedPipelineRow({ id: pid, projectKey: projectKey(dir), status, title: `${TITLE} · run ${idx}`, startedAt: iso(t1),
        branch: { source: lastBranch, feature } });
      const ticket = db.prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(fid, idx).ticket_id;
      db.prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(pid, ticket);
      db.prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = ?').run(pid, fid, idx);
      return { pid, feature };
    };
    const branches = { 1: branch1 };
    const pids = { 1: p1 };
    const r2 = fire(2, 'running'); pids[2] = r2.pid; branches[2] = r2.feature;
    finish(r2.pid, 1); lastBranch = r2.feature;

    // ── 2: run 3 is live and stops: R-arch-2 would have to change; "Change it" ──
    const r3 = fire(3, 'running'); pids[3] = r3.pid; branches[3] = r3.feature;
    const runs = new Map();
    const answers = [];
    const e3 = { id: `run-${r3.pid}`, pipelineId: r3.pid, status: 'running', pendingQuestion: null, heldStop: null,
      orch: { runShape: { slice: { feature: fid, index: 3 } }, state: { shaping: { approved: { file: 'plan.md' } } },
        stop: () => {}, answer: (id, payload, by) => { answers.push({ id, payload, by }); } } };
    runs.set(e3.id, e3);
    const live = (pid) => {
      const e = [...runs.values()].find((x) => x.pipelineId === pid);
      if (!e || ['done', 'stopped', 'error', 'interrupted'].includes(e.status)) return null;
      return liveSliceFrom({ runId: e.id, status: e.status, pendingQuestion: e.pendingQuestion, approved: true, heldStop: e.heldStop });
    };
    const reqChanges = createRequirementChanges({ runs, liveSliceOf: live,
      stopRun: (runId) => { const e = runs.get(runId); e.status = 'stopped'; e.pendingQuestion = null; return { ok: true }; },
      stopPausedPipeline: async () => {}, schedulerTick: async () => {}, broadcastFeature: () => {} });
    const held = createHeldStops({ runs, liveSliceOf: live, broadcastFeature: () => {}, resolvePending: () => true, applyChange: reqChanges.applyStop });
    const stop = planStop({ run: 3, concern: { title: 'R-arch-2 would have to change', kind: 'requirement', requirements: ['R-arch-2'],
      proposals: [{ id: 'R-arch-2', from: AGREED[3].text, text: NEW_ARCH_2 }] } });
    e3.pendingQuestion = { id: 'plan-n_refine-3', kind: 'plan', stop };
    assert.equal(featureView(fid, { live }).slices[2].stop.reason, 'requirement');
    const change = { ...stop.options.find((o) => o.value === 'change').payload };
    held.answer(e3, e3.pendingQuestion.id, change, 'ann');
    e3.pendingQuestion = null;
    const changed = featureView(fid, { live });
    assert.equal(changed.changes[0].case, 'finished', 'R-arch-2\'s owner, run 2, is finished');
    assert.equal(changed.slices.length, 4);
    assert.equal(changed.slices[3].kind, 'change', 'run 4 builds the change');
    assert.equal(answers.length, 1, 'run 3 goes on with the revise');
    assert.match(answers[0].payload.feedback, /Run 4 builds this change/);

    // ── 3: run 4 finishes, then run 3: the finish order 1, 2, 4, 3 differs from the numbering ──
    const r4 = fire(4, 'running'); pids[4] = r4.pid; branches[4] = r4.feature;
    finish(r4.pid, 2); lastBranch = r4.feature;
    runs.delete(e3.id);
    finish(r3.pid, 3); lastBranch = r3.feature;

    // ── 4: the head settles; check round 1 names the gap R-ops-2; Ship is refused while it is open ──
    const deps = { tick: () => {}, broadcastFeature: () => {} };
    const checks = () => JSON.parse(db.prepare('SELECT outline FROM shape_features WHERE id = ?').get(fid).outline).verify?.checks || [];
    const seen = []; const { bodies, edited } = forge(seen);
    await verifyAfterSettled({ id: r3.pid, status: 'done' }, deps);
    assert.equal(checks().length, 1, 'the head\'s settle starts check round 1');
    const c1 = checks()[0];
    assert.deepEqual(c1.head, { index: 3, pipelineId: r3.pid });
    assert.ok(getTicket(c1.ticketId, { withRequest: true }).request.shape.verify.owned.includes('R-ops-2'), 'the Verifier is sent R-ops-2');
    await verifierRound(c1.ticketId, deps, { gaps: ['R-ops-2'] });
    let v = featureView(fid);
    assert.equal(v.verify.state, 'gaps');
    assert.equal(v.ship.ready, false);
    assert.equal(oneCardModel({ own: null, card: { feature: v, smallRuns: true } }).word, VERIFY_WORDS.gaps);
    assert.equal(v.slices.length, 5);
    assert.equal(v.slices[4].kind, 'change', 'run 5 closes the gap');
    assert.deepEqual(JSON.parse(db.prepare('SELECT outline FROM shape_features WHERE id = ?').get(fid).outline).slices[4].requirements, ['R-ops-2']);
    const refusals = [];
    let r = await ship(fid);
    refusals.push([r.status, (await r.json()).code]);
    assert.deepEqual(refusals[0], [409, 'NOT_READY']);
    assert.deepEqual(seen.filter((x) => x[0] === 'gh' || (x[0] === 'git' && x[1] === 'push')), [], 'no gh call and no push while a gap is open');

    // ── 5: the gap run finishes; every run is done but the re-check has not run: still not ready ──
    const r5 = fire(5, 'running'); pids[5] = r5.pid; branches[5] = r5.feature;
    finish(r5.pid, 4); lastBranch = r5.feature;
    await verifyAfterSettled({ id: r5.pid, status: 'done' }, deps);
    v = featureView(fid);
    assert.ok(v.slices.every((s) => s.state === 'done'), 'every run is done');
    assert.equal(v.ship.ready, false);
    assert.equal(v.verify.state, 'verifying');
    assert.equal(checks().length, 2);
    assert.equal(checks()[1].round, 2);
    r = await ship(fid);
    refusals.push([r.status, (await r.json()).code]);
    assert.deepEqual(refusals[1], [409, 'NOT_READY']);
    assert.deepEqual(ghOnly(seen), []);
    await verifierRound(checks()[1].ticketId, deps);
    v = featureView(fid);
    assert.equal(v.verify.state, 'clean');
    assert.equal(checks()[1].headSha, git(dir, 'rev-parse', branches[5]), 'the real Verifier run read the head Ship pushes');
    assert.equal(v.ship.ready, true);
    // Slice 7: R-comp-4 still waits for your mark, so the checked feature asks for it before it reads Ready to ship.
    const asked = oneCardModel({ own: null, card: { feature: v, smallRuns: true } });
    assert.deepEqual([asked.word, asked.detail], ['Needs you', 'Needs your confirmation: R-comp-4']);

    // ── 6: Compliance has not marked R-comp-4 yet; Not met needs a reason ──
    r = await ship(fid);
    const blocked = await r.json();
    assert.deepEqual([r.status, blocked.code, blocked.role, blocked.error], [409, 'ACCEPTANCE_INCOMPLETE', 'compliance', 'Waiting for you to confirm R-comp-4']);
    assert.deepEqual(ghOnly(seen), []);
    assert.equal((await confirm(fid, { id: 'R-comp-4', mark: 'not-met' })).status, 400);
    r = await confirm(fid, { id: 'R-comp-4', mark: 'not-met', reason: REASON });
    assert.equal(r.status, 200, await r.clone().text());

    // ── 7: Ship ──
    r = await ship(fid);
    assert.equal(r.status, 200, await r.clone().text());
    const finishOrder = [1, 2, 4, 3, 5];
    // (a) refused twice while the gap was open, then 200 after the clean round 2
    assert.deepEqual(refusals, [[409, 'NOT_READY'], [409, 'NOT_READY']]);
    // (b) one PR per run, run 1 included, in finish order; run 1 into the feature's base
    const created = ghCalls(seen, 'create');
    assert.deepEqual(created.map((x) => argOf(x, '--head')), finishOrder.map((k) => branches[k]));
    assert.deepEqual(created.map((x) => argOf(x, '--base')), [row.source_branch, branches[1], branches[2], branches[4], branches[3]]);
    const sv = featureView(fid);
    assert.deepEqual(sv.ship.smallRuns.order.map((o) => o.pipelineId), finishOrder.map((k) => pids[k]));
    const careLine = sv.ship.smallRuns.care.line;
    assert.equal(careLine, careOutcome(careOfFeature(fid), featureFigures(fid), sv.ship.smallRuns.met).line);
    assert.ok(sv.ship.smallRuns.care.outcome, 'the finished feature has its outcome');
    assert.match(careLine, /^Care: Balanced · .* · 1 gap found at the end · /);
    assert.deepEqual(sv.ship.smallRuns.unmet.map(({ id, mark, reason }) => ({ id, mark, reason })), [{ id: 'R-comp-4', mark: 'not-met', reason: REASON }]);
    const unmet = unmetLines(sv.ship.smallRuns)[0];
    assert.equal(bodies.size, 5);
    assert.deepEqual([...edited.keys()].sort(), [...bodies.keys()].sort(), 'Ship rewrites every PR body once they all exist');
    for (const body of [...bodies.values(), ...edited.values()]) {
      assert.deepEqual(careLines(body), [careLine], body);
      assert.ok(body.includes(unmet), body);
    }
    // (c) every agreed id traced once: to a run, or to a role
    const owned = sv.ship.smallRuns.owned.map((o) => o.id);
    const confirmed = sv.ship.smallRuns.confirmed.map((o) => o.id);
    assert.ok(sv.ship.smallRuns.owned.every((o) => Number.isInteger(o.run)), JSON.stringify(sv.ship.smallRuns.owned));
    assert.ok(sv.ship.smallRuns.confirmed.every((o) => o.role), JSON.stringify(sv.ship.smallRuns.confirmed));
    assert.deepEqual([...owned, ...confirmed].sort(), AGREED.map((x) => x.id).sort());
    assert.equal(new Set([...owned, ...confirmed]).size, owned.length + confirmed.length);
    // (d) nothing reaches a real remote: every push went to the stub
    assert.deepEqual(ghCalls(seen, 'push'), []);
    assert.ok(seen.some((x) => x[0] === 'git' && x[1] === 'push'), 'Ship pushed through the stub');
    assert.equal(git(dir, 'remote'), '');
    assert.equal(git(dir, 'for-each-ref', 'refs/remotes'), '');
  } finally {
    gitInfo.reset();
    rmSync(dir, { recursive: true, force: true });
  }
}));
