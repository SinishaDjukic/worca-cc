// test/workflow-test-plugins-off.test.mjs — workflow tests 3b, Task 2 (D70, D71): a Pretend try's spawns load no user settings,
// carry only the sign-in kept there, and every other spawn stays byte-identical.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, existsSync, linkSync, renameSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSettingsPayload, buildClaudeArgs, planClaudeInvocation, signInCarry, secretValuesOf, runClaudeProcess, carryLine, CARRY_WARNING_PREFIX, CARRY_NOTE_PREFIX,
  carryRedactValues, carryOverModelEnv, sweepStaleStagingDirs, STAGING_PREFIX, redactTryLog, _testing } from '../src/core/engines/claude.mjs';
import { createRedactor } from '../src/core/redact.mjs';
import { openTryLog, pendingTryLogRedactor, redactTryLogRetrying, _testing as tryLogTesting } from '../src/core/engines/try-log-redaction.mjs';
import { RunHarness } from '../src/core/run-harness.mjs';
import { composeSpawnEnv } from '../src/core/engines/spawn.mjs';
import { SETTINGS_IGNORED_FILE } from '../src/core/workflow-tests/try-guard-env.mjs';
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
/** Runs `fn` with CLAUDE_CONFIG_DIR at `cfg` and no WORCA_MOCK, both restored after. */
async function withConfigDir(cfg, fn) {
  const prev = { cfg: process.env.CLAUDE_CONFIG_DIR, mock: process.env.WORCA_MOCK };
  process.env.CLAUDE_CONFIG_DIR = cfg;
  delete process.env.WORCA_MOCK;
  try { return await fn(); } finally {
    if (prev.cfg === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev.cfg;
    if (prev.mock !== undefined) process.env.WORCA_MOCK = prev.mock;
  }
}

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
  assert.deepEqual(secretValuesOf({ ANTHROPIC_BASE_URL: 'https://user1:pa55word@gw.example.com' }), ['https://user1:pa55word@gw.example.com', 'user1', 'pa55word'], 'review m7: the whole carried URL too');
  assert.deepEqual(secretValuesOf({ HTTPS_PROXY: 'http://puser:ppass99@proxy.example.com:8080' }), ['http://puser:ppass99@proxy.example.com:8080', 'puser', 'ppass99']);
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

test('D81/M12: the guards come with no sign-in too; never with the broker on or into an agent user\'s spawn (the operator\'s rules stay private)', () => {
  const none = () => ({ state: 'none', env: {}, settings: {} });
  const found = () => ({ state: 'found', env: { ANTHROPIC_API_KEY: 'sk-ant-1' }, settings: {} });
  let read = 0;
  const safe = () => { read++; return { deny: ['Bash(rm -rf:*)'], sandbox: null, warnings: ['W'], notes: ['N'] }; };
  const empty = () => ({ deny: [], sandbox: null });
  const G = { deny: ['Bash(rm -rf:*)'], sandbox: null };
  assert.deepEqual(signInCarry({ read: none, readSafety: safe }), { env: {}, settings: {}, safety: G, warnings: ['W'], notes: ['N'] });
  assert.equal(signInCarry({ read: none, readSafety: empty }), null);
  assert.deepEqual(signInCarry({ read: found, readSafety: empty }), { env: { ANTHROPIC_API_KEY: 'sk-ant-1' }, settings: {} }, 'no guards: no safety key');
  read = 0;
  assert.equal(signInCarry({ read: found, readSafety: safe, asAgent: true, agentUser: () => ({ user: 'a' }) }), null, 'an agent user: nothing at all');
  const prev = process.env.WORCA_BROKER_URL;
  process.env.WORCA_BROKER_URL = 'http://127.0.0.1:1';
  try { assert.equal(signInCarry({ read: found, readSafety: safe }), null, 'the broker on: nothing at all'); }
  finally { if (prev === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = prev; }
  assert.equal(read, 0, 'the guards are not even read');
});

test('M3: an agent user that cannot be looked up counts as one: nothing is carried (fail closed)', () => {
  const found = () => ({ state: 'found', env: { ANTHROPIC_API_KEY: 'sk-ant-1' }, settings: { apiKeyHelper: 'node key.js' } });
  const safe = () => ({ deny: ['Bash(x)'], sandbox: null });
  assert.equal(signInCarry({ read: found, readSafety: safe, asAgent: true, agentUser: () => { throw new Error('no pool'); } }), null);
  assert.deepEqual(signInCarry({ read: found, readSafety: () => ({ deny: [], sandbox: null }), asAgent: false, agentUser: () => { throw new Error('x'); } }).settings,
    { apiKeyHelper: 'node key.js' }, 'not run as an agent: the lookup is not asked');
});

test('M7/M11: the guards are read with the spawn\'s sources and whether the run itself loads user settings', () => {
  const none = () => ({ state: 'none', env: {}, settings: {} });
  let seen = null;
  signInCarry({ read: none, readSafety: (o) => { seen = o; return { deny: [], sandbox: null }; }, sources: ['project'], userLoaded: false });
  assert.deepEqual([seen.sources, seen.userLoaded], [['project'], false]);
  signInCarry({ read: none, readSafety: (o) => { seen = o; return { deny: [], sandbox: null }; } });
  assert.deepEqual([seen.sources, seen.userLoaded], [undefined, true], 'not said: both sources, as before');
  const ro = (ctx) => runOpts({ projectDir: '/p', claudeOpts: {}, pluginsOff: true, ...ctx }, OPTS);
  assert.equal(ro({ claudeSettingSources: null }).runLoadsUserSettings, true, 'a run that loads every source');
  assert.equal('runLoadsUserSettings' in ro({ claudeSettingSources: ['project'] }), false, 'a project-only run');
  assert.equal('runLoadsUserSettings' in ro({}), false);
  assert.equal('runLoadsUserSettings' in runOpts({ projectDir: '/p', claudeOpts: {}, claudeSettingSources: null }, OPTS), false, 'not a Pretend try: absent');
});

test('concern 1: the guards are read knowing Worca\'s own deny rules, and runClaudeProcess passes its permission rules\' deny list', async () => {
  const none = () => ({ state: 'none', env: {}, settings: {} });
  let seen = null;
  signInCarry({ read: none, readSafety: (o) => { seen = o; return { deny: [], sandbox: null }; }, ownDeny: ['Read(//x)'] });
  assert.deepEqual(seen.ownDeny, ['Read(//x)']);
  signInCarry({ read: none, readSafety: (o) => { seen = o; return { deny: [], sandbox: null }; } });
  assert.deepEqual(seen.ownDeny, [], 'not said: none');
  const cfg = tmp();
  const cwd = tmp();
  mkdirSync(join(cwd, '.claude'));
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify({ sandbox: { enabled: true } }));
  writeFileSync(join(cwd, '.claude', 'settings.json'), JSON.stringify({ sandbox: { filesystem: { allowRead: ['/p'] } } }));
  const settingsOf = async (permissionRules) => {
    let payload = null;
    _testing.set({ superviseSpawn: (o) => { const i = o.args.indexOf('--settings'); payload = JSON.parse(readFileSync(o.args[i + 1], 'utf8')); o.cleanup(); return Promise.resolve({ text: '' }); } });
    try { await withConfigDir(cfg, () => runClaudeProcess({ cwd, prompt: 'p', allowedTools: ['Read'], pluginsOff: true, settingSources: ['project'], permissionRules, onEvent: () => {} })); } finally { _testing.reset(); }
    return payload;
  };
  assert.deepEqual((await settingsOf({ deny: ['Read(//**/.worca-cc/settings.json)'] })).sandbox, { enabled: true, autoAllowBashIfSandboxed: false });
  assert.deepEqual((await settingsOf(null)).sandbox, { enabled: true, autoAllowBashIfSandboxed: false, filesystem: { allowRead: ['/p'] } });
});

test('M4: a Pretend try whose run sources hold neither project nor local still never loads every source', () => {
  const o = runOpts({ projectDir: '/p', claudeOpts: {}, pluginsOff: true, claudeSettingSources: ['user'] }, OPTS);
  assert.deepEqual(o.settingSources, ['project']);
  assert.deepEqual(runOpts({ projectDir: '/p', claudeOpts: {}, pluginsOff: true, claudeSettingSources: [] }, OPTS).settingSources, ['project']);
});

test('D81b/L5: the carry\'s notes reach the run log as carry notes, after its warnings and before the deny count', async () => {
  const none = () => ({ state: 'none', env: {}, settings: {} });
  const cfg = tmp();
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify({ sandbox: { enabled: true, ignoreViolations: { '*': ['rel'] } }, permissions: { deny: ['Bash(rm:*)'] } }));
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
  assert.deepEqual(said.map((x) => x.kind), ['note', 'note']);
  assert.match(said[0].text, /sandbox\.ignoreViolations\.\*\[0\]/);
  assert.equal(said[1].text, 'This try also follows 1 deny rule from your own Claude Code settings.');
  assert.ok(signInCarry({ read: none, readSafety: () => ({ deny: [], sandbox: null, notes: ['N', 3] }) }).notes.length === 1, 'only text notes');
});

// ── Task 5 (security review I3, decision D71b): the carried sign-in sits where a normal run puts the user settings' env ─────
test('I3: the carried env sits over a model profile\'s env (as user settings env does in a normal run), but under Worca\'s own bridge', () => {
  const { env } = composeSpawnEnv({ envScrub: true, envAllowlist: [], runEnv: { A: 'run' }, signInEnv: { ANTHROPIC_BASE_URL: 'https://corp-gw', ANTHROPIC_CUSTOM_HEADERS: 'x-corp-key: S' },
    overlay: { ANTHROPIC_BASE_URL: 'https://vendor.example', ANTHROPIC_AUTH_TOKEN: 't', B: 'model' }, signInOverModel: true });
  assert.deepEqual([env.ANTHROPIC_BASE_URL, env.ANTHROPIC_CUSTOM_HEADERS, env.ANTHROPIC_AUTH_TOKEN, env.B, env.A],
    ['https://corp-gw', 'x-corp-key: S', 't', 'model', 'run'], 'the person\'s header goes only to the person\'s own gateway');
  assert.equal(carryOverModelEnv({ ANTHROPIC_BASE_URL: 'https://vendor.example' }), true);
  assert.equal(carryOverModelEnv(null), true);
  assert.equal(carryOverModelEnv({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:4100/m/claude-sonnet-4-5' }), false, 'Worca\'s in-process bridge');
  assert.equal(carryOverModelEnv({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:4100/m/x/r/tag' }), false);
  const bridged = composeSpawnEnv({ envScrub: true, envAllowlist: [], signInEnv: { ANTHROPIC_BASE_URL: 'https://corp-gw' },
    overlay: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:4100/m/x' }, signInOverModel: false }).env;
  assert.equal(bridged.ANTHROPIC_BASE_URL, 'http://127.0.0.1:4100/m/x');
});

// ── Task 5 (security review M1, M9): what the run redacts of a carry ─────────────────────────────────────────────────────
test('M1: the carried helper strings are redacted like the carried env', () => {
  const carry = { env: { ANTHROPIC_API_KEY: 'sk-ant-1234567890' }, settings: { apiKeyHelper: 'echo sk-ant-helper-0001', awsAuthRefresh: 'aws x' } };
  const r = createRedactor(carryRedactValues(carry));
  assert.equal(r.text('helper failed: echo sk-ant-helper-0001 exited 1'), 'helper failed: [redacted] exited 1');
  assert.equal(r.text('aws x'), 'aws x', 'shorter than 8 characters: left as it is');
  assert.equal(r.text('key sk-ant-1234567890'), 'key [redacted]');
  assert.deepEqual(carryRedactValues(null), []);
});

test('M9 (review m7): plain routing keys are not redacted; a carried URL is, whole, with its query, its login and only its secret-looking path segments', () => {
  assert.deepEqual(secretValuesOf({ AWS_DEFAULT_REGION: 'eu-central-1', VERTEX_REGION_CLAUDE_3_5_SONNET: 'europe-west1' }), []);
  const u = 'https://gw.example.com/tenant/sk9f8d7a6s5d4f3g2h1j/v1?key=abcdef123456';
  assert.deepEqual(secretValuesOf({ ANTHROPIC_BASE_URL: u }), [u, '?key=abcdef123456', 'sk9f8d7a6s5d4f3g2h1j'],
    'the whole URL, its query, and a segment of 16+ token characters; never a short segment such as /tenant or /v1');
  assert.deepEqual(secretValuesOf({ HTTPS_PROXY: 'http://us%40r:p%3Ass word@proxy.example.com:8080' }),
    ['http://us%40r:p%3Ass word@proxy.example.com:8080', 'us%40r', 'p%3Ass word', 'us@r', 'p:ss word', 'p%3Ass%20word'], 'as written, decoded, and as URL re-encodes it');
  assert.deepEqual(secretValuesOf({ ANTHROPIC_BASE_URL: 'https://user1:pa55word@gw.example.com' }), ['https://user1:pa55word@gw.example.com', 'user1', 'pa55word']);
  const r = createRedactor(secretValuesOf({ ANTHROPIC_BASE_URL: 'https://gw.example.com/anthropic' }));
  assert.equal(r.text('see github.com/anthropics/claude-code and https://gw.example.com/anthropic'), 'see github.com/anthropics/claude-code and [redacted]',
    'a plain gateway path such as /anthropic is not blanked everywhere');
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

// ── Task 5 (security review M2): no staging folder is left behind, and old ones are swept ───────────────────────────────
test('M2: a synchronous throw after staging removes the staging folder and the error is redacted', async () => {
  const before = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith(STAGING_PREFIX)));
  const runEnv = {};
  Object.defineProperty(runEnv, 'A', { enumerable: true, get() { throw new Error('boom sk-ant-secret-0001'); } });
  await assert.rejects(runClaudeProcess({ cwd: tmp(), bin: 'claude', prompt: 'p'.repeat(50), allowedTools: ['Read'], argvInlineLimit: 1, spawnEnv: runEnv,
    redactValues: ['sk-ant-secret-0001'], onEvent: () => {} }), (err) => /boom \[redacted\]/.test(err.message));
  const left = readdirSync(tmpdir()).filter((n) => n.startsWith(STAGING_PREFIX) && !before.has(n));
  assert.deepEqual(left, []);
});

test('M2: the boot sweep removes staging folders older than a day, never a newer one, a file or a link', () => {
  const d = tmp();
  const old = join(d, `${STAGING_PREFIX}old`);
  const fresh = join(d, `${STAGING_PREFIX}fresh`);
  const busy = join(d, `${STAGING_PREFIX}busy`);
  for (const p of [old, fresh, busy]) mkdirSync(p);
  writeFileSync(join(old, 'settings.json'), '{}');
  writeFileSync(join(busy, 'read-guard.jsonl'), '');
  writeFileSync(join(d, `${STAGING_PREFIX}file`), 'x');
  const day = 24 * 60 * 60 * 1000;
  const t = (Date.now() - 2 * day) / 1000;
  for (const p of [old, join(old, 'settings.json'), busy]) utimesSync(p, t, t);
  assert.deepEqual(sweepStaleStagingDirs({ dir: d }), [`${STAGING_PREFIX}old`]);
  assert.deepEqual([existsSync(old), existsSync(fresh), existsSync(busy)], [false, true, true], 'a folder whose file is new is still in use');
  assert.deepEqual(sweepStaleStagingDirs({ dir: join(d, 'missing') }), [], 'never throws');
});

test('M11: the payload of a project-only run\'s Pretend spawn says autoAllowBashIfSandboxed: false', () => {
  const cfg = tmp();
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify({ sandbox: { enabled: true } }));
  const none = () => ({ state: 'none', env: {}, settings: {} });
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try {
    const off = signInCarry({ read: none, sources: ['project'], userLoaded: false });
    assert.deepEqual(buildSettingsPayload(null, { safetySettings: off.safety }).settings.sandbox, { enabled: true, autoAllowBashIfSandboxed: false });
    const on = signInCarry({ read: none, sources: ['project', 'local'], userLoaded: true });
    assert.deepEqual(buildSettingsPayload(null, { safetySettings: on.safety }).settings.sandbox, { enabled: true });
  } finally { if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev; }
});

// ── Task 5 (M13): the try's connector-calls.ndjson is redacted like the transcript when a spawn ends ─────────────────────
test('M13: redactTryLog rewrites whole lines through the redactor; a torn last line, an unchanged file and a link are left as they are', () => {
  const d = tmp();
  const log = join(d, 'connector-calls.ndjson');
  const line = (text) => JSON.stringify({ ts: 't', server: 's', tool: 'post', arguments: { text } });
  writeFileSync(log, `${line('key sk-ant-secret-0001')}\n${line('plain')}\n{"torn sk-ant-secret-0001`);
  const r = createRedactor(['sk-ant-secret-0001']);
  assert.equal(redactTryLog(log, r), true);
  assert.equal(readFileSync(log, 'utf8'), `${line('key [redacted]')}\n${line('plain')}\n{"torn sk-ant-secret-0001`);
  assert.deepEqual(readdirSync(d), ['connector-calls.ndjson'], 'no temp file left');
  assert.equal(redactTryLog(log, r), false, 'nothing to change: not rewritten');
  assert.equal(redactTryLog(join(d, 'missing.ndjson'), r), false, 'no log: nothing');
  const outside = join(tmp(), 'real.ndjson');
  writeFileSync(outside, `${line('sk-ant-secret-0001')}\n`);
  let linked = true;
  try { symlinkSync(outside, join(d, 'linked.ndjson')); } catch { linked = false; }
  if (linked) {
    assert.equal(redactTryLog(join(d, 'linked.ndjson'), r), false);
    assert.equal(readFileSync(outside, 'utf8'), `${line('sk-ant-secret-0001')}\n`, 'never through a link');
  }
});

test('M13: a spawn with a redactor and a try guard redacts the try log when it ends', async () => {
  const d = tmp();
  const log = join(d, 'connector-calls.ndjson');
  writeFileSync(log, `${JSON.stringify({ ts: 't', server: 's', tool: 'post', arguments: { text: 'sk-ant-secret-0002' } })}\n`);
  await assert.rejects(runClaudeProcess({ cwd: d, bin: join(d, 'no-such-claude.exe'), prompt: 'p', allowedTools: ['Read'], tryGuard: { logFile: log },
    redactValues: ['sk-ant-secret-0002'], onEvent: () => {} }));
  assert.equal(JSON.parse(readFileSync(log, 'utf8')).arguments.text, '[redacted]');
});

// ── Task 5 fix review (I-1): the try log is rewritten once, when its last spawn ends; a refused rename is tried again ───────
const callLine = (text) => `${JSON.stringify({ ts: 't', server: 's', tool: 'post', arguments: { text } })}\n`;
const ticks = async (n = 50) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

test('I-1: a rename refused with EPERM once is tried again and succeeds', async () => {
  const log = join(tmp(), 'connector-calls.ndjson');
  writeFileSync(log, callLine('sk-ant-retry-secret-01'));
  let calls = 0;
  tryLogTesting.set({ rename: (a, b) => { calls++; if (calls === 1) throw Object.assign(new Error('busy'), { code: 'EPERM' }); renameSync(a, b); }, sleep: async () => {} });
  try {
    assert.equal(await redactTryLogRetrying(log, createRedactor(['sk-ant-retry-secret-01'])), 'rewritten');
  } finally { tryLogTesting.reset(); }
  assert.equal(calls, 2);
  assert.equal(JSON.parse(readFileSync(log, 'utf8')).arguments.text, '[redacted]');
  assert.deepEqual(readdirSync(join(log, '..')), ['connector-calls.ndjson'], 'no temp file left');
});

test('I-1: two overlapping spawns on one log: nothing is rewritten until the last ends, then every line is kept, redacted by both', async () => {
  const log = join(tmp(), 'connector-calls.ndjson');
  writeFileSync(log, '');
  const relA = openTryLog(log, createRedactor(['sk-ant-spawn-a-secret']));
  const relB = openTryLog(log, createRedactor(['sk-ant-spawn-b-secret']));
  appendFileSync(log, callLine('a sk-ant-spawn-a-secret'));
  relA();
  relA();   // a second call does nothing
  assert.match(readFileSync(log, 'utf8'), /sk-ant-spawn-a-secret/, 'B still writes: not rewritten yet');
  appendFileSync(log, callLine('b sk-ant-spawn-b-secret and sk-ant-spawn-a-secret'));
  assert.ok(pendingTryLogRedactor(log), 'held while spawns write');
  relB();
  await ticks();
  const lines = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l).arguments.text);
  assert.deepEqual(lines, ['a [redacted]', 'b [redacted] and [redacted]']);
  assert.equal(pendingTryLogRedactor(log), null, 'rewritten: nothing held');
});

test('I-1: a rename that keeps failing leaves the raw log, warns once, and keeps the redactors for the read path', async () => {
  const log = join(tmp(), 'connector-calls.ndjson');
  writeFileSync(log, callLine('sk-ant-stuck-secret-01'));
  const warned = [];
  let calls = 0;
  tryLogTesting.set({ rename: () => { calls++; throw Object.assign(new Error('busy'), { code: 'EBUSY' }); }, sleep: async () => {}, warn: (t) => warned.push(t) });
  try {
    openTryLog(log, createRedactor(['sk-ant-stuck-secret-01']))();
    await ticks();
    assert.equal(calls, 11, 'the first try and ten retries');
    assert.equal(warned.length, 1);
    assert.doesNotMatch(warned[0], /sk-ant/);
    assert.match(readFileSync(log, 'utf8'), /sk-ant-stuck-secret-01/);
    assert.equal(pendingTryLogRedactor(log).text('x sk-ant-stuck-secret-01'), 'x [redacted]');
    openTryLog(log, createRedactor(['other-secret-000']))();   // a later spawn on the same log: one warning still
    await ticks();
    assert.equal(warned.length, 1);
  } finally { tryLogTesting.reset(); }
});

test('I-1: runClaudeProcess holds the log while a sibling spawn on it still runs, and rewrites it when the last one ends', async () => {
  const d = tmp();
  const log = join(d, 'connector-calls.ndjson');
  writeFileSync(log, callLine('x sk-ant-sibling-secret-1'));
  const ends = [];
  _testing.set({ superviseSpawn: (o) => new Promise((res) => { ends.push(() => { o.cleanup(); res({ text: '' }); }); }) });
  try {
    const run = (s) => runClaudeProcess({ cwd: d, prompt: 'p', allowedTools: ['Read'], tryGuard: { logFile: log }, redactValues: [s], onEvent: () => {} });
    const a = run('sk-ant-sibling-secret-1');
    const b = run('sk-ant-sibling-secret-2');
    appendFileSync(log, callLine('y sk-ant-sibling-secret-2'));
    ends[1]();
    await b;
    await ticks();
    assert.equal(readFileSync(log, 'utf8'), callLine('x sk-ant-sibling-secret-1') + callLine('y sk-ant-sibling-secret-2'),
      'the sibling still runs (it may still append): not rewritten until its end');
    ends[0]();
    await a;
    await ticks();
    assert.doesNotMatch(readFileSync(log, 'utf8'), /sk-ant-sibling-secret/);
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 2);
  } finally { _testing.reset(); }
});

// ── Task 5 fix review (concern 8): a canary catches a --settings file Claude Code silently dropped ────────────────────────
const settingsOfArgs = (args) => { const v = args[args.indexOf('--settings') + 1]; return JSON.parse(v.startsWith('{') ? v : readFileSync(v, 'utf8')); };
const canaryMarkOf = (settings) => {
  const cmd = settings.hooks.SessionStart[0].hooks[0].command;
  return JSON.parse(cmd.slice(cmd.lastIndexOf(' "') + 1));
};

test('concern 8: the payload carries the canary\'s SessionStart hook only when the try guard names a canary', () => {
  const s = buildSettingsPayload(null, { tryGuard: { logFile: '/run/connector-calls.ndjson', canary: '/run/.worca-settings-canary-ab' } }).settings;
  assert.equal(s.hooks.SessionStart.length, 1);
  assert.match(s.hooks.SessionStart[0].hooks[0].command, /settings-canary\.mjs" "\/run\/\.worca-settings-canary-ab"$/);
  assert.equal(s.disableAllHooks, false);
  assert.equal('SessionStart' in buildSettingsPayload(null, { tryGuard: { logFile: '/run/connector-calls.ndjson' } }).settings.hooks, false);
});

/** One Pretend spawn through the seam: `mark` writes the canary's marker (as the CLI would run the hook), `init` the session start. */
async function canarySpawn({ mark, init = true, pluginsOff = true, exit = 0, before = null }) {
  const d = tmp();
  if (before) before(d);
  const log = join(d, 'connector-calls.ndjson');
  const events = [];
  let settings = null;
  let failed = null;
  _testing.set({ superviseSpawn: (o) => {
    settings = settingsOfArgs(o.args);
    if (mark && settings.hooks.SessionStart) writeFileSync(canaryMarkOf(settings), 'ok');
    if (init) o.onStdoutLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }));
    if (exit !== 0) { o.cleanup(); return Promise.reject(new Error(`claude exited with code ${exit}`)); }   // as superviseSpawn: no onDone
    const r = o.onDone(0);
    o.cleanup();
    return Promise.resolve(r);
  } });
  try {
    await withConfigDir(tmp(), () => runClaudeProcess({ cwd: tmp(), prompt: 'p', allowedTools: ['Read'], tryGuard: { logFile: log },
      ...(pluginsOff ? { pluginsOff: true, settingSources: ['project'] } : {}), onEvent: (e) => events.push(e) }));
  } catch (e) { failed = e; } finally { _testing.reset(); }
  const said = events.filter((e) => e.type === 'stderr').map((e) => carryLine(e.text)).filter(Boolean);
  return { d, settings, said, failed, ignored: existsSync(join(d, SETTINGS_IGNORED_FILE)), left: readdirSync(d).filter((n) => n !== SETTINGS_IGNORED_FILE) };
}
const SETTINGS_NOT_LOADED = 'Claude Code did not load Worca\'s settings for this try (an invalid settings file or a managed hooks policy): its guards may not have applied.';

test('concern 8: a Pretend spawn whose canary wrote its marker: nothing said, the marker removed', async () => {
  const r = await canarySpawn({ mark: true });
  assert.ok(r.settings.hooks.SessionStart, 'a Pretend spawn carries the canary');
  assert.deepEqual(r.said, []);
  assert.equal(r.ignored, false);
  assert.deepEqual(r.left, [], 'the marker is removed when the spawn ends');
});

test('concern 8: a Pretend spawn that started with no marker: one carry warning, and the run folder marks the try as Worca\'s problem', async () => {
  const r = await canarySpawn({ mark: false });
  assert.deepEqual(r.said, [{ kind: 'warning', text: SETTINGS_NOT_LOADED }], 're-review 2 n6: the text names both causes');
  assert.equal(r.ignored, true);
});

test('re-review 2 n1: a Pretend spawn that started with no marker and then FAILED is still judged: Worca\'s problem, not the workflow\'s', async () => {
  const r = await canarySpawn({ mark: false, exit: 1 });
  assert.match(String(r.failed && r.failed.message), /exited with code 1/, 'the spawn still fails');
  assert.deepEqual(r.said, [{ kind: 'warning', text: SETTINGS_NOT_LOADED }]);
  assert.equal(r.ignored, true);
  assert.deepEqual(r.left, [], 'the marker is removed (after the verdict)');
  const ok = await canarySpawn({ mark: true, exit: 1 });
  assert.deepEqual([ok.said, ok.ignored, ok.left], [[], false, []], 'a failed spawn whose canary did run: no verdict');
});

test('re-review 2 n2: the verdict never writes through a link planted at settings-ignored.ndjson (the warning is still said)', async (t) => {
  const outside = join(tmp(), 'outside.txt');
  writeFileSync(outside, 'keep\n');
  let linked = true;
  const r = await canarySpawn({ mark: false, before: (d) => { try { symlinkSync(outside, join(d, SETTINGS_IGNORED_FILE)); } catch { linked = false; } } });
  if (!linked) { t.skip('this machine cannot make file symlinks (EPERM on Windows without developer mode)'); return; }
  assert.equal(readFileSync(outside, 'utf8'), 'keep\n', 'the link target is untouched');
  assert.deepEqual(r.said, [{ kind: 'warning', text: SETTINGS_NOT_LOADED }]);
});

test('re-review 2 n2: nor through a hardlink planted at that name (its other name may be any file the server user can write)', async () => {
  const outside = join(tmp(), 'outside.txt');
  writeFileSync(outside, 'keep\n');
  const r = await canarySpawn({ mark: false, before: (d) => linkSync(outside, join(d, SETTINGS_IGNORED_FILE)) });
  assert.equal(readFileSync(outside, 'utf8'), 'keep\n', 'the other name is untouched');
  assert.deepEqual(r.said, [{ kind: 'warning', text: SETTINGS_NOT_LOADED }], 'the warning is still said');
});

test('concern 8: no session start (the spawn never ran), or not a Pretend spawn: no canary verdict', async () => {
  const r = await canarySpawn({ mark: false, init: false });
  assert.deepEqual([r.said, r.ignored], [[], false]);
  const n = await canarySpawn({ mark: false, pluginsOff: false });
  assert.equal('SessionStart' in n.settings.hooks, false);
  assert.deepEqual([n.said, n.ignored], [[], false]);
});

// ── Task 5 fix review (m11): runClaudeProcess itself hands the spawn the I3 env order and the M1 redaction ───────────────
/** One Pretend spawn through the seam with the person's settings `user`; returns what the spawn was handed. */
async function handedSpawn(user, { modelEnv } = {}) {
  const cfg = tmp();
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify(user));
  let handed = null;
  const events = [];
  _testing.set({ superviseSpawn: (o) => { handed = o; o.onEvent({ type: 'log', text: 'helper said echo sk-ant-helper-abcdef01' }); o.cleanup(); return Promise.resolve({ text: '' }); } });
  try {
    await withConfigDir(cfg, () => runClaudeProcess({ cwd: tmp(), prompt: 'p', allowedTools: ['Read'], pluginsOff: true, settingSources: ['project'],
      ...(modelEnv ? { modelEnv } : {}), onEvent: (e) => events.push(e) }));
  } finally { _testing.reset(); }
  return { handed, events };
}

test('m11 (I3): runClaudeProcess hands the spawn the carried env over a model profile\'s env, and under Worca\'s bridge', async () => {
  const user = { env: { ANTHROPIC_BASE_URL: 'https://corp-gw.example', ANTHROPIC_CUSTOM_HEADERS: 'x-corp-key: S3CRET-HEADER' } };
  const { handed } = await handedSpawn(user, { modelEnv: { ANTHROPIC_BASE_URL: 'https://vendor.example', ANTHROPIC_AUTH_TOKEN: 'vendor-token-0001' } });
  assert.deepEqual([handed.env.ANTHROPIC_BASE_URL, handed.env.ANTHROPIC_CUSTOM_HEADERS, handed.env.ANTHROPIC_AUTH_TOKEN],
    ['https://corp-gw.example', 'x-corp-key: S3CRET-HEADER', 'vendor-token-0001']);
  const bridged = await handedSpawn(user, { modelEnv: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:4100/m/claude-sonnet-4-5' } });
  assert.equal(bridged.handed.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:4100/m/claude-sonnet-4-5', 'Worca\'s bridge stays on top');
});

test('m11 (M1): runClaudeProcess hands the spawn a redactor that hides the carried helper strings, in its events and its error text', async () => {
  const { handed, events } = await handedSpawn({ apiKeyHelper: 'echo sk-ant-helper-abcdef01' });
  assert.equal(handed.redactText('failed: echo sk-ant-helper-abcdef01'), 'failed: [redacted]');
  assert.equal(events.find((e) => e.type === 'log').text, 'helper said [redacted]');
});
