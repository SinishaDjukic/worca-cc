// test/toolchain-setup-rust-profile.test.mjs
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
const TOML = '[toolchain]\nchannel = "1.89.0"\nprofile = "minimal"\ncomponents = ["rustfmt", "clippy"]\n';

test('Detect keeps rust-toolchain.toml profile and components on the rust fact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tc-det-'));
  await writeFile(join(dir, 'rust-toolchain.toml'), TOML);
  const { facts } = await (await imp('toolchainDetect.mjs')).detect(dir);
  assert.deepEqual(facts, [{ tool: 'rust', version: '1.89.0', constraint: 'exact', source: 'rust-toolchain.toml:2', options: { profile: 'minimal', components: ['rustfmt', 'clippy'] } }]);
});

test('Detect adds no options when the toml sets none', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tc-det-'));
  await writeFile(join(dir, 'rust-toolchain.toml'), '[toolchain]\nchannel = "1.89.0"\n');
  const { facts } = await (await imp('toolchainDetect.mjs')).detect(dir);
  assert.equal(facts[0].options, undefined);
});

async function sandbox() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'tc-rp-')));
  const bin = join(home, 'bin'); await mkdir(bin);
  await writeFile(join(bin, 'mise'), `#!/bin/sh
case "$1" in
  --version) echo 2026.10.7;; registry) echo "rust core:rust";; ls-remote) echo 1.89.0;; latest) echo 1.89.0;;
  install) echo "$2" >> "${home}/installs.txt"; mkdir -p "$MISE_DATA_DIR/installs/rust/1.89.0";;
esac
exit 0
`); await chmod(join(bin, 'mise'), 0o755);
  Object.assign(process.env, { PATH: `${bin}:/usr/bin:/bin`, HOME: home, WORCA_HOME: home });
  return home;
}
const put = async (dir, name, v) => { const p = join(dir, name); await writeFile(p, JSON.stringify(v)); return { path: p }; };
const OPTS = { profile: 'minimal', components: ['rustfmt', 'clippy'] };

test('Resolver carries the fact options onto the plan row', async () => {
  const home = await sandbox();
  const res = await (await imp('toolchainResolver.mjs')).default({ inputs: {
    facts: await put(home, 'f.json', { facts: [{ tool: 'rust', version: '1.89.0', constraint: 'exact', source: 'rust-toolchain.toml:2', options: OPTS }], capabilities: [] }),
    proposals: await put(home, 'p.json', []) }, params: { toolchainRoot: join(home, 'root') }, ctx: { projectDir: '/tmp/demo' }, log() {} });
  assert.deepEqual(res.outputs.plan.value.rows[0].options, OPTS);
  assert.deepEqual(res.outputs.plan.value.rows[0].sizeMb, { download: 110, disk: 520, estimated: true }, 'minimal rust is sized as measured, not as the full set');
});

async function install(options) {
  const home = await sandbox();
  const row = { id: 'r1', tool: 'rust', kind: 'mise', version: '1.89.0', spec: 'rust@1.89.0', status: 'installable', change: 'added', options };
  const logs = [];
  await (await imp('toolchainInstall.mjs')).default({ inputs: {
    plan: await put(home, 'plan.json', { toolchainRoot: join(home, 'root'), rows: [row] }),
    approved: await put(home, 'a.json', { decision: 'all', approved: [{ id: 'r1', spec: 'rust@1.89.0' }] }) }, params: {}, log: (l, m) => logs.push(m) });
  return { args: (await readFile(join(home, 'installs.txt'), 'utf8')).trim(), logs };
}

test('Install passes the rust profile and components to mise', async () => {
  assert.equal((await install(OPTS)).args, 'rust[profile=minimal,components=rustfmt,clippy]@1.89.0');
});

test('Install drops options that are not plain profile / component names', async () => {
  const { args, logs } = await install({ profile: 'minimal]@evil', components: ['rustfmt', 'a,b'] });
  assert.equal(args, 'rust@1.89.0');
  assert.ok(logs.some((m) => /ignored the rust options/.test(m)));
});

async function verify(options) {
  const home = await sandbox();
  await writeFile(join(home, 'bin', 'mise'), `#!/bin/sh
[ "$1" = exec ] && { echo "$2 auto=$MISE_EXEC_AUTO_INSTALL" >> "${home}/exec.txt"; echo "rustc 1.89.0 (x 2025-08-04)"; }
exit 0
`);
  const row = { id: 'r1', tool: 'rust', kind: 'mise', version: '1.89.0', spec: 'rust@1.89.0', status: 'installable', change: 'added', install: 'ok', options };
  await (await imp('toolchainVerify.mjs')).default({ inputs: { state: await put(home, 's.json', { toolchainRoot: join(home, 'root'), rows: [row] }) }, log() {} });
  return (await readFile(join(home, 'exec.txt'), 'utf8')).trim();
}

test('Verify probes the same rust options Install used, and never lets mise exec install', async () => {
  assert.equal(await verify(OPTS), 'rust[profile=minimal,components=rustfmt,clippy]@1.89.0 auto=false');
  assert.equal(await verify(undefined), 'rust@1.89.0 auto=false');
});
