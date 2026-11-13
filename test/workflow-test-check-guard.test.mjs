// test/workflow-test-check-guard.test.mjs — workflow tests 3a, final review I1 and I3: a try's checks run under the try's
// outward guard (D56). A Library script check (the script bench) gets the stand-ins first on PATH, git with no sign-in and
// no forge, publish or registry token; and the guard never fails open: with no log file (a try whose run folder is gone)
// the setup and command checks and the script checks are still guarded, writing to a scratch log.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { userScriptsDir } from '../src/core/script-registry.mjs';
import { runScriptCheck, runCommandCheck, checkTry } from '../src/core/workflow-tests/result.mjs';
import { tryShellEnv } from '../src/core/workflow-tests/shell-step.mjs';
import { standInDir, scratchTryLog } from '../src/core/workflow-tests/try-guard-env.mjs';
import { TRY_GUARD_LOG_ENV } from '../src/core/workflow-tests/try-guard.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useTempHome(after);
const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

const TOKENS = { GH_TOKEN: 'f1', GITLAB_TOKEN: 'f2', NPM_TOKEN: 'r1', NODE_AUTH_TOKEN: 'r2', CARGO_REGISTRY_TOKEN: 'p1', TWINE_PASSWORD: 'p2' };
function withTokens(fn) {
  const saved = Object.fromEntries(Object.keys(TOKENS).map((k) => [k, process.env[k]]));
  Object.assign(process.env, TOKENS);
  const restore = () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  return Promise.resolve().then(fn).finally(restore);
}

/** A Library node script that writes what its env looks like into its cwd (the try's checkout). */
function writeEnvProbe(key) {
  const dir = userScriptsDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.mjs`), [
    "import { writeFileSync } from 'node:fs';",
    "import { join, delimiter } from 'node:path';",
    'export default async function ({ ctx }) {',
    "  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH');",
    `  const keys = ${JSON.stringify(Object.keys(TOKENS))};`,
    "  writeFileSync(join(ctx.cwd, 'env.json'), JSON.stringify({ first: String(process.env[pathKey] || '').split(delimiter)[0],",
    "    tokens: keys.filter((k) => process.env[k] !== undefined), ssh: process.env.GIT_SSH_COMMAND || null,",
    `    log: process.env.${TRY_GUARD_LOG_ENV} || null, prompt: process.env.GIT_TERMINAL_PROMPT || null }));`,
    "  return { verdict: { issues: [], summary: 'clean' }, summary: 'ok' };",   // a clean verdict: a check that returns none is not met (U-T10)
    '}',
    '',
  ].join('\n'));
  writeFileSync(join(dir, `${key}.meta.json`), JSON.stringify({
    key, metaVersion: 2, displayName: key, runtime: 'node', file: `${key}.mjs`, order: 900, inputs: [], outputs: [],
    verdict: { filename: `${key}-cycle{cycle}.json` },
  }, null, 2) + '\n');
}

test('I1: a Library check on a project try runs under the try guard (stand-ins first, no token, git with no sign-in)', async () => {
  writeEnvProbe('envProbe');
  const checkout = tmp('worca-cc-wftcg-co-');
  const logFile = join(tmp('worca-cc-wftcg-pd-'), 'connector-calls.ndjson');
  await withTokens(async () => {
    const r = await runScriptCheck({ kind: 'script', key: 'envProbe', params: {} }, { cwdDir: checkout, logFile });
    assert.equal(r.met, true, JSON.stringify(r));
  });
  const seen = JSON.parse(readFileSync(join(checkout, 'env.json'), 'utf8'));
  assert.equal(seen.first.toLowerCase(), standInDir(worcaHome()).toLowerCase(), 'the gh / glab / az stand-ins come first on PATH');
  assert.deepEqual(seen.tokens, [], 'no forge, publish or registry token');
  assert.equal(seen.ssh, 'exit 1 #');
  assert.equal(seen.prompt, '0');
  assert.equal(seen.log, logFile, 'what the guard records goes to the try\'s log');
});

test('I3: a Library check with no log file is still guarded (a scratch log)', async () => {
  writeEnvProbe('envProbe2');
  const checkout = tmp('worca-cc-wftcg-co2-');
  await withTokens(async () => {
    const r = await runScriptCheck({ kind: 'script', key: 'envProbe2', params: {} }, { cwdDir: checkout });
    assert.equal(r.met, true, JSON.stringify(r));
  });
  const seen = JSON.parse(readFileSync(join(checkout, 'env.json'), 'utf8'));
  assert.deepEqual(seen.tokens, []);
  assert.equal(seen.log, scratchTryLog(worcaHome()));
});

test('I1: checkTry hands the try\'s log file to the script check', async () => {
  const got = [];
  const outcome = { pipelineId: null, facts: { status: 'done', costUsd: 0, help: [], sentBack: 0 }, text: null, files: [],
    project: { checkoutDir: tmp('worca-cc-wftcg-co3-') }, logFile: '/x/connector-calls.ndjson' };
  await checkTry({ basics: {}, checks: [{ id: 'c1', kind: 'script', key: 'k' }] }, outcome,
    { runScript: async (_c, opts) => { got.push(opts); return { met: true, value: 'Met' }; } });
  assert.equal(got[0].logFile, '/x/connector-calls.ndjson');
  assert.equal(got[0].cwdDir, outcome.project.checkoutDir);
});

test('I3: the shell env of a try is always guarded; no log file means a scratch log, never no guard', async () => {
  await withTokens(async () => {
    const env = tryShellEnv();
    assert.deepEqual(Object.keys(TOKENS).filter((k) => env[k] !== undefined), []);
    assert.equal(env.GIT_SSH_COMMAND, 'exit 1 #');
    assert.equal(env[TRY_GUARD_LOG_ENV], scratchTryLog(worcaHome()));
    const setup = tryShellEnv({ keepRegistryAuth: true });
    assert.deepEqual([setup.NPM_TOKEN, setup.GH_TOKEN], ['r1', undefined], 'the setup keeps only the registry tokens');
    let seen = null;
    await runCommandCheck({ cmd: 'x', timeoutMin: 1 }, { cwd: tmp('worca-cc-wftcg-cmd-'), logFile: null,
      run: async ({ env: e }) => { seen = e; return { ok: true, tail: '' }; } });
    assert.equal(seen.NPM_TOKEN, undefined, 'a command check whose try has no run folder is still guarded');
    assert.equal(seen[TRY_GUARD_LOG_ENV], scratchTryLog(worcaHome()));
  });
});

test('final review I2: the safe git settings win over a caller\'s -c and reach git children through the env', async () => {
  const { withSafeGitArgs, withSafeGitConfig, tryGitEnv, noHooksDir } = await import('../src/core/workflow-tests/try-guard-env.mjs');
  const dir = noHooksDir(worcaHome()).split(String.fromCharCode(92)).join('/');
  assert.deepEqual(withSafeGitArgs(['-c', 'core.hooksPath=', 'commit', '-m', 'x']),
    ['-c', 'core.hooksPath=', '-c', `core.hooksPath=${dir}`, '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', 'commit', '-m', 'x'],
    'after the caller\'s own -c pairs: the last one wins');
  const env = withSafeGitConfig({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: 'c' });
  assert.deepEqual([env.GIT_CONFIG_COUNT, env.GIT_CONFIG_KEY_0, env.GIT_CONFIG_KEY_1, env.GIT_CONFIG_VALUE_1, env.GIT_CONFIG_KEY_2],
    ['4', 'a.b', 'core.hooksPath', dir, 'core.fsmonitor']);
  await withTokens(async () => {
    const t = tryGitEnv({ logFile: null });
    assert.deepEqual(Object.keys(TOKENS).filter((k) => t[k] !== undefined), [], 'Worca\'s git in a try carries no token');
    assert.equal(t[TRY_GUARD_LOG_ENV], scratchTryLog(worcaHome()));
    const keys = Object.keys(t).filter((k) => /^GIT_CONFIG_KEY_/.test(k)).map((k) => t[k]);
    assert.ok(keys.includes('credential.helper') && keys.includes('core.hooksPath') && keys.includes('core.fsmonitor'), keys.join(','));
  });
});

test('final review I2: the harness gives its git the try env only on a try (opts or the persisted row)', async () => {
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const dir = tmp('worca-cc-wftcg-h-');
  const normal = createOrchestrator({ projectDir: dir, claude: { mock: true } });
  assert.equal(normal._tryGitEnv(), null, 'a normal run: unchanged');
  assert.equal(normal._isTestTry(), false);
  const tryRun = createOrchestrator({ projectDir: dir, claude: { mock: true }, workflowTest: true });
  assert.equal(tryRun._tryGitEnv().GIT_SSH_COMMAND, 'exit 1 #');
  const stopped = createOrchestrator({ projectDir: dir, claude: { mock: true } });
  stopped.resumeOpts = { row: { id: 'abcd1234', is_test: 1 } };   // what stopPausedRun hands a stopped paused try
  assert.equal(stopped._isTestTry(), true);
  assert.ok(stopped._tryGitEnv());
});

test('round 2 (M5): the verdict of a command check names its kind and command, so the page sets it in code without reading the label', async () => {
  const outcome = { pipelineId: null, facts: { status: 'done', costUsd: 0, help: [], sentBack: 0 }, text: null, files: [],
    project: { checkoutDir: tmp('worca-cc-wftcg-co4-') }, logFile: null };
  const v = await checkTry({ basics: {}, checks: [{ id: 'c_1', kind: 'command', cmd: 'npm test', timeoutMin: 1 }] }, outcome,
    { runCommand: async () => ({ met: true, value: 'Met' }) });
  assert.deepEqual([v.checks[0].kind, v.checks[0].cmd, v.checks[0].label], ['command', 'npm test', 'The command npm test passes']);
});
