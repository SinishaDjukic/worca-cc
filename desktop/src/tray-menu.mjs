// desktop/src/tray-menu.mjs — the tray menu (docs/desktop.md). Launch at login is hidden on Linux: Electron has no
// login-item API there. Imports nothing.

export function trayMenuTemplate({ platform, openAtLogin = false, ownsServer = false, onOpen, onToggleLogin, onQuit }) {
  const items = [
    { label: 'Open Worca', click: () => onOpen() },
    { type: 'separator' },
  ];
  if (platform !== 'linux') {
    items.push({ label: 'Launch at login', type: 'checkbox', checked: !!openAtLogin, click: () => onToggleLogin(!openAtLogin) });
    items.push({ type: 'separator' });
  }
  items.push({ label: ownsServer ? 'Quit Worca (stops the Worca server)' : 'Quit Worca', click: () => onQuit() });
  return items;
}
