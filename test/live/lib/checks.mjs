// test/live/lib/checks.mjs
// Engine-neutral invariants. A scenario's outcome is judged on what holds no
// matter what words the model chose: the run's recorded state, the wire contract
// (every spawn ended, its result was not an error, the model asked for is the
// model that answered), and an oracle that executes the work product.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Every non-probe spawn: exited 0, streamed a result, no unparseable lines. */
export function checkWire(t, taps, { allowError = () => false, expectModel = null } = {}) {
  t.check('wire: at least one harness spawn', taps.length > 0, `${taps.length} spawns`);
  for (const tp of taps) {
    const w = tp.wire;
    const tag = `${tp.site.slice(0, 70)}`;
    if (allowError(tp)) continue;
    t.check(`wire[${tag}]: exit 0`, tp.exit === 0, `exit=${tp.exit} signal=${tp.signal} stderr=${(tp.stderr || '').slice(-300)}`);
    t.check(`wire[${tag}]: has a result`, !!w.result, `lines=${w.lines}`);
    t.check(`wire[${tag}]: result is not an error`, w.result && !w.result.isError, w.result ? `${w.result.subtype}: ${w.result.text}` : 'none');
    t.check(`wire[${tag}]: stream parses`, w.bad === 0, `${w.bad} bad lines`, { severity: 'warn' });
    if (expectModel && w.mainInit && tp.args.includes('--model')) {
      const asked = tp.args[tp.args.indexOf('--model') + 1];
      const re = t.profile.expectInitModel(asked);
      t.check(`wire[${tag}]: init model matches --model ${asked}`, re.test(w.mainInit.model || ''), `init model=${w.mainInit.model}`);
    }
  }
}

export function sumWireCost(taps) {
  let c = 0;
  for (const tp of taps) for (const r of (tp.wire?.results || [])) if (typeof r.costUsd === 'number') c += r.costUsd;
  return c;
}

/** The run row and its executions, as the CLI reports them. */
export function checkRunDone(t, sb, runId, { status = 'done' } = {}) {
  const run = sb.runShow(runId);
  t.check('run: detail readable', !!run, runId);
  if (!run) return null;
  t.check(`run: status ${status}`, run.status === status, `status=${run.status} pause=${run.pauseReason} ${JSON.stringify(run.pauseDetail || '').slice(0, 300)}`);
  return run;
}

/** Cost and sessions recorded per agent step; sub-agent rows closed. */
export function checkRunBookkeeping(t, sb, runId, { expectCost = true } = {}) {
  const steps = sb.query('select node_id, key, status, cost_usd, session_id, exec_meta from pipeline_steps where pipeline_id = ?', runId);
  const agentSteps = steps.filter((s) => s.session_id || (s.cost_usd ?? 0) > 0 || /^n_(?!task)/.test(s.node_id || ''));
  const withSession = agentSteps.filter((s) => s.session_id);
  t.check('db: agent steps carry a session id', withSession.length > 0, `${withSession.length}/${agentSteps.length} steps with session`);
  const total = steps.reduce((a, s) => a + (s.cost_usd || 0), 0);
  if (expectCost) t.check('db: step cost booked (> 0)', total > 0, `sum cost_usd=${total.toFixed(4)}`);
  const open = sb.query("select id, label, status from sub_agents where pipeline_id = ? and status not in ('finished','failed','stopped','cancelled')", runId);
  t.check('db: every sub-agent row closed', open.length === 0, JSON.stringify(open).slice(0, 300));
  const bad = steps.filter((s) => !['done', 'skipped'].includes(s.status));
  t.check('db: every step done or skipped', bad.length === 0, JSON.stringify(bad.map((s) => [s.key, s.status])));
  return { steps, total };
}

/** The work product: check the feature branch out in a scratch worktree and execute it. */
export function oracle(sb, projectDir, branch, script) {
  const wt = mkdtempSync(join(sb.base, 'oracle-'));
  rmSync(wt, { recursive: true, force: true });
  try {
    sb.git(projectDir, ['worktree', 'add', '-q', '--detach', wt, branch]);
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: wt, encoding: 'utf8', timeout: 60000 });
    const tests = spawnSync(process.execPath, ['--test'], { cwd: wt, encoding: 'utf8', timeout: 120000 });
    return { ok: r.status === 0, out: (r.stdout + r.stderr).slice(-600), testsOk: tests.status === 0, testsOut: (tests.stdout + tests.stderr).slice(-800) };
  } catch (err) {
    return { ok: false, out: String(err.message || err), testsOk: false, testsOut: '' };
  } finally {
    try { sb.git(projectDir, ['worktree', 'remove', '--force', wt]); } catch { /* best effort */ }
  }
}

export const SUBTRACT_TASK = 'In src/calc.mjs add and export a function `subtract(a, b)` that returns a minus b, with a JSDoc comment like add has. Add a test for it to test/calc.test.mjs (node:test, like the existing one). Keep the change minimal: do not touch any other file, do not add dependencies.';
export const SUBTRACT_ORACLE = `
import { subtract, add } from './src/calc.mjs';
if (subtract(10, 4) !== 6 || subtract(-1, -1) !== 0 || add(2, 3) !== 5) { console.error('wrong result'); process.exit(1); }
console.log('subtract ok');
`;

/** Standard checks for a finished coding run on the calc fixture. */
export function checkCalcRun(t, sb, project, run, { oracleScript = SUBTRACT_ORACLE } = {}) {
  const branch = run?.featureBranch;
  t.check('run: feature branch recorded', !!branch, String(branch));
  if (!branch) return;
  const o = oracle(sb, project, branch, oracleScript);
  t.check('oracle: feature works on the branch', o.ok, o.out);
  t.check('oracle: fixture test suite passes on the branch', o.testsOk, o.testsOut);
}

/** Parse the run id the CLI printed (pipeline directory suffix) or fall back to the newest run. */
export function runIdFrom(sb, res) {
  const m = /Pipeline directory: .*-([0-9a-f]{8})\s*$/m.exec(res?.stdout || '');
  if (m) return m[1];
  const runs = sb.runs();
  return runs[0]?.id || null;
}
