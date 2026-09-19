// test/graph-python-probe.test.mjs
// The python probe (scripts-workbench spec §7). Every seam is injected — env,
// platform, spawn, settings — so the WINDOWS candidate order, the Windows Store
// stub and the 3.8 floor are all exercised on macOS and Linux with no python on
// the machine at all. The fake child emits synchronously, so no test depends on
// stream timing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  pythonCandidates, parseVersion, meetsFloor, probePython, resetPythonProbe, pythonRuntimeState,
  PYTHON_MIN, VERSION_SCRIPT, PROBE_OUTPUT_MAX,
} from '../src/core/graph/python-probe.mjs';

/** A stdout/stderr stand-in: setEncoding/resume chain like a real stream, events by hand. */
function fakeStream() {
  const s = new EventEmitter();
  s.setEncoding = () => s;
  s.resume = () => s;
  return s;
}

/**
 * A spawn stub driven by a table keyed on the command label (`py -3`, `python3`).
 * Plan: { out, code } | { code } (no stdout: the Windows Store stub) | { hang: true }
 * | { flood: true } (prints for ever, never closes until killed)
 * | absent (ENOENT). Returns [spawn, calls].
 */
function fakeSpawn(table) {
  const calls = [];
  const spawn = (file, args) => {
    const label = [file, ...args.slice(0, -2)].join(' ');       // args tail is ['-c', VERSION_SCRIPT]
    const child = new EventEmitter();
    calls.push({ label, script: args[args.length - 1], child });
    child.stdout = fakeStream();
    child.stderr = fakeStream();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    const plan = Object.prototype.hasOwnProperty.call(table, label) ? table[label] : null;
    setImmediate(() => {
      if (!plan) { child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })); return; }
      if (plan.hang) return;
      if (plan.flood) {
        // Emits until the probe kills it; bounded here so a broken probe fails the test instead of hanging it.
        child.chunks = 0;
        while (child.chunks < 64 && !child.killed) { child.chunks++; child.stdout.emit('data', 'y\n'.repeat(512)); }
        return;
      }
      if (plan.out) child.stdout.emit('data', plan.out);
      child.emit('close', plan.code ?? 0, null);
    });
    return spawn.lastChild = child;
  };
  return [spawn, calls];
}

const V = (a, b, c) => `[${a}, ${b}, ${c}]\n`;

test('candidate order: POSIX tries python3 then python; Windows tries py -3, python, python3', () => {
  const posix = pythonCandidates({ env: {}, platform: 'darwin', settings: {} });
  assert.deepEqual(posix.map((c) => c.command), [['python3'], ['python']]);
  assert.deepEqual(pythonCandidates({ env: {}, platform: 'linux', settings: {} }).map((c) => c.command), [['python3'], ['python']]);
  const win = pythonCandidates({ env: {}, platform: 'win32', settings: {} });
  assert.deepEqual(win.map((c) => c.command), [['py', '-3'], ['python'], ['python3']]);
  assert.deepEqual(win.map((c) => c.source), ['path', 'path', 'path']);
});

test('an explicit interpreter is authoritative and is never split on whitespace (P2-D2, P2-D3)', () => {
  const env = { WORCA_PYTHON: 'C:\\Program Files\\Python312\\python.exe' };
  const withEnv = pythonCandidates({ env, platform: 'win32', settings: { pythonPath: '/usr/bin/python3' } });
  assert.deepEqual(withEnv, [{ command: ['C:\\Program Files\\Python312\\python.exe'], source: 'WORCA_PYTHON' }]);
  const withSetting = pythonCandidates({ env: {}, platform: 'darwin', settings: { pythonPath: '/opt/venv/bin/python' } });
  assert.deepEqual(withSetting, [{ command: ['/opt/venv/bin/python'], source: 'pythonPath' }]);
  assert.deepEqual(pythonCandidates({ env: { WORCA_PYTHON: '  ' }, platform: 'darwin', settings: {} }).map((c) => c.source), ['path', 'path']);
});

test('an explicit interpreter with a directory part is made absolute; a bare name stays a PATH lookup', () => {
  // The probe spawns from the server's cwd, the runner from the RUN's cwd: a relative venv pointer that stayed
  // relative would pass the probe and then fail every execution with ENOENT.
  const posix = (WORCA_PYTHON) => pythonCandidates({ env: { WORCA_PYTHON }, platform: 'linux', settings: {}, cwd: '/srv/app' })[0].command;
  assert.deepEqual(posix('.venv/bin/python'), ['/srv/app/.venv/bin/python']);
  assert.deepEqual(posix('/usr/bin/python3'), ['/usr/bin/python3']);
  assert.deepEqual(posix('python3.12'), ['python3.12'], 'no directory part: PATH lookup, cwd-independent');
  const win = (pythonPath) => pythonCandidates({ env: {}, platform: 'win32', settings: { pythonPath }, cwd: 'C:\\work' })[0].command;
  assert.deepEqual(win('.venv\\Scripts\\python.exe'), ['C:\\work\\.venv\\Scripts\\python.exe']);
  assert.deepEqual(win('C:\\Program Files\\Python312\\python.exe'), ['C:\\Program Files\\Python312\\python.exe']);
  assert.deepEqual(win('python'), ['python']);
});

test('parseVersion reads the version script, and only the version script', () => {
  assert.deepEqual(parseVersion('[3, 12, 4]\n'), [3, 12, 4]);
  assert.deepEqual(parseVersion('warning: something\n[3, 8, 0]'), [3, 8, 0], 'a banner line before the answer is tolerated');
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion('Python 3.12.4'), null);
  assert.equal(parseVersion('[3, 12]'), null);
  assert.equal(parseVersion('["3", "12", "4"]'), null);
  assert.deepEqual(PYTHON_MIN, [3, 8]);
  assert.equal(meetsFloor([3, 8, 0]), true);
  assert.equal(meetsFloor([4, 0, 0]), true);
  assert.equal(meetsFloor([3, 7, 17]), false);
  assert.equal(meetsFloor([2, 7, 18]), false);
});

test('probePython: the first candidate that answers 3.8+ wins, and the version script is what runs', async () => {
  const [spawn, calls] = fakeSpawn({ python3: { out: V(3, 12, 4) } });
  const r = await probePython({ env: {}, platform: 'linux', settings: {}, spawn });
  assert.deepEqual(r, { ok: true, command: ['python3'], version: [3, 12, 4] });
  assert.deepEqual(calls.map((c) => c.label), ['python3']);
  assert.equal(calls[0].script, VERSION_SCRIPT);
});

test('Windows: py -3 is tried first, and the Store stub (no stdout, exit 9009) is skipped', async () => {
  const [stub, stubCalls] = fakeSpawn({ python: { code: 9009 }, python3: { out: V(3, 11, 9) } });
  const r = await probePython({ env: {}, platform: 'win32', settings: {}, spawn: stub });
  assert.deepEqual(r, { ok: true, command: ['python3'], version: [3, 11, 9] });
  assert.deepEqual(stubCalls.map((c) => c.label), ['py -3', 'python', 'python3'], 'py -3 first, then the stub, then python3');
  const [launcher] = fakeSpawn({ 'py -3': { out: V(3, 12, 0) }, python: { code: 9009 } });
  assert.deepEqual(await probePython({ env: {}, platform: 'win32', settings: {}, spawn: launcher }),
    { ok: true, command: ['py', '-3'], version: [3, 12, 0] });
});

test('the 3.8 floor: an older interpreter is refused, and its version is in the reason', async () => {
  const [spawn] = fakeSpawn({ python3: { out: V(3, 7, 9) }, python: { out: V(2, 7, 18) } });
  const r = await probePython({ env: {}, platform: 'linux', settings: {}, spawn });
  assert.deepEqual(r, { ok: false, reason: 'python 3.7.9 at "python3" is older than 3.8 — point WORCA_PYTHON at a newer interpreter' });
});

test('nothing found: the reason names every candidate that was tried', async () => {
  const [spawn] = fakeSpawn({});
  assert.deepEqual(await probePython({ env: {}, platform: 'darwin', settings: {}, spawn }),
    { ok: false, reason: 'no python 3.8 or newer found (tried python3, python)' });
  const [win] = fakeSpawn({});
  assert.deepEqual(await probePython({ env: {}, platform: 'win32', settings: {}, spawn: win }),
    { ok: false, reason: 'no python 3.8 or newer found (tried py -3, python, python3)' });
});

test('an explicit interpreter that does not work names itself and nothing else', async () => {
  const [spawn, calls] = fakeSpawn({ python3: { out: V(3, 12, 4) } });
  assert.deepEqual(await probePython({ env: { WORCA_PYTHON: '/nope/python' }, platform: 'linux', settings: {}, spawn }),
    { ok: false, reason: 'WORCA_PYTHON "/nope/python" is not a working python' });
  assert.deepEqual(calls.map((c) => c.label), ['/nope/python'], 'no fall-through to python3 (P2-D2)');
  const [s2] = fakeSpawn({});
  assert.deepEqual(await probePython({ env: {}, platform: 'linux', settings: { pythonPath: '/opt/p' }, spawn: s2 }),
    { ok: false, reason: 'the pythonPath setting "/opt/p" is not a working python' });
});

test('a candidate that never answers is abandoned at the timeout and the child is killed', async () => {
  const [spawn] = fakeSpawn({ python3: { hang: true }, python: { out: V(3, 9, 6) } });
  const r = await probePython({ env: {}, platform: 'linux', settings: {}, spawn, timeoutMs: 25 });
  assert.deepEqual(r, { ok: true, command: ['python'], version: [3, 9, 6] });
});

test('a candidate that floods stdout is cut off at PROBE_OUTPUT_MAX and killed — it can never fill a host string', async () => {
  const [spawn, calls] = fakeSpawn({ python3: { flood: true }, python: { out: V(3, 10, 2) } });
  const r = await probePython({ env: {}, platform: 'linux', settings: {}, spawn, timeoutMs: 2000 });
  assert.deepEqual(r, { ok: true, command: ['python'], version: [3, 10, 2] });
  const flooder = calls[0].child;
  assert.equal(flooder.killed, true);
  assert.ok(flooder.chunks * 1024 <= PROBE_OUTPUT_MAX + 1024, `cut after ${flooder.chunks} KiB, not at the timeout`);
  assert.ok(PROBE_OUTPUT_MAX <= 64 * 1024);
});

test('probePython never rejects: a throwing seam is "no python", with the reason', async () => {
  const boom = { get pythonPath() { throw new Error('settings exploded'); } };
  assert.deepEqual(await probePython({ env: {}, platform: 'linux', settings: boom, spawn: () => { throw new Error('unreachable'); } }),
    { ok: false, reason: 'the python probe failed: settings exploded' });
});

test('the 60 s cache covers the bare call only — an injected call never poisons it', async () => {
  resetPythonProbe();
  const [spawn, calls] = fakeSpawn({ python3: { out: V(3, 12, 4) } });
  await probePython({ env: {}, platform: 'linux', settings: {}, spawn });
  await probePython({ env: {}, platform: 'linux', settings: {}, spawn });
  assert.equal(calls.length, 2, 'an injected probe is never cached');
  const prev = process.env.WORCA_PYTHON;
  process.env.WORCA_PYTHON = '/definitely/not/python';
  try {
    resetPythonProbe();
    const a = await probePython();
    const b = await probePython();
    assert.equal(a.ok, false);
    assert.equal(b, a, 'the bare call is served from the cache');
    resetPythonProbe();
    assert.notEqual(await probePython(), a, 'resetPythonProbe drops it');
  } finally {
    if (prev === undefined) delete process.env.WORCA_PYTHON; else process.env.WORCA_PYTHON = prev;
    resetPythonProbe();
  }
});

test('pythonRuntimeState is the shape GET /api/scripts/runtimes answers with', () => {
  assert.deepEqual(pythonRuntimeState({ ok: true, command: ['py', '-3'], version: [3, 12, 4] }),
    { ok: true, version: '3.12.4', command: ['py', '-3'] });
  assert.deepEqual(pythonRuntimeState({ ok: false, reason: 'no python 3.8 or newer found (tried python3, python)' }),
    { ok: false, reason: 'no python 3.8 or newer found (tried python3, python)' });
});
