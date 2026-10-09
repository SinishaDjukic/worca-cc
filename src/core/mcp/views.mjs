// src/core/mcp/views.mjs
// Read models for the Connectors page (spec §7), the project MCP tab (§8) and Test (§7.3). Pure
// builders over { snapshot, catalog, teams, host facts, … } — every per-member state comes from the
// resolver itself, run on one set as a spawn would (resolveSet) — plus thin async shells that gather
// those inputs. Nothing here writes, and no secret value ever leaves: secrets read as { set, updatedAt, env? }.
// Sets also hold skills (skills registry §6, §7): `skillCatalog` and `hostFacts` join the context.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readMcpStore } from './store.mjs';
import { loadCatalog } from './catalog.mjs';
import { teamRecordsFor, copyName } from './identity.mjs';
import {
  resolveMcpServers, materializeCopy, skipReasonText, PROBLEM_REASONS, teamMembers, cachedTeams, cachedTeamFor, hostContext,
} from './registry.mjs';
import { listProjects } from '../projects.mjs';
import { pluginNameFor, teamSkillMembers } from './sets.mjs';
import { parseSkillId } from '../skills-registry/ids.mjs';
import { skillHostFacts } from '../skills-registry/host.mjs';
import { pluginNamesFor } from '../skills-registry/resolve.mjs';
import { SKILL_PROBLEM_REASONS, skillSkipReasonText } from '../skills-registry/texts.mjs';
import { loadSkillCatalog } from '../skills-registry/catalog.mjs';

const SYN = 'mcp-view-00000000';   // the synthetic project a one-set resolution targets
const DAY_MS = 86400000;

const keyOf = (setId, serverId) => `${setId}|${serverId}`;
const own = (o, k) => !!o && Object.hasOwn(o, k);
const byName = (a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1);

/** Team sets: every cached home with ≥1 `mcp.required` entry (a home with no record is provisional,
 *  §4.4), plus persisted Team state whose home governs nothing here any more (greyed, §11.2).
 *  `teams` = cachedTeams(). */
export function teamSetsOf(snapshot, teams) {
  const taken = [...Object.values(snapshot.sets), ...Object.values(snapshot.teams)].map((s) => s.slug).filter(Boolean);
  const fresh = teamRecordsFor(snapshot.teams, teams.map((t) => t.home), taken);
  const out = teams.map((t) => {
    const rec = fresh[t.home] ?? snapshot.teams[t.home];
    return { id: rec.id, slug: rec.slug, name: rec.name, home: t.home, required: t.required, requiredSkills: t.requiredSkills ?? [],
      greyed: false, provisional: !!fresh[t.home] };
  });
  for (const [home, rec] of Object.entries(snapshot.teams)) {
    if (!teams.some((t) => t.home === home)) out.push({ id: rec.id, slug: rec.slug, name: rec.name, home, required: [], requiredSkills: [], greyed: true });
  }
  return out.sort(byName);
}

/** The resolver run on one set as a spawn of a project holding only that set would run it (no cap,
 *  opt-out or collision steps). The host facts come with the context (viewContext: P3 hostContext()). */
export function resolveSet({ snapshot, catalog, setId, team = null, env, platform, execPath, worcaRoot, resolveCommand }) {
  const project = team ? { sets: [], includeGeneral: false }
    : setId === 'general' ? { sets: [], includeGeneral: true } : { sets: [setId], includeGeneral: false };
  return resolveMcpServers({
    surface: 'pipeline',
    targets: [{ kind: 'project', key: SYN, name: SYN, rank: 0 }],
    teams: { [SYN]: team ? { home: team.home, required: team.required } : null },
    store: { catalog, bases: snapshot.bases, sets: snapshot.sets, teams: snapshot.teams, projects: { [SYN]: project }, secrets: snapshot.secrets, tests: snapshot.tests },
    env, platform, execPath, worcaRoot, resolveCommand, toolNameLimit: 128, copyCap: Infinity, taken: [],
  });
}

/** A membership's own values: the user set's member, or the Team member's local state. A member that an
 *  interrupted two-file write left `pending` (§4.5) is off, as the resolver treats it. */
function membersOf(snapshot, catalog, set) {
  if (set.group !== 'team') {
    return (snapshot.sets[set.id]?.members || []).map((m) => ({ serverId: m.server, enabled: m.enabled === true && !m.pending, values: m.values || {} }));
  }
  if (set.greyed) return [];
  const state = own(snapshot.teams, set.home) ? snapshot.teams[set.home].members : {};
  return teamMembers(set.home, set.required, catalog, state)
    .map((m) => ({ serverId: m.serverId, enabled: m.state.enabled === true && !m.state.pending, values: m.state.values || {}, consent: m.state.consent ?? null }));
}

/** A set that is not greyed, with its members' own state (Test, Duplicate): `{ set, members }`, or null. */
export function setMembers(ctx, setId) {
  const set = setRows(ctx).find((s) => s.id === setId && !s.greyed);
  return set ? { set, members: membersOf(ctx.snapshot, ctx.catalog, set) } : null;
}

const cliName = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '_');
const isProblem = (r) => PROBLEM_REASONS.has(r) || PROBLEM_REASONS.has(r.slice(0, r.indexOf(':') + 1));

function sourceLabel(e) {
  if (!e) return '';
  if (e.source === 'plugin') return e.plugin;
  if (e.source === 'manual') return 'Manual';
  return `Team · ${e.home}`;
}

/** Full member cards of one set (spec §7.1). */
function memberViews(ctx, set) {
  const { snapshot, catalog } = ctx;
  const cat = new Map(catalog.map((e) => [e.id, e]));
  const res = resolveSet({ ...ctx, setId: set.id, team: set.group === 'team' ? set : null });
  const policyValues = new Map();
  for (const r of set.required || []) {
    if (typeof r?.plugin === 'string' ? typeof r.server !== 'string' : typeof r?.name !== 'string') continue;   // not an entry (P3 teamMembers skips it too)
    const id = typeof r.plugin === 'string' ? `plugin:${r.plugin}/${r.server}` : `policy:${set.home}/${r.name}`;
    policyValues.set(id, r.values && typeof r.values === 'object' ? r.values : {});
  }
  return membersOf(snapshot, catalog, set).map((m) => {
    const e = cat.get(m.serverId) || null;
    const skip = res.skipped.find((s) => s.serverId === m.serverId) || null;
    // As the set list and Test name it (§4.4): the resolver run on this one set computes a provisional Team
    // record over this home alone, teamSetsOf over every cached home.
    const copy = e ? copyName(e.base, set.slug ?? null) : m.serverId;
    const bag = snapshot.secrets[set.id]?.[m.serverId] || {};
    const fields = (e ? e.def.fields : []).map((f) => {
      const out = { key: f.key, label: f.label, secret: f.secret, oauth: f.oauth, required: f.required };
      if (f.secret) {
        const s = own(bag, f.key) ? bag[f.key] : null;
        out.state = s ? { set: true, updatedAt: s.updatedAt, ...(s.value && typeof s.value === 'object' ? { env: s.value.$env } : {}),
          old: f.oauth && ctx.now - Date.parse(s.updatedAt) >= 30 * DAY_MS } : { set: false };
      } else {
        if (f.default !== undefined) out.default = f.default;
        out.value = own(m.values, f.key) ? m.values[f.key] : '';
      }
      return out;
    });
    const tr = snapshot.tests[keyOf(set.id, m.serverId)] || null;
    let test = null;
    let tooLong = null;
    if (tr && e) {
      const stale = tr.fingerprint !== materializeCopy({ entry: e, values: m.values, secrets: bag, copy, name: copy }, ctx).fingerprint;
      test = { at: tr.at, ok: tr.ok, tools: Array.isArray(tr.tools) ? tr.tools.length : 0, error: tr.error, stale };
      const long = tr.ok && (tr.tools || []).find((t) => `mcp__${copy}__${cliName(t)}`.length > 64);
      if (long) tooLong = { limit: `mcp__${copy}__${cliName(long)}`.length > 128 ? 128 : 64, tool: long };
    }
    const reason = skip ? skip.reason : null;
    const view = {
      serverId: m.serverId, base: e ? e.base : m.serverId, copy, provisional: !!(e?.provisional || set.provisional),
      source: e ? e.source : null, sourceLabel: sourceLabel(e), type: e ? e.def.type : null,
      description: e ? e.def.description : '', enabled: m.enabled, fields, reason,
      problem: reason && isProblem(reason) ? skipReasonText(skip, catalog) : null, test, tooLong,
    };
    if (set.group === 'team') {
      const pv = policyValues.get(m.serverId) || {};
      // Only the server's non-secret fields (§11.1): a plugin reference's values meet its fields only here, as in Turn on.
      const nonSecret = new Set((e ? e.def.fields : []).filter((f) => !f.secret).map((f) => f.key));
      view.team = {
        consented: m.consent !== null,
        suggests: Object.keys(pv).filter((k) => nonSecret.has(k) && typeof pv[k] === 'string' && (own(m.values, k) ? m.values[k] : '') !== pv[k])
          .map((k) => ({ key: k, value: pv[k] })),
      };
    }
    return view;
  });
}

// ── Skills in sets (skills registry §6.2, §7) ─────────────────────────────────

/** A set's skills with their own state: the user set's (or General's) list, or the Team set's skills derived from its
 *  policy over the skill catalog (a greyed Team set requires none). A `pending` entry reads as off; the consent is
 *  teamSkillMembers' (the entry's consent hash, or null). */
function skillMembersOf(ctx, set) {
  const { snapshot } = ctx;
  if (set.group !== 'team') {
    const list = own(snapshot.sets, set.id) ? snapshot.sets[set.id].skills ?? [] : [];
    return list.map((k) => ({ skillId: k.skill, enabled: k.enabled === true && !k.pending, consent: null, team: false }));
  }
  const state = own(snapshot.teams, set.home) ? snapshot.teams[set.home].skills : undefined;
  return teamSkillMembers(set.home, set.requiredSkills, ctx.skillCatalog ?? [], state).map(({ skillId, state: st }) => ({
    skillId, enabled: st.enabled === true && !st.pending, consent: st.consent, team: true }));
}

// The first skills-registry §4.2 skip reason a one-set view can see (no opt-out, chat or cap here), or null when it loads.
const skillReason = (e, m) => (!e ? 'missing-skill' : e.pluginEnabled === false ? 'plugin-disabled' : e.valid === false ? 'invalid-skill'
  : m.team && m.consent === null ? 'needs-consent' : !m.enabled ? 'off' : null);
const skillSourceLabel = (x) => (x?.source === 'plugin' ? x.plugin : x?.source === 'library' ? 'Imported' : '');
const takenPluginNames = (ctx) => ctx.hostFacts?.installedPluginNames ?? [];
// The name a set's skills load under by the resolver's own rule over every set on this host (skills registry §4.1,
// P3 pluginNamesFor), so Settings shows the prefix pipelines and Ask use: a renamed set never takes another set's slug.
const setPluginName = (ctx, set) => pluginNamesFor(setRows(ctx), ctx.snapshot, takenPluginNames(ctx)).get(set.id)
  ?? pluginNameFor(set, takenPluginNames(ctx));

/** Skill cards of one set (skills registry §6.2; §7 SkillMemberView, plus `files` for the "4 files · 1 script" hint and `hooks` for the "declares hooks" badge):
 *  the name agents see (`<plugin name>:<skill>`), the catalog's facts and the member's state — a reason and, for a
 *  problem, its text. */
export function skillMemberViews(ctx, set) {
  const cat = new Map((ctx.skillCatalog ?? []).map((e) => [e.id, e]));
  const { pluginName } = setPluginName(ctx, set);
  const problems = new Set(SKILL_PROBLEM_REASONS);
  return skillMembersOf(ctx, set).map((m) => {
    const e = cat.get(m.skillId) ?? null;
    const id = parseSkillId(m.skillId);
    const name = e?.name ?? id?.name ?? m.skillId;
    const reason = skillReason(e, m);
    const view = {
      skillId: m.skillId, name, qualifiedName: `${pluginName}:${name}`, source: e?.source ?? id?.source ?? null,
      sourceLabel: skillSourceLabel(e ?? id), description: e?.description ?? '', enabled: m.enabled,
      valid: !!e && e.valid !== false, problems: e?.problems ?? [], files: e?.files ?? 0, scripts: e?.scripts ?? [],
      shellBlocks: e?.shellBlocks ?? 0, pluginRootRefs: e?.frontmatter?.pluginRootRefs === true, hooks: e?.frontmatter?.hooks === true, reason,
      problem: reason && problems.has(reason) ? skillSkipReasonText({ setId: set.id, setName: set.name, skillId: m.skillId, name, reason }) : null,
    };
    if (set.group === 'team') view.team = { consented: m.consent !== null };
    return view;
  });
}

/** The sets in list order (§7.1): General, user sets by name, then Team sets. */
function setRows(ctx) {
  const { snapshot } = ctx;
  const user = Object.entries(snapshot.sets).filter(([id]) => id !== 'general')
    .map(([id, s]) => ({ id, name: s.name, slug: s.slug, group: 'set' })).sort(byName);
  return [
    { id: 'general', name: 'General', slug: null, group: 'general' },
    ...user,
    ...teamSetsOf(snapshot, ctx.teams).map((t) => ({ ...t, group: 'team' })),
  ];
}

function usedBy(ctx, set) {
  const { snapshot, projects, projectHomes } = ctx;
  const assign = (key) => (own(snapshot.projects, key) ? snapshot.projects[key] : { sets: [], includeGeneral: true });
  if (set.group === 'general') return projects.filter((p) => assign(p.key).includeGeneral !== false);
  if (set.group === 'team') return projects.filter((p) => projectHomes[p.key] === set.home);
  return projects.filter((p) => (assign(p.key).sets || []).includes(set.id));
}

const testWord = (m) => (!m.test ? 'none' : !m.test.ok ? 'failed' : m.test.stale ? 'stale' : 'ok');

/** GET /api/mcp/sets */
export function buildSetsView(ctx) {
  return {
    newer: ctx.snapshot.newer,
    sets: setRows(ctx).map((s) => {
      const members = memberViews(ctx, s);
      return {
        id: s.id, name: s.name, group: s.group, greyed: !!s.greyed, home: s.home ?? null,
        serverCount: members.length, skillCount: skillMembersOf(ctx, s).length,
        problem: members.some((m) => m.problem || (m.test && !m.test.ok)),
        usedBy: usedBy(ctx, s).map((p) => ({ key: p.key, name: p.name })),
        members: members.map((m) => ({ serverId: m.serverId, copy: m.copy, problem: m.problem, test: testWord(m) })),
      };
    }),
  };
}

/** GET /api/mcp/sets/:id — null when no such set. `set.pluginName` is the prefix its skills load under (skills registry
 *  §4.1); `renamedPlugin` when an installed Claude Code plugin holds the slug. */
export function buildSetView(ctx, id) {
  const s = setRows(ctx).find((x) => x.id === id);
  if (!s) return null;
  const { pluginName, renamed } = setPluginName(ctx, s);
  return {
    newer: ctx.snapshot.newer,
    set: { id: s.id, name: s.name, group: s.group, greyed: !!s.greyed, home: s.home ?? null,
      usedBy: usedBy(ctx, s).map((p) => ({ key: p.key, name: p.name })), pluginName, renamedPlugin: renamed },
    members: memberViews(ctx, s),
    skills: skillMemberViews(ctx, s),
  };
}

// The last "Check for updates" result per library skill since this server started (skills registry §6.3 badge): the
// update-preview route records it; Update and Remove clear it. Kept in memory: a restart forgets it until the next check.
const updateChecks = new Set();
/** Record one "Check for updates" result: `available` = the skill's origin differs from its library copy. */
export function recordSkillUpdateCheck(skillId, available) {
  if (available === true) updateChecks.add(skillId); else updateChecks.delete(skillId);
}

/** GET /api/skills (skills registry §7): every catalog entry (§3.3) with the sets it is in; `updateAvailable` for an id in
 *  `ctx.updatesAvailable`, else in the recorded Check for updates results; `installedPluginClash` when a Claude Code
 *  plugin of the skill's plugin name is installed on this host, so pipeline agents also see that plugin's own copy (F4). */
export function buildSkillCatalogView(ctx) {
  const rows = setRows(ctx).map((s) => ({ s, ids: new Set(skillMembersOf(ctx, s).map((m) => m.skillId)) }));
  const installed = new Set(takenPluginNames(ctx));
  const updates = new Set(ctx.updatesAvailable ?? updateChecks);
  return {
    newer: ctx.snapshot.newer,
    skills: (ctx.skillCatalog ?? []).map((e) => ({
      ...e,
      inSets: rows.filter((r) => r.ids.has(e.id)).map((r) => ({ id: r.s.id, name: r.s.name })),
      updateAvailable: updates.has(e.id),
      installedPluginClash: installed.has(e.plugin),   // a library skill's plugin is null
    })),
  };
}

/** GET /api/mcp/servers (§7.2). `claudeNames` = top-level mcpServers keys of ~/.claude.json. */
export function buildCatalogView(ctx) {
  const { snapshot, catalog, claudeNames } = ctx;
  const rows = setRows(ctx);
  return {
    newer: snapshot.newer,
    servers: catalog.map((e) => {
      const inSets = rows.filter((s) => membersOf(snapshot, catalog, s).some((m) => m.serverId === e.id))
        .map((s) => ({ id: s.id, name: s.name }));
      let last = null;
      for (const [k, t] of Object.entries(snapshot.tests)) {
        if (k.endsWith(`|${e.id}`) && t.ok && (!last || t.at > last.at)) last = t;
      }
      return {
        id: e.id, base: e.base, provisional: !!e.provisional, source: e.source, sourceLabel: sourceLabel(e),
        type: e.def.type, description: e.def.description, fields: e.def.fields, inSets,
        tools: last ? (Array.isArray(last.tools) ? last.tools.length : 0) : null,
        pluginDisabled: !e.pluginEnabled, inClaudeConfig: claudeNames.includes(e.base),
        retired: e.retired === true ? e.home : null,
        ...(e.source === 'manual' ? { def: e.def } : {}),
      };
    }),
  };
}

/** GET /api/mcp/projects/:key (§8). `team` = cachedTeamFor({ projectKey }). */
export function buildProjectAssignment(ctx, projectKey, team) {
  const { snapshot } = ctx;
  const a = own(snapshot.projects, projectKey) ? snapshot.projects[projectKey] : { sets: [], includeGeneral: true };
  const users = setRows(ctx).filter((s) => s.group === 'set');
  const sets = (a.sets || []).map((id) => users.find((s) => s.id === id)).filter(Boolean).map((s) => ({ id: s.id, name: s.name }));
  const includeGeneral = a.includeGeneral !== false;
  const t = team ? teamSetsOf(snapshot, ctx.teams).find((x) => x.home === team.home) : null;
  return {
    sets, includeGeneral,
    team: t ? { id: t.id, name: t.name, home: t.home } : null,
    none: !sets.length && !includeGeneral && !t,
    choices: users.filter((s) => !sets.some((x) => x.id === s.id)).map((s) => ({ id: s.id, name: s.name })),
  };
}

/** Every switched-on membership, user and Team, whose server id passes `match` (background re-tests: off starts nothing). */
export function membershipKeys(ctx, match) {
  const out = [];
  for (const s of setRows(ctx)) for (const m of membersOf(ctx.snapshot, ctx.catalog, s)) if (m.enabled && match(m.serverId)) out.push(keyOf(s.id, m.serverId));
  return out;
}

/** duplicateSet's `team` option for a Team set id (P1 cannot derive the members): `{ home, members, skills }`, or null. */
export function teamDuplicateSource(ctx, setId) {
  const s = setMembers(ctx, setId);
  return s && { home: s.set.home, members: s.members.map((m) => m.serverId), skills: skillMembersOf(ctx, s.set).map((m) => m.skillId) };
}

/** The §11.2 locks on a Team set's members PUT: `{ home }` when allowed, else `{ status, error }`.
 *  Members are derived from policy: update only, and a never-consented member turns on only through
 *  the team checklist. */
export function teamMemberRefusal(ctx, setId, serverId, patch) {
  const set = teamSetsOf(ctx.snapshot, ctx.teams).find((t) => t.id === setId);
  if (!set) return { status: 404, error: 'set not found' };
  const m = membersOf(ctx.snapshot, ctx.catalog, { ...set, group: 'team' }).find((x) => x.serverId === serverId);
  if (!m) return { status: 409, error: 'Team set members come from team policy and cannot be added here' };
  if (patch.enabled === true && m.consent === null) return { status: 409, error: 'turn it on from the team checklist' };
  return { home: set.home };
}

/** The same Team locks on a Team set's skills PUT (skills registry §5): `{ home }`, or `{ status, error }`. */
export function teamSkillMemberRefusal(ctx, setId, skillId, patch) {
  const set = teamSetsOf(ctx.snapshot, ctx.teams).find((t) => t.id === setId);
  if (!set) return { status: 404, error: 'set not found' };
  const m = skillMembersOf(ctx, { ...set, group: 'team' }).find((x) => x.skillId === skillId);
  if (!m) return { status: 409, error: 'Team set skills come from team policy and cannot be added here' };
  if (patch.enabled === true && m.consent === null) return { status: 409, error: 'turn it on from the team checklist' };
  return { home: set.home };
}

// ── IO shells ────────────────────────────────────────────────────────────────

function claudeConfigNames() {
  try {
    const j = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'));
    return j && j.mcpServers && typeof j.mcpServers === 'object' ? Object.keys(j.mcpServers) : [];
  } catch { return []; }
}

/** Everything the builders read, from disk and the policy cache. */
export async function viewContext() {
  const snapshot = await readMcpStore();
  const catalog = await loadCatalog(snapshot);
  const skillCatalog = await loadSkillCatalog();
  const projects = (await listProjects()).map((p) => ({ key: p.key, name: p.name }));
  const projectHomes = {};
  for (const p of projects) projectHomes[p.key] = (await cachedTeamFor({ projectKey: p.key }))?.home ?? null;
  return { snapshot, catalog, skillCatalog, teams: cachedTeams(), projects, projectHomes, claudeNames: [],
    hostFacts: { installedPluginNames: skillHostFacts().installedPluginNames }, ...hostContext(), now: Date.now() };
}

export async function listCatalogView() { return buildCatalogView({ ...(await viewContext()), claudeNames: claudeConfigNames() }); }
export async function listSetsView() { return buildSetsView(await viewContext()); }
export async function getSetView(id) { return buildSetView(await viewContext(), id); }
export async function listSkillCatalogView() { return buildSkillCatalogView(await viewContext()); }
export async function projectAssignmentView(projectKey) {
  return buildProjectAssignment(await viewContext(), projectKey, await cachedTeamFor({ projectKey }));
}
