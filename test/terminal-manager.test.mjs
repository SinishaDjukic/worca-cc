// test/terminal-manager.test.mjs — worca-owned sessions: blocks with authors, stop, close, pid file (#573).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { TerminalManager, MAX_SESSIONS, REPLAY_CHARS } from '../src/core/terminal/manager.mjs';
import { listAudit, getBlock, getSession } from '../src/core/terminal/store.mjs';
import { pidAlive, winShellPid, parseMsysPs, msysPsFor, msysCommandPids } from '../src/core/terminal/pty.mjs';
import { shellKind } from '../src/core/terminal/shell.mjs';

useTempHome(after);
const work = mkdtempSync(join(tmpdir(), 'term-mgr-'));
after(() => rmSync(work, { recursive: true, force: true }));
const BASH = (() => { const r = spawnSync('/bin/sh', ['-c', 'command -v bash'], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; })();
const pidFile = join(work, 'live.json');
const mgr = new TerminalManager({ pidFile, ptyInfo: () => ({ pty: null, reason: 'test' }), shell: () => ({ file: BASH, kind: 'bash', platform: process.platform }) });
after(() => mgr.closeAll());
const baseEnv = { PATH: process.env.PATH, HOME: work };

function waitFor(pred, ms = 15000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = async () => { const v = await pred(); if (v) return resolve(v); if (Date.now() - t0 > ms) return reject(new Error('timed out')); setTimeout(tick, 25); };
    tick();
  });
}
const blocks = [];
mgr.on('block', (b) => blocks.push(b));

test('a command becomes a block attributed to whoever pressed Enter', { skip: !BASH }, async () => {
  const s = await mgr.open({ cwd: work, scope: 'run', label: 'r1 · app', runId: 'r1', member: 'app', projectKey: 'app', by: 'ada', baseEnv });
  assert.equal(s.mode, 'pipes');
  mgr.write(s.id, 'echo hi\n', 'bob');
  const done = await waitFor(() => blocks.find((b) => b.sessionId === s.id && b.status === 'done'));
  assert.equal(done.command, 'echo hi');
  assert.equal(done.exitCode, 0);
  assert.equal(done.runBy, 'bob');
  assert.match(getBlock(s.id, done.seq).output, /hi/);
  assert.equal(mgr.get(s.id).integration, true);
  assert.equal(mgr.get(s.id).commands, 1, 'the pane asks before closing a terminal that ran a command');
  assert.deepEqual(listAudit({ sessionId: s.id }).map((a) => [a.action, a.actor]), [['open', 'ada'], ['command', 'bob']]);
  assert.match(mgr.replay(s.id).data, /hi/);
  const live = JSON.parse(readFileSync(pidFile, 'utf8'));
  assert.deepEqual(live.map((r) => [r.sessionId, r.instanceId]), [[s.id, `term:r1:${s.id}`]]);
});

test('Stop ends a running command and records who stopped it', { skip: !BASH }, async () => {
  const s = mgr.list().find((x) => x.status === 'running');
  mgr.write(s.id, 'sleep 30\n', 'ada');
  await waitFor(() => mgr.get(s.id).currentBlock?.command === 'sleep 30');
  const t0 = Date.now();
  mgr.interrupt(s.id, 'cy');
  const stopped = await waitFor(() => blocks.find((b) => b.sessionId === s.id && b.command === 'sleep 30' && b.status !== 'running'));
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.stoppedBy, 'cy');
  assert.ok(Date.now() - t0 < 2500, 'Ctrl+C ended it; the 3 s SIGKILL escalation was not needed');
  assert.ok(listAudit({ sessionId: s.id }).some((a) => a.action === 'stop' && a.actor === 'cy'));
});

test('close ends the shell and a backgrounded job too; the pid file empties', { skip: !BASH || process.platform === 'win32' }, async () => {
  const s = mgr.list().find((x) => x.status === 'running');
  mgr.write(s.id, 'sleep 300 & echo bg=$!\n', 'ada');        // unquoted: `!"` is history expansion in an interactive bash
  const bg = await waitFor(() => { const m = /bg=(\d+)/.exec(mgr.replay(s.id).data); return m && Number(m[1]); });
  await mgr.close(s.id, 'ada');
  assert.equal(mgr.get(s.id).status, 'closed');
  assert.equal(getSession(s.id).closedBy, 'ada');
  await waitFor(() => !pidAlive(bg));
  assert.deepEqual(JSON.parse(readFileSync(pidFile, 'utf8')), []);
});

test('the folder watch notices a removed and a re-created folder', { skip: !BASH }, async () => {
  const dir = join(work, 'wt');
  mkdirSync(dir);
  const s = await mgr.open({ cwd: dir, scope: 'run', runId: 'r2', by: 'ada', baseEnv });
  renameSync(dir, join(work, 'wt-old'));
  mgr.checkFolders();
  assert.equal(mgr.get(s.id).folder, 'gone');
  mkdirSync(dir);
  mgr.checkFolders();
  assert.equal(mgr.get(s.id).folder, 'replaced');
  await mgr.close(s.id, 'ada');
});

test('a flood goes out in bounded frames, and a reload replays exactly the last REPLAY_CHARS', { skip: !BASH }, async () => {
  const s = await mgr.open({ cwd: work, scope: 'run', by: 'ada', baseEnv });
  const sizes = [];
  const onData = (d) => { if (d.sessionId === s.id) sizes.push(d.data.length); };
  mgr.on('data', onData);
  mgr.write(s.id, 'head -c 2000000 /dev/zero | tr "\\0" x; echo; echo END\n', 'ada');
  await waitFor(() => blocks.find((b) => b.sessionId === s.id && b.command.startsWith('head -c') && b.status === 'done'), 30000);
  mgr.off('data', onData);
  assert.ok(Math.max(...sizes) < 192 * 1024, `largest frame ${Math.max(...sizes)} chars`);
  const r = mgr.replay(s.id).data;
  assert.equal(r.length, REPLAY_CHARS);
  assert.match(r, /END/);
  await mgr.close(s.id, 'ada');
});

test('at most MAX_SESSIONS live sessions; a missing folder is refused', async () => {
  await assert.rejects(mgr.open({ cwd: join(work, 'nope'), scope: 'run', by: 'ada', baseEnv }), { code: 'NO_FOLDER' });
  const fake = new TerminalManager({ ptyInfo: () => ({ pty: null }), shell: () => ({ file: '/bin/sh', kind: 'other', platform: process.platform }),
    spawnImpl: () => ({ pid: null, mode: 'pipes', write() {}, resize() {}, signal() {}, onData() {}, onExit() {} }) });
  for (let i = 0; i < MAX_SESSIONS; i++) await fake.open({ cwd: work, scope: 'run', by: 'x', baseEnv });
  await assert.rejects(fake.open({ cwd: work, scope: 'run', by: 'x', baseEnv }), { code: 'TOO_MANY_SESSIONS' });
});

test('a PTY that cannot spawn falls back to pipes, says why, and stays on pipes', async () => {
  const calls = [];
  const fakeProc = { pid: null, mode: 'pipes', write() {}, resize() {}, signal() {}, onData() {}, onExit() {} };
  const m = new TerminalManager({ ptyInfo: () => ({ pty: {}, reason: null }), shell: () => ({ file: '/bin/sh', kind: 'other', platform: process.platform }),
    spawnImpl: (o) => { calls.push([o.pty ? 'pty' : 'pipes', o.env.TERM]); if (o.pty) throw new Error('posix_spawnp failed.'); return fakeProc; } });
  const s = await m.open({ cwd: work, scope: 'run', by: 'ada', baseEnv });
  assert.equal(s.mode, 'pipes');
  assert.match(m.ptyStatus().reason, /posix_spawnp failed/);
  await m.open({ cwd: work, scope: 'run', by: 'ada', baseEnv });
  assert.deepEqual(calls, [['pty', 'xterm-256color'], ['pipes', 'dumb'], ['pipes', 'dumb']]);
});

test('a shell without blocks counts submitted lines as commands, and says so once', async () => {
  const m = new TerminalManager({ ptyInfo: () => ({ pty: null }), shell: () => ({ file: '/bin/sh', kind: 'other', platform: process.platform }),
    spawnImpl: () => ({ pid: null, mode: 'pipes', write() {}, resize() {}, signal() {}, onData() {}, onExit() {} }) });
  const s = await m.open({ cwd: work, scope: 'run', by: 'ada', baseEnv });
  const statuses = [];
  m.on('status', (x) => statuses.push(x.commands));
  assert.equal(s.commands, 0);
  m.write(s.id, 'ls', 'ada');
  assert.equal(m.get(s.id).commands, 0, 'no line end, no command');
  m.write(s.id, '\r', 'ada');
  m.write(s.id, 'pwd\r', 'ada');
  assert.equal(m.get(s.id).commands, 2);
  assert.deepEqual(statuses, [1]);
});

test('a session row that cannot be written kills the shell and leaves nothing live', async () => {
  const signals = [];
  const m = new TerminalManager({ ptyInfo: () => ({ pty: null }), shell: () => ({ file: null, kind: 'other', platform: process.platform }),   // shell NOT NULL: the insert fails
    spawnImpl: () => ({ pid: null, mode: 'pipes', write() {}, resize() {}, signal(sig) { signals.push(sig); }, onData() {}, onExit() {} }) });
  await assert.rejects(m.open({ cwd: work, scope: 'run', by: 'ada', baseEnv }), /NOT NULL/);
  assert.deepEqual(signals, ['SIGKILL']);
  assert.deepEqual(m.list(), []);
  assert.equal(m.live().length, 0);
});

test('runCommand: types into the idle shell, resolves with the block seq; source and runBy stick', { skip: !BASH }, async () => {
  const s = await mgr.open({ cwd: work, scope: 'project', by: 'ask:ask_0000aaaa', baseEnv, agent: true });
  const { seq } = await mgr.runCommand(s.id, 'echo hi-574', { by: 'ask:ask_0000aaaa', source: 'ask' });
  assert.equal(seq, 1);
  await waitFor(() => blocks.some((b) => b.sessionId === s.id && b.seq === 1 && b.status === 'done'));
  const rec = getBlock(s.id, 1);
  assert.equal(rec.source, 'ask');
  assert.equal(rec.runBy, 'ask:ask_0000aaaa');
  assert.match(rec.output, /hi-574/);
  await waitFor(() => mgr.free(s.id));
  await mgr.close(s.id, 'test');
});

test('runCommand refuses a busy session; liveBlock shows the running output', { skip: !BASH }, async () => {
  const s = await mgr.open({ cwd: work, scope: 'project', by: 'ask:x', baseEnv, agent: true });
  await mgr.runCommand(s.id, 'echo building-574; sleep 5', { by: 'ask:x' });
  await waitFor(() => /building-574/.test(mgr.liveBlock(s.id)?.out || ''));
  const lb = mgr.liveBlock(s.id);
  assert.equal(lb.seq, 1); assert.equal(lb.command, 'echo building-574; sleep 5'); assert.equal(lb.source, 'ask');
  assert.equal(mgr.free(s.id), false);
  await assert.rejects(mgr.runCommand(s.id, 'ls', { by: 'ask:x' }), { code: 'BUSY' });
  mgr.interrupt(s.id, 'test');
  await waitFor(() => mgr.liveBlock(s.id) === null);
  await mgr.close(s.id, 'test');
});

test('runCommand times out when no command starts (a comment-only line); the session is free again', { skip: !BASH }, async () => {
  const s = await mgr.open({ cwd: work, scope: 'project', by: 'ask:x', baseEnv, agent: true });
  await assert.rejects(mgr.runCommand(s.id, '# nothing', { by: 'ask:x', ackMs: 300 }), { code: 'NOT_STARTED' });
  assert.equal(mgr.free(s.id), true);                         // the pending start was cleared
  await mgr.close(s.id, 'test');
});

test('a cd persists in the shell: cwdOf follows it, and runCommand with the open folder says MOVED', { skip: !BASH }, async () => {
  mkdirSync(join(work, 'sub-574'), { recursive: true });
  const s = await mgr.open({ cwd: work, scope: 'project', by: 'ask:x', baseEnv, agent: true });
  await mgr.runCommand(s.id, 'cd sub-574', { by: 'ask:x', cwd: work });
  await waitFor(() => mgr.free(s.id) && /sub-574$/.test(mgr.cwdOf(s.id) || ''));
  await assert.rejects(mgr.runCommand(s.id, 'ls', { by: 'ask:x', cwd: work }), { code: 'MOVED' });
  assert.equal(mgr.free(s.id), true);                         // nothing was typed
  // The caller checked the command against the folder the shell is really in: told that folder, it runs there.
  const { seq } = await mgr.runCommand(s.id, 'pwd', { by: 'ask:x', cwd: mgr.cwdOf(s.id) });
  const done = await waitFor(() => blocks.find((b) => b.sessionId === s.id && b.seq === seq && b.status === 'done'));
  assert.equal(done.cwd && /sub-574$/.test(done.cwd), true);
  await mgr.close(s.id, 'test');
});

test('write emits input (who typed in which session): Ask keeps a tab the user types in open', async () => {
  const m = new TerminalManager({ ptyInfo: () => ({ pty: null }), shell: () => ({ file: '/bin/sh', kind: 'other', platform: process.platform }),
    spawnImpl: () => ({ pid: null, mode: 'pipes', write() {}, resize() {}, signal() {}, onData() {}, onExit() {} }) });
  const s = await m.open({ cwd: work, scope: 'project', by: 'ask:x', baseEnv });
  const seen = [];
  m.on('input', (e) => seen.push(e));
  m.write(s.id, 'ls', 'ada');
  m.write('t-nope', 'ls', 'ada');
  assert.deepEqual(seen, [{ sessionId: s.id, by: 'ada' }]);
});

test('runCommand refuses a shell without block marks', async () => {
  const m = new TerminalManager({ ptyInfo: () => ({ pty: null }), shell: () => ({ file: '/bin/sh', kind: 'other', platform: process.platform }),
    spawnImpl: () => ({ pid: null, mode: 'pipes', write() {}, resize() {}, signal() {}, onData() {}, onExit() {} }) });
  const s = await m.open({ cwd: work, scope: 'project', by: 'ask:x', baseEnv });
  await assert.rejects(m.runCommand(s.id, 'ls', { by: 'ask:x' }), { code: 'NO_BLOCKS' });
});

test('a session knows its PTY size: open sets it, resize changes it (the pane replays output at that width)', async () => {
  const m = new TerminalManager({ ptyInfo: () => ({ pty: null }), shell: () => ({ file: '/bin/sh', kind: 'other', platform: process.platform }),
    spawnImpl: () => ({ pid: null, mode: 'pipes', write() {}, resize() {}, signal() {}, onData() {}, onExit() {} }) });
  const s = await m.open({ cwd: work, scope: 'project', by: 'ask:x', baseEnv });
  assert.deepEqual([s.cols, s.rows], [100, 30]);
  m.resize(s.id, 142, 40);
  assert.deepEqual([m.get(s.id).cols, m.get(s.id).rows], [142, 40]);
  m.resize(s.id, 9999, 0);                                  // clamped like the PTY
  assert.deepEqual([m.get(s.id).cols, m.get(s.id).rows], [500, 1]);
});

test('replay segments: output keeps the PTY width it was written at, across resizes', async () => {
  let onData = null;
  const m = new TerminalManager({ ptyInfo: () => ({ pty: null }), shell: () => ({ file: '/bin/sh', kind: 'other', platform: process.platform }),
    spawnImpl: () => ({ pid: null, mode: 'pipes', write() {}, resize() {}, signal() {}, onData(cb) { onData = cb; }, onExit() {} }) });
  const s = await m.open({ cwd: work, scope: 'project', by: 'ask:x', baseEnv });
  onData('a1'); onData('a2');
  m.resize(s.id, 140, 40);                                  // pending output is flushed at the old width first
  onData('b1');
  m.resize(s.id, 140, 40);
  onData('b2');
  const r = m.replay(s.id);
  assert.equal(r.data, 'a1a2b1b2');
  assert.deepEqual(r.segments, [{ cols: 100, rows: 30, data: 'a1a2' }, { cols: 140, rows: 40, data: 'b1b2' }]);
});

test('runCommand on a Windows shell without bash: NO_BLOCKS says to install Git for Windows or set WORCA_TERMINAL_SHELL', async () => {
  const m = new TerminalManager({ platform: 'win32', ptyInfo: () => ({ pty: null }),
    shell: () => ({ file: 'C:\\Windows\\system32\\cmd.exe', kind: 'other', platform: 'win32' }),
    spawnImpl: () => ({ pid: null, mode: 'pipes', write() {}, resize() {}, signal() {}, onData() {}, onExit() {} }) });
  const s = await m.open({ cwd: work, scope: 'run', by: 'ada', baseEnv });
  await assert.rejects(m.runCommand(s.id, 'ls', { by: 'ask:x' }), (e) => e.code === 'NO_BLOCKS' && /Git for Windows/.test(e.message) && /WORCA_TERMINAL_SHELL/.test(e.message));
});

test('Windows pid file rows record the shell (the boot reap checks it before killing)', async () => {
  const file = join(work, 'win-live.json');
  // kind 'other' and a fake pid: no CIM lookup starts, and this manager is never closed (close would taskkill the pid).
  const m = new TerminalManager({ platform: 'win32', pidFile: file, ptyInfo: () => ({ pty: null }),
    shell: () => ({ file: 'C:\\Windows\\system32\\cmd.exe', kind: 'other', platform: 'win32' }),
    spawnImpl: () => ({ pid: 4242, mode: 'pipes', write() {}, resize() {}, signal() {}, onData() {}, onExit() {} }) });
  const s = await m.open({ cwd: work, scope: 'run', by: 'ada', baseEnv });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).map((r) => [r.pid, r.sessionId, r.shell]), [[4242, s.id, 'C:\\Windows\\system32\\cmd.exe']]);
});

/** Git Bash, found the way test/file-read-guard.test.mjs finds it; null off Windows or when missing. */
const GIT_BASH = process.platform === 'win32'
  ? [process.env.CLAUDE_CODE_GIT_BASH_PATH, 'C:\\Program Files\\Git\\bin\\bash.exe'].find((p) => p && existsSync(p)) || null
  : null;

test('Windows: Git Bash records Ask\'s commands as blocks, reports C:/ folders; Stop keeps the shell; close leaves no command', { skip: GIT_BASH ? false : 'no Git Bash', timeout: 120_000 }, async () => {
  const win = new TerminalManager({ ptyInfo: () => ({ pty: null, reason: 'test' }), shell: () => ({ file: GIT_BASH, kind: shellKind(GIT_BASH, 'win32'), platform: 'win32' }) });
  const got = [];
  win.on('block', (b) => got.push(b));
  try {
    const s = await win.open({ cwd: work, scope: 'project', by: 'ask:x', baseEnv: { ...process.env, HOME: work }, agent: true });
    assert.equal(s.shellKind, 'bash');
    // Git Bash's first prompt can take several seconds on a cold start (or under an antivirus scan): wait longer than READY_MS.
    const { seq } = await win.runCommand(s.id, 'echo hi-win', { by: 'ask:x', cwd: work, readyMs: 30000 });
    const done = await waitFor(() => got.find((b) => b.sessionId === s.id && b.seq === seq && b.status === 'done'), 30000);
    assert.equal(done.exitCode, 0);
    assert.match(getBlock(s.id, seq).output, /hi-win/);
    assert.match(win.cwdOf(s.id), /^[A-Za-z]:\//, 'the W mark is a Windows path (pwd -W)');

    mkdirSync(join(work, 'sub-win'), { recursive: true });
    await win.runCommand(s.id, 'cd sub-win', { by: 'ask:x', cwd: work });      // C:/… vs C:\…: sameDir, no MOVED
    await waitFor(() => win.free(s.id) && /sub-win$/.test(win.cwdOf(s.id) || ''));
    await assert.rejects(win.runCommand(s.id, 'ls', { by: 'ask:x', cwd: work }), { code: 'MOVED' });

    // Over pipes Windows has no SIGINT: the 3 s escalation ends the command (found in MSYS's table), not the shell.
    const slow = await win.runCommand(s.id, 'sleep 30', { by: 'ask:x', cwd: win.cwdOf(s.id) });
    win.interrupt(s.id, 'cy');
    const stopped = await waitFor(() => got.find((b) => b.sessionId === s.id && b.seq === slow.seq && b.status !== 'running'), 30000);
    assert.equal(stopped.status, 'stopped');
    await waitFor(() => win.free(s.id));
    const again = await win.runCommand(s.id, 'echo alive', { by: 'ask:x', cwd: win.cwdOf(s.id) });
    await waitFor(() => got.find((b) => b.sessionId === s.id && b.seq === again.seq && b.status === 'done'), 30000);

    // close ends a running command too (taskkill /T on the launcher alone would leave it running). Wait until MSYS
    // lists the real /usr/bin/sleep (not the short-lived fork stub before it), then take the shell's command pids.
    await win.runCommand(s.id, 'sleep 60', { by: 'ask:x', cwd: win.cwdOf(s.id) });
    const ps = msysPsFor(GIT_BASH);
    assert.ok(ps, `no MSYS ps.exe next to ${GIT_BASH}`);
    const cmds = await waitFor(async () => {
      const text = spawnSync(ps, ['-a'], { encoding: 'utf8', windowsHide: true }).stdout || '';
      if (!/\/usr\/bin\/sleep\s*$/m.test(text)) return null;
      const list = msysCommandPids(await winShellPid(s.pid), parseMsysPs(text));
      return list.length ? list : null;
    }, 30000);
    assert.ok(cmds.some((p) => pidAlive(p)), 'the command is running before close');
    await win.close(s.id, 'test');
    assert.notEqual(win.get(s.id).status, 'running');
    for (const p of cmds) assert.equal(pidAlive(p), false, `command pid ${p} still running after close`);
  } finally { await win.closeAll(); }
});
