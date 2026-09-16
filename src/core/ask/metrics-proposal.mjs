// src/core/ask/metrics-proposal.mjs
// The ONE validator behind mcp__worca__propose_metrics_change, plus the event/notice text of the
// metrics card. Pure: every reader is injected (metrics-deps.mjs binds the real ones), so the MCP
// child validates for the model's self-correction and the parent turn re-validates authoritatively
// (the same split proposal.mjs makes for propose_run). Nothing here writes — applying a card is
// ui/server.mjs's business, behind the user's click.
//
// Why a card at all (docs/team-metrics.md "Ask Worca"): enabling creates a branch on the team's
// origin, attribution is a team decision made once, routing pushes marker branches to other
// repositories. Outward-facing and hard to reverse — never a direct tool.
import { ASK_LIMITS } from './limits.mjs';

export const METRICS_CHANGE_KINDS = Object.freeze(['enable', 'record', 'workspace_home', 'route_members']);
const ATTRIBUTIONS = ['git-user', 'none'];
const SLUG_RE = /^[^\s/]+\/[^\s/]+$/;                     // owner/repo — what projectSlug() derives from origin

export const METRICS_ERRORS = Object.freeze({
  kind: `kind must be one of ${METRICS_CHANGE_KINDS.join(', ')}`,
  bothTargets: 'give projectKey OR workspaceId, not both',
  projectRequired: (kind) => `${kind} needs a projectKey`,
  workspaceRequired: (kind) => `${kind} needs a workspaceId`,
  unknownProject: (key) => `unknown projectKey "${key}"`,
  unknownWorkspace: (id) => `unknown workspaceId "${id}"`,
  mode: 'mode must be "here" or "delegate"',
  attribution: 'attribution must be "git-user" or "none"',
  delegateTo: 'delegateTo must be the target project\'s owner/repo slug',
  alreadyRecords: (name) => `${name} already records team metrics on its own branch`,
  recordBool: 'record must be true or false',
  notEnabled: (name) => `team metrics are not enabled on ${name} — propose kind "enable" first`,
  recordSame: (name, on) => `"Include my runs" is already ${on ? 'on' : 'off'} for ${name}`,
  homeNotMember: (key) => `homeProjectKey "${key}" is not a member of this workspace`,
  homeNotRecording: (name) => `${name} does not record team metrics locally, so it cannot be a metrics home — enable it first`,
  homeSame: (name) => `${name} is already the metrics home`,
  homeUnset: 'the metrics home is already unset',
  noHome: (name) => `${name} has no metrics home — propose kind "workspace_home" first`,
});

const str = (v) => (typeof v === 'string' ? v.trim() : '');
// eslint-disable-next-line no-control-regex
const BREAKS_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
const clip = (v, n) => String(v ?? '').replace(BREAKS_RE, ' ').slice(0, n);
/** The local record-side view of a project's prefs: enabled with a fetched config and no delegation. */
const recordsLocally = (prefs) => !!prefs?.enabled && !!prefs.configKnown && !prefs.config?.delegateTo;

/**
 * @param {{listProjects:() => Promise<Array<{key,name,path}>>, readWorkspace:(id) => Promise<object|null>,
 *          readPrefs:(projectKey) => object|null, projectKeyOf:(path) => string}} readers
 */
export function createMetricsChangeValidator({ listProjects, readWorkspace, readPrefs, projectKeyOf }) {
  const nameOf = (p) => clip(p.name || p.key, 120);
  return async function validateMetricsChange(input = {}) {
    const raw = input && typeof input === 'object' ? input : {};
    const kind = str(raw.kind);
    if (!METRICS_CHANGE_KINDS.includes(kind)) return { ok: false, errors: [METRICS_ERRORS.kind] };
    const projectKey = str(raw.projectKey);
    const workspaceId = str(raw.workspaceId);
    if (projectKey && workspaceId) return { ok: false, errors: [METRICS_ERRORS.bothTargets] };
    const note = clip(raw.note, ASK_LIMITS.proposalNoteMaxChars);
    const errors = [];
    const card = { type: 'metrics', kind, note, projectKey: null, projectName: null, workspaceId: null, workspaceName: null, summary: '', effects: [] };

    if (kind === 'enable' || kind === 'record') {
      if (!projectKey) return { ok: false, errors: [METRICS_ERRORS.projectRequired(kind)] };
      const p = (await listProjects()).find((x) => x && x.key === projectKey);
      if (!p) return { ok: false, errors: [METRICS_ERRORS.unknownProject(clip(projectKey, 120))] };
      const prefs = readPrefs(p.key);
      card.projectKey = p.key; card.projectName = nameOf(p);
      if (kind === 'enable') {
        const mode = raw.mode == null || raw.mode === '' ? 'here' : raw.mode;
        if (mode !== 'here' && mode !== 'delegate') errors.push(METRICS_ERRORS.mode);
        const attribution = raw.attribution == null || raw.attribution === '' ? 'git-user' : raw.attribution;
        if (mode === 'here' && !ATTRIBUTIONS.includes(attribution)) errors.push(METRICS_ERRORS.attribution);
        const delegateTo = str(raw.delegateTo);
        if (mode === 'delegate' && !SLUG_RE.test(delegateTo)) errors.push(METRICS_ERRORS.delegateTo);
        if (mode === 'here' && recordsLocally(prefs)) errors.push(METRICS_ERRORS.alreadyRecords(card.projectName));
        if (errors.length) return { ok: false, errors };
        card.mode = mode;
        card.attribution = mode === 'here' ? attribution : null;
        card.delegateTo = mode === 'delegate' ? delegateTo : null;
        // A project that already delegates gets its marker re-pointed (enableTeamMetrics change:true).
        card.change = mode === 'delegate' && !!prefs?.enabled && !!prefs.config?.delegateTo;
        if (mode === 'here') {
          card.summary = `Enable team metrics on ${card.projectName} — record on its own worca-metrics branch`;
          card.effects = [
            'Creates the orphan branch worca-metrics on origin, holding only .worca-metrics/',
            'Every finished run — done, failed or stopped — is pushed there by every teammate whose Worca sees the branch',
            attribution === 'none' ? 'Records carry no person (no per-actor breakdown)' : 'Records carry the git user name (visible to anyone with read access)',
            'A team decision, made once: changing attribution later means committing to the branch by hand',
          ];
        } else {
          card.summary = `${card.change ? 'Re-point' : 'Enable'} team metrics on ${card.projectName} — delegate to ${delegateTo}`;
          card.effects = [
            `Pushes a marker branch worca-metrics on ${card.projectName}'s origin that points teammates at ${delegateTo}`,
            `This project's single-project runs land on ${delegateTo}'s branch, still labelled with this project`,
            'Attribution follows the target project\'s policy',
          ];
        }
      } else {
        if (typeof raw.record !== 'boolean') errors.push(METRICS_ERRORS.recordBool);
        if (!prefs?.enabled) errors.push(METRICS_ERRORS.notEnabled(card.projectName));
        else if (typeof raw.record === 'boolean' && (prefs.record !== false) === raw.record) errors.push(METRICS_ERRORS.recordSame(card.projectName, raw.record));
        if (errors.length) return { ok: false, errors };
        card.record = raw.record;
        card.summary = `Turn "Include my runs" ${raw.record ? 'on' : 'off'} for ${card.projectName}`;
        card.effects = raw.record
          ? ['Your runs on this project are recorded again from this machine', 'The branch and every teammate are untouched']
          : ['Stops recording your runs on this project from this machine only', 'The branch, existing records and every teammate are untouched', 'Workspace runs whose metrics home is this project follow the same switch'];
      }
      return { ok: true, card };
    }

    // workspace_home / route_members
    if (!workspaceId) return { ok: false, errors: [METRICS_ERRORS.workspaceRequired(kind)] };
    const ws = await readWorkspace(workspaceId);
    if (!ws) return { ok: false, errors: [METRICS_ERRORS.unknownWorkspace(clip(workspaceId, 120))] };
    card.workspaceId = ws.id; card.workspaceName = clip(ws.name || ws.id, 120);
    const projects = await listProjects();
    const members = (ws.projectPaths || []).map((path) => {
      const key = projectKeyOf(path);
      const p = projects.find((x) => x && x.key === key);
      return { key, path, name: p ? nameOf(p) : clip(String(path).split('/').pop(), 120) };
    });
    const homeKey = ws.metricsProject ? projectKeyOf(ws.metricsProject) : null;
    const home = homeKey ? members.find((m) => m.key === homeKey) || null : null;
    if (kind === 'workspace_home') {
      const wantKey = raw.homeProjectKey === null || raw.homeProjectKey === undefined || raw.homeProjectKey === '' ? null : str(raw.homeProjectKey);
      if (wantKey === null) {
        if (!homeKey) return { ok: false, errors: [METRICS_ERRORS.homeUnset] };
        card.homeProjectKey = null; card.homeProjectName = null; card.homePath = null;
        card.summary = `Clear the metrics home of ${card.workspaceName}`;
        card.effects = ['Workspace runs are no longer recorded from this machine until a new home is chosen', 'Members keep recording their own single-project runs'];
        return { ok: true, card };
      }
      const m = members.find((x) => x.key === wantKey);
      if (!m) return { ok: false, errors: [METRICS_ERRORS.homeNotMember(clip(wantKey, 120))] };
      if (!recordsLocally(readPrefs(m.key))) return { ok: false, errors: [METRICS_ERRORS.homeNotRecording(m.name)] };
      if (homeKey === m.key) return { ok: false, errors: [METRICS_ERRORS.homeSame(m.name)] };
      card.homeProjectKey = m.key; card.homeProjectName = m.name; card.homePath = m.path;
      card.summary = `Set the metrics home of ${card.workspaceName} to ${m.name}`;
      card.effects = [
        `Workspace runs are recorded on ${m.name}'s worca-metrics branch and follow its "Include my runs" switch`,
        'A per-machine choice: teammates pick their own; the Team metrics page reads every recording member',
      ];
      return { ok: true, card };
    }
    // route_members
    if (!home) return { ok: false, errors: [METRICS_ERRORS.noHome(card.workspaceName)] };
    card.homeProjectKey = home.key; card.homeProjectName = home.name;
    card.summary = `Route every member of ${card.workspaceName} to its metrics home ${home.name}`;
    card.effects = [
      'Each member with no worca-metrics branch gets a marker branch on its origin that delegates to the home',
      'Members that already record on their own branch or delegate elsewhere are left alone',
      'One push per member; a push a repository rejects is reported per member',
    ];
    return { ok: true, card };
  };
}

const eventText = (s, n) => clip(s, n).replace(/"/g, "'").replace(/\[(\/?)worca context\]/gi, '($1worca context)');

/** `[worca event] …` — the synthetic turn's prompt after the user acted on a metrics card. */
export function metricsEventPrompt({ cardId, state, card = {}, result = null }) {
  const summary = eventText(card.summary, 160);
  if (state === 'declined') return `[worca event] metrics card ${cardId} declined; "${summary}"`;
  if (state === 'failed') return `[worca event] metrics card ${cardId} failed: ${eventText(result?.error || 'unknown error', 200)}; "${summary}"`;
  return `[worca event] metrics card ${cardId} applied; "${summary}"${result?.detail ? `; ${eventText(result.detail, 300)}` : ''}`;
}

/** The user-row notice above the event turn. */
export function metricsNoticeText({ state, card = {}, result = null }) {
  const s = clip(card.summary, 120);
  if (state === 'declined') return `Declined — ${s}`;
  if (state === 'failed') return `Could not apply — ${s}: ${clip(result?.error || 'unknown error', 200)}`;
  return `Applied — ${s}${result?.detail ? ` · ${clip(result.detail, 200)}` : ''}`;
}
