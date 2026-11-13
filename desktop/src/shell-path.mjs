// desktop/src/shell-path.mjs — the user's login-shell PATH for the server the desktop app starts (docs/desktop.md).
// An app opened from the Dock or Finder gets launchd's short PATH (/usr/bin:/bin:…), so claude, git, node from
// mise/nvm/Homebrew would be missing. Only PATH is taken; other exported vars are not. Imports only node: builtins.
import { execFile as realExecFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export const PATH_MARK = '__WORCA_PATH__';
export const FALLBACK_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '<home>/.local/bin'];

/** `-ilc` runs the rc files a terminal would; the markers fence PATH from banners and echoes. */
export function loginShellCommand(shell) {
  return { file: shell, args: ['-ilc', `printf '\\n${PATH_MARK}%s${PATH_MARK}\\n' "$PATH"`] };
}

/** PATH between the LAST pair of markers, trimmed; null when there is no pair, it is empty or holds a newline. */
export function parseLoginShellPath(stdout) {
  const text = String(stdout || '');
  const end = text.lastIndexOf(PATH_MARK);
  if (end < 0) return null;
  const start = text.lastIndexOf(PATH_MARK, end - 1);
  if (start < 0) return null;
  const value = text.slice(start + PATH_MARK.length, end).trim();
  if (!value || /[\r\n]/.test(value)) return null;
  return value;
}

/** `first`'s entries, then `second`'s new ones; empty and duplicate entries dropped. */
export function mergePath(first, second, sep = ':') {
  const out = [];
  for (const part of [first, second]) {
    for (const p of String(part || '').split(sep)) if (p && !out.includes(p)) out.push(p);
  }
  return out.join(sep);
}

function defaultShell(platform, env) {
  const s = String(env.SHELL || '');
  if (s && isAbsolute(s)) return s;
  return platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
}

/** Never throws: win32 → skipped; a failure → the inherited PATH plus the fallback dirs that exist. */
export async function readLoginShellPath({ platform = process.platform, env = process.env, home, execFile = realExecFile, timeoutMs = 5000 } = {}) {
  if (platform === 'win32') return { path: null, source: 'skipped' };
  const fallback = (error) => {
    const dirs = FALLBACK_DIRS.map((d) => d.replace('<home>', home || '')).filter((d) => { try { return existsSync(d); } catch { return false; } });
    return { path: mergePath(dirs.join(':'), env.PATH), source: 'fallback', error: String(error) };
  };
  const { file, args } = loginShellCommand(defaultShell(platform, env));
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile(file, args, { timeout: timeoutMs, env: { ...env, TERM: 'dumb' }, encoding: 'utf8' }, (err, out) => (err ? reject(err) : resolve(out)));
    });
    const path = parseLoginShellPath(stdout);
    return path ? { path, source: 'login-shell' } : fallback(`${file} printed no PATH`);
  } catch (err) {
    return fallback(err && err.message ? err.message : err);
  }
}
