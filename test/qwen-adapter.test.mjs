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
  qwenConfiguredMode, removeQwenSessions,
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

test('archive: the run\'s chats and checkpoints leave ~/.qwen; another run\'s and the sign-in stay', POSIX, async () => {
  const dir = join(tmp(), '.qwen');
  const id = '8f1c0000-0000-4000-8000-000000000001'; const other = '9a2d0000-0000-4000-8000-000000000002';
  const put = (p, d = 'x') => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, d); return p; };
  const mine = [put(join(dir, 'projects', 'proj', 'chats', `${id}.jsonl`)), put(join(dir, 'tmp', 'proj', id, 'checkpoint.json'))];
  const theirs = put(join(dir, 'projects', 'proj', 'chats', `${other}.jsonl`)); const creds = put(join(dir, 'oauth_creds.json'), 'secret');
  assert.deepEqual((await removeQwenSessions({ sessionIds: ['qwen:../proj', `gemini:${id}`], env: { QWEN_HOME: dir } })).removed, []);
  const r = await removeQwenSessions({ sessionIds: [`qwen:${id}`], env: { QWEN_HOME: dir } });
  assert.equal(r.removed.length, 2, JSON.stringify(r));
  for (const p of mine) assert.equal(existsSync(p), false, p);
  assert.equal(existsSync(theirs), true);
  assert.equal(readFileSync(creds, 'utf8'), 'secret');
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
    ['allowedTools', 'cost', 'subagents', 'hookTelemetry', 'skills', 'subagentSystemPrompt', 'turnBudget']);
  assert.ok(QWEN_ASK_LOCKDOWN, 'Chat runs on Qwen Code, locked down (plans/ask-on-qwen-gemini-spike.md)');
});

test('rule plan: Qwen reads Claude\'s rule syntax; command rules are partial; unknown tools unenforced', () => {
  const p = qwenRulePlan({ deny: ['Bash', 'Bash(git push:*)', 'Read(./.env)', 'MultiEdit(./x)', 'WebFetch(domain:x.com)', 'mcp__gh__del', 'Frobnicate', 'Bash(*)',
    'Write(~/.worca-cc/**)', 'NotebookEdit(./n.ipynb)', 'Edit'] });
  assert.deepEqual(p.deny, ['Bash', 'Bash(git push:*)', 'Read(./.env)', 'Edit(./x)', 'WebFetch(domain:x.com)', 'mcp__gh__del', 'Bash(*)',
    'Write(~/.worca-cc/**)', 'NotebookEdit(./n.ipynb)', 'Edit']);
  // A path rule binds Qwen's own file tools; its shell reaching the path is the one baseline line of every shell engine
  // (decision 10), not a partial rule.
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

test('sign-in: the auth type Qwen\'s settings choose wins; else env naming a whole provider; the child keeps that one key', POSIX, async () => {
  const home = tmp();
  assert.equal(qwenConfiguredMode({ HOME: home }), null, 'no setting: the catalog order decides (credentials.mjs)');
  const chosen = tmp();
  writeFileSync(join(chosen, 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'anthropic' } } }));
  assert.equal(qwenConfiguredMode({ HOME: home, QWEN_HOME: chosen }), 'anthropic');
  // The spawn: worca holds three providers' keys and a whole OpenAI env; the setting picks Anthropic.
  const fake = fakeQwen(tmp(), 'ok');
  const keys = { OPENAI_API_KEY: 'o', OPENAI_MODEL: 'm', OPENAI_BASE_URL: 'https://x', ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' };
  const keep = { ...process.env };
  try {
    Object.assign(process.env, { HOME: home, QWEN_HOME: chosen, ...keys });
    await runQwenProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go' });
    assert.deepEqual(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'].filter((k) => k in fake.env()), ['ANTHROPIC_API_KEY']);
    // No setting: the env names a whole OpenAI provider, so OpenAI's key, and no other.
    delete process.env.QWEN_HOME;
    await runQwenProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go' });
    assert.deepEqual(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'].filter((k) => k in fake.env()), ['OPENAI_API_KEY']);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
  }
});

test('sub-agents: their tools (agent, send_message, cron_create) are excluded when the run switches them off', POSIX, async () => {
  const fake = fakeQwen(tmp(), 'ok');
  await runQwenProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go', subagentsOff: true });
  const a = fake.args();
  const excluded = a.flatMap((x, i) => (x === '--exclude-tools' ? [a[i + 1]] : []));
  assert.deepEqual(excluded, ['agent', 'send_message', 'cron_create']);
  await runQwenProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go' });
  assert.equal(fake.args().includes('--exclude-tools'), false, 'proven inheritance (or no run gate) keeps them');
});

test('spawn: worca\'s other provider keys stay out of the agent\'s env, scrub or not', POSIX, async () => {
  const fake = fakeQwen(tmp(), 'ok');
  const keep = { ...process.env };
  Object.assign(process.env, { HOME: tmp(), QWEN_OAUTH: '1', ANTHROPIC_API_KEY: 'worca-anthropic', OPENAI_API_KEY: 'worca-openai', GEMINI_API_KEY: 'g' });
  delete process.env.QWEN_HOME;
  try {
    await runQwenProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go' });
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
  }
  const env = fake.record().env;
  assert.equal(env.QWEN_OAUTH, '1');
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY']) assert.equal(env[k], undefined, k);
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
  await runQwenProcess({ cwd, bin: fake.bin, prompt: 'go', mcpConfigPath: mcp, permissionRules: { deny: ['Bash(curl:*)'] }, spawnEnv: { MCPSECRET_GH: 's3cret', MCPSECRET_OTHER: 'other' } });
  const rec = fake.record();
  const file = rec.env.QWEN_CODE_SYSTEM_SETTINGS_PATH;
  assert.ok(file && !file.startsWith(cwd));
  const doc = JSON.parse(rec.system);
  assert.deepEqual(doc.mcpServers.gh.env, { GITHUB_TOKEN: '${MCPSECRET_GH}' }, 'no secret value on disk');
  assert.ok(doc.permissions.deny.includes('Bash(curl:*)'));
  assert.equal(rec.env.MCPSECRET_GH, 's3cret');
  assert.equal(rec.env.MCPSECRET_OTHER, undefined, 'only the values its own servers reference: never the whole run env');
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

test('a read-only spawn refuses (an Ask spawn is test/qwen-ask-adapter.test.mjs)', async () => {
  await assert.rejects(runQwenProcess({ cwd: tmp(), bin: '/nonexistent', prompt: 'x', sandbox: 'read-only' }), /read-only/);
});

test('resume: a qwen: session resumes it; one Qwen no longer knows starts fresh and says so', POSIX, async () => {
  const ok = fakeQwen(tmp(), 'ok');
  await runQwenProcess({ cwd: tmp(), bin: ok.bin, prompt: 'x', resumeSessionId: 'qwen:8f1c0000-0000-4000-8000-000000000009' });
  assert.equal(ok.args()[ok.args().indexOf('--resume') + 1], '8f1c0000-0000-4000-8000-000000000009');
  await runQwenProcess({ cwd: tmp(), bin: ok.bin, prompt: 'x', resumeSessionId: 'qwen:--x' });
  assert.ok(!ok.args().includes('--resume') && !ok.args().includes('--x'), 'a stored id that is not a uuid is never resumed');
  const gone = fakeQwen(tmp(), 'fresh', { resumeError: fixture('resume-unknown.stderr.txt').trim(), resumeExit: 1 });
  const events = [];
  const r = await runQwenProcess({ cwd: tmp(), bin: gone.bin, prompt: 'x', resumeSessionId: 'qwen:8f1c0000-0000-4000-8000-000000000009', onEvent: (e) => events.push(e) });
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
