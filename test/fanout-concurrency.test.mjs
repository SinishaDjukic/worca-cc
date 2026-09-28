// test/fanout-concurrency.test.mjs
// D9 (wsmap spec): every fan-out node's spawn carries CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY — 8, or an
// operator's own LOWER value — the Claude Code batch limit the Agent tool runs under — through
// runOpts' `spawnEnv`, never through `modelEnv` (which stays exactly the catalog env). End to end:
// runOpts -> runClaude -> the child.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { _runOptsForTests as runOpts, fanOutSpawnEnv } from '../src/core/phases.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { LIMITS } from '../src/shared/workspace-map/limits.mjs';

useTempHome(after);
// The host guard adds WORCA_HOST_PID and a --settings hook to every real spawn; pin it off so the
// env dump below is about THIS feature only (host-guard-wiring.test.mjs covers the guard).
process.env.WORCA_HOST_GUARD = '0';
// runOpts reads the parent env's own cap (min(8, ambient)): start from none, so a developer shell that
// exports one cannot change what these tests see (the tests that mean an ambient value set it).
delete process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY;
const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script (no .exe stand-in on Windows)' : false };

const dirs = [];
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 }))));
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-fanout-')); dirs.push(d); return d; };

const CALL = { role: 'r', prompt: 'p', systemPrompt: 's', allowedTools: ['Read'] };
const CAP = { CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: '8' };

test('the cap is LIMITS.INVESTIGATOR_CONCURRENCY — 8', () => {
  assert.equal(LIMITS.INVESTIGATOR_CONCURRENCY, 8);
  assert.deepEqual(fanOutSpawnEnv({ node: { fanOut: true } }, {}), CAP);
  assert.equal(fanOutSpawnEnv(null, {}), undefined);
});

test('the cap never exceeds 8 but keeps an operator\'s lower ambient value (min(8, ambient))', () => {
  const fan = { node: { fanOut: true } };
  const capWith = (v) => fanOutSpawnEnv(fan, { CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: v });
  assert.deepEqual(capWith('4'), { CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: '4' });
  assert.deepEqual(capWith(' 3 '), { CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: '3' });
  assert.deepEqual(capWith('8'), CAP);
  assert.deepEqual(capWith('20'), CAP, 'a higher ambient value never raises the cap');
  for (const bad of ['garbage', '0', '-3', '2.5', '1e3', '', '   ']) assert.deepEqual(capWith(bad), CAP, JSON.stringify(bad));
  assert.deepEqual(fanOutSpawnEnv(fan, {}), CAP, 'no ambient value');
  assert.equal(fanOutSpawnEnv({ node: { fanOut: false } }, { CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: '4' }), undefined,
    'a plain node never gets the variable');
});

test('runOpts: spawnEnv exactly for fan-out nodes; modelEnv never carries the cap', async () => {
  const base = { projectDir: await tmp(), claudeOpts: {} };
  assert.deepEqual(runOpts({ ...base, node: { fanOut: true } }, CALL).spawnEnv, CAP);
  assert.equal(runOpts({ ...base, node: { fanOut: false } }, CALL).spawnEnv, undefined);
  assert.equal(runOpts({ ...base, node: {} }, CALL).spawnEnv, undefined);
  assert.equal(runOpts({ ...base, fanOut: true, node: { fanOut: false } }, CALL).spawnEnv, undefined, 'a present node wins');
  assert.deepEqual(runOpts({ ...base, fanOut: true }, CALL).spawnEnv, CAP, 'a node-less ctx carries its own fanOut');
  assert.equal(runOpts({ ...base, node: { fanOut: true } }, CALL).modelEnv, undefined, 'the cap never rides modelEnv');
});

/** runOpts(ctx) -> runClaude against a fake `claude` that dumps its env; returns the child's
 *  CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY line ('' when unset), never the whole dump. `ambient` is the
 *  parent's own CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY for the call (undefined = unset). */
async function childEnvOf(node, ambient) {
  const dir = await tmp();
  const out = join(dir, 'env.txt');
  const bin = join(dir, 'fake-claude-env.sh');
  await writeFile(bin, `#!/bin/sh\nenv > ${JSON.stringify(out)}\nexit 0\n`, 'utf8');
  await chmod(bin, 0o755);
  const prev = { mock: process.env.WORCA_MOCK, cap: process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY };
  delete process.env.WORCA_MOCK;                                   // must reach runReal, not runMock
  if (ambient === undefined) delete process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY;   // nothing to mistake for the cap
  else process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY = ambient;
  try {
    await runClaude({ ...runOpts({ projectDir: dir, claudeOpts: { bin }, node }, CALL), onEvent: () => {} });
  } finally {
    if (prev.mock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prev.mock;
    if (prev.cap === undefined) delete process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY;
    else process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY = prev.cap;
  }
  // Only the cap line leaves this helper: a failed assertion prints its value, and the child's whole
  // env can hold a host's tokens.
  return (await readFile(out, 'utf8')).split(/\r?\n/).filter((l) => l.startsWith('CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=')).join('\n');
}

test('end to end: a fan-out node\'s child runs with the cap, a plain node\'s child without it', POSIX_SHIM, async () => {
  assert.equal(await childEnvOf({ fanOut: true }), 'CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=8');
  assert.equal(await childEnvOf({ fanOut: false }), '', 'a plain node\'s child never gets the variable');
});

test('end to end: an operator\'s lower ambient cap reaches the child, a higher or garbage one becomes 8', POSIX_SHIM, async () => {
  assert.equal(await childEnvOf({ fanOut: true }, '4'), 'CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=4');
  assert.equal(await childEnvOf({ fanOut: true }, '20'), 'CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=8');
  assert.equal(await childEnvOf({ fanOut: true }, 'lots'), 'CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=8');
});
