// src/core/agent-capabilities.mjs
// FEAT-1: what one agent receives, given its selection and what the run provides. Pure — callers pass the resolver outputs.
export const toolId = (copy, tool) => `mcp__${copy}__${String(tool).replace(/[^A-Za-z0-9_-]/g, '_')}`; // same rule as registry.mjs held-back names

const WHY = {
  'opted-out': 'turned off for this run', off: 'turned off', 'plugin-disabled': 'its plugin is turned off',
  'missing-server': 'no longer installed', 'missing-skill': 'no longer installed', 'needs-consent': 'not turned on yet',
  'invalid-skill': 'not usable', cap: 'over the run limit', 'name-taken': 'name already in use', untested: 'not tested yet',
};
const HELD_WHY = { unapproved: 'not approved in Claude Code yet', disabled: 'turned off in Claude Code' };   // heldCommittedMcp verdicts
const why = (reason) => WHY[reason] ?? reason ?? 'not provided by this run';
const heldWhy = (r) => (String(r).startsWith('tool-name-too-long') ? 'name too long' : r);
const teamIds = (sets) => new Set((sets ?? []).filter((s) => s.group === 'team').map((s) => s.id));
const tail = (id) => String(id).split('/').pop().split(':').pop();
const byServer = (rows) => [...new Map(rows.map((r) => [r.server, r])).values()];

/**
 * @param {{ access?: {mcpAccess?:object[], skillAccess?:object[]}, mcp?: object, skills?: object,
 *           native?: Array<{name:string, raw:string, eligible:boolean}>, notProvided?: Record<string,string>,
 *           engine?: string, permissionMode?: string }} o
 *   `native` = the servers the run PROVIDES outside the registry: effective name, raw `.mcp.json`/local-scope name, and whether the catalog
 *   could list it. Harness: derived from `mcpServerGrants` (the run's own truth, so old-CLI degradation and the approval filter are honoured); `eligible` = the raw name is an APPROVED catalog row (a provided server the catalog did not offer is never denied). run-check: the approved catalog rows.
 *   `notProvided` = reasons for chosen `native:` ids the run does not provide (e.g. not approved), used in the warning line.
 * @returns {{ enforced:boolean, note?:string, grants?:string[], disallowed?:string[], skillKeep?:object[],
 *            record:{servers:object[],skills:object[],requiredServers:object[],requiredSkills:object[],emptyServers:boolean,emptySkills:boolean}, missing:object[] }}
 *   `grants` / `disallowed` / `skillKeep` are ABSENT when the category has no selection: the run's own lists apply untouched.
 */
export function planAgentCapabilities({ access = {}, mcp = {}, skills = {}, native = [], notProvided = {}, engine = 'claude', permissionMode }) {
  const sel = access.mcpAccess ?? [], selSkills = access.skillAccess ?? [];
  const missing = [];
  const copies = mcp.copies ?? [];
  const teamSets = teamIds(mcp.sets), teamSk = teamIds(skills.sets);
  const required = new Set(copies.filter((c) => teamSets.has(c.setId)).map((c) => c.serverId));
  const mounted = skills.mounted ?? [];
  const plan = { enforced: engine === 'claude', missing,
    record: {
      servers: [], skills: [], emptyServers: !sel.length, emptySkills: !selSkills.length,
      requiredServers: byServer(copies.filter((c) => required.has(c.serverId)).map((c) => ({ server: c.serverId, name: c.name, toolNames: c.tools ?? null }))),
      requiredSkills: mounted.filter((m) => teamSk.has(m.setId)).map((m) => ({ skill: m.id, name: m.qualifiedName })),
    } };

  if (sel.length) {
    const byId = new Map(sel.map((e) => [e.server, e]));
    const grants = [], disallowed = [];
    for (const c of copies) {
      const pick = byId.get(c.serverId), req = required.has(c.serverId);
      if (!pick && !req) { disallowed.push(`mcp__${c.name}`); continue; }
      const known = Array.isArray(c.tools) ? c.tools : null;
      const held = new Set((mcp.skippedTools ?? []).filter((t) => t.name === c.name).map((t) => t.tool));
      if (req || pick.tools === 'all') {
        const excluded = req ? [] : pick.excludedTools ?? [];
        grants.push(`mcp__${c.name}`);                                   // wildcard: tools added later flow in (A-1)
        for (const t of excluded) disallowed.push(toolId(c.name, t));    // deny outranks the wildcard allow
        plan.record.servers.push({ server: c.serverId, name: c.name, tools: 'all', excluded,
          toolNames: known && known.filter((t) => !held.has(t) && !excluded.includes(t)), required: req });
        continue;
      }
      const give = pick.tools.filter((t) => !held.has(t) && (!known || known.includes(t)));
      for (const t of give) grants.push(toolId(c.name, t));
      for (const t of known ?? []) if (!give.includes(t)) disallowed.push(toolId(c.name, t));
      if (!known && permissionMode === 'bypassPermissions') {
        plan.note = 'permission mode bypassPermissions: tools of a chosen server that were never listed are not blocked';
      }
      plan.record.servers.push({ server: c.serverId, name: c.name, tools: give, required: false });
      for (const t of pick.tools.filter((x) => !give.includes(x))) {
        missing.push({ kind: 'tool', id: `${c.serverId}/${t}`, label: `${t} of ${pick.name ?? c.name}`,
          reason: held.has(t) ? 'held back: name too long' : 'no longer on the server' });
      }
    }
    // Servers the run loads outside the registry: chosen -> granted whole; eligible (choosable) and unchosen -> denied;
    // not choosable -> passed through, so nobody loses a server they had no way to pick.
    const nativeIds = new Set();
    for (const n of native) {
      const id = `native:${n.raw}`;
      if (!n.eligible) { grants.push(`mcp__${n.name}`); continue; }
      nativeIds.add(id);
      if (byId.has(id)) {
        grants.push(`mcp__${n.name}`);
        plan.record.servers.push({ server: id, name: n.name, tools: 'all', toolNames: null, required: false });
      } else disallowed.push(`mcp__${n.name}`);
    }
    for (const e of sel) {
      if (copies.some((c) => c.serverId === e.server) || nativeIds.has(e.server)) continue;
      const sk = (mcp.skipped ?? []).find((s) => s.serverId === e.server);
      missing.push({ kind: 'server', id: e.server, label: e.name ?? sk?.copy ?? tail(e.server), reason: why(sk?.reason ?? notProvided[e.server]) });
    }
    plan.grants = [...new Set(grants)];
    plan.disallowed = [...new Set(disallowed)].sort();
  }

  if (selSkills.length) {
    const want = new Map(selSkills.map((s) => [s.skill, s]));
    plan.skillKeep = mounted.filter((m) => want.has(m.id) || teamSk.has(m.setId));
    plan.record.skills = plan.skillKeep.map((m) => ({ skill: m.id, name: m.qualifiedName, required: teamSk.has(m.setId) }));
    for (const s of selSkills) {
      if (mounted.some((m) => m.id === s.skill)) continue;
      const sk = (skills.skipped ?? []).find((x) => x.skillId === s.skill);
      missing.push({ kind: 'skill', id: s.skill, label: s.name ?? sk?.name ?? tail(s.skill), reason: why(sk?.reason) });
    }
  }
  // Other engines (cycle-2 #2): the selection is RECORDED but nothing is applied, so no list may leave the plan — _execCtx then
  // hands the node the run-wide lists untouched.
  if (!plan.enforced) { delete plan.grants; delete plan.disallowed; delete plan.skillKeep; }
  return plan;
}

/** One line per missing item (A-10: Unavailable items are included) + one when the engine cannot enforce. */
export function warningLines(plan, agentName) {
  const lines = plan.missing.map((m) => `Agent "${agentName}": ${m.kind} ${m.label} is not available — ${m.reason}`);
  if (!plan.enforced && (!plan.record.emptyServers || !plan.record.emptySkills)) {
    lines.push(`Agent "${agentName}": its servers and skills are recorded but this engine applies them run-wide`);
  }
  if (plan.note) lines.push(`Agent "${agentName}": ${plan.note}`);
  return lines;
}

/** Plans for a set of agent nodes at once: Map<nodeId, plan>. EVERY node is planned (an empty selection still reports team-required items). */
export function planRunAgentCapabilities({ nodes, mcp, skills, native, notProvided, engine, permissionMode }) {
  return new Map(nodes.map((n) => [n.id, planAgentCapabilities({ access: n.access ?? {}, mcp, skills, native, notProvided, engine, permissionMode })]));
}

/** The picker's input for one target: choosable rows (grouped Project, Team, Personal) + why other things are not choosable. */
export function buildCapabilityCatalog({ mcp = {}, skills = {}, native = [] }) {
  const RANK = { set: 0, team: 1, general: 2 }, LABEL = { team: 'team', set: 'project', general: 'personal' };
  const groupOf = (sets, id) => (sets ?? []).find((s) => s.id === id)?.group ?? 'general';
  const held = new Map();
  for (const t of mcp.skippedTools ?? []) (held.get(t.name) ?? held.set(t.name, new Map()).get(t.name)).set(t.tool, heldWhy(t.reason));
  const teamSets = teamIds(mcp.sets);
  const servers = new Map();
  for (const c of mcp.copies ?? []) {
    const g = groupOf(mcp.sets, c.setId), cur = servers.get(c.serverId);
    const tools = Array.isArray(c.tools) ? c.tools.map((name) => ({ name, heldBack: held.get(c.name)?.get(name) ?? null })) : null;
    if (cur && RANK[cur.g] <= RANK[g]) continue;
    servers.set(c.serverId, { id: c.serverId, name: c.copy, group: LABEL[g], g, setName: c.setName, required: teamSets.has(c.setId) || !!cur?.required, tools });
  }
  for (const n of native) {
    const g = n.group === 'personal' ? 'general' : 'set', id = `native:${n.name}`;
    if (n.approval !== 'approved') continue;                             // a committed-identical server the run drops (cycle-2 #6): listed under `unavailable` below
    if (!servers.has(id)) servers.set(id, { id, name: n.name, group: LABEL[g], g, required: false, tools: null, native: true });
  }
  const teamSk = teamIds(skills.sets);
  const sk = new Map();
  for (const m of skills.mounted ?? []) {
    const g = groupOf(skills.sets, m.setId), cur = sk.get(m.id);
    if (cur && RANK[cur.g] <= RANK[g]) continue;
    sk.set(m.id, { id: m.id, name: m.name, group: LABEL[g], g, setName: m.setName, required: teamSk.has(m.setId) || !!cur?.required, description: m.description ?? '' });
  }
  const strip = ({ g, ...r }) => r;
  const order = (a, b) => RANK[a.g] - RANK[b.g] || a.name.localeCompare(b.name);
  const unavailable = { servers: {}, skills: {} };
  for (const s of mcp.skipped ?? []) if (!servers.has(s.serverId)) unavailable.servers[s.serverId] = why(s.reason);
  for (const n of native) if (n.approval !== 'approved') unavailable.servers[`native:${n.name}`] = HELD_WHY[n.approval] ?? HELD_WHY.unapproved;
  for (const s of skills.skipped ?? []) if (!sk.has(s.skillId)) unavailable.skills[s.skillId] = why(s.reason);
  return { servers: [...servers.values()].sort(order).map(strip), skills: [...sk.values()].sort(order).map(strip), unavailable };
}

/** Tool names per server from the stored Test results (ok results only; later results win). Project-independent on purpose:
 *  the library has no project, and "new tools" is a property of the server. */
export function knownToolsByServer(tests = {}) {
  const out = new Map();
  for (const [key, t] of Object.entries(tests).sort(([, a], [, b]) => String(a.at).localeCompare(String(b.at)))) {
    if (!t?.ok || !Array.isArray(t.tools)) continue;
    out.set(key.slice(key.indexOf('|') + 1), t.tools.map(String));
  }
  return out;
}
