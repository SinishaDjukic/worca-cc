// test/file-read-guard.test.mjs — the file-read guard (plans/requirements-a8-design.md D3, D15): the pure decision, the hook
// CLI (any OS), the runner's settings payload, and (POSIX shim) the spawn argv.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateFileRead, readGuardHookEntry } from '../src/core/file-read-guard.mjs';
import { buildSettingsPayload, buildClaudeArgs, runClaude } from '../src/core/claude-runner.mjs';
import { REQUIREMENTS_READ_DENY_RULES, ASK_DENY_RULES } from '../src/core/ask/deny-rules.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'symlinks and the fake claude shim are POSIX' : false };
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'att-read-guard-'))); dirs.push(d); return d; };
const same = (p) => p;
const read = (file_path, extra = {}) => ({ tool_name: 'Read', tool_input: { file_path }, ...extra });
const ONLY = /^file-read guard: this read may open only the attached file\.$/;

test('POSIX forms: the copy is allowed; a sibling, a .. escape, another absolute path and a bare name are refused', () => {
  const o = { platform: 'linux', real: same };
  const copy = '/w/tmp/requirements/att-read-0a1b2c3d/ratt_0123456789ab.pdf';
  assert.equal(evaluateFileRead(read(copy), copy, o), null);
  assert.equal(evaluateFileRead(read('/w/tmp/requirements/att-read-0a1b2c3d/./ratt_0123456789ab.pdf'), copy, o), null, 'the same file');
  assert.equal(evaluateFileRead(read('ratt_0123456789ab.pdf', { cwd: '/w/tmp/requirements/att-read-0a1b2c3d' }), copy, o), null, 'relative to the folder');
  for (const p of ['/w/tmp/requirements/att-read-0a1b2c3d/other.pdf', '/w/tmp/requirements/att-read-0a1b2c3d/../../settings.json',
    '/home/me/.aws/credentials', '/proc/self/environ', 'ratt_0123456789ab.pdf']) {
    assert.match(evaluateFileRead(read(p), copy, o), ONLY, p);
  }
});

test('Windows forms: either separator, any case, the /c/ form; another drive, folder or a .. escape refused', () => {
  const o = { platform: 'win32', real: same };
  const copy = 'C:\\Users\\me\\.worca-cc\\tmp\\requirements\\att-read-0a1b2c3d\\ratt_0123456789ab.pdf';
  for (const p of [copy, 'c:/users/ME/.worca-cc/tmp/requirements/att-read-0a1b2c3d/RATT_0123456789AB.pdf',
    '/c/Users/me/.worca-cc/tmp/requirements/att-read-0a1b2c3d/ratt_0123456789ab.pdf']) {
    assert.equal(evaluateFileRead(read(p), copy, o), null, p);
  }
  for (const p of ['D:\\Users\\me\\.worca-cc\\tmp\\requirements\\att-read-0a1b2c3d\\ratt_0123456789ab.pdf', 'C:\\Users\\me\\.ssh\\id_rsa',
    'C:\\Users\\me\\.worca-cc\\tmp\\requirements\\att-read-0a1b2c3d\\..\\..\\..\\settings.json']) {
    assert.match(evaluateFileRead(read(p), copy, o), ONLY, p);
  }
});

test('every other tool, a Read without a path and a payload that is not one are refused', () => {
  for (const t of ['Glob', 'Grep', 'Bash', 'Write', 'mcp__x__y', '']) {
    assert.match(evaluateFileRead({ tool_name: t, tool_input: { path: '/w' } }, '/w/a', { platform: 'linux', real: same }),
      /^file-read guard: only Read of the attached file is allowed here \(.+ refused\)\.$/, t);
  }
  assert.match(evaluateFileRead({ tool_name: 'Read', tool_input: {} }, '/w/a', { platform: 'linux', real: same }), ONLY);
  assert.match(evaluateFileRead(null, '/w/a'), /only Read of the attached file/);
});

test('a symlink in the folder that points elsewhere is refused; a link to the copy is the copy (real paths)', POSIX, () => {
  const dir = tmp();
  writeFileSync(join(dir, 'copy.pdf'), 'x');
  writeFileSync(join(dir, 'outside.txt'), 'secret');
  mkdirSync(join(dir, 'f'));
  symlinkSync(join(dir, 'outside.txt'), join(dir, 'f', 'link.pdf'));
  symlinkSync(join(dir, 'copy.pdf'), join(dir, 'f', 'alias.pdf'));
  assert.match(evaluateFileRead(read(join(dir, 'f', 'link.pdf')), join(dir, 'copy.pdf')), ONLY);
  assert.equal(evaluateFileRead(read(join(dir, 'f', 'alias.pdf')), join(dir, 'copy.pdf')), null);
});

test('no way round it: the agent and notebook tools, a case change on POSIX, and a guard with no allowed file', () => {
  const o = { platform: 'linux', real: same };
  for (const t of ['Task', 'Agent', 'NotebookRead', 'NotebookEdit', 'LS', 'WebFetch', 'read']) {
    assert.match(evaluateFileRead({ tool_name: t, tool_input: { file_path: '/w/a' } }, '/w/a', o), /only Read of the attached file/, t);
  }
  assert.match(evaluateFileRead(read('/w/A'), '/w/a', o), ONLY, 'POSIX paths are case-sensitive');
  for (const allowed of [undefined, '', 'a', 'relative/a']) assert.match(evaluateFileRead(read('/a'), allowed, o), ONLY, String(allowed));
  assert.match(evaluateFileRead(read('/undefined'), undefined, o), ONLY, 'never String(undefined)');
});

const WIN = { skip: process.platform === 'win32' ? false : '8.3 names, \\\\?\\ and UNC forms are Windows' };

test('Windows file system: 8.3 names, \\\\?\\ and \\\\.\\ prefixes resolve to the real file; UNC, a trailing dot or space never reach another', WIN, (t) => {
  const dir = tmp();
  const copy = join(dir, 'ratt_0123456789ab.pdf');
  const secret = join(dir, 'secret-long-name.txt');
  writeFileSync(copy, 'x');
  writeFileSync(secret, 'secret');
  const shortOf = (p) => spawnSync('cmd.exe', ['/d', '/c', `for %I in ("${p}") do @echo %~sI`], { encoding: 'utf8', windowsVerbatimArguments: true }).stdout.trim();
  for (const p of [copy, copy.toUpperCase(), `\\\\?\\${copy}`, `\\\\.\\${copy}`, shortOf(copy)]) assert.equal(evaluateFileRead(read(p), copy), null, p);
  const shortSecret = shortOf(secret);
  assert.notEqual(shortSecret, '', 'cmd printed a short form');
  if (!shortSecret.includes('~')) t.diagnostic('8.3 names are off on this volume: the short-name case reads the long name');
  for (const p of [secret, shortSecret, `\\\\?\\${secret}`, `\\\\.\\${secret}`, `\\\\localhost\\${secret[0]}$${secret.slice(2)}`,
    `${secret}.`, `${secret} `, `${secret}::$DATA`, `${copy}.`, `\\\\localhost\\${copy[0]}$${copy.slice(2)}`]) {
    assert.match(evaluateFileRead(read(p), copy), ONLY, p);
  }
});

const GUARD = fileURLToPath(new URL('../src/core/file-read-guard.mjs', import.meta.url));
const runHook = (allowed, payload) => spawnSync(process.execPath, [GUARD, allowed],
  { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8' });

test('the hook CLI: exit 0 for the copy, exit 2 with the reason otherwise, exit 2 on a payload it cannot read (fail-closed)', () => {
  const dir = tmp();
  const copy = join(dir, 'ratt_0123456789ab.pdf');
  writeFileSync(copy, 'x');
  assert.equal(runHook(copy, read(copy)).status, 0);
  const no = runHook(copy, read(join(dir, 'other.pdf')));
  assert.deepEqual([no.status, no.stderr.trim()], [2, 'file-read guard: this read may open only the attached file.']);
  assert.equal(runHook(copy, { tool_name: 'Grep', tool_input: { pattern: 'x', path: dir } }).status, 2);
  assert.equal(runHook(copy, 'not json').status, 2);
  assert.equal(runHook(copy, '').status, 2, 'an empty payload');
  const bare = spawnSync(process.execPath, [GUARD], { input: JSON.stringify(read(copy)), encoding: 'utf8' });
  assert.equal(bare.status, 2, 'run without its allowed file, nothing is allowed');
});

test('the runner carries the guard in the one --settings payload, with the deny rules; without readGuard nothing changes', () => {
  const copy = join(tmpdir(), 'att-read-0a1b2c3d', 'ratt_0123456789ab.pdf');
  const p = buildSettingsPayload({ deny: [...REQUIREMENTS_READ_DENY_RULES] }, { readGuard: copy });
  const entry = p.settings.hooks.PreToolUse.at(-1);
  assert.equal(entry.matcher, '*');
  assert.match(entry.hooks[0].command, /file-read-guard\.mjs" ".*ratt_0123456789ab\.pdf"$/);
  assert.equal(p.settings.disableAllHooks, false);
  assert.deepEqual(p.settings.permissions.deny, [...REQUIREMENTS_READ_DENY_RULES]);
  assert.deepEqual(buildSettingsPayload(null, { readGuard: null }), buildSettingsPayload(null, {}));
  const BASE = { prompt: 'p', permissionMode: 'acceptEdits' };
  assert.deepEqual(buildClaudeArgs({ ...BASE, readGuard: null }), buildClaudeArgs(BASE), 'no guard: the argv is byte-identical');
  const args = buildClaudeArgs({ ...BASE, readGuard: copy });
  assert.match(args[args.indexOf('--settings') + 1], /file-read-guard\.mjs/);
  assert.throws(() => readGuardHookEntry('relative/x.pdf'), /absolute/);
  for (const bad of ['relative/x.pdf', { path: copy }, 1, true]) {
    assert.throws(() => buildSettingsPayload(null, { readGuard: bad }), /absolute/, 'a guard that cannot be built never drops out silently');
  }
  assert.deepEqual(REQUIREMENTS_READ_DENY_RULES, ASK_DENY_RULES.filter((r) => r !== 'Read(//**/.worca-cc/tmp/**)'));
  assert.ok(REQUIREMENTS_READ_DENY_RULES.includes('Read(~/.aws/**)') && REQUIREMENTS_READ_DENY_RULES.includes('Read(//proc/**)'));
});

test('runClaude forwards readGuard into the spawn argv (fake claude)', POSIX, async () => {
  const dir = tmp();
  const argvFile = join(dir, 'argv.txt');
  const bin = join(dir, 'fake-claude.sh');
  writeFileSync(bin, `#!/bin/sh\nfor a in "$@"; do printf '%s\\0' "$a" >> ${JSON.stringify(argvFile)}; done\nexit 0\n`);
  chmodSync(bin, 0o755);
  const prev = { mock: process.env.WORCA_MOCK, orch: process.env.ORCH_MOCK, broker: process.env.WORCA_BROKER_URL };
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; delete process.env.WORCA_BROKER_URL;
  try {
    await runClaude({ cwd: dir, prompt: 'hi', bin, readGuard: join(dir, 'ratt_0123456789ab.pdf'), permissionRules: { deny: ['Read(~/.aws/**)'] } });
  } finally {
    for (const [k, v] of [['WORCA_MOCK', prev.mock], ['ORCH_MOCK', prev.orch], ['WORCA_BROKER_URL', prev.broker]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  const argv = readFileSync(argvFile, 'utf8').split('\0');
  const settings = JSON.parse(argv[argv.indexOf('--settings') + 1]);
  assert.ok(settings.hooks.PreToolUse.some((h) => h.matcher === '*' && /file-read-guard\.mjs/.test(h.hooks[0].command)));
  assert.ok(settings.hooks.PreToolUse.some((h) => h.matcher === 'Bash'), 'the host guard stays');
  assert.deepEqual(settings.permissions.deny, ['Read(~/.aws/**)']);
});
