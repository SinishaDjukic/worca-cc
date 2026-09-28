// src/core/graph/python-probe.mjs
// Can this host run a python script card? (scripts-workbench spec §7.) ONE answer,
// read by everything: the runner before it spawns, the run preflight, the bench,
// GET /api/scripts/runtimes and the Scripts page picker. Nothing else probes.
//
// Each candidate runs a stdlib one-liner and must print a parseable version
// array, so the Windows Store stub — an app-execution alias named python.exe that
// prints nothing and exits 9009 (or pops the Store) — fails the parse and is
// skipped instead of being reported as a working interpreter.
//
// Every seam is injectable (env, platform, spawn, settings, timeoutMs) so the
// Windows candidate order is unit-tested on macOS and Linux with no python
// installed. The 60 s cache covers the BARE call only: a unit test that injects a
// fake spawn can never poison what the server reads next.
import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { pythonPath } from '../settings.mjs';

/** 3.8 is the floor: importlib.util.spec_from_file_location + asyncio.run + f-strings. */
export const PYTHON_MIN = Object.freeze([3, 8]);
export const PROBE_TIMEOUT_MS = 5000;
export const PROBE_CACHE_MS = 60000;
/** The version answer is ~12 bytes. Anything that prints more than this is not a python, and an unbounded
 *  accumulator here is a HOST crash: `yes` fills a V8 string ("Invalid string length") well inside the 5 s window. */
export const PROBE_OUTPUT_MAX = 4096;
/** Standard library, one line, no f-string: it must at least PARSE on whatever the user points at. */
export const VERSION_SCRIPT = 'import sys,json;print(json.dumps(list(sys.version_info[:3])))';

const blank = (v) => typeof v !== 'string' || v.trim() === '';

/**
 * An explicit interpreter with a directory part is made ABSOLUTE here, once. The
 * probe spawns from the server's cwd and the runner spawns from the RUN's cwd (a
 * worktree somewhere else), so a relative `.venv/bin/python` would pass the probe
 * and then fail every execution with ENOENT. A bare name (`python3.12`) has no
 * directory part and stays a PATH lookup, which is cwd-independent.
 */
function explicitCommand(value, platform, cwd) {
  const v = value.trim();
  const p = platform === 'win32' ? path.win32 : path.posix;
  const hasDir = platform === 'win32' ? /[\\/]/.test(v) : v.includes('/');
  return [hasDir && !p.isAbsolute(v) ? p.resolve(cwd, v) : v];
}
const label = (command) => command.join(' ');

/**
 * The candidates, in order (§7). An EXPLICIT interpreter is AUTHORITATIVE: with
 * WORCA_PYTHON (or the pythonPath setting) set, that one is tried and the probe
 * stops — the failure sentence tells the user to set WORCA_PYTHON, so a silent
 * fall-through to some other python would make that advice a lie, and a venv
 * pointer must never be quietly replaced by the system interpreter. The value is
 * ONE executable path, used verbatim (`C:\Program Files\Python312\python.exe`).
 * @param {{env?:object, platform?:string, settings?:object|null, cwd?:string}} [o] `settings` is a test seam; null reads the store
 */
export function pythonCandidates({ env = process.env, platform = process.platform, settings = null, cwd = process.cwd() } = {}) {
  if (!blank(env.WORCA_PYTHON)) return [{ command: explicitCommand(env.WORCA_PYTHON, platform, cwd), source: 'WORCA_PYTHON' }];
  const configured = settings ? settings.pythonPath : pythonPath();
  if (!blank(configured)) return [{ command: explicitCommand(configured, platform, cwd), source: 'pythonPath' }];
  if (platform === 'win32') {
    return [{ command: ['py', '-3'], source: 'path' }, { command: ['python'], source: 'path' }, { command: ['python3'], source: 'path' }];
  }
  return [{ command: ['python3'], source: 'path' }, { command: ['python'], source: 'path' }];
}

/** `[3, 12, 4]` from the version script's stdout; null for anything else (the Store stub prints nothing). */
export function parseVersion(text) {
  const lines = String(text || '').trim().split('\n');
  const last = lines[lines.length - 1].trim();
  if (!last) return null;
  let v;
  try { v = JSON.parse(last); } catch { return null; }
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => Number.isInteger(n) && n >= 0)) return null;
  return v;
}

export const meetsFloor = (v) => v[0] > PYTHON_MIN[0] || (v[0] === PYTHON_MIN[0] && v[1] >= PYTHON_MIN[1]);

/**
 * Ask ONE candidate for its version. Never throws, never rejects.
 * Windows: `py.exe` launches `python.exe` as a child, so the timeout kill reaches
 * the launcher only — acceptable for a one-liner that exits immediately, and a
 * tree kill here would mean importing script-runner.mjs, which imports this module.
 * @returns {Promise<{version:number[]}|{error:string}>}
 */
function askVersion(command, { spawn, timeoutMs }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command[0], [...command.slice(1), '-c', VERSION_SCRIPT], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      resolve({ error: err?.message || String(err) });
      return;
    }
    let out = '';
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve(v);
    };
    const timer = setTimeout(() => done({ error: `no answer in ${Math.round(timeoutMs / 1000)} s` }), timeoutMs);
    child.stdout?.setEncoding('utf8').on('data', (c) => {
      if (settled) return;
      out += c;
      if (out.length > PROBE_OUTPUT_MAX) done({ error: 'printed more than a version' });
    });
    child.stderr?.resume();                    // drained, never read: a stub's banner is not an answer
    child.on('error', (err) => done({ error: err?.message || String(err) }));
    child.on('close', (code) => {
      const version = parseVersion(out);
      done(version ? { version } : { error: `exit ${code} with no version` });
    });
  });
}

/** The one sentence the picker shows as its `title` and the run/bench repeat. */
function failureReason(candidates, tried, tooOld) {
  if (tooOld) return `python ${tooOld.version.join('.')} at "${label(tooOld.command)}" is older than 3.8 — point WORCA_PYTHON at a newer interpreter`;
  const first = candidates[0];
  if (first?.source === 'WORCA_PYTHON') return `WORCA_PYTHON "${label(first.command)}" is not a working python`;
  if (first?.source === 'pythonPath') return `the pythonPath setting "${label(first.command)}" is not a working python`;
  return `no python 3.8 or newer found (tried ${tried.join(', ')})`;
}

async function runProbe({ env, platform, spawn, settings, timeoutMs, cwd }) {
  const candidates = pythonCandidates({ env, platform, settings, cwd });
  const tried = [];
  let tooOld = null;
  for (const c of candidates) {
    const r = await askVersion(c.command, { spawn, timeoutMs });
    tried.push(label(c.command));
    if (r.version && meetsFloor(r.version)) return { ok: true, command: c.command, version: r.version };
    if (r.version && !tooOld) tooOld = { command: c.command, version: r.version };
  }
  return { ok: false, reason: failureReason(candidates, tried, tooOld) };
}

let cached = null;                              // { at, promise } — the BARE call only

/**
 * The host's python (§7). Cached 60 s per process when called with NO options;
 * any option at all (a test seam) bypasses and never fills the cache.
 * @returns {Promise<{ok:true, command:string[], version:number[]}|{ok:false, reason:string}>}
 */
export function probePython(opts = {}) {
  const bare = Object.keys(opts).length === 0;
  if (bare && cached && Date.now() - cached.at < PROBE_CACHE_MS) return cached.promise;
  // NEVER rejects: express 4 does not catch an async handler's rejection, the bare promise is CACHED for 60 s,
  // and an unhandled rejection takes the server down. Whatever goes wrong here is "no python", with the reason.
  const promise = runProbe({
    env: opts.env || process.env,
    platform: opts.platform || process.platform,
    spawn: opts.spawn || nodeSpawn,
    settings: opts.settings || null,
    timeoutMs: Number.isInteger(opts.timeoutMs) ? opts.timeoutMs : PROBE_TIMEOUT_MS,
    cwd: opts.cwd,
  }).catch((err) => ({ ok: false, reason: `the python probe failed: ${err?.message || err}` }));
  if (bare) cached = { at: Date.now(), promise };
  return promise;
}

/** Drop the 60 s cache. Tests only — product code never calls it. */
export function resetPythonProbe() { cached = null; }

/** The `python` arm of GET /api/scripts/runtimes (spec §3.4). */
export function pythonRuntimeState(probe) {
  return probe?.ok
    ? { ok: true, version: probe.version.join('.'), command: probe.command }
    : { ok: false, reason: probe?.reason || 'python was not probed' };
}
