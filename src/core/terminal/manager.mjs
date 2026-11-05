// src/core/terminal/manager.mjs — worca-owned terminal sessions (issue #573). Each session is a shell
// the server runs under a PTY (or over pipes, pty.mjs); its output streams to the pane over /ws, and
// every command it runs is recorded as a block (markers.mjs) with who pressed Enter. Mirrors
// ActionRegistry: live state in memory, a pid file so the next boot reaps a crashed server's shells.
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MarkerParser } from './markers.mjs';
import { pickShell, shellLaunch, ensureZshDir, noBlocksMessage } from './shell.mjs';
import { spawnTerminal, loadPty, killDescendants, descendantPids, signalPids, signalDescendants,
  killTree, winShellPid, killWinCommands } from './pty.mjs';
import { terminalEnv } from './context.mjs';
import * as store from './store.mjs';
import { sameDir } from './same-dir.mjs';

export const MAX_SESSIONS = 16;
export const REPLAY_CHARS = 512 * 1024;        // live output kept per session for a reload's replay
export const BLOCK_OUTPUT_CAP = 256 * 1024;    // a block keeps the tail of its output
const MAX_INPUT = 64 * 1024;
const FLUSH_MS = 16;
const FLUSH_CHARS = 64 * 1024;                  // flush early once this much output is pending
const STOP_ESCALATE_MS = 3000;
const CLOSE_GRACE_MS = 1000;
const WIN_SHELL_WAIT_MS = 5000;                 // Windows close: how long to wait for Git Bash's real-shell lookup
const FOLDER_CHECK_MS = 5000;
const ENDED_KEEP = 20;                          // ended sessions kept in memory (their replay); the DB keeps all
const READY_MS = 5000;                          // runCommand: a fresh shell's first prompt
const ACK_MS = 5000;                            // runCommand: the C mark after a typed command

const iso = (ms) => new Date(ms).toISOString();
const clamp = (n, lo, hi, dflt) => { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : dflt; };
const codeError = (code, message) => Object.assign(new Error(message), { code });

function snapshot(s) {
  const b = s.block;
  return { ...s.snap, currentBlock: b ? { seq: b.seq, command: b.command, startedAt: iso(b.startedAt), runBy: b.runBy } : null };
}

export class TerminalManager extends EventEmitter {
  constructor({ pidFile = null, zshDir = null, spawnImpl = spawnTerminal, ptyInfo = () => loadPty(), shell = () => pickShell(),
    runLive = () => false, now = Date.now, platform = process.platform } = {}) {
    super();
    this.pidFile = pidFile;          // the server redefines these two as lazy getters (worcaHome() at use)
    this.zshDir = zshDir;
    Object.assign(this, { spawnImpl, ptyInfo, shell, runLive, now, platform });
    this.sessions = new Map();
    this.ptyError = null;          // D14: set once node-pty failed to spawn here
    this._folderTimer = null;
  }

  ptyStatus() {
    if (this.ptyError) return { available: false, reason: this.ptyError };
    const { pty, reason } = this.ptyInfo();
    return { available: !!pty, reason: pty ? null : (reason || null) };
  }
  get(id) { const s = this.sessions.get(id); return s ? snapshot(s) : null; }
  list() { return [...this.sessions.values()].map(snapshot).sort((a, z) => z.createdAt.localeCompare(a.createdAt)); }
  live() { return [...this.sessions.values()].filter((s) => s.snap.status === 'running'); }
  busyRunIds() { return new Set(this.live().map((s) => s.snap.runId).filter(Boolean)); }
  busyDirs() { return new Set(this.live().map((s) => s.snap.cwd)); }

  /** Everything still buffered, for a page that (re)attaches: { data, seq, segments } (seq = the last chunk's).
   *  `segments` splits it by the PTY size it was written at: a shell wraps for its width (zsh's long-line and
   *  partial-line marks), so the pane draws each part at that width before fitting the screen to itself. */
  replay(id) {
    const s = this.sessions.get(id);
    if (!s) return null;
    this._flush(s);
    const segments = [];
    for (const c of s.chunks) {
      const last = segments.at(-1);
      if (last && last.cols === c.cols && last.rows === c.rows) last.data += c.data;
      else segments.push({ cols: c.cols, rows: c.rows, data: c.data });
    }
    return { data: s.chunks.map((c) => c.data).join(''), seq: s.seq, segments };
  }

  async open({ cwd, scope, label = null, runId = null, member = null, projectKey = null, branch = null, workspace = false,
    runLive = false, by = 'local', cols = 100, rows = 30, actionSnaps = [], baseEnv = process.env, agent = false }) {
    if (this.live().length >= MAX_SESSIONS) throw codeError('TOO_MANY_SESSIONS', `At most ${MAX_SESSIONS} terminals can be open at once. Close one first.`);
    let ino;
    try { const st = statSync(cwd); if (!st.isDirectory()) throw new Error('not a folder'); ino = st.ino; }
    catch { throw codeError('NO_FOLDER', 'The folder for this terminal does not exist.'); }
    const id = `t-${randomBytes(5).toString('hex')}`;
    const nonce = randomBytes(8).toString('hex');                // D12: a mark without it is plain output
    const shell = this.shell();
    const zshDir = shell.kind === 'zsh' && this.zshDir ? ensureZshDir(this.zshDir) : null;
    const launch = shellLaunch(shell, { env: baseEnv, zshDir, nonce });
    const size = { cols: clamp(cols, 2, 500, 100), rows: clamp(rows, 1, 300, 30) };
    const spawnAs = (pty) => this.spawnImpl({ file: shell.file, args: launch.args, cwd, ...size, platform: this.platform, pty,
      env: terminalEnv({ base: baseEnv, sessionId: id, mode: pty ? 'pty' : 'pipes', runId, member, projectKey, branch, cwd, workspace,
        actionSnaps, shellEnv: launch.env, agent }) });
    const pty = this.ptyError ? null : this.ptyInfo().pty;
    let proc;
    try {
      proc = spawnAs(pty);
    } catch (e) {
      if (!pty) throw e;
      // D14: node-pty loads but cannot start a shell here. This and every later session use pipes.
      this.ptyError = `node-pty could not start a shell on this server (${String(e?.message || e).slice(0, 120)})`;
      console.warn(`[worca] terminal: ${this.ptyError}; using pipes`);
      proc = spawnAs(null);
    }
    const mode = proc.mode;
    const at = this.now();
    const s = {
      snap: { id, scope, label, runId, member, projectKey, branch, cwd, shell: shell.file, shellKind: shell.kind, mode, integration: false,
        status: 'running', exitCode: null, pid: proc.pid ?? null, createdBy: by, createdAt: iso(at), endedAt: null, closedBy: null,
        runLive: !!runLive, folder: 'ok', commands: 0, ...size },   // cols/rows: the PTY's size, so a replay is drawn at the width it was written for
      proc, parser: new MarkerParser({ nonce }), chunks: [], chunkChars: 0, seq: 0, pendingOut: '', flushTimer: null,
      block: null, blockSeq: 0, lastInputBy: by, cwdNow: cwd, ino, stopTimer: null, closing: null, exitWaiters: [],
      atPrompt: false, pendingRun: null, readyWaiters: [], startWaiters: [], winShellLookup: null,   // runCommand (#574)
    };
    try {
      store.insertSession(s.snap);
    } catch (e) {
      // No row means no record of what runs here, and nothing would ever end it: do not leave the shell.
      if (proc.pid) { if (this.platform === 'win32') killTree(proc.pid); else killDescendants(proc.pid, this.platform); }
      proc.signal('SIGKILL');
      throw e;
    }
    this.sessions.set(id, s);
    // Windows: Git Bash's real shell (under the bin\bash.exe launcher), found once in the background (CIM takes 1-2 s).
    if (this.platform === 'win32' && shell.kind === 'bash' && proc.pid) this._winShell(s).catch(() => {});
    store.recordAudit({ sessionId: id, runId, actor: by, action: 'open', detail: cwd, now: at });
    proc.onData((d) => this._onData(s, d));
    proc.onExit((e) => this._onExit(s, e));
    this.writePidFile();
    this._watchFolders();
    this.emit('status', snapshot(s));
    return snapshot(s);
  }

  /** Keystrokes from a person. A line end makes them the author of the command it submits. Emits 'input' (Ask keeps
   *  a session the user types in from closing as idle). */
  write(id, data, by = 'local') {
    const s = this.sessions.get(id);
    if (!s || s.snap.status !== 'running' || typeof data !== 'string') return false;
    const text = data.slice(0, MAX_INPUT);
    if (/[\r\n]/.test(text)) {
      s.lastInputBy = by;
      // A shell without blocks (sh, fish, cmd.exe) never says when a command ran: a submitted line counts.
      if (!s.snap.integration && s.snap.commands++ === 0) this.emit('status', snapshot(s));
    }
    s.proc.write(text);
    this.emit('input', { sessionId: id, by });
    return true;
  }

  /** Running, no command in it and none being typed by a program. Not the prompt mark: it lands a few ms after
   *  the block's end, and runCommand waits for it anyway. */
  free(id) {
    const s = this.sessions.get(id);
    return !!s && s.snap.status === 'running' && !s.block && !s.pendingRun;
  }

  /** The shell's current folder (the W mark's $PWD after every command; the open cwd before the first one). A
   *  `cd` inside one command line persists in the shell, so this is NOT `snap.cwd` (which stays the open folder). */
  cwdOf(id) {
    const s = this.sessions.get(id);
    return s ? s.cwdNow : null;
  }

  /** The running block's live output (the tail kept in memory), or null. */
  liveBlock(id) {
    const s = this.sessions.get(id);
    const b = s && s.block;
    return b ? { sessionId: id, seq: b.seq, command: b.command, startedAt: iso(b.startedAt), out: b.out, bytes: b.bytes,
      truncated: b.truncated, runBy: b.runBy, source: b.source } : null;
  }

  /**
   * Type one command line for a program (Ask, #574) and resolve with its block once the shell's start
   * mark arrives. Only into an idle shell with block marks: a person's half-typed line or a running
   * program would otherwise receive it.
   */
  async runCommand(id, command, { by, source = 'ask', cwd = null, readyMs = READY_MS, ackMs = ACK_MS } = {}) {
    const s = this.sessions.get(id);
    if (!s || s.snap.status !== 'running') throw codeError('NO_SESSION', 'That terminal is not running.');
    if (s.snap.shellKind === 'other') throw codeError('NO_BLOCKS', noBlocksMessage(this.platform));
    if (s.block || s.pendingRun) throw codeError('BUSY', 'A command is already running in this terminal.');
    if (!s.atPrompt) await this._waitFor(s.readyWaiters, readyMs, 'NO_BLOCKS', 'The shell did not reach its prompt.');
    if (s.block || s.pendingRun) throw codeError('BUSY', 'A command is already running in this terminal.');
    // The W mark (cwd) is printed in the same printf as the A mark, before it: at the prompt, cwdNow is current.
    // `cwd` is the folder the caller's command check reasoned about (for Ask, the shell's own folder at its pick):
    // a shell that moved since (a `cd` whose W mark landed late) must not run the command anywhere else.
    if (cwd && !sameDir(s.cwdNow, cwd)) throw codeError('MOVED', 'The shell is in another folder.');
    s.pendingRun = { by, source };
    const started = this._waitFor(s.startWaiters, ackMs, 'NOT_STARTED', 'The shell did not start the command.')
      .finally(() => { s.pendingRun = null; });
    // Under a PTY: Ctrl+U first clears anything a person left half-typed on the line, then Enter (\r). Over pipes
    // there is no line editor and bash reads a line only at \n.
    s.proc.write(s.snap.mode === 'pty' ? `\x15${command}\r` : `${command}\n`);
    return started;
  }

  resize(id, cols, rows) {
    const s = this.sessions.get(id);
    if (!s || s.snap.status !== 'running') return;
    this._flush(s);                                  // output so far was written at the old size (replay segments)
    s.snap.cols = clamp(cols, 2, 500, 100);
    s.snap.rows = clamp(rows, 1, 300, 30);
    s.proc.resize(s.snap.cols, s.snap.rows);
  }

  /** Stop the running command (D4): Ctrl+C / SIGINT, then SIGKILL its processes if it is still running 3 s later. */
  interrupt(id, by = 'local') {
    const s = this.sessions.get(id);
    if (!s || s.snap.status !== 'running') return null;
    const b = s.block;
    if (b) b.stopRequestedBy = by;
    store.recordAudit({ sessionId: id, blockSeq: b?.seq ?? null, runId: s.snap.runId, actor: by, action: 'stop', detail: b?.command ?? null, now: this.now() });
    // Under a PTY the tty delivers ^C to the foreground job (ConPTY too). Over pipes there is no tty, and bash still
    // starts each command in its own process group, so SIGINT goes to each of the shell's descendants. Windows has no
    // SIGINT over pipes: there the 3 s escalation below ends the command (and leaves Git Bash's shell running).
    if (s.proc.mode === 'pty') s.proc.write('\x03');
    else signalDescendants(s.proc.pid, 'SIGINT', this.platform);
    clearTimeout(s.stopTimer);
    if (b) {
      s.stopTimer = setTimeout(() => {
        if (s.block !== b) return;
        if (this.platform !== 'win32') { killDescendants(s.proc.pid, this.platform); return; }
        this._winShell(s).then((sp) => { if (s.block === b) killWinCommands(sp, s.snap.shell); }).catch(() => {});
      }, STOP_ESCALATE_MS);
      s.stopTimer.unref?.();
    }
    return { blockSeq: b?.seq ?? null };
  }

  /** Close: SIGHUP (a terminal closing), then SIGKILL the shell and everything under it. */
  async close(id, by = 'local', reason = null) {
    const s = this.sessions.get(id);
    if (!s || s.snap.status !== 'running') return false;
    s.closing = { by, reason };
    const exited = new Promise((r) => s.exitWaiters.push(r));
    const wait = (ms) => Promise.race([exited, new Promise((r) => setTimeout(r, ms).unref?.())]);
    if (this.platform === 'win32') {
      // No SIGHUP on Windows, and Git Bash's commands are not in the Windows process tree (MSYS forks through stubs
      // that exit): end them from MSYS's own table while the shell still owns them, then the launcher's whole tree.
      // The real-shell lookup is normally cached by now; a hung PowerShell must not hold close for its 15 s timeouts.
      if (s.proc.pid) {
        const sp = await Promise.race([this._winShell(s).catch(() => s.proc.pid), wait(WIN_SHELL_WAIT_MS).then(() => s.proc.pid)]);
        try { killWinCommands(sp, s.snap.shell); } catch { /* best effort: the launcher's tree is still ended below */ }
        killTree(s.proc.pid);
      }
      await wait(CLOSE_GRACE_MS);
    } else {
      // Jobs in their own process groups outlive the SIGHUP, and once the shell exits they are no longer its
      // descendants: list them first, kill them after the grace period.
      const tree = descendantPids(s.proc.pid);
      s.proc.signal('SIGHUP');
      await wait(CLOSE_GRACE_MS);
      signalPids(new Set([...tree, ...descendantPids(s.proc.pid)]), 'SIGKILL', this.platform);
    }
    if (s.snap.status === 'running') {
      s.proc.signal('SIGKILL');
      await wait(2000);
    }
    if (s.snap.status === 'running') this._onExit(s, { exitCode: null });   // never left half-open
    return true;
  }

  closeWhere(pred, by = 'system', reason = null) {
    return Promise.allSettled(this.live().filter((s) => pred(snapshot(s))).map((s) => this.close(s.snap.id, by, reason)));
  }
  closeAll(by = 'system') { return this.closeWhere(() => true, by, 'worca stopped'); }

  /** D7: a run's teardown may remove (or remove and re-create) the folder under a live shell. */
  checkFolders() {
    const live = this.live();
    if (!live.length) { clearInterval(this._folderTimer); this._folderTimer = null; return; }
    for (const s of live) {
      let folder = 'ok';
      try { if (statSync(s.snap.cwd).ino !== s.ino) folder = 'replaced'; } catch { folder = 'gone'; }
      const runLive = s.snap.runId ? !!this.runLive(s.snap.runId) : false;
      if (folder !== s.snap.folder || runLive !== s.snap.runLive) {
        s.snap.folder = folder;
        s.snap.runLive = runLive;
        this.emit('status', snapshot(s));
      }
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────────────────────────
  _onData(s, d) {
    const text = String(d);
    for (const ev of s.parser.push(text)) this._onMark(s, ev);
    s.pendingOut += text;
    if (s.pendingOut.length >= FLUSH_CHARS) { this._flush(s); return; }   // a flood: bounded frames, not one per 16 ms
    if (!s.flushTimer) { s.flushTimer = setTimeout(() => this._flush(s), FLUSH_MS); s.flushTimer.unref?.(); }
  }

  _flush(s) {
    clearTimeout(s.flushTimer);
    s.flushTimer = null;
    if (!s.pendingOut) return;
    const data = s.pendingOut;
    s.pendingOut = '';
    s.seq += 1;
    s.chunks.push({ seq: s.seq, data, cols: s.snap.cols, rows: s.snap.rows });
    s.chunkChars += data.length;
    // Keep exactly the last REPLAY_CHARS: drop whole chunks, then trim the oldest one kept. Dropping only
    // whole chunks would leave a reload with almost nothing after one large chunk.
    while (s.chunkChars > REPLAY_CHARS) {
      const head = s.chunks[0];
      const over = s.chunkChars - REPLAY_CHARS;
      if (head.data.length <= over) { s.chunks.shift(); s.chunkChars -= head.data.length; continue; }
      const cut = /[\uDC00-\uDFFF]/.test(head.data[over] || '') ? over + 1 : over;   // never split a surrogate pair
      head.data = head.data.slice(cut);
      s.chunkChars -= cut;
    }
    this.emit('data', { sessionId: s.snap.id, data, seq: s.seq });
  }

  _onMark(s, ev) {
    if (!s.snap.integration) {
      s.snap.integration = true;
      store.setSessionIntegration(s.snap.id);
      this.emit('status', snapshot(s));
    }
    if (ev.type === 'cwd') { s.cwdNow = ev.cwd; return; }
    if (ev.type === 'output') {
      const b = s.block;
      if (!b) return;
      b.bytes += Buffer.byteLength(ev.text);
      b.out += ev.text;
      if (b.out.length > BLOCK_OUTPUT_CAP) { b.out = b.out.slice(-BLOCK_OUTPUT_CAP); b.truncated = true; }
      return;
    }
    if (ev.type === 'end') { this._endBlock(s, 'done', ev.exitCode); return; }
    if (ev.type === 'prompt') { s.atPrompt = true; for (const w of s.readyWaiters.splice(0)) w.res(); return; }
    if (ev.type === 'start') {
      const at = this.now();
      s.atPrompt = false;
      s.blockSeq += 1;
      s.snap.commands = s.blockSeq;
      // A program's line (runCommand) is its own; anything else belongs to whoever last pressed Enter.
      const runBy = s.pendingRun ? s.pendingRun.by : s.lastInputBy;
      const source = s.pendingRun ? s.pendingRun.source : 'person';
      s.block = { seq: s.blockSeq, command: ev.command, startedAt: at, out: '', bytes: 0, truncated: false, runBy, source, stopRequestedBy: null };
      const rec = store.startBlock({ sessionId: s.snap.id, seq: s.blockSeq, command: ev.command, cwd: s.cwdNow,
        runId: s.snap.runId, member: s.snap.member, runBy, source, now: at });
      store.recordAudit({ sessionId: s.snap.id, blockSeq: s.blockSeq, runId: s.snap.runId, actor: runBy, action: 'command', detail: ev.command, now: at });
      for (const w of s.startWaiters.splice(0)) w.res({ seq: s.blockSeq });
      this.emit('block', rec);
      this.emit('status', snapshot(s));
    }
  }

  /** Windows: the pid Git Bash's commands run under (cached; the launcher's pid while unknown, which ends nothing). */
  async _winShell(s) {
    const pid = s.proc.pid;
    if (s.snap.shellKind !== 'bash' || !pid) return pid;
    if (s.proc.winShellPid && s.proc.winShellPid !== pid) return s.proc.winShellPid;
    s.winShellLookup ??= winShellPid(pid).finally(() => { s.winShellLookup = null; });
    const sp = await s.winShellLookup;
    if (sp && sp !== pid) s.proc.winShellPid = sp;     // pty.mjs's exit handler reads it too
    return sp || pid;
  }

  _waitFor(list, ms, code, message) {
    return new Promise((res, rej) => {
      const w = { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } };
      const t = setTimeout(() => { const i = list.indexOf(w); if (i >= 0) list.splice(i, 1); rej(codeError(code, message)); }, ms);
      t.unref?.();
      list.push(w);
    });
  }

  _endBlock(s, status, exitCode) {
    const b = s.block;
    if (!b) return;
    s.block = null;
    clearTimeout(s.stopTimer);
    const final = b.stopRequestedBy ? 'stopped' : status;
    const rec = store.finishBlock({ sessionId: s.snap.id, seq: b.seq, status: final, exitCode, output: b.out, outputBytes: b.bytes,
      truncated: b.truncated, stoppedBy: b.stopRequestedBy, now: this.now() });
    this.emit('block', rec);
    this.emit('status', snapshot(s));
  }

  _onExit(s, { exitCode = null } = {}) {
    if (s.snap.status !== 'running') return;
    this._flush(s);
    clearTimeout(s.stopTimer);
    if (s.block) {
      if (s.closing && !s.block.stopRequestedBy) s.block.stopRequestedBy = s.closing.by;
      this._endBlock(s, 'done', exitCode);      // `exit` typed at the prompt ends with the shell's code
    }
    const at = this.now();
    const status = s.closing ? 'closed' : 'exited';
    Object.assign(s.snap, { status, exitCode, endedAt: iso(at), closedBy: s.closing?.by ?? null });
    store.endSession(s.snap.id, { status, exitCode, closedBy: s.snap.closedBy, now: at });
    store.recordAudit({ sessionId: s.snap.id, runId: s.snap.runId, actor: s.closing?.by ?? null, action: s.closing ? 'close' : 'exit',
      detail: s.closing?.reason ?? (exitCode == null ? null : `exit ${exitCode}`), now: at });
    this.writePidFile();
    this._evictEnded();
    this.emit('status', snapshot(s));
    for (const w of s.exitWaiters.splice(0)) w();
    // runCommand callers waiting for a prompt or a start mark that will never come.
    for (const w of [...s.readyWaiters.splice(0), ...s.startWaiters.splice(0)]) w.rej(codeError('NO_SESSION', 'That terminal is not running.'));
  }

  _evictEnded() {
    const ended = [...this.sessions.values()].filter((s) => s.snap.status !== 'running')
      .sort((a, z) => (a.snap.endedAt || '').localeCompare(z.snap.endedAt || ''));
    for (const s of ended.slice(0, Math.max(0, ended.length - ENDED_KEEP))) this.sessions.delete(s.snap.id);
  }

  /** This server's live shells, whole file. Also called once at boot, after reaping, to drop stale rows. */
  writePidFile() {
    const file = this.pidFile;
    if (!file) return;
    const rows = this.live().filter((s) => s.proc.pid).map((s) => ({ pid: s.proc.pid, ownerPid: process.pid, sessionId: s.snap.id,
      ...(s.snap.runId ? { instanceId: `term:${s.snap.runId}:${s.snap.id}` } : {}),
      ...(this.platform === 'win32' ? { shell: s.snap.shell } : {}) }));   // the boot reap checks the pid is still this program
    try {                                    // tmp + rename, like ActionRegistry: the harness reads it from another process
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(rows));
      renameSync(`${file}.tmp`, file);
    } catch { /* best-effort, like actions */ }
  }

  _watchFolders() {
    if (this._folderTimer) return;
    this._folderTimer = setInterval(() => this.checkFolders(), FOLDER_CHECK_MS);
    this._folderTimer.unref?.();
  }
}
