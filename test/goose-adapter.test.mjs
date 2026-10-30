// test/goose-adapter.test.mjs — the Goose CLI adapter: argv, the stream-json normalizer against real goose 1.54
// captures (test/fixtures/goose), MCP wrappers, error classes, preflight and the spawn path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildGooseArgs, createGooseNormalizer, classifyGooseError, gooseSessionOf, GOOSE_SESSION_PREFIX, splitGooseModel,
  gooseCapabilities, goosePreflight, runGooseProcess, GOOSE_ASK_LOCKDOWN, gooseMcpProblems, gooseMcpWrappers, gooseMcpDirect, shWord,
  GOOSE_RESUME_NOT_FOUND_RE, gooseSessionsDb, gooseSessionSpend, removeGooseSessions, gooseConfiguredMode,
} from '../src/core/engines/goose.mjs';
import { describeUnattachableMcp } from '../src/core/engines/capabilities.mjs';
import { credentialNamesOf } from '../src/core/exec-env/credentials.mjs';
import { EVENT_TYPES, isNormalized } from '../src/core/engines/events.mjs';
import { CAPABILITY_KEYS } from '../src/core/engines/capabilities.mjs';
import { fakeGoose } from './helpers/fake-goose.mjs';

const FIX = new URL('./fixtures/goose/', import.meta.url);
const frames = (name) => readFileSync(new URL(name, FIX), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-goose-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
/** Run `fn` with `vars` in worca's env (undefined unsets one), then put them back. */
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
/** A goose 1.54 session database (the columns worca reads and deletes by) with `rows`: {id, name, input, output, cost}. */
function gooseDb(file, rows = []) {
  mkdirSync(join(file, '..'), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', working_dir TEXT NOT NULL DEFAULT '/w',
    accumulated_input_tokens INTEGER, accumulated_output_tokens INTEGER, accumulated_cache_read_tokens INTEGER,
    accumulated_cache_write_tokens INTEGER, accumulated_cost REAL);
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content_json TEXT NOT NULL, created_timestamp INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS usage_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, created_timestamp INTEGER NOT NULL,
      input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, cost REAL);`);
  for (const r of rows) {
    db.prepare('INSERT INTO sessions (id, name, accumulated_input_tokens, accumulated_output_tokens, accumulated_cost) VALUES (?, ?, ?, ?, ?)').run(r.id, r.name, r.input ?? null, r.output ?? null, r.cost ?? null);
    db.prepare("INSERT INTO messages (session_id, role, content_json, created_timestamp) VALUES (?, 'user', '[]', 1)").run(r.id);
    db.prepare('INSERT INTO usage_ledger (session_id, created_timestamp, input_tokens) VALUES (?, 1, 1)').run(r.id);
  }
  db.close();
  return file;
}
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

test('MCP: stdio servers only, names the wrapper file can carry; on Windows none that declares env', () => {
  assert.deepEqual(gooseMcpProblems({ gh: { command: 'gh-mcp' }, web: { url: 'https://x' }, 'bad.name': { command: 'x' }, none: {} }),
    [{ name: 'web', reason: 'remote' }, { name: 'bad.name', reason: 'name' }, { name: 'none', reason: 'incomplete' }]);
  // Windows has no wrapper script, so a server's env would ride goose's own env (every tool call would see it).
  const servers = { gh: { command: 'gh-mcp', env: { TOKEN: 'x' } }, fs: { command: 'fs-mcp' } };
  assert.deepEqual(gooseMcpProblems(servers, { platform: 'win32' }), [{ name: 'gh', reason: 'env' }]);
  assert.deepEqual(gooseMcpProblems(servers, { platform: 'darwin' }), []);
  assert.match(describeUnattachableMcp('goose', [{ name: 'gh', reason: 'env' }]), /^env values goose on Windows could hand it only through goose's own environment: gh$/);
});

test('MCP wrappers: env values go to a file beside the wrapper, never goose\'s env or the script; args are quoted', () => {
  const w = gooseMcpWrappers({ gh: { command: 'gh-mcp', args: ["it's", '--x'], env: { TOKEN: "s3c'ret" } }, fs: { command: 'fs-mcp' } });
  assert.equal('env' in w, false, 'nothing for goose\'s own env');
  assert.ok(!w.scripts.gh.includes('s3c'));
  assert.match(w.scripts.gh, /^\. "\$\{0%\/\*\}\/gh\.env"$/m);
  assert.equal(w.envFiles.gh, "TOKEN='s3c'\\''ret'; export TOKEN\n");
  assert.equal(w.envFiles.fs, undefined);
  assert.ok(!w.scripts.fs.includes('.env'), 'a server with no env sources nothing');
  assert.match(w.scripts.gh, /^exec 'gh-mcp' 'it'\\''s' '--x'$/m);
  assert.equal(shWord("a'b"), "'a'\\''b'");
});

test('MCP on Windows: command lines as they are, and no env', () => {
  const d = gooseMcpDirect({ gh: { command: 'C:\\Tools\\gh-mcp.exe', args: ['--stdio'] }, fs: { command: 'fs-mcp', env: { TOKEN: 's3cret' } } });
  assert.deepEqual(d, { extensions: ["'C:\\Tools\\gh-mcp.exe' '--stdio'"] }, 'a server that declares env is not attached');
});

test('MCP wrapper: runs the server with its own env name set, from the file beside it', POSIX, () => {
  const dir = tmp();
  const w = gooseMcpWrappers({ echo: { command: 'sh', args: ['-c', 'printf %s "$TOKEN"'], env: { TOKEN: 'v1 $HOME' } } });
  const file = join(dir, 'echo');
  writeFileSync(file, w.scripts.echo, { mode: 0o700 });
  writeFileSync(join(dir, 'echo.env'), w.envFiles.echo, { mode: 0o600 });
  assert.equal(execFileSync(file, { env: { PATH: process.env.PATH }, encoding: 'utf8' }), 'v1 $HOME');
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
  assert.ok(!Object.values(rec.env).includes('s3cret'), 'no MCP value in goose\'s env');
  assert.deepEqual(rec.args.slice(rec.args.indexOf('--provider'), rec.args.indexOf('--provider') + 4), ['--provider', 'google', '--model', 'gemini-2.5-flash']);
  assert.match(rec.args[rec.args.indexOf('--system') + 1], /Be terse\.$/);
  const [wrapperPath, wrapper] = Object.entries(rec.wrappers)[0];
  assert.match(wrapperPath, /\/worca-[^/]+\/gh$/, 'the wrapper folder is named after the session');
  assert.match(wrapper, /exec 'gh-mcp' '--stdio'/);
  assert.ok(!wrapper.includes('s3cret'), 'no secret value in the wrapper');
  assert.deepEqual(rec.envFiles[wrapperPath], { text: "GITHUB_TOKEN='s3cret'; export GITHUB_TOKEN\n", mode: 0o600 }, 'the value sits beside it, for the server only');
  assert.deepEqual(readdirSync(base), [], 'the wrappers are removed after the spawn');
  assert.ok(events.some((e) => e.type === 'stderr' && /not attached on goose — web \(remote\)/.test(e.text)));
  const result = events.find((e) => e.type === 'result');
  assert.equal(result.costUsd, 0.0012);
  assert.match(result.sessionId, /^goose:worca-/);
  assert.ok(events.some((e) => e.type === 'session' && e.sessionId === result.sessionId && !e.init));
  assert.ok(rec.args.includes('--name') && !rec.args.includes('--resume'));
});

test('spawn on Windows: no wrapper folder; a server\'s command goes to --with-extension, one that declares env is not attached', POSIX, async () => {
  const fake = fakeGoose(tmp(), 'done');
  const mcp = join(tmp(), 'mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { db: { command: 'db-mcp', args: ['--stdio'], env: { DB_TOKEN: '${MCPSECRET_DB}' } }, fs: { command: 'fs-mcp' } } }));
  const base = tmp();
  const events = [];
  await runGooseProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go', mcpConfigPath: mcp, spawnEnv: { MCPSECRET_DB: 's3cret' }, scratchBase: base, platform: 'win32', onEvent: (e) => events.push(e) });
  const rec = fake.record();
  assert.deepEqual(rec.args.filter((a, i) => rec.args[i - 1] === '--with-extension'), ["'fs-mcp'"]);
  assert.ok(!JSON.stringify(rec).includes('s3cret'), 'no secret value in goose\'s env or argv');
  assert.ok(events.some((e) => e.type === 'stderr' && /not attached on goose — db \(env\)/.test(e.text)));
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

test('spawn: goose\'s max-turns stop fails the step, and books its complete', POSIX, async () => {
  const fake = fakeGoose(tmp(), null, { lines: frames('max-turns.jsonl') });
  const events = [];
  await assert.rejects(runGooseProcess({ cwd: tmp(), bin: fake.bin, prompt: 'p', scratchBase: tmp(), onEvent: (e) => events.push(e) }), /its own turn limit/);
  assert.deepEqual(events.filter((e) => e.type === 'spend').map((e) => [e.costUsd, e.usage.input_tokens]), [[0.00048019999999999996, 1184]]);
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

test('sign-in: the step model\'s provider names the one key goose gets; with no model, goose\'s own provider setting', POSIX, async () => {
  const home = tmp();
  mkdirSync(join(home, '.config', 'goose'), { recursive: true });
  const keys = { OPENAI_API_KEY: 'k-oa', ANTHROPIC_API_KEY: 'k-an', GOOGLE_API_KEY: 'k-go', HOME: home, XDG_CONFIG_HOME: undefined, GOOSE_PROVIDER: undefined, GOOSE_PATH_ROOT: undefined };
  const held = (env) => credentialNamesOf('goose').filter((k) => k in env);
  await withEnv(keys, async () => {
    const fake = fakeGoose(tmp(), 'ok');
    await runGooseProcess({ cwd: tmp(), bin: fake.bin, prompt: 'p', model: 'google/gemini-2.5-flash', scratchBase: tmp() });
    assert.deepEqual(held(fake.env()), ['GOOGLE_API_KEY']);
    await runGooseProcess({ cwd: tmp(), bin: fake.bin, prompt: 'p', model: 'ollama/llama3', scratchBase: tmp() });
    assert.deepEqual(held(fake.env()), [], 'a provider worca holds no key for: goose\'s own config');
    writeFileSync(join(home, '.config', 'goose', 'config.yaml'), 'GOOSE_MODEL: claude-sonnet-4-5\nGOOSE_PROVIDER: "anthropic"\n');
    assert.equal(gooseConfiguredMode(process.env), 'anthropic');
    await runGooseProcess({ cwd: tmp(), bin: fake.bin, prompt: 'p', scratchBase: tmp() });
    assert.deepEqual(held(fake.env()), ['ANTHROPIC_API_KEY'], 'no model: the provider goose is configured with');
    assert.deepEqual(await goosePreflight({ bin: fake.bin }), {});
    await withEnv({ GOOSE_PROVIDER: 'openai' }, async () => {
      assert.equal(gooseConfiguredMode(process.env), 'openai', 'GOOSE_PROVIDER in the env wins over the file, as in goose');
    });
  });
});

test('sign-in: Goose on Amazon Bedrock with a Bedrock API key is refused before any process', POSIX, async () => {
  const fake = fakeGoose(tmp(), 'ok');
  await withEnv({ AWS_BEARER_TOKEN_BEDROCK: 'bedrock-key-9f3a' }, async () => {
    await assert.rejects(runGooseProcess({ cwd: tmp(), bin: fake.bin, prompt: 'p', model: 'aws_bedrock/anthropic.claude-sonnet-4-5', envAllowlist: ['AWS_BEARER_TOKEN_BEDROCK'], scratchBase: tmp() }),
      (err) => err.errorClass === 'config' && /Bedrock API key \(AWS_BEARER_TOKEN_BEDROCK\)/.test(err.message));
    assert.equal(fake.record(), null, 'goose never ran');
    // Not handed to goose (no allowlist): goose signs in to Bedrock its own way, and the step runs.
    await runGooseProcess({ cwd: tmp(), bin: fake.bin, prompt: 'p', model: 'aws_bedrock/anthropic.claude-sonnet-4-5', scratchBase: tmp() });
    assert.equal(fake.env().AWS_BEARER_TOKEN_BEDROCK, undefined);
  });
  // A step with no model runs goose's GOOSE_PROVIDER: Bedrock there with the key handed on is refused the same way.
  const none = fakeGoose(tmp(), 'ok');
  await withEnv({ AWS_BEARER_TOKEN_BEDROCK: 'bedrock-key-9f3a', GOOSE_PROVIDER: 'aws_bedrock' }, async () => {
    await assert.rejects(runGooseProcess({ cwd: tmp(), bin: none.bin, prompt: 'p', envAllowlist: ['AWS_BEARER_TOKEN_BEDROCK'], scratchBase: tmp() }),
      (err) => err.errorClass === 'config' && /Bedrock API key \(AWS_BEARER_TOKEN_BEDROCK\)/.test(err.message));
    assert.equal(none.record(), null, 'goose never ran');
  });
});

test('session store: goose\'s Paths (GOOSE_PATH_ROOT, the XDG data dir, ~/.local/share)', () => {
  assert.equal(gooseSessionsDb({ HOME: '/h' }, 'darwin'), '/h/.local/share/goose/sessions/sessions.db');
  assert.equal(gooseSessionsDb({ HOME: '/h', XDG_DATA_HOME: '/x' }, 'linux'), '/x/goose/sessions/sessions.db');
  assert.equal(gooseSessionsDb({ HOME: '/h', XDG_DATA_HOME: 'rel' }, 'linux'), '/h/.local/share/goose/sessions/sessions.db', 'a relative XDG dir is ignored');
  assert.equal(gooseSessionsDb({ HOME: '/h', GOOSE_PATH_ROOT: '/r' }, 'linux'), '/r/data/sessions/sessions.db');
});

test('archive: the run\'s goose sessions leave goose\'s database by name; another run\'s, and goose\'s config, stay', async () => {
  const home = tmp();
  const env = { HOME: home };
  const db = gooseDb(gooseSessionsDb(env), [{ id: '20261024_1', name: 'worca-1-a' }, { id: '20261024_2', name: 'worca-1-b' }, { id: '20261024_3', name: 'mine' }]);
  const config = join(home, '.config', 'goose', 'config.yaml');
  mkdirSync(join(config, '..'), { recursive: true });
  writeFileSync(config, 'GOOSE_PROVIDER: google\n');
  assert.deepEqual((await removeGooseSessions({ sessionIds: ['goose:mine', 'goose:../x', 'codex:worca-1-b'], env })).removed, [], 'only worca-named goose sessions');
  const r = await removeGooseSessions({ sessionIds: ['goose:worca-1-a'], env });
  assert.deepEqual(r, { removed: [`${db}#20261024_1`], failed: [] });
  const d = new DatabaseSync(db);
  assert.deepEqual(d.prepare('SELECT id FROM sessions ORDER BY id').all().map((x) => x.id), ['20261024_2', '20261024_3']);
  assert.deepEqual(d.prepare('SELECT DISTINCT session_id AS s FROM messages ORDER BY s').all().map((x) => x.s), ['20261024_2', '20261024_3']);
  assert.deepEqual(d.prepare('SELECT DISTINCT session_id AS s FROM usage_ledger ORDER BY s').all().map((x) => x.s), ['20261024_2', '20261024_3']);
  d.close();
  assert.equal(readFileSync(config, 'utf8'), 'GOOSE_PROVIDER: google\n');
  assert.deepEqual(await removeGooseSessions({ sessionIds: ['goose:worca-1-a'], env: { HOME: tmp() } }), { removed: [], failed: [] }, 'no database: nothing to remove');
});

test('spend: a step that ends without its result books what goose recorded (its complete, else its session database)', POSIX, async () => {
  const home = tmp();
  await withEnv({ HOME: home, XDG_DATA_HOME: undefined, GOOSE_PATH_ROOT: undefined }, async () => {
    const spends = (events) => events.filter((e) => e.type === 'spend');
    // Exit 1 after its complete: the complete's figure.
    const fail = fakeGoose(tmp(), 'x', { exit: 1 });
    let events = [];
    await assert.rejects(runGooseProcess({ cwd: tmp(), bin: fail.bin, prompt: 'p', scratchBase: tmp(), onEvent: (e) => events.push(e) }), /exited with code 1/);
    assert.deepEqual(spends(events), [{ type: 'spend', source: 'engine', costUsd: 0.0012, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }]);
    assert.equal(events.some((e) => e.type === 'result'), false);
    // The turn cap, before any complete: what goose's database holds for the session.
    const dir = tmp();
    const capped = fakeGoose(dir, null, { lines: frames('shell-and-write.jsonl').filter((l) => l.type !== 'complete'), hold: true,
      db: { file: gooseSessionsDb({ HOME: home }), input: 300, output: 40, cost: 0.0021 } });
    events = [];
    await assert.rejects(runGooseProcess({ cwd: tmp(), bin: capped.bin, prompt: 'p', maxTurns: 1, scratchBase: tmp(), onEvent: (e) => events.push(e) }), (err) => err.turnCap === true);
    assert.deepEqual(spends(events), [{ type: 'spend', source: 'engine', costUsd: 0.0021, usage: { input_tokens: 300, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }]);
    // A stop of a resumed session: only what this spawn's replies added (the database holds the earlier spawns' too);
    // a reply goose could not price leaves the cost unknown.
    const name = capped.args()[capped.args().indexOf('--name') + 1];
    const resumed = fakeGoose(tmp(), null, { lines: frames('shell-and-write.jsonl').slice(0, 2), hold: true,
      db: { file: gooseSessionsDb({ HOME: home }), input: 200, output: 10 } });
    events = [];
    const ac = new AbortController();
    const run = runGooseProcess({ cwd: tmp(), bin: resumed.bin, prompt: 'p', resumeSessionId: `goose:${name}`, signal: ac.signal, scratchBase: tmp(), onEvent: (e) => events.push(e) });
    while (!events.some((e) => e.type === 'tool')) await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    await assert.rejects(run, (err) => err.name === 'AbortError');
    assert.deepEqual(spends(events), [{ type: 'spend', source: 'engine', usage: { input_tokens: 200, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }],
      'no cost figure: the ledger books it unknown');
    assert.deepEqual(gooseSessionSpend('worca-nope', { HOME: home }), null);
    // A success books once, from its result: no spend event.
    events = [];
    await runGooseProcess({ cwd: tmp(), bin: fakeGoose(tmp(), 'ok').bin, prompt: 'p', scratchBase: tmp(), onEvent: (e) => events.push(e) });
    assert.deepEqual(spends(events), []);
  });
});
