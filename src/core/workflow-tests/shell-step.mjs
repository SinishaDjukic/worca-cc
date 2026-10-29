// src/core/workflow-tests/shell-step.mjs — one command through the OS shell (cmd.exe /d /s /c, or /bin/sh -c), with a time
// limit and the end of its output (plans/workflow-tests-part3a-plan.md D55, D57): "Before each try, run" and the command
// check. Also the file a project try's setup leaves in its pipeline folder.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnActionProcess, stopProcess, actionBaseEnv } from '../actions/spawn.mjs';
import { withTryGuardEnv } from './try-guard-env.mjs';

export const TAIL_LINES = 40;
export const TAIL_BYTES = 8 * 1024;
export const SETUP_TIMEOUT_MS = 30 * 60_000;
export const TRY_SETUP_FILE = 'try-setup.json';
/** The harness's setup stage while a try's setup runs (state.setupStage): the runner reads it as the "Running setup" phase. */
export const TRY_SETUP_STAGE = 'Running setup';

/** What a project try's setup and command checks start from: the action env (no host credential, no Worca home),
 *  WORCA_TEST=1, and the outward guard writing to the try's connector-calls.ndjson (D56). */
export function tryShellEnv({ logFile = null } = {}) {
  return withTryGuardEnv({ ...actionBaseEnv(), WORCA_TEST: '1' }, logFile ? { logFile } : null);
}

/** @returns {Promise<{ok: boolean, exitCode: number|null, timedOut: boolean, ms: number, tail: string}>} never throws */
export async function runShellStep({ command, cwd, env, timeoutMs = SETUP_TIMEOUT_MS, signal = null, spawnImpl = null } = {}) {
  const t0 = Date.now();
  const lines = [];
  let bytes = 0;
  const onLine = (_stream, line) => {
    lines.push(line);
    bytes += line.length + 1;
    while (lines.length > TAIL_LINES || (bytes > TAIL_BYTES && lines.length > 1)) bytes -= lines.shift().length + 1;
  };
  let child;
  try { child = spawnActionProcess({ command, cwd, env, onLine, ...(spawnImpl ? { spawnImpl } : {}) }); }
  catch (e) { return { ok: false, exitCode: null, timedOut: false, ms: Date.now() - t0, tail: String(e && e.message ? e.message : e) }; }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void stopProcess(child); }, timeoutMs);
  const onAbort = () => { void stopProcess(child); };
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  const exitCode = await new Promise((done) => {
    child.once('error', (e) => { onLine('err', String(e && e.message ? e.message : e)); done(null); });
    child.once('close', (code) => done(code));
  });
  clearTimeout(timer);
  if (signal) signal.removeEventListener('abort', onAbort);
  return { ok: exitCode === 0 && !timedOut && !(signal && signal.aborted), exitCode, timedOut, ms: Date.now() - t0, tail: lines.join('\n') };
}

export async function writeTrySetup(pipelineDir, rec) {
  await writeFile(join(pipelineDir, TRY_SETUP_FILE), `${JSON.stringify(rec, null, 2)}\n`, 'utf8');
}

/** The setup record of a try, or null (no setup, or not written). Never throws. */
export async function readTrySetup(pipelineDir) {
  try {
    const v = JSON.parse(await readFile(join(pipelineDir, TRY_SETUP_FILE), 'utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}
