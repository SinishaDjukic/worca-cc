// test/workflow-test-try-guard-engines.test.mjs — workflow tests 3a, Task 5 (D56): the outward guard's env layers reach
// the agents of every engine, not only Claude. The fake CLI is this node itself: a NODE_OPTIONS --require preload records
// the env it was started with and exits before node loads the "script" (codex exec / goose run / opencode run), so the
// test runs on Windows as well as POSIX (the adapters' own fakes are POSIX shell scripts). The turn itself then fails
// (no stream): only the env matters here. Without tryGuard the env is the one a normal run gets.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { TRY_GUARD_LOG_ENV } from '../src/core/workflow-tests/try-guard.mjs';
import { standInDir } from '../src/core/workflow-tests/try-guard-env.mjs';
import { runCodexProcess } from '../src/core/engines/codex.mjs';
import { runGooseProcess } from '../src/core/engines/goose.mjs';
import { runOpencodeProcess } from '../src/core/engines/opencode.mjs';

let home, prevHome, prevOpts;
const fwd = (p) => p.replaceAll('\\', '/');
before(() => {
  home = mkdtempSync(join(tmpdir(), 'worca-cc-wftguard-eng-'));
  prevHome = process.env.WORCA_HOME;
  prevOpts = process.env.NODE_OPTIONS;
  _resetForTests();
  process.env.WORCA_HOME = home;
});
after(() => {
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  if (prevOpts === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = prevOpts;
  rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

/** Runs `run` with this node as the engine's CLI; returns the env the child was started with. */
async function childEnv(tag, run) {
  const dir = mkdtempSync(join(home, `${tag}-`));
  const rec = join(dir, 'env.json');
  const preload = join(dir, 'preload.cjs');
  writeFileSync(preload, `require('fs').writeFileSync(${JSON.stringify(rec)}, JSON.stringify(process.env)); process.exit(0);\n`);
  process.env.NODE_OPTIONS = `--require "${fwd(preload)}"`;
  try { await run({ cwd: dir, bin: process.execPath, onEvent: () => {} }).catch(() => null); } finally {
    if (prevOpts === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = prevOpts;
  }
  return JSON.parse(readFileSync(rec, 'utf8'));
}

const pathOf = (env) => env[Object.keys(env).find((k) => k.toUpperCase() === 'PATH')] || '';
const GUARD_KEYS = [TRY_GUARD_LOG_ENV, 'GCM_INTERACTIVE', 'GIT_SSH_COMMAND', 'GH_CONFIG_DIR', 'GLAB_CONFIG_DIR', 'AZURE_CONFIG_DIR'];

for (const [name, run] of [
  ['codex', (o) => runCodexProcess({ ...o, prompt: 'p', usageDir: join(o.cwd, 'usage') })],
  ['goose', (o) => runGooseProcess({ ...o, prompt: 'p', model: 'openai/m', scratchBase: join(o.cwd, 'scratch') })],
  ['opencode', (o) => runOpencodeProcess({ ...o, prompt: 'p', model: 'openai/m', scratchBase: join(o.cwd, 'scratch') })],
]) {
  test(`${name}: a try's agent gets the guard env (stand-ins first on PATH); a normal spawn does not`, async () => {
    const logFile = join(home, `${name}-calls.ndjson`);
    const tried = await childEnv(`${name}-try`, (o) => run({ ...o, tryGuard: { logFile } }));
    assert.equal(tried[TRY_GUARD_LOG_ENV], logFile);
    assert.equal(tried.GIT_TERMINAL_PROMPT, '0');
    assert.ok(pathOf(tried).startsWith(standInDir(worcaHome())), pathOf(tried).slice(0, 200));
    const plain = await childEnv(`${name}-plain`, (o) => run(o));
    for (const k of GUARD_KEYS) assert.equal(plain[k], process.env[k], `${k} on a normal spawn`);
    assert.ok(!pathOf(plain).includes(standInDir(worcaHome())), 'no stand-ins on a normal spawn');
    const plainNull = await childEnv(`${name}-null`, (o) => run({ ...o, tryGuard: null }));
    for (const k of GUARD_KEYS) assert.equal(plainNull[k], process.env[k], `${k} with tryGuard null`);
    assert.equal(pathOf(plainNull), pathOf(plain));
  });
}
