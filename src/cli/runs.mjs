// src/cli/runs.mjs
// `worca runs` — list and inspect pipeline runs from the terminal (issue #481).
//
// The CLI could START, RESUME and SCHEDULE runs but not SEE them: the run list
// lived only in the web UI (ui/server.mjs /api/runs + /api/history) and the
// store. This module reads the same store directly — listAllPipelines() for the
// list (the exact reader /api/history uses, in `lite` form: no git/gh spawns),
// a prefix lookup on the pipelines table for the detail view — so listing works
// with NO Worca server up. Only the `worca ui` deep link at the bottom of the
// detail view needs a server (and it is just a URL, not a request).

import { basename } from 'node:path';

import { getDb } from '../core/db.mjs';
import { listAllPipelines, readPipelineByKey, readStoreMeta } from '../core/artifacts.mjs';
import { readUiInstance } from '../core/ui-instance.mjs';
import { fmtDur, executionCount, loopDeliveries } from './render.mjs';
import { formatInstant } from '../shared/schedule/recurrence.mjs';

export const RUNS_HELP = `worca runs — list and inspect pipeline runs

Usage:
  worca runs                      All runs across projects, newest first
  worca runs --status <s>         Filter by status: created | running | paused |
                                  stopped | interrupted | done
  worca runs --project <name>     Filter by project name or key
  worca runs <id>                 One run in detail (any unique prefix)
  worca runs show <id>            One run in detail (same as "worca runs <id>")
  worca runs --json               Machine-readable output (list and detail)

Reads come straight from the Worca store — no Worca server needs to be up.
A paused run shows its pause reason next to the status; the detail view adds
the full message.
`;

/** The statuses a pipelines row carries today (writeState / reconcileStaleRunning). */
const STATUSES = ['created', 'running', 'paused', 'stopped', 'interrupted', 'done'];

const STATUS_COLOR = { running: 'cyan', paused: 'yellow', interrupted: 'yellow', done: 'green', stopped: 'red' };

const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;

/** "just now" / "5m ago" / "2h ago" / "3d ago" — the list's time column. */
function ago(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const oneLine = (s, max = 60) => {
  const line = String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
};

/** `--status paused` and `--status=paused` both land here; null when unset. */
function valueFlag(rest, name) {
  const i = rest.indexOf(`--${name}`);
  const inline = rest.find((a) => a.startsWith(`--${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 3);
  if (i !== -1) {
    const v = rest[i + 1];
    if (v === undefined || v.startsWith('-')) return null; // a flag, not a value
    return v;
  }
  return null;
}

/**
 * `<id or prefix>` -> the one pipelines row, straight from the DB (the
 * resolveAfterId idiom: LIKE with escaped metacharacters, capped at 21 so the
 * ambiguity count stays exact). `unknownVerb` only changes the not-found
 * message: a bare `worca runs lst` must not read as "your runs are gone".
 */
function resolveRunRef(ref, fail, { unknownVerb = false } = {}) {
  const q = String(ref || '').trim();
  if (!q) fail('an id is required (see: worca runs list)');
  const hits = getDb().prepare(
    "SELECT id FROM pipelines WHERE id LIKE ? ESCAPE '\\' ORDER BY COALESCE(updated_at, started_at) DESC LIMIT 21",
  ).all(`${q.replace(/[\\%_]/g, '\\$&')}%`);
  if (!hits.length) {
    fail(unknownVerb
      ? `no run matches "${q}", and "${q}" is not a known verb either (see: worca runs help)`
      : `no run matches "${q}" (see: worca runs list)`);
  }
  if (hits.length > 1) fail(`"${q}" matches ${hits.length > 20 ? 'more than 20' : hits.length} runs — use a longer id`);
  return hits[0].id;
}

/** The store key a row lives under (workspaces route to their own subtree). */
const storeKeyOf = (row) => (row.target === 'workspace' && row.workspace_key ? row.workspace_key : row.project_key);

/** The list/detail "project" label: the registered name, else the raw store key. */
function projectLabel(row) {
  const m = readStoreMeta(storeKeyOf(row));
  const name = m && (m.name || m.workspaceName);
  return name ? String(name) : storeKeyOf(row);
}

/** `worca ui`'s URL for one run's detail screen (app.js routes `#history/<key>/<id>`). */
function uiUrl(row) {
  const inst = readUiInstance();
  if (!inst) return null;
  const host = !inst.host || inst.host === '0.0.0.0' ? 'localhost' : inst.host;
  return `http://${host}:${inst.port}/#history/${encodeURIComponent(storeKeyOf(row))}/${row.id}`;
}

// ── list ────────────────────────────────────────────────────────────────────────

async function runsList(rest, { out, c, fail }) {
  // `--status`/`--project` given but valueless fail here, not silently as "unset".
  for (const name of ['status', 'project']) {
    if (rest.includes(`--${name}`) && valueFlag(rest, name) === null && !rest.some((a) => a.startsWith(`--${name}=`))) {
      fail(`--${name} needs a value (see: worca runs help)`);
    }
  }
  const status = valueFlag(rest, 'status');
  const project = valueFlag(rest, 'project');
  const json = rest.includes('--json');
  const unknown = rest.filter((a) => a.startsWith('-')
    && !['--json', '--status', '--project'].includes(a)
    && !a.startsWith('--status=') && !a.startsWith('--project='));
  if (unknown.length) fail(`unknown option(s): ${unknown.join(' ')} — see: worca runs help`);
  if (status !== null && !STATUSES.includes(String(status).toLowerCase())) {
    fail(`--status must be one of ${STATUSES.join(', ')}, got: ${status}`);
  }

  const entries = (await listAllPipelines({ lite: true })) || [];
  const q = String(project || '').toLowerCase();
  const runs = entries.filter((e) => {
    if (status !== null && String(e.status || '').toLowerCase() !== String(status).toLowerCase()) return false;
    if (q && !`${e.projectName}`.toLowerCase().includes(q) && !`${e.projectKey}`.toLowerCase().includes(q)) return false;
    return true;
  });

  if (json) { out(JSON.stringify(runs, null, 2)); return 0; }
  if (!runs.length) {
    out(entries.length
      ? 'No runs match the given filters (see: worca runs help).'
      : 'No pipeline runs yet. Start one with: worca --prompt "<task>"');
    return 0;
  }
  const rows = [];
  for (const r of runs) {
    const st = r.pauseReason
      ? `${r.status} (${String(r.pauseReason).replace(/_/g, ' ')})`
      : String(r.status || 'unknown');
    rows.push({ id: r.id, status: st, color: STATUS_COLOR[r.status] || '', started: ago(r.startedAt), project: oneLine(r.projectName || r.projectKey || '—', 24), title: oneLine(r.title) });
  }
  // Padded columns, widths from the data (capped where a value can be long).
  // Widths are computed on PLAIN text; the status cell is colored after padding,
  // so ANSI codes never break the alignment.
  const HEADER = ['ID', 'STATUS', 'STARTED', 'PROJECT', 'TITLE'];
  const cell = (r) => [r.id, r.status, r.started, r.project, r.title];
  const width = (i) => Math.max(HEADER[i].length, ...rows.map((r) => cell(r)[i].length));
  const [wId, wStatus, wStarted, wProject] = [width(0), width(1), width(2), width(3)];
  out(c('bold', `  ${'ID'.padEnd(wId)}  ${'STATUS'.padEnd(wStatus)}  ${'STARTED'.padEnd(wStarted)}  ${'PROJECT'.padEnd(wProject)}  TITLE`));
  for (const r of rows) {
    const [id, status, started, project, title] = cell(r);
    out(`  ${id.padEnd(wId)}  ${c(r.color, status.padEnd(wStatus))}  ${started.padEnd(wStarted)}  ${project.padEnd(wProject)}  ${title}`);
  }
  return 0;
}

// ── detail ──────────────────────────────────────────────────────────────────────

async function runsShow(argv, { out, c, fail, unknownVerb = false }) {
  const json = argv.includes('--json');
  const unknown = argv.filter((a) => a.startsWith('-') && a !== '--json');
  if (unknown.length) fail(`unknown option(s): ${unknown.join(' ')} — see: worca runs help`);
  const ref = argv.find((a) => !a.startsWith('-'));
  const id = resolveRunRef(ref, fail, { unknownVerb });

  // One row by id — the same columns listAllPipelines SELECTs, plus phase/cycle
  // for the detail view. pauseReason/pauseDetail live in the resume_point JSON.
  const row = getDb().prepare(`
    SELECT id, project_key, workspace_key, target, title, status, phase, cycle,
           started_at, updated_at, total_cost_usd, total_active_ms, started_by, prompt, branch,
           json_extract(CASE WHEN json_valid(resume_point) THEN resume_point END, '$.pauseReason') AS pause_reason,
           json_extract(CASE WHEN json_valid(resume_point) THEN resume_point END, '$.pauseDetail') AS pause_detail
    FROM pipelines WHERE id = ?
  `).get(id);
  if (!row) fail(`no run matches "${ref}" (see: worca runs list)`);

  // The same full read the web UI's detail screen does (run-report readPipelineByKey),
  // for the two fields it shows that the DB row alone cannot answer: the persisted
  // diff summary (+A −R, results.json) and the End result. Nulls mean "not there".
  const full = await readPipelineByKey(storeKeyOf(row), id).catch(() => null);
  const sums = full && full.results && full.results.summary ? full.results.summary : null;
  const added = sums ? sums.linesAdded : null;
  const removed = sums ? sums.linesRemoved : null;
  const st = (full && full.state) || {};
  const resultPath = st.endReached === true && st.result && st.result.path ? String(st.result.path) : null;
  const completed = st.endReached === true;
  // The identity convention (identity.mjs, as schedule.mjs' person()): 'local' is
  // the machine, never shown — only a real person's name is worth a line.
  const startedBy = typeof row.started_by === 'string' && row.started_by && row.started_by !== 'local' ? row.started_by : null;
  const executions = executionCount(st);
  const loops = loopDeliveries(st);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const startedClock = Number.isFinite(Date.parse(row.started_at))
    ? formatInstant(Date.parse(row.started_at), tz)
    : null;

  const branch = (() => {
    try { const b = JSON.parse(row.branch); return b && typeof b === 'object' ? b : null; } catch { return null; }
  })();
  const link = uiUrl(row);

  if (json) {
    out(JSON.stringify({
      id: row.id,
      title: row.title ?? row.id,
      project: { key: storeKeyOf(row), name: projectLabel(row) },
      status: row.status,
      phase: row.phase,
      cycle: row.cycle,
      pauseReason: row.pause_reason ?? null,
      pauseDetail: row.pause_detail ?? null,
      startedAt: row.started_at ?? null,
      updatedAt: row.updated_at ?? null,
      costUsd: Number(row.total_cost_usd) || 0,
      activeMs: Number(row.total_active_ms) || 0,
      executions,
      loopDeliveries: loops,
      sourceBranch: (branch && branch.source) || null,
      featureBranch: (branch && branch.feature) || null,
      linesAdded: added,
      linesRemoved: removed,
      resultPath,
      startedBy,
      uiUrl: link,
    }, null, 2));
    return 0;
  }

  out(c('bold', row.title || row.id));
  out(`  id       ${row.id}`);
  out(`  project  ${projectLabel(row)}${row.target === 'workspace' ? `  (${basename(String(row.workspace_key || ''))})` : ''}`);
  const where = row.pause_detail ? ` — ${row.pause_detail}` : '';
  out(`  status   ${row.status}${row.pause_reason ? ` (${String(row.pause_reason).replace(/_/g, ' ')})${where}` : ''}`);
  // The cycle scalar is harness-local (run-harness _phase) — the UI never shows
  // it either; it surfaces loop traffic as "N loop deliveries" instead. JSON keeps it.
  out(`  phase    ${row.phase || '—'}`);
  out(`  started  ${ago(row.started_at)}${startedClock ? ` (${startedClock})` : ''}`);
  const updatedClock = Number.isFinite(Date.parse(row.updated_at))
    ? formatInstant(Date.parse(row.updated_at), tz)
    : null;
  if (row.updated_at) out(`  updated  ${ago(row.updated_at)}${updatedClock ? ` (${updatedClock})` : ''}`);
  // The DURATION sub-line's counts, the web UI's wording (app.js histCountsLine):
  // `9 executions · 2 loop deliveries`.
  const counts = [];
  if (executions != null) counts.push(`${executions} execution${executions === 1 ? '' : 's'}`);
  if (loops != null) counts.push(`${loops} loop deliver${loops === 1 ? 'y' : 'ies'}`);
  out(`  duration ${fmtDur(row.total_active_ms)}${counts.length ? ` · ${counts.join(' · ')}` : ''}`);
  // COST's sub-line, the web UI's wording (app.js: `across ${steps.length} steps`).
  const steps = Array.isArray(st.steps) ? st.steps : [];
  out(`  cost     ${usd(row.total_cost_usd)}${steps.length ? ` · across ${steps.length} step${steps.length === 1 ? '' : 's'}` : ''}`);
  if (branch && (branch.feature || branch.source)) {
    // The web UI's order (hd-base: `dev → worca-cc/…`), for one mental model.
    const b = branch.source && branch.feature
      ? `${branch.source} → ${branch.feature}`
      : (branch.feature || `from ${branch.source}`);
    out(`  branch   ${b}`);
  }
  if (added != null && removed != null) out(`  changes  +${added} -${removed}`);
  if (resultPath) out(`  result   ${resultPath}`);
  else if (completed) out('  result   completed');
  if (startedBy) out(`  by       ${startedBy}`);
  const task = oneLine(row.prompt, 100);
  if (task) out(`  task     ${task}`);
  if (link) out(c('gray', `  open     ${link}`));  // only when a Worca server is recorded — no nag line otherwise
  return 0;
}

// ── dispatch ────────────────────────────────────────────────────────────────────

/**
 * `worca runs` — the bare command lists; a known verb dispatches; anything else
 * is read as a run id (unique prefix). Unknown input never falls through to a
 * full list: it resolves as an id first and the combined error names BOTH
 * readings, so a typo'd verb cannot masquerade as a missing run.
 * @returns {Promise<number>} exit code
 */
export async function cmdRuns(argv, { out, c, fail }) {
  const verb = argv[0];
  const rest = argv.slice(1);
  if (verb === 'help' || verb === '--help' || verb === '-h') { process.stdout.write(RUNS_HELP); return 0; }
  if (verb === 'list') return runsList(rest, { out, c, fail });
  if (verb === 'show') return runsShow(rest, { out, c, fail });
  if (!verb || verb.startsWith('-')) return runsList(argv, { out, c, fail });  // flags belong to the list
  return runsShow(argv, { out, c, fail, unknownVerb: true });                  // a run id (or a typo)
}
