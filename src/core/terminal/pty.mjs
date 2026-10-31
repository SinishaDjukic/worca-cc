// src/core/terminal/pty.mjs — start a shell under a pseudo-terminal (node-pty, an optional native
// dependency) or, where node-pty is missing, over plain pipes (issue #573). Both return the same small
// handle. Over pipes there is no tty: commands, markers and Stop work; full-screen programs do not.
import { createRequire } from 'node:module';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, statSync } from 'node:fs';
import { dirname, join, win32 } from 'node:path';

const require = createRequire(import.meta.url);
const OFF = /^(0|false|no|off)$/i;
let cached = null;

/** Where node-pty keeps spawn-helper: the prebuild for this platform, then a local build. */
function spawnHelperCandidates(pkgDir, platform, arch) {
  return [join('prebuilds', `${platform}-${arch}`, 'spawn-helper'), join('build', 'Release', 'spawn-helper')]
    .map((rel) => join(pkgDir, rel));
}

/**
 * The spawn-helper files node-pty ships for this platform and whether each is executable
 * (all three exec bits, the same bar ensureSpawnHelper sets). Read-only: `worca doctor`
 * reports with it. [] when none is shipped (Windows, or Linux without a build).
 * @returns {{ path: string, executable: boolean }[]}
 */
export function spawnHelperStatus(pkgDir, { platform = process.platform, arch = process.arch } = {}) {
  const found = [];
  for (const file of spawnHelperCandidates(pkgDir, platform, arch)) {
    let st;
    try { st = statSync(file); } catch { continue; }                 // not shipped for this platform
    found.push({ path: file, executable: (st.mode & 0o111) === 0o111 });
  }
  return found;
}

/** One `worca doctor` line for spawnHelperStatus(): ok, nothing to check, or the exact chmod fix. */
export function spawnHelperDoctorLine(status) {
  if (!status.length) return 'node-pty spawn-helper: none for this platform (nothing to check)';
  const bad = status.filter((s) => !s.executable);
  if (!bad.length) return `node-pty spawn-helper: ok (${status.map((s) => s.path).join(', ')})`;
  const quoted = bad.map((s) => `'${s.path.replace(/'/g, `'\\''`)}'`).join(' ');
  return `node-pty spawn-helper: NOT executable — fix with: chmod +x ${quoted}`;
}

/**
 * node-pty 1.1.0's npm tarball ships `prebuilds/darwin-*\/spawn-helper` as mode 0644, and every
 * pty.spawn then throws "posix_spawnp failed." (D14). Set the exec bit where it is missing. Returns
 * null when the helper is usable (or absent), else why it is not.
 */
export function ensureSpawnHelper(pkgDir, { platform = process.platform, arch = process.arch } = {}) {
  for (const { path: file, executable } of spawnHelperStatus(pkgDir, { platform, arch })) {
    if (executable) continue;
    try { chmodSync(file, statSync(file).mode | 0o755); } catch (e) {
      return `node-pty's spawn-helper is not executable and could not be fixed (${e?.code || e?.message || e})`;
    }
  }
  return null;
}

/** node-pty, or null with the reason it is unavailable. WORCA_TERMINAL_PTY=0 forces pipes. */
export function loadPty(env = process.env) {
  if (OFF.test(String(env.WORCA_TERMINAL_PTY || '').trim())) return { pty: null, reason: 'turned off with WORCA_TERMINAL_PTY=0' };
  if (cached) return cached;
  try {
    const pty = require('node-pty');
    const problem = process.platform === 'win32' ? null : ensureSpawnHelper(dirname(require.resolve('node-pty/package.json')));
    cached = problem ? { pty: null, reason: problem } : { pty, reason: null };
  } catch (e) {
    cached = { pty: null, reason: `node-pty is not installed on this server (${String(e?.code || e?.message || e).slice(0, 120)})` };
  }
  return cached;
}
export function _resetPtyForTests() { cached = null; }

/** Shells still running, killed synchronously if the host exits without a graceful close. */
const live = new Set();
process.on('exit', () => {
  for (const h of live) {
    // Windows: no time to ask CIM for Git Bash's real shell here; the manager stored it on the handle.
    try { if (h.platform === 'win32') endWinTerminal(h.pid, h.file, h.winShellPid || h.pid); else killDescendants(h.pid); } catch { /* best effort */ }
    h.signal('SIGKILL');
  }
});

/** Throws only when node-pty itself cannot spawn; TerminalManager then falls back to pipes (D14). */
export function spawnTerminal({ file, args = [], cwd, env, cols = 100, rows = 30, platform = process.platform, pty = loadPty().pty }) {
  const h = pty ? viaPty(pty, { file, args, cwd, env, cols, rows, platform }) : viaPipes({ file, args, cwd, env, platform });
  Object.assign(h, { file, platform, winShellPid: null });
  if (h.pid) live.add(h);
  h.onExit(() => live.delete(h));
  return h;
}

function groupSignal(pid, sig, platform, fallback) {
  if (platform !== 'win32' && pid) { try { process.kill(-pid, sig); return; } catch { /* not a group leader */ } }
  try { fallback(sig); } catch { /* gone */ }
}

function viaPty(pty, { file, args, cwd, env, cols, rows, platform }) {
  const p = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env });
  return {
    pid: p.pid,
    mode: 'pty',
    write: (s) => { try { p.write(s); } catch { /* exited */ } },
    resize: (c, r) => { try { p.resize(c, r); } catch { /* exited */ } },
    signal: (sig) => groupSignal(p.pid, sig, platform, (s) => p.kill(platform === 'win32' ? undefined : s)),
    onData: (cb) => { p.onData((d) => cb(String(d))); },
    onExit: (cb) => { p.onExit(({ exitCode, signal }) => cb({ exitCode: exitCode ?? null, signal: signal || null })); },
  };
}

function viaPipes({ file, args, cwd, env, platform }) {
  const child = spawn(file, args, {
    cwd, env,
    detached: platform !== 'win32',          // own process group: SIGINT/SIGHUP reach the shell and its jobs
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdin?.on('error', () => { /* the shell went away mid-write */ });
  const exitCbs = [];
  let ended = false;
  const end = (e) => { if (ended) return; ended = true; for (const cb of exitCbs) cb(e); };
  child.once('error', () => end({ exitCode: -1, signal: null }));          // ENOENT, EACCES: no shell started
  child.once('close', (code, sig) => end({ exitCode: code ?? null, signal: sig || null }));
  return {
    pid: child.pid,
    mode: 'pipes',
    write: (s) => {
      if (!child.stdin?.writable) return;
      // No tty to turn Ctrl+D into end-of-input: the pane sends a lone \x04 for Ctrl+D on an
      // empty line, and closing stdin is the only EOF a pipe has. The shell shares that stdin,
      // so it ends too once the program reading it is done — at a prompt, the same as a tty.
      if (s === '\x04') { child.stdin.end(); return; }
      child.stdin.write(String(s).replace(/\r\n?/g, '\n'));
    },
    resize: () => {},
    signal: (sig) => groupSignal(child.pid, sig, platform, (s) => child.kill(s)),
    onData: (cb) => { child.stdout?.on('data', cb); child.stderr?.on('data', cb); },
    onExit: (cb) => { exitCbs.push(cb); },
  };
}

/** [[pid, ppid], …] of every process (POSIX ps). */
function psRows() {
  const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  return r.stdout.split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter((a) => a.length === 2 && a.every(Number.isFinite));
}

/** Every descendant of `pid`, deepest first (a job-control job lives in its own group, so kill(-pid) misses it). */
export function descendantPids(pid, rows = psRows) {
  const kids = new Map();
  for (const [p, pp] of rows()) { if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(p); }
  const out = [];
  const walk = (p) => { for (const c of kids.get(p) || []) { walk(c); out.push(c); } };
  walk(pid);
  return out;
}

/** Send `sig` to each pid (POSIX only). Returns how many were signalled. */
export function signalPids(pids, sig, platform = process.platform) {
  if (platform === 'win32') return 0;
  let n = 0;
  for (const p of pids) { try { process.kill(p, sig); n++; } catch { /* already gone */ } }
  return n;
}

/** Send `sig` to every descendant of `pid` (not `pid` itself). Returns how many were signalled. */
export function signalDescendants(pid, sig, platform = process.platform, rows = psRows) {
  if (!pid || platform === 'win32') return 0;
  return signalPids(descendantPids(pid, rows), sig, platform);
}

/** SIGKILL every descendant of `pid` (not `pid` itself). Returns how many were signalled. */
export const killDescendants = (pid, platform = process.platform, rows = psRows) => signalDescendants(pid, 'SIGKILL', platform, rows);

// ── Windows (Git Bash) ───────────────────────────────────────────────────────────────────────────
// Git for Windows' bin\bash.exe is a launcher: the shell is its usr\bin\bash.exe child (next to a conhost.exe over
// pipes). MSYS forks through stubs that exit, so a command's Windows parent is gone: only MSYS's own table (ps.exe)
// links a command to its shell. Kill = taskkill /PID <literal pid> /T /F, never by image name.

const validPid = (pid) => Number.isInteger(pid) && pid > 0;
const LIST_OPTS = { encoding: 'utf8', windowsHide: true, timeout: 15000 };
// CreationDate as a FILETIME: > 2^53, but Number rounding is monotonic, so `child >= parent` still holds.
const cimArgs = (pid) => ['-NoProfile', '-NonInteractive', '-Command',
  `Get-CimInstance Win32_Process -Filter 'ProcessId=${pid} OR ParentProcessId=${pid}' | ForEach-Object { '{0} {1} {2} {3}' -f `
  + '$_.ProcessId, $_.ParentProcessId, $(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }), $_.Name }'];
const wmicArgs = (pid) => ['process', 'where', `ProcessId=${pid} or ParentProcessId=${pid}`, 'get', 'ProcessId,ParentProcessId,Name', '/format:csv'];

/** `<pid> <ppid> <created> <name>` lines → [[pid, ppid, created, name], …]. */
export function parseWinRows(text) {
  return String(text).split(/\r?\n/).map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*?)\s*$/.exec(l)).filter(Boolean)
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), m[4]]);
}

/** `wmic process … get … /format:csv` → the same rows; no creation time (0 = unknown). */
export function parseWmicRows(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const head = (lines.shift() || '').split(',');
  const [ip, ipp, iname] = ['ProcessId', 'ParentProcessId', 'Name'].map((n) => head.indexOf(n));
  if (ip < 0 || ipp < 0) return [];
  return lines.map((l) => l.split(',')).map((c) => [Number(c[ip]), Number(c[ipp]), 0, iname >= 0 ? c[iname] : ''])
    .filter((r) => Number.isInteger(r[0]) && Number.isInteger(r[1]));
}

const isBashExe = (name) => /^bash\.exe$/i.test(String(name || '').trim());
/** The shell commands run under: `pid`'s one bash.exe child born after it (Git's launcher), else `pid` itself. */
export function shellPidFrom(pid, rows) {
  const born = rows.find((r) => r[0] === pid)?.[2] || 0;
  const kids = rows.filter((r) => r[1] === pid && r[0] !== pid && isBashExe(r[3]) && !(born && r[2] && r[2] < born));
  return kids.length === 1 ? kids[0][0] : pid;
}

const shellPidOf = (pid, ps, w) => (ps?.status === 0 && ps.stdout ? shellPidFrom(pid, parseWinRows(ps.stdout))
  : w?.status === 0 && w.stdout ? shellPidFrom(pid, parseWmicRows(w.stdout)) : pid);

/** Sync (boot reap only: nothing else runs yet). null for a pid that is not a literal integer. */
export function winShellPidSync(pid, run = spawnSync) {
  if (!validPid(pid)) return null;
  const ps = run('powershell.exe', cimArgs(pid), LIST_OPTS);
  return shellPidOf(pid, ps, ps?.status === 0 && ps.stdout ? null : run('wmic', wmicArgs(pid), LIST_OPTS));
}

const execFileStatus = (file, args, opts) => new Promise((res) => {
  execFile(file, args, opts, (err, stdout) => res({ status: err ? (Number.isInteger(err.code) ? err.code : 1) : 0, stdout: String(stdout || '') }));
});
/** The same, without blocking the server (PowerShell's CIM query takes 1–2 s). */
export async function winShellPid(pid, run = execFileStatus) {
  if (!validPid(pid)) return null;
  const ps = await run('powershell.exe', cimArgs(pid), LIST_OPTS);
  return shellPidOf(pid, ps, ps?.status === 0 && ps.stdout ? null : await run('wmic', wmicArgs(pid), LIST_OPTS));
}

/** MSYS's ps.exe for a Git Bash / MSYS2 bash: usr\bin\ps.exe of the install, or the one next to the bash. */
export function msysPsFor(shellFile, exists = existsSync) {
  if (!shellFile) return null;
  const dir = win32.dirname(String(shellFile));
  return [win32.join(dir, 'ps.exe'), win32.join(win32.dirname(dir), 'usr', 'bin', 'ps.exe')].find((f) => exists(f)) || null;
}

/** MSYS `ps -a` → [[pid, ppid, pgid, winpid], …]. A status letter (I, S, O) may lead a row. */
export function parseMsysPs(text) {
  return String(text).split(/\r?\n/).map((l) => /^\s*[A-Z]?\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(l)).filter(Boolean)
    .map((m) => m.slice(1, 5).map(Number));
}

export function msysRows(psExe, run = spawnSync) {
  if (!psExe) return [];
  const r = run(psExe, ['-a'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  return r?.status === 0 && r.stdout ? parseMsysPs(r.stdout) : [];
}

/** Windows pids of every MSYS process under the shell whose Windows pid is `shellWinpid`, deepest first. */
export function msysCommandPids(shellWinpid, rows) {
  const me = rows.find((r) => r[3] === shellWinpid);
  if (!me) return [];
  const kids = new Map();
  for (const [p, pp, , w] of rows) { if (p === pp) continue; if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push([p, w]); }
  // MSYS's table is a snapshot, never trusted blindly: a visited set ends any PPID cycle (descendantPids has none).
  const seen = new Set([me[0]]);
  const out = [];
  const walk = (p) => { for (const [c, w] of kids.get(p) || []) { if (seen.has(c)) continue; seen.add(c); walk(c); if (validPid(w)) out.push(w); } };
  walk(me[0]);
  return out;
}

/** End `pid` and every Windows process under it. */
export function killTree(pid, run = spawnSync) {
  if (!validPid(pid)) return false;
  const r = run('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 10000 });
  return r?.status === 0;
}

/** killTree each pid. Returns how many ended (taskkill exits 128 for a pid already gone). */
export function killWinPids(pids, run = spawnSync) {
  let n = 0;
  for (const p of pids) if (killTree(p, run)) n++;
  return n;
}

/** Stop's escalation: end the commands running under the shell (`shellWinpid` = Git Bash's real shell), not the shell. */
export function killWinCommands(shellWinpid, shellFile, { run = spawnSync, exists = existsSync } = {}) {
  return killWinPids(msysCommandPids(shellWinpid, msysRows(msysPsFor(shellFile, exists), run)), run);
}

/** Close / reap: the commands first (MSYS's table, while the shell still owns them), then the launcher's whole tree. */
export function endWinTerminal(pid, shellFile, shellWinpid = pid, opts = {}) {
  try { killWinCommands(shellWinpid, shellFile, opts); } catch { /* best effort: never skip the launcher's tree */ }
  return killTree(pid, opts.run);
}

/**
 * Boot reap (Windows has no process group to check, and recycles pids quickly): `pid` is still the shell a pid file
 * recorded — the same image name, started before the file was last written (`sinceMs`, its mtime). Anything unknown
 * (no shell recorded, CIM failed, no creation time) is false: never kill a process that may not be ours.
 */
export function winReapable(pid, { shell, sinceMs, run = spawnSync } = {}) {
  if (!validPid(pid) || !shell || !Number.isFinite(sinceMs)) return false;
  const r = run('powershell.exe', cimArgs(pid), LIST_OPTS);
  const me = r?.status === 0 && r.stdout ? parseWinRows(r.stdout).find((x) => x[0] === pid) : null;
  if (!me || !me[2]) return false;
  const since = (sinceMs + 11644473600000) * 10000 + 1e7;       // the mtime as a FILETIME, +1 s for clock rounding
  return me[3].toLowerCase() === win32.basename(String(shell)).toLowerCase() && me[2] <= since;
}

export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; }
}
