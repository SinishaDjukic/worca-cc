// test/qwen-adapter.test.mjs — the Qwen Code adapter: argv, the Claude-shaped stream normalized through the Claude
// normalizer against the captured fixtures (test/fixtures/qwen), the rule plan, the system settings file, error
// classes, preflight and the spawn path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildQwenArgs, createQwenNormalizer, classifyQwenError, QWEN_SESSION_PREFIX, qwenRulePlan, qwenSystemSettings,
  qwenCapabilities, qwenPreflight, runQwenProcess, QWEN_ASK_LOCKDOWN, QWEN_RESUME_NOT_FOUND_RE, qwenSignedIn,
} from '../src/core/engines/qwen.mjs';
import { NO_MCP_SERVER } from '../src/core/engines/gemini-family.mjs';
import { EVENT_TYPES, isNormalized } from '../src/core/engines/events.mjs';
import { CAPABILITY_KEYS } from '../src/core/engines/capabilities.mjs';
import { fakeQwen, qwenReplyLines } from './helpers/fake-gemini-family.mjs';

const FIX = new URL('./fixtures/qwen/', import.meta.url);
const fixture = (name) => readFileSync(new URL(name, FIX), 'utf8');
const frames = (name) => fixture(name).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-qwen-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const replay = (name, opts) => { const n = createQwenNormalizer(opts); return { events: frames(name).flatMap((f) => n.push(f)), final: n.finish() }; };

test('argv: stream-json, yolo, a named session; model, system prompt, folders and MCP servers when given', () => {
  assert.deepEqual(buildQwenArgs({ sessionId: 's-1' }),
    ['--output-format', 'stream-json', '--approval-mode', 'yolo', '--session-id', 's-1', '--allowed-mcp-server-names', NO_MCP_SERVER]);
  assert.deepEqual(buildQwenArgs({ sessionId: 's-1', resume: true, model: 'qwen3-coder-plus', systemPrompt: 'Be terse.', includeDirs: ['/a'], mcpNames: ['gh'] }),
    ['--output-format', 'stream-json', '--approval-mode', 'yolo', '--resume', 's-1', '--model', 'qwen3-coder-plus',
      '--append-system-prompt', 'Be terse.', '--include-directories', '/a', '--allowed-mcp-server-names', 'gh']);
});

test('normalizer (capture): the Claude normalizer reads Qwen\'s frames; tools in Claude\'s names, tool_call unwrapped', () => {
  const { events, final } = replay('shell-write-mcp-failed-read.jsonl');
  for (const e of events) assert.ok(EVENT_TYPES.has(e.type) && isNormalized(e), JSON.stringify(e));
  const session = events.find((e) => e.type === 'session');
  assert.equal(session.sessionId, 'qwen:770028c8-8abc-4f25-966c-6cec32225a06');
  assert.equal(session.model, 'gemini-3.8-flash');
  assert.deepEqual(session.mcpServers, [{ name: 'spike', status: 'connected' }]);
  const calls = events.filter((e) => e.type === 'tool').flatMap((e) => e.calls);
  assert.deepEqual(calls.map((c) => c.name), ['Bash', 'Write', 'tool_search', 'mcp__spike__echo', 'Read']);
  assert.deepEqual(calls[3].input, { text: 'ping' });
  const results = events.filter((e) => e.type === 'toolResult').flatMap((e) => e.results);
  assert.deepEqual(results.map((r) => r.isError), [false, false, false, false, true]);
  assert.equal(results[3].text, 'PING (token=s3cr3t)');
  const result = events.find((e) => e.type === 'result');
  assert.equal(result.text, 'DONE');
  assert.equal(result.isError, false);
  assert.ok(!('costUsd' in result), 'Qwen reports no cost: never a $0.00');
  assert.equal(result.usage.output_tokens, 344);
  assert.deepEqual(final, { text: 'DONE', error: null });
});

test('normalizer: a relative file path is made absolute against the spawn\'s cwd', () => {
  const n = createQwenNormalizer({ cwd: '/w/run' });
  const out = n.push({ type: 'assistant', session_id: 's', parent_tool_use_id: null, message: { id: 'm', role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'read_file', input: { file_path: 'a.txt' } }] } });
  assert.deepEqual(out.find((e) => e.type === 'tool').calls[0].input, { file_path: '/w/run/a.txt' });
});

test('normalizer (capture): a denied call is an error result naming the rule', () => {
  const { events } = replay('denied.jsonl');
  const denied = events.filter((e) => e.type === 'toolResult').flatMap((e) => e.results).filter((r) => /denied by permission rules/.test(r.text));
  assert.equal(denied.length, 4);
  for (const r of denied) assert.equal(r.isError, true);
});

test('normalizer (capture): an error result fails the run; signed out is auth', () => {
  const out = replay('signed-out.jsonl');
  assert.match(out.final.error, /No auth type is selected/);
  assert.equal(classifyQwenError(out.final.error), 'auth');
  assert.ok(!out.events.some((e) => e.type === 'result'), 'a failed run emits no result');
  assert.equal(classifyQwenError(replay('api-key-invalid.jsonl').final.error), 'auth');
});

test('unknown resume is recognized from its captured stderr', () => {
  assert.match(fixture('resume-unknown.stderr.txt'), QWEN_RESUME_NOT_FOUND_RE);
});

test('capabilities: the system prompt flag is the one Gemini lacks; cost is false', () => {
  assert.deepEqual(Object.keys(qwenCapabilities).sort(), [...CAPABILITY_KEYS].sort());
  assert.deepEqual(CAPABILITY_KEYS.filter((k) => qwenCapabilities[k] === false),
    ['allowedTools', 'effort', 'cost', 'subagents', 'hookTelemetry', 'skills', 'subagentSystemPrompt', 'turnBudget']);
  assert.equal(QWEN_ASK_LOCKDOWN, null);
});

test('rule plan: Qwen reads Claude\'s rule syntax; command rules are partial; unknown tools unenforced', () => {
  const p = qwenRulePlan({ deny: ['Bash', 'Bash(git push:*)', 'Read(./.env)', 'MultiEdit(./x)', 'WebFetch(domain:x.com)', 'mcp__gh__del', 'Frobnicate', 'Bash(*)'] });
  assert.deepEqual(p.deny, ['Bash', 'Bash(git push:*)', 'Read(./.env)', 'Edit(./x)', 'WebFetch(domain:x.com)', 'mcp__gh__del', 'Bash(*)']);
  assert.deepEqual(p.partial, ['Bash(git push:*)']);
  assert.deepEqual(p.unenforced, ['Frobnicate']);
});

test('system settings: worca\'s servers and rules merged into the machine\'s own system settings', () => {
  assert.deepEqual(qwenSystemSettings({ base: null, mcpServers: { gh: { command: 'x' } }, deny: ['Bash'] }),
    { mcpServers: { gh: { command: 'x' } }, permissions: { deny: ['Bash'] } });
  assert.deepEqual(qwenSystemSettings({ base: { model: { name: 'q' }, mcpServers: { corp: { command: 'c' } }, permissions: { deny: ['WebSearch'], allow: ['Read'] } },
    mcpServers: { gh: { command: 'x' } }, deny: ['Bash', 'WebSearch'] }),
  { model: { name: 'q' }, mcpServers: { corp: { command: 'c' }, gh: { command: 'x' } }, permissions: { deny: ['WebSearch', 'Bash'], allow: ['Read'] } });
});

test('sign-in: a chosen auth type, or env naming a whole provider (also from .env)', () => {
  const home = tmp();
  assert.equal(qwenSignedIn({ HOME: home }), false);
  assert.equal(qwenSignedIn({ HOME: home, GEMINI_API_KEY: 'k' }), false, 'a key alone is "No auth type is selected"');
  assert.equal(qwenSignedIn({ HOME: home, GEMINI_API_KEY: 'k', GEMINI_MODEL: 'g' }), true);
  assert.equal(qwenSignedIn({ HOME: home, OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm', OPENAI_BASE_URL: 'https://x' }), true);
  mkdirSync(join(home, '.qwen'));
  writeFileSync(join(home, '.qwen', '.env'), 'OPENAI_API_KEY=k\nOPENAI_MODEL=m\nOPENAI_BASE_URL=https://x\n');
  assert.equal(qwenSignedIn({ HOME: home }), true);
  const chosen = tmp();
  writeFileSync(join(chosen, 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'qwen-oauth' } } }));
  assert.equal(qwenSignedIn({ HOME: home, QWEN_HOME: chosen }), true);
});

test('preflight: missing binary refuses; signed out refuses; signed in passes', POSIX, async () => {
  assert.match((await qwenPreflight({ bin: join(tmp(), 'nope') })).refusal, /WORCA_QWEN_BIN/);
  const fake = fakeQwen(tmp(), 'x');
  assert.match((await qwenPreflight({ bin: fake.bin, env: { HOME: tmp() } })).refusal, /not signed in/);
  assert.deepEqual(await qwenPreflight({ bin: fake.bin, env: { HOME: tmp(), QWEN_OAUTH: '1' } }), {});
});

test('spawn: prompt on stdin, the system prompt by flag, the session named first; no settings file without rules or MCP', POSIX, async () => {
  const fake = fakeQwen(tmp(), 'done');
  const events = [];
  const r = await runQwenProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go', systemPrompt: 'Be terse.', onEvent: (e) => events.push(e) });
  assert.equal(r.text, 'done');
  const rec = fake.record();
  assert.equal(rec.stdin, 'go');
  const a = rec.args;
  assert.equal(a[a.indexOf('--append-system-prompt') + 1].endsWith('Be terse.'), true);
  const id = a[a.indexOf('--session-id') + 1];
  assert.deepEqual(events[0], { type: 'session', sessionId: `qwen:${id}` });
  assert.equal(rec.env.QWEN_CODE_SYSTEM_SETTINGS_PATH, undefined);
  assert.equal(rec.env.QWEN_CODE_SUPPRESS_YOLO_WARNING, '1');
  assert.ok(a.includes(NO_MCP_SERVER));
});

test('spawn: rules and MCP servers ride a system settings file outside the checkout, removed after; secrets ride the env', POSIX, async () => {
  const cwd = tmp();
  const fake = fakeQwen(tmp(), 'ok');
  const mcp = join(tmp(), 'mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { gh: { command: 'gh-mcp', env: { GITHUB_TOKEN: '${MCPSECRET_GH}' } } } }));
  await runQwenProcess({ cwd, bin: fake.bin, prompt: 'go', mcpConfigPath: mcp, permissionRules: { deny: ['Bash(curl:*)'] }, spawnEnv: { MCPSECRET_GH: 's3cret' } });
  const rec = fake.record();
  const file = rec.env.QWEN_CODE_SYSTEM_SETTINGS_PATH;
  assert.ok(file && !file.startsWith(cwd));
  const doc = JSON.parse(rec.system);
  assert.deepEqual(doc.mcpServers.gh.env, { GITHUB_TOKEN: '${MCPSECRET_GH}' }, 'no secret value on disk');
  assert.ok(doc.permissions.deny.includes('Bash(curl:*)'));
  assert.equal(rec.env.MCPSECRET_GH, 's3cret');
  assert.ok(!existsSync(file), 'removed after the spawn');
  assert.ok(!existsSync(join(cwd, '.qwen')), 'nothing written into the checkout');
});

test('spawn: a system prompt too long for argv is folded into stdin', POSIX, async () => {
  const fake = fakeQwen(tmp(), 'ok');
  await runQwenProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go', systemPrompt: 's'.repeat(200_000) });
  const rec = fake.record();
  assert.ok(!rec.args.includes('--append-system-prompt'));
  assert.match(rec.stdin, /^=== SYSTEM ===\n/);
});

test('read-only and Ask spawns refuse', async () => {
  await assert.rejects(runQwenProcess({ cwd: tmp(), bin: '/nonexistent', prompt: 'x', sandbox: 'read-only' }), /read-only/);
  await assert.rejects(runQwenProcess({ cwd: tmp(), bin: '/nonexistent', prompt: 'x', askLockdown: true }), /Ask on Qwen Code is unavailable/);
});

test('resume: a qwen: session resumes it; one Qwen no longer knows starts fresh and says so', POSIX, async () => {
  const ok = fakeQwen(tmp(), 'ok');
  await runQwenProcess({ cwd: tmp(), bin: ok.bin, prompt: 'x', resumeSessionId: 'qwen:s-9' });
  assert.equal(ok.args()[ok.args().indexOf('--resume') + 1], 's-9');
  const gone = fakeQwen(tmp(), 'fresh', { resumeError: fixture('resume-unknown.stderr.txt').trim(), resumeExit: 1 });
  const events = [];
  const r = await runQwenProcess({ cwd: tmp(), bin: gone.bin, prompt: 'x', resumeSessionId: 'qwen:gone', onEvent: (e) => events.push(e) });
  assert.equal(r.text, 'fresh');
  assert.ok(events.some((e) => e.type === 'stderr' && /is gone/.test(e.text)));
});

test('an error result rejects with its errorClass', POSIX, async () => {
  const fake = fakeQwen(tmp(), null, { lines: frames('signed-out.jsonl'), exit: 1 });
  await assert.rejects(runQwenProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x' }), (err) => err.errorClass === 'auth');
});

test('fake reply lines are a valid run (helper sanity)', () => {
  const n = createQwenNormalizer();
  for (const l of qwenReplyLines('hi')) n.push(l);
  assert.deepEqual(n.finish(), { text: 'hi', error: null });
});
