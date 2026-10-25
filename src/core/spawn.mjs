// src/core/spawn.mjs
// The child-process owner (plans/core-protection-layer-design.md §4.1): the one allowlist child env (childEnv), process
// supervision for every harness adapter (spawn as the agent user when asked, line framing of stdout/stderr, abort ->
// SIGTERM to the process group -> grace -> SIGKILL, staged-file cleanup), the argv value guard (argValue) and the
// run-start check runner (execCheck). What a stdout line MEANS is the adapter's business (onStdoutLine); this module
// never parses one.
import { spawn, spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { realpathSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { strongestClass } from './recoverable-error.mjs';
import { agentSpawn, killAgentGroup, shareWithAgent } from './agent-user.mjs';
import { agentIdentityFor } from './agent-pool.mjs';
import { currentOwner } from './billing.mjs';
import { isReservedModelEnvKey } from './model-env.mjs';
import { worcaHome } from './projects.mjs';
import { isWithin } from './fs-scope.mjs';
import { withNoGitPath } from './nogit-stub.mjs';
import { composeChildEnv } from './child-env.mjs';

export { formatDropped, SPAWN_ENV_BASE, DEFAULT_SIGKILL_GRACE_MS, sigkillGraceMs, DEFAULT_LEFTOVER_GRACE_MS, leftoverGraceMs, WIN32_ENV_BASELINE, proxyHasCredentials } from './child-env.mjs';
import { sigkillGraceMs, leftoverGraceMs } from './child-env.mjs';

// The kinds that get no no-git PATH stub: git itself (worca runs it only where git is installed), and plugin children
// (spec §7.2: exactly their names).
const NO_STUB = new Set(['git', 'plugin']);
/**
 * The one env builder for a child (child-env.mjs composeChildEnv: an allowlist of exact names, worca's env for the
 * kinds that inherit it, local or remote), with the no-git PATH stub on a local child.
 * @returns {{env: Record<string,string>, dropped: string[]}}
 */
export function childEnv(spec = {}) {
  const r = composeChildEnv(spec);
  if (spec.remote || NO_STUB.has(spec.kind)) return r;
  return { env: withNoGitPath(r.env, spec.platform ? { platform: spec.platform } : {}), dropped: r.dropped };
}


/**
 * The run-level spawn env (runClaude's `spawnEnv`, wsmap D9) as it may reach a child: string
 * values only, never a reserved key (isReservedModelEnvKey: PATH, HOME, NODE_OPTIONS, WORCA_*, …).
 * null when nothing survives, so the caller merges nothing. Pure + exported for testing.
 * @param {Record<string,*>|undefined} env
 * @returns {Record<string,string>|null}
 */
export function cleanRunEnv(env) {
  if (!env || typeof env !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && !isReservedModelEnvKey(k)) out[k] = v;
  return Object.keys(out).length ? out : null;
}

// ── process primitives for children with their own lifecycle ───────────────
// The script runner, the terminal, plugin shims and channel workers supervise their own children (a capped capture, a
// pty, a JSON-RPC pipe): they start them here, never from node:child_process themselves, build the child's env with
// childEnv({ kind }) and signal its group with signalProcessGroup.

/** node's spawn for a long-lived child. `options.env` is required: a child never inherits worca's env by default. */
export function spawnChild(file, args, options) {
  if (!options || typeof options.env !== 'object' || options.env === null) throw new Error(`spawnChild ${file}: options.env is required`);
  return spawn(file, args, options);
}
/** node's spawnSync, for a short host probe or a tree kill (`ps`, `taskkill`). */
export function spawnChildSync(file, args, options = {}) { return spawnSync(file, args, options); }
/** node's execFile as a promise (rejects with stdout/stderr on a failure), maxBuffer 16 MiB unless given. */
const execFileP = promisify(execFile);
export function execFileAsync(file, args, options = {}) { return execFileP(file, args, { maxBuffer: 16 * 1024 * 1024, ...options }); }

/**
 * A value that lands in argv after a flag (a model id, branch, path or rule word): returned as is, or refused before
 * anything spawns when it is empty or starts with "-" (it would be read as a flag: `--model -oProxyCommand=x`).
 * @throws {Error} errorClass 'config'
 */
export function argValue(value, what) {
  const v = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (!v.trim()) throw Object.assign(new Error(`${what} is empty`), { errorClass: 'config' });
  if (v.startsWith('-')) throw Object.assign(new Error(`${what} "${v}" cannot start with "-"`), { errorClass: 'config' });
  return v;
}

/**
 * The run-start check runner (an engine's preflight: `codex login status`, `copilot --version`, `cursor-agent status`,
 * `claude --version`): `file args` under `childEnv(spec)`, the exact spec the run spawns with, so the check's answer
 * comes from the run's env. Never rejects.
 * @param {string} file
 * @param {string[]} args
 * @param {{spec?: object, timeoutMs?: number, maxBuffer?: number, cwd?: string, signal?: AbortSignal}} [o]
 * @returns {Promise<{code: number|null, stdout: string, stderr: string, error?: Error}>} `error` when the command did not
 *   run to an exit code (ENOENT, a timeout); `code` is its exit code, null then
 */
export function execCheck(file, args, { spec = {}, timeoutMs = 10000, maxBuffer = 4 * 1024 * 1024, cwd, signal } = {}) {
  const { env } = childEnv({ kind: 'preflight', ...spec });
  return new Promise((done) => {
    try {
      execFile(file, args, { env, timeout: timeoutMs, maxBuffer, windowsHide: true, ...(cwd ? { cwd } : {}), ...(signal ? { signal, killSignal: 'SIGKILL' } : {}) }, (err, stdout, stderr) => {
        const out = { code: err ? (typeof err.code === 'number' ? err.code : null) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') };
        done(err && typeof err.code !== 'number' ? { ...out, error: err } : out);
      });
    } catch (err) { done({ code: null, stdout: '', stderr: '', error: err }); }
  });
}

/**
 * A one-shot command worca runs for itself (a probe, a build helper), to completion: `file args` with no shell, its
 * stdout and stderr captured, killed with SIGKILL at `timeoutMs`. The env is `childEnv(spec)` when `spec` is given,
 * else `env` (default: this process's env; a caller that hands a child its own env decides that here). `signal` kills it
 * early (SIGKILL). Never rejects.
 * @returns {Promise<{code: number|null, stdout: string, stderr: string, timedOut: boolean, error?: Error}>}
 */
export function runCapture(file, args, { spec = null, env = undefined, cwd, timeoutMs = 30000, maxBuffer = 16 * 1024 * 1024, input = null, signal } = {}) {
  const childEnvOf = spec ? childEnv({ kind: 'preflight', ...spec }).env : (env ?? process.env);
  return new Promise((done) => {
    let child;
    try {
      child = execFile(file, args, { env: childEnvOf, cwd, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer, windowsHide: true, ...(signal ? { signal } : {}) },
        (err, stdout, stderr) => {
          const timedOut = !!err?.killed && err?.signal === 'SIGKILL';
          const out = { code: err ? (typeof err.code === 'number' ? err.code : null) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), timedOut };
          done(err && typeof err.code !== 'number' ? { ...out, error: err } : out);
        });
    } catch (err) { done({ code: null, stdout: '', stderr: '', timedOut: false, error: err }); return; }
    if (input != null && child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}

export function safeEmit(onEvent, e) {
  try {
    onEvent(e);
  } catch {
    /* listener errors must not break the stream */
  }
}

// Group kill (plans/core-protection-layer-design.md §4.1 item 2): on POSIX every local child leads its own process
// group. Windows has no process groups (child.kill only).
const GROUP_KILL = process.platform !== 'win32';
/**
 * `signal` to the process group `pid` leads, else `fallback(signal)` (the child alone: Windows, a pid that leads no
 * group, a group already gone). The one group signal of every supervisor (superviseSpawn, the script runner's tree
 * kill, the terminal); never throws. True when the group took it.
 */
export function signalProcessGroup(pid, signal, fallback = () => {}) {
  if (GROUP_KILL && typeof pid === 'number' && pid > 0) {
    try { process.kill(-pid, signal); return true; } catch { /* gone, or never a leader: the child alone */ }
  }
  try { fallback(signal); } catch { /* gone */ }
  return false;
}
/** `signal` to the child's process group (`group`), else to the child. */
function signalGroup(child, signal, group) {
  if (group) signalProcessGroup(child.pid, signal, (s) => child.kill(s));
  else { try { child.kill(signal); } catch { /* ignore */ } }
}
/** Whether a process group `pid` exists: a member answers signal 0 (EPERM: one of another user's, an agent user's). */
function groupExists(pid) {
  try { process.kill(-pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
/**
 * Whether `child`'s process group may still be signalled as the run's, at the SIGKILL escalation. Yes while the leader
 * is unreaped (no exit code yet: its pid, and so the group id, cannot be anyone else's). Once it is reaped, only when
 * the group still had members at that moment (`orphaned`, seen on 'exit') and no process holds the leader's pid now:
 * POSIX never hands out a pid while a group of that id exists, so a leader-less group that never emptied is still the
 * run's, while a group that emptied, or a pid held again, means the id may belong to someone else.
 */
function groupStillOwned(child, orphaned) {
  if (child.exitCode === null && child.signalCode === null) return true;
  if (!orphaned) return false;
  try { process.kill(child.pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; }
}
/** The process groups of the local children still supervised: a POSIX child leads its own group, so a terminal's
 *  Ctrl+C no longer reaches it, and a worca that exits first (the CLI's hard exit, a crash) must take them along.
 *  An 'exit' listener must be synchronous: process.kill is. A SIGKILLed worca cannot run it; nothing can. */
const liveGroups = new Set();
/** How often a group whose leader exited is sampled for members (a group seen empty is never signalled again). */
const GROUP_SAMPLE_MS = 1000;
process.on('exit', () => { for (const pid of liveGroups) { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } } });

// Cap for the stderr detail embedded in a non-zero-exit Error message. The
// audit trail and the UI error banner consume that message; an uncapped
// stderrBuf (hundreds of KB of MCP/retry chatter) must not ride into them when
// every stderr line was already streamed as its own warn event. Classification
// does NOT ride on the capped message: recovery markers are classified line-by-
// line as stderr streams (see rlErr) and stamped on the error as `errorClass`.
const STDERR_DETAIL_MAX = 2000;

/** End `route` (an opened relay route: {id}) on `execEnv` once its in-flight replies have ended, and book what it
 *  measured since the last take (a `spend` event). The one way a route is closed: superviseSpawn on every terminal
 *  path, an adapter for a route it opened but never spawned with (the guard test bans closing routes in engines/).
 *  Resolves when done; never rejects. */
export async function abandonRoute(execEnv, route, onEvent) {
  if (!execEnv?.closeRoute || !route) return;
  try { await execEnv.closeRoute(route.id, onEvent); } catch { /* the route is gone either way */ }
}

/**
 * Spawn one harness process and supervise it to the end. Resolves with
 * `onDone(code)` on exit 0; rejects with an AbortError after an abort, with
 * `spawnError(err, prefix)` when the process cannot start, and otherwise with
 * `"<displayBin> exited with code N: <detail>"` carrying `errorClass` (and
 * `stream:'err'` when the detail came from stderr).
 * @param {object} o
 * @param {string} o.file                          the resolved executable
 * @param {string[]} o.args
 * @param {string} o.displayBin                    the name used in error messages (the caller's `bin`)
 * @param {string} o.cwd
 * @param {Record<string,string>} o.env           required (childEnv): a child never inherits worca's env by default
 * @param {string|null} o.stdin                    written then closed when non-null
 * @param {AbortSignal} [o.signal]
 * @param {boolean} [o.asAgent]                    run as WORCA_AGENT_USER when configured
 * @param {string|{dir:string, writable?:boolean}|Array|null} [o.stagedDir]  shared with the agent user before spawn
 *                                                  (agent-user.mjs shareWithAgent)
 * @param {((id:object) => string)|null} [o.agentHome] the HOME an agent spawn runs with instead of the agent's own
 * @param {() => void} o.cleanup                   called exactly once on every terminal path
 * @param {(e:object) => void} o.onEvent
 * @param {(line:string) => void|Error} o.onStdoutLine each non-empty trimmed stdout line; returning an Error
 *   terminates the process and rejects with that error after the child closes
 * @param {() => string} o.stdoutErrorDetail       the error text the adapter saw on stdout
 * @param {(msg:string) => string|null} o.classify the engine's classifyError
 * @param {((text:string) => string)|null} [o.redactText] the adapter's secret redactor: applied to each
 *   buffered stderr line and to the exit detail before the tail cut, which could leave a piece of a secret
 *   that no value matches
 * @param {(line:string) => void} [o.onStderrLine] each raw stderr line, before it is classified or streamed (an
 *   adapter that must stop the child on a line, e.g. Gemini CLI reporting that it ignored worca's policy file)
 * @param {(line:string) => boolean} [o.isBenignStderr] the engine's known-benign stderr notices:
 *   still streamed, but never classified and never the exit detail while other evidence exists
 * @param {(err:Error, prefix:string) => Error} o.spawnError
 * @param {(code:number) => any} o.onDone
 * @param {object|null} [o.execEnv]               a remote execution environment (src/core/exec-env/): when set,
 *   the command runs in its sandbox through a child-like handle (no host pid, stdin as a file); null on local runs
 * @param {{id:string}|null} [o.route]            the spawn's model route on `execEnv`'s relay: closed on every terminal
 *   path (abandonRoute), before `cleanup` and before the promise settles
 * @param {(() => boolean)|null} [o.turnOver]     whether the engine's turn is over for good (its final frame seen and
 *   nothing it launched still pending), asked after each stdout line. leftoverGraceMs() after it first says yes (one
 *   deadline: later lines do not move it, so a leftover that keeps printing cannot hold it off; a no again clears it),
 *   what the step left running is group-killed (R15): a background child holding the step's stdout, or the engine
 *   itself kept alive by one. The spawn then settles as the engine's own exit says. An engine the kill itself ended
 *   (no exit code of its own) failed: it was still running after its turn. null: never.
 */
export function superviseSpawn(o) {
  const { file, args, displayBin, cwd, env, stdin, signal, asAgent, stagedDir, agentHome = null, cleanup, onEvent,
    onStdoutLine, onStderrLine = null, stdoutErrorDetail, classify, isBenignStderr = () => false, redactText = null, spawnError, onDone, execEnv = null,
    route = null, turnOver = null } = o;
  if (!env || typeof env !== 'object') throw new Error(`superviseSpawn ${displayBin}: env is required (build it with childEnv)`);
  const remote = execEnv?.remote ? execEnv : null;
  return new Promise((resolveP, rejectP) => {
    let childEnv = env;
    // Agent isolation (agent-user.mjs): the same command under the agent's uid, via sudo, in its
    // own process group so a stuck agent can still be SIGKILLed through sudo.
    // Agent isolation applies on THIS host only; inside a sandbox there is no sudo pool.
    const agentId = asAgent && !remote ? agentIdentityFor(currentOwner()) : null;   // the owner's pool user (agent-pool.mjs)
    let child;
    try {
      let exe = file;
      let argv = args;
      if (agentId) {
        // Every folder the server staged for this spawn, opened to the agent's group up to worca's tmp.
        // A `{dir, writable}` entry is one the agent also writes into (Copilot's usage file).
        for (const d of [stagedDir].flat()) if (d) shareWithAgent(typeof d === 'string' ? d : d.dir, agentId, { stopAt: join(worcaHome(), 'tmp'), writable: typeof d === 'object' && d.writable === true });
        ({ file: exe, args: argv, env: childEnv } = agentSpawn(file, args, childEnv, agentId, agentHome ? { home: agentHome(agentId) } : {}));
      }
      // A local POSIX child leads its own process group, so a stop reaches the tool shells, dev servers and MCP
      // servers it started (onAbort signals the group); the host-exit reaper below covers a worca that exits first.
      child = remote
        ? remote.spawn(exe, argv, { cwd, env: childEnv, stdin, uploads: [stagedDir].flat().filter(Boolean).map((d) => (typeof d === 'string' ? d : d.dir)) })
        : spawn(exe, argv, {
          cwd, stdio: [stdin != null ? 'pipe' : 'ignore', 'pipe', 'pipe'], env: childEnv,
          ...(agentId || GROUP_KILL ? { detached: true } : {}),
        });
    } catch (err) {
      abandonRoute(execEnv, route, onEvent).finally(() => { try { cleanup(); } finally { rejectP(spawnError(err, `Failed to spawn ${displayBin}`)); } });
      return;
    }
    if (stdin != null && child.stdin) {   // a remote child takes stdin as a file
      // A child that dies before draining stdin (bad flag, ENOENT surfaced
      // late) raises EPIPE here; the 'error'/'close' handlers own the real cause.
      child.stdin.on('error', () => {});
      child.stdin.end(stdin, 'utf8');
    }

    let stderrBuf = '';
    // Strongest recovery class seen across ALL stderr lines — classified at
    // receive time, so it survives both the rolling trim and the tail cap.
    let stderrClass = null;
    let stdoutFatalError = null;
    let settled = false;
    let killTimer = null;
    let terminationStarted = false;   // a stop (abort, a fatal line): once only
    // The leftover kill (R15): one deadline from the turn's end. `reaped`: it ran. Not a stop: a Stop, a pause or a
    // timeout after it still signals and escalates.
    let leftoverTimer = null;
    let reaped = false;

    const group = !remote && GROUP_KILL && typeof child.pid === 'number';
    if (group) liveGroups.add(child.pid);
    const leaderGone = () => child.exitCode !== null || child.signalCode !== null;
    // Whether the group outlived its leader (members left when it exited): the escalation's ownership check. Once the
    // group is seen empty its id may be anyone's, so it is never the step's again (R15-5): sampled each second after
    // the leader's exit, and again right before any signal.
    let orphaned = false;
    const forgetIfEmpty = () => {
      if (orphaned && leaderGone() && !groupExists(child.pid)) { orphaned = false; liveGroups.delete(child.pid); }
    };
    if (group) {
      child.once('exit', () => {
        orphaned = groupExists(child.pid);
        if (!orphaned) return;
        const watch = setInterval(() => { forgetIfEmpty(); if (!orphaned || !liveGroups.has(child.pid)) clearInterval(watch); }, GROUP_SAMPLE_MS);
        watch.unref?.();
      });
    }
    /** Whether the step's group may be signalled as its own now (groupStillOwned, after a fresh sample). */
    const ownsGroup = () => { if (!group || !liveGroups.has(child.pid)) return false; forgetIfEmpty(); return liveGroups.has(child.pid) && groupStillOwned(child, orphaned); };
    // Escalate if it ignores SIGTERM.
    const escalate = () => {
      if (killTimer) clearTimeout(killTimer);
      killTimer = setTimeout(() => {
        // Only a sudo still running holds the group: after it exits the pid may be reused.
        const stuck = !leaderGone();
        // The group may outlive its leader (a backgrounded grandchild), but never a reused group: it must still be this
        // child's (groupStillOwned). The leader alone only while it still runs.
        const owned = ownsGroup();
        if (owned) signalGroup(child, 'SIGKILL', true);
        else if (stuck) signalGroup(child, 'SIGKILL', false);
        // An agent's processes run under its own uid, which the server cannot signal: sudo kills them, also once sudo
        // itself has exited and only the group, still the step's, is left (R15-3).
        if (agentId && (stuck || owned)) killAgentGroup(child.pid, agentId);
      }, sigkillGraceMs()).unref?.();
    };
    const terminateChild = () => {
      if (terminationStarted) return;
      terminationStarted = true;
      if (leftoverTimer) clearTimeout(leftoverTimer);
      // The whole group: a backgrounded grandchild (`npm run dev &`) dies with the step. A remote child signals its
      // own group in the sandbox (remote-child.mjs: the line runs under `setsid`).
      signalGroup(child, 'SIGTERM', group);
      escalate();
    };
    // What the step left running after its turn ended (R15): the same TERM, grace, KILL as a stop, but the group is
    // signalled only while it is still the step's (ownsGroup: the leader may be gone, its group not), and the spawn
    // settles as the engine's exit says, not as an abort. A remote child signals its group in the sandbox without
    // marking itself stopped (remote-child.mjs reapGroup), so its command can end.
    const leftoverSeconds = () => Math.round(leftoverGraceMs() / 100) / 10;
    const reapLeftovers = () => {
      leftoverTimer = null;
      if (settled || terminationStarted || reaped || !turnOver()) return;
      reaped = true;
      safeEmit(onEvent, { type: 'stderr', stream: 'err', text: `[worca] ${displayBin}: the step is still running ${leftoverSeconds()}s after its result — stopping what it left behind` });
      if (remote) { child.reapGroup?.(); return; }
      if (ownsGroup()) signalGroup(child, 'SIGTERM', true);
      else if (!leaderGone()) signalGroup(child, 'SIGTERM', false);
      escalate();
    };
    // One deadline from the moment the turn is over (R15-2): a line after it never moves it, or a leftover printing
    // every few seconds would keep the step (and its relay route) open; a turn that opens again clears it.
    const armLeftoverKill = () => {
      if (settled || terminationStarted || reaped || !turnOver) return;
      if (!turnOver()) { if (leftoverTimer) clearTimeout(leftoverTimer); leftoverTimer = null; return; }
      if (leftoverTimer) return;
      leftoverTimer = setTimeout(reapLeftovers, leftoverGraceMs());
      leftoverTimer.unref?.();
    };
    const onAbort = () => terminateChild();
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      // Kept until the grace kill once a stop or the leftover kill started: the group may outlive its leader.
      if (group && !terminationStarted && !reaped) liveGroups.delete(child.pid);
      else if (group) setTimeout(() => liveGroups.delete(child.pid), sigkillGraceMs() + 50).unref?.();
      if (signal) signal.removeEventListener?.('abort', onAbort);
      if (leftoverTimer) clearTimeout(leftoverTimer);
      // A group's escalation outlives its leader's exit (above); a lone child's ends with it.
      if (killTimer && !group) clearTimeout(killTimer);
      // The spawn's model route (relay): closed on every terminal path, before the adapter's cleanup and before the
      // promise settles, so what the relay measured after the last result is booked whatever way the spawn ended
      // (plans/core-protection-layer-design.md §4.3), and before the adapter emits anything after the spawn.
      abandonRoute(execEnv, route, onEvent).finally(() => { try { cleanup(); } finally { fn(arg); } });
    };

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed || stdoutFatalError) return;
      const fatal = onStdoutLine(trimmed);
      if (fatal instanceof Error) {
        stdoutFatalError = fatal;
        terminateChild();
        return;
      }
      armLeftoverKill();
    });

    // stderr is a FIRST-CLASS log stream, not just failure evidence. The CLI puts
    // retry/throttle notices (429/529), MCP server chatter, and runtime warnings
    // here on runs that go on to succeed — all of it was previously discarded,
    // since stderrBuf is only read on the non-zero-exit path below.
    //
    // Framed with the SAME readline as stdout: readline decodes through an
    // internal StringDecoder (a multi-byte character split across pipe chunks
    // survives) and treats a lone \r as a line break, so CR-rewriting progress
    // output surfaces live instead of accumulating until exit. Each line is
    // emitted at receive time — the closest available proxy for event time.
    // `stream:'err'` tags the origin channel; the orchestrator decides the level.
    const rlErr = createInterface({ input: child.stderr });
    rlErr.on('line', (line) => {
      if (onStderrLine) onStderrLine(line);
      // Classify BEFORE buffering: the class must see every line ever printed —
      // an early 401 or session-limit notice followed by hundreds of KB of MCP
      // chatter would otherwise scroll past both the trim and the tail cap.
      if (!isBenignStderr(line)) stderrClass = strongestClass(stderrClass, classify(line));
      // MCP registry §5.5.3: redacted line by line, before the trims below can cut a secret in two.
      stderrBuf += (redactText ? redactText(line) : line) + '\n';        // still the source of the exit-code detail
      // Rolling tail: bound memory against chatty MCP servers. Trim at 4x the
      // cap down to 2x — amortized, and the kept tail always exceeds
      // STDERR_DETAIL_MAX so the close handler's `… ` marker still fires.
      if (stderrBuf.length > STDERR_DETAIL_MAX * 4) stderrBuf = stderrBuf.slice(-STDERR_DETAIL_MAX * 2);
      const text = line.trim();
      // A pause/stop SIGTERMs the child: whatever it writes while dying (and the
      // torn fragment readline flushes at stream end) is not run output.
      if (text && !signal?.aborted && !stdoutFatalError && !reaped) safeEmit(onEvent, { type: 'stderr', stream: 'err', text });
    });

    child.on('error', (err) => {
      finish(rejectP, spawnError(err, `${displayBin} error`));
    });

    child.on('close', (code) => {
      rl.close();
      rlErr.close(); // readline already flushed its final unterminated line when the stream ended
      if (signal?.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        finish(rejectP, err);
        return;
      }
      if (stdoutFatalError) {
        finish(rejectP, stdoutFatalError);
        return;
      }
      // An engine the leftover kill itself ended (no exit code of its own) was still running after its turn: never a
      // success (R15-1). One that had exited on its own keeps its own code.
      if (reaped && code === null) {
        const err = new Error(`${displayBin} was still running ${leftoverSeconds()}s after its result and was stopped`);
        err.errorClass = classify(stdoutErrorDetail() || err.message);
        finish(rejectP, err);
        return;
      }
      if (code !== 0) {
        // Benign notices are not evidence (isBenignStderr): stderr feeds the
        // detail only when something else is left, else the stream's own error
        // wins. A notice alone still beats the opaque "no stderr".
        const fromStderr = stderrBuf.split('\n').filter((l) => !isBenignStderr(l)).join('\n').trim();
        const streamDetail = stdoutErrorDetail();
        const found = fromStderr || streamDetail || stderrBuf.trim() || 'no stderr';
        // Redacted before the tail cut below, which could leave a piece of a secret that no value matches (§5.5.3).
        const raw = redactText ? redactText(found) : found;
        // Tail, not head: the terminal cause sits at the END of a long stderr.
        const detail = raw.length > STDERR_DETAIL_MAX ? `… ${raw.slice(-STDERR_DETAIL_MAX)}` : raw;
        const err = new Error(`${displayBin} exited with code ${code}: ${detail}`);
        // The recovery class, judged on the FULL evidence: the per-line stream
        // class when stderr fed the detail, else the (already fully in-memory)
        // stdout errorDetail. classifyError() returns this stamp verbatim, so
        // the tail cap above can never starve recovery — or flip an early auth
        // failure into 'network' because connection chatter filled the tail.
        // A stream-borne API error (a 429 in the result) counts even when real
        // stderr chatter fed the message.
        err.errorClass = fromStderr
          ? strongestClass(stderrClass, streamDetail ? classify(streamDetail) : null)
          : classify(raw);
        // Mark the origin channel so the orchestrator can tag its `error` log
        // line with stream:'err' without sniffing the message. Absent when the
        // detail came from the stdout `result` envelope (the common case — see
        // the errorDetail comment above), which is not an stderr line.
        if (fromStderr) err.stream = 'err';
        finish(rejectP, err);
        return;
      }
      finish(resolveP, onDone(code ?? 0));
    });
  });
}

/** `p` with symlinks resolved as far as it exists (a writable root may not be created yet). */
function realPathOf(p) {
  let head = resolve(p); const rest = [];
  for (;;) {
    try { return join(realpathSync(head), ...rest); } catch { /* not there yet: try its parent */ }
    const up = dirname(head);
    if (up === head) return resolve(p);
    rest.unshift(basename(head)); head = up;
  }
}

/**
 * The paths that would make Worca's own state writable to a non-Claude spawn. Worca's deny rules for its home (the
 * database, settings.json, the MCP registry, plugin secrets, plugins / scripts / agents / workflows / policy) are
 * path rules codex and copilot cannot hold, so the folders they may write must not reach them: a writable root inside Worca's
 * home is allowed only inside the run store (`store/…`, a node's outputs, pipeline dir and memory copy) or a run's
 * own folder (`runs/<id>/…`, a detached run's checkout), and no root or cwd may contain the home. PURE over the fs.
 * @param {{cwd?:string, roots?:string[], home?:string}} o
 * @returns {string[]} the offending paths as given
 */
export function writableRootsInWorcaHome({ cwd, roots = [], home = worcaHome() } = {}) {
  const h = realPathOf(home);
  const allowed = [join(h, 'store'), join(h, 'runs')];
  const bad = [];
  for (const r of roots) {
    if (typeof r !== 'string' || !r) continue;
    const p = realPathOf(r);
    // A root that holds the home, or one inside it that is not strictly inside the store or a run's folder.
    if (isWithin(h, p) || (isWithin(p, h) && !allowed.some((a) => p !== a && isWithin(p, a)))) bad.push(r);
  }
  if (typeof cwd === 'string' && cwd && isWithin(h, realPathOf(cwd))) bad.unshift(cwd);   // the cwd is writable too
  return bad;
}
