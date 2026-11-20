// #1144: agent process groups outlive a SIGKILLed host (the 'exit' reaper never runs), so every
// group is recorded in a per-owner file and the next server boot reaps the ones a dead owner left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGroupTracker, reapAgentGroups, reapAgentGroupsAtBoot, agentGroupsDir, processStartTicks } from '../src/core/agent-groups.mjs';

const fresh = () => mkdtempSync(join(tmpdir(), 'agent-groups-'));
const DEAD = 999999;

test('reapAgentGroupsAtBoot logs one line when it stopped groups, nothing otherwise, and never throws', async () => {
  const home = fresh();
  const logs = [];
  const errs = [];
  const io = { log: (m) => logs.push(m), error: (m) => errs.push(m), isAlive: (pid) => pid !== DEAD, isGroupLeader: async () => true, kill: () => {} };
  assert.deepEqual(await reapAgentGroupsAtBoot({ home: () => home, ...io }), { reaped: 0, files: 0 });
  assert.deepEqual(logs, []);
  const dir = agentGroupsDir(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${DEAD}.json`), JSON.stringify([{ pgid: 111, ownerPid: DEAD }, { pgid: 222, ownerPid: DEAD }]));
  assert.deepEqual(await reapAgentGroupsAtBoot({ home: () => home, ...io }), { reaped: 2, files: 1 });
  assert.deepEqual(logs, ['[worca-ui] stopped 2 orphaned agent process group(s) left by a process that was killed']);
  const r = await reapAgentGroupsAtBoot({ home: () => { throw new Error('no home'); }, ...io });
  assert.deepEqual(r, { reaped: 0, files: 0 });
  assert.match(errs.join('\n'), /agent process-group sweep failed: no home/);
});

test('agentGroupsDir lives under the worca home, apart from the custom agents folder', () => {
  assert.equal(agentGroupsDir(join('h', 'home')), join('h', 'home', 'agent-groups'));
});

test('the tracker writes one file per owner and removes it when the last group ends', () => {
  const dir = fresh();
  const t = createGroupTracker({ dir: () => dir, ownerPid: 4242, bootId: () => 'boot-a', now: () => 1000, startTicks: (pid) => pid * 10 });
  t.add(111, { bin: 'claude' });
  t.add(222, { bin: 'codex' });
  const file = join(dir, '4242.json');
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(rows, [
    { pgid: 111, ownerPid: 4242, bootId: 'boot-a', startTicks: 1110, ownerStartTicks: 42420, startedAt: 1000, bin: 'claude' },
    { pgid: 222, ownerPid: 4242, bootId: 'boot-a', startTicks: 2220, ownerStartTicks: 42420, startedAt: 1000, bin: 'codex' },
  ]);
  t.delete(111);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).map((r) => r.pgid), [222]);
  t.delete(222);
  assert.equal(existsSync(file), false);
  t.add(333, { bin: 'claude' });
  t.clear();   // the host's own 'exit' reaper killed it
  assert.equal(existsSync(file), false);
});

test('the tracker never throws when the folder cannot be written', () => {
  const dir = fresh();
  const blocker = join(dir, 'file');
  writeFileSync(blocker, 'x');
  const t = createGroupTracker({ dir: () => join(blocker, 'sub'), ownerPid: 1, bootId: () => null });
  assert.doesNotThrow(() => { t.add(5, { bin: 'claude' }); t.delete(5); });
});

test('reapAgentGroups kills a dead owner\'s live group leaders and deletes its file', async () => {
  const dir = fresh();
  writeFileSync(join(dir, `${DEAD}.json`), JSON.stringify([
    { pgid: 111, ownerPid: DEAD, bootId: 'boot-a', bin: 'claude' },
    { pgid: 222, ownerPid: DEAD, bootId: 'boot-a', bin: 'claude' },   // already gone
    { pgid: 333, ownerPid: DEAD, bootId: 'boot-a', bin: 'claude' },   // pid recycled: not a group leader
  ]));
  const killed = [];
  const r = await reapAgentGroups({
    dir, bootId: 'boot-a', ownerPid: 1,
    isAlive: (pid) => pid === 111 || pid === 333,
    isGroupLeader: async (pid) => pid === 111,
    kill: (pid) => killed.push(pid),
  });
  assert.deepEqual(killed, [111]);
  assert.deepEqual(r, { reaped: 1, files: 1 });
  assert.equal(existsSync(join(dir, `${DEAD}.json`)), false);
});

test('reapAgentGroups leaves a live owner\'s file and its own file alone', async () => {
  const dir = fresh();
  const LIVE = 5555;
  const SELF = 7777;
  writeFileSync(join(dir, `${LIVE}.json`), JSON.stringify([{ pgid: 111, ownerPid: LIVE, bootId: 'boot-a' }]));
  writeFileSync(join(dir, `${SELF}.json`), JSON.stringify([{ pgid: 222, ownerPid: SELF, bootId: 'boot-a' }]));
  const killed = [];
  const r = await reapAgentGroups({
    dir, bootId: 'boot-a', ownerPid: SELF,
    isAlive: () => true, isGroupLeader: async () => true, kill: (pid) => killed.push(pid),
  });
  assert.deepEqual(killed, []);
  assert.deepEqual(r, { reaped: 0, files: 0 });
  assert.deepEqual(readdirSync(dir).sort(), [`${LIVE}.json`, `${SELF}.json`]);
});

test('reapAgentGroups never kills a group recorded before the last reboot (its pids may belong to anyone now)', async () => {
  const dir = fresh();
  // The owner pid is "alive" again after a reboot: some unrelated process got it.
  writeFileSync(join(dir, '4242.json'), JSON.stringify([{ pgid: 111, ownerPid: 4242, bootId: 'boot-old' }]));
  const killed = [];
  const r = await reapAgentGroups({
    dir, bootId: 'boot-new', ownerPid: 1,
    isAlive: () => true, isGroupLeader: async () => true, kill: (pid) => killed.push(pid),
  });
  assert.deepEqual(killed, []);
  assert.deepEqual(r, { reaped: 0, files: 1 });
  assert.equal(existsSync(join(dir, '4242.json')), false);
});

// A container restart keeps the kernel (same boot id) but starts a new PID namespace, and the
// agent-groups folder lives on a volume: an old row's pids now name whatever got them in the new container.
test('reapAgentGroups never kills a pid that was reused by another process (its start time differs)', async () => {
  const dir = fresh();
  writeFileSync(join(dir, `${DEAD}.json`), JSON.stringify([
    { pgid: 111, ownerPid: DEAD, bootId: 'boot-a', startTicks: 500 },   // reused: now started at 900
    { pgid: 222, ownerPid: DEAD, bootId: 'boot-a', startTicks: 600 },   // the same process: reaped
  ]));
  const killed = [];
  const r = await reapAgentGroups({
    dir, bootId: 'boot-a', ownerPid: 1,
    isAlive: (pid) => pid !== DEAD, isGroupLeader: async () => true, kill: (pid) => killed.push(pid),
    startTicks: (pid) => ({ 111: 900, 222: 600 })[pid] ?? null,
  });
  assert.deepEqual(killed, [222]);
  assert.deepEqual(r, { reaped: 1, files: 1 });
});

test('reapAgentGroups treats an owner whose pid now belongs to another process as dead', async () => {
  const dir = fresh();
  const OWNER = 20;
  writeFileSync(join(dir, `${OWNER}.json`), JSON.stringify([{ pgid: 45, ownerPid: OWNER, bootId: 'boot-a', startTicks: 70, ownerStartTicks: 60 }]));
  const killed = [];
  const r = await reapAgentGroups({
    dir, bootId: 'boot-a', ownerPid: 1,
    isAlive: () => true, isGroupLeader: async () => true, kill: (pid) => killed.push(pid),
    startTicks: (pid) => ({ [OWNER]: 61, 45: 70 })[pid] ?? null,   // pid 20 is alive, but started later
  });
  assert.deepEqual(killed, [45]);
  assert.deepEqual(r, { reaped: 1, files: 1 });
});

test('processStartTicks reads a live process\'s start time and null for a dead one', { skip: process.platform !== 'linux' && '/proc is Linux-only' }, () => {
  const t = processStartTicks(process.pid);
  assert.ok(Number.isSafeInteger(t) && t > 0, `got ${t}`);
  assert.equal(processStartTicks(process.pid), t);
  assert.equal(processStartTicks(DEAD), null);
});

test('reapAgentGroups tolerates a missing folder and a corrupt file', async () => {
  assert.deepEqual(await reapAgentGroups({ dir: join(fresh(), 'nope') }), { reaped: 0, files: 0 });
  const dir = fresh();
  writeFileSync(join(dir, `${DEAD}.json`), '{not json');
  writeFileSync(join(dir, 'README'), 'ignored: not <pid>.json');
  const r = await reapAgentGroups({ dir, bootId: 'b', ownerPid: 1, isAlive: (p) => p !== DEAD, isGroupLeader: async () => true, kill: () => assert.fail('nothing to kill') });
  assert.deepEqual(r, { reaped: 0, files: 1 });
  assert.deepEqual(readdirSync(dir), ['README']);
});

// End to end: a host supervises a long agent through the real superviseSpawn, is SIGKILLed (what the
// OOM killer does), and its agent group survives — until reapAgentGroups runs, as the next boot does.
test('a SIGKILLed host\'s agent group is reaped at the next boot', { skip: process.platform === 'win32' && 'POSIX process groups' }, async () => {
  const home = fresh();
  const host = join(home, 'host.mjs');
  const spawnMod = fileURLToPath(new URL('../src/core/engines/spawn.mjs', import.meta.url));
  writeFileSync(host, `
    const { superviseSpawn } = await import(${JSON.stringify(spawnMod)});
    superviseSpawn({ file: 'sleep', args: ['300'], displayBin: 'fake-agent', cwd: ${JSON.stringify(home)}, env: undefined, stdin: null,
      cleanup: () => {}, onEvent: () => {}, onStdoutLine: () => {}, stdoutErrorDetail: () => '', classify: () => null,
      spawnError: (e) => e, onDone: () => ({}) }).catch(() => {});
    setInterval(() => {}, 1000);`);
  const child = spawn(process.execPath, [host], { env: { ...process.env, WORCA_HOME: home }, stdio: 'ignore' });
  const exited = new Promise((r) => child.once('exit', r));
  const dir = agentGroupsDir(join(home, '.worca-cc'));   // worcaHome() = $WORCA_HOME/.worca-cc
  const file = join(dir, `${child.pid}.json`);
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  let pgid = null;
  try {
    const deadline = Date.now() + 10_000;
    while (!existsSync(file) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.ok(existsSync(file), 'the host recorded its agent group');
    [{ pgid }] = JSON.parse(readFileSync(file, 'utf8'));
    child.kill('SIGKILL');
    await exited;
    assert.ok(alive(pgid), 'the agent outlived its SIGKILLed host');
    const r = await reapAgentGroups({ dir });
    assert.equal(r.reaped, 1);
    const gone = Date.now() + 5_000;
    while (alive(pgid) && Date.now() < gone) await new Promise((res) => setTimeout(res, 50));
    assert.equal(alive(pgid), false, 'the orphaned agent group was killed');
    assert.equal(existsSync(file), false);
  } finally {
    // A failure must not leave the host (and its agent) holding the test runner open.
    try { child.kill('SIGKILL'); } catch { /* gone */ }
    if (pgid) { try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ } }
  }
});
