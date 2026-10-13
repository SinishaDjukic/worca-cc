// test/toolchain-setup-messages.test.mjs
// plugins/toolchain-setup scripts, run in-process against stub tools on a temporary PATH and HOME.
import { fileURLToPath } from 'node:url';
import nodeTest, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
// The stub tools (mise, brew, winget, rustup, powershell) are POSIX shell scripts.
const test = (name, fn) => nodeTest(name, { skip: process.platform === 'win32' && 'the stub tools are POSIX shell scripts' }, fn);
const S = fileURLToPath(new URL('../plugins/toolchain-setup/scripts', import.meta.url));

async function sandbox(miseBody) {
  const dir = await mkdtemp(join(tmpdir(), 'tc-test-'));
  const bin = join(dir, 'bin'); await mkdir(bin);
  await writeFile(join(bin, 'mise'), `#!/bin/sh\n${miseBody}\n`); await chmod(join(bin, 'mise'), 0o755);
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  process.env.HOME = dir; process.env.WORCA_HOME = dir;
  return dir;
}

test('Record: toolchain.env header does not claim worca reads it', async () => {
  const dir = await sandbox('exit 1');
  const stateDir = join(dir, 'projects', 'demo');
  const verify = join(dir, 'verify.json');
  await writeFile(verify, JSON.stringify({ toolchainRoot: join(dir, 'root'), stateDir, projectDir: '/tmp/demo', removed: [], rows: [] }));
  const { default: record } = await import(join(S, 'toolchainRecord.mjs'));
  await record({ inputs: { verify: { path: verify } }, log() {} });
  const env = await readFile(join(stateDir, 'toolchain.env'), 'utf8');
  assert.doesNotMatch(env, /Read by worca/);
  assert.match(env.split('\n')[0], /Not loaded into worca runs yet; not a shell script\./);
});

async function resolveWith(miseBody, facts) {
  const dir = await sandbox(miseBody);
  const f = join(dir, 'facts.json'), p = join(dir, 'proposals.json');
  await writeFile(f, JSON.stringify({ facts, capabilities: [] })); await writeFile(p, '[]');
  const { default: resolve } = await import(join(S, 'toolchainResolver.mjs') + `?t=${Date.now()}`);
  const res = await resolve({ inputs: { facts: { path: f }, proposals: { path: p } }, params: { toolchainRoot: join(dir, 'root') },
    ctx: { projectDir: join(dir, 'proj') }, log() {} });
  return res.outputs.plan.value.rows;
}
const OFFLINE = `case "$1" in
  --version) echo "2026.10.7 macos-arm64"; exit 0;;
  registry) echo "maven  aqua:apache/maven"; echo "node core:node"; exit 0;;
  *) echo "mise ERROR error sending request for url (https://mise-versions.jdx.dev/maven): client error (Connect): dns error: failed to lookup address information" >&2; exit 1;;
esac`;

test('Resolver: offline mise ls-remote gives a network reason', async () => {
  const rows = await resolveWith(OFFLINE, [{ tool: 'maven', version: '3.9.9', constraint: 'exact', source: 'pom.xml:1' }]);
  assert.equal(rows[0].status, 'not-possible-here');
  assert.equal(rows[0].reason, 'network unavailable: could not look up maven versions');
});

test('Resolver: offline mise latest gives a network reason', async () => {
  const rows = await resolveWith(OFFLINE, [{ tool: 'node', version: 'lts', constraint: 'range', source: '.nvmrc:1' }]);
  assert.equal(rows[0].reason, 'network unavailable: could not look up node versions');
});

test('Resolver: online but unknown version keeps the old reason', async () => {
  const rows = await resolveWith(`case "$1" in
  --version) echo 2026.10.7; exit 0;;
  registry) echo "maven x"; exit 0;;
  *) echo "mise ERROR no versions found" >&2; exit 1;;
esac`, [{ tool: 'maven', version: '3.9.9', constraint: 'exact', source: 'pom.xml:1' }]);
  assert.equal(rows[0].reason, 'mise could not list maven versions');
});

test('Resolver: offline mise latest that exits 0 with a WARN still gives a network reason', async () => {
  const rows = await resolveWith(`case "$1" in
  --version) echo 2026.10.7; exit 0;;
  registry) echo "terraform x"; exit 0;;
  *) echo "mise WARN  Remote versions cannot be fetched for hashicorp/terraform: error sending request: client error (Connect): dns error" >&2; exit 0;;
esac`, [{ tool: 'terraform', version: 'latest', constraint: 'range', source: 'x:1' }]);
  assert.equal(rows[0].reason, 'network unavailable: could not look up terraform versions');
});
