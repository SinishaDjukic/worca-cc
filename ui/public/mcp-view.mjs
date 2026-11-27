// ui/public/mcp-view.mjs
// The Connectors page (docs/mcp-servers.md, docs/skills.md): the Sets view (configure), the Servers and
// Skills views (read-only catalogs), the member cards and Add server — plus the project Sets tab, the workspace
// overview card and the Settings › Ask Worca block. The manual definition form is mcp-definition-form.mjs.
// Every write goes through `api(method, path, body)` and repaints from the server's read models; no
// secret value is ever fetched. The modal shells (#plugin-modal, confirm) are app.js's, passed in.
import { icon } from './icons.mjs';
import { addVaultNote } from './settings/secret-vault-note.mjs';
import { relTime } from './plugins-view.mjs';
import { compileDefinition, formFromDefinition, blankDefinitionForm, createDefinitionForm } from './mcp-definition-form.mjs';
import { splitMessage } from './feedback.mjs';
import { openSkillImport, inspectionSummary, consentNode } from './skill-import.mjs';
import { openMcpImport } from './mcp-server-import.mjs';
import { chip } from './marketplace/kinds.mjs';
import { openMenu } from './workflows/menu.mjs';
import { renderTabs, renderHead, renderToolbar, renderLoadError, renderEmpty, emptyLine, moveInList, sourceOptions,
  filterServers, serverChipCounts, serverSource, filterSkills, skillChipCounts, skillSource } from './mcp-servers/connectors-shell.mjs';
import { addBtn, renderSetRail, renderSetHead, renderMemberRow, renderSkillMemberRow, renderSection, renderServerRow, renderSkillRow,
  renderSkillSheetBody } from './mcp-servers/connectors-rows.mjs';

const enc = encodeURIComponent;
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

// ── routes: #connectors (General), #connectors/sets/<id>, #connectors/servers, #connectors/skills ──
// The Skills view has its own constant: a set may be named "Skills", and mcpRoute('skills') is that set.
export const MCP_SKILLS_ROUTE = 'connectors/skills';
export function parseMcpParam(sub = '') {
  if (sub === 'servers') return { view: 'servers', setId: null };
  if (sub.startsWith('servers/') && sub.length > 8) {
    let server = sub.slice(8);
    try { server = decodeURIComponent(server); } catch { /* a malformed %-escape reads as typed: no row matches it */ }
    return { view: 'servers', setId: null, server };
  }
  if (sub === 'skills') return { view: 'skills', setId: null };
  if (sub.startsWith('sets/') && sub.length > 5) {
    let setId = sub.slice(5);
    try { setId = decodeURIComponent(setId); } catch { /* a malformed %-escape reads as typed: the set GET refuses it (400), show() never throws */ }
    return { view: 'sets', setId };
  }
  return { view: 'sets', setId: 'general' };
}
export function mcpRoute(setId) {
  if (setId === null) return 'connectors/servers';
  return setId === 'general' ? 'connectors' : `connectors/sets/${enc(setId)}`;
}

// The team-requirements strip (docs/team-policy.md) is filled by team-policy code: fn(el) after each render.
let stripRenderer = null;
export function setMcpStripRenderer(fn) { stripRenderer = fn; }

/** A member card's state line (spec §7.1). */
export function memberStateText(m, now = Date.now()) {
  if (m.testing) return { text: 'testing…', tone: '' };
  if (m.problem) return { text: m.reason.startsWith('missing:') ? `${m.problem} · skipped until set` : m.problem, tone: 'err' };
  if (m.reason === 'off' || m.reason === 'needs-consent') return { text: 'off', tone: '' };
  if (!m.test) return { text: 'not tested', tone: '' };
  if (!m.test.ok) return { text: m.test.error === 'token rejected' ? 'token rejected' : `test failed: ${m.test.error}`, tone: 'err' };
  if (m.test.stale) return { text: 'stale · test again', tone: 'warn' };
  if (m.tooLong) return { text: `tool too long for ${m.tooLong.limit}: ${m.tooLong.tool}`, tone: 'warn' };
  return { text: `${m.test.tools} tools · tested ${relTime(m.test.at, now)}`, tone: 'ok' };
}

// ── skills (docs/skills.md) ─────────────────────────────────────────────────────────────────────────
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;
/** "4 files · 1 script · 2 shell blocks" for a catalog skill or a set's skill card; files only when known (spec §6.2). */
export function skillCountsText(x) {
  const scripts = Array.isArray(x.scripts) ? x.scripts.length : Number(x.scripts) || 0;
  return [...(typeof x.files === 'number' ? [plural(x.files, 'file')] : []), plural(scripts, 'script'),
    plural(Number(x.shellBlocks) || 0, 'shell block')].join(' · ');
}
/** A skill whose frontmatter declares hooks (user decision U1: shown, never refused). The words of P1's SKILL_HOOKS_TEXT
 *  (src/core/skills-registry/texts.mjs), which a ui/public module cannot import: test/ui-skills-view.test.mjs keeps them equal. */
export const SKILL_HOOKS_TEXT = "declares hooks — they run shell commands outside Worca's guardrails when the skill is used";
/** A POSIX shell script in the skill: badged "shell scripts — Windows" (spec §5 Isolation). */
export const hasShellScripts = (x) => Array.isArray(x.scripts) && x.scripts.some((p) => /\.sh$/i.test(String(p)));
/** A set's skill card state line (spec §6.2), in the server's reason order (views.mjs skillReason, the order the "Skills
 *  in runs" tables show): no longer installed · plugin disabled · invalid · Team consent · off · plugin-root refs · in runs.
 *  A missing skill is `valid: false` with no problems, so it is checked before `valid`. */
export function skillStateText(m) {
  if (m.reason === 'missing-skill') return { text: m.problem || 'the skill is no longer installed', tone: 'err' };
  if (m.reason === 'plugin-disabled') return { text: 'plugin disabled', tone: 'warn' };
  if (m.valid === false) return { text: `invalid: ${(m.problems || []).join('; ') || 'see SKILL.md'}`, tone: 'err' };
  if (m.team && !m.team.consented) return { text: 'turn on in the team checklist', tone: '' };
  if (m.problem) return { text: m.problem, tone: 'err' };
  if (!m.enabled) return { text: 'off', tone: '' };
  if (m.pluginRootRefs) return { text: 'in runs · references its plugin’s other files, so it may not work from a set', tone: 'warn' };
  return { text: 'in runs', tone: 'ok' };
}

// ── field inputs for one membership (Add server; values and secrets of a set) ────────────────────
function fieldInputs(doc, fields) {
  const root = h(doc, 'div', 'mcp-fields');
  for (const f of fields) {
    const row = h(doc, 'div', 'field');
    row.appendChild(h(doc, 'label', '', f.label + (f.required ? '' : ' (optional)')));
    const inp = h(doc, 'input', 'input mono');
    inp.type = f.secret ? 'password' : 'text';
    inp.dataset.input = f.key;
    inp.dataset.secret = f.secret ? '1' : '';
    inp.value = '';   // empty keeps the definition's default, so a later default change still reaches this set
    inp.placeholder = f.secret ? '' : (f.default || '');
    inp.autocomplete = 'off';
    if (f.secret) addVaultNote(inp);   // "Stored in the secret vault." while it takes saves (secretVault)
    inp.setAttribute('aria-label', f.label);
    row.appendChild(inp);
    if (f.secret) {
      const env = h(doc, 'input', 'input mono');
      Object.assign(env, { type: 'text', placeholder: 'or read it from an MCP_… variable', autocomplete: 'off' });
      env.dataset.env = f.key;
      env.setAttribute('aria-label', `${f.label} variable`);
      row.appendChild(env);
    }
    root.appendChild(row);
  }
  return root;
}
/** Inputs → `{ values, secrets }`; an empty secret keeps what is stored. */
export function collectFieldInputs(root) {
  const values = {};
  const secrets = {};
  for (const i of root.querySelectorAll('[data-input]')) {
    const env = root.querySelector(`[data-env="${i.dataset.input}"]`);
    if (!i.dataset.secret) values[i.dataset.input] = i.value.trim();
    else if (env && env.value.trim()) secrets[i.dataset.input] = { $env: env.value.trim() };
    else if (i.value) secrets[i.dataset.input] = i.value;
  }
  return { values, secrets };
}

// ── the Connectors page controller ──────────────────────────────────────────────────────────────────
export function createMcpView({ host, api, navigate, confirm, modal, sheet = null, doc = globalThis.document, now = () => Date.now(), notify = null }) {
  const st = { view: 'sets', setId: 'general', sets: null, set: null, servers: null, skills: null, testing: new Set(), msg: '', msgKind: '',
    md: new Map(),   // SKILL.md: the text (or error) per skill id
    open: new Map(), loadErr: null,   // a server row's fold (`set|server` → open?); the list that could not be read
    filters: { servers: { q: '', chip: 'all', source: '' }, skills: { q: '', chip: 'all', source: '' }, sets: { q: '' } } };
  // #555: a result is a toast; 'err-inline' (what load() reports) stays on the page's .form-msg line.
  const say = (text, kind = '') => {
    if (kind && kind !== 'err-inline' && text && notify) { notify({ tone: kind, ...splitMessage(text) }); text = ''; kind = ''; }
    if (kind === 'err-inline') kind = 'err';
    st.msg = text; st.msgKind = kind;
    const el = host.querySelector('.form-msg');
    if (el) { el.textContent = text; el.className = `form-msg${kind ? ` ${kind}` : ''}`; }
  };
  const fail = (r) => say((r.data && r.data.error) || `HTTP ${r.status}`, 'err');
  const failInline = (r) => say((r.data && r.data.error) || `HTTP ${r.status}`, 'err-inline');
  const setPath = (id) => `/api/mcp/sets/${enc(id)}`;
  const isTeam = (set) => set.group === 'team';
  const memberPath = (id, serverId) => `${setPath(id)}/members/${enc(serverId)}`;
  const skillMemberPath = (id, skillId) => `/api/sets/${enc(id)}/skills/${enc(skillId)}`;   // spec §7: skill members live under /api/sets

  // Only the latest load paints: a slower answer for a set the user already left never lands (the
  // cards on screen, and so every write they make, always belong to the set they were painted from).
  let loadSeq = 0;
  async function load() {
    const seq = ++loadSeq;
    // Every view shows all three tab counts: the lists a view does not paint are read once and reused (D11).
    const fresh = (k) => st.view === k || !st[k];
    const [srv, skl, lst, one] = await Promise.all([
      fresh('servers') ? api('GET', '/api/mcp/servers') : null, fresh('skills') ? api('GET', '/api/skills') : null,
      st.view === 'sets' || !st.sets ? api('GET', '/api/mcp/sets') : null, st.view === 'sets' ? api('GET', setPath(st.setId)) : null]);
    if (seq !== loadSeq) return;
    st.loadErr = null;
    const errOf = (r) => `${(r.data && r.data.error) || `HTTP ${r.status}`}.`;
    if (srv) {
      if (srv.ok && Array.isArray(srv.data.servers)) st.servers = srv.data.servers; else if (st.view === 'servers') st.servers = [];
      if (st.view === 'servers') {
        if (!srv.ok) { failInline(srv); st.loadErr = { what: 'servers', cause: errOf(srv) }; }
        else if (srv.data.newer) say('MCP registry files need a newer Worca', 'err-inline');
      }
    }
    if (skl) {
      if (skl.ok && Array.isArray(skl.data.skills)) st.skills = skl.data.skills; else if (st.view === 'skills') st.skills = [];
      if (skl.ok) st.folderImports = skl.data.folderImports !== false;   // a hosted Worca imports from a git URL or a paste only
      if (st.view === 'skills') {
        const lib = (skl.ok && skl.data.library) || {};
        if (!skl.ok) { failInline(skl); st.loadErr = { what: 'skills', cause: errOf(skl) }; }
        else if (skl.data.newer) say('MCP registry files need a newer Worca', 'err-inline');
        else if (lib.newer || lib.damaged) {   // P1 reads no imported skill then: say why none is listed
          say(lib.newer ? 'The skill library needs a newer Worca: imported skills are not listed'
            : 'The skill library file skills/library.json is damaged (fix it or remove it): imported skills are not listed', 'err-inline');
        }
      }
    }
    if (lst) st.sets = lst.ok ? lst.data.sets : [];
    if (one) {
      st.set = one.ok ? one.data : null;
      if (!one.ok) failInline(one);
      else if (lst && lst.ok && lst.data.newer) say('MCP registry files need a newer Worca', 'err-inline');
    }
    paint();
  }

  const rctx = () => ({ st, now, stateText: memberStateText, skillStateText, skillCountsText, hasShellScripts,
    hooksText: SKILL_HOOKS_TEXT, mcpRoute });
  const counts = () => ({ sets: st.sets ? st.sets.length : undefined, servers: st.servers ? st.servers.length : undefined,
    skills: st.skills ? st.skills.length : undefined });

  function headActions() {
    if (st.view === 'sets') return [button(doc, 'btn btn-primary', 'New set', { act: 'new-set' })];
    if (st.view === 'servers') return [button(doc, 'btn', 'Import from other tools', { act: 'import-servers' }), button(doc, 'btn btn-primary', 'Add MCP server', { act: 'add-server' })];
    return [button(doc, 'btn btn-primary', 'Import skill', { act: 'import-skill' })];
  }

  function skillSection(set, skills) {
    const team = isTeam(set);
    return renderSection(doc, { title: 'Skills', label: `Skills in ${set.name}`,
      hint: `agents call /${set.pluginName || 'general'}:<name> · no values, no secrets, no Test`,
      add: team ? null : addBtn(doc, 'Add skill', { act: 'add-skill' }), rows: skills.map((m) => renderSkillMemberRow(doc, rctx(), set, m)),
      empty: team ? 'No skill this team policy requires is installed here. Its setup checklist lists what it requires.' : 'No skills in this set yet.' });
  }

  function setDetail() {
    const box = h(doc, 'div', 'cx-detail');
    if (!st.set) { box.appendChild(emptyLine(doc, 'No such set.')); return box; }
    const { set, members } = st.set;
    box.appendChild(renderSetHead(doc, rctx(), st.set));
    if (set.greyed) return box;
    box.appendChild(renderSection(doc, { title: 'Servers', label: `Servers in ${set.name}`,
      add: isTeam(set) ? null : addBtn(doc, 'Add server', { act: 'add-member' }),
      rows: members.map((m) => renderMemberRow(doc, rctx(), set, m)), empty: 'No servers in this set yet.' }));
    if (Array.isArray(st.set.skills)) box.appendChild(skillSection(set, st.set.skills));
    return box;
  }

  /** The Servers and Skills tabs: toolbar over one row list (Models Catalogue grammar); filters live in `st.filters`. */
  function catalogBody(kind) {
    const servers = kind === 'servers';
    const all = (servers ? st.servers : st.skills) || [];
    const body = h(doc, 'div', `cx-${kind}`);
    if (st.loadErr) { body.appendChild(renderLoadError(doc, st.loadErr)); return body; }
    if (!all.length) {
      body.appendChild(servers
        ? renderEmpty(doc, { title: 'No MCP servers yet', line: 'Add one by hand or import them from your other tools.', action: addBtn(doc, 'Add MCP server', { act: 'add-server' }) })
        : renderEmpty(doc, { title: 'No skills yet', line: 'Install a plugin that ships some, or import your own.', glyph: 'skill', tone: 'skill', action: addBtn(doc, 'Import skill', { act: 'import-skill' }) }));
      return body;
    }
    const f = st.filters[kind];
    const sourceOf = servers ? serverSource : skillSource;
    body.appendChild(renderToolbar(doc, { kind, filters: f, sources: sourceOptions(all, sourceOf),
      counts: (servers ? serverChipCounts : skillChipCounts)(all, f) }));
    const shown = (servers ? filterServers : filterSkills)(all, f);
    if (!shown.length) {
      const clear = button(doc, 'btn btn-sm', 'Clear filters', { act: 'clear-filters' });
      body.appendChild(emptyLine(doc, `No ${kind} match.`, clear));
      return body;
    }
    const list = h(doc, 'div', 'card drows cx-list');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', servers ? 'MCP servers' : 'Skills');
    list.append(...shown.map((x) => (servers ? renderServerRow : renderSkillRow)(doc, rctx(), x)));
    if (list.firstChild) list.firstChild.tabIndex = 0;
    body.appendChild(list);
    return body;
  }

  // ── skills: the read-only SKILL.md sheet (spec §6.2, §6.3) ──
  async function fetchMd(id) {
    const r = await api('GET', `/api/skills/${enc(id)}/skill-md`);
    st.md.set(id, r.ok ? { text: r.data.text } : { error: (r.data && r.data.error) || `HTTP ${r.status}` });
  }
  const skillEntry = (id) => (st.skills || []).find((x) => x.id === id) || ((st.set && st.set.skills) || []).find((x) => x.skillId === id);
  async function openMd(id) {
    const x = skillEntry(id);
    if (!x) return;
    const box = h(doc, 'div');
    const fill = () => box.replaceChildren(renderSkillSheetBody(doc, rctx(), x, st.md.get(id)));
    const read = async () => {
      st.md.delete(id);
      fill();
      await fetchMd(id);
      if (typeof layer().shows !== 'function' || layer().shows(box)) fill();
    };
    box.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-act="retry-md"]')) void read(); });   // the sheet is outside `host`
    const foot = [['Close', 'btn', () => layer().close()]];
    if (st.view === 'skills') {   // the catalog's own actions; a set's member row is read-only here
      if (x.source === 'library') foot.unshift(['Remove', 'btn btn-quiet btn-danger', () => { layer().close(); void removeSkillEntry(x); }]);
      if (x.source === 'library' && x.origin) foot.unshift(['Check for updates', 'btn', () => { layer().close(); void checkUpdate(id); }]);
      foot.unshift(['Add to set', 'btn', () => { layer().close(); addSkillTo(id); }]);
    }
    fill();
    layer().open(`${x.name || x.qualifiedName} · SKILL.md`, box, foot, { kind: 'viewer', width: 'lg' });
    if (!st.md.has(id) || st.md.get(id).error) await read();
  }
  const layer = () => sheet || modal;

  let painted = null;   // the view and set of the last paint: a kept input never crosses to another set
  const FOCUSABLE_KEYED = '[data-field], [data-toggle], [data-skill-toggle], [data-skill-md], [data-test], [data-cx-search], [data-cx-chip], [data-cx-source], #cx-set-find, [data-focus-key]';
  function keyOf(el) {
    const d = el.dataset;
    return d.field ? `f|${d.server}|${d.field}` : d.toggle ? `t|${d.toggle}` : d.skillToggle ? `s|${d.skillToggle}` : d.skillMd ? `m|${d.skillMd}`
      : d.test ? `b|${d.test}` : d.cxSearch != null ? `q|${d.cxSearch}` : d.cxChip ? `c|${d.cxChip}` : d.cxSource != null ? 'o|' : el.id === 'cx-set-find' ? 'rq'
        : d.focusKey ? `k|${d.focusKey}` : null;
  }
  function paint() {
    // Every save repaints the pane: the control the user is in (a field, a switch, the search box, a chip, a row button)
    // keeps its text, caret and focus, or the next keystrokes land nowhere and an unsaved value is wiped.
    const a = doc.activeElement;
    const where = `${st.view}|${st.set ? st.set.set.id : ''}`;
    const keep = where === painted && a && a !== doc.body && host.contains(a) ? { key: keyOf(a), value: a.value, from: a.selectionStart, to: a.selectionEnd } : null;
    const strip = h(doc, 'div', 'mcp-req-strip');
    strip.dataset.mcpStrip = '';
    strip.hidden = true;
    const msg = h(doc, 'p', `form-msg${st.msgKind ? ` ${st.msgKind}` : ''}`, st.msg);
    msg.setAttribute('aria-live', 'polite');
    const body = st.view === 'sets' ? h(doc, 'div', 'cx-sets-page mk-browse') : catalogBody(st.view);
    if (st.view === 'sets') body.append(renderSetRail(doc, { sets: st.sets || [], setId: st.set ? st.set.set.id : st.setId, q: st.filters.sets.q }), setDetail());
    const head = renderHead(doc, { tabs: renderTabs(doc, { view: st.view, counts: counts() }), actions: headActions() });
    host.replaceChildren(head, strip, msg, body);
    painted = where;
    const again = keep && keep.key && [...host.querySelectorAll(FOCUSABLE_KEYED)].find((x) => keyOf(x) === keep.key);
    if (again) {
      again.focus();
      if (keep.from != null && again.matches('input[type="text"], input[type="search"]')) { again.value = keep.value; again.setSelectionRange(keep.from, keep.to); }
    }
    if (stripRenderer) stripRenderer(strip);
  }

  // ── actions ──
  /** `msgEl`: a modal's own message line — an error behind the modal's scrim is never seen. */
  async function write(method, path, body, okText = '', msgEl = null) {
    const r = await api(method, path, body);
    if (!r.ok) {
      if (!msgEl) { fail(r); return null; }
      msgEl.textContent = (r.data && r.data.error) || `HTTP ${r.status}`;
      msgEl.className = 'form-msg err';
      return null;
    }
    say(okText, okText ? 'ok' : '');
    return r;
  }
  async function runTest(setId, serverId) {
    const key = `${setId}|${serverId}`;
    st.testing.add(key);
    paint();
    const r = await api('POST', `${memberPath(setId, serverId)}/test`);
    st.testing.delete(key);
    if (!r.ok) fail(r);
    await load();
  }

  function pickModal(title, label, options, onPick, extra = null) {
    const body = h(doc, 'div', 'field');
    body.appendChild(h(doc, 'label', '', label));
    const sel = h(doc, 'select', 'select');
    for (const o of options) {
      const opt = h(doc, 'option', '', o.label);
      opt.value = o.value;
      opt.disabled = !!o.disabled;
      sel.appendChild(opt);
    }
    body.appendChild(sel);
    const slot = h(doc, 'div');
    body.appendChild(slot);
    const msg = h(doc, 'p', 'form-msg');
    msg.setAttribute('aria-live', 'polite');
    body.appendChild(msg);
    const renderExtra = () => { if (extra) slot.replaceChildren(extra(sel.value)); };
    sel.addEventListener('change', renderExtra);
    const first = options.find((o) => !o.disabled);
    if (!first) {   // every choice is already there: an empty value would address no set or server
      body.replaceChildren(h(doc, 'p', 'hint', `${label}: every choice is already there.`));
      modal.open(title, body, [['Close', 'btn btn-sm', () => modal.close()]]);
      return;
    }
    sel.value = first.value;
    renderExtra();
    modal.open(title, body, [['Cancel', 'btn btn-sm', () => modal.close()], [onPick.label, 'btn btn-primary btn-sm', () => onPick.fn(sel.value, slot, msg)]]);
  }

  /** Add a server to a set: server (or set) picker, then that server's fields; Save and test. */
  async function addMember({ setId = null, serverId = null }) {
    const inSet = new Set(setId ? (st.set?.members || []).map((m) => m.serverId) : []);   // before the await
    const cat = ((await api('GET', '/api/mcp/servers')).data?.servers) || [];   // fresh: a plugin may have come or gone since
    const setName = (id) => (st.sets || []).find((s) => s.id === id)?.name || id;
    const extra = (pickServer) => {
      const s = cat.find((x) => x.id === (serverId || pickServer));
      if (!s) return h(doc, 'div');
      const wrap = h(doc, 'div');
      wrap.append(h(doc, 'small', 'hint', s.description), fieldInputs(doc, s.fields));
      return wrap;
    };
    const save = async (picked, slot, msg) => {
      const target = setId || picked;
      const server = serverId || picked;
      const { values, secrets } = collectFieldInputs(slot);
      const r = await write('PUT', memberPath(target, server), { enabled: true, values, secrets }, 'Server added', msg);
      if (!r) return;
      modal.close();
      st.setId = target;
      navigate(mcpRoute(target));
      await load();
      await runTest(target, server);
    };
    if (setId) {
      pickModal(`Add server to ${setName(setId)}`, 'Server',
        cat.map((s) => ({ value: s.id, label: `${s.base} · ${s.sourceLabel} · ${s.type}`, disabled: inSet.has(s.id) })),
        { label: 'Save and test', fn: save }, extra);
    } else {
      const s = cat.find((x) => x.id === serverId);
      const inSets = new Set((s?.inSets || []).map((x) => x.id));
      pickModal(`Add ${s ? s.base : 'server'} to a set`, 'Set',
        (st.sets || []).filter((x) => x.group !== 'team').map((x) => ({ value: x.id, label: x.name, disabled: inSets.has(x.id) })),
        { label: 'Save and test', fn: save }, () => extra(serverId));
    }
  }

  async function assignment(key) {
    const r = await api('GET', `/api/mcp/projects/${enc(key)}`);
    return r.ok ? r.data : null;
  }
  async function putAssignment(key, a, msgEl = null) {
    return write('PUT', `/api/mcp/projects/${enc(key)}`, { sets: a.sets.map((s) => s.id ?? s), includeGeneral: a.includeGeneral }, '', msgEl);
  }

  async function removeSkillEntry(e) {
    const leaves = (e.inSets || []).length ? ` It leaves ${e.inSets.map((x) => x.name).join(', ')}.` : '';
    const ok = await confirm({ title: `Remove ${e.name}?`, message: `Remove ${e.name} from worca?${leaves} Its files go from the library.`, confirmLabel: 'Remove', danger: true });
    if (ok && await write('DELETE', `/api/skills/${enc(e.id)}`, undefined, 'Skill removed')) { st.md.delete(e.id); await load(); }
  }

  async function onClick(e) {
    const tab = e.target.closest && e.target.closest('a[data-mcp-view]');
    if (tab && host.contains(tab)) {   // a plain click navigates in place; a modified one is the browser's link
      if (!e.button && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const v = tab.dataset.mcpView;
        navigate(v === 'servers' ? mcpRoute(null) : v === 'skills' ? MCP_SKILLS_ROUTE : mcpRoute(st.setId || 'general'));
      }
      return;
    }
    const b = e.target.closest && e.target.closest('button');
    if (!b || !host.contains(b)) return;
    if (b.dataset.more) { openMore(b); return; }
    return onAction(b.dataset, b);
  }

  /** The row's ⋯: each item carries the dataset its old button had, so it runs through onAction unchanged. */
  function openMore(b) {
    let items = [];
    try { items = JSON.parse(b.dataset.more); } catch { return; }
    b.setAttribute('aria-expanded', 'true');
    openMenu({ doc, anchor: b, align: 'end', label: b.getAttribute('aria-label') || 'More',
      items: items.map(([label, data, danger]) => ({ label, danger: !!danger, onSelect: () => { void onAction({ ...data }, b); } })) });
  }

  async function onAction(d, b) {
    // The set these cards were painted from, read before any await: Back/Forward while a prompt, a confirm or a
    // fetch is pending paints another set, and the answer must still act on this one.
    const cur = st.set ? st.set.set : null;
    if (d.fold) { st.open.set(d.fold, b.getAttribute('aria-expanded') !== 'true'); paint(); return; }
    if (d.cxChip) { st.filters[st.view].chip = d.cxChip; paint(); return; }
    if (d.act === 'retry') return load();
    if (d.act === 'clear-filters') {
      st.filters[st.view] = { q: '', chip: 'all', source: '' };
      paint();
      const box = host.querySelector('[data-cx-search]');
      if (box) box.focus();
      return;
    }
    if (d.skillMd) return openMd(d.skillMd);
    if (d.skillAddTo) return addSkillTo(d.skillAddTo);
    if (d.skillUpdate) return checkUpdate(d.skillUpdate);
    if (d.skillRemove) {
      const m = st.set.skills.find((x) => x.skillId === d.skillRemove);
      const ok = await confirm({ title: `Remove ${m.qualifiedName} from ${cur.name}?`, message: `Remove ${m.qualifiedName} from ${cur.name}? Runs and chats that use ${cur.name} stop getting it.`,
        keep: `${m.qualifiedName} stays in Skills and in other sets.`, confirmLabel: 'Remove', danger: true });
      if (ok && await write('DELETE', skillMemberPath(cur.id, d.skillRemove), undefined, 'Skill removed')) await load();
      return;
    }
    if (d.skillDelete) return removeSkillEntry(st.skills.find((x) => x.id === d.skillDelete));
    if (d.set) return navigate(mcpRoute(d.set));
    if (d.act === 'new-set') {
      const v = await promptName('New set', '');
      if (!v) return;
      const r = await write('POST', '/api/mcp/sets', { name: v });
      if (r) navigate(mcpRoute(r.data.id));
      return;
    }
    if (d.act === 'add-server') return openDefinition(null);
    if (d.act === 'import-skill') return importSkill();
    if (d.act === 'import-servers') return importServers();
    if (d.act === 'rename') {
      const v = await promptName('Rename set', cur.name);
      if (v && await write('PUT', setPath(cur.id), { name: v }, 'Set renamed')) await load();
      return;
    }
    if (d.act === 'duplicate') {
      // P1 reserves "Team · " names and caps one at 40: a Team set's copy is named after its home.
      const v = await promptName(`Duplicate ${cur.name}`, `${cur.group === 'team' ? cur.name.slice('Team · '.length) : cur.name} copy`.slice(0, 40));
      if (!v) return;
      const r = await write('POST', `${setPath(cur.id)}/duplicate`, { name: v }, 'Set duplicated');
      if (r) navigate(mcpRoute(r.data.id));
      return;
    }
    if (d.act === 'delete') return deleteSet();
    if (d.act === 'forget') {
      const ok = await confirm({ title: 'Forget Team set', message: `Forget ${cur.name}? Its values, secrets and test results go.`, confirmLabel: 'Forget', danger: true });
      if (ok && await write('POST', `/api/mcp/teams/${enc(cur.home)}/forget`, {})) navigate(mcpRoute('general'));
      return;
    }
    if (d.act === 'add-project') return addProject();
    if (d.act === 'add-member') return addMember({ setId: cur.id });
    if (d.act === 'add-skill') return addSkill(cur);
    if (d.unassign) {
      const a = await assignment(d.unassign);
      if (!a) return;
      const next = cur.group === 'general' ? { ...a, includeGeneral: false } : { ...a, sets: a.sets.filter((s) => s.id !== cur.id) };
      if (await putAssignment(d.unassign, next)) await load();
      return;
    }
    if (d.test) return runTest(cur.id, d.test);
    if (d.remove) {
      const m = st.set.members.find((x) => x.serverId === d.remove);
      const ok = await confirm({ title: `Remove ${m.copy} from ${cur.name}?`, message: `Remove ${m.copy} from ${cur.name}? Its values, secrets and test result go.`,
        lose: [...m.fields.map((f) => `${f.label}${f.secret ? ' (secret)' : ''}`), 'Its test result'], keep: `${m.copy} stays in Servers and in other sets.`, confirmLabel: 'Remove', danger: true });
      if (ok && await write('DELETE', memberPath(cur.id, d.remove), undefined, 'Server removed')) await load();
      return;
    }
    if (d.secret) return replaceSecret(d.server, d.secret);
    if (d.useTeam) {
      if (await write('PUT', memberPath(cur.id, d.server), { values: { [d.useTeam]: d.value } })) await load();
      return;
    }
    if (d.addTo) return addMember({ serverId: d.addTo });
    if (d.edit) {
      const s = st.servers.find((x) => x.id === d.edit);
      return openDefinition(s);
    }
    if (d.removeServer) {
      const s = st.servers.find((x) => x.id === d.removeServer);
      const leaves = s.inSets.length ? ` It leaves ${s.inSets.map((x) => x.name).join(', ')}.` : '';
      const ok = await confirm({ title: `Remove ${s.base}?`, message: `Remove ${s.base} from worca?${leaves} Its values, secrets and test results go.`,
        lose: s.inSets.length ? [`It leaves ${s.inSets.map((x) => x.name).join(', ')}`] : [], confirmLabel: 'Remove', danger: true });
      if (ok && await write('DELETE', `/api/mcp/servers/${enc(s.id)}`, undefined, 'Server removed')) await load();
    }
  }

  async function onChange(e) {
    const t = e.target;
    if (!host.contains(t)) return;
    if (t.dataset.cxSource != null) { st.filters[st.view].source = t.value; paint(); return; }
    if (t.dataset.skillToggle) {
      if (await write('PUT', skillMemberPath(st.set.set.id, t.dataset.skillToggle), { enabled: t.checked })) await load();
      else t.checked = !t.checked;
      return;
    }
    if (t.dataset.toggle) {
      if (await write('PUT', memberPath(st.set.set.id, t.dataset.toggle), { enabled: t.checked })) await load();
      else t.checked = !t.checked;
    } else if (t.dataset.field) {
      // A value paint() restored after a repaint is no "change" to the browser any more: leaving the field (focusout)
      // saves it too, and the one of change/focusout that comes second finds it saved.
      const v = t.value.trim();
      if (v === t.dataset.saved) return;
      const prev = t.dataset.saved;
      t.dataset.saved = v;
      if (await write('PUT', memberPath(st.set.set.id, t.dataset.server), { values: { [t.dataset.field]: v } })) await load();
      else t.dataset.saved = prev;
    }
  }

  async function promptName(title, value) {
    const body = h(doc, 'div', 'field');
    const inp = h(doc, 'input', 'input');
    Object.assign(inp, { type: 'text', value, maxLength: 40 });
    inp.setAttribute('aria-label', 'Name');
    body.append(h(doc, 'label', '', 'Name'), inp);
    return new Promise((resolve) => {
      // The shell's own dismissal (header Close, Escape) answers "no name" too — never a caller waiting forever.
      let unhook = null;
      const settle = (v) => { if (unhook) { unhook(); unhook = null; } modal.close(); resolve(v); };
      if (typeof modal.onClose === 'function') unhook = modal.onClose(() => settle(null));
      modal.open(title, body, [['Cancel', 'btn btn-sm', () => settle(null)],
        ['Save', 'btn btn-primary btn-sm', () => settle(inp.value.trim() || null)]]);
    });
  }

  function replaceSecret(serverId, key) {
    const m = st.set.members.find((x) => x.serverId === serverId);
    const f = m.fields.find((x) => x.key === key);
    const setId = st.set.set.id;
    const body = h(doc, 'div');
    const msg = h(doc, 'p', 'form-msg');
    msg.setAttribute('aria-live', 'polite');
    body.append(fieldInputs(doc, [{ ...f, required: true }]), msg);
    modal.open(`${f.label} · ${m.copy}`, body, [['Cancel', 'btn btn-sm', () => modal.close()],
      ['Save', 'btn btn-primary btn-sm', async () => {
        const { secrets } = collectFieldInputs(body);
        if (!Object.keys(secrets).length) { modal.close(); return; }
        if (await write('PUT', memberPath(setId, serverId), { secrets }, '', msg)) { modal.close(); await load(); }
      }]]);
  }

  async function addProject() {
    const { id: setId, group, name, usedBy } = st.set.set;   // before the await (see onClick's `cur`)
    const r = await api('GET', '/api/projects');
    const used = new Set(usedBy.map((p) => p.key));
    const all = r.ok ? r.data.projects : [];
    const projects = all.filter((p) => !used.has(p.key));
    if (!projects.length) {
      const note = h(doc, 'p', 'hint');
      if (all.length) note.textContent = `Every project already uses ${name}.`;
      else {
        const a = h(doc, 'a', '', 'Projects');
        a.href = '#projects';
        a.addEventListener('click', () => modal.close());
        note.append('No projects defined. Add some first at: ', a);
      }
      modal.open(`Use ${name} in a project`, note, [['Close', 'btn btn-sm', () => modal.close()]]);
      return;
    }
    pickModal(`Use ${name} in a project`, 'Project', projects.map((p) => ({ value: p.key, label: p.name })), {
      label: 'Add', fn: async (key, _slot, msg) => {
        const a = await assignment(key);
        if (!a) return;
        const next = group === 'general' ? { ...a, includeGeneral: true } : { ...a, sets: [...a.sets, { id: setId }] };
        if (await putAssignment(key, next, msg)) { modal.close(); await load(); }
      },
    });
  }

  async function deleteSet() {
    const { set } = st.set;
    const left = [];
    for (const p of set.usedBy) {
      const a = await assignment(p.key);
      if (a && !a.includeGeneral && !a.team && a.sets.every((s) => s.id === set.id)) left.push(p.name);
    }
    const uses = set.usedBy.length ? `\nUsed by ${set.usedBy.map((p) => p.name).join(', ')}.` : '';
    const none = left.length ? `\n${left.join(', ')} will have no MCP servers in runs.` : '';
    const ok = await confirm({ title: 'Delete set', message: `Delete ${set.name}? Its values, secrets and test results go.${uses}${none}`, confirmLabel: 'Delete set', danger: true });
    if (ok && await write('DELETE', setPath(set.id), undefined, 'Set deleted')) navigate(mcpRoute('general'));
  }

  function openDefinition(server) {
    const edit = !!server;
    const form = edit ? formFromDefinition(server.base, server.def) : blankDefinitionForm();
    const body = createDefinitionForm(doc, api, form, { edit });
    const msg = h(doc, 'p', 'form-msg');
    msg.setAttribute('aria-live', 'polite');
    const wrap = h(doc, 'div');
    wrap.append(body, msg);
    const save = async (thenAdd) => {
      if (!(await body.check())) return;
      const { name, def } = compileDefinition(form);
      const r = edit ? await write('PUT', `/api/mcp/servers/${enc(server.id)}`, def, `Saved ${name} · re-testing its sets`, msg)
        : await write('POST', '/api/mcp/servers', { name, ...def }, `Added ${name}`, msg);
      if (!r) return;
      layer().close();
      st.servers = null;
      if (st.view !== 'servers') navigate(mcpRoute(null));
      await load();
      if (thenAdd) await addMember({ serverId: `manual:${name}` });
    };
    const list = [['Cancel', 'btn btn-sm', () => layer().close()], ['Save', 'btn btn-sm', () => save(false)]];
    if (!edit) list.push(['Save to set', 'btn btn-primary btn-sm', () => save(true)]);
    layer().open(edit ? `Edit definition · ${server.base}` : 'Add MCP server', wrap, list, { kind: 'form', width: 'lg' });
  }

  /** Import skill (skill-import.mjs): a finished import lands on the Skills view, read again. */
  function importSkill() {
    openSkillImport({ api, modal, doc, folderImports: st.folderImports, onDone: async ({ name }) => {
      say(`Imported ${name}`, 'ok');
      if (st.view !== 'skills') navigate(MCP_SKILLS_ROUTE);   // the hashchange shows the Skills view
      else await load();
    } });
  }

  /** Servers view › Import from other tools (mcp-server-import.mjs): the picked "Into set" takes the new Manual servers; the list is read again. */
  function importServers() {
    const into = (st.sets || []).filter((x) => x.group !== 'team');
    openMcpImport({ api, modal, doc, sets: into.map((x) => ({ id: x.id, name: x.name })), initialSet: st.view === 'sets' ? st.setId : 'general',
      onDone: async ({ detail, names = [], set = null }) => {
        // The import adds definitions only: the picked set takes each new server (no values yet; a secret shows as Needs setup).
        const put = set ? await Promise.all(names.map((n) => api('PUT', memberPath(set, `manual:${n}`), { enabled: true, values: {}, secrets: {} }))) : [];
        const setName = (into.find((x) => x.id === set) || {}).name;
        const failed = names.filter((_, i) => !put[i] || !put[i].ok);
        if (set && failed.length) {
          const why = ((put.find((r) => r && !r.ok) || {}).data || {}).error;
          say(`Imported ${names.join(', ')}; could not add ${failed.join(', ')} to ${setName}${why ? `: ${why}` : ''}. Turn it on from the set.`, 'err');
        } else say(set && put.length ? `Imported ${names.join(', ')} into ${setName}` : detail, 'ok');
        st.servers = null; await load();
      },
      onChanged: async () => { st.servers = null; await load(); } });
  }

  /** Skills view › Add to set: General and user sets; a set the skill is in already is disabled (spec §6.3). */
  function addSkillTo(skillId) {
    const e = (st.skills || []).find((x) => x.id === skillId);
    if (!e) return;
    const inSets = new Set((e.inSets || []).map((x) => x.id));
    pickModal(`Add ${e.name} to a set`, 'Set',
      (st.sets || []).filter((x) => x.group !== 'team').map((x) => ({ value: x.id, label: x.name, disabled: inSets.has(x.id) })),
      { label: 'Add', fn: async (setId, _slot, msg) => {
        if (await write('PUT', skillMemberPath(setId, skillId), { enabled: true }, 'Skill added', msg)) { modal.close(); await load(); }
      } });
  }

  /** + Add skill: the catalog as a radio list; a skill the set holds, a name it holds and an invalid skill are greyed (spec §6.2). */
  async function addSkill(set) {
    const inSet = new Map((st.set?.skills || []).map((m) => [m.skillId, m.name]));   // before the await
    const names = new Set(inSet.values());
    const r = await api('GET', '/api/skills');
    if (!r.ok) {   // a catalog that could not be read is never "No skills yet"
      modal.open(`Add skill to ${set.name}`, h(doc, 'p', 'hint err', (r.data && r.data.error) || `HTTP ${r.status}`), [['Close', 'btn btn-sm', () => modal.close()]]);
      return;
    }
    const cat = r.data.skills;
    const list = h(doc, 'div', 'sk-pick');
    list.setAttribute('role', 'radiogroup');
    list.setAttribute('aria-label', 'Skill');
    let first = null;
    for (const e of cat) {
      const why = inSet.has(e.id) ? 'already in this set' : names.has(e.name) ? `a skill named ${e.name} is already in this set`
        : e.valid === false ? 'invalid' : null;
      const row = h(doc, 'label', `sk-pick-row${why ? ' greyed' : ''}`);
      const radio = h(doc, 'input');
      Object.assign(radio, { type: 'radio', name: 'sk-pick', value: e.id, disabled: !!why });
      if (!why && !first) { radio.checked = true; first = e; }
      const warn = !why && e.pluginEnabled === false;
      row.append(radio, h(doc, 'span', 'mono', e.name), chip(doc, 'n', e.sourceLabel || (e.source === 'plugin' ? e.plugin : 'Imported')),
        h(doc, 'span', `hint${why === 'invalid' ? ' err' : warn ? ' warn' : ''}`, why || (warn ? 'plugin disabled' : skillCountsText(e))));
      list.appendChild(row);
    }
    if (!first) {
      const why = cat.length ? 'Every skill in the catalog is in this set already.'
        : 'No skills yet. Install a plugin that ships some, or Import skill in Connectors › Skills.';
      modal.open(`Add skill to ${set.name}`, h(doc, 'p', 'hint', why), [['Close', 'btn btn-sm', () => modal.close()]]);
      return;
    }
    const msg = h(doc, 'p', 'form-msg', 'Added skills start on. A skill carries no values and no secrets.');
    msg.setAttribute('aria-live', 'polite');
    const body = h(doc, 'div');
    body.append(list, msg);
    modal.open(`Add skill to ${set.name}`, body, [['Cancel', 'btn btn-sm', () => modal.close()], ['Add', 'btn btn-primary btn-sm', async () => {
      const picked = list.querySelector('input[name="sk-pick"]:checked');
      if (picked && await write('PUT', skillMemberPath(set.id, picked.value), { enabled: true }, 'Skill added', msg)) { modal.close(); await load(); }
    }]]);
  }

  /** Check for updates → what changed at the origin → Update (spec §5: updates are never automatic). */
  async function checkUpdate(skillId) {
    const e = (st.skills || []).find((x) => x.id === skillId);
    if (!e || checking.has(skillId)) return;   // one check per skill at a time: each fetches the origin and stages a copy
    checking.add(skillId);
    say(`Checking ${e.name} for updates…`);
    const r = await api('POST', `/api/skills/${enc(skillId)}/update/preview`);
    checking.delete(skillId);
    if (st.view !== 'skills') {   // the Skills view was left meanwhile: open nothing over another view, drop the stage
      if (r.ok && r.data && r.data.stage) await api('DELETE', `/api/skills/import/${enc(r.data.stage)}`);
      return;
    }
    say('');
    if (!r.ok && r.status === 409 && r.data?.code === 'GIT_MISSING') {   // its origin is off GitHub and git is missing: say so in the dialog
      modal.open(`Update ${e.name}`, h(doc, 'span', 'badge waiting pl-needs-git', 'Needs git'), [['Close', 'btn btn-sm', () => modal.close()]]);
      return;
    }
    if (!r.ok) { fail(r); return; }
    const { stage, added = [], removed = [], changed = [], inspection = null } = r.data;
    const discard = () => api('DELETE', `/api/skills/import/${enc(stage)}`);
    // The check recorded its answer (the "update available" badge, recordSkillUpdateCheck): the catalog is read again
    // when the modal shows "up to date" or is cancelled, so the row's badge says what the check found.
    if (!added.length && !removed.length && !changed.length) {
      await discard();
      modal.open(`${e.name} is up to date`, h(doc, 'p', 'hint', 'Its origin holds the files the library has.'), [['Close', 'btn btn-sm', () => modal.close()]]);
      await load();
      return;
    }
    const body = h(doc, 'div', 'sk-update');
    const list = h(doc, 'div', 'sk-tree');
    const pathOf = (x) => (typeof x === 'string' ? x : (x && x.path) || '');
    for (const [sign, xs, tone] of [['+', added, ''], ['−', removed, ' err'], ['~', changed, ' warn']]) {
      for (const x of xs) {
        const row = h(doc, 'div', `sk-delta${tone}`);
        row.appendChild(h(doc, 'span', 'mono', `${sign} ${pathOf(x)}`));
        list.appendChild(row);
      }
    }
    body.appendChild(list);
    const problems = (inspection && inspection.problems) || [];
    if (inspection) body.appendChild(h(doc, 'small', 'hint', inspectionSummary(inspection)));
    for (const p of problems) body.appendChild(h(doc, 'p', 'hint err sk-problem', p));
    const msg = h(doc, 'p', 'form-msg');
    msg.setAttribute('aria-live', 'polite');
    body.append(consentNode(doc, inspection || {}), msg);
    let applying = false;
    const cancel = async () => { modal.close(); await discard(); await load(); };
    modal.open(`Update ${e.name}`, body, [
      ['Cancel', 'btn btn-sm', cancel],
      ['Update', 'btn btn-primary btn-sm', async () => {
        if (problems.length) { msg.textContent = 'This update cannot be applied: see the problems above.'; msg.className = 'form-msg err'; return; }
        if (applying) return;   // a second click would post the stage again, after the first one moved it
        applying = true;
        const ok = await write('POST', `/api/skills/${enc(skillId)}/update`, { stage }, `Updated ${e.name}`, msg);
        applying = false;
        if (!ok) return;
        st.md.delete(skillId);
        modal.close();
        await load();
      }],
    ]);
    if (modal.afterClose) modal.afterClose(cancel);   // the dialog's own Close is Cancel: the stage goes, the badge is read again
  }
  const checking = new Set();   // the skill ids whose Check for updates is in flight

  host.addEventListener('click', (e) => { void onClick(e); });
  host.addEventListener('change', (e) => { void onChange(e); });
  host.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.cxSearch) { st.filters[t.dataset.cxSearch].q = t.value; paint(); }
    else if (t.id === 'cx-set-find') { st.filters.sets.q = t.value; paint(); }
  });
  // One Tab stop per list; ↑/↓ (Home/End) move between its items, Enter on a server or skill row opens its main action.
  host.addEventListener('keydown', (e) => {
    const list = e.target.closest && e.target.closest('.cx-rail, .cx-list');
    if (!list || !host.contains(list)) return;
    const items = [...list.querySelectorAll(list.classList.contains('cx-rail') ? '.mk-facet' : '.cx-row')];
    if (!items.includes(e.target)) return;
    if (e.key === 'Enter' && !list.classList.contains('cx-rail')) {
      const go = e.target.querySelector('[data-add-to], [data-skill-md]');
      if (go) { e.preventDefault(); go.click(); }
      return;
    }
    const next = moveInList(e, items, e.target);
    if (!next) return;
    e.preventDefault();
    for (const i of items) i.tabIndex = i === next ? 0 : -1;
    next.focus();
  });
  host.addEventListener('focusout', (e) => { if (e.target.dataset && e.target.dataset.field) void onChange(e); });

  return {
    /** Route entry: '' | 'sets/<id>' | 'servers' | 'servers/<id>' | 'skills' (the part after #connectors/). */
    show(sub = '') {
      const r = parseMcpParam(sub);
      st.view = r.view;
      if (r.setId) st.setId = r.setId;
      st.msg = '';
      st.md.clear();       // each entry reads SKILL.md again: a plugin update or an Update may have changed it
      if (r.server) st.filters.servers = { q: '', chip: 'all', source: '' };   // the routed row must be on the page
      return load();
    },
  };
}

// ── resolution tables: the project MCP tab and the workspace overview (spec §8) ───────────────────
function statusFor(row, sets) {
  if (row.why) return row.reason === 'off' ? 'off' : row.reason === 'needs-consent' ? `off: ${row.why}` : `${row.why} in ${row.setName}`;
  const member = (sets || []).find((s) => s.id === row.setId)?.members.find((m) => m.serverId === row.serverId);
  return { ok: 'ok', stale: 'stale', none: 'not tested', failed: 'test failed' }[member ? member.test : 'none'];
}
/** `preview` = POST /api/mcp/preview (a skipped row's reason text is its `why`); `sets` = GET /api/mcp/sets .sets
 *  (for test states). `from(setId)` adds a From cell (the workspace Overview). */
function serverRows(doc, preview, sets, from = null) {
  // A missing-server skip has no copy name (copy: null): it reads as its server id.
  const nameOf = (r) => r.copy ?? r.serverId;
  return [...(preview.copies || []), ...(preview.skipped || [])]
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || a.setId.localeCompare(b.setId))
    .map((r) => {
      const row = h(doc, 'div', `mcp-res-row${from ? ' sk-from' : ''}`);
      const a = h(doc, 'a', '', r.setName);
      a.href = `#${mcpRoute(r.setId)}`;
      const status = statusFor(r, sets);
      row.append(h(doc, 'span', 'mono', r.provisional ? `${nameOf(r)} · name provisional` : nameOf(r)), a);
      if (from) row.appendChild(from(r.setId));
      row.appendChild(h(doc, 'span', `hint${status === 'ok' ? '' : ' mcp-res-skip'}`, status));
      return row;
    });
}
export function renderResolution(doc, title, preview, sets, what = 'project') {
  const card = h(doc, 'section', 'card mcp-resolution');
  card.appendChild(h(doc, 'h2', '', title));
  const rows = serverRows(doc, preview, sets);
  if (!rows.length) { card.appendChild(h(doc, 'p', 'hint', `No MCP servers in runs on this ${what}`)); return card; }
  card.append(...rows, h(doc, 'small', 'hint', 'A copy whose name is taken in a run is renamed with _w when the run starts.'));
  return card;
}
// ── skills in runs (skills registry spec §6.5, §6.6): preview.skills = { mounted, plugins, skipped:[{…, why}], layer, newer } ──
const SKILL_LAYER_WORDS = {
  'sideload-disabled': 'this machine’s managed Claude Code settings turn off --plugin-dir',
  'cli-no-plugin-dir': 'this Claude Code has no --plugin-dir',
  'engine-no-skill-mount': 'this run has no .agents/skills mount for its engine',
};
/** `blocked`: no set skill loads (preview.skills.layer.blocked) — a row with no skip reason still never loads. */
function skillStatus(r, blocked = false) {
  if (!r.reason) return blocked ? 'not loaded' : 'ok';
  if (r.reason === 'off') return 'off';
  if (r.reason === 'needs-consent') return `off: ${r.why || 'turn it on in the team checklist'}`;
  return r.why || r.reason;
}
/** Mounted then skipped skills, by the name agents call: P4's preview puts `qualifiedName` (`<plugin name>:<skill>`) on
 *  every mounted AND skipped row; the bare name only if a row ever lacks it. `from(setId)` adds a From cell. */
function skillRows(doc, preview, from = null) {
  const sk = preview.skills || {};
  const blocked = !!(sk.layer && sk.layer.blocked);
  const nameOf = (r) => r.qualifiedName || r.name;
  return [...(sk.mounted || []), ...(sk.skipped || [])]
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || a.setId.localeCompare(b.setId))
    .map((r) => {
      const row = h(doc, 'div', `mcp-res-row${from ? ' sk-from' : ''}`);
      const a = h(doc, 'a', '', r.setName);
      a.href = `#${mcpRoute(r.setId)}`;
      const status = skillStatus(r, blocked);
      row.append(h(doc, 'span', 'mono', nameOf(r)), a);
      if (from) row.appendChild(from(r.setId));
      row.appendChild(h(doc, 'span', `hint${status === 'ok' ? '' : ' mcp-res-skip'}`, status));
      return row;
    });
}
function skillLayerNote(doc, preview) {
  // P4 sends `skills: null` when the skills half of the preview failed: that is not "no skills".
  if (preview.skills === null) return h(doc, 'p', 'hint err', 'Skills from sets could not be resolved: reload the page to try again');
  const sk = preview.skills || {};
  if (sk.newer) return h(doc, 'p', 'hint err', 'Set files need a newer Worca: no skills from sets reach runs');
  const b = sk.layer && sk.layer.blocked;
  return b ? h(doc, 'p', 'hint warn', `skills from sets not loaded: ${sk.layer.text || SKILL_LAYER_WORDS[b] || b}`) : null;
}
/** "Skills in runs on X" (spec §6.5): the name agents call · set link · status or skip reason. */
export function renderSkillResolution(doc, title, preview, what = 'project') {
  const card = h(doc, 'section', 'card mcp-resolution sk-resolution');
  card.appendChild(h(doc, 'h2', '', title));
  const note = skillLayerNote(doc, preview);
  if (note) card.appendChild(note);
  const rows = skillRows(doc, preview);
  if (!rows.length) { if (preview.skills !== null) card.appendChild(h(doc, 'p', 'hint', `No skills in runs on this ${what}`)); return card; }
  card.append(...rows, h(doc, 'small', 'hint',
    'Each set reaches a run as a plugin of its own: agents call /<set>:<skill>. A skill the project commits under .claude/skills keeps its bare /name. '
    + 'A run on an engine other than Claude gets them in its .agents/skills by name, <set>-<skill> when the name is taken.'));
  return card;
}

/** The workspace Overview's read-only "Sets from member projects" (spec §6.6, F7): what a workspace run gets — its
 *  members' sets and the workspace policy's Team set — each row with the member project(s) its set comes from.
 *  `members` = [{ key, name }]; `preview.sets[].routes` names the projects that bring each set. */
export function renderMemberSets(doc, { name, preview, sets, members }) {
  const card = h(doc, 'section', 'card mcp-resolution sk-members');
  const head = h(doc, 'div', 'card-head');
  head.append(h(doc, 'h2', '', 'Sets from member projects'), h(doc, 'span', 'hint', 'read-only · change a set on its project'));
  card.appendChild(head);
  const byKey = new Map(members.map((m) => [m.key, m]));
  const setOf = new Map((preview.sets || []).map((s) => [s.id, s]));
  const projectLink = (m, text = m.name) => {
    const a = h(doc, 'a', '', text);
    a.href = `#projects/${enc(m.key)}/mcp`;
    return a;
  };
  const chips = h(doc, 'div', 'mcp-usedby');
  chips.appendChild(h(doc, 'span', 'label', 'Members'));
  for (const m of members) {
    const n = (preview.sets || []).filter((s) => s.group !== 'team' && (s.routes || []).some((r) => r.project === m.key)).length;
    const chip = projectLink(m, `${m.name} · ${n} set${n === 1 ? '' : 's'}`);
    chip.className = 'chip';
    chips.appendChild(chip);
  }
  chips.appendChild(h(doc, 'span', 'hint', 'a workspace run gets its members’ sets and the workspace policy’s Team set'));
  card.appendChild(chips);
  const from = (setId) => {
    const cell = h(doc, 'span', 'hint');
    const s = setOf.get(setId);
    if (s && s.group === 'team') { cell.textContent = 'Team'; return cell; }
    [...new Set(((s && s.routes) || []).map((r) => r.project))].forEach((k, i) => {
      if (i) cell.append(', ');
      cell.appendChild(projectLink(byKey.get(k) || { key: k, name: k }));
    });
    return cell;
  };
  const group = (kind, label, rows, empty, note = null) => {
    const g = h(doc, 'div', 'sk-res-group');
    g.appendChild(h(doc, 'div', 'label', `${label} · ${rows.length}`));
    if (note) g.appendChild(note);
    if (!rows.length) { if (empty) g.appendChild(h(doc, 'p', 'hint', empty)); return g; }
    const th = h(doc, 'div', 'sk-res-head');
    for (const t of [kind, 'From set', 'From', 'Status']) th.appendChild(h(doc, 'span', '', t));
    g.append(th, ...rows);
    return g;
  };
  card.append(
    group('Server', `Servers in runs on ${name}`, serverRows(doc, preview, sets, from), 'No MCP servers in runs on this workspace'),
    group('Skill', `Skills in runs on ${name}`, skillRows(doc, preview, from),
      preview.skills === null ? null : 'No skills in runs on this workspace', skillLayerNote(doc, preview)),
    h(doc, 'small', 'hint', 'To change what a workspace run gets, open a member project’s Sets tab.'));
  return card;
}

/** `skillsTitle` adds the skills table beside the servers one (the project Sets tab); `members` ([{ key, name }]) paints
 *  the workspace Overview's "Sets from member projects" instead, `title` being the workspace's name. */
export async function paintMcpResolution(host, { target, title, skillsTitle = null, members = null, api, doc = globalThis.document }) {
  const [p, s] = await Promise.all([api('POST', '/api/mcp/preview', { target }), api('GET', '/api/mcp/sets')]);
  if (!p.ok) { host.replaceChildren(h(doc, 'small', 'hint err', p.data?.error || `HTTP ${p.status}`)); return; }
  if (members) { host.replaceChildren(renderMemberSets(doc, { name: title, preview: p.data, sets: s.ok ? s.data.sets : [], members })); return; }
  const what = target.workspaceId ? 'workspace' : 'project';
  const cards = [renderResolution(doc, title, p.data, s.ok ? s.data.sets : [], what)];
  if (skillsTitle) cards.push(renderSkillResolution(doc, skillsTitle, p.data, what));
  host.replaceChildren(...cards);
}

/** The project page's Sets tab (key mcp): its sets (chips, Add set, Include General in runs, the Team chip) and
 *  the servers and skills its runs get. No configuration here. */
export async function mountProjectMcp(sec, { key, name, api, doc = globalThis.document }) {
  const r = await api('GET', `/api/mcp/projects/${enc(key)}`);
  if (!r.ok) { sec.replaceChildren(h(doc, 'small', 'hint err', r.data?.error || `HTTP ${r.status}`)); return; }
  const a = r.data;
  const save = async (next) => {
    const w = await api('PUT', `/api/mcp/projects/${enc(key)}`, { sets: next.sets.map((s) => s.id), includeGeneral: next.includeGeneral });
    if (w.ok) await mountProjectMcp(sec, { key, name, api, doc });
    else sec.querySelector('.mcp-proj-msg').textContent = w.data?.error || `HTTP ${w.status}`;
  };
  const card = h(doc, 'section', 'card mcp-proj-sets');
  card.appendChild(h(doc, 'h2', '', 'Sets'));
  const chips = h(doc, 'div', 'mcp-usedby');
  for (const s of a.sets) {
    const chip = h(doc, 'span', 'chip');
    const link = h(doc, 'a', '', s.name);
    link.href = `#${mcpRoute(s.id)}`;
    const x = button(doc, 'btn btn-sm btn-quiet btn-icon mcp-x', null, { drop: s.id });
    x.append(icon(doc, 'x', 12));
    x.setAttribute('aria-label', `Remove ${s.name}`);
    x.addEventListener('click', () => save({ ...a, sets: a.sets.filter((y) => y.id !== s.id) }));
    chip.append(link, x);
    chips.appendChild(chip);
  }
  if (a.team) {
    const t = h(doc, 'a', 'chip', a.team.name);
    t.href = `#${mcpRoute(a.team.id)}`;
    chips.appendChild(t);
  }
  if (a.choices.length) {
    const sel = h(doc, 'select', 'select mcp-add-set');
    sel.setAttribute('aria-label', 'Add set');
    sel.appendChild(Object.assign(h(doc, 'option', '', 'Add set…'), { value: '' }));
    for (const c of a.choices) sel.appendChild(Object.assign(h(doc, 'option', '', c.name), { value: c.id }));
    sel.addEventListener('change', () => { if (sel.value) save({ ...a, sets: [...a.sets, { id: sel.value }] }); });
    chips.appendChild(sel);
  }
  card.appendChild(chips);
  const sw = h(doc, 'label', 'switch-row');
  const cb = h(doc, 'input', 'sw-input');
  cb.type = 'checkbox';
  cb.checked = a.includeGeneral;
  cb.setAttribute('aria-label', 'Include General in runs');
  cb.addEventListener('change', () => save({ ...a, includeGeneral: cb.checked }));
  sw.append(cb, h(doc, 'span', 'switch'), h(doc, 'span', 'txt', 'Include General in runs'));
  card.append(sw, h(doc, 'small', 'hint', 'Chat always includes General; a workspace run includes it when any member does'));
  if (a.none) card.appendChild(h(doc, 'p', 'hint err', 'No MCP servers in runs on this project'));
  card.appendChild(h(doc, 'small', 'hint err mcp-proj-msg'));
  const committed = h(doc, 'div');
  const servers = h(doc, 'div');
  sec.replaceChildren(card, committed, servers);
  await paintCommittedMcp(committed, { key, api, doc });
  await paintMcpResolution(servers, { target: { projectKey: key }, title: `Servers in runs on ${name}`, skillsTitle: `Skills in runs on ${name}`, api, doc });
}

// ── the repository's own .mcp.json (src/core/mcpjson-approval.mjs): a run starts only the approved ones, on every
// engine, so an unapproved one gets an Approve button ──
const COMMITTED_STATUS = { approved: 'approved', unapproved: 'not approved: runs leave it out', disabled: 'turned off in Claude Code settings' };
export async function paintCommittedMcp(sec, { key, api, doc = globalThis.document }) {
  const r = await api('GET', `/api/mcp/projects/${enc(key)}/mcpjson`);
  if (!r.ok) { sec.replaceChildren(h(doc, 'small', 'hint err', r.data?.error || `HTTP ${r.status}`)); return; }
  const { servers = [], canApprove, error } = r.data || {};
  if (!servers.length && !error) { sec.replaceChildren(); return; }
  const card = h(doc, 'section', 'card mcp-resolution mcp-committed');
  card.appendChild(h(doc, 'h2', '', 'Servers in the repository’s .mcp.json'));
  if (error) card.appendChild(h(doc, 'p', 'hint err', `.mcp.json could not be read: ${error}`));
  const msg = h(doc, 'small', 'hint err mcp-committed-msg');
  const approve = async (names) => {
    const w = await api('POST', `/api/mcp/projects/${enc(key)}/mcpjson/approve`, { names });
    if (w.ok) await paintCommittedMcp(sec, { key, api, doc });
    else msg.textContent = w.data?.error || `HTTP ${w.status}`;
  };
  for (const s of servers) {
    const row = h(doc, 'div', 'mcp-res-row');
    row.append(h(doc, 'span', 'mono', s.name), h(doc, 'span', `hint${s.status === 'approved' ? '' : ' mcp-res-skip'}`, COMMITTED_STATUS[s.status] || s.status));
    const cell = h(doc, 'span');
    if (s.status === 'unapproved' && canApprove) {
      const b = button(doc, 'btn btn-sm', 'Approve', { approve: s.name });
      b.addEventListener('click', () => approve([s.name]));
      cell.appendChild(b);
    }
    row.appendChild(cell);
    card.appendChild(row);
  }
  card.appendChild(h(doc, 'small', 'hint', canApprove || !servers.some((s) => s.status === 'unapproved')
    ? 'Approve writes the server into this project’s .claude/settings.local.json, which git does not track.'
    : 'This repository tracks .claude/settings.local.json, so an approval there does not count. Approve the servers in ~/.claude/settings.json.'));
  card.appendChild(msg);
  sec.replaceChildren(card);
}

/** Settings › Ask Worca: the General set in one line — its servers and its skills — with a link to edit it (spec §9.5;
 *  skills registry §6.12). */
export async function paintAskMcpBlock(host, { api, doc = globalThis.document }) {
  const [r, g] = await Promise.all([api('GET', '/api/mcp/sets'), api('GET', '/api/mcp/sets/general')]);
  const general = r.ok && Array.isArray(r.data?.sets) ? r.data.sets.find((s) => s.id === 'general') : null;
  // What a chat can get: General's skills that are on and have no reason to be skipped (off, invalid, missing, plugin off).
  const skills = g.ok && Array.isArray(g.data?.skills) ? g.data.skills.filter((m) => m.enabled && !m.reason) : [];
  const row = h(doc, 'div', 'mcp-usedby');
  row.appendChild(h(doc, 'span', 'hint', 'General set'));
  for (const m of general ? general.members : []) row.appendChild(h(doc, 'span', 'chip mono', m.copy));
  if (general && !general.members.length) row.appendChild(h(doc, 'span', 'hint', 'no servers yet'));
  for (const m of skills) {
    const chip = h(doc, 'span', 'chip sk-chip');
    chip.title = m.description || m.name;
    chip.append(h(doc, 'span', 'sk-kind', 'Skill'), h(doc, 'span', 'mono', m.qualifiedName));
    row.appendChild(chip);
  }
  row.appendChild(h(doc, 'span', 'hint', 'plus the sets of the projects a chat works on'));
  const a = h(doc, 'a', '', 'Edit General set');
  a.href = '#connectors/sets/general';
  row.appendChild(a);
  const label = h(doc, 'div', 'label-row');
  label.appendChild(h(doc, 'label', '', 'Sets'));
  host.replaceChildren(label, row, h(doc, 'small', 'hint', 'The Skill tool is on only for turns that mount at least one skill; shell blocks never run in Ask.'));
}
