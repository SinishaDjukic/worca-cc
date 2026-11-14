// test/toolchain-setup-platform.test.mjs
// plugins/toolchain-setup scripts, run in-process against stub tools on a temporary PATH and HOME.
import { fileURLToPath } from 'node:url';
import nodeTest, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
// The stub tools (mise, brew, winget, rustup, powershell) are POSIX shell scripts.
const test = (name, fn) => nodeTest(name, { skip: process.platform === 'win32' && 'the stub tools are POSIX shell scripts' }, fn);
const S = fileURLToPath(new URL('../plugins/toolchain-setup/scripts', import.meta.url));
const imp = (n) => import(join(S, n) + `?t=${Date.now()}${Math.random()}`);
const put = async (dir, name, v) => { const p = join(dir, name); await writeFile(p, JSON.stringify(v)); return { path: p }; };

test('the leak check also watches the Windows and macOS app-data folders', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'tc-plat-')));
  for (const d of ['AppData/Local', 'AppData/Roaming', 'Library/Caches', 'Library/Application Support']) await mkdir(join(home, d), { recursive: true });
  process.env.HOME = home;
  const install = await imp('toolchainInstall.mjs');
  const verify = await imp('toolchainVerify.mjs');
  const before = await install.homeSnapshot();
  for (const d of ['AppData/Local/mise', 'AppData/Roaming/rustup', 'Library/Caches/mise', 'Library/Application Support/x']) await mkdir(join(home, d));
  const leaks = verify.leaksSince(before, await verify.homeSnapshot(), home, join(home, 'root'));
  assert.deepEqual(leaks.sort(), ['~/AppData/Local/mise', '~/AppData/Roaming/rustup', '~/Library/Application Support/x', '~/Library/Caches/mise'].sort());
});

test('the leak check never reports the toolchain root or a folder holding it', async () => {
  const verify = await imp('toolchainVerify.mjs');
  const home = '/h';
  assert.deepEqual(verify.leaksSince([], ['.worca-cc', '.other'], home, join(home, '.worca-cc', 'toolchains')), ['~/.other']);
});

test('Resolver finds rustup.exe on Windows', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'tc-win-')));
  const root = join(home, 'root'), bin = join(home, 'bin');
  await mkdir(bin); await mkdir(join(root, 'installs', 'rust', '1.89.0'), { recursive: true }); await mkdir(join(root, 'cargo', 'bin'), { recursive: true });
  await writeFile(join(root, 'cargo', 'bin', 'rustup.exe'), '#!/bin/sh\necho clippy-x86_64-pc-windows-msvc\n');
  await writeFile(join(bin, 'mise'), '#!/bin/sh\ncase "$1" in --version) echo 2026.10.7;; registry) echo "rust core:rust";; ls-remote) echo 1.89.0;; esac\nexit 0\n');
  await chmod(join(root, 'cargo', 'bin', 'rustup.exe'), 0o755); await chmod(join(bin, 'mise'), 0o755);
  Object.assign(process.env, { PATH: `${bin}:/usr/bin:/bin`, HOME: home, WORCA_HOME: home });
  const mod = await imp('toolchainResolver.mjs');
  const real = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    const res = await mod.default({ inputs: {
      facts: await put(home, 'f.json', { facts: [{ tool: 'rust', version: '1.89.0', constraint: 'exact', source: 'rust-toolchain.toml:2', options: { components: ['clippy'] } }], capabilities: [] }),
      proposals: await put(home, 'p.json', []) }, params: { toolchainRoot: root }, ctx: { projectDir: '/tmp/demo' }, log() {} });
    assert.equal(res.outputs.plan.value.rows[0].present, true);
  } finally { Object.defineProperty(process, 'platform', { value: real }); }
});
