// ui/public/mcp-servers/connectors-shell.mjs — the Connectors page's frame: the tab strip, the list toolbar and its pure
// filters, the load-error and empty states, and the arrow-key move shared by the rail and the row lists.
// Layout hooks use the shared Marketplace / Models classes; the page-only ones carry the `cx-` prefix.
import { icon } from '../icons.mjs';
import { glyphTile } from '../marketplace/kinds.mjs';

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export const CX_TABS = [['sets', 'Sets', 'connectors'], ['servers', 'Servers', 'connectors/servers'], ['skills', 'Skills', 'connectors/skills']];

/** nav.tabs.mk-tabs > a.tab.mk-tab[href] with a count each; a count not loaded yet is `hidden`. */
export function renderTabs(doc, { view, counts = {} }) {
  const nav = h(doc, 'nav', 'tabs mk-tabs');
  nav.setAttribute('aria-label', 'Connectors sections');
  for (const [key, label, route] of CX_TABS) {
    const a = h(doc, 'a', `tab mk-tab${view === key ? ' on' : ''}`);
    a.href = `#${route}`;
    a.dataset.mcpView = key;
    if (view === key) a.setAttribute('aria-current', 'page');
    const n = h(doc, 'span', 'mk-count', counts[key] == null ? '' : String(counts[key]));
    if (counts[key] == null) n.hidden = true;
    a.append(label, ' ', n);
    nav.appendChild(a);
  }
  return nav;
}

/** div.mk-head: the tabs, then the tab's own actions. */
export function renderHead(doc, { tabs, actions = [] }) {
  const head = h(doc, 'div', 'mk-head');
  const acts = h(doc, 'div', 'mk-head-actions');
  acts.append(...actions);
  head.append(tabs, acts);
  return head;
}

// ── filters (pure) ──────────────────────────────────────────────────────────────────────────────────
const has = (text, q) => String(text || '').toLowerCase().includes(q);
const matchesQ = (q, ...texts) => !q || texts.some((t) => has(t, q.trim().toLowerCase()));

const serverChip = {
  all: () => true,
  'in-set': (s) => s.inSets.length > 0,
  'no-set': (s) => s.inSets.length === 0,
  'needs-setup': (s) => !!s.needsSetup,
};
export const serverSource = (s) => s.sourceLabel;
function serverBase(servers, { q, source }) {
  return servers.filter((s) => (!source || serverSource(s) === source)
    && matchesQ(q, s.base, s.description, s.sourceLabel, ...s.inSets.map((x) => x.name)));
}
export function filterServers(servers, { q = '', chip = 'all', source = '' } = {}) {
  return serverBase(servers, { q, source }).filter(serverChip[chip] || serverChip.all);
}
export function serverChipCounts(servers, { q = '', source = '' } = {}) {
  const base = serverBase(servers, { q, source });
  return Object.fromEntries(Object.entries(serverChip).map(([k, f]) => [k, base.filter(f).length]));
}

/** A skill that needs a look: invalid, declares hooks, has an update, reads plugin-root files, or its plugin is off (D3). */
export const skillNeedsAttention = (x) => x.valid === false || !!(x.frontmatter && (x.frontmatter.hooks || x.frontmatter.pluginRootRefs))
  || !!x.updateAvailable || x.pluginEnabled === false;
const skillChip = {
  all: () => true,
  imported: (x) => x.source === 'library',
  plugins: (x) => x.source === 'plugin',
  attention: skillNeedsAttention,
};
export const skillSource = (x) => (x.source === 'plugin' ? (x.sourceLabel || x.plugin) : 'Imported');
function skillBase(skills, { q, source }) {
  return skills.filter((x) => (!source || skillSource(x) === source)
    && matchesQ(q, x.name, x.description, skillSource(x), ...(x.inSets || []).map((s) => s.name)));
}
export function filterSkills(skills, { q = '', chip = 'all', source = '' } = {}) {
  return skillBase(skills, { q, source }).filter(skillChip[chip] || skillChip.all);
}
export function skillChipCounts(skills, { q = '', source = '' } = {}) {
  const base = skillBase(skills, { q, source });
  return Object.fromEntries(Object.entries(skillChip).map(([k, f]) => [k, base.filter(f).length]));
}

/** "All sources" then each distinct key, sorted. */
export function sourceOptions(rows, keyOf) {
  const keys = [...new Set(rows.map(keyOf).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return [{ value: '', label: 'All sources' }, ...keys.map((k) => ({ value: k, label: k }))];
}

// ── the toolbar (Models Catalogue grammar) ──────────────────────────────────────────────────────────
const CHIPS = {
  servers: [['all', 'All'], ['in-set', 'In a set'], ['no-set', 'Not in a set'], ['needs-setup', 'Needs setup']],
  skills: [['all', 'All'], ['imported', 'Imported'], ['plugins', 'From plugins'], ['attention', 'Needs attention']],
};
export function renderToolbar(doc, { kind, filters, counts = {}, sources = [] }) {
  const bar = h(doc, 'div', 'mdl-toolbar cx-toolbar');
  bar.setAttribute('role', 'search');
  const word = kind === 'servers' ? 'servers' : 'skills';
  const search = h(doc, 'input', 'input mv-search');
  search.type = 'search';
  search.dataset.cxSearch = kind;
  search.setAttribute('placeholder', `Search ${word}`);
  search.setAttribute('aria-label', `Search ${word}`);
  search.value = filters.q || '';
  const chips = h(doc, 'div', 'mv-filters');
  for (const [key, label] of CHIPS[kind]) {
    const b = h(doc, 'button', 'filter-chip', label);
    b.type = 'button';
    b.dataset.cxChip = key;
    b.setAttribute('aria-pressed', String((filters.chip || 'all') === key));
    b.appendChild(h(doc, 'span', 'n', String(counts[key] ?? 0)));
    chips.appendChild(b);
  }
  const select = h(doc, 'select', 'select-sm');
  select.dataset.cxSource = '';
  select.setAttribute('aria-label', 'Source');
  for (const o of sources) {
    const opt = h(doc, 'option', '', o.label);
    opt.value = o.value;
    select.appendChild(opt);
  }
  select.value = filters.source || '';
  bar.append(search, chips, select);
  return bar;
}

// ── states ──────────────────────────────────────────────────────────────────────────────────────────
export function renderLoadError(doc, { what, cause, retryAct = 'retry' }) {
  const box = h(doc, 'div', 'empty-line is-err');
  box.setAttribute('role', 'alert');
  const acts = h(doc, 'div', 'el-acts');
  const retry = h(doc, 'button', 'btn btn-sm');
  retry.type = 'button';
  retry.dataset.act = retryAct;
  retry.append(icon(doc, 'refresh', 14), 'Try again');
  acts.appendChild(retry);
  box.append(h(doc, 'span', 'el-t', `Could not load ${what}`), h(doc, 'span', '', `${cause} Nothing changed.`), acts);
  return box;
}

/** The empty state of a whole tab. */
export function renderEmpty(doc, { title, line, action = null, glyph = 'plug', tone = 'mcp' }) {
  const box = h(doc, 'div', 'mk-empty');
  box.append(glyphTile(doc, glyph, tone, { size: 'lg' }), h(doc, 'p', 'mk-empty-title', title), h(doc, 'p', 'mk-meta', line));
  if (action) box.appendChild(action);
  return box;
}

/** The empty state of a section (or of a filtered list). */
export function emptyLine(doc, text, button = null) {
  const p = h(doc, 'p', 'empty-line', text);
  if (button) p.append(' ', button);
  return p;
}

/** ArrowUp/ArrowDown/Home/End over `items`: the element to focus, clamped at both ends; null for any other key. */
export function moveInList(e, items, current) {
  if (!items.length) return null;
  const at = items.indexOf(current);
  if (e.key === 'Home') return items[0];
  if (e.key === 'End') return items[items.length - 1];
  if (e.key === 'ArrowDown') return items[Math.min(items.length - 1, at < 0 ? 0 : at + 1)];
  if (e.key === 'ArrowUp') return items[Math.max(0, at < 0 ? 0 : at - 1)];
  return null;
}
