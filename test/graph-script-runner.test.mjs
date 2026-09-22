// test/graph-script-runner.test.mjs
// The script runtime (spec §4–§6): the envelope and env are PURE and pinned; the
// spawn cases use `process.execPath` fixtures only (Windows CI, §14): clean,
// blocking, error exit, garbage frame, missing output, `value` fallback, timeout
// + tree kill, abort, stream order, capture cap, mock. Every thrown error carries
// errorClass:null (D9) so classifyError can never read "timed out" as network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  runScriptExecution, buildEnvelope, envForShell, parseFrame, materializeOutputs, shellReport, envelopeAuditPath, scriptBaseEnv, resolveWiredParams,
  MAX_LINE, STREAM_MAX, FRAME_MAX,
} from '../src/core/graph/script-runner.mjs';
import { classifyError } from '../src/core/recoverable-error.mjs';
import { AWAIT_PORT, PARAMS_PORT } from '../src/shared/graph/constants.mjs';
import { probePython, resetPythonProbe } from '../src/core/graph/python-probe.mjs';

// mockEnabled() also reads the environment; these tests pin `ctx.mock === false` and WORCA_MOCK=0, so an
// ambient flag (a developer shell, a smoke run's leftovers) must not leak in (v2 R9).
delete process.env.WORCA_MOCK;
delete process.env.ORCH_MOCK;

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });
const NODE = JSON.stringify(process.execPath);                    // quoted for sh / cmd

const PORTS = {
  inputs: [{ id: 'done', type: 'void', required: false }, { id: 'planMd', type: 'md', required: true }, AWAIT_PORT],
  outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'tests-cycle{cycle}.md' },
    { id: 'fail', type: 'md', when: 'blocking', filename: 'tests-cycle{cycle}.md' },
    { id: 'report', type: 'json', when: 'always', filename: 'report-cycle{cycle}.json' },
    { id: 'pass', type: 'void', when: 'clean' }],
  verdict: { filename: 'tests-cycle{cycle}.json' },
};

/** A runner ctx the way _execCtx builds it, over a temp pipeline dir. */
function ctxFor({ meta, params = {}, file = null, command = null, timeoutMs = 20000, mock = null, ports = PORTS, bindings, signal, claudeOpts = {}, events = [] }) {
  const pipelineDir = tmp('worca-sr-pipe-');
  const cwd = tmp('worca-sr-cwd-');
  const ordinal = 2;
  const outputs = {};
  for (const p of ports.outputs) if (p.filename) outputs[p.id] = { path: join(pipelineDir, p.filename.replace('{cycle}', String(ordinal))), store: 'run' };
  const verdict = ports.verdict ? { path: join(pipelineDir, ports.verdict.filename.replace('{cycle}', String(ordinal))) } : null;
  return {
    node: { id: 'n_tests', kind: 'script', key: meta.key },
    executionId: 'x:n_tests:2', ordinal, cycle: ordinal, pipelineDir, pipelineId: 'b4c2e251', projectDir: cwd,
    runCtx: { pipelineDir, projectDir: '/abs/project', baseName: 'feature' },
    runRoot: null, workspace: undefined, repos: [{ projectKey: 'app', dir: cwd }], checkpointRef: '3f2a1b',
    ports, outputs, verdict,
    bindings: bindings ?? { done: { seq: 1, type: 'void' }, planMd: { seq: 2, type: 'md', path: join(pipelineDir, 'plan.md') } },
    trigger: { wireIds: ['w1'], freshPorts: ['done'] },
    script: { meta, runtime: meta.runtime, file, command, params, timeoutMs, mock },
    claudeOpts, signal, onEvent: (e) => events.push(e), events,
  };
}
const nodeMeta = (over = {}) => ({ key: 'runTests', displayName: 'Run tests', runtime: 'node', params: [], verdict: PORTS.verdict, ...over });
const shellMeta = (over = {}) => ({ key: 'sh', displayName: 'Shell', runtime: 'shell', params: [{ id: 'command', type: 'command', required: true }], verdict: PORTS.verdict, ...over });
const writeProgram = (dir, body) => { const f = join(dir, 'prog.mjs'); writeFileSync(f, body); return f; };

test('buildEnvelope: bound inputs only (await never), fresh mirrors the trigger, every declared output, params, ctx', () => {
  const ctx = ctxFor({ meta: nodeMeta(), params: { cmd: 'npm test' } });
  const env = buildEnvelope(ctx);
  assert.equal(env.apiVersion, 1);
  assert.deepEqual(env.node, { id: 'n_tests', key: 'runTests', displayName: 'Run tests' });
  assert.deepEqual(env.execution, { id: 'x:n_tests:2', ordinal: 2 });
  assert.deepEqual(Object.keys(env.inputs), ['done', 'planMd']);
  assert.deepEqual(env.inputs.done, { type: 'void', path: null, fresh: true });
  assert.deepEqual(env.inputs.planMd, { type: 'md', path: join(ctx.pipelineDir, 'plan.md'), fresh: false });
  assert.deepEqual(Object.keys(env.outputs), ['log', 'fail', 'report', 'pass']);
  assert.equal(env.outputs.log.path, env.outputs.fail.path, 'two ports sharing a template share one path');
  assert.deepEqual(env.outputs.pass, { type: 'void', path: null });
  assert.equal(env.verdictPath, join(ctx.pipelineDir, 'tests-cycle2.json'));
  assert.deepEqual(env.params, { cmd: 'npm test' });
  assert.equal(env.ctx.cwd, ctx.projectDir);
  assert.equal(env.ctx.projectDir, '/abs/project');
  assert.equal(env.ctx.pipelineDir, ctx.pipelineDir);
  assert.equal(env.ctx.runRoot, null);
  assert.equal(env.ctx.repos, null, 'a single-project run lists no repos');
  assert.equal(env.ctx.checkpointRef, '3f2a1b');
  assert.equal(env.ctx.baseName, 'feature');
  assert.equal(env.ctx.runId, 'b4c2e251');
  assert.equal(env.ctx.platform, process.platform);
  assert.equal(env.ctx.mock, false);
  const ws = buildEnvelope({ ...ctx, runRoot: '/abs/root', workspace: { kind: 'metadata', projects: [{}] } });
  assert.deepEqual(ws.ctx.repos, [{ key: 'app', dir: ctx.projectDir }]);
  assert.equal(ws.ctx.runRoot, '/abs/root');
  assert.equal(buildEnvelope({ ...ctx, claudeOpts: { mock: true } }).ctx.mock, true);
  assert.equal(envelopeAuditPath(ctx), join(ctx.pipelineDir, 'scripts', 'n_tests-c2.envelope.json'));
  assert.equal(envelopeAuditPath({ ...ctx, slice: { id: 'p1t2' } }), join(ctx.pipelineDir, 'scripts', 'n_tests-c2-p1t2.envelope.json'));
});

test('envForShell: strips the three WORCA vars, passes the rest, maps ports/params/ctx to WORCA_* (lowerCamel -> UPPER_SNAKE)', () => {
  const ctx = ctxFor({ meta: nodeMeta(), params: { cmd: 'npm test', stat: true, n: 3 } });
  const env = envForShell(buildEnvelope(ctx), { PATH: '/usr/bin', HOME: '/h', WORCA_HOME: '/h/.worca-cc', WORCA_RUN_ROOT: 'legacy', WORCA_HOST_PID: '42', GOPATH: '/go', NODE_OPTIONS: '--x' });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/h');
  assert.equal(env.GOPATH, '/go');
  assert.equal(env.NODE_OPTIONS, '--x');
  assert.equal(env.WORCA_HOME, undefined);
  assert.equal(env.WORCA_HOST_PID, undefined);
  assert.equal(env.WORCA_RUN_ROOT, '', 'the ctx value (null on a single-project run) replaces the server mode switch');
  assert.equal(env.WORCA_IN_DONE, '');
  assert.equal(env.WORCA_IN_PLAN_MD, join(ctx.pipelineDir, 'plan.md'));
  assert.equal(env.WORCA_OUT_LOG, join(ctx.pipelineDir, 'tests-cycle2.md'));
  assert.equal(env.WORCA_OUT_REPORT, join(ctx.pipelineDir, 'report-cycle2.json'));
  assert.equal('WORCA_OUT_PASS' in env, false, 'void outputs are omitted');
  assert.equal(env.WORCA_VERDICT, join(ctx.pipelineDir, 'tests-cycle2.json'));
  assert.equal(env.WORCA_PARAM_CMD, 'npm test');
  assert.equal(env.WORCA_PARAM_STAT, 'true');
  assert.equal(env.WORCA_PARAM_N, '3');
  assert.equal(env.WORCA_CWD, ctx.projectDir);
  assert.equal(env.WORCA_PIPELINE_DIR, ctx.pipelineDir);
  assert.equal(env.WORCA_PROJECT_DIR, '/abs/project');
  assert.equal(env.WORCA_CHECKPOINT_REF, '3f2a1b');
  assert.equal(env.WORCA_CYCLE, '2');
  assert.equal(env.WORCA_RUN_ID, 'b4c2e251');
  assert.equal(env.WORCA_PLATFORM, process.platform);
  assert.equal(env.WORCA_MOCK, '0');
});

test('parseFrame and shellReport are pure', () => {
  assert.deepEqual(parseFrame(''), { ok: false, reason: 'no result frame' });
  assert.deepEqual(parseFrame('nope'), { ok: false, reason: 'stdout is not JSON' });
  assert.deepEqual(parseFrame('{"summary":"x"}'), { ok: false, reason: 'frame has no ok field' });
  assert.deepEqual(parseFrame(' {"ok":true,"summary":"x"} '), { ok: true, frame: { ok: true, summary: 'x' } });
  const md = shellReport({ displayName: 'Run tests', ordinal: 2, command: 'npm test', exitCode: 1, durationMs: 42340, platform: 'darwin', capture: 'a\r\nb\n' });
  assert.equal(md, '# Run tests — cycle 2\n\nCommand: `npm test`\nExit code: 1 · 42.3 s · darwin\n\n```text\na\nb\n```\n');
  assert.match(shellReport({ displayName: 'x', ordinal: 1, command: 'c', exitCode: null, signal: 'SIGKILL', timedOut: true, durationMs: 0, platform: 'linux', capture: '' }), /\ntimed out · 0\.0 s · linux\n/);
});

test('materializeOutputs: an existing file stands, `value` is written for md (string) and json, a json token carries value ≤ 64 KiB, missing throws errorClass:null', async () => {
  const ctx = ctxFor({ meta: nodeMeta() });
  writeFileSync(ctx.outputs.log.path, '# written by the script\n');
  const tokens = await materializeOutputs(ctx.ports, ctx.outputs, { ok: true, outputs: { report: { value: { passed: 1 } }, log: { value: 'IGNORED' } } }, 'runTests');
  assert.equal(readFileSync(ctx.outputs.log.path, 'utf8'), '# written by the script\n', 'a file on disk beats a frame value');
  assert.deepEqual(JSON.parse(readFileSync(ctx.outputs.report.path, 'utf8')), { passed: 1 });
  assert.deepEqual(tokens.report, { path: ctx.outputs.report.path, value: { passed: 1 } });
  assert.deepEqual(tokens.log, { path: ctx.outputs.log.path });
  assert.deepEqual(tokens.fail, { path: ctx.outputs.log.path });
  assert.deepEqual(tokens.pass, {});
  const c2 = ctxFor({ meta: nodeMeta() });
  await assert.rejects(materializeOutputs(c2.ports, c2.outputs, { ok: true }, 'runTests'),
    (e) => e.message === 'script "runTests": output "log" was not written' && e.errorClass === null && classifyError(e) === null);
  const c3 = ctxFor({ meta: nodeMeta() });
  await assert.rejects(materializeOutputs(c3.ports, c3.outputs, { ok: true, outputs: { log: { value: 12 }, report: { value: {} } } }, 'runTests'),
    /output "log" value must be a string for an md port/);
});

test('node runtime, clean: the frame`s outputs/verdict/summary/logs land; events stream; result event is $0', async () => {
  const dir = tmp('worca-sr-prog-');
  const file = writeProgram(dir, `
import { writeFileSync } from 'node:fs';
export default async function ({ inputs, outputs, params, ctx, log, execution }) {
  console.log('hello from stdout');            // routed to stderr by the harness
  console.error('hello from stderr');
  writeFileSync(outputs.log.path, '# tests cycle ' + execution.ordinal + '\\n');
  log('info', 'params=' + JSON.stringify(params) + ' cwd=' + ctx.cwd + ' fresh=' + inputs.done.fresh);
  return { summary: 'all passing', outputs: { report: { value: { passed: 3 } } }, verdict: { issues: [] } };
}\n`);
  const ctx = ctxFor({ meta: nodeMeta(), file, params: { cmd: 'x' } });
  const res = await runScriptExecution(ctx);
  assert.equal(res.summary, 'all passing');
  assert.equal(res.runtime, 'node');
  assert.equal(res.exitCode, 0);
  assert.equal(res.sessionId, null);
  assert.ok(res.durationMs >= 0);
  assert.deepEqual(res.verdict, { issues: [], summary: '' });
  assert.deepEqual(JSON.parse(readFileSync(ctx.verdict.path, 'utf8')), { issues: [], summary: '' }, 'the frame verdict is written to the verdict path');
  assert.equal(readFileSync(ctx.outputs.log.path, 'utf8'), '# tests cycle 2\n');
  assert.deepEqual(res.outputs.report, { path: ctx.outputs.report.path, value: { passed: 3 } });
  assert.deepEqual(res.outputs.pass, {});
  assert.deepEqual(res.warnings, []);
  assert.equal(res.envelopePath, envelopeAuditPath(ctx));
  assert.ok(existsSync(res.envelopePath), 'the envelope audit copy exists');
  assert.equal(JSON.parse(readFileSync(res.envelopePath, 'utf8')).node.key, 'runTests');
  const texts = ctx.events.filter((e) => e.type === 'text').map((e) => e.text);
  assert.deepEqual(texts, ['hello from stdout', 'hello from stderr', `[info] params={"cmd":"x"} cwd=${ctx.projectDir} fresh=true`], 'stderr lines first, then logs[]');
  const result = ctx.events.find((e) => e.type === 'result');
  assert.equal(result.costUsd, 0);
  assert.deepEqual({ ...result.raw, durationMs: 0 }, { type: 'result', script: true, exitCode: 0, durationMs: 0 });
});

test('node runtime, blocking verdict and a thrown error; a verdict file the script writes itself wins', async () => {
  // v3 S2: the default PORTS declare the `report` json output, and none of these fixtures writes it — v2 ran them
  // against PORTS and every one died with `output "report" was not written` before its own assertion was reached.
  const ports = { ...PORTS, outputs: PORTS.outputs.filter((o) => o.id !== 'report') };
  const dir = tmp('worca-sr-prog-');
  const failing = writeProgram(dir, `export default async function ({ outputs }) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outputs.log.path, '# 3 failing\\n');
  return { verdict: { issues: [{ severity: 'major', title: '3 tests failed' }] } };
}\n`);
  const r1 = await runScriptExecution(ctxFor({ meta: nodeMeta(), file: failing, ports }));
  assert.equal(r1.verdict.issues[0].severity, 'major');
  const throwing = writeProgram(tmp('worca-sr-prog-'), `export default async function () { throw new Error('no package.json in cwd'); }\n`);
  await assert.rejects(runScriptExecution(ctxFor({ meta: nodeMeta(), file: throwing, ports })),
    (e) => e.message === 'script "runTests": no package.json in cwd' && e.errorClass === null);
  const selfVerdict = writeProgram(tmp('worca-sr-prog-'), `export default async function ({ outputs, verdictPath }) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outputs.log.path, 'x'); writeFileSync(verdictPath, JSON.stringify({ issues: [{ severity: 'critical', title: 'from file' }] }));
  return {};
}\n`);
  const r3 = await runScriptExecution(ctxFor({ meta: nodeMeta(), file: selfVerdict, ports }));
  assert.equal(r3.verdict.issues[0].title, 'from file');
  assert.equal(r3.summary, 'Run tests completed.', 'absent summary falls back');
});

test('node runtime protocol failures: garbage on stdout, a crash before the frame, a missing program', async () => {
  const garbage = writeProgram(tmp('worca-sr-prog-'), `export default async function ({ outputs }) {
  const { writeFileSync } = await import('node:fs'); writeFileSync(outputs.log.path, 'x');
  process.stdout.write('not json\\n'); return {};
}\n`);
  await assert.rejects(runScriptExecution(ctxFor({ meta: nodeMeta(), file: garbage })),
    (e) => /^script "runTests": no result frame \(exit 0\) — stdout is not JSON/.test(e.message) && e.errorClass === null);
  const crash = writeProgram(tmp('worca-sr-prog-'), `process.exit(3);\n`);
  await assert.rejects(runScriptExecution(ctxFor({ meta: nodeMeta(), file: crash })), /no result frame \(exit 3\)/);
  await assert.rejects(runScriptExecution(ctxFor({ meta: nodeMeta(), file: join(tmp('worca-sr-prog-'), 'missing.mjs') })),
    (e) => /program file not found/.test(e.message) && e.errorClass === null);
  const noValue = writeProgram(tmp('worca-sr-prog-'), `export default async function () { return { summary: 'wrote nothing' }; }\n`);
  await assert.rejects(runScriptExecution(ctxFor({ meta: nodeMeta(), file: noValue })), /output "log" was not written/);
});

test('timeout kills the whole tree and abort re-throws the signal reason; both leave errorClass null', async () => {
  const dir = tmp('worca-sr-prog-');
  const pidFile = join(dir, 'grandchild.pid');
  const hang = writeProgram(dir, `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
export default async function () {
  const g = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
  await new Promise(() => {});
}\n`);
  const t0 = Date.now();
  await assert.rejects(runScriptExecution(ctxFor({ meta: nodeMeta(), file: hang, timeoutMs: 1500 })),
    (e) => e.message === 'script "runTests" timed out after 2 s' && e.errorClass === null && classifyError(e) === null);
  assert.ok(Date.now() - t0 < 10000);
  const gpid = Number(readFileSync(pidFile, 'utf8'));
  let dead = false;
  for (let i = 0; i < 40 && !dead; i += 1) { try { process.kill(gpid, 0); await new Promise((r) => setTimeout(r, 50)); } catch { dead = true; } }
  assert.ok(dead, `grandchild ${gpid} must be gone after the tree kill`);
  const ac = new AbortController();
  const p = runScriptExecution(ctxFor({ meta: nodeMeta(), file: hang, timeoutMs: 20000, signal: ac.signal }));
  setTimeout(() => ac.abort(), 300);
  await assert.rejects(p, (e) => e.name === 'AbortError');
});

test('shell runtime: exit 0 clean, exit 1 blocking with a synthesized major issue and the report, exit 2 an error, streamed lines interleaved', async () => {
  const cmdOf = (code, lines = '') => `${NODE} -e "${lines}process.exit(${code})"`;
  const cleanCtx = ctxFor({ meta: shellMeta(), params: { command: cmdOf(0, 'console.log(1);console.error(2);console.log(3);') }, ports: { ...PORTS, outputs: PORTS.outputs.filter((o) => o.id !== 'report') } });
  const clean = await runScriptExecution(cleanCtx);
  assert.equal(clean.exitCode, 0);
  assert.equal(clean.runtime, 'shell');
  assert.deepEqual(clean.verdict, { issues: [], summary: 'Shell exited 0' });
  const report = readFileSync(clean.outputs.log.path, 'utf8');
  assert.match(report, /^# Shell — cycle 2\n\nCommand: `.*-e .*`\nExit code: 0 · \d+\.\d s · \w+\n\n```text\n(?:[123]\n){3}```\n$/);
  // stdout and stderr are two pipes: arrival order across them is not pinned, only that every line arrived once.
  assert.deepEqual(cleanCtx.events.filter((e) => e.type === 'text').map((e) => e.text).sort(), ['1', '2', '3']);
  assert.deepEqual(clean.warnings, []);
  assert.match(clean.summary, /^Shell: exit 0 in \d+\.\d s$/);
  const failing = ctxFor({ meta: shellMeta(), params: { command: cmdOf(1, 'console.log(\'FAIL x\');') }, ports: { ...PORTS, outputs: PORTS.outputs.filter((o) => o.id !== 'report') } });
  const blocking = await runScriptExecution(failing);
  assert.equal(blocking.exitCode, 1);
  assert.deepEqual(blocking.verdict.issues, [{ severity: 'major', title: 'Shell failed (exit 1)', detail: 'FAIL x', location: '' }]);
  assert.deepEqual(JSON.parse(readFileSync(failing.verdict.path, 'utf8')).issues.length, 1, 'the synthesized verdict is written so History shows it');
  assert.equal(readFileSync(blocking.outputs.fail.path, 'utf8'), readFileSync(blocking.outputs.log.path, 'utf8'));
  await assert.rejects(runScriptExecution(ctxFor({ meta: shellMeta(), params: { command: cmdOf(2) }, ports: { ...PORTS, outputs: PORTS.outputs.filter((o) => o.id !== 'report') } })),
    (e) => /^script "sh" exited 2/.test(e.message) && e.errorClass === null);
  // The json output must be written by the command: the report port is unwritten here.
  await assert.rejects(runScriptExecution(ctxFor({ meta: shellMeta(), params: { command: cmdOf(0) } })), /output "report" was not written/);
});

test('a re-run of the SAME execution starts from scratch: stale outputs and a stale verdict never stand (D22, v2 R6)', async () => {
  // A paused-then-resumed execution keeps its executionId, ordinal and therefore its PATHS. Attempt 1 exits 2 (an
  // error): its report is on disk, and here a stale verdict too. Attempt 2 must publish ITS OWN report and verdict.
  const ports = { ...PORTS, outputs: PORTS.outputs.filter((o) => o.id !== 'report') };
  const first = ctxFor({ meta: shellMeta(), params: { command: `${NODE} -e "console.log('ATTEMPT ONE');process.exit(2)"` }, ports });
  await assert.rejects(runScriptExecution(first), /exited 2/);
  assert.match(readFileSync(first.outputs.log.path, 'utf8'), /ATTEMPT ONE/, 'a failed run leaves its log behind');
  writeFileSync(first.verdict.path, JSON.stringify({ issues: [{ severity: 'critical', title: 'stale' }] }));
  const second = { ...first, script: { ...first.script, params: { command: `${NODE} -e "console.log('ATTEMPT TWO')"` } }, events: [], onEvent: () => {} };
  const r = await runScriptExecution(second);
  const md = readFileSync(r.outputs.log.path, 'utf8');
  assert.match(md, /ATTEMPT TWO/);
  assert.doesNotMatch(md, /ATTEMPT ONE/, 'the failed attempt`s report must not be published as this attempt`s output');
  assert.deepEqual(r.verdict.issues, [], 'the stale verdict file was cleared, so exit 0 synthesizes a clean verdict');
  // Inputs are never touched: only this execution's ALLOCATED output/verdict paths are cleared.
  const dir = tmp('worca-sr-prog-');
  const planMd = join(second.pipelineDir, 'plan.md');
  writeFileSync(planMd, '# plan\n');
  const file = writeProgram(dir, `export default async function ({ inputs, outputs }) {
  const fs = await import('node:fs'); fs.writeFileSync(outputs.log.path, fs.readFileSync(inputs.planMd.path, 'utf8')); return {};
}\n`);
  const third = { ...second, script: { ...second.script, meta: nodeMeta(), runtime: 'node', file, params: {} }, node: { id: 'n_tests', kind: 'script', key: 'runTests' } };
  const r3 = await runScriptExecution(third);
  assert.equal(readFileSync(r3.outputs.log.path, 'utf8'), '# plan\n');
  assert.equal(readFileSync(planMd, 'utf8'), '# plan\n');
});

test('shell runtime: exitCodes override, a verdict file the command writes wins, the sidecar command runs when no param overrides it', async () => {
  const meta = shellMeta({ params: [], exitCodes: { clean: [0, 5], blocking: [1] } });
  const ports = { ...PORTS, outputs: PORTS.outputs.filter((o) => o.id !== 'report') };
  const five = await runScriptExecution(ctxFor({ meta, command: `${NODE} -e "process.exit(5)"`, ports }));
  assert.equal(five.exitCode, 5);
  assert.deepEqual(five.verdict.issues, []);
  const writes = `${NODE} -e "require('fs').writeFileSync(process.env.WORCA_VERDICT, JSON.stringify({issues:[{severity:'minor',title:'from cmd'}]}));process.exit(1)"`;
  const own = await runScriptExecution(ctxFor({ meta, command: writes, ports }));
  assert.deepEqual(own.verdict.issues.map((i) => i.title), ['from cmd'], 'exit 1 would synthesize a major; the file wins');
  assert.equal(own.exitCode, 1);
});

test('capture cap: a 2 MiB stream keeps the first 256 KiB and the last 768 KiB with an omitted marker', { timeout: 60000 }, async () => {
  const ports = { ...PORTS, outputs: PORTS.outputs.filter((o) => o.id !== 'report') };
  const spew = `${NODE} -e "const l='x'.repeat(1023)+'\\n';for(let i=0;i<2048;i++)process.stdout.write(l);console.log('END')"`;
  const r = await runScriptExecution(ctxFor({ meta: shellMeta(), params: { command: spew }, ports }));
  const md = readFileSync(r.outputs.log.path, 'utf8');
  assert.match(md, /… \d+ bytes omitted …/);
  assert.ok(md.length < 1.2 * 1024 * 1024, `report is capped, got ${md.length}`);
  assert.match(md, /END\n```\n$/, 'the tail survives');
});

test('v4 T1: one child cannot flood the host — a newline-free blob is cut into bounded lines, the live stream stops at STREAM_MAX, the frame at FRAME_MAX', { timeout: 60000 }, async () => {
  const ports = { ...PORTS, outputs: PORTS.outputs.filter((o) => o.id !== 'report') };
  // 6 MiB with NO newline: v3 re-scanned its growing line buffer on every chunk (quadratic; 600 MiB pinned the host for 120 s).
  const blob = `${NODE} -e "const b=Buffer.alloc(1048576,120);for(let i=0;i<6;i++)process.stdout.write(b);console.log('');console.log('END')"`;
  const ctx = ctxFor({ meta: shellMeta(), params: { command: blob }, ports });
  const t0 = Date.now();
  const r = await runScriptExecution(ctx);
  assert.ok(Date.now() - t0 < 20000, 'linear, not quadratic');
  assert.equal(r.exitCode, 0);
  const texts = ctx.events.filter((e) => e.type === 'text').map((e) => e.text);
  const cut = texts.filter((t) => /^… live output cut after 4 MiB/.test(t));
  assert.equal(cut.length, 1, 'exactly one marker');
  assert.ok(texts.every((t) => t.length <= MAX_LINE + 128), `no streamed line exceeds MAX_LINE (longest: ${Math.max(...texts.map((t) => t.length))})`);
  assert.ok(texts.reduce((n, t) => n + t.length, 0) <= STREAM_MAX + MAX_LINE, 'the live stream is bounded');
  assert.equal(texts.includes('END'), false, 'nothing is streamed after the cut');
  assert.match(readFileSync(r.outputs.log.path, 'utf8'), /END\n```\n$/, 'the report still has the tail');
  // node runtime: stdout is the frame. A program whose own child inherits stdout can dump anything into it.
  const flood = writeProgram(tmp('worca-sr-prog-'), `export default async function ({ outputs }) {
  const fs = await import('node:fs'); fs.writeFileSync(outputs.log.path, 'x');
  const b = Buffer.alloc(1048576, 120); for (let i = 0; i < 9; i++) process.stdout.write(b);
  return {};
}\n`);
  await assert.rejects(runScriptExecution(ctxFor({ meta: nodeMeta(), file: flood, ports })),
    (e) => /^script "runTests": stdout exceeded 8 MiB — stdout is reserved for the result frame/.test(e.message) && e.errorClass === null);
  assert.deepEqual([MAX_LINE, STREAM_MAX, FRAME_MAX], [65536, 4194304, 8388608]);
});

test('v4 T3: a timeout past the timer range is clamped to 24 h, not fired after one millisecond', async () => {
  const ports = { ...PORTS, outputs: PORTS.outputs.filter((o) => o.id !== 'report') };
  // setTimeout(fn, 3e9) overflows to a 1 ms delay: v3 killed this command at once with "timed out after 3000000 s".
  const r = await runScriptExecution(ctxFor({ meta: shellMeta(), params: { command: `${NODE} -e "setTimeout(()=>console.log('SLOW OK'),300)"` }, ports, timeoutMs: 3000000000 }));
  assert.equal(r.exitCode, 0);
  assert.match(readFileSync(r.outputs.log.path, 'utf8'), /SLOW OK/);
});

test('v4 T4: a script child does not outlive its host — a normal host exit reaps the process group', { timeout: 60000 }, async () => {
  // POSIX script children lead their OWN group, so a terminal Ctrl+C never reaches them; the runner reaps them on 'exit'.
  const dir = tmp('worca-sr-host-');
  const pidFile = join(dir, 'child.pid');
  const runner = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core', 'graph', 'script-runner.mjs')).href;
  const pipelineDir = tmp('worca-sr-pipe-');
  const host = join(dir, 'host.mjs');
  writeFileSync(host, `import { existsSync } from 'node:fs';
import { runScriptExecution } from ${JSON.stringify(runner)};
const command = ${JSON.stringify(`${NODE} -e "require('fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)" ${JSON.stringify(pidFile)}`)};
runScriptExecution({
  node: { id: 'n_q', kind: 'script', key: 'sh' }, executionId: 'x:n_q:1', ordinal: 1, pipelineDir: ${JSON.stringify(pipelineDir)}, projectDir: ${JSON.stringify(dir)},
  ports: { inputs: [], outputs: [] }, outputs: {}, verdict: null, bindings: {}, claudeOpts: {}, onEvent: () => {},
  script: { meta: { key: 'sh', runtime: 'shell', params: [{ id: 'command', type: 'command' }] }, params: { command }, timeoutMs: 60000 },
}).catch(() => {});
const wait = setInterval(() => { if (existsSync(${JSON.stringify(pidFile)})) { clearInterval(wait); process.exit(0); } }, 25);
`);
  const res = spawnSync(process.execPath, [host], { encoding: 'utf8', timeout: 30000 });
  assert.equal(res.status, 0, res.stderr);
  const pid = Number(readFileSync(pidFile, 'utf8'));
  let dead = false;
  for (let i = 0; i < 60 && !dead; i += 1) { try { process.kill(pid, 0); await new Promise((r) => setTimeout(r, 50)); } catch { dead = true; } }
  assert.ok(dead, `script child ${pid} must be gone once its host has exited`);
});

test('mock (D13): a declared mock spawns nothing and writes what it declares; no declaration runs the script for real', async () => {
  const dir = tmp('worca-sr-prog-');
  const marker = join(dir, 'ran.txt');
  const file = writeProgram(dir, `export default async function ({ outputs }) { const fs = await import('node:fs'); fs.writeFileSync(${JSON.stringify(marker)}, '1'); fs.writeFileSync(outputs.log.path, 'real'); return {}; }\n`);
  const ports = { ...PORTS, outputs: PORTS.outputs.filter((o) => o.id !== 'report') };
  const mocked = ctxFor({ meta: nodeMeta(), file, ports, claudeOpts: { mock: true },
    mock: { summary: 'mocked', verdict: { issues: [{ severity: 'major', title: 'm' }] }, outputs: { log: { text: '# mock log' } } } });
  const r = await runScriptExecution(mocked);
  assert.equal(existsSync(marker), false, 'nothing was spawned');
  assert.equal(r.summary, 'mocked');
  assert.equal(readFileSync(mocked.outputs.log.path, 'utf8'), '# mock log');
  assert.equal(r.verdict.issues[0].title, 'm');
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.outputs.pass, {});
  assert.equal(mocked.events.find((e) => e.type === 'result').raw.mock, true);
  const real = ctxFor({ meta: nodeMeta(), file, ports, claudeOpts: { mock: true } });
  await runScriptExecution(real);
  assert.equal(existsSync(marker), true, 'mock mode without a declaration runs the script');
  const bad = ctxFor({ meta: nodeMeta(), file, ports, claudeOpts: { mock: true }, mock: { outputs: { nope: { text: '' } } } });
  await assert.rejects(runScriptExecution(bad), /mock names output "nope"/);
  const unwritten = ctxFor({ meta: nodeMeta(), file, ports, claudeOpts: { mock: true }, mock: { summary: 'x' } });
  await assert.rejects(runScriptExecution(unwritten), /mock leaves output "log" unwritten/);
});

test('P11: under the run`s env-scrub guardrail a script child starts from the agents` scrubbed env, plus the allowlist and the WORCA_* contract', async () => {
  const ports = { ...PORTS, outputs: PORTS.outputs.filter((o) => o.id !== 'report') };
  const print = `${NODE} -e "console.log('S='+(process.env.WORCA_TEST_SECRET||'')+' K='+(process.env.WORCA_TEST_KEEP||'')+' O='+(process.env.WORCA_OUT_LOG?'y':'n'))"`;
  process.env.WORCA_TEST_SECRET = 's3cret';
  process.env.WORCA_TEST_KEEP = 'kept';
  try {
    const open = await runScriptExecution(ctxFor({ meta: shellMeta(), params: { command: print }, ports }));
    assert.match(readFileSync(open.outputs.log.path, 'utf8'), /^S=s3cret K=kept O=y$/m, 'scrub off: the server env (D11)');
    const scrubbed = await runScriptExecution(ctxFor({ meta: shellMeta(), params: { command: print }, ports,
      claudeOpts: { envScrub: true, envAllowlist: ['WORCA_TEST_KEEP'] } }));
    assert.match(readFileSync(scrubbed.outputs.log.path, 'utf8'), /^S= K=kept O=y$/m, 'scrub on: the secret is gone, the allowlisted var and the contract stay');
    assert.equal(scriptBaseEnv({}), process.env);
    const win = scriptBaseEnv({ envScrub: true }, 'win32');
    assert.equal('WORCA_TEST_SECRET' in win, false);
    assert.equal(win.PATH, process.env.PATH);
  } finally {
    delete process.env.WORCA_TEST_SECRET;
    delete process.env.WORCA_TEST_KEEP;
  }
});

test('W12: ctx.bench rides the envelope and WORCA_BENCH the shell env; a pipeline run carries neither', () => {
  const ctx = ctxFor({ meta: nodeMeta() });
  const pipeline = buildEnvelope(ctx);
  assert.equal(pipeline.ctx.bench, false);
  assert.equal(pipeline.apiVersion, 1, 'the flag is ADDITIVE — apiVersion stays 1');
  assert.equal('WORCA_BENCH' in envForShell(pipeline, { PATH: '/usr/bin' }), false, 'absent, not empty');
  assert.equal('WORCA_BENCH' in envForShell(pipeline, { PATH: '/usr/bin', WORCA_BENCH: '1' }), false, 'never inherited');
  const bench = buildEnvelope({ ...ctx, bench: true });
  assert.equal(bench.ctx.bench, true);
  assert.equal(envForShell(bench, { PATH: '/usr/bin' }).WORCA_BENCH, '1');
});

test('the node child flushes STDERR before it exits: a slow host loses no live line', { timeout: 60000 }, async () => {
  const ports = { ...PORTS, outputs: PORTS.outputs.filter((o) => o.id !== 'report') };
  const N = 20000;
  // console.* rides the child's STDERR, which is ASYNCHRONOUS on a macOS pipe. The
  // host is the slow end of a chatty script (one broadcast per line, one browser
  // tab each): the child finished, wrote its frame and exited while ~170 KiB of
  // stderr were still queued, and 3 of 4 lines never reached the bench.
  const prog = writeProgram(tmp('worca-sr-prog-'), `export default async function ({ outputs }) {
  const fs = await import('node:fs'); fs.writeFileSync(outputs.log.path, 'x');
  for (let i = 0; i < ${N}; i += 1) console.log('line ' + i);
  return { summary: 'chatty' };
}\n`);
  const texts = [];
  let stalled = false;
  const ctx = ctxFor({ meta: nodeMeta(), file: prog, ports });
  ctx.onEvent = (e) => {
    if (e.type !== 'text') return;
    texts.push(e.text);
    if (stalled) return;
    stalled = true;
    const until = Date.now() + 400;                 // the host stalls once, the child runs to completion
    while (Date.now() < until) { /* busy */ }
  };
  await runScriptExecution(ctx);
  assert.equal(texts.filter((t) => /^line \d+$/.test(t)).length, N, 'every logged line reached the host');
});

test('…and the flush is BOUNDED: a program that mutes or corks stderr still returns its frame', { timeout: 60000 }, async () => {
  // The flush above calls whatever `process.stderr.write` IS at exit time, and waits
  // for a callback the USER program controls. `process.stderr.write = () => true` is
  // the usual "silence a noisy dependency" line — and this harness routes console.*
  // to stderr, so that IS how a script quietens its own log; `cork()` is the other
  // way. The setInterval that holds the loop open then leaves the parent's timeout
  // kill as the only way out: a PIPELINE run of such a script held a scheduler slot
  // for its whole timeout and failed, where at the checkpoint it finished in 40 ms.
  const ports = { ...PORTS, outputs: PORTS.outputs.filter((o) => o.id !== 'report') };
  for (const [name, line] of [['mute', 'process.stderr.write = () => true;'], ['cork', 'process.stderr.cork();']]) {
    const prog = writeProgram(tmp('worca-sr-prog-'), `export default async function ({ outputs }) {
  const fs = await import('node:fs'); fs.writeFileSync(outputs.log.path, 'x');
  ${line}
  return { summary: '${name}' };
}\n`);
    const started = Date.now();
    const res = await runScriptExecution(ctxFor({ meta: nodeMeta(), file: prog, ports, timeoutMs: 5000 }));
    const ms = Date.now() - started;
    assert.equal(res.summary, name, `${name}: the frame still reached the parent`);
    assert.ok(ms < 4000, `${name}: returned in ${ms} ms — the flush must not run to the timeout`);
  }
});

test('…and the bound never outlives the FRAME: a 250 KiB frame survives a host stalled past it', { timeout: 60000 }, async () => {
  // The child's stdout is a PIPE and the kernel buffer is 64 KiB: whatever does not
  // fit waits for the parent to read it. A bound armed BESIDE the frame write therefore
  // races the frame — the moment the parent's loop is blocked longer than the bound,
  // `process.exit(0)` fires mid-write, the parent receives 65 536 bytes of half a JSON
  // document and reports `no result frame (exit 0) — stdout is not JSON` for a run that
  // succeeded at the checkpoint. `frame.logs` and the returned `outputs` are UNCAPPED
  // (only FRAME_MAX, 8 MiB, catches them), and an ordinary chatty script on a busy host
  // (a run-log writer, a WS broadcast per line) produces the same lag with no stall at
  // all. The pin must exceed BOTH the bound and the pipe buffer: the 40-byte frame and
  // 400 ms stall of the test above cannot see any of this.
  const ports = { ...PORTS, outputs: PORTS.outputs.filter((o) => o.id !== 'report') };
  const prog = writeProgram(tmp('worca-sr-prog-'), `export default async function ({ outputs, log }) {
  const fs = await import('node:fs'); fs.writeFileSync(outputs.log.path, 'x');
  console.log('stall the host here');
  for (let i = 0; i < 2000; i += 1) log('info', 'entry ' + i + ' ' + 'x'.repeat(100));
  return { summary: 'big frame' };
}\n`);
  let stalled = false;
  const ctx = ctxFor({ meta: nodeMeta(), file: prog, ports, timeoutMs: 20000 });
  ctx.onEvent = (e) => {
    if (e.type !== 'text' || stalled) return;
    stalled = true;
    const until = Date.now() + 1500;        // past the flush bound, with the frame still on the pipe
    while (Date.now() < until) { /* busy */ }
  };
  const res = await runScriptExecution(ctx);
  assert.equal(res.summary, 'big frame', 'the whole frame reached the parent, not its first 64 KiB');
});

// ── the python runtime (workbench spec §7) ────────────────────────────────────
const PROBE = await probePython();
const pySkip = PROBE.ok ? false : `no python on this host: ${PROBE.reason}`;

/** A python sidecar with its program written next to it; `file` is absolute, as the registry stamps it. */
function pyScript(source, over = {}) {
  const dir = tmp('worca-sr-py-');
  const file = join(dir, 'card.py');
  writeFileSync(file, source, 'utf8');
  return { meta: { key: 'pyCard', displayName: 'Py card', runtime: 'python', ...over }, file };
}

test('python: the harness runs, the frame lands, outputs materialize, lines stream', { skip: pySkip }, async () => {
  const { meta, file } = pyScript(`
import sys

def main(api):
    print('cycle ' + str(api.execution.ordinal), file=sys.stderr)
    with open(api.outputs.log.path, 'w', encoding='utf-8') as f:
        f.write('# tests\\n\\nall passing\\n')
    with open(api.outputs.report.path, 'w', encoding='utf-8') as f:
        f.write('{"passed": 212}')
    return {'summary': '212 passing', 'verdict': {'issues': []}}
`);
  const events = [];
  const ctx = ctxFor({ meta, file, events });
  const res = await runScriptExecution(ctx);
  assert.equal(res.runtime, 'python');
  assert.equal(res.exitCode, 0);
  assert.equal(res.summary, '212 passing');
  assert.deepEqual(res.verdict.issues, []);
  assert.equal(readFileSync(res.outputs.log.path, 'utf8'), '# tests\n\nall passing\n');
  assert.deepEqual(res.outputs.report.value, { passed: 212 });
  assert.ok(events.some((e) => e.type === 'text' && e.text === 'cycle 2'), 'stderr streams line by line');
  assert.ok(events.some((e) => e.type === 'result' && e.costUsd === 0), 'a $0 result event, like every script');
  assert.ok(existsSync(res.envelopePath), 'the envelope audit copy is written for python too');
});

test('python: a raise is an execution error with the message and errorClass null', { skip: pySkip }, async () => {
  const { meta, file } = pyScript(`
def main(api):
    raise RuntimeError('no package.json in cwd')
`);
  await assert.rejects(runScriptExecution(ctxFor({ meta, file })), (err) => {
    assert.equal(err.message, 'script "pyCard": no package.json in cwd');
    assert.equal(err.errorClass, null);
    assert.equal(classifyError(err), null);
    return true;
  });
});

test('python: a frame over 8 MiB is refused by name, and the hint does not send the author to api.log()', { skip: pySkip }, async () => {
  const { meta, file } = pyScript(`
def main(api):
    return {'summary': 'x' * (9 * 1024 * 1024)}
`);
  await assert.rejects(runScriptExecution(ctxFor({ meta, file })), (err) => {
    assert.match(err.message, /^script "pyCard": stdout exceeded 8 MiB — stdout is reserved for the result frame; log through print\(\)/);
    assert.equal(err.message.includes('api.log'), false, 'api.log() lines ride the frame: they are part of the 8 MiB, not a way around it');
    assert.equal(err.errorClass, null);
    return true;
  });
});

test('python: a hung program is killed at the timeout, tree and all', { skip: pySkip }, async () => {
  const { meta, file } = pyScript(`
import time

def main(api):
    time.sleep(120)
    return {'summary': 'never'}
`);
  await assert.rejects(runScriptExecution(ctxFor({ meta, file, timeoutMs: 1500 })), (err) => {
    assert.match(err.message, /^script "pyCard" timed out after 2 s$/);
    assert.equal(err.errorClass, null);
    return true;
  });
});

test('python: no interpreter is the one §7 sentence, on every host', async () => {
  const prev = process.env.WORCA_PYTHON;
  process.env.WORCA_PYTHON = join(tmp('worca-sr-nopy-'), 'not-a-python');
  resetPythonProbe();
  try {
    const { meta, file } = pyScript('def main(api):\n    return {}\n');
    await assert.rejects(runScriptExecution(ctxFor({ meta, file })), (err) => {
      assert.equal(err.message, 'script "pyCard" needs python 3.8 or newer — none found on this machine (set WORCA_PYTHON)');
      assert.equal(err.errorClass, null);
      return true;
    });
  } finally {
    if (prev === undefined) delete process.env.WORCA_PYTHON; else process.env.WORCA_PYTHON = prev;
    resetPythonProbe();
  }
});

test('python: a missing program file is named before anything is spawned', async () => {
  const meta = { key: 'pyCard', displayName: 'Py card', runtime: 'python' };
  await assert.rejects(runScriptExecution(ctxFor({ meta, file: join(tmp('worca-sr-gone-'), 'gone.py') })),
    /^Error: script "pyCard": program file not found: .*gone\.py$/);
});

test('an unknown runtime is still refused by name', async () => {
  const meta = { key: 'pyCard', displayName: 'Py card', runtime: 'ruby' };
  await assert.rejects(runScriptExecution(ctxFor({ meta, file: null })), /^Error: script "pyCard": unknown runtime "ruby"$/);
});

// ---- wired params (the engine `params` port) ----
const wiredMeta = () => nodeMeta({ params: [{ id: 'ref', type: 'string' }, { id: 'stat', type: 'boolean', default: false }, { id: 'cmd', type: 'command' }] });
const WIRED_PORTS = { ...PORTS, inputs: [PORTS.inputs[0], PORTS.inputs[1], PARAMS_PORT, AWAIT_PORT] };
const echoProgram = () => writeProgram(tmp('worca-sr-prog-'), `
import { writeFileSync } from 'node:fs';
export default async function ({ inputs, outputs, params }) {
  writeFileSync(outputs.log.path, '# ok\\n');
  return { summary: 'ok', outputs: { report: { value: { params, inputs: Object.keys(inputs) } } }, verdict: { issues: [] } };
}\n`);
function wiredCtx(wire, over = {}) {
  const ctx = ctxFor({ meta: wiredMeta(), file: echoProgram(), params: { ref: 'master', stat: false, cmd: 'x' }, ports: WIRED_PORTS, ...over });
  ctx.script.paramsPort = true;
  ctx.bindings = { ...ctx.bindings, params: wire };
  return ctx;
}
const wireFile = (text) => { const f = join(tmp('worca-sr-wire-'), 'branches.json'); writeFileSync(f, text); return f; };

test('wired params: the json on the engine port overlays the card params BEFORE the envelope, and is not an input', async () => {
  const ctx = wiredCtx({ seq: 3, type: 'json', path: '/nowhere/unused.json', value: { ref: 'dev', stat: true } });
  const res = await runScriptExecution(ctx);
  assert.deepEqual(res.outputs.report.value, { params: { ref: 'dev', stat: true, cmd: 'x' }, inputs: ['done', 'planMd'] });
  const audit = JSON.parse(readFileSync(res.envelopePath, 'utf8'));
  assert.deepEqual(audit.params, { ref: 'dev', stat: true, cmd: 'x' });
  assert.deepEqual(audit.wiredParams, ['ref', 'stat'], 'the audit copy says which params the wire set');
  assert.equal('params' in audit.inputs, false);
  assert.equal(audit.apiVersion, 1);
  const shellEnv = envForShell(audit, {});
  assert.equal(shellEnv.WORCA_PARAM_REF, 'dev', 'a shell script reads the wired value as a plain env var');
  assert.equal('WORCA_IN_PARAMS' in shellEnv, false);
});

test('wired params: an agent-written file is read from its path — BOM and CRLF tolerated — and an unwired port changes nothing', async () => {
  const file = wireFile('\uFEFF{\r\n  "ref": "release/2.4",\r\n  "stat": null\r\n}\r\n');
  const res = await runScriptExecution(wiredCtx({ seq: 3, type: 'json', path: file }));
  assert.deepEqual(res.outputs.report.value.params, { ref: 'release/2.4', stat: false, cmd: 'x' }, 'null falls through to the card');
  const unwired = wiredCtx(undefined);
  delete unwired.bindings.params;
  const r2 = await runScriptExecution(unwired);
  assert.deepEqual(r2.outputs.report.value.params, { ref: 'master', stat: false, cmd: 'x' });
  assert.deepEqual(JSON.parse(readFileSync(r2.envelopePath, 'utf8')).wiredParams, []);
});

test('wired params: every bad payload refuses the execution by name and spawns nothing', async () => {
  const refuses = async (wire, re) => {
    const ctx = wiredCtx(wire);
    await assert.rejects(runScriptExecution(ctx), (e) => re.test(e.message) && e.errorClass === null);
    assert.equal(existsSync(ctx.outputs.log.path), false, 'the program never ran');
  };
  await refuses({ seq: 1, type: 'json', path: wireFile('not json') }, /^script "runTests": wired params — .*is not valid JSON/);
  await refuses({ seq: 1, type: 'json', path: wireFile('["ref"]') }, /wired params — must be a JSON object$/);
  await refuses({ seq: 1, type: 'json', value: { cmd: 'rm -rf /' } }, /wired params — param 'cmd' is a command param — only the card itself may set it$/);
  await refuses({ seq: 1, type: 'json', value: { nope: 1, stat: 'yes' } }, /wired params — unknown param 'nope' — a wire can set ref, stat; param 'stat': must be true or false/);
  await refuses({ seq: 1, type: 'json', path: join(tmp('worca-sr-wire-'), 'missing.json') }, /wired params — cannot read /);
  await refuses({ seq: 1, type: 'json', path: wireFile(JSON.stringify({ ref: 'x'.repeat(70 * 1024) })) }, /wired params — .* is larger than 64 KiB$/);
});

test('wired params: a script that DECLARES its own `params` input keeps it, and a mock run never reads the wire', async () => {
  const own = { ...PORTS, inputs: [PORTS.inputs[0], { id: 'params', type: 'json', required: false }, AWAIT_PORT] };
  const ctx = ctxFor({ meta: wiredMeta(), params: { ref: 'master' }, ports: own, bindings: { done: { seq: 1, type: 'void' }, params: { seq: 2, type: 'json', path: '/abs/own.json' } } });
  const env = buildEnvelope(ctx);                     // ctx.script.paramsPort is unset: hasParamsPort said no (the id is taken)
  assert.deepEqual(env.inputs.params, { type: 'json', path: '/abs/own.json', fresh: false });
  assert.deepEqual(env.params, { ref: 'master' });
  assert.deepEqual(await resolveWiredParams(ctx), { params: { ref: 'master' }, wired: [] });
  const ports = { ...WIRED_PORTS, outputs: PORTS.outputs.filter((o) => o.id !== 'report') };
  const mocked = wiredCtx({ seq: 1, type: 'json', value: ['garbage'] }, { ports, claudeOpts: { mock: true }, mock: { summary: 'mocked', outputs: { log: { text: '# m' } } } });
  assert.equal((await runScriptExecution(mocked)).summary, 'mocked', 'upstream mock JSON is arbitrary: a mock run spawns nothing and validates nothing');
});

test('wired params: nothing bound still enforces a required param V22 deferred to the wire; a mock run downgrades a refused payload to a warning', async () => {
  const required = nodeMeta({ params: [{ id: 'ref', type: 'string', required: true }] });
  const bare = wiredCtx(undefined, { meta: required, params: {} });
  delete bare.bindings.params;                       // a loop wire is excused from the first-run barrier: the card can run before it fires
  await assert.rejects(runScriptExecution(bare), /wired params — missing required param 'ref'$/);
  assert.equal(existsSync(bare.outputs.log.path), false, 'the program never ran');
  await assert.rejects(resolveWiredParams(wiredCtx({ seq: 1, type: 'json' })), /wired params — the wire carried no JSON$/);
  // A card with no mock of its own runs for REAL on a mock run, fed by the mock agent's generic artifact.
  const events = [];
  const res = await runScriptExecution(wiredCtx({ seq: 1, type: 'json', value: { mock: true, note: 'generic artifact' } }, { claudeOpts: { mock: true }, events }));
  assert.deepEqual(res.outputs.report.value.params, { ref: 'master', stat: false, cmd: 'x' }, "the card's own params stand");
  assert.deepEqual(res.warnings, ["script \"runTests\": wired params — unknown param 'mock' — a wire can set ref, stat; unknown param 'note' — a wire can set ref, stat — ignored on a mock run; the card's own params apply"]);
  assert.deepEqual(JSON.parse(readFileSync(res.envelopePath, 'utf8')).wiredParams, []);
  const honoured = await runScriptExecution(wiredCtx({ seq: 1, type: 'json', value: { ref: 'dev' } }, { claudeOpts: { mock: true } }));
  assert.equal(honoured.outputs.report.value.params.ref, 'dev', 'a VALID payload (an upstream script ran for real) is honoured on a mock run too');
});
