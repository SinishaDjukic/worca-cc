// src/core/engines/spawn.mjs
// Engine-agnostic process supervision for every harness adapter: spawn (as the
// agent user when asked), line framing of stdout/stderr, abort -> SIGTERM ->
// grace -> SIGKILL, staged-file cleanup, the scrubbed spawn env. What a stdout
// line MEANS is the adapter's business (onStdoutLine); this module never parses one.
import { spawn, spawnSync } from 'node:child_process';
import { resolveCliCommand, explainUnspawnableCli, GENERIC_CLI } from '../cli-resolve.mjs';
import { createInterface } from 'node:readline';
import { realpathSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { strongestClass } from '../recoverable-error.mjs';
import { stripHostCredentials } from '../host-credentials.mjs';
import { agentSpawn, killAgentGroup, shareWithAgent } from '../agent-user.mjs';
import { agentIdentityFor } from '../agent-pool.mjs';
import { currentOwner } from '../billing.mjs';
import { isReservedModelEnvKey } from '../model-env.mjs';
import { worcaHome } from '../projects.mjs';
import { agentGroupsDir, createGroupTracker } from '../agent-groups.mjs';
import { isWithin } from '../fs-scope.mjs';
import { withNoGitPath } from '../nogit-stub.mjs';
import { withoutProxyLogin } from '../env-proxy.mjs';
import { testWorkerCap } from '../settings.mjs';
import { sessionFor, spawnsRemotely } from '../executor/index.mjs';
import { abortError } from '../executor/shared.mjs';
import { createRemoteChild } from '../executor/remote-child.mjs';
import { DEFAULT_ENGINE_BINS, ENGINE_CLIS } from './cli-specs.mjs';

const ENGINE_BIN_NAMES = new Set(Object.values(DEFAULT_ENGINE_BINS));
const binName = (p) => String(p).split(/[\\/]/).pop().replace(/\.(exe|cmd|bat)$/i, '');   // either separator: a worker may report a Windows path

/**
 * Why `exe` cannot run on this worker, or null. A worker's hello lists the engine binaries its
 * image has (worker/capabilities.mjs); an engine binary absent from that list would only die
 * with ENOENT on the far side, so say so here, naming the fix. Anything that is not an engine
 * binary (sh, node, a script node's command) is not judged — the worker decides.
 */
export function missingOnWorker(session, exe) {
  const engines = session?.capabilities?.engines;
  if (!engines || typeof engines !== 'object') return null;
  const want = binName(exe);
  if (!ENGINE_BIN_NAMES.has(want)) return null;
  const present = Object.values(engines).filter(Boolean).map((c) => c?.bin && binName(c.bin)).filter(Boolean);
  if (present.includes(want)) return null;
  const engine = Object.entries(DEFAULT_ENGINE_BINS).find(([, b]) => b === want)?.[0] || want;
  const has = present.length ? `has ${present.join(', ')}` : 'reports no engine binary';
  return `worker ${session.workerId || '?'} has no ${want}: the ${engine} engine is not in its image (it ${has}). `
    + `Point the ${engine} worker image at one that ships it: WORCA_WORKER_IMAGE (Compose) or worker.engines.${engine}.image (Helm).`;
}

/** `a` is at least `b` (dotted numbers; a leading name such as `codex-cli ` and a pre-release tag are ignored, a part
 *  that is not a number counts as 0). The one compare for every engine's version floor, here and on a worker. */
export function versionAtLeast(a, b) {
  const n = (v) => String(v).replace(/^[^0-9]*/, '').split(/[.-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return true;
}
/** True when `have` is below `min`; a version that could not be read at all (null) is not judged. */
export function olderThan(have, min) {
  return have != null && min != null && !versionAtLeast(have, min);
}

/**
 * Why `exe` on this worker is too old for the spawn, or null. A chat's lockdown rests on flags and settings its
 * engine has only from some version on; the controller checks its own binary before a turn (chat-descriptor.mjs),
 * but under a remote executor the binary that runs is the worker image's, known by the version in its hello.
 */
export function tooOldOnWorker(session, exe, min, what = 'a chat', { below = null } = {}) {
  const engines = session?.capabilities?.engines;
  if ((!min && !below) || !engines || typeof engines !== 'object') return null;
  const want = binName(exe);
  const cap = Object.values(engines).find((c) => c?.bin && binName(c.bin) === want);
  if (!cap?.version) return null;
  const engine = Object.entries(DEFAULT_ENGINE_BINS).find(([, b]) => b === want)?.[0] || want;
  const fix = `WORCA_WORKER_IMAGE (Compose) or worker.engines.${engine}.image (Helm)`;
  if (min && olderThan(cap.version, min)) {
    return `worker ${session.workerId || '?'} has ${want} ${cap.version}: ${what} needs ${min} or newer. Point the ${engine} worker image at a newer one: ${fix}.`;
  }
  // A major the controller's own gate refuses (its lockdown is unverified there): the same answer for a worker's binary.
  if (below && versionAtLeast(cap.version, below)) {
    return `worker ${session.workerId || '?'} has ${want} ${cap.version}: ${what} is verified below ${below} only. Point the ${engine} worker image at one before ${below}: ${fix}.`;
  }
  return null;
}

// Grace between the abort SIGTERM and the SIGKILL escalation. Claude Code shuts
// down synchronously (fsync'd ~/.claude.json saves); a SIGKILL that lands inside
// such a write strands ~/.claude.json.tmp.<pid>.<hex> (2026-08-30: 2099 files,
// 4.4 GB, all from test runs under IO load). 5 s is generous on an idle disk
// (SIGTERM exits in ~0.5 s) and only delays a stop when the child is wedged.
export const DEFAULT_SIGKILL_GRACE_MS = 5000;
export function sigkillGraceMs() {
  const n = Number(process.env.WORCA_SIGKILL_GRACE_MS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SIGKILL_GRACE_MS;
}

// Base env a headless claude needs to function at all; everything else is
// withheld under scrub. ANTHROPIC_*/CLAUDE_* prefixes carry the CLI's own auth
// and configuration and MUST survive, or every scrubbed run would fail auth.
// The proxy / CA vars are CONNECTIVITY config, not secrets: without them a
// scrubbed run behind a TLS-intercepting corporate proxy fails TLS on every
// spawn (the 2.1.220 binary reads all of them). Cloud-provider creds
// (AWS_*/GOOGLE_APPLICATION_CREDENTIALS/AZURE_*) are intentionally NOT here —
// a Bedrock/Vertex/Foundry deployment allowlists them per-project (documented).
export const SPAWN_ENV_BASE = [
  'PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'USER', 'LOGNAME', 'TERM',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  // Worca's corporate-proxy marker (proxy-credentials.mjs CORPORATE_PROXY_VAR; a test pins the value).
  'WORCA_CORPORATE_PROXY_URL',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  // The single-bundle CA names git, curl and Python Requests read (the container entrypoint sets them).
  'GIT_SSL_CAINFO', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE',
];

/**
 * The spawn env under guardrails. undefined when scrub is off — spawn() then
 * inherits process.env exactly as today. When on: base vars + every `ANTHROPIC_`-
 * and `CLAUDE_`-prefixed var + the per-project allowlist. (Do not rewrite those
 * prefixes with a `*` glob here — the resulting `*` + `/` would end this comment.)
 *
 * We deliberately do NOT set CLAUDE_CODE_SUBPROCESS_ENV_SCRUB. On CLI 2.1.220
 * (live-verified 2026-08-01) a truthy value forces the permission mode to
 * "default", overriding our `--permission-mode acceptEdits` (and, per static
 * analysis, forces a strict sandbox) — which would break scrubbed pipeline runs.
 * Do not reinstate it without re-verifying against the installed CLI.
 *
 * @param {boolean|undefined} envScrub
 * @param {string[]|undefined} envAllowlist
 * @param {string[]} [prefixes]  the engine's own env prefixes, kept under scrub (claude: ANTHROPIC_, CLAUDE_)
 * @returns {Record<string,string>|undefined}
 */
export function buildSpawnEnv(envScrub, envAllowlist, prefixes = ['ANTHROPIC_', 'CLAUDE_']) {
  if (!envScrub) return undefined;
  const allow = new Set(Array.isArray(envAllowlist) ? envAllowlist : []);
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (SPAWN_ENV_BASE.includes(k) || prefixes.some((p) => k.startsWith(p)) || allow.has(k)) {
      env[k] = v;
    }
  }
  return env;
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

/** The variable a scrubbed spawn carries to its worker (never to the child): what the scrub lets through, as a comma
 *  list of names and `PREFIX*` entries. The worker adds nothing of its own that is not on it (worker/exec.mjs). */
export const ENV_KEEP_VAR = 'WORCA_ENV_KEEP';
export function scrubKeepList(envAllowlist, prefixes = ['ANTHROPIC_', 'CLAUDE_']) {
  // An allowlist name is matched exactly here (buildSpawnEnv): one written as a glob matches nothing, and must not become a prefix on the worker.
  return [...prefixes.map((p) => `${p}*`), ...(Array.isArray(envAllowlist) ? envAllowlist : []).filter((n) => typeof n === 'string' && !n.includes('*'))].filter((n) => typeof n === 'string' && n && !n.includes(',')).join(',');
}

/**
 * The final child env, in the order the claude runner always applied it: the
 * scrubbed env (undefined when scrub is off -> process.env), the run-level env
 * (cleanRunEnv) over it, the adapter's overlay (the model env) merged LAST so it
 * survives scrub and wins collisions, WORCA_HOST_PID after that, no GitHub
 * or Azure DevOps credential in any tier (host-credentials.mjs), never the credential broker's own secret, and no
 * proxy URL that carries a login (env-proxy.mjs withoutProxyLogin: the corporate proxy is off then, so the child
 * goes direct rather than get the password), and WORCA_TEST_CONCURRENCY (testWorkerCap) unless set. With
 * no run env and no overlay the env is otherwise identical to the scrub result.
 * @returns {{env: Record<string,string>, scrubbed: boolean}}
 */
export function composeSpawnEnv({ envScrub, envAllowlist, prefixes, runEnv, overlay, hostPid } = {}) {
  const scrubbedEnv = buildSpawnEnv(envScrub, envAllowlist, prefixes);
  let env = scrubbedEnv;
  if (runEnv) env = { ...(env ?? process.env), ...runEnv };
  if (overlay) env = { ...(env ?? process.env), ...overlay };
  if (hostPid != null) env = { ...(env ?? process.env), WORCA_HOST_PID: String(hostPid) };
  env = stripHostCredentials(env ?? process.env);
  delete env.WORCA_BROKER_SECRET;
  delete env.WORCA_BROKER_SECRET_FILE;
  env = withNoGitPath(withoutProxyLogin(env));
  // The per-run test-worker cap (Settings › Runs › Machine load): a test runner that reads it (this repo's
  // tools/test-run.mjs) leaves cores for the run's other work and for other runs. A value already set wins.
  if (!env.WORCA_TEST_CONCURRENCY) env = { ...env, WORCA_TEST_CONCURRENCY: String(testWorkerCap()) };
  // Scrubbed, and bound for a worker that holds credentials of its own: the scrub's rule rides along so it holds there too.
  if (scrubbedEnv && spawnsRemotely()) env = { ...env, [ENV_KEEP_VAR]: scrubKeepList(envAllowlist, prefixes) };
  return { env, scrubbed: !!scrubbedEnv };
}

export function safeEmit(onEvent, e) {
  try {
    onEvent(e);
  } catch {
    /* listener errors must not break the stream */
  }
}

// Cap for the stderr detail embedded in a non-zero-exit Error message. The
// audit trail and the UI error banner consume that message; an uncapped
// stderrBuf (hundreds of KB of MCP/retry chatter) must not ride into them when
// every stderr line was already streamed as its own warn event. Classification
// does NOT ride on the capped message: recovery markers are classified line-by-
// line as stderr streams (see rlErr) and stamped on the error as `errorClass`.
const STDERR_DETAIL_MAX = 2000;

// E3: every harness child leads its own process group on POSIX (`detached: true` = setsid), so a
// stop reaches the background jobs it started (a `run_in_background` test suite, a dev server), and
// whatever it leaves behind is reaped when it exits. A detached group no longer gets a terminal's
// Ctrl+C, so the groups still running are killed when the host exits (an 'exit' listener must be
// synchronous; a host that is SIGKILLed cannot run it). Windows has no groups: `taskkill /T` walks
// the tree while the root is alive.
// #1144: so the groups are also recorded on disk (agent-groups.mjs), and the next server boot reaps
// the ones a SIGKILLed host left running.
const liveGroups = new Set();
const groupRecord = createGroupTracker({ dir: () => agentGroupsDir(worcaHome()) });
const trackGroup = (pid, bin) => { liveGroups.add(pid); groupRecord.add(pid, { bin }); };
const untrackGroup = (pid) => { liveGroups.delete(pid); groupRecord.delete(pid); };
process.on('exit', () => {
  for (const pid of liveGroups) { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } }
  groupRecord.clear();
});

/** Signal a child's whole tree. The group id stays allocated while any member lives, so `-pid`
 *  only ever reaches our descendants; an empty group answers ESRCH. Never throws. */
export function signalTree(child, sig, { group = true, platform = process.platform } = {}) {
  if (!child) return;
  // A child on a worker (executor/remote-child.mjs): the worker signals the whole group itself.
  if (child.remote) { try { child.kill(sig); } catch { /* gone */ } return; }
  if (typeof child.pid !== 'number') return;
  if (platform === 'win32') {
    if (child.exitCode === null && child.signalCode === null) {
      try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* best effort */ }
    }
    try { child.kill(sig); } catch { /* gone */ }
    return;
  }
  if (group) { try { process.kill(-child.pid, sig); return; } catch { /* no group: the child alone */ } }
  try { child.kill(sig); } catch { /* gone */ }
}

/**
 * Spawn one harness process and supervise it to the end. Resolves with
 * `onDone(code)` on exit 0; rejects with an AbortError after an abort, with
 * `spawnError(err, prefix)` when the process cannot start, and otherwise with
 * `"<displayBin> exited with code N: <detail>"` carrying `errorClass` (and
 * `stream:'err'` when the detail came from stderr).
 * @param {object} o
 * @param {string} o.file                          the configured bin (an already-resolved absolute .exe is fine)
 * @param {object} [o.cli]                         the engine's CliSpec (cli-specs.mjs); `file` is resolved through it on Windows
 * @param {string[]} o.args
 * @param {string} o.displayBin                    the name used in error messages (the caller's `bin`)
 * @param {string} o.cwd
 * @param {Record<string,string>|undefined} o.env  undefined => inherit process.env
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
 * @param {string|null} [o.workerMinVersion] the lowest version of the engine's CLI this spawn may run on when it goes
 *   to a worker (a chat's lockdown floor): an older one in the worker image is refused before anything starts
 * @param {string|null} [o.workerBelowVersion] a version the engine's CLI must stay below (a major the lockdown is unverified on)
 * @param {string} [o.workerMinVersionFor] what needs the floor, for the refusal (default: 'a chat')
 */
const notedResolutions = new Set();
/** Log a shim substitution once per process: the same bin resolves on every spawn. */
function noteResolved(r) {
  if (!r?.note) return;
  const key = [r.bin, ...r.prefixArgs].join('|');
  if (notedResolutions.has(key)) return;
  notedResolutions.add(key);
  console.warn('[worca] ' + r.note);
}

/** The engine a spawn belongs to: its adapter's CLI spec, else its binary's name; null for anything else. */
export function engineOfSpawn({ cli, file } = {}) {
  for (const [name, spec] of Object.entries(ENGINE_CLIS)) if (spec === cli) return name;
  const bin = file ? binName(file) : null;
  return Object.entries(DEFAULT_ENGINE_BINS).find(([, b]) => b === bin)?.[0] ?? null;
}

/** An adapter's spawnError builds a fresh Error: the recovery class and the code of what it wraps ride along,
 *  so "no worker could start" (network) and "the worker image lacks this engine" (auth) pause instead of failing hard. */
export function carryClass(out, err) {
  if (out && err && typeof out === 'object') {
    if (err.errorClass && !out.errorClass) out.errorClass = err.errorClass;
    if (err.code && !out.code) out.code = err.code;
  }
  return out;
}

/** The pid the host-guard preamble names: this process's, or null when the spawn goes to a worker container. */
export function guardPid() {
  return spawnsRemotely() ? null : process.pid;
}

export function superviseSpawn(o) {
  // The executor seam (executor/index.mjs): a spawn inside a run or chat scope under a remote
  // executor runs on that scope's worker for its engine; everything else — the default — spawns here.
  if (!spawnsRemotely()) return superviseLocal(o);
  return sessionFor({ signal: o.signal, engine: engineOfSpawn(o) }).then(
    (session) => superviseLocal(o, session),
    (err) => {
      o.cleanup();
      if (err?.name === 'AbortError') throw err;   // stopped while its worker was starting: an abort, as after a spawn
      throw carryClass(o.spawnError(err, `Failed to start a worker for ${o.displayBin}`), err);
    },
  );
}

/**
 * The supervisor proper. With a `session` the child is a remote-child on that worker: no sudo
 * wrapper (the container is the isolation), no local process group, and the complete env is
 * sent explicitly (a remote exec never inherits this process's environment). Every other line
 * is the local path.
 */
function superviseLocal(o, session = null) {
  const { file, args, cli = GENERIC_CLI, displayBin, cwd, env, stdin, signal, asAgent, stagedDir, agentHome = null, cleanup, onEvent,
    onStdoutLine, onStderrLine = null, stdoutErrorDetail, classify, isBenignStderr = () => false, redactText = null, spawnError, onDone } = o;
  return new Promise((resolveP, rejectP) => {
    let childEnv = env;
    // ENOENT/EINVAL on a Windows script shim: say why (the same text the preflight shows).
    const withShimHint = (err) => {
      if (session || !err || !/^(ENOENT|EINVAL)$/.test(String(err.code))) return err;   // a worker's ENOENT is about the worker's image, not this filesystem
      let hint = null;
      try { hint = explainUnspawnableCli(file, cli); } catch { /* no hint */ }
      return hint ? Object.assign(new Error(`${err.message} — ${hint}`), { code: err.code }) : err;
    };
    // Agent isolation (agent-user.mjs): the same command under the agent's uid, via sudo, in its
    // own process group so a stuck agent can still be SIGKILLed through sudo.
    const agentId = asAgent && !session ? agentIdentityFor(currentOwner()) : null;   // the owner's pool user (agent-pool.mjs)
    // E3: our own process group (POSIX). The agent user's sudo spawn already has one (killAgentGroup);
    // a worker owns its children's groups.
    const ownGroup = !session && !agentId && process.platform !== 'win32';
    let child;
    try {
      const cmd = resolveCliCommand(file, args, cli);
      let exe = cmd.file;
      let argv = cmd.args;
      noteResolved(cmd.resolved);
      if (agentId) {
        // Every folder the server staged for this spawn, opened to the agent's group up to worca's tmp.
        // A `{dir, writable}` entry is one the agent also writes into (Copilot's usage file).
        for (const d of [stagedDir].flat()) if (d) shareWithAgent(typeof d === 'string' ? d : d.dir, agentId, { stopAt: join(worcaHome(), 'tmp'), writable: typeof d === 'object' && d.writable === true });
        ({ file: exe, args: argv, env: childEnv } = agentSpawn(exe, argv, childEnv, agentId, agentHome ? { home: agentHome(agentId) } : {}));
      }
      if (session) {
        const missing = missingOnWorker(session, exe);
        if (missing) throw Object.assign(new Error(missing), { code: 'EWORKERNOBIN', errorClass: 'auth' });
        const old = tooOldOnWorker(session, exe, o.workerMinVersion, o.workerMinVersionFor || 'a chat', { below: o.workerBelowVersion ?? null });
        if (old) throw Object.assign(new Error(old), { code: 'EWORKEROLDBIN', errorClass: 'auth' });
      }
      child = session
        ? createRemoteChild(session, { file: exe, args: argv, cwd, env: childEnv ?? composeSpawnEnv({}).env, stdin, displayBin, reap: true })   // no env given: this process's, minus what no spawn may carry (never raw across the boundary)
        : spawn(exe, argv, {
          cwd, stdio: [stdin != null ? 'pipe' : 'ignore', 'pipe', 'pipe'], ...(childEnv ? { env: childEnv } : {}),
          ...(agentId || ownGroup ? { detached: true } : {}),
          windowsHide: true,
        });
      if (ownGroup && typeof child.pid === 'number') trackGroup(child.pid, displayBin);
    } catch (err) {
      cleanup();
      rejectP(carryClass(spawnError(withShimHint(err), `Failed to spawn ${displayBin}`), err));
      return;
    }
    if (stdin != null) {
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
    let terminationStarted = false;

    const terminateChild = () => {
      if (terminationStarted) return;
      terminationStarted = true;
      signalTree(child, 'SIGTERM', { group: ownGroup });
      // Escalate if it ignores SIGTERM. Our own group is killed whole even once the leader exited:
      // a background job that ignored SIGTERM still holds the group id, so `-pid` reaches only it.
      killTimer = setTimeout(() => {
        // Only a sudo still running holds the agent's group: after it exits the pid may be reused.
        const stuck = child.exitCode === null && child.signalCode === null;
        if (ownGroup) { signalTree(child, 'SIGKILL'); return; }
        if (!stuck) return;
        signalTree(child, 'SIGKILL', { group: false });
        if (agentId && stuck) killAgentGroup(child.pid, agentId);
      }, sigkillGraceMs()).unref?.();
    };
    const onAbort = () => terminateChild();
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener?.('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
      // E3: reap what the agent left running in its group (a forgotten background job). ESRCH when nothing is left.
      if (ownGroup && typeof child?.pid === 'number') { signalTree(child, 'SIGKILL'); untrackGroup(child.pid); }
      cleanup();
      fn(arg);
    };

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed || stdoutFatalError) return;
      const fatal = onStdoutLine(trimmed);
      if (fatal instanceof Error) {
        stdoutFatalError = fatal;
        terminateChild();
      }
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
      if (text && !signal?.aborted && !stdoutFatalError) safeEmit(onEvent, { type: 'stderr', stream: 'err', text });
    });

    child.on('error', (err) => {
      // A lost worker arrives here pre-classified (remote-child.mjs); an adapter's spawnError that
      // builds a fresh Error must not drop the class the failure policy acts on, nor the code.
      finish(rejectP, carryClass(spawnError(withShimHint(err), `${displayBin} error`), err));
    });

    child.on('close', (code) => {
      rl.close();
      rlErr.close(); // readline already flushed its final unterminated line when the stream ended
      if (signal?.aborted) {
        finish(rejectP, abortError());
        return;
      }
      if (stdoutFatalError) {
        finish(rejectP, stdoutFatalError);
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
