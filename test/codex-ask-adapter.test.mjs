// test/codex-ask-adapter.test.mjs — what Ask on Codex needs from the codex adapter (cascading-settings-design.md §4.6,
// D13, D15, D16; Task 0's record in plans/ask-on-codex-spike.md).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCodexArgs, createCodexNormalizer, codexMcpOverrides, mcpResultText, codexModelPriced, codexResumeNotFound,
  CODEX_ASK_LOCKDOWN, CODEX_DEFAULT_MODEL, runCodexProcess, codexCapabilities,
} from '../src/core/engines/codex.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { fakeCodex } from './helpers/fake-codex.mjs';

const POSIX = process.platform === 'win32' ? { skip: 'POSIX fake bin' } : {};
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-codex-ask-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

// Task 0 (a) was NOT CONFIRMED on codex-cli 0.146.0-alpha.9.2 (view_image and sub-agents cannot be switched off,
// plans/ask-on-codex-spike.md): the constant is null and every Ask spawn on Codex refuses. The spawn tests below pass
// the candidate list explicitly (askLockdown accepts a list), so the MCP / image / env path stays covered.
const CANDIDATE_LOCKDOWN = ['--disable', 'shell_tool', '--disable', 'unified_exec', '-c', 'web_search="disabled"', '--ignore-rules'];

test('the lockdown is null (Task 0 (a) NOT CONFIRMED); pipelines attach MCP servers (stdio only)', () => {
  assert.equal(CODEX_ASK_LOCKDOWN, null);
  assert.equal(codexCapabilities.mcpTools, true);
});

test('runCodexProcess: askLockdown with no verified lockdown refuses before spawning', POSIX, async () => {
  const dir = tmp();
  const fake = fakeCodex(dir, 'ok');
  await assert.rejects(() => runCodexProcess({ cwd: dir, bin: fake.bin, prompt: 'P', sandbox: 'read-only', askLockdown: true, usageDir: dir }),
    /cannot be locked down/);
  assert.equal(fake.args(), null, 'codex never ran');
});

test('runCodexProcess: an empty lockdown list is no lockdown — refused before spawning', POSIX, async () => {
  const dir = tmp();
  const fake = fakeCodex(dir, 'ok');
  await assert.rejects(() => runCodexProcess({ cwd: dir, bin: fake.bin, prompt: 'P', sandbox: 'read-only', askLockdown: [], usageDir: dir }),
    /cannot be locked down/);
  assert.equal(fake.args(), null, 'codex never ran');
});

test('normalizer: a shell command shows (as Bash) when it starts; its completion adds only the result', () => {
  const n = createCodexNormalizer({ model: 'gpt-5.5' });
  const item = { id: 'c1', type: 'command_execution', command: "/bin/zsh -lc 'ls'", aggregated_output: '', exit_code: null, status: 'in_progress' };
  assert.deepEqual(n.push({ type: 'item.started', item }), [{ type: 'tool', parentId: null, calls: [{ name: 'Bash', input: { command: "/bin/zsh -lc 'ls'" }, toolUseId: 'c1' }] }]);
  assert.deepEqual(n.push({ type: 'item.completed', item: { ...item, aggregated_output: 'a\n', exit_code: 0, status: 'completed' } }),
    [{ type: 'toolResult', parentId: null, meta: null, results: [{ toolUseId: 'c1', isError: false, text: 'a\n', content: 'a\n' }] }]);
});

test('buildCodexArgs: images right after exec / resume <thread>, lockdown (in place of the plain shell-off flags) and MCP before the stdin prompt', () => {
  const fresh = buildCodexArgs({ sandbox: 'read-only', images: ['/a.png', '/b.png'], lockdown: ['--disable', 'shell_tool'], mcp: ['-c', 'mcp_servers.worca.required=true'] });
  assert.deepEqual(fresh, ['exec', '-i', '/a.png', '-i', '/b.png', '--json', '--skip-git-repo-check', '--ignore-user-config', '--sandbox', 'read-only',
    '--disable', 'shell_tool', '-c', 'mcp_servers.worca.required=true', '-']);
  const resume = buildCodexArgs({ sandbox: 'read-only', resumeThreadId: 'th-1', images: ['/a.png'], lockdown: ['--disable', 'shell_tool'] });
  assert.deepEqual(resume.slice(0, 5), ['exec', 'resume', 'th-1', '-i', '/a.png']);
  assert.equal(resume.at(-1), '-');
  assert.deepEqual(buildCodexArgs({ sandbox: 'read-only' }), ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--sandbox', 'read-only',
    '--disable', 'shell_tool', '--disable', 'unified_exec', '-']);
});

test('codexMcpOverrides: command, args and env NAMES on argv (env values returned for the process env), required, timeouts, approve', () => {
  const { args, env } = codexMcpOverrides({ worca: { type: 'stdio', command: '/usr/bin/node', args: ['--x', '/s/mcp-stdio.mjs', '--thread', 'ask_00000001'],
    env: { WORCA_HOME: '/h', WORCA_ASK_RELAY_TOKEN: 'tok-SECRET' } }, 'bad name': { command: 'x' } }, { passEnv: ['SSH_AUTH_SOCK'] });
  assert.deepEqual(env, { WORCA_HOME: '/h', WORCA_ASK_RELAY_TOKEN: 'tok-SECRET' });
  assert.deepEqual(args, [
    '-c', 'mcp_servers.worca.command="/usr/bin/node"',
    '-c', 'mcp_servers.worca.args=["--x","/s/mcp-stdio.mjs","--thread","ask_00000001"]',
    '-c', 'mcp_servers.worca.env_vars=["WORCA_HOME","WORCA_ASK_RELAY_TOKEN","SSH_AUTH_SOCK"]',
    '-c', 'mcp_servers.worca.required=true', '-c', 'mcp_servers.worca.startup_timeout_sec=30',
    '-c', 'mcp_servers.worca.tool_timeout_sec=1800', '-c', 'mcp_servers.worca.default_tools_approval_mode="approve"',
  ]);
  assert.equal(args.join(' ').includes('tok-SECRET'), false);
});

test('normalizer: agent_message carries its item id; an MCP call streams its row at start; the result is unwrapped', () => {
  const n = createCodexNormalizer({ model: 'gpt-5.5' });
  const [t] = n.push({ type: 'item.completed', item: { id: 'item_3', type: 'agent_message', text: 'Hi' } });
  assert.deepEqual(t, { type: 'text', text: 'Hi', parentId: null, from: 'assistant', blocks: ['Hi'], messageId: 'item_3' });
  const started = n.push({ type: 'item.started', item: { id: 'm1', type: 'mcp_tool_call', server: 'worca', tool: 'propose_run', arguments: { brief: 'x' }, status: 'in_progress' } });
  assert.deepEqual(started, [{ type: 'tool', parentId: null, calls: [{ name: 'mcp__worca__propose_run', input: { brief: 'x' }, toolUseId: 'm1' }] }]);
  const done = n.push({ type: 'item.completed', item: { id: 'm1', type: 'mcp_tool_call', server: 'worca', tool: 'propose_run', arguments: { brief: 'x' },
    status: 'completed', result: { content: [{ type: 'text', text: '{"ok":true}' }] } } });
  assert.deepEqual(done, [{ type: 'toolResult', parentId: null, meta: null, results: [{ toolUseId: 'm1', isError: false, text: '{"ok":true}', content: '{"ok":true}' }] }]);
});

test('normalizer: the failed MCP call codex 0.146 sends (status failed, error null, text in result) is an error row with its text', () => {
  const frames = readFileSync(new URL('./fixtures/codex/ask-spike/c-mcp.jsonl', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l));
  const failed = frames.find((f) => f.type === 'item.completed' && f.item?.type === 'mcp_tool_call' && f.item.tool === 'fail');
  assert.equal(failed.item.status, 'failed');
  assert.equal(failed.item.error, null);
  const n = createCodexNormalizer({ model: 'gpt-5.5' });
  const out = n.push(failed);
  const res = out.find((e) => e.type === 'toolResult').results[0];
  assert.equal(res.isError, true);
  assert.equal(res.text, 'error: fail: as asked');
});

test('mcpResultText: a text-content wrapper becomes its text; anything else stays JSON', () => {
  assert.equal(mcpResultText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), 'ab');
  assert.equal(mcpResultText('plain'), 'plain');
  assert.equal(mcpResultText({ content: [{ type: 'image', data: 'x' }] }), '{"content":[{"type":"image","data":"x"}]}');
});

test('codexModelPriced and codexResumeNotFound', () => {
  assert.equal(codexModelPriced('gpt-5.5'), true);
  assert.equal(codexModelPriced('my-local-codex'), false);
  assert.equal(codexModelPriced(undefined), true, 'no model is CODEX_DEFAULT_MODEL, which is priced');
  assert.equal(codexResumeNotFound(new Error('codex: no rollout found for thread id 0000')), true);
  assert.equal(codexResumeNotFound(new Error('codex: 401 Unauthorized')), false);
});

test('runCodexProcess: an Ask lockdown spawn reads the MCP config, keeps its env off argv, passes images', POSIX, async () => {
  const dir = tmp();
  const fake = fakeCodex(dir, 'ok');
  const cfg = join(dir, 'mcp.json');
  writeFileSync(cfg, JSON.stringify({ mcpServers: { worca: { type: 'stdio', command: process.execPath, args: ['/s.mjs'], env: { WORCA_ASK_RELAY_TOKEN: 'tok-SECRET', WORCA_ASK_ENGINE: 'codex' } } } }));
  process.env.CODEX_TEST_MARK = '1';   // codex's own prefix rides even a scrubbed env
  try { await runCodexProcess({ cwd: dir, bin: fake.bin, prompt: 'P', sandbox: 'read-only', askLockdown: CANDIDATE_LOCKDOWN, mcpConfigPath: cfg, images: ['/img/a.png'], envScrub: true, envAllowlist: [], usageDir: dir }); }
  finally { delete process.env.CODEX_TEST_MARK; }
  const args = fake.args();
  assert.ok(args.includes('mcp_servers.worca.required=true'));
  assert.deepEqual(args.slice(0, 3), ['exec', '-i', '/img/a.png']);
  assert.equal(args.join(' ').includes('tok-SECRET'), false);
  assert.equal(fake.env().WORCA_ASK_RELAY_TOKEN, 'tok-SECRET');
  assert.equal(fake.env().WORCA_ASK_ENGINE, 'codex');
  // codex gives an MCP server a short default env plus env_vars: every name codex itself got is listed, so the worca
  // server sees the same env a Claude chat's child inherits.
  const names = JSON.parse(args.find((a) => a.startsWith('mcp_servers.worca.env_vars=')).slice('mcp_servers.worca.env_vars='.length));
  for (const k of ['PATH', 'HOME', 'CODEX_TEST_MARK']) assert.ok(names.includes(k), k);
  assert.equal(fake.env().CODEX_TEST_MARK, '1');
});

test('runCodexProcess: a pipeline spawn attaches its stdio servers, fills ${VAR} refs from the spawn env, redacts the secrets, skips remote ones', POSIX, async () => {
  const dir = tmp();
  const fake = fakeCodex(dir, 'answer tok-SECRET');
  const cfg = join(dir, 'mcp.json');
  writeFileSync(cfg, JSON.stringify({ mcpServers: {
    pg: { type: 'stdio', command: process.execPath, args: ['/launch.mjs', '--copy', 'pg'], env: { MCPCHILD_PGPASS: '${MCPSECRET_PG}', PLAIN: 'x' } },
    web: { type: 'http', url: 'https://mcp.example/' },
  } }));
  const events = [];
  const res = await runCodexProcess({ cwd: dir, bin: fake.bin, prompt: 'P', mcpConfigPath: cfg, spawnEnv: { MCPSECRET_PG: 'tok-SECRET' },
    redactValues: ['tok-SECRET'], onEvent: (e) => events.push(e), usageDir: dir });
  const args = fake.args();
  assert.ok(args.includes('mcp_servers.pg.required=true'));
  assert.equal(args.some((a) => a.startsWith('mcp_servers.web.')), false, 'codex takes stdio servers only');
  assert.ok(events.some((e) => e.type === 'stderr' && /not attached: web/.test(e.text)));
  assert.equal(args.join(' ').includes('tok-SECRET'), false, 'values never ride argv');
  assert.equal(fake.env().MCPCHILD_PGPASS, 'tok-SECRET', 'the reference is filled from the spawn env');
  assert.equal(fake.env().MCPSECRET_PG, undefined, 'the secret reaches codex only through the reference');
  assert.equal(res.text.includes('tok-SECRET'), false, 'the reply is redacted');
  assert.equal(JSON.stringify(events).includes('tok-SECRET'), false, 'so is every event');
});

test('codexMcpOverrides: one server never gets another\'s env, and a clash in the shared env is refused', () => {
  const two = { a: { command: 'x', env: { A_KEY: '1' } }, b: { command: 'y', env: { B_KEY: '2' } } };
  const { args } = codexMcpOverrides(two, { passEnv: ['PATH', 'A_KEY', 'B_KEY'] });
  assert.ok(args.includes('mcp_servers.a.env_vars=["A_KEY","PATH"]'));
  assert.ok(args.includes('mcp_servers.b.env_vars=["B_KEY","PATH"]'));
  assert.throws(() => codexMcpOverrides({ a: { command: 'x', env: { K: '1' } }, b: { command: 'y', env: { K: '2' } } }), /K with different values/);
});

test('runCodexProcess: no model names CODEX_DEFAULT_MODEL, so the turn is priced', POSIX, async () => {
  const dir = tmp();
  const fake = fakeCodex(dir, 'ok');
  const events = [];
  await runCodexProcess({ cwd: dir, bin: fake.bin, prompt: 'P', onEvent: (e) => events.push(e), usageDir: dir });
  const args = fake.args();
  assert.equal(args[args.indexOf('-m') + 1], CODEX_DEFAULT_MODEL);
  assert.ok(events.find((e) => e.type === 'result').costUsd > 0);
});

test('runCodexProcess: maxTurns caps the main agent\'s tool calls with a turnCap error', POSIX, async () => {
  const cmd = (id) => [
    { type: 'item.started', item: { id, type: 'command_execution', command: 'ls', aggregated_output: '', exit_code: null, status: 'in_progress' } },
    { type: 'item.completed', item: { id, type: 'command_execution', command: 'ls', aggregated_output: '', exit_code: 0, status: 'completed' } },
  ];
  const lines = [{ type: 'thread.started', thread_id: '00000000-0000-4000-8000-0000000000ac' }, { type: 'turn.started' }, ...cmd('i1'), ...cmd('i2'),
    { type: 'item.completed', item: { id: 'i3', type: 'agent_message', text: 'done' } }, { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 1 } }];
  const dir = tmp();
  const fake = fakeCodex(dir, null, { lines });
  await assert.rejects(runCodexProcess({ cwd: dir, bin: fake.bin, prompt: 'P', maxTurns: 1, usageDir: dir }), (e) => e.turnCap === true && /stopped after 1 tool calls/.test(e.message));
  const ok = await runCodexProcess({ cwd: dir, bin: fake.bin, prompt: 'P', maxTurns: 2, usageDir: dir });
  assert.equal(ok.text, 'done', 'at the cap, not past it: the turn runs out');
});

test('runClaude forwards images and askLockdown to the codex adapter', POSIX, async () => {
  const dir = tmp();
  const fake = fakeCodex(dir, 'ok');
  const prev = process.env.WORCA_MOCK; delete process.env.WORCA_MOCK;
  try {
    await runClaude({ engine: 'codex', bin: fake.bin, cwd: dir, prompt: 'P', sandbox: 'read-only', askLockdown: CANDIDATE_LOCKDOWN, images: ['/img/a.png'] });
  } finally { if (prev !== undefined) process.env.WORCA_MOCK = prev; }
  const args = fake.args();
  assert.deepEqual(args.slice(0, 3), ['exec', '-i', '/img/a.png']);
  assert.ok(args.includes('shell_tool'));
});

test('normalizer: codex\'s native web search surfaces as WebSearch with its query', () => {
  const n = createCodexNormalizer({ model: 'gpt-5.5' });
  const out = n.push({ type: 'item.completed', item: { id: 'w1', type: 'web_search', query: 'worca' } });
  assert.deepEqual(out[0], { type: 'tool', parentId: null, calls: [{ name: 'WebSearch', input: { query: 'worca' }, toolUseId: 'w1' }] });
});
