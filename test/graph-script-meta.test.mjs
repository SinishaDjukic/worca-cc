// test/graph-script-meta.test.mjs
// Script sidecar v2 (spec §3): the normalizer rules, the reserved await id, the
// prompt-side fields a script input refuses, per-platform maps, ports: "config".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeScriptMeta, validateScriptMetaV2, readConfigPorts, paramValueError, mockErrors, resolvePlatformValue,
  SCRIPT_RUNTIMES, DEFAULT_TIMEOUT_MS, DEFAULT_EXIT_CODES,
} from '../src/shared/graph/script-meta.mjs';

const shell = (over = {}) => ({
  key: 'runTests', metaVersion: 2, displayName: 'Run tests', runtime: 'shell', command: 'npm test',
  inputs: [{ id: 'done', type: 'void', required: false }],
  outputs: [
    { id: 'log', type: 'md', when: 'always', filename: 'tests-cycle{cycle}.md' },
    { id: 'fail', type: 'md', when: 'blocking', filename: 'tests-cycle{cycle}.md' },
    { id: 'pass', type: 'void', when: 'clean' },
  ],
  verdict: { filename: 'tests-cycle{cycle}.json' },
  ...over,
});
const node = (over = {}) => ({ key: 'diff', metaVersion: 2, runtime: 'node', file: 'git-diff.mjs',
  inputs: [], outputs: [{ id: 'diff', type: 'md', filename: 'diff-cycle{cycle}.md' }], ...over });
const errs = (raw) => validateScriptMetaV2(raw).errors;

test('a valid shell sidecar normalizes with defaults; a valid node sidecar too', () => {
  const { meta, errors } = normalizeScriptMeta(shell());
  assert.deepEqual(errors, []);
  assert.equal(meta.runtime, 'shell');
  assert.equal(meta.command, 'npm test');
  assert.equal(meta.file, null);
  assert.equal(meta.timeoutMs, DEFAULT_TIMEOUT_MS);
  assert.equal('exitCodes' in meta, false, 'absent exitCodes stay absent (the runner applies DEFAULT_EXIT_CODES)');
  assert.deepEqual(meta.params, []);
  assert.deepEqual(meta.inputs, [{ id: 'done', type: 'void', required: false }], 'no `as` on a script input');
  assert.deepEqual(meta.outputs.map((o) => o.id), ['log', 'fail', 'pass']);
  assert.deepEqual(meta.verdict, { filename: 'tests-cycle{cycle}.json' });
  assert.equal(meta.portSummary, 'Reads done; produces log, fail.');
  assert.equal(meta.color, 'amber');
  assert.equal(meta.domain, 'general');
  assert.equal('ports' in meta, false);
  const n = normalizeScriptMeta(node());
  assert.deepEqual(n.errors, []);
  assert.equal(n.meta.file, 'git-diff.mjs');
  assert.equal(n.meta.command, null);
  assert.deepEqual(SCRIPT_RUNTIMES, ['node', 'shell']);
  assert.deepEqual(DEFAULT_EXIT_CODES, { clean: [0], blocking: [1] });
});

test('key, metaVersion, runtime, order', () => {
  assert.deepEqual(errs(null), ['meta must be an object']);
  assert.ok(errs(shell({ key: '' })).includes('key is required'));
  assert.ok(errs(shell({ key: '9x' })).includes('key "9x" is not a valid script key'));
  assert.ok(errs(shell({ metaVersion: 1 })).includes('sidecar requires metaVersion 2'));
  assert.ok(errs(shell({ runtime: 'python' })).includes('runtime must be one of node, shell'));
  assert.ok(errs(shell({ runtime: undefined })).includes('runtime must be one of node, shell'));
  assert.ok(errs(shell({ order: 'x' })).includes('order must be a number'));
});

test('file and command: node needs a plain-basename file; shell needs a command, a file, or a command param', () => {
  assert.ok(errs(node({ file: undefined })).includes('runtime "node" requires file: the program to run'));
  assert.ok(errs(node({ file: '../x.mjs' })).includes('file must be a plain basename'));
  assert.ok(errs(node({ file: 'sub/x.mjs' })).includes('file must be a plain basename'));
  assert.ok(errs(node({ command: 'npm test' })).includes('command is only legal on the shell runtime'));
  assert.ok(errs(shell({ command: undefined })).includes('runtime "shell" needs a command, a file, or a command-typed param'));
  assert.deepEqual(errs(shell({ command: undefined, file: 'run.sh' })), []);
  assert.deepEqual(errs(shell({ command: undefined, params: [{ id: 'command', type: 'command', required: true }] })), []);
  assert.ok(errs(shell({ command: '' })).includes('command must be a non-empty string'));
});

test('per-platform maps: default required, known platforms only, resolved per host', () => {
  const m = normalizeScriptMeta(shell({ command: { default: 'npm test', win32: 'npm.cmd test' } })).meta;
  assert.deepEqual(m.command, { default: 'npm test', win32: 'npm.cmd test' });
  assert.equal(resolvePlatformValue(m.command, 'win32'), 'npm.cmd test');
  assert.equal(resolvePlatformValue(m.command, 'linux'), 'npm test');
  assert.equal(resolvePlatformValue('x', 'linux'), 'x');
  assert.equal(resolvePlatformValue(null, 'linux'), null);
  assert.ok(errs(shell({ command: { win32: 'npm.cmd test' } })).includes('command: a per-platform map needs a default entry'));
  assert.ok(errs(shell({ command: { default: 'x', freebsd: 'y' } })).some((e) => /unknown platform "freebsd"/.test(e)));
  assert.ok(errs(node({ file: { default: 'a.mjs', win32: '..\\a.mjs' } })).includes('file.win32 must be a plain basename'));
});

test('timeoutMs and exitCodes', () => {
  assert.ok(errs(shell({ timeoutMs: 999 })).includes('timeoutMs must be an integer >= 1000'));
  assert.ok(errs(shell({ timeoutMs: 1.5 })).includes('timeoutMs must be an integer >= 1000'));
  assert.equal(normalizeScriptMeta(shell({ timeoutMs: 5000 })).meta.timeoutMs, 5000);
  assert.equal(normalizeScriptMeta(shell({ timeoutMs: 86400000 })).meta.timeoutMs, 86400000, 'the 24 h cap is inclusive');
  assert.ok(errs(shell({ timeoutMs: 86400001 })).includes('timeoutMs must be at most 86400000 (24 h)'), 'a delay past 2^31-1 ms would fire after 1 ms');
  assert.deepEqual(normalizeScriptMeta(shell({ exitCodes: { clean: [0, 0], blocking: [1, 2] } })).meta.exitCodes, { clean: [0], blocking: [1, 2] });
  assert.ok(errs(shell({ exitCodes: { clean: [0, 1], blocking: [1] } })).includes('exitCodes: 1 listed as both clean and blocking'));
  assert.ok(errs(shell({ exitCodes: { clean: [0], blocking: ['1'] } })).includes('exitCodes.blocking must be a list of integers 0..255'));
  assert.ok(errs(node({ exitCodes: { clean: [0], blocking: [1] } })).includes('exitCodes is only legal on the shell runtime'));
});

test('params: ≤ 16, ids, types, enum options, code language, typed defaults', () => {
  const p = normalizeScriptMeta(shell({ params: [
    { id: 'command', type: 'command', label: 'Command', default: 'npm test', required: true },
    { id: 'stat', type: 'boolean', default: false },
    { id: 'mode', type: 'enum', options: ['fast', 'full'], default: 'fast' },
    { id: 'source', type: 'code', language: 'js' },
    { id: 'n', type: 'number' },
  ] })).meta.params;
  assert.deepEqual(p[0], { id: 'command', type: 'command', required: true, label: 'Command', default: 'npm test' });
  assert.deepEqual(p[2], { id: 'mode', type: 'enum', required: false, options: ['fast', 'full'], default: 'fast' });
  assert.deepEqual(p[3], { id: 'source', type: 'code', required: false, language: 'js' });
  assert.ok(errs(shell({ params: 'x' })).includes('params must be an array'));
  assert.ok(errs(shell({ params: [{ id: 'Bad', type: 'string' }] })).includes('params: bad param id "Bad"'));
  assert.ok(errs(shell({ params: [{ id: 'a', type: 'string' }, { id: 'a', type: 'string' }] })).includes('params: duplicate param id "a"'));
  assert.ok(errs(shell({ params: [{ id: 'a', type: 'blob' }] })).includes('params.a: type must be one of string, number, boolean, enum, command, code'));
  assert.ok(errs(shell({ params: [{ id: 'a', type: 'enum' }] })).includes('params.a: enum params need a non-empty options list of strings'));
  assert.ok(errs(shell({ params: [{ id: 'a', type: 'code' }] })).includes('params.a: code params need language "js"'));
  assert.ok(errs(shell({ params: [{ id: 'a', type: 'number', default: 'x' }] })).some((e) => /params\.a: default must be a finite number/.test(e)));
  assert.ok(errs(shell({ params: [{ id: 'a', type: 'enum', options: ['x'], default: 'y' }] })).some((e) => /default must be one of x/.test(e)));
  const many = Array.from({ length: 17 }, (_, i) => ({ id: `p${i}`, type: 'string' }));
  assert.ok(errs(shell({ params: many })).includes('params: at most 16 params (got 17)'));
  assert.equal(paramValueError({ type: 'boolean' }, true), '');
  assert.match(paramValueError({ type: 'boolean' }, 'true'), /must be true or false/);
  assert.equal(paramValueError({ type: 'command' }, 'ls'), '');
});

test('ports: reserved await, prompt-side fields refused, zero outputs allowed, when needs verdict', () => {
  assert.ok(errs(shell({ inputs: [{ id: 'await', type: 'md' }] })).some((e) => /port id "await" is reserved/.test(e)));
  assert.ok(errs(shell({ inputs: [{ id: 'plan', type: 'md', as: 'file' }] })).includes('inputs.plan: as is a prompt-side field — a script input does not take it'));
  assert.ok(errs(shell({ inputs: [{ id: 'plan', type: 'md', directive: 'x' }] })).includes('inputs.plan: directive is a prompt-side field — a script input does not take it'));
  assert.ok(errs(shell({ inputs: [{ id: 'tasks', type: 'json', expands: true }] })).includes('inputs.tasks: expands is a prompt-side field — a script input does not take it'));
  assert.deepEqual(errs(shell({ outputs: [], verdict: undefined })), [], 'a pure side-effect script declares no outputs');
  assert.ok(errs(shell({ verdict: undefined })).includes('outputs.fail: when "blocking" requires the script to declare verdict: { filename }'));
  assert.ok(errs(shell({ outputs: [{ id: 'a', type: 'md', filename: 'x.md' }, { id: 'b', type: 'json', filename: 'x.md' }] }))
    .includes('outputs: filename template "x.md" is shared by ports of different types'));
});

test('ports: "config" — inputs/outputs absent, defaultPorts through the same readers', () => {
  const raw = shell({ inputs: undefined, outputs: undefined, ports: 'config',
    defaultPorts: { inputs: [{ id: 'in', type: 'md', required: false }], outputs: [{ id: 'out', type: 'md', filename: 'o-cycle{cycle}.md' }] } });
  const { meta, errors } = normalizeScriptMeta(raw);
  assert.deepEqual(errors, []);
  assert.equal(meta.ports, 'config');
  assert.equal('inputs' in meta, false);
  assert.deepEqual(meta.defaultPorts.inputs, [{ id: 'in', type: 'md', required: false }]);
  assert.equal(meta.defaultPorts.outputs[0].artifactKind, 'out');
  assert.equal(meta.portSummary, 'Reads in; produces out.');
  assert.ok(errs(shell({ ports: 'config', defaultPorts: { inputs: [], outputs: [] } })).includes('ports: "config" and inputs/outputs are mutually exclusive'));
  assert.ok(errs(shell({ inputs: undefined, outputs: undefined, ports: 'config' })).some((e) => /^defaultPorts: /.test(e)));
  assert.ok(errs(shell({ ports: 'fixed' })).some((e) => /ports must be the literal "config"/.test(e)));
  const cfg = readConfigPorts({ inputs: [{ id: 'in', type: 'md' }], outputs: [{ id: 'fail', type: 'md', when: 'blocking', filename: 'f.md' }] }, { hasVerdict: true });
  assert.deepEqual(cfg.errors, []);
  assert.deepEqual(cfg.ports.inputs, [{ id: 'in', type: 'md', required: true }]);
  assert.equal(readConfigPorts({ inputs: [{ id: 'in', type: 'md', as: 'file' }], outputs: [] }).ports, null);
  assert.deepEqual(readConfigPorts(undefined).errors, ['ports config must be an object { inputs: [...], outputs: [...] }']);
});

test('mock: shape and declared non-void ports only', () => {
  const outs = shell().outputs;
  assert.deepEqual(mockErrors({ summary: 'ok', verdict: { issues: [] }, outputs: { log: { text: '# t' } } }, outs), []);
  assert.deepEqual(mockErrors({ outputs: { pass: { text: 'x' } } }, outs), ['mock.outputs.pass: void ports carry no text']);
  assert.deepEqual(mockErrors({ outputs: { nope: { text: 'x' } } }, outs), ['mock.outputs.nope: not a declared output port']);
  assert.deepEqual(mockErrors({ verdict: [] }, outs), ['mock.verdict must be { issues: [...] }']);
  assert.deepEqual(mockErrors('x', outs), ['mock must be an object { summary?, verdict?, outputs? }']);
  const m = normalizeScriptMeta(shell({ mock: { summary: 'mocked', outputs: { log: { text: '# t' } } } })).meta;
  assert.deepEqual(m.mock, { summary: 'mocked', outputs: { log: { text: '# t' } } });
  assert.ok(errs(shell({ mock: { outputs: { nope: { text: '' } } } })).includes('mock.outputs.nope: not a declared output port'));
});

test('effectiveScriptParams: sidecar defaults overlaid by the placed card', async () => {
  const { effectiveScriptParams } = await import('../src/shared/graph/script-meta.mjs');
  const meta = { params: [{ id: 'cmd', type: 'command', default: 'npm test' }, { id: 'passAt', type: 'number' }, { id: 'stat', type: 'boolean', default: false }] };
  assert.deepEqual(effectiveScriptParams(meta, {}), { cmd: 'npm test', stat: false });
  assert.deepEqual(effectiveScriptParams(meta, { params: { passAt: 2, stat: true } }), { cmd: 'npm test', stat: true, passAt: 2 });
  assert.deepEqual(effectiveScriptParams(meta, { params: 'junk' }), { cmd: 'npm test', stat: false });
  assert.deepEqual(effectiveScriptParams(null, null), {});
});

test('scriptNodeCtx: ONE builder for the run-time facts of a placed card (fresh run, resume, offline runner, bench)', async () => {
  const { scriptNodeCtx } = await import('../src/shared/graph/script-meta.mjs');
  const meta = { key: 'runTests', runtime: 'node', scriptPath: '/abs/runTests.mjs', commandResolved: null, timeoutMs: 20000,
    params: [{ id: 'cmd', type: 'command', default: 'npm test' }], mock: { summary: 'sidecar mock' } };
  const nc = scriptNodeCtx({ id: 'n_t', kind: 'script', key: 'runTests', config: { params: { cmd: 'npm run lint' }, timeoutMs: 5000, awaitAll: true } }, meta);
  assert.deepEqual(nc, { nodeId: 'n_t', kind: 'script', key: 'runTests', authoredKey: 'runTests', meta, runtime: 'node',
    file: '/abs/runTests.mjs', command: null, params: { cmd: 'npm run lint' }, timeoutMs: 5000, mock: { summary: 'sidecar mock' },
    config: { params: { cmd: 'npm run lint' }, timeoutMs: 5000, awaitAll: true }, awaitAll: true, duplicateKey: false });
  assert.equal(nc.meta, meta, 'the registry entry rides by identity');
  const bare = scriptNodeCtx({ id: 'n_t', key: 'runTests' }, meta);
  assert.deepEqual([bare.timeoutMs, bare.params, bare.mock, bare.awaitAll, bare.config], [20000, { cmd: 'npm test' }, { summary: 'sidecar mock' }, false, {}]);
  assert.deepEqual(scriptNodeCtx({ id: 'n_t', key: 'runTests', config: { mock: { summary: 'node mock' } } }, meta).mock, { summary: 'node mock' }, 'the card mock beats the sidecar mock');
  const stub = scriptNodeCtx({ id: 'n_t', key: 'gone', config: {} }, undefined);
  assert.deepEqual([stub.runtime, stub.file, stub.command, stub.timeoutMs, stub.meta], [null, null, null, 600000, {}], 'no meta: a stub the preflight refuses');
});

test('createdBy / updatedBy survive normalization and are capped at 80 chars (W19)', async () => {
  const { normalizeScriptMeta, validateScriptMetaV2 } = await import('../src/shared/graph/script-meta.mjs');
  const base = { key: 'runTests', metaVersion: 2, runtime: 'shell', command: 'npm test', inputs: [], outputs: [] };
  const { meta, errors } = normalizeScriptMeta({ ...base, createdBy: 'ui', updatedBy: 'ask:th_abc' });
  assert.deepEqual(errors, []);
  assert.equal(meta.createdBy, 'ui');
  assert.equal(meta.updatedBy, 'ask:th_abc');
  assert.equal('createdBy' in normalizeScriptMeta(base).meta, false, 'absent stays absent');
  assert.ok(validateScriptMetaV2({ ...base, createdBy: 42 }).errors.includes('createdBy must be a string of at most 80 characters'));
  assert.ok(validateScriptMetaV2({ ...base, updatedBy: 'x'.repeat(81) }).errors.includes('updatedBy must be a string of at most 80 characters'));
});
