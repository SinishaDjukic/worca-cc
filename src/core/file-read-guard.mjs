// src/core/file-read-guard.mjs
// The file-read guard (plans/requirements-a8-design.md D3, D15): a PreToolUse hook that confines one Requirements file
// read, or one question about a file, to the single copy in its read folder. The engine reads a path its allow list does
// not name (Ask's measured `unmatched => allow`, src/core/ask/spawn.mjs), so the call's allow rule is intent; this hook
// is the enforcement. It runs on every tool (matcher '*'): Read may open only the copy, every other tool is refused.
// Unlike the host guard (host-guard.mjs) it is fail-CLOSED: its CLI (file-read-guard-cli.mjs) exits 2, which blocks the
// call, unless it explicitly allows. Each decision is appended to a log the server names, so the caller can tell that
// every tool call of a read was decided by the guard (guardDecisionsCover) rather than trusting that the hook ran.
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Forward slashes, JSON-quoted: the host guard's form (its comment says why).
const q = (s) => JSON.stringify(String(s).replaceAll('\\', '/'));

/** The CLI by its real path: a symlinked install (or --preserve-symlinks-main) can never point the hook elsewhere. */
function cliPath() {
  const p = fileURLToPath(new URL('./file-read-guard-cli.mjs', import.meta.url));
  try { return realpathSync.native(p); } catch { return p; }
}

/** The PreToolUse entry of one read: the CLI, run with the server's own node, given the copy's absolute path and, when
 *  the server names one, the absolute path of the decision log. */
export function readGuardHookEntry(allowedPath, { log = null } = {}) {
  if (typeof allowedPath !== 'string' || !path.isAbsolute(allowedPath)) throw new Error('readGuardHookEntry: the allowed file must be an absolute path');
  if (log != null && (typeof log !== 'string' || !path.isAbsolute(log))) throw new Error('readGuardHookEntry: the decision log must be an absolute path');
  const args = [process.execPath, cliPath(), allowedPath, ...(log ? [log] : [])];
  return { matcher: '*', hooks: [{ type: 'command', command: args.map(q).join(' ') }] };
}

const defaultReal = (p) => realpathSync.native(p);
const ONLY = 'file-read guard: this read may open only the attached file.';

/** A path's lexical form, decided on the string alone: an absolute path (Windows: a drive letter, `/c/…` read as
 *  `c:/…`), `.` and doubled separators collapsed, forward slashes, lower-cased on Windows. Null for anything else —
 *  relative, rooted without a drive, UNC, `\\?\` and `\\.\` device paths, a NUL, or any `..` step — so such a path is
 *  refused without ever reaching the file system (no lookup a share or a pipe could answer). */
export function lexicalPath(p, { platform = process.platform } = {}) {
  if (typeof p !== 'string' || !p || p.includes('\0')) return null;
  if (platform === 'win32') {
    let s = p.replaceAll('\\', '/');
    if (/^\/[a-zA-Z]\//.test(s)) s = `${s[1]}:${s.slice(2)}`;
    if (!/^[a-zA-Z]:\//.test(s) || s.split('/').includes('..')) return null;
    return path.win32.normalize(s).replaceAll('\\', '/').toLowerCase();
  }
  if (!p.startsWith('/') || p.split('/').includes('..')) return null;
  return path.posix.normalize(p);
}

/** The path a lexically matching candidate is looked up by: Git Bash's `/c/…` as `c:/…` on Windows, else itself. */
const nativeOf = (p, platform) => (platform === 'win32' && /^[/\\][a-zA-Z][/\\]/.test(p) ? `${p[1]}:${p.slice(2)}` : p);

/**
 * The pure decision: null allows; a string denies, and is what the model reads. Lexical first: the candidate must be,
 * as a string, the copy's path or the copy's real path (both chosen by the server); only then is the candidate's own
 * real path taken, to confirm it is the same file. A path that does not match is never looked up.
 */
export function evaluateFileRead(payload, allowedPath, { platform = process.platform, real = defaultReal } = {}) {
  const tool = payload && typeof payload.tool_name === 'string' ? payload.tool_name : '';
  if (tool !== 'Read') return `file-read guard: only Read of the attached file is allowed here (${tool || 'an unknown tool'} refused).`;
  const fp = payload.tool_input && payload.tool_input.file_path;
  const candidate = lexicalPath(fp, { platform });
  const allowed = lexicalPath(allowedPath, { platform });
  if (!candidate || !allowed) return ONLY;
  let allowedReal;
  try { allowedReal = lexicalPath(real(allowedPath), { platform }); } catch { return ONLY; }
  if (!allowedReal || (candidate !== allowed && candidate !== allowedReal)) return ONLY;
  let candidateReal;
  try { candidateReal = lexicalPath(real(nativeOf(fp, platform)), { platform }); } catch { return ONLY; }
  return candidateReal && candidateReal === allowedReal ? null : ONLY;
}

const str = (v) => (typeof v === 'string' ? v : null);

/** One log line of the CLI: the tool, the Read path, the decision and the tool call's id when the payload has one. */
export function decisionEntry(payload, reason) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const id = str(p.tool_use_id);
  return { tool: str(p.tool_name), path: str(p.tool_input && p.tool_input.file_path), decision: reason ? 'deny' : 'allow', ...(id ? { id } : {}) };
}

const parseDecision = (l) => {
  if (l && typeof l === 'object') return l;
  try { const d = JSON.parse(String(l)); return d && typeof d === 'object' ? d : null; } catch { return null; }
};

/** The decisions a guard logged, oldest first; [] when there is no log. A line that is not one is left out. */
export function readGuardDecisions(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  return text.split('\n').filter((l) => l.trim()).map(parseDecision).filter(Boolean);
}

/** Every tool call of a stream: raw stream-json frames, the runner's `{ type, raw }` envelopes, or normalized `tool`
 *  events (engines/claude-events.mjs), as `{ name, input, id }`. */
export function toolCalls(events) {
  const out = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'tool' && Array.isArray(e.calls)) {
      for (const c of e.calls) out.push({ name: c && c.name, input: c && c.input, id: c && c.toolUseId });
      continue;
    }
    const raw = e.raw && typeof e.raw === 'object' ? e.raw : e;
    if (raw.type !== 'assistant' || !raw.message || !Array.isArray(raw.message.content)) continue;
    for (const c of raw.message.content) if (c && c.type === 'tool_use') out.push({ name: c.name, input: c.input, id: c.id });
  }
  return out;
}

/**
 * True only when every tool call of a read's stream has its own guard decision in the log (by tool call id when both
 * carry one, else by tool and Read path; one decision covers one call). A read whose calls are not all covered ran
 * with a guard that did not decide them, so its result is not to be trusted (Task 4 discards it).
 */
export function guardDecisionsCover(events, logLines) {
  const decisions = (Array.isArray(logLines) ? logLines : []).map(parseDecision).filter(Boolean);
  const used = new Set();
  for (const call of toolCalls(events)) {
    const path_ = call.input && typeof call.input.file_path === 'string' ? call.input.file_path : null;
    const i = decisions.findIndex((d, k) => !used.has(k) && typeof call.name === 'string' && d.tool === call.name
      && (d.id && call.id ? d.id === call.id : (d.path ?? null) === path_));
    if (i < 0) return false;
    used.add(i);
  }
  return true;
}
