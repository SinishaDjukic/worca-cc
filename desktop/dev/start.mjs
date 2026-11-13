#!/usr/bin/env node
// desktop/dev/start.mjs — `npm start` in desktop/ (docs/desktop.md "Run it from a checkout"). Like `electron .`, but
// on macOS it runs desktop/.dev-app/Worca.app (dev-bundle.mjs), so the menu bar and the Dock say Worca. Falls back to
// the stock Electron.app with one warning line when the copy cannot be built.
//   node dev/start.mjs [electron args…]
//   node dev/start.mjs --build-only    # build or check the copy, print what would run, launch nothing
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureDevBundle, launchPlan } from './dev-bundle.mjs';
import { devIconPath } from '../src/app-menu.mjs';

/** The stock Electron binary and its version, or null when electron is not installed (its index.js throws when the
 *  download is missing). */
export function resolveElectron(req) {
  try {
    const electronBinary = req('electron');
    const electronVersion = req('electron/package.json').version;
    if (typeof electronBinary !== 'string' || !electronBinary || typeof electronVersion !== 'string' || !electronVersion) return null;
    return { electronBinary, electronVersion };
  } catch {
    return null;
  }
}

/** The launcher's exit code for the child's exit: its code, or 1 when a signal ended it. */
export function exitCodeFor({ code, signal }) {
  return typeof code === 'number' ? code : 1;
}

// realpath, as import.meta.url is: a symlinked checkout must still run the CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const args = process.argv.slice(2);
  const buildOnly = args.includes('--build-only');
  const extraArgs = args.filter((a) => a !== '--build-only');
  const electron = resolveElectron(createRequire(import.meta.url));
  if (!electron) {
    console.error('worca desktop: electron is not installed; run npm ci --prefix desktop');
    process.exit(1);
  }
  let rebuilt = false;
  const plan = launchPlan({
    platform: process.platform,
    env: process.env,
    electronBinary: electron.electronBinary,
    ensure: () => {
      const r = ensureDevBundle({ desktopDir, electronBinary: electron.electronBinary, electronVersion: electron.electronVersion, iconPath: devIconPath(desktopDir) });
      rebuilt = r.rebuilt;
      return r;
    },
  });
  if (plan.warning) console.error(plan.warning);
  if (buildOnly) {
    console.log(`binary: ${plan.binary}`);
    console.log(`bundled: ${plan.bundled}`);
    console.log(`rebuilt: ${rebuilt}`);
    process.exit(0);
  }
  const child = spawn(plan.binary, ['.', ...extraArgs], { cwd: desktopDir, stdio: 'inherit' });
  child.on('error', (err) => {
    console.error(`worca desktop: could not start ${plan.binary}: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
  child.on('close', (code, signal) => process.exit(exitCodeFor({ code, signal })));
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { if (!child.killed) child.kill(sig); });
  }
}
