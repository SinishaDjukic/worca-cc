// P1/T14: the sandbox recipe (ask-worca-design.md §6.3) — every element asserted,
// the //-anchoring rule enforced, and the argv proven end to end with a fake bin.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import {
  buildAskSpawnOptions, buildMcpConfig, buildMockMarkers,
  ASK_DENY_RULES, ASK_SPAWN_ENV, SANDBOX_NOTE, ASK_PERMISSION_MODE, ASK_MCP_SERVER_PATH,
  ASK_BUILTIN_TOOLS, askWorktreeAllowRules,
} from '../src/core/ask/spawn.mjs';
import { buildClaudeArgs, runClaude } from '../src/core/claude-runner.mjs';

const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script (no .exe stand-in on Windows)' : false };

const FAKE_HOME = '/Users/zed/.worca-cc';
const base = () => ({
  thread: { id: 'ask_00000001', sessionId: null },
  turn: { prompt: 'hello', systemPrompt: 'SYS', model: 'claude-opus-5', effort: 'high', modelEnv: undefined },
  limits: { maxTurns: 40, maxBudgetUsd: 2 },
  mcpConfigPath: join(FAKE_HOME, 'tmp', 'ask', 'mcp-askm_00000001.json'),
  scratchDir: join(FAKE_HOME, 'tmp', 'ask'),
});

let prevMock, prevOrch;
beforeEach(() => { prevMock = process.env.WORCA_MOCK; prevOrch = process.env.ORCH_MOCK; delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; });
afterEach(() => {
  if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  if (prevOrch === undefined) delete process.env.ORCH_MOCK; else process.env.ORCH_MOCK = prevOrch;
});

test('the recipe: cwd, dontAsk, Task-only built-ins, worca grant, scrub, foreground sub-agents, limits, sandbox note', () => {
  const o = buildAskSpawnOptions(base());
  assert.equal(o.cwd, join(FAKE_HOME, 'tmp', 'ask'));
  assert.ok(o.cwd.endsWith(join('tmp', 'ask')) && o.cwd !== FAKE_HOME, 'never the home itself');
  assert.equal(o.prompt, 'hello');
  assert.equal(o.systemPrompt, 'SYS');
  assert.equal(o.model, 'claude-opus-5');
  assert.equal(o.effort, 'high');
  assert.equal(o.permissionMode, 'dontAsk');
  assert.equal(ASK_PERMISSION_MODE, 'dontAsk');
  assert.deepEqual(o.allowedTools, ['Task']);
  assert.deepEqual(o.tools, ['Task']);
  assert.deepEqual(o.mcpServerGrants, ['mcp__worca']);
  assert.equal(o.mcpConfigPath, join(FAKE_HOME, 'tmp', 'ask', 'mcp-askm_00000001.json'));
  assert.equal(o.envScrub, true);
  assert.deepEqual(o.envAllowlist, ['SSH_AUTH_SOCK'], 'P4 §12 E3: ssh-remote fetch credentials (there is no Bash/sub-shell to leak the socket to)');
  assert.deepEqual(o.modelEnv, { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }, 'probe F1: foreground Task sub-agents');
  assert.deepEqual(ASK_SPAWN_ENV, { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' });
  assert.equal(o.strictMcpConfig, true);
  assert.deepEqual(o.settingSources, ['project']);
  assert.equal(o.disableSlashCommands, true);
  assert.equal(o.includePartialMessages, true);
  assert.equal(o.maxTurns, 40);
  assert.equal(o.maxBudgetUsd, 2);
  assert.equal(o.appendSubagentSystemPrompt, SANDBOX_NOTE);
  assert.ok(SANDBOX_NOTE.includes('mcp__worca__') && SANDBOX_NOTE.includes('Task'));
  assert.equal(o.resumeSessionId, undefined, 'no session yet ⇒ no --resume');
  for (const t of ['Bash', 'Read', 'Write', 'Edit']) assert.ok(!o.allowedTools.includes(t) && !o.tools.includes(t), `${t} never allowed`);
  assert.equal(buildAskSpawnOptions({ ...base(), thread: { id: 'ask_00000001', sessionId: 'sess-1' } }).resumeSessionId, 'sess-1');
  assert.equal(buildAskSpawnOptions({ ...base(), limits: { maxTurns: 7, maxBudgetUsd: null } }).maxBudgetUsd, null, 'null cap passes through (runner omits the flag)');
});

test('deny rules: spec list, every path rule // or ~/ anchored, the resolved home never interpolated', () => {
  const o = buildAskSpawnOptions(base());
  assert.deepEqual(o.permissionRules, { allow: askWorktreeAllowRules('ask_00000001'), deny: [...ASK_DENY_RULES] });
  assert.deepEqual(ASK_DENY_RULES, [
    'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Skill',
    'Read(//**/.worca-cc/**)', 'Read(//**/worca-cc.db*)', 'Read(//**/secrets.json)', 'Read(//**/.env*)',
    'Read(~/.ssh/**)', 'Read(~/.aws/**)',
  ]);
  for (const rule of o.permissionRules.deny) {
    const m = /^\w+\((.*)\)$/.exec(rule);
    if (!m) continue;                                             // bare tool name
    assert.ok(m[1].startsWith('//') || m[1].startsWith('~/'), `${rule} is anchored (a cwd-relative rule protects nothing — probe F6)`);
    assert.ok(!m[1].includes(FAKE_HOME), `${rule} never interpolates the resolved home`);
  }
  assert.ok(Object.isFrozen(ASK_DENY_RULES));
  assert.notEqual(o.permissionRules.deny, ASK_DENY_RULES, 'a copy, never the frozen constant');
});

// ── P4: worktrees under GATE E1 = READ-ONLY-STRICT ───────────────────────────
// The Task-0 probe (claude 2.1.241) measured TWO disqualifying behaviours:
//   (a) a path in NEITHER the allow nor the deny list is READ — `unmatched ⇒ allow`
//       (proven with a neutral file OUTSIDE the probe's cwd, so it is not the
//       default cwd-workspace grant). Granting Read would expose the whole disk
//       minus the enumerated denies, and no deny list can enumerate a disk.
//   (b) `Grep` returned the CONTENTS of a file under a denied path, ignoring both
//       `Read(<path>)` and `Grep(<path>)` denies (the CLI itself reports that only
//       Read(path) rules are matched by file permission checks, and Grep escapes
//       even those).
// So the built-ins stay Task-only, the blanket home deny STAYS, and the worktrees
// are reachable ONLY through the hardened `git` MCP tool (which is cwd-confined and
// applies the protected-path + redaction floor itself). askWorktreeAllowRules is the
// seam that flips if the permission engine ever gains `unmatched ⇒ deny`.
test('P4/E1: no native file tools are granted and the blanket home deny is intact', () => {
  const o = buildAskSpawnOptions(base());
  assert.deepEqual(ASK_BUILTIN_TOOLS, ['Task'], 'E1 READ-ONLY-STRICT: no Read/Grep/Glob');
  assert.deepEqual(o.tools, ['Task']);
  assert.deepEqual(o.allowedTools, ['Task']);
  for (const t of ['Read', 'Grep', 'Glob']) {
    assert.ok(!o.tools.includes(t) && !o.allowedTools.includes(t), `${t} is not granted (gate E1)`);
  }
  assert.ok(ASK_DENY_RULES.includes('Read(//**/.worca-cc/**)'),
    'the blanket home deny is NOT dissolved — dissolving it is only safe under unmatched ⇒ deny');
});

test('P4: askWorktreeAllowRules is empty under E1, shape-checks the thread id, never interpolates the home', () => {
  const o = buildAskSpawnOptions(base());
  assert.deepEqual(o.permissionRules.allow, askWorktreeAllowRules('ask_00000001'));
  assert.deepEqual(askWorktreeAllowRules('ask_00000001'), [], 'E1 READ-ONLY-STRICT: no Read grant to scope');
  assert.deepEqual(askWorktreeAllowRules('../etc'), [], 'unminted id ⇒ NO allow rule (never interpolated)');
  assert.deepEqual(askWorktreeAllowRules(undefined), []);
  for (const rule of o.permissionRules.allow) {
    assert.ok(/^\w+\(\/\//.test(rule), `${rule} is //-anchored`);
    assert.ok(!rule.includes(FAKE_HOME), 'never interpolates the resolved home');
  }
});

test('P4: the settings payload carries the deny list (and the empty allow) through buildClaudeArgs', () => {
  const args = buildClaudeArgs(buildAskSpawnOptions(base()));
  const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
  assert.deepEqual(settings.permissions.deny, [...ASK_DENY_RULES]);
  assert.deepEqual(settings.permissions.allow, []);
  assert.equal(args[args.indexOf('--tools') + 1], 'Task');
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'Task,mcp__worca');
});

test('model env: caller routing env merges under the sandbox var, which always wins', () => {
  const o = buildAskSpawnOptions({ ...base(), turn: { ...base().turn, modelEnv: { ANTHROPIC_BASE_URL: 'http://proxy', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '0' } } });
  assert.deepEqual(o.modelEnv, { ANTHROPIC_BASE_URL: 'http://proxy', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' });
});

test('mock markers go to the SYSTEM prompt only (never the user prompt)', () => {
  const card = { projectKey: 'demo-00000001', workflowId: 'wf_default', brief: 'b', guardrailsId: 'normal' };
  const o = buildAskSpawnOptions({ ...base(), turn: { ...base().turn, mock: { card } } });
  assert.equal(o.systemPrompt, `SYS${buildMockMarkers(card)}`);
  assert.equal(o.prompt, 'hello');
  assert.equal(buildMockMarkers(card), `\n\nMOCK_ROLE: ask\nMOCK_ASK_CARD: ${JSON.stringify(card)}\n`);
  assert.ok(!buildMockMarkers({ a: 'x\ny' }).split('\n').some((l) => l.startsWith('MOCK_ASK_CARD') && !l.endsWith('}')), 'JSON.stringify keeps the card on one line');
});

test('buildClaudeArgs over the recipe carries every flag and never --add-dir', () => {
  const args = buildClaudeArgs(buildAskSpawnOptions(base()));
  const has = (flag, value) => { const i = args.indexOf(flag); assert.ok(i > -1, `${flag} present`); if (value !== undefined) assert.equal(args[i + 1], value, `${flag} value`); };
  has('--permission-mode', 'dontAsk');
  has('--allowedTools', 'Task,mcp__worca');
  has('--tools', 'Task');
  has('--strict-mcp-config');
  has('--setting-sources', 'project');
  has('--disable-slash-commands');
  has('--include-partial-messages');
  has('--max-turns', '40');
  has('--max-budget-usd', '2');
  has('--append-subagent-system-prompt', SANDBOX_NOTE);
  has('--mcp-config', join(FAKE_HOME, 'tmp', 'ask', 'mcp-askm_00000001.json'));
  has('--append-system-prompt', 'SYS');
  assert.ok(!args.includes('--add-dir'));
  assert.ok(!args.includes('--resume'));
  const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
  assert.deepEqual(settings.permissions.deny, [...ASK_DENY_RULES]);
  const noCap = buildClaudeArgs(buildAskSpawnOptions({ ...base(), limits: { maxTurns: 40, maxBudgetUsd: null } }));
  assert.ok(!noCap.includes('--max-budget-usd'));
});

test('fake bin: the whole recipe reaches the spawned argv through runClaude (five gates)', POSIX_SHIM, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-ask-spawn-'));
  const out = join(dir, 'argv.txt');
  const bin = join(dir, 'fake-claude.sh');
  await writeFile(bin, '#!/bin/sh\n' + `for a in "$@"; do printf '%s\\0' "$a" >> ${JSON.stringify(out)}; done\n` + 'exit 0\n', 'utf8');
  await chmod(bin, 0o755);
  const o = buildAskSpawnOptions({ ...base(), scratchDir: dir, mcpConfigPath: join(dir, 'mcp.json') });
  await runClaude({ ...o, bin });
  const argv = (await readFile(out, 'utf8')).split('\0'); argv.pop();
  for (const flag of ['--strict-mcp-config', '--disable-slash-commands', '--include-partial-messages']) assert.ok(argv.includes(flag), flag);
  assert.equal(argv[argv.indexOf('--tools') + 1], 'Task');
  assert.equal(argv[argv.indexOf('--setting-sources') + 1], 'project');
  assert.equal(argv[argv.indexOf('--max-turns') + 1], '40');
  assert.equal(argv[argv.indexOf('--max-budget-usd') + 1], '2');
  assert.equal(argv[argv.indexOf('--append-subagent-system-prompt') + 1], SANDBOX_NOTE);
  assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(argv[argv.indexOf('--allowedTools') + 1], 'Task,mcp__worca');
});

test('buildMcpConfig: resolved base, argv twins of the env, execPath default', () => {
  const cfg = buildMcpConfig({ homeBase: '.worca-cc-test', threadId: 'ask_00000001', serverPath: '/repo/src/core/ask/mcp-stdio.mjs' });
  const b = resolve('.worca-cc-test');
  assert.deepEqual(cfg, { mcpServers: { worca: {
    type: 'stdio', command: process.execPath,
    args: ['--disable-warning=ExperimentalWarning', '/repo/src/core/ask/mcp-stdio.mjs', '--home', b, '--thread', 'ask_00000001'],
    env: { WORCA_HOME: b, WORCA_ASK_THREAD_ID: 'ask_00000001' },
  } } });
  assert.ok(!cfg.mcpServers.worca.env.WORCA_HOME.endsWith('.worca-cc'), 'the RAW base, never worcaHome() (would double the suffix)');
  assert.equal(buildMcpConfig({ homeBase: '/b', threadId: 't', execPath: '/usr/bin/node', serverPath: '/s.mjs' }).mcpServers.worca.command, '/usr/bin/node');
  assert.throws(() => buildMcpConfig({ homeBase: '/b', threadId: 't' }), /serverPath/);
  assert.throws(() => buildMcpConfig({ homeBase: '', threadId: 't', serverPath: '/s.mjs' }), /homeBase/, 'an empty base would silently resolve to process.cwd()');
  assert.ok(ASK_MCP_SERVER_PATH.endsWith(join('src', 'core', 'ask', 'mcp-stdio.mjs')) && isAbsolute(ASK_MCP_SERVER_PATH));
  assert.throws(() => buildAskSpawnOptions({ ...base(), scratchDir: '' }), /scratchDir/);
  assert.throws(() => buildAskSpawnOptions({ ...base(), mcpConfigPath: undefined }), /mcpConfigPath/);
});

test('fake bin env dump: the sandbox var reaches the SPAWNED env and every WORCA_* var is scrubbed (probe F1)', POSIX_SHIM, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-ask-spawn-env-'));
  const out = join(dir, 'env.txt');
  const bin = join(dir, 'fake-claude.sh');
  await writeFile(bin, `#!/bin/sh\nenv > ${JSON.stringify(out)}\nexit 0\n`, 'utf8');
  await chmod(bin, 0o755);
  const prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = '/tmp/must-not-leak';
  process.env.WORCA_ASK_PROBE = 'leak';
  try {
    const o = buildAskSpawnOptions({ ...base(), scratchDir: dir, mcpConfigPath: join(dir, 'mcp.json'),
      turn: { ...base().turn, modelEnv: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '0', ANTHROPIC_BASE_URL: 'http://proxy' } } });
    await runClaude({ ...o, bin });
  } finally {
    if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
    delete process.env.WORCA_ASK_PROBE;
  }
  const env = (await readFile(out, 'utf8')).split('\n').filter(Boolean);
  assert.ok(env.includes('CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1'), 'survives buildSpawnEnv + prepareModelEnv and wins over a caller value');
  assert.ok(env.includes('ANTHROPIC_BASE_URL=http://proxy'), 'caller routing env still merged');
  assert.ok(!env.some((l) => l.startsWith('WORCA_')), `WORCA_* scrubbed: ${env.filter((l) => l.startsWith('WORCA_'))}`);
  assert.ok(env.some((l) => l.startsWith('PATH=')) && env.some((l) => l.startsWith('HOME=')), 'base vars kept');
});
