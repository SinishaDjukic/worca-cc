// src/cli/extension.mjs — `worca extension`: where the browser extension packaged with @worca/app is, and how to
// install it (docs/browser-extension.md#install). Takes { out, err, c, fail } from the CLI plus an injectable `info`
// and `open`, so tests never spawn a file manager.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { EXTENSION_BROWSERS, EXTENSION_BUILD_COMMAND, extensionBuilds, installSteps, PACKAGE_ROOT } from '../core/extension-package.mjs';

const LABEL = { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox' };

export const EXTENSION_HELP = `worca extension — the browser extension packaged with this Worca

Usage:
  worca extension [--browser chrome|edge|firefox] [--open]

  Prints the folder of each packaged build, its version and the steps to load it.
  --browser <b>   One browser only
  --open          Also open the folder in Finder / Explorer / your file manager
  Release zips (Firefox: unsigned for now) are attached to each GitHub release.
  See docs/browser-extension.md.
`;

/** [command, args] that opens a folder on this platform. */
export function openCommand(platform, path) {
  if (platform === 'darwin') return ['open', [path]];
  if (platform === 'win32') return ['explorer', [path]];
  return ['xdg-open', [path]];
}

/** Best-effort, detached; never throws, never keeps the CLI alive (explorer exits 1 even on success). */
function openFolder(path, platform = process.platform) {
  const [cmd, args] = openCommand(platform, path);
  try {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
    p.on('error', () => {});
    p.unref();
  } catch { /* no file manager here: the path is printed anyway */ }
}

function parse(argv, fail) {
  const o = { browser: null, open: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'help' || a === '--help' || a === '-h') o.help = true;
    else if (a === '--open') o.open = true;
    else if (a === '--browser' || a.startsWith('--browser=')) {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
      if (!EXTENSION_BROWSERS.includes(v)) { fail(`unknown browser: ${v ?? '(none)'} (chrome, edge or firefox)`); return null; }
      o.browser = v;
    } else { fail(`unknown argument: ${a} (see: worca extension help)`); return null; }
  }
  return o;
}

export async function cmdExtension(argv, {
  out, c, fail,
  err = (s) => process.stderr.write(`${s}\n`),
  info = () => extensionBuilds(),
  root = PACKAGE_ROOT,
  open = openFolder,
} = {}) {
  const o = parse(argv, fail);
  if (!o) return 2;
  if (o.help) { out(EXTENSION_HELP.trimEnd()); return 0; }
  const { version, builds } = info();
  const wanted = builds.filter((b) => !o.browser || b.browser === o.browser);
  if (!wanted.some((b) => b.present)) {
    err(`worca: the browser extension is not built in ${root}. Build it with: ${EXTENSION_BUILD_COMMAND}`);
    return 1;
  }
  out(c('bold', `Worca browser extension ${version}`));
  for (const b of wanted) {
    out('');
    out(`${c('bold', LABEL[b.browser].padEnd(8))} ${b.path}`);
    if (!b.present) { out(c('gray', `  not built (${EXTENSION_BUILD_COMMAND})`)); continue; }
    out(c('gray', `  version ${b.version}${b.browser === 'firefox' ? ' · unsigned: a temporary add-on' : ''}`));
    installSteps(b.browser).forEach((s, i) => out(`  ${i + 1}. ${s}`));
  }
  if (o.open) {
    const target = o.browser ? wanted[0].path : join(root, 'extension', 'dist');
    open(target);
    out('');
    out(c('gray', `Opened ${target}`));
  }
  return 0;
}
