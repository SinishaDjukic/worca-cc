// test/design-write-guard.test.mjs — the Design write guard (plan Task 3; L1.4-L1.7): the pure decision on every write
// tool, dot segments below an allowed dir, Windows forms, server-side links, new files and links (POSIX), the hook CLI,
// the real hook command through the hook shell with awkward folder names, and the hook entry itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, realpathSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateWrite, writeGuardHookEntry } from '../src/core/design/write-guard.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'symlinks are POSIX' : false };
const W = (file_path, tool_name = 'Write') => ({ tool_name, tool_input: { file_path } });
const same = (p) => p;
const o = { platform: 'linux', real: same, lstat: () => ({}) };
const NO = /^design write guard: /;
const WORK = '/h/design/d_0123456789ab/work';
const HERO = `${WORK}/sections/hero`; const ASKS = `${WORK}/.asks`;

test('builder dirs: inside passes for every write tool; everything else is refused', () => {
  for (const p of [`${HERO}/index.html`, `${HERO}/assets/a.svg`, `${HERO}/./style.css`, `${ASKS}/a_1f2e3d4c.json`]) assert.equal(evaluateWrite(W(p), [HERO, ASKS], o), null, p);
  for (const t of ['Edit', 'MultiEdit']) assert.equal(evaluateWrite(W(`${HERO}/a.html`, t), [HERO], o), null, t);
  assert.equal(evaluateWrite({ tool_name: 'NotebookEdit', tool_input: { notebook_path: `${HERO}/n.ipynb` } }, [HERO], o), null);
  for (const p of [`${WORK}/sections/hero-2/index.html`, `${WORK}/sections/pricing/index.html`, `${WORK}/tokens.css`, HERO, `${HERO}/../pricing/x`,
    'index.html', './index.html', '/etc/passwd', '', null, 7]) assert.match(evaluateWrite(W(p), [HERO, ASKS], o), NO, String(p));
  assert.match(evaluateWrite({ tool_name: 'NotebookEdit', tool_input: { notebook_path: '/etc/x.ipynb', file_path: `${HERO}/a` } }, [HERO], o), NO, 'every path field must pass');
  for (const t of ['Bash', 'Read', '', 'write']) assert.match(evaluateWrite(W(`${HERO}/a`, t), [HERO], o), NO, t);
  for (const bad of [null, 'x', {}, { tool_name: 'Write' }, { tool_name: 'Write', tool_input: {} }]) assert.match(evaluateWrite(bad, [HERO], o), NO);
  for (const dirs of [[], null, undefined, ['relative/a']]) assert.match(evaluateWrite(W(`${HERO}/a`), dirs, o), NO);
});

test('dot segments below an allowed dir are refused, except .asks as the first one', () => {
  for (const p of [`${WORK}/plan.json`, `${WORK}/.asks/a_1.json`, `${WORK}/sections/hero/index.html`]) assert.equal(evaluateWrite(W(p), [WORK], o), null, p);
  for (const p of [`${WORK}/.kit/CONTRACT.md`, `${WORK}/.crew.json`, `${WORK}/.claude/settings.json`, `${WORK}/sections/hero/.claude/settings.json`,
    `${WORK}/.ASKS/x.json`, `${WORK}/.asks/.hidden`, `${WORK}/sections/.asks/x.json`]) assert.match(evaluateWrite(W(p), [WORK], o), NO, p);
});

test('Windows forms: separators, case and /c/ pass; other drives, UNC, device, 8.3, reserved names, trailing dot or space and streams are refused', () => {
  const win = { platform: 'win32', real: same, lstat: () => ({}) };
  const dir = 'C:\\Users\\First Last\\.worca-cc\\design\\d_0123456789ab\\work';
  for (const p of [`${dir}\\plan.json`, 'c:/users/first last/.worca-cc/design/d_0123456789ab/work/PLAN.json', '/c/Users/First Last/.worca-cc/design/d_0123456789ab/work/plan.json']) assert.equal(evaluateWrite(W(p), [dir], win), null, p);
  for (const p of [dir.replace('C:', 'D:') + '\\a', `\\\\?\\${dir}\\a`, `\\\\localhost\\C$\\Users\\a`, dir.replace('First Last', 'FIRST~1') + '\\a', 'C:work\\a',
    `${dir}\\con`, `${dir}\\nul.txt`, `${dir}\\sections\\com1\\a`, `${dir}\\a.html.`, `${dir}\\a.html `, `${dir}\\a.html::$DATA`, `${dir}\\..\\a`]) assert.match(evaluateWrite(W(p), [dir], win), NO, p);
  for (const p of [`${dir}\\CON`, `${dir}\\Nul.txt`, `${dir}\\sections\\LPT1\\a`]) assert.match(evaluateWrite(W(p), [dir], win), NO, `${p}: reserved in any case`);
  const short = { platform: 'win32', real: (p) => p.replace(/KIT~1/i, '.kit').replace(/CREW~1\.JSO/i, '.crew.json'), lstat: () => ({}) };
  for (const p of [`${dir}\\KIT~1\\CONTRACT.md`, `${dir}\\CREW~1.JSO`]) assert.match(evaluateWrite(W(p), [dir], short), NO, `${p}: an 8.3 name of a dot entry`);
});

test('a server-side link in the allowed dir: both spellings pass (macOS /tmp and /private/tmp)', () => {
  const real = (p) => p.replace(/^\/tmp/, '/private/tmp');
  const m = { platform: 'darwin', real, lstat: () => ({}) };
  for (const p of ['/tmp/x/a.html', '/private/tmp/x/a.html']) assert.equal(evaluateWrite(W(p), ['/tmp/x'], m), null, p);
});

test('new files and links: a new file in new folders passes; a link out and a dangling link are refused', POSIX, () => {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), 'dwg-')));
  const allowed = join(d, 'allowed'); const outside = join(d, 'outside');
  mkdirSync(allowed); mkdirSync(outside);
  symlinkSync(outside, join(allowed, 'out'));
  symlinkSync(join(outside, 'not-there'), join(allowed, 'dangling.html'));
  assert.equal(evaluateWrite(W(join(allowed, 'assets', 'icons', 'a.svg')), [allowed]), null);
  assert.equal(evaluateWrite(W(join(allowed, 'new.html')), [allowed]), null);
  assert.match(evaluateWrite(W(join(allowed, 'out', 'new.html')), [allowed]), NO);
  assert.match(evaluateWrite(W(join(allowed, 'out', 'deep', 'new.html')), [allowed]), NO);
  assert.match(evaluateWrite(W(join(allowed, 'dangling.html')), [allowed]), NO);
  assert.match(evaluateWrite(W(join(d, 'gone', 'a')), [join(d, 'gone')]), NO, 'an allowed dir that does not exist allows nothing');
  symlinkSync(allowed, join(outside, 'in'));
  assert.match(evaluateWrite(W(join(outside, 'in', 'a.html')), [allowed]), NO, 'a link outside that points into the dir: the path must be inside as written first');
  rmSync(d, { recursive: true, force: true });
});

const CLI = fileURLToPath(new URL('../src/core/design/write-guard-cli.mjs', import.meta.url));
const runHook = (args, payload) => spawnSync(process.execPath, [CLI, ...args], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', timeout: 30_000 });

test('the hook CLI: exit 0 only for an allowed write; 2 with the reason for anything else', () => {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), 'dwg-')));
  assert.equal(runHook([d], W(join(d, 'a.html'))).status, 0);
  const no = runHook([d], W(join(tmpdir(), 'elsewhere.html')));
  assert.equal(no.status, 2); assert.match(no.stderr, NO);
  for (const bad of ['not json', '', 'null', '[]']) assert.equal(runHook([d], bad).status, 2, JSON.stringify(bad));
  assert.equal(runHook([], W(join(d, 'a.html'))).status, 2, 'no dirs, nothing allowed');
  rmSync(d, { recursive: true, force: true });
});

test('the hook CLI: an uncaught error, or a request whose end never runs, still exits 2', () => {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), 'dwg-')));
  const boom = join(d, 'boom.mjs'); const mute = join(d, 'mute.mjs');
  // Preloaded before the CLI: every 'end' listener throws outside the CLI's own try, or is never registered.
  writeFileSync(boom, "const on = process.stdin.on.bind(process.stdin);\nprocess.stdin.on = (ev, fn) => on(ev, ev === 'end' ? () => { throw new Error('boom'); } : fn);\n");
  writeFileSync(mute, "const on = process.stdin.on.bind(process.stdin);\nprocess.stdin.on = (ev, fn) => (ev === 'end' ? process.stdin : on(ev, fn));\n");
  const run = (pre) => spawnSync(process.execPath, ['--import', pathToFileURL(pre).href, CLI, d], { input: JSON.stringify(W(join(d, 'a.html'))), encoding: 'utf8', timeout: 30_000 });
  const thrown = run(boom);
  assert.equal(thrown.status, 2, thrown.stderr); assert.match(thrown.stderr, NO);
  assert.equal(run(mute).status, 2, 'no explicit allow, so never 0');
  rmSync(d, { recursive: true, force: true });
});

test('the hook CLI: a request whose stdin never closes is refused by its timer (exit 2, never 0, never a hang)', async () => {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), 'dwg-')));
  const fast = join(d, 'fast.mjs');
  // Preloaded before the CLI: its 20 s timer fires after 50 ms. stdin stays open, so only the timer can end the run.
  writeFileSync(fast, 'const st = globalThis.setTimeout;\nglobalThis.setTimeout = (fn, ms, ...a) => st(fn, ms === 20000 ? 50 : ms, ...a);\n');
  const child = spawn(process.execPath, ['--import', pathToFileURL(fast).href, CLI, d], { stdio: ['pipe', 'ignore', 'pipe'] });
  child.stdin.write(JSON.stringify(W(join(d, 'a.html'))));
  let err = '';
  child.stderr.on('data', (b) => { err += b; });
  const code = await new Promise((res) => {
    const hung = setTimeout(() => { child.kill('SIGKILL'); res('hung'); }, 8000);
    child.on('exit', (c) => { clearTimeout(hung); res(c); });
  });
  rmSync(d, { recursive: true, force: true });
  assert.equal(code, 2);
  assert.match(err, NO);
});

function hookShell() {
  if (process.platform !== 'win32') return ['sh', '-c'];
  const found = [process.env.CLAUDE_CODE_GIT_BASH_PATH, 'C:\\Program Files\\Git\\bin\\bash.exe'].find((p) => p && existsSync(p));
  return found ? [found, '-c'] : null;
}
const SHELL = hookShell();

test('the real hook command, through the hook shell, with awkward folder names', { skip: SHELL ? false : 'no Git Bash' }, () => {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'dwg-')));
  for (const name of ['First Last', "o'neil", 'a$HOME', 'b`id`', 'two  spaces']) {
    const dir = join(base, name); mkdirSync(dir);
    const { command } = writeGuardHookEntry({ allowedDirs: [dir] }).hooks[0];
    const sh = (p) => spawnSync(SHELL[0], [SHELL[1], command], { input: JSON.stringify(p), encoding: 'utf8', timeout: 30_000 });
    assert.equal(sh(W(join(dir, 'a.html'))).status, 0, name);
    assert.equal(sh(W(join(base, 'outside.html'))).status, 2, name);
  }
  // A hook that cannot launch (node moved by an upgrade) or whose CLI cannot load exits 127 or 1, which Claude Code
  // reads as "no decision" and runs the tool: the command itself turns any such exit into 2.
  const { command } = writeGuardHookEntry({ allowedDirs: [base] }).hooks[0];
  const node = JSON.stringify(process.execPath.replaceAll('\\', '/'));
  assert.ok(command.startsWith(`${node} `), command);
  for (const broken of [command.replace(node, '"/nonexistent/worca-node"'), command.replace('write-guard-cli.mjs"', 'write-guard-gone.mjs"')]) {
    assert.notEqual(broken, command);
    const r = spawnSync(SHELL[0], [SHELL[1], broken], { input: JSON.stringify(W(join(base, 'a.html'))), encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 2, broken);
  }
  rmSync(base, { recursive: true, force: true });
});

test('writeGuardHookEntry: the matcher, and never a silent no-guard', () => {
  const dir = tmpdir();
  const e = writeGuardHookEntry({ allowedDirs: [dir] });
  assert.equal(e.matcher, 'Write|Edit|MultiEdit|NotebookEdit');
  assert.equal(e.hooks[0].type, 'command');
  assert.match(e.hooks[0].command, /write-guard-cli\.mjs" "/);
  assert.equal(e.hooks[0].command.includes('\\'), false, 'forward slashes only; tmpdir() holds no $, backtick or quote to escape');
  for (const bad of [{}, { allowedDirs: [] }, { allowedDirs: ['relative'] }, { allowedDirs: 'x' }, 'x', 1, { allowedDirs: ['/a/../b'] }, { allowedDirs: ['/a/b\0c'] }]) {
    assert.throws(() => writeGuardHookEntry(bad), /allowedDirs/, JSON.stringify(bad));
  }
});

test('the lookups: /c/ is looked up as c:/, only ENOENT/ENOTDIR walk up, a missing dir among several allows nothing', () => {
  const err = (code) => Object.assign(new Error(code), { code });
  const drive = (p) => { if (!/^[a-zA-Z]:/.test(p)) throw err('ENOENT'); return p; };
  const win = { platform: 'win32', real: drive, lstat: drive };
  assert.equal(evaluateWrite(W('/c/Users/a/work/plan.json'), ['C:\\Users\\a\\work'], win), null, 'the Git Bash form is looked up natively');
  const fresh = { ...win, lstat: (p) => { drive(p); if (/[\\/]new[\\/]/.test(p)) throw err('ENOENT'); return {}; } };
  assert.equal(evaluateWrite(W('C:\\w\\new\\deep\\a.html'), ['C:\\w'], fresh), null, 'a new Windows folder walks up by win32 rules');
  const missing = (code) => ({ platform: 'linux', real: same, lstat: (p) => { if (p.endsWith('/new.html')) throw err(code); return {}; } });
  for (const code of ['ENOENT', 'ENOTDIR']) assert.equal(evaluateWrite(W(`${HERO}/new.html`), [HERO], missing(code)), null, code);
  for (const code of ['EACCES', 'ELOOP', 'EPERM', undefined]) assert.match(evaluateWrite(W(`${HERO}/new.html`), [HERO], missing(code)), NO, String(code));
  const gone = { platform: 'linux', real: (p) => { if (p === ASKS) throw err('ENOENT'); return p; }, lstat: () => ({}) };
  assert.equal(evaluateWrite(W(`${HERO}/a.html`), [ASKS, HERO], gone), null, 'the other dir still allows');
  assert.match(evaluateWrite(W(`${ASKS}/a_1f2e3d4c.json`), [ASKS, HERO], gone), NO, 'the missing dir allows nothing');
  assert.match(evaluateWrite(W(`${WORK}/.asks`), [WORK], o), NO, '.asks is a folder, never a file');
  assert.match(evaluateWrite(W(`${HERO}/sub/`), [HERO], o), NO, 'a folder path, not a file');
  assert.match(evaluateWrite(W('C:\\w\\con .txt'), ['C:\\w'], { platform: 'win32', real: same, lstat: () => ({}) }), NO, 'a device name before a space');
});
