// src/core/keep-awake.mjs — keep the machine from sleeping on its idle timer while pipeline runs
// have agents working (the keepAwake setting, the account menu's Keep awake switch).
//
// createKeepAwake(...).update(workingCount)   0 → 1 starts ONE inhibitor child, 1 → 0 kills it
// createKeepAwake(...).stop()                 kills the child; later updates do nothing
// countWorking(entries)                       how many runs-Map entries count as working
//
// Only idle SYSTEM sleep is held: the display may still turn off, and lid close, an explicit sleep
// and low battery behave as before. Each OS tool is a child tied to the server's pid, so it ends
// with the server even after SIGKILL. A missing tool or a failed spawn logs ONE warning and never
// affects a run. Spawn is injected so tests need no real OS tool.
import { spawn as nodeSpawn } from 'node:child_process';

const WORKING = new Set(['created', 'starting', 'running', 'pausing']);

/**
 * A run is working when it is a pipeline entry (not an action, script bench or agentgen entry)
 * in a live status and is not waiting on a human answer.
 * @param {Iterable<{kind?:string, status?:string, pendingQuestion?:any}>} entries the runs-Map values
 * @returns {number}
 */
export function countWorking(entries) {
  let n = 0;
  for (const e of entries) {
    const kind = e.kind || 'run';
    if (kind !== 'run' && kind !== 'workspace-run') continue;
    if (e.pendingQuestion) continue;
    if (WORKING.has(String(e.status || '').toLowerCase())) n += 1;
  }
  return n;
}

// ES_CONTINUOUS | ES_SYSTEM_REQUIRED, held by this PowerShell thread until the server pid ends.
const WIN_SCRIPT = (pid) => "$ErrorActionPreference='Stop'; Add-Type -Namespace Worca -Name Power -MemberDefinition "
  + "'[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);'; "
  + '[Worca.Power]::SetThreadExecutionState([uint32]2147483649) | Out-Null; '
  + `Wait-Process -Id ${pid} -ErrorAction SilentlyContinue`;

function commandFor(platform, pid) {
  const p = String(pid);
  if (platform === 'darwin') return ['caffeinate', ['-i', '-w', p]];
  if (platform === 'linux') {
    return ['systemd-inhibit', ['--what=idle', '--who=worca', '--why=worca pipeline run in progress', 'tail', '--pid', p, '-f', '/dev/null']];
  }
  if (platform === 'win32') return ['powershell', ['-NoProfile', '-NonInteractive', '-Command', WIN_SCRIPT(p)]];
  return null;
}

/**
 * @param {{platform?:string, deployment?:string, spawn?:Function, pid?:number, log?:(line:string)=>void}} [o]
 */
export function createKeepAwake({
  platform = process.platform, deployment = 'local', spawn = nodeSpawn, pid = process.pid, log = console.warn,
} = {}) {
  let child = null;
  let stopped = false;
  let failed = false;   // the tool is missing or would not start: warned once, never retried

  const fail = (err) => {
    if (failed) return;
    failed = true;
    log(`[worca-ui] keep-awake: could not hold the machine awake (${err && err.message ? err.message : err}); runs are unaffected`);
  };

  function acquire() {
    const cmd = commandFor(platform, pid);
    if (!cmd) return;
    let c;
    try {
      c = spawn(cmd[0], cmd[1], { stdio: 'ignore', windowsHide: true });
    } catch (err) { fail(err); return; }
    if (!c) return;
    child = c;
    c.on('error', (err) => {
      if (child === c) child = null;
      fail(err);
    });
    c.on('exit', (code) => {
      if (child !== c) return;   // released by us: its exit is expected
      child = null;
      // A tool that starts but cannot hold the lock (systemd-inhibit without systemd, a blocked
      // PowerShell) exits non-zero at once: warn once and stop retrying. A clean or signalled
      // exit is respawned on the next update.
      if (typeof code === 'number' && code !== 0) fail(new Error(`${cmd[0]} exited with code ${code}`));
    });
    if (typeof c.unref === 'function') c.unref();
  }

  function release() {
    const c = child;
    child = null;
    if (!c) return;
    try { c.kill(); } catch { /* already gone */ }
  }

  return {
    update(workingCount) {
      if (stopped || failed || deployment !== 'local') return;
      if (workingCount > 0) { if (!child) acquire(); } else release();
    },
    stop() {
      stopped = true;
      release();
    },
  };
}
