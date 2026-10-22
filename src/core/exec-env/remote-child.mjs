// src/core/exec-env/remote-child.mjs
// A child_process-like handle for a command running in the run's sandbox: exactly the
// surface superviseSpawn and spawnScript use — stdout/stderr Readables (setEncoding,
// destroy), 'exit'/'close'/'error', kill(), exitCode, signalCode, stdin = null. `pid` stays
// undefined (no host code may ever signal a sandbox pid); `remotePid` carries it. Sync runs
// HERE: upload before the command, pull files + code before 'close', because callers read
// the step's outputs as soon as the child closes.
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import { shq } from './shell.mjs';
import { AGENT_COMMAND_TIMEOUT_MS } from './policy.mjs';

export class RemoteChild extends EventEmitter {
  constructor(env, cmd, { cwd, envs, stdinText = null, uploads = [] }) {
    super();
    this._env = env;
    this.stdin = null;                     // stdin goes in as a file (callers guard child.stdin)
    this.stdout = new PassThrough(); this.stderr = new PassThrough();
    this.pid = undefined; this.remotePid = null;
    this.exitCode = null; this.signalCode = null;
    this._killed = false; this._handle = null; this._stdinFile = null;
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
    let line = cmd;
    if (stdinText != null) { this._stdinFile = await env.writeScratch(stdinText); line = `${cmd} < ${shq(this._stdinFile)}`; }
    if (this._killed) return null;
    this._handle = await env._call(() => env.client.run(env.sandbox, line, {
      background: true, cwd, env: envs, timeoutMs: AGENT_COMMAND_TIMEOUT_MS,
      onStdout: (d) => { this.stdout.write(d); }, onStderr: (d) => { this.stderr.write(d); },
    }));
    this.remotePid = this._handle.pid;
    if (this._killed) await this._handle.kill().catch(() => {});
    try { return (await env._call(() => this._handle.wait())).exitCode; }
    catch (err) {
      if (typeof err?.exitCode === 'number') return err.exitCode;
      if (this._killed) return null;
      throw err;
    }
  }

  async _exit(code, signal) {
    this.exitCode = code; this.signalCode = signal;
    this.stdout.end(); this.stderr.end();
    // 'close' only after every line was framed (superviseSpawn closes its readline on 'close').
    await Promise.race([Promise.all([finished(this.stdout), finished(this.stderr)]).catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
    this.emit('exit', code, signal); this.emit('close', code, signal);
  }
  _fail(err) { this.stdout.end(); this.stderr.end(); this.emit('error', err); }
  kill() {
    this._killed = true;
    if (this._handle) this._handle.kill().catch(() => {});   // the backend kills with SIGKILL (E2B has no gentler signal)
    return true;
  }
}
