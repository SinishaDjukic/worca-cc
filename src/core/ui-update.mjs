// src/core/ui-update.mjs
// The update handoff between ui/server.mjs (asks, drains, exits UPDATE_EXIT_CODE) and the `worca ui`
// supervisor (installs, restarts). The record format is a cross-version contract: a parent of one
// version reads what a server of another wrote. Only ever ADD fields.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { worcaHome } from './projects.mjs';
import { DEFAULT_UI_PORT } from './ui-instance.mjs';
import { canonicalVersion } from './update-check.mjs';

const execFileP = promisify(execFile);
export const UPDATE_EXIT_CODE = 75;
export const SUPERVISOR_ENV = 'WORCA_UI_SUPERVISOR';
export const DRY_RUN_ENV = 'WORCA_UPDATE_DRY_RUN';      // manual testing: the supervisor skips npm, the server skips the npm checks
const OUTPUT_TAIL = 4000;
const SAFE_VERSION = /^[0-9A-Za-z.-]+$/;

/** The server was started by a `worca ui` supervisor: the flag holds the PARENT's pid (an inherited copy does not match). */
export function supervisorMatches(env = process.env, ppid = process.ppid) {
  const v = String(env[SUPERVISOR_ENV] || '').trim();
  return /^\d+$/.test(v) && Number(v) === ppid;
}

export function updateRecordPath(home = worcaHome()) { return join(home, 'update.json'); }

export function readUpdateRecord(file = updateRecordPath()) {
  try { const v = JSON.parse(readFileSync(file, 'utf8')); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

export function writeUpdateRecord(rec, file = updateRecordPath()) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

export function npmInstallArgs(version) {
  const v = canonicalVersion(version);
  if (!v || !SAFE_VERSION.test(v)) throw new Error(`not a version npm may install: ${String(version).slice(0, 40)}`);
  return ['install', '-g', `@worca/app@${v}`];
}

export function startCommand(port, defaultPort = DEFAULT_UI_PORT) {
  const n = Number(port);
  return Number.isInteger(n) && n > 0 && n !== defaultPort ? `worca ui --port ${n}` : 'worca ui';
}

export function manualUpdateCommand(version) {
  return `npm install -g @worca/app@${canonicalVersion(version)} && worca ui restart`;
}

const tail = (s) => (s.length > OUTPUT_TAIL ? s.slice(-OUTPUT_TAIL) : s);

export function summarizeNpmFailure(output = '', err = null) {
  const code = /npm (?:ERR!|error) code (\S+)/.exec(output)?.[1] || (typeof err?.code === 'string' ? err.code : '');
  const path = /npm (?:ERR!|error) path (\S+)/.exec(output)?.[1] || '';
  if (code === 'ENOENT' && !output) return 'npm was not found on the PATH';
  if (code === 'EACCES' || code === 'EPERM') return `npm could not write to ${path || 'its global folder'} (${code})`;
  if (code === 'ETARGET' || code === 'E404') return `npm could not find that version (${code})`;
  if (/^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET)$/.test(code)) return `npm could not reach the registry (${code})`;
  if (err?.killed) return 'npm took too long and was stopped';
  if (code) return `npm failed (${code})`;
  return `npm failed${err?.message ? `: ${String(err.message).split('\n')[0]}` : ''}`;
}

// Windows: npm is npm.cmd, which needs a shell (execFile of a .cmd → EINVAL), same as plugin-store's
// runSetup. Safe because every argument is a literal or a canonical version (SAFE_VERSION).
export async function runNpmInstall(version, { exec = execFileP, platform = process.platform, signal, timeoutMs = 10 * 60_000 } = {}) {
  const args = npmInstallArgs(version);
  try {
    const r = await exec('npm', args, { shell: platform === 'win32', windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs, signal });
    return { ok: true, output: tail(`${r.stdout || ''}${r.stderr || ''}`) };
  } catch (err) {
    const output = tail(`${err.stdout || ''}${err.stderr || ''}`);
    return { ok: false, reason: summarizeNpmFailure(output, err), output };
  }
}
