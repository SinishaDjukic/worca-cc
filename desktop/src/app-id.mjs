// desktop/src/app-id.mjs — the desktop app's one identity string (docs/desktop.md). No imports: tools/build.mjs and the
// controller both read it.

/** The electron-builder `appId`, the macOS CFBundleIdentifier and the Windows AppUserModelID (toasts are grouped and
 *  labelled by it). Changing it moves the bundle identity: a new app to the OS, its notification settings included. */
export const APP_ID = 'dev.worca.desktop';
