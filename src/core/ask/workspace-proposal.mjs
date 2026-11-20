// src/core/ask/workspace-proposal.mjs
// The ONE validator behind mcp__worca__propose_workspace_change, and the event/notice text of the
// workspace card. Pure: the registry's own plan checks (workspaces.mjs planWorkspaceCreate /
// planMembersAdd / planMemberRemove / planWorkspaceRename), the projects, live runs, schedules and
// the metrics / policy homes are injected (workspace-deps.mjs binds the real ones), so the MCP child
// validates for the model's self-correction and the parent turn re-validates authoritatively and
// mints the card — the model-proposal.mjs split. Nothing here writes: applying the card goes
// through ui/server.mjs's cards route, behind the user's click and the live-run guard.

export const WORKSPACE_CHANGE_KINDS = Object.freeze(['create', 'add_members', 'remove_member', 'rename']);

const str = (v) => (typeof v === 'string' ? v.trim() : '');
// eslint-disable-next-line no-control-regex
const BREAKS_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
const clip = (v, n) => String(v ?? '').replace(BREAKS_RE, ' ').slice(0, n);
const basename = (p) => String(p).split('/').filter(Boolean).pop() || String(p);
const list = (names) => names.join(', ');
const RESCAN_EFFECT = 'Once applied, worca starts a Workspace scan run of the new set — fresh graphify graphs per member, the map and a new description, saved when the run ends (follow it under Running)';
const RESCAN_CHOICES = Object.freeze(['none', 'partial', 'full']);   // workspaces.mjs RESCAN_CHOICES (this module stays registry-free)
const REMOVE_RESCAN_EFFECT = 'Once applied, worca prunes the map at once, then re-scans as chosen on the card: none keeps the pruned map; partial has one agent rewrite the overview and coordination notes from it; full re-scans every member left';

/** The follow-up a card offers once applied, in the words of the event prompt. */
const FOLLOW_UP_TEXT = {
  metrics_route_members: 'propose_metrics_change kind route_members',
  policy_route_members: 'propose_policy_change kind route_members',
  metrics_workspace_home: 'propose_metrics_change kind workspace_home',
  policy_workspace_home: 'propose_policy_change kind workspace_home',
};

/**
 * @param {object} r
 * @param {() => Promise<Array<{key,name,path}>>} r.listProjects  registered projects
 * @param {(id:string) => Promise<object|null>} r.readWorkspace   annotated workspace (projectPaths / projectKeys aligned)
 * @param {(path:string) => string} r.projectKeyOf
 * @param {{create:Function, add:Function, remove:Function, rename:Function}} r.plan
 *        the registry's checks; each throws a coded error the card reports verbatim
 * @param {(id:string) => Promise<'run'|'scan'|null>} r.liveRun  a live run of the workspace, 'scan' when every one is a Workspace scan
 * @param {(id:string) => Promise<Array<{kind,id,title,sourceBranchByKey:object|null,sourceFromPrevious:boolean}>>} r.scheduled
 *        the workspace's open schedules and scheduled runs
 * @param {(ws:object, next:string[]) => Promise<{metrics:{home,members:Array<{path,ok}>}|null, policy:{home,members:Array<{path,ok}>}|null}>} r.homeStatus
 *        each member of the NEW set against the workspace's metrics / policy home (null: no home)
 * @param {(id:string, path:string, opts:{pendingRescan:('full'|null)}) => Promise<{level,reason,partialAvailable}>} [r.removeImpact]
 *        the re-scan worca recommends after removing that member (none | partial | full)
 */
export function createWorkspaceChangeValidator(r) {
  /** @returns {Promise<{ok:true, card:object}|{ok:false, errors:string[]}>} */
  return async function validateWorkspaceChange(input) {
    const inp = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const kind = str(inp.kind);
    if (!WORKSPACE_CHANGE_KINDS.includes(kind)) return { ok: false, errors: [`kind must be one of ${WORKSPACE_CHANGE_KINDS.join(', ')}`] };
    const note = clip(str(inp.note), 200);
    try {
      const projects = (await r.listProjects()) || [];
      const byKey = (key) => {
        const p = projects.find((x) => x && x.key === key);
        if (!p) throw new Error(`unknown projectKey "${clip(key, 120)}" — list_projects names the registered projects`);
        return { key: p.key, name: clip(p.name || basename(p.path), 120), path: p.path, ...(p.vcs === 'none' ? { vcs: 'none' } : {}) };
      };
      const nameOfPath = (path) => {
        const p = projects.find((x) => x && x.path === path);
        return clip((p && p.name) || basename(path), 120);
      };
      const keys = Array.isArray(inp.projectKeys) ? [...new Set(inp.projectKeys.map(str).filter(Boolean))] : [];
      const card = { type: 'workspace', kind, summary: '', ...(note ? { note } : {}), workspaceId: null, workspaceName: null, effects: [], warnings: [], followUps: [] };

      if (kind === 'create') {
        const members = keys.map(byKey);
        const plan = r.plan.create({ name: inp.name, projectPaths: members.map((m) => m.path) });
        card.name = clip(plan.name, 120);
        card.members = members;
        card.summary = `Create workspace ${card.name} with ${list(members.map((m) => m.name))}`;
        card.effects = ['A new workspace; runs can target all its members at once',
          'Its metrics and policy homes are picked the way the Workspaces page picks them (the one member that already records or carries a policy)',
          RESCAN_EFFECT];
        card.change = { name: plan.name, projectPaths: members.map((m) => m.path) };
        return { ok: true, card };
      }

      const workspaceId = str(inp.workspaceId);
      if (!workspaceId) return { ok: false, errors: [`workspaceId is required for kind "${kind}"`] };
      const ws = await r.readWorkspace(workspaceId);
      if (!ws) return { ok: false, errors: [`unknown workspace "${clip(workspaceId, 120)}" — list_projects names the workspaces`] };
      card.workspaceId = ws.id;
      card.workspaceName = clip(ws.name || ws.id, 120);
      const wsName = card.workspaceName;

      if (kind === 'rename') {
        const plan = r.plan.rename(ws.id, inp.name);
        card.name = clip(plan.name, 120);
        card.summary = `Rename ${wsName} to ${card.name}`;
        card.effects = [`The workspace keeps its id ${ws.id}: runs, schedules, metrics and policy stay attached`];
        card.change = { workspaceId: ws.id, name: plan.name };
        return { ok: true, card };
      }

      // A member change waits for the workspace's live runs (the cards route refuses it); a rename never does.
      const live = await r.liveRun(ws.id);
      if (live === 'scan') card.warnings.push(`A Workspace scan of ${wsName} is running — an automatic re-scan is replaced by this change; a scan you started must end first`);
      else if (live) card.warnings.push(`A run of ${wsName} is live — the change is refused until it ends`);
      const scheduled = (await r.scheduled(ws.id)) || [];
      const label = (s) => `${s.kind === 'schedule' ? 'Schedule' : 'Scheduled run'} "${clip(s.title || s.id, 80)}"`;
      card.effects = [
        `The workspace keeps its id ${ws.id}; runs already started keep the members they started with`,
        RESCAN_EFFECT,
      ];

      if (kind === 'add_members') {
        const added = keys.map(byKey);
        const plan = r.plan.add(ws.id, added.map((m) => m.path));
        card.added = added;
        const names = list(added.map((m) => m.name));
        card.summary = `Add ${names} to ${wsName}`;
        const homes = (await r.homeStatus(ws, plan.next)) || {};
        const off = (h) => (h ? added.filter((m) => (h.members || []).some((x) => x.path === m.path && !x.ok)).map((m) => m.name) : []);
        const offMetrics = off(homes.metrics);
        const offPolicy = off(homes.policy);
        if (offMetrics.length) {
          card.warnings.push(`${list(offMetrics)} does not record to the metrics home ${clip(homes.metrics.home, 120)} — route the members once this is applied`);
          card.followUps.push('metrics_route_members');
        }
        if (offPolicy.length) {
          card.warnings.push(`${list(offPolicy)} does not follow the policy home ${clip(homes.policy.home, 120)} — route the members once this is applied`);
          card.followUps.push('policy_route_members');
        }
        for (const s of scheduled) {
          if (s.sourceBranchByKey && Object.keys(s.sourceBranchByKey).length) {
            card.warnings.push(`${label(s)} sets per-member source branches; ${names} starts from the default source branch`);
          }
          if (s.sourceFromPrevious) {
            card.warnings.push(`${label(s)} starts from the previous run's branches; when that run started before this change, ${names} starts from its default source branch`);
          }
        }
        card.change = { workspaceId: ws.id, projectPaths: added.map((m) => m.path) };
        return { ok: true, card };
      }

      // remove_member: a member is named by its key (the workspace's own, so an unregistered one works too).
      const key = str(inp.projectKey);
      const i = (ws.projectKeys || []).indexOf(key);
      if (!key || i < 0) return { ok: false, errors: [`${key ? `"${clip(key, 120)}" is` : 'projectKey is required: name'} not a member of ${wsName}`] };
      const path = ws.projectPaths[i];
      const plan = r.plan.remove(ws.id, path);
      const askedRescan = inp.rescan === undefined || inp.rescan === null || inp.rescan === '' ? null : str(inp.rescan);
      if (askedRescan !== null && !RESCAN_CHOICES.includes(askedRescan)) return { ok: false, errors: [`rescan must be one of ${RESCAN_CHOICES.join(', ')}`] };
      const impact = r.removeImpact ? await r.removeImpact(ws.id, path, { pendingRescan: live === 'scan' ? 'full' : null }) : null;
      if (askedRescan === 'partial' && impact && !impact.partialAvailable) {
        return { ok: false, errors: [`a partial re-scan is not available: ${clip(impact.reason, 300)} Propose none or full.`] };
      }
      card.effects = card.effects.map((e) => (e === RESCAN_EFFECT ? REMOVE_RESCAN_EFFECT : e));
      // The reason is shown ONCE, in the card's re-scan box (ask-panel buildWorkspaceCard) — never as an effects line.
      if (impact) card.recommendation = { level: impact.level, reason: clip(impact.reason, 400), partialAvailable: !!impact.partialAvailable };
      card.rescan = askedRescan ?? (impact ? impact.level : 'full');
      card.rescanAsked = askedRescan !== null;
      // P5: a registered Folder project's Remove row shows its Folder chip, as the create / add rows do (byKey).
      const removedRow = projects.find((x) => x && x.path === path);
      const removed = { key, name: nameOfPath(path), path, ...(removedRow?.vcs === 'none' ? { vcs: 'none' } : {}) };
      card.removed = removed;
      card.summary = `Remove ${removed.name} from ${wsName}`;
      card.effects.push(`The Map tab drops ${removed.name}'s edges and reviews (confirmed, rejected and manual edges that name it)`);
      if (ws.metricsProject && plan.metricsProject === null) {
        card.warnings.push(`${removed.name} is the metrics home — it is cleared, and workspace runs record no metrics until a new home is chosen`);
        card.followUps.push('metrics_workspace_home');
      }
      if (ws.policyProject && plan.policyProject === null) {
        card.warnings.push(`${removed.name} is the policy home — it is cleared, and workspace runs run with no team policy until a new home is chosen`);
        card.followUps.push('policy_workspace_home');
      }
      for (const s of scheduled) {
        const br = s.sourceBranchByKey && s.sourceBranchByKey[key];
        if (br) card.warnings.push(`${label(s)} names ${removed.name} (source branch ${clip(br, 120)}); from now on that entry is ignored`);
      }
      card.change = { workspaceId: ws.id, projectPath: path };
      return { ok: true, card };
    } catch (err) {
      return { ok: false, errors: [String(err && err.message ? err.message : err)] };
    }
  };
}

const eventText = (s, n) => clip(s, n).replace(/"/g, "'").replace(/\[(\/?)worca context\]/gi, '($1worca context)');

/** `[worca event] …` — the synthetic turn's prompt after the user acted on a workspace card. */
export function workspaceEventPrompt({ cardId, state, card = {}, result = null }) {
  const summary = eventText(card.summary, 200);
  if (state === 'declined') return `[worca event] workspace card ${cardId} declined; "${summary}"`;
  if (state === 'failed') return `[worca event] workspace card ${cardId} failed: ${eventText(result?.error || 'unknown error', 300)}; "${summary}"`;
  const follow = (Array.isArray(card.followUps) ? card.followUps : []).map((f) => FOLLOW_UP_TEXT[f]).filter(Boolean);
  return `[worca event] workspace card ${cardId} applied; "${summary}"`
    + `${result?.workspaceId ? `; workspace ${eventText(result.workspaceId, 80)}` : ''}`
    + `${result?.detail ? `; ${eventText(result.detail, 300)}` : ''}`
    + `${follow.length ? `; follow-ups to offer: ${follow.join(', ')}` : ''}`;
}

/** The user-row notice above the event turn. */
export function workspaceNoticeText({ state, card = {}, result = null }) {
  const s = clip(card.summary, 160);
  if (state === 'declined') return `Declined — ${s}`;
  if (state === 'failed') return `Could not apply — ${s}: ${clip(result?.error || 'unknown error', 200)}`;
  return `Applied — ${s}${result?.detail ? ` · ${clip(result.detail, 200)}` : ''}`;
}
