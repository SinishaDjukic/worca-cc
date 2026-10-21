// ui/public/marketplace/browse.mjs — the Browse tab (marketplace P3, board 1.1, 4.2; CONTRACT §5): the search and facet
// rail, the grouped plugin tiles, the header's health, refresh and Add marketplace, and the empty states.
import { KIND_ORDER, KINDS, chip, glyphTile, kindTile, addsSummary, secretsSummary } from './kinds.mjs';
import { filterCatalog, groupCatalog, facetCounts, marketplaceHealth, shortDate } from './catalog.mjs';
import { relTime, renderNeedsGit } from '../plugins-view.mjs';
import { fieldError, clearFieldErrors } from '../feedback.mjs';
import { icon } from '../icons.mjs';

const EMPTY_URL = 'Enter a marketplace repo (https://github.com/owner/repo, owner/repo, or a local path).';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function make(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function button(doc, cls, text) {
  const b = make(doc, 'button', cls, text);
  b.type = 'button';
  return b;
}

/** A Browse tile: button.mk-tile[data-key]; its accessible name is its visible text (LC-P3-14). */
export function renderTile(doc, item) {
  const tile = button(doc, 'mk-tile');
  tile.dataset.key = item.key;
  tile.dataset.focusKey = `tile:${item.key}`;
  const meta = make(doc, 'span', 'mk-tile-meta');
  if (item.version) {
    const dot = make(doc, 'span', null, '·');
    dot.setAttribute('aria-hidden', 'true');
    const sha = !item.row?.version && !item.entry?.version;   // a sha standing in for a missing version: mono (SM30)
    meta.append(make(doc, 'span', sha ? 'mk-ver mk-sha' : 'mk-ver', item.version), dot);
  }
  meta.append(item.row?.linked ? chip(doc, 'n', 'linked', { icon: 'link' }) : make(doc, 'span', 'mk-tile-mkt', item.marketplace.name));
  const id = make(doc, 'span', 'mk-tile-id');
  id.append(make(doc, 'span', 'mk-tile-name', item.name), meta);
  const top = make(doc, 'span', 'mk-tile-top');
  top.append(kindTile(doc, item.iconKind), id);
  const foot = make(doc, 'span', 'mk-tile-foot');
  const adds = addsSummary(item.counts);
  if (adds) foot.append(chip(doc, 'n', adds));
  const secrets = secretsSummary(item.secrets);
  if (secrets) foot.append(chip(doc, 'n', secrets, { icon: 'key' }));
  const status = item.update ? chip(doc, 'upd', `Update ${item.update.version}`, { icon: 'arrow-up' })
    : item.installed ? chip(doc, 'ok', 'Installed', { icon: 'check' })
      : item.source.sha ? make(doc, 'span', 'btn btn-sm', 'Install') : null;
  if (status) { status.classList.add('mk-tile-status'); foot.append(status); }
  tile.append(top, make(doc, 'span', 'mk-tile-desc', item.description), foot);
  return tile;
}

/** SM20: the "No marketplaces yet" block with its inline add; errors stay in the form. P7's tab reuses it. */
export function renderNoMarketplaces(doc, { onAdd }) {
  const box = make(doc, 'div', 'mk-empty mk-empty-mkts');
  const form = make(doc, 'form', 'mk-empty-add');
  form.noValidate = true;
  const field = make(doc, 'div', 'mk-empty-field');
  const input = make(doc, 'input', 'input');
  input.type = 'text';
  input.placeholder = 'owner/repo, GitHub URL or folder';
  input.setAttribute('aria-label', 'Marketplace repo, URL or folder');
  input.spellcheck = false;
  const add = make(doc, 'button', 'btn btn-primary btn-sm', 'Add');
  add.type = 'submit';
  field.append(input);
  form.append(field, add);
  box.append(kindTile(doc, 'mkt', { size: 'lg' }), make(doc, 'h3', 'mk-empty-title', 'No marketplaces yet'), form);
  let needsGit = null;
  let busy = false;
  const dropNeedsGit = () => { needsGit?.remove(); needsGit = null; };
  input.addEventListener('input', dropNeedsGit);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    dropNeedsGit();
    clearFieldErrors(form);
    const url = input.value.trim();
    if (!url) { fieldError(input, EMPTY_URL); return; }
    busy = true;
    add.setAttribute('aria-disabled', 'true');   // not `disabled`: a focused Add keeps its focus
    add.setAttribute('aria-busy', 'true');
    let r;
    try { r = await onAdd(url, add); } catch (e) { r = { ok: false, data: { error: e.message } }; } finally {
      busy = false;
      add.removeAttribute('aria-disabled');
      add.removeAttribute('aria-busy');
    }
    if (!r || r.ok !== false) return;
    if (r.status === 409 && r.data?.code === 'GIT_MISSING') { needsGit = renderNeedsGit(doc); field.append(needsGit); }
    else fieldError(input, r.data?.error || 'add failed');
  });
  return box;
}

function facet(doc, { attr, value, label, n, pressed, tone = null, chipEl = null }) {
  const b = button(doc, 'mk-facet');
  b.dataset[attr] = value;
  b.dataset.focusKey = `${attr}:${value}`;
  b.setAttribute('aria-pressed', String(pressed));
  if (tone) b.append(make(doc, 'span', `mk-facet-dot mk-dot-${tone}`));
  const name = make(doc, 'span', 'mk-facet-label', label);
  if (chipEl) {
    const wrap = make(doc, 'span', 'mk-facet-name');
    wrap.append(name, chipEl);
    b.append(wrap);
  } else b.append(name);
  b.append(make(doc, 'span', 'mk-facet-n', String(n)));
  return b;
}

function group(doc, g) {
  const s = make(doc, 'section', 'mk-group');
  s.dataset.group = g.key;
  s.setAttribute('aria-labelledby', `mk-group-${g.key}`);
  const title = make(doc, 'h2', 'section-title', g.title);
  title.id = `mk-group-${g.key}`;
  const headRow = make(doc, 'div', 'mk-group-head');
  headRow.append(title, make(doc, 'span', 'mk-count', String(g.items.length)));
  const grid = make(doc, 'div', 'mk-grid');
  grid.append(...g.items.map((i) => renderTile(doc, i)));
  s.append(headRow, grid);
  return s;
}

// Nothing to show: no plugins at all (bag tile + the corpus line), a search with no match (title + Clear search),
// or facets that exclude everything (no title, Clear filters — LC-P3-7).
function empty(doc, state) {
  const box = make(doc, 'div', 'mk-empty');
  const corpus = make(doc, 'p', 'mk-meta', `${plural(state.catalog.length, 'plugin')} in ${plural(state.marketplaces.length, 'marketplace')}`);
  if (!state.catalog.length) {
    box.append(glyphTile(doc, 'bag', 'n', { size: 'lg' }), corpus);
    return box;
  }
  const q = state.filters.q.trim();
  box.append(glyphTile(doc, 'search', 'n', { size: 'lg' }));
  if (q) box.append(make(doc, 'h3', 'mk-empty-title', `No plugins match “${q}”`));
  box.append(corpus, q ? button(doc, 'btn mk-clear-search', 'Clear search') : button(doc, 'btn mk-clear-filters', 'Clear filters'));
  return box;
}

// The rail and grid shell, built once per panel: the search field and Hide installed survive every re-render.
function shell(doc, panel, page) {
  const root = make(doc, 'div', 'mk-browse');
  const rail = make(doc, 'div', 'mk-rail');
  rail.setAttribute('role', 'group');
  rail.setAttribute('aria-label', 'Filters');
  const box = make(doc, 'div', 'mk-search');
  const search = make(doc, 'input', 'input');
  search.id = 'mk-search';
  search.type = 'search';
  search.placeholder = 'Search plugins';
  search.setAttribute('aria-label', 'Search plugins');
  search.autocomplete = 'off';
  const clear = button(doc, 'btn btn-quiet btn-sm btn-icon mk-search-clear');
  clear.setAttribute('aria-label', 'Clear search');
  clear.append(icon(doc, 'x', 14));
  clear.hidden = true;
  box.append(icon(doc, 'search', 16), search, clear);
  const adds = make(doc, 'div', 'mk-facets');
  adds.dataset.facet = 'adds';
  const from = make(doc, 'div', 'mk-facets');
  from.dataset.facet = 'from';
  const hideRow = make(doc, 'label', 'mk-hide');
  const hide = make(doc, 'input');
  hide.id = 'mk-hide-installed';
  hide.type = 'checkbox';
  hide.dataset.focusKey = 'hide';
  hideRow.append(hide, make(doc, 'span', null, 'Hide installed'));
  rail.append(box, make(doc, 'div', 'mk-rail-label', 'Adds'), adds, make(doc, 'div', 'mk-rail-label mk-from-label', 'From'), from,
    make(doc, 'div', 'mk-rail-sep'), hideRow);
  const groups = make(doc, 'div', 'mk-groups');
  root.append(rail, groups);

  panel.addEventListener('input', (ev) => {
    if (ev.target === search) page.setFilters({ q: search.value });
  });
  panel.addEventListener('change', (ev) => {
    if (ev.target === hide) page.setFilters({ hideInstalled: hide.checked });
  });
  panel.addEventListener('click', (ev) => {
    const t = ev.target.closest?.('button');
    if (!t || !panel.contains(t)) return;
    if (t.matches('.mk-facet[data-adds]')) page.setFilters({ adds: t.dataset.adds === 'all' ? null : t.dataset.adds });
    else if (t.matches('.mk-facet[data-from]')) page.setFilters({ from: page.state.filters.from === t.dataset.from ? null : t.dataset.from });
    else if (t.matches('.mk-search-clear, .mk-clear-search')) { page.setFilters({ q: '' }); search.focus(); }
    else if (t.matches('.mk-clear-filters')) { page.setFilters({ adds: null, from: null, hideInstalled: false }); search.focus(); }
    else if (t.matches('.mk-tile')) {
      const item = page.state.catalog.find((i) => i.key === t.dataset.key);
      if (item) page.act('openPlugin', item);
    }
  });
  return { root, search, clear, adds, from, hide, groups };
}

function header(doc, state, el, page) {
  if (state.loaded && !state.marketplaces.length) return;   // board 4.2: the inline add is the one action
  const { unreachable, syncedAt } = marketplaceHealth(state.marketplaces);
  if (unreachable) {
    const health = make(doc, 'a', 'badge mk-chip mk-chip-warn mk-health');
    health.setAttribute('href', '#marketplace/marketplaces');
    health.append(icon(doc, 'alert', 12), `${plural(unreachable, 'marketplace')} can't be reached`);
    health.addEventListener('click', (ev) => { ev.preventDefault(); page.setTab('marketplaces'); });
    el.append(health);
  } else if (syncedAt) {
    el.append(make(doc, 'span', 'mk-meta mk-synced', `Synced ${relTime(syncedAt)}`));
  }
  const refresh = button(doc, 'btn btn-quiet btn-icon mk-refresh');
  refresh.setAttribute('aria-label', 'Refresh marketplaces');
  refresh.dataset.focusKey = 'refresh';
  refresh.append(icon(doc, 'refresh', 16));
  if (state.refreshing) { refresh.setAttribute('aria-disabled', 'true'); refresh.setAttribute('aria-busy', 'true'); }
  refresh.addEventListener('click', () => { if (!page.state.refreshing) page.load({ refresh: true }); });
  const add = button(doc, 'btn mk-add-mkt');
  add.dataset.focusKey = 'add-mkt';
  add.append(icon(doc, 'plus', 16), 'Add marketplace');
  add.addEventListener('click', () => page.act('openAddMarketplace', { opener: add }));
  el.append(refresh, add);
}

/** The Browse tab spec (CONTRACT §3.5). */
export function browseTab({ doc }) {
  const shells = new WeakMap();   // panel -> its rail and grid shell
  function render(state, panel, page) {
    if (!state.marketplaces.length) {
      if (!panel.firstElementChild?.classList.contains('mk-empty-mkts')) {
        panel.replaceChildren(renderNoMarketplaces(doc, { onAdd: (url, opener) => page.act('openAddMarketplace', { url, opener }) }));
      }
      return;
    }
    let s = shells.get(panel);
    if (!s) { s = shell(doc, panel, page); shells.set(panel, s); }
    if (s.root.parentNode !== panel) panel.replaceChildren(s.root);
    const f = state.filters;
    if (s.search.value !== f.q) s.search.value = f.q;
    s.clear.hidden = !f.q;
    s.hide.checked = !!f.hideInstalled;
    const n = facetCounts(state.catalog);
    s.adds.replaceChildren(
      facet(doc, { attr: 'adds', value: 'all', label: 'All plugins', n: n.all, pressed: !f.adds }),
      ...KIND_ORDER.filter((k) => n.kinds[k] > 0).map((k) => facet(doc, { attr: 'adds', value: k, label: KINDS[k].many, n: n.kinds[k],
        pressed: f.adds === k, tone: KINDS[k].tone })));
    s.from.replaceChildren(...state.marketplaces.map((m) => facet(doc, { attr: 'from', value: m.id, label: m.name ?? m.id,
      n: n.from[m.id] ?? 0, pressed: f.from === m.id,
      chipEl: m.lastError != null && m.lastSync?.at ? chip(doc, 'warn', `Snapshot from ${shortDate(m.lastSync.at)}`) : null })));
    const shown = filterCatalog(state.catalog, f);
    s.groups.replaceChildren(...(shown.length ? groupCatalog(shown).map((g) => group(doc, g)) : [empty(doc, state)]));
  }
  return { label: 'Browse', count: (state) => state.catalog.length, header: (state, el, page) => header(doc, state, el, page), render };
}

/** The 'browse' action: reset the filters to { q: '', adds, from, hideInstalled: false }, then select Browse (SM63). */
export function browseAction(page) {
  return ({ adds = null, from = null } = {}) => {
    page.setFilters({ q: '', adds, from, hideInstalled: false });
    page.setTab('browse');
  };
}
