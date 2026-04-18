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

const HELP_TEXT = `/start — show your chat ID for allowlist setup
/help — this list
/whoami — your chat ID, active project, mute state
/projects — list registered projects
/use <project> — set active project for this chat
/active — show running pipelines across all projects
/mute [duration] — silence notifications (e.g. /mute 1h, /mute 30m)
/unmute — restore notifications
/status [run_id] — run status (requires active project)
/runs [N] — recent runs (requires active project)
/last — most recent run (requires active project)
/cost [today|week|run_id] — cost summary (requires active project)
/pr [run_id] — PR URL (requires active project)
/pause [run_id] — pause active run (requires active project)
/resume [run_id] — resume paused run (requires active project)
/stop [run_id] — stop run (requires active project)`;

/**
 * Creates handlers for global (non-project-scoped) commands.
 *
 * @param {{ chatContext, prefsDir: string, restClient }} deps
 * @returns {Record<string, (chatKey: string, args: string[]) => Promise<string>>}
 */
export function createGlobalHandlers({ chatContext, prefsDir, restClient }) {
  async function start(chatKey) {
    return `Your chat ID is: ${chatKey}\nAdd it to the allowlist in your integrations config to enable commands.`;
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
    return `Chat ID: ${chatKey}\nActive project: ${active}\nMuted: ${muted}`;
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
          lines.push(
            `\u2022 [${project.name}] ${run.id ?? run.run_id} \u2014 ${ps}`,
          );
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

  return { start, help, whoami, projects, use, active, mute, unmute };
}
