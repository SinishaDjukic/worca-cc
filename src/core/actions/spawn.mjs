// src/core/actions/spawn.mjs — spawn a stored action command through the OS shell and stop
// its whole process tree. Mirrors graph/script-runner.mjs (#runtime shell form + killTree).
import { spawn } from 'node:child_process';
import { killTree } from '../graph/script-runner.mjs';
import { stripHostCredentials } from '../host-credentials.mjs';

const STRIPPED = ['WORCA_HOME', 'WORCA_RUN_ROOT', 'WORCA_HOST_PID'];
const MAX_LINE = 8000;

export function actionBaseEnv(base = process.env) {
  const env = stripHostCredentials({ ...base });
  for (const k of STRIPPED) delete env[k];
  return env;
}

export function shellArgv(command, platform = process.platform, env = process.env) {
  if (platform === 'win32') return { file: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${command}"`], verbatim: true };
  return { file: '/bin/sh', args: ['-c', command], verbatim: false };
}

/** Live children, reaped synchronously if the host exits without a graceful stop. */
const live = new Map();
process.on('exit', () => { for (const [child, platform] of live) killTree(child, platform); });

export function spawnActionProcess({ command, cwd, env, platform = process.platform, onLine = () => {}, spawnImpl = spawn }) {
  const { file, args, verbatim } = shellArgv(command, platform, env);
  const child = spawnImpl(file, args, {
    cwd, env,
    detached: platform !== 'win32',          // own process group → kill(-pid) reaches grandchildren
    windowsHide: true,
    windowsVerbatimArguments: verbatim,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  live.set(child, platform);
  const pump = (stream, name) => {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { onLine(name, buf.slice(0, i).replace(/\r$/, '').slice(0, MAX_LINE)); buf = buf.slice(i + 1); }
      if (buf.length > MAX_LINE) { onLine(name, buf.slice(0, MAX_LINE)); buf = ''; }
    });
    stream.on('end', () => { if (buf) onLine(name, buf.slice(0, MAX_LINE)); });
  };
  pump(child.stdout, 'out');
  pump(child.stderr, 'err');
  child.once('close', () => live.delete(child));
  return child;
}

/** SIGTERM the group, wait `graceMs`, then killTree (SIGKILL group / taskkill /T /F). */
export async function stopProcess(child, { graceMs = 3000, platform = process.platform } = {}) {
  if (!child?.pid) return;                                               // never spawned
  if (child.exitCode !== null || child.signalCode !== null) { killTree(child, platform); return; }   // leader gone: reap the group
  const closed = new Promise((r) => child.once('close', r));
  if (platform !== 'win32') { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } } }
  const timer = new Promise((r) => setTimeout(r, platform === 'win32' ? 0 : graceMs).unref());
  await Promise.race([closed, timer]);
  killTree(child, platform);               // always: reaches a grandchild that outlived its parent
  await Promise.race([closed, new Promise((r) => setTimeout(r, 2000).unref())]);
  child.stdout?.destroy(); child.stderr?.destroy();
}
