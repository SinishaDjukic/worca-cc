// server/settings-store.js
//
// User-level config for the dashboard, stored at ~/.worca-bench/settings.json:
//
//   { "result_dirs": ["/abs/path/a", "/abs/path/b"] }
//
// The dashboard reads benchmark results from the UNION of the launch --target-dir
// (always included — it's where new runs write) and these configured dirs. The
// Settings page adds/removes entries here. The `home` argument is injectable so
// tests never touch the real home directory.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** Resolve the ~/.worca-bench directory (override via arg or WORCA_BENCH_HOME). */
export function settingsHome(home) {
  return (
    home || process.env.WORCA_BENCH_HOME || join(homedir(), '.worca-bench')
  );
}

function settingsFile(home) {
  return join(settingsHome(home), 'settings.json');
}

/** Load settings, tolerant of a missing/corrupt file. */
export function loadSettings(home) {
  const file = settingsFile(home);
  if (!existsSync(file)) {
    return { result_dirs: [] };
  }
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return {
      ...data,
      result_dirs: Array.isArray(data.result_dirs) ? data.result_dirs : [],
    };
  } catch {
    return { result_dirs: [] };
  }
}

/** Persist settings (pretty-printed), creating ~/.worca-bench if needed. */
export function saveSettings(settings, home) {
  const file = settingsFile(home);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return settings;
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Add a result dir. Validates it is an existing directory; stores the absolute
 * path; dedupes. Returns the updated settings. Throws on a non-existent path.
 */
export function addResultDir(dir, home) {
  if (!dir || typeof dir !== 'string') {
    throw new Error('dir is required');
  }
  const abs = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  if (!isDir(abs)) {
    throw new Error(`not a directory: ${abs}`);
  }
  const settings = loadSettings(home);
  if (!settings.result_dirs.includes(abs)) {
    settings.result_dirs.push(abs);
    saveSettings(settings, home);
  }
  return settings;
}

/** Remove a result dir (absolute or relative form). Returns updated settings. */
export function removeResultDir(dir, home) {
  const abs = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  const settings = loadSettings(home);
  settings.result_dirs = settings.result_dirs.filter(
    (d) => d !== dir && d !== abs,
  );
  saveSettings(settings, home);
  return settings;
}

/**
 * The effective set of result dirs to read: the always-included primary
 * (launch) dir first, then the configured dirs — absolute, deduped, and only
 * those that currently exist.
 *
 * @returns {{ dirs: string[], primary: string, configured: string[] }}
 */
export function resolveResultDirs(primaryDir, home) {
  const settings = loadSettings(home);
  const primary = primaryDir ? resolve(primaryDir) : null;
  const seen = new Set();
  const dirs = [];
  for (const d of [primary, ...settings.result_dirs]) {
    if (!d) {
      continue;
    }
    const abs = resolve(d);
    if (seen.has(abs) || !isDir(abs)) {
      continue;
    }
    seen.add(abs);
    dirs.push(abs);
  }
  return { dirs, primary, configured: settings.result_dirs };
}
