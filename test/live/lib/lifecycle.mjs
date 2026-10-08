// test/live/lib/lifecycle.mjs
// Helpers for runs that are interrupted on purpose: start in the background,
// find the run id and the in-flight node, pause / stop / kill, and look for
// harness processes left behind in the sandbox.
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { SUBTRACT_TASK } from './checks.mjs';
import { waitFor, sleep } from './sandbox.mjs';

const NODE = process.execPath;

/** Start a calc coding run in the background with the given CLI (default: the sandbox's build). */
export function startRun(t, { cliPath = t.sb.cliPath, workflow = 'wf_default', extra = [] } = {}) {
  const proj = t.sb.addProject();
  const args = ['--project', proj, '--prompt', SUBTRACT_TASK, '--yes', '--model', t.model, '--workflow', workflow, '--title', `live ${workflow}`, ...extra];
  const ch = spawn(NODE, ['--disable-warning=ExperimentalWarning', cliPath, ...args], { cwd: t.sb.base, env: t.sb.env, stdio: ['ignore', 'pipe', 'pipe'] });
  ch.out = ''; ch.err = '';
  ch.stdout.on('data', (d) => { ch.out += d; });
  ch.stderr.on('data', (d) => { ch.err += d; });
  ch.done = new Promise((res) => ch.on('close', (code, signal) => res({ code, signal, stdout: ch.out, stderr: ch.err, endedAt: Date.now() })));
  return { ch, proj };
}

/** Run a CLI command with a given checkout's CLI (cwd = the project, so resume finds it). */
export function cliWith(t, cliPath, args, { cwd = t.sb.base, timeoutMs = 45 * 60 * 1000 } = {}) {
  return new Promise((res) => {
    const t0 = Date.now();
    const ch = spawn(NODE, ['--disable-warning=ExperimentalWarning', cliPath, ...args], { cwd, env: t.sb.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    ch.stdout.on('data', (d) => { out += d; });
    ch.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => ch.kill('SIGKILL'), timeoutMs);
    ch.on('close', (code, signal) => { clearTimeout(timer); res({ code, signal, stdout: out, stderr: err, ms: Date.now() - t0 }); });
  });
}

export async function waitRunId(sb, { timeoutMs = 120000 } = {}) {
  return waitFor(() => sb.runs()[0]?.id || null, { timeoutMs, everyMs: 1000 });
}

/** The run's status straight from the store (no CLI round trip). */
export function runRow(sb, id) {
  return sb.query('select id, status, total_cost_usd, resume_point is not null as has_resume_point from pipelines where id = ?', id)[0] || null;
}

export async function waitStatus(sb, id, statuses, { timeoutMs = 300000 } = {}) {
  const want = new Set([].concat(statuses));
  return waitFor(() => { const r = runRow(sb, id); return r && want.has(r.status) ? r : null; }, { timeoutMs, everyMs: 1000 });
}

/** Wait until a harness spawn for a call site matching `siteRe` is in flight and
 *  has announced its session (and has run `settleMs` past that). */
export async function waitNodeInFlight(sb, siteRe, { timeoutMs = 900000, settleMs = 4000, child = null } = {}) {
  let gone = false;
  if (child) child.done.then(() => { gone = true; });
  const tap = await waitFor(() => {
    const hit = sb.agentTaps().find((x) => siteRe.test(x.site) && !x.endedAt && x.wire.sessionIds.length > 0);
    return hit || (gone ? 'gone' : null);
  }, { timeoutMs, everyMs: 1500 });
  if (tap === 'gone') return null;   // the run ended before the node was caught in flight
  if (tap && settleMs) await sleep(settleMs);
  return tap;
}

/** Processes whose cwd is inside the sandbox (left-behind harness children). */
export function sandboxProcesses(sb) {
  const r = spawnSync('lsof', ['-a', '-d', 'cwd', '-F', 'pcn'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = [];
  let cur = null;
  const bases = [sb.base, sb.base.replace(/^\/private/, ''), `/private${sb.base}`];
  for (const line of (r.stdout || '').split('\n')) {
    if (line.startsWith('p')) cur = { pid: Number(line.slice(1)) };
    else if (line.startsWith('c') && cur) cur.cmd = line.slice(1);
    else if (line.startsWith('n') && cur) {
      const n = line.slice(1);
      if (bases.some((b) => n === b || n.startsWith(`${b}/`)) && cur.pid !== process.pid) out.push({ ...cur, cwd: n });
    }
  }
  return out;
}

export function killAll(procs) {
  for (const p of procs) { try { process.kill(p.pid, 'SIGKILL'); } catch { /* gone */ } }
}

/** Taps that carry `--resume <id>` (Claude's resume flag), with the id. */
export function resumedTaps(sb) {
  return sb.agentTaps().map((x) => {
    const i = x.args.indexOf('--resume');
    return i >= 0 ? { tap: x, sessionId: x.args[i + 1] } : null;
  }).filter(Boolean);
}

export function promptOf(tap) {
  const i = tap.args.indexOf('-p');
  const v = i >= 0 ? tap.args[i + 1] : null;
  return v != null && !String(v).startsWith('--') ? String(v) : String(tap.stdin || '');
}

export const BASELINE_REPO = process.env.LIVE_BASELINE_REPO || '/Users/sdjukic/dev/worca-cc-baseline';
export const baselineCli = () => join(BASELINE_REPO, 'src', 'cli', 'worca-cc.mjs');
