// src/core/actions/builtins.mjs — the four built-in actions. Detection is injectable
// (platform, env, exists) so every OS is tested from any OS.
import { buildLauncherCommand, launcherLabel } from './launcher.mjs';
import { statSync } from 'node:fs';

const EDITORS = [['code', 'VS Code'], ['cursor', 'Cursor'], ['idea', 'IntelliJ IDEA'], ['webstorm', 'WebStorm']];
const LINUX_TERMS = [
  ['gnome-terminal', 'Terminal', (d) => [`--working-directory=${d}`]],
  ['konsole', 'Konsole', (d) => ['--workdir', d]],
  ['xfce4-terminal', 'Terminal', (d) => [`--working-directory=${d}`]],
  ['x-terminal-emulator', 'Terminal', () => []],
];
const defaultExists = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

export function findOnPath(name, { env = process.env, platform = process.platform, exists = defaultExists } = {}) {
  const pathVar = env.PATH ?? env.Path ?? '';
  const delim = platform === 'win32' ? ';' : ':';
  const exts = platform === 'win32' ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';') : [''];
  const joinP = platform === 'win32' ? (a, b) => `${a.replace(/\\+$/, '')}\\${b}` : (a, b) => `${a.replace(/\/+$/, '')}/${b}`;
  for (const dir of pathVar.split(delim).filter(Boolean)) {
    for (const ext of exts) { const p = joinP(dir, name + ext); if (exists(p)) return p; }
  }
  return null;
}

const hasDisplay = (env) => !!(env.DISPLAY || env.WAYLAND_DISPLAY);

export function detectBuiltins({ platform = process.platform, env = process.env, exists = defaultExists, overrides = {} } = {}) {
  const find = (n) => findOnPath(n, { env, platform, exists });
  let editor = null;
  // A saved Editor / Terminal is a command line (launcher.mjs): run through the shell, {folder} placed.
  if (overrides.editor) editor = { label: launcherLabel(overrides.editor), line: overrides.editor, kind: 'line' };
  else for (const [bin, label] of EDITORS) { const p = find(bin); if (p) { editor = { label, cmd: p }; break; } }

  let terminal = null;
  let fileManager = null;
  if (overrides.terminal) terminal = { label: launcherLabel(overrides.terminal), line: overrides.terminal, kind: 'line' };
  if (platform === 'darwin') {
    terminal ??= { label: 'Terminal', kind: 'mac' };
    fileManager = { label: 'Finder', kind: 'mac' };
  } else if (platform === 'win32') {
    const wt = find('wt');
    terminal ??= wt ? { label: 'Windows Terminal', cmd: wt, kind: 'wt' } : { label: 'Command Prompt', kind: 'cmd' };
    fileManager = { label: 'Explorer', kind: 'win' };
  } else if (hasDisplay(env)) {
    if (!terminal) for (const [bin, label, argv] of LINUX_TERMS) { const p = find(bin); if (p) { terminal = { label, cmd: p, kind: 'linux', argv }; break; } }
    const xdg = find('xdg-open');
    fileManager = xdg ? { label: 'Files', cmd: xdg, kind: 'linux' } : null;
  }
  return { editor, terminal, fileManager, copyCommand: { label: 'Copy command' } };
}

// explorer.exe exits 1 even when the window opened (launchAndWatch's okExitCodes).
const EXPLORER_OK_CODES = [0, 1];

/** { file, args, opts } for a detached, fire-and-forget launch of a built-in on `dir`. */
export function builtinLaunch(key, dir, detected, { platform = process.platform, env = process.env, vars = {} } = {}) {
  const base = { detached: true, stdio: 'ignore', windowsHide: false };
  const viaCmd = (bin, args) => ({ file: env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${[bin, ...args].map((a) => `"${a}"`).join(' ')}"`], opts: { ...base, windowsVerbatimArguments: true } });
  const d = detected[key];
  if (!d) { const e = new Error(`${key} is not available on this machine`); e.code = 'NOT_AVAILABLE'; throw e; }
  if (d.kind === 'line') { const c = buildLauncherCommand(d.line, { folder: dir, vars, platform, env }); return { file: c.file, args: c.args, opts: c.opts }; }
  if (key === 'editor') {
    if (platform === 'win32' && /\.(cmd|bat)$/i.test(d.cmd)) return viaCmd(d.cmd, [dir]);
    return { file: d.cmd, args: [dir], opts: base };
  }
  if (key === 'terminal') {
    if (d.kind === 'mac') return { file: 'open', args: ['-a', 'Terminal', dir], opts: base };
    if (d.kind === 'wt') return { file: d.cmd, args: ['-d', dir], opts: base };
    // Verbatim command line: Node's default quoting would turn the empty title "" into \"\",
    // which `start` would then take as the program to run.
    if (d.kind === 'cmd') return { file: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `start "" /D "${dir}" cmd.exe`], opts: { ...base, windowsVerbatimArguments: true } };
    return { file: d.cmd, args: d.argv(dir), opts: { ...base, cwd: dir } };
  }
  if (key === 'fileManager') {
    if (d.kind === 'mac') return { file: 'open', args: [dir], opts: base };
    if (d.kind === 'win') return { file: 'explorer.exe', args: [dir], opts: base, okExitCodes: EXPLORER_OK_CODES };
    return { file: d.cmd, args: [dir], opts: base };
  }
  throw new Error(`unknown built-in ${key}`);
}

/** { file, args, opts } that opens the file manager on the folder holding `file`, with the file selected where the
 *  platform can (Finder, Explorer); a Linux file manager opens the folder (`dir`, checked to be one by the caller).
 *  Chat files' Show in folder (docs/show-files.md). */
export function revealLaunch(file, dir, detected) {
  const base = { detached: true, stdio: 'ignore', windowsHide: false };
  const d = detected.fileManager;
  if (!d) { const e = new Error('no file manager was found on this machine'); e.code = 'NOT_AVAILABLE'; throw e; }
  if (d.kind === 'mac') return { file: 'open', args: ['-R', file], opts: base };
  // Explorer takes `/select,"<path>"` as ONE argument: Node's own quoting would wrap the whole thing in quotes.
  if (d.kind === 'win') return { file: 'explorer.exe', args: [`/select,"${file}"`], opts: { ...base, windowsVerbatimArguments: true }, okExitCodes: EXPLORER_OK_CODES };
  return { file: d.cmd, args: [dir], opts: base };
}

/** Two lines, never `&&` (Windows PowerShell 5.1). pushed = { remote } | null. */
export function copyCommandText({ projectDir, branch, pushed }) {
  if (pushed && pushed.remote) return `git fetch ${pushed.remote} ${branch}\ngit switch ${branch}`;
  return `cd "${projectDir}"\ngit switch ${branch}`;
}
