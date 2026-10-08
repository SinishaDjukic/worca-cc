// test/mcp-launch.test.mjs
// MCP registry §5.5.1: every registry stdio copy starts through src/core/mcp/launch.mjs, which gives
// the server a keep-list env plus the copy's declared env (sent as MCPCHILD_<K>) and nothing else,
// never writes to stdout, forwards signals and passes the exit status on.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keepListNames } from '../src/core/mcp/keep-list.mjs';
import { childEnv, parseLaunchArgs, spawnPlan, winShimLine, scopeLauncherEnv } from '../src/core/mcp/launch.mjs';
import { checkRows } from './helpers/rows.mjs';

const LAUNCH = fileURLToPath(new URL('../src/core/mcp/launch.mjs', import.meta.url));
const POSIX = { skip: process.platform === 'win32' ? 'POSIX signals and env casing' : false };
const dir = mkdtempSync(join(tmpdir(), 'worca-mcp-launch-'));
after(() => rmSync(dir, { recursive: true, force: true }));

/** Run the launcher with exactly `env`; resolves { code, stdout, stderr }. `onStdout` sees each chunk. */
function launch(argv, env, { onStdout } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [LAUNCH, ...argv], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; onStdout?.(stdout, p); });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
const BASE = { PATH: process.env.PATH, HOME: dir };

test('keepListNames (win32): compared case-insensitively, kept in the casing the env enumerates; no LC_*', () => {
  const env = { Path: 'C:\\bin', SystemRoot: 'C:\\Windows', PATHEXT: '.COM;.EXE', ComSpec: 'cmd.exe', TEMP: 'C:\\t',
    LC_ALL: 'C', http_proxy: 'http://p', ANTHROPIC_API_KEY: 'sk', ProgramFiles: 'C:\\PF' };
  assert.deepEqual(keepListNames(env, 'win32'), ['ComSpec', 'PATHEXT', 'Path', 'ProgramFiles', 'SystemRoot', 'TEMP', 'http_proxy']);
});

test('keepListNames: exactly the §5.5.1 names, per platform', () => {
  const POSIX_NAMES = ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER', 'TMPDIR', 'LANG'];
  const WIN32_NAMES = ['APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'PATH', 'PATHEXT', 'COMSPEC', 'PROCESSOR_ARCHITECTURE',
    'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERNAME', 'USERPROFILE', 'PROGRAMFILES'];
  const NET_NAMES = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
    'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE'];
  const all = Object.fromEntries([...POSIX_NAMES, ...WIN32_NAMES, ...NET_NAMES, 'LC_ALL', 'OTHER'].map((k) => [k, 'v']));
  assert.deepEqual(keepListNames(all, 'linux'), [...new Set([...POSIX_NAMES, ...NET_NAMES, 'LC_ALL'])].sort());
  assert.deepEqual(keepListNames(all, 'win32'), [...new Set([...WIN32_NAMES, ...NET_NAMES])].sort());
});

test('childEnv: keep-list + only the --env keys renamed from MCPCHILD_*; every MCPSECRET_* dropped in any case', () => {
  const env = { ...BASE, TERM: 'xterm', MCPCHILD_JIRA_URL: 'https://j', MCPCHILD_JIRA_TOKEN: 'tok', MCPCHILD_EXTRA: 'no',
    MCPCHILD_PATH: '/declared', MCPCHILD_MCPSECRET_X: 'v', MCPCHILD_mcpsecret_y: 'v', MCPSECRET_AAAA1111: 's', mcpsecret_bbbb2222: 's', ANTHROPIC_API_KEY: 'sk' };
  assert.deepEqual(childEnv(env, ['JIRA_URL', 'JIRA_TOKEN', 'PATH', 'MCPSECRET_X', 'mcpsecret_y', 'UNSET', 'ANTHROPIC_API_KEY'], 'linux'),
    { HOME: dir, PATH: '/declared', TERM: 'xterm', JIRA_URL: 'https://j', JIRA_TOKEN: 'tok' });
  // win32: a declared key replaces the keep-list entry whatever its casing
  assert.deepEqual(childEnv({ Path: 'C:\\bin', MCPCHILD_PATH: 'C:\\mine' }, ['PATH'], 'win32'), { PATH: 'C:\\mine' });
});

test('parseLaunchArgs / spawnPlan / winShimLine: the verbatim cmd.exe line for a .cmd shim', () => {
  const o = parseLaunchArgs(['--copy', 'pw', '--env', 'A,B', '--win-shim', '--', 'C:\\Program Files\\nodejs\\npx.cmd', '-y', 'pkg', 'a b']);
  assert.deepEqual(o, { copy: 'pw', envKeys: ['A', 'B'], envPrefix: 'MCPCHILD_', winShim: true, command: 'C:\\Program Files\\nodejs\\npx.cmd', args: ['-y', 'pkg', 'a b'] });
  assert.equal(winShimLine(o.command, o.args), '"C:\\Program Files\\nodejs\\npx.cmd" -y pkg "a b"');
  // an empty argument stays (quoted); a quoted argument's trailing backslashes are doubled, else `\"` reads as a quote
  assert.equal(winShimLine('x.cmd', ['C:\\a b\\', '', 'C:\\t\\']), 'x.cmd "C:\\a b\\\\" "" C:\\t\\');
  assert.deepEqual(spawnPlan(o, { ComSpec: 'C:\\Windows\\system32\\cmd.exe' }), {
    file: 'C:\\Windows\\system32\\cmd.exe',
    args: ['/d', '/v:off', '/s', '/c', '""C:\\Program Files\\nodejs\\npx.cmd" -y pkg "a b""'],
    options: { windowsVerbatimArguments: true },
  });
  assert.equal(spawnPlan(o, {}).file, 'cmd.exe');
  assert.deepEqual(spawnPlan({ ...o, winShim: false }, {}), { file: o.command, args: o.args, options: {} });
  assert.equal(parseLaunchArgs(['--copy', 'x']), null, 'no -- <command>');
});

test('the server sees exactly the keep-list (every LC_*, names compared case-sensitively) plus its declared env; nothing on stdout', POSIX, async () => {
  const env = { ...BASE, LANG: 'C', TMPDIR: '/t', Path: '/wrong-case', LC_CTYPE: 'UTF-8', REQUESTS_CA_BUNDLE: '/ca.pem', https_proxy: 'http://proxy:3128',
    ANTHROPIC_API_KEY: 'sk-ant', CLAUDE_CODE_OAUTH_TOKEN: 'oauth', GH_TOKEN: 'g', GITHUB_TOKEN: 'g', SSH_AUTH_SOCK: '/s',
    WORCA_ASK_RELAY_TOKEN: 'r', MCPSECRET_AAAA1111: 'x', mcpsecret_bbbb2222: 'y',
    MCPCHILD_JIRA_URL: 'https://acme.atlassian.net', MCPCHILD_JIRA_TOKEN: 'tok', MCPCHILD_EXTRA: 'no' };
  const r = await launch(['--copy', 'jira', '--env', 'JIRA_URL,JIRA_TOKEN', '--', process.execPath, '-e',
    'process.stdout.write(JSON.stringify(process.env))'], env);
  assert.equal(r.code, 0, r.stderr);
  const seen = JSON.parse(r.stdout);
  delete seen.__CF_USER_TEXT_ENCODING;   // macOS adds it to every process it starts
  assert.deepEqual(seen, { ...BASE, LANG: 'C', TMPDIR: '/t', LC_CTYPE: 'UTF-8', REQUESTS_CA_BUNDLE: '/ca.pem',
    https_proxy: 'http://proxy:3128', JIRA_URL: 'https://acme.atlassian.net', JIRA_TOKEN: 'tok' });
});

test('scopeLauncherEnv: a copy reads its declared env from its own MCPCHILD_<TAG>_ names (codex shares one env between servers)', () => {
  const copy = (name) => ({ type: 'stdio', command: process.execPath, args: ['/w/src/core/mcp/launch.mjs', '--copy', name, '--env', 'GITHUB_TOKEN', '--', 'npx', 'gh-mcp'],
    env: { MCPCHILD_GITHUB_TOKEN: `\${MCPSECRET_${name.length}}` } });
  const work = scopeLauncherEnv(copy('github_work'));
  const personal = scopeLauncherEnv(copy('github_personal'));
  const [wk] = Object.keys(work.env); const [pk] = Object.keys(personal.env);
  assert.match(wk, /^MCPCHILD_[0-9A-F]{8}_GITHUB_TOKEN$/);
  assert.notEqual(wk, pk, 'two copies of one server: two names');
  assert.deepEqual(work.args, ['/w/src/core/mcp/launch.mjs', '--copy', 'github_work', '--env', 'GITHUB_TOKEN',
    '--env-prefix', wk.slice(0, -'GITHUB_TOKEN'.length), '--', 'npx', 'gh-mcp']);
  assert.equal(work.env[wk], '${MCPSECRET_11}', 'the value as it was');
  assert.deepEqual(scopeLauncherEnv(work), work, 'scoped once');
  const plain = { command: 'x', args: ['a'], env: { MCPCHILD_K: 'v' } };
  assert.equal(scopeLauncherEnv(plain), plain, 'not a launcher entry: as it was');
  // The launcher reads the scoped name and nothing else.
  const o = parseLaunchArgs(work.args.slice(1));
  assert.deepEqual(childEnv({ [wk]: 'w', [pk]: 'p', MCPCHILD_GITHUB_TOKEN: 'shared' }, o.envKeys, 'linux', o.envPrefix), { GITHUB_TOKEN: 'w' });
});

test('the launcher refuses an --env-prefix outside MCPCHILD_', POSIX, async () => {
  const ok = await launch(['--copy', 'x', '--env', 'K', '--env-prefix', 'MCPCHILD_AB12_', '--', process.execPath, '-e', 'process.stdout.write(process.env.K)'],
    { ...BASE, MCPCHILD_AB12_K: 'scoped', MCPCHILD_K: 'plain' });
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(ok.stdout, 'scoped');
  const bad = await launch(['--copy', 'x', '--env', 'PATH', '--env-prefix', 'MCPSECRET_', '--', process.execPath, '-e', '0'], BASE);
  assert.equal(bad.code, 127);
  assert.match(bad.stderr, /--env-prefix must look like MCPCHILD_/);
});

test('a declared NODE_OPTIONS reaches the server and never acts on the launcher', POSIX, async () => {
  const marker = join(dir, 'preload.log');
  const probe = join(dir, 'probe.cjs');
  writeFileSync(probe, `require('fs').appendFileSync(${JSON.stringify(marker)}, (process.argv[1] || '-e') + '\\n');\n`);
  const r = await launch(['--copy', 'x', '--env', 'NODE_OPTIONS', '--', process.execPath, '-e',
    'process.stdout.write(process.env.NODE_OPTIONS)'], { ...BASE, MCPCHILD_NODE_OPTIONS: `--require ${probe}` });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `--require ${probe}`);
  assert.equal(readFileSync(marker, 'utf8'), '-e\n', 'the preload ran in the server only, never in the launcher');
});

test('exit status: the child code, 128 + n for a signal, 127 with one stderr line when the spawn fails', POSIX, async () => {
  assert.equal((await launch(['--copy', 'x', '--', process.execPath, '-e', 'process.exit(7)'], BASE)).code, 7);
  assert.equal((await launch(['--copy', 'x', '--', process.execPath, '-e', "process.kill(process.pid, 'SIGKILL')"], BASE)).code, 137);
  const bad = await launch(['--copy', 'sentry_billing', '--', join(dir, 'no-such-command')], BASE);
  assert.equal(bad.code, 127);
  assert.equal(bad.stdout, '');
  assert.match(bad.stderr, /^worca mcp launcher \(sentry_billing\): [^\n]+\n$/);
  for (const argv of [['C:\\x\\npx.cmd', 'a&b'], ['C:\\a!b\\npx.cmd', '-y']]) {
    const refused = await launch(['--copy', 'x', '--win-shim', '--', ...argv], BASE);
    assert.equal(refused.code, 127, `cmd.exe metacharacters are refused, in the shim path too: ${argv}`);
    assert.match(refused.stderr, /^worca mcp launcher \(x\): an argument holds a character cmd\.exe would interpret/);
  }
});

test('the launcher never detaches: a kill of its process group ends the server too', POSIX, async () => {
  const p = spawn(process.execPath, [LAUNCH, '--copy', 'x', '--', process.execPath, '-e',
    "process.stdout.write(process.pid + '\\n'); setTimeout(() => {}, 30000);"], { env: BASE, stdio: ['ignore', 'pipe', 'ignore'], detached: true });
  const server = await new Promise((resolve) => p.stdout.once('data', (d) => resolve(Number(String(d).trim()))));
  const alive = () => { try { process.kill(server, 0); return true; } catch { return false; } };
  process.kill(-p.pid, 'SIGKILL');
  for (let i = 0; i < 40 && alive(); i++) await new Promise((r) => setTimeout(r, 50));
  const survived = alive();
  if (survived) process.kill(server, 'SIGKILL');
  assert.equal(survived, false);
});

// The three launchers run at once; each server writes its own got-<sig> file.
test('SIGINT, SIGTERM and SIGHUP to the launcher reach the server', POSIX, async () => {
  const runs = await Promise.all(['SIGINT', 'SIGTERM', 'SIGHUP'].map(async (sig) => {
    const got = join(dir, `got-${sig}`);
    const script = `process.on(${JSON.stringify(sig)}, () => { require('fs').writeFileSync(${JSON.stringify(got)}, ${JSON.stringify(sig)}); process.exit(0); });`
      + "process.stdout.write('ready\\n'); setTimeout(() => process.exit(9), 5000);";
    let sent = false;
    const r = await launch(['--copy', 'x', '--', process.execPath, '-e', script], BASE, {
      onStdout: (out, p) => { if (!sent && out.includes('ready')) { sent = true; p.kill(sig); } },
    });
    return { sig, got, r };
  }));
  await checkRows(runs.map(({ sig, got, r }) => ({
    name: `${sig} to the launcher reaches the server`,
    run: () => {
      assert.equal(r.code, 0, r.stderr);
      assert.ok(existsSync(got) && readFileSync(got, 'utf8') === sig);
    },
  })));
});
