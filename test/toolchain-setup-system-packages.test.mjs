// test/toolchain-setup-system-packages.test.mjs
// plugins/toolchain-setup scripts, run in-process against stub tools on a temporary PATH and HOME.
import { fileURLToPath } from 'node:url';
import nodeTest, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
// The stub tools (mise, brew, winget, rustup, powershell) are POSIX shell scripts.
const test = (name, fn) => nodeTest(name, { skip: process.platform === 'win32' && 'the stub tools are POSIX shell scripts' }, fn);
const S = fileURLToPath(new URL('../plugins/toolchain-setup/scripts', import.meta.url));
const imp = (n) => import(join(S, n) + `?t=${Date.now()}${Math.random()}`);
const put = async (dir, name, v) => { const p = join(dir, name); await writeFile(p, JSON.stringify(v)); return { path: p }; };
const prop = (tool, version = null) => ({ tool, version, constraint: version ? 'exact' : 'range', evidence: ['README.md:9'], confidence: 'medium', why: 'Building the pg gem needs the libpq headers.' });

test('proposals may name system packages per package manager, without a version', async () => {
  const { checkProposal } = await imp('toolchainResolver.mjs');
  for (const t of ['brew:libpq', 'brew:openssl@3', 'apt:libpq-dev', 'dnf:libpq-devel', 'winget:Git.Git', 'winget:Microsoft.VisualStudio.2022.BuildTools', 'scoop:imagemagick']) {
    const c = checkProposal(prop(t)); assert.ok(c.ok, `${t}: ${c.reason}`); assert.equal(c.proposal.tool, t);
  }
  for (const t of ['brew:owner/tap/formula', 'apt:foo;rm', 'apt:Foo', 'winget:Git', 'choco:git', 'brew:-x', 'scoop:a b']) assert.equal(checkProposal(prop(t)).ok, false, t);
  assert.match(checkProposal(prop('brew:libpq', '16')).reason, /no version/);
});

const fakeEnv = (managers) => ({
  mise: true, registry: new Set(), sdkmanager: null, async remote() { return null; }, async latest() { return null; },
  async present(r) { return r.tool === 'brew:openssl@3'; }, async capability() { return { ok: true }; }, async freeMb() { return 100000; },
  async system(m) { return managers[m] || { ok: false }; },
});

test('system rows: only this box\'s package managers; already-installed ones are unchanged', async () => {
  const { buildPlan } = await imp('toolchainResolver.mjs');
  const plan = await buildPlan({ proposals: [prop('brew:libpq'), prop('apt:libpq-dev'), prop('winget:PostgreSQL.PostgreSQL'), prop('brew:openssl@3')], env: fakeEnv({ brew: { ok: true, admin: true } }) });
  assert.deepEqual(plan.rows.map((r) => [r.tool, r.kind, r.status, r.change]), [['brew:libpq', 'system', 'installable', 'added'], ['brew:openssl@3', 'system', 'installable', 'unchanged']]);
  assert.deepEqual(plan.rows[0].spec, 'brew:libpq');
  assert.deepEqual(plan.otherBoxes.sort(), ['apt:libpq-dev', 'winget:PostgreSQL.PostgreSQL']);
  assert.deepEqual(plan.toApprove, ['r1']);
});

test('a system package that needs admin rights this run lacks is "run this yourself"', async () => {
  const { buildPlan } = await imp('toolchainResolver.mjs');
  const plan = await buildPlan({ proposals: [prop('apt:libpq-dev')], env: fakeEnv({ apt: { ok: true, admin: false } }) });
  assert.equal(plan.rows[0].status, 'not-possible-here');
  assert.match(plan.rows[0].reason, /administrator rights.*sudo apt-get install -y libpq-dev/);
});

test('the fixed command for each package manager', async () => {
  const { systemCommand } = await imp('toolchainInstall.mjs');
  assert.deepEqual(systemCommand('brew', 'libpq', { root: false }).argv, ['brew', 'install', 'libpq']);
  assert.deepEqual(systemCommand('apt', 'libpq-dev', { root: false }).argv, ['sudo', '-n', 'apt-get', 'install', '-y', '--no-install-recommends', 'libpq-dev']);
  assert.deepEqual(systemCommand('apt', 'libpq-dev', { root: true }).argv, ['apt-get', 'install', '-y', '--no-install-recommends', 'libpq-dev']);
  assert.deepEqual(systemCommand('dnf', 'libpq-devel', { root: false }).argv, ['sudo', '-n', 'dnf', 'install', '-y', 'libpq-devel']);
  assert.deepEqual(systemCommand('winget', 'Git.Git', {}).argv, ['winget', 'install', '--id', 'Git.Git', '--exact', '--silent', '--disable-interactivity', '--accept-package-agreements', '--accept-source-agreements']);
  assert.deepEqual(systemCommand('scoop', 'imagemagick', {}).argv, ['powershell', '-NoProfile', '-NonInteractive', '-Command', 'scoop', 'install', 'imagemagick']);
  assert.equal(systemCommand('apt', 'foo;rm', {}), null);
});

async function sandbox() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'tc-sys-')));
  const bin = join(home, 'bin'); await mkdir(bin); await mkdir(join(home, 'root'));
  await writeFile(join(bin, 'brew'), `#!/bin/sh
echo "$*" >> "${home}/brew.txt"
[ "$1" = list ] && { [ -f "${home}/installed" ] && { echo "libpq 17.2"; exit 0; }; exit 1; }
[ "$1" = install ] && touch "${home}/installed"
exit 0
`); await chmod(join(bin, 'brew'), 0o755);
  await writeFile(join(bin, 'mise'), '#!/bin/sh\nexit 0\n'); await chmod(join(bin, 'mise'), 0o755);
  // worca's database with no Away decision for this run: a person answered.
  await mkdir(join(home, '.worca-cc'));
  const db = new DatabaseSync(join(home, '.worca-cc', 'worca-cc.db'));
  db.exec('CREATE TABLE night_decisions (id INTEGER PRIMARY KEY, pipeline_id TEXT, question_id TEXT, kind TEXT, ts TEXT, record TEXT)'); db.close();
  Object.assign(process.env, { PATH: `${bin}:/usr/bin:/bin`, HOME: home, WORCA_HOME: home });
  return home;
}
const row = { id: 'r1', tool: 'brew:libpq', kind: 'system', manager: 'brew', package: 'libpq', version: null, spec: 'brew:libpq', status: 'installable', change: 'added' };

test('Install runs the fixed brew command for an approved system row; Verify checks it; Record locks it', async () => {
  const home = await sandbox();
  const root = join(home, 'root');
  const inst = await (await imp('toolchainInstall.mjs')).default({ inputs: {
    plan: await put(home, 'plan.json', { toolchainRoot: root, stateDir: join(root, 'projects', 'demo'), projectDir: '/tmp/demo', mise: 'x', rows: [row] }),
    approved: await put(home, 'a.json', { decision: 'all', approved: [{ id: 'r1', spec: 'brew:libpq' }] }) }, params: {}, ctx: { runId: 'run1' }, log() {} });
  assert.equal(inst.outputs.install.value.rows[0].install, 'ok');
  assert.match(await readFile(join(home, 'brew.txt'), 'utf8'), /^install libpq$/m);
  const ver = await (await imp('toolchainVerify.mjs')).default({ inputs: { state: await put(home, 'i.json', inst.outputs.install.value) }, log() {} });
  assert.deepEqual(ver.outputs.verify.value.rows[0].verify.result, 'pass');
  const rec = await (await imp('toolchainRecord.mjs')).default({ inputs: { verify: await put(home, 'v.json', ver.outputs.verify.value) }, log() {} });
  const lock = JSON.parse(await readFile(join(root, 'projects', 'demo', 'toolchain.lock.json'), 'utf8'));
  assert.deepEqual(lock.tools.map((t) => [t.tool, t.kind]), [['brew:libpq', 'system']]);
  assert.match(rec.outputs.report.value, /brew:libpq/);
  assert.match(rec.outputs.report.value, /system-wide/i);
});
