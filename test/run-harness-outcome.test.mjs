// test/run-harness-outcome.test.mjs — the orchestrator/harness wiring of the S1
// run-outcome net (not just the pure module): fact collection in _afterExecution,
// the node-keyed replace, the fan-out tally through _onSchedulerEvent, and the
// run-level finalize (no-code-change / review-blocking / end-not-reached).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { projectKey } from '../src/core/store.mjs';
import { checkRows } from './helpers/rows.mjs';

// The isolated finalize tests call this.`_git` directly without the probe the real
// setup awaits; force git "available" so gitAvailable() does not short-circuit.
const prevWorcaGit = process.env.WORCA_GIT;
process.env.WORCA_GIT = '1';
after(() => { if (prevWorcaGit === undefined) delete process.env.WORCA_GIT; else process.env.WORCA_GIT = prevWorcaGit; });

useTempHome(after);

const sha = (dir) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();

// ── orchestrator fact collection (_collectStepUnmet + _recordNodeUnmet) ──────────

test('_collectStepUnmet: missing-output (empty + absent) and missing-verdict; conditional ports never flag', async () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj-collect' });
  const tmp = mkdtempSync(join(tmpdir(), 'wc-collect-'));
  const emptyPath = join(tmp, 'empty.md'); writeFileSync(emptyPath, '');
  const fullPath = join(tmp, 'full.md'); writeFileSync(fullPath, 'content');
  const verdictPath = join(tmp, 'verdict.json');

  await checkRows([
    { name: 'an absent + a 0-byte always-output flag; a written one does not', run: async () => {
      const nc = { meta: { displayName: 'Planning' }, key: 'planner' };
      const ctx = {
        nodeId: 'plan', ordinal: 1,
        ports: { outputs: [
          { id: 'plan', type: 'md', when: 'always' },      // absent → flag
          { id: 'notes', type: 'md', when: 'always' },     // empty → flag
          { id: 'ok', type: 'md', when: 'always' },        // written → no flag
        ] },
        outputs: { plan: { path: join(tmp, 'nope.md') }, notes: { path: emptyPath }, ok: { path: fullPath } },
      };
      const out = await orch._collectStepUnmet(nc, ctx, {});
      const byPort = Object.fromEntries(out.map((u) => [u.detail, u.kind]));
      assert.equal(byPort['plan:absent'], 'missing-output');
      assert.equal(byPort['notes:empty'], 'missing-output');
      assert.ok(!out.some((u) => String(u.detail).startsWith('ok:')), 'a written output does not flag');
      assert.ok(out.every((u) => u.step === 'Planning'), 'each fact names the step');
    } },
    { name: 'a conditional (clean / blocking) or void port never flags', run: async () => {
      const nc = { meta: { displayName: 'Reviewer' }, key: 'reviewer' };
      const ctx = {
        nodeId: 'rev', ordinal: 1,
        ports: { outputs: [
          { id: 'review', type: 'md', when: 'blocking' },
          { id: 'clean', type: 'md', when: 'clean' },
          { id: 'sig', type: 'void', when: 'always' },
        ] },
        outputs: { review: { path: join(tmp, 'absent-review.md') }, clean: { path: join(tmp, 'absent-clean.md') } },
      };
      assert.deepEqual(await orch._collectStepUnmet(nc, ctx, {}), []);
    } },
    { name: 'a declared-but-missing verdict flags missing-verdict', run: async () => {
      const nc = { meta: { displayName: 'Reviewer' }, key: 'reviewer' };
      const ctx = { nodeId: 'rev', ordinal: 1, ports: { outputs: [] }, outputs: {}, verdict: { path: verdictPath } };
      const out = await orch._collectStepUnmet(nc, ctx, { verdict: { missing: true } });
      assert.equal(out.length, 1);
      assert.equal(out[0].kind, 'missing-verdict');
      // a present (non-missing) verdict does NOT flag
      assert.deepEqual(await orch._collectStepUnmet(nc, ctx, { verdict: { outcome: 'pass' } }), []);
    } },
    { name: 'a slice execution raises no per-slice facts', run: async () => {
      const nc = { meta: { displayName: 'Impl' }, key: 'implementer' };
      const ctx = { nodeId: 'impl', slice: { id: 't1' }, ports: { outputs: [{ id: 'out', type: 'md', when: 'always' }] }, outputs: { out: { path: join(tmp, 'x.md') } } };
      assert.deepEqual(await orch._collectStepUnmet(nc, ctx, {}), []);
    } },
  ]);
});

test('_recordNodeUnmet: replaces a node\'s earlier facts (a good re-run clears a first-cycle miss)', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj-replace' });
  orch._recordNodeUnmet('rev', [{ nodeId: 'rev', step: 'Review', kind: 'missing-verdict' }]);
  orch._recordNodeUnmet('plan', [{ nodeId: 'plan', step: 'Plan', kind: 'missing-output', detail: 'plan:absent' }]);
  assert.equal(orch.state.unmet.length, 2);
  // the review re-runs and now passes — its node-keyed record is replaced with nothing
  orch._recordNodeUnmet('rev', []);
  assert.deepEqual(orch.state.unmet.map((u) => u.nodeId), ['plan'], 'the stale review miss is gone');
});

// ── fan-out tally through the exec handler → _finishComposite partial-fanout ──────

test('fan-out tally: 3 of 7 done slices surface partial-fanout; a fresh expansion resets', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj-fanout' });
  orch.pipeline = null;
  orch.state.progressFacts.tasks.n = 7;
  orch._fanoutTally = { n: { done: 0, total: 7 } };   // what the expansion reset would set

  // 3 terminal 'done' slices, then a 'skipped' (never counted) and a 'start' (never counted)
  for (const status of ['done', 'done', 'done', 'skipped', 'start']) {
    orch._onSchedulerEvent('exec', { nodeId: 'n', executionId: 'e', taskId: 't', taskTotal: 7, status });
  }
  orch._finishComposite({ meta: { displayName: 'Decompose' } }, { node: { id: 'n' }, phases: [] });
  const fan = orch.state.unmet.find((u) => u.kind === 'partial-fanout');
  assert.ok(fan, 'partial-fanout recorded');
  assert.equal(fan.detail, '3 of 7 tasks');
  assert.equal(fan.step, 'Decompose');

  // a fresh decomposition expansion resets the tally (supersede) — all 7 now done ⇒ no flag
  orch._fanoutTally.n = { done: 0, total: 7 };
  for (let i = 0; i < 7; i++) orch._onSchedulerEvent('exec', { nodeId: 'n', executionId: 'e', taskId: 't', taskTotal: 7, status: 'done' });
  orch._finishComposite({ meta: { displayName: 'Decompose' } }, { node: { id: 'n' }, phases: [] });
  assert.ok(!orch.state.unmet.some((u) => u.kind === 'partial-fanout'), 'a complete fan-out clears the flag');
});

// ── _finalizeOutcome: no-code-change against a real git checkpoint (tri-state) ────

function gitOrch(tag) {
  const repo = gitDir(tag);
  const key = projectKey(repo);
  const orch = createOrchestrator({ projectDir: repo });
  orch.isWorkspace = false;
  orch.workMode = 'git';
  orch.workDirs = new Map([[key, repo]]);
  orch.checkpointRefs = { [key]: sha(repo) };
  orch.state.endReached = true;    // isolate the no-code-change signal
  orch.state.codeSteps = [{ nodeId: 'impl', step: 'Implementation' }];
  return { orch, repo };
}

test('_finalizeOutcome no-code-change: unchanged git tree ⇒ unsuccessful; a staged change ⇒ successful', async () => {
  const { orch, repo } = gitOrch('nocode');
  // 1) unchanged tree → flagged
  let r = await orch._finalizeOutcome();
  assert.equal(r.successful, false);
  assert.match(r.reason, /Implementation produced no changes to the worktree\./);
  assert.ok(orch.state.unmet.some((u) => u.kind === 'no-code-change'));

  // 2) stage a change → not flagged
  writeFileSync(join(repo, 'new.txt'), 'hello');
  execFileSync('git', ['add', '-A', '-N'], { cwd: repo });
  orch.state.unmet = [];
  r = await orch._finalizeOutcome();
  assert.equal(r.successful, true);
  assert.equal(r.reason, null);
});

test('_finalizeOutcome no-code-change: a no-git (folder) run with a code step is never flagged', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'wc-folder-'));
  const key = projectKey(folder);
  const orch = createOrchestrator({ projectDir: folder });
  orch.isWorkspace = false;
  orch.workMode = 'folder';                       // _memberWorkMode ⇒ not 'git' ⇒ helper returns null
  orch.workDirs = new Map([[key, folder]]);
  orch.checkpointRefs = {};
  orch.state.endReached = true;
  orch.state.codeSteps = [{ nodeId: 'impl', step: 'Implementation' }];
  const r = await orch._finalizeOutcome();
  assert.equal(r.successful, true, 'null diff result never flags');
});

// ── _finalizeOutcome: review-blocking and end-not-reached ─────────────────────────

test('_finalizeOutcome review-blocking: blocking>0 ⇒ unsuccessful; blocking:0 ⇒ successful', async () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj-rev' });
  orch.workDirs = new Map();                      // no git member → no-code-change inert
  orch.state.endReached = true;
  orch._nodeLabels = { rev: 'Code review' };
  orch.state.progressFacts.reviews = { rev: { pass: 3, blocking: 2 } };
  let r = await orch._finalizeOutcome();
  assert.equal(r.successful, false);
  assert.match(r.reason, /2 blocking issues/);
  assert.match(r.reason, /Code review/);

  orch.state.unmet = [];
  orch.state.progressFacts.reviews = { rev: { pass: 4, blocking: 0 } };
  r = await orch._finalizeOutcome();
  assert.equal(r.successful, true);
});

test('_finalizeOutcome end-not-reached: names the dead-end warning node, else the last ledger step', async () => {
  await checkRows([
    { name: 'a dead-ended output warning names its node', run: async () => {
      const orch = createOrchestrator({ projectDir: '/tmp/proj-q1' });
      orch.workDirs = new Map();
      orch.state.endReached = false;
      orch._nodeLabels = { n_impl: 'Implementation' };
      orch.state.warnings = ['dead-ended output: n_impl.done — fired with no wire'];
      const r = await orch._finalizeOutcome();
      assert.equal(r.successful, false);
      assert.match(r.reason, /Implementation finished without reaching its end/);
    } },
    { name: 'no warning ⇒ names the last executed ledger node, never (graph)', run: async () => {
      const orch = createOrchestrator({ projectDir: '/tmp/proj-q2' });
      orch.workDirs = new Map();
      orch.state.endReached = false;
      orch.state.warnings = [];
      orch._nodeLabels = { n_last: 'Final step' };
      orch.state.steps = [{ nodeId: 'n_first' }, { nodeId: 'n_last' }];
      const r = await orch._finalizeOutcome();
      assert.equal(r.successful, false);
      assert.match(r.reason, /Final step finished without reaching its end/);
      assert.ok(!r.reason.includes('(graph)'));
    } },
  ]);
});

test('_finalizeOutcome: fails safe to successful on an internal error', async () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj-safe' });
  orch.state.endReached = true;
  orch.state.codeSteps = [{ nodeId: 'impl', step: 'Impl' }];
  // workDirs is not a Map → _codeChangedVsCheckpoint throws → finalize catches, fails safe
  orch.workDirs = null;
  const r = await orch._finalizeOutcome();
  assert.equal(r.successful, true);
  assert.equal(r.reason, null);
});

// ── no false positive: a run with no code step / no blocking review / End reached ─

test('_finalizeOutcome: an analysis-style run (no code step, End reached, no blocking) is successful', async () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj-analysis' });
  orch.workDirs = new Map();        // no git member
  orch.state.endReached = true;
  orch.state.codeSteps = [];        // analysis/review/docs-only: no sideEffect:code node ran
  orch.state.progressFacts.reviews = {};
  orch.state.unmet = [];
  const r = await orch._finalizeOutcome();
  assert.equal(r.successful, true);
  assert.equal(r.reason, null);
  assert.deepEqual(orch.state.unmet, [], 'no unmet facts accumulated');
});
