// test/cursor-adapter.test.mjs — the Cursor CLI adapter: argv, the stream-json normalizer against the
// hand-written fixtures (test/fixtures/cursor), the rule plan, error classes, preflight and the spawn path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, statSync, symlinkSync, readdirSync, chmodSync, lstatSync } from 'node:fs';
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
  const p = cursorRulePlan({ deny: ['Bash', 'Bash(curl)', 'Bash(curl:*)', 'Bash(git push:*)', 'Read(./.env)', 'Read(/src/secret.txt)', 'Edit(//etc/**)', 'Read(~/.ssh/**)', 'WebFetch', 'mcp__github__delete_repo'] }, { platform: 'linux' });
  assert.deepEqual(p.deny, ['Shell(*)', 'Shell(curl)', 'Read(**/.env)', 'Read(**/src/secret.txt)', 'Write(/etc/**)', 'Read(~/.ssh/**)']);
  assert.deepEqual(p.partial, ['Bash', 'Bash(curl)', 'Bash(curl:*)', 'Read(./.env)', 'Read(/src/secret.txt)', 'Edit(//etc/**)', 'Read(~/.ssh/**)']);
  assert.deepEqual(p.unenforced, ['Bash(git push:*)', 'WebFetch', 'mcp__github__delete_repo']);
});

// Cursor 2026.11.11 (index.js `fe`): a deny glob is an anchored regex, `*` any characters, every other character literal,
// tested against the path.resolve()d absolute path with its native separators.
const cursorMatches = (glob, path) => new RegExp(`^${glob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')}$`).test(path);
const globOf = (token) => /^\w+\((.*)\)$/.exec(token)[1];

test('rule plan: on Windows, // and ~/ path rules are written with backslashes, so they match a C:\\ path', () => {
  const rules = ['Read(//**/.env*)', 'Edit(//**/secrets.json)', 'Edit(//etc/**)', 'Read(~/.ssh/**)'];
  const p = cursorRulePlan({ deny: rules }, { platform: 'win32' });
  assert.deepEqual(p.deny, [String.raw`Read(**\.env*)`, String.raw`Write(**\secrets.json)`, String.raw`Write(*:\etc\**)`, String.raw`Read(~\.ssh\**)`]);
  assert.deepEqual(p.partial, rules);
  const [env, secrets, etc, ssh] = p.deny.map(globOf);
  for (const v of [String.raw`C:\repo\sub\.env.local`, String.raw`D:\w\.env`, String.raw`\\server\share\.env`]) assert.ok(cursorMatches(env, v), v);
  assert.ok(!cursorMatches(env, String.raw`C:\repo\environment.md`));
  assert.ok(cursorMatches(secrets, String.raw`C:\w\plugins\p\data\secrets.json`));
  assert.ok(cursorMatches(etc, String.raw`C:\etc\hosts`) && !cursorMatches(etc, String.raw`C:\w\etc\hosts`));
  // Cursor expands a leading `~` before `/` or `\` to the home.
  assert.ok(cursorMatches(ssh.replace(/^~/, String.raw`C:\Users\zed`), String.raw`C:\Users\zed\.ssh\id_ed25519`));
  // The POSIX form never matches a Windows path, which is why win32 gets its own.
  assert.ok(!cursorMatches(globOf(cursorRulePlan({ deny: ['Read(//**/.env*)'] }, { platform: 'linux' }).deny[0]), String.raw`C:\repo\.env`));
});

test('rule plan: off Windows, a //**/ rule stays one absolute POSIX glob', () => {
  const p = cursorRulePlan({ deny: ['Read(//**/.env*)'] }, { platform: 'darwin' });
  assert.deepEqual(p.deny, ['Read(/**/.env*)']);
  assert.ok(cursorMatches(globOf(p.deny[0]), '/w/repo/.env'));
});

test('rule plan: /rel, ./rel and bare rules match the resolved path inside the checkout; ../ stays unenforced', () => {
  const rules = ['Read(/src/secret.txt)', 'Read(./.env)', 'Edit(*.pem)', 'Read(**/id_rsa)', 'Read(../sibling/x)', 'Read(./)'];
  const posix = cursorRulePlan({ deny: rules }, { platform: 'linux' });
  assert.deepEqual(posix.deny, ['Read(**/src/secret.txt)', 'Read(**/.env)', 'Write(**/*.pem)', 'Read(**/id_rsa)']);
  assert.deepEqual(posix.unenforced, ['Read(../sibling/x)', 'Read(./)']);
  const [secret, env, pem, key] = posix.deny.map(globOf);
  assert.ok(cursorMatches(secret, '/w/checkout/src/secret.txt') && !cursorMatches(secret, '/w/checkout/src/secret.txt.md'));
  assert.ok(cursorMatches(env, '/w/checkout/.env') && !cursorMatches(env, '/w/checkout/.envrc'));
  assert.ok(cursorMatches(pem, '/w/checkout/certs/a.pem') && cursorMatches(key, '/w/checkout/.ssh/id_rsa'));
  // The glob as Claude writes it never matches Cursor's absolute path: why it is rewritten.
  assert.ok(!cursorMatches('./.env', '/w/checkout/.env') && !cursorMatches('src/secret.txt', '/w/checkout/src/secret.txt'));
  const win = cursorRulePlan({ deny: rules }, { platform: 'win32' });
  assert.deepEqual(win.deny, [String.raw`Read(**\src\secret.txt)`, String.raw`Read(**\.env)`, String.raw`Write(**\*.pem)`, String.raw`Read(**\id_rsa)`]);
  assert.ok(cursorMatches(globOf(win.deny[0]), String.raw`C:\w\checkout\src\secret.txt`));
  assert.ok(cursorMatches(globOf(win.deny[1]), String.raw`C:\w\checkout\.env`));
});

test('rule plan: a ? (one character) is written as *, since Cursor reads ? as a literal question mark', () => {
  const rules = ['Read(//**/id_rsa?)', 'Read(//etc/ssh/ssh_host_?sa_key)', 'Read(~/.aws/credential?)', 'Read(conf/a?.json)'];
  const hits = {
    linux: ['/w/repo/id_rsa2', '/etc/ssh/ssh_host_rsa_key', null, '/w/checkout/conf/a1.json'],
    win32: [String.raw`C:\w\repo\id_rsa2`, String.raw`C:\etc\ssh\ssh_host_rsa_key`, String.raw`C:\Users\zed\.aws\credentials`, String.raw`C:\w\checkout\conf\a1.json`],
  };
  for (const [platform, paths] of Object.entries(hits)) {
    const deny = cursorRulePlan({ deny: rules }, { platform }).deny.map(globOf);
    assert.ok(deny.every((g) => !g.includes('?')), `${platform}: ${deny.join(' ')}`);
    paths.forEach((v, i) => { if (v) assert.ok(cursorMatches(deny[i].replace(/^~/, String.raw`C:\Users\zed`), v), `${platform}: ${rules[i]} must deny ${v}`); });
  }
  // Written as is, the ? never matched: why it is rewritten.
  assert.ok(!cursorMatches('/etc/ssh/ssh_host_?sa_key', '/etc/ssh/ssh_host_rsa_key'));
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
  assert.deepEqual(JSON.parse(rec.cli), { permissions: { allow: [], deny: ['Shell(curl)'] } });
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
  await assert.rejects(runCursorProcess({ cwd: tmp(), bin: '/nonexistent', prompt: 'x', askLockdown: true }), /Chat on Cursor is unavailable/);
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

test('G14: deny rules the agent edits during a spawn are restored when it ends, and the next spawn sees worca\'s copy', POSIX, async () => {
  const cwd = tmp();
  execFileSync('git', ['init', '-q'], { cwd });
  const want = `${JSON.stringify({ permissions: { allow: [], deny: ['Shell(curl)'] } }, null, 2)}\n`;
  const events = [];
  const rules = { deny: ['Bash(curl)'] };
  await runCursorProcess({ cwd, bin: fakeCursor(tmp(), 'ok', { sh: `printf '{"permissions":{"deny":[]}}' > .cursor/cli.json` }).bin,
    prompt: 'go', permissionRules: rules, onEvent: (e) => events.push(e) });
  assert.equal(readFileSync(join(cwd, '.cursor', 'cli.json'), 'utf8'), want, 'worca\'s rules are back');
  assert.equal(cursorOwns(join(cwd, '.cursor', 'cli.json')), true);
  assert.ok(events.some((e) => e.type === 'stderr' && /changed \.cursor\/cli\.json/.test(e.text)), 'the run log says so');
  const next = fakeCursor(tmp(), 'ok');
  await runCursorProcess({ cwd, bin: next.bin, prompt: 'go', resumeSessionId: 'cursor:chat-1', permissionRules: rules });
  assert.equal(next.record().cli, want, 'the resumed spawn starts on worca\'s rules, not a refusal');
});

test('G14: a deny file the agent replaces with a symlink is unlinked and rewritten, never written through', POSIX, async () => {
  const cwd = tmp();
  const target = join(tmp(), 'elsewhere.json');
  writeFileSync(target, 'theirs');
  await runCursorProcess({ cwd, bin: fakeCursor(tmp(), 'ok', { sh: `rm .cursor/cli.json && ln -s ${JSON.stringify(target)} .cursor/cli.json` }).bin,
    prompt: 'go', permissionRules: { deny: ['Bash'] } });
  assert.equal(readFileSync(target, 'utf8'), 'theirs');
  assert.equal(lstatSync(join(cwd, '.cursor', 'cli.json')).isSymbolicLink(), false);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, '.cursor', 'cli.json'), 'utf8')), { permissions: { allow: [], deny: ['Shell(*)'] } });
});

test('spawn: cli.json always includes permissions.allow (cursor-agent rejects deny-only)', POSIX, async () => {
  const cwd = tmp();
  const fake = fakeCursor(tmp(), 'ok');
  await runCursorProcess({ cwd, bin: fake.bin, prompt: 'go', permissionRules: { deny: ['Bash(curl)'] } });
  const doc = JSON.parse(readFileSync(join(cwd, '.cursor', 'cli.json'), 'utf8'));
  assert.deepEqual(doc.permissions.allow, []);
  assert.deepEqual(doc.permissions.deny, ['Shell(curl)']);
  assert.deepEqual(JSON.parse(fake.record().cli), doc, 'the agent saw the same document');
});

test('G14: an MCP file the agent edits is restored too, and a failed spawn still restores', POSIX, async () => {
  const cwd = tmp();
  const mcp = join(tmp(), 'mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { gh: { command: 'gh-mcp' } } }));
  const fake = fakeCursor(tmp(), null, { fail: 'boom', sh: `printf '{"mcpServers":{"evil":{"command":"x"}}}' > .cursor/mcp.json` });
  await assert.rejects(runCursorProcess({ cwd, bin: fake.bin, prompt: 'go', mcpConfigPath: mcp }), /boom/);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(cwd, '.cursor', 'mcp.json'), 'utf8')).mcpServers), ['gh']);
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
