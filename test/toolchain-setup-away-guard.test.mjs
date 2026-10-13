// test/toolchain-setup-away-guard.test.mjs
// plugins/toolchain-setup scripts, run in-process against stub tools on a temporary PATH and HOME.
import { fileURLToPath } from 'node:url';
import nodeTest, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, mkdir, realpath, access } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
// The stub tools (mise, brew, winget, rustup, powershell) are POSIX shell scripts.
const test = (name, fn) => nodeTest(name, { skip: process.platform === 'win32' && 'the stub tools are POSIX shell scripts' }, fn);
const S = fileURLToPath(new URL('../plugins/toolchain-setup/scripts', import.meta.url));
const imp = (n) => import(join(S, n) + `?t=${Date.now()}${Math.random()}`);
const put = async (dir, name, v) => { const p = join(dir, name); await writeFile(p, JSON.stringify(v)); return { path: p }; };

// A fake worca home: worca-cc.db with Away's decisions table, a stub brew and mise.
async function sandbox(decisions, { db = true } = {}) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'tc-away-')));
  const bin = join(home, 'bin'); await mkdir(bin); await mkdir(join(home, '.worca-cc'));
  if (db) {
    const d = new DatabaseSync(join(home, '.worca-cc', 'worca-cc.db'));
    d.exec('CREATE TABLE night_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, pipeline_id TEXT NOT NULL, question_id TEXT NOT NULL, kind TEXT NOT NULL, ts TEXT NOT NULL, record TEXT NOT NULL)');
    const ins = d.prepare('INSERT INTO night_decisions (pipeline_id, question_id, kind, ts, record) VALUES (?, ?, ?, ?, ?)');
    for (const [pid, qid] of decisions) ins.run(pid, 'questions-x:n:1-r1', 'questions', 'now', JSON.stringify({ choice: 'Install all', questions: [{ id: qid }] }));
    d.close();
  }
  await writeFile(join(bin, 'brew'), `#!/bin/sh\necho "$*" >> "${home}/brew.txt"\nexit 0\n`);
  await writeFile(join(bin, 'mise'), `#!/bin/sh\n[ "$1" = install ] && echo "$2" >> "${home}/mise.txt"\nexit 0\n`);
  await chmod(join(bin, 'brew'), 0o755); await chmod(join(bin, 'mise'), 0o755);
  Object.assign(process.env, { PATH: `${bin}:/usr/bin:/bin`, HOME: home, WORCA_HOME: home });
  return home;
}
const rows = [
  { id: 'r1', tool: 'brew:libpq', kind: 'system', manager: 'brew', package: 'libpq', version: null, spec: 'brew:libpq', status: 'installable', change: 'added' },
  { id: 'r2', tool: 'jq', kind: 'mise', version: '1.8.1', spec: 'jq@1.8.1', status: 'installable', change: 'added' },
];
async function install(home, runId = 'run1') {
  const out = await (await imp('toolchainInstall.mjs')).default({ inputs: {
    plan: await put(home, 'plan.json', { toolchainRoot: join(home, 'root'), rows }),
    approved: await put(home, 'a.json', { decision: 'all', approved: [{ id: 'r1', spec: 'brew:libpq' }, { id: 'r2', spec: 'jq@1.8.1' }] }) },
    params: {}, ctx: { runId }, log() {} });
  const ran = async (f) => { try { return await readFile(join(home, f), 'utf8'); } catch { return ''; } };
  return { value: out.outputs.install.value, brew: await ran('brew.txt'), mise: await ran('mise.txt') };
}

test('Away mode answered the approval: system rows are refused, toolchain rows still install', async () => {
  const r = await install(await sandbox([['run1', 'toolchain-approval']]));
  assert.equal(r.brew, '', 'brew never ran');
  assert.match(r.mise, /jq@1\.8\.1/);
  const row = r.value.rows.find((x) => x.id === 'r1');
  assert.equal(row.install, 'skipped');
  assert.match(r.value.refused.find((x) => x.id === 'r1').reason, /Away mode.*brew install libpq/);
});

test('a person answered (no Away decision for this run): system rows install', async () => {
  const r = await install(await sandbox([['other-run', 'toolchain-approval'], ['run1', 'some-other-question']]));
  assert.match(r.brew, /^install libpq$/m);
});

test('no way to tell who answered: system rows are refused', async () => {
  assert.equal((await install(await sandbox([], { db: false }))).brew, '');
  assert.equal((await install(await sandbox([]), null)).brew, '');
});
