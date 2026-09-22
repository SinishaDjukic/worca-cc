// test/script-bench.test.mjs
// The bench (workbench spec §4): it builds a SYNTHETIC execution context and
// calls the very runner a pipeline run uses, so "passes in the bench" and
// "works in a run" cannot drift. What is pinned here: the ctx shape (bench:true,
// cycle 1, the bench's own dirs), bound/unbound/void inputs, the param check
// failing with the RUN's sentence, clean/blocking/error/timeout/stop results,
// unsaved drafts (file written beside the real one, removed on success AND on a
// throw, a built-in draft refused), `mock` ignored, expectation diffs, Run all
// with stop, the 2-global/1-per-key caps and the 24 h sweep.
// Child fixtures are `process.execPath` only — never sleep/true/false (Windows).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  createBench, runBenchOnce, buildBenchCtx, writeBenchInputs, sweepBenchDirs, benchRoot,
  BENCH_MAX_PARALLEL, BENCH_INLINE_BYTES, BENCH_SWEEP_MS,
} from '../src/core/script-bench.mjs';
import { loadScriptRegistry } from '../src/core/script-registry.mjs';
import { resetPythonProbe } from '../src/core/graph/python-probe.mjs';
import { createScript, writeCases, deleteScript, userScriptsDir } from '../src/core/script-store.mjs';

useTempHome(after);
const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

const NODE = JSON.stringify(process.execPath);            // quoted for sh and cmd alike
const PORTS = {
  inputs: [{ id: 'done', type: 'void', required: false }, { id: 'plan', type: 'md', required: false },
    { id: 'facts', type: 'json', required: false }],
  outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'bench-{cycle}.md' },
    { id: 'fail', type: 'md', when: 'blocking', filename: 'bench-{cycle}.md' },
    { id: 'pass', type: 'void', when: 'clean' }],
  verdict: { filename: 'bench-{cycle}.json' },
};

/** A real one-script registry over a temp layer dir (the loader stamps the paths). */
function layer(key, meta, source) {
  const dir = tmp('worca-bench-layer-');
  if (source !== undefined) writeFileSync(join(dir, meta.file), source);
  writeFileSync(join(dir, `${key}.meta.json`), JSON.stringify({ key, metaVersion: 2, ...meta }));
  return loadScriptRegistry({ scriptsDir: dir, userScriptsDir: null, includePlugins: false, agentKeys: null });
}
const nodeScript = (body, over = {}) => layer('bench1', {
  displayName: 'Bench 1', runtime: 'node', file: 'bench1.mjs', timeoutMs: 20000,
  params: [{ id: 'mode', type: 'enum', options: ['a', 'b'], default: 'a' }],
  inputs: PORTS.inputs, outputs: PORTS.outputs, verdict: PORTS.verdict, ...over,
}, body);
const collect = (bench) => { const lines = []; bench.on('scriptbench-line', (e) => lines.push(e)); return lines; };

test('constants and the bench root', () => {
  assert.equal(BENCH_MAX_PARALLEL, 2);
  assert.equal(BENCH_INLINE_BYTES, 262144);
  assert.equal(BENCH_SWEEP_MS, 86400000);
  assert.equal(benchRoot('/home/x'), join('/home/x', 'bench'));
});

test('buildBenchCtx: the synthetic run — bench:true, cycle 1, the bench`s own dirs, no project store', () => {
  const meta = { key: 'k', displayName: 'K', runtime: 'node' };
  const dirs = { base: '/b', pipeline: join('/b', 'pipeline'), in: join('/b', 'in'), cwd: join('/b', 'cwd') };
  const ports = {
    inputs: PORTS.inputs,
    // A `store:'project'` port must NOT reach a project's plans dir from a bench.
    outputs: [...PORTS.outputs, { id: 'plan', type: 'md', when: 'always', filename: '{base}-plan.md', store: 'project' }],
    verdict: PORTS.verdict,
  };
  const ctx = buildBenchCtx({
    id: 'bench_abcdefgh', meta, resolved: { file: '/p/k.mjs', command: null, params: { mode: 'a' }, timeoutMs: 5000 },
    ports, bindings: { done: { seq: 1, type: 'void' } }, dirs, cwd: dirs.cwd, checkpointRef: '3f2a', signal: null, onEvent: () => {},
  });
  assert.deepEqual(ctx.node, { id: 'bench', kind: 'script', key: 'k' });
  assert.equal(ctx.executionId, 'x:bench:1');
  assert.equal(ctx.ordinal, 1);
  assert.equal(ctx.cycle, 1);
  assert.equal(ctx.bench, true);
  assert.equal(ctx.claudeOpts.mock, false, 'W13: the bench always runs the program');
  assert.equal(ctx.script.mock, null);
  assert.equal(ctx.pipelineDir, dirs.pipeline);
  assert.equal(ctx.projectDir, dirs.cwd);
  assert.equal(ctx.runCtx.projectDir, dirs.cwd);
  assert.equal(ctx.runCtx.baseName, 'bench');
  assert.equal(ctx.pipelineId, 'bench-abcdefgh');
  assert.equal(ctx.runRoot, null);
  assert.equal(ctx.repos, null);
  assert.equal(ctx.checkpointRef, '3f2a');
  assert.deepEqual(ctx.trigger.freshPorts, ['done'], 'every bound input is fresh');
  assert.equal(ctx.outputs.log.path, join(dirs.pipeline, 'bench-1.md'));
  assert.equal(ctx.outputs.fail.path, ctx.outputs.log.path, 'one template, one path');
  assert.equal(ctx.outputs.plan.path, join(dirs.pipeline, 'bench-plan.md'), 'a project-store port is forced into the bench dir');
  assert.equal(ctx.verdict.path, join(dirs.pipeline, 'bench-1.json'));
  assert.equal(ctx.script.timeoutMs, 5000);
});

test('writeBenchInputs: bound / unbound / void, json must parse, unknown ports and the byte cap', async () => {
  const dir = tmp('worca-bench-in-');
  const b = await writeBenchInputs(join(dir, 'in'), PORTS, {
    plan: { text: '# Plan\n' }, done: { fired: true }, facts: { text: '{"a":1}' },
  });
  assert.deepEqual(b.done, { seq: 1, type: 'void' });
  assert.equal(b.plan.type, 'md');
  assert.equal(b.plan.path, join(dir, 'in', 'plan.md'));
  assert.equal(b.facts.path, join(dir, 'in', 'facts.json'));
  assert.deepEqual([b.done.seq, b.plan.seq, b.facts.seq], [1, 2, 3], 'declared port order');
  const none = await writeBenchInputs(join(dir, 'in2'), PORTS, { done: { fired: false } });
  assert.deepEqual(none, {}, 'an unchecked void port is unbound, exactly as in a run');
  await assert.rejects(writeBenchInputs(join(dir, 'in3'), PORTS, { nope: { text: 'x' } }),
    (e) => e.code === 'BAD_REQUEST' && e.message === 'bench input "nope" is not a declared input port');
  await assert.rejects(writeBenchInputs(join(dir, 'in4'), PORTS, { facts: { text: '{oops' } }),
    (e) => e.code === 'BAD_REQUEST' && e.message === 'bench input "facts" is not valid JSON');
  await assert.rejects(writeBenchInputs(join(dir, 'in5'), PORTS, { plan: { fired: true } }),
    (e) => e.code === 'BAD_REQUEST' && e.message === 'bench input "plan" must be { text }');
  await assert.rejects(writeBenchInputs(join(dir, 'in6'), PORTS, { plan: { text: 'x'.repeat(262145) } }),
    (e) => e.code === 'BAD_REQUEST' && e.message === 'bench input "plan" is over 262144 bytes');
});

test('a clean node script: streamed lines, the outputs read back inline, expectation green', async () => {
  const registry = nodeScript(`
import { readFileSync } from 'node:fs';
export default async function ({ inputs, outputs, params, ctx, log }) {
  console.log('hello from the script');
  log('info', 'plan is ' + readFileSync(inputs.plan.path, 'utf8').trim());
  return { summary: 'ok in ' + params.mode, outputs: { log: { value: '# bench log\\n' } } };
}
`);
  const bench = createBench({ key: 'bench1', inputs: { plan: { text: '# Plan' } },
    params: { mode: 'b' } }, { registry, agentKeys: [] });
  const lines = collect(bench);
  const result = await new Promise((r) => { bench.on('scriptbench-done', (e) => r(e.result)); bench.run(); });
  assert.equal(result.status, 'clean');
  assert.equal(result.summary, 'ok in b');
  assert.equal(result.exitCode, 0);
  assert.equal(result.runtime, 'node');
  assert.equal(result.draft, false);
  assert.equal(result.error, null);
  assert.equal(result.expect, null, 'no expectation was given');
  assert.deepEqual(result.fired, ['log', 'pass'], 'firedOutputs: always + the clean side');
  assert.equal(result.outputs.log.text, '# bench log\n');
  assert.equal(result.outputs.log.truncated, false);
  assert.equal(result.outputs.log.bytes, 12);
  assert.deepEqual(result.outputs.pass, { type: 'void' });
  assert.match(result.envelopePath, /envelope\.json$/);
  assert.ok(result.benchDir.startsWith(benchRoot()));
  assert.ok(existsSync(join(result.benchDir, 'in', 'plan.md')));
  assert.ok(lines.some((l) => l.text === 'hello from the script' && l.stream === 'out' && l.caseId === null));
  assert.ok(lines.some((l) => /plan is # Plan/.test(l.text)));
  assert.equal(bench.getState().status, 'done');
});

test('a blocking verdict, an execution error and a timeout are RESULTS, never transport failures', async () => {
  const blocking = nodeScript(`
export default async function () {
  return { summary: 'two failures', outputs: { log: { value: 'out\\n' } },
    verdict: { issues: [{ severity: 'major', title: 'tests failed', detail: 'x', location: '' }], summary: 'nope' } };
}
`);
  const b1 = await runBenchOnce({ key: 'bench1' }, { registry: blocking, agentKeys: [] });
  assert.equal(b1.status, 'blocking');
  assert.deepEqual(b1.fired, ['log', 'fail']);
  assert.equal(b1.verdict.issues.length, 1);

  const boom = nodeScript('export default async function () { throw new Error("boom"); }\n');
  const b2 = await runBenchOnce({ key: 'bench1' }, { registry: boom, agentKeys: [] });
  assert.equal(b2.status, 'error');
  assert.equal(b2.exitCode, null);
  assert.match(b2.error.message, /script "bench1": boom/);
  assert.ok(Array.isArray(b2.error.tail));

  const hang = nodeScript('export default async function () { console.log("started"); await new Promise(() => {}); }\n');
  const b3 = await runBenchOnce({ key: 'bench1', timeoutMs: 1000 }, { registry: hang, agentKeys: [] });
  assert.equal(b3.status, 'timeout');
  assert.match(b3.error.message, /timed out after 1 s/);
  assert.deepEqual(b3.error.tail, ['started'], 'the last 20 captured lines ride the error');
});

test('stop() aborts the child and the result is `stopped`', async () => {
  const registry = nodeScript('export default async function () { console.log("up"); await new Promise(() => {}); }\n');
  const bench = createBench({ key: 'bench1' }, { registry, agentKeys: [] });
  bench.on('scriptbench-line', (e) => { if (e.text === 'up') bench.stop(); });
  const result = await new Promise((r) => { bench.on('scriptbench-done', (e) => r(e.result)); bench.run(); });
  assert.equal(result.status, 'stopped');
  assert.equal(bench.getState().status, 'stopped');
});

test('a shell script runs the command with WORCA_BENCH=1 and the bench env', async () => {
  const registry = layer('sh1', { displayName: 'Sh', runtime: 'shell', timeoutMs: 20000,
    params: [{ id: 'command', type: 'command', required: true }],
    inputs: [], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'sh-{cycle}.md' }],
    verdict: { filename: 'sh-{cycle}.json' } });
  const result = await runBenchOnce({ key: 'sh1', params: { command: `${NODE} -e "console.log('BENCH=' + process.env.WORCA_BENCH)"` } },
    { registry, agentKeys: [] });
  assert.equal(result.status, 'clean');
  assert.equal(result.exitCode, 0);
  assert.match(result.outputs.log.text, /BENCH=1/, 'the shell capture became the md report');
  await assert.rejects(runBenchOnce({ key: 'sh1' }, { registry, agentKeys: [] }),
    (e) => e.code === 'BAD_REQUEST' && e.message === "script node 'bench' is missing required param 'command'");
});

test('params are the run`s: defaults merged, unknown and mistyped values fail with V22`s sentence', async () => {
  const registry = nodeScript('export default async function ({ params }) { return { summary: JSON.stringify(params), outputs: { log: { value: "x" } } }; }\n');
  const ok = await runBenchOnce({ key: 'bench1' }, { registry, agentKeys: [] });
  assert.equal(ok.summary, '{"mode":"a"}', 'effectiveScriptParams merged the sidecar default');
  await assert.rejects(runBenchOnce({ key: 'bench1', params: { nope: 1 } }, { registry, agentKeys: [] }),
    (e) => e.code === 'BAD_REQUEST' && e.message === `script node 'bench' sets unknown param 'nope' — script "bench1" declares mode`);
  await assert.rejects(runBenchOnce({ key: 'bench1', params: { mode: 'z' } }, { registry, agentKeys: [] }),
    (e) => e.code === 'BAD_REQUEST' && e.message === `script node 'bench' param 'mode': must be one of a, b (got "z")`);
});

test('`mock` is ignored: a sidecar mock does not stop the program from running (W13)', async () => {
  const registry = nodeScript('export default async function () { return { summary: "real", outputs: { log: { value: "r" } } }; }\n',
    { mock: { summary: 'mocked', outputs: { log: { text: 'm' } } } });
  const result = await runBenchOnce({ key: 'bench1' }, { registry, agentKeys: [] });
  assert.equal(result.summary, 'real');
  assert.equal(result.outputs.log.text, 'r');
});

test('an unsaved draft runs beside the real file and the draft file is removed — on success AND on a throw', async () => {
  // `layer()` scans its temp dir as the BUILT-IN layer, so stamp the origin a real
  // user script carries: only the user layer is writable, and a draft of a built-in
  // is refused three assertions below.
  const registry = nodeScript('export default async function () { return { summary: "saved", outputs: { log: { value: "s" } } }; }\n');
  registry.bench1.origin = 'user';
  const dir = userScriptsDir();
  mkdirSync(dir, { recursive: true });
  const draftsLeft = () => readdirSync(dir).filter((f) => f.startsWith('.bench-'));
  const draft = { meta: { ...registry.bench1, key: 'bench1', file: undefined, origin: undefined, scriptPath: undefined, scriptsDir: undefined, commandResolved: undefined },
    source: 'export default async function () { return { summary: "draft", outputs: { log: { value: "d" } } }; }\n' };
  const ok = await runBenchOnce({ key: 'bench1', draft }, { registry, agentKeys: [] });
  assert.equal(ok.draft, true);
  assert.equal(ok.summary, 'draft', 'the DRAFT source ran, not the saved file');
  assert.deepEqual(draftsLeft(), [], 'removed in finally');

  const thrower = { ...draft, source: 'export default async function () { throw new Error("draft boom"); }\n' };
  const bad = await runBenchOnce({ key: 'bench1', draft: thrower }, { registry, agentKeys: [] });
  assert.equal(bad.status, 'error');
  assert.equal(bad.draft, true);
  assert.deepEqual(draftsLeft(), [], 'removed on the throw path too');

  // A draft of a built-in or a plugin script is refused: duplicate it first.
  const builtin = { bench1: { ...registry.bench1, origin: 'builtin' } };
  await assert.rejects(runBenchOnce({ key: 'bench1', draft }, { registry: builtin, agentKeys: [] }),
    (e) => e.code === 'BAD_REQUEST' && e.message === 'cannot bench a draft of "bench1" — it is a built-in script; duplicate it first');
  const plugin = { bench1: { ...registry.bench1, origin: 'plugin:acme' } };
  await assert.rejects(runBenchOnce({ key: 'bench1', draft }, { registry: plugin, agentKeys: [] }),
    (e) => e.code === 'BAD_REQUEST' && e.message === 'cannot bench a draft of "bench1" — it belongs to plugin "acme"; duplicate it first');
  // A draft whose meta does not validate fails with the sidecar validator's own sentences.
  await assert.rejects(runBenchOnce({ key: 'bench1', draft: { meta: { metaVersion: 2, runtime: 'perl' }, source: 'x' } }, { registry, agentKeys: [] }),
    (e) => e.code === 'BAD_REQUEST' && /runtime must be one of node, shell/.test(e.message));
  // The store refuses a win32 program with no POSIX twin (applyFileRules). Without
  // the same refusal here the draft wrote an EMPTY `.sh` on POSIX, ran it, ignored
  // the sidecar's `command` and reported the whole thing `clean`.
  const winOnly = { meta: { metaVersion: 2, displayName: 'S', runtime: 'shell', command: `${NODE} -e "console.log(1)"`,
    inputs: [], outputs: PORTS.outputs, verdict: PORTS.verdict }, source: '', sourceWin32: 'echo win' };
  await assert.rejects(runBenchOnce({ key: 'winOnly', draft: winOnly }, { registry, agentKeys: [] }),
    (e) => e.code === 'BAD_REQUEST' && e.message === 'sourceWin32 needs a shell file — add the default source too');
  assert.deepEqual(draftsLeft(), [], 'the refused draft wrote no file');
});

test('caps: 2 across the server, 1 per key', async () => {
  const registry = nodeScript('export default async function () { await new Promise((r) => setTimeout(r, 400)); return { summary: "slow", outputs: { log: { value: "s" } } }; }\n');
  const other = layer('bench2', { displayName: 'Bench 2', runtime: 'node', file: 'bench2.mjs', timeoutMs: 20000,
    inputs: [], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'b2-{cycle}.md' }] },
  'export default async function () { await new Promise((r) => setTimeout(r, 400)); return { summary: "b2", outputs: { log: { value: "s" } } }; }\n');
  const deps = { registry: { ...registry, ...other }, agentKeys: [] };
  const a = createBench({ key: 'bench1' }, deps);
  const b = createBench({ key: 'bench2' }, deps);
  const done = (x) => new Promise((r) => { x.on('scriptbench-done', () => r('done')); x.on('scriptbench-error', (e) => r(e.message)); x.run(); });
  const pa = done(a);
  const pb = done(b);
  await assert.rejects(runBenchOnce({ key: 'bench1' }, deps),
    (e) => e.code === 'BUSY' && e.message === 'script "bench1" is already running in the bench');
  const third = layer('bench3', { displayName: 'Bench 3', runtime: 'node', file: 'bench3.mjs',
    inputs: [], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'b3-{cycle}.md' }] }, 'export default async () => ({ summary: "x", outputs: { log: { value: "x" } } });\n');
  await assert.rejects(runBenchOnce({ key: 'bench3' }, { registry: { ...third }, agentKeys: [] }),
    (e) => e.code === 'BUSY' && e.message === 'at most 2 bench runs at once — wait for one to finish');
  assert.deepEqual(await Promise.all([pa, pb]), ['done', 'done']);
  // The slots are released: the same key runs again immediately.
  assert.equal((await runBenchOnce({ key: 'bench1' }, deps)).status, 'clean');
});

test('cases, Run all (sequential, tagged lines, stop skips the rest) and the expectation counters', async () => {
  await createScript({
    meta: { metaVersion: 2, key: 'cased', displayName: 'Cased', runtime: 'node',
      params: [{ id: 'fail', type: 'boolean', default: false }],
      inputs: [{ id: 'plan', type: 'md', required: false }],
      outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'c-{cycle}.md' },
        { id: 'fail', type: 'md', when: 'blocking', filename: 'c-{cycle}.md' },
        { id: 'pass', type: 'void', when: 'clean' }],
      verdict: { filename: 'c-{cycle}.json' } },
    source: `
export default async function ({ params, inputs }) {
  console.log('case ran ' + (inputs.plan ? 'with a plan' : 'bare'));
  const verdict = params.fail ? { issues: [{ severity: 'major', title: 'told to fail', detail: '', location: '' }] } : { issues: [] };
  return { summary: 'ran', outputs: { log: { value: 'log\\n' } }, verdict };
}
`,
    by: 'ui',
  });
  await writeCases('cased', [
    { id: 'green', name: 'green', inputs: { plan: { text: '# p' } }, expect: { verdict: 'clean', fired: ['log', 'pass'] } },
    { id: 'red', name: 'red', params: { fail: true }, expect: { verdict: 'clean' } },
    { id: 'loose', name: 'no expectation' },
  ]);
  const one = await runBenchOnce({ key: 'cased', caseId: 'green' }, {});
  assert.equal(one.status, 'clean');
  assert.deepEqual(one.expect, { pass: true, diffs: [] });
  await assert.rejects(runBenchOnce({ key: 'cased', caseId: 'nope' }, {}),
    (e) => e.code === 'NOT_FOUND' && e.message === 'case "nope" not found for script "cased"');

  const all = createBench({ key: 'cased', all: true }, {});
  const lines = collect(all);
  const summary = await new Promise((r) => { all.on('scriptbench-done', (e) => r(e.result)); all.run(); });
  assert.deepEqual(summary.cases.map((c) => c.caseId), ['green', 'red', 'loose'], 'sequential, in file order');
  assert.deepEqual([summary.passed, summary.failed, summary.unchecked], [1, 1, 1]);
  assert.deepEqual(summary.cases[1].result.expect.diffs, ['expected clean, got blocking']);
  assert.ok(lines.every((l) => ['green', 'red', 'loose'].includes(l.caseId)), 'every line is tagged with its case');
  assert.ok(summary.cases[0].result.benchDir.endsWith('case-green'), 'each case keeps its own folder');

  const stopped = createBench({ key: 'cased', all: true }, {});
  stopped.on('scriptbench-line', () => stopped.stop());
  const partial = await new Promise((r) => { stopped.on('scriptbench-done', (e) => r(e.result)); stopped.run(); });
  assert.ok(partial.cases.length < 3, 'stop skips the remaining cases');
  await deleteScript('cased');
});

test('one live folder per key (W11) and the 24 h sweep', async () => {
  const registry = nodeScript('export default async () => ({ summary: "x", outputs: { log: { value: "x" } } });\n');
  const first = await runBenchOnce({ key: 'bench1' }, { registry, agentKeys: [] });
  const second = await runBenchOnce({ key: 'bench1' }, { registry, agentKeys: [] });
  assert.notEqual(first.benchDir, second.benchDir);
  assert.equal(existsSync(first.benchDir), false, 'the previous folder for this key is reclaimed');
  assert.ok(existsSync(second.benchDir), 'the newest one stays so the output tabs can read it');

  const root = tmp('worca-bench-root-');
  mkdirSync(join(root, 'old'), { recursive: true });
  mkdirSync(join(root, 'fresh'), { recursive: true });
  const long = Date.now() / 1000 - 3 * 24 * 3600;
  utimesSync(join(root, 'old'), long, long);
  assert.deepEqual(await sweepBenchDirs(root), ['old']);
  assert.deepEqual(readdirSync(root), ['fresh']);
  assert.deepEqual(await sweepBenchDirs(join(root, 'does-not-exist')), [], 'a missing root is not an error');
});

test('a project cwd resolves through the projects registry; unknown and missing are 400', async () => {
  const registry = nodeScript('export default async ({ ctx }) => ({ summary: ctx.cwd, outputs: { log: { value: "x" } } });\n');
  const repo = tmp('worca-bench-proj-');
  const projects = async () => [{ key: 'proj1', name: 'Proj', path: repo, exists: true },
    { key: 'gone', name: 'Gone', path: join(repo, 'nope'), exists: false }];
  const r = await runBenchOnce({ key: 'bench1', cwd: { kind: 'project', projectKey: 'proj1' } }, { registry, agentKeys: [], projects });
  assert.equal(r.summary, repo, 'the script ran in the project checkout');
  await assert.rejects(runBenchOnce({ key: 'bench1', cwd: { kind: 'project', projectKey: 'nope' } }, { registry, agentKeys: [], projects }),
    (e) => e.code === 'BAD_REQUEST' && e.message === 'project "nope" is not registered');
  await assert.rejects(runBenchOnce({ key: 'bench1', cwd: { kind: 'project', projectKey: 'gone' } }, { registry, agentKeys: [], projects }),
    (e) => e.code === 'BAD_REQUEST' && /project path does not exist or is not a directory/.test(e.message));
});

test('an unknown key is a transport error, and run() never throws', async () => {
  const bench = createBench({ key: 'nope' }, { registry: {}, agentKeys: [] });
  const evs = [];
  bench.on('scriptbench-done', (e) => evs.push(e));
  bench.on('scriptbench-error', (e) => evs.push(e));
  await bench.run();
  assert.equal(evs.length, 1, 'exactly one terminal event');
  assert.equal(evs[0].message, 'script not found: nope');
  assert.equal(evs[0].code, 'NOT_FOUND');
  assert.equal(evs[0].benchId, bench.id);
  assert.equal(bench.getState().status, 'error');
});

test('runBenchOnce hands out every streamed line (onLine) and the live bench (onBench)', async () => {
  const registry = nodeScript('export default async function () { console.log("line one"); console.log("line two"); return { summary: "ok", outputs: { log: { value: "x" } } }; }\n');
  const lines = [];
  let live = null;
  const result = await runBenchOnce({ key: 'bench1' }, {
    registry, agentKeys: [],
    onLine: (e) => lines.push(e),
    onBench: (bench) => { live = bench; },
  });
  assert.equal(result.status, 'clean');
  assert.ok(live && typeof live.stop === 'function' && live.id.startsWith('bench_'), 'the caller can stop() it');
  assert.deepEqual(lines.map((l) => l.text).filter((t) => t.startsWith('line ')), ['line one', 'line two']);
  assert.ok(lines.every((l) => l.benchId === live.id && l.stream === 'out' && l.caseId === null));
});

test('onBench + stop(): a hung script ends as a stopped RESULT, not a rejection', async () => {
  const registry = nodeScript('export default async function () { console.log("up"); await new Promise(() => {}); }\n');
  let live = null;
  const result = await runBenchOnce({ key: 'bench1' }, {
    registry, agentKeys: [],
    onBench: (bench) => { live = bench; },
    onLine: (e) => { if (e.text === 'up') live.stop(); },
  });
  assert.equal(result.status, 'stopped');
});

test('stop() before run() still ends in ONE terminal event, so runBenchOnce settles', async () => {
  const registry = nodeScript('export default async () => ({ summary: "x", outputs: { log: { value: "x" } } });\n');
  const bench = createBench({ key: 'bench1' }, { registry, agentKeys: [] });
  const evs = [];
  bench.on('scriptbench-done', (e) => evs.push(e));
  bench.on('scriptbench-error', (e) => evs.push(e));
  bench.stop();
  await bench.run();
  assert.deepEqual(evs.map((e) => [e.code, e.message]), [['STOPPED', 'bench stopped before it started']]);
  await assert.rejects(runBenchOnce({ key: 'bench1' }, { registry, agentKeys: [], onBench: (b) => b.stop() }),
    (e) => e.code === 'STOPPED');
});

test('a prototype key is NOT a script, and a draft cannot take a key the store would refuse', async () => {
  const registry = nodeScript('export default async () => ({ summary: "x", outputs: { log: { value: "x" } } });\n');
  for (const key of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    await assert.rejects(runBenchOnce({ key }, { registry, agentKeys: [] }),
      (e) => e.code === 'NOT_FOUND' && e.message === `script not found: ${key}`);
  }
  const draft = { meta: { metaVersion: 2, displayName: 'D', runtime: 'node', inputs: [], outputs: [], verdict: null, exitCodes: null, command: null },
    source: 'export default async () => ({ summary: "draft" });\n' };
  assert.equal((await runBenchOnce({ key: 'brandNew', draft }, { registry, agentKeys: [] })).summary, 'draft',
    'a brand-new key benches, and the form`s null keys are stripped before the validator sees them');
  await assert.rejects(runBenchOnce({ key: 'new', draft }, { registry, agentKeys: [] }),
    (e) => e.code === 'BAD_REQUEST' && /reserved script key/.test(e.message));
  // The store matches the reserved list in ANY case (express routes literal segments
  // case-blind, so `Runtimes` would answer with the runtime probe) — so must a draft.
  await assert.rejects(runBenchOnce({ key: 'Runtimes', draft }, { registry, agentKeys: [] }),
    (e) => e.code === 'BAD_REQUEST' && e.message === '"Runtimes" is a reserved script key — pick another name');
  await assert.rejects(runBenchOnce({ key: 'reviewer', draft }, { registry, agentKeys: ['reviewer'] }),
    (e) => e.code === 'BAD_REQUEST' && /is an agent key/.test(e.message));
  // C29's second half: a Windows device stem is refused on Save in ANY case, so a
  // draft under one must not bench green either (`con.mjs` IS the console there).
  for (const key of ['con', 'NUL', 'com1', 'LPT9', 'aux']) {
    await assert.rejects(runBenchOnce({ key, draft }, { registry, agentKeys: [] }),
      (e) => e.code === 'BAD_REQUEST' && e.message === `"${key}" is a reserved device name on Windows — pick another key`);
  }
  // C23: keys are unique case-INSENSITIVELY, so `Bench1` beside `bench1` is a
  // DUPLICATE on Save — it must not bench green either.
  await assert.rejects(runBenchOnce({ key: 'Bench1', draft }, { registry, agentKeys: [] }),
    (e) => e.code === 'BAD_REQUEST' && e.message === 'a script "bench1" already exists — script keys differ only in case, '
      + 'and one file holds both on macOS and Windows');
  await assert.rejects(runBenchOnce({ key: 'bench1', cwd: { kind: 'project' } }, { registry, agentKeys: [] }),
    (e) => e.code === 'BAD_REQUEST' && e.message === 'cwd: a project folder needs a projectKey');
});

test('a huge output is read back BOUNDED: the real byte count and 256 KiB of head, never the whole file', async () => {
  // 2 GiB, sparse (no disk): readFile() — what readOutputs used — throws
  // ERR_FS_FILE_TOO_LARGE past 2 GiB and reported the output as empty, and below
  // that it buffered the entire file to keep 256 KiB of it (600 MB of output
  // spiked the host by half a gigabyte).
  const registry = nodeScript(`
import { openSync, ftruncateSync, closeSync } from 'node:fs';
export default async function ({ outputs }) {
  const fd = openSync(outputs.log.path, 'w');
  ftruncateSync(fd, 2147483648);
  closeSync(fd);
  return { summary: 'big' };
}
`);
  const r = await runBenchOnce({ key: 'bench1' }, { registry, agentKeys: [] });
  assert.equal(r.status, 'clean');
  assert.equal(r.outputs.log.bytes, 2147483648);
  assert.equal(r.outputs.log.truncated, true);
  assert.equal(r.outputs.log.text.length, BENCH_INLINE_BYTES);

  // The cap is a BYTE cap, so it can fall inside a character: the head must end at
  // the last COMPLETE code point, never on a U+FFFD the file does not contain.
  const split = nodeScript(`
import { writeFileSync } from 'node:fs';
export default async function ({ outputs }) {
  writeFileSync(outputs.log.path, Buffer.concat([
    Buffer.alloc(${BENCH_INLINE_BYTES} - 1, 0x61), Buffer.from('\\u20ac', 'utf8'), Buffer.alloc(8, 0x62)]));
  return { summary: 'split' };
}
`);
  const s = await runBenchOnce({ key: 'bench1' }, { registry: split, agentKeys: [] });
  assert.equal(s.outputs.log.bytes, BENCH_INLINE_BYTES + 10);
  assert.equal(s.outputs.log.truncated, true);
  assert.equal(s.outputs.log.text.length, BENCH_INLINE_BYTES - 1);
  assert.equal(s.outputs.log.text.includes('�'), false, 'no half character in the head');
});

test('a WHOLE output keeps its last byte and its BOM: stream mode is for the CUT read only', async () => {
  // The same defect C35 fixed in the store's program read. Stream mode holds a
  // partial trailing sequence back, which is right for the 256 KiB cut and wrong
  // for a complete file: a 4-byte latin-1 `café` came back `caf` with
  // truncated:false, while the streamed output route returned all four bytes.
  const registry = nodeScript(`
import { writeFileSync } from 'node:fs';
export default async function ({ outputs }) {
  writeFileSync(outputs.log.path, Buffer.concat([
    Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('// caf'), Buffer.from([0xE9])]));
  return { summary: 'latin1' };
}
`);
  const r = await runBenchOnce({ key: 'bench1' }, { registry, agentKeys: [] });
  assert.equal(r.outputs.log.truncated, false, 'a 10-byte output is nowhere near the cap');
  assert.equal(r.outputs.log.text, '﻿// caf�',
    `a complete output keeps its last byte, and its BOM (got ${JSON.stringify(r.outputs.log.text)})`);
});

test('bench: a python script with no interpreter is an error RESULT carrying the §7 sentence', async () => {
  const dir = tmp('worca-bench-py-');
  writeFileSync(join(dir, 'pyBench.py'), 'def main(api):\n    return {"summary": "never"}\n', 'utf8');
  const meta = {
    key: 'pyBench', metaVersion: 2, displayName: 'Py bench', origin: 'user', order: 100,
    runtime: 'python', file: 'pyBench.py', scriptPath: join(dir, 'pyBench.py'), commandResolved: null,
    timeoutMs: 20000, params: [], inputs: [],
    outputs: [{ id: 'out', type: 'md', when: 'always', filename: 'py-bench.md' }],
  };
  const prev = process.env.WORCA_PYTHON;
  process.env.WORCA_PYTHON = join(dir, 'not-a-python');
  resetPythonProbe();
  try {
    const result = await runBenchOnce({ key: 'pyBench', cwd: { kind: 'scratch' } },
      { registry: { pyBench: meta }, home: tmp('worca-bench-home-') });
    assert.equal(result.status, 'error', 'an execution error is a RESULT, never a transport failure (§4.1)');
    assert.equal(result.error.message, 'script "pyBench" needs python 3.8 or newer — none found on this machine (set WORCA_PYTHON)');
  } finally {
    if (prev === undefined) delete process.env.WORCA_PYTHON; else process.env.WORCA_PYTHON = prev;
    resetPythonProbe();
  }
});
