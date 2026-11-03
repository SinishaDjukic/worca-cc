// tools/readiness/proc.mjs — #919 slice 3: child processes for the readiness tool. A leaf module: no other imports.
import { spawnSync } from 'node:child_process';
import { openSync, closeSync, writeSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The env every child gets: FORCE_COLOR breaks plain-text log parsing, NODE_TEST_CONTEXT changes settings readers. */
export function childEnv(env = process.env) {
  const e = { ...env };
  delete e.FORCE_COLOR; delete e.NODE_TEST_CONTEXT;
  return e;
}

/** Captured child: { code, stdout, stderr }. Never a shell. */
export function run(cmd, args, { cwd, env } = {}) {
  const r = spawnSync(cmd, args, { cwd, env: env ?? childEnv(), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error ? `${r.error.message}\n` : '') };
}

/** Streamed child (long runs: the suite, parity): stdout+stderr go to `file`; returns { code, text } with the whole log. */
export function runLogged(cmd, args, file, { cwd, env } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, 'a');
  writeSync(fd, `$ ${[cmd, ...args].join(' ')}\n`);
  let code = 1;
  try { code = spawnSync(cmd, args, { cwd, env: env ?? childEnv(), stdio: ['ignore', fd, fd] }).status ?? 1; }
  finally { writeSync(fd, `\n[exit ${code}]\n`); closeSync(fd); }
  return { code, text: readFileSync(file, 'utf8') };
}
