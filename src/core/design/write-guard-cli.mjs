// src/core/design/write-guard-cli.mjs
// The Design write guard's hook entry (write-guard.mjs), run by Claude Code as `node write-guard-cli.mjs <dir>...` with
// the PreToolUse payload on stdin. Only exit 2 blocks a tool call, so the exit code is 2 from the first statement and only
// an explicit allow sets 0: an exception, no dirs or a payload it cannot read all leave 2. No decision log (L1.5). No
// is-main check: this file is only ever run, never imported, so a symlinked or preserved path cannot turn the hook into a
// no-op.
import { evaluateWrite } from './write-guard.mjs';

process.exitCode = 2;
const UNREADABLE = 'design write guard: the request could not be read, so it is refused.';
const refuse = (reason) => {
  process.exitCode = 2;
  try { process.stderr.write(`${reason}\n`); } catch { /* the code still blocks */ }
};
// An uncaught error would exit 1, which Claude Code treats as "no decision" and runs the tool: refuse instead.
process.on('uncaughtException', () => { refuse(UNREADABLE); process.exit(2); });
// A payload that never ends must not outlive Claude Code's own hook timeout (also "no decision").
setTimeout(() => { refuse(UNREADABLE); process.exit(2); }, 20_000).unref();

const dirs = process.argv.slice(2);
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('error', () => refuse(UNREADABLE));
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let reason;
  try { reason = evaluateWrite(JSON.parse(raw), dirs); } catch { reason = UNREADABLE; }
  if (reason) refuse(reason);
  else process.exitCode = 0;
});
