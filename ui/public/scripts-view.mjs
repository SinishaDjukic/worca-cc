// ui/public/scripts-view.mjs
// The Scripts page (scripts-workbench design §5): one view, `scripts`, with a hash
// param parsed the way #projects/<key>/… is (C1). Pure renderers plus ONE
// controller that app.js mounts from showView and destroys on leave — the
// createMemoryController shape (C2), so app.js stays out of the feature.
//
// House rule, pinned by a test: NO explanatory prose on this page. Labels, chips
// and error sentences only; the one caption the shared params form carries
// (script-forms.mjs PARAMS_CAPTION) is the single exception.
import {
  h, select, toggle, number, text, renderParamDefsEditor, collectParamDefs,
  renderPortEditor, collectPorts, applyPortEdit,
} from './script-forms.mjs';
import { createCodeEditor, escapeHtml } from './code-editor.mjs';
import { renderBench, createBenchController } from './script-bench-view.mjs';

export const SCRIPT_TABS = ['overview', 'source', 'test'];
/** `new` is a script key the store refuses (RESERVED_SCRIPT_KEYS), so the create
 *  page can live at #scripts/new without shadowing a real script. */
export const RESERVED_PARAM = 'new';

/** The hash for a script (Overview is the bare form, as projParamFor does it). */
export function scriptRoute(key = '', tab = '') {
  if (!key) return 'scripts';
  return tab && tab !== 'overview' && SCRIPT_TABS.includes(tab) ? `scripts/${key}/${tab}` : `scripts/${key}`;
}

/** '' | 'new' | '<key>' | '<key>/<tab>'. parseHash already split off the view, so
 *  this splits on the FIRST '/' only; an unknown tab word reads as Overview
 *  (History leaves an odd param alone the same way). */
export function parseScriptsParam(param = '') {
  const s = String(param || '');
  if (!s) return { mode: 'list' };
  const i = s.indexOf('/');
  const key = i === -1 ? s : s.slice(0, i);
  const rest = i === -1 ? '' : s.slice(i + 1);
  const j = rest.indexOf('/');
  const word = j === -1 ? rest : rest.slice(0, j);
  const tab = SCRIPT_TABS.includes(word) ? word : 'overview';
  // The create page wears the same tab bar as any other, so #scripts/new/source
  // has to parse — `new` is a key the store refuses, never a real script.
  if (key === RESERVED_PARAM) return { mode: 'new', tab };
  return { mode: 'detail', key, tab };
}

/** 'builtin' -> 'built-in', 'plugin:tools' -> 'tools'. */
export function originLabel(origin) {
  const o = String(origin || '');
  if (o.startsWith('plugin:')) return o.slice('plugin:'.length);
  return o === 'user' ? 'user' : 'built-in';
}

/** The registry's port sentence, or the config-ports wording (spec §5.1). */
export function portLineOf(s) {
  return s && s.ports === 'config' ? 'ports per card' : String((s && s.portSummary) || '');
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** This session's dot for a script (C10, W15): green when every stored case
 *  passed, red on any failure, grey when something ran, hollow when nothing did. */
function caseDotState(caseCount, states) {
  if (!states || states.size === 0) return 'none';
  const seen = [...states.values()];
  if (seen.includes('fail')) return 'fail';
  if (seen.length >= caseCount && seen.every((v) => v === 'pass')) return 'pass';
  return 'ran';
}

/** A script's card (spec §5.1). Every string is textContent — a plugin's display
 *  name and description are untrusted text. */
export function buildScriptCard(s, { doc = globalThis.document, runtimes = {}, caseState = new Map() } = {}) {
  const card = h(doc, 'section', 'card script-card');
  card.dataset.scriptKey = s.key || '';
  const main = h(doc, 'div', 'script-card-main');
  const head = h(doc, 'div', 'script-card-head');
  head.appendChild(h(doc, 'b', 'script-name', s.displayName || s.key || ''));
  head.appendChild(h(doc, 'span', 'badge script-origin', originLabel(s.origin)));
  head.appendChild(h(doc, 'span', 'chip script-runtime mono', s.runtime || ''));
  // A python script on a host without python: a NOTICE chip, never a block (W4).
  const probe = runtimes && runtimes[s.runtime];
  if (s.runtime === 'python' && probe && probe.ok === false) head.appendChild(h(doc, 'span', 'chip script-warn', 'python not found'));
  main.appendChild(head);
  if (s.description) main.appendChild(h(doc, 'small', 'script-desc', s.description));
  const meta = h(doc, 'div', 'script-meta');
  meta.appendChild(h(doc, 'span', 'script-ports', portLineOf(s)));
  const cases = Number(s.caseCount) || 0;
  if (cases > 0) {
    meta.appendChild(h(doc, 'span', 'chip script-cases', plural(cases, 'case')));
    const dot = h(doc, 'i', 'script-dot');
    dot.dataset.state = caseDotState(cases, caseState.get(s.key));
    meta.appendChild(dot);
  }
  main.appendChild(meta);
  card.appendChild(main);
  const actions = h(doc, 'div', 'script-actions');
  const btn = (cls, label, kind) => { const b = h(doc, 'button', `btn ${kind} btn-mini ${cls}`, label); b.type = 'button'; return b; };
  actions.append(btn('script-open', 'Open', 'btn-ghost'), btn('script-duplicate', 'Duplicate', 'btn-ghost'));
  if (s.origin === 'user') actions.appendChild(btn('script-delete', 'Delete', 'btn-danger'));
  card.appendChild(actions);
  return card;
}

/** The list pane: the topbar (title, filter, New script) and the cards. The
 *  filter is a pure argument, so a repaint never loses what was typed. */
export function renderScriptsList(list, { doc = globalThis.document, query = '', runtimes = {}, caseState = new Map() } = {}) {
  const pane = h(doc, 'div', 'scripts-pane');
  const bar = h(doc, 'div', 'topbar');
  const left = h(doc, 'div');
  left.appendChild(h(doc, 'h1', '', 'Scripts'));
  const tools = h(doc, 'div', 'scripts-tools');
  const filter = doc.createElement('input');
  filter.type = 'search'; filter.className = 'input script-filter'; filter.value = query;
  filter.placeholder = 'Filter scripts'; filter.setAttribute('aria-label', 'Filter scripts');
  const add = h(doc, 'button', 'btn btn-primary btn-mini script-new', 'New script');
  add.type = 'button';
  tools.append(filter, add);
  bar.append(left, tools);
  pane.appendChild(bar);
  const rows = h(doc, 'div', 'run-list scripts-list');
  const all = Array.isArray(list) ? list : [];
  const q = String(query || '').trim().toLowerCase();
  const hit = (s) => !q || [s.key, s.displayName, s.runtime, originLabel(s.origin)]
    .some((v) => String(v || '').toLowerCase().includes(q));
  const shown = all.filter(hit);
  if (!shown.length) rows.appendChild(h(doc, 'div', 'scripts-empty', q ? `No scripts match “${query}”.` : 'No scripts.'));
  else for (const s of shown) rows.appendChild(buildScriptCard(s, { doc, runtimes, caseState }));
  pane.appendChild(rows);
  return pane;
}

export const SCRIPT_COLORS = ['green', 'peach', 'red', 'blue', 'violet', 'amber'];
export const SCRIPT_RUNTIME_IDS = ['node', 'shell', 'python'];
export const EDITOR_LANGUAGE = { node: 'javascript', shell: 'bash', python: 'python' };

// The scaffold templates live in src/shared (P3 Task 1): the Scripts page, the
// `worca script new` CLI and `worca plugin new-script` must emit the SAME file.
import {
  SCRIPT_TEMPLATES, SCRIPT_WIN32_TEMPLATE, SHELL_COMMAND_TEMPLATE, blankScriptMeta,
} from '../../src/shared/graph/script-templates.mjs';

export { SCRIPT_TEMPLATES, SCRIPT_WIN32_TEMPLATE, SHELL_COMMAND_TEMPLATE, blankScriptMeta };

/** `GET /api/scripts/:key` answers `{ meta, source, sourceWin32, sourcePath,
 *  sourceTruncated, cases, userCases, casesWritable }` (Task 4); P1b's earlier
 *  read route spread the meta flat. Accept both — a route shape cannot break the
 *  page, and the create/update bodies use the nested one. */
const PAYLOAD_KEYS = ['source', 'sourceWin32', 'sourcePath', 'sourceTruncated', 'cases', 'userCases', 'casesWritable'];
const lf = (s) => (typeof s === 'string' ? s.replace(/\r\n|\r/g, '\n') : '');

/**
 * ONE shape inside the page. `GET /api/scripts/:key` spreads the meta FLAT (P1b's
 * landed contract, kept by Task 4); every WRITE route answers the store's nested
 * `{ meta, source, … }`. This adapter runs once at the boundary, so no renderer and
 * no controller helper ever has to ask which one it holds. Program text is
 * normalised to LF here as well: a <textarea> hands back LF whatever it was given,
 * and the hidden mirror of the off-screen half would otherwise keep a CRLF the
 * visible editor cannot — the page would read as dirty after a tab hop. The store
 * owns the on-disk ending of a `.cmd` (script-store.mjs programText).
 */
export function scriptPayload(data) {
  const d = data && typeof data === 'object' ? data : {};
  const nested = !!d.meta && typeof d.meta === 'object';
  const meta = nested ? d.meta : Object.fromEntries(Object.entries(d).filter(([k]) => !PAYLOAD_KEYS.includes(k)));
  return {
    meta,
    source: lf(d.source),
    sourceWin32: lf(d.sourceWin32),
    sourcePath: d.sourcePath || null,
    sourceTruncated: d.sourceTruncated === true,
    cases: Array.isArray(d.cases) ? d.cases : [],
    userCases: Array.isArray(d.userCases) ? d.userCases : [],
    casesWritable: d.casesWritable !== false,
  };
}

// A sidecar's `command` is a string or a per-platform map { default, win32, … }
// (both legal, script-meta.mjs readPlatformValue). The editor holds the DEFAULT
// entry; the other entries ride a hidden field so a save never flattens the map.
const commandText = (c) => (typeof c === 'string' ? c : (c && typeof c.default === 'string' ? c.default : ''));
const commandExtra = (c) => {
  if (!c || typeof c !== 'object') return '';
  const { default: _d, ...rest } = c;
  return Object.keys(rest).length ? JSON.stringify(rest) : '';
};
function joinCommand(text, extraJson) {
  let extra = {};
  try { extra = extraJson ? JSON.parse(extraJson) : {}; } catch { extra = {}; }
  return extra && typeof extra === 'object' && Object.keys(extra).length ? { default: text, ...extra } : text;
}
const csv = (list) => (Array.isArray(list) ? list.join(', ') : '');
// A BLANK entry is no exit code: `Number('')` is a finite 0, so an EMPTY box read
// back as `[0]` — a brand-new shell script arrived with 0 listed as both clean and
// blocking and the validator refused every Save, and clearing one of the two boxes
// silently put 0 back instead of emptying the list.
const ints = (s) => String(s || '').split(',').map((x) => x.trim()).filter((x) => x !== '')
  .map(Number).filter((n) => Number.isInteger(n));
/** A shell script edits a FILE when its meta names one, a command otherwise. */
const shellMode = (meta) => (meta.runtime === 'shell' && !meta.file ? 'command' : 'file');

function detailHead(doc, meta, { readOnly, isNew, runtimes }) {
  const bar = h(doc, 'div', 'topbar');
  const left = h(doc, 'div');
  left.appendChild(h(doc, 'h1', 'script-title', isNew ? 'New script' : (meta.displayName || meta.key || '')));
  const chips = h(doc, 'div', 'script-chips');
  chips.append(h(doc, 'span', 'badge script-origin', originLabel(meta.origin)),
    h(doc, 'span', 'chip script-runtime mono', meta.runtime || ''));
  const probe = runtimes && runtimes[meta.runtime];
  if (meta.runtime === 'python' && probe && probe.ok === false) chips.appendChild(h(doc, 'span', 'chip script-warn', 'python not found'));
  const dirty = h(doc, 'span', 'chip script-dirty', 'unsaved');
  dirty.hidden = true;
  chips.appendChild(dirty);
  left.appendChild(chips);
  const actions = h(doc, 'div', 'script-detail-actions');
  const btn = (cls, label, kind) => { const b = h(doc, 'button', `btn ${kind} btn-mini ${cls}`, label); b.type = 'button'; return b; };
  actions.appendChild(btn('script-back', 'Scripts', 'btn-ghost'));
  if (!isNew) actions.appendChild(btn('script-duplicate', 'Duplicate', 'btn-ghost'));
  if (!isNew && meta.origin === 'user') actions.appendChild(btn('script-delete', 'Delete', 'btn-danger'));
  if (!readOnly) actions.appendChild(btn('script-save', 'Save', 'btn-primary'));
  bar.append(left, actions);
  return bar;
}

function overviewPane(doc, meta, { readOnly, isNew, runtimes, sourcePath = '' }) {
  const pane = h(doc, 'div', 'script-pane');
  pane.dataset.pane = 'overview';
  const form = h(doc, 'div', 'script-form');
  const lock = (wrap) => {
    if (!readOnly) return wrap;
    for (const c of wrap.querySelectorAll('input,select,textarea')) c.disabled = true;
    return wrap;
  };
  const pair = (a, b) => { const g = h(doc, 'div', 'field-grid-2'); g.append(a, b); return g; };
  form.appendChild(lock(pair(
    text(doc, 'script-f', 'meta:displayName', 'Display name', meta.displayName),
    isNew ? text(doc, 'script-f', 'meta:key', 'Key', meta.key) : text(doc, 'script-f', 'meta:domain', 'Domain', meta.domain),
  )));
  form.appendChild(lock(text(doc, 'script-f', 'meta:description', 'Description', meta.description)));
  const runtimeField = select(doc, 'script-f', 'meta:runtime', 'Runtime',
    SCRIPT_RUNTIME_IDS.map((r) => ({ value: r, text: r })), meta.runtime || 'node');
  for (const opt of runtimeField.querySelectorAll('option')) {
    const probe = runtimes && runtimes[opt.value];
    if (probe && probe.ok === false) { opt.disabled = true; opt.title = probe.reason || 'not available on this machine'; }
  }
  form.appendChild(lock(pair(runtimeField, isNew
    ? text(doc, 'script-f', 'meta:domain', 'Domain', meta.domain)
    : select(doc, 'script-f', 'meta:color', 'Color', SCRIPT_COLORS.map((c) => ({ value: c, text: c })), meta.color || 'amber'))));
  if (isNew) form.appendChild(lock(pair(
    select(doc, 'script-f', 'meta:color', 'Color', SCRIPT_COLORS.map((c) => ({ value: c, text: c })), meta.color || 'amber'),
    text(doc, 'script-f', 'meta:icon', 'Icon', meta.icon),
  )));
  else form.appendChild(lock(pair(
    text(doc, 'script-f', 'meta:icon', 'Icon', meta.icon),
    number(doc, 'script-f', 'meta:order', 'Order', Number.isFinite(meta.order) ? meta.order : 50, 0),
  )));
  const timeout = number(doc, 'script-f', 'meta:timeoutSec', 'Timeout (s)', Math.round((meta.timeoutMs || 600000) / 1000), 1);
  form.appendChild(lock(isNew
    ? pair(number(doc, 'script-f', 'meta:order', 'Order', Number.isFinite(meta.order) ? meta.order : 50, 0), timeout)
    : pair(timeout, text(doc, 'script-f', 'meta:verdictFilename', 'Verdict filename', meta.verdict && meta.verdict.filename))));
  if (isNew) form.appendChild(lock(text(doc, 'script-f', 'meta:verdictFilename', 'Verdict filename', meta.verdict && meta.verdict.filename)));
  if (meta.runtime === 'shell') {
    const codes = meta.exitCodes || {};
    form.appendChild(lock(pair(
      text(doc, 'script-f', 'meta:exitCodesClean', 'Clean exit codes', csv(codes.clean || [0])),
      text(doc, 'script-f', 'meta:exitCodesBlocking', 'Blocking exit codes', csv(codes.blocking || [1])),
    )));
  }
  form.appendChild(h(doc, 'div', 'script-zone', 'Params'));
  form.appendChild(renderParamDefsEditor(meta.params, { doc, readOnly }));
  form.appendChild(h(doc, 'div', 'script-zone', 'Ports'));
  const perCard = meta.ports === 'config';
  form.appendChild(lock(toggle(doc, 'script-f', 'meta:portsConfig', 'Ports per card', 'each placed card declares its own ports',
    { checked: perCard, disabled: readOnly })));
  const raw = perCard ? (meta.defaultPorts || { inputs: [], outputs: [] }) : { inputs: meta.inputs || [], outputs: meta.outputs || [] };
  form.appendChild(renderPortEditor(raw, { doc, hasVerdict: Boolean(meta.verdict), readOnly }));
  pane.appendChild(form);
  if (readOnly) {
    const row = h(doc, 'div', 'script-path-row');
    row.append(h(doc, 'code', 'script-path mono', sourcePath || meta.scriptPath || meta.commandResolved || ''),
      (() => { const b = h(doc, 'button', 'btn btn-ghost btn-mini script-copy', 'Copy'); b.type = 'button'; return b; })());
    pane.appendChild(row);
  }
  return pane;
}

function sourcePane(doc, data, { readOnly, highlight, srcMode, srcTab, editors }) {
  const meta = data.meta;
  const pane = h(doc, 'div', 'script-pane');
  pane.dataset.pane = 'source';
  const box = h(doc, 'div', 'script-source');
  box.dataset.srcMode = srcMode;
  box.dataset.srcTab = srcTab;
  if (meta.runtime === 'shell') {
    const seg = h(doc, 'div', 'seg script-src-mode');
    for (const [mode, label] of [['command', 'Command'], ['file', 'File']]) {
      const b = h(doc, 'button', mode === srcMode ? 'on' : '', label);
      b.type = 'button'; b.dataset.srcMode = mode; b.disabled = readOnly;
      b.setAttribute('aria-pressed', mode === srcMode ? 'true' : 'false');
      seg.appendChild(b);
    }
    box.appendChild(seg);
    if (srcMode === 'file') {
      const plat = h(doc, 'div', 'seg script-src-plat');
      for (const [id, label] of [['default', 'sh'], ['win32', 'win32']]) {
        const b = h(doc, 'button', id === srcTab ? 'on' : '', label);
        b.type = 'button'; b.dataset.srcTab = id; b.disabled = readOnly;
        b.setAttribute('aria-pressed', id === srcTab ? 'true' : 'false');
        plat.appendChild(b);
      }
      box.appendChild(plat);
    }
  }
  const mount = h(doc, 'div', 'script-editor-mount');
  const command = meta.runtime === 'shell' && srcMode === 'command';
  const win32 = srcMode === 'file' && srcTab === 'win32';
  const editor = createCodeEditor({
    doc,
    value: command ? commandText(meta.command) : (win32 ? data.sourceWin32 : data.source),
    language: command ? 'bash' : (EDITOR_LANGUAGE[meta.runtime] || 'javascript'),
    readOnly,
    rows: command ? 4 : 20,
    name: command ? 'meta:command' : (win32 ? 'script:sourceWin32' : 'script:source'),
    highlight,
  });
  editors.push(editor);
  mount.appendChild(editor.el);
  box.appendChild(mount);
  // The half that is not on screen still has to reach the server on Save, or a
  // save from the `sh` tab would blank the `.cmd` file (and vice versa).
  for (const [name, value] of [['script:source', data.source], ['script:sourceWin32', data.sourceWin32],
    ['meta:command', commandText(meta.command)], ['meta:commandExtra', commandExtra(meta.command)]]) {
    if (box.querySelector(`[data-field="${name}"]`)) continue;
    const keep = doc.createElement('input');
    keep.type = 'hidden'; keep.dataset.field = name; keep.value = value;
    box.appendChild(keep);
  }
  pane.appendChild(box);
  return pane;
}

/** The whole detail page. `root._editors` carries the code editors so the caller
 *  can tear them down before replacing the tree (the pane._search idiom). */
export function renderScriptDetail(data, {
  doc = globalThis.document, tab = 'overview', runtimes = {}, readOnly = false,
  highlight = async (t) => escapeHtml(t), isNew = false, srcMode = '', srcTab = 'default',
} = {}) {
  // The default ESCAPES (code-editor.mjs's own rule, C11): the editor's one
  // innerHTML write takes whatever the highlighter returns, so a caller that
  // forgets `highlight` must still not put a script's source there raw.
  data = scriptPayload(data);          // flat or nested in, ONE shape from here down
  const meta = data.meta;
  const editors = [];
  const root = h(doc, 'div', 'script-detail');
  root.dataset.scriptKey = meta.key || '';
  root.dataset.tab = tab;
  root._editors = editors;
  root.appendChild(detailHead(doc, meta, { readOnly, isNew, runtimes }));
  const tabs = h(doc, 'div', 'seg script-tabs');
  for (const t of SCRIPT_TABS) {
    const b = h(doc, 'button', t === tab ? 'on' : '', t === 'overview' ? 'Overview' : (t === 'source' ? 'Source' : 'Test'));
    b.type = 'button'; b.dataset.tab = t;
    b.setAttribute('aria-pressed', t === tab ? 'true' : 'false');
    if (t === 'test' && isNew) { b.disabled = true; b.title = 'Save the script first'; }
    tabs.appendChild(b);
  }
  root.appendChild(tabs);
  const panes = [
    overviewPane(doc, meta, { readOnly, isNew, runtimes, sourcePath: data.sourcePath || '' }),
    sourcePane(doc, data, { readOnly, highlight, srcMode: srcMode || shellMode(meta), srcTab, editors }),
  ];
  const testPane = h(doc, 'div', 'script-pane');
  testPane.dataset.pane = 'test';
  testPane.appendChild(h(doc, 'div', 'script-test-mount'));
  panes.push(testPane);
  for (const p of panes) { p.hidden = p.dataset.pane !== tab; root.appendChild(p); }
  return root;
}

/** Read the whole page back as the wire body `POST /api/scripts` takes. */
export function collectScriptDraft(root) {
  const val = (name) => { const n = root.querySelector(`[data-field="${name}"]`); return n ? String(n.value) : ''; };
  // A CLEARED box is `''`, and `Number('')` is a finite 0 — an emptied Timeout
  // would save a 1 s timeout (the MIN_TIMEOUT_MS floor below) and an emptied
  // Order would jump the script to the front of the palette. Blank = the default.
  const num = (name, fallback) => { const raw = val(name).trim(); const n = Number(raw); return raw !== '' && Number.isFinite(n) ? n : fallback; };
  const runtime = val('meta:runtime') || 'node';
  const meta = {
    key: val('meta:key') || root.dataset.scriptKey || '',
    metaVersion: 2,
    displayName: val('meta:displayName'),
    description: val('meta:description'),
    domain: val('meta:domain'),
    color: val('meta:color') || 'amber',
    icon: val('meta:icon'),
    order: num('meta:order', 50),
    runtime,
    timeoutMs: Math.max(1000, Math.round(num('meta:timeoutSec', 600) * 1000)),
    params: collectParamDefs(root),
  };
  // The OVERVIEW editor alone: the Test tab mounts a second port editor for a
  // `ports: "config"` script, and an unscoped read would take both copies — the
  // page would read as dirty the moment the bench mounted, so every Run would go
  // out as a W10 draft (refused outright on a built-in) and leaving would always
  // ask to discard.
  const ports = collectPorts(root.querySelector('.script-pane[data-pane="overview"]') || root);
  const box = root.querySelector('.script-source');
  const mode = box ? box.dataset.srcMode : shellMode(meta);
  // A key this form can CLEAR is always sent, as `null` when it is cleared: the
  // store merges a sent meta over the stored one and reads null as "remove"
  // (script-store.mjs stripNullKeys). Omitting it would keep the old value for ever
  // — a verdict nobody can delete, a `command` the validator refuses on node.
  const switchEl = root.querySelector('[data-field="meta:portsConfig"]');
  if (switchEl && switchEl.checked) {
    meta.ports = 'config'; meta.defaultPorts = ports; meta.inputs = null; meta.outputs = null;
  } else {
    meta.inputs = ports.inputs; meta.outputs = ports.outputs; meta.ports = null; meta.defaultPorts = null;
  }
  const verdict = val('meta:verdictFilename').trim();
  meta.verdict = verdict ? { filename: verdict } : null;
  meta.exitCodes = null;
  meta.command = null;
  if (runtime === 'shell') {
    const clean = ints(val('meta:exitCodesClean'));
    const blocking = ints(val('meta:exitCodesBlocking'));
    if (clean.length || blocking.length) meta.exitCodes = { clean, blocking };
    // A BLANK Command box is NO command — `null`, which the store reads as
    // "remove" — never `''`: the built-in `shell` (and every duplicate of it)
    // takes its command from a command-TYPED param and carries no meta.command
    // at all, so sending '' made the page refuse every Save of a script it had
    // just rendered ("command must be a non-empty string", with no field on the
    // page that could satisfy it).
    const command = val('meta:command');
    if (mode === 'command' && command.trim()) meta.command = joinCommand(command, val('meta:commandExtra'));
  }
  // A shell script in Command mode has NO file (spec §3.1); `meta.file` itself is
  // store-owned and never sent. `sourceWin32` is ALWAYS a string: '' drops the
  // .cmd (the store's contract) — null would mean "keep the stored one", which
  // would make the variant undeletable and a shell -> node switch unsavable.
  const file = !(runtime === 'shell' && mode === 'command');
  return {
    meta,
    source: file ? val('script:source') : '',
    sourceWin32: runtime === 'shell' && mode === 'file' ? val('script:sourceWin32') : '',
  };
}

/** The copy's key: <key>Copy, then <key>Copy2, … — the first nobody holds.
 *  Matched case-INSENSITIVELY, because the store's uniqueness is (one file holds
 *  `lintCopy` and `LintCopy` on macOS and Windows): an exact-match candidate that
 *  differs from a taken key only in case answers 409 on every press, and the
 *  Duplicate button has no other key to offer. */
function nextCopyKey(key, list) {
  const taken = new Set((list || []).map((s) => String((s && s.key) || '').toLowerCase()));
  for (let i = 1; ; i += 1) {
    const candidate = i === 1 ? `${key}Copy` : `${key}Copy${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * The page controller. app.js mounts ONE of these in showView('scripts') and
 * destroys it on leave; it owns the endpoint calls and exactly two delegated
 * listeners on `host`.
 */
export function createScriptsController({
  host, msgEl = null, api, navigate, confirm, highlight, renderMarkdown = async () => {}, modal = null,
  ws = null, doc = globalThis.document,
} = {}) {
  const st = {
    param: '', mode: 'list', key: '', tab: 'overview', query: '',
    list: [], runtimes: null, caseState: new Map(), flash: null,
    data: null, root: null, isNew: false, baseline: '', srcMode: '', srcTab: 'default',
    bench: null, benchMounting: false, benchMeta: '', projects: [],
  };
  // Request token: a route change, a frame poke and a write can all be in flight
  // at once, and the LAST one issued must win however the responses land.
  let seq = 0;
  const say = (textValue, kind) => {
    if (!msgEl) return;
    msgEl.textContent = textValue || '';
    msgEl.className = 'form-msg' + (kind ? ` ${kind}` : '');
  };
  const fail = (r) => say((r && r.data && r.data.error) || `HTTP ${r && r.status}`, 'err');

  function paintList() {
    const active = doc.activeElement;
    const typing = !!active && host.contains(active) && active.classList && active.classList.contains('script-filter');
    const caret = typing ? active.selectionStart : null;
    host.replaceChildren(renderScriptsList(st.list, { doc, query: st.query, runtimes: st.runtimes || {}, caseState: st.caseState }));
    if (!typing) return;
    // replaceChildren drops focus to <body>; hand the keyboard back to the box.
    const box = host.querySelector('.script-filter');
    if (!box || typeof box.focus !== 'function') return;
    box.focus({ preventScroll: true });
    try { box.setSelectionRange(caret, caret); } catch { /* not a text control */ }
  }

  /** Tear the mounted code editors down before the tree goes; a live debounce
   *  would otherwise repaint a detached node on the next tick. */
  function disposeDetail() {
    unmountBench();
    if (st.root && Array.isArray(st.root._editors)) for (const e of st.root._editors) e.destroy();
    st.root = null;
  }

  const readOnlyNow = () => !st.isNew && st.data.meta.origin !== 'user';

  /** `rebase` is passed on LOAD only. A structural repaint (add a port, switch the
   *  runtime or the source half) must NOT retake the baseline, or an edited page
   *  reads as clean: the leave-guard stops asking and onChanged() clobbers the draft. */
  function paintDetail({ rebase = false } = {}) {
    disposeDetail();
    const root = renderScriptDetail(st.data, {
      doc, tab: st.tab, runtimes: st.runtimes || {}, readOnly: readOnlyNow(),
      highlight, isNew: st.isNew, srcMode: st.srcMode, srcTab: st.srcTab,
    });
    st.root = root;
    st.srcMode = root.querySelector('.script-source').dataset.srcMode;
    host.replaceChildren(root);
    if (rebase) st.baseline = JSON.stringify(collectScriptDraft(root));
    syncDirty();
    if (st.tab === 'test') void mountBench();
  }

  function syncDirty() {
    const mark = st.root && st.root.querySelector('.script-dirty');
    if (mark) mark.hidden = !isDirty();
  }

  function isDirty() {
    if (!st.root || st.mode === 'list') return false;
    try { return JSON.stringify(collectScriptDraft(st.root)) !== st.baseline; } catch { return false; }
  }

  function activateTab(tab) {
    st.tab = SCRIPT_TABS.includes(tab) ? tab : 'overview';
    if (!st.root) return;
    st.root.dataset.tab = st.tab;
    for (const pane of st.root.querySelectorAll('.script-pane')) pane.hidden = pane.dataset.pane !== st.tab;
    for (const b of st.root.querySelectorAll('.script-tabs button[data-tab]')) {
      const on = b.dataset.tab === st.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (st.tab === 'test') void mountBench(); else unmountBench();
  }

  function unmountBench() {
    if (st.bench) { st.bench.destroy(); st.bench = null; }
    st.benchMeta = '';
    const slot = st.root && st.root.querySelector('.script-test-mount');
    if (slot) slot.replaceChildren();
  }

  /** The Test tab is mounted lazily: a visit that never opens it costs no
   *  /api/projects request and no bench tree. */
  async function mountBench() {
    if (st.bench || st.benchMounting || !st.root || st.isNew) return;   // an unsaved key has nothing to bench
    st.benchMounting = true;                 // paintDetail AND activateTab both ask; one mount
    try { await mountBenchNow(); } finally { st.benchMounting = false; }
  }

  async function mountBenchNow() {
    if (!st.projects.length) {
      const r = await api.projects();
      st.projects = r.ok && Array.isArray(r.data.projects) ? r.data.projects : [];
    }
    // st.root is null when the page was left while /api/projects was in flight.
    const slot = st.root && st.root.querySelector('.script-test-mount');
    if (!slot || st.tab !== 'test') return;
    // The bench is built FROM st.data, and only route() and the STRUCTURAL repaints
    // refresh it: a port id, a param id, `required`, `when`, `filename` and a param
    // default are plain keystrokes. The Inputs rows, the params form and the Expect
    // chips would show the declaration as it was at the last structural repaint
    // while the run went out against the new one ("+ input" mints the id `in`, so
    // renaming it is the very next thing an author does). Refreshed IN PLACE: the
    // bench controller writes its case list back into this exact object
    // (`data[writableIndex] = …`, C34), so its identity must not change.
    Object.assign(st.data, { meta: snapshot().meta });
    // The declaration this tree was BUILT from: save() compares against it instead
    // of rebuilding blind (see there).
    st.benchMeta = JSON.stringify(st.data.meta);
    const tree = renderBench(st.data, { doc, projects: st.projects, caseState: st.caseState, highlight });
    slot.replaceChildren(tree);
    st.bench = createBenchController({
      root: tree, data: st.data, api, doc, ws, confirm, renderMarkdown, highlight, modal,
      onCaseState: (key, caseId, state) => {
        if (!caseId) return;
        if (!st.caseState.has(key)) st.caseState.set(key, new Map());
        // `none` is a RESET (the stored case was updated): forget it, so the
        // list card's dot counts only cases that actually ran this session.
        if (state === 'none') st.caseState.get(key).delete(caseId);
        else st.caseState.get(key).set(caseId, state);
      },
      // W10: the bench runs what is ON SCREEN when the page is dirty, so the
      // edit → run → edit loop needs no Save in between.
      getDraft: () => (isDirty() ? collectScriptDraft(st.root) : null),
    });
  }

  async function route(param = '') {
    const my = ++seq;
    st.param = String(param || '');
    const parsed = parseScriptsParam(st.param);
    if (!st.flash) say('');
    if (!st.runtimes) {
      const r = await api.runtimes();
      if (my !== seq) return;
      st.runtimes = r.ok ? r.data : {};
    }
    // A tab hop inside the SAME open script never reloads: the draft is the page.
    if (parsed.mode === 'detail' && st.mode === 'detail' && st.key === parsed.key && st.root) {
      activateTab(parsed.tab);
      return;
    }
    if (parsed.mode === 'new' && st.mode === 'new' && st.root) { activateTab(parsed.tab); return; }
    st.mode = parsed.mode;
    st.key = parsed.key || '';
    st.tab = parsed.tab || 'overview';
    if (parsed.mode === 'new') {
      st.isNew = true;
      st.key = '';
      // A hand-typed #scripts/new/test has nothing to bench (the key is not saved
      // yet), so it lands on Overview — the same place the disabled tab points at.
      if (st.tab === 'test') st.tab = 'overview';
      st.srcMode = ''; st.srcTab = 'default';
      st.data = scriptPayload({ meta: blankScriptMeta('node'), source: SCRIPT_TEMPLATES.node });
      paintDetail({ rebase: true });
      showFlash();
      return;
    }
    if (parsed.mode === 'detail') {
      st.isNew = false;
      st.srcMode = ''; st.srcTab = 'default';
      const r = await api.read(st.key);
      if (my !== seq) return;
      if (!r.ok) {
        disposeDetail();
        host.replaceChildren();
        say(r.status === 404 ? `script "${st.key}" not found` : ((r.data && r.data.error) || `HTTP ${r.status}`), 'err');
        return;
      }
      st.data = scriptPayload(r.data);
      paintDetail({ rebase: true });
      showFlash();
      return;
    }
    disposeDetail();
    const l = await api.list();
    if (my !== seq) return;
    if (!l.ok) { st.list = []; fail(l); paintList(); return; }
    st.list = Array.isArray(l.data.scripts) ? l.data.scripts : [];
    paintList();
    showFlash();
  }

  /** A flash set before a route change is shown by WHICHEVER page that route lands on. */
  function showFlash() { if (st.flash) { say(...st.flash); st.flash = null; } }

  const byKey = (key) => st.list.find((s) => s && s.key === key) || null;

  async function duplicate(key) {
    // The detail page never loaded the registry, so the copy key is minted against
    // a fresh list there — or it could collide and 409.
    let list = st.list;
    if (st.mode !== 'list') { const l = await api.list(); list = l.ok && Array.isArray(l.data.scripts) ? l.data.scripts : []; }
    const r = await api.duplicate(key, nextCopyKey(key, list));
    if (!r.ok) { fail(r); return; }
    st.flash = [`Duplicated as "${r.data.meta.key}".`, 'ok'];
    if (st.mode === 'list') { await route(st.param); return; }
    await leaveDetail(scriptRoute(r.data.meta.key));      // open the copy: it is the one you can edit
  }

  async function remove(key) {
    const s = byKey(key) || (st.mode !== 'list' && st.data ? st.data.meta : null);
    const okToGo = await confirm({
      title: 'Delete script',
      message: `Delete “${(s && s.displayName) || key}”?`,
      confirmLabel: 'Delete', danger: true,
    });
    if (!okToGo) return;
    const r = await api.remove(key);
    if (!r.ok) {
      // REFERENCED (409) names the saved workflows that place it; the server owns
      // that sentence, so it is shown verbatim in the same modal that asked.
      if (r.status === 409) {
        await confirm({ title: 'Cannot delete script', message: (r.data && r.data.error) || 'This script is in use.', confirmLabel: 'Close', cancelLabel: 'Close' });
        return;
      }
      fail(r);
      return;
    }
    st.flash = [`Deleted "${key}".`, 'ok'];
    if (st.mode === 'list') { await route(''); return; }
    navigate(scriptRoute());
  }

  async function save() {
    // ONE write at a time: a double-clicked Save sent two PUTs (on the create page
    // two POSTs — the second answers 409 "already exists" over a save that worked).
    if (st.saving) return;
    const root = st.root;
    const draft = collectScriptDraft(root);
    st.saving = true;
    let r;
    try { r = st.isNew ? await api.create(draft) : await api.update(st.key, draft); } finally { st.saving = false; }
    // The page can be gone by the time the write answers — a rail click destroys the
    // controller (showView), Back routes to the list — or be ANOTHER script's page.
    // Every line below reads st.root, and the baseline belongs to the page that sent
    // the draft. Without this the promise rejects into the console instead.
    if (st.root !== root) return;
    if (!r.ok) { fail(r); return; }
    const key = (r.data.meta && r.data.meta.key) || draft.meta.key;
    const warnings = Array.isArray(r.data.warnings) ? r.data.warnings : [];
    if (st.isNew) {
      st.flash = [`Saved "${key}".`, 'ok'];
      navigate(scriptRoute(key));
      return;
    }
    // The saved text IS the new baseline; re-reading would fight a fast typist.
    st.baseline = JSON.stringify(draft);
    syncDirty();
    // A save does not repaint, so the page's own copy of the declaration has to
    // follow it here or everything rendered FROM st.data stays at the last
    // structural repaint — the Test tab above all.
    Object.assign(st.data, { meta: snapshot().meta });
    // A MOUNTED bench is rebuilt ONLY when the declaration it was built from really
    // changed. Rebuilding blind costs everything the Test tab holds: `destroy()`
    // POSTs `bench/stop` for a run in flight, and `replaceChildren` wipes the
    // selected case, the typed inputs, the Expect row and the result pane — the very
    // state C32/C34 protect, in the middle of the W10 loop (edit → run → pass → Save).
    // And it is never earned: the bench is mounted only while the Test tab is up, and
    // then the Overview and Source panes are `display:none` behind it (no keyboard,
    // autofill or find-in-page path reaches a `meta:*` / `pdef:*` field, and the Setup
    // column's own controls are named `param:` / `in:` / `expect:`), so what
    // mountBenchNow already snapshotted IS what Save is about to write.
    if (st.bench && st.benchMeta !== JSON.stringify(st.data.meta)) { unmountBench(); void mountBench(); }
    const title = st.root.querySelector('.script-title');
    if (title) title.textContent = draft.meta.displayName || key;
    say(warnings.length ? `Saved "${key}". ${warnings.join(' ')}` : `Saved "${key}".`, warnings.length ? 'warn' : 'ok');
  }

  async function leaveDetail(hash) {
    if (isDirty()) {
      // One macrotask later, past the keystroke that got us here: confirmModal
      // registers its own document keydown listener while opening, and the Escape
      // arm below runs in the same keydown — the bubble pass at document would
      // hand the key to the fresh listener and close the prompt before it was
      // seen. A click never reaches the modal's listeners.
      await new Promise((r) => setTimeout(r, 0));
      const okToGo = await confirm({
        title: 'Discard changes',
        message: 'This script has unsaved changes. Leave the page and discard them?',
        confirmLabel: 'Discard', danger: true,
      });
      if (!okToGo) return;
    }
    navigate(hash);
  }

  /** The create page's runtime picker swaps the template — but only while the
   *  editor still holds the template it was given, so a typed program is safe. */
  function onRuntimeChanged(value) {
    // A SAVED script repaints from what is on screen (the select already holds the
    // new runtime) — painting st.data would snap the select back and drop every edit.
    if (!st.isNew) { st.srcMode = ''; repaintFromDraft(); return; }
    const snap = snapshot();
    const untouched = Object.values(SCRIPT_TEMPLATES).includes(snap.source) || snap.source === '';
    st.data = {
      ...snap,
      meta: { ...snap.meta, runtime: value, command: value === 'shell' ? SHELL_COMMAND_TEMPLATE : null, file: null },
      source: untouched ? (SCRIPT_TEMPLATES[value] || '') : snap.source,
      sourceWin32: '',
    };
    st.srcMode = value === 'shell' ? 'command' : 'file';
    paintDetail();
  }

  /** What is ON SCREEN, as the next st.data. The wire draft blanks whatever its
   *  mode does not send (the file in Command mode, the command in File mode), so
   *  BOTH program halves and the command are read straight off their fields — the
   *  visible editor or its hidden mirror. A mode hop then loses nothing. */
  function snapshot() {
    const draft = collectScriptDraft(st.root);
    const val = (name) => { const n = st.root.querySelector(`[data-field="${name}"]`); return n ? String(n.value) : ''; };
    const meta = { ...st.data.meta, ...draft.meta, command: joinCommand(val('meta:command'), val('meta:commandExtra')) };
    return { ...st.data, meta, source: val('script:source'), sourceWin32: val('script:sourceWin32') };
  }

  /** A mode / platform hop keeps every byte the page already holds and fills an
   *  empty half with its template. */
  function switchSource(next) {
    const snap = snapshot();
    // A template is offered on ARRIVAL at an empty half, never on the way out: an
    // emptied win32 editor must stay empty, or the variant could not be dropped.
    if (next.mode === 'file' && !snap.source) snap.source = SCRIPT_TEMPLATES[snap.meta.runtime] || '';
    if (next.tab === 'win32' && !snap.sourceWin32) snap.sourceWin32 = SCRIPT_WIN32_TEMPLATE;
    st.data = snap;
    if (next.mode) st.srcMode = next.mode;
    if (next.tab) st.srcTab = next.tab;
    paintDetail();
  }

  function onClick(e) {
    const t = e.target;
    const hit = (cls) => (t.closest ? t.closest(`.${cls}`) : null);
    const attr = (name) => (t.closest ? t.closest(`[${name}]`) : null);
    if (hit('script-new')) { navigate(scriptRoute(RESERVED_PARAM)); return; }
    if (st.mode !== 'list') {
      if (hit('script-back')) { void leaveDetail(scriptRoute()); return; }
      if (hit('script-save')) { void save(); return; }
      if (hit('script-copy')) { void copyPath(hit('script-copy')); return; }
      const tab = t.closest ? t.closest('.script-tabs button[data-tab]') : null;
      // The create page routes under the reserved `new` key, so its tabs are
      // deep-linkable exactly like a saved script's.
      if (tab && !tab.disabled) { navigate(scriptRoute(st.isNew ? RESERVED_PARAM : st.key, tab.dataset.tab)); return; }
      const mode = attr('data-src-mode');
      if (mode && mode.tagName === 'BUTTON') { switchSource({ mode: mode.dataset.srcMode }); return; }
      const plat = attr('data-src-tab');
      if (plat && plat.tagName === 'BUTTON') { switchSource({ tab: plat.dataset.srcTab }); return; }
      const padd = attr('data-port-add');
      const prm = attr('data-port-remove');
      if (padd || prm) { editPorts(padd ? { add: padd.dataset.portAdd } : { remove: prm.dataset.portRemove }); return; }
      const dadd = attr('data-pdef-add');
      const drm = attr('data-pdef-remove');
      if (dadd || drm) { editParamDefs(dadd ? { add: true } : { remove: Number(drm.dataset.pdefRemove) }); return; }
      if (hit('script-duplicate')) { void duplicate(st.key); return; }
      if (hit('script-delete')) { void remove(st.key); }
      return;
    }
    const card = hit('script-card');
    const key = card ? card.dataset.scriptKey : '';
    if (!key) return;
    if (hit('script-open')) { navigate(scriptRoute(key)); return; }
    if (hit('script-duplicate')) { void duplicate(key); return; }
    if (hit('script-delete')) { void remove(key); }
  }

  function onInput(e) {
    if (st.mode === 'list') {
      if (!e.target.classList || !e.target.classList.contains('script-filter')) return;
      st.query = e.target.value;
      paintList();
      return;
    }
    syncDirty();
  }

  function onChange(e) {
    if (st.mode === 'list') return;
    // The Test tab's Setup column carries its OWN port editor and params form (same
    // field names, the bench's data): a change in there is the bench's business. A
    // structural repaint from here would remount the bench and drop its whole Setup.
    if (e.target.closest && e.target.closest('.script-test-mount')) return;
    const name = e.target.dataset && e.target.dataset.field;
    if (name === 'meta:runtime') { onRuntimeChanged(e.target.value); return; }
    // The verdict GATES every output's `when` select (renderPortEditor disables it
    // while the sidecar has none), so its arrival and its removal reshape the port
    // editor exactly as a port type change does. Without this the tooltip went on
    // naming a condition the author had met and saved, and declaring the port and
    // then the verdict is the natural order for a gate script.
    if (name === 'meta:verdictFilename') {
      const had = Boolean(st.data.meta.verdict && st.data.meta.verdict.filename);
      if (had !== Boolean(String(e.target.value).trim())) { repaintFromDraft(); return; }
    }
    // The structural switches repaint (the editors they gate change shape);
    // everything else is just another keystroke on the draft. A port's TYPE is one
    // of them: renderPortEditor hides an output's filename box for `void`, so
    // without a repaint a port switched off `void` could never be given the
    // filename its type requires (readConfigPorts then refuses the save).
    const structural = name === 'meta:portsConfig'
      || (name && name.startsWith('pdef:') && name.endsWith(':type'))
      || (name && name.startsWith('port:') && name.endsWith(':type'));
    if (structural) { repaintFromDraft(); return; }
    syncDirty();
  }

  function onKeyDown(e) {
    if (e.key !== 'Escape' || st.mode === 'list') return;
    // Escape is an ordinary key inside the code editor and every form control; only
    // the page chrome answers it. (No other view in the app leaves on Escape at all.)
    const t = e.target;
    if (t && t.closest && t.closest('textarea, input, select, [contenteditable="true"]')) return;
    e.preventDefault();
    void leaveDetail(scriptRoute());
  }

  /** Repaint from what is ON SCREEN (never from the server): a structural switch
   *  must not cost the user a keystroke. */
  function repaintFromDraft() {
    st.data = snapshot();
    paintDetail();
  }

  function editPorts(edit) {
    const draft = collectScriptDraft(st.root);
    const perCard = draft.meta.ports === 'config';
    const next = applyPortEdit(perCard ? draft.meta.defaultPorts : { inputs: draft.meta.inputs, outputs: draft.meta.outputs }, edit);
    const snap = snapshot();
    if (perCard) snap.meta.defaultPorts = next;
    else { snap.meta.inputs = next.inputs; snap.meta.outputs = next.outputs; }
    st.data = snap;
    paintDetail();
  }

  function editParamDefs(edit) {
    // `keepBlank`: the Remove button carries the RENDERED row index while the save
    // reader DROPS a row whose id is blank, so with a blank row above, a plain
    // collect splices a different param than the one that was clicked — and a
    // just-added row disappears on the next Remove.
    const params = collectParamDefs(st.root, { keepBlank: true });
    if (edit.add) params.push({ id: '', type: 'string' });
    else if (Number.isInteger(edit.remove)) params.splice(edit.remove, 1);
    const snap = snapshot();
    snap.meta.params = params;
    st.data = snap;
    paintDetail();
  }

  /** The read-only path's Copy: the same 1.2 s "Copied" the Agents view uses. */
  async function copyPath(btn) {
    const path = st.root.querySelector('.script-path');
    if (!path || !path.textContent) return;
    // Absent on an insecure origin (a worca server reached over plain http on a LAN).
    const clip = doc.defaultView.navigator && doc.defaultView.navigator.clipboard;
    if (!clip) { say('Clipboard unavailable — select the path and copy it.', 'err'); return; }
    try {
      await clip.writeText(path.textContent);
      btn.textContent = 'Copied';
      doc.defaultView.setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
    } catch (e) { say(`Copy failed: ${e.message}`, 'err'); }
  }

  host.addEventListener('click', onClick);
  host.addEventListener('input', onInput);
  host.addEventListener('change', onChange);
  host.addEventListener('keydown', onKeyDown);

  return {
    route,
    onChanged() {
      // A frame must never clobber an unsaved draft (the memory controller's rule).
      if (st.mode !== 'list' && isDirty()) return;
      void route(st.param);
    },
    onFrame(msg) { if (st.bench) st.bench.onFrame(msg); },
    isDirty,
    destroy() {
      seq += 1;
      disposeDetail();
      host.removeEventListener('click', onClick);
      host.removeEventListener('input', onInput);
      host.removeEventListener('change', onChange);
      host.removeEventListener('keydown', onKeyDown);
      host.replaceChildren();
    },
  };
}
