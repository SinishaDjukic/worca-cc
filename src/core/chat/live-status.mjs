// src/core/chat/live-status.mjs — the words of a freeform chat turn's live status message (discord-chat 0.5.0). Pure:
// an Ask turn frame becomes one plain activity line and the elapsed time is shown in coarse steps. Tool arguments,
// paths and text never reach the platform: only the tool's family is named (a run id's first 8 characters at most).

/** The first post, before any progress. */
export const WORKING = '⏳ Working on it… this message will update.';
/** A status message whose turn a restart ended. */
export const INTERRUPTED = '⏹️ Interrupted — send your message again.';
/** A finished reply with nothing to show (no text, no card). */
export const DONE_EMPTY = '✅ Done.';
/** One progress edit at most this often, and only when the text changed (Discord allows ~5 edits per 5 s). */
export const STATUS_TICK_MS = 5000;

const READ = new Set(['read', 'read_file', 'ls', 'view', 'notebookread']);
const SEARCH = new Set(['grep', 'glob', 'search', 'find']);
const COMMAND = new Set(['bash', 'shell', 'run_command', 'exec_command', 'local_shell']);
const EDIT = new Set(['edit', 'write', 'multiedit', 'notebookedit', 'apply_patch']);
const WEB = new Set(['webfetch', 'websearch', 'web_fetch', 'web_search']);
const RUN = new Set(['get_run', 'get_run_diff', 'get_run_progress', 'track_run', 'list_run_artifacts', 'read_run_artifact',
  'get_run_checkout', 'pause_run', 'resume_run', 'propose_stop_run', 'set_run_away_mode']);
const RUN_ID_RE = /^[0-9a-f][0-9a-f-]{7,63}$/i;

function toolActivity(name, input) {
  const raw = typeof name === 'string' ? name : '';
  let n = raw;
  if (raw.startsWith('mcp__')) {
    const [, server, ...rest] = raw.split('__');
    if (server !== 'worca') return 'Using a connected tool…';
    n = rest.join('__');
  }
  const k = n.toLowerCase();
  if (READ.has(k)) return 'Reading files…';
  if (SEARCH.has(k)) return 'Searching files…';
  if (COMMAND.has(k)) return 'Running a command…';
  if (EDIT.has(k)) return 'Editing files…';
  if (WEB.has(k)) return 'Searching the web…';
  if (RUN.has(k)) {
    const id = input && typeof input.id === 'string' ? input.id : '';
    return RUN_ID_RE.test(id) ? `Looking at run ${id.slice(0, 8)}…` : 'Looking at a run…';
  }
  if (k === 'list_runs') return 'Looking at runs…';
  if (k.startsWith('propose_')) return 'Preparing a proposal…';
  if (raw.startsWith('mcp__worca__')) return 'Checking worca…';
  return 'Working…';
}

/** An Ask turn frame (ask-block, ask-delta) → the activity it shows, or null when it changes nothing. */
export function activityOf(frame) {
  if (!frame || typeof frame !== 'object') return null;
  if (frame.type === 'ask-delta') return 'Writing the answer…';
  if (frame.type !== 'ask-block') return null;
  const b = frame.block;
  if (!b || typeof b !== 'object') return null;
  if (b.kind === 'agent') return 'Working with a helper agent…';
  if (b.kind !== 'tool' || b.status !== 'running') return null;
  return toolActivity(b.name, b.input && typeof b.input === 'object' ? b.input : null);
}

/** Elapsed time in 5 s steps ("25 s", "2 min 5 s"). */
export function elapsedLabel(ms) {
  const s = Math.max(0, Math.floor(Number(ms) / 5000) * 5) || 0;
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

export function statusText({ elapsedMs, activity }) {
  return `⏳ Working on it… · ${elapsedLabel(elapsedMs)}${activity ? `\n${activity}` : ''}`;
}

/** The platform message for a status line. */
export function statusMessage(text) {
  return { title: null, severity: 'info', body: [{ kind: 'markdown', value: text }] };
}
