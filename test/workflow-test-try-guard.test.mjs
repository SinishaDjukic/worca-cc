// test/workflow-test-try-guard.test.mjs — workflow tests 3a, Task 5 (D45, D56): nothing leaves a try. The hook denies and
// records a push, a forge CLI, a remote change, a publish and a web call that writes; the stand-ins answer "Not sent"; the
// git env cannot sign in; and every normal spawn stays byte-identical.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync, execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { guardDecision, NOT_SENT_TEXT, TRY_GUARD_LOG_ENV } from '../src/core/workflow-tests/try-guard.mjs';
import { TRY_GUARD_PATH, TRY_DENY, standInDir, withTryGuardEnv, withTryDeny, tryGuardHookEntry } from '../src/core/workflow-tests/try-guard-env.mjs';
import { guardCall } from '../src/core/workflow-tests/guard-calls.mjs';
import { NOT_SENT } from '../src/core/mcp/mock-connector.mjs';
import { shellArgv } from '../src/core/actions/spawn.mjs';
import { buildSettingsPayload, buildClaudeArgs } from '../src/core/engines/claude.mjs';
import { sentCall } from '../src/core/workflow-tests/connectors.mjs';
import { composeSpawnEnv } from '../src/core/engines/spawn.mjs';
import { _runOptsForTests as runOpts } from '../src/core/phases.mjs';
import { envForShell, buildEnvelope } from '../src/core/graph/script-runner.mjs';

let home;
const readLog = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
before(() => { home = mkdtempSync(join(tmpdir(), 'worca-cc-wftguard-')); _resetForTests(); process.env.WORCA_HOME = home; });
after(() => { _resetForTests(); delete process.env.WORCA_HOME; rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

test('what the hook stops, and what it lets through', () => {
  const hit = (c) => { const d = guardDecision(c); return d ? `${d.server}|${d.tool}|${d.readOnly}` : null; };
  assert.equal(hit('git push origin fix-482'), 'git|push|false');
  assert.equal(hit('git -C repo -c a=b push'), 'git|push|false');
  assert.equal(hit('cd x && FOO=1 git push'), 'git|push|false');
  assert.equal(hit('sh -c "git push origin main"'), 'git|push|false');
  assert.equal(hit('echo $(git push)'), 'git|push|false');
  assert.equal(hit('git remote add up https://example.com/x.git'), 'git|remote add|false');
  assert.equal(hit('gh pr create --title "Fix rounding" --base main'), 'GitHub CLI|pr create|false');
  assert.equal(hit('gh pr view 12'), 'GitHub CLI|pr view|true');
  assert.equal(hit('gh issue comment 482 --body "Fixed"'), 'GitHub CLI|issue comment|false');
  assert.equal(hit('glab mr create'), 'GitLab CLI|mr create|false');
  assert.equal(hit('az repos pr create --title T'), 'Azure CLI|repos pr|false');
  assert.equal(hit('npm publish'), 'npm|publish|false');
  assert.equal(hit('curl -X POST https://api.example.com/x'), 'web|request|false');
  assert.equal(hit('curl -d a=1 https://api.example.com/x'), 'web|request|false');
  assert.equal(hit('wget --post-data=a https://example.com'), 'web|request|false');
  for (const ok of ['git status', 'git commit -m "push it"', 'echo "git push"', 'npm test', 'npm ci', 'curl https://example.com', 'node test.mjs']) {
    assert.equal(guardDecision(ok), null, ok);
  }
  assert.equal(NOT_SENT_TEXT, NOT_SENT, 'the same words as the connector stand-ins');
});

test('the hook CLI denies and records; anything else passes; a malformed payload passes', () => {
  const log = join(home, 'calls-hook.ndjson');
  const env = { ...process.env, [TRY_GUARD_LOG_ENV]: log };
  const run = (payload) => spawnSync(process.execPath, [TRY_GUARD_PATH], { input: payload, env, encoding: 'utf8' });
  const denied = run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin fix-482' } }));
  assert.equal(denied.status, 2);
  assert.ok(denied.stderr.startsWith(NOT_SENT_TEXT), denied.stderr);
  const [entry] = readLog(log);
  assert.deepEqual([entry.server, entry.tool, entry.guard, entry.readOnly, entry.arguments.command], ['git', 'push', true, false, 'git push origin fix-482']);
  assert.deepEqual(entry.arguments.argv, ['origin', 'fix-482']);
  assert.equal(run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' } })).status, 0);
  assert.equal(run(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'x' } })).status, 0);
  assert.equal(run('not json').status, 0);
  assert.equal(readLog(log).length, 1);
});

test('the stand-ins come first on PATH, answer "Not sent" and are recorded (gh pr create)', () => {
  const log = join(home, 'calls-stand-in.ndjson');
  const env = withTryGuardEnv({ ...process.env }, { logFile: log }, { home });
  const keys = Object.keys(env).filter((k) => k.toUpperCase() === 'PATH');
  assert.equal(keys.length, 1, 'one PATH key, the env\'s own spelling');
  assert.ok(env[keys[0]].startsWith(standInDir(home)));
  const line = 'gh pr create --title "Fix rounding" --body "Totals round half up." --base main --head fix-482';
  const { file, args, verbatim } = shellArgv(line, process.platform, env);
  const r = spawnSync(file, args, { env, encoding: 'utf8', windowsVerbatimArguments: verbatim });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Not sent: this is a test\./);
  const [e] = readLog(log);
  assert.deepEqual([e.server, e.tool, e.guard], ['GitHub CLI', 'pr create', true]);
  const row = guardCall(e);
  assert.deepEqual([row.tool, row.noun, row.preview, row.cap], ['open a pull request', 'pull request', 'Open a pull request: Fix rounding', 'Full text · from fix-482 into main']);
  assert.equal(row.full, 'Title: Fix rounding\nTotals round half up.');
});

test('git in a try cannot sign in: the credential helper is reset, ssh fails fast, nothing is asked', async () => {
  // The control's own helper answers u/p. Any helper of the machine (Git Credential Manager on this laptop) is reset first,
  // so no sign-in window can open in a test.
  const env0 = { ...process.env, GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'credential.helper', GIT_CONFIG_VALUE_1: '!f() { echo username=u; echo password=p; }; f' };
  const env = withTryGuardEnv(env0, { logFile: join(home, 'calls-git.ndjson') }, { home });
  const helpers = execFileSync('git', ['config', '--get-all', 'credential.helper'], { env, encoding: 'utf8' }).split(/\r?\n/);
  assert.equal(helpers[helpers.length - 2], '', 'the last entry resets the list');
  const repo = mkdtempSync(join(tmpdir(), 'worca-cc-wftguard-repo-'));
  // Async on purpose: a spawnSync would block this process, and with it the test's own HTTP server.
  const gitAsync = (args, e) => new Promise((done) => execFile('git', args, { cwd: repo, env: e, timeout: 30000 },
    (err, _out, stderr) => done({ status: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stderr: String(stderr) })));
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: repo });
    assert.notEqual((await gitAsync(['push', 'ssh://git@127.0.0.1:1/x.git', 'HEAD'], env)).status, 0, 'ssh fails at once');
    let withAuth = 0;
    const srv = http.createServer((req, res) => {
      if (req.headers.authorization) withAuth += 1;
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' }); res.end();
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${srv.address().port}/x.git`;
    try {
      assert.notEqual((await gitAsync(['push', url, 'HEAD'], env)).status, 0);
      assert.equal(withAuth, 0, 'the guarded push sent no credentials');
      await gitAsync(['push', url, 'HEAD'], env0);
      assert.ok(withAuth > 0, "control: without the guard the helper's credentials are sent");
    } finally { await new Promise((r) => srv.close(r)); }
  } finally { rmSync(repo, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
});

test('the try settings: the hook beside the host guard, the deny list added; without tryGuard byte-identical', () => {
  const rules = { deny: ['Read(.env*)'] };
  assert.deepEqual(buildSettingsPayload(rules, { hostGuard: true }), buildSettingsPayload(rules, { hostGuard: true, tryGuard: null }));
  const p = buildSettingsPayload(rules, { hostGuard: true, tryGuard: { logFile: join(home, 'c.ndjson') } });
  const cmds = p.settings.hooks.PreToolUse.flatMap((h) => h.hooks.map((x) => x.command));
  assert.ok(cmds.some((c) => c.includes('try-guard.mjs')), JSON.stringify(cmds));
  assert.ok(cmds.some((c) => c.includes('host-guard.mjs')));
  assert.deepEqual(p.settings.permissions.deny, [...new Set(['Read(.env*)', ...TRY_DENY])]);
  assert.deepEqual(withTryDeny(null).deny, [...TRY_DENY]);
  assert.equal(tryGuardHookEntry().matcher, 'Bash');
});

test('the spawn env and the run options: the guard only for a try', () => {
  assert.deepEqual(composeSpawnEnv({}).env, composeSpawnEnv({ tryGuard: null }).env);
  const env = composeSpawnEnv({ tryGuard: { logFile: join(home, 'c.ndjson') } }).env;
  assert.equal(env[TRY_GUARD_LOG_ENV], join(home, 'c.ndjson'));
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  const base = { claudeOpts: {}, projectDir: home };
  assert.equal('tryGuard' in runOpts(base, { role: 'r', prompt: 'p', systemPrompt: 's', allowedTools: [] }), false);
  assert.deepEqual(runOpts({ ...base, tryGuard: { logFile: 'x' } }, { role: 'r', prompt: 'p', systemPrompt: 's', allowedTools: [] }).tryGuard, { logFile: 'x' });
});

test('a script step of a try gets the guard env; any other script step does not', () => {
  const ctx = { executionId: 'e1', projectDir: home, pipelineDir: home, pipelineId: 'abcd1234', claudeOpts: {} };
  const node = { id: 'n1', key: 's1' };
  const script = { meta: {}, params: {} };
  const plain = envForShell(buildEnvelope({ ...ctx, node, script }));
  assert.equal(plain[TRY_GUARD_LOG_ENV], undefined);
  for (const k of ['GIT_SSH_COMMAND', 'GCM_INTERACTIVE', 'GH_CONFIG_DIR', 'GLAB_CONFIG_DIR', 'AZURE_CONFIG_DIR']) assert.equal(plain[k], process.env[k], k);
  assert.equal(buildEnvelope({ ...ctx, node, script, tryGuard: { logFile: 'x' } }).ctx.test, undefined, 'no guard without a try');
  const tried = envForShell(buildEnvelope({ ...ctx, node, script, testConnectors: 'pretend', tryGuard: { logFile: join(home, 's.ndjson') } }));
  assert.equal(tried[TRY_GUARD_LOG_ENV], join(home, 's.ndjson'));
  assert.equal(tried.WORCA_TEST, '1');
});

test('a normal spawn is byte-identical: buildClaudeArgs, buildSettingsPayload and composeSpawnEnv without tryGuard', () => {
  const opts = { prompt: 'p', systemPrompt: 's', permissionMode: 'acceptEdits', allowedTools: ['Bash'], permissionRules: { deny: ['Read(.env*)'] }, hostGuard: true };
  const plain = buildClaudeArgs(opts);
  assert.deepEqual(buildClaudeArgs({ ...opts, tryGuard: null }), plain);
  assert.deepEqual(buildClaudeArgs({ ...opts, tryGuard: undefined }), plain);
  assert.ok(!plain.join(' ').includes('try-guard.mjs'));
  // Nothing at all to carry stays nothing: no --settings flag for a guard-less spawn without rules.
  assert.equal(buildSettingsPayload(null, { tryGuard: null }), buildSettingsPayload(null));
  const tried = buildClaudeArgs({ ...opts, tryGuard: { logFile: join(home, 'c.ndjson') } });
  const settings = JSON.parse(tried[tried.indexOf('--settings') + 1]);
  assert.ok(settings.permissions.deny.includes('Bash(gh:*)'));
  // Only --settings differs.
  const strip = (a) => { const i = a.indexOf('--settings'); return i < 0 ? a : [...a.slice(0, i), ...a.slice(i + 2)]; };
  assert.deepEqual(strip(tried), strip(plain));
  const base = composeSpawnEnv({ overlay: { ANTHROPIC_MODEL: 'm' }, hostPid: 1 }).env;
  assert.deepEqual(composeSpawnEnv({ overlay: { ANTHROPIC_MODEL: 'm' }, hostPid: 1, tryGuard: null }).env, base);
  for (const k of [TRY_GUARD_LOG_ENV, 'GCM_INTERACTIVE', 'GIT_SSH_COMMAND', 'GH_CONFIG_DIR']) assert.equal(base[k], process.env[k], k);
});

test('withTryGuardEnv: null returns the env itself; on Windows PATH goes to the env\'s own key (Path), other spellings dropped', () => {
  const env0 = { Path: 'C:\\a', PATH: 'C:\\b', X: '1' };
  assert.equal(withTryGuardEnv(env0, null, { home, platform: 'win32' }), env0);
  const env = withTryGuardEnv(env0, { logFile: 'f' }, { home, platform: 'win32' });
  assert.deepEqual(Object.keys(env).filter((k) => k.toUpperCase() === 'PATH'), ['Path']);
  assert.equal(env.Path, `${standInDir(home)};C:\\a`);
  assert.equal(withTryGuardEnv(env, { logFile: 'f' }, { home, platform: 'win32' }).Path, env.Path, 'applied twice: one entry');
  // gh / glab / az found some other way (spawn('gh') skips a .cmd on Windows) have no sign-in of their own.
  for (const k of ['GH_CONFIG_DIR', 'GLAB_CONFIG_DIR', 'AZURE_CONFIG_DIR']) assert.ok(env[k] && existsSync(env[k]), k);
  for (const name of ['gh', 'glab', 'az']) {
    assert.ok(existsSync(join(standInDir(home), name)), name);
    assert.ok(existsSync(join(standInDir(home), `${name}.cmd`)), `${name}.cmd`);
  }
  assert.ok(!tryGuardHookEntry().hooks[0].command.includes('\\'), 'forward slashes, as the host guard');
  assert.equal(env0.GIT_TERMINAL_PROMPT, undefined, 'the input env is not changed');
});

test('board 37: wouldHaveSent lists a guard entry through guardCall (a push names the forge)', () => {
  const e = { server: 'git', tool: 'push', arguments: { command: 'git push origin fix-482', argv: ['origin', 'fix-482'] }, readOnly: false, guard: true };
  const row = guardCall(e, { forgeOf: (r) => (r === 'origin' ? 'GitHub' : null) });
  assert.deepEqual([row.guard, row.tool, row.preview, row.cap, row.to], [true, 'push', 'Send the changes to the branch fix-482', 'Not sent · stopped by Worca', null]);
  assert.equal(row.full, 'This try tried to send its changes to the branch fix-482 on GitHub.');
  assert.deepEqual(sentCall(e, { forgeOf: () => 'GitHub' }), row);
  assert.equal(sentCall({ server: 's', tool: 'send_message', arguments: { text: 'hi' } }).guard, undefined, 'a connector call is unchanged');
});
