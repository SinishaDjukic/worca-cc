// desktop/dev/dev-bundle.mjs — the dev launcher's Worca.app (docs/desktop.md "Run it from a checkout"). macOS takes
// the bold menu-bar title from the main bundle's CFBundleName, and `electron .` runs the stock Electron.app. So on
// macOS `npm start` runs a copy, desktop/.dev-app/Worca.app, whose Info.plist says Worca and whose icon is worca's,
// ad-hoc re-signed. The copy is rebuilt only when the Electron version, the icon or RECIPE changes. Any failure falls
// back to the stock Electron.app (launchPlan). Never packaged (outside the builder's files). Imports only node: builtins.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Bump by hand whenever bundleCommands or the install changes: every existing copy is then rebuilt. */
export const RECIPE = 1;

/** The iconset iconutil needs: 16, 32, 128, 256 and 512 points at @1x and @2x. */
export const ICON_SIZES = [16, 32, 128, 256, 512].flatMap((pt) => [
  { name: `icon_${pt}x${pt}.png`, px: pt },
  { name: `icon_${pt}x${pt}@2x.png`, px: pt * 2 },
]);

/** A work-* scratch folder older than this is a build that died (Ctrl-C mid-build); younger ones may be running. */
export const STALE_WORK_MS = 10 * 60 * 1000;

const NAME = 'Worca';
const ICNS = 'worca.icns';

/** workDir is one build's scratch folder: ensureDevBundle makes a fresh <outDir>/work-XXXXXX per build, so two
 *  builds at once never share a tmp bundle. */
export function bundlePaths({ desktopDir, electronBinary, workDir: givenWorkDir }) {
  const outDir = join(desktopDir, '.dev-app');
  const workDir = givenWorkDir || join(outDir, 'work');
  const app = join(outDir, `${NAME}.app`);
  return {
    stockApp: dirname(dirname(dirname(electronBinary))),   // <X>.app/Contents/MacOS/Electron → <X>.app
    outDir,
    workDir,
    app,
    tmpApp: join(workDir, `${NAME}.app`),
    iconset: join(workDir, 'worca.iconset'),
    stamp: join(outDir, 'stamp.json'),
    binary: join(app, 'Contents', 'MacOS', 'Electron'),   // the executable keeps its name: Electron finds its helpers
  };
}

export function wantedStamp({ electronVersion, iconBytes }) {
  return { recipe: RECIPE, electronVersion, iconSha256: createHash('sha256').update(iconBytes).digest('hex') };
}

export function needsRebuild({ stampText, wanted, binaryExists }) {
  if (!binaryExists || stampText == null) return true;
  let stamp;
  try { stamp = JSON.parse(stampText); } catch { return true; }
  // null and non-objects ("x", 3, []) differ on every key anyway
  return !stamp || ['recipe', 'electronVersion', 'iconSha256'].some((k) => stamp[k] !== wanted[k]);
}

/** The ordered tool calls that build tmpApp; pure. Every command writes under workDir; the stock app is only read. */
export function bundleCommands(paths, { iconPath }) {
  const plist = join(paths.tmpApp, 'Contents', 'Info.plist');
  return [
    { step: 'copy', command: 'ditto', args: [paths.stockApp, paths.tmpApp] },
    ...ICON_SIZES.map(({ name, px }) => ({ step: 'icon', command: 'sips', args: ['-z', String(px), String(px), iconPath, '--out', join(paths.iconset, name)] })),
    { step: 'icns', command: 'iconutil', args: ['-c', 'icns', paths.iconset, '-o', join(paths.tmpApp, 'Contents', 'Resources', ICNS)] },
    ...[['CFBundleName', NAME], ['CFBundleDisplayName', NAME], ['CFBundleIconFile', ICNS]].map(([key, value]) => (
      { step: 'plist', command: 'plutil', args: ['-replace', key, '-string', value, plist] })),
    { step: 'sign', command: 'codesign', args: ['--force', '--deep', '--sign', '-', paths.tmpApp] },
  ];
}

const defaultRun = (command, args) => spawnSync(command, args, { encoding: 'utf8', shell: false });
const defaultFs = { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, mkdtempSync, readdirSync, statSync, renameSync };

function failed(step, message) {
  return Object.assign(new Error(message), { code: 'DEV_BUNDLE_FAILED', step });
}
const errText = (err) => (err && err.message ? err.message : String(err));
const lastLine = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1) || '';

/** Remove work-* folders that a dead build left behind; a young one may belong to a build still running. */
function removeStaleWork(outDir, fs, now) {
  for (const name of fs.readdirSync(outDir)) {
    if (!name.startsWith('work-')) continue;
    const dir = join(outDir, name);
    try {
      if (now - fs.statSync(dir).mtimeMs > STALE_WORK_MS) fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* another build removed it first */ }
  }
}

/** Build desktop/.dev-app/Worca.app when needed. All-or-nothing: the work happens in this build's own
 *  work-XXXXXX/Worca.app, and only that fully built and signed copy replaces Worca.app; a second `npm start` building
 *  at the same time has its own folder. The stamp is removed before the install and written last, so a matching
 *  stamp always means a complete bundle. Throws a DEV_BUNDLE_FAILED error naming the step. */
export function ensureDevBundle({ desktopDir, electronBinary, electronVersion, iconPath, run = defaultRun, fs = defaultFs, now = Date.now }) {
  const base = bundlePaths({ desktopDir, electronBinary });
  let paths = base;
  let iconBytes;
  try { iconBytes = fs.readFileSync(iconPath); } catch (err) { throw failed('stamp', errText(err)); }
  let stampText = null;
  try { stampText = fs.readFileSync(paths.stamp, 'utf8'); } catch { stampText = null; }
  const wanted = wantedStamp({ electronVersion, iconBytes });
  if (!needsRebuild({ stampText, wanted, binaryExists: fs.existsSync(paths.binary) })) return { binary: paths.binary, rebuilt: false };

  const removeWork = () => fs.rmSync(paths.workDir, { recursive: true, force: true });
  try {
    try {
      fs.mkdirSync(base.outDir, { recursive: true });
      removeStaleWork(base.outDir, fs, now());
      paths = bundlePaths({ desktopDir, electronBinary, workDir: fs.mkdtempSync(join(base.outDir, 'work-')) });
      fs.mkdirSync(paths.iconset, { recursive: true });
    } catch (err) {
      throw failed('copy', errText(err));
    }
    for (const { step, command, args } of bundleCommands(paths, { iconPath })) {
      const r = run(command, args) || {};
      if (r.error) throw failed(step, `${command} could not start: ${errText(r.error)}`);
      if (r.status !== 0) {
        const line = lastLine(r.stderr);
        throw failed(step, `${command} exited ${r.status ?? r.signal}${line ? `: ${line}` : ''}`);
      }
    }
    try {
      fs.rmSync(paths.stamp, { force: true });
      fs.rmSync(paths.app, { recursive: true, force: true });
      fs.renameSync(paths.tmpApp, paths.app);
      fs.writeFileSync(paths.stamp, `${JSON.stringify(wanted)}\n`);
    } catch (err) {
      throw failed('install', errText(err));
    }
  } catch (err) {
    try { removeWork(); } catch { /* a later build removes it once it is stale */ }
    throw err;
  }
  try { removeWork(); } catch { /* installed and stamped; a later build removes it once it is stale */ }
  return { binary: paths.binary, rebuilt: true };
}

/** Which Electron binary `npm start` runs: the Worca.app copy on macOS, else (or when it cannot be built, or with
 *  WORCA_DESKTOP_DEV_BUNDLE=0) the stock one, exactly like `electron .`. */
export function launchPlan({ platform, env, electronBinary, ensure }) {
  if (platform !== 'darwin' || (env && env.WORCA_DESKTOP_DEV_BUNDLE === '0')) return { binary: electronBinary, bundled: false, warning: null };
  try {
    const { binary } = ensure();
    return { binary, bundled: true, warning: null };
  } catch (err) {
    const step = (err && err.step) || 'setup';
    return {
      binary: electronBinary,
      bundled: false,
      warning: `worca desktop: could not build the dev Worca.app (${step}): ${errText(err)}. Launching the stock Electron.app; the menu bar will say "Electron".`,
    };
  }
}
