// test/codex-adapter.test.mjs — the codex engine adapter (plans/harness-bridge-design.md §10):
// argv, the `exec --json` normalizer against real captures (test/fixtures/codex), cost
// estimation from cumulative usage, error classification, and the spawn path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCodexArgs, tomlString, createCodexNormalizer, estimateCodexCostUsd, classifyCodexError,
  parseLoginStatus, codexThreadOf, CODEX_SESSION_PREFIX, runCodexProcess, codexCapabilities, codexPreflight,
} from '../src/core/engines/codex.mjs';
import { EVENT_TYPES } from '../src/core/engines/events.mjs';
import { fakeCodex as fakeCodexBin } from './helpers/fake-codex.mjs';
import { CAPABILITY_KEYS } from '../src/core/engines/capabilities.mjs';

const FIX = new URL('./fixtures/codex/', import.meta.url);
const frames = (name) => readFileSync(new URL(name, FIX), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-codex-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function replay(name, opts = {}) {
  const n = createCodexNormalizer(opts);
  const events = frames(name).flatMap((f) => n.push(f));
  return { events, final: n.finish() };
}

// ── argv ─────────────────────────────────────────────────────────────────────

test('fresh run: exec --json, no user config, workspace-write sandbox, the prompt on stdin', () => {
  // --ignore-user-config: the user's own MCP servers, plugins and default model never ride along.
  assert.deepEqual(buildCodexArgs({}), ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--sandbox', 'workspace-write', '-']);
});

test('model, effort and the system prompt as developer_instructions (TOML-escaped)', () => {
  const args = buildCodexArgs({ model: 'gpt-5.5', effort: 'high', systemPrompt: 'Be "terse".\nNo tabs\there.' });
  assert.deepEqual(args, ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--sandbox', 'workspace-write',
    '-m', 'gpt-5.5', '-c', 'model_reasoning_effort="high"', '-c', 'developer_instructions="Be \\"terse\\".\\nNo tabs\\there."', '-']);
});

test('extra writable dirs: --add-dir on a fresh run', () => {
  const args = buildCodexArgs({ addDirs: ['/mem/a', '/mem/b'] });
  assert.deepEqual(args.slice(6, 10), ['--add-dir', '/mem/a', '--add-dir', '/mem/b']);
});

test('resume: exec resume <thread>, no --sandbox or --add-dir (the subcommand rejects them); both ride -c', () => {
  const args = buildCodexArgs({ resumeThreadId: 'th-1', addDirs: ['/mem/a'], model: 'gpt-5.5' });
  assert.deepEqual(args, ['exec', 'resume', 'th-1', '--json', '--skip-git-repo-check', '--ignore-user-config',
    '-c', 'sandbox_mode="workspace-write"', '-c', 'sandbox_workspace_write.writable_roots=["/mem/a"]', '-m', 'gpt-5.5', '-']);
  assert.ok(!args.includes('--sandbox') && !args.includes('--add-dir') && !args.includes('--ask-for-approval'));
});

test('tomlString escapes quotes, backslashes and control characters', () => {
  assert.equal(tomlString('a"b\\c\n\r\t\u0001'), '"a\\"b\\\\c\\n\\r\\t\\u0001"');
  assert.equal(tomlString('[not a table]'), '"[not a table]"');
});

test('session ids are engine-qualified; a foreign (claude) id is not a codex thread', () => {
  assert.equal(CODEX_SESSION_PREFIX, 'codex:');
  assert.equal(codexThreadOf('codex:th-1'), 'th-1');
  assert.equal(codexThreadOf('0f3c2a1e-1111-2222-3333-444455556666'), null);
  assert.equal(codexThreadOf(undefined), null);
});

// ── stream normalizer (real captures) ─────────────────────────────────────────

test('a captured exec run normalizes to session, text, tool + result, stderr notes, result', () => {
  const { events, final } = replay('exec-command.jsonl');
  for (const e of events) assert.ok(EVENT_TYPES.has(e.type), e.type);
  assert.deepEqual(events[0], { type: 'session', sessionId: 'codex:00000000-0000-4000-8000-000000000001', model: null, init: true });
  const tool = events.find((e) => e.type === 'tool');
  assert.deepEqual(tool, { type: 'tool', parentId: null, calls: [{ name: 'Bash', input: { command: "/bin/zsh -lc 'cat a.txt'" }, toolUseId: 'item_2' }] });
  const res = events.find((e) => e.type === 'toolResult');
  assert.deepEqual(res.results, [{ toolUseId: 'item_2', isError: false, text: 'hello\n', content: 'hello\n' }]);
  assert.ok(events.some((e) => e.type === 'stderr' && /Skill descriptions were shortened/.test(e.text)), 'non-fatal error items become warnings');
  const texts = events.filter((e) => e.type === 'text').map((e) => e.text);
  assert.deepEqual(texts, ['I’ll read the file and return only its contents.', 'hello']);
  const result = events.find((e) => e.type === 'result');
  assert.equal(result.text, 'I’ll read the file and return only its contents.\nhello');
  assert.equal(result.isError, false);
  // Claude-style usage, so worca's per-model cost overrides can price it: cached input is split out.
  assert.deepEqual(result.usage, { input_tokens: 35101 - 28544, cache_read_input_tokens: 28544, cache_creation_input_tokens: 0, output_tokens: 139 });
  assert.equal('costUsd' in result, false, 'no model named, no price');
  assert.deepEqual(final.cumulativeUsage, { input: 35101, cached: 28544, cacheWrite: 0, output: 139, reasoning: 0 });
  assert.equal(final.error, null);
});

test('a resumed thread charges only the delta over the stored cumulative usage', () => {
  const prior = { input: 35101, cached: 28544, cacheWrite: 0, output: 139, reasoning: 0 };
  const { events, final } = replay('exec-resume.jsonl', { model: 'gpt-5.5', priorUsage: prior });
  const result = events.find((e) => e.type === 'result');
  assert.deepEqual(result.usage, { input_tokens: (56809 - 35101) - (45952 - 28544), cache_read_input_tokens: 45952 - 28544, cache_creation_input_tokens: 0, output_tokens: 5 });
  assert.equal(result.costUsd, estimateCodexCostUsd('gpt-5.5', { input: 56809 - 35101, cached: 45952 - 28544, output: 5 }));
  assert.deepEqual(final.cumulativeUsage, { input: 56809, cached: 45952, cacheWrite: 0, output: 144, reasoning: 0 });
});

test('turn.failed: no result event, the error message is the failure', () => {
  const { events, final } = replay('turn-failed.jsonl');
  assert.equal(events.some((e) => e.type === 'result'), false);
  assert.match(final.error, /model is not supported when using Codex with a ChatGPT account/);
});

test('a signed-out run: each stream retry is a warning, the 401 turn.failed is the failure', () => {
  const { events, final } = replay('signed-out.jsonl');
  const retries = events.filter((e) => e.type === 'stderr' && /^codex: Reconnecting\.\.\. \d\/5 /.test(e.text));
  assert.equal(retries.length, 9);
  assert.equal(events.some((e) => e.type === 'result'), false);
  assert.match(final.error, /^unexpected status 401 Unauthorized/);
  assert.equal(classifyCodexError(final.error), 'auth');
});

test('a stream retry codex recovers from does not fail the turn', () => {
  const n = createCodexNormalizer();
  const lines = [
    { type: 'thread.started', thread_id: 't-1' },
    { type: 'turn.started' },
    { type: 'error', message: 'Reconnecting... 1/5 (stream disconnected before completion: error sending request)' },
    { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'done' } },
    { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 5 } },
  ];
  const events = lines.flatMap((l) => n.push(l));
  assert.ok(events.some((e) => e.type === 'stderr' && e.text === 'codex: Reconnecting... 1/5 (stream disconnected before completion: error sending request)'));
  assert.ok(events.some((e) => e.type === 'result'));
  assert.equal(n.finish().error, null);
  // No turn.completed after it: the last top-level error is the failure.
  const cut = createCodexNormalizer();
  lines.slice(0, 3).forEach((l) => cut.push(l));
  assert.match(cut.finish().error, /^Reconnecting\.\.\. 1\/5/);
});

test('collab_tool_call items are flat sub-agent spawn and finish, never tools', () => {
  const n = createCodexNormalizer();
  const item = { id: 'c1', type: 'collab_tool_call', prompt: 'look around', receiver_agents: ['explorer'] };
  const out = [...n.push({ type: 'item.started', item }), ...n.push({ type: 'item.completed', item: { ...item, agents_states: [{ status: 'completed' }] } })];
  assert.deepEqual(out, [
    { type: 'subagent', event: 'spawn', toolUseId: 'c1', label: 'look around', description: 'look around', subagentType: 'explorer' },
    { type: 'subagent', event: 'finish', toolUseId: 'c1' },
  ]);
  const failed = createCodexNormalizer().push({ type: 'item.completed', item: { ...item, id: 'c2', agents_states: { a: { status: 'failed' } } } });
  assert.deepEqual(failed.map((e) => e.event), ['spawn', 'error']);
});

test('a real fan-out stream (collab-wait.jsonl): the bare wait item still gets a label, the role\'s type and a model', () => {
  // codex-cli 0.146 streams only the parent's `wait`: no prompt, no receivers, no agent type.
  const { events } = replay('collab-wait.jsonl', { model: 'gpt-5.6-sol', subagent: { type: 'worca_investigator', model: null } });
  const sub = events.filter((e) => e.type === 'subagent');
  assert.deepEqual(sub, [
    { type: 'subagent', event: 'spawn', toolUseId: 'item_0', label: 'Codex sub-agents', description: 'Codex sub-agents', subagentType: 'worca_investigator', model: 'gpt-5.6-sol' },
    { type: 'subagent', event: 'finish', toolUseId: 'item_0' },
  ]);
  // The role's own model wins over the parent's; no role: the parent's model, no type.
  const own = replay('collab-wait.jsonl', { model: 'gpt-5.6-sol', subagent: { type: 'worca_investigator', model: 'gpt-5.6-luna' } }).events.find((e) => e.type === 'subagent');
  assert.equal(own.model, 'gpt-5.6-luna');
  const bare = replay('collab-wait.jsonl', { model: 'gpt-5.6-sol' }).events.find((e) => e.type === 'subagent');
  assert.equal(bare.subagentType, undefined);
  assert.equal(bare.model, 'gpt-5.6-sol');
  // Another collab tool names itself.
  const msg = createCodexNormalizer().push({ type: 'item.started', item: { id: 'c9', type: 'collab_tool_call', tool: 'send_message', prompt: null } });
  assert.equal(msg[0].label, 'Codex sub-agents: send message');
});

test('file_change and mcp_tool_call items become tool + toolResult', () => {
  const n = createCodexNormalizer();
  const fc = n.push({ type: 'item.completed', item: { id: 'f1', type: 'file_change', status: 'completed', changes: [{ path: '/w/a.js', kind: 'update' }] } });
  assert.deepEqual(fc[0].calls, [{ name: 'Edit', input: { file_path: '/w/a.js' }, toolUseId: 'f1:0' }]);
  assert.deepEqual(fc[1].results, [{ toolUseId: 'f1:0', isError: false, text: 'update', content: 'update' }]);
  const mcp = n.push({ type: 'item.completed', item: { id: 'm1', type: 'mcp_tool_call', server: 'worca', tool: 'list_runs', arguments: { limit: 1 }, status: 'failed', error: { message: 'boom' } } });
  assert.deepEqual(mcp[0].calls, [{ name: 'mcp__worca__list_runs', input: { limit: 1 }, toolUseId: 'm1' }]);
  assert.equal(mcp[1].results[0].isError, true);
  assert.equal(mcp[1].results[0].text, 'boom');
});

test('a non-JSON line (banner) is skipped', () => {
  assert.deepEqual(createCodexNormalizer().push('Reading additional input from stdin...'), []);
});

// ── cost ──────────────────────────────────────────────────────────────────────

test('estimateCodexCostUsd: cached input at a tenth, reasoning not double-billed, unknown model null', () => {
  const c = estimateCodexCostUsd('gpt-5.5', { input: 1_000_000, cached: 0, output: 0 });
  assert.equal(c, 1.25);
  assert.ok(estimateCodexCostUsd('gpt-5.5', { input: 1_000_000, cached: 1_000_000, output: 0 }) < c / 2);
  assert.equal(estimateCodexCostUsd('gpt-5.5', { input: 0, cached: 0, output: 1_000_000, reasoning: 1_000_000 }), 10);
  assert.equal(estimateCodexCostUsd('mystery', { input: 1, cached: 0, output: 1 }), null);
  assert.equal(estimateCodexCostUsd(undefined, { input: 1, cached: 0, output: 1 }), null);
});

// ── errors and auth ──────────────────────────────────────────────────────────

test('classifyCodexError maps the codex failure texts', () => {
  assert.equal(classifyCodexError(new Error('401 Unauthorized')), 'auth');
  assert.equal(classifyCodexError(new Error('Not logged in. Run codex login')), 'auth');
  assert.equal(classifyCodexError(new Error("You've hit your usage limit. Try again at 6pm")), 'usage_limit');
  assert.equal(classifyCodexError(new Error('429 Too Many Requests')), 'rate_limit');
  assert.equal(classifyCodexError(new Error('stream error: ECONNRESET')), 'network');
  assert.equal(classifyCodexError(new Error("The 'x' model is not supported when using Codex with a ChatGPT account.")), null);
  assert.equal(classifyCodexError(Object.assign(new Error('x'), { errorClass: 'quota' })), 'quota', 'a stamped class wins');
});

test('parseLoginStatus: logged in / not / unknown', () => {
  assert.equal(parseLoginStatus({ code: 0, stdout: '', stderr: 'Logged in using ChatGPT' }), true);
  assert.equal(parseLoginStatus({ code: 1, stdout: 'Not logged in', stderr: '' }), false);
  assert.equal(parseLoginStatus({ code: 1, stdout: '', stderr: '' }), false);
  assert.equal(parseLoginStatus({ code: 0, stdout: '', stderr: '' }), null);
});

test('capabilities: the design §10.3 map', () => {
  assert.deepEqual(Object.keys(codexCapabilities).sort(), [...CAPABILITY_KEYS].sort());
  const off = Object.entries(codexCapabilities).filter(([, v]) => v === false).map(([k]) => k).sort();
  assert.deepEqual(off, ['allowedTools', 'hookTelemetry', 'turnBudget']);
});

// ── spawn (fake codex) ────────────────────────────────────────────────────────

function fakeCodex(dir, { fixture, code = 0, stderr = '' }) {
  const bin = join(dir, 'codex');
  const argsOut = join(dir, 'args.json');
  const stdinOut = join(dir, 'stdin.txt');
  writeFileSync(bin, `#!/bin/sh
node -e 'require("fs").writeFileSync(${JSON.stringify(argsOut)}, JSON.stringify(process.argv.slice(1)))' -- "$@"
cat > ${JSON.stringify(stdinOut)}
cat ${JSON.stringify(fixture)}
${stderr ? `echo ${JSON.stringify(stderr)} 1>&2` : ''}
exit ${code}
`);
  chmodSync(bin, 0o755);
  return { bin, argsOut, stdinOut };
}

test('runCodexProcess: prompt on stdin, normalized events out, text resolved', POSIX, async () => {
  const dir = tmp();
  const f = fakeCodex(dir, { fixture: new URL('exec-command.jsonl', FIX).pathname });
  const events = [];
  const r = await runCodexProcess({ cwd: dir, bin: f.bin, prompt: 'P', systemPrompt: 'S', onEvent: (e) => events.push(e), usageDir: dir });
  assert.deepEqual(r, { text: 'I’ll read the file and return only its contents.\nhello', exitCode: 0 });
  assert.equal(readFileSync(f.stdinOut, 'utf8'), 'P');
  const args = JSON.parse(readFileSync(f.argsOut, 'utf8'));
  const dev = args.find((a) => a.startsWith('developer_instructions='));
  assert.ok(dev.startsWith('developer_instructions="## Host process protection'), 'the host-guard preamble leads (no hook exists on codex)');
  assert.ok(dev.endsWith('\\n\\nS"'), 'then the system prompt');
  assert.ok(events.every((e) => EVENT_TYPES.has(e.type)));
});

test('runCodexProcess: a foreign resume id starts a fresh thread and says so', POSIX, async () => {
  const dir = tmp();
  const f = fakeCodex(dir, { fixture: new URL('exec-command.jsonl', FIX).pathname });
  const events = [];
  await runCodexProcess({ cwd: dir, bin: f.bin, prompt: 'P', resumeSessionId: 'a-claude-session', onEvent: (e) => events.push(e), usageDir: dir });
  const args = JSON.parse(readFileSync(f.argsOut, 'utf8'));
  assert.equal(args[1], '--json', 'not `exec resume`');
  assert.ok(events.some((e) => e.type === 'stderr' && /not a codex thread/.test(e.text)));
});

test('runCodexProcess: resume reads the stored cumulative usage and charges the delta', POSIX, async () => {
  const dir = tmp();
  writeFileSync(join(dir, '00000000-0000-4000-8000-000000000001.json'), JSON.stringify({ input: 35101, cached: 28544, cacheWrite: 0, output: 139, reasoning: 0 }));
  const f = fakeCodex(dir, { fixture: new URL('exec-resume.jsonl', FIX).pathname });
  const events = [];
  await runCodexProcess({ cwd: dir, bin: f.bin, prompt: 'P', model: 'gpt-5.5', resumeSessionId: 'codex:00000000-0000-4000-8000-000000000001', onEvent: (e) => events.push(e), usageDir: dir });
  const args = JSON.parse(readFileSync(f.argsOut, 'utf8'));
  assert.deepEqual(args.slice(0, 3), ['exec', 'resume', '00000000-0000-4000-8000-000000000001']);
  assert.equal(events.find((e) => e.type === 'result').usage.output_tokens, 5);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '00000000-0000-4000-8000-000000000001.json'), 'utf8')).input, 56809, 'the new cumulative usage is stored');
});

test('runCodexProcess: turn.failed rejects with the codex message even on exit 0', POSIX, async () => {
  const dir = tmp();
  const f = fakeCodex(dir, { fixture: new URL('turn-failed.jsonl', FIX).pathname, code: 0 });
  const err = await runCodexProcess({ cwd: dir, bin: f.bin, prompt: 'P', onEvent: () => {}, usageDir: dir }).then(() => null, (e) => e);
  assert.match(err.message, /not supported when using Codex with a ChatGPT account/);
});

test('runCodexProcess: a non-zero exit with only stderr surfaces stderr and its class', POSIX, async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'empty.jsonl'), '');
  const f = fakeCodex(dir, { fixture: join(dir, 'empty.jsonl'), code: 1, stderr: 'Error: 401 Unauthorized' });
  const err = await runCodexProcess({ cwd: dir, bin: f.bin, prompt: 'P', onEvent: () => {}, usageDir: dir }).then(() => null, (e) => e);
  assert.match(err.message, /exited with code 1: Error: 401 Unauthorized/);
  assert.equal(err.errorClass, 'auth');
});

test('runCodexProcess: a stream retry followed by a completed turn resolves', POSIX, async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'retry.jsonl'), [
    { type: 'thread.started', thread_id: 't-retry' },
    { type: 'turn.started' },
    { type: 'error', message: 'Reconnecting... 1/5 (stream disconnected before completion)' },
    { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'done' } },
    { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 5 } },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const f = fakeCodex(dir, { fixture: join(dir, 'retry.jsonl') });
  const events = [];
  const r = await runCodexProcess({ cwd: dir, bin: f.bin, prompt: 'P', onEvent: (e) => events.push(e), usageDir: dir });
  assert.deepEqual(r, { text: 'done', exitCode: 0 });
  assert.ok(events.some((e) => e.type === 'stderr' && /Reconnecting\.\.\. 1\/5/.test(e.text)));
});

test('runCodexProcess: a stderr tracing line does not hide the usage limit the turn failed with', POSIX, async () => {
  // codex logs recoverable tool errors to stderr during a normal turn; the failure
  // itself is on stdout.
  const dir = tmp();
  const limit = "You've hit your usage limit. Upgrade to Pro or try again in 3 days 1 hour.";
  writeFileSync(join(dir, 'limit.jsonl'), [
    { type: 'thread.started', thread_id: 't-limit' },
    { type: 'error', message: limit },
    { type: 'turn.failed', error: { message: limit } },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const f = fakeCodex(dir, { fixture: join(dir, 'limit.jsonl'), code: 1, stderr: 'ERROR codex_core::tools::router: error=apply_patch verification failed: Failed to find expected lines' });
  const err = await runCodexProcess({ cwd: dir, bin: f.bin, prompt: 'P', onEvent: () => {}, usageDir: dir }).then(() => null, (e) => e);
  assert.equal(err.errorClass, 'usage_limit');
  assert.ok(err.message.startsWith(`${f.bin}: ${limit} — `), err.message);
  assert.match(err.message, /apply_patch verification failed/, 'the stderr detail stays after it');
});

test('codexPreflight: signed in passes; signed out and a missing binary refuse; an unreadable answer warns', POSIX, async () => {
  const dir = tmp();
  const bin = (name, body) => { const p = join(dir, name); writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755); return p; };
  assert.deepEqual(await codexPreflight({ bin: bin('in', 'echo "Logged in using ChatGPT" 1>&2') }), {});
  assert.match((await codexPreflight({ bin: bin('out', 'echo "Not logged in"; exit 1') })).refusal, /is not signed in — run `codex login`/);
  assert.match((await codexPreflight({ bin: join(dir, 'no-such-codex') })).refusal, /cannot run .*no-such-codex \(ENOENT\) — install codex, or point WORCA_CODEX_BIN at it/);
  assert.match((await codexPreflight({ bin: bin('mute', 'exit 0') })).warning, /could not tell whether/);
});

test('read-only sandbox: --sandbox read-only, the shell off and no writable dirs; resume rides -c; unknown modes never pass', () => {
  assert.deepEqual(buildCodexArgs({ sandbox: 'read-only', addDirs: ['/mem'] }),
    ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--sandbox', 'read-only', '--disable', 'shell_tool', '--disable', 'unified_exec', '-']);
  assert.deepEqual(buildCodexArgs({ sandbox: 'read-only', resumeThreadId: 'th-1', addDirs: ['/mem'] }),
    ['exec', 'resume', 'th-1', '--json', '--skip-git-repo-check', '--ignore-user-config', '-c', 'sandbox_mode="read-only"', '--disable', 'shell_tool', '--disable', 'unified_exec', '-']);
  assert.equal(buildCodexArgs({}).includes('shell_tool'), false, 'a pipeline node keeps its shell');
  assert.deepEqual(buildCodexArgs({ sandbox: 'danger-full-access' }).slice(4, 6), ['--sandbox', 'workspace-write']);
  assert.deepEqual(buildCodexArgs({}).slice(4, 6), ['--sandbox', 'workspace-write'], 'the default is unchanged');
});

test('a read-only codex spawn (a utility job over untrusted input) gets a scrubbed env; a node spawn keeps the host env', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-codex-env-'));
  const keys = { AWS_SECRET_ACCESS_KEY: 'aws-secret', ANTHROPIC_API_KEY: 'anthropic-secret', OPENAI_API_KEY: 'openai-key' };
  const prev = Object.fromEntries(Object.keys(keys).map((k) => [k, process.env[k]]));
  Object.assign(process.env, keys);
  try {
    const ro = fakeCodexBin(dir, 'ok');
    await runCodexProcess({ cwd: dir, bin: ro.bin, prompt: 'P', sandbox: 'read-only', usageDir: dir });
    const env = ro.env();
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined, 'no cloud credentials for an injected instruction to read');
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.OPENAI_API_KEY, 'openai-key', 'codex keeps its own sign-in');
    assert.ok(env.PATH && env.HOME, 'the base env survives');
    const rw = fakeCodexBin(mkdtempSync(join(tmpdir(), 'worca-codex-env-rw-')), 'ok');
    await runCodexProcess({ cwd: dir, bin: rw.bin, prompt: 'P', usageDir: dir });
    assert.equal(rw.env().AWS_SECRET_ACCESS_KEY, 'aws-secret', 'an agent node spawn is unchanged (its guardrails decide)');
  } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(dir, { recursive: true, force: true });
  }
});
