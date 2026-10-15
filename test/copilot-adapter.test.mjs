// test/copilot-adapter.test.mjs — the GitHub Copilot CLI engine adapter (engines/copilot.mjs): argv, the
// deny-rule and tool plans, MCP config translation, the JSONL normalizer against real captures
// (test/fixtures/copilot, recorded from @github/copilot 1.0.92 against a stand-in model endpoint), error
// classification, the preflight and the spawn path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCopilotArgs, copilotRulePlan, copilotToolPlan, copilotMcpServers, copilotUnattachableMcp, mcpEnvRefNames,
  createCopilotNormalizer, classifyCopilotError, copilotSessionOf, COPILOT_SESSION_PREFIX, copilotCapabilities,
  readCopilotUsage, runCopilotProcess, copilotPreflight, copilotAgentFile, copilotInvestigatorAgent, copilotResumeNotFound,
  COPILOT_NO_TOOLS, COPILOT_NODE_AGENT, projectCopilotMcpNames,
} from '../src/core/engines/copilot.mjs';
import { getEngine, selectRunEngine } from '../src/core/engines/index.mjs';
import { EVENT_TYPES } from '../src/core/engines/events.mjs';
import { CAPABILITY_KEYS } from '../src/core/engines/capabilities.mjs';
import { fakeCopilot } from './helpers/fake-copilot.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { worcaHome } from '../src/core/projects.mjs';

const FIX = new URL('./fixtures/copilot/', import.meta.url);
const fixturePath = (name) => new URL(name, FIX).pathname;
const frames = (name) => readFileSync(new URL(name, FIX), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
useTempHome(after);
const POSIX = process.platform === 'win32' ? { skip: 'POSIX script fixtures' } : {};
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-copilot-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function replay(name, opts = {}) {
  const n = createCopilotNormalizer(opts);
  const events = frames(name).flatMap((f) => n.push(f));
  return { events, final: n.finish() };
}

const USAGE = (input, output, cached = 0) => ({ modelMetrics: { 'gpt-5.4': { requests: { count: 1, cost: 0 }, usage: { inputTokens: input, outputTokens: output, cacheReadTokens: cached, cacheWriteTokens: 0, reasoningTokens: 0 } } } });

// ── registry ─────────────────────────────────────────────────────────────────

test('copilot is a run engine with its own preflight, rule plan and MCP check', () => {
  const a = getEngine('copilot');
  assert.equal(a.name, 'copilot');
  assert.equal(selectRunEngine('copilot'), 'copilot');
  for (const k of ['run', 'classifyError', 'preflight', 'unenforcedRules', 'partialRules', 'unattachableMcp']) assert.equal(typeof a[k], 'function', k);
  assert.equal(typeof a.ruleReach, 'string');
  assert.equal(getEngine('copilot', { mock: true }).name, 'mock');
});

test('capabilities: every key declared; only cost, hook telemetry and the turn budget degrade', () => {
  assert.deepEqual(Object.keys(copilotCapabilities).sort(), [...CAPABILITY_KEYS].sort());
  assert.deepEqual(Object.entries(copilotCapabilities).filter(([, v]) => v === false).map(([k]) => k).sort(), ['cost', 'hookTelemetry', 'turnBudget']);
});

test('session ids are engine-qualified; a claude or codex id is not a copilot session', () => {
  const id = '745aadb8-8bd7-4390-b820-3f2142b0def3';
  assert.equal(copilotSessionOf(COPILOT_SESSION_PREFIX + id), id);
  assert.equal(copilotSessionOf(id), null);
  assert.equal(copilotSessionOf('codex:th-1'), null);
  assert.equal(copilotSessionOf('copilot:not-a-uuid'), null);
});

// ── argv ─────────────────────────────────────────────────────────────────────

test('fresh run: JSON output, tools allowed without asking, no auto-update, no built-in MCP, a named new session', () => {
  assert.deepEqual(buildCopilotArgs({ sessionId: 'S1', agent: 'worca-node', addDirs: ['/scratch', '/mem', '/mem'] }), [
    '--output-format', 'json', '--allow-all-tools', '--no-ask-user', '--no-auto-update', '--no-color', '--disable-builtin-mcps',
    '--session-id=S1', '--agent', 'worca-node', '--add-dir', '/scratch', '--add-dir', '/mem']);
});

test('resume, model, effort, MCP, tool filters and deny rules', () => {
  const args = buildCopilotArgs({ sessionId: 'S1', resume: true, model: 'gpt-5.4', effort: 'high', mcpConfigFile: '/s/mcp.json', disableMcp: ['mine'],
    excludedTools: ['task', 'task'], deny: ['shell(git push)', 'write'], usageFile: '/s/usage.json' });
  assert.ok(args.includes('--resume=S1') && !args.some((a) => a.startsWith('--session-id')));
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 4), ['--model', 'gpt-5.4', '--reasoning-effort', 'high']);
  assert.deepEqual(args.slice(args.indexOf('--additional-mcp-config'), args.indexOf('--additional-mcp-config') + 4), ['--additional-mcp-config', '@/s/mcp.json', '--disable-mcp-server', 'mine']);
  assert.ok(args.includes('--excluded-tools=task'));
  assert.ok(args.includes('--deny-tool=shell(git push)') && args.includes('--deny-tool=write'));
  assert.deepEqual(args.slice(-2), ['--usage-output-file', '/s/usage.json']);
});

test('an effort copilot does not offer is dropped', () => {
  assert.ok(!buildCopilotArgs({ sessionId: 'S', effort: 'turbo' }).includes('--reasoning-effort'));
});

test('read-only: no temp dir, and an empty tool list names nothing (an empty --available-tools keeps every tool)', () => {
  const args = buildCopilotArgs({ sessionId: 'S', availableTools: [], readOnly: true });
  assert.ok(args.includes('--disallow-temp-dir'));
  assert.ok(args.includes(`--available-tools=${COPILOT_NO_TOOLS}`));
  assert.ok(buildCopilotArgs({ sessionId: 'S', availableTools: ['worca_files'] }).includes('--available-tools=worca_files'));
});

// ── permission rules and tools ───────────────────────────────────────────────

test('deny rules: what copilot holds, holds in part, and cannot hold', () => {
  const plan = copilotRulePlan({ deny: ['Bash', 'WebSearch', 'WebFetch', 'mcp__github__create_issue', 'mcp__slack',
    'Bash(git push:*)', 'Bash(curl)', 'Bash(gh pr create)', 'Edit(./secrets/key.pem)', 'Write',
    'Bash(rm -rf)', 'Bash(npm run *)', 'Read(./.env)', 'Edit(src/**)', 'Bash(echo $HOME)'], allow: ['Bash(ls)'] });
  assert.deepEqual(plan.enforced, ['Bash', 'WebSearch', 'WebFetch', 'mcp__github__create_issue', 'mcp__slack']);
  assert.deepEqual(plan.partial, ['Bash(git push:*)', 'Bash(curl)', 'Bash(gh pr create)', 'Edit(./secrets/key.pem)', 'Write', 'Bash(npm run *)']);
  // A flag is not part of a copilot shell match (`shell(rm -rf)` lets `rm -rf x` run): never pretend.
  assert.deepEqual(plan.unenforced, ['Bash(rm -rf)', 'Read(./.env)', 'Edit(src/**)', 'Bash(echo $HOME)']);
  assert.deepEqual(plan.deny, ['shell', 'github(create_issue)', 'slack', 'shell(git push)', 'shell(curl:*)', 'shell(gh pr create)', 'write(secrets/key.pem)', 'write', 'shell(npm run)']);
  assert.deepEqual(plan.excluded, ['web_search', 'web_fetch']);
  assert.deepEqual(getEngine('copilot').unenforcedRules({ deny: ['Read(x)'] }), ['Read(x)']);
  assert.deepEqual(getEngine('copilot').partialRules({ deny: ['Bash(curl)'] }), ['Bash(curl)']);
});

test('WebFetch is held only when the shell and web search are denied too (curl or a search still fetch a page)', () => {
  for (const deny of [['WebFetch'], ['WebFetch', 'WebSearch'], ['WebFetch', 'Bash']]) {
    const plan = copilotRulePlan({ deny });
    assert.ok(plan.unenforced.includes('WebFetch') && !plan.enforced.includes('WebFetch'), JSON.stringify(deny));
    assert.ok(plan.excluded.includes('web_fetch'), 'the fetch tool is still removed');
  }
  assert.ok(copilotRulePlan({ deny: ['Bash', 'WebSearch', 'WebFetch'] }).enforced.includes('WebFetch'));
});

test('allowedTools: what a role is not granted is withheld; no list withholds nothing', () => {
  assert.deepEqual(copilotToolPlan(undefined), { deny: [], excluded: [] });
  const ro = copilotToolPlan(['Read', 'Grep', 'Glob']);
  assert.deepEqual(ro.deny, ['shell', 'write']);
  assert.ok(ro.excluded.includes('bash') && ro.excluded.includes('task') && ro.excluded.includes('web_fetch'));
  const full = copilotToolPlan(['Read', 'Write', 'Edit', 'Bash(git:*)', 'Agent', 'WebFetch', 'WebSearch']);
  assert.deepEqual(full, { deny: [], excluded: [] });
});

// ── MCP ──────────────────────────────────────────────────────────────────────

test('MCP: Claude Code servers in copilot shape, every tool on; a server with no command or url is not attachable', () => {
  const servers = {
    probe: { command: 'node', args: ['srv.mjs', 1], env: { TOKEN: '${MCPSECRET_A}' } },
    remote: { type: 'http', url: 'https://mcp.example/x', headers: { Authorization: 'Bearer ${MCPSECRET_B}' } },
    events: { type: 'sse', url: 'https://mcp.example/sse' },
    broken: { type: 'stdio' },
    'bad name': { command: 'x' },
  };
  assert.deepEqual(copilotMcpServers(servers), {
    probe: { type: 'local', command: 'node', args: ['srv.mjs', '1'], env: { TOKEN: '${MCPSECRET_A}' }, tools: ['*'] },
    remote: { type: 'http', url: 'https://mcp.example/x', headers: { Authorization: 'Bearer ${MCPSECRET_B}' }, tools: ['*'] },
    events: { type: 'sse', url: 'https://mcp.example/sse', tools: ['*'] },
  });
  assert.deepEqual(copilotUnattachableMcp(servers), ['broken', 'bad name']);
  assert.deepEqual(mcpEnvRefNames(copilotMcpServers(servers)).sort(), ['MCPSECRET_A', 'MCPSECRET_B']);
});

// ── agents ───────────────────────────────────────────────────────────────────

test('agent files: frontmatter plus the prompt as the body; the investigator carries the memory block, read-only tools', () => {
  const node = copilotAgentFile({ name: 'worca-node', description: 'd', prompt: 'Be terse.\n---\nstill body' });
  assert.equal(node, '---\nname: "worca-node"\ndescription: "d"\n---\n\nBe terse.\n---\nstill body\n');
  const inv = copilotInvestigatorAgent({ agents: { investigator: { description: 'Looks', prompt: 'Investigate.', model: 'sonnet' } }, subagentSystemPrompt: 'MEMORY: /mem' });
  assert.match(inv, /^---\nname: "worca-investigator"\ndescription: "Looks"\ntools: \["view","rg","glob","bash",/);
  assert.ok(!/model:/.test(inv), 'a Claude definition model is never handed to copilot');
  assert.match(inv, /Investigate\.\n\nMEMORY: \/mem\n$/);
});

// ── stream ───────────────────────────────────────────────────────────────────

test('the init line names the model the session runs, once', () => {
  const { events } = replay('tools.jsonl', { sessionId: 'copilot:x' });
  assert.deepEqual(events.filter((e) => e.type === 'session'), [{ type: 'session', sessionId: 'copilot:x', model: 'gpt-5.4', init: true }]);
  assert.deepEqual(replay('tools.jsonl').events.filter((e) => e.type === 'session'), [], 'no session id, no line');
});

test('tools capture: text, tool rows under Claude names, results, a failing command is an error', () => {
  const { events, final } = replay('tools.jsonl', { model: 'gpt-5.4' });
  for (const e of events) assert.ok(EVENT_TYPES.has(e.type), e.type);
  const texts = events.filter((e) => e.type === 'text');
  assert.deepEqual(texts.map((t) => t.text), ['Looking.', 'Done: hello']);
  const calls = events.filter((e) => e.type === 'tool').flatMap((e) => e.calls);
  assert.deepEqual(calls.map((c) => c.name), ['Bash', 'Read', 'Bash', 'mcp__probe__echo_env']);
  assert.equal(calls[0].input.command, 'cat a.txt');
  assert.equal(calls[1].input.file_path, '/repo/a.txt');
  const results = events.filter((e) => e.type === 'toolResult').flatMap((e) => e.results);
  assert.deepEqual(results.map((r) => r.isError), [false, false, true, false]);
  assert.match(results[0].text, /^hello\n/);
  assert.equal(results[3].text, 'FOO=bar');
  assert.equal(final.text, 'Looking.\nDone: hello');
  assert.equal(final.error, null);
  assert.equal(final.exitCode, 0);
  assert.match(final.sessionId, /^[0-9a-f-]{36}$/);
});

test('sub-agent capture: one sub-agent row, its own calls parented to it, its text kept out of the answer', () => {
  const { events, final } = replay('subagent.jsonl');
  const sub = events.filter((e) => e.type === 'subagent');
  assert.deepEqual(sub.map((s) => s.event), ['spawn', 'finish']);
  assert.equal(sub[0].toolUseId, 'call_1_0');
  assert.equal(sub[0].subagentType, 'explore');
  assert.equal(sub[0].label, 'look around');
  assert.ok(Number.isFinite(sub[1].tokens));
  const tools = events.filter((e) => e.type === 'tool');
  assert.deepEqual(tools.map((t) => [t.parentId, t.calls[0].name]), [['call_1_0', 'Bash']], 'the task call itself is the sub-agent row, not a tool row');
  const subText = events.find((e) => e.type === 'text' && e.text === 'sub result here');
  assert.equal(subText.parentId, 'call_1_0');
  assert.equal(final.text, 'all done');
});

test('a denied tool comes back as an error result', () => {
  const { events, final } = replay('denied.jsonl');
  const r = events.find((e) => e.type === 'toolResult').results[0];
  assert.equal(r.isError, true);
  assert.match(r.text, /denied due to the following rules: `shell\(git push\)`/);
  assert.equal(final.error, null);
});

test('a failed session: retries, then the session error, classified by its type', () => {
  const { events, final } = replay('auth-error.jsonl');
  assert.ok(events.filter((e) => e.type === 'retry').every((e) => e.httpStatus === 401));
  assert.match(final.error, /Authentication failed with provider/);
  assert.equal(final.errorType, 'authentication');
  assert.equal(final.exitCode, 1);
  assert.equal(classifyCopilotError({ errorType: final.errorType, message: final.error }), 'auth');
});

test('error classes', () => {
  assert.equal(classifyCopilotError({ errorType: 'rate_limit', message: 'x' }), 'rate_limit');
  assert.equal(classifyCopilotError({ errorType: 'quota', message: 'x' }), 'usage_limit');
  assert.equal(classifyCopilotError('You have exceeded your premium request allowance'), 'usage_limit');
  assert.equal(classifyCopilotError('HTTP 429 Too Many Requests'), 'rate_limit');
  assert.equal(classifyCopilotError('No authentication information found. Run copilot login'), 'auth');
  assert.equal(classifyCopilotError('getaddrinfo ENOTFOUND api.githubcopilot.com'), 'network');
  assert.equal(classifyCopilotError('something else'), null);
  assert.equal(classifyCopilotError(Object.assign(new Error('x'), { errorClass: 'quota' })), 'quota');
  assert.ok(copilotResumeNotFound(new Error("Error: No session, task, or name matched 'abc'.")));
});

test('usage: the usage file summed over its models', () => {
  assert.deepEqual(readCopilotUsage({ modelMetrics: { a: { usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 4 } }, b: { usage: { inputTokens: 5, outputTokens: 1, reasoningTokens: 1 } } } }),
    { input: 15, cached: 4, cacheWrite: 0, output: 3, reasoning: 1 });
  assert.equal(readCopilotUsage({}), null);
});

// ── spawn ────────────────────────────────────────────────────────────────────

test('spawn: the prompt on stdin, the system prompt as the node agent, a session event first, the usage in the result', POSIX, async () => {
  const dir = tmp();
  const f = fakeCopilot(dir, { fixture: fixturePath('tools.jsonl'), usage: USAGE(1000, 50, 100) });
  const events = [];
  const res = await runCopilotProcess({ bin: f.bin, cwd: dir, prompt: 'read a', systemPrompt: 'You are the planner.', model: 'gpt-5.4', effort: 'low',
    addDirs: ['/mem'], writableDirs: [join(dir, 'out')], usageDir: join(dir, 'usage'), scratchBase: join(dir, 'scratch'), onEvent: (e) => events.push(e) });
  assert.equal(res.text, 'Looking.\nDone: hello');
  const rec = f.record();
  assert.equal(rec.stdin, 'read a');
  assert.ok(!rec.argv.includes('-p'), 'no -p: the prompt never rides argv');
  assert.match(rec.agentFile, /You are the planner\.\n$/);
  assert.equal(rec.argv[rec.argv.indexOf('--agent') + 1], COPILOT_NODE_AGENT);
  assert.ok(rec.argv.includes('/mem') && rec.argv.includes(join(dir, 'out')));
  assert.ok(rec.argv.includes('--model') && rec.argv.includes('gpt-5.4') && rec.argv.includes('low'));
  const sid = rec.argv.find((a) => a.startsWith('--session-id=')).slice('--session-id='.length);
  assert.deepEqual(events[0], { type: 'session', sessionId: `copilot:${sid}` }, 'the session is named before copilot starts');
  assert.deepEqual(events.filter((e) => e.type === 'session' && e.init), [{ type: 'session', sessionId: `copilot:${sid}`, model: 'gpt-5.4', init: true }]);
  const result = events.filter((e) => e.type === 'result');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].usage, { input_tokens: 900, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, output_tokens: 50 });
  assert.equal(result[0].costUsd, undefined, 'Copilot bills AI credits: no dollar figure');
  assert.deepEqual(readdirSync(join(dir, 'scratch')), [], 'the scratch folder is gone');
});

test('the project\'s own .mcp.json servers, which Copilot loads by itself in a trusted folder, are turned off unless worca hands them over', POSIX, async () => {
  const repo = tmp();
  mkdirSync(join(repo, '.git'));
  mkdirSync(join(repo, '.github'));
  const cwd = join(repo, 'pkg');
  mkdirSync(cwd);
  writeFileSync(join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { approved: { command: 'node' }, rogue: { command: 'node' } } }));
  writeFileSync(join(repo, '.github', 'mcp.json'), JSON.stringify({ mcpServers: { shipped: { type: 'http', url: 'https://x.example/' } } }));
  writeFileSync(join(cwd, '.mcp.json'), '\uFEFF' + JSON.stringify({ mcpServers: { nearer: { command: 'node' } } }));
  assert.deepEqual(projectCopilotMcpNames(cwd), ['approved', 'nearer', 'rogue', 'shipped']);
  assert.deepEqual(projectCopilotMcpNames(join(tmp(), 'missing')), [], 'nothing to read: nothing to turn off');

  const mcp = join(repo, 'run-mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { approved: { command: 'node', args: ['/abs/a.js'] } } }));
  const f = fakeCopilot(repo, { fixture: fixturePath('tools.jsonl'), usage: USAGE(10, 1, 0) });
  await runCopilotProcess({ bin: f.bin, cwd, prompt: 'x', mcpConfigPath: mcp, usageDir: join(repo, 'usage'), scratchBase: join(repo, 'scratch') });
  const argv = f.record().argv;
  const off = argv.flatMap((a, i) => (a === '--disable-mcp-server' ? [argv[i + 1]] : []));
  assert.deepEqual(off.filter((n) => n !== 'mine').sort(), ['nearer', 'rogue', 'shipped'], 'every project server but the one worca attaches');
});

test('resume: --resume=<session>, and only the turn\'s delta of the cumulative usage', POSIX, async () => {
  const dir = tmp();
  const usageDir = join(dir, 'usage');
  const first = fakeCopilot(dir, { fixture: fixturePath('tools.jsonl'), usage: USAGE(1000, 50) });
  const events = [];
  await runCopilotProcess({ bin: first.bin, cwd: dir, prompt: 'one', usageDir, scratchBase: join(dir, 's'), onEvent: (e) => events.push(e) });
  const sid = events[0].sessionId;
  const second = fakeCopilot(dir, { fixture: fixturePath('tools.jsonl'), usage: USAGE(2500, 80) });
  const again = [];
  await runCopilotProcess({ bin: second.bin, cwd: dir, prompt: 'two', resumeSessionId: sid, usageDir, scratchBase: join(dir, 's'), onEvent: (e) => again.push(e) });
  assert.ok(second.record().argv.includes(`--resume=${sid.slice('copilot:'.length)}`));
  assert.equal(again[0].sessionId, sid);
  assert.deepEqual(again.find((e) => e.type === 'result').usage, { input_tokens: 1500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 30 });
});

test('a foreign stored session starts a fresh copilot session and says so', POSIX, async () => {
  const dir = tmp();
  const f = fakeCopilot(dir, { fixture: fixturePath('tools.jsonl') });
  const events = [];
  await runCopilotProcess({ bin: f.bin, cwd: dir, resumeSessionId: 'codex:th-1', usageDir: join(dir, 'u'), scratchBase: join(dir, 's'), onEvent: (e) => events.push(e) });
  assert.ok(f.record().argv.some((a) => a.startsWith('--session-id=')));
  assert.ok(events.some((e) => e.type === 'stderr' && /is not a Copilot session/.test(e.text)));
});

test('guardrails, tools, fan-out and MCP reach copilot; secret values reach its env, never argv or the config file', POSIX, async () => {
  const dir = tmp();
  const mcpPath = join(dir, 'mcp.json');
  writeFileSync(mcpPath, JSON.stringify({ mcpServers: { probe: { command: 'node', args: ['srv.mjs'], env: { TOKEN: '${MCPSECRET_PROBE_TOKEN}' } } } }));
  const f = fakeCopilot(dir, { fixture: fixturePath('tools.jsonl'), envNames: ['MCPSECRET_PROBE_TOKEN', 'GH_TOKEN', 'COPILOT_AUTO_UPDATE'] });
  const prevGh = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'ghp_should_not_pass';
  try {
    await runCopilotProcess({ bin: f.bin, cwd: dir, prompt: 'x', mcpConfigPath: mcpPath, spawnEnv: { MCPSECRET_PROBE_TOKEN: 's3cret-value' },
      permissionRules: { deny: ['Bash(git push:*)', 'mcp__probe__wipe', 'WebSearch'] }, allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Agent'],
      agents: { investigator: { prompt: 'Look only.' } }, appendSubagentSystemPrompt: 'MEMORY', usageDir: join(dir, 'u'), scratchBase: join(dir, 's') });
  } finally {
    if (prevGh === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = prevGh;
  }
  const rec = f.record();
  assert.ok(rec.argv.includes('--deny-tool=shell(git push)') && rec.argv.includes('--deny-tool=probe(wipe)'));
  // WebSearch is denied by the rules; WebFetch is not in the role's tools.
  assert.ok(rec.argv.includes('--excluded-tools=web_search,web_fetch'));
  assert.ok(!rec.argv.includes('--deny-tool=shell') && !rec.argv.some((a) => a.startsWith('--available-tools')));
  assert.deepEqual(JSON.parse(rec.mcp), { mcpServers: { probe: { type: 'local', command: 'node', args: ['srv.mjs'], env: { TOKEN: '${MCPSECRET_PROBE_TOKEN}' }, tools: ['*'] } } });
  assert.equal(rec.env.MCPSECRET_PROBE_TOKEN, 's3cret-value');
  assert.equal(rec.env.GH_TOKEN, null, 'a GitHub credential never reaches the agent');
  assert.equal(rec.env.COPILOT_AUTO_UPDATE, 'false');
  assert.ok(!rec.argv.join(' ').includes('s3cret-value'));
  assert.match(rec.investigator, /Look only\.\n\nMEMORY\n$/);
});

test('read-only (a helper job): no built-in tool, only the MCP servers handed over, no extra dirs', POSIX, async () => {
  const dir = tmp();
  const mcpPath = join(dir, 'mcp.json');
  writeFileSync(mcpPath, JSON.stringify({ mcpServers: { worca_files: { type: 'stdio', command: 'node', args: ['files.mjs'] } } }));
  const f = fakeCopilot(dir, { fixture: fixturePath('tools.jsonl') });
  await runCopilotProcess({ bin: f.bin, cwd: dir, prompt: 'x', sandbox: 'read-only', mcpConfigPath: mcpPath, addDirs: ['/mem'], allowedTools: ['Agent'],
    usageDir: join(dir, 'u'), scratchBase: join(dir, 's') });
  const argv = f.record().argv;
  assert.ok(argv.includes('--available-tools=worca_files') && argv.includes('--disallow-temp-dir'));
  assert.equal(argv.filter((a) => a === '--add-dir').length, 1, 'only the scratch folder that holds the agent');
  assert.equal(f.record().investigator, null, 'no fan-out on a read-only spawn');
  const bare = fakeCopilot(dir, { fixture: fixturePath('tools.jsonl') });
  await runCopilotProcess({ bin: bare.bin, cwd: dir, prompt: 'x', sandbox: 'read-only', usageDir: join(dir, 'u'), scratchBase: join(dir, 's') });
  assert.ok(bare.record().argv.includes(`--available-tools=${COPILOT_NO_TOOLS}`));
});

test('a failed session rejects with its class, and the session error leads the message', POSIX, async () => {
  const dir = tmp();
  const f = fakeCopilot(dir, { fixture: fixturePath('auth-error.jsonl'), code: 1 });
  await assert.rejects(runCopilotProcess({ bin: f.bin, cwd: dir, prompt: 'x', usageDir: join(dir, 'u'), scratchBase: join(dir, 's') }),
    (err) => err.errorClass === 'auth' && /Authentication failed with provider/.test(err.message));
  assert.deepEqual(readdirSync(join(dir, 's')), []);
});

test('maxTurns: the main agent\'s call past the cap stops the turn', POSIX, async () => {
  const dir = tmp();
  const f = fakeCopilot(dir, { fixture: fixturePath('tools.jsonl'), holdMs: 0 });
  await assert.rejects(runCopilotProcess({ bin: f.bin, cwd: dir, prompt: 'x', maxTurns: 2, usageDir: join(dir, 'u'), scratchBase: join(dir, 's') }),
    (err) => err.turnCap === true && /stopped after 2 tool calls/.test(err.message));
});

test('secrets are redacted from events and the answer', POSIX, async () => {
  const dir = tmp();
  const f = fakeCopilot(dir, { fixture: fixturePath('tools.jsonl') });
  const events = [];
  const res = await runCopilotProcess({ bin: f.bin, cwd: dir, prompt: 'x', redactValues: ['Done: hello'], usageDir: join(dir, 'u'), scratchBase: join(dir, 's'), onEvent: (e) => events.push(e) });
  assert.equal(res.text, 'Looking.\n[redacted]');
  assert.ok(!JSON.stringify(events).includes('Done: hello'));
});

test('runCopilotProcess refuses a writable folder inside Worca\'s home before it spawns or writes anything', POSIX, async () => {
  const dir = tmp();
  const f = fakeCopilot(dir, { fixture: fixturePath('tools.jsonl') });
  const plugins = join(worcaHome(), 'plugins');
  const base = { bin: f.bin, cwd: dir, prompt: 'x', usageDir: join(dir, 'u'), scratchBase: join(dir, 's') };
  await assert.rejects(runCopilotProcess({ ...base, addDirs: [plugins] }),
    (err) => err.message.includes(`it would be able to write ${plugins}, inside Worca's home`));
  await assert.rejects(runCopilotProcess({ ...base, writableDirs: [worcaHome()] }), /refusing to start copilot/);
  await assert.rejects(runCopilotProcess({ ...base, cwd: worcaHome() }), /refusing to start copilot/);
  assert.equal(existsSync(join(dir, 'record.json')), false, 'copilot never ran');
  assert.equal(existsSync(join(dir, 's')), false, 'no scratch folder was written');
  // A read-only spawn adds no folder, so nothing is refused; the run store is allowed.
  await runCopilotProcess({ ...base, sandbox: 'read-only', addDirs: [plugins] });
  const plans = join(worcaHome(), 'store', 'k', 'plans');
  await runCopilotProcess({ ...base, writableDirs: [plans] });
  assert.ok(f.record().argv.includes(plans));
});

test('Ask Worca does not run on copilot', async () => {
  await assert.rejects(runCopilotProcess({ askLockdown: true, bin: '/nonexistent/copilot' }), /Ask Worca does not run on Copilot/);
});

test('preflight: a missing binary refuses the run; a working one passes', POSIX, async () => {
  assert.match((await copilotPreflight({ bin: '/nonexistent/copilot' })).refusal, /cannot run \/nonexistent\/copilot \(ENOENT\)/);
  const dir = tmp();
  const bin = join(dir, 'copilot');
  writeFileSync(bin, '#!/bin/sh\necho "GitHub Copilot CLI 1.0.92."\n');
  chmodSync(bin, 0o755);
  assert.deepEqual(await copilotPreflight({ bin }), {});
  writeFileSync(bin, '#!/bin/sh\nexit 2\n');
  assert.match((await copilotPreflight({ bin })).warning, /exited with code 2/);
});

// ── live (opt-in) ────────────────────────────────────────────────────────────

// WORCA_COPILOT_LIVE_BIN=<copilot> node --test test/copilot-adapter.test.mjs — the real binary in BYOK mode against
// the stand-in Responses endpoint (no GitHub sign-in needed): the system prompt reaches the model as the agent's
// instructions, and the reply, the session and the usage come back through the adapter.
const LIVE = process.env.WORCA_COPILOT_LIVE_BIN;
test('live: the real copilot binary end to end', { skip: !LIVE && 'set WORCA_COPILOT_LIVE_BIN to run' }, async () => {
  const { startFakeResponses } = await import('./helpers/fake-openai-responses.mjs');
  const srv = await startFakeResponses({ key: null, reply: 'PONG' });
  const dir = tmp();
  const prev = { ...process.env };
  Object.assign(process.env, { COPILOT_PROVIDER_BASE_URL: srv.url, COPILOT_PROVIDER_WIRE_API: 'responses', COPILOT_MODEL: 'gpt-5.4', COPILOT_OFFLINE: 'true', COPILOT_HOME: join(dir, 'home') });
  try {
    const events = [];
    const res = await runCopilotProcess({ bin: LIVE, cwd: dir, prompt: 'say pong', systemPrompt: 'LIVE-SYSTEM-MARKER', usageDir: join(dir, 'u'), scratchBase: join(dir, 's'), onEvent: (e) => events.push(e) });
    assert.equal(res.text, 'PONG');
    assert.ok(JSON.stringify(srv.requests[0].body.instructions).includes('LIVE-SYSTEM-MARKER'));
    assert.ok(events.find((e) => e.type === 'result').usage.output_tokens > 0);
    assert.ok(existsSync(join(dir, 'u')));
  } finally {
    for (const k of ['COPILOT_PROVIDER_BASE_URL', 'COPILOT_PROVIDER_WIRE_API', 'COPILOT_MODEL', 'COPILOT_OFFLINE', 'COPILOT_HOME']) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
    await srv.close();
  }
});
