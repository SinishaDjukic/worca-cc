// src/core/ask/mcp.mjs
// Ask Worca's side of the MCP registry (docs/superpowers/specs/2026-09-29-mcp-registry-design-v2.md §9):
// the per-chat picker's choices (`mcpOff`), the targets in play, one resolve per turn or preview, the
// prompt section's input and the turn-end worktree notice. The resolver itself is src/core/mcp/registry.mjs.
import { codexSkillNames } from './prompt.mjs';
import { SET_ID_RE, MEMBERSHIP_KEY_RE } from '../mcp/definitions.mjs';
import { listProjects } from '../projects.mjs';
import { readWorkspace } from '../workspaces.mjs';
import { listAskWorktrees } from './worktrees.mjs';
import { resolveRegistry, cachedTeamFor, toolNameLimitFor, skipReasonText } from '../mcp/registry.mjs';
import { readMcpStore } from '../mcp/store.mjs';
import { loadCatalog } from '../mcp/catalog.mjs';
import { MCP_STARTUP_MS } from '../mcp/timeouts.mjs';
import { resolveSkillRegistry, cachedSkillTeamFor, SKILL_CAP } from '../skills-registry/resolve.mjs';
import { skillSkipReasonText, skillSkipMessage, skillLayerText, SKILL_PROBLEM_REASONS } from '../skills-registry/texts.mjs';

export const ASK_MCP_COPY_CAP = 12;
// Skills registry §4.4: Ask mounts at most 12 set skills per turn (SKILL_CAP.ask).
export const ASK_SKILL_CAP = SKILL_CAP.ask;
// cachedSkillTeamFor is P3's (= P2's cachedTeamFor): the Team input the MCP resolve gets, so both halves of a set see
// the same policy homes and a Team set has one id, slug and plugin name on both.
const DEFAULT_DEPS = { listProjects, readWorkspace, listWorktrees: listAskWorktrees, resolveRegistry, cachedTeamFor, readMcpStore, loadCatalog,
  resolveSkillRegistry, cachedSkillTeamFor };
const EMPTY_SKILLS = () => ({ mounted: [], plugins: [], skipped: [], sets: [], blocked: null });
const EMPTY_RESULT = () => ({ servers: {}, env: {}, secretValues: [], grants: [], disallowedTools: [], copies: [], skipped: [], skippedTools: [], sets: [] });

export const MCP_OFF_MAX = 100;

/** The `mcpOff` body field (§9.4, §12): null clears; else `{ sets: [setId], members: ['<setId>|<serverId>'] }`,
 *  ≤100 each, duplicates dropped. Unknown entries are kept: the resolver ignores them (§5.2). */
export function validateMcpOff(raw) {
  if (raw === null) return { ok: true, value: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'mcpOff must be an object or null' };
  const sets = raw.sets ?? [];
  const members = raw.members ?? [];
  if (!Array.isArray(sets) || sets.length > MCP_OFF_MAX || !sets.every((s) => typeof s === 'string' && SET_ID_RE.test(s))) {
    return { ok: false, error: `mcpOff.sets must be an array of at most ${MCP_OFF_MAX} set ids` };
  }
  if (!Array.isArray(members) || members.length > MCP_OFF_MAX || !members.every((m) => typeof m === 'string' && MEMBERSHIP_KEY_RE.test(m))) {
    return { ok: false, error: `mcpOff.members must be an array of at most ${MCP_OFF_MAX} "<setId>|<serverId>" or "<setId>|<skillId>" entries` };
  }
  return { ok: true, value: { sets: [...new Set(sets)], members: [...new Set(members)] } };
}

/**
 * §9.1 — the targets in play for one turn or preview: the pin, else the page (never the fallback-tagged dropdown
 * projectDir), then every open worktree of the thread (rank 1 + creation index). A project already in play keeps its
 * first route and rank — and every member of a workspace in play is in play (D13 "a workspace ⇒ all members"), so a
 * worktree on a member adds no target and never brings that member's own Team set (§5.1). An unregistered project or
 * a missing workspace is no target.
 * @returns {Promise<Array<{kind:'project', key, name, route, rank}|{kind:'workspace', id, name, members:{key,name}[], route, rank}>>}
 */
export async function askTargetsInPlay({ ctx = {}, threadId = null } = {}, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const projects = await d.listProjects();
  const byKey = new Map(projects.map((p) => [p.key, p]));
  const targets = [];
  const inPlay = new Set();   // project keys already in play: project targets and the members of a workspace target
  const project = (p, route, rank) => {
    if (!p || inPlay.has(p.key)) return;
    inPlay.add(p.key);
    targets.push({ kind: 'project', key: p.key, name: p.name, route, rank });
  };
  const workspace = async (id, route) => {
    const ws = await d.readWorkspace(id);
    if (!ws) return;
    const keys = ws.projectKeys || [];
    for (const key of keys) inPlay.add(key);
    targets.push({ kind: 'workspace', id: ws.id, name: ws.name, route, rank: 0,
      members: keys.map((key) => ({ key, name: byKey.get(key)?.name ?? key })) });
  };
  if (ctx.pinned === true) {
    if (ctx.projectKey) project(byKey.get(ctx.projectKey), 'pinned', 0);
    else if (ctx.workspaceId) await workspace(ctx.workspaceId, 'pinned');
  } else {
    // The fallback tag names only the dropdown's projectDir (§9.1) — like resolveAskContext and contextProjectKey.
    const byDir = ctx.projectSource === 'fallback' ? null : projects.find((p) => ctx.projectDir && p.path === ctx.projectDir);
    project(ctx.projectKey ? byKey.get(ctx.projectKey) : byDir, 'page', 0);
    if (ctx.workspaceId) await workspace(ctx.workspaceId, 'page');
  }
  if (threadId) (await d.listWorktrees(threadId)).forEach((w, i) => project(byKey.get(w.projectKey), 'worktree', 1 + i));
  return targets;
}

/** §9.2 — one resolve for an Ask turn or preview: General ∪ the targets' sets, minus the chat's choices. Teams come
 *  from the policy cache only (no git, no network). Never throws: a failure reads as no MCP servers. */
export async function resolveAskMcp({ ctx = {}, threadId = null, off = null, model = null } = {}, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  try {
    const targets = await askTargetsInPlay({ ctx, threadId }, d);
    const teams = Object.create(null);
    for (const t of targets) {
      if (t.kind === 'project') teams[t.key] = await d.cachedTeamFor({ projectKey: t.key });
      else teams[`ws:${t.id}`] = await d.cachedTeamFor({ workspaceId: t.id });
    }
    const result = await d.resolveRegistry({
      surface: 'ask', targets, teams, off: off || { sets: [], members: [] },
      toolNameLimit: toolNameLimitFor(model ? [model] : []), copyCap: ASK_MCP_COPY_CAP, taken: [], mcpTimeoutMs: MCP_STARTUP_MS.ask,
    });
    return { targets, result };
  } catch (err) {
    console.warn(`[worca-ask] MCP registry resolve failed (${err?.message || err}) — no MCP servers this turn`);
    return { targets: [], result: EMPTY_RESULT() };
  }
}

/** Skills registry §4.4 — one skills resolve for an Ask turn or preview: General ∪ the sets of the targets in play
 *  (askTargetsInPlay), minus the chat's choices (`off` holds `<setId>|<skillId>` keys too), at most 12 mounts.
 *  `blocked: 'sideload-disabled'` when this host's managed Claude Code settings refuse --plugin-dir: the picker still
 *  lists the rows, the turn mounts nothing. Never throws: a failure reads as no skills. */
export async function resolveAskSkills({ ctx = {}, threadId = null, off = null } = {}, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  try {
    const targets = await askTargetsInPlay({ ctx, threadId }, d);
    const teams = Object.create(null);
    for (const t of targets) {
      if (t.kind === 'project') teams[t.key] = await d.cachedSkillTeamFor({ projectKey: t.key });
      else teams[`ws:${t.id}`] = await d.cachedSkillTeamFor({ workspaceId: t.id });
    }
    // P3's IO shell reads this host's facts itself: `blocked` is 'sideload-disabled' when the managed settings refuse
    // --plugin-dir (the rows still resolve), `newer` when the registry files need a newer Worca.
    const result = await d.resolveSkillRegistry({ surface: 'ask', targets, teams, off: off || { sets: [], members: [] }, skillCap: ASK_SKILL_CAP });
    return { targets, result: { ...EMPTY_SKILLS(), ...result, blocked: result.blocked ?? null } };
  } catch (err) {
    console.warn(`[worca-ask] skills resolve failed (${err?.message || err}) — no skills from sets this turn`);
    return { targets: [], result: EMPTY_SKILLS() };
  }
}

/** The snapshot + catalog the texts need; empty when unreadable (a missing text never fails a turn). */
async function storeAndCatalog(d) {
  try {
    const snapshot = await d.readMcpStore();
    return { projects: snapshot.projects, catalog: await d.loadCatalog(snapshot) };
  } catch { return { projects: Object.create(null), catalog: [] }; }
}

/** §9.3 — renderMcpSection's input (prompt.mjs), or null without copies. */
export async function askMcpPromptInput({ targets, result }, deps = {}) {
  if (!result.copies.length) return null;
  const { projects, catalog } = await storeAndCatalog({ ...DEFAULT_DEPS, ...deps });
  const names = new Map();
  for (const t of targets) for (const p of t.kind === 'project' ? [t] : t.members) if (!names.has(p.key)) names.set(p.key, p.name);
  const noGeneral = (key) => Object.hasOwn(projects, key) && projects[key].includeGeneral === false;
  const general = result.copies.filter((c) => c.setId === 'general').map((c) => c.name);
  return {
    targets: targets.map((t) => ({ name: t.name, route: t.route })),
    copies: result.copies.map((c) => ({ name: c.name, description: c.description, setName: c.setName, projects: c.projects.map((k) => names.get(k) ?? k) })),
    skipped: result.skipped.map((x) => ({ copy: x.copy ?? x.serverId, setName: x.setName, reason: skipReasonText(x, catalog) })),   // missing-server has no copy
    // A workspace run includes General when any member does (§5.1), so a workspace excludes it only when all do.
    noGeneral: general.length ? targets.filter((t) => (t.kind === 'project' ? noGeneral(t.key) : t.members.length > 0 && t.members.every((m) => noGeneral(m.key)))).map((t) => t.name) : [],
    generalCopies: general,
  };
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const PICKER_GROUP = { general: 0, set: 1, team: 2 };

/** The picker's set rows (skills registry §4.4): the MCP resolver's sets with their skill counts. Both resolvers
 *  collect sets with one collectSets over one Team input, so they bring the same sets; a set only the skills list holds
 *  (the MCP resolve failed, or the store changed between the two reads) is appended. A stable sort by group keeps each
 *  resolver's own order; Team sets by name then id, as both resolvers sort them. */
function pickerSets(mcpSets, skillSets, blocked) {
  const skillsOf = new Map(skillSets.map((s) => [s.id, s]));
  const rows = mcpSets.map((s) => ({ ...s, skills: skillsOf.get(s.id)?.skills ?? 0, startedSkills: blocked ? 0 : skillsOf.get(s.id)?.started ?? 0 }));
  const have = new Set(rows.map((s) => s.id));
  for (const s of skillSets) {
    if (!have.has(s.id)) rows.push({ id: s.id, name: s.name, group: s.group, routes: s.routes, members: 0, started: 0, skills: s.skills, startedSkills: blocked ? 0 : s.started });
  }
  return rows.map((s, i) => [s, i])
    .sort(([a, i], [b, j]) => ((PICKER_GROUP[a.group] ?? 3) - (PICKER_GROUP[b.group] ?? 3))
      || (a.group === 'team' && b.group === 'team' ? cmp(a.name, b.name) || cmp(a.id, b.id) : i - j))
    .map(([s]) => s);
}

/** Skills registry §4.4/§7 — the preview's `skills` block: what mounts next turn (never a host path), the skipped rows
 *  with the name the picker shows (P3's `qualifiedName`: the set's plugin name over the whole store, a never-consented
 *  Team skill too), the line and the reason P4's /api/mcp/preview gives them (`message`, `why`), and whether it is a
 *  problem rather than a choice; `started` counts 0 when the host refuses --plugin-dir (`layer`). */
function skillsPreview(r, engine = 'claude') {
  // A Codex chat (#635): the names it loads them by (codexSkillNames) replace `<plugin>:<skill>`, and Claude Code's
  // --plugin-dir block does not apply — codex reads the skills through read_file.
  const codex = engine === 'codex';
  const names = codex ? codexSkillNames(r.mounted) : null;
  const blocked = codex ? null : r.blocked ?? null;
  return {
    mounted: r.mounted.map(({ dir, ...m }) => (codex ? { ...m, qualifiedName: names.get(m.qualifiedName) } : m)),
    plugins: r.plugins,
    skipped: r.skipped.map((x) => {
      const row = codex ? { ...x, qualifiedName: x.name } : x;
      return { ...row, message: skillSkipMessage(row), why: skillSkipReasonText(row), problem: SKILL_PROBLEM_REASONS.includes(x.reason) };
    }),
    started: blocked ? 0 : r.mounted.length,
    layer: { blocked, text: blocked ? skillLayerText(blocked) : null },
    newer: r.newer === true,
  };
}

/** §9.4 — POST /api/ask/mcp-preview's body: the same resolve as the turn, reduced to what the picker shows.
 *  Never the servers, the env or a secret value. Skills registry §4.4: plus the turn's skills and the per-set counts. */
export async function askMcpPreview({ ctx, threadId = null, off = null, model = null, engine = 'claude' }, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const { result } = await resolveAskMcp({ ctx, threadId, off, model }, d);
  const { result: sk } = await resolveAskSkills({ ctx, threadId, off }, d);
  // §4.6: a Codex chat starts no registry copy, only the set skills (#635). Its set rows count skills only, and
  // `codexServers` says how many servers wait for a Claude chat, so the picker can say so.
  if (engine === 'codex') {
    const sets = pickerSets(result.sets, sk.sets, false).map((x) => ({ ...x, members: 0, started: 0 }));
    return { sets, copies: [], started: 0, skipped: [], skippedTools: [], newer: result.newer === true,
      codexServers: result.copies.length + result.skipped.length, skills: skillsPreview(sk, 'codex') };
  }
  const { catalog } = result.skipped.length ? await storeAndCatalog(d) : { catalog: [] };
  return {
    sets: pickerSets(result.sets, sk.sets, !!sk.blocked), copies: result.copies, started: result.copies.length,
    skipped: result.skipped.map((x) => ({ ...x, copy: x.copy ?? x.serverId, why: skipReasonText(x, catalog) })),
    // §5.6: tools withheld from a copy that still starts; §4.5: registry files from a newer worca (nothing resolves).
    skippedTools: result.skippedTools, newer: result.newer === true,
    skills: skillsPreview(sk),
  };
}

/** §9.1 (D17) — at turn end: re-run the targets in play and name, per project a new worktree brought in, the copies
 *  that join from the next message. null when no worktree target joined or it brings no copy. Skills registry §4.4:
 *  with `before.skills` (the turn's skills result) the skills that join are named too. */
export async function askMcpJoinNotice({ before, ctx, threadId, off = null, model = null, engine = 'claude' }, deps = {}) {
  const codex = engine === 'codex';   // #635: a Codex chat gains skills only, named as it loads them (codexSkillNames)
  const next = await resolveAskMcp({ ctx, threadId, off, model }, deps);
  const nextSkills = before.skills ? (await resolveAskSkills({ ctx, threadId, off }, deps)).result : null;
  const had = new Set(before.targets.filter((t) => t.kind === 'project').map((t) => t.key));
  const old = new Set(before.result.copies.map((c) => c.name));
  const oldSkills = new Set((before.skills?.mounted ?? []).map((m) => m.qualifiedName));
  const nameOf = codex && nextSkills ? ((names) => (m) => names.get(m.qualifiedName))(codexSkillNames(nextSkills.mounted)) : (m) => m.qualifiedName;
  const parts = [];
  for (const t of next.targets) {
    if (t.kind !== 'project' || t.route !== 'worktree' || had.has(t.key)) continue;   // §9.1: only an open worktree joins mid-turn
    const joined = codex ? [] : next.result.copies.filter((c) => !old.has(c.name) && c.projects.includes(t.key)).map((c) => c.name);
    const skills = nextSkills && (codex || !nextSkills.blocked)
      ? nextSkills.mounted.filter((m) => !oldSkills.has(m.qualifiedName) && m.projects.includes(t.key)).map(nameOf) : [];
    if (joined.length && skills.length) parts.push(`${t.name}'s MCP servers (${joined.join(', ')}) and skills (${skills.join(', ')}) join from the next message`);
    else if (joined.length) parts.push(`${t.name}'s MCP servers (${joined.join(', ')}) join from the next message`);
    else if (skills.length) parts.push(`${t.name}'s skills (${skills.join(', ')}) join from the next message`);
  }
  return parts.length ? parts.join('; ') : null;
}
