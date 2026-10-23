// Claude Code `InstructionsLoaded` hook (memory-usage.mjs memoryUsageHookEntry): appends one line per
// `path_glob_match` load of a Worca memory rule to the execution's file named by argv[2]. Runs asynchronously beside
// the agent and must stay tiny: node:fs only, no output, always exit 0. Keeps the rule's path inside
// `.claude/rules/worca/`, the load reason, the trigger path relative to the session cwd (dropped when outside it) and
// the sub-agent type; never the cwd, the transcript path or the session id (U10).
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MARK = '/.claude/rules/worca/';

function main() {
  const out = process.argv[2];
  if (!out) return;
  let e;
  try { e = JSON.parse(readFileSync(0, 'utf8')); } catch { return; }
  if (e?.load_reason !== 'path_glob_match' || typeof e.file_path !== 'string') return;
  const file = e.file_path.replaceAll('\\', '/');
  const at = file.lastIndexOf(MARK);
  if (at < 0) return;
  let t = null;
  if (typeof e.trigger_file_path === 'string' && typeof e.cwd === 'string' && e.cwd) {
    const cwd = e.cwd.replaceAll('\\', '/').replace(/\/+$/, '');
    const trig = e.trigger_file_path.replaceAll('\\', '/');
    if (trig.startsWith(`${cwd}/`)) t = trig.slice(cwd.length + 1);
  }
  const line = `${JSON.stringify({ f: file.slice(at + MARK.length), r: e.load_reason, t, a: typeof e.agent_type === 'string' ? e.agent_type : null })}\n`;
  try { appendFileSync(out, line); }
  catch (err) { if (err?.code === 'ENOENT') { mkdirSync(dirname(out), { recursive: true }); appendFileSync(out, line); } }
}

try { main(); } catch { /* a usage count is never worth a hook error */ }
