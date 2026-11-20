// src/core/terminal/shell.mjs — which shell a terminal runs and how it starts (issue #573). bash and
// zsh load worca's rc snippets (rc/), which print the command markers markers.mjs reads; any other
// shell runs plain: a working terminal with no command blocks. On Windows the bash is Git Bash.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'rc');
export const BASH_RC = join(RC_DIR, 'worca.bash');

export const shellKind = (file, platform = process.platform) => {
  const b = platform === 'win32'
    ? win32.basename(String(file || '')).toLowerCase().replace(/\.exe$/, '')
    : posix.basename(String(file || ''));
  return b === 'bash' || b === 'zsh' ? b : 'other';
};

/** WSL's launcher (System32\bash.exe, the WindowsApps alias) runs Linux on another filesystem: never a worca shell. */
export function isWslLauncher(file, env = {}) {
  const f = win32.normalize(String(file || '')).toLowerCase();
  const sys = win32.normalize(env.SystemRoot || env.SYSTEMROOT || env.windir || env.WINDIR || 'C:\\Windows').toLowerCase().replace(/\\+$/, '');
  return f.startsWith(`${sys}\\`) || f.includes('\\microsoft\\windowsapps\\');
}

/** The first git.exe on PATH (a short walk: this module stays a leaf, no actions graph). */
function gitOnPath(env, exists) {
  for (const raw of String(env.PATH ?? env.Path ?? '').split(';')) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1');
    if (!dir) continue;
    const f = win32.join(dir, 'git.exe');
    if (!isWslLauncher(f, env) && exists(f)) return f;
  }
  return null;
}

/** The Git install a git.exe belongs to: <Git>\cmd\git.exe, <Git>\bin\git.exe, <Git>\mingw64\bin\git.exe → <Git>. */
function gitRoot(git) {
  const dir = win32.dirname(git);
  return /[\\/](?:mingw32|mingw64|clangarm64|ucrt64)[\\/]bin$/i.test(dir) ? win32.dirname(win32.dirname(dir)) : win32.dirname(dir);
}

/** Git Bash candidates in order: WORCA_TERMINAL_SHELL, CLAUDE_CODE_GIT_BASH_PATH, the install folders, next to git.exe. */
export function windowsBashCandidates(env = {}, exists = existsSync) {
  const out = [env.WORCA_TERMINAL_SHELL, env.CLAUDE_CODE_GIT_BASH_PATH];
  for (const root of [env.ProgramFiles, env.ProgramW6432, env['ProgramFiles(x86)']]) if (root) out.push(win32.join(root, 'Git', 'bin', 'bash.exe'));
  if (env.LOCALAPPDATA) out.push(win32.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'));
  const git = gitOnPath(env, exists);
  if (git) out.push(win32.join(gitRoot(git), 'bin', 'bash.exe'));
  return [...new Set(out.filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim()))];
}

/** The server user's $SHELL, else bash, else sh. Windows: Git Bash (windowsBashCandidates), else ComSpec (cmd.exe). */
export function pickShell({ env = process.env, platform = process.platform, exists = existsSync } = {}) {
  if (platform === 'win32') {
    const file = windowsBashCandidates(env, exists).find((f) => win32.isAbsolute(f) && !isWslLauncher(f, env) && exists(f));
    return file ? { file, kind: shellKind(file, platform), platform } : { file: env.ComSpec || 'cmd.exe', kind: 'other', platform };
  }
  const file = [env.SHELL, '/bin/bash', '/usr/bin/bash', '/bin/sh']
    .find((f) => typeof f === 'string' && f.startsWith('/') && exists(f)) || '/bin/sh';
  return { file, kind: shellKind(file, platform), platform };
}

/** runCommand's NO_BLOCKS text: on Windows, how to get a shell that records commands. */
export function noBlocksMessage(platform = process.platform) {
  return platform === 'win32'
    ? 'This shell does not record commands: no Git Bash was found. Install Git for Windows (https://git-scm.com/download/win), or set WORCA_TERMINAL_SHELL to the full path of bash.exe and restart Worca, then open a new terminal.'
    : 'This shell does not record commands (bash or zsh is needed).';
}

/** One `worca doctor` line: the shell a terminal would use here, and whether it records commands. */
export function shellDoctorLine(shell, env = process.env) {
  const win = shell.platform === 'win32';
  const ignored = win && env.WORCA_TERMINAL_SHELL && env.WORCA_TERMINAL_SHELL.trim() !== shell.file
    ? `; WORCA_TERMINAL_SHELL=${env.WORCA_TERMINAL_SHELL} was ignored (not found, or WSL's bash)` : '';
  if (shell.kind !== 'other') return `terminal shell: ${shell.file} (${shell.kind}; commands are recorded as blocks${ignored})`;
  const fix = win ? 'install Git for Windows, or set WORCA_TERMINAL_SHELL to the full path of bash.exe' : 'set SHELL to bash or zsh';
  return `terminal shell: ${shell.file} (no command blocks — ${fix}${ignored})`;
}

/**
 * argv and env additions that start `shell` interactively, with worca's markers when it can. `nonce`
 * (D12) reaches the rc snippets as WORCA_TERMINAL_NONCE; they unset it before anything else runs.
 */
export function shellLaunch(shell, { env = process.env, zshDir = null, nonce = null } = {}) {
  const mark = nonce ? { WORCA_TERMINAL_NONCE: nonce } : {};
  if (shell.kind === 'bash') {
    const rc = shell.platform === 'win32' ? BASH_RC.replace(/\\/g, '/') : BASH_RC;   // Git Bash reads C:/x/rc/worca.bash
    return { args: ['--rcfile', rc, '-i'], env: { BASH_SILENCE_DEPRECATION_WARNING: '1', ...mark } };
  }
  if (shell.kind === 'zsh' && zshDir) {
    return { args: ['-i'], env: { ZDOTDIR: zshDir, WORCA_USER_ZDOTDIR: env.ZDOTDIR || env.HOME || '', ...mark } };
  }
  return { args: shell.platform === 'win32' ? [] : ['-i'], env: {} };
}

/** Copy the zsh rc files into `dir` under the names zsh reads; a no-op when they are current. */
export function ensureZshDir(dir) {
  mkdirSync(dir, { recursive: true });
  for (const [src, dest] of [['zshenv.zsh', '.zshenv'], ['zshrc.zsh', '.zshrc']]) {
    const want = readFileSync(join(RC_DIR, src), 'utf8');
    const at = join(dir, dest);
    let have = null;
    try { have = readFileSync(at, 'utf8'); } catch { /* first use */ }
    if (have !== want) writeFileSync(at, want);
  }
  return dir;
}
