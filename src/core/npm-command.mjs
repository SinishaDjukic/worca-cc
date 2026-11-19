// src/core/npm-command.mjs
// How worca starts npm. On Windows npm is `npm.cmd`, which only runs through a shell (execFile of a
// .cmd → EINVAL), and Node deprecates an args array together with `shell: true` (DEP0190: the
// arguments are joined unescaped). So Windows runs npm's own npm-cli.js with node and no shell; when
// that file is not there (volta, scoop), ONE quoted command line goes through the shell with no args
// array. POSIX runs `npm` directly.
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import { WIN_CMD_METACHAR_RE } from './win-command.mjs';

const isNpmCli = (p) => win32.basename(p).toLowerCase() === 'npm-cli.js';

/** One argument as cmd.exe reads it: quoted when empty or spaced; a character cmd re-parses is refused, never escaped. */
function cmdQuote(arg) {
  const a = String(arg);
  if (WIN_CMD_METACHAR_RE.test(a)) throw new Error(`npm argument cannot pass through cmd.exe: ${a.slice(0, 80)}`);
  return a === '' || /\s/.test(a) ? `"${a.replace(/(\\+)$/, '$1$1')}"` : a;
}

/**
 * @param {string[]} npmArgs
 * @param {{ platform?: string, env?: object, execPath?: string, exists?: (p: string) => boolean }} [ctx]
 * @returns {{ file: string, args: string[] | null, shell: boolean }} `args` is null exactly when `shell` is true
 */
export function npmCommand(npmArgs, { platform = process.platform, env = process.env, execPath = process.execPath, exists = existsSync } = {}) {
  if (platform !== 'win32') return { file: 'npm', args: [...npmArgs], shell: false };
  // npm_execpath is set by whichever package manager started us: only npm's own entry point counts.
  // The npm beside node is the bundled one; npm.cmd would prefer a newer npm under the global prefix
  // (after `npm install -g npm`). root, prefix, install and ci behave the same in both.
  const fromEnv = String(env.npm_execpath || '');
  const candidates = [...(isNpmCli(fromEnv) ? [fromEnv] : []), win32.join(win32.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const cli = candidates.find((p) => exists(p));
  if (cli) return { file: execPath, args: [cli, ...npmArgs], shell: false };
  return { file: ['npm', ...npmArgs.map(cmdQuote)].join(' '), args: null, shell: true };
}

/** Run npm through an execFile-shaped `exec(file, args, opts)`; `args` is undefined on the shell path. */
export function runNpm(exec, npmArgs, opts = {}, ctx) {
  const { file, args, shell } = npmCommand(npmArgs, ctx);
  return exec(file, args ?? undefined, { ...opts, shell });
}
