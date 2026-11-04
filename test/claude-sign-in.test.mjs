// test/claude-sign-in.test.mjs — workflow tests 3b, Task 1 (D71): the sign-in kept in the person's own Claude Code settings,
// and nothing else from them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUserSignIn, readUserSafety, sandboxProblem, SAFETY_DENY_MAX, SETTINGS_FILE_MAX, isSignInEnvKey, SIGN_IN_SETTINGS_KEYS, userSettingsFile } from '../src/core/engines/claude-sign-in.mjs';
import { userClaudeSignIn } from '../src/core/requirements/interview.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
/** A home folder with `.claude/settings.json` holding `body` (an object as JSON, a string as it is; undefined: no file). */
function home(body) {
  const h = mkdtempSync(join(tmpdir(), 'worca-cc-signin-'));
  dirs.push(h);
  mkdirSync(join(h, '.claude'), { recursive: true });
  if (body !== undefined) writeFileSync(join(h, '.claude', 'settings.json'), typeof body === 'string' ? body : JSON.stringify(body));
  return h;
}
const NONE = { state: 'none', env: {}, settings: {} };

test('only the sign-in comes out: the env keys that sign in or route traffic, and the three helpers', () => {
  const h = home({
    env: { ANTHROPIC_API_KEY: 'sk-ant-1', CLAUDE_CODE_USE_VERTEX: '1', CLOUD_ML_REGION: 'europe-west4', AWS_PROFILE: 'p', HTTPS_PROXY: 'http://proxy:8080',
      NODE_EXTRA_CA_CERTS: '/ca.pem', BASH_DEFAULT_TIMEOUT_MS: '9000', MY_TOKEN: 'x' },
    apiKeyHelper: 'node key.js', awsAuthRefresh: 'aws sso login', awsCredentialExport: 'aws configure export-credentials',
    hooks: { PreToolUse: [] }, enabledPlugins: { 'p@m': true }, permissions: { allow: ['Bash(npm test:*)'] }, model: 'opus',
  });
  const s = readUserSignIn({ env: {}, home: h });
  assert.equal(s.state, 'found');
  assert.deepEqual(s.env, { ANTHROPIC_API_KEY: 'sk-ant-1', CLAUDE_CODE_USE_VERTEX: '1', CLOUD_ML_REGION: 'europe-west4', AWS_PROFILE: 'p',
    HTTPS_PROXY: 'http://proxy:8080', NODE_EXTRA_CA_CERTS: '/ca.pem' });
  assert.deepEqual(s.settings, { apiKeyHelper: 'node key.js', awsAuthRefresh: 'aws sso login', awsCredentialExport: 'aws configure export-credentials' });
  assert.deepEqual(SIGN_IN_SETTINGS_KEYS, ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport']);
});

test('numbers and yes/no in env become text; empty helpers, objects, arrays and null are left out', () => {
  const s = readUserSignIn({ env: {}, home: home({ env: { CLAUDE_CODE_USE_BEDROCK: 1, ANTHROPIC_X: true, ANTHROPIC_Y: { a: 1 }, ANTHROPIC_Z: null, ANTHROPIC_W: [1] },
    apiKeyHelper: '', awsAuthRefresh: 3 }) });
  assert.deepEqual(s, { state: 'found', env: { CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_X: 'true' }, settings: {} });
});

test('nothing to carry: no file, a blank one, no sign-in in it, or not an object', () => {
  for (const [body, why] of [[undefined, 'no file'], ['', 'blank'], ['  \n', 'spaces'], [{ hooks: {} }, 'no sign-in'], ['[1]', 'an array'], ['"x"', 'a string']]) {
    assert.deepEqual(readUserSignIn({ env: {}, home: home(body) }), NONE, why);
  }
  assert.deepEqual(readUserSignIn({ env: {}, home: home({ env: { BASH_DEFAULT_TIMEOUT_MS: '1' } }) }), NONE, 'env without a sign-in key');
});

test('a file Worca cannot read or parse carries nothing (the CLI cannot use it either), and says so', () => {
  assert.deepEqual(readUserSignIn({ env: {}, home: home('{ not json') }), { state: 'unreadable', env: {}, settings: {} });
  const err = (code) => () => { throw Object.assign(new Error(code), { code }); };
  assert.equal(readUserSignIn({ env: {}, home: home({}), read: err('EACCES') }).state, 'unreadable');
  assert.equal(readUserSignIn({ env: {}, home: home({}), read: err('EISDIR') }).state, 'unreadable');
  assert.equal(readUserSignIn({ env: {}, home: home({}), read: err('ENOENT') }).state, 'none');
  assert.equal(readUserSignIn({ env: {}, home: home({}), read: err('ENOTDIR') }).state, 'none');
});

test('a leading BOM is read; CLAUDE_CONFIG_DIR (trimmed) moves the file', () => {
  assert.equal(readUserSignIn({ env: {}, home: home(`﻿${JSON.stringify({ apiKeyHelper: 'x' })}`) }).state, 'found');
  const other = home({ env: { ANTHROPIC_BASE_URL: 'http://gw' } });
  const h = home({});
  assert.equal(userSettingsFile({ env: { CLAUDE_CONFIG_DIR: ` ${join(other, '.claude')} ` }, home: h }), join(other, '.claude', 'settings.json'));
  assert.equal(userSettingsFile({ env: { CLAUDE_CONFIG_DIR: '  ' }, home: h }), join(h, '.claude', 'settings.json'));
  assert.deepEqual(readUserSignIn({ env: { CLAUDE_CONFIG_DIR: join(other, '.claude') }, home: h }).env, { ANTHROPIC_BASE_URL: 'http://gw' });
});

test('the key rule moved here unchanged; the interview still uses it', () => {
  for (const k of ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_FOUNDRY', 'AWS_REGION', 'http_proxy', 'HTTPS_PROXY',
    'NODE_EXTRA_CA_CERTS', 'CLOUD_ML_REGION', 'GOOGLE_APPLICATION_CREDENTIALS', 'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY']) assert.ok(isSignInEnvKey(k), k);
  for (const k of ['GH_TOKEN', 'PATH', 'HOME', 'BASH_DEFAULT_TIMEOUT_MS', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'WORCA_HOME']) assert.equal(isSignInEnvKey(k), false, k);
  assert.equal(userClaudeSignIn({ env: {}, home: home({ env: { AWS_PROFILE: 'p' } }) }), true);
  assert.equal(userClaudeSignIn({ env: {}, home: home({ env: { MY_KEY: 'p' } }) }), false);
});

test('D81: the person\'s own deny rules and sandbox; never their allow or ask rules; nothing from an unreadable file', () => {
  assert.deepEqual(readUserSafety({ env: {}, home: home({ permissions: { deny: ['Bash(rm -rf:*)', '', 3, 'Bash(rm -rf:*)'], allow: ['Bash(*)'], ask: ['Bash(git push:*)'] },
    sandbox: { enabled: true } }) }), { deny: ['Bash(rm -rf:*)'], sandbox: { enabled: true } });
  for (const [body, why] of [[undefined, 'no file'], ['{ not json', 'unreadable'], [{ sandbox: [1] }, 'a sandbox that is not an object'],
    [{ permissions: { deny: 'Bash(x)' } }, 'deny is not a list'], ['[1]', 'not an object']]) {
    assert.deepEqual(readUserSafety({ env: {}, home: home(body) }), { deny: [], sandbox: null }, why);
  }
  const many = Array.from({ length: 600 }, (_, i) => `Bash(x${i})`);
  assert.equal(readUserSafety({ env: {}, home: home({ permissions: { deny: many } }) }).deny.length, SAFETY_DENY_MAX);
});

/** D81a: a try checkout with `.claude/settings.json` (`project`) and `.claude/settings.local.json` (`local`); same body rule as home(). */
function checkout(project, local) {
  const c = mkdtempSync(join(tmpdir(), 'worca-cc-sbx-'));
  dirs.push(c);
  mkdirSync(join(c, '.claude'), { recursive: true });
  for (const [name, body] of [['settings.json', project], ['settings.local.json', local]]) {
    if (body !== undefined) writeFileSync(join(c, '.claude', name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return c;
}
const sandboxOf = (user, project, local) => readUserSafety({ env: {}, home: home({ sandbox: user }), cwd: checkout(project, local) }).sandbox;

test('D81a: the carried sandbox keeps Claude Code\'s order: the checkout\'s project, then local sandbox, over the person\'s', () => {
  assert.deepEqual(sandboxOf({ enabled: false }, { sandbox: { enabled: true } }), { enabled: true }, 'project over user');
  assert.deepEqual(sandboxOf({ allowUnsandboxedCommands: true }, undefined, { sandbox: { allowUnsandboxedCommands: false } }),
    { allowUnsandboxedCommands: false }, 'local over user');
  assert.deepEqual(sandboxOf({ autoAllowBashIfSandboxed: true }, { sandbox: { autoAllowBashIfSandboxed: true } }, { sandbox: { autoAllowBashIfSandboxed: false } }),
    { autoAllowBashIfSandboxed: false }, 'local over project');
  assert.deepEqual(sandboxOf({ excludedCommands: ['a'] }, { sandbox: { excludedCommands: ['b', 'a'] } }), { excludedCommands: ['a', 'b'] },
    'lists joined, deduplicated, the person\'s first');
  assert.deepEqual(sandboxOf({ enabled: true, network: { allowedDomains: ['x'], allowLocalBinding: true, httpProxyPort: 1 } },
    { sandbox: { network: { allowedDomains: ['y', 'x'], allowLocalBinding: false } } }, { sandbox: { network: { httpProxyPort: 2 } } }),
  { enabled: true, network: { allowedDomains: ['x', 'y'], allowLocalBinding: false, httpProxyPort: 2 } }, 'nested objects by the same rules');
  assert.deepEqual(sandboxOf({ enabled: true }, `﻿${JSON.stringify({ sandbox: { excludedCommands: ['b'] } })}`), { enabled: true, excludedCommands: ['b'] },
    'a leading BOM is read');
});

test('D81a: an unreadable or invalid project or local file adds nothing; no sandbox of the person\'s: none carried', () => {
  const U = { enabled: false, excludedCommands: ['a'] };
  assert.deepEqual(sandboxOf(U, '{ not json'), U, 'invalid project JSON: the person\'s sandbox as it is');
  assert.deepEqual(sandboxOf(U, '{ not json', { sandbox: { enabled: true } }), { ...U, enabled: true }, 'a bad project file does not stop the local one');
  for (const [project, why] of [[{ sandbox: [1] }, 'a sandbox that is not an object'], ['[1]', 'not an object'], ['', 'blank'], [undefined, 'no file'],
    [{ sandbox: { enabled: true }, pad: 'x'.repeat(SETTINGS_FILE_MAX) }, 'larger than SETTINGS_FILE_MAX']]) {
    assert.deepEqual(sandboxOf(U, project), U, why);
  }
  const c = checkout({ sandbox: { enabled: true } });
  assert.deepEqual(readUserSafety({ env: {}, home: home({ sandbox: U }), cwd: c, read: () => { throw new Error('EACCES'); } }), { deny: [], sandbox: null },
    'never throws');
  assert.deepEqual(readUserSafety({ env: {}, home: home({ sandbox: U }) }).sandbox, U, 'no checkout: the person\'s sandbox as it is');
  const noUser = readUserSafety({ env: {}, home: home({ permissions: { deny: ['Bash(x)'] } }), cwd: checkout({ sandbox: { enabled: true } }, { sandbox: { enabled: true } }) });
  assert.deepEqual(noUser, { deny: ['Bash(x)'], sandbox: null }, 'the project and local sandbox load by themselves');
});

// ── Task 5 (security review C1): a sandbox the CLI would reject never reaches Worca's --settings file ──────────────────────
const safetyOf = (user, project, local) => readUserSafety({ env: {}, home: home({ sandbox: user }), cwd: checkout(project, local) });
const NOT_CARRIED = (who, what) => `Worca did not carry ${who} sandbox settings: ${what} is not valid.`;

test('C1: a person\'s sandbox with a wrong type or an unknown key carries no sandbox, and says which part', () => {
  for (const [user, what] of [[{ enabled: 'yes' }, 'sandbox.enabled'], [{ excludedCommands: 5 }, 'sandbox.excludedCommands'],
    [{ excludedCommands: 'docker' }, 'sandbox.excludedCommands'], [{ network: true }, 'sandbox.network'],
    [{ network: { allowedDomains: 'example.com' } }, 'sandbox.network.allowedDomains'], [{ network: { httpProxyPort: '8080' } }, 'sandbox.network.httpProxyPort'],
    [{ notAKey: 1, enabled: false }, 'sandbox.notAKey'], [{ filesystem: { allowWrite: [1] } }, 'sandbox.filesystem.allowWrite'],
    [{ ripgrep: {} }, 'sandbox.ripgrep'], [{ ignoreViolations: { '*': 'x' } }, 'sandbox.ignoreViolations'],
    [{ credentials: { files: [{ path: '/k', mode: 'mask', extract: 'no-group' }] } }, 'sandbox.credentials.files[0].extract'],
    [{ credentials: { envVars: [{ name: 'BAD-NAME', mode: 'deny' }] } }, 'sandbox.credentials.envVars[0].name'],
    [{ network: { allowMachLookup: ['com.*.x'] } }, 'sandbox.network.allowMachLookup']]) {
    const s = readUserSafety({ env: {}, home: home({ sandbox: user, permissions: { deny: ['Bash(x)'] } }) });
    assert.deepEqual(s, { deny: ['Bash(x)'], sandbox: null, warnings: [NOT_CARRIED('your', what)] }, what);
  }
});

test('C1: a valid sandbox in every documented part is carried as it is, with no warning', () => {
  const S = { enabled: true, failIfUnavailable: false, autoAllowBashIfSandboxed: false, allowUnsandboxedCommands: false, excludedCommands: ['docker:*'],
    network: { allowedDomains: ['a.example'], deniedDomains: ['b.example'], strictAllowlist: true, allowUnixSockets: ['/s'], allowAllUnixSockets: false,
      allowLocalBinding: true, allowMachLookup: ['com.apple.*'], httpProxyPort: 8080, socksProxyPort: 1080, tlsTerminate: { caCertPath: '/ca.pem' } },
    filesystem: { allowWrite: ['/tmp'], denyWrite: ['/etc'], denyRead: ['~/.ssh'], allowRead: ['~/.ssh/known_hosts'], disabled: false },
    credentials: { files: [{ path: '~/.netrc', mode: 'mask', extract: 'password (\S+)' }, { path: '~/.aws/', mode: 'deny' }],
      envVars: [{ name: 'GH_TOKEN', mode: 'mask', injectHosts: ['api.github.com'] }], allowPlaintextInject: false,
      awsPairs: [{ accessKeyIdVar: 'K1', secretAccessKeyVar: 'S1' }], sigv4: { streaming: 'deny' } },
    ignoreViolations: { '*': ['/tmp/x'] }, enableWeakerNestedSandbox: false, enableWeakerNetworkIsolation: false, allowAppleEvents: false,
    ripgrep: { command: 'rg', args: ['--hidden'] } };
  assert.deepEqual(readUserSafety({ env: {}, home: home({ sandbox: S }) }), { deny: [], sandbox: S });
});

test('C1: a project or local sandbox that is not valid adds nothing; the person\'s is still carried, with one warning', () => {
  const U = { enabled: true };
  assert.deepEqual(safetyOf(U, { sandbox: { excludedCommands: 'docker' } }),
    { deny: [], sandbox: U, warnings: [NOT_CARRIED('the project\'s .claude/settings.json', 'sandbox.excludedCommands')] });
  assert.deepEqual(safetyOf({ network: { allowedDomains: ['a'] } }, { sandbox: { network: true } }),
    { deny: [], sandbox: { network: { allowedDomains: ['a'] } }, warnings: [NOT_CARRIED('the project\'s .claude/settings.json', 'sandbox.network')] },
    'a clash of shapes (an object under a yes/no) is the project layer\'s fault');
  assert.deepEqual(safetyOf(U, undefined, { sandbox: { enabled: 'no' } }),
    { deny: [], sandbox: U, warnings: [NOT_CARRIED('the project\'s .claude/settings.local.json', 'sandbox.enabled')] });
  assert.deepEqual(safetyOf(U, { sandbox: { enabled: false, notAKey: true } }, { sandbox: { excludedCommands: ['x'] } }),
    { deny: [], sandbox: { enabled: true, excludedCommands: ['x'] }, warnings: [NOT_CARRIED('the project\'s .claude/settings.json', 'sandbox.notAKey')] },
    'a bad project layer does not stop the local one');
});

test('C1: layers that are each valid but clash once laid together carry no sandbox', () => {
  const pair = (k, s) => ({ credentials: { awsPairs: [{ accessKeyIdVar: k, secretAccessKeyVar: s }] } });
  assert.deepEqual(safetyOf(pair('K', 'S1'), { sandbox: pair('K', 'S2') }),
    { deny: [], sandbox: null, warnings: [NOT_CARRIED('your', 'sandbox.credentials.awsPairs[1] (with the project\'s laid over it)')] });
});

test('C1: sandboxProblem names the first part the CLI would reject; null when valid', () => {
  assert.equal(sandboxProblem({}), null);
  assert.equal(sandboxProblem({ enabled: true, network: { allowedDomains: [] } }), null);
  assert.equal(sandboxProblem([]), 'sandbox');
  assert.equal(sandboxProblem(null), 'sandbox');
  assert.equal(sandboxProblem({ network: null }), 'sandbox.network');
  assert.equal(sandboxProblem({ credentials: { envVars: [{ name: 'T', mode: 'mask', decode: 'jwt', extract: '(x)' }] } }), 'sandbox.credentials.envVars[0].decode');
  assert.equal(sandboxProblem({ credentials: { files: [{ path: '/d/', mode: 'mask' }] } }), 'sandbox.credentials.files[0].path');
  assert.equal(sandboxProblem({ credentials: { files: [{ path: '/d', mode: 'mask', maskClaims: ['sub'] }] } }), 'sandbox.credentials.files[0].maskClaims');
  assert.equal(sandboxProblem(JSON.parse('{"ignoreViolations":{"__proto__":["x"]}}')), 'sandbox.ignoreViolations');
});
