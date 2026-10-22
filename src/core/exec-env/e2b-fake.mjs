// src/core/exec-env/e2b-fake.mjs
// A loopback stand-in for the `e2b` SDK subset worca uses: tests and WORCA_MOCK=1 runs.
// A "sandbox" is a host directory; commands run with real bash there. Never used with
// real E2B. `onCommand(cmd, opts)` may return { lines, stderr, exitCode } to fake a
// command (e.g. a canned `claude` stream) instead of running it, or throw to fake an SDK error.
//
// Like envd (plans/2026-10-22-e2b-kill-egress-checks.md §1), a command's pid does not lead a process group (it runs in
// the group of a per-command stand-in for envd's) and a handle kill reaches that one pid only: a backgrounded
// grandchild survives it, as it does in E2B. `setsid` is on PATH (a perl shim where the host has none: macOS).
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, createReadStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { delimiter, dirname, join } from 'node:path';

const named = (name) => class extends Error { constructor(m, extra = {}) { super(m); this.name = name; Object.assign(this, extra); } };
export const SandboxNotFoundError = named('SandboxNotFoundError');
export const SandboxNotRunningError = named('SandboxNotRunningError');
export const SandboxUnreachableError = named('SandboxUnreachableError');
export const CommandExitError = named('CommandExitError');
/** E2B 2.56.0's control-plane error: a 400 at create is a SandboxError with `statusCode` and a "400: <reason>" message. */
export const SandboxError = named('SandboxError');

const ALL_TRAFFIC = '0.0.0.0/0';
const isAddress = (entry) => /^[0-9.]+(?:\/\d{1,2})?$/.test(entry) || entry.includes(':');
/** What the self-hosted E2B 2.56.0 refuses in `network` at create (plans/2026-10-22-e2b-kill-egress-checks.md §2):
 *  a host name in denyOut, and a host name in allowOut without ALL_TRAFFIC in denyOut. null = accepted. */
function networkRefusal(network) {
  if (!network) return null;
  const allow = network.allowOut || []; const deny = network.denyOut || [];
  const name = deny.find((d) => !isAddress(d));
  if (name) return `invalid denied CIDR ${name}`;
  if (allow.some((a) => !isAddress(a)) && !deny.includes(ALL_TRAFFIC)) {
    return "When specifying allowed domains in allow out, you must include 'ALL_TRAFFIC' in deny out to block all other traffic.";
  }
  return null;
}

export function createFakeE2b({ root, onCommand = null, logFile = null } = {}) {
  const live = new Map();   // sandboxId -> FakeSandbox
  const events = [];
  let seq = 0;
  const log = (e) => { const row = { at: Date.now(), ...e }; events.push(row); if (logFile) { mkdirSync(dirname(logFile), { recursive: true }); appendFileSync(logFile, JSON.stringify(row) + '\n'); } };
  // Everything a command started: its envd stand-in's group, and the group its pid leads after `setsid`.
  const killGroup = (c) => { for (const g of [c.pid, c.innerPid]) { if (g) { try { process.kill(-g, 'SIGKILL'); } catch { /* none */ } } } try { c.kill('SIGKILL'); } catch { /* gone */ } };
  // A `setsid` for hosts without one (macOS): `setsid -w cmd` from a process that leads no group (as here) runs cmd in
  // a new session without forking, so its pid leads the new group.
  let shimDir = null;
  if (spawnSync('sh', ['-c', 'command -v setsid'], { stdio: 'ignore' }).status !== 0) {
    shimDir = join(root, '.fake-bin'); mkdirSync(shimDir, { recursive: true });
    writeFileSync(join(shimDir, 'setsid'), `#!/bin/sh\n[ "$1" = "-w" ] && shift\nexec perl -MPOSIX -e 'POSIX::setsid() or die "setsid: $!\\n"; exec { $ARGV[0] } @ARGV or die "setsid: $ARGV[0]: $!\\n"' -- "$@"\n`);
    chmodSync(join(shimDir, 'setsid'), 0o755);
  }
  const toBytes = async (data) => typeof data === 'string' ? Buffer.from(data) : data instanceof Blob ? Buffer.from(await data.arrayBuffer()) : Buffer.from(data);
  const control = (id) => { const sb = live.get(id); if (!sb) throw new SandboxNotFoundError(`sandbox ${id} not found`); return sb; };

  class FakeSandbox {
    constructor(id, template, { metadata = {}, timeoutMs = null } = {}) {
      this.sandboxId = id; this.templateId = template; this.metadata = metadata; this.timeoutMs = timeoutMs;
      this.pathPrefix = join(root, id); mkdirSync(join(this.pathPrefix, 'home', 'user'), { recursive: true });
      this.startedAt = new Date();
      this.children = new Set();
      const self = this;
      this.files = {
        async write(path, data) { self._alive(); await mkdir(dirname(path), { recursive: true }); await writeFile(path, await toBytes(data)); return { path }; },
        async read(path, { format = 'text' } = {}) {
          self._alive();
          if (format === 'stream') { await stat(path); return Readable.toWeb(createReadStream(path)); }
          const b = await readFile(path); return format === 'bytes' ? new Uint8Array(b) : b.toString('utf8');
        },
        async makeDir(path) { self._alive(); await mkdir(path, { recursive: true }); return true; },
      };
      this.commands = { run: (cmd, opts = {}) => self._run(cmd, opts) };
    }
    _alive() { if (!live.has(this.sandboxId)) throw new SandboxNotRunningError(`sandbox ${this.sandboxId} is not running`); }
    async _run(cmd, { background = false, cwd, envs = {}, user, stdin = false, onStdout, onStderr } = {}) {
      this._alive();
      log({ type: 'command', sandboxId: this.sandboxId, cmd: cmd.slice(0, 400), ...(user ? { user } : {}) });
      // A sandbox has its own pid namespace: a group kill reaches only a group this sandbox started (here the commands
      // run on the host, so any other pid is someone else's process).
      const groupKill = /^kill -[A-Z]+ -- -(\d+)\b/.exec(cmd);
      if (groupKill && ![...this.children].some((c) => c.innerPid === Number(groupKill[1]))) return background ? { pid: ++seq, wait: async () => ({ exitCode: 0, stdout: '', stderr: '' }), kill: async () => true } : { exitCode: 0, stdout: '', stderr: '' };
      // onCommand sees the step's own command: a RemoteChild's group wrapper (`exec setsid -w `) is not part of it.
      const canned = onCommand ? await onCommand(cmd.replace(/^exec setsid -w /, ''), { cwd, envs, user, sandbox: this }) : null;   // may throw
      let stdout = ''; let stderr = ''; let killed = false; let child = null;
      const done = new Promise((resolveP) => {
        if (canned) {
          setImmediate(() => { for (const l of canned.lines || []) { stdout += l + '\n'; onStdout?.(l + '\n'); }
            if (canned.stderr) { stderr += canned.stderr; onStderr?.(canned.stderr); }
            resolveP(canned.exitCode ?? 0); });
          return;
        }
        // node first on PATH: the snapshot (`node -e`) and script nodes need it even when the test
        // runner was started by absolute path. tools/test.mjs's no-real-claude dir stays on PATH.
        // The envd stand-in leads a group; the command (`bash -c cmd`, its pid the handle's) runs in it. fd 3 says its pid.
        child = spawn('bash', ['-c', 'bash -c "$1" 0<&0 3>&- & echo $! >&3; exec 3>&-; wait $!', 'envd', cmd], { cwd: cwd || this.pathPrefix, detached: true,
          stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
          env: { PATH: [shimDir, dirname(process.execPath), process.env.PATH || ''].filter(Boolean).join(delimiter), HOME: join(this.pathPrefix, 'home', 'user'), ...envs } });
        this.children.add(child);
        child.stdin.on('error', () => {});   // a write after the command closed its stdin (EPIPE) must not crash the process
        child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; onStdout?.(d); });
        child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; onStderr?.(d); });
        // Like envd, the command ends when its process does, not when the last holder of its pipes does (a backgrounded
        // grandchild keeps them open): a short drain for the output, then the exit code.
        let closed = false;
        child.on('close', () => { closed = true; });
        child.on('exit', (code) => {
          const end = () => { this.children.delete(child); resolveP(killed ? 137 : code ?? 1); };
          if (closed) end(); else { const t = setTimeout(end, 200); child.on('close', () => { clearTimeout(t); end(); }); }
        });
      });
      const wait = async () => { const exitCode = await done;
        if (exitCode !== 0) throw new CommandExitError(`exit ${exitCode}`, { exitCode, stdout, stderr });
        return { exitCode, stdout, stderr }; };
      if (child) {
        child.innerPid = await new Promise((res) => { let b = ''; child.stdio[3].setEncoding('utf8').on('data', (d) => { b += d; }).on('end', () => res(Number(b.trim()) || null)).on('error', () => res(null)); });
      }
      // E2B kills the command's pid only (SIGKILL): what it started keeps running, as in a real sandbox.
      const handle = { pid: child ? (child.innerPid ?? child.pid) : ++seq, wait, kill: async () => {
        killed = true; if (child) { try { process.kill(child.innerPid ?? child.pid, 'SIGKILL'); } catch { /* gone */ } } return true; },
        get stdout() { return stdout; }, get stderr() { return stderr; } };
      if (stdin && child) handle.sendStdin = (d) => new Promise((res, rej) => child.stdin.write(d, (e) => (e ? rej(e) : res())));
      return background ? handle : wait();
    }
    async setTimeout(ms) { control(this.sandboxId); this.timeoutMs = ms; log({ type: 'setTimeout', sandboxId: this.sandboxId, ms }); }
    async kill() { return Sandbox.kill(this.sandboxId); }
  }

  const info = (sb) => ({ sandboxId: sb.sandboxId, templateId: sb.templateId, metadata: { ...sb.metadata }, startedAt: sb.startedAt, state: 'running' });
  class Sandbox {
    static async create(template, opts = {}) {
      const refused = networkRefusal(opts.network);
      if (refused) throw new SandboxError(`400: ${refused}`, { statusCode: 400 });
      const sb = new FakeSandbox(`fake${++seq}${Date.now().toString(36)}`, template, opts);
      live.set(sb.sandboxId, sb);
      log({ type: 'create', sandboxId: sb.sandboxId, template, metadata: opts.metadata || {}, ...(Object.hasOwn(opts, 'network') ? { network: opts.network } : {}) });
      return sb;
    }
    static async connect(id) { const sb = control(id); log({ type: 'connect', sandboxId: id }); return sb; }
    static async getInfo(id) { return info(control(id)); }
    static async kill(id) {
      const sb = live.get(id); if (!sb) return false;
      live.delete(id); for (const c of sb.children) killGroup(c);
      rmSync(sb.pathPrefix, { recursive: true, force: true }); log({ type: 'kill', sandboxId: id }); return true;
    }
    static list({ query = {} } = {}) {
      const want = query.metadata || {};
      const items = [...live.values()].filter((sb) => Object.entries(want).every(([k, v]) => sb.metadata[k] === v)).map(info);
      let done = false;
      return { get hasNext() { return !done; }, async nextItems() { done = true; return items; } };
    }
  }
  return { Sandbox, CommandExitError, SandboxError, SandboxNotFoundError, SandboxNotRunningError, SandboxUnreachableError, events, live };
}
