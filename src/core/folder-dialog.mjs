// src/core/folder-dialog.mjs
// Server-side native OS "choose folder" dialog. A browser <input type=file>
// cannot reveal absolute directory paths, so the add-project Browse button asks
// the server (which runs on the user's own machine; worca-cc is localhost-only)
// to open the platform dialog and report the chosen path.
//
//   darwin -> osascript `choose folder` (the System Events activate line keeps
//             the dialog frontmost; on first use macOS may show a one-time
//             Automation consent prompt — a denial surfaces as a non-cancel
//             error and degrades to `unsupported`, i.e. the in-app fallback)
//   darwin, purpose 'repos' -> ONE NSOpenPanel through JXA (osascript -l JavaScript) that takes
//             folders AND .code-workspace files (the workspace wizard's Add…); a non-cancel failure
//             falls back to the folders-only `choose folder`
//   win32  -> PowerShell System.Windows.Forms.FolderBrowserDialog (-STA), owned
//             by a shown, transparent TopMost form so it opens above the browser
//   linux  -> zenity --file-selection --directory, falling back to kdialog;
//             requires DISPLAY/WAYLAND_DISPLAY (headless -> unsupported)
//   `multiple` -> multi-select on darwin and zenity (newline-separated paths);
//             win32 and kdialog stay single-select and answer a one-element list
//
// Any failure that is not a recognized user-cancel degrades to
// { status: 'unsupported' } so the web UI can fall back to its in-app folder
// browser. WORCA_NO_NATIVE_DIALOG=1 forces that fallback. Like git-info.mjs,
// every command goes through an injectable runner (_testing) so tests never
// open a real dialog. Nothing here ever throws.

import { spawn } from 'node:child_process';

// The dialog title, by PURPOSE. A closed set, never caller text: the string is
// interpolated into an osascript / PowerShell command line.
const PROMPTS = Object.freeze({
  project: 'Select a project folder',
  export: 'Select the project folder to export into',
  plugin: 'Select the plugin folder',
  repos: 'Select repositories or a folder of repositories',
});
const promptFor = (purpose) => PROMPTS[purpose] || PROMPTS.project;
// A dialog waits on a human; give it a long leash, then kill the process so a
// forgotten dialog cannot pin server resources forever.
const DIALOG_TIMEOUT_MS = 5 * 60 * 1000;

/** Default runner: spawn cmd, resolve { ok, stdout, stderr, code, timedOut }. */
function defaultRun(cmd, args, { timeout = DIALOG_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: err.message, code: -1, timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      done({ ok: false, stdout, stderr: 'dialog timed out', code: -1, timedOut: true });
    }, timeout);
    child.stdout?.on('data', (b) => (stdout += b.toString()));
    child.stderr?.on('data', (b) => (stderr += b.toString()));
    child.on('error', (err) => done({ ok: false, stdout, stderr: stderr || err.message, code: -1, timedOut: false }));
    child.on('close', (code) => done({ ok: code === 0, stdout, stderr, code: code ?? -1, timedOut: false }));
  });
}

const _ov = { runner: null, platform: null, env: null };
let _inFlight = false;

export const _testing = {
  set({ runner = _ov.runner, platform = _ov.platform, env = _ov.env } = {}) {
    _ov.runner = runner;
    _ov.platform = platform;
    _ov.env = env;
  },
  reset() {
    _ov.runner = null;
    _ov.platform = null;
    _ov.env = null;
    _inFlight = false;
  },
};

/**
 * Open the platform's native folder picker and wait for the user.
 * Serialized: while one dialog is open, further calls resolve { status:'busy' }.
 * `multiple` asks for a multi-select dialog where the platform has one (macOS
 * `choose folder … with multiple selections allowed`, zenity --multiple);
 * Windows' FolderBrowserDialog and kdialog stay single-select. With `multiple`
 * a pick answers { status:'picked', path: <first>, paths: [...] }; without it the
 * reply keeps its historical { status:'picked', path } shape.
 * @param {{purpose?: 'project'|'export'|'plugin'|'repos', multiple?: boolean}} [opts]
 * @returns {Promise<{status:'picked', path:string, paths?:string[]} | {status:'canceled'}
 *   | {status:'unsupported'} | {status:'busy'}>}
 */
export async function pickFolderNative({ purpose, multiple = false } = {}) {
  if (_inFlight) return { status: 'busy' };
  _inFlight = true;
  try {
    const platform = _ov.platform || process.platform;
    const env = _ov.env || process.env;
    const run = _ov.runner || defaultRun;
    const prompt = promptFor(purpose);
    const multi = multiple === true;
    if ((env.WORCA_NO_NATIVE_DIALOG || '') === '1') return { status: 'unsupported' };
    let r = { status: 'unsupported' };
    if (platform === 'darwin') r = purpose === 'repos' ? await pickMacRepos(run, prompt) : await pickMac(run, prompt, multi);
    else if (platform === 'win32') r = await pickWindows(run, prompt);
    else if (platform === 'linux') r = await pickLinux(run, env, prompt, multi);
    if (r.status !== 'picked') return r;
    return multi ? { status: 'picked', path: r.paths[0], paths: r.paths } : { status: 'picked', path: r.paths[0] };
  } finally {
    _inFlight = false;
  }
}

// One path per stdout line (a multi-select dialog prints several): trimmed, a
// trailing slash dropped (a bare "/" kept), blanks skipped, duplicates collapsed.
function parsePicked(stdoutRaw) {
  const paths = [];
  for (const line of String(stdoutRaw || '').split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    const path = raw === '/' ? raw : raw.replace(/\/+$/, '');
    if (!paths.includes(path)) paths.push(path);
  }
  return paths.length ? { status: 'picked', paths } : { status: 'canceled' };
}

async function pickMac(run, prompt, multiple) {
  // `choose folder … with multiple selections allowed` returns a LIST of aliases;
  // POSIX path must be taken per item, one per line.
  const pick = multiple
    ? [
        '-e', `set picked to (choose folder with prompt "${prompt}" with multiple selections allowed)`,
        '-e', 'set out to ""',
        '-e', 'repeat with f in picked',
        '-e', 'set out to out & (POSIX path of f) & linefeed',
        '-e', 'end repeat',
        '-e', 'return out',
      ]
    : ['-e', `POSIX path of (choose folder with prompt "${prompt}")`];
  const r = await run('osascript', ['-e', 'tell application "System Events" to activate', ...pick]);
  if (r.ok) return parsePicked(r.stdout);
  // `choose folder` cancel: exit 1 + "execution error: User canceled. (-128)"
  if (/-128|User cancell?ed/i.test(r.stderr || '')) return { status: 'canceled' };
  return { status: 'unsupported' }; // no GUI session, automation denied, ...
}

// The workspace wizard's Add… (purpose 'repos') on macOS: ONE panel that takes folders AND
// .code-workspace files. AppleScript's `choose folder` takes only folders and `choose file` only
// files, so this drives the same NSOpenPanel they show through JXA, inside osascript as they are:
// the System Events activation keeps it frontmost as for `choose folder`, and the accessory
// activation policy lets a process with no app bundle bring a window forward. A closed constant:
// no caller text reaches the script. A cancel answers '' (parsePicked: canceled).
// The last line keeps a LOOSE `==`: the bridge hands NSInteger constants over as strings
// (osascript: `typeof $.NSModalResponseOK` is 'string', `== 1` is true, `=== 1` is false).
const MAC_REPOS_JXA = [
  "ObjC.import('AppKit');",
  "Application('System Events').activate();",
  'const app = $.NSApplication.sharedApplication;',
  'app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);',
  'app.activateIgnoringOtherApps(true);',
  'const panel = $.NSOpenPanel.openPanel;',
  'panel.setCanChooseFiles(true);',
  'panel.setCanChooseDirectories(true);',
  'panel.setAllowsMultipleSelection(true);',
  'panel.setCanCreateDirectories(false);',
  "panel.setAllowedFileTypes($(['code-workspace']));",
  "panel.setMessage($('Select repositories, folders of repositories or a .code-workspace file'));",
  "panel.runModal == $.NSModalResponseOK ? ObjC.unwrap(panel.URLs).map((u) => u.path.js).join('\\n') : '';",
].join('\n');

async function pickMacRepos(run, prompt) {
  const r = await run('osascript', ['-l', 'JavaScript', '-e', MAC_REPOS_JXA]);
  if (r.ok) return parsePicked(r.stdout);
  if (/-128|User cancell?ed/i.test(r.stderr || '')) return { status: 'canceled' };
  if (r.timedOut) return { status: 'unsupported' };   // a forgotten panel: never open a second dialog
  return pickMac(run, prompt, true);                  // no AppKit bridge: the folders-only dialog
}

async function pickWindows(run, prompt) {
  // FolderBrowserDialog has no multi-select: a `multiple` caller gets a one-element list.
  // This PowerShell is the server's child, never the foreground process, so an unowned
  // dialog opens BEHIND the browser (Windows' foreground lock) and the user sees nothing.
  // Its owner is a 1x1 transparent TopMost form that is actually SHOWN: an owned window
  // stays above its owner, so the dialog lands in the topmost band. (TopMost on an owner
  // that is never shown does not carry over — measured on Windows 11.)
  const script =
    'Add-Type -AssemblyName System.Windows.Forms | Out-Null; ' +
    '$o = New-Object System.Windows.Forms.Form; $o.TopMost = $true; $o.ShowInTaskbar = $false; ' +
    "$o.FormBorderStyle = 'None'; $o.Opacity = 0; $o.StartPosition = 'CenterScreen'; " +
    '$o.Size = New-Object System.Drawing.Size(1, 1); $o.Show(); ' +
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog; ' +
    `$d.Description = '${prompt}'; $d.ShowNewFolderButton = $true; ` +
    "if ($d.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.WriteLine($d.SelectedPath) }";
  const r = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', script]);
  if (!r.ok) return { status: 'unsupported' };
  // OK exit either way; empty stdout means the user canceled.
  const path = r.stdout.trim();
  return path ? { status: 'picked', paths: [path] } : { status: 'canceled' };
}

async function pickLinux(run, env, prompt, multiple) {
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return { status: 'unsupported' };
  const zenArgs = ['--file-selection', '--directory', `--title=${prompt}`];
  if (multiple) zenArgs.push('--multiple', '--separator=\n');
  const zen = await run('zenity', zenArgs);
  if (zen.ok) return parsePicked(zen.stdout);
  if (zen.code === 1 && !zen.timedOut) return { status: 'canceled' }; // user closed it
  // zenity missing (spawn error -> code -1) or broken: try kdialog (single-select only).
  const kd = await run('kdialog', ['--title', prompt, '--getexistingdirectory', env.HOME || '/']);
  if (kd.ok) return parsePicked(kd.stdout);
  if (kd.code === 1 && !kd.timedOut) return { status: 'canceled' };
  return { status: 'unsupported' };
}

// ── "Browse…" for Settings › Runs › Actions › Editor / Terminal: the platform's app picker ──────────
// Same rules as the folder picker: a closed set of titles, one dialog at a time, anything but a
// recognized cancel degrades to `unsupported` (the page then offers what it found instead).
const APP_PROMPTS = Object.freeze({ editor: 'Select your editor or IDE', terminal: 'Select your terminal app' });

/**
 * @param {{kind?: 'editor'|'terminal'}} [opts]
 * @returns {Promise<{status:'picked', path:string} | {status:'canceled'} | {status:'unsupported'} | {status:'busy'}>}
 */
export async function pickAppNative({ kind } = {}) {
  if (_inFlight) return { status: 'busy' };
  _inFlight = true;
  try {
    const platform = _ov.platform || process.platform;
    const env = _ov.env || process.env;
    const run = _ov.runner || defaultRun;
    const prompt = APP_PROMPTS[kind] || APP_PROMPTS.editor;
    if ((env.WORCA_NO_NATIVE_DIALOG || '') === '1') return { status: 'unsupported' };
    let r = { status: 'unsupported' };
    if (platform === 'darwin') {
      // `choose application … as alias`: the system's app chooser (with its own Browse… for any .app).
      const out = await run('osascript', ['-e', 'tell application "System Events" to activate',
        '-e', `POSIX path of (choose application with prompt "${prompt}" as alias)`]);
      if (out.ok) r = parsePicked(out.stdout);
      else r = /-128|User cancell?ed/i.test(out.stderr || '') ? { status: 'canceled' } : { status: 'unsupported' };
    } else if (platform === 'win32') {
      const script =
        'Add-Type -AssemblyName System.Windows.Forms | Out-Null; ' +
        '$o = New-Object System.Windows.Forms.Form; $o.TopMost = $true; $o.ShowInTaskbar = $false; ' +
        "$o.FormBorderStyle = 'None'; $o.Opacity = 0; $o.StartPosition = 'CenterScreen'; " +
        '$o.Size = New-Object System.Drawing.Size(1, 1); $o.Show(); ' +
        '$d = New-Object System.Windows.Forms.OpenFileDialog; ' +
        `$d.Title = '${prompt}'; $d.Filter = 'Programs (*.exe;*.cmd;*.bat)|*.exe;*.cmd;*.bat|All files (*.*)|*.*'; ` +
        '$d.InitialDirectory = $env:ProgramFiles; ' +
        "if ($d.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.WriteLine($d.FileName) }";
      const out = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', script]);
      if (!out.ok) r = { status: 'unsupported' };
      else { const p = out.stdout.trim(); r = p ? { status: 'picked', paths: [p] } : { status: 'canceled' }; }
    } else if (platform === 'linux') {
      if (!env.DISPLAY && !env.WAYLAND_DISPLAY) r = { status: 'unsupported' };
      else {
        const zen = await run('zenity', ['--file-selection', `--title=${prompt}`, '--filename=/usr/bin/']);
        if (zen.ok) r = parsePicked(zen.stdout);
        else if (zen.code === 1 && !zen.timedOut) r = { status: 'canceled' };
        else {
          const kd = await run('kdialog', ['--title', prompt, '--getopenfilename', '/usr/bin']);
          if (kd.ok) r = parsePicked(kd.stdout);
          else r = kd.code === 1 && !kd.timedOut ? { status: 'canceled' } : { status: 'unsupported' };
        }
      }
    }
    return r.status === 'picked' ? { status: 'picked', path: r.paths[0] } : r;
  } finally {
    _inFlight = false;
  }
}

/** Whether a native picker can open on this machine at all (the page leaves "Browse…" out when not). */
export function nativeDialogAvailable({ platform = _ov.platform || process.platform, env = _ov.env || process.env } = {}) {
  if ((env.WORCA_NO_NATIVE_DIALOG || '') === '1') return false;
  if (platform === 'darwin' || platform === 'win32') return true;
  return platform === 'linux' && !!(env.DISPLAY || env.WAYLAND_DISPLAY);
}
