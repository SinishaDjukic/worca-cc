// test/cursor-adapter.test.mjs — the Cursor CLI adapter: argv, the stream-json normalizer against the
// hand-written fixtures (test/fixtures/cursor), the rule plan, error classes, preflight and the spawn path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, statSync, symlinkSync, readdirSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCursorArgs, createCursorNormalizer, classifyCursorError, cursorChatOf, CURSOR_SESSION_PREFIX,
  cursorRulePlan, cursorCapabilities, cursorPreflight, runCursorProcess, CURSOR_ASK_LOCKDOWN, cursorMcpDocument,
  cursorOwns, excludeLine, parseCursorStatus,
} from '../src/core/engines/cursor.mjs';
import { EVENT_TYPES, isNormalized } from '../src/core/engines/events.mjs';
import { CAPABILITY_KEYS } from '../src/core/engines/capabilities.mjs';
import { fakeCursor } from './helpers/fake-cursor.mjs';

const FIX = new URL('./fixtures/cursor/', import.meta.url);
const frames = (name) => readFileSync(new URL(name, FIX), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-cursor-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const replay = (name, opts) => { const n = createCursorNormalizer(opts); return { events: frames(name).flatMap((f) => n.push(f)), final: n.finish() }; };

test('fresh run: print mode, stream-json, --force, the prompt last', () => {
  assert.deepEqual(buildCursorArgs({ prompt: 'hi' }), ['-p', '--output-format', 'stream-json', '--force', 'hi']);
});

test('model, resume and MCP approval', () => {
  assert.deepEqual(buildCursorArgs({ prompt: 'x', model: 'sonnet-4.5', resumeChatId: 'c-1', approveMcps: true }),
    ['-p', '--output-format', 'stream-json', '--force', '--approve-mcps', '--model', 'sonnet-4.5', '--resume', 'c-1', 'x']);
});

test('session ids are engine-qualified; a codex or claude id is not a Cursor chat', () => {
  assert.equal(CURSOR_SESSION_PREFIX, 'cursor:');
  assert.equal(cursorChatOf('cursor:abc'), 'abc');
  assert.equal(cursorChatOf('codex:abc'), null);
  assert.equal(cursorChatOf('8f1c0000-0000-4000-8000-000000000000'), null);
});

test('normalizer: session, text, Bash and Write rows, a result with no cost', () => {
  const { events, final } = replay('shell-and-write.jsonl');
  for (const e of events) assert.ok(EVENT_TYPES.has(e.type) && isNormalized(e), JSON.stringify(e));
  assert.deepEqual(events[0], { type: 'session', sessionId: 'cursor:00000000-0000-4000-8000-0000000000c1', model: 'Auto', init: true });
  const tools = events.filter((e) => e.type === 'tool').flatMap((e) => e.calls);
  assert.deepEqual(tools.map((c) => [c.name, c.input]), [['Bash', { command: 'cat a.txt' }], ['Write', { file_path: 'b.txt' }]]);
  const results = events.filter((e) => e.type === 'toolResult').flatMap((e) => e.results);
  assert.deepEqual(results.map((r) => [r.toolUseId, r.isError, r.text]), [['call_1', false, 'hello\n'], ['call_2', false, '/work/b.txt']]);
  const result = events.find((e) => e.type === 'result');
  assert.equal(result.isError, false);
  assert.ok(!('costUsd' in result), 'Cursor reports no cost: never a $0.00');
  assert.equal(final.error, null);
});

test('normalizer: MCP call named mcp__server__tool, a rejected read is an error result, function tools pass through', () => {
  const { events } = replay('mcp-and-failed-read.jsonl');
  const calls = events.filter((e) => e.type === 'tool').flatMap((e) => e.calls).map((c) => c.name);
  assert.deepEqual(calls, ['mcp__github__get_issue', 'Read', 'todo_write']);
  const read = events.filter((e) => e.type === 'toolResult').flatMap((e) => e.results).find((r) => r.toolUseId === 'call_2');
  assert.equal(read.isError, true);
  assert.match(read.text, /denied by permissions/);
  assert.deepEqual(events.find((e) => e.type === 'result').usage, { input_tokens: 1200, output_tokens: 40 });
});

test('an is_error result fails the run with its class', () => {
  const { final } = replay('error-result.jsonl');
  assert.match(final.error, /usage limit/);
  assert.equal(classifyCursorError(final.error), 'usage_limit');
});

test('error classes', () => {
  assert.equal(classifyCursorError('Authentication required. Please run cursor-agent login'), 'auth');
  assert.equal(classifyCursorError('401 Unauthorized'), 'auth');
  assert.equal(classifyCursorError('429 Too Many Requests'), 'rate_limit');
  assert.equal(classifyCursorError('fetch failed: ECONNRESET'), 'network');
  assert.equal(classifyCursorError('something odd'), null);
});

test('capabilities: declared honestly, cost is false', () => {
  assert.deepEqual(Object.keys(cursorCapabilities).sort(), [...CAPABILITY_KEYS].sort());
  assert.deepEqual(CAPABILITY_KEYS.filter((k) => cursorCapabilities[k] === false),
    ['systemPromptFlag', 'allowedTools', 'effort', 'cost', 'subagents', 'hookTelemetry', 'skills', 'subagentSystemPrompt', 'turnBudget']);
  assert.equal(CURSOR_ASK_LOCKDOWN, null);
});

test('rule plan: single-word commands and path rules are partial, the rest unenforced', () => {
  const p = cursorRulePlan({ deny: ['Bash', 'Bash(curl)', 'Bash(curl:*)', 'Bash(git push:*)', 'Read(./.env)', 'Read(/src/secret.txt)', 'Edit(//etc/**)', 'Read(~/.ssh/**)', 'WebFetch', 'mcp__github__delete_repo'] });
  assert.deepEqual(p.deny, ['Shell(*)', 'Shell(curl)', 'Read(./.env)', 'Read(./src/secret.txt)', 'Write(/etc/**)', 'Read(~/.ssh/**)']);
  assert.deepEqual(p.partial, ['Bash', 'Bash(curl)', 'Bash(curl:*)', 'Read(./.env)', 'Read(/src/secret.txt)', 'Edit(//etc/**)', 'Read(~/.ssh/**)']);
  assert.deepEqual(p.unenforced, ['Bash(git push:*)', 'WebFetch', 'mcp__github__delete_repo']);
});

test('preflight: missing binary refuses; signed out refuses; CURSOR_API_KEY accepts; signed in passes', POSIX, async () => {
  assert.match((await cursorPreflight({ bin: join(tmp(), 'nope') })).refusal, /WORCA_CURSOR_BIN/);
  const out = fakeCursor(tmp(), 'x', { statusText: 'Not logged in', statusExit: 1 });
  assert.match((await cursorPreflight({ bin: out.bin, env: {} })).refusal, /not signed in/);
  assert.deepEqual(await cursorPreflight({ bin: out.bin, env: { CURSOR_API_KEY: 'k' } }), {});
  assert.deepEqual(await cursorPreflight({ bin: fakeCursor(tmp(), 'x').bin, env: {} }), {});
});

test('spawn: rules and MCP land in <cwd>/.cursor, hidden by info/exclude; reply text and session come back', POSIX, async () => {
  const cwd = tmp();   // on macOS tmpdir() is under /var → /private/var: the exclude line must not depend on realpaths
  execFileSync('git', ['init', '-q'], { cwd });
  const fake = fakeCursor(tmp(), 'done');
  const mcp = join(tmp(), 'mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { gh: { command: 'gh-mcp', args: [], env: { GITHUB_TOKEN: '${MCPSECRET_GH}' } } } }));
  const events = [];
  const r = await runCursorProcess({ cwd, bin: fake.bin, prompt: 'go', systemPrompt: 'Be terse.', mcpConfigPath: mcp,
    permissionRules: { deny: ['Bash(curl)'] }, spawnEnv: { MCPSECRET_GH: 's3cret' }, onEvent: (e) => events.push(e) });
  assert.equal(r.text, 'done');
  const rec = fake.record();
  assert.deepEqual(JSON.parse(rec.cli), { permissions: { deny: ['Shell(curl)'] } });
  assert.deepEqual(JSON.parse(rec.mcp).mcpServers.gh.env, { GITHUB_TOKEN: '${env:MCPSECRET_GH}' }, 'no secret value on disk');
  assert.equal(rec.env.MCPSECRET_GH, 's3cret');
  assert.ok(rec.args.includes('--approve-mcps'));
  assert.match(rec.args.at(-1), /^=== SYSTEM ===\n[\s\S]*Be terse\.[\s\S]*=== END SYSTEM ===\n\ngo$/);
  const exclude = readFileSync(join(cwd, '.git', 'info', 'exclude'), 'utf8');
  assert.match(exclude, /^\/\.cursor\/cli\.json$/m);
  assert.match(exclude, /^\/\.cursor\/mcp\.json$/m);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }), '');
  assert.ok(events.some((e) => e.type === 'session' && e.sessionId === 'cursor:00000000-0000-4000-8000-0000000000ca' && !e.init));
});

test('spawn: in a subdirectory of the work tree the exclude line carries the prefix', POSIX, async () => {
  const top = tmp();
  execFileSync('git', ['init', '-q'], { cwd: top });
  const cwd = join(top, 'pkg');
  mkdirSync(cwd);
  await runCursorProcess({ cwd, bin: fakeCursor(tmp(), 'ok').bin, prompt: 'go', permissionRules: { deny: ['Bash'] } });
  assert.match(readFileSync(join(top, '.git', 'info', 'exclude'), 'utf8'), /^\/pkg\/\.cursor\/cli\.json$/m);
});

test('spawn: a tracked .cursor/cli.json is never overwritten — the spawn refuses', POSIX, async () => {
  const cwd = tmp();
  execFileSync('git', ['init', '-q'], { cwd });
  mkdirSync(join(cwd, '.cursor'));
  writeFileSync(join(cwd, '.cursor', 'cli.json'), '{"permissions":{"deny":[]}}');
  execFileSync('git', ['add', '.cursor/cli.json'], { cwd });
  const fake = fakeCursor(tmp(), 'x');
  await assert.rejects(runCursorProcess({ cwd, bin: fake.bin, prompt: 'go', permissionRules: { deny: ['Bash(curl)'] } }), /tracks \.cursor\/cli\.json/);
  assert.equal(fake.record(), null, 'nothing spawned');
  assert.equal(readFileSync(join(cwd, '.cursor', 'cli.json'), 'utf8'), '{"permissions":{"deny":[]}}');
});

test('spawn: no rules and no MCP write nothing into the checkout', POSIX, async () => {
  const cwd = tmp();
  const fake = fakeCursor(tmp(), 'ok');
  await runCursorProcess({ cwd, bin: fake.bin, prompt: 'go' });
  assert.ok(!existsSync(join(cwd, '.cursor')));
  assert.ok(!fake.args().includes('--approve-mcps'));
});

test('read-only and Ask spawns refuse: Cursor cannot switch its shell or file tools off', async () => {
  await assert.rejects(runCursorProcess({ cwd: tmp(), bin: '/nonexistent', prompt: 'x', sandbox: 'read-only' }), /read-only/);
  await assert.rejects(runCursorProcess({ cwd: tmp(), bin: '/nonexistent', prompt: 'x', askLockdown: true }), /Ask on Cursor is unavailable/);
});

test('a foreign stored session starts a fresh chat and says so', POSIX, async () => {
  const fake = fakeCursor(tmp(), 'ok');
  const events = [];
  await runCursorProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x', resumeSessionId: 'codex:th-1', onEvent: (e) => events.push(e) });
  assert.ok(!fake.args().includes('--resume'));
  assert.ok(events.some((e) => e.type === 'stderr' && /not a Cursor chat/.test(e.text)));
});

test('a cursor: session resumes that chat', POSIX, async () => {
  const fake = fakeCursor(tmp(), 'ok');
  await runCursorProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x', resumeSessionId: 'cursor:chat-9' });
  const a = fake.args();
  assert.equal(a[a.indexOf('--resume') + 1], 'chat-9');
});

test('an is_error result rejects with its errorClass', POSIX, async () => {
  const fake = fakeCursor(tmp(), null, { fail: "You've hit your usage limit" });
  await assert.rejects(runCursorProcess({ cwd: tmp(), bin: fake.bin, prompt: 'x' }), (err) => err.errorClass === 'usage_limit');
});

test('a prompt over the argv limit is staged to a file the positional points at, and removed after', POSIX, async () => {
  const fake = fakeCursor(tmp(), 'ok');
  await runCursorProcess({ cwd: tmp(), bin: fake.bin, prompt: 'y'.repeat(200_000) });
  const last = fake.args().at(-1);
  const file = /read the whole file (\S+) first/.exec(last)?.[1];
  assert.ok(file && last.length < 1000, last.slice(0, 200));
  assert.ok(!existsSync(file), 'staged prompt removed');
});

test('cursorMcpDocument rewrites ${VAR} to ${env:VAR} in every string: env, args, url, headers', () => {
  const doc = cursorMcpDocument({
    a: { command: 'x', args: ['--token', '${MCPSECRET_A}'], env: { K: '${V}', L: 'plain' } },
    r: { type: 'http', url: 'https://m/x?k=${MCPSECRET_Q}', headers: { Authorization: 'Bearer ${MCPSECRET_R}' } },
  });
  assert.deepEqual(doc, { mcpServers: {
    a: { command: 'x', args: ['--token', '${env:MCPSECRET_A}'], env: { K: '${env:V}', L: 'plain' } },
    r: { type: 'http', url: 'https://m/x?k=${env:MCPSECRET_Q}', headers: { Authorization: 'Bearer ${env:MCPSECRET_R}' } },
  } });
});

test('spawn: the .cursor files are readable by an agent-user spawn (0644: they hold no secret values)', POSIX, async () => {
  const cwd = tmp();
  await runCursorProcess({ cwd, bin: fakeCursor(tmp(), 'ok').bin, prompt: 'go', permissionRules: { deny: ['Bash'] } });
  assert.equal(statSync(join(cwd, '.cursor', 'cli.json')).mode & 0o777, 0o644);
});

test('spawn: a .cursor file an earlier spawn needed and this one does not is removed', POSIX, async () => {
  const cwd = tmp();
  execFileSync('git', ['init', '-q'], { cwd });
  const fake = fakeCursor(tmp(), 'ok');
  await runCursorProcess({ cwd, bin: fake.bin, prompt: 'go', permissionRules: { deny: ['Bash'] } });
  assert.ok(existsSync(join(cwd, '.cursor', 'cli.json')));
  await runCursorProcess({ cwd, bin: fake.bin, prompt: 'go' });
  assert.equal(fake.record().cli, null, 'the second spawn saw no deny file');
  assert.ok(!existsSync(join(cwd, '.cursor', 'cli.json')));
});

test('ownership: a .cursor file worca did not write is never removed, outside git too (the cwd may be $HOME)', POSIX, async () => {
  const cwd = tmp();                                   // not a git tree
  mkdirSync(join(cwd, '.cursor'));
  writeFileSync(join(cwd, '.cursor', 'mcp.json'), '{"mcpServers":{"mine":{"command":"x"}}}');
  const fake = fakeCursor(tmp(), 'ok');
  await runCursorProcess({ cwd, bin: fake.bin, prompt: 'go' });
  await runCursorProcess({ cwd, bin: fake.bin, prompt: 'go', permissionRules: { deny: ['Bash'] } });
  assert.equal(readFileSync(join(cwd, '.cursor', 'mcp.json'), 'utf8'), '{"mcpServers":{"mine":{"command":"x"}}}');
  assert.equal(cursorOwns(join(cwd, '.cursor', 'mcp.json')), false);
  assert.equal(cursorOwns(join(cwd, '.cursor', 'cli.json')), true, 'the file worca wrote is in the ledger');
});

test('ownership: a spawn that needs a path holding someone else\'s file refuses, and the file is unchanged', POSIX, async () => {
  const cwd = tmp();
  execFileSync('git', ['init', '-q'], { cwd });
  mkdirSync(join(cwd, '.cursor'));
  writeFileSync(join(cwd, '.cursor', 'cli.json'), '{"permissions":{"deny":["Shell(rm)"]}}');   // untracked, the user's
  const fake = fakeCursor(tmp(), 'x');
  await assert.rejects(runCursorProcess({ cwd, bin: fake.bin, prompt: 'go', permissionRules: { deny: ['Bash(curl)'] } }), /worca did not write it/);
  assert.equal(fake.record(), null, 'nothing spawned');
  assert.equal(readFileSync(join(cwd, '.cursor', 'cli.json'), 'utf8'), '{"permissions":{"deny":["Shell(rm)"]}}');
});

test('ownership: an edited worca file is no longer worca\'s', POSIX, async () => {
  const cwd = tmp();
  await runCursorProcess({ cwd, bin: fakeCursor(tmp(), 'ok').bin, prompt: 'go', permissionRules: { deny: ['Bash'] } });
  const file = join(cwd, '.cursor', 'cli.json');
  assert.equal(cursorOwns(file), true);
  writeFileSync(file, '{"permissions":{"deny":[]}}');
  assert.equal(cursorOwns(file), false);
  assert.equal(cursorOwns(join(cwd, '.cursor', 'absent.json')), true, 'an absent file has nothing to protect');
});

test('a symlinked .cursor is refused and never written or cleaned through (it may point at ~/.cursor)', POSIX, async () => {
  const cwd = tmp();
  execFileSync('git', ['init', '-q'], { cwd });
  const elsewhere = tmp();
  symlinkSync(elsewhere, join(cwd, '.cursor'));
  const fake = fakeCursor(tmp(), 'x');
  await assert.rejects(runCursorProcess({ cwd, bin: fake.bin, prompt: 'go', permissionRules: { deny: ['Bash(curl)'] } }), /is a symlink/);
  assert.equal(fake.record(), null, 'nothing spawned');
  assert.deepEqual(readdirSync(elsewhere), [], 'nothing written at the link target');
  writeFileSync(join(elsewhere, 'cli.json'), '{}');
  await runCursorProcess({ cwd, bin: fake.bin, prompt: 'go' });
  assert.deepEqual(readdirSync(elsewhere), ['cli.json'], 'a spawn with no config removes nothing through the link');
});

test('a failed rewrite keeps the old file worca\'s and leaves no temp file', POSIX, async () => {
  const cwd = tmp();
  const bin = fakeCursor(tmp(), 'ok').bin;
  await runCursorProcess({ cwd, bin, prompt: 'go', permissionRules: { deny: ['Bash'] } });
  const dir = join(cwd, '.cursor');
  chmodSync(dir, 0o555);
  try {
    await assert.rejects(runCursorProcess({ cwd, bin, prompt: 'go', permissionRules: { deny: ['Bash(curl)'] } }), /EACCES/);
  } finally { chmodSync(dir, 0o755); }
  assert.equal(cursorOwns(join(dir, 'cli.json')), true, 'the old content is still in the ledger');
  assert.deepEqual(readdirSync(dir), ['cli.json']);
});

test('status: "not authenticated" reads as signed out', () => {
  assert.equal(parseCursorStatus({ code: 1, stdout: 'You are not authenticated' }), false);
  assert.equal(parseCursorStatus({ code: 0, stdout: 'Authenticated as a@b.c' }), true);
});

test('the .cursor dir is traversable by another uid (0755), and exclude lines escape glob characters', POSIX, async () => {
  const cwd = tmp();
  await runCursorProcess({ cwd, bin: fakeCursor(tmp(), 'ok').bin, prompt: 'go', permissionRules: { deny: ['Bash'] } });
  assert.equal(statSync(join(cwd, '.cursor')).mode & 0o777, 0o755);
  assert.equal(excludeLine('a[1]/b*?/', '.cursor/cli.json'), '/a\\[1\\]/b\\*\\?/.cursor/cli.json');
  assert.equal(excludeLine('', '.cursor/cli.json'), '/.cursor/cli.json');
});

test('normalizer: usage is passed on only as numeric Claude-style token counts', () => {
  const n = createCursorNormalizer();
  n.push({ type: 'system', subtype: 'init', session_id: 's' });
  const [r] = n.push({ type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 5, output_tokens: 'x', inputTokens: 9 } });
  assert.deepEqual(r.usage, { input_tokens: 5 });
});
