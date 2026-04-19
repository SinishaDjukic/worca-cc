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

const STATUS_EMOJI = {
  running: '\u{1F7E2}',
  resuming: '\u{1F7E2}',
  failed: '\u{1F534}',
  stopped: '\u{1F534}',
  paused: '\u{1F7E1}',
  completed: '\u2705',
};

/**
 * Map a pipeline_status string to its emoji.
 */
export function statusEmoji(ps) {
  return STATUS_EMOJI[ps] || '\u26AA';
}

function chatIdOnly(chatKey) {
  // chatKey is "platform:id" — return just the id
  const idx = chatKey.indexOf(':');
  return idx >= 0 ? chatKey.slice(idx + 1) : chatKey;
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

const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'interrupted',
  'stopped',
  'cancelled',
]);

function fmtMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
}

/**
 * Compute run duration from stage iteration timestamps. Uses run-level
 * completed_at when available, otherwise derives from the latest iteration.
 * For running pipelines, shows live elapsed.
 */
function fmtElapsedFromRun(run) {
  if (!run?.started_at) return null;
  const startedAt = run.started_at;
  const completedAt = run.completed_at;

  if (completedAt) {
    const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    return ms >= 0 ? fmtMs(ms) : null;
  }

  const ps = run.pipeline_status || (run.active ? 'running' : 'unknown');
  if (TERMINAL_STATUSES.has(ps)) {
    let lastEnd = null;
    for (const stage of Object.values(run.stages || {})) {
      for (const iter of stage.iterations || []) {
        if (iter.completed_at) {
          const t = new Date(iter.completed_at).getTime();
          if (!lastEnd || t > lastEnd) lastEnd = t;
        }
      }
    }
    if (lastEnd) {
      const ms = lastEnd - new Date(startedAt).getTime();
      return ms >= 0 ? fmtMs(ms) : null;
    }
    return null;
  }

  const ms = Date.now() - new Date(startedAt).getTime();
  return ms >= 0 ? fmtMs(ms) : null;
}

const HELP_TEXT = `/start \u2014 show your chat ID
/help \u2014 this list
/whoami \u2014 chat ID, active project, mute state
/projects \u2014 list registered projects
/use <project> \u2014 set active project
/active \u2014 running pipelines across all projects
/mute [duration] \u2014 silence notifications (e.g. /mute 1h)
/unmute \u2014 restore notifications
/status [run_id] \u2014 run status
/runs [N] \u2014 recent runs
/last \u2014 most recent run
/cost [run_id] \u2014 cost summary
/pr [run_id] \u2014 PR URL
/error [run_id] \u2014 show failure details
/pause [run_id] \u2014 pause active run
/resume [run_id] \u2014 resume paused run
/stop [run_id] \u2014 stop run

Commands with [run_id] auto-resolve to the active run if omitted.
Use *suffix to match by ending, e.g. /status *2db5
Project commands require /use first.`;

/**
 * Creates handlers for global (non-project-scoped) commands.
 *
 * @param {{ chatContext, prefsDir: string, restClient }} deps
 * @returns {Record<string, (chatKey: string, args: string[]) => Promise<string>>}
 */
export function createGlobalHandlers({ chatContext, prefsDir, restClient }) {
  async function start(chatKey) {
    return `**Chat ID:** \`${chatIdOnly(chatKey)}\``;
  }

  async function help() {
    return HELP_TEXT;
  }

  async function whoami(chatKey) {
    const state = chatContext.get(chatKey);
    const active = state.active_project ?? '(none)';
    const muted = chatContext.isMuted(chatKey) ? 'yes' : 'no';
    return `**Chat ID:** \`${chatIdOnly(chatKey)}\`\n**Active project:** ${active}\n**Muted:** ${muted}`;
  }

  async function projects() {
    const list = readProjects(prefsDir);
    if (list.length === 0) return 'No projects registered.';
    return `Registered projects:\n${list.map((p) => `\u2022 ${p.name} \u2014 ${p.path}`).join('\n')}`;
  }

  async function use(chatKey, args) {
    const name = args[0];
    if (!name) return 'Usage: /use <project>';
    const list = readProjects(prefsDir);
    const found = list.find((p) => p.name === name);
    if (!found) {
      const known = list.map((p) => p.name).join(', ') || '(none)';
      return `Project "${name}" not found.\nKnown projects: ${known}`;
    }
    chatContext.set(chatKey, { active_project: name });
    return `**Active project** set to: ${name}`;
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
          const id = run.id ?? run.run_id;
          const title = run.work_request?.title;
          const stage = run.stage;
          const elapsed = fmtElapsedFromRun(run);
          const parts = [`${statusEmoji(ps)} **Run:** \`${id}\``];
          parts.push(`   **Project:** ${project.name}`);
          if (title) parts.push(`   **Title:** ${title}`);
          if (stage && elapsed) {
            parts.push(`   **Stage:** ${stage} | **Duration:** ${elapsed}`);
          } else if (stage) {
            parts.push(`   **Stage:** ${stage}`);
          } else if (elapsed) {
            parts.push(`   **Duration:** ${elapsed}`);
          }
          lines.push(parts.join('\n'));
        }
      }
    }
    if (lines.length === 0) return 'No active pipelines across any project.';
    return `Active pipelines:\n\n${lines.join('\n')}`;
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
      : 'Notifications muted indefinitely.\nUse /unmute to restore.';
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
    _fmtCostFromStages: fmtCostFromStages,
    _fmtElapsedFromRun: fmtElapsedFromRun,
  };
}
