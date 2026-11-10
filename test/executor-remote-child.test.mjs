// test/executor-remote-child.test.mjs — the ChildProcess-shaped handle for an exec on a worker
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { createRemoteChild, withheldNames, WORKER_LOST } from '../src/core/executor/remote-child.mjs';

/** A session that records the exec and hands the test its handlers. */
function fakeSession() {
  const s = { workerId: 'w9', specs: [], signals: [], handlers: null };
  s.exec = (spec, h) => { s.specs.push(spec); s.handlers = h; return 'x1'; };
  s.signal = (id, sig) => s.signals.push([id, sig]);
  return s;
}
const spec = { file: 'claude', args: ['-p'], cwd: '/w', env: { PATH: '/bin' }, stdin: 'hello', displayBin: 'claude' };
const lines = (stream) => { const out = []; createInterface({ input: stream }).on('line', (l) => out.push(l)); return out; };

test('the exec frame carries file/args/cwd/env/stdin; stdin on the child is a stub', () => {
  const s = fakeSession();
  const child = createRemoteChild(s, { ...spec, controllerEnv: { PATH: '/usr/bin', OPENAI_API_KEY: 'sk-held-here', EMPTY: '' } });
  assert.deepEqual(s.specs, [{ file: 'claude', args: ['-p'], cwd: '/w', env: { PATH: '/bin' }, stdin: 'hello', detached: true, reap: false, withheld: ['OPENAI_API_KEY'] }]);
  createRemoteChild(s, { ...spec, reap: true });
  assert.equal(s.specs[1].reap, true, "an engine's spawn asks the worker to reap its process group at the end");
  assert.equal(child.remote, true);
  assert.equal(child.id, 'x1');
  assert.equal(child.workerId, 'w9');
  assert.equal(child.pid, null);
  child.stdin.on('error', () => {});
  child.stdin.end('ignored');
});

test('started sets the pid; out frames reach stdout/stderr line by line; exit sets the codes and closes after the lines', async () => {
  const s = fakeSession();
  const child = createRemoteChild(s, spec);
  const out = lines(child.stdout); const err = lines(child.stderr);
  const order = [];
  child.stdout.on('data', () => order.push('data'));
  s.handlers.onStarted({ pid: 777 });
  assert.equal(child.pid, 777);
  s.handlers.onLines({ stream: 'out', lines: ['one', 'two'] });
  s.handlers.onLines({ stream: 'err', lines: ['warn'] });
  s.handlers.onLines({ stream: 'out', lines: ['three'] });
  s.handlers.onExit({ code: 3, signal: null });
  assert.equal(child.exitCode, 3);
  assert.equal(child.signalCode, null);
  const [code, sig] = await once(child, 'close');
  assert.deepEqual([code, sig], [3, null]);
  assert.deepEqual(out, ['one', 'two', 'three'], 'every line was delivered before close');
  assert.deepEqual(err, ['warn']);
  assert.ok(order.length >= 1);
});

test('kill() relays the signal through the session while the exec lives, and is a no-op after exit', async () => {
  const s = fakeSession();
  const child = createRemoteChild(s, spec);
  lines(child.stdout); lines(child.stderr);
  assert.equal(child.kill(), true);
  assert.equal(child.kill('SIGKILL'), true);
  assert.deepEqual(s.signals, [['x1', 'SIGTERM'], ['x1', 'SIGKILL']]);
  s.handlers.onExit({ code: null, signal: 'SIGKILL' });
  await once(child, 'close');
  assert.equal(child.kill(), false);
  assert.equal(s.signals.length, 2);
});

test('a line that travelled in pieces arrives as the one line it was', async () => {
  const s = fakeSession();
  const child = createRemoteChild(s, spec);
  const out = lines(child.stdout); lines(child.stderr);
  s.handlers.onStarted({ pid: 7 });
  s.handlers.onLines({ stream: 'out', lines: ['before'] });
  s.handlers.onLines({ stream: 'out', lines: ['{"big":"aaa'], more: true });
  s.handlers.onLines({ stream: 'out', lines: ['bbb'], more: true });
  s.handlers.onLines({ stream: 'out', lines: ['ccc"}', 'after'] });
  s.handlers.onExit({ code: 0, signal: null });
  await once(child, 'close');
  assert.deepEqual(out, ['before', '{"big":"aaabbbccc"}', 'after'], 'no newline was put inside the long line');
});

test('a spawn error on the worker becomes an error event carrying the code', async () => {
  const s = fakeSession();
  const child = createRemoteChild(s, spec);
  lines(child.stdout); lines(child.stderr);
  s.handlers.onSpawnError({ code: 'ENOENT', message: 'spawn claude ENOENT' });
  const [err] = await once(child, 'error');
  assert.equal(err.code, 'ENOENT');
  assert.match(err.message, /ENOENT/);
  assert.equal(err.errorClass, undefined, 'a spawn error on the worker has no recovery class of its own');
  // A request that never left because the worker was already gone is a lost worker: network class, like onLost.
  const s2 = fakeSession();
  const child2 = createRemoteChild(s2, spec);
  lines(child2.stdout); lines(child2.stderr);
  s2.handlers.onSpawnError({ code: 'EWORKERLOST', message: 'worker w1 is gone (closed)', errorClass: 'network' });
  const [err2] = await once(child2, 'error');
  assert.deepEqual([err2.code, err2.errorClass], ['EWORKERLOST', 'network']);
});

test('a lost worker becomes a network-class error naming the worker, then a close with SIGKILL', async () => {
  const s = fakeSession();
  const child = createRemoteChild(s, spec);
  lines(child.stdout); lines(child.stderr);
  s.handlers.onStarted({ pid: 5 });
  // Not events.once(): that helper rejects on the 'error' event this test expects first.
  const closed = new Promise((r) => child.once('close', (...a) => r(a)));
  s.handlers.onLost('socket closed');
  const [err] = await once(child, 'error');
  assert.equal(err.code, WORKER_LOST);
  assert.equal(err.errorClass, 'network');
  assert.match(err.message, /worker w9 lost: socket closed \(while running claude\)/);
  assert.deepEqual(await closed, [null, 'SIGKILL']);
  assert.equal(child.signalCode, 'SIGKILL');
});

test('a loss reported after a normal exit is ignored', async () => {
  const s = fakeSession();
  const child = createRemoteChild(s, spec);
  lines(child.stdout); lines(child.stderr);
  let errors = 0;
  child.on('error', () => { errors += 1; });
  s.handlers.onExit({ code: 0, signal: null });
  await once(child, 'close');
  s.handlers.onLost('late');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(errors, 0);
  assert.equal(child.exitCode, 0);
});

test('close still fires when nobody consumes the streams (after the drain grace)', async () => {
  const s = fakeSession();
  const child = createRemoteChild(s, spec);
  s.handlers.onLines({ stream: 'out', lines: ['unread'] });
  s.handlers.onExit({ code: 0, signal: null });
  const started = Date.now();
  await once(child, 'close');
  assert.ok(Date.now() - started < 5000);
});

test('withheldNames: what the controller holds and did not send, and every model credential when the broker is on', () => {
  const controller = { PATH: '/usr/bin', LANG: 'C', OPENAI_API_KEY: 'sk-1', GH_TOKEN: 'ghp', ANTHROPIC_API_KEY: 'sk-ant', UNSET_BY_COMPOSE: '' };
  // An env scrub kept PATH and the engine's own names only: the rest was left out on purpose.
  assert.deepEqual(withheldNames({ PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-ant' }, controller).sort(), ['GH_TOKEN', 'LANG', 'OPENAI_API_KEY']);
  assert.deepEqual(withheldNames({ ...controller }, controller), [], 'nothing removed: the worker may add what the controller never held');
  assert.deepEqual(withheldNames(null, { A: '1' }), ['A']);
  // With the broker on an agent holds the broker's token only, whether or not the controller ever held a key.
  const brokered = withheldNames({ PATH: '/usr/bin', ANTHROPIC_AUTH_TOKEN: 'broker-token' }, { PATH: '/usr/bin', WORCA_BROKER_URL: 'http://broker:8080' });
  assert.ok(brokered.includes('ANTHROPIC_API_KEY') && brokered.includes('CLAUDE_CODE_OAUTH_TOKEN') && brokered.includes('OPENAI_API_KEY'));
  assert.ok(!brokered.includes('ANTHROPIC_AUTH_TOKEN'), 'the token the spawn was given is not withheld');
  assert.ok(!withheldNames({ PATH: '/usr/bin' }, { PATH: '/usr/bin' }).includes('ANTHROPIC_API_KEY'), 'no broker: a worker-held key is the worker\'s to add');
});

test('kill reports false for a signal the protocol cannot carry, and sends nothing', () => {
  const s = fakeSession();
  const child = createRemoteChild(s, { ...spec, controllerEnv: {} });
  assert.equal(child.kill('SIGHUP'), false);
  assert.equal(child.kill(9), false);
  assert.deepEqual(s.signals, []);
  assert.equal(child.kill('SIGTERM'), true);
  assert.deepEqual(s.signals, [['x1', 'SIGTERM']]);
});
