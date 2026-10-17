// test/toolchain-setup-backends.test.mjs
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
const prop = (tool, version = null, extra = {}) => ({ tool, version, constraint: version ? 'exact' : 'range', evidence: ['Makefile:3'], confidence: 'high', why: 'The build calls it.', ...extra });

test('proposals may name mise backend specs; risky backends and bad names are refused', async () => {
  const { checkProposal } = await imp('toolchainResolver.mjs');
  for (const t of ['github:junegunn/fzf', 'aqua:BurntSushi/ripgrep', 'npm:prettier', 'npm:@biomejs/biome', 'pipx:black', 'cargo:cargo-nextest',
    'go:golang.org/x/tools/cmd/goimports', 'gem:rubocop']) {
    const c = checkProposal(prop(t));
    assert.ok(c.ok, `${t}: ${c.reason}`);
    assert.equal(c.proposal.tool, t, 'names keep their case (Go modules and GitHub repos are case-sensitive)');
  }
  assert.equal(checkProposal(prop('GitHub:junegunn/fzf')).proposal.tool, 'github:junegunn/fzf', 'only the backend is lower-cased');
  for (const t of ['ubi:junegunn/fzf', 'http:example', 'asdf:foo', 'vfox:foo', 'github:fzf', 'github:a/b/c', 'npm:../x', 'npm:Prettier', 'go:fmt', 'cargo:a b']) {
    assert.equal(checkProposal(prop(t)).ok, false, t);
  }
});

// An env answering buildPlan's questions; the registry knows only plain names.
const fakeEnv = (over = {}) => ({
  mise: true, registry: new Set(['node', 'uv', 'go', 'rust', 'ruby']), sdkmanager: null,
  async remote(tool) { return { 'npm:cowsay': ['1.5.0', '1.6.0'], 'github:junegunn/fzf': ['0.55.0', '0.56.0'] }[tool] || ['1.0.0']; },
  async latest(tool, q) { return { node: q === 'lts' ? '22.23.3' : '25.0.0', uv: '0.12.19' }[tool] || null; },
  async present() { return false; }, async capability() { return { ok: true }; }, async freeMb() { return 100000; },
  async system() { return { ok: false }; }, ...over,
});

test('a backend spec resolves through mise even though the registry does not list it', async () => {
  const { buildPlan } = await imp('toolchainResolver.mjs');
  const plan = await buildPlan({ proposals: [prop('github:junegunn/fzf', '0.55.0')], env: fakeEnv() });
  const r = plan.rows.find((x) => x.tool === 'github:junegunn/fzf');
  assert.equal(r.status, 'installable'); assert.equal(r.spec, 'github:junegunn/fzf@0.55.0'); assert.equal(r.kind, 'mise');
  assert.equal(plan.rows.length, 1, 'a GitHub release needs no runtime');
});

test('a backend that needs a runtime brings it in as its own row, before it', async () => {
  const { buildPlan } = await imp('toolchainResolver.mjs');
  const plan = await buildPlan({ proposals: [prop('npm:cowsay', '1.5.0'), prop('pipx:black')], env: fakeEnv() });
  const by = (t) => plan.rows.find((x) => x.tool === t);
  assert.equal(by('npm:cowsay').needs, 'node'); assert.equal(by('pipx:black').needs, 'uv');
  assert.equal(by('node').spec, 'node@22.23.3'); assert.equal(by('node').origin, 'resolve');
  assert.equal(by('uv').spec, 'uv@0.12.19');
  assert.match(by('node').why, /npm:cowsay/);
});

test('a runtime the project already asks for is not added twice', async () => {
  const { buildPlan } = await imp('toolchainResolver.mjs');
  const plan = await buildPlan({ facts: [{ tool: 'node', version: '22.23.3', constraint: 'exact', source: '.nvmrc:1' }], proposals: [prop('npm:cowsay', '1.5.0')], env: fakeEnv() });
  assert.deepEqual(plan.rows.map((r) => r.tool).sort(), ['node', 'npm:cowsay']);
  assert.equal(plan.rows.find((r) => r.tool === 'node').origin, 'detect');
});

async function sandbox() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'tc-be-')));
  const root = join(home, 'root'), bin = join(home, 'bin');
  await mkdir(bin); await mkdir(root);
  await writeFile(join(bin, 'mise'), `#!/bin/sh
case "$1" in
  install) echo "$2 PATH=$PATH" >> "${home}/installs.txt";;
  bin-paths) case "$2" in node@*) echo "${root}/installs/node/22.23.3/bin";; *) echo "${root}/installs/npm-cowsay/1.5.0/bin";; esac;;
  where) echo "${root}/installs/npm-cowsay/1.5.0";;
  exec) echo "v22.23.3";;
esac
exit 0
`); await chmod(join(bin, 'mise'), 0o755);
  Object.assign(process.env, { PATH: `${bin}:/usr/bin:/bin`, HOME: home, WORCA_HOME: home });
  return { home, root };
}
const nodeRow = { id: 'r1', tool: 'node', kind: 'mise', version: '22.23.3', spec: 'node@22.23.3', status: 'installable', change: 'added', origin: 'resolve' };
const npmRow = { id: 'r2', tool: 'npm:cowsay', kind: 'mise', version: '1.5.0', spec: 'npm:cowsay@1.5.0', status: 'installable', change: 'added', needs: 'node' };

test('Install puts the runtime first and on PATH for the backend install', async () => {
  const sb = await sandbox();
  await (await imp('toolchainInstall.mjs')).default({ inputs: {
    plan: await put(sb.home, 'plan.json', { toolchainRoot: sb.root, rows: [npmRow, nodeRow] }),
    approved: await put(sb.home, 'a.json', { decision: 'all', approved: [{ id: 'r1', spec: 'node@22.23.3' }, { id: 'r2', spec: 'npm:cowsay@1.5.0' }] }) }, params: {}, log() {} });
  const lines = (await readFile(join(sb.home, 'installs.txt'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^node@22\.23\.3 /);
  assert.ok(lines[1].startsWith(`npm:cowsay@1.5.0 PATH=${sb.root}/installs/node/22.23.3/bin:`), lines[1]);
});

test('Verify proves a backend tool by its install in the root and what it puts on PATH', async () => {
  const sb = await sandbox();
  await mkdir(join(sb.root, 'installs', 'npm-cowsay', '1.5.0', 'bin'), { recursive: true });
  await writeFile(join(sb.root, 'installs', 'npm-cowsay', '1.5.0', 'bin', 'cowsay'), '');
  const out = await (await imp('toolchainVerify.mjs')).default({ inputs: { state: await put(sb.home, 's.json', { toolchainRoot: sb.root, rows: [{ ...npmRow, install: 'ok' }] }) }, log() {} });
  const v = out.outputs.verify.value.rows[0].verify;
  assert.equal(v.result, 'pass'); assert.match(v.detail, /cowsay/);
});

test('Resolver sees an installed backend tool through mise where, so it is not asked for again', async () => {
  const sb = await sandbox();
  await mkdir(join(sb.root, 'installs', 'npm-cowsay', '1.5.0'), { recursive: true });
  await writeFile(join(sb.home, 'bin', 'mise'), `#!/bin/sh
case "$1" in
  --version) echo 2026.10.7;; registry) echo "node core:node";; ls-remote) echo 1.5.0;; latest) echo 22.23.3;;
  where) [ "$2" = "npm:cowsay@1.5.0" ] && { echo "${sb.root}/installs/npm-cowsay/1.5.0"; exit 0; }; exit 1;;
esac
exit 0
`);
  const res = await (await imp('toolchainResolver.mjs')).default({ inputs: {
    facts: await put(sb.home, 'f.json', { facts: [{ tool: 'node', version: '22.23.3', constraint: 'exact', source: '.nvmrc:1' }], capabilities: [] }),
    proposals: await put(sb.home, 'p.json', [prop('npm:cowsay', '1.5.0')]) }, params: { toolchainRoot: sb.root }, ctx: { projectDir: '/tmp/demo' }, log() {} });
  const r = res.outputs.plan.value.rows.find((x) => x.tool === 'npm:cowsay');
  assert.equal(r.present, true); assert.equal(r.change, 'unchanged');
});
