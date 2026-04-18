import { readProjects } from '../../project-registry.js';

const UNITS_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * Parse a duration string like "30m", "1h", "2d" into milliseconds.
 * Returns null if unrecognized.
 */
export function parseDuration(str) {
  if (!str) return null;
  const match = /^(\d+)([smhd])$/i.exec(str);
  if (!match) return null;
  return Number(match[1]) * UNITS_MS[match[2].toLowerCase()];
}

function chatIdOnly(chatKey) {
  // chatKey is "platform:id" — return just the id
  const idx = chatKey.indexOf(':');
  return idx >= 0 ? chatKey.slice(idx + 1) : chatKey;
}

function fmtRunLine(run, projectName) {
  const id = run.id ?? run.run_id;
  const ps = run.pipeline_status || (run.active ? 'running' : 'unknown');
  const title = run.work_request?.title;
  const label = title
    ? title.length > 40
      ? `${title.slice(0, 40)}\u2026`
      : title
    : '';
  const prefix = projectName ? `[${projectName}] ` : '';
  return label
    ? `\u2022 ${prefix}${id} "${label}" \u2014 ${ps}`
    : `\u2022 ${prefix}${id} \u2014 ${ps}`;
}

function fmtCostFromStages(stages) {
  let totalCost = 0;
  for (const stage of Object.values(stages || {})) {
    for (const iter of stage.iterations || []) {
      totalCost += iter.cost_usd || 0;
    }
  }
  return totalCost > 0 ? `$${totalCost.toFixed(2)}` : null;
}

function fmtElapsed(startedAt) {
  if (!startedAt) return null;
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
}

const HELP_TEXT = `/start \u2014 show your chat ID
/help \u2014 this list
/whoami \u2014 chat ID, active project, mute state
/projects \u2014 list registered projects
/use <project> \u2014 set active project
/active \u2014 running pipelines across all projects
/mute [duration] \u2014 silence notifications (e.g. /mute 1h)
/unmute \u2014 restore notifications
/status [run_id] \u2014 run status (requires active project)
/runs [N] \u2014 recent runs (requires active project)
/last \u2014 most recent run (requires active project)
/cost [run_id] \u2014 cost summary (requires active project)
/pr [run_id] \u2014 PR URL (requires active project)
/pause [run_id] \u2014 pause active run
/resume [run_id] \u2014 resume paused run
/stop [run_id] \u2014 stop run`;

/**
 * Creates handlers for global (non-project-scoped) commands.
 *
 * @param {{ chatContext, prefsDir: string, restClient }} deps
 * @returns {Record<string, (chatKey: string, args: string[]) => Promise<string>>}
 */
export function createGlobalHandlers({ chatContext, prefsDir, restClient }) {
  async function start(chatKey) {
    return `Your chat ID is: ${chatIdOnly(chatKey)}`;
  }

  async function help() {
    return HELP_TEXT;
  }

  async function whoami(chatKey) {
    const state = chatContext.get(chatKey);
    const active = state.active_project ?? '(none)';
    const muted = chatContext.isMuted(chatKey)
      ? `yes (until ${state.mute_until})`
      : 'no';
    return `Chat ID: ${chatIdOnly(chatKey)}\nActive project: ${active}\nMuted: ${muted}`;
  }

  async function projects() {
    const list = readProjects(prefsDir);
    if (list.length === 0) return 'No projects registered.';
    return list.map((p) => `\u2022 ${p.name} \u2014 ${p.path}`).join('\n');
  }

  async function use(chatKey, args) {
    const name = args[0];
    if (!name) return 'Usage: /use <project>';
    const list = readProjects(prefsDir);
    const found = list.find((p) => p.name === name);
    if (!found) {
      const known = list.map((p) => p.name).join(', ') || '(none)';
      return `Unknown project "${name}". Known: ${known}`;
    }
    chatContext.set(chatKey, { active_project: name });
    return `Active project set to: ${name}`;
  }

  async function active(chatKey) {
    const list = readProjects(prefsDir);
    if (list.length === 0) return 'No projects registered.';

    // Auto-select when exactly one project is registered and none is active
    if (list.length === 1 && !chatContext.get(chatKey).active_project) {
      chatContext.set(chatKey, { active_project: list[0].name });
    }

    const lines = [];
    for (const project of list) {
      const resp = await restClient.get(
        `/api/projects/${encodeURIComponent(project.name)}/runs`,
      );
      const runs =
        resp.data?.runs ?? (Array.isArray(resp.data) ? resp.data : []);
      for (const run of runs) {
        const ps = run.pipeline_status || (run.active ? 'running' : null);
        if (ps === 'running' || ps === 'paused' || ps === 'resuming') {
          lines.push(fmtRunLine(run, project.name));
        }
      }
    }
    return lines.length > 0 ? lines.join('\n') : 'No active runs.';
  }

  async function mute(chatKey, args) {
    const durStr = args[0];
    let mute_until;
    if (durStr) {
      const ms = parseDuration(durStr);
      if (!ms)
        return `Unrecognized duration "${durStr}". Use e.g. 30m, 1h, 2d.`;
      mute_until = new Date(Date.now() + ms).toISOString();
    } else {
      mute_until = new Date(Date.now() + 365 * 86_400_000).toISOString();
    }
    chatContext.set(chatKey, { mute_until });
    return durStr
      ? `Notifications muted for ${durStr}.`
      : 'Notifications muted indefinitely.';
  }

  async function unmute(chatKey) {
    chatContext.set(chatKey, { mute_until: null });
    return 'Notifications restored.';
  }

  return {
    start,
    help,
    whoami,
    projects,
    use,
    active,
    mute,
    unmute,
    // Exported for reuse by project commands
    _fmtRunLine: fmtRunLine,
    _fmtCostFromStages: fmtCostFromStages,
    _fmtElapsed: fmtElapsed,
  };
}
