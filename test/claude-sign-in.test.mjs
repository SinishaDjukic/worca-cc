// test/claude-sign-in.test.mjs — workflow tests 3b, Task 1 (D71): the sign-in kept in the person's own Claude Code settings,
// and nothing else from them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUserSignIn, readUserSafety, sandboxProblem, anchoredDenyRule, SAFETY_DENY_MAX, SETTINGS_FILE_MAX, isSignInEnvKey, SIGN_IN_SETTINGS_KEYS, userSettingsFile } from '../src/core/engines/claude-sign-in.mjs';
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
    credentials: { files: [{ path: '~/.netrc', mode: 'mask', extract: 'password ([^ ]+)' }, { path: '~/.aws/', mode: 'deny' }],
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

test('C1/D81b: layers that would clash once laid together (awsPairs) no longer can: a project\'s awsPairs is not carried', () => {
  const pair = (k, s) => ({ credentials: { awsPairs: [{ accessKeyIdVar: k, secretAccessKeyVar: s }] } });
  assert.deepEqual(safetyOf(pair('K', 'S1'), { sandbox: pair('K', 'S2') }), { deny: [], sandbox: pair('K', 'S1'),
    notes: ['Worca did not carry these sandbox settings from the project\'s .claude/settings.json: sandbox.credentials.awsPairs. '
      + 'Claude Code takes them only from your own, managed or command-line settings.'] });
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

// ── Task 5 (security review I1, M10): a `/path` deny rule keeps its meaning in Worca's settings file ───────────────────────
/** The `//` form Claude Code matches an absolute path by (a Windows drive as /c/…, as the CLI normalizes it). */
const BS = String.fromCharCode(92);   // a backslash
const posixAbs = (p) => { const f = p.split(BS).join('/'); const m = /^([A-Za-z]):(\/.*)$/.exec(f); return `/${m ? `/${m[1].toLowerCase()}${m[2]}` : f}`; };

test('I1: a rule anchored at the settings folder (`/…`) is rewritten to the person\'s config folder; every other rule is kept', () => {
  const h = home({ permissions: { deny: ['Edit(/settings.json)', 'Read(/.credentials.json)', 'Read(//etc/hosts)', 'Read(~/a.txt)', 'Read(./b)',
    'Read(c/**)', 'Bash(/usr/bin/curl:*)', 'WebFetch(domain:x.example)', 'Read', 'Grep(/logs/**)', 'mcp__x__y'] } });
  const cfg = posixAbs(join(h, '.claude'));
  assert.deepEqual(readUserSafety({ env: {}, home: h }).deny, [`Edit(${cfg}/settings.json)`, `Read(${cfg}/.credentials.json)`, 'Read(//etc/hosts)',
    'Read(~/a.txt)', 'Read(./b)', 'Read(c/**)', 'Bash(/usr/bin/curl:*)', 'WebFetch(domain:x.example)', 'Read', `Grep(${cfg}/logs/**)`, 'mcp__x__y']);
  const other = home({ permissions: { deny: ['Edit(/settings.json)'] } });
  assert.deepEqual(readUserSafety({ env: { CLAUDE_CONFIG_DIR: join(other, '.claude') }, home: h }).deny, [`Edit(${posixAbs(join(other, '.claude'))}/settings.json)`],
    'CLAUDE_CONFIG_DIR moves the folder the rule is anchored at');
});

test('I1: anchoredDenyRule: the absolute `//` form on Windows and POSIX; a UNC config folder keeps the rule as it is', () => {
  assert.equal(anchoredDenyRule('Edit(/settings.json)', ['C:', 'Users', 'a', '.claude'].join(BS)), 'Edit(//c/Users/a/.claude/settings.json)');
  assert.equal(anchoredDenyRule('Read(/x/**)', 'D:/cfg/'), 'Read(//d/cfg/x/**)');
  assert.equal(anchoredDenyRule('Edit(/settings.json)', '/x/cfg'), 'Edit(//x/cfg/settings.json)');
  assert.equal(anchoredDenyRule('Edit(/settings.json)', `${BS}${BS}server${BS}share${BS}cfg`), 'Edit(/settings.json)');
  for (const r of ['Read(//abs)', 'Read(~/x)', 'Bash(/bin/x)', 'Read', 'Read()', 'Edit(.env)', 'NotATool(/x)']) assert.equal(anchoredDenyRule(r, '/x/cfg'), r, r);
});

test('M10: a relative CLAUDE_CONFIG_DIR is refused: nothing is read (the CLI would resolve it against the checkout, not Worca\'s folder)', () => {
  const h = home({ env: { ANTHROPIC_API_KEY: 'sk-ant-1' }, permissions: { deny: ['Bash(x)'] } });
  assert.equal(userSettingsFile({ env: { CLAUDE_CONFIG_DIR: 'cfg' }, home: h }), null);
  assert.equal(userSettingsFile({ env: { CLAUDE_CONFIG_DIR: './.claude' }, home: h }), null);
  assert.deepEqual(readUserSignIn({ env: { CLAUDE_CONFIG_DIR: 'cfg' }, home: h, read: () => JSON.stringify({ apiKeyHelper: 'x' }) }), NONE);
  assert.deepEqual(readUserSafety({ env: { CLAUDE_CONFIG_DIR: 'cfg' }, home: h, read: () => JSON.stringify({ permissions: { deny: ['Bash(x)'] } }) }),
    { deny: [], sandbox: null });
});

// ── Task 5 (security review M7): only the sources the spawn loads, and never through a link ─────────────────────────────
test('M7: the local file\'s sandbox is laid on only when `local` is one of the spawn\'s sources', () => {
  const U = { enabled: true };
  const c = checkout({ sandbox: { excludedCommands: ['p'] } }, { sandbox: { excludedCommands: ['l'] } });
  const of = (sources) => readUserSafety({ env: {}, home: home({ sandbox: U }), cwd: c, sources }).sandbox;
  assert.deepEqual(of(['project']), { enabled: true, excludedCommands: ['p'] }, 'project only: the local file is not read');
  assert.deepEqual(of(['project', 'local']), { enabled: true, excludedCommands: ['p', 'l'] });
  assert.deepEqual(of(['local']), { enabled: true, excludedCommands: ['l'] }, 'no project source: the project file is not read');
});

test('M7: a checkout settings file or .claude folder that is a link is not read', () => {
  const U = { enabled: true };
  const outside = checkout({ sandbox: { excludedCommands: ['outside'] } });
  const viaJunction = mkdtempSync(join(tmpdir(), 'worca-cc-sbx-'));
  dirs.push(viaJunction);
  symlinkSync(join(outside, '.claude'), join(viaJunction, '.claude'), 'junction');
  assert.deepEqual(readUserSafety({ env: {}, home: home({ sandbox: U }), cwd: viaJunction }).sandbox, U, 'a .claude junction is not followed');
  const viaFile = checkout();
  let linked = true;
  try { symlinkSync(join(outside, '.claude', 'settings.json'), join(viaFile, '.claude', 'settings.json')); } catch { linked = false; }
  if (linked) assert.deepEqual(readUserSafety({ env: {}, home: home({ sandbox: U }), cwd: viaFile }).sandbox, U, 'a settings file link is not followed');
});

// ── Task 5 (D81b): the project's layers never carry what Claude Code takes only from the user, managed or flag tiers ───────
const PROJECT_ONLY_NOT = { network: { strictAllowlist: true, tlsTerminate: { caCertPath: '/ca.pem' }, allowManagedDomainsOnly: true, allowedDomains: ['p.example'] },
  filesystem: { disabled: true, allowManagedReadPathsOnly: true, denyWrite: ['/etc'] },
  credentials: { allowPlaintextInject: true, awsPairs: [{ accessKeyIdVar: 'K', secretAccessKeyVar: 'S' }], sigv4: { streaming: 'passthrough' } },
  allowNestedUserNamespaces: true, allowAppleEvents: true, ripgrep: { command: 'rg' }, bwrapPath: '/b', socatPath: '/s', enabled: true };

test('D81b: a project layer drops the keys Claude Code takes only from user, managed or --settings tiers, and says which', () => {
  const s = safetyOf({ enabled: false }, { sandbox: PROJECT_ONLY_NOT });
  assert.deepEqual(s.sandbox, { enabled: true, network: { allowedDomains: ['p.example'] }, filesystem: { denyWrite: ['/etc'] } });
  assert.deepEqual(s.notes, ['Worca did not carry these sandbox settings from the project\'s .claude/settings.json: sandbox.network.strictAllowlist, '
    + 'sandbox.network.tlsTerminate, sandbox.network.allowManagedDomainsOnly, sandbox.filesystem.disabled, sandbox.filesystem.allowManagedReadPathsOnly, '
    + 'sandbox.credentials.allowPlaintextInject, sandbox.credentials.awsPairs, sandbox.credentials.sigv4, sandbox.allowNestedUserNamespaces, '
    + 'sandbox.allowAppleEvents, sandbox.ripgrep, sandbox.bwrapPath, sandbox.socatPath. Claude Code takes them only from your own, managed or command-line settings.']);
  assert.equal('warnings' in s, false);
  assert.deepEqual(safetyOf(PROJECT_ONLY_NOT).sandbox.allowAppleEvents, true, 'the person\'s own are carried');
});

test('D81b: a project\'s allowUnsandboxedCommands: true is not carried (a person\'s false holds); a project false is', () => {
  const s = safetyOf({ allowUnsandboxedCommands: false }, { sandbox: { allowUnsandboxedCommands: true } });
  assert.deepEqual(s.sandbox, { allowUnsandboxedCommands: false });
  assert.match(s.notes[0], /sandbox\.allowUnsandboxedCommands/);
  assert.deepEqual(safetyOf({ allowUnsandboxedCommands: true }, undefined, { sandbox: { allowUnsandboxedCommands: false } }).sandbox,
    { allowUnsandboxedCommands: false }, 'a local false still applies');
});

test('D81b: with the person\'s network.strictAllowlist on, the project\'s domains, proxy ports and excluded commands are not carried', () => {
  const s = safetyOf({ network: { strictAllowlist: true, allowedDomains: ['u.example'] } },
    { sandbox: { network: { allowedDomains: ['p.example'], httpProxyPort: 1, socksProxyPort: 2, deniedDomains: ['d.example'] }, excludedCommands: ['docker'] } });
  assert.deepEqual(s.sandbox, { network: { strictAllowlist: true, allowedDomains: ['u.example'], deniedDomains: ['d.example'] } });
  assert.match(s.notes[0], /sandbox\.network\.allowedDomains, sandbox\.network\.httpProxyPort, sandbox\.network\.socksProxyPort, sandbox\.excludedCommands/);
  assert.deepEqual(safetyOf({ network: { allowedDomains: ['u.example'] } }, { sandbox: { network: { allowedDomains: ['p.example'] } } }).sandbox,
    { network: { allowedDomains: ['u.example', 'p.example'] } }, 'without it: joined as before');
});

test('D81b: a relative sandbox path keeps its meaning (the person\'s config folder, the checkout); one Worca cannot place is left out', () => {
  const h = home({ sandbox: { filesystem: { allowWrite: ['build', './out/**', '/abs', '//abs2', '~/h', '~'], denyRead: ['secrets'] },
    credentials: { files: [{ path: 'keys/a.pem', mode: 'deny' }] }, ignoreViolations: { '*': ['/tmp/x', 'rel'] }, network: { allowUnixSockets: ['/s', 'rel.sock'] } } });
  const cfg = join(h, '.claude').split(BS).join('/');
  const c = checkout({ sandbox: { filesystem: { denyRead: ['private/**', '/abs3'] }, credentials: { files: [{ path: '.env', mode: 'deny' }] } } });
  const s = readUserSafety({ env: {}, home: h, cwd: c });
  const co = c.split(BS).join('/');
  assert.deepEqual(s.sandbox.filesystem, { allowWrite: [`${cfg}/build`, `${cfg}/out/**`, '/abs', '//abs2', '~/h', '~'],
    denyRead: [`${cfg}/secrets`, `${co}/private/**`, '/abs3'] });
  assert.deepEqual(s.sandbox.credentials, { files: [{ path: `${cfg}/keys/a.pem`, mode: 'deny' }, { path: `${co}/.env`, mode: 'deny' }] });
  assert.deepEqual(s.sandbox.ignoreViolations, { '*': ['/tmp/x'] });
  assert.deepEqual(s.sandbox.network, { allowUnixSockets: ['/s'] });
  assert.deepEqual(s.notes, ['Worca did not carry these sandbox paths from your Claude Code settings, as it could not tell what they point at once moved: '
    + 'sandbox.ignoreViolations.*[1], sandbox.network.allowUnixSockets[1].']);
});

// ── Task 5 (security review M11): a run that loads no user settings gets no auto-approved sandboxed Bash from the person ──
test('M11: unless the run loads user settings, the carried sandbox says autoAllowBashIfSandboxed: false (a project layer may still set it)', () => {
  const of = (user, project, userLoaded) => readUserSafety({ env: {}, home: home({ sandbox: user }), cwd: checkout(project), userLoaded }).sandbox;
  assert.deepEqual(of({ enabled: true }, undefined, false), { enabled: true, autoAllowBashIfSandboxed: false });
  assert.deepEqual(of({ enabled: true, autoAllowBashIfSandboxed: true }, undefined, false), { enabled: true, autoAllowBashIfSandboxed: false });
  assert.deepEqual(of({ enabled: true }, { sandbox: { autoAllowBashIfSandboxed: true } }, false), { enabled: true, autoAllowBashIfSandboxed: true },
    'the project\'s own value, as a normal project-only run has it');
  assert.deepEqual(of({ enabled: true }, undefined, true), { enabled: true }, 'a run that loads user settings: as the person has it');
  assert.deepEqual(of({ enabled: true }, undefined, undefined), { enabled: true }, 'not said: as before');
  assert.equal(readUserSafety({ env: {}, home: home({ permissions: { deny: ['Bash(x)'] } }), userLoaded: false }).sandbox, null, 'no sandbox: none');
});
