import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shellArgv, spawnActionProcess, stopProcess, actionBaseEnv } from '../src/core/actions/spawn.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'process groups are POSIX' : false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('shellArgv per platform', () => {
  assert.deepEqual(shellArgv('npm start', 'linux'), { file: '/bin/sh', args: ['-c', 'npm start'], verbatim: false });
  const w = shellArgv('npm start', 'win32', { ComSpec: 'C:\\Windows\\system32\\cmd.exe' });
  assert.deepEqual(w, { file: 'C:\\Windows\\system32\\cmd.exe', args: ['/d', '/s', '/c', '"npm start"'], verbatim: true });
});

test('base env strips worca internals and GitHub credentials', () => {
  const env = actionBaseEnv({ PATH: '/bin', WORCA_HOME: '/h', WORCA_HOST_PID: '1', WORCA_RUN_ROOT: 'x', GH_TOKEN: 's', GITHUB_TOKEN: 's' });
  assert.deepEqual(Object.keys(env).sort(), ['PATH']);
});

test('base env strips every Azure DevOps credential', () => {
  const ADO_KEYS = ['WORCA_ADO_TOKEN', 'WORCA_ADO_READ_TOKEN', 'WORCA_ADO_WRITE_TOKEN', 'AZURE_DEVOPS_EXT_PAT', 'WORCA_ADO_GIT_TOKEN', 'WORCA_ADO_BOARDS_TOKEN'];
  const env = actionBaseEnv({ ...Object.fromEntries(ADO_KEYS.map((k) => [k, 'x'])), PATH: '/b' });
  assert.deepEqual(env, { PATH: '/b' });
});

test('stop kills the whole process group (grandchild included)', POSIX, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'act-spawn-'));
  const pidFile = join(dir, 'gpid');
  const script = join(dir, 'tree.mjs');
  writeFileSync(script, `
    import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs';
    const g = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    writeFileSync(${JSON.stringify(pidFile)}, String(g.pid)); setInterval(() => {}, 1000);`);
  const child = spawnActionProcess({ command: `"${process.execPath}" "${script}"`, cwd: dir, env: process.env });
  for (let i = 0; i < 100 && !existsSync(pidFile); i++) await sleep(20);
  const gpid = Number(readFileSync(pidFile, 'utf8'));
  await stopProcess(child, { graceMs: 200 });
  let dead = false;
  for (let i = 0; i < 40 && !dead; i++) { try { process.kill(gpid, 0); await sleep(50); } catch { dead = true; } }
  assert.ok(dead, 'grandchild survived stop');
});

test('streams stdout lines and the exit code', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'act-spawn-'));
  const f = join(dir, 'p.mjs');
  writeFileSync(f, 'console.log("one"); console.error("two"); process.exit(3);');
  const lines = [];
  const child = spawnActionProcess({ command: `"${process.execPath}" "${f}"`, cwd: dir, env: process.env,
    onLine: (stream, text) => lines.push(`${stream}:${text}`) });
  const code = await new Promise((r) => child.once('close', r));
  assert.equal(code, 3);
  assert.deepEqual(lines.sort(), ['err:two', 'out:one']);
});
