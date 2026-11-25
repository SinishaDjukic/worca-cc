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
  parseOpencodeProviders, parseOpencodeAuth, readSubsession, OPENCODE_EFFORTS, OPENCODE_RESUME_NOT_FOUND_RE,
  opencodeAskSupport, opencodeVersion, resetOpencodeVersions,
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

test('argv on OpenCode 2: a private server, no --pure and no --print-logs, the variant rides the model', () => {
  assert.deepEqual(buildOpencodeArgs({ major: 2 }), ['run', '--format', 'json', '--auto', '--standalone']);
  assert.deepEqual(buildOpencodeArgs({ agent: 'worca-node', model: 'anthropic/claude-sonnet-4-5', effort: 'high', sessionId: 'ses_1', major: 2 }),
    ['run', '--format', 'json', '--auto', '--standalone', '--agent', 'worca-node', '-m', 'anthropic/claude-sonnet-4-5#high', '-s', 'ses_1']);
  assert.deepEqual(buildOpencodeArgs({ model: 'deepseek/deepseek-v4.1', major: 2 }), ['run', '--format', 'json', '--auto', '--standalone', '-m', 'deepseek/deepseek-v4.1']);
});

test('argv on OpenCode 2: an effort replaces a variant the model id already names; without one the id keeps its own', () => {
  const m = (o) => { const a = buildOpencodeArgs({ major: 2, ...o }); return a[a.indexOf('-m') + 1]; };
  assert.equal(m({ model: 'anthropic/x#low', effort: 'high' }), 'anthropic/x#high', 'never anthropic/x#low#high');
  assert.equal(m({ model: 'anthropic/x#low' }), 'anthropic/x#low');
});

test('spawn on OpenCode 2 without a model: an effort has nothing to ride on, and the run says so', POSIX, async () => {
  const fake = fakeOpencode(tmp(), 'ok', { version: '2.3.2', authText: '[]' });
  const before = process.env.WORCA_OPENCODE_ALLOW_DEFAULT_MODEL;
  process.env.WORCA_OPENCODE_ALLOW_DEFAULT_MODEL = '1';
  const events = [];
  try {
    await runOpencodeProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x', effort: 'high', onEvent: (e) => events.push(e) });
  } finally {
    if (before === undefined) delete process.env.WORCA_OPENCODE_ALLOW_DEFAULT_MODEL; else process.env.WORCA_OPENCODE_ALLOW_DEFAULT_MODEL = before;
  }
  assert.ok(!fake.args().includes('-m'));
  assert.ok(events.some((e) => e.type === 'stderr' && /effort high/.test(e.text) && /model/.test(e.text)), 'the dropped effort is named');
});

test('version: read again once it is stale, and by every run-start check — an upgrade does not wait for a restart', POSIX, async () => {
  const dir = tmp();
  resetOpencodeVersions();
  const { bin } = fakeOpencode(dir, 'ok', { version: '1.19.4' });
  assert.equal((await opencodeVersion(bin)).major, 1);
  fakeOpencode(dir, 'ok', { version: '2.3.2', authText: '[]' });   // the same path, upgraded in place
  assert.equal((await opencodeVersion(bin)).major, 1, 'a fresh reading is kept');
  assert.equal((await opencodeVersion(bin, { maxAgeMs: 0 })).major, 2, 'a stale one is read again');
  // The run-start check asks the binary its version anyway: what it hears is what the next spawn branches on.
  fakeOpencode(dir, 'ok', { version: '1.19.4' });
  await opencodePreflight({ bin, defaultModel: false });
  assert.equal((await opencodeVersion(bin)).major, 1);
  fakeOpencode(dir, 'ok', { version: '2.3.2', authText: '[]' });
  assert.deepEqual(await opencodeAskSupport({ bin }), {});
  assert.equal((await opencodeVersion(bin)).major, 2, 'so does the chat gate');
  resetOpencodeVersions();
});

test('argv: OpenCode Zen free models (`opencode/*`) take no variant — an effort never reaches the spawn, on 1.x and 2.x', () => {
  // OpenCode 2.3.1+ refuses a variant these models do not offer (`Variant unavailable for opencode/big-pickle: low`);
  // 1.x ignored it. Both must drop the effort entirely so the model runs at its default.
  assert.deepEqual(buildOpencodeArgs({ model: 'opencode/big-pickle', effort: 'low', major: 2 }),
    ['run', '--format', 'json', '--auto', '--standalone', '-m', 'opencode/big-pickle']);
  assert.deepEqual(buildOpencodeArgs({ agent: 'worca-node', model: 'opencode/big-pickle', effort: 'high', sessionId: 'ses_1', major: 2 }),
    ['run', '--format', 'json', '--auto', '--standalone', '--agent', 'worca-node', '-m', 'opencode/big-pickle', '-s', 'ses_1']);
  assert.deepEqual(buildOpencodeArgs({ model: 'opencode/big-pickle', effort: 'low' }),
    ['run', '--format', 'json', '--auto', '--pure', '--print-logs', '--log-level', 'ERROR', '-m', 'opencode/big-pickle']);
  // A model of another provider keeps its variant.
  assert.deepEqual(buildOpencodeArgs({ model: 'openrouter/x/free', effort: 'low', major: 2 }),
    ['run', '--format', 'json', '--auto', '--standalone', '-m', 'openrouter/x/free#low']);
});

test('chat lockdown gate: 1.19.4+ (1.x) and 2.3.2+ (2.x) pass; older and unknown refuse', async () => {
  assert.deepEqual(await opencodeAskSupport({ bin: fakeOpencode(tmp(), 'x', { version: '1.19.4' }).bin }), {});
  assert.match((await opencodeAskSupport({ bin: fakeOpencode(tmp(), 'x', { version: '1.19.3' }).bin })).refusal, /1\.19\.4/);
  assert.deepEqual(await opencodeAskSupport({ bin: fakeOpencode(tmp(), 'x', { version: '2.3.2' }).bin }), {});
  assert.match((await opencodeAskSupport({ bin: fakeOpencode(tmp(), 'x', { version: '2.0.0' }).bin })).refusal, /2\.3\.2/);
  assert.match((await opencodeAskSupport({ bin: fakeOpencode(tmp(), 'x', { version: '0.9.0' }).bin })).refusal, /1\.19\.4/);
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

test('normalizer (captured, OpenCode 2): a shell call keyed by part.id, text, per-step usage, cost', () => {
  const { events, final } = replay('v2-bash-and-text.jsonl', { model: 'probe/m' });
  for (const e of events) assert.ok(EVENT_TYPES.has(e.type) && isNormalized(e), JSON.stringify(e));
  const calls = events.filter((e) => e.type === 'tool').flatMap((e) => e.calls);
  assert.deepEqual(calls.map((c) => [c.name, c.input, c.toolUseId]), [['Bash', { command: 'echo hello-from-opencode-2' }, 'call_wst-1795175965248']]);
  const results = events.filter((e) => e.type === 'toolResult').flatMap((e) => e.results);
  assert.deepEqual(results.map((r) => [r.isError, r.toolUseId]), [[false, 'call_wst-1795175965248']]);
  assert.equal(events.filter((e) => e.type === 'text').map((e) => e.text).join(''), 'DONE');
  assert.equal(events.filter((e) => e.type === 'usage').length, 2);
  assert.equal(final.sessionId, 'ses_e072c9ea4ffehflU3w08DSuwbV');
  assert.equal(final.error, null);
  assert.equal(final.costUsd, 0);
  assert.deepEqual(final.usage, { input_tokens: 8, output_tokens: 6, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
});

test('normalizer (captured, OpenCode 2): a subagent call spawns a sub-agent row and keeps its session; the background row never finishes in-stream', () => {
  const { events, final } = replay('v2-subagent.jsonl', { backgroundSubagents: true });
  const subs = events.filter((e) => e.type === 'subagent');
  assert.deepEqual(subs.map((e) => e.event), ['spawn'], '2.x returns at once; the export closes the row (see the spawn test)');
  assert.equal(subs[0].toolUseId, 'call_wst-1795175966173');
  assert.equal(subs[0].subagentType, 'general');
  assert.equal(subs[0].label, 'count files');
  assert.deepEqual(final.subSessions, [{ sessionId: 'ses_e072c9a15ffeCnhV8RH7HeNFWm', toolUseId: 'call_wst-1795175966173' }]);
  assert.equal(final.error, null);
});

test('normalizer (captured, OpenCode 2): an error event carries error.type, and the classes map from it', () => {
  const { events, final } = replay('v2-error-no-route.jsonl');
  assert.match(events.at(-1).text, /Model unavailable/);
  assert.deepEqual([final.error, final.errorType, final.errorName], ['Model unavailable: nosuch/model', 'provider.no-route', null]);
  assert.equal(classifyOpencodeError({ type: final.errorType, message: final.error }), null, 'a model that does not exist is not a sign-in, limit or network problem');
  assert.equal(classifyOpencodeError({ type: 'provider.auth', message: 'x' }), 'auth');
  assert.equal(classifyOpencodeError({ type: 'provider.rate-limit', message: 'x' }), 'rate_limit');
  assert.equal(classifyOpencodeError({ type: 'provider.quota', message: 'x' }), 'quota');
  assert.equal(classifyOpencodeError({ type: 'provider.budget-limit', message: 'x' }), 'quota');
  assert.equal(classifyOpencodeError({ type: 'provider.model-budget-limit', message: 'x' }), 'quota');
  assert.equal(classifyOpencodeError({ type: 'provider.free-limit', message: 'x' }), 'usage_limit');
  assert.equal(classifyOpencodeError({ type: 'provider.transport', message: 'x' }), 'network');
  assert.equal(classifyOpencodeError({ type: 'provider.timeout', message: 'x' }), 'network');
});

test('sub-session export (OpenCode 2): info totals and content tool parts; settled from outcome/idle', () => {
  const sub = readSubsession(text('v2-session-export.json'), { parentId: 'call_sub' });
  assert.equal(sub.costUsd, 0);
  assert.deepEqual(sub.usage, { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  assert.equal(sub.settled, true, 'outcome succeeded and time.idle present');
  assert.deepEqual(sub.events, [], 'this child only answered text');
  const running = readSubsession(JSON.stringify({ info: { cost: 0, time: { created: 1, busy: 2 } }, messages: [] }), {});
  assert.equal(running.settled, false, 'a busy session is not settled');
  assert.equal(readSubsession('not json'), null);
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
  // A path outside the cwd in both forms: OpenCode 1 matches `../…`, OpenCode 2 only the absolute path.
  assert.deepEqual(p.permission.read, { '.env*': 'deny', '*/.env*': 'deny', '.worca-cc/settings.json': 'deny', '*/.worca-cc/settings.json': 'deny', '../../home/u/.ssh/**': 'deny', '/home/u/.ssh/**': 'deny' });
  assert.deepEqual(p.permission.edit, { 'src/gen/**': 'deny', '../../etc/**': 'deny', '/etc/**': 'deny' });
  // Inside the cwd: the relative form only (both majors match it).
  assert.deepEqual(opencodeRulePlan({ deny: ['Read(~/repo/secret.txt)', 'Edit(//work/repo/gen/**)'] }, { cwd, home: '/work' }).permission,
    { read: { 'secret.txt': 'deny' }, edit: { 'gen/**': 'deny' } });
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

test('2.x auth list: the JSON document\'s connections are credentials and env vars; [] and garbled are answers', () => {
  assert.deepEqual(parseOpencodeAuth('[{"id":"anthropic","name":"Anthropic","connections":[{"type":"env","name":"ANTHROPIC_API_KEY"}]},'
    + '{"id":"openai","name":"OpenAI","connections":[{"type":"oauth","name":"saved"},{"type":"key","name":"sk-…"}]}]'),
    { credentials: 2, env: 1 });
  assert.deepEqual(parseOpencodeAuth('[]'), { credentials: 0, env: 0 });
  assert.equal(parseOpencodeAuth('not json'), null);
  assert.equal(parseOpencodeAuth('{"nope":1}'), null);
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

test('preflight: the credential check sees the env the agent gets — a key scrub keeps from it does not count', POSIX, async () => {
  const dir = tmp();
  const bin = join(dir, 'opencode');
  writeFileSync(bin, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.18.23; exit 0; fi\n' +
    'if [ -n "$ANTHROPIC_API_KEY" ]; then echo "0 credentials"; echo "1 environment variables"; else echo "0 credentials"; echo "0 environment variables"; fi\n');
  chmodSync(bin, 0o755);
  await withEnv({ [OPT_IN]: undefined, ANTHROPIC_API_KEY: 'worca-only' }, async () => {
    assert.deepEqual(await opencodePreflight({ bin }), {}, 'no scrub: the agent gets the key too');
    assert.match((await opencodePreflight({ bin, envScrub: true })).refusal, /no provider credentials in the agent's environment/);
    assert.deepEqual(await opencodePreflight({ bin, envScrub: true, envAllowlist: ['ANTHROPIC_API_KEY'] }), {});
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

test('preflight: 1.x reads providers list, 2.x reads auth list; both pass with credentials and warn/refuse without', POSIX, async () => {
  // 1.x: the providers list decides.
  for (const version of ['1.19.3', '0.0.0-dev-202610130450']) assert.deepEqual(await opencodePreflight({ bin: fakeOpencode(tmp(), 'x', { version }).bin }), {}, version);
  // 2.x: auth list --standalone --format json decides; an unparseable document warns.
  assert.deepEqual(await opencodePreflight({ bin: fakeOpencode(tmp(), 'x', { version: '2.3.2', authText: '[{"id":"a","connections":[{"type":"env","name":"ANTHROPIC_API_KEY"}]}]' }).bin }), {});
  const noCreds = await opencodePreflight({ bin: fakeOpencode(tmp(), 'x', { version: '2.3.2', authText: '[]' }).bin });
  assert.match(noCreds.refusal, /no provider credentials.*OpenCode Zen/, 'no opt-in: refusal');
  assert.match((await opencodePreflight({ bin: fakeOpencode(tmp(), 'x', { version: '2.3.2', authText: '[]' }).bin, defaultModel: false })).warning, /no provider credentials/);
  assert.match((await opencodePreflight({ bin: fakeOpencode(tmp(), 'x', { version: '2.3.2', authText: 'garbled' }).bin })).warning, /could not tell/);
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
  assert.deepEqual(cfg.agent['worca-node'].permission, { task: 'deny', execute: 'deny' }, 'no Code Mode: its session_move would leave the cwd-relative rules behind');
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

test('spawn: the investigator\'s read allow repeats the run\'s read rules after it, and a bare Read keeps reading off', POSIX, async () => {
  for (const [deny, want] of [
    [['Read(.env*)', 'Edit(src/**)'], { '*': 'allow', '.env*': 'deny', '*/.env*': 'deny' }],
    [['Read'], 'deny'],
  ]) {
    const fake = fakeOpencode(tmp(), null, { lines: frames('task-subagent.jsonl'), exportDoc: JSON.parse(text('export-subsession.json')) });
    await runOpencodeProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go', model: 'anthropic/x', allowedTools: ['Read', 'Agent'], permissionRules: { deny } });
    const p = fake.config().agent['worca-investigator'].permission;
    assert.deepEqual(p.read, want, `${deny}: the run's read rules still hold for the investigator`);
    assert.deepEqual(Object.keys(p.read === 'deny' ? {} : p.read)[0], p.read === 'deny' ? undefined : '*', 'the allow comes first, so the denies after it win');
    assert.equal(p['*'], 'deny');
  }
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
  // The node reaches worca's investigator only; the investigator only reads and searches: every other tool is denied.
  assert.deepEqual(cfg.agent['worca-node'].permission, { task: { '*': 'deny', 'worca-investigator': 'allow' }, execute: 'deny' });
  assert.deepEqual(cfg.agent['worca-investigator'].permission, { '*': 'deny', read: { '*': 'allow' }, glob: 'allow', grep: 'allow', list: 'allow', external_directory: 'allow' });
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

test('spawn on OpenCode 2: a private server, the variant on the model, no --pure; a sub-agent\'s export reads its spend and closes the row', POSIX, async () => {
  const sid = 'ses_v2main0000000000000000001';
  const line = (o) => JSON.parse(JSON.stringify({ timestamp: 1, sessionID: sid, part: { sessionID: sid }, ...o }));
  const lines = [
    line({ type: 'step_start', part: { id: 'prt_1', sessionID: sid, messageID: 'msg_1', type: 'step-start' } }),
    line({ type: 'tool_use', part: { id: 'call_main1', partID: 'prt_2', sessionID: sid, messageID: 'msg_2', type: 'tool', tool: 'bash',
      state: { status: 'completed', input: { command: 'echo one' }, output: 'one\n', metadata: { metadata: { status: 'completed', truncated: false, exit: 0 }, content: [{ type: 'text', text: 'one\n' }] } } } }),
    line({ type: 'step_finish', part: { id: 'prt_3', sessionID: sid, messageID: 'msg_3', type: 'step-finish', reason: 'tool-calls', cost: 0, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } } }),
    line({ type: 'step_start', part: { id: 'prt_4', sessionID: sid, messageID: 'msg_4', type: 'step-start' } }),
    line({ type: 'tool_use', part: { id: 'call_sub', partID: 'prt_5', sessionID: sid, messageID: 'msg_5', type: 'tool', tool: 'subagent',
      state: { status: 'completed', input: { agent: 'worca-investigator', description: 'look around', prompt: 'look' }, output: 'working in the background…',
        metadata: { metadata: { sessionID: 'ses_v2child0000000000000000001', status: 'running', truncated: false }, content: [] } } } }),
    line({ type: 'step_finish', part: { id: 'prt_6', sessionID: sid, messageID: 'msg_6', type: 'step-finish', reason: 'tool-calls', cost: 0, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } } }),
    line({ type: 'step_start', part: { id: 'prt_7', sessionID: sid, messageID: 'msg_7', type: 'step-start' } }),
    line({ type: 'text', part: { id: 'prt_8', sessionID: sid, messageID: 'msg_8', type: 'text', text: 'DONE' } }),
    line({ type: 'step_finish', part: { id: 'prt_9', sessionID: sid, messageID: 'msg_9', type: 'step-finish', reason: 'stop', cost: 0, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } } }),
  ];
  const subExport = {
    info: { id: 'ses_v2child0000000000000000001', parentID: sid, agent: 'worca-investigator', cost: 0.5,
      tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 0, write: 0 } }, outcome: 'succeeded', time: { created: 1, busy: 1, idle: 2 } },
    messages: [
      { id: 'msg_sub1', type: 'user', text: 'look' },
      { id: 'msg_sub2', type: 'assistant', agent: 'worca-investigator', cost: 0.5,
        tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        content: [{ type: 'tool', id: 'call_subtool', name: 'bash', state: { status: 'completed', input: { command: 'echo sub' }, content: [{ type: 'text', text: 'sub-out\n' }] } }] },
    ],
  };
  const fake = fakeOpencode(tmp(), null, { version: '2.3.2', authText: '[]', lines, exportDoc: subExport, exportCommand: 'session-export' });
  const events = [];
  const r = await runOpencodeProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x', model: 'anthropic/x', effort: 'high',
    allowedTools: ['Agent'], onEvent: (e) => events.push(e) });
  const args = fake.args();
  assert.ok(args.includes('--standalone'), args.join(' '));
  assert.ok(!args.includes('--pure'));
  assert.ok(!args.includes('--variant'));
  assert.equal(args[args.indexOf('-m') + 1], 'anthropic/x#high');
  assert.deepEqual(fake.exported(), ['ses_v2child0000000000000000001'], '2.x exports through `session export`');
  const mains = events.filter((e) => e.type === 'tool' && e.parentId === null).flatMap((e) => e.calls);
  assert.deepEqual(mains.map((c) => [c.name, c.input.command, c.toolUseId]), [['Bash', 'echo one', 'call_main1']], 'the call id comes from part.id');
  // 2.x returns from `subagent` at once: the stream spawns the row, the export closes it under the same call.
  const subs = events.filter((e) => e.type === 'subagent');
  assert.deepEqual(subs.map((e) => [e.event, e.toolUseId, e.subagentType]), [['spawn', 'call_sub', 'worca-investigator'], ['finish', 'call_sub', undefined]]);
  const under = events.filter((e) => e.parentId === 'call_sub');
  assert.deepEqual(under.filter((e) => e.type === 'tool').flatMap((e) => e.calls).map((c) => [c.name, c.toolUseId]), [['Bash', 'call_subtool']]);
  const result = events.find((e) => e.type === 'result');
  assert.equal(result.costUsd, 0.5, 'the sub-agent\'s export cost joins the result');
  assert.deepEqual(result.usage, { input_tokens: 3 + 10, output_tokens: 3 + 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  assert.equal(r.text, 'DONE');
});

/** A 2.x run whose only tool call is one background `subagent` (`child`: its session, or null when the call names none). */
const v2SubagentRun = (child, { status = 'completed', error = undefined } = {}) => {
  const sid = 'ses_v2main0000000000000000002';
  const line = (o) => ({ timestamp: 1, sessionID: sid, ...o });
  return [
    line({ type: 'step_start', part: { id: 'prt_1', sessionID: sid, type: 'step-start' } }),
    line({ type: 'tool_use', part: { id: 'call_sub', sessionID: sid, type: 'tool', tool: 'subagent',
      state: { status, ...(error ? { error } : {}), input: { agent: 'worca-investigator', description: 'look around', prompt: 'look' },
        metadata: { metadata: { ...(child ? { sessionID: child } : {}), status: 'running' }, content: [] } } } }),
    line({ type: 'step_finish', part: { id: 'prt_2', sessionID: sid, type: 'step-finish', reason: 'tool-calls', cost: 0, tokens: { input: 1, output: 1 } } }),
    line({ type: 'text', part: { id: 'prt_3', sessionID: sid, type: 'text', text: 'DONE' } }),
    line({ type: 'step_finish', part: { id: 'prt_4', sessionID: sid, type: 'step-finish', reason: 'stop', cost: 0, tokens: { input: 1, output: 1 } } }),
  ];
};
const v2Run = async (lines, exportDoc) => {
  const fake = fakeOpencode(tmp(), null, { version: '2.3.2', authText: '[]', lines, exportDoc, exportCommand: 'session-export' });
  const events = [];
  await runOpencodeProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x', model: 'anthropic/x', allowedTools: ['Agent'], onEvent: (e) => events.push(e) });
  return events;
};
const subRows = (events) => events.filter((e) => e.type === 'subagent').map((e) => [e.event, e.toolUseId]);

test('sub-session export (OpenCode 2): a failed, cancelled or errored outcome is settled and failed', () => {
  for (const outcome of ['failed', 'cancelled', 'error']) {
    const sub = readSubsession(JSON.stringify({ info: { cost: 0, outcome, time: { idle: 2 } }, messages: [] }), {});
    assert.deepEqual([sub.settled, sub.failed, sub.outcome], [true, true, outcome]);
  }
  assert.equal(readSubsession(JSON.stringify({ info: { cost: 0, outcome: 'succeeded', time: { idle: 2 } }, messages: [] }), {}).failed, false);
  assert.equal(readSubsession(text('export-subsession.json'), {}).failed, false, '1.x reports its outcome in the stream');
});

test('normalizer (OpenCode 2): a background sub-agent row the stream left open is named in finish(), with the call\'s own status', () => {
  const n = createOpencodeNormalizer({ backgroundSubagents: true });
  for (const f of v2SubagentRun(null, { status: 'error', error: 'no such agent' })) n.push(f);
  assert.deepEqual(n.finish().openSubagents, [{ toolUseId: 'call_sub', isError: true, errorText: 'no such agent' }]);
  // 1.x closes the row in-stream: none is left open.
  const one = createOpencodeNormalizer();
  for (const f of v2SubagentRun('ses_child')) one.push(f);
  assert.deepEqual(one.finish().openSubagents, []);
});

test('spawn on OpenCode 2: a sub-agent whose session failed closes its row as an error, not a finish', POSIX, async () => {
  const events = await v2Run(v2SubagentRun('ses_v2child0000000000000000002'),
    { info: { cost: 0.25, outcome: 'failed', time: { created: 1, idle: 2 } }, messages: [] });
  assert.deepEqual(subRows(events), [['spawn', 'call_sub'], ['error', 'call_sub']]);
  assert.match(events.filter((e) => e.type === 'subagent')[1].errorText, /failed/);
  assert.equal(events.find((e) => e.type === 'result').costUsd, 0.25, 'a failed sub-agent\'s spend still counts');
});

test('spawn on OpenCode 2: a sub-agent row still closes when its export cannot be read, or the call named no session', POSIX, async () => {
  const started = Date.now();
  const unread = await v2Run(v2SubagentRun('ses_v2child0000000000000000003'), null);
  assert.deepEqual(subRows(unread), [['spawn', 'call_sub'], ['finish', 'call_sub']], 'closed on the call\'s own status');
  assert.ok(unread.some((e) => e.type === 'stderr' && /could not read sub-agent session/.test(e.text)));
  assert.ok(Date.now() - started < 4000, 'an export that is not a session document is not retried');
  const noSession = await v2Run(v2SubagentRun(null, { status: 'error', error: 'no such agent' }), null);
  assert.deepEqual(subRows(noSession), [['spawn', 'call_sub'], ['error', 'call_sub']]);
  assert.equal(noSession.filter((e) => e.type === 'subagent')[1].errorText, 'no such agent');
});

test('spawn on OpenCode 2: a run that fails closes the sub-agent rows it left open, as errors', POSIX, async () => {
  const lines = [...v2SubagentRun('ses_v2child0000000000000000004').slice(0, 3),
    { type: 'error', sessionID: 'ses_v2main0000000000000000002', error: { type: 'provider.rate-limit', message: 'slow down' } }];
  const fake = fakeOpencode(tmp(), null, { version: '2.3.2', authText: '[]', lines, exportCommand: 'session-export' });
  const events = [];
  await assert.rejects(() => runOpencodeProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x', model: 'anthropic/x', allowedTools: ['Agent'], onEvent: (e) => events.push(e) }), /slow down/);
  assert.deepEqual(subRows(events), [['spawn', 'call_sub'], ['error', 'call_sub']]);
  assert.deepEqual(fake.exported(), [], 'a failed run reads no export');
});

test('normalizer: text from separate messages is kept apart by a blank line; parts of one message join as they are', () => {
  const n = createOpencodeNormalizer();
  const t = (messageID, text) => n.push({ type: 'text', sessionID: 'ses_x', part: { type: 'text', messageID, text } });
  t('msg_1', 'Looking'); t('msg_1', ' around.'); t('msg_2', 'DONE'); t('msg_3', 'DONE');
  assert.equal(n.finish().text, 'Looking around.\n\nDONE\n\nDONE', 'OpenCode 2 answers again when a background child goes idle: never "DONEDONE"');
  const bare = createOpencodeNormalizer();
  bare.push({ type: 'text', sessionID: 'ses_x', part: { type: 'text', text: 'a' } });
  bare.push({ type: 'text', sessionID: 'ses_x', part: { type: 'text', text: 'b' } });
  assert.equal(bare.finish().text, 'ab', 'parts with no message id join as before');
});

test('sub-session export (OpenCode 2, as 2.3.2 writes it): a failed child names its own error', () => {
  const doc = { info: { cost: 0, outcome: 'failed', time: { created: 1, busy: 2, idle: 3 } }, messages: [
    { type: 'user', text: 'say hi' },
    { type: 'assistant', content: [], finish: 'error', error: { type: 'provider.invalid-request', message: 'stub refuses the sub-agent' } },
    { type: 'idle', outcome: 'failed', error: { type: 'provider.invalid-request', message: 'stub refuses the sub-agent', status: 400 } },
  ] };
  const sub = readSubsession(JSON.stringify(doc), {});
  assert.deepEqual([sub.settled, sub.failed, sub.outcome, sub.errorText], [true, true, 'failed', 'stub refuses the sub-agent']);
  assert.equal(readSubsession(JSON.stringify({ info: { outcome: 'cancelled', time: { idle: 3 } }, messages: [] }), {}).errorText, '', 'none given: empty');
});

test('spawn on OpenCode 2: a failed sub-agent\'s row carries the reason its export names', POSIX, async () => {
  const events = await v2Run(v2SubagentRun('ses_v2child0000000000000000005'), { info: { cost: 0, outcome: 'failed', time: { idle: 2 } },
    messages: [{ type: 'idle', outcome: 'failed', error: { type: 'provider.auth', message: 'invalid api key' } }] });
  const closed = events.filter((e) => e.type === 'subagent')[1];
  assert.equal(closed.event, 'error');
  assert.match(closed.errorText, /failed/);
  assert.match(closed.errorText, /invalid api key/);
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

test('a variant a model does not offer is retried without it once (OpenCode 2.3.1+ refuses a phantom #variant)', POSIX, async () => {
  // ernie (a free openrouter model) advertises the full effort vocabulary but only `high` works; `medium`/`low` come
  // back as provider.no-route "Variant unavailable …". The catalog cannot know a model's real variants ahead of time,
  // so the spawn retries ONCE without the variant — the model runs at its own default. `variant` is falsy after the
  // retry, so a second refusal (a genuinely bad model) is a real error, never a loop.
  const dir = tmp();
  const fake = fakeOpencode(dir, 'ok', { version: '2.3.2' });
  const spawns = join(dir, 'spawns.txt');
  // Record every argv (including the --version probe), then fail the call that carries `#medium` — the retry must drop it.
  const wrapper = join(dir, 'opencode-wrap');
  writeFileSync(wrapper, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(spawns)}\n` +
    `case " $* " in *"#medium"*) printf 'Error: Variant unavailable for openrouter/baidu/ernie-5.5-flash-preview:free: medium\\n' >&2; exit 1;; esac\n` +
    `exec ${JSON.stringify(fake.bin)} "$@"\n`, { mode: 0o755 });
  const events = [];
  const r = await runOpencodeProcess({ cwd: tmp(), bin: wrapper, prompt: 'x', model: 'openrouter/baidu/ernie-5.5-flash-preview:free', effort: 'medium', onEvent: (e) => events.push(e) });
  assert.equal(r.text, 'ok');
  const runs = readFileSync(spawns, 'utf8').split('\n').filter((l) => l.includes('-m'));
  assert.equal(runs.length, 2, 'the variant attempt and the variant-less retry both spawn');
  assert.ok(runs[0].includes('#medium'), 'the first spawn carries the effort');
  assert.ok(!runs[1].includes('#medium'), 'the retry drops the variant');
  assert.ok(events.some((e) => e.type === 'stderr' && /takes no "medium" variant/.test(e.text)), 'the drop is said out loud');
});

test('argv: a Zen model id that names its own #variant spawns without it on 2.x', () => {
  assert.deepEqual(buildOpencodeArgs({ model: 'opencode/big-pickle#low', effort: 'high', major: 2 }),
    ['run', '--format', 'json', '--auto', '--standalone', '-m', 'opencode/big-pickle']);
  assert.deepEqual(buildOpencodeArgs({ model: 'opencode/big-pickle#low', major: 2 }),
    ['run', '--format', 'json', '--auto', '--standalone', '-m', 'opencode/big-pickle']);
});

/** A 2.3.2 fake behind a wrapper that logs every model spawn and refuses the ones `refuses` matches. */
function refusingOpencode(refuses) {
  const dir = tmp();
  const fake = fakeOpencode(dir, 'ok', { version: '2.3.2' });
  const spawns = join(dir, 'spawns.txt');
  const wrapper = join(dir, 'opencode-wrap');
  writeFileSync(wrapper, `#!/bin/sh\ncase " $* " in *" -m "*) printf '%s\\n' "$*" >> ${JSON.stringify(spawns)};; esac\n` +
    `case " $* " in ${refuses}) printf 'Error: Variant unavailable for the model\\n' >&2; exit 1;; esac\n` +
    `exec ${JSON.stringify(fake.bin)} "$@"\n`, { mode: 0o755 });
  return { bin: wrapper, runs: () => (existsSync(spawns) ? readFileSync(spawns, 'utf8').split('\n').filter(Boolean) : []) };
}

test('a refused #variant the model id names itself is retried without it', POSIX, async () => {
  const oc = refusingOpencode('*"#low"*');
  const r = await runOpencodeProcess({ cwd: tmp(), bin: oc.bin, prompt: 'x', model: 'openrouter/vendor/m#low' });
  assert.equal(r.text, 'ok');
  const runs = oc.runs();
  assert.equal(runs.length, 2);
  assert.ok(runs[0].includes('openrouter/vendor/m#low'));
  assert.ok(runs[1].includes('-m openrouter/vendor/m ') || runs[1].endsWith('-m openrouter/vendor/m'), 'the retry names the bare model');
});

test('a second "Variant unavailable" is an error: one retry, never a loop', POSIX, async () => {
  const oc = refusingOpencode('*" -m "*');
  await assert.rejects(runOpencodeProcess({ cwd: tmp(), bin: oc.bin, prompt: 'x', model: 'openrouter/vendor/m', effort: 'medium' }), /Variant unavailable/);
  assert.equal(oc.runs().length, 2);
});

test('a refused variant is remembered: the next spawn on that model goes without it, so a resumed chat never resends its prompt', POSIX, async () => {
  // OpenCode keeps the refused turn's prompt in the session; a retry on that session sends it again. Remembering the
  // refusal keeps every later turn from being refused (and doubled) in the first place.
  const oc = refusingOpencode('*"#low"*');
  const events = [];
  await runOpencodeProcess({ cwd: tmp(), bin: oc.bin, prompt: 'x', model: 'openrouter/vendor/remembered', effort: 'low' });
  await runOpencodeProcess({ cwd: tmp(), bin: oc.bin, prompt: 'y', model: 'openrouter/vendor/remembered', effort: 'low', resumeSessionId: 'opencode:ses_abc', onEvent: (e) => events.push(e) });
  const runs = oc.runs();
  assert.equal(runs.length, 3, 'refused + retry, then one spawn without the variant');
  assert.ok(!runs[2].includes('#low'));
  assert.ok(events.some((e) => e.type === 'stderr' && /takes no "low" variant/.test(e.text)), 'the drop is still said');
  await runOpencodeProcess({ cwd: tmp(), bin: oc.bin, prompt: 'z', model: 'openrouter/vendor/remembered', effort: 'high' });
  assert.ok(oc.runs()[3].includes('#high'), 'another variant of that model is still sent');
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
