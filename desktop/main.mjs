// desktop/main.mjs — the Electron entry of the Worca desktop app (docs/desktop.md). Glue only: the only file that
// imports electron; everything else lives in src/ (tested without Electron). The window's preload is preload.cjs.
import { app, BrowserWindow, Tray, Menu, shell, dialog, session, nativeImage, ipcMain, nativeTheme } from 'electron';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDesktopController } from './src/controller.mjs';

createDesktopController({
  electron: { app, BrowserWindow, Tray, Menu, shell, dialog, session, nativeImage, ipcMain, nativeTheme },
  platform: process.platform,
  argv: process.argv,
  env: process.env,
  home: homedir(),
  resourcesPath: process.resourcesPath,
  packaged: app.isPackaged,
  desktopDir: dirname(fileURLToPath(import.meta.url)),
}).start();
