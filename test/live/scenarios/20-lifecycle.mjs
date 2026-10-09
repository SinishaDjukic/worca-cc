// test/live/scenarios/20-lifecycle.mjs
// Runs interrupted on purpose: pause → resume, stop, a hard crash + doctor →
// resume, a run started on the baseline build and resumed on this one, and the
// per-pipeline cost cap. Judged on store state, the wire and the oracle.
import { checkCalcRun, checkRunBookkeeping, checkRunDone, checkWire } from '../lib/checks.mjs';
import {
  startRun, cliWith, waitRunId, runRow, waitStatus, waitNodeInFlight,
  sandboxProcesses, killAll, resumedTaps, promptOf, baselineCli, BASELINE_REPO,
} from '../lib/lifecycle.mjs';
import { existsSync } from 'node:fs';
import { sleep, waitFor } from '../lib/sandbox.mjs';

// Only spawns whose prompt is inline (-p <text>) are matchable while in flight: the tap
// records a STAGED prompt (bare -p, prompt on stdin) only when the spawn exits.
const IMPL_SITE = /task: Implementation$/;
const CLARIFY_SITE = /task: Clarify$/;

/** Steps of the run that recorded a session id, by node. */
function sessionsByNode(sb, id) {
  const m = new Map();
  for (const s of sb.query('select node_id, key, session_id, status, cost_usd from pipeline_steps where pipeline_id = ? and session_id is not null', id)) {
    if (!m.has(s.node_id)) m.set(s.node_id, []);
    m.get(s.node_id).push(s);
  }
  return m;
}

/** Shared tail: a resumed run reached done, did the work, and the in-flight node resumed its own session. */
function checkResumed(t, id, proj, interruptedTap, { costBefore }) {
  const run = checkRunDone(t, t.sb, id);
  checkRunBookkeeping(t, t.sb, id);
  checkCalcRun(t, t.sb, proj, run);
  const pausedSession = interruptedTap?.wire?.sessionIds?.[0];
  const resumed = resumedTaps(t.sb);
  t.check('resume: a spawn carried --resume', resumed.length > 0, `${resumed.length} resumed spawns`);
  const own = resumed.find((r) => r.sessionId === pausedSession);
  t.check('resume: the interrupted node resumed its own session', !!own, `interrupted session=${pausedSession}; resumed=${resumed.map((r) => `${r.tap.site}:${r.sessionId}`).join(', ')}`);
  if (own) {
    t.check('resume: same call site as the interrupted spawn', own.tap.site === interruptedTap.site, `${own.tap.site} vs ${interruptedTap.site}`);
    t.check("resume: prompt carries the 'Resumed session' header", /## Resumed session/.test(promptOf(own.tap)), promptOf(own.tap).slice(0, 200));
    t.check('resume: the resumed spawn answered on the same session', (own.tap.wire.sessionIds || []).includes(pausedSession), `wire sessions=${own.tap.wire.sessionIds}`);
  }
  const stored = [...sessionsByNode(t.sb, id).values()].flat().map((s) => s.session_id);
  t.check('resume: interrupted session is the one stored on the step', stored.includes(pausedSession), `stored=${stored.join(',')}`);
  const after = runRow(t.sb, id)?.total_cost_usd || 0;
  t.check('cost: booked before the interruption', costBefore > 0, `before=${costBefore}`);
  t.check('cost: grew after the resume', after > costBefore, `before=${costBefore} after=${after}`);
  checkWire(t, t.sb.agentTaps(), { expectModel: true, allowError: (tp) => tp === interruptedTap || tp.seq === interruptedTap?.seq });
}

export default [
  {
    id: 'lifecycle.pause-resume',
    title: 'pause mid-node, resume to done: Claude --resume on the stored session',
    tier: 'core', models: 'cheap', diff: true,
    async run(t) {
      const { ch, proj } = startRun(t);
      const id = await waitRunId(t.sb);
      t.check('run id appeared', !!id);
      if (!id) { ch.kill('SIGKILL'); return; }
      const tap = await waitNodeInFlight(t.sb, IMPL_SITE, { child: ch });
      t.check('implementer spawn in flight with a session', !!tap);
      if (!tap) { ch.kill('SIGKILL'); return; }
      const p = t.sb.cliSync(['pause', id]);
      t.check('pause: exit 0', p.status === 0, p.stdout + p.stderr);
      const paused = await waitStatus(t.sb, id, ['paused'], { timeoutMs: 120000 });
      t.check('pause: status paused', !!paused, JSON.stringify(runRow(t.sb, id)));
      const first = await Promise.race([ch.done, sleep(60000).then(() => null)]);
      t.check('pause: the owning CLI exited', !!first, first ? `code=${first.code}` : 'still running after 60s');
      if (!first) ch.kill('SIGKILL');
      const inflight = t.sb.agentTaps().find((x) => x.seq === tap.seq);
      t.check('pause: the in-flight harness process ended', !!inflight?.endedAt, JSON.stringify({ exit: inflight?.exit, signal: inflight?.signal, fwd: inflight?.forwardedSignal }));
      t.check('pause: a resume point is stored', !!runRow(t.sb, id)?.has_resume_point);
      const costBefore = runRow(t.sb, id)?.total_cost_usd || 0;
      const r = await t.sb.cli(['resume', id, '--yes'], { cwd: proj });
      t.check('resume: exit 0', r.code === 0, `${r.stderr.slice(-600)} ${r.stdout.slice(-600)}`);
      checkResumed(t, id, proj, inflight || tap, { costBefore });
    },
  },
  {
    id: 'lifecycle.stop',
    title: 'stop mid-node: run stopped, harness child gone, nothing orphaned',
    tier: 'core', models: 'cheap',
    async run(t) {
      const { ch } = startRun(t);
      const id = await waitRunId(t.sb);
      const tap = id && await waitNodeInFlight(t.sb, CLARIFY_SITE, { child: ch });
      t.check('clarify spawn in flight', !!tap);
      if (!tap) { ch.kill('SIGKILL'); return; }
      const t0 = Date.now();
      const s = t.sb.cliSync(['stop', id]);
      t.check('stop: exit 0', s.status === 0, s.stdout + s.stderr);
      const fin = await Promise.race([ch.done, sleep(90000).then(() => null)]);
      const ms = Date.now() - t0;
      t.check('stop: the owning CLI exited', !!fin, fin ? `code=${fin.code} after ${ms}ms` : 'still running after 90s');
      if (!fin) ch.kill('SIGKILL');
      t.check('stop: CLI gone within 30s (SIGKILL grace is 5s)', fin && ms < 30000, `${ms}ms`);
      const row = await waitStatus(t.sb, id, ['stopped'], { timeoutMs: 30000 });
      t.check('stop: status stopped', !!row, JSON.stringify(runRow(t.sb, id)));
      const rec = t.sb.agentTaps().find((x) => x.seq === tap.seq);
      t.check('stop: in-flight harness spawn ended', !!rec?.endedAt, JSON.stringify({ exit: rec?.exit, signal: rec?.signal }));
      t.check('stop: harness got a termination signal', !!(rec?.forwardedSignal || rec?.signal), JSON.stringify({ exit: rec?.exit, signal: rec?.signal, fwd: rec?.forwardedSignal }));
      await sleep(3000);
      const left = sandboxProcesses(t.sb);
      t.check('stop: no process left running in the sandbox', left.length === 0, JSON.stringify(left));
      killAll(left);
      const again = t.sb.cliSync(['stop', id]);
      t.check('stop: stopping again is idempotent (exit 0)', again.status === 0, again.stdout + again.stderr);
      const res = t.sb.cliSync(['resume', id, '--yes']);
      t.check('stop: a stopped run refuses resume', res.status !== 0, res.stdout + res.stderr);
    },
  },
  {
    id: 'lifecycle.crash-doctor',
    title: 'SIGKILL the CLI mid-node, doctor reconciles, resume finishes the run',
    tier: 'core', models: 'cheap', diff: true,
    async run(t) {
      const { ch, proj } = startRun(t);
      const id = await waitRunId(t.sb);
      const tap = id && await waitNodeInFlight(t.sb, CLARIFY_SITE, { child: ch });
      t.check('clarify spawn in flight', !!tap);
      if (!tap) { ch.kill('SIGKILL'); return; }
      ch.kill('SIGKILL');
      await ch.done;
      // The harness child is not ours to reap after a hard crash; record whether it outlived the CLI.
      const orphans = await waitFor(() => { const p = sandboxProcesses(t.sb); return p.length ? null : true; }, { timeoutMs: 30000, everyMs: 2000 });
      const left = sandboxProcesses(t.sb);
      t.note(orphans ? 'harness child exited within 30s of the CLI being SIGKILLed' : `harness processes outlived the SIGKILLed CLI: ${JSON.stringify(left)}`);
      t.check('crash: no harness process outlives the crashed CLI by 30s', !!orphans, JSON.stringify(left), { severity: 'warn' });
      killAll(left);
      t.check('crash: run row still says running before doctor', runRow(t.sb, id)?.status === 'running', JSON.stringify(runRow(t.sb, id)));
      const d = t.sb.cliSync(['doctor']);
      t.check('doctor: exit 0', d.status === 0, d.stdout + d.stderr);
      t.check('doctor: reconciled one stale run', /reconciled 1 stale/.test(d.stdout), d.stdout.slice(0, 400));
      const row = runRow(t.sb, id);
      t.check('doctor: run is interrupted', row?.status === 'interrupted', JSON.stringify(row));
      const killed = new Set(t.sb.agentTaps().map((x) => x.seq));   // every spawn up to the crash (finished or killed)
      const r = await t.sb.cli(['resume', id, '--yes'], { cwd: proj });
      t.check('resume: exit 0', r.code === 0, `${r.stderr.slice(-600)} ${r.stdout.slice(-600)}`);
      // By design (orchestrator.mjs _resumeSessions) only PAUSED executions re-attach their
      // session; a node a crash left running re-runs fresh on resume.
      const after = t.sb.agentTaps().filter((x) => !killed.has(x.seq));
      const rerun = after.find((x) => x.site === tap.site);
      t.check('resume: the crashed node ran again', !!rerun, after.map((x) => x.site).join(' | '));
      if (rerun) {
        t.check('resume: the crashed node re-ran fresh (no --resume after a crash)', !rerun.args.includes('--resume'), JSON.stringify(rerun.args.slice(0, 12)));
        t.check('resume: the re-run finished with a result', rerun.exit === 0 && rerun.wire.result && !rerun.wire.result.isError, `exit=${rerun.exit} ${rerun.wire.result?.subtype}`);
      }
      const run = checkRunDone(t, t.sb, id);
      checkRunBookkeeping(t, t.sb, id);
      checkCalcRun(t, t.sb, proj, run);
      checkWire(t, after, { expectModel: true });
    },
  },
  {
    id: 'lifecycle.cross-build-resume',
    title: 'run started + paused on the baseline build, resumed on the build under test',
    tier: 'core', models: 'cheap', engines: ['claude'],
    async run(t) {
      if (t.build === 'baseline') t.skip('only meaningful on the build under test');
      if (!existsSync(baselineCli())) t.skip(`no baseline checkout at ${BASELINE_REPO} (set LIVE_BASELINE_REPO)`);
      const { ch, proj } = startRun(t, { cliPath: baselineCli() });
      const id = await waitRunId(t.sb);
      const tap = id && await waitNodeInFlight(t.sb, IMPL_SITE, { child: ch });
      t.check('baseline: implementer spawn in flight', !!tap);
      if (!tap) { ch.kill('SIGKILL'); return; }
      const p = await cliWith(t, baselineCli(), ['pause', id]);
      t.check('baseline: pause exit 0', p.code === 0, p.stdout + p.stderr);
      const paused = await waitStatus(t.sb, id, ['paused'], { timeoutMs: 120000 });
      t.check('baseline: status paused', !!paused, JSON.stringify(runRow(t.sb, id)));
      const first = await Promise.race([ch.done, sleep(60000).then(() => null)]);
      if (!first) ch.kill('SIGKILL');
      const nBase = t.sb.agentTaps().length;
      const costBefore = runRow(t.sb, id)?.total_cost_usd || 0;
      const r = await t.sb.cli(['resume', id, '--yes'], { cwd: proj });
      t.check('test build: resume exit 0', r.code === 0, `${r.stderr.slice(-600)} ${r.stdout.slice(-600)}`);
      t.check('test build: no engine switch note in the resume output', !/another engine|switch(ed)? (to|engine)|codex|copilot/i.test(r.stdout + r.stderr), (r.stdout + r.stderr).match(/.*(another engine|codex|copilot).*/i)?.[0] || '');
      const after = t.sb.agentTaps().slice(nBase);
      t.check('test build: resumed spawns went to the claude harness', after.length > 0 && after.every((x) => x.wire.mainInit?.model?.startsWith('claude-')), after.map((x) => x.wire.mainInit?.model).join(','));
      const inflight = t.sb.agentTaps().find((x) => x.seq === tap.seq) || tap;
      checkResumed(t, id, proj, inflight, { costBefore });
    },
  },
  {
    id: 'lifecycle.cost-cap',
    title: 'per-pipeline cost cap pauses the run; resume refuses, --ignore-cost-cap finishes it',
    tier: 'core', models: 'cheap', diff: true,
    async run(t) {
      const set = t.sb.cliSync(['config', 'set', 'pipelineCostLimitUsd', '0.01']);
      t.check('config: cap set', set.status === 0, set.stdout + set.stderr);
      const proj = t.sb.addProject();
      const { SUBTRACT_TASK } = await import('../lib/checks.mjs');
      const res = await t.sb.cli(['--project', proj, '--prompt', SUBTRACT_TASK, '--yes', '--model', t.model, '--workflow', 'wf_default', '--title', 'live cost cap']);
      const id = t.sb.runs()[0]?.id;
      t.check('run id', !!id, res.stdout.slice(-400));
      if (!id) return;
      const run = t.sb.runShow(id);
      t.check('cap: run paused', run?.status === 'paused', `status=${run?.status} code=${res.code}`);
      t.check('cap: pause reason is the pipeline cost cap', run?.pauseReason === 'cost_pipeline', `pauseReason=${run?.pauseReason} ${JSON.stringify(run?.pauseDetail)}`);
      t.check('cap: spent reached the cap', (run?.costUsd || 0) >= 0.01, `cost=${run?.costUsd}`);
      const refused = await t.sb.cli(['resume', id, '--yes'], { cwd: proj, timeoutMs: 60000 });
      t.check('cap: plain resume refuses', refused.code !== 0 && /cost limit reached/.test(refused.stderr), `code=${refused.code} ${refused.stderr.slice(-300)}`);
      const costBefore = runRow(t.sb, id)?.total_cost_usd || 0;
      const r = await t.sb.cli(['resume', id, '--yes', '--ignore-cost-cap'], { cwd: proj });
      t.check('cap: --ignore-cost-cap resume exit 0', r.code === 0, `${r.stderr.slice(-600)} ${r.stdout.slice(-600)}`);
      const done = checkRunDone(t, t.sb, id);
      checkRunBookkeeping(t, t.sb, id);
      checkCalcRun(t, t.sb, proj, done);
      t.check('cap: cost grew past the cap after the override', (runRow(t.sb, id)?.total_cost_usd || 0) > costBefore, `before=${costBefore}`);
      checkWire(t, t.sb.agentTaps(), { expectModel: true });
    },
  },
];
