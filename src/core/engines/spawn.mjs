// src/core/engines/spawn.mjs
// Engine-agnostic process supervision for every harness adapter: spawn (as the
// agent user when asked), line framing of stdout/stderr, abort -> SIGTERM ->
// grace -> SIGKILL, staged-file cleanup, the scrubbed spawn env. What a stdout
// line MEANS is the adapter's business (onStdoutLine); this module never parses one.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { strongestClass } from '../recoverable-error.mjs';
import { stripGithubCredentials } from '../github-credentials.mjs';
import { agentSpawn, killAgentGroup, shareWithAgent } from '../agent-user.mjs';
import { agentIdentityFor } from '../agent-pool.mjs';
import { currentOwner } from '../billing.mjs';
import { isReservedModelEnvKey } from '../model-env.mjs';

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
const SPAWN_ENV_BASE = [
  'PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'USER', 'LOGNAME', 'TERM',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
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

/**
 * The final child env, in the order the claude runner always applied it: the
 * scrubbed env (undefined when scrub is off -> process.env), the run-level env
 * (cleanRunEnv) over it, the adapter's overlay (the model env) merged LAST so it
 * survives scrub and wins collisions, WORCA_HOST_PID after that, no GitHub
 * credential in any tier, and never the credential broker's own secret. With
 * no run env and no overlay the env is byte-identical to the scrub result.
 * @returns {{env: Record<string,string>, scrubbed: boolean}}
 */
export function composeSpawnEnv({ envScrub, envAllowlist, prefixes, runEnv, overlay, hostPid } = {}) {
  const scrubbedEnv = buildSpawnEnv(envScrub, envAllowlist, prefixes);
  let env = scrubbedEnv;
  if (runEnv) env = { ...(env ?? process.env), ...runEnv };
  if (overlay) env = { ...(env ?? process.env), ...overlay };
  if (hostPid != null) env = { ...(env ?? process.env), WORCA_HOST_PID: String(hostPid) };
  env = stripGithubCredentials(env ?? process.env);
  delete env.WORCA_BROKER_SECRET;
  delete env.WORCA_BROKER_SECRET_FILE;
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
 * @param {Record<string,string>|undefined} o.env  undefined => inherit process.env
 * @param {string|null} o.stdin                    written then closed when non-null
 * @param {AbortSignal} [o.signal]
 * @param {boolean} [o.asAgent]                    run as WORCA_AGENT_USER when configured
 * @param {string|null} [o.stagedDir]              shared with the agent user before spawn
 * @param {() => void} o.cleanup                   called exactly once on every terminal path
 * @param {(e:object) => void} o.onEvent
 * @param {(line:string) => void} o.onStdoutLine   each non-empty trimmed stdout line
 * @param {() => string} o.stdoutErrorDetail       the error text the adapter saw on stdout
 * @param {(msg:string) => string|null} o.classify the engine's classifyError
 * @param {((text:string) => string)|null} [o.redactText] the adapter's secret redactor: applied to each
 *   buffered stderr line and to the exit detail before the tail cut, which could leave a piece of a secret
 *   that no value matches
 * @param {(line:string) => boolean} [o.isBenignStderr] the engine's known-benign stderr notices:
 *   still streamed, but never classified and never the exit detail while other evidence exists
 * @param {(err:Error, prefix:string) => Error} o.spawnError
 * @param {(code:number) => any} o.onDone
 */
export function superviseSpawn(o) {
  const { file, args, displayBin, cwd, env, stdin, signal, asAgent, stagedDir, cleanup, onEvent,
    onStdoutLine, stdoutErrorDetail, classify, isBenignStderr = () => false, redactText = null, spawnError, onDone } = o;
  return new Promise((resolveP, rejectP) => {
    let childEnv = env;
    // Agent isolation (agent-user.mjs): the same command under the agent's uid, via sudo, in its
    // own process group so a stuck agent can still be SIGKILLed through sudo.
    const agentId = asAgent ? agentIdentityFor(currentOwner()) : null;   // the owner's pool user (agent-pool.mjs)
    let child;
    try {
      let exe = file;
      let argv = args;
      if (agentId) {
        if (stagedDir) shareWithAgent(stagedDir, agentId);
        ({ file: exe, args: argv, env: childEnv } = agentSpawn(file, args, childEnv, agentId));
      }
      child = spawn(exe, argv, {
        cwd, stdio: [stdin != null ? 'pipe' : 'ignore', 'pipe', 'pipe'], ...(childEnv ? { env: childEnv } : {}),
        ...(agentId ? { detached: true } : {}),
      });
    } catch (err) {
      cleanup();
      rejectP(spawnError(err, `Failed to spawn ${displayBin}`));
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
    let settled = false;

    const onAbort = () => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      // Escalate if it ignores SIGTERM.
      setTimeout(() => {
        // Only a sudo still running holds the group: after it exits the pid may be reused.
        const stuck = child.exitCode === null && child.signalCode === null;
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        if (agentId && stuck) killAgentGroup(child.pid, agentId);
      }, sigkillGraceMs()).unref?.();
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener?.('abort', onAbort);
      cleanup();
      fn(arg);
    };

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed) onStdoutLine(trimmed);
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
      if (text && !signal?.aborted) safeEmit(onEvent, { type: 'stderr', stream: 'err', text });
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
