// test/toolchain-setup-windows-mise.test.mjs
// plugins/toolchain-setup scripts, run in-process against stub tools on a temporary PATH and HOME.
import { fileURLToPath } from 'node:url';
import nodeTest, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
// The stub tools (mise, brew, winget, rustup, powershell) are POSIX shell scripts.
const test = (name, fn) => nodeTest(name, { skip: process.platform === 'win32' && 'the stub tools are POSIX shell scripts' }, fn);
const S = fileURLToPath(new URL('../plugins/toolchain-setup/scripts', import.meta.url));
const imp = (n) => import(join(S, n) + `?t=${Date.now()}${Math.random()}`);
const SCRIPTS = ['toolchainDetect.mjs', 'toolchainResolver.mjs', 'toolchainBootstrap.mjs', 'toolchainInstall.mjs', 'toolchainVerify.mjs', 'toolchainRecord.mjs'];
const MISE_STUB = '#!/bin/sh\necho "2026.10.7 windows-x64"\n';

async function asWindows(fn) {
  const real = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try { return await fn(); } finally { Object.defineProperty(process, 'platform', { value: real }); }
}
async function box() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'tc-win-')));
  const bin = join(home, 'bin'); await mkdir(bin);
  Object.assign(process.env, { PATH: `${bin}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, LOCALAPPDATA: join(home, 'AppData', 'Local') });
  delete process.env.SCOOP; delete process.env.ChocolateyInstall;
  return { home, bin };
}
const put = async (path, text) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text); await chmod(path, 0o755); };

for (const [where, rel] of [['winget links', ['AppData', 'Local', 'Microsoft', 'WinGet', 'Links']], ['scoop shims', ['scoop', 'shims']]]) {
  test(`every script finds mise.exe in the ${where} on Windows, even off PATH`, async () => {
    const { home } = await box();
    const exe = join(home, ...rel, 'mise.exe');
    await put(exe, MISE_STUB);
    for (const s of SCRIPTS) assert.equal(await asWindows(async () => (await imp(s)).findMise()), exe, s);
  });
}

test('on Windows a bare "mise" file (no .exe) is not mise', async () => {
  const { bin } = await box();
  await put(join(bin, 'mise'), MISE_STUB);
  for (const s of SCRIPTS) assert.equal(await asWindows(async () => (await imp(s)).findMise()), null, s);
});

test('on macOS/Linux every script still finds mise on PATH and in ~/.local/bin', async () => {
  const { home, bin } = await box();
  await put(join(home, '.local', 'bin', 'mise'), MISE_STUB);
  for (const s of SCRIPTS) assert.equal(await (await imp(s)).findMise(), join(home, '.local', 'bin', 'mise'), s);
  await put(join(bin, 'mise'), MISE_STUB);
  for (const s of SCRIPTS) assert.equal(await (await imp(s)).findMise(), join(bin, 'mise'), s);
});

test('Detect reports winget and scoop on Windows', async () => {
  const { bin } = await box();
  await put(join(bin, 'winget'), '#!/bin/sh\necho v1.9\n');
  await put(join(bin, 'powershell'), '#!/bin/sh\n[ "$4" = scoop ] && echo "scoop 0.5" && exit 0\nexit 1\n');
  const p = await asWindows(async () => (await imp('toolchainDetect.mjs')).probeTools());
  assert.deepEqual([p.present, p.winget, p.scoop, p.platform], [false, true, true, 'win32']);
});

async function bootstrap(probe) {
  const { home, bin } = await box();
  const links = join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links');
  await put(join(bin, 'winget'), `#!/bin/sh\necho "$*" >> "${home}/winget.txt"\nmkdir -p "${links}" && printf '${MISE_STUB.replace(/\n/g, '\\n')}' > "${links}/mise.exe" && chmod +x "${links}/mise.exe"\n`);
  await put(join(bin, 'powershell'), `#!/bin/sh\necho "$*" >> "${home}/ps.txt"\nmkdir -p "${home}/scoop/shims" && printf '${MISE_STUB.replace(/\n/g, '\\n')}' > "${home}/scoop/shims/mise.exe" && chmod +x "${home}/scoop/shims/mise.exe"\n`);
  await put(join(bin, 'curl'), `#!/bin/sh\necho curl >> "${home}/curl.txt"\nexit 1\n`);
  const p = join(home, 'probe.json'), d = join(home, 'decision.json');
  await writeFile(p, JSON.stringify({ present: false, brew: false, platform: 'win32', ...probe })); await writeFile(d, '{"decision":"install"}');
  const run = asWindows(async () => (await imp('toolchainBootstrap.mjs')).default({ inputs: { bootstrap: { path: p }, decision: { path: d } }, params: {}, log() {} }));
  const read = async (f) => { try { return await readFile(join(home, f), 'utf8'); } catch { return ''; } };
  return { run, read };
}

test('Bootstrap on Windows installs mise with winget, per user, no prompts', async () => {
  const { run, read } = await bootstrap({ winget: true, scoop: true });
  const out = await run;
  assert.equal(out.outputs.done.value.method, 'winget');
  assert.match(out.outputs.done.value.binPath, /WinGet[\\/]Links[\\/]mise\.exe$/);
  assert.equal((await read('winget.txt')).trim(), 'install --id jdx.mise --exact --scope user --silent --disable-interactivity --accept-package-agreements --accept-source-agreements');
  assert.equal(await read('curl.txt'), '', 'never the sh installer on Windows');
});

test('Bootstrap on Windows falls back to scoop', async () => {
  const { run, read } = await bootstrap({ winget: false, scoop: true });
  assert.equal((await run).outputs.done.value.method, 'scoop');
  assert.equal((await read('ps.txt')).trim(), '-NoProfile -NonInteractive -Command scoop install mise');
});

test('Bootstrap on Windows with neither says how to install by hand', async () => {
  const { run, read } = await bootstrap({ winget: false, scoop: false });
  await assert.rejects(run, /no winget or scoop.*install mise by hand/i);
  assert.equal(await read('curl.txt'), '');
});
