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
/** Final review I3: where the guard records when a try's own log file is not known (its run folder is gone). The guard never
 *  fails open: a try path with no log file still gets every env layer, writing here. */
export const scratchTryLog = (home = worcaHome()) => join(home, 'workflow-tests', 'unbound-calls.ndjson');

/** Final review I2: an empty folder Worca's own git in a try's copy uses as core.hooksPath, so no hook the copy holds runs. */
export const noHooksDir = (home = worcaHome()) => join(home, 'workflow-tests', 'no-hooks');
/** Settings in the copy's config (shared by every checkout of it; a setup like husky or an agent can write them) that make
 *  git run a program: off for every git call Worca itself makes in a try's copy. Signing is off too: a try's commits never
 *  leave Worca's copy, and gpg.program is a program the config names. */
function safeGitPairs(home) {
  const dir = noHooksDir(home);
  try { mkdirSync(dir, { recursive: true }); } catch { /* an unwritable home: git then finds no such folder, which runs no hook either */ }
  return [['core.hooksPath', fwd(dir)], ['core.fsmonitor', 'false'], ['commit.gpgsign', 'false']];
}
/** The same settings as `-c` arguments, to put before a git subcommand. */
export function safeGitArgs(home = worcaHome()) {
  return safeGitPairs(home).flatMap(([k, v]) => ['-c', `${k}=${v}`]);
}
/** `args` with safeGitArgs after any leading `-c` pairs of the caller, so the safe values win (the last -c wins). */
export function withSafeGitArgs(args, home = worcaHome()) {
  let i = 0;
  while (args[i] === '-c' && i + 1 < args.length) i += 2;
  return [...args.slice(0, i), ...safeGitArgs(home), ...args.slice(i)];
}
/** `env` with the same settings as GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n entries (they reach every git process a git spawns). */
export function withSafeGitConfig(env, home = worcaHome()) {
  const out = { ...(env ?? process.env) };
  let n = Number.parseInt(out.GIT_CONFIG_COUNT || '0', 10) || 0;
  for (const [k, v] of safeGitPairs(home)) { out[`GIT_CONFIG_KEY_${n}`] = k; out[`GIT_CONFIG_VALUE_${n}`] = v; n += 1; }
  out.GIT_CONFIG_COUNT = String(n);
  return out;
}
/** The env Worca's own git runs with in a try's copy: the outward guard (no token, no sign-in; `logFile` or the scratch log)
 *  and the safe git settings. */
export function tryGitEnv({ logFile = null, env = process.env, home = worcaHome(), platform = process.platform } = {}) {
  return withSafeGitConfig(withTryGuardEnv(env, { logFile: logFile || scratchTryLog(home) }, { home, platform }), home);
}
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
 * - Tokens stripped, any spelling, never forwarded through WSLENV (isTryStrippedKey):
 *   forge / CI: GH_TOKEN, GITHUB_TOKEN, GH_ENTERPRISE_TOKEN, GITHUB_ENTERPRISE_TOKEN, GH_PAT, GITHUB_PAT, GITLAB_TOKEN,
 *   GLAB_TOKEN, GL_TOKEN, CI_JOB_TOKEN, GITEA_TOKEN, BITBUCKET_TOKEN, BITBUCKET_APP_PASSWORD, AZURE_DEVOPS_EXT_PAT,
 *   SYSTEM_ACCESSTOKEN, ACTIONS_ID_TOKEN_REQUEST_TOKEN / _URL, ACTIONS_RUNTIME_TOKEN;
 *   publish / deploy: CARGO_REGISTRY_TOKEN, TWINE_PASSWORD, TWINE_USERNAME, UV_PUBLISH_TOKEN, UV_PUBLISH_PASSWORD,
 *   GEM_HOST_API_KEY, HELM_REGISTRY_PASSWORD, DOCKER_AUTH_CONFIG, PYPI_API_TOKEN, CR_PAT, QUAY_TOKEN, JFROG_ACCESS_TOKEN,
 *   HEX_API_KEY, SONATYPE_PASSWORD, VERCEL_TOKEN, NETLIFY_AUTH_TOKEN, POETRY_PYPI_TOKEN_*;
 *   install-side: NPM_TOKEN, NODE_AUTH_TOKEN, YARN_NPM_AUTH_TOKEN, YARN_NPM_AUTH_IDENT, NUGET_AUTH_TOKEN (a private
 *   NuGet feed), npm_config_*_auth* / *_password / *username, CARGO_REGISTRIES_*_TOKEN, POETRY_HTTP_BASIC_*_PASSWORD.
 *   The setup step ("Before each try, run") alone passes `tryGuard.keepRegistryAuth`: it keeps the install-side ones,
 *   never a forge, CI or publish-only one. Setup is trusted: it is the person's own command and runs before the agent
 *   changed anything; a setup command that itself publishes is the person's own choice. The agents and the checks (the
 *   command check, Library scripts) get the full strip: by then the agent may have changed scripts.
 * What the guard covers (with the hook, try-guard.mjs): Bash and the CLI's PowerShell tool, nested shells, WSL (wsl,
 * wslg, distro launchers, System32 bash.exe; WSLENV for WSL's git and gh), pipes and here-strings into a shell, and a
 * structured deny with an exit-2 fallback.
 * The hook's parser is best-effort recording: what stops a send is these env layers (no sign-in for git, the forge
 * CLIs and the stripped tokens) and the try's remote-less copy; for publishers and image pushes whose tokens sit in
 * files (~/.npmrc, ~/.docker/config.json), the hook is the only layer. By design a try denies an expanded subcommand
 * of a publisher (`yarn $SCRIPT`, `pnpm $SCRIPT`, `bun $FILE`, `npm "$@"`): it could be publish. Parser limits (read as
 * plain commands, not stopped by the hook): a `$( )` / backtick of any program other than a literal writer, a decoder
 * or a download landing in eval / a shell (`eval "$(cat cmds.txt)"`, `bash -c "$(cat script.sh)"`); a gh / glab verb
 * counted as a read (`$GH label clone`); names and values set outside the command line (variables, aliases,
 * functions); interpreters and scripts (`node -e`, `python -c`, make, npm scripts); word building the shell does that
 * the parser does not (brace expansion `{g,}it`, `${x:0:3}`, `${x//a/b}`, arrays); encodings other than \x / octal /
 * \u / \c (rev, a variable's value); PowerShell string building (`'gi'+'t'`, `&('g'+'it')`, `-join`).
 * Stated limits (not covered, no network block yet): a web call with a token typed into the command; `npm publish` run
 * from inside a script (npm run …, make, a test); web calls from `node -e` / `python -c` / any program; shell aliases,
 * Set-Alias or a git alias configured in an earlier, separate command; tokens a WSL profile sets (GH_TOKEN in
 * ~/.bashrc, /etc/environment); tokens in files (~/.npmrc, ~/.docker/config.json, gh / glab config inside WSL);
 * git http.extraheader / url.insteadOf tokens; image pushes beyond docker / podman / nerdctl push, image / manifest /
 * compose push, build --push, buildah push, skopeo copy to docker://, crane push / copy and helm push (e.g. oras, ko,
 * jib, kaniko, or an image tool run through a package runner: `pnpm dlx <image tool> push`); other credential env vars
 * than those listed above; `curl -K` config files; a PowerShell -Method given as a variable; Send-MailMessage and .NET web calls
 * other than Upload* / *Async.
 */
export function withTryGuardEnv(env, tryGuard, { home = worcaHome(), platform = process.platform } = {}) {
  if (!tryGuard) return env;
  const out = { ...(env ?? process.env) };
  // No forge token in a try; no registry token either, but for the setup step (`keepRegistryAuth`, the person's own
  // command, run before the agent changed anything: `npm ci` from a private registry keeps working).
  const strip = { keepRegistryAuth: tryGuard.keepRegistryAuth === true };
  for (const k of Object.keys(out)) if (isTryStrippedKey(k, strip)) delete out[k];
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
    const prev = String(out[wk] || '').split(':').filter((e) => e && !ours.has(e.split('/')[0].toUpperCase()) && !isTryStrippedKey(e.split('/')[0], strip));
    out[wk] = [...prev, ...add].join(':');
  }
  return out;
}

/** Forge and CI tokens a try's env never carries (any spelling of the name: Windows env names ignore case). The spawn
 *  env already drops the GitHub / Azure ones for agents (host-credentials.mjs); this covers every try path (shell and
 *  script steps too) and the others. */
export const TRY_FORGE_TOKEN_KEYS = Object.freeze(['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_PAT', 'GITHUB_PAT',
  'GITLAB_TOKEN', 'GLAB_TOKEN', 'GL_TOKEN', 'CI_JOB_TOKEN', 'GITEA_TOKEN', 'BITBUCKET_TOKEN', 'BITBUCKET_APP_PASSWORD', 'AZURE_DEVOPS_EXT_PAT', 'SYSTEM_ACCESSTOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_RUNTIME_TOKEN']);
/** Publish / deploy credentials: never in a try, the setup step included (installing needs none of them). */
export const TRY_PUBLISH_TOKEN_KEYS = Object.freeze(['CARGO_REGISTRY_TOKEN', 'TWINE_PASSWORD', 'TWINE_USERNAME', 'UV_PUBLISH_TOKEN', 'UV_PUBLISH_PASSWORD',
  'GEM_HOST_API_KEY', 'HELM_REGISTRY_PASSWORD', 'DOCKER_AUTH_CONFIG', 'PYPI_API_TOKEN', 'CR_PAT', 'QUAY_TOKEN', 'JFROG_ACCESS_TOKEN', 'HEX_API_KEY',
  'SONATYPE_PASSWORD', 'VERCEL_TOKEN', 'NETLIFY_AUTH_TOKEN']);
const PUBLISH_TOKEN_RE = /^POETRY_PYPI_TOKEN_/i;
/** Install-side registry auth: dropped for the agents and the checks; the setup step keeps it (`keepRegistryAuth`).
 *  Also by pattern: npm_config_*_auth* / *_password / *_username, CARGO_REGISTRIES_<NAME>_TOKEN and
 *  POETRY_HTTP_BASIC_<NAME>_PASSWORD (a private registry `cargo fetch` / `poetry install` reads from). */
export const TRY_REGISTRY_TOKEN_KEYS = Object.freeze(['NPM_TOKEN', 'NODE_AUTH_TOKEN', 'YARN_NPM_AUTH_TOKEN', 'YARN_NPM_AUTH_IDENT', 'NUGET_AUTH_TOKEN']);
const INSTALL_AUTH_RES = [/^npm_config_(.*[_:])?(auth|password|username)/i, /^CARGO_REGISTRIES_.+_TOKEN$/i, /^POETRY_HTTP_BASIC_.+_PASSWORD$/i];
export const TRY_STRIPPED_KEYS = Object.freeze([...TRY_FORGE_TOKEN_KEYS, ...TRY_PUBLISH_TOKEN_KEYS, ...TRY_REGISTRY_TOKEN_KEYS]);
const ALWAYS = new Set([...TRY_FORGE_TOKEN_KEYS, ...TRY_PUBLISH_TOKEN_KEYS]);
const INSTALL = new Set(TRY_REGISTRY_TOKEN_KEYS);
const isInstallAuthKey = (k) => INSTALL.has(String(k).toUpperCase()) || INSTALL_AUTH_RES.some((re) => re.test(String(k)));
/** Whether a try's env drops `k`: every forge, CI and publish-only token; install-side registry auth unless
 *  `keepRegistryAuth` (the setup step). */
export const isTryStrippedKey = (k, { keepRegistryAuth = false } = {}) => ALWAYS.has(String(k).toUpperCase()) || PUBLISH_TOKEN_RE.test(String(k))
  || (!keepRegistryAuth && isInstallAuthKey(k));

/** The PreToolUse hook entry buildSettingsPayload adds for a try, beside the host guard: on Bash, and on the PowerShell
 *  tool Claude Code has on Windows. */
export function tryGuardHookEntry() {
  const q = (s) => JSON.stringify(fwd(s));
  return { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: `${q(process.execPath)} ${q(TRY_GUARD_PATH)}` }] };
}

// ── Task 5 fix review (concern 8): the settings canary ──────────────────────────────────────────────────────────────────
// Claude Code drops a --settings file it rejects WHOLE and silently (C1), Worca's guards with it. In a Pretend try Worca's
// payload also carries a SessionStart hook that writes a marker into the try's run folder; a spawn that started a session
// and ended without it gets one run warning, and the run folder's SETTINGS_IGNORED_FILE marks the try as Worca's problem
// (runner.mjs worcaProblemOf 'settings'): it is set aside and made again once.
export const SETTINGS_CANARY_PATH = fileURLToPath(new URL('./settings-canary.mjs', import.meta.url));
/** The canary's marker file names in a try's run folder (the spawn adds a random part, and removes it when it ends). */
export const SETTINGS_CANARY_PREFIX = '.worca-settings-canary-';
/** Written in a try's run folder when a spawn ran without Worca's settings; readTryOutcome reads it. */
export const SETTINGS_IGNORED_FILE = 'settings-ignored.ndjson';
/** The run warning for it (also the carry warning line's text). Re-review 2 (n6): not only a dropped settings file; a managed
 *  `disableAllHooks` / `allowManagedHooksOnly` also keeps Worca's hooks from running. */
export const SETTINGS_IGNORED_TEXT = 'Claude Code did not load Worca\'s settings for this try (an invalid settings file or a managed hooks policy): its guards may not have applied.';
/** The SessionStart hook entry that writes `marker`. */
export function settingsCanaryHookEntry(marker) {
  const q = (s) => JSON.stringify(fwd(s));
  return { hooks: [{ type: 'command', command: `${q(process.execPath)} ${q(SETTINGS_CANARY_PATH)} ${q(marker)}` }] };
}

/** Permission rules with the try's deny list added. */
export function withTryDeny(rules) {
  const r = rules && typeof rules === 'object' && !Array.isArray(rules) ? rules : {};
  return { ...r, deny: [...new Set([...(Array.isArray(r.deny) ? r.deny : []), ...TRY_DENY])] };
}
