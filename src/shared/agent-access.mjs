// An agent's capability selection (FEAT-1): pure helpers shared by the store normalizers, the editor and the run planner.
const SERVER_ID = /^(plugin|manual|policy|native):[^\s|]{1,200}$/;
const SKILL_ID = /^skill:(plugin|library):[^\s|]{1,200}$/;
const MAX_SERVERS = 50, MAX_TOOLS = 500, MAX_SKILLS = 100;
const text = (v, n = 120) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const uniq = (list, max) => [...new Set((Array.isArray(list) ? list : []).filter((t) => typeof t === 'string' && t.trim() && t.length <= 200))].slice(0, max);

/** @returns {Array<{server:string,name?:string,tools:'all'|string[],reviewedTools?:string[],excludedTools?:string[]}>} ([] when none) */
export function readMcpAccess(raw, warn = () => {}) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) { warn('mcpAccess must be an array; ignored'); return []; }
  const out = [];
  for (const e of raw.slice(0, MAX_SERVERS)) {
    const server = text(e?.server, 220);
    if (!SERVER_ID.test(server) || out.some((o) => o.server === server)) { warn(`mcpAccess entry ignored: ${JSON.stringify(e?.server)}`); continue; }
    const entry = { server, tools: e.tools === 'all' ? 'all' : uniq(e.tools, MAX_TOOLS) };
    if (text(e.name)) entry.name = text(e.name);
    if (entry.tools === 'all') {
      if (Array.isArray(e.reviewedTools)) entry.reviewedTools = uniq(e.reviewedTools, MAX_TOOLS);
      const ex = uniq(e.excludedTools, MAX_TOOLS);
      if (ex.length) entry.excludedTools = ex;
    }
    out.push(entry);
  }
  return out;
}

/** @returns {Array<{skill:string,name?:string}>} */
export function readSkillAccess(raw, warn = () => {}) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) { warn('skillAccess must be an array; ignored'); return []; }
  const out = [];
  for (const e of raw.slice(0, MAX_SKILLS)) {
    const skill = text(e?.skill, 220);
    if (!SKILL_ID.test(skill) || out.some((o) => o.skill === skill)) { warn(`skillAccess entry ignored: ${JSON.stringify(e?.skill)}`); continue; }
    out.push(text(e.name) ? { skill, name: text(e.name) } : { skill });
  }
  return out;
}

/** The selection part of an agent's meta; `{}` when nothing is chosen. */
export const pickAccess = (meta) => ({
  ...(meta?.mcpAccess?.length ? { mcpAccess: meta.mcpAccess } : {}),
  ...(meta?.skillAccess?.length ? { skillAccess: meta.skillAccess } : {}),
});

// Reducers return a NEW access object; an empty category is removed (absent == "everything the run provides").
const put = (access, key, list) => {
  const next = { ...access };
  if (list.length) next[key] = list; else delete next[key];
  return next;
};
const servers = (a) => a?.mcpAccess ?? [];
const setEntry = (a, id, fn) => put(a, 'mcpAccess', servers(a).map((e) => (e.server === id ? fn(e) : e)));
const head = (e) => ({ server: e.server, ...(e.name ? { name: e.name } : {}) });

export function toggleServer(access, id, { name, known } = {}) {
  if (servers(access).some((e) => e.server === id)) return removeServer(access, id);
  const entry = { server: id, ...(name ? { name } : {}), tools: 'all', ...(Array.isArray(known) ? { reviewedTools: [...known] } : {}) };
  return put(access, 'mcpAccess', [...servers(access), entry]);
}
export const removeServer = (access, id) => put(access, 'mcpAccess', servers(access).filter((e) => e.server !== id));
/** Back to "All tools": exclusions cleared, everything known is reviewed. */
export const setAllTools = (access, id, known) =>
  setEntry(access, id, (e) => ({ ...head(e), tools: 'all', ...(Array.isArray(known) ? { reviewedTools: [...known] } : {}) }));
/** "Selected tools": an explicit list = the known tools minus the exclusions (the only way to leave 'all'). */
export const selectTools = (access, id, known = []) =>
  setEntry(access, id, (e) => {
    const ex = e.tools === 'all' ? e.excludedTools ?? [] : [];
    return { ...head(e), tools: e.tools === 'all' ? known.filter((t) => !ex.includes(t)) : e.tools };
  });
/** Tick/untick one tool. On an 'all' entry this edits `excludedTools` (the entry stays 'all') and counts as reviewing it. */
export function toggleTool(access, id, tool) {
  return setEntry(access, id, (e) => {
    if (e.tools !== 'all') return { ...e, tools: e.tools.includes(tool) ? e.tools.filter((t) => t !== tool) : [...e.tools, tool] };
    const ex = new Set(e.excludedTools ?? []);
    if (!ex.delete(tool)) ex.add(tool);
    const next = { ...e };
    if (ex.size) next.excludedTools = [...ex]; else delete next.excludedTools;
    if (e.reviewedTools) next.reviewedTools = [...new Set([...e.reviewedTools, tool])];
    return next;
  });
}
export const keepTools = (access, id, tools) =>
  setEntry(access, id, (e) => (e.tools === 'all' && e.reviewedTools ? { ...e, reviewedTools: [...new Set([...e.reviewedTools, ...tools])] } : e));
/** Give every 'all' entry that has no baseline yet the tools currently known for its server (`known`: Map<serverId, string[]>). */
export const stampBaseline = (access, known) =>
  put(access, 'mcpAccess', servers(access).map((e) => (e.tools === 'all' && !e.reviewedTools && known.get(e.server) ? { ...e, reviewedTools: [...known.get(e.server)] } : e)));
export function toggleSkill(access, id, name) {
  const list = access?.skillAccess ?? [];
  return put(access, 'skillAccess', list.some((s) => s.skill === id) ? list.filter((s) => s.skill !== id) : [...list, name ? { skill: id, name } : { skill: id }]);
}

/** Known tools of an 'all' entry that the user has neither kept nor unticked yet (A-1, A-7). No baseline ⇒ none. */
export function unreviewedTools(entry, known) {
  if (entry?.tools !== 'all' || !Array.isArray(known) || !Array.isArray(entry.reviewedTools)) return [];
  const seen = new Set([...entry.reviewedTools, ...(entry.excludedTools ?? [])]);
  return known.filter((t) => !seen.has(t));
}

/** "2 servers · all tools + 3 tools · 1 skill" — the one-line summary used by the library, the card and the canvas. */
export function accessSummary(access) {
  const s = servers(access), k = access?.skillAccess ?? [];
  const n = (c, w) => `${c} ${w}${c === 1 ? '' : 's'}`;
  const parts = [];
  if (s.length) {
    parts.push(n(s.length, 'server'));
    const all = s.some((e) => e.tools === 'all');
    const listed = s.reduce((a, e) => a + (e.tools === 'all' ? 0 : e.tools.length), 0);
    parts.push(all ? (listed ? `all tools + ${n(listed, 'tool')}` : 'all tools') : n(listed, 'tool'));
  }
  if (k.length) parts.push(n(k.length, 'skill'));
  return parts.join(' · ');
}
