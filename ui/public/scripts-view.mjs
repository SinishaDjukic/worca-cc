// ui/public/scripts-view.mjs
// The Scripts page (scripts-workbench design §5; script-wizard plan S1–S17): one
// view, `scripts`, with a hash param parsed the way #projects/<key>/… is (C1). The
// list renderers live here; the two wizard steps are rendered by script-wizard.mjs
// and the bench by script-bench-view.mjs. ONE controller that app.js mounts from
// showView and destroys on leave — the createMemoryController shape (C2).
//
// House rule, pinned by a test: NO explanatory prose on this page. Labels, chips,
// mono hints and error sentences only; the one caption the shared params form
// carries (script-forms.mjs PARAMS_CAPTION) is the single exception.
import { h } from './script-forms.mjs';
import {
  renderRuntimeStep, renderWorkspace, renderInterfacePanel, renderEditorPanel, renderTile, collectScriptDraft, EDITOR_LANGUAGE,
  originLabel, commandText, joinCommand, shellMode, advSummary,
} from './script-wizard.mjs';
import { renderBench, createBenchController } from './script-bench-view.mjs';
import {
  keyFromName, inferInterface, mergeInterface, savedRows, cycleValue, PORT_TYPES, WHEN_CYCLE, INPUT_MODES, CHIP_PARAM_TYPES,
} from '../../src/shared/graph/script-infer.mjs';
import { SCRIPT_COLORS, SCRIPT_KEY_RE, RESERVED_SCRIPT_KEYS } from '../../src/shared/graph/script-meta.mjs';
import { iconSvgOf } from '../../src/shared/graph/script-icons.mjs';
import {
  SCRIPT_TEMPLATES, SCRIPT_WIN32_TEMPLATE, SHELL_COMMAND_TEMPLATE, SCRIPT_EXAMPLES, RUNTIME_DEFAULTS, blankScriptMeta,
} from '../../src/shared/graph/script-templates.mjs';

// The scaffold templates live in src/shared (P3 Task 1): the Scripts page, the
// `worca script new` CLI and `worca plugin new-script` must emit the SAME file.
export { SCRIPT_TEMPLATES, SCRIPT_WIN32_TEMPLATE, SHELL_COMMAND_TEMPLATE, blankScriptMeta };
export { collectScriptDraft, EDITOR_LANGUAGE, originLabel, SCRIPT_COLORS };

export const SCRIPT_RUNTIME_IDS = ['node', 'shell', 'python'];
/** `new` is a script key the store refuses (RESERVED_SCRIPT_KEYS), so the create
 *  page can live at #scripts/new without shadowing a real script. */
export const RESERVED_PARAM = 'new';

/** The hash for a script's workspace (S2). */
export function scriptRoute(key = '') {
  return key ? `scripts/${key}` : 'scripts';
}

/** The hash for a new script: the runtime step, or step 2 for a runtime (S2). */
export function newScriptRoute(runtime = '') {
  return runtime ? `scripts/new/${runtime}` : 'scripts/new';
}

/** '' | 'new' | 'new/<runtime>' | '<key>' | '<key>/<anything>'. parseHash already split
 *  off the view, so this splits on the FIRST '/' only; a word after a real key (an
 *  old `/source` or `/test` bookmark) is ignored — the workspace is the one page. */
export function parseScriptsParam(param = '') {
  const s = String(param || '');
  if (!s) return { mode: 'list' };
  const i = s.indexOf('/');
  const key = i === -1 ? s : s.slice(0, i);
  const rest = i === -1 ? '' : s.slice(i + 1);
  if (key === RESERVED_PARAM) {
    const rt = rest.split('/')[0];
    return SCRIPT_RUNTIME_IDS.includes(rt) ? { mode: 'new', step: 2, runtime: rt } : { mode: 'new', step: 1 };
  }
  return { mode: 'detail', key };
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
 * The page controller (C2). app.js mounts ONE of these in showView('scripts') and
 * destroys it on leave; it owns the endpoint calls and exactly four delegated
 * listeners on `host`. `inferDelayMs` is the editor → interface debounce (S13).
 */
export function createScriptsController({
  host, msgEl = null, api, navigate, confirm, highlight, renderMarkdown = async () => {}, modal = null,
  ws = null, doc = globalThis.document, inferDelayMs = 150,
} = {}) {
  const win = doc.defaultView || globalThis;
  const st = {
    param: '', mode: 'list', step: 1, runtime: 'node', key: '', query: '',
    list: [], runtimes: null, caseState: new Map(), flash: null,
    data: null, savedMeta: null, root: null, isNew: false, baseline: '', stepDirty: false, srcMode: '', srcTab: 'default',
    rows: null, removed: new Set(), verdict: false, routing: false, advOpen: false, keyTouched: false, pickerInPlace: false,
    bench: null, benchMounting: false, projects: [], inferTimer: null, saving: false,
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
  const val = (name) => { const n = st.root && st.root.querySelector(`[data-field="${name}"]`); return n ? String(n.value) : ''; };
  const onWorkspace = () => Boolean(st.root && st.root.dataset.step === '2');

  function paintList() {
    const active = doc.activeElement;
    const typing = !!active && host.contains(active) && active.classList && active.classList.contains('script-filter');
    const caret = typing ? active.selectionStart : null;
    host.replaceChildren(renderScriptsList(st.list, { doc, query: st.query, runtimes: st.runtimes || {}, caseState: st.caseState }));
    if (!typing) return;
    const box = host.querySelector('.script-filter');
    if (!box || typeof box.focus !== 'function') return;
    box.focus({ preventScroll: true });
    try { box.setSelectionRange(caret, caret); } catch { /* not a text control */ }
  }

  /** Tear the mounted code editors and the bench down before the tree goes. */
  function disposeDetail() {
    unmountBench();
    if (st.inferTimer) { win.clearTimeout(st.inferTimer); st.inferTimer = null; }
    if (st.root && Array.isArray(st.root._editors)) for (const e of st.root._editors) e.destroy();
    st.root = null;
  }

  // From the SERVER's meta: collectScriptDraft never emits `origin`, so a meta rebuilt from the page cannot be asked.
  const readOnlyNow = () => !st.isNew && Boolean(st.savedMeta) && st.savedMeta.origin !== 'user';
  const currentKey = () => (st.isNew ? val('meta:key').trim() : st.key);
  const keyOk = () => { const k = currentKey(); return SCRIPT_KEY_RE.test(k) && !RESERVED_SCRIPT_KEYS.includes(k.toLowerCase()); };
  const nameOk = () => val('meta:displayName').trim() !== '';

  // ── the interface (S3, S4, S13) ────────────────────────────────────────────

  /** The program text inference reads (S15): the command in Command mode, the default file otherwise.
   *  `fromDom`: the LIVE editor (a refresh while the workspace is up); else st.data — initInterface runs
   *  after st.data was rebuilt and BEFORE the repaint, when the DOM (if any) still shows the old program. */
  function sourceForInference(fromDom) {
    const meta = st.data.meta;
    const box = fromDom && onWorkspace() ? st.root.querySelector('.script-source') : null;
    const mode = box ? box.dataset.srcMode : (st.srcMode || shellMode(meta));
    const command = meta.runtime === 'shell' && mode === 'command';
    if (box) return command ? val('meta:command') : val('script:source');
    return command ? commandText(meta.command) : st.data.source;
  }

  /** Rows from the code + the saved sidecar + the chips (S3); `verdict` from the code (S4). */
  function computeRows(prevRows, fromDom) {
    const meta = st.data.meta;
    if (meta.ports === 'config') return { rows: savedRows(meta), verdict: Boolean(meta.verdict) };
    const inferred = inferInterface(sourceForInference(fromDom), meta.runtime);
    return { rows: mergeInterface({ inferred, saved: st.savedMeta, rows: prevRows, removed: st.removed }), verdict: inferred.verdict };
  }

  /** Fresh interface state for st.data (on load, after a runtime change, after Load example). */
  function initInterface() {
    const meta = st.data.meta;
    st.removed = new Set();
    st.routing = meta.runtime === 'shell' ? (st.isNew ? true : Boolean(meta.verdict)) : false;
    const { rows, verdict } = computeRows(null, false);
    st.rows = rows;
    // S4: the code decides — but a SAVED sidecar's verdict is kept until the program is edited, so a Save that
    // touched only the description never drops a declaration (shell routes on its exit code: st.routing above).
    st.verdict = verdict || (!st.isNew && meta.runtime !== 'shell' && Boolean(meta.verdict));
  }

  /** A typed param default lives in the DOM until the panel repaints: pull it into the rows first.
   *  Only a CHANGED value is taken, so an untouched inferred default keeps following the code. */
  function syncRowsFromDom() {
    if (!st.root || !st.rows) return;
    for (const r of st.rows.params) {
      const n = st.root.querySelector(`[data-field="iface:param:${r.id}:default"]`);
      if (n && n.value !== String(r.default ?? '')) r.default = n.value;
    }
  }

  function repaintInterface() {
    if (!onWorkspace()) return;
    const old = st.root.querySelector('.wz-iface');
    if (!old) return;
    const meta = st.data.meta;
    const configPorts = meta.ports === 'config';
    old.replaceWith(renderInterfacePanel({
      doc, runtime: meta.runtime, key: currentKey(), rows: st.rows, verdict: st.verdict, routing: st.routing, readOnly: readOnlyNow(),
      configPorts, defaultPorts: configPorts ? meta.defaultPorts : null,
      verdictFilename: (st.savedMeta && st.savedMeta.verdict && st.savedMeta.verdict.filename) || '',
    }));
    const vf = st.root.querySelector('.wz-verdict-file');
    if (vf) { const v = collectScriptDraft(st.root).meta.verdict; vf.textContent = v && v.filename ? v.filename : '—'; }
    syncDirty();
    syncBenchMeta();
  }

  function refreshInterface() {
    if (!onWorkspace() || readOnlyNow() || st.data.meta.ports === 'config') return;
    syncRowsFromDom();
    const { rows, verdict } = computeRows(st.rows, true);
    st.rows = rows;
    st.verdict = verdict;
    repaintInterface();
  }

  /** The editor's live hook (createCodeEditor onInput): debounce, then re-read the code. */
  function onSourceInput() {
    syncDirty();
    if (st.inferTimer) win.clearTimeout(st.inferTimer);
    st.inferTimer = win.setTimeout(() => { st.inferTimer = null; refreshInterface(); }, inferDelayMs);
  }

  function onChipClick(el) {
    const [kind, id, what] = String(el.dataset.chip).split(':');   // ids never hold ':' (PORT_ID_RE)
    const side = kind === 'in' ? 'inputs' : (kind === 'out' ? 'outputs' : 'params');
    const row = st.rows && (st.rows[side] || []).find((r) => r.id === id);
    if (!row) return;
    syncRowsFromDom();
    if (what === 'type') row.type = cycleValue(kind === 'param' ? CHIP_PARAM_TYPES : PORT_TYPES, row.type);
    else if (what === 'mode') row.mode = cycleValue(INPUT_MODES, row.mode || 'optional');
    else if (what === 'when') row.when = cycleValue(WHEN_CYCLE, row.when || 'always');
    repaintInterface();
  }

  function onRemoveClick(el) {
    const [side, id] = String(el.dataset.remove).split(':');
    if (!st.rows || !st.rows[side]) return;
    syncRowsFromDom();
    st.removed.add(`${side}:${id}`);
    st.rows[side] = st.rows[side].filter((r) => r.id !== id);
    repaintInterface();
  }

  function onRoutingClick() {
    syncRowsFromDom();
    st.routing = !st.routing;
    if (!st.routing && st.rows) {
      // Off un-mints what On minted (S4): a SAVED `pass` / `fail` the code never names goes with the
      // switch, or it stays on disk as an output that fires always. On mints both again at collect time.
      for (const id of ['pass', 'fail']) {
        if (!st.rows.outputs.some((r) => r.id === id && r.inCode === false)) continue;
        st.removed.add(`outputs:${id}`);
        st.rows.outputs = st.rows.outputs.filter((r) => r.id !== id);
      }
    }
    repaintInterface();
  }

  // ── painting ──────────────────────────────────────────────────────────────

  function paintRuntimeStep() {
    disposeDetail();
    const root = renderRuntimeStep({ doc, runtimes: st.runtimes || {}, picked: st.runtime });
    st.root = root;
    host.replaceChildren(root);
  }

  /** `rebase` is passed on LOAD only. A repaint from the draft must NOT retake the baseline. */
  function paintDetail({ rebase = false } = {}) {
    disposeDetail();
    const root = renderWorkspace(st.data, {
      doc, runtimes: st.runtimes || {}, readOnly: readOnlyNow(), highlight, isNew: st.isNew,
      srcMode: st.srcMode, srcTab: st.srcTab, rows: st.rows, verdict: st.verdict, routing: st.routing, advOpen: st.advOpen,
      onSourceInput, verdictFilename: (st.savedMeta && st.savedMeta.verdict && st.savedMeta.verdict.filename) || '',
    });
    st.root = root;
    st.srcMode = root.querySelector('.script-source').dataset.srcMode;
    host.replaceChildren(root);
    if (rebase) st.baseline = JSON.stringify(collectScriptDraft(root));
    syncDirty();
    syncSave();
    void mountBench();
  }

  function syncDirty() {
    const mark = st.root && st.root.querySelector('.script-dirty');
    if (mark) mark.hidden = !isDirty();
  }

  function syncSave() {
    const b = st.root && st.root.querySelector('.script-save');
    if (b) b.disabled = !(nameOk() && keyOk());
  }

  /** The tile and the file name follow the identity fields as they are typed. */
  function syncTile() {
    if (!onWorkspace()) return;
    const meta = st.data.meta;
    const key = currentKey();
    const tile = st.root.querySelector('.wz-tile');
    if (tile) tile.replaceWith(renderTile({ doc, name: val('meta:displayName'), key, runtime: meta.runtime, color: val('meta:color'), icon: val('meta:icon') }));
    const file = st.root.querySelector('.wz-file');
    const box = st.root.querySelector('.script-source');
    if (file && !(meta.runtime === 'shell' && box && box.dataset.srcMode === 'command')) {
      const ext = { node: '.mjs', python: '.py', shell: '.sh' }[meta.runtime] || '.mjs';
      file.textContent = `${key || 'script'}${box && box.dataset.srcTab === 'win32' ? '.cmd' : ext}`;
    }
  }

  function syncBenchMeta() {
    // snapshot(), never the bare draft: the draft has no `origin`, and caseListFor keys the bench's writable case layer off it.
    if (st.bench && onWorkspace() && !readOnlyNow()) st.bench.setMeta(snapshot().meta);
  }

  function isDirty() {
    if (!st.root || st.mode === 'list') return false;
    if (!onWorkspace()) return st.stepDirty;        // the picker: what step 2 was when we left it
    try { return JSON.stringify(collectScriptDraft(st.root)) !== st.baseline; } catch { return false; }
  }

  // ── the bench (S12) ───────────────────────────────────────────────────────

  function unmountBench() {
    if (st.bench) { st.bench.destroy(); st.bench = null; }
    const slot = st.root && st.root.querySelector('.script-test-mount');
    if (slot) slot.replaceChildren();
  }

  /** Mounted once per workspace paint, lazily; a draft needs a key the store would accept. */
  async function mountBench() {
    if (st.bench || st.benchMounting || !onWorkspace()) return;
    if (st.isNew && !keyOk()) return;
    st.benchMounting = true;
    try { await mountBenchNow(); } finally { st.benchMounting = false; }
  }

  async function mountBenchNow() {
    if (!st.projects.length) {
      const r = await api.projects();
      st.projects = r.ok && Array.isArray(r.data.projects) ? r.data.projects : [];
    }
    if (st.isNew && !keyOk()) return;                     // the key turned invalid while the projects call was out (S12)
    const slot = st.root && st.root.querySelector('.script-test-mount');
    if (!slot || st.bench) return;
    // Refreshed IN PLACE: the bench controller writes its case list back into this exact object.
    // A read-only page (built-in, plugin) keeps the SERVER's meta: nothing on it can change.
    if (!readOnlyNow()) Object.assign(st.data, { meta: snapshot().meta });
    const tree = renderBench(st.data, { doc, projects: st.projects, caseState: st.caseState, highlight, unsaved: st.isNew });
    slot.replaceChildren(tree);
    st.bench = createBenchController({
      root: tree, data: st.data, api, doc, ws, confirm, renderMarkdown, highlight, modal,
      onCaseState: (key, caseId, state) => {
        if (!caseId) return;
        if (!st.caseState.has(key)) st.caseState.set(key, new Map());
        if (state === 'none') st.caseState.get(key).delete(caseId);
        else st.caseState.get(key).set(caseId, state);
      },
      // W10: the bench runs what is ON SCREEN — always for a draft that is not saved yet.
      getDraft: () => (st.isNew || isDirty() ? collectScriptDraft(st.root) : null),
    });
  }

  // ── routing ───────────────────────────────────────────────────────────────

  /** A runtime for the draft (S16): the template only while the source is untouched;
   *  the runtime's colour and icon only while they were the previous runtime's defaults. */
  function applyRuntime(rt) {
    const prev = onWorkspace() ? snapshot() : st.data;
    const prevRt = prev ? prev.meta.runtime : '';
    const prevDefaults = RUNTIME_DEFAULTS[prevRt] || {};
    const untouched = !prev || prev.source === '' || Object.values(SCRIPT_TEMPLATES).includes(prev.source)
      || (prevRt === 'shell' && prev.meta.file == null && prev.source === '');
    const wasDefaultLook = !prev || (prev.meta.color === prevDefaults.color && prev.meta.icon === iconSvgOf(prevDefaults.icon));
    const base = prev ? { ...prev } : scriptPayload({ meta: blankScriptMeta(rt), source: SCRIPT_TEMPLATES[rt] });
    const d = RUNTIME_DEFAULTS[rt] || RUNTIME_DEFAULTS.node;
    base.meta = {
      ...base.meta, runtime: rt, file: null,
      command: rt === 'shell' ? (commandText(base.meta.command) || SHELL_COMMAND_TEMPLATE) : null,
      ...(wasDefaultLook ? { color: d.color, icon: iconSvgOf(d.icon) } : {}),
    };
    if (untouched) base.source = SCRIPT_TEMPLATES[rt] || '';
    base.sourceWin32 = '';
    st.data = base;
    st.runtime = rt;
    st.srcMode = rt === 'shell' ? 'command' : 'file';
    st.srcTab = 'default';
    initInterface();
    return !prev;
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
    // The same open script: a stray tab word in the hash never reloads over the draft.
    if (parsed.mode === 'detail' && st.mode === 'detail' && st.key === parsed.key && st.root) return;
    if (parsed.mode === 'new') {
      const fresh = st.mode !== 'new';
      st.mode = 'new'; st.isNew = true; st.key = ''; st.pickerInPlace = false;
      if (fresh) {
        // From another page — the list, or a SAVED script's workspace (browser Back after a save lands
        // here): the old tree goes FIRST. Both arms below read the mounted tree through snapshot(),
        // which spreads st.data.meta — null from here on — and a saved script's tree is never the draft.
        disposeDetail();
        st.data = null; st.savedMeta = null; st.keyTouched = false; st.stepDirty = false; st.runtime = 'node'; st.baseline = '';
      }
      if (parsed.step === 1) {
        // Leaving step 2 for the picker: what is typed lives in the DOM, and paintRuntimeStep
        // disposes it — keep it (and whether it was dirty) so a hop back loses nothing.
        if (onWorkspace()) { st.stepDirty = isDirty(); st.data = snapshot(); }
        st.step = 1;
        paintRuntimeStep();
        showFlash();
        return;
      }
      // The hash the workspace ALREADY shows (a re-fired route): what is typed lives in the DOM, and
      // st.data only holds what the last snapshot took — never repaint the page from it.
      if (onWorkspace() && st.data && st.data.meta.runtime === parsed.runtime) { showFlash(); return; }
      st.step = 2;
      const rebase = !st.data || st.data.meta.runtime !== parsed.runtime ? applyRuntime(parsed.runtime) || !st.stepDirty : false;
      if (st.data && st.data.meta.runtime === parsed.runtime && !st.rows) initInterface();
      paintDetail({ rebase: rebase || !st.baseline });
      showFlash();
      return;
    }
    if (parsed.mode === 'detail') {
      st.mode = 'detail'; st.isNew = false; st.step = 2; st.pickerInPlace = false;
      st.key = parsed.key; st.srcMode = ''; st.srcTab = 'default'; st.keyTouched = true; st.stepDirty = false;
      const r = await api.read(st.key);
      if (my !== seq) return;
      if (!r.ok) {
        disposeDetail();
        host.replaceChildren();
        say(r.status === 404 ? `script "${st.key}" not found` : ((r.data && r.data.error) || `HTTP ${r.status}`), 'err');
        return;
      }
      st.data = scriptPayload(r.data);
      st.savedMeta = st.data.meta;
      st.runtime = st.data.meta.runtime || 'node';
      initInterface();
      paintDetail({ rebase: true });
      showFlash();
      return;
    }
    st.mode = 'list';
    disposeDetail();
    const l = await api.list();
    if (my !== seq) return;
    if (!l.ok) { st.list = []; fail(l); paintList(); return; }
    st.list = Array.isArray(l.data.scripts) ? l.data.scripts : [];
    paintList();
    showFlash();
  }

  function showFlash() { if (st.flash) { say(...st.flash); st.flash = null; } }
  const byKey = (key) => st.list.find((s) => s && s.key === key) || null;

  // ── actions ───────────────────────────────────────────────────────────────

  async function duplicate(key) {
    let list = st.list;
    if (st.mode !== 'list') { const l = await api.list(); list = l.ok && Array.isArray(l.data.scripts) ? l.data.scripts : []; }
    const r = await api.duplicate(key, nextCopyKey(key, list));
    if (!r.ok) { fail(r); return; }
    st.flash = [`Duplicated as "${r.data.meta.key}".`, 'ok'];
    if (st.mode === 'list') { await route(st.param); return; }
    await leaveDetail(scriptRoute(r.data.meta.key));
  }

  async function remove(key) {
    const s = byKey(key) || (st.mode !== 'list' && st.data ? st.data.meta : null);
    const okToGo = await confirm({ title: 'Delete script', message: `Delete “${(s && s.displayName) || key}”?`, confirmLabel: 'Delete', danger: true });
    if (!okToGo) return;
    const r = await api.remove(key);
    if (!r.ok) {
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
    if (st.saving || !onWorkspace() || readOnlyNow()) return;
    if (!(nameOk() && keyOk())) { syncSave(); return; }
    const root = st.root;
    const draft = collectScriptDraft(root);
    st.saving = true;
    let r;
    try { r = st.isNew ? await api.create(draft) : await api.update(st.key, draft); } finally { st.saving = false; }
    if (st.root !== root) return;
    if (!r.ok) { fail(r); return; }
    const key = (r.data.meta && r.data.meta.key) || draft.meta.key;
    const warnings = Array.isArray(r.data.warnings) ? r.data.warnings : [];
    if (st.isNew) {
      st.baseline = JSON.stringify(draft);                 // the page is clean now: no leave-guard on the way to its own hash
      st.flash = [`Saved "${key}".`, 'ok'];
      navigate(scriptRoute(key));
      return;
    }
    st.baseline = JSON.stringify(draft);
    st.savedMeta = { ...st.savedMeta, ...draft.meta };     // the sidecar on disk is what the page just sent (origin kept)
    st.removed = new Set();
    syncDirty();
    Object.assign(st.data, { meta: snapshot().meta });
    syncBenchMeta();
    say(warnings.length ? `Saved "${key}". ${warnings.join(' ')}` : `Saved "${key}".`, warnings.length ? 'warn' : 'ok');
  }

  async function leaveDetail(hash) {
    if (isDirty()) {
      // One macrotask later, past the keystroke that got us here (the confirmModal capture-keydown trap).
      await new Promise((r) => setTimeout(r, 0));
      const okToGo = await confirm({ title: 'Discard changes', message: 'This script has unsaved changes. Leave the page and discard them?', confirmLabel: 'Discard', danger: true });
      if (!okToGo) return;
    }
    navigate(hash);
  }

  /** What is ON SCREEN, as the next st.data (both program halves and the command off their fields). */
  function snapshot() {
    const draft = collectScriptDraft(st.root);
    const meta = { ...st.data.meta, ...draft.meta, command: joinCommand(val('meta:command'), val('meta:commandExtra')) };
    return { ...st.data, meta, source: val('script:source'), sourceWin32: val('script:sourceWin32') };
  }

  /** A mode / platform hop swaps ONLY the editor panel (S15): the bench under it — a run in
   *  flight, its result, the typed inputs — and the rest of the page stay where they are. Every
   *  byte the page holds is kept; an empty half is filled with its template. */
  function switchSource(next) {
    if (!onWorkspace()) return;
    const snap = snapshot();
    if (next.mode === 'file' && !snap.source) snap.source = SCRIPT_TEMPLATES[snap.meta.runtime] || '';
    if (next.tab === 'win32' && !snap.sourceWin32) snap.sourceWin32 = SCRIPT_WIN32_TEMPLATE;
    Object.assign(st.data, snap);                          // in place: the mounted bench holds this object
    if (next.mode) st.srcMode = next.mode;
    if (next.tab) st.srcTab = next.tab;
    syncRowsFromDom();
    repaintEditor();
    refreshInterface();                                    // the visible half changed (S15)
  }

  /** The editor panel alone, from st.data and st.srcMode / st.srcTab; the old code editor is torn down first. */
  function repaintEditor() {
    const old = st.root.querySelector('.script-source');
    if (!old) return;
    const editors = st.root._editors;
    for (const e of editors) e.destroy();
    editors.length = 0;
    old.replaceWith(renderEditorPanel(doc, st.data, {
      readOnly: readOnlyNow(), highlight, srcMode: st.srcMode || shellMode(st.data.meta), srcTab: st.srcTab, editors, onSourceInput, key: currentKey(),
    }));
    st.srcMode = st.root.querySelector('.script-source').dataset.srcMode;
    syncDirty();
  }

  async function loadExample() {
    if (!onWorkspace() || readOnlyNow()) return;
    const ex = SCRIPT_EXAMPLES[st.data.meta.runtime];
    if (!ex) return;
    if (isDirty()) {
      await new Promise((r) => setTimeout(r, 0));
      const okToGo = await confirm({ title: 'Load example', message: `Replace the program and the identity with “${ex.name}”?`, confirmLabel: 'Load', danger: false });
      if (!okToGo || !onWorkspace()) return;
    }
    const snap = snapshot();
    snap.meta = {
      ...snap.meta, displayName: ex.name, description: ex.description, color: ex.color, icon: iconSvgOf(ex.icon),
      key: st.isNew && !st.keyTouched ? keyFromName(ex.name) : snap.meta.key,
      command: snap.meta.runtime === 'shell' ? null : snap.meta.command,
    };
    snap.source = ex.source;
    snap.sourceWin32 = '';
    st.data = snap;
    if (snap.meta.runtime === 'shell') st.srcMode = 'file';
    initInterface();
    paintDetail();
  }

  /** The runtime pill on a SAVED script: the picker in place, Continue applies, Cancel returns. */
  function openPickerInPlace() {
    st.data = snapshot();
    st.stepDirty = isDirty();
    st.pickerInPlace = true;
    paintRuntimeStep();
  }

  function closePickerInPlace(apply) {
    st.pickerInPlace = false;
    if (apply) applyRuntime(st.runtime);
    else if (!st.rows) initInterface();
    paintDetail();
  }

  /** The read-only path's Copy: the same 1.2 s "Copied" the Agents view uses. */
  async function copyPath(btn) {
    const path = st.root.querySelector('.script-path');
    if (!path || !path.textContent) return;
    const clip = doc.defaultView.navigator && doc.defaultView.navigator.clipboard;
    if (!clip) { say('Clipboard unavailable — select the path and copy it.', 'err'); return; }
    try {
      await clip.writeText(path.textContent);
      btn.textContent = 'Copied';
      doc.defaultView.setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
    } catch (e) { say(`Copy failed: ${e.message}`, 'err'); }
  }

  // ── events ────────────────────────────────────────────────────────────────

  function onClick(e) {
    const t = e.target;
    const hit = (cls) => (t.closest ? t.closest(`.${cls}`) : null);
    const attr = (name) => (t.closest ? t.closest(`[${name}]`) : null);
    if (hit('script-new')) { navigate(newScriptRoute()); return; }
    if (st.mode === 'list') {
      const card = hit('script-card');
      const key = card ? card.dataset.scriptKey : '';
      if (!key) return;
      if (hit('script-open')) { navigate(scriptRoute(key)); return; }
      if (hit('script-duplicate')) { void duplicate(key); return; }
      if (hit('script-delete')) { void remove(key); }
      return;
    }
    if (t.closest && t.closest('.script-test-mount')) return;      // the bench's own listener owns everything in there
    // step 1 (the picker)
    const rt = attr('data-runtime');
    if (rt && rt.classList.contains('rt') && !rt.disabled) { st.runtime = rt.dataset.runtime; paintRuntimeStep(); return; }
    if (hit('wz-continue')) {
      if (st.pickerInPlace) { closePickerInPlace(true); return; }
      navigate(newScriptRoute(st.runtime));
      return;
    }
    if (hit('wz-cancel')) {
      if (st.pickerInPlace) { closePickerInPlace(false); return; }
      void leaveDetail(scriptRoute());
      return;
    }
    // step 2 (the workspace)
    if (hit('script-back')) { void leaveDetail(scriptRoute()); return; }
    if (hit('script-save')) { void save(); return; }
    if (hit('script-copy')) { void copyPath(hit('script-copy')); return; }
    if (hit('script-duplicate')) { void duplicate(st.key); return; }
    if (hit('script-delete')) { void remove(st.key); return; }
    const pill = attr('data-step');
    if (pill && pill.classList.contains('wz-step-pill') && pill.dataset.step === '1' && !pill.disabled) {
      if (st.isNew) { st.stepDirty = isDirty(); navigate(newScriptRoute()); } else openPickerInPlace();
      return;
    }
    if (hit('wz-example')) { void loadExample(); return; }
    if (hit('wz-adv-toggle')) {
      st.advOpen = !st.advOpen;
      const body = st.root.querySelector('.wz-adv-body');
      if (body) body.hidden = !st.advOpen;
      hit('wz-adv-toggle').setAttribute('aria-expanded', st.advOpen ? 'true' : 'false');
      const chev = st.root.querySelector('.wz-adv-toggle .chev');
      if (chev) chev.classList.toggle('open', st.advOpen);
      return;
    }
    if (readOnlyNow()) return;
    const sw = attr('data-swatch');
    if (sw) {
      st.root.querySelector('[data-field="meta:color"]').value = sw.dataset.swatch;
      for (const b of st.root.querySelectorAll('.sw')) { const on = b === sw; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
      syncTile(); syncDirty();
      return;
    }
    const ico = attr('data-icon');
    if (ico && ico.classList.contains('ico')) {
      st.root.querySelector('[data-field="meta:icon"]').value = iconSvgOf(ico.dataset.icon);
      for (const b of st.root.querySelectorAll('.ico')) { const on = b === ico; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
      syncTile(); syncDirty();
      return;
    }
    const chipEl = attr('data-chip');
    if (chipEl && !chipEl.disabled) { onChipClick(chipEl); return; }
    const rm = attr('data-remove');
    if (rm) { onRemoveClick(rm); return; }
    if (attr('data-routing')) { onRoutingClick(); return; }
    const mode = attr('data-src-mode');
    if (mode && mode.tagName === 'BUTTON') { switchSource({ mode: mode.dataset.srcMode }); return; }
    const plat = attr('data-src-tab');
    if (plat && plat.tagName === 'BUTTON') switchSource({ tab: plat.dataset.srcTab });
  }

  function onInput(e) {
    if (st.mode === 'list') {
      if (!e.target.classList || !e.target.classList.contains('script-filter')) return;
      st.query = e.target.value;
      paintList();
      return;
    }
    if (!onWorkspace() || (e.target.closest && e.target.closest('.script-test-mount'))) return;
    const name = e.target.dataset && e.target.dataset.field;
    if (name === 'meta:displayName') {
      if (st.isNew && !st.keyTouched) { const k = st.root.querySelector('[data-field="meta:key"]'); if (k) k.value = keyFromName(e.target.value); }
      identityChanged();
      return;
    }
    if (name === 'meta:key') { st.keyTouched = true; identityChanged(); return; }
    if (name === 'meta:timeoutSec' || name === 'meta:domain' || name === 'meta:order') syncAdvSummary();
    syncDirty();
  }

  /** The disclosure's one-line summary follows the three fields it summarises as they are typed (S11). */
  function syncAdvSummary() {
    const sum = st.root && st.root.querySelector('.wz-adv-sum');
    if (sum) sum.textContent = advSummary(collectScriptDraft(st.root).meta);
  }

  /** The name or the key changed: the tile, Save, the dirty chip, the bench's key — and a bench that was waiting for a key. */
  function identityChanged() {
    syncTile(); syncSave(); syncDirty();
    // A draft's bench follows the key (S12): mounted as soon as the store would take the key, gone again while it would not.
    if (st.isNew && !keyOk()) { unmountBench(); return; }
    if (st.bench) syncBenchMeta(); else void mountBench();
  }

  function onChange(e) {
    if (st.mode === 'list' || !onWorkspace()) return;
    if (e.target.closest && e.target.closest('.script-test-mount')) return;
    syncDirty();
  }

  function onKeyDown(e) {
    if (e.key !== 'Escape' || st.mode === 'list') return;
    const t = e.target;
    if (t && t.closest && t.closest('textarea, input, select, [contenteditable="true"]')) return;
    e.preventDefault();
    if (st.pickerInPlace) { closePickerInPlace(false); return; }
    void leaveDetail(scriptRoute());
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
      if (st.mode === 'new') return;                        // a draft is never on the server
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
