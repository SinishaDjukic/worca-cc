// ui/public/models/catalogue-view.mjs — draws the Catalogue tab (models-menu P4, DESIGN CAT-1…CAT-11) and the model
// side panel (PAN-1…PAN-6) from catalogue-model.mjs's view models. Pure DOM: `doc` is injected, nothing is fetched
// and no listener is bound. app.js finds every control by its class and data-* and owns the events, the menus and
// the copy button's click.
import { icon } from '../icons.mjs';
import { makeSwitch } from '../switch.mjs';
import { copyButton } from '../copy-button.mjs';
import { markTile, VENDOR_MARKS } from './brand-marks.mjs';

const el = (doc, tag, cls, text) => {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

const button = (doc, cls, text) => {
  const b = el(doc, 'button', cls, text);
  b.type = 'button';
  return b;
};

/** The filter chips in toolbar order; "Just imported" only while the page knows what was imported. */
const FILTERS = Object.freeze([['all', 'All'], ['used', 'In use'], ['setup', 'Needs setup'], ['imported', 'Just imported']]);
const SOURCES = Object.freeze([['any', 'Any source'], ['yours', 'Yours'], ['plugin', 'Plugin'], ['team', 'Team'], ['project', 'Project']]);

/** A view model's { kind, key } as a tile; a vendor's name is the image's alt. */
const mark = (doc, m, size) => markTile(doc, {
  kind: m.kind, key: m.key ?? '', size,
  label: m.kind === 'vendor' && Object.hasOwn(VENDOR_MARKS, m.key) ? VENDOR_MARKS[m.key].name : '',
});

/** State: one dot and one word. */
const stateWord = (doc, st) => el(doc, 'span', `mdl-st ${st.tone}`, st.text);

function toolbar(doc, vm, { query, filter, source }) {
  const bar = el(doc, 'div', 'mdl-toolbar');
  const search = el(doc, 'input', 'input mv-search');
  search.type = 'search';
  search.setAttribute('placeholder', 'Search models');
  search.setAttribute('aria-label', 'Search models');
  search.value = query;
  const chips = el(doc, 'div', 'mv-filters');
  const counts = vm.chips || {};
  for (const [key, word] of FILTERS) {
    if (key === 'imported' && counts.imported == null) continue;
    const chip = button(doc, 'filter-chip', word);
    chip.dataset.filter = key;
    chip.setAttribute('aria-pressed', String(filter === key));
    chip.append(el(doc, 'span', 'n', String(counts[key] ?? 0)));
    chips.append(chip);
  }
  const select = el(doc, 'select', 'select-sm mdl-source');
  select.setAttribute('aria-label', 'Source');
  for (const [value, word] of SOURCES) {
    const option = el(doc, 'option', null, word);
    option.value = value;
    select.append(option);
  }
  select.value = source;
  bar.append(search, chips, select);
  return bar;
}

/** div.mdl-sub-h: the way of reaching models, its count, its state and fix, and on the built-in line the switch. */
function subHead(doc, engine, s) {
  const head = el(doc, 'div', 'mdl-sub-h');
  head.dataset.sub = s.key;
  head.append(el(doc, 'span', 'mdl-sub-name', s.name), el(doc, 'span', 'badge', String(s.count)));
  if (s.state) head.append(stateWord(doc, s.state));
  if (s.fixRow && s.state) {
    const fix = button(doc, 'btn btn-sm mdl-fix', s.state.fix);
    fix.dataset.row = s.fixRow;
    head.append(fix);
  }
  if (s.hide) {
    const { row } = makeSwitch(doc, {
      label: 'Hide built-in models', ariaLabel: s.hide.ariaLabel, checked: s.hide.on,
      inputClass: 'mv-hide-builtin', rowClass: 'mdl-hide', data: { engine },
    });
    head.append(row);
  }
  return head;
}

/** button.row-btn.mdl-row.mdl-cols: model (mark, name, chip), used by, status, chevron. */
function modelRow(doc, r) {
  const row = button(doc, 'row-btn mdl-row mdl-cols');
  row.dataset.id = r.id;
  if (r.used) row.classList.add('mdl-used');
  if (r.selected) row.classList.add('mdl-sel');
  const model = el(doc, 'span', 'mdl-row-model');
  model.append(mark(doc, r.mark, 'md'), el(doc, 'span', 'mdl-row-name', r.name));
  if (r.chip) model.append(el(doc, 'span', 'badge slate', r.chip));
  const st = el(doc, 'span', 'mdl-row-st');
  if (r.state) st.append(stateWord(doc, r.state));
  row.append(model, el(doc, 'span', 'mdl-row-used', r.usedText || ''), st, icon(doc, 'chevron', 16, 'ic mdl-row-go'));
  return row;
}

/** section.mdl-grp: the harness head (fold toggle, More button) and, while open, its sub-groups and rows. */
function harnessGroup(doc, g) {
  const sect = el(doc, 'section', 'mdl-grp');
  sect.dataset.engine = g.engine;
  sect.setAttribute('aria-label', g.name);
  const head = el(doc, 'div', 'mdl-grp-head');
  const toggle = button(doc, 'row-btn mdl-grp-toggle');
  toggle.setAttribute('aria-expanded', String(!!g.open));
  const caret = el(doc, 'span', 'mdl-grp-caret');
  caret.append(icon(doc, 'chevron', 16));
  toggle.append(caret, markTile(doc, { kind: 'harness', key: g.engine, size: 'lg', label: '' }), el(doc, 'span', 'mdl-grp-title', g.name));
  if (g.nBuilt > 0) toggle.append(el(doc, 'span', 'badge', String(g.nBuilt)));
  if (g.customText) toggle.append(el(doc, 'span', 'badge mdl-grp-custom', g.customText));
  if (g.hiddenText) toggle.append(el(doc, 'span', 'badge', g.hiddenText));
  if (g.isDefault) toggle.append(el(doc, 'span', 'badge slate', 'Default'));
  if (g.beta) toggle.append(el(doc, 'span', 'badge blue', 'Beta'));
  if (g.state) toggle.append(stateWord(doc, g.state));
  const more = button(doc, 'btn btn-quiet btn-sm btn-icon mdl-grp-more');
  more.setAttribute('aria-label', `More for ${g.name}`);
  more.append(icon(doc, 'more', 16));
  head.append(toggle, more);
  sect.append(head);
  if (g.open) {
    const body = el(doc, 'div', 'mdl-grp-body');
    for (const s of g.subs) {
      body.append(subHead(doc, g.engine, s));
      if (s.note) body.append(el(doc, 'div', 'mdl-note', s.note));
      for (const r of s.rows) body.append(modelRow(doc, r));
    }
    sect.append(body);
  }
  return sect;
}

/** → div.mdl-cat:
 *   div.mdl-toolbar: input.input.mv-search[type=search][placeholder="Search models"][aria-label="Search models"] (value = query),
 *     div.mv-filters > button.filter-chip[data-filter][aria-pressed = filter === key] "All", "In use", "Needs setup",
 *       and "Just imported" only when vm.chips.imported != null; each with span.n,
 *     select.select-sm.mdl-source[aria-label="Source"] (any "Any source", yours "Yours", plugin "Plugin", team "Team",
 *       project "Project"; value = source)
 *   div.mdl-scroll > div.mdl-list:
 *     div.mdl-cols.mdl-cols-head[aria-hidden="true"]: four spans "Model", "Used by", "Status", ""
 *     section.mdl-grp[data-engine] per group:
 *       div.mdl-grp-head: button.row-btn.mdl-grp-toggle[aria-expanded] (chevron icon, harness markTile lg, span.mdl-grp-title,
 *         span.badge for nBuilt (> 0), customText, hiddenText; span.badge.slate "Default"; span.badge.blue "Beta";
 *         span.mdl-st.<tone> when state), button.btn.btn-quiet.btn-sm.btn-icon.mdl-grp-more[aria-label="More for <name>"] (icon more)
 *       div.mdl-grp-body only when open; per sub: div.mdl-sub-h[data-sub] (name, span.badge count, span.mdl-st.<tone>
 *         when state, button.btn.btn-sm.mdl-fix[data-row] with state.fix when fixRow; on the built-in sub the switch
 *         row: makeSwitch label "Hide built-in models", ariaLabel hide.ariaLabel, checked hide.on, inputClass
 *         'mv-hide-builtin', data { engine }), div.mdl-note when note,
 *         button.row-btn.mdl-row.mdl-cols[data-id] per row, exactly four children: span.mdl-row-model (markTile(row.mark, md),
 *         span.mdl-row-name with the name only, span.badge.slate chip), span.mdl-row-used, span.mdl-row-st
 *         (span.mdl-st.<tone> when state), chevron icon; class mdl-used when used, mdl-sel when selected
 *   div.mdl-nomatch ("No model matches" + button.btn.btn-sm.mdl-show-all "Show all") when vm.noMatch */
export function renderCatalogue(vm, { doc = globalThis.document, query = '', filter = 'all', source = 'any' } = {}) {
  const v = vm || {};
  const root = el(doc, 'div', 'mdl-cat');
  root.append(toolbar(doc, v, { query: String(query ?? ''), filter, source }));
  const scroll = el(doc, 'div', 'mdl-scroll');
  const list = el(doc, 'div', 'mdl-list');
  const cols = el(doc, 'div', 'mdl-cols mdl-cols-head');
  cols.setAttribute('aria-hidden', 'true');
  for (const word of ['Model', 'Used by', 'Status', '']) cols.append(el(doc, 'span', null, word));
  list.append(cols);
  for (const g of Array.isArray(v.groups) ? v.groups : []) list.append(harnessGroup(doc, g));
  scroll.append(list);
  root.append(scroll);
  if (v.noMatch) {
    const none = el(doc, 'div', 'mdl-nomatch');
    none.append(el(doc, 'span', 'mdl-nomatch-text', 'No model matches'), button(doc, 'btn btn-sm mdl-show-all', 'Show all'));
    root.append(none);
  }
  return root;
}

/** The panel's one line of actions (PAN-3), or null when the model has none. */
function actionRow(doc, a) {
  const row = el(doc, 'div', 'mdl-acts');
  if (a.test && a.test.shown) {
    const test = button(doc, 'btn btn-sm mdl-act', 'Test');
    test.dataset.act = 'test';
    if (a.test.disabled) {
      test.disabled = true;
      if (a.test.title) test.title = a.test.title;
    }
    const result = el(doc, 'span', 'mdl-test-result');
    result.setAttribute('aria-live', 'polite');
    row.append(test, result);
  }
  for (const [key, word] of [['edit', 'Edit'], ['duplicate', 'Duplicate'], ['copy', 'Edit a copy'], ['promote', 'Promote to global']]) {
    if (!a[key]) continue;
    const b = button(doc, 'btn btn-sm mdl-act', word);
    b.dataset.act = key;
    row.append(b);
  }
  if (a.del) {
    const more = button(doc, 'btn btn-quiet btn-sm btn-icon mdl-act-more');
    more.setAttribute('aria-label', 'More');
    more.append(icon(doc, 'more', 16));
    row.append(more);
  }
  return row.childElementCount ? row : null;
}

/** dl.mdl-facts of { k, v, mono?, copy?, mark? }. */
function factList(doc, facts) {
  const dl = el(doc, 'dl', 'mdl-facts');
  for (const f of facts) {
    const dd = el(doc, 'dd', f.mono ? 'mono' : null);
    if (f.mark) dd.append(mark(doc, f.mark, 'sm'));
    dd.append(el(doc, 'span', 'mdl-fact-v', f.v));
    if (f.copy) dd.append(copyButton(doc, { name: 'Copy the ID', cls: 'mdl-copy-id' }));
    dl.append(el(doc, 'dt', null, f.k), dd);
  }
  return dl;
}

/** → aside#model-panel.mdl-side[aria-label=<name>] or null:
 *   head (markTile lg, h2.mdl-side-title, span.mdl-st.<tone>, button.btn.btn-quiet.btn-sm.btn-icon.mdl-side-close[aria-label="Close"] (icon x));
 *   button.btn.btn-sm.mdl-act[data-act=test|edit|duplicate|copy|promote] ("Test", "Edit", "Duplicate", "Edit a copy",
 *     "Promote to global"; Test disabled + title), span.mdl-test-result after Test, button.btn.btn-quiet.btn-sm.btn-icon.mdl-act-more
 *     [aria-label="More"] (icon more) when del (not also .mdl-act);
 *   dl.mdl-facts (dd.mono where `mono`; the ID's dd holds copyButton(doc, { name: 'Copy the ID', cls: 'mdl-copy-id' });
 *   markTile sm for a mark); secrets ("<KEY>: set" / "<KEY>: not set"); h3.mdl-sect "Limits" + dl only when
 *   limits.length (PAN-5); h3.mdl-sect "Used by" + "No job yet" or button.row-btn.mdl-use[data-engine] per use. */
export function renderModelPanel(panel, { doc = globalThis.document } = {}) {
  if (!panel) return null;
  const side = el(doc, 'aside', 'mdl-side');
  side.id = 'model-panel';
  side.setAttribute('aria-label', panel.name);

  const head = el(doc, 'div', 'mdl-side-head');
  const titles = el(doc, 'div', 'mdl-side-titles');
  titles.append(el(doc, 'h2', 'mdl-side-title', panel.name));
  if (panel.state) titles.append(stateWord(doc, panel.state));
  const close = button(doc, 'btn btn-quiet btn-sm btn-icon mdl-side-close');
  close.setAttribute('aria-label', 'Close');
  close.append(icon(doc, 'x', 16));
  head.append(mark(doc, panel.mark, 'lg'), titles, close);
  side.append(head);

  const acts = actionRow(doc, panel.actions || {});
  if (acts) side.append(acts);

  const facts = el(doc, 'div', 'mdl-side-sec');
  facts.append(factList(doc, panel.facts || []));
  if (panel.secrets && panel.secrets.length) {
    const secrets = el(doc, 'div', 'mdl-secrets');
    for (const s of panel.secrets) {
      const line = el(doc, 'div', 'mdl-secret');
      line.append(el(doc, 'span', 'mono', s.key), s.set ? ': set' : ': not set');
      secrets.append(line);
    }
    facts.append(secrets);
  }
  side.append(facts);

  if (panel.limits && panel.limits.length) {
    const limits = el(doc, 'div', 'mdl-side-sec');
    limits.append(el(doc, 'h3', 'mdl-sect', 'Limits'), factList(doc, panel.limits));
    side.append(limits);
  }

  const used = el(doc, 'div', 'mdl-side-sec');
  used.append(el(doc, 'h3', 'mdl-sect', 'Used by'));
  if (panel.uses && panel.uses.length) {
    const list = el(doc, 'div', 'mdl-uses');
    for (const u of panel.uses) {
      const b = button(doc, 'row-btn mdl-use');
      b.dataset.engine = u.engine;
      b.append(el(doc, 'span', 'mdl-use-label', u.label), el(doc, 'span', 'mdl-use-kind', u.kindText));
      list.append(b);
    }
    used.append(list);
  } else {
    used.append(el(doc, 'p', 'mdl-nouse', 'No job yet'));
  }
  side.append(used);
  return side;
}
