// src/core/workflow-tests/try-guard-env.mjs — a test try's outward guard in its environment and settings (D56): the gh /
// glab / az stand-ins first on PATH, git that cannot sign in, forge CLIs with no sign-in of their own, the PreToolUse hook
// and the deny list. Every function returns its input unchanged without a guard, so every other spawn is byte-identical.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
]);
// Forward slashes, as host-guard.mjs:38-47 does: JSON would double each backslash, and both shells accept them.
const fwd = (s) => String(s).replaceAll('\\', '/');
export const standInDir = (home = worcaHome()) => join(home, 'workflow-tests', 'bin');
const noAuthDir = (home, name) => join(home, 'workflow-tests', 'no-auth', name);

/** A stand-in for Git Bash and sh (no extension) and its cmd.exe twin (.cmd, CRLF). */
export function standInFiles(name, { node = process.execPath, script = TRY_GUARD_PATH } = {}) {
  return {
    sh: `#!/bin/sh\nexec "${fwd(node)}" "${fwd(script)}" --stand-in ${name} "$@"\n`,
    cmd: `@echo off\r\n"${node}" "${script}" --stand-in ${name} %*\r\nexit /b %ERRORLEVEL%\r\n`,
  };
}

function writeIfChanged(file, text, mode = null) {
  let same = false;
  try { same = readFileSync(file, 'utf8') === text; } catch { /* missing: write it */ }
  if (!same) writeFileSync(file, text);
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
  return out;
}

/** The PreToolUse hook entry buildSettingsPayload adds for a try, beside the host guard. */
export function tryGuardHookEntry() {
  const q = (s) => JSON.stringify(fwd(s));
  return { matcher: 'Bash', hooks: [{ type: 'command', command: `${q(process.execPath)} ${q(TRY_GUARD_PATH)}` }] };
}

/** Permission rules with the try's deny list added. */
export function withTryDeny(rules) {
  const r = rules && typeof rules === 'object' && !Array.isArray(rules) ? rules : {};
  return { ...r, deny: [...new Set([...(Array.isArray(r.deny) ? r.deny : []), ...TRY_DENY])] };
}
