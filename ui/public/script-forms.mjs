// ui/public/script-forms.mjs
// The two forms a script's ports and params are edited with (scripts-workbench
// design §5.3, C3): the params form and the port editor. ONE implementation, used
// by the composer's inspector (a placed card) and the bench's setup (a request). Every function takes the target
// `document` via opts and returns DETACHED DOM — no fetch, no listeners outside
// the returned tree (the memory-view.mjs / plugins-view.mjs posture); the host
// binds ONE delegated listener and routes on data-field / data-port-* / data-pdef-*.
//
// The field NAMES are the contract: `param:<id>`, `port:<dir>:<i>:<field>`,
// `data-port-add`, `data-port-remove` are exactly P1b's, so the composer's
// routing and its tests hold after the move.
import { effectiveScriptParams, paramValueError, readConfigPorts } from '../../src/shared/graph/script-meta.mjs';
import { createCodeEditor } from './code-editor.mjs';

// ---- DOM primitives (moved out of graph/inspector.mjs; it imports them) -----

export const h = (doc, tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
export const field = (doc, cls, label) => { const w = h(doc, 'div', `ins-f ${cls}`); w.appendChild(h(doc, 'label', 'ins-label', label)); return w; };

export function select(doc, cls, name, label, items, value, { disabled = false, title = '' } = {}) {
  const wrap = field(doc, cls, label);
  if (title) wrap.title = title;
  const sel = h(doc, 'select', 'ins-select');
  sel.dataset.field = name;
  sel.disabled = Boolean(disabled);
  for (const opt of items) {
    const o = doc.createElement('option');
    o.value = opt.value; o.textContent = opt.text;
    if (opt.value === (value == null ? '' : String(value))) o.selected = true;
    sel.appendChild(o);
  }
  const shell = h(doc, 'span', 'ins-select-wrap');   // the product's .select-wrap idea: the chevron is a token-coloured ::after on a wrapper
  shell.appendChild(sel);
  wrap.appendChild(shell);
  return wrap;
}

export function toggle(doc, cls, name, label, hint, { checked = false, disabled = false, title = '' } = {}) {
  const row = h(doc, 'div', `ins-tog ${cls}`);
  if (title) row.title = title;
  const box = doc.createElement('input');
  box.type = 'checkbox'; box.dataset.field = name; box.checked = Boolean(checked); box.disabled = Boolean(disabled);
  const body = h(doc, 'span', 'ins-tog-b');
  body.appendChild(h(doc, 'span', 'ins-tog-t', label));
  if (hint) body.appendChild(h(doc, 'small', 'ins-tog-h', hint));
  row.append(box, body);
  return row;
}

export function number(doc, cls, name, label, value, min) {
  const wrap = field(doc, cls, label);
  const input = doc.createElement('input');
  input.type = 'number'; input.className = 'ins-number'; input.dataset.field = name;
  input.min = String(min); input.step = '1'; input.value = String(value);
  wrap.appendChild(input);
  return wrap;
}

export function text(doc, cls, name, label, value, { type = 'text', step = null } = {}) {
  const wrap = field(doc, cls, label);
  const input = doc.createElement('input');
  input.type = type; input.className = 'ins-number'; input.dataset.field = name; input.value = value == null ? '' : String(value);
  if (step) input.step = step;
  wrap.appendChild(input);
  return wrap;
}

export function textarea(doc, cls, name, label, value, rows) {
  const wrap = field(doc, cls, label);
  const ta = doc.createElement('textarea');
  ta.className = 'ins-textarea mono'; ta.dataset.field = name; ta.rows = rows; ta.spellcheck = false; ta.value = value == null ? '' : String(value);
  wrap.appendChild(ta);
  return wrap;
}

// ---- params -----------------------------------------------------------------

/** The ONE sentence the Scripts page carries (D23 / spec §5): no other prose. */
export const PARAMS_CAPTION = "Runs with worca's privileges.";

/** A param's AUTHORING language -> the hljs grammar id the editor loads. It lives
 *  here, not in scripts-view.mjs: that module's EDITOR_LANGUAGE is keyed by
 *  RUNTIME (there is no `js` runtime), and the composer must not import the whole
 *  Scripts page to colour one textarea. */
export const PARAM_EDITOR_LANGUAGE = Object.freeze({ command: 'bash', js: 'javascript', python: 'python' });

export function paramEditorLanguage(param) {
  if (param && param.type === 'command') return 'bash';
  return PARAM_EDITOR_LANGUAGE[String((param && param.language) || '')] || 'javascript';
}

/** renderParamsForm's `editorFor`, built once and shared by the composer's
 *  inspector and the bench's setup column so a `code` param looks and behaves the
 *  same in both. Handles are pushed onto `editors`; the CALLER destroys them
 *  before the tree goes (a pending highlight debounce on a detached node is a
 *  leak). No `highlight` means no editor: the plain textarea stays. */
export function paramEditorHook({ doc = globalThis.document, highlight = null, editors = [] } = {}) {
  if (typeof highlight !== 'function') return null;
  return (param, value) => {
    const ed = createCodeEditor({
      doc,
      value: value == null ? '' : String(value),
      name: `param:${param.id}`,
      language: paramEditorLanguage(param),
      rows: param.type === 'code' ? 8 : 3,
      highlight,
    });
    editors.push(ed);
    return ed.el;
  };
}

/** One control per sidecar param (base spec §10.3). The EFFECTIVE value (sidecar
 *  default ⊕ card) is what the control shows; a required param with neither is
 *  flagged `.ins-missing` (V22's `incomplete`). `editorFor` lets a host swap the
 *  command/code textarea for a richer editor (Task 12's code-editor.mjs); the
 *  element it returns must carry the data-field control itself. */
export function renderParamsForm(meta, config, { doc = globalThis.document, editorFor = null } = {}) {
  const frag = doc.createDocumentFragment();
  const declared = Array.isArray(meta && meta.params) ? meta.params : [];
  if (!declared.length) return frag;
  frag.appendChild(h(doc, 'div', 'ins-zone', 'Params'));
  const values = effectiveScriptParams(meta, config || {});
  let captioned = false;
  for (const p of declared) {
    const name = `param:${p.id}`;
    const label = p.label || p.id;
    const value = values[p.id];
    const isCode = p.type === 'command' || p.type === 'code';
    let row;
    if (p.type === 'boolean') row = toggle(doc, 'ins-param', name, label, p.description || '', { checked: value === true });
    // No effective value: a blank first option, so the control never shows a choice the config does not hold.
    else if (p.type === 'enum') row = select(doc, 'ins-param', name, label, [...(value == null ? [{ value: '', text: '' }] : []), ...(p.options || []).map((o) => ({ value: o, text: o }))], value == null ? '' : value);
    else if (p.type === 'number') row = text(doc, 'ins-param', name, label, value, { type: 'number', step: 'any' });
    else if (isCode) row = textarea(doc, 'ins-param ins-param-code', name, label, value, p.type === 'code' ? 8 : 3);
    else row = text(doc, 'ins-param', name, label, value);
    if (isCode && typeof editorFor === 'function') {
      const custom = editorFor(p, value, { doc });
      if (custom) row.replaceChild(custom, row.querySelector('textarea'));
    }
    if (p.required && (value === undefined || value === '')) row.classList.add('ins-missing');
    if (p.description && p.type !== 'boolean') row.title = p.description;
    frag.appendChild(row);
    if (isCode && !captioned) {
      frag.appendChild(h(doc, 'small', 'ins-caption', PARAMS_CAPTION));
      captioned = true;
    }
  }
  return frag;
}

/** Read a rendered params form back. `paramValueError` (V22's own check) is the
 *  authority for a typed value; the required-and-blank sentence below is this
 *  form's instant feedback, and the server's validator stays the gate. */
export function collectParams(root, meta) {
  const declared = Array.isArray(meta && meta.params) ? meta.params : [];
  const values = {};
  const errors = [];
  for (const p of declared) {
    const node = root.querySelector(`[data-field="param:${p.id}"]`);
    if (!node) continue;
    let v;
    if (p.type === 'boolean') v = Boolean(node.checked);
    else if (p.type === 'number') { const n = Number(node.value); v = node.value === '' || !Number.isFinite(n) ? undefined : n; }
    // A command or code value of blanks alone is no value: the runner trims it away,
    // so this form must see it as missing — exactly the composer's coerceParam rule.
    else if (p.type === 'command' || p.type === 'code') v = node.value.trim() === '' ? undefined : node.value;
    else v = node.value === '' ? undefined : node.value;
    if (v === undefined) {
      if (p.required && (p.default === undefined || p.default === '')) errors.push(`${p.label || p.id} is required.`);
      continue;
    }
    values[p.id] = v;
    const why = paramValueError(p, v);
    if (why) errors.push(why);
  }
  return { values, errors };
}

// ---- ports ------------------------------------------------------------------

/** The port editor for a `ports: "config"` script (D14) and for the Scripts
 *  page's sidecar form: one row per port, the shared reader's errors under it.
 *  `readOnly` OMITS the buttons rather than hiding them — an author `display`
 *  rule beats the `hidden` attribute, and a "disabled" Add nobody can see is
 *  worse than no Add. */
export function renderPortEditor(rawPorts, { doc = globalThis.document, hasVerdict = false, readOnly = false } = {}) {
  const wrap = h(doc, 'div', 'ins-ports ins-port-editor');
  const raw = rawPorts && typeof rawPorts === 'object' ? rawPorts : { inputs: [], outputs: [] };
  const { errors } = readConfigPorts(raw, { hasVerdict });
  const sel = (name, items, value, opts) => {
    const s = select(doc, 'ins-pf', name, '', items.map((v) => ({ value: v, text: v })), value, opts);
    s.querySelector('label').remove();
    return s;
  };
  const check = (name, label, checked) => {
    const l = h(doc, 'label', 'ins-pcheck');
    const box = doc.createElement('input'); box.type = 'checkbox'; box.dataset.field = name; box.checked = Boolean(checked); box.disabled = readOnly;
    l.append(box, doc.createTextNode(label));
    return l;
  };
  const zone = (label, dir, list) => {
    wrap.appendChild(h(doc, 'div', 'ins-zone', label));
    list.forEach((p, i) => {
      const row = h(doc, 'div', 'ins-prow');
      row.dataset.dir = dir; row.dataset.index = String(i);
      const id = doc.createElement('input');
      id.type = 'text'; id.className = 'ins-pid mono'; id.dataset.field = `port:${dir}:${i}:id`; id.value = p.id || ''; id.placeholder = 'id'; id.disabled = readOnly;
      row.append(id, sel(`port:${dir}:${i}:type`, ['md', 'json', 'void'], p.type || 'md', readOnly ? { disabled: true } : {}));
      if (dir === 'inputs') {
        row.append(check(`port:${dir}:${i}:required`, 'required', p.required !== false), check(`port:${dir}:${i}:loop`, 'loop', p.loop === true));
      } else {
        row.appendChild(sel(`port:${dir}:${i}:when`, ['always', 'blocking', 'clean'], p.when || 'always',
          hasVerdict ? (readOnly ? { disabled: true } : {}) : { disabled: true, title: 'needs a sidecar verdict' }));
        const fn = doc.createElement('input');
        fn.type = 'text'; fn.className = 'ins-pfile mono'; fn.dataset.field = `port:${dir}:${i}:filename`; fn.value = p.filename || ''; fn.placeholder = 'name-cycle{cycle}.md';
        fn.hidden = p.type === 'void';
        fn.disabled = readOnly;
        row.appendChild(fn);
      }
      if (!readOnly) {
        const rm = h(doc, 'button', 'ins-prm', '×');
        rm.type = 'button'; rm.dataset.portRemove = `${dir}:${i}`; rm.title = 'Remove';
        row.appendChild(rm);
      }
      wrap.appendChild(row);
    });
    if (readOnly) return;
    const add = h(doc, 'button', 'ins-padd', dir === 'inputs' ? '+ input' : '+ output');
    add.type = 'button'; add.dataset.portAdd = dir;
    wrap.appendChild(add);
  };
  zone('Inputs', 'inputs', Array.isArray(raw.inputs) ? raw.inputs : []);
  zone('Outputs', 'outputs', Array.isArray(raw.outputs) ? raw.outputs : []);
  for (const e of errors) wrap.appendChild(h(doc, 'div', 'ins-perr', e));
  return wrap;
}

/** Read a rendered port editor back, with P1b's storage rules so a round trip
 *  through the UI never changes a stored graph. */
export function collectPorts(root) {
  const out = { inputs: [], outputs: [] };
  for (const dir of ['inputs', 'outputs']) {
    const rows = [...root.querySelectorAll(`.ins-prow[data-dir="${dir}"]`)]
      .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
    for (const row of rows) {
      const val = (f) => { const n = row.querySelector(`[data-field$=":${f}"]`); return n ? n.value : ''; };
      const on = (f) => { const n = row.querySelector(`[data-field$=":${f}"]`); return !!(n && n.checked); };
      const p = { id: val('id'), type: val('type') || 'md' };
      if (dir === 'inputs') {
        p.required = on('required');
        if (on('loop')) p.loop = true;
      } else {
        const when = val('when');
        if (when) p.when = when;
        const filename = val('filename');
        if (filename && p.type !== 'void') p.filename = filename;
      }
      out[dir].push(p);
    }
  }
  return out;
}

const nextPortId = (list, base) => { let i = 0; for (;;) { const id = i ? `${base}${i + 1}` : base; if (!list.some((p) => p.id === id)) return id; i += 1; } };

/** Add or remove one port. Pure: a NEW object with one-level-deep clones, so a
 *  commit never mutates the undo ring's copy (the composer's clonePorts rule). */
export function applyPortEdit(rawPorts, { add = '', remove = '' } = {}) {
  const raw = rawPorts && typeof rawPorts === 'object' ? rawPorts : {};
  const ports = {
    inputs: (Array.isArray(raw.inputs) ? raw.inputs : []).map((p) => ({ ...p })),
    outputs: (Array.isArray(raw.outputs) ? raw.outputs : []).map((p) => ({ ...p })),
  };
  if (add === 'inputs') ports.inputs.push({ id: nextPortId(ports.inputs, 'in'), type: 'md', required: false });
  else if (add === 'outputs') { const id = nextPortId(ports.outputs, 'out'); ports.outputs.push({ id, type: 'md', when: 'always', filename: `${id}-cycle{cycle}.md` }); }
  if (remove) {
    const [dir, idx] = String(remove).split(':');
    if (ports[dir] && Number.isInteger(Number(idx)) && ports[dir][Number(idx)]) ports[dir].splice(Number(idx), 1);
  }
  return ports;
}
