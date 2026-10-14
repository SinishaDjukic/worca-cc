// src/core/extension-package.mjs — the browser extension builds packaged with @worca/app
// (extension/dist/{chrome,edge,firefox}/, built by `prepack`, docs/browser-extension.md#install).
// One source for `worca extension` and Settings › General › Browser extension › Install.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXTENSION_BROWSERS = Object.freeze(['chrome', 'edge', 'firefox']);
export const EXTENSION_BUILD_COMMAND = 'npm run ext:build';
/** The installed package (or source checkout) root: this file is <root>/src/core/extension-package.mjs. */
export const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const STEPS = Object.freeze({
  chrome: ['Open chrome://extensions and turn on Developer mode.', 'Click Load unpacked and pick the folder above.', 'Pin Worca from the puzzle icon, open its sidebar and press Connect.'],
  edge: ['Open edge://extensions and turn on Developer mode.', 'Click Load unpacked and pick the folder above.', 'Open the Worca sidebar from the toolbar and press Connect.'],
  firefox: ['Open about:debugging and choose This Firefox.', 'Click Load Temporary Add-on… and pick manifest.json in the folder above.', 'The build is unsigned for now: Firefox removes it when it quits, so load it again after a restart.'],
});
export const installSteps = (browser) => [...(STEPS[browser] || [])];

/** { version, builds: [{ browser, path, present, version }] } for the package at `root`. A build is present when its
 *  manifest.json parses; its version is the manifest's version_name (Chrome/Edge, kept for an -rc) or version. */
export function extensionBuilds({ root = PACKAGE_ROOT, read = (p) => readFileSync(p, 'utf8') } = {}) {
  let version = '';
  try { version = JSON.parse(read(join(root, 'package.json'))).version || ''; } catch { version = ''; }
  const builds = EXTENSION_BROWSERS.map((browser) => {
    const path = join(root, 'extension', 'dist', browser);
    let manifest = null;
    try { manifest = JSON.parse(read(join(path, 'manifest.json'))); } catch { manifest = null; }
    return { browser, path, present: !!manifest, version: manifest ? String(manifest.version_name || manifest.version || '') : null };
  });
  return { version, builds };
}

/** The GitHub release asset for one browser (release-npm-app.yml attaches worca-<browser>-<version>.zip). */
export function releaseZipUrl(repoUrl, version, browser) {
  return repoUrl && version ? `${repoUrl}/releases/download/worca-app-v${version}/worca-${browser}-${version}.zip` : '';
}

/** GET /api/extension/install's body. A hosted Worca (remoteMode) never shows its server paths: the folder is on the
 *  server, not on the viewer's computer, so there the release zips are the way in. */
export function extensionInstallInfo({ root = PACKAGE_ROOT, read, remoteMode = false, repoUrl = '', releaseUrl = '' } = {}) {
  const { version, builds } = extensionBuilds({ root, read });
  return {
    remoteMode: !!remoteMode,
    version,
    releaseUrl,
    buildCommand: EXTENSION_BUILD_COMMAND,
    builds: builds.map((b) => ({
      browser: b.browser,
      present: b.present,
      path: remoteMode ? null : b.path,
      version: b.version,
      steps: installSteps(b.browser),
      downloadUrl: releaseZipUrl(repoUrl, version, b.browser),
    })),
  };
}
