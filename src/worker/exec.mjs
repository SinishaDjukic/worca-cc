// src/worker/exec.mjs
// What a worker does with an exec frame: spawn the process in its own group, frame its
// stdout/stderr into batched `out` frames with a send window (the controller acks; past the
// window the pipes are paused so a chatty child cannot outrun the socket), relay signals to
// the group, and report the exit. Dependency-light: the worker runs in a container that has
// the worca package but no database and no server.
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { userInfo } from 'node:os';
import { existsSync, accessSync, statSync, constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { OUT_WINDOW, OUT_BATCH_LINES, OUT_FLUSH_MS, MAX_FRAME_BYTES } from '../core/executor/protocol.mjs';
import { isLoopbackUrl, PROXY_NAMES } from '../core/executor/shared.mjs';

/** The file to spawn: a path as given; a bare name found on the child's PATH as spawn would find it, else on this
 *  worker's own PATH (what its hello reported), else the name as given (spawn reports the ENOENT). */
export function resolveFile(file, childPath, workerPath, { platform = process.platform } = {}) {
  if (!file || /[\\/]/.test(file)) return file;
  // As execvp would: absolute PATH entries only (a relative one would resolve against the child's cwd, not ours), and
  // an entry that is not executable is skipped for the next.
  const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const executable = (p) => { try { accessSync(p, constants.X_OK); return statSync(p).isFile(); } catch { return false; } };
  const search = (pathVar) => {
    for (const dir of String(pathVar || '').split(delimiter)) {
      if (!dir || !isAbsolute(dir)) continue;
      for (const ext of exts) { const p = join(dir, file + ext); if (executable(p)) return p; }
    }
    return null;
  };
  return search(childPath) || search(workerPath) || file;
}

/** Env vars a worker never hands to a child: its own credentials, and a proxy that points at the
 *  controller's loopback (the in-process proxy is unreachable from another container). */
const WORKER_ONLY_ENV = ['WORCA_WORKER_TOKEN', 'WORCA_WORKER_TOKEN_FILE', 'WORCA_CONTROLLER_URL', 'WORCA_WORKER_SCOPE',
  'SSH_AUTH_SOCK'];   // the controller's SSH agent (compose.ssh.yml) is its push credential: agents get no Git credential
const PROXY_VARS = PROXY_NAMES;
export { isLoopbackUrl };

/**
 * Which of the worker's own variables an engine child may get: model-provider credentials and their settings, by
 * name, plus whatever WORCA_WORKER_PASS_ENV lists. Never worca's own (`WORCA_*`: the token, the controller URL) and
 * never a Git host token: pushes and pull requests are the controller's, and agents get no Git credential.
 */
const FROM_WORKER = [/_API_KEY$/, /_AUTH_TOKEN$/, /^ANTHROPIC_/, /^CLAUDE_CODE_/, /^OPENAI_/, /^GEMINI_/, /^GOOGLE_/, /^VERTEX/, /^AWS_/, /^AZURE_/, /^COPILOT_/, /^CURSOR_/, /^GOOSE_/, /^DASHSCOPE_/, /^OPENROUTER_/];
// Git hosts by name, not only GitHub's two: `AZURE_DEVOPS_EXT_PAT` would pass as an `AZURE_*` setting otherwise,
// and it is a push-capable token the controller strips from every spawn (host-credentials.mjs).
const NEVER_FROM_WORKER = [/^WORCA_/, /^(GH|GITHUB|GITLAB|GL|BITBUCKET|GITEA)_/, /^AZURE_DEVOPS_/, /^SYSTEM_ACCESSTOKEN$/, /^GIT_(ASKPASS|TOKEN|PASSWORD|CREDENTIALS)/];
export function passesFromWorker(name, extra = []) {
  if (NEVER_FROM_WORKER.some((re) => re.test(name))) return false;
  return extra.includes(name) || FROM_WORKER.some((re) => re.test(name));
}

/** Variables whose value is a path INSIDE a container: the controller composed the env in its own container, where
 *  its entrypoint built a CA bundle under its /tmp and (on a worker) this one's entrypoint set shared cache dirs. */
const CA_FILE_VARS = ['SSL_CERT_FILE', 'GIT_SSL_CAINFO', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE', 'NODE_EXTRA_CA_CERTS'];
const WORKER_LOCAL_ENV = [...CA_FILE_VARS, 'npm_config_cache', 'UV_CACHE_DIR', 'PLAYWRIGHT_BROWSERS_PATH'];

/**
 * The env a child gets: the controller's composed env, with this worker's HOME (the scope's home on the shared
 * volume), its own pid as the host-guard pid where one was sent, and nothing that only the worker should hold.
 */
export function childEnv(env, { home, workerPid = process.pid, user = null, workerEnv = process.env, exists = existsSync, withheld = [] } = {}) {
  const out = { ...env };
  for (const k of WORKER_ONLY_ENV) delete out[k];
  for (const k of PROXY_VARS) if (out[k] && isLoopbackUrl(out[k])) delete out[k];
  // The worker's OWN engine credentials (worker.credentialsSecret on Kubernetes puts them in this container, not in
  // the controller) reach the child when the controller sent none of that name. Only names that look like one: the
  // worker's container baseline (PATH, service links, its assignment) is not the child's business. And never a name
  // the controller left out on purpose (`withheld`: its env scrub or the broker removed it; this must not undo that).
  const extra = String(workerEnv?.WORCA_WORKER_PASS_ENV || '').split(',').map((s) => s.trim()).filter(Boolean);
  const kept = new Set(Array.isArray(withheld) ? withheld : []);
  // A scrubbed spawn names what its scrub lets through (WORCA_ENV_KEEP, spawn.mjs): nothing else of the worker's own
  // reaches the child, so the guardrail holds for a key that only this container has. The variable itself stops here.
  const keep = typeof out.WORCA_ENV_KEEP === 'string' ? out.WORCA_ENV_KEEP.split(',').filter(Boolean) : null;
  delete out.WORCA_ENV_KEEP;
  const scrubbedOut = (k) => !!keep && !keep.some((n) => (n.endsWith('*') ? k.startsWith(n.slice(0, -1)) : k === n));
  for (const [k, v] of Object.entries(workerEnv || {})) {
    if (out[k] !== undefined || v === undefined || v === '' || kept.has(k) || scrubbedOut(k) || !passesFromWorker(k, extra)) continue;
    out[k] = v;
  }
  // This container's own value wins (its entrypoint rebuilt the CA bundle and set the caches); a CA file path that
  // exists nowhere here — the controller's /tmp/worca-ca.*/bundle.pem — is dropped rather than break every TLS call.
  const usable = (k, v) => !!v && (!CA_FILE_VARS.includes(k) || exists(v));
  for (const k of WORKER_LOCAL_ENV) {
    // A CA path is this container's or nothing (the controller's /tmp bundle is not here); the package caches are this
    // container's shared ones (a cache is a cache). The browsers path is a default only: a run that set it on purpose
    // (PLAYWRIGHT_BROWSERS_PATH=0, the project's own browsers) keeps it, as it would on one machine.
    const own = k !== 'PLAYWRIGHT_BROWSERS_PATH' || out[k] === undefined;
    if (own && usable(k, workerEnv?.[k])) out[k] = workerEnv[k];
    else if (out[k] !== undefined && !usable(k, out[k])) delete out[k];
  }
  if (home) out.HOME = home;
  if (user) { out.USER = user; out.LOGNAME = user; }
  // The host-guard pid names the process an agent must not kill: here, this worker. Only where the controller sent
  // one (the guard is on, and the child is an engine): a script node's env has none on purpose.
  if (out.WORCA_HOST_PID !== undefined) out.WORCA_HOST_PID = String(workerPid);
  return out;
}

// Output bounds. One frame holds at most MAX_FRAME_BYTES of JSON, and a frame that does not fit throws in the
// sender — from a stream or timer callback that would take the whole worker down, and the retry with it. So:
// small lines are batched up to BATCH_CHARS; a long line travels alone, whole when it fits a frame (a multi-megabyte
// JSON event of an engine does) and in pieces of SPLIT_CHARS when it cannot; a stream with no newline at all is cut
// at MAX_PARTIAL_CHARS so the buffer never holds more. Every piece but a line's last is marked `more`, and the
// controller joins them without a newline: the line arrives as the one line it was.
const BATCH_CHARS = 512 * 1024;
const BIG_LINE_CHARS = 256 * 1024;
const SPLIT_CHARS = 1024 * 1024;              // worst case 6 bytes of JSON per character: still one frame
const MAX_PARTIAL_CHARS = 8 * 1024 * 1024;
const FRAME_BUDGET = MAX_FRAME_BYTES - 64 * 1024;
const fitsAFrame = (line) => Buffer.byteLength(JSON.stringify(line), 'utf8') <= FRAME_BUDGET;
/** Where to cut `text` at about `n` characters: one earlier when `n` falls between the two halves of a surrogate pair
 *  (each piece is encoded on its own on the far side, where half a pair becomes U+FFFD). */
export function cutPoint(text, n) {
  if (n >= text.length) return text.length;
  const c = text.charCodeAt(n - 1);
  return n > 1 && c >= 0xD800 && c <= 0xDBFF ? n - 1 : n;
}
/** `text` in pieces of at most `size` characters, no surrogate pair split. */
export function piecesOf(text, size) {
  const out = [];
  for (let at = 0; at < text.length;) { const end = at + cutPoint(text.slice(at, at + size + 1), size); out.push(text.slice(at, end)); at = end; }
  return out;
}

/**
 * Lines out of a byte stream, as readline gives them (`\n`, `\r\n` or a lone `\r` end a line; the last line with or
 * without one), but with a bounded buffer: a run of `maxPartial` characters without a line end is handed over as
 * `onLine(piece, true)` — "more of this line follows" — so the receiver can put the line back together.
 */
export function lineSplitter(onLine, { maxPartial = MAX_PARTIAL_CHARS } = {}) {
  const decoder = new StringDecoder('utf8');
  let partial = '';
  let heldCR = false;   // the chunk ended on `\r`: the line is over, but a `\n` opening the next chunk belongs to it
  const feed = (text) => {
    let start = 0;
    if (heldCR) { heldCR = false; if (text.charCodeAt(0) === 10) start = 1; }
    for (let i = start; i < text.length; i += 1) {
      const c = text.charCodeAt(i);
      if (c !== 10 && c !== 13) continue;
      onLine(partial + text.slice(start, i), false);
      partial = '';
      if (c === 13) { if (i + 1 === text.length) heldCR = true; else if (text.charCodeAt(i + 1) === 10) i += 1; }
      start = i + 1;
    }
    partial += text.slice(start);
    while (partial.length > maxPartial) { const n = cutPoint(partial, maxPartial); onLine(partial.slice(0, n), true); partial = partial.slice(n); }
  };
  return {
    write(chunk) { feed(typeof chunk === 'string' ? chunk : decoder.write(chunk)); },
    end() { const rest = partial + decoder.end(); partial = ''; heldCR = false; if (rest) onLine(rest, false); },
  };
}

/** How long a killed child may keep its pipes before the worker stops waiting for 'close'. */
const KILL_GRACE_MS = 2000;

/**
 * @param {{ send: (frame: object) => void, home: string, log?: (msg: string) => void, platform?: string }} o
 */
export function createExecRunner({ send, home, log = () => {}, platform = process.platform }) {
  const live = new Map();   // id -> { child, pending, seq, lastAck, paused, flushTimer, grace }
  let user = null;
  try { user = userInfo().username || null; } catch { user = null; }
  const idleFns = new Set();
  /** Nothing runs any more: the worker's idle timer may arm (every path that ends a child says so here). */
  const notifyIdle = () => { if (!live.size) for (const fn of idleFns) fn(); };

  /** Send a lifecycle frame (started, spawn-error, exit) from a child's event; never throw: an exception there is
   *  uncaught, and takes the worker and every other process of the run with it. */
  const report = (frame) => { try { send(frame); } catch (err) { log(`${frame.type} frame for ${frame.id} not sent (${err?.message || err})`); } };
  /** Send an output frame; never throw. What still cannot be sent is replaced by one line saying so. */
  const sendOut = (frame) => {
    try { send(frame); }
    catch (err) {
      log(`output frame dropped (${err?.message || err})`);
      try { send({ ...frame, lines: [`[worca worker: ${frame.lines.length} line(s) of output dropped — too large for one frame]`] }); } catch { /* the socket is gone: its close reports it */ }
    }
  };
  const pauseIfBehind = (e) => {
    if (!e.paused && e.seq - e.lastAck > OUT_WINDOW) { e.paused = true; try { e.child.stdout.pause(); e.child.stderr.pause(); } catch { /* ended */ } }
  };
  const flush = (e, id) => {
    clearTimeout(e.flushTimer); e.flushTimer = null;
    // One frame per run of lines from the same stream, in the order they arrived: an error line stays next to the
    // output it belongs to (a frame per stream would put all of stdout before all of stderr).
    const runs = e.pending;
    e.pending = []; e.pendingChars = 0; e.pendingLines = 0;
    for (const run of runs) sendOut({ type: 'out', id, seq: e.seq++, stream: run.stream, lines: run.lines });
    pauseIfBehind(e);
  };
  /** `more`: this is not the end of the line (the splitter cut a newline-free stream); the rest follows. */
  const queueLine = (e, id, stream, line, more = false) => {
    if (more || line.length > BIG_LINE_CHARS) {
      flush(e, id);   // what was pending goes first: order within the stream is kept
      const pieces = fitsAFrame(line) ? [line] : piecesOf(line, SPLIT_CHARS);
      pieces.forEach((piece, i) => sendOut({ type: 'out', id, seq: e.seq++, stream, lines: [piece], ...(more || i < pieces.length - 1 ? { more: true } : {}) }));
      pauseIfBehind(e);
      return;
    }
    if (e.pendingChars + line.length > BATCH_CHARS) flush(e, id);
    const last = e.pending[e.pending.length - 1];
    if (last && last.stream === stream) last.lines.push(line); else e.pending.push({ stream, lines: [line] });
    e.pendingChars += line.length;
    e.pendingLines += 1;
    if (e.pendingLines >= OUT_BATCH_LINES) { flush(e, id); return; }
    if (!e.flushTimer) e.flushTimer = setTimeout(() => flush(e, id), OUT_FLUSH_MS);
  };

  const runner = {
    get liveCount() { return live.size; },
    onIdle(fn) { idleFns.add(fn); },

    start(frame) {
      const { id } = frame;
      let child;
      // A working directory this worker cannot see (the shared volume not mounted at the same path) would be an
      // ENOENT indistinguishable from a missing binary: say which it is.
      if (frame.cwd && !existsSync(frame.cwd)) {
        report({ type: 'spawn-error', id, code: 'ENOENT', message: `the working directory ${frame.cwd} does not exist on this worker (is the shared volume mounted at the same path as on the controller?)`.slice(0, 4000) });
        notifyIdle();
        return;
      }
      const env = childEnv(frame.env, { home, user, withheld: frame.withheld });
      // A bare binary name is looked up on the child's PATH (the controller's); one only this worker's PATH knows —
      // what the hello reported — is resolved here, so the spawn finds what the capabilities promised.
      const file = resolveFile(frame.file, env.PATH, process.env.PATH);
      try {
        child = spawn(file, frame.args, {
          cwd: frame.cwd || undefined,   // none named: this worker's own (as a local spawn without cwd)
          env,
          stdio: [frame.stdin != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
          detached: frame.detached !== false && platform !== 'win32',
          windowsHide: true,
        });
      } catch (err) {
        report({ type: 'spawn-error', id, code: err.code ?? null, message: String(err.message || err).slice(0, 4000) });
        notifyIdle();   // nothing started: the worker is as idle as before the frame
        return;
      }
      const e = { child, pending: [], pendingLines: 0, pendingChars: 0, seq: 0, lastAck: -1, paused: false, flushTimer: null, grace: null, started: false, reported: false };
      live.set(id, e);
      child.on('spawn', () => { e.started = true; report({ type: 'started', id, pid: child.pid }); });
      child.on('error', (err) => {
        if (e.reported) return;
        // After 'spawn' an error is about a later call (a kill refused with EPERM), not the spawn: the process runs on
        // and its exit is still reported; a spawn-error now would make the controller believe nothing started.
        if (e.started) { log(`process ${id} (pid ${child.pid}): ${err?.message || err}`); return; }
        e.reported = true;
        live.delete(id);
        report({ type: 'spawn-error', id, code: err.code ?? null, message: String(err.message || err).slice(0, 4000) });
        notifyIdle();
      });
      for (const [stream, input] of [['out', child.stdout], ['err', child.stderr]]) {
        const lines = lineSplitter((line, more) => queueLine(e, id, stream, line, more));
        input.on('data', (chunk) => lines.write(chunk));
        input.on('end', () => lines.end());
      }
      child.on('close', (code, signal) => {
        if (e.reported) return;
        e.reported = true;
        clearTimeout(e.grace);
        // An engine's step is over: what it left running in its process group (a dev server it forgot) goes with it,
        // as on one machine (spawn.mjs E3). ESRCH when nothing is left. A script's children are its own business.
        if (frame.reap === true && frame.detached !== false && platform !== 'win32' && typeof child.pid === 'number') { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* nothing left */ } }
        flush(e, id);
        live.delete(id);
        if (!e.cut) report({ type: 'exit', id, code, signal });   // cut from outside: no exit, the loss is the message
        notifyIdle();
      });
      if (frame.stdin != null) { child.stdin.on('error', () => {}); child.stdin.end(frame.stdin, 'utf8'); }
    },

    ack(id, seq) {
      const e = live.get(id);
      if (!e) return;
      e.lastAck = Math.max(e.lastAck, seq);
      if (e.paused && e.seq - e.lastAck <= OUT_WINDOW) { e.paused = false; try { e.child.stdout.resume(); e.child.stderr.resume(); } catch { /* ended */ } }
    },

    signal(id, sig) {
      const e = live.get(id);
      if (!e) return;
      runner.signalEntry(e, sig);
    },

    signalEntry(e, sig) {
      const { child } = e;
      if (typeof child.pid !== 'number') return;
      if (platform === 'win32') { try { child.kill(sig === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM'); } catch { /* gone */ } }
      else { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } } }
      if (sig === 'SIGKILL' && !e.grace) {
        // A descendant that escaped the group can hold the pipes open; release our ends so 'close' fires.
        e.grace = setTimeout(() => { try { child.stdout.destroy(); child.stderr.destroy(); } catch { /* closed */ } }, KILL_GRACE_MS);
        e.grace.unref?.();
      }
    },

    /** Stop everything: SIGTERM, wait up to graceMs, SIGKILL what is left. Resolves when all have closed. */
    /** `cut`: the steps are being stopped from outside (the container is going), not by their run — their end is
     *  not reported as an exit, so the controller sees the worker vanish and retries them on a fresh one. */
    async shutdown({ graceMs = 5000, cut = false } = {}) {
      if (!live.size) return;
      if (cut) for (const e of live.values()) e.cut = true;
      for (const e of live.values()) runner.signalEntry(e, 'SIGTERM');
      const deadline = Date.now() + graceMs;
      while (live.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      for (const e of live.values()) runner.signalEntry(e, 'SIGKILL');
      const hard = Date.now() + KILL_GRACE_MS + 500;
      while (live.size && Date.now() < hard) await new Promise((r) => setTimeout(r, 50));
      if (live.size) log(`${live.size} process(es) did not exit after SIGKILL`);
    },

    killAll() { for (const e of live.values()) runner.signalEntry(e, 'SIGKILL'); },
  };
  return runner;
}
