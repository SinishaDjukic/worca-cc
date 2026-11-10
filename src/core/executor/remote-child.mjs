// src/core/executor/remote-child.mjs
// A ChildProcess-shaped handle for one exec on a worker session: exactly the surface
// spawn.mjs superviseSpawn and script-runner.mjs spawnScript use — `pid`, `stdout`/`stderr`
// readable streams, `stdin` (already delivered in the exec frame, so a stub), `exitCode`,
// `signalCode`, `kill()`, and the 'error' / 'close' events in the same order a local child
// emits them. The supervisors never learn whether the child is local or remote beyond the
// `remote` flag, which routes their tree signals through the session instead of `-pid`.
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { MODEL_CREDENTIAL_ENV_KEYS } from '../broker-guard.mjs';
import { MAX_WITHHELD, SIGNALS } from './protocol.mjs';

/** Why an exec ended without an exit: the worker went away. Classified as a network failure
 *  so the harness's failure policy retries it, on a fresh worker. */
export const WORKER_LOST = 'EWORKERLOST';

/** How long to wait for the stdout/stderr consumers to drain after the exit frame before
 *  'close' is emitted regardless (a consumer that never attached). */
const DRAIN_GRACE_MS = 2000;

/**
 * The names the controller deliberately left out of a spawn's env: every variable it holds itself that the composed
 * env lacks (an env-scrub guardrail, a stripped Git or broker credential), and — with the credential broker on — every
 * model credential the env lacks (agents hold the broker's token only). A worker never fills these in from its own
 * environment (worker/exec.mjs childEnv); what the controller never held and no rule removes is the worker's to add.
 */
export function withheldNames(env, controllerEnv = process.env) {
  const sent = env || {};
  const names = Object.keys(controllerEnv).filter((k) => sent[k] == null && controllerEnv[k] !== undefined && controllerEnv[k] !== '');   // null: an adapter unset it (the frame drops it too)
  const brokered = typeof controllerEnv.WORCA_BROKER_URL === 'string' && controllerEnv.WORCA_BROKER_URL.trim() !== '';
  if (brokered) for (const k of MODEL_CREDENTIAL_ENV_KEYS) if (sent[k] == null && !names.includes(k)) names.push(k);   // null as above: unset by an adapter
  return names.filter((k) => k.length <= 256).slice(0, MAX_WITHHELD);
}

/**
 * @param {{ workerId: string, exec: (spec: object, handlers: object) => string, signal: (id: string, sig: string) => void }} session
 * @param {{ file: string, args: string[], cwd: string, env: Record<string,string>, stdin?: string|null, displayBin?: string, detached?: boolean }} spec
 * @returns {EventEmitter & { remote: true, id: string, pid: number|null, exitCode: number|null, signalCode: string|null,
 *   stdout: PassThrough, stderr: PassThrough, stdin: object, kill: (sig?: string) => boolean }}
 */
export function createRemoteChild(session, { file, args, cwd, env, stdin = null, displayBin = file, detached = true, reap = false, controllerEnv = process.env }) {
  const child = new EventEmitter();
  child.remote = true;
  child.workerId = session.workerId;
  child.pid = null;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  // The bytes already rode the exec frame; a supervisor still calls end() after attaching an error listener.
  child.stdin = { on() { return this; }, once() { return this; }, end() {}, write() { return true; }, destroy() {} };
  let ended = false;

  const drainThen = (fn) => {
    // 'close' must come after every line the supervisors' readers will ever see: the streams are
    // ended here, and the event waits for both consumers to reach the end (or a grace period, for
    // a consumer that never attached; the timer is not unref'd so the event always fires).
    let timer = null;
    const settle = Promise.all([once(child.stdout, 'close'), once(child.stderr, 'close')]).catch(() => {});
    const grace = new Promise((r) => { timer = setTimeout(r, DRAIN_GRACE_MS); });
    Promise.race([settle, grace]).then(() => { clearTimeout(timer); fn(); });
  };
  const endStreams = () => {
    if (ended) return;
    ended = true;
    child.stdout.end();
    child.stderr.end();
  };

  const id = session.exec({ file, args, cwd, env, stdin, detached, reap: reap === true, withheld: withheldNames(env, controllerEnv) }, {
    onStarted: ({ pid }) => { child.pid = pid; child.emit('spawn'); },
    onLines: ({ stream, lines, more = false }) => {
      if (ended) return;
      // `more`: the last line continues in the next frame, so no newline ends it here (it arrives as one line).
      (stream === 'out' ? child.stdout : child.stderr).write(lines.join('\n') + (more ? '' : '\n'));
    },
    onSpawnError: ({ code, message, errorClass = null }) => {
      endStreams();
      const err = Object.assign(new Error(message), code ? { code } : {}, errorClass ? { errorClass } : {});
      drainThen(() => child.emit('error', err));
    },
    onExit: ({ code, signal }) => {
      child.exitCode = code;
      child.signalCode = signal;
      endStreams();
      drainThen(() => child.emit('close', code, signal));
    },
    onLost: (why) => {
      if (child.exitCode !== null || child.signalCode !== null) return;   // already exited: nothing to report
      child.signalCode = 'SIGKILL';
      endStreams();
      const err = Object.assign(new Error(`worker ${session.workerId} lost: ${why} (while running ${displayBin})`), { code: WORKER_LOST, errorClass: 'network' });
      drainThen(() => { child.emit('error', err); child.emit('close', null, 'SIGKILL'); });
    },
  });
  child.id = id;
  child.kill = (sig = 'SIGTERM') => {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    if (!SIGNALS.includes(sig)) return false;   // the protocol carries SIGTERM, SIGKILL and SIGINT: anything else was not sent
    try { session.signal(id, sig); return true; } catch { return false; }
  };
  return child;
}
