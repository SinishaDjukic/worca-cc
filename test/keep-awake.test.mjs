// test/keep-awake.test.mjs — the idle-sleep inhibitor (src/core/keep-awake.mjs): one OS child
// while any pipeline run has agents working. Spawn is injected; no real OS tool runs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createKeepAwake, countWorking } from '../src/core/keep-awake.mjs';

function harness(opts = {}) {
  const calls = [];
  const children = [];
  const logs = [];
  const spawn = opts.spawn || ((cmd, args, o) => {
    const child = new EventEmitter();
    child.kills = 0;
    child.kill = () => { child.kills += 1; return true; };
    child.unref = () => {};
    calls.push({ cmd, args, o });
    children.push(child);
    return child;
  });
  const ka = createKeepAwake({
    platform: 'darwin', deployment: 'local', pid: 4242, log: (m) => logs.push(m), ...opts, spawn,
  });
  return { ka, calls, children, logs };
}

test('darwin: update(1) spawns caffeinate -i -w <pid> once; more working runs spawn nothing', () => {
  const { ka, calls } = harness();
  ka.update(1);
  ka.update(2);
  ka.update(3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'caffeinate');
  assert.deepEqual(calls[0].args, ['-i', '-w', '4242']);
});

test('update(0) kills the child exactly once; a later update(1) spawns a fresh one', () => {
  const { ka, calls, children } = harness();
  ka.update(1);
  ka.update(0);
  ka.update(0);
  assert.equal(children[0].kills, 1);
  ka.update(1);
  assert.equal(calls.length, 2);
  assert.notEqual(children[0], children[1]);
});

test('update(0) with nothing running spawns and kills nothing', () => {
  const { ka, calls } = harness();
  ka.update(0);
  assert.equal(calls.length, 0);
});

test('linux: systemd-inhibit --what=idle wrapping tail --pid <pid>', () => {
  const { ka, calls } = harness({ platform: 'linux' });
  ka.update(1);
  assert.equal(calls[0].cmd, 'systemd-inhibit');
  assert.ok(calls[0].args.includes('--what=idle'));
  assert.ok(calls[0].args.includes('--who=worca'));
  const i = calls[0].args.indexOf('tail');
  assert.ok(i > 0);
  assert.equal(calls[0].args[i + 1], '--pid');
  assert.equal(calls[0].args[i + 2], '4242');
});

test('win32: a powershell child that calls SetThreadExecutionState', () => {
  const { ka, calls } = harness({ platform: 'win32' });
  ka.update(1);
  assert.equal(calls[0].cmd, 'powershell');
  assert.ok(calls[0].args.some((a) => a.includes('SetThreadExecutionState')));
  assert.ok(calls[0].args.some((a) => a.includes('4242')));
});

test('an unsupported platform does nothing', () => {
  const { ka, calls } = harness({ platform: 'freebsd' });
  ka.update(1);
  assert.equal(calls.length, 0);
});

for (const deployment of ['container', 'hosted']) {
  test(`${deployment}: never spawns`, () => {
    const { ka, calls } = harness({ deployment });
    ka.update(1);
    ka.update(0);
    ka.update(2);
    assert.equal(calls.length, 0);
  });
}

test('a spawn that throws logs one warning across 5 cycles and never throws', () => {
  const { ka, logs } = harness({ spawn: () => { throw Object.assign(new Error('spawn caffeinate ENOENT'), { code: 'ENOENT' }); } });
  for (let i = 0; i < 5; i += 1) { ka.update(1); ka.update(0); }
  assert.equal(logs.length, 1);
});

test('a child that emits error ENOENT logs one warning across 5 cycles and never throws', () => {
  const { ka, children, logs } = harness();
  for (let i = 0; i < 5; i += 1) {
    ka.update(1);
    const last = children[children.length - 1];
    last.emit('error', Object.assign(new Error('spawn caffeinate ENOENT'), { code: 'ENOENT' }));
    ka.update(0);
  }
  assert.equal(logs.length, 1);
  assert.match(logs[0], /keep-awake/i);
});

test('a child that exits by itself while work continues is respawned on the next update', () => {
  const { ka, calls, children } = harness();
  ka.update(1);
  children[0].emit('exit', 0, null);
  ka.update(1);
  assert.equal(calls.length, 2);
});

test('a child killed by a signal while work continues is respawned on the next update', () => {
  const { ka, calls, children, logs } = harness();
  ka.update(1);
  children[0].emit('exit', null, 'SIGKILL');
  ka.update(1);
  assert.equal(calls.length, 2);
  assert.equal(logs.length, 0);
});

test('a child that exits non-zero by itself warns once and is never respawned', () => {
  const { ka, calls, children, logs } = harness();
  ka.update(1);
  children[0].emit('exit', 1, null);
  for (let i = 0; i < 5; i += 1) ka.update(1);
  assert.equal(calls.length, 1);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /keep-awake/i);
});

test('a non-zero exit after release (update(0)) is not a failure', () => {
  const { ka, calls, children, logs } = harness();
  ka.update(1);
  ka.update(0);
  children[0].emit('exit', 143, null);
  ka.update(1);
  assert.equal(calls.length, 2);
  assert.equal(logs.length, 0);
});

test('win32: the PowerShell script stops on error so a failed Add-Type exits non-zero', () => {
  const { ka, calls } = harness({ platform: 'win32' });
  ka.update(1);
  assert.match(calls[0].args[calls[0].args.length - 1], /^\$ErrorActionPreference\s*=\s*'Stop';/);
});

test('an exit after release does not disturb a newer child', () => {
  const { ka, calls, children } = harness();
  ka.update(1);
  ka.update(0);
  ka.update(1);
  children[0].emit('exit', null, 'SIGTERM');
  ka.update(1);
  assert.equal(calls.length, 2);
  assert.equal(children[1].kills, 0);
});

test('stop() kills a live child and makes later updates no-ops', () => {
  const { ka, calls, children } = harness();
  ka.update(1);
  ka.stop();
  assert.equal(children[0].kills, 1);
  ka.update(1);
  assert.equal(calls.length, 1);
  ka.stop();
  assert.equal(children[0].kills, 1);
});

test('countWorking: running counts, a pending question / paused / action entries do not', () => {
  const run = (o) => ({ kind: 'run', status: 'running', pendingQuestion: null, ...o });
  assert.equal(countWorking([run()]), 1);
  assert.equal(countWorking([run(), run()]), 2);
  assert.equal(countWorking([run({ pendingQuestion: { id: 'q1' } })]), 0);
  assert.equal(countWorking([run({ status: 'paused' })]), 0);
  assert.equal(countWorking([{ kind: 'action', status: 'running' }]), 0);
  assert.equal(countWorking([{ kind: 'scriptbench', status: 'running' }, { kind: 'agentgen', status: 'running' }]), 0);
});

test('countWorking: created, starting, running and pausing count; the rest do not', () => {
  for (const status of ['created', 'starting', 'running', 'pausing', 'RUNNING']) {
    assert.equal(countWorking([{ status }]), 1, status);
  }
  for (const status of ['paused', 'stopped', 'done', 'error', 'interrupted', undefined]) {
    assert.equal(countWorking([{ status }]), 0, String(status));
  }
  assert.equal(countWorking([{ kind: 'workspace-run', status: 'running' }]), 1);
});
