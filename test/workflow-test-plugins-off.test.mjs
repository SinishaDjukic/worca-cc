// test/workflow-test-plugins-off.test.mjs — workflow tests 3b, Task 2 (D70, D71): a Pretend try's spawns load no user settings,
// carry only the sign-in kept there, and every other spawn stays byte-identical.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSettingsPayload, buildClaudeArgs, planClaudeInvocation, signInCarry, secretValuesOf, runClaudeProcess, carryLine, CARRY_WARNING_PREFIX, CARRY_NOTE_PREFIX } from '../src/core/engines/claude.mjs';
import { RunHarness } from '../src/core/run-harness.mjs';
import { composeSpawnEnv } from '../src/core/engines/spawn.mjs';
import { runOpts, taskHeader, fanOutDirective, PLUGINS_OFF_SOURCES } from '../src/core/phases.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';

process.env.WORCA_HOST_GUARD = '0';   // as spawn-args.test.mjs: this file's feature only
const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script (no .exe stand-in on Windows)' : false };
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-cc-poff-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const BASE = { prompt: 'p', permissionMode: 'acceptEdits', allowedTools: ['Read'] };
const HELPERS = { apiKeyHelper: 'node key.js', awsAuthRefresh: 'aws sso login', awsCredentialExport: 'aws x' };
const OPTS = { role: 'implementer', prompt: 'x', systemPrompt: 's', allowedTools: [] };

test('the --settings payload: the three sign-in helpers only, and unchanged without them', () => {
  assert.equal(buildSettingsPayload(null, {}), null, 'nothing to carry: no flag');
  const p = buildSettingsPayload(null, { signInSettings: { ...HELPERS, hooks: { x: 1 }, env: { A: 'b' }, apiKeyHelperX: 'y' } });
  assert.deepEqual(p.settings, HELPERS);
  assert.equal(p.signIn, true);
  const rules = { deny: ['Read(.env*)'] };
  assert.deepEqual(buildSettingsPayload(rules, { signInSettings: null }), buildSettingsPayload(rules, {}));
  assert.deepEqual(buildSettingsPayload(rules, { signInSettings: { apiKeyHelper: '' } }), buildSettingsPayload(rules, {}), 'an empty helper is nothing');
  assert.equal(buildSettingsPayload(null, { signInSettings: { apiKeyHelper: '' } }), null);
});

test('a carried helper never rides the command line: buildClaudeArgs refuses it inline, the plan writes it to a file', () => {
  assert.throws(() => buildClaudeArgs({ ...BASE, signInSettings: HELPERS }), /settings file/);
  const dir = tmp();
  const plan = planClaudeInvocation({ ...BASE, signInSettings: HELPERS }, { bin: 'claude', dir });
  const i = plan.args.indexOf('--settings');
  assert.equal(plan.args[i + 1], join(dir, 'settings.json'));
  assert.deepEqual(JSON.parse(plan.files.find((f) => f.path === join(dir, 'settings.json')).content), HELPERS);
  assert.deepEqual(plan.args.slice(0, 2), ['-p', 'p'], 'the prompt stays inline');
  assert.equal(plan.staged, false, 'not the GH #380 staging (no "argv would be N chars" line)');
  assert.equal(plan.stdin, null);
  assert.ok(!plan.args.some((a) => a.includes('node key.js')));
  const without = planClaudeInvocation(BASE, { bin: 'claude', dir: null });
  assert.deepEqual(without.args, buildClaudeArgs(BASE), 'no carry: byte-identical, and no folder is needed');
  assert.deepEqual(without.files, []);
  const long = planClaudeInvocation({ ...BASE, prompt: 'x'.repeat(30000), signInSettings: HELPERS }, { bin: 'claude', dir: tmp() });
  assert.equal(long.staged, true, 'over the limit: the GH #380 staging, with the helper in its settings file');
  assert.deepEqual(JSON.parse(long.files.find((f) => f.path.endsWith('settings.json')).content), HELPERS);
});

test('the carried env sits over the ambient and run env, under the model env; without it the env is unchanged', () => {
  const { env } = composeSpawnEnv({ envScrub: true, envAllowlist: [], runEnv: { A: 'run', C: 'run' }, signInEnv: { A: 'sign', B: 'sign' }, overlay: { B: 'model' } });
  assert.deepEqual([env.A, env.B, env.C], ['sign', 'model', 'run']);
  const plain = composeSpawnEnv({ envScrub: true, envAllowlist: [], runEnv: { A: 'run' }, overlay: { B: 'model' } }).env;
  assert.deepEqual(composeSpawnEnv({ envScrub: true, envAllowlist: [], runEnv: { A: 'run' }, overlay: { B: 'model' }, signInEnv: null }).env, plain);
  assert.equal(composeSpawnEnv({ envScrub: true, envAllowlist: [], signInEnv: { NODE_EXTRA_CA_CERTS: '/ca.pem' } }).env.NODE_EXTRA_CA_CERTS, '/ca.pem',
    'a sign-in key the model env may not set still reaches the spawn');
});

test('what is carried: the person\'s sign-in; nothing with the broker on or into another OS user\'s spawn', () => {
  const found = () => ({ state: 'found', env: { ANTHROPIC_API_KEY: 'sk-ant-1' }, settings: { apiKeyHelper: 'h' } });
  assert.deepEqual(signInCarry({ read: found }), { env: { ANTHROPIC_API_KEY: 'sk-ant-1' }, settings: { apiKeyHelper: 'h' } });
  assert.equal(signInCarry({ read: () => ({ state: 'none', env: {}, settings: {} }) }), null);
  assert.equal(signInCarry({ read: () => ({ state: 'unreadable', env: {}, settings: {} }) }), null);
  assert.equal(signInCarry({ read: () => { throw new Error('x'); } }), null, 'never throws');
  const prev = process.env.WORCA_BROKER_URL;
  process.env.WORCA_BROKER_URL = 'http://127.0.0.1:1';
  try { assert.equal(signInCarry({ read: found }), null, 'the broker\'s token is the only model credential'); }
  finally { if (prev === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = prev; }
  assert.equal(signInCarry({ read: found, asAgent: true, agentUser: () => ({ user: 'agent1' }) }), null, 'another OS user');
  assert.deepEqual(signInCarry({ read: found, asAgent: true, agentUser: () => null }), { env: { ANTHROPIC_API_KEY: 'sk-ant-1' }, settings: { apiKeyHelper: 'h' } },
    'no agent user set up: the person\'s own spawn');
  let seen = null;
  signInCarry({ read: (o) => { seen = o.env.CLAUDE_CONFIG_DIR; return found(); }, modelEnv: { CLAUDE_CONFIG_DIR: '/cfg/other' } });
  assert.equal(seen, '/cfg/other', 'a model profile that moves the config folder moves where the sign-in is read');
  assert.deepEqual(secretValuesOf({ ANTHROPIC_API_KEY: 'sk-ant-12345678', CLAUDE_CODE_USE_VERTEX: '1', AWS_SECRET_ACCESS_KEY: 'abcdefgh1234',
    ANTHROPIC_AUTH_TOKEN: 'short', AWS_SESSION_TOKEN: 'zzzzzzzzzz' }), ['sk-ant-12345678', 'abcdefgh1234', 'zzzzzzzzzz']);
  // D71a: every carried value is redacted unless it is plain routing; URL userinfo is redacted on its own.
  assert.deepEqual(secretValuesOf({ ANTHROPIC_CUSTOM_HEADERS: 'Authorization: Bearer abcdefgh12345' }), ['Authorization: Bearer abcdefgh12345']);
  assert.deepEqual(secretValuesOf({ ANTHROPIC_BASE_URL: 'https://user1:pa55word@gw.example.com' }), ['user1', 'pa55word']);
  assert.deepEqual(secretValuesOf({ HTTPS_PROXY: 'http://puser:ppass99@proxy.example.com:8080' }), ['puser', 'ppass99']);
  assert.deepEqual(secretValuesOf({ CLAUDE_CODE_USE_VERTEX: '1', AWS_REGION: 'us-east-1', CLOUD_ML_REGION: 'europe-west4', NO_PROXY: 'localhost,127.0.0.1' }), []);
});

test('runOpts: a Pretend try\'s node gets the sources and pluginsOff; any other node keeps the run\'s own sources', () => {
  const o = runOpts({ projectDir: '/p', claudeOpts: {}, pluginsOff: true }, OPTS);
  assert.deepEqual([o.settingSources, o.pluginsOff], [['project'], true]);
  assert.deepEqual(PLUGINS_OFF_SOURCES, ['project', 'local']);
  // D70a: the run's own sources without the user's. A run that loads every source (opted in, or a sign-in in the user
  // settings) gives its Pretend try the project and local ones; a project-only run gives project only.
  const all = runOpts({ projectDir: '/p', claudeOpts: {}, pluginsOff: true, claudeSettingSources: null }, OPTS);
  assert.deepEqual(all.settingSources, ['project', 'local']);
  const proj = runOpts({ projectDir: '/p', claudeOpts: {}, pluginsOff: true, claudeSettingSources: ['project'] }, OPTS);
  assert.deepEqual(proj.settingSources, ['project']);
  // Any other node: the run's own sources (#943 C3: project-only unless the run opted in), and no pluginsOff.
  const n = runOpts({ projectDir: '/p', claudeOpts: {} }, OPTS);
  assert.deepEqual(n.settingSources, ['project']);
  assert.equal('pluginsOff' in n, false);
  assert.equal('settingSources' in runOpts({ projectDir: '/p', claudeOpts: {}, claudeSettingSources: null }, OPTS), false);
  const yes = runOpts({ projectDir: '/p', claudeOpts: {}, pluginsOff: 'yes' }, OPTS);
  assert.deepEqual([yes.settingSources, 'pluginsOff' in yes], [['project'], false], 'only true');
});

test('the prompts promise no personal skills or agents when they are off; every other prompt is unchanged', () => {
  const on = fanOutDirective(true, {});
  const off = fanOutDirective(true, { personalOff: true });
  assert.match(on, /~\/\.claude\/agents/);
  assert.match(on, /~\/\.claude\/skills/);
  assert.doesNotMatch(off, /~\/\.claude|your personal/);
  assert.match(off, /this project's own agents \(`\.claude\/agents`\) are available by name/);
  assert.match(off, /Skills are available too: this project's skills \(`\.claude\/skills`\) can be invoked via the Skill tool/);
  assert.equal(fanOutDirective(true, { personalOff: false }), on);
  assert.doesNotMatch(fanOutDirective(true, { personalOff: true, omitProjectAgents: true }), /~\/\.claude|your personal/);
  const ctx = { projectDir: '/p', pipelineDir: '/pl', taskPrompt: 'Fix it.', isEntry: true, node: { engine: 'claude' } };
  for (const c of [ctx, { ...ctx, runRoot: '/runs/r1' }]) {
    assert.match(taskHeader(c, 'T'), /~\/\.claude\/skills/, 'today\'s hint');
    const h = taskHeader({ ...c, pluginsOff: true }, 'T');
    assert.doesNotMatch(h, /~\/\.claude|personal/);
    assert.match(h, /skills .*available via the Skill tool/);
  }
});

test('runClaude forwards pluginsOff: --setting-sources project,local, the helper in a settings file, the sign-in in the env', POSIX_SHIM, async () => {
  const dir = tmp();
  const cfg = join(dir, 'cfg');
  mkdirSync(cfg);
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: 'sk-ant-carried-1' }, apiKeyHelper: 'node key.js', hooks: { PreToolUse: [] } }));
  const argvOut = join(dir, 'argv.txt');
  const envOut = join(dir, 'env.txt');
  const settingsOut = join(dir, 'settings-seen.json');
  const bin = join(dir, 'fake-claude.sh');
  writeFileSync(bin, '#!/bin/sh\n'
    + `for a in "$@"; do printf '%s\\0' "$a" >> ${JSON.stringify(argvOut)}; case "$a" in */settings.json) cp "$a" ${JSON.stringify(settingsOut)};; esac; done\n`
    + `env > ${JSON.stringify(envOut)}\nexit 0\n`);
  chmodSync(bin, 0o755);
  const prev = { mock: process.env.WORCA_MOCK, cfg: process.env.CLAUDE_CONFIG_DIR };
  delete process.env.WORCA_MOCK;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try {
    await runClaude({ cwd: dir, bin, prompt: 'p', allowedTools: ['Bash'], settingSources: [...PLUGINS_OFF_SOURCES], pluginsOff: true });
  } finally {
    if (prev.mock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prev.mock;
    if (prev.cfg === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev.cfg;
  }
  const argv = readFileSync(argvOut, 'utf8').split('\0').filter(Boolean);
  assert.equal(argv[argv.indexOf('--setting-sources') + 1], 'project,local');
  assert.ok(existsSync(settingsOut), 'a --settings file reached the CLI');
  assert.deepEqual(JSON.parse(readFileSync(settingsOut, 'utf8')), { apiKeyHelper: 'node key.js' });
  assert.ok(!argv.some((a) => a.includes('node key.js')), 'never on the command line');
  assert.match(readFileSync(envOut, 'utf8'), /^ANTHROPIC_API_KEY=sk-ant-carried-1$/m);
});

test('D81: the person\'s deny rules after Worca\'s and the try guard\'s, the sandbox kept, and only ever in a file', () => {
  const S = { deny: ['Bash(rm -rf:*)', 'Read(.env*)'], sandbox: { enabled: true } };
  const p = buildSettingsPayload({ deny: ['Read(.env*)'] }, { safetySettings: S });
  assert.deepEqual(p.settings.permissions.deny, ['Read(.env*)', 'Bash(rm -rf:*)']);
  assert.deepEqual(p.settings.sandbox, { enabled: true });
  assert.equal(p.signIn, true, 'a file, never inline');
  const tg = { logFile: '/x/calls.ndjson' };
  const base = (buildSettingsPayload(null, { tryGuard: tg }).settings.permissions || {}).deny || [];
  assert.deepEqual(buildSettingsPayload(null, { tryGuard: tg, safetySettings: S }).settings.permissions.deny, [...new Set([...base, ...S.deny])]);
  assert.equal(buildSettingsPayload(null, { safetySettings: { deny: [], sandbox: null } }), null, 'nothing to carry: no flag');
  assert.throws(() => buildClaudeArgs({ ...BASE, safetySettings: S }), /settings file/);
  const dir = tmp();
  const plan = planClaudeInvocation({ ...BASE, safetySettings: S }, { bin: 'claude', dir });
  assert.equal(plan.args[plan.args.indexOf('--settings') + 1], join(dir, 'settings.json'));
});

test('D81: the guards are carried in every case: with no sign-in, with the broker on, into an agent user\'s spawn', () => {
  const none = () => ({ state: 'none', env: {}, settings: {} });
  const found = () => ({ state: 'found', env: { ANTHROPIC_API_KEY: 'sk-ant-1' }, settings: {} });
  const safe = () => ({ deny: ['Bash(rm -rf:*)'], sandbox: null });
  const empty = () => ({ deny: [], sandbox: null });
  const G = { deny: ['Bash(rm -rf:*)'], sandbox: null };
  assert.deepEqual(signInCarry({ read: none, readSafety: safe }), { env: {}, settings: {}, safety: G });
  assert.equal(signInCarry({ read: none, readSafety: empty }), null);
  assert.deepEqual(signInCarry({ read: found, readSafety: empty }), { env: { ANTHROPIC_API_KEY: 'sk-ant-1' }, settings: {} }, 'no guards: no safety key');
  assert.deepEqual(signInCarry({ read: found, readSafety: safe, asAgent: true, agentUser: () => ({ user: 'a' }) }), { env: {}, settings: {}, safety: G },
    'the sign-in stays with its user; the guards come along');
  const prev = process.env.WORCA_BROKER_URL;
  process.env.WORCA_BROKER_URL = 'http://127.0.0.1:1';
  try { assert.deepEqual(signInCarry({ read: found, readSafety: safe }), { env: {}, settings: {}, safety: G }); }
  finally { if (prev === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = prev; }
});

test('D81a: the guards are read with the spawn\'s working directory, so the checkout\'s own sandbox stays on top', () => {
  const none = () => ({ state: 'none', env: {}, settings: {} });
  let seen = 'unset';
  const S = { deny: [], sandbox: { enabled: true } };
  assert.deepEqual(signInCarry({ read: none, readSafety: (o) => { seen = o.cwd; return S; }, cwd: '/try/checkout' }), { env: {}, settings: {}, safety: S });
  assert.equal(seen, '/try/checkout');
  signInCarry({ read: none, readSafety: (o) => { seen = o.cwd; return S; } });
  assert.equal(seen, null, 'no working directory: none passed');
});

// ── Task 5 (security review C1, M8): Worca's --settings payload carries only values the CLI accepts ─────────────────────────
test('C1: buildSettingsPayload never carries a sandbox the CLI would reject; a valid one is kept', () => {
  for (const sandbox of [{ enabled: 'yes' }, { excludedCommands: 'docker' }, { network: true }, { notAKey: 1 }]) {
    const p = buildSettingsPayload({ deny: ['Bash(curl:*)'] }, { safetySettings: { deny: ['Bash(rm:*)'], sandbox } });
    assert.equal('sandbox' in p.settings, false, JSON.stringify(sandbox));
    assert.deepEqual(p.settings.permissions.deny, ['Bash(curl:*)', 'Bash(rm:*)'], 'the deny rules still go');
  }
  assert.equal(buildSettingsPayload(null, { safetySettings: { deny: [], sandbox: { enabled: 'yes' } } }), null, 'nothing valid left: no flag');
  assert.deepEqual(buildSettingsPayload(null, { safetySettings: { deny: [], sandbox: { enabled: true } } }).settings.sandbox, { enabled: true });
});

test('M8: the permission rules in the payload are only allow / ask / deny lists of strings', () => {
  const S = { deny: ['Bash(rm:*)'], sandbox: null };
  const p = buildSettingsPayload({ allow: 'x', ask: [1, 'Bash(git push:*)'], deny: ['Read(.env*)', null], other: ['y'] }, { safetySettings: S });
  assert.deepEqual(p.settings.permissions, { ask: ['Bash(git push:*)'], deny: ['Read(.env*)', 'Bash(rm:*)'] });
  const tg = buildSettingsPayload({ allow: 'x' }, { tryGuard: { logFile: '/x/calls.ndjson' } });
  assert.equal('allow' in tg.settings.permissions, false, 'the try guard\'s rules with a malformed allow');
  assert.ok(Object.values(tg.settings.permissions).every((a) => Array.isArray(a) && a.every((x) => typeof x === 'string')));
  const ok = { allow: ['Read'], deny: ['Bash(curl:*)'] };
  assert.deepEqual(buildSettingsPayload(ok, {}).settings.permissions, ok, 'valid rules: unchanged');
  assert.deepEqual(Object.keys(buildSettingsPayload({ deny: ['a'], allow: ['b'] }, {}).settings.permissions), ['deny', 'allow'], 'their order kept');
});

test('C1/L5: what the carry says reaches the run: the sandbox warnings, and how many personal deny rules were carried', async () => {
  const none = () => ({ state: 'none', env: {}, settings: {} });
  const W = 'Worca did not carry your sandbox settings: sandbox.enabled is not valid.';
  assert.deepEqual(signInCarry({ read: none, readSafety: () => ({ deny: [], sandbox: null, warnings: [W] }) }), { env: {}, settings: {}, warnings: [W] },
    'a warning alone is still said');
  assert.deepEqual(signInCarry({ read: none, readSafety: () => ({ deny: ['Bash(x)'], sandbox: null, warnings: [W, 3] }) }),
    { env: {}, settings: {}, safety: { deny: ['Bash(x)'], sandbox: null }, warnings: [W] });
  assert.deepEqual(carryLine(`${CARRY_WARNING_PREFIX}${W}`), { kind: 'warning', text: W });
  assert.deepEqual(carryLine(`${CARRY_NOTE_PREFIX}x`), { kind: 'note', text: 'x' });
  assert.equal(carryLine('[worca] spawn-debug: x'), null);
  // The runner says them before it spawns (a CLI that cannot start still leaves them in the run).
  const cfg = tmp();
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify({ sandbox: { enabled: 'yes' }, permissions: { deny: ['Bash(rm:*)', 'Read(.env)'] } }));
  const prev = { cfg: process.env.CLAUDE_CONFIG_DIR, mock: process.env.WORCA_MOCK };
  process.env.CLAUDE_CONFIG_DIR = cfg;
  delete process.env.WORCA_MOCK;
  const events = [];
  try {
    await assert.rejects(runClaudeProcess({ cwd: tmp(), bin: join(cfg, 'no-such-claude.exe'), prompt: 'p', allowedTools: ['Read'], pluginsOff: true,
      settingSources: ['project'], onEvent: (e) => events.push(e) }));
  } finally {
    if (prev.cfg === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev.cfg;
    if (prev.mock !== undefined) process.env.WORCA_MOCK = prev.mock;
  }
  const said = events.filter((e) => e.type === 'stderr').map((e) => carryLine(e.text)).filter(Boolean);
  assert.deepEqual(said, [{ kind: 'warning', text: W }, { kind: 'note', text: 'This try also follows 2 deny rules from your own Claude Code settings.' }]);
});

test('C1/L5: the run records a carry warning once as a run warning, a carry note once in its log; other stderr as before', async () => {
  const logs = [];
  const warnings = [];
  const h = { _log: (...a) => logs.push(a), _recordRunWarning: async (t) => { warnings.push(t); } };
  const say = (text) => RunHarness.prototype._onStderrEvent.call(h, 'implementer', { type: 'stderr', text }, { nodeId: 'n1' });
  for (let i = 0; i < 3; i++) { say(`${CARRY_WARNING_PREFIX}W1`); say(`${CARRY_NOTE_PREFIX}N1`); }
  say('plain stderr');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(warnings, ['W1']);
  assert.deepEqual(logs, [['implementer', 'info', 'N1', { nodeId: 'n1' }], ['implementer', 'warn', 'plain stderr', { nodeId: 'n1', stream: 'err' }]]);
});
