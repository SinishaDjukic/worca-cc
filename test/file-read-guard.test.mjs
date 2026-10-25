// test/file-read-guard.test.mjs — the file-read guard (plans/requirements-a8-design.md D3, D15): the pure decision, the hook
// CLI (any OS), the real hook command through a shell, the decision log, the runner's settings payload, and (POSIX shim)
// the spawn argv.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync, readFileSync, readdirSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateFileRead, readGuardHookEntry, guardDecisionsCover, readGuardDecisions } from '../src/core/file-read-guard.mjs';
import { buildSettingsPayload, buildClaudeArgs, planClaudeInvocation, runClaude } from '../src/core/claude-runner.mjs';
import { stageClaudeInvocation } from '../src/core/engines/claude.mjs';
import { REQUIREMENTS_READ_DENY_RULES, ASK_DENY_RULES, askPathDenied } from '../src/core/ask/deny-rules.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'symlinks and the fake claude shim are POSIX' : false };
const WIN = { skip: process.platform === 'win32' ? false : '8.3 names, \\\\?\\ and UNC forms are Windows' };
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = realpathSync.native(mkdtempSync(join(tmpdir(), 'att-read-guard-'))); dirs.push(d); return d; };
const same = (p) => p;
/** A realpath that records every path it is handed: the proof that a refused path never reached the file system. */
const spy = (impl = same) => { const calls = []; const f = (p) => { calls.push(p); return impl(p); }; f.calls = calls; return f; };
const read = (file_path, extra = {}) => ({ tool_name: 'Read', tool_input: { file_path }, ...extra });
const ONLY = /^file-read guard: this read may open only the attached file\.$/;

test('POSIX forms: the copy is allowed; a sibling, a .. step, another absolute path, a relative path are refused unread', () => {
  const real = spy();
  const o = { platform: 'linux', real };
  const copy = '/w/tmp/requirements/att-read-0a1b2c3d/ratt_0123456789ab.pdf';
  assert.equal(evaluateFileRead(read(copy), copy, o), null);
  assert.equal(evaluateFileRead(read('/w/tmp/requirements/att-read-0a1b2c3d/./ratt_0123456789ab.pdf'), copy, o), null, 'the same file');
  assert.equal(evaluateFileRead(read('/w/tmp//requirements/att-read-0a1b2c3d/ratt_0123456789ab.pdf'), copy, o), null, 'a doubled slash');
  const refused = ['/w/tmp/requirements/att-read-0a1b2c3d/other.pdf', '/w/tmp/requirements/att-read-0a1b2c3d/../../settings.json',
    '/w/tmp/requirements/x/../att-read-0a1b2c3d/ratt_0123456789ab.pdf', '/home/me/.aws/credentials', '/proc/self/environ',
    '/net/host/share/x', '/W/tmp/requirements/att-read-0a1b2c3d/ratt_0123456789ab.pdf', 'ratt_0123456789ab.pdf', './ratt_0123456789ab.pdf'];
  for (const p of refused) assert.match(evaluateFileRead(read(p), copy, o), ONLY, p);
  assert.match(evaluateFileRead(read('ratt_0123456789ab.pdf', { cwd: '/w/tmp/requirements/att-read-0a1b2c3d' }), copy, o), ONLY, 'relative: refused, cwd or not');
  for (const p of refused) assert.equal(real.calls.includes(p), false, `never touched: ${p}`);
});

test('Windows forms: either separator, any case, the /c/ form; UNC, device, 8.3, a trailing dot and a .. step refused unread', () => {
  const real = spy();
  const o = { platform: 'win32', real };
  const copy = 'C:\\Users\\me\\.worca-cc\\tmp\\requirements\\att-read-0a1b2c3d\\ratt_0123456789ab.pdf';
  for (const p of [copy, 'c:/users/ME/.worca-cc/tmp/requirements/att-read-0a1b2c3d/RATT_0123456789AB.pdf',
    '/c/Users/me/.worca-cc/tmp/requirements/att-read-0a1b2c3d/ratt_0123456789ab.pdf']) {
    assert.equal(evaluateFileRead(read(p), copy, o), null, p);
  }
  const refused = ['D:\\Users\\me\\.worca-cc\\tmp\\requirements\\att-read-0a1b2c3d\\ratt_0123456789ab.pdf', 'C:\\Users\\me\\.ssh\\id_rsa',
    'C:\\Users\\me\\.worca-cc\\tmp\\requirements\\att-read-0a1b2c3d\\..\\..\\..\\settings.json',
    'C:\\Users\\me\\.worca-cc\\tmp\\requirements\\x\\..\\att-read-0a1b2c3d\\ratt_0123456789ab.pdf',
    '\\\\localhost\\C$\\Users\\me\\.worca-cc\\tmp\\requirements\\att-read-0a1b2c3d\\ratt_0123456789ab.pdf',
    '\\\\attacker.example\\share\\x.pdf', '//attacker.example/share/x.pdf',
    '\\\\?\\C:\\Users\\me\\.worca-cc\\tmp\\requirements\\att-read-0a1b2c3d\\ratt_0123456789ab.pdf',
    '\\\\.\\C:\\Users\\me\\.worca-cc\\tmp\\requirements\\att-read-0a1b2c3d\\ratt_0123456789ab.pdf', '\\\\.\\pipe\\x',
    'C:\\Users\\me\\.WORCA~1\\tmp\\requirements\\att-read-0a1b2c3d\\ratt_0123456789ab.pdf',
    `${copy}.`, `${copy} `, `${copy}::$DATA`, '\\Users\\me\\.worca-cc\\tmp\\requirements\\att-read-0a1b2c3d\\ratt_0123456789ab.pdf',
    'C:Users\\me\\x.pdf', 'ratt_0123456789ab.pdf'];
  for (const p of refused) assert.match(evaluateFileRead(read(p), copy, o), ONLY, p);
  for (const p of refused) assert.equal(real.calls.includes(p), false, `never touched: ${p}`);
});

test('every other tool, a Read without a path and a payload that is not one are refused', () => {
  for (const t of ['Glob', 'Grep', 'Bash', 'Write', 'mcp__x__y', '', 'Task', 'Agent', 'NotebookRead', 'NotebookEdit', 'LS', 'WebFetch', 'read']) {
    assert.match(evaluateFileRead({ tool_name: t, tool_input: { path: '/w', file_path: '/w/a' } }, '/w/a', { platform: 'linux', real: same }),
      /^file-read guard: only Read of the attached file is allowed here \(.+ refused\)\.$/, t);
  }
  assert.match(evaluateFileRead({ tool_name: 'Read', tool_input: {} }, '/w/a', { platform: 'linux', real: same }), ONLY);
  assert.match(evaluateFileRead(null, '/w/a'), /only Read of the attached file/);
});

test('a guard with no usable allowed file, or one whose realpath fails, allows nothing', () => {
  const o = { platform: 'linux', real: same };
  for (const allowed of [undefined, '', 'a', 'relative/a']) assert.match(evaluateFileRead(read('/a'), allowed, o), ONLY, String(allowed));
  assert.match(evaluateFileRead(read('/undefined'), undefined, o), ONLY, 'never String(undefined)');
  const gone = () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
  assert.match(evaluateFileRead(read('/w/a'), '/w/a', { platform: 'linux', real: gone }), ONLY);
});

test('real paths: a link to elsewhere and a link to the copy are refused unread; an allowed path through a link resolves', POSIX, () => {
  const dir = tmp();
  writeFileSync(join(dir, 'copy.pdf'), 'x');
  writeFileSync(join(dir, 'outside.txt'), 'secret');
  mkdirSync(join(dir, 'f'));
  symlinkSync(join(dir, 'outside.txt'), join(dir, 'f', 'link.pdf'));
  symlinkSync(join(dir, 'copy.pdf'), join(dir, 'f', 'alias.pdf'));
  symlinkSync(dir, join(dir, 'via'));
  assert.match(evaluateFileRead(read(join(dir, 'f', 'link.pdf')), join(dir, 'copy.pdf')), ONLY);
  assert.match(evaluateFileRead(read(join(dir, 'f', 'alias.pdf')), join(dir, 'copy.pdf')), ONLY, 'not the copy\'s name: refused before any lookup');
  for (const p of [join(dir, 'copy.pdf'), join(dir, 'via', 'copy.pdf')]) {
    assert.equal(evaluateFileRead(read(p), join(dir, 'via', 'copy.pdf')), null, `the copy named through a server-side link: ${p}`);
  }
});

test('Windows file system: the copy in any case; 8.3, \\\\?\\, \\\\.\\, UNC and a trailing dot refused without a lookup', WIN, (t) => {
  const dir = tmp();
  const copy = join(dir, 'ratt_0123456789ab.pdf');
  const secret = join(dir, 'secret-long-name.txt');
  writeFileSync(copy, 'x');
  writeFileSync(secret, 'secret');
  const real = spy((p) => realpathSync.native(p));
  const shortOf = (p) => spawnSync('cmd.exe', ['/d', '/c', `for %I in ("${p}") do @echo %~sI`], { encoding: 'utf8', windowsVerbatimArguments: true }).stdout.trim();
  for (const p of [copy, copy.toUpperCase(), copy.replaceAll('\\', '/')]) assert.equal(evaluateFileRead(read(p), copy, { real }), null, p);
  const short = shortOf(copy);
  if (!short.includes('~')) t.diagnostic('8.3 names are off on this volume: the short form is the long one');
  const refused = [secret, shortOf(secret), `\\\\?\\${copy}`, `\\\\.\\${copy}`, `\\\\localhost\\${copy[0]}$${copy.slice(2)}`,
    `\\\\localhost\\${secret[0]}$${secret.slice(2)}`, `${copy}.`, `${copy} `, `${copy}::$DATA`, `${secret}::$DATA`];
  if (short.includes('~')) refused.push(short);
  for (const p of refused) assert.match(evaluateFileRead(read(p), copy, { real }), ONLY, p);
  for (const p of refused) assert.equal(real.calls.includes(p), false, `never touched: ${p}`);
});

const CLI = fileURLToPath(new URL('../src/core/file-read-guard-cli.mjs', import.meta.url));
const runHook = (allowed, payload, { args = [], env = process.env, nodeArgs = [], script = CLI } = {}) => spawnSync(process.execPath,
  [...nodeArgs, script, ...(allowed === undefined ? [] : [allowed]), ...args],
  { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', env, timeout: 30_000 });
const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

test('the hook CLI: exit 0 only for the copy; exit 2 with the reason for anything else, an unreadable payload or no allowed file', () => {
  const dir = tmp();
  const copy = join(dir, 'ratt_0123456789ab.pdf');
  writeFileSync(copy, 'x');
  assert.equal(runHook(copy, read(copy)).status, 0);
  const no = runHook(copy, read(join(dir, 'other.pdf')));
  assert.deepEqual([no.status, no.stderr.trim()], [2, 'file-read guard: this read may open only the attached file.']);
  assert.equal(runHook(copy, { tool_name: 'Grep', tool_input: { pattern: 'x', path: dir } }).status, 2);
  for (const bad of ['not json', '', 'null', '[]']) {
    const r = runHook(copy, bad);
    assert.equal(r.status, 2, JSON.stringify(bad));
    assert.match(r.stderr, /^file-read guard: /, JSON.stringify(bad));
  }
  assert.equal(runHook(undefined, read(copy)).status, 2, 'run without its allowed file, nothing is allowed');
  assert.equal(runHook('', read(copy)).status, 2);
});

test('the hook CLI: an uncaught error still exits 2 (the code is 2 until an explicit allow)', () => {
  const dir = tmp();
  const copy = join(dir, 'ratt_0123456789ab.pdf');
  writeFileSync(copy, 'x');
  const boom = join(dir, 'boom.mjs');
  // Every 'end' listener throws outside the CLI's own try: the error is uncaught.
  writeFileSync(boom, "const on = process.stdin.on.bind(process.stdin);\nprocess.stdin.on = (ev, fn) => on(ev, ev === 'end' ? () => { throw new Error('boom'); } : fn);\n");
  const r = runHook(copy, read(copy), { nodeArgs: ['--import', pathToFileURL(boom).href] });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^file-read guard: /m);
});

test('the hook CLI records every decision in its log: tool, path, decision and the tool call id', () => {
  const dir = tmp();
  const copy = join(dir, 'ratt_0123456789ab.pdf');
  writeFileSync(copy, 'x');
  const log = join(dir, 'guard.jsonl');
  assert.equal(runHook(copy, read(copy, { tool_use_id: 'tu_1' }), { args: [log] }).status, 0);
  assert.equal(runHook(copy, read(join(dir, 'x.pdf')), { args: [log] }).status, 2);
  assert.equal(runHook(copy, { tool_name: 'Glob', tool_input: { pattern: '*' }, tool_use_id: 'tu_3' }, { args: [log] }).status, 2);
  assert.equal(runHook(copy, 'not json', { args: [log] }).status, 2);
  assert.deepEqual(lines(log), [
    { tool: 'Read', path: copy, decision: 'allow', id: 'tu_1' },
    { tool: 'Read', path: join(dir, 'x.pdf'), decision: 'deny' },
    { tool: 'Glob', path: null, decision: 'deny', id: 'tu_3' },
    { tool: null, path: null, decision: 'deny' },
  ]);
  assert.deepEqual(readGuardDecisions(log), lines(log));
  assert.deepEqual(readGuardDecisions(join(dir, 'none.jsonl')), [], 'no log, no decisions');
  const unwritable = join(dir, 'no-such-dir', 'guard.jsonl');
  const r = runHook(copy, read(copy), { args: [unwritable] });
  assert.equal(r.status, 2, 'an allow that cannot be recorded is refused');
  assert.match(r.stderr, /could not be recorded/);
});

test('the hook CLI run through a symlinked path, with NODE_PRESERVE_SYMLINKS=1 or not, still decides', POSIX, () => {
  const dir = tmp();
  const copy = join(dir, 'ratt_0123456789ab.pdf');
  writeFileSync(copy, 'x');
  mkdirSync(join(dir, 'bin'));
  const link = join(dir, 'bin', 'guard.mjs');
  symlinkSync(CLI, link);
  for (const env of [process.env, { ...process.env, NODE_PRESERVE_SYMLINKS: '1' }]) {
    assert.equal(runHook(copy, read(join(dir, 'other.pdf')), { script: link, env }).status, 2);
    assert.equal(runHook(copy, read(copy), { script: link, env }).status, 0);
  }
  assert.equal(readGuardHookEntry(copy).hooks[0].command.includes(realpathSync(CLI)), true, 'the entry names the CLI by its real path');
});

/** Git Bash on Windows (what Claude Code runs hooks with there), sh elsewhere; null when none is found. */
function hookShell() {
  if (process.platform !== 'win32') return ['sh', '-c'];
  const found = [process.env.CLAUDE_CODE_GIT_BASH_PATH, 'C:\\Program Files\\Git\\bin\\bash.exe'].find((p) => p && existsSync(p));
  return found ? [found, '-c'] : null;
}
const SHELL = hookShell();

test('the real hook command, through the shell Claude Code runs hooks with: exit codes and log lines', { skip: SHELL ? false : 'no Git Bash' }, () => {
  const dir = tmp();
  const copy = join(dir, 'ratt_0123456789ab.pdf');
  writeFileSync(copy, 'x');
  const log = join(dir, 'guard.jsonl');
  const { command } = readGuardHookEntry(copy, { log }).hooks[0];
  const sh = (payload) => spawnSync(SHELL[0], [SHELL[1], command], { input: JSON.stringify(payload), encoding: 'utf8', timeout: 30_000 });
  const ok = sh(read(copy, { tool_use_id: 'tu_a' }));
  assert.equal(ok.status, 0, ok.stderr);
  const no = sh(read(join(dir, 'other.pdf'), { tool_use_id: 'tu_b' }));
  assert.deepEqual([no.status, no.stderr.trim()], [2, 'file-read guard: this read may open only the attached file.']);
  assert.deepEqual(lines(log).map((l) => [l.tool, l.decision, l.id]), [['Read', 'allow', 'tu_a'], ['Read', 'deny', 'tu_b']]);
});

test('guardDecisionsCover: true only when every tool call of the stream has a guard decision', () => {
  const frame = (...blocks) => ({ type: 'assistant', message: { content: blocks } });
  const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const raw = [frame({ type: 'text', text: 'hi' }, use('tu_1', 'Read', { file_path: '/w/a' })), frame(use('tu_2', 'Glob', { pattern: '*' }))];
  const both = [{ tool: 'Read', path: '/w/a', decision: 'allow', id: 'tu_1' }, { tool: 'Glob', path: null, decision: 'deny', id: 'tu_2' }];
  assert.equal(guardDecisionsCover(raw, both), true, 'raw stream-json frames');
  assert.equal(guardDecisionsCover(raw.map((r) => ({ type: 'assistant', raw: r })), both), true, 'the runner\'s envelopes');
  assert.equal(guardDecisionsCover([{ type: 'tool', calls: [{ name: 'Read', input: { file_path: '/w/a' }, toolUseId: 'tu_1' }] }], both), true, 'normalized');
  assert.equal(guardDecisionsCover(raw, both.map((d) => JSON.stringify(d))), true, 'log lines as text');
  assert.equal(guardDecisionsCover(raw, [both[0]]), false, 'a call with no decision');
  assert.equal(guardDecisionsCover(raw, []), false);
  assert.equal(guardDecisionsCover(raw, null), false);
  assert.equal(guardDecisionsCover(raw, [both[0], { ...both[1], id: 'tu_9' }]), false, 'a decision for another call');
  assert.equal(guardDecisionsCover(raw, [both[0], both[0], 'garbage']), false, 'one decision covers one call');
  const noIds = [frame(use(undefined, 'Read', { file_path: '/w/a' }))];
  assert.equal(guardDecisionsCover(noIds, [{ tool: 'Read', path: '/w/a', decision: 'allow' }]), true, 'without ids: tool and path');
  assert.equal(guardDecisionsCover(noIds, [{ tool: 'Read', path: '/w/b', decision: 'allow' }]), false);
  assert.equal(guardDecisionsCover([frame({ type: 'text', text: 'no tools' })], []), true, 'no tool call needs no decision');
  assert.equal(guardDecisionsCover(null, []), true);
});

test('the runner carries the guard in the one --settings payload, with the deny rules; without readGuard nothing changes', () => {
  const copy = join(tmpdir(), 'att-read-0a1b2c3d', 'ratt_0123456789ab.pdf');
  const p = buildSettingsPayload({ deny: [...REQUIREMENTS_READ_DENY_RULES] }, { readGuard: copy });
  const entry = p.settings.hooks.PreToolUse.at(-1);
  assert.equal(entry.matcher, '*');
  assert.match(entry.hooks[0].command, /file-read-guard-cli\.mjs" ".*ratt_0123456789ab\.pdf"$/);
  assert.equal(p.settings.disableAllHooks, false);
  assert.deepEqual(p.settings.permissions.deny, [...REQUIREMENTS_READ_DENY_RULES]);
  assert.deepEqual(buildSettingsPayload(null, { readGuard: null }), buildSettingsPayload(null, {}));
  const BASE = { prompt: 'p', permissionMode: 'acceptEdits' };
  assert.deepEqual(buildClaudeArgs({ ...BASE, readGuard: null }), buildClaudeArgs(BASE), 'no guard: the argv is byte-identical');
  const args = buildClaudeArgs({ ...BASE, readGuard: copy });
  assert.match(args[args.indexOf('--settings') + 1], /file-read-guard-cli\.mjs/);
  assert.throws(() => readGuardHookEntry('relative/x.pdf'), /absolute/);
  assert.throws(() => readGuardHookEntry(copy, { log: 'relative.jsonl' }), /absolute/);
  for (const bad of ['', 'relative/x.pdf', { path: copy }, 1, true]) {
    assert.throws(() => buildSettingsPayload(null, { readGuard: bad }), /absolute/, `never a silent no-guard: ${JSON.stringify(bad)}`);
  }
  // M-3: a caller's extraSettings cannot switch the guard off.
  const off = buildSettingsPayload(null, { readGuard: copy, extraSettings: { disableAllHooks: true, hooks: { PreToolUse: [] } } }).settings;
  assert.equal(off.disableAllHooks, false);
  assert.deepEqual(off.hooks.PreToolUse.map((h) => h.matcher), ['*']);
});

test('the decision log lives in a private folder the server chooses, named in the hook command, staged or inline', () => {
  const copy = join(tmpdir(), 'att-read-0a1b2c3d', 'ratt_0123456789ab.pdf');
  const log = join(tmpdir(), 'staged', 'read-guard.jsonl');
  const plan = planClaudeInvocation({ prompt: 'p', permissionMode: 'acceptEdits', readGuard: copy, readGuardLog: log }, { dir: () => '/staged' });
  assert.ok(plan.args[plan.args.indexOf('--settings') + 1].includes(`ratt_0123456789ab.pdf\\" \\"${log.replaceAll('\\', '/')}\\"`));
  for (const limit of [undefined, 10]) {
    const s = stageClaudeInvocation({ prompt: 'p'.repeat(50), permissionMode: 'acceptEdits', readGuard: copy, readGuardLog: join(tmpdir(), 'model-chose.jsonl') }, { limit });
    try {
      assert.ok(s.dir && existsSync(s.dir), 'a private folder, even when nothing else is staged');
      assert.equal(s.readGuardLog, join(s.dir, 'read-guard.jsonl'), 'the server\'s path, never a caller\'s');
      const settings = s.staged ? readFileSync(s.args[s.args.indexOf('--settings') + 1], 'utf8') : s.args[s.args.indexOf('--settings') + 1];
      assert.ok(settings.includes(s.readGuardLog.replaceAll('\\', '/')), `the command names it (limit ${limit})`);
      assert.equal(settings.includes('model-chose'), false);
    } finally { rmSync(s.dir, { recursive: true, force: true }); }
  }
  const plain = stageClaudeInvocation({ prompt: 'p', permissionMode: 'acceptEdits' });
  assert.equal(plain.dir, null, 'no guard: nothing is staged');
  assert.equal('readGuardLog' in plain, false);
});

test('runClaude refuses readGuard on an engine that cannot carry it', async () => {
  for (const engine of ['codex', 'cursor', 'gemini']) {
    await assert.rejects(runClaude({ cwd: tmpdir(), prompt: 'p', engine, readGuard: join(tmpdir(), 'a.pdf') }), /readGuard/, engine);
  }
});

test('the deny rules: Ask\'s, plus Worca\'s attachments, Ask\'s threads, credentials and every other tmp folder; the copy and the look stay readable', () => {
  const home = '/home/me';
  const deny = (p) => askPathDenied(p, { rules: REQUIREMENTS_READ_DENY_RULES, home });
  for (const r of ASK_DENY_RULES.filter((x) => x !== 'Read(//**/.worca-cc/tmp/**)')) assert.ok(REQUIREMENTS_READ_DENY_RULES.includes(r), r);
  assert.equal(REQUIREMENTS_READ_DENY_RULES.includes('Read(//**/.worca-cc/tmp/**)'), false);
  assert.equal(deny(`${home}/.worca-cc/tmp/requirements/att-read-0a1b2c3d/ratt_0123456789ab.pdf`), null, 'the copy');
  assert.equal(deny(`${home}/.worca-cc/tmp/requirements/auto-look-0000abcd/README.md`), null, 'the brief look\'s checkout');
  assert.equal(deny('C:/Users/me/.worca-cc/tmp/requirements/att-read-0a1b2c3d/ratt_0123456789ab.pdf'), null, 'the copy, Windows form');
  for (const p of [`${home}/.worca-cc/requirements/att/ratt_0123456789ab.pdf`, `${home}/.worca-cc/ask/ask_0a1b2c3d/att/x.png`,
    `${home}/.git-credentials`, `${home}/.config/anything/token`, `${home}/.azure/accessTokens.json`, `${home}/AppData/Roaming/x/y`,
    `${home}/.aws/credentials`, '/proc/self/environ', `${home}/.worca-cc/tmp/ask/mcp-1.json`]) {
    assert.ok(deny(p), p);
  }
  // Every tmp folder the code makes, other than requirements/, is denied: a new one fails here until it is listed.
  const src = fileURLToPath(new URL('../src', import.meta.url));
  const names = new Set(['gemini', 'qwen']);   // gemini-family.mjs: join(worcaHome(), 'tmp', name) for these two engines
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith('.mjs')) for (const m of readFileSync(join(d, e.name), 'utf8').matchAll(/(?:worcaHome\(\)|\bhome),\s*'tmp',\s*'([a-z0-9-]+)'/g)) names.add(m[1]);
    }
  };
  walk(src);
  names.delete('requirements');
  assert.ok(names.size >= 10, [...names].join(','));
  for (const n of names) assert.ok(deny(posix.join(home, '.worca-cc', 'tmp', n, 'x')), `tmp/${n}`);
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
  assert.ok(settings.hooks.PreToolUse.some((h) => h.matcher === '*' && /file-read-guard-cli\.mjs/.test(h.hooks[0].command)));
  assert.ok(settings.hooks.PreToolUse.some((h) => h.matcher === 'Bash'), 'the host guard stays');
  assert.deepEqual(settings.permissions.deny, ['Read(~/.aws/**)']);
});

test('runClaude returns the guard\'s decisions; they cover the stream\'s tool calls (fake claude runs the hook)', POSIX, async () => {
  const dir = tmp();
  const copy = join(dir, 'ratt_0123456789ab.pdf');
  writeFileSync(copy, 'x');
  const bin = join(dir, 'fake-claude.mjs');
  // Runs the '*' PreToolUse command as Claude Code would (sh -c, the payload on stdin) for a Read of the copy and a
  // Glob, then reports both tool calls on the stream.
  writeFileSync(bin, `#!${process.execPath}
import { spawnSync } from 'node:child_process';
const argv = process.argv.slice(2);
const settings = JSON.parse(argv[argv.indexOf('--settings') + 1]);
const { command } = settings.hooks.PreToolUse.find((h) => h.matcher === '*').hooks[0];
const calls = [{ id: 'tu_1', name: 'Read', input: { file_path: ${JSON.stringify(copy)} } }, { id: 'tu_2', name: 'Glob', input: { pattern: '*' } }];
const codes = calls.map((c) => spawnSync('sh', ['-c', command], { input: JSON.stringify({ tool_name: c.name, tool_input: c.input, tool_use_id: c.id }) }).status);
console.log(JSON.stringify({ type: 'assistant', message: { content: calls.map((c) => ({ type: 'tool_use', ...c })) } }));
console.log(JSON.stringify({ type: 'result', result: codes.join(','), total_cost_usd: 0 }));
`);
  chmodSync(bin, 0o755);
  const prev = { mock: process.env.WORCA_MOCK, orch: process.env.ORCH_MOCK, broker: process.env.WORCA_BROKER_URL };
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; delete process.env.WORCA_BROKER_URL;
  const events = [];
  let res;
  try {
    res = await runClaude({ cwd: dir, prompt: 'hi', bin, readGuard: copy, onEvent: (e) => events.push(e) });
  } finally {
    for (const [k, v] of [['WORCA_MOCK', prev.mock], ['ORCH_MOCK', prev.orch], ['WORCA_BROKER_URL', prev.broker]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  assert.equal(res.text, '0,2', 'the hook allowed the copy and refused the Glob');
  assert.deepEqual(res.readGuardDecisions, [
    { tool: 'Read', path: copy, decision: 'allow', id: 'tu_1' }, { tool: 'Glob', path: null, decision: 'deny', id: 'tu_2' }]);
  assert.equal(guardDecisionsCover(events, res.readGuardDecisions), true);
  assert.equal(guardDecisionsCover(events, res.readGuardDecisions.slice(0, 1)), false);
});
