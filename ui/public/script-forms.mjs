// ui/public/script-forms.mjs
// The three forms a script's ports and params are edited with (scripts-workbench
// design §5.3, C3). ONE implementation, used by three surfaces: the composer's
// inspector (a placed card), the Scripts page's Overview tab (the sidecar) and
// the Test tab's setup column (a bench request). Every function takes the target
// `document` via opts and returns DETACHED DOM — no fetch, no listeners outside
// the returned tree (the memory-view.mjs / plugins-view.mjs posture); the host
// binds ONE delegated listener and routes on data-field / data-port-* / data-pdef-*.
//
// The field NAMES are the contract: `param:<id>`, `port:<dir>:<i>:<field>`,
// `data-port-add`, `data-port-remove` are exactly P1b's, so the composer's
// routing and its tests hold after the move.
import {
  effectiveScriptParams, paramValueError, readConfigPorts, PARAM_TYPES,
} from '../../src/shared/graph/script-meta.mjs';
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

// ---- param definitions (the Scripts page's Overview tab) --------------------

/** The sidecar's `params` as editable rows (spec §5.2): id · type · label ·
 *  default · required · options. `language` rides along hidden so a `code`
 *  param's language survives a round trip through the form. */
export function renderParamDefsEditor(params, { doc = globalThis.document, readOnly = false } = {}) {
  const wrap = h(doc, 'div', 'pdef-editor');
  const list = Array.isArray(params) ? params : [];
  const head = h(doc, 'div', 'pdef-head');
  head.append(h(doc, 'span', '', 'id'), h(doc, 'span', '', 'type'), h(doc, 'span', '', 'label'),
    h(doc, 'span', '', 'default'), h(doc, 'span', '', 'required'));
  wrap.appendChild(head);
  list.forEach((p, i) => {
    const row = h(doc, 'div', 'pdef-row');
    row.dataset.index = String(i);
    const input = (cls, f, value, { type = 'text', placeholder = '' } = {}) => {
      const n = doc.createElement('input');
      n.type = type; n.className = cls; n.dataset.field = `pdef:${i}:${f}`;
      n.value = value == null ? '' : String(value);
      if (placeholder) n.placeholder = placeholder;
      n.disabled = readOnly;
      return n;
    };
    const type = doc.createElement('select');
    type.className = 'ins-select pdef-type'; type.dataset.field = `pdef:${i}:type`; type.disabled = readOnly;
    for (const t of PARAM_TYPES) {
      const o = doc.createElement('option');
      o.value = t; o.textContent = t;
      if (t === (p.type || 'string')) o.selected = true;
      type.appendChild(o);
    }
    const req = doc.createElement('input');
    req.type = 'checkbox'; req.className = 'pdef-req'; req.dataset.field = `pdef:${i}:required`;
    req.checked = p.required === true; req.disabled = readOnly;
    row.append(input('pdef-id mono', 'id', p.id, { placeholder: 'id' }), type,
      input('pdef-label', 'label', p.label, { placeholder: 'Label' }),
      input('pdef-default mono', 'default', p.default, { placeholder: 'default' }), req);
    if ((p.type || 'string') === 'enum') {
      row.appendChild(input('pdef-options mono', 'options', (Array.isArray(p.options) ? p.options : []).join(', '), { placeholder: 'one, two' }));
    }
    // `language` and `description` have no column, so they ride hidden: without
    // them a save through this form would silently delete every param description
    // the sidecar carries (readParams keeps `description`, the editor never shows it).
    const lang = input('pdef-language', 'language', p.language || '');
    lang.type = 'hidden';
    const desc = input('pdef-description', 'description', p.description || '');
    desc.type = 'hidden';
    row.append(lang, desc);
    // The two LOSSY columns ride hidden as well, in the shape they are stored in.
    // An <input> strips CR and LF from its value (the HTML value sanitization), so
    // a `code` param's multi-line default would come back as one line from a form
    // nobody touched — a working program turned into a syntax error by a no-op
    // Save; and joining options on ', ' cuts an option that holds a comma in two.
    // collectParamDefs prefers these while the visible box still shows exactly
    // their projection, so an actual edit still wins.
    // `type: 'hidden'` up front, not assigned after: an input that is `text` when
    // its value is set has already had the line breaks sanitized away.
    row.append(input('pdef-default-raw', 'defaultRaw', p.default == null ? '' : String(p.default), { type: 'hidden' }),
      input('pdef-options-raw', 'optionsRaw', JSON.stringify(Array.isArray(p.options) ? p.options : []), { type: 'hidden' }));
    if (!readOnly) {
      const rm = h(doc, 'button', 'pdef-rm', '×');
      rm.type = 'button'; rm.dataset.pdefRemove = String(i); rm.title = 'Remove';
      row.appendChild(rm);
    }
    wrap.appendChild(row);
  });
  if (!readOnly) {
    const add = h(doc, 'button', 'pdef-add', '+ param');
    add.type = 'button'; add.dataset.pdefAdd = '';
    wrap.appendChild(add);
  }
  return wrap;
}

/** The rows back as sidecar params. A blank id drops the row (that is how a row
 *  is abandoned without a Remove click); `validateScriptMetaV2` on the server is
 *  the authority for everything else. `keepBlank` keeps a blank-id row in place,
 *  so the result is ONE row per rendered row: a caller that indexes rows by their
 *  rendered position (a Remove click carries `data-pdef-remove="<i>"`) needs the
 *  two index spaces to agree, or it edits somebody else's param. */
export function collectParamDefs(root, { keepBlank = false } = {}) {
  const out = [];
  const rows = [...root.querySelectorAll('.pdef-row')].sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
  for (const row of rows) {
    const val = (f) => { const n = row.querySelector(`[data-field$=":${f}"]`); return n ? String(n.value) : ''; };
    const id = val('id').trim();
    if (!id && !keepBlank) continue;
    const type = val('type') || 'string';
    const p = { id, type };
    const label = val('label').trim();
    if (label) p.label = label;
    // The default is typed as text but STORED in its declared type: readParams runs
    // paramValueError on it, so `default: "0"` on a number param and `"false"` on a
    // boolean are REFUSED and the Overview form could never save such a param. An
    // unparseable entry is left as the typed string so the validator names it.
    const shown = val('default');
    const rawDefault = val('defaultRaw');
    // The box shows the stored text with its line breaks stripped; while that is
    // still what it holds, the STORED text is what gets saved.
    const dflt = rawDefault && rawDefault.replace(/[\r\n]/g, '') === shown ? rawDefault : shown;
    if (dflt !== '') {
      if (type === 'number') { const n = Number(dflt); p.default = Number.isFinite(n) ? n : dflt; }
      else if (type === 'boolean') p.default = dflt === 'true' ? true : (dflt === 'false' ? false : dflt);
      else p.default = dflt;
    }
    const req = row.querySelector('[data-field$=":required"]');
    if (req && req.checked) p.required = true;
    if (type === 'enum') {
      const shownOptions = val('options');
      let stored = null;
      try { stored = JSON.parse(val('optionsRaw') || 'null'); } catch { stored = null; }
      // Same rule as the default: an option holding a comma survives untouched.
      const options = Array.isArray(stored) && stored.join(', ') === shownOptions
        ? stored : shownOptions.split(',').map((s) => s.trim()).filter(Boolean);
      if (options.length) p.options = options;
    }
    if (type === 'code') p.language = val('language') || 'js';
    const description = val('description').trim();
    if (description) p.description = description;
    out.push(p);
  }
  return out;
}
