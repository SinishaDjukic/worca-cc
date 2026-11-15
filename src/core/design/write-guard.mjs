// src/core/design/write-guard.mjs
// The Design write guard (SPEC C-1, C-3, C-10; plan L1.4-L1.7): a PreToolUse hook that confines a Design agent's writes
// to the folders the engine names, the twin of the file-read guard (../file-read-guard.mjs). It is fail-CLOSED: its CLI
// (write-guard-cli.mjs) exits 2, which blocks the call, unless it explicitly allows. It keeps no decision log (L1.5).
// It runs once per write, so it imports only node built-ins, the read guard's path helpers and ids.mjs: never db.mjs.
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lexicalPath, nativeOf } from '../file-read-guard.mjs';
import { WINDOWS_RESERVED } from './ids.mjs';

export const WRITE_GUARD_MATCHER = 'Write|Edit|MultiEdit|NotebookEdit';
const WRITE_TOOLS = WRITE_GUARD_MATCHER.split('|');
const PATH_FIELDS = ['file_path', 'notebook_path'];
const HEAD = 'design write guard: ';
/** Instruction files Claude Code loads as memory from an agent's cwd, every folder above it and any folder it reads, and
 *  that other engines load (P8): one written by an agent would be instructions to every other agent and every later
 *  round (C1). Refused in any case, since APFS and NTFS fold it, at every segment. */
const MEMORY_FILES = new Set(['claude.md', 'claude.local.md', 'agents.md']);
/** A Windows 8.3 short name (`CLAUDE~1.MD`): the alias of a long name, which only the real-path check can expand, and
 *  only once that file exists. No design file is named like one. */
const SHORT_NAME = /^[^~.]{1,6}~\d+(\.[^.]{0,3})?$/i;

// Forward slashes, JSON-quoted, and `$` and backtick escaped too (L1.6): inside the hook shell's double quotes a folder
// holding either would otherwise run a substitution, or make a command the shell cannot launch, which runs the tool.
const q = (s) => JSON.stringify(String(s).replaceAll('\\', '/')).replace(/[$`]/g, '\\$&');

/** The CLI by its real path: a symlinked install (or --preserve-symlinks-main) can never point the hook elsewhere. */
function cliPath() {
  const p = fileURLToPath(new URL('./write-guard-cli.mjs', import.meta.url));
  try { return realpathSync.native(p); } catch { return p; }
}

/** The PreToolUse entry of one Design agent: the CLI, run with the server's own node, given every allowed folder. Throws
 *  unless `allowedDirs` is a non-empty array of absolute paths, so a caller can never ship an entry that guards nothing.
 *  Claude Code runs the tool on any exit but 2, so ` || exit 2` turns a hook that cannot launch (127: node moved by an
 *  upgrade while the server runs) or whose CLI cannot load (1) into a refusal; an allow (0) and a refusal (2) pass as they are. */
export function writeGuardHookEntry(opts) {
  const dirs = opts && typeof opts === 'object' ? opts.allowedDirs : undefined;
  if (!Array.isArray(dirs) || !dirs.length || !dirs.every((d) => typeof d === 'string' && path.isAbsolute(d) && lexicalPath(d) !== null)) {
    throw new Error('writeGuardHookEntry: allowedDirs must be a non-empty array of absolute paths');
  }
  return { matcher: WRITE_GUARD_MATCHER, hooks: [{ type: 'command', command: `${[process.execPath, cliPath(), ...dirs].map(q).join(' ')} || exit 2` }] };
}

const defaultReal = (p) => realpathSync.native(p);

function refusal(allowedDirs) {
  const names = Array.isArray(allowedDirs) ? allowedDirs.filter((d) => typeof d === 'string' && d) : [];
  if (!names.length) return `${HEAD}no folder is open for writing here, so this write is refused.`;
  return `${HEAD}writes may go only to files inside ${names.join(', ')}, and never into a name starting with a dot there (only a first-level .asks folder is allowed), nor into a CLAUDE.md, CLAUDE.local.md or AGENTS.md.`;
}

/** What follows `base` in `p`, bounded at a segment; null when `p` is not strictly inside `base`. */
function below(p, base) {
  const b = base.endsWith('/') ? base : `${base}/`;
  return p.length > b.length && p.startsWith(b) ? p.slice(b.length) : null;
}

/** L1.4 and the Windows name rules, on a lexical remainder below an allowed dir (lower-cased on win32 by lexicalPath):
 *  no empty segment, no dot entry except a first-level `.asks` folder, no instruction file (C1), and on win32 no trailing
 *  dot or space, no stream (`:`), no device name before the first dot and no 8.3 short name. */
function remainderOk(rest, platform) {
  if (rest == null) return false;
  const segs = rest.split('/');
  return segs.every((s, i) => {
    if (!s) return false;
    if (s.startsWith('.') && !(i === 0 && s === '.asks' && segs.length > 1)) return false;
    if (MEMORY_FILES.has(s.toLowerCase())) return false;
    if (platform !== 'win32') return true;
    return !/[. ]$/.test(s) && !s.includes(':') && !WINDOWS_RESERVED.test(s.split('.')[0].trimEnd()) && !SHORT_NAME.test(s);
  });
}

/** Every allowed dir as its server spelling and its real spelling, both lexical. A dir that is not absolute, or whose real
 *  path cannot be taken (it does not exist), allows nothing. */
function dirSpellings(allowedDirs, platform, real) {
  if (!Array.isArray(allowedDirs)) return [];
  const out = [];
  for (const d of allowedDirs) {
    const server = lexicalPath(d, { platform });
    if (!server) continue;
    let realDir;
    try { realDir = lexicalPath(real(d), { platform }); } catch { continue; }
    if (realDir) out.push({ server, realDir });
  }
  return out;
}

/** The lexical real path a write lands on: walk up with `lstat` to the deepest component that exists, take its real path
 *  and add the missing tail. Null when `real` throws (a dangling link passes `lstat` and throws here) or `lstat` fails with
 *  anything but ENOENT/ENOTDIR. */
function realTarget(fp, { platform, real, lstat }) {
  const P = platform === 'win32' ? path.win32 : path.posix;
  let at = nativeOf(fp, platform);
  const tail = [];
  for (;;) {
    try { lstat(at); break; } catch (e) {
      if (!e || (e.code !== 'ENOENT' && e.code !== 'ENOTDIR')) return null;
    }
    const up = P.dirname(at);
    if (up === at) return null;
    tail.unshift(P.basename(at));
    at = up;
  }
  let base;
  try { base = real(at); } catch { return null; }
  return lexicalPath(tail.length ? P.join(base, ...tail) : base, { platform });
}

function pathAllowed(fp, dirs, opts) {
  const candidate = lexicalPath(fp, { platform: opts.platform });
  if (!candidate) return false;
  const matching = dirs.filter(({ server, realDir }) => remainderOk(below(candidate, server), opts.platform)
    || remainderOk(below(candidate, realDir), opts.platform));
  if (!matching.length) return false;
  const target = realTarget(fp, opts);
  return target !== null && matching.some(({ realDir }) => remainderOk(below(target, realDir), opts.platform));
}

/**
 * The pure decision: null allows; a string refuses, and is what the model reads. Only a write tool, and only when every
 * path field it carries is strictly inside an allowed dir as a string (its server or its real spelling) with no dot entry
 * below it, and the real path the write lands on is inside that dir's real path under the same rule (on Windows this is
 * what catches an 8.3 name of a dot entry). A path that fails the string checks is never looked up.
 */
export function evaluateWrite(payload, allowedDirs, { platform = process.platform, real = defaultReal, lstat = lstatSync } = {}) {
  const tool = payload && typeof payload === 'object' && typeof payload.tool_name === 'string' ? payload.tool_name : '';
  if (!WRITE_TOOLS.includes(tool)) return `${HEAD}only Write, Edit, MultiEdit and NotebookEdit are decided here (${tool || 'an unknown tool'} refused).`;
  const no = refusal(allowedDirs);
  const input = payload.tool_input;
  if (!input || typeof input !== 'object') return no;
  const fields = PATH_FIELDS.filter((k) => Object.hasOwn(input, k));
  if (!fields.length) return no;
  const dirs = dirSpellings(allowedDirs, platform, real);
  if (!dirs.length) return no;
  return fields.every((k) => pathAllowed(input[k], dirs, { platform, real, lstat })) ? null : no;
}
