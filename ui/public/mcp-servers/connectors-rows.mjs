// ui/public/mcp-servers/connectors-rows.mjs — the Connectors page's painters: the set rail and head, the member rows of
// a set, the Servers and Skills tab rows and the SKILL.md sheet body. Every row is one `.drow.cx-row` of a
// `.card.drows` (design-system.css); state is `.mdl-st`, chips are `.mk-chip-*`. The controller's helpers arrive in `ctx`
// ({ st, now, stateText, skillStateText, skillCountsText, hasShellScripts, hooksText, mcpRoute }) so this module holds no state.
import { icon } from '../icons.mjs';
import { relTime } from '../plugins-view.mjs';
import { chip, glyphTile } from '../marketplace/kinds.mjs';
import { emptyLine, renderLoadError } from './connectors-shell.mjs';

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function button(doc, cls, label, data = {}) {
  const b = h(doc, 'button', cls, label);
  b.type = 'button';
  Object.assign(b.dataset, data);
  return b;
}
export const addBtn = (doc, label, data) => { const b = button(doc, 'btn btn-sm', label, data); b.prepend(icon(doc, 'plus', 14)); return b; };
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;
const TONE = { ok: 'ok', warn: 'need', err: 'fail', '': 'off' };
/** One dot and one word. `testing…` is a "need" state. */
export function stateWord(doc, { text, tone }) {
  return h(doc, 'span', `mdl-st ${text === 'testing…' ? 'need' : TONE[tone] || 'off'}`, text);
}

/** Every button of a row gets the key a repaint (and a layer's focus return) finds it by. */
function keyButtons(root, prefix) {
  for (const b of root.querySelectorAll('button')) {
    const k = Object.keys(b.dataset).find((x) => x !== 'focusKey');
    if (k && !b.dataset.focusKey) b.dataset.focusKey = `${prefix}:${k}:${b.dataset[k]}`;
  }
}

export function usedByText(s) {
  if (s.group === 'general') return `Chat · ${s.usedBy.length} project${s.usedBy.length === 1 ? '' : 's'}`;
  if (s.greyed) return `no project here follows ${s.home}`;
  return s.usedBy.length ? s.usedBy.map((p) => p.name).join(', ') : 'no projects';
}

// ── the Sets rail ───────────────────────────────────────────────────────────────────────────────────
function facet(doc, s, on, tab) {
  const b = button(doc, `mk-facet${s.greyed ? ' cx-greyed' : ''}`, null, { set: s.id });
  b.dataset.focusKey = `set:${s.id}`;
  b.setAttribute('aria-pressed', String(on));
  b.tabIndex = tab ? 0 : -1;
  const name = h(doc, 'span', 'mk-facet-name');
  name.appendChild(h(doc, 'span', 'mk-facet-label', s.name));
  if (s.group === 'general') name.appendChild(chip(doc, 'n', 'Built-in'));
  const sub = `${plural(s.serverCount, 'server')}${s.skillCount ? ` · ${plural(s.skillCount, 'skill')}` : ''} · ${usedByText(s)}`;
  const text = h(doc, 'span', 'cx-facet-text');
  text.append(name, h(doc, 'span', 'mk-meta', sub));
  b.appendChild(text);
  if (s.problem) {
    const dot = h(doc, 'span', 'mk-facet-dot cx-dot-warn');
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', 'Has a problem');
    b.appendChild(dot);
  }
  return b;
}
export function renderSetRail(doc, { sets, setId, q = '' }) {
  const rail = h(doc, 'div', 'mk-rail cx-rail');
  rail.setAttribute('role', 'group');
  rail.setAttribute('aria-label', 'Sets');
  const find = h(doc, 'div', 'mk-search');
  const inp = h(doc, 'input', 'input');
  Object.assign(inp, { id: 'cx-set-find', type: 'search', placeholder: 'Find a set', value: q });
  inp.setAttribute('aria-label', 'Find a set');
  find.appendChild(inp);
  rail.appendChild(find);
  const needle = q.trim().toLowerCase();
  const shown = (sets || []).filter((s) => !needle || s.name.toLowerCase().includes(needle) || s.id === setId);
  const user = shown.filter((s) => s.group !== 'team');
  const team = shown.filter((s) => s.group === 'team');
  const pick = shown.find((s) => s.id === setId) || shown[0];
  for (const s of user) rail.appendChild(facet(doc, s, s.id === setId, pick === s));
  if (team.length) {
    rail.appendChild(h(doc, 'div', 'mk-rail-sep'));
    rail.appendChild(h(doc, 'div', 'mk-rail-label', 'Team sets'));
    for (const s of team) rail.appendChild(facet(doc, s, s.id === setId, pick === s));
  }
  return rail;
}

// ── the set head ────────────────────────────────────────────────────────────────────────────────────
function prefixLine(doc, set) {
  const p = h(doc, 'p', 'mk-meta');
  if (!set.renamedPlugin) { p.append('Skills load as ', h(doc, 'code', 'mono', `${set.pluginName}:`)); return p; }
  p.append(chip(doc, 'warn', `loads as ${set.pluginName}:`),
    ` because a Claude Code plugin named ${set.pluginName.replace(/-set(?:-\d+)?$/, '')} is installed`);
  return p;
}
export function renderSetHead(doc, ctx, view) {
  const { set } = view;
  const user = set.group === 'set';
  const card = h(doc, 'section', 'card cx-set-head');
  const main = h(doc, 'div', 'cx-main');
  const line = h(doc, 'div', 'cx-line');
  line.appendChild(h(doc, 'h2', 'subpage-title', set.name));
  if (set.group === 'team') line.appendChild(chip(doc, 'n', 'Team policy'));
  main.appendChild(line);
  if (set.pluginName && !set.greyed) main.appendChild(prefixLine(doc, set));
  if (set.group === 'team') main.appendChild(h(doc, 'p', 'mk-meta', `Required by ${set.home}${set.usedBy.length ? ` · Used by ${set.usedBy.map((p) => p.name).join(', ')}` : ''}`));
  const acts = h(doc, 'div', 'cx-acts');
  if (user) acts.appendChild(button(doc, 'btn btn-sm', 'Rename', { act: 'rename' }));
  if (!set.greyed) acts.appendChild(button(doc, 'btn btn-sm', 'Duplicate', { act: 'duplicate' }));
  if (user) acts.appendChild(button(doc, 'btn btn-sm', 'Delete', { act: 'delete' }));
  if (set.greyed) acts.appendChild(button(doc, 'btn btn-sm', 'Forget', { act: 'forget' }));
  card.append(main, acts);
  if (set.greyed) {
    card.appendChild(h(doc, 'p', 'mk-meta cx-wide', `No project here follows ${set.home}. Forget drops this Team set's values, secrets and test results.`));
    keyButtons(card, `head:${set.id}`);
    return card;
  }
  const used = h(doc, 'div', 'mcp-usedby cx-wide');
  used.appendChild(h(doc, 'span', 'label', 'Used by'));
  for (const p of set.usedBy) {
    const c = h(doc, 'span', 'chip', p.name);
    if (set.group !== 'team') {
      const x = button(doc, 'btn btn-sm btn-quiet btn-icon mcp-x', null, { unassign: p.key });
      x.append(icon(doc, 'x', 12));
      x.title = set.group === 'general' ? `Turn Include General off for ${p.name}` : `Remove ${set.name} from ${p.name}`;
      x.setAttribute('aria-label', x.title);
      c.appendChild(x);
    }
    used.appendChild(c);
  }
  if (set.group === 'general') used.appendChild(h(doc, 'span', 'chip', 'Chat'));
  if (set.group !== 'team') used.appendChild(addBtn(doc, 'Add project', { act: 'add-project' }));
  card.appendChild(used);
  keyButtons(card, `head:${set.id}`);
  return card;
}

// ── a server member of a set ────────────────────────────────────────────────────────────────────────
let foldSeq = 0;
function kv(doc, label, valueEl) {
  const frag = doc.createDocumentFragment();
  frag.append(h(doc, 'dt', '', label));
  const dd = h(doc, 'dd');
  dd.appendChild(valueEl);
  frag.appendChild(dd);
  return frag;
}
function fieldEntries(doc, ctx, set, m, dl) {
  const team = set.group === 'team';
  for (const f of m.fields) {
    let value;
    if (f.secret) {
      value = h(doc, 'div', 'mcp-secret');
      if (f.state.set) {
        value.appendChild(h(doc, 'span', 'mono', f.state.env ? `$${f.state.env}` : '••••••••'));
        if (f.oauth) value.appendChild(chip(doc, 'n', 'OAuth'));
        value.appendChild(chip(doc, f.state.old ? 'warn' : 'n', `set · updated ${relTime(f.state.updatedAt, ctx.now())}`));
        value.appendChild(button(doc, 'btn btn-sm', 'Replace', { secret: f.key, server: m.serverId }));
      } else {
        value.appendChild(h(doc, 'span', 'hint err', 'not set'));
        value.appendChild(button(doc, 'btn btn-primary btn-sm', 'Set', { secret: f.key, server: m.serverId }));
      }
    } else {
      value = h(doc, 'input', 'input mono');
      Object.assign(value, { type: 'text', value: f.value, placeholder: f.default || '' });
      value.dataset.field = f.key;
      value.dataset.server = m.serverId;
      value.dataset.saved = f.value;   // what the set holds: a change or a focusout saves only a different value
      value.setAttribute('aria-label', f.label);
    }
    dl.appendChild(kv(doc, f.label, value));
    const tip = team && m.team.suggests.find((x) => x.key === f.key);
    if (tip) {
      const note = h(doc, 'small', 'hint mcp-suggest', `Team suggests ${tip.value} · `);
      note.appendChild(button(doc, 'btn btn-sm btn-quiet', 'Use team value', { useTeam: f.key, server: m.serverId, value: tip.value }));
      dl.appendChild(kv(doc, '', note));
    }
  }
}
export function renderMemberRow(doc, ctx, set, m) {
  const team = set.group === 'team';
  const locked = team && !m.team.consented;
  const row = h(doc, 'div', 'drow cx-row');
  row.setAttribute('role', 'listitem');
  row.dataset.server = m.serverId;
  row.dataset.focusKey = `row:${set.id}:${m.serverId}`;
  const sw = h(doc, 'label', 'pl-enable');
  const cb = h(doc, 'input', 'sw-input');
  cb.type = 'checkbox';
  cb.checked = m.enabled;
  cb.dataset.toggle = m.serverId;
  cb.disabled = locked;
  cb.setAttribute('aria-label', `Use ${m.copy} in ${set.name}`);
  sw.append(cb, h(doc, 'span', 'switch'));
  if (locked) sw.appendChild(h(doc, 'span', 'switch-why', 'Allow it in Connectors first'));
  const main = h(doc, 'div', 'cx-main');
  const line = h(doc, 'div', 'cx-line');
  line.appendChild(h(doc, 'span', 'cx-title mono', m.copy));
  if (m.provisional) line.appendChild(chip(doc, 'warn', 'name provisional'));
  line.appendChild(chip(doc, 'n', m.sourceLabel));
  main.append(line, h(doc, 'p', 'mk-meta', [m.sourceLabel, m.type, m.description].filter(Boolean).join(' · ')));
  if (locked) main.appendChild(h(doc, 'p', 'mk-meta', 'Turn on in the team checklist'));
  const state = locked ? h(doc, 'span', 'mdl-st need', 'Needs your consent')
    : stateWord(doc, ctx.stateText({ ...m, testing: ctx.st.testing.has(`${set.id}|${m.serverId}`) }, ctx.now()));
  const acts = h(doc, 'div', 'drow-control cx-acts');
  const test = button(doc, 'btn btn-sm', 'Test', { test: m.serverId });
  test.disabled = locked;
  acts.appendChild(test);
  if (m.fields.some((f) => f.secret && !f.state.set)) acts.appendChild(button(doc, 'btn btn-sm', 'Set token', { secret: m.fields.find((f) => f.secret && !f.state.set).key, server: m.serverId }));
  if (!team) acts.appendChild(button(doc, 'btn btn-sm', 'Remove', { remove: m.serverId }));
  const foldKey = `${set.id}|${m.serverId}`;
  const open = ctx.st.open.has(foldKey) ? ctx.st.open.get(foldKey) : !!m.problem;
  const id = `cx-fold-${++foldSeq}`;
  const toggle = button(doc, 'btn btn-sm btn-quiet btn-icon', null, { fold: foldKey });
  toggle.append(icon(doc, 'chevron-down', 16));
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-controls', id);
  toggle.setAttribute('aria-label', `Show ${m.copy} values`);
  acts.appendChild(toggle);
  const fold = h(doc, 'div', 'cx-fold');
  fold.id = id;
  fold.hidden = !open;
  const dl = h(doc, 'dl', 'cx-kv');
  dl.appendChild(kv(doc, 'Name in runs', h(doc, 'code', 'mono', m.copy)));
  fieldEntries(doc, ctx, set, m, dl);
  fold.appendChild(dl);
  row.append(sw, glyphTile(doc, 'plug', 'mcp', { size: 'sm' }), main, state, acts, fold);
  keyButtons(row, `${set.id}:${m.serverId}`);
  return row;
}

// ── a skill member of a set ─────────────────────────────────────────────────────────────────────────
function sourceChip(doc, x) {
  return chip(doc, 'n', x.sourceLabel || (x.source === 'plugin' ? x.plugin : 'Imported'));
}
export function renderSkillMemberRow(doc, ctx, set, m) {
  const team = set.group === 'team';
  const row = h(doc, 'div', 'drow cx-row');
  row.setAttribute('role', 'listitem');
  row.dataset.skill = m.skillId;
  row.dataset.focusKey = `row:${set.id}:skill:${m.skillId}`;
  const missing = m.reason === 'missing-skill';
  const consented = !!(m.team && m.team.consented);
  const sw = h(doc, 'label', 'pl-enable');
  const cb = h(doc, 'input', 'sw-input');
  cb.type = 'checkbox';
  cb.checked = !!m.enabled;
  cb.dataset.skillToggle = m.skillId;
  cb.disabled = missing || (team && !consented);
  cb.setAttribute('aria-label', `Use ${m.qualifiedName} in ${set.name}`);
  sw.append(cb, h(doc, 'span', 'switch'));
  if (!missing && team && !consented) sw.appendChild(h(doc, 'span', 'switch-why', 'Allow it in Connectors first'));
  const main = h(doc, 'div', 'cx-main');
  const line = h(doc, 'div', 'cx-line');
  line.append(h(doc, 'span', 'cx-title mono', m.qualifiedName));
  if (m.hooks) line.appendChild(chip(doc, 'bad', 'Declares hooks'));
  if (!missing && ctx.hasShellScripts(m)) line.appendChild(chip(doc, 'warn', 'Shell scripts (may not run on Windows)'));
  line.appendChild(sourceChip(doc, m));
  main.appendChild(line);
  main.appendChild(h(doc, 'p', 'mk-meta', [m.description, missing ? '' : ctx.skillCountsText(m)].filter(Boolean).join(' · ')));
  if (m.hooks) main.appendChild(h(doc, 'p', 'mk-meta cx-warn', ctx.hooksText.replace(/^declares hooks — /, 'It declares hooks — ')));
  const acts = h(doc, 'div', 'drow-control cx-acts');
  if (!missing) acts.appendChild(button(doc, 'btn btn-sm', 'View SKILL.md', { skillMd: m.skillId }));
  if (!team) acts.appendChild(button(doc, 'btn btn-sm', 'Remove', { skillRemove: m.skillId }));
  row.append(sw, glyphTile(doc, 'skill', 'skill', { size: 'sm' }), main, stateWord(doc, ctx.skillStateText(m)), acts);
  keyButtons(row, `${set.id}:${m.skillId}`);
  return row;
}

/** One section of a set's detail: a title line (with its Add button), then one `.card.drows` or an empty line. */
export function renderSection(doc, { title, hint, add, rows, empty, label }) {
  const sec = h(doc, 'section', 'cx-section');
  const head = h(doc, 'div', 'cx-sec-head');
  head.appendChild(h(doc, 'h3', 'subsection-title', title));
  if (hint) head.appendChild(h(doc, 'span', 'mk-meta', hint));
  if (add) head.appendChild(add);
  sec.appendChild(head);
  if (!rows.length) { sec.appendChild(emptyLine(doc, empty)); return sec; }
  const list = h(doc, 'div', 'card drows cx-list');
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', label);
  list.append(...rows);
  sec.appendChild(list);
  return sec;
}

// ── the Servers and Skills tabs ─────────────────────────────────────────────────────────────────────
function setLinks(doc, ctx, inSets) {
  const box = h(doc, 'div', 'cx-sets');
  if (!inSets.length) { box.appendChild(h(doc, 'span', 'mk-meta', 'Not in a set')); return box; }
  box.appendChild(h(doc, 'span', 'mk-meta', 'In'));
  for (const x of inSets) {
    const a = h(doc, 'a', 'badge', x.name);
    a.href = `#${ctx.mcpRoute(x.id)}`;
    box.appendChild(a);
  }
  return box;
}
export function renderServerRow(doc, ctx, s) {
  const row = h(doc, 'div', 'drow cx-row');
  row.setAttribute('role', 'listitem');
  row.tabIndex = -1;
  row.dataset.server = s.id;
  row.dataset.focusKey = `row:server:${s.id}`;
  const main = h(doc, 'div', 'cx-main');
  const line = h(doc, 'div', 'cx-line');
  line.appendChild(h(doc, 'span', 'cx-title mono', s.base));
  for (const [on, text] of [[s.provisional, 'name provisional'], [s.pluginDisabled, 'plugin disabled'],
    [s.inClaudeConfig, 'Also in your Claude Code config'], [s.retired, `No longer required by ${s.retired}`]]) {
    if (on) line.appendChild(chip(doc, 'warn', text));
  }
  if (s.source === 'plugin') line.appendChild(chip(doc, 'n', s.sourceLabel));
  main.append(line, h(doc, 'p', 'mk-meta', [s.sourceLabel, s.type, s.description].filter(Boolean).join(' · ')));
  const tools = h(doc, 'span', 'mk-meta cx-tools', s.tools == null ? '— tools' : plural(s.tools, 'tool'));
  const acts = h(doc, 'div', 'drow-control cx-acts');
  acts.appendChild(button(doc, 'btn btn-sm', 'Add to set', { addTo: s.id }));
  if (s.source === 'manual') acts.appendChild(button(doc, 'btn btn-sm', 'Edit definition', { edit: s.id }));
  if (s.source === 'manual' || s.retired) acts.appendChild(button(doc, 'btn btn-sm', 'Remove', { removeServer: s.id }));
  const cells = [glyphTile(doc, 'plug', 'mcp', { size: 'sm' }), main, setLinks(doc, ctx, s.inSets)];
  if (s.needsSetup) cells.push(h(doc, 'span', 'mdl-st need', 'Needs setup'));
  row.append(...cells, tools, acts);
  keyButtons(row, `server:${s.id}`);
  return row;
}

export function originText(e) {
  if (e.source === 'plugin') return e.code === 'linked' ? 'linked' : e.code ? `@ ${e.code}` : '';
  const o = e.origin;
  if (!o) return 'pasted';
  return o.kind === 'git' ? `git · ${o.ref || 'default branch'}` : o.kind === 'home' ? 'from your Claude Code skills' : 'folder';
}
export function renderSkillRow(doc, ctx, e) {
  const row = h(doc, 'div', 'drow cx-row');
  row.setAttribute('role', 'listitem');
  row.tabIndex = -1;
  row.dataset.skill = e.id;
  row.dataset.focusKey = `row:skill:${e.id}`;
  const pluginRoot = !!(e.frontmatter && e.frontmatter.pluginRootRefs);
  const hooks = !!(e.frontmatter && e.frontmatter.hooks);
  const main = h(doc, 'div', 'cx-main');
  const line = h(doc, 'div', 'cx-line');
  line.appendChild(h(doc, 'span', 'cx-title mono', e.name));
  if (e.updateAvailable) line.appendChild(chip(doc, 'upd', 'Update available'));
  if (hooks) line.appendChild(chip(doc, 'bad', 'Declares hooks'));
  if (e.valid === false) line.appendChild(chip(doc, 'bad', 'Invalid'));
  for (const [on, text] of [[e.pluginEnabled === false, 'plugin disabled'],
    [ctx.hasShellScripts(e), 'shell scripts (may not run on Windows)'], [pluginRoot, 'plugin-root refs']]) {
    if (on) line.appendChild(chip(doc, 'warn', text));
  }
  line.appendChild(sourceChip(doc, e));
  main.append(line, h(doc, 'p', 'mk-meta', [originText(e), e.description, ctx.skillCountsText(e)].filter(Boolean).join(' · ')));
  if (e.valid === false) main.appendChild(h(doc, 'p', 'mk-meta cx-warn', `invalid: ${(e.problems || []).join('; ')} · never mounted`));
  if (pluginRoot) main.appendChild(h(doc, 'p', 'mk-meta cx-warn', 'references its plugin’s other files, so it may not work from a set'));
  if (hooks) main.appendChild(h(doc, 'p', 'mk-meta cx-warn', ctx.hooksText));
  const acts = h(doc, 'div', 'drow-control cx-acts');
  const add = button(doc, 'btn btn-sm', 'Add to set', { skillAddTo: e.id });
  add.disabled = e.valid === false;
  acts.appendChild(add);
  if (e.source === 'library' && e.origin) {
    acts.appendChild(e.updateAvailable ? button(doc, 'btn btn-primary btn-sm', 'Review update', { skillUpdate: e.id })
      : button(doc, 'btn btn-sm', 'Check for updates', { skillUpdate: e.id }));
  }
  acts.appendChild(button(doc, 'btn btn-sm', 'View SKILL.md', { skillMd: e.id }));
  if (e.source === 'library') acts.appendChild(button(doc, 'btn btn-sm', 'Remove', { skillDelete: e.id }));
  row.append(glyphTile(doc, 'skill', 'skill', { size: 'sm' }), main, setLinks(doc, ctx, e.inSets || []), acts);
  keyButtons(row, `skill:${e.id}`);
  return row;
}

/** The SKILL.md sheet's body (the title is the sheet's own): origin line, facts, then the file. `got` is undefined
 *  while loading, `{ text }` or `{ error }` after. */
export function renderSkillSheetBody(doc, ctx, x, got) {
  const body = h(doc, 'div', 'cx-sheet-body');
  body.appendChild(h(doc, 'p', 'mk-meta', `${originText(x) || (x.source === 'plugin' ? `ships with ${x.plugin || x.sourceLabel}` : 'Imported')} · read-only`));
  const dl = h(doc, 'dl', 'cx-kv');
  const sets = x.inSets || [];
  dl.appendChild(kv(doc, 'In sets', h(doc, 'span', '', sets.length ? sets.map((q) => q.name).join(', ') : 'Not in a set')));
  if (typeof x.files === 'number' || x.scripts != null) dl.appendChild(kv(doc, 'Files', h(doc, 'span', '', ctx.skillCountsText(x))));
  if (x.qualifiedName) dl.appendChild(kv(doc, 'Called as', h(doc, 'code', 'mono', `/${x.qualifiedName}`)));
  body.appendChild(dl);
  const file = h(doc, 'section', 'cx-file');
  if (!got) {
    const p = emptyLine(doc, 'Loading SKILL.md…');
    p.setAttribute('aria-busy', 'true');
    file.appendChild(p);
  } else if (got.error) file.appendChild(renderLoadError(doc, { what: 'SKILL.md', cause: /[.!]$/.test(got.error) ? got.error : `${got.error}.`, retryAct: 'retry-md' }));
  else file.appendChild(h(doc, 'pre', 'code-block cx-md', got.text));
  body.appendChild(file);
  return body;
}
