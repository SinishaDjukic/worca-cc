// ui/public/script-bench-view.mjs
// The Scripts page's Test tab (scripts-workbench design §5.3): three columns —
// the saved cases, the setup that builds ONE bench request, and everything the
// run produced. The bench engine and its `scriptbench-*` frames live in the
// server (Task 3/5); this module owns the pixels and the request shape.
//
// It never has its own idea of how a script runs: every field here maps to a key
// of the §4.2 request, and the result panes only show what the runner returned.
import {
  h, renderParamsForm, collectParams, renderPortEditor, collectPorts, applyPortEdit, paramEditorHook,
} from './script-forms.mjs';
import { openArtifactPicker, readInputFile } from './artifact-picker.mjs';
import { escapeHtml } from './code-editor.mjs';
import {
  CASE_ID_RE, EXPECT_VERDICTS, MAX_CASES, MAX_CASE_NAME, evaluateExpect,
} from '../../src/shared/graph/script-cases.mjs';

export const BENCH_STATUSES = ['clean', 'blocking', 'error', 'stopped', 'timeout'];
export const SCRATCH_LABEL = 'Scratch folder';
/** The three verdicts a case may expect (spec §3.2). `stopped` and `timeout` are
 *  outcomes, not expectations — `Use result` leaves the row alone for them. */
export { EXPECT_VERDICTS, MAX_CASES, MAX_CASE_NAME };

const metaOf = (data) => ((data && data.meta) ? data.meta : (data || {}));
const isUserLayer = (meta) => meta.origin === 'user';
const seconds = (ms) => `${(Number(ms || 0) / 1000).toFixed(1)} s`;

/** Shipped cases first, then the user's overlay (W18). `writableIndex` names the
 *  array this page may rewrite: its own file on the user layer, the overlay
 *  everywhere else — so a plugin's proof is never edited by its user. */
export function caseListFor(data) {
  const meta = metaOf(data);
  const own = Array.isArray(data && data.cases) ? data.cases : [];
  const overlay = Array.isArray(data && data.userCases) ? data.userCases : [];
  const user = isUserLayer(meta);
  return {
    writableIndex: user ? 'cases' : 'userCases',
    cases: [...own.map((c) => ({ ...c, writable: user })), ...overlay.map((c) => ({ ...c, writable: true }))],
  };
}

const miniBtn = (doc, cls, label, kind = 'btn-ghost') => {
  const b = h(doc, 'button', `btn ${kind} btn-mini ${cls}`, label);
  b.type = 'button';
  return b;
};

/** The case list. A WRITABLE case carries Rename and Delete; a shipped one (a
 *  built-in's or a plugin's own file) carries the lock and neither — the user's
 *  own cases for it live in the W18 overlay instead (caseListFor). */
function caseRows(doc, data, caseState) {
  const list = h(doc, 'div', 'bench-case-list');
  const { cases } = caseListFor(data);
  const states = caseState.get(metaOf(data).key) || new Map();
  for (const c of cases) {
    const row = h(doc, 'div', 'bench-case-row');
    row.dataset.caseId = c.id;
    const pick = h(doc, 'button', 'bench-case');
    pick.type = 'button';
    const dot = h(doc, 'i', 'script-dot');
    dot.dataset.state = states.get(c.id) || 'none';
    pick.append(dot, h(doc, 'span', 'bench-case-name', c.name || c.id));
    row.appendChild(pick);
    if (c.writable) row.append(miniBtn(doc, 'bench-case-rename', 'Rename'), miniBtn(doc, 'bench-case-delete', 'Delete'));
    else row.appendChild(h(doc, 'span', 'chip bench-lock', 'shipped'));
    list.appendChild(row);
  }
  return list;
}

function caseColumn(doc, data, caseState) {
  const col = h(doc, 'div', 'bench-col bench-cases');
  col.appendChild(h(doc, 'div', 'bench-col-head', 'Cases'));
  col.appendChild(caseRows(doc, data, caseState));
  // The name row is INLINE (never a browser prompt): Save as case reads it, and
  // selecting a case fills it.
  const name = doc.createElement('input');
  name.type = 'text'; name.className = 'input bench-case-name'; name.dataset.field = 'bench:caseName';
  name.placeholder = 'Case name'; name.maxLength = MAX_CASE_NAME;
  name.setAttribute('aria-label', 'Case name');
  col.appendChild(name);
  // `.bench-case-actions` is the slot Update is added to and removed from, so the
  // other three buttons never move as the selection changes.
  const actions = h(doc, 'div', 'bench-case-actions');
  actions.append(miniBtn(doc, 'bench-save-case', 'Save as case'), miniBtn(doc, 'bench-add-case', '+ Case'));
  col.appendChild(actions);
  const all = miniBtn(doc, 'bench-run-all', 'Run all');
  all.disabled = caseListFor(data).cases.length === 0;
  col.appendChild(all);
  return col;
}

function inputRows(doc, ports) {
  const box = h(doc, 'div', 'bench-inputs');
  box.appendChild(h(doc, 'div', 'bench-zone', 'Inputs'));
  for (const p of ports) {
    const row = h(doc, 'div', 'bench-port');
    row.dataset.port = p.id;
    row.dataset.type = p.type;
    const bind = h(doc, 'label', 'bench-bind');
    const box2 = doc.createElement('input');
    box2.type = 'checkbox'; box2.dataset.field = `in:${p.id}:bound`;
    bind.append(box2, h(doc, 'span', 'bench-port-id mono', p.id), h(doc, 'span', 'chip bench-port-type', p.type));
    row.appendChild(bind);
    if (p.type === 'void') {
      row.appendChild(h(doc, 'span', 'bench-void-fired', 'fired'));
    } else {
      const seg = h(doc, 'div', 'seg bench-src');
      for (const [src, label] of [['text', 'Text'], ['file', 'File…'], ['run', 'Run…']]) {
        const b = h(doc, 'button', src === 'text' ? 'on' : '', label);
        b.type = 'button'; b.dataset.inSrc = src;
        b.setAttribute('aria-pressed', src === 'text' ? 'true' : 'false');
        seg.appendChild(b);
      }
      const file = doc.createElement('input');
      file.type = 'file'; file.className = 'bench-file'; file.hidden = true;
      const ta = doc.createElement('textarea');
      ta.className = 'bench-text mono'; ta.dataset.field = `in:${p.id}:text`; ta.rows = 6; ta.spellcheck = false;
      row.append(seg, h(doc, 'span', 'bench-src-label', ''), file, ta);
    }
    box.appendChild(row);
  }
  return box;
}

/** The chips + summary field under the verdict select. Rebuilt on every verdict
 *  change, so `—` really means "no expectation": there is nothing else to read. */
function expectDetail(doc, outputs, { fired = [], summaryIncludes = '' } = {}) {
  const box = h(doc, 'div', 'bench-expect-detail');
  const picked = new Set(fired);
  const chips = h(doc, 'div', 'bench-expect-chips');
  for (const p of outputs) {
    const chip = h(doc, 'label', 'bench-expect-chip');
    const cb = doc.createElement('input');
    cb.type = 'checkbox'; cb.dataset.field = `expect:fired:${p.id}`; cb.checked = picked.has(p.id);
    chip.append(cb, doc.createTextNode(p.id));
    chips.appendChild(chip);
  }
  box.appendChild(chips);
  const wrap = h(doc, 'div', 'ins-f bench-f');
  wrap.appendChild(h(doc, 'label', 'ins-label', 'Summary contains'));
  const input = doc.createElement('input');
  input.type = 'text'; input.className = 'ins-number'; input.dataset.field = 'expect:summaryIncludes';
  input.value = summaryIncludes || '';
  wrap.appendChild(input);
  box.appendChild(wrap);
  return box;
}

/** The Expect row (spec §5.3): a verdict picker, and — only once a verdict is
 *  chosen — one checkbox per DECLARED output port plus a summary substring.
 *  `Use result` copies the verdict and the fired ports from the result on screen
 *  (the summary substring is the author's sentence). Labels only. */
function expectRow(doc, declared) {
  const row = h(doc, 'div', 'bench-expect-row');
  row.appendChild(h(doc, 'div', 'bench-zone', 'Expect'));
  const head = h(doc, 'div', 'bench-expect-head');
  const sel = h(doc, 'select', 'ins-select');
  sel.dataset.field = 'expect:verdict';
  for (const [value, label] of [['', '—'], ...EXPECT_VERDICTS.map((v) => [v, v])]) {
    const o = doc.createElement('option');
    o.value = value; o.textContent = label;
    sel.appendChild(o);
  }
  const use = miniBtn(doc, 'bench-expect-from-result', 'Use result');
  use.disabled = true;                       // nothing has run yet
  head.append(sel, use);
  row.appendChild(head);
  // The detail is owned by the RENDER, not the controller: a verdict change must
  // repaint the chips on a bare `renderBench` tree too. `declared()` re-reads the
  // port editor every time, so a config-ported script's chips follow its ports.
  row._fill = (expect) => {
    const outs = declared();
    sel.value = expect && EXPECT_VERDICTS.includes(expect.verdict) ? expect.verdict : '';
    const old = row.querySelector('.bench-expect-detail');
    if (old) old.remove();
    if (!sel.value) return;
    row.appendChild(expectDetail(doc, outs, {
      fired: (expect && expect.fired) || [],
      summaryIncludes: (expect && expect.summaryIncludes) || '',
    }));
  };
  sel.addEventListener('change', () => {
    const outs = declared();
    const fired = outs.map((p) => p.id).filter((id) => {
      const cb = row.querySelector(`[data-field="expect:fired:${id}"]`);
      return Boolean(cb && cb.checked);
    });
    const sum = String((row.querySelector('[data-field="expect:summaryIncludes"]') || {}).value || '');
    row._fill(sel.value ? { verdict: sel.value, fired, summaryIncludes: sum } : null);
  });
  return row;
}

function setupColumn(doc, data, projects, { highlight, editors }) {
  const meta = metaOf(data);
  const col = h(doc, 'div', 'bench-col bench-setup');
  col.appendChild(h(doc, 'div', 'bench-col-head', 'Setup'));
  // W1: a scratch folder, or a REGISTERED project's real checkout (never a path
  // the user types — the projects API owns that list).
  const wrap = h(doc, 'div', 'ins-f bench-f');
  wrap.appendChild(h(doc, 'label', 'ins-label', 'Folder'));
  const sel = h(doc, 'select', 'ins-select');
  sel.dataset.field = 'bench:cwd';
  const scratch = doc.createElement('option');
  scratch.value = ''; scratch.textContent = SCRATCH_LABEL;
  sel.appendChild(scratch);
  for (const p of projects || []) {
    const o = doc.createElement('option');
    o.value = `project:${p.key}`; o.textContent = `${p.name} — ${p.path}`;
    o.disabled = p.exists === false;
    sel.appendChild(o);
  }
  wrap.appendChild(sel);
  col.appendChild(wrap);
  // The SAME params form the composer's inspector shows (§5.3, C3), including the
  // shared code editor for a command/code param.
  col.appendChild(renderParamsForm(meta, {}, { doc, editorFor: paramEditorHook({ doc, highlight, editors }) }));
  const configPorts = meta.ports === 'config';
  const raw = configPorts ? (meta.defaultPorts || { inputs: [], outputs: [] }) : { inputs: meta.inputs || [], outputs: meta.outputs || [] };
  if (configPorts) col.appendChild(renderPortEditor(raw, { doc, hasVerdict: Boolean(meta.verdict) }));
  col.appendChild(inputRows(doc, raw.inputs || []));
  col.appendChild(expectRow(doc, () => (configPorts ? (collectPorts(col).outputs || []) : (raw.outputs || []))));
  const actions = h(doc, 'div', 'bench-actions');
  const stop = miniBtn(doc, 'bench-stop', 'Stop');
  stop.disabled = true;
  actions.append(miniBtn(doc, 'bench-run', 'Run', 'btn-primary'), stop);
  col.append(actions, h(doc, 'div', 'form-msg bench-msg'));
  return col;
}

function resultColumn(doc) {
  const col = h(doc, 'div', 'bench-col bench-result');
  col.appendChild(h(doc, 'div', 'bench-col-head', 'Result'));
  const body = h(doc, 'div', 'bench-result-body');
  const line = h(doc, 'div', 'bench-status');
  const dot = h(doc, 'i', 'bench-dot');
  dot.dataset.status = 'idle';
  line.append(dot, h(doc, 'span', 'bench-status-text', 'idle'));
  body.appendChild(line);
  const tabs = h(doc, 'div', 'seg bench-tabs');
  const b = h(doc, 'button', 'on', 'Log');
  b.type = 'button'; b.dataset.rtab = 'log'; b.setAttribute('aria-pressed', 'true');
  tabs.appendChild(b);
  body.appendChild(tabs);
  const pane = h(doc, 'div', 'bench-pane');
  pane.dataset.rpane = 'log';
  pane.appendChild(h(doc, 'pre', 'bench-log'));
  body.appendChild(pane);
  col.appendChild(body);
  return col;
}

/** The whole Test tab. Detached; the controller mounts and drives it. */
export function renderBench(data, { doc = globalThis.document, projects = [], caseState = new Map(),
  highlight = async (t) => escapeHtml(t) } = {}) {   // the default ESCAPES (C11): it feeds two innerHTML sinks
  const root = h(doc, 'div', 'bench');
  root.dataset.scriptKey = metaOf(data).key || '';
  // The param editors this tree mounted, for the controller to destroy (the
  // pane._search idiom; a live debounce on a detached node is a leak).
  const editors = [];
  root._editors = editors;
  root.append(caseColumn(doc, data, caseState), setupColumn(doc, data, projects, { highlight, editors }), resultColumn(doc));
  return root;
}

// ---- the result ------------------------------------------------------------

/** `log`, `verdict` and `envelope` are the tabs the result always carries, and
 *  all three are legal output port ids (PORT_ID_RE): an output that takes one of
 *  those names gets its own pane id, or one tab would unhide two panes. */
const OUT_PANE = { log: 'log-out', verdict: 'verdict-out', envelope: 'envelope-out' };
// hasOwn: PORT_ID_RE admits `constructor` / `toString`, which a plain lookup finds
// on Object.prototype and stringifies into the attribute.
const paneIdFor = (port) => (Object.hasOwn(OUT_PANE, port) ? OUT_PANE[port] : port);

function outputPane(doc, port, out, { highlight, renderMarkdown, outputHref }) {
  const pane = h(doc, 'div', 'bench-pane');
  pane.dataset.rpane = paneIdFor(port);
  pane.hidden = true;
  const body = h(doc, 'div', 'bench-out-body');
  if (out.type === 'md') {
    const raw = h(doc, 'button', 'btn btn-ghost btn-mini bench-raw', 'Raw');
    raw.type = 'button';
    pane.appendChild(raw);
    let showing = 'md';
    const paint = () => {
      body.replaceChildren();
      if (showing === 'md') { void renderMarkdown(out.text || '', body); return; }
      body.appendChild(h(doc, 'pre', 'bench-rawtext', out.text || ''));
    };
    raw.addEventListener('click', () => {
      showing = showing === 'md' ? 'raw' : 'md';
      raw.textContent = showing === 'md' ? 'Raw' : 'Rendered';
      paint();
    });
    paint();
  } else {
    let pretty = String(out.text || '');
    try { pretty = JSON.stringify(JSON.parse(pretty), null, 2); } catch { /* keep the raw text */ }
    const pre = h(doc, 'pre', 'bench-json');
    const code = doc.createElement('code');
    code.textContent = pretty;
    pre.appendChild(code);
    body.appendChild(pre);
    // The ONE innerHTML on this path is the injected highlighter's output (C11).
    void Promise.resolve(highlight(pretty, 'json')).then((html) => { if (typeof html === 'string') code.innerHTML = html; }).catch(() => {});
  }
  pane.appendChild(body);
  // Over the inline cap the WS carried the head only; the full text is a route.
  if (out.truncated) {
    const a = doc.createElement('a');
    a.className = 'bench-open-full'; a.href = outputHref(port); a.target = '_blank'; a.rel = 'noopener';
    a.textContent = 'Open full';
    pane.appendChild(a);
  }
  return pane;
}

function jsonPane(doc, rpane, value) {
  const pane = h(doc, 'div', 'bench-pane');
  pane.dataset.rpane = rpane;
  pane.hidden = true;
  const pre = h(doc, 'pre', 'bench-json');
  const code = doc.createElement('code');
  code.textContent = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
  pre.appendChild(code);
  pane.appendChild(pre);
  return pane;
}

/** The result half, as a fragment the controller drops into `.bench-result-body`.
 *  An execution error is a RESULT (spec §4.1), so it renders here, not as a
 *  transport failure. */
/* `highlight(text, lang)` MUST return ESCAPED html (app.js's scriptHighlight: hljs output, or escapeHtml) —
 * its result is assigned to innerHTML in the json pane. */
export function renderBenchResult(result, { doc = globalThis.document, highlight, renderMarkdown, outputHref } = {}) {
  const frag = doc.createDocumentFragment();
  const line = h(doc, 'div', 'bench-status');
  const dot = h(doc, 'i', 'bench-dot');
  dot.dataset.status = result.status || 'error';
  line.append(dot, h(doc, 'span', 'bench-status-text', result.status || 'error'));
  if (Number.isInteger(result.exitCode)) line.appendChild(h(doc, 'span', 'chip bench-exit', `exit ${result.exitCode}`));
  if (Number.isFinite(result.durationMs)) line.appendChild(h(doc, 'span', 'chip bench-dur', seconds(result.durationMs)));
  const draft = h(doc, 'span', 'chip bench-draft', 'unsaved draft');
  draft.hidden = result.draft !== true;
  line.appendChild(draft);
  frag.appendChild(line);
  if (result.summary) frag.appendChild(h(doc, 'div', 'bench-summary', result.summary));
  if (Array.isArray(result.fired) && result.fired.length) {
    const fired = h(doc, 'div', 'bench-fired');
    for (const port of result.fired) fired.appendChild(h(doc, 'span', 'chip bench-fired-chip', port));
    frag.appendChild(fired);
  }
  if (result.expect) {
    const box = h(doc, 'div', 'bench-expect');
    box.appendChild(h(doc, 'span', `bench-expect-state ${result.expect.pass ? 'pass' : 'fail'}`, result.expect.pass ? 'expect pass' : 'expect fail'));
    for (const d of result.expect.diffs || []) box.appendChild(h(doc, 'div', 'bench-expect-diff', d));
    frag.appendChild(box);
  }
  if (result.error) {
    frag.appendChild(h(doc, 'div', 'bench-error', result.error.message || ''));
    const tail = h(doc, 'div', 'bench-error-tail');
    for (const t of result.error.tail || []) tail.appendChild(h(doc, 'div', '', t));
    if (tail.childNodes.length) frag.appendChild(tail);
  }
  for (const w of result.warnings || []) frag.appendChild(h(doc, 'div', 'bench-warn', w));
  const tabs = h(doc, 'div', 'seg bench-tabs');
  const panes = [];
  const addTab = (rtab, label) => {
    const b = h(doc, 'button', panes.length === 0 ? 'on' : '', label);
    b.type = 'button'; b.dataset.rtab = rtab;
    b.setAttribute('aria-pressed', panes.length === 0 ? 'true' : 'false');
    tabs.appendChild(b);
  };
  addTab('log', 'Log');
  const logPane = h(doc, 'div', 'bench-pane');
  logPane.dataset.rpane = 'log';
  logPane.appendChild(h(doc, 'pre', 'bench-log'));
  panes.push(logPane);
  for (const [port, out] of Object.entries(result.outputs || {})) {
    if (!out || out.type === 'void') continue;            // a void output is a fired chip, nothing more
    addTab(paneIdFor(port), port);
    panes.push(outputPane(doc, port, out, { highlight, renderMarkdown, outputHref }));
  }
  addTab('verdict', 'verdict');
  panes.push(jsonPane(doc, 'verdict', result.verdict));
  addTab('envelope', 'envelope');
  panes.push(jsonPane(doc, 'envelope', result.envelopePath || ''));
  frag.appendChild(tabs);
  panes[0].hidden = false;
  for (const p of panes) frag.appendChild(p);
  return frag;
}

// ---- the request -----------------------------------------------------------

/** Read the setup column back as the §4.2 request. Unchecked ports are ABSENT,
 *  exactly as an unbound port is absent from a real run's envelope (W2). */
export function collectBenchRequest(root, data, { draft = null } = {}) {
  const meta = metaOf(data);
  const configPorts = meta.ports === 'config';
  const ports = configPorts ? collectPorts(root.querySelector('.bench-setup')) : null;
  const declared = configPorts ? (ports.inputs || []) : (meta.inputs || []);
  const inputs = {};
  for (const p of declared) {
    const bound = root.querySelector(`[data-field="in:${p.id}:bound"]`);
    if (!bound || !bound.checked) continue;
    if (p.type === 'void') { inputs[p.id] = { fired: true }; continue; }
    const ta = root.querySelector(`[data-field="in:${p.id}:text"]`);
    inputs[p.id] = { text: ta ? ta.value : '' };
  }
  const cwdValue = String((root.querySelector('[data-field="bench:cwd"]') || {}).value || '');
  const cwd = cwdValue.startsWith('project:')
    ? { kind: 'project', projectKey: cwdValue.slice('project:'.length) }
    : { kind: 'scratch' };
  const selected = root.querySelector('.bench-case.on');
  return {
    key: meta.key || '',
    caseId: selected ? selected.closest('.bench-case-row').dataset.caseId : null,
    all: false,
    draft,
    params: collectParams(root.querySelector('.bench-setup'), meta).values,
    ports,
    inputs,
    cwd,
    timeoutMs: null,
  };
}

/** The declared OUTPUT ports the expect chips are drawn from. */
function declaredOutputs(root, data) {
  const meta = metaOf(data);
  if (meta.ports !== 'config') return meta.outputs || [];
  const live = collectPorts(root.querySelector('.bench-setup'));
  return live.outputs || [];
}

/** Read the setup column back as a stored case (Task 1's `Case`). The request
 *  shape is untouched: the bench API knows nothing about expectations —
 *  `evaluateExpect` runs against the STORED case, server-side. */
export function collectCase(root, data, { id, name }) {
  const req = collectBenchRequest(root, data);
  const verdict = String((root.querySelector('[data-field="expect:verdict"]') || {}).value || '');
  let expect = null;
  if (EXPECT_VERDICTS.includes(verdict)) {
    expect = { verdict };
    const fired = [];
    for (const p of declaredOutputs(root, data)) {
      const cb = root.querySelector(`[data-field="expect:fired:${p.id}"]`);
      if (cb && cb.checked) fired.push(p.id);
    }
    // Omitted when nothing is ticked (like `summaryIncludes` when blank):
    // `evaluateExpect` reads an EMPTY list as "nothing may fire", which is not
    // what a bare verdict means.
    if (fired.length) expect.fired = fired;
    const summary = String((root.querySelector('[data-field="expect:summaryIncludes"]') || {}).value || '').trim();
    if (summary) expect.summaryIncludes = summary;
  }
  return {
    id,
    name: String(name || '').trim().slice(0, MAX_CASE_NAME),
    params: req.params,
    ports: req.ports,
    inputs: req.inputs,
    cwd: req.cwd,
    timeoutMs: null,
    expect,
  };
}

// ---- the controller --------------------------------------------------------

/** A case id slugged from its name and made unique. Always CASE_ID_RE: lowercase,
 *  non-alphanumerics collapsed to `-`, a leading letter forced, 64 characters. */
export function caseIdFrom(name, taken = []) {
  const held = new Set(taken);
  let base = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!base) base = 'case';
  if (!/^[a-z]/.test(base)) base = `c-${base}`;
  base = base.slice(0, 60).replace(/-+$/, '') || 'case';
  for (let i = 1; ; i += 1) {
    const id = i === 1 ? base : `${base}-${i}`;
    if (!held.has(id) && CASE_ID_RE.test(id)) return id;
  }
}

/**
 * Drives one mounted `renderBench` tree: Run / Stop / Run all over the bench
 * routes, the `scriptbench-*` frames filtered by benchId, the case list and the
 * case writes. Returns `onFrame` so the page controller can hand it every frame.
 */
export function createBenchController({
  root, data, api, ws = null, onCaseState = () => {}, getDraft = () => null,
  confirm = async () => true, renderMarkdown = async () => {}, highlight = async (t) => escapeHtml(t),
  doc = globalThis.document, modal = null,
} = {}) {
  const meta = metaOf(data);
  // `selected` is the case the Setup column currently holds (null = an ad-hoc
  // setup); `lastResult` is the ONE result `Use result` may copy from — a Run all
  // clears it, because an aggregate is not one result.
  const st = {
    benchId: '', running: false, caseId: null, lines: [], dead: false,
    // Frames can beat the POST answer that names the bench: they wait in `early`.
    // `lastSeq` drops a frame the socket delivers twice (live + the subscribe replay).
    pending: false, early: [], lastSeq: 0,
    // A selected case whose Setup was edited runs AD HOC (what is on screen), not the stored case.
    caseEdited: false, filling: false,
    index: caseListFor(data), selected: null, lastResult: null,
  };
  // Case writes queue behind each other (writeCases): the WHOLE list goes out on
  // every action, so two in flight at once would have the later one overwrite the
  // earlier one's case with a list that never held it.
  let writeChain = Promise.resolve();
  const q = (sel) => root.querySelector(sel);
  const say = (textValue, kind) => { const m = q('.bench-msg'); if (m) { m.textContent = textValue || ''; m.className = 'form-msg bench-msg' + (kind ? ` ${kind}` : ''); } };
  // A Run all keeps one result per case, so `Open full` must name WHICH one; a
  // single run has exactly one and omits the id.
  const hrefFor = (caseId) => (port) => api.benchOutput(st.benchId, port, caseId);

  function setRunning(on) {
    st.running = on;
    q('.bench-run').disabled = on;
    q('.bench-run-all').disabled = on || st.index.cases.length === 0;
    q('.bench-stop').disabled = !on;
  }

  function status(text, kind) {
    const dot = q('.bench-dot');
    if (dot) dot.dataset.status = kind || text;
    const label = q('.bench-status-text');
    if (label) label.textContent = text;
  }

  function resetResult() {
    st.lines = [];
    const body = q('.bench-result-body');
    body.replaceChildren();
    const line = h(doc, 'div', 'bench-status');
    const dot = h(doc, 'i', 'bench-dot');
    dot.dataset.status = 'running';
    line.append(dot, h(doc, 'span', 'bench-status-text', 'running'));
    body.appendChild(line);
    const tabs = h(doc, 'div', 'seg bench-tabs');
    const b = h(doc, 'button', 'on', 'Log');
    b.type = 'button'; b.dataset.rtab = 'log'; b.setAttribute('aria-pressed', 'true');
    tabs.appendChild(b);
    const pane = h(doc, 'div', 'bench-pane');
    pane.dataset.rpane = 'log';
    pane.appendChild(h(doc, 'pre', 'bench-log'));
    body.append(tabs, pane);
  }

  function appendLine(text, caseId) {
    st.lines.push(caseId ? `[${caseId}] ${text}` : text);
    const pre = q('.bench-pane[data-rpane="log"] .bench-log');
    if (pre) pre.textContent = `${st.lines.join('\n')}\n`;
  }

  function showResult(result, caseId = null) {
    const body = q('.bench-result-body');
    body.replaceChildren(renderBenchResult(result, { doc, highlight, renderMarkdown, outputHref: hrefFor(caseId) }));
    const pre = q('.bench-pane[data-rpane="log"] .bench-log');
    if (pre) pre.textContent = st.lines.length ? `${st.lines.join('\n')}\n` : '';
  }

  const stateOf = (result) => (result.expect ? (result.expect.pass ? 'pass' : 'fail') : 'ran');

  function paintCaseDot(caseId, state) {
    const row = q(`.bench-case-row[data-case-id="${caseId}"] .script-dot`);
    if (row) row.dataset.state = state;
  }

  /** `Use result` is live only while ONE result is on screen. */
  function syncUseResult() {
    const use = q('.bench-expect-from-result');
    if (use) use.disabled = !st.lastResult;
  }

  /** Update case belongs to the selection, so it is added and removed with it —
   *  never rendered disabled, which would read as "this case cannot be saved". */
  function syncUpdateButton() {
    const actions = q('.bench-case-actions');
    if (!actions) return;
    const existing = q('.bench-case-update');
    const kase = st.selected ? st.index.cases.find((c) => c.id === st.selected) : null;
    const wanted = Boolean(kase && kase.writable);
    if (wanted && !existing) actions.insertBefore(miniBtn(doc, 'bench-case-update', 'Update case'), q('.bench-add-case'));
    else if (!wanted && existing) existing.remove();
  }

  async function start(request) {
    resetResult();
    // The pane is blank again, so there is no result left for `Use result` to copy —
    // the button must not keep offering the PREVIOUS run's verdict and chips.
    st.lastResult = null;
    syncUseResult();
    setRunning(true);
    say('');
    st.benchId = ''; st.lastSeq = 0; st.early = []; st.pending = true; st.stopWanted = false;
    const r = await api.bench(request);
    st.pending = false;
    // Torn down while the POST was in flight: destroy() had no benchId to stop yet,
    // so stop it here — or the run holds its per-key slot with no Stop on screen.
    if (st.dead) { if (r.ok && r.data && r.data.benchId) void api.benchStop(r.data.benchId); return; }
    if (!r.ok) {
      st.early = [];
      setRunning(false);
      status('error', 'error');
      const body = q('.bench-result-body');
      body.appendChild(h(doc, 'div', 'bench-error', (r.data && r.data.error) || `HTTP ${r.status}`));
      return;
    }
    st.benchId = r.data.benchId;
    // Stop was pressed while the POST was in flight (it is enabled from the first
    // frame of the click): honour it now the id is known, the way destroy() does.
    if (st.stopWanted) { st.stopWanted = false; void api.benchStop(st.benchId); }
    // The server broadcasts every frame to every socket the moment the bench
    // starts, so a fast script can finish BEFORE this line runs: those frames were
    // parked in `early` and are replayed here, in order. The subscription asks the
    // server to replay its buffer too (it covers a socket that was down during the
    // POST); `lastSeq` keeps whichever copy arrives second out of the log.
    // A page RELOAD does not resume a bench: st.benchId is gone and nothing restores it.
    const early = st.early;
    st.early = [];
    for (const m of early) handle(m);
    if (ws) ws.send({ type: 'subscribe', benchId: st.benchId });
  }

  /** Stop is live from the moment Run is pressed, so it can land while the POST
   *  that names the bench is still in flight: remember the wish and honour it in
   *  start(), or the click is a no-op and the child keeps going. */
  function stopBench() {
    if (st.pending) { st.stopWanted = true; return; }
    if (st.benchId) void api.benchStop(st.benchId);
  }

  function run() {
    const request = collectBenchRequest(root, data, { draft: getDraft() });
    // §4.2: with a caseId the engine runs the STORED case and ignores every loose
    // field. So a selected case whose Setup was edited is sent WITHOUT its id — it
    // runs what is on screen, its dot is left alone, and the Expect row is judged
    // here (below). Update case is what commits the edit.
    if (request.caseId && st.caseEdited) request.caseId = null;
    st.caseId = request.caseId;
    void start(request);
  }

  function runAll() {
    st.caseId = null;
    // The draft rides along exactly as it does on Run (W10): without it every case
    // would be checked against the SAVED program while the editor shows another
    // one, and the result would carry no `unsaved draft` chip to say so.
    void start({ key: meta.key, caseId: null, all: true, draft: getDraft(), params: {}, ports: null, inputs: {}, cwd: { kind: 'scratch' }, timeoutMs: null });
  }

  /** A `ports: "config"` script declares its set PER RUN, so the Setup column
   *  carries its own port editor — the page's lives on Overview and owns the
   *  sidecar. Repaint the editor (only when a row was added or removed) and the
   *  Inputs rows from it, keeping whatever was typed for a port that kept its id,
   *  and re-read the Expect chips off the new outputs. */
  function syncPorts({ edit = null, ports = null } = {}) {
    const setup = q('.bench-setup');
    const editor = setup && setup.querySelector('.ins-port-editor');
    if (!editor) return;
    const held = [...root.querySelectorAll('.bench-port')].map((r) => {
      const bound = r.querySelector(`[data-field="in:${r.dataset.port}:bound"]`);
      const ta = r.querySelector(`[data-field="in:${r.dataset.port}:text"]`);
      return { id: r.dataset.port, bound: Boolean(bound && bound.checked), text: ta ? ta.value : '' };
    });
    const next = ports || (edit ? applyPortEdit(collectPorts(setup), edit) : collectPorts(setup));
    const reshaped = Boolean(edit || ports);
    if (reshaped) editor.replaceWith(renderPortEditor(next, { doc, hasVerdict: Boolean(meta.verdict) }));
    q('.bench-inputs').replaceWith(inputRows(doc, next.inputs || []));
    // A row added or removed keeps every other port's ID, so match by id; a plain
    // re-read after an id was EDITED matches by position, or the text typed for the
    // renamed port would be dropped on the floor.
    (next.inputs || []).forEach((p, i) => {
      const was = reshaped ? held.find((x) => x.id === p.id) : held[i];
      if (!was) return;
      const bound = q(`[data-field="in:${p.id}:bound"]`);
      const ta = q(`[data-field="in:${p.id}:text"]`);
      if (bound) bound.checked = was.bound;
      if (ta) ta.value = was.text;
    });
    fillExpect(collectCase(root, data, { id: 'x', name: 'x' }).expect);
  }

  function fillFromCase(kase) {
    st.filling = true;                       // the synthetic input events below are not the user's
    try { fillFromCaseNow(kase); } finally { st.filling = false; }
  }

  function fillFromCaseNow(kase) {
    // A config-ported case carries its own port set (Task 1): restore it BEFORE
    // the bindings below, or the case would run against whatever set the previous
    // selection left behind.
    if (meta.ports === 'config') {
      syncPorts({ ports: (kase && kase.ports) || meta.defaultPorts || { inputs: [], outputs: [] } });
    }
    for (const row of root.querySelectorAll('.bench-port')) {
      const port = row.dataset.port;
      const bound = row.querySelector(`[data-field="in:${port}:bound"]`);
      const ta = row.querySelector(`[data-field="in:${port}:text"]`);
      const value = kase && kase.inputs ? kase.inputs[port] : null;
      if (bound) bound.checked = Boolean(value);
      if (ta) ta.value = value && typeof value.text === 'string' ? value.text : '';
    }
    // EVERY declared param is reset — to the case's value, else the sidecar default —
    // or a value left by the previous case would ride along into this one.
    for (const p of (Array.isArray(meta.params) ? meta.params : [])) {
      const id = p.id;
      const given = kase && kase.params ? kase.params[id] : undefined;
      const value = given !== undefined ? given : (p.default !== undefined ? p.default : '');
      const node = root.querySelector(`[data-field="param:${id}"]`);
      if (!node) continue;
      if (node.type === 'checkbox') node.checked = value === true; else node.value = String(value);
      // A command/code param is a code editor's textarea: writing `.value` skips
      // the highlighted layer, so tell it the same way a keystroke would.
      node.dispatchEvent(new (doc.defaultView || globalThis).Event('input', { bubbles: true }));
    }
    const cwd = q('[data-field="bench:cwd"]');
    if (cwd) cwd.value = kase && kase.cwd && kase.cwd.kind === 'project' ? `project:${kase.cwd.projectKey}` : '';
    const name = q('[data-field="bench:caseName"]');
    if (name) name.value = kase ? (kase.name || '') : '';
    fillExpect(kase && kase.expect ? kase.expect : null);
  }

  /** The expect row follows the verdict: `null` collapses it to `—` and drops the
   *  chips, so there is nothing stale left to read back. */
  function fillExpect(expect) {
    const rowEl = q('.bench-expect-row');
    if (rowEl && rowEl._fill) rowEl._fill(expect);
  }

  /** The verdict select's own change: keep whatever chips are ticked. */
  function onVerdictChanged() {
    const rowEl = q('.bench-expect-row');
    const verdict = rowEl.querySelector('[data-field="expect:verdict"]').value;
    const kept = collectCase(root, data, { id: 'x', name: 'x' }).expect;
    fillExpect(verdict ? { verdict, fired: (kept && kept.fired) || [], summaryIncludes: (kept && kept.summaryIncludes) || '' } : null);
  }

  /** `Use result`: the verdict from the result's status (only when it is one the
   *  case format can express) and the chips from what actually fired. The summary
   *  is the author's sentence, so it is never overwritten. */
  function useResult() {
    const result = st.lastResult;
    if (!result) return;
    const current = collectCase(root, data, { id: 'x', name: 'x' }).expect;
    const verdict = EXPECT_VERDICTS.includes(result.status) ? result.status : (current && current.verdict) || '';
    if (!verdict) return;
    const declared = new Set(declaredOutputs(root, data).map((p) => p.id));
    fillExpect({
      verdict,
      fired: (result.fired || []).filter((p) => declared.has(p)),
      summaryIncludes: (current && current.summaryIncludes) || '',
    });
  }

  function markEdited(on) {
    st.caseEdited = on;
    for (const row of root.querySelectorAll('.bench-case-row')) {
      if (on && row.dataset.caseId === st.selected) row.dataset.edited = 'true'; else delete row.dataset.edited;
    }
  }

  function selectCase(caseId) {
    st.selected = caseId || null;
    markEdited(false);
    for (const row of root.querySelectorAll('.bench-case-row')) {
      row.querySelector('.bench-case').classList.toggle('on', row.dataset.caseId === caseId);
    }
    fillFromCase(st.index.cases.find((c) => c.id === caseId) || null);
    syncUpdateButton();
  }

  function clearCase() {
    selectCase('');
  }

  /** Re-apply the selection to freshly painted rows WITHOUT re-filling the Setup
   *  column — a write that does not move the selection (a rename, a delete of
   *  another case) must not throw away a typed ad-hoc setup or an edit in
   *  progress on the selected one. */
  function reselect(caseId) {
    for (const row of root.querySelectorAll('.bench-case-row')) {
      row.querySelector('.bench-case').classList.toggle('on', row.dataset.caseId === caseId);
      if (st.caseEdited && caseId && row.dataset.caseId === caseId) row.dataset.edited = 'true';
    }
    syncUpdateButton();
  }

  /** Repaint the rows from `data` and keep the dots that are still meaningful. */
  function repaintCases(dots = new Map()) {
    st.index = caseListFor(data);
    const fresh = caseRows(doc, data, new Map([[meta.key, dots]]));
    q('.bench-case-list').replaceWith(fresh);
    q('.bench-run-all').disabled = st.running || st.index.cases.length === 0;
  }

  const currentDots = () => new Map([...root.querySelectorAll('.bench-case-row')]
    .map((r) => [r.dataset.caseId, r.querySelector('.script-dot').dataset.state]));

  /** The ONE write path: every case action sends the WHOLE writable list (the
   *  user's own file, or the W18 overlay for a builtin/plugin script). Writes are
   *  SERIAL and each one REBASES: `mutate` is applied to the list only once the
   *  previous write has landed. Applying it earlier sent a list read before that
   *  write — a rename fired while Save as case was in flight dropped the new case.
   *  `mutate` may answer null to write nothing. */
  function writeCases(mutate, { select = null, dots = null } = {}) {
    const write = async () => {
      if (st.dead) return false;
      const cases = mutate(writableNow());
      if (!cases) return false;
      const r = await api.writeCases(meta.key, cases);
      if (!r.ok) { if (!st.dead) say((r.data && r.data.error) || `HTTP ${r.status}`, 'err'); return false; }
      // The write LANDED, so `data` has to follow even when the tab was left while it
      // was in flight (destroy()): it is what the next mount paints and what the next
      // case action sends as the WHOLE list — a stale copy silently undoes this write.
      data[st.index.writableIndex] = Array.isArray(r.data.cases) ? r.data.cases : cases;
      if (st.dead) return false;
      repaintCases(dots || currentDots());
      const want = select === null ? (st.selected || '') : select;
      if (want === (st.selected || '')) reselect(want); else selectCase(want);
      say('');
      return true;
    };
    const next = writeChain.then(write, write);
    writeChain = next.then(() => {}, () => {});
    return next;
  }

  const writableNow = () => (Array.isArray(data[st.index.writableIndex]) ? data[st.index.writableIndex] : []);
  const typedName = () => String((q('[data-field="bench:caseName"]') || {}).value || '').trim();

  async function saveCase() {
    const name = typedName();
    if (!name) { say('Name the case first.', 'err'); return; }
    if (writableNow().length >= MAX_CASES) { say(`${MAX_CASES} cases is the limit.`, 'err'); return; }
    const id = caseIdFrom(name, st.index.cases.map((c) => c.id));
    const kase = collectCase(root, data, { id, name });
    // A double-clicked Save is ONE case: by the time the second write runs the id
    // is already there, and a duplicate id is a refusal from the store.
    await writeCases((list) => (list.some((c) => c.id === id) ? null : [...list, kase]), { select: id });
  }

  /** Update replaces the selected case, so the cap never blocks it. Its dot is
   *  reset: the stored case is no longer the one that produced that result. */
  async function updateCase() {
    const id = st.selected;
    const kase = id ? st.index.cases.find((c) => c.id === id) : null;
    if (!kase || !kase.writable) return;
    const name = typedName() || kase.name;
    if (!name) { say('Name the case first.', 'err'); return; }
    const built = collectCase(root, data, { id, name });
    const dots = currentDots();
    dots.set(id, 'none');
    if (await writeCases((list) => list.map((c) => (c.id === id ? built : c)), { select: id, dots })) {
      markEdited(false); onCaseState(meta.key, id, 'none');
    }
  }

  async function renameCase(id, name) {
    if (!name) { say('Name the case first.', 'err'); return; }
    await writeCases((list) => list.map((c) => (c.id === id ? { ...c, name: name.slice(0, MAX_CASE_NAME) } : c)));
  }

  async function deleteCase(id) {
    const kase = st.index.cases.find((c) => c.id === id);
    if (!kase || !kase.writable) return;
    const okToGo = await confirm({
      title: 'Delete case', message: `Delete case "${kase.name || id}"?`,
      confirmLabel: 'Delete', danger: true,
    });
    if (!okToGo || st.dead) return;
    const dots = currentDots();
    dots.delete(id);
    if (await writeCases((list) => list.filter((c) => c.id !== id), { select: st.selected === id ? '' : st.selected, dots })) {
      // W15: the list card's dot counts the cases that ran THIS session. A case that
      // is gone must stop colouring it — otherwise deleting the one that failed
      // leaves the card red for a case nobody can run any more.
      onCaseState(meta.key, id, 'none');
    }
  }

  /** Inline rename: Enter commits, Escape cancels, blur commits. No prompt. */
  function beginRename(row) {
    if (row.querySelector('.bench-case-rename-input')) return;
    const id = row.dataset.caseId;
    const label = row.querySelector('.bench-case-name');
    const box = doc.createElement('input');
    box.type = 'text'; box.className = 'input bench-case-rename-input';
    box.value = label.textContent; box.maxLength = MAX_CASE_NAME;
    box.setAttribute('aria-label', 'Case name');
    let settled = false;
    const finish = (commit) => {
      if (settled) return;
      settled = true;
      const value = box.value.trim();
      box.replaceWith(label);
      if (commit) void renameCase(id, value);
    };
    box.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    box.addEventListener('blur', () => finish(true));
    label.replaceWith(box);
    if (typeof box.focus === 'function') box.focus();
    if (typeof box.select === 'function') box.select();
  }

  /** A picked file or artifact lands as TEXT in the port and ticks its box (W9). */
  function fillPort(port, { text, label }) {
    const id = port.dataset.port;
    const ta = port.querySelector(`[data-field="in:${id}:text"]`);
    const bound = port.querySelector(`[data-field="in:${id}:bound"]`);
    if (ta) ta.value = text;
    if (bound) bound.checked = true;
    const name = port.querySelector('.bench-src-label');
    if (name) name.textContent = label;
    if (st.selected) markEdited(true);
    say('');
  }

  async function pickFromRun(port) {
    if (!modal) return;
    const types = port.dataset.type === 'json' ? ['json'] : ['md'];
    const got = await openArtifactPicker({ doc, api, types, modal });
    if (st.dead || !got) return;
    fillPort(port, got);
  }

  async function onFileChosen(input) {
    const port = input.closest('.bench-port');
    const file = input.files && input.files[0];
    input.value = '';                      // the same file can be picked twice
    if (!file) return;
    try {
      fillPort(port, await readInputFile(file, { FileReaderImpl: (doc.defaultView || globalThis).FileReader }));
    } catch (err) {
      say(err.message, 'err');
    }
  }

  function onClick(e) {
    const t = e.target;
    const hit = (cls) => (t.closest ? t.closest(`.${cls}`) : null);
    if (hit('bench-run')) { run(); return; }
    if (hit('bench-run-all')) { runAll(); return; }
    if (hit('bench-stop')) { stopBench(); return; }
    if (hit('bench-save-case')) { void saveCase(); return; }
    if (hit('bench-case-update')) { void updateCase(); return; }
    if (hit('bench-add-case')) { clearCase(); return; }
    if (hit('bench-expect-from-result')) { useResult(); return; }
    // The Setup column's port editor is the BENCH's, not the sidecar's: keep these
    // clicks off the page controller, whose own handler would edit `data.meta`.
    const pedit = t.closest ? t.closest('[data-port-add],[data-port-remove]') : null;
    if (pedit && pedit.closest('.bench-setup')) {
      e.stopPropagation();
      syncPorts({ edit: pedit.dataset.portAdd ? { add: pedit.dataset.portAdd } : { remove: pedit.dataset.portRemove } });
      if (st.selected) markEdited(true);
      return;
    }
    const row = hit('bench-case-row');
    if (row) {
      if (hit('bench-case-rename')) { beginRename(row); return; }
      if (hit('bench-case-delete')) { void deleteCase(row.dataset.caseId); return; }
      if (hit('bench-case')) { selectCase(row.dataset.caseId); return; }
      return;
    }
    const src = t.closest ? t.closest('[data-in-src]') : null;
    if (src && src.tagName === 'BUTTON') {
      const port = src.closest('.bench-port');
      if (src.dataset.inSrc === 'file') { port.querySelector('.bench-file').click(); return; }
      if (src.dataset.inSrc === 'run') { void pickFromRun(port); return; }
      return;                                   // Text is the resting state
    }
    const tab = t.closest ? t.closest('.bench-tabs button[data-rtab]') : null;
    if (!tab) return;
    for (const b of root.querySelectorAll('.bench-tabs button[data-rtab]')) {
      const on = b === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    for (const p of root.querySelectorAll('.bench-pane')) p.hidden = p.dataset.rpane !== tab.dataset.rtab;
  }

  function onChange(e) {
    onSetupEdit(e);                          // a select or a checkbox edits the Setup too
    const field = (e.target.dataset && e.target.dataset.field) || '';
    // On `change`, not on every keystroke: a port id is committed on blur, so the
    // field the user is typing in is never pulled out from under them.
    if (/^port:(inputs|outputs):/.test(field) && e.target.closest('.bench-setup')) {
      // This editor is the BENCH's, not the sidecar's: keep the change off the page
      // controller, which reads `port:*:type` as structural and would repaint the
      // whole page (remounting this bench). Its own `.script-test-mount` guard cannot
      // do it — the repaint below detaches the select, so `closest` finds nothing.
      // The [data-port-add] click has the same rule.
      e.stopPropagation();
      // A TYPE change RESHAPES the row — renderPortEditor hides an output's filename
      // box for `void` — so the editor is repainted, exactly as the Overview form
      // does it. Every other field keeps the editor as it stands.
      syncPorts(/:type$/.test(field) ? { ports: collectPorts(q('.bench-setup')) } : {});
      return;
    }
    if (e.target.dataset && e.target.dataset.field === 'expect:verdict') { onVerdictChanged(); return; }
    if (e.target.classList && e.target.classList.contains('bench-file')) void onFileChosen(e.target);
  }

  /** One scriptbench-* frame of THIS bench (early frames arrive through start()). */
  function handle(msg) {
    if (st.dead || !msg || !st.benchId || msg.benchId !== st.benchId) return;
    if (Number.isInteger(msg.seq)) { if (msg.seq <= st.lastSeq) return; st.lastSeq = msg.seq; }
    if (msg.type === 'scriptbench-line') { appendLine(String(msg.text ?? ''), msg.caseId || null); return; }
    if (msg.type === 'scriptbench-error') {
      // Transport only (unknown key, a bad request, or BUSY — the 2-global /
      // 1-per-key cap, which can only surface here because the POST already
      // answered { benchId }). Run comes back either way.
      setRunning(false);
      status('error', 'error');
      q('.bench-result-body').appendChild(h(doc, 'div', 'bench-error', msg.message || ''));
      return;
    }
    if (msg.type !== 'scriptbench-done') return;
    setRunning(false);
    const result = msg.result || {};
    if (Array.isArray(result.cases)) {
      for (const row of result.cases) {
        const state = stateOf(row.result || {});
        paintCaseDot(row.caseId, state);
        onCaseState(meta.key, row.caseId, state);
      }
      const last = result.cases.length ? result.cases[result.cases.length - 1] : null;
      showResult(last ? last.result : {}, last ? last.caseId : null);
      status(`passed ${result.passed || 0} · failed ${result.failed || 0} · unchecked ${result.unchecked || 0}`, 'multi');
      // An aggregate is not ONE result, so there is nothing for `Use result`
      // to copy — it goes back to disabled.
      st.lastResult = null;
      syncUseResult();
      return;
    }
    // An ad-hoc run carries no case, so the ENGINE has nothing to check against
    // (§4.2: only a stored case supplies an expectation). The Expect row that is
    // on screen is evaluated here with the SAME pure function the server uses.
    const shown = (!st.caseId && !result.expect)
      ? { ...result, expect: evaluateExpect(collectCase(root, data, { id: 'x', name: 'x' }).expect, result) }
      : result;
    showResult(shown);
    st.lastResult = shown;
    syncUseResult();
    const state = stateOf(shown);
    if (st.caseId) paintCaseDot(st.caseId, state);
    onCaseState(meta.key, st.caseId, state);
  }

  /** A user edit anywhere in the Setup column while a case is selected: from now
   *  on Run sends what is on screen (see run()). fillFromCase's own synthetic
   *  events are not the user's. */
  function onSetupEdit(e) {
    if (st.filling || !st.selected || st.caseEdited) return;
    if (e.target.closest && e.target.closest('.bench-setup')) markEdited(true);
  }

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onSetupEdit);


  return {
    onFrame(msg) {
      if (st.dead || !msg) return;
      if (st.pending) { if (st.early.length < 5000) st.early.push(msg); return; }
      handle(msg);
    },
    destroy() {
      // A tab hop or a view change tears this controller down, and nothing else
      // shows a bench: an unstopped run would hold its per-key slot with no Stop
      // anywhere on screen, and the next Run would come back BUSY for ever.
      if (st.running && st.benchId) void api.benchStop(st.benchId);
      st.dead = true;
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('input', onSetupEdit);
      if (Array.isArray(root._editors)) { for (const ed of root._editors) ed.destroy(); root._editors.length = 0; }
    },
  };
}
