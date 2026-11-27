// test/cli-add-readiness.test.mjs — `worca add` ends with one readiness line, and the two commands when the
// project has code and the ai-readiness workflows are installed. WORCA_READINESS=0 prints nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'worca-cc.mjs');
const home = useTempHome(after);
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
// The child never sees the developer's real HOME: worca keeps settings under $HOME/.worca-cc.
const childEnv = (env = {}) => ({ ...process.env, WORCA_HOME: home, HOME: home, USERPROFILE: home, WORCA_GIT: '1', ...env });
const runCli = (args, env = {}) => new Promise((res) => {
  const child = spawn(process.execPath, [CLI, ...args], { env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('exit', (code) => res({ code, out, err }));
});
const repo = (tag, code) => {
  const d = gitDir(tag); made.push(d);
  if (code) writeFileSync(join(d, 'index.js'), 'export {};\n');
  return d;
};
const LINE = /^Readiness: (Agent-ready|Partly ready|Not agent-ready) \(.+\)\.$/m;

test('worca add prints the readiness line and both commands for a repo with code', async () => {
  for (const id of ['wfp_ai-readiness_check', 'wfp_ai-readiness_setup']) await writeGraphWorkflow({ id, name: id, nodes: [], wires: [] });
  const dir = repo('cli-rd-code', true);
  const r = await runCli(['add', 'rdcode', '--path', dir]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, LINE);
  assert.ok(r.out.includes(`  Evaluate: worca --project ${dir} --workflow wfp_ai-readiness_check --prompt check`), r.out);
  assert.ok(r.out.includes(`  Set up:   worca --project ${dir} --workflow wfp_ai-readiness_setup --prompt "set up"`), r.out);
  const off = await runCli(['add', 'rdoff', '--path', repo('cli-rd-off', true)], { WORCA_READINESS: '0' });
  assert.equal(off.code, 0, off.err);
  assert.doesNotMatch(off.out, /Readiness:|Evaluate:|Set up:/);
});

test('a project path with a space is shell-quoted in both commands, so they copy-paste', async () => {
  for (const id of ['wfp_ai-readiness_check', 'wfp_ai-readiness_setup']) await writeGraphWorkflow({ id, name: id, nodes: [], wires: [] });
  const parent = mkdtempSync(join(tmpdir(), 'cli-rd-sp-')); made.push(parent);
  const dir = join(parent, "my repo's copy");
  mkdirSync(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  writeFileSync(join(dir, 'index.js'), 'export {};\n');
  const r = await runCli(['add', 'rdspace', '--path', dir]);
  assert.equal(r.code, 0, r.err);
  const q = `'${dir.replace(/'/g, `'\\''`)}'`;
  assert.ok(r.out.includes(`  Evaluate: worca --project ${q} --workflow wfp_ai-readiness_check --prompt check`), r.out);
  assert.ok(r.out.includes(`  Set up:   worca --project ${q} --workflow wfp_ai-readiness_setup --prompt "set up"`), r.out);
  // The shell reads the quoted path back as the one folder.
  const line = r.out.split('\n').find((l) => l.startsWith('  Evaluate:'));
  const arg = line.slice(line.indexOf('--project ') + 10, line.indexOf(' --workflow'));
  assert.equal(execFileSync('/bin/sh', ['-c', `printf %s ${arg}`], { encoding: 'utf8' }), dir);
});

test('worca add prints only the readiness line for an empty repo', async () => {
  const dir = repo('cli-rd-empty', false);
  const r = await runCli(['add', 'rdempty', '--path', dir]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, LINE);
  assert.doesNotMatch(r.out, /Evaluate:|Set up:/);
});

test('the spawned CLI runs under the scratch HOME, never the real one', async () => {
  const seen = await new Promise((res) => {
    const c = spawn(process.execPath, ['-e', 'process.stdout.write([process.env.HOME, process.env.USERPROFILE, process.env.WORCA_HOME].join("|"))'], { env: childEnv(), stdio: ['ignore', 'pipe', 'ignore'] });
    let o = ''; c.stdout.on('data', (d) => { o += d; }); c.on('exit', () => res(o));
  });
  assert.equal(seen, [home, home, home].join('|'));
});
