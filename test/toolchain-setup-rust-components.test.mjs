// test/toolchain-setup-rust-components.test.mjs
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
const put = async (dir, name, v) => { const p = join(dir, name); await writeFile(p, JSON.stringify(v)); return { path: p }; };

// rust 1.89.0 already in the root (minimal: rustc, cargo, rust-std); rustup lists what is installed.
async function sandbox() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'tc-comp-')));
  const root = join(home, 'root'), bin = join(home, 'bin');
  await mkdir(bin); await mkdir(join(root, 'installs', 'rust', '1.89.0'), { recursive: true }); await mkdir(join(root, 'cargo', 'bin'), { recursive: true });
  await writeFile(join(root, 'cargo', 'bin', 'rustup'), `#!/bin/sh
[ "$RUSTUP_HOME" = "${root}/rustup" ] || exit 9
printf 'cargo-aarch64-apple-darwin\\nrust-std-aarch64-apple-darwin\\nrustc-aarch64-apple-darwin\\n'
`);
  await writeFile(join(bin, 'mise'), `#!/bin/sh
case "$1" in --version) echo 2026.10.7;; registry) echo "rust core:rust";; ls-remote) echo 1.89.0;; install) echo "$2" >> "${home}/installs.txt";; esac
exit 0
`);
  await chmod(join(root, 'cargo', 'bin', 'rustup'), 0o755); await chmod(join(bin, 'mise'), 0o755);
  Object.assign(process.env, { PATH: `${bin}:/usr/bin:/bin`, HOME: home, WORCA_HOME: home });
  return { home, root };
}
async function plan(sb, options) {
  const res = await (await imp('toolchainResolver.mjs')).default({ inputs: {
    facts: await put(sb.home, 'f.json', { facts: [{ tool: 'rust', version: '1.89.0', constraint: 'exact', source: 'rust-toolchain.toml:2', ...(options ? { options } : {}) }], capabilities: [] }),
    proposals: await put(sb.home, 'p.json', []) }, params: { toolchainRoot: sb.root }, ctx: { projectDir: '/tmp/demo' }, log() {} });
  return res.outputs.plan.value;
}

test('Resolver: an installed rust missing a wanted component is not present, so it goes to Approve', async () => {
  const p = await plan(await sandbox(), { profile: 'minimal', components: ['clippy'] });
  assert.equal(p.rows[0].present, false); assert.equal(p.rows[0].change, 'added'); assert.equal(p.needsApproval, true);
});

test('Resolver: an installed rust that has every wanted component stays present', async () => {
  const p = await plan(await sandbox(), { profile: 'minimal', components: ['cargo', 'rust-std'] });
  assert.equal(p.rows[0].present, true); assert.equal(p.needsApproval, false);
});

test('Install hands a rust row with options to mise even when the version is in the root', async () => {
  const sb = await sandbox();
  const row = { id: 'r1', tool: 'rust', kind: 'mise', version: '1.89.0', spec: 'rust@1.89.0', status: 'installable', change: 'added', options: { profile: 'minimal', components: ['clippy'] } };
  await (await imp('toolchainInstall.mjs')).default({ inputs: {
    plan: await put(sb.home, 'plan.json', { toolchainRoot: sb.root, rows: [row] }),
    approved: await put(sb.home, 'a.json', { decision: 'all', approved: [{ id: 'r1', spec: 'rust@1.89.0' }] }) }, params: {}, log() {} });
  assert.equal((await readFile(join(sb.home, 'installs.txt'), 'utf8')).trim(), 'rust[profile=minimal,components=clippy]@1.89.0');
});
