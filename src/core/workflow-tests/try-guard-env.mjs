// src/core/workflow-tests/try-guard-env.mjs — a test try's outward guard in its environment and settings (D56): the gh /
// glab / az stand-ins first on PATH, git that cannot sign in, forge CLIs with no sign-in of their own, the PreToolUse hook
// and the deny list. Every function returns its input unchanged without a guard, so every other spawn is byte-identical.
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { worcaHome } from '../projects.mjs';
import { TRY_GUARD_LOG_ENV } from './try-guard.mjs';

export const TRY_GUARD_PATH = fileURLToPath(new URL('./try-guard.mjs', import.meta.url));
export const STAND_INS = Object.freeze(['gh', 'glab', 'az']);
/** D56: the permission rules a try adds (guardrails.mjs NORMAL_DENY's push and publish pairs, plus the forge CLIs). */
export const TRY_DENY = Object.freeze([
  'Bash(git push)', 'Bash(git push:*)', 'Bash(git remote add:*)', 'Bash(git remote set-url:*)',
  'Bash(gh)', 'Bash(gh:*)', 'Bash(glab)', 'Bash(glab:*)', 'Bash(az)', 'Bash(az:*)',
  'Bash(npm publish)', 'Bash(npm publish:*)', 'Bash(yarn publish)', 'Bash(yarn publish:*)', 'Bash(pnpm publish)', 'Bash(pnpm publish:*)',
  'Bash(yarn npm publish)', 'Bash(yarn npm publish:*)',
]);
// Forward slashes, as host-guard.mjs:38-47 does: JSON would double each backslash, and both shells accept them.
const fwd = (s) => String(s).replaceAll('\\', '/');
export const standInDir = (home = worcaHome()) => join(home, 'workflow-tests', 'bin');
const noAuthDir = (home, name) => join(home, 'workflow-tests', 'no-auth', name);

/**
 * A stand-in for Git Bash and sh (no extension) and its cmd.exe twin (.cmd, CRLF).
 * The twin never puts %* on a line cmd parses again: `node … %*` would run `echo hi` from `gh x^&echo hi`. It echoes
 * `rem #%*#` into a temp file instead (rem's text is not parsed, so & | < > ) and quotes are written as they came) and the
 * CLI reads the arguments from that file (try-guard.mjs --args-file). What cmd itself already did to the line before the
 * stand-in started (its own & split, %VAR% expansion, ^ removal) cannot be undone here. The answer is exit 1 either way.
 */
export function standInFiles(name, { node = process.execPath, script = TRY_GUARD_PATH } = {}) {
  const cmd = [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    'if not defined TEMP set "TEMP=%~dp0."',
    'set "WORCA_STAND_IN_ARGS=%TEMP%\\worca-stand-in-%RANDOM%-%RANDOM%.txt"',
    'set "prompt=$_"',
    '> "%WORCA_STAND_IN_ARGS%" (',
    '  echo on',
    '  for %%a in (1) do (',
    'rem #%*#',
    ')',
    ')',
    '@echo off',
    `"${node}" "${script}" --stand-in ${name} --args-file "%WORCA_STAND_IN_ARGS%"`,
    'del "%WORCA_STAND_IN_ARGS%" >nul 2>nul',
    'exit /b 1',
    '',
  ].join('\r\n');
  return { sh: `#!/bin/sh\nexec "${fwd(node)}" "${fwd(script)}" --stand-in ${name} "$@"\n`, cmd };
}

/** Writes `text` only when the file differs, through a temp file in the same folder and a rename: a try starting while
 *  another refreshes the folder never runs a half-written stand-in. */
function writeIfChanged(file, text, mode = null) {
  let same = false;
  try { same = readFileSync(file, 'utf8') === text; } catch { /* missing: write it */ }
  if (!same) {
    const tmp = `${file}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      writeFileSync(tmp, text);
      if (mode != null) { try { chmodSync(tmp, mode); } catch { /* Windows has no exec bit */ } }
      renameSync(tmp, file);
    } catch { /* in use (a running .cmd on Windows) or unwritable: the old file stays, the other layers hold */ }
    finally { try { rmSync(tmp, { force: true }); } catch { /* renamed away */ } }
  }
  if (mode != null) { try { chmodSync(file, mode); } catch { /* Windows has no exec bit */ } }
}

/** The stand-in folder, refreshed only when a file differs. Never throws: without it, the hook and the git env still hold. */
export function ensureStandIns(home = worcaHome()) {
  const dir = standInDir(home);
  try {
    mkdirSync(dir, { recursive: true });
    for (const name of STAND_INS) {
      const f = standInFiles(name);
      writeIfChanged(join(dir, name), f.sh, 0o755);
      writeIfChanged(join(dir, `${name}.cmd`), f.cmd);
      mkdirSync(noAuthDir(home, name), { recursive: true });
    }
  } catch { /* an unwritable home */ }
  return dir;
}

const pathKeyOf = (env) => Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';

/**
 * `env` with a try's outward guard (D56). `tryGuard` null returns `env` itself.
 * - PATH: the stand-ins first, written to the env's own key (`Path` on Windows); any other spelling of PATH is dropped.
 * - git: no terminal prompt, Git Credential Manager never interactive, ssh fails at once, every credential helper reset.
 * - gh / glab / az found some other way (a script's spawn('gh') skips .cmd on Windows): empty config, so no sign-in.
 * - Windows: WSLENV carries the git settings and the empty sign-in folders into WSL (its own git and gh).
 * Stated limit: a web call with a token typed into the command can still go out (no network block yet).
 */
export function withTryGuardEnv(env, tryGuard, { home = worcaHome(), platform = process.platform } = {}) {
  if (!tryGuard) return env;
  const out = { ...(env ?? process.env) };
  const key = pathKeyOf(out);
  const dir = ensureStandIns(home);
  const sep = platform === 'win32' ? ';' : ':';
  const cur = out[key] || '';
  out[key] = cur.split(sep).includes(dir) ? cur : cur ? `${dir}${sep}${cur}` : dir;
  for (const k of Object.keys(out)) if (k !== key && k.toUpperCase() === 'PATH') delete out[k];
  out[TRY_GUARD_LOG_ENV] = tryGuard.logFile;
  out.GIT_TERMINAL_PROMPT = '0';
  out.GCM_INTERACTIVE = 'never';
  out.GIT_SSH_COMMAND = 'exit 1 #';
  out.GH_CONFIG_DIR = noAuthDir(home, 'gh');
  out.GLAB_CONFIG_DIR = noAuthDir(home, 'glab');
  out.AZURE_CONFIG_DIR = noAuthDir(home, 'az');
  const n = Number.parseInt(out.GIT_CONFIG_COUNT || '0', 10) || 0;   // appended: an empty helper resets the list before it
  out[`GIT_CONFIG_KEY_${n}`] = 'credential.helper';
  out[`GIT_CONFIG_VALUE_${n}`] = '';
  out.GIT_CONFIG_COUNT = String(n + 1);
  if (platform === 'win32') {
    // WSL's own git and gh (wsl git push, bash.exe -c "gh pr create") see none of the above unless WSLENV names it: the
    // git settings as they are, the sign-in folders as WSL paths (/p). Entries already there are kept.
    const wk = Object.keys(out).find((k) => k.toUpperCase() === 'WSLENV') || 'WSLENV';
    const prev = String(out[wk] || '').split(':').filter(Boolean);
    const named = new Set(prev.map((e) => e.split('/')[0].toUpperCase()));
    const add = ['GIT_TERMINAL_PROMPT', 'GCM_INTERACTIVE', 'GIT_SSH_COMMAND', 'GH_CONFIG_DIR/p', 'GLAB_CONFIG_DIR/p', 'AZURE_CONFIG_DIR/p', 'GIT_CONFIG_COUNT',
      ...Array.from({ length: n + 1 }, (_, i) => [`GIT_CONFIG_KEY_${i}`, `GIT_CONFIG_VALUE_${i}`]).flat()];
    out[wk] = [...prev, ...add.filter((e) => !named.has(e.split('/')[0].toUpperCase()))].join(':');
  }
  return out;
}

/** The PreToolUse hook entry buildSettingsPayload adds for a try, beside the host guard: on Bash, and on the PowerShell
 *  tool Claude Code has on Windows. */
export function tryGuardHookEntry() {
  const q = (s) => JSON.stringify(fwd(s));
  return { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: `${q(process.execPath)} ${q(TRY_GUARD_PATH)}` }] };
}

/** Permission rules with the try's deny list added. */
export function withTryDeny(rules) {
  const r = rules && typeof rules === 'object' && !Array.isArray(rules) ? rules : {};
  return { ...r, deny: [...new Set([...(Array.isArray(r.deny) ? r.deny : []), ...TRY_DENY])] };
}
