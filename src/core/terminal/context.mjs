// src/core/terminal/context.mjs — what folder a run's terminal opens in, and the env every terminal
// starts with (issue #573). A running run: its live worktree (with a warning: the pipeline is still
// changing it). A finished run: its Actions checkout, or "needs-checkout". A workspace run: one per member.
import { existsSync } from 'node:fs';
import { membersOfRow, checkoutPathFor } from '../checkout.mjs';
import { checkoutRecordsFor } from '../artifacts.mjs';
import { pickBackendSecrets } from '../host-credentials.mjs';
import { childEnv } from '../spawn.mjs';
import { RUN_ROOT_REMOVE as FINISHED } from '../worktree.mjs';   // done | stopped | error
import { workModeOfRow } from '../project-kind.mjs';
import { isNoProjectKey, noProjectWorkDir } from '../store.mjs';

export const LIVE_WARNING = 'This pipeline is still running and changing these files. Changes you make here are committed with the run when it ends.';

export function terminalTargets(row, { isLive = () => false, exists = existsSync } = {}) {
  const live = !!isLive(row.id);
  const finished = FINISHED.has(row.status) && !live;
  const recs = finished ? (checkoutRecordsFor(row)?.members || []) : [];
  const folder = workModeOfRow(row) === 'folder';
  const none = isNoProjectKey(row.project_key);
  const members = membersOfRow(row).map((m) => {
    const base = { projectKey: m.projectKey, projectName: m.projectName || m.projectKey, branch: m.br?.feature || null };
    if (folder || m.br?.workMode === 'folder') {             // P5: a mixed workspace's Folder member maps the same way
      // S9 / P1b S9: a Folder run's terminal opens in its copy while the copy exists and its changes wait (or the run is
      // live), else in the real folder. Never needs-checkout; no LIVE_WARNING (it says the work is committed with the run).
      const copy = m.br?.copyDir || null;
      const useCopy = !!copy && exists(copy) && (m.br?.changes?.state === 'pending' || live);
      return { ...base, state: 'worktree', cwd: useCopy ? copy : (m.br?.realDir || m.projectDir) };
    }
    if (none) {
      // P3: a run without a project has no checkout, ever. Its terminal opens in its live work/ while the run root holds
      // it (running or paused; no LIVE_WARNING — nothing is committed); once its files moved to Artifacts, no folder.
      let work = null;
      try { work = noProjectWorkDir(row.id); } catch { work = null; }
      return !finished && work && exists(work) ? { ...base, state: 'worktree', cwd: work }
        : { ...base, state: 'unavailable', cwd: null, reason: 'This run has no folder.' };
    }
    if (finished) {
      const rec = recs.find((r) => r.projectKey === m.projectKey);
      return rec ? { ...base, state: 'checkout', cwd: rec.worktreeDir, ...(rec.external ? { external: true } : {}) }
        : { ...base, state: 'needs-checkout', cwd: null };
    }
    let dir = null;
    try { dir = checkoutPathFor(row, m); } catch { dir = null; }        // a legacy row with no project dir
    if (!dir || !exists(dir)) return { ...base, state: 'unavailable', cwd: null, reason: 'This run has no folder yet.' };
    return { ...base, state: 'worktree', cwd: dir, ...(live ? { warning: LIVE_WARNING } : {}) };
  });
  return { runId: row.id, status: row.status, live, finished, workspace: row.target === 'workspace', members };
}

/** What a terminal never inherits from the server: its home, run root and host pid (the run's own facts are set below). */
const TERMINAL_STRIPPED = ['WORCA_HOME', 'WORCA_RUN_ROOT', 'WORCA_HOST_PID'];

/** An env-name part: upper-case, anything but A-Z/0-9 becomes `_`. */
const envPart = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * The env a terminal starts with: the server's env without credentials (actionBaseEnv) and without
 * PORT (worca's own port), the shell's launch vars, and the run's facts. Each RUNNING action adds
 * WORCA_PORT_[<MEMBER>_]<ACTION>_<NAME> and WORCA_URL_[<MEMBER>_]<ACTION> (member only on a workspace
 * run). Read once, at session start.
 */
export function terminalEnv({ base = process.env, sessionId, mode, runId = null, member = null, projectKey = null, branch = null,
  cwd, workspace = false, actionSnaps = [], shellEnv = {}, agent = false }) {
  // The person's own pane keeps the backend keys (they type `worca run --exec-env e2b`, `worca e2b sweep` here);
  // the Ask agent terminal does not (host-credentials.mjs strips them from every other child).
  // The child-process owner builds it (childEnv kind 'terminal': the server's env, as before, minus every credential and
  // the broker's secret). PORT is worca's own port (`worca ui`, the Docker image): an app started here must not bind it.
  // P3-D20: a no-project run's terminal opens in its work/, so its git never walks up into a repository that holds
  // worcaHome (root: the ceiling is dirname(cwd)).
  const { env } = childEnv({ kind: 'terminal', base, strip: [...TERMINAL_STRIPPED, 'PORT'],
    keep: agent ? [] : Object.keys(pickBackendSecrets(base)), cwd,
    root: isNoProjectKey(projectKey) && cwd ? cwd : null,
    overlay: { ...shellEnv, TERM: mode === 'pty' ? 'xterm-256color' : 'dumb', COLORTERM: 'truecolor',
      WORCA_TERMINAL: '1', WORCA_TERMINAL_SESSION: sessionId, WORCA_WORKTREE: cwd } });
  if (mode !== 'pty' || agent) { env.PAGER = 'cat'; env.GIT_PAGER = 'cat'; }   // no tty, or a program reading it: a pager would wait forever
  if (agent) { env.GIT_TERMINAL_PROMPT = '0'; env.WORCA_TERMINAL_NORC = '1'; }  // Ask (#574): no password prompt, none of the person's rc
  if (runId) env.WORCA_RUN_ID = runId;
  if (branch) env.WORCA_BRANCH = branch;
  if (projectKey) env.WORCA_PROJECT_KEY = projectKey;
  if (member) env.WORCA_MEMBER = member;
  for (const s of actionSnaps) {
    const who = workspace && s.member ? envPart(s.member) : null;
    for (const [name, port] of Object.entries(s.ports || {})) {
      env[['WORCA_PORT', who, envPart(s.actionId), envPart(name)].filter(Boolean).join('_')] = String(port);
    }
    if (s.url) env[['WORCA_URL', who, envPart(s.actionId)].filter(Boolean).join('_')] = s.url;
  }
  return env;
}
