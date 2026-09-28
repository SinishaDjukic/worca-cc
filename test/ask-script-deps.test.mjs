// test/ask-script-deps.test.mjs
// The chat's script bundle (scripts-workbench-design.md §9.1, W19/W20) over a fake io:
// the user-layer save rules, the overwrite argument, cases normalized before any write,
// the bench request, the stop-on-abort guard and the trimming a model reads.
// No store, no bench child, no python probe, no claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultScriptDeps, trimBenchResult, scriptHostRuntimes, askScriptPromptInput, SCRIPT_ERRORS,
} from '../src/core/ask/script-deps.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';

const META = (over = {}) => ({
  key: 'runTests', metaVersion: 2, displayName: 'Run tests', description: 'Runs the suite.',
  runtime: 'shell', inputs: [], outputs: [], ...over,
});
const coded = (msg, code) => Object.assign(new Error(msg), { code });

const BENCH_RESULT = {
  status: 'blocking', exitCode: 1, runtime: 'shell', durationMs: 4200, summary: '3 failing',
  warnings: ['no verdict file'], fired: ['log', 'fail'],
  outputs: {
    log: { type: 'md', path: '/tmp/bench/pipeline/tests-1.md', bytes: 9, text: 'npm test', truncated: false },
    pass: { type: 'void' },
  },
  verdict: { issues: [{ severity: 'major', title: '3 tests failed' }], summary: 'suite red' },
  envelopePath: '/tmp/bench/pipeline/bench.envelope.json', error: null, expect: null,
  draft: false, benchDir: '/tmp/bench/b_1',
};

function fakeIo(over = {}, { signal = null } = {}) {
  const calls = [];
  const rows = new Map();                       // key -> { meta, source, cases }
  const io = {
    enabled: () => true,
    userScriptsDir: () => '/h/.worca-cc/scripts',
    listScripts: async () => [...rows.values()].map((s) => ({ ...s.meta, caseCount: s.cases.length })),
    readScript: async (key) => (rows.has(key)
      ? { meta: rows.get(key).meta, source: rows.get(key).source, sourceWin32: '', sourceTruncated: false,
        cases: rows.get(key).cases, userCases: rows.get(key).userCases ?? [], casesWritable: true }
      : null),
    createScript: async ({ meta, source, sourceWin32, by }) => {
      calls.push(['createScript', meta, source, sourceWin32, by]);
      const stored = { meta: { ...meta, origin: 'user', createdBy: by, file: `${meta.key}.sh`, scriptPath: `/h/.worca-cc/scripts/${meta.key}.sh`, portSummary: '' }, source, cases: [] };
      rows.set(meta.key, stored);
      return { meta: stored.meta, source, sourceWin32 };
    },
    updateScript: async (key, { meta, source, sourceWin32, by }) => {
      calls.push(['updateScript', key, meta, source, sourceWin32, by]);
      const stored = { meta: { ...meta, origin: 'user', updatedBy: by, file: `${key}.sh` }, source, cases: rows.get(key)?.cases ?? [] };
      rows.set(key, stored);
      return { meta: stored.meta, source, sourceWin32, warnings: ['a saved workflow places this script'] };
    },
    writeCases: async (key, cases) => { calls.push(['writeCases', key, cases]); rows.get(key).cases = cases; return { cases }; },
    normalizeCases: (raw, meta) => {
      calls.push(['normalizeCases', raw.cases.length, meta.key]);
      return raw.cases.some((c) => !c.name) ? { cases: [], errors: ['case 1: name is required'] } : { cases: raw.cases, errors: [] };
    },
    runBenchOnce: async (request, deps) => {
      calls.push(['runBenchOnce', request]);
      deps.onBench({ stop: () => calls.push(['stop']) });
      deps.onLine({ benchId: 'bench_0001', caseId: null, stream: 'out', text: 'npm test' });
      deps.onLine({ benchId: 'bench_0001', caseId: null, stream: 'out', text: '3 failing' });
      return BENCH_RESULT;
    },
    ...over,
  };
  return { io, calls, rows, s: defaultScriptDeps({ threadId: 'ask_0000beef', signal, io }).scripts };
}

test('save: a fresh key creates on the user layer, stamped ask:<threadId>, computed meta fields stripped', async () => {
  const { s, calls } = fakeIo();
  const out = await s.save({ key: 'runTests', meta: META({ origin: 'builtin', scriptPath: '/evil', file: '../../etc/passwd', createdBy: 'ui', portSummary: 'x' }), source: 'npm test\n' });
  assert.deepEqual(out, { ok: true, key: 'runTests', created: true, path: '/h/.worca-cc/scripts/runTests.sh', link: '#scripts/runTests' });
  const [, meta, source, , by] = calls.find((c) => c[0] === 'createScript');
  assert.equal(by, 'ask:ask_0000beef');
  assert.equal(source, 'npm test\n');
  assert.equal(meta.metaVersion, 2);
  assert.equal(meta.key, 'runTests');
  for (const k of ['origin', 'scriptPath', 'file', 'createdBy', 'updatedBy', 'commandResolved', 'scriptsDir', 'portSummary', 'caseCount']) {
    assert.equal(Object.prototype.hasOwnProperty.call(meta, k), false, `${k} never rides into a write`);
  }
});

test('save: an existing user key needs overwrite: true; built-in and plugin keys are always refused, and nothing is written', async () => {
  const { s, calls } = fakeIo();
  await s.save({ key: 'runTests', meta: META(), source: 'npm test\n' });
  assert.deepEqual(await s.save({ key: 'runTests', meta: META(), source: 'npm run lint\n' }),
    { ok: false, errors: ['script "runTests" exists — pass overwrite: true to replace it'] });
  assert.equal(calls.filter((c) => c[0] === 'updateScript').length, 0, 'the refusal wrote nothing');
  const over = await s.save({ key: 'runTests', meta: META(), source: 'npm run lint\n', overwrite: true });
  assert.equal(over.ok, true);
  assert.equal(over.created, false);
  assert.deepEqual(over.warnings, ['a saved workflow places this script']);
  assert.equal(calls.find((c) => c[0] === 'updateScript')[5], 'ask:ask_0000beef');

  const builtin = fakeIo({ readScript: async () => ({ meta: { key: 'shell', origin: 'builtin' }, cases: [], userCases: [] }) });
  assert.deepEqual(await builtin.s.save({ key: 'shell', meta: META({ key: 'shell' }), source: 'x', overwrite: true }),
    { ok: false, errors: ['script "shell" is a built-in — save your version under a new key instead'] });
  const plugin = fakeIo({ readScript: async () => ({ meta: { key: 'lint', origin: 'plugin:acme-tools' }, cases: [], userCases: [] }) });
  assert.deepEqual(await plugin.s.save({ key: 'lint', meta: META({ key: 'lint' }), source: 'x', overwrite: true }),
    { ok: false, errors: ['script "lint" is shipped by plugin "acme-tools" — save your version under a new key instead'] });
  assert.equal(builtin.calls.concat(plugin.calls).some((c) => c[0] === 'createScript' || c[0] === 'updateScript'), false);
});

test('save: bad input and coded store refusals come back as errors; an uncoded failure is thrown', async () => {
  const { s } = fakeIo();
  assert.deepEqual((await s.save({ key: '', meta: null, source: 7 })).errors,
    [SCRIPT_ERRORS.keyRequired, SCRIPT_ERRORS.metaRequired, SCRIPT_ERRORS.sourceRequired]);
  const bad = fakeIo({ createScript: async () => { throw coded('runtime must be one of node, shell, python; displayName is required', 'BAD_REQUEST'); } });
  assert.deepEqual(await bad.s.save({ key: 'x', meta: META({ key: 'x' }), source: 'x' }),
    { ok: false, errors: ['runtime must be one of node, shell, python', 'displayName is required'] });
  const dup = fakeIo({ createScript: async () => { throw coded('"planner" is an agent key — scripts and agents share one namespace', 'DUPLICATE'); } });
  assert.deepEqual((await dup.s.save({ key: 'planner', meta: META({ key: 'planner' }), source: 'x' })).errors, ['"planner" is an agent key — scripts and agents share one namespace']);
  const broken = fakeIo({ createScript: async () => { throw new Error('EACCES: permission denied'); } });
  await assert.rejects(() => broken.s.save({ key: 'x', meta: META({ key: 'x' }), source: 'x' }), /EACCES/);
});

test('save: cases are normalized BEFORE the write and saved after it', async () => {
  const bad = fakeIo();
  assert.deepEqual(await bad.s.save({ key: 'runTests', meta: META(), source: 'npm test\n', cases: [{ id: 'c1' }] }),
    { ok: false, errors: ['case 1: name is required'] });
  assert.equal(bad.calls.some((c) => c[0] === 'createScript'), false, 'a bad case never leaves a saved script behind');
  const ok = fakeIo();
  const out = await ok.s.save({ key: 'runTests', meta: META(), source: 'npm test\n', cases: [{ id: 'c1', name: 'red' }] });
  assert.equal(out.cases, 1);
  assert.deepEqual(ok.calls.map((c) => c[0]), ['normalizeCases', 'createScript', 'writeCases']);
  assert.deepEqual(await ok.s.save({ key: 'runTests', meta: META(), source: 'x', cases: 'nope', overwrite: true }),
    { ok: false, errors: ['cases must be an array of case objects'] });
});

test('test: the bench request, the collected lines, and a refusal that names what to fix', async () => {
  const { s, calls } = fakeIo();
  const out = await s.test({ key: 'runTests', inputs: { plan: { text: '# Plan' } }, params: { command: 'npm test' }, cwd: { kind: 'project', projectKey: 'worca-cc-551183d0' }, timeoutMs: 120000 });
  assert.deepEqual(calls.find((c) => c[0] === 'runBenchOnce')[1], {
    key: 'runTests', caseId: null, params: { command: 'npm test' }, ports: null,
    inputs: { plan: { text: '# Plan' } }, cwd: { kind: 'project', projectKey: 'worca-cc-551183d0' }, timeoutMs: 120000,
  });
  assert.equal(out.ok, true);
  assert.equal(out.result.status, 'blocking');
  assert.equal(out.result.exitCode, 1);
  assert.deepEqual(out.result.fired, ['log', 'fail']);
  assert.equal(out.result.log.text, 'npm test\n3 failing');
  assert.equal(out.result.log.lines, 2);
  // P1c Task 3's own transport sentences — this bundle passes them through unchanged.
  for (const [msg, code] of [['script not found: ghost', 'NOT_FOUND'],
    ['at most 2 bench runs at once — wait for one to finish', 'BUSY']]) {
    const refused = fakeIo({ runBenchOnce: async () => { throw coded(msg, code); } });
    assert.deepEqual(await refused.s.test({ key: 'runTests', cwd: { kind: 'scratch' } }), { ok: false, errors: [msg] });
  }
  // An execution failure is a RESULT, not a refusal: the model must read it.
  const errored = fakeIo({ runBenchOnce: async () => ({ ...BENCH_RESULT, status: 'error', exitCode: null, error: { message: 'no package.json in cwd', tail: ['npm ERR!'] } }) });
  const bad = await errored.s.test({ key: 'runTests', cwd: { kind: 'scratch' } });
  assert.equal(bad.ok, true);
  assert.equal(bad.result.status, 'error');
  assert.deepEqual(bad.result.error, { message: 'no package.json in cwd', tail: ['npm ERR!'] });
  // A bare string or a number where { text } belongs is refused HERE: the bench leaves it unbound and
  // the program then throws on inputs.<port>.path, which reads as the model's bug, not the call's.
  const shape = fakeIo();
  assert.deepEqual(await shape.s.test({ key: 'runTests', inputs: { plan: '# Plan', done: { fired: true }, n: 7 }, cwd: { kind: 'scratch' } }),
    { ok: false, errors: [SCRIPT_ERRORS.inputShape('plan'), SCRIPT_ERRORS.inputShape('n')] });
  assert.equal(shape.calls.some((c) => c[0] === 'runBenchOnce'), false, 'a refused input never reaches the bench');
});

test('test: a stopped turn stops the live bench, and an already-stopped turn never starts one', async () => {
  const ac = new AbortController();
  const stopping = fakeIo({
    runBenchOnce: async (request, deps) => {
      deps.onBench({ stop: () => { stopping.calls.push(['stop']); } });
      ac.abort();
      await new Promise((r) => { setTimeout(r, 0); });
      return { ...BENCH_RESULT, status: 'stopped' };
    },
  }, { signal: ac.signal });
  const out = await stopping.s.test({ key: 'runTests', cwd: { kind: 'scratch' } });
  assert.equal(stopping.calls.some((c) => c[0] === 'stop'), true, 'the abort reached the live bench');
  assert.equal(out.result.status, 'stopped');
  const done = new AbortController();
  done.abort();
  const over = fakeIo({}, { signal: done.signal });
  assert.deepEqual(await over.s.test({ key: 'runTests', cwd: { kind: 'scratch' } }),
    { ok: false, errors: ['the chat turn ended before the script ran'] });
  assert.equal(over.calls.some((c) => c[0] === 'runBenchOnce'), false);
});

test('test: caseId runs the CASE as saved — its folder must be scratch or the pinned project, its timeout inside the ceiling', async () => {
  const cases = [
    { id: 'here', name: 'scratch', inputs: {}, cwd: { kind: 'scratch' }, timeoutMs: null, expect: null },
    { id: 'proj', name: 'in a project', inputs: {}, cwd: { kind: 'project', projectKey: 'other-00000000' }, timeoutMs: null, expect: null },
    { id: 'slow', name: 'a day', inputs: {}, cwd: { kind: 'scratch' }, timeoutMs: 86_400_000, expect: null },
  ];
  const { s, calls, rows } = fakeIo();
  await s.save({ key: 'runTests', meta: META(), source: 'npm test\n' });
  rows.get('runTests').cases = cases;
  rows.get('runTests').userCases = [{ id: 'mine', name: 'user layer', inputs: {}, cwd: { kind: 'scratch' }, timeoutMs: null, expect: null }];
  // The bench ignores the request's cwd/timeout for a case, so the tool's resolved cwd is NOT what runs:
  // a case in a project other than the pinned one is refused before the bench sees it.
  assert.deepEqual(await s.test({ key: 'runTests', caseId: 'proj', cwd: { kind: 'scratch' }, timeoutMs: 120000, pinnedProjectKey: null }),
    { ok: false, errors: ['case "proj" runs in project "other-00000000", which is not the project pinned for this chat — pin it, or run the case\'s inputs without caseId'] });
  assert.equal((await s.test({ key: 'runTests', caseId: 'proj', cwd: { kind: 'scratch' }, timeoutMs: 120000, pinnedProjectKey: 'mine-00000000' })).ok, false);
  assert.equal(calls.some((c) => c[0] === 'runBenchOnce'), false, 'a refused case never reaches the bench');
  const ok = await s.test({ key: 'runTests', caseId: 'proj', cwd: { kind: 'scratch' }, timeoutMs: 120000, pinnedProjectKey: 'other-00000000' });
  assert.equal(ok.ok, true, 'the pinned project IS the case\'s project');
  assert.equal(calls.find((c) => c[0] === 'runBenchOnce')[1].caseId, 'proj', 'the case runs through the bench, so expect is evaluated there');
  assert.equal((await s.test({ key: 'runTests', caseId: 'here', cwd: { kind: 'scratch' }, timeoutMs: 120000 })).ok, true);
  assert.equal((await s.test({ key: 'runTests', caseId: 'mine', cwd: { kind: 'scratch' }, timeoutMs: 120000 })).ok, true, 'user-layer cases count too');
  // The case's timeout (else the script's) replaces the tool's: past the ceiling it is refused, not run.
  assert.deepEqual(await s.test({ key: 'runTests', caseId: 'slow', cwd: { kind: 'scratch' }, timeoutMs: 120000 }),
    { ok: false, errors: ['case "slow" would run for up to 86400 s (its own or the script\'s timeoutMs) — test_script allows 600; lower that timeoutMs or run the case\'s inputs without caseId'] });
  rows.get('runTests').meta.timeoutMs = 601_000;
  assert.equal((await s.test({ key: 'runTests', caseId: 'here', cwd: { kind: 'scratch' }, timeoutMs: 120000 })).ok, false, 'the script\'s own timeoutMs counts when the case has none');
  rows.get('runTests').meta.timeoutMs = 600_000;
  assert.equal((await s.test({ key: 'runTests', caseId: 'here', cwd: { kind: 'scratch' }, timeoutMs: 120000 })).ok, true, 'exactly the ceiling is fine');
  assert.deepEqual(await s.test({ key: 'runTests', caseId: 'ghost', cwd: { kind: 'scratch' }, timeoutMs: 120000 }),
    { ok: false, errors: ['no case "ghost" on script "runTests" — get_script lists its saved cases'] });
  assert.deepEqual(await s.test({ key: 'nothere', caseId: 'here', cwd: { kind: 'scratch' }, timeoutMs: 120000 }),
    { ok: false, errors: [SCRIPT_ERRORS.notFound('nothere')] });
});

test('trimBenchResult: the verdict is capped (50 issues, 2 000 chars a field), and so are warnings, diffs and the error tail', () => {
  const issues = Array.from({ length: 60 }, (_, i) => ({ severity: 'major', title: `t${i}`, detail: 'D'.repeat(5000), location: '' }));
  const r = trimBenchResult({ ...BENCH_RESULT, verdict: { summary: 'S'.repeat(3000), issues }, warnings: Array.from({ length: 70 }, (_, i) => `w${i}`),
    expect: { pass: false, diffs: Array.from({ length: 70 }, () => 'x'.repeat(3000)) }, error: { message: 'm'.repeat(3000), tail: Array.from({ length: 70 }, (_, i) => `l${i}`) } }, []);
  assert.equal(r.verdict.issues.length, ASK_LIMITS.scriptVerdictMaxIssues);
  assert.equal(r.verdict.issueCount, 60, 'the real count is still reported');
  assert.equal(r.verdict.truncated, true);
  assert.equal(r.verdict.issues[0].detail.length, ASK_LIMITS.scriptResultFieldMaxChars + 1, 'clipped, with a mark');
  assert.ok(r.verdict.issues[0].detail.endsWith('…'));
  assert.equal(r.verdict.summary.length, ASK_LIMITS.scriptResultFieldMaxChars + 1);
  assert.equal(r.warnings.length, ASK_LIMITS.scriptVerdictMaxIssues);
  assert.equal(r.expect.diffs.length, ASK_LIMITS.scriptVerdictMaxIssues);
  assert.equal(r.expect.diffs[0].length, ASK_LIMITS.scriptResultFieldMaxChars + 1);
  assert.equal(r.error.message.length, ASK_LIMITS.scriptResultFieldMaxChars + 1);
  assert.equal(r.error.tail.length, ASK_LIMITS.scriptVerdictMaxIssues);
  assert.equal(r.error.tail.at(-1), 'l69', 'the error tail keeps its LAST lines');
  assert.ok(Buffer.byteLength(JSON.stringify(r), 'utf8') < 600_000, `bounded: ${Buffer.byteLength(JSON.stringify(r), 'utf8')} bytes`);
  const small = trimBenchResult(BENCH_RESULT, []);
  assert.deepEqual(small.verdict, { summary: 'suite red', issues: [{ severity: 'major', title: '3 tests failed', detail: '', location: '' }], issueCount: 1 }, 'a small verdict is whole, no truncated flag');
});

test('trimBenchResult: 200 lines / 16 KiB of log tail, 16 KiB of output head, no host paths', () => {
  const lines = Array.from({ length: 260 }, (_, i) => `line ${i}`);
  const big = { ...BENCH_RESULT, outputs: { log: { type: 'md', path: '/tmp/x.md', bytes: 40000, text: 'A'.repeat(40000), truncated: false } } };
  const r = trimBenchResult(big, lines);
  assert.equal(r.log.lines, ASK_LIMITS.scriptLogMaxLines);
  assert.equal(r.log.truncated, true);
  assert.ok(r.log.text.startsWith('line 60'), 'the TAIL is kept — a failure ends the log');
  assert.ok(r.log.text.endsWith('line 259'));
  assert.equal(r.outputs.log.text.length, ASK_LIMITS.scriptOutputMaxBytes);
  assert.equal(r.outputs.log.truncated, true);
  assert.equal(r.outputs.log.bytes, 40000, 'the real size is still reported');
  assert.equal('path' in r.outputs.log, false);
  for (const k of ['envelopePath', 'benchDir']) assert.equal(k in r, false, `${k} is this machine's business`);
  // The byte cap on a multi-byte log never cuts inside a character.
  const wide = trimBenchResult(BENCH_RESULT, ['é'.repeat(9000)]);
  assert.ok(Buffer.byteLength(wide.log.text, 'utf8') <= ASK_LIMITS.scriptLogMaxBytes);
  assert.equal(wide.log.text.includes('�'), false);
  const clean = trimBenchResult(BENCH_RESULT, ['one']);
  assert.deepEqual(clean.outputs.pass, { type: 'void' });
  assert.deepEqual(clean.log, { text: 'one', lines: 1, truncated: false });
  assert.deepEqual(trimBenchResult(null, []).outputs, {});
  // A case passes only when its run FINISHES: the engine's evaluateExpect is satisfied by { fired: [] }
  // on a timeout, a stop or an execution error (probed: status 'timeout' beside expect.pass true).
  for (const status of ['timeout', 'stopped', 'error']) {
    const cut = trimBenchResult({ ...BENCH_RESULT, status, expect: { pass: true, diffs: [] } }, []);
    assert.equal(cut.expect.pass, false, `${status} cannot pass`);
    assert.deepEqual(cut.expect.diffs, [`the run ended ${status} — a case passes only when its run finishes`]);
  }
  assert.deepEqual(trimBenchResult({ ...BENCH_RESULT, status: 'clean', expect: { pass: true, diffs: [] } }, []).expect, { pass: true, diffs: [] });
  assert.deepEqual(trimBenchResult({ ...BENCH_RESULT, expect: { pass: false, diffs: ['verdict: expected blocking, got clean'] } }, []).expect,
    { pass: false, diffs: ['verdict: expected blocking, got clean'] }, 'a finished run keeps the engine\'s judgement');
});

test('list / read: the model-facing shape, no host paths; W20 off ⇒ enabled is false', async () => {
  const { s, io } = fakeIo();
  await s.save({ key: 'runTests', meta: META(), source: 'npm test\n' });
  assert.deepEqual(await s.list(), [{
    key: 'runTests', displayName: 'Run tests', description: 'Runs the suite.', origin: 'user',
    runtime: 'shell', portLine: '', caseCount: 0, writable: true,
  }]);
  const read = await s.read('runTests');
  assert.equal(read.writable, true);
  assert.equal(read.source, 'npm test\n');
  assert.equal(read.sourceWin32, null, "the store's '' (no Windows variant) reads as null");
  for (const k of ['scriptPath', 'portSummary']) assert.equal(k in read.meta, false, `${k} is computed, not sidecar`);
  assert.equal(read.meta.origin, 'user', 'origin stays: the model must see which layer it is on');
  assert.equal(await s.read('ghost'), null);
  const configPorts = fakeIo({ listScripts: async () => [{ key: 'js', displayName: 'JS', origin: 'builtin', runtime: 'node', ports: 'config', caseCount: 2 }] });
  assert.equal((await configPorts.s.list())[0].portLine, 'ports per card');
  assert.equal((await configPorts.s.list())[0].writable, false);
  assert.equal(defaultScriptDeps({ threadId: 't', io: { ...io, enabled: () => false } }).scripts.enabled, false);
});

test('runtimes: python joins the list only when the probe succeeds, and the probe is called bare (cached)', async () => {
  const seen = [];
  const probe = (answer) => async (...args) => { seen.push(args.length); if (answer instanceof Error) throw answer; return answer; };
  assert.deepEqual(await scriptHostRuntimes({ probe: probe({ ok: true, command: ['python3'], version: [3, 12, 1] }) }), ['node', 'shell', 'python']);
  assert.deepEqual(await scriptHostRuntimes({ probe: probe({ ok: false, reason: 'not found' }) }), ['node', 'shell']);
  assert.deepEqual(await scriptHostRuntimes({ probe: probe(new Error('boom')) }), ['node', 'shell']);
  assert.deepEqual(seen, [0, 0, 0], 'probePython() with any option bypasses its 60 s cache — it must be called with none');
  assert.equal(await askScriptPromptInput({ enabled: false }), null, 'W20 off ⇒ no prompt section');
  assert.deepEqual(await askScriptPromptInput({ enabled: true, runtimes: ['node', 'shell'] }), { runtimes: ['node', 'shell'] });
});
