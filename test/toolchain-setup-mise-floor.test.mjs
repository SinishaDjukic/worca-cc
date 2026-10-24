// test/toolchain-setup-mise-floor.test.mjs
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

test('the floor compares mise versions number by number; unreadable counts as too old', async () => {
  for (const s of ['toolchainDetect.mjs', 'toolchainResolver.mjs', 'toolchainBootstrap.mjs']) {
    const { miseTooOld, MIN_MISE } = await imp(s);
    assert.equal(MIN_MISE, '2026.10.7', s);
    assert.equal(miseTooOld('2026.10.7 macos-arm64 (2026-10-09)'), false, s);
    assert.equal(miseTooOld('2026.10.10 linux-x64'), false, `${s}: not a string compare`);
    assert.equal(miseTooOld('2027.1.0 windows-x64'), false, s);
    assert.equal(miseTooOld('2026.10.6 macos-arm64'), true, s);
    assert.equal(miseTooOld('2025.12.30'), true, s);
    assert.equal(miseTooOld('mise version unknown'), true, s);
    assert.equal(miseTooOld(null), true, s);
  }
});

async function box(miseVersion) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'tc-floor-')));
  const bin = join(home, 'bin'); await mkdir(bin);
  await writeFile(join(bin, 'mise'), `#!/bin/sh
case "$1" in --version) echo "${miseVersion}";; registry) echo "jq aqua:jqlang/jq";; ls-remote) echo 1.8.1;; esac
exit 0
`); await chmod(join(bin, 'mise'), 0o755);
  Object.assign(process.env, { PATH: `${bin}:/usr/bin:/bin`, HOME: home, WORCA_HOME: home });
  return home;
}
async function resolve(home) {
  const res = await (await imp('toolchainResolver.mjs')).default({ inputs: {
    facts: await put(home, 'f.json', { facts: [{ tool: 'jq', version: '1.8.1', constraint: 'exact', source: '.tool-versions:1' }], capabilities: [] }),
    proposals: await put(home, 'p.json', []) }, params: { toolchainRoot: join(home, 'root') }, ctx: { projectDir: '/tmp/demo' }, log() {} });
  return { plan: res.outputs.plan.value, md: res.outputs.summary.value };
}

test('Resolver refuses to work with a mise below the floor, and says how to upgrade', async () => {
  const { plan, md } = await resolve(await box('2026.9.30 macos-arm64 (2026-09-30)'));
  assert.equal(plan.rows[0].status, 'not-possible-here');
  assert.match(plan.rows[0].reason, /mise 2026\.9\.30 is too old: 2026\.10\.7 or newer is needed/);
  assert.match(plan.rows[0].reason, /brew upgrade mise/);
  assert.equal(plan.needsApproval, false);
  assert.match(md, /too old/);
});

test('Resolver works with a mise at the floor', async () => {
  const { plan } = await resolve(await box('2026.10.7 macos-arm64 (2026-10-09)'));
  assert.equal(plan.rows[0].status, 'installable');
});

test('Detect reports a mise below the floor', async () => {
  await box('2026.9.30 macos-arm64');
  const p = await (await imp('toolchainDetect.mjs')).probeTools();
  assert.deepEqual([p.present, p.tooOld, p.minVersion], [true, true, '2026.10.7']);
});

test('Bootstrap fails when the mise it just installed is below the floor', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'tc-floor-')));
  const bin = join(home, 'bin'); await mkdir(bin);
  await writeFile(join(bin, 'brew'), `#!/bin/sh\nmkdir -p "${home}/.local/bin" && printf '#!/bin/sh\\necho "2026.1.0 macos-arm64"\\n' > "${home}/.local/bin/mise" && chmod +x "${home}/.local/bin/mise"\n`);
  await chmod(join(bin, 'brew'), 0o755);
  Object.assign(process.env, { PATH: `${bin}:/usr/bin:/bin`, HOME: home });
  const p = join(home, 'probe.json'), d = join(home, 'd.json');
  await writeFile(p, '{"present":false,"brew":true}'); await writeFile(d, '{"decision":"install"}');
  // As Linux: this Mac's real Homebrew mise must not count as "already present".
  const real = process.platform;
  Object.defineProperty(process, 'platform', { value: 'linux' });
  try {
    await assert.rejects((await imp('toolchainBootstrap.mjs')).default({ inputs: { bootstrap: { path: p }, decision: { path: d } }, params: {}, log() {} }),
      /mise 2026\.1\.0 .*too old.*2026\.10\.7/);
  } finally { Object.defineProperty(process, 'platform', { value: real }); }
});
