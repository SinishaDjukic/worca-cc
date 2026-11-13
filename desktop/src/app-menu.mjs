// desktop/src/app-menu.mjs — the macOS application menu, the About panel options and the version they show
// (docs/desktop.md "App name, menu and icon"). Plain templates and options: the controller hands them to electron.
// Imports only node: builtins.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The app's name: the menu labels, app.setName, and the userData folder name (equal to desktop/package.json
 *  productName and the builder productName; tests pin that). */
export const APP_NAME = 'Worca';

const SEP = { type: 'separator' };

/** Worca, Edit, View and Window menus. The Worca items carry explicit labels next to their roles: the role gives the
 *  native behaviour and accelerator, the label pins the text whatever app.name is. DevTools only when unpackaged. */
export function appMenuTemplate({ appName = APP_NAME, packaged }) {
  return [
    {
      label: appName,
      submenu: [
        { role: 'about', label: `About ${appName}` },
        { ...SEP },
        { role: 'services' },
        { ...SEP },
        { role: 'hide', label: `Hide ${appName}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { ...SEP },
        { role: 'quit', label: `Quit ${appName}` },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { ...SEP },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { ...SEP },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { ...SEP },
        { role: 'togglefullscreen' },
        ...(packaged ? [] : [{ ...SEP }, { role: 'toggleDevTools' }]),
      ],
    },
    {
      // role 'window' makes macOS add its window list; close is here because there is no File menu (Cmd+W).
      label: 'Window',
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
        { ...SEP },
        { role: 'front' },
      ],
    },
  ];
}

/** app.setAboutPanelOptions input. `version` equals applicationVersion: AppKit otherwise shows CFBundleVersion in
 *  parentheses, which in dev is the Electron version. */
export function aboutPanelOptions({ appName = APP_NAME, version, iconPath }) {
  return { applicationName: appName, applicationVersion: version, version, ...(iconPath ? { iconPath } : {}) };
}

/** The worca version of the checkout (`<desktopDir>/../package.json`); null when it cannot be read. Never throws. */
export function readRootVersion(desktopDir, { read = readFileSync } = {}) {
  try {
    const pkg = JSON.parse(read(resolve(desktopDir, '..', 'package.json'), 'utf8'));
    return pkg && typeof pkg.version === 'string' && pkg.version ? pkg.version : null;
  } catch {
    return null;
  }
}

/** Packaged: app.getVersion() (the root version through extraMetadata). Dev: the root version, else app.getVersion(). */
export function aboutVersion({ packaged, appVersion, rootVersion }) {
  if (packaged) return appVersion;
  return rootVersion || appVersion;
}

/** The 1024px worca icon; outside the asar, so read from the checkout in dev. */
export function devIconPath(desktopDir) {
  return join(desktopDir, 'build-resources', 'icon.png');
}
