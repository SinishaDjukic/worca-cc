// src/core/file-read-guard.mjs
// The file-read guard (plans/requirements-a8-design.md D3, D15): a PreToolUse hook that confines one Requirements file
// read, or one question about a file, to the single copy in its read folder. The engine reads a path its allow list does
// not name (Ask's measured `unmatched => allow`, src/core/ask/spawn.mjs), so the call's allow rule is intent; this hook
// is the enforcement. It runs on every tool (matcher '*'): Read may open only the copy, every other tool is refused.
// Unlike the host guard (host-guard.mjs) it is fail-CLOSED: a payload it cannot read is refused.
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Forward slashes, JSON-quoted: the host guard's form (its comment says why).
const q = (s) => JSON.stringify(String(s).replaceAll('\\', '/'));

/** The PreToolUse entry of one read: this file, run with the server's own node, given the copy's absolute path. */
export function readGuardHookEntry(allowedPath) {
  if (typeof allowedPath !== 'string' || !path.isAbsolute(allowedPath)) throw new Error('readGuardHookEntry: the allowed file must be an absolute path');
  return { matcher: '*', hooks: [{ type: 'command', command: `${q(process.execPath)} ${q(fileURLToPath(import.meta.url))} ${q(allowedPath)}` }] };
}

const defaultReal = (p) => realpathSync.native(p);

/** One path in a comparable form: Git Bash's /c/… read as c:/… on Windows, resolved against `base`, its real path when
 *  it exists (a symlink is followed), forward slashes, lower-cased on Windows. */
export function comparablePath(p, { platform = process.platform, base = '', real = defaultReal } = {}) {
  const P = platform === 'win32' ? path.win32 : path.posix;
  let s = String(p);
  if (platform === 'win32' && /^\/[a-zA-Z]\//.test(s)) s = `${s[1]}:${s.slice(2)}`;
  let r = base ? P.resolve(base, s) : P.resolve(P.sep, s);
  try { r = real(r); } catch { /* not there: as resolved */ }
  r = r.replaceAll('\\', '/');
  return platform === 'win32' ? r.toLowerCase() : r;
}

/** The pure decision: null allows; a string denies, and is what the model reads. */
export function evaluateFileRead(payload, allowedPath, { platform = process.platform, real = defaultReal } = {}) {
  const tool = payload && typeof payload.tool_name === 'string' ? payload.tool_name : '';
  if (tool !== 'Read') return `file-read guard: only Read of the attached file is allowed here (${tool || 'an unknown tool'} refused).`;
  const fp = payload.tool_input && payload.tool_input.file_path;
  const deny = 'file-read guard: this read may open only the attached file.';
  if (typeof fp !== 'string' || !fp.trim()) return deny;
  // No usable allowed file (the hook run without its argument): nothing is allowed, rather than `String(undefined)`.
  if (typeof allowedPath !== 'string' || !(platform === 'win32' ? path.win32 : path.posix).isAbsolute(allowedPath)) return deny;
  const base = typeof payload.cwd === 'string' ? payload.cwd : '';
  return comparablePath(fp, { platform, base, real }) === comparablePath(allowedPath, { platform, real }) ? null : deny;
}

// ── hook CLI: argv[2] is the allowed file, stdin the PreToolUse payload. exit 0 allows; exit 2 denies, stderr to the model.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const unreadable = 'file-read guard: the request could not be read, so it is refused.';
  const refuse = (reason) => { process.stderr.write(`${reason}\n`); process.exit(2); };
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('error', () => refuse(unreadable));   // only exit 2 blocks a tool: no other exit may end a broken read
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', () => {
    let reason;
    try { reason = evaluateFileRead(JSON.parse(raw), process.argv[2]); }
    catch { reason = unreadable; }
    if (reason) refuse(reason);
    process.exit(0);
  });
}
