// ui/public/mcp-run-picker.mjs
// New Pipeline › Advanced › Sets (MCP registry design §6.2, D16; skills registry design §4.5, §6
// board 7): the registry copies and the set skills a run on the selected target gets, from POST
// /api/mcp/preview, grouped by set and opted out per membership ('<setId>|<serverId>',
// '<setId>|<skillId>'). A skipped membership is a disabled row with its reason, never a checkbox,
// and never counted. Pure DOM; app.js owns the fetch and the opt-out state.

const keyOf = (m) => `${m.setId}|${m.serverId}`;
const skillKeyOf = (s) => `${s.setId}|${s.id}`;
const CHOICES = new Set(['off', 'needs-consent', 'opted-out', 'chat-off']);   // §5.7: the other skips read as problems

/** How a skipped membership reads in every MCP preview (this picker and Ask's, §5.7): its name — a
 *  `missing-server` skip has no copy name (its server left the catalog), so its id stands in — its reason,
 *  and whether it is a problem rather than a choice. A never-consented Team server reads "off — turn it
 *  on in the team checklist" (Appendix B 4). */
export function mcpSkipView(s) {
  return {
    name: s.copy ?? s.serverId,
    why: s.reason === 'needs-consent' && s.why ? `off — ${s.why}` : (s.why || s.reason),
    problem: !CHOICES.has(s.reason),
  };
}

/**
 * Run detail › Overview (skills registry §6 board 9): the set skills a run got, from its `skillMount`
 * record (the run page: state frames; History: run.json) — the names agents call, the skipped ones with
 * their reasons, a blocked layer's line, and that personal Claude Code skills load too (F4). null
 * without a record. Styled as the Overview's memory card (no new styles).
 */
export function renderRunSkills(mount, { doc = globalThis.document } = {}) {
  if (!mount || typeof mount !== 'object') return null;
  const plugins = Array.isArray(mount.plugins) ? mount.plugins : [];
  const skipped = Array.isArray(mount.skipped) ? mount.skipped : [];
  const blocked = mount.layer?.blocked || null;
  const root = doc.createElement('div');
  root.className = 'hd-ov-mem hd-ov-skills';
  const line = (cls, text) => {
    const d = doc.createElement('div');
    d.className = cls;
    d.textContent = text;
    root.append(d);
  };
  line('hd-ov-label', 'SKILLS FROM SETS');
  // Another engine records the names its `.agents/skills` mount gave them (`rel`, `names`); Claude's are `<plugin>:<skill>`.
  const names = Array.isArray(mount.names) ? mount.names
    : plugins.flatMap((p) => (Array.isArray(p.skills) ? p.skills : []).map((s) => `${p.pluginName}:${s}`));
  if (blocked) line('hint hd-ov-skills-blocked', `skills from sets not loaded: ${mount.layer.text || blocked}`);
  else if (names.length) line('mono hd-ov-skills-names', names.join(', '));
  if (skipped.length) line('hint hd-ov-skills-skipped', `skipped: ${skipped.map((s) => `${s.qualifiedName ?? s.name} (${s.setName} — ${s.why || s.reason})`).join(', ')}`);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // A run on another engine with no `.agents/skills` mount gets no skill from a folder at all: no note.
  if (blocked !== 'engine-no-skill-mount') line('hint', blocked ? 'Your personal Claude Code skills still load.'
    : mount.rel ? `${plural(names.length, 'set skill')} in ${mount.rel} · plus your project and personal skills`
    : `${plural(names.length, 'set skill')} in ${plural(plugins.length, 'plugin')} · plus your personal Claude Code skills`);
  return root;
}

/** A startable copy's note — §4.4 provisional name, §5.6 withheld tools (it starts either way); '' when none. */
export function mcpCopyNote(preview, c) {
  const tools = (preview.skippedTools || []).filter((t) => t.name === c.name).map((t) => t.reason);
  return [c.provisional && 'name provisional', ...tools].filter(Boolean).join(' · ');
}

/** A skipped set skill's row: the name agents would call (`qualifiedName`, else `<plugin>:<name>`), its reason (a
 *  never-consented Team skill reads "off — …"), and whether it is a problem rather than a choice (§4.2 skip reasons). */
export function skillSkipView(s) {
  return {
    name: s.qualifiedName ?? (s.pluginName ? `${s.pluginName}:${s.name}` : s.name),
    why: s.reason === 'needs-consent' && s.why ? `off — ${s.why}` : (s.why || s.reason),
    problem: !CHOICES.has(s.reason),
  };
}

/** "N of M servers · K of L skills": M / L = memberships that would start, N / K = those not opted out
 *  (K = 0 while the layer is blocked). Without a startable set skill: "N of M MCP servers", as before. */
export function mcpRunsLabel(preview, optOut) {
  const off = new Set(optOut);
  const m = preview.copies.length;
  const n = preview.copies.filter((c) => !off.has(keyOf(c))).length;
  const skills = preview.skills?.mounted || [];
  if (!skills.length) return `${n} of ${m} MCP server${m === 1 ? '' : 's'}`;
  const l = skills.length;
  const k = preview.skills.layer?.blocked ? 0 : skills.filter((s) => !off.has(skillKeyOf(s))).length;
  return `${n} of ${m} server${m === 1 ? '' : 's'} · ${k} of ${l} skill${l === 1 ? '' : 's'}`;
}

/**
 * The popover body. `onToggle(keys, on)` gets the membership keys a click switched on or off.
 * `projectName(key)` (workspace targets) names the member projects that bring each set.
 */
export function renderMcpRunsPop(preview, optOut, { doc = globalThis.document, projectName = null, onToggle }) {
  const off = new Set(optOut);
  const root = doc.createElement('div');
  root.className = 'mcp-runs-pop';
  const box = (checked, keys, kind) => {
    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    // app.js puts the focus back on this box after a re-render, found by keys and kind: a set with
    // one startable membership has a set box and a row box with the same keys.
    input.dataset.keys = keys.join(' ');
    input.dataset.kind = kind;
    input.addEventListener('change', () => onToggle(keys, input.checked));
    return input;
  };
  const row = (name, lead, why, cls = '') => {
    const r = doc.createElement('label');
    r.className = `mcp-runs-row${cls}`;
    const n = doc.createElement('span');
    n.className = 'mono';
    n.textContent = name;
    r.append(...(lead ? [lead, n] : [n]));
    if (why) {
      const h = doc.createElement('span');
      h.className = 'hint';
      h.textContent = why;
      r.append(h);
    }
    root.append(r);
  };
  // Skills registry §4.1: a blocked layer (managed settings, or a claude without --plugin-dir) loads no
  // set skill on this machine — one muted line, no skill rows.
  const blocked = preview.skills?.layer?.blocked || null;
  if (blocked) {
    const line = doc.createElement('div');
    line.className = 'mcp-runs-row is-skipped mcp-runs-blocked';
    line.textContent = `skills from sets not loaded: ${preview.skills.layer.text || blocked}`;
    root.append(line);
  }
  const skillsOn = !blocked && preview.skills ? preview.skills : { mounted: [], skipped: [] };
  for (const set of preview.sets) {
    const startable = preview.copies.filter((c) => c.setId === set.id);
    const skipped = preview.skipped.filter((s) => s.setId === set.id && s.reason !== 'opted-out');
    const skills = (skillsOn.mounted || []).filter((s) => s.setId === set.id);
    const skippedSkills = (skillsOn.skipped || []).filter((s) => s.setId === set.id && s.reason !== 'opted-out');
    if (!startable.length && !skipped.length && !skills.length && !skippedSkills.length) continue;
    const keys = [...startable.map(keyOf), ...skills.map(skillKeyOf)];
    const on = keys.filter((k) => !off.has(k)).length;
    const head = doc.createElement('label');
    head.className = 'mcp-runs-set';
    const setBox = box(keys.length > 0 && on === keys.length, keys, 'set');
    setBox.indeterminate = on > 0 && on < keys.length;
    setBox.disabled = !keys.length;
    const projects = projectName ? set.routes.map((r) => projectName(r.project)) : [];
    head.append(setBox, doc.createTextNode(projects.length ? `${set.name} · ${projects.join(', ')}` : set.name));
    root.append(head);
    for (const c of startable) row(c.copy, box(!off.has(keyOf(c)), [keyOf(c)], 'row'), mcpCopyNote(preview, c));
    for (const s of skipped) {
      const v = mcpSkipView(s);
      row(v.name, null, v.why, ` is-skipped${v.problem ? ' is-problem' : ''}`);
    }
    // On another engine the name its `.agents/skills` would give it (`agentName`), else the one Claude's agents call.
    for (const s of skills) row(s.agentName || s.qualifiedName, box(!off.has(skillKeyOf(s)), [skillKeyOf(s)], 'row'), '', ' is-skill');
    for (const s of skippedSkills) {
      const v = skillSkipView(s);
      row(v.name, null, v.why, ` is-skill is-skipped${v.problem ? ' is-problem' : ''}`);
    }
  }
  return root;
}
