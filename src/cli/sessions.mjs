// src/cli/sessions.mjs
// `worca sessions <run>` — a run's sessions from the terminal (session groups, Task 55; spec §6.4).
//
// Reads each session's trace FILE (`<runDir>/sessions/<sid>/trace.ndjson`) through the same report the API serves
// (session-trace.mjs `sessionsReport`), so it works with no `worca ui` up and for runs owned by any process. `--json`
// prints that report verbatim.

import { getDb } from '../core/db.mjs';
import { runDirForRow } from '../core/artifacts.mjs';
import { sessionsReport } from '../core/session-trace.mjs';
import { resolveRunRef } from './runs.mjs';
import { formatSessionsReport, manifestLabelOf } from './render.mjs';

export const SESSIONS_HELP = `worca sessions — a run's sessions, turn by turn

Usage:
  worca sessions <id>             One block per session: host, turns, cost split, reconcile (any unique id prefix)
  worca sessions <id> --json      The report as JSON (the same as GET /api/runs/<id>/sessions)

Reads come straight from the run's session traces — no Worca server needs to be up.
`;

export async function cmdSessions(rest, { out, c, fail }) {
  const verb = rest[0];
  if (verb === 'help' || verb === '--help' || verb === '-h') { process.stdout.write(SESSIONS_HELP); return 0; }
  const json = rest.includes('--json');
  const unknown = rest.find((a) => a.startsWith('-') && a !== '--json');
  if (unknown) fail(`unknown option ${unknown} (see: worca sessions help)`);
  const refs = rest.filter((a) => !a.startsWith('-'));
  if (refs.length > 1) fail(`one run id, got ${refs.length} (see: worca sessions help)`);
  const id = resolveRunRef(refs[0], fail);
  // The columns runDirForRow routes on, plus the manifest the step labels come from.
  const row = getDb().prepare('SELECT id, target, project_key, workspace_key, stepper FROM pipelines WHERE id = ?').get(id);
  if (!row) fail(`no run matches "${refs[0]}" (see: worca runs list)`);   // resolveRunRef already guarantees the row
  let report;
  try { report = await sessionsReport(await runDirForRow(row)); } catch (err) {
    fail(`the run's sessions could not be read (${err?.code || err?.message || err})`);   // e.g. a sessions folder made unreadable
  }
  if (json) { out(JSON.stringify(report, null, 2)); return 0; }
  if (!report.sessions.length) { out(`Run ${id} has no sessions.`); return 0; }
  let manifest = null;
  try { manifest = row.stepper ? JSON.parse(row.stepper) : null; } catch { manifest = null; }
  out(formatSessionsReport(report, { color: c, labelOf: manifestLabelOf(manifest) }));
  return 0;
}
