// src/core/graph/script-runner.mjs
// The script executor (spec §4–§6): spawn the program as a child process, hand it
// the bound input paths and the allocated output paths in ONE JSON envelope, read
// ONE JSON frame back, materialize outputs, write the verdict. Two runtimes:
//   node  — process.execPath script-child.mjs <file>, envelope on stdin (§5.1)
//   shell — /bin/sh -c | cmd.exe /d /s /c, envelope as WORCA_* env, output captured (§5.2)
// Cost is $0; the result is repeatable; every error thrown here carries
// errorClass:null (D9) so the node site's '*' row applies — pause, resumable —
// and a 10-minute test suite is never "retried as network".
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockEnabled, buildSpawnEnv } from '../claude-runner.mjs';
import { scrubbedEnv } from '../plugin-shim.mjs';            // PATH/HOME + the Windows start-up baseline (P11); no cycle: plugin-shim imports no graph module
import { normalizeReview } from '../protocol.mjs';
import { readVerdict, missingVerdictWarning } from './exec-io.mjs';
import { AWAIT_PORT, PARAMS_PORT } from '../../shared/graph/constants.mjs';
import { DEFAULT_EXIT_CODES, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, SCRIPT_RUNTIMES, pythonMissingSentence, overlayWiredParams } from '../../shared/graph/script-meta.mjs';
import { probePython } from './python-probe.mjs';
import { stripGithubCredentials } from '../github-credentials.mjs';

const CHILD_PATH = fileURLToPath(new URL('./script-child.mjs', import.meta.url));
/** The `python` harness (workbench spec §7), spawned as `<python> -u worca_script.py <program.py>`. */
const PY_HARNESS_PATH = fileURLToPath(new URL('./worca_script.py', import.meta.url));
/** Forced on every python spawn: a Windows console defaults to cp1252 and would corrupt the frame. */
const PY_ENV = Object.freeze({ PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });
const AWAIT_ID = AWAIT_PORT.id;
/** The three server-side variables a script must not inherit (D11). */
const STRIPPED_ENV = new Set(['WORCA_HOME', 'WORCA_RUN_ROOT', 'WORCA_HOST_PID']);
export const CAPTURE_HEAD = 256 * 1024;
export const CAPTURE_TAIL = 768 * 1024;
/** v4 T1 — three bounds on what ONE child can push into the host. MEASURED before they existed: 600 MiB of
 *  newline-free output kept the host's event loop at 100 % CPU for the whole 120 s timeout (the partial-line
 *  buffer was re-scanned from its start on every chunk — quadratic), and every streamed line is persisted by
 *  the run's log writer with no ceiling at all.
 *  MAX_LINE: a newline-free run is cut into lines of this many characters, so the buffer never holds more.
 *  STREAM_MAX: the live-log budget of one execution; past it ONE marker line is emitted and streaming stops
 *    (the capture — head + tail, the report — is unaffected).
 *  FRAME_MAX: the node runtime's stdout is the result frame and nothing else. */
export const MAX_LINE = 64 * 1024;
export const STREAM_MAX = 4 * 1024 * 1024;
export const FRAME_MAX = 8 * 1024 * 1024;
const SUMMARY_MAX = 2048;
const VALUE_INLINE_MAX = 64 * 1024;
const TAIL_LINES = 20;

/** Every error the runner throws: never classified recoverable (D9). */
function scriptError(message, extra = {}) {
  return Object.assign(new Error(message), { errorClass: null, ...extra });
}
function abortError() {
  return Object.assign(new Error('aborted'), { name: 'AbortError' });
}
const lastLines = (text, n) => String(text || '').trimEnd().split('\n').slice(-n).join('\n');
const secs = (ms) => (Math.round((ms || 0) / 100) / 10).toFixed(1);
const upperSnake = (id) => String(id).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

// ── pure ───────────────────────────────────────────────────────────────────────

/** `<pipelineDir>/scripts/<nodeId>-c<ordinal>[-<slice>].envelope.json` — no colons (Windows). */
export function envelopeAuditPath(ctx) {
  const slice = ctx.slice?.id ? `-${ctx.slice.id}` : '';
  return join(ctx.pipelineDir, 'scripts', `${ctx.node.id}-c${ctx.ordinal ?? 1}${slice}.envelope.json`);
}

/** The envelope (§4.1): BOUND inputs only (never the synthesized await), every
 *  declared output with its allocated path, the params, the run context. */
export function buildEnvelope(ctx) {
  const { node, ordinal = 1 } = ctx;
  const ports = ctx.ports || {};
  const bindings = ctx.bindings || {};
  const outputs = ctx.outputs || {};
  const script = ctx.script || {};
  const fresh = new Set(Array.isArray(ctx.trigger?.freshPorts) ? ctx.trigger.freshPorts : Object.keys(bindings));
  const inputs = {};
  for (const p of ports.inputs || []) {
    if (!p || p.id === AWAIT_ID || p.synthetic) continue;
    if (script.paramsPort && p.id === PARAMS_PORT.id) continue;   // the engine's, not the program's: its json is already IN `params`
    const token = bindings[p.id];
    if (!token) continue;
    inputs[p.id] = { type: p.type, path: p.type === 'void' ? null : (token.path ?? null), fresh: fresh.has(p.id) };
  }
  const outs = {};
  for (const p of ports.outputs || []) {
    if (!p) continue;
    outs[p.id] = { type: p.type, path: p.type === 'void' ? null : (outputs[p.id]?.path ?? null) };
  }
  const detached = Boolean(ctx.runRoot) && Boolean(ctx.workspace);
  const repos = detached && Array.isArray(ctx.repos) && ctx.repos.length
    ? ctx.repos.map((r) => ({ key: r.projectKey, dir: r.dir }))
    : null;
  return {
    apiVersion: 1,
    node: { id: node.id, key: node.key, displayName: script.meta?.displayName || node.key },
    execution: { id: ctx.executionId, ordinal },
    inputs,
    outputs: outs,
    verdictPath: ctx.verdict?.path ?? null,
    params: script.params || {},
    wiredParams: Array.isArray(ctx.wiredParams) ? ctx.wiredParams : [],   // ids a wire set (additive — apiVersion stays 1)
    ctx: {
      cwd: ctx.projectDir,                                   // the run's work dir (D12)
      pipelineDir: ctx.pipelineDir,
      projectDir: ctx.runCtx?.projectDir ?? ctx.projectDir,
      runRoot: ctx.runRoot ?? null,
      repos,
      checkpointRef: ctx.checkpointRef ?? null,
      baseName: ctx.runCtx?.baseName ?? null,
      runId: ctx.pipelineId ?? null,
      platform: process.platform,
      mock: Boolean(mockEnabled(ctx.claudeOpts)),
      // W12: true only on a test-bench execution, so a side-effect script ("post
      // a comment") can stay quiet under test. Additive — apiVersion stays 1.
      bench: Boolean(ctx.bench),
    },
  };
}

/** The child's environment (D11 + §4.3): the server's env minus WORCA_HOME /
 *  WORCA_RUN_ROOT / WORCA_HOST_PID, plus the envelope as WORCA_* variables. Both
 *  runtimes get it; the shell reads it, the node child gets the envelope on stdin too. */
export function envForShell(envelope, baseEnv = process.env) {
  const env = {};
  for (const [k, v] of Object.entries(baseEnv || {})) if (!STRIPPED_ENV.has(k) && v !== undefined) env[k] = v;
  for (const [id, p] of Object.entries(envelope.inputs || {})) env[`WORCA_IN_${upperSnake(id)}`] = p.path || '';
  for (const [id, p] of Object.entries(envelope.outputs || {})) if (p.path) env[`WORCA_OUT_${upperSnake(id)}`] = p.path;
  if (envelope.verdictPath) env.WORCA_VERDICT = envelope.verdictPath;
  for (const [id, v] of Object.entries(envelope.params || {})) {
    env[`WORCA_PARAM_${upperSnake(id)}`] = typeof v === 'boolean' ? String(v) : (v == null ? '' : String(v));
  }
  const c = envelope.ctx || {};
  env.WORCA_CWD = c.cwd || '';
  env.WORCA_PIPELINE_DIR = c.pipelineDir || '';
  env.WORCA_PROJECT_DIR = c.projectDir || '';
  env.WORCA_RUN_ROOT = c.runRoot || '';
  env.WORCA_CHECKPOINT_REF = c.checkpointRef || '';
  env.WORCA_CYCLE = String(envelope.execution?.ordinal ?? 1);
  env.WORCA_RUN_ID = c.runId || '';
  env.WORCA_PLATFORM = c.platform || process.platform;
  env.WORCA_MOCK = c.mock ? '1' : '0';
  // W12: set on a bench run, ABSENT on a pipeline run (a shell's `${WORCA_BENCH+set}`
  // must not see it) — and never inherited from a worca that is itself under test.
  if (c.bench) env.WORCA_BENCH = '1'; else delete env.WORCA_BENCH;
  return env;
}

/** The env a script child STARTS from (P11). With the run's env-scrub guardrail on it is
 *  what that run's agents get (buildSpawnEnv: base vars + the per-project allowlist) over
 *  the platform baseline a child needs to start at all (scrubbedEnv: PATH/HOME, and on
 *  Windows SYSTEMROOT/COMSPEC/PATHEXT/TEMP…) — a script never sees MORE of the host
 *  environment than the agents beside it. Scrub off: the server's env (D11). */
export function scriptBaseEnv(claudeOpts, platform = process.platform) {
  const scrubbed = buildSpawnEnv(claudeOpts?.envScrub, claudeOpts?.envAllowlist);
  // Never a GitHub credential, like the agents (src/core/github-credentials.mjs).
  return stripGithubCredentials(scrubbed ? { ...scrubbedEnv(platform), ...scrubbed } : process.env);
}

export function parseFrame(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, reason: 'no result frame' };
  let frame;
  try { frame = JSON.parse(raw); } catch { return { ok: false, reason: 'stdout is not JSON' }; }
  if (!frame || typeof frame !== 'object' || typeof frame.ok !== 'boolean') return { ok: false, reason: 'frame has no ok field' };
  return { ok: true, frame };
}

/** The md every unwritten md output of a shell script receives (§5.2). */
export function shellReport({ displayName, ordinal, command, exitCode, signal = null, timedOut = false, durationMs, platform, capture }) {
  const status = timedOut ? 'timed out' : signal ? `killed by ${signal}` : `Exit code: ${exitCode}`;
  const body = String(capture || '').replace(/\r\n/g, '\n');
  const fenced = body && !body.endsWith('\n') ? `${body}\n` : body;
  return `# ${displayName} — cycle ${ordinal}\n\nCommand: \`${command}\`\n${status} · ${secs(durationMs)} s · ${platform}\n\n\`\`\`text\n${fenced}\`\`\`\n`;
}

/** Head + tail capture with an omitted-bytes marker (§5.2: 1 MiB cap). Character counts. */
export function createCapture() {
  let head = '';
  let tail = '';
  let omitted = 0;
  return {
    push(chunk) {
      let rest = String(chunk);
      if (head.length < CAPTURE_HEAD) {
        const take = rest.slice(0, CAPTURE_HEAD - head.length);
        head += take;
        rest = rest.slice(take.length);
        if (!rest) return;
      }
      tail += rest;
      if (tail.length > CAPTURE_TAIL) {
        omitted += tail.length - CAPTURE_TAIL;
        tail = tail.slice(tail.length - CAPTURE_TAIL);
      }
    },
    text() {
      return omitted ? `${head}\n… ${omitted} bytes omitted …\n${tail}` : head + tail;
    },
  };
}

// ── fs / process ──────────────────────────────────────────────────────────────

/** Rule §4.2.2: a file on disk stands; else the frame's `value` is written; else an error. */
export async function materializeOutputs(ports, outputs, frame, key) {
  const tokens = {};
  for (const port of ports?.outputs || []) {
    if (!port) continue;
    if (port.type === 'void') { tokens[port.id] = {}; continue; }
    const path = outputs[port.id]?.path;
    if (!path) { tokens[port.id] = {}; continue; }
    if (!existsSync(path)) {
      const given = frame?.outputs?.[port.id];
      if (!given || given.value === undefined) throw scriptError(`script "${key}": output "${port.id}" was not written`);
      let text;
      if (port.type === 'json') text = JSON.stringify(given.value, null, 2) + '\n';
      else if (typeof given.value === 'string') text = given.value;
      else throw scriptError(`script "${key}": output "${port.id}" value must be a string for an md port`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text, 'utf8');
    }
    const token = { path };
    if (port.type === 'json' && statSync(path).size <= VALUE_INLINE_MAX) {
      try { token.value = JSON.parse(await readFile(path, 'utf8')); } catch { /* not JSON on disk: path only */ }
    }
    tokens[port.id] = token;
  }
  return tokens;
}

/** Kill a child and everything under it (§6.3). POSIX children are spawned
 *  detached (their own process group) so `-pid` reaches the tree; Windows
 *  `taskkill /T` walks the tree itself. Best effort, never throws.
 *
 *  v2 R5: there is NO early return once the direct child has exited. `sh -c "server &"`
 *  exits at once and leaves a grandchild holding our pipes — `'close'` never fires, and
 *  that grandchild is exactly what a timeout or a Stop has to reach. On POSIX the group
 *  id stays allocated for as long as the group has a member, so signalling `-pid` can
 *  only hit OUR descendants; a group that is already empty answers ESRCH, which is caught.
 *  spawnScript calls this only while the spawn is unsettled (i.e. before `'close'`). */
export function killTree(child, platform = process.platform) {
  if (!child || typeof child.pid !== 'number') return;
  if (platform === 'win32') {
    // taskkill /T needs the root alive to walk the tree; once it is gone there is nothing left to address.
    if (child.exitCode === null && child.signalCode === null) {
      try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* best effort */ }
      try { child.kill('SIGKILL'); } catch { /* gone */ }
    }
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
}

/** How long a killed spawn may keep its pipes before we stop waiting for `'close'`. */
const KILL_GRACE_MS = 2000;

/** v4 T4 — children still running, reaped when the HOST exits. POSIX script children lead their own process
 *  group (that is what makes the tree kill work), so a terminal's Ctrl+C never reaches them, and neither the
 *  server's shutdown nor the CLI's hard exit aborts the run first. MEASURED: a quiet child survived its host.
 *  An 'exit' listener must be synchronous — killTree is (process.kill; spawnSync taskkill on Windows). A host
 *  that is SIGKILLed cannot run it; nothing can. */
const live = new Map();   // ChildProcess -> platform
process.on('exit', () => { for (const [child, platform] of live) killTree(child, platform); });

/**
 * Spawn one child with a timeout, an abort signal, line streaming and the capped
 * capture. `stdoutMode: 'frame'` (node) keeps stdout whole for the frame and
 * streams stderr only; `'capture'` (shell) interleaves both into the capture.
 * Resolves `{ exitCode, signal, timedOut, aborted, stdout, frameOverflow, capture, durationMs }`;
 * rejects only on a spawn failure.
 */
export function spawnScript({ file, args, cwd, env, stdin = null, timeoutMs, signal, onLine, stdoutMode, platform = process.platform }) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(file, args, {
      cwd,
      env,
      detached: platform !== 'win32',
      windowsHide: true,
      windowsVerbatimArguments: platform === 'win32' && stdoutMode === 'capture',
      stdio: [stdin == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    live.set(child, platform);
    const capture = createCapture();
    const partial = { out: '', err: '' };
    let frameOut = '';
    let frameOverflow = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let streamed = 0;
    let streamCut = false;
    const line = (text) => {
      if (streamCut || !text.trim()) return;
      streamed += text.length;
      if (streamed > STREAM_MAX) {
        streamCut = true;
        onLine(`… live output cut after ${STREAM_MAX / (1024 * 1024)} MiB — the head and the tail are still captured`);
        return;
      }
      onLine(text);
    };
    const feed = (which, chunk) => {
      if (which === 'out' && stdoutMode === 'frame') {
        if (frameOut.length + chunk.length > FRAME_MAX) frameOverflow = true; else if (!frameOverflow) frameOut += chunk;
        return;
      }
      capture.push(chunk);
      // ONE pass per chunk: `partial` is always shorter than MAX_LINE, so this concat is O(chunk) and the scan
      // never revisits a character. (v3 searched the whole accumulated buffer on every chunk.)
      const text = partial[which] + chunk;
      let start = 0;
      let i;
      while ((i = text.indexOf('\n', start)) >= 0) { line(text.slice(start, i).replace(/\r$/, '')); start = i + 1; }
      while (text.length - start > MAX_LINE) { line(text.slice(start, start + MAX_LINE)); start += MAX_LINE; }
      partial[which] = text.slice(start);
    };
    const flush = () => {
      for (const w of ['out', 'err']) { const rest = partial[w]; partial[w] = ''; line(rest.replace(/\r$/, '')); }
    };
    // Kill, then stop WAITING (v2 R5): a descendant that escaped the group (setsid) or a Windows grandchild whose
    // root already died can keep stdout/stderr open forever. Destroying OUR ends of the pipes makes `'close'` fire,
    // so a timeout and a Stop always settle the execution even when something survives the kill.
    let grace = null;
    const killAndRelease = () => {
      killTree(child, platform);
      if (grace) return;
      grace = setTimeout(() => { try { child.stdout.destroy(); child.stderr.destroy(); } catch { /* already closed */ } }, KILL_GRACE_MS);
      grace.unref?.();
    };
    const timer = setTimeout(() => { timedOut = true; killAndRelease(); }, timeoutMs);
    const onAbort = () => { aborted = true; killAndRelease(); };
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      live.delete(child);
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(v);
    };
    child.stdout.setEncoding('utf8').on('data', (c) => feed('out', c));
    child.stderr.setEncoding('utf8').on('data', (c) => feed('err', c));
    child.on('error', (err) => done(reject, err));
    child.on('close', (code, sig) => {
      flush();
      done(resolve, { exitCode: code, signal: sig, timedOut, aborted, stdout: frameOut, frameOverflow, capture: capture.text(), durationMs: Date.now() - started });
    });
    if (stdin != null) {
      // v2 R5: a child that dies before it reads (a bad inherited NODE_OPTIONS, an OOM kill) turns this write into
      // EPIPE — an 'error' event on the stdin stream. With no listener that is an uncaught exception in the HOST
      // process. The failure itself is already reported through 'close' (no frame, exit N), so the event is dropped.
      child.stdin.on('error', () => {});
      child.stdin.end(stdin);
    }
  });
}

// ── the executor ──────────────────────────────────────────────────────────────

/** Mock (§6.6): write the declared outputs and verdict, spawn nothing. */
async function runMock({ key, meta, ports, outputs, verdict, mock }) {
  const declared = new Map((ports.outputs || []).filter(Boolean).map((p) => [p.id, p]));
  for (const [id, spec] of Object.entries(mock.outputs || {})) {
    const port = declared.get(id);
    if (!port || port.type === 'void') throw scriptError(`script "${key}": mock names output "${id}", which is not a declared non-void output`);
    const path = outputs[id]?.path;
    if (!path) continue;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, String(spec?.text ?? ''), 'utf8');
  }
  for (const port of declared.values()) {
    if (port.type === 'void') continue;
    const path = outputs[port.id]?.path;
    if (path && !existsSync(path)) throw scriptError(`script "${key}": mock leaves output "${port.id}" unwritten`);
  }
  let review = null;
  if (verdict?.path) {
    review = normalizeReview(mock.verdict || { issues: [] });
    await mkdir(dirname(verdict.path), { recursive: true });
    await writeFile(verdict.path, JSON.stringify(review, null, 2) + '\n', 'utf8');
  }
  const tokens = {};
  for (const port of declared.values()) { const path = outputs[port.id]?.path; tokens[port.id] = path ? { path } : {}; }
  return {
    summary: typeof mock.summary === 'string' && mock.summary ? mock.summary : `${meta.displayName || key} completed (mock).`,
    outputs: tokens, verdict: review,
  };
}

/** The effective shell command: the command-typed param, else `sh <file>`, else the sidecar's. */
function shellCommand(script, meta, platform) {
  const cmdParam = (meta.params || []).find((p) => p.type === 'command');
  const fromParam = cmdParam ? script.params?.[cmdParam.id] : undefined;
  if (typeof fromParam === 'string' && fromParam.trim()) return fromParam;
  // The registry stamps `file` as an absolute path inside its layer dir; quote it for the shell that will read it.
  // POSIX: single quotes, with an embedded ' closed-escaped-reopened — nothing else is special inside them.
  if (script.file) return platform === 'win32' ? `"${script.file}"` : `sh '${String(script.file).replace(/'/g, `'\\''`)}'`;
  return script.command || null;
}

/** The card's params with the engine `params` wire overlaid (D6–D8). No port: the card's own params.
 *  The token's inline `value` (a script producer's small JSON) wins; an agent's file is read from
 *  `path` — BOM stripped, capped like every inline value. Nothing bound (a loop wire is excused from
 *  the first-run barrier) is an EMPTY overlay, so a required param V22 deferred to the wire is still
 *  enforced. Every problem throws. */
export async function resolveWiredParams(ctx) {
  const script = ctx.script || {};
  const base = script.params || {};
  if (script.paramsPort !== true) return { params: base, wired: [] };
  const key = ctx.node?.key || script.meta?.key || ctx.node?.id;
  const refuse = (why) => scriptError(`script "${key}": wired params — ${why}`);
  const token = ctx.bindings?.[PARAMS_PORT.id];
  let value = token ? token.value : {};
  if (token && value == null) {
    if (!token.path) throw refuse('the wire carried no JSON');
    let text;
    try {
      if (statSync(token.path).size > VALUE_INLINE_MAX) throw refuse(`${token.path} is larger than ${VALUE_INLINE_MAX / 1024} KiB`);
      text = await readFile(token.path, 'utf8');
    } catch (err) {
      throw err?.errorClass === null ? err : refuse(`cannot read ${token.path}: ${err?.message || err}`);
    }
    try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (err) { throw refuse(`${token.path} is not valid JSON (${err?.message || err})`); }
  }
  const r = overlayWiredParams(script.meta || {}, base, value);
  if (r.errors.length) throw refuse(r.errors.join('; '));
  return { params: r.params, wired: r.wired };
}

/**
 * Run one script execution (spec §6.1). `ctx` is the orchestrator's execution
 * context with `ctx.script = { meta, runtime, file, command, params, paramsPort, timeoutMs, mock }`.
 * @returns {Promise<{summary:string, outputs:object, verdict:object|null, warnings:string[], sessionId:null, runtime:string, exitCode:number|null, durationMs:number, envelopePath:string|null}>}
 */
export async function runScriptExecution(ctx) {
  const { node, ordinal = 1 } = ctx;
  let script = ctx.script || {};
  const meta = script.meta || {};
  const key = node?.key || meta.key || node?.id;
  const ports = ctx.ports || {};
  const outputs = ctx.outputs || {};
  const verdict = ctx.verdict || null;
  const emit = typeof ctx.onEvent === 'function' ? ctx.onEvent : () => {};
  const platform = process.platform;
  const warnings = [];
  const started = Date.now();
  const resultEvent = (extra) => emit({ type: 'result', costUsd: 0, raw: { type: 'result', script: true, ...extra } });

  // D22 / v2 R6: every (re-)run of an execution starts from scratch. A resumed execution keeps its executionId, its
  // ordinal and therefore its PATHS, and rule §4.2.2 lets a file on disk stand — so the failed attempt's shell report
  // (written before the exit mapping throws) or a stale self-written verdict would otherwise be published as THIS
  // attempt's result. Only this execution's ALLOCATED paths are touched: never an input, never another cycle's file.
  const allocated = new Set(Object.values(outputs).map((o) => o?.path).filter(Boolean));
  if (verdict?.path) allocated.add(verdict.path);
  for (const path of allocated) await rm(path, { force: true });

  const mock = script.mock && typeof script.mock === 'object' ? script.mock : null;
  if (mockEnabled(ctx.claudeOpts) && mock) {
    const res = await runMock({ key, meta, ports, outputs, verdict, mock });
    resultEvent({ mock: true, exitCode: 0, durationMs: 0 });
    return { ...res, warnings, sessionId: null, runtime: meta.runtime, exitCode: 0, durationMs: Date.now() - started, envelopePath: null };
  }

  if (!SCRIPT_RUNTIMES.includes(meta.runtime)) throw scriptError(`script "${key}": unknown runtime ${JSON.stringify(meta.runtime)}`);
  // After the mock return (a mocked card spawns nothing), before the envelope: the program, the shell env and the
  // audit copy all see ONE set of params. A card with no mock of its own runs for REAL on a mock run, fed by a mock
  // agent's arbitrary JSON — there a refused payload is a warning and the card's own params stand.
  let wiredParams;
  try {
    wiredParams = await resolveWiredParams(ctx);
  } catch (err) {
    if (!mockEnabled(ctx.claudeOpts) || err?.errorClass !== null) throw err;
    warnings.push(`${err.message} — ignored on a mock run; the card's own params apply`);
    wiredParams = { params: script.params || {}, wired: [] };
  }
  script = { ...script, params: wiredParams.params };
  ctx = { ...ctx, script, wiredParams: wiredParams.wired };
  const envelope = buildEnvelope(ctx);
  const envelopePath = envelopeAuditPath(ctx);
  await mkdir(dirname(envelopePath), { recursive: true });
  await writeFile(envelopePath, JSON.stringify(envelope, null, 2) + '\n', 'utf8');
  for (const p of Object.values(outputs)) if (p?.path) await mkdir(dirname(p.path), { recursive: true });
  if (verdict?.path) await mkdir(dirname(verdict.path), { recursive: true });
  const env = { ...envForShell(envelope, scriptBaseEnv(ctx.claudeOpts, platform)), WORCA_ENVELOPE: envelopePath };
  // Clamped as well as validated (v4 T3): the bench and the CLI build a ctx without going through V22, and a delay
  // past 2^31-1 ms makes the timer fire after one millisecond.
  const timeoutMs = Number.isInteger(script.timeoutMs) && script.timeoutMs >= MIN_TIMEOUT_MS ? Math.min(script.timeoutMs, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  const onLine = (line) => emit({ type: 'text', text: line });
  const tail = (run) => (run.capture ? `\n${lastLines(run.capture, TAIL_LINES)}` : '');
  const afterRun = (run) => {
    if (run.aborted || ctx.signal?.aborted) throw ctx.signal?.reason ?? abortError();
    if (run.timedOut) throw scriptError(`script "${key}" timed out after ${Math.round(timeoutMs / 1000)} s`);
  };
  const spawnOrThrow = async (o) => {
    try { return await spawnScript(o); } catch (err) { throw scriptError(`script "${key}": spawn failed — ${err?.message || err}`); }
  };

  // The two HARNESSED runtimes differ only in what is spawned: same envelope on
  // stdin, same 'frame' stdout mode, so the same kill / timeout / abort rules and
  // the same reader apply to both.
  const programFile = () => {
    const file = script.file;
    if (!file || !existsSync(file)) throw scriptError(`script "${key}": program file not found: ${file || '(none)'}`);
    return file;
  };
  const readFrame = (r, logHint) => {
    if (r.frameOverflow) throw scriptError(`script "${key}": stdout exceeded ${FRAME_MAX / (1024 * 1024)} MiB — stdout is reserved for the result frame; log through ${logHint}${tail(r)}`);
    const parsed = parseFrame(r.stdout);
    if (!parsed.ok) throw scriptError(`script "${key}": no result frame (exit ${r.exitCode ?? r.signal}) — ${parsed.reason}${tail(r)}`);
    if (parsed.frame.ok !== true) throw scriptError(`script "${key}": ${parsed.frame.error?.message || 'failed'}`);
    return parsed.frame;
  };

  let run;
  let frame;
  if (meta.runtime === 'node') {
    run = await spawnOrThrow({ file: process.execPath, args: [CHILD_PATH, programFile()], cwd: envelope.ctx.cwd, env,
      stdin: JSON.stringify(envelope), timeoutMs, signal: ctx.signal, onLine, stdoutMode: 'frame', platform });
    afterRun(run);
    frame = readFrame(run, 'console.* or log()');
  } else if (meta.runtime === 'python') {
    // The probe is 60 s-cached, so this costs nothing per execution. A failed
    // probe is an EXECUTION error, which the bench reports as status 'error' with
    // this exact sentence (spec §4.1); a run never reaches here because its
    // preflight refuses first. Windows: probe.command is ['py','-3'] | ['python']
    // | ['python3'] — real executables, never a .cmd shim, so no `shell: true`,
    // and windowsVerbatimArguments stays off (spawnScript sets it for
    // stdoutMode 'capture' only), which is what quotes a path with a space.
    const file = programFile();
    const probe = await probePython();
    if (!probe.ok) throw scriptError(pythonMissingSentence(key));
    const [exe, ...pre] = probe.command;
    run = await spawnOrThrow({ file: exe, args: [...pre, '-u', PY_HARNESS_PATH, file], cwd: envelope.ctx.cwd,
      env: { ...env, ...PY_ENV }, stdin: JSON.stringify(envelope), timeoutMs, signal: ctx.signal, onLine,
      stdoutMode: 'frame', platform });
    afterRun(run);
    frame = readFrame(run, 'print()');          // NOT api.log(): its lines travel ON the frame (frame.logs) and count against the same 8 MiB
  } else {
    const command = shellCommand(script, meta, platform);
    if (!command) throw scriptError(`script "${key}": no command to run`);
    // v2 R3: the OUTER quotes are load-bearing. `/s` makes cmd.exe strip the first and the last quote of the command
    // line and run the rest verbatim; without the wrapper it strips the quotes of the COMMAND instead and
    // `"C:\Program Files\nodejs\node.exe" -e "…"` becomes garbage. This is byte-for-byte what Node's own
    // `shell: true` builds (child_process normalizeSpawnArguments), with windowsVerbatimArguments so nothing re-quotes it.
    const [shell, args] = platform === 'win32'
      ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${command}"`]]
      : ['/bin/sh', ['-c', command]];
    run = await spawnOrThrow({ file: shell, args, cwd: envelope.ctx.cwd, env, stdin: null, timeoutMs, signal: ctx.signal, onLine, stdoutMode: 'capture', platform });
    // Every md output the command did not write receives the report — written
    // before the exit mapping so a failed run still leaves its log behind.
    const displayName = meta.displayName || key;
    const report = shellReport({ displayName, ordinal, command, exitCode: run.exitCode, signal: run.signal, timedOut: run.timedOut, durationMs: run.durationMs, platform, capture: run.capture });
    const seen = new Set();
    for (const port of ports.outputs || []) {
      const path = outputs[port?.id]?.path;
      if (!path || port.type !== 'md' || seen.has(path) || existsSync(path)) continue;
      seen.add(path);
      await writeFile(path, report, 'utf8');
    }
    afterRun(run);
    const codes = meta.exitCodes || DEFAULT_EXIT_CODES;
    if (run.signal) throw scriptError(`script "${key}" was killed by ${run.signal}${tail(run)}`);
    const clean = codes.clean.includes(run.exitCode);
    if (!clean && !codes.blocking.includes(run.exitCode)) throw scriptError(`script "${key}" exited ${run.exitCode}${tail(run)}`);
    frame = { ok: true, outputs: {}, summary: `${displayName}: exit ${run.exitCode} in ${secs(run.durationMs)} s` };
    if (verdict?.path && !existsSync(verdict.path)) {
      frame.verdict = clean
        ? { issues: [], summary: `${displayName} exited ${run.exitCode}` }
        : { issues: [{ severity: 'major', title: `${displayName} failed (exit ${run.exitCode})`, detail: lastLines(run.capture, 40), location: '' }],
          summary: `${displayName} exited ${run.exitCode}` };
    }
  }

  const tokens = await materializeOutputs(ports, outputs, frame, key);
  let review = null;
  if (verdict?.path) {
    if (frame.verdict && typeof frame.verdict === 'object') {
      review = normalizeReview(frame.verdict);
      await writeFile(verdict.path, JSON.stringify(review, null, 2) + '\n', 'utf8');
    } else {
      review = await readVerdict(verdict.path);                                // garbage throws (agent parity)
      if (review.missing) warnings.push(missingVerdictWarning(ctx, verdict.path));
    }
  } else if (frame.verdict !== undefined) {
    warnings.push(`script "${key}" returned a verdict but declares none — ignored`);
  }
  const summary = typeof frame.summary === 'string' && frame.summary.trim()
    ? frame.summary.trim().slice(0, SUMMARY_MAX)
    : `${meta.displayName || key} completed.`;
  for (const l of Array.isArray(frame.logs) ? frame.logs : []) emit({ type: 'text', text: `[${l?.level || 'info'}] ${String(l?.msg ?? '')}` });
  resultEvent({ exitCode: run.exitCode, durationMs: run.durationMs });
  return {
    summary, outputs: tokens, verdict: review, warnings, sessionId: null,
    runtime: meta.runtime, exitCode: run.exitCode, durationMs: run.durationMs, envelopePath,
  };
}
