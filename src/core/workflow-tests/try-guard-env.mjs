// src/core/workflow-tests/try-guard-env.mjs — a test try's outward guard in its environment and settings (D56): the gh /
// glab / az stand-ins first on PATH, git that cannot sign in, forge CLIs with no sign-in of their own, the PreToolUse hook
// and the deny list. Every function returns its input unchanged without a guard, so every other spawn is byte-identical.
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { worcaHome } from '../projects.mjs';
import { TRY_GUARD_JSON_ENV, TRY_GUARD_LOG_ENV } from './try-guard.mjs';

export const TRY_GUARD_PATH = fileURLToPath(new URL('./try-guard.mjs', import.meta.url));
/** The lowest Claude Code seen to honour the hook's structured deny (hookSpecificOutput.permissionDecision "deny"):
 *  the free proof ran 2.1.304. Older or unknown: the hook answers with stderr + exit 2, which every version blocks on. */
export const TRY_GUARD_MIN_CLAUDE = '2.1.304';
/** Whether a `claude --version` (as probeClaudeCapabilities reads it) is at or above TRY_GUARD_MIN_CLAUDE; null, unknown
 *  or unreadable is no. Pure. */
export function claudeReadsStructuredDeny(version, min = TRY_GUARD_MIN_CLAUDE) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? '').trim());
  if (!m) return false;
  const want = min.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) { const v = Number(m[i + 1]); if (v !== want[i]) return v > want[i]; }
  return true;
}
export const STAND_INS = Object.freeze(['gh', 'glab', 'az']);
const DENIED_COMMANDS = ['git push', 'git push:*', 'git remote add:*', 'git remote set-url:*', 'gh', 'gh:*', 'glab', 'glab:*', 'az', 'az:*',
  'npm publish', 'npm publish:*', 'yarn publish', 'yarn publish:*', 'pnpm publish', 'pnpm publish:*', 'yarn npm publish', 'yarn npm publish:*'];
/** D56: the permission rules a try adds (guardrails.mjs NORMAL_DENY's push and publish pairs, plus the forge CLIs), for
 *  Bash and for the CLI's PowerShell tool (the free proof saw 2.1.304 refuse `PowerShell(git push:*)`). */
export const TRY_DENY = Object.freeze([...DENIED_COMMANDS.map((c) => `Bash(${c})`), ...DENIED_COMMANDS.map((c) => `PowerShell(${c})`)]);
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
 * - WORCA_TRY_GUARD_JSON=1 only with `tryGuard.structuredDeny` (a CLI at or above TRY_GUARD_MIN_CLAUDE).
 * What the guard covers (with the hook, try-guard.mjs): Bash and the CLI's PowerShell tool, nested shells, WSL (wsl,
 * wslg, distro launchers, System32 bash.exe; WSLENV for WSL's git and gh), pipes and here-strings into a shell, and a
 * structured deny with an exit-2 fallback.
 * Stated limits (not covered, no network block yet): a web call with a token typed into the command; `npm publish` run
 * from inside a script (npm run …, make, a test); web calls from `node -e` / `python -c` / any program; shell aliases,
 * Set-Alias or a git alias configured in an earlier, separate command; tokens a WSL profile sets (GH_TOKEN in
 * ~/.bashrc, /etc/environment); git http.extraheader / url.insteadOf tokens; docker push forms beyond push, image /
 * manifest / compose push and build --push; `curl -K` config files; a PowerShell -Method given as a variable;
 * Send-MailMessage and .NET web calls other than Upload* / *Async.
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
  // The hook's structured deny only for a CLI known to read it (the harness probed it); else the hook uses exit 2.
  for (const k of Object.keys(out)) if (k.toUpperCase() === TRY_GUARD_JSON_ENV) delete out[k];
  if (tryGuard.structuredDeny === true) out[TRY_GUARD_JSON_ENV] = '1';
  if (platform === 'win32') {
    // WSL's own git and gh (wsl git push, bash.exe -c "gh pr create") see none of the above unless WSLENV names it: the
    // git settings as they are, the sign-in folders as WSL paths (/p). Other entries are kept; an entry for one of these
    // names is replaced, so its flags are always the guard's (GH_CONFIG_DIR/p, never a bare Windows path).
    const wk = Object.keys(out).find((k) => k.toUpperCase() === 'WSLENV') || 'WSLENV';
    const add = ['GIT_TERMINAL_PROMPT', 'GCM_INTERACTIVE', 'GIT_SSH_COMMAND', 'GH_CONFIG_DIR/p', 'GLAB_CONFIG_DIR/p', 'AZURE_CONFIG_DIR/p', 'GIT_CONFIG_COUNT',
      ...Array.from({ length: n + 1 }, (_, i) => [`GIT_CONFIG_KEY_${i}`, `GIT_CONFIG_VALUE_${i}`]).flat()];
    const ours = new Set(add.map((e) => e.split('/')[0].toUpperCase()));
    const prev = String(out[wk] || '').split(':').filter((e) => e && !ours.has(e.split('/')[0].toUpperCase()));
    out[wk] = [...prev, ...add].join(':');
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
