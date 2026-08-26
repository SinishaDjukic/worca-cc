// P1/T1: the eight Ask Worca hardening options travel through ALL FIVE gates of
// claude-runner.mjs (runClaude destructure → runReal call → runReal params →
// inner buildClaudeArgs call → buildClaudeArgs) and are default-off: an absent
// option never changes argv (test/spawn-args.test.mjs pins the baseline).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildClaudeArgs, runClaude } from '../src/core/claude-runner.mjs';

const BASE = { prompt: 'p', permissionMode: 'acceptEdits' };
const BASELINE = [
  '-p', 'p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
  '--allowedTools', 'Read,Bash',
];

let prevMock, prevOrch;
beforeEach(() => {
  prevMock = process.env.WORCA_MOCK; prevOrch = process.env.ORCH_MOCK;
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
});
afterEach(() => {
  if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  if (prevOrch === undefined) delete process.env.ORCH_MOCK; else process.env.ORCH_MOCK = prevOrch;
});

test('absent options: argv byte-identical to the baseline', () => {
  const args = buildClaudeArgs({
    ...BASE, allowedTools: ['Read', 'Bash'],
    tools: undefined, strictMcpConfig: undefined, settingSources: undefined, disableSlashCommands: undefined,
    includePartialMessages: undefined, maxTurns: undefined, maxBudgetUsd: undefined, appendSubagentSystemPrompt: undefined,
  });
  assert.deepEqual(args, BASELINE);
});

test('tools: [] emits --tools "" and tools: ["Task"] emits --tools Task, after --allowedTools', () => {
  assert.deepEqual(buildClaudeArgs({ ...BASE, allowedTools: ['Task'], tools: [] }).slice(-4),
    ['--allowedTools', 'Task', '--tools', '']);
  assert.deepEqual(buildClaudeArgs({ ...BASE, allowedTools: ['Task'], tools: ['Task'] }).slice(-2),
    ['--tools', 'Task']);
  assert.deepEqual(buildClaudeArgs({ ...BASE, tools: ['Read', 'Task'] }).slice(-2),
    ['--tools', 'Read,Task'], 'no --allowedTools at all still emits --tools');
});

test('every flag, in the fixed order, appended after the legacy block', () => {
  const args = buildClaudeArgs({
    ...BASE, allowedTools: ['Task'],
    tools: ['Task'], strictMcpConfig: true, settingSources: ['project'], disableSlashCommands: true,
    includePartialMessages: true, maxTurns: 40, maxBudgetUsd: 2, appendSubagentSystemPrompt: 'NOTE',
  });
  assert.deepEqual(args, [
    '-p', 'p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Task',
    '--tools', 'Task', '--strict-mcp-config', '--setting-sources', 'project', '--disable-slash-commands',
    '--include-partial-messages', '--max-turns', '40', '--max-budget-usd', '2',
    '--append-subagent-system-prompt', 'NOTE',
  ]);
});

test('false / cleared / invalid values emit nothing', () => {
  const args = buildClaudeArgs({
    ...BASE, allowedTools: ['Read', 'Bash'],
    strictMcpConfig: false, settingSources: [], disableSlashCommands: false, includePartialMessages: false,
    maxTurns: 0, maxBudgetUsd: null, appendSubagentSystemPrompt: '',
  });
  assert.deepEqual(args, BASELINE);
  assert.deepEqual(buildClaudeArgs({ ...BASE, allowedTools: ['Read', 'Bash'], maxTurns: 2.5, maxBudgetUsd: -1 }), BASELINE);
  assert.deepEqual(buildClaudeArgs({ ...BASE, allowedTools: ['Read', 'Bash'], maxTurns: '40', maxBudgetUsd: '2' }), BASELINE,
    'strings are not numbers: omitted, never coerced');
  assert.deepEqual(buildClaudeArgs({ ...BASE, allowedTools: ['Read', 'Bash'], tools: 'Task', settingSources: 'project' }), BASELINE,
    'non-array list values are ignored');
  assert.deepEqual(buildClaudeArgs({ ...BASE, allowedTools: ['Read', 'Bash'], strictMcpConfig: 1, disableSlashCommands: 'yes' }), BASELINE,
    'booleans must be === true');
});

test('list values are filtered to non-empty strings BEFORE the emptiness test', () => {
  // the guards tested the RAW list and emitted the FILTERED join, so a list of
  // non-strings produced `--setting-sources ""` where `[]` produces nothing, and a
  // blank entry produced a trailing-comma value. Both fail closed at the CLI, but
  // neither matches the documented "a non-empty array of names" contract.
  assert.deepEqual(buildClaudeArgs({ ...BASE, allowedTools: ['Read', 'Bash'], settingSources: [1] }), BASELINE,
    'no usable name ⇒ the flag is not emitted at all');
  assert.deepEqual(buildClaudeArgs({ ...BASE, allowedTools: ['Read', 'Bash'], settingSources: ['', '  '.trim()] }), BASELINE);
  assert.deepEqual(buildClaudeArgs({ ...BASE, allowedTools: ['Read', 'Bash'], settingSources: ['project', '', 'user'] }).slice(-2),
    ['--setting-sources', 'project,user'], 'blanks are dropped, not joined as empty fields');
  assert.deepEqual(buildClaudeArgs({ ...BASE, allowedTools: ['Task'], tools: ['Read', ''] }).slice(-2),
    ['--tools', 'Read'], 'no trailing comma');
  // --tools is the one list whose EMPTY value is meaningful ("no built-in tools"),
  // so the array itself still decides whether the flag is emitted
  assert.deepEqual(buildClaudeArgs({ ...BASE, allowedTools: ['Task'], tools: [1, null] }).slice(-2), ['--tools', '']);
  assert.deepEqual(buildClaudeArgs({ ...BASE, allowedTools: ['Task'], tools: [] }).slice(-2), ['--tools', '']);
});

/** Fake `claude` that dumps its argv NUL-separated (test/spawn-args.test.mjs:81-93 technique). */
async function fakeBin(dir, outFile) {
  const bin = join(dir, 'fake-claude.sh');
  await writeFile(
    bin,
    '#!/bin/sh\n' +
    `for a in "$@"; do printf '%s\\0' "$a" >> ${JSON.stringify(outFile)}; done\n` +
    'exit 0\n',
    'utf8',
  );
  await chmod(bin, 0o755);
  return bin;
}
/** NUL-split that KEEPS empty arguments (`--tools ""`): only the trailing empty entry is dropped. */
function splitArgv(dump) { const parts = dump.split('\0'); parts.pop(); return parts; }

test('runClaude forwards all eight options to the spawned argv (five gates)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-ask-runner-'));
  const out = join(dir, 'argv.txt');
  const bin = await fakeBin(dir, out);
  await runClaude({
    cwd: dir, bin, prompt: 'p', allowedTools: ['Task'], mcpServerGrants: ['mcp__worca'],
    tools: [], strictMcpConfig: true, settingSources: ['project'], disableSlashCommands: true,
    includePartialMessages: true, maxTurns: 7, maxBudgetUsd: 1.5, appendSubagentSystemPrompt: 'SANDBOX',
  });
  const argv = splitArgv(await readFile(out, 'utf8'));
  assert.equal(argv[argv.indexOf('--allowedTools') + 1], 'Task,mcp__worca');
  assert.equal(argv[argv.indexOf('--tools') + 1], '', '--tools "" reached the spawn as an empty argument');
  for (const flag of ['--strict-mcp-config', '--disable-slash-commands', '--include-partial-messages']) {
    assert.ok(argv.includes(flag), `${flag} reached the spawn`);
  }
  assert.equal(argv[argv.indexOf('--setting-sources') + 1], 'project');
  assert.equal(argv[argv.indexOf('--max-turns') + 1], '7');
  assert.equal(argv[argv.indexOf('--max-budget-usd') + 1], '1.5');
  assert.equal(argv[argv.indexOf('--append-subagent-system-prompt') + 1], 'SANDBOX');
  assert.ok(!argv.includes('--add-dir'), 'never --add-dir');
});

test('runClaude without the eight options spawns the legacy argv (parity)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-ask-runner-'));
  const out = join(dir, 'argv.txt');
  const bin = await fakeBin(dir, out);
  await runClaude({ cwd: dir, bin, prompt: 'p', allowedTools: ['Read', 'Bash'] });
  assert.deepEqual(splitArgv(await readFile(out, 'utf8')), BASELINE);
});
