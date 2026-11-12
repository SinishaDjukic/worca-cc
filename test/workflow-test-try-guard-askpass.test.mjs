// test/workflow-test-try-guard-askpass.test.mjs — workflow tests 3b, final review E1: git in a try cannot sign in through an
// askpass program (GIT_ASKPASS, SSH_ASKPASS, core.askPass, VS Code's askpass and its IPC handle) or a credential helper an
// inherited GIT_CONFIG_PARAMETERS names. git runs against a server on 127.0.0.1 only.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withTryGuardEnv } from '../src/core/workflow-tests/try-guard-env.mjs';
import { isTryGuardEnvKey, strippedSettingsText } from '../src/core/workflow-tests/project-claude-settings.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-cc-askpass-')); dirs.push(d); return d; };
const home = tmp();
const HELPER = "'credential.helper'='!f() { echo username=u; echo password=p; }; f'";

test('E1: the guard blanks GIT_ASKPASS and SSH_ASKPASS, drops VS Code\'s askpass keys, and resets an inherited helper last', () => {
  const env0 = { PATH: '/usr/bin', GIT_ASKPASS: '/x/askpass.sh', ssh_askpass: '/y', VSCODE_GIT_IPC_HANDLE: '/run/vscode-git.sock',
    VSCODE_GIT_ASKPASS_NODE: '/node', vscode_git_askpass_main: '/main.js', VSCODE_GIT_ASKPASS_EXTRA_ARGS: '', VSCODE_GIT_OTHER: 'kept',
    GIT_CONFIG_PARAMETERS: HELPER };
  const env = withTryGuardEnv(env0, { logFile: 'f' }, { home, platform: 'linux' });
  assert.equal(env.GIT_ASKPASS, '');
  assert.equal(env.SSH_ASKPASS, '');
  assert.deepEqual(Object.keys(env).filter((k) => /askpass/i.test(k)), ['GIT_ASKPASS', 'SSH_ASKPASS'], 'one spelling each, VS Code\'s gone');
  assert.equal(env.VSCODE_GIT_IPC_HANDLE, undefined);
  assert.equal(env.VSCODE_GIT_OTHER, 'kept', 'only the askpass keys and the IPC handle');
  assert.equal(env.GIT_CONFIG_PARAMETERS, `${HELPER} 'credential.helper='`, 'kept, with the empty helper after it (it is read after GIT_CONFIG_COUNT)');
  assert.equal('GIT_CONFIG_PARAMETERS' in withTryGuardEnv({ PATH: '/usr/bin' }, { logFile: 'f' }, { home, platform: 'linux' }), false, 'none added');
  assert.equal(env0.GIT_ASKPASS, '/x/askpass.sh', 'the input env is not changed');
  assert.equal(withTryGuardEnv(env0, null, { home }), env0, 'no guard: the env itself');
  const win = withTryGuardEnv({ Path: 'C:\\a', GIT_ASKPASS: 'C:/askpass.exe' }, { logFile: 'f' }, { home, platform: 'win32' });
  for (const k of ['GIT_ASKPASS', 'SSH_ASKPASS']) assert.ok(win.WSLENV.split(':').includes(k), `WSL's git sees ${k} empty too`);
});

test('E1: the project settings env loses the askpass keys and VS Code\'s IPC handle too', () => {
  for (const k of ['GIT_ASKPASS', 'Ssh_AskPass', 'VSCODE_GIT_IPC_HANDLE', 'VSCODE_GIT_ASKPASS_MAIN', 'vscode_git_askpass_node', 'GIT_CONFIG_PARAMETERS']) {
    assert.ok(isTryGuardEnvKey(k), k);
  }
  assert.equal(isTryGuardEnvKey('VSCODE_PID'), false);
  const t = strippedSettingsText(JSON.stringify({ env: { GIT_ASKPASS: '/a', SSH_ASKPASS: '/b', VSCODE_GIT_IPC_HANDLE: '/c', VSCODE_GIT_ASKPASS_MAIN: '/d', NODE_ENV: 'test' } }));
  assert.deepEqual(JSON.parse(t), { env: { NODE_ENV: 'test' } });
});

test('E1 probe: with an inherited askpass, core.askPass and a GIT_CONFIG_PARAMETERS helper, git in a try sends no sign-in', async () => {
  const d = tmp();
  const marker = join(d, 'askpass-called.txt');
  const askpass = join(d, 'askpass.sh');
  const fwd = (p) => p.replaceAll('\\', '/');
  writeFileSync(askpass, `#!/bin/sh\necho called >> "${fwd(marker)}"\necho secret\n`);
  chmodSync(askpass, 0o755);
  const repo = join(d, 'r');
  execFileSync('git', ['init', '-q', repo]);
  const gitAsync = (e) => new Promise((done) => execFile('git', ['-C', repo, 'ls-remote', url], { env: e, timeout: 30000 }, () => done()));
  let auths = [];
  const srv = http.createServer((req, res) => { auths.push(req.headers.authorization || null); res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' }); res.end(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/x.git`;
  // The machine's own helpers (Git Credential Manager on Windows) are reset first in every case, so no window opens.
  const reset = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  const cases = {
    'GIT_ASKPASS': { GIT_ASKPASS: fwd(askpass) },
    'SSH_ASKPASS': { SSH_ASKPASS: fwd(askpass) },
    'core.askPass': { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_1: 'core.askPass', GIT_CONFIG_VALUE_1: fwd(askpass) },
    'GIT_CONFIG_PARAMETERS': { GIT_CONFIG_PARAMETERS: HELPER },
  };
  try {
    for (const [name, extra] of Object.entries(cases)) {
      const env0 = { ...process.env, ...reset, ...extra };
      for (const k of Object.keys(env0)) if (/askpass/i.test(k) && !(k in extra)) delete env0[k];   // VS Code's own, when the test runs in it
      rmSync(marker, { force: true }); auths = [];
      await gitAsync(env0);
      assert.ok(auths.some(Boolean), `control (${name}): without the guard git signs in`);
      rmSync(marker, { force: true }); auths = [];
      await gitAsync(withTryGuardEnv(env0, { logFile: join(d, 'calls.ndjson') }, { home }));
      assert.deepEqual(auths.filter(Boolean), [], `${name}: the guarded git sent no sign-in`);
      assert.equal(existsSync(marker) ? readFileSync(marker, 'utf8') : '', '', `${name}: no askpass program ran`);
    }
  } finally { await new Promise((r) => srv.close(r)); }
});
