// src/core/exec-env/backends/docker.mjs
// The "Local sandbox (Docker)" backend (docs/local-sandbox.md, plans/e2b-execution-design.md §17): each run's agents
// and scripts execute in one disposable container on this machine's own Docker. Worca stays native; the generic layer
// (remote-env.mjs) brings the code in as a git bundle and back as a filtered patch after every step, and the model relay
// keeps every model credential here. This module is the only one that knows the `docker` CLI. It calls it through an
// injectable runner (no npm dependency; tests and mock mode use docker-fake.mjs).
//
// The container: no bind mount of any kind (never the Docker socket), `--network none` (its only way out is the relay of
// docker-egress.mjs), every capability dropped but the two the layer's one root command needs, no-new-privileges, a pids,
// memory and CPU limit, an optional stricter `--runtime`. Agents run as uid 1000 without sudo. PID 1 (under docker's
// init) is a watchdog that ends the container at its deadline; setTimeout moves the deadline (the heartbeat, a park).
// It runs as uid 990, as the network relay does: the agents can neither stop nor extend them.
//
// Top-level imports stay light (the registry loads this from exec-env/index.mjs, which settings.mjs imports): node
// built-ins and pure modules. settings.mjs, the egress relay and the fake load inside the functions that need them.
import { spawn as nodeSpawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { engineCredential, remotePreflight } from '../policy.mjs';
import { REMOTE_ENGINES } from '../../../shared/exec-env.mjs';
import { parseAllow, parseHostList, hostMatches } from '../../egress-proxy.mjs';
import { dockerBaseVersion, defaultImageName, projectImageName, renderSandboxDockerfile, renderSandboxProjectDockerfile,
  isImageRef, DEFAULT_IMAGE_REPO } from './docker-image.mjs';

export const SANDBOX_USER = '1000:1000';   // `user` in the image: every agent and script command
export const HELPER_USER = '990:990';      // `worca` in the image: the watchdog and the network relay
export const ROOT_USER = '0:0';            // only remote-env.mjs's mkdirsScript asks for root
const HOMES = Object.freeze({ [SANDBOX_USER]: '/home/user', [HELPER_USER]: '/nonexistent', [ROOT_USER]: '/root' });
export const RUN_DIR = '/run/worca';       // owned by uid 990 in the image
export const DEADLINE_FILE = `${RUN_DIR}/deadline`;
export const RELAY_PATH = `${RUN_DIR}/egress-relay.mjs`;
export const EGRESS_PORT = 3128;
export const WORK_DIR = '/tmp/worca-docker';
const LABEL = (k) => `worca.${k}`;
const RELAY_SCRIPT = fileURLToPath(new URL('../docker-egress-relay.mjs', import.meta.url));

// The capabilities the container keeps. The generic layer runs ONE command as root: mkdirsScript (shell.mjs), which
// creates the mirrored host directories (/Users/…, /var/folders/…) under root-owned parents and under the sandbox user's
// HOME, and hands each new one to `user`. mkdir in a directory root does not own needs CAP_DAC_OVERRIDE; chown to
// another uid needs CAP_CHOWN. Nothing else runs as root. The agents run as uid 1000, so they hold no capability.
export const KEPT_CAPS = Object.freeze(['CHOWN', 'DAC_OVERRIDE']);
export const DEFAULT_RESOURCES = Object.freeze({ memory: '4g', cpus: 2, pids: 2048, runtime: null });
export const DEFAULT_DOCKER_MAX_SANDBOXES = 2;
export const DEFAULT_DOCKER_MAX_WAIT_MIN = 240;
const WATCHDOG_POLL_S = 5;
const CALL_TIMEOUT_MS = 30_000;
const BUILD_TIMEOUT_MS = 90 * 60_000;
const KEEP_OUTPUT = 64 * 1024 * 1024;      // what wait() returns of a command's stdout; the layer kills one past this
const KEEP_STDERR = 1024 * 1024;

// ── the scripts that run in the container ──
/** PID 1's child (docker's --init runs it): writes the first deadline, then ends the container once `date` passes the
 *  deadline file. Only uid 990 (and root) can write the file. $1 the file, $2 seconds from now, $3 poll seconds. */
export const WATCHDOG_SCRIPT = [
  'f=$1; p=${3:-5}',
  't=$(( $(date +%s) + $2 )); echo "$t" > "$f.tmp" && mv -f "$f.tmp" "$f" || exit 1',
  'while :; do',
  '  sleep "$p" & wait $!',
  '  d=$(cat "$f" 2>/dev/null) || d=0',
  '  case "$d" in ""|*[!0-9]*) d=0;; esac',
  '  [ "$(date +%s)" -lt "$d" ] || exit 0',
  'done',
].join('\n');
/** setTimeout: a new deadline, written atomically. $1 the file, $2 seconds from now. */
export const DEADLINE_SCRIPT = 't=$(( $(date +%s) + $2 )); echo "$t" > "$1.tmp" && mv -f "$1.tmp" "$1"';
/** Every command runs under this: `$0` carries the command's token (the kill script finds it by it), its environment
 *  too (a process that left the group is still found by it on Linux). The command runs as its own process group
 *  (`set -m`), so one signal reaches it and its children. $1 the working dir ('' for none), $2 the command. */
export const WRAPPER_SCRIPT = [
  't=$0; w=$1; c=$2',
  'export WORCA_CMD_ID="${t#worca-cmd:}"',
  'if [ -n "$w" ]; then cd -- "$w" || exit 1; fi',
  'set -m',
  'bash -c "$c" &',
  'p=$!',
  'set +m',
  'wait "$p"',
].join('\n');
/** Ends a command and everything it started, INSIDE the container: stopping a `docker exec` on the host leaves its
 *  process running there. The wrapper (found by its token, `[d]` keeps this script out of the match), every descendant,
 *  the command's process group and, where /proc exists, any process still carrying the token. $1 the token. */
export const KILL_SCRIPT = [
  't=$1',
  'w=$(pgrep -f -- "worca-cm[d]:$t" | head -n 1)',
  "all=''",
  'walk() { for c in $(pgrep -P "$1"); do all="$all $c"; walk "$c"; done; }',
  'if [ -n "$w" ]; then',
  '  walk "$w"',
  '  for c in $(pgrep -P "$w"); do kill -KILL -- "-$c" 2>/dev/null; done',
  'fi',
  'for p in $all; do kill -KILL "$p" 2>/dev/null; done',
  'if [ -d /proc/self ]; then',
  '  for d in /proc/[0-9]*; do',
  '    [ "${d#/proc/}" = "$$" ] && continue',
  '    grep -qxzF -- "WORCA_CMD_ID=$t" "$d/environ" 2>/dev/null && kill -KILL "${d#/proc/}" 2>/dev/null',
  '  done',
  'fi',
  'if [ -n "$w" ]; then kill -KILL "$w" 2>/dev/null; fi',
  'exit 0',
].join('\n');
const WRITE_SCRIPT = 'mkdir -p -- "$(dirname -- "$1")" && cat > "$1"';

// ── errors ──
const GONE_RE = /No such container|No such object|is not running|cannot exec in a (stopped|paused)|is (paused|restarting)|marked for removal|removal of container .* is already in progress/i;
const DAEMON_RE = /Cannot connect to the Docker daemon|error during connect|Is the docker daemon running|daemon is not running|failed to connect to the docker API/i;
const firstLine = (s) => String(s || '').trim().split('\n').find((l) => l.trim())?.trim().slice(0, 300) || '';
export class DockerSandboxError extends Error {
  constructor(message, { state = null, cause, ...extra } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DockerSandboxError';
    this.dockerState = state;          // 'gone' | 'unreachable' | null
    Object.assign(this, extra);
  }
}
class DockerExitError extends Error {
  constructor(message, extra) { super(message); this.name = 'DockerExitError'; Object.assign(this, extra); }
}
const goneError = (name, why) => new DockerSandboxError(`the container ${name} is gone${why ? ` (${why})` : ''}`, { state: 'gone' });
const unreachableError = (why, cause) => new DockerSandboxError(`Docker could not be reached (${why})`, { state: 'unreachable', cause });

// ── the docker CLI ──
// What the docker CLI itself needs from the server's env: never a model key or any other secret of the server. A
// sandbox command's own env reaches it as `-e NAME` (the value in the CLI's env, never on its argv).
const CLI_ENV = /^(PATH|HOME|USER|LOGNAME|TMPDIR|LANG|LC_ALL|XDG_RUNTIME_DIR|XDG_CONFIG_HOME|SSH_AUTH_SOCK|DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG|DOCKER_CERT_PATH|DOCKER_TLS_VERIFY|DOCKER_API_VERSION|DOCKER_BUILDKIT|BUILDKIT_PROGRESS)$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_NAME = /(TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL)/i;
export function cliEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env || {})) if (CLI_ENV.test(k) && typeof v === 'string') out[k] = v;
  return out;
}
/** The real runner: `docker <args>`. `stdin: true` keeps the CLI's stdin as a pipe. */
export function dockerCliRunner({ bin = 'docker', env = process.env } = {}) {
  return {
    kind: 'docker', network: true,
    spawn: (args, { env: extra = {}, stdin = false } = {}) => nodeSpawn(bin, args,
      { env: { ...cliEnv(env), ...extra }, stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true }),
    pathPrefix: () => '',
  };
}

/** One CLI call to its end: { code, stdout, stderr } (stdout a Buffer with `binary`). A missing CLI or a timeout throws
 *  'unreachable'. `input` goes to stdin; `onLine` gets each stderr+stdout line as it arrives (builds). */
function call(runner, args, { input = null, timeoutMs = CALL_TIMEOUT_MS, onLine = null, binary = false, env } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = runner.spawn(args, { stdin: input !== null, env }); } catch (err) { reject(unreachableError(err?.code || err?.message, err)); return; }
    const out = []; let err = ''; let lineBuf = ''; let settled = false;
    const line = (d) => { if (!onLine) return; lineBuf += d; let i; while ((i = lineBuf.indexOf('\n')) >= 0) { try { onLine(lineBuf.slice(0, i)); } catch { /* a listener */ } lineBuf = lineBuf.slice(i + 1); } };
    child.stdout.on('data', (d) => { out.push(Buffer.from(d)); if (onLine) line(String(d)); });
    child.stderr.on('data', (d) => { err = (err + d).slice(-KEEP_STDERR); line(String(d)); });
    const timer = timeoutMs ? setTimeout(() => { if (settled) return; settled = true; try { child.kill('SIGKILL'); } catch { /* gone */ } reject(unreachableError(`docker ${args[0]} did not answer within ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs) : null;
    timer?.unref?.();
    child.on('error', (e) => { if (settled) return; settled = true; clearTimeout(timer); reject(unreachableError(e?.code === 'ENOENT' ? 'the docker command is not installed' : e?.code || e?.message, e)); });
    child.on('close', (code) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (onLine && lineBuf) { try { onLine(lineBuf); } catch { /* a listener */ } }
      const buf = Buffer.concat(out);
      resolve({ code: code ?? 1, stdout: binary ? buf : buf.toString('utf8'), stderr: err });
    });
    if (input !== null) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}

// ── hardening ──
/** The `docker run` flags of a sandbox. No bind mount, no device, no socket, no host namespace, no published port. */
export function hardeningArgs(resources = DEFAULT_RESOURCES) {
  const r = { ...DEFAULT_RESOURCES, ...resources };
  return ['--init', '--network', 'none', '--ipc', 'private', '--user', HELPER_USER,
    '--cap-drop', 'ALL', ...KEPT_CAPS.flatMap((c) => ['--cap-add', c]),
    '--security-opt', 'no-new-privileges', '--pids-limit', String(r.pids),
    '--memory', String(r.memory), '--memory-swap', String(r.memory), '--cpus', String(r.cpus),
    '--ulimit', 'core=0', '--hostname', 'worca-sandbox',
    ...(r.runtime ? ['--runtime', r.runtime] : [])];
}
const FORBIDDEN_FLAGS = new Set(['-v', '--volume', '--mount', '--volumes-from', '--privileged', '--device', '--device-cgroup-rule',
  '--gpus', '--pid', '--userns', '--uts', '--cgroupns', '--cgroup-parent', '--group-add', '--tmpfs', '-p', '--publish', '-P',
  '--publish-all', '--add-host', '--sysctl', '--net', '--link', '--network-alias', '--volume-driver', '--oom-kill-disable']);
/** Throws when the flags of a `docker run` hold anything that crosses into the host. Run on every create. */
export function assertHardened(flags) {
  const bad = (why) => { throw new Error(`refusing to start a sandbox container: ${why}`); };
  if (flags.some((a) => /docker\.sock|\/var\/run\/docker|\/run\/docker|podman\.sock/.test(String(a)))) bad('the Docker socket must never enter a sandbox');
  for (let i = 0; i < flags.length; i++) {
    const a = String(flags[i]); const name = a.split('=')[0]; const value = a.includes('=') ? a.slice(a.indexOf('=') + 1) : flags[i + 1];
    if (FORBIDDEN_FLAGS.has(name) || /^-[a-zA-Z]*[vp]/.test(name) && !name.startsWith('--')) bad(`${name} is not allowed`);
    if (name === '--network' && value !== 'none') bad('the network must be none');
    if (name === '--ipc' && value !== 'private') bad('the IPC namespace must be private');
    if (name === '--cap-add' && !KEPT_CAPS.includes(String(value).toUpperCase().replace(/^CAP_/, ''))) bad(`the capability ${value} is not allowed`);
    if (name === '--security-opt' && value !== 'no-new-privileges') bad(`--security-opt ${value} is not allowed`);
    if (name === '--user' && /^(0|root)(:|$)/.test(String(value))) bad('the container must not run as root');
  }
  const pair = (n, v) => flags.some((a, i) => a === n && flags[i + 1] === v);
  if (!pair('--cap-drop', 'ALL')) bad('every capability must be dropped');
  if (!pair('--security-opt', 'no-new-privileges')) bad('no-new-privileges is required');
  if (!pair('--network', 'none')) bad('the network must be none');
  for (const n of ['--pids-limit', '--memory', '--cpus', '--user']) if (!flags.includes(n)) bad(`${n} is required`);
  return flags;
}

// ── settings ──
const MEMORY_RE = /^(\d+(?:\.\d+)?)([kmg]?)b?$/i;
const RUNTIME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const toBytes = (m) => { const x = MEMORY_RE.exec(String(m)); if (!x) return NaN; return Number(x[1]) * ({ '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[x[2].toLowerCase()]); };
/** `dockerSandbox` in settings.json ({ memory, cpus, pids, runtime }) checked; an invalid field keeps its default and
 *  is named in `warnings`. */
export function sandboxResources(raw) {
  const out = { ...DEFAULT_RESOURCES }; const warnings = [];
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const bad = (k, why) => warnings.push(`settings.json dockerSandbox.${k}: ${why}; using ${DEFAULT_RESOURCES[k] ?? 'none'}`);
  if (o.memory !== undefined && o.memory !== null) {
    const b = toBytes(o.memory);
    if (Number.isFinite(b) && b >= 512 * 1024 ** 2 && b <= 1024 ** 4) out.memory = String(o.memory).toLowerCase().replace(/b$/, ''); else bad('memory', 'must be a size such as 4g, at least 512m');
  }
  if (o.cpus !== undefined && o.cpus !== null) { const n = Number(o.cpus); if (Number.isFinite(n) && n >= 0.5 && n <= 256) out.cpus = n; else bad('cpus', 'must be a number from 0.5 to 256'); }
  if (o.pids !== undefined && o.pids !== null) { if (Number.isSafeInteger(o.pids) && o.pids >= 64 && o.pids <= 65536) out.pids = o.pids; else bad('pids', 'must be a whole number from 64 to 65536'); }
  if (o.runtime !== undefined && o.runtime !== null && o.runtime !== '') { if (typeof o.runtime === 'string' && RUNTIME_RE.test(o.runtime)) out.runtime = o.runtime; else bad('runtime', 'must be a runtime name such as runsc'); }
  return { resources: out, warnings };
}
async function settingsResources() {
  try { const { readSettings } = await import('../../settings.mjs'); return sandboxResources(readSettings()?.dockerSandbox); }
  catch { return { resources: { ...DEFAULT_RESOURCES }, warnings: [] }; }
}

/** The proxy variables `docker build` passes to RUN steps: only a proxy without a login and not on loopback (a build
 *  container cannot reach this machine's loopback, and a login must never enter an image's build). */
export function buildProxyArgs(env = process.env) {
  const out = [];
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy']) {
    const v = env[k];
    if (typeof v !== 'string' || !v.trim() || v.includes('@')) continue;
    if (!/no_proxy/i.test(k)) { let h = ''; try { h = new URL(v).hostname; } catch { continue; } if (/^(localhost|127\.|\[?::1\]?$)/.test(h)) continue; }
    out.push('--build-arg', `${k}=${v}`);
  }
  return out;
}

// ── the client ──
const userOf = (u) => {
  if (u === undefined || u === null || u === '' || u === 'user') return SANDBOX_USER;
  if (u === 'root') return ROOT_USER;
  if (u === HELPER_USER || u === SANDBOX_USER || u === ROOT_USER) return u;
  throw new Error(`unknown sandbox user ${JSON.stringify(u)}`);
};
const relays = new Map();      // container name -> EgressRelay (every client of this process: the sweep removes too)
const building = new Map();    // image name -> Promise (one build of the default image at a time)

/**
 * The client over one runner (dockerCliRunner, or docker-fake.mjs). `resources` (tests) overrides settings.json;
 * `env` is the server env the egress relay reads its proxy from, at each connection.
 */
export function dockerClient(runner, { env = process.env, resources = null, lookup } = {}) {
  const c = (args, o) => call(runner, args, o);
  const prefixOf = (name) => runner.pathPrefix?.(name) || '';
  const handle = (name) => ({ id: name, pathPrefix: prefixOf(name), box: { name, prefix: prefixOf(name) } });

  /** 'running' | 'gone' | 'unreachable' (never throws). */
  async function stateOf(name) {
    let r; try { r = await c(['inspect', '--type', 'container', '--format', '{{.State.Running}}', name]); } catch { return 'unreachable'; }
    if (r.code === 0) return r.stdout.trim() === 'true' ? 'running' : 'gone';
    if (DAEMON_RE.test(r.stderr)) return 'unreachable';
    return GONE_RE.test(r.stderr) ? 'gone' : 'unreachable';
  }
  /** A failed CLI call, as the error the layer classifies. */
  async function failure(name, r, what) {
    const why = firstLine(r.stderr) || `exit ${r.code}`;
    if (DAEMON_RE.test(r.stderr)) return unreachableError(why);
    if (name && GONE_RE.test(r.stderr)) { const st = await stateOf(name); if (st === 'gone') return goneError(name, why); if (st === 'unreachable') return unreachableError(why); }
    return new DockerSandboxError(`${what} failed: ${why}`, { exitCode: r.code, stderr: r.stderr });
  }
  async function inspect(names) {
    const r = await c(['inspect', '--type', 'container', ...names]);
    let arr = []; try { arr = JSON.parse(r.stdout || '[]'); } catch { /* none */ }
    if (r.code !== 0 && !arr.length) throw await failure(names.length === 1 ? names[0] : null, r, 'docker inspect');
    return arr;
  }
  const tagsOf = (labels = {}) => Object.fromEntries(Object.entries(labels || {}).filter(([k]) => k.startsWith('worca.') && !['worca.network', 'worca.backend'].includes(k)).map(([k, v]) => [k.slice(6), v]));

  function execArgs(box, { user, env: cmdEnv, stdin, extra = [] }) {
    const uid = userOf(user);
    const args = ['exec', ...(stdin ? ['-i'] : []), '-u', uid, '-e', `HOME=${HOMES[uid]}`];
    const pass = {};
    for (const [k, v] of Object.entries(cmdEnv || {})) {
      if (!ENV_NAME.test(k) || typeof v !== 'string' || k === 'WORCA_CMD_ID') continue;
      // A name the docker CLI reads itself goes on the argv (never a secret-named one, which is dropped): values on the
      // argv show in `ps` on this machine.
      if (CLI_ENV.test(k)) { if (!SECRET_NAME.test(k)) args.push('-e', `${k}=${v}`); continue; }
      args.push('-e', k); pass[k] = v;
    }
    args.push(...extra, box.name);
    return { args, env: pass, uid };
  }

  async function killInside(box, uid, token) {
    const r = await c(['exec', '-u', uid, box.name, 'bash', '-c', KILL_SCRIPT, 'worca-kill', token], { timeoutMs: 15_000 }).catch(() => null);
    return !!r && r.code === 0;
  }

  async function run(box, cmd, { background = false, cwd, env: cmdEnv, user, timeoutMs, stdin = false, onStdout, onStderr } = {}) {
    const token = randomBytes(12).toString('hex');
    const { args, env: pass, uid } = execArgs(box, { user, env: cmdEnv, stdin });
    args.push('bash', '-c', WRAPPER_SCRIPT, `worca-cmd:${token}`, cwd || '', cmd);
    let child;
    try { child = runner.spawn(args, { env: pass, stdin }); } catch (err) { throw unreachableError(err?.code || err?.message, err); }
    let out = ''; let err = ''; let killed = false; let timedOut = false; let killing = null;
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    // A stdin command is the long-lived model relay: its stdout carries every request body, so none of it is kept.
    child.stdout.on('data', (d) => { if (!stdin && out.length < KEEP_OUTPUT) out += d; try { onStdout?.(d); } catch { /* a listener */ } });
    child.stderr.on('data', (d) => { if (!stdin) err = (err + d).slice(-KEEP_STDERR); try { onStderr?.(d); } catch { /* a listener */ } });
    child.stdin?.on?.('error', () => {});
    const closed = new Promise((res) => {
      child.once('error', (e) => res({ spawnError: e }));
      child.once('close', (code, signal) => res({ code: code ?? (signal ? 137 : 1) }));
    });
    const kill = () => {
      if (killing) return killing;
      killed = true;
      killing = (async () => {
        await killInside(box, uid, token);
        try { child.kill('SIGKILL'); } catch { /* gone */ }
        return true;
      })();
      return killing;
    };
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; kill(); }, timeoutMs) : null;
    timer?.unref?.();
    let result = null;
    const wait = () => (result ||= (async () => {
      const r = await closed; clearTimeout(timer);
      if (r.spawnError) throw unreachableError(r.spawnError.code === 'ENOENT' ? 'the docker command is not installed' : r.spawnError.code || r.spawnError.message, r.spawnError);
      const exitCode = killed ? 137 : r.code;
      if (exitCode === 0) return { exitCode, stdout: out, stderr: err };
      // The CLI says so when the container is gone or the daemon is away; a command can print the same, so the
      // container's state decides.
      if (!killed && (GONE_RE.test(err) || DAEMON_RE.test(err))) {
        const st = await stateOf(box.name);
        if (st === 'gone') throw goneError(box.name, firstLine(err));
        if (st === 'unreachable') throw unreachableError(firstLine(err));
      }
      throw new DockerExitError(timedOut ? `the command timed out after ${Math.round(timeoutMs / 1000)} s` : `exit ${exitCode}`,
        { exitCode: timedOut ? 124 : exitCode, stdout: out, stderr: err });
    })());
    if (!background) return wait();
    const h = { pid: undefined, wait, kill };
    if (stdin) {
      h.sendStdin = (data) => new Promise((res, rej) => {
        if (!child.stdin?.writable) { rej(new Error('the command\'s stdin is closed')); return; }
        child.stdin.write(data, (e) => (e ? rej(e) : res()));
      });
    }
    return h;
  }

  /** `data` to `path` as `user` (parents made as that user; remote-env made the mirrored ones as root first). */
  async function writeAs(box, path, data, user) {
    const { args, env: pass } = execArgs(box, { user, stdin: true });
    args.push('sh', '-c', WRITE_SCRIPT, 'worca-write', path);
    const r = await call(runner, args, { input: Buffer.isBuffer(data) ? data : Buffer.from(data), env: pass, timeoutMs: 10 * 60_000 });
    if (r.code !== 0) throw await failure(box.name, r, `writing ${path}`);
  }

  async function readFileIn(box, path, { maxBytes = null } = {}) {
    const { args } = execArgs(box, {});
    args.push(...(maxBytes == null ? ['cat', '--', path] : ['head', '-c', String(maxBytes + 1), '--', path]));
    const r = await call(runner, args, { binary: true, timeoutMs: 10 * 60_000 });
    if (r.code !== 0) {
      const e = await failure(box.name, r, `reading ${path}`);
      if (/No such file/i.test(r.stderr)) e.code = 'ENOENT';
      throw e;
    }
    if (maxBytes != null && r.stdout.length > maxBytes) throw Object.assign(new Error(`${path} is larger than ${maxBytes} bytes`), { code: 'E_TOO_LARGE' });
    return r.stdout;
  }

  async function imageId(name) {
    const r = await c(['image', 'inspect', '--format', '{{.Id}}', name]);
    if (r.code === 0) return r.stdout.trim() || null;
    if (DAEMON_RE.test(r.stderr)) throw unreachableError(firstLine(r.stderr));
    return null;
  }
  /** `docker build -` of `dockerfile` (no context: the file has no COPY). Every line goes to onLine. */
  async function buildImage({ name, dockerfile, labels = {}, onLine = () => {} }) {
    const args = ['build', '-t', name, ...Object.entries(labels).flatMap(([k, v]) => ['--label', `${k}=${v}`]), ...buildProxyArgs(env), '-'];
    const r = await call(runner, args, { input: dockerfile, onLine, timeoutMs: BUILD_TIMEOUT_MS, env: { BUILDKIT_PROGRESS: 'plain' } });
    if (r.code !== 0) {
      if (DAEMON_RE.test(r.stderr)) throw unreachableError(firstLine(r.stderr));
      const tail = r.stderr.trim().split('\n').slice(-3).join(' | ').slice(0, 600);
      throw new Error(`docker build of ${name} failed: ${tail || `exit ${r.code}`}`);
    }
    return imageId(name);
  }
  /** The default image, built here on first use from the files shipped with Worca (one build at a time). */
  /** `onPhase('image-build')` while the build runs and `onPhase(null)` after it (the run page's "building the sandbox
   *  image" state); also for a run that waits on another run's build of the same image. */
  async function ensureImage(image, onLog, onPhase = () => {}) {
    if (await imageId(image)) return;
    if (image === defaultImageName()) {
      if (!building.has(image)) {
        const p = (async () => {
          onLog(`building the sandbox image ${image} on this machine (first use; this takes a few minutes, once per Worca upgrade)`);
          let steps = 0;
          const id = await buildImage({ name: image, dockerfile: renderSandboxDockerfile(), labels: { 'worca.base': dockerBaseVersion() },
            onLine: (l) => { const m = /^#\d+ \[(?:\S+ )?(\d+\/\d+)\] (.{0,120})/.exec(l); if (m && ++steps <= 40) onLog(`image build ${m[1]}: ${m[2]}`); } });
          onLog(`sandbox image ${image} built (${String(id || '').slice(7, 19) || 'ok'})`);
        })().finally(() => building.delete(image));
        building.set(image, p);
      }
      onPhase('image-build');
      try { await building.get(image); } finally { onPhase(null); }
      return;
    }
    if (image.startsWith(`${DEFAULT_IMAGE_REPO}-`)) {
      throw Object.assign(new Error(`the project image ${image} is not on this machine's Docker. Rebuild it on the project page, or clear the project's build.`), { errorClass: 'config' });
    }
    // Any other image: docker run pulls it.
  }

  async function startEgress(box, network, onLog) {
    if (!runner.network) return null;
    const { EgressRelay } = await import('./docker-egress.mjs');
    const exec = async () => {
      const { args } = execArgs(box, { user: HELPER_USER, stdin: true });
      args.push('node', RELAY_PATH, String(EGRESS_PORT));
      return runner.spawn(args, { stdin: true });
    };
    let restarts = 0;
    const begin = async () => {
      const relay = new EgressRelay({ exec, network, env, lookup, log: onLog, onExit: (code) => {
        if (relays.get(box.name) !== relay) return;
        relays.delete(box.name);
        if (++restarts > 5) { onLog(`sandbox network: the relay keeps stopping (exit ${code}); the sandbox has no network now`); return; }
        setTimeout(() => { if (!relays.has(box.name)) begin().catch((e) => onLog(`sandbox network: the relay did not restart: ${e?.message || e}`)); }, 1000 * restarts).unref?.();
      } });
      relays.set(box.name, relay);
      try { await relay.start(); } catch (err) { if (relays.get(box.name) === relay) relays.delete(box.name); throw err; }
      return relay;
    };
    await writeAs(box, RELAY_PATH, await readFile(RELAY_SCRIPT), HELPER_USER);
    return begin();
  }
  async function stopEgress(name) { const r = relays.get(name); relays.delete(name); if (r) await r.stop().catch(() => {}); }

  return {
    async create({ environment, tags = {}, timeoutMs, network = null, onLog = () => {}, onPhase = () => {} }) {
      if (!isImageRef(environment)) throw Object.assign(new Error(`"${environment}" is not a Docker image reference`), { errorClass: 'config' });
      const { resources: fromSettings, warnings } = resources ? { resources: { ...DEFAULT_RESOURCES, ...resources }, warnings: [] } : await settingsResources();
      for (const w of warnings) onLog(w);
      await ensureImage(environment, onLog, onPhase);
      const flags = assertHardened(hardeningArgs(fromSettings));
      const name = `worca-${String(tags.worcaRunId || 'run').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 40)}-${randomBytes(3).toString('hex')}`;
      const labels = { ...Object.fromEntries(Object.entries(tags).map(([k, v]) => [LABEL(k), String(v)])), [LABEL('backend')]: 'docker',
        [LABEL('network')]: JSON.stringify(network ? { allowOut: network.allowOut || [], denyOut: network.denyOut || [] } : null) };
      const proxy = `http://127.0.0.1:${EGRESS_PORT}`;
      const proxyEnv = runner.network ? ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'].flatMap((k) => ['-e', `${k}=${proxy}`])
        .concat(['NO_PROXY', 'no_proxy'].flatMap((k) => ['-e', `${k}=127.0.0.1,localhost,::1`])) : [];
      const secs = Math.max(60, Math.ceil((timeoutMs || 30 * 60_000) / 1000));
      const args = ['run', '-d', '--rm', '--name', name, ...Object.entries(labels).flatMap(([k, v]) => ['--label', `${k}=${v}`]),
        ...flags, ...proxyEnv, '--entrypoint', '/bin/sh',
        ...(environment.startsWith(DEFAULT_IMAGE_REPO) ? ['--pull', 'never'] : []),
        environment, '-c', WATCHDOG_SCRIPT, 'worca-watchdog', `${prefixOf(name)}${DEADLINE_FILE}`, String(secs), String(WATCHDOG_POLL_S)];
      const r = await c(args, { timeoutMs: 10 * 60_000 });   // a first pull of another image can take a while
      if (r.code !== 0) {
        if (DAEMON_RE.test(r.stderr)) throw unreachableError(firstLine(r.stderr));
        throw Object.assign(new Error(`docker run failed: ${firstLine(r.stderr) || `exit ${r.code}`}`), { stderr: r.stderr });
      }
      const h = handle(name);
      onLog(`container ${name}: ${fromSettings.memory} memory, ${fromSettings.cpus} CPUs, ${fromSettings.pids} processes${fromSettings.runtime ? `, runtime ${fromSettings.runtime}` : ''}, no mounts, network only through Worca (${network ? 'listed hosts' : 'open'})`);
      try { await startEgress(h.box, network, onLog); }
      catch (err) { await c(['rm', '-f', name]).catch(() => {}); throw new Error(`the sandbox network relay did not start: ${err?.message || err}`, { cause: err }); }
      return h;
    },
    async connect(id) {
      const [info] = await inspect([id]);
      if (!info?.State?.Running) throw goneError(id, 'it is not running');
      const h = handle(id);
      if (runner.network && !relays.get(id)?.alive) {
        await stopEgress(id);
        let network = null; try { network = JSON.parse(info.Config?.Labels?.[LABEL('network')] || 'null'); } catch { /* open */ }
        // The previous Worca process's relay ended with its stdin; one still running would hold the port.
        await c(['exec', '-u', HELPER_USER, id, 'sh', '-c', 'pkill -f "egress-rela[y].mjs" ; exit 0']).catch(() => {});
        await startEgress(h.box, network, () => {});
      }
      return h;
    },
    async info(id) {
      const [info] = await inspect([id]);
      if (!info?.State?.Running) throw goneError(id, 'it is not running');
      return { id, tags: tagsOf(info.Config?.Labels) };
    },
    async list(tags = {}) {
      const r = await c(['ps', '-a', '--no-trunc', '--format', '{{.Names}}', ...Object.entries(tags).flatMap(([k, v]) => ['--filter', `label=${LABEL(k)}=${v}`])]);
      if (r.code !== 0) throw await failure(null, r, 'docker ps');
      const names = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      if (!names.length) return [];
      const infos = await inspect(names).catch(() => []);
      return names.map((n) => ({ id: n, tags: tagsOf(infos.find((i) => String(i?.Name || '').replace(/^\//, '') === n)?.Config?.Labels) }));
    },
    async remove(id) {
      await stopEgress(id);
      const r = await c(['rm', '-f', id]);
      if (r.code === 0) return true;
      if (DAEMON_RE.test(r.stderr)) throw unreachableError(firstLine(r.stderr));
      if (GONE_RE.test(r.stderr)) return false;
      throw new Error(`docker rm failed: ${firstLine(r.stderr)}`);
    },
    async countRunning({ timeoutMs } = {}) {
      const r = await c(['ps', '-q', '--filter', `label=${LABEL('worca')}=1`], timeoutMs ? { timeoutMs } : {});
      if (r.code !== 0) throw await failure(null, r, 'docker ps');
      return r.stdout.split('\n').filter((s) => s.trim()).length;
    },
    run,
    readFile: readFileIn,
    writeFile: (box, path, data) => writeAs(box, path, data, SANDBOX_USER),
    async setTimeout(box, ms) {
      const { args } = execArgs(box, { user: HELPER_USER });
      args.push('sh', '-c', DEADLINE_SCRIPT, 'worca-deadline', `${box.prefix || ''}${DEADLINE_FILE}`, String(Math.max(1, Math.ceil(ms / 1000))));
      const r = await c(args);
      if (r.code !== 0) throw await failure(box.name, r, 'moving the sandbox deadline');
    },
    classifyError: (err) => (err?.dockerState === 'gone' ? 'gone' : err?.dockerState === 'unreachable' ? 'unreachable' : null),
    describe: () => (runner.kind === 'fake' ? 'the loopback fake (mock mode)' : "this machine's Docker"),
    async buildEnvironment(spec, { name, onLog = () => {} }) {
      const base = dockerBaseVersion();
      const id = await buildImage({ name, dockerfile: renderSandboxProjectDockerfile(spec), labels: { 'worca.base': base, 'worca.spec': spec.hash }, onLine: onLog });
      return { name, id, buildId: id ? String(id).replace(/^sha256:/, '').slice(0, 12) : null, specHash: spec.hash, baseVersion: base };
    },
    /** Tests: the relay of a container. */
    _relay: (name) => relays.get(name) || null,
  };
}

// ── the backend's own checks ──
const probes = new Map();   // CLI env key -> { at, result }
const PROBE_TTL_MS = 10_000;
/** Is the docker CLI here, and does it reach a daemon? Sync (the server's 409 path), cached for 10 s.
 *  { state: 'up', version } | { state: 'missing' } | { state: 'down', error } */
export function dockerProbe(env = process.env, { now = Date.now, spawn = spawnSync } = {}) {
  const bin = env.WORCA_DOCKER_BIN || 'docker';
  const key = `${bin}\0${env.DOCKER_HOST || ''}\0${env.DOCKER_CONTEXT || ''}`;
  const hit = probes.get(key);
  if (hit && now() - hit.at < PROBE_TTL_MS) return hit.result;
  let result;
  try {
    const r = spawn(bin, ['version', '--format', '{{.Server.Version}}'], { env: cliEnv(env), encoding: 'utf8', timeout: 4000, windowsHide: true });
    if (r.error?.code === 'ENOENT') result = { state: 'missing' };
    else if (r.status === 0 && String(r.stdout || '').trim()) result = { state: 'up', version: String(r.stdout).trim().slice(0, 40) };
    else result = { state: 'down', error: firstLine(r.stderr) || (r.error ? String(r.error.code || r.error.message) : `exit ${r.status}`) };
  } catch (err) { result = { state: 'down', error: String(err?.message || err) }; }
  probes.set(key, { at: now(), result });
  return result;
}
export function _resetDockerProbeForTests() { probes.clear(); }

export const DOCKER_MISSING = "The docker command is not installed on this machine (or not on the Worca server's PATH). Install Docker Desktop or Docker Engine, or pick Local.";
export const dockerDownText = (why) => `Docker is not running: \`docker version\` could not reach the Docker daemon${why ? ` (${why})` : ''}. Start Docker Desktop or the Docker service, then try again.`;

/** Run-start checks of a Local sandbox (Docker) run. Sync. */
export function dockerPreflight({ engine, isWorkspace, workMode = 'git', mock = false, env = process.env, platform = process.platform,
  brokerOn = false, runRootMode = 'detached', needsSignIn = true, probe = dockerProbe } = {}) {
  const errors = remotePreflight({ title: 'Docker', engine, isWorkspace, workMode, runRootMode, platform }); const warnings = [];
  const name = engine || 'claude';
  if (!mock) {
    const p = probe(env);
    if (p.state === 'missing') errors.push(DOCKER_MISSING);
    else if (p.state === 'down') errors.push(dockerDownText(p.error));
    if (needsSignIn && REMOTE_ENGINES.includes(name) && !(name === 'claude' && brokerOn)) {
      const cred = engineCredential(name, env);
      if (cred.problem) errors.push(cred.problem);
    }
  }
  warnings.push('The host guard is off inside the sandbox (no worca server runs there to protect).');
  return { errors, warnings };
}

/** The live status (GET /api/exec-envs/status). Never throws. */
async function dockerStatus({ env = process.env, mock = false } = {}) {
  if (mock) {
    try { const client = await dockerBackend.open({ mock: true, env }); return { state: 'connected', server: 'the loopback fake (mock mode)', running: await client.countRunning() }; }
    catch (err) { return { state: 'unreachable', server: 'the loopback fake (mock mode)', error: String(err?.message || err) }; }
  }
  const server = dockerServerIdentity(env).label;
  const runner = dockerCliRunner({ bin: env.WORCA_DOCKER_BIN || 'docker', env });
  let r;
  try { r = await call(runner, ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 4000 }); }
  catch (err) { return err?.cause?.code === 'ENOENT' ? { state: 'not-configured', server, error: DOCKER_MISSING } : { state: 'unreachable', server, error: String(err?.message || err) }; }
  if (r.code !== 0 || !r.stdout.trim()) return { state: 'unreachable', server, error: dockerDownText(firstLine(r.stderr)) };
  try { return { state: 'connected', server: `${server}, Docker ${r.stdout.trim().slice(0, 40)}`, running: await dockerClient(runner, { env }).countRunning({ timeoutMs: 4000 }) }; }
  catch (err) { return { state: 'unreachable', server, error: String(err?.message || err) }; }
}

/** Which Docker daemon `env` points at: a build records it, and a build made on another daemon is not used. */
export function dockerServerIdentity(env = process.env) {
  const where = env.DOCKER_HOST ? String(env.DOCKER_HOST).replace(/\/\/[^@/]*@/, '//') : `context ${env.DOCKER_CONTEXT || 'default'}`;
  return { id: `docker:${where}`, label: `Docker on this machine (${where})` };
}

/** The sandbox network of a project whose `egress` is `allow`: WORCA_EGRESS_ALLOW (empty: the default list; ".x" is x
 *  and its subdomains) minus WORCA_EGRESS_DENY, enforced by Worca's relay (docker-egress.mjs); null while it is open. */
export function dockerNetwork({ config = {}, env = process.env } = {}) {
  if (config?.egress !== 'allow') return null;
  const deny = parseHostList(env.WORCA_EGRESS_DENY).filter((d) => d !== '.invalid');
  const allowOut = parseAllow(env.WORCA_EGRESS_ALLOW).filter((a) => !deny.includes(a) && !deny.some((d) => !a.startsWith('.') && hostMatches(a, d, { subdomainsOnly: true })));
  return { allowOut, denyOut: deny };
}

export const DOCKER_EGRESS_HELP = 'Both modes send every connection through Worca on this machine: a raw socket reaches nothing, and no address of this machine is reachable. Open reaches any public host; Allow reaches only the listed hosts, which may be on your local network. A tool that ignores HTTPS_PROXY gets no network, and ssh git remotes fail (use HTTPS).';

let override = null;                 // tests: a runner (docker-fake.mjs or a stub)
const mockFakes = new Map();         // fake root -> runner (tests switch WORCA_HOME between cases)
export function _setDockerRunnerForTests(runner) { override = runner; }

const FROM = { project: 'the project setting', build: "the project's build", env: 'WORCA_DOCKER_IMAGE', default: 'the default' };

export const dockerBackend = Object.freeze({
  name: 'docker',
  label: 'Local sandbox (Docker)',
  title: 'Docker',
  environmentNoun: 'image',
  workDir: WORK_DIR,
  capabilities: Object.freeze({ pause: false, buildEnvironment: true,
    defaultMaxConcurrent: DEFAULT_DOCKER_MAX_SANDBOXES, defaultMaxWaitMin: DEFAULT_DOCKER_MAX_WAIT_MIN }),
  limitSettings: Object.freeze({ maxConcurrent: 'dockerMaxSandboxes', maxWaitMin: 'dockerMaxWaitMin' }),
  // Worca's own settings for this backend: never handed to an agent, script or action.
  secretEnv: /^WORCA_DOCKER_/,
  projectFields: Object.freeze([
    Object.freeze({ key: 'image', label: 'Docker image', hint: 'a Docker image reference (lowercase name, optional :tag or @sha256: digest)', validate: isImageRef }),
    Object.freeze({ key: 'egress', label: 'Sandbox network', hint: 'open or allow', help: DOCKER_EGRESS_HELP, placeholder: 'open',
      options: Object.freeze([Object.freeze({ value: 'open', label: 'Open' }), Object.freeze({ value: 'allow', label: 'Allow listed hosts only' })]),
      validate: (v) => v === 'open' || v === 'allow' }),
  ]),
  network: (o) => dockerNetwork(o),
  networkHelp: DOCKER_EGRESS_HELP,
  preflight: (ctx) => dockerPreflight(ctx),
  configured: (env = process.env) => dockerProbe(env).state === 'up',
  async open({ mock = false, env = process.env } = {}) {
    if (override) return dockerClient(override, { env });
    if (mock) {
      const [{ createFakeDocker }, { worcaHome }, { join }] = await Promise.all([import('./docker-fake.mjs'), import('../../projects.mjs'), import('node:path')]);
      const root = join(worcaHome(), 'tmp', 'docker-fake');
      if (!mockFakes.has(root)) mockFakes.set(root, createFakeDocker({ root }).runner);
      return dockerClient(mockFakes.get(root), { env });
    }
    return dockerClient(dockerCliRunner({ bin: env.WORCA_DOCKER_BIN || 'docker', env }), { env });
  },
  /** Project setting → the project's build → WORCA_DOCKER_IMAGE → the default image (built here on first use). */
  resolveEnvironment({ config = {}, build = null, env = process.env } = {}) {
    const pick = (name, source) => ({ name, source, from: FROM[source] });
    if (typeof config.image === 'string' && config.image) return pick(config.image, 'project');
    if (typeof build?.name === 'string' && build.name) return pick(build.name, 'build');
    if (isImageRef(env.WORCA_DOCKER_IMAGE)) return pick(env.WORCA_DOCKER_IMAGE, 'env');
    return pick(defaultImageName(), 'default');
  },
  serverIdentity: (env = process.env) => dockerServerIdentity(env),
  status: (o) => dockerStatus(o),
  baseVersion: () => dockerBaseVersion(),
  environmentName: (projectKey) => projectImageName(projectKey),
});
