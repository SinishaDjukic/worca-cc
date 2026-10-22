// test/opencode-adapter.test.mjs — the OpenCode CLI adapter: argv, the `--format json` normalizer against the
// captured fixtures (test/fixtures/opencode, opencode 1.18.23), the rule plan, the inline config, error classes,
// preflight and the spawn path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, realpathSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildOpencodeArgs, createOpencodeNormalizer, classifyOpencodeError, opencodeSessionOf, OPENCODE_SESSION_PREFIX,
  opencodeRulePlan, opencodeCapabilities, opencodePreflight, runOpencodeProcess, OPENCODE_ASK_LOCKDOWN, opencodeMcpServers,
  parseOpencodeProviders, readSubsession, OPENCODE_EFFORTS, OPENCODE_RESUME_NOT_FOUND_RE,
} from '../src/core/engines/opencode.mjs';
import { EVENT_TYPES, isNormalized } from '../src/core/engines/events.mjs';
import { CAPABILITY_KEYS } from '../src/core/engines/capabilities.mjs';
import { fakeOpencode, opencodeReplyLines } from './helpers/fake-opencode.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

const FIX = new URL('./fixtures/opencode/', import.meta.url);
const text = (name) => readFileSync(new URL(name, FIX), 'utf8');
const frames = (name) => text(name).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
useTempHome(after);
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-opencode-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const replay = (name, opts) => { const n = createOpencodeNormalizer(opts); return { events: frames(name).flatMap((f) => n.push(f)), final: n.finish() }; };

test('argv: run, json events, auto-approve, no external plugins, error logs on stderr; the prompt goes on stdin', () => {
  assert.deepEqual(buildOpencodeArgs({}), ['run', '--format', 'json', '--auto', '--pure', '--print-logs', '--log-level', 'ERROR']);
  assert.deepEqual(buildOpencodeArgs({ agent: 'worca-node', model: 'anthropic/claude-sonnet-4-5', effort: 'high', sessionId: 'ses_1' }),
    ['run', '--format', 'json', '--auto', '--pure', '--print-logs', '--log-level', 'ERROR', '--agent', 'worca-node', '-m', 'anthropic/claude-sonnet-4-5', '--variant', 'high', '-s', 'ses_1']);
});

test('session ids are engine-qualified; another engine\'s id is not an OpenCode session', () => {
  assert.equal(OPENCODE_SESSION_PREFIX, 'opencode:');
  assert.equal(opencodeSessionOf('opencode:ses_abc123'), 'ses_abc123');
  assert.equal(opencodeSessionOf('opencode:../x'), null);
  assert.equal(opencodeSessionOf('cursor:ses_abc123'), null);
  assert.equal(opencodeSessionOf('8f1c0000-0000-4000-8000-000000000000'), null);
});

test('normalizer (captured): session, Bash and Write rows, text, per-step usage, a result with cost and tokens', () => {
  const { events, final } = replay('shell-and-write.jsonl', { model: 'opencode/big-pickle' });
  for (const e of events) assert.ok(EVENT_TYPES.has(e.type) && isNormalized(e), JSON.stringify(e));
  assert.deepEqual(events[0], { type: 'session', sessionId: 'opencode:ses_ee2d0a8afffeylFcD9eRqk9ykh', model: 'opencode/big-pickle', init: true });
  const calls = events.filter((e) => e.type === 'tool').flatMap((e) => e.calls);
  assert.deepEqual(calls.map((c) => [c.name, c.input]), [
    ['Bash', { command: 'echo hello-from-shell' }],
    ['Write', { file_path: '/tmp/oc-spike/proj/note.txt', content: 'hi' }],
  ]);
  const results = events.filter((e) => e.type === 'toolResult').flatMap((e) => e.results);
  assert.deepEqual(results.map((r) => [r.isError, r.text]), [[false, 'hello-from-shell\n'], [false, 'Wrote file successfully.']]);
  const usage = events.filter((e) => e.type === 'usage');
  assert.equal(usage.length, 2);
  assert.deepEqual(usage[0], { type: 'usage', messageId: 'msg_11d2f59c2001mE65nuy2VXNHjf', parentId: null, phase: 'message', model: 'opencode/big-pickle',
    usage: { input_tokens: 7796, output_tokens: 137, cache_read_input_tokens: 64, cache_creation_input_tokens: 0 } });
  assert.equal(events.filter((e) => e.type === 'text').map((e) => e.text).join(''), 'DONE');
  assert.equal(final.error, null);
  assert.equal(final.sessionId, 'ses_ee2d0a8afffeylFcD9eRqk9ykh');
  assert.equal(final.costUsd, 0);
  assert.deepEqual(final.usage, { input_tokens: 8005, output_tokens: 147, cache_read_input_tokens: 7872, cache_creation_input_tokens: 0 });
  assert.equal(final.text, 'DONE');
});

test('normalizer (captured): an MCP tool is named mcp__server__tool by the attached server names; a failed read is an error row', () => {
  const { events } = replay('mcp-and-failed-read.jsonl', { mcpServers: ['spike'] });
  assert.deepEqual(events.filter((e) => e.type === 'tool').flatMap((e) => e.calls).map((c) => c.name), ['mcp__spike__magic_number', 'Read']);
  const read = events.filter((e) => e.type === 'toolResult').flatMap((e) => e.results)[1];
  assert.equal(read.isError, true);
  assert.match(read.text, /File not found/);
  // A server worca did not attach (the user's own) keeps OpenCode's name.
  const own = replay('mcp-and-failed-read.jsonl').events.filter((e) => e.type === 'tool').flatMap((e) => e.calls)[0];
  assert.equal(own.name, 'spike_magic_number');
});

test('normalizer (captured): a call a permission rule refused is an error row naming the rule', () => {
  const { events } = replay('permission-denied.jsonl');
  const rows = events.filter((e) => e.type === 'toolResult').flatMap((e) => e.results);
  assert.deepEqual(rows.map((r) => r.isError), [true, true, true, false, false]);
  assert.match(rows[0].text, /prevents you from using this specific tool call/);
});

test('normalizer (captured): a task call is a sub-agent row, its session is kept for its cost', () => {
  const { events, final } = replay('task-subagent.jsonl');
  const sub = events.filter((e) => e.type === 'subagent');
  assert.deepEqual(sub.map((e) => e.event), ['spawn', 'finish']);
  assert.equal(sub[0].toolUseId, 'call_5cc0884d58254297af7ea85e');
  assert.equal(sub[0].label, 'Run echo from-sub');
  assert.equal(sub[0].subagentType, 'general');
  assert.ok(!events.some((e) => e.type === 'tool' && e.calls.some((c) => c.toolUseId === 'call_5cc0884d58254297af7ea85e')), 'no tool row for the task');
  assert.deepEqual(final.subSessions, [{ sessionId: 'ses_ee2c6ffe4ffe2lbboOzQjzEkHc', toolUseId: 'call_5cc0884d58254297af7ea85e' }]);
});

test('normalizer (captured): an error event fails the run, with its class', () => {
  const auth = replay('error-auth.jsonl').final;
  assert.match(auth.error, /API key is missing/);
  assert.equal(classifyOpencodeError({ name: auth.errorName, message: auth.error }), 'auth');
  const free = replay('error-free-tier.jsonl').final;
  assert.match(free.error, /free tier/);
  assert.equal(free.statusCode, 403);
  assert.equal(classifyOpencodeError({ name: free.errorName, statusCode: free.statusCode, message: free.error }), null, 'not a sign-in problem');
  assert.match(replay('error-unknown.jsonl').final.error, /Unexpected server error/);
});

test('sub-session: the export\'s assistant messages summed; its tool calls as events under the task call', () => {
  const sub = readSubsession(text('export-subsession.json'), { parentId: 'call_task' });
  assert.equal(sub.costUsd, 0);
  assert.deepEqual(sub.usage, { input_tokens: 5351, output_tokens: 267, cache_read_input_tokens: 5522, cache_creation_input_tokens: 0 });
  assert.deepEqual(sub.events.map((e) => [e.type, e.parentId]), [['tool', 'call_task'], ['toolResult', 'call_task']]);
  assert.equal(sub.events[0].calls[0].toolUseId, 'c0ab08be-bf93-469b-b8dc-0c2991ac3ac1');
  assert.equal(sub.events[1].results[0].toolUseId, 'c0ab08be-bf93-469b-b8dc-0c2991ac3ac1');
  assert.ok(sub.events.every(isNormalized), JSON.stringify(sub.events));
  assert.equal(readSubsession('not json'), null);
});

test('error classes', () => {
  assert.equal(classifyOpencodeError({ name: 'ProviderAuthError', message: 'x' }), 'auth');
  assert.equal(classifyOpencodeError({ name: 'APIError', statusCode: 401, message: 'Unauthorized' }), 'auth');
  assert.equal(classifyOpencodeError({ name: 'APIError', statusCode: 429, message: 'Too Many Requests' }), 'rate_limit');
  assert.equal(classifyOpencodeError('You have reached your usage limit, resets at 5pm'), 'usage_limit');
  assert.equal(classifyOpencodeError('insufficient_quota'), 'quota');
  assert.equal(classifyOpencodeError('fetch failed: ECONNRESET'), 'network');
  assert.equal(classifyOpencodeError({ errorClass: 'network' }), 'network');
  assert.equal(classifyOpencodeError('ProviderModelNotFoundError: Model not found: x/y'), null);
  assert.ok(OPENCODE_RESUME_NOT_FOUND_RE.test(text('stderr-session-not-found.txt')));
});

test('capabilities: declared honestly from the spike', () => {
  assert.deepEqual(Object.keys(opencodeCapabilities).sort(), [...CAPABILITY_KEYS].sort());
  assert.deepEqual(CAPABILITY_KEYS.filter((k) => opencodeCapabilities[k] === false), ['allowedTools', 'hookTelemetry']);
  assert.ok(OPENCODE_ASK_LOCKDOWN, 'Chat runs on OpenCode, locked down (plans/ask-on-qwen-gemini-spike.md)');
  assert.deepEqual(OPENCODE_EFFORTS, ['minimal', 'low', 'medium', 'high', 'max']);
});

test('rule plan: tools removed are held; command and path rules are partial; WebFetch only with the shell and search denied', () => {
  const cwd = '/work/repo';
  const p = opencodeRulePlan({ deny: ['Bash(git push)', 'Bash(git push:*)', 'Bash(curl)', 'Read(.env*)', 'Read(//**/.worca-cc/settings.json)',
    'Edit(/src/gen/**)', 'Edit(//etc/**)', 'Read(~/.ssh/**)', 'WebFetch', 'WebSearch', 'mcp__github__delete_repo', 'mcp__slack', 'Agent'] }, { cwd, home: '/home/u' });
  assert.deepEqual(p.permission.bash, { 'git push': 'deny', 'git push *': 'deny', curl: 'deny' });
  assert.deepEqual(p.permission.read, { '.env*': 'deny', '*/.env*': 'deny', '.worca-cc/settings.json': 'deny', '*/.worca-cc/settings.json': 'deny', '../../home/u/.ssh/**': 'deny' });
  assert.deepEqual(p.permission.edit, { 'src/gen/**': 'deny', '../../etc/**': 'deny' });
  assert.equal(p.permission.webfetch, 'deny');
  assert.equal(p.permission.websearch, 'deny');
  assert.equal(p.permission.github_delete_repo, 'deny');
  assert.equal(p.permission['slack_*'], 'deny');
  assert.deepEqual(p.enforced, ['WebSearch', 'mcp__github__delete_repo', 'mcp__slack']);
  assert.deepEqual(p.partial, ['Bash(git push)', 'Bash(git push:*)', 'Bash(curl)', 'Read(.env*)', 'Read(//**/.worca-cc/settings.json)', 'Edit(/src/gen/**)', 'Edit(//etc/**)', 'Read(~/.ssh/**)']);
  assert.deepEqual(p.unenforced, ['WebFetch', 'Agent']);
  // A bare Bash takes the shell away: held, and with WebSearch denied too, WebFetch is held.
  const q = opencodeRulePlan({ deny: ['Bash', 'WebSearch', 'WebFetch', 'Edit'] }, { cwd, home: '/h' });
  assert.equal(q.permission.bash, 'deny');
  assert.equal(q.permission.edit, 'deny');
  assert.deepEqual(q.enforced, ['Bash', 'WebSearch', 'WebFetch']);
  assert.deepEqual(q.partial, ['Edit']);
  assert.deepEqual(opencodeRulePlan(null, { cwd }), { permission: {}, enforced: [], partial: [], unenforced: [] });
});

test('MCP: stdio and remote servers in OpenCode\'s shape, ${VAR} as {env:VAR} in every string', () => {
  assert.deepEqual(opencodeMcpServers({
    a: { command: 'x', args: ['--token', '${MCPSECRET_A}'], env: { K: '${V}', L: 'plain' } },
    r: { type: 'http', url: 'https://m/x?k=${MCPSECRET_Q}', headers: { Authorization: 'Bearer ${MCPSECRET_R}' } },
    s: { type: 'sse', url: 'https://m/sse' },
  }), {
    a: { type: 'local', command: ['x', '--token', '{env:MCPSECRET_A}'], environment: { K: '{env:V}', L: 'plain' }, enabled: true },
    r: { type: 'remote', url: 'https://m/x?k={env:MCPSECRET_Q}', headers: { Authorization: 'Bearer {env:MCPSECRET_R}' }, enabled: true },
    s: { type: 'remote', url: 'https://m/sse', enabled: true },
  });
});

test('providers list: credentials and environment variables counted, colours ignored', () => {
  assert.deepEqual(parseOpencodeProviders('\u001b[0m\n┌  Credentials \u001b[90m~/.local/share/opencode/auth.json\n│\n└  0 credentials\n\n┌  Environment\n│\n●  Google \u001b[90mGEMINI_API_KEY\n│\n└  1 environment variable\n'),
    { credentials: 0, env: 1 });
  assert.deepEqual(parseOpencodeProviders('└  2 credentials\n'), { credentials: 2, env: 0 });
  assert.equal(parseOpencodeProviders('garbled'), null);
});

/** Run `fn` with worca's env changed by `vars` (undefined deletes), then restore it. */
async function withEnv(vars, fn) {
  const keep = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const OPT_IN = 'WORCA_OPENCODE_ALLOW_DEFAULT_MODEL';
const NO_CREDENTIALS = '└  0 credentials\n└  0 environment variables';

test('preflight: missing binary refuses; no credentials refuses unless every spawn names a model or the user opted in; credentials pass', POSIX, async () => {
  await withEnv({ [OPT_IN]: undefined }, async () => {
    assert.match((await opencodePreflight({ bin: join(tmp(), 'nope') })).refusal, /WORCA_OPENCODE_BIN/);
    const none = fakeOpencode(tmp(), 'x', { providersText: NO_CREDENTIALS }).bin;
    assert.match((await opencodePreflight({ bin: none })).refusal, /no provider credentials.*OpenCode Zen.*WORCA_OPENCODE_ALLOW_DEFAULT_MODEL=1/);
    assert.match((await opencodePreflight({ bin: none, defaultModel: false })).warning, /no provider credentials/, 'a model chosen for every spawn');
    assert.deepEqual(await opencodePreflight({ bin: fakeOpencode(tmp(), 'x').bin }), {});
    assert.match((await opencodePreflight({ bin: fakeOpencode(tmp(), 'x', { providersText: '???' }).bin })).warning, /could not tell/);
  });
  await withEnv({ [OPT_IN]: '1' }, async () => {
    assert.match((await opencodePreflight({ bin: fakeOpencode(tmp(), 'x', { providersText: NO_CREDENTIALS }).bin })).warning, /no provider credentials/);
  });
});

test('preflight: a spawn without a model refuses (OpenCode would pick its own default, possibly OpenCode Zen) unless opted in', POSIX, async () => {
  const bin = fakeOpencode(tmp(), 'x').bin;
  await withEnv({ [OPT_IN]: undefined }, async () => {
    assert.match((await opencodePreflight({ bin, defaultModel: true })).refusal, /names no model: .*OpenCode Zen.*opencode\.ai/);
    assert.deepEqual(await opencodePreflight({ bin, defaultModel: false }), {});
  });
  await withEnv({ [OPT_IN]: '1' }, async () => assert.deepEqual(await opencodePreflight({ bin, defaultModel: true }), {}));
});

test('preflight: the credential check sees the env the agent gets — a key the allowlist withholds does not count', POSIX, async () => {
  const dir = tmp();
  const bin = join(dir, 'opencode');
  // DEEPSEEK_API_KEY: a provider key the catalog does not name (src/shared/engine-switch.mjs ENGINES.opencode), so the
  // agent gets it only through the allowlist; ANTHROPIC_API_KEY is one of its sign-in names and always passes.
  writeFileSync(bin, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.18.23; exit 0; fi\n' +
    'if [ -n "$DEEPSEEK_API_KEY$ANTHROPIC_API_KEY" ]; then echo "0 credentials"; echo "1 environment variables"; else echo "0 credentials"; echo "0 environment variables"; fi\n');
  chmodSync(bin, 0o755);
  await withEnv({ [OPT_IN]: undefined, DEEPSEEK_API_KEY: 'worca-only', ANTHROPIC_API_KEY: undefined }, async () => {
    assert.match((await opencodePreflight({ bin })).refusal, /no provider credentials in the agent's environment/);
    assert.deepEqual(await opencodePreflight({ bin, envAllowlist: ['DEEPSEEK_API_KEY'] }), {});
  });
  await withEnv({ [OPT_IN]: undefined, DEEPSEEK_API_KEY: undefined, ANTHROPIC_API_KEY: 'worca-key' }, async () => {
    assert.deepEqual(await opencodePreflight({ bin }), {}, 'a catalog sign-in name: the agent gets it too');
  });
});

test('spawn: no model refuses before anything starts, unless the user opted in', POSIX, async () => {
  const fake = fakeOpencode(tmp(), 'done');
  await withEnv({ [OPT_IN]: undefined }, async () => {
    await assert.rejects(runOpencodeProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x' }), /refusing to start OpenCode without a model: .*OpenCode Zen/);
    await assert.rejects(runOpencodeProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x', model: '  ' }), /without a model/);
    assert.equal(fake.record(), null, 'never spawned');
  });
  await withEnv({ [OPT_IN]: '1' }, async () => assert.equal((await runOpencodeProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x' })).text, 'done'));
});

test('preflight: OpenCode 2 refuses (its run attaches to a shared service and its flags, events and permissions changed); 1.x passes', POSIX, async () => {
  for (const version of ['2.0.32', 'opencode 2.1.0']) {
    assert.match((await opencodePreflight({ bin: fakeOpencode(tmp(), 'x', { version }).bin })).refusal, /OpenCode 2 is not supported yet .*opencode-ai/, version);
  }
  for (const version of ['1.19.3', '0.0.0-dev-202610130450']) assert.deepEqual(await opencodePreflight({ bin: fakeOpencode(tmp(), 'x', { version }).bin }), {}, version);
});

test('spawn: prompt on stdin; system prompt, rules and MCP ride OPENCODE_CONFIG_CONTENT; nothing is written into the checkout', POSIX, async () => {
  const cwd = tmp();
  writeFileSync(join(cwd, 'AGENTS.md'), '# rules');
  const fake = fakeOpencode(tmp(), 'done');
  const mcp = join(tmp(), 'mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { gh: { command: 'gh-mcp', args: [], env: { GITHUB_TOKEN: '${MCPSECRET_GH}' } } } }));
  const events = [];
  const r = await runOpencodeProcess({ cwd, bin: fake.bin, prompt: 'go', systemPrompt: 'Be terse.', model: 'anthropic/x', effort: 'high', mcpConfigPath: mcp,
    permissionRules: { deny: ['Bash(curl)'] }, spawnEnv: { MCPSECRET_GH: 's3cret' }, onEvent: (e) => events.push(e) });
  assert.equal(r.text, 'done');
  const rec = fake.record();
  assert.equal(rec.stdin, 'go');
  assert.deepEqual(rec.args.slice(-6), ['--agent', 'worca-node', '-m', 'anthropic/x', '--variant', 'high']);
  assert.equal(rec.env.OPENCODE_DISABLE_PROJECT_CONFIG, '1');
  assert.equal(rec.env.PWD, cwd, 'OpenCode takes its project folder from PWD, not the process cwd');
  assert.equal(rec.env.OPENCODE_DISABLE_AUTOUPDATE, '1');
  assert.equal(rec.env.MCPSECRET_GH, 's3cret');
  const cfg = fake.config();
  assert.deepEqual(cfg.permission, { bash: { curl: 'deny' } });
  assert.deepEqual(cfg.mcp.gh.environment, { GITHUB_TOKEN: '{env:MCPSECRET_GH}' }, 'no secret value in the config');
  assert.deepEqual(cfg.instructions, [join(realpathSync(cwd), 'AGENTS.md')], 'the project\'s AGENTS.md still reaches the agent');
  const prompt = /^\{file:(.+)\}$/.exec(cfg.agent['worca-node'].prompt)?.[1];
  assert.ok(prompt, cfg.agent['worca-node'].prompt);
  assert.ok(!existsSync(prompt), 'the prompt file is removed after the spawn');
  assert.equal(cfg.agent['worca-node'].mode, 'primary');
  assert.equal(cfg.agent['worca-node'].steps, undefined, 'no turn cap, no step limit');
  // No fan-out: no sub-agent at all — OpenCode's built-in ones are removed and the task tool is denied.
  assert.deepEqual(cfg.agent['worca-node'].permission, { task: 'deny' });
  assert.deepEqual(cfg.agent.general, { disable: true });
  assert.deepEqual(cfg.agent.explore, { disable: true });
  assert.equal(cfg.agent['worca-investigator'], undefined);
  assert.ok(rec.args.includes('--pure'), 'user-level and npm plugins stay off');
  assert.ok(events.some((e) => e.type === 'session' && e.sessionId === 'opencode:ses_fake0000000000000000000001' && !e.init));
  const result = events.find((e) => e.type === 'result');
  assert.equal(result.costUsd, 0.0123);
  assert.deepEqual(result.usage, { input_tokens: 100, output_tokens: 25, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 });
  assert.deepEqual(readFileSync(join(cwd, 'AGENTS.md'), 'utf8'), '# rules');
});

test('spawn: a fan-out node gets the investigator sub-agent; its spend joins the result', POSIX, async () => {
  const lines = frames('task-subagent.jsonl');
  const fake = fakeOpencode(tmp(), null, { lines, exportDoc: JSON.parse(text('export-subsession.json')) });
  const events = [];
  await runOpencodeProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go', model: 'anthropic/x', allowedTools: ['Read', 'Agent'], appendSubagentSystemPrompt: 'MEMORY',
    onEvent: (e) => events.push(e) });
  const cfg = fake.config();
  assert.equal(cfg.agent['worca-investigator'].mode, 'subagent');
  assert.match(cfg.agent['worca-investigator'].prompt, /^\{file:/);
  // The node reaches worca's investigator only; the investigator edits nothing, has no shell and no sub-agents.
  assert.deepEqual(cfg.agent['worca-node'].permission, { task: { '*': 'deny', 'worca-investigator': 'allow' } });
  assert.deepEqual(cfg.agent['worca-investigator'].permission, { edit: 'deny', bash: 'deny', task: 'deny' });
  assert.deepEqual(cfg.agent.general, { disable: true });
  assert.deepEqual(fake.exported(), ['ses_ee2c6ffe4ffe2lbboOzQjzEkHc']);
  // What the sub-agent did reaches the audit, under its task call.
  const subTools = events.filter((e) => e.type === 'tool' && e.parentId === 'call_5cc0884d58254297af7ea85e');
  assert.deepEqual(subTools.map((e) => e.calls[0].toolUseId), ['c0ab08be-bf93-469b-b8dc-0c2991ac3ac1']);
  const result = events.find((e) => e.type === 'result');
  assert.deepEqual(result.usage, { input_tokens: 5998 + 1046 + 5351, output_tokens: 176 + 406 + 84 + 135 + 267, cache_read_input_tokens: 2048 + 8000 + 5522, cache_creation_input_tokens: 0 });
});

test('spawn: an error event rejects with its class; the stderr cause is in the message', POSIX, async () => {
  const fake = fakeOpencode(tmp(), null, { lines: frames('error-auth.jsonl'), exit: 1 });
  await assert.rejects(runOpencodeProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x', model: 'anthropic/x' }), (err) => err.errorClass === 'auth' && /API key is missing/.test(err.message));
  const unknown = fakeOpencode(tmp(), null, { lines: frames('error-unknown.jsonl'), exit: 1, stderr: text('stderr-model-not-found.txt') });
  await assert.rejects(runOpencodeProcess({ cwd: tmp(), bin: unknown.bin, prompt: 'x', model: 'anthropic/x' }), /Model not found: anthropic\/claude-sonnet-4-5/);
});

test('spawn: the free tier refusing a run without a shell says why', POSIX, async () => {
  const fake = fakeOpencode(tmp(), null, { lines: frames('error-free-tier.jsonl'), exit: 1 });
  await assert.rejects(runOpencodeProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x', model: 'anthropic/x', permissionRules: { deny: ['Bash'] } }),
    (err) => /free tier/.test(err.message) && /denies the whole shell/.test(err.message));
});

test('a read-only spawn refuses; a chat needs a model that is not OpenCode Zen (the chat path: test/opencode-goose-ask-adapter.test.mjs)', async () => {
  await assert.rejects(runOpencodeProcess({ cwd: tmp(), bin: '/nonexistent', prompt: 'x', sandbox: 'read-only' }), /read-only/);
  await assert.rejects(runOpencodeProcess({ cwd: tmp(), bin: '/nonexistent', prompt: 'x', askLockdown: true }), /a chat on OpenCode needs a model/);
  await assert.rejects(runOpencodeProcess({ cwd: tmp(), bin: '/nonexistent', prompt: 'x', askLockdown: true, model: 'opencode/big-pickle' }), /OpenCode Zen's free models refuse a chat/);
});

test('a foreign stored session starts fresh and says so; an opencode: session resumes', POSIX, async () => {
  const fake = fakeOpencode(tmp(), 'ok');
  const events = [];
  await runOpencodeProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x', model: 'anthropic/x', resumeSessionId: 'codex:th-1', onEvent: (e) => events.push(e) });
  assert.ok(!fake.args().includes('-s'));
  assert.ok(events.some((e) => e.type === 'stderr' && /not an OpenCode session/.test(e.text)));
  await runOpencodeProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x', model: 'anthropic/x', resumeSessionId: 'opencode:ses_abc' });
  const a = fake.args();
  assert.equal(a[a.indexOf('-s') + 1], 'ses_abc');
});

test('a session OpenCode no longer knows starts fresh once', POSIX, async () => {
  const dir = tmp();
  const fake = fakeOpencode(dir, 'ok');
  // The first run (with -s) fails with "Session not found"; a wrapper answers so only when -s is passed.
  const wrapper = join(dir, 'opencode-wrap');
  writeFileSync(wrapper, `#!/bin/sh\ncase " $* " in *" -s "*) printf 'Error: Session not found\\n' >&2; exit 1;; esac\nexec ${JSON.stringify(fake.bin)} "$@"\n`, { mode: 0o755 });
  const events = [];
  const r = await runOpencodeProcess({ cwd: tmp(), bin: wrapper, prompt: 'x', model: 'anthropic/x', resumeSessionId: 'opencode:ses_gone', onEvent: (e) => events.push(e) });
  assert.equal(r.text, 'ok');
  assert.ok(events.some((e) => e.type === 'stderr' && /is gone/.test(e.text)));
});

test('the turn cap: the agent gets maxTurns tool steps plus the text-only one OpenCode forces at its step limit', POSIX, async () => {
  const fake = fakeOpencode(tmp(), 'done');
  await runOpencodeProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x', model: 'anthropic/x', maxTurns: 3 });
  assert.equal(fake.config().agent['worca-node'].steps, 4);
  const fan = fakeOpencode(tmp(), 'done');
  await runOpencodeProcess({ cwd: tmp(), bin: fan.bin, prompt: 'x', model: 'anthropic/x', maxTurns: 3, allowedTools: ['Agent'] });
  assert.equal(fan.config().agent['worca-investigator'].steps, 4, 'the investigator has the same cap');
});

test('the turn cap: a run that reached OpenCode\'s step limit fails as capped, not as a finished reply', POSIX, async () => {
  const sessionID = 'ses_fake0000000000000000000001';
  const step = (i, text) => [
    { type: 'step_start', sessionID, part: { id: `prt_s${i}`, messageID: `msg_${i}`, sessionID, type: 'step-start' } },
    ...(text ? [{ type: 'text', sessionID, part: { id: `prt_t${i}`, messageID: `msg_${i}`, sessionID, type: 'text', text } }] : []),
    { type: 'step_finish', sessionID, part: { id: `prt_f${i}`, reason: 'stop', messageID: `msg_${i}`, sessionID, type: 'step-finish', tokens: {}, cost: 0 } },
  ];
  const capped = fakeOpencode(tmp(), null, { lines: [...step(1), ...step(2), ...step(3, 'summary so far')] });
  await assert.rejects(runOpencodeProcess({ cwd: tmp(), bin: capped.bin, prompt: 'x', model: 'anthropic/x', maxTurns: 2 }), (err) => err.turnCap === true);
  const under = fakeOpencode(tmp(), null, { lines: [...step(1), ...step(2, 'done')] });
  assert.equal((await runOpencodeProcess({ cwd: tmp(), bin: under.bin, prompt: 'x', model: 'anthropic/x', maxTurns: 2 })).text, 'done');
});

test('the turn cap stops the run after maxTurns tool calls', POSIX, async () => {
  const fake = fakeOpencode(tmp(), null, { lines: frames('shell-and-write.jsonl') });
  await assert.rejects(runOpencodeProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x', model: 'anthropic/x', maxTurns: 1 }), (err) => err.turnCap === true);
});

test('a reply with a cost and no usage still books the cost', () => {
  const n = createOpencodeNormalizer();
  for (const l of opencodeReplyLines('hi', 'ses_x', { cost: 0.5, tokens: {} })) n.push(l);
  assert.equal(n.finish().costUsd, 0.5);
});
