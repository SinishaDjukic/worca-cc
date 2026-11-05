// src/core/engines/exec-cli.mjs — the one execFile every engine CLI probe goes
// through (--version, login status, --help …). It resolves the configured bin
// through the shared resolver first, so a Windows npm `.cmd` shim becomes a
// spawnable program instead of ENOENT/EINVAL, and it tags the error with the
// resolver's explanation when the bin still cannot be spawned. Never a shell.
import { execFile as nodeExecFile } from 'node:child_process';
import { resolveCliCommand, explainUnspawnableCli } from '../cli-resolve.mjs';

const _ov = { execFile: null, explain: null };
/** Test seam: stub the underlying execFile (records file/args/options) and/or the
 *  explanation, which receives `(bin, spec)`. */
export const _testing = {
  set({ execFile = _ov.execFile, explain = _ov.explain } = {}) { _ov.execFile = execFile; _ov.explain = explain; },
  reset() { _ov.execFile = null; _ov.explain = null; },
};

/**
 * `child_process.execFile` for an engine CLI: same callback semantics, but `bin`
 * is resolved for `spec` first. An ENOENT/EINVAL error gets `err.cliHint` (string
 * or null). Returns the ChildProcess (undefined when execFile threw synchronously).
 */
export function execCli(spec, bin, args, options, callback) {
  const run = _ov.execFile ?? nodeExecFile;
  const explain = _ov.explain ?? explainUnspawnableCli;
  const done = (err, stdout, stderr) => {
    if (err && typeof err.code === 'string' && /^(ENOENT|EINVAL)$/.test(err.code)) {
      let hint = null;
      try { hint = explain(bin, spec) ?? null; } catch { hint = null; }
      err.cliHint = hint;
    }
    callback(err, stdout, stderr);
  };
  const { file, args: argv } = resolveCliCommand(bin, args, spec);
  try {
    return run(file, argv, { windowsHide: true, ...options }, done);
  } catch (err) {
    done(err, '', '');
    return undefined;
  }
}

/** The refusal text for a CLI that cannot be run. When the resolver found a shim
 *  (`err.cliHint`), its explanation REPLACES the site's install tail. */
export function cliRefusal({ bin, err, install }) {
  return `cannot run ${bin} (${err.code}) — ${err.cliHint ?? install}`;
}
