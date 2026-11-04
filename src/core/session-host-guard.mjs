// src/core/session-host-guard.mjs — the host-only PreToolUse hook (session groups, Task 41; C40). In `union` mode a session's
// main agent holds every member's tool grants (Task 31); this hook refuses any tool the MAIN thread calls except Agent/Task,
// so a host Bash or Write is stopped before it runs. A sub-agent's call — its payload carries the context field S3 proves —
// is never touched. session-host.mjs attaches it only when S3 showed that field (HOST_MAIN_THREAD_GUARD, Task 53) and
// passes the field (HOST_GUARD_CONTEXT_FIELD); with no proven field the hook allows everything (never guess).
// The CLI half is fail-open on a malformed payload, like host-guard.mjs.
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SESSION_GUARD_REASON = 'the main agent only dispatches';
const DISPATCH_TOOLS = new Set(['Agent', 'Task']);

/** 'deny' = the payload carries none of `field`'s names (the main thread) and names a tool other than Agent/Task; else
 *  'allow'. `field` may list several names comma-joined, as S3 records them (`hookContextField`): any one present marks a
 *  sub-agent's call. */
export function guardDecision(payload, { field = null } = {}) {
  const names = String(field ?? '').split(',').map((f) => f.trim()).filter(Boolean);
  if (!names.length || !payload || typeof payload !== 'object' || Array.isArray(payload)) return 'allow';
  if (typeof payload.tool_name !== 'string') return 'allow';                         // fail-open: a payload we cannot read
  if (names.some((f) => payload[f] != null && payload[f] !== '')) return 'allow';   // a sub-agent's call
  return DISPATCH_TOOLS.has(payload.tool_name) ? 'allow' : 'deny';
}

// Forward slashes and JSON quotes, as host-guard.mjs hostGuardHookEntry: paths with spaces survive the hook shell.
const q = (s) => JSON.stringify(String(s).replaceAll('\\', '/'));

/** The `mainThreadGuard` spawn option (claude.mjs buildSettingsPayload merges its PreToolUse entries, Task 29). The field
 *  rides the command as an argument (portable to every hook shell, as file-read-guard.mjs passes its path). */
export function sessionHostGuardSettings({ field = null } = {}) {
  const args = [process.execPath, fileURLToPath(import.meta.url), ...(field ? [field] : [])];
  return { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: args.map(q).join(' ') }] }] } };
}

// ── hook CLI ─────────────────────────────────────────────────────────────────
// stdin: the PreToolUse payload. A deny prints the hook protocol's decision on stdout; exit 0 either way.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', () => {
    let payload;
    try { payload = JSON.parse(raw); } catch { process.exit(0); }          // fail-open: a malformed payload must not brick the host
    const field = process.argv[2] || process.env.WORCA_SESSION_GUARD_FIELD || null;
    if (guardDecision(payload, { field }) === 'deny') {
      process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
        permissionDecisionReason: SESSION_GUARD_REASON } })}\n`);
    }
    process.exit(0);
  });
}
