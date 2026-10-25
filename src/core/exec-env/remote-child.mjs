// src/core/exec-env/remote-child.mjs
// A child_process-like handle for a command running in the run's sandbox: exactly the
// surface superviseSpawn and spawnScript use — stdout/stderr Readables (setEncoding,
// destroy), 'exit'/'close'/'error', kill(), exitCode, signalCode, stdin = null. `pid` stays
// undefined (no host code may ever signal a sandbox pid); `remotePid` carries it. Sync runs
// HERE: upload before the command, pull files + code before 'close', because callers read
// the step's outputs as soon as the child closes.
//
// Stop (plans/2026-10-22-e2b-kill-egress-checks.md §1): envd starts every command in its own process group, which
// holds every other command too (the model relay among them), and a handle kill reaches the one pid only. So the line
// runs as `exec setsid -w <cmd>`: the handle's pid leads a group of its own, and a stop signals that group from a
// second command (`kill -TERM -- -<pid>`, then `kill -KILL -- -<pid>` and the handle kill as a backstop), so a
// backgrounded grandchild dies with the step while the sandbox and its relay live on. envd's group is never signalled.
// A grandchild that starts its own session (setsid, a double fork) survives; a sandbox kill at run end still ends it.
//
// Leftovers (R15): a command whose background child still holds its stdout does not end until that child does (design
// §9), so after the step's final result superviseSpawn group-kills what is left (reapGroup): the same two commands,
// without marking the child stopped, so the command ends as itself.
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import { shq } from './shell.mjs';
import { AGENT_COMMAND_TIMEOUT_MS } from './policy.mjs';
import { sigkillGraceMs } from '../child-env.mjs';

/** The command line a RemoteChild runs: `cmd` leading a process group of its own (see the header). */
export const groupLine = (cmd) => `exec setsid -w ${cmd}`;
/** The second command that signals a RemoteChild's group. A stop right after the start can land before `setsid` ran
 *  (the handle's pid is known as soon as the command forks): no group has that id yet, so the pid alone takes it, still
 *  outside envd's group, and the step never starts its own. Without the fallback the stop waited out the KILL grace. */
export const groupKillLine = (signal, pid) => `kill -${signal} -- -${Number(pid)} 2>/dev/null || kill -${signal} ${Number(pid)} 2>/dev/null || true`;

export class RemoteChild extends EventEmitter {
  constructor(env, cmd, { cwd, envs, stdinText = null, uploads = [] }) {
    super();
    this._env = env;
    this.stdin = null;                     // stdin goes in as a file (callers guard child.stdin)
    this.stdout = new PassThrough(); this.stderr = new PassThrough();
    this.pid = undefined; this.remotePid = null;
    this.exitCode = null; this.signalCode = null;
    this._killed = false; this._reaped = false; this._handle = null; this._stdinFile = null;
    setImmediate(() => { this._run(cmd, { cwd, envs, stdinText, uploads }); });
  }

  async _run(cmd, opts) {
    const env = this._env;
    let code = null; let failure = null; let counted = false;
    try {
      await env._spawnStarted(); counted = true;   // unparks the sandbox if an ask is pending
      await env.beforeSpawn();
      code = await this._command(cmd, opts);
    } catch (err) { failure = err; }
    // Sync even after a failure or a kill: what the agent wrote must reach the host before the
    // caller reads outputs, and before a stop commits the worktree.
    if (!env.lost) { try { await env.afterSpawn(); } catch (err) { failure ||= err; } }
    if (counted) await env._spawnEnded().catch(() => {});
    if (this._stdinFile) env.removeScratch(this._stdinFile);
    if (this._killed) return this._exit(null, 'SIGKILL');   // superviseSpawn turns this into AbortError
    if (failure) return this._fail(failure);
    return this._exit(code, null);
  }

  async _command(cmd, { cwd, envs, stdinText, uploads }) {
    const env = this._env;
    for (const p of uploads) await env.uploadPath(p);
    let line = groupLine(cmd);
    if (stdinText != null) { this._stdinFile = await env.writeScratch(stdinText); line = `${line} < ${shq(this._stdinFile)}`; }
    if (this._killed) return null;
    this._handle = await env._call(() => env.client.run(env.sandbox, line, {
      background: true, cwd, env: envs, timeoutMs: AGENT_COMMAND_TIMEOUT_MS,
      onStdout: (d) => { this.stdout.write(d); }, onStderr: (d) => { this.stderr.write(d); },
    }));
    this.remotePid = this._handle.pid;
    if (this._killed) await this._killGroup('KILL');
    try { const r = await env._call(() => this._handle.wait()); this._exited = true; return r.exitCode; }
    catch (err) {
      this._exited = true;
      // The leftover kill ended the command itself (a signal's exit, or none): no exit code of its own.
      if (this._reaped && !(err?.exitCode >= 0 && err.exitCode < 128)) return null;
      if (typeof err?.exitCode === 'number') return err.exitCode;
      if (this._killed) return null;
      throw err;
    }
  }

  async _exit(code, signal) {
    this._exited = true;   // its pid may be reused in the sandbox: no group signal after this
    this.exitCode = code; this.signalCode = signal;
    this.stdout.end(); this.stderr.end();
    // 'close' only after every line was framed (superviseSpawn closes its readline on 'close').
    await Promise.race([Promise.all([finished(this.stdout), finished(this.stderr)]).catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
    this.emit('exit', code, signal); this.emit('close', code, signal);
  }
  _fail(err) { this._exited = true; this.stdout.end(); this.stderr.end(); this.emit('error', err); }
  /** Signal the command's group from a second command (never envd's group: only a pid this handle got is used);
   *  KILL also kills the handle's pid, which the backend does with SIGKILL. Never throws. */
  async _killGroup(signal, { handle = true } = {}) {
    const env = this._env;
    if (this.remotePid != null && !env.lost && !this._exited) await env._sh(groupKillLine(signal, this.remotePid)).catch(() => {});
    if (signal === 'KILL' && handle && this._handle) await this._handle.kill().catch(() => {});
  }
  /** superviseSpawn's leftover kill (R15): TERM to the group, KILL after sigkillGraceMs(), while the command has not
   *  ended (no group signal after: its pid may be reused). Not a stop: the handle is left to end with its group. */
  reapGroup() {
    if (!this._handle || this._exited || this._killed) return false;
    this._reaped = true;
    this._killGroup('TERM', { handle: false });
    setTimeout(() => { this._killGroup('KILL', { handle: false }); }, sigkillGraceMs()).unref?.();
    return true;
  }
  /** superviseSpawn's stop: SIGTERM signals the group, SIGKILL kills it and the handle. With no signal (a script's
   *  stop): TERM, then KILL after sigkillGraceMs(). Before the command started, it never starts. */
  kill(signal) {
    this._killed = true;
    if (!this._handle) return true;
    if (signal === 'SIGTERM') this._killGroup('TERM');
    else if (signal === 'SIGKILL') this._killGroup('KILL');
    else { this._killGroup('TERM'); setTimeout(() => { this._killGroup('KILL'); }, sigkillGraceMs()).unref?.(); }
    return true;
  }
}
