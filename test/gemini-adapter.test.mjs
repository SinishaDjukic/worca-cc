// test/gemini-adapter.test.mjs — the Gemini CLI adapter: argv, the stream-json normalizer against the captured
// fixtures (test/fixtures/gemini), the policy rule plan, error classes, preflight and the spawn path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildGeminiArgs, createGeminiNormalizer, classifyGeminiError, GEMINI_SESSION_PREFIX, geminiRulePlan, geminiPolicyToml,
  geminiCapabilities, geminiPreflight, runGeminiProcess, GEMINI_ASK_LOCKDOWN, GEMINI_RESUME_NOT_FOUND_RE, GEMINI_POLICY_ERROR_RE,
  removeGeminiSessions,
} from '../src/core/engines/gemini.mjs';
import { familySessionOf, NO_MCP_SERVER } from '../src/core/engines/gemini-family.mjs';
import { projectFileOwned } from '../src/core/engines/project-files.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { EVENT_TYPES, isNormalized } from '../src/core/engines/events.mjs';
import { CAPABILITY_KEYS } from '../src/core/engines/capabilities.mjs';
import { fakeGemini, geminiReplyLines } from './helpers/fake-gemini-family.mjs';

const FIX = new URL('./fixtures/gemini/', import.meta.url);
const fixture = (name) => readFileSync(new URL(name, FIX), 'utf8');
const frames = (name) => fixture(name).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-gemini-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const replay = (name, opts) => { const n = createGeminiNormalizer(opts); return { events: frames(name).flatMap((f) => n.push(f)), final: n.finish() }; };

test('argv: stream-json, yolo, a named session; model, policy, folders and MCP servers when given', () => {
  assert.deepEqual(buildGeminiArgs({ sessionId: 's-1' }),
    ['--output-format', 'stream-json', '--approval-mode', 'yolo', '--session-id', 's-1', '--allowed-mcp-server-names', NO_MCP_SERVER]);
  assert.deepEqual(buildGeminiArgs({ sessionId: 's-1', resume: true, model: 'gemini-3.8-flash', policyFile: '/p.toml', includeDirs: ['/a', '/b'], mcpNames: ['gh', 'fs'] }),
    ['--output-format', 'stream-json', '--approval-mode', 'yolo', '--resume', 's-1', '--model', 'gemini-3.8-flash', '--admin-policy', '/p.toml',
      '--include-directories', '/a', '--include-directories', '/b', '--allowed-mcp-server-names', 'gh', '--allowed-mcp-server-names', 'fs']);
});

test('session ids are engine-qualified uuids; another engine\'s id, or anything but a uuid, is not a Gemini session', () => {
  assert.equal(GEMINI_SESSION_PREFIX, 'gemini:');
  assert.equal(familySessionOf(GEMINI_SESSION_PREFIX, 'gemini:8f1c0000-0000-4000-8000-000000000000'), '8f1c0000-0000-4000-8000-000000000000');
  assert.equal(familySessionOf(GEMINI_SESSION_PREFIX, 'qwen:8f1c0000-0000-4000-8000-000000000000'), null);
  assert.equal(familySessionOf(GEMINI_SESSION_PREFIX, '8f1c0000-0000-4000-8000-000000000000'), null);
  // worca names every session with a uuid (--session-id): anything else goes nowhere near argv or a path.
  for (const bad of ['gemini:abc', 'gemini:--resume', 'gemini:-oX', 'gemini:../x', 'gemini:8f1c0000-0000-4000-8000-000000000000 --x']) {
    assert.equal(familySessionOf(GEMINI_SESSION_PREFIX, bad), null, bad);
  }
});

test('archive: the run\'s chats leave ~/.gemini/tmp by their whole id; a chat sharing its first 8 characters and the sign-in stay', POSIX, async () => {
  const home = tmp();
  const id = '8f1c0000-0000-4000-8000-000000000001'; const twin = '8f1c0000-0000-4000-8000-000000000002';
  const chats = join(home, '.gemini', 'tmp', 'proj', 'chats');
  mkdirSync(chats, { recursive: true });
  // Gemini names a chat file by the id's first 8 characters; the file holds the whole id.
  const mine = join(chats, `session-2026-10-22T10-00-${id.slice(0, 8)}.json`); writeFileSync(mine, JSON.stringify({ sessionId: id }));
  const theirs = join(chats, `session-2026-10-22T11-00-${twin.slice(0, 8)}.json`); writeFileSync(theirs, JSON.stringify({ sessionId: twin }));
  const creds = join(home, '.gemini', 'oauth_creds.json'); writeFileSync(creds, 'secret');
  // Not a Gemini session id: nothing is read or removed.
  assert.deepEqual((await removeGeminiSessions({ sessionIds: ['gemini:../proj', `qwen:${id}`, id], env: { HOME: home } })).removed, []);
  // GEMINI_CLI_HOME moves the store, as it moves Gemini's.
  const r = await removeGeminiSessions({ sessionIds: [`gemini:${id}`], env: { HOME: tmp(), GEMINI_CLI_HOME: home } });
  assert.equal(r.removed.length, 1, JSON.stringify(r));
  assert.equal(existsSync(mine), false);
  assert.equal(readFileSync(theirs, 'utf8'), JSON.stringify({ sessionId: twin }));
  assert.equal(readFileSync(creds, 'utf8'), 'secret');
});

test('normalizer (capture): Bash, Write and Read rows in Claude\'s names, failed calls are errors, tokens and no cost', () => {
  const { events, final } = replay('shell-write-failed-read.jsonl');
  for (const e of events) assert.ok(EVENT_TYPES.has(e.type) && isNormalized(e), JSON.stringify(e));
  assert.deepEqual(events[0], { type: 'session', sessionId: 'gemini:076867b8-79b6-4b75-8060-384f573bc146', model: 'auto', init: true });
  const calls = events.filter((e) => e.type === 'tool').flatMap((e) => e.calls);
  assert.deepEqual(calls.map((c) => c.name), ['update_topic', 'Bash', 'Write', 'echo', 'Read']);
  assert.deepEqual(calls[1].input, { description: 'Display contents of a.txt', command: 'cat a.txt' });
  assert.deepEqual(calls[2].input, { file_path: 'b.txt', content: 'bye' });
  const results = Object.fromEntries(events.filter((e) => e.type === 'toolResult').flatMap((e) => e.results).map((r) => [r.toolUseId, r]));
  assert.deepEqual([results.run_shell_command__call_917085.isError, results.run_shell_command__call_917085.text], [false, 'hello']);
  assert.deepEqual([results.write_file__call_1232441.isError, results.write_file__call_1232441.text], [false, '']);
  assert.equal(results.echo__call_1234125.isError, true);
  assert.equal(results.read_file__call_962150.isError, true);
  assert.match(results.read_file__call_962150.text, /File not found/);
  const texts = events.filter((e) => e.type === 'text');
  assert.deepEqual(texts.map((t) => t.text), ['DONE']);
  const result = events.find((e) => e.type === 'result');
  assert.deepEqual(result.usage, { input_tokens: 61761, cache_read_input_tokens: 16278, output_tokens: 165 });
  assert.ok(!('costUsd' in result), 'Gemini reports no cost: never a $0.00');
  assert.equal(final.error, null);
  assert.equal(final.text, 'DONE');
});

test('normalizer (capture): an MCP tool is mcp__server__tool; text deltas join into one message', () => {
  const { events } = replay('mcp.jsonl', { mcpNames: ['spike'] });
  assert.deepEqual(events.filter((e) => e.type === 'tool').flatMap((e) => e.calls).map((c) => c.name), ['mcp__spike__echo']);
  assert.deepEqual(events.filter((e) => e.type === 'text').map((t) => t.text), ['`PING (token=s3cr3t)`']);
});

test('normalizer: a refusal that names no worca rule is Gemini\'s own check, and the run log says so', () => {
  // Gemini CLI 0.64 turns two checks of its own into denials in a headless run: a shell command reusing a flag or path
  // that earlier tool output showed (its "untrusted context"), and an edit to a build file. worca's rules carry
  // "worca guardrail: <rule>" (geminiPolicyToml).
  const deny = (id, message) => ({ type: 'tool_result', tool_id: id, status: 'error', output: message, error: { type: 'policy_violation', message } });
  const n = createGeminiNormalizer({});
  n.push({ type: 'tool_use', tool_name: 'run_shell_command', tool_id: 's1', parameters: { command: 'node --test x.mjs' } });
  const taint = n.push(deny('s1', 'Tool execution denied by policy.'));
  assert.equal(taint[0].results[0].isError, true);
  assert.match(taint.find((e) => e.type === 'stderr')?.text ?? '', /^\[worca\] gemini: Gemini CLI refused Bash on its own, not by a worca rule: in a run with no terminal it refuses a shell command that reuses a flag or path from earlier tool output/);
  n.push({ type: 'tool_use', tool_name: 'replace', tool_id: 'e1', parameters: { file_path: '/w/package.json' } });
  const build = n.push(deny('e1', 'Tool execution denied by policy. Modifying build configuration files requires explicit user confirmation'));
  assert.match(build.find((e) => e.type === 'stderr')?.text ?? '', /refused Edit on its own, not by a worca rule: in a run with no terminal it refuses edits to build files \(package\.json, lockfiles, Makefile, Dockerfile, …\)/);
  // worca's own rule: no such line.
  n.push({ type: 'tool_use', tool_name: 'run_shell_command', tool_id: 's2', parameters: { command: 'git log' } });
  assert.equal(n.push(deny('s2', 'Tool execution denied by policy. worca guardrail: Bash(git log:*)')).some((e) => e.type === 'stderr'), false);
});

test('normalizer: a relative file path is made absolute against the spawn\'s cwd (Gemini passes cwd-relative paths)', () => {
  const n = createGeminiNormalizer({ cwd: '/w/run' });
  const [e] = n.push({ type: 'tool_use', tool_name: 'write_file', tool_id: 't1', parameters: { file_path: 'src/b.txt', content: 'x' } });
  assert.deepEqual(e.calls[0].input, { file_path: '/w/run/src/b.txt', content: 'x' });
  const [d] = n.push({ type: 'tool_use', tool_name: 'list_directory', tool_id: 't2', parameters: { dir_path: '/abs' } });
  assert.deepEqual(d.calls[0].input, { dir_path: '/abs' });
});

test('normalizer: a server name with an underscore is matched whole when worca named it', () => {
  const n = createGeminiNormalizer({ mcpNames: ['github_work'] });
  const [e] = n.push({ type: 'tool_use', tool_name: 'mcp_github_work_get_issue', tool_id: 't1', parameters: { n: 1 } });
  assert.equal(e.calls[0].name, 'mcp__github_work__get_issue');
});

test('normalizer (capture): worca\'s own Read and Write refusals, which carry no rule text, are never called Gemini\'s own', () => {
  // The capture's TOML denied `git log`, read_file on secret.txt and write_file / replace on b.txt (fixtures README).
  const own = (opts) => replay('policy-denied.jsonl', opts).events.filter((e) => e.type === 'stderr' && /on its own/.test(e.text)).map((e) => e.text);
  assert.deepEqual(own({ ruleKinds: ['Bash', 'Read', 'Write', 'Edit', 'mcp', 'WebFetch'] }), []);
  // Without the spawn's rule kinds the same capture would name both refusals as Gemini's own.
  assert.equal(own({}).length, 2);
  // A build-file refusal is Gemini's own even with an Edit rule in the set.
  const n = createGeminiNormalizer({ ruleKinds: ['Edit'] });
  n.push({ type: 'tool_use', tool_name: 'replace', tool_id: 'e1', parameters: { file_path: '/w/package.json' } });
  const m = 'Tool execution denied by policy. Modifying build configuration files requires explicit user confirmation';
  assert.match(n.push({ type: 'tool_result', tool_id: 'e1', status: 'error', output: m, error: { type: 'policy_violation', message: m } })
    .find((e) => e.type === 'stderr')?.text ?? '', /refused Edit on its own/);
});

test('normalizer (capture): a policy denial is an error result naming the policy', () => {
  const { events } = replay('policy-denied.jsonl');
  const denied = events.filter((e) => e.type === 'toolResult').flatMap((e) => e.results).filter((r) => r.isError);
  assert.equal(denied.length, 3);
  for (const r of denied) assert.match(r.text, /denied by policy/);
});

test('normalizer (capture): an API error result fails the run as auth', () => {
  const { final } = replay('api-key-invalid.jsonl');
  assert.match(final.error, /API key not valid/);
  assert.equal(classifyGeminiError(final.error), 'auth');
});

test('error classes', () => {
  assert.equal(classifyGeminiError(fixture('signed-out.stderr.txt')), 'auth');
  assert.equal(classifyGeminiError('[API Error: {"error":{"code":401,"status":"UNAUTHENTICATED"}}]'), 'auth');
  assert.equal(classifyGeminiError('Quota exceeded for metric: generate_content_requests_per_day'), 'usage_limit');
  assert.equal(classifyGeminiError('429 RESOURCE_EXHAUSTED: Resource has been exhausted'), 'rate_limit');
  assert.equal(classifyGeminiError('fetch failed: ECONNRESET'), 'network');
  assert.equal(classifyGeminiError('something odd'), null);
});

test('unknown resume and a broken policy file are recognized from their captured stderr', () => {
  assert.match(fixture('resume-unknown.stderr.txt'), GEMINI_RESUME_NOT_FOUND_RE);
  assert.match(fixture('policy-error.stderr.txt'), GEMINI_POLICY_ERROR_RE);
});

test('capabilities: declared from the spike, cost is false', () => {
  assert.deepEqual(Object.keys(geminiCapabilities).sort(), [...CAPABILITY_KEYS].sort());
  assert.deepEqual(CAPABILITY_KEYS.filter((k) => geminiCapabilities[k] === false),
    ['systemPromptFlag', 'allowedTools', 'cost', 'subagents', 'hookTelemetry', 'skills', 'subagentSystemPrompt', 'turnBudget']);
  assert.ok(GEMINI_ASK_LOCKDOWN, 'Chat runs on Gemini CLI, locked down (plans/ask-on-qwen-gemini-spike.md)');
});

test('rule plan: shell, path, web and MCP tool rules held; command rules partial; the rest unenforced', () => {
  const p = geminiRulePlan({ deny: ['Bash', 'Bash(git push:*)', 'Bash(curl)', 'Read(./.env)', 'Edit(//etc/**)', 'WebFetch', 'WebSearch',
    'mcp__github__delete_repo', 'mcp__slack', 'WebFetch(domain:x.com)', 'NotebookEdit'] });
  // A path rule binds Gemini's own file tools; its shell reaching the path is the one baseline line of every shell
  // engine (decision 10), not a partial rule.
  assert.deepEqual(p.partial, ['Bash(git push:*)', 'Bash(curl)']);
  assert.deepEqual(p.unenforced, ['WebFetch(domain:x.com)', 'NotebookEdit']);
  assert.deepEqual(p.rules.map((r) => [r.toolName, r.commandPrefix, r.mcpName]), [
    ['run_shell_command', undefined, undefined],
    ['run_shell_command', 'git push', undefined],
    ['run_shell_command', 'curl', undefined],
    [['read_file', 'read_many_files'], undefined, undefined],
    [['write_file', 'replace'], undefined, undefined],
    ['web_fetch', undefined, undefined],
    ['google_web_search', undefined, undefined],
    ['delete_repo', undefined, 'github'],
    [undefined, undefined, 'slack'],
  ]);
  const env = new RegExp(p.rules[3].argsPattern);
  assert.ok(env.test('{"file_path":".env"}') && env.test('{"file_path":"/w/x/.env"}'));
  assert.ok(!env.test('{"file_path":"/w/x/.envrc"}'));
  const etc = new RegExp(p.rules[4].argsPattern);
  assert.ok(etc.test('{"content":"x","file_path":"/etc/hosts"}'));
  assert.ok(!etc.test('{"file_path":"/w/etc/hosts"}'));
});

test('policy TOML: one [[rule]] per rule, deny at the top of the admin tier, every string quoted', () => {
  const toml = geminiPolicyToml(geminiRulePlan({ deny: ['Bash(git push:*)', 'mcp__gh__x'] }).rules);
  assert.equal(toml, [
    '[[rule]]', 'toolName = "run_shell_command"', 'commandPrefix = "git push"', 'decision = "deny"', 'priority = 999',
    'denyMessage = "worca guardrail: Bash(git push:*)"', '',
    '[[rule]]', 'toolName = "x"', 'mcpName = "gh"', 'decision = "deny"', 'priority = 999', 'denyMessage = "worca guardrail: mcp__gh__x"', '',
  ].join('\n'));
});

test('preflight: missing binary refuses; no sign-in refuses; a key or a chosen sign-in passes', POSIX, async () => {
  assert.match((await geminiPreflight({ bin: join(tmp(), 'nope') })).refusal, /WORCA_GEMINI_BIN/);
  const fake = fakeGemini(tmp(), 'x');
  const home = tmp();
  assert.match((await geminiPreflight({ bin: fake.bin, env: { HOME: home } })).refusal, /not signed in/);
  assert.deepEqual(await geminiPreflight({ bin: fake.bin, env: { HOME: home, GEMINI_API_KEY: 'k' } }), {});
  mkdirSync(join(home, '.gemini'));
  writeFileSync(join(home, '.gemini', '.env'), 'export GEMINI_API_KEY=abc\n');
  assert.deepEqual(await geminiPreflight({ bin: fake.bin, env: { HOME: home } }), {});
  const oauth = tmp();
  mkdirSync(join(oauth, '.gemini'));
  writeFileSync(join(oauth, '.gemini', 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }));
  assert.deepEqual(await geminiPreflight({ bin: fake.bin, env: { HOME: oauth } }), {});
});

test('preflight: the sign-in its settings choose decides what the version check sees', POSIX, async () => {
  const dir = tmp();
  const bin = join(dir, 'gemini');
  writeFileSync(bin, '#!/bin/sh\nenv > "$0.env"\necho 0.0.1\n', { mode: 0o755 });
  const home = tmp();
  mkdirSync(join(home, '.gemini'));
  writeFileSync(join(home, '.gemini', 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }));
  assert.deepEqual(await geminiPreflight({ bin, env: { HOME: home, GEMINI_API_KEY: 'k-9f3a' } }), {});
  assert.doesNotMatch(readFileSync(`${bin}.env`, 'utf8'), /GEMINI_API_KEY/, 'a Google login keeps no key of worca\'s');
  rmSync(join(home, '.gemini', 'settings.json'));
  assert.deepEqual(await geminiPreflight({ bin, env: { HOME: home, GEMINI_API_KEY: 'k-9f3a' } }), {});
  assert.match(readFileSync(`${bin}.env`, 'utf8'), /^GEMINI_API_KEY=k-9f3a$/m, 'no setting: the catalog order picks the key');
});

test('spawn: the prompt on stdin with the system prompt folded in, the workspace trusted, the session named first', POSIX, async () => {
  const fake = fakeGemini(tmp(), 'done');
  const events = [];
  const r = await runGeminiProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go', systemPrompt: 'Be terse.', model: 'gemini-3.8-flash', onEvent: (e) => events.push(e) });
  assert.equal(r.text, 'done');
  const rec = fake.record();
  assert.match(rec.stdin, /^=== SYSTEM ===\n[\s\S]*Be terse\.[\s\S]*=== END SYSTEM ===\n\ngo$/);
  assert.equal(rec.env.GEMINI_CLI_TRUST_WORKSPACE, 'true');
  const a = rec.args;
  const id = a[a.indexOf('--session-id') + 1];
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(a[a.indexOf('--model') + 1], 'gemini-3.8-flash');
  assert.deepEqual(events[0], { type: 'session', sessionId: `gemini:${id}` });
  assert.equal(rec.gemini, null, 'no MCP: nothing in the checkout');
  assert.ok(a.includes(NO_MCP_SERVER), 'the user\'s own MCP servers stay off');
  assert.ok(!a.includes('--admin-policy'));
});

test('spawn: the run\'s Read rule makes a bare read_file refusal worca\'s, never "Gemini CLI on its own"', POSIX, async () => {
  const sid = '00000000-0000-4000-8000-0000000000e2';
  const m = 'Tool execution denied by policy.';
  const lines = [{ type: 'init', timestamp: 't', session_id: sid, model: 'auto' },
    { type: 'tool_use', timestamp: 't', tool_name: 'read_file', tool_id: 'r1', parameters: { file_path: 'secret.txt' } },
    { type: 'tool_result', timestamp: 't', tool_id: 'r1', status: 'error', output: m, error: { type: 'policy_violation', message: m } },
    ...geminiReplyLines('done', sid).slice(1)];
  const own = async (permissionRules) => {
    const events = [];
    await runGeminiProcess({ cwd: tmp(), bin: fakeGemini(tmp(), 'done', { lines }).bin, prompt: 'go', permissionRules, onEvent: (e) => events.push(e) });
    return events.filter((e) => e.type === 'stderr' && /on its own/.test(e.text)).length;
  };
  assert.equal(await own({ deny: ['Read(./secret.txt)'] }), 0);
  assert.equal(await own({ deny: [] }), 1, 'with no Read rule the same refusal is Gemini\'s own');
});

test('spawn: MCP servers go into <cwd>/.gemini/settings.json (refs, not secrets), hidden by info/exclude', POSIX, async () => {
  const cwd = tmp();
  execFileSync('git', ['init', '-q'], { cwd });
  const fake = fakeGemini(tmp(), 'ok');
  const mcp = join(tmp(), 'mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: {
    gh: { command: 'gh-mcp', args: ['--x'], env: { GITHUB_TOKEN: '${MCPSECRET_GH}' } },
    web: { type: 'http', url: 'https://m/mcp', headers: { Authorization: 'Bearer ${MCPSECRET_W}' } },
  } }));
  await runGeminiProcess({ cwd, bin: fake.bin, prompt: 'go', mcpConfigPath: mcp, spawnEnv: { MCPSECRET_GH: 's3cret', MCPSECRET_W: 'w' } });
  const rec = fake.record();
  assert.deepEqual(JSON.parse(rec.gemini), { mcpServers: {
    gh: { command: 'gh-mcp', args: ['--x'], env: { GITHUB_TOKEN: '${MCPSECRET_GH}' } },
    web: { httpUrl: 'https://m/mcp', headers: { Authorization: 'Bearer ${MCPSECRET_W}' } },
  } });
  assert.equal(rec.env.MCPSECRET_GH, 's3cret');
  const a = rec.args;
  assert.deepEqual(a.filter((x, i) => a[i - 1] === '--allowed-mcp-server-names'), ['gh', 'web']);
  assert.match(readFileSync(join(cwd, '.git', 'info', 'exclude'), 'utf8'), /^\/\.gemini\/settings\.json$/m);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }), '');
  assert.equal(projectFileOwned('gemini', join(cwd, '.gemini', 'settings.json')), true);
  await runGeminiProcess({ cwd, bin: fake.bin, prompt: 'go' });
  assert.ok(!existsSync(join(cwd, '.gemini', 'settings.json')), 'a later spawn without servers removes worca\'s file');
});

test('spawn: a tracked .gemini/settings.json is never changed — a spawn with MCP servers refuses', POSIX, async () => {
  const cwd = tmp();
  execFileSync('git', ['init', '-q'], { cwd });
  mkdirSync(join(cwd, '.gemini'));
  writeFileSync(join(cwd, '.gemini', 'settings.json'), '{}');
  execFileSync('git', ['add', '.gemini/settings.json'], { cwd });
  const fake = fakeGemini(tmp(), 'x');
  const mcp = join(tmp(), 'mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { gh: { command: 'gh-mcp' } } }));
  await assert.rejects(runGeminiProcess({ cwd, bin: fake.bin, prompt: 'go', mcpConfigPath: mcp }), /tracks \.gemini\/settings\.json/);
  assert.equal(fake.record(), null, 'nothing spawned');
});

test('spawn: deny rules ride an --admin-policy file outside the checkout, removed after', POSIX, async () => {
  const cwd = tmp();
  const fake = fakeGemini(tmp(), 'ok');
  await runGeminiProcess({ cwd, bin: fake.bin, prompt: 'go', permissionRules: { deny: ['Bash(git push:*)'] } });
  const rec = fake.record();
  const file = rec.args[rec.args.indexOf('--admin-policy') + 1];
  assert.ok(!file.startsWith(cwd));
  assert.match(rec.policy, /commandPrefix = "git push"/);
  assert.ok(!existsSync(file), 'the policy file is removed after the spawn');
});

test('spawn: a policy file Gemini rejects stops the run (it would run with no rule)', POSIX, async () => {
  const fake = fakeGemini(tmp(), 'ok', { stderr: fixture('policy-error.stderr.txt') });
  await assert.rejects(runGeminiProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go', permissionRules: { deny: ['Bash'] } }), /policy file/i);
});

test('spawn: folders worca hands the agent are workspace folders; one inside Worca\'s home is refused', POSIX, async () => {
  const fake = fakeGemini(tmp(), 'ok');
  const out = tmp();
  await runGeminiProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go', addDirs: [out] });
  assert.equal(fake.args()[fake.args().indexOf('--include-directories') + 1], out);
  const inHome = join(worcaHome(), 'plugins');
  await assert.rejects(runGeminiProcess({ cwd: tmp(), bin: fakeGemini(tmp(), 'ok').bin, prompt: 'go', writableDirs: [inHome] }), /inside Worca's home/);
});

test('spawn: a folder in the run store brings its project\'s store folder, so plans and earlier outputs are readable', POSIX, async () => {
  const fake = fakeGemini(tmp(), 'ok');
  const project = join(worcaHome(), 'store', 'proj-1a2b3c4d');
  const memory = join(project, 'pipelines', 'run-1', 'memory');
  mkdirSync(memory, { recursive: true });
  await runGeminiProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go', addDirs: [memory] });
  const a = fake.args();
  assert.deepEqual(a.filter((x, i) => a[i - 1] === '--include-directories'), [memory, project]);
});

test('spawn: the run env reaches Gemini only as the values its own servers reference', POSIX, async () => {
  const cwd = tmp();
  execFileSync('git', ['init', '-q'], { cwd });
  const fake = fakeGemini(tmp(), 'ok');
  const mcp = join(tmp(), 'mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { gh: { command: 'gh-mcp', env: { GITHUB_TOKEN: '${MCPSECRET_GH}', HOST: '$MCPCHILD_H' } } } }));
  await runGeminiProcess({ cwd, bin: fake.bin, prompt: 'go', mcpConfigPath: mcp,
    spawnEnv: { MCPSECRET_GH: 's3cret', MCPCHILD_H: 'h', MCPSECRET_OTHER: 'o', GIT_CEILING_DIRECTORIES: '/r' } });
  const env = fake.env();
  assert.equal(env.MCPSECRET_GH, 's3cret');
  assert.equal(env.MCPCHILD_H, 'h');
  assert.equal(env.MCPSECRET_OTHER, undefined, 'a registry secret no attached server names never reaches its shell');
  assert.equal(env.GIT_CEILING_DIRECTORIES, '/r', 'the git ceiling of a run without a project still does');
});

test('sign-in: the one its settings choose wins, so worca\'s key does not reach a Google login', POSIX, async () => {
  const home = tmp();
  mkdirSync(join(home, '.gemini'));
  writeFileSync(join(home, '.gemini', 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }));
  const fake = fakeGemini(tmp(), 'ok');
  const keep = { ...process.env };
  try {
    Object.assign(process.env, { HOME: home, GEMINI_API_KEY: 'worca-key' });
    delete process.env.GEMINI_CLI_HOME;
    await runGeminiProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go' });
    assert.equal(fake.env().GEMINI_API_KEY, undefined);
    writeFileSync(join(home, '.gemini', 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } } }));
    await runGeminiProcess({ cwd: tmp(), bin: fake.bin, prompt: 'go' });
    assert.equal(fake.env().GEMINI_API_KEY, 'worca-key');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
  }
});

test('a read-only spawn refuses (an Ask spawn is test/gemini-ask-adapter.test.mjs)', async () => {
  await assert.rejects(runGeminiProcess({ cwd: tmp(), bin: '/nonexistent', prompt: 'x', sandbox: 'read-only' }), /read-only/);
});

test('resume: a gemini: session resumes it; a foreign one starts fresh and says so', POSIX, async () => {
  const fake = fakeGemini(tmp(), 'ok');
  await runGeminiProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x', resumeSessionId: 'gemini:8f1c0000-0000-4000-8000-000000000009' });
  assert.equal(fake.args()[fake.args().indexOf('--resume') + 1], '8f1c0000-0000-4000-8000-000000000009');
  for (const id of ['codex:th-1', 'gemini:-oProxyCommand=x']) {
    const events = [];
    await runGeminiProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x', resumeSessionId: id, onEvent: (e) => events.push(e) });
    assert.ok(!fake.args().includes('--resume'), id);
    assert.ok(!fake.args().includes('-oProxyCommand=x'), id);
    assert.ok(events.some((e) => e.type === 'stderr' && /not a Gemini CLI session/.test(e.text)), id);
  }
});

test('resume: a session Gemini no longer knows starts a fresh one and says so', POSIX, async () => {
  const fake = fakeGemini(tmp(), 'fresh', { resumeError: fixture('resume-unknown.stderr.txt').trim().split('\n')[0], resumeExit: 42 });
  const events = [];
  const r = await runGeminiProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x', resumeSessionId: 'gemini:8f1c0000-0000-4000-8000-000000000009', onEvent: (e) => events.push(e) });
  assert.equal(r.text, 'fresh');
  assert.ok(fake.args().includes('--session-id'));
  assert.ok(events.some((e) => e.type === 'stderr' && /is gone/.test(e.text)));
});

test('an error result rejects with its errorClass', POSIX, async () => {
  const fake = fakeGemini(tmp(), null, { lines: frames('api-key-invalid.jsonl'), exit: 1 });
  await assert.rejects(runGeminiProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x' }), (err) => err.errorClass === 'auth');
});

test('maxTurns caps the main agent\'s tool calls', POSIX, async () => {
  const fake = fakeGemini(tmp(), null, { lines: frames('shell-write-failed-read.jsonl') });
  await assert.rejects(runGeminiProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x', maxTurns: 2 }), (err) => err.turnCap === true);
});

test('fake reply lines are a valid run (helper sanity)', () => {
  const n = createGeminiNormalizer();
  for (const l of geminiReplyLines('hi')) n.push(l);
  assert.deepEqual(n.finish(), { text: 'hi', error: null });
});
