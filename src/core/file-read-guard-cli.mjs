// src/core/file-read-guard-cli.mjs
// The file-read guard's hook entry (file-read-guard.mjs; plans/requirements-a8-design.md D3, D15), run by Claude Code as
// `node file-read-guard-cli.mjs <allowed file> [<decision log>]` with the PreToolUse payload on stdin. Only exit 2 blocks
// a tool call, so the exit code is 2 from the first statement and only an explicit allow sets 0: an exception, a missing
// argument, a payload it cannot read or a log it cannot write all leave 2. No is-main check: this file is only ever run,
// never imported, so a symlinked or preserved path cannot turn the hook into a no-op.
import { appendFileSync } from 'node:fs';
import { evaluateFileRead, decisionEntry } from './file-read-guard.mjs';

process.exitCode = 2;
const UNREADABLE = 'file-read guard: the request could not be read, so it is refused.';
const refuse = (reason) => {
  process.exitCode = 2;
  try { process.stderr.write(`${reason}\n`); } catch { /* the code still blocks */ }
};
// An uncaught error would exit 1, which Claude Code treats as "no decision" and runs the tool: refuse instead.
process.on('uncaughtException', () => { refuse(UNREADABLE); process.exit(2); });
// A payload that never ends must not outlive Claude Code's own hook timeout (also "no decision").
setTimeout(() => { refuse(UNREADABLE); process.exit(2); }, 20_000).unref();

const [allowed, log] = process.argv.slice(2);
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('error', () => refuse(UNREADABLE));
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let payload = null;
  let reason;
  try {
    payload = JSON.parse(raw);
    reason = evaluateFileRead(payload, allowed);
  } catch { reason = UNREADABLE; }
  if (log) {
    try { appendFileSync(log, `${JSON.stringify(decisionEntry(payload, reason))}\n`); }
    catch { reason = reason || 'file-read guard: this read could not be recorded, so it is refused.'; }
  }
  if (reason) refuse(reason);
  else process.exitCode = 0;
});
