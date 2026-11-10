// test/executor-protocol.test.mjs — the controller <-> worker frame vocabulary
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidFrame, encodeFrame, decodeFrame, MAX_FRAME_BYTES, PROTOCOL_VERSION, SIGNALS, WORKER_FRAMES, CONTROLLER_FRAMES,
} from '../src/core/executor/protocol.mjs';

const caps = { engines: { claude: { bin: '/usr/local/bin/claude', version: '2.1.0' }, codex: null }, platform: 'linux', node: 'v24.0.0', user: 'worca' };
const exec = { type: 'exec', id: 'x1', file: '/bin/sh', args: ['-c', 'echo hi'], cwd: '/tmp', env: { PATH: '/bin' }, stdin: null, detached: true };

const VALID = [
  { type: 'hello', apiVersion: PROTOCOL_VERSION, workerId: 'w1', scope: { kind: 'run', id: 'r1' }, pid: 42, capabilities: caps },
  { type: 'welcome', controllerBootId: 'b1', pingMs: 30000, idleMs: null },
  { type: 'welcome', controllerBootId: 'b1', pingMs: 30000, idleMs: 900000 },
  { type: 'refuse', reason: 'unknown token' },
  exec,
  { ...exec, stdin: 'a prompt' },
  { type: 'started', id: 'x1', pid: 43 },
  { type: 'spawn-error', id: 'x1', code: 'ENOENT', message: 'spawn claude ENOENT' },
  { type: 'spawn-error', id: 'x1', code: null, message: 'boom' },
  { type: 'out', id: 'x1', seq: 0, stream: 'out', lines: ['one', 'two'] },
  { type: 'out', id: 'x1', seq: 7, stream: 'err', lines: [''] },
  { type: 'ack', id: 'x1', seq: 7 },
  { type: 'exit', id: 'x1', code: 0, signal: null },
  { type: 'exit', id: 'x1', code: null, signal: 'SIGKILL' },
  { type: 'signal', id: 'x1', sig: 'SIGTERM' },
  { type: 'relay', id: 'r1', token: 't', line: '{"jsonrpc":"2.0"}' },
  { type: 'relay-result', id: 'r1', lines: ['{}'], error: null },
  { type: 'relay-result', id: 'r1', lines: null, error: 'unknown token' },
  { type: 'ping', id: 'p1' }, { type: 'pong', id: 'p1' },
  { type: 'shutdown' }, { type: 'shutdown', graceMs: 5000 },
  { type: 'log', level: 'warn', msg: 'hm' },
  { type: 'bye' },
];

test('every documented frame validates and round-trips through encode/decode', () => {
  for (const f of VALID) {
    assert.ok(isValidFrame(f), `valid: ${JSON.stringify(f).slice(0, 80)}`);
    assert.deepEqual(decodeFrame(encodeFrame(f)), f);
  }
  const names = new Set(VALID.map((f) => f.type));
  for (const t of [...WORKER_FRAMES, ...CONTROLLER_FRAMES]) assert.ok(names.has(t), `a fixture covers ${t}`);
});

test('malformed frames are refused', () => {
  const bad = [
    null, 'hello', { type: 'nope' }, { type: 'hello', apiVersion: 1 },
    { type: 'hello', apiVersion: 1, workerId: 'w', scope: { kind: 'job', id: 'x' }, pid: 1, capabilities: caps },
    { type: 'hello', apiVersion: 1, workerId: 'w', scope: { kind: 'run', id: 'x' }, pid: 1, capabilities: { engines: { claude: { version: '1' } }, platform: 'linux', node: 'v24' } },
    { ...exec, env: { PATH: 3 } }, { ...exec, args: 'echo' }, { ...exec, cwd: '' }, { ...exec, stdin: 5 },
    { type: 'out', id: 'x1', seq: 0, stream: 'out', lines: [] },
    { type: 'out', id: 'x1', seq: -1, stream: 'out', lines: ['a'] },
    { type: 'out', id: 'x1', seq: 0, stream: 'both', lines: ['a'] },
    { type: 'exit', id: 'x1', code: null, signal: null },
    { type: 'signal', id: 'x1', sig: 'SIGHUP' },
    { type: 'welcome', controllerBootId: 'b', pingMs: 0, idleMs: null },
    { type: 'log', level: 'debug', msg: 'x' },
    { type: 'started', id: 'x1', pid: 0 },
  ];
  for (const f of bad) assert.equal(isValidFrame(f), false, `invalid: ${JSON.stringify(f)?.slice(0, 80)}`);
  assert.deepEqual(SIGNALS, ['SIGTERM', 'SIGKILL', 'SIGINT']);
});

test('encode refuses an invalid or oversize frame; decode returns null on garbage and on oversize input', () => {
  assert.throws(() => encodeFrame({ type: 'nope' }), /invalid nope frame/);
  const huge = { ...exec, stdin: 'x'.repeat(MAX_FRAME_BYTES) };
  assert.throws(() => encodeFrame(huge), /MAX_FRAME_BYTES/);
  // Coded, so the sender tells a malformed request and an oversize one from a socket that is gone.
  assert.throws(() => encodeFrame({ ...exec, file: '' }), { code: 'EPROTO', message: 'invalid exec frame' });
  assert.throws(() => encodeFrame(huge), { code: 'E2BIG' });
  // A spawn without a cwd is valid, as it is locally: null means the worker's own.
  assert.equal(isValidFrame({ ...exec, cwd: null }), true);
  // An output frame may say that its last line continues in the next frame.
  const out = { type: 'out', id: 'x1', seq: 0, stream: 'out', lines: ['part'] };
  assert.equal(isValidFrame({ ...out, more: true }), true);
  assert.equal(isValidFrame(out), true);
  assert.equal(isValidFrame({ ...out, more: 'yes' }), false);
  assert.equal(isValidFrame({ ...exec, cwd: '' }), false);
  assert.equal(isValidFrame({ ...exec, reap: true }), true);
  assert.equal(isValidFrame({ ...exec, reap: 1 }), false);
  assert.equal(isValidFrame({ ...exec, withheld: ['OPENAI_API_KEY', 'LANG'] }), true, 'names the controller left out of env on purpose');
  assert.equal(isValidFrame({ ...exec, withheld: [] }), true);
  assert.equal(isValidFrame({ ...exec, withheld: 'OPENAI_API_KEY' }), false);
  assert.equal(isValidFrame({ ...exec, withheld: ['ok', 7] }), false);
  const hello = { type: 'hello', apiVersion: PROTOCOL_VERSION, workerId: 'w1', scope: { kind: 'run', id: 'r1' }, pid: 42, capabilities: { ...caps, worca: '1.3.0' } };
  assert.equal(isValidFrame(hello), true, 'a worker says which worca it runs');
  assert.equal(isValidFrame({ ...hello, capabilities: { ...caps, worca: 13 } }), false);
  assert.equal(decodeFrame('{not json'), null);
  assert.equal(decodeFrame('{"type":"nope"}'), null);
  assert.equal(decodeFrame(JSON.stringify(huge)), null);
  assert.equal(decodeFrame(42), null);
  assert.deepEqual(decodeFrame(Buffer.from(JSON.stringify({ type: 'bye' }))), { type: 'bye' });
});
