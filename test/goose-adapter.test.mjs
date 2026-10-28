// test/goose-adapter.test.mjs — the Goose CLI adapter: argv, the stream-json normalizer against real goose 1.54
// captures (test/fixtures/goose), MCP wrappers, error classes, preflight and the spawn path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildGooseArgs, createGooseNormalizer, classifyGooseError, gooseSessionOf, GOOSE_SESSION_PREFIX, splitGooseModel,
  gooseCapabilities, goosePreflight, runGooseProcess, GOOSE_ASK_LOCKDOWN, gooseMcpProblems, gooseMcpWrappers, gooseMcpDirect, shWord,
  GOOSE_RESUME_NOT_FOUND_RE,
} from '../src/core/engines/goose.mjs';
import { EVENT_TYPES, isNormalized } from '../src/core/engines/events.mjs';
import { CAPABILITY_KEYS } from '../src/core/engines/capabilities.mjs';
import { fakeGoose } from './helpers/fake-goose.mjs';

const FIX = new URL('./fixtures/goose/', import.meta.url);
const frames = (name) => readFileSync(new URL(name, FIX), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-goose-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const replay = (name, opts = {}) => {
  const n = createGooseNormalizer({ sessionName: 'worca-test-1', ...opts });
  const events = [...frames(name).flatMap((f) => n.push(f)), ...n.end()];
  return { events, final: n.finish() };
};

test('argv: headless stream-json, no user extensions, developer tools, the prompt on stdin', () => {
  assert.deepEqual(buildGooseArgs({ sessionName: 'worca-a' }),
    ['run', '-q', '--output-format', 'stream-json', '--no-profile', '--with-builtin', 'developer', '--name', 'worca-a', '-i', '-']);
});

test('argv: provider/model split at the first slash, system prompt, extensions, resume by name', () => {
  assert.deepEqual(buildGooseArgs({ model: 'openrouter/anthropic/claude-sonnet-4', systemPrompt: 'Be terse.', sessionName: 'worca-b', resume: true, extensions: ["'/w/gh'"] }),
    ['run', '-q', '--output-format', 'stream-json', '--no-profile', '--with-builtin', 'developer', '--provider', 'openrouter', '--model', 'anthropic/claude-sonnet-4',
      '--system', 'Be terse.', '--with-extension', "'/w/gh'", '--resume', '--name', 'worca-b', '-i', '-']);
  assert.deepEqual(splitGooseModel('google/gemini-2.5-flash'), { provider: 'google', model: 'gemini-2.5-flash' });
  assert.equal(splitGooseModel('gemini-2.5-flash'), null, 'no provider: goose runs its configured default');
  assert.equal(splitGooseModel('google/'), null);
});

test('session ids are engine-qualified and only worca-named sessions resume', () => {
  assert.equal(GOOSE_SESSION_PREFIX, 'goose:');
  assert.equal(gooseSessionOf('goose:worca-1-abc'), 'worca-1-abc');
  assert.equal(gooseSessionOf('goose:my session'), null);
  assert.equal(gooseSessionOf('codex:worca-1'), null);
  assert.equal(gooseSessionOf('8f1c0000-0000-4000-8000-000000000000'), null);
});

test('normalizer: session first, Bash call and result, one text for a streamed message, usage and cost', () => {
  const { events, final } = replay('shell-streamed-text.jsonl', { model: 'google/gemini-2.5-flash' });
  for (const e of events) assert.ok(EVENT_TYPES.has(e.type) && isNormalized(e), JSON.stringify(e));
  assert.deepEqual(events[0], { type: 'session', sessionId: 'goose:worca-test-1', model: 'google/gemini-2.5-flash', init: true });
  assert.deepEqual(events.filter((e) => e.type === 'tool').flatMap((e) => e.calls).map((c) => [c.name, c.input]),
    [['Bash', { command: "cat a.txt | tr '\\n' ' '" }]]);
  const res = events.filter((e) => e.type === 'toolResult').flatMap((e) => e.results);
  assert.deepEqual(res.map((r) => [r.isError, r.text]), [[false, 'hello world ']]);
  const texts = events.filter((e) => e.type === 'text');
  assert.equal(texts.length, 1, 'the two chunks of one message are one text event');
  assert.equal(texts[0].text, 'The contents of a.txt are: "hello world"');
  assert.equal(final.error, null);
  assert.equal(final.text, 'The contents of a.txt are: "hello world"');
  assert.equal(final.costUsd, 0.0009848);
  assert.deepEqual(final.usage, { input_tokens: 2516, output_tokens: 92, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  assert.equal(events.at(-1).type, 'usage');
});

test('normalizer: a shell exit code other than 0 is an error result; write maps path to file_path', () => {
  const { events, final } = replay('shell-and-write.jsonl');
  const calls = events.filter((e) => e.type === 'tool').flatMap((e) => e.calls);
  assert.deepEqual(calls.map((c) => [c.name, c.input]), [['Bash', { command: 'cat missing.txt' }], ['Write', { content: 'hi', file_path: 'b.txt' }]]);
  const res = events.filter((e) => e.type === 'toolResult').flatMap((e) => e.results);
  assert.deepEqual(res.map((r) => r.isError), [true, false]);
  assert.match(res[0].text, /No such file or directory/);
  assert.equal(final.text, 'done. BANANA');
});

test('normalizer: an attached MCP server\'s tool is mcp__server__tool; another keeps goose\'s name', () => {
  const named = replay('mcp-tool.jsonl', { mcpServers: ['probe'] });
  assert.deepEqual(named.events.filter((e) => e.type === 'tool').flatMap((e) => e.calls).map((c) => c.name), ['mcp__probe__probe_ping']);
  assert.match(named.final.text, /TOKEN=tok-fixture/);
  const bare = replay('mcp-tool.jsonl');
  assert.deepEqual(bare.events.filter((e) => e.type === 'tool').flatMap((e) => e.calls).map((c) => c.name), ['probe__probe_ping']);
});

test('normalizer: an ACP provider\'s own tool (claude-acp) is named by its kind; no cost_usd leaves cost unknown', () => {
  const { events, final } = replay('claude-acp-terminal.jsonl');
  assert.deepEqual(events.filter((e) => e.type === 'tool').flatMap((e) => e.calls).map((c) => [c.name, c.input]), [['Bash', {}]]);
  assert.match(events.filter((e) => e.type === 'toolResult').flatMap((e) => e.results)[0].text, /hello world/);
  assert.equal(final.text, 'hello world');
  assert.equal(final.error, null);
  assert.equal(final.costUsd, null);
});

test('normalizer: a provider failure (exit 0) is the run\'s error, classed from its text', () => {
  const auth = replay('provider-error-auth.jsonl');
  assert.match(auth.final.error, /^Ran into this error: .*API key not valid/);
  assert.equal(classifyGooseError(auth.final.error), 'auth');
  assert.equal(auth.final.costUsd, null);
  const auth155 = replay('provider-error-auth-1.55.jsonl');   // goose 1.55: an `error` content item and event, exit 1
  assert.match(auth155.final.error, /^Ran into this error: .*API key not valid/);
  assert.equal(classifyGooseError(auth155.final.error), 'auth');
  const model = replay('provider-error-model.jsonl');
  assert.match(model.final.error, /404/);
  assert.equal(classifyGooseError(model.final.error), null);
});

test('normalizer: goose\'s own max-turns stop is a turn limit, not a success', () => {
  const { final } = replay('max-turns.jsonl');
  assert.equal(final.error, null);
  assert.equal(final.turnLimit, true);
});

test('normalizer: a stream that ends with no complete is an error; a top-level error event is too', () => {
  const n = createGooseNormalizer({ sessionName: 'worca-x' });
  n.push(frames('shell-and-write.jsonl')[0]);
  assert.match(n.finish().error, /without a completion event/);
  const m = createGooseNormalizer({ sessionName: 'worca-x' });
  const evs = m.push({ type: 'error', error: 'Rate limit exceeded' });
  assert.deepEqual(evs.map((e) => e.type), ['session', 'stderr']);
  assert.equal(m.finish().error, 'Rate limit exceeded');
});

test('error classes', () => {
  assert.equal(classifyGooseError('Ran into this error: Authentication error: invalid x-api-key'), 'auth');
  assert.equal(classifyGooseError('Request failed: Unauthorized (401)'), 'auth');
  assert.equal(classifyGooseError('Ran into this error: Rate limit exceeded'), 'rate_limit');
  assert.equal(classifyGooseError('Ran into this error: Credits exhausted'), 'quota');
  assert.equal(classifyGooseError('error sending request for url'), 'network');
  assert.equal(classifyGooseError({ message: 'x', errorClass: 'quota' }), 'quota');
  assert.equal(classifyGooseError('something odd'), null);
  assert.match(readFileSync(new URL('stderr-session-not-found.txt', FIX), 'utf8'), GOOSE_RESUME_NOT_FOUND_RE);
});

test('capabilities: declared honestly; no Ask lockdown', () => {
  assert.deepEqual(Object.keys(gooseCapabilities).sort(), [...CAPABILITY_KEYS].sort());
  assert.deepEqual(CAPABILITY_KEYS.filter((k) => gooseCapabilities[k] === false),
    ['allowedTools', 'subagents', 'hookTelemetry', 'skills', 'permissionRules', 'subagentSystemPrompt', 'turnBudget']);
  assert.ok(GOOSE_ASK_LOCKDOWN, 'Chat runs on Goose, locked down (plans/ask-on-qwen-gemini-spike.md)');
});

test('MCP: stdio servers only, names the wrapper file can carry', () => {
  assert.deepEqual(gooseMcpProblems({ gh: { command: 'gh-mcp' }, web: { url: 'https://x' }, 'bad.name': { command: 'x' }, none: {} }),
    [{ name: 'web', reason: 'remote' }, { name: 'bad.name', reason: 'name' }, { name: 'none', reason: 'incomplete' }]);
});

test('MCP wrappers: env values ride goose\'s env under per-server names, never the script; args are quoted', () => {
  const w = gooseMcpWrappers({ gh: { command: 'gh-mcp', args: ["it's", '--x'], env: { TOKEN: 's3cret' } }, fs: { command: 'fs-mcp', env: { TOKEN: 'other' } } });
  assert.deepEqual(w.env, { WORCAMCP1_TOKEN: 's3cret', WORCAMCP2_TOKEN: 'other' }, 'two servers may share a variable name');
  assert.ok(!w.scripts.gh.includes('s3cret'));
  assert.match(w.scripts.gh, /^TOKEN="\$WORCAMCP1_TOKEN"; export TOKEN; unset WORCAMCP1_TOKEN$/m);
  assert.match(w.scripts.gh, /^exec 'gh-mcp' 'it'\\''s' '--x'$/m);
  assert.equal(shWord("a'b"), "'a'\\''b'");
});

test('MCP on Windows: command lines as they are, env under the servers\' own names; a clash in any casing throws', () => {
  const d = gooseMcpDirect({ gh: { command: 'C:\\Tools\\gh-mcp.exe', args: ['--stdio'], env: { TOKEN: 's3cret' } }, fs: { command: 'fs-mcp', env: { TOKEN: 's3cret', ROOT: 'C:\\w' } } });
  assert.deepEqual(d.extensions, ["'C:\\Tools\\gh-mcp.exe' '--stdio'", "'fs-mcp'"]);
  assert.deepEqual(d.env, { TOKEN: 's3cret', ROOT: 'C:\\w' }, 'one name with one value is shared');
  assert.throws(() => gooseMcpDirect({ a: { command: 'a', env: { TOKEN: 'x' } }, b: { command: 'b', env: { token: 'y' } } }), /declare TOKEN with different values/);
});

test('MCP wrapper: runs the server with its own env name set', POSIX, () => {
  const dir = tmp();
  const w = gooseMcpWrappers({ echo: { command: 'sh', args: ['-c', 'printf %s "$TOKEN"'], env: { TOKEN: 'v1' } } });
  const file = join(dir, 'echo');
  writeFileSync(file, w.scripts.echo, { mode: 0o700 });
  assert.equal(execFileSync(file, { env: { ...process.env, ...w.env }, encoding: 'utf8' }), 'v1');
});

test('preflight: a missing binary refuses; a running one passes', POSIX, async () => {
  assert.match((await goosePreflight({ bin: join(tmp(), 'nope') })).refusal, /WORCA_GOOSE_BIN/);
  assert.deepEqual(await goosePreflight({ bin: fakeGoose(tmp(), 'x').bin }), {});
});

test('spawn: headless env, prompt on stdin, MCP through a wrapper named after the server, result with cost', POSIX, async () => {
  const fake = fakeGoose(tmp(), 'done');
  const mcp = join(tmp(), 'mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { gh: { command: 'gh-mcp', args: ['--stdio'], env: { GITHUB_TOKEN: '${MCPSECRET_GH}' } }, web: { url: 'https://x' } } }));
  const base = tmp();
  const events = [];
  const r = await runGooseProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go', systemPrompt: 'Be terse.', model: 'google/gemini-2.5-flash', effort: 'high',
    mcpConfigPath: mcp, spawnEnv: { MCPSECRET_GH: 's3cret' }, scratchBase: base, onEvent: (e) => events.push(e) });
  assert.equal(r.text, 'done');
  const rec = fake.record();
  assert.equal(rec.stdin, 'go');
  assert.equal(rec.env.GOOSE_MODE, 'auto');
  assert.equal(rec.env.GOOSE_THINKING_EFFORT, 'high');
  assert.equal(rec.env.WORCAMCP1_GITHUB_TOKEN, 's3cret');
  assert.deepEqual(rec.args.slice(rec.args.indexOf('--provider'), rec.args.indexOf('--provider') + 4), ['--provider', 'google', '--model', 'gemini-2.5-flash']);
  assert.match(rec.args[rec.args.indexOf('--system') + 1], /Be terse\.$/);
  const [wrapperPath, wrapper] = Object.entries(rec.wrappers)[0];
  assert.match(wrapperPath, /\/worca-[^/]+\/gh$/, 'the wrapper folder is named after the session');
  assert.match(wrapper, /exec 'gh-mcp' '--stdio'/);
  assert.ok(!wrapper.includes('s3cret'), 'no secret value on disk');
  assert.deepEqual(readdirSync(base), [], 'the wrappers are removed after the spawn');
  assert.ok(events.some((e) => e.type === 'stderr' && /not attached on goose — web \(remote\)/.test(e.text)));
  const result = events.find((e) => e.type === 'result');
  assert.equal(result.costUsd, 0.0012);
  assert.match(result.sessionId, /^goose:worca-/);
  assert.ok(events.some((e) => e.type === 'session' && e.sessionId === result.sessionId && !e.init));
  assert.ok(rec.args.includes('--name') && !rec.args.includes('--resume'));
});

test('spawn on Windows: no wrapper folder; the server\'s command goes to --with-extension and its env to goose', POSIX, async () => {
  const fake = fakeGoose(tmp(), 'done');
  const mcp = join(tmp(), 'mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { db: { command: 'db-mcp', args: ['--stdio'], env: { DB_TOKEN: '${MCPSECRET_DB}' } } } }));
  const base = tmp();
  await runGooseProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go', mcpConfigPath: mcp, spawnEnv: { MCPSECRET_DB: 's3cret' }, scratchBase: base, platform: 'win32' });
  const rec = fake.record();
  assert.equal(rec.args[rec.args.indexOf('--with-extension') + 1], "'db-mcp' '--stdio'");
  assert.equal(rec.env.DB_TOKEN, 's3cret');
  assert.ok(!rec.args.join(' ').includes('s3cret'), 'no secret value on the command line');
  assert.deepEqual(readdirSync(base), [], 'no wrapper folder');
});

test('spawn: resume passes --resume --name; a gone session retries fresh once, said out loud', POSIX, async () => {
  const ok = fakeGoose(tmp(), 'again');
  await runGooseProcess({ cwd: tmp(), bin: ok.bin, prompt: 'p', resumeSessionId: 'goose:worca-1-abc', scratchBase: tmp() });
  assert.deepEqual(ok.args().slice(-5), ['--resume', '--name', 'worca-1-abc', '-i', '-']);

  const dir = tmp();
  const gone = fakeGoose(dir, null, { lines: [], exit: 1, stderr: "Error: No session found with name 'worca-1-abc'" });
  // The retry must succeed: swap in a binary that answers once the first call has failed.
  const second = fakeGoose(tmp(), 'fresh');
  writeFileSync(gone.bin, `#!/bin/sh\nif [ -f ${JSON.stringify(join(dir, 'once'))} ]; then exec ${JSON.stringify(second.bin)} "$@"; fi\ntouch ${JSON.stringify(join(dir, 'once'))}\necho "Error: No session found with name 'worca-1-abc'" >&2\nexit 1\n`);
  const events = [];
  const r = await runGooseProcess({ cwd: tmp(), bin: gone.bin, prompt: 'p', resumeSessionId: 'goose:worca-1-abc', scratchBase: tmp(), onEvent: (e) => events.push(e) });
  assert.equal(r.text, 'fresh');
  assert.ok(events.some((e) => e.type === 'stderr' && /is gone — starting a fresh one/.test(e.text)));
  assert.ok(!second.args().includes('--resume'));
});

test('spawn: a provider error fails the run with its class even though goose exits 0', POSIX, async () => {
  const fake = fakeGoose(tmp(), null, { lines: frames('provider-error-auth.jsonl') });
  await assert.rejects(runGooseProcess({ cwd: tmp(), bin: fake.bin, prompt: 'p', scratchBase: tmp() }),
    (err) => err.errorClass === 'auth' && /API key not valid/.test(err.message));
});

test('spawn: goose\'s max-turns stop fails the step', POSIX, async () => {
  const fake = fakeGoose(tmp(), null, { lines: frames('max-turns.jsonl') });
  await assert.rejects(runGooseProcess({ cwd: tmp(), bin: fake.bin, prompt: 'p', scratchBase: tmp() }), /its own turn limit/);
});

test('spawn: the turn cap stops the run past maxTurns tool calls', POSIX, async () => {
  const fake = fakeGoose(tmp(), null, { lines: frames('shell-and-write.jsonl') });
  await assert.rejects(runGooseProcess({ cwd: tmp(), bin: fake.bin, prompt: 'p', maxTurns: 1, scratchBase: tmp() }), (err) => err.turnCap === true);
});

test('spawn: a read-only spawn, and a chat on an agent-CLI provider, refuse before any process', async () => {
  await assert.rejects(runGooseProcess({ askLockdown: true, bin: '/nonexistent', model: 'claude-acp/default' }), /claude-acp is an agent CLI/);
  await assert.rejects(runGooseProcess({ sandbox: 'read-only', bin: '/nonexistent' }), /runs on Claude instead/);
});

test('spawn: secrets are redacted from events and the reply', POSIX, async () => {
  const fake = fakeGoose(tmp(), 'the key is sk-goose-7f3a9c21');
  const events = [];
  const r = await runGooseProcess({ cwd: tmp(), bin: fake.bin, prompt: 'p', redactValues: ['sk-goose-7f3a9c21'], scratchBase: tmp(), onEvent: (e) => events.push(e) });
  assert.ok(!r.text.includes('sk-goose-7f3a9c21'));
  assert.ok(!JSON.stringify(events).includes('sk-goose-7f3a9c21'));
});
