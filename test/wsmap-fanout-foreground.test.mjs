// test/wsmap-fanout-foreground.test.mjs
// M3 (wsmap fix wave): Claude Code runs an Agent call in the BACKGROUND unless background tasks are
// off, and a background dispatch escapes CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY — so the scan's cap of 8
// investigators (D9) holds only when its two fan-out nodes (survey: workspaceScanner, usage:
// workspaceUsageMapper) also spawn with CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 (fanOutSpawnEnv ->
// runOpts.spawnEnv -> runClaude -> the child). Every other fan-out node keeps exactly the cap, and a node
// that cannot fan out gets nothing. With the variable set the CLI drops `run_in_background` from the
// Agent tool's schema, so the scan bodies must not name that parameter.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { _runOptsForTests as runOpts, fanOutSpawnEnv } from '../src/core/phases.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { resolveGraph } from '../src/core/workflows.mjs';
import { loadAgentRegistry, DEFAULT_AGENTS_DIR } from '../src/core/agent-registry.mjs';

useTempHome(after);
// The host guard adds WORCA_HOST_PID and a --settings hook to every real spawn: off, so the dump below
// is about THIS variable only (host-guard-wiring.test.mjs covers the guard).
process.env.WORCA_HOST_GUARD = '0';
const FLAG = 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS';
// A developer shell may export either variable: start from neither (the tests that mean one set it).
delete process.env[FLAG];
delete process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY;
const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script (no .exe stand-in on Windows)' : false };

const dirs = [];
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 }))));
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-fg-')); dirs.push(d); return d; };
const CALL = { role: 'r', prompt: 'p', systemPrompt: 's', allowedTools: ['Read'] };
const CAP_ONLY = { CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: '8' };
const FOREGROUND = { CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: '8', [FLAG]: '1' };

test('fanOutSpawnEnv: only the scan\'s two fan-out nodes turn background tasks off; every other fan-out node keeps exactly the cap', () => {
  assert.deepEqual(fanOutSpawnEnv({ node: { fanOut: true, key: 'workspaceScanner' } }, {}), FOREGROUND);
  assert.deepEqual(fanOutSpawnEnv({ node: { fanOut: true, key: 'workspaceUsageMapper' } }, {}), FOREGROUND);
  assert.deepEqual(fanOutSpawnEnv({ node: { fanOut: true, key: 'workspaceScanner' } }, { [FLAG]: '0', CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: '4' }),
    { CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: '4', [FLAG]: '1' }, 'an ambient 0 never turns them back on; a lower cap stays');
  for (const key of ['implementer', 'reviewer', 'refiner', 'planner', 'workspaceReviewer', 'workspaceSynthesizer', undefined]) {
    assert.deepEqual(fanOutSpawnEnv({ node: { fanOut: true, key } }, {}), CAP_ONLY, String(key));
  }
  // A workspace variant (`scope: 'workspace-only'`, `workspaceVariantOf`) runs under its own key; _execCtx hands its meta.
  assert.deepEqual(fanOutSpawnEnv({ node: { fanOut: true, key: 'myScanner' }, meta: { workspaceVariantOf: 'workspaceScanner' } }, {}), FOREGROUND, 'a variant of the scanner');
  assert.deepEqual(fanOutSpawnEnv({ node: { fanOut: true, key: 'myUsage' }, meta: { workspaceVariantOf: 'workspaceUsageMapper' } }, {}), FOREGROUND, 'a variant of the usage mapper');
  assert.deepEqual(fanOutSpawnEnv({ node: { fanOut: true, key: 'myImpl' }, meta: { workspaceVariantOf: 'implementer' } }, {}), CAP_ONLY, 'a variant of any other agent');
  assert.deepEqual(fanOutSpawnEnv({ fanOut: true }, {}), CAP_ONLY, 'a node-less ctx (the clarify pre-step) has no scan key');
  assert.equal(fanOutSpawnEnv({ node: { fanOut: false, key: 'workspaceScanner' } }, {}), undefined, 'no fan-out, nothing');
  assert.equal(fanOutSpawnEnv(null, {}), undefined);
});

test('the scan: survey and usage spawn with background tasks off, the synthesizer (no fan-out) with nothing', async () => {
  const projectDir = await tmp();
  const r = await resolveGraph(projectDir, 'wf_workspace_scan', loadAgentRegistry(), DEFAULT_AGENTS_DIR, { isWorkspace: true });
  const spawnEnvOf = (id) => runOpts({ projectDir, claudeOpts: {}, node: r.nodes[id] }, CALL).spawnEnv;
  assert.deepEqual(spawnEnvOf('n_scan'), FOREGROUND);
  assert.deepEqual(spawnEnvOf('n_usage'), FOREGROUND);
  assert.equal(spawnEnvOf('n_synth'), undefined);
});

test('every fan-out node of the default workflow keeps background tasks: its spawn env is the cap alone', async () => {
  const projectDir = await tmp();
  for (const isWorkspace of [false, true]) {
    const r = await resolveGraph(projectDir, 'wf_default', loadAgentRegistry(), DEFAULT_AGENTS_DIR, { isWorkspace });
    const fanOut = Object.values(r.nodes).filter((n) => n.kind === 'agent' && n.fanOut);
    assert.ok(fanOut.some((n) => n.key === 'implementer'), 'the implementer fans out');
    for (const node of fanOut) assert.deepEqual(runOpts({ projectDir, claudeOpts: {}, node }, CALL).spawnEnv, CAP_ONLY, `${node.key} (workspace: ${isWorkspace})`);
  }
});

/** runOpts(ctx) -> runClaude against a fake `claude` that dumps its env; the child's FLAG line ('' when
 *  unset), never the whole dump (a host's tokens live there). `ambient` = the parent's own FLAG. */
async function childFlag(node, { ambient, claudeOpts = {} } = {}) {
  const dir = await tmp();
  const out = join(dir, 'env.txt');
  const bin = join(dir, 'fake-claude-env.sh');
  await writeFile(bin, `#!/bin/sh\nenv > ${JSON.stringify(out)}\nexit 0\n`, 'utf8');
  await chmod(bin, 0o755);
  const prev = { mock: process.env.WORCA_MOCK, flag: process.env[FLAG] };
  delete process.env.WORCA_MOCK;                                   // must reach runReal, not runMock
  if (ambient === undefined) delete process.env[FLAG]; else process.env[FLAG] = ambient;
  try {
    await runClaude({ ...runOpts({ projectDir: dir, claudeOpts: { ...claudeOpts, bin }, node }, CALL), onEvent: () => {} });
  } finally {
    if (prev.mock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prev.mock;
    if (prev.flag === undefined) delete process.env[FLAG]; else process.env[FLAG] = prev.flag;
  }
  return (await readFile(out, 'utf8')).split(/\r?\n/).filter((l) => l.startsWith(`${FLAG}=`)).join('\n');
}

test('end to end: the survey node\'s child runs with background tasks off — over an ambient 0 and under env scrub; a fan-out implementer and a plain node never', POSIX_SHIM, async () => {
  const scanner = { fanOut: true, key: 'workspaceScanner' };
  assert.equal(await childFlag(scanner), `${FLAG}=1`);
  assert.equal(await childFlag(scanner, { ambient: '0' }), `${FLAG}=1`, 'the run env replaces the ambient value');
  assert.equal(await childFlag(scanner, { claudeOpts: { envScrub: true, envAllowlist: [] } }), `${FLAG}=1`, 'it survives the scrub');
  assert.equal(await childFlag({ fanOut: true, key: 'implementer' }), '', 'a fan-out implementer\'s child never gets the variable');
  assert.equal(await childFlag({ fanOut: false }), '', 'a plain node\'s child never gets the variable');
});

test('the scan bodies: dispatch normally and wait, and never name the schema-less run_in_background', () => {
  const AGENTS = fileURLToPath(new URL('../agents/', import.meta.url));
  for (const file of ['worca-cc-workspace-scanner.md', 'worca-cc-workspace-usage-mapper.md']) {
    const body = readFileSync(join(AGENTS, file), 'utf8');
    assert.ok(body.includes('Dispatch normally and wait for every result'), file);
    assert.equal(body.includes('run_in_background'), false, `${file}: the CLI removes that parameter once background tasks are off`);
  }
});
