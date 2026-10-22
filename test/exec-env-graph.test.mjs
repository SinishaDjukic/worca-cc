// test/exec-env-graph.test.mjs — the code graph of a remote run is built INSIDE the sandbox (docs/e2b.md "How a run
// works"): RemoteExecEnv.buildCodeGraph against the loopback fake, and the harness's side of it (no host build, no
// upload, the instruction only once the sandbox build succeeded).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeE2b } from '../src/core/exec-env/e2b-fake.mjs';
import { E2bExecEnv } from '../src/core/exec-env/e2b-env.mjs';
import { worktreeGraphInstruction } from '../src/core/preflight.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { scratchDirs, fixture as makeFixture, makeEnvOpts } from './helpers/e2b-fixture.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'e2b mode is POSIX-only' : false };
useTempHome(after, 'worca-graph-home-');
const { tmp, cleanup } = scratchDirs(); after(cleanup);

/** A PATH whose `graphify` runs `body` (a sh script; "$2" is the dir graphify update gets). No other graphify. */
function graphifyPath(body) {
  const bin = tmp('worca-graph-bin-');
  writeFileSync(join(bin, 'graphify'), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, 'graphify'), 0o755);
  return `${bin}:/usr/bin:/bin`;
}
async function withPath(path, fn) {
  const prev = process.env.PATH; process.env.PATH = path;
  try { return await fn(); } finally { process.env.PATH = prev; }
}
async function started() {
  const f = makeFixture(tmp); const sdk = createFakeE2b({ root: tmp('worca-e2b-root-') });
  const env = new E2bExecEnv(makeEnvOpts(tmp, sdk, f)); await env.start();
  return { f, env };
}

test('buildCodeGraph runs graphify update in the sandbox worktree; the graph never comes home', POSIX, async () => {
  const { f, env } = await started();
  try {
    const r = await withPath(graphifyPath('[ "$1" = update ] || exit 9; mkdir -p "$2/graphify-out" && echo "{}" > "$2/graphify-out/graph.json"'),
      () => env.buildCodeGraph({ timeoutMs: 30_000 }));
    assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(Number.isFinite(r.ms));
    const sbRepo = env.sb(f.repo);
    assert.equal(readFileSync(join(sbRepo, 'graphify-out', 'graph.json'), 'utf8'), '{}\n');
    assert.equal(readFileSync(join(sbRepo, 'graphify-out', '.gitignore'), 'utf8'), '*\n', 'the output ignores itself');
    await env.beforeSpawn(); await env.afterSpawn();
    assert.equal(existsSync(join(f.repo, 'graphify-out')), false, 'no patch and no download carries the graph');
  } finally { await env.close('test'); }
});

test('buildCodeGraph without graphify in the template, or a failing build, reports why and never throws', POSIX, async () => {
  const { env } = await started();
  try {
    let r = await withPath('/usr/bin:/bin', () => env.buildCodeGraph({ timeoutMs: 30_000 }));
    assert.equal(r.ok, false); assert.match(r.error, /graphify is not installed in this template/);
    r = await withPath(graphifyPath('echo kaboom >&2; exit 1'), () => env.buildCodeGraph({ timeoutMs: 30_000 }));
    assert.equal(r.ok, false); assert.match(r.error, /kaboom/);
  } finally { await env.close('test'); }
});

// --- the harness: a remote run builds no graph on the host and asks the sandbox instead ---

function remoteOrch({ mock = false, codeGraph } = {}) {
  const dir = tmp('worca-graph-proj-');
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', claude: { mock } });
  orch.execEnvKind = 'e2b';
  orch.workDir = tmp('worca-graph-work-');
  orch.state.tools = { kind: 'cli' };
  if (codeGraph === false) orch.state.stepper = { codeGraph: false };
  orch.pipeline = { dir, id: 'p1' };
  orch.members = [{ projectKey: 'proj-1', projectDir: dir }];
  const logs = []; orch._log = (source, level, text) => logs.push({ source, level, text });
  return { orch, logs };
}

test('a remote run spawns no host graphify and gives no instruction until the sandbox has a graph', POSIX, async () => {
  const marker = join(tmp('worca-graph-mark-'), 'ran');
  const { orch } = remoteOrch();
  orch.toolInstruction = 'SENTINEL';
  await withPath(graphifyPath(`touch "${marker}"`), () => orch._buildWorktreeGraph());
  assert.equal(existsSync(marker), false, 'graphify never ran on the host');
  assert.equal(orch.toolInstruction, '');
  assert.equal(orch._execEnvOpts({}, { name: 'worca-agent', rebuild: null }).injected.includes('graphify-out'), false, 'nothing to upload');
});

test('_buildSandboxGraph: success sets the instruction and logs the time; a failure warns and leaves none', async () => {
  let { orch, logs } = remoteOrch();
  const calls = [];
  orch.execEnv = { buildCodeGraph: async (o) => { calls.push(o); return { ok: true, ms: 12_345 }; } };
  await orch._buildSandboxGraph();
  assert.equal(orch.toolInstruction, worktreeGraphInstruction());
  assert.equal(calls[0].timeoutMs, orch.graphBuildTimeoutMs);
  assert.ok(logs.some((l) => l.source === 'graph' && l.level === 'info' && /graph built in the sandbox in 12\.3 s/.test(l.text)), JSON.stringify(logs));

  ({ orch, logs } = remoteOrch());
  orch.toolInstruction = 'SENTINEL';
  orch.execEnv = { buildCodeGraph: async () => ({ ok: false, ms: 5, error: 'graphify is not installed in this template' }) };
  await orch._buildSandboxGraph();
  assert.equal(orch.toolInstruction, '');
  assert.ok(logs.some((l) => l.level === 'warn' && /not installed in this template.*without graph grounding/.test(l.text)), JSON.stringify(logs));
});

test('_buildSandboxGraph is skipped for mock runs and codeGraph:false workflows', async () => {
  for (const o of [{ mock: true }, { codeGraph: false }]) {
    const { orch } = remoteOrch(o);
    let called = false;
    orch.execEnv = { buildCodeGraph: async () => { called = true; return { ok: true, ms: 1 }; } };
    await orch._buildSandboxGraph();
    assert.equal(called, false, JSON.stringify(o));
  }
});
