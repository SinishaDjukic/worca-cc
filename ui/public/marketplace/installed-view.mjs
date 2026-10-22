// ui/public/marketplace/installed-view.mjs — Pure DOM for the Installed tab (board 3.1). Returns detached elements;
// ui/public/marketplace/installed.mjs wires them.
import { kindTile, glyphTile, kindCounts, pluginIconKind, chip } from './kinds.mjs';
import { noteText } from './catalog.mjs';
import { icon } from '../icons.mjs';
import { channelBadge } from '../plugins-view.mjs';
import {
  sha7, versionOf, updateOf, problemsOf, attention, kindsMeta, policyItems, policySummary, findCatalogItem, leftoverIconKind, glyphOf,
} from './installed-model.mjs';

const list = (v) => (Array.isArray(v) ? v : []);

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function button(doc, cls, text) {
  const b = h(doc, 'button', cls, text);
  b.type = 'button';
  return b;
}

// The plugin icon of an installed row (U7): P3's kindCounts subtracts the row's ignored files.
const tileFor = (doc, row, size = 'sm') => kindTile(doc, pluginIconKind(kindCounts(row || {})), { size });

// div.mk-sec-head > h2.section-title#<id> + span.mk-count
function secHead(doc, title, n, id) {
  const head = h(doc, 'div', 'mk-sec-head');
  const t = h(doc, 'h2', 'section-title', title);
  t.id = id;
  head.append(t, h(doc, 'span', 'mk-count', String(n)));
  return head;
}

// A row action: button.btn.btn-sm[data-act][data-name][data-focus-key="<act>:<name>"]
function actBtn(doc, act, name, label) {
  const b = button(doc, 'btn btn-sm', label);
  b.dataset.act = act;
  b.dataset.name = name;
  b.dataset.focusKey = `${act}:${name}`;
  return b;
}

// li.mk-row > tile + div.mk-row-main > div.mk-row-line
function rowShell(doc, tile) {
  const li = h(doc, 'li', 'mk-row');
  const main = h(doc, 'div', 'mk-row-main');
  const line = h(doc, 'div', 'mk-row-line');
  main.append(line);
  li.append(tile, main);
  return { li, main, line };
}

// Versions are UI sans with tabular numerals (SM30, P3's .mk-ver); a sha7 standing in for a missing version is mono
// through P3's own `.mk-ver.mk-sha` rule. The server stores a version-less plugin's version as its pin's sha7
// (`manifest.version ?? pin.slice(0, 7)`), so a version equal to the pinned sha7 reads as a sha too.
function verSpan(doc, row) {
  const v = versionOf(row);
  const isSha = !row?.version || row.version === sha7(row?.pinnedSha);
  return v ? h(doc, 'span', isSha ? 'mk-ver mk-sha' : 'mk-ver', v) : null;
}

/** The tab's header actions: Refresh marketplaces (icon), then "Update all · n" (primary) when there are updates. */
export function renderInstalledHeader(doc, { updates = 0 } = {}) {
  const refresh = button(doc, 'btn btn-quiet btn-icon mk-refresh');
  refresh.setAttribute('aria-label', 'Refresh marketplaces');
  refresh.dataset.focusKey = 'refresh';
  refresh.append(icon(doc, 'refresh', 16));
  if (!(updates > 0)) return [refresh];
  const all = button(doc, 'btn btn-primary mk-update-all');
  all.dataset.focusKey = 'update-all';
  all.append(icon(doc, 'arrow-up', 14), doc.createTextNode(`Update all · ${updates}`));
  return [refresh, all];
}

const POLICY = {
  missing: { tone: 'warn', chip: 'Not installed', act: 'policy-install', label: 'Install' },
  outdated: { tone: 'warn', chip: 'Outdated', act: 'policy-update', label: 'Update' },
  disabled: { tone: 'off', chip: 'Disabled', act: 'policy-on', label: 'Turn on' },
  'needs-setup': { tone: 'warn', chip: 'Needs setup', act: 'policy-setup', label: 'Set up' },
  blocked: { tone: 'bad', chip: 'Blocked', act: null, label: null },
};

/** The Team policy card (board 3.1): only while a requirement is open; one row per item with its chip and button. */
export function renderPolicyCard(doc, items, { plugins = [], catalog = [] } = {}) {
  const open = list(items).filter((i) => Object.hasOwn(POLICY, i?.state));
  if (!open.length) return null;
  const card = h(doc, 'section', 'card mk-policy');
  card.setAttribute('aria-label', 'Team policy');
  const head = h(doc, 'div', 'mk-policy-head');
  const setup = button(doc, 'btn btn-sm btn-quiet mk-policy-setup', 'Set up…');
  setup.dataset.focusKey = 'policy-checklist';
  const id = h(doc, 'div', 'mk-policy-id');
  id.append(h(doc, 'b', 'mk-policy-title', 'Team policy'), h(doc, 'span', 'mk-meta', policySummary(open)));
  head.append(glyphTile(doc, 'shield', 'none', { size: 'sm' }), id, setup);
  const rows = h(doc, 'ul', 'mk-rows');
  const installed = new Map(list(plugins).map((p) => [p?.name, p]));
  for (const item of open) {
    const p = POLICY[item.state];
    const row = installed.get(item.name);
    const hit = row ? null : findCatalogItem(catalog, item.name, item.marketplace);
    const tile = row ? tileFor(doc, row) : kindTile(doc, hit?.iconKind || 'none', { size: 'sm' });
    const { li, line } = rowShell(doc, tile);
    li.classList.add('mk-policy-row');
    li.dataset.name = item.name;
    li.dataset.state = item.state;
    line.append(h(doc, 'span', 'mk-pname', item.name));
    if (item.minVersion) line.append(h(doc, 'span', 'mk-ver', `≥ ${item.minVersion}`));
    line.append(chip(doc, p.tone, p.chip));
    // A linked plugin has no repo to update from (the server refuses its update): Outdated, and no button.
    if (p.act && !(item.state === 'outdated' && row?.linked)) li.append(actBtn(doc, p.act, item.name, p.label));
    rows.append(li);
  }
  card.append(head, rows);
  return card;
}

/** Needs attention: Update / Review (L7), Needs setup with the live channel chip, problems with chips and lines. */
export function renderAttention(doc, items, { channelStatus = [] } = {}) {
  const all = list(items);
  if (!all.length) return null;
  const sec = h(doc, 'section', 'mk-attention');
  sec.setAttribute('aria-labelledby', 'mk-h-attn');
  const rows = h(doc, 'ul', 'mk-rows card');
  for (const { reason, row } of all) {
    const name = row.name;
    const { li, main, line } = rowShell(doc, tileFor(doc, row));
    li.dataset.name = name;
    li.dataset.reason = reason;
    line.append(h(doc, 'span', 'mk-pname', name));
    let btn;
    if (reason === 'update') {
      const u = updateOf(row);
      line.append(h(doc, 'span', 'mk-ver', `${u.from} → ${u.to}`), chip(doc, 'upd', `Update ${u.to}`, { icon: 'arrow-up' }));
      btn = u.review ? actBtn(doc, 'review', name, 'Review') : actBtn(doc, 'update', name, 'Update');
    } else if (reason === 'setup') {
      line.append(...[verSpan(doc, row), chip(doc, 'warn', 'Needs setup')].filter(Boolean));
      for (const c of list(channelStatus)) if (c?.plugin === name) line.append(channelBadge(doc, c));
      btn = actBtn(doc, 'setup', name, 'Set up');
    } else {
      const { chips, lines } = problemsOf(row);
      line.append(...[verSpan(doc, row)].filter(Boolean), ...chips.map((c) => chip(doc, c.tone, c.label, c.key === 'ignored' ? { icon: 'alert' } : {})));
      if (lines.length) {
        const ul = h(doc, 'ul', 'mk-lines');
        for (const text of lines) ul.append(h(doc, 'li', null, text));
        main.append(ul);
      }
      btn = actBtn(doc, 'health', name, 'Check health');
    }
    li.append(btn);
    rows.append(li);
  }
  sec.append(secHead(doc, 'Needs attention', all.length, 'mk-h-attn'), rows);
  return sec;
}

// The row meta: counted kinds (the MCP part links to Connectors), then the marketplace; null when both are empty.
function rowMeta(doc, row) {
  const parts = kindsMeta(row).map((m) => {
    if (m.kind !== 'mcpServers') return doc.createTextNode(m.text);
    const a = h(doc, 'a', null, m.text);
    a.setAttribute('href', '#connectors/servers');
    return a;
  });
  if (row.marketplaceName) parts.push(doc.createTextNode(String(row.marketplaceName)));
  if (!parts.length) return null;
  const meta = h(doc, 'div', 'mk-meta');
  parts.forEach((p, i) => { if (i) meta.append(doc.createTextNode(' · ')); meta.append(p); });
  return meta;
}

/** All installed: one calm row per plugin, alphabetical — tile, name, version, chips, meta, switch, ⋯. */
export function renderAllInstalled(doc, plugins) {
  const all = list(plugins).filter(Boolean).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const sec = h(doc, 'section', 'mk-all');
  sec.setAttribute('aria-labelledby', 'mk-h-all');
  const rows = h(doc, 'ul', 'mk-rows card');
  for (const row of all) {
    const name = row.name;
    const { li, main, line } = rowShell(doc, tileFor(doc, row));
    li.dataset.name = name;
    const nameBtn = button(doc, 'mk-name', name);
    nameBtn.dataset.name = name;
    nameBtn.dataset.focusKey = `name:${name}`;
    line.append(...[nameBtn, verSpan(doc, row)].filter(Boolean));
    if (row.linked) {
      const linked = chip(doc, 'n', 'linked', { icon: 'link' });
      linked.classList.add('mk-linked');
      line.append(linked);
    }
    const notes = list(row.notes);
    if (notes.length) {
      const c = chip(doc, 'n', `${notes.length} manifest note${notes.length === 1 ? '' : 's'}`);
      c.classList.add('mk-notes-chip');
      c.title = notes.map(noteText).join('\n');
      line.append(c);
    }
    const meta = rowMeta(doc, row);
    if (meta) main.append(meta);
    const sw = h(doc, 'label', 'mk-switch');
    const input = h(doc, 'input', 'sw-input mk-enable');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.checked = row.enabled !== false;
    input.dataset.name = name;
    input.dataset.focusKey = `enable:${name}`;
    input.setAttribute('aria-label', `Enable ${name}`);
    sw.append(input, h(doc, 'span', 'switch'));
    const more = button(doc, 'btn btn-sm btn-quiet btn-icon mk-more');
    more.dataset.name = name;
    more.dataset.focusKey = `more:${name}`;
    more.setAttribute('aria-label', `More actions for ${name}`);
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.append(icon(doc, 'more', 14));
    li.append(sw, more);
    rows.append(li);
  }
  sec.append(secHead(doc, 'All installed', all.length, 'mk-h-all'), rows);
  return sec;
}

/** Leftover data: a neutral tile with the old glyph, the name, "Removed · settings and secrets remain", Purge. */
export function renderLeftover(doc, orphans, { catalog = [] } = {}) {
  const all = list(orphans).filter((o) => o?.name);
  if (!all.length) return null;
  const sec = h(doc, 'section', 'mk-leftover');
  sec.setAttribute('aria-labelledby', 'mk-h-left');
  const title = h(doc, 'h3', 'subsection-title', 'Leftover data');
  title.id = 'mk-h-left';
  const rows = h(doc, 'ul', 'mk-rows card');
  for (const o of all) {
    const { li, main, line } = rowShell(doc, glyphTile(doc, glyphOf(leftoverIconKind(catalog, o.name)), 'none', { size: 'sm' }));
    li.classList.add('mk-orphan');
    li.dataset.name = o.name;
    line.append(h(doc, 'span', 'mk-pname', o.name));
    main.append(h(doc, 'span', 'mk-meta', 'Removed · settings and secrets remain'));
    const purge = actBtn(doc, 'purge', o.name, 'Purge');
    purge.classList.add('btn-quiet', 'mk-purge');
    li.append(purge);
    rows.append(li);
  }
  sec.append(title, rows);
  return sec;
}

/** Nothing installed yet (SM36): the neutral bag tile, the title, "Browse {n} plugins" when there is something to browse. */
export function renderNothingInstalled(doc, { total = 0 } = {}) {
  const box = h(doc, 'div', 'mk-empty');
  box.append(glyphTile(doc, 'bag', 'n', { size: 'lg' }), h(doc, 'h3', 'mk-empty-title', 'Nothing installed yet'));
  if (total > 0) {
    const a = h(doc, 'a', 'btn btn-primary mk-browse-all', `Browse ${total} plugin${total === 1 ? '' : 's'}`);
    a.setAttribute('href', '#marketplace/browse');
    box.append(a);
  }
  return box;
}

/** The whole tab: policy card?, then (plugins ? attention? + all : nothing installed), then leftover?. */
export function renderInstalledTab(doc, state) {
  const plugins = list(state?.plugins);
  const catalog = list(state?.catalog);
  const root = h(doc, 'div', 'mk-installed');
  const policy = renderPolicyCard(doc, policyItems(state?.policy, plugins), { plugins, catalog });
  if (policy) root.append(policy);
  if (plugins.length) {
    const attn = renderAttention(doc, attention(plugins), { channelStatus: list(state?.channelStatus) });
    if (attn) root.append(attn);
    root.append(renderAllInstalled(doc, plugins));
  } else {
    root.append(renderNothingInstalled(doc, { total: catalog.length }));
  }
  const left = renderLeftover(doc, state?.orphans, { catalog });
  if (left) root.append(left);
  return root;
}
