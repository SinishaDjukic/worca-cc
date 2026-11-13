// desktop/src/instance.mjs — the worca store the desktop app shares with a CLI or web install, a server already
// running on it, the app's own single-instance lock and its start-hidden rule (docs/desktop.md).
// Imports only node: builtins (and sibling desktop/src modules).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { probeHealth } from './ready.mjs';

const nonBlank = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * worcaHome() (src/core/projects.mjs) re-implemented: importing it would load node:sqlite into Electron main.
 * WORCA_HOME (non-blank) → the `root` in <base home>/.worca-cc/settings.json (non-blank) → base home; the chosen value
 * is used untrimmed, as worcaHome() does. Base home = HOME → USERPROFILE → home. test/desktop-instance pins parity.
 */
export function resolveStoreDir({ env = process.env, home, readFile = readFileSync }) {
  const baseHome = env.HOME || env.USERPROFILE || home;
  let base = null;
  if (nonBlank(env.WORCA_HOME)) base = env.WORCA_HOME;
  else {
    try {
      const s = JSON.parse(String(readFile(join(baseHome, '.worca-cc', 'settings.json'), 'utf8')));
      if (s && typeof s === 'object' && !Array.isArray(s) && nonBlank(s.root)) base = s.root;
    } catch { /* missing or corrupt: no root */ }
  }
  return join(resolve(base || baseHome), '.worca-cc');
}

/** `{ pid, host, port, token }` from <storeDir>/ui.json, or null (missing, corrupt, non-integer pid or port). */
export function readUiInstanceFile(storeDir, { readFile = readFileSync } = {}) {
  try {
    const d = JSON.parse(String(readFile(join(storeDir, 'ui.json'), 'utf8')));
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    const pid = d.pid; const port = d.port;
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
    return { pid, host: typeof d.host === 'string' ? d.host : '', port, token: typeof d.token === 'string' ? d.token : '' };
  } catch {
    return null;
  }
}

/** The URL to probe AND to load: a wildcard bind is dialled on 127.0.0.1; ::1 / localhost as localhost. */
export function probeUrl(host, port) {
  const h = String(host || '');
  if (!h || h === '0.0.0.0' || h === '::') return `http://127.0.0.1:${port}`;
  if (h === '::1' || h === 'localhost') return `http://localhost:${port}`;
  return `http://${h.includes(':') && !h.startsWith('[') ? `[${h}]` : h}:${port}`;
}

const isWorca = (h) => !!h && h.name === '@worca/app';

/**
 * A server already running on THIS store, or null. Reuse needs ui.json's pid === the health pid. A worca answering on
 * the preferred port with no matching ui.json may be the write race (health answers before ui.json exists): poll the
 * file every 250 ms up to raceWaitMs; still no match → a server of another store (the caller starts its own).
 */
export async function findRunningServer({ storeDir, probe = probeHealth, readFile = readFileSync, preferredPort = 4317, raceWaitMs = 3000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const fromFile = async () => {
    const file = readUiInstanceFile(storeDir, { readFile });
    if (!file) return null;
    const url = probeUrl(file.host, file.port);
    const health = await probe(url);
    return isWorca(health) && health.pid === file.pid ? { url, port: file.port, pid: file.pid, owned: false } : null;
  };
  const hit = await fromFile();
  if (hit) return hit;
  if (!isWorca(await probe(`http://127.0.0.1:${preferredPort}`))) return null;
  for (let waited = 0; waited < raceWaitMs; waited += 250) {
    await sleep(250);
    const later = await fromFile();
    if (later) return later;
  }
  return null;
}

/** One app instance: a second launch quits at once and the first one's onSecondInstance runs. */
export function setupSingleInstance(app, { onSecondInstance }) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', onSecondInstance);
  return true;
}

/** Started at login → tray only. macOS: wasOpenedAtLogin; Windows: the --hidden login-item arg; Linux: never. */
export function shouldStartHidden({ platform, argv = [], loginItem }) {
  if (platform === 'darwin') return loginItem?.wasOpenedAtLogin === true;
  if (platform === 'win32') return argv.includes('--hidden');
  return false;
}
