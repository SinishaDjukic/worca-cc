// test/spawn-argv-limit.test.mjs — GH #380: `spawn claude: ENAMETOOLONG` on
// Windows (32K command line) / E2BIG on Linux (128 KiB per argument) when the
// task prompt rode in `-p`. Over ARGV_INLINE_LIMIT the prompt goes on stdin and
// the system prompt / settings become files; under it the argv is unchanged.
import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script (no .exe stand-in on Windows)' : false };

// The host guard (see host-guard-wiring.test.mjs for its own coverage) adds
// --settings / --append-system-prompt / WORCA_HOST_PID to every real spawn;
// the parity assertions here isolate THIS file's feature, so pin it off.
process.env.WORCA_HOST_GUARD = '0';
import {
  ARGV_INLINE_LIMIT, argvLength, buildClaudeArgs, buildSettingsArgs, buildSettingsPayload,
  planClaudeInvocation, stageClaudeInvocation, runClaude,
} from '../src/core/claude-runner.mjs';

const tmp = [];
async function tmpDir() { const d = await mkdtemp(join(tmpdir(), 'worca-cc-argv-')); tmp.push(d); return d; }
after(async () => { await Promise.all(tmp.map((d) => rm(d, { recursive: true, force: true }))); });

let prevMock, prevOrch, prevHooks;
beforeEach(() => {
  prevMock = process.env.WORCA_MOCK; prevOrch = process.env.ORCH_MOCK; prevHooks = process.env.WORCA_SUBAGENT_HOOKS;
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; delete process.env.WORCA_SUBAGENT_HOOKS;
});
afterEach(() => {
  for (const [k, v] of [['WORCA_MOCK', prevMock], ['ORCH_MOCK', prevOrch], ['WORCA_SUBAGENT_HOOKS', prevHooks]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const RULES = { deny: ['Bash(curl:*)'], allow: [], ask: [] };
const BIG = 'x'.repeat(50_000);
const OPTS = { prompt: BIG, systemPrompt: 'be terse', permissionMode: 'acceptEdits', permissionRules: RULES,
  model: 'claude-sonnet-4-6', allowedTools: ['Read'], resumeSessionId: 'sess-9' };

test('ARGV_INLINE_LIMIT leaves real headroom under the Windows 32,767-char command line', () => {
  assert.ok(ARGV_INLINE_LIMIT <= 24_000 && ARGV_INLINE_LIMIT >= 8_000, String(ARGV_INLINE_LIMIT));
  assert.equal(argvLength('claude', ['-p', 'abc']), 6 + (2 + 3) + (3 + 3));
});

test('under the limit: plan is byte-identical to buildClaudeArgs, nothing on stdin, no files', () => {
  const opts = { ...OPTS, prompt: 'p' };
  const plan = planClaudeInvocation(opts, { bin: 'claude' });
  assert.deepEqual(plan.args, buildClaudeArgs(opts));
  assert.equal(plan.stdin, null);
  assert.deepEqual(plan.files, []);
  assert.equal(plan.staged, false);
  assert.deepEqual(plan.args.slice(0, 2), ['-p', 'p']);
  assert.ok(plan.args.includes('--append-system-prompt') && plan.args.includes('--settings'));
});

test('over the limit: bare -p + stdin, --append-system-prompt-file, --settings <file>; no free text in argv', () => {
  const plan = planClaudeInvocation(OPTS, { bin: 'claude', dir: '/stage' });
  assert.equal(plan.staged, true);
  assert.equal(plan.stdin, BIG);
  assert.deepEqual(plan.args.slice(0, 3), ['-p', '--output-format', 'stream-json']);
  assert.equal(plan.args[plan.args.indexOf('--append-system-prompt-file') + 1], join('/stage', 'system-prompt.md'));
  assert.ok(!plan.args.includes('--append-system-prompt'));
  assert.equal(plan.args[plan.args.indexOf('--settings') + 1], join('/stage', 'settings.json'));
  assert.equal(plan.args[plan.args.indexOf('--resume') + 1], 'sess-9', 'resume survives staging');
  assert.equal(plan.args[plan.args.indexOf('--model') + 1], 'claude-sonnet-4-6');
  assert.ok(!plan.args.some((a) => a.includes('be terse') || a.length > 200), JSON.stringify(plan.args));
  assert.ok(argvLength('claude', plan.args) < 1000);
  assert.deepEqual(plan.files.map((f) => f.path), [join('/stage', 'system-prompt.md'), join('/stage', 'settings.json')]);
  assert.equal(plan.files[0].content, 'be terse');
  assert.deepEqual(JSON.parse(plan.files[1].content), { permissions: RULES });
  assert.ok(plan.inlineLength > ARGV_INLINE_LIMIT);
});

test('over the limit with nothing to file: only the prompt moves (no system prompt, no settings)', () => {
  const plan = planClaudeInvocation({ prompt: BIG, permissionMode: 'acceptEdits' }, { bin: 'claude', dir: '/stage' });
  assert.equal(plan.stdin, BIG);
  assert.deepEqual(plan.files, []);
  assert.ok(!plan.args.includes('--settings') && !plan.args.includes('--append-system-prompt-file'));
});

test('a huge SYSTEM prompt alone also stages (Windows counts the whole line)', () => {
  const plan = planClaudeInvocation({ prompt: 'p', systemPrompt: BIG, permissionMode: 'acceptEdits' }, { bin: 'claude', dir: '/stage' });
  assert.equal(plan.staged, true);
  assert.equal(plan.stdin, 'p', 'the (small) prompt still goes on stdin — one delivery shape for the staged path');
  assert.equal(plan.files[0].content, BIG);
});

test('an explicit limit forces staging for a small prompt; a missing dir is an error, not a silent inline', () => {
  const opts = { prompt: 'hello', permissionMode: 'acceptEdits' };
  assert.equal(planClaudeInvocation(opts, { bin: 'claude', dir: '/s', limit: 10 }).staged, true);
  assert.throws(() => planClaudeInvocation(opts, { bin: 'claude', limit: 10 }), /staging dir/);
});

test('buildSettingsArgs: inline JSON by default, a path when a settings file is given; null payload when nothing to carry', () => {
  assert.deepEqual(buildSettingsArgs(RULES), ['--settings', JSON.stringify({ permissions: RULES })]);
  assert.deepEqual(buildSettingsArgs(RULES, '/s/settings.json'), ['--settings', '/s/settings.json']);
  assert.deepEqual(buildSettingsArgs(null), []);
  assert.equal(buildSettingsPayload({ deny: [] }), null);
});

test('stageClaudeInvocation writes the files only on the staged branch', async () => {
  const inline = stageClaudeInvocation({ prompt: 'p', permissionMode: 'acceptEdits' }, { bin: 'claude' });
  assert.equal(inline.dir, null);
  const staged = stageClaudeInvocation(OPTS, { bin: 'claude' });
  tmp.push(staged.dir);
  assert.ok(existsSync(join(staged.dir, 'system-prompt.md')) && existsSync(join(staged.dir, 'settings.json')));
  assert.equal(await readFile(join(staged.dir, 'system-prompt.md'), 'utf8'), 'be terse');
});

/** A fake `claude` that records argv (NUL-separated), its stdin, and the
 *  content of the --append-system-prompt-file it was given. */
async function fakeBin(dir) {
  const bin = join(dir, 'fake-claude.sh');
  await writeFile(bin,
    '#!/bin/sh\n' +
    `prev=""; for a in "$@"; do printf '%s\\0' "$a" >> ${JSON.stringify(join(dir, 'argv.txt'))}; ` +
    `if [ "$prev" = "--append-system-prompt-file" ]; then cp "$a" ${JSON.stringify(join(dir, 'sp.txt'))}; echo "$a" > ${JSON.stringify(join(dir, 'sp-path.txt'))}; fi; prev="$a"; done\n` +
    `cat > ${JSON.stringify(join(dir, 'stdin.txt'))}\n` +
    `printf '%s\\n' '{"type":"result","result":"ok"}'\nexit 0\n`, 'utf8');
  await chmod(bin, 0o755);
  return bin;
}

test('runClaude end to end: over the limit the CLI receives the prompt on stdin and the files, then the staging dir is gone', POSIX_SHIM, async () => {
  const dir = await tmpDir();
  const bin = await fakeBin(dir);
  const prompt = 'task prompt\nline two — ünïcödé';
  await runClaude({ cwd: dir, bin, prompt, systemPrompt: 'agent body', permissionRules: RULES, argvInlineLimit: 50 });
  const argv = (await readFile(join(dir, 'argv.txt'), 'utf8')).split('\0').filter(Boolean);
  assert.equal(argv[0], '-p');
  assert.equal(argv[1], '--output-format', 'no prompt positional');
  assert.ok(!argv.includes(prompt) && !argv.includes('agent body'));
  assert.equal(await readFile(join(dir, 'stdin.txt'), 'utf8'), prompt, 'exact prompt bytes on stdin');
  assert.equal(await readFile(join(dir, 'sp.txt'), 'utf8'), 'agent body');
  const spPath = (await readFile(join(dir, 'sp-path.txt'), 'utf8')).trim();
  assert.ok(!existsSync(spPath), `staging dir cleaned up after close: ${spPath}`);
});

test('runClaude end to end: under the limit nothing changes — prompt positional, stdin closed', POSIX_SHIM, async () => {
  const dir = await tmpDir();
  const bin = await fakeBin(dir);
  await runClaude({ cwd: dir, bin, prompt: 'small', systemPrompt: 'agent body' });
  const argv = (await readFile(join(dir, 'argv.txt'), 'utf8')).split('\0').filter(Boolean);
  assert.deepEqual(argv.slice(0, 2), ['-p', 'small']);
  assert.equal(argv[argv.indexOf('--append-system-prompt') + 1], 'agent body');
  assert.equal(await readFile(join(dir, 'stdin.txt'), 'utf8'), '', 'stdin is /dev/null on the inline path');
  assert.ok(!existsSync(join(dir, 'sp-path.txt')));
});

test('runClaude: a real ~1000-line markdown prompt (the #380 report) stages by default', POSIX_SHIM, async () => {
  const dir = await tmpDir();
  const bin = await fakeBin(dir);
  const prompt = Array.from({ length: 1000 }, (_, i) => `- [ ] requirement ${i}: the system shall do something specific and measurable`).join('\n');
  assert.ok(prompt.length > ARGV_INLINE_LIMIT);
  await runClaude({ cwd: dir, bin, prompt, systemPrompt: 'agent body' });
  assert.equal(await readFile(join(dir, 'stdin.txt'), 'utf8'), prompt);
});

test('planClaudeInvocation: a dir factory is invoked only when staging is needed', () => {
  let calls = 0;
  const dir = () => { calls++; return '/lazy'; };
  planClaudeInvocation({ prompt: 'p', permissionMode: 'acceptEdits' }, { bin: 'claude', dir });
  assert.equal(calls, 0, 'inline: no dir');
  const plan = planClaudeInvocation({ prompt: BIG, systemPrompt: 's', permissionMode: 'acceptEdits' }, { bin: 'claude', dir });
  assert.equal(calls, 1);
  assert.equal(plan.files[0].path, join('/lazy', 'system-prompt.md'));
});
