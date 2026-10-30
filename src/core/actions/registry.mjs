// src/core/actions/registry.mjs — every running action process Worca started, one per
// instance id (D16). Emits 'line' and 'status'; the server turns them into action-* frames.
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import net from 'node:net';
import { spawnChildSync } from '../spawn.mjs';
import { spawnActionProcess, stopProcess, actionBaseEnv } from './spawn.mjs';
import { allocatePort, DEFAULT_PORT_RANGE } from './ports.mjs';
import { expandPlaceholders, resolveCwd } from './model.mjs';

export const instanceIdFor = (runId, member, actionId) => `act:${runId}:${member}:${actionId}`;
const ACTIVE = new Set(['starting', 'running', 'ready']);
const TERMINAL = new Set(['exited', 'failed', 'stopped']);
// The state file (Ask Worca reads it from its own process): the last lines of each log, and how many
// finished instances it keeps. Small on purpose: it is rewritten on every status change.
const TAIL_LINES = 40;
const TAIL_LINE_CHARS = 400;
const STATE_FINISHED_KEEP = 20;
const STATE_WRITE_DELAY_MS = 500;

export class ActionRegistry extends EventEmitter {
  constructor({ pidFile, stateFile = null, portRange = () => DEFAULT_PORT_RANGE, platform = process.platform, now = Date.now } = {}) {
    super();
    this.pidFile = pidFile; this.stateFile = stateFile; this.portRange = portRange; this.platform = platform; this.now = now;
    this._stateTimer = null;
    // instanceId -> { snap, child, reserved:Set<number>, pending:Promise|null }. `snap` is NEVER
    // null: a slot is inserted with a complete 'starting' snapshot, so readers (get/list/heldPorts,
    // a concurrent start) never see a half-built entry.
    this.instances = new Map();
    this._alloc = Promise.resolve();   // serialises port allocation (no two starts pick one port)
  }

  get(id) { return this.instances.get(id)?.snap ?? null; }
  list() { return [...this.instances.values()].map((i) => ({ ...i.snap })); }
  listFor(runId) { return this.list().filter((s) => s.runId === runId); }
  running() { return this.list().filter((s) => ACTIVE.has(s.status)); }
  heldPorts(exceptId = null) {
    const held = new Set();
    for (const [id, i] of this.instances) if (id !== exceptId && ACTIVE.has(i.snap.status)) for (const p of i.reserved) held.add(p);
    return held;
  }

  /** spec: { runId, member, worktreeDir, branch, action, extraEnv?, extraVars?, stackId? } */
  async start(spec) {
    const { runId, member, worktreeDir, action } = spec;
    const instanceId = instanceIdFor(runId, member, action.id);
    const cur = this.instances.get(instanceId);
    if (cur && ACTIVE.has(cur.snap.status)) {                 // idempotent (D16), also mid-allocation
      if (cur.pending) await cur.pending.catch(() => {});
      return { ...(this.get(instanceId) || cur.snap), warnings: [], alreadyActive: true };
    }
    // Validate BEFORE anything is reserved: a bad cwd or a missing checkout must leave no slot behind.
    if (!worktreeDir) throw Object.assign(new Error('the run is not checked out'), { code: 'NOT_CHECKED_OUT' });
    const cwd = resolveCwd(worktreeDir, action.cwd);          // throws ActionConfigError (400)

    const slot = { child: null, reserved: new Set(), pending: null, tail: [], snap: {
      instanceId, runId, member, actionId: action.id, label: action.label, kind: action.kind,
      status: 'starting', pid: null, ports: {}, url: null,
      startedAt: this.now(), endedAt: null, exitCode: null, readyError: null, stackId: spec.stackId || null,
    } };
    this.instances.set(instanceId, slot);
    let release;
    slot.pending = new Promise((r) => { release = r; });
    try {
      return await this._launch(slot, spec, cwd);
    } catch (err) {
      if (this.instances.get(instanceId) === slot) {
        if (cur) this.instances.set(instanceId, cur); else this.instances.delete(instanceId);
      }
      throw err;                                              // PORTS_EXHAUSTED → 409 in the route
    } finally { slot.pending = null; release(); }
  }

  async _launch(slot, spec, cwd) {
    const { runId, member, worktreeDir, branch, action } = spec;
    const { instanceId } = slot.snap;
    const warnings = [];
    const ports = slot.snap.ports;
    // Serialise allocation; a failed allocation must not poison the chain for later starts.
    const alloc = this._alloc.then(async () => {
      for (const e of action.env.filter((x) => x.type === 'port')) {
        if (e.value === 'auto') {
          ports[e.name] = await allocatePort({ range: this.portRange(), held: new Set([...this.heldPorts(instanceId), ...slot.reserved]) });
        } else {
          if (this.heldPorts(instanceId).has(e.value)) warnings.push(`port ${e.value} is already used by another running action`);
          ports[e.name] = e.value;
        }
        slot.reserved.add(ports[e.name]);
      }
    });
    this._alloc = alloc.catch(() => {});
    await alloc;

    const vars = { branch, worktree: worktreeDir, runId, member, ...ports, ...(spec.extraVars || {}) };
    const env = { ...actionBaseEnv() };
    for (const e of action.env) env[e.name] = e.type === 'port' ? String(ports[e.name]) : expandPlaceholders(e.value, vars);
    for (const e of spec.extraEnv || []) env[e.name] = expandPlaceholders(e.value, vars);
    const raw = this.platform === 'win32' && action.cmdWin32 ? action.cmdWin32 : action.cmd;
    const command = expandPlaceholders(raw, vars);
    slot.snap.url = action.openUrl ? expandPlaceholders(action.openUrl, vars) : null;

    this._status(slot);                                       // 'starting' (the server resets the ring buffer on it)
    this._sys(instanceId, `$ ${command}`);
    let outputHit = null;
    const child = spawnActionProcess({
      command, cwd, env, platform: this.platform,
      onLine: (stream, text) => {
        this._line(instanceId, stream, text);
        if (outputHit && text.includes(action.ready.text)) outputHit();
      },
    });
    slot.child = child;
    slot.snap.pid = child.pid ?? null;
    this._writePidFile();
    // 'close' also fires after a spawn 'error'; whichever comes first wins, the other is ignored.
    child.once('error', (err) => {
      if (TERMINAL.has(slot.snap.status)) return;
      this._sys(instanceId, `failed to start: ${err.message}`); this._finish(slot, 'failed', null);
    });
    child.once('close', (code, signal) => {
      if (TERMINAL.has(slot.snap.status)) return;             // stopped by us, or already failed
      this._finish(slot, action.kind === 'task' || code != null ? 'exited' : 'failed', code ?? (signal ? -1 : null));
    });

    if (!TERMINAL.has(slot.snap.status)) {
      slot.snap.status = 'running'; this._status(slot);
      if (action.kind === 'service') this._readyCheck(slot, action, ports, (fn) => { outputHit = fn; });
    }
    return { ...slot.snap, warnings };
  }

  _readyCheck(slot, action, ports, setOutputHook) {
    const r = action.ready || { kind: 'immediate' };
    const markReady = () => { if (slot.snap.status === 'running') { slot.snap.status = 'ready'; this._status(slot); } };
    if (r.kind === 'immediate') return markReady();
    const deadline = this.now() + r.timeoutMs;
    const timeout = () => {
      if (slot.snap.status !== 'running') return;
      slot.snap.readyError = r.kind === 'port'
        ? `The app never listened on port ${ports[r.port]} that Worca gave it (${r.port}).`
        : `The output never contained "${r.text}".`;
      this._status(slot);
    };
    if (r.kind === 'output') {
      setOutputHook(() => { setOutputHook(null); markReady(); });
      setTimeout(timeout, r.timeoutMs).unref();
      return;
    }
    const port = ports[r.port];
    // D21: IPv4 loopback first, then IPv6 loopback (Vite/Storybook bind `localhost` = ::1 on macOS).
    const answers = (host) => new Promise((res) => {
      const sock = net.connect({ host, port });
      sock.once('connect', () => { sock.destroy(); res(true); });
      sock.once('error', () => { sock.destroy(); res(false); });
    });
    const tick = async () => {
      if (slot.snap.status !== 'running') return;
      if (this.now() > deadline) return timeout();
      if ((await answers('127.0.0.1')) || (await answers('::1'))) return markReady();
      setTimeout(tick, 250).unref();
    };
    tick();
  }

  async stop(instanceId) {
    let slot = this.instances.get(instanceId);
    if (slot?.pending) { await slot.pending.catch(() => {}); slot = this.instances.get(instanceId); }  // let a mid-start spawn land, then stop it
    if (!slot || !ACTIVE.has(slot.snap.status)) return false;
    slot.snap.status = 'stopped';                     // set first: the close handler must not report 'exited'
    this._sys(instanceId, 'stopping…');
    await stopProcess(slot.child, { platform: this.platform });
    this._finish(slot, 'stopped', slot.child?.exitCode ?? null);
    return true;
  }

  /** Sequential, newest first (stack order matters). */
  async stopWhere(pred) {
    const ids = this.list().filter((s) => ACTIVE.has(s.status) && pred(s))
      .sort((a, b) => b.startedAt - a.startedAt).map((s) => s.instanceId);
    for (const id of ids) await this.stop(id);
    return ids;
  }
  /** Shutdown / discard-all: in parallel, so N services cost one grace period, not N. */
  async stopAll() {
    const ids = this.running().map((s) => s.instanceId);
    await Promise.allSettled(ids.map((id) => this.stop(id)));
    return ids;
  }

  async waitFor(instanceId, pred, timeoutMs = 20000) {
    const cur = this.get(instanceId);
    if (cur && pred(cur)) return cur;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.off('status', on); reject(new Error('waitFor timed out')); }, timeoutMs);
      const on = (s) => { if (s.instanceId === instanceId && pred(s)) { clearTimeout(t); this.off('status', on); resolve(s); } };
      this.on('status', on);
    });
  }

  _finish(slot, status, exitCode) {
    slot.snap.status = status; slot.snap.exitCode = exitCode; slot.snap.endedAt = this.now();
    slot.reserved.clear();
    this._writePidFile();
    this._status(slot);
  }
  _status(slot) { this.emit('status', { ...slot.snap }); this._writeStateFile(); }
  _sys(instanceId, text) { this._line(instanceId, 'sys', text); }
  _line(instanceId, stream, text) {
    const slot = this.instances.get(instanceId);
    if (slot) {
      slot.tail.push({ stream, text: String(text).slice(0, TAIL_LINE_CHARS) });
      if (slot.tail.length > TAIL_LINES) slot.tail.splice(0, slot.tail.length - TAIL_LINES);
      this._scheduleStateWrite();
    }
    this.emit('line', { instanceId, stream, text });
  }

  /** Lines arrive in bursts: one write per STATE_WRITE_DELAY_MS at most. A status change writes at once. */
  _scheduleStateWrite() {
    if (!this.stateFile || this._stateTimer) return;
    this._stateTimer = setTimeout(() => { this._stateTimer = null; this._writeStateFile(); }, STATE_WRITE_DELAY_MS);
    this._stateTimer.unref?.();
  }

  /** Every active instance plus the newest finished ones, each with its log tail (Ask Worca, readActionsState). */
  _writeStateFile() {
    if (!this.stateFile) return;
    if (this._stateTimer) { clearTimeout(this._stateTimer); this._stateTimer = null; }
    const all = [...this.instances.values()];
    const done = all.filter((i) => TERMINAL.has(i.snap.status)).sort((a, b) => (b.snap.endedAt || 0) - (a.snap.endedAt || 0)).slice(0, STATE_FINISHED_KEEP);
    const rows = [...all.filter((i) => !TERMINAL.has(i.snap.status)), ...done].map((i) => ({ ...i.snap, tail: i.tail.slice() }));
    try {
      mkdirSync(dirname(this.stateFile), { recursive: true });
      writeFileSync(`${this.stateFile}.tmp`, JSON.stringify({ ownerPid: process.pid, updatedAt: this.now(), instances: rows }));
      renameSync(`${this.stateFile}.tmp`, this.stateFile);
    } catch { /* best-effort: only Chat reads it */ }
  }

  _writePidFile() {
    if (!this.pidFile) return;
    const rows = [...this.instances.values()].filter((i) => ACTIVE.has(i.snap?.status) && i.child?.pid)
      .map((i) => ({ pid: i.child.pid, ownerPid: process.pid, instanceId: i.snap.instanceId, startedAt: i.snap.startedAt }));
    try {
      mkdirSync(dirname(this.pidFile), { recursive: true });
      writeFileSync(`${this.pidFile}.tmp`, JSON.stringify(rows));
      renameSync(`${this.pidFile}.tmp`, this.pidFile);
    } catch { /* best-effort: the exit reaper still covers a live server */ }
  }
}

const defaultAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/** POSIX: a detached action is its own group leader; refuse to kill a recycled pid that is not. */
async function defaultGroupLeader(pid, platform = process.platform) {
  if (platform === 'win32') return true;
  const r = spawnChildSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' });
  return r.status === 0 && Number(r.stdout.trim()) === pid;
}
function defaultKill(pid, platform = process.platform) {
  if (platform === 'win32') { spawnChildSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); return; }
  try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
}

/** Boot: kill processes a crashed server left behind (owner pid dead); keep the rest. */
export async function reapOrphans({ pidFile, isAlive = defaultAlive, isGroupLeader = defaultGroupLeader, kill = defaultKill } = {}) {
  let rows = [];
  try { rows = JSON.parse(readFileSync(pidFile, 'utf8')); } catch { return 0; }
  if (!Array.isArray(rows)) rows = [];
  let n = 0;
  const keep = [];
  for (const r of rows) {
    if (r?.ownerPid && r.ownerPid !== process.pid && !isAlive(r.ownerPid)) {
      if (isAlive(r.pid) && await isGroupLeader(r.pid)) { kill(r.pid); n++; }
    } else keep.push(r);
  }
  try { writeFileSync(pidFile, JSON.stringify(keep)); } catch { /* best-effort */ }
  return n;
}

/**
 * D12: run ids with a live action process, read from the pid file. It works in any process
 * (the harness's keep policy runs in the server process AND in the CLI), without needing the
 * server's registry object.
 */
export function busyRunIdsFromPidFile(pidFile, { isAlive = defaultAlive } = {}) {
  const out = new Set();
  let rows = [];
  try { rows = JSON.parse(readFileSync(pidFile, 'utf8')); } catch { return out; }
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r?.instanceId || !r.ownerPid || !isAlive(r.ownerPid)) continue;
    const runId = String(r.instanceId).split(':')[1];
    if (runId) out.add(runId);
  }
  return out;
}

/** The one pid-file location, shared by the server registry and the harness. */
export const actionsPidFile = (home) => join(home, 'actions', 'live.json');

/** Where the server's registry publishes its instances for readers in other processes (Ask Worca). */
export const actionsStateFile = (home) => join(home, 'actions', 'state.json');

/**
 * The registry's instances as the state file last recorded them. When the server that wrote it is
 * gone, its processes went with it (reapOrphans): active ones then read as 'stopped'.
 * @returns {{ serverRunning: boolean, instances: object[] }}
 */
export function readActionsState(stateFile, { isAlive = defaultAlive } = {}) {
  let doc = null;
  try { doc = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return { serverRunning: false, instances: [] }; }
  const list = Array.isArray(doc?.instances) ? doc.instances.filter((r) => r && typeof r.instanceId === 'string') : [];
  const serverRunning = !!(doc?.ownerPid && isAlive(doc.ownerPid));
  return { serverRunning, instances: serverRunning ? list : list.map((r) => (ACTIVE.has(r.status) ? { ...r, status: 'stopped' } : r)) };
}
