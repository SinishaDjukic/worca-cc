// ui/public/agent-capabilities-view.mjs
// FEAT-1: the agent editor's "MCP servers" and "Skills" pickers and the run-details card of what each agent got.
// Pure DOM, `{ doc }` injected, every string via textContent. All edit logic lives in the shared reducers.
import { toggleServer, removeServer, setAllTools, selectTools, toggleTool, keepTools, toggleSkill, unreviewedTools, accessSummary } from '../../src/shared/agent-access.mjs';

/** Rows for the picker: the catalog's choosable items, plus every SELECTED item the catalog no longer offers (Unavailable). */
export function pickerModel({ catalog, access }) {
  const sel = new Map((access.mcpAccess ?? []).map((e) => [e.server, e]));
  const rows = catalog.servers.map((s) => {
    const e = sel.get(s.id);
    const known = s.tools ? s.tools.map((t) => t.name) : null;
    const fresh = e ? unreviewedTools(e, known) : [];
    const on = (t) => s.required || (!!e && !t.heldBack && (e.tools === 'all' ? !(e.excludedTools ?? []).includes(t.name) : e.tools.includes(t.name)));
    return {
      id: s.id, name: s.name, group: s.group, required: s.required, native: !!s.native,
      selected: !!e || s.required, locked: s.required,
      mode: s.required ? 'all' : !e ? null : e.tools === 'all' ? 'all' : 'some',   // m12: a required server renders a locked "All tools"
      toolsKnown: !!known,
      tools: (s.tools ?? []).map((t) => ({ name: t.name, heldBack: t.heldBack, checked: on(t), isNew: fresh.includes(t.name), disabled: !!t.heldBack || s.required })),
      // explicit tools the server no longer lists stay visible as Unavailable (R-po-19)
      goneTools: e && e.tools !== 'all' && known ? e.tools.filter((t) => !known.includes(t)) : [],
    };
  });
  const gone = [...sel.values()].filter((e) => !catalog.servers.some((s) => s.id === e.server))
    .map((e) => ({ id: e.server, name: e.name ?? e.server, reason: catalog.unavailable.servers[e.server] ?? 'not available here' }));
  const have = new Set((access.skillAccess ?? []).map((s) => s.skill));
  const skills = catalog.skills.map((s) => ({ ...s, selected: have.has(s.id) || s.required, locked: s.required }));
  const goneSkills = (access.skillAccess ?? []).filter((s) => !catalog.skills.some((c) => c.id === s.skill))
    .map((s) => ({ id: s.skill, name: s.name ?? s.skill, reason: catalog.unavailable.skills[s.skill] ?? 'not available here' }));
  return { servers: rows, goneServers: gone, skills, goneSkills };
}

const GROUPS = [['project', 'Project'], ['team', 'Team'], ['personal', 'Personal']];
const REQUIRED = 'Required by team';

function builder(doc) {
  return (tag, cls, txt, attrs) => {
    const el = doc.createElement(tag);
    if (cls) el.className = cls;
    if (txt !== undefined) el.textContent = txt;
    for (const [k, v] of Object.entries(attrs ?? {})) el.setAttribute(k, v);
    return el;
  };
}

/** Renders the 'MCP servers' and 'Skills' sections; `onChange(nextAccess)` after every edit. */
export function renderCapabilityPicker({ doc, catalog, access, onChange }) {
  const h = builder(doc);
  const model = pickerModel({ catalog, access });
  const root = h('div', 'cap-picker');

  const check = (checked, disabled, label, on, data = {}) => {
    const wrap = h('label', 'cap-check');
    const box = h('input');
    box.type = 'checkbox';
    box.checked = checked;
    box.disabled = disabled;
    Object.assign(box.dataset, data);
    box.addEventListener('change', on);
    wrap.append(box, h('span', 'cap-name', label));
    return { wrap, box };
  };
  const gone = (name, reason, onRemove) => {
    const r = h('div', 'cap-row cap-gone');
    const rm = h('button', 'btn ghost sm cap-remove', 'Remove', { type: 'button' });
    rm.addEventListener('click', onRemove);
    r.append(h('span', 'cap-name', name), h('span', 'badge grey', 'Unavailable'), h('span', 'hint', reason), rm);
    return r;
  };
  const group = (items, build) => {
    const frag = [];
    for (const [key, label] of GROUPS) {
      const rows = items.filter((i) => i.group === key);
      if (!rows.length) continue;
      const g = h('div', 'cap-group');
      g.append(h('div', 'cap-group-head', label), ...rows.map(build));
      frag.push(g);
    }
    return frag;
  };
  const section = (title, access2, note) => {
    const s = h('section', 'cap-section');
    s.append(h('h4', 'cap-title', title), h('div', 'hint cap-summary', accessSummary(access2) || 'Everything the run provides'));
    if (note) s.append(h('div', 'hint cap-note', note));
    return s;
  };

  const toolList = (r, srv) => {
    const known = r.tools.map((t) => t.name);
    const box = h('div', 'cap-tools');
    const seg = h('div', 'seg');
    const mode = (label, on, fn, disabled) => {
      const b = h('button', null, label, { type: 'button', 'aria-pressed': String(on) });
      b.disabled = !!disabled;
      b.addEventListener('click', fn);
      seg.append(b);
    };
    const only = r.locked || r.native || !r.toolsKnown;
    mode('All tools', r.mode === 'all', () => onChange(setAllTools(access, r.id, r.toolsKnown ? known : undefined)), only);
    if (!only) mode('Selected tools', r.mode === 'some', () => onChange(selectTools(access, r.id, known)));
    box.append(seg);
    if (r.native) box.append(h('div', 'hint', "Tools of this server can't be listed here"));
    else if (!r.toolsKnown) box.append(h('div', 'hint', 'Tools not loaded yet — run Test in MCP settings'));
    else if (!r.tools.length) box.append(h('div', 'hint', 'No tools'));
    const fresh = r.tools.filter((t) => t.isNew);
    if (fresh.length) {
      const keepAll = h('button', 'btn ghost sm', 'Keep all new', { type: 'button' });
      keepAll.addEventListener('click', () => onChange(keepTools(access, r.id, fresh.map((t) => t.name))));
      box.append(keepAll);
    }
    for (const t of r.tools) {
      const row = h('div', 'cap-row cap-tool');
      row.append(check(t.checked, t.disabled, t.name, () => onChange(toggleTool(access, r.id, t.name)), { id: r.id, tool: t.name }).wrap);
      if (t.heldBack) row.append(h('span', 'hint', t.heldBack));
      if (t.isNew) {
        row.append(h('span', 'badge amber', 'New — needs review'));
        const keep = h('button', 'btn ghost sm', 'Keep', { type: 'button' });
        keep.addEventListener('click', () => onChange(keepTools(access, r.id, [t.name])));
        row.append(keep);
      }
      box.append(row);
    }
    for (const name of r.goneTools) box.append(gone(name, 'not offered by this server any more', () => onChange(toggleTool(access, r.id, name))));
    return box;
  };

  const servers = section('MCP servers', { mcpAccess: access.mcpAccess }, '.mcp.json servers of the project root stay available to every agent.');
  servers.append(...group(model.servers, (r) => {
    const src = catalog.servers.find((s) => s.id === r.id);
    const wrap = h('div', 'cap-server');
    const head = h('div', 'cap-row');
    const known = src.tools ? src.tools.map((t) => t.name) : undefined;
    const { wrap: c } = check(r.selected, r.locked, r.name, () => onChange(toggleServer(access, r.id, { name: r.name, known })), { id: r.id });
    head.append(c);
    if (r.required) head.append(h('span', 'badge slate', REQUIRED));
    wrap.append(head);
    if (r.selected) wrap.append(toolList(r));
    return wrap;
  }));
  for (const g of model.goneServers) servers.append(gone(g.name, g.reason, () => onChange(removeServer(access, g.id))));

  const skills = section('Skills', { skillAccess: access.skillAccess },
    'Skills from .claude/skills, ~/.claude/skills and installed plugins stay available to every agent; this list only limits skills from skill sets.');
  skills.append(...group(model.skills, (s) => {
    const row = h('div', 'cap-row');
    row.append(check(s.selected, s.locked, s.name, () => onChange(toggleSkill(access, s.id, s.name)), { id: s.id }).wrap);
    if (s.required) row.append(h('span', 'badge slate', REQUIRED));
    return row;
  }));
  for (const g of model.goneSkills) skills.append(gone(g.name, g.reason, () => onChange(toggleSkill(access, g.id))));

  root.append(servers, skills,
    h('div', 'hint cap-foot', 'Changes apply to every workflow that uses this agent, from its next run.'),
    h('div', 'hint cap-foot', "A run's own models can hold back more tools; the start dialog warns about those."));
  return root;
}

/**
 * Run details › the capabilities each agent got, from `state.agentCapabilities` / run.json
 * ({ [nodeId]: { agent, servers, skills, requiredServers, requiredSkills, emptyServers, emptySkills, missing, enforced, note? } }).
 * null when no agent has a selection and no team-required item exists.
 */
export function renderRunAgentCapabilities(map, { doc = globalThis.document } = {}) {
  const h = builder(doc);
  // run.json nests the planner record ({ agent, record, missing, enforced, note }); state frames carry it flat.
  const flat = (r) => (r.record ? { agent: r.agent, ...r.record, missing: r.missing, enforced: r.enforced, note: r.note } : r);
  const nodes = Object.entries(map ?? {}).filter(([, r]) => r && typeof r === 'object').map(([id, r]) => [id, flat(r)]);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const shown = nodes.filter(([, r]) => arr(r.servers).length || arr(r.skills).length || arr(r.requiredServers).length || arr(r.requiredSkills).length);
  if (!shown.length) return null;
  const root = h('div', 'hd-ov-mem hd-ov-caps');
  root.append(h('div', 'hd-ov-label', 'AGENT CAPABILITIES'));
  for (const [id, r] of shown) {
    const box = h('div', 'cap-run-agent');
    box.append(h('div', 'cap-run-name', r.agent ?? id));
    const line = (label, items) => {
      const row = h('div', 'cap-run-line');
      row.append(h('span', 'hint', label));
      for (const it of items) {
        const part = h('span', 'cap-run-item');
        part.append(h('span', 'mono', it.text));
        if (it.required) part.append(h('span', 'badge slate', REQUIRED));
        row.append(part);
      }
      box.append(row);
    };
    // toolNames holds what the server delivered, so a new tool still flagged for review is listed (R-po-16).
    const names = (s) => (Array.isArray(s.toolNames) ? s.toolNames.join(', ') : '');
    const toolsText = (s) => {
      if (s.tools !== 'all') return names(s) || 'No tools';
      const head = arr(s.excluded).length ? `All tools except ${s.excluded.join(', ')}` : 'All tools';
      return names(s) ? `${head}: ${names(s)}` : head;
    };
    const chosenS = arr(r.servers).map((s) => ({ text: `${s.name ?? s.server}: ${s.required ? names(s) || 'All tools' : toolsText(s)}`, required: s.required }));
    const reqS = arr(r.requiredServers).filter((q) => !arr(r.servers).some((s) => s.server === (q.server ?? q.id))).map((q) => ({ text: names(q) ? `${q.name ?? q.server ?? q.id}: ${names(q)}` : q.name ?? q.server ?? q.id, required: true }));
    line('Servers', r.emptyServers ? [{ text: 'Everything the run provides' }, ...reqS] : [...chosenS, ...reqS]);
    const chosenK = arr(r.skills).map((s) => ({ text: s.name ?? s.skill, required: s.required }));
    const reqK = arr(r.requiredSkills).filter((q) => !arr(r.skills).some((s) => s.skill === (q.skill ?? q.id))).map((q) => ({ text: q.name ?? q.skill ?? q.id, required: true }));
    line('Skills', r.emptySkills ? [{ text: 'Everything the run provides' }, ...reqK] : [...chosenK, ...reqK]);
    if (arr(r.missing).length) line('Not available', arr(r.missing).map((m) => {
      const what = String(m.label ?? m.name ?? m.id);
      const why = m.reason ?? m.why;
      return { text: why ? `${what} (${why})` : what };
    }));
    if (r.note) box.append(h('div', 'hint cap-run-note', r.note));
    else if (r.enforced === false) box.append(h('div', 'hint cap-run-note', 'applied run-wide'));
    else if (r.enforced) box.append(h('div', 'hint cap-run-note', 'Enforced via Claude permissions'));
    root.append(box);
  }
  return root;
}
