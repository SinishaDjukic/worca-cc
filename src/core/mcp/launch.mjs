#!/usr/bin/env node
// src/core/mcp/launch.mjs
// The launcher every registry stdio copy starts through (MCP registry §5.5.1), on every surface and
// in Test: `node launch.mjs --copy <name> [--env K1,K2] [--env-prefix MCPCHILD_<TAG>_] [--win-shim] -- <command> <args…>`.
// The CLI hands a stdio server its whole environment (every other copy's MCPSECRET_* included);
// the launcher gives the server only the keep-list plus the copy's declared env, which arrives as
// MCPCHILD_<K> so that no runtime acts on it here (a declared NODE_OPTIONS, LD_* or DYLD_* never
// touches this `node`; on Codex, whose servers share one env, MCPCHILD_<TAG>_<K>, see scopeLauncherEnv). It never writes to stdout (the server's JSON-RPC channel), never detaches,
// forwards SIGINT/SIGTERM/SIGHUP and exits with the server's code (128 + n for a signal).
// It keeps other copies' secrets out of the server's own env (its logs, crash reports and children);
// it cannot hide them from a hostile server of the same user, which can read its ancestors' env.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:os';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { keepListEnv } from './keep-list.mjs';
import { WIN_CMD_METACHAR_RE } from '../win-command.mjs';

const ENV_PREFIX = 'MCPCHILD_';
/** A prefix the launcher reads the declared env from: MCPCHILD_, or MCPCHILD_<TAG>_ (MCPCHILD_ is a reserved name, so
 *  no declared key can pose as either). */
export const ENV_PREFIX_RE = /^MCPCHILD_(?:[A-Z0-9]+_)?$/;

/** argv → { copy, envKeys, envPrefix, winShim, command, args }, or null without `-- <command>`. */
export function parseLaunchArgs(argv) {
  const cut = argv.indexOf('--');
  if (cut < 0 || cut === argv.length - 1) return null;
  const o = { copy: '', envKeys: [], envPrefix: ENV_PREFIX, winShim: false, command: argv[cut + 1], args: argv.slice(cut + 2) };
  for (let i = 0; i < cut; i++) {
    if (argv[i] === '--copy') o.copy = argv[++i] ?? '';
    else if (argv[i] === '--env') o.envKeys = String(argv[++i] ?? '').split(',').filter(Boolean);
    else if (argv[i] === '--env-prefix') o.envPrefix = String(argv[++i] ?? '');
    else if (argv[i] === '--win-shim') o.winShim = true;
  }
  return o;
}

/** The server's env: the keep-list, then each --env key K from <prefix><K> (MCPCHILD_<K> by default; a declared
 *  key replaces a keep-list name, in any casing on win32). No MCPSECRET_* survives, in any case. */
export function childEnv(env, envKeys, platform = process.platform, prefix = ENV_PREFIX) {
  const out = keepListEnv(env, platform);
  for (const k of envKeys) {
    const v = env[`${prefix}${k}`];
    if (typeof v !== 'string') continue;
    if (platform === 'win32') for (const o of Object.keys(out)) if (o.toUpperCase() === k.toUpperCase()) delete out[o];
    out[k] = v;
  }
  for (const k of Object.keys(out)) if (/^MCPSECRET_/i.test(k)) delete out[k];
  return out;
}

/**
 * A registry stdio copy whose declared env is read from MCPCHILD_<TAG>_<K>, TAG a hash of the copy's name. codex
 * hands all its MCP servers one shared process env, where two copies of one server (`github_work`, `github_personal`,
 * both GITHUB_TOKEN) would otherwise clash on MCPCHILD_GITHUB_TOKEN. Anything that is not a launcher entry, or
 * declares no env, comes back as it was.
 */
export function scopeLauncherEnv(server) {
  const a = server?.args;
  const cut = Array.isArray(a) ? a.indexOf('--') : -1;
  if (cut < 3 || basename(String(a[0])) !== 'launch.mjs' || a[1] !== '--copy' || a.slice(0, cut).includes('--env-prefix')
    || !server.env || typeof server.env !== 'object') return server;
  const prefix = `${ENV_PREFIX}${createHash('sha256').update(String(a[2])).digest('hex').slice(0, 8).toUpperCase()}_`;
  const env = Object.fromEntries(Object.entries(server.env).map(([k, v]) => [k.startsWith(ENV_PREFIX) ? prefix + k.slice(ENV_PREFIX.length) : k, v]));
  return { ...server, args: [...a.slice(0, cut), '--env-prefix', prefix, ...a.slice(cut)], env };
}

/** The cmd.exe line for a shim: the §5.4 recipe (quote what holds whitespace) plus the two cases it gets wrong — an
 *  empty argument is quoted (it would vanish), a quoted argument's trailing backslashes are doubled (a program's argv
 *  parser reads `\"` as a literal quote). */
export function winShimLine(shim, args) {
  return [shim, ...args].map((a) => (a === '' || /\s/.test(a) ? `"${a.replace(/(\\+)$/, '$1$1')}"` : a)).join(' ');
}

/** What to spawn: the command as written, or cmd.exe running a .cmd/.bat shim verbatim. */
export function spawnPlan({ command, args, winShim }, env) {
  if (!winShim) return { file: command, args, options: {} };
  return {
    file: env.ComSpec || 'cmd.exe',
    args: ['/d', '/v:off', '/s', '/c', `"${winShimLine(command, args)}"`],
    options: { windowsVerbatimArguments: true },
  };
}

function main(argv = process.argv.slice(2)) {
  const o = parseLaunchArgs(argv);
  const fail = (msg) => { process.stderr.write(`worca mcp launcher (${o?.copy ?? ''}): ${msg}\n`); process.exitCode = 127; };
  if (!o) return fail('usage: --copy <name> [--env K1,K2] [--env-prefix MCPCHILD_<TAG>_] [--win-shim] -- <command> <args…>');
  if (!ENV_PREFIX_RE.test(o.envPrefix)) return fail(`--env-prefix must look like MCPCHILD_ or MCPCHILD_<TAG>_, not ${JSON.stringify(o.envPrefix)}`);
  if (o.winShim && [o.command, ...o.args].some((a) => WIN_CMD_METACHAR_RE.test(a))) {
    return fail('an argument holds a character cmd.exe would interpret (& | < > ^ % " !)');
  }
  const plan = spawnPlan(o, process.env);
  let child;
  try {
    child = spawn(plan.file, plan.args, { ...plan.options, env: childEnv(process.env, o.envKeys, process.platform, o.envPrefix), stdio: 'inherit', shell: false });
  } catch (err) { return fail(err.message); }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { try { child.kill(sig); } catch { /* gone */ } });
  child.on('error', (err) => fail(err.message));
  child.on('exit', (code, signal) => { process.exitCode = signal ? 128 + (constants.signals[signal] ?? 0) : (code ?? 0); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
