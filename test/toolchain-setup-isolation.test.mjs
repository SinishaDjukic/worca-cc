// test/toolchain-setup-isolation.test.mjs
// plugins/toolchain-setup scripts, run in-process against stub tools on a temporary PATH and HOME.
import { fileURLToPath } from 'node:url';
import nodeTest, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, chmod, mkdir, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
// The stub tools (mise, brew, winget, rustup, powershell) are POSIX shell scripts.
const test = (name, fn) => nodeTest(name, { skip: process.platform === 'win32' && 'the stub tools are POSIX shell scripts' }, fn);
const S = fileURLToPath(new URL('../plugins/toolchain-setup/scripts', import.meta.url));
const imp = (n) => import(join(S, n) + `?t=${Date.now()}${Math.random()}`);

// A stub mise: logs its env per call, fakes installs, and (like real tools) leaks into $HOME.
const STUB = `#!/bin/sh
env > "$LOGDIR/$(date +%s%N)-$1.env"
case "$1" in
  --version) echo "2026.10.7 macos-arm64";;
  registry) echo "rust core:rust";;
  ls-remote) echo 1.89.0;;
  latest) echo 1.89.0;;
  install) echo "$2" >> "$LOGDIR/installs.txt"; mkdir -p "$MISE_DATA_DIR/installs/rust/1.89.0/bin" "$HOME/.leaky" "$HOME/.local/state/mise";;
  exec) mkdir -p "$HOME/.probe-leak"; echo "rustc 1.89.0 (abc 2025-08-04)";;
  bin-paths) echo "$MISE_DATA_DIR/installs/rust/1.89.0/bin";;
  where) echo "$MISE_DATA_DIR/installs/rust/1.89.0";;
esac
exit 0
`;

async function sandbox() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'tc-iso-')));
  const bin = join(home, 'stubbin'), log = join(home, 'stublog');
  await mkdir(bin); await mkdir(log); await mkdir(join(home, '.existing')); await mkdir(join(home, '.local', 'share'), { recursive: true });
  await writeFile(join(bin, 'mise'), STUB); await chmod(join(bin, 'mise'), 0o755);
  Object.assign(process.env, { PATH: `${bin}:/usr/bin:/bin`, HOME: home, WORCA_HOME: home, LOGDIR: log });
  const root = join(home, 'tcroot');
  await mkdir(root);
  return { home, root, log };
}
const row = { id: 'r1', tool: 'rust', kind: 'mise', version: '1.89.0', spec: 'rust@1.89.0', status: 'installable', change: 'added', sources: ['rust-toolchain.toml:2'] };
const put = async (dir, name, value) => { const p = join(dir, name); await writeFile(p, JSON.stringify(value)); return { path: p }; };

async function pipeline(sb) {
  const io = await mkdtemp(join(tmpdir(), 'tc-io-'));   // harness files stay out of the fake $HOME
  const plan = { toolchainRoot: sb.root, stateDir: join(sb.root, 'projects', 'demo'), projectDir: '/tmp/demo', mise: '2026.10.7', rows: [row], removed: [] };
  const install = await (await imp('toolchainInstall.mjs')).default({ inputs: { plan: await put(io, 'plan.json', plan), approved: await put(io, 'ok.json', { decision: 'all', approved: [{ id: 'r1', spec: 'rust@1.89.0' }] }) }, params: {}, log() {} });
  const verify = await (await imp('toolchainVerify.mjs')).default({ inputs: { state: await put(io, 'install.json', install.outputs.install.value) }, log() {} });
  const record = await (await imp('toolchainRecord.mjs')).default({ inputs: { verify: await put(io, 'verify.json', verify.outputs.verify.value) }, log() {} });
  return { install, verify, record };
}
const envs = async (log) => Promise.all((await readdir(log)).filter((f) => f.endsWith('.env')).map(async (f) =>
  ({ f, env: Object.fromEntries((await readFile(join(log, f), 'utf8')).split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) })));

function assertIsolated(list, root, home) {
  assert.ok(list.length > 0, 'mise was called');
  for (const { f, env } of list) {
    assert.equal(env.MISE_STATE_DIR, join(root, 'state'), `${f}: MISE_STATE_DIR`);
    assert.equal(env.MISE_RUSTUP_HOME, join(root, 'rustup'), `${f}: MISE_RUSTUP_HOME`);
    assert.equal(env.MISE_CARGO_HOME, join(root, 'cargo'), `${f}: MISE_CARGO_HOME`);
    assert.equal(env.CHECKPOINT_DISABLE, '1', `${f}: CHECKPOINT_DISABLE`);
    // Caches of the backends' own installers (npm: uses mise's aube, pipx: uses uv, go: uses the go toolchain).
    for (const k of ['AUBE_HOME', 'AUBE_CACHE_DIR', 'AUBE_STORE_DIR', 'UV_CACHE_DIR', 'UV_PYTHON_INSTALL_DIR', 'GOPATH', 'GOMODCACHE', 'GOCACHE']) {
      assert.ok(env[k] && env[k].startsWith(root + '/'), `${f}: ${k}=${env[k]}`);
    }
    assert.equal(env.UV_PYTHON_PREFERENCE, 'only-managed', `${f}: uv must not link tools to a system python`);
    for (const t of ['NODE', 'PYTHON', 'RUBY', 'GO']) {
      const v = env[`MISE_${t}_DEFAULT_PACKAGES_FILE`];
      assert.ok(v && !v.startsWith(home + '/.default'), `${f}: MISE_${t}_DEFAULT_PACKAGES_FILE=${v}`);
    }
  }
}

test('Install, Verify and Record run mise with every tool home inside the toolchain root', async () => {
  const sb = await sandbox();
  await pipeline(sb);
  assertIsolated(await envs(sb.log), sb.root, sb.home);
});

test('Resolver runs mise with every tool home inside the toolchain root', async () => {
  const sb = await sandbox();
  const facts = await put(sb.home, 'facts.json', { facts: [{ tool: 'rust', version: '1.89.0', constraint: 'exact', source: 'rust-toolchain.toml:2' }], capabilities: [] });
  await (await imp('toolchainResolver.mjs')).default({ inputs: { facts, proposals: await put(sb.home, 'p.json', []) }, params: { toolchainRoot: sb.root }, ctx: { projectDir: '/tmp/demo' }, log() {} });
  assertIsolated(await envs(sb.log), sb.root, sb.home);
});

test('Verify lists what Install and the probes wrote outside the root; Record reports it', async () => {
  const sb = await sandbox();
  const { verify, record } = await pipeline(sb);
  const leaks = verify.outputs.verify.value.homeLeaks;
  assert.deepEqual([...leaks].sort(), ['~/.leaky', '~/.local/state', '~/.probe-leak'].sort());
  assert.match(record.outputs.report.value, /Written outside the toolchain root/);
  assert.match(record.outputs.report.value, /~\/\.leaky/);
  const envDoc = JSON.parse(await readFile(join(sb.root, 'projects', 'demo', 'toolchain.env.json'), 'utf8'));
  assert.equal(envDoc.vars.RUSTUP_HOME, join(sb.root, 'rustup')); assert.equal(envDoc.vars.CARGO_HOME, join(sb.root, 'cargo'));
});

test('an install that is only a link out of the root is not "present"', async () => {
  const sb = await sandbox();
  await mkdir(join(sb.home, '.cargo', 'bin'), { recursive: true });
  await mkdir(join(sb.root, 'installs', 'rust'), { recursive: true });
  await symlink(join(sb.home, '.cargo', 'bin'), join(sb.root, 'installs', 'rust', '1.89.0'));
  const facts = await put(sb.home, 'facts.json', { facts: [{ tool: 'rust', version: '1.89.0', constraint: 'exact', source: 'rust-toolchain.toml:2' }], capabilities: [] });
  const res = await (await imp('toolchainResolver.mjs')).default({ inputs: { facts, proposals: await put(sb.home, 'p.json', []) }, params: { toolchainRoot: sb.root }, ctx: { projectDir: '/tmp/demo' }, log() {} });
  const r = res.outputs.plan.value.rows[0];
  assert.equal(r.present, false); assert.equal(r.change, 'added');
  await pipeline(sb);
  assert.match(await readFile(join(sb.log, 'installs.txt'), 'utf8'), /rust@1\.89\.0/, 'Install re-installs instead of "already present"');
});
