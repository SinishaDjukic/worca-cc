// src/core/actions/launcher.mjs — the Editor and Terminal command lines of Settings › Runs › Actions
// (docs/actions.md "Built-ins"). What a person types runs through the system shell, like a project
// action: /bin/sh -c on macOS and Linux, cmd.exe /d /s /c on Windows. Arguments, ~, $VAR / %VAR%,
// quotes and && all work. Worca adds three conveniences on top:
//   • {folder} (or {worktree}) marks where the checkout path goes, quoted for the shell; without it the
//     path is added at the end, so a bare command (`xed`) keeps working;
//   • a path to a macOS app (`/Applications/Xcode.app`, `Xcode.app`) becomes `open -a <app> <folder>`;
//   • an unquoted path with spaces at the start (`C:\Program Files\…\Code.exe --new-window`) is quoted.
// The person who saves the line decides what it runs: this is a local or trusted setup, and the save is
// refused for an isolated agent (ui/server.mjs D4). Pure apart from the injected fs/spawn helpers.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, isAbsolute } from 'node:path';

const FOLDER_RE = /(["']?)\{(?:folder|worktree)\}\1/g;
const VAR_RE = /(["']?)\{(branch|project|runId)\}\1/g;
const WIN_PROGRAM_RE = /\.(exe|cmd|bat|com)$/i;
const WIN_BUILTINS = new Set(['start', 'cd', 'pushd', 'call', 'cmd', 'echo']);

/** Quote one value for the shell that runs the line. */
export function shellQuote(value, platform = process.platform) {
  const s = String(value ?? '');
  return platform === 'win32' ? `"${s.replace(/"/g, '""')}"` : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** `~` (POSIX) and %VAR% (Windows) expanded, only to look a path up on disk. */
function expandForLookup(p, { platform, env }) {
  if (platform === 'win32') return p.replace(/%([^%]+)%/g, (m, n) => env[n] ?? env[n.toUpperCase()] ?? m);
  if (p === '~' || p.startsWith('~/')) return join(env.HOME || homedir(), p.slice(1));
  return p;
}

/** A macOS app named or pathed in the line, as an absolute .app path, or null. */
function macApp(text, { env, exists }) {
  const t = text.replace(/\/$/, '');
  if (!/\.app$/i.test(t)) return null;
  const direct = expandForLookup(t, { platform: 'darwin', env });
  if (isAbsolute(direct)) return exists(direct) ? direct : null;
  for (const dir of ['/Applications', join(env.HOME || homedir(), 'Applications')]) {
    const p = join(dir, t);
    if (exists(p)) return p;
  }
  return null;
}

/**
 * Quote a path with spaces at the start of the line, found on disk as the longest existing prefix
 * (a Windows program must end in .exe/.cmd/.bat/.com). A line that starts with a quote is left alone.
 */
export function quoteLeadingPath(line, { platform = process.platform, env = process.env, exists = existsSync } = {}) {
  if (/^["']/.test(line) || !/\s/.test(line)) return line;
  if (!/^(~|[\\/]|[A-Za-z]:|%)/.test(line) && !/^[^\s]*[\\/]/.test(line)) return line;   // only a path can hold a space
  const parts = line.split(/(\s+)/);
  let acc = '';
  let best = -1;
  for (let i = 0; i < parts.length; i += 1) {
    acc += parts[i];
    if (i % 2 || i === 0) continue;                 // only prefixes that end on a word and span a space
    const p = expandForLookup(acc, { platform, env });
    if ((platform !== 'win32' || WIN_PROGRAM_RE.test(acc)) && exists(p)) best = i;
  }
  if (best < 0) return line;
  const head = parts.slice(0, best + 1).join('');
  const tail = parts.slice(best + 1).join('');
  // A quoted ~ would not expand, so a POSIX ~ path is written out in full.
  const quoted = platform === 'win32' ? `"${head}"` : shellQuote(expandForLookup(head, { platform, env }), platform);
  return `${quoted}${tail}`;
}

/**
 * Build the command for one launch.
 * @returns {{ line: string, file: string, args: string[], opts: object }}
 */
export function buildLauncherCommand(rawLine, { folder, vars = {}, platform = process.platform, env = process.env, exists = existsSync } = {}) {
  let line = String(rawLine ?? '').trim();
  if (!line) throw Object.assign(new Error('the command is empty'), { code: 'EMPTY' });
  if (platform === 'darwin') {
    const app = macApp(line.replace(FOLDER_RE, '').trim(), { env, exists });
    if (app) line = `open -a ${shellQuote(app, platform)} {folder}`;
  }
  line = quoteLeadingPath(line, { platform, env, exists });
  let hasFolder = false;
  line = line.replace(FOLDER_RE, () => { hasFolder = true; return shellQuote(folder, platform); });
  line = line.replace(VAR_RE, (m, q, name) => (vars[name] == null ? m : shellQuote(vars[name], platform)));
  if (!hasFolder) line = `${line} ${shellQuote(folder, platform)}`;
  const base = { detached: true, windowsHide: false };
  if (platform === 'win32') {
    return { line, file: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], opts: { ...base, windowsVerbatimArguments: true } };
  }
  return { line, file: '/bin/sh', args: ['-c', line], opts: base };
}

/** A short name for the button and the "Left blank" note: "Xcode", "Code", "xed". */
export function launcherLabel(rawLine) {
  const s = String(rawLine ?? '').trim();
  if (!s) return null;
  const app = s.match(/([^/\\"']+)\.app(?=[/"'\s]|$)/i);
  if (app) return app[1];
  const win = s.match(/([^\\/"']+)\.(exe|cmd|bat|com)(?=["'\s]|$)/i);
  if (win) return win[1];
  const open = s.match(/^open\s+-n?a\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (open) return basename(open[1] || open[2] || open[3]).replace(/\.app$/i, '');
  const first = s.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
  const tok = first ? (first[1] || first[2] || first[3]) : s;
  return basename(tok.replace(/\\/g, '/')) || tok;
}

/** The program a line starts with, or null when it cannot be told (a shell builtin, `open -a`). */
function firstProgram(line, { platform, env, exists }) {
  const l = quoteLeadingPath(line.trim(), { platform, env, exists });
  const m = l.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return m ? (m[1] || m[2] || m[3]) : null;
}

/**
 * A warning when the line's program cannot be found, or null. Never a refusal: the line is the
 * person's to keep (it may need an environment Worca does not see).
 */
export function launcherWarning(rawLine, { platform = process.platform, env = process.env, exists = existsSync, findOnPath } = {}) {
  const line = String(rawLine ?? '').trim();
  if (!line) return null;
  if (platform === 'darwin' && macApp(line.replace(FOLDER_RE, '').trim(), { env, exists })) return null;
  const prog = firstProgram(line, { platform, env, exists });
  if (!prog || (platform === 'win32' && WIN_BUILTINS.has(prog.toLowerCase())) || prog === 'open') return null;
  const looksPath = /[\\/]/.test(prog) || prog.startsWith('~');
  const found = looksPath ? exists(expandForLookup(prog, { platform, env })) : !!findOnPath?.(prog);
  return found ? null : `${prog} was not found on this machine. It is saved anyway; use Try to check it.`;
}

// ── What is installed (the "Choose…" list) ───────────────────────────────────

const MAC_EDITORS = [
  ['Visual Studio Code.app', 'Contents/Resources/app/bin/code'], ['Cursor.app', 'Contents/Resources/app/bin/cursor'],
  ['Windsurf.app', 'Contents/Resources/app/bin/windsurf'], ['Zed.app', 'Contents/MacOS/cli'],
  ['Sublime Text.app', 'Contents/SharedSupport/bin/subl'], ['Nova.app', null], ['BBEdit.app', null], ['TextMate.app', null],
  ['IntelliJ IDEA.app', null], ['IntelliJ IDEA CE.app', null], ['WebStorm.app', null], ['PyCharm.app', null], ['PyCharm CE.app', null],
  ['GoLand.app', null], ['PhpStorm.app', null], ['RubyMine.app', null], ['CLion.app', null], ['Rider.app', null], ['Android Studio.app', null],
];
const MAC_TERMINALS = [
  ['iTerm.app', null], ['Warp.app', null], ['Ghostty.app', null],
  ['WezTerm.app', 'Contents/MacOS/wezterm', 'start --cwd {folder}'], ['Alacritty.app', 'Contents/MacOS/alacritty', '--working-directory {folder}'],
  ['kitty.app', 'Contents/MacOS/kitty', '--directory {folder}'],
];
const WIN_EDITORS = [
  ['VS Code', ['%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe', '%ProgramFiles%\\Microsoft VS Code\\Code.exe']],
  ['Cursor', ['%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe']],
  ['Windsurf', ['%LOCALAPPDATA%\\Programs\\Windsurf\\Windsurf.exe']],
  ['Sublime Text', ['%ProgramFiles%\\Sublime Text\\subl.exe']],
  ['IntelliJ IDEA', ['%LOCALAPPDATA%\\JetBrains\\Toolbox\\scripts\\idea.cmd']],
  ['WebStorm', ['%LOCALAPPDATA%\\JetBrains\\Toolbox\\scripts\\webstorm.cmd']],
  ['PyCharm', ['%LOCALAPPDATA%\\JetBrains\\Toolbox\\scripts\\pycharm.cmd']],
];
const LINUX_EDITORS = [['code', 'VS Code'], ['cursor', 'Cursor'], ['windsurf', 'Windsurf'], ['zeditor', 'Zed'], ['zed', 'Zed'],
  ['subl', 'Sublime Text'], ['idea', 'IntelliJ IDEA'], ['webstorm', 'WebStorm'], ['pycharm', 'PyCharm'], ['kate', 'Kate']];
const LINUX_TERMINALS = [
  ['gnome-terminal', 'GNOME Terminal', '--working-directory={folder}'], ['konsole', 'Konsole', '--workdir {folder}'],
  ['xfce4-terminal', 'Xfce Terminal', '--working-directory={folder}'], ['kitty', 'kitty', '--directory {folder}'],
  ['alacritty', 'Alacritty', '--working-directory {folder}'], ['wezterm', 'WezTerm', 'start --cwd {folder}'], ['tilix', 'Tilix', '-w {folder}'],
];

/**
 * Editors and terminals found on this machine, each with a command line that works as typed.
 * @returns {{ editor: Array<{label, line}>, terminal: Array<{label, line}> }}
 */
export function installedLaunchers({ platform = process.platform, env = process.env, exists = existsSync, findOnPath } = {}) {
  const editor = []; const terminal = [];
  const seen = new Set();
  const add = (list, label, line) => { if (!seen.has(line)) { seen.add(line); list.push({ label, line }); } };
  if (platform === 'darwin') {
    const dirs = ['/Applications', join(env.HOME || homedir(), 'Applications')];
    const appPath = (name) => dirs.map((d) => join(d, name)).find((p) => exists(p)) || null;
    const q = (p) => shellQuote(p, platform);
    if (exists('/usr/bin/xed') && appPath('Xcode.app')) add(editor, 'Xcode', 'xed {folder}');
    for (const [name, cli] of MAC_EDITORS) {
      const app = appPath(name); if (!app) continue;
      const label = name.replace(/\.app$/, '');
      if (cli && exists(join(app, cli))) add(editor, label, `${q(join(app, cli))} {folder}`);
      else add(editor, label, `open -a ${q(app)} {folder}`);
    }
    add(terminal, 'Terminal', 'open -a Terminal {folder}');
    for (const [name, cli, args] of MAC_TERMINALS) {
      const app = appPath(name); if (!app) continue;
      const label = name.replace(/\.app$/, '');
      if (cli && args && exists(join(app, cli))) add(terminal, label, `${q(join(app, cli))} ${args}`);
      else add(terminal, label, `open -a ${q(app)} {folder}`);
    }
  } else if (platform === 'win32') {
    for (const [label, paths] of WIN_EDITORS) {
      const p = paths.map((x) => expandForLookup(x, { platform, env })).find((x) => !/%/.test(x) && exists(x));
      if (p) add(editor, label, `"${p}" {folder}`);
    }
    for (const [cmd, label] of [['code', 'VS Code'], ['cursor', 'Cursor']]) if (findOnPath?.(cmd)) add(editor, `${label} (on PATH)`, `${cmd} {folder}`);
    if (findOnPath?.('wt')) add(terminal, 'Windows Terminal', 'wt -d {folder}');
    if (findOnPath?.('pwsh')) add(terminal, 'PowerShell 7', 'start "" /D {folder} pwsh -NoExit');
    add(terminal, 'Windows PowerShell', 'start "" /D {folder} powershell -NoExit');
    add(terminal, 'Command Prompt', 'start "" /D {folder} cmd');
    const gitBash = expandForLookup('%ProgramFiles%\\Git\\git-bash.exe', { platform, env });
    if (exists(gitBash)) add(terminal, 'Git Bash', `"${gitBash}" --cd={folder}`);
  } else {
    for (const [cmd, label] of LINUX_EDITORS) if (findOnPath?.(cmd)) add(editor, label, `${cmd} {folder}`);
    for (const [cmd, label, args] of LINUX_TERMINALS) if (findOnPath?.(cmd)) add(terminal, label, `${cmd} ${args}`);
  }
  return { editor, terminal };
}

const WIN_TERMINAL_EXES = { 'wt.exe': () => 'wt -d {folder}', 'pwsh.exe': (p) => `start "" /D {folder} "${p}" -NoExit`,
  'powershell.exe': (p) => `start "" /D {folder} "${p}" -NoExit`, 'cmd.exe': () => 'start "" /D {folder} cmd', 'git-bash.exe': (p) => `"${p}" --cd={folder}` };

/**
 * The command line for an app picked with Browse… (folder-dialog.mjs pickAppNative). A known app gets its
 * own command (Xcode -> xed, VS Code -> its code tool, kitty -> --directory); anything else opens the
 * folder the general way for its OS. The person can still edit the line, and Try checks it.
 * @returns {{ label: string, line: string }}
 */
export function lineForPickedApp(rawPath, { kind = 'editor', platform = process.platform, exists = existsSync } = {}) {
  const p = String(rawPath ?? '').trim().replace(/[\\/]+$/, '');
  if (!p) throw Object.assign(new Error('no app was picked'), { code: 'EMPTY' });
  if (platform === 'darwin' && /\.app$/i.test(p)) {
    const name = basename(p);
    const label = name.replace(/\.app$/i, '');
    const q = (x) => shellQuote(x, platform);
    if (kind === 'editor' && name === 'Xcode.app' && exists('/usr/bin/xed')) return { label, line: 'xed {folder}' };
    const known = (kind === 'terminal' ? MAC_TERMINALS : MAC_EDITORS).find(([n]) => n === name);
    if (known && known[1] && exists(join(p, known[1]))) return { label, line: `${q(join(p, known[1]))} ${known[2] || '{folder}'}` };
    if (kind === 'terminal' && name === 'Terminal.app') return { label, line: 'open -a Terminal {folder}' };
    return { label, line: `open -a ${q(p)} {folder}` };
  }
  if (platform === 'win32') {
    const file = p.split('\\').pop();
    const label = file.replace(/\.(exe|cmd|bat|com)$/i, '');
    const term = kind === 'terminal' && WIN_TERMINAL_EXES[file.toLowerCase()];
    return { label, line: term ? term(p) : `"${p}" {folder}` };
  }
  const label = basename(p);
  const term = kind === 'terminal' && LINUX_TERMINALS.find(([cmd]) => cmd === label);
  return { label, line: `${shellQuote(p, platform)} ${term ? term[2] : '{folder}'}` };
}

/** The hover examples for this OS (Settings › Runs › Actions): forms that work, not product promises. */
export function launcherExamples(platform = process.platform) {
  if (platform === 'win32') {
    return {
      editor: ['code {folder}', '"C:\\Program Files\\Microsoft VS Code\\Code.exe" --new-window {folder}',
        '%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe'],
      terminal: ['wt -d {folder}', 'start "" /D {folder} powershell -NoExit', '"C:\\Program Files\\Git\\git-bash.exe" --cd={folder}'],
    };
  }
  if (platform === 'darwin') {
    return {
      editor: ['xed', 'open -a "Visual Studio Code" {folder}', '/Applications/Zed.app', '~/bin/my-editor --new-window {folder}'],
      terminal: ['open -a iTerm {folder}', 'open -a Terminal {folder}', '/Applications/WezTerm.app/Contents/MacOS/wezterm start --cwd {folder}'],
    };
  }
  return {
    editor: ['code {folder}', 'zeditor {folder}', '~/bin/my-editor --new-window {folder}'],
    terminal: ['gnome-terminal --working-directory={folder}', 'konsole --workdir {folder}', 'kitty --directory {folder}'],
  };
}

/**
 * Start the command and watch it for a moment: a launcher that fails at once (not found, bad
 * arguments) is reported with its own error text; one still running after `watchMs` is left alone.
 * `cmd.okExitCodes` lists the exit codes that mean it opened (default [0]): Explorer exits 1 even on success.
 * @returns {Promise<{ ok: true } | { ok: false, code: number|null, error: string }>}
 */
export function launchAndWatch(cmd, { spawn, watchMs = 2000 } = {}) {
  const okCodes = cmd.okExitCodes || [0];
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd.file, cmd.args, { ...cmd.opts, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, code: null, error: err?.message || String(err) });
      return;
    }
    let err = '';
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Keep draining stderr without holding the server's event loop (a closed pipe could kill the app).
      child.stderr?.removeAllListeners('data');
      child.stderr?.resume?.();
      child.stderr?.unref?.();
      child.unref?.();
      resolve(r);
    };
    child.stderr?.on('data', (d) => { if (err.length < 4000) err += String(d); });
    const timer = setTimeout(() => done({ ok: true }), watchMs);   // kept referenced: a few seconds at most
    child.once('error', (e) => done({ ok: false, code: null, error: e?.message || String(e) }));
    child.once('exit', (code) => {
      if (okCodes.includes(code)) return done({ ok: true });
      const tail = err.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ');
      done({ ok: false, code, error: tail || `the command exited with code ${code}` });
    });
  });
}
